import React, { useMemo, useState } from 'react';
import {
  Award,
  BarChart3,
  Calendar,
  ChevronDown,
  ChevronRight,
  Clock,
  Flame,
  Plus,
} from 'lucide-react';
import type { PulseHabitState, StatsSubTab } from '../types';
import {
  addD,
  badges,
  computeChapterBreakdown,
  computeConsistencyCalendar,
  computeStudySummary,
  type ConsistencyDay,
  DN,
  fmtClockTime,
  fmtHMShort,
  getSessionHeading,
  getSubject,
  getTodaySubjectMs,
  live,
  pad,
  rate,
  streak,
  total,
  wkS,
} from '../utils/studyLogic';
import { computeConsistencyScore } from '../utils/insights';
import { computeLevelInfo, computeTotalXp } from '../utils/xp';
import { PlannerView } from './PlannerView';
import { ReviewView } from './ReviewView';
import { DayHistoryView } from './DayHistoryView';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { EmptyState } from './ui/EmptyState';
import { Meter } from './ui/Meter';
import { SectionHeader } from './ui/SectionHeader';
import { Segmented } from './ui/Segmented';
import { Sparkline } from './ui/Sparkline';
import { Stat } from './ui/Stat';
import { WindowedList } from './ui/WindowedList';
import { resolveRuntimeUi3d } from './three/Scene3D';
import { StudySkylineScene } from './three/StudySkylineScene';

interface StatsViewProps {
  state: PulseHabitState;
  sel: string;
  todayKey: string;
  subTab: StatsSubTab;
  onChangeSubTab: (sub: StatsSubTab) => void;
  onOpenManualSession: (defaultSubjectId?: string) => void;
  onEditSession?: (sessionId: string) => void;
  onSelectDateInToday?: (dayKey: string) => void;
  onToast?: (msg: string) => void;
}

type WhereTimeGoesTab = 'subject' | 'mode' | 'chapter';

export const StatsView: React.FC<StatsViewProps> = ({
  state,
  sel,
  todayKey,
  subTab,
  onChangeSubTab,
  onOpenManualSession,
  onEditSession,
  onSelectDateInToday,
  onToast,
}) => {
  const summary = useMemo(
    () => computeStudySummary(state, todayKey),
    [state, todayKey]
  );
  const consistencyCal = useMemo(
    () => computeConsistencyCalendar(state, todayKey, 90),
    [state, todayKey]
  );
  const consistencyScore = useMemo(
    () => computeConsistencyScore(state, todayKey),
    [state, todayKey]
  );
  const chapterBreakdown = useMemo(() => computeChapterBreakdown(state), [state]);

  const [whereTab, setWhereTab] = useState<WhereTimeGoesTab>('subject');
  const [showConsistencyDetails, setShowConsistencyDetails] = useState<boolean>(true);
  const [selectedCalDayKey, setSelectedCalDayKey] = useState<string | null>(todayKey);
  const [historyDateKey, setHistoryDateKey] = useState<string>(todayKey);
  const [showAllSessionsLog, setShowAllSessionsLog] = useState<boolean>(false);

  // Default to Flat view when in Lite mode, 'off', or prefers-reduced-motion
  const runtime3d = useMemo(
    () => resolveRuntimeUi3d(state.set.ui3d || 'auto', false),
    [state.set.ui3d]
  );
  const [heatmapViewMode, setHeatmapViewMode] = useState<'flat' | 'skyline'>(() =>
    runtime3d.enabled && runtime3d.tier === 'normal' ? 'skyline' : 'flat'
  );

  const selectedCalDay: ConsistencyDay | null =
    (selectedCalDayKey
      ? consistencyCal.days.find((d) => d.key === selectedCalDayKey)
      : null) ||
    consistencyCal.days[consistencyCal.days.length - 1] ||
    null;

  // Delta vs prior 7 days (days -13..-7 vs -6..0)
  const prior7TotalMs = useMemo(() => {
    let ms = 0;
    for (let i = 7; i < 14; i++) {
      const dk = addD(todayKey, -i);
      ms += getTodaySubjectMs(state, 'any', dk, todayKey);
    }
    return ms;
  }, [state, todayKey]);

  const weekDeltaPct = useMemo(() => {
    if (prior7TotalMs <= 0) return null;
    return Math.round(((summary.weekTotalMs - prior7TotalMs) / prior7TotalMs) * 100);
  }, [summary.weekTotalMs, prior7TotalMs]);

  // 12-Week Study Depth Heatmap (84 days)
  const hmCells = useMemo(() => {
    const s0 = wkS(state, addD(todayKey, -77));
    const out: Array<{ key: string; future: boolean; hrs: number; lvlClass: string }> = [];
    for (let i = 0; i < 84; i++) {
      const k = addD(s0, i);
      if (k > todayKey) {
        out.push({ key: k, future: true, hrs: 0, lvlClass: 'hm-l0' });
        continue;
      }
      const hrs = getTodaySubjectMs(state, 'any', k, todayKey) / 3600000;
      const lvlClass =
        hrs <= 0
          ? 'hm-l0'
          : hrs < 2
            ? 'hm-l1'
            : hrs < 4
              ? 'hm-l2'
              : hrs < 6
                ? 'hm-l3'
                : hrs < 8
                  ? 'hm-l4'
                  : 'hm-l5';
      out.push({ key: k, future: false, hrs, lvlClass });
    }
    return out;
  }, [state, todayKey]);

  const maxWeekDayMs = Math.max(3600000, ...summary.last7Days.map((d) => d.ms));
  const maxHrMs = Math.max(1800000, ...summary.hourlyMs);
  const peak30dMs = Math.max(0, ...summary.last30Days.map((d) => d.ms));
  const avg30dHours = Number((summary.monthAvgMsPerDay / 3600000).toFixed(2));
  const consistencyPct = Math.round((summary.monthActiveDays / 30) * 100);

  const totalXp = computeTotalXp(state, todayKey);
  const levelInfo = computeLevelInfo(totalXp);
  const level = levelInfo.level;
  const nx = levelInfo.nextLevelXp;
  const pv = levelInfo.currentLevelFloorXp;
  const liveHabits = live(state);

  return (
    <div className="space-y-4">
      {/* Top 4-Option Segmented Navigation: Overview | Weekly review | History | Timeline */}
      <Segmented<StatsSubTab>
        value={subTab}
        onChange={onChangeSubTab}
        ariaLabel="Insights sections"
        options={[
          { value: 'summary', label: 'Overview' },
          { value: 'review', label: 'Weekly review' },
          { value: 'history', label: 'History' },
          { value: 'timeline', label: 'Timeline' },
        ]}
      />

      {subTab === 'history' ? (
        <DayHistoryView
          key={historyDateKey}
          state={state}
          todayKey={todayKey}
          initialDateKey={historyDateKey}
          onSelectDateInToday={onSelectDateInToday}
          onEditSession={onEditSession}
          onOpenManualSession={onOpenManualSession}
        />
      ) : subTab === 'timeline' ? (
        <PlannerView
          state={state}
          sel={sel}
          todayKey={todayKey}
          onOpenManualSession={onOpenManualSession}
          onToast={onToast}
        />
      ) : subTab === 'review' ? (
        <ReviewView
          state={state}
          todayKey={todayKey}
          onToast={(msg) => onToast?.(msg)}
        />
      ) : (
        <div className="space-y-4">
          {/* Clean Empty State when 0 sessions */}
          {state.sessions.length === 0 && (
            <EmptyState
              icon={<BarChart3 size={22} />}
              title="No study sessions logged yet"
              description="Start a focus timer or log your first session to unlock subject breakdowns, peak hour detection, and 30-day trends."
              action={
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Plus size={16} />}
                  onClick={() => onOpenManualSession()}
                >
                  Log your first session
                </Button>
              }
            />
          )}

          {/* Hero Metric Card: 7-Day Average + Delta vs Prior 7d + Sparkline */}
          <Card>
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <span className="text-[12px] font-medium text-[var(--tx-2)]">
                  7-day daily average
                </span>
                <div className="flex items-baseline gap-2.5">
                  <strong className="tnum text-[32px] font-bold leading-none text-[var(--tx)]">
                    {fmtHMShort(summary.weekAvgMsPerDay)}
                  </strong>
                  <span className="text-[13px] text-[var(--tx-2)]">/ day</span>
                  {weekDeltaPct !== null && (
                    <span
                      className="tnum rounded-md px-2 py-0.5 text-[12px] font-semibold"
                      style={{
                        background: 'var(--sf-2)',
                        color:
                          weekDeltaPct >= 0 ? 'var(--ok)' : 'var(--warn)',
                      }}
                    >
                      {weekDeltaPct >= 0 ? `+${weekDeltaPct}%` : `${weekDeltaPct}%`} vs
                      prior 7d
                    </span>
                  )}
                </div>
                <p className="tnum text-[12.5px] text-[var(--tx-2)]">
                  Week total: <strong>{fmtHMShort(summary.weekTotalMs)}</strong> ·{' '}
                  {summary.weekActiveDays}/7 active days · 30d avg:{' '}
                  <strong>{fmtHMShort(summary.monthAvgMsPerDay)}/d</strong> · All-time:{' '}
                  <strong>{fmtHMShort(summary.allTimeTotalMs)}</strong>
                </p>
              </div>

              <div className="flex items-center gap-4">
                <div className="rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3.5 py-2.5">
                  <span className="block text-[12px] text-[var(--tx-2)] mb-1">
                    Last 7 days trend
                  </span>
                  <Sparkline
                    values={summary.last7Days.map((d) =>
                      Math.round(d.ms / 60000)
                    )}
                    width={140}
                    height={36}
                  />
                </div>
              </div>
            </div>

            {/* 7-Day Bar Strip */}
            <div className="mt-4 grid grid-cols-7 gap-2 border-t border-[var(--line)] pt-4">
              {summary.last7Days.map((d) => {
                const barPct =
                  d.ms > 0 ? Math.max(10, Math.round((d.ms / maxWeekDayMs) * 100)) : 5;
                const isToday = d.key === todayKey;
                return (
                  <div
                    key={d.key}
                    className="flex flex-col items-center gap-1.5"
                    title={`${d.shortDate}: ${fmtHMShort(d.ms)} (${d.sessionsCount} sessions)`}
                  >
                    <span className="tnum text-[12px] text-[var(--tx-2)]">
                      {d.ms > 0 ? fmtHMShort(d.ms) : '0m'}
                    </span>
                    <div className="flex h-20 w-full max-w-[32px] items-end rounded-lg bg-[var(--sf-2)] p-0.5">
                      <div
                        className="w-full rounded-md transition-all"
                        style={{
                          height: `${barPct}%`,
                          background:
                            d.ms > 0
                              ? isToday
                                ? 'var(--ac)'
                                : 'var(--ok)'
                              : 'transparent',
                        }}
                      />
                    </div>
                    <span
                      className={`text-[12px] font-medium ${
                        isToday ? 'text-[var(--ac-ink)]' : 'text-[var(--tx-2)]'
                      }`}
                    >
                      {d.dayName}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Tabbed "Where your time goes" Card (Subject | Mode | Chapter) */}
          <Card id="subjectBreakdownCard" className="space-y-3">
            <div className="split flex-wrap gap-2">
              <div>
                <h3 className="text-[15px] font-semibold text-[var(--tx)]">
                  Where your time goes
                </h3>
                <p className="text-[12px] text-[var(--tx-2)]">
                  Breakdown by subject, timer mode, or syllabus chapter
                </p>
              </div>
              <div className="w-full sm:w-64">
                <Segmented<WhereTimeGoesTab>
                  value={whereTab}
                  onChange={setWhereTab}
                  ariaLabel="Where your time goes breakdown"
                  options={[
                    { value: 'subject', label: 'Subject' },
                    { value: 'mode', label: 'Mode' },
                    { value: 'chapter', label: 'Chapter' },
                  ]}
                />
              </div>
            </div>

            {whereTab === 'subject' && (
              <div className="space-y-3 pt-1">
                {summary.subjectBreakdown.map((item) => (
                  <div key={item.subjectId}>
                    <div className="split mb-1 text-[13px]">
                      <span className="flex items-center gap-2 font-medium text-[var(--tx)]">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ background: item.color }}
                        />
                        {item.e} {item.name}{' '}
                        <span className="text-[12px] text-[var(--tx-3)]">
                          ({item.count} {item.count === 1 ? 'session' : 'sessions'})
                        </span>
                      </span>
                      <span className="tnum font-medium text-[var(--tx-2)]">
                        {fmtHMShort(item.ms)} ({item.pct}%)
                      </span>
                    </div>
                    <Meter value={item.pct} max={100} color={item.color} />
                  </div>
                ))}
              </div>
            )}

            {whereTab === 'mode' && (
              <div className="space-y-3 pt-1">
                {summary.modeBreakdown.map((item) => (
                  <div key={item.mode}>
                    <div className="split mb-1 text-[13px]">
                      <span className="font-medium text-[var(--tx)]">
                        {item.label}{' '}
                        <span className="text-[12px] text-[var(--tx-3)]">
                          ({item.count} {item.count === 1 ? 'session' : 'sessions'})
                        </span>
                      </span>
                      <span className="tnum font-medium text-[var(--tx-2)]">
                        {fmtHMShort(item.ms)} ({item.pct}%)
                      </span>
                    </div>
                    <Meter value={item.pct} max={100} color="var(--ac)" />
                  </div>
                ))}
              </div>
            )}

            {whereTab === 'chapter' && (
              <div className="space-y-3 pt-1">
                {chapterBreakdown.length === 0 ? (
                  <p className="text-[13px] text-[var(--tx-2)]">
                    Link a syllabus chapter when starting a Focus timer or logging a
                    manual session to track hours per chapter.
                  </p>
                ) : (
                  chapterBreakdown.slice(0, 15).map((row) => (
                    <div key={row.chapterId}>
                      <div className="split mb-1 text-[13px]">
                        <span className="truncate font-medium text-[var(--tx)]">
                          {row.subjectEmoji} {row.chapterName}{' '}
                          <span className="text-[12px] text-[var(--tx-3)]">
                            ({row.subjectName} · {row.count}s)
                          </span>
                        </span>
                        <span className="tnum font-medium text-[var(--tx-2)]">
                          {fmtHMShort(row.ms)} ({row.pct}%)
                        </span>
                      </div>
                      <Meter value={row.pct} max={100} color={row.color} />
                    </div>
                  ))
                )}
              </div>
            )}
          </Card>

          {/* "When you study" Card (Hourly distribution & Peak window) */}
          <Card className="space-y-3">
            <div className="split flex-wrap gap-2">
              <div>
                <h3 className="text-[15px] font-semibold text-[var(--tx)]">
                  When you study
                </h3>
                <p className="text-[12px] text-[var(--tx-2)]">
                  24-hour concentration rhythm · Peak 2h window:{' '}
                  <strong className="tnum text-[var(--ac-ink)]">
                    {summary.peakHourWindowLabel}
                  </strong>{' '}
                  ({summary.peakPeriodLabel})
                </p>
              </div>
              <div className="flex flex-wrap gap-3 text-[12px] text-[var(--tx-2)]">
                <span>
                  Avg start:{' '}
                  <strong className="tnum text-[var(--tx)]">
                    {summary.avgStartHourLabel}
                  </strong>
                </span>
                <span>
                  Avg wrap-up:{' '}
                  <strong className="tnum text-[var(--tx)]">
                    {summary.avgEndHourLabel}
                  </strong>
                </span>
                <span>
                  Purity:{' '}
                  <strong className="tnum text-[var(--ok-ink)]">
                    {summary.avgPurity}%
                  </strong>
                </span>
              </div>
            </div>

            <div className="circ-bars pt-2">
              {summary.hourlyMs.map((ms, h) => {
                const pctH = Math.round((ms / maxHrMs) * 100);
                const isPeak =
                  ms > 0 &&
                  (h === summary.peakHourIndex ||
                    h === (summary.peakHourIndex + 1) % 24);
                return (
                  <div key={h} title={`${pad(h)}:00 – ${fmtHMShort(ms)}`}>
                    <i
                      style={{
                        height: `${Math.max(4, pctH * 0.8)}px`,
                        background: isPeak
                          ? 'var(--ac)'
                          : ms > 0
                            ? 'var(--ok)'
                            : 'var(--sf-2)',
                      }}
                    />
                    <span>{h % 3 === 0 ? pad(h) : ''}</span>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Collapsible "Consistency" Card (Score + 90-day calendar + 12-week heatmap) */}
          <Card id="consistencyCalendarCard" className="p-0 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowConsistencyDetails((v) => !v)}
              aria-expanded={showConsistencyDetails}
              className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[var(--sf-2)]"
            >
              <div className="flex items-center gap-2.5">
                {showConsistencyDetails ? (
                  <ChevronDown size={18} className="text-[var(--tx-2)]" />
                ) : (
                  <ChevronRight size={18} className="text-[var(--tx-2)]" />
                )}
                <div>
                  <h3 className="text-[15px] font-semibold text-[var(--tx)]">
                    Consistency &amp; 90-day habit calendar
                  </h3>
                  <p className="text-[12px] text-[var(--tx-2)]">
                    Composite score, 90-day daily completion grid, and 12-week study depth
                    heatmap
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="tnum rounded-lg border border-[var(--ac-line)] bg-[var(--ac-soft)] px-2.5 py-1 text-[13px] font-semibold text-[var(--ac-ink)]">
                  Score {consistencyScore.displayLabel}
                  {consistencyScore.total !== null ? '/100' : ''}
                </span>
              </div>
            </button>

            {showConsistencyDetails && (
              <div className="space-y-4 border-t border-[var(--line)] p-4">
                {/* 4 Pillars of Consistency */}
                {consistencyScore.total !== null && (
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    <Stat
                      label="Min days (40%)"
                      value={`${consistencyScore.minDayScore100}/100`}
                      sub={`${consistencyScore.minDaysMetCount}/14 days met`}
                    />
                    <Stat
                      label="Start regularity (20%)"
                      value={
                        consistencyScore.startRegularityScore100 !== null
                          ? `${consistencyScore.startRegularityScore100}/100`
                          : '—'
                      }
                      sub={
                        consistencyScore.startStdDevMins !== null
                          ? `±${consistencyScore.startStdDevMins}m std dev`
                          : 'Need 2+ days'
                      }
                    />
                    <Stat
                      label="On-time revs (20%)"
                      value={
                        consistencyScore.revisionOnTimeScore100 !== null
                          ? `${consistencyScore.revisionOnTimeScore100}/100`
                          : '—'
                      }
                      sub={`${consistencyScore.revisionsOnTimeCount}/${consistencyScore.revisionsTotalCount} on time`}
                    />
                    <Stat
                      label="Focus purity (20%)"
                      value={
                        consistencyScore.purityScore100 !== null
                          ? `${consistencyScore.purityScore100}/100`
                          : '—'
                      }
                      sub="Active vs paused"
                    />
                  </div>
                )}

                {/* 90-Day Calendar Grid */}
                <div>
                  <div className="split mb-2 text-[12.5px] text-[var(--tx-2)]">
                    <span>
                      90-day habit completion · Perfect days:{' '}
                      <strong className="tnum text-[var(--tx)]">
                        {consistencyCal.perfectDays}
                      </strong>{' '}
                      · Active: <strong className="tnum">{consistencyCal.activeDays}/90</strong>
                    </span>
                    <span className="tnum font-semibold text-[var(--ok-ink)]">
                      {consistencyCal.avgPct}% avg
                    </span>
                  </div>

                  <div className="cc-scroll">
                    <div className="cc-layout">
                      <div className="cc-dow-col" aria-hidden="true">
                        {Array.from({ length: 7 }, (_, r) => {
                          const dow = ((state.set.ws ?? 1) + r) % 7;
                          return <span key={r}>{r % 2 === 0 ? DN[dow] : ''}</span>;
                        })}
                      </div>
                      <div className="cc-main">
                        <div className="cc-months" aria-hidden="true">
                          {consistencyCal.weeks.map((wk, wIdx) => {
                            const firstNonNull = wk.find((d) => d !== null);
                            const prevWeek =
                              wIdx > 0 ? consistencyCal.weeks[wIdx - 1] : null;
                            const prevNonNull = prevWeek?.find((d) => d !== null);
                            const showMonth =
                              firstNonNull &&
                              (wIdx === 0 ||
                                firstNonNull.monthShort !== prevNonNull?.monthShort);
                            return (
                              <span key={wIdx}>
                                {showMonth ? firstNonNull.monthShort : ''}
                              </span>
                            );
                          })}
                        </div>
                        <div
                          className="cc-weeks"
                          role="grid"
                          aria-label="90-Day Habit Consistency Calendar Heatmap"
                        >
                          {consistencyCal.weeks.map((wk, wIdx) => (
                            <div key={wIdx} className="cc-week-col" role="row">
                              {wk.map((day, dIdx) =>
                                day ? (
                                  <button
                                    type="button"
                                    key={day.key}
                                    className={`cc-cell cc-l${day.densityLevel} ${
                                      selectedCalDay?.key === day.key ? 'sel' : ''
                                    }`}
                                    title={`${day.dayName}, ${day.shortDate} (${day.key}): ${day.pct}% habits completed (${day.doneCount}/${day.dueCount}) · Studied ${fmtHMShort(day.studyMs)}`}
                                    aria-label={`${day.key} ${day.pct}% completed`}
                                    onClick={() => setSelectedCalDayKey(day.key)}
                                  />
                                ) : (
                                  <i
                                    key={`empty-${wIdx}-${dIdx}`}
                                    className="cc-cell-empty"
                                  />
                                )
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {selectedCalDay && (
                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3 py-2 text-[12.5px]">
                      <span>
                        <strong>
                          {selectedCalDay.dayName}, {selectedCalDay.shortDate}
                        </strong>{' '}
                        <span className="tnum text-[var(--tx-2)]">
                          ({selectedCalDay.key}) · Habits {selectedCalDay.doneCount}/
                          {selectedCalDay.dueCount} ({selectedCalDay.pct}%) · Study{' '}
                          {fmtHMShort(selectedCalDay.studyMs)}
                        </span>
                      </span>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Calendar size={14} />}
                        onClick={() => {
                          setHistoryDateKey(selectedCalDay.key);
                          onChangeSubTab('history');
                        }}
                      >
                        Open day record
                      </Button>
                    </div>
                  )}
                </div>

                {/* 12-Week Study Depth Heatmap / 3D Skyline */}
                <div className="space-y-2.5">
                  <div className="split flex-wrap gap-2">
                    <div className="text-[12.5px] text-[var(--tx-2)]">
                      <strong className="text-[var(--tx)]">12-week study depth</strong> · 0h ·
                      &lt;2h · 4h · 6h · 8h+
                    </div>
                    {state.set.ui3d !== 'off' && (
                      <div className="w-48">
                        <Segmented<'skyline' | 'flat'>
                          value={heatmapViewMode}
                          onChange={setHeatmapViewMode}
                          ariaLabel="12-week study depth view mode"
                          options={[
                            { value: 'skyline', label: '3D Skyline' },
                            { value: 'flat', label: 'Flat view' },
                          ]}
                        />
                      </div>
                    )}
                  </div>

                  {heatmapViewMode === 'skyline' && state.set.ui3d !== 'off' ? (
                    <StudySkylineScene
                      cells={hmCells}
                      ui3dSetting="on"
                      onInspectDay={(dayKey) => {
                        setHistoryDateKey(dayKey);
                        onChangeSubTab('history');
                      }}
                    />
                  ) : (
                    <div className="hm">
                      {hmCells.map((cell) =>
                        cell.future ? (
                          <i key={cell.key} style={{ opacity: 0.18 }} />
                        ) : (
                          <i
                            key={cell.key}
                            className={cell.lvlClass}
                            title={`${cell.key}: ${cell.hrs.toFixed(1)}h studied`}
                          />
                        )
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </Card>

          {/* Deep Work Frequency (Last 30 Days) */}
          <Card id="deepWorkFrequencyCard">
            <SectionHeader
              title="Deep work frequency (last 30 days)"
              subtitle={`30d total ${fmtHMShort(summary.monthTotalMs)} · Peak day ${fmtHMShort(peak30dMs)} · ${summary.monthActiveDays}/30 active (${consistencyPct}%)`}
            />
            {(() => {
              const pts = summary.last30Days;
              const W = 580;
              const H = 180;
              const padL = 42;
              const padR = 14;
              const padT = 14;
              const padB = 28;
              const plotW = W - padL - padR;
              const plotH = H - padT - padB;
              const maxHrs = Math.max(
                2,
                Math.ceil(Math.max(...pts.map((p) => p.hours)) + 0.5)
              );
              const toX = (i: number) =>
                pts.length <= 1
                  ? padL + plotW / 2
                  : padL + (i / (pts.length - 1)) * plotW;
              const toY = (hrs: number) => padT + plotH - (hrs / maxHrs) * plotH;
              const polyPoints = pts
                .map((p, i) => `${toX(i).toFixed(1)},${toY(p.hours).toFixed(1)}`)
                .join(' ');
              const avgY = avg30dHours > 0 ? toY(avg30dHours) : null;

              return (
                <svg
                  id="deepWorkFrequencyChart"
                  viewBox={`0 0 ${W} ${H}`}
                  className="mt-2 block h-[180px] w-full"
                  role="img"
                  aria-label="Deep Work Frequency 30-Day Line Chart"
                >
                  {[0, 0.5, 1].map((frac) => {
                    const hVal = Number((frac * maxHrs).toFixed(1));
                    const y = toY(hVal);
                    return (
                      <g key={frac}>
                        <line
                          x1={padL}
                          y1={y}
                          x2={W - padR}
                          y2={y}
                          stroke="rgba(255,255,255,0.08)"
                          strokeDasharray="3 3"
                        />
                        <text
                          x={padL - 6}
                          y={y + 4}
                          textAnchor="end"
                          fill="#A3ABB8"
                          fontSize="12"
                        >
                          {hVal}h
                        </text>
                      </g>
                    );
                  })}
                  {avgY !== null && avgY >= padT && avgY <= H - padB && (
                    <line
                      x1={padL}
                      y1={avgY}
                      x2={W - padR}
                      y2={avgY}
                      stroke="#F5C451"
                      strokeDasharray="4 4"
                      strokeOpacity="0.8"
                    />
                  )}
                  <polyline
                    fill="none"
                    stroke="#4ADE80"
                    strokeWidth="2.5"
                    points={polyPoints}
                  />
                  {pts.map((p, i) => {
                    const cx = toX(i);
                    const cy = toY(p.hours);
                    return (
                      <g key={p.key}>
                        <circle
                          cx={cx}
                          cy={cy}
                          r={p.ms > 0 ? 3.5 : 2}
                          fill={p.ms > 0 ? '#4ADE80' : '#6F7886'}
                        >
                          <title>{`${p.dayName}, ${p.shortDate} (${p.key}): ${p.formatted}`}</title>
                        </circle>
                        {i % 5 === 0 && (
                          <text
                            x={cx}
                            y={H - 8}
                            textAnchor="middle"
                            fill="#A3ABB8"
                            fontSize="12"
                          >
                            {p.shortDate}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>
              );
            })()}
          </Card>

          {/* Session Headings & Study Log */}
          <Card className="space-y-3">
            <SectionHeader
              title="Session headings &amp; study log"
              subtitle={`${summary.headingBreakdown.length} distinct study topics`}
            />

            {summary.headingBreakdown.length > 0 ? (
              <div className="space-y-2.5">
                {summary.headingBreakdown.slice(0, 10).map((item) => (
                  <div key={item.heading}>
                    <div className="split mb-1 text-[13px]">
                      <span className="flex items-center gap-2 font-medium text-[var(--tx)]">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ background: item.color }}
                        />
                        {item.heading}{' '}
                        <span className="text-[12px] text-[var(--tx-3)]">
                          ({item.count}s)
                        </span>
                      </span>
                      <span className="tnum font-medium text-[var(--ok-ink)]">
                        {fmtHMShort(item.ms)}
                      </span>
                    </div>
                    <Meter value={item.pct} max={100} color={item.color} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-[var(--tx-2)]">
                No study sessions logged yet.
              </p>
            )}

            {state.sessions.length > 0 && (() => {
              const sortedSessions = state.sessions
                .slice()
                .sort((a, b) => b.startTs - a.startTs);
              const displayedSessions = showAllSessionsLog
                ? sortedSessions
                : sortedSessions.slice(0, 6);
              return (
                <div className="border-t border-[var(--line)] pt-3">
                  <div className="split mb-2 flex-wrap gap-2">
                    <h4 className="text-[12.5px] font-semibold text-[var(--tx-2)]">
                      Recent sessions ({sortedSessions.length})
                    </h4>
                    {sortedSessions.length > 6 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowAllSessionsLog((v) => !v)}
                      >
                        {showAllSessionsLog
                          ? 'Show recent 6'
                          : `View all ${sortedSessions.length}`}
                      </Button>
                    )}
                  </div>
                  <WindowedList
                    items={displayedSessions}
                    threshold={100}
                    estimatedRowHeight={72}
                    itemLabel="sessions"
                    className="divide-y divide-[var(--line)]"
                    getKey={(s) => s.id}
                    renderItem={(s) => {
                      const sub = getSubject(state, s.subjectId);
                      const heading = getSessionHeading(state, s);
                      return (
                        <div className="flex items-center justify-between gap-3 py-2.5">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 text-[13.5px] font-medium text-[var(--tx)]">
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ background: sub.color }}
                              />
                              <span className="truncate">
                                {sub.e} {sub.name} · {heading}
                              </span>
                            </div>
                            <p className="tnum text-[12px] text-[var(--tx-2)]">
                              {s.dayKey} · {fmtClockTime(s.startTs)} –{' '}
                              {fmtClockTime(s.endTs)} · {s.mode}
                            </p>
                            {s.note && (
                              <p className="mt-0.5 text-[12px] text-[var(--tx-2)]">
                                “{s.note}”
                              </p>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <strong className="tnum text-[13.5px] text-[var(--ok-ink)]">
                              {fmtHMShort(s.activeMs)}
                            </strong>
                            {onEditSession && (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => onEditSession(s.id)}
                              >
                                Edit
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    }}
                  />
                </div>
              );
            })()}
          </Card>

          {/* Level, Badges & Habit Streaks */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="space-y-3">
              <div className="split">
                <div className="flex items-center gap-2">
                  <Award size={18} className="text-[var(--ac-ink)]" aria-hidden="true" />
                  <h3 className="text-[15px] font-semibold text-[var(--tx)]">
                    Level {level} · {totalXp.toLocaleString()} XP
                  </h3>
                </div>
                <span className="tnum text-[12px] text-[var(--tx-2)]">
                  {nx - totalXp} XP to Level {level + 1}
                </span>
              </div>
              <Meter
                value={Math.round(((totalXp - pv) / Math.max(1, nx - pv)) * 100)}
                max={100}
              />
              <div className="flex flex-wrap gap-1.5 pt-1">
                {badges(state, todayKey).map(([n, unlocked]) => (
                  <span
                    key={n}
                    className={`rounded-lg border border-[var(--line)] bg-[var(--sf-2)] px-2.5 py-1 text-[12px] ${
                      unlocked
                        ? 'font-medium text-[var(--tx)]'
                        : 'opacity-40 text-[var(--tx-3)]'
                    }`}
                  >
                    {n}
                  </span>
                ))}
              </div>
            </Card>

            <Card className="space-y-2.5">
              <div className="flex items-center gap-2">
                <Flame size={18} className="text-[var(--ac-ink)]" aria-hidden="true" />
                <h3 className="text-[15px] font-semibold text-[var(--tx)]">
                  Habit streaks
                </h3>
              </div>
              {liveHabits.length === 0 ? (
                <p className="text-[13px] text-[var(--tx-2)]">No habits active yet.</p>
              ) : (
                <div className="divide-y divide-[var(--line)]">
                  {liveHabits.map((h) => {
                    const s = streak(state, h, todayKey);
                    return (
                      <div
                        key={h.id}
                        className="flex items-center justify-between gap-2 py-2 text-[13px]"
                      >
                        <span className="font-medium text-[var(--tx)]">
                          {h.e} {h.name}
                        </span>
                        <span className="tnum text-[12px] text-[var(--tx-2)]">
                          {s.cur}d now · Best {s.best}d · 7d{' '}
                          {rate(state, h, 7, todayKey)}% · {total(state, h)} logs
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
};
