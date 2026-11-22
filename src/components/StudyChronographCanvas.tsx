import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { StudySession, Subject } from '../types';
import {
  angleToSpokeIndex,
  buildChronograph24h,
  buildChronograph30d,
  formatMinutesCompact,
} from '../utils/insightsCanvas';
import { triggerHaptic } from '../utils/haptics';

interface StudyChronographCanvasProps {
  sessions: ReadonlyArray<StudySession>;
  subjects: ReadonlyArray<Subject>;
  todayKey: string;
  dailyGoalMin: number;
  onInspectDay: (dayKey: string) => void;
}

type ChronoMode = '30d' | '24h';

export const StudyChronographCanvas: React.FC<StudyChronographCanvasProps> = ({
  sessions,
  subjects,
  todayKey,
  dailyGoalMin,
  onInspectDay,
}) => {
  const [mode, setMode] = useState<ChronoMode>('30d');
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [pinnedIdx, setPinnedIdx] = useState<number | null>(null);
  const [isDesktop, setIsDesktop] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : false
  );

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setIsDesktop(window.innerWidth >= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const safeGoalMin = Math.max(
    15,
    Math.round(Number.isFinite(dailyGoalMin) && dailyGoalMin > 0 ? dailyGoalMin : 360)
  );

  const data30d = useMemo(
    () => buildChronograph30d(todayKey, sessions, subjects, safeGoalMin),
    [todayKey, sessions, subjects, safeGoalMin]
  );

  const data24h = useMemo(() => buildChronograph24h(sessions), [sessions]);

  // Clear scrub state when switching modes
  const handleSwitchMode = (nextMode: ChronoMode) => {
    if (nextMode === mode) return;
    triggerHaptic('tap');
    setMode(nextMode);
    setHoveredIdx(null);
    setPinnedIdx(null);
  };

  const activeIdx = hoveredIdx !== null ? hoveredIdx : pinnedIdx;
  const dialSize = isDesktop ? 264 : 240;

  // High-DPI Watch-Face 2D Canvas Render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    const size = dialSize;
    if (canvas.width !== Math.round(size * dpr) || canvas.height !== Math.round(size * dpr)) {
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
    }

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const cx = size / 2;
    const cy = size / 2;
    const bezelR = size * 0.386;
    const hubR = size * 0.21;
    const innerR = hubR + 7;
    const outerR = bezelR - 7;
    const spokeSpan = Math.max(12, outerR - innerR);

    // 1. Subtle recessed watch-face dial (#060505) + machined outer bezel (1px rgba(255,255,255,0.09))
    ctx.beginPath();
    ctx.arc(cx, cy, bezelR, 0, Math.PI * 2);
    ctx.fillStyle = '#060505';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
    ctx.stroke();

    // Inner specular hairline inside bezel
    ctx.beginPath();
    ctx.arc(cx, cy, bezelR - 1.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(254, 215, 170, 0.05)';
    ctx.stroke();

    // 2. Concentric reference rings at 33% and 66%
    for (const frac of [0.33, 0.66]) {
      ctx.beginPath();
      ctx.arc(cx, cy, innerR + spokeSpan * frac, 0, Math.PI * 2);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.055)';
      ctx.stroke();
    }

    if (mode === '30d') {
      const spokeScaleMax = Math.max(safeGoalMin * 1.32, data30d.maxDayMin, 120);
      const goalFrac = Math.min(0.84, safeGoalMin / spokeScaleMax);
      const goalR = innerR + spokeSpan * goalFrac;

      // Dashed Lumen Gold goal reference circle
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, goalR, 0, Math.PI * 2);
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(253, 224, 71, 0.42)';
      ctx.stroke();
      ctx.restore();

      // Subtle thin perimeter streak arc when streak >= 2
      if (data30d.currentStreak >= 2) {
        const step = (Math.PI * 2) / 30;
        const startA = -Math.PI / 2 + data30d.streakStartIndex * step;
        const endA =
          -Math.PI / 2 +
          (data30d.streakStartIndex + data30d.currentStreak - 1) * step;
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, bezelR - 3, startA, endA);
        ctx.strokeStyle = 'rgba(245, 197, 66, 0.35)';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.restore();
      }

      // Cardinal ticks & labels outside bezel: TODAY at 12, -7d at 3, -15d at 6, -22d at 9
      const cardinals: Array<{
        angle: number;
        label: string;
        align: CanvasTextAlign;
        accent?: boolean;
      }> = [
        { angle: -Math.PI / 2, label: 'TODAY', align: 'center', accent: true },
        { angle: 0, label: '-7d', align: 'left' },
        { angle: Math.PI / 2, label: '-15d', align: 'center' },
        { angle: Math.PI, label: '-22d', align: 'right' },
      ];
      ctx.font = '600 9.5px "Geist", system-ui, -apple-system, sans-serif';
      ctx.textBaseline = 'middle';
      for (const c of cardinals) {
        const tx0 = cx + Math.cos(c.angle) * (bezelR + 2);
        const ty0 = cy + Math.sin(c.angle) * (bezelR + 2);
        const tx1 = cx + Math.cos(c.angle) * (bezelR + 5);
        const ty1 = cy + Math.sin(c.angle) * (bezelR + 5);
        ctx.strokeStyle = c.accent ? 'rgba(245, 197, 66, 0.65)' : 'rgba(255, 255, 255, 0.22)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(tx0, ty0);
        ctx.lineTo(tx1, ty1);
        ctx.stroke();

        ctx.textAlign = c.align;
        const radialOffset = c.align === 'center' ? bezelR + 14 : bezelR + 9;
        const lx = cx + Math.cos(c.angle) * radialOffset;
        const ly = cy + Math.sin(c.angle) * radialOffset;
        ctx.fillStyle = c.accent ? '#A1A1AA' : '#52525B';
        ctx.fillText(c.label, lx, ly);
      }

      // 30 radial spokes (index 0 at 12 o'clock)
      for (let i = 0; i < data30d.spokes.length; i++) {
        const sp = data30d.spokes[i];
        const angle = -Math.PI / 2 + (i / 30) * Math.PI * 2;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const isSelected = activeIdx === i;

        ctx.save();
        if (activeIdx !== null && !isSelected) {
          ctx.globalAlpha = 0.48;
        }

        if (sp.totalMin <= 0) {
          // 0m: 5px dark tick
          ctx.strokeStyle = isSelected
            ? 'rgba(255, 255, 255, 0.45)'
            : 'rgba(255, 255, 255, 0.13)';
          ctx.lineWidth = isSelected ? 2 : 1.5;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(cx + cos * innerR, cy + sin * innerR);
          ctx.lineTo(cx + cos * (innerR + 5), cy + sin * (innerR + 5));
          ctx.stroke();
        } else {
          const ratio = Math.min(1, sp.totalMin / spokeScaleMax);
          const tipR = sp.hitGoal
            ? Math.max(goalR + 4, innerR + spokeSpan * ratio)
            : Math.max(innerR + 8, innerR + spokeSpan * ratio);
          const x0 = cx + cos * innerR;
          const y0 = cy + sin * innerR;
          const x1 = cx + cos * tipR;
          const y1 = cy + sin * tipR;

          const grad = ctx.createLinearGradient(x0, y0, x1, y1);
          if (sp.hitGoal) {
            grad.addColorStop(0, '#F5C542');
            grad.addColorStop(1, '#FEF08A');
          } else {
            grad.addColorStop(0, '#FB923C');
            grad.addColorStop(1, '#F472B6');
          }

          ctx.strokeStyle = grad;
          ctx.lineWidth = sp.hitGoal ? (isSelected ? 4.2 : 3.5) : isSelected ? 3.8 : 3;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();

          // Glowing 2.5px tip pip for goal-hit spokes
          if (sp.hitGoal) {
            const pipGlow = ctx.createRadialGradient(x1, y1, 0.5, x1, y1, 7);
            pipGlow.addColorStop(0, 'rgba(254, 240, 138, 0.65)');
            pipGlow.addColorStop(1, 'rgba(245, 197, 66, 0)');
            ctx.fillStyle = pipGlow;
            ctx.beginPath();
            ctx.arc(x1, y1, 7, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#FEF9C3';
            ctx.beginPath();
            ctx.arc(x1, y1, 2.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }
    } else {
      // 24h Clock Mode
      // Translucent Rose Copper Peak 2h wedge wash
      if (data24h.peakWindowStart !== null) {
        const step = (Math.PI * 2) / 24;
        const startAngle = -Math.PI / 2 + (data24h.peakWindowStart - 0.5) * step;
        const endAngle = startAngle + step * 2;
        const wedgeGrad = ctx.createRadialGradient(cx, cy, hubR, cx, cy, bezelR);
        wedgeGrad.addColorStop(0, 'rgba(251, 146, 60, 0.14)');
        wedgeGrad.addColorStop(0.65, 'rgba(244, 114, 182, 0.075)');
        wedgeGrad.addColorStop(1, 'rgba(244, 114, 182, 0.02)');

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, bezelR - 2, startAngle, endAngle);
        ctx.closePath();
        ctx.fillStyle = wedgeGrad;
        ctx.fill();
        ctx.restore();
      }

      // Cardinal ticks & labels outside bezel: 00, 06, 12, 18
      const cardinals24: Array<{ angle: number; label: string }> = [
        { angle: -Math.PI / 2, label: '00' },
        { angle: 0, label: '06' },
        { angle: Math.PI / 2, label: '12' },
        { angle: Math.PI, label: '18' },
      ];
      ctx.font = '600 10px "Geist", system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const c of cardinals24) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.24)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(c.angle) * (bezelR + 2), cy + Math.sin(c.angle) * (bezelR + 2));
        ctx.lineTo(cx + Math.cos(c.angle) * (bezelR + 5), cy + Math.sin(c.angle) * (bezelR + 5));
        ctx.stroke();

        ctx.fillStyle = '#71717A';
        ctx.fillText(
          c.label,
          cx + Math.cos(c.angle) * (bezelR + 14),
          cy + Math.sin(c.angle) * (bezelR + 14)
        );
      }

      // 24 radial hourly bars
      const maxHour = Math.max(15, data24h.maxHourMin);
      for (let h = 0; h < data24h.slots.length; h++) {
        const slot = data24h.slots[h];
        const angle = -Math.PI / 2 + (h / 24) * Math.PI * 2;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const isSelected = activeIdx === h;

        ctx.save();
        if (activeIdx !== null && !isSelected) {
          ctx.globalAlpha = 0.48;
        }

        if (slot.minutes <= 0) {
          ctx.strokeStyle = isSelected
            ? 'rgba(255, 255, 255, 0.45)'
            : 'rgba(255, 255, 255, 0.12)';
          ctx.lineWidth = isSelected ? 2 : 1.5;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(cx + cos * innerR, cy + sin * innerR);
          ctx.lineTo(cx + cos * (innerR + 5), cy + sin * (innerR + 5));
          ctx.stroke();
        } else {
          const ratio = Math.min(1, slot.minutes / maxHour);
          const tipR = Math.max(innerR + 8, innerR + spokeSpan * ratio);
          const x0 = cx + cos * innerR;
          const y0 = cy + sin * innerR;
          const x1 = cx + cos * tipR;
          const y1 = cy + sin * tipR;

          const grad = ctx.createLinearGradient(x0, y0, x1, y1);
          if (slot.inPeakWindow) {
            grad.addColorStop(0, '#F5C542');
            grad.addColorStop(1, '#FEF08A');
          } else {
            grad.addColorStop(0, '#FB923C');
            grad.addColorStop(1, 'rgba(254, 215, 170, 0.65)');
          }

          ctx.strokeStyle = grad;
          ctx.lineWidth = slot.inPeakWindow ? (isSelected ? 4.2 : 3.5) : isSelected ? 3.6 : 3;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();

          if (slot.inPeakWindow) {
            ctx.fillStyle = '#FEF9C3';
            ctx.beginPath();
            ctx.arc(x1, y1, 2.2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }
    }

    // 3. Razor-thin radial pointer cursor line when scrubbed
    if (activeIdx !== null) {
      const count = mode === '30d' ? 30 : 24;
      const cursorAngle = -Math.PI / 2 + (activeIdx / count) * Math.PI * 2;
      ctx.save();
      ctx.strokeStyle = 'rgba(254, 240, 138, 0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(cursorAngle) * hubR, cy + Math.sin(cursorAngle) * hubR);
      ctx.lineTo(cx + Math.cos(cursorAngle) * bezelR, cy + Math.sin(cursorAngle) * bezelR);
      ctx.stroke();
      ctx.restore();
    }

    // 4. Center Hub (#050404 circle + 1px hairline border) + Live Crisp Readout
    ctx.beginPath();
    ctx.arc(cx, cy, hubR, 0, Math.PI * 2);
    ctx.fillStyle = '#050404';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.11)';
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    let topText = '';
    let topColor = '#71717A';
    let mainText = '';
    let mainColor = '#FAFAFA';
    let mainFontSize = 17;
    let subText = '';

    if (mode === '30d') {
      const sp = activeIdx !== null ? data30d.spokes[activeIdx] : null;
      if (sp) {
        topText = sp.daysAgo === 0 ? 'TODAY' : sp.shortLabel.toUpperCase();
        topColor = sp.hitGoal ? '#FDE68A' : '#A1A1AA';
        mainText = formatMinutesCompact(sp.totalMin);
        mainColor = sp.hitGoal ? '#F5C542' : '#FAFAFA';
        subText =
          sp.totalMin > 0
            ? `Purity ${sp.purityPct}% · ${sp.sessionCount}s`
            : 'Rest day';
      } else {
        topText = '30D TOTAL';
        topColor = '#71717A';
        mainText = formatMinutesCompact(data30d.totalMin30);
        mainColor = '#FAFAFA';
        mainFontSize = mainText.length >= 7 ? 15 : 17;
        subText = `${formatMinutesCompact(data30d.avgMinPerDay30)}/day`;
      }
    } else {
      const sl = activeIdx !== null ? data24h.slots[activeIdx] : null;
      if (sl) {
        topText = sl.rangeLabel;
        topColor = sl.inPeakWindow ? '#FDE68A' : '#FED7AA';
        mainText = formatMinutesCompact(sl.minutes);
        mainColor = sl.inPeakWindow ? '#F5C542' : '#FAFAFA';
        subText =
          data24h.totalMin > 0 ? `${sl.sharePct}% of focus` : 'No sessions';
      } else {
        topText = 'PEAK 2H';
        topColor = '#71717A';
        mainText = data24h.peakWindowLabel;
        mainColor = data24h.peakWindowStart !== null ? '#F5C542' : '#A1A1AA';
        mainFontSize = data24h.peakWindowStart !== null ? 13 : 18;
        subText = data24h.peakLabel;
      }
    }

    ctx.font = '600 9px "Geist", system-ui, -apple-system, sans-serif';
    ctx.fillStyle = topColor;
    ctx.fillText(topText, cx, cy - 18);

    ctx.font = `700 ${mainFontSize}px "Geist", system-ui, -apple-system, sans-serif`;
    ctx.fillStyle = mainColor;
    ctx.fillText(mainText, cx, cy + 1);

    ctx.font = '500 10px "Geist", system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#A1A1AA';
    ctx.fillText(subText, cx, cy + 19);

    ctx.restore();
  }, [mode, data30d, data24h, safeGoalMin, activeIdx, dialSize]);

  const resolveSpokeFromPointer = useCallback(
    (clientX: number, clientY: number): { idx: number | null; inCenter: boolean } => {
      const canvas = canvasRef.current;
      if (!canvas) return { idx: null, inCenter: false };
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return { idx: null, inCenter: false };
      const dx = clientX - rect.left - rect.width / 2;
      const dy = clientY - rect.top - rect.height / 2;
      const dist = Math.hypot(dx, dy);
      const hubR = rect.width * 0.21;
      if (dist < hubR * 0.9) {
        return { idx: null, inCenter: true };
      }
      const count = mode === '30d' ? 30 : 24;
      return { idx: angleToSpokeIndex(dx, dy, count), inCenter: false };
    },
    [mode]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const hit = resolveSpokeFromPointer(e.clientX, e.clientY);
      if (hit.inCenter) {
        setHoveredIdx(null);
      } else if (hit.idx !== null) {
        setHoveredIdx(hit.idx);
      }
    },
    [resolveSpokeFromPointer]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const hit = resolveSpokeFromPointer(e.clientX, e.clientY);
      if (hit.inCenter) {
        setPinnedIdx(null);
        setHoveredIdx(null);
        return;
      }
      if (hit.idx !== null) {
        setPinnedIdx(hit.idx);
        setHoveredIdx(hit.idx);
        triggerHaptic('tap');
      }
    },
    [resolveSpokeFromPointer]
  );

  const handlePointerLeave = useCallback(() => {
    setHoveredIdx(null);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      const count = mode === '30d' ? 30 : 24;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        setPinnedIdx((prev) => ((prev === null ? -1 : prev) + 1) % count);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        setPinnedIdx((prev) => ((prev === null ? 1 : prev) - 1 + count) % count);
      } else if (e.key === 'Escape') {
        setPinnedIdx(null);
        setHoveredIdx(null);
      }
    },
    [mode]
  );

  const activeSpoke30d =
    mode === '30d' && activeIdx !== null ? data30d.spokes[activeIdx] || null : null;
  const activeSlot24h =
    mode === '24h' && activeIdx !== null ? data24h.slots[activeIdx] || null : null;

  const cadencePct = Math.round((data30d.activeDays30 / 30) * 100);
  const goalHoursText = formatMinutesCompact(safeGoalMin);
  const rhythmWindowText =
    data24h.avgStartTime !== '—' && data24h.avgWrapUpTime !== '—'
      ? `${data24h.avgStartTime} – ${data24h.avgWrapUpTime}`
      : '—';

  const hubReadoutSummary =
    mode === '30d'
      ? activeSpoke30d
        ? `${activeSpoke30d.shortLabel}: ${formatMinutesCompact(activeSpoke30d.totalMin)}`
        : `30d total ${formatMinutesCompact(data30d.totalMin30)}`
      : activeSlot24h
        ? `${activeSlot24h.rangeLabel}: ${formatMinutesCompact(activeSlot24h.minutes)}`
        : `Peak 2h ${data24h.peakWindowLabel} (${data24h.peakLabel})`;

  return (
    <section
      className="dh-chronograph-section"
      data-testid="study-chronograph-section"
      aria-label="Chronograph Tempo Dial"
    >
      {/* Header Row: Eyebrow + Dynamic Meta (Left) | 30d Rhythm / 24h Clock Toggle (Right) */}
      <div className="dh-chronograph-head">
        <div className="min-w-0">
          <h3 className="dh-eyebrow">CHRONOGRAPH TEMPO</h3>
          <p className="mt-0.5 text-[12.5px] text-[#71717A]">
            {mode === '30d' ? '30-day cadence' : '24-hour concentration clock'}
          </p>
        </div>

        <div className="dh-canvas-pill-group" role="group" aria-label="Chronograph dial mode">
          <button
            type="button"
            className={`dh-canvas-pill ${mode === '30d' ? 'is-active' : ''}`}
            aria-pressed={mode === '30d'}
            onClick={() => handleSwitchMode('30d')}
          >
            30d Rhythm
          </button>
          <button
            type="button"
            className={`dh-canvas-pill ${mode === '24h' ? 'is-active' : ''}`}
            aria-pressed={mode === '24h'}
            onClick={() => handleSwitchMode('24h')}
          >
            24h Clock
          </button>
        </div>
      </div>

      {/* Responsive Body: Dial Left (264px desktop / 240px mobile) + 2x2 Hairline Ledger Right */}
      <div className="dh-chronograph-body">
        <div className="dh-chronograph-dial-wrap">
          <canvas
            ref={canvasRef}
            className="dh-chronograph-canvas"
            style={{ width: `${dialSize}px`, height: `${dialSize}px` }}
            tabIndex={0}
            role="img"
            data-testid="study-chronograph-canvas"
            data-mode={mode}
            data-active-index={activeIdx !== null ? String(activeIdx) : ''}
            data-hub-summary={hubReadoutSummary}
            aria-label={`Chronograph Tempo dial in ${
              mode === '30d' ? '30-day rhythm' : '24-hour clock'
            } mode. ${hubReadoutSummary}. Hover, tap, or use arrow keys to scrub spokes.`}
            onPointerMove={handlePointerMove}
            onPointerDown={handlePointerDown}
            onPointerLeave={handlePointerLeave}
            onKeyDown={handleKeyDown}
          />
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <div className="dh-ledger-2x2" data-testid="chronograph-ledger">
            <div className="dh-ledger-cell">
              <span className="dh-ledger-label">ACTIVE DAYS (30D)</span>
              <span className="dh-ledger-val tnum">{data30d.activeDays30}/30</span>
              <span className="dh-ledger-sub">{cadencePct}% cadence</span>
            </div>

            <div className="dh-ledger-cell">
              <span className="dh-ledger-label">GOAL HIT RATE</span>
              <span className="dh-ledger-val tnum">
                {data30d.goalHitCount30}{' '}
                {data30d.goalHitCount30 === 1 ? 'day' : 'days'}
              </span>
              <span className="dh-ledger-sub">Target {goalHoursText}/day</span>
            </div>

            <div className="dh-ledger-cell">
              <span className="dh-ledger-label">PEAK 2H WINDOW</span>
              <span className="dh-ledger-val tnum" style={{ fontSize: 18 }}>
                {data24h.peakWindowLabel}
              </span>
              <span className="dh-ledger-sub">{data24h.peakLabel}</span>
            </div>

            <div className="dh-ledger-cell">
              <span className="dh-ledger-label">RHYTHM WINDOW</span>
              <span className="dh-ledger-val tnum" style={{ fontSize: 18 }}>
                {rhythmWindowText}
              </span>
              <span className="dh-ledger-sub">
                Avg purity {data30d.avgPurity30 > 0 ? `${data30d.avgPurity30}%` : '—'}
              </span>
            </div>
          </div>

          {/* Subtle contextual scrubbed-day action link in 30d Rhythm */}
          {activeSpoke30d ? (
            <div className="flex items-center justify-between gap-2 pt-0.5 text-[12.5px]">
              <span className="tnum text-[#A1A1AA]">
                {activeSpoke30d.weekdayShort}, {activeSpoke30d.shortLabel} ·{' '}
                <strong className="text-[#FAFAFA]">
                  {formatMinutesCompact(activeSpoke30d.totalMin)}
                </strong>
                {activeSpoke30d.totalMin > 0
                  ? ` · ${activeSpoke30d.goalPct}% of goal`
                  : ' · Rest day'}
              </span>
              <button
                type="button"
                className="dh-eyebrow-link"
                data-testid="chronograph-open-day"
                onClick={() => {
                  triggerHaptic('tap');
                  onInspectDay(activeSpoke30d.dateKey);
                }}
              >
                <span>Open {activeSpoke30d.shortLabel}</span>
                <ChevronRight size={13} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          ) : activeSlot24h ? (
            <div className="flex items-center justify-between gap-2 pt-0.5 text-[12.5px] tnum text-[#A1A1AA]">
              <span>
                Slot <strong className="text-[#FAFAFA]">{activeSlot24h.rangeLabel}</strong> ·{' '}
                {formatMinutesCompact(activeSlot24h.minutes)} ({activeSlot24h.sharePct}% share)
              </span>
              {activeSlot24h.inPeakWindow && (
                <span className="font-semibold text-[#F5C542]">Peak 2h</span>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
};
