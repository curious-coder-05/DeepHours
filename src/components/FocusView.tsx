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
  Lightbulb,
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
  getDayTotalStudyMs,
  getSessionHeading,
  getStudyQuoteForTimer,
  getSubject,
  getTimerMetrics,
  getTodaySubjectMs,
} from '../utils/studyLogic';
import { computeMinDayStreak } from '../utils/insights';
import { useTimerTick } from '../utils/timerTicker';
import { triggerHaptic } from '../utils/haptics';
import {
  AMBIENT_CHANNEL_META,
  AMBIENT_MIXER_EVENT,
  AMBIENT_PRESETS,
  applyAmbientPreset,
  formatAmbientMixSummary,
  hasActiveAmbientAudio,
  loadAmbientMixerState,
  saveAmbientMixerState,
  setAmbientChannelLevel,
  toggleAmbientMute,
  type AmbientChannelKey,
  type AmbientMixerState,
  type SelectableAmbientPresetId,
} from '../utils/ambientMixer';
import { ensureAudioEngine, syncAmbientMixer } from '../utils/audioEngine';
import {
  ALL_SUBJECTS_COLOR,
  ALL_SUBJECTS_LABEL,
  ALL_SUBJECTS_MOCK_ID,
  isAllSubjectsMockId,
  resolveSubjectOnModeSwitch,
} from '../utils/focusSessionHelpers';
import {
  formatProofDateLabel,
  type ProofCardPayload,
} from '../utils/proofCardCanvas';
import {
  acknowledgeOvertimeAlerts,
  clearActiveExamClockState,
  computeExamClockSnapshot,
  createInitialExamClockState,
  finishExamClock,
  loadActiveExamClockState,
  loadExamPaceRecords,
  pauseExamClock,
  playExamOvertimeAlert,
  resumeExamClock,
  saveActiveExamClockState,
  saveExamPaceRecord,
  startExamClock,
  switchExamSection,
  updateExamSectionConfig,
  type ExamClockState,
  type ExamPaceRecord,
  type ExamSectionId,
} from '../utils/examClock';
import type { ParkedThought } from '../utils/parkingLot';
import { BottomSheet } from './BottomSheet';
import { ExamClockView } from './ExamClockView';
import { ExamBleedSheet } from './ExamBleedSheet';
import { ParkingLotSheet } from './ParkingLotSheet';
import { StandByDeskOverlay } from './StandByDeskOverlay';
import {
  BarChart,
  Button,
  Card,
  Chip,
  EmptyState,
  Meter,
  Segmented,
  Select,
  WindowedList,
} from './ui';
import { FocusOrbitScene } from './three/FocusOrbitScene';

export interface FocusViewProps {
  state: PulseHabitState;
  sel: string;
  todayKey: string;
  deskMode: boolean;
  parkedThoughts: ParkedThought[];
  onToggleDeskMode: () => void;
  onSetDeskMode: (enabled: boolean) => void;
  onAddParkedThought: (text: string, meta?: { subjectId?: string; chapterId?: string }) => void;
  onRemoveParkedThought: (id: string) => void;
  onLogExamMockScore: (record: ExamPaceRecord) => void;
  onLogExamHallSession?: (record: ExamPaceRecord) => void;
  onExamHallPresenceChange?: (presence: { running: boolean; startedAt: number } | null) => void;
  onOpenProofCard?: (payload: ProofCardPayload) => void;
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

type FocusUiMode = ActiveTimerMode | 'examHall';

const FOCUS_UI_MODES: Array<{ value: FocusUiMode; label: string }> = [
  { value: 'pomo', label: 'Pomodoro' },
  { value: 'countdown', label: 'Countdown' },
  { value: 'stopwatch', label: 'Stopwatch' },
  { value: 'examHall', label: 'Exam Hall' },
  { value: 'fullMock', label: 'Full mock' },
];

const TIMER_STYLE_LABELS: Record<TimerAesthetic, string> = {
  neon: 'Digital',
  minimal: 'Mono',
  retro: 'Analog',
};

export const FocusView: React.FC<FocusViewProps> = ({
  state,
  todayKey,
  deskMode,
  parkedThoughts,
  onToggleDeskMode,
  onSetDeskMode,
  onAddParkedThought,
  onRemoveParkedThought,
  onLogExamMockScore,
  onLogExamHallSession,
  onExamHallPresenceChange,
  onOpenProofCard,
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
  onSetSoundscape: _legacySetSoundscape,
  onSetSoundVolume: _legacySetSoundVolume,
  onAddTodo,
  onToggleTodo,
  onDeleteTodo,
  onOpenManualSession,
  onEditSession,
}) => {
  void _legacySetSoundscape;
  void _legacySetSoundVolume;
  const t = state.activeTimer;
  const activeSubjects = useMemo(
    () => state.subjects.filter((s) => !s.arch),
    [state.subjects]
  );

  // v32: 3-fader Offline Ambient Sound Mixer (persisted strictly in localStorage)
  const [ambientMixer, setAmbientMixer] = useState<AmbientMixerState>(() =>
    loadAmbientMixerState()
  );
  const [mixerExpanded, setMixerExpanded] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onMixerEvent = (ev: Event) => {
      const custom = ev as CustomEvent<AmbientMixerState>;
      if (custom.detail) {
        setAmbientMixer(custom.detail);
      }
    };
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === 'dh_ambient_mixer_v1') {
        setAmbientMixer(loadAmbientMixerState());
      }
    };
    window.addEventListener(AMBIENT_MIXER_EVENT, onMixerEvent);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(AMBIENT_MIXER_EVENT, onMixerEvent);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const commitAmbientMixer = (next: AmbientMixerState) => {
    ensureAudioEngine();
    setAmbientMixer(next);
    saveAmbientMixerState(next);
    syncAmbientMixer(next, true);
  };

  const handleSelectAmbientPreset = (presetId: SelectableAmbientPresetId) => {
    triggerHaptic('tap');
    const next = applyAmbientPreset(ambientMixer, presetId);
    commitAmbientMixer(next);
  };

  const handleAmbientChannelChange = (key: AmbientChannelKey, value: number) => {
    const next = setAmbientChannelLevel(ambientMixer, key, value);
    commitAmbientMixer(next);
  };

  const handleToggleAmbientMute = () => {
    triggerHaptic('tap');
    const next = toggleAmbientMute(ambientMixer);
    commitAmbientMixer(next);
  };

  const [examState, setExamState] = useState<ExamClockState>(
    () => loadActiveExamClockState() || createInitialExamClockState()
  );
  const [paceRecords, setPaceRecords] = useState<ExamPaceRecord[]>(() =>
    loadExamPaceRecords()
  );
  const [bleedSheetRecord, setBleedSheetRecord] = useState<ExamPaceRecord | null>(null);
  const [examHallSelected, setExamHallSelected] = useState<boolean>(() => {
    const activeExam = loadActiveExamClockState();
    return Boolean(activeExam && (activeExam.status === 'running' || activeExam.status === 'paused'));
  });
  const [deskOverlayMode, setDeskOverlayMode] = useState<'focus' | 'exam'>('focus');
  const [parkingSheetOpen, setParkingSheetOpen] = useState<boolean>(false);

  const firstSingleSubjectId = activeSubjects[0]?.id || 'sub_phy';
  const [rememberedSingleSubjectId, setRememberedSingleSubjectId] = useState<string>(() => {
    if (t?.subjectId && !isAllSubjectsMockId(t.subjectId)) return t.subjectId;
    return firstSingleSubjectId;
  });

  const [selectedSubjectId, setSelectedSubjectId] = useState<string>(() => {
    if (t?.subjectId) return t.subjectId;
    if ((state.set.defaultMode || 'pomo') === 'fullMock') {
      return ALL_SUBJECTS_MOCK_ID;
    }
    return firstSingleSubjectId;
  });
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
    if (t?.subjectId) {
      setSelectedSubjectId(t.subjectId);
      if (!isAllSubjectsMockId(t.subjectId)) {
        setRememberedSingleSubjectId(t.subjectId);
      }
    }
    if (t?.chapterId !== undefined) setSelectedChapterId(t.chapterId || '');
    if (t?.heading) setHeadingInput(t.heading);
  }, [t?.subjectId, t?.chapterId, t?.heading]);

  // Persist active Exam Hall chess-clock state strictly in localStorage (zero Firestore writes)
  useEffect(() => {
    saveActiveExamClockState(examState);
  }, [examState]);

  // Bridge Exam Hall running state to App.tsx for Spark-quota-safe Live Co-Study Aura
  useEffect(() => {
    if (!onExamHallPresenceChange) return;
    if (examState.status === 'running' && examState.startedAt) {
      onExamHallPresenceChange({ running: true, startedAt: examState.startedAt });
    } else {
      onExamHallPresenceChange(null);
    }
  }, [examState.status, examState.startedAt, onExamHallPresenceChange]);

  // Single-fire overtime crossing monitor strictly while Exam Hall clock is running
  useEffect(() => {
    if (examState.status !== 'running') return;
    const checkOvertime = () => {
      const snap = computeExamClockSnapshot(examState, Date.now());
      if (snap.newlyOvertimeSectionIds.length > 0) {
        playExamOvertimeAlert(Boolean(state.set.snd));
        setExamState((prev) =>
          acknowledgeOvertimeAlerts(prev, snap.newlyOvertimeSectionIds)
        );
      }
    };
    checkOvertime();
    const id = setInterval(checkOvertime, 1000);
    return () => clearInterval(id);
  }, [examState, state.set.snd]);

  const handleUpdateExamSection = (
    sectionId: ExamSectionId,
    patch: { budgetMins?: number; enabled?: boolean }
  ) => {
    setExamState((prev) => updateExamSectionConfig(prev, sectionId, patch));
  };

  const handleStartExam = (initialSectionId: ExamSectionId) => {
    setExamState((prev) => startExamClock(prev, initialSectionId, Date.now()));
  };

  const handleSwitchExamSection = (sectionId: ExamSectionId) => {
    setExamState((prev) => switchExamSection(prev, sectionId, Date.now()));
  };

  const handleToggleExamPause = () => {
    setExamState((prev) =>
      prev.status === 'running'
        ? pauseExamClock(prev, Date.now())
        : resumeExamClock(prev, Date.now())
    );
  };

  const handleFinishExam = () => {
    const now = Date.now();
    const { record } = finishExamClock(examState, now);
    clearActiveExamClockState();
    const updatedRecords = saveExamPaceRecord(record);
    setPaceRecords(updatedRecords);
    setExamState(createInitialExamClockState(examState.sections));
    onSetDeskMode(false);
    onLogExamHallSession?.(record);
    setBleedSheetRecord(record);
  };

  const handleResetExamIdle = () => {
    clearActiveExamClockState();
    setExamState((prev) => createInitialExamClockState(prev.sections));
    if (deskOverlayMode === 'exam') {
      onSetDeskMode(false);
    }
  };

  const curMode: ActiveTimerMode = t?.mode || state.set.defaultMode || 'pomo';
  const isAllSubjectsSelected = isAllSubjectsMockId(selectedSubjectId);
  const effectiveSubId = isAllSubjectsSelected
    ? ALL_SUBJECTS_MOCK_ID
    : activeSubjects.some((s) => s.id === selectedSubjectId)
      ? selectedSubjectId
      : firstSingleSubjectId;
  const curSubject = isAllSubjectsSelected
    ? {
        id: ALL_SUBJECTS_MOCK_ID,
        name: ALL_SUBJECTS_LABEL,
        e: '📝',
        color: ALL_SUBJECTS_COLOR,
        dailyGoalMins: 0,
        arch: 0 as const,
        todos: [],
      }
    : getSubject(state, effectiveSubId);

  const subjectChapters = useMemo(
    () =>
      isAllSubjectsSelected
        ? []
        : state.chapters.filter((ch) => ch.subjectId === effectiveSubId),
    [state.chapters, effectiveSubId, isAllSubjectsSelected]
  );
  const effectiveChapId =
    !isAllSubjectsSelected && subjectChapters.some((ch) => ch.id === selectedChapterId)
      ? selectedChapterId
      : '';
  const curChapter = subjectChapters.find((ch) => ch.id === effectiveChapId);

  const isStopwatch = curMode === 'stopwatch';
  const aesthetic: TimerAesthetic = state.set.timerAesthetic || 'neon';
  useTimerTick(t?.status === 'running');
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
  const todayTotalMs =
    getDayTotalStudyMs(state, todayKey) +
    (t && m && t.phase !== 'break' ? m.sliceActiveMs : 0);
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
    ? t.heading || (isAllSubjectsSelected ? 'Full Mock' : `${curSubject.name} Study`)
    : headingInput.trim() ||
      curChapter?.name ||
      (isAllSubjectsSelected ? 'Full Mock' : `${curSubject.name} Study`);

  const activeSubjectPillText = isAllSubjectsSelected
    ? `${ALL_SUBJECTS_LABEL} · ${
        activeHeadingDisplay && activeHeadingDisplay !== `${ALL_SUBJECTS_LABEL} Study`
          ? activeHeadingDisplay
          : 'Full Mock'
      }`
    : `${curSubject.e} ${curSubject.name}${curChapter ? ` · ${curChapter.name}` : ''}${
        activeHeadingDisplay && activeHeadingDisplay !== `${curSubject.name} Study`
          ? ` · ${activeHeadingDisplay}`
          : curMode === 'fullMock'
            ? ' · Full Mock'
            : ''
      }`;

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

  const show3dCore = !deskMode && !examHallSelected && state.set.ui3d !== 'off';
  const activeUiMode: FocusUiMode = examHallSelected ? 'examHall' : curMode;

  return (
    <div>
      {/* 1. Non-Wrapping Mode Switcher (including Exam Hall Chess-Clock) */}
      <div className="hide-desk" style={{ marginBottom: 14 }}>
        <Segmented
          aria-label="Timer mode"
          value={activeUiMode}
          onChange={(nextMode: FocusUiMode) => {
            if (nextMode === 'examHall') {
              setExamHallSelected(true);
            } else {
              const prevMode = curMode;
              setExamHallSelected(false);
              if (!t) {
                const resolved = resolveSubjectOnModeSwitch({
                  prevMode,
                  nextMode,
                  currentSubjectId: effectiveSubId,
                  rememberedSingleSubjectId,
                  fallbackSubjectId: firstSingleSubjectId,
                });
                setSelectedSubjectId(resolved.nextSubjectId);
                setRememberedSingleSubjectId(resolved.nextRememberedSingleSubjectId);
                if (resolved.clearChapter) {
                  setSelectedChapterId('');
                }
                if (
                  nextMode === 'fullMock' &&
                  (!headingInput.trim() || headingInput.trim() === `${curSubject.name} Study`)
                ) {
                  setHeadingInput('');
                }
              }
              onSetMode(nextMode);
            }
          }}
          options={FOCUS_UI_MODES}
        />
      </div>

      {/* 2A. NEET 3-Hour Chess-Clock Exam Hall Mode */}
      {examHallSelected ? (
        <ExamClockView
          examState={examState}
          paceRecords={paceRecords}
          parkedCount={parkedThoughts.length}
          onUpdateSection={handleUpdateExamSection}
          onStartExam={handleStartExam}
          onSwitchSection={handleSwitchExamSection}
          onTogglePause={handleToggleExamPause}
          onFinishExam={handleFinishExam}
          onResetIdle={handleResetExamIdle}
          onOpenDeskMode={() => {
            setDeskOverlayMode('exam');
            onSetDeskMode(true);
          }}
          onOpenParkingLot={() => setParkingSheetOpen(true)}
          onInspectRecord={(rec) => setBleedSheetRecord(rec)}
        />
      ) : (
      /* 2B. Primary Focus Core Hero Card */
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
              aria-label={`Change study subject or topic. Current: ${activeSubjectPillText}`}
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
                {activeSubjectPillText}
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
            className="dh-edge-fade-rail hide-desk"
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
                onClick={() => {
                  triggerHaptic('tap');
                  onStartTimer(
                    effectiveSubId,
                    headingInput,
                    'countdown',
                    mins,
                    effectiveChapId || undefined
                  );
                }}
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
            minHeight: show3dCore ? 336 : undefined,
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
                opacity: aesthetic === 'retro' ? 0.42 : 1,
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
                height={336}
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
              padding: show3dCore ? '6px 14px' : '0 8px',
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
              onClick={() => {
                triggerHaptic('tap');
                onTogglePause();
              }}
              style={{ minWidth: 184 }}
            >
              {t.status === 'running' ? 'Pause session' : 'Resume session'}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="xl"
              icon={<Play size={20} strokeWidth={2} />}
              onClick={() => {
                triggerHaptic('tap');
                onStartTimer(
                  effectiveSubId,
                  headingInput,
                  curMode,
                  undefined,
                  effectiveChapId || undefined
                );
              }}
              style={{ minWidth: 196 }}
            >
              Start focus
            </Button>
          )}

          {curMode === 'pomo' && (
            <Button
              variant="secondary"
              size="lg"
              className="dh-glass-btn"
              icon={
                t?.phase === 'break' ? (
                  <Zap size={17} strokeWidth={1.75} />
                ) : (
                  <Coffee size={17} strokeWidth={1.75} />
                )
              }
              onClick={() => {
                triggerHaptic('tap');
                onTogglePomoPhase();
              }}
            >
              {t?.phase === 'break' ? 'Work phase' : 'Break'}
            </Button>
          )}

          {t?.mode === 'fullMock' && onNextMockSection && (
            <Button
              variant="secondary"
              size="lg"
              className="dh-glass-btn"
              icon={<SkipForward size={17} strokeWidth={1.75} />}
              onClick={() => {
                triggerHaptic('tap');
                onNextMockSection();
              }}
            >
              Next section
            </Button>
          )}

          {t && (
            <Button
              variant="danger"
              size="lg"
              icon={<Square size={16} strokeWidth={2} />}
              onClick={() => {
                triggerHaptic('stop');
                onStopAndReflect();
              }}
            >
              Stop &amp; log
            </Button>
          )}
        </div>

        {/* Compact Action Row (Park Thought when active, Durations, Desk Mode, PiP, Topic) */}
        <div
          className="row hide-desk"
          style={{
            justifyContent: 'center',
            gap: 8,
            flexWrap: 'wrap',
            marginBottom: 10,
          }}
        >
          {t && (
            <button
              type="button"
              className="dh-glass-btn dh-park-trigger-pill"
              onClick={() => {
                triggerHaptic('tap');
                setParkingSheetOpen(true);
              }}
              aria-label={`Park a thought without pausing timer${
                parkedThoughts.length > 0 ? ` (${parkedThoughts.length} parked)` : ''
              }`}
            >
              <Lightbulb size={15} strokeWidth={1.8} style={{ color: 'var(--ac-ink)' }} aria-hidden="true" />
              <span>Park thought</span>
              {parkedThoughts.length > 0 && (
                <span className="dh-park-badge tabular-nums">{parkedThoughts.length}</span>
              )}
            </button>
          )}
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
            onClick={() => {
              triggerHaptic('tap');
              setDeskOverlayMode('focus');
              onToggleDeskMode();
            }}
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

        {/* Purity & Today's Subject / Total Readout */}
        <div className="purity-bar" style={{ marginBottom: 4 }}>
          <span>
            Focus purity <b id="livePurity">{m ? m.purity : 100}%</b>
          </span>
          <span>·</span>
          <span>
            {isAllSubjectsSelected ? (
              <>
                Today total <b id="liveTodaySub">{fmtHMShort(todayTotalMs)}</b>
              </>
            ) : (
              <>
                Today {curSubject.name}{' '}
                <b id="liveTodaySub">{fmtHMShort(todaySubMs)}</b>
              </>
            )}
          </span>
        </div>

        {/* Desk Mode Controls (legacy fallback hidden when StandByDeskOverlay is active) */}
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
      )}

      {/* 3. Offline 3-Fader Ambient Sound Mixer */}
      <Card className="hide-desk dh-today-card dh-mixer-card" data-testid="ambient-mixer-card">
        <div className="dh-mixer-header">
          <button
            type="button"
            className="dh-mixer-summary-btn"
            aria-expanded={mixerExpanded}
            aria-controls="dhAmbientMixerFaders"
            onClick={() => {
              triggerHaptic('tap');
              setMixerExpanded((v) => !v);
            }}
          >
            <span
              className={`dh-mixer-icon-wrap ${hasActiveAmbientAudio(ambientMixer) ? 'is-live' : ''}`}
              aria-hidden="true"
            >
              {hasActiveAmbientAudio(ambientMixer) ? (
                <Volume2 size={18} strokeWidth={1.75} />
              ) : (
                <VolumeX size={18} strokeWidth={1.75} />
              )}
            </span>
            <span className="dh-mixer-summary-copy">
              <span className="dh-mixer-title">Focus sounds</span>
              <span className="dh-mixer-subtitle tabular-nums" data-testid="ambient-mixer-summary">
                {formatAmbientMixSummary(ambientMixer)}
              </span>
            </span>
          </button>

          <div className="dh-mixer-header-actions">
            <button
              type="button"
              className={`dh-mixer-play-btn ${hasActiveAmbientAudio(ambientMixer) ? 'is-live' : ''}`}
              aria-label={
                hasActiveAmbientAudio(ambientMixer)
                  ? 'Mute ambient mixer'
                  : 'Play ambient mixer'
              }
              aria-pressed={hasActiveAmbientAudio(ambientMixer)}
              data-testid="ambient-mixer-mute-toggle"
              onClick={handleToggleAmbientMute}
            >
              {hasActiveAmbientAudio(ambientMixer) ? (
                <>
                  <VolumeX size={15} strokeWidth={1.75} aria-hidden="true" />
                  <span>Mute</span>
                </>
              ) : (
                <>
                  <Play size={14} strokeWidth={2} aria-hidden="true" />
                  <span>Play</span>
                </>
              )}
            </button>

            <button
              type="button"
              className={`dh-mixer-expand-btn ${mixerExpanded ? 'is-open' : ''}`}
              aria-label={mixerExpanded ? 'Collapse mixer faders' : 'Expand mixer faders'}
              aria-expanded={mixerExpanded}
              aria-controls="dhAmbientMixerFaders"
              data-testid="ambient-mixer-expand-toggle"
              onClick={() => {
                triggerHaptic('tap');
                setMixerExpanded((v) => !v);
              }}
            >
              <SlidersHorizontal size={15} strokeWidth={1.75} aria-hidden="true" />
              <ChevronDown size={15} strokeWidth={1.75} className="dh-mixer-chevron" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* 1-Tap Preset Chips */}
        <div className="dh-edge-fade-rail dh-mixer-preset-rail" role="group" aria-label="Ambient sound presets">
          {AMBIENT_PRESETS.map((preset) => {
            const isSelected =
              preset.id === 'off'
                ? ambientMixer.preset === 'off'
                : ambientMixer.preset === preset.id && !ambientMixer.muted;
            return (
              <Chip
                key={preset.id}
                selected={isSelected}
                onClick={() => handleSelectAmbientPreset(preset.id)}
              >
                {preset.label}
              </Chip>
            );
          })}
        </div>

        {/* Collapsible 3-Channel Tactile Faders */}
        {mixerExpanded && (
          <div id="dhAmbientMixerFaders" className="dh-mixer-faders" data-testid="ambient-mixer-faders">
            {AMBIENT_CHANNEL_META.map((ch) => {
              const val = ambientMixer.channels[ch.key];
              const isActiveCh = val > 0 && !ambientMixer.muted;
              return (
                <div key={ch.key} className="dh-mixer-fader-row">
                  <div className="dh-mixer-fader-meta">
                    <label
                      htmlFor={`dh-fader-${ch.key}`}
                      className={`dh-mixer-fader-label ${isActiveCh ? 'is-live' : ''}`}
                    >
                      {ch.label}
                    </label>
                    <span className="dh-mixer-fader-val tabular-nums">{val}%</span>
                  </div>
                  <input
                    id={`dh-fader-${ch.key}`}
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={val}
                    aria-label={`${ch.label} level`}
                    className="dh-mixer-range"
                    style={
                      {
                        '--dh-range-pct': `${val}%`,
                      } as React.CSSProperties
                    }
                    onChange={(e) =>
                      handleAmbientChannelChange(ch.key, Number(e.target.value))
                    }
                  />
                </div>
              );
            })}

            <div className="dh-mixer-fader-foot">
              <span className="dh-mixer-offline-note">
                100% offline Web Audio synthesis
              </span>
              <button
                type="button"
                className="dh-mixer-master-mute"
                onClick={handleToggleAmbientMute}
              >
                {hasActiveAmbientAudio(ambientMixer) ? 'Master mute' : 'Unmute mix'}
              </button>
            </div>
          </div>
        )}
      </Card>

      {/* 4. Session Checklist Card */}
      <Card className="hide-desk dh-today-card">
        <div className="split" style={{ marginBottom: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            <ListChecks size={18} strokeWidth={1.75} style={{ color: 'var(--ac-ink)' }} />
            <h3 style={{ margin: 0, fontSize: 18 }}>Session checklist</h3>
          </div>
          <small className="dh-meta-count">
            {globalTodos.filter((x) => x.done).length}/{globalTodos.length} done
          </small>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const clean = newTodoText.trim();
            if (!clean) return;
            triggerHaptic('tap');
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
            variant="secondary"
            size="md"
            className="dh-glass-accent-btn"
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
                  border: '1px solid var(--hairline)',
                  gap: 10,
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic('success');
                    onToggleTodo(td.id);
                  }}
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
      <Card className="hide-desk dh-today-card">
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
            className="dh-glass-btn"
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
                      border: '1px solid var(--hairline)',
                      gap: 10,
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="row" style={{ gap: 7, flexWrap: 'wrap' }}>
                        <span
                          aria-hidden="true"
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: sSub.color,
                            flexShrink: 0,
                          }}
                        />
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
                          className="tabular-nums"
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: 'var(--ac-ink)',
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
                      className="dh-glass-btn"
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

      {/* Subject, Chapter & Topic Frosted BottomSheet */}
      <BottomSheet
        open={topicSheetOpen}
        onClose={() => setTopicSheetOpen(false)}
        title="Subject & topic"
        subtitle={
          t
            ? 'Switching saves your current study slice and starts the new topic seamlessly'
            : 'Choose what you are studying for this focus block'
        }
        footer={
          <Button
            variant="primary"
            size="lg"
            fullWidth
            className="dh-focus-cta"
            onClick={() => {
              triggerHaptic('tap');
              if (t) {
                onSwitchTopic(effectiveSubId, headingInput, effectiveChapId || undefined);
              }
              setTopicSheetOpen(false);
            }}
          >
            {t ? 'Apply switch' : 'Done'}
          </Button>
        }
      >
        <div className="dh-sheet-field">
          <span className="dh-sheet-field-label">Subject</span>
          <div className="dh-edge-fade-rail">
            {curMode === 'fullMock' && (
              <Chip
                key={ALL_SUBJECTS_MOCK_ID}
                selected={isAllSubjectsSelected}
                colorDot={ALL_SUBJECTS_COLOR}
                onClick={() => {
                  triggerHaptic('tap');
                  setSelectedSubjectId(ALL_SUBJECTS_MOCK_ID);
                  setSelectedChapterId('');
                  const nextHeading =
                    headingInput.trim() &&
                    headingInput.trim() !== `${curSubject.name} Study`
                      ? headingInput.trim()
                      : 'Full Mock';
                  if (t) {
                    setHeadingInput(nextHeading);
                    onSwitchTopic(ALL_SUBJECTS_MOCK_ID, nextHeading, undefined);
                  } else {
                    setHeadingInput('');
                  }
                }}
              >
                All subjects (Full mock)
              </Chip>
            )}
            {activeSubjects.map((s) => (
              <Chip
                key={s.id}
                selected={effectiveSubId === s.id}
                colorDot={s.color}
                onClick={() => {
                  triggerHaptic('tap');
                  setSelectedSubjectId(s.id);
                  setRememberedSingleSubjectId(s.id);
                  setSelectedChapterId('');
                  if (t) {
                    const nextHeading =
                      headingInput.trim() &&
                      headingInput.trim() !== `${curSubject.name} Study` &&
                      headingInput.trim() !== 'Full Mock'
                        ? headingInput.trim()
                        : curMode === 'fullMock'
                          ? `${s.name} Mock`
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

        {!isAllSubjectsSelected && (
          <div className="dh-sheet-field">
            <span className="dh-sheet-field-label">Syllabus chapter</span>
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
        )}

        <div className="dh-sheet-field">
          <label htmlFor="sessionHeadingInput" className="dh-sheet-field-label">
            Session topic or goal
          </label>
          <input
            id="sessionHeadingInput"
            type="text"
            placeholder="e.g., Rotational Mechanics PYQs, NCERT Ch 4..."
            value={headingInput}
            onChange={(e) => setHeadingInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                triggerHaptic('tap');
                if (t) {
                  onSwitchTopic(effectiveSubId, headingInput, effectiveChapId || undefined);
                }
                setTopicSheetOpen(false);
              }
            }}
            style={{ width: '100%', minHeight: 46, fontSize: 14 }}
          />

          {recentHeadings.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 13, color: 'var(--tx-3)', marginBottom: 6 }}>
                Recent topics
              </div>
              <div className="dh-edge-fade-rail">
                {recentHeadings.map((h) => (
                  <Chip
                    key={`${h.subjectId}_${h.heading}`}
                    selected={headingInput === h.heading}
                    onClick={() => {
                      triggerHaptic('tap');
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
      </BottomSheet>

      {/* AMOLED StandBy Desk Mode Overlay (Unified Focus + Exam Hall) */}
      <StandByDeskOverlay
        open={deskMode}
        mode={deskOverlayMode}
        state={state}
        examState={examState}
        parkedCount={parkedThoughts.length}
        parkingSheetOpen={parkingSheetOpen}
        onExit={() => onSetDeskMode(false)}
        onOpenParkingLot={() => setParkingSheetOpen(true)}
        onToggleFocusPause={onTogglePause}
        onStopFocus={onStopAndReflect}
        onSwitchExamSection={handleSwitchExamSection}
        onToggleExamPause={handleToggleExamPause}
        onFinishExam={handleFinishExam}
      />

      {/* Mid-Session Parking Lot Scratchpad Sheet */}
      <ParkingLotSheet
        open={parkingSheetOpen}
        onClose={() => setParkingSheetOpen(false)}
        thoughts={parkedThoughts}
        onAddThought={(text) =>
          onAddParkedThought(text, {
            subjectId: t?.subjectId || effectiveSubId,
            chapterId: t?.chapterId || effectiveChapId || undefined,
          })
        }
        onRemoveThought={onRemoveParkedThought}
      />

      {/* Post-Exam Target-vs-Actual Bleed Diagnostic Sheet */}
      <ExamBleedSheet
        record={bleedSheetRecord}
        onClose={() => setBleedSheetRecord(null)}
        onLogMockScore={(rec) => {
          setBleedSheetRecord(null);
          onLogExamMockScore(rec);
        }}
        onShareProofCard={
          onOpenProofCard
            ? (rec) => {
                const streakInfo = computeMinDayStreak(state, todayKey);
                setBleedSheetRecord(null);
                onOpenProofCard({
                  kind: 'session',
                  durationMs: rec.totalElapsedMs,
                  subjectLabel: 'All Subjects · Exam Hall',
                  subjectColor: ALL_SUBJECTS_COLOR,
                  topicHeading: 'Exam Hall · NEET Mock',
                  focusPurity: 100,
                  streakDays: streakInfo.streak,
                  dateLabel: formatProofDateLabel(todayKey),
                  dayKey: todayKey,
                  modeLabel: 'Exam Hall',
                  subtitle: `${rec.sections.length} sections · ${rec.switchCount} switch${
                    rec.switchCount === 1 ? '' : 'es'
                  }`,
                });
              }
            : undefined
        }
      />
    </div>
  );
};
