import { useCallback, useEffect, useRef } from 'react';
import type { PulseHabitState } from '../types';
import { ensureAudioEngine } from '../utils/audioEngine';
import {
  PIP_BASE_BG,
  computePiPViewModel,
  hexToRgba,
  type PiPViewModel,
} from '../utils/pipHelpers';

interface FloatingPiPActions {
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onTogglePause: () => void;
  onStopAndReflect: () => void;
  onExtendTarget?: (extraMins: number) => void;
  onNextMockSection?: () => void;
  onToast: (msg: string) => void;
}

const LOGICAL_W = 480;
const LOGICAL_H = 270;
const CANVAS_DPR = 2;

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
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

function truncateTextToWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let trimmed = text;
  while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}…`;
}

function drawAnalogDialOnCanvas(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  vm: PiPViewModel
) {
  ctx.save();

  // Outer dial disc
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(27, 32, 41, 0.84)';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.stroke();

  // Inner subtle ring
  ctx.beginPath();
  ctx.arc(cx, cy, radius - 5, 0, Math.PI * 2);
  ctx.lineWidth = 0.75;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.stroke();

  // 60 dial ticks
  for (let i = 0; i < 60; i++) {
    const isMajor = i % 5 === 0;
    const ang = (i * 6 - 90) * (Math.PI / 180);
    const rOuter = radius - 6;
    const rInner = isMajor ? radius - 12 : radius - 9;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * rInner, cy + Math.sin(ang) * rInner);
    ctx.lineTo(cx + Math.cos(ang) * rOuter, cy + Math.sin(ang) * rOuter);
    ctx.strokeStyle = isMajor ? 'rgba(236, 239, 244, 0.75)' : 'rgba(176, 184, 197, 0.28)';
    ctx.lineWidth = isMajor ? 1.5 : 0.8;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  // Target minute dashed hand
  if (vm.analogAngles.targetMinAngle !== null) {
    const tAng = (vm.analogAngles.targetMinAngle - 90) * (Math.PI / 180);
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(tAng) * (radius - 10), cy + Math.sin(tAng) * (radius - 10));
    ctx.strokeStyle = hexToRgba(vm.accentColor, 0.65);
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();
  }

  // Minute hand
  const mAng = (vm.analogAngles.minAngle - 90) * (Math.PI / 180);
  ctx.beginPath();
  ctx.moveTo(cx - Math.cos(mAng) * 5, cy - Math.sin(mAng) * 5);
  ctx.lineTo(cx + Math.cos(mAng) * (radius - 14), cy + Math.sin(mAng) * (radius - 14));
  ctx.strokeStyle = '#ECEFF4';
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Second hand
  const sAng = (vm.analogAngles.secAngle - 90) * (Math.PI / 180);
  ctx.beginPath();
  ctx.moveTo(cx - Math.cos(sAng) * 7, cy - Math.sin(sAng) * 7);
  ctx.lineTo(cx + Math.cos(sAng) * (radius - 8), cy + Math.sin(sAng) * (radius - 8));
  ctx.strokeStyle = vm.accentColor;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Center pin
  ctx.beginPath();
  ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = vm.accentColor;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, 1.4, 0, Math.PI * 2);
  ctx.fillStyle = PIP_BASE_BG;
  ctx.fill();

  ctx.restore();
}

function buildAnalogClockSvg(doc: Document): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('class', 'pip-analog-svg');
  svg.setAttribute('aria-hidden', 'true');

  const outer = doc.createElementNS(ns, 'circle');
  outer.setAttribute('cx', '60');
  outer.setAttribute('cy', '60');
  outer.setAttribute('r', '54');
  outer.setAttribute('fill', 'rgba(27, 32, 41, 0.84)');
  outer.setAttribute('stroke', 'rgba(255, 255, 255, 0.16)');
  outer.setAttribute('stroke-width', '2');
  svg.appendChild(outer);

  const inner = doc.createElementNS(ns, 'circle');
  inner.setAttribute('cx', '60');
  inner.setAttribute('cy', '60');
  inner.setAttribute('r', '48');
  inner.setAttribute('fill', 'none');
  inner.setAttribute('stroke', 'rgba(255, 255, 255, 0.08)');
  inner.setAttribute('stroke-width', '1');
  svg.appendChild(inner);

  for (let i = 0; i < 12; i++) {
    const tick = doc.createElementNS(ns, 'line');
    tick.setAttribute('x1', '60');
    tick.setAttribute('y1', '10');
    tick.setAttribute('x2', '60');
    tick.setAttribute('y2', i % 3 === 0 ? '18' : '15');
    tick.setAttribute('stroke', i % 3 === 0 ? '#ECEFF4' : 'rgba(176, 184, 197, 0.45)');
    tick.setAttribute('stroke-width', i % 3 === 0 ? '2' : '1.2');
    tick.setAttribute('stroke-linecap', 'round');
    tick.setAttribute('transform', `rotate(${i * 30} 60 60)`);
    svg.appendChild(tick);
  }

  const targetLine = doc.createElementNS(ns, 'line');
  targetLine.setAttribute('data-pip-el', 'analog-target');
  targetLine.setAttribute('x1', '60');
  targetLine.setAttribute('y1', '60');
  targetLine.setAttribute('x2', '60');
  targetLine.setAttribute('y2', '16');
  targetLine.setAttribute('stroke', 'var(--pip-accent)');
  targetLine.setAttribute('stroke-opacity', '0.55');
  targetLine.setAttribute('stroke-width', '1.8');
  targetLine.setAttribute('stroke-dasharray', '3 3');
  svg.appendChild(targetLine);

  const minHand = doc.createElementNS(ns, 'line');
  minHand.setAttribute('data-pip-el', 'analog-min');
  minHand.setAttribute('x1', '60');
  minHand.setAttribute('y1', '66');
  minHand.setAttribute('x2', '60');
  minHand.setAttribute('y2', '24');
  minHand.setAttribute('stroke', '#ECEFF4');
  minHand.setAttribute('stroke-width', '3.5');
  minHand.setAttribute('stroke-linecap', 'round');
  svg.appendChild(minHand);

  const secHand = doc.createElementNS(ns, 'line');
  secHand.setAttribute('data-pip-el', 'analog-sec');
  secHand.setAttribute('x1', '60');
  secHand.setAttribute('y1', '68');
  secHand.setAttribute('x2', '60');
  secHand.setAttribute('y2', '16');
  secHand.setAttribute('stroke', 'var(--pip-accent)');
  secHand.setAttribute('stroke-width', '2');
  secHand.setAttribute('stroke-linecap', 'round');
  svg.appendChild(secHand);

  const hub = doc.createElementNS(ns, 'circle');
  hub.setAttribute('cx', '60');
  hub.setAttribute('cy', '60');
  hub.setAttribute('r', '4');
  hub.setAttribute('fill', 'var(--pip-accent)');
  svg.appendChild(hub);

  const pin = doc.createElementNS(ns, 'circle');
  pin.setAttribute('cx', '60');
  pin.setAttribute('cy', '60');
  pin.setAttribute('r', '1.6');
  pin.setAttribute('fill', PIP_BASE_BG);
  svg.appendChild(pin);

  return svg;
}

function ensureDocPiPStructure(docPipWin: Window) {
  const doc = docPipWin.document;
  if (doc.body.querySelector('.pip-glass')) return;

  doc.body.textContent = '';
  const glass = doc.createElement('div');
  glass.className = 'pip-glass';

  const ambient = doc.createElement('div');
  ambient.className = 'pip-ambient';
  glass.appendChild(ambient);

  const sheen = doc.createElement('div');
  sheen.className = 'pip-sheen';
  glass.appendChild(sheen);

  // Header
  const top = doc.createElement('div');
  top.className = 'pip-top';

  const titleWrap = doc.createElement('div');
  titleWrap.className = 'pip-title-wrap';
  const subDot = doc.createElement('span');
  subDot.className = 'pip-sub-dot';
  subDot.setAttribute('aria-hidden', 'true');
  const titleEl = doc.createElement('span');
  titleEl.className = 'pip-title';
  titleEl.setAttribute('data-pip-el', 'title');
  titleWrap.appendChild(subDot);
  titleWrap.appendChild(titleEl);

  const statusPill = doc.createElement('span');
  statusPill.className = 'pip-status-pill';
  statusPill.setAttribute('data-pip-el', 'status-pill');
  const statusDot = doc.createElement('span');
  statusDot.className = 'pip-status-dot';
  statusDot.setAttribute('aria-hidden', 'true');
  const statusTxt = doc.createElement('span');
  statusTxt.setAttribute('data-pip-el', 'status-text');
  statusPill.appendChild(statusDot);
  statusPill.appendChild(statusTxt);

  top.appendChild(titleWrap);
  top.appendChild(statusPill);
  glass.appendChild(top);

  // Stage
  const stage = doc.createElement('div');
  stage.className = 'pip-stage';

  const clockRow = doc.createElement('div');
  clockRow.className = 'pip-clock-row';
  const analogWrap = doc.createElement('div');
  analogWrap.className = 'pip-analog-wrap';
  analogWrap.setAttribute('data-pip-el', 'analog-wrap');
  analogWrap.appendChild(buildAnalogClockSvg(doc));
  const clockEl = doc.createElement('div');
  clockEl.className = 'pip-clock';
  clockEl.setAttribute('data-pip-el', 'clock');
  clockRow.appendChild(analogWrap);
  clockRow.appendChild(clockEl);
  stage.appendChild(clockRow);

  const subline = doc.createElement('div');
  subline.className = 'pip-subline';
  subline.setAttribute('data-pip-el', 'subline');
  stage.appendChild(subline);

  const progressTrack = doc.createElement('div');
  progressTrack.className = 'pip-progress-track';
  progressTrack.setAttribute('data-pip-el', 'progress-track');
  const progressFill = doc.createElement('div');
  progressFill.className = 'pip-progress-fill';
  progressFill.setAttribute('data-pip-el', 'progress-fill');
  progressTrack.appendChild(progressFill);
  stage.appendChild(progressTrack);

  glass.appendChild(stage);

  // Actions
  const actions = doc.createElement('div');
  actions.className = 'pip-actions';

  const toggleBtn = doc.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'pip-btn pip-btn-primary';
  toggleBtn.setAttribute('data-pip-act', 'toggle');
  actions.appendChild(toggleBtn);

  const contextBtn = doc.createElement('button');
  contextBtn.type = 'button';
  contextBtn.className = 'pip-btn pip-btn-context';
  contextBtn.setAttribute('data-pip-act', 'context');
  actions.appendChild(contextBtn);

  const milestoneBadge = doc.createElement('span');
  milestoneBadge.className = 'pip-milestone-badge';
  milestoneBadge.setAttribute('data-pip-el', 'milestone-badge');
  milestoneBadge.hidden = true;
  actions.appendChild(milestoneBadge);

  const stopBtn = doc.createElement('button');
  stopBtn.type = 'button';
  stopBtn.className = 'pip-btn pip-btn-stop';
  stopBtn.setAttribute('data-pip-act', 'stop');
  stopBtn.textContent = '⏹ Stop & Log';
  stopBtn.setAttribute('aria-label', 'Stop timer and log session reflection');
  actions.appendChild(stopBtn);

  glass.appendChild(actions);

  // Footer
  const footer = doc.createElement('div');
  footer.className = 'pip-footer';
  footer.setAttribute('data-pip-el', 'footer');
  glass.appendChild(footer);

  doc.body.appendChild(glass);

  // Pointer-tracking frosted glass sheen
  const prefersReduced =
    typeof docPipWin.matchMedia === 'function' &&
    docPipWin.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!prefersReduced) {
    glass.addEventListener('mousemove', (ev) => {
      const rect = glass.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const xPct = Math.round(((ev.clientX - rect.left) / rect.width) * 100);
      const yPct = Math.round(((ev.clientY - rect.top) / rect.height) * 100);
      doc.body.style.setProperty('--sheen-x', `${xPct}%`);
      doc.body.style.setProperty('--sheen-y', `${yPct}%`);
      doc.body.style.setProperty('--sheen-on', '1');
    });
    glass.addEventListener('mouseleave', () => {
      doc.body.style.setProperty('--sheen-on', '0');
    });
  }
}

export function useFloatingTimerPiP(
  state: PulseHabitState,
  actions: FloatingPiPActions
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const docPipWinRef = useRef<Window | null>(null);
  const combinedStreamRef = useRef<MediaStream | null>(null);
  const canvasTrackRef = useRef<MediaStreamTrack | null>(null);
  const videoListenersAttachedRef = useRef(false);
  const syncGuardRef = useRef(false);
  const stateRef = useRef(state);
  const actionsRef = useRef(actions);

  stateRef.current = state;
  actionsRef.current = actions;

  const pushCanvasFrame = useCallback(() => {
    const track = canvasTrackRef.current as
      | (MediaStreamTrack & { requestFrame?: () => void })
      | null;
    if (track && typeof track.requestFrame === 'function') {
      try {
        track.requestFrame();
      } catch {
        // ignore if stream is inactive
      }
    }
  }, []);

  // High-DPI 2x Frosted Graphite + Lumen V2 Canvas Picture-in-Picture (960x540 -> logical 480x270)
  const drawCanvasFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = LOGICAL_W;
    const H = LOGICAL_H;
    const targetW = W * CANVAS_DPR;
    const targetH = H * CANVAS_DPR;
    if (canvas.width !== targetW) canvas.width = targetW;
    if (canvas.height !== targetH) canvas.height = targetH;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const curState = stateRef.current;
    const now = Date.now();
    const vm = computePiPViewModel(curState, now);

    const reducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const breathPulse =
      vm.isRunning && !reducedMotion
        ? 0.84 + 0.16 * (0.5 + 0.5 * Math.sin(now / 850))
        : 0.78;

    ctx.save();
    ctx.setTransform(CANVAS_DPR, 0, 0, CANVAS_DPR, 0, 0);

    // 1. Deep Graphite Base (#0B0D10)
    ctx.fillStyle = PIP_BASE_BG;
    ctx.fillRect(0, 0, W, H);

    // 2. Subtle Radial Ambient Backlight behind clock
    const glowCenterX = vm.aesthetic === 'retro' ? W * 0.54 : W / 2;
    const glowCenterY = H * 0.46;
    const ambientGrad = ctx.createRadialGradient(
      glowCenterX,
      glowCenterY,
      10,
      glowCenterX,
      glowCenterY,
      205
    );
    ambientGrad.addColorStop(
      0,
      hexToRgba(vm.accentColor, (vm.isActive ? 0.24 : 0.11) * breathPulse)
    );
    ambientGrad.addColorStop(
      0.55,
      hexToRgba(vm.accentColor, (vm.isActive ? 0.08 : 0.03) * breathPulse)
    );
    ambientGrad.addColorStop(1, 'rgba(11, 13, 16, 0)');
    ctx.fillStyle = ambientGrad;
    ctx.fillRect(0, 0, W, H);

    // 3. Translucent Frosted Glass Card (rgba(20, 24, 31, 0.76)) + 1px Specular Edge
    const padX = 12;
    const padY = 12;
    const cardW = W - padX * 2;
    const cardH = H - padY * 2;
    const cardR = 18;

    ctx.save();
    drawRoundedRectPath(ctx, padX, padY, cardW, cardH, cardR);
    ctx.fillStyle = 'rgba(20, 24, 31, 0.76)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.stroke();

    // 1px Specular top edge highlight inside card
    ctx.beginPath();
    ctx.moveTo(padX + cardR, padY + 0.75);
    ctx.lineTo(padX + cardW - cardR, padY + 0.75);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // 4. Header Row: Subject dot + Title (Left), Compact Status Pill (Right)
    const pillPadX = 12;
    ctx.font = '700 12px "Geist Variable", system-ui, -apple-system, sans-serif';
    const statusTextW = ctx.measureText(vm.statusLabel).width;
    const pillW = Math.max(76, statusTextW + pillPadX * 2 + 14);
    const pillH = 26;
    const pillX = padX + cardW - 14 - pillW;
    const pillY = padY + 12;

    // Status pill background
    drawRoundedRectPath(ctx, pillX, pillY, pillW, pillH, 13);
    ctx.fillStyle =
      vm.statusTone === 'lumen'
        ? 'rgba(245, 196, 81, 0.15)'
        : vm.statusTone === 'break'
          ? 'rgba(96, 165, 250, 0.16)'
          : 'rgba(27, 32, 41, 0.85)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle =
      vm.statusTone === 'lumen'
        ? 'rgba(245, 196, 81, 0.36)'
        : vm.statusTone === 'break'
          ? 'rgba(96, 165, 250, 0.36)'
          : 'rgba(255, 255, 255, 0.12)';
    ctx.stroke();

    // Status dot inside pill
    ctx.beginPath();
    ctx.arc(pillX + 12, pillY + pillH / 2, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = vm.accentColor;
    ctx.fill();

    // Status pill text
    ctx.fillStyle =
      vm.statusTone === 'lumen'
        ? '#F5C451'
        : vm.statusTone === 'break'
          ? '#93C5FD'
          : '#ECEFF4';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(vm.statusLabel, pillX + 20, pillY + pillH / 2 + 0.5);

    // Subject color dot + Heading
    ctx.beginPath();
    ctx.arc(padX + 22, pillY + pillH / 2, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = vm.subjectColor;
    ctx.fill();

    ctx.font = '600 15px "Geist Variable", system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#ECEFF4';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const maxTitleWidth = Math.max(80, pillX - (padX + 34) - 10);
    const titleStr = truncateTextToWidth(ctx, vm.displayTitle, maxTitleWidth);
    ctx.fillText(titleStr, padX + 34, pillY + pillH / 2 + 0.5);

    // 5. Center Clock Stage (Digital, Mono, or Analog Dial)
    const monoFontFamily =
      '"Geist Mono Variable", ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    const clockFill =
      vm.statusTone === 'lumen'
        ? '#F5C451'
        : vm.statusTone === 'break'
          ? '#93C5FD'
          : '#ECEFF4';

    if (vm.aesthetic === 'retro') {
      drawAnalogDialOnCanvas(ctx, 118, 128, 48, vm);

      ctx.save();
      ctx.fillStyle = clockFill;
      ctx.font = `700 48px ${monoFontFamily}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      if (vm.isRunning) {
        ctx.shadowColor = hexToRgba(vm.accentColor, 0.32 * breathPulse);
        ctx.shadowBlur = 16;
      }
      ctx.fillText(vm.clockStr, 188, 118);
      ctx.restore();

      // Context subtitle right below Analog clock
      ctx.font = `600 13px ${monoFontFamily}`;
      ctx.fillStyle = vm.isOvertime ? '#F5C451' : '#B0B8C5';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const subCaption = vm.isStopwatch
        ? vm.stopwatchMilestone.label
        : vm.overtimeStr
          ? `Flow Overtime ${vm.overtimeStr}`
          : `${Math.round(vm.progressPct)}% · ${vm.mode === 'fullMock' ? 'Full Mock' : vm.mode === 'countdown' ? 'Countdown' : 'Pomodoro'}`;
      ctx.fillText(subCaption, 190, 154);

      if (!vm.isStopwatch) {
        const barX = 190;
        const barY = 171;
        const barW = 248;
        const barH = 4;
        drawRoundedRectPath(ctx, barX, barY, barW, barH, 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.09)';
        ctx.fill();

        const fillW = Math.max(0, (barW * vm.progressPct) / 100);
        if (fillW > 0) {
          drawRoundedRectPath(ctx, barX, barY, fillW, barH, 2);
          ctx.fillStyle = vm.accentColor;
          ctx.fill();
        }
      }
    } else {
      ctx.save();
      ctx.fillStyle = clockFill;
      ctx.font =
        vm.aesthetic === 'minimal'
          ? `400 62px ${monoFontFamily}`
          : `800 64px ${monoFontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (vm.aesthetic === 'neon' && vm.isActive) {
        ctx.shadowColor = hexToRgba(vm.accentColor, 0.36 * breathPulse);
        ctx.shadowBlur = 20;
      }
      ctx.fillText(vm.clockStr, W / 2, 116);
      ctx.restore();

      // Progress Bar (Pomodoro / Countdown / Full Mock) OR 15m Milestone Pill (Stopwatch)
      if (vm.isStopwatch) {
        const badgeText = vm.isActive
          ? `15m Milestone · ${vm.stopwatchMilestone.remainingStr} left`
          : 'Stopwatch · 15m milestone markers';
        ctx.font = `600 13px ${monoFontFamily}`;
        const bw = Math.min(340, ctx.measureText(badgeText).width + 26);
        const bx = (W - bw) / 2;
        const by = 160;
        drawRoundedRectPath(ctx, bx, by, bw, 24, 12);
        ctx.fillStyle = 'rgba(245, 196, 81, 0.11)';
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(245, 196, 81, 0.28)';
        ctx.stroke();

        ctx.fillStyle = '#F5C451';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(badgeText, W / 2, by + 12.5);
      } else {
        const barW = 296;
        const barH = 4;
        const barX = (W - barW) / 2;
        const barY = 164;
        drawRoundedRectPath(ctx, barX, barY, barW, barH, 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.09)';
        ctx.fill();

        const fillW = Math.max(0, (barW * vm.progressPct) / 100);
        if (fillW > 0) {
          ctx.save();
          drawRoundedRectPath(ctx, barX, barY, fillW, barH, 2);
          ctx.fillStyle = vm.accentColor;
          ctx.shadowColor = hexToRgba(vm.accentColor, 0.45);
          ctx.shadowBlur = 8;
          ctx.fill();
          ctx.restore();
        }

        ctx.font = `600 12px ${monoFontFamily}`;
        ctx.fillStyle = vm.isOvertime ? '#F5C451' : '#B0B8C5';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const subText = vm.overtimeStr
          ? `Flow Overtime ${vm.overtimeStr}`
          : vm.isActive
            ? `${Math.round(vm.progressPct)}% complete${vm.mode === 'fullMock' && vm.sectionCount > 0 ? ` · ${vm.sectionCount} splits` : ''}`
            : `${vm.mode === 'fullMock' ? 'Full Mock' : vm.mode === 'countdown' ? 'Countdown' : 'Pomodoro'} · Press Play`;
        ctx.fillText(subText, W / 2, 183);
      }
    }

    // 6. Clean Single-Line Frosted Footer (Purity X% · Today Yh Zm)
    const footX = padX + 12;
    const footY = H - padY - 38;
    const footW = cardW - 24;
    const footH = 28;
    drawRoundedRectPath(ctx, footX, footY, footW, footH, 10);
    ctx.fillStyle = 'rgba(27, 32, 41, 0.72)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.stroke();

    ctx.font = '600 13px "Geist Variable", system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#B0B8C5';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(vm.footerText, W / 2, footY + footH / 2 + 0.5);

    ctx.restore();
    pushCanvasFrame();
  }, [pushCanvasFrame]);

  const renderDocPiP = useCallback(() => {
    const docPipWin = docPipWinRef.current;
    if (!docPipWin || docPipWin.closed) return;

    ensureDocPiPStructure(docPipWin);
    const doc = docPipWin.document;
    const vm = computePiPViewModel(stateRef.current, Date.now());

    doc.body.className = `pip-body aesthetic-${vm.aesthetic}`;
    doc.body.dataset.tone = vm.statusTone;
    doc.body.style.setProperty('--pip-accent', vm.accentColor);
    doc.body.style.setProperty('--pip-subject', vm.subjectColor);
    doc.body.style.setProperty('--pip-glow', hexToRgba(vm.accentColor, 0.24));

    const titleEl = doc.querySelector('[data-pip-el="title"]');
    if (titleEl) titleEl.textContent = vm.displayTitle;

    const statusPill = doc.querySelector('[data-pip-el="status-pill"]') as HTMLElement | null;
    if (statusPill) statusPill.dataset.tone = vm.statusTone;
    const statusText = doc.querySelector('[data-pip-el="status-text"]');
    if (statusText) statusText.textContent = vm.statusLabel;

    const clockEl = doc.querySelector('[data-pip-el="clock"]');
    if (clockEl) clockEl.textContent = vm.clockStr;

    const minHand = doc.querySelector('[data-pip-el="analog-min"]');
    if (minHand) {
      minHand.setAttribute('transform', `rotate(${vm.analogAngles.minAngle} 60 60)`);
    }
    const secHand = doc.querySelector('[data-pip-el="analog-sec"]');
    if (secHand) {
      secHand.setAttribute('transform', `rotate(${vm.analogAngles.secAngle} 60 60)`);
    }
    const targetHand = doc.querySelector('[data-pip-el="analog-target"]') as SVGElement | null;
    if (targetHand) {
      if (vm.analogAngles.targetMinAngle !== null) {
        targetHand.style.display = '';
        targetHand.setAttribute(
          'transform',
          `rotate(${vm.analogAngles.targetMinAngle} 60 60)`
        );
      } else {
        targetHand.style.display = 'none';
      }
    }

    const subline = doc.querySelector('[data-pip-el="subline"]');
    if (subline) {
      subline.textContent = vm.isStopwatch
        ? vm.stopwatchMilestone.label
        : vm.overtimeStr
          ? `Flow Overtime ${vm.overtimeStr}`
          : vm.isActive
            ? `${Math.round(vm.progressPct)}% of target`
            : 'Ready to focus';
    }

    const progressTrack = doc.querySelector(
      '[data-pip-el="progress-track"]'
    ) as HTMLElement | null;
    const progressFill = doc.querySelector(
      '[data-pip-el="progress-fill"]'
    ) as HTMLElement | null;
    if (progressTrack && progressFill) {
      progressTrack.hidden = vm.isStopwatch;
      progressFill.style.width = `${vm.progressPct}%`;
    }

    const toggleBtn = doc.querySelector('[data-pip-act="toggle"]') as HTMLButtonElement | null;
    if (toggleBtn) {
      toggleBtn.dataset.lumen = vm.isRunning ? '0' : '1';
      toggleBtn.textContent = vm.isRunning
        ? '⏸ Pause'
        : vm.isPaused
          ? '▶ Resume'
          : '▶ Start';
      toggleBtn.setAttribute(
        'aria-label',
        vm.isRunning ? 'Pause study timer' : vm.isPaused ? 'Resume study timer' : 'Start study timer'
      );
    }

    const contextBtn = doc.querySelector(
      '[data-pip-act="context"]'
    ) as HTMLButtonElement | null;
    const milestoneBadge = doc.querySelector(
      '[data-pip-el="milestone-badge"]'
    ) as HTMLElement | null;

    if (vm.contextAction.kind === 'milestone') {
      if (contextBtn) contextBtn.hidden = true;
      if (milestoneBadge) {
        milestoneBadge.hidden = false;
        milestoneBadge.textContent = vm.contextAction.label;
        milestoneBadge.setAttribute('aria-label', vm.contextAction.ariaLabel);
      }
    } else {
      if (milestoneBadge) milestoneBadge.hidden = true;
      if (contextBtn) {
        contextBtn.hidden = !vm.isActive;
        contextBtn.textContent = vm.contextAction.label;
        contextBtn.setAttribute('aria-label', vm.contextAction.ariaLabel);
      }
    }

    const stopBtn = doc.querySelector('[data-pip-act="stop"]') as HTMLButtonElement | null;
    if (stopBtn) {
      stopBtn.hidden = !vm.isActive;
    }

    const footerEl = doc.querySelector('[data-pip-el="footer"]');
    if (footerEl) footerEl.textContent = vm.footerText;
  }, []);

  // Preserve PiP Callback Guards: never mutate stateRef.current.activeTimer directly
  const handleExternalResumeOrStart = useCallback(() => {
    ensureAudioEngine();
    const cur = stateRef.current;
    if (!cur.activeTimer) {
      actionsRef.current.onStart();
    } else if (cur.activeTimer.status === 'paused') {
      actionsRef.current.onResume();
    }
    drawCanvasFrame();
    renderDocPiP();
    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      try {
        navigator.mediaSession.playbackState = 'playing';
      } catch {
        // ignore
      }
    }
    const video = videoRef.current;
    if (video && video.paused) {
      syncGuardRef.current = true;
      video
        .play()
        .catch(() => {})
        .finally(() => {
          syncGuardRef.current = false;
        });
    }
  }, [drawCanvasFrame, renderDocPiP]);

  const handleExternalPause = useCallback(() => {
    const cur = stateRef.current;
    if (cur.activeTimer?.status === 'running') {
      actionsRef.current.onPause();
    }
    drawCanvasFrame();
    renderDocPiP();
    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      try {
        navigator.mediaSession.playbackState = 'paused';
      } catch {
        // ignore
      }
    }
  }, [drawCanvasFrame, renderDocPiP]);

  const handleExternalContextAction = useCallback(() => {
    const cur = stateRef.current;
    if (!cur.activeTimer) return;
    const vm = computePiPViewModel(cur, Date.now());
    if (vm.contextAction.kind === 'nextSection') {
      actionsRef.current.onNextMockSection?.();
    } else if (vm.contextAction.kind === 'extend5') {
      actionsRef.current.onExtendTarget?.(5);
    } else {
      actionsRef.current.onToast(vm.stopwatchMilestone.label);
    }
    drawCanvasFrame();
    renderDocPiP();
  }, [drawCanvasFrame, renderDocPiP]);

  const openDocumentPiP = useCallback(async () => {
    const w = window as unknown as {
      documentPictureInPicture?: {
        requestWindow: (opts: { width: number; height: number }) => Promise<Window>;
      };
    };
    if (!w.documentPictureInPicture) return false;
    try {
      const docPipWin = await w.documentPictureInPicture.requestWindow({
        width: 320,
        height: 210,
      });
      docPipWinRef.current = docPipWin;
      docPipWin.document.title = 'Deep Hours · Floating Focus';

      const base = docPipWin.document.createElement('base');
      base.href = `${window.location.origin}/`;
      docPipWin.document.head.appendChild(base);

      [...document.styleSheets].forEach((ss) => {
        try {
          const cssRules = [...ss.cssRules].map((r) => r.cssText).join('');
          const style = docPipWin.document.createElement('style');
          style.textContent = cssRules;
          docPipWin.document.head.appendChild(style);
        } catch {
          if (ss.href) {
            const link = docPipWin.document.createElement('link');
            link.rel = 'stylesheet';
            link.href = ss.href;
            docPipWin.document.head.appendChild(link);
          }
        }
      });

      docPipWin.document.body.className = 'pip-body';
      renderDocPiP();

      docPipWin.document.body.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const b = target.closest('[data-pip-act]') as HTMLElement | null;
        if (!b) return;
        const act = b.dataset.pipAct;
        if (act === 'toggle') {
          if (!stateRef.current.activeTimer) {
            handleExternalResumeOrStart();
          } else if (stateRef.current.activeTimer.status === 'paused') {
            handleExternalResumeOrStart();
          } else {
            handleExternalPause();
          }
        } else if (act === 'context') {
          handleExternalContextAction();
        } else if (act === 'stop') {
          actionsRef.current.onStopAndReflect();
          docPipWin.close();
        }
      });

      docPipWin.addEventListener('pagehide', () => {
        docPipWinRef.current = null;
      });
      return true;
    } catch {
      return false;
    }
  }, [
    handleExternalContextAction,
    handleExternalPause,
    handleExternalResumeOrStart,
    renderDocPiP,
  ]);

  const setupMediaSessionHandlers = useCallback(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      const curState = stateRef.current;
      const now = Date.now();
      const vm = computePiPViewModel(curState, now);

      if (typeof MediaMetadata !== 'undefined') {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: `${vm.displayTitle} · ${vm.clockStr}`,
          artist: vm.overtimeStr
            ? `${vm.statusLabel} ${vm.overtimeStr} · Deep Hours`
            : `${vm.statusLabel} · ${vm.footerText}`,
          album: 'Deep Hours',
          artwork: [
            {
              src: '/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
            },
          ],
        });
      }

      navigator.mediaSession.playbackState = vm.isRunning
        ? 'playing'
        : vm.isPaused
          ? 'paused'
          : 'none';

      navigator.mediaSession.setActionHandler('play', () => {
        handleExternalResumeOrStart();
      });

      navigator.mediaSession.setActionHandler('pause', () => {
        handleExternalPause();
      });

      navigator.mediaSession.setActionHandler('stop', () => {
        if (stateRef.current.activeTimer) {
          actionsRef.current.onStopAndReflect();
        }
      });

      try {
        navigator.mediaSession.setActionHandler('nexttrack', () => {
          handleExternalContextAction();
        });
      } catch {
        // nexttrack action not supported
      }

      try {
        navigator.mediaSession.setActionHandler(
          'enterpictureinpicture' as MediaSessionAction,
          async () => {
            const video = videoRef.current;
            if (
              video &&
              typeof video.requestPictureInPicture === 'function' &&
              !document.pictureInPictureElement
            ) {
              try {
                await video.requestPictureInPicture();
                return;
              } catch {
                // fallback to Document PiP
              }
            }
            await openDocumentPiP();
          }
        );
      } catch {
        // enterpictureinpicture action not supported
      }
    } catch {
      // ignore mediaSession errors
    }
  }, [
    handleExternalContextAction,
    handleExternalPause,
    handleExternalResumeOrStart,
    openDocumentPiP,
  ]);

  const initVideoStream = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;

    const { audioTracks } = ensureAudioEngine();
    drawCanvasFrame();

    if (typeof canvas.captureStream === 'function') {
      if (!combinedStreamRef.current) {
        const canvasStream = canvas.captureStream(15);
        canvasTrackRef.current = canvasStream.getVideoTracks()[0] || null;
        combinedStreamRef.current = new MediaStream([
          ...canvasStream.getVideoTracks(),
          ...audioTracks,
        ]);
      } else if (
        audioTracks.length > 0 &&
        combinedStreamRef.current.getAudioTracks().length === 0
      ) {
        audioTracks.forEach((track) => combinedStreamRef.current?.addTrack(track));
      }

      if (video.srcObject !== combinedStreamRef.current) {
        video.srcObject = combinedStreamRef.current;
      }

      // Crucial Android Chrome requirement: keep <video> unmuted with the 0.001 gain oscillator track
      video.muted = false;
      video.removeAttribute('muted');
      video.volume = 1.0;

      (
        video as HTMLVideoElement & {
          autoPictureInPicture?: boolean;
          disablePictureInPicture?: boolean;
        }
      ).autoPictureInPicture = true;
      (
        video as HTMLVideoElement & { disablePictureInPicture?: boolean }
      ).disablePictureInPicture = false;
      video.setAttribute('autopictureinpicture', '');

      if (!videoListenersAttachedRef.current) {
        video.addEventListener('pause', () => {
          if (syncGuardRef.current) return;
          if (stateRef.current.activeTimer?.status === 'running') {
            syncGuardRef.current = true;
            handleExternalPause();
            syncGuardRef.current = false;
          }
        });

        video.addEventListener('play', () => {
          if (syncGuardRef.current) return;
          syncGuardRef.current = true;
          handleExternalResumeOrStart();
          syncGuardRef.current = false;
        });

        videoListenersAttachedRef.current = true;
      }
    }

    setupMediaSessionHandlers();
    try {
      syncGuardRef.current = true;
      await video.play();
    } catch {
      // ignore autoplay block until user gesture
    } finally {
      syncGuardRef.current = false;
    }
    return video;
  }, [
    drawCanvasFrame,
    handleExternalPause,
    handleExternalResumeOrStart,
    setupMediaSessionHandlers,
  ]);

  const togglePiP = useCallback(
    async (forceMode?: 'video' | 'doc') => {
      if (!stateRef.current.activeTimer) {
        actionsRef.current.onStart();
      }

      if (docPipWinRef.current && !docPipWinRef.current.closed) {
        docPipWinRef.current.close();
        docPipWinRef.current = null;
        return;
      }
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture().catch(() => {});
        return;
      }

      const pref = forceMode || stateRef.current.set.pipPref || 'video';
      const isAndroid = /Android/i.test(navigator.userAgent);

      if (pref === 'doc' && !isAndroid && 'documentPictureInPicture' in window) {
        const ok = await openDocumentPiP();
        if (ok) {
          actionsRef.current.onToast('Floating Document PiP active');
          return;
        }
      }

      try {
        const video = await initVideoStream();
        if (video && typeof video.requestPictureInPicture === 'function') {
          await video.requestPictureInPicture();
          actionsRef.current.onToast('Floating PiP active · Switch to your lecture app');
          return;
        }
      } catch {
        // fallback below
      }

      if ('documentPictureInPicture' in window) {
        const ok = await openDocumentPiP();
        if (ok) {
          actionsRef.current.onToast('Floating Document PiP active');
          return;
        }
      }

      drawCanvasFrame();
      actionsRef.current.onToast('Timer stream active for Picture-in-Picture');
    },
    [drawCanvasFrame, initVideoStream, openDocumentPiP]
  );

  const syncState = useCallback(() => {
    drawCanvasFrame();
    renderDocPiP();
    setupMediaSessionHandlers();

    const activeTimer = stateRef.current.activeTimer;
    const isRun = activeTimer?.status === 'running';
    const video = videoRef.current;

    if (video) {
      if (activeTimer) {
        (
          video as HTMLVideoElement & { autoPictureInPicture?: boolean }
        ).autoPictureInPicture = true;
        video.setAttribute('autopictureinpicture', '');
      } else {
        (
          video as HTMLVideoElement & { autoPictureInPicture?: boolean }
        ).autoPictureInPicture = false;
        video.removeAttribute('autopictureinpicture');
      }
    }

    if (isRun && !combinedStreamRef.current) {
      void initVideoStream();
      return;
    }

    if (video && combinedStreamRef.current) {
      syncGuardRef.current = true;
      if (isRun && video.paused) {
        ensureAudioEngine();
        video
          .play()
          .catch(() => {})
          .finally(() => {
            syncGuardRef.current = false;
          });
      } else if (!isRun && !video.paused && document.pictureInPictureElement === video) {
        video.pause();
        syncGuardRef.current = false;
      } else {
        syncGuardRef.current = false;
      }
    }
  }, [drawCanvasFrame, initVideoStream, renderDocPiP, setupMediaSessionHandlers]);

  const renderTick = useCallback(() => {
    drawCanvasFrame();
    renderDocPiP();
    if (stateRef.current.activeTimer) {
      setupMediaSessionHandlers();
    }
  }, [drawCanvasFrame, renderDocPiP, setupMediaSessionHandlers]);

  const closePiP = useCallback(() => {
    if (docPipWinRef.current && !docPipWinRef.current.closed) {
      docPipWinRef.current.close();
      docPipWinRef.current = null;
    }
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {});
    }
  }, []);

  useEffect(() => {
    syncState();
  }, [
    state.activeTimer?.status,
    state.activeTimer?.phase,
    state.activeTimer?.subjectId,
    state.activeTimer?.heading,
    state.activeTimer?.mode,
    state.activeTimer?.targetMs,
    state.activeTimer?.mockSections?.length,
    state.set.timerAesthetic,
    syncState,
  ]);

  useEffect(() => {
    const onVis = () => {
      syncState();
      if (
        document.visibilityState === 'hidden' &&
        stateRef.current.activeTimer?.status === 'running'
      ) {
        const video = videoRef.current;
        if (
          video &&
          typeof video.requestPictureInPicture === 'function' &&
          !document.pictureInPictureElement
        ) {
          video.requestPictureInPicture().catch(() => {});
        }
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [syncState]);

  return {
    canvasRef,
    videoRef,
    togglePiP,
    syncState,
    renderTick,
    closePiP,
  };
}
