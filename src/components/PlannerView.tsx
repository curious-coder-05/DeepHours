import React, { useEffect, useState } from 'react';
import type { PulseHabitState } from '../types';
import {
  fmtHMShort,
  getHeadingColor,
  getSessionHeading,
  getTodaySubjectMs,
  pad,
} from '../utils/studyLogic';

interface PlannerViewProps {
  state: PulseHabitState;
  sel: string;
  todayKey: string;
  onPaintSlot: (slotIndex: number, brushId: string) => void;
  onOpenManualSession: () => void;
}

const PLAN_BRUSHES = [
  { id: 'sub_code', name: 'Deep Study Block', e: '⚡', color: '#6366f1' },
  { id: 'sub_math', name: 'Problem Solving', e: '📐', color: '#10b981' },
  { id: 'sub_lec', name: 'Lectures & Notes', e: '🎧', color: '#f59e0b' },
  { id: 'sub_read', name: 'Reading & Review', e: '📖', color: '#ec4899' },
] as const;

export const PlannerView: React.FC<PlannerViewProps> = ({
  state,
  sel,
  todayKey,
  onPaintSlot,
  onOpenManualSession,
}) => {
  const [planBrush, setPlanBrush] = useState<string>(PLAN_BRUSHES[0].id);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const handlePointerUp = () => setIsDragging(false);
    window.addEventListener('pointerup', handlePointerUp);
    return () => window.removeEventListener('pointerup', handlePointerUp);
  }, []);

  const resetHr = state.set.dayResetHour ?? 4;
  const hours = [...Array(24)].map((_, i) => (resetHr + i) % 24);
  const dayPlan = state.plans[sel] || {};
  const daySessions = state.sessions.filter((s) => s.dayKey === sel);

  const getBrushMeta = (id: string) => {
    return (
      PLAN_BRUSHES.find((b) => b.id === id) || {
        id,
        name: id,
        e: '⚡',
        color: getHeadingColor(id),
      }
    );
  };

  const actualSlots: Record<number, { heading: string; color: string; mins: number }> = {};
  const paintSessionIntoSlots = (startTs: number, endTs: number, heading: string) => {
    const color = getHeadingColor(heading);
    for (let ts = startTs; ts < endTs; ts += 60000) {
      const d = new Date(ts);
      const slotIdx = d.getHours() * 6 + Math.floor(d.getMinutes() / 10);
      if (!actualSlots[slotIdx]) {
        actualSlots[slotIdx] = { heading, color, mins: 0 };
      }
      actualSlots[slotIdx].mins = Math.min(10, actualSlots[slotIdx].mins + 1);
    }
  };

  daySessions.forEach((s) =>
    paintSessionIntoSlots(s.startTs, s.endTs, getSessionHeading(state, s))
  );
  if (
    state.activeTimer &&
    sel === todayKey &&
    state.activeTimer.phase !== 'break'
  ) {
    paintSessionIntoSlots(
      state.activeTimer.sliceStartTs,
      Date.now(),
      state.activeTimer.heading || 'Deep Study Session'
    );
  }

  const plannedCount = Object.keys(dayPlan).length;
  const actualMins = Math.round(getTodaySubjectMs(state, 'any', sel, todayKey) / 60000);

  return (
    <div>
      <div className="row sp">
        <div>
          <h2>24h 10-Minute Grid ({sel})</h2>
          <small>
            Planned: {fmtHMShort(plannedCount * 600000)} vs Actual:{' '}
            {fmtHMShort(actualMins * 60000)}
          </small>
        </div>
        <button type="button" className="s" onClick={onOpenManualSession}>
          + Log Session
        </button>
      </div>

      {/* Study Block Paint Brush Selector */}
      <div className="card" style={{ padding: '12px' }}>
        <small style={{ display: 'block', marginBottom: '6px' }}>
          Tap or drag on <b>Planned</b> cells to paint 10-min study blocks:
        </small>
        <div className="sub-legend">
          {PLAN_BRUSHES.map((b) => (
            <button
              type="button"
              key={b.id}
              className={`sub-chip ${planBrush === b.id ? 'active' : ''}`}
              style={{ '--sc': b.color } as React.CSSProperties}
              onClick={() => setPlanBrush(b.id)}
            >
              <i className="dot" style={{ '--sc': b.color } as React.CSSProperties} />
              {b.e} {b.name}
            </button>
          ))}
          <button
            type="button"
            className={`sub-chip ${planBrush === 'erase' ? 'active' : ''}`}
            onClick={() => setPlanBrush('erase')}
          >
            🧹 Eraser
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: '12px' }}>
        <div className="grid-wrap" style={{ marginBottom: '6px' }}>
          <div className="grid-hdr">Hr</div>
          <div className="grid-hdr">Planned (Tap/Drag)</div>
          <div className="grid-hdr">Actual (Auto-Logged)</div>
        </div>
        <div className="grid-wrap" id="tenMinGrid">
          <div className="hr-col">
            {hours.map((h) => (
              <div key={h} className="hr-lbl">
                {pad(h)}:00
              </div>
            ))}
          </div>
          <div className="slots-col">
            {hours.map((h) => (
              <div key={h} className="hr-row">
                {[0, 1, 2, 3, 4, 5].map((idx) => {
                  const slot = h * 6 + idx;
                  const pId = dayPlan[slot];
                  const pMeta = pId ? getBrushMeta(pId) : null;
                  const timeLabel = `${pad(h)}:${idx}0`;
                  return (
                    <button
                      type="button"
                      key={slot}
                      className="slot"
                      style={{ padding: 0 }}
                      data-plan-slot={slot}
                      aria-label={`Plan ${timeLabel} (${pMeta ? pMeta.name : 'Empty'})`}
                      title={`${timeLabel} Planned: ${pMeta ? pMeta.name : 'Empty'}`}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        setIsDragging(true);
                        onPaintSlot(slot, planBrush);
                      }}
                      onPointerEnter={() => {
                        if (isDragging) {
                          onPaintSlot(slot, planBrush);
                        }
                      }}
                      onClick={() => {
                        onPaintSlot(slot, planBrush);
                      }}
                    >
                      {pMeta && (
                        <i
                          style={{
                            background: pMeta.color,
                            opacity: 0.85,
                          }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="slots-col">
            {hours.map((h) => (
              <div key={h} className="hr-row">
                {[0, 1, 2, 3, 4, 5].map((idx) => {
                  const slot = h * 6 + idx;
                  const act = actualSlots[slot];
                  const fillPct = act ? Math.min(100, Math.max(25, act.mins * 10)) : 0;
                  return (
                    <div
                      key={slot}
                      className="slot"
                      title={`${pad(h)}:${idx}0 Actual: ${
                        act ? `${act.heading} (${act.mins}m)` : '0m'
                      }`}
                    >
                      {act && (
                        <i
                          style={{
                            background: act.color,
                            width: `${fillPct}%`,
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
