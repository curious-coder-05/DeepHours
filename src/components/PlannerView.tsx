import React, { useState } from 'react';
import type { PulseHabitState } from '../types';
import {
  fmtClockTime,
  fmtHMShort,
  getHeadingColor,
  getSessionHeading,
  getTimerMetrics,
  getTodaySubjectMs,
  pad,
} from '../utils/studyLogic';

interface PlannerViewProps {
  state: PulseHabitState;
  sel: string;
  todayKey: string;
  onOpenManualSession: () => void;
  onToast?: (msg: string) => void;
}

interface SlotData {
  slotIndex: number;
  windowLabel: string;
  heading: string;
  color: string;
  mins: number;
  isLive?: boolean;
}

export const PlannerView: React.FC<PlannerViewProps> = ({
  state,
  sel,
  todayKey,
  onOpenManualSession,
  onToast,
}) => {
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [filterHeading, setFilterHeading] = useState<string | null>(null);

  const resetHr = state.set.dayResetHour ?? 4;
  const hours = [...Array(24)].map((_, i) => (resetHr + i) % 24);
  const daySessions = state.sessions
    .filter((s) => s.dayKey === sel)
    .slice()
    .sort((a, b) => a.startTs - b.startTs);

  const now = Date.now();
  const isLiveToday =
    Boolean(state.activeTimer) &&
    sel === todayKey &&
    state.activeTimer?.phase !== 'break';
  const liveMetrics = isLiveToday ? getTimerMetrics(state, now) : null;

  const actualSlots: Record<number, SlotData> = {};
  const topicTotals: Record<string, { heading: string; color: string; activeMs: number }> = {};

  const getSlotWindowLabel = (slotIdx: number) => {
    const h = Math.floor(slotIdx / 6);
    const mStart = (slotIdx % 6) * 10;
    const mEnd = mStart + 10;
    const endH = mEnd === 60 ? (h + 1) % 24 : h;
    const endM = mEnd === 60 ? 0 : mEnd;
    return `${pad(h)}:${pad(mStart)} – ${pad(endH)}:${pad(endM)}`;
  };

  const paintSessionIntoSlots = (
    startTs: number,
    endTs: number,
    activeMs: number,
    heading: string,
    isLive = false
  ) => {
    const cleanHeading = (heading || 'Deep Study Session').trim();
    const color = getHeadingColor(cleanHeading);

    if (!topicTotals[cleanHeading]) {
      topicTotals[cleanHeading] = { heading: cleanHeading, color, activeMs: 0 };
    }
    topicTotals[cleanHeading].activeMs += Math.max(0, activeMs);

    const safeEnd = Math.max(startTs + 1000, endTs);
    // Step minute-by-minute (or at least paint the starting slot if < 1 min)
    for (let ts = startTs; ts < safeEnd; ts += 60000) {
      const d = new Date(ts);
      const slotIdx = d.getHours() * 6 + Math.floor(d.getMinutes() / 10);
      if (!actualSlots[slotIdx]) {
        actualSlots[slotIdx] = {
          slotIndex: slotIdx,
          windowLabel: getSlotWindowLabel(slotIdx),
          heading: cleanHeading,
          color,
          mins: 0,
          isLive,
        };
      } else {
        // Update to most recent heading in this 10-min block
        actualSlots[slotIdx].heading = cleanHeading;
        actualSlots[slotIdx].color = color;
        if (isLive) actualSlots[slotIdx].isLive = true;
      }
      actualSlots[slotIdx].mins = Math.min(10, actualSlots[slotIdx].mins + 1);
    }
  };

  daySessions.forEach((s) =>
    paintSessionIntoSlots(
      s.startTs,
      s.endTs,
      s.activeMs,
      getSessionHeading(state, s),
      false
    )
  );

  if (isLiveToday && state.activeTimer && liveMetrics) {
    paintSessionIntoSlots(
      state.activeTimer.sliceStartTs,
      now,
      liveMetrics.sliceActiveMs,
      state.activeTimer.heading || 'Deep Study Session',
      true
    );
  }

  const totalStudiedMs = getTodaySubjectMs(state, 'any', sel, todayKey, now);
  const sessionsCount = daySessions.length + (isLiveToday ? 1 : 0);

  const firstStartTs = daySessions.length
    ? daySessions[0].startTs
    : isLiveToday && state.activeTimer
      ? state.activeTimer.sliceStartTs
      : null;

  const lastEndTs = isLiveToday
    ? now
    : daySessions.length
      ? Math.max(...daySessions.map((s) => s.endTs))
      : null;

  const spanText =
    firstStartTs && lastEndTs
      ? `${fmtClockTime(firstStartTs)} → ${ isLiveToday ? 'Now' : fmtClockTime(lastEndTs) }`
      : '—';

  const topicList = Object.values(topicTotals).sort((a, b) => b.activeMs - a.activeMs);
  const inspectedSlot = selectedSlot !== null ? actualSlots[selectedSlot] || null : null;

  const handleSlotTap = (slotIdx: number) => {
    const data = actualSlots[slotIdx];
    if (!data) {
      setSelectedSlot(null);
      return;
    }
    setSelectedSlot(slotIdx);
    onToast?.(`${data.windowLabel} · ${data.heading} (${data.mins}m active)`);
  };

  return (
    <div>
      {/* Header & Summary Pills */}
      <div className="row sp" style={{ marginBottom: '8px' }}>
        <div>
          <h2>24h 10-Minute Study Timeline ({sel})</h2>
          <small>100% automatic 10-minute resolution log from your timers &amp; sessions</small>
        </div>
        <button type="button" className="s pri" onClick={onOpenManualSession}>
          + Log Session
        </button>
      </div>

      {/* Summary Pills: Total Studied, Sessions Count, First Start -> Last Wrap-up Time */}
      <div className="chips wrap" style={{ marginBottom: '10px', gap: '8px' }}>
        <span className="pill" id="gridTotalStudiedPill">
          ⏱️ Total Studied: <b className="mono">{fmtHMShort(totalStudiedMs)}</b>
        </span>
        <span className="pill" id="gridSessionsCountPill">
          📚 Sessions: <b className="mono">{sessionsCount}</b>
        </span>
        <span className="pill" id="gridTimeSpanPill">
          🌅 First → Last: <b className="mono">{spanText}</b>
        </span>
      </div>

      {/* Automatic Today's Topics Legend */}
      <div className="card" style={{ padding: '12px 14px' }}>
        <div className="row sp" style={{ marginBottom: '6px' }}>
          <b style={{ fontSize: '13px' }}>Today&apos;s Topics Legend</b>
          {filterHeading && (
            <button
              type="button"
              className="s"
              style={{ padding: '3px 8px', fontSize: '11px' }}
              onClick={() => setFilterHeading(null)}
            >
              Show All Topics
            </button>
          )}
        </div>
        {topicList.length > 0 ? (
          <div className="sub-legend" id="todayTopicsLegend">
            {topicList.map((topic) => {
              const isSelected = filterHeading === topic.heading;
              return (
                <button
                  type="button"
                  key={topic.heading}
                  className={`sub-chip ${isSelected ? 'active' : ''}`}
                  style={{ '--sc': topic.color } as React.CSSProperties}
                  onClick={() =>
                    setFilterHeading((prev) =>
                      prev === topic.heading ? null : topic.heading
                    )
                  }
                  title="Tap to highlight this topic on the 24h grid"
                >
                  <i
                    className="dot"
                    style={{ '--sc': topic.color } as React.CSSProperties}
                  />
                  <span>{topic.heading}</span>
                  <b className="mono" style={{ color: 'var(--em)', marginLeft: '2px' }}>
                    {fmtHMShort(topic.activeMs)}
                  </b>
                </button>
              );
            })}
          </div>
        ) : (
          <small className="mu">
            No study topics logged for {sel} yet. Start the Focus timer or tap &ldquo;+ Log
            Session&rdquo; to automatically populate your 10-minute timeline.
          </small>
        )}
      </div>

      {/* Tap-to-Inspect Slot Details Bar */}
      <div
        className="card"
        id="slotInspectorBar"
        style={{
          padding: '10px 14px',
          borderColor: inspectedSlot ? inspectedSlot.color : 'var(--bd)',
          background: inspectedSlot
            ? 'linear-gradient(145deg, var(--c2), var(--c))'
            : 'var(--c)',
        }}
      >
        {inspectedSlot ? (
          <div className="row sp">
            <div className="row" style={{ gap: '8px', flexWrap: 'wrap' }}>
              <span
                className="pill mono"
                style={{
                  borderColor: inspectedSlot.color,
                  color: 'var(--tx)',
                  fontWeight: 700,
                }}
              >
                🕒 {inspectedSlot.windowLabel}
              </span>
              <b>
                <i
                  className="dot"
                  style={{ '--sc': inspectedSlot.color } as React.CSSProperties}
                />{' '}
                {inspectedSlot.heading}
              </b>
              <span className="pill mono" style={{ color: 'var(--em)' }}>
                {inspectedSlot.mins} / 10 min active
                {inspectedSlot.isLive ? ' · ● LIVE' : ''}
              </span>
            </div>
            <button
              type="button"
              className="s"
              style={{ padding: '4px 8px', fontSize: '11px' }}
              onClick={() => setSelectedSlot(null)}
            >
              Clear
            </button>
          </div>
        ) : (
          <div className="row sp">
            <small className="mu">
              💡 <b>Tap any colored 10-minute slot</b> below to inspect the exact time window,
              session heading, and active minutes.
            </small>
            <small className="mono" style={{ fontSize: '11px' }}>
              6 slots / hr
            </small>
          </div>
        )}
      </div>

      {/* Single Full-Width 24-Hour Automatic 10-Minute Grid */}
      <div className="card" style={{ padding: '12px' }}>
        <div className="grid-wrap single" style={{ marginBottom: '6px' }}>
          <div className="grid-hdr">Hr</div>
          <div className="grid-hdr">
            <div className="row sp" style={{ fontSize: '11px' }}>
              <span>Actual (Auto-Logged 10m Blocks)</span>
              <span className="mono" style={{ opacity: 0.75 }}>
                :00 · :10 · :20 · :30 · :40 · :50
              </span>
            </div>
          </div>
        </div>

        <div className="grid-wrap single" id="tenMinGrid">
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
                  const act = actualSlots[slot];
                  const fillPct = act ? Math.min(100, Math.max(25, act.mins * 10)) : 0;
                  const isDimmed =
                    Boolean(filterHeading) && act && act.heading !== filterHeading;
                  const isInspected = selectedSlot === slot;
                  const windowLbl = getSlotWindowLabel(slot);

                  return (
                    <button
                      type="button"
                      key={slot}
                      className={`slot ${act ? 'filled' : ''} ${isInspected ? 'inspected' : ''}`}
                      style={{
                        padding: 0,
                        cursor: act ? 'pointer' : 'default',
                        opacity: isDimmed ? 0.22 : 1,
                        outline: isInspected
                          ? `2px solid ${act?.color || 'var(--ac)'}`
                          : 'none',
                        outlineOffset: '-1px',
                      }}
                      data-slot={slot}
                      aria-label={
                        act
                          ? `${windowLbl}: ${act.heading} (${act.mins}m active)`
                          : `${windowLbl}: Empty`
                      }
                      title={
                        act
                          ? `${windowLbl} · ${act.heading} (${act.mins}m active)`
                          : `${windowLbl} · 0m`
                      }
                      onClick={() => handleSlotTap(slot)}
                    >
                      {act && (
                        <i
                          style={{
                            background: act.color,
                            width: `${fillPct}%`,
                          }}
                        />
                      )}
                    </button>
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
