import type { PulseHabitState } from '../types';
import { computeStudyNext, type StudyNextItem } from './pace.ts';
import {
  addD,
  computeMockScore,
  fmtDuration,
  getDayStudyMs,
  getTodaySubjectMs,
  parseD,
} from './studyLogic.ts';

// ==========================================
// 1.8 TARGETS HELPER
// ==========================================

export interface SubjectTargetRow {
  subjectId: string;
  subjectName: string;
  subjectEmoji: string;
  color: string;
  dailyActualMins: number;
  dailyTargetMins: number;
  dailyPct: number;
  weeklyActualMins: number;
  weeklyTargetMins: number;
  weeklyPct: number;
}

export function getWeekStartKey(dayKey: string, ws: number = 1): string {
  const dt = parseD(dayKey);
  const dow = dt.getDay();
  const diff = (dow - ws + 7) % 7;
  return addD(dayKey, -diff);
}

export function getSubjectTargetProgress(
  state: PulseHabitState,
  dayKey: string,
  weekStartKey = getWeekStartKey(dayKey, state.set.ws ?? 1)
): SubjectTargetRow[] {
  const targets = state.set.targets || {
    dailyMinutes: {},
    weeklyMinutes: {},
    minDayMinutes: 240,
    restPassesPerMonth: 4,
  };
  const dailyMap = targets.dailyMinutes || {};
  const weeklyMap = targets.weeklyMinutes || {};

  const weekDays: string[] = [];
  for (let i = 0; i < 7; i++) {
    weekDays.push(addD(weekStartKey, i));
  }

  return state.subjects
    .filter((s) => !s.arch)
    .map((sub) => {
      const dailyMs = getTodaySubjectMs(state, sub.id, dayKey, false);
      let weeklyMs = 0;
      for (const dk of weekDays) {
        weeklyMs += getTodaySubjectMs(state, sub.id, dk, false);
      }
      const dailyActualMins = Math.round(dailyMs / 60000);
      const weeklyActualMins = Math.round(weeklyMs / 60000);
      const dailyTargetMins = Math.max(0, Number(dailyMap[sub.id]) || 0);
      const weeklyTargetMins =
        Math.max(0, Number(weeklyMap[sub.id]) || 0) ||
        (dailyTargetMins > 0 ? dailyTargetMins * 6 : 0);

      return {
        subjectId: sub.id,
        subjectName: sub.name,
        subjectEmoji: sub.e,
        color: sub.color,
        dailyActualMins,
        dailyTargetMins,
        dailyPct:
          dailyTargetMins > 0
            ? Math.min(100, Math.round((dailyActualMins / dailyTargetMins) * 100))
            : 0,
        weeklyActualMins,
        weeklyTargetMins,
        weeklyPct:
          weeklyTargetMins > 0
            ? Math.min(100, Math.round((weeklyActualMins / weeklyTargetMins) * 100))
            : 0,
      };
    });
}

// ==========================================
// 1.9 MINIMUM-DAY STREAK & REST DAYS
// ==========================================

export interface MinDayStreakInfo {
  streak: number;
  bestStreak: number;
  minDayMinutes: number;
  todayStudiedMins: number;
  todayMet: boolean;
  todayMetMinimum: boolean;
  todayIsRestDay: boolean;
  monthRestPassesUsed: number;
  passesUsedThisMonth: number;
  restPassesPerMonth: number;
  restPassesRemaining: number;
  passesRemainingThisMonth: number;
}

export function getMonthRestPassesUsed(state: PulseHabitState, dayKey: string): number {
  const ym = dayKey.slice(0, 7);
  return (state.restDays || []).filter((dk) => dk.startsWith(ym)).length;
}

export function canUseRestDay(state: PulseHabitState, dayKey: string): boolean {
  if ((state.restDays || []).includes(dayKey)) return true;
  const limit = state.set.targets?.restPassesPerMonth ?? 4;
  return getMonthRestPassesUsed(state, dayKey) < limit;
}

export function toggleRestDay(
  state: PulseHabitState,
  dayKey: string
): { nextState: PulseHabitState; toggledOn: boolean; allowed: boolean; reason?: string } {
  const current = state.restDays || [];
  const exists = current.includes(dayKey);
  if (exists) {
    return {
      nextState: {
        ...state,
        restDays: current.filter((d) => d !== dayKey),
      },
      toggledOn: false,
      allowed: true,
    };
  }
  if (!canUseRestDay(state, dayKey)) {
    return {
      nextState: state,
      toggledOn: false,
      allowed: false,
      reason: 'Monthly rest pass limit reached',
    };
  }
  return {
    nextState: {
      ...state,
      restDays: [...current, dayKey].sort(),
    },
    toggledOn: true,
    allowed: true,
  };
}

export function doesDayCountForMinStreak(
  state: PulseHabitState,
  dayKey: string,
  minDayMinutes = state.set.targets?.minDayMinutes ?? 240
): { counts: boolean; metStudyMin: boolean; isRestDay: boolean; studiedMins: number } {
  const studiedMins = Math.floor(getDayStudyMs(state, dayKey, false) / 60000);
  const metStudyMin = studiedMins >= minDayMinutes;
  const isRestDay = (state.restDays || []).includes(dayKey);
  return {
    counts: metStudyMin || isRestDay,
    metStudyMin,
    isRestDay,
    studiedMins,
  };
}

/**
 * 1.9: Day counts if studied minutes >= minDayMinutes OR is in restDays.
 * A not-yet-complete today never breaks the streak.
 */
export function computeMinDayStreak(
  state: PulseHabitState,
  todayKey: string
): MinDayStreakInfo {
  const minDayMinutes = Math.max(15, state.set.targets?.minDayMinutes ?? 240);
  const restPassesPerMonth = Math.max(0, state.set.targets?.restPassesPerMonth ?? 4);
  const monthRestPassesUsed = getMonthRestPassesUsed(state, todayKey);
  const restPassesRemaining = Math.max(0, restPassesPerMonth - monthRestPassesUsed);

  const todayCheck = doesDayCountForMinStreak(state, todayKey, minDayMinutes);

  let streak = 0;
  let cursor = todayKey;

  if (todayCheck.counts) {
    streak += 1;
    cursor = addD(todayKey, -1);
  } else {
    // A not-yet-complete today never breaks the streak; start checking from yesterday
    cursor = addD(todayKey, -1);
  }

  for (let i = 0; i < 730; i++) {
    const check = doesDayCountForMinStreak(state, cursor, minDayMinutes);
    if (check.counts) {
      streak += 1;
      cursor = addD(cursor, -1);
    } else {
      break;
    }
  }

  // Compute best streak across last 365 days
  let bestStreak = streak;
  let running = 0;
  for (let i = 365; i >= 0; i--) {
    const dk = addD(todayKey, -i);
    const check = doesDayCountForMinStreak(state, dk, minDayMinutes);
    if (check.counts) {
      running += 1;
      if (running > bestStreak) bestStreak = running;
    } else if (dk !== todayKey) {
      running = 0;
    }
  }

  return {
    streak,
    bestStreak,
    minDayMinutes,
    todayStudiedMins: todayCheck.studiedMins,
    todayMet: todayCheck.counts,
    todayMetMinimum: todayCheck.metStudyMin,
    todayIsRestDay: todayCheck.isRestDay,
    monthRestPassesUsed,
    passesUsedThisMonth: monthRestPassesUsed,
    restPassesPerMonth,
    restPassesRemaining,
    passesRemainingThisMonth: restPassesRemaining,
  };
}

// ==========================================
// 1.10 CONSISTENCY SCORE (0–100)
// ==========================================

export interface ConsistencyBreakdown {
  hasData: boolean;
  total: number | null; // null when no data exists
  totalScore: number | null;
  displayLabel: string; // e.g. "82" or "-"
  minDayScore100: number; // 0..100 (weighted 40%)
  minDaysScore: number;
  minDaysMetCount: number;
  startRegularityScore100: number | null; // 0..100 (weighted 20%)
  regularityScore: number | null;
  startStdDevMins: number | null;
  revisionOnTimeScore100: number | null; // 0..100 (weighted 20%)
  revisionScore: number | null;
  revisionsOnTimeCount: number;
  revisionsTotalCount: number;
  purityScore100: number | null; // 0..100 (weighted 20%)
  purityScore: number | null;
}

/**
 * 1.10 Consistency score (0–100):
 * - 40% fraction of last 14 days meeting minDayMinutes (or restDay)
 * - 20% start-time regularity (std dev of first session start over 14 days: 0 min = 100 pts, 120+ min = 0, linear)
 * - 20% revisions done on or before their date (last 30 days)
 * - 20% average focus purity
 * Show breakdown, and "-" with no data.
 */
export function computeConsistencyScore(
  state: PulseHabitState,
  todayKey: string
): ConsistencyBreakdown {
  const minDayMinutes = Math.max(15, state.set.targets?.minDayMinutes ?? 240);
  const resetHr = state.set.dayResetHour ?? 4;

  const last14Days: string[] = [];
  for (let i = 0; i < 14; i++) {
    last14Days.push(addD(todayKey, -i));
  }
  const start14Key = last14Days[last14Days.length - 1];
  const start30Key = addD(todayKey, -29);

  // Check if there is any activity at all in the last 30 days
  const recentSessions = state.sessions.filter(
    (s) => s.dayKey >= start30Key && s.dayKey <= todayKey
  );
  const allRevsLast30: Array<{ date: string; done: boolean; doneOn?: string }> = [];
  for (const ch of state.chapters) {
    for (const r of ch.revisions || []) {
      if (r.date >= start30Key && r.date <= todayKey) {
        allRevsLast30.push(r);
      }
    }
  }

  if (recentSessions.length === 0 && allRevsLast30.length === 0) {
    return {
      hasData: false,
      total: null,
      totalScore: null,
      displayLabel: '-',
      minDayScore100: 0,
      minDaysScore: 0,
      minDaysMetCount: 0,
      startRegularityScore100: null,
      regularityScore: null,
      startStdDevMins: null,
      revisionOnTimeScore100: null,
      revisionScore: null,
      revisionsOnTimeCount: 0,
      revisionsTotalCount: 0,
      purityScore100: null,
      purityScore: null,
    };
  }

  // 1) 40% fraction of last 14 days meeting minDayMinutes (or marked rest day)
  let minDaysMetCount = 0;
  for (const dk of last14Days) {
    const check = doesDayCountForMinStreak(state, dk, minDayMinutes);
    if (check.counts) minDaysMetCount += 1;
  }
  const minDayScore100 = Math.round((minDaysMetCount / 14) * 100);

  // 2) 20% start-time regularity (std dev of first session start over 14 days: 0 min = 100 pts, 120+ min = 0, linear)
  const sessionsLast14 = state.sessions.filter(
    (s) => s.dayKey >= start14Key && s.dayKey <= todayKey && Number.isFinite(s.startTs)
  );
  const firstStartByDay: Record<string, number> = {};
  for (const s of sessionsLast14) {
    if (firstStartByDay[s.dayKey] === undefined || s.startTs < firstStartByDay[s.dayKey]) {
      firstStartByDay[s.dayKey] = s.startTs;
    }
  }
  const startOffsetsMins = Object.values(firstStartByDay).map((ts) => {
    const d = new Date(ts);
    const minsOfDay = d.getHours() * 60 + d.getMinutes();
    const resetMins = resetHr * 60;
    return (minsOfDay - resetMins + 1440) % 1440;
  });

  let startStdDevMins: number | null = null;
  let startRegularityScore100: number | null = null;
  if (startOffsetsMins.length >= 2) {
    const mean =
      startOffsetsMins.reduce((acc, v) => acc + v, 0) / startOffsetsMins.length;
    const variance =
      startOffsetsMins.reduce((acc, v) => acc + (v - mean) ** 2, 0) /
      startOffsetsMins.length;
    startStdDevMins = Math.round(Math.sqrt(variance));
    const clamped = Math.min(120, Math.max(0, startStdDevMins));
    startRegularityScore100 = Math.round(((120 - clamped) / 120) * 100);
  } else if (startOffsetsMins.length === 1) {
    startStdDevMins = 0;
    startRegularityScore100 = 100;
  }

  // 3) 20% revisions done on or before their date (last 30 days)
  const revisionsTotalCount = allRevsLast30.length;
  let revisionsOnTimeCount = 0;
  for (const r of allRevsLast30) {
    if (r.done) {
      const completedDate = r.doneOn || r.date;
      if (completedDate <= r.date) {
        revisionsOnTimeCount += 1;
      }
    }
  }
  const revisionOnTimeScore100 =
    revisionsTotalCount > 0
      ? Math.round((revisionsOnTimeCount / revisionsTotalCount) * 100)
      : null;

  // 4) 20% average focus purity (over sessions in last 14 days, or last 30 days if none in 14)
  const puritySource = sessionsLast14.length > 0 ? sessionsLast14 : recentSessions;
  let purityScore100: number | null = null;
  if (puritySource.length > 0) {
    let weightedPurity = 0;
    let totalWeight = 0;
    for (const s of puritySource) {
      const w = Math.max(1, s.activeMs || 1);
      weightedPurity += (s.purity ?? 100) * w;
      totalWeight += w;
    }
    purityScore100 = Math.round(weightedPurity / totalWeight);
  }

  // Combine with 40 / 20 / 20 / 20 weights; if a sub-metric has no data (e.g. 0 revisions scheduled),
  // normalize weights across available metrics or treat neutral (100 for empty revisions when sessions exist).
  const effStartScore = startRegularityScore100 ?? 0;
  const effRevScore = revisionOnTimeScore100 ?? 100;
  const effPurityScore = purityScore100 ?? 0;

  const total = Math.round(
    0.4 * minDayScore100 +
      0.2 * effStartScore +
      0.2 * effRevScore +
      0.2 * effPurityScore
  );

  return {
    hasData: true,
    total,
    totalScore: total,
    displayLabel: String(total),
    minDayScore100,
    minDaysScore: minDayScore100,
    minDaysMetCount,
    startRegularityScore100,
    regularityScore: startRegularityScore100,
    startStdDevMins,
    revisionOnTimeScore100,
    revisionScore: revisionOnTimeScore100,
    revisionsOnTimeCount,
    revisionsTotalCount,
    purityScore100,
    purityScore: purityScore100,
  };
}

// ==========================================
// 1.12 BURNOUT CHECK
// ==========================================

export interface BurnoutCheckResult {
  triggered: boolean;
  visible: boolean;
  dismissedUntil?: string;
  consecutiveWorkDays: number;
  consecutiveHardDays: number;
  avgLast5Energy: number | null;
  avgEnergyLast5: number | null;
  avgLast5Sleep: number | null;
  avgSleepLast5: number | null;
  reasons: string[];
  message: string;
  supportNote: string;
}

/**
 * 1.12 Burnout check:
 * Gentle dismissible card (hidden for 3 days after dismissal) if EITHER:
 * - 10+ consecutive days met minDayMinutes with no rest day, OR
 * - last 5 logged energy values average <= 2, OR
 * - last 5 logged sleep values average < 6h.
 */
export function checkBurnoutStatus(
  state: PulseHabitState,
  todayKey: string
): BurnoutCheckResult {
  const minDayMinutes = Math.max(15, state.set.targets?.minDayMinutes ?? 240);
  const restSet = new Set(state.restDays || []);

  // 1) Check consecutive days meeting minDayMinutes without a rest day
  let consecutiveWorkDays = 0;
  // Check starting from today if today already met minDayMinutes, else from yesterday
  const todayMins = Math.floor(getDayStudyMs(state, todayKey, false) / 60000);
  let cursor =
    todayMins >= minDayMinutes && !restSet.has(todayKey)
      ? todayKey
      : addD(todayKey, -1);

  for (let i = 0; i < 60; i++) {
    if (restSet.has(cursor)) break;
    const mins = Math.floor(getDayStudyMs(state, cursor, false) / 60000);
    if (mins >= minDayMinutes) {
      consecutiveWorkDays += 1;
      cursor = addD(cursor, -1);
    } else {
      break;
    }
  }

  // 2) Last 5 logged energy & sleep values (sorted chronologically by dayKey)
  const wbEntries = Object.entries(state.wellbeing || {})
    .filter(([dk]) => dk <= todayKey)
    .sort(([a], [b]) => a.localeCompare(b));

  const energyLogs = wbEntries
    .map(([, v]) => v.energy)
    .filter((e): e is 1 | 2 | 3 | 4 | 5 => typeof e === 'number' && e >= 1 && e <= 5);
  const sleepLogs = wbEntries
    .map(([, v]) => v.sleep)
    .filter((s): s is number => typeof s === 'number' && s >= 0 && s <= 14);

  let avgLast5Energy: number | null = null;
  if (energyLogs.length >= 5) {
    const last5 = energyLogs.slice(-5);
    avgLast5Energy = Number((last5.reduce((a, b) => a + b, 0) / 5).toFixed(2));
  }

  let avgLast5Sleep: number | null = null;
  if (sleepLogs.length >= 5) {
    const last5 = sleepLogs.slice(-5);
    avgLast5Sleep = Number((last5.reduce((a, b) => a + b, 0) / 5).toFixed(2));
  }

  const reasons: string[] = [];
  if (consecutiveWorkDays >= 10) {
    reasons.push(`${consecutiveWorkDays} consecutive full study days without a rest day`);
  }
  if (avgLast5Energy !== null && avgLast5Energy <= 2) {
    reasons.push(`recent energy logs averaged ${avgLast5Energy}/5 over your last 5 entries`);
  }
  if (avgLast5Sleep !== null && avgLast5Sleep < 6) {
    reasons.push(`recent sleep averaged ${avgLast5Sleep}h across your last 5 entries`);
  }

  const rawTriggered = reasons.length > 0;
  const dismissedUntil =
    state.burnoutDismissedUntil || state.set?.burnoutDismissedUntil;
  const isHiddenByDismissal = Boolean(dismissedUntil && todayKey < dismissedUntil);
  const activeTriggered = rawTriggered && !isHiddenByDismissal;

  return {
    triggered: activeTriggered,
    visible: activeTriggered,
    dismissedUntil,
    consecutiveWorkDays,
    consecutiveHardDays: consecutiveWorkDays,
    avgLast5Energy,
    avgEnergyLast5: avgLast5Energy,
    avgLast5Sleep,
    avgSleepLast5: avgLast5Sleep,
    reasons,
    message:
      reasons.length > 0
        ? `Pace check-in: ${reasons.join(' • ')}. Consider taking a lighter evening or using a Rest Day pass so your retention stays sharp.`
        : '',
    supportNote:
      'If preparation feels heavy or overwhelming, consider talking with a family member, mentor, or someone you trust.',
  };
}

// ==========================================
// 1.13 WEEKLY REVIEW
// ==========================================

export interface WeeklyReviewReport {
  weekStartKey: string;
  weekEndKey: string;
  totalStudyMs: number;
  totalStudiedMs: number;
  subjectRows: SubjectTargetRow[];
  daysMeetingMin: number;
  restDaysUsedInWeek: number;
  revisionsDone: number;
  revisionsOnTime: number;
  revisionsScheduled: number;
  tasksDone: number;
  tasksTotal: number;
  mocksCount: number;
  mockScoreTrendLabel: string;
  mistakesAdded: number;
  mistakesResolved: number;
  bestDay: { dayKey: string; ms: number } | null;
  worstDay: { dayKey: string; ms: number } | null;
  consistencyScore: number | null;
  nextWeekFocus: StudyNextItem[];
  sleepInsight: {
    available: boolean;
    highSleepAvgMins: number | null;
    lowSleepAvgMins: number | null;
    highSleepDays: number;
    lowSleepDays: number;
    summaryText: string;
  };
}

export function computeWeeklyReview(
  state: PulseHabitState,
  weekStartKey: string,
  todayKey: string
): WeeklyReviewReport {
  const weekDays: string[] = [];
  for (let i = 0; i < 7; i++) {
    weekDays.push(addD(weekStartKey, i));
  }
  const weekEndKey = weekDays[6];
  const minDayMinutes = Math.max(15, state.set.targets?.minDayMinutes ?? 240);

  const subjectRows = getSubjectTargetProgress(state, weekEndKey, weekStartKey);

  let totalStudyMs = 0;
  let daysMeetingMin = 0;
  let restDaysUsedInWeek = 0;
  let bestDay: { dayKey: string; ms: number } | null = null;
  let worstDay: { dayKey: string; ms: number } | null = null;

  for (const dk of weekDays) {
    const ms = getDayStudyMs(state, dk, false);
    totalStudyMs += ms;
    const mins = Math.floor(ms / 60000);
    const isRest = (state.restDays || []).includes(dk);
    if (isRest) restDaysUsedInWeek += 1;
    if (mins >= minDayMinutes || isRest) {
      daysMeetingMin += 1;
    }
    if (dk <= todayKey) {
      if (!bestDay || ms > bestDay.ms) bestDay = { dayKey: dk, ms };
      if (!worstDay || ms < worstDay.ms) worstDay = { dayKey: dk, ms };
    }
  }

  // Revisions in this week
  let revisionsDone = 0;
  let revisionsOnTime = 0;
  let revisionsScheduled = 0;
  for (const ch of state.chapters) {
    for (const r of ch.revisions || []) {
      const doneInWeek = r.done && (r.doneOn || r.date) >= weekStartKey && (r.doneOn || r.date) <= weekEndKey;
      const scheduledInWeek = r.date >= weekStartKey && r.date <= weekEndKey;
      if (scheduledInWeek) revisionsScheduled += 1;
      if (doneInWeek) {
        revisionsDone += 1;
        if ((r.doneOn || r.date) <= r.date) {
          revisionsOnTime += 1;
        }
      }
    }
  }

  // Tasks in this week
  const weekTasks = (state.tasks || []).filter(
    (t) => t.dayKey >= weekStartKey && t.dayKey <= weekEndKey
  );
  const tasksTotal = weekTasks.length;
  const tasksDone = weekTasks.filter((t) => t.done).length;

  // Mocks in this week & score trend
  const weekMocks = state.mocks
    .filter((m) => m.dayKey >= weekStartKey && m.dayKey <= weekEndKey)
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey));
  const mocksCount = weekMocks.length;
  let mockScoreTrendLabel = 'No mocks this week';
  if (weekMocks.length === 1) {
    const sc = computeMockScore(weekMocks[0]);
    mockScoreTrendLabel = `${sc.totalScore}/${sc.maxMarks} (${sc.pct}%)`;
  } else if (weekMocks.length >= 2) {
    const first = computeMockScore(weekMocks[0]);
    const last = computeMockScore(weekMocks[weekMocks.length - 1]);
    const delta = last.totalScore - first.totalScore;
    const sign = delta >= 0 ? `+${delta}` : `${delta}`;
    mockScoreTrendLabel = `${first.totalScore} → ${last.totalScore} (${sign} marks across ${weekMocks.length} mocks)`;
  }

  // Mistakes added & resolved
  const mistakesInWeek = (state.mistakes || []).filter(
    (m) => m.dayKey >= weekStartKey && m.dayKey <= weekEndKey
  );
  const mistakesAdded = mistakesInWeek.length;
  const mistakesResolved = mistakesInWeek.filter((m) => m.resolved).length;

  // Consistency score as of end of week (or today if current week)
  const refDay = weekEndKey < todayKey ? weekEndKey : todayKey;
  const consistency = computeConsistencyScore(state, refDay);

  // Next week focus from top 3 Study-next chapters
  const nextWeekFocus = computeStudyNext(state, todayKey, 3);

  // Sleep insight ("focus after 7h+ sleep vs less") ONLY if >= 5 days in each group across history
  const highSleepFocusMins: number[] = [];
  const lowSleepFocusMins: number[] = [];
  for (const [dk, wb] of Object.entries(state.wellbeing || {})) {
    if (typeof wb.sleep !== 'number') continue;
    const focusMins = Math.round(getDayStudyMs(state, dk, false) / 60000);
    if (wb.sleep >= 7) {
      highSleepFocusMins.push(focusMins);
    } else {
      lowSleepFocusMins.push(focusMins);
    }
  }

  let sleepInsight: WeeklyReviewReport['sleepInsight'];
  if (highSleepFocusMins.length >= 5 && lowSleepFocusMins.length >= 5) {
    const highAvg = Math.round(
      highSleepFocusMins.reduce((a, b) => a + b, 0) / highSleepFocusMins.length
    );
    const lowAvg = Math.round(
      lowSleepFocusMins.reduce((a, b) => a + b, 0) / lowSleepFocusMins.length
    );
    sleepInsight = {
      available: true,
      highSleepAvgMins: highAvg,
      lowSleepAvgMins: lowAvg,
      highSleepDays: highSleepFocusMins.length,
      lowSleepDays: lowSleepFocusMins.length,
      summaryText: `Focus after 7h+ sleep: ${fmtDuration(highAvg * 60000)} avg (${highSleepFocusMins.length}d) vs <7h sleep: ${fmtDuration(lowAvg * 60000)} avg (${lowSleepFocusMins.length}d)`,
    };
  } else {
    sleepInsight = {
      available: false,
      highSleepAvgMins: null,
      lowSleepAvgMins: null,
      highSleepDays: highSleepFocusMins.length,
      lowSleepDays: lowSleepFocusMins.length,
      summaryText: `Log sleep on at least 5 days with 7h+ and 5 days with <7h to unlock your personalized sleep-vs-focus insight (${highSleepFocusMins.length}/5 ≥7h, ${lowSleepFocusMins.length}/5 <7h).`,
    };
  }

  return {
    weekStartKey,
    weekEndKey,
    totalStudyMs,
    totalStudiedMs: totalStudyMs,
    subjectRows,
    daysMeetingMin,
    restDaysUsedInWeek,
    revisionsDone,
    revisionsOnTime,
    revisionsScheduled,
    tasksDone,
    tasksTotal,
    mocksCount,
    mockScoreTrendLabel,
    mistakesAdded,
    mistakesResolved,
    bestDay,
    worstDay,
    consistencyScore: consistency.total,
    nextWeekFocus,
    sleepInsight,
  };
}

export function formatWeeklyReviewClipboard(review: WeeklyReviewReport): string {
  const lines: string[] = [
    `📊 Deep Hours Weekly Review (${review.weekStartKey} to ${review.weekEndKey})`,
    `• Total Study Time: ${fmtDuration(review.totalStudyMs)}`,
    `• Days Meeting Minimum: ${review.daysMeetingMin}/7${review.restDaysUsedInWeek > 0 ? ` (${review.restDaysUsedInWeek} rest pass)` : ''}`,
    `• Consistency Score: ${review.consistencyScore !== null ? `${review.consistencyScore}/100` : '-'}`,
    `• Revisions: ${review.revisionsDone} done (${review.revisionsOnTime} on time)`,
    `• Tasks: ${review.tasksDone}/${review.tasksTotal} completed`,
    `• Mocks: ${review.mockScoreTrendLabel}`,
    `• Mistakes: ${review.mistakesAdded} logged, ${review.mistakesResolved} resolved`,
  ];
  if (review.bestDay) {
    lines.push(`• Best Day: ${review.bestDay.dayKey} (${fmtDuration(review.bestDay.ms)})`);
  }
  if (review.worstDay) {
    lines.push(`• Lightest Day: ${review.worstDay.dayKey} (${fmtDuration(review.worstDay.ms)})`);
  }
  lines.push(
    `• Subject Breakdown: ` +
      review.subjectRows
        .map(
          (r) =>
            `${r.subjectName} ${Math.round((r.weeklyActualMins / 60) * 10) / 10}h${
              r.weeklyTargetMins > 0
                ? ` / ${Math.round((r.weeklyTargetMins / 60) * 10) / 10}h`
                : ''
            }`
        )
        .join(', ')
  );
  if (review.nextWeekFocus.length > 0) {
    lines.push(
      `• Next Week Focus: ` +
        review.nextWeekFocus
          .map((item) => `${item.chapter.name} (${item.reasons[0] || 'priority'})`)
          .join('; ')
    );
  }
  if (review.sleepInsight.available) {
    lines.push(`• Sleep Insight: ${review.sleepInsight.summaryText}`);
  }
  return lines.join('\n');
}
