import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import type {
  GroupHistoryMap,
  GroupSharingFlags,
  GroupWeekHistoryEntry,
  PulseHabitState,
} from '../types';
import {
  auth,
  db,
  ensureValidAuthToken,
  handleFirestoreError,
  isOfflineOrTokenError,
  OperationType,
  sanitizeForFirestore,
} from './cloudSync';
import {
  computeConsistencyScore,
  computeMinDayStreak,
  getWeekStartKey,
} from './insights';
import { addD, computeMockScore, isManualStudySession } from './studyLogic';
import { computeXpByDay, computeTotalXp } from './xp';
import {
  createCooldownGuard,
  isDangerousKey,
  safeJsonParse,
  safeLocalStorageGet,
  safeLocalStorageRemove,
  safeLocalStorageSet,
} from './security.ts';

export const GROUP_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const MAX_JOINED_GROUPS = 3;
export const DEFAULT_GROUP_MEMBER_CAP = 30;
export const MAX_GROUP_MEMBER_CAP = 50;
export const GROUP_WRITE_DAILY_CAP = 60;
export const GROUP_READ_DAILY_CAP = 150;
export const GROUP_CHEER_DAILY_CAP = 10;
export const GROUP_PUBLISH_DEBOUNCE_MS = 6_000; // 6 seconds debounce for fast live/stat updates
export const GROUP_PUBLISH_MIN_INTERVAL_MS = 10_000; // 10 seconds minimum interval per group
export const GROUP_CACHE_STALE_MS = 5 * 60_000; // 5 minutes
export const GROUP_AUTO_REFRESH_MS = 3 * 60_000; // legacy constant kept for exports
export const GROUP_MANUAL_REFRESH_COOLDOWN_MS = 60_000; // 60 seconds
export const GROUP_LIVE_DURATION_MS = 60 * 60_000; // 60 minutes (legacy read fallback)
export const GROUP_LIVE_REFRESH_MS = 45 * 60_000; // legacy constant kept for exports
export const GROUP_LIVE_PAUSE_CLEAR_MS = 6_000; // 6 seconds
export const GROUP_LIVE_FETCH_MAX_AGE_MS = 15 * 60_000; // 15 minutes (legacy live fallback)

/** Spark-quota-safe Zero-Chat Live Co-Study Aura constants (v29) */
export const LIVE_AURA_START_DEBOUNCE_MS = 15_000; // 15s debounce skips accidental start-cancel taps
export const LIVE_AURA_MAX_AGE_MS = 6 * 60 * 60_000; // 6h stale guard (21,600,000 ms)
export const LIVE_AURA_MAX_FUTURE_MS = 5 * 60_000; // 5m future-clock guard
export const LIVE_AURA_PRIVACY_STORAGE_KEY = 'dh_live_aura_enabled_v1';

export type CheerEmoji = '👏' | '🔥' | '💪';
export const ALLOWED_CHEER_EMOJIS: readonly CheerEmoji[] = ['👏', '🔥', '💪'];

export interface GroupGoal {
  weeklyMinutes: number;
  updatedAt: number;
}

export interface GroupLiveStatus {
  since: number;
  until: number;
}

export interface ActiveSessionAura {
  startedAt: number;
  subjectLabel: string;
  subjectColor: string;
}

export interface GroupMockEntry {
  d: string;
  s: number;
  m: number;
}

export interface MemberEntry {
  nick: string;
  emoji: string;
  examYear?: number;
  joinedAt: number;
  updatedAt: number;
  sh: GroupSharingFlags;
  paused?: boolean;
  days?: Record<string, number>;
  xpDays?: Record<string, number>;
  xpTotal?: number;
  streak?: number;
  consistency?: number;
  mocks?: GroupMockEntry[];
  live?: GroupLiveStatus | null;
  activeSession?: ActiveSessionAura | null;
  weeks?: Record<string, GroupWeekHistoryEntry>;
}

export interface GroupDoc {
  name: string;
  emoji: string;
  ownerUid: string;
  createdAt: number;
  updatedAt: number;
  memberCap: number;
  mockBoard: boolean;
  goal?: GroupGoal;
  members: Record<string, MemberEntry>;
}

export interface CachedGroupSnapshot {
  groupId: string;
  doc: GroupDoc;
  fetchedAt: number;
  receivedCheers: CheerDoc[];
}

export interface CheerDoc {
  id: string;
  from: string;
  to: string;
  fromNick: string;
  dayKey: string;
  e: CheerEmoji;
  ts: number;
}

export interface RankedMemberRow {
  uid: string;
  entry: MemberEntry;
  rank: number | null; // null when hidden / not shared
  hidden: boolean;
  primaryValue: number;
  secondaryValue: number;
  displayLabel: string;
  subLabel?: string;
  medals: { gold: number; silver: number; bronze: number };
}

export type MockSortMode = 'latest' | 'best' | 'avg5';
export type XpSortMode = 'weekly' | 'allTime';

const GROUP_CACHE_STORAGE_KEY = 'dh_groups_cache_v1';
const GROUP_BUDGET_STORAGE_KEY = 'dh_groups_budget_v1';

export const DEFAULT_SHARING_FLAGS: GroupSharingFlags = {
  t: true,
  x: true,
  s: true,
  m: false,
  l: false,
};

/**
 * Validates a user nickname:
 * - trimmed length 2..20 chars
 * - rejects '@' (to prevent email addresses)
 * - rejects 7 or more digits (to prevent phone numbers)
 */
export function validateNickname(raw: string): {
  valid: boolean;
  cleaned: string;
  error?: string;
} {
  const cleaned = String(raw ?? '')
    .replace(/[\u0000-\u001F\u007F<>]/g, '')
    .trim();
  if (cleaned.length < 2) {
    return { valid: false, cleaned, error: 'Nickname must be at least 2 characters.' };
  }
  if (cleaned.length > 20) {
    return { valid: false, cleaned: cleaned.slice(0, 20), error: 'Nickname cannot exceed 20 characters.' };
  }
  if (cleaned.includes('@')) {
    return { valid: false, cleaned, error: 'Do not use @ or email addresses in your nickname.' };
  }
  const digitCount = (cleaned.match(/\d/g) || []).length;
  if (digitCount >= 7) {
    return { valid: false, cleaned, error: 'Do not include phone numbers (7+ digits) in your nickname.' };
  }
  return { valid: true, cleaned };
}

/**
 * Generates a 10-character random group ID from the unambiguous alphabet
 * ABCDEFGHJKLMNPQRSTUVWXYZ23456789 using crypto.getRandomValues.
 */
export function generateGroupId(): string {
  const bytes = new Uint8Array(10);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 10; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let code = '';
  for (let i = 0; i < 10; i++) {
    code += GROUP_CODE_ALPHABET[bytes[i] % GROUP_CODE_ALPHABET.length];
  }
  return code;
}

/**
 * Normalizes a user-typed invite code (e.g. "abcd2-34567" -> "ABCD234567").
 */
export function normalizeGroupCode(raw: string): string {
  return String(raw ?? '')
    .toUpperCase()
    .replace(/[\s\-]/g, '');
}

/**
 * Checks whether a normalized group ID matches the 10-char unambiguous alphabet.
 */
export function isValidGroupCode(code: string): boolean {
  return /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/.test(code);
}

/**
 * Formats a 10-character group ID as XXXXX-XXXXX for display.
 */
export function formatGroupCode(code: string): string {
  const clean = normalizeGroupCode(code);
  if (clean.length !== 10) return clean;
  return `${clean.slice(0, 5)}-${clean.slice(5, 10)}`;
}

/**
 * Deterministic cheer document ID: dayKey + "_" + fromUid + "_" + toUid
 */
export function makeCheerId(dayKey: string, fromUid: string, toUid: string): string {
  return `${dayKey}_${fromUid}_${toUid}`;
}

function clampInt(val: unknown, min: number, max: number, fallback = min): number {
  const n = Math.floor(Number(val));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function sanitizePlainText(val: unknown, maxLen: number, fallback = ''): string {
  if (typeof val !== 'string') return fallback;
  const cleaned = val.replace(/[\u0000-\u001F\u007F<>]/g, '').trim();
  return cleaned ? cleaned.slice(0, maxLen) : fallback;
}

function isValidDayKey(dk: unknown): dk is string {
  return typeof dk === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dk);
}

/**
 * Returns the 21-day cutoff key (inclusive lower bound: todayKey - 20 days,
 * and defensive reader accepts up to todayKey - 21 days for timezone tolerance).
 */
export function get21DayMinKey(todayKey: string): string {
  return addD(todayKey, -20);
}

/**
 * Defensive client parser for a remote MemberEntry.
 * Enforces Rule 7:
 * - ignores keys that are not valid dayKeys or are older than 21 days
 * - clamps minutes 0..1440/day, XP 0..3000/day, xpTotal 0..10,000,000,
 *   streak 0..3650, consistency 0..100, mock score -1000..1000, maxMarks 1..2000
 * - limits nicknames to 20 chars plain text
 */
export function sanitizeRemoteMemberEntry(
  raw: unknown,
  todayKey: string
): MemberEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;

  const nick = sanitizePlainText(rec.nick, 20, 'Student');
  if (nick.length < 1) return null;
  const emoji = sanitizePlainText(rec.emoji, 8, '🩺');
  const joinedAt = Number.isFinite(rec.joinedAt) && Number(rec.joinedAt) > 0
    ? Math.floor(Number(rec.joinedAt))
    : 0;
  const updatedAt = Number.isFinite(rec.updatedAt) && Number(rec.updatedAt) > 0
    ? Math.floor(Number(rec.updatedAt))
    : joinedAt;

  const rawSh = rec.sh && typeof rec.sh === 'object' ? (rec.sh as Record<string, unknown>) : {};
  const sh: GroupSharingFlags = {
    t: rawSh.t !== undefined ? Boolean(rawSh.t) : true,
    x: rawSh.x !== undefined ? Boolean(rawSh.x) : true,
    s: rawSh.s !== undefined ? Boolean(rawSh.s) : true,
    m: rawSh.m !== undefined ? Boolean(rawSh.m) : false,
    l: rawSh.l !== undefined ? Boolean(rawSh.l) : false,
  };

  const paused = Boolean(rec.paused);
  const rawExamYear = Number(rec.examYear);
  const examYear =
    Number.isFinite(rawExamYear) && rawExamYear >= 2020 && rawExamYear <= 2035
      ? Math.floor(rawExamYear)
      : undefined;

  const minAllowedDayKey = addD(todayKey, -20);
  const maxAllowedDayKey = addD(todayKey, 1);

  const days: Record<string, number> = {};
  if (rec.days && typeof rec.days === 'object' && !Array.isArray(rec.days)) {
    for (const [dk, v] of Object.entries(rec.days as Record<string, unknown>)) {
      if (!isValidDayKey(dk)) continue;
      if (dk < minAllowedDayKey || dk > maxAllowedDayKey) continue;
      if (typeof v !== 'number' && typeof v !== 'string') continue;
      const num = Number(v);
      if (!Number.isFinite(num)) continue;
      days[dk] = clampInt(num, 0, 960, 0);
    }
  }

  const xpDays: Record<string, number> = {};
  if (rec.xpDays && typeof rec.xpDays === 'object' && !Array.isArray(rec.xpDays)) {
    for (const [dk, v] of Object.entries(rec.xpDays as Record<string, unknown>)) {
      if (!isValidDayKey(dk)) continue;
      if (dk < minAllowedDayKey || dk > maxAllowedDayKey) continue;
      if (typeof v !== 'number' && typeof v !== 'string') continue;
      const num = Number(v);
      if (!Number.isFinite(num)) continue;
      xpDays[dk] = clampInt(num, 0, 2000, 0);
    }
  }

  const xpTotal =
    rec.xpTotal !== undefined && Number.isFinite(Number(rec.xpTotal))
      ? clampInt(rec.xpTotal, 0, 10_000_000, 0)
      : undefined;

  const streak =
    rec.streak !== undefined && Number.isFinite(Number(rec.streak))
      ? clampInt(rec.streak, 0, 3650, 0)
      : undefined;

  const consistency =
    rec.consistency !== undefined && Number.isFinite(Number(rec.consistency))
      ? clampInt(rec.consistency, 0, 100, 0)
      : undefined;

  const mocks: GroupMockEntry[] = [];
  if (Array.isArray(rec.mocks)) {
    for (const item of rec.mocks) {
      if (!item || typeof item !== 'object') continue;
      const mRec = item as Record<string, unknown>;
      if (!isValidDayKey(mRec.d)) continue;
      const sNum = Number(mRec.s);
      const mNum = Number(mRec.m);
      if (!Number.isFinite(sNum) || !Number.isFinite(mNum)) continue;
      mocks.push({
        d: mRec.d,
        s: clampInt(sNum, -1000, 1000, 0),
        m: clampInt(mNum, 1, 2000, 720),
      });
      if (mocks.length >= 10) break;
    }
  }

  let live: GroupLiveStatus | null = null;
  if (rec.live && typeof rec.live === 'object' && !Array.isArray(rec.live)) {
    const lRec = rec.live as Record<string, unknown>;
    const since = Number(lRec.since);
    const until = Number(lRec.until);
    if (Number.isFinite(since) && Number.isFinite(until) && since > 0 && until > since) {
      live = {
        since: Math.floor(since),
        until: Math.floor(until),
      };
    }
  }

  const activeSession = sanitizeActiveSessionAura(rec.activeSession);

  const weeks: Record<string, GroupWeekHistoryEntry> = {};
  if (rec.weeks && typeof rec.weeks === 'object' && !Array.isArray(rec.weeks)) {
    const entries: Array<[string, GroupWeekHistoryEntry]> = [];
    for (const [wk, wVal] of Object.entries(rec.weeks as Record<string, unknown>)) {
      if (!isValidDayKey(wk) || !wVal || typeof wVal !== 'object') continue;
      const wRec = wVal as Record<string, unknown>;
      const rank = clampInt(wRec.rank, 1, 50, 1);
      const of = clampInt(wRec.of, rank, 50, rank);
      const minutes = clampInt(wRec.minutes, 0, 10080, 0);
      const xp = clampInt(wRec.xp, 0, 50000, 0);
      entries.push([wk, { rank, of, minutes, xp }]);
    }
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    for (const [wk, wEntry] of entries.slice(-12)) {
      weeks[wk] = wEntry;
    }
  }

  return {
    nick,
    emoji,
    ...(examYear !== undefined ? { examYear } : {}),
    joinedAt,
    updatedAt,
    sh,
    ...(paused ? { paused: true } : {}),
    ...(sh.t && !paused ? { days } : {}),
    ...(sh.x && !paused ? { xpDays, xpTotal: xpTotal ?? 0 } : {}),
    ...(sh.s && !paused ? { streak: streak ?? 0, consistency: consistency ?? 0 } : {}),
    ...(sh.m && !paused ? { mocks } : {}),
    ...(sh.l && !paused && live ? { live } : {}),
    ...(sh.l && !paused && activeSession ? { activeSession } : {}),
    ...(Object.keys(weeks).length > 0 ? { weeks } : {}),
  };
}

/**
 * Defensive client parser for a remote GroupDoc.
 */
export function sanitizeRemoteGroupDoc(
  raw: unknown,
  todayKey: string
): GroupDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;

  const name = sanitizePlainText(rec.name, 32, 'Study Group');
  const emoji = sanitizePlainText(rec.emoji, 8, '🩺');
  const ownerUid = typeof rec.ownerUid === 'string' ? rec.ownerUid.trim() : '';
  if (!ownerUid) return null;

  const createdAt = Number.isFinite(rec.createdAt) ? Math.floor(Number(rec.createdAt)) : 0;
  const updatedAt = Number.isFinite(rec.updatedAt) ? Math.floor(Number(rec.updatedAt)) : createdAt;
  const memberCap = clampInt(rec.memberCap, 2, MAX_GROUP_MEMBER_CAP, DEFAULT_GROUP_MEMBER_CAP);
  const mockBoard = Boolean(rec.mockBoard);

  let goal: GroupGoal | undefined;
  if (rec.goal && typeof rec.goal === 'object') {
    const gRec = rec.goal as Record<string, unknown>;
    const wm = Number(gRec.weeklyMinutes);
    if (Number.isFinite(wm) && wm >= 60 && wm <= 300_000) {
      goal = {
        weeklyMinutes: Math.floor(wm),
        updatedAt: Number.isFinite(gRec.updatedAt) ? Math.floor(Number(gRec.updatedAt)) : updatedAt,
      };
    }
  }

  const members: Record<string, MemberEntry> = {};
  if (rec.members && typeof rec.members === 'object' && !Array.isArray(rec.members)) {
    const rawMembers = Object.entries(rec.members as Record<string, unknown>);
    for (const [uid, mVal] of rawMembers.slice(0, MAX_GROUP_MEMBER_CAP)) {
      if (
        typeof uid !== 'string' ||
        !uid.trim() ||
        uid.length > 128 ||
        uid === '__proto__' ||
        uid === 'constructor' ||
        uid === 'prototype'
      ) {
        continue;
      }
      const sanitized = sanitizeRemoteMemberEntry(mVal, todayKey);
      if (sanitized) {
        members[uid] = sanitized;
      }
    }
  }

  return {
    name,
    emoji,
    ownerUid,
    createdAt,
    updatedAt,
    memberCap,
    mockBoard,
    ...(goal ? { goal } : {}),
    members,
  };
}

/**
 * Builds the current user's MemberEntry to publish to a group.
 * - Prunes days and xpDays to the last 21 logical days
 * - Counts only timer-tracked study sessions (manual sessions give 0 group time)
 * - Uses XP v2 per day and total XP
 * - Omits any field whose sharing flag is false
 * - When paused: true, publishes only { nick, emoji, examYear?, joinedAt, updatedAt, sh, paused: true }
 */
export function buildMyMemberEntry(
  state: PulseHabitState,
  todayKey: string,
  options: {
    joinedAt: number;
    sh: GroupSharingFlags;
    paused?: boolean;
    live?: GroupLiveStatus | null;
    activeSession?: ActiveSessionAura | null;
    groupId?: string;
    existingWeeks?: Record<string, GroupWeekHistoryEntry>;
    now?: number;
  }
): MemberEntry {
  const now = options.now ?? Date.now();
  const nickCheck = validateNickname(state.profile?.nick || '');
  const nick = nickCheck.valid
    ? nickCheck.cleaned
    : sanitizePlainText(
        (state.profile?.nick || '').replace(/@+/g, ''),
        20,
        'Aspirant'
      );
  const emoji = sanitizePlainText(
    state.profile?.emoji || state.set?.avatarEmoji || '🩺',
    8,
    '🩺'
  );
  const examYear = state.profile?.examYear;
  const joinedAt = options.joinedAt > 0 ? Math.floor(options.joinedAt) : now;
  const sh: GroupSharingFlags = {
    t: Boolean(options.sh.t),
    x: Boolean(options.sh.x),
    s: Boolean(options.sh.s),
    m: Boolean(options.sh.m),
    l: Boolean(options.sh.l),
  };

  if (options.paused) {
    return {
      nick,
      emoji,
      ...(examYear !== undefined ? { examYear } : {}),
      joinedAt,
      updatedAt: now,
      sh,
      paused: true,
    };
  }

  const minDayKey = get21DayMinKey(todayKey);

  // 1. Study time (last 21 days, timer-tracked sessions only)
  const days: Record<string, number> = {};
  if (sh.t) {
    const dayMsMap: Record<string, number> = {};
    for (const ses of state.sessions || []) {
      if (!ses || !isValidDayKey(ses.dayKey)) continue;
      if (ses.dayKey < minDayKey || ses.dayKey > todayKey) continue;
      if (isManualStudySession(ses)) continue;
      dayMsMap[ses.dayKey] = (dayMsMap[ses.dayKey] || 0) + Math.max(0, Number(ses.activeMs) || 0);
    }
    for (const [dk, ms] of Object.entries(dayMsMap)) {
      const mins = clampInt(Math.floor(ms / 60000), 0, 960, 0);
      if (mins > 0) {
        days[dk] = mins;
      }
    }
  }

  // 2. XP v2 (last 21 days + total XP)
  const xpDays: Record<string, number> = {};
  let xpTotal = 0;
  if (sh.x) {
    const byDay = computeXpByDay(state);
    for (const [dk, entry] of Object.entries(byDay)) {
      if (dk > todayKey) continue;
      if (dk >= minDayKey && entry.total > 0) {
        xpDays[dk] = clampInt(entry.total, 0, 2000, 0);
      }
    }
    xpTotal = clampInt(computeTotalXp(state, todayKey), 0, 10_000_000, 0);
  }

  // 3. Streak & Consistency
  let streak = 0;
  let consistency = 0;
  if (sh.s) {
    const streakInfo = computeMinDayStreak(state, todayKey);
    streak = clampInt(streakInfo.streak, 0, 3650, 0);
    const consInfo = computeConsistencyScore(state, todayKey);
    consistency = clampInt(consInfo.totalScore ?? 0, 0, 100, 0);
  }

  // 4. Mocks (last 10 mocks)
  const mocks: GroupMockEntry[] = [];
  if (sh.m) {
    const sortedMocks = [...(state.mocks || [])]
      .filter((m) => m && isValidDayKey(m.dayKey))
      .sort((a, b) => a.dayKey.localeCompare(b.dayKey) || (a.updatedAt || 0) - (b.updatedAt || 0))
      .slice(-10);

    for (const m of sortedMocks) {
      const scoreInfo = computeMockScore(m, state.subjects);
      mocks.push({
        d: m.dayKey,
        s: clampInt(scoreInfo.totalScore, -1000, 1000, 0),
        m: clampInt(m.maxMarks || 720, 1, 2000, 720),
      });
    }
  }

  // 5. Weeks history (up to 12 weeks)
  const weeksMap: Record<string, GroupWeekHistoryEntry> = {};
  const mergedRawWeeks = {
    ...(options.existingWeeks || {}),
    ...(options.groupId && state.groupHistory?.[options.groupId]
      ? state.groupHistory[options.groupId]
      : {}),
  };
  const sortedWeekKeys = Object.keys(mergedRawWeeks)
    .filter(isValidDayKey)
    .sort()
    .slice(-12);
  for (const wk of sortedWeekKeys) {
    const w = mergedRawWeeks[wk];
    if (w) {
      weeksMap[wk] = {
        rank: clampInt(w.rank, 1, 50, 1),
        of: clampInt(w.of, 1, 50, 1),
        minutes: clampInt(w.minutes, 0, 10080, 0),
        xp: clampInt(w.xp, 0, 50000, 0),
      };
    }
  }

  // 6. Live studying status (legacy `live` + v29 zero-heartbeat `activeSession`)
  const live =
    sh.l && options.live && options.live.until > now
      ? {
          since: Math.floor(options.live.since),
          until: Math.floor(options.live.until),
        }
      : undefined;

  const sanitizedActiveSession =
    sh.l && options.activeSession
      ? sanitizeActiveSessionAura(options.activeSession)
      : null;

  return {
    nick,
    emoji,
    ...(examYear !== undefined ? { examYear } : {}),
    joinedAt,
    updatedAt: now,
    sh,
    ...(sh.t ? { days } : {}),
    ...(sh.x ? { xpDays, xpTotal } : {}),
    ...(sh.s ? { streak, consistency } : {}),
    ...(sh.m ? { mocks } : {}),
    ...(live ? { live } : {}),
    activeSession: sanitizedActiveSession,
    ...(Object.keys(weeksMap).length > 0 ? { weeks: weeksMap } : {}),
  };
}

/**
 * Computes a deterministic string hash of a MemberEntry (excluding updatedAt)
 * so we can skip Firestore writes when nothing meaningful has changed.
 */
export function hashMemberEntry(entry: MemberEntry): string {
  const clone: Record<string, unknown> = { ...entry };
  delete clone.updatedAt;
  const stableStringify = (val: unknown): string => {
    if (val === null || typeof val !== 'object') return JSON.stringify(val);
    if (Array.isArray(val)) return `[${val.map(stableStringify).join(',')}]`;
    const keys = Object.keys(val as Record<string, unknown>).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableStringify((val as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  };
  return stableStringify(clone);
}

/**
 * Computes medal counts (gold/silver/bronze) from a member's weeks history.
 */
export function computeMemberMedals(entry: MemberEntry): {
  gold: number;
  silver: number;
  bronze: number;
} {
  let gold = 0;
  let silver = 0;
  let bronze = 0;
  if (entry.weeks && typeof entry.weeks === 'object') {
    for (const w of Object.values(entry.weeks)) {
      if (!w) continue;
      if (w.rank === 1) gold += 1;
      else if (w.rank === 2) silver += 1;
      else if (w.rank === 3) bronze += 1;
    }
  }
  return { gold, silver, bronze };
}

export function sumMemberRange(
  map: Record<string, number> | undefined,
  startKey: string,
  endKey: string
): number {
  if (!map) return 0;
  let total = 0;
  for (const [dk, val] of Object.entries(map)) {
    if (dk >= startKey && dk <= endKey) {
      total += Math.max(0, Number(val) || 0);
    }
  }
  return total;
}

export function formatMinutesAsHoursMins(mins: number): string {
  const safe = Math.max(0, Math.floor(mins));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Standard tie-breaker: higher time -> higher XP -> alphabetical nickname.
 */
function breakTiesByTimeXpNick(
  a: { time: number; xp: number; nick: string },
  b: { time: number; xp: number; nick: string }
): number {
  if (b.time !== a.time) return b.time - a.time;
  if (b.xp !== a.xp) return b.xp - a.xp;
  return a.nick.localeCompare(b.nick, undefined, { sensitivity: 'base' });
}

/**
 * Ranks members for the "Today" tab.
 */
export function rankTodayBoard(
  members: Record<string, MemberEntry>,
  todayKey: string
): RankedMemberRow[] {
  const visible: Array<RankedMemberRow & { tieTime: number; tieXp: number }> = [];
  const hidden: RankedMemberRow[] = [];

  for (const [uid, entry] of Object.entries(members)) {
    const isHidden = Boolean(entry.paused || !entry.sh?.t);
    const todayMins = isHidden ? 0 : clampInt(entry.days?.[todayKey] || 0, 0, 1440, 0);
    const todayXp = entry.paused || !entry.sh?.x ? 0 : clampInt(entry.xpDays?.[todayKey] || 0, 0, 3000, 0);
    const medals = computeMemberMedals(entry);

    if (isHidden) {
      hidden.push({
        uid,
        entry,
        rank: null,
        hidden: true,
        primaryValue: 0,
        secondaryValue: 0,
        displayLabel: 'hidden',
        medals,
      });
    } else {
      visible.push({
        uid,
        entry,
        rank: 1,
        hidden: false,
        primaryValue: todayMins,
        secondaryValue: todayXp,
        displayLabel: formatMinutesAsHoursMins(todayMins),
        subLabel: entry.sh?.x ? `${todayXp} XP today` : undefined,
        medals,
        tieTime: todayMins,
        tieXp: todayXp,
      });
    }
  }

  visible.sort((a, b) =>
    breakTiesByTimeXpNick(
      { time: a.tieTime, xp: a.tieXp, nick: a.entry.nick },
      { time: b.tieTime, xp: b.tieXp, nick: b.entry.nick }
    )
  );
  hidden.sort((a, b) => a.entry.nick.localeCompare(b.entry.nick));

  visible.forEach((row, idx) => {
    row.rank = idx + 1;
  });

  return [...visible, ...hidden];
}

/**
 * Ranks members for the "Week" tab (Monday..Sun logical week).
 */
export function rankWeekBoard(
  members: Record<string, MemberEntry>,
  todayKey: string
): RankedMemberRow[] {
  const weekStart = getWeekStartKey(todayKey);
  const visible: Array<RankedMemberRow & { tieTime: number; tieXp: number }> = [];
  const hidden: RankedMemberRow[] = [];

  for (const [uid, entry] of Object.entries(members)) {
    const isHidden = Boolean(entry.paused || !entry.sh?.t);
    const weekMins = isHidden ? 0 : sumMemberRange(entry.days, weekStart, todayKey);
    const weekXp = entry.paused || !entry.sh?.x ? 0 : sumMemberRange(entry.xpDays, weekStart, todayKey);
    const medals = computeMemberMedals(entry);

    if (isHidden) {
      hidden.push({
        uid,
        entry,
        rank: null,
        hidden: true,
        primaryValue: 0,
        secondaryValue: 0,
        displayLabel: 'hidden',
        medals,
      });
    } else {
      visible.push({
        uid,
        entry,
        rank: 1,
        hidden: false,
        primaryValue: weekMins,
        secondaryValue: weekXp,
        displayLabel: formatMinutesAsHoursMins(weekMins),
        subLabel: entry.sh?.x ? `${weekXp} XP this wk` : undefined,
        medals,
        tieTime: weekMins,
        tieXp: weekXp,
      });
    }
  }

  visible.sort((a, b) =>
    breakTiesByTimeXpNick(
      { time: a.tieTime, xp: a.tieXp, nick: a.entry.nick },
      { time: b.tieTime, xp: b.tieXp, nick: b.entry.nick }
    )
  );
  hidden.sort((a, b) => a.entry.nick.localeCompare(b.entry.nick));

  visible.forEach((row, idx) => {
    row.rank = idx + 1;
  });

  return [...visible, ...hidden];
}

/**
 * Ranks members for the "XP" tab (Weekly or All-Time).
 */
export function rankXpBoard(
  members: Record<string, MemberEntry>,
  todayKey: string,
  mode: XpSortMode = 'weekly'
): RankedMemberRow[] {
  const weekStart = getWeekStartKey(todayKey);
  const visible: Array<RankedMemberRow & { tieTime: number; tieXp: number }> = [];
  const hidden: RankedMemberRow[] = [];

  for (const [uid, entry] of Object.entries(members)) {
    const isHidden = Boolean(entry.paused || !entry.sh?.x);
    const weekMins = entry.paused || !entry.sh?.t ? 0 : sumMemberRange(entry.days, weekStart, todayKey);
    const xpVal = isHidden
      ? 0
      : mode === 'weekly'
        ? sumMemberRange(entry.xpDays, weekStart, todayKey)
        : clampInt(entry.xpTotal || 0, 0, 10_000_000, 0);
    const level = Math.floor(Math.sqrt(Math.max(0, entry.xpTotal || 0) / 150)) + 1;
    const medals = computeMemberMedals(entry);

    if (isHidden) {
      hidden.push({
        uid,
        entry,
        rank: null,
        hidden: true,
        primaryValue: 0,
        secondaryValue: 0,
        displayLabel: 'hidden',
        medals,
      });
    } else {
      visible.push({
        uid,
        entry,
        rank: 1,
        hidden: false,
        primaryValue: xpVal,
        secondaryValue: weekMins,
        displayLabel: `${xpVal.toLocaleString()} XP`,
        subLabel: `Lv ${level}`,
        medals,
        tieTime: weekMins,
        tieXp: xpVal,
      });
    }
  }

  visible.sort((a, b) => {
    if (b.primaryValue !== a.primaryValue) return b.primaryValue - a.primaryValue;
    return breakTiesByTimeXpNick(
      { time: a.tieTime, xp: a.tieXp, nick: a.entry.nick },
      { time: b.tieTime, xp: b.tieXp, nick: b.entry.nick }
    );
  });
  hidden.sort((a, b) => a.entry.nick.localeCompare(b.entry.nick));

  visible.forEach((row, idx) => {
    row.rank = idx + 1;
  });

  return [...visible, ...hidden];
}

/**
 * Ranks members for the "Streak" tab (Milestone 2.4):
 * Ranked by consistency score (0-100), then current minimum-day streak, then tie-breakers.
 */
export function rankStreakBoard(
  members: Record<string, MemberEntry>,
  todayKey: string
): RankedMemberRow[] {
  const weekStart = getWeekStartKey(todayKey);
  const visible: Array<RankedMemberRow & { tieTime: number; tieXp: number }> = [];
  const hidden: RankedMemberRow[] = [];

  for (const [uid, entry] of Object.entries(members)) {
    const isHidden = Boolean(entry.paused || !entry.sh?.s);
    const consistency = isHidden ? 0 : clampInt(entry.consistency || 0, 0, 100, 0);
    const streak = isHidden ? 0 : clampInt(entry.streak || 0, 0, 3650, 0);
    const weekMins = entry.paused || !entry.sh?.t ? 0 : sumMemberRange(entry.days, weekStart, todayKey);
    const weekXp = entry.paused || !entry.sh?.x ? 0 : sumMemberRange(entry.xpDays, weekStart, todayKey);
    const medals = computeMemberMedals(entry);

    if (isHidden) {
      hidden.push({
        uid,
        entry,
        rank: null,
        hidden: true,
        primaryValue: 0,
        secondaryValue: 0,
        displayLabel: 'hidden',
        medals,
      });
    } else {
      const fireIcon = streak >= 7 ? ' 🔥' : '';
      visible.push({
        uid,
        entry,
        rank: 1,
        hidden: false,
        primaryValue: consistency,
        secondaryValue: streak,
        displayLabel: `${consistency}/100`,
        subLabel: `${streak}d streak${fireIcon}`,
        medals,
        tieTime: weekMins,
        tieXp: weekXp,
      });
    }
  }

  visible.sort((a, b) => {
    if (b.primaryValue !== a.primaryValue) return b.primaryValue - a.primaryValue;
    if (b.secondaryValue !== a.secondaryValue) return b.secondaryValue - a.secondaryValue;
    return breakTiesByTimeXpNick(
      { time: a.tieTime, xp: a.tieXp, nick: a.entry.nick },
      { time: b.tieTime, xp: b.tieXp, nick: b.entry.nick }
    );
  });
  hidden.sort((a, b) => a.entry.nick.localeCompare(b.entry.nick));

  visible.forEach((row, idx) => {
    row.rank = idx + 1;
  });

  return [...visible, ...hidden];
}

/**
 * Ranks members for the "Mocks" tab (Milestone 2.5):
 * Sort by latest, best, or average of last 5.
 * Members with sh.m === false or no mocks show "not shared" and are listed last.
 */
export function rankMocksBoard(
  members: Record<string, MemberEntry>,
  todayKey: string,
  sortMode: MockSortMode = 'latest'
): RankedMemberRow[] {
  const weekStart = getWeekStartKey(todayKey);
  const visible: Array<RankedMemberRow & { tieTime: number; tieXp: number }> = [];
  const hidden: RankedMemberRow[] = [];

  for (const [uid, entry] of Object.entries(members)) {
    const mocks = Array.isArray(entry.mocks) ? entry.mocks : [];
    const isNotShared = Boolean(entry.paused || !entry.sh?.m || mocks.length === 0);
    const medals = computeMemberMedals(entry);

    if (isNotShared) {
      hidden.push({
        uid,
        entry,
        rank: null,
        hidden: true,
        primaryValue: -9999,
        secondaryValue: 0,
        displayLabel: 'not shared',
        medals,
      });
      continue;
    }

    const sortedByDate = [...mocks].sort((a, b) => a.d.localeCompare(b.d));
    const latest = sortedByDate[sortedByDate.length - 1];
    const best = [...sortedByDate].sort(
      (a, b) => b.s / Math.max(1, b.m) - a.s / Math.max(1, a.m) || b.s - a.s
    )[0];
    const last5 = sortedByDate.slice(-5);
    const avg5Score = Math.round(
      last5.reduce((acc, item) => acc + item.s, 0) / last5.length
    );
    const avg5Max = Math.round(
      last5.reduce((acc, item) => acc + item.m, 0) / last5.length
    );

    let chosenScore = latest.s;
    let chosenMax = latest.m;
    let subNote = `Latest (${latest.d})`;

    if (sortMode === 'best') {
      chosenScore = best.s;
      chosenMax = best.m;
      subNote = `Best (${best.d})`;
    } else if (sortMode === 'avg5') {
      chosenScore = avg5Score;
      chosenMax = Math.max(1, avg5Max);
      subNote = `Avg of last ${last5.length}`;
    }

    const pct = Math.round((chosenScore / Math.max(1, chosenMax)) * 100);
    const weekMins = entry.sh?.t ? sumMemberRange(entry.days, weekStart, todayKey) : 0;
    const weekXp = entry.sh?.x ? sumMemberRange(entry.xpDays, weekStart, todayKey) : 0;

    visible.push({
      uid,
      entry,
      rank: 1,
      hidden: false,
      primaryValue: chosenScore,
      secondaryValue: pct,
      displayLabel: `${chosenScore} / ${chosenMax} (${pct}%)`,
      subLabel: subNote,
      medals,
      tieTime: weekMins,
      tieXp: weekXp,
    });
  }

  visible.sort((a, b) => {
    if (b.primaryValue !== a.primaryValue) return b.primaryValue - a.primaryValue;
    if (b.secondaryValue !== a.secondaryValue) return b.secondaryValue - a.secondaryValue;
    return breakTiesByTimeXpNick(
      { time: a.tieTime, xp: a.tieXp, nick: a.entry.nick },
      { time: b.tieTime, xp: b.tieXp, nick: b.entry.nick }
    );
  });
  hidden.sort((a, b) => a.entry.nick.localeCompare(b.entry.nick));

  visible.forEach((row, idx) => {
    row.rank = idx + 1;
  });

  return [...visible, ...hidden];
}

/**
 * Computes weekly group goal progress from combined week minutes of members sharing time.
 */
export function computeWeeklyGroupGoalProgress(
  group: GroupDoc,
  todayKey: string
): {
  hasGoal: boolean;
  targetMinutes: number;
  combinedMinutes: number;
  pct: number;
  reached: boolean;
} {
  const targetMinutes = group.goal?.weeklyMinutes ?? 0;
  if (!targetMinutes || targetMinutes < 60) {
    return {
      hasGoal: false,
      targetMinutes: 0,
      combinedMinutes: 0,
      pct: 0,
      reached: false,
    };
  }
  const weekStart = getWeekStartKey(todayKey);
  let combinedMinutes = 0;
  for (const entry of Object.values(group.members || {})) {
    if (!entry || entry.paused || !entry.sh?.t) continue;
    combinedMinutes += sumMemberRange(entry.days, weekStart, todayKey);
  }
  const pct = Math.min(100, Math.round((combinedMinutes / targetMinutes) * 100));
  return {
    hasGoal: true,
    targetMinutes,
    combinedMinutes,
    pct,
    reached: combinedMinutes >= targetMinutes,
  };
}

export function sanitizeActiveSessionAura(
  raw: unknown
): ActiveSessionAura | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const startedAt = Number(rec.startedAt);
  if (!Number.isFinite(startedAt) || startedAt <= 0) return null;
  const subjectLabel = sanitizePlainText(rec.subjectLabel, 40, '');
  if (!subjectLabel) return null;
  const rawColor =
    typeof rec.subjectColor === 'string' ? rec.subjectColor.trim() : '';
  const safeColor =
    /^#[0-9a-fA-F]{3,8}$/.test(rawColor) ||
    /^(?:rgb|hsl)a?\([0-9.,%\s]+\)$/.test(rawColor)
      ? rawColor.slice(0, 24)
      : '#F5C451';
  return {
    startedAt: Math.floor(startedAt),
    subjectLabel,
    subjectColor: safeColor,
  };
}

/**
 * Staleness protection for zero-heartbeat Live Co-Study Aura:
 * - Returns false if null/invalid
 * - Treats sessions older than 6 hours (`now - startedAt > 21_600_000`) as inactive
 * - Treats future timestamps > 5 minutes ahead (`startedAt - now > 300_000`) as inactive
 */
export function isLiveAuraActive(
  activeSession: ActiveSessionAura | null | undefined,
  now = Date.now()
): boolean {
  if (!activeSession) return false;
  const startedAt = Number(activeSession.startedAt);
  if (!Number.isFinite(startedAt) || startedAt <= 0) return false;
  if (now - startedAt > LIVE_AURA_MAX_AGE_MS) return false;
  if (startedAt - now > LIVE_AURA_MAX_FUTURE_MS) return false;
  return Boolean(
    typeof activeSession.subjectLabel === 'string' &&
      activeSession.subjectLabel.trim().length > 0
  );
}

export function formatLiveAuraElapsed(
  startedAt: number,
  now = Date.now()
): string {
  const diffMs = Math.max(0, now - startedAt);
  const totalMins = Math.floor(diffMs / 60_000);
  if (totalMins < 1) return '<1m';
  if (totalMins < 60) return `${totalMins}m`;
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function buildActiveSessionAuraPayload(params: {
  startedAt: number;
  mode?: string;
  subjectId?: string;
  subjectName?: string;
  subjectColor?: string;
  isExamHall?: boolean;
}): ActiveSessionAura {
  const startedAt = Math.max(1, Math.floor(params.startedAt || Date.now()));
  if (params.isExamHall) {
    return {
      startedAt,
      subjectLabel: 'Exam Hall',
      subjectColor: '#F5C451',
    };
  }
  const subNorm = String(params.subjectId || '').toLowerCase();
  const isAllSubjects =
    subNorm === 'sub_all_subjects' ||
    subNorm === 'sub_general' ||
    subNorm === 'all_subjects';
  if (params.mode === 'fullMock' && isAllSubjects) {
    return {
      startedAt,
      subjectLabel: 'Full Mock',
      subjectColor: '#F5C451',
    };
  }
  const cleanLabel = sanitizePlainText(
    params.subjectName || (params.mode === 'fullMock' ? 'Full Mock' : 'Deep Study'),
    40,
    'Deep Study'
  );
  const rawColor = (params.subjectColor || '').trim();
  const safeColor =
    /^#[0-9a-fA-F]{3,8}$/.test(rawColor) ? rawColor.slice(0, 24) : '#F5C451';
  return {
    startedAt,
    subjectLabel: cleanLabel,
    subjectColor: safeColor,
  };
}

export function loadLiveAuraPrivacyEnabled(
  storage?: Pick<Storage, 'getItem'>
): boolean {
  try {
    const store =
      storage || (typeof window !== 'undefined' ? window.localStorage : null);
    if (!store) return true;
    const raw = store.getItem(LIVE_AURA_PRIVACY_STORAGE_KEY);
    if (raw === null) return true;
    return raw !== '0' && raw !== 'false';
  } catch {
    return true;
  }
}

export function saveLiveAuraPrivacyEnabled(
  enabled: boolean,
  storage?: Pick<Storage, 'setItem'>
): void {
  try {
    const store =
      storage || (typeof window !== 'undefined' ? window.localStorage : null);
    if (!store) return;
    store.setItem(LIVE_AURA_PRIVACY_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // Ignore storage errors
  }
}

function areActiveAurasEqual(
  a: ActiveSessionAura | null,
  b: ActiveSessionAura | null
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.startedAt === b.startedAt &&
    a.subjectLabel === b.subjectLabel &&
    a.subjectColor === b.subjectColor
  );
}

/**
 * Spark-quota-safe zero-heartbeat Live Co-Study Aura controller:
 * - Debounces start writes by 15 seconds so quick start-cancel taps consume 0 writes.
 * - Publishes ONCE on confirmed session start and ONCE (`null`) on pause/stop/signout.
 * - Never schedules periodic keepalive/heartbeat writes while studying.
 * - Honors local privacy toggle (`setEnabled(false)` skips all writes & clears any published aura).
 */
export class LiveAuraPresenceController {
  private readonly debounceMs: number;
  private readonly onPublish: (aura: ActiveSessionAura | null) => void | Promise<void>;
  private readonly scheduleTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly cancelTimer: (id: ReturnType<typeof setTimeout>) => void;

  private enabled: boolean;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingAura: ActiveSessionAura | null = null;
  private publishedAura: ActiveSessionAura | null = null;

  constructor(opts: {
    debounceMs?: number;
    enabled?: boolean;
    onPublish: (aura: ActiveSessionAura | null) => void | Promise<void>;
    scheduleTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
    cancelTimer?: (id: ReturnType<typeof setTimeout>) => void;
  }) {
    this.debounceMs = opts.debounceMs ?? LIVE_AURA_START_DEBOUNCE_MS;
    this.enabled = opts.enabled ?? true;
    this.onPublish = opts.onPublish;
    this.scheduleTimer = opts.scheduleTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancelTimer = opts.cancelTimer ?? ((id) => clearTimeout(id));
  }

  private clearPending(): void {
    if (this.pendingTimer !== null) {
      this.cancelTimer(this.pendingTimer);
      this.pendingTimer = null;
    }
    this.pendingAura = null;
  }

  public getPublishedAura(): ActiveSessionAura | null {
    return this.publishedAura;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.clearPending();
      if (this.publishedAura !== null) {
        this.publishedAura = null;
        void this.onPublish(null);
      }
    }
  }

  public handleSessionChange(nextAura: ActiveSessionAura | null): void {
    if (!this.enabled) {
      this.clearPending();
      if (this.publishedAura !== null) {
        this.publishedAura = null;
        void this.onPublish(null);
      }
      return;
    }

    if (!nextAura) {
      this.clearPending();
      if (this.publishedAura !== null) {
        this.publishedAura = null;
        void this.onPublish(null);
      }
      return;
    }

    if (areActiveAurasEqual(this.publishedAura, nextAura)) {
      this.clearPending();
      return;
    }

    if (areActiveAurasEqual(this.pendingAura, nextAura) && this.pendingTimer !== null) {
      return;
    }

    this.clearPending();
    this.pendingAura = nextAura;
    this.pendingTimer = this.scheduleTimer(() => {
      this.pendingTimer = null;
      const toPublish = this.pendingAura;
      this.pendingAura = null;
      if (!this.enabled || !toPublish) return;
      if (areActiveAurasEqual(this.publishedAura, toPublish)) return;
      this.publishedAura = toPublish;
      void this.onPublish(toPublish);
    }, this.debounceMs);
  }

  public async clearImmediately(): Promise<void> {
    this.clearPending();
    if (this.publishedAura !== null) {
      this.publishedAura = null;
      await this.onPublish(null);
    }
  }

  public dispose(): void {
    this.clearPending();
  }
}

export interface StudyingNowMember {
  uid: string;
  nick: string;
  emoji: string;
  since: number;
  until: number;
  elapsedMins: number;
  elapsedLabel: string;
  subjectLabel: string;
  subjectColor: string;
  isLiveAura: boolean;
}

/**
 * Returns members who are actively studying right now:
 * - Prefers v29 zero-heartbeat `activeSession` validated via `isLiveAuraActive` (<= 6h stale guard, <= 5m future guard)
 * - Falls back to legacy `entry.live` (when snapshot fetchedAt < 15m ago) for backward compatibility
 */
export function getActiveStudyingNowMembers(
  group: GroupDoc,
  fetchedAt: number,
  now = Date.now()
): StudyingNowMember[] {
  const legacyFresh = now - fetchedAt < GROUP_LIVE_FETCH_MAX_AGE_MS;
  const active: StudyingNowMember[] = [];

  for (const [uid, entry] of Object.entries(group.members || {})) {
    if (!entry || entry.paused || !entry.sh?.l) continue;

    if (isLiveAuraActive(entry.activeSession, now) && entry.activeSession) {
      const startedAt = entry.activeSession.startedAt;
      const elapsedMins = Math.max(1, Math.floor((now - startedAt) / 60_000));
      active.push({
        uid,
        nick: entry.nick,
        emoji: entry.emoji,
        since: startedAt,
        until: startedAt + LIVE_AURA_MAX_AGE_MS,
        elapsedMins,
        elapsedLabel: formatLiveAuraElapsed(startedAt, now),
        subjectLabel: entry.activeSession.subjectLabel,
        subjectColor: entry.activeSession.subjectColor,
        isLiveAura: true,
      });
      continue;
    }

    if (
      legacyFresh &&
      entry.live &&
      entry.live.until > now &&
      entry.live.since <= now + 60_000
    ) {
      const elapsedMins = Math.max(1, Math.floor((now - entry.live.since) / 60_000));
      active.push({
        uid,
        nick: entry.nick,
        emoji: entry.emoji,
        since: entry.live.since,
        until: entry.live.until,
        elapsedMins,
        elapsedLabel: formatLiveAuraElapsed(entry.live.since, now),
        subjectLabel: 'Studying',
        subjectColor: '#F5C451',
        isLiveAura: false,
      });
    }
  }

  active.sort((a, b) => b.elapsedMins - a.elapsedMins || a.nick.localeCompare(b.nick));
  return active;
}

/**
 * Computes last completed week's final standings from the 21-day data (Milestone 2.6).
 * Only records a result if at least 2 members were sharing time (sh.t && !paused).
 */
export function computeCompletedWeekStandings(
  group: GroupDoc,
  todayKey: string
): {
  weekKey: string;
  standings: Record<string, GroupWeekHistoryEntry>;
} | null {
  const currentWeekStart = getWeekStartKey(todayKey);
  const prevWeekStart = addD(currentWeekStart, -7);
  const prevWeekEnd = addD(currentWeekStart, -1);

  const participants: Array<{
    uid: string;
    nick: string;
    minutes: number;
    xp: number;
  }> = [];

  for (const [uid, entry] of Object.entries(group.members || {})) {
    if (!entry || entry.paused || !entry.sh?.t) continue;
    // Member must have joined before or during that week (or have data in that week)
    const mins = sumMemberRange(entry.days, prevWeekStart, prevWeekEnd);
    const xpVal = entry.sh?.x ? sumMemberRange(entry.xpDays, prevWeekStart, prevWeekEnd) : 0;
    participants.push({
      uid,
      nick: entry.nick,
      minutes: mins,
      xp: xpVal,
    });
  }

  if (participants.length < 2) {
    return null;
  }

  participants.sort((a, b) =>
    breakTiesByTimeXpNick(
      { time: a.minutes, xp: a.xp, nick: a.nick },
      { time: b.minutes, xp: b.xp, nick: b.nick }
    )
  );

  const standings: Record<string, GroupWeekHistoryEntry> = {};
  const totalOf = participants.length;
  participants.forEach((p, idx) => {
    standings[p.uid] = {
      rank: idx + 1,
      of: totalOf,
      minutes: clampInt(p.minutes, 0, 10080, 0),
      xp: clampInt(p.xp, 0, 50000, 0),
    };
  });

  return {
    weekKey: prevWeekStart,
    standings,
  };
}

/**
 * Merges a new weekly standing into a GroupHistoryMap, keeping the last 12 weeks per group.
 */
export function recordWeekStandingInHistory(
  history: GroupHistoryMap,
  groupId: string,
  weekKey: string,
  entry: GroupWeekHistoryEntry
): GroupHistoryMap {
  const existingForGroup = history[groupId] || {};
  if (existingForGroup[weekKey]) {
    return history;
  }
  const merged = {
    ...existingForGroup,
    [weekKey]: entry,
  };
  const sortedKeys = Object.keys(merged).sort().slice(-12);
  const trimmed: Record<string, GroupWeekHistoryEntry> = {};
  for (const k of sortedKeys) {
    trimmed[k] = merged[k];
  }
  return {
    ...history,
    [groupId]: trimmed,
  };
}

interface DailyBudgetState {
  dayKey: string;
  writes: number;
  reads: number;
  cheers: number;
  pausedUntilDayKey?: string;
}

export function getLocalDateKey(ts = Date.now()): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getUtcDayKey(ts = Date.now()): string {
  return getLocalDateKey(ts);
}

function loadBudgetState(now = Date.now()): DailyBudgetState {
  const today = getUtcDayKey(now);
  const raw = safeLocalStorageGet(GROUP_BUDGET_STORAGE_KEY);
  if (!raw) return { dayKey: today, writes: 0, reads: 0, cheers: 0 };
  const parsed = safeJsonParse<Partial<DailyBudgetState> | null>(raw, null);
  if (!parsed || typeof parsed !== 'object' || parsed.dayKey !== today) {
    return { dayKey: today, writes: 0, reads: 0, cheers: 0 };
  }
  return {
    dayKey: today,
    writes: Math.max(0, Math.floor(Number(parsed.writes) || 0)),
    reads: Math.max(0, Math.floor(Number(parsed.reads) || 0)),
    cheers: Math.max(0, Math.floor(Number(parsed.cheers) || 0)),
    pausedUntilDayKey:
      typeof parsed.pausedUntilDayKey === 'string' ? parsed.pausedUntilDayKey : undefined,
  };
}

function saveBudgetState(state: DailyBudgetState): void {
  safeLocalStorageSet(GROUP_BUDGET_STORAGE_KEY, JSON.stringify(state));
}

export function isQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const code = (err as { code?: string })?.code || '';
  return (
    code === 'resource-exhausted' ||
    /resource-exhausted|quota exceeded|free daily/i.test(msg)
  );
}

/**
 * Testable rate-limiter and debouncer for Group publishing & reading:
 * - Debounced 6s after a change (configurable)
 * - At most 1 automatic write per group per 10s (configurable)
 * - Flush once when app goes to background or via flushNow() on timer start/stop
 * - Skip when entry hash (excluding updatedAt) is unchanged (0 writes used)
 * - Cap at 60 group writes/user/day (stats + studying-now)
 * - Cap at 150 board reads/user/day
 * - Cap at 10 cheers/user/day
 * - Pause until next day on quota error
 * - Queue while offline and send when back online
 */
export class GroupPublishBudgetController {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastWriteTsByGroup: Map<string, number> = new Map();
  private lastHashByGroup: Map<string, string> = new Map();
  private pendingEntryByGroup: Map<string, MemberEntry> = new Map();
  private pendingGroups: Set<string> = new Set();
  private queuedOfflineGroups: Set<string> = new Set();
  private debounceMs: number;
  private minIntervalMs: number;
  private dailyWriteCap: number;
  private dayKey: string;
  private writesToday = 0;
  private readsToday = 0;
  private cheersToday = 0;
  private pausedForQuota = false;
  private isOnline = true;
  private isFlushing = false;
  private retryCountByGroup: Map<string, number> = new Map();
  private blockedGroups: Set<string> = new Set();
  private onFlushGroup: (groupId: string) => Promise<void>;

  constructor(
    onFlushGroup: (groupId: string) => Promise<void>,
    options?: {
      initialOnline?: boolean;
      debounceMs?: number;
      minIntervalMs?: number;
      dailyWriteCap?: number;
    }
  ) {
    this.onFlushGroup = onFlushGroup;
    this.debounceMs = Math.max(0, options?.debounceMs ?? GROUP_PUBLISH_DEBOUNCE_MS);
    this.minIntervalMs = Math.max(
      0,
      options?.minIntervalMs ?? GROUP_PUBLISH_MIN_INTERVAL_MS
    );
    this.dailyWriteCap = Math.max(
      1,
      options?.dailyWriteCap ?? GROUP_WRITE_DAILY_CAP
    );
    this.dayKey = getUtcDayKey();
    const persisted = loadBudgetState();
    this.dayKey = persisted.dayKey;
    this.writesToday = persisted.writes;
    this.readsToday = persisted.reads;
    this.cheersToday = persisted.cheers;
    this.pausedForQuota = persisted.pausedUntilDayKey === this.dayKey;
    if (options?.initialOnline !== undefined) {
      this.isOnline = options.initialOnline;
    } else if (typeof navigator !== 'undefined' && 'onLine' in navigator) {
      this.isOnline = navigator.onLine;
    }
  }

  private syncDayRollover(): void {
    const today = getUtcDayKey();
    if (today !== this.dayKey) {
      this.dayKey = today;
      this.writesToday = 0;
      this.readsToday = 0;
      this.cheersToday = 0;
      this.pausedForQuota = false;
      this.persist();
    }
  }

  private persist(): void {
    saveBudgetState({
      dayKey: this.dayKey,
      writes: this.writesToday,
      reads: this.readsToday,
      cheers: this.cheersToday,
      ...(this.pausedForQuota ? { pausedUntilDayKey: this.dayKey } : {}),
    });
  }

  public getWritesToday(): number {
    this.syncDayRollover();
    return this.writesToday;
  }

  public getReadsToday(): number {
    this.syncDayRollover();
    return this.readsToday;
  }

  public getCheersToday(): number {
    this.syncDayRollover();
    return this.cheersToday;
  }

  public isPausedForToday(): boolean {
    this.syncDayRollover();
    return this.pausedForQuota || this.writesToday >= this.dailyWriteCap;
  }

  public canWrite(count = 1): boolean {
    this.syncDayRollover();
    if (this.pausedForQuota) return false;
    return this.writesToday + count <= this.dailyWriteCap;
  }

  public recordWrite(count = 1): void {
    this.syncDayRollover();
    this.writesToday += Math.max(0, count);
    if (this.writesToday >= this.dailyWriteCap) {
      this.pausedForQuota = true;
    }
    this.persist();
  }

  public canRead(count = 1): boolean {
    this.syncDayRollover();
    if (this.pausedForQuota) return false;
    return this.readsToday + count <= GROUP_READ_DAILY_CAP;
  }

  public recordRead(count = 1): void {
    this.syncDayRollover();
    this.readsToday += Math.max(0, count);
    this.persist();
  }

  public canSendCheer(): boolean {
    this.syncDayRollover();
    return this.canWrite(1) && this.cheersToday < GROUP_CHEER_DAILY_CAP;
  }

  public recordCheerSent(): void {
    this.syncDayRollover();
    this.cheersToday += 1;
    this.recordWrite(1);
  }

  public pauseForQuotaError(): void {
    this.syncDayRollover();
    this.pausedForQuota = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.persist();
  }

  public setOnlineStatus(online: boolean): void {
    const wasOffline = !this.isOnline;
    this.isOnline = online;
    if (online && wasOffline && this.queuedOfflineGroups.size > 0) {
      for (const gid of this.queuedOfflineGroups) {
        this.pendingGroups.add(gid);
      }
      this.queuedOfflineGroups.clear();
      this.scheduleFlush(100);
    }
  }

  public hasEntryChanged(groupId: string, entry: MemberEntry): boolean {
    const nextHash = hashMemberEntry(entry);
    return this.lastHashByGroup.get(groupId) !== nextHash;
  }

  public commitEntryHash(groupId: string, entry: MemberEntry): void {
    const committedHash = hashMemberEntry(entry);
    this.lastHashByGroup.set(groupId, committedHash);
    this.lastWriteTsByGroup.set(groupId, Date.now());
    this.retryCountByGroup.delete(groupId);
    this.blockedGroups.delete(groupId);
    const pendingEntry = this.pendingEntryByGroup.get(groupId);
    if (!pendingEntry || hashMemberEntry(pendingEntry) === committedHash) {
      this.pendingGroups.delete(groupId);
      this.queuedOfflineGroups.delete(groupId);
      this.pendingEntryByGroup.delete(groupId);
    }
  }

  public isGroupBlocked(groupId: string): boolean {
    return this.blockedGroups.has(groupId);
  }

  public markGroupDirty(groupId: string, entry?: MemberEntry): void {
    this.syncDayRollover();
    if (this.blockedGroups.has(groupId)) return;
    if (entry) {
      if (!this.hasEntryChanged(groupId, entry)) {
        this.pendingGroups.delete(groupId);
        this.queuedOfflineGroups.delete(groupId);
        this.pendingEntryByGroup.delete(groupId);
        return;
      }
      this.pendingEntryByGroup.set(groupId, entry);
    }
    if (!this.isOnline) {
      this.queuedOfflineGroups.add(groupId);
      return;
    }
    if (this.isPausedForToday()) return;

    this.pendingGroups.add(groupId);
    this.scheduleFlush(this.debounceMs);
  }

  public async flushNow(groupIds?: string[]): Promise<void> {
    if (groupIds) {
      for (const gid of groupIds) {
        if (gid && !this.blockedGroups.has(gid)) this.pendingGroups.add(gid);
      }
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    await this.flushReadyGroups(true);
  }

  private scheduleFlush(baseDelayMs: number): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.pendingGroups.size === 0) return;
    const now = Date.now();
    let maxWaitForMinInterval = 0;
    for (const gid of this.pendingGroups) {
      const lastTs = this.lastWriteTsByGroup.get(gid) || 0;
      if (lastTs > 0) {
        const elapsed = now - lastTs;
        if (elapsed < this.minIntervalMs) {
          maxWaitForMinInterval = Math.max(
            maxWaitForMinInterval,
            this.minIntervalMs - elapsed
          );
        }
      }
    }
    const waitMs = Math.max(baseDelayMs, maxWaitForMinInterval);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.flushReadyGroups(false);
    }, waitMs);
  }

  public async flushOnBackground(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    await this.flushReadyGroups(true);
  }

  private async flushReadyGroups(forceBackground: boolean): Promise<void> {
    if (this.isFlushing) return;
    this.syncDayRollover();
    if (this.isPausedForToday()) return;
    if (!this.isOnline) {
      for (const gid of this.pendingGroups) {
        this.queuedOfflineGroups.add(gid);
      }
      this.pendingGroups.clear();
      return;
    }

    const now = Date.now();
    const toFlush: string[] = [];
    const stillThrottled: string[] = [];

    for (const gid of this.pendingGroups) {
      if (this.blockedGroups.has(gid)) {
        this.pendingEntryByGroup.delete(gid);
        continue;
      }
      const pendingEntry = this.pendingEntryByGroup.get(gid);
      if (pendingEntry && !this.hasEntryChanged(gid, pendingEntry)) {
        this.pendingEntryByGroup.delete(gid);
        continue;
      }
      const lastTs = this.lastWriteTsByGroup.get(gid) || 0;
      const elapsed = now - lastTs;
      if (!forceBackground && lastTs > 0 && elapsed < this.minIntervalMs) {
        stillThrottled.push(gid);
      } else {
        toFlush.push(gid);
      }
    }

    this.pendingGroups.clear();
    for (const gid of stillThrottled) {
      this.pendingGroups.add(gid);
    }

    if (toFlush.length === 0) {
      if (this.pendingGroups.size > 0 && !this.isPausedForToday()) {
        this.scheduleFlush(this.debounceMs);
      }
      return;
    }

    this.isFlushing = true;
    let retryDelayMs = this.debounceMs;

    try {
      for (const gid of toFlush) {
        const pendingEntry = this.pendingEntryByGroup.get(gid);
        if (pendingEntry && !this.hasEntryChanged(gid, pendingEntry)) {
          this.pendingEntryByGroup.delete(gid);
          continue;
        }
        if (!this.canWrite(1)) break;
        this.pendingEntryByGroup.delete(gid);
        try {
          await this.onFlushGroup(gid);
          this.retryCountByGroup.delete(gid);
        } catch (err) {
          if (isQuotaError(err)) {
            this.pauseForQuotaError();
            break;
          }
          const code = String((err as { code?: string })?.code || '');
          const msg = err instanceof Error ? err.message : String(err);
          const isPermissionOrMissing =
            /permission-denied|not-found/i.test(code) ||
            /permission-denied|missing or insufficient permissions|no document to update/i.test(msg);
          if (isPermissionOrMissing) {
            this.blockedGroups.add(gid);
            this.queuedOfflineGroups.delete(gid);
            this.retryCountByGroup.delete(gid);
            continue;
          }
          // Transient/network failure: preserve pending entry and re-queue with bounded backoff
          if (pendingEntry) {
            this.pendingEntryByGroup.set(gid, pendingEntry);
          }
          if (!this.isOnline) {
            this.queuedOfflineGroups.add(gid);
          } else {
            const retries = (this.retryCountByGroup.get(gid) || 0) + 1;
            if (retries <= 3) {
              this.retryCountByGroup.set(gid, retries);
              this.pendingGroups.add(gid);
              retryDelayMs = Math.max(retryDelayMs, Math.min(60_000, 15_000 * retries));
            } else {
              this.queuedOfflineGroups.add(gid);
            }
          }
        }
      }
    } finally {
      this.isFlushing = false;
    }

    if (this.pendingGroups.size > 0 && !this.isPausedForToday() && this.isOnline) {
      this.scheduleFlush(retryDelayMs);
    }
  }

  public dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
}

/**
 * Pure helper: determines whether an incoming remote group snapshot is fresh enough
 * to replace an existing cached snapshot (blocks stale reconnect flashes).
 */
export function shouldAcceptGroupSnapshot(
  existing: CachedGroupSnapshot | undefined,
  incomingDoc: GroupDoc
): boolean {
  if (!existing?.doc) return true;
  const existingUpdated = Number(existing.doc.updatedAt) || 0;
  const incomingUpdated = Number(incomingDoc.updatedAt) || 0;
  if (incomingUpdated < existingUpdated) return false;
  return true;
}

/**
 * Pure helper: merges only the current user's published MemberEntry onto the
 * LATEST cached snapshot so concurrent competitor updates via onSnapshot are never clobbered.
 */
export function mergeCachedGroupMemberUpdate(
  latestCached: CachedGroupSnapshot | undefined,
  uid: string,
  myEntry: MemberEntry,
  now: number
): CachedGroupSnapshot | null {
  if (!latestCached) return null;
  return {
    ...latestCached,
    doc: {
      ...latestCached.doc,
      updatedAt: Math.max(Number(latestCached.doc.updatedAt) || 0, now),
      members: {
        ...latestCached.doc.members,
        [uid]: myEntry,
      },
    },
  };
}

// Local Group Snapshot Cache (memory + localStorage)
const memoryGroupCache = new Map<string, CachedGroupSnapshot>();

export function loadCachedGroupSnapshots(): Record<string, CachedGroupSnapshot> {
  const out: Record<string, CachedGroupSnapshot> = {};
  for (const [k, v] of memoryGroupCache.entries()) {
    out[k] = v;
  }
  const raw = safeLocalStorageGet(GROUP_CACHE_STORAGE_KEY);
  if (raw) {
    const parsed = safeJsonParse<Record<string, CachedGroupSnapshot> | null>(raw, null);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [gid, snap] of Object.entries(parsed)) {
        if (isDangerousKey(gid)) continue;
        if (snap && snap.doc && typeof snap.fetchedAt === 'number') {
          const mem = out[gid];
          const memUpdated = Number(mem?.doc?.updatedAt) || 0;
          const diskUpdated = Number(snap.doc.updatedAt) || 0;
          if (
            !mem ||
            diskUpdated > memUpdated ||
            (diskUpdated === memUpdated && snap.fetchedAt > mem.fetchedAt)
          ) {
            out[gid] = snap;
            memoryGroupCache.set(gid, snap);
          }
        }
      }
    }
  }
  return out;
}

export function saveCachedGroupSnapshot(snapshot: CachedGroupSnapshot): void {
  memoryGroupCache.set(snapshot.groupId, snapshot);
  const all = loadCachedGroupSnapshots();
  all[snapshot.groupId] = snapshot;
  safeLocalStorageSet(GROUP_CACHE_STORAGE_KEY, JSON.stringify(all));
}

export function removeCachedGroupSnapshot(groupId: string): void {
  memoryGroupCache.delete(groupId);
  const all = loadCachedGroupSnapshots();
  delete all[groupId];
  safeLocalStorageSet(GROUP_CACHE_STORAGE_KEY, JSON.stringify(all));
}

/**
 * Wipes all cached squad snapshots and daily group budget counters on sign-out or account switch
 * so cached member rosters never leak across Google accounts on shared devices.
 */
export function clearAllCachedGroupSnapshots(): void {
  memoryGroupCache.clear();
  safeLocalStorageRemove(GROUP_CACHE_STORAGE_KEY);
  safeLocalStorageRemove(GROUP_BUDGET_STORAGE_KEY);
}

// ============================================================================
// Firestore Group Operations (single-doc getDoc/setDoc/updateDoc/deleteDoc/onSnapshot — NO list)
// ============================================================================

export async function createGroupInCloud(params: {
  name: string;
  emoji: string;
  state: PulseHabitState;
  todayKey: string;
  sh: GroupSharingFlags;
  budget: GroupPublishBudgetController;
}): Promise<{ groupId: string; groupDoc: GroupDoc }> {
  const tokenCheck = await ensureValidAuthToken();
  const user = auth?.currentUser;
  if (!tokenCheck.valid || !user || !db) {
    throw new Error(
      tokenCheck.errorMessage || 'Please sign in with Google to create a study group.'
    );
  }
  if (!params.budget.canWrite(1)) {
    throw new Error('Daily group write limit reached. Resumes tomorrow.');
  }

  const cleanName = sanitizePlainText(params.name, 32, '');
  if (cleanName.length < 2) {
    throw new Error('Group name must be between 2 and 32 characters.');
  }
  const cleanEmoji = sanitizePlainText(params.emoji, 8, '🩺');
  const now = Date.now();
  const groupId = generateGroupId();

  const myEntry = buildMyMemberEntry(params.state, params.todayKey, {
    joinedAt: now,
    sh: params.sh,
    groupId,
    now,
  });

  const groupDoc: GroupDoc = {
    name: cleanName,
    emoji: cleanEmoji,
    ownerUid: user.uid,
    createdAt: now,
    updatedAt: now,
    memberCap: DEFAULT_GROUP_MEMBER_CAP,
    mockBoard: false,
    members: {
      [user.uid]: myEntry,
    },
  };

  await setDoc(doc(db, 'groups', groupId), sanitizeForFirestore(groupDoc));
  params.budget.recordWrite(1);
  params.budget.commitEntryHash(groupId, myEntry);

  saveCachedGroupSnapshot({
    groupId,
    doc: groupDoc,
    fetchedAt: now,
    receivedCheers: [],
  });

  return { groupId, groupDoc };
}

export async function joinGroupInCloud(params: {
  rawCode: string;
  state: PulseHabitState;
  todayKey: string;
  sh: GroupSharingFlags;
  budget: GroupPublishBudgetController;
}): Promise<{ groupId: string; groupDoc: GroupDoc }> {
  const tokenCheck = await ensureValidAuthToken();
  const user = auth?.currentUser;
  if (!tokenCheck.valid || !user || !db) {
    throw new Error(
      tokenCheck.errorMessage || 'Please sign in with Google to join a study group.'
    );
  }

  const groupId = normalizeGroupCode(params.rawCode);
  if (!isValidGroupCode(groupId)) {
    throw new Error('Enter a valid 10-character invite code (e.g. ABCDE-23456).');
  }
  if (!params.budget.canRead(1) || !params.budget.canWrite(1)) {
    throw new Error('Daily group quota reached. Resumes tomorrow.');
  }

  const ref = doc(db, 'groups', groupId);
  const { updatedGroup, myEntry } = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      throw new Error('No study group found with that invite code.');
    }

    const remoteGroup = sanitizeRemoteGroupDoc(snap.data(), params.todayKey);
    if (!remoteGroup) {
      throw new Error('This study group document could not be loaded.');
    }

    const existingMember = remoteGroup.members[user.uid];
    const currentCount = Object.keys(remoteGroup.members).length;
    if (!existingMember && currentCount >= remoteGroup.memberCap) {
      throw new Error(`This group is full (${currentCount}/${remoteGroup.memberCap} members).`);
    }

    const now = Date.now();
    const entry = buildMyMemberEntry(params.state, params.todayKey, {
      joinedAt: existingMember?.joinedAt || now,
      sh: params.sh,
      groupId,
      existingWeeks: existingMember?.weeks,
      now,
    });

    tx.update(ref, {
      [`members.${user.uid}`]: sanitizeForFirestore(entry),
      updatedAt: now,
    });

    return {
      myEntry: entry,
      updatedGroup: {
        ...remoteGroup,
        updatedAt: now,
        members: {
          ...remoteGroup.members,
          [user.uid]: entry,
        },
      } as GroupDoc,
    };
  });

  params.budget.recordRead(1);
  params.budget.recordWrite(1);
  params.budget.commitEntryHash(groupId, myEntry);

  saveCachedGroupSnapshot({
    groupId,
    doc: updatedGroup,
    fetchedAt: updatedGroup.updatedAt,
    receivedCheers: [],
  });

  return { groupId, groupDoc: updatedGroup };
}

export async function deleteMySentCheersInGroup(params: {
  groupId: string;
  budget: GroupPublishBudgetController;
  uid?: string;
  fetchSentCheerIds?: (
    groupId: string,
    uid: string,
    maxLimit: number
  ) => Promise<string[]>;
  deleteCheerById?: (groupId: string, cheerId: string) => Promise<void>;
}): Promise<number> {
  const uid = params.uid || auth?.currentUser?.uid;
  if (!uid) return 0;
  if (!params.budget.canRead(1) || !params.budget.canWrite(1)) return 0;

  let deleted = 0;
  try {
    let cheerIds: string[] = [];
    if (params.fetchSentCheerIds) {
      cheerIds = (await params.fetchSentCheerIds(params.groupId, uid, 20)).slice(
        0,
        20
      );
      params.budget.recordRead(1);
    } else {
      if (!db) return 0;
      const qSent = query(
        collection(db, 'groups', params.groupId, 'cheers'),
        where('from', '==', uid),
        limit(20)
      );
      const snap = await getDocs(qSent);
      params.budget.recordRead(1);
      cheerIds = snap.docs.slice(0, 20).map((d) => d.id);
    }

    for (const cheerId of cheerIds) {
      if (!params.budget.canWrite(1)) break;
      if (params.deleteCheerById) {
        await params.deleteCheerById(params.groupId, cheerId);
      } else if (db) {
        await deleteDoc(doc(db, 'groups', params.groupId, 'cheers', cheerId));
      }
      params.budget.recordWrite(1);
      deleted += 1;
      if (deleted >= 20) break;
    }
  } catch {
    // Best-effort cleanup; ignore errors
  }
  return deleted;
}

export async function leaveGroupInCloud(params: {
  groupId: string;
  budget: GroupPublishBudgetController;
}): Promise<void> {
  const user = auth?.currentUser;
  if (!user || !db) return;

  if (params.budget.canWrite(1)) {
    const now = Date.now();
    try {
      await updateDoc(doc(db, 'groups', params.groupId), {
        [`members.${user.uid}`]: deleteField(),
        updatedAt: now,
      });
      params.budget.recordWrite(1);
    } catch (err) {
      if (isQuotaError(err)) {
        params.budget.pauseForQuotaError();
      } else {
        const code = String((err as { code?: string })?.code || '');
        const msg = err instanceof Error ? err.message : String(err);
        const alreadyGone =
          /permission-denied|not-found/i.test(code) ||
          /no document to update|permission-denied|missing or insufficient permissions/i.test(msg);
        // If the squad was deleted or user was already removed, proceed cleanly to local cleanup.
        if (!alreadyGone && !isOfflineOrTokenError(err)) {
          throw err;
        }
      }
    }
  }
  await deleteMySentCheersInGroup({
    groupId: params.groupId,
    budget: params.budget,
    uid: user.uid,
  });
  removeCachedGroupSnapshot(params.groupId);
}

export async function publishMyEntryToGroup(params: {
  groupId: string;
  state: PulseHabitState;
  todayKey: string;
  joinedAt: number;
  sh: GroupSharingFlags;
  paused?: boolean;
  live?: GroupLiveStatus | null;
  activeSession?: ActiveSessionAura | null;
  budget: GroupPublishBudgetController;
  force?: boolean;
}): Promise<MemberEntry | null> {
  const tokenCheck = await ensureValidAuthToken();
  const user = auth?.currentUser;
  if (!tokenCheck.valid || !user || !db) return null;
  if (!params.budget.canWrite(1)) return null;

  const cached = loadCachedGroupSnapshots()[params.groupId];
  const existingWeeks = cached?.doc?.members?.[user.uid]?.weeks;

  const now = Date.now();
  const myEntry = buildMyMemberEntry(params.state, params.todayKey, {
    joinedAt: cached?.doc?.members?.[user.uid]?.joinedAt || params.joinedAt || now,
    sh: params.sh,
    paused: params.paused,
    live: params.live,
    activeSession: params.activeSession,
    groupId: params.groupId,
    existingWeeks,
    now,
  });

  if (!params.force) {
    if (!params.budget.hasEntryChanged(params.groupId, myEntry)) {
      return myEntry;
    }
    const cachedSelf = cached?.doc?.members?.[user.uid];
    if (cachedSelf && hashMemberEntry(cachedSelf) === hashMemberEntry(myEntry)) {
      params.budget.commitEntryHash(params.groupId, myEntry);
      return myEntry;
    }
  }

  try {
    await updateDoc(doc(db, 'groups', params.groupId), {
      [`members.${user.uid}`]: sanitizeForFirestore(myEntry),
      updatedAt: now,
    });
  } catch (err) {
    if (isQuotaError(err)) {
      params.budget.pauseForQuotaError();
      return null;
    }
    throw err;
  }
  params.budget.recordWrite(1);
  params.budget.commitEntryHash(params.groupId, myEntry);

  // Re-read the LATEST cache after network I/O so competitor onSnapshot updates are preserved
  const latestCached = loadCachedGroupSnapshots()[params.groupId];
  const merged = mergeCachedGroupMemberUpdate(latestCached, user.uid, myEntry, now);
  if (merged) {
    saveCachedGroupSnapshot(merged);
  }

  return myEntry;
}

/**
 * Subscribes to a SINGLE group document (`groups/{groupId}`) via Firestore `onSnapshot`.
 * Never uses collection queries (`list` is forbidden in `firestore.rules`).
 */
export function subscribeToGroupDoc(params: {
  groupId: string;
  todayKey: string;
  onUpdate: (snapshot: CachedGroupSnapshot) => void;
  onMissing?: () => void;
  onError?: (err: unknown) => void;
}): () => void {
  if (!params.groupId || !db || !auth?.currentUser) {
    return () => {};
  }

  const ref = doc(db, 'groups', params.groupId);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        removeCachedGroupSnapshot(params.groupId);
        params.onMissing?.();
        return;
      }
      const parsed = sanitizeRemoteGroupDoc(snap.data(), params.todayKey);
      if (!parsed) return;
      const existingCached = loadCachedGroupSnapshots()[params.groupId];
      if (!shouldAcceptGroupSnapshot(existingCached, parsed)) {
        return;
      }
      const cachedSnap: CachedGroupSnapshot = {
        groupId: params.groupId,
        doc: parsed,
        fetchedAt: Date.now(),
        receivedCheers: existingCached?.receivedCheers || [],
      };
      saveCachedGroupSnapshot(cachedSnap);
      params.onUpdate(cachedSnap);
    },
    (err) => {
      if (!isOfflineOrTokenError(err)) {
        handleFirestoreError(err, OperationType.GET, `groups/${params.groupId}`);
      }
      params.onError?.(err);
    }
  );
}

export async function fetchGroupSnapshotFromCloud(params: {
  groupId: string;
  todayKey: string;
  budget: GroupPublishBudgetController;
}): Promise<CachedGroupSnapshot | null> {
  const tokenCheck = await ensureValidAuthToken();
  const user = auth?.currentUser;
  if (!tokenCheck.valid || !user || !db) {
    return loadCachedGroupSnapshots()[params.groupId] || null;
  }
  if (!params.budget.canRead(1)) {
    return loadCachedGroupSnapshots()[params.groupId] || null;
  }

  const ref = doc(db, 'groups', params.groupId);
  let snap;
  try {
    snap = await getDoc(ref);
  } catch (err) {
    if (isQuotaError(err)) {
      params.budget.pauseForQuotaError();
      return loadCachedGroupSnapshots()[params.groupId] || null;
    }
    if (isOfflineOrTokenError(err)) {
      return loadCachedGroupSnapshots()[params.groupId] || null;
    }
    handleFirestoreError(err, OperationType.GET, `groups/${params.groupId}`);
    return loadCachedGroupSnapshots()[params.groupId] || null;
  }
  params.budget.recordRead(1);

  if (!snap.exists()) {
    removeCachedGroupSnapshot(params.groupId);
    return null;
  }

  const parsed = sanitizeRemoteGroupDoc(snap.data(), params.todayKey);
  if (!parsed) return null;

  // Fetch received cheers for this week if within read cap
  let receivedCheers: CheerDoc[] = [];
  if (params.budget.canRead(1)) {
    try {
      const weekStartKey = getWeekStartKey(params.todayKey);
      const cheersQ = query(
        collection(db, 'groups', params.groupId, 'cheers'),
        where('to', '==', user.uid),
        where('dayKey', '>=', weekStartKey),
        limit(30)
      );
      const cheersSnap = await getDocs(cheersQ);
      params.budget.recordRead(1);
      receivedCheers = cheersSnap.docs
        .map((d): CheerDoc | null => {
          const data = d.data() as Record<string, unknown>;
          const e = data.e as CheerEmoji;
          if (!ALLOWED_CHEER_EMOJIS.includes(e)) return null;
          if (!isValidDayKey(data.dayKey)) return null;
          return {
            id: d.id,
            from: String(data.from || ''),
            to: String(data.to || ''),
            fromNick: sanitizePlainText(data.fromNick, 20, 'Member'),
            dayKey: data.dayKey,
            e,
            ts: Number(data.ts) || 0,
          };
        })
        .filter((c): c is CheerDoc => c !== null);
    } catch {
      // Ignore cheers query errors so board still renders
    }
  }

  const cachedSnap: CachedGroupSnapshot = {
    groupId: params.groupId,
    doc: parsed,
    fetchedAt: Date.now(),
    receivedCheers,
  };
  saveCachedGroupSnapshot(cachedSnap);
  return cachedSnap;
}

const cheerWriteCooldown = createCooldownGuard(2_500);

export async function sendCheerInCloud(params: {
  groupId: string;
  toUid: string;
  fromNick: string;
  dayKey: string;
  emoji: CheerEmoji;
  budget: GroupPublishBudgetController;
}): Promise<void> {
  const tokenCheck = await ensureValidAuthToken();
  const user = auth?.currentUser;
  if (!tokenCheck.valid || !user || !db) {
    throw new Error(tokenCheck.errorMessage || 'Sign in to send cheers.');
  }
  if (user.uid === params.toUid) throw new Error('You cannot cheer yourself.');
  if (!ALLOWED_CHEER_EMOJIS.includes(params.emoji)) {
    throw new Error('Invalid cheer emoji.');
  }
  if (!cheerWriteCooldown.tryAcquire().allowed) {
    throw new Error('Wait a moment before sending another cheer.');
  }
  if (!params.budget.canSendCheer()) {
    throw new Error('Daily cheer limit (10/day) reached.');
  }

  const cheerId = makeCheerId(params.dayKey, user.uid, params.toUid);
  const cheerRef = doc(db, 'groups', params.groupId, 'cheers', cheerId);
  if (params.budget.canRead(1)) {
    const existing = await getDoc(cheerRef);
    params.budget.recordRead(1);
    if (existing.exists()) {
      throw new Error('You have already cheered this member today.');
    }
  }
  const now = Date.now();
  try {
    await setDoc(cheerRef, {
      from: user.uid,
      to: params.toUid,
      fromNick: sanitizePlainText(params.fromNick, 20, 'Member'),
      dayKey: params.dayKey,
      e: params.emoji,
      ts: now,
    });
    params.budget.recordCheerSent();
  } catch (err) {
    const code = (err as { code?: string })?.code || '';
    if (code === 'permission-denied' || /permission/i.test(String(err))) {
      throw new Error('Already cheered this member today or no longer a group member.');
    }
    throw err;
  }
}

/**
 * Occasional cleanup of own cheers older than 14 days (Milestone 2.3).
 */
export async function cleanupOldOwnCheers(params: {
  groupId: string;
  todayKey: string;
  budget: GroupPublishBudgetController;
}): Promise<void> {
  const user = auth?.currentUser;
  if (!user || !db) return;
  if (!params.budget.canRead(1) || !params.budget.canWrite(1)) return;

  try {
    const cutoffKey = addD(params.todayKey, -14);
    const qOld = query(
      collection(db, 'groups', params.groupId, 'cheers'),
      where('from', '==', user.uid),
      limit(10)
    );
    const snap = await getDocs(qOld);
    params.budget.recordRead(1);
    let deleted = 0;
    for (const d of snap.docs) {
      const data = d.data() as { dayKey?: string };
      if (typeof data.dayKey === 'string' && data.dayKey < cutoffKey && params.budget.canWrite(1)) {
        await deleteDoc(d.ref);
        params.budget.recordWrite(1);
        deleted += 1;
        if (deleted >= 3) break;
      }
    }
  } catch {
    // Non-critical maintenance
  }
}

// Owner Tools (Milestone 2.7)

export async function ownerUpdateGroupSettings(params: {
  groupId: string;
  name?: string;
  emoji?: string;
  mockBoard?: boolean;
  weeklyGoalHours?: number | null; // null removes goal
  removeMemberUid?: string;
  budget: GroupPublishBudgetController;
}): Promise<void> {
  const user = auth?.currentUser;
  if (!user || !db) throw new Error('Not signed in.');
  if (!params.budget.canWrite(1)) {
    throw new Error('Daily group write limit reached.');
  }

  const now = Date.now();
  const patch: Record<string, unknown> = {
    updatedAt: now,
  };

  if (params.name !== undefined) {
    const cleanName = sanitizePlainText(params.name, 32, '');
    if (cleanName.length < 2) {
      throw new Error('Group name must be 2–32 characters.');
    }
    patch.name = cleanName;
  }
  if (params.emoji !== undefined) {
    patch.emoji = sanitizePlainText(params.emoji, 8, '🩺');
  }
  if (params.mockBoard !== undefined) {
    patch.mockBoard = Boolean(params.mockBoard);
  }
  if (params.weeklyGoalHours !== undefined) {
    if (params.weeklyGoalHours === null || params.weeklyGoalHours <= 0) {
      patch.goal = deleteField();
    } else {
      const weeklyMinutes = clampInt(Math.round(params.weeklyGoalHours * 60), 60, 300_000, 600);
      patch.goal = {
        weeklyMinutes,
        updatedAt: now,
      };
    }
  }
  if (params.removeMemberUid) {
    if (params.removeMemberUid === user.uid) {
      throw new Error('You cannot remove yourself as owner. Use Close Group instead.');
    }
    patch[`members.${params.removeMemberUid}`] = deleteField();
  }

  await updateDoc(doc(db, 'groups', params.groupId), patch);
  params.budget.recordWrite(1);
}

export async function ownerCloseGroupInCloud(params: {
  groupId: string;
  budget: GroupPublishBudgetController;
}): Promise<void> {
  const user = auth?.currentUser;
  if (!user || !db) throw new Error('Not signed in.');
  if (!params.budget.canWrite(1)) {
    throw new Error('Daily group write limit reached.');
  }

  await deleteDoc(doc(db, 'groups', params.groupId));
  params.budget.recordWrite(1);
  await deleteMySentCheersInGroup({
    groupId: params.groupId,
    budget: params.budget,
    uid: user.uid,
  });
  removeCachedGroupSnapshot(params.groupId);
}

/**
 * Called by "Delete my cloud data" in SettingsView / App.tsx (Milestone 2.7):
 * Removes the user's entry from all joined groups, deletes any group owned by the user,
 * and best-effort deletes up to 20 sent cheers per group within budget limits.
 */
export async function cleanupUserGroupsOnCloudDelete(
  state: PulseHabitState,
  budget?: GroupPublishBudgetController
): Promise<void> {
  const user = auth?.currentUser;
  if (!user || !db) return;

  const activeBudget =
    budget || new GroupPublishBudgetController(async () => {});
  const joined = state.groupsConfig?.joined || [];
  const cachedAll = loadCachedGroupSnapshots();

  for (const item of joined) {
    const gid = item.groupId;
    if (!gid) continue;
    try {
      const ref = doc(db, 'groups', gid);
      let ownerUid: string | undefined = cachedAll[gid]?.doc?.ownerUid;
      if (!ownerUid && activeBudget.canRead(1)) {
        const snap = await getDoc(ref);
        activeBudget.recordRead(1);
        if (!snap.exists()) {
          await deleteMySentCheersInGroup({
            groupId: gid,
            budget: activeBudget,
            uid: user.uid,
          });
          removeCachedGroupSnapshot(gid);
          continue;
        }
        ownerUid = (snap.data() as { ownerUid?: string })?.ownerUid;
      }
      if (activeBudget.canWrite(1)) {
        if (ownerUid === user.uid) {
          await deleteDoc(ref);
          activeBudget.recordWrite(1);
        } else {
          await updateDoc(ref, {
            [`members.${user.uid}`]: deleteField(),
            updatedAt: Date.now(),
          });
          activeBudget.recordWrite(1);
        }
      }
      await deleteMySentCheersInGroup({
        groupId: gid,
        budget: activeBudget,
        uid: user.uid,
      });
    } catch {
      // Continue cleaning remaining groups
    } finally {
      removeCachedGroupSnapshot(gid);
    }
  }
}
