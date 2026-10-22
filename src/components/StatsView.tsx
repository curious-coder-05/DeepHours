import React from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { PulseHabitState } from '../types';
import {
  addD,
  badges,
  computeStudySummary,
  fmtClockTime,
  fmtHMShort,
  getHeadingColor,
  getSessionHeading,
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

interface StatsViewProps {
  state: PulseHabitState;
  todayKey: string;
  onEditSession?: (sessionId: string) => void;
}

interface DeepWorkTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: {
      key: string;
      dayName: string;
      shortDate: string;
      ms: number;
      hours: number;
      minutes: number;
      formatted: string;
      sessionsCount: number;
    };
  }>;
}

const DeepWorkTooltip: React.FC<DeepWorkTooltipProps> = ({ active, payload }) => {
  if (!active || !payload || !payload.length) return null;
  const pt = payload[0].payload;
  const hrsFloor = Math.floor(pt.minutes / 60);
  const minsRem = pt.minutes % 60;
  const hmDetailed =
    hrsFloor > 0 ? `${hrsFloor}h ${minsRem}m (${pt.minutes} mins)` : `${pt.minutes}m`;

  return (
    <div
      style={{
        background: 'rgba(15, 23, 42, 0.96)',
        border: '1px solid rgba(99, 102, 241, 0.45)',
        borderRadius: '12px',
        padding: '10px 12px',
        boxShadow: '0 10px 26px rgba(0, 0, 0, 0.45)',
        color: '#eef1f8',
        fontSize: '12px',
        lineHeight: 1.45,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: '3px', color: '#f8fafc' }}>
        {pt.dayName}, {pt.shortDate}{' '}
        <span style={{ color: '#8b95b0', fontWeight: 500 }}>({pt.key})</span>
      </div>
      <div className="mono" style={{ color: '#10b981', fontWeight: 800, fontSize: '13px' }}>
        ⏱️ Studied: {hmDetailed}
      </div>
      <div style={{ color: '#94a3b8', fontSize: '11px', marginTop: '2px' }}>
        {pt.sessionsCount} {pt.sessionsCount === 1 ? 'session' : 'sessions'} logged · {pt.hours}h
      </div>
    </div>
  );
};

export const StatsView: React.FC<StatsViewProps> = ({ state, todayKey, onEditSession }) => {
  const summary = computeStudySummary(state, todayKey);

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
      <div className="row sp" style={{ marginBottom: '8px' }}>
        <div>
          <h2>Study Summary &amp; Analytics Report</h2>
          <small>
            Weekly &amp; monthly study averages, deep work frequency, peak active hours, and session history
          </small>
        </div>
      </div>

      {/* Primary Weekly / Monthly / Peak Hours Executive Summary Grid */}
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
            <span style={{ fontSize: '12px', color: 'var(--mu)', fontWeight: 600 }}>/ day</span>
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
            <span style={{ fontSize: '12px', color: 'var(--mu)', fontWeight: 600 }}>/ day</span>
          </b>
          <small style={{ display: 'block', marginTop: '4px' }}>
            Total: <b className="mono">{fmtHMShort(summary.monthTotalMs)}</b> ·{' '}
            {summary.monthActiveDays}/30 active days
          </small>
          <small style={{ display: 'block', marginTop: '2px' }}>
            All-time: <b className="mono">{fmtHMShort(summary.allTimeTotalMs)}</b> (
            {summary.totalSessionsCount} sessions)
          </small>
        </div>
      </div>

      {/* Deep Work Frequency (Last 30 Days) Line Chart via Recharts */}
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

        <div className="chips wrap" style={{ marginBottom: '10px', gap: '8px', paddingBottom: 0 }}>
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

        <div style={{ width: '100%', height: 225 }} id="deepWorkFrequencyChart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={summary.last30Days}
              margin={{ top: 10, right: 12, left: -8, bottom: 2 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(148, 163, 184, 0.14)"
                vertical={false}
              />
              <XAxis
                dataKey="shortDate"
                minTickGap={22}
                tick={{ fill: '#8b95b0', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: 'rgba(148, 163, 184, 0.2)' }}
              />
              <YAxis
                dataKey="hours"
                tickFormatter={(val: number) => {
                  const mins = Math.round(val * 60);
                  if (mins === 0) return '0m';
                  const h = Math.floor(mins / 60);
                  const m = mins % 60;
                  return m > 0 ? `${h}h${m}m` : `${h}h`;
                }}
                tick={{ fill: '#8b95b0', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={44}
                domain={[0, (dataMax: number) => Math.max(2, Math.ceil(dataMax + 0.5))]}
              />
              <Tooltip content={<DeepWorkTooltip />} />
              {avg30dHours > 0 && (
                <ReferenceLine
                  y={avg30dHours}
                  stroke="#6366f1"
                  strokeDasharray="4 4"
                  strokeOpacity={0.75}
                />
              )}
              <Line
                type="monotone"
                dataKey="hours"
                name="Daily Study Time"
                stroke="#10b981"
                strokeWidth={2.75}
                dot={{ r: 3, fill: '#10b981', strokeWidth: 0 }}
                activeDot={{
                  r: 6,
                  fill: '#10b981',
                  stroke: '#090d16',
                  strokeWidth: 2,
                }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
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
              ⚡ Most Active Study Hours · {summary.peakPeriodLabel}
            </small>
            <b
              className="mono"
              style={{ display: 'block', fontSize: '22px', marginTop: '4px' }}
            >
              {summary.peakHourWindowLabel}
            </b>
            <small style={{ display: 'block', marginTop: '4px' }}>
              You concentrate most heavily starting around{' '}
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
            const barPct = d.ms > 0 ? Math.max(10, Math.round((d.ms / maxWeekDayMs) * 100)) : 4;
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
            Peak: <b style={{ color: 'var(--em)' }}>{pad(summary.peakHourIndex)}:00</b>
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
                <small>({item.count} {item.count === 1 ? 'session' : 'sessions'})</small>
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
                const heading = getSessionHeading(state, s);
                const col = getHeadingColor(heading);
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
                              background: col,
                              marginRight: '6px',
                            }}
                          />
                          {heading}
                        </b>
                        <span className="mono" style={{ color: 'var(--em)', fontWeight: 700 }}>
                          {fmtHMShort(s.activeMs)}
                        </span>
                      </div>
                      <small style={{ display: 'block' }}>
                        {s.dayKey} · {fmtClockTime(s.startTs)} – {fmtClockTime(s.endTs)} ·{' '}
                        {s.mode.toUpperCase()}
                      </small>
                      {s.note && (
                        <small style={{ display: 'block', color: 'var(--tx)', marginTop: '2px' }}>
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
  );
};
