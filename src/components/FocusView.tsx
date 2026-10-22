import React, { useEffect, useState } from 'react';
import type { ActiveTimerMode, PulseHabitState, SoundscapeMode } from '../types';
import {
  fmtClockTime,
  fmtHMS,
  fmtHMShort,
  fmtMS,
  getHeadingColor,
  getSessionHeading,
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
  onSwitchHeading: (heading: string) => void;
  onSetMode: (mode: ActiveTimerMode) => void;
  onStartTimer: (heading: string, mode: ActiveTimerMode, customTargetMins?: number) => void;
  onExtendTarget?: (extraMins: number) => void;
  onTogglePause: () => void;
  onTogglePomoPhase: () => void;
  onStopAndReflect: () => void;
  onOpenTimerConfig: () => void;
  onSetSoundscape: (mode: SoundscapeMode) => void;
  onSetSoundVolume: (vol: number) => void;
  onAddTodo: (text: string) => void;
  onToggleTodo: (todoId: string) => void;
  onDeleteTodo: (todoId: string) => void;
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
  onSwitchHeading,
  onSetMode,
  onStartTimer,
  onExtendTarget,
  onTogglePause,
  onTogglePomoPhase,
  onStopAndReflect,
  onOpenTimerConfig,
  onSetSoundscape,
  onSetSoundVolume,
  onAddTodo,
  onToggleTodo,
  onDeleteTodo,
  onOpenManualSession,
  onEditSession,
}) => {
  const t = state.activeTimer;
  const m = getTimerMetrics(state);

  const [sessionHeading, setSessionHeading] = useState<string>(
    t?.heading || 'Deep Study Session'
  );
  const [todoInput, setTodoInput] = useState('');
  const [selectedMode, setSelectedMode] = useState<ActiveTimerMode>(
    t?.mode || state.set.defaultMode || 'pomo'
  );
  const [customCountdownMins, setCustomCountdownMins] = useState<number>(
    state.set.countdownMins || 45
  );

  useEffect(() => {
    if (t?.heading) {
      setSessionHeading(t.heading);
    }
  }, [t?.heading]);

  useEffect(() => {
    if (t?.mode) {
      setSelectedMode(t.mode);
    } else if (state.set.defaultMode) {
      setSelectedMode(state.set.defaultMode);
    }
  }, [t?.mode, state.set.defaultMode]);

  useEffect(() => {
    if (state.set.countdownMins) {
      setCustomCountdownMins(state.set.countdownMins);
    }
  }, [state.set.countdownMins]);

  const mode: ActiveTimerMode = t ? t.mode : selectedMode;
  const activeHeading = (t?.heading || sessionHeading || 'Deep Study Session').trim();
  const accentColor = getHeadingColor(activeHeading);

  // Keyboard shortcut: Space to pause/resume when not typing in an input
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') {
        return;
      }
      e.preventDefault();
      if (t) {
        onTogglePause();
      } else {
        onStartTimer(
          sessionHeading.trim() || 'Deep Study Session',
          mode,
          mode === 'countdown' ? customCountdownMins : undefined
        );
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [customCountdownMins, mode, onStartTimer, onTogglePause, sessionHeading, t]);

  const clockVal = m
    ? fmtHMS(m.overtimeMs > 0 ? m.totalActiveMs : m.displayMs)
    : mode === 'pomo'
      ? fmtHMS((state.set.pomoWork || 25) * 60000)
      : mode === 'countdown'
        ? fmtHMS(customCountdownMins * 60000)
        : '00:00:00';

  // Unique recent headings for quick reuse
  const recentHeadings = Array.from(
    new Set(
      state.sessions
        .slice()
        .reverse()
        .map((s) => getSessionHeading(state, s))
        .filter(Boolean)
    )
  ).slice(0, 6);

  const todos = state.todos || [];

  const handleTodoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = todoInput.trim();
    if (!trimmed) return;
    onAddTodo(trimmed);
    setTodoInput('');
  };

  const handleHeadingApply = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = sessionHeading.trim() || 'Deep Study Session';
    setSessionHeading(clean);
    if (t) {
      onSwitchHeading(clean);
    }
  };

  const progressPct = m ? Math.min(100, Math.max(2, m.progressPct)) : 0;

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

      {/* Manual Session Heading Input + Mid-Session Slice Switcher */}
      <div className="card hide-desk" style={{ padding: '12px 14px' }}>
        <form onSubmit={handleHeadingApply}>
          <label style={{ marginTop: 0 }}>
            Session Heading (What are you studying right now?)
            <div className="row" style={{ marginTop: '6px', gap: '8px' }}>
              <input
                type="text"
                id="sessionHeadingInput"
                value={sessionHeading}
                onChange={(e) => setSessionHeading(e.target.value)}
                placeholder="e.g., Lecture 7 — B-Tree Indexing & Practice..."
                maxLength={90}
              />
              {t && sessionHeading.trim() && sessionHeading.trim() !== t.heading && (
                <button type="submit" className="s pri" style={{ whiteSpace: 'nowrap' }}>
                  Switch Topic
                </button>
              )}
            </div>
          </label>
        </form>
        {recentHeadings.length > 0 && (
          <div style={{ marginTop: '8px' }}>
            <small style={{ display: 'block', marginBottom: '5px', fontSize: '11px' }}>
              Recent session headings (tap to use{t ? ' & slice' : ''}):
            </small>
            <div className="chips wrap" style={{ paddingBottom: 0 }}>
              {recentHeadings.map((hName) => {
                const col = getHeadingColor(hName);
                const isCur = activeHeading.toLowerCase() === hName.toLowerCase();
                return (
                  <button
                    type="button"
                    key={hName}
                    className={`sub-chip ${isCur ? 'active' : ''}`}
                    style={{ '--sc': col, padding: '5px 10px', fontSize: '12px' } as React.CSSProperties}
                    onClick={() => {
                      setSessionHeading(hName);
                      if (t) onSwitchHeading(hName);
                    }}
                  >
                    <i className="dot" style={{ '--sc': col } as React.CSSProperties} />
                    {hName}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div
        className={`card timer-shell ${m ? m.status : ''}`}
        style={{ '--sc': accentColor } as React.CSSProperties}
      >
        <div className="row sp" style={{ marginBottom: '6px' }}>
          <span className="pill" style={{ borderColor: accentColor }}>
            <i className="dot" style={{ '--sc': accentColor } as React.CSSProperties} />
            ⚡ {activeHeading.slice(0, 32)}
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

        {/* Mode Tabs: Pomodoro, Countdown, Stopwatch */}
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
              onClick={() => {
                setSelectedMode(k);
                onSetMode(k);
              }}
            >
              {lbl}
            </button>
          ))}
        </div>

        {/* Quick Countdown Duration Presets when idle in Countdown mode */}
        {!t && mode === 'countdown' && (
          <div
            className="chips wrap"
            style={{ justifyContent: 'center', margin: '2px 0 4px', gap: '6px' }}
          >
            {[25, 45, 60, 90, 120].map((mins) => (
              <button
                type="button"
                key={mins}
                className={customCountdownMins === mins ? 'on' : ''}
                style={{ padding: '4px 10px', fontSize: '12px' }}
                onClick={() => setCustomCountdownMins(mins)}
              >
                {mins}m
              </button>
            ))}
          </div>
        )}

        <div className="big-clock" id="liveClock">
          {clockVal}
        </div>

        {/* Live Session Progress Bar */}
        {m && (
          <div style={{ width: '100%', maxWidth: '340px', margin: '2px auto 6px' }}>
            <div className="bar" style={{ height: '7px' }}>
              <i
                style={{
                  width: `${progressPct}%`,
                  background:
                    m.status === 'paused'
                      ? 'var(--am)'
                      : m.overtimeMs > 0
                        ? 'var(--em)'
                        : accentColor,
                }}
              />
            </div>
          </div>
        )}

        {m && m.overtimeMs > 0 && (
          <div id="liveOvertime" className="overtime-tag">
            FLOW OVERTIME +{fmtMS(m.overtimeMs)}
          </div>
        )}

        <div className="purity-bar">
          <span>
            Mode: <b style={{ textTransform: 'uppercase' }}>{mode}</b>
          </span>
          <span>
            Focus Purity: <b id="livePurity">{m ? m.purity : 100}%</b>
          </span>
          <span>
            Studied Today:{' '}
            <b id="liveTodaySub">
              {fmtHMShort(getTodaySubjectMs(state, 'any', todayKey, todayKey))}
            </b>
          </span>
        </div>

        {/* Quick Target Boost (+5m / +15m) during active Pomodoro or Countdown */}
        {t && t.mode !== 'stopwatch' && onExtendTarget && (
          <div
            className="row"
            style={{ justifyContent: 'center', gap: '8px', marginTop: '4px' }}
          >
            <small className="mu" style={{ fontSize: '11px' }}>
              Target: {Math.round((t.targetMs || 0) / 60000)}m
            </small>
            <button
              type="button"
              className="s"
              style={{ padding: '4px 9px', fontSize: '11px' }}
              onClick={() => onExtendTarget(5)}
            >
              +5m
            </button>
            <button
              type="button"
              className="s"
              style={{ padding: '4px 9px', fontSize: '11px' }}
              onClick={() => onExtendTarget(15)}
            >
              +15m
            </button>
          </div>
        )}

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
              onClick={() =>
                onStartTimer(
                  sessionHeading.trim() || 'Deep Study Session',
                  mode,
                  mode === 'countdown' ? customCountdownMins : undefined
                )
              }
            >
              ▶ Start {mode === 'stopwatch' ? 'Stopwatch' : mode === 'countdown' ? 'Countdown' : 'Pomodoro'}
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
          style={{ justifyContent: 'center', marginTop: '10px', gap: '8px', flexWrap: 'wrap' }}
        >
          <button type="button" className="s" onClick={onOpenPiP}>
            📲 Pop-out Floating Lecture PiP
          </button>
          <button type="button" className="s" onClick={onOpenManualSession}>
            + Log Manual Hours
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

      {/* Session Action Checklist */}
      <div className="card hide-desk">
        <div className="row sp">
          <h3>✅ Study Session Checklist</h3>
          <small>{todos.filter((x) => x.done).length}/{todos.length} done</small>
        </div>
        <form onSubmit={handleTodoSubmit} className="row" style={{ margin: '8px 0' }}>
          <input
            name="txt"
            value={todoInput}
            onChange={(e) => setTodoInput(e.target.value)}
            placeholder="Add action item or goal for this session..."
            maxLength={80}
            required
          />
          <button type="submit" className="pri" aria-label="Add checklist item">
            +
          </button>
        </form>
        <div>
          {todos.length ? (
            todos.map((td) => (
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
                    onChange={() => onToggleTodo(td.id)}
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
                  aria-label={`Delete task ${td.text}`}
                  onClick={() => onDeleteTodo(td.id)}
                >
                  ×
                </button>
              </div>
            ))
          ) : (
            <small className="mu">No study tasks in your checklist yet.</small>
          )}
        </div>
      </div>

      {/* Today's Logged Sessions & Retroactive Editor */}
      <div className="card hide-desk">
        <div className="row sp" style={{ marginBottom: '8px' }}>
          <h3>Today&apos;s Logged Sessions ({sel})</h3>
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
              const heading = getSessionHeading(state, s);
              const col = getHeadingColor(heading);
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
                        style={{ '--sc': col } as React.CSSProperties}
                      />{' '}
                      {heading} ·{' '}
                      <span className="mono" style={{ color: 'var(--em)' }}>
                        {fmtHMShort(s.activeMs)}
                      </span>
                    </b>
                    <small style={{ display: 'block' }}>
                      {fmtClockTime(s.startTs)} – {fmtClockTime(s.endTs)} · {s.mode.toUpperCase()} · Purity{' '}
                      {s.purity ?? 100}% · {'★'.repeat(s.rating || 5)}
                    </small>
                    {s.note && (
                      <small style={{ display: 'block', color: 'var(--tx)', marginTop: '2px' }}>
                        What I did: “{s.note}”
                      </small>
                    )}
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
