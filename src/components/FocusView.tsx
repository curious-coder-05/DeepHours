import React, { useEffect, useState } from 'react';
import type { ActiveTimerMode, PulseHabitState, SoundscapeMode } from '../types';
import {
  fmtClockTime,
  fmtHMS,
  fmtHMShort,
  fmtMS,
  getSessionHeading,
  getStudyQuoteForTimer,
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
  onSwitchTopic: (subjectId: string, heading: string, chapterId?: string) => void;
  onSetMode: (mode: ActiveTimerMode) => void;
  onStartTimer: (
    subjectId: string,
    heading: string,
    mode: ActiveTimerMode,
    customTargetMins?: number,
    chapterId?: string
  ) => void;
  onExtendTarget?: (extraMins: number) => void;
  onTogglePause: () => void;
  onTogglePomoPhase: () => void;
  onNextMockSection?: () => void;
  onStopAndReflect: () => void;
  onOpenTimerConfig: () => void;
  onSetSoundscape: (mode: SoundscapeMode) => void;
  onSetSoundVolume: (vol: number) => void;
  onAddTodo: (text: string) => void;
  onToggleTodo: (todoId: string) => void;
  onDeleteTodo: (todoId: string) => void;
  onOpenManualSession: (defaultSubjectId?: string, defaultChapterId?: string) => void;
  onEditSession: (sessionId: string) => void;
}

export const FocusView: React.FC<FocusViewProps> = ({
  state,
  sel,
  todayKey,
  deskMode,
  onToggleDeskMode,
  onOpenPiP,
  onSwitchTopic,
  onSetMode,
  onStartTimer,
  onExtendTarget,
  onTogglePause,
  onTogglePomoPhase,
  onNextMockSection,
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
  const subjects = state.subjects.filter((s) => !s.arch);
  const defaultSubId = subjects[0]?.id || 'sub_phy';

  const [selectedSubjectId, setSelectedSubjectId] = useState<string>(
    t?.subjectId || defaultSubId
  );
  const [selectedChapterId, setSelectedChapterId] = useState<string>(
    t?.chapterId || ''
  );
  const [sessionHeading, setSessionHeading] = useState<string>(
    t?.heading || ''
  );
  const [todoInput, setTodoInput] = useState('');
  const [selectedMode, setSelectedMode] = useState<ActiveTimerMode>(
    t?.mode || state.set.defaultMode || 'pomo'
  );
  const [customCountdownMins, setCustomCountdownMins] = useState<number>(
    state.set.countdownMins || 45
  );
  const [quoteOffset, setQuoteOffset] = useState<number>(0);

  useEffect(() => {
    if (t?.subjectId) {
      setSelectedSubjectId(t.subjectId);
    }
  }, [t?.subjectId]);

  useEffect(() => {
    if (t?.chapterId !== undefined) {
      setSelectedChapterId(t.chapterId || '');
    }
  }, [t?.chapterId]);

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
  const activeSubject = getSubject(state, t ? t.subjectId : selectedSubjectId);
  const subjectChapters = state.chapters.filter(
    (ch) => ch.subjectId === (t ? t.subjectId : selectedSubjectId)
  );
  const selectedChapterObj = state.chapters.find(
    (ch) => ch.id === (t ? t.chapterId : selectedChapterId)
  );
  const activeHeading = (
    t?.heading ||
    sessionHeading ||
    (mode === 'fullMock' ? 'Full Mock' : selectedChapterObj?.name) ||
    `${activeSubject.name} Study Session`
  ).trim();
  const accentColor = activeSubject.color || '#3b82f6';

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
          selectedSubjectId,
          mode === 'fullMock'
            ? 'Full Mock'
            : sessionHeading.trim() ||
                selectedChapterObj?.name ||
                `${activeSubject.name} Study Session`,
          mode,
          mode === 'countdown'
            ? customCountdownMins
            : mode === 'fullMock'
              ? state.set.fullMockMins || 200
              : undefined,
          selectedChapterId || undefined
        );
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activeSubject.name,
    customCountdownMins,
    mode,
    onStartTimer,
    onTogglePause,
    selectedChapterId,
    selectedChapterObj?.name,
    selectedSubjectId,
    sessionHeading,
    state.set.fullMockMins,
    t,
  ]);

  const clockMs = m
    ? m.overtimeMs > 0
      ? m.totalActiveMs
      : m.displayMs
    : mode === 'pomo'
      ? (state.set.pomoWork || 25) * 60000
      : mode === 'countdown'
        ? customCountdownMins * 60000
        : mode === 'fullMock'
          ? (state.set.fullMockMins || 200) * 60000
          : 0;
  const clockVal = fmtHMS(clockMs);
  const aesthetic = state.set.timerAesthetic || 'neon';
  const totalSec = Math.max(0, Math.floor(clockMs / 1000));
  const secAngle = (totalSec % 60) * 6;
  const minAngle = ((totalSec / 60) % 60) * 6;
  const hrAngle = ((totalSec / 3600) % 12) * 30;

  // Unique recent sessions for quick reuse
  const recentTopics = Array.from(
    new Map(
      state.sessions
        .slice()
        .reverse()
        .map((s) => {
          const h = getSessionHeading(state, s);
          return [`${s.subjectId}::${h.toLowerCase()}`, { subjectId: s.subjectId, heading: h }];
        })
    ).values()
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
    const sub = getSubject(state, selectedSubjectId);
    const chap = selectedChapterId
      ? state.chapters.find((c) => c.id === selectedChapterId)
      : undefined;
    const clean =
      sessionHeading.trim() || chap?.name || `${sub.name} Study Session`;
    setSessionHeading(clean);
    if (t) {
      onSwitchTopic(selectedSubjectId, clean, selectedChapterId || undefined);
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

      {/* Subject Picker + Chapter Dropdown + Manual Session Heading Input + Mid-Session Slice Switcher */}
      <div className="card hide-desk" style={{ padding: '12px 14px' }}>
        <small style={{ display: 'block', marginBottom: '6px', fontWeight: 700 }}>
          Subject {t ? '(tap another subject to slice & switch)' : ''}:
        </small>
        <div className="chips wrap" style={{ marginBottom: '10px', paddingBottom: 0 }}>
          {subjects.map((sub) => {
            const isActive = (t ? t.subjectId : selectedSubjectId) === sub.id;
            return (
              <button
                type="button"
                key={sub.id}
                className={`sub-chip ${isActive ? 'active' : ''}`}
                style={{ '--sc': sub.color } as React.CSSProperties}
                onClick={() => {
                  setSelectedSubjectId(sub.id);
                  setSelectedChapterId('');
                  if (t && t.subjectId !== sub.id) {
                    const nextHeading =
                      sessionHeading.trim() &&
                      sessionHeading.trim() !== `${activeSubject.name} Study Session`
                        ? sessionHeading.trim()
                        : `${sub.name} Study Session`;
                    setSessionHeading(nextHeading);
                    onSwitchTopic(sub.id, nextHeading, undefined);
                  }
                }}
              >
                <i className="dot" style={{ '--sc': sub.color } as React.CSSProperties} />
                {sub.e} {sub.name}
              </button>
            );
          })}
        </div>

        {/* 1.1 Optional Chapter Dropdown Filtered by Selected Subject */}
        {subjectChapters.length > 0 && (
          <div style={{ marginBottom: '10px' }}>
            <label style={{ marginTop: 0, fontSize: '12px' }}>
              Link Syllabus Chapter (Optional)
              <select
                value={selectedChapterId}
                onChange={(e) => {
                  const nextChapId = e.target.value;
                  setSelectedChapterId(nextChapId);
                  const chap = state.chapters.find((c) => c.id === nextChapId);
                  if (chap && !sessionHeading.trim()) {
                    setSessionHeading(chap.name);
                  }
                  if (t) {
                    onSwitchTopic(
                      selectedSubjectId,
                      sessionHeading.trim() || chap?.name || `${activeSubject.name} Study Session`,
                      nextChapId || undefined
                    );
                  }
                }}
                style={{ marginTop: '4px' }}
              >
                <option value="">— None / General {activeSubject.name} —</option>
                {subjectChapters.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    {ch.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        <form onSubmit={handleHeadingApply}>
          <label style={{ marginTop: 0 }}>
            Session Heading (What are you studying right now?)
            <div className="row" style={{ marginTop: '6px', gap: '8px' }}>
              <input
                type="text"
                id="sessionHeadingInput"
                value={sessionHeading}
                onChange={(e) => setSessionHeading(e.target.value)}
                placeholder={`e.g., ${selectedChapterObj?.name || `${activeSubject.name} — NCERT & PYQs...`}`}
                maxLength={90}
              />
              {t &&
                ((sessionHeading.trim() && sessionHeading.trim() !== t.heading) ||
                  selectedSubjectId !== t.subjectId ||
                  (selectedChapterId || undefined) !== t.chapterId) && (
                  <button type="submit" className="s pri" style={{ whiteSpace: 'nowrap' }}>
                    Switch Topic
                  </button>
                )}
            </div>
          </label>
        </form>

        {recentTopics.length > 0 && (
          <div style={{ marginTop: '8px' }}>
            <small style={{ display: 'block', marginBottom: '5px', fontSize: '11px' }}>
              Recent session topics (tap to use{t ? ' & slice' : ''}):
            </small>
            <div className="chips wrap" style={{ paddingBottom: 0 }}>
              {recentTopics.map((item) => {
                const sub = getSubject(state, item.subjectId);
                const isCur =
                  activeHeading.toLowerCase() === item.heading.toLowerCase() &&
                  activeSubject.id === sub.id;
                return (
                  <button
                    type="button"
                    key={`${item.subjectId}::${item.heading}`}
                    className={`sub-chip ${isCur ? 'active' : ''}`}
                    style={
                      {
                        '--sc': sub.color,
                        padding: '5px 10px',
                        fontSize: '12px',
                      } as React.CSSProperties
                    }
                    onClick={() => {
                      setSelectedSubjectId(sub.id);
                      setSessionHeading(item.heading);
                      if (t) onSwitchTopic(sub.id, item.heading);
                    }}
                  >
                    <i className="dot" style={{ '--sc': sub.color } as React.CSSProperties} />
                    {sub.e} {item.heading}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div
        className={`card timer-shell aesthetic-${aesthetic} ${m ? m.status : ''}`}
        style={{ '--sc': accentColor } as React.CSSProperties}
      >
        <div className="row sp" style={{ marginBottom: '6px' }}>
          <span className="pill" style={{ borderColor: accentColor }}>
            <i className="dot" style={{ '--sc': accentColor } as React.CSSProperties} />
            {activeSubject.e} {activeSubject.name} · {activeHeading.slice(0, 26)}
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

        {/* Mode Tabs: Pomodoro, Countdown, Stopwatch, Full Mock (1.14) */}
        <div className="chips wrap" style={{ justifyContent: 'center', margin: '6px 0' }}>
          {(
            [
              ['pomo', '🍅 Pomodoro'],
              ['countdown', '⏳ Countdown'],
              ['stopwatch', '⏱️ Stopwatch'],
              ['fullMock', '📝 Full Mock'],
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

        {!t && mode === 'fullMock' && (
          <small
            style={{
              display: 'block',
              textAlign: 'center',
              color: '#a5b4fc',
              fontWeight: 700,
              marginBottom: '4px',
            }}
          >
            NEET Full Mock Exam Mode ({state.set.fullMockMins || 200}m countdown + section split tracker)
          </small>
        )}

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

        {aesthetic === 'retro' ? (
          <div className="retro-clock-wrap" aria-label="Analog Retro Clock Face">
            <svg
              className="retro-dial-svg"
              viewBox="0 0 180 180"
              role="img"
              aria-label={`Analog Retro Timer ${clockVal}`}
            >
              <defs>
                <radialGradient id="retroFaceGrad" cx="50%" cy="45%" r="55%">
                  <stop offset="0%" stopColor="#261f16" />
                  <stop offset="100%" stopColor="#120e0a" />
                </radialGradient>
              </defs>
              {/* Outer Gold/Amber Chronometer Bezel */}
              <circle
                cx="90"
                cy="90"
                r="84"
                fill="url(#retroFaceGrad)"
                stroke="#d97706"
                strokeWidth="3.5"
              />
              <circle
                cx="90"
                cy="90"
                r="78"
                fill="none"
                stroke="rgba(251, 191, 36, 0.25)"
                strokeWidth="1"
              />
              {/* 60 Minute/Second Ticks */}
              {Array.from({ length: 60 }, (_, idx) => {
                const isMajor = idx % 5 === 0;
                const deg = idx * 6;
                return (
                  <line
                    key={idx}
                    x1="90"
                    y1={isMajor ? '15' : '18'}
                    x2="90"
                    y2={isMajor ? '24' : '22'}
                    stroke={isMajor ? '#fbbf24' : 'rgba(251, 191, 36, 0.42)'}
                    strokeWidth={isMajor ? '2.2' : '1'}
                    strokeLinecap="round"
                    transform={`rotate(${deg} 90 90)`}
                  />
                );
              })}
              {/* Sub-label on dial */}
              <text
                x="90"
                y="62"
                textAnchor="middle"
                fill="rgba(251, 191, 36, 0.7)"
                fontSize="8.5"
                fontWeight="700"
                letterSpacing="1.4"
              >
                CHRONO · DEEP HOURS
              </text>
              {/* Hour Hand */}
              <line
                x1="90"
                y1="94"
                x2="90"
                y2="54"
                stroke="#f59e0b"
                strokeWidth="4"
                strokeLinecap="round"
                transform={`rotate(${hrAngle} 90 90)`}
              />
              {/* Minute Hand */}
              <line
                x1="90"
                y1="98"
                x2="90"
                y2="34"
                stroke="#fef3c7"
                strokeWidth="3"
                strokeLinecap="round"
                transform={`rotate(${minAngle} 90 90)`}
              />
              {/* Sweeping Second Hand */}
              <line
                x1="90"
                y1="104"
                x2="90"
                y2="26"
                stroke="#34d399"
                strokeWidth="1.6"
                strokeLinecap="round"
                transform={`rotate(${secAngle} 90 90)`}
              />
              {/* Center Cap */}
              <circle cx="90" cy="90" r="5" fill="#fbbf24" />
              <circle cx="90" cy="90" r="2" fill="#120e0a" />
            </svg>
            <div className="retro-sub-readout" id="liveClock">
              {clockVal}
            </div>
          </div>
        ) : (
          <div className="big-clock" id="liveClock">
            {clockVal}
          </div>
        )}

        {m && (
          <div style={{ width: '100%', maxWidth: '340px', margin: '2px auto 6px' }}>
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

        {t && m && m.status === 'running' && (
          <div
            id="focusMotivationalQuote"
            className="focus-quote-bar"
            role="status"
            aria-live="polite"
          >
            <span className="focus-quote-text">
              “{getStudyQuoteForTimer(t.startTs, m.totalActiveMs, quoteOffset)}”
            </span>
            <button
              type="button"
              className="focus-quote-next"
              aria-label="Next motivational study quote"
              title="Next study affirmation"
              onClick={() => setQuoteOffset((n) => n + 1)}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M13.5 8A5.5 5.5 0 1 1 11.8 4.1M13.5 2.5V6H10"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        )}

        <div className="purity-bar">
          <span>
            Subject: <b>{activeSubject.name}</b>
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

        {/* 1.14 Full Mock Recorded Section Splits */}
        {t && t.mode === 'fullMock' && Array.isArray(t.mockSections) && t.mockSections.length > 0 && (
          <div
            style={{
              margin: '6px auto',
              padding: '6px 10px',
              borderRadius: '10px',
              background: 'var(--c2)',
              display: 'flex',
              gap: '6px',
              flexWrap: 'wrap',
              justifyContent: 'center',
            }}
          >
            {t.mockSections.map((sec, i) => (
              <span
                key={i}
                className="pill mono"
                style={{ fontSize: '11px', padding: '2px 8px', borderColor: '#6366f1' }}
              >
                {sec.label}: {fmtMS(sec.elapsedMs)}
              </span>
            ))}
          </div>
        )}

        {/* Primary Controls */}
        <div
          className="row"
          style={{ justifyContent: 'center', gap: '10px', marginTop: '8px', flexWrap: 'wrap' }}
        >
          {!t ? (
            <button
              type="button"
              className="em-btn g"
              style={{ padding: '14px', fontSize: '16px' }}
              onClick={() =>
                onStartTimer(
                  selectedSubjectId,
                  mode === 'fullMock'
                    ? 'Full Mock'
                    : sessionHeading.trim() ||
                        selectedChapterObj?.name ||
                        `${activeSubject.name} Study Session`,
                  mode,
                  mode === 'countdown'
                    ? customCountdownMins
                    : mode === 'fullMock'
                      ? state.set.fullMockMins || 200
                      : undefined,
                  selectedChapterId || undefined
                )
              }
            >
              ▶ Start{' '}
              {mode === 'stopwatch'
                ? 'Stopwatch'
                : mode === 'countdown'
                  ? 'Countdown'
                  : mode === 'fullMock'
                    ? `Full Mock (${state.set.fullMockMins || 200}m)`
                    : 'Pomodoro'}
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
              {t.mode === 'fullMock' && onNextMockSection && (
                <button
                  type="button"
                  className="s pri"
                  style={{ padding: '14px' }}
                  onClick={onNextMockSection}
                >
                  ⏭ Next section
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
          <button
            type="button"
            className="s"
            onClick={() => onOpenManualSession(selectedSubjectId)}
          >
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
          <small>
            {todos.filter((x) => x.done).length}/{todos.length} done
          </small>
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
          <button
            type="button"
            className="s pri"
            onClick={() => onOpenManualSession(selectedSubjectId)}
          >
            + Manual Entry
          </button>
        </div>
        {state.sessions.filter((s) => s.dayKey === sel).length ? (
          state.sessions
            .filter((s) => s.dayKey === sel)
            .slice()
            .reverse()
            .map((s) => {
              const sub = getSubject(state, s.subjectId);
              const heading = getSessionHeading(state, s);
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
                        style={{ '--sc': sub.color } as React.CSSProperties}
                      />{' '}
                      {sub.e} {sub.name} · {heading} ·{' '}
                      <span className="mono" style={{ color: 'var(--em)' }}>
                        {fmtHMShort(s.activeMs)}
                      </span>
                    </b>
                    <small style={{ display: 'block' }}>
                      {fmtClockTime(s.startTs)} – {fmtClockTime(s.endTs)} ·{' '}
                      {s.mode.toUpperCase()} · Purity {s.purity ?? 100}% ·{' '}
                      {'★'.repeat(s.rating || 5)}
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
