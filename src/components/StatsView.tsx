import React, { useMemo, useState } from 'react';
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
  lvl,
  pad,
  rate,
  streak,
  total,
  wkS,
  xp,
} from '../utils/studyLogic';
import { computeConsistencyScore } from '../utils/insights';
import { PlannerView } from './PlannerView';
import { ReviewView } from './ReviewView';

interface StatsViewProps {
  state: PulseHabitState;
  sel: string;
  todayKey: string;
  subTab: StatsSubTab;
  onChangeSubTab: (sub: StatsSubTab) => void;
  onOpenManualSession: (defaultSubjectId?: string) => void;
  onEditSession?: (sessionId: string) => void;
  onToast?: (msg: string) => void;
}

export const StatsView: React.FC<StatsViewProps> = ({
  state,
  sel,
  todayKey,
  subTab,
  onChangeSubTab,
  onOpenManualSession,
  onEditSession,
  onToast,
}) => {
  const summary = computeStudySummary(state, todayKey);
  const consistencyCal = computeConsistencyCalendar(state, todayKey, 90);
  const consistencyScore = useMemo(
    () => computeConsistencyScore(state, todayKey),
    [state, todayKey]
  );
  const chapterBreakdown = useMemo(() => computeChapterBreakdown(state), [state]);
  const [selectedCalDayKey, setSelectedCalDayKey] = useState<string | null>(todayKey);
  const selectedCalDay: ConsistencyDay | null =
    (selectedCalDayKey
      ? consistencyCal.days.find((d) => d.key === selectedCalDayKey)
      : null) ||
    consistencyCal.days[consistencyCal.days.length - 1] ||
    null;

  // 12-Week Study Depth Heatmap (84 days: 0h, <2h, 2-4h, 4-6h, 6-8h, 8h+)
  const s0 = wkS(state, addD(todayKey, -77));
  const hmCells: Array<{ key: string; future: boolean; hrs: number; lvlClass: string }> = [];
  for (let i = 0; i < 84; i++) {
    const k = addD(s0, i);
    if (k > todayKey) {
      hmCells.push({ key: k, future: true, hrs: 0, lvlClass: 'hm-l0' });
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
    hmCells.push({ key: k, future: false, hrs, lvlClass });
  }

  const maxWeekDayMs = Math.max(3600000, ...summary.last7Days.map((d) => d.ms));
  const maxHrMs = Math.max(1800000, ...summary.hourlyMs);
  const peak30dMs = Math.max(0, ...summary.last30Days.map((d) => d.ms));
  const avg30dHours = Number((summary.monthAvgMsPerDay / 3600000).toFixed(2));
  const consistencyPct = Math.round((summary.monthActiveDays / 30) * 100);

  const totalXp = xp(state, todayKey);
  const level = lvl(totalXp);
  const nx = Math.pow(level, 2) * 60;
  const pv = Math.pow(level - 1, 2) * 60;
  const liveHabits = live(state);

  return (
    <div>
      {/* Segmented Switch: Summary | 10m Timeline | Weekly Review (1.13) */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ marginBottom: '8px' }}>
          <h2>Study Summary &amp; Timeline</h2>
          <small>
            Weekly/monthly averages, time per subject &amp; chapter, consistency &amp; weekly review
          </small>
        </div>
        <div
          style={{
            display: 'flex',
            overflowX: 'auto',
            background: 'var(--c2)',
            padding: '4px',
            borderRadius: '14px',
            gap: '4px',
          }}
        >
          <button
            type="button"
            className={subTab === 'summary' ? 'on' : ''}
            style={{
              padding: '6px 12px',
              fontSize: '12.5px',
              borderRadius: '10px',
              whiteSpace: 'nowrap',
              flex: '1 0 auto',
            }}
            onClick={() => onChangeSubTab('summary')}
          >
            📊 Summary
          </button>
          <button
            type="button"
            className={subTab === 'timeline' ? 'on' : ''}
            style={{
              padding: '6px 12px',
              fontSize: '12.5px',
              borderRadius: '10px',
              whiteSpace: 'nowrap',
              flex: '1 0 auto',
            }}
            onClick={() => onChangeSubTab('timeline')}
          >
            🗓️ 10m Timeline
          </button>
          <button
            type="button"
            className={subTab === 'review' ? 'on' : ''}
            style={{
              padding: '6px 12px',
              fontSize: '12.5px',
              borderRadius: '10px',
              whiteSpace: 'nowrap',
              flex: '1 0 auto',
            }}
            onClick={() => onChangeSubTab('review')}
          >
            📋 Weekly Review
          </button>
        </div>
      </div>

      {subTab === 'timeline' ? (
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
        <div>
          {/* Primary Weekly / Monthly Executive Summary Grid */}
          <div
            className="stat-mini"
            style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', marginBottom: '10px' }}
          >
            <div className="card" style={{ margin: 0, padding: '14px' }}>
              <small style={{ textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>
                📅 This Week Average (7d)
              </small>
              <b
                className="mono"
                style={{
                  display: 'block',
                  fontSize: '22px',
                  color: 'var(--em)',
                  marginTop: '4px',
                }}
              >
                {fmtHMShort(summary.weekAvgMsPerDay)}{' '}
                <span style={{ fontSize: '12px', color: 'var(--mu)', fontWeight: 600 }}>
                  / day
                </span>
              </b>
              <small style={{ display: 'block', marginTop: '4px' }}>
                Total: <b className="mono">{fmtHMShort(summary.weekTotalMs)}</b> ·{' '}
                {summary.weekActiveDays}/7 active days
              </small>
              <small style={{ display: 'block', marginTop: '2px' }}>
                Active-day avg: <b className="mono">{fmtHMShort(summary.weekAvgActiveDayMs)}</b>
              </small>
            </div>

            <div className="card" style={{ margin: 0, padding: '14px' }}>
              <small style={{ textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>
                🗓️ This Month Average (30d)
              </small>
              <b
                className="mono"
                style={{
                  display: 'block',
                  fontSize: '22px',
                  color: 'var(--ac)',
                  marginTop: '4px',
                }}
              >
                {fmtHMShort(summary.monthAvgMsPerDay)}{' '}
                <span style={{ fontSize: '12px', color: 'var(--mu)', fontWeight: 600 }}>
                  / day
                </span>
              </b>
              <small style={{ display: 'block', marginTop: '4px' }}>
                Total: <b className="mono">{fmtHMShort(summary.monthTotalMs)}</b> ·{' '}
                {summary.monthActiveDays}/30 active days
              </small>
              <small style={{ display: 'block', marginTop: '2px' }}>
                All-time: <b className="mono">{fmtHMShort(summary.allTimeTotalMs)}</b> (
                {summary.totalSessionsCount} sessions · Avg{' '}
                <b className="mono">{fmtHMShort(summary.avgSessionMs)}</b>)
              </small>
            </div>
          </div>

          {/* Most Active Study Hours Banner Card */}
          <div
            className="card"
            style={{
              borderLeft: '4px solid var(--em)',
              background: 'linear-gradient(135deg, var(--c1) 0%, var(--c2) 100%)',
            }}
          >
            <div className="row sp" style={{ alignItems: 'flex-start' }}>
              <div>
                <small
                  style={{
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    fontWeight: 700,
                    color: 'var(--em)',
                  }}
                >
                  ⚡ Most Active 2-Hour Window · {summary.peakPeriodLabel}
                </small>
                <b
                  className="mono"
                  style={{ display: 'block', fontSize: '22px', marginTop: '4px' }}
                >
                  {summary.peakHourWindowLabel}
                </b>
                <small style={{ display: 'block', marginTop: '4px' }}>
                  Peak 2-hour concentration block starting at{' '}
                  <b>{pad(summary.peakHourIndex)}:00</b>.
                </small>
              </div>
              <div style={{ textAlign: 'right' }}>
                <small style={{ display: 'block' }}>
                  Avg Start: <b className="mono">{summary.avgStartHourLabel}</b>
                </small>
                <small style={{ display: 'block', marginTop: '3px' }}>
                  Avg Wrap-up: <b className="mono">{summary.avgEndHourLabel}</b>
                </small>
                <small style={{ display: 'block', marginTop: '3px' }}>
                  Avg Purity: <b className="mono">{summary.avgPurity}%</b>
                </small>
              </div>
            </div>
          </div>

          {/* Time Per Subject Breakdown (A10) */}
          <div className="card" id="subjectBreakdownCard">
            <div className="row sp" style={{ marginBottom: '10px' }}>
              <div>
                <h3>Time per Subject</h3>
                <small>Total study duration across your NEET subjects &amp; legacy logs</small>
              </div>
              <span className="pill mono">{fmtHMShort(summary.allTimeTotalMs)}</span>
            </div>
            {summary.subjectBreakdown.map((item) => (
              <div key={item.subjectId} style={{ marginBottom: '10px' }}>
                <div className="row sp" style={{ marginBottom: '4px' }}>
                  <span style={{ fontSize: '13.5px', fontWeight: 700 }}>
                    <i
                      className="dot"
                      style={
                        {
                          '--sc': item.color,
                          marginRight: '6px',
                        } as React.CSSProperties
                      }
                    />
                    {item.e} {item.name}{' '}
                    <small style={{ fontWeight: 500 }}>
                      ({item.count} {item.count === 1 ? 'session' : 'sessions'})
                    </small>
                  </span>
                  <span className="mono" style={{ fontSize: '12.5px', fontWeight: 700 }}>
                    {fmtHMShort(item.ms)} ({item.pct}%)
                  </span>
                </div>
                <div
                  style={{
                    height: '7px',
                    background: 'var(--c2)',
                    borderRadius: '99px',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${item.ms > 0 ? Math.max(4, item.pct) : 0}%`,
                      background: item.color,
                      borderRadius: '99px',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Deep Work Frequency (Last 30 Days) Plain SVG Line Chart */}
          <div className="card" id="deepWorkFrequencyCard">
            <div className="row sp" style={{ marginBottom: '8px', alignItems: 'flex-start' }}>
              <div>
                <h3>📈 Deep Work Frequency (Last 30 Days)</h3>
                <small>
                  Daily study hours &amp; minutes over the last 30 days to visualize consistency
                </small>
              </div>
              <span className="pill mono" style={{ fontSize: '11.5px', color: 'var(--em)' }}>
                {summary.monthActiveDays}/30 Active ({consistencyPct}%)
              </span>
            </div>

            <div
              className="chips wrap"
              style={{ marginBottom: '10px', gap: '8px', paddingBottom: 0 }}
            >
              <span className="pill" style={{ fontSize: '11.5px' }}>
                30d Total: <b className="mono">{fmtHMShort(summary.monthTotalMs)}</b>
              </span>
              <span className="pill" style={{ fontSize: '11.5px' }}>
                Daily Avg: <b className="mono">{fmtHMShort(summary.monthAvgMsPerDay)}</b>
              </span>
              <span className="pill" style={{ fontSize: '11.5px' }}>
                Peak Day: <b className="mono">{fmtHMShort(peak30dMs)}</b>
              </span>
            </div>

            {(() => {
              const pts = summary.last30Days;
              const W = 580;
              const H = 190;
              const padL = 42;
              const padR = 14;
              const padT = 14;
              const padB = 28;
              const plotW = W - padL - padR;
              const plotH = H - padT - padB;
              const maxHrs = Math.max(2, Math.ceil(Math.max(...pts.map((p) => p.hours)) + 0.5));
              const toX = (i: number) =>
                pts.length <= 1 ? padL + plotW / 2 : padL + (i / (pts.length - 1)) * plotW;
              const toY = (hrs: number) => padT + plotH - (hrs / maxHrs) * plotH;
              const polyPoints = pts
                .map((p, i) => `${toX(i).toFixed(1)},${toY(p.hours).toFixed(1)}`)
                .join(' ');
              const avgY = avg30dHours > 0 ? toY(avg30dHours) : null;

              return (
                <svg
                  id="deepWorkFrequencyChart"
                  viewBox={`0 0 ${W} ${H}`}
                  style={{ width: '100%', height: '190px', display: 'block' }}
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
                          stroke="rgba(148,163,184,0.15)"
                          strokeDasharray="3 3"
                        />
                        <text
                          x={padL - 6}
                          y={y + 4}
                          textAnchor="end"
                          fill="#94a3b8"
                          fontSize="10"
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
                      stroke="#6366f1"
                      strokeDasharray="4 4"
                      strokeOpacity="0.8"
                    />
                  )}

                  <polyline
                    fill="none"
                    stroke="#10b981"
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
                          fill={p.ms > 0 ? '#10b981' : '#475569'}
                        >
                          <title>{`${p.dayName}, ${p.shortDate} (${p.key}): ${p.formatted} (${p.minutes}m)`}</title>
                        </circle>
                        {i % 5 === 0 && (
                          <text
                            x={cx}
                            y={H - 8}
                            textAnchor="middle"
                            fill="#94a3b8"
                            fontSize="9.5"
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
          </div>

          {/* Graph 1: Last 7 Days Study Duration Bar Chart */}
          <div className="card">
            <div className="row sp" style={{ marginBottom: '12px' }}>
              <div>
                <h3>Weekly Study Hours Graph (Last 7 Days)</h3>
                <small>Daily study duration logged across timers &amp; manual entries</small>
              </div>
              <span className="pill mono" style={{ fontSize: '12px' }}>
                {fmtHMShort(summary.weekTotalMs)} total
              </span>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, 1fr)',
                gap: '8px',
                alignItems: 'end',
                height: '138px',
                paddingTop: '18px',
              }}
            >
              {summary.last7Days.map((d) => {
                const barPct =
                  d.ms > 0 ? Math.max(10, Math.round((d.ms / maxWeekDayMs) * 100)) : 4;
                const isToday = d.key === todayKey;
                return (
                  <div
                    key={d.key}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      height: '100%',
                      justifyContent: 'flex-end',
                      gap: '5px',
                    }}
                    title={`${d.shortDate}: ${fmtHMShort(d.ms)} (${d.sessionsCount} sessions)`}
                  >
                    <small
                      className="mono"
                      style={{
                        fontSize: '10px',
                        color: d.ms > 0 ? 'var(--tx)' : 'var(--mu)',
                        fontWeight: d.ms > 0 ? 700 : 500,
                      }}
                    >
                      {d.ms > 0 ? fmtHMShort(d.ms) : '0m'}
                    </small>
                    <div
                      style={{
                        width: '100%',
                        maxWidth: '34px',
                        height: `${barPct}%`,
                        minHeight: '5px',
                        borderRadius: '6px 6px 3px 3px',
                        background:
                          d.ms > 0
                            ? isToday
                              ? 'linear-gradient(180deg, var(--em), var(--ac))'
                              : 'var(--ac)'
                            : 'var(--c2)',
                        opacity: d.ms > 0 ? 1 : 0.45,
                      }}
                    />
                    <small
                      style={{
                        fontSize: '11px',
                        fontWeight: isToday ? 800 : 600,
                        color: isToday ? 'var(--em)' : 'var(--mu)',
                      }}
                    >
                      {d.dayName}
                    </small>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Graph 2: 24-Hour Circadian Focus Rhythm */}
          <div className="card">
            <div className="row sp">
              <div>
                <h3>Hourly Study Distribution (00:00–23:59)</h3>
                <small>Which hours of the day you are most active in studying</small>
              </div>
              <small>
                Peak 2h: <b style={{ color: 'var(--em)' }}>{summary.peakHourWindowLabel}</b>
              </small>
            </div>
            <div className="circ-bars" style={{ marginTop: '12px' }}>
              {summary.hourlyMs.map((ms, h) => {
                const pctH = Math.round((ms / maxHrMs) * 100);
                const isPeak =
                  ms > 0 &&
                  (h === summary.peakHourIndex || h === (summary.peakHourIndex + 1) % 24);
                return (
                  <div key={h} title={`${pad(h)}:00 – ${fmtHMShort(ms)}`}>
                    <i
                      style={{
                        height: `${Math.max(3, pctH * 0.8)}px`,
                        background: isPeak
                          ? 'var(--em)'
                          : ms > 0
                            ? 'linear-gradient(180deg, var(--ac), var(--em))'
                            : 'var(--c2)',
                      }}
                    />
                    <span>{h % 3 === 0 ? pad(h) : ''}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Graph 3: Timer Mode Breakdown */}
          <div className="card">
            <h3>Study Time by Timer Mode</h3>
            <small style={{ display: 'block', marginBottom: '10px' }}>
              Distribution across Pomodoro, Stopwatch, Countdown, and Manual entries
            </small>
            {summary.modeBreakdown.map((item) => (
              <div key={item.mode} style={{ marginBottom: '9px' }}>
                <div className="row sp" style={{ marginBottom: '4px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>
                    {item.label}{' '}
                    <small>
                      ({item.count} {item.count === 1 ? 'session' : 'sessions'})
                    </small>
                  </span>
                  <span className="mono" style={{ fontSize: '12.5px', fontWeight: 700 }}>
                    {fmtHMShort(item.ms)} ({item.pct}%)
                  </span>
                </div>
                <div
                  style={{
                    height: '7px',
                    background: 'var(--c2)',
                    borderRadius: '99px',
                    overflow: 'hidden',
                  }}
                >
                    <div
                      style={{
                        height: '100%',
                        width: `${item.pct}%`,
                        background: 'var(--ac)',
                        borderRadius: '99px',
                      }}
                    />
                  </div>
                </div>
              ))}
          </div>

          {/* 1.10 Consistency Score (0-100) Breakdown Card */}
          <div className="card">
            <div className="row sp" style={{ marginBottom: '8px' }}>
              <div>
                <h3>⚡ Consistency Score (0–100)</h3>
                <small>
                  Weighted across minimum-days met (40%), start-time regularity (20%), on-time
                  revisions (20%) &amp; focus purity (20%)
                </small>
              </div>
              <span
                className="pill mono"
                style={{ fontSize: '15px', fontWeight: 900, color: '#38bdf8' }}
              >
                {consistencyScore.displayLabel}
                {consistencyScore.total !== null ? '/100' : ''}
              </span>
            </div>

            {consistencyScore.total === null ? (
              <small className="mu">
                Log study sessions or revisions to compute your Consistency Score.
              </small>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))',
                  gap: '8px',
                }}
              >
                <div className="stat-box">
                  <small>Min Days (40%)</small>
                  <b className="mono">{consistencyScore.minDayScore100}/100</b>
                  <small style={{ display: 'block', fontSize: '10.5px' }}>
                    {consistencyScore.minDaysMetCount}/14 days met min
                  </small>
                </div>
                <div className="stat-box">
                  <small>Start Regularity (20%)</small>
                  <b className="mono">
                    {consistencyScore.startRegularityScore100 !== null
                      ? `${consistencyScore.startRegularityScore100}/100`
                      : '-'}
                  </b>
                  <small style={{ display: 'block', fontSize: '10.5px' }}>
                    {consistencyScore.startStdDevMins !== null
                      ? `±${consistencyScore.startStdDevMins}m std dev`
                      : 'Need 2+ days'}
                  </small>
                </div>
                <div className="stat-box">
                  <small>On-Time Revs (20%)</small>
                  <b className="mono">
                    {consistencyScore.revisionOnTimeScore100 !== null
                      ? `${consistencyScore.revisionOnTimeScore100}/100`
                      : '-'}
                  </b>
                  <small style={{ display: 'block', fontSize: '10.5px' }}>
                    {consistencyScore.revisionsOnTimeCount}/{consistencyScore.revisionsTotalCount} on
                    time (30d)
                  </small>
                </div>
                <div className="stat-box">
                  <small>Focus Purity (20%)</small>
                  <b className="mono">
                    {consistencyScore.purityScore100 !== null
                      ? `${consistencyScore.purityScore100}/100`
                      : '-'}
                  </b>
                  <small style={{ display: 'block', fontSize: '10.5px' }}>
                    Active vs paused ratio
                  </small>
                </div>
              </div>
            )}
          </div>

          {/* 1.1 Hours per Chapter Breakdown Card */}
          <div className="card">
            <div className="row sp" style={{ marginBottom: '8px' }}>
              <div>
                <h3>📖 Hours per Chapter</h3>
                <small>Cumulative study time linked to syllabus chapters</small>
              </div>
              <span className="pill mono">{chapterBreakdown.length} chapters</span>
            </div>

            {chapterBreakdown.length === 0 ? (
              <small className="mu">
                Link a chapter when starting a Focus timer or logging a Manual Session to track
                hours per chapter.
              </small>
            ) : (
              <div>
                {chapterBreakdown.slice(0, 15).map((row) => (
                  <div key={row.chapterId} style={{ marginBottom: '9px' }}>
                    <div className="row sp" style={{ marginBottom: '4px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 700 }}>
                        {row.subjectEmoji} {row.chapterName}{' '}
                        <small style={{ color: 'var(--mu)' }}>
                          ({row.subjectName} · {row.count}s)
                        </small>
                      </span>
                      <span className="mono" style={{ fontSize: '12.5px', fontWeight: 800 }}>
                        {fmtHMShort(row.ms)} ({row.pct}%)
                      </span>
                    </div>
                    <div
                      style={{
                        height: '6px',
                        background: 'var(--c2)',
                        borderRadius: '99px',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${Math.max(4, row.pct)}%`,
                          background: row.color,
                          borderRadius: '99px',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Consistency Calendar (Last 90 Days GitHub-Style Habit Completion Heatmap) */}
          <div className="card" id="consistencyCalendarCard">
            <div className="row sp" style={{ marginBottom: '8px', alignItems: 'flex-start' }}>
              <div>
                <h3>🟩 Consistency Calendar (Last 90 Days)</h3>
                <small>
                  Daily habit completion percentage over the last 90 days, color-coded by density
                </small>
              </div>
              <span className="pill mono" style={{ fontSize: '11.5px', color: 'var(--em)' }}>
                {consistencyCal.avgPct}% Avg
              </span>
            </div>

            <div
              className="chips wrap"
              style={{ marginBottom: '10px', gap: '8px', paddingBottom: 0 }}
            >
              <span className="pill" style={{ fontSize: '11.5px' }}>
                Perfect Days (100%): <b className="mono">{consistencyCal.perfectDays}</b>
              </span>
              <span className="pill" style={{ fontSize: '11.5px' }}>
                Active Days: <b className="mono">{consistencyCal.activeDays}/90</b>
              </span>
              <span className="pill" style={{ fontSize: '11.5px' }}>
                90d Completion: <b className="mono">{consistencyCal.avgPct}%</b>
              </span>
            </div>

            <div className="cc-scroll">
              <div className="cc-layout">
                {/* Weekday labels aligned to state.set.ws */}
                <div className="cc-dow-col" aria-hidden="true">
                  {Array.from({ length: 7 }, (_, r) => {
                    const dow = ((state.set.ws ?? 1) + r) % 7;
                    return <span key={r}>{r % 2 === 0 ? DN[dow] : ''}</span>;
                  })}
                </div>

                <div className="cc-main">
                  {/* Month Headers */}
                  <div className="cc-months" aria-hidden="true">
                    {consistencyCal.weeks.map((wk, wIdx) => {
                      const firstNonNull = wk.find((d) => d !== null);
                      const prevWeek = wIdx > 0 ? consistencyCal.weeks[wIdx - 1] : null;
                      const prevNonNull = prevWeek?.find((d) => d !== null);
                      const showMonth =
                        firstNonNull &&
                        (wIdx === 0 || firstNonNull.monthShort !== prevNonNull?.monthShort);
                      return <span key={wIdx}>{showMonth ? firstNonNull.monthShort : ''}</span>;
                    })}
                  </div>

                  {/* 7xN Weekly Columns */}
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
                            <i key={`empty-${wIdx}-${dIdx}`} className="cc-cell-empty" />
                          )
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {selectedCalDay && (
              <div
                className="row sp"
                style={{
                  marginTop: '10px',
                  padding: '8px 12px',
                  background: 'var(--c2)',
                  borderRadius: '12px',
                  fontSize: '12px',
                }}
              >
                <span>
                  <b>
                    {selectedCalDay.dayName}, {selectedCalDay.shortDate}
                  </b>{' '}
                  <small className="mono">({selectedCalDay.key})</small>
                </span>
                <span>
                  Habits:{' '}
                  <b className="mono" style={{ color: 'var(--em)' }}>
                    {selectedCalDay.doneCount}/{selectedCalDay.dueCount} ({selectedCalDay.pct}%)
                  </b>{' '}
                  · Study: <b className="mono">{fmtHMShort(selectedCalDay.studyMs)}</b>
                </span>
              </div>
            )}

            <div
              className="row"
              style={{
                justifyContent: 'flex-end',
                gap: '5px',
                marginTop: '8px',
                fontSize: '11px',
                color: 'var(--mu)',
              }}
            >
              <span>Less (0%)</span>
              <i className="cc-l0" style={{ width: '12px', height: '12px', borderRadius: '3px' }} />
              <i className="cc-l1" style={{ width: '12px', height: '12px', borderRadius: '3px' }} />
              <i className="cc-l2" style={{ width: '12px', height: '12px', borderRadius: '3px' }} />
              <i className="cc-l3" style={{ width: '12px', height: '12px', borderRadius: '3px' }} />
              <i className="cc-l4" style={{ width: '12px', height: '12px', borderRadius: '3px' }} />
              <span>More (100%)</span>
            </div>
          </div>

          {/* Graph 4: 12-Week Study Depth Heatmap */}
          <div className="card">
            <div className="row sp">
              <h3>12-Week Study Depth Heatmap</h3>
              <small>0h · &lt;2h · 2-4h · 4-6h · 6-8h · 8h+</small>
            </div>
            <div className="hm" style={{ marginTop: '10px' }}>
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
            <div
              className="row"
              style={{
                justifyContent: 'flex-end',
                gap: '5px',
                marginTop: '8px',
                fontSize: '11px',
                color: 'var(--mu)',
              }}
            >
              <span>0h</span>
              <i className="hm-l0" style={{ width: '12px', height: '12px', borderRadius: '3px' }} />
              <span>&lt;2h</span>
              <i className="hm-l1" style={{ width: '12px', height: '12px', borderRadius: '3px' }} />
              <span>4h</span>
              <i className="hm-l2" style={{ width: '12px', height: '12px', borderRadius: '3px' }} />
              <span>6h</span>
              <i className="hm-l3" style={{ width: '12px', height: '12px', borderRadius: '3px' }} />
              <span>8h+</span>
              <i className="hm-l5" style={{ width: '12px', height: '12px', borderRadius: '3px' }} />
            </div>
          </div>

          {/* Session Headings & Completed Study Log Breakdown */}
          <div className="card">
            <div className="row sp" style={{ marginBottom: '8px' }}>
              <div>
                <h3>Session Headings &amp; Study Log</h3>
                <small>Grouped by the session headings you typed</small>
              </div>
              <span className="pill mono" style={{ fontSize: '11.5px' }}>
                {summary.headingBreakdown.length} topics
              </span>
            </div>

            {summary.headingBreakdown.length ? (
              summary.headingBreakdown.map((item) => (
                <div
                  key={item.heading}
                  style={{ padding: '8px 0', borderBottom: '1px solid var(--bd)' }}
                >
                  <div className="row sp" style={{ marginBottom: '4px' }}>
                    <span>
                      <i
                        className="dot"
                        style={{
                          display: 'inline-block',
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          background: item.color,
                          marginRight: '6px',
                        }}
                      />
                      <b>{item.heading}</b>{' '}
                      <small>
                        ({item.count} {item.count === 1 ? 'session' : 'sessions'})
                      </small>
                    </span>
                    <b className="mono" style={{ color: 'var(--em)' }}>
                      {fmtHMShort(item.ms)}
                    </b>
                  </div>
                  <div
                    style={{
                      height: '6px',
                      background: 'var(--c2)',
                      borderRadius: '99px',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.max(4, item.pct)}%`,
                        background: item.color,
                      }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <small className="mu">No study sessions logged yet.</small>
            )}

            {state.sessions.length > 0 && (
              <div style={{ marginTop: '14px' }}>
                <small
                  style={{
                    display: 'block',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    marginBottom: '6px',
                  }}
                >
                  Recent Session Notes &amp; Accomplishments
                </small>
                {state.sessions
                  .slice()
                  .sort((a, b) => b.startTs - a.startTs)
                  .slice(0, 8)
                  .map((s) => {
                    const sub = getSubject(state, s.subjectId);
                    const heading = getSessionHeading(state, s);
                    return (
                      <div
                        key={s.id}
                        className="row sp"
                        style={{
                          padding: '8px 0',
                          borderBottom: '1px solid var(--bd)',
                          alignItems: 'flex-start',
                        }}
                      >
                        <div className="g">
                          <div className="row sp">
                            <b>
                              <i
                                style={{
                                  display: 'inline-block',
                                  width: '8px',
                                  height: '8px',
                                  borderRadius: '50%',
                                  background: sub.color,
                                  marginRight: '6px',
                                }}
                              />
                              {sub.e} {sub.name} · {heading}
                            </b>
                            <span
                              className="mono"
                              style={{ color: 'var(--em)', fontWeight: 700 }}
                            >
                              {fmtHMShort(s.activeMs)}
                            </span>
                          </div>
                          <small style={{ display: 'block' }}>
                            {s.dayKey} · {fmtClockTime(s.startTs)} – {fmtClockTime(s.endTs)} ·{' '}
                            {s.mode.toUpperCase()}
                          </small>
                          {s.note && (
                            <small
                              style={{
                                display: 'block',
                                color: 'var(--tx)',
                                marginTop: '2px',
                              }}
                            >
                              What I did: “{s.note}”
                            </small>
                          )}
                        </div>
                        {onEditSession && (
                          <button
                            type="button"
                            className="s"
                            style={{ padding: '4px 8px', fontSize: '11px' }}
                            onClick={() => onEditSession(s.id)}
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          {/* Level & Badges */}
          <div className="card">
            <h3>
              Level {level} · {totalXp} XP
            </h3>
            <div
              style={{
                height: '8px',
                background: 'var(--c2)',
                borderRadius: '9px',
                overflow: 'hidden',
                margin: '6px 0',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${Math.round(((totalXp - pv) / (nx - pv)) * 100)}%`,
                  background: 'var(--ac)',
                }}
              />
            </div>
            <small>
              {nx - totalXp} XP to level {level + 1}
            </small>
            <div style={{ marginTop: '8px' }}>
              {badges(state, todayKey).map(([n, o]) => (
                <span
                  key={n}
                  className="pill"
                  style={{ margin: '2px', opacity: o ? 1 : 0.35 }}
                >
                  {n}
                </span>
              ))}
            </div>
          </div>

          <h2>Habit Streaks</h2>
          {liveHabits.length ? (
            liveHabits.map((h) => {
              const s = streak(state, h, todayKey);
              return (
                <div key={h.id} className="card">
                  <div className="row sp">
                    <b>
                      {h.e} {h.name}
                    </b>
                    <small>{total(state, h)} check-ins</small>
                  </div>
                  <small>
                    🔥 {s.cur} now · best {s.best} · 7d {rate(state, h, 7, todayKey)}% · 30d{' '}
                    {rate(state, h, 30, todayKey)}%
                  </small>
                </div>
              );
            })
          ) : (
            <div className="card mu">No habits yet.</div>
          )}
        </div>
      )}
    </div>
  );
};
