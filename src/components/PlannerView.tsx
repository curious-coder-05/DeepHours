import React, { useEffect, useState } from 'react';
import type { PulseHabitState, Subject } from '../types';
import {
  fmtHMShort,
  getSubject,
  getTodaySubjectMs,
  pad,
} from '../utils/studyLogic';

interface PlannerViewProps {
  state: PulseHabitState;
  sel: string;
  todayKey: string;
  onPaintSlot: (slotIndex: number, brushSubjectId: string) => void;
  onOpenManualSession: () => void;
}

export const PlannerView: React.FC<PlannerViewProps> = ({
  state,
  sel,
  todayKey,
  onPaintSlot,
  onOpenManualSession,
}) => {
  const defaultBrush =
    state.subjects.find((x) => !x.arch)?.id || state.subjects[0].id;
  const [planBrush, setPlanBrush] = useState<string>(defaultBrush);
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

  const actualSlots: Record<number, { sub: Subject; mins: number }> = {};
  const paintSessionIntoSlots = (startTs: number, endTs: number, subjectId: string) => {
    const sub = getSubject(state, subjectId);
    for (let ts = startTs; ts < endTs; ts += 60000) {
      const d = new Date(ts);
      const slotIdx = d.getHours() * 6 + Math.floor(d.getMinutes() / 10);
      if (!actualSlots[slotIdx]) actualSlots[slotIdx] = { sub, mins: 0 };
      actualSlots[slotIdx].mins = Math.min(10, actualSlots[slotIdx].mins + 1);
    }
  };

  daySessions.forEach((s) => paintSessionIntoSlots(s.startTs, s.endTs, s.subjectId));
  if (
    state.activeTimer &&
    sel === todayKey &&
    state.activeTimer.phase !== 'break'
  ) {
    paintSessionIntoSlots(
      state.activeTimer.sliceStartTs,
      Date.now(),
      state.activeTimer.subjectId
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

      {/* Subject Paint Brush Selector */}
      <div className="card" style={{ padding: '12px' }}>
        <small style={{ display: 'block', marginBottom: '6px' }}>
          Tap or drag on <b>Planned</b> cells to paint 10-min blocks:
        </small>
        <div className="sub-legend">
          {state.subjects
            .filter((s) => !s.arch)
            .map((s) => (
              <button
                type="button"
                key={s.id}
                className={`sub-chip ${planBrush === s.id ? 'active' : ''}`}
                style={{ '--sc': s.color } as React.CSSProperties}
                onClick={() => setPlanBrush(s.id)}
              >
                <i className="dot" style={{ '--sc': s.color } as React.CSSProperties} />
                {s.e} {s.name}
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
                  const pSubId = dayPlan[slot];
                  const pSub = pSubId ? getSubject(state, pSubId) : null;
                  const timeLabel = `${pad(h)}:${idx}0`;
                  return (
                    <button
                      type="button"
                      key={slot}
                      className="slot"
                      style={{ padding: 0 }}
                      data-plan-slot={slot}
                      aria-label={`Plan ${timeLabel} (${pSub ? pSub.name : 'Empty'})`}
                      title={`${timeLabel} Planned: ${pSub ? pSub.name : 'Empty'}`}
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
                      {pSub && (
                        <i
                          style={{
                            background: pSub.color,
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
                        act ? `${act.sub.name} (${act.mins}m)` : '0m'
                      }`}
                    >
                      {act && (
                        <i
                          style={{
                            background: act.sub.color,
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
