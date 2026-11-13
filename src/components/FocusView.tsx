import React, { useEffect, useMemo, useState } from 'react';
import {
  Play,
  Pause,
  Square,
  Coffee,
  Zap,
  SkipForward,
  Maximize2,
  Minimize2,
  PictureInPicture2,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  Plus,
  Check,
  Trash2,
  RotateCw,
  Edit3,
  BookOpen,
  ListChecks,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ReferenceLine,
  Tooltip,
  Cell,
} from 'recharts';
import type {
  ActiveTimerMode,
  PulseHabitState,
  SoundscapeMode,
  StudySession,
  TimerAesthetic,
} from '../types';
import {
  computeStudySummary,
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
import { CHART_THEME } from '../utils/uiHelpers';
import {
  Button,
  Card,
  Chip,
  Segmented,
  Select,
  Meter,
} from './ui';
import { FocusOrbitScene } from './three/FocusOrbitScene';

export interface FocusViewProps {
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
    mode?: ActiveTimerMode,
    customTargetMins?: number,
    chapterId?: string
  ) => void;
  onNextMockSection?: () => void;
  onExtendTarget: (extraMins: number) => void;
  onTogglePause: () => void;
  onTogglePomoPhase: () => void;
  onStopAndReflect: () => void;
  onOpenTimerConfig: () => void;
  onSetSoundscape: (mode: SoundscapeMode) => void;
  onSetSoundVolume: (vol: number) => void;
  onAddTodo: (text: string) => void;
  onToggleTodo: (todoId: string) => void;
  onDeleteTodo: (todoId: string) => void;
  onOpenManualSession: (defaultSubjectId?: string, defaultChapterId?: string) => void;
  onEditSession: (sesId: string) => void;
}

const TIMER_MODES: Array<{ value: ActiveTimerMode; label: string }> = [
  { value: 'pomo', label: 'Pomodoro' },
  { value: 'countdown', label: 'Countdown' },
  { value: 'stopwatch', label: 'Stopwatch' },
  { value: 'fullMock', label: 'Full mock' },
];

const TIMER_STYLE_LABELS: Record<TimerAesthetic, string> = {
  neon: 'Digital',
  minimal: 'Mono',
  retro: 'Analog',
};

const SOUNDSCAPE_ITEMS: Array<[SoundscapeMode, string]> = [
  ['off', 'Off'],
  ['brown', 'Brown noise'],
  ['pink', 'Pink noise'],
  ['rain', 'Soft rain'],
];

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
  onNextMockSection,
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
  const activeSubjects = useMemo(
    () => state.subjects.filter((s) => !s.arch),
    [state.subjects]
  );

  const [selectedSubjectId, setSelectedSubjectId] = useState<string>(
    t?.subjectId || activeSubjects[0]?.id || 'sub_phy'
  );
  const [selectedChapterId, setSelectedChapterId] = useState<string>(
    t?.chapterId || ''
  );
  const [headingInput, setHeadingInput] = useState<string>(t?.heading || '');
  const [newTodoText, setNewTodoText] = useState<string>('');
  const [quoteOffset, setQuoteOffset] = useState<number>(0);

  // Sync local inputs when activeTimer changes
  useEffect(() => {
    if (t?.subjectId) setSelectedSubjectId(t.subjectId);
    if (t?.chapterId !== undefined) setSelectedChapterId(t.chapterId || '');
    if (t?.heading) setHeadingInput(t.heading);
  }, [t?.subjectId, t?.chapterId, t?.heading]);

  const effectiveSubId = activeSubjects.some((s) => s.id === selectedSubjectId)
    ? selectedSubjectId
    : activeSubjects[0]?.id || 'sub_phy';
  const curSubject = getSubject(state, effectiveSubId);

  const subjectChapters = useMemo(
    () => state.chapters.filter((ch) => ch.subjectId === effectiveSubId),
    [state.chapters, effectiveSubId]
  );
  const effectiveChapId = subjectChapters.some(
    (ch) => ch.id === selectedChapterId
  )
    ? selectedChapterId
    : '';
  const curChapter = subjectChapters.find((ch) => ch.id === effectiveChapId);

  const curMode: ActiveTimerMode = t?.mode || state.set.defaultMode || 'pomo';
  const aesthetic: TimerAesthetic = state.set.timerAesthetic || 'neon';
  const m = getTimerMetrics(state);

  const defaultIdleMs =
    curMode === 'pomo'
      ? (state.set.pomoWork || 25) * 60000
      : curMode === 'countdown'
        ? (state.set.countdownMins || 45) * 60000
        : curMode === 'fullMock'
          ? (state.set.fullMockMins || 180) * 60000
          : 0;

  const displayMs = m ? m.displayMs : defaultIdleMs;
  const clockStr =
    curMode === 'stopwatch' || displayMs >= 3600000
      ? fmtHMS(displayMs)
      : fmtMS(displayMs);

  const todaySubMs = getTodaySubjectMs(state, curSubject.id, todayKey, true);
  const todaySessions = useMemo(
    () =>
      [...state.sessions.filter((s) => s.dayKey === todayKey)].sort(
        (a, b) => b.startTs - a.startTs
      ),
    [state.sessions, todayKey]
  );
  const recentHeadings = useMemo(() => {
    const seen = new Set<string>();
    const list: Array<{ subjectId: string; heading: string }> = [];
    const sorted = [...state.sessions].sort((a, b) => b.startTs - a.startTs);
    for (const ses of sorted) {
      const h = (ses.heading || '').trim();
      if (!h) continue;
      const key = `${ses.subjectId}::${h}`;
      if (!seen.has(key)) {
        seen.add(key);
        list.push({ subjectId: ses.subjectId, heading: h });
        if (list.length >= 6) break;
      }
    }
    return list;
  }, [state.sessions]);

  // Analog Retro clock angles
  const totalElapsedSec = Math.floor((m ? m.totalActiveMs : 0) / 1000);
  const secAngle = (totalElapsedSec % 60) * 6;
  const minAngle = (((m ? m.totalActiveMs : 0) / 60000) % 60) * 6;
  const targetMinAngle =
    t && t.targetMs ? ((t.targetMs / 60000) % 60) * 6 : null;

  const activeHeadingDisplay = t
    ? t.heading || `${curSubject.name} Study`
    : headingInput.trim() || curChapter?.name || `${curSubject.name} Study`;

  // Session progress vs Target chart data (in minutes)
  const targetMins = t
    ? t.targetMs > 0
      ? +(t.targetMs / 60000).toFixed(1)
      : 60
    : +(defaultIdleMs / 60000).toFixed(1) || 60;
  const elapsedMins = m ? +(m.totalActiveMs / 60000).toFixed(1) : 0;
  const chartDomainMax = Math.max(targetMins, elapsedMins, 10);
  const sessionProgressData = [
    {
      name: 'Elapsed',
      minutes: elapsedMins,
      target: targetMins,
    },
  ];
  const progressRatio =
    targetMins > 0 ? Math.min(100, Math.round((elapsedMins / targetMins) * 100)) : 0;

  const chapterOptions = useMemo(
    () => [
      { value: '', label: 'General subject study (no specific chapter)' },
      ...subjectChapters.map((ch) => ({
        value: ch.id,
        label: `${ch.name} (${
          ch.status === 'completed'
            ? 'Done'
            : ch.status === 'inProgress'
              ? 'In progress'
              : 'Not started'
        })`,
      })),
    ],
    [subjectChapters]
  );

  const globalTodos = state.todos || [];

  const statusText = m
    ? m.phase === 'break'
      ? 'Break'
      : m.status === 'running'
        ? 'Studying'
        : 'Paused'
    : 'Ready';

  return (
    <div>
      {/* 1. Top Mode Selector & Studio Controls */}
      <div
        className="split hide-desk"
        style={{
          gap: 10,
          flexWrap: 'wrap',
          marginBottom: 14,
        }}
      >
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <Segmented
            aria-label="Timer mode"
            value={curMode}
            onChange={onSetMode}
            options={TIMER_MODES}
          />
        </div>

        <div className="row" style={{ gap: 8 }}>
          <Button
            variant="secondary"
            size="sm"
            icon={<SlidersHorizontal size={15} strokeWidth={1.75} />}
            onClick={onOpenTimerConfig}
          >
            Durations
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<Maximize2 size={15} strokeWidth={1.75} />}
            onClick={onToggleDeskMode}
          >
            {deskMode ? 'Exit desk' : 'Desk mode'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<PictureInPicture2 size={15} strokeWidth={1.75} />}
            onClick={onOpenPiP}
          >
            Float PiP
          </Button>
        </div>
      </div>

      {/* 2. Primary Timer Stage Card */}
      <div
        className={`card timer-shell aesthetic-${aesthetic} ${
          m ? (m.status === 'running' ? 'running' : 'paused') : ''
        }`}
      >
        {/* Top Row inside Stage: Status Pill + Active Subject/Chapter + Clock Style */}
        <div
          className="split"
          style={{
            gap: 8,
            flexWrap: 'wrap',
            marginBottom: 8,
          }}
        >
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span
              className={`status-pill ${
                m ? (m.status === 'running' ? 'run' : 'pau') : 'idle'
              }`}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: m
                    ? m.status === 'running'
                      ? 'var(--ok)'
                      : 'var(--warn)'
                    : 'var(--tx-3)',
                }}
              />
              {statusText}
            </span>

            <span
              className="pill"
              style={{
                background: 'var(--sf-2)',
                color: 'var(--tx)',
                border: '1px solid var(--line)',
                fontSize: 12,
                padding: '4px 10px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                maxWidth: '100%',
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: curSubject.color,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {curSubject.e} {curSubject.name}
                {curChapter ? ` · ${curChapter.name}` : ''}
                {activeHeadingDisplay ? ` · "${activeHeadingDisplay}"` : ''}
              </span>
            </span>
          </div>

          <span
            className="pill hide-desk"
            style={{
              background: 'var(--sf-2)',
              color: 'var(--tx-2)',
              fontSize: 12,
              padding: '4px 10px',
            }}
          >
            {TIMER_STYLE_LABELS[aesthetic]} clock
          </span>
        </div>

        {/* Countdown Presets when idle */}
        {curMode === 'countdown' && !t && (
          <div
            className="row hide-desk"
            style={{
              justifyContent: 'center',
              gap: 6,
              marginTop: 8,
              flexWrap: 'wrap',
            }}
          >
            {[25, 45, 60, 90, 120].map((mins) => (
              <Chip
                key={mins}
                selected={(state.set.countdownMins || 45) === mins}
                onClick={() =>
                  onStartTimer(
                    effectiveSubId,
                    headingInput,
                    'countdown',
                    mins,
                    effectiveChapId || undefined
                  )
                }
              >
                {mins}m
              </Chip>
            ))}
          </div>
        )}

        {/* Full Mock Exam Info when in fullMock mode */}
        {curMode === 'fullMock' && !t && (
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--tx-2)' }}>
            NEET 3-hour exam simulation ({state.set.fullMockMins || 180} mins) · Record
            section splits as you complete each section
          </div>
        )}

        {/* Clock Display + Centered 3D Focus Orbit Scene Behind Readout */}
        <div
          style={{
            position: 'relative',
            minHeight: !deskMode && state.set.ui3d !== 'off' ? 210 : undefined,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '4px 0',
          }}
        >
          {!deskMode && state.set.ui3d !== 'off' && (
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
                zIndex: 0,
                opacity: aesthetic === 'retro' ? 0.45 : 0.88,
              }}
            >
              <FocusOrbitScene
                ui3dSetting={state.set.ui3d || 'auto'}
                deskMode={deskMode}
                status={m ? m.status : 'idle'}
                mode={curMode}
                phase={m ? m.phase : 'work'}
                subjectColor={curSubject.color}
                progressPct={m ? m.progressPct : 0}
                totalActiveMs={m ? m.totalActiveMs : 0}
                overtimeMs={m ? m.overtimeMs : 0}
              />
            </div>
          )}

          <div style={{ position: 'relative', zIndex: 1 }}>
            {aesthetic === 'retro' ? (
              <div className="retro-clock-wrap">
                <svg
                  viewBox="0 0 220 220"
                  className="retro-dial-svg"
                  aria-label="Analog study timer"
                >
                  <circle
                    cx="110"
                    cy="110"
                    r="98"
                    fill="var(--sf-2)"
                    stroke="var(--line-strong)"
                    strokeWidth="3"
                  />
                  <circle
                    cx="110"
                    cy="110"
                    r="90"
                    fill="none"
                    stroke="var(--line)"
                    strokeWidth="1"
                  />
                  {Array.from({ length: 60 }).map((_, i) => {
                    const isMajor = i % 5 === 0;
                    return (
                      <line
                        key={i}
                        x1="110"
                        y1={isMajor ? '18' : '22'}
                        x2="110"
                        y2={isMajor ? '30' : '27'}
                        stroke={isMajor ? 'var(--tx)' : 'var(--tx-3)'}
                        strokeWidth={isMajor ? '2' : '1'}
                        strokeLinecap="round"
                        transform={`rotate(${i * 6} 110 110)`}
                      />
                    );
                  })}
                  {[
                    { label: '60', x: 110, y: 44 },
                    { label: '15', x: 176, y: 114 },
                    { label: '30', x: 110, y: 182 },
                    { label: '45', x: 44, y: 114 },
                  ].map((n) => (
                    <text
                      key={n.label}
                      x={n.x}
                      y={n.y}
                      textAnchor="middle"
                      fill="var(--tx-2)"
                      fontSize="12"
                      fontWeight="700"
                      fontFamily="var(--font-mono)"
                    >
                      {n.label}
                    </text>
                  ))}
                  {targetMinAngle !== null && (
                    <line
                      x1="110"
                      y1="110"
                      x2="110"
                      y2="34"
                      stroke="var(--ok)"
                      strokeWidth="2"
                      strokeDasharray="4 3"
                      transform={`rotate(${targetMinAngle} 110 110)`}
                    />
                  )}
                  <line
                    x1="110"
                    y1="120"
                    x2="110"
                    y2="46"
                    stroke="var(--tx)"
                    strokeWidth="4"
                    strokeLinecap="round"
                    transform={`rotate(${minAngle} 110 110)`}
                  />
                  <line
                    x1="110"
                    y1="126"
                    x2="110"
                    y2="30"
                    stroke="var(--ac)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    transform={`rotate(${secAngle} 110 110)`}
                  />
                  <circle cx="110" cy="110" r="6" fill="var(--ac)" />
                  <circle cx="110" cy="110" r="2.5" fill="var(--bg)" />
                </svg>
                <div className="retro-sub-readout" id="liveClock">
                  {clockStr}
                </div>
              </div>
            ) : (
              <div className="big-clock" id="liveClock">
                {clockStr}
              </div>
            )}
          </div>
        </div>

        {/* Overtime indicator */}
        <div
          id="liveOvertime"
          style={{ display: m && m.overtimeMs > 0 ? 'block' : 'none' }}
        >
          <span className="overtime-tag">
            Overtime +{m ? fmtMS(m.overtimeMs) : '00:00'}
          </span>
        </div>

        {/* Progress Meter & Quick Target Extension */}
        <div style={{ maxWidth: 360, margin: '8px auto 12px' }}>
          <Meter
            value={m ? m.progressPct : 0}
            color={
              m?.phase === 'break'
                ? 'var(--info)'
                : m && m.overtimeMs > 0
                  ? 'var(--ok)'
                  : 'var(--ac)'
            }
            label="Session progress"
          />
          {t && t.mode !== 'stopwatch' && (
            <div
              className="row"
              style={{ justifyContent: 'center', gap: 8, marginTop: 8 }}
            >
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onExtendTarget(5)}
              >
                +5m target
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onExtendTarget(15)}
              >
                +15m target
              </Button>
            </div>
          )}
        </div>

        {/* Full Mock Section Splits List */}
        {t?.mode === 'fullMock' &&
          t.mockSections &&
          t.mockSections.length > 0 && (
            <div
              className="row"
              style={{
                justifyContent: 'center',
                gap: 6,
                marginBottom: 10,
                flexWrap: 'wrap',
              }}
            >
              {t.mockSections.map((sec, idx) => (
                <span
                  key={idx}
                  className="pill"
                  style={{
                    fontSize: 12,
                    padding: '3px 9px',
                    background: 'var(--sf-2)',
                    color: 'var(--tx)',
                    border: '1px solid var(--line)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {sec.label || sec.name || `Section ${idx + 1}`}:{' '}
                  {fmtHMS(sec.elapsedMs)}
                </span>
              ))}
            </div>
          )}

        {/* Primary Transport Controls */}
        <div
          className="row"
          style={{
            justifyContent: 'center',
            gap: 10,
            marginBottom: 12,
            flexWrap: 'wrap',
          }}
        >
          {t ? (
            <Button
              variant="primary"
              size="lg"
              icon={
                t.status === 'running' ? (
                  <Pause size={18} strokeWidth={2} />
                ) : (
                  <Play size={18} strokeWidth={2} />
                )
              }
              onClick={onTogglePause}
              style={{ minWidth: 148 }}
            >
              {t.status === 'running' ? 'Pause' : 'Resume'}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="lg"
              icon={<Play size={18} strokeWidth={2} />}
              onClick={() =>
                onStartTimer(
                  effectiveSubId,
                  headingInput,
                  curMode,
                  undefined,
                  effectiveChapId || undefined
                )
              }
              style={{ minWidth: 148 }}
            >
              Start focus
            </Button>
          )}

          {curMode === 'pomo' && (
            <Button
              variant="secondary"
              size="lg"
              icon={
                t?.phase === 'break' ? (
                  <Zap size={17} strokeWidth={1.75} />
                ) : (
                  <Coffee size={17} strokeWidth={1.75} />
                )
              }
              onClick={onTogglePomoPhase}
            >
              {t?.phase === 'break' ? 'Work phase' : 'Break'}
            </Button>
          )}

          {t?.mode === 'fullMock' && onNextMockSection && (
            <Button
              variant="secondary"
              size="lg"
              icon={<SkipForward size={17} strokeWidth={1.75} />}
              onClick={onNextMockSection}
            >
              Next section
            </Button>
          )}

          {t && (
            <Button
              variant="danger"
              size="lg"
              icon={<Square size={16} strokeWidth={2} />}
              onClick={onStopAndReflect}
            >
              Stop & log
            </Button>
          )}
        </div>

        {/* Session Duration vs Target Recharts Visualization */}
        <div
          aria-label="Current study session duration vs target chart"
          style={{
            maxWidth: 380,
            margin: '4px auto 12px',
            padding: '10px 14px',
            borderRadius: 12,
            background: 'var(--sf-2)',
            border: '1px solid var(--line)',
          }}
        >
          <div
            className="split"
            style={{
              fontSize: 12,
              color: 'var(--tx-2)',
              marginBottom: 6,
            }}
          >
            <span>Session vs target</span>
            <span
              style={{
                fontWeight: 600,
                color: 'var(--tx)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {elapsedMins}m / {targetMins}m ({progressRatio}%)
            </span>
          </div>
          <div style={{ width: '100%', height: 48 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={sessionProgressData}
                layout="vertical"
                margin={{ top: 4, right: 10, left: 4, bottom: 4 }}
              >
                <XAxis type="number" domain={[0, chartDomainMax]} hide />
                <YAxis type="category" dataKey="name" hide />
                <Tooltip
                  cursor={{ fill: 'transparent' }}
                  contentStyle={CHART_THEME.tooltipStyle}
                  formatter={(value) => [`${Number(value ?? 0)} min`, 'Elapsed']}
                  labelFormatter={() => `Target: ${targetMins} min`}
                />
                <Bar
                  dataKey="minutes"
                  background={{ fill: 'var(--sf-3)', radius: 6 }}
                  radius={[6, 6, 6, 6]}
                  barSize={14}
                  isAnimationActive={false}
                >
                  <Cell
                    fill={
                      m?.phase === 'break'
                        ? 'var(--info)'
                        : m && m.overtimeMs > 0
                          ? 'var(--ok)'
                          : curSubject.color || 'var(--ac)'
                    }
                  />
                </Bar>
                {targetMins > 0 && (
                  <ReferenceLine
                    x={targetMins}
                    stroke="var(--ok)"
                    strokeWidth={2}
                    strokeDasharray="3 3"
                  />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Motivational Quote Bar while timer is active */}
        {m && (
          <div id="focusMotivationalQuote" className="focus-quote-bar">
            <span className="focus-quote-text">
              "{getStudyQuoteForTimer(t?.startTs || 0, m.totalActiveMs, quoteOffset)}"
            </span>
            <button
              type="button"
              className="s focus-quote-next"
              title="Next quote"
              aria-label="Next quote"
              onClick={() => setQuoteOffset((n) => n + 1)}
            >
              <RotateCw size={13} strokeWidth={1.75} />
            </button>
          </div>
        )}

        {/* Purity & Today's Subject Total Bar */}
        <div className="purity-bar" style={{ marginBottom: 4 }}>
          <span>
            Focus purity <b id="livePurity">{m ? m.purity : 100}%</b>
          </span>
          <span>·</span>
          <span>
            Today {curSubject.name}{' '}
            <b id="liveTodaySub">{fmtHMShort(todaySubMs)}</b>
          </span>
        </div>

        {/* Desk Mode Controls (only shown when top toolbar is hidden in Desk Mode) */}
        {deskMode && (
          <div
            className="row"
            style={{ justifyContent: 'center', gap: 8, marginTop: 8 }}
          >
            <Button
              variant="secondary"
              size="sm"
              icon={<PictureInPicture2 size={14} strokeWidth={1.75} />}
              onClick={onOpenPiP}
            >
              Floating timer (PiP)
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<Minimize2 size={14} strokeWidth={1.75} />}
              onClick={onToggleDeskMode}
            >
              Exit desk mode
            </Button>
          </div>
        )}
      </div>

      {/* 3. Topic, Subject & Chapter Switcher Card */}
      <Card className="hide-desk">
        <div className="split" style={{ marginBottom: 10 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16 }}>Subject & chapter</h3>
            <small style={{ fontSize: 12 }}>
              {t
                ? 'Tap another subject or chapter to auto-log current slice and switch immediately'
                : 'Select what you are studying for this session'}
            </small>
          </div>
        </div>

        {/* Subject Chips */}
        <div
          className="row"
          style={{
            gap: 6,
            overflowX: 'auto',
            paddingBottom: 8,
            scrollbarWidth: 'none',
          }}
        >
          {activeSubjects.map((s) => (
            <Chip
              key={s.id}
              selected={effectiveSubId === s.id}
              colorDot={s.color}
              onClick={() => {
                setSelectedSubjectId(s.id);
                setSelectedChapterId('');
                if (t) {
                  const nextHeading =
                    headingInput.trim() &&
                    headingInput.trim() !== `${curSubject.name} Study`
                      ? headingInput.trim()
                      : `${s.name} Study`;
                  setHeadingInput(nextHeading);
                  onSwitchTopic(s.id, nextHeading, undefined);
                }
              }}
            >
              {s.e} {s.name}
            </Chip>
          ))}
        </div>

        {/* Chapter Select Sheet Picker */}
        <div style={{ marginTop: 8 }}>
          <Select
            aria-label="Link syllabus chapter"
            title={`Link ${curSubject.name} chapter`}
            value={effectiveChapId}
            options={chapterOptions}
            onChange={(nextChapId) => {
              setSelectedChapterId(nextChapId);
              const chap = subjectChapters.find((c) => c.id === nextChapId);
              const nextHeading = chap
                ? chap.name
                : headingInput.trim() || `${curSubject.name} Study`;
              if (chap) setHeadingInput(chap.name);
              if (t) {
                onSwitchTopic(
                  effectiveSubId,
                  nextHeading,
                  nextChapId || undefined
                );
              }
            }}
            placeholder="General subject study"
          />
        </div>

        {/* Session Heading / Topic */}
        <div style={{ marginTop: 12 }}>
          <label
            htmlFor="sessionHeadingInput"
            style={{
              display: 'block',
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--tx-2)',
              marginBottom: 6,
            }}
          >
            Session topic or goal
          </label>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input
              id="sessionHeadingInput"
              type="text"
              placeholder="e.g., Rotational Mechanics PYQs, NCERT Ch 4..."
              value={headingInput}
              onChange={(e) => setHeadingInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && t) {
                  e.preventDefault();
                  onSwitchTopic(
                    effectiveSubId,
                    headingInput,
                    effectiveChapId || undefined
                  );
                }
              }}
              style={{ flex: '1 1 220px', minHeight: 44, fontSize: 14 }}
            />
            {t && headingInput.trim() && headingInput.trim() !== t.heading && (
              <Button
                variant="primary"
                size="sm"
                onClick={() =>
                  onSwitchTopic(
                    effectiveSubId,
                    headingInput,
                    effectiveChapId || undefined
                  )
                }
              >
                Switch topic
              </Button>
            )}
          </div>

          {recentHeadings.length > 0 && (
            <div
              className="row"
              style={{
                gap: 6,
                marginTop: 8,
                overflowX: 'auto',
                paddingBottom: 2,
                scrollbarWidth: 'none',
              }}
            >
              <span style={{ fontSize: 12, color: 'var(--tx-3)', flexShrink: 0 }}>
                Recent:
              </span>
              {recentHeadings.map((h) => (
                <Chip
                  key={`${h.subjectId}_${h.heading}`}
                  selected={headingInput === h.heading}
                  onClick={() => {
                    setSelectedSubjectId(h.subjectId);
                    setHeadingInput(h.heading);
                    if (t) {
                      onSwitchTopic(
                        h.subjectId,
                        h.heading,
                        effectiveChapId || undefined
                      );
                    }
                  }}
                >
                  {h.heading}
                </Chip>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* 4. Focus Sounds Card (Renamed from Procedural Focus Soundscape) */}
      <Card className="hide-desk">
        <div className="split" style={{ marginBottom: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            {state.set.soundscape === 'off' ? (
              <VolumeX size={18} strokeWidth={1.75} style={{ color: 'var(--tx-2)' }} />
            ) : (
              <Volume2 size={18} strokeWidth={1.75} style={{ color: 'var(--ac-ink)' }} />
            )}
            <div>
              <h3 style={{ margin: 0, fontSize: 16 }}>Focus sounds</h3>
              <small style={{ fontSize: 12 }}>
                Offline ambient audio while the timer runs
              </small>
            </div>
          </div>
          {state.set.soundscape !== 'off' && (
            <span
              className="pill"
              style={{
                background: 'color-mix(in srgb, var(--ok) 15%, transparent)',
                color: 'var(--ok-ink)',
                fontSize: 12,
                padding: '2px 8px',
              }}
            >
              Active
            </span>
          )}
        </div>

        <div
          className="row"
          style={{
            gap: 6,
            flexWrap: 'wrap',
            marginBottom: state.set.soundscape !== 'off' ? 12 : 0,
          }}
        >
          {SOUNDSCAPE_ITEMS.map(([k, lbl]) => (
            <Chip
              key={k}
              selected={state.set.soundscape === k}
              onClick={() => onSetSoundscape(k)}
            >
              {lbl}
            </Chip>
          ))}
        </div>

        {state.set.soundscape !== 'off' && (
          <div className="row" style={{ gap: 10 }}>
            <small style={{ fontSize: 12, minWidth: 52 }}>Volume</small>
            <input
              type="range"
              min="0.05"
              max="0.95"
              step="0.05"
              value={state.set.soundVol || 0.35}
              onChange={(e) => onSetSoundVolume(parseFloat(e.target.value))}
              aria-label="Focus sound volume"
              style={{ flex: 1, minHeight: 24, padding: 0 }}
            />
            <small
              style={{
                width: 38,
                textAlign: 'right',
                fontSize: 12,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {Math.round((state.set.soundVol || 0.35) * 100)}%
            </small>
          </div>
        )}
      </Card>

      {/* 5. Session Checklist Card */}
      <Card className="hide-desk">
        <div className="split" style={{ marginBottom: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            <ListChecks
              size={18}
              strokeWidth={1.75}
              style={{ color: 'var(--ac-ink)' }}
            />
            <h3 style={{ margin: 0, fontSize: 16 }}>Session checklist</h3>
          </div>
          <small style={{ fontSize: 12 }}>
            {globalTodos.filter((x) => x.done).length}/{globalTodos.length} done
          </small>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const clean = newTodoText.trim();
            if (!clean) return;
            onAddTodo(clean);
            setNewTodoText('');
          }}
          className="row"
          style={{ gap: 8, marginBottom: globalTodos.length > 0 ? 10 : 0 }}
        >
          <input
            type="text"
            placeholder="Add micro-goal (e.g., 30 rotational mechanics MCQs)..."
            value={newTodoText}
            onChange={(e) => setNewTodoText(e.target.value)}
            style={{ flex: 1, minHeight: 44, fontSize: 14 }}
          />
          <Button
            type="submit"
            variant="primary"
            size="md"
            icon={<Plus size={15} strokeWidth={2} />}
          >
            Add
          </Button>
        </form>

        {globalTodos.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {globalTodos.map((td) => (
              <div
                key={td.id}
                className="split"
                style={{
                  background: 'var(--sf-2)',
                  padding: '8px 12px',
                  borderRadius: 12,
                  border: '1px solid var(--line)',
                  gap: 10,
                }}
              >
                <button
                  type="button"
                  onClick={() => onToggleTodo(td.id)}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    textAlign: 'left',
                    cursor: 'pointer',
                    minHeight: 36,
                  }}
                >
                  <span
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 7,
                      display: 'grid',
                      placeItems: 'center',
                      background: td.done ? 'var(--ok)' : 'var(--sf-1)',
                      color: td.done ? 'var(--ok-on)' : 'transparent',
                      border: td.done ? 'none' : '1px solid var(--line)',
                      flexShrink: 0,
                    }}
                  >
                    <Check size={14} strokeWidth={2.25} />
                  </span>
                  <span
                    style={{
                      fontSize: 14,
                      textDecoration: td.done ? 'line-through' : 'none',
                      color: td.done ? 'var(--tx-2)' : 'var(--tx)',
                    }}
                  >
                    {td.text}
                  </span>
                </button>
                <button
                  type="button"
                  className="s"
                  aria-label={`Delete ${td.text}`}
                  style={{ color: 'var(--err-ink)', padding: '6px 8px' }}
                  onClick={() => onDeleteTodo(td.id)}
                >
                  <Trash2 size={14} strokeWidth={1.75} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 6. Today's Logged Sessions */}
      <Card className="hide-desk">
        <div className="split" style={{ marginBottom: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            <BookOpen
              size={18}
              strokeWidth={1.75}
              style={{ color: 'var(--ac-ink)' }}
            />
            <h3 style={{ margin: 0, fontSize: 16 }}>
              Today's sessions ({todaySessions.length})
            </h3>
          </div>
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus size={14} strokeWidth={2} />}
            onClick={() =>
              onOpenManualSession(effectiveSubId, effectiveChapId || undefined)
            }
          >
            Log manual hours
          </Button>
        </div>

        {todaySessions.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--tx-3)', padding: '4px 0' }}>
            Start the timer above or log past study hours manually.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {todaySessions.slice(0, 10).map((ses: StudySession) => {
              const sSub = getSubject(state, ses.subjectId);
              const heading = getSessionHeading(state, ses);
              return (
                <div
                  key={ses.id}
                  className="split"
                  style={{
                    background: 'var(--sf-2)',
                    padding: '10px 12px',
                    borderRadius: 12,
                    borderLeft: `3px solid ${sSub.color}`,
                    gap: 10,
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      <b
                        style={{
                          fontSize: 14,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {sSub.e} {heading}
                      </b>
                      <span
                        className="pill"
                        style={{
                          fontSize: 12,
                          padding: '1px 8px',
                          background: 'var(--sf-3)',
                          color: 'var(--tx)',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {fmtHMShort(ses.activeMs)}
                      </span>
                    </div>
                    <small
                      style={{
                        display: 'block',
                        marginTop: 3,
                        fontSize: 12,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {sSub.name} · {fmtClockTime(ses.startTs)} –{' '}
                      {fmtClockTime(ses.endTs)} · {ses.purity || 100}% purity
                      {ses.note ? ` · "${ses.note}"` : ''}
                    </small>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Edit3 size={13} strokeWidth={1.75} />}
                    onClick={() => onEditSession(ses.id)}
                  >
                    Edit
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
};
