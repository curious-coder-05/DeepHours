import type { StudySession, Subject } from '../types.ts';
import { addD, parseKey } from './studyLogic.ts';

const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export interface MonolithSubjectSlice {
  subjectId: string;
  name: string;
  color: string;
  minutes: number;
}

export interface MonolithDayEntry {
  dateKey: string;
  shortLabel: string;
  axisLabel: string;
  weekdayShort: string;
  totalMin: number;
  goalPct: number;
  hitGoal: boolean;
  sessionCount: number;
  purityPct: number;
  isToday: boolean;
  subjectSlices: MonolithSubjectSlice[];
}

export interface MonolithScale {
  maxMin: number;
  ticks: number[];
  tickLabels: string[];
}

export interface Chronograph30dSpoke {
  index: number;
  daysAgo: number;
  dateKey: string;
  shortLabel: string;
  weekdayShort: string;
  totalMin: number;
  goalPct: number;
  hitGoal: boolean;
  sessionCount: number;
  purityPct: number;
  topSubjectColor: string | null;
}

export interface Chronograph30dData {
  spokes: Chronograph30dSpoke[];
  activeDays30: number;
  goalHitCount30: number;
  goalHitRatePct: number;
  totalMin30: number;
  avgMinPerDay30: number;
  currentStreak: number;
  streakStartIndex: number;
  avgPurity30: number;
  maxDayMin: number;
}

export interface Chronograph24hSlot {
  hour: number;
  label: string;
  rangeLabel: string;
  minutes: number;
  sharePct: number;
  inPeakWindow: boolean;
}

export type PeakChronotypeLabel =
  | 'Early Morning'
  | 'Morning'
  | 'Afternoon'
  | 'Evening'
  | 'Late-Night'
  | 'No sessions yet';

export interface Chronograph24hData {
  slots: Chronograph24hSlot[];
  totalMin: number;
  maxHourMin: number;
  peakWindowStart: number | null;
  peakWindowLabel: string;
  peakLabel: PeakChronotypeLabel;
  avgStartTime: string;
  avgWrapUpTime: string;
}

export function pad2(n: number): string {
  return String(Math.floor(Math.abs(n))).padStart(2, '0');
}

export function formatMinutesCompact(totalMin: number): string {
  const safe = Math.max(0, Math.round(Number.isFinite(totalMin) ? totalMin : 0));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (h <= 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function formatGoalHoursLabel(dailyGoalMin: number): string {
  const hrs = Math.max(0.25, dailyGoalMin / 60);
  const rounded = Number.isInteger(hrs) ? String(hrs) : hrs.toFixed(1).replace(/\.0$/, '');
  return `${rounded}h GOAL`;
}

/**
 * Generates chronological local YYYY-MM-DD keys ending on `todayKey`.
 */
export function buildLocalDayKeys(todayKey: string, count: number): string[] {
  const safeCount = Math.max(1, Math.floor(count));
  const keys: string[] = [];
  for (let i = safeCount - 1; i >= 0; i--) {
    keys.push(addD(todayKey, -i));
  }
  return keys;
}

function resolveDayKeys(days: readonly string[] | string, count: number): string[] {
  if (typeof days === 'string') {
    return buildLocalDayKeys(days, count);
  }
  const filtered = days.filter((k) => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k));
  if (filtered.length >= count) {
    return filtered.slice(filtered.length - count);
  }
  if (filtered.length > 0) {
    const lastKey = filtered[filtered.length - 1];
    return buildLocalDayKeys(lastKey, count);
  }
  return [];
}

function resolveSubjectMeta(
  subjectId: string,
  subjectMap: Map<string, Subject>
): { name: string; color: string } {
  if (subjectId === 'sub_All_Subjects') {
    return { name: 'Full Mock', color: '#F5C542' };
  }
  const found = subjectMap.get(subjectId);
  if (found) {
    return {
      name: found.name || 'Study',
      color: found.color || '#F5C542',
    };
  }
  return { name: 'Study', color: '#FB923C' };
}

interface DayBucket {
  totalMs: number;
  sessionCount: number;
  purityWeightedSum: number;
  purityWeightMs: number;
  puritySimpleSum: number;
  subjectMs: Map<string, number>;
}

function aggregateSessionsByDay(
  sessions: ReadonlyArray<StudySession>
): Map<string, DayBucket> {
  const byDay = new Map<string, DayBucket>();
  for (const s of sessions) {
    if (!s || !s.dayKey) continue;
    const activeMs = Math.max(0, Number(s.activeMs) || 0);
    let bucket = byDay.get(s.dayKey);
    if (!bucket) {
      bucket = {
        totalMs: 0,
        sessionCount: 0,
        purityWeightedSum: 0,
        purityWeightMs: 0,
        puritySimpleSum: 0,
        subjectMs: new Map(),
      };
      byDay.set(s.dayKey, bucket);
    }
    bucket.totalMs += activeMs;
    bucket.sessionCount += 1;
    const purity = Math.max(0, Math.min(100, Number.isFinite(s.purity) ? s.purity : 100));
    bucket.puritySimpleSum += purity;
    if (activeMs > 0) {
      bucket.purityWeightedSum += purity * activeMs;
      bucket.purityWeightMs += activeMs;
    }
    const subId = s.subjectId || 'general';
    bucket.subjectMs.set(subId, (bucket.subjectMs.get(subId) || 0) + activeMs);
  }
  return byDay;
}

/**
 * Builds chronological local-date entries for the 3D Isometric Monolith Bars instrument.
 */
export function buildMonolithSeries(
  days: readonly string[] | string,
  sessions: ReadonlyArray<StudySession>,
  subjects: ReadonlyArray<Subject>,
  rangeDays: 7 | 14,
  dailyGoalMin: number
): MonolithDayEntry[] {
  const keys = resolveDayKeys(days, rangeDays);
  const safeGoal = Math.max(15, Math.round(Number.isFinite(dailyGoalMin) ? dailyGoalMin : 360));
  const subjectMap = new Map<string, Subject>();
  for (const sub of subjects) {
    subjectMap.set(sub.id, sub);
  }
  const byDay = aggregateSessionsByDay(sessions);
  const latestKey = keys.length > 0 ? keys[keys.length - 1] : '';

  return keys.map((dateKey) => {
    const d = parseKey(dateKey);
    const shortLabel = `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
    const weekdayShort = WEEKDAY_SHORT[d.getDay()];
    const axisLabel = rangeDays === 7 ? weekdayShort : String(d.getDate());
    const bucket = byDay.get(dateKey);

    if (!bucket || bucket.totalMs <= 0) {
      return {
        dateKey,
        shortLabel,
        axisLabel,
        weekdayShort,
        totalMin: 0,
        goalPct: 0,
        hitGoal: false,
        sessionCount: bucket?.sessionCount || 0,
        purityPct: 0,
        isToday: dateKey === latestKey,
        subjectSlices: [],
      };
    }

    const totalMin = Math.round(bucket.totalMs / 60000);
    const goalPct = Math.round((totalMin / safeGoal) * 100);
    const hitGoal = totalMin >= safeGoal;
    const purityPct =
      bucket.purityWeightMs > 0
        ? Math.round(bucket.purityWeightedSum / bucket.purityWeightMs)
        : Math.round(bucket.puritySimpleSum / Math.max(1, bucket.sessionCount));

    const subjectSlices: MonolithSubjectSlice[] = [];
    for (const [subId, ms] of bucket.subjectMs.entries()) {
      const mins = Math.round(ms / 60000);
      if (mins <= 0) continue;
      const meta = resolveSubjectMeta(subId, subjectMap);
      subjectSlices.push({
        subjectId: subId,
        name: meta.name,
        color: meta.color,
        minutes: mins,
      });
    }
    subjectSlices.sort((a, b) => b.minutes - a.minutes);

    return {
      dateKey,
      shortLabel,
      axisLabel,
      weekdayShort,
      totalMin,
      goalPct,
      hitGoal,
      sessionCount: bucket.sessionCount,
      purityPct,
      isToday: dateKey === latestKey,
      subjectSlices,
    };
  });
}

const MONOLITH_SCALE_CANDIDATES: ReadonlyArray<{ maxMin: number; ticks: number[] }> = [
  { maxMin: 120, ticks: [0, 60, 120] }, // 2h
  { maxMin: 180, ticks: [0, 60, 120, 180] }, // 3h
  { maxMin: 240, ticks: [0, 120, 240] }, // 4h
  { maxMin: 360, ticks: [0, 120, 240, 360] }, // 6h
  { maxMin: 480, ticks: [0, 120, 240, 360, 480] }, // 8h
  { maxMin: 540, ticks: [0, 180, 360, 540] }, // 9h
  { maxMin: 720, ticks: [0, 240, 480, 720] }, // 12h
  { maxMin: 900, ticks: [0, 300, 600, 900] }, // 15h
  { maxMin: 1080, ticks: [0, 360, 720, 1080] }, // 18h
  { maxMin: 1440, ticks: [0, 480, 960, 1440] }, // 24h
];

/**
 * Snaps chart ceiling to clean round hour multiples always >= dailyGoalMin * 1.15
 * and >= maxMinutes * 1.06, returning crisp round Y-axis ticks.
 */
export function computeMonolithScale(
  maxMinutes: number,
  dailyGoalMin: number
): MonolithScale {
  const safeMax = Math.max(0, Number.isFinite(maxMinutes) ? maxMinutes : 0);
  const safeGoal = Math.max(15, Number.isFinite(dailyGoalMin) ? dailyGoalMin : 360);
  const minCeiling = Math.max(120, safeGoal * 1.15, safeMax * 1.06);

  for (const candidate of MONOLITH_SCALE_CANDIDATES) {
    if (candidate.maxMin >= minCeiling) {
      return {
        maxMin: candidate.maxMin,
        ticks: candidate.ticks.slice(),
        tickLabels: candidate.ticks.map((t) => `${Math.round(t / 60)}h`),
      };
    }
  }

  const ceilingHours = Math.ceil(minCeiling / 180) * 3;
  const maxMin = ceilingHours * 60;
  const step = maxMin / 3;
  const ticks = [0, step, step * 2, maxMin];
  return {
    maxMin,
    ticks,
    tickLabels: ticks.map((t) => `${Math.round(t / 60)}h`),
  };
}

/**
 * Builds 30 ordered daily spokes for the Chronograph Tempo Dial (latest day at index 0 -> 12 o'clock)
 * plus 30-day cadence, goal hit rate, streak, and average purity telemetry.
 */
export function buildChronograph30d(
  days: readonly string[] | string,
  sessions: ReadonlyArray<StudySession>,
  subjects: ReadonlyArray<Subject>,
  dailyGoalMin: number
): Chronograph30dData {
  const chronological = resolveDayKeys(days, 30);
  const safeGoal = Math.max(15, Math.round(Number.isFinite(dailyGoalMin) ? dailyGoalMin : 360));
  const subjectMap = new Map<string, Subject>();
  for (const sub of subjects) {
    subjectMap.set(sub.id, sub);
  }
  const byDay = aggregateSessionsByDay(sessions);

  // Reverse so index 0 is latest day (TODAY at 12 o'clock) and index 29 is -29d
  const reversed = chronological.slice().reverse();

  let activeDays30 = 0;
  let goalHitCount30 = 0;
  let totalMin30 = 0;
  let maxDayMin = 0;
  let purityWeightedSum = 0;
  let purityWeightMs = 0;

  const spokes: Chronograph30dSpoke[] = reversed.map((dateKey, idx) => {
    const d = parseKey(dateKey);
    const shortLabel = `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
    const weekdayShort = WEEKDAY_SHORT[d.getDay()];
    const bucket = byDay.get(dateKey);
    const totalMin = bucket ? Math.round(bucket.totalMs / 60000) : 0;
    const goalPct = totalMin > 0 ? Math.round((totalMin / safeGoal) * 100) : 0;
    const hitGoal = totalMin >= safeGoal;

    let topSubjectColor: string | null = null;
    if (bucket && bucket.totalMs > 0) {
      activeDays30 += 1;
      totalMin30 += totalMin;
      if (totalMin > maxDayMin) maxDayMin = totalMin;
      if (hitGoal) goalHitCount30 += 1;
      purityWeightedSum += bucket.purityWeightedSum;
      purityWeightMs += bucket.purityWeightMs;

      let topSubId = '';
      let topMs = -1;
      for (const [subId, ms] of bucket.subjectMs.entries()) {
        if (ms > topMs) {
          topMs = ms;
          topSubId = subId;
        }
      }
      if (topSubId) {
        topSubjectColor = resolveSubjectMeta(topSubId, subjectMap).color;
      }
    }

    const purityPct =
      bucket && bucket.purityWeightMs > 0
        ? Math.round(bucket.purityWeightedSum / bucket.purityWeightMs)
        : bucket && bucket.sessionCount > 0
          ? Math.round(bucket.puritySimpleSum / bucket.sessionCount)
          : 0;

    return {
      index: idx,
      daysAgo: idx,
      dateKey,
      shortLabel,
      weekdayShort,
      totalMin,
      goalPct,
      hitGoal,
      sessionCount: bucket?.sessionCount || 0,
      purityPct,
      topSubjectColor,
    };
  });

  // Current consecutive active-day streak starting from TODAY (or yesterday if today is still 0m)
  let streakStartIndex = 0;
  let currentStreak = 0;
  if (spokes.length > 0) {
    const startIdx = spokes[0].totalMin > 0 ? 0 : spokes.length > 1 && spokes[1].totalMin > 0 ? 1 : -1;
    if (startIdx >= 0) {
      streakStartIndex = startIdx;
      for (let i = startIdx; i < spokes.length; i++) {
        if (spokes[i].totalMin > 0) {
          currentStreak += 1;
        } else {
          break;
        }
      }
    }
  }

  const denom = Math.max(1, spokes.length);
  return {
    spokes,
    activeDays30,
    goalHitCount30,
    goalHitRatePct: Math.round((goalHitCount30 / denom) * 100),
    totalMin30,
    avgMinPerDay30: Math.round(totalMin30 / denom),
    currentStreak,
    streakStartIndex,
    avgPurity30: purityWeightMs > 0 ? Math.round(purityWeightedSum / purityWeightMs) : 0,
    maxDayMin,
  };
}

function classifyPeakChronotype(startHour: number | null): PeakChronotypeLabel {
  if (startHour === null) return 'No sessions yet';
  const h = ((startHour % 24) + 24) % 24;
  if (h >= 4 && h < 7) return 'Early Morning';
  if (h >= 7 && h < 12) return 'Morning';
  if (h >= 12 && h < 17) return 'Afternoon';
  if (h >= 17 && h < 21) return 'Evening';
  return 'Late-Night';
}

function circularMeanClockMinutes(minutesOfDay: number[]): string {
  if (minutesOfDay.length === 0) return '—';
  let sinSum = 0;
  let cosSum = 0;
  const twoPi = Math.PI * 2;
  for (const m of minutesOfDay) {
    const normalized = ((m % 1440) + 1440) % 1440;
    const rad = (normalized / 1440) * twoPi;
    sinSum += Math.sin(rad);
    cosSum += Math.cos(rad);
  }
  if (Math.hypot(sinSum, cosSum) < 1e-6) {
    const avg = Math.round(minutesOfDay.reduce((a, b) => a + b, 0) / minutesOfDay.length) % 1440;
    return `${pad2(Math.floor(avg / 60))}:${pad2(avg % 60)}`;
  }
  let meanRad = Math.atan2(sinSum, cosSum);
  if (meanRad < 0) meanRad += twoPi;
  const meanMin = Math.round((meanRad / twoPi) * 1440) % 1440;
  return `${pad2(Math.floor(meanMin / 60))}:${pad2(meanMin % 60)}`;
}

/**
 * Buckets focus minutes into 24 local-hour slots (0..23), computes peak sliding 2h window
 * (including midnight wrap-around e.g. 23:00-01:00), chronotype archetype, avg start/wrap-up, and share %.
 */
export function buildChronograph24h(
  sessions: ReadonlyArray<StudySession>
): Chronograph24hData {
  const hourMs = new Float64Array(24);
  const dayBounds = new Map<string, { firstStartTs: number; lastEndTs: number }>();

  for (const s of sessions) {
    if (!s) continue;
    const activeMs = Math.max(0, Number(s.activeMs) || 0);
    if (activeMs <= 0) continue;

    const startTs = Number(s.startTs);
    if (!Number.isFinite(startTs) || startTs <= 0) continue;
    const rawEndTs = Number(s.endTs);
    const endTs =
      Number.isFinite(rawEndTs) && rawEndTs > startTs ? rawEndTs : startTs + activeMs;

    // Distribute activeMs across all local hours overlapped by [startTs, endTs]
    const spanMs = Math.min(endTs - startTs, 24 * 3600000);
    if (spanMs <= 60000) {
      const h = new Date(startTs).getHours();
      hourMs[h] += activeMs;
    } else {
      const effectiveEnd = startTs + spanMs;
      let cursor = startTs;
      while (cursor < effectiveEnd) {
        const d = new Date(cursor);
        const h = d.getHours();
        const nextHour = new Date(
          d.getFullYear(),
          d.getMonth(),
          d.getDate(),
          h + 1,
          0,
          0,
          0
        ).getTime();
        const segEnd = Math.min(effectiveEnd, Math.max(cursor + 1, nextHour));
        const segFraction = (segEnd - cursor) / spanMs;
        hourMs[h] += activeMs * segFraction;
        cursor = segEnd;
      }
    }

    const dk = s.dayKey || '';
    if (dk) {
      const existing = dayBounds.get(dk);
      if (!existing) {
        dayBounds.set(dk, { firstStartTs: startTs, lastEndTs: endTs });
      } else {
        if (startTs < existing.firstStartTs) existing.firstStartTs = startTs;
        if (endTs > existing.lastEndTs) existing.lastEndTs = endTs;
      }
    }
  }

  const hourMins = Array.from({ length: 24 }, (_, h) => Math.round(hourMs[h] / 60000));
  const totalMin = hourMins.reduce((sum, m) => sum + m, 0);
  const maxHourMin = Math.max(0, ...hourMins);

  let peakWindowStart: number | null = null;
  let bestWindowSum = 0;
  if (totalMin > 0) {
    for (let h = 0; h < 24; h++) {
      const pairSum = hourMs[h] + hourMs[(h + 1) % 24];
      if (pairSum > bestWindowSum) {
        bestWindowSum = pairSum;
        peakWindowStart = h;
      }
    }
  }

  const peakWindowLabel =
    peakWindowStart !== null
      ? `${pad2(peakWindowStart)}:00–${pad2((peakWindowStart + 2) % 24)}:00`
      : '—';
  const peakLabel = classifyPeakChronotype(peakWindowStart);

  const startMinutesList: number[] = [];
  const endMinutesList: number[] = [];
  for (const b of dayBounds.values()) {
    const sd = new Date(b.firstStartTs);
    startMinutesList.push(sd.getHours() * 60 + sd.getMinutes());
    const ed = new Date(b.lastEndTs);
    endMinutesList.push(ed.getHours() * 60 + ed.getMinutes());
  }

  const slots: Chronograph24hSlot[] = hourMins.map((minutes, hour) => {
    const inPeakWindow =
      peakWindowStart !== null &&
      (hour === peakWindowStart || hour === (peakWindowStart + 1) % 24);
    return {
      hour,
      label: `${pad2(hour)}:00`,
      rangeLabel: `${pad2(hour)}:00–${pad2((hour + 1) % 24)}:00`,
      minutes,
      sharePct: totalMin > 0 ? Math.round((minutes / totalMin) * 100) : 0,
      inPeakWindow,
    };
  });

  return {
    slots,
    totalMin,
    maxHourMin,
    peakWindowStart,
    peakWindowLabel,
    peakLabel,
    avgStartTime: circularMeanClockMinutes(startMinutesList),
    avgWrapUpTime: circularMeanClockMinutes(endMinutesList),
  };
}

/**
 * Converts a pointer offset (dx, dy) relative to the dial center into spoke index 0..count-1,
 * with spoke 0 anchored cleanly at 12 o'clock (-Math.PI / 2) progressing clockwise.
 */
export function angleToSpokeIndex(dx: number, dy: number, count: number): number {
  const safeCount = Math.max(1, Math.floor(count));
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) {
    return 0;
  }
  const twoPi = Math.PI * 2;
  let angle = Math.atan2(dy, dx) + Math.PI / 2;
  angle = ((angle % twoPi) + twoPi) % twoPi;
  const step = twoPi / safeCount;
  return Math.floor((angle + step / 2) / step) % safeCount;
}

/**
 * Adjusts a hex color for 3D isometric prism face shading.
 * Negative amount darkens (e.g. -0.30 for right face), positive lightens (e.g. +0.18 for top diamond cap).
 */
export function shadeHexColor(hex: string, amount: number): string {
  const clean = (hex || '#F5C542').trim().replace(/^#/, '');
  let r = 245;
  let g = 197;
  let b = 66;
  if (clean.length === 3) {
    r = parseInt(clean[0] + clean[0], 16);
    g = parseInt(clean[1] + clean[1], 16);
    b = parseInt(clean[2] + clean[2], 16);
  } else if (clean.length === 6) {
    r = parseInt(clean.slice(0, 2), 16);
    g = parseInt(clean.slice(2, 4), 16);
    b = parseInt(clean.slice(4, 6), 16);
  }
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
    return '#F5C542';
  }
  const adjust = (c: number) => {
    const next = amount < 0 ? c * (1 + amount) : c + (255 - c) * amount;
    return Math.max(0, Math.min(255, Math.round(next)));
  };
  return `#${adjust(r).toString(16).padStart(2, '0')}${adjust(g).toString(16).padStart(2, '0')}${adjust(b).toString(16).padStart(2, '0')}`;
}
