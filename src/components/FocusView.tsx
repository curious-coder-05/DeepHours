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
  ChevronDown,
  Clock,
} from 'lucide-react';
import type {
  ActiveTimerMode,
  PulseHabitState,
  SoundscapeMode,
  StudySession,
  TimerAesthetic,
} from '../types';
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
import {
  BarChart,
  Button,
  Card,
  Chip,
  EmptyState,
  Meter,
  Segmented,
  Select,
  Sheet,
  WindowedList,
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
  const [showAllTodaySessions, setShowAllTodaySessions] = useState<boolean>(false);
  const [topicSheetOpen, setTopicSheetOpen] = useState<boolean>(false);
  const [breatheCue, setBreatheCue] = useState<string | null>(null);

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
  const effectiveChapId = subjectChapters.some((ch) => ch.id === selectedChapterId)
    ? selectedChapterId
    : '';
  const curChapter = subjectChapters.find((ch) => ch.id === effectiveChapId);

  const curMode: ActiveTimerMode = t?.mode || state.set.defaultMode || 'pomo';
  const isStopwatch = curMode === 'stopwatch';
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
    isStopwatch || displayMs >= 3600000 ? fmtHMS(displayMs) : fmtMS(displayMs);

  const todaySubMs = getTodaySubjectMs(state, curSubject.id, todayKey, true);
  const todaySessions = useMemo(
    () =>
      [...state.sessions.filter((s) => s.dayKey === todayKey)].sort(
        (a, b) => b.startTs - a.startTs
      ),
    [state.sessions, todayKey]
  );

  const completedPomodorosToday = useMemo(
    () => todaySessions.filter((s) => s.mode === 'pomo').length,
    [todaySessions]
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

  const totalElapsedSec = Math.floor((m ? m.totalActiveMs : 0) / 1000);
  const secAngle = (totalElapsedSec % 60) * 6;
  const minAngle = (((m ? m.totalActiveMs : 0) / 60000) % 60) * 6;
  const targetMinAngle =
    t && t.targetMs ? ((t.targetMs / 60000) % 60) * 6 : null;

  const activeHeadingDisplay = t
    ? t.heading || `${curSubject.name} Study`
    : headingInput.trim() || curChapter?.name || `${curSubject.name} Study`;

  const targetMins = t
    ? t.targetMs > 0
      ? +(t.targetMs / 60000).toFixed(1)
      : 0
    : +(defaultIdleMs / 60000).toFixed(1);
  const elapsedMins = m ? +(m.totalActiveMs / 60000).toFixed(1) : 0;
  const progressRatio =
    targetMins > 0 ? Math.min(100, Math.round((elapsedMins / targetMins) * 100)) : 0;

  // Stopwatch milestone helper (15-min milestones)
  const stopwatchActiveMs = m ? m.totalActiveMs : 0;
  const stopwatchMilestonesHit = Math.floor(stopwatchActiveMs / 900000);
  const stopwatchNextMilestoneMs = (stopwatchMilestonesHit + 1) * 900000;
  const stopwatchRemainingToMilestone = Math.max(0, stopwatchNextMilestoneMs - stopwatchActiveMs);

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

  const show3dCore = !deskMode && state.set.ui3d !== 'off';

  return (
    <div>
      {/* 1. Non-Wrapping Mode Switcher */}
      <div className="hide-desk" style={{ marginBottom: 14 }}>
        <Segmented
          aria-label="Timer mode"
          value={curMode}
          onChange={onSetMode}
          options={TIMER_MODES}
        />
      </div>

      {/* 2. Primary Focus Core Hero Card */}
      <div
        className={`card timer-shell aesthetic-${aesthetic} ${
          m ? (m.status === 'running' ? 'running' : 'paused') : ''
        }`}
        style={{ padding: deskMode ? '28px 18px' : '16px 16px 20px' }}
      >
        {/* Top Row: Status Pill + Interactive Subject/Topic Chip + Clock Style */}
        <div
          className="split"
          style={{
            gap: 8,
            flexWrap: 'wrap',
            marginBottom: 8,
            position: 'relative',
            zIndex: 3,
          }}
        >
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', minWidth: 0, flex: '1 1 200px' }}>
            <span
              className={`status-pill ${
                m ? (m.status === 'running' ? 'run' : 'pau') : 'idle'
              }`}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
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

            <button
              type="button"
              onClick={() => setTopicSheetOpen(true)}
              aria-label={`Change study subject or topic. Current: ${curSubject.name}${
                curChapter ? `, ${curChapter.name}` : ''
              }`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                minHeight: 38,
                padding: '5px 12px',
                borderRadius: 99,
                background: 'color-mix(in srgb, var(--sf-2) 86%, transparent)',
                border: '1px solid var(--line-strong, var(--line))',
                color: 'var(--tx)',
                fontSize: 13,
                fontWeight: 600,
                maxWidth: '100%',
              }}
            >
              <span
                aria-hidden="true"
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
                {activeHeadingDisplay && activeHeadingDisplay !== `${curSubject.name} Study`
                  ? ` · ${activeHeadingDisplay}`
                  : ''}
              </span>
              <ChevronDown size={14} strokeWidth={2} style={{ color: 'var(--tx-2)', flexShrink: 0 }} />
            </button>
          </div>

          <span
            className="pill hide-desk"
            style={{
              background: 'var(--sf-2)',
              color: 'var(--tx-2)',
              fontSize: 13,
              padding: '4px 10px',
            }}
          >
            {TIMER_STYLE_LABELS[aesthetic]}
          </span>
        </div>

        {/* Countdown Quick Presets when idle */}
        {curMode === 'countdown' && !t && (
          <div
            className="dh-scroll-chips hide-desk"
            style={{
              justifyContent: 'center',
              marginTop: 4,
              position: 'relative',
              zIndex: 3,
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

        {/* Full Mock Exam Info */}
        {curMode === 'fullMock' && !t && (
          <div style={{ marginTop: 4, fontSize: 13, color: 'var(--tx-2)', position: 'relative', zIndex: 3 }}>
            Exam simulation ({state.set.fullMockMins || 180} mins) · Record section splits cleanly
          </div>
        )}

        {/* Interactive Full-Bleed 3D Focus Core Stage + Layered Large Clock */}
        <div
          style={{
            position: 'relative',
            minHeight: show3dCore ? 320 : undefined,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '4px 0',
          }}
        >
          {show3dCore && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 0,
                opacity: aesthetic === 'retro' ? 0.42 : 0.94,
              }}
            >
              <FocusOrbitScene
                ui3dSetting={state.set.ui3d || 'auto'}
                ui3dQuality={state.set.ui3dQuality || 'auto'}
                deskMode={deskMode}
                priority="stage"
                hapticsEnabled={Boolean(state.set.snd)}
                status={m ? m.status : 'idle'}
                mode={curMode}
                phase={m ? m.phase : 'work'}
                subjectColor={curSubject.color}
                subjectName={curSubject.name}
                progressPct={m ? m.progressPct : 0}
                totalActiveMs={m ? m.totalActiveMs : 0}
                overtimeMs={m ? m.overtimeMs : 0}
                completedPomodorosToday={completedPomodorosToday}
                onBreatheStateChange={setBreatheCue}
              />
            </div>
          )}

          {/* Non-blocking Clock Overlay so Canvas Drag/Tap/Hold works seamlessly */}
          <div
            style={{
              position: 'relative',
              zIndex: 2,
              pointerEvents: 'none',
              padding: show3dCore ? '20px 30px' : '0 8px',
              borderRadius: show3dCore ? '999px' : undefined,
              background: show3dCore
                ? 'radial-gradient(ellipse at center, color-mix(in srgb, var(--bg) 78%, transparent) 0%, color-mix(in srgb, var(--bg) 44%, transparent) 52%, transparent 76%)'
                : undefined,
            }}
          >
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
                      fontSize="13"
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

            {breatheCue && (
              <div
                role="status"
                style={{
                  display: 'inline-block',
                  marginTop: 6,
                  padding: '4px 12px',
                  borderRadius: 99,
                  background: 'var(--ac-soft)',
                  border: '1px solid var(--ac-bd)',
                  color: 'var(--ac-ink)',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                Breathe: {breatheCue}
              </div>
            )}
          </div>

          {show3dCore && !breatheCue && (
            <div
              className="hide-desk"
              style={{
                position: 'absolute',
                bottom: 4,
                left: 8,
                right: 8,
                zIndex: 2,
                pointerEvents: 'none',
                textAlign: 'center',
                fontSize: 13,
                color: 'var(--tx-2)',
              }}
            >
              Drag to spin · Hold to breathe · {completedPomodorosToday} orb
              {completedPomodorosToday === 1 ? '' : 's'} today
            </div>
          )}
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

        {/* Target Meter (Hidden cleanly in Stopwatch mode) */}
        {!isStopwatch ? (
          <div style={{ maxWidth: 380, margin: '8px auto 12px' }}>
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
            {t && (
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
        ) : (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 12,
              background: 'var(--sf-2)',
              border: '1px solid var(--line)',
              fontSize: 13,
              color: 'var(--tx-2)',
              margin: '6px auto 12px',
            }}
          >
            <Clock size={14} strokeWidth={1.75} style={{ color: 'var(--ac-ink)' }} />
            {t ? (
              <span className="tabular-nums">
                {stopwatchMilestonesHit > 0
                  ? `${stopwatchMilestonesHit} × 15m milestone${
                      stopwatchMilestonesHit === 1 ? '' : 's'
                    } · next in ${fmtMS(stopwatchRemainingToMilestone)}`
                  : `Open-ended count · 15m milestone in ${fmtMS(stopwatchRemainingToMilestone)}`}
              </span>
            ) : (
              <span>Open-ended count · stop and log any time</span>
            )}
          </div>
        )}

        {/* Full Mock Section Splits */}
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
                    fontSize: 13,
                    padding: '3px 10px',
                    background: 'var(--sf-2)',
                    color: 'var(--tx)',
                    border: '1px solid var(--line)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {sec.label || sec.name || `Section ${idx + 1}`}: {fmtHMS(sec.elapsedMs)}
                </span>
              ))}
            </div>
          )}

        {/* Prominent 56px Primary Transport CTA + Companion Controls */}
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
              size="xl"
              icon={
                t.status === 'running' ? (
                  <Pause size={20} strokeWidth={2} />
                ) : (
                  <Play size={20} strokeWidth={2} />
                )
              }
              onClick={onTogglePause}
              style={{ minWidth: 184 }}
            >
              {t.status === 'running' ? 'Pause session' : 'Resume session'}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="xl"
              icon={<Play size={20} strokeWidth={2} />}
              onClick={() =>
                onStartTimer(
                  effectiveSubId,
                  headingInput,
                  curMode,
                  undefined,
                  effectiveChapId || undefined
                )
              }
              style={{ minWidth: 196 }}
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
              Stop &amp; log
            </Button>
          )}
        </div>

        {/* Compact Icon Action Row (Durations, Desk Mode, PiP, Topic Sheet, Log Hours) */}
        <div
          className="row hide-desk"
          style={{
            justifyContent: 'center',
            gap: 8,
            flexWrap: 'wrap',
            marginBottom: 10,
          }}
        >
          <Button
            variant="ghost"
            size="sm"
            icon={<SlidersHorizontal size={15} strokeWidth={1.75} />}
            onClick={onOpenTimerConfig}
          >
            Durations
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Maximize2 size={15} strokeWidth={1.75} />}
            onClick={onToggleDeskMode}
          >
            Desk mode
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<PictureInPicture2 size={15} strokeWidth={1.75} />}
            onClick={onOpenPiP}
          >
            Float PiP
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Edit3 size={15} strokeWidth={1.75} />}
            onClick={() => setTopicSheetOpen(true)}
          >
            Topic
          </Button>
        </div>

        {/* Custom SVG Session vs Target Chart (Hidden cleanly in Stopwatch mode) */}
        {!isStopwatch && (
          <div
            aria-label="Current study session duration vs target chart"
            style={{
              maxWidth: 400,
              margin: '4px auto 12px',
              padding: '10px 14px',
              borderRadius: 12,
              background: 'var(--sf-2)',
              border: '1px solid var(--line)',
              textAlign: 'left',
            }}
          >
            <BarChart
              orientation="horizontal"
              height={46}
              goalValue={targetMins}
              goalLabel={`${targetMins}m`}
              valueFormatter={(v) => `${v}m`}
              ariaLabel="Session duration vs target"
              data={[
                {
                  label: 'Session vs target',
                  value: elapsedMins,
                  hint: `${progressRatio}%`,
                  color:
                    m?.phase === 'break'
                      ? 'var(--info)'
                      : m && m.overtimeMs > 0
                        ? 'var(--ok)'
                        : curSubject.color || 'var(--ac)',
                },
              ]}
            />
          </div>
        )}

        {/* Motivational Quote Bar while timer is active */}
        {m && (
          <div id="focusMotivationalQuote" className="focus-quote-bar">
            <span className="focus-quote-text">
              &ldquo;{getStudyQuoteForTimer(t?.startTs || 0, m.totalActiveMs, quoteOffset)}&rdquo;
            </span>
            <button
              type="button"
              className="s focus-quote-next"
              title="Next quote"
              aria-label="Next quote"
              onClick={() => setQuoteOffset((n) => n + 1)}
            >
              <RotateCw size={14} strokeWidth={1.75} />
            </button>
          </div>
        )}

        {/* Purity & Today's Subject Total */}
        <div className="purity-bar" style={{ marginBottom: 4 }}>
          <span>
            Focus purity <b id="livePurity">{m ? m.purity : 100}%</b>
          </span>
          <span>·</span>
          <span>
            Today {curSubject.name} <b id="liveTodaySub">{fmtHMShort(todaySubMs)}</b>
          </span>
        </div>

        {/* Desk Mode Controls */}
        {deskMode && (
          <div
            className="row"
            style={{ justifyContent: 'center', gap: 8, marginTop: 12 }}
          >
            <Button
              variant="secondary"
              size="md"
              icon={<PictureInPicture2 size={15} strokeWidth={1.75} />}
              onClick={onOpenPiP}
            >
              Floating timer (PiP)
            </Button>
            <Button
              variant="secondary"
              size="md"
              icon={<Minimize2 size={15} strokeWidth={1.75} />}
              onClick={onToggleDeskMode}
            >
              Exit desk mode
            </Button>
          </div>
        )}
      </div>

      {/* 3. Focus Sounds Card */}
      <Card className="hide-desk">
        <div className="split" style={{ marginBottom: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            {state.set.soundscape === 'off' ? (
              <VolumeX size={18} strokeWidth={1.75} style={{ color: 'var(--tx-2)' }} />
            ) : (
              <Volume2 size={18} strokeWidth={1.75} style={{ color: 'var(--ac-ink)' }} />
            )}
            <div>
              <h3 style={{ margin: 0, fontSize: 18 }}>Focus sounds</h3>
              <small style={{ fontSize: 13 }}>
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
                fontSize: 13,
                padding: '2px 10px',
              }}
            >
              Active
            </span>
          )}
        </div>

        <div
          className="dh-scroll-chips"
          style={{
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
            <small style={{ fontSize: 13, minWidth: 52 }}>Volume</small>
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
                width: 42,
                textAlign: 'right',
                fontSize: 13,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {Math.round((state.set.soundVol || 0.35) * 100)}%
            </small>
          </div>
        )}
      </Card>

      {/* 4. Session Checklist Card */}
      <Card className="hide-desk">
        <div className="split" style={{ marginBottom: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            <ListChecks size={18} strokeWidth={1.75} style={{ color: 'var(--ac-ink)' }} />
            <h3 style={{ margin: 0, fontSize: 18 }}>Session checklist</h3>
          </div>
          <small style={{ fontSize: 13 }}>
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
            aria-label="New session checklist micro-goal"
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
                    className={`dh-task-check ${td.done ? 'checked' : ''}`}
                    style={{ width: 26, height: 26, minWidth: 26, minHeight: 26 }}
                  >
                    {td.done ? <Check size={14} strokeWidth={2.25} /> : null}
                  </span>
                  <span className={`dh-task-title ${td.done ? 'done' : ''}`}>
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

      {/* 5. Today's Logged Sessions */}
      <Card className="hide-desk">
        <div className="split" style={{ marginBottom: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            <BookOpen size={18} strokeWidth={1.75} style={{ color: 'var(--ac-ink)' }} />
            <h3 style={{ margin: 0, fontSize: 18 }}>
              Today&apos;s sessions ({todaySessions.length})
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
            Log hours
          </Button>
        </div>

        {todaySessions.length === 0 ? (
          <EmptyState
            illustration="noSessions"
            compact
            title="No sessions logged today"
            description="Start the focus core above or log completed study hours manually."
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <WindowedList
              items={
                showAllTodaySessions || todaySessions.length <= 10
                  ? todaySessions
                  : todaySessions.slice(0, 10)
              }
              threshold={100}
              estimatedRowHeight={72}
              itemLabel="sessions"
              style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
              getKey={(ses: StudySession) => ses.id}
              renderItem={(ses: StudySession) => {
                const sSub = getSubject(state, ses.subjectId);
                const heading = getSessionHeading(state, ses);
                return (
                  <div
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
                            fontSize: 13,
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
                          fontSize: 13,
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {sSub.name} · {fmtClockTime(ses.startTs)} – {fmtClockTime(ses.endTs)} ·{' '}
                        {ses.purity || 100}% purity
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
              }}
            />
            {todaySessions.length > 10 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAllTodaySessions((v) => !v)}
              >
                {showAllTodaySessions
                  ? 'Show recent 10 only'
                  : `Show all ${todaySessions.length} sessions`}
              </Button>
            )}
          </div>
        )}
      </Card>

      {/* Subject, Chapter & Topic Sheet */}
      <Sheet
        open={topicSheetOpen}
        onClose={() => setTopicSheetOpen(false)}
        title="Subject & topic"
        subtitle={
          t
            ? 'Switching saves your current study slice and starts the new topic seamlessly'
            : 'Choose what you are studying for this focus block'
        }
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--tx-2)', marginBottom: 8 }}>
            Subject
          </div>
          <div className="dh-scroll-chips">
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
        </div>

        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--tx-2)', marginBottom: 8 }}>
            Syllabus chapter
          </div>
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
                onSwitchTopic(effectiveSubId, nextHeading, nextChapId || undefined);
              }
            }}
            placeholder="General subject study"
          />
        </div>

        <div>
          <label
            htmlFor="sessionHeadingInput"
            style={{
              display: 'block',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--tx-2)',
              marginBottom: 8,
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
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (t) {
                    onSwitchTopic(effectiveSubId, headingInput, effectiveChapId || undefined);
                  }
                  setTopicSheetOpen(false);
                }
              }}
              style={{ flex: '1 1 220px', minHeight: 44, fontSize: 14 }}
            />
            <Button
              variant="primary"
              size="md"
              onClick={() => {
                if (t) {
                  onSwitchTopic(effectiveSubId, headingInput, effectiveChapId || undefined);
                }
                setTopicSheetOpen(false);
              }}
            >
              {t ? 'Apply switch' : 'Done'}
            </Button>
          </div>

          {recentHeadings.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, color: 'var(--tx-3)', marginBottom: 6 }}>
                Recent topics
              </div>
              <div className="dh-scroll-chips">
                {recentHeadings.map((h) => (
                  <Chip
                    key={`${h.subjectId}_${h.heading}`}
                    selected={headingInput === h.heading}
                    onClick={() => {
                      setSelectedSubjectId(h.subjectId);
                      setHeadingInput(h.heading);
                      if (t) {
                        onSwitchTopic(h.subjectId, h.heading, effectiveChapId || undefined);
                      }
                    }}
                  >
                    {h.heading}
                  </Chip>
                ))}
              </div>
            </div>
          )}
        </div>
      </Sheet>
    </div>
  );
};
