import React from 'react';
import type { PulseHabitState, StudySession } from '../types';
import {
  addD,
  badges,
  fmtHMShort,
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
}

export const StatsView: React.FC<StatsViewProps> = ({ state, todayKey }) => {
  // 1. Milestone Color-Depth Heatmap (84 days / 12 weeks: 0h, <2h, 2-4h, 4-6h, 6-8h, 8h+)
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

  // 2. Circadian Hourly Bar Chart (00:00 - 23:59)
  const hrBuckets = new Array<number>(24).fill(0);
  state.sessions.forEach((s) => {
    for (let ts = s.startTs; ts < s.endTs; ts += 300000) {
      const h = new Date(ts).getHours();
      hrBuckets[h] += 5;
    }
  });
  const maxHrMins = Math.max(30, ...hrBuckets);
  const peakHr = hrBuckets.indexOf(Math.max(...hrBuckets));

  // 3. First Start & Last End Time Averages
  const byDay: Record<string, StudySession[]> = {};
  state.sessions.forEach((s) => {
    (byDay[s.dayKey] ??= []).push(s);
  });
  let startMinsSum = 0;
  let endMinsSum = 0;
  let dayCount = 0;
  Object.values(byDay).forEach((list) => {
    if (!list.length) return;
    dayCount++;
    const earliest = Math.min(...list.map((s) => s.startTs));
    const latest = Math.max(...list.map((s) => s.endTs));
    const dStart = new Date(earliest);
    const dEnd = new Date(latest);
    startMinsSum += dStart.getHours() * 60 + dStart.getMinutes();
    endMinsSum += dEnd.getHours() * 60 + dEnd.getMinutes();
  });

  const fmtMinsOfDay = (m: number) => `${pad(Math.floor(m / 60))}:${pad(Math.round(m % 60))}`;
  const avgStartStr = dayCount ? fmtMinsOfDay(startMinsSum / dayCount) : '--:--';
  const avgEndStr = dayCount ? fmtMinsOfDay(endMinsSum / dayCount) : '--:--';
  const totalHrsAllTime = (
    state.sessions.reduce((a, s) => a + (s.activeMs || 0), 0) / 3600000
  ).toFixed(1);
  const globalPurity = state.sessions.length
    ? Math.round(
        state.sessions.reduce((a, s) => a + (s.purity || 100), 0) / state.sessions.length
      )
    : 100;

  const totalXp = xp(state, todayKey);
  const level = lvl(totalXp);
  const nx = Math.pow(level, 2) * 60;
  const pv = Math.pow(level - 1, 2) * 60;
  const liveHabits = live(state);

  return (
    <div>
      <h2>Deep Study &amp; Habit Analytics</h2>
      <div
        className="stat-mini"
        style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: '10px' }}
      >
        <div className="stat-box">
          <small>Total Hours</small>
          <b className="mono">{totalHrsAllTime}h</b>
        </div>
        <div className="stat-box">
          <small>Avg Start</small>
          <b className="mono">{avgStartStr}</b>
        </div>
        <div className="stat-box">
          <small>Avg Wrap-up</small>
          <b className="mono">{avgEndStr}</b>
        </div>
        <div className="stat-box">
          <small>Avg Purity</small>
          <b className="mono">{globalPurity}%</b>
        </div>
      </div>

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

      <div className="card">
        <div className="row sp">
          <h3>Circadian Focus Rhythm (00:00–23:59)</h3>
          <small>
            Peak Hour: <b style={{ color: 'var(--em)' }}>{pad(peakHr)}:00</b>
          </small>
        </div>
        <div className="circ-bars">
          {hrBuckets.map((mins, h) => {
            const pctH = Math.round((mins / maxHrMins) * 100);
            return (
              <div key={h} title={`${pad(h)}:00 - ${fmtHMShort(mins * 60000)}`}>
                <i style={{ height: `${Math.max(3, pctH * 0.8)}px` }} />
                <span>{h % 3 === 0 ? pad(h) : ''}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h3>Subject Breakdown</h3>
        {state.subjects.map((sub) => {
          const ms = state.sessions
            .filter((s) => s.subjectId === sub.id)
            .reduce((a, s) => a + (s.activeMs || 0), 0);
          return (
            <div
              key={sub.id}
              className="row sp"
              style={{ padding: '6px 0', borderBottom: '1px solid var(--bd)' }}
            >
              <span>
                <i className="dot" style={{ '--sc': sub.color } as React.CSSProperties} />{' '}
                {sub.e} {sub.name}
              </span>
              <b className="mono">{fmtHMShort(ms)}</b>
            </div>
          );
        })}
      </div>

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
