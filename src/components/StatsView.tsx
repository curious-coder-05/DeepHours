import React, { useMemo, useState } from 'react';
import {
  Award,
  Calendar,
  ChevronDown,
  ChevronRight,
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
import {
  AreaLineChart,
  BarChart,
  Button,
  Card,
  DonutChart,
  EmptyState,
  HeatmapGrid,
  Meter,
  RadialClock24h,
  SectionHeader,
  Segmented,
  SemiCircleGauge,
  Sparkline,
  Stat,
  WindowedList,
} from './ui';
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

  // Default to 3D Skyline whenever WebGL is eligible, falling back gracefully when 'off' or reduced-motion
  const runtime3d = useMemo(
    () =>
      resolveRuntimeUi3d(
        state.set.ui3d || 'auto',
        false,
        state.set.ui3dQuality || 'auto'
      ),
    [state.set.ui3d, state.set.ui3dQuality]
  );
  const [heatmapViewMode, setHeatmapViewMode] = useState<'flat' | 'skyline'>(() =>
    runtime3d.enabled ? 'skyline' : 'flat'
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

  // Row-major (7 days x 12 weeks) transposition for HeatmapGrid flat fallback
  const flatHeatmapCells = useMemo(() => {
    const out: Array<{
      key: string;
      label: string;
      level: 0 | 1 | 2 | 3 | 4;
      valueLabel: string;
    }> = [];
    for (let dayRow = 0; dayRow < 7; dayRow++) {
      for (let weekCol = 0; weekCol < 12; weekCol++) {
        const idx = weekCol * 7 + dayRow;
        const c = hmCells[idx];
        if (!c) continue;
        const lvl: 0 | 1 | 2 | 3 | 4 =
          c.future || c.lvlClass === 'hm-l0'
            ? 0
            : c.lvlClass === 'hm-l1'
              ? 1
              : c.lvlClass === 'hm-l2'
                ? 2
                : c.lvlClass === 'hm-l3'
                  ? 3
                  : 4;
        out.push({
          key: c.key,
          label: c.key,
          level: lvl,
          valueLabel: c.future ? 'Upcoming date' : `${c.hrs.toFixed(1)}h studied`,
        });
      }
    }
    return out;
  }, [hmCells]);

  const peak30dMs = Math.max(0, ...summary.last30Days.map((d) => d.ms));
  const consistencyPct = Math.round((summary.monthActiveDays / 30) * 100);
  const minDailyTargetMins = Math.max(
    15,
    Number(state.set.targets?.minDayMinutes) || 360
  );

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
              illustration="noSessions"
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

          {/* Hero Slot: 3D Study City / Heatmap */}
          <Card id="studySkylineHeroCard" className="space-y-3">
            <div className="split flex-wrap gap-2">
              <div>
                <h3 className="text-[16px] font-semibold text-[var(--tx)]">
                  Study city
                </h3>
                <p className="text-[13px] text-[var(--tx-2)]">
                  Stacked subject towers across 12 weeks or 30 days · Lit floors &amp; peak ring
                </p>
              </div>
              {runtime3d.enabled && (
                <div className="w-44">
                  <Segmented<'skyline' | 'flat'>
                    value={heatmapViewMode}
                    onChange={setHeatmapViewMode}
                    ariaLabel="Study city view mode"
                    options={[
                      { value: 'skyline', label: '3D City' },
                      { value: 'flat', label: 'Flat view' },
                    ]}
                  />
                </div>
              )}
            </div>

            {heatmapViewMode === 'skyline' && runtime3d.enabled ? (
              <StudySkylineScene
                cells={hmCells}
                sessions={state.sessions}
                subjects={state.subjects}
                todayKey={todayKey}
                ui3dSetting={state.set.ui3d || 'auto'}
                ui3dQuality={state.set.ui3dQuality || 'auto'}
                onInspectDay={(dayKey) => {
                  setHistoryDateKey(dayKey);
                  onChangeSubTab('history');
                }}
              />
            ) : (
              <HeatmapGrid
                columns={12}
                cells={flatHeatmapCells}
                ariaLabel="12-week study depth heatmap"
                onSelectCell={(cell) => {
                  if (cell.valueLabel !== 'Upcoming date') {
                    setHistoryDateKey(cell.key);
                    onChangeSubTab('history');
                  }
                }}
              />
            )}
          </Card>

          {/* Hero Metric Card: 7-Day Average + Delta vs Prior 7d + Sparkline + BarChart */}
          <Card className="dh-hero-lumen space-y-4">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <span className="text-[13px] font-medium text-[var(--tx-2)]">
                  7-day daily average
                </span>
                <div className="flex flex-wrap items-baseline gap-2.5">
                  <strong className="tnum text-[32px] font-bold leading-none text-[var(--tx)]">
                    {fmtHMShort(summary.weekAvgMsPerDay)}
                  </strong>
                  <span className="text-[13px] text-[var(--tx-2)]">/ day</span>
                  {weekDeltaPct !== null && (
                    <span
                      className="tnum rounded-md px-2 py-0.5 text-[13px] font-semibold"
                      style={{
                        background: 'var(--sf-2)',
                        color:
                          weekDeltaPct >= 0 ? 'var(--ok-ink)' : 'var(--warn-ink)',
                      }}
                    >
                      {weekDeltaPct >= 0 ? `+${weekDeltaPct}%` : `${weekDeltaPct}%`} vs
                      prior 7d
                    </span>
                  )}
                </div>
                <p className="tnum text-[13px] text-[var(--tx-2)]">
                  Week total: <strong>{fmtHMShort(summary.weekTotalMs)}</strong> ·{' '}
                  {summary.weekActiveDays}/7 active days · 30d avg:{' '}
                  <strong>{fmtHMShort(summary.monthAvgMsPerDay)}/d</strong> · All-time:{' '}
                  <strong>{fmtHMShort(summary.allTimeTotalMs)}</strong>
                </p>
              </div>

              <div className="flex items-center gap-4">
                <div className="rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3.5 py-2.5">
                  <span className="mb-1 block text-[13px] text-[var(--tx-2)]">
                    Last 7 days trend
                  </span>
                  <Sparkline
                    values={summary.last7Days.map((d) =>
                      Math.round(d.ms / 60000)
                    )}
                    width={140}
                    height={36}
                    label="7-day study minutes sparkline"
                  />
                </div>
              </div>
            </div>

            <div className="border-t border-[var(--line)] pt-4">
              <BarChart
                orientation="vertical"
                height={176}
                data={summary.last7Days.map((d) => ({
                  label: d.dayName,
                  value: Math.round(d.ms / 60000),
                  hint: d.shortDate,
                  color: d.key === todayKey ? 'var(--ac)' : 'var(--ok)',
                }))}
                goalValue={minDailyTargetMins}
                goalLabel={`Goal ${fmtHMShort(minDailyTargetMins * 60000)}`}
                valueFormatter={(mins) => fmtHMShort(Math.round(mins * 60000))}
                ariaLabel="7-day daily study breakdown"
              />
            </div>
          </Card>

          {/* Tabbed "Where your time goes" Card (Subject | Mode | Chapter) */}
          <Card id="subjectBreakdownCard" className="space-y-3">
            <div className="split flex-wrap gap-2">
              <div>
                <h3 className="text-[15px] font-semibold text-[var(--tx)]">
                  Where your time goes
                </h3>
                <p className="text-[13px] text-[var(--tx-2)]">
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
              <div className="space-y-4 pt-1">
                <DonutChart
                  segments={summary.subjectBreakdown.map((item) => ({
                    label: `${item.e} ${item.name}`,
                    value: Math.round(item.ms / 60000),
                    color: item.color,
                  }))}
                  centerLabel={fmtHMShort(summary.allTimeTotalMs)}
                  centerSublabel="Total"
                  valueFormatter={(mins) => fmtHMShort(Math.round(mins * 60000))}
                  ariaLabel="Subject distribution donut chart"
                />
                <div className="space-y-2.5 border-t border-[var(--line)] pt-3">
                  {summary.subjectBreakdown.map((item) => (
                    <div key={item.subjectId}>
                      <div className="split mb-1 text-[13px]">
                        <span className="flex min-w-0 items-center gap-2 font-medium text-[var(--tx)]">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ background: item.color }}
                          />
                          <span className="truncate">
                            {item.e} {item.name}
                          </span>
                          <span className="shrink-0 text-[13px] text-[var(--tx-3)]">
                            ({item.count} {item.count === 1 ? 'session' : 'sessions'})
                          </span>
                        </span>
                        <span className="tnum shrink-0 font-medium text-[var(--tx-2)]">
                          {fmtHMShort(item.ms)} ({item.pct}%)
                        </span>
                      </div>
                      <Meter value={item.pct} max={100} color={item.color} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {whereTab === 'mode' && (
              <div className="space-y-3 pt-1">
                {summary.modeBreakdown.map((item) => (
                  <div key={item.mode}>
                    <div className="split mb-1 text-[13px]">
                      <span className="font-medium text-[var(--tx)]">
                        {item.label}{' '}
                        <span className="text-[13px] text-[var(--tx-3)]">
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
                          <span className="text-[13px] text-[var(--tx-3)]">
                            ({row.subjectName} · {row.count}s)
                          </span>
                        </span>
                        <span className="tnum shrink-0 font-medium text-[var(--tx-2)]">
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

          {/* "When you study" Card (24h Radial Clock & Peak window) */}
          <Card className="space-y-3">
            <div>
              <h3 className="text-[15px] font-semibold text-[var(--tx)]">
                When you study
              </h3>
              <p className="text-[13px] text-[var(--tx-2)]">
                24-hour concentration rhythm — tap or hover any spoke to inspect hourly focus
              </p>
            </div>

            <div className="flex flex-col items-center gap-5 sm:flex-row sm:justify-between">
              <RadialClock24h
                hourlyMinutes={summary.hourlyMs.map((ms) => Math.round(ms / 60000))}
                size={200}
                ariaLabel="24-hour study distribution radial clock"
              />

              <div className="grid w-full flex-1 grid-cols-2 gap-2.5">
                <Stat
                  label="Peak 2h window"
                  value={summary.peakHourWindowLabel}
                  sub={summary.peakPeriodLabel}
                />
                <Stat
                  label="Focus purity"
                  value={`${summary.avgPurity}%`}
                  sub="Active vs paused"
                />
                <Stat
                  label="Avg start"
                  value={summary.avgStartHourLabel}
                  sub="First session"
                />
                <Stat
                  label="Avg wrap-up"
                  value={summary.avgEndHourLabel}
                  sub="Last session"
                />
              </div>
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
                  <p className="text-[13px] text-[var(--tx-2)]">
                    Composite score and 90-day daily habit completion grid
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
                {/* SemiCircle Gauge + 4 Pillars of Consistency */}
                <div className="flex flex-col items-center gap-4 md:flex-row">
                  <div className="shrink-0">
                    <SemiCircleGauge
                      value={consistencyScore.total ?? 0}
                      max={100}
                      label={consistencyScore.displayLabel}
                      sublabel="Consistency / 100"
                      width={210}
                    />
                  </div>
                  {consistencyScore.total !== null && (
                    <div className="grid w-full flex-1 grid-cols-2 gap-2.5">
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
                </div>

                {/* 90-Day Calendar Grid */}
                <div>
                  <div className="split mb-2 text-[13px] text-[var(--tx-2)]">
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
                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3 py-2 text-[13px]">
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
              </div>
            )}
          </Card>

          {/* Deep Work Frequency (Last 30 Days) */}
          <Card id="deepWorkFrequencyCard">
            <SectionHeader
              title="Deep work frequency (last 30 days)"
              subtitle={`30d total ${fmtHMShort(summary.monthTotalMs)} · Peak day ${fmtHMShort(peak30dMs)} · ${summary.monthActiveDays}/30 active (${consistencyPct}%)`}
            />
            <div className="mt-3">
              <AreaLineChart
                height={190}
                data={summary.last30Days.map((p) => ({
                  label: p.shortDate,
                  value: Number((p.ms / 3600000).toFixed(2)),
                  hint: p.formatted,
                }))}
                goalValue={Number((minDailyTargetMins / 60).toFixed(2))}
                goalLabel={`Goal ${fmtHMShort(minDailyTargetMins * 60000)}`}
                valueFormatter={(h) => `${h.toFixed(1)}h`}
                ariaLabel="Deep Work Frequency 30-Day Area Chart"
              />
            </div>
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
                        <span className="text-[13px] text-[var(--tx-3)]">
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
                    <h4 className="text-[13px] font-semibold text-[var(--tx-2)]">
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
                            <p className="tnum text-[13px] text-[var(--tx-2)]">
                              {s.dayKey} · {fmtClockTime(s.startTs)} –{' '}
                              {fmtClockTime(s.endTs)} · {s.mode}
                            </p>
                            {s.note && (
                              <p className="mt-0.5 text-[13px] text-[var(--tx-2)]">
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
                <span className="tnum text-[13px] text-[var(--tx-2)]">
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
                    className={`rounded-lg border border-[var(--line)] bg-[var(--sf-2)] px-2.5 py-1 text-[13px] ${
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
                        <span className="tnum text-[13px] text-[var(--tx-2)]">
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
