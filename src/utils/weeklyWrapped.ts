import type { PulseHabitState, Subject } from '../types';
import { addD, fmtHMShort, parseD } from './studyLogic';
import { computeMinDayStreak } from './insights';
import {
  ALL_SUBJECTS_COLOR,
  ALL_SUBJECTS_LABEL,
  isAllSubjectsMockId,
} from './focusSessionHelpers';
import type { DailyProofPayload, ProofSubjectSlice } from './proofCardCanvas';

export interface WeeklyPeakWindow {
  startHour: number;
  endHour: number;
  label: string;
  volumeMs: number;
  avgPurity: number;
  sessionsCount: number;
}

export interface WeeklyDodgedSubject {
  subjectId: string;
  name: string;
  emoji: string;
  color: string;
  studiedMs: number;
  sharePct: number;
}

export interface WeeklyWrappedReport {
  weekStartKey: string;
  weekEndKey: string;
  dateRangeLabel: string;
  isSunday: boolean;
  hasSessionsThisWeek: boolean;
  highlightCard: boolean;
  totalMs: number;
  priorTotalMs: number;
  deltaMs: number;
  deltaLabel: string;
  deltaDirection: 'up' | 'down' | 'flat' | 'first-week';
  sessionsCount: number;
  activeDays: number;
  avgPurity: number | null;
  tasksDone: number;
  tasksTotal: number;
  streakDays: number;
  peakWindow: WeeklyPeakWindow | null;
  dodgedSubject: WeeklyDodgedSubject | null;
  subjectSlices: ProofSubjectSlice[];
}

export function formatHour12(hour24: number): string {
  const normalized = ((Math.floor(hour24) % 24) + 24) % 24;
  if (normalized === 0) return '12 AM';
  if (normalized < 12) return `${normalized} AM`;
  if (normalized === 12) return '12 PM';
  return `${normalized - 12} PM`;
}

export function formatThreeHourWindowLabel(startHour: number): string {
  const s = ((Math.floor(startHour) % 24) + 24) % 24;
  const e = (s + 3) % 24;
  return `${formatHour12(s)} - ${formatHour12(e)}`;
}

function formatShortDay(dayKey: string): string {
  const d = parseD(dayKey);
  try {
    return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
  } catch {
    return dayKey;
  }
}

export function formatWeeklyDeltaLabel(
  totalMs: number,
  priorTotalMs: number
): { label: string; direction: WeeklyWrappedReport['deltaDirection'] } {
  const diff = totalMs - priorTotalMs;
  if (totalMs <= 0 && priorTotalMs <= 0) {
    return { label: 'Ready for week one', direction: 'first-week' };
  }
  if (priorTotalMs <= 0 && totalMs > 0) {
    return { label: 'First logged week', direction: 'first-week' };
  }
  if (Math.abs(diff) < 60_000) {
    return { label: 'Even with last week', direction: 'flat' };
  }
  const absText = fmtHMShort(Math.abs(diff));
  if (diff > 0) {
    return { label: `+${absText} vs last week`, direction: 'up' };
  }
  return { label: `-${absText} vs last week`, direction: 'down' };
}

/**
 * Pure local 7-day Sunday Night Study Wrapped calculator.
 * Compares the last 7 logical days `[todayKey - 6 .. todayKey]`
 * against the prior 7 logical days `[todayKey - 13 .. todayKey - 7]`.
 */
export function computeWeeklyWrapped(
  state: PulseHabitState,
  todayKey: string
): WeeklyWrappedReport {
  const weekStartKey = addD(todayKey, -6);
  const priorStartKey = addD(todayKey, -13);
  const priorEndKey = addD(todayKey, -7);

  const todayDate = parseD(todayKey);
  const isSunday = todayDate.getDay() === 0;

  const thisWeekDays = new Set<string>();
  const priorWeekDays = new Set<string>();
  for (let i = 0; i < 7; i++) {
    thisWeekDays.add(addD(todayKey, -i));
    priorWeekDays.add(addD(todayKey, -(7 + i)));
  }

  const allSessions = Array.isArray(state.sessions) ? state.sessions : [];
  const weekSessions = allSessions.filter(
    (s) => thisWeekDays.has(s.dayKey) && Number(s.activeMs) > 0
  );
  const priorSessions = allSessions.filter(
    (s) => priorWeekDays.has(s.dayKey) && Number(s.activeMs) > 0
  );

  let totalMs = 0;
  let weightedPuritySum = 0;
  let weightedPurityMs = 0;
  const activeDaySet = new Set<string>();

  // Hourly accumulators for 3-hour sliding peak window detection (0..23)
  const hourMs = new Array<number>(24).fill(0);
  const hourPurityWeighted = new Array<number>(24).fill(0);
  const hourPurityMs = new Array<number>(24).fill(0);
  const hourSessions = new Array<number>(24).fill(0);

  const activeSubjects: Subject[] = (state.subjects || []).filter((s) => !s.arch);
  const subjectMsMap = new Map<string, number>();
  for (const s of activeSubjects) {
    subjectMsMap.set(s.id, 0);
  }
  const sliceMap = new Map<string, { label: string; color: string; ms: number }>();

  for (const s of weekSessions) {
    const ms = Math.max(0, Number(s.activeMs) || 0);
    if (ms <= 0) continue;
    totalMs += ms;
    activeDaySet.add(s.dayKey);

    const purity = Number(s.purity);
    const validPurity = Number.isFinite(purity) && purity > 0 ? Math.min(100, purity) : 100;
    weightedPuritySum += validPurity * ms;
    weightedPurityMs += ms;

    const startDate = new Date(Number(s.startTs) || 0);
    const hr = Number.isFinite(startDate.getTime()) ? startDate.getHours() : 12;
    hourMs[hr] += ms;
    hourPurityWeighted[hr] += validPurity * ms;
    hourPurityMs[hr] += ms;
    hourSessions[hr] += 1;

    const isAll = isAllSubjectsMockId(s.subjectId);
    const key = isAll ? 'sub_All_Subjects' : s.subjectId;
    if (!isAll) {
      subjectMsMap.set(s.subjectId, (subjectMsMap.get(s.subjectId) || 0) + ms);
    }

    const subObj = isAll
      ? null
      : (state.subjects || []).find((x) => x.id === s.subjectId);
    const label = isAll ? ALL_SUBJECTS_LABEL : subObj?.name || 'Study';
    const color = isAll ? ALL_SUBJECTS_COLOR : subObj?.color || ALL_SUBJECTS_COLOR;
    const prevSlice = sliceMap.get(key);
    if (prevSlice) {
      prevSlice.ms += ms;
    } else {
      sliceMap.set(key, { label, color, ms });
    }
  }

  let priorTotalMs = 0;
  for (const s of priorSessions) {
    priorTotalMs += Math.max(0, Number(s.activeMs) || 0);
  }

  const avgPurity =
    weightedPurityMs > 0 ? Math.round(weightedPuritySum / weightedPurityMs) : null;

  // Find peak 3-hour window across 24h cycle (including wrap-around like 21..24 or 22..01)
  let peakWindow: WeeklyPeakWindow | null = null;
  if (totalMs > 0) {
    let bestScore = -1;
    let bestStart = 0;
    let bestVol = 0;
    let bestPurity = 100;
    let bestCount = 0;

    for (let startHr = 0; startHr < 24; startHr++) {
      let winMs = 0;
      let winPurW = 0;
      let winPurMs = 0;
      let winCount = 0;
      for (let offset = 0; offset < 3; offset++) {
        const h = (startHr + offset) % 24;
        winMs += hourMs[h];
        winPurW += hourPurityWeighted[h];
        winPurMs += hourPurityMs[h];
        winCount += hourSessions[h];
      }
      if (winMs <= 0) continue;
      const winPurity = winPurMs > 0 ? Math.round(winPurW / winPurMs) : 100;
      // Rank primarily by volume, with gentle purity weighting to reward deep focus blocks,
      // and prefer windows whose starting hour actually has study activity on equal ties
      const score = winMs * (0.85 + 0.15 * (winPurity / 100));
      const startsActive = hourMs[startHr] > 0;
      const bestStartsActive = bestScore >= 0 && hourMs[bestStart] > 0;
      const isBetter =
        score > bestScore + 0.5 ||
        (Math.abs(score - bestScore) <= 0.5 && startsActive && !bestStartsActive);
      if (isBetter) {
        bestScore = score;
        bestStart = startHr;
        bestVol = winMs;
        bestPurity = winPurity;
        bestCount = winCount;
      }
    }

    if (bestVol > 0) {
      peakWindow = {
        startHour: bestStart,
        endHour: (bestStart + 3) % 24,
        label: formatThreeHourWindowLabel(bestStart),
        volumeMs: bestVol,
        avgPurity: bestPurity,
        sessionsCount: bestCount,
      };
    }
  }

  // Identify Quietly Dodged Subject: active non-archived subject with fewest minutes this week
  let dodgedSubject: WeeklyDodgedSubject | null = null;
  if (activeSubjects.length > 0) {
    const ranked = activeSubjects
      .map((s) => ({
        subject: s,
        ms: subjectMsMap.get(s.id) || 0,
      }))
      .sort((a, b) => a.ms - b.ms);
    const lowest = ranked[0];
    if (lowest) {
      dodgedSubject = {
        subjectId: lowest.subject.id,
        name: lowest.subject.name,
        emoji: lowest.subject.e,
        color: lowest.subject.color,
        studiedMs: lowest.ms,
        sharePct: totalMs > 0 ? Math.round((lowest.ms / totalMs) * 100) : 0,
      };
    }
  }

  // Tasks completed in this 7-day window
  const weekTasks = (state.tasks || []).filter((t) => thisWeekDays.has(t.dayKey));
  const tasksDone = weekTasks.filter((t) => t.done).length;
  const tasksTotal = weekTasks.length;

  const streakInfo = computeMinDayStreak(state, todayKey);
  const deltaInfo = formatWeeklyDeltaLabel(totalMs, priorTotalMs);

  const subjectSlices: ProofSubjectSlice[] = Array.from(sliceMap.entries())
    .sort((a, b) => b[1].ms - a[1].ms)
    .map(([id, item]) => ({
      id,
      label: item.label,
      color: item.color,
      ms: item.ms,
      pct: totalMs > 0 ? Math.max(1, Math.round((item.ms / totalMs) * 100)) : 0,
    }));

  const hasSessionsThisWeek = weekSessions.length > 0;
  const dateRangeLabel = `${formatShortDay(weekStartKey)} - ${formatShortDay(todayKey)}`;

  // Ensure priorStartKey & priorEndKey remain logically consistent (unused vars suppressed cleanly)
  void priorStartKey;
  void priorEndKey;

  return {
    weekStartKey,
    weekEndKey: todayKey,
    dateRangeLabel,
    isSunday,
    hasSessionsThisWeek,
    highlightCard: isSunday || hasSessionsThisWeek,
    totalMs,
    priorTotalMs,
    deltaMs: totalMs - priorTotalMs,
    deltaLabel: deltaInfo.label,
    deltaDirection: deltaInfo.direction,
    sessionsCount: weekSessions.length,
    activeDays: activeDaySet.size,
    avgPurity,
    tasksDone,
    tasksTotal,
    streakDays: streakInfo.streak,
    peakWindow,
    dodgedSubject,
    subjectSlices,
  };
}

/**
 * Builds a ProofCardPayload from the 7-day Weekly Wrapped report so Slide 4
 * wires directly into the existing ProofCardSheet HTML5 Canvas PNG generator.
 */
export function buildWeeklyProofPayload(
  report: WeeklyWrappedReport,
  state: PulseHabitState
): DailyProofPayload {
  const dailyGoalMins = Math.max(15, state.set.targets?.minDayMinutes ?? 360);
  const weeklyGoalMs = dailyGoalMins * 7 * 60_000;
  return {
    kind: 'daily',
    totalMs: report.totalMs,
    goalMs: weeklyGoalMs,
    sessionsCount: report.sessionsCount,
    avgPurity: report.avgPurity,
    habitsDone: report.activeDays,
    habitsTotal: 7,
    tasksDone: report.tasksDone,
    tasksTotal: report.tasksTotal,
    streakDays: report.streakDays,
    dateLabel: `Weekly · ${report.dateRangeLabel}`,
    dayKey: report.weekEndKey,
    slices: report.subjectSlices,
    topTopics: report.peakWindow ? [`Peak ${report.peakWindow.label}`] : [],
  };
}
