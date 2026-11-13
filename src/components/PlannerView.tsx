import React, { useMemo, useState } from 'react';
import { Clock, Plus, X } from 'lucide-react';
import type { PulseHabitState } from '../types';
import {
  fmtClockTime,
  fmtHMShort,
  getSessionHeading,
  getSubject,
  getTimerMetrics,
  getTodaySubjectMs,
  pad,
} from '../utils/studyLogic';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { Chip } from './ui/Chip';
import { SectionHeader } from './ui/SectionHeader';
import { Stat } from './ui/Stat';
import { Switch } from './ui/Switch';

interface PlannerViewProps {
  state: PulseHabitState;
  sel: string;
  todayKey: string;
  onOpenManualSession: (defaultSubjectId?: string) => void;
  onToast?: (msg: string) => void;
}

interface SlotTopicEntry {
  topicKey: string;
  subjectName: string;
  subjectEmoji: string;
  heading: string;
  color: string;
  mins: number;
}

interface SlotData {
  slotIndex: number;
  windowLabel: string;
  subjectName: string;
  subjectEmoji: string;
  heading: string;
  color: string;
  mins: number;
  entries: SlotTopicEntry[];
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
  const [showFull24h, setShowFull24h] = useState<boolean>(false);

  const resetHr = state.set.dayResetHour ?? 0;
  const allHours = useMemo(
    () => [...Array(24)].map((_, i) => (resetHr + i) % 24),
    [resetHr]
  );

  const daySessions = useMemo(
    () =>
      state.sessions
        .filter((s) => s.dayKey === sel)
        .slice()
        .sort((a, b) => a.startTs - b.startTs),
    [state.sessions, sel]
  );

  const now = Date.now();
  const isLiveToday =
    Boolean(state.activeTimer) &&
    sel === todayKey &&
    state.activeTimer?.phase !== 'break';
  const liveMetrics = isLiveToday ? getTimerMetrics(state, now) : null;

  const actualSlots: Record<number, SlotData> = {};
  const topicTotals: Record<
    string,
    {
      key: string;
      subjectEmoji: string;
      subjectName: string;
      heading: string;
      color: string;
      activeMs: number;
    }
  > = {};

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
    subjectId: string,
    heading: string,
    isLive = false
  ) => {
    const sub = getSubject(state, subjectId);
    const cleanHeading = (heading || sub.name || 'Deep Study Session').trim();
    const color = sub.color || '#F5C451';
    const topicKey = `${sub.id}::${cleanHeading}`;

    if (!topicTotals[topicKey]) {
      topicTotals[topicKey] = {
        key: topicKey,
        subjectEmoji: sub.e,
        subjectName: sub.name,
        heading: cleanHeading,
        color,
        activeMs: 0,
      };
    }
    topicTotals[topicKey].activeMs += Math.max(0, activeMs);

    if (activeMs <= 0) return;

    const totalActiveMins = Math.max(1, Math.min(1440, Math.round(activeMs / 60000)));
    const safeEnd = Math.max(startTs + 60000, endTs);
    const stepMs = (safeEnd - startTs) / totalActiveMins;

    for (let i = 0; i < totalActiveMins; i++) {
      const ts = startTs + Math.floor(i * stepMs);
      const d = new Date(ts);
      const slotIdx = d.getHours() * 6 + Math.floor(d.getMinutes() / 10);
      if (!actualSlots[slotIdx]) {
        actualSlots[slotIdx] = {
          slotIndex: slotIdx,
          windowLabel: getSlotWindowLabel(slotIdx),
          subjectName: sub.name,
          subjectEmoji: sub.e,
          heading: cleanHeading,
          color,
          mins: 0,
          entries: [],
          isLive,
        };
      }
      const slot = actualSlots[slotIdx];
      let entry = slot.entries.find((e) => e.topicKey === topicKey);
      if (!entry) {
        entry = {
          topicKey,
          subjectName: sub.name,
          subjectEmoji: sub.e,
          heading: cleanHeading,
          color,
          mins: 0,
        };
        slot.entries.push(entry);
      }
      entry.mins += 1;
      slot.mins = Math.min(10, slot.mins + 1);
      if (isLive) slot.isLive = true;

      const dominant = slot.entries.reduce(
        (best, cur) => (cur.mins > best.mins ? cur : best),
        slot.entries[0]
      );
      slot.subjectName = dominant.subjectName;
      slot.subjectEmoji = dominant.subjectEmoji;
      slot.heading = dominant.heading;
      slot.color = dominant.color;
    }
  };

  daySessions.forEach((s) =>
    paintSessionIntoSlots(
      s.startTs,
      s.endTs,
      s.activeMs,
      s.subjectId,
      getSessionHeading(state, s),
      false
    )
  );

  if (isLiveToday && state.activeTimer && liveMetrics) {
    paintSessionIntoSlots(
      state.activeTimer.sliceStartTs,
      now,
      liveMetrics.sliceActiveMs,
      state.activeTimer.subjectId,
      state.activeTimer.heading || liveMetrics.subject.name || 'Deep Study Session',
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
      ? `${fmtClockTime(firstStartTs)} → ${isLiveToday ? 'Now' : fmtClockTime(lastEndTs)}`
      : '—';

  const topicList = Object.values(topicTotals).sort((a, b) => b.activeMs - a.activeMs);
  const inspectedSlot = selectedSlot !== null ? actualSlots[selectedSlot] || null : null;

  // Compute active window ±1h around logged slots when showFull24h is false
  const visibleHours = useMemo(() => {
    if (showFull24h) return allHours;
    const filledSlotIndices = Object.keys(actualSlots).map(Number);
    if (filledSlotIndices.length === 0) {
      // Default daytime window 06:00–22:00 when empty
      return allHours.filter((h) => h >= 6 && h <= 22);
    }
    const filledHours = filledSlotIndices.map((idx) => Math.floor(idx / 6));
    const minH = Math.max(0, Math.min(...filledHours) - 1);
    const maxH = Math.min(23, Math.max(...filledHours) + 1);
    return allHours.filter((h) => h >= minH && h <= maxH);
  }, [showFull24h, allHours, actualSlots]);

  const handleSlotTap = (slotIdx: number) => {
    const data = actualSlots[slotIdx];
    if (!data) {
      setSelectedSlot(null);
      return;
    }
    setSelectedSlot(slotIdx);
    onToast?.(
      `${data.windowLabel} · ${data.subjectEmoji} ${data.subjectName}: ${data.heading} (${data.mins}m active)`
    );
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="split mb-3 flex-wrap gap-2">
          <div>
            <h3 className="text-[16px] font-semibold text-[var(--tx)]">
              10-minute study timeline ({sel})
            </h3>
            <p className="text-[12px] text-[var(--tx-2)]">
              Automatic 10-minute resolution log from your focus timers and sessions
            </p>
          </div>
          <Button
            variant="primary"
            size="sm"
            icon={<Plus size={16} />}
            onClick={() => onOpenManualSession()}
          >
            Log session
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          <div id="gridTotalStudiedPill">
            <Stat label="Total studied" value={fmtHMShort(totalStudiedMs)} />
          </div>
          <div id="gridSessionsCountPill">
            <Stat label="Sessions" value={String(sessionsCount)} />
          </div>
          <div id="gridTimeSpanPill">
            <Stat label="First → last" value={spanText} />
          </div>
        </div>
      </Card>

      {/* Topics Legend */}
      <Card>
        <div className="split mb-2">
          <span className="text-[13.5px] font-semibold text-[var(--tx)]">
            Topics logged on {sel}
          </span>
          {filterHeading && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFilterHeading(null)}
            >
              Show all topics
            </Button>
          )}
        </div>
        {topicList.length > 0 ? (
          <div id="todayTopicsLegend" className="flex flex-wrap gap-2">
            {topicList.map((topic) => (
              <Chip
                key={topic.key}
                selected={filterHeading === topic.heading}
                colorDot={topic.color}
                onClick={() =>
                  setFilterHeading((prev) =>
                    prev === topic.heading ? null : topic.heading
                  )
                }
              >
                {topic.subjectEmoji} {topic.subjectName}: {topic.heading} ·{' '}
                <strong className="tnum">{fmtHMShort(topic.activeMs)}</strong>
              </Chip>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-[var(--tx-2)]">
            No study topics logged for {sel} yet. Start a Focus session or tap + Log
            session to populate your timeline.
          </p>
        )}
      </Card>

      {/* Tap-to-inspect slot inspector */}
      <Card id="slotInspectorBar">
        {inspectedSlot ? (
          <div className="split flex-wrap gap-2">
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="mono rounded-lg border border-[var(--line)] bg-[var(--sf-2)] px-2.5 py-1 font-semibold text-[var(--tx)]">
                {inspectedSlot.windowLabel}
              </span>
              <span className="flex items-center gap-1.5 font-semibold text-[var(--tx)]">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: inspectedSlot.color }}
                />
                {inspectedSlot.subjectEmoji} {inspectedSlot.subjectName} ·{' '}
                {inspectedSlot.heading}
              </span>
              <span className="tnum rounded-md bg-[var(--sf-2)] px-2 py-0.5 text-[12px] font-medium text-[var(--ok-ink)]">
                {inspectedSlot.mins} / 10 min active
                {inspectedSlot.isLive ? ' · LIVE' : ''}
              </span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              icon={<X size={14} />}
              onClick={() => setSelectedSlot(null)}
            >
              Clear
            </Button>
          </div>
        ) : (
          <div className="split flex-wrap gap-2 text-[12.5px] text-[var(--tx-2)]">
            <span className="flex items-center gap-2">
              <Clock size={15} className="text-[var(--ac-ink)]" aria-hidden="true" />
              Tap any colored 10-minute block below to inspect its exact window and active
              minutes.
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-[var(--tx-2)]">Show full 24h</span>
              <Switch
                checked={showFull24h}
                onChange={setShowFull24h}
                label="Show full 24-hour timeline"
              />
            </div>
          </div>
        )}
      </Card>

      {/* 10-Minute Grid */}
      <Card>
        <SectionHeader
          title={showFull24h ? 'Full 24-hour grid' : 'Active window (±1h)'}
          subtitle="Each row is 1 hour split into six 10-minute blocks (:00 to :50)"
        />

        <div id="tenMinGrid" className="mt-3 space-y-1.5">
          {visibleHours.map((h) => (
            <div
              key={h}
              className="grid grid-cols-[54px_1fr] items-center gap-2"
            >
              <div className="mono text-[12px] text-[var(--tx-2)]">{pad(h)}:00</div>
              <div className="grid grid-cols-6 gap-1.5">
                {[0, 1, 2, 3, 4, 5].map((idx) => {
                  const slot = h * 6 + idx;
                  const act = actualSlots[slot];
                  const fillPct = act ? Math.min(100, Math.max(25, act.mins * 10)) : 0;
                  const isDimmed =
                    Boolean(filterHeading) &&
                    act &&
                    !act.entries.some((e) => e.heading === filterHeading);
                  const isInspected = selectedSlot === slot;
                  const windowLbl = getSlotWindowLabel(slot);

                  return (
                    <button
                      type="button"
                      key={slot}
                      data-slot={slot}
                      onClick={() => handleSlotTap(slot)}
                      aria-label={
                        act
                          ? `${windowLbl}: ${act.subjectName} — ${act.heading} (${act.mins}m active)`
                          : `${windowLbl}: Empty`
                      }
                      title={
                        act
                          ? `${windowLbl} · ${act.subjectName}: ${act.heading} (${act.mins}m active)`
                          : `${windowLbl} · 0m`
                      }
                      className={`relative h-6 overflow-hidden rounded-md border transition-opacity ${
                        isInspected
                          ? 'border-[var(--ac)] ring-1 ring-[var(--ac)]'
                          : 'border-[var(--line)]'
                      } bg-[var(--sf-2)]`}
                      style={{
                        opacity: isDimmed ? 0.25 : 1,
                        cursor: act ? 'pointer' : 'default',
                      }}
                    >
                      {act && (
                        <span
                          className="block h-full rounded-sm"
                          style={{
                            width: `${fillPct}%`,
                            background: act.color,
                          }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};
