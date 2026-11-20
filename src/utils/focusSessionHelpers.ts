import type { ActiveTimerMode, StudySession } from '../types';
import { logicalKey } from './studyLogic';
import { formatExamRecordNote, type ExamPaceRecord } from './examClock';

/**
 * Canonical subject slot used for all-in-one Full Mock and Exam Hall sessions.
 * Because `studyLogic.getSubject(state, id)` strips `sub_` and replaces `_` with spaces,
 * `'sub_All_Subjects'` renders cleanly as `"All Subjects"` across every legacy chart,
 * timeline, and history view without modifying protected `studyLogic.ts` or Firestore schemas.
 */
export const ALL_SUBJECTS_MOCK_ID = 'sub_All_Subjects';
export const ALL_SUBJECTS_LABEL = 'All Subjects';
export const ALL_SUBJECTS_COLOR = '#F5C451';

/** Minimum elapsed time (60 seconds) required to credit an Exam Hall paper to daily study hours. */
export const EXAM_HALL_MIN_LOG_MS = 60_000;

const EXAM_HALL_LOGGED_IDS_KEY = 'dh_exam_hall_logged_ids_v1';
const MAX_STORED_LOGGED_EXAM_IDS = 80;

export function isAllSubjectsMockId(subjectId?: string | null): boolean {
  if (!subjectId) return false;
  const norm = subjectId.trim().toLowerCase();
  return (
    norm === 'sub_all_subjects' ||
    norm === 'sub_general' ||
    norm === 'all_subjects'
  );
}

export interface ModeSwitchSubjectResolution {
  nextSubjectId: string;
  nextRememberedSingleSubjectId: string;
  clearChapter: boolean;
}

/**
 * Pure mode-transition resolver for FocusView:
 * - Switching INTO `fullMock` remembers the user's current single subject and detaches
 *   to `ALL_SUBJECTS_MOCK_ID` so multi-subject mocks never pollute Physics/Chem/Bio hours.
 * - Switching OUT OF `fullMock` restores the remembered single subject automatically
 *   (unless the user explicitly selected a different single subject).
 */
export function resolveSubjectOnModeSwitch(params: {
  prevMode: ActiveTimerMode;
  nextMode: ActiveTimerMode;
  currentSubjectId: string;
  rememberedSingleSubjectId: string;
  fallbackSubjectId: string;
}): ModeSwitchSubjectResolution {
  const {
    prevMode,
    nextMode,
    currentSubjectId,
    rememberedSingleSubjectId,
    fallbackSubjectId,
  } = params;

  const safeFallback =
    fallbackSubjectId && !isAllSubjectsMockId(fallbackSubjectId)
      ? fallbackSubjectId
      : 'sub_phy';

  const safeRemembered =
    rememberedSingleSubjectId && !isAllSubjectsMockId(rememberedSingleSubjectId)
      ? rememberedSingleSubjectId
      : !isAllSubjectsMockId(currentSubjectId) && currentSubjectId
        ? currentSubjectId
        : safeFallback;

  if (prevMode !== 'fullMock' && nextMode === 'fullMock') {
    return {
      nextSubjectId: ALL_SUBJECTS_MOCK_ID,
      nextRememberedSingleSubjectId: !isAllSubjectsMockId(currentSubjectId) && currentSubjectId
        ? currentSubjectId
        : safeRemembered,
      clearChapter: true,
    };
  }

  if (prevMode === 'fullMock' && nextMode !== 'fullMock') {
    if (isAllSubjectsMockId(currentSubjectId)) {
      return {
        nextSubjectId: safeRemembered,
        nextRememberedSingleSubjectId: safeRemembered,
        clearChapter: false,
      };
    }
    return {
      nextSubjectId: currentSubjectId || safeRemembered,
      nextRememberedSingleSubjectId: currentSubjectId || safeRemembered,
      clearChapter: false,
    };
  }

  return {
    nextSubjectId: currentSubjectId || safeFallback,
    nextRememberedSingleSubjectId: !isAllSubjectsMockId(currentSubjectId) && currentSubjectId
      ? currentSubjectId
      : safeRemembered,
    clearChapter: false,
  };
}

/**
 * Deterministic session ID for an Exam Hall record so repeated sheet opens,
 * retries, or tab restores can never log duplicate study sessions.
 */
export function getExamHallSessionId(recordId: string): string {
  const safe = String(recordId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  return `ses_exam_${safe || 'paper'}`;
}

/**
 * Converts a finished Exam Hall chess-clock record into a real StudySession
 * routed through the standard session pipeline.
 * Returns `null` if total elapsed time is under 60 seconds or if the record was already logged.
 */
export function buildExamHallStudySession(
  record: ExamPaceRecord,
  dayResetHour: number,
  existingSessionIds?: ReadonlySet<string>
): StudySession | null {
  if (!record || !Number.isFinite(record.totalElapsedMs)) return null;
  const activeMs = Math.round(record.totalElapsedMs);
  if (activeMs < EXAM_HALL_MIN_LOG_MS) return null;

  const sessionId = getExamHallSessionId(record.id);
  if (existingSessionIds && existingSessionIds.has(sessionId)) {
    return null;
  }

  const endTs =
    Number.isFinite(record.completedAt) && record.completedAt > 0
      ? Math.floor(record.completedAt)
      : Date.now();
  const earliestVisitStart =
    Array.isArray(record.visitLog) && record.visitLog.length > 0
      ? Math.min(
          ...record.visitLog
            .map((v) => v.startedAt)
            .filter((ts) => Number.isFinite(ts) && ts > 0)
        )
      : NaN;
  const startTs =
    Number.isFinite(earliestVisitStart) && earliestVisitStart > 0 && earliestVisitStart <= endTs
      ? Math.floor(earliestVisitStart)
      : Math.max(0, endTs - activeMs);
  const adjustedEndTs = Math.max(startTs + activeMs, endTs);
  const pausedMs = Math.max(0, adjustedEndTs - startTs - activeMs);
  const denom = activeMs + pausedMs;
  const purity = denom > 0
    ? Math.max(1, Math.min(100, Math.round((activeMs / denom) * 100)))
    : 100;
  const targetMs = Math.max(0, Math.round((record.totalDurationMins || 180) * 60_000));
  const overtimeMs = targetMs > 0 ? Math.max(0, activeMs - targetMs) : 0;

  return {
    id: sessionId,
    subjectId: ALL_SUBJECTS_MOCK_ID,
    heading: 'Exam Hall · NEET Mock',
    dayKey: logicalKey(startTs, dayResetHour),
    startTs,
    endTs: adjustedEndTs,
    activeMs,
    pausedMs,
    pauseCount: 0,
    overtimeMs,
    purity,
    mode: 'fullMock',
    source: 'timer',
    rating: 5,
    note: formatExamRecordNote(record),
    updatedAt: adjustedEndTs,
  };
}

function getSafeStorage(storage?: Pick<Storage, 'getItem' | 'setItem'>): Pick<Storage, 'getItem' | 'setItem'> | null {
  if (storage) return storage;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Ignore restricted storage environments
  }
  return null;
}

export function loadLoggedExamHallRecordIds(
  storage?: Pick<Storage, 'getItem' | 'setItem'>
): string[] {
  const store = getSafeStorage(storage);
  if (!store) return [];
  try {
    const raw = store.getItem(EXAM_HALL_LOGGED_IDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string' && x.length > 0);
  } catch {
    return [];
  }
}

export function hasLoggedExamHallRecord(
  recordId: string,
  storage?: Pick<Storage, 'getItem' | 'setItem'>
): boolean {
  if (!recordId) return false;
  return loadLoggedExamHallRecordIds(storage).includes(recordId);
}

export function markExamHallRecordLogged(
  recordId: string,
  storage?: Pick<Storage, 'getItem' | 'setItem'>
): void {
  if (!recordId) return;
  const store = getSafeStorage(storage);
  if (!store) return;
  try {
    const existing = loadLoggedExamHallRecordIds(store).filter((id) => id !== recordId);
    const next = [recordId, ...existing].slice(0, MAX_STORED_LOGGED_EXAM_IDS);
    store.setItem(EXAM_HALL_LOGGED_IDS_KEY, JSON.stringify(next));
  } catch {
    // Ignore quota errors
  }
}
