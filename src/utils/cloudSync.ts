import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as fbSignOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  writeBatch,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };
import type {
  Chapter,
  DailyTask,
  DayPlanSlots,
  DDay,
  Doubt,
  Habit,
  HabitLogDay,
  MistakeEntry,
  MockTest,
  PulseHabitState,
  PYQEntry,
  StudySession,
  Subject,
  SyncStatus,
  WellbeingEntry,
} from '../types';
import { cloneLog, norm } from './studyLogic.ts';
import { writeSafetyBackupSnapshot } from './storage.ts';

// Initialize Firebase App, Auth, and Firestore in browser (default memory cache only — NO offline persistence, NO onSnapshot)
const app =
  typeof window !== 'undefined'
    ? getApps().length
      ? getApp()
      : initializeApp(firebaseConfig)
    : null;
export const auth = app
  ? getAuth(app)
  : (null as unknown as ReturnType<typeof getAuth>);
export const db = app
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : (null as unknown as ReturnType<typeof getFirestore>);

export const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write',
} as const;
export type OperationType = (typeof OperationType)[keyof typeof OperationType];

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): FirestoreErrorInfo {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid,
      email: auth?.currentUser?.email,
      emailVerified: auth?.currentUser?.emailVerified,
      isAnonymous: auth?.currentUser?.isAnonymous,
      tenantId: auth?.currentUser?.tenantId,
      providerInfo:
        auth?.currentUser?.providerData.map((provider) => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  return errInfo;
}

export async function testFirestoreConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('the client is offline')
    ) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

// ==========================================
// 2.2 FIRESTORE DOCUMENT LAYOUT & CHUNKING
// ==========================================

export const MAX_DOC_BYTES = 700 * 1024; // ~700 KB chunk threshold
export const TOMBSTONE_TTL_MS = 90 * 86400000; // 90 days
export const DAILY_WRITE_CAP = 150;
export const DEBOUNCE_MS = 60 * 1000; // 60s debounce
export const MIN_SYNC_INTERVAL_MS = 5 * 60 * 1000; // max 1 sync per 5 min
export const AUTO_PULL_INTERVAL_MS = 15 * 60 * 1000; // pull on start if > 15 min ago

export interface MetaIndexDoc {
  docs: Record<string, number>; // docKey -> updatedAt
  chunks?: Record<string, string[]>; // baseDocKey -> [chunkDocKeys]
  updatedAt: number;
}

export interface MetaCoreDoc {
  [key: string]: unknown;
  set: PulseHabitState['set'];
  subjects: Record<string, Subject>;
  ddays: Record<string, DDay>;
  restDays: string[];
  del: Record<string, number>; // id -> deletedAt timestamp
  bonus: number;
  exp: number;
  ob: number;
  updatedAt: number;
}

export interface EntityMapDoc<T> {
  items: Record<string, T>;
  updatedAt: number;
}

export interface MonthlyDataDoc {
  month: string; // YYYY-MM
  sessions: Record<string, StudySession>;
  log: Record<string, Record<string, HabitLogDay>>; // habitId -> { dayKey -> HabitLogDay }
  notes: Record<string, string>; // dayKey -> note
  mood: Record<string, number>; // dayKey -> mood
  wellbeing: Record<string, WellbeingEntry>; // dayKey -> WellbeingEntry
  plans: Record<string, DayPlanSlots>; // dayKey -> slot map
  tasks: Record<string, DailyTask>; // taskId -> DailyTask
  updatedAt: number;
}

export interface PartitionedCloudDocs {
  index: MetaIndexDoc;
  docs: Record<string, Record<string, unknown>>; // docKey (e.g. "meta/core", "months/2026-10") -> payload
  metaDocs: {
    core: MetaCoreDoc;
    habits: EntityMapDoc<Habit>;
    syllabus: EntityMapDoc<Chapter>;
    mocks: EntityMapDoc<MockTest>;
    mistakes: EntityMapDoc<MistakeEntry>;
    doubts: EntityMapDoc<Doubt>;
    pyq: EntityMapDoc<PYQEntry>;
    tasks: EntityMapDoc<DailyTask>;
  };
  monthDocs: Record<string, MonthlyDataDoc>;
}

function byteLengthOf(obj: unknown): number {
  try {
    const str = JSON.stringify(obj);
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(str).length;
    }
    return str.length * 2;
  } catch {
    return 0;
  }
}

function arrayToIdMap<T extends { id: string }>(arr: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const item of arr || []) {
    if (item && item.id) {
      out[item.id] = item;
    }
  }
  return out;
}

function maxUpdatedAt<T extends { updatedAt?: number }>(
  arr: T[],
  fallback = 1
): number {
  let max = fallback;
  for (const item of arr || []) {
    if (item && Number.isFinite(item.updatedAt) && (item.updatedAt as number) > max) {
      max = item.updatedAt as number;
    }
  }
  return max;
}

/**
 * Splits an EntityMapDoc or MonthlyDataDoc into numbered chunks (`baseKey__1`, `baseKey__2`, ...)
 * if its serialized payload exceeds ~700 KB.
 */
export function splitDocIfOversized(
  baseKey: string,
  payload: Record<string, unknown>,
  maxBytes = MAX_DOC_BYTES
): { docs: Record<string, Record<string, unknown>>; chunkKeys?: string[] } {
  if (byteLengthOf(payload) <= maxBytes) {
    return { docs: { [baseKey]: payload } };
  }

  // Case 1: EntityMapDoc with `items` map
  if (payload.items && typeof payload.items === 'object') {
    const entries = Object.entries(payload.items as Record<string, unknown>);
    const chunks: Record<string, Record<string, unknown>> = {};
    const chunkKeys: string[] = [];
    let currentItems: Record<string, unknown> = {};
    let chunkIndex = 1;

    for (const [k, v] of entries) {
      currentItems[k] = v;
      const candidate = {
        items: currentItems,
        updatedAt: payload.updatedAt,
        chunkIndex,
      };
      if (byteLengthOf(candidate) > maxBytes && Object.keys(currentItems).length > 1) {
        delete currentItems[k];
        const key = chunkIndex === 1 ? baseKey : `${baseKey}__${chunkIndex}`;
        chunks[key] = {
          items: currentItems,
          updatedAt: payload.updatedAt,
          chunkIndex,
        };
        chunkKeys.push(key);
        chunkIndex += 1;
        currentItems = { [k]: v };
      }
    }
    if (Object.keys(currentItems).length > 0) {
      const key = chunkIndex === 1 ? baseKey : `${baseKey}__${chunkIndex}`;
      chunks[key] = {
        items: currentItems,
        updatedAt: payload.updatedAt,
        chunkIndex,
      };
      chunkKeys.push(key);
    }
    return { docs: chunks, chunkKeys: chunkKeys.length > 1 ? chunkKeys : undefined };
  }

  // Case 2: MonthlyDataDoc with `sessions` map
  if (payload.sessions && typeof payload.sessions === 'object') {
    const entries = Object.entries(payload.sessions as Record<string, unknown>);
    const chunks: Record<string, Record<string, unknown>> = {};
    const chunkKeys: string[] = [];
    let currentSessions: Record<string, unknown> = {};
    let chunkIndex = 1;

    for (const [k, v] of entries) {
      currentSessions[k] = v;
      const baseFields =
        chunkIndex === 1
          ? {
              month: payload.month,
              log: payload.log,
              notes: payload.notes,
              mood: payload.mood,
              wellbeing: payload.wellbeing,
              plans: payload.plans,
              tasks: payload.tasks,
            }
          : {
              month: payload.month,
              log: {},
              notes: {},
              mood: {},
              wellbeing: {},
              plans: {},
              tasks: {},
            };
      const candidate = {
        ...baseFields,
        sessions: currentSessions,
        updatedAt: payload.updatedAt,
      };
      if (byteLengthOf(candidate) > maxBytes && Object.keys(currentSessions).length > 1) {
        delete currentSessions[k];
        const key = chunkIndex === 1 ? baseKey : `${baseKey}__${chunkIndex}`;
        chunks[key] = {
          ...baseFields,
          sessions: currentSessions,
          updatedAt: payload.updatedAt,
        };
        chunkKeys.push(key);
        chunkIndex += 1;
        currentSessions = { [k]: v };
      }
    }
    if (Object.keys(currentSessions).length > 0 || chunkIndex === 1) {
      const key = chunkIndex === 1 ? baseKey : `${baseKey}__${chunkIndex}`;
      const baseFields =
        chunkIndex === 1
          ? {
              month: payload.month,
              log: payload.log,
              notes: payload.notes,
              mood: payload.mood,
              wellbeing: payload.wellbeing,
              plans: payload.plans,
              tasks: payload.tasks,
            }
          : {
              month: payload.month,
              log: {},
              notes: {},
              mood: {},
              wellbeing: {},
              plans: {},
              tasks: {},
            };
      chunks[key] = {
        ...baseFields,
        sessions: currentSessions,
        updatedAt: payload.updatedAt,
      };
      chunkKeys.push(key);
    }
    return { docs: chunks, chunkKeys: chunkKeys.length > 1 ? chunkKeys : undefined };
  }

  return { docs: { [baseKey]: payload } };
}

/**
 * 2.2: Partitions local state into Firestore document payloads (`meta/*` and `months/{YYYY-MM}`).
 * Never includes `activeTimer`.
 */
export function partitionStateToCloudDocs(
  state: PulseHabitState,
  now = Date.now(),
  maxBytes = MAX_DOC_BYTES
): PartitionedCloudDocs {
  const prunedDel: Record<string, number> = {};
  const cutoff = now - TOMBSTONE_TTL_MS;
  for (const id of state.del || []) {
    const ts = state.delAt?.[id] ?? now;
    if (ts >= cutoff) {
      prunedDel[id] = ts;
    }
  }

  const coreUpdatedAt = Math.max(
    state.set.updatedAt || 0,
    maxUpdatedAt(state.subjects, 0),
    maxUpdatedAt(state.ddays, 0),
    ...Object.values(prunedDel),
    1
  );

  // Strip local-only timer state; never sync activeTimer
  const cleanSet = { ...state.set };
  const coreDoc: MetaCoreDoc = {
    set: cleanSet,
    subjects: arrayToIdMap(state.subjects),
    ddays: arrayToIdMap(state.ddays),
    restDays: [...(state.restDays || [])],
    del: prunedDel,
    bonus: state.bonus || 0,
    exp: state.exp || 0,
    ob: state.ob || 0,
    updatedAt: coreUpdatedAt,
  };

  const habitsDoc: EntityMapDoc<Habit> = {
    items: arrayToIdMap(state.habits),
    updatedAt: maxUpdatedAt(state.habits, 1),
  };
  const syllabusDoc: EntityMapDoc<Chapter> = {
    items: arrayToIdMap(state.chapters),
    updatedAt: maxUpdatedAt(state.chapters, 1),
  };
  const mocksDoc: EntityMapDoc<MockTest> = {
    items: arrayToIdMap(state.mocks),
    updatedAt: maxUpdatedAt(state.mocks, 1),
  };
  const mistakesDoc: EntityMapDoc<MistakeEntry> = {
    items: arrayToIdMap(state.mistakes || []),
    updatedAt: maxUpdatedAt(state.mistakes || [], 1),
  };
  const doubtsDoc: EntityMapDoc<Doubt> = {
    items: arrayToIdMap(state.doubts || []),
    updatedAt: maxUpdatedAt(state.doubts || [], 1),
  };
  const pyqDoc: EntityMapDoc<PYQEntry> = {
    items: arrayToIdMap(state.pyq || []),
    updatedAt: maxUpdatedAt(state.pyq || [], 1),
  };
  const tasksDoc: EntityMapDoc<DailyTask> = {
    items: arrayToIdMap(state.tasks || []),
    updatedAt: maxUpdatedAt(state.tasks || [], 1),
  };

  // Group time-based data by YYYY-MM
  const monthsMap: Record<string, MonthlyDataDoc> = {};
  const ensureMonth = (ym: string): MonthlyDataDoc => {
    const cleanYm = /^\d{4}-\d{2}$/.test(ym) ? ym : new Date(now).toISOString().slice(0, 7);
    if (!monthsMap[cleanYm]) {
      monthsMap[cleanYm] = {
        month: cleanYm,
        sessions: {},
        log: {},
        notes: {},
        mood: {},
        wellbeing: {},
        plans: {},
        tasks: {},
        updatedAt: 1,
      };
    }
    return monthsMap[cleanYm];
  };

  for (const ses of state.sessions || []) {
    const mDoc = ensureMonth((ses.dayKey || '').slice(0, 7));
    mDoc.sessions[ses.id] = ses;
    const ts = ses.updatedAt || ses.endTs || 1;
    if (ts > mDoc.updatedAt) mDoc.updatedAt = ts;
  }

  for (const [habitId, dayMap] of Object.entries(state.log || {})) {
    for (const [dayKey, entry] of Object.entries(dayMap || {})) {
      const mDoc = ensureMonth(dayKey.slice(0, 7));
      if (!mDoc.log[habitId]) mDoc.log[habitId] = {};
      mDoc.log[habitId][dayKey] = entry;
      const ts = entry.t || entry.updatedAt || 1;
      if (ts > mDoc.updatedAt) mDoc.updatedAt = ts;
    }
  }

  for (const [dayKey, note] of Object.entries(state.notes || {})) {
    if (!note) continue;
    const mDoc = ensureMonth(dayKey.slice(0, 7));
    mDoc.notes[dayKey] = note;
  }

  for (const [dayKey, mVal] of Object.entries(state.mood || {})) {
    const mDoc = ensureMonth(dayKey.slice(0, 7));
    mDoc.mood[dayKey] = mVal;
  }

  for (const [dayKey, wb] of Object.entries(state.wellbeing || {})) {
    const mDoc = ensureMonth(dayKey.slice(0, 7));
    mDoc.wellbeing[dayKey] = wb;
    if ((wb.updatedAt || 0) > mDoc.updatedAt) {
      mDoc.updatedAt = wb.updatedAt || 1;
    }
  }

  for (const [dayKey, planSlots] of Object.entries(state.plans || {})) {
    if (!planSlots || typeof planSlots !== 'object' || Object.keys(planSlots).length === 0) {
      continue;
    }
    const mDoc = ensureMonth(dayKey.slice(0, 7));
    mDoc.plans[dayKey] = { ...planSlots };
  }

  for (const task of state.tasks || []) {
    const mDoc = ensureMonth((task.dayKey || '').slice(0, 7));
    mDoc.tasks[task.id] = task;
    const ts = task.updatedAt || task.createdAt || 1;
    if (ts > mDoc.updatedAt) mDoc.updatedAt = ts;
  }

  const metaDocs = {
    core: coreDoc,
    habits: habitsDoc,
    syllabus: syllabusDoc,
    mocks: mocksDoc,
    mistakes: mistakesDoc,
    doubts: doubtsDoc,
    pyq: pyqDoc,
    tasks: tasksDoc,
  };

  const rawDocs: Record<string, Record<string, unknown>> = {
    'meta/core': coreDoc as unknown as Record<string, unknown>,
    'meta/habits': habitsDoc as unknown as Record<string, unknown>,
    'meta/syllabus': syllabusDoc as unknown as Record<string, unknown>,
    'meta/mocks': mocksDoc as unknown as Record<string, unknown>,
    'meta/mistakes': mistakesDoc as unknown as Record<string, unknown>,
    'meta/doubts': doubtsDoc as unknown as Record<string, unknown>,
    'meta/pyq': pyqDoc as unknown as Record<string, unknown>,
    'meta/tasks': tasksDoc as unknown as Record<string, unknown>,
  };

  for (const [ym, mDoc] of Object.entries(monthsMap)) {
    rawDocs[`months/${ym}`] = mDoc as unknown as Record<string, unknown>;
  }

  const finalDocs: Record<string, Record<string, unknown>> = {};
  const indexDocsMap: Record<string, number> = {};
  const indexChunksMap: Record<string, string[]> = {};

  for (const [baseKey, payload] of Object.entries(rawDocs)) {
    const { docs: splitDocs, chunkKeys } = splitDocIfOversized(baseKey, payload, maxBytes);
    if (chunkKeys && chunkKeys.length > 1) {
      indexChunksMap[baseKey] = chunkKeys;
    }
    for (const [docKey, docPayload] of Object.entries(splitDocs)) {
      finalDocs[docKey] = docPayload;
      indexDocsMap[docKey] = Number(docPayload.updatedAt) || now;
    }
  }

  const index: MetaIndexDoc = {
    docs: indexDocsMap,
    ...(Object.keys(indexChunksMap).length > 0 ? { chunks: indexChunksMap } : {}),
    updatedAt: now,
  };

  return { index, docs: finalDocs, metaDocs, monthDocs: monthsMap };
}

// ==========================================
// 2.3 PER-ITEM LWW MERGE & TOMBSTONES
// ==========================================

/**
 * Merges two entity collections by `id` using Last-Writer-Wins (`updatedAt`),
 * honoring tombstones (`delAt[id] >= item.updatedAt`).
 */
export function mergeEntityCollectionsLWW<T extends { id: string; updatedAt?: number }>(
  localList: T[],
  remoteMap: Record<string, T> | T[] | undefined,
  mergedTombstones: Record<string, number> = {}
): T[] {
  const combined = new Map<string, T>();

  for (const item of localList || []) {
    if (!item || !item.id) continue;
    combined.set(item.id, item);
  }

  if (Array.isArray(remoteMap)) {
    for (const remoteItem of remoteMap) {
      if (!remoteItem || typeof remoteItem !== 'object' || !remoteItem.id) continue;
      const id = remoteItem.id;
      const existing = combined.get(id);
      if (!existing) {
        combined.set(id, { ...remoteItem, id });
      } else {
        const localTs = existing.updatedAt ?? 0;
        const remoteTs = remoteItem.updatedAt ?? 0;
        if (remoteTs > localTs) {
          combined.set(id, { ...remoteItem, id });
        }
      }
    }
  } else if (remoteMap && typeof remoteMap === 'object') {
    for (const [id, remoteItem] of Object.entries(remoteMap)) {
      if (!remoteItem || typeof remoteItem !== 'object') continue;
      const existing = combined.get(id);
      if (!existing) {
        combined.set(id, { ...remoteItem, id });
      } else {
        const localTs = existing.updatedAt ?? 0;
        const remoteTs = remoteItem.updatedAt ?? 0;
        if (remoteTs > localTs) {
          combined.set(id, { ...remoteItem, id });
        }
      }
    }
  }

  // Filter out items where tombstone timestamp >= item.updatedAt
  const result: T[] = [];
  for (const [id, item] of combined.entries()) {
    const deletedAt = mergedTombstones[id];
    if (deletedAt !== undefined) {
      const itemTs = item.updatedAt ?? 0;
      if (deletedAt >= itemTs) {
        continue; // Deletion beats older or simultaneous edit
      }
    }
    result.push(item);
  }

  return result;
}

/**
 * 2.3 & 2.4: Merges local state with downloaded cloud documents using per-item LWW and tombstones.
 * Never overwrites local `activeTimer`.
 */
export function mergeStateWithCloudDocs(
  localState: PulseHabitState,
  cloudDocsInput:
    | Record<string, Record<string, unknown>>
    | {
        metaDocs?: Record<string, unknown>;
        monthDocs?: Record<string, unknown>;
      },
  now = Date.now()
): PulseHabitState {
  const cloudDocs: Record<string, Record<string, unknown>> = {};
  if (
    cloudDocsInput &&
    ('metaDocs' in cloudDocsInput || 'monthDocs' in cloudDocsInput)
  ) {
    const structured = cloudDocsInput as {
      metaDocs?: Record<string, Record<string, unknown>>;
      monthDocs?: Record<string, Record<string, unknown>>;
    };
    for (const [k, v] of Object.entries(structured.metaDocs || {})) {
      if (v && typeof v === 'object') {
        cloudDocs[k.startsWith('meta/') ? k : `meta/${k}`] = v;
      }
    }
    for (const [ym, v] of Object.entries(structured.monthDocs || {})) {
      if (v && typeof v === 'object') {
        cloudDocs[ym.startsWith('months/') ? ym : `months/${ym}`] = v;
      }
    }
  } else if (cloudDocsInput && typeof cloudDocsInput === 'object') {
    Object.assign(
      cloudDocs,
      cloudDocsInput as Record<string, Record<string, unknown>>
    );
  }

  const preservedActiveTimer = localState.activeTimer;
  const cutoff = now - TOMBSTONE_TTL_MS;

  // 1. Merge tombstones (local + remote meta/core.del), pruning >90 days
  const mergedTombstones: Record<string, number> = {};
  for (const id of localState.del || []) {
    const ts = localState.delAt?.[id] ?? 1;
    if (ts >= cutoff) mergedTombstones[id] = ts;
  }
  const remoteCore = cloudDocs['meta/core'] as Partial<MetaCoreDoc> | undefined;
  if (remoteCore?.del && typeof remoteCore.del === 'object') {
    for (const [id, ts] of Object.entries(remoteCore.del)) {
      const numTs = Number(ts) || 1;
      if (numTs >= cutoff) {
        mergedTombstones[id] = Math.max(mergedTombstones[id] || 0, numTs);
      }
    }
  }

  // Helper to collect items across base doc + any numbered chunks (`baseKey__2`, etc.)
  const collectChunkedItems = <T>(baseKey: string): Record<string, T> => {
    const out: Record<string, T> = {};
    for (const [docKey, payload] of Object.entries(cloudDocs)) {
      if (docKey === baseKey || docKey.startsWith(`${baseKey}__`)) {
        const items = (payload as { items?: Record<string, T> })?.items;
        if (items && typeof items === 'object') {
          Object.assign(out, items);
        }
      }
    }
    return out;
  };

  // 2. Merge settings
  let mergedSet = { ...localState.set };
  if (remoteCore?.set && typeof remoteCore.set === 'object') {
    const localSetTs = localState.set.updatedAt ?? 0;
    const remoteSetTs = Number(remoteCore.set.updatedAt) || 0;
    if (remoteSetTs > localSetTs) {
      mergedSet = {
        ...mergedSet,
        ...remoteCore.set,
        // Preserve local cloudAccount status fields until updated by sync engine
        cloudAccount: {
          ...mergedSet.cloudAccount,
          ...remoteCore.set.cloudAccount,
        },
      };
    }
  }

  // 3. Merge entity collections
  const mergedSubjects = mergeEntityCollectionsLWW<Subject>(
    localState.subjects,
    remoteCore?.subjects,
    mergedTombstones
  );
  const mergedDDays = mergeEntityCollectionsLWW<DDay>(
    localState.ddays,
    remoteCore?.ddays,
    mergedTombstones
  );
  const mergedHabits = mergeEntityCollectionsLWW<Habit>(
    localState.habits,
    collectChunkedItems<Habit>('meta/habits'),
    mergedTombstones
  );
  const mergedChapters = mergeEntityCollectionsLWW<Chapter>(
    localState.chapters,
    collectChunkedItems<Chapter>('meta/syllabus'),
    mergedTombstones
  );
  const mergedMocks = mergeEntityCollectionsLWW<MockTest>(
    localState.mocks,
    collectChunkedItems<MockTest>('meta/mocks'),
    mergedTombstones
  );
  const mergedMistakes = mergeEntityCollectionsLWW<MistakeEntry>(
    localState.mistakes || [],
    collectChunkedItems<MistakeEntry>('meta/mistakes'),
    mergedTombstones
  );
  const mergedDoubts = mergeEntityCollectionsLWW<Doubt>(
    localState.doubts || [],
    collectChunkedItems<Doubt>('meta/doubts'),
    mergedTombstones
  );
  const mergedPyq = mergeEntityCollectionsLWW<PYQEntry>(
    localState.pyq || [],
    collectChunkedItems<PYQEntry>('meta/pyq'),
    mergedTombstones
  );

  // Gather remote monthly data & tasks
  const remoteSessionsMap: Record<string, StudySession> = {};
  const remoteTasksMap: Record<string, DailyTask> = collectChunkedItems<DailyTask>('meta/tasks');
  const mergedLog = cloneLog(localState.log);
  const mergedNotes: Record<string, string> = { ...(localState.notes || {}) };
  const mergedMood: Record<string, number> = { ...(localState.mood || {}) };
  const mergedWellbeing: Record<string, WellbeingEntry> = { ...(localState.wellbeing || {}) };
  const mergedPlans: Record<string, DayPlanSlots> = { ...(localState.plans || {}) };

  for (const [docKey, payload] of Object.entries(cloudDocs)) {
    if (!docKey.startsWith('months/')) continue;
    const mDoc = payload as unknown as Partial<MonthlyDataDoc>;
    if (mDoc.sessions && typeof mDoc.sessions === 'object') {
      Object.assign(remoteSessionsMap, mDoc.sessions);
    }
    if (mDoc.tasks && typeof mDoc.tasks === 'object') {
      for (const [tid, tItem] of Object.entries(mDoc.tasks)) {
        const existing = remoteTasksMap[tid];
        if (!existing || (tItem.updatedAt ?? 0) > (existing.updatedAt ?? 0)) {
          remoteTasksMap[tid] = tItem;
        }
      }
    }
    if (mDoc.log && typeof mDoc.log === 'object') {
      for (const [hid, dayEntries] of Object.entries(mDoc.log)) {
        if (mergedTombstones[hid]) continue;
        if (!mergedLog[hid]) mergedLog[hid] = {};
        for (const [dk, rEntry] of Object.entries(dayEntries || {})) {
          const lEntry = mergedLog[hid][dk];
          const lTs = lEntry?.updatedAt || lEntry?.t || 0;
          const rTs = rEntry?.updatedAt || rEntry?.t || 0;
          if (!lEntry || rTs > lTs) {
            mergedLog[hid][dk] = { ...rEntry };
          }
        }
      }
    }
    if (mDoc.notes && typeof mDoc.notes === 'object') {
      for (const [dk, txt] of Object.entries(mDoc.notes)) {
        if (!mergedNotes[dk] && typeof txt === 'string') {
          mergedNotes[dk] = txt;
        }
      }
    }
    if (mDoc.mood && typeof mDoc.mood === 'object') {
      for (const [dk, mVal] of Object.entries(mDoc.mood)) {
        if (mergedMood[dk] === undefined && typeof mVal === 'number') {
          mergedMood[dk] = mVal;
        }
      }
    }
    if (mDoc.wellbeing && typeof mDoc.wellbeing === 'object') {
      for (const [dk, rWb] of Object.entries(mDoc.wellbeing)) {
        const lWb = mergedWellbeing[dk];
        if (!lWb || (rWb.updatedAt ?? 0) > (lWb.updatedAt ?? 0)) {
          mergedWellbeing[dk] = { ...rWb };
        }
      }
    }
    if (mDoc.plans && typeof mDoc.plans === 'object') {
      for (const [dk, rPlanSlots] of Object.entries(mDoc.plans)) {
        if (rPlanSlots && typeof rPlanSlots === 'object' && !Array.isArray(rPlanSlots)) {
          mergedPlans[dk] = {
            ...(mergedPlans[dk] || {}),
            ...(rPlanSlots as DayPlanSlots),
          };
        }
      }
    }
  }

  const mergedSessions = mergeEntityCollectionsLWW<StudySession>(
    localState.sessions,
    remoteSessionsMap,
    mergedTombstones
  );
  const mergedTasks = mergeEntityCollectionsLWW<DailyTask>(
    localState.tasks || [],
    remoteTasksMap,
    mergedTombstones
  );

  // Remove any tombstone-deleted habits from mergedLog
  for (const hid of Object.keys(mergedLog)) {
    if (mergedTombstones[hid] && !mergedHabits.some((h) => h.id === hid)) {
      delete mergedLog[hid];
    }
  }

  const mergedRestDays = Array.from(
    new Set([...(localState.restDays || []), ...(remoteCore?.restDays || [])])
  ).sort();

  const candidate: PulseHabitState = norm({
    ...localState,
    set: mergedSet,
    subjects: mergedSubjects,
    habits: mergedHabits,
    log: mergedLog,
    tasks: mergedTasks,
    sessions: mergedSessions,
    plans: mergedPlans,
    ddays: mergedDDays,
    mocks: mergedMocks,
    chapters: mergedChapters,
    mistakes: mergedMistakes,
    doubts: mergedDoubts,
    pyq: mergedPyq,
    restDays: mergedRestDays,
    wellbeing: mergedWellbeing,
    notes: mergedNotes,
    mood: mergedMood,
    bonus: Math.max(localState.bonus || 0, remoteCore?.bonus || 0),
    exp: Math.max(localState.exp || 0, remoteCore?.exp || 0),
    ob: localState.ob || remoteCore?.ob ? 1 : 0,
    del: Object.keys(mergedTombstones),
    delAt: mergedTombstones,
    activeTimer: preservedActiveTimer,
  });

  candidate.activeTimer = preservedActiveTimer;
  return candidate;
}

// ==========================================
// 2.4 SYNC WRITE BUDGET CONTROLLER (TESTABLE WITH FAKE TIMERS)
// ==========================================

export interface SyncOutboxMeta {
  dirtyDocs: string[];
  lastPushTs: number;
  lastPullTs: number;
  knownRemoteDocTs: Record<string, number>;
  dailyWritesDayKey: string;
  dailyWritesCount: number;
  quotaPausedUntilDayKey: string | null;
  firstSignInMergedUids: string[];
}

const DEFAULT_OUTBOX_META: SyncOutboxMeta = {
  dirtyDocs: [],
  lastPushTs: 0,
  lastPullTs: 0,
  knownRemoteDocTs: {},
  dailyWritesDayKey: '',
  dailyWritesCount: 0,
  quotaPausedUntilDayKey: null,
  firstSignInMergedUids: [],
};

export function loadSyncOutboxMeta(): SyncOutboxMeta {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_OUTBOX_META };
    const raw = localStorage.getItem('dh_sync_meta');
    if (!raw) return { ...DEFAULT_OUTBOX_META };
    const parsed = JSON.parse(raw) as Partial<SyncOutboxMeta>;
    return {
      dirtyDocs: Array.isArray(parsed.dirtyDocs) ? parsed.dirtyDocs : [],
      lastPushTs: Number(parsed.lastPushTs) || 0,
      lastPullTs: Number(parsed.lastPullTs) || 0,
      knownRemoteDocTs:
        parsed.knownRemoteDocTs && typeof parsed.knownRemoteDocTs === 'object'
          ? parsed.knownRemoteDocTs
          : {},
      dailyWritesDayKey:
        typeof parsed.dailyWritesDayKey === 'string' ? parsed.dailyWritesDayKey : '',
      dailyWritesCount: Number(parsed.dailyWritesCount) || 0,
      quotaPausedUntilDayKey:
        typeof parsed.quotaPausedUntilDayKey === 'string'
          ? parsed.quotaPausedUntilDayKey
          : null,
      firstSignInMergedUids: Array.isArray(parsed.firstSignInMergedUids)
        ? parsed.firstSignInMergedUids
        : [],
    };
  } catch {
    return { ...DEFAULT_OUTBOX_META };
  }
}

export function saveSyncOutboxMeta(meta: SyncOutboxMeta): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('dh_sync_meta', JSON.stringify(meta));
    }
  } catch {
    // ignore storage errors
  }
}

export function isQuotaOrResourceExhaustedError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? `${err.name} ${err.message} ${(err as { code?: string }).code || ''}`
      : String(err);
  return /resource-exhausted|quota|exceeded/i.test(msg);
}

export function getSyncTodayWrites(now = Date.now()): number {
  const meta = loadSyncOutboxMeta();
  const todayKey = new Date(now).toISOString().slice(0, 10);
  if (meta.dailyWritesDayKey !== todayKey) return 0;
  return meta.dailyWritesCount || 0;
}

/**
 * Pure/testable SyncBudgetController enforcing:
 * - 60s debounce after last change
 * - max 1 automatic push per 5 min
 * - 1 immediate flush on background (visibilitychange / pagehide)
 * - coalescing dirty doc keys
 * - max 150 writes/user/day cap
 * - pause on quota / resource-exhausted error until next day
 */
export class SyncBudgetController {
  meta: SyncOutboxMeta;
  timerId: ReturnType<typeof setTimeout> | null = null;
  getNow: () => number;
  getDayKey: (now: number) => string;
  onFlushDocs: (
    dirtyDocKeys: string[]
  ) => Promise<{ writesUsed: number }>;
  onMetaChanged?: (meta: SyncOutboxMeta) => void;
  isFlushing = false;

  constructor(
    optionsOrCallback:
      | (() => Promise<void> | void)
      | {
          initialMeta?: Partial<SyncOutboxMeta>;
          getNow?: () => number;
          getDayKey?: (now: number) => string;
          onFlushDocs: (dirtyDocKeys: string[]) => Promise<{ writesUsed: number }>;
          onMetaChanged?: (meta: SyncOutboxMeta) => void;
        }
  ) {
    if (typeof optionsOrCallback === 'function') {
      this.getNow = () => Date.now();
      this.getDayKey = (now: number) => new Date(now).toISOString().slice(0, 10);
      this.onFlushDocs = () =>
        Promise.resolve(optionsOrCallback()).then(() => ({ writesUsed: 0 }));
      this.meta = {
        ...DEFAULT_OUTBOX_META,
        dirtyDocs: [],
      };
    } else {
      this.getNow = optionsOrCallback.getNow || (() => Date.now());
      this.getDayKey =
        optionsOrCallback.getDayKey ||
        ((now: number) => new Date(now).toISOString().slice(0, 10));
      this.onFlushDocs = optionsOrCallback.onFlushDocs;
      this.onMetaChanged = optionsOrCallback.onMetaChanged;
      this.meta = {
        ...DEFAULT_OUTBOX_META,
        ...optionsOrCallback.initialMeta,
        dirtyDocs: [...(optionsOrCallback.initialMeta?.dirtyDocs || [])],
      };
    }
    this.rolloverDayIfNeeded();
  }

  rolloverDayIfNeeded(): void {
    const today = this.getDayKey(this.getNow());
    if (this.meta.dailyWritesDayKey !== today) {
      this.meta.dailyWritesDayKey = today;
      this.meta.dailyWritesCount = 0;
    }
    if (
      this.meta.quotaPausedUntilDayKey &&
      today >= this.meta.quotaPausedUntilDayKey
    ) {
      this.meta.quotaPausedUntilDayKey = null;
    }
  }

  getMeta(): SyncOutboxMeta {
    this.rolloverDayIfNeeded();
    return {
      ...this.meta,
      dirtyDocs: [...this.meta.dirtyDocs],
    };
  }

  getTodayWrites(): number {
    this.rolloverDayIfNeeded();
    return this.meta.dailyWritesCount;
  }

  getRemainingDailyWrites(): number {
    this.rolloverDayIfNeeded();
    return Math.max(0, DAILY_WRITE_CAP - this.meta.dailyWritesCount);
  }

  canWrite(count = 1): boolean {
    this.rolloverDayIfNeeded();
    if (this.isPausedForToday()) return false;
    return this.meta.dailyWritesCount + count <= DAILY_WRITE_CAP;
  }

  recordWrites(count: number): void {
    this.rolloverDayIfNeeded();
    const safeCount = Math.max(0, Math.floor(Number(count) || 0));
    this.meta.dailyWritesCount = Math.min(
      DAILY_WRITE_CAP,
      this.meta.dailyWritesCount + safeCount
    );
    if (this.meta.dailyWritesCount >= DAILY_WRITE_CAP) {
      const tomorrow = new Date(this.getNow() + 86400000)
        .toISOString()
        .slice(0, 10);
      this.meta.quotaPausedUntilDayKey = tomorrow;
    }
    this.notifyMeta();
  }

  pauseForQuotaError(): void {
    this.rolloverDayIfNeeded();
    const tomorrow = new Date(this.getNow() + 86400000)
      .toISOString()
      .slice(0, 10);
    this.meta.quotaPausedUntilDayKey = tomorrow;
    this.notifyMeta();
  }

  isPausedForQuota(): boolean {
    this.rolloverDayIfNeeded();
    return Boolean(this.meta.quotaPausedUntilDayKey);
  }

  isPausedForToday(): boolean {
    this.rolloverDayIfNeeded();
    return (
      Boolean(this.meta.quotaPausedUntilDayKey) ||
      this.meta.dailyWritesCount >= DAILY_WRITE_CAP
    );
  }

  markDirty(docKeys: string[] = ['meta/core']): void {
    this.rolloverDayIfNeeded();
    const set = new Set(this.meta.dirtyDocs);
    const list = Array.isArray(docKeys) && docKeys.length > 0 ? docKeys : ['meta/core'];
    for (const k of list) {
      if (k && k.trim()) set.add(k.trim());
    }
    this.meta.dirtyDocs = Array.from(set);
    this.notifyMeta();
    this.scheduleFlush();
  }

  scheduleFlush(): void {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    if (this.meta.dirtyDocs.length === 0 || this.isPausedForQuota()) return;

    const now = this.getNow();
    const elapsedSinceLastPush =
      this.meta.lastPushTs > 0 ? now - this.meta.lastPushTs : Infinity;
    const minIntervalWait =
      elapsedSinceLastPush < MIN_SYNC_INTERVAL_MS
        ? MIN_SYNC_INTERVAL_MS - elapsedSinceLastPush
        : 0;
    const delay = Math.max(DEBOUNCE_MS, minIntervalWait);

    this.timerId = setTimeout(() => {
      this.timerId = null;
      void this.flush(false);
    }, delay);
  }

  async flushOnBackground(): Promise<{
    flushed: boolean;
    writesUsed: number;
    pausedReason?: string;
  }> {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    return this.flush(true);
  }

  async flush(forceImmediate = false): Promise<{
    flushed: boolean;
    writesUsed: number;
    pausedReason?: string;
  }> {
    if (this.timerId && forceImmediate) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.rolloverDayIfNeeded();

    if (this.isFlushing || this.meta.dirtyDocs.length === 0) {
      return { flushed: false, writesUsed: 0 };
    }

    if (this.isPausedForQuota()) {
      return {
        flushed: false,
        writesUsed: 0,
        pausedReason: 'quota-paused',
      };
    }

    const remaining = this.getRemainingDailyWrites();
    if (remaining <= 0) {
      const tomorrow = new Date(this.getNow() + 86400000)
        .toISOString()
        .slice(0, 10);
      this.meta.quotaPausedUntilDayKey = tomorrow;
      this.notifyMeta();
      return {
        flushed: false,
        writesUsed: 0,
        pausedReason: 'daily-cap-reached',
      };
    }

    // Coalesce dirty docs, capped to remaining daily write budget (leaving 1 write for meta/index)
    const maxDocsToFlush = Math.max(1, remaining - 1);
    const docsToFlush = this.meta.dirtyDocs.slice(0, maxDocsToFlush);
    const flushedSet = new Set(docsToFlush);
    const previousDirty = [...this.meta.dirtyDocs];
    const flushNow = this.getNow();

    this.meta.dirtyDocs = this.meta.dirtyDocs.filter((k) => !flushedSet.has(k));
    this.meta.lastPushTs = flushNow;
    this.isFlushing = true;

    try {
      const { writesUsed } = await this.onFlushDocs(docsToFlush);
      this.meta.dailyWritesCount = Math.min(
        DAILY_WRITE_CAP,
        this.meta.dailyWritesCount + writesUsed
      );
      if (this.meta.dailyWritesCount >= DAILY_WRITE_CAP) {
        const tomorrow = new Date(this.getNow() + 86400000)
          .toISOString()
          .slice(0, 10);
        this.meta.quotaPausedUntilDayKey = tomorrow;
      }
      this.notifyMeta();
      return { flushed: true, writesUsed };
    } catch (err) {
      this.meta.dirtyDocs = Array.from(new Set([...previousDirty, ...this.meta.dirtyDocs]));
      if (isQuotaOrResourceExhaustedError(err)) {
        const tomorrow = new Date(this.getNow() + 86400000)
          .toISOString()
          .slice(0, 10);
        this.meta.quotaPausedUntilDayKey = tomorrow;
        this.notifyMeta();
        return {
          flushed: false,
          writesUsed: 0,
          pausedReason: 'resource-exhausted',
        };
      }
      throw err;
    } finally {
      this.isFlushing = false;
    }
  }

  dispose(): void {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  notifyMeta(): void {
    this.onMetaChanged?.(this.getMeta());
  }
}

// ==========================================
// 2.1 & 2.4 LIVE FIREBASE AUTH + SYNC OPERATIONS
// ==========================================

export async function signInWithGoogleAccount(): Promise<User | null> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    const res = await signInWithPopup(auth, provider);
    return res.user;
  } catch (err) {
    const code = (err as { code?: string })?.code || '';
    // Fallback to redirect for installed standalone PWAs or blocked popups
    if (
      code === 'auth/popup-blocked' ||
      code === 'auth/operation-not-supported-in-this-environment'
    ) {
      await signInWithRedirect(auth, provider);
      return null;
    }
    throw err;
  }
}

export async function checkRedirectSignInResult(): Promise<User | null> {
  try {
    const res = await getRedirectResult(auth);
    return res?.user || null;
  } catch {
    return null;
  }
}

export async function signOutGoogleAccount(): Promise<void> {
  await fbSignOut(auth);
}

export function subscribeToAuthChanges(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, cb);
}

export function hasMeaningfulLocalData(state: PulseHabitState): boolean {
  return (
    state.sessions.length > 0 ||
    state.chapters.length > 0 ||
    state.mocks.length > 0 ||
    (state.tasks || []).length > 0 ||
    (state.mistakes || []).length > 0 ||
    (state.doubts || []).length > 0 ||
    Object.keys(state.log || {}).length > 0
  );
}

/**
 * Diffs two states to determine which Firestore doc keys (`meta/*`, `months/YYYY-MM`) changed.
 */
export function detectDirtyDocKeys(
  prevState: PulseHabitState,
  nextState: PulseHabitState
): string[] {
  const dirty = new Set<string>();

  if (
    prevState.set !== nextState.set ||
    prevState.subjects !== nextState.subjects ||
    prevState.ddays !== nextState.ddays ||
    prevState.restDays !== nextState.restDays ||
    prevState.del !== nextState.del ||
    prevState.bonus !== nextState.bonus ||
    prevState.exp !== nextState.exp
  ) {
    dirty.add('meta/core');
  }
  if (prevState.habits !== nextState.habits) dirty.add('meta/habits');
  if (prevState.chapters !== nextState.chapters) dirty.add('meta/syllabus');
  if (prevState.mocks !== nextState.mocks) dirty.add('meta/mocks');
  if (prevState.mistakes !== nextState.mistakes) dirty.add('meta/mistakes');
  if (prevState.doubts !== nextState.doubts) dirty.add('meta/doubts');
  if (prevState.pyq !== nextState.pyq) dirty.add('meta/pyq');
  if (prevState.tasks !== nextState.tasks) dirty.add('meta/tasks');

  if (
    prevState.sessions !== nextState.sessions ||
    prevState.log !== nextState.log ||
    prevState.notes !== nextState.notes ||
    prevState.mood !== nextState.mood ||
    prevState.wellbeing !== nextState.wellbeing ||
    prevState.plans !== nextState.plans ||
    prevState.tasks !== nextState.tasks
  ) {
    const activeYm = new Date().toISOString().slice(0, 7);
    dirty.add(`months/${activeYm}`);
    for (const ses of nextState.sessions) {
      if (ses.dayKey) dirty.add(`months/${ses.dayKey.slice(0, 7)}`);
    }
  }

  return Array.from(dirty);
}

/**
 * Pulls remote `meta/index` (1 read), downloads only changed docs, merges with local state,
 * and pushes dirty docs within the 150/day write cap.
 */
export async function performCloudSyncCycle(
  uidOrOptions:
    | string
    | {
        uid: string;
        localState: PulseHabitState;
        dirtyDocKeys?: string[];
        forcePullAll?: boolean;
      },
  localStateArg?: PulseHabitState,
  controllerArg?: SyncBudgetController,
  extraOpts?: { forcePull?: boolean }
): Promise<{
  status: SyncStatus;
  errorMessage?: string;
  pulledDocs: number;
  mergedState: PulseHabitState;
  writesUsed: number;
  readsUsed: number;
  quotaExhausted: boolean;
}> {
  let uid: string;
  let localState: PulseHabitState;
  let dirtyDocKeys: string[];
  let forcePullAll: boolean;

  if (typeof uidOrOptions === 'string') {
    uid = uidOrOptions;
    localState = localStateArg!;
    const partitionedNow = partitionStateToCloudDocs(localState);
    dirtyDocKeys = Object.keys(partitionedNow.docs);
    forcePullAll = Boolean(extraOpts?.forcePull);
  } else {
    uid = uidOrOptions.uid;
    localState = uidOrOptions.localState;
    dirtyDocKeys = uidOrOptions.dirtyDocKeys || [];
    forcePullAll = Boolean(uidOrOptions.forcePullAll);
  }

  const meta = loadSyncOutboxMeta();
  const now = Date.now();
  const todayKey = new Date(now).toISOString().slice(0, 10);

  if (meta.dailyWritesDayKey !== todayKey) {
    meta.dailyWritesDayKey = todayKey;
    meta.dailyWritesCount = 0;
  }

  if (meta.quotaPausedUntilDayKey && todayKey < meta.quotaPausedUntilDayKey) {
    return {
      status: 'paused-quota',
      errorMessage: 'Daily sync write budget reached — resumes tomorrow',
      pulledDocs: 0,
      mergedState: localState,
      writesUsed: 0,
      readsUsed: 0,
      quotaExhausted: true,
    };
  }

  // First sign-in on device with local data -> write automatic local safety snapshot to backup store
  if (
    !meta.firstSignInMergedUids.includes(uid) &&
    hasMeaningfulLocalData(localState)
  ) {
    await writeSafetyBackupSnapshot(localState);
  }

  let readsUsed = 0;
  let writesUsed = 0;
  const downloadedDocs: Record<string, Record<string, unknown>> = {};

  // 1. Read users/{uid}/meta/index (1 read)
  const indexRef = doc(db, 'users', uid, 'meta', 'index');
  let remoteIndex: MetaIndexDoc | null = null;
  try {
    const indexSnap = await getDoc(indexRef);
    readsUsed += 1;
    if (indexSnap.exists()) {
      remoteIndex = indexSnap.data() as MetaIndexDoc;
    }
  } catch (err) {
    if (isQuotaOrResourceExhaustedError(err)) {
      meta.quotaPausedUntilDayKey = new Date(now + 86400000)
        .toISOString()
        .slice(0, 10);
      saveSyncOutboxMeta(meta);
      controllerArg?.pauseForQuotaError();
      return {
        status: 'paused-quota',
        errorMessage: 'Cloud quota reached — sync paused until tomorrow',
        pulledDocs: 0,
        mergedState: localState,
        writesUsed: 0,
        readsUsed,
        quotaExhausted: true,
      };
    }
    handleFirestoreError(err, OperationType.GET, `users/${uid}/meta/index`);
    return {
      status: 'error',
      errorMessage: err instanceof Error ? err.message : 'Cloud sync read failed',
      pulledDocs: 0,
      mergedState: localState,
      writesUsed: 0,
      readsUsed,
      quotaExhausted: false,
    };
  }

  // 2. Pull only changed docs from remoteIndex
  if (remoteIndex?.docs && typeof remoteIndex.docs === 'object') {
    for (const [docKey, remoteTs] of Object.entries(remoteIndex.docs)) {
      const knownTs = meta.knownRemoteDocTs[docKey] || 0;
      if (forcePullAll || !meta.firstSignInMergedUids.includes(uid) || remoteTs > knownTs) {
        const parts = docKey.split('/');
        if (parts.length === 2) {
          const docRef = doc(db, 'users', uid, parts[0], parts[1]);
          try {
            const snap = await getDoc(docRef);
            readsUsed += 1;
            if (snap.exists()) {
              downloadedDocs[docKey] = snap.data() as Record<string, unknown>;
              meta.knownRemoteDocTs[docKey] = remoteTs;
            }
          } catch (err) {
            if (isQuotaOrResourceExhaustedError(err)) {
              meta.quotaPausedUntilDayKey = new Date(now + 86400000)
                .toISOString()
                .slice(0, 10);
              saveSyncOutboxMeta(meta);
              controllerArg?.pauseForQuotaError();
              return {
                status: 'paused-quota',
                errorMessage: 'Cloud quota reached — sync paused until tomorrow',
                pulledDocs: Object.keys(downloadedDocs).length,
                mergedState: localState,
                writesUsed: 0,
                readsUsed,
                quotaExhausted: true,
              };
            }
            handleFirestoreError(err, OperationType.GET, `users/${uid}/${docKey}`);
            return {
              status: 'error',
              errorMessage: err instanceof Error ? err.message : 'Cloud sync pull failed',
              pulledDocs: Object.keys(downloadedDocs).length,
              mergedState: localState,
              writesUsed: 0,
              readsUsed,
              quotaExhausted: false,
            };
          }
        }
      }
    }
  }

  const pulledDocsCount = Object.keys(downloadedDocs).length;

  // 3. Merge downloaded docs with localState (union by id, newer updatedAt wins, tombstones respected)
  const mergedBase =
    pulledDocsCount > 0
      ? mergeStateWithCloudDocs(localState, downloadedDocs, now)
      : localState;

  const mergedState: PulseHabitState = {
    ...mergedBase,
    syncMeta: {
      uid,
      lastSyncedAt: now,
    },
  };

  // 4. Determine docs to push (first sign-in pushes all non-empty partitioned docs; otherwise dirtyDocKeys)
  const partitioned = partitionStateToCloudDocs(mergedState, now);
  const isFirstSignIn = !meta.firstSignInMergedUids.includes(uid);
  const candidateKeys = isFirstSignIn
    ? Object.keys(partitioned.docs)
    : Array.from(new Set([...meta.dirtyDocs, ...dirtyDocKeys]));

  const keysToWrite = candidateKeys.filter((k) => {
    if (!partitioned.docs[k]) return false;
    if (isFirstSignIn) return true;
    const docUpdatedAt = Number(partitioned.docs[k].updatedAt) || 0;
    const knownTs = meta.knownRemoteDocTs[k] || 0;
    return docUpdatedAt > knownTs || meta.dirtyDocs.includes(k);
  });
  const remainingBudget = Math.max(0, DAILY_WRITE_CAP - meta.dailyWritesCount);

  if (keysToWrite.length > 0 && remainingBudget > 1) {
    const allowedDocKeys = keysToWrite.slice(0, remainingBudget - 1);
    const batch = writeBatch(db);

    for (const docKey of allowedDocKeys) {
      const parts = docKey.split('/');
      if (parts.length !== 2) continue;
      const ref = doc(db, 'users', uid, parts[0], parts[1]);
      batch.set(ref, partitioned.docs[docKey]);
      writesUsed += 1;
      meta.knownRemoteDocTs[docKey] =
        Number(partitioned.docs[docKey].updatedAt) || now;
    }

    const updatedIndex: MetaIndexDoc = {
      docs: {
        ...(remoteIndex?.docs || {}),
        ...meta.knownRemoteDocTs,
      },
      ...(partitioned.index.chunks ? { chunks: partitioned.index.chunks } : {}),
      updatedAt: now,
    };
    batch.set(indexRef, updatedIndex);
    writesUsed += 1;

    try {
      await batch.commit();
    } catch (err) {
      if (isQuotaOrResourceExhaustedError(err)) {
        meta.quotaPausedUntilDayKey = new Date(now + 86400000)
          .toISOString()
          .slice(0, 10);
        saveSyncOutboxMeta(meta);
        controllerArg?.pauseForQuotaError();
        return {
          status: 'paused-quota',
          errorMessage: 'Cloud quota reached — sync paused until tomorrow',
          pulledDocs: pulledDocsCount,
          mergedState,
          writesUsed: 0,
          readsUsed,
          quotaExhausted: true,
        };
      }
      handleFirestoreError(err, OperationType.WRITE, `users/${uid}/batch`);
      return {
        status: 'error',
        errorMessage: err instanceof Error ? err.message : 'Cloud sync write failed',
        pulledDocs: pulledDocsCount,
        mergedState,
        writesUsed: 0,
        readsUsed,
        quotaExhausted: false,
      };
    }

    const writtenSet = new Set(allowedDocKeys);
    meta.dirtyDocs = keysToWrite.filter((k) => !writtenSet.has(k));
    meta.dailyWritesCount += writesUsed;
    meta.lastPushTs = now;
    controllerArg?.recordWrites(writesUsed);
  }

  if (!meta.firstSignInMergedUids.includes(uid)) {
    meta.firstSignInMergedUids.push(uid);
  }
  meta.lastPullTs = now;
  saveSyncOutboxMeta(meta);

  return {
    status: 'synced',
    pulledDocs: pulledDocsCount,
    mergedState,
    writesUsed,
    readsUsed,
    quotaExhausted: false,
  };
}

/**
 * 2.1: Deletes all known cloud documents for the current signed-in user (`users/{uid}/**`).
 */
export async function deleteAllUserCloudData(uid: string): Promise<number> {
  const indexRef = doc(db, 'users', uid, 'meta', 'index');
  const snap = await getDoc(indexRef);
  const batch = writeBatch(db);
  let deletedCount = 0;

  const docKeys = new Set<string>([
    'meta/core',
    'meta/habits',
    'meta/syllabus',
    'meta/mocks',
    'meta/mistakes',
    'meta/doubts',
    'meta/pyq',
    'meta/tasks',
  ]);

  if (snap.exists()) {
    const idx = snap.data() as MetaIndexDoc;
    for (const k of Object.keys(idx.docs || {})) {
      docKeys.add(k);
    }
  }

  for (const docKey of docKeys) {
    const parts = docKey.split('/');
    if (parts.length === 2) {
      batch.delete(doc(db, 'users', uid, parts[0], parts[1]));
      deletedCount += 1;
    }
  }
  batch.delete(indexRef);
  deletedCount += 1;

  await batch.commit();

  const meta = loadSyncOutboxMeta();
  meta.knownRemoteDocTs = {};
  meta.dirtyDocs = [];
  saveSyncOutboxMeta(meta);

  return deletedCount;
}
