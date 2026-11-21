import React, { useMemo, useState } from 'react';
import {
  Award,
  Calendar,
  ChevronDown,
  ChevronRight,
  Flame,
  Plus,
  Share2,
  Sparkles,
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
import {
  buildWeeklyProofPayload,
  computeWeeklyWrapped,
} from '../utils/weeklyWrapped';
import type { ProofCardPayload } from '../utils/proofCardCanvas';
import { triggerHaptic } from '../utils/haptics';
import { PlannerView } from './PlannerView';
import { ReviewView } from './ReviewView';
import { DayHistoryView } from './DayHistoryView';
import { WeeklyWrappedSheet } from './WeeklyWrappedSheet';
import {
  AreaLineChart,
  BarChart,
  Button,
  Card,
  HeatmapGrid,
  Meter,
  RadialClock24h,
  Segmented,
  SemiCircleGauge,
  Sparkline,
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
  onShareTodayProof?: () => void;
  onShareWeeklyProof?: (payload: ProofCardPayload) => void;
  onFocusSubject?: (subjectId: string) => void;
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
  onShareTodayProof,
  onShareWeeklyProof,
  onFocusSubject,
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
  const weeklyWrapped = useMemo(
    () => computeWeeklyWrapped(state, todayKey),
    [state, todayKey]
  );

  const [wrappedOpen, setWrappedOpen] = useState<boolean>(false);
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
        <div className="dh-amoled-flow">
          {/* Sleek Hairline Sunday Night Study Wrapped Trigger Row */}
          <button
            type="button"
            data-testid="weekly-wrapped-trigger"
            className={`dh-wrapped-trigger ${weeklyWrapped.highlightCard ? 'is-highlighted' : ''}`}
            onClick={() => {
              triggerHaptic('tap');
              setWrappedOpen(true);
            }}
          >
            <div className="dh-wrapped-trigger-icon" aria-hidden="true">
              <Sparkles size={18} strokeWidth={1.9} />
            </div>
            <div className="dh-wrapped-trigger-copy">
              <div className="dh-wrapped-trigger-title-row">
                <span className="dh-wrapped-trigger-title">Weekly Wrapped</span>
                <span className="dh-wrapped-trigger-badge tnum">
                  {weeklyWrapped.isSunday ? 'Sunday recap' : '4 slides'}
                </span>
              </div>
              <p className="dh-wrapped-trigger-sub tnum">
                {weeklyWrapped.hasSessionsThisWeek
                  ? `${fmtHMShort(weeklyWrapped.totalMs)} · ${weeklyWrapped.deltaLabel} · ${weeklyWrapped.dateRangeLabel}`
                  : `7-day deep study recap · ${weeklyWrapped.dateRangeLabel}`}
              </p>
            </div>
            <ChevronRight
              size={18}
              strokeWidth={1.85}
              className="dh-wrapped-trigger-chevron"
              aria-hidden="true"
            />
          </button>

          {/* Compact Inline Empty Notice when 0 sessions */}
          {state.sessions.length === 0 && (
            <div className="dh-empty-inline">
              <span>
                No study sessions logged yet — start a Focus session or log hours to populate trends.
              </span>
              <button
                type="button"
                className="dh-eyebrow-link"
                onClick={() => onOpenManualSession()}
              >
                <Plus size={14} strokeWidth={1.8} aria-hidden="true" />
                <span>Log session</span>
              </button>
            </div>
          )}

          {/* Hero Metric: 7-Day Average + Delta + Sparkline + Rounded 7-Day BarChart */}
          <Card className="dh-hero-tier1 space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <span className="dh-eyebrow block">7-day daily average</span>
                <div className="flex flex-wrap items-baseline gap-2.5">
                  <strong className="dh-display-metric text-[32px] font-bold leading-none">
                    {fmtHMShort(summary.weekAvgMsPerDay)}
                  </strong>
                  <span className="text-[13px] text-[var(--tx-3)]">/ day</span>
                  {weekDeltaPct !== null && (
                    <span
                      className="tnum text-[13px] font-semibold"
                      style={{
                        color:
                          weekDeltaPct >= 0 ? 'var(--ok-ink)' : 'var(--warn-ink)',
                      }}
                    >
                      {weekDeltaPct >= 0 ? `+${weekDeltaPct}%` : `${weekDeltaPct}%`} vs
                      prior 7d
                    </span>
                  )}
                </div>
                <p className="tnum text-[12.5px] text-[var(--tx-2)]">
                  Week <strong className="text-[var(--tx)]">{fmtHMShort(summary.weekTotalMs)}</strong> ·{' '}
                  {summary.weekActiveDays}/7 active · 30d avg{' '}
                  <strong className="text-[var(--tx)]">{fmtHMShort(summary.monthAvgMsPerDay)}/d</strong> · All-time{' '}
                  <strong className="text-[var(--tx)]">{fmtHMShort(summary.allTimeTotalMs)}</strong>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex flex-col items-start gap-1">
                  <span className="dh-eyebrow">7d trend</span>
                  <Sparkline
                    values={summary.last7Days.map((d) =>
                      Math.round(d.ms / 60000)
                    )}
                    width={126}
                    height={32}
                    label="7-day study minutes sparkline"
                  />
                </div>
                {onShareTodayProof && (
                  <button
                    type="button"
                    className="dh-ghost-pill"
                    onClick={onShareTodayProof}
                  >
                    <Share2 size={13} strokeWidth={1.9} aria-hidden="true" />
                    <span>Share proof</span>
                  </button>
                )}
              </div>
            </div>

            <div className="border-t border-[var(--hairline)] pt-4">
              <BarChart
                orientation="vertical"
                height={176}
                axisUnit="minutes"
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

          {/* Study City / 12-Week Heatmap — Borderless AMOLED Section */}
          <section id="studySkylineHeroCard" className="dh-amoled-section">
            <div className="dh-eyebrow-row flex-wrap">
              <div>
                <h3 className="dh-eyebrow">Study city</h3>
                <p className="mt-0.5 text-[12.5px] text-[var(--tx-3)]">
                  Stacked subject towers across 12 weeks or 30 days
                </p>
              </div>
              {runtime3d.enabled && (
                <div className="w-40">
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
          </section>

          {/* "Where your time goes" — Borderless AMOLED Section (Single Horizontal Stacked Bar + Hairline Rows) */}
          <section id="subjectBreakdownCard" className="dh-amoled-section">
            <div className="dh-eyebrow-row flex-wrap">
              <h3 className="dh-eyebrow">Where your time goes</h3>
              <div className="w-full sm:w-56">
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
              <div className="space-y-3">
                {/* Single Clean Horizontal Stacked Breakdown Bar */}
                {(() => {
                  const activeSegs = summary.subjectBreakdown.filter((s) => s.ms > 0);
                  return (
                    <div className="space-y-1.5">
                      <div className="split text-[12.5px] text-[var(--tx-3)]">
                        <span>All-time subject split</span>
                        <strong className="tnum text-[var(--tx)]">
                          {fmtHMShort(summary.allTimeTotalMs)}
                        </strong>
                      </div>
                      <div
                        className="flex h-2.5 w-full overflow-hidden rounded-full"
                        style={{ background: 'var(--ring-track, #12151C)', gap: 2 }}
                        role="img"
                        aria-label="Horizontal stacked subject breakdown bar"
                        data-testid="subject-stacked-bar"
                      >
                        {activeSegs.length > 0 ? (
                          activeSegs.map((item) => (
                            <div
                              key={item.subjectId}
                              title={`${item.name}: ${fmtHMShort(item.ms)} (${item.pct}%)`}
                              style={{
                                width: `${Math.max(2, item.pct)}%`,
                                background: item.color,
                                height: '100%',
                              }}
                            />
                          ))
                        ) : (
                          <div style={{ width: '100%', height: '100%' }} />
                        )}
                      </div>
                    </div>
                  );
                })()}

                <div className="dh-hairline-list">
                  {summary.subjectBreakdown.map((item) => (
                    <div key={item.subjectId} className="dh-hairline-row">
                      <span className="flex min-w-0 items-center gap-2.5 text-[14px] font-medium text-[var(--tx)]">
                        <span
                          className="dh-sub-dot"
                          style={{ background: item.color }}
                          aria-hidden="true"
                        />
                        <span className="truncate">{item.name}</span>
                        <span className="shrink-0 text-[12.5px] text-[var(--tx-3)]">
                          {item.count} {item.count === 1 ? 'session' : 'sessions'}
                        </span>
                      </span>
                      <span className="tnum shrink-0 text-[13.5px] font-medium text-[var(--tx-2)]">
                        <strong className="text-[var(--tx)]">{fmtHMShort(item.ms)}</strong>{' '}
                        <span className="text-[var(--tx-3)]">{item.pct}%</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {whereTab === 'mode' && (
              <div className="dh-hairline-list">
                {summary.modeBreakdown.map((item) => (
                  <div
                    key={item.mode}
                    style={{
                      padding: '11px 0',
                      borderBottom: '1px solid var(--hairline)',
                    }}
                  >
                    <div className="split mb-1.5 text-[13.5px]">
                      <span className="font-medium text-[var(--tx)]">
                        {item.label}{' '}
                        <span className="text-[12.5px] text-[var(--tx-3)]">
                          · {item.count} {item.count === 1 ? 'session' : 'sessions'}
                        </span>
                      </span>
                      <span className="tnum text-[13px] font-medium text-[var(--tx-2)]">
                        {fmtHMShort(item.ms)} ({item.pct}%)
                      </span>
                    </div>
                    <Meter value={item.pct} max={100} color="var(--ac)" height={5} />
                  </div>
                ))}
              </div>
            )}

            {whereTab === 'chapter' && (
              <div>
                {chapterBreakdown.length === 0 ? (
                  <div className="dh-empty-inline">
                    <span>
                      Link a syllabus chapter when starting a Focus timer or logging hours to track chapter time.
                    </span>
                  </div>
                ) : (
                  <div className="dh-hairline-list">
                    {chapterBreakdown.slice(0, 15).map((row) => (
                      <div
                        key={row.chapterId}
                        style={{
                          padding: '11px 0',
                          borderBottom: '1px solid var(--hairline)',
                        }}
                      >
                        <div className="split mb-1.5 text-[13.5px]">
                          <span className="flex min-w-0 items-center gap-2 font-medium text-[var(--tx)]">
                            <span
                              className="dh-sub-dot"
                              style={{ background: row.color }}
                              aria-hidden="true"
                            />
                            <span className="truncate">{row.chapterName}</span>
                            <span className="shrink-0 text-[12.5px] text-[var(--tx-3)]">
                              {row.subjectName} · {row.count}s
                            </span>
                          </span>
                          <span className="tnum shrink-0 text-[13px] font-medium text-[var(--tx-2)]">
                            {fmtHMShort(row.ms)} ({row.pct}%)
                          </span>
                        </div>
                        <Meter value={row.pct} max={100} color={row.color} height={5} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* "When you study" — Borderless AMOLED Section + Hairline 2x2 Ledger */}
          <section className="dh-amoled-section">
            <div>
              <h3 className="dh-eyebrow">When you study</h3>
              <p className="mt-0.5 text-[12.5px] text-[var(--tx-3)]">
                24-hour concentration rhythm — tap or hover any spoke
              </p>
            </div>

            <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:justify-between">
              <RadialClock24h
                hourlyMinutes={summary.hourlyMs.map((ms) => Math.round(ms / 60000))}
                size={196}
                ariaLabel="24-hour study distribution radial clock"
              />

              <div className="dh-ledger-2x2 w-full flex-1">
                <div className="dh-ledger-cell">
                  <span className="dh-ledger-label">Peak 2h window</span>
                  <span className="dh-ledger-val tnum" style={{ fontSize: 18 }}>
                    {summary.peakHourWindowLabel}
                  </span>
                  <span className="dh-ledger-sub">{summary.peakPeriodLabel}</span>
                </div>
                <div className="dh-ledger-cell">
                  <span className="dh-ledger-label">Focus purity</span>
                  <span className="dh-ledger-val tnum">{summary.avgPurity}%</span>
                  <span className="dh-ledger-sub">Active vs paused</span>
                </div>
                <div className="dh-ledger-cell">
                  <span className="dh-ledger-label">Avg start</span>
                  <span className="dh-ledger-val tnum">{summary.avgStartHourLabel}</span>
                  <span className="dh-ledger-sub">First session</span>
                </div>
                <div className="dh-ledger-cell">
                  <span className="dh-ledger-label">Avg wrap-up</span>
                  <span className="dh-ledger-val tnum">{summary.avgEndHourLabel}</span>
                  <span className="dh-ledger-sub">Last session</span>
                </div>
              </div>
            </div>
          </section>

          {/* Collapsible "Consistency" — Borderless Hairline Section */}
          <section id="consistencyCalendarCard" className="dh-amoled-section">
            <button
              type="button"
              onClick={() => setShowConsistencyDetails((v) => !v)}
              aria-expanded={showConsistencyDetails}
              className="dh-sub-group-toggle"
              style={{ borderTop: '1px solid var(--hairline)' }}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {showConsistencyDetails ? (
                  <ChevronDown size={16} className="shrink-0 text-[var(--tx-3)]" />
                ) : (
                  <ChevronRight size={16} className="shrink-0 text-[var(--tx-3)]" />
                )}
                <div className="min-w-0">
                  <div className="dh-eyebrow" style={{ color: 'var(--tx)' }}>
                    Consistency &amp; 90-day habit calendar
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-[var(--tx-3)]">
                    Composite score and 90-day daily habit completion grid
                  </div>
                </div>
              </div>

              <span className="tnum shrink-0 text-[13.5px] font-semibold text-[var(--ac-ink)]">
                {consistencyScore.displayLabel}
                {consistencyScore.total !== null ? '/100' : ''}
              </span>
            </button>

            {showConsistencyDetails && (
              <div className="space-y-5 pt-2">
                {/* SemiCircle Gauge + 4 Pillars of Consistency */}
                <div className="flex flex-col items-center gap-4 md:flex-row">
                  <div className="shrink-0">
                    <SemiCircleGauge
                      value={consistencyScore.total ?? 0}
                      max={100}
                      label={consistencyScore.displayLabel}
                      sublabel="Consistency / 100"
                      width={204}
                    />
                  </div>
                  {consistencyScore.total !== null && (
                    <div className="dh-ledger-2x2 w-full flex-1">
                      <div className="dh-ledger-cell">
                        <span className="dh-ledger-label">Min days (40%)</span>
                        <span className="dh-ledger-val tnum">
                          {consistencyScore.minDayScore100}/100
                        </span>
                        <span className="dh-ledger-sub">
                          {consistencyScore.minDaysMetCount}/14 days met
                        </span>
                      </div>
                      <div className="dh-ledger-cell">
                        <span className="dh-ledger-label">Start regularity (20%)</span>
                        <span className="dh-ledger-val tnum">
                          {consistencyScore.startRegularityScore100 !== null
                            ? `${consistencyScore.startRegularityScore100}/100`
                            : '—'}
                        </span>
                        <span className="dh-ledger-sub">
                          {consistencyScore.startStdDevMins !== null
                            ? `±${consistencyScore.startStdDevMins}m std dev`
                            : 'Need 2+ days'}
                        </span>
                      </div>
                      <div className="dh-ledger-cell">
                        <span className="dh-ledger-label">On-time revs (20%)</span>
                        <span className="dh-ledger-val tnum">
                          {consistencyScore.revisionOnTimeScore100 !== null
                            ? `${consistencyScore.revisionOnTimeScore100}/100`
                            : '—'}
                        </span>
                        <span className="dh-ledger-sub">
                          {consistencyScore.revisionsOnTimeCount}/
                          {consistencyScore.revisionsTotalCount} on time
                        </span>
                      </div>
                      <div className="dh-ledger-cell">
                        <span className="dh-ledger-label">Focus purity (20%)</span>
                        <span className="dh-ledger-val tnum">
                          {consistencyScore.purityScore100 !== null
                            ? `${consistencyScore.purityScore100}/100`
                            : '—'}
                        </span>
                        <span className="dh-ledger-sub">Active vs paused</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* 90-Day Calendar Grid */}
                <div>
                  <div className="split mb-2 text-[12.5px] text-[var(--tx-2)]">
                    <span>
                      90-day habits · Perfect{' '}
                      <strong className="tnum text-[var(--tx)]">
                        {consistencyCal.perfectDays}
                      </strong>{' '}
                      · Active <strong className="tnum text-[var(--tx)]">{consistencyCal.activeDays}/90</strong>
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
                    <div className="dh-hairline-row mt-2 text-[13px]" style={{ borderTop: '1px solid var(--hairline)' }}>
                      <span>
                        <strong className="text-[var(--tx)]">
                          {selectedCalDay.dayName}, {selectedCalDay.shortDate}
                        </strong>{' '}
                        <span className="tnum text-[var(--tx-2)]">
                          · Habits {selectedCalDay.doneCount}/{selectedCalDay.dueCount} ({selectedCalDay.pct}%) · Study{' '}
                          {fmtHMShort(selectedCalDay.studyMs)}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="dh-ghost-pill"
                        onClick={() => {
                          setHistoryDateKey(selectedCalDay.key);
                          onChangeSubTab('history');
                        }}
                      >
                        <Calendar size={13} aria-hidden="true" />
                        <span>Open day</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* Deep Work Frequency (Last 30 Days) — Borderless AMOLED Section */}
          <section id="deepWorkFrequencyCard" className="dh-amoled-section">
            <div>
              <h3 className="dh-eyebrow">Deep work frequency (last 30 days)</h3>
              <p className="tnum mt-0.5 text-[12.5px] text-[var(--tx-3)]">
                30d total {fmtHMShort(summary.monthTotalMs)} · Peak {fmtHMShort(peak30dMs)} · {summary.monthActiveDays}/30 active ({consistencyPct}%)
              </p>
            </div>
            <AreaLineChart
              height={190}
              axisUnit="hours"
              data={summary.last30Days.map((p) => ({
                label: p.shortDate,
                value: Number((p.ms / 3600000).toFixed(2)),
                hint: p.formatted,
              }))}
              goalValue={Number((minDailyTargetMins / 60).toFixed(2))}
              goalLabel={`Goal ${fmtHMShort(minDailyTargetMins * 60000)}`}
              valueFormatter={(h) =>
                Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`
              }
              ariaLabel="Deep Work Frequency 30-Day Area Chart"
            />
          </section>

          {/* Session Headings & Study Log — Borderless AMOLED Section */}
          <section className="dh-amoled-section">
            <div className="dh-eyebrow-row">
              <h3 className="dh-eyebrow">Session headings &amp; study log</h3>
              <span className="tnum text-[12.5px] text-[var(--tx-3)]">
                {summary.headingBreakdown.length} topics
              </span>
            </div>

            {summary.headingBreakdown.length > 0 ? (
              <div className="dh-hairline-list">
                {summary.headingBreakdown.slice(0, 10).map((item) => (
                  <div
                    key={item.heading}
                    style={{
                      padding: '10px 0',
                      borderBottom: '1px solid var(--hairline)',
                    }}
                  >
                    <div className="split mb-1.5 text-[13.5px]">
                      <span className="flex min-w-0 items-center gap-2 font-medium text-[var(--tx)]">
                        <span
                          className="dh-sub-dot"
                          style={{ background: item.color }}
                          aria-hidden="true"
                        />
                        <span className="truncate">{item.heading}</span>
                        <span className="shrink-0 text-[12.5px] text-[var(--tx-3)]">
                          ({item.count}s)
                        </span>
                      </span>
                      <span className="tnum shrink-0 font-medium text-[var(--ok-ink)]">
                        {fmtHMShort(item.ms)}
                      </span>
                    </div>
                    <Meter value={item.pct} max={100} color={item.color} height={4} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="dh-empty-inline">
                <span>No study sessions logged yet.</span>
              </div>
            )}

            {state.sessions.length > 0 && (() => {
              const sortedSessions = state.sessions
                .slice()
                .sort((a, b) => b.startTs - a.startTs);
              const displayedSessions = showAllSessionsLog
                ? sortedSessions
                : sortedSessions.slice(0, 6);
              return (
                <div className="pt-2">
                  <div className="dh-eyebrow-row mb-1">
                    <h4 className="dh-eyebrow">
                      Recent sessions ({sortedSessions.length})
                    </h4>
                    {sortedSessions.length > 6 && (
                      <button
                        type="button"
                        className="dh-eyebrow-link"
                        onClick={() => setShowAllSessionsLog((v) => !v)}
                      >
                        {showAllSessionsLog
                          ? 'Show recent 6'
                          : `View all ${sortedSessions.length}`}
                      </button>
                    )}
                  </div>
                  <WindowedList
                    items={displayedSessions}
                    threshold={100}
                    estimatedRowHeight={72}
                    itemLabel="sessions"
                    className="dh-hairline-list"
                    getKey={(s) => s.id}
                    renderItem={(s) => {
                      const sub = getSubject(state, s.subjectId);
                      const heading = getSessionHeading(state, s);
                      return (
                        <div className="dh-hairline-row">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 text-[14px] font-medium text-[var(--tx)]">
                              <span
                                className="dh-sub-dot"
                                style={{ background: sub.color }}
                                aria-hidden="true"
                              />
                              <span className="truncate">
                                {sub.name} · {heading}
                              </span>
                            </div>
                            <p className="tnum mt-0.5 pl-3.5 text-[12.5px] text-[var(--tx-3)]">
                              {s.dayKey} · {fmtClockTime(s.startTs)} –{' '}
                              {fmtClockTime(s.endTs)} · {s.mode}
                            </p>
                            {s.note && (
                              <p className="mt-0.5 pl-3.5 text-[12.5px] text-[var(--tx-2)]">
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
          </section>

          {/* Level, Badges & Habit Streaks — Borderless AMOLED Sections */}
          <div className="grid grid-cols-1 gap-7 lg:grid-cols-2">
            <section className="dh-amoled-section">
              <div className="dh-eyebrow-row">
                <div className="flex items-center gap-2">
                  <Award size={15} className="text-[var(--ac-ink)]" aria-hidden="true" />
                  <h3 className="dh-eyebrow">
                    Level {level} · {totalXp.toLocaleString()} XP
                  </h3>
                </div>
                <span className="tnum text-[12.5px] text-[var(--tx-3)]">
                  {nx - totalXp} XP to Lv {level + 1}
                </span>
              </div>
              <Meter
                value={Math.round(((totalXp - pv) / Math.max(1, nx - pv)) * 100)}
                max={100}
                height={5}
              />
              <div className="flex flex-wrap gap-1.5 pt-1">
                {badges(state, todayKey).map(([n, unlocked]) => (
                  <span
                    key={n}
                    className={`rounded-md border px-2 py-0.5 text-[12.5px] ${
                      unlocked
                        ? 'border-[var(--line)] bg-[var(--sf-1)] font-medium text-[var(--tx)]'
                        : 'border-transparent text-[var(--tx-3)] opacity-45'
                    }`}
                  >
                    {n}
                  </span>
                ))}
              </div>
            </section>

            <section className="dh-amoled-section">
              <div className="dh-eyebrow-row">
                <div className="flex items-center gap-2">
                  <Flame size={15} className="text-[var(--ac-ink)]" aria-hidden="true" />
                  <h3 className="dh-eyebrow">Habit streaks</h3>
                </div>
              </div>
              {liveHabits.length === 0 ? (
                <div className="dh-empty-inline">
                  <span>No habits active yet.</span>
                </div>
              ) : (
                <div className="dh-hairline-list">
                  {liveHabits.map((h) => {
                    const s = streak(state, h, todayKey);
                    return (
                      <div key={h.id} className="dh-hairline-row text-[13.5px]">
                        <span className="truncate font-medium text-[var(--tx)]">
                          {h.name}
                        </span>
                        <span className="tnum shrink-0 text-[12.5px] text-[var(--tx-2)]">
                          {s.cur}d · Best {s.best}d · 7d {rate(state, h, 7, todayKey)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          <WeeklyWrappedSheet
            open={wrappedOpen}
            onClose={() => setWrappedOpen(false)}
            report={weeklyWrapped}
            onFocusSubject={(subjectId) => {
              setWrappedOpen(false);
              onFocusSubject?.(subjectId);
            }}
            onShareWeeklyProof={() => {
              setWrappedOpen(false);
              const payload = buildWeeklyProofPayload(weeklyWrapped, state);
              if (onShareWeeklyProof) {
                onShareWeeklyProof(payload);
              } else {
                onShareTodayProof?.();
              }
            }}
          />
        </div>
      )}
    </div>
  );
};
