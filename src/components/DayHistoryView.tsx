import React, { useEffect, useMemo, useState } from 'react';
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

const MOOD_EMOJIS: Record<number, { emoji: string; label: string }> = {
  1: { emoji: '😫', label: 'Drained' },
  2: { emoji: '😕', label: 'Low' },
  3: { emoji: '😐', label: 'Okay' },
  4: { emoji: '🙂', label: 'Good' },
  5: { emoji: '🔥', label: 'In Flow' },
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

  // Habits due on dayKey (plus any habit that has a log entry on dayKey)
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

  // Daily Tasks for dayKey
  const dayTasks = (state.tasks || []).filter((t) => t.dayKey === dayKey);
  const tasksCompleted = dayTasks.filter((t) => t.done);
  const tasksMissed = isFuture ? [] : dayTasks.filter((t) => !t.done);

  // Study Sessions on dayKey
  const sessions = (state.sessions || [])
    .filter((s) => s.dayKey === dayKey)
    .slice()
    .sort((a, b) => a.startTs - b.startTs);

  // Syllabus Chapters & Revisions on dayKey
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

  // Mocks, PYQs, Mistakes, Doubts
  const mocks = (state.mocks || []).filter((m) => m.dayKey === dayKey);
  const pyqEntries = (state.pyq || []).filter((p) => p.dayKey === dayKey);
  const mistakes = (state.mistakes || []).filter((m) => m.dayKey === dayKey);
  const resetHour = state.set.dayResetHour ?? 0;
  const doubtsCreated = (state.doubts || []).filter(
    (d) => logicalKey(d.createdAt, resetHour) === dayKey
  );

  // Wellbeing, Mood & Note
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

  // Build calendar cells for calYearMonth
  const calendarCells = useMemo(() => {
    const { year, month } = calYearMonth;
    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const weekStart = state.set.ws ?? 1; // 0 = Sun, 1 = Mon
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
    <div>
      {/* Top Date Selector & Navigation Bar */}
      <div className="card" style={{ padding: '14px' }}>
        <div
          className="row sp"
          style={{ flexWrap: 'wrap', gap: '10px', marginBottom: '10px' }}
        >
          <div>
            <small
              style={{
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                fontWeight: 700,
                color: 'var(--ac)',
              }}
            >
              📅 Daily Activity Archive &amp; Time Machine
            </small>
            <h3 style={{ marginTop: '2px', fontSize: '17px' }}>
              {formatReadableDate(selectedDayKey)}
            </h3>
            <small className="mono mut">
              Date Key: {selectedDayKey}
              {selectedDayKey === todayKey
                ? ' · Today'
                : selectedDayKey > todayKey
                  ? ' · Future Date'
                  : ''}
              {record.isRestDay ? ' · 🛡️ Rest Pass Day' : ''}
            </small>
          </div>

          <div className="row" style={{ gap: '6px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="s"
              onClick={() => handleSelectDate(addD(selectedDayKey, -1))}
              aria-label="Previous day"
              title="Go to previous day"
            >
              ← Prev
            </button>
            <input
              type="date"
              aria-label="Select date to view history"
              value={selectedDayKey}
              onChange={(e) => {
                if (e.target.value) handleSelectDate(e.target.value);
              }}
              style={{
                width: 'auto',
                padding: '7px 10px',
                borderRadius: '10px',
                fontSize: '13px',
                fontWeight: 700,
              }}
            />
            <button
              type="button"
              className="s"
              onClick={() => handleSelectDate(addD(selectedDayKey, 1))}
              aria-label="Next day"
              title="Go to next day"
            >
              Next →
            </button>
            {selectedDayKey !== todayKey && (
              <button
                type="button"
                className="s pri"
                onClick={() => handleSelectDate(todayKey)}
              >
                Today
              </button>
            )}
          </div>
        </div>

        {/* Toggleable Interactive Month Calendar */}
        <div
          className="row sp"
          style={{
            paddingTop: '8px',
            borderTop: '1px solid var(--bd)',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          <button
            type="button"
            className="s"
            onClick={() => setShowCalendarPicker((v) => !v)}
            style={{ fontSize: '12px', padding: '5px 10px' }}
          >
            {showCalendarPicker ? '🗓️ Hide Month Calendar ▴' : '🗓️ Browse Month Calendar ▾'}
          </button>

          {onSelectDateInToday && (
            <button
              type="button"
              className="s pri"
              onClick={() => onSelectDateInToday(selectedDayKey)}
              style={{ fontSize: '12px', padding: '5px 12px' }}
              title="Switch to the Today tab with this date selected so you can check off habits or edit tasks"
            >
              ✏️ Edit This Day in Today Tab →
            </button>
          )}
        </div>

        {showCalendarPicker && (
          <div
            style={{
              marginTop: '10px',
              padding: '10px',
              borderRadius: '12px',
              background: 'var(--c2)',
              border: '1px solid var(--bd)',
            }}
          >
            <div className="row sp" style={{ marginBottom: '8px' }}>
              <button
                type="button"
                className="s"
                style={{ padding: '4px 10px', fontSize: '12px' }}
                onClick={() =>
                  setCalYearMonth((prev) => {
                    const dt = new Date(prev.year, prev.month - 1, 1);
                    return { year: dt.getFullYear(), month: dt.getMonth() };
                  })
                }
              >
                ‹ Prev Month
              </button>
              <b style={{ fontSize: '13.5px' }}>
                {MONTH_NAMES[calYearMonth.month]} {calYearMonth.year}
              </b>
              <button
                type="button"
                className="s"
                style={{ padding: '4px 10px', fontSize: '12px' }}
                onClick={() =>
                  setCalYearMonth((prev) => {
                    const dt = new Date(prev.year, prev.month + 1, 1);
                    return { year: dt.getFullYear(), month: dt.getMonth() };
                  })
                }
              >
                Next Month ›
              </button>
            </div>

            {/* Weekday Header */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, 1fr)',
                gap: '4px',
                textAlign: 'center',
                marginBottom: '4px',
              }}
            >
              {Array.from({ length: 7 }, (_, i) => {
                const dow = ((state.set.ws ?? 1) + i) % 7;
                return (
                  <small
                    key={i}
                    className="mut"
                    style={{ fontSize: '10.5px', fontWeight: 700 }}
                  >
                    {DN[dow]}
                  </small>
                );
              })}
            </div>

            {/* Days Grid */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, 1fr)',
                gap: '4px',
              }}
            >
              {calendarCells.map((cell, idx) => {
                if (!cell) {
                  return <div key={`empty_${idx}`} style={{ minHeight: '38px' }} />;
                }
                const hasActivity = cell.studyMs > 0 || cell.doneCount > 0;
                const allDone =
                  cell.totalCount > 0 && cell.doneCount === cell.totalCount;
                return (
                  <button
                    key={cell.dayKey}
                    type="button"
                    onClick={() => handleSelectDate(cell.dayKey)}
                    title={`${cell.dayKey}: Studied ${fmtHMShort(cell.studyMs)} · Habits & Tasks ${cell.doneCount}/${cell.totalCount} (${cell.pct}%)`}
                    style={{
                      minHeight: '40px',
                      padding: '3px 2px',
                      borderRadius: '8px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '2px',
                      fontSize: '12px',
                      fontWeight: cell.isSelected || cell.isToday ? 800 : 600,
                      border: cell.isSelected
                        ? '2px solid var(--ac)'
                        : cell.isToday
                          ? '1.5px dashed var(--em)'
                          : '1px solid var(--bd)',
                      background: cell.isSelected
                        ? 'rgba(56, 189, 248, 0.18)'
                        : allDone && !cell.isFuture
                          ? 'rgba(16, 185, 129, 0.14)'
                          : hasActivity
                            ? 'rgba(56, 189, 248, 0.08)'
                            : 'var(--card)',
                      opacity: cell.isFuture ? 0.45 : 1,
                    }}
                  >
                    <span>{cell.dayNum}</span>
                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '2px',
                        fontSize: '9px',
                        lineHeight: 1,
                      }}
                    >
                      {cell.studyMs > 0 && (
                        <i
                          style={{
                            width: '5px',
                            height: '5px',
                            borderRadius: '50%',
                            background: '#10b981',
                            display: 'inline-block',
                          }}
                        />
                      )}
                      {cell.doneCount > 0 && (
                        <i
                          style={{
                            width: '5px',
                            height: '5px',
                            borderRadius: '50%',
                            background: '#38bdf8',
                            display: 'inline-block',
                          }}
                        />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Day Summary KPI Cards */}
      <div
        className="stat-mini"
        style={{
          gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))',
          gap: '8px',
          marginBottom: '12px',
        }}
      >
        <div className="card" style={{ margin: 0, padding: '12px' }}>
          <small className="mut">⏱️ Study Time</small>
          <b
            className="mono"
            style={{
              display: 'block',
              fontSize: '18px',
              marginTop: '2px',
              color: record.metMinStudyTarget ? 'var(--em)' : 'var(--tx)',
            }}
          >
            {fmtHMShort(record.studyMs)}
          </b>
          <small className="mut" style={{ fontSize: '11px' }}>
            {record.metMinStudyTarget
              ? `✅ Met ${fmtHMShort(record.minTargetMs)} min goal`
              : record.isRestDay
                ? '🛡️ Protected Rest Day'
                : `Goal: ${fmtHMShort(record.minTargetMs)}`}
          </small>
        </div>

        <div className="card" style={{ margin: 0, padding: '12px' }}>
          <small className="mut">🔥 Habits Due</small>
          <b
            className="mono"
            style={{ display: 'block', fontSize: '18px', marginTop: '2px' }}
          >
            {record.habitsCompleted.length}/
            {record.habitsCompleted.length + record.habitsMissed.length}
          </b>
          <small className="mut" style={{ fontSize: '11px' }}>
            {record.habitsMissed.length === 0
              ? 'All due habits completed'
              : `${record.habitsMissed.length} missed`}
          </small>
        </div>

        <div className="card" style={{ margin: 0, padding: '12px' }}>
          <small className="mut">☑️ Daily Tasks</small>
          <b
            className="mono"
            style={{ display: 'block', fontSize: '18px', marginTop: '2px' }}
          >
            {record.tasksCompleted.length}/
            {record.tasksCompleted.length + record.tasksMissed.length}
          </b>
          <small className="mut" style={{ fontSize: '11px' }}>
            {record.tasksMissed.length === 0
              ? record.tasksCompleted.length > 0
                ? 'All tasks finished!'
                : 'No tasks scheduled'
              : `${record.tasksMissed.length} unfinished`}
          </small>
        </div>

        <div className="card" style={{ margin: 0, padding: '12px' }}>
          <small className="mut">⚡ XP Earned</small>
          <b
            className="mono"
            style={{
              display: 'block',
              fontSize: '18px',
              marginTop: '2px',
              color: 'var(--ac)',
            }}
          >
            +{record.xpEarned} XP
          </b>
          <small className="mut" style={{ fontSize: '11px' }}>
            {record.sessions.length}{' '}
            {record.sessions.length === 1 ? 'session' : 'sessions'} logged
          </small>
        </div>
      </div>

      {/* Filter Bar: All | What I Did | What I Missed */}
      <div
        className="chips wrap"
        style={{ marginBottom: '12px', gap: '6px', paddingBottom: 0 }}
      >
        <button
          type="button"
          className={filterMode === 'all' ? 'on' : ''}
          onClick={() => setFilterMode('all')}
        >
          📋 Full Day View ({totalDidCount + totalMissedCount})
        </button>
        <button
          type="button"
          className={filterMode === 'did' ? 'on' : ''}
          onClick={() => setFilterMode('did')}
        >
          ✅ What I Did ({totalDidCount})
        </button>
        <button
          type="button"
          className={filterMode === 'missed' ? 'on' : ''}
          onClick={() => setFilterMode('missed')}
        >
          ❌ What I Didn&apos;t Do ({totalMissedCount})
        </button>
      </div>

      {/* SECTION 1: WHAT I DID ON THIS DAY */}
      {showDidSection && (
        <div
          className="card"
          style={{
            borderLeft: '4px solid #10b981',
            marginBottom: '12px',
          }}
        >
          <div className="row sp" style={{ marginBottom: '10px' }}>
            <div>
              <h3 style={{ color: '#10b981' }}>
                ✅ What I Did on {selectedDayKey}
              </h3>
              <small>
                Completed habits, finished tasks, study sessions, chapters, revisions &amp; logs
              </small>
            </div>
            <span className="pill mono" style={{ color: '#10b981' }}>
              {totalDidCount} completed
            </span>
          </div>

          {totalDidCount === 0 ? (
            <div
              className="mut"
              style={{
                padding: '14px',
                borderRadius: '10px',
                background: 'var(--c2)',
                textAlign: 'center',
                fontSize: '13px',
              }}
            >
              No completed habits, tasks, or study sessions recorded on{' '}
              <b>{selectedDayKey}</b>.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* 1. Completed Habits */}
              {record.habitsCompleted.length > 0 && (
                <div>
                  <small
                    style={{
                      display: 'block',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      marginBottom: '6px',
                      color: 'var(--mu)',
                    }}
                  >
                    🔥 Habits Completed ({record.habitsCompleted.length})
                  </small>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {record.habitsCompleted.map(({ habit, value, target, unit }) => (
                      <div
                        key={habit.id}
                        className="row sp"
                        style={{
                          padding: '8px 10px',
                          borderRadius: '10px',
                          background: 'var(--c2)',
                          border: '1px solid rgba(16, 185, 129, 0.28)',
                        }}
                      >
                        <span style={{ fontWeight: 700, fontSize: '13.5px' }}>
                          ✅ {habit.e} {habit.name}{' '}
                          <span
                            className="pill"
                            style={{
                              fontSize: '10px',
                              padding: '1px 6px',
                              marginLeft: '4px',
                              borderColor: CC[habit.c] || '#94a3b8',
                            }}
                          >
                            {habit.c}
                          </span>
                        </span>
                        <span
                          className="mono"
                          style={{
                            fontSize: '12px',
                            fontWeight: 700,
                            color: '#10b981',
                          }}
                        >
                          {value}/{target} {unit}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 2. Completed Daily Tasks */}
              {record.tasksCompleted.length > 0 && (
                <div>
                  <small
                    style={{
                      display: 'block',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      marginBottom: '6px',
                      color: 'var(--mu)',
                    }}
                  >
                    ☑️ Daily Tasks Finished ({record.tasksCompleted.length})
                  </small>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {record.tasksCompleted.map((task) => {
                      const sub = task.subjectId
                        ? getSubject(state, task.subjectId)
                        : null;
                      return (
                        <div
                          key={task.id}
                          className="row sp"
                          style={{
                            padding: '8px 10px',
                            borderRadius: '10px',
                            background: 'var(--c2)',
                            border: '1px solid rgba(16, 185, 129, 0.28)',
                          }}
                        >
                          <span style={{ fontWeight: 600, fontSize: '13.5px' }}>
                            ✅ {task.title}
                          </span>
                          {sub && (
                            <span
                              className="pill"
                              style={{
                                fontSize: '11px',
                                padding: '2px 8px',
                                borderColor: sub.color,
                              }}
                            >
                              {sub.e} {sub.name}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 3. Logged Study Sessions */}
              {record.sessions.length > 0 && (
                <div>
                  <div className="row sp" style={{ marginBottom: '6px' }}>
                    <small
                      style={{
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        color: 'var(--mu)',
                      }}
                    >
                      📚 Study Sessions Logged ({record.sessions.length} ·{' '}
                      {fmtHMShort(record.studyMs)})
                    </small>
                    {onOpenManualSession && (
                      <button
                        type="button"
                        className="s"
                        style={{ padding: '3px 8px', fontSize: '11px' }}
                        onClick={() => onOpenManualSession()}
                      >
                        + Log Session
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {record.sessions.map((ses) => {
                      const sub = getSubject(state, ses.subjectId);
                      const heading = getSessionHeading(state, ses);
                      return (
                        <div
                          key={ses.id}
                          className="row sp"
                          style={{
                            padding: '8px 10px',
                            borderRadius: '10px',
                            background: 'var(--c2)',
                            border: '1px solid var(--bd)',
                          }}
                        >
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <b style={{ fontSize: '13.5px', display: 'block' }}>
                              {sub.e} {sub.name} · {heading}
                            </b>
                            <small className="mut">
                              {fmtClockTime(ses.startTs)} – {fmtClockTime(ses.endTs)} ·{' '}
                              {ses.mode.toUpperCase()} · Purity {ses.purity ?? 100}%
                            </small>
                            {ses.note && (
                              <small
                                style={{
                                  display: 'block',
                                  color: 'var(--tx)',
                                  marginTop: '2px',
                                }}
                              >
                                “{ses.note}”
                              </small>
                            )}
                          </div>
                          <div className="row" style={{ gap: '8px', flexShrink: 0 }}>
                            <b
                              className="mono"
                              style={{ color: '#10b981', fontSize: '13.5px' }}
                            >
                              {fmtHMShort(ses.activeMs)}
                            </b>
                            {onEditSession && (
                              <button
                                type="button"
                                className="s"
                                style={{ padding: '4px 8px', fontSize: '11px' }}
                                onClick={() => onEditSession(ses.id)}
                              >
                                Edit
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 4. Syllabus Chapters & Revisions Completed */}
              {(record.chaptersCompleted.length > 0 ||
                record.revisionsCompleted.length > 0) && (
                <div>
                  <small
                    style={{
                      display: 'block',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      marginBottom: '6px',
                      color: 'var(--mu)',
                    }}
                  >
                    🎯 Chapters &amp; Revisions Completed
                  </small>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {record.chaptersCompleted.map((ch) => {
                      const sub = getSubject(state, ch.subjectId);
                      return (
                        <div
                          key={`ch_${ch.id}`}
                          className="row sp"
                          style={{
                            padding: '8px 10px',
                            borderRadius: '10px',
                            background: 'var(--c2)',
                          }}
                        >
                          <span>
                            🎓 Completed Chapter: <b>{ch.name}</b> ({sub.e} {sub.name})
                          </span>
                          <span className="pill mono" style={{ fontSize: '11px' }}>
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
                          className="row sp"
                          style={{
                            padding: '8px 10px',
                            borderRadius: '10px',
                            background: 'var(--c2)',
                          }}
                        >
                          <span>
                            🔁 Revision {rev.label}: <b>{rev.chapter.name}</b> ({sub.e}{' '}
                            {sub.name})
                          </span>
                          <span className="pill mono" style={{ fontSize: '11px' }}>
                            Done
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 5. Mocks, PYQs, Mistakes & Doubts Logged */}
              {(record.mocks.length > 0 ||
                record.pyqEntries.length > 0 ||
                record.mistakes.length > 0 ||
                record.doubtsCreated.length > 0) && (
                <div>
                  <small
                    style={{
                      display: 'block',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      marginBottom: '6px',
                      color: 'var(--mu)',
                    }}
                  >
                    📝 Mocks, PYQs &amp; Practice Logs
                  </small>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {record.mocks.map((mk) => {
                      const sc = computeMockScore(mk, state.subjects);
                      return (
                        <div
                          key={mk.id}
                          className="row sp"
                          style={{
                            padding: '8px 10px',
                            borderRadius: '10px',
                            background: 'var(--c2)',
                          }}
                        >
                          <span>
                            📊 Mock Test: <b>{mk.name}</b>
                          </span>
                          <b className="mono">
                            {sc.totalScore}/{sc.maxMarks} ({sc.accuracyPct}% acc)
                          </b>
                        </div>
                      );
                    })}
                    {record.pyqEntries.map((pq) => {
                      const ch = state.chapters.find((c) => c.id === pq.chapterId);
                      return (
                        <div
                          key={pq.id}
                          className="row sp"
                          style={{
                            padding: '8px 10px',
                            borderRadius: '10px',
                            background: 'var(--c2)',
                          }}
                        >
                          <span>
                            📘 PYQ Practice: <b>{ch ? ch.name : 'Chapter'}</b>
                          </span>
                          <b className="mono">
                            {pq.correct}/{pq.attempted} correct
                          </b>
                        </div>
                      );
                    })}
                    {record.mistakes.map((ms) => {
                      const sub = getSubject(state, ms.subjectId);
                      return (
                        <div
                          key={ms.id}
                          className="row sp"
                          style={{
                            padding: '8px 10px',
                            borderRadius: '10px',
                            background: 'var(--c2)',
                          }}
                        >
                          <span>
                            ⚠️ Mistake Logged ({sub.e} {sub.name} · {ms.reason}):{' '}
                            {ms.note || 'No note'}
                          </span>
                          <span className="pill" style={{ fontSize: '10.5px' }}>
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
                          className="row sp"
                          style={{
                            padding: '8px 10px',
                            borderRadius: '10px',
                            background: 'var(--c2)',
                          }}
                        >
                          <span>
                            ❓ Doubt ({sub.e} {sub.name}): {db.text}
                          </span>
                          <span className="pill" style={{ fontSize: '10.5px' }}>
                            {db.resolved ? 'Resolved' : 'Open'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 6. Wellbeing, Mood & Daily Note */}
              {(record.sleepHours !== undefined ||
                record.energyLevel !== undefined ||
                record.moodValue !== undefined ||
                Boolean(record.dailyNote)) && (
                <div>
                  <small
                    style={{
                      display: 'block',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      marginBottom: '6px',
                      color: 'var(--mu)',
                    }}
                  >
                    🌙 Wellbeing, Mood &amp; Daily Journal
                  </small>
                  <div
                    style={{
                      padding: '10px',
                      borderRadius: '10px',
                      background: 'var(--c2)',
                    }}
                  >
                    <div className="row" style={{ gap: '12px', flexWrap: 'wrap' }}>
                      {record.sleepHours !== undefined && (
                        <span>
                          💤 Sleep: <b className="mono">{record.sleepHours}h</b>
                        </span>
                      )}
                      {record.energyLevel !== undefined && (
                        <span>
                          ⚡ Energy: <b className="mono">{record.energyLevel}/5</b>
                        </span>
                      )}
                      {record.moodValue !== undefined &&
                        MOOD_EMOJIS[record.moodValue] && (
                          <span>
                            Mood: {MOOD_EMOJIS[record.moodValue].emoji}{' '}
                            <b>{MOOD_EMOJIS[record.moodValue].label}</b>
                          </span>
                        )}
                    </div>
                    {record.dailyNote && (
                      <div
                        style={{
                          marginTop: '6px',
                          paddingTop: '6px',
                          borderTop: '1px solid var(--bd)',
                          fontSize: '13px',
                        }}
                      >
                        📝 <b>Daily Reflection:</b> “{record.dailyNote}”
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* SECTION 2: WHAT I DIDN'T DO / MISSED ON THIS DAY */}
      {showMissedSection && (
        <div
          className="card"
          style={{
            borderLeft: '4px solid #ef4444',
            marginBottom: '12px',
          }}
        >
          <div className="row sp" style={{ marginBottom: '10px' }}>
            <div>
              <h3 style={{ color: '#f87171' }}>
                ❌ What I Didn&apos;t Do on {selectedDayKey}
              </h3>
              <small>
                Habits due but not completed, unfinished daily tasks, and missed targets
              </small>
            </div>
            <span className="pill mono" style={{ color: '#f87171' }}>
              {totalMissedCount} missed
            </span>
          </div>

          {totalMissedCount === 0 ? (
            <div
              style={{
                padding: '14px',
                borderRadius: '10px',
                background: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                textAlign: 'center',
                fontSize: '13px',
                color: '#10b981',
                fontWeight: 700,
              }}
            >
              🎉 Nothing missed on {selectedDayKey}! All due habits, tasks, and targets were
              completed.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Missed Daily Minimum Study Target */}
              {!record.isFuture &&
                !record.isRestDay &&
                !record.metMinStudyTarget && (
                  <div
                    className="row sp"
                    style={{
                      padding: '8px 10px',
                      borderRadius: '10px',
                      background: 'rgba(239, 68, 68, 0.09)',
                      border: '1px solid rgba(239, 68, 68, 0.28)',
                    }}
                  >
                    <span style={{ fontWeight: 700, fontSize: '13px' }}>
                      ⏱️ Daily Study Minimum Not Reached
                    </span>
                    <span className="mono" style={{ fontSize: '12px', color: '#f87171' }}>
                      {fmtHMShort(record.studyMs)} / {fmtHMShort(record.minTargetMs)} (short by{' '}
                      {fmtHMShort(Math.max(0, record.minTargetMs - record.studyMs))})
                    </span>
                  </div>
                )}

              {/* Missed Habits */}
              {record.habitsMissed.length > 0 && (
                <div>
                  <small
                    style={{
                      display: 'block',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      marginBottom: '6px',
                      color: 'var(--mu)',
                    }}
                  >
                    🔥 Due Habits Not Completed ({record.habitsMissed.length})
                  </small>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {record.habitsMissed.map(({ habit, value, target, unit }) => (
                      <div
                        key={habit.id}
                        className="row sp"
                        style={{
                          padding: '8px 10px',
                          borderRadius: '10px',
                          background: 'var(--c2)',
                          border: '1px solid rgba(239, 68, 68, 0.25)',
                        }}
                      >
                        <span style={{ fontWeight: 600, fontSize: '13.5px' }}>
                          ❌ {habit.e} {habit.name}{' '}
                          <span
                            className="pill"
                            style={{
                              fontSize: '10px',
                              padding: '1px 6px',
                              marginLeft: '4px',
                              borderColor: CC[habit.c] || '#94a3b8',
                            }}
                          >
                            {habit.c}
                          </span>
                        </span>
                        <span
                          className="mono"
                          style={{ fontSize: '12px', color: '#f87171', fontWeight: 700 }}
                        >
                          {value}/{target} {unit}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Unfinished Daily Tasks */}
              {record.tasksMissed.length > 0 && (
                <div>
                  <small
                    style={{
                      display: 'block',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      marginBottom: '6px',
                      color: 'var(--mu)',
                    }}
                  >
                    ☑️ Unfinished Daily Tasks ({record.tasksMissed.length})
                  </small>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {record.tasksMissed.map((task) => {
                      const sub = task.subjectId
                        ? getSubject(state, task.subjectId)
                        : null;
                      return (
                        <div
                          key={task.id}
                          className="row sp"
                          style={{
                            padding: '8px 10px',
                            borderRadius: '10px',
                            background: 'var(--c2)',
                            border: '1px solid rgba(239, 68, 68, 0.25)',
                          }}
                        >
                          <span style={{ fontWeight: 600, fontSize: '13.5px' }}>
                            ❌ {task.title}
                          </span>
                          {sub && (
                            <span
                              className="pill"
                              style={{
                                fontSize: '11px',
                                padding: '2px 8px',
                                borderColor: sub.color,
                              }}
                            >
                              {sub.e} {sub.name}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Pending / Missed Chapter Revisions Scheduled for This Day */}
              {record.revisionsMissed.length > 0 && (
                <div>
                  <small
                    style={{
                      display: 'block',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      marginBottom: '6px',
                      color: 'var(--mu)',
                    }}
                  >
                    🔁 Scheduled Revisions Not Marked Done ({record.revisionsMissed.length})
                  </small>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {record.revisionsMissed.map((rev, idx) => {
                      const sub = getSubject(state, rev.chapter.subjectId);
                      return (
                        <div
                          key={`missed_rev_${rev.chapter.id}_${idx}`}
                          className="row sp"
                          style={{
                            padding: '8px 10px',
                            borderRadius: '10px',
                            background: 'var(--c2)',
                            border: '1px solid rgba(239, 68, 68, 0.25)',
                          }}
                        >
                          <span>
                            ❌ {rev.label}: <b>{rev.chapter.name}</b> ({sub.e} {sub.name})
                          </span>
                          <span className="pill mono" style={{ fontSize: '11px', color: '#f87171' }}>
                            Due {rev.scheduledDate}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Skipped Habits Info */}
              {record.habitsSkipped.length > 0 && (
                <div>
                  <small
                    style={{
                      display: 'block',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      marginBottom: '4px',
                      color: 'var(--mu)',
                    }}
                  >
                    ⏭️ Intentionally Skipped Habits ({record.habitsSkipped.length})
                  </small>
                  <div className="chips wrap" style={{ paddingBottom: 0 }}>
                    {record.habitsSkipped.map((h) => (
                      <span key={h.id} className="pill" style={{ fontSize: '11.5px' }}>
                        ⏭️ {h.e} {h.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
