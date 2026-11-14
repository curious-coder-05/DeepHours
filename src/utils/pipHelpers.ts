import type { ActiveTimerMode, PulseHabitState, TimerAesthetic } from '../types';
import {
  fmtHMS,
  fmtHMShort,
  fmtMS,
  getSubject,
  getTimerMetrics,
  getTodaySubjectMs,
  logicalKey,
} from './studyLogic';

export type PiPStatusTone = 'subject' | 'lumen' | 'break' | 'idle';
export type PiPContextActionKind = 'extend5' | 'nextSection' | 'milestone';

export interface PiPViewModel {
  aesthetic: TimerAesthetic;
  mode: ActiveTimerMode;
  isActive: boolean;
  isRunning: boolean;
  isPaused: boolean;
  isBreak: boolean;
  isOvertime: boolean;
  isStopwatch: boolean;
  statusLabel: 'Studying' | 'Paused' | 'Flow Overtime' | 'Break' | 'Ready';
  statusTone: PiPStatusTone;
  accentColor: string;
  subjectColor: string;
  subjectEmoji: string;
  subjectName: string;
  heading: string;
  displayTitle: string;
  clockStr: string;
  overtimeStr: string | null;
  progressPct: number;
  purityPct: number;
  todayTotalMs: number;
  footerText: string;
  stopwatchMilestone: {
    completedCount: number;
    nextTargetMins: number;
    remainingMs: number;
    remainingStr: string;
    segmentPct: number;
    label: string;
  };
  contextAction: {
    kind: PiPContextActionKind;
    label: string;
    ariaLabel: string;
    interactive: boolean;
  };
  analogAngles: {
    secAngle: number;
    minAngle: number;
    hourAngle: number;
    targetMinAngle: number | null;
  };
  sectionCount: number;
}

export const PIP_LUMEN_COLOR = '#F5C451';
export const PIP_BREAK_COLOR = '#60A5FA';
export const PIP_BASE_BG = '#0B0D10';

export function hexToRgba(hex: string, alpha: number): string {
  const clean = (hex || '').trim().replace('#', '');
  let r = 245;
  let g = 196;
  let b = 81;
  if (clean.length === 3) {
    r = parseInt(clean[0] + clean[0], 16) || 0;
    g = parseInt(clean[1] + clean[1], 16) || 0;
    b = parseInt(clean[2] + clean[2], 16) || 0;
  } else if (clean.length >= 6) {
    r = parseInt(clean.slice(0, 2), 16) || 0;
    g = parseInt(clean.slice(2, 4), 16) || 0;
    b = parseInt(clean.slice(4, 6), 16) || 0;
  }
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function computePiPViewModel(
  state: PulseHabitState,
  now = Date.now()
): PiPViewModel {
  const aesthetic: TimerAesthetic = state.set.timerAesthetic || 'neon';
  const todayKey = logicalKey(now, state.set.dayResetHour ?? 0);
  const m = getTimerMetrics(state, now);
  const activeTimer = state.activeTimer;
  const mode: ActiveTimerMode = m?.mode || state.set.defaultMode || 'pomo';
  const isActive = Boolean(m);
  const isRunning = m?.status === 'running';
  const isPaused = m?.status === 'paused';
  const isBreak = m?.phase === 'break';
  const isOvertime = Boolean(m && m.overtimeMs > 0);
  const isStopwatch = mode === 'stopwatch';

  const activeSub = m ? m.subject : getSubject(state);
  const subjectColor = activeSub.color || PIP_LUMEN_COLOR;
  const subjectEmoji = activeSub.e || '📘';
  const subjectName = activeSub.name || 'Study';
  const heading = m ? m.heading : subjectName;

  const displayTitle =
    heading.toLowerCase() === subjectName.toLowerCase() ||
    heading.toLowerCase() === `${subjectName.toLowerCase()} study`
      ? `${subjectEmoji} ${heading}`
      : `${subjectEmoji} ${subjectName} · ${heading}`;

  let statusLabel: PiPViewModel['statusLabel'] = 'Ready';
  let statusTone: PiPStatusTone = 'idle';
  let accentColor = subjectColor;

  if (m) {
    if (isBreak) {
      statusLabel = 'Break';
      statusTone = 'break';
      accentColor = PIP_BREAK_COLOR;
    } else if (isPaused) {
      statusLabel = 'Paused';
      statusTone = 'lumen';
      accentColor = PIP_LUMEN_COLOR;
    } else if (isOvertime) {
      statusLabel = 'Flow Overtime';
      statusTone = 'lumen';
      accentColor = PIP_LUMEN_COLOR;
    } else {
      statusLabel = 'Studying';
      statusTone = 'subject';
      accentColor = subjectColor;
    }
  }

  const defaultIdleMs =
    mode === 'pomo'
      ? (state.set.pomoWork || 25) * 60000
      : mode === 'countdown'
        ? (state.set.countdownMins || 45) * 60000
        : mode === 'fullMock'
          ? (state.set.fullMockMins || 180) * 60000
          : 0;

  const clockMs = m
    ? m.overtimeMs > 0
      ? m.totalActiveMs
      : m.displayMs
    : defaultIdleMs;
  const clockStr = fmtHMS(clockMs);
  const overtimeStr = isOvertime && m ? `+${fmtMS(m.overtimeMs)}` : null;
  const progressPct = m ? (isOvertime ? 100 : Math.min(100, Math.max(0, m.progressPct))) : 0;
  const purityPct = m ? m.purity : 100;
  const todayTotalMs = getTodaySubjectMs(state, 'any', todayKey, todayKey, now);

  const footerText = m
    ? `Purity ${purityPct}% · Today ${fmtHMShort(todayTotalMs)}`
    : `Today ${fmtHMShort(todayTotalMs)} · Ready`;

  const MILESTONE_MS = 15 * 60 * 1000;
  const totalActiveMs = m ? m.totalActiveMs : 0;
  const completedCount = Math.floor(totalActiveMs / MILESTONE_MS);
  const nextMilestoneMs = (completedCount + 1) * MILESTONE_MS;
  const remainingMs = Math.max(0, nextMilestoneMs - totalActiveMs);
  const remainingStr = fmtMS(remainingMs);
  const nextTargetMins = (completedCount + 1) * 15;
  const segmentPct = Math.min(
    100,
    Math.max(0, ((totalActiveMs % MILESTONE_MS) / MILESTONE_MS) * 100)
  );
  const stopwatchLabel = m
    ? `Next 15m milestone in ${remainingStr}`
    : '15m milestone markers';

  let contextAction: PiPViewModel['contextAction'];
  if (isStopwatch) {
    contextAction = {
      kind: 'milestone',
      label: m ? `15m · ${remainingStr}` : '15m Milestone',
      ariaLabel: `Stopwatch 15 minute milestone: ${nextTargetMins}m mark in ${remainingStr}`,
      interactive: false,
    };
  } else if (mode === 'fullMock') {
    const secNum = (activeTimer?.mockSections?.length || 0) + 1;
    contextAction = {
      kind: 'nextSection',
      label: isActive ? `Next Section (${secNum})` : 'Next Section',
      ariaLabel: 'Mark current mock section complete and start next section split',
      interactive: isActive,
    };
  } else {
    contextAction = {
      kind: 'extend5',
      label: '+5m',
      ariaLabel: 'Add 5 minutes to current timer target',
      interactive: isActive,
    };
  }

  const totalSec = Math.floor(totalActiveMs / 1000);
  const secAngle = (totalSec % 60) * 6;
  const minAngle = ((totalActiveMs / 60000) % 60) * 6;
  const hourAngle = ((totalActiveMs / 3600000) % 12) * 30;
  const targetMinAngle =
    activeTimer && activeTimer.targetMs > 0
      ? ((activeTimer.targetMs / 60000) % 60) * 6
      : null;

  return {
    aesthetic,
    mode,
    isActive,
    isRunning,
    isPaused,
    isBreak,
    isOvertime,
    isStopwatch,
    statusLabel,
    statusTone,
    accentColor,
    subjectColor,
    subjectEmoji,
    subjectName,
    heading,
    displayTitle,
    clockStr,
    overtimeStr,
    progressPct,
    purityPct,
    todayTotalMs,
    footerText,
    stopwatchMilestone: {
      completedCount,
      nextTargetMins,
      remainingMs,
      remainingStr,
      segmentPct,
      label: stopwatchLabel,
    },
    contextAction,
    analogAngles: {
      secAngle,
      minAngle,
      hourAngle,
      targetMinAngle,
    },
    sectionCount: activeTimer?.mockSections?.length || 0,
  };
}
