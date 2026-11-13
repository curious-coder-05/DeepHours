import React, { useMemo, useState } from 'react';
import {
  Plus,
  Check,
  Flame,
  SkipForward,
  MoreHorizontal,
  Calendar,
  Trash2,
  ArrowRight,
  Timer,
  Hourglass,
  Clock,
  Play,
  Lightbulb,
  RotateCw,
  HeartHandshake,
  Sparkles,
  Moon,
  Zap,
  BookOpen,
  Target,
  Compass,
  Repeat,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Edit3,
  CornerDownRight,
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
  getDailyStudyGoalProgress,
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
import { computeUiPaceReport } from '../utils/uiHelpers';
import { StatusRow, ExamCountdownCard } from './StatusRow';
import {
  Button,
  Card,
  Chip,
  ProgressRing,
  Meter,
  Select,
  SectionHeader,
  SwipeableRow,
  WindowedList,
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
}) => {
  const [quickSubjectId, setQuickSubjectId] = useState<string>(
    () => state.subjects.find((s) => !s.arch)?.id || 'sub_phy'
  );
  const [quickChapterId, setQuickChapterId] = useState<string>('');
  const [quickHeading, setQuickHeading] = useState<string>('');
  const [tipOffset, setTipOffset] = useState<number>(0);

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

  const isTodaySelected = sel === todayKey;
  const selDate = parseD(sel);

  // 7-day rolling week strip ending on todayKey
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addD(todayKey, i - 6)),
    [todayKey]
  );

  const dayProg = useMemo(() => getDayProgress(state, sel), [state, sel]);
  const p = Math.round(dayProg.pct * 100);

  const allLiveHabits = useMemo(() => live(state), [state]);
  const filteredHabits = useMemo(
    () =>
      allLiveHabits.filter((h) => (cat === 'All' ? true : h.c === cat)),
    [allLiveHabits, cat]
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
    () => getDailyStudyGoalProgress(state, sel, todayKey),
    [state, sel, todayKey]
  );
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

  const taskSubjectOptions = useMemo(
    () => [
      { value: '', label: 'General (no subject)' },
      ...activeSubjects.map((s) => ({
        value: s.id,
        label: `${s.e} ${s.name}`,
        swatchColor: s.color,
      })),
    ],
    [activeSubjects]
  );

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
    if (h.tn > 1) metaParts.push(`${cur}/${h.tn} ${h.tu || ''}`.trim());
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
          className={`c ${isD ? 'dn' : ''} ${isSk ? 'sk' : ''}`}
          onClick={() => onToggleHabit(h.id, sel)}
        >
        <button
          type="button"
          className="ck"
          aria-label={`Mark ${h.name} complete`}
          onClick={(ev) => {
            ev.stopPropagation();
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
                  fontSize: 12,
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
                className="pill"
                style={{
                  fontSize: 12,
                  padding: '2px 8px',
                  background: 'var(--sf-2)',
                  color: 'var(--tx-2)',
                  border: '1px solid var(--line)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: linkedSub.color,
                  }}
                />
                {linkedSub.e} {linkedSub.name}
              </span>
            )}
          </div>

          <div className="row" style={{ gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
            <small style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
              {metaParts.join(' · ')}
            </small>
            {s.cur > 0 && (
              <span
                className="pill"
                style={{
                  fontSize: 12,
                  padding: '2px 8px',
                  background: 'color-mix(in srgb, var(--warn) 14%, transparent)',
                  color: 'var(--warn-ink)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Flame size={12} strokeWidth={2} />
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
                label={`${h.name} progress`}
              />
            </div>
          )}
        </div>

        <div
          className="row"
          style={{ gap: 4, flexShrink: 0 }}
          onClick={(ev) => ev.stopPropagation()}
        >
          {h.tn > 1 && (
            <>
              <button
                type="button"
                className="s"
                aria-label={`Decrease ${h.name}`}
                onClick={() => onIncrementHabit(h.id, -1)}
              >
                −
              </button>
              <button
                type="button"
                className="s"
                aria-label={`Increase ${h.name}`}
                onClick={() => onIncrementHabit(h.id, 1)}
              >
                +
              </button>
            </>
          )}
          <button
            type="button"
            className="s"
            title="Skip today (preserves streak)"
            aria-label={`Skip ${h.name} today`}
            style={{ padding: '6px 10px' }}
            onClick={() => onSkipHabit(h.id, sel)}
          >
            <SkipForward size={15} strokeWidth={1.75} />
          </button>
        </div>
        </div>
      </SwipeableRow>
    );
  };

  return (
    <div>
      {/* 1. Status Row (Streak, Consistency, Level, Rest Day) */}
      <StatusRow
        state={state}
        sel={sel}
        todayKey={todayKey}
        minStreakInfo={minStreakInfo}
        consistencyInfo={consistencyInfo}
        onToggleRestDay={onToggleRestDay}
      />

      {/* 2. Exam Countdown + Syllabus Pace Row */}
      <div
        className="row"
        style={{
          gap: 10,
          flexWrap: 'wrap',
          marginBottom: 10,
          alignItems: 'stretch',
        }}
      >
        <div style={{ flex: '1 1 250px', minWidth: 0 }}>
          <ExamCountdownCard
            state={state}
            todayKey={todayKey}
            onManageExams={onManageExams || (() => onSwitchTab('more'))}
            onAddExam={onNewDDay}
          />
        </div>

        {paceReport.exam && !paceReport.pastExam && paceReport.totalChapters > 0 && (
          <button
            type="button"
            onClick={() => onSwitchTab('prep')}
            style={{
              flex: '1 1 220px',
              margin: '6px 0 10px',
              padding: '12px 14px',
              borderRadius: 14,
              background: 'var(--sf-1)',
              border: '1px solid var(--line)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              textAlign: 'left',
              minHeight: 52,
              cursor: 'pointer',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <span
                style={{
                  display: 'block',
                  fontSize: 12,
                  color: 'var(--tx-2)',
                  fontWeight: 500,
                }}
              >
                Syllabus pace
              </span>
              <span
                style={{
                  display: 'block',
                  fontSize: 13,
                  fontWeight: 600,
                  color:
                    paceReport.status === 'ahead'
                      ? 'var(--ok-ink)'
                      : paceReport.status === 'behind'
                        ? 'var(--warn-ink)'
                        : 'var(--ac-ink)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {paceReport.compactSummary}
              </span>
            </div>
            <ArrowRight
              size={16}
              strokeWidth={1.75}
              style={{ color: 'var(--tx-3)', flexShrink: 0 }}
            />
          </button>
        )}
      </div>

      {/* 3. Gentle Pace & Wellbeing Check-In (when visible) */}
      {burnoutStatus.visible && (
        <Card
          style={{
            marginBottom: 12,
            borderLeft: '3px solid var(--info)',
          }}
        >
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
                const el = document.getElementById('wellbeingReflectionCard');
                if (el) el.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              Log sleep & energy
            </Button>
          </div>
        </Card>
      )}

      {/* 4. 7-Day Rolling Week Strip */}
      <div className="wk" role="group" aria-label="7-day date selector">
        {days.map((k) => {
          const d = parseD(k);
          const dp = Math.round(getDayProgress(state, k).pct * 100);
          return (
            <button
              key={k}
              type="button"
              className={k === sel ? 'on' : ''}
              onClick={() => onSelectDay(k)}
            >
              <small style={{ fontSize: 12 }}>{DN[d.getDay()]}</small>
              <b>{d.getDate()}</b>
              <i style={{ '--p': dp } as React.CSSProperties} />
            </button>
          );
        })}
      </div>

      {!isTodaySelected && (
        <div
          className="split"
          style={{
            background: 'var(--sf-1)',
            border: '1px solid var(--ac-line)',
            borderRadius: 'var(--r-card)',
            padding: '10px 14px',
            marginBottom: 12,
          }}
        >
          <div className="row" style={{ gap: 8 }}>
            <Calendar size={16} strokeWidth={1.75} style={{ color: 'var(--ac-ink)' }} />
            <span style={{ fontSize: 13 }}>
              Viewing{' '}
              <b>
                {selDate.toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}
              </b>
            </span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onSelectDay(todayKey)}
          >
            Return to today
          </Button>
        </div>
      )}

      {/* Desktop 1100px+ Two-Column Workspace */}
      <div className="today-desktop-layout">
        <div className="today-main-col">
          {/* 5. Top Hero Progress + Primary Focus Session Starter */}
          <Card style={{ marginTop: 4 }}>
            <div className="hero-grid">
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <ProgressRing
                  pct={p}
                  size={116}
                  strokeWidth={10}
                  color={p === 100 && dayProg.total > 0 ? 'var(--ok)' : 'var(--ac)'}
                >
                  <div>
                    <b
                      style={{
                        fontSize: 24,
                        fontWeight: 700,
                        lineHeight: 1.05,
                        display: 'block',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {p}%
                    </b>
                    <small style={{ fontSize: 12, color: 'var(--tx-2)' }}>
                      {dayProg.habitsTotal > 0 || dayProg.tasksTotal > 0
                        ? `${dayProg.habitsDone}/${dayProg.habitsTotal}h · ${dayProg.tasksDone}/${dayProg.tasksTotal}t`
                        : 'Daily goal'}
                    </small>
                  </div>
                </ProgressRing>
              </div>

              <div style={{ minWidth: 0 }}>
                <div className="stat-mini">
                  <div className="stat-box">
                    <small style={{ fontSize: 12 }}>Studied</small>
                    <b style={{ color: 'var(--ac-ink)' }}>
                      {fmtHMShort(selectedDayTotalMs)}
                    </b>
                    <small style={{ fontSize: 12 }}>
                      {studyProg.goalMs > 0
                        ? `${studyProg.pct}% of ${fmtDuration(studyProg.goalMs)} goal`
                        : `${selectedDaySessions.length} session${
                            selectedDaySessions.length === 1 ? '' : 's'
                          }`}
                    </small>
                  </div>
                  <div className="stat-box">
                    <small style={{ fontSize: 12 }}>Focus purity</small>
                    <b
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
                    <small style={{ fontSize: 12 }}>
                      {selectedDaySessions.length} session
                      {selectedDaySessions.length === 1 ? '' : 's'}
                    </small>
                  </div>
                </div>

                {studyProg.goalMs > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div className="split" style={{ marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: 'var(--tx-2)' }}>
                        Daily study target
                      </span>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color:
                            studyProg.pct >= 100 ? 'var(--ok-ink)' : 'var(--tx)',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {fmtDuration(studyProg.studiedMs)} /{' '}
                        {fmtDuration(studyProg.goalMs)}
                      </span>
                    </div>
                    <Meter
                      value={studyProg.pct}
                      color={studyProg.pct >= 100 ? 'var(--ok)' : 'var(--ac)'}
                      label="Daily study target progress"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Primary Focus Starter embedded directly in top Hero card */}
            <div
              style={{
                marginTop: 16,
                paddingTop: 14,
                borderTop: '1px solid var(--line)',
              }}
            >
              {state.activeTimer ? (
                <div
                  className="split"
                  style={{
                    padding: '10px 12px',
                    borderRadius: 12,
                    background: 'var(--ac-soft)',
                    border: '1px solid var(--ac-line)',
                    gap: 10,
                    flexWrap: 'wrap',
                  }}
                >
                  <div className="row" style={{ gap: 10 }}>
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background:
                          state.activeTimer.status === 'running'
                            ? 'var(--ok)'
                            : 'var(--warn)',
                      }}
                    />
                    <div>
                      <b style={{ fontSize: 14, display: 'block' }}>
                        {state.activeTimer.status === 'running'
                          ? 'Focus session running'
                          : 'Focus session paused'}
                      </b>
                      <span style={{ fontSize: 12, color: 'var(--tx-2)' }}>
                        {getSubject(state, state.activeTimer.subjectId).name} ·{' '}
                        {state.activeTimer.heading || 'Deep study'}
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Play size={14} strokeWidth={2} />}
                    onClick={() => onSwitchTab('focus')}
                  >
                    Open timer
                  </Button>
                </div>
              ) : (
                <div>
                  <div className="split" style={{ marginBottom: 8 }}>
                    <div className="row" style={{ gap: 6 }}>
                      <Timer
                        size={16}
                        strokeWidth={1.75}
                        style={{ color: 'var(--ac-ink)' }}
                      />
                      <b style={{ fontSize: 14 }}>Start a focus session</b>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Plus size={14} strokeWidth={2} />}
                      onClick={() =>
                        onOpenManualSession(
                          effectiveQuickSubId,
                          effectiveQuickChapId || undefined
                        )
                      }
                    >
                      Log hours
                    </Button>
                  </div>

                  {/* Subject Selector Chips */}
                  <div
                    className="row"
                    style={{
                      gap: 6,
                      overflowX: 'auto',
                      paddingBottom: 6,
                      scrollbarWidth: 'none',
                    }}
                  >
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

                  {/* Chapter Sheet Picker + Session Heading Input */}
                  <div
                    className="row"
                    style={{
                      gap: 8,
                      marginTop: 6,
                      flexWrap: 'wrap',
                      alignItems: 'stretch',
                    }}
                  >
                    {quickSubjectChapters.length > 0 && (
                      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
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
                    <input
                      type="text"
                      aria-label="Session topic or goal"
                      placeholder="Session topic or goal (optional)"
                      value={quickHeading}
                      onChange={(e) => setQuickHeading(e.target.value)}
                      style={{ flex: '1 1 200px', minHeight: 44, fontSize: 14 }}
                    />
                  </div>

                  {/* Mode Launch Buttons */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(128px, 1fr))',
                      gap: 8,
                      marginTop: 10,
                    }}
                  >
                    <Button
                      variant="primary"
                      size="sm"
                      icon={<Timer size={15} strokeWidth={1.75} />}
                      onClick={() =>
                        onQuickStartSession(
                          effectiveQuickSubId,
                          quickHeading,
                          'pomo',
                          effectiveQuickChapId || undefined
                        )
                      }
                    >
                      Pomodoro ({state.set.pomoWork || 25}m)
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Hourglass size={15} strokeWidth={1.75} />}
                      onClick={() =>
                        onQuickStartSession(
                          effectiveQuickSubId,
                          quickHeading,
                          'countdown',
                          effectiveQuickChapId || undefined
                        )
                      }
                    >
                      Countdown ({state.set.countdownMins || 45}m)
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Clock size={15} strokeWidth={1.75} />}
                      onClick={() =>
                        onQuickStartSession(
                          effectiveQuickSubId,
                          quickHeading,
                          'stopwatch',
                          effectiveQuickChapId || undefined
                        )
                      }
                    >
                      Stopwatch
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* 6. Subject Daily Targets (when configured) */}
          {subjectTargets.length > 0 && (
            <Card>
              <div className="split" style={{ marginBottom: 10 }}>
                <div className="row" style={{ gap: 8 }}>
                  <Target
                    size={18}
                    strokeWidth={1.75}
                    style={{ color: 'var(--ac-ink)' }}
                  />
                  <h3 style={{ margin: 0, fontSize: 16 }}>Subject targets</h3>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onSwitchTab('more')}
                >
                  Edit targets
                </Button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {subjectTargets.map((row) => (
                  <div
                    key={row.subjectId}
                    style={{
                      background: 'var(--sf-2)',
                      borderRadius: 12,
                      padding: '10px 12px',
                      border: '1px solid var(--line)',
                    }}
                  >
                    <div className="split" style={{ marginBottom: 6, gap: 8 }}>
                      <div className="row" style={{ gap: 8 }}>
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: row.color,
                          }}
                        />
                        <b style={{ fontSize: 13 }}>
                          {row.subjectEmoji} {row.subjectName}
                        </b>
                      </div>
                      <span
                        style={{
                          fontSize: 12,
                          color: 'var(--tx-2)',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {row.dailyTargetMins > 0 && (
                          <>
                            Today{' '}
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
                        height={6}
                        label={`${row.subjectName} daily target`}
                      />
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* 7. Study Next — Top 3 Recommended Chapters */}
          {studyNextItems.length > 0 && (
            <Card>
              <div className="split" style={{ marginBottom: 10 }}>
                <div className="row" style={{ gap: 8 }}>
                  <Compass
                    size={18}
                    strokeWidth={1.75}
                    style={{ color: 'var(--ac-ink)' }}
                  />
                  <div>
                    <h3 style={{ margin: 0, fontSize: 16 }}>Study next</h3>
                    <small style={{ fontSize: 12 }}>
                      Ranked by revisions due, mistakes & low confidence
                    </small>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onSwitchTab('prep')}
                >
                  Syllabus
                </Button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {studyNextItems.map((item) => (
                  <div
                    key={item.chapter.id}
                    className="split"
                    style={{
                      padding: '10px 12px',
                      borderRadius: 12,
                      background: 'var(--sf-2)',
                      border: '1px solid var(--line)',
                      borderLeft: `3px solid ${item.subjectColor}`,
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
                          {item.subjectEmoji} {item.chapter.name}
                        </b>
                        {item.chapter.confidence && (
                          <span
                            className="pill"
                            style={{
                              fontSize: 12,
                              padding: '1px 7px',
                              background: 'var(--sf-3)',
                              color: 'var(--tx-2)',
                            }}
                          >
                            {'★'.repeat(item.chapter.confidence)}
                          </span>
                        )}
                      </div>
                      <small
                        style={{
                          display: 'block',
                          marginTop: 3,
                          fontSize: 12,
                          color: 'var(--tx-2)',
                        }}
                      >
                        {item.reasons.join(' · ')}
                      </small>
                    </div>
                    <Button
                      variant="primary"
                      size="sm"
                      icon={<Play size={13} strokeWidth={2} />}
                      onClick={() =>
                        onQuickStartSession(
                          item.chapter.subjectId,
                          item.chapter.name,
                          state.set.defaultMode || 'pomo',
                          item.chapter.id
                        )
                      }
                    >
                      Focus
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* 8. Daily Tasks Card (Compact when empty) */}
          <Card id="dailyTasksCard">
            <div className="split" style={{ marginBottom: 10 }}>
              <div className="row" style={{ gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: 16 }}>Daily tasks</h3>
                <span
                  className="pill"
                  style={{
                    fontSize: 12,
                    padding: '2px 8px',
                    background:
                      dayTasks.length > 0 && dayProg.tasksDone === dayTasks.length
                        ? 'color-mix(in srgb, var(--ok) 16%, transparent)'
                        : 'var(--sf-2)',
                    color:
                      dayTasks.length > 0 && dayProg.tasksDone === dayTasks.length
                        ? 'var(--ok-ink)'
                        : 'var(--tx-2)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {dayProg.tasksDone}/{dayProg.tasksTotal}
                </span>
              </div>
            </div>

            <form
              className="row"
              style={{
                gap: 8,
                marginBottom: dayTasks.length > 0 ? 10 : 4,
                flexWrap: 'wrap',
              }}
              onSubmit={(e) => {
                e.preventDefault();
                const clean = newTaskTitle.trim();
                if (!clean) return;
                onAddTask(clean, sel, newTaskSubjectId || undefined);
                setNewTaskTitle('');
              }}
            >
              <input
                id="dailyTaskTitleInput"
                type="text"
                aria-label="New daily task title"
                placeholder="Add a task for this day..."
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                style={{ flex: '2 1 180px', minHeight: 44, fontSize: 14 }}
              />
              <div style={{ flex: '1 1 150px', minWidth: 140 }}>
                <Select
                  aria-label="Task subject"
                  title="Task subject"
                  value={newTaskSubjectId}
                  options={taskSubjectOptions}
                  onChange={setNewTaskSubjectId}
                  placeholder="General"
                />
              </div>
              <Button
                type="submit"
                variant="primary"
                size="md"
                icon={<Plus size={16} strokeWidth={2} />}
              >
                Add
              </Button>
            </form>

            {dayTasks.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--tx-3)', padding: '2px 0' }}>
                No tasks scheduled for this day yet.
              </div>
            ) : (
              <WindowedList
                items={dayTasks}
                threshold={100}
                estimatedRowHeight={62}
                itemLabel="tasks"
                style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
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
                          padding: '8px 12px',
                          borderRadius: 12,
                          background: 'var(--sf-2)',
                          border: task.done
                            ? '1px solid color-mix(in srgb, var(--ok) 40%, var(--line))'
                            : '1px solid var(--line)',
                          minHeight: 56,
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'center',
                        }}
                      >
                      <div className="row" style={{ gap: 10 }}>
                        <button
                          type="button"
                          aria-label={
                            task.done
                              ? `Mark "${task.title}" incomplete`
                              : `Complete "${task.title}"`
                          }
                          onClick={() => onToggleTask(task.id)}
                          style={{
                            width: 36,
                            height: 36,
                            minHeight: 36,
                            padding: 0,
                            borderRadius: 10,
                            display: 'grid',
                            placeItems: 'center',
                            background: task.done ? 'var(--ok)' : 'var(--sf-1)',
                            color: task.done ? 'var(--ok-on)' : 'var(--tx-2)',
                            border: task.done ? 'none' : '1px solid var(--line)',
                            flexShrink: 0,
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
                              <Button type="submit" variant="primary" size="sm">
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
                              onClick={() => onToggleTask(task.id)}
                            >
                              <span
                                style={{
                                  fontSize: 14,
                                  fontWeight: 500,
                                  textDecoration: task.done ? 'line-through' : 'none',
                                  color: task.done ? 'var(--tx-2)' : 'var(--tx)',
                                  wordBreak: 'break-word',
                                }}
                              >
                                {task.title}
                              </span>
                              {sub && (
                                <span
                                  className="pill"
                                  style={{
                                    fontSize: 12,
                                    padding: '2px 8px',
                                    background: 'var(--sf-1)',
                                    color: 'var(--tx-2)',
                                    border: '1px solid var(--line)',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 5,
                                  }}
                                >
                                  <span
                                    style={{
                                      width: 7,
                                      height: 7,
                                      borderRadius: '50%',
                                      background: sub.color,
                                    }}
                                  />
                                  {sub.e} {sub.name}
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
                            <small style={{ fontSize: 12 }}>
                              From {t.dayKey} {sub ? `· ${sub.e} ${sub.name}` : ''}
                            </small>
                          </div>
                          <div className="row" style={{ gap: 6 }}>
                            <Button
                              variant="primary"
                              size="sm"
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
          </Card>

          {/* 9. Revisions Due Card (Compact when empty) */}
          <Card id="revisionsDueCard">
            <div
              className="split"
              style={{
                marginBottom: allRevisionsCount > 0 ? 10 : 4,
              }}
            >
              <div className="row" style={{ gap: 8 }}>
                <Repeat
                  size={18}
                  strokeWidth={1.75}
                  style={{ color: 'var(--ac-ink)' }}
                />
                <h3 style={{ margin: 0, fontSize: 16 }}>Revisions due</h3>
                <span
                  className="pill"
                  style={{
                    fontSize: 12,
                    padding: '2px 8px',
                    background:
                      revisionsBundle.overdue.length > 0
                        ? 'color-mix(in srgb, var(--err) 16%, transparent)'
                        : allRevisionsCount > 0
                          ? 'var(--ac-soft)'
                          : 'var(--sf-2)',
                    color:
                      revisionsBundle.overdue.length > 0
                        ? 'var(--err-ink)'
                        : allRevisionsCount > 0
                          ? 'var(--ac-ink)'
                          : 'var(--tx-2)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {allRevisionsCount}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onSwitchTab('prep')}
              >
                Syllabus
              </Button>
            </div>

            {allRevisionsCount > 0 && (
              <div
                className="row"
                style={{
                  gap: 6,
                  overflowX: 'auto',
                  paddingBottom: 8,
                  marginBottom: 8,
                  scrollbarWidth: 'none',
                }}
              >
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
                      {s.e} {s.name} ({count})
                    </Chip>
                  );
                })}
              </div>
            )}

            {overdueRevisions.length === 0 && dueTodayRevisions.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--tx-3)', padding: '2px 0' }}>
                All caught up — no spaced revisions due today.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {overdueRevisions.length > 0 && (
                  <div>
                    <div
                      className="row"
                      style={{
                        gap: 6,
                        fontSize: 12,
                        fontWeight: 600,
                        color: 'var(--err-ink)',
                        marginBottom: 6,
                      }}
                    >
                      <AlertCircle size={14} strokeWidth={2} />
                      <span>Overdue ({overdueRevisions.length})</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {overdueRevisions.map((item) => {
                        const isRescheduling =
                          rescheduleTarget?.chapterId === item.chapterId &&
                          rescheduleTarget?.revId === item.revisionId;
                        return (
                          <div
                            key={`${item.chapterId}_${item.revisionId}`}
                            style={{
                              padding: '10px 12px',
                              borderRadius: 12,
                              background: 'var(--sf-2)',
                              border:
                                '1px solid color-mix(in srgb, var(--err) 38%, var(--line))',
                            }}
                          >
                            <div className="split" style={{ gap: 10 }}>
                              <div className="row" style={{ gap: 10, minWidth: 0, flex: 1 }}>
                                <button
                                  type="button"
                                  className="ck"
                                  aria-label={`Complete ${item.label} for ${item.chapterName}`}
                                  style={{
                                    width: 36,
                                    height: 36,
                                    minWidth: 36,
                                    minHeight: 36,
                                  }}
                                  onClick={() =>
                                    onCompleteRevision(
                                      item.chapterId,
                                      item.revisionId
                                    )
                                  }
                                >
                                  <Check size={16} strokeWidth={2} />
                                </button>
                                <div style={{ minWidth: 0 }}>
                                  <b
                                    style={{
                                      fontSize: 14,
                                      display: 'block',
                                      whiteSpace: 'nowrap',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                    }}
                                  >
                                    {item.subject.e} {item.chapterName}
                                  </b>
                                  <small style={{ fontSize: 12, color: 'var(--err-ink)' }}>
                                    {item.label} · {item.daysLate}d overdue ({item.date})
                                  </small>
                                </div>
                              </div>
                              <Button
                                variant="secondary"
                                size="sm"
                                icon={<Calendar size={13} strokeWidth={1.75} />}
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
                                Reschedule
                              </Button>
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
                                  variant="primary"
                                  size="sm"
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
                        marginBottom: 6,
                      }}
                    >
                      Due on {isTodaySelected ? 'today' : sel} ({dueTodayRevisions.length})
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {dueTodayRevisions.map((item) => {
                        const isRescheduling =
                          rescheduleTarget?.chapterId === item.chapterId &&
                          rescheduleTarget?.revId === item.revisionId;
                        return (
                          <div
                            key={`${item.chapterId}_${item.revisionId}`}
                            style={{
                              padding: '10px 12px',
                              borderRadius: 12,
                              background: 'var(--sf-2)',
                              border: '1px solid var(--line)',
                            }}
                          >
                            <div className="split" style={{ gap: 10 }}>
                              <div className="row" style={{ gap: 10, minWidth: 0, flex: 1 }}>
                                <button
                                  type="button"
                                  className="ck"
                                  aria-label={`Complete ${item.label} for ${item.chapterName}`}
                                  style={{
                                    width: 36,
                                    height: 36,
                                    minWidth: 36,
                                    minHeight: 36,
                                  }}
                                  onClick={() =>
                                    onCompleteRevision(
                                      item.chapterId,
                                      item.revisionId
                                    )
                                  }
                                >
                                  <Check size={16} strokeWidth={2} />
                                </button>
                                <div style={{ minWidth: 0 }}>
                                  <b
                                    style={{
                                      fontSize: 14,
                                      display: 'block',
                                      whiteSpace: 'nowrap',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                    }}
                                  >
                                    {item.subject.e} {item.chapterName}
                                  </b>
                                  <small style={{ fontSize: 12 }}>
                                    {item.subject.name} · {item.label} due
                                  </small>
                                </div>
                              </div>
                              <Button
                                variant="secondary"
                                size="sm"
                                icon={<Calendar size={13} strokeWidth={1.75} />}
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
                                Reschedule
                              </Button>
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
                                  variant="primary"
                                  size="sm"
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
          </Card>

          {/* 10. Habits Section */}
          <div style={{ marginTop: 18 }}>
            <SectionHeader
              title={`Habits (${dayProg.habitsDone}/${dayProg.habitsTotal})`}
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Plus size={15} strokeWidth={2} />}
                  onClick={onNewHabit}
                >
                  Habit
                </Button>
              }
            />

            {allLiveHabits.length > 0 && (
              <div
                className="row"
                style={{
                  gap: 6,
                  overflowX: 'auto',
                  paddingBottom: 6,
                  marginBottom: 6,
                  scrollbarWidth: 'none',
                }}
              >
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
              <Card style={{ textAlign: 'center', padding: '20px 16px' }}>
                <Sparkles
                  size={24}
                  strokeWidth={1.75}
                  style={{ color: 'var(--ac-ink)', margin: '0 auto 6px' }}
                />
                <b style={{ fontSize: 16, display: 'block' }}>
                  Start with a proven study habit
                </b>
                <small style={{ display: 'block', margin: '4px 0 12px', fontSize: 13 }}>
                  Tap a starter preset below or create your own custom habit.
                </small>
                <div
                  className="row"
                  style={{
                    gap: 6,
                    flexWrap: 'wrap',
                    justifyContent: 'center',
                    marginBottom: 12,
                  }}
                >
                  {STARTERS.map((s, i) => (
                    <Chip key={i} onClick={() => onAddStarter(i)}>
                      + {s.e} {s.name}
                    </Chip>
                  ))}
                </div>
                <Button variant="primary" size="sm" onClick={onNewHabit}>
                  Create custom habit
                </Button>
              </Card>
            ) : (
              <>
                {dueList.length > 0 ? (
                  dueList.map(renderHabitRow)
                ) : (
                  <Card style={{ textAlign: 'center', padding: 14 }}>
                    <small style={{ fontSize: 13 }}>
                      No habits scheduled in this category today.
                    </small>
                  </Card>
                )}

                {otherList.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="s"
                      aria-expanded={showUnscheduled}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                      }}
                      onClick={() => setShowUnscheduled((v) => !v)}
                    >
                      {showUnscheduled ? (
                        <ChevronUp size={15} strokeWidth={1.75} />
                      ) : (
                        <ChevronDown size={15} strokeWidth={1.75} />
                      )}
                      <span>Not scheduled today ({otherList.length})</span>
                    </button>
                    {showUnscheduled && (
                      <div style={{ marginTop: 6, opacity: 0.8 }}>
                        {otherList.map(renderHabitRow)}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* 11. Flat Focus Tip Card */}
          <Card style={{ marginTop: 14 }}>
            <div className="split" style={{ alignItems: 'flex-start', gap: 12 }}>
              <div className="row" style={{ gap: 10, alignItems: 'flex-start', flex: 1 }}>
                <Lightbulb
                  size={18}
                  strokeWidth={1.75}
                  style={{ color: 'var(--ac-ink)', flexShrink: 0, marginTop: 2 }}
                />
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: 'var(--ac-ink)',
                      }}
                    >
                      Focus tip
                    </span>
                    <span
                      className="pill"
                      style={{
                        fontSize: 12,
                        padding: '1px 7px',
                        background: 'var(--sf-2)',
                        color: 'var(--tx-2)',
                      }}
                    >
                      {dailyTip.tag}
                    </span>
                  </div>
                  <b style={{ fontSize: 14, display: 'block', marginBottom: 3 }}>
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
              </div>
              <Button
                variant="ghost"
                size="sm"
                icon={<RotateCw size={14} strokeWidth={1.75} />}
                onClick={() => setTipOffset((n) => n + 1)}
              >
                Next tip
              </Button>
            </div>
          </Card>
        </div>

        {/* Right Rail on Desktop >=1100px: Today's Timeline + Daily Reflection */}
        <aside className="today-rail-col">
          {/* Today's Study Sessions Timeline */}
          <Card style={{ marginTop: 4 }}>
            <div className="split" style={{ marginBottom: 10 }}>
              <div className="row" style={{ gap: 8 }}>
                <BookOpen
                  size={18}
                  strokeWidth={1.75}
                  style={{ color: 'var(--ac-ink)' }}
                />
                <h3 style={{ margin: 0, fontSize: 16 }}>
                  {isTodaySelected ? "Today's timeline" : `Sessions (${sel})`}
                </h3>
              </div>
              <Button
                variant="secondary"
                size="sm"
                icon={<Plus size={14} strokeWidth={2} />}
                onClick={() => onOpenManualSession(effectiveQuickSubId)}
              >
                Log hours
              </Button>
            </div>

            {selectedDaySessions.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--tx-3)', padding: '6px 0' }}>
                No study sessions logged on this day yet.
              </div>
            ) : (
              <WindowedList
                items={selectedDaySessions}
                threshold={100}
                estimatedRowHeight={76}
                itemLabel="sessions"
                style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                getKey={(ses: StudySession) => ses.id}
                renderItem={(ses: StudySession) => {
                  const sub = getSubject(state, ses.subjectId);
                  const heading = getSessionHeading(state, ses);
                  return (
                    <div
                      className="split"
                      style={{
                        background: 'var(--sf-2)',
                        padding: '10px 12px',
                        borderRadius: 12,
                        borderLeft: `3px solid ${sub.color}`,
                        gap: 10,
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                          <b
                            style={{
                              fontSize: 13,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {sub.e} {heading}
                          </b>
                          <span
                            className="pill"
                            style={{
                              fontSize: 12,
                              padding: '1px 7px',
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
                          {sub.name} · {fmtClockTime(ses.startTs)} –{' '}
                          {fmtClockTime(ses.endTs)} · {ses.purity || 100}% purity
                        </small>
                        {ses.note && (
                          <small
                            style={{
                              display: 'block',
                              marginTop: 2,
                              fontSize: 12,
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
                        style={{ color: 'var(--err-ink)', padding: '6px 8px' }}
                        onClick={() => onDeleteSession(ses.id)}
                      >
                        <Trash2 size={14} strokeWidth={1.75} />
                      </button>
                    </div>
                  );
                }}
              />
            )}
          </Card>

          {/* Daily Reflection & Wellbeing */}
          <Card id="wellbeingReflectionCard">
            <h3 style={{ margin: '0 0 10px', fontSize: 16 }}>
              Reflection & wellbeing
            </h3>

            {/* Mood Selector */}
            <div style={{ marginBottom: 12 }}>
              <small style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                How did your study feel?
              </small>
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
                        fontSize: 18,
                        padding: '8px 0',
                        borderRadius: 12,
                        background: isSel ? 'var(--ac-soft)' : 'var(--sf-2)',
                        border: isSel
                          ? '1px solid var(--ac)'
                          : '1px solid var(--line)',
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

            {/* Sleep & Energy Row */}
            <div
              className="row"
              style={{
                gap: 10,
                marginBottom: 12,
                flexWrap: 'wrap',
                background: 'var(--sf-2)',
                padding: '10px 12px',
                borderRadius: 12,
                border: '1px solid var(--line)',
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
                    style={{ gap: 4, fontSize: 12, color: 'var(--tx-2)' }}
                  >
                    <Moon size={13} strokeWidth={1.75} />
                    <span>Sleep</span>
                  </div>
                  <b style={{ fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
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
                    color: 'var(--tx-2)',
                    marginBottom: 4,
                  }}
                >
                  <Zap size={13} strokeWidth={1.75} />
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
                          fontSize: 12,
                          fontWeight: 600,
                          borderRadius: 8,
                          background: isLit ? 'var(--ac)' : 'var(--sf-1)',
                          color: isLit ? 'var(--ac-on)' : 'var(--tx-2)',
                          border: isLit ? 'none' : '1px solid var(--line)',
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
          </Card>
        </aside>
      </div>
    </div>
  );
};
