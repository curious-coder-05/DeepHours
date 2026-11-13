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
import { Card } from './ui/Card';
import { IconButton } from './ui/IconButton';
import { SectionHeader } from './ui/SectionHeader';
import { Segmented } from './ui/Segmented';
import { Stat } from './ui/Stat';
import { WindowedList } from './ui/WindowedList';

export interface DayHistoryViewProps {
  state: PulseHabitState;
  todayKey: string;
  initialDateKey?: string;
  onSelectDateInToday?: (dayKey: string) => void;
  onEditSession?: (sessionId: string) => void;
  onOpenManualSession?: (defaultSubjectId?: string) => void;
}

type DayRecordFilter = 'all' | 'did' | 'missed';

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
    Number(state.set.targets?.minDayMinutes) || 240
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
  const [filterMode, setFilterMode] = useState<DayRecordFilter>('all');
  const [showCalendarPicker, setShowCalendarPicker] = useState<boolean>(true);

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

  const showDidSection = filterMode === 'all' || filterMode === 'did';
  const showMissedSection = filterMode === 'all' || filterMode === 'missed';

  return (
    <div className="space-y-4">
      {/* Top Date Selector & Collapsible Month Calendar */}
      <Card>
        <div className="split flex-wrap gap-3">
          <div>
            <span className="text-[12px] font-medium text-[var(--ac-ink)]">
              Daily activity history
            </span>
            <h3 className="text-[17px] font-semibold text-[var(--tx)]">
              {formatReadableDate(selectedDayKey)}
            </h3>
            <p className="tnum text-[12px] text-[var(--tx-2)]">
              {selectedDayKey}
              {selectedDayKey === todayKey
                ? ' · Today'
                : selectedDayKey > todayKey
                  ? ' · Future date'
                  : ''}
              {record.isRestDay ? ' · Protected rest pass' : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
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
              className="tnum h-10 rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3 text-[13px] font-medium text-[var(--tx)]"
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

        <div className="split mt-3 border-t border-[var(--line)] pt-3 flex-wrap gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={
              showCalendarPicker ? (
                <ChevronDown size={15} />
              ) : (
                <Calendar size={15} />
              )
            }
            onClick={() => setShowCalendarPicker((v) => !v)}
          >
            {showCalendarPicker ? 'Hide month calendar' : 'Show month calendar'}
          </Button>

          {onSelectDateInToday && (
            <Button
              variant="secondary"
              size="sm"
              icon={<Edit3 size={14} />}
              onClick={() => onSelectDateInToday(selectedDayKey)}
            >
              Edit day in Today tab
            </Button>
          )}
        </div>

        {showCalendarPicker && (
          <div className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--sf-2)] p-3">
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
                  return <div key={`empty_${idx}`} className="min-h-[38px]" />;
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
                    className={`tnum flex min-h-[38px] flex-col items-center justify-center gap-0.5 rounded-lg border text-[12px] transition-colors ${
                      cell.isSelected
                        ? 'border-[var(--ac)] bg-[var(--ac-soft)] font-bold text-[var(--ac-ink)]'
                        : cell.isToday
                          ? 'border-[var(--ok)] bg-[var(--sf-1)] font-semibold text-[var(--tx)]'
                          : allDone && !cell.isFuture
                            ? 'border-[var(--line)] bg-[var(--sf-1)] font-medium text-[var(--ok-ink)]'
                            : hasActivity
                              ? 'border-[var(--line)] bg-[var(--sf-1)] text-[var(--tx)]'
                              : 'border-transparent bg-[var(--sf-1)] text-[var(--tx-2)]'
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
      </Card>

      {/* Day Summary KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Study time"
          value={fmtHMShort(record.studyMs)}
          sub={
            record.metMinStudyTarget
              ? `Met ${fmtHMShort(record.minTargetMs)} goal`
              : `Goal ${fmtHMShort(record.minTargetMs)}`
          }
        />
        <Stat
          label="Habits due"
          value={`${record.habitsCompleted.length}/${
            record.habitsCompleted.length + record.habitsMissed.length
          }`}
          sub={
            record.habitsMissed.length === 0
              ? 'All due completed'
              : `${record.habitsMissed.length} missed`
          }
        />
        <Stat
          label="Daily tasks"
          value={`${record.tasksCompleted.length}/${
            record.tasksCompleted.length + record.tasksMissed.length
          }`}
          sub={
            record.tasksMissed.length === 0
              ? 'All tasks finished'
              : `${record.tasksMissed.length} unfinished`
          }
        />
        <Stat
          label="XP earned"
          value={`+${record.xpEarned} XP`}
          sub={`${record.sessions.length} ${
            record.sessions.length === 1 ? 'session' : 'sessions'
          } logged`}
        />
      </div>

      {/* Segmented Filter */}
      <Segmented<DayRecordFilter>
        value={filterMode}
        onChange={setFilterMode}
        ariaLabel="Day record filter"
        options={[
          {
            value: 'all',
            label: `Full day (${totalDidCount + totalMissedCount})`,
          },
          { value: 'did', label: `Did (${totalDidCount})` },
          { value: 'missed', label: `Didn't do (${totalMissedCount})` },
        ]}
      />

      {/* Section 1: Did */}
      {showDidSection && (
        <Card className="space-y-4">
          <SectionHeader
            title={`Did on ${selectedDayKey}`}
            subtitle="Completed habits, tasks, study sessions, chapters, revisions, and logs"
            action={
              <span className="tnum rounded-md bg-[var(--sf-2)] px-2.5 py-1 text-[12px] font-medium text-[var(--ok-ink)]">
                {totalDidCount} completed
              </span>
            }
          />

          {totalDidCount === 0 ? (
            <div className="rounded-xl border border-[var(--line)] bg-[var(--sf-2)] p-4 text-center text-[13px] text-[var(--tx-2)]">
              No completed habits, tasks, or study sessions recorded on{' '}
              <strong>{selectedDayKey}</strong>.
            </div>
          ) : (
            <div className="space-y-4">
              {/* Habits Completed */}
              {record.habitsCompleted.length > 0 && (
                <div>
                  <h4 className="mb-2 text-[12.5px] font-semibold text-[var(--tx-2)]">
                    Habits completed ({record.habitsCompleted.length})
                  </h4>
                  <div className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3">
                    {record.habitsCompleted.map(({ habit, value, target, unit }) => (
                      <div
                        key={habit.id}
                        className="flex items-center justify-between gap-2 py-2.5 text-[13.5px]"
                      >
                        <span className="flex items-center gap-2 font-medium text-[var(--tx)]">
                          <CheckCircle2 size={16} className="shrink-0 text-[var(--ok-ink)]" aria-hidden="true" />
                          {habit.e} {habit.name}
                          <span
                            className="rounded-md bg-[var(--sf-1)] px-2 py-0.5 text-[12px]"
                            style={{ color: CC[habit.c] || 'var(--tx-2)' }}
                          >
                            {habit.c}
                          </span>
                        </span>
                        <span className="tnum text-[12.5px] font-semibold text-[var(--ok-ink)]">
                          {value}/{target} {unit}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tasks Completed */}
              {record.tasksCompleted.length > 0 && (
                <div>
                  <h4 className="mb-2 text-[12.5px] font-semibold text-[var(--tx-2)]">
                    Daily tasks finished ({record.tasksCompleted.length})
                  </h4>
                  <div className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3">
                    {record.tasksCompleted.map((task) => {
                      const sub = task.subjectId
                        ? getSubject(state, task.subjectId)
                        : null;
                      return (
                        <div
                          key={task.id}
                          className="flex items-center justify-between gap-2 py-2.5 text-[13.5px]"
                        >
                          <span className="flex items-center gap-2 font-medium text-[var(--tx)]">
                            <CheckCircle2 size={16} className="shrink-0 text-[var(--ok-ink)]" aria-hidden="true" />
                            {task.title}
                          </span>
                          {sub && (
                            <span className="rounded-md bg-[var(--sf-1)] px-2 py-0.5 text-[12px] text-[var(--tx-2)]">
                              {sub.e} {sub.name}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Study Sessions */}
              {record.sessions.length > 0 && (
                <div>
                  <div className="split mb-2">
                    <h4 className="text-[12.5px] font-semibold text-[var(--tx-2)]">
                      Study sessions ({record.sessions.length} ·{' '}
                      {fmtHMShort(record.studyMs)})
                    </h4>
                    {onOpenManualSession && (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Plus size={14} />}
                        onClick={() => onOpenManualSession()}
                      >
                        Log session
                      </Button>
                    )}
                  </div>
                  <WindowedList
                    items={record.sessions}
                    threshold={100}
                    estimatedRowHeight={72}
                    itemLabel="sessions"
                    className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3"
                    getKey={(ses) => ses.id}
                    renderItem={(ses) => {
                      const sub = getSubject(state, ses.subjectId);
                      const heading = getSessionHeading(state, ses);
                      return (
                        <div className="flex items-center justify-between gap-3 py-2.5">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 text-[13.5px] font-medium text-[var(--tx)]">
                              <span
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{ background: sub.color }}
                              />
                              <span className="truncate">
                                {sub.e} {sub.name} · {heading}
                              </span>
                            </div>
                            <p className="tnum text-[12px] text-[var(--tx-2)]">
                              {fmtClockTime(ses.startTs)} – {fmtClockTime(ses.endTs)} ·{' '}
                              {ses.mode} · Purity {ses.purity ?? 100}%
                            </p>
                            {ses.note && (
                              <p className="mt-0.5 text-[12px] text-[var(--tx-2)]">
                                “{ses.note}”
                              </p>
                            )}
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
                </div>
              )}

              {/* Chapters & Revisions */}
              {(record.chaptersCompleted.length > 0 ||
                record.revisionsCompleted.length > 0) && (
                <div>
                  <h4 className="mb-2 text-[12.5px] font-semibold text-[var(--tx-2)]">
                    Chapters &amp; revisions completed
                  </h4>
                  <div className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3">
                    {record.chaptersCompleted.map((ch) => {
                      const sub = getSubject(state, ch.subjectId);
                      return (
                        <div
                          key={`ch_${ch.id}`}
                          className="flex items-center justify-between gap-2 py-2.5 text-[13.5px]"
                        >
                          <span className="text-[var(--tx)]">
                            Completed chapter: <strong>{ch.name}</strong> ({sub.e}{' '}
                            {sub.name})
                          </span>
                          <span className="tnum text-[12px] font-semibold text-[var(--ac-ink)]">
                            +25 XP
                          </span>
                        </div>
                      );
                    })}
                    {record.revisionsCompleted.map((rev, idx) => {
                      const sub = getSubject(state, rev.chapter.subjectId);
                      return (
                        <div
                          key={`rev_${rev.chapter.id}_${idx}`}
                          className="flex items-center justify-between gap-2 py-2.5 text-[13.5px]"
                        >
                          <span className="text-[var(--tx)]">
                            Revision {rev.label}: <strong>{rev.chapter.name}</strong> (
                            {sub.e} {sub.name})
                          </span>
                          <span className="text-[12px] font-semibold text-[var(--ok-ink)]">
                            Done
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Mocks, PYQs, Mistakes & Doubts */}
              {(record.mocks.length > 0 ||
                record.pyqEntries.length > 0 ||
                record.mistakes.length > 0 ||
                record.doubtsCreated.length > 0) && (
                <div>
                  <h4 className="mb-2 text-[12.5px] font-semibold text-[var(--tx-2)]">
                    Mocks, PYQs &amp; practice logs
                  </h4>
                  <div className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3">
                    {record.mocks.map((mk) => {
                      const sc = computeMockScore(mk, state.subjects);
                      return (
                        <div
                          key={mk.id}
                          className="flex items-center justify-between gap-2 py-2.5 text-[13.5px]"
                        >
                          <span className="text-[var(--tx)]">
                            Mock test: <strong>{mk.name}</strong>
                          </span>
                          <strong className="tnum text-[13px] text-[var(--ac-ink)]">
                            {sc.totalScore}/{sc.maxMarks} ({sc.accuracyPct}%)
                          </strong>
                        </div>
                      );
                    })}
                    {record.pyqEntries.map((pq) => {
                      const ch = state.chapters.find((c) => c.id === pq.chapterId);
                      return (
                        <div
                          key={pq.id}
                          className="flex items-center justify-between gap-2 py-2.5 text-[13.5px]"
                        >
                          <span className="text-[var(--tx)]">
                            PYQ practice: <strong>{ch ? ch.name : 'Chapter'}</strong>
                          </span>
                          <strong className="tnum text-[13px] text-[var(--tx)]">
                            {pq.correct}/{pq.attempted} correct
                          </strong>
                        </div>
                      );
                    })}
                    {record.mistakes.map((ms) => {
                      const sub = getSubject(state, ms.subjectId);
                      return (
                        <div
                          key={ms.id}
                          className="flex items-center justify-between gap-2 py-2.5 text-[13.5px]"
                        >
                          <span className="text-[var(--tx)]">
                            Mistake ({sub.e} {sub.name} · {ms.reason}):{' '}
                            {ms.note || 'Logged'}
                          </span>
                          <span className="text-[12px] text-[var(--tx-2)]">
                            {ms.resolved ? 'Resolved' : 'Open'}
                          </span>
                        </div>
                      );
                    })}
                    {record.doubtsCreated.map((db) => {
                      const sub = getSubject(state, db.subjectId);
                      return (
                        <div
                          key={db.id}
                          className="flex items-center justify-between gap-2 py-2.5 text-[13.5px]"
                        >
                          <span className="text-[var(--tx)]">
                            Doubt ({sub.e} {sub.name}): {db.text}
                          </span>
                          <span className="text-[12px] text-[var(--tx-2)]">
                            {db.resolved ? 'Resolved' : 'Open'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Wellbeing & Reflection */}
              {(record.sleepHours !== undefined ||
                record.energyLevel !== undefined ||
                record.moodValue !== undefined ||
                Boolean(record.dailyNote)) && (
                <div>
                  <h4 className="mb-2 text-[12.5px] font-semibold text-[var(--tx-2)]">
                    Wellbeing &amp; reflection
                  </h4>
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--sf-2)] p-3 text-[13px] text-[var(--tx)] space-y-1.5">
                    <div className="flex flex-wrap gap-4">
                      {record.sleepHours !== undefined && (
                        <span>
                          Sleep: <strong className="tnum">{record.sleepHours}h</strong>
                        </span>
                      )}
                      {record.energyLevel !== undefined && (
                        <span>
                          Energy:{' '}
                          <strong className="tnum">{record.energyLevel}/5</strong>
                        </span>
                      )}
                      {record.moodValue !== undefined &&
                        MOOD_LABELS[record.moodValue] && (
                          <span>
                            Mood: <strong>{MOOD_LABELS[record.moodValue]}</strong>
                          </span>
                        )}
                    </div>
                    {record.dailyNote && (
                      <p className="border-t border-[var(--line)] pt-2 text-[var(--tx-2)]">
                        Reflection: “{record.dailyNote}”
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {/* Section 2: Didn't Do */}
      {showMissedSection && (
        <Card className="space-y-4">
          <SectionHeader
            title={`Didn't do on ${selectedDayKey}`}
            subtitle="Unfinished habits, pending tasks, and missed revisions"
            action={
              <span className="tnum rounded-md bg-[var(--sf-2)] px-2.5 py-1 text-[12px] font-medium text-[var(--err-ink)]">
                {totalMissedCount} missed
              </span>
            }
          />

          {totalMissedCount === 0 ? (
            <div className="rounded-xl border border-[var(--line)] bg-[var(--sf-2)] p-4 text-center text-[13px] font-medium text-[var(--ok-ink)]">
              Nothing missed on {selectedDayKey}. All due habits, tasks, and targets were
              completed.
            </div>
          ) : (
            <div className="space-y-4">
              {!record.isFuture &&
                !record.isRestDay &&
                !record.metMinStudyTarget && (
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3 py-2.5 text-[13px]">
                    <span className="flex items-center gap-2 font-medium text-[var(--tx)]">
                      <XCircle size={16} className="shrink-0 text-[var(--err-ink)]" aria-hidden="true" />
                      Daily study minimum not reached
                    </span>
                    <span className="tnum text-[12px] text-[var(--err-ink)]">
                      {fmtHMShort(record.studyMs)} / {fmtHMShort(record.minTargetMs)}
                    </span>
                  </div>
                )}

              {record.habitsMissed.length > 0 && (
                <div>
                  <h4 className="mb-2 text-[12.5px] font-semibold text-[var(--tx-2)]">
                    Due habits not completed ({record.habitsMissed.length})
                  </h4>
                  <div className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3">
                    {record.habitsMissed.map(({ habit, value, target, unit }) => (
                      <div
                        key={habit.id}
                        className="flex items-center justify-between gap-2 py-2.5 text-[13.5px]"
                      >
                        <span className="flex items-center gap-2 font-medium text-[var(--tx)]">
                          <XCircle size={16} className="shrink-0 text-[var(--err-ink)]" aria-hidden="true" />
                          {habit.e} {habit.name}
                        </span>
                        <span className="tnum text-[12px] text-[var(--err-ink)]">
                          {value}/{target} {unit}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {record.tasksMissed.length > 0 && (
                <div>
                  <h4 className="mb-2 text-[12.5px] font-semibold text-[var(--tx-2)]">
                    Unfinished daily tasks ({record.tasksMissed.length})
                  </h4>
                  <div className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3">
                    {record.tasksMissed.map((task) => {
                      const sub = task.subjectId
                        ? getSubject(state, task.subjectId)
                        : null;
                      return (
                        <div
                          key={task.id}
                          className="flex items-center justify-between gap-2 py-2.5 text-[13.5px]"
                        >
                          <span className="flex items-center gap-2 font-medium text-[var(--tx)]">
                            <XCircle size={16} className="shrink-0 text-[var(--err-ink)]" aria-hidden="true" />
                            {task.title}
                          </span>
                          {sub && (
                            <span className="rounded-md bg-[var(--sf-1)] px-2 py-0.5 text-[12px] text-[var(--tx-2)]">
                              {sub.e} {sub.name}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {record.revisionsMissed.length > 0 && (
                <div>
                  <h4 className="mb-2 text-[12.5px] font-semibold text-[var(--tx-2)]">
                    Scheduled revisions not marked done ({record.revisionsMissed.length})
                  </h4>
                  <div className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3">
                    {record.revisionsMissed.map((rev, idx) => {
                      const sub = getSubject(state, rev.chapter.subjectId);
                      return (
                        <div
                          key={`missed_rev_${rev.chapter.id}_${idx}`}
                          className="flex items-center justify-between gap-2 py-2.5 text-[13.5px]"
                        >
                          <span className="text-[var(--tx)]">
                            {rev.label}: <strong>{rev.chapter.name}</strong> ({sub.e}{' '}
                            {sub.name})
                          </span>
                          <span className="tnum text-[12px] text-[var(--err-ink)]">
                            Due {rev.scheduledDate}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {record.habitsSkipped.length > 0 && (
                <div>
                  <h4 className="mb-2 text-[12.5px] font-semibold text-[var(--tx-2)]">
                    Skipped habits ({record.habitsSkipped.length})
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {record.habitsSkipped.map((h) => (
                      <span
                        key={h.id}
                        className="rounded-lg border border-[var(--line)] bg-[var(--sf-2)] px-2.5 py-1 text-[12.5px] text-[var(--tx-2)]"
                      >
                        {h.e} {h.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
};
