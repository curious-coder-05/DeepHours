import React, { useState } from 'react';
import type { ActiveTimerMode, AppTab, Habit, HabitCategory, PulseHabitState } from '../types';
import {
  CATS,
  CC,
  DN,
  STARTERS,
  addD,
  done,
  dueOn,
  ent,
  fmtClockTime,
  fmtHMShort,
  fmtMS,
  getDailyFocusTip,
  getHeadingColor,
  getSessionHeading,
  getTimerMetrics,
  getTodaySubjectMs,
  lvl,
  pad,
  parseKey,
  pct,
  skip,
  streak,
  wkC,
  xp,
} from '../utils/studyLogic';

interface TodayViewProps {
  state: PulseHabitState;
  sel: string;
  todayKey: string;
  cat: 'All' | HabitCategory;
  onSelectDay: (dayKey: string) => void;
  onSelectCat: (cat: 'All' | HabitCategory) => void;
  onSwitchTab: (tab: AppTab) => void;
  onToggleHabit: (id: string) => void;
  onIncrementHabit: (id: string, delta: number) => void;
  onSkipHabit: (id: string) => void;
  onAddStarter: (index: number) => void;
  onNewHabit: () => void;
  onEditHabit: (id: string) => void;
  onQuickStartSession: (heading: string, mode: ActiveTimerMode) => void;
  onNewDDay: () => void;
  onEditDDay: (id: string) => void;
  onOpenManualSession: () => void;
  onDeleteSession: (id: string) => void;
  onSetMood: (val: number) => void;
  onSetNote: (txt: string) => void;
}

export const TodayView: React.FC<TodayViewProps> = ({
  state,
  sel,
  todayKey,
  cat,
  onSelectDay,
  onSelectCat,
  onSwitchTab,
  onToggleHabit,
  onIncrementHabit,
  onSkipHabit,
  onAddStarter,
  onNewHabit,
  onQuickStartSession,
  onNewDDay,
  onEditDDay,
  onOpenManualSession,
  onDeleteSession,
  onSetMood,
  onSetNote,
}) => {
  const [tipOffset, setTipOffset] = useState(0);
  const [quickHeading, setQuickHeading] = useState('');

  const allDue = dueOn(state, sel);
  const hs = allDue.filter((h) => cat === 'All' || h.c === cat);
  const completedCount = allDue.filter((h) => done(state, h, sel)).length;
  const p = Math.round(pct(state, sel) * 100);
  const totalXp = xp(state, todayKey);
  const level = lvl(totalXp);
  const currentMood = state.mood[sel] || 0;
  const dayStudyMs = getTodaySubjectMs(state, 'any', sel, todayKey);
  const daySessions = state.sessions
    .filter((s) => s.dayKey === sel)
    .sort((a, b) => b.startTs - a.startTs);
  const avgPurity = daySessions.length
    ? Math.round(daySessions.reduce((a, s) => a + (s.purity || 100), 0) / daySessions.length)
    : 100;
  const activeMetrics = getTimerMetrics(state);
  const focusTip = getDailyFocusTip(sel, tipOffset);

  const renderHabitCard = (h: Habit) => {
    const e = ent(state, h, sel);
    const d = done(state, h, sel);
    const sk = skip(state, h, sel);
    const s = streak(state, h, todayKey);
    const u = h.sch === 'week' ? 'w' : 'd';
    const isAutoStudy = Boolean(h.subjectId || h.autoMins);

    return (
      <div
        key={h.id}
        className={`c ${d ? 'dn' : ''} ${sk ? 'sk' : ''}`}
        style={{ '--hc': CC[h.c] || CC.Other } as React.CSSProperties}
        onClick={() => onToggleHabit(h.id)}
      >
        <button
          type="button"
          className="ck"
          aria-pressed={d}
          aria-label={`Mark ${h.name}`}
          onClick={(ev) => {
            ev.stopPropagation();
            onToggleHabit(h.id);
          }}
        >
          {d ? (
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ margin: 'auto', display: 'block' }}
              aria-hidden="true"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : sk ? (
            '⏭'
          ) : (
            h.e
          )}
        </button>
        <div className="g">
          <b>{h.name}</b>
          <small>
            🔥 {s.cur}
            {u}
            {h.sch === 'week' ? ` · ${wkC(state, h, sel)}/${h.n} wk` : ''}
            {h.tn > 1 ? ` · ${e?.v || 0}/${h.tn} ${h.tu}` : ''}
            {isAutoStudy ? ' · 🔗 Auto-syncs study mins' : ''}
          </small>
        </div>
        {h.tn > 1 && (
          <>
            <button
              type="button"
              className="s"
              aria-label={`Decrease ${h.name}`}
              onClick={(ev) => {
                ev.stopPropagation();
                onIncrementHabit(h.id, -1);
              }}
            >
              −
            </button>
            <button
              type="button"
              className="s"
              aria-label={`Increase ${h.name}`}
              onClick={(ev) => {
                ev.stopPropagation();
                onIncrementHabit(h.id, 1);
              }}
            >
              +
            </button>
          </>
        )}
        <button
          type="button"
          className="s"
          aria-label={`Skip ${h.name} today`}
          title="Skip day (keeps streak)"
          onClick={(ev) => {
            ev.stopPropagation();
            onSkipHabit(h.id);
          }}
        >
          ⏭
        </button>
      </div>
    );
  };

  return (
    <div>
      <header className="top">
        <div>
          <small>
            {parseKey(sel).toLocaleDateString(undefined, {
              weekday: 'long',
              month: 'short',
              day: 'numeric',
            })}{' '}
            · Reset {pad(state.set.dayResetHour)}:00
          </small>
          <h1>PulseHabit</h1>
        </div>
        <div className="row">
          {activeMetrics && (
            <button
              type="button"
              className="pill em-btn"
              onClick={() => onSwitchTab('focus')}
            >
              ⏱️ {fmtMS(activeMetrics.totalActiveMs)}
            </button>
          )}
          <span className="pill">
            Lv {level} · {totalXp} XP
          </span>
        </div>
      </header>

      {/* D-Day Strip */}
      <div className="dday-strip">
        {state.ddays.map((d) => {
          const diff = Math.round(
            (parseKey(d.date).getTime() - parseKey(todayKey).getTime()) / 86400000
          );
          const badge =
            diff === 0 ? 'D-Day' : diff > 0 ? `D-${diff}` : `D+${Math.abs(diff)}`;
          return (
            <button
              type="button"
              key={d.id}
              className="dday-card"
              style={{ '--dc': d.color || '#6366f1', textAlign: 'left' } as React.CSSProperties}
              onClick={() => onEditDDay(d.id)}
              aria-label={`Edit D-Day ${d.title}`}
            >
              <span className="dday-badge">{badge}</span>
              <div className="g">
                <b style={{ fontSize: '13px' }}>
                  {d.e || '🎯'} {d.title}
                </b>
                <small style={{ fontSize: '11px' }}>{d.date}</small>
              </div>
            </button>
          );
        })}
        <button
          type="button"
          className="pill"
          style={{ borderStyle: 'dashed' }}
          onClick={onNewDDay}
        >
          + D-Day
        </button>
      </div>

      {/* 7-Day Week Strip */}
      <div className="wk">
        {[...Array(7)].map((_, i) => {
          const k = addD(todayKey, i - 6);
          const dayPct = Math.round(pct(state, k) * 100);
          return (
            <button
              type="button"
              key={k}
              className={k === sel ? 'on' : ''}
              onClick={() => onSelectDay(k)}
              aria-label={`Select date ${k}`}
            >
              <small>{DN[parseKey(k).getDay()]}</small>
              <b>{parseKey(k).getDate()}</b>
              <i style={{ '--p': dayPct } as React.CSSProperties} />
            </button>
          );
        })}
      </div>

      {/* Hero Ring & Flexible Study Metrics */}
      <div className="card hero-grid">
        <div className="ring" style={{ '--p': p } as React.CSSProperties}>
          <i>
            <div>
              <b>
                {p}
                <small style={{ fontSize: '14px' }}>%</small>
              </b>
              <small style={{ display: 'block', fontSize: '11px' }}>
                {completedCount}/{allDue.length} habits
              </small>
            </div>
          </i>
        </div>
        <div className="stat-mini">
          <div className="stat-box">
            <small>Studied Today</small>
            <b className="mono" style={{ color: 'var(--em)' }}>
              {fmtHMShort(dayStudyMs)}
            </b>
          </div>
          <div className="stat-box">
            <small>Focus Purity</small>
            <b className="mono">{avgPurity}%</b>
          </div>
          <div className="stat-box">
            <small>Sessions</small>
            <b className="mono">{daySessions.length}</b>
          </div>
          <button
            type="button"
            className="stat-box"
            style={{ cursor: 'pointer', textAlign: 'left' }}
            onClick={onOpenManualSession}
          >
            <small>+ Log Hours</small>
            <b style={{ color: 'var(--ac)', fontSize: '13px' }}>Manual +</b>
          </button>
        </div>
      </div>

      {/* Daily Focus Tip Card */}
      <div
        className="card"
        style={{
          borderLeft: '4px solid var(--ac)',
          background: 'linear-gradient(135deg, var(--c1) 0%, var(--c2) 100%)',
        }}
      >
        <div className="row sp" style={{ marginBottom: '6px' }}>
          <div className="row" style={{ gap: '8px' }}>
            <span
              className="pill"
              style={{
                padding: '3px 9px',
                fontSize: '11px',
                background: 'color-mix(in srgb, var(--ac) 20%, transparent)',
                color: 'var(--tx)',
                borderColor: 'var(--ac)',
              }}
            >
              💡 Daily Focus Tip · {focusTip.tag}
            </span>
          </div>
          <button
            type="button"
            className="s"
            onClick={() => setTipOffset((prev) => prev + 1)}
            aria-label="Next daily focus tip"
          >
            Next Tip ↻
          </button>
        </div>
        <b style={{ display: 'block', fontSize: '14px', marginBottom: '4px' }}>
          {focusTip.title}
        </b>
        <small style={{ display: 'block', lineHeight: 1.45, fontSize: '12.5px' }}>
          {focusTip.tip}
        </small>
      </div>

      {/* Quick Session Heading & Timer / Manual Logger Card */}
      <div className="card">
        <div className="row sp" style={{ marginBottom: '8px' }}>
          <div>
            <h3 style={{ marginBottom: '2px' }}>Start or Log Study Session</h3>
            <small>Type a session heading &amp; start any timer or log hours directly</small>
          </div>
          <button type="button" className="s pri" onClick={onOpenManualSession}>
            + Log Hours
          </button>
        </div>
        <input
          type="text"
          value={quickHeading}
          onChange={(e) => setQuickHeading(e.target.value)}
          placeholder="Session heading (e.g., Lecture 8 Notes, LeetCode Graphs...)"
          style={{ marginBottom: '8px' }}
        />
        <div className="row" style={{ gap: '6px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="s em-btn"
            style={{ flex: 1 }}
            onClick={() =>
              onQuickStartSession(quickHeading.trim() || 'Deep Study Session', 'pomo')
            }
          >
            🍅 Start Pomodoro
          </button>
          <button
            type="button"
            className="s"
            style={{ flex: 1, borderColor: 'var(--em)', color: 'var(--em)' }}
            onClick={() =>
              onQuickStartSession(quickHeading.trim() || 'Deep Study Session', 'stopwatch')
            }
          >
            ⏱️ Start Stopwatch
          </button>
          <button
            type="button"
            className="s"
            style={{ flex: 1 }}
            onClick={() =>
              onQuickStartSession(quickHeading.trim() || 'Deep Study Session', 'countdown')
            }
          >
            ⏳ Countdown
          </button>
        </div>

        {daySessions.length > 0 && (
          <div style={{ marginTop: '12px', borderTop: '1px solid var(--bd)', paddingTop: '10px' }}>
            <div className="row sp" style={{ marginBottom: '6px' }}>
              <small style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Completed Sessions ({daySessions.length})
              </small>
              <button
                type="button"
                className="s"
                style={{ padding: '3px 8px', fontSize: '11px' }}
                onClick={() => onSwitchTab('stats')}
              >
                Full Summary →
              </button>
            </div>
            {daySessions.slice(0, 4).map((s) => {
              const heading = getSessionHeading(state, s);
              const color = getHeadingColor(heading);
              return (
                <div
                  key={s.id}
                  className="row"
                  style={{
                    padding: '8px 0',
                    borderBottom: '1px solid var(--bd)',
                    alignItems: 'flex-start',
                  }}
                >
                  <span
                    style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      background: color,
                      marginTop: '5px',
                      flexShrink: 0,
                    }}
                  />
                  <div className="g">
                    <div className="row sp">
                      <b style={{ fontSize: '13.5px' }}>{heading}</b>
                      <span className="mono" style={{ color: 'var(--em)', fontWeight: 700, fontSize: '12.5px' }}>
                        {fmtHMShort(s.activeMs)}
                      </span>
                    </div>
                    <small>
                      {fmtClockTime(s.startTs)} – {fmtClockTime(s.endTs)} · {s.mode.toUpperCase()}
                      {s.overtimeMs ? ` · +${fmtHMShort(s.overtimeMs)} OT` : ''}
                    </small>
                    {s.note && (
                      <small style={{ display: 'block', color: 'var(--tx)', marginTop: '3px' }}>
                        “{s.note}”
                      </small>
                    )}
                  </div>
                  <button
                    type="button"
                    className="s del"
                    style={{ padding: '4px 8px' }}
                    aria-label="Delete session"
                    onClick={() => onDeleteSession(s.id)}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Habits Section */}
      {!state.habits.length ? (
        <div className="card">
          <h3>Starter Habits (Auto-Sync Ready)</h3>
          <small>Tap to add.</small>
          <div className="chips wrap" style={{ marginTop: '8px' }}>
            {STARTERS.map((s, i) => (
              <button
                type="button"
                key={s.name}
                onClick={() => onAddStarter(i)}
              >
                {s.e} {s.name}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="pri"
            style={{ marginTop: '10px' }}
            onClick={onNewHabit}
          >
            + Custom Habit
          </button>
        </div>
      ) : (
        <>
          <div className="row sp" style={{ margin: '12px 0 6px' }}>
            <div className="chips" style={{ paddingBottom: 0 }}>
              {(['All', ...CATS] as const).map((c) => (
                <button
                  type="button"
                  key={c}
                  className={c === cat ? 'on' : ''}
                  onClick={() => onSelectCat(c)}
                >
                  {c}
                </button>
              ))}
            </div>
            <button type="button" className="s pri" onClick={onNewHabit}>
              + Habit
            </button>
          </div>
          {hs.length ? (
            hs.map(renderHabitCard)
          ) : (
            <div className="card mu">No habits scheduled in {cat}.</div>
          )}
        </>
      )}

      {/* Daily Reflection & Mood */}
      <div className="card mood">
        <h3>Daily Reflection &amp; Mood</h3>
        <div className="row">
          {['😞', '😕', '😐', '🙂', '😄'].map((m, i) => (
            <button
              type="button"
              key={m}
              className={currentMood === i + 1 ? 'on' : ''}
              onClick={() => onSetMood(i + 1)}
              style={{ fontSize: '22px', flex: 1 }}
              aria-label={`Mood ${i + 1} of 5`}
            >
              {m}
            </button>
          ))}
        </div>
        <textarea
          id="note"
          rows={2}
          maxLength={500}
          placeholder="Key takeaways, lecture notes, blockers..."
          style={{ marginTop: '8px' }}
          value={state.notes[sel] || ''}
          onChange={(e) => onSetNote(e.target.value)}
        />
      </div>
    </div>
  );
};
