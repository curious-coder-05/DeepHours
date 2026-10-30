import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
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
import { auth, db, ensureValidAuthToken, sanitizeForFirestore } from './cloudSync';
import {
  computeConsistencyScore,
  computeMinDayStreak,
  getWeekStartKey,
} from './insights';
import { addD, computeMockScore, isManualStudySession } from './studyLogic';
import { computeXpByDay, computeTotalXp } from './xp';

export const GROUP_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const MAX_JOINED_GROUPS = 3;
export const DEFAULT_GROUP_MEMBER_CAP = 30;
export const MAX_GROUP_MEMBER_CAP = 50;
export const GROUP_WRITE_DAILY_CAP = 60;
export const GROUP_READ_DAILY_CAP = 150;
export const GROUP_CHEER_DAILY_CAP = 10;
export const GROUP_PUBLISH_DEBOUNCE_MS = 2 * 60_000; // 2 minutes
export const GROUP_PUBLISH_MIN_INTERVAL_MS = 5 * 60_000; // 5 minutes per group
export const GROUP_CACHE_STALE_MS = 5 * 60_000; // 5 minutes
export const GROUP_AUTO_REFRESH_MS = 3 * 60_000; // 3 minutes while visible
export const GROUP_MANUAL_REFRESH_COOLDOWN_MS = 60_000; // 60 seconds
export const GROUP_LIVE_DURATION_MS = 60 * 60_000; // 60 minutes
export const GROUP_LIVE_REFRESH_MS = 45 * 60_000; // 45 minutes
export const GROUP_LIVE_PAUSE_CLEAR_MS = 5 * 60_000; // 5 minutes
export const GROUP_LIVE_FETCH_MAX_AGE_MS = 15 * 60_000; // 15 minutes

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
      days[dk] = clampInt(num, 0, 1440, 0);
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
      xpDays[dk] = clampInt(num, 0, 3000, 0);
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
      if (typeof uid !== 'string' || !uid.trim() || uid.length > 128) continue;
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
    groupId?: string;
    existingWeeks?: Record<string, GroupWeekHistoryEntry>;
    now?: number;
  }
): MemberEntry {
  const now = options.now ?? Date.now();
  const nickCheck = validateNickname(state.profile?.nick || '');
  const nick = nickCheck.valid ? nickCheck.cleaned : (state.profile?.nick || 'Aspirant').slice(0, 20) || 'Aspirant';
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
      const mins = clampInt(Math.floor(ms / 60000), 0, 1440, 0);
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
        xpDays[dk] = clampInt(entry.total, 0, 3000, 0);
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

  // 6. Live studying status
  const live =
    sh.l && options.live && options.live.until > now
      ? {
          since: Math.floor(options.live.since),
          until: Math.floor(options.live.until),
        }
      : undefined;

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

/**
 * Returns members who are actively studying right now (Milestone 2.1):
 * - sh.l is true and !paused
 * - live.until > now
 * - snapshot fetchedAt is < 15 minutes ago
 */
export function getActiveStudyingNowMembers(
  group: GroupDoc,
  fetchedAt: number,
  now = Date.now()
): Array<{ uid: string; nick: string; emoji: string; since: number; until: number; elapsedMins: number }> {
  if (now - fetchedAt >= GROUP_LIVE_FETCH_MAX_AGE_MS) {
    return [];
  }
  const active: Array<{
    uid: string;
    nick: string;
    emoji: string;
    since: number;
    until: number;
    elapsedMins: number;
  }> = [];
  for (const [uid, entry] of Object.entries(group.members || {})) {
    if (!entry || entry.paused || !entry.sh?.l || !entry.live) continue;
    if (entry.live.until > now && entry.live.since <= now + 60_000) {
      const elapsedMins = Math.max(1, Math.floor((now - entry.live.since) / 60000));
      active.push({
        uid,
        nick: entry.nick,
        emoji: entry.emoji,
        since: entry.live.since,
        until: entry.live.until,
        elapsedMins,
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

function getUtcDayKey(ts = Date.now()): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function loadBudgetState(now = Date.now()): DailyBudgetState {
  const today = getUtcDayKey(now);
  try {
    if (typeof localStorage === 'undefined') {
      return { dayKey: today, writes: 0, reads: 0, cheers: 0 };
    }
    const raw = localStorage.getItem(GROUP_BUDGET_STORAGE_KEY);
    if (!raw) return { dayKey: today, writes: 0, reads: 0, cheers: 0 };
    const parsed = JSON.parse(raw) as Partial<DailyBudgetState>;
    if (parsed.dayKey !== today) {
      return { dayKey: today, writes: 0, reads: 0, cheers: 0 };
    }
    return {
      dayKey: today,
      writes: Math.max(0, Math.floor(Number(parsed.writes) || 0)),
      reads: Math.max(0, Math.floor(Number(parsed.reads) || 0)),
      cheers: Math.max(0, Math.floor(Number(parsed.cheers) || 0)),
      pausedUntilDayKey: parsed.pausedUntilDayKey,
    };
  } catch {
    return { dayKey: today, writes: 0, reads: 0, cheers: 0 };
  }
}

function saveBudgetState(state: DailyBudgetState): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(GROUP_BUDGET_STORAGE_KEY, JSON.stringify(state));
    }
  } catch {
    // Ignore storage quota errors
  }
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
 * - Debounced 2 minutes after a change
 * - At most 1 write per group per 5 minutes
 * - Flush once when app goes to background
 * - Skip when entry hash is unchanged
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
  private pendingGroups: Set<string> = new Set();
  private queuedOfflineGroups: Set<string> = new Set();
  private dayKey: string;
  private writesToday = 0;
  private readsToday = 0;
  private cheersToday = 0;
  private pausedForQuota = false;
  private isOnline = true;
  private onFlushGroup: (groupId: string) => Promise<void>;

  constructor(
    onFlushGroup: (groupId: string) => Promise<void>,
    options?: { initialOnline?: boolean }
  ) {
    this.onFlushGroup = onFlushGroup;
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
    return this.pausedForQuota || this.writesToday >= GROUP_WRITE_DAILY_CAP;
  }

  public canWrite(count = 1): boolean {
    this.syncDayRollover();
    if (this.pausedForQuota) return false;
    return this.writesToday + count <= GROUP_WRITE_DAILY_CAP;
  }

  public recordWrite(count = 1): void {
    this.syncDayRollover();
    this.writesToday += Math.max(0, count);
    if (this.writesToday >= GROUP_WRITE_DAILY_CAP) {
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
    this.lastHashByGroup.set(groupId, hashMemberEntry(entry));
    this.lastWriteTsByGroup.set(groupId, Date.now());
  }

  public markGroupDirty(groupId: string, entry?: MemberEntry): void {
    this.syncDayRollover();
    if (entry && !this.hasEntryChanged(groupId, entry)) {
      return;
    }
    if (!this.isOnline) {
      this.queuedOfflineGroups.add(groupId);
      return;
    }
    if (this.isPausedForToday()) return;

    this.pendingGroups.add(groupId);
    this.scheduleFlush(GROUP_PUBLISH_DEBOUNCE_MS);
  }

  private scheduleFlush(baseDelayMs: number): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    const now = Date.now();
    let maxWaitForMinInterval = 0;
    for (const gid of this.pendingGroups) {
      const lastTs = this.lastWriteTsByGroup.get(gid) || 0;
      if (lastTs > 0) {
        const elapsed = now - lastTs;
        if (elapsed < GROUP_PUBLISH_MIN_INTERVAL_MS) {
          maxWaitForMinInterval = Math.max(
            maxWaitForMinInterval,
            GROUP_PUBLISH_MIN_INTERVAL_MS - elapsed
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
      const lastTs = this.lastWriteTsByGroup.get(gid) || 0;
      const elapsed = now - lastTs;
      if (!forceBackground && lastTs > 0 && elapsed < GROUP_PUBLISH_MIN_INTERVAL_MS) {
        stillThrottled.push(gid);
      } else {
        toFlush.push(gid);
      }
    }

    this.pendingGroups.clear();
    for (const gid of stillThrottled) {
      this.pendingGroups.add(gid);
    }

    for (const gid of toFlush) {
      if (!this.canWrite(1)) break;
      try {
        await this.onFlushGroup(gid);
      } catch (err) {
        if (isQuotaError(err)) {
          this.pauseForQuotaError();
          break;
        }
      }
    }

    if (this.pendingGroups.size > 0 && !this.isPausedForToday()) {
      this.scheduleFlush(GROUP_PUBLISH_DEBOUNCE_MS);
    }
  }

  public dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
}

// Local Group Snapshot Cache (memory + localStorage)
const memoryGroupCache = new Map<string, CachedGroupSnapshot>();

export function loadCachedGroupSnapshots(): Record<string, CachedGroupSnapshot> {
  const out: Record<string, CachedGroupSnapshot> = {};
  for (const [k, v] of memoryGroupCache.entries()) {
    out[k] = v;
  }
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(GROUP_CACHE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, CachedGroupSnapshot>;
        if (parsed && typeof parsed === 'object') {
          for (const [gid, snap] of Object.entries(parsed)) {
            if (snap && snap.doc && typeof snap.fetchedAt === 'number') {
              out[gid] = snap;
              memoryGroupCache.set(gid, snap);
            }
          }
        }
      }
    }
  } catch {
    // Ignore storage read errors
  }
  return out;
}

export function saveCachedGroupSnapshot(snapshot: CachedGroupSnapshot): void {
  memoryGroupCache.set(snapshot.groupId, snapshot);
  try {
    if (typeof localStorage !== 'undefined') {
      const all = loadCachedGroupSnapshots();
      all[snapshot.groupId] = snapshot;
      localStorage.setItem(GROUP_CACHE_STORAGE_KEY, JSON.stringify(all));
    }
  } catch {
    // Ignore storage quota errors
  }
}

export function removeCachedGroupSnapshot(groupId: string): void {
  memoryGroupCache.delete(groupId);
  try {
    if (typeof localStorage !== 'undefined') {
      const all = loadCachedGroupSnapshots();
      delete all[groupId];
      localStorage.setItem(GROUP_CACHE_STORAGE_KEY, JSON.stringify(all));
    }
  } catch {
    // Ignore
  }
}

// ============================================================================
// Firestore Group Operations (getDoc / setDoc / updateDoc / deleteDoc only — NO onSnapshot)
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
  const snap = await getDoc(ref);
  params.budget.recordRead(1);

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
  const myEntry = buildMyMemberEntry(params.state, params.todayKey, {
    joinedAt: existingMember?.joinedAt || now,
    sh: params.sh,
    groupId,
    existingWeeks: existingMember?.weeks,
    now,
  });

  await updateDoc(ref, {
    [`members.${user.uid}`]: sanitizeForFirestore(myEntry),
    updatedAt: now,
  });
  params.budget.recordWrite(1);
  params.budget.commitEntryHash(groupId, myEntry);

  const updatedGroup: GroupDoc = {
    ...remoteGroup,
    updatedAt: now,
    members: {
      ...remoteGroup.members,
      [user.uid]: myEntry,
    },
  };

  saveCachedGroupSnapshot({
    groupId,
    doc: updatedGroup,
    fetchedAt: now,
    receivedCheers: [],
  });

  return { groupId, groupDoc: updatedGroup };
}

export async function leaveGroupInCloud(params: {
  groupId: string;
  budget: GroupPublishBudgetController;
}): Promise<void> {
  const user = auth?.currentUser;
  if (!user || !db) return;

  if (params.budget.canWrite(1)) {
    const now = Date.now();
    await updateDoc(doc(db, 'groups', params.groupId), {
      [`members.${user.uid}`]: deleteField(),
      updatedAt: now,
    });
    params.budget.recordWrite(1);
  }
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
    groupId: params.groupId,
    existingWeeks,
    now,
  });

  if (!params.force && !params.budget.hasEntryChanged(params.groupId, myEntry)) {
    return myEntry;
  }

  await updateDoc(doc(db, 'groups', params.groupId), {
    [`members.${user.uid}`]: sanitizeForFirestore(myEntry),
    updatedAt: now,
  });
  params.budget.recordWrite(1);
  params.budget.commitEntryHash(params.groupId, myEntry);

  if (cached) {
    saveCachedGroupSnapshot({
      ...cached,
      doc: {
        ...cached.doc,
        updatedAt: now,
        members: {
          ...cached.doc.members,
          [user.uid]: myEntry,
        },
      },
    });
  }

  return myEntry;
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
  const snap = await getDoc(ref);
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
  if (!params.budget.canSendCheer()) {
    throw new Error('Daily cheer limit (10/day) reached.');
  }

  const cheerId = makeCheerId(params.dayKey, user.uid, params.toUid);
  const now = Date.now();
  await setDoc(doc(db, 'groups', params.groupId, 'cheers', cheerId), {
    from: user.uid,
    to: params.toUid,
    fromNick: sanitizePlainText(params.fromNick, 20, 'Member'),
    dayKey: params.dayKey,
    e: params.emoji,
    ts: now,
  });
  params.budget.recordCheerSent();
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

  await deleteDoc(doc(db, 'groups', params.groupId));
  params.budget.recordWrite(1);
  removeCachedGroupSnapshot(params.groupId);
}

/**
 * Called by "Delete my cloud data" in MoreView / App.tsx (Milestone 2.7):
 * Removes the user's entry from all joined groups and deletes any group owned by the user.
 */
export async function cleanupUserGroupsOnCloudDelete(
  state: PulseHabitState
): Promise<void> {
  const user = auth?.currentUser;
  if (!user || !db) return;

  const joined = state.groupsConfig?.joined || [];
  const cachedAll = loadCachedGroupSnapshots();

  for (const item of joined) {
    const gid = item.groupId;
    if (!gid) continue;
    try {
      const ref = doc(db, 'groups', gid);
      let ownerUid: string | undefined = cachedAll[gid]?.doc?.ownerUid;
      if (!ownerUid) {
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          removeCachedGroupSnapshot(gid);
          continue;
        }
        ownerUid = (snap.data() as { ownerUid?: string })?.ownerUid;
      }
      if (ownerUid === user.uid) {
        await deleteDoc(ref);
      } else {
        await updateDoc(ref, {
          [`members.${user.uid}`]: deleteField(),
          updatedAt: Date.now(),
        });
      }
    } catch {
      // Continue cleaning remaining groups
    } finally {
      removeCachedGroupSnapshot(gid);
    }
  }
}
