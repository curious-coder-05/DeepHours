import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Layers, Share2 } from 'lucide-react';
import type { StudySession, Subject } from '../types';
import {
  buildMonolithSeries,
  computeMonolithScale,
  formatGoalHoursLabel,
  formatMinutesCompact,
  shadeHexColor,
} from '../utils/insightsCanvas';
import { triggerHaptic } from '../utils/haptics';

interface StudyMonolithCanvasProps {
  sessions: ReadonlyArray<StudySession>;
  subjects: ReadonlyArray<Subject>;
  todayKey: string;
  dailyGoalMin: number;
  onInspectDay: (dayKey: string) => void;
  onShareTodayProof?: () => void;
}

const PLINTH_H = 4;
const PILLAR_ANIM_DURATION_MS = 380;
const STAGGER_7D_MS = 28;
const STAGGER_14D_MS = 16;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function drawPrism(
  ctx: CanvasRenderingContext2D,
  x: number,
  yTop: number,
  w: number,
  h: number,
  dx: number,
  dy: number,
  frontFill: string | CanvasGradient,
  rightFill: string | CanvasGradient,
  topFill: string | CanvasGradient,
  rimStroke?: string,
  drawTop = true
): void {
  // Front face
  ctx.fillStyle = frontFill;
  ctx.beginPath();
  ctx.rect(x, yTop, w, h);
  ctx.fill();

  // Right isometric face
  ctx.fillStyle = rightFill;
  ctx.beginPath();
  ctx.moveTo(x + w, yTop);
  ctx.lineTo(x + w + dx, yTop + dy);
  ctx.lineTo(x + w + dx, yTop + h + dy);
  ctx.lineTo(x + w, yTop + h);
  ctx.closePath();
  ctx.fill();

  // Top diamond cap
  if (drawTop) {
    ctx.fillStyle = topFill;
    ctx.beginPath();
    ctx.moveTo(x, yTop);
    ctx.lineTo(x + dx, yTop + dy);
    ctx.lineTo(x + w + dx, yTop + dy);
    ctx.lineTo(x + w, yTop);
    ctx.closePath();
    ctx.fill();

    if (rimStroke) {
      ctx.strokeStyle = rimStroke;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, yTop + 0.5);
      ctx.lineTo(x + w - 0.5, yTop + 0.5);
      ctx.lineTo(x + w + dx - 0.5, yTop + dy + 0.5);
      ctx.stroke();
    }
  }
}

export const StudyMonolithCanvas: React.FC<StudyMonolithCanvasProps> = ({
  sessions,
  subjects,
  todayKey,
  dailyGoalMin,
  onInspectDay,
  onShareTodayProof,
}) => {
  const [rangeDays, setRangeDays] = useState<7 | 14>(7);
  const [stackMode, setStackMode] = useState<boolean>(false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [isPointerActive, setIsPointerActive] = useState<boolean>(false);
  const [canvasWidth, setCanvasWidth] = useState<number>(320);
  const [isDesktop, setIsDesktop] = useState<boolean>(false);
  const [hasEnteredViewport, setHasEnteredViewport] = useState<boolean>(
    () => typeof IntersectionObserver === 'undefined' || prefersReducedMotion()
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const animStartTsRef = useRef<number>(0);
  const animDoneRef = useRef<boolean>(prefersReducedMotion());
  const measuredSizeRef = useRef<{ w: number; desktop: boolean } | null>(null);

  const cancelAnimationLoop = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  const series = useMemo(
    () => buildMonolithSeries(todayKey, sessions, subjects, rangeDays, dailyGoalMin),
    [todayKey, sessions, subjects, rangeDays, dailyGoalMin]
  );

  const maxMinutes = useMemo(
    () => series.reduce((m, entry) => Math.max(m, entry.totalMin), 0),
    [series]
  );

  const scale = useMemo(
    () => computeMonolithScale(maxMinutes, dailyGoalMin),
    [maxMinutes, dailyGoalMin]
  );

  // Reset manual selection if range shrinks past selectedIdx
  useEffect(() => {
    setSelectedIdx((prev) => {
      if (prev === null) return null;
      return prev >= series.length ? series.length - 1 : prev;
    });
  }, [series.length]);

  // Trigger initial entrance sweep only once canvas enters viewport
  useEffect(() => {
    if (hasEnteredViewport) return;
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setHasEnteredViewport(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setHasEnteredViewport(true);
          io.disconnect();
        }
      },
      { threshold: 0.1 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasEnteredViewport]);

  // Measure container width via ResizeObserver; cancel active animation on subsequent resizes
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      const nextW = rect.width > 0 ? Math.round(rect.width) : 0;
      const nextDesktop = typeof window !== 'undefined' && window.innerWidth >= 768;
      const prev = measuredSizeRef.current;
      if (
        prev !== null &&
        ((nextW > 0 && nextW !== prev.w) || nextDesktop !== prev.desktop)
      ) {
        cancelAnimationLoop();
        animDoneRef.current = true;
      }
      if (nextW > 0) {
        measuredSizeRef.current = { w: nextW, desktop: nextDesktop };
        setCanvasWidth(nextW);
      }
      setIsDesktop(nextDesktop);
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [cancelAnimationLoop]);

  // Ensure rAF loop is always cancelled cleanly on unmount
  useEffect(() => () => cancelAnimationLoop(), [cancelAnimationLoop]);

  const defaultIdx = series.length > 0 ? series.length - 1 : 0;
  const activeIdx =
    selectedIdx !== null && selectedIdx >= 0 && selectedIdx < series.length
      ? selectedIdx
      : defaultIdx;
  const activeEntry = series[activeIdx] || null;
  const isScrubHighlighted = isPointerActive || selectedIdx !== null;

  const canvasHeight = isDesktop ? 250 : 225;
  const padLeft = 30;
  const padRight = 14;
  const padTop = 26;
  const padBottom = 26;

  const renderStateRef = useRef({
    series,
    scale,
    dailyGoalMin,
    rangeDays,
    stackMode,
    activeIdx,
    isScrubHighlighted,
    canvasWidth,
    canvasHeight,
    hasEnteredViewport,
  });
  renderStateRef.current = {
    series,
    scale,
    dailyGoalMin,
    rangeDays,
    stackMode,
    activeIdx,
    isScrubHighlighted,
    canvasWidth,
    canvasHeight,
    hasEnteredViewport,
  };

  // High-DPI Canvas Frame Painter (reads latest renderStateRef so hover/scrub/stack never restart entrance)
  const paintFrame = useCallback((nowTs: number | null): boolean => {
    const canvas = canvasRef.current;
    const st = renderStateRef.current;
    if (!canvas || st.series.length === 0 || st.canvasWidth <= 0) return true;
    const ctx = canvas.getContext('2d');
    if (!ctx) return true;

    const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    const width = st.canvasWidth;
    const height = st.canvasHeight;

    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const plotW = Math.max(40, width - padLeft - padRight);
    const plotH = Math.max(60, height - padTop - padBottom);
    const baseY = padTop + plotH;

    const N = st.series.length;
    const slotW = plotW / N;
    const barW =
      st.rangeDays === 7
        ? Math.min(34, Math.max(16, Math.round(slotW * 0.44)))
        : Math.min(18, Math.max(9, Math.round(slotW * 0.48)));
    const dx = Math.min(11, Math.max(5, Math.round(barW * 0.34)));
    const dy = -Math.round(dx * 0.56);

    const yForMin = (mins: number) =>
      baseY - (Math.max(0, Math.min(st.scale.maxMin, mins)) / st.scale.maxMin) * plotH;

    const goalY = Math.round(yForMin(st.dailyGoalMin)) + 0.5;
    const staggerMs = st.rangeDays === 7 ? STAGGER_7D_MS : STAGGER_14D_MS;
    const totalSweepMs = Math.max(0, N - 1) * staggerMs + PILLAR_ANIM_DURATION_MS;
    const elapsedMs = nowTs !== null ? Math.max(0, nowTs - animStartTsRef.current) : totalSweepMs;
    const allSettled = animDoneRef.current || nowTs === null || elapsedMs >= totalSweepMs;

    // 1. Horizontal Y-axis guide hairlines & rounded hour labels
    ctx.font = '500 10px "Geist", system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let tIdx = 0; tIdx < st.scale.ticks.length; tIdx++) {
      const tickMin = st.scale.ticks[tIdx];
      const ty = Math.round(yForMin(tickMin)) + 0.5;
      ctx.strokeStyle =
        tickMin === 0 ? 'rgba(255, 255, 255, 0.085)' : 'rgba(255, 255, 255, 0.045)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padLeft, ty);
      ctx.lineTo(padLeft + plotW, ty);
      ctx.stroke();

      ctx.fillStyle = '#52525B';
      ctx.fillText(st.scale.tickLabels[tIdx], padLeft - 6, ty);
    }

    // 2. Translucent tilted Goal Horizon back plane (matches isometric dx, dy)
    ctx.save();
    ctx.fillStyle = 'rgba(253, 224, 71, 0.065)';
    ctx.beginPath();
    ctx.moveTo(padLeft, goalY);
    ctx.lineTo(padLeft + dx, goalY + dy);
    ctx.lineTo(padLeft + plotW, goalY + dy);
    ctx.lineTo(padLeft + plotW - dx, goalY);
    ctx.closePath();
    ctx.fill();

    // Faint back rim of goal plane
    ctx.strokeStyle = 'rgba(253, 224, 71, 0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padLeft + dx, goalY + dy);
    ctx.lineTo(padLeft + plotW, goalY + dy);
    ctx.stroke();
    ctx.restore();

    const drawEmptyPlinth = (px: number) => {
      drawPrism(
        ctx,
        px,
        baseY - PLINTH_H,
        barW,
        PLINTH_H,
        dx,
        dy,
        '#141111',
        '#0B0909',
        '#1E1A1A',
        'rgba(255, 255, 255, 0.07)'
      );
    };

    const drawObsidianPillar = (px: number, barH: number) => {
      const yTop = baseY - barH;
      const frontGrad = ctx.createLinearGradient(0, yTop, 0, baseY);
      frontGrad.addColorStop(0, '#332523');
      frontGrad.addColorStop(1, '#141010');

      const rightGrad = ctx.createLinearGradient(0, yTop, 0, baseY);
      rightGrad.addColorStop(0, '#1B1413');
      rightGrad.addColorStop(1, '#0C0A0A');

      drawPrism(
        ctx,
        px,
        yTop,
        barW,
        barH,
        dx,
        dy,
        frontGrad,
        rightGrad,
        '#4B3632',
        'rgba(254, 215, 170, 0.32)'
      );
    };

    // 3. Render orthographic 3D Monolith prisms
    for (let i = 0; i < N; i++) {
      const entry = st.series[i];
      const x = Math.round(padLeft + i * slotW + (slotW - barW - dx) / 2);
      const isSelected = i === st.activeIdx;

      // Critically damped cubic ease-out (strictly [0, 1], zero overshoot)
      let eased = 1;
      if (!st.hasEnteredViewport && !animDoneRef.current) {
        eased = 0;
      } else if (!allSettled) {
        const localT = Math.max(
          0,
          Math.min(1, (elapsedMs - i * staggerMs) / PILLAR_ANIM_DURATION_MS)
        );
        eased = 1 - Math.pow(1 - localT, 3);
      }

      ctx.save();
      if (st.isScrubHighlighted && !isSelected) {
        ctx.globalAlpha = 0.72;
      }

      // Subtle floor ambient occlusion cast shadow grounding pillar on baseline
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.beginPath();
      ctx.moveTo(x - 1, baseY + 1);
      ctx.lineTo(x + barW + 2, baseY + 1);
      ctx.lineTo(x + barW + dx + 3, baseY + dy + 2);
      ctx.lineTo(x + dx, baseY + dy + 2);
      ctx.closePath();
      ctx.fill();

      if (entry.totalMin <= 0 || eased <= 0.001) {
        // 0m Empty Day or pre-rise resting state: machined 4px recessed obsidian plinth
        drawEmptyPlinth(x);
      } else if (st.stackMode && entry.subjectSlices.length > 0) {
        // Subject Stack Mode ON: 3D stacked subject-colored segments bottom-to-top
        const targetBarH = Math.max(8, (entry.totalMin / st.scale.maxMin) * plotH);
        const totalBarH = PLINTH_H + (targetBarH - PLINTH_H) * eased;
        const sliceSum = entry.subjectSlices.reduce((sum, s) => sum + s.minutes, 0) || 1;
        let curBottom = baseY;

        for (let sIdx = 0; sIdx < entry.subjectSlices.length; sIdx++) {
          const slice = entry.subjectSlices[sIdx];
          const isTopSlice = sIdx === entry.subjectSlices.length - 1;
          const rawH = (slice.minutes / sliceSum) * totalBarH;
          const segH = isTopSlice
            ? Math.max(1, curBottom - (baseY - totalBarH))
            : Math.max(1, rawH);
          const yTop = curBottom - segH;

          const frontGrad = ctx.createLinearGradient(0, yTop, 0, curBottom);
          frontGrad.addColorStop(0, slice.color);
          frontGrad.addColorStop(1, shadeHexColor(slice.color, -0.18));

          const rightGrad = ctx.createLinearGradient(0, yTop, 0, curBottom);
          rightGrad.addColorStop(0, shadeHexColor(slice.color, -0.3));
          rightGrad.addColorStop(1, shadeHexColor(slice.color, -0.42));

          const topCapColor = shadeHexColor(slice.color, 0.18);
          drawPrism(
            ctx,
            x,
            yTop,
            barW,
            segH,
            dx,
            dy,
            frontGrad,
            rightGrad,
            topCapColor,
            isTopSlice ? 'rgba(255, 255, 255, 0.45)' : undefined,
            isTopSlice
          );
          curBottom = yTop;
        }
      } else if (!entry.hitGoal) {
        // Active Below Goal: brushed warm obsidian-copper monolith (never crosses goal plane)
        const targetBarH = Math.max(7, (entry.totalMin / st.scale.maxMin) * plotH);
        const barH = PLINTH_H + (targetBarH - PLINTH_H) * eased;
        drawObsidianPillar(x, barH);
      } else {
        // Goal Ignited (>= dailyGoalMin): rises as obsidian trunk, igniting gold + halo only upon crossing goalY
        const rawTotalBarH = Math.max(
          baseY - goalY + 6,
          (entry.totalMin / st.scale.maxMin) * plotH
        );
        const clampedTop = Math.max(padTop + 4, baseY - rawTotalBarH);
        const lowerH = Math.max(4, baseY - goalY);
        const fullUpperH = Math.max(6, goalY - clampedTop);
        const finalUpperTop = goalY - fullUpperH;
        const finalTotalH = Math.max(PLINTH_H, baseY - finalUpperTop);

        const curBarH = PLINTH_H + (finalTotalH - PLINTH_H) * eased;
        const curTop = baseY - curBarH;

        if (curTop >= goalY) {
          // Still climbing below the goal plane: brushed obsidian-copper only (no gold flash yet)
          drawObsidianPillar(x, curBarH);
        } else {
          const upperH = goalY - curTop;
          const upperTop = curTop;
          const ignitionFactor = Math.max(0, Math.min(1, upperH / fullUpperH));

          // Soft radial top halo fades in smoothly only as ignited bar rises above goal plane
          const haloCx = x + barW * 0.5 + dx * 0.45;
          const haloCy = upperTop + dy * 0.45;
          const haloR = Math.max(18, barW * 1.15);
          const haloGrad = ctx.createRadialGradient(haloCx, haloCy, 2, haloCx, haloCy, haloR);
          haloGrad.addColorStop(0, `rgba(250, 204, 21, ${(0.22 * ignitionFactor).toFixed(4)})`);
          haloGrad.addColorStop(0.55, `rgba(245, 197, 66, ${(0.08 * ignitionFactor).toFixed(4)})`);
          haloGrad.addColorStop(1, 'rgba(250, 204, 21, 0)');
          ctx.fillStyle = haloGrad;
          ctx.beginPath();
          ctx.arc(haloCx, haloCy, haloR, 0, Math.PI * 2);
          ctx.fill();

          // Lower brushed obsidian-copper trunk up to goal plane
          const lowerFront = ctx.createLinearGradient(0, goalY, 0, baseY);
          lowerFront.addColorStop(0, '#332523');
          lowerFront.addColorStop(1, '#141010');

          const lowerRight = ctx.createLinearGradient(0, goalY, 0, baseY);
          lowerRight.addColorStop(0, '#1B1413');
          lowerRight.addColorStop(1, '#0C0A0A');

          drawPrism(
            ctx,
            x,
            goalY,
            barW,
            lowerH,
            dx,
            dy,
            lowerFront,
            lowerRight,
            '#4B3632',
            undefined,
            false
          );

          // Upper molten Lumen Gold section above goal plane
          const goldFront = ctx.createLinearGradient(0, upperTop, 0, goalY);
          goldFront.addColorStop(0, '#FEF08A');
          goldFront.addColorStop(0.45, '#F5C542');
          goldFront.addColorStop(1, '#D97706');

          const goldRight = ctx.createLinearGradient(0, upperTop, 0, goalY);
          goldRight.addColorStop(0, '#B45309');
          goldRight.addColorStop(1, '#78350F');

          drawPrism(
            ctx,
            x,
            upperTop,
            barW,
            upperH,
            dx,
            dy,
            goldFront,
            goldRight,
            '#FEF9C3',
            'rgba(255, 255, 255, 0.65)',
            true
          );
        }
      }

      // Subtle active selection indicator pip beneath active bar when scrubbing
      if (isSelected && st.isScrubHighlighted) {
        ctx.fillStyle = entry.hitGoal ? '#F5C542' : '#FED7AA';
        ctx.beginPath();
        ctx.arc(x + barW / 2, baseY + 5, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();

      // X-axis label
      const labelX = x + barW * 0.5;
      const showLabel = st.rangeDays === 7 || i % 2 === 0 || i === N - 1 || isSelected;
      if (showLabel) {
        ctx.font = isSelected
          ? '600 10.5px "Geist", system-ui, -apple-system, sans-serif'
          : '500 10px "Geist", system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = isSelected
          ? '#FAFAFA'
          : entry.isToday
            ? '#FDE68A'
            : '#71717A';
        ctx.fillText(entry.axisLabel, labelX, baseY + 9);
      }
    }

    // 4. Crisp 1px dashed front Goal Horizon line + right-aligned `{goal}h GOAL` label
    ctx.save();
    ctx.strokeStyle = 'rgba(253, 224, 71, 0.48)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padLeft, goalY);
    ctx.lineTo(padLeft + plotW, goalY);
    ctx.stroke();
    ctx.setLineDash([]);

    const goalText = formatGoalHoursLabel(st.dailyGoalMin);
    ctx.font = '600 9.5px "Geist", system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const textW = ctx.measureText(goalText).width;
    const pillW = textW + 10;
    const pillH = 15;
    const pillX = padLeft + plotW - pillW;
    const pillY = goalY - pillH - 3;
    // Machined obsidian elevation badge behind goal label so tall right-edge bars stay legible
    ctx.fillStyle = 'rgba(9, 7, 7, 0.88)';
    ctx.strokeStyle = 'rgba(253, 224, 71, 0.30)';
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.roundRect(pillX, pillY, pillW, pillH, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#FDE047';
    ctx.fillText(goalText, padLeft + plotW - 5, pillY + pillH / 2 + 0.5);
    ctx.restore();

    ctx.restore();
    return allSettled;
  }, []);

  // Trigger staggered rise ONLY on first viewport entry and 7d <-> 14d switch
  useEffect(() => {
    if (!hasEnteredViewport) {
      paintFrame(null);
      return;
    }

    cancelAnimationLoop();

    if (prefersReducedMotion()) {
      animDoneRef.current = true;
      paintFrame(null);
      return;
    }

    animDoneRef.current = false;
    animStartTsRef.current = performance.now();

    const step = (ts: number) => {
      const done = paintFrame(ts);
      if (done) {
        animDoneRef.current = true;
        rafIdRef.current = null;
        // Final crisp paint at exact 100% settled state
        paintFrame(null);
      } else {
        rafIdRef.current = requestAnimationFrame(step);
      }
    };

    paintFrame(animStartTsRef.current);
    rafIdRef.current = requestAnimationFrame(step);

    return () => {
      cancelAnimationLoop();
    };
  }, [hasEnteredViewport, rangeDays, cancelAnimationLoop, paintFrame]);

  // Repaint on hover/scrub, stack toggle, data update, or resize WITHOUT restarting animation
  useEffect(() => {
    paintFrame(animDoneRef.current ? null : performance.now());
  }, [
    series,
    scale,
    dailyGoalMin,
    stackMode,
    activeIdx,
    isScrubHighlighted,
    canvasWidth,
    canvasHeight,
    paintFrame,
  ]);

  const resolveIndexFromClientX = useCallback(
    (clientX: number): number | null => {
      const canvas = canvasRef.current;
      if (!canvas || series.length === 0) return null;
      const rect = canvas.getBoundingClientRect();
      const localX = clientX - rect.left;
      const plotW = Math.max(40, rect.width - padLeft - padRight);
      const rel = (localX - padLeft) / plotW;
      const idx = Math.floor(rel * series.length);
      return Math.max(0, Math.min(series.length - 1, idx));
    },
    [series.length]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const idx = resolveIndexFromClientX(e.clientX);
      if (idx === null) return;
      setIsPointerActive(true);
      setSelectedIdx(idx);
    },
    [resolveIndexFromClientX]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const idx = resolveIndexFromClientX(e.clientX);
      if (idx === null) return;
      setIsPointerActive(true);
      setSelectedIdx(idx);
      triggerHaptic('tap');
    },
    [resolveIndexFromClientX]
  );

  const handlePointerLeave = useCallback(() => {
    setIsPointerActive(false);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      if (series.length === 0) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setSelectedIdx((prev) => Math.max(0, (prev ?? defaultIdx) - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setSelectedIdx((prev) => Math.min(series.length - 1, (prev ?? defaultIdx) + 1));
      }
    },
    [series.length, defaultIdx]
  );

  const periodTotalMin = useMemo(
    () => series.reduce((sum, entry) => sum + entry.totalMin, 0),
    [series]
  );

  const topSlices = activeEntry ? activeEntry.subjectSlices.slice(0, 3) : [];

  return (
    <section
      className="dh-hero-tier1 dh-monolith-hero"
      data-testid="study-monolith-hero"
      aria-label="Study Monolith daily volume chart"
    >
      {/* Top Bar: Eyebrow + Dynamic Readout (Left) | Compact Hairline Pills (Right) */}
      <div className="dh-monolith-head">
        <div className="min-w-0">
          <span className="dh-eyebrow block">STUDY MONOLITH</span>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
            <strong
              className="dh-monolith-value tnum"
              data-testid="monolith-readout-duration"
            >
              {activeEntry ? formatMinutesCompact(activeEntry.totalMin) : '0m'}
            </strong>
            {activeEntry && (
              <span
                className="tnum text-[13px] text-[#A1A1AA]"
                data-testid="monolith-readout-date"
              >
                {activeEntry.weekdayShort}, {activeEntry.shortLabel}
                {activeEntry.isToday ? ' · Today' : ''}
              </span>
            )}
          </div>
          {activeEntry && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] tnum">
              <span
                style={{
                  color: activeEntry.hitGoal ? '#F5C542' : '#FED7AA',
                  fontWeight: 600,
                }}
                data-testid="monolith-readout-goal"
              >
                {activeEntry.goalPct}% of {formatMinutesCompact(dailyGoalMin)} goal
              </span>
              <span className="text-[#52525B]" aria-hidden="true">
                ·
              </span>
              <span className="text-[#71717A]">
                {rangeDays}d total {formatMinutesCompact(periodTotalMin)}
              </span>
            </div>
          )}
        </div>

        <div className="dh-monolith-controls" role="toolbar" aria-label="Study monolith controls">
          <div className="dh-canvas-pill-group" role="group" aria-label="Time range">
            <button
              type="button"
              className={`dh-canvas-pill ${rangeDays === 7 ? 'is-active' : ''}`}
              aria-pressed={rangeDays === 7}
              onClick={() => {
                triggerHaptic('tap');
                setRangeDays(7);
              }}
            >
              7d
            </button>
            <button
              type="button"
              className={`dh-canvas-pill ${rangeDays === 14 ? 'is-active' : ''}`}
              aria-pressed={rangeDays === 14}
              onClick={() => {
                triggerHaptic('tap');
                setRangeDays(14);
              }}
            >
              14d
            </button>
          </div>

          <button
            type="button"
            className={`dh-canvas-pill ${stackMode ? 'is-stack-active' : ''}`}
            aria-pressed={stackMode}
            onClick={() => {
              triggerHaptic('tap');
              setStackMode((v) => !v);
            }}
          >
            <Layers size={12} strokeWidth={1.9} aria-hidden="true" />
            <span>Stack</span>
          </button>

          {onShareTodayProof && (
            <button
              type="button"
              className="dh-canvas-pill"
              onClick={() => {
                triggerHaptic('tap');
                onShareTodayProof();
              }}
            >
              <Share2 size={12} strokeWidth={1.9} aria-hidden="true" />
              <span>Share proof</span>
            </button>
          )}
        </div>
      </div>

      {/* High-DPI 2D Isometric Monolith Canvas */}
      <div ref={containerRef} className="dh-monolith-stage">
        <canvas
          ref={canvasRef}
          className="dh-monolith-canvas"
          style={{ height: `${canvasHeight}px` }}
          tabIndex={0}
          role="img"
          data-testid="study-monolith-canvas"
          data-range={rangeDays}
          data-stack={stackMode ? 'on' : 'off'}
          data-selected-date={activeEntry?.dateKey || ''}
          aria-label={`3D isometric study monolith chart for last ${rangeDays} days. Selected ${
            activeEntry
              ? `${activeEntry.dateKey}, ${formatMinutesCompact(activeEntry.totalMin)}, ${activeEntry.goalPct}% of daily goal`
              : 'no day'
          }. Use arrow keys or hover to inspect days.`}
          onPointerMove={handlePointerMove}
          onPointerDown={handlePointerDown}
          onPointerLeave={handlePointerLeave}
          onKeyDown={handleKeyDown}
        />
      </div>

      {/* Compact Bottom Strip: Scrubbed Day Metadata + Quiet Open Day Trigger */}
      {activeEntry && (
        <div className="dh-monolith-footer">
          <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2.5 sm:gap-y-1 text-[12.5px] text-[#A1A1AA]">
            <div className="flex items-center gap-2">
              <span className="tnum font-medium text-[#E4E4E7]" data-testid="monolith-footer-meta">
                {activeEntry.dateKey}
              </span>
              <span className="text-[#52525B]" aria-hidden="true">
                ·
              </span>
              <span className="tnum">
                {activeEntry.sessionCount}{' '}
                {activeEntry.sessionCount === 1 ? 'session' : 'sessions'}
              </span>
            </div>
            {topSlices.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <span className="hidden text-[#52525B] sm:inline" aria-hidden="true">
                  ·
                </span>
                {topSlices.map((slice) => (
                  <span
                    key={slice.subjectId}
                    className="inline-flex items-center gap-1.5 text-[12px] text-[#D4D4D8]"
                  >
                    <span
                      className="dh-sub-dot"
                      style={{ background: slice.color }}
                      aria-hidden="true"
                    />
                    <span className="max-w-[92px] truncate">{slice.name}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            className="dh-canvas-pill dh-monolith-open-btn"
            data-testid="monolith-open-day"
            onClick={() => {
              triggerHaptic('tap');
              onInspectDay(activeEntry.dateKey);
            }}
          >
            <span>Open day</span>
            <ChevronRight size={13} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      )}
    </section>
  );
};
