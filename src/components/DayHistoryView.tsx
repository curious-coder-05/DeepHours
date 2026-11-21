import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Plus,
  XCircle,
} from 'lucide-react';
import type {
  Chapter,
  DailyTask,
  Doubt,
  Habit,
  MistakeEntry,
  MockTest,
  PulseHabitState,
  PYQEntry,
  StudySession,
} from '../types';
import {
  addD,
  CC,
  computeMockScore,
  DN,
  done,
  dueOn,
  ent,
  fmtClockTime,
  fmtHMShort,
  getDayProgress,
  getSessionHeading,
  getSortedChapterRevisions,
  getSubject,
  getTodaySubjectMs,
  live,
  logicalKey,
  pad,
  parseKey,
  skip,
} from '../utils/studyLogic';
import { computeDayXpBreakdown } from '../utils/xp';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import { WindowedList } from './ui/WindowedList';

export interface DayHistoryViewProps {
  state: PulseHabitState;
  todayKey: string;
  initialDateKey?: string;
  onSelectDateInToday?: (dayKey: string) => void;
  onEditSession?: (sessionId: string) => void;
  onOpenManualSession?: (defaultSubjectId?: string) => void;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const WEEKDAY_FULL = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const MOOD_LABELS: Record<number, string> = {
  1: 'Drained (1/5)',
  2: 'Low (2/5)',
  3: 'Okay (3/5)',
  4: 'Good (4/5)',
  5: 'In flow (5/5)',
};

function formatReadableDate(dayKey: string): string {
  const dt = parseKey(dayKey);
  const dow = WEEKDAY_FULL[dt.getDay()] || '';
  const mon = MONTH_NAMES[dt.getMonth()] || '';
  return `${dow}, ${dt.getDate()} ${mon} ${dt.getFullYear()}`;
}

export interface DayFullArchiveRecord {
  dayKey: string;
  isFuture: boolean;
  isRestDay: boolean;
  studyMs: number;
  minTargetMs: number;
  metMinStudyTarget: boolean;
  xpEarned: number;
  xpBreakdown: ReturnType<typeof computeDayXpBreakdown>;
  habitsCompleted: Array<{
    habit: Habit;
    value: number;
    target: number;
    unit: string;
  }>;
  habitsMissed: Array<{
    habit: Habit;
    value: number;
    target: number;
    unit: string;
  }>;
  habitsSkipped: Habit[];
  tasksCompleted: DailyTask[];
  tasksMissed: DailyTask[];
  sessions: StudySession[];
  chaptersCompleted: Chapter[];
  revisionsCompleted: Array<{
    chapter: Chapter;
    label: string;
    scheduledDate: string;
    doneOn: string;
  }>;
  revisionsMissed: Array<{
    chapter: Chapter;
    label: string;
    scheduledDate: string;
  }>;
  mocks: MockTest[];
  pyqEntries: PYQEntry[];
  mistakes: MistakeEntry[];
  doubtsCreated: Doubt[];
  sleepHours?: number;
  energyLevel?: number;
  moodValue?: number;
  dailyNote: string;
}

export function buildDayArchiveRecord(
  state: PulseHabitState,
  dayKey: string,
  todayKey: string
): DayFullArchiveRecord {
  const isFuture = dayKey > todayKey;
  const isRestDay = (state.restDays || []).includes(dayKey);
  const studyMs = getTodaySubjectMs(state, 'any', dayKey, todayKey);
  const minTargetMins = Math.max(
    15,
    Number(state.set.targets?.minDayMinutes) || 360
  );
  const minTargetMs = minTargetMins * 60000;
  const metMinStudyTarget = studyMs >= minTargetMs;

  const xpBreakdown = computeDayXpBreakdown(state, dayKey);
  const xpEarned = xpBreakdown.total;

  const dueHabits = dueOn(state, dayKey).filter((h) => h.created <= dayKey);
  const dueIds = new Set(dueHabits.map((h) => h.id));
  const extraLoggedHabits = live(state).filter(
    (h) => !dueIds.has(h.id) && Boolean(state.log[h.id]?.[dayKey])
  );
  const allRelevantHabits = [...dueHabits, ...extraLoggedHabits];

  const habitsCompleted: DayFullArchiveRecord['habitsCompleted'] = [];
  const habitsMissed: DayFullArchiveRecord['habitsMissed'] = [];
  const habitsSkipped: Habit[] = [];

  for (const h of allRelevantHabits) {
    const e = ent(state, h, dayKey);
    const val = Number(e?.v) || 0;
    const target = Math.max(1, Number(h.tn) || 1);
    const unit = h.tu || (h.autoMins || h.subjectId ? 'min' : '');
    if (skip(state, h, dayKey)) {
      habitsSkipped.push(h);
    } else if (done(state, h, dayKey)) {
      habitsCompleted.push({ habit: h, value: val, target, unit });
    } else if (!isFuture && dueIds.has(h.id)) {
      habitsMissed.push({ habit: h, value: val, target, unit });
    }
  }

  const dayTasks = (state.tasks || []).filter((t) => t.dayKey === dayKey);
  const tasksCompleted = dayTasks.filter((t) => t.done);
  const tasksMissed = isFuture ? [] : dayTasks.filter((t) => !t.done);

  const sessions = (state.sessions || [])
    .filter((s) => s.dayKey === dayKey)
    .slice()
    .sort((a, b) => a.startTs - b.startTs);

  const chaptersCompleted = (state.chapters || []).filter(
    (ch) => ch.status === 'completed' && ch.completedOn === dayKey
  );

  const revisionsCompleted: DayFullArchiveRecord['revisionsCompleted'] = [];
  const revisionsMissed: DayFullArchiveRecord['revisionsMissed'] = [];

  for (const ch of state.chapters || []) {
    const labeledRevs = getSortedChapterRevisions(ch);
    for (const rev of labeledRevs) {
      const doneKey = rev.doneOn || rev.date;
      if (rev.done && doneKey === dayKey) {
        revisionsCompleted.push({
          chapter: ch,
          label: rev.label,
          scheduledDate: rev.date,
          doneOn: doneKey,
        });
      } else if (!isFuture && !rev.done && rev.date === dayKey) {
        revisionsMissed.push({
          chapter: ch,
          label: rev.label,
          scheduledDate: rev.date,
        });
      }
    }
  }

  const mocks = (state.mocks || []).filter((m) => m.dayKey === dayKey);
  const pyqEntries = (state.pyq || []).filter((p) => p.dayKey === dayKey);
  const mistakes = (state.mistakes || []).filter((m) => m.dayKey === dayKey);
  const resetHour = state.set.dayResetHour ?? 0;
  const doubtsCreated = (state.doubts || []).filter(
    (d) => logicalKey(d.createdAt, resetHour) === dayKey
  );

  const wb = state.wellbeing?.[dayKey];
  const moodValue = state.mood?.[dayKey];
  const dailyNote = (state.notes?.[dayKey] || '').trim();

  return {
    dayKey,
    isFuture,
    isRestDay,
    studyMs,
    minTargetMs,
    metMinStudyTarget,
    xpEarned,
    xpBreakdown,
    habitsCompleted,
    habitsMissed,
    habitsSkipped,
    tasksCompleted,
    tasksMissed,
    sessions,
    chaptersCompleted,
    revisionsCompleted,
    revisionsMissed,
    mocks,
    pyqEntries,
    mistakes,
    doubtsCreated,
    sleepHours: wb?.sleep,
    energyLevel: wb?.energy,
    moodValue,
    dailyNote,
  };
}

export const DayHistoryView: React.FC<DayHistoryViewProps> = ({
  state,
  todayKey,
  initialDateKey,
  onSelectDateInToday,
  onEditSession,
  onOpenManualSession,
}) => {
  const [selectedDayKey, setSelectedDayKey] = useState<string>(
    initialDateKey && /^\d{4}-\d{2}-\d{2}$/.test(initialDateKey)
      ? initialDateKey
      : todayKey
  );
  const [showCalendarPicker, setShowCalendarPicker] = useState<boolean>(false);

  useEffect(() => {
    if (initialDateKey && /^\d{4}-\d{2}-\d{2}$/.test(initialDateKey)) {
      setSelectedDayKey(initialDateKey);
    }
  }, [initialDateKey]);

  const [calYearMonth, setCalYearMonth] = useState<{ year: number; month: number }>(
    () => {
      const dt = parseKey(selectedDayKey);
      return { year: dt.getFullYear(), month: dt.getMonth() };
    }
  );

  const handleSelectDate = (nextKey: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextKey)) return;
    setSelectedDayKey(nextKey);
    const dt = parseKey(nextKey);
    setCalYearMonth({ year: dt.getFullYear(), month: dt.getMonth() });
  };

  const record = useMemo(
    () => buildDayArchiveRecord(state, selectedDayKey, todayKey),
    [state, selectedDayKey, todayKey]
  );

  const calendarCells = useMemo(() => {
    const { year, month } = calYearMonth;
    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const weekStart = state.set.ws ?? 1;
    const startOffset = (firstDay.getDay() - weekStart + 7) % 7;

    const cells: Array<
      | null
      | {
          dayKey: string;
          dayNum: number;
          isToday: boolean;
          isSelected: boolean;
          isFuture: boolean;
          studyMs: number;
          doneCount: number;
          totalCount: number;
          pct: number;
          isRest: boolean;
        }
    > = [];

    for (let i = 0; i < startOffset; i++) {
      cells.push(null);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dk = `${year}-${pad(month + 1)}-${pad(d)}`;
      const prog = getDayProgress(state, dk);
      const studyMs = getTodaySubjectMs(state, 'any', dk, todayKey);
      const isRest = (state.restDays || []).includes(dk);
      cells.push({
        dayKey: dk,
        dayNum: d,
        isToday: dk === todayKey,
        isSelected: dk === selectedDayKey,
        isFuture: dk > todayKey,
        studyMs,
        doneCount: prog.done,
        totalCount: prog.total,
        pct: Math.round(prog.pct * 100),
        isRest,
      });
    }

    return cells;
  }, [calYearMonth, state, todayKey, selectedDayKey]);

  const totalDidCount =
    record.habitsCompleted.length +
    record.tasksCompleted.length +
    record.sessions.length +
    record.chaptersCompleted.length +
    record.revisionsCompleted.length +
    record.mocks.length +
    record.pyqEntries.length +
    (record.dailyNote ? 1 : 0) +
    (record.sleepHours !== undefined || record.energyLevel !== undefined ? 1 : 0);

  const totalMissedCount =
    record.habitsMissed.length +
    record.tasksMissed.length +
    record.revisionsMissed.length +
    (!record.isFuture && !record.isRestDay && !record.metMinStudyTarget ? 1 : 0);

  const totalActivityCount = totalDidCount + totalMissedCount + record.habitsSkipped.length;

  return (
    <div className="dh-amoled-flow">
      {/* Top Date Selector & Collapsible Month Calendar */}
      <section className="dh-amoled-section">
        <div
          className="split flex-wrap gap-3 pb-3"
          style={{ borderBottom: '1px solid var(--hairline)' }}
        >
          <div>
            <span className="dh-eyebrow block">Daily activity history</span>
            <h3 className="mt-0.5 text-[17px] font-semibold text-[var(--tx)]">
              {formatReadableDate(selectedDayKey)}
            </h3>
            <p className="tnum text-[12.5px] text-[var(--tx-3)]">
              {selectedDayKey}
              {selectedDayKey === todayKey
                ? ' · Today'
                : selectedDayKey > todayKey
                  ? ' · Future date'
                  : ''}
              {record.isRestDay ? ' · Protected rest pass' : ''}
            </p>
          </div>

          <div className="flex w-full items-center gap-1.5 sm:w-auto">
            <IconButton
              label="Previous day"
              onClick={() => handleSelectDate(addD(selectedDayKey, -1))}
            >
              <ChevronLeft size={18} />
            </IconButton>
            <input
              type="date"
              aria-label="Select date to view history"
              value={selectedDayKey}
              onChange={(e) => {
                if (e.target.value) handleSelectDate(e.target.value);
              }}
              className="tnum h-9 w-auto min-w-0 flex-1 rounded-xl border border-[var(--hairline)] bg-[var(--inset-group-bg,#0A0C10)] px-2.5 text-[13px] font-medium text-[var(--tx)] sm:w-[152px] sm:flex-none"
            />
            <IconButton
              label="Next day"
              onClick={() => handleSelectDate(addD(selectedDayKey, 1))}
            >
              <ChevronRight size={18} />
            </IconButton>
            {selectedDayKey !== todayKey && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleSelectDate(todayKey)}
              >
                Today
              </Button>
            )}
          </div>
        </div>

        <div className="split flex-wrap gap-2">
          <button
            type="button"
            className="dh-eyebrow-link"
            onClick={() => setShowCalendarPicker((v) => !v)}
          >
            {showCalendarPicker ? (
              <ChevronDown size={14} aria-hidden="true" />
            ) : (
              <Calendar size={14} aria-hidden="true" />
            )}
            <span>
              {showCalendarPicker ? 'Hide month calendar' : 'Show month calendar'}
            </span>
          </button>

          {onSelectDateInToday && (
            <button
              type="button"
              className="dh-ghost-pill"
              onClick={() => onSelectDateInToday(selectedDayKey)}
            >
              <Edit3 size={13} aria-hidden="true" />
              <span>Edit in Today</span>
            </button>
          )}
        </div>

        {showCalendarPicker && (
          <div className="rounded-2xl border border-[var(--hairline)] bg-[var(--sf-1)] p-3">
            <div className="split mb-2.5">
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  setCalYearMonth((prev) => {
                    const dt = new Date(prev.year, prev.month - 1, 1);
                    return { year: dt.getFullYear(), month: dt.getMonth() };
                  })
                }
              >
                Prev
              </Button>
              <strong className="text-[13.5px] font-semibold text-[var(--tx)]">
                {MONTH_NAMES[calYearMonth.month]} {calYearMonth.year}
              </strong>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  setCalYearMonth((prev) => {
                    const dt = new Date(prev.year, prev.month + 1, 1);
                    return { year: dt.getFullYear(), month: dt.getMonth() };
                  })
                }
              >
                Next
              </Button>
            </div>

            <div className="mb-1.5 grid grid-cols-7 gap-1 text-center">
              {Array.from({ length: 7 }, (_, i) => {
                const dow = ((state.set.ws ?? 1) + i) % 7;
                return (
                  <span
                    key={i}
                    className="text-[12px] font-medium text-[var(--tx-3)]"
                  >
                    {DN[dow]}
                  </span>
                );
              })}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {calendarCells.map((cell, idx) => {
                if (!cell) {
                  return <div key={`empty_${idx}`} className="min-h-[36px]" />;
                }
                const hasActivity = cell.studyMs > 0 || cell.doneCount > 0;
                const allDone =
                  cell.totalCount > 0 && cell.doneCount === cell.totalCount;
                return (
                  <button
                    key={cell.dayKey}
                    type="button"
                    onClick={() => handleSelectDate(cell.dayKey)}
                    title={`${cell.dayKey}: Studied ${fmtHMShort(cell.studyMs)} · ${cell.doneCount}/${cell.totalCount} (${cell.pct}%)`}
                    className={`tnum flex min-h-[36px] flex-col items-center justify-center gap-0.5 rounded-lg border text-[13px] transition-colors ${
                      cell.isSelected
                        ? 'border-[var(--ac)] bg-[var(--ac-soft)] font-bold text-[var(--ac-ink)]'
                        : cell.isToday
                          ? 'border-[var(--ok)] bg-transparent font-semibold text-[var(--tx)]'
                          : allDone && !cell.isFuture
                            ? 'border-[var(--hairline)] bg-transparent font-medium text-[var(--ok-ink)]'
                            : hasActivity
                              ? 'border-[var(--hairline)] bg-transparent text-[var(--tx)]'
                              : 'border-transparent bg-transparent text-[var(--tx-3)]'
                    }`}
                    style={{ opacity: cell.isFuture ? 0.45 : 1 }}
                  >
                    <span>{cell.dayNum}</span>
                    <span className="flex items-center gap-1">
                      {cell.studyMs > 0 && (
                        <i className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--ok)]" />
                      )}
                      {cell.doneCount > 0 && (
                        <i className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--ac)]" />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Day Summary KPIs — Hairline 2x2 Metric Ledger */}
        <div className="dh-ledger-2x2">
          <div className="dh-ledger-cell">
            <span className="dh-ledger-label">Study time</span>
            <span className="dh-ledger-val tnum">{fmtHMShort(record.studyMs)}</span>
            <span className="dh-ledger-sub">
              {record.metMinStudyTarget
                ? `Met ${fmtHMShort(record.minTargetMs)} goal`
                : `Goal ${fmtHMShort(record.minTargetMs)}`}
            </span>
          </div>
          <div className="dh-ledger-cell">
            <span className="dh-ledger-label">Habits due</span>
            <span className="dh-ledger-val tnum">
              {record.habitsCompleted.length}/
              {record.habitsCompleted.length + record.habitsMissed.length}
            </span>
            <span className="dh-ledger-sub">
              {record.habitsMissed.length === 0
                ? 'All completed'
                : `${record.habitsMissed.length} missed`}
            </span>
          </div>
          <div className="dh-ledger-cell">
            <span className="dh-ledger-label">Daily tasks</span>
            <span className="dh-ledger-val tnum">
              {record.tasksCompleted.length}/
              {record.tasksCompleted.length + record.tasksMissed.length}
            </span>
            <span className="dh-ledger-sub">
              {record.tasksMissed.length === 0
                ? 'All finished'
                : `${record.tasksMissed.length} unfinished`}
            </span>
          </div>
          <div className="dh-ledger-cell">
            <span className="dh-ledger-label">XP earned</span>
            <span className="dh-ledger-val tnum">+{record.xpEarned} XP</span>
            <span className="dh-ledger-sub">
              {record.sessions.length}{' '}
              {record.sessions.length === 1 ? 'session' : 'sessions'}
            </span>
          </div>
        </div>
      </section>

      {/* Unified Activity Log — Single Clean Hairline List with Check/Cross Indicators */}
      <section className="dh-amoled-section" data-testid="day-history-unified-list">
        <div className="dh-eyebrow-row">
          <div className="flex items-center gap-2">
            <h3 className="dh-eyebrow">Day activity</h3>
            <span className="tnum text-[12px] text-[var(--tx-3)]">
              {totalDidCount} done · {totalMissedCount} missed
            </span>
          </div>
          {onOpenManualSession && (
            <button
              type="button"
              className="dh-eyebrow-link"
              onClick={() => onOpenManualSession()}
            >
              <Plus size={14} strokeWidth={1.8} aria-hidden="true" />
              <span>Log session</span>
            </button>
          )}
        </div>

        {totalActivityCount === 0 ? (
          <div className="dh-empty-inline">
            <span>No activity recorded on {selectedDayKey}.</span>
          </div>
        ) : (
          <div className="dh-hairline-list">
            {/* Daily Study Minimum Status */}
            {!record.isFuture && !record.isRestDay && (
              <div className="dh-hairline-row">
                <div className="flex min-w-0 items-center gap-2.5 text-[14px] font-medium text-[var(--tx)]">
                  {record.metMinStudyTarget ? (
                    <CheckCircle2
                      size={16}
                      className="shrink-0 text-[var(--ok-ink)]"
                      aria-hidden="true"
                    />
                  ) : (
                    <XCircle
                      size={16}
                      className="shrink-0 text-[var(--err-ink)]"
                      aria-hidden="true"
                    />
                  )}
                  <span className="truncate">
                    {record.metMinStudyTarget
                      ? 'Daily study minimum met'
                      : 'Daily study minimum not reached'}
                  </span>
                </div>
                <span
                  className="tnum shrink-0 text-[13px] font-medium"
                  style={{
                    color: record.metMinStudyTarget
                      ? 'var(--ok-ink)'
                      : 'var(--err-ink)',
                  }}
                >
                  {fmtHMShort(record.studyMs)} / {fmtHMShort(record.minTargetMs)}
                </span>
              </div>
            )}

            {/* Study Sessions (Windowed for long days) */}
            {record.sessions.length > 0 && (
              <WindowedList
                items={record.sessions}
                threshold={100}
                estimatedRowHeight={68}
                itemLabel="sessions"
                getKey={(ses) => ses.id}
                renderItem={(ses) => {
                  const sub = getSubject(state, ses.subjectId);
                  const heading = getSessionHeading(state, ses);
                  return (
                    <div className="dh-hairline-row">
                      <div className="flex min-w-0 flex-1 items-start gap-2.5">
                        <CheckCircle2
                          size={16}
                          className="mt-0.5 shrink-0 text-[var(--ok-ink)]"
                          aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-[14px] font-medium text-[var(--tx)]">
                            <span
                              className="dh-sub-dot"
                              style={{ background: sub.color }}
                              aria-hidden="true"
                            />
                            <span className="truncate">
                              {sub.name} · {heading}
                            </span>
                          </div>
                          <p className="tnum mt-0.5 text-[12.5px] text-[var(--tx-3)]">
                            {fmtClockTime(ses.startTs)} – {fmtClockTime(ses.endTs)} ·{' '}
                            {ses.mode} · {ses.purity ?? 100}% purity
                          </p>
                          {ses.note && (
                            <p className="mt-0.5 text-[12.5px] text-[var(--tx-2)]">
                              “{ses.note}”
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <strong className="tnum text-[13.5px] text-[var(--ok-ink)]">
                          {fmtHMShort(ses.activeMs)}
                        </strong>
                        {onEditSession && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => onEditSession(ses.id)}
                          >
                            Edit
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                }}
              />
            )}

            {/* Habits Completed */}
            {record.habitsCompleted.map(({ habit, value, target, unit }) => (
              <div key={`h_done_${habit.id}`} className="dh-hairline-row">
                <span className="flex min-w-0 items-center gap-2.5 text-[14px] font-medium text-[var(--tx)]">
                  <CheckCircle2
                    size={16}
                    className="shrink-0 text-[var(--ok-ink)]"
                    aria-hidden="true"
                  />
                  <span
                    className="dh-sub-dot"
                    style={{ background: CC[habit.c] || 'var(--tx-3)' }}
                    aria-hidden="true"
                  />
                  <span className="truncate">{habit.name}</span>
                  <span className="shrink-0 text-[12.5px] text-[var(--tx-3)]">
                    {habit.c}
                  </span>
                </span>
                <span className="tnum shrink-0 text-[13px] font-medium text-[var(--ok-ink)]">
                  {value}/{target} {unit}
                </span>
              </div>
            ))}

            {/* Habits Missed */}
            {record.habitsMissed.map(({ habit, value, target, unit }) => (
              <div key={`h_miss_${habit.id}`} className="dh-hairline-row">
                <span className="flex min-w-0 items-center gap-2.5 text-[14px] font-medium text-[var(--tx)]">
                  <XCircle
                    size={16}
                    className="shrink-0 text-[var(--err-ink)]"
                    aria-hidden="true"
                  />
                  <span
                    className="dh-sub-dot"
                    style={{ background: CC[habit.c] || 'var(--tx-3)' }}
                    aria-hidden="true"
                  />
                  <span className="truncate">{habit.name}</span>
                </span>
                <span className="tnum shrink-0 text-[13px] text-[var(--err-ink)]">
                  {value}/{target} {unit}
                </span>
              </div>
            ))}

            {/* Habits Skipped */}
            {record.habitsSkipped.map((h) => (
              <div key={`h_skip_${h.id}`} className="dh-hairline-row">
                <span className="flex min-w-0 items-center gap-2.5 text-[14px] text-[var(--tx-2)]">
                  <span
                    className="dh-sub-dot"
                    style={{ background: 'var(--tx-3)' }}
                    aria-hidden="true"
                  />
                  <span className="truncate">{h.name}</span>
                </span>
                <span className="shrink-0 text-[12.5px] text-[var(--tx-3)]">
                  Skipped
                </span>
              </div>
            ))}

            {/* Tasks Completed */}
            {record.tasksCompleted.map((task) => {
              const sub = task.subjectId ? getSubject(state, task.subjectId) : null;
              return (
                <div key={`t_done_${task.id}`} className="dh-hairline-row">
                  <span className="flex min-w-0 items-center gap-2.5 text-[14px] font-medium text-[var(--tx)]">
                    <CheckCircle2
                      size={16}
                      className="shrink-0 text-[var(--ok-ink)]"
                      aria-hidden="true"
                    />
                    <span className="truncate">{task.title}</span>
                  </span>
                  {sub && (
                    <span className="flex shrink-0 items-center gap-1.5 text-[12.5px] text-[var(--tx-3)]">
                      <span
                        className="dh-sub-dot"
                        style={{ background: sub.color }}
                        aria-hidden="true"
                      />
                      <span>{sub.name}</span>
                    </span>
                  )}
                </div>
              );
            })}

            {/* Tasks Missed */}
            {record.tasksMissed.map((task) => {
              const sub = task.subjectId ? getSubject(state, task.subjectId) : null;
              return (
                <div key={`t_miss_${task.id}`} className="dh-hairline-row">
                  <span className="flex min-w-0 items-center gap-2.5 text-[14px] font-medium text-[var(--tx)]">
                    <XCircle
                      size={16}
                      className="shrink-0 text-[var(--err-ink)]"
                      aria-hidden="true"
                    />
                    <span className="truncate">{task.title}</span>
                  </span>
                  {sub && (
                    <span className="flex shrink-0 items-center gap-1.5 text-[12.5px] text-[var(--tx-3)]">
                      <span
                        className="dh-sub-dot"
                        style={{ background: sub.color }}
                        aria-hidden="true"
                      />
                      <span>{sub.name}</span>
                    </span>
                  )}
                </div>
              );
            })}

            {/* Chapters Completed */}
            {record.chaptersCompleted.map((ch) => {
              const sub = getSubject(state, ch.subjectId);
              return (
                <div key={`ch_${ch.id}`} className="dh-hairline-row">
                  <span className="flex min-w-0 items-center gap-2.5 text-[14px] text-[var(--tx)]">
                    <CheckCircle2
                      size={16}
                      className="shrink-0 text-[var(--ok-ink)]"
                      aria-hidden="true"
                    />
                    <span
                      className="dh-sub-dot"
                      style={{ background: sub.color }}
                      aria-hidden="true"
                    />
                    <span className="truncate">
                      Completed <strong>{ch.name}</strong> ({sub.name})
                    </span>
                  </span>
                  <span className="tnum shrink-0 text-[13px] font-semibold text-[var(--ac-ink)]">
                    +25 XP
                  </span>
                </div>
              );
            })}

            {/* Revisions Completed */}
            {record.revisionsCompleted.map((rev, idx) => {
              const sub = getSubject(state, rev.chapter.subjectId);
              return (
                <div key={`rev_${rev.chapter.id}_${idx}`} className="dh-hairline-row">
                  <span className="flex min-w-0 items-center gap-2.5 text-[14px] text-[var(--tx)]">
                    <CheckCircle2
                      size={16}
                      className="shrink-0 text-[var(--ok-ink)]"
                      aria-hidden="true"
                    />
                    <span
                      className="dh-sub-dot"
                      style={{ background: sub.color }}
                      aria-hidden="true"
                    />
                    <span className="truncate">
                      {rev.label}: <strong>{rev.chapter.name}</strong> ({sub.name})
                    </span>
                  </span>
                  <span className="shrink-0 text-[12.5px] font-medium text-[var(--ok-ink)]">
                    Done
                  </span>
                </div>
              );
            })}

            {/* Revisions Missed */}
            {record.revisionsMissed.map((rev, idx) => {
              const sub = getSubject(state, rev.chapter.subjectId);
              return (
                <div key={`missed_rev_${rev.chapter.id}_${idx}`} className="dh-hairline-row">
                  <span className="flex min-w-0 items-center gap-2.5 text-[14px] text-[var(--tx)]">
                    <XCircle
                      size={16}
                      className="shrink-0 text-[var(--err-ink)]"
                      aria-hidden="true"
                    />
                    <span
                      className="dh-sub-dot"
                      style={{ background: sub.color }}
                      aria-hidden="true"
                    />
                    <span className="truncate">
                      {rev.label}: <strong>{rev.chapter.name}</strong> ({sub.name})
                    </span>
                  </span>
                  <span className="tnum shrink-0 text-[12.5px] text-[var(--err-ink)]">
                    Due {rev.scheduledDate}
                  </span>
                </div>
              );
            })}

            {/* Mocks */}
            {record.mocks.map((mk) => {
              const sc = computeMockScore(mk, state.subjects);
              return (
                <div key={mk.id} className="dh-hairline-row">
                  <span className="flex min-w-0 items-center gap-2.5 text-[14px] text-[var(--tx)]">
                    <CheckCircle2
                      size={16}
                      className="shrink-0 text-[var(--ok-ink)]"
                      aria-hidden="true"
                    />
                    <span className="truncate">
                      Mock: <strong>{mk.name}</strong>
                    </span>
                  </span>
                  <strong className="tnum shrink-0 text-[13px] text-[var(--ac-ink)]">
                    {sc.totalScore}/{sc.maxMarks} ({sc.accuracyPct}%)
                  </strong>
                </div>
              );
            })}

            {/* PYQ Practice */}
            {record.pyqEntries.map((pq) => {
              const ch = state.chapters.find((c) => c.id === pq.chapterId);
              return (
                <div key={pq.id} className="dh-hairline-row">
                  <span className="flex min-w-0 items-center gap-2.5 text-[14px] text-[var(--tx)]">
                    <CheckCircle2
                      size={16}
                      className="shrink-0 text-[var(--ok-ink)]"
                      aria-hidden="true"
                    />
                    <span className="truncate">
                      PYQ: <strong>{ch ? ch.name : 'Chapter'}</strong>
                    </span>
                  </span>
                  <strong className="tnum shrink-0 text-[13px] text-[var(--tx)]">
                    {pq.correct}/{pq.attempted}
                  </strong>
                </div>
              );
            })}

            {/* Mistakes */}
            {record.mistakes.map((ms) => {
              const sub = getSubject(state, ms.subjectId);
              return (
                <div key={ms.id} className="dh-hairline-row">
                  <span className="flex min-w-0 items-center gap-2.5 text-[14px] text-[var(--tx)]">
                    <span
                      className="dh-sub-dot"
                      style={{ background: sub.color }}
                      aria-hidden="true"
                    />
                    <span className="truncate">
                      Mistake ({sub.name} · {ms.reason}): {ms.note || 'Logged'}
                    </span>
                  </span>
                  <span className="shrink-0 text-[12.5px] text-[var(--tx-3)]">
                    {ms.resolved ? 'Resolved' : 'Open'}
                  </span>
                </div>
              );
            })}

            {/* Doubts */}
            {record.doubtsCreated.map((db) => {
              const sub = getSubject(state, db.subjectId);
              return (
                <div key={db.id} className="dh-hairline-row">
                  <span className="flex min-w-0 items-center gap-2.5 text-[14px] text-[var(--tx)]">
                    <span
                      className="dh-sub-dot"
                      style={{ background: sub.color }}
                      aria-hidden="true"
                    />
                    <span className="truncate">
                      Doubt ({sub.name}): {db.text}
                    </span>
                  </span>
                  <span className="shrink-0 text-[12.5px] text-[var(--tx-3)]">
                    {db.resolved ? 'Resolved' : 'Open'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Wellbeing & Reflection — Shown only when logged for this date */}
      {(record.sleepHours !== undefined ||
        record.energyLevel !== undefined ||
        record.moodValue !== undefined ||
        Boolean(record.dailyNote)) && (
        <section className="dh-amoled-section">
          <h3 className="dh-eyebrow">Wellbeing &amp; reflection</h3>
          <div className="dh-hairline-list">
            <div className="dh-hairline-row flex-wrap gap-4 text-[13.5px] text-[var(--tx)]">
              {record.sleepHours !== undefined && (
                <span>
                  Sleep <strong className="tnum">{record.sleepHours}h</strong>
                </span>
              )}
              {record.energyLevel !== undefined && (
                <span>
                  Energy <strong className="tnum">{record.energyLevel}/5</strong>
                </span>
              )}
              {record.moodValue !== undefined && MOOD_LABELS[record.moodValue] && (
                <span>
                  Mood <strong>{MOOD_LABELS[record.moodValue]}</strong>
                </span>
              )}
            </div>
            {record.dailyNote && (
              <div className="dh-hairline-row text-[13px] text-[var(--tx-2)]">
                <span>“{record.dailyNote}”</span>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
};
