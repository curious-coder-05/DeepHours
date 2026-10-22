import React, { useState } from 'react';
import type { PulseHabitState, SoundscapeMode } from '../types';
import {
  fmtClockTime,
  fmtHMS,
  fmtHMShort,
  fmtMS,
  getSubject,
  getTimerMetrics,
  getTodaySubjectMs,
} from '../utils/studyLogic';

interface FocusViewProps {
  state: PulseHabitState;
  sel: string;
  todayKey: string;
  deskMode: boolean;
  onToggleDeskMode: () => void;
  onOpenPiP: () => void;
  onSelectSubject: (subjectId: string) => void;
  onSetMode: (mode: 'pomo' | 'countdown' | 'stopwatch') => void;
  onStartTimer: (subjectId: string) => void;
  onTogglePause: () => void;
  onTogglePomoPhase: () => void;
  onStopAndReflect: () => void;
  onOpenTimerConfig: () => void;
  onSetSoundscape: (mode: SoundscapeMode) => void;
  onSetSoundVolume: (vol: number) => void;
  onEditSubject: (subjectId: string) => void;
  onAddTodo: (subjectId: string, text: string) => void;
  onToggleTodo: (subjectId: string, todoId: string) => void;
  onDeleteTodo: (subjectId: string, todoId: string) => void;
  onOpenManualSession: () => void;
  onEditSession: (sessionId: string) => void;
}

export const FocusView: React.FC<FocusViewProps> = ({
  state,
  sel,
  todayKey,
  deskMode,
  onToggleDeskMode,
  onOpenPiP,
  onSelectSubject,
  onSetMode,
  onStartTimer,
  onTogglePause,
  onTogglePomoPhase,
  onStopAndReflect,
  onOpenTimerConfig,
  onSetSoundscape,
  onSetSoundVolume,
  onEditSubject,
  onAddTodo,
  onToggleTodo,
  onDeleteTodo,
  onOpenManualSession,
  onEditSession,
}) => {
  const [todoInput, setTodoInput] = useState('');
  const [selectedMode, setSelectedMode] = useState<'pomo' | 'countdown' | 'stopwatch'>(
    state.activeTimer?.mode || 'pomo'
  );

  const t = state.activeTimer;
  const m = getTimerMetrics(state);
  const activeSubId = t
    ? t.subjectId
    : state.subjects.find((x) => !x.arch)?.id || state.subjects[0].id;
  const sub = getSubject(state, activeSubId);
  const mode = t ? t.mode : selectedMode;

  const clockVal = m
    ? fmtHMS(m.overtimeMs > 0 ? m.totalActiveMs : m.displayMs)
    : mode === 'pomo'
      ? fmtHMS((state.set.pomoWork || 25) * 60000)
      : mode === 'countdown'
        ? fmtHMS((state.set.countdownMins || 45) * 60000)
        : '00:00:00';

  const handleTodoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = todoInput.trim();
    if (!trimmed) return;
    onAddTodo(sub.id, trimmed);
    setTodoInput('');
  };

  return (
    <div>
      <div className="row sp hide-desk" style={{ marginBottom: '6px' }}>
        <h2>Study Timer &amp; Lecture PiP</h2>
        <div className="row">
          <button
            type="button"
            className="s"
            onClick={onToggleDeskMode}
            title="Fullscreen Flip-Clock + Wake Lock"
          >
            🖥️ Desk Mode
          </button>
          <button
            type="button"
            className="s pri"
            onClick={onOpenPiP}
            title="Launch Floating PiP Overlay"
          >
            🖼️ Float PiP
          </button>
        </div>
      </div>

      {/* Active Subject Switcher (Supports Mid-Session Switching) */}
      <div className="chips wrap hide-desk" style={{ marginBottom: '8px' }}>
        {state.subjects
          .filter((s) => !s.arch)
          .map((s) => (
            <button
              type="button"
              key={s.id}
              className={`sub-chip ${s.id === activeSubId ? 'active' : ''}`}
              style={{ '--sc': s.color } as React.CSSProperties}
              onClick={() => onSelectSubject(s.id)}
            >
              <i className="dot" style={{ '--sc': s.color } as React.CSSProperties} />
              {s.e} {s.name}
            </button>
          ))}
      </div>

      <div
        className={`card timer-shell ${m ? m.status : ''}`}
        style={{ '--sc': sub.color } as React.CSSProperties}
      >
        <div className="row sp" style={{ marginBottom: '6px' }}>
          <span className="pill" style={{ borderColor: sub.color }}>
            <i className="dot" style={{ '--sc': sub.color } as React.CSSProperties} />
            {sub.e} {sub.name}
          </span>
          <span
            className={`status-pill ${
              m?.status === 'running' ? 'run' : m?.status === 'paused' ? 'pau' : 'idle'
            }`}
          >
            {m?.status === 'running'
              ? m.phase === 'break'
                ? '☕ BREAK'
                : '● STUDYING'
              : m?.status === 'paused'
                ? '⏸ PAUSED'
                : 'READY'}
          </span>
        </div>

        {/* Mode Tabs */}
        <div className="chips wrap" style={{ justifyContent: 'center', margin: '6px 0' }}>
          {(
            [
              ['pomo', '🍅 Pomodoro'],
              ['countdown', '⏳ Countdown'],
              ['stopwatch', '⏱️ Stopwatch'],
            ] as const
          ).map(([k, lbl]) => (
            <button
              type="button"
              key={k}
              className={mode === k ? 'on' : ''}
              disabled={!!t}
              onClick={() => {
                setSelectedMode(k);
                onSetMode(k);
              }}
            >
              {lbl}
            </button>
          ))}
        </div>

        <div className="big-clock" id="liveClock">
          {clockVal}
        </div>
        {m && m.overtimeMs > 0 && (
          <div id="liveOvertime" className="overtime-tag">
            FLOW OVERTIME +{fmtMS(m.overtimeMs)}
          </div>
        )}

        <div className="purity-bar">
          <span>
            Focus Purity: <b id="livePurity">{m ? m.purity : 100}%</b>
          </span>
          <span>
            Pauses: <b>{m ? m.pauseCount : 0}</b>
          </span>
          <span>
            Subject Today:{' '}
            <b id="liveTodaySub">
              {fmtHMShort(getTodaySubjectMs(state, sub.id, todayKey, todayKey))}
            </b>
          </span>
        </div>

        {/* Primary Controls */}
        <div
          className="row"
          style={{ justifyContent: 'center', gap: '10px', marginTop: '8px' }}
        >
          {!t ? (
            <button
              type="button"
              className="em-btn g"
              style={{ padding: '14px', fontSize: '16px' }}
              onClick={() => onStartTimer(sub.id)}
            >
              ▶ Start Session
            </button>
          ) : (
            <>
              <button
                type="button"
                className={`${t.status === 'running' ? 'am-btn' : 'em-btn'} g`}
                style={{ padding: '14px', fontSize: '16px' }}
                onClick={onTogglePause}
              >
                {t.status === 'running' ? '⏸ Pause' : '▶ Resume'}
              </button>
              {t.mode === 'pomo' && (
                <button
                  type="button"
                  className="s"
                  style={{ padding: '14px' }}
                  onClick={onTogglePomoPhase}
                >
                  {t.phase === 'work' ? '☕ Break' : '🔥 Work'}
                </button>
              )}
              <button
                type="button"
                className="dg-btn"
                style={{ padding: '14px 18px' }}
                onClick={onStopAndReflect}
              >
                ⏹ Stop &amp; Log
              </button>
            </>
          )}
        </div>

        <div
          className="row"
          style={{ justifyContent: 'center', marginTop: '10px', gap: '8px' }}
        >
          <button type="button" className="s" onClick={onOpenPiP}>
            📲 Pop-out Floating Lecture PiP
          </button>
          {deskMode ? (
            <button type="button" className="s" onClick={onToggleDeskMode}>
              Exit Desk Mode
            </button>
          ) : (
            <button type="button" className="s" onClick={onOpenTimerConfig}>
              ⚙️ Durations
            </button>
          )}
        </div>
      </div>

      {/* Procedural Web Audio Soundscapes */}
      <div className="card hide-desk">
        <div className="row sp">
          <div>
            <h3>🎧 Procedural Focus Soundscape</h3>
            <small>Auto-pauses when study timer pauses · Plays in PiP stream</small>
          </div>
        </div>
        <div className="chips wrap" style={{ marginTop: '8px' }}>
          {(
            [
              ['off', '🔇 Off'],
              ['brown', '🌊 Brown Noise'],
              ['pink', '🍃 Pink Noise'],
              ['rain', '🌧️ Soft Rain'],
            ] as const
          ).map(([k, lbl]) => (
            <button
              type="button"
              key={k}
              className={state.set.soundscape === k ? 'on' : ''}
              onClick={() => onSetSoundscape(k)}
            >
              {lbl}
            </button>
          ))}
        </div>
        {state.set.soundscape !== 'off' && (
          <div className="row" style={{ marginTop: '8px' }}>
            <small>Volume</small>
            <input
              type="range"
              min="0.05"
              max="0.9"
              step="0.05"
              aria-label="Soundscape Volume"
              value={state.set.soundVol ?? 0.35}
              onChange={(e) => onSetSoundVolume(Number(e.target.value))}
            />
          </div>
        )}
      </div>

      {/* Subject To-Do Checklist */}
      <div className="card hide-desk">
        <div className="row sp">
          <h3>
            {sub.e} {sub.name} · Sub-Tasks
          </h3>
          <button type="button" className="s" onClick={() => onEditSubject(sub.id)}>
            Edit Subject
          </button>
        </div>
        <form onSubmit={handleTodoSubmit} className="row" style={{ margin: '8px 0' }}>
          <input
            name="txt"
            value={todoInput}
            onChange={(e) => setTodoInput(e.target.value)}
            placeholder="Add topic, lecture, or problem set..."
            maxLength={80}
            required
          />
          <button type="submit" className="pri" aria-label="Add sub-task">
            +
          </button>
        </form>
        <div>
          {(sub.todos || []).length ? (
            (sub.todos || []).map((td) => (
              <div
                key={td.id}
                className="row sp"
                style={{ padding: '6px 0', borderBottom: '1px solid var(--bd)' }}
              >
                <label className="row g" style={{ cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    style={{ width: '18px', height: '18px' }}
                    checked={td.done}
                    onChange={() => onToggleTodo(sub.id, td.id)}
                  />
                  <span
                    style={
                      td.done
                        ? { textDecoration: 'line-through', color: 'var(--mu)' }
                        : undefined
                    }
                  >
                    {td.text}
                  </span>
                </label>
                <button
                  type="button"
                  className="s dg"
                  aria-label={`Delete sub-task ${td.text}`}
                  onClick={() => onDeleteTodo(sub.id, td.id)}
                >
                  ×
                </button>
              </div>
            ))
          ) : (
            <small className="mu">No sub-tasks yet for this subject.</small>
          )}
        </div>
      </div>

      {/* Today's Logged Sessions & Retroactive Editor */}
      <div className="card hide-desk">
        <div className="row sp" style={{ marginBottom: '8px' }}>
          <h3>Today&apos;s Sessions ({sel})</h3>
          <button type="button" className="s pri" onClick={onOpenManualSession}>
            + Manual Entry
          </button>
        </div>
        {state.sessions.filter((s) => s.dayKey === sel).length ? (
          state.sessions
            .filter((s) => s.dayKey === sel)
            .slice()
            .reverse()
            .map((s) => {
              const sbj = getSubject(state, s.subjectId);
              return (
                <div
                  key={s.id}
                  className="row sp"
                  style={{ padding: '8px 0', borderBottom: '1px solid var(--bd)' }}
                >
                  <div className="g">
                    <b>
                      <i
                        className="dot"
                        style={{ '--sc': sbj.color } as React.CSSProperties}
                      />{' '}
                      {sbj.e} {sbj.name} ·{' '}
                      <span className="mono">{fmtHMShort(s.activeMs)}</span>
                    </b>
                    <small>
                      {fmtClockTime(s.startTs)} – {fmtClockTime(s.endTs)} · Purity{' '}
                      {s.purity ?? 100}% · {'★'.repeat(s.rating || 5)}
                      {s.note ? ` · ${s.note}` : ''}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="s"
                    onClick={() => onEditSession(s.id)}
                  >
                    Edit
                  </button>
                </div>
              );
            })
        ) : (
          <small className="mu">No study sessions logged on this day yet.</small>
        )}
      </div>
    </div>
  );
};
