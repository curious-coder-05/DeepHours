import React, { useMemo, useState } from 'react';
import {
  Plus,
  Check,
  Flame,
  SkipForward,
  MoreHorizontal,
  Calendar,
  Trash2,
  SlidersHorizontal,
  Timer,
  Hourglass,
  Clock,
  Play,
  Lightbulb,
  RotateCw,
  HeartHandshake,
  Moon,
  Zap,
  AlertCircle,
  Activity,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Edit3,
  CornerDownRight,
  RotateCcw,
  Share2,
} from 'lucide-react';
import type {
  ActiveTimerMode,
  AppTab,
  DailyTask,
  Habit,
  HabitCategory,
  PulseHabitState,
  StudySession,
} from '../types';
import {
  CATS,
  DN,
  STARTERS,
  addD,
  done,
  due,
  ent,
  fmtClockTime,
  fmtDuration,
  fmtHMShort,
  getDailyFocusTip,
  getDayProgress,
  getDayTotalStudyMs,
  getDueAndOverdueRevisions,
  getSessionHeading,
  getSubject,
  isAutoStudyHabit,
  live,
  parseD,
  rate,
  skip,
  streak,
  wkC,
} from '../utils/studyLogic';
import {
  checkBurnoutStatus,
  computeConsistencyScore,
  computeMinDayStreak,
  getSubjectTargetProgress,
} from '../utils/insights';
import { computeStudyNext } from '../utils/pace';
import {
  computeUiPaceReport,
  getUiDailyStudyGoalProgress,
  resolveUiExam,
} from '../utils/uiHelpers';
import { formatCountSummary, pluralize } from '../utils/format';
import { formatTodayDateCountdownLabel } from '../utils/navHelpers';
import { formatChapterConfidence } from '../utils/chartHelpers';
import { triggerHaptic } from '../utils/haptics';
import { ConsistencyDetailSheet, ExamCountdownCard } from './StatusRow';
import { BottomSheet } from './BottomSheet';
import {
  Button,
  Card,
  Chip,
  ConcentricProgressRing,
  CountUp,
  Meter,
  Select,
  SectionHeader,
  SwipeableRow,
  WindowedList,
  type ConcentricRingSegment,
} from './ui';

export interface TodayViewProps {
  state: PulseHabitState;
  sel: string;
  todayKey: string;
  cat: 'All' | HabitCategory;
  onSelectDay: (dayKey: string) => void;
  onSelectCat: (cat: 'All' | HabitCategory) => void;
  onSwitchTab: (tab: AppTab) => void;
  onManageExams?: () => void;
  onManageTargets?: () => void;
  onToggleHabit: (id: string, dayKey: string) => void;
  onIncrementHabit: (id: string, delta: number) => void;
  onSkipHabit: (id: string, dayKey: string) => void;
  onDeleteHabit?: (id: string) => void;
  onAddStarter: (index: number) => void;
  onNewHabit: () => void;
  onEditHabit: (id: string) => void;
  onQuickStartSession: (
    subjectId: string,
    heading: string,
    mode: ActiveTimerMode,
    chapterId?: string
  ) => void;
  onNewDDay: () => void;
  onEditDDay: (id: string) => void;
  onOpenManualSession: (defaultSubjectId?: string, defaultChapterId?: string) => void;
  onDeleteSession: (id: string) => void;
  onCompleteRevision: (chapterId: string, revId: string) => void;
  onRescheduleRevision: (chapterId: string, revId: string, newDate: string) => void;
  onAddTask: (title: string, dayKey: string, subjectId?: string) => void;
  onToggleTask: (taskId: string) => void;
  onEditTaskTitle: (taskId: string, newTitle: string) => void;
  onChangeTaskDate: (taskId: string, newDayKey: string) => void;
  onDeleteTask: (taskId: string) => void;
  onMoveTaskToToday: (taskId: string) => void;
  onMoveAllUnfinishedToToday: () => void;
  onToggleRestDay: (dayKey: string) => void;
  onDismissBurnout: () => void;
  onUpdateWellbeing: (
    dayKey: string,
    patch: { sleep?: number; energy?: 1 | 2 | 3 | 4 | 5 }
  ) => void;
  onSetMood: (val: number) => void;
  onSetNote: (txt: string) => void;
  onShareTodayProof?: () => void;
}

const MOOD_ITEMS: Array<[number, string, string]> = [
  [1, '😞', 'Rough'],
  [2, '😕', 'Low'],
  [3, '😐', 'Okay'],
  [4, '🙂', 'Good'],
  [5, '🤩', 'Great'],
];

export const TodayView: React.FC<TodayViewProps> = ({
  state,
  sel,
  todayKey,
  cat,
  onSelectDay,
  onSelectCat,
  onSwitchTab,
  onManageExams,
  onManageTargets,
  onToggleHabit,
  onIncrementHabit,
  onSkipHabit,
  onDeleteHabit,
  onAddStarter,
  onNewHabit,
  onEditHabit,
  onQuickStartSession,
  onNewDDay,
  onOpenManualSession,
  onDeleteSession,
  onCompleteRevision,
  onRescheduleRevision,
  onAddTask,
  onToggleTask,
  onEditTaskTitle,
  onChangeTaskDate,
  onDeleteTask,
  onMoveTaskToToday,
  onMoveAllUnfinishedToToday,
  onToggleRestDay,
  onDismissBurnout,
  onUpdateWellbeing,
  onSetMood,
  onSetNote,
  onShareTodayProof,
}) => {
  const [quickSubjectId, setQuickSubjectId] = useState<string>(
    () => state.subjects.find((s) => !s.arch)?.id || 'sub_phy'
  );
  const [quickChapterId, setQuickChapterId] = useState<string>('');
  const [quickHeading, setQuickHeading] = useState<string>('');
  const [quickMode, setQuickMode] = useState<'pomo' | 'countdown' | 'stopwatch'>(() => {
    const dm = state.set.defaultMode;
    return dm === 'countdown' || dm === 'stopwatch' ? dm : 'pomo';
  });
  const [tipOffset, setTipOffset] = useState<number>(0);
  const [focusConfigOpen, setFocusConfigOpen] = useState<boolean>(false);
  const [taskComposerOpen, setTaskComposerOpen] = useState<boolean>(false);
  const [calendarTrayOpen, setCalendarTrayOpen] = useState<boolean>(false);
  const [consistencySheetOpen, setConsistencySheetOpen] = useState<boolean>(false);

  // Daily Tasks local UI state
  const [newTaskTitle, setNewTaskTitle] = useState<string>('');
  const [newTaskSubjectId, setNewTaskSubjectId] = useState<string>('');
  const [openTaskMenuId, setOpenTaskMenuId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTaskTitle, setEditingTaskTitle] = useState<string>('');
  const [changingDateTaskId, setChangingDateTaskId] = useState<string | null>(null);
  const [unfinishedExpanded, setUnfinishedExpanded] = useState<boolean>(false);

  // Revisions Due local UI state
  const [revSubjectFilter, setRevSubjectFilter] = useState<string>('all');
  const [rescheduleTarget, setRescheduleTarget] = useState<{
    chapterId: string;
    revId: string;
    date: string;
  } | null>(null);
  const [showUnscheduled, setShowUnscheduled] = useState<boolean>(false);
  const [checkinOpen, setCheckinOpen] = useState<boolean>(false);

  const isTodaySelected = sel === todayKey;
  const isCalendarTrayExpanded = !isTodaySelected || calendarTrayOpen;
  const resolvedExam = useMemo(
    () => resolveUiExam(state, todayKey),
    [state, todayKey]
  );
  const headerDateInfo = useMemo(
    () =>
      formatTodayDateCountdownLabel({
        selDayKey: sel,
        todayKey,
        exam: resolvedExam,
      }),
    [sel, todayKey, resolvedExam]
  );

  // 7-day rolling week strip ending on todayKey
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addD(todayKey, i - 6)),
    [todayKey]
  );

  const dayProg = useMemo(() => getDayProgress(state, sel), [state, sel]);
  const p = Math.round(dayProg.pct * 100);

  const allLiveHabits = useMemo(() => live(state), [state]);
  const distinctHabitCats = useMemo(
    () => new Set(allLiveHabits.map((h) => h.c)).size,
    [allLiveHabits]
  );
  const showHabitCatFilter = allLiveHabits.length >= 4 && distinctHabitCats >= 2;
  const filteredHabits = useMemo(
    () =>
      allLiveHabits.filter((h) =>
        !showHabitCatFilter || cat === 'All' ? true : h.c === cat
      ),
    [allLiveHabits, cat, showHabitCatFilter]
  );
  const dueList = useMemo(
    () => filteredHabits.filter((h) => due(state, h, sel)),
    [filteredHabits, state, sel]
  );
  const otherList = useMemo(
    () => filteredHabits.filter((h) => !due(state, h, sel)),
    [filteredHabits, state, sel]
  );

  // Tasks for selected day + unfinished earlier tasks
  const dayTasks = useMemo(
    () =>
      (state.tasks || [])
        .filter((t) => t.dayKey === sel)
        .sort((a, b) => Number(a.done) - Number(b.done) || a.createdAt - b.createdAt),
    [state.tasks, sel]
  );

  const unfinishedEarlierTasks = useMemo(
    () =>
      (state.tasks || [])
        .filter((t) => !t.done && t.dayKey < todayKey)
        .sort((a, b) => b.dayKey.localeCompare(a.dayKey) || a.createdAt - b.createdAt),
    [state.tasks, todayKey]
  );

  // Selected day study sessions & metrics
  const selectedDaySessions = useMemo(
    () =>
      [...state.sessions.filter((s) => s.dayKey === sel)].sort(
        (a, b) => b.startTs - a.startTs
      ),
    [state.sessions, sel]
  );
  const selectedDayTotalMs = useMemo(
    () => getDayTotalStudyMs(state, sel, todayKey),
    [state, sel, todayKey]
  );
  const selectedDayAvgPurity = useMemo(
    () =>
      selectedDaySessions.length > 0
        ? Math.round(
            selectedDaySessions.reduce((acc, s) => acc + (s.purity || 100), 0) /
              selectedDaySessions.length
          )
        : 100,
    [selectedDaySessions]
  );

  const studyProg = useMemo(
    () => getUiDailyStudyGoalProgress(state, sel, todayKey),
    [state, sel, todayKey]
  );

  // 7-day rolling week summary for proportional mini bars
  const weekDaysSummary = useMemo(() => {
    const rows = days.map((k) => {
      const dp = Math.round(getDayProgress(state, k).pct * 100);
      const studyMs = getDayTotalStudyMs(state, k, todayKey);
      return { key: k, dp, studyMs };
    });
    const maxWeekMs = Math.max(
      studyProg.goalMs || 0,
      ...rows.map((r) => r.studyMs),
      1
    );
    return rows.map((r) => ({
      ...r,
      barPct:
        r.studyMs > 0
          ? Math.max(18, Math.min(100, Math.round((r.studyMs / maxWeekMs) * 100)))
          : r.dp > 0
            ? Math.max(14, Math.min(100, r.dp))
            : 0,
    }));
  }, [days, state, todayKey, studyProg.goalMs]);

  const heroCoachingCopy = useMemo(() => {
    if (studyProg.goalMs > 0) {
      const rem = Math.max(0, studyProg.goalMs - selectedDayTotalMs);
      if (rem === 0) return 'Daily study goal reached';
      if (selectedDayTotalMs > 0) return `${fmtHMShort(rem)} to hit your goal`;
      return `Aim for ${fmtDuration(studyProg.goalMs)} today`;
    }
    if (selectedDayTotalMs > 0) {
      return `${pluralize(selectedDaySessions.length, 'deep focus session')} logged`;
    }
    return 'Start a focus block today';
  }, [studyProg.goalMs, selectedDayTotalMs, selectedDaySessions.length]);

  const dailyTip = useMemo(
    () => getDailyFocusTip(sel, tipOffset),
    [sel, tipOffset]
  );

  const revisionsBundle = useMemo(
    () => getDueAndOverdueRevisions(state, sel, todayKey),
    [state, sel, todayKey]
  );
  const allRevisionsCount =
    revisionsBundle.overdue.length + revisionsBundle.dueOnSel.length;
  const overdueRevisions = useMemo(
    () =>
      revisionsBundle.overdue.filter((r) =>
        revSubjectFilter === 'all' ? true : r.subject.id === revSubjectFilter
      ),
    [revisionsBundle.overdue, revSubjectFilter]
  );
  const dueTodayRevisions = useMemo(
    () =>
      revisionsBundle.dueOnSel.filter((r) =>
        revSubjectFilter === 'all' ? true : r.subject.id === revSubjectFilter
      ),
    [revisionsBundle.dueOnSel, revSubjectFilter]
  );

  // Insights & Pace
  const minStreakInfo = useMemo(
    () => computeMinDayStreak(state, todayKey),
    [state, todayKey]
  );
  const consistencyInfo = useMemo(
    () => computeConsistencyScore(state, todayKey),
    [state, todayKey]
  );
  const burnoutStatus = useMemo(
    () => checkBurnoutStatus(state, todayKey),
    [state, todayKey]
  );
  const subjectTargets = useMemo(
    () =>
      getSubjectTargetProgress(state, sel).filter(
        (r) => r.dailyTargetMins > 0 || r.weeklyTargetMins > 0
      ),
    [state, sel]
  );
  const paceReport = useMemo(
    () => computeUiPaceReport(state, todayKey),
    [state, todayKey]
  );
  const studyNextItems = useMemo(
    () => computeStudyNext(state, todayKey, 3),
    [state, todayKey]
  );

  const activeSubjects = useMemo(
    () => state.subjects.filter((s) => !s.arch),
    [state.subjects]
  );
  const effectiveQuickSubId = activeSubjects.some((s) => s.id === quickSubjectId)
    ? quickSubjectId
    : activeSubjects[0]?.id || 'sub_phy';
  const quickSubjectChapters = useMemo(
    () => state.chapters.filter((ch) => ch.subjectId === effectiveQuickSubId),
    [state.chapters, effectiveQuickSubId]
  );
  const effectiveQuickChapId = quickSubjectChapters.some(
    (ch) => ch.id === quickChapterId
  )
    ? quickChapterId
    : '';

  const selWellbeing = state.wellbeing?.[sel] || {};
  const sleepHours = selWellbeing.sleep;
  const energyLevel = selWellbeing.energy;

  const effectiveQuickSubject = useMemo(
    () =>
      activeSubjects.find((s) => s.id === effectiveQuickSubId) ||
      activeSubjects[0] ||
      getSubject(state, effectiveQuickSubId),
    [activeSubjects, effectiveQuickSubId, state]
  );

  const effectiveQuickChapter = useMemo(
    () => quickSubjectChapters.find((ch) => ch.id === effectiveQuickChapId),
    [quickSubjectChapters, effectiveQuickChapId]
  );

  const quickModeLabel =
    quickMode === 'pomo'
      ? `Pomodoro ${state.set.pomoWork || 25}m`
      : quickMode === 'countdown'
        ? `Countdown ${state.set.countdownMins || 45}m`
        : 'Stopwatch';

  const quickChapterOptions = useMemo(
    () => [
      { value: '', label: 'General subject study (no specific chapter)' },
      ...quickSubjectChapters.map((ch) => ({
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
    [quickSubjectChapters]
  );

  const renderHabitRow = (h: Habit) => {
    const isD = done(state, h, sel);
    const isSk = skip(state, h, sel);
    const e = ent(state, h, sel);
    const cur = e ? e.v : 0;
    const s = streak(state, h, todayKey);
    const r = rate(state, h, 30, todayKey);
    const w = wkC(state, h, sel);
    const autoStudy = isAutoStudyHabit(h);
    const linkedSub =
      h.subjectId && h.subjectId !== 'any'
        ? getSubject(state, h.subjectId)
        : null;

    const metaParts: string[] = [];
    if (h.sch === 'week') metaParts.push(`${w}/${h.n} wk`);
    if (autoStudy) {
      metaParts.push(
        h.tn > 1
          ? `Deep Study habit · ${cur}/${h.tn} ${h.tu || 'min'}`.trim()
          : 'Deep Study habit'
      );
    } else if (h.tn > 1) {
      metaParts.push(`${cur}/${h.tn} ${h.tu || ''}`.trim());
    }
    metaParts.push(`${r}% 30d`);
    if (isSk) metaParts.push('Skipped');

    return (
      <SwipeableRow
        key={h.id}
        onSwipeRight={autoStudy ? undefined : () => onToggleHabit(h.id, sel)}
        onSwipeLeft={onDeleteHabit ? () => onDeleteHabit(h.id) : undefined}
        rightLabel={isD ? 'Undo' : 'Complete'}
        leftLabel="Delete"
      >
        <div
          className={`c dh-habit-card ${h.tn > 1 ? 'has-counter' : ''} ${isD ? 'dn' : ''} ${isSk ? 'sk' : ''}`}
          onClick={() => {
            triggerHaptic('success');
            onToggleHabit(h.id, sel);
          }}
        >
        <button
          type="button"
          className="ck"
          aria-label={`Mark ${h.name} complete`}
          onClick={(ev) => {
            ev.stopPropagation();
            triggerHaptic('success');
            onToggleHabit(h.id, sel);
          }}
        >
          {isD ? <Check size={20} strokeWidth={2.25} /> : h.e || '✨'}
        </button>

        <div
          style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
          onClick={(ev) => {
            ev.stopPropagation();
            onEditHabit(h.id);
          }}
        >
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <b
              style={{
                fontSize: 15,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {h.name}
            </b>
            {autoStudy && (
              <span
                className="pill"
                style={{
                  fontSize: 13,
                  padding: '2px 8px',
                  background: 'var(--ac-soft)',
                  color: 'var(--ac-ink)',
                  border: '1px solid var(--ac-line)',
                }}
              >
                Auto from timer
              </span>
            )}
            {linkedSub && (
              <span
                style={{
                  fontSize: 12.5,
                  color: 'var(--tx-2)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span
                  aria-hidden="true"
                  className="dh-sub-dot"
                  style={{ background: linkedSub.color }}
                />
                {linkedSub.name}
              </span>
            )}
          </div>

          <div className="row" style={{ gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
            <small style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
              {metaParts.join(' · ')}
            </small>
            {s.cur > 0 && (
              <span
                className="pill"
                style={{
                  fontSize: 13,
                  padding: '2px 8px',
                  background: 'color-mix(in srgb, var(--warn) 14%, transparent)',
                  color: 'var(--warn-ink)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Flame size={13} strokeWidth={2} />
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{s.cur}d</span>
              </span>
            )}
          </div>

          {h.tn > 1 && (
            <div style={{ marginTop: 6 }}>
              <Meter
                value={Math.min(100, (cur / h.tn) * 100)}
                color={isD ? 'var(--ok)' : 'var(--ac)'}
                height={6}
                label={autoStudy ? 'Deep Study habit progress' : `${h.name} progress`}
              />
            </div>
          )}
        </div>

        {!autoStudy && (
          <div
            className="dh-habit-controls"
            onClick={(ev) => ev.stopPropagation()}
          >
            {h.tn > 1 && (
              <>
                <button
                  type="button"
                  className="s dh-habit-ctrl-btn"
                  aria-label={`Decrease ${h.name}`}
                  onClick={() => {
                    triggerHaptic('tap');
                    onIncrementHabit(h.id, -1);
                  }}
                >
                  −
                </button>
                <button
                  type="button"
                  className="s dh-habit-ctrl-btn"
                  aria-label={`Increase ${h.name}`}
                  onClick={() => {
                    triggerHaptic('tap');
                    onIncrementHabit(h.id, 1);
                  }}
                >
                  +
                </button>
              </>
            )}
            <button
              type="button"
              className="s dh-habit-ctrl-btn"
              title="Skip today (preserves streak)"
              aria-label={`Skip ${h.name} today`}
              onClick={() => {
                triggerHaptic('tap');
                onSkipHabit(h.id, sel);
              }}
            >
              <SkipForward size={15} strokeWidth={1.75} />
            </button>
          </div>
        )}
        </div>
      </SwipeableRow>
    );
  };

  const showPaceCard = Boolean(
    paceReport?.exam && !paceReport.pastExam && paceReport.totalChapters > 0
  );

  return (
    <div>
      {/* 1. Interactive Date + Exam Countdown Header & Collapsible Calendar/Pace Tray */}
      <section
        className="dh-today-date-section"
        aria-label="Date selector and study pace"
      >
        <div className="dh-today-date-bar">
          <button
            type="button"
            className="dh-today-date-trigger"
            aria-expanded={isCalendarTrayExpanded}
            aria-controls="dh-today-calendar-tray"
            onClick={() => {
              triggerHaptic('tap');
              if (!isTodaySelected) {
                setCalendarTrayOpen(true);
                return;
              }
              setCalendarTrayOpen((v) => !v);
            }}
          >
            <span className="dh-today-date-text">
              <span className="dh-today-date-primary">{headerDateInfo.dateLabel}</span>
              {headerDateInfo.countdownLabel && (
                <>
                  <span className="dh-glance-sep" aria-hidden="true">
                    ·
                  </span>
                  <span className="dh-today-date-countdown tabular-nums">
                    {headerDateInfo.countdownLabel}
                  </span>
                </>
              )}
            </span>
            <ChevronDown
              size={16}
              strokeWidth={2}
              aria-hidden="true"
              className={`dh-today-date-chevron ${isCalendarTrayExpanded ? 'is-open' : ''}`}
            />
          </button>

          {!isTodaySelected && (
            <button
              type="button"
              className="dh-back-today-pill dh-glass-accent-btn"
              onClick={() => {
                triggerHaptic('tap');
                onSelectDay(todayKey);
                setCalendarTrayOpen(false);
              }}
            >
              <RotateCcw size={13} strokeWidth={2} aria-hidden="true" />
              <span>Back to Today</span>
            </button>
          )}
        </div>

        <div
          id="dh-today-calendar-tray"
          className={`dh-date-tray ${isCalendarTrayExpanded ? 'is-open' : ''}`}
          aria-hidden={!isCalendarTrayExpanded}
        >
          <div className="dh-date-tray-inner">
            {/* 7-Day Rolling Week Strip */}
            <div
              className="dh-wk-v25"
              role="group"
              aria-label="7-day date selector"
            >
              {weekDaysSummary.map(({ key: k, barPct }) => {
                const d = parseD(k);
                return (
                  <button
                    key={k}
                    type="button"
                    tabIndex={isCalendarTrayExpanded ? 0 : -1}
                    aria-pressed={k === sel}
                    aria-label={`${DN[d.getDay()]} ${d.getDate()}${k === todayKey ? ' (Today)' : ''}`}
                    className={k === sel ? 'on' : ''}
                    onClick={() => {
                      triggerHaptic('tap');
                      onSelectDay(k);
                    }}
                  >
                    <small style={{ fontSize: 13 }}>{DN[d.getDay()]}</small>
                    <b>{d.getDate()}</b>
                    <span className="wk-bar-track" aria-hidden="true">
                      <span className="wk-bar-fill" style={{ height: `${barPct}%` }} />
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Consistency & Syllabus Pace / Exam Readouts */}
            <div className="dh-tray-metrics-grid">
              <button
                type="button"
                className="dh-status-card min-w-0"
                tabIndex={isCalendarTrayExpanded ? 0 : -1}
                onClick={() => {
                  triggerHaptic('tap');
                  setConsistencySheetOpen(true);
                }}
                style={{ borderColor: 'var(--hairline)' }}
              >
                <span className="dh-status-card-left">
                  <Activity
                    size={15}
                    strokeWidth={1.75}
                    style={{ color: 'var(--info-ink)', flexShrink: 0 }}
                    aria-hidden="true"
                  />
                  <span className="dh-status-pill-label">Consistency</span>
                </span>
                <span className="tabular-nums dh-status-card-val">
                  {consistencyInfo.total !== null
                    ? `${consistencyInfo.total}/100`
                    : 'Building'}
                </span>
              </button>

              {showPaceCard && paceReport ? (
                <button
                  type="button"
                  className="dh-status-card min-w-0"
                  tabIndex={isCalendarTrayExpanded ? 0 : -1}
                  onClick={() => {
                    triggerHaptic('tap');
                    onSwitchTab('prep');
                  }}
                  style={{ borderColor: 'var(--hairline)' }}
                >
                  <span
                    className="dh-status-card-left"
                    style={{ width: '100%', justifyContent: 'space-between' }}
                  >
                    <span className="dh-status-pill-label">Syllabus pace</span>
                    <ArrowRight
                      size={14}
                      strokeWidth={1.75}
                      style={{ color: 'var(--tx-3)', flexShrink: 0 }}
                      aria-hidden="true"
                    />
                  </span>
                  <span
                    className="tabular-nums"
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      lineHeight: 1.3,
                      color:
                        paceReport.status === 'ahead'
                          ? 'var(--ok-ink)'
                          : paceReport.status === 'behind'
                            ? 'var(--warn-ink)'
                            : 'var(--ac-ink)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                    }}
                  >
                    {paceReport.compactSummary}
                  </span>
                </button>
              ) : (
                <div className="min-w-0 max-w-full">
                  <ExamCountdownCard
                    state={state}
                    todayKey={todayKey}
                    onManageExams={onManageExams || (() => onSwitchTab('more'))}
                    onAddExam={onNewDDay}
                  />
                </div>
              )}
            </div>

            {showPaceCard && (
              <div className="min-w-0 max-w-full">
                <ExamCountdownCard
                  state={state}
                  todayKey={todayKey}
                  onManageExams={onManageExams || (() => onSwitchTab('more'))}
                  onAddExam={onNewDDay}
                />
              </div>
            )}
          </div>
        </div>
      </section>

      <ConsistencyDetailSheet
        open={consistencySheetOpen}
        onClose={() => setConsistencySheetOpen(false)}
        consistencyInfo={consistencyInfo}
      />

      {/* 2. Gentle Pace & Wellbeing Check-In (when visible) */}
      {burnoutStatus.visible && (
        <Card className="dh-today-card" style={{ marginBottom: 14 }}>
          <div className="split" style={{ alignItems: 'flex-start', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                <HeartHandshake
                  size={18}
                  strokeWidth={1.75}
                  style={{ color: 'var(--info-ink)', flexShrink: 0 }}
                />
                <b style={{ fontSize: 15 }}>Gentle pace & wellbeing check-in</b>
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  color: 'var(--tx-2)',
                  lineHeight: 1.5,
                }}
              >
                {burnoutStatus.message || burnoutStatus.supportNote}
              </p>
            </div>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {!minStreakInfo.todayIsRestDay &&
              minStreakInfo.restPassesRemaining > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onToggleRestDay(todayKey)}
                >
                  Take rest day pass ({minStreakInfo.restPassesRemaining} left)
                </Button>
              )}
            <Button variant="ghost" size="sm" onClick={onDismissBurnout}>
              Dismiss (3d)
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setCheckinOpen(true);
                const el = document.getElementById('wellbeingReflectionCard');
                if (el) el.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              Log sleep & energy
            </Button>
          </div>
        </Card>
      )}

      {/* Desktop 1100px+ Two-Column Workspace */}
      <div className="today-desktop-layout">
        <div className="today-main-col dh-today-flow">
          {/* 4. Top Hero Progress + Compact 1-Tap Focus Launcher (Single Tier-1 Hero) */}
          <Card className="dh-hero-tier1">
            <div className="hero-grid">
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <ConcentricProgressRing
                  size={168}
                  outerPct={
                    studyProg.goalMs > 0
                      ? studyProg.pct
                      : selectedDayTotalMs > 0
                        ? 100
                        : 0
                  }
                  innerPct={p}
                >
                  <div>
                    <b
                      style={{
                        fontSize: 25,
                        fontWeight: 700,
                        lineHeight: 1.05,
                        letterSpacing: '-0.03em',
                        color: 'var(--tx)',
                        display: 'block',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      <CountUp
                        value={studyProg.goalMs > 0 ? studyProg.pct : p}
                        formatter={(v) => `${Math.round(v)}%`}
                      />
                    </b>
                    <span
                      style={{
                        fontSize: 12.5,
                        color: 'var(--tx-2)',
                        display: 'block',
                        marginTop: 2,
                      }}
                    >
                      {studyProg.goalMs > 0 ? 'Study goal' : 'Daily goal'}
                    </span>
                    {dayProg.habitsTotal > 0 && (
                      <span
                        style={{
                          fontSize: 12.5,
                          color: 'var(--ok-ink)',
                          fontWeight: 600,
                          display: 'block',
                          marginTop: 1,
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {p}% habits
                      </span>
                    )}
                  </div>
                </ConcentricProgressRing>
              </div>

              <div style={{ minWidth: 0 }}>
                <div style={{ marginBottom: 12 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      flexWrap: 'wrap',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: 10,
                        flexWrap: 'wrap',
                      }}
                    >
                      <b
                        style={{
                          fontSize: 'clamp(36px, 8vw, 46px)',
                          fontWeight: 700,
                          lineHeight: 1.02,
                          letterSpacing: '-0.025em',
                          color: 'var(--ac-ink)',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {fmtHMShort(selectedDayTotalMs)}
                      </b>
                      <span style={{ fontSize: 14, color: 'var(--tx-2)' }}>
                        {studyProg.goalMs > 0
                          ? `of ${fmtDuration(studyProg.goalMs)} goal`
                          : pluralize(selectedDaySessions.length, 'session')}
                      </span>
                    </div>
                    {onShareTodayProof && (
                      <button
                        type="button"
                        className="dh-glass-btn dh-proof-trigger-pill"
                        onClick={() => {
                          triggerHaptic('tap');
                          onShareTodayProof();
                        }}
                        aria-label="Share today's study proof card"
                      >
                        <Share2 size={14} strokeWidth={1.9} aria-hidden="true" />
                        <span>Share proof</span>
                      </button>
                    )}
                  </div>
                  <p
                    style={{
                      margin: '4px 0 0',
                      fontSize: 13,
                      color:
                        studyProg.goalMs > 0 && studyProg.pct >= 100
                          ? 'var(--ok-ink)'
                          : 'var(--tx-2)',
                      fontWeight: 500,
                    }}
                  >
                    {heroCoachingCopy}
                  </p>
                </div>

                <div className="dh-hero-metrics">
                  <div className="dh-hero-metric">
                    <span className="dh-hero-metric-label">Focus purity</span>
                    <b
                      className="dh-hero-metric-val"
                      style={{
                        color:
                          selectedDayAvgPurity >= 85
                            ? 'var(--ok-ink)'
                            : selectedDayAvgPurity >= 65
                              ? 'var(--warn-ink)'
                              : 'var(--tx)',
                      }}
                    >
                      {selectedDaySessions.length
                        ? `${selectedDayAvgPurity}%`
                        : '—'}
                    </b>
                    <span className="dh-hero-metric-sub">
                      {pluralize(selectedDaySessions.length, 'session')}
                    </span>
                  </div>
                  <div className="dh-hero-metric">
                    <span className="dh-hero-metric-label">Habits &amp; tasks</span>
                    <b
                      className="dh-hero-metric-val"
                      style={{
                        color:
                          p === 100 && dayProg.total > 0 ? 'var(--ok-ink)' : 'var(--tx)',
                      }}
                    >
                      {dayProg.habitsTotal > 0 || dayProg.tasksTotal > 0
                        ? `${dayProg.habitsDone + dayProg.tasksDone}/${dayProg.habitsTotal + dayProg.tasksTotal}`
                        : '—'}
                    </b>
                    <span className="dh-hero-metric-sub">
                      {formatCountSummary([
                        { count: dayProg.habitsTotal, singular: 'habit' },
                        { count: dayProg.tasksTotal, singular: 'task' },
                      ])}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Compact 1-Tap Focus Launcher Dock (Single dominant Gold CTA) */}
            <div className="dh-focus-dock">
              {state.activeTimer ? (
                <div
                  className="split"
                  style={{
                    padding: '12px 14px',
                    borderRadius: 14,
                    background: 'var(--ac-soft)',
                    border: '1px solid var(--ac-line)',
                    gap: 10,
                    flexWrap: 'wrap',
                  }}
                >
                  <div className="row" style={{ gap: 10, minWidth: 0, flex: 1 }}>
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        flexShrink: 0,
                        background:
                          state.activeTimer.status === 'running'
                            ? 'var(--ok)'
                            : 'var(--warn)',
                      }}
                    />
                    <div style={{ minWidth: 0 }}>
                      <b style={{ fontSize: 14, display: 'block' }}>
                        {state.activeTimer.status === 'running'
                          ? 'Focus session running'
                          : 'Focus session paused'}
                      </b>
                      <span
                        style={{
                          fontSize: 13,
                          color: 'var(--tx-2)',
                          display: 'block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {getSubject(state, state.activeTimer.subjectId).name} ·{' '}
                        {state.activeTimer.heading || 'Deep study'}
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="primary"
                    size="md"
                    className="dh-focus-cta"
                    icon={<Play size={15} strokeWidth={2.25} />}
                    onClick={() => onSwitchTab('focus')}
                  >
                    Open timer
                  </Button>
                </div>
              ) : (
                <>
                  <div className="dh-focus-dock-top">
                    <button
                      type="button"
                      className="dh-focus-config-pill"
                      aria-label="Configure focus session"
                      onClick={() => setFocusConfigOpen(true)}
                    >
                      <div
                        className="row"
                        style={{ gap: 9, minWidth: 0, flex: 1, alignItems: 'center' }}
                      >
                        <span
                          aria-hidden="true"
                          className="dh-sub-dot"
                          style={{
                            background: effectiveQuickSubject.color,
                          }}
                        />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <span
                            style={{
                              display: 'block',
                              fontSize: 14,
                              fontWeight: 600,
                              color: 'var(--tx)',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              lineHeight: 1.25,
                            }}
                          >
                            {effectiveQuickSubject.name}
                          </span>
                          <span
                            style={{
                              display: 'block',
                              fontSize: 13,
                              color: 'var(--tx-2)',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              lineHeight: 1.25,
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {quickHeading.trim()
                              ? `${quickHeading.trim()} · ${quickModeLabel}`
                              : effectiveQuickChapter
                                ? `${effectiveQuickChapter.name} · ${quickModeLabel}`
                                : quickModeLabel}
                          </span>
                        </div>
                      </div>
                      <span
                        className="row"
                        style={{
                          gap: 5,
                          fontSize: 13,
                          fontWeight: 600,
                          color: 'var(--tx-2)',
                          flexShrink: 0,
                        }}
                      >
                        <SlidersHorizontal size={14} strokeWidth={1.75} aria-hidden="true" />
                        <span>Setup</span>
                      </span>
                    </button>

                    <button
                      type="button"
                      className="dh-focus-log-btn dh-glass-btn"
                      aria-label="Log study hours manually"
                      onClick={() =>
                        onOpenManualSession(
                          effectiveQuickSubId,
                          effectiveQuickChapId || undefined
                        )
                      }
                    >
                      <Plus size={14} strokeWidth={2} aria-hidden="true" />
                      <span>Log</span>
                    </button>
                  </div>

                  <Button
                    variant="primary"
                    size="lg"
                    fullWidth
                    className="dh-focus-cta"
                    icon={<Play size={17} strokeWidth={2.25} />}
                    onClick={() => {
                      triggerHaptic('tap');
                      onQuickStartSession(
                        effectiveQuickSubId,
                        quickHeading,
                        quickMode,
                        effectiveQuickChapId || undefined
                      );
                    }}
                  >
                    Start focus
                  </Button>
                </>
              )}
            </div>
          </Card>

          {/* 5. Subject Daily Targets (Borderless Tier-0 Section on #000000) */}
          {subjectTargets.length > 0 && (
            <section className="dh-amoled-section">
              <div className="dh-eyebrow-row">
                <h3 className="dh-eyebrow">Subject targets</h3>
                <button
                  type="button"
                  className="dh-eyebrow-link"
                  onClick={() =>
                    onManageTargets ? onManageTargets() : onSwitchTab('more')
                  }
                >
                  <span>Edit targets</span>
                  <ChevronRight size={14} strokeWidth={1.6} aria-hidden="true" />
                </button>
              </div>
              <div className="dh-hairline-list">
                {subjectTargets.map((row) => (
                  <div
                    key={row.subjectId}
                    style={{
                      padding: '12px 0',
                      borderBottom: '1px solid var(--hairline)',
                    }}
                  >
                    <div className="split" style={{ marginBottom: 6, gap: 8 }}>
                      <div className="row" style={{ gap: 8 }}>
                        <span
                          aria-hidden="true"
                          className="dh-sub-dot"
                          style={{ background: row.color }}
                        />
                        <b style={{ fontSize: 14, fontWeight: 600 }}>
                          {row.subjectName}
                        </b>
                      </div>
                      <span
                        style={{
                          fontSize: 13,
                          color: 'var(--tx-2)',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {row.dailyTargetMins > 0 && (
                          <>
                            <b
                              style={{
                                color:
                                  row.dailyPct >= 100
                                    ? 'var(--ok-ink)'
                                    : 'var(--tx)',
                              }}
                            >
                              {fmtDuration(row.dailyActualMins * 60000)}
                            </b>{' '}
                            / {fmtDuration(row.dailyTargetMins * 60000)}
                          </>
                        )}
                      </span>
                    </div>
                    {row.dailyTargetMins > 0 && (
                      <Meter
                        value={row.dailyPct}
                        color={row.dailyPct >= 100 ? 'var(--ok)' : row.color}
                        height={5}
                        label={`${row.subjectName} daily target`}
                      />
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 6. Study Next — Top 3 Recommended Chapters (Tier-0 Hairline List) */}
          {studyNextItems.length > 0 && (
            <section className="dh-amoled-section">
              <div className="dh-eyebrow-row">
                <h3 className="dh-eyebrow">Study next</h3>
                <button
                  type="button"
                  className="dh-eyebrow-link"
                  onClick={() => onSwitchTab('prep')}
                >
                  <span>Syllabus</span>
                  <ChevronRight size={14} strokeWidth={1.6} aria-hidden="true" />
                </button>
              </div>
              <div className="dh-hairline-list">
                {studyNextItems.map((item) => (
                  <div key={item.chapter.id} className="dh-hairline-row">
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        className="row"
                        style={{ gap: 8, flexWrap: 'nowrap', marginBottom: 2 }}
                      >
                        <span
                          aria-hidden="true"
                          className="dh-sub-dot"
                          style={{ background: item.subjectColor }}
                        />
                        <b
                          style={{
                            fontSize: 14.5,
                            fontWeight: 600,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          {item.chapter.name}
                        </b>
                      </div>
                      <small
                        style={{
                          display: 'block',
                          paddingLeft: 14,
                          fontSize: 12.5,
                          color: 'var(--tx-3)',
                          lineHeight: 1.35,
                        }}
                      >
                        {item.subjectName} · {item.reasons.join(' · ')}
                        {(() => {
                          const confLabel = formatChapterConfidence(item.chapter.confidence);
                          return confLabel ? ` · ${confLabel}` : '';
                        })()}
                      </small>
                    </div>
                    <button
                      type="button"
                      className="dh-ghost-pill"
                      onClick={() =>
                        onQuickStartSession(
                          item.chapter.subjectId,
                          item.chapter.name,
                          state.set.defaultMode || 'pomo',
                          item.chapter.id
                        )
                      }
                    >
                      <span>Focus</span>
                      <ChevronRight size={13} strokeWidth={1.8} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 7. Daily Tasks (Tier-0 Hairline Section on #000000) */}
          <section id="dailyTasksCard" className="dh-amoled-section">
            <div className="dh-eyebrow-row">
              <div className="row" style={{ gap: 8 }}>
                <h3 className="dh-eyebrow">Daily tasks</h3>
                <span
                  className="dh-meta-count"
                  style={{
                    fontSize: 12,
                    color:
                      dayTasks.length > 0 && dayProg.tasksDone === dayTasks.length
                        ? 'var(--ok-ink)'
                        : 'var(--tx-3)',
                  }}
                >
                  {dayProg.tasksDone}/{dayProg.tasksTotal}
                </span>
              </div>
              {dayTasks.length > 0 && (
                <button
                  type="button"
                  className="dh-eyebrow-link"
                  onClick={() => setTaskComposerOpen(true)}
                >
                  <Plus size={14} strokeWidth={1.8} aria-hidden="true" />
                  <span>Add</span>
                </button>
              )}
            </div>

            {dayTasks.length === 0 ? (
              <div className="dh-empty-inline">
                <span>No tasks scheduled for {isTodaySelected ? 'today' : sel}.</span>
                <button
                  type="button"
                  className="dh-eyebrow-link"
                  onClick={() => setTaskComposerOpen(true)}
                >
                  <span>+ Add task</span>
                </button>
              </div>
            ) : (
              <WindowedList
                items={dayTasks}
                threshold={100}
                estimatedRowHeight={56}
                itemLabel="tasks"
                className="dh-hairline-list"
                getKey={(task: DailyTask) => task.id}
                renderItem={(task: DailyTask) => {
                  const sub = task.subjectId
                    ? state.subjects.find((s) => s.id === task.subjectId)
                    : undefined;
                  const isEditing = editingTaskId === task.id;
                  const isChangingDate = changingDateTaskId === task.id;
                  const isMenuOpen = openTaskMenuId === task.id;

                  return (
                    <SwipeableRow
                      key={task.id}
                      disabled={isEditing || isChangingDate}
                      onSwipeRight={() => onToggleTask(task.id)}
                      onSwipeLeft={() => onDeleteTask(task.id)}
                      rightLabel={task.done ? 'Reopen' : 'Done'}
                      leftLabel="Delete"
                    >
                      <div
                        style={{
                          padding: '10px 0',
                          borderBottom: '1px solid var(--hairline)',
                          minHeight: 52,
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'center',
                        }}
                      >
                      <div className="row" style={{ gap: 10 }}>
                        <button
                          type="button"
                          className={`dh-task-check ${task.done ? 'checked' : ''}`}
                          aria-label={
                            task.done
                              ? `Mark "${task.title}" incomplete`
                              : `Complete "${task.title}"`
                          }
                          onClick={() => {
                            triggerHaptic('success');
                            onToggleTask(task.id);
                          }}
                        >
                          {task.done ? <Check size={18} strokeWidth={2.25} /> : null}
                        </button>

                        <div style={{ flex: 1, minWidth: 0 }}>
                          {isEditing ? (
                            <form
                              className="row"
                              style={{ gap: 6 }}
                              onSubmit={(e) => {
                                e.preventDefault();
                                const clean = editingTaskTitle.trim();
                                if (clean) onEditTaskTitle(task.id, clean);
                                setEditingTaskId(null);
                              }}
                            >
                              <input
                                type="text"
                                aria-label={`Edit task title for ${task.title}`}
                                value={editingTaskTitle}
                                onChange={(e) => setEditingTaskTitle(e.target.value)}
                                autoFocus
                                style={{
                                  flex: 1,
                                  minHeight: 34,
                                  padding: '4px 8px',
                                  fontSize: 13,
                                }}
                              />
                              <Button
                                type="submit"
                                variant="secondary"
                                size="sm"
                                className="dh-glass-accent-btn"
                              >
                                Save
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setEditingTaskId(null)}
                              >
                                Cancel
                              </Button>
                            </form>
                          ) : (
                            <div
                              className="row"
                              style={{ gap: 8, flexWrap: 'wrap', cursor: 'pointer' }}
                              onClick={() => {
                                triggerHaptic('success');
                                onToggleTask(task.id);
                              }}
                            >
                              <span
                                className={`dh-task-title ${task.done ? 'done' : ''}`}
                              >
                                {task.title}
                              </span>
                              {sub && (
                                <span
                                  style={{
                                    fontSize: 12.5,
                                    color: 'var(--tx-3)',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 5,
                                  }}
                                >
                                  <span
                                    aria-hidden="true"
                                    className="dh-sub-dot"
                                    style={{ background: sub.color }}
                                  />
                                  {sub.name}
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        <button
                          type="button"
                          className="s"
                          aria-label={`Actions for ${task.title}`}
                          style={{ padding: '6px 10px', minHeight: 36 }}
                          onClick={() =>
                            setOpenTaskMenuId((cur) =>
                              cur === task.id ? null : task.id
                            )
                          }
                        >
                          <MoreHorizontal size={16} strokeWidth={1.75} />
                        </button>
                      </div>

                      {isMenuOpen && (
                        <div
                          className="row"
                          style={{
                            gap: 6,
                            marginTop: 8,
                            paddingTop: 8,
                            borderTop: '1px solid var(--line)',
                            flexWrap: 'wrap',
                          }}
                        >
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={<Edit3 size={13} strokeWidth={1.75} />}
                            onClick={() => {
                              setEditingTaskId(task.id);
                              setEditingTaskTitle(task.title);
                              setOpenTaskMenuId(null);
                            }}
                          >
                            Edit title
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={<CornerDownRight size={13} strokeWidth={1.75} />}
                            onClick={() => {
                              onChangeTaskDate(task.id, addD(task.dayKey, 1));
                              setOpenTaskMenuId(null);
                            }}
                          >
                            Move to tomorrow
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={<Calendar size={13} strokeWidth={1.75} />}
                            onClick={() => {
                              setChangingDateTaskId(task.id);
                              setOpenTaskMenuId(null);
                            }}
                          >
                            Change date
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            icon={<Trash2 size={13} strokeWidth={1.75} />}
                            onClick={() => {
                              onDeleteTask(task.id);
                              setOpenTaskMenuId(null);
                            }}
                          >
                            Delete
                          </Button>
                        </div>
                      )}

                      {isChangingDate && (
                        <div className="row" style={{ gap: 6, marginTop: 8 }}>
                          <input
                            type="date"
                            aria-label={`New date for task ${task.title}`}
                            defaultValue={task.dayKey}
                            onChange={(e) => {
                              if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) {
                                onChangeTaskDate(task.id, e.target.value);
                                setChangingDateTaskId(null);
                              }
                            }}
                            style={{ minHeight: 34, padding: '4px 8px', fontSize: 13 }}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setChangingDateTaskId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      )}
                      </div>
                    </SwipeableRow>
                  );
                }}
              />
            )}

            {/* Unfinished from earlier days */}
            {unfinishedEarlierTasks.length > 0 && (
              <div
                style={{
                  marginTop: 10,
                  paddingTop: 10,
                  borderTop: '1px solid var(--line)',
                }}
              >
                <div className="split" style={{ gap: 8 }}>
                  <button
                    type="button"
                    className="s"
                    aria-expanded={unfinishedExpanded}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      padding: '4px 0',
                      color: 'var(--warn-ink)',
                      fontSize: 13,
                      fontWeight: 600,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                    onClick={() => setUnfinishedExpanded((v) => !v)}
                  >
                    {unfinishedExpanded ? (
                      <ChevronUp size={15} strokeWidth={1.75} />
                    ) : (
                      <ChevronDown size={15} strokeWidth={1.75} />
                    )}
                    Unfinished from earlier days ({unfinishedEarlierTasks.length})
                  </button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={onMoveAllUnfinishedToToday}
                  >
                    Move all to today
                  </Button>
                </div>

                {unfinishedExpanded && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      marginTop: 8,
                    }}
                  >
                    {unfinishedEarlierTasks.map((t) => {
                      const sub = t.subjectId
                        ? state.subjects.find((s) => s.id === t.subjectId)
                        : undefined;
                      return (
                        <div
                          key={t.id}
                          className="split"
                          style={{
                            padding: '8px 10px',
                            borderRadius: 10,
                            background: 'var(--sf-2)',
                            border: '1px solid var(--line)',
                            gap: 8,
                          }}
                        >
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div
                              style={{
                                fontSize: 13,
                                fontWeight: 500,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {t.title}
                            </div>
                            <small style={{ fontSize: 13 }}>
                              From {t.dayKey} {sub ? `· ${sub.name}` : ''}
                            </small>
                          </div>
                          <div className="row" style={{ gap: 6 }}>
                            <Button
                              variant="secondary"
                              size="sm"
                              className="dh-glass-accent-btn"
                              onClick={() => onMoveTaskToToday(t.id)}
                            >
                              Today
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => onDeleteTask(t.id)}
                            >
                              Delete
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* 8. Revisions Due (Tier-0 Hairline Section on #000000) */}
          <section id="revisionsDueCard" className="dh-amoled-section">
            <div className="dh-eyebrow-row">
              <div className="row" style={{ gap: 8 }}>
                <h3 className="dh-eyebrow">Revisions due</h3>
                <span
                  className="dh-meta-count"
                  style={{
                    fontSize: 12,
                    color:
                      revisionsBundle.overdue.length > 0
                        ? 'var(--err-ink)'
                        : allRevisionsCount > 0
                          ? 'var(--ac-ink)'
                          : 'var(--tx-3)',
                  }}
                >
                  {allRevisionsCount}
                </span>
              </div>
              {studyNextItems.length === 0 && (
                <button
                  type="button"
                  className="dh-eyebrow-link"
                  onClick={() => onSwitchTab('prep')}
                >
                  <span>Syllabus</span>
                  <ChevronRight size={14} strokeWidth={1.6} aria-hidden="true" />
                </button>
              )}
            </div>

            {allRevisionsCount > 0 && (
              <div className="dh-edge-fade-rail">
                <Chip
                  selected={revSubjectFilter === 'all'}
                  onClick={() => setRevSubjectFilter('all')}
                >
                  All ({allRevisionsCount})
                </Chip>
                {activeSubjects.map((s) => {
                  const count =
                    revisionsBundle.overdue.filter((r) => r.subject.id === s.id)
                      .length +
                    revisionsBundle.dueOnSel.filter((r) => r.subject.id === s.id)
                      .length;
                  if (count === 0 && revSubjectFilter !== s.id) return null;
                  return (
                    <Chip
                      key={s.id}
                      selected={revSubjectFilter === s.id}
                      colorDot={s.color}
                      onClick={() => setRevSubjectFilter(s.id)}
                    >
                      {s.name} ({count})
                    </Chip>
                  );
                })}
              </div>
            )}

            {overdueRevisions.length === 0 && dueTodayRevisions.length === 0 ? (
              <div className="dh-empty-inline">
                <span>All caught up — no spaced revisions due today.</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {overdueRevisions.length > 0 && (
                  <div>
                    <div
                      className="row"
                      style={{
                        gap: 6,
                        fontSize: 12,
                        fontWeight: 600,
                        color: 'var(--err-ink)',
                        marginBottom: 4,
                      }}
                    >
                      <AlertCircle size={13} strokeWidth={1.8} />
                      <span>Overdue ({overdueRevisions.length})</span>
                    </div>
                    <div className="dh-hairline-list">
                      {overdueRevisions.map((item) => {
                        const isRescheduling =
                          rescheduleTarget?.chapterId === item.chapterId &&
                          rescheduleTarget?.revId === item.revisionId;
                        return (
                          <div
                            key={`${item.chapterId}_${item.revisionId}`}
                            style={{
                              padding: '11px 0',
                              borderBottom: '1px solid var(--hairline)',
                            }}
                          >
                            <div className="split" style={{ gap: 10 }}>
                              <div className="row" style={{ gap: 10, minWidth: 0, flex: 1 }}>
                                <button
                                  type="button"
                                  className="ck"
                                  aria-label={`Complete ${item.label} for ${item.chapterName}`}
                                  style={{
                                    width: 34,
                                    height: 34,
                                    minWidth: 34,
                                    minHeight: 34,
                                  }}
                                  onClick={() =>
                                    onCompleteRevision(
                                      item.chapterId,
                                      item.revisionId
                                    )
                                  }
                                >
                                  <Check size={15} strokeWidth={2} />
                                </button>
                                <div style={{ minWidth: 0 }}>
                                  <div className="row" style={{ gap: 7 }}>
                                    <span
                                      aria-hidden="true"
                                      className="dh-sub-dot"
                                      style={{ background: item.subject.color }}
                                    />
                                    <b
                                      style={{
                                        fontSize: 14,
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                      }}
                                    >
                                      {item.chapterName}
                                    </b>
                                  </div>
                                  <small style={{ fontSize: 12.5, color: 'var(--err-ink)', paddingLeft: 13 }}>
                                    {item.label} · {item.daysLate}d overdue ({item.date})
                                  </small>
                                </div>
                              </div>
                              <button
                                type="button"
                                className="dh-ghost-pill"
                                onClick={() =>
                                  setRescheduleTarget(
                                    isRescheduling
                                      ? null
                                      : {
                                          chapterId: item.chapterId,
                                          revId: item.revisionId,
                                          date: todayKey,
                                        }
                                  )
                                }
                              >
                                <Calendar size={13} strokeWidth={1.6} aria-hidden="true" />
                                <span>Reschedule</span>
                              </button>
                            </div>

                            {isRescheduling && rescheduleTarget && (
                              <div className="row" style={{ gap: 6, marginTop: 8 }}>
                                <input
                                  type="date"
                                  aria-label={`Reschedule overdue revision for ${item.chapterName}`}
                                  value={rescheduleTarget.date}
                                  onChange={(e) =>
                                    setRescheduleTarget({
                                      ...rescheduleTarget,
                                      date: e.target.value,
                                    })
                                  }
                                  style={{
                                    minHeight: 34,
                                    padding: '4px 8px',
                                    fontSize: 13,
                                  }}
                                />
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  className="dh-glass-accent-btn"
                                  onClick={() => {
                                    onRescheduleRevision(
                                      rescheduleTarget.chapterId,
                                      rescheduleTarget.revId,
                                      rescheduleTarget.date
                                    );
                                    setRescheduleTarget(null);
                                  }}
                                >
                                  Save
                                </Button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {dueTodayRevisions.length > 0 && (
                  <div>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: 'var(--ac-ink)',
                        marginBottom: 4,
                      }}
                    >
                      Due on {isTodaySelected ? 'today' : sel} ({dueTodayRevisions.length})
                    </div>
                    <div className="dh-hairline-list">
                      {dueTodayRevisions.map((item) => {
                        const isRescheduling =
                          rescheduleTarget?.chapterId === item.chapterId &&
                          rescheduleTarget?.revId === item.revisionId;
                        return (
                          <div
                            key={`${item.chapterId}_${item.revisionId}`}
                            style={{
                              padding: '11px 0',
                              borderBottom: '1px solid var(--hairline)',
                            }}
                          >
                            <div className="split" style={{ gap: 10 }}>
                              <div className="row" style={{ gap: 10, minWidth: 0, flex: 1 }}>
                                <button
                                  type="button"
                                  className="ck"
                                  aria-label={`Complete ${item.label} for ${item.chapterName}`}
                                  style={{
                                    width: 34,
                                    height: 34,
                                    minWidth: 34,
                                    minHeight: 34,
                                  }}
                                  onClick={() =>
                                    onCompleteRevision(
                                      item.chapterId,
                                      item.revisionId
                                    )
                                  }
                                >
                                  <Check size={15} strokeWidth={2} />
                                </button>
                                <div style={{ minWidth: 0 }}>
                                  <div className="row" style={{ gap: 7 }}>
                                    <span
                                      aria-hidden="true"
                                      className="dh-sub-dot"
                                      style={{ background: item.subject.color }}
                                    />
                                    <b
                                      style={{
                                        fontSize: 14,
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                      }}
                                    >
                                      {item.chapterName}
                                    </b>
                                  </div>
                                  <small style={{ fontSize: 12.5, paddingLeft: 13 }}>
                                    {item.subject.name} · {item.label} due
                                  </small>
                                </div>
                              </div>
                              <button
                                type="button"
                                className="dh-ghost-pill"
                                onClick={() =>
                                  setRescheduleTarget(
                                    isRescheduling
                                      ? null
                                      : {
                                          chapterId: item.chapterId,
                                          revId: item.revisionId,
                                          date: addD(todayKey, 1),
                                        }
                                  )
                                }
                              >
                                <Calendar size={13} strokeWidth={1.6} aria-hidden="true" />
                                <span>Reschedule</span>
                              </button>
                            </div>

                            {isRescheduling && rescheduleTarget && (
                              <div className="row" style={{ gap: 6, marginTop: 8 }}>
                                <input
                                  type="date"
                                  aria-label={`Reschedule revision for ${item.chapterName}`}
                                  value={rescheduleTarget.date}
                                  onChange={(e) =>
                                    setRescheduleTarget({
                                      ...rescheduleTarget,
                                      date: e.target.value,
                                    })
                                  }
                                  style={{
                                    minHeight: 34,
                                    padding: '4px 8px',
                                    fontSize: 13,
                                  }}
                                />
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  className="dh-glass-accent-btn"
                                  onClick={() => {
                                    onRescheduleRevision(
                                      rescheduleTarget.chapterId,
                                      rescheduleTarget.revId,
                                      rescheduleTarget.date
                                    );
                                    setRescheduleTarget(null);
                                  }}
                                >
                                  Save
                                </Button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* 9. Habits Section (Auto-hides 7-pill category strip when <4 habits or <2 categories) */}
          <section className="dh-amoled-section">
            <SectionHeader
              title={`Habits · ${dayProg.habitsDone}/${dayProg.habitsTotal}`}
              action={
                <button
                  type="button"
                  className="dh-eyebrow-link"
                  onClick={onNewHabit}
                >
                  <Plus size={14} strokeWidth={1.8} aria-hidden="true" />
                  <span>Add</span>
                </button>
              }
            />

            {showHabitCatFilter && (
              <div className="dh-edge-fade-rail">
                <Chip selected={cat === 'All'} onClick={() => onSelectCat('All')}>
                  All
                </Chip>
                {CATS.map((c) => (
                  <Chip key={c} selected={cat === c} onClick={() => onSelectCat(c)}>
                    {c}
                  </Chip>
                ))}
              </div>
            )}

            {allLiveHabits.length === 0 ? (
              <div
                style={{
                  padding: '14px 0',
                  borderTop: '1px solid var(--hairline)',
                  borderBottom: '1px solid var(--hairline)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div className="split" style={{ gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13.5, color: 'var(--tx-2)' }}>
                    No habits yet — pick a starter or create one.
                  </span>
                  <button
                    type="button"
                    className="dh-ghost-pill"
                    onClick={onNewHabit}
                  >
                    + Custom habit
                  </button>
                </div>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {STARTERS.map((s, i) => (
                    <Chip key={i} onClick={() => onAddStarter(i)}>
                      + {s.name}
                    </Chip>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {dueList.length > 0 ? (
                  <div className="dh-hairline-list">
                    {dueList.map(renderHabitRow)}
                  </div>
                ) : (
                  <div className="dh-empty-inline">
                    <span>No habits scheduled in this category today.</span>
                  </div>
                )}

                {otherList.length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    <button
                      type="button"
                      className="dh-eyebrow-link"
                      aria-expanded={showUnscheduled}
                      onClick={() => setShowUnscheduled((v) => !v)}
                    >
                      {showUnscheduled ? (
                        <ChevronUp size={14} strokeWidth={1.6} />
                      ) : (
                        <ChevronDown size={14} strokeWidth={1.6} />
                      )}
                      <span>Not scheduled today ({otherList.length})</span>
                    </button>
                    {showUnscheduled && (
                      <div className="dh-hairline-list" style={{ marginTop: 4, opacity: 0.78 }}>
                        {otherList.map(renderHabitRow)}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          {/* 10. Quiet Editorial Focus Tip Note on #000000 */}
          <section className="dh-amoled-section dh-editorial-note">
            <div className="dh-eyebrow-row">
              <div className="row" style={{ gap: 6 }}>
                <Lightbulb
                  size={13}
                  strokeWidth={1.6}
                  style={{ color: 'var(--tx-3)', flexShrink: 0 }}
                  aria-hidden="true"
                />
                <h3 className="dh-eyebrow">Focus tip · {dailyTip.tag}</h3>
              </div>
              <button
                type="button"
                className="dh-eyebrow-link"
                onClick={() => setTipOffset((n) => n + 1)}
              >
                <RotateCw size={12} strokeWidth={1.7} aria-hidden="true" />
                <span>Next</span>
              </button>
            </div>
            <div style={{ minWidth: 0 }}>
              <b style={{ fontSize: 14, fontWeight: 600, display: 'block', marginBottom: 2, color: 'var(--tx)' }}>
                {dailyTip.title}
              </b>
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  lineHeight: 1.45,
                  color: 'var(--tx-2)',
                }}
              >
                {dailyTip.tip}
              </p>
            </div>
          </section>
        </div>

        {/* Right Rail on Desktop >=1100px: Today's Timeline + Collapsible Evening Check-in */}
        <aside className="today-rail-col dh-today-flow">
          {/* Today's Study Sessions Timeline (Tier-0 Hairline Section) */}
          <section className="dh-amoled-section">
            <div className="dh-eyebrow-row">
              <h3 className="dh-eyebrow">
                {isTodaySelected ? "Today's timeline" : `Sessions · ${sel}`}
              </h3>
              <button
                type="button"
                className="dh-eyebrow-link"
                onClick={() => onOpenManualSession(effectiveQuickSubId)}
              >
                <Plus size={14} strokeWidth={1.8} aria-hidden="true" />
                <span>Log hours</span>
              </button>
            </div>

            {selectedDaySessions.length === 0 ? (
              <div className="dh-empty-inline">
                <span>No study sessions logged yet.</span>
                <button
                  type="button"
                  className="dh-eyebrow-link"
                  onClick={() => onOpenManualSession(effectiveQuickSubId)}
                >
                  <span>Log hours ›</span>
                </button>
              </div>
            ) : (
              <WindowedList
                items={selectedDaySessions}
                threshold={100}
                estimatedRowHeight={68}
                itemLabel="sessions"
                className="dh-hairline-list"
                getKey={(ses: StudySession) => ses.id}
                renderItem={(ses: StudySession) => {
                  const sub = getSubject(state, ses.subjectId);
                  const heading = getSessionHeading(state, ses);
                  return (
                    <div className="dh-hairline-row">
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="row" style={{ gap: 7, flexWrap: 'wrap' }}>
                          <span
                            aria-hidden="true"
                            className="dh-sub-dot"
                            style={{ background: sub.color }}
                          />
                          <b
                            style={{
                              fontSize: 14,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {heading}
                          </b>
                          <span
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: 'var(--tx-2)',
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            · {fmtHMShort(ses.activeMs)}
                          </span>
                        </div>
                        <small
                          style={{
                            display: 'block',
                            marginTop: 2,
                            paddingLeft: 13,
                            fontSize: 12.5,
                            color: 'var(--tx-3)',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {sub.name} · {fmtClockTime(ses.startTs)} –{' '}
                          {fmtClockTime(ses.endTs)} · {ses.purity || 100}% purity
                        </small>
                        {ses.note && (
                          <small
                            style={{
                              display: 'block',
                              marginTop: 2,
                              paddingLeft: 13,
                              fontSize: 12.5,
                              color: 'var(--tx-2)',
                            }}
                          >
                            "{ses.note}"
                          </small>
                        )}
                      </div>
                      <button
                        type="button"
                        className="s"
                        aria-label={`Delete session ${heading}`}
                        style={{
                          color: 'var(--tx-3)',
                          padding: '6px 8px',
                          background: 'transparent',
                          border: 0,
                        }}
                        onClick={() => onDeleteSession(ses.id)}
                      >
                        <Trash2 size={14} strokeWidth={1.6} />
                      </button>
                    </div>
                  );
                }}
              />
            )}
          </section>

          {/* Daily Reflection & Wellbeing (Collapsible 1-Line Evening Check-in Trigger) */}
          {(() => {
            const hasLoggedCheckin = Boolean(
              state.mood[sel] ||
                typeof sleepHours === 'number' ||
                typeof energyLevel === 'number' ||
                (state.notes[sel] || '').trim().length > 0
            );
            const isCheckinOpen = checkinOpen || hasLoggedCheckin;
            return (
              <section id="wellbeingReflectionCard" className="dh-amoled-section">
                {!isCheckinOpen ? (
                  <button
                    type="button"
                    className="dh-checkin-trigger"
                    aria-expanded={false}
                    onClick={() => {
                      triggerHaptic('tap');
                      setCheckinOpen(true);
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <span className="dh-eyebrow" style={{ display: 'block', color: 'var(--tx)' }}>
                        Evening check-in
                      </span>
                      <span style={{ fontSize: 12.5, color: 'var(--tx-3)' }}>
                        Mood, sleep, energy &amp; reflection note
                      </span>
                    </div>
                    <ChevronRight size={16} strokeWidth={1.6} style={{ color: 'var(--tx-3)', flexShrink: 0 }} aria-hidden="true" />
                  </button>
                ) : (
                  <>
                    <div className="dh-eyebrow-row">
                      <h3 className="dh-eyebrow">Reflection &amp; wellbeing</h3>
                      {!hasLoggedCheckin && (
                        <button
                          type="button"
                          className="dh-eyebrow-link"
                          onClick={() => setCheckinOpen(false)}
                        >
                          Hide
                        </button>
                      )}
                    </div>

                    {/* Mood Selector */}
                    <div>
                      <div className="row" style={{ gap: 6 }}>
                        {MOOD_ITEMS.map(([val, emoji, label]) => {
                          const isSel = state.mood[sel] === val;
                          return (
                            <button
                              key={val}
                              type="button"
                              aria-label={`Set study mood: ${label}`}
                              aria-pressed={isSel}
                              onClick={() => onSetMood(val)}
                              style={{
                                flex: 1,
                                fontSize: 16,
                                padding: '8px 0',
                                borderRadius: 12,
                                background: isSel ? 'var(--ac-soft)' : 'rgba(255,255,255,0.04)',
                                border: isSel
                                  ? '1px solid var(--ac)'
                                  : '1px solid var(--hairline)',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: 2,
                              }}
                            >
                              <span>{emoji}</span>
                              <span
                                style={{
                                  fontSize: 12,
                                  color: isSel ? 'var(--ac-ink)' : 'var(--tx-2)',
                                  fontWeight: isSel ? 600 : 500,
                                }}
                              >
                                {label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Sleep & Energy Hairline Ledger Row */}
                    <div
                      className="row"
                      style={{
                        gap: 12,
                        flexWrap: 'wrap',
                        padding: '10px 0',
                        borderTop: '1px solid var(--hairline)',
                        borderBottom: '1px solid var(--hairline)',
                      }}
                    >
                      <div
                        style={{
                          flex: '1 1 130px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 6,
                        }}
                      >
                        <div>
                          <div
                            className="row"
                            style={{ gap: 4, fontSize: 12, color: 'var(--tx-3)' }}
                          >
                            <Moon size={12} strokeWidth={1.6} />
                            <span>Sleep</span>
                          </div>
                          <b style={{ fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>
                            {typeof sleepHours === 'number' ? `${sleepHours}h` : '—'}
                          </b>
                        </div>
                        <div className="row" style={{ gap: 4 }}>
                          <button
                            type="button"
                            className="s"
                            aria-label="Decrease sleep hours"
                            onClick={() => {
                              const base = typeof sleepHours === 'number' ? sleepHours : 7;
                              onUpdateWellbeing(sel, {
                                sleep: Math.max(0, +(base - 0.5).toFixed(1)),
                              });
                            }}
                          >
                            −
                          </button>
                          <button
                            type="button"
                            className="s"
                            aria-label="Increase sleep hours"
                            onClick={() => {
                              const base = typeof sleepHours === 'number' ? sleepHours : 7;
                              onUpdateWellbeing(sel, {
                                sleep: Math.min(14, +(base + 0.5).toFixed(1)),
                              });
                            }}
                          >
                            +
                          </button>
                        </div>
                      </div>

                      <div style={{ flex: '1 1 150px' }}>
                        <div
                          className="row"
                          style={{
                            gap: 4,
                            fontSize: 12,
                            color: 'var(--tx-3)',
                            marginBottom: 4,
                          }}
                        >
                          <Zap size={12} strokeWidth={1.6} />
                          <span>Energy (1–5)</span>
                        </div>
                        <div className="row" style={{ gap: 4 }}>
                          {([1, 2, 3, 4, 5] as const).map((lvl) => {
                            const isLit = energyLevel === lvl;
                            return (
                              <button
                                key={lvl}
                                type="button"
                                aria-label={`Set energy level ${lvl} of 5`}
                                aria-pressed={isLit}
                                onClick={() => onUpdateWellbeing(sel, { energy: lvl })}
                                style={{
                                  flex: 1,
                                  padding: '5px 0',
                                  minHeight: 32,
                                  fontSize: 13,
                                  fontWeight: 600,
                                  borderRadius: 8,
                                  background: isLit ? 'var(--ac-soft)' : 'rgba(255,255,255,0.04)',
                                  color: isLit ? 'var(--ac-ink)' : 'var(--tx-2)',
                                  border: isLit
                                    ? '1px solid var(--ac)'
                                    : '1px solid var(--hairline)',
                                  fontVariantNumeric: 'tabular-nums',
                                }}
                              >
                                {lvl}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    <textarea
                      id="note"
                      rows={3}
                      aria-label="Daily study reflection note"
                      placeholder="Wins, distractions, or tomorrow's #1 priority..."
                      value={state.notes[sel] || ''}
                      onChange={(e) => onSetNote(e.target.value)}
                    />
                  </>
                )}
              </section>
            );
          })()}
        </aside>
      </div>

      {/* Frosted Focus Config BottomSheet */}
      <BottomSheet
        open={focusConfigOpen}
        onClose={() => setFocusConfigOpen(false)}
        title="Focus setup"
        subtitle="Choose subject, timer mode, and optional chapter"
        footer={
          <div style={{ display: 'grid', gap: 8 }}>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              className="dh-focus-cta"
              icon={<Play size={17} strokeWidth={2.25} />}
              onClick={() => {
                setFocusConfigOpen(false);
                onQuickStartSession(
                  effectiveQuickSubId,
                  quickHeading,
                  quickMode,
                  effectiveQuickChapId || undefined
                );
              }}
            >
              Start focus
            </Button>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Button
                variant="secondary"
                size="md"
                className="dh-glass-btn"
                onClick={() => setFocusConfigOpen(false)}
              >
                Save setup
              </Button>
              <Button
                variant="secondary"
                size="md"
                className="dh-glass-btn"
                icon={<Plus size={14} strokeWidth={2} />}
                onClick={() => {
                  setFocusConfigOpen(false);
                  onOpenManualSession(
                    effectiveQuickSubId,
                    effectiveQuickChapId || undefined
                  );
                }}
              >
                Log hours
              </Button>
            </div>
          </div>
        }
      >
        <div className="dh-sheet-field">
          <span className="dh-sheet-field-label">Subject</span>
          <div className="dh-edge-fade-rail" role="radiogroup" aria-label="Focus subject">
            {activeSubjects.map((s) => (
              <Chip
                key={s.id}
                selected={effectiveQuickSubId === s.id}
                colorDot={s.color}
                onClick={() => {
                  setQuickSubjectId(s.id);
                  setQuickChapterId('');
                }}
              >
                {s.e} {s.name}
              </Chip>
            ))}
          </div>
        </div>

        <div className="dh-sheet-field">
          <span className="dh-sheet-field-label">Timer mode</span>
          <div className="dh-mode-grid" role="radiogroup" aria-label="Timer mode">
            <button
              type="button"
              role="radio"
              aria-checked={quickMode === 'pomo'}
              className={`dh-mode-tile ${quickMode === 'pomo' ? 'active' : ''}`}
              onClick={() => setQuickMode('pomo')}
            >
              <Timer size={16} strokeWidth={1.75} aria-hidden="true" />
              <span>Pomodoro</span>
              <span className="dh-mode-tile-sub">{state.set.pomoWork || 25}m</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={quickMode === 'countdown'}
              className={`dh-mode-tile ${quickMode === 'countdown' ? 'active' : ''}`}
              onClick={() => setQuickMode('countdown')}
            >
              <Hourglass size={16} strokeWidth={1.75} aria-hidden="true" />
              <span>Countdown</span>
              <span className="dh-mode-tile-sub">
                {state.set.countdownMins || 45}m
              </span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={quickMode === 'stopwatch'}
              className={`dh-mode-tile ${quickMode === 'stopwatch' ? 'active' : ''}`}
              onClick={() => setQuickMode('stopwatch')}
            >
              <Clock size={16} strokeWidth={1.75} aria-hidden="true" />
              <span>Stopwatch</span>
              <span className="dh-mode-tile-sub">Open</span>
            </button>
          </div>
        </div>

        {quickSubjectChapters.length > 0 && (
          <div className="dh-sheet-field">
            <span className="dh-sheet-field-label">Syllabus chapter (optional)</span>
            <Select
              aria-label="Link syllabus chapter"
              title="Link syllabus chapter"
              value={effectiveQuickChapId}
              options={quickChapterOptions}
              onChange={(val) => {
                setQuickChapterId(val);
                const ch = quickSubjectChapters.find((c) => c.id === val);
                if (ch && !quickHeading.trim()) {
                  setQuickHeading(ch.name);
                }
              }}
              placeholder="Link chapter (optional)"
            />
          </div>
        )}

        <div className="dh-sheet-field">
          <label htmlFor="focusTopicInput" className="dh-sheet-field-label">
            Session topic or goal (optional)
          </label>
          <input
            id="focusTopicInput"
            type="text"
            aria-label="Session topic or goal"
            placeholder="e.g. 30 Electrostatics PYQs"
            value={quickHeading}
            onChange={(e) => setQuickHeading(e.target.value)}
            style={{ width: '100%', minHeight: 48, fontSize: 15 }}
          />
        </div>
      </BottomSheet>

      {/* Frosted Daily Task Composer BottomSheet */}
      <BottomSheet
        open={taskComposerOpen}
        onClose={() => setTaskComposerOpen(false)}
        title={isTodaySelected ? 'New task for today' : `New task for ${sel}`}
        subtitle="Keep daily targets crisp and actionable"
        footer={
          <Button
            type="submit"
            form="dh-task-composer-form"
            variant="primary"
            size="lg"
            fullWidth
            className="dh-focus-cta"
            disabled={!newTaskTitle.trim()}
            icon={<Plus size={17} strokeWidth={2.25} />}
          >
            Add task
          </Button>
        }
      >
        <form
          id="dh-task-composer-form"
          style={{ display: 'grid', gap: 14 }}
          onSubmit={(e) => {
            e.preventDefault();
            const clean = newTaskTitle.trim();
            if (!clean) return;
            onAddTask(clean, sel, newTaskSubjectId || undefined);
            setNewTaskTitle('');
            setTaskComposerOpen(false);
          }}
        >
          <div className="dh-sheet-field">
            <label htmlFor="dailyTaskTitleInput" className="dh-sheet-field-label">
              Task title
            </label>
            <input
              id="dailyTaskTitleInput"
              data-sheet-autofocus
              type="text"
              aria-label="New daily task title"
              placeholder="What do you want to finish?"
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              style={{ width: '100%', minHeight: 48, fontSize: 15 }}
            />
          </div>

          <div className="dh-sheet-field">
            <span className="dh-sheet-field-label">Subject tag</span>
            <div className="dh-edge-fade-rail" role="radiogroup" aria-label="Task subject">
              <Chip
                selected={newTaskSubjectId === ''}
                onClick={() => setNewTaskSubjectId('')}
              >
                General
              </Chip>
              {activeSubjects.map((s) => (
                <Chip
                  key={s.id}
                  selected={newTaskSubjectId === s.id}
                  colorDot={s.color}
                  onClick={() => setNewTaskSubjectId(s.id)}
                >
                  {s.name}
                </Chip>
              ))}
            </div>
          </div>
        </form>
      </BottomSheet>
    </div>
  );
};
