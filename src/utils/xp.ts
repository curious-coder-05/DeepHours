import type { PulseHabitState } from '../types';
import { addD, done, isManualStudySession } from './studyLogic';

export interface XpDayBreakdown {
  study: number;
  focusBonus: number;
  minDayBonus: number;
  streakBonus: number;
  revisions: number;
  chapters: number;
  mocks: number;
  tasks: number;
  habits: number;
  total: number;
}

export interface XpDayEntry {
  total: number;
  breakdown: XpDayBreakdown;
  timerMinutesRaw: number;
  timerMinutesCounted: number;
}

export interface LevelInfo {
  level: number;
  totalXp: number;
  currentLevelFloorXp: number;
  nextLevelXp: number;
  xpIntoLevel: number;
  xpNeededForNext: number;
  xpRemainingToNext: number;
  progressPct: number;
}

export const XP_V2_PLAIN_RULES: ReadonlyArray<{ label: string; rule: string }> = [
  {
    label: 'Timer Study Time',
    rule: '1 XP per active minute from timer sessions (max 360m/session, 960m/day). Manual logs give 0 XP.',
  },
  {
    label: 'Deep Focus Bonus',
    rule: '+5 XP per timer session ≥ 25 mins with ≥ 90% purity (max 4 sessions / +20 XP per day).',
  },
  {
    label: 'Daily Minimum Met',
    rule: '+30 XP once per day when timer study reaches your minimum-day target.',
  },
  {
    label: 'Minimum-Day Streak Bonus',
    rule: '+2 XP per current minimum-day streak day on days you hit the daily minimum (max +20 XP/day).',
  },
  {
    label: 'Revisions Completed',
    rule: '+10 XP when completed on or before due date, +5 XP when completed late.',
  },
  {
    label: 'Chapters Completed',
    rule: '+25 XP on the day a chapter is marked completed.',
  },
  {
    label: 'Mock Test Logged',
    rule: '+25 XP on the mock date (max 1 mock / +25 XP per day, regardless of score).',
  },
  {
    label: 'Daily Tasks Completed',
    rule: '+2 XP per completed task (max 10 tasks / +20 XP per day).',
  },
  {
    label: 'Habits Completed',
    rule: '+3 XP per completed habit (max 15 habits / +45 XP per day).',
  },
];

export function createEmptyXpBreakdown(): XpDayBreakdown {
  return {
    study: 0,
    focusBonus: 0,
    minDayBonus: 0,
    streakBonus: 0,
    revisions: 0,
    chapters: 0,
    mocks: 0,
    tasks: 0,
    habits: 0,
    total: 0,
  };
}

function isValidDayKey(dk: unknown): dk is string {
  return typeof dk === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dk);
}

/**
 * Computes XP v2 per logical day across the user's state.
 * Pure, deterministic, and fast even with 2+ years of history.
 */
export function computeXpByDay(state: PulseHabitState): Record<string, XpDayEntry> {
  const daysMap: Record<
    string,
    {
      studyMinutesCounted: number;
      studyMinutesRaw: number;
      focusQualifyingSessions: number;
      revisionsXp: number;
      chaptersXp: number;
      mocksCount: number;
      tasksDoneCount: number;
      habitsDoneCount: number;
    }
  > = {};

  const ensureDay = (dk: string) => {
    if (!daysMap[dk]) {
      daysMap[dk] = {
        studyMinutesCounted: 0,
        studyMinutesRaw: 0,
        focusQualifyingSessions: 0,
        revisionsXp: 0,
        chaptersXp: 0,
        mocksCount: 0,
        tasksDoneCount: 0,
        habitsDoneCount: 0,
      };
    }
    return daysMap[dk];
  };

  // 1. Timer-tracked study sessions (manual sessions give 0 XP)
  for (const ses of state.sessions || []) {
    if (!ses || !isValidDayKey(ses.dayKey)) continue;
    if (isManualStudySession(ses)) continue;
    const rawWholeMins = Math.max(0, Math.floor((Number(ses.activeMs) || 0) / 60000));
    if (rawWholeMins <= 0) continue;
    const clampedSessionMins = Math.min(360, rawWholeMins);
    const d = ensureDay(ses.dayKey);
    d.studyMinutesRaw += rawWholeMins;
    d.studyMinutesCounted = Math.min(960, d.studyMinutesCounted + clampedSessionMins);
    const purity = Number.isFinite(ses.purity) ? Number(ses.purity) : 100;
    if (rawWholeMins >= 25 && purity >= 90) {
      d.focusQualifyingSessions += 1;
    }
  }

  // 2. Chapters completed (+25 on chapter.completedOn) & Revisions marked done (+10 on-time, +5 late)
  for (const ch of state.chapters || []) {
    if (!ch) continue;
    if (ch.status === 'completed' && isValidDayKey(ch.completedOn)) {
      const d = ensureDay(ch.completedOn);
      d.chaptersXp += 25;
    }
    if (Array.isArray(ch.revisions)) {
      for (const rev of ch.revisions) {
        if (!rev || !rev.done || !isValidDayKey(rev.date)) continue;
        const doneDate = isValidDayKey(rev.doneOn) ? rev.doneOn : rev.date;
        const d = ensureDay(doneDate);
        if (doneDate <= rev.date) {
          d.revisionsXp += 10;
        } else {
          d.revisionsXp += 5;
        }
      }
    }
  }

  // 3. Mock tests logged (+25 on mock.dayKey, max 1 per day)
  for (const mock of state.mocks || []) {
    if (!mock || !isValidDayKey(mock.dayKey)) continue;
    const d = ensureDay(mock.dayKey);
    d.mocksCount += 1;
  }

  // 4. Tasks completed (+2 each, max 10 per day)
  for (const task of state.tasks || []) {
    if (!task || !task.done || !isValidDayKey(task.dayKey)) continue;
    const d = ensureDay(task.dayKey);
    d.tasksDoneCount += 1;
  }

  // 5. Habits completed (+3 each, max 15 per day)
  const activeHabits = (state.habits || []).filter((h) => h && !h.arch);
  const logMap = state.log || {};
  for (const h of activeHabits) {
    const hLog = logMap[h.id];
    if (!hLog || typeof hLog !== 'object') continue;
    for (const dk of Object.keys(hLog)) {
      if (!isValidDayKey(dk)) continue;
      if (done(state, h, dk)) {
        const d = ensureDay(dk);
        d.habitsDoneCount += 1;
      }
    }
  }

  // 6. Compute daily minimum & minimum-day streak bonus chronologically
  const minDayMinutes = Math.max(
    1,
    Math.floor(Number(state.set?.targets?.minDayMinutes ?? 240) || 240)
  );
  const restSet = new Set<string>(
    Array.isArray(state.restDays) ? state.restDays.filter(isValidDayKey) : []
  );

  // Memoized check for whether any calendar day counts toward the minimum-day streak
  // (either timer-tracked study minutes >= minDayMinutes OR marked as rest day)
  const streakCache = new Map<string, number>();
  const getStreakEndingAt = (dayKey: string): number => {
    const cached = streakCache.get(dayKey);
    if (cached !== undefined) return cached;

    let streak = 0;
    let cursor = dayKey;
    for (let step = 0; step < 3650; step++) {
      const entry = daysMap[cursor];
      const metMin = Boolean(entry && entry.studyMinutesRaw >= minDayMinutes);
      const isRest = restSet.has(cursor);
      if (metMin || isRest) {
        streak += 1;
        cursor = addD(cursor, -1);
      } else {
        break;
      }
    }
    streakCache.set(dayKey, streak);
    return streak;
  };

  const result: Record<string, XpDayEntry> = {};
  const sortedDayKeys = Object.keys(daysMap).sort();

  for (const dk of sortedDayKeys) {
    const raw = daysMap[dk];
    const study = Math.min(960, Math.max(0, raw.studyMinutesCounted));
    const focusBonus = Math.min(4, Math.max(0, raw.focusQualifyingSessions)) * 5;
    const metMinDay = raw.studyMinutesRaw >= minDayMinutes;
    const minDayBonus = metMinDay ? 30 : 0;
    const currentStreak = metMinDay ? getStreakEndingAt(dk) : 0;
    const streakBonus = metMinDay ? Math.min(20, currentStreak * 2) : 0;
    const revisions = raw.revisionsXp;
    const chapters = raw.chaptersXp;
    const mocks = Math.min(1, raw.mocksCount) * 25;
    const tasks = Math.min(10, raw.tasksDoneCount) * 2;
    const habits = Math.min(15, raw.habitsDoneCount) * 3;

    const total =
      study +
      focusBonus +
      minDayBonus +
      streakBonus +
      revisions +
      chapters +
      mocks +
      tasks +
      habits;

    result[dk] = {
      total,
      timerMinutesRaw: raw.studyMinutesRaw,
      timerMinutesCounted: study,
      breakdown: {
        study,
        focusBonus,
        minDayBonus,
        streakBonus,
        revisions,
        chapters,
        mocks,
        tasks,
        habits,
        total,
      },
    };
  }

  return result;
}

/**
 * Computes total XP across all days (up to todayKey if provided).
 */
export function computeTotalXp(state: PulseHabitState, todayKey?: string): number {
  const byDay = computeXpByDay(state);
  let sum = 0;
  for (const [dk, entry] of Object.entries(byDay)) {
    if (todayKey && isValidDayKey(todayKey) && dk > todayKey) continue;
    sum += entry.total;
  }
  return Math.max(0, Math.min(10_000_000, sum));
}

/**
 * Computes XP breakdown for a single logical day.
 */
export function computeDayXpBreakdown(
  state: PulseHabitState,
  dayKey: string
): XpDayBreakdown {
  const byDay = computeXpByDay(state);
  return byDay[dayKey]?.breakdown ?? createEmptyXpBreakdown();
}

/**
 * Computes level and progress to next level using XP v2 formula:
 * level = floor(sqrt(totalXp / 150)) + 1
 */
export function computeLevelInfo(totalXp: number): LevelInfo {
  const safeXp = Math.max(0, Math.floor(Number(totalXp) || 0));
  const level = Math.floor(Math.sqrt(safeXp / 150)) + 1;
  const currentLevelFloorXp = (level - 1) * (level - 1) * 150;
  const nextLevelXp = level * level * 150;
  const xpIntoLevel = Math.max(0, safeXp - currentLevelFloorXp);
  const xpNeededForNext = Math.max(150, nextLevelXp - currentLevelFloorXp);
  const xpRemainingToNext = Math.max(0, nextLevelXp - safeXp);
  const progressPct = Math.min(
    100,
    Math.max(0, Math.round((xpIntoLevel / xpNeededForNext) * 100))
  );

  return {
    level,
    totalXp: safeXp,
    currentLevelFloorXp,
    nextLevelXp,
    xpIntoLevel,
    xpNeededForNext,
    xpRemainingToNext,
    progressPct,
  };
}
