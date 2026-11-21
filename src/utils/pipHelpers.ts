import type { ActiveTimerMode, PulseHabitState, TimerAesthetic } from '../types';
import {
  computeExamClockSnapshot,
  loadActiveExamClockState,
  type ExamClockState,
} from './examClock';
import {
  fmtHMS,
  fmtHMShort,
  fmtMS,
  getSubject,
  getTimerMetrics,
  getTodaySubjectMs,
  logicalKey,
} from './studyLogic';

export type PiPStatusTone = 'subject' | 'lumen' | 'break' | 'idle' | 'crimson';
export type PiPContextActionKind = 'extend5' | 'nextSection' | 'milestone';

export interface PiPCanvasStatusBadge {
  label: 'FOCUSING' | 'PAUSED' | 'OVERTIME' | 'BREAK' | 'READY';
  dotColor: string;
  textColor: string;
  isCrimson: boolean;
}

export interface PiPFooterTokens {
  leftLabel: string;
  leftValue: string;
  rightLabel: string;
  rightValue: string;
}

export interface PiPViewModel {
  aesthetic: TimerAesthetic;
  mode: ActiveTimerMode;
  isActive: boolean;
  isRunning: boolean;
  isPaused: boolean;
  isBreak: boolean;
  isOvertime: boolean;
  isExamHall: boolean;
  isExamOvertime: boolean;
  isStopwatch: boolean;
  statusLabel: 'Studying' | 'Paused' | 'Flow Overtime' | 'Break' | 'Ready' | 'Overtime';
  statusTone: PiPStatusTone;
  canvasStatus: PiPCanvasStatusBadge;
  accentColor: string;
  subjectColor: string;
  subjectEmoji: string;
  subjectName: string;
  heading: string;
  cleanTitle: string;
  displayTitle: string;
  clockStr: string;
  captionText: string;
  overtimeStr: string | null;
  progressPct: number;
  progressRatio: number;
  purityPct: number;
  todayTotalMs: number;
  footerText: string;
  footerTokens: PiPFooterTokens;
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
export const PIP_CRIMSON_COLOR = '#FB7185';
export const PIP_BASE_BG = '#000000';
export const PIP_CANVAS_LOGICAL_W = 640;
export const PIP_CANVAS_LOGICAL_H = 360;
export const PIP_CANVAS_DPR = 2;

// Comprehensive Unicode emoji & pictograph stripper (including ZWJ sequences,
// variation selectors U+FE0E/U+FE0F, keycap enclosing marks, skin tone modifiers,
// dingbats, and misc technical/symbol icons like ⚛️, ⏱️, 📘, 🧪, 🧬).
const EMOJI_STRIP_REGEX =
  /(?:[\u{1F1E6}-\u{1F1FF}]{2}|[\p{Extended_Pictographic}\p{Emoji_Presentation}](?:[\u{1F3FB}-\u{1F3FF}]|\uFE0F|\uFE0E|\u20E3|\u200D[\p{Extended_Pictographic}\p{Emoji_Presentation}\u2600-\u27BF])*|[\u2600-\u27BF]\uFE0F?|[\uFE0E\uFE0F\u200D\u20E3])/gu;

export function stripPiPEmojis(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .replace(EMOJI_STRIP_REGEX, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s·•\-:|]+/, '')
    .replace(/[\s·•\-:|]+$/, '')
    .trim();
}

export function clampPiPProgress(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return Math.max(0, Math.min(1, ratio));
}

export function truncatePiPText(text: string, maxChars: number): string {
  const clean = (text || '').trim();
  const limit = Math.max(1, Math.floor(maxChars));
  if (clean.length <= limit) return clean;
  if (limit === 1) return '…';
  return `${clean.slice(0, limit - 1).trimEnd()}…`;
}

export function resolvePiPCanvasStatus(params: {
  isActive: boolean;
  isRunning: boolean;
  isPaused: boolean;
  isBreak: boolean;
  isExamOvertime: boolean;
}): PiPCanvasStatusBadge {
  if (params.isExamOvertime) {
    return {
      label: 'OVERTIME',
      dotColor: '#FB7185',
      textColor: '#FDA4AF',
      isCrimson: true,
    };
  }
  if (params.isBreak) {
    return {
      label: 'BREAK',
      dotColor: '#60A5FA',
      textColor: '#BFDBFE',
      isCrimson: false,
    };
  }
  if (params.isPaused) {
    return {
      label: 'PAUSED',
      dotColor: '#FDE047',
      textColor: '#FEF08A',
      isCrimson: false,
    };
  }
  if (params.isRunning) {
    return {
      label: 'FOCUSING',
      dotColor: '#34D399',
      textColor: '#D4D4D8',
      isCrimson: false,
    };
  }
  return {
    label: 'READY',
    dotColor: '#71717A',
    textColor: '#A1A1AA',
    isCrimson: false,
  };
}

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

function buildCleanPiPTitle(subjectName: string, heading: string): string {
  const cleanSub = stripPiPEmojis(subjectName) || 'Study';
  const cleanHeading = stripPiPEmojis(heading);
  if (!cleanHeading) return `${cleanSub} Study`;
  const lowerSub = cleanSub.toLowerCase();
  const lowerHead = cleanHeading.toLowerCase();
  if (lowerHead === lowerSub || lowerHead === `${lowerSub} study`) {
    return cleanHeading;
  }
  return `${cleanSub} · ${cleanHeading}`;
}

export function computePiPViewModel(
  state: PulseHabitState,
  now = Date.now(),
  examClockOverride?: ExamClockState | null
): PiPViewModel {
  const aesthetic: TimerAesthetic = state.set.timerAesthetic || 'neon';
  const todayKey = logicalKey(now, state.set.dayResetHour ?? 0);
  const m = getTimerMetrics(state, now);
  const activeTimer = state.activeTimer;
  const todayTotalMs = getTodaySubjectMs(state, 'any', todayKey, todayKey, now);

  // Check active Exam Hall chess-clock session (explicit override for tests/preview,
  // or live localStorage session when standard timer is not running)
  const examState =
    examClockOverride !== undefined
      ? examClockOverride
      : !m
        ? loadActiveExamClockState()
        : null;

  if (
    examState &&
    (examState.status === 'running' || examState.status === 'paused')
  ) {
    const snap = computeExamClockSnapshot(examState, now);
    const activeSec =
      snap.sections.find((s) => s.isActive) || snap.sections[0] || null;
    if (activeSec) {
      const isRunning = examState.status === 'running';
      const isPaused = examState.status === 'paused';
      const isExamOvertime = activeSec.isOvertime;
      const cleanSecName = stripPiPEmojis(activeSec.label) || 'Exam Hall';
      const cleanTitle = `${cleanSecName} · Exam Hall`;
      const clockMs = isExamOvertime ? activeSec.overtimeMs : activeSec.remainingMs;
      const clockStr = isExamOvertime ? `+${fmtHMS(clockMs)}` : fmtHMS(clockMs);
      const overtimeStr = isExamOvertime ? `+${fmtMS(activeSec.overtimeMs)}` : null;
      const rawRatio =
        activeSec.budgetMs > 0 ? activeSec.elapsedMs / activeSec.budgetMs : 0;
      const progressRatio = clampPiPProgress(isExamOvertime ? 1 : rawRatio);
      const progressPct = Math.round(progressRatio * 100);
      const canvasStatus = resolvePiPCanvasStatus({
        isActive: true,
        isRunning,
        isPaused,
        isBreak: false,
        isExamOvertime,
      });

      const statusLabel: PiPViewModel['statusLabel'] = isExamOvertime
        ? 'Overtime'
        : isPaused
          ? 'Paused'
          : 'Studying';
      const statusTone: PiPStatusTone = isExamOvertime
        ? 'crimson'
        : isPaused
          ? 'lumen'
          : 'subject';
      const accentColor = isExamOvertime
        ? PIP_CRIMSON_COLOR
        : isPaused
          ? PIP_LUMEN_COLOR
          : activeSec.color || PIP_LUMEN_COLOR;

      const budgetMins = Math.max(1, Math.round(activeSec.budgetMs / 60000));
      const captionText = isExamOvertime
        ? `Section budget ${budgetMins}m · ${overtimeStr} over`
        : `Section budget ${budgetMins}m · Exam Hall`;

      const todayLabel = fmtHMShort(todayTotalMs + snap.totalElapsedMs);
      const footerTokens: PiPFooterTokens = {
        leftLabel: 'Exam left',
        leftValue: fmtHMShort(snap.totalRemainingMs),
        rightLabel: 'Today',
        rightValue: todayLabel,
      };
      const footerText = `Exam left ${footerTokens.leftValue} · Today ${footerTokens.rightValue}`;

      const totalSec = Math.floor(activeSec.elapsedMs / 1000);
      return {
        aesthetic,
        mode: 'fullMock',
        isActive: true,
        isRunning,
        isPaused,
        isBreak: false,
        isOvertime: isExamOvertime,
        isExamHall: true,
        isExamOvertime,
        isStopwatch: false,
        statusLabel,
        statusTone,
        canvasStatus,
        accentColor,
        subjectColor: activeSec.color || PIP_LUMEN_COLOR,
        subjectEmoji: '',
        subjectName: cleanSecName,
        heading: 'Exam Hall',
        cleanTitle,
        displayTitle: cleanTitle,
        clockStr,
        captionText,
        overtimeStr,
        progressPct,
        progressRatio,
        purityPct: 100,
        todayTotalMs: todayTotalMs + snap.totalElapsedMs,
        footerText,
        footerTokens,
        stopwatchMilestone: {
          completedCount: 0,
          nextTargetMins: 15,
          remainingMs: 0,
          remainingStr: '00:00',
          segmentPct: 0,
          label: captionText,
        },
        contextAction: {
          kind: 'nextSection',
          label: 'Exam Hall',
          ariaLabel: 'Exam Hall chess-clock active',
          interactive: false,
        },
        analogAngles: {
          secAngle: (totalSec % 60) * 6,
          minAngle: ((activeSec.elapsedMs / 60000) % 60) * 6,
          hourAngle: ((activeSec.elapsedMs / 3600000) % 12) * 30,
          targetMinAngle:
            activeSec.budgetMs > 0
              ? ((activeSec.budgetMs / 60000) % 60) * 6
              : null,
        },
        sectionCount: snap.sections.length,
      };
    }
  }

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
  const subjectName = stripPiPEmojis(activeSub.name || 'Study') || 'Study';
  const heading = stripPiPEmojis(m ? m.heading : subjectName) || subjectName;

  const cleanTitle = buildCleanPiPTitle(subjectName, heading);
  const displayTitle = cleanTitle;

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

  const canvasStatus = resolvePiPCanvasStatus({
    isActive,
    isRunning,
    isPaused,
    isBreak,
    isExamOvertime: false,
  });

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
  const progressPct = m
    ? isOvertime
      ? 100
      : Math.min(100, Math.max(0, m.progressPct))
    : 0;
  const purityPct = m ? m.purity : 100;

  const todayFormatted = fmtHMShort(todayTotalMs);
  const footerTokens: PiPFooterTokens = m
    ? {
        leftLabel: 'Purity',
        leftValue: `${purityPct}%`,
        rightLabel: 'Today',
        rightValue: todayFormatted,
      }
    : {
        leftLabel: 'Today',
        leftValue: todayFormatted,
        rightLabel: 'Status',
        rightValue: 'Ready',
      };
  const footerText = m
    ? `Purity ${purityPct}% · Today ${todayFormatted}`
    : `Today ${todayFormatted} · Ready`;

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

  const progressRatio = clampPiPProgress(
    isStopwatch ? (m ? segmentPct / 100 : 0) : progressPct / 100
  );

  const targetMins =
    activeTimer && activeTimer.targetMs > 0
      ? Math.max(1, Math.round(activeTimer.targetMs / 60000))
      : mode === 'pomo'
        ? state.set.pomoWork || 25
        : mode === 'countdown'
          ? state.set.countdownMins || 45
          : state.set.fullMockMins || 180;
  const sectionCount = activeTimer?.mockSections?.length || 0;

  let captionText: string;
  if (isStopwatch) {
    captionText = isActive
      ? `15m Milestone · ${remainingStr} left`
      : 'Stopwatch · 15m milestones';
  } else if (overtimeStr) {
    captionText = `Flow Overtime · ${overtimeStr}`;
  } else if (isBreak) {
    captionText = `Break · ${targetMins}m`;
  } else if (mode === 'fullMock') {
    captionText =
      sectionCount > 0
        ? `Full Mock · ${Math.round(progressPct)}% · ${sectionCount} splits`
        : `Full Mock · ${targetMins}m`;
  } else if (mode === 'countdown') {
    captionText = `Countdown · ${targetMins}m`;
  } else {
    captionText = `Pomodoro · ${targetMins}m`;
  }

  let contextAction: PiPViewModel['contextAction'];
  if (isStopwatch) {
    contextAction = {
      kind: 'milestone',
      label: m ? `15m · ${remainingStr}` : '15m Milestone',
      ariaLabel: `Stopwatch 15 minute milestone: ${nextTargetMins}m mark in ${remainingStr}`,
      interactive: false,
    };
  } else if (mode === 'fullMock') {
    const secNum = sectionCount + 1;
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
    isExamHall: false,
    isExamOvertime: false,
    isStopwatch,
    statusLabel,
    statusTone,
    canvasStatus,
    accentColor,
    subjectColor,
    subjectEmoji,
    subjectName,
    heading,
    cleanTitle,
    displayTitle,
    clockStr,
    captionText,
    overtimeStr,
    progressPct,
    progressRatio,
    purityPct,
    todayTotalMs,
    footerText,
    footerTokens,
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
    sectionCount,
  };
}

// ---------------------------------------------------------------------------
// v38 Flagship AMOLED Hardware PiP 2D Canvas Renderer (640x360 @ 2x DPR)
// ---------------------------------------------------------------------------

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, radius);
  } else {
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }
}

function truncateCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let trimmed = text;
  while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed.trimEnd()}…`;
}

function measureTrackedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  trackingPx: number
): number {
  if (!text) return 0;
  let total = 0;
  for (let i = 0; i < text.length; i++) {
    total += ctx.measureText(text[i]).width;
    if (i < text.length - 1) total += trackingPx;
  }
  return total;
}

function drawTrackedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  trackingPx: number
): void {
  let cursor = x;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    ctx.fillText(ch, cursor, y);
    cursor += ctx.measureText(ch).width + trackingPx;
  }
}

function drawMinimalAnalogDial(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  vm: PiPViewModel
): void {
  ctx.save();
  const handAccent = vm.isExamOvertime ? '#FB7185' : '#F5C542';

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = '#0C0909';
  ctx.fill();
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.stroke();

  for (let i = 0; i < 60; i++) {
    const isMajor = i % 5 === 0;
    const ang = (i * 6 - 90) * (Math.PI / 180);
    const rOuter = radius - 6;
    const rInner = isMajor ? radius - 13 : radius - 9;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * rInner, cy + Math.sin(ang) * rInner);
    ctx.lineTo(cx + Math.cos(ang) * rOuter, cy + Math.sin(ang) * rOuter);
    ctx.strokeStyle = isMajor
      ? 'rgba(244, 244, 245, 0.72)'
      : 'rgba(161, 161, 170, 0.24)';
    ctx.lineWidth = isMajor ? 1.5 : 0.85;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  const mAng = (vm.analogAngles.minAngle - 90) * (Math.PI / 180);
  ctx.beginPath();
  ctx.moveTo(cx - Math.cos(mAng) * 6, cy - Math.sin(mAng) * 6);
  ctx.lineTo(cx + Math.cos(mAng) * (radius - 16), cy + Math.sin(mAng) * (radius - 16));
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.stroke();

  const sAng = (vm.analogAngles.secAngle - 90) * (Math.PI / 180);
  ctx.beginPath();
  ctx.moveTo(cx - Math.cos(sAng) * 8, cy - Math.sin(sAng) * 8);
  ctx.lineTo(cx + Math.cos(sAng) * (radius - 9), cy + Math.sin(sAng) * (radius - 9));
  ctx.strokeStyle = handAccent;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = handAccent;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, 1.4, 0, Math.PI * 2);
  ctx.fillStyle = '#000000';
  ctx.fill();

  ctx.restore();
}

export function paintPiPCanvasFrame(
  canvas: HTMLCanvasElement,
  vm: PiPViewModel
): void {
  const W = PIP_CANVAS_LOGICAL_W;
  const H = PIP_CANVAS_LOGICAL_H;
  const targetW = W * PIP_CANVAS_DPR;
  const targetH = H * PIP_CANVAS_DPR;
  if (canvas.width !== targetW) canvas.width = targetW;
  if (canvas.height !== targetH) canvas.height = targetH;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const uiFont = '"Geist Variable", system-ui, -apple-system, "Segoe UI", sans-serif';
  const monoFont =
    '"Geist Mono Variable", ui-monospace, "SF Mono", Menlo, Consolas, monospace';

  ctx.save();
  ctx.setTransform(PIP_CANVAS_DPR, 0, 0, PIP_CANVAS_DPR, 0, 0);

  // 1. Pure AMOLED Obsidian Surface (#0C0909 -> #000000, zero outer double frames)
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, '#0C0909');
  bgGrad.addColorStop(0.58, '#040303');
  bgGrad.addColorStop(1, '#000000');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // 2. Rose Copper Top Skylight (fading to 0 by 55% height; Solar Crimson in Exam Hall Overtime)
  ctx.save();
  ctx.translate(W / 2, 0);
  ctx.scale(1.45, 0.75);
  const skyGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 264);
  if (vm.isExamOvertime) {
    skyGrad.addColorStop(0, 'rgba(244, 63, 94, 0.22)');
    skyGrad.addColorStop(0.45, 'rgba(225, 29, 72, 0.08)');
    skyGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  } else {
    skyGrad.addColorStop(0, 'rgba(251, 146, 60, 0.15)');
    skyGrad.addColorStop(0.45, 'rgba(244, 114, 182, 0.08)');
    skyGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  }
  ctx.fillStyle = skyGrad;
  ctx.fillRect(-W, 0, W * 2, H);
  ctx.restore();

  // Razor-thin 1px top specular copper-peach (or crimson) sheen
  const sheenGrad = ctx.createLinearGradient(0, 0, W, 0);
  const sheenPeak = vm.isExamOvertime
    ? 'rgba(251, 113, 133, 0.36)'
    : 'rgba(254, 215, 170, 0.22)';
  const sheenZero = vm.isExamOvertime
    ? 'rgba(251, 113, 133, 0)'
    : 'rgba(254, 215, 170, 0)';
  sheenGrad.addColorStop(0, sheenZero);
  sheenGrad.addColorStop(0.18, sheenPeak);
  sheenGrad.addColorStop(0.82, sheenPeak);
  sheenGrad.addColorStop(1, sheenZero);
  ctx.fillStyle = sheenGrad;
  ctx.fillRect(0, 0, W, 1);

  // 3. Top Header Row (padding: 26px 32px)
  const padX = 32;
  const headerY = 38;

  // Right: quiet borderless live status indicator (no bordered pill)
  const statusFont = `600 13px ${uiFont}`;
  ctx.font = statusFont;
  const statusTracking = 1.6;
  const statusTextW = measureTrackedText(ctx, vm.canvasStatus.label, statusTracking);
  const statusTextX = W - padX - statusTextW;
  const statusDotX = statusTextX - 12;

  ctx.beginPath();
  ctx.arc(statusDotX, headerY, 4, 0, Math.PI * 2);
  ctx.fillStyle = vm.canvasStatus.dotColor;
  ctx.fill();

  ctx.fillStyle = vm.canvasStatus.textColor;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  drawTrackedText(ctx, vm.canvasStatus.label, statusTextX, headerY + 0.5, statusTracking);

  // Left: crisp 10px semantic subject color dot + clean emoji-free title
  const subjectDotX = padX + 5;
  ctx.beginPath();
  ctx.arc(subjectDotX, headerY, 5, 0, Math.PI * 2);
  ctx.fillStyle = vm.subjectColor;
  ctx.fill();

  ctx.font = `500 18px ${uiFont}`;
  ctx.fillStyle = '#F4F4F5';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const titleX = padX + 20;
  const maxTitleWidth = Math.max(120, statusDotX - 20 - titleX);
  const safeTitle = truncateCanvasText(ctx, vm.cleanTitle, maxTitleWidth);
  ctx.fillText(safeTitle, titleX, headerY + 0.5);

  // 4. Center Focal Clock (Zero hazy cyan/blue glow — crisp pure #FFFFFF numerals)
  const captionColor = vm.isExamOvertime ? '#FDA4AF' : '#FED7AA';

  if (vm.aesthetic === 'retro') {
    drawMinimalAnalogDial(ctx, 134, 166, 56, vm);

    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `700 66px ${monoFont}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 2;
    ctx.fillText(vm.clockStr, 214, 150);
    ctx.restore();

    ctx.font = `500 16px ${uiFont}`;
    ctx.fillStyle = captionColor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const maxCapW = W - padX - 216;
    ctx.fillText(truncateCanvasText(ctx, vm.captionText, maxCapW), 216, 206);
  } else {
    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    ctx.font =
      vm.aesthetic === 'minimal'
        ? `500 82px ${monoFont}`
        : `700 84px ${monoFont}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 2;
    ctx.fillText(vm.clockStr, W / 2, 156);
    ctx.restore();

    // Quiet luminous pale yellow-gold caption directly below digits (zero pill box)
    ctx.font = `500 17px ${uiFont}`;
    ctx.fillStyle = captionColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const captionSafe = truncateCanvasText(ctx, vm.captionText, W - padX * 2);
    ctx.fillText(captionSafe, W / 2, 224);
  }

  // 5. Razor-Thin 3px Progress Track
  const barX = padX;
  const barW = W - padX * 2;
  const barY = 276;
  const barH = 3;

  drawRoundedRectPath(ctx, barX, barY, barW, barH, 1.5);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.09)';
  ctx.fill();

  const clampedRatio = clampPiPProgress(vm.progressRatio);
  const fillW = barW * clampedRatio;
  if (fillW > 0.5) {
    drawRoundedRectPath(ctx, barX, barY, Math.max(3, fillW), barH, 1.5);
    if (vm.isExamOvertime) {
      const fillGrad = ctx.createLinearGradient(barX, 0, barX + Math.max(fillW, 24), 0);
      fillGrad.addColorStop(0, '#FB7185');
      fillGrad.addColorStop(1, '#F43F5E');
      ctx.fillStyle = fillGrad;
    } else if (vm.isBreak) {
      const fillGrad = ctx.createLinearGradient(barX, 0, barX + Math.max(fillW, 24), 0);
      fillGrad.addColorStop(0, '#93C5FD');
      fillGrad.addColorStop(1, '#60A5FA');
      ctx.fillStyle = fillGrad;
    } else {
      ctx.fillStyle = '#F5C542';
    }
    ctx.fill();
  }

  // 6. Single 1px Hairline Divider + Borderless Footer Telemetry on #000000
  const dividerY = 300;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.fillRect(padX, dividerY, barW, 1);

  const footY = 328;
  const ft = vm.footerTokens;
  const labelFont = `500 15px ${uiFont}`;
  const valueFont = `600 15px ${monoFont}`;
  const sepText = '  ·  ';

  const segments: Array<{ text: string; font: string; color: string }> = [
    { text: `${ft.leftLabel} `, font: labelFont, color: '#A1A1AA' },
    { text: ft.leftValue, font: valueFont, color: '#E4E4E7' },
    { text: sepText, font: labelFont, color: '#52525B' },
    { text: `${ft.rightLabel} `, font: labelFont, color: '#A1A1AA' },
    { text: ft.rightValue, font: valueFont, color: '#E4E4E7' },
  ];

  let totalFootW = 0;
  for (const seg of segments) {
    ctx.font = seg.font;
    totalFootW += ctx.measureText(seg.text).width;
  }

  let cursorX = (W - totalFootW) / 2;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const seg of segments) {
    ctx.font = seg.font;
    ctx.fillStyle = seg.color;
    ctx.fillText(seg.text, cursorX, footY);
    cursorX += ctx.measureText(seg.text).width;
  }

  ctx.restore();
}
