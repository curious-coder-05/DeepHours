import React from 'react';
import type { AppTab, Habit, HabitCategory, PulseHabitState } from '../types';
import {
  CATS,
  CC,
  DN,
  STARTERS,
  addD,
  done,
  dueOn,
  ent,
  fmtHMShort,
  fmtMS,
  getSubject,
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
  onNewSubject: () => void;
  onQuickStartSubject: (subjectId: string) => void;
  onNewDDay: () => void;
  onEditDDay: (id: string) => void;
  onOpenManualSession: () => void;
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
  onNewSubject,
  onQuickStartSubject,
  onNewDDay,
  onEditDDay,
  onOpenManualSession,
  onSetMood,
  onSetNote,
}) => {
  const allDue = dueOn(state, sel);
  const hs = allDue.filter((h) => cat === 'All' || h.c === cat);
  const completedCount = allDue.filter((h) => done(state, h, sel)).length;
  const p = Math.round(pct(state, sel) * 100);
  const totalXp = xp(state, todayKey);
  const level = lvl(totalXp);
  const currentMood = state.mood[sel] || 0;
  const dayStudyMs = getTodaySubjectMs(state, 'any', sel, todayKey);
  const daySessions = state.sessions.filter((s) => s.dayKey === sel);
  const avgPurity = daySessions.length
    ? Math.round(daySessions.reduce((a, s) => a + (s.purity || 100), 0) / daySessions.length)
    : 100;
  const activeMetrics = getTimerMetrics(state);

  const renderHabitCard = (h: Habit) => {
    const e = ent(state, h, sel);
    const d = done(state, h, sel);
    const sk = skip(state, h, sel);
    const s = streak(state, h, todayKey);
    const u = h.sch === 'week' ? 'w' : 'd';
    const linkedSub = h.subjectId
      ? h.subjectId === 'any'
        ? { name: 'All Subjects', e: '⏱️' }
        : getSubject(state, h.subjectId)
      : null;

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
            {linkedSub ? ` · 🔗 ${linkedSub.name}` : ''}
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

      {/* Hero Ring & Study Metrics */}
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
            <small>Studied</small>
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
            <small>+ Log Session</small>
            <b style={{ color: 'var(--ac)', fontSize: '13px' }}>Manual +</b>
          </button>
        </div>
      </div>

      {/* Quick Subject Study Launcher */}
      <div className="card">
        <div className="row sp" style={{ marginBottom: '8px' }}>
          <h3>Subjects &amp; Checklist</h3>
          <button type="button" className="s" onClick={onNewSubject}>
            + Subject
          </button>
        </div>
        <div className="chips wrap">
          {state.subjects
            .filter((s) => !s.arch)
            .map((sub) => {
              const subMs = getTodaySubjectMs(state, sub.id, sel, todayKey);
              const goalPct = sub.dailyGoalMins
                ? Math.min(100, Math.round((subMs / 60000 / sub.dailyGoalMins) * 100))
                : 0;
              return (
                <button
                  type="button"
                  key={sub.id}
                  style={{ borderLeft: `4px solid ${sub.color}` }}
                  onClick={() => onQuickStartSubject(sub.id)}
                >
                  {sub.e} {sub.name} · <span className="mono">{fmtHMShort(subMs)}</span> (
                  {goalPct}%)
                </button>
              );
            })}
        </div>
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
