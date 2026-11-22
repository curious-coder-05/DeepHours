import { playSoundCue } from './audioEngine';
import {
  safeJsonParse,
  safeLocalStorageRemove,
  safeLocalStorageSet,
} from './security.ts';

export type ExamSectionId = 'bio' | 'chem' | 'phy' | 'omr';

export interface ExamSectionConfig {
  id: ExamSectionId;
  label: string;
  shortLabel: string;
  color: string;
  budgetMins: number;
  enabled: boolean;
}

export interface ExamVisitLogEntry {
  sectionId: ExamSectionId;
  startedAt: number;
  endedAt: number | null;
}

export interface ExamClockState {
  id: string;
  status: 'idle' | 'running' | 'paused' | 'finished';
  totalDurationMins: number;
  sections: ExamSectionConfig[];
  startedAt: number | null;
  finishedAt: number | null;
  pausedAt: number | null;
  activeSectionId: ExamSectionId | null;
  activeSegmentStartedAt: number | null;
  accumulatedMs: Record<ExamSectionId, number>;
  visitCounts: Record<ExamSectionId, number>;
  visitLog: ExamVisitLogEntry[];
  overtimeAlerted: Record<ExamSectionId, boolean>;
  switchCount: number;
}

export interface ExamSectionLiveMetrics {
  id: ExamSectionId;
  label: string;
  shortLabel: string;
  color: string;
  budgetMs: number;
  elapsedMs: number;
  remainingMs: number;
  overtimeMs: number;
  isOvertime: boolean;
  isActive: boolean;
  visits: number;
}

export interface ExamClockLiveSnapshot {
  status: ExamClockState['status'];
  totalBudgetMs: number;
  totalElapsedMs: number;
  totalRemainingMs: number;
  totalOvertimeMs: number;
  activeSectionId: ExamSectionId | null;
  sections: ExamSectionLiveMetrics[];
  newlyOvertimeSectionIds: ExamSectionId[];
}

export interface ExamBleedSectionRow {
  id: ExamSectionId;
  label: string;
  color: string;
  targetMs: number;
  actualMs: number;
  deltaMs: number;
  status: 'bleed' | 'starved' | 'on-target';
  visits: number;
}

export interface ExamVisitSummaryItem {
  sectionId: ExamSectionId;
  label: string;
  color: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
}

export interface ExamPaceRecord {
  id: string;
  completedAt: number;
  totalDurationMins: number;
  totalElapsedMs: number;
  switchCount: number;
  sections: ExamBleedSectionRow[];
  visitLog: ExamVisitSummaryItem[];
}

export const ACTIVE_EXAM_STORAGE_KEY = 'dh_exam_clock_active_v1';
export const EXAM_PACE_HISTORY_KEY = 'dh_exam_pace_records_v1';
const MAX_LOCAL_PACE_RECORDS = 30;

export const DEFAULT_NEET_SECTIONS: ExamSectionConfig[] = [
  {
    id: 'bio',
    label: 'Biology',
    shortLabel: 'Bio',
    color: '#34D399',
    budgetMins: 50,
    enabled: true,
  },
  {
    id: 'chem',
    label: 'Chemistry',
    shortLabel: 'Chem',
    color: '#A78BFA',
    budgetMins: 50,
    enabled: true,
  },
  {
    id: 'phy',
    label: 'Physics',
    shortLabel: 'Phy',
    color: '#38BDF8',
    budgetMins: 70,
    enabled: true,
  },
  {
    id: 'omr',
    label: 'OMR / Review',
    shortLabel: 'OMR',
    color: '#F5C451',
    budgetMins: 10,
    enabled: true,
  },
];

function emptySectionNumbers(): Record<ExamSectionId, number> {
  return { bio: 0, chem: 0, phy: 0, omr: 0 };
}

function emptySectionBooleans(): Record<ExamSectionId, boolean> {
  return { bio: false, chem: false, phy: false, omr: false };
}

function sumEnabledBudgetMins(sections: ExamSectionConfig[]): number {
  return sections.reduce(
    (sum, s) => sum + (s.enabled ? Math.max(1, Math.round(s.budgetMins)) : 0),
    0
  );
}

export function createInitialExamClockState(
  customSections?: ExamSectionConfig[]
): ExamClockState {
  const sections = (customSections || DEFAULT_NEET_SECTIONS).map((s) => ({ ...s }));
  return {
    id: `exam_${Date.now().toString(36)}`,
    status: 'idle',
    totalDurationMins: sumEnabledBudgetMins(sections),
    sections,
    startedAt: null,
    finishedAt: null,
    pausedAt: null,
    activeSectionId: null,
    activeSegmentStartedAt: null,
    accumulatedMs: emptySectionNumbers(),
    visitCounts: emptySectionNumbers(),
    visitLog: [],
    overtimeAlerted: emptySectionBooleans(),
    switchCount: 0,
  };
}

export function updateExamSectionConfig(
  state: ExamClockState,
  sectionId: ExamSectionId,
  patch: Partial<Pick<ExamSectionConfig, 'budgetMins' | 'enabled'>>
): ExamClockState {
  if (state.status !== 'idle') return state;
  const nextSections = state.sections.map((sec) => {
    if (sec.id !== sectionId) return sec;
    const nextEnabled =
      sectionId === 'omr' && typeof patch.enabled === 'boolean'
        ? patch.enabled
        : sec.enabled;
    const nextBudget =
      typeof patch.budgetMins === 'number' && Number.isFinite(patch.budgetMins)
        ? Math.max(1, Math.min(180, Math.round(patch.budgetMins)))
        : sec.budgetMins;
    return {
      ...sec,
      enabled: nextEnabled,
      budgetMins: nextBudget,
    };
  });
  return {
    ...state,
    sections: nextSections,
    totalDurationMins: sumEnabledBudgetMins(nextSections),
  };
}

export function startExamClock(
  state: ExamClockState,
  initialSectionId: ExamSectionId = 'bio',
  now: number = Date.now()
): ExamClockState {
  const enabledSections = state.sections.filter((s) => s.enabled);
  const firstSec =
    enabledSections.find((s) => s.id === initialSectionId) || enabledSections[0];
  if (!firstSec) return state;

  const visitCounts = emptySectionNumbers();
  visitCounts[firstSec.id] = 1;

  return {
    ...state,
    id: `exam_${now.toString(36)}`,
    status: 'running',
    totalDurationMins: sumEnabledBudgetMins(state.sections),
    startedAt: now,
    finishedAt: null,
    pausedAt: null,
    activeSectionId: firstSec.id,
    activeSegmentStartedAt: now,
    accumulatedMs: emptySectionNumbers(),
    visitCounts,
    visitLog: [{ sectionId: firstSec.id, startedAt: now, endedAt: null }],
    overtimeAlerted: emptySectionBooleans(),
    switchCount: 0,
  };
}

/**
 * Non-locking chess-clock section switch.
 * Banks elapsed time on the previous active section and immediately opens a new visit
 * on `targetSectionId`. Users can revisit any section an unlimited number of times.
 */
export function switchExamSection(
  state: ExamClockState,
  targetSectionId: ExamSectionId,
  now: number = Date.now()
): ExamClockState {
  if (state.status !== 'running' && state.status !== 'paused') return state;
  const targetConfig = state.sections.find(
    (s) => s.id === targetSectionId && s.enabled
  );
  if (!targetConfig) return state;

  if (state.activeSectionId === targetSectionId) {
    // If paused on the same section, tapping its pad resumes smoothly
    if (state.status === 'paused') {
      return resumeExamClock(state, now);
    }
    return state;
  }

  const nextAccumulated = { ...state.accumulatedMs };
  const nextVisitCounts = { ...state.visitCounts };
  const nextVisitLog = state.visitLog.map((entry) => ({ ...entry }));

  if (state.activeSectionId) {
    if (state.status === 'running' && state.activeSegmentStartedAt !== null) {
      const delta = Math.max(0, now - state.activeSegmentStartedAt);
      nextAccumulated[state.activeSectionId] =
        (nextAccumulated[state.activeSectionId] || 0) + delta;
    }
    const lastEntry = nextVisitLog[nextVisitLog.length - 1];
    if (lastEntry && lastEntry.endedAt === null) {
      lastEntry.endedAt = state.status === 'paused' && state.pausedAt ? state.pausedAt : now;
    }
  }

  nextVisitCounts[targetSectionId] = (nextVisitCounts[targetSectionId] || 0) + 1;
  nextVisitLog.push({
    sectionId: targetSectionId,
    startedAt: now,
    endedAt: null,
  });

  return {
    ...state,
    status: 'running',
    pausedAt: null,
    activeSectionId: targetSectionId,
    activeSegmentStartedAt: now,
    accumulatedMs: nextAccumulated,
    visitCounts: nextVisitCounts,
    visitLog: nextVisitLog,
    switchCount: state.switchCount + 1,
  };
}

export function pauseExamClock(
  state: ExamClockState,
  now: number = Date.now()
): ExamClockState {
  if (state.status !== 'running') return state;
  const nextAccumulated = { ...state.accumulatedMs };
  if (state.activeSectionId && state.activeSegmentStartedAt !== null) {
    const delta = Math.max(0, now - state.activeSegmentStartedAt);
    nextAccumulated[state.activeSectionId] =
      (nextAccumulated[state.activeSectionId] || 0) + delta;
  }
  return {
    ...state,
    status: 'paused',
    pausedAt: now,
    activeSegmentStartedAt: null,
    accumulatedMs: nextAccumulated,
  };
}

export function resumeExamClock(
  state: ExamClockState,
  now: number = Date.now()
): ExamClockState {
  if (state.status !== 'paused' || !state.activeSectionId) return state;
  return {
    ...state,
    status: 'running',
    pausedAt: null,
    activeSegmentStartedAt: now,
  };
}

export function acknowledgeOvertimeAlerts(
  state: ExamClockState,
  sectionIds: ExamSectionId[]
): ExamClockState {
  if (sectionIds.length === 0) return state;
  let changed = false;
  const nextAlerted = { ...state.overtimeAlerted };
  for (const id of sectionIds) {
    if (!nextAlerted[id]) {
      nextAlerted[id] = true;
      changed = true;
    }
  }
  if (!changed) return state;
  return {
    ...state,
    overtimeAlerted: nextAlerted,
  };
}

/**
 * Pure timestamp-derived snapshot. Zero accumulated tick drift across background tabs,
 * Android Doze throttling, or screen locks.
 */
export function computeExamClockSnapshot(
  state: ExamClockState,
  now: number = Date.now()
): ExamClockLiveSnapshot {
  const enabledSections = state.sections.filter((s) => s.enabled);
  const totalBudgetMs = sumEnabledBudgetMins(enabledSections) * 60_000;
  let totalElapsedMs = 0;
  const newlyOvertimeSectionIds: ExamSectionId[] = [];

  const sections: ExamSectionLiveMetrics[] = enabledSections.map((sec) => {
    const budgetMs = Math.max(1, sec.budgetMins) * 60_000;
    const baseMs = state.accumulatedMs[sec.id] || 0;
    const liveDeltaMs =
      state.status === 'running' &&
      state.activeSectionId === sec.id &&
      state.activeSegmentStartedAt !== null
        ? Math.max(0, now - state.activeSegmentStartedAt)
        : 0;
    const elapsedMs = baseMs + liveDeltaMs;
    totalElapsedMs += elapsedMs;

    const remainingMs = Math.max(0, budgetMs - elapsedMs);
    const overtimeMs = Math.max(0, elapsedMs - budgetMs);
    const isOvertime = overtimeMs > 0;

    if (
      state.status === 'running' &&
      isOvertime &&
      !state.overtimeAlerted[sec.id]
    ) {
      newlyOvertimeSectionIds.push(sec.id);
    }

    return {
      id: sec.id,
      label: sec.label,
      shortLabel: sec.shortLabel,
      color: sec.color,
      budgetMs,
      elapsedMs,
      remainingMs,
      overtimeMs,
      isOvertime,
      isActive:
        (state.status === 'running' || state.status === 'paused') &&
        state.activeSectionId === sec.id,
      visits: state.visitCounts[sec.id] || 0,
    };
  });

  return {
    status: state.status,
    totalBudgetMs,
    totalElapsedMs,
    totalRemainingMs: Math.max(0, totalBudgetMs - totalElapsedMs),
    totalOvertimeMs: Math.max(0, totalElapsedMs - totalBudgetMs),
    activeSectionId: state.activeSectionId,
    sections,
    newlyOvertimeSectionIds,
  };
}

export function buildExamPaceRecord(
  state: ExamClockState,
  completedAt: number = Date.now()
): ExamPaceRecord {
  const snap = computeExamClockSnapshot(state, completedAt);
  const sectionMap = new Map(state.sections.map((s) => [s.id, s]));

  const sections: ExamBleedSectionRow[] = snap.sections.map((sec) => {
    const deltaMs = sec.elapsedMs - sec.budgetMs;
    const roundedDeltaMins = Math.round(deltaMs / 60_000);
    const status: ExamBleedSectionRow['status'] =
      roundedDeltaMins > 0
        ? 'bleed'
        : roundedDeltaMins < 0
          ? 'starved'
          : 'on-target';
    return {
      id: sec.id,
      label: sec.label,
      color: sec.color,
      targetMs: sec.budgetMs,
      actualMs: sec.elapsedMs,
      deltaMs,
      status,
      visits: sec.visits,
    };
  });

  const visitLog: ExamVisitSummaryItem[] = state.visitLog
    .map((entry) => {
      const endedAt = entry.endedAt ?? completedAt;
      const cfg = sectionMap.get(entry.sectionId);
      return {
        sectionId: entry.sectionId,
        label: cfg?.label || entry.sectionId,
        color: cfg?.color || 'var(--ac)',
        startedAt: entry.startedAt,
        endedAt,
        durationMs: Math.max(0, endedAt - entry.startedAt),
      };
    })
    .filter((v) => v.durationMs >= 0);

  return {
    id: state.id || `exam_${completedAt.toString(36)}`,
    completedAt,
    totalDurationMins: state.totalDurationMins,
    totalElapsedMs: snap.totalElapsedMs,
    switchCount: state.switchCount,
    sections,
    visitLog,
  };
}

export function finishExamClock(
  state: ExamClockState,
  now: number = Date.now()
): { nextState: ExamClockState; record: ExamPaceRecord } {
  const nextAccumulated = { ...state.accumulatedMs };
  if (
    state.status === 'running' &&
    state.activeSectionId &&
    state.activeSegmentStartedAt !== null
  ) {
    const delta = Math.max(0, now - state.activeSegmentStartedAt);
    nextAccumulated[state.activeSectionId] =
      (nextAccumulated[state.activeSectionId] || 0) + delta;
  }

  const closedVisitLog = state.visitLog.map((entry) =>
    entry.endedAt === null
      ? {
          ...entry,
          endedAt: state.status === 'paused' && state.pausedAt ? state.pausedAt : now,
        }
      : { ...entry }
  );

  const nextState: ExamClockState = {
    ...state,
    status: 'finished',
    finishedAt: now,
    pausedAt: null,
    activeSegmentStartedAt: null,
    accumulatedMs: nextAccumulated,
    visitLog: closedVisitLog,
  };

  const record = buildExamPaceRecord(nextState, now);
  return { nextState, record };
}

function pad2(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(2, '0');
}

export function formatExamClockMs(
  ms: number,
  opts?: { hideSeconds?: boolean; forceHours?: boolean }
): string {
  const safeMs = Math.max(0, ms);
  const totalSec = Math.floor(safeMs / 1000);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (opts?.hideSeconds) {
    return `${pad2(hrs)}:${pad2(mins)}`;
  }
  if (hrs > 0 || opts?.forceHours) {
    return `${pad2(hrs)}:${pad2(mins)}:${pad2(secs)}`;
  }
  return `${pad2(mins)}:${pad2(secs)}`;
}

export function formatExamSectionDisplay(
  remainingMs: number,
  overtimeMs: number,
  opts?: { hideSeconds?: boolean }
): string {
  if (overtimeMs > 0) {
    return `+${formatExamClockMs(overtimeMs, { hideSeconds: opts?.hideSeconds })} over`;
  }
  return formatExamClockMs(remainingMs, { hideSeconds: opts?.hideSeconds });
}

export function formatBleedDelta(deltaMs: number): string {
  const mins = Math.round(deltaMs / 60_000);
  if (mins > 0) return `+${mins}m bleed`;
  if (mins < 0) return `${mins}m starved`;
  return 'On target';
}

export function formatBleedMinutes(ms: number): string {
  const totalMins = Math.round(Math.max(0, ms) / 60_000);
  if (totalMins === 0 && ms > 0) {
    const secs = Math.max(1, Math.round(ms / 1000));
    return `${secs}s`;
  }
  return `${totalMins}m`;
}

export function formatExamRecordNote(record: ExamPaceRecord): string {
  const parts = record.sections.map(
    (s) =>
      `${s.label} ${formatBleedMinutes(s.actualMs)}/${Math.round(
        s.targetMs / 60_000
      )}m (${formatBleedDelta(s.deltaMs)})`
  );
  return `Chess-Clock splits (${record.switchCount} switches): ${parts.join(' · ')}`;
}

/**
 * Fires three warm unmistakable low felt thuds (98 -> 78 Hz + 700 Hz LPF felt
 * transient) via audioEngine's master bus, rate-limited to once per 20s per
 * section, paired with [40, 60, 40, 60, 80] haptics.
 */
export function playExamOvertimeAlert(
  soundEnabled: boolean,
  sectionId?: string
): void {
  playSoundCue('examOvertime', soundEnabled, { sectionId });
}

/* ── Strict Local-Only Storage Helpers (Zero Firestore Schema Changes) ── */

interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

function getSafeStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // ignore
  }
  return null;
}

export function loadActiveExamClockState(storage?: StorageLike): ExamClockState | null {
  const store = getSafeStorage(storage);
  if (!store) return null;
  try {
    const raw = store.getItem(ACTIVE_EXAM_STORAGE_KEY);
    if (!raw) return null;
    const parsed = safeJsonParse<Partial<ExamClockState> | null>(raw, null);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray(parsed.sections) ||
      (parsed.status !== 'running' && parsed.status !== 'paused')
    ) {
      return null;
    }
    return {
      ...createInitialExamClockState(),
      ...parsed,
      accumulatedMs: {
        ...emptySectionNumbers(),
        ...(parsed.accumulatedMs || {}),
      },
      visitCounts: {
        ...emptySectionNumbers(),
        ...(parsed.visitCounts || {}),
      },
      overtimeAlerted: {
        ...emptySectionBooleans(),
        ...(parsed.overtimeAlerted || {}),
      },
      visitLog: Array.isArray(parsed.visitLog) ? parsed.visitLog : [],
    };
  } catch {
    return null;
  }
}

export function saveActiveExamClockState(
  state: ExamClockState,
  storage?: StorageLike
): void {
  const store = getSafeStorage(storage);
  if (!store) return;
  if (state.status === 'running' || state.status === 'paused') {
    safeLocalStorageSet(ACTIVE_EXAM_STORAGE_KEY, JSON.stringify(state), store);
  } else {
    safeLocalStorageRemove(ACTIVE_EXAM_STORAGE_KEY, store);
  }
}

export function clearActiveExamClockState(storage?: StorageLike): void {
  const store = getSafeStorage(storage);
  if (!store) return;
  safeLocalStorageRemove(ACTIVE_EXAM_STORAGE_KEY, store);
}

export function loadExamPaceRecords(storage?: StorageLike): ExamPaceRecord[] {
  const store = getSafeStorage(storage);
  if (!store) return [];
  try {
    const raw = store.getItem(EXAM_PACE_HISTORY_KEY);
    if (!raw) return [];
    const parsed = safeJsonParse<unknown>(raw, null);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is ExamPaceRecord =>
        Boolean(r && typeof r === 'object' && typeof r.id === 'string' && Array.isArray(r.sections))
    );
  } catch {
    return [];
  }
}

export function saveExamPaceRecord(
  record: ExamPaceRecord,
  storage?: StorageLike
): ExamPaceRecord[] {
  const store = getSafeStorage(storage);
  const existing = loadExamPaceRecords(storage);
  const next = [record, ...existing.filter((r) => r.id !== record.id)].slice(
    0,
    MAX_LOCAL_PACE_RECORDS
  );
  if (store) {
    safeLocalStorageSet(EXAM_PACE_HISTORY_KEY, JSON.stringify(next), store);
  }
  return next;
}
