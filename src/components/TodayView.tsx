import React, { useMemo, useRef, useState } from 'react';
import type { ActiveTimerMode, AppTab, DailyTask, Habit, HabitCategory, PulseHabitState } from '../types';
import {
  CATS,
  CC,
  DN,
  STARTERS,
  addD,
  done,
  dueOn,
  ent,
  fmtClockTime,
  fmtHMShort,
  fmtMS,
  getDailyFocusTip,
  getDayProgress,
  getDueAndOverdueRevisions,
  getSessionHeading,
  getSubject,
  getTimerMetrics,
  getTodaySubjectMs,
  lvl,
  pad,
  parseKey,
  skip,
  streak,
  wkC,
  xp,
} from '../utils/studyLogic';
import { computePaceReport, computeStudyNext } from '../utils/pace';
import {
  checkBurnoutStatus,
  computeConsistencyScore,
  computeMinDayStreak,
  getSubjectTargetProgress,
} from '../utils/insights';

interface TodayViewProps {
  state: PulseHabitState;
  sel: string;
  todayKey: string;
  cat: 'All' | HabitCategory;
  onSelectDay: (dayKey: string) => void;
  onSelectCat: (cat: 'All' | HabitCategory) => void;
  onSwitchTab: (tab: AppTab) => void;
  onToggleHabit: (id: string) => void;
  onIncrementHabit: (id: string, delta: number) => void;
  onSkipHabit: (id: string) => void;
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
  onSetMood: (val: number) => void;
  onSetNote: (txt: string) => void;
  onToggleRestDay?: (dayKey: string) => void;
  onUpdateWellbeing?: (
    dayKey: string,
    patch: { sleep?: number; energy?: 1 | 2 | 3 | 4 | 5 }
  ) => void;
  onDismissBurnout?: () => void;
}

export const TodayView: React.FC<TodayViewProps> = ({
  state,
  sel,
  todayKey,
  cat,
  onSelectDay,
  onSelectCat,
  onSwitchTab,
  onToggleHabit,
  onIncrementHabit,
  onSkipHabit,
  onAddStarter,
  onNewHabit,
  onEditHabit,
  onQuickStartSession,
  onNewDDay,
  onEditDDay,
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
  onSetMood,
  onSetNote,
  onToggleRestDay,
  onUpdateWellbeing,
  onDismissBurnout,
}) => {
  const subjects = state.subjects.filter((s) => !s.arch);
  const [tipOffset, setTipOffset] = useState(0);
  const [quickSubjectId, setQuickSubjectId] = useState<string>(
    subjects[0]?.id || 'sub_phy'
  );
  const [quickChapterId, setQuickChapterId] = useState<string>('');
  const [quickHeading, setQuickHeading] = useState('');
  const [reschedulingRevId, setReschedulingRevId] = useState<string | null>(null);
  const [rescheduleDateDraft, setRescheduleDateDraft] = useState<string>(
    addD(todayKey, 1)
  );

  // Coaching calculations (1.2, 1.7, 1.8, 1.9, 1.10, 1.12)
  const paceReport = useMemo(() => computePaceReport(state, todayKey), [state, todayKey]);
  const studyNextTop3 = useMemo(() => computeStudyNext(state, todayKey, 3), [state, todayKey]);
  const minStreakInfo = useMemo(() => computeMinDayStreak(state, todayKey), [state, todayKey]);
  const consistencyInfo = useMemo(
    () => computeConsistencyScore(state, todayKey),
    [state, todayKey]
  );
  const burnoutStatus = useMemo(
    () => checkBurnoutStatus(state, todayKey),
    [state, todayKey]
  );
  const subjectTargets = useMemo(
    () => getSubjectTargetProgress(state, sel),
    [state, sel]
  );
  const quickSubjectChapters = useMemo(
    () => state.chapters.filter((ch) => ch.subjectId === quickSubjectId),
    [state.chapters, quickSubjectId]
  );

  // Daily Tasks UI state
  const [taskTitleDraft, setTaskTitleDraft] = useState('');
  const [taskSubjectId, setTaskSubjectId] = useState<string>('');
  const lastTaskSubmitRef = useRef<{ title: string; ts: number }>({ title: '', ts: 0 });
  const [openMenuTaskId, setOpenMenuTaskId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTitleDraft, setEditingTitleDraft] = useState('');
  const [changingDateTaskId, setChangingDateTaskId] = useState<string | null>(null);
  const [changingDateDraft, setChangingDateDraft] = useState('');
  const [earlierOpen, setEarlierOpen] = useState(true);

  const allDue = dueOn(state, sel);
  const hs = allDue.filter((h) => cat === 'All' || h.c === cat);
  const dayProg = getDayProgress(state, sel);
  const p = Math.round(dayProg.pct * 100);
  const totalXp = xp(state, todayKey);
  const level = lvl(totalXp);
  const currentMood = state.mood[sel] || 0;
  const dayStudyMs = getTodaySubjectMs(state, 'any', sel, todayKey);
  const daySessions = state.sessions
    .filter((s) => s.dayKey === sel)
    .sort((a, b) => b.startTs - a.startTs);
  const avgPurity = daySessions.length
    ? Math.round(daySessions.reduce((a, s) => a + (s.purity ?? 100), 0) / daySessions.length)
    : 100;
  const activeMetrics = getTimerMetrics(state);
  const focusTip = getDailyFocusTip(sel, tipOffset);

  const { dueOnSel, overdue } = getDueAndOverdueRevisions(state, sel, todayKey);
  // Deduplicate if sel < todayKey so an overdue revision on sel isn't shown twice
  const overdueIds = new Set(overdue.map((r) => r.revisionId));
  const dueFiltered = dueOnSel.filter((r) => !overdueIds.has(r.revisionId));

  // Selected day tasks: pending (oldest createdAt first) then completed
  const allTasks = state.tasks || [];
  const dayTasks: DailyTask[] = allTasks
    .filter((t) => t.dayKey === sel)
    .slice()
    .sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });

  // Unfinished tasks from earlier days (dayKey < todayKey)
  const unfinishedEarlier: DailyTask[] = allTasks
    .filter((t) => !t.done && t.dayKey < todayKey)
    .slice()
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey) || (a.createdAt || 0) - (b.createdAt || 0));

  const isFutureDay = sel > todayKey;

  const renderHabitCard = (h: Habit) => {
    const e = ent(state, h, sel);
    const d = done(state, h, sel);
    const sk = skip(state, h, sel);
    const s = streak(state, h, todayKey);
    const u = h.sch === 'week' ? 'w' : 'd';
    const isAutoStudy = Boolean(h.subjectId || h.autoMins);
    const linkedSub =
      h.subjectId && h.subjectId !== 'any' ? getSubject(state, h.subjectId) : null;

    return (
      <div
        key={h.id}
        className={`c ${d ? 'dn' : ''} ${sk ? 'sk' : ''}`}
        style={
          {
            '--hc': CC[h.c] || CC.Other,
            cursor: isAutoStudy ? 'default' : 'pointer',
          } as React.CSSProperties
        }
        onClick={() => {
          if (!isAutoStudy) {
            onToggleHabit(h.id);
          }
        }}
      >
        <button
          type="button"
          className="ck"
          aria-pressed={d}
          aria-label={`Mark ${h.name}`}
          disabled={isAutoStudy}
          onClick={(ev) => {
            ev.stopPropagation();
            if (!isAutoStudy) {
              onToggleHabit(h.id);
            }
          }}
        >
          {d ? (
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ margin: 'auto', display: 'block' }}
              aria-hidden="true"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : sk ? (
            '⏭'
          ) : (
            h.e
          )}
        </button>
        <div
          className="g"
          style={{ cursor: 'pointer' }}
          onClick={(ev) => {
            if (isAutoStudy) {
              ev.stopPropagation();
              onEditHabit(h.id);
            }
          }}
        >
          <b>{h.name}</b>
          <small>
            🔥 {s.cur}
            {u}
            {h.sch === 'week' ? ` · ${wkC(state, h, sel)}/${h.n} wk` : ''}
            {h.tn > 1 ? ` · ${e?.v || 0}/${h.tn} ${h.tu}` : ''}
            {linkedSub ? ` · ${linkedSub.e} ${linkedSub.name}` : ''}
          </small>
        </div>
        {isAutoStudy ? (
          <span
            className="pill"
            style={{
              fontSize: '11px',
              padding: '4px 9px',
              color: 'var(--em)',
              borderColor: 'color-mix(in srgb, var(--em) 40%, var(--bd))',
            }}
            title="Automatically updated from your study timers & sessions"
          >
            Auto from timer
          </span>
        ) : (
          h.tn > 1 && (
            <>
              <button
                type="button"
                className="s"
                aria-label={`Decrease ${h.name}`}
                onClick={(ev) => {
                  ev.stopPropagation();
                  onIncrementHabit(h.id, -1);
                }}
              >
                −
              </button>
              <button
                type="button"
                className="s"
                aria-label={`Increase ${h.name}`}
                onClick={(ev) => {
                  ev.stopPropagation();
                  onIncrementHabit(h.id, 1);
                }}
              >
                +
              </button>
            </>
          )
        )}
        <button
          type="button"
          className="s"
          aria-label={`Skip ${h.name} today`}
          title="Skip day (keeps streak)"
          onClick={(ev) => {
            ev.stopPropagation();
            onSkipHabit(h.id);
          }}
        >
          ⏭
        </button>
      </div>
    );
  };

  return (
    <div>
      <header className="top">
        <div>
          <small>
            {parseKey(sel).toLocaleDateString(undefined, {
              weekday: 'long',
              month: 'short',
              day: 'numeric',
            })}{' '}
            · Reset {pad(state.set.dayResetHour)}:00
          </small>
          <h1>Deep Hours</h1>
        </div>
        <div className="row" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {activeMetrics && (
            <button
              type="button"
              className="pill em-btn"
              onClick={() => onSwitchTab('focus')}
            >
              ⏱️ {fmtMS(activeMetrics.totalActiveMs)}
            </button>
          )}
          {/* 1.9 Minimum-day streak chip */}
          <span
            className="pill mono"
            style={{
              borderColor: minStreakInfo.todayMetMinimum || minStreakInfo.todayIsRestDay
                ? '#10b981'
                : 'var(--bd)',
              color: minStreakInfo.todayMetMinimum || minStreakInfo.todayIsRestDay
                ? '#10b981'
                : 'var(--tx)',
            }}
            title={`Minimum study day streak (≥${minStreakInfo.minDayMinutes}m/day or Rest Pass)`}
          >
            🔥 {minStreakInfo.streak}d min-streak
          </span>
          {consistencyInfo.total !== null && (
            <span
              className="pill mono"
              title="14-day Consistency Score (0-100)"
            >
              ⚡ {consistencyInfo.displayLabel}
            </span>
          )}
          <span className="pill">
            Lv {level} · {totalXp} XP
          </span>
        </div>
      </header>

      {/* D-Day Strip (A15: show "Add your NEET exam date" prompt when empty) */}
      <div className="dday-strip">
        {state.ddays.length === 0 ? (
          <button
            type="button"
            className="dday-card"
            style={
              {
                '--dc': '#10b981',
                textAlign: 'left',
                borderStyle: 'dashed',
              } as React.CSSProperties
            }
            onClick={onNewDDay}
          >
            <span className="dday-badge">NEET</span>
            <div className="g">
              <b style={{ fontSize: '13px' }}>🎯 Add your NEET exam date</b>
              <small style={{ fontSize: '11px' }}>Tap to set your D-Day countdown</small>
            </div>
          </button>
        ) : (
          state.ddays.map((d) => {
            const diff = Math.round(
              (parseKey(d.date).getTime() - parseKey(todayKey).getTime()) / 86400000
            );
            const badge =
              diff === 0 ? 'D-Day' : diff > 0 ? `D-${diff}` : `D+${Math.abs(diff)}`;
            return (
              <button
                type="button"
                key={d.id}
                className="dday-card"
                style={{ '--dc': d.color || '#6366f1', textAlign: 'left' } as React.CSSProperties}
                onClick={() => onEditDDay(d.id)}
                aria-label={`Edit D-Day ${d.title}`}
              >
                <span className="dday-badge">{badge}</span>
                <div className="g">
                  <b style={{ fontSize: '13px' }}>
                    {d.e || '🎯'} {d.title}{d.primary ? ' ★' : ''}
                  </b>
                  <small style={{ fontSize: '11px' }}>{d.date}</small>
                </div>
              </button>
            );
          })
        )}
        <button
          type="button"
          className="pill"
          style={{ borderStyle: 'dashed' }}
          onClick={onNewDDay}
        >
          + D-Day
        </button>
      </div>

      {/* 1.2 Compact Pace Line + 1.9 Rest Day Pass Button */}
      <div
        className="row sp wrap"
        style={{
          padding: '6px 11px',
          marginBottom: '8px',
          borderRadius: '12px',
          background: 'var(--c1)',
          border: '1px solid var(--bd)',
          gap: '8px',
        }}
      >
        <small
          style={{
            fontWeight: 700,
            color:
              paceReport.status === 'behind'
                ? '#fca5a5'
                : paceReport.status === 'ahead' || paceReport.status === 'completed'
                  ? '#6ee7b7'
                  : 'var(--tx)',
          }}
        >
          🧭 {paceReport.compactSummary}
        </small>
        {onToggleRestDay && (
          <button
            type="button"
            className="s"
            style={{
              padding: '3px 9px',
              fontSize: '11px',
              borderColor: (state.restDays || []).includes(sel) ? '#10b981' : 'var(--bd)',
              color: (state.restDays || []).includes(sel) ? '#10b981' : 'var(--mu)',
            }}
            onClick={() => onToggleRestDay(sel)}
            title="Mark as a Rest Day so your minimum-day streak stays protected"
          >
            {(state.restDays || []).includes(sel)
              ? '🛌 Rest Day Active'
              : `🛌 Rest Pass (${minStreakInfo.restPassesRemaining}/${minStreakInfo.restPassesPerMonth} left)`}
          </button>
        )}
      </div>

      {/* 1.12 Gentle Dismissible Burnout Check Card */}
      {burnoutStatus.visible && (
        <div
          className="card"
          style={{
            borderLeft: '4px solid #f59e0b',
            background: 'color-mix(in srgb, #f59e0b 10%, var(--c1))',
            padding: '10px 14px',
          }}
        >
          <div className="row sp" style={{ alignItems: 'flex-start', gap: '8px' }}>
            <div>
              <b style={{ fontSize: '13.5px', color: '#fde68a' }}>
                🌿 Gentle Pace &amp; Wellbeing Check-In
              </b>
              <small style={{ display: 'block', marginTop: '3px', color: 'var(--tx)', lineHeight: 1.4 }}>
                {burnoutStatus.message}
              </small>
              <small style={{ display: 'block', marginTop: '4px', color: 'var(--mu)', fontSize: '11px' }}>
                {burnoutStatus.supportNote}
              </small>
            </div>
            {onDismissBurnout && (
              <button
                type="button"
                className="s"
                style={{ padding: '4px 9px', fontSize: '11px', whiteSpace: 'nowrap' }}
                onClick={onDismissBurnout}
              >
                Dismiss (3d)
              </button>
            )}
          </div>
        </div>
      )}

      {/* 7-Day Week Strip */}
      <div className="wk">
        {[...Array(7)].map((_, i) => {
          const k = addD(todayKey, i - 6);
          const dayPct = Math.round(getDayProgress(state, k).pct * 100);
          return (
            <button
              type="button"
              key={k}
              className={k === sel ? 'on' : ''}
              onClick={() => onSelectDay(k)}
              aria-label={`Select date ${k}`}
            >
              <small>{DN[parseKey(k).getDay()]}</small>
              <b>{parseKey(k).getDate()}</b>
              <i style={{ '--p': dayPct } as React.CSSProperties} />
            </button>
          );
        })}
      </div>

      {/* Hero Ring & Flexible Study Metrics */}
      <div className="card hero-grid">
        <div
          className="ring"
          style={
            {
              '--p': p,
              boxShadow:
                p === 100 && dayProg.total > 0
                  ? '0 0 42px color-mix(in srgb, var(--em) 48%, transparent)'
                  : undefined,
            } as React.CSSProperties
          }
        >
          <svg
            viewBox="0 0 126 126"
            width="126"
            height="126"
            style={{
              position: 'absolute',
              inset: 0,
              transform: 'rotate(-90deg)',
              pointerEvents: 'none',
            }}
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="heroRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="var(--ac)" />
                <stop offset="100%" stopColor="var(--em)" />
              </linearGradient>
            </defs>
            <circle
              cx="63"
              cy="63"
              r="55"
              fill="none"
              stroke="var(--c2)"
              strokeWidth="12"
            />
            <circle
              cx="63"
              cy="63"
              r="55"
              fill="none"
              stroke="url(#heroRingGrad)"
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray={345.6}
              strokeDashoffset={345.6 - (345.6 * p) / 100}
              style={{ transition: 'stroke-dashoffset 0.55s cubic-bezier(0.16, 1, 0.3, 1)' }}
            />
          </svg>
          <i>
            <div>
              {dayProg.total === 0 ? (
                <>
                  <b>
                    {p}
                    <small style={{ fontSize: '14px' }}>%</small>
                  </b>
                  <small style={{ display: 'block', fontSize: '11px' }}>
                    {dayProg.habitsDone}/{dayProg.habitsTotal} habits
                  </small>
                </>
              ) : (
                <>
                  <b style={{ fontSize: '17px', lineHeight: 1.15 }}>
                    {dayProg.done}/{dayProg.total} done
                  </b>
                  <small
                    style={{
                      display: 'block',
                      fontSize: '10px',
                      lineHeight: 1.25,
                      marginTop: '3px',
                    }}
                  >
                    {dayProg.habitsDone}/{dayProg.habitsTotal} habits · {dayProg.tasksDone}/{dayProg.tasksTotal} tasks
                  </small>
                </>
              )}
            </div>
          </i>
        </div>
        <div className="stat-mini">
          <div className="stat-box">
            <small>Studied ({sel === todayKey ? 'Today' : sel.slice(5)})</small>
            <b className="mono" style={{ color: 'var(--em)' }}>
              {fmtHMShort(dayStudyMs)}
            </b>
          </div>
          <div className="stat-box">
            <small>Focus Purity</small>
            <b className="mono">{avgPurity}%</b>
          </div>
          <div className="stat-box">
            <small>Sessions</small>
            <b className="mono">{daySessions.length}</b>
          </div>
          <button
            type="button"
            className="stat-box"
            style={{ cursor: 'pointer', textAlign: 'left' }}
            onClick={() => onOpenManualSession(quickSubjectId, quickChapterId || undefined)}
          >
            <small>+ Log Hours</small>
            <b style={{ color: 'var(--ac)', fontSize: '13px' }}>Manual +</b>
          </button>
        </div>
      </div>

      {/* 1.8 Subject Daily Target-vs-Actual Bars (Compact) & 1.7 Study Next Top 3 */}
      {(subjectTargets.some((r) => r.dailyTargetMins > 0 || r.dailyActualMins > 0) ||
        studyNextTop3.length > 0) && (
        <div className="card" style={{ padding: '12px 14px' }}>
          {subjectTargets.some((r) => r.dailyTargetMins > 0 || r.dailyActualMins > 0) && (
            <div style={{ marginBottom: studyNextTop3.length > 0 ? '12px' : 0 }}>
              <div className="row sp" style={{ marginBottom: '6px' }}>
                <small style={{ fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  🎯 Subject Targets ({sel === todayKey ? 'Today' : sel})
                </small>
                <small className="mono">
                  Min Day: {minStreakInfo.todayStudiedMins}/{minStreakInfo.minDayMinutes}m
                </small>
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(125px, 1fr))',
                  gap: '8px',
                }}
              >
                {subjectTargets.map((row) => (
                  <div
                    key={row.subjectId}
                    style={{
                      background: 'var(--c2)',
                      padding: '6px 9px',
                      borderRadius: '10px',
                      borderLeft: `3px solid ${row.color}`,
                    }}
                  >
                    <div className="row sp" style={{ fontSize: '11.5px' }}>
                      <b>
                        {row.subjectEmoji} {row.subjectName}
                      </b>
                      <span className="mono" style={{ fontSize: '11px' }}>
                        {row.dailyActualMins}m
                        {row.dailyTargetMins > 0 ? `/${row.dailyTargetMins}m` : ''}
                      </span>
                    </div>
                    {row.dailyTargetMins > 0 && (
                      <div className="pbar" style={{ height: '4px', marginTop: '4px' }}>
                        <i style={{ width: `${row.dailyPct}%`, background: row.color }} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {studyNextTop3.length > 0 && (
            <div>
              <div className="row sp" style={{ marginBottom: '6px' }}>
                <small style={{ fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  🧭 Study Next (Top 3 Chapters)
                </small>
                <button
                  type="button"
                  className="s"
                  style={{ padding: '2px 8px', fontSize: '11px' }}
                  onClick={() => onSwitchTab('prep')}
                >
                  Syllabus →
                </button>
              </div>
              <div style={{ display: 'grid', gap: '6px' }}>
                {studyNextTop3.map((item, idx) => (
                  <div
                    key={item.chapter.id}
                    className="row sp"
                    style={{
                      padding: '6px 9px',
                      borderRadius: '10px',
                      background: 'var(--c2)',
                      borderLeft: `3px solid ${item.subjectColor}`,
                      gap: '8px',
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <b style={{ fontSize: '12.5px', display: 'block' }}>
                        {idx + 1}. {item.subjectEmoji} {item.chapter.name}
                      </b>
                      <small style={{ fontSize: '11px', color: 'var(--mu)' }}>
                        {item.reasons.join(' • ')}
                      </small>
                    </div>
                    <button
                      type="button"
                      className="s pri"
                      style={{ padding: '4px 9px', fontSize: '11px', whiteSpace: 'nowrap' }}
                      onClick={() =>
                        onQuickStartSession(
                          item.chapter.subjectId,
                          item.chapter.name,
                          'pomo',
                          item.chapter.id
                        )
                      }
                    >
                      ▶ Focus
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Daily Tasks Card (directly under Ring card and above Revisions Due) */}
      <div className="card" id="dailyTasksCard">
        <div className="row sp" style={{ marginBottom: '8px' }}>
          <div>
            <h3>
              Tasks {dayProg.tasksDone}/{dayProg.tasksTotal}
            </h3>
            <small>
              One-off tasks for {sel === todayKey ? 'today' : sel}
            </small>
          </div>
        </div>

        {!isFutureDay ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const clean = taskTitleDraft.trim().slice(0, 140);
              if (!clean) return;
              const now = Date.now();
              if (
                lastTaskSubmitRef.current.title === clean &&
                now - lastTaskSubmitRef.current.ts < 400
              ) {
                return;
              }
              lastTaskSubmitRef.current = { title: clean, ts: now };
              setTaskTitleDraft('');
              onAddTask(clean, sel, taskSubjectId || undefined);
            }}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto auto',
              gap: '6px',
              alignItems: 'center',
              marginBottom: '10px',
            }}
          >
            <input
              type="text"
              value={taskTitleDraft}
              maxLength={140}
              placeholder={`Add a task for ${sel === todayKey ? 'today' : sel}...`}
              aria-label="New task title"
              onChange={(e) => setTaskTitleDraft(e.target.value)}
              style={{ margin: 0, minHeight: '44px' }}
            />
            <select
              value={taskSubjectId}
              aria-label="Task subject (optional)"
              onChange={(e) => setTaskSubjectId(e.target.value)}
              style={{
                margin: 0,
                width: 'auto',
                maxWidth: '126px',
                minHeight: '44px',
                padding: '0 8px',
                fontSize: '12px',
              }}
            >
              <option value="">No subject</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.e} {s.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="pri"
              aria-label="Add task"
              style={{
                minWidth: '44px',
                minHeight: '44px',
                padding: '0 14px',
                fontWeight: 800,
                fontSize: '18px',
              }}
            >
              +
            </button>
          </form>
        ) : (
          <small className="mu" style={{ display: 'block', marginBottom: '10px' }}>
            Future days only get tasks via &ldquo;Move to tomorrow&rdquo; or &ldquo;Change date&rdquo;.
          </small>
        )}

        {dayTasks.length === 0 ? (
          <small className="mu" style={{ display: 'block' }}>
            No tasks for {sel === todayKey ? 'today' : sel} yet.
          </small>
        ) : (
          <div style={{ display: 'grid', gap: '6px' }}>
            {dayTasks.map((t) => {
              const sub = t.subjectId ? getSubject(state, t.subjectId) : null;
              const isMenuOpen = openMenuTaskId === t.id;
              const isEditing = editingTaskId === t.id;
              const isChangingDate = changingDateTaskId === t.id;

              return (
                <div
                  key={t.id}
                  className="stat-box"
                  style={{
                    padding: '8px 10px',
                    borderLeft: sub ? `3px solid ${sub.color}` : '3px solid var(--ac)',
                  }}
                >
                  <div className="row sp" style={{ gap: '8px', flexWrap: 'nowrap' }}>
                    <button
                      type="button"
                      className={`ck ${t.done ? 'on' : ''}`}
                      aria-pressed={t.done}
                      aria-label={`Mark task "${t.title}" as ${t.done ? 'incomplete' : 'complete'}`}
                      onClick={() => onToggleTask(t.id)}
                      style={{
                        minWidth: '44px',
                        minHeight: '44px',
                        width: '44px',
                        height: '44px',
                        flexShrink: 0,
                      }}
                    >
                      {t.done ? '✓' : ''}
                    </button>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      {isEditing ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            const clean = editingTitleDraft.trim().slice(0, 140);
                            if (!clean) return;
                            onEditTaskTitle(t.id, clean);
                            setEditingTaskId(null);
                            setOpenMenuTaskId(null);
                          }}
                          style={{ display: 'flex', gap: '6px', alignItems: 'center' }}
                        >
                          <input
                            type="text"
                            value={editingTitleDraft}
                            maxLength={140}
                            aria-label="Edit task title"
                            onChange={(e) => setEditingTitleDraft(e.target.value)}
                            style={{ margin: 0, flex: 1, minHeight: '38px' }}
                            autoFocus
                          />
                          <button type="submit" className="s pri">
                            Save
                          </button>
                          <button
                            type="button"
                            className="s"
                            onClick={() => setEditingTaskId(null)}
                          >
                            Cancel
                          </button>
                        </form>
                      ) : (
                        <>
                          <b
                            style={{
                              display: 'block',
                              fontSize: '14px',
                              textDecoration: t.done ? 'line-through' : 'none',
                              opacity: t.done ? 0.6 : 1,
                              wordBreak: 'break-word',
                            }}
                          >
                            {t.title}
                          </b>
                          {sub && (
                            <span
                              className="pill"
                              style={{
                                marginTop: '4px',
                                padding: '1px 7px',
                                fontSize: '10.5px',
                                borderColor: sub.color,
                                color: sub.color,
                              }}
                            >
                              {sub.e} {sub.name}
                            </span>
                          )}
                        </>
                      )}
                    </div>

                    <button
                      type="button"
                      className="ic"
                      aria-label={`Task actions for ${t.title}`}
                      aria-expanded={isMenuOpen}
                      onClick={() => {
                        setOpenMenuTaskId(isMenuOpen ? null : t.id);
                        setEditingTaskId(null);
                        setChangingDateTaskId(null);
                      }}
                      style={{
                        minWidth: '44px',
                        minHeight: '44px',
                        width: '44px',
                        height: '44px',
                        flexShrink: 0,
                      }}
                    >
                      ⋯
                    </button>
                  </div>

                  {isMenuOpen && (
                    <div
                      className="row"
                      style={{
                        marginTop: '8px',
                        paddingTop: '8px',
                        borderTop: '1px solid var(--bd)',
                        gap: '6px',
                      }}
                    >
                      <button
                        type="button"
                        className="s"
                        onClick={() => {
                          setEditingTaskId(t.id);
                          setEditingTitleDraft(t.title);
                          setChangingDateTaskId(null);
                        }}
                      >
                        Edit title
                      </button>
                      <button
                        type="button"
                        className="s"
                        onClick={() => {
                          onChangeTaskDate(t.id, addD(t.dayKey, 1));
                          setOpenMenuTaskId(null);
                        }}
                      >
                        Move to tomorrow
                      </button>
                      <button
                        type="button"
                        className="s"
                        onClick={() => {
                          setChangingDateTaskId(isChangingDate ? null : t.id);
                          setChangingDateDraft(t.dayKey);
                          setEditingTaskId(null);
                        }}
                      >
                        Change date
                      </button>
                      <button
                        type="button"
                        className="s dg"
                        onClick={() => {
                          setOpenMenuTaskId(null);
                          onDeleteTask(t.id);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  )}

                  {isChangingDate && (
                    <div
                      className="row"
                      style={{
                        marginTop: '8px',
                        paddingTop: '8px',
                        borderTop: '1px solid var(--bd)',
                        gap: '6px',
                      }}
                    >
                      <input
                        type="date"
                        value={changingDateDraft}
                        aria-label="New task date"
                        onChange={(e) => setChangingDateDraft(e.target.value)}
                        style={{ margin: 0, width: 'auto', flex: 1, minHeight: '38px' }}
                      />
                      <button
                        type="button"
                        className="s pri"
                        onClick={() => {
                          if (/^\d{4}-\d{2}-\d{2}$/.test(changingDateDraft)) {
                            onChangeTaskDate(t.id, changingDateDraft);
                            setChangingDateTaskId(null);
                            setOpenMenuTaskId(null);
                          }
                        }}
                      >
                        Apply Date
                      </button>
                      <button
                        type="button"
                        className="s"
                        onClick={() => setChangingDateTaskId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {unfinishedEarlier.length > 0 && (
          <div
            style={{
              marginTop: '12px',
              paddingTop: '10px',
              borderTop: '1px solid var(--bd)',
            }}
          >
            <div className="row sp" style={{ gap: '8px' }}>
              <button
                type="button"
                className="s"
                aria-expanded={earlierOpen}
                onClick={() => setEarlierOpen((o) => !o)}
                style={{ fontWeight: 700 }}
              >
                {earlierOpen ? '▾' : '▸'} Unfinished from earlier days ({unfinishedEarlier.length})
              </button>
              <button
                type="button"
                className="s pri"
                onClick={onMoveAllUnfinishedToToday}
              >
                Move all to today
              </button>
            </div>

            {earlierOpen && (
              <div style={{ display: 'grid', gap: '6px', marginTop: '8px' }}>
                {unfinishedEarlier.map((t) => {
                  const sub = t.subjectId ? getSubject(state, t.subjectId) : null;
                  return (
                    <div
                      key={t.id}
                      className="stat-box row sp"
                      style={{
                        padding: '8px 10px',
                        borderLeft: '3px solid var(--wa)',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0, paddingRight: '8px' }}>
                        <b style={{ display: 'block', fontSize: '13px', wordBreak: 'break-word' }}>
                          {t.title}
                        </b>
                        <small className="mu">
                          From {t.dayKey}
                          {sub ? ` · ${sub.e} ${sub.name}` : ''}
                        </small>
                      </div>
                      <button
                        type="button"
                        className="s pri"
                        onClick={() => onMoveTaskToToday(t.id)}
                      >
                        Move to today
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Revisions Due Card (Part B2 Today Integration) */}
      <div className="card" id="revisionsDueCard">
        <div className="row sp" style={{ marginBottom: '6px' }}>
          <div>
            <h3>🔁 Revisions Due ({sel})</h3>
            <small>
              Due on {sel}: <b>{dueFiltered.length}</b> · Overdue: <b>{overdue.length}</b>
            </small>
          </div>
          <button
            type="button"
            className="s"
            onClick={() => onSwitchTab('prep')}
          >
            Syllabus →
          </button>
        </div>

        {overdue.length === 0 && dueFiltered.length === 0 ? (
          <small className="mu">
            No chapter revisions due on {sel} or overdue. Schedule manual revision dates in Prep → Syllabus.
          </small>
        ) : (
          <div style={{ display: 'grid', gap: '8px', marginTop: '6px' }}>
            {overdue.length > 0 && (
              <div>
                <small
                  style={{
                    display: 'block',
                    color: 'var(--dg)',
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    marginBottom: '4px',
                  }}
                >
                  ⚠️ Overdue ({overdue.length})
                </small>
                {overdue.map((item) => (
                  <div
                    key={item.revisionId}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '12px',
                      background: 'color-mix(in srgb, var(--dg) 12%, var(--c2))',
                      border: '1px solid color-mix(in srgb, var(--dg) 35%, var(--bd))',
                      marginBottom: '6px',
                    }}
                  >
                    <div className="row sp" style={{ gap: '8px' }}>
                      <label
                        className="row g"
                        style={{ cursor: 'pointer', gap: '8px' }}
                      >
                        <input
                          type="checkbox"
                          style={{ width: '18px', height: '18px' }}
                          checked={false}
                          onChange={() =>
                            onCompleteRevision(item.chapterId, item.revisionId)
                          }
                        />
                        <i
                          className="dot"
                          style={{ '--sc': item.subject.color } as React.CSSProperties}
                        />
                        <div className="g">
                          <b>
                            {item.subject.e} {item.chapterName}
                          </b>
                          <small style={{ color: '#fca5a5' }}>
                            {item.subject.name} · Scheduled {item.date} ({item.daysLate}d late)
                          </small>
                        </div>
                      </label>
                      <span
                        className="pill mono"
                        style={{
                          padding: '2px 8px',
                          fontSize: '11px',
                          borderColor: item.subject.color,
                        }}
                      >
                        {item.label}
                      </span>
                      <button
                        type="button"
                        className="s"
                        style={{ padding: '4px 8px', fontSize: '11px' }}
                        onClick={() => {
                          setReschedulingRevId((prev) =>
                            prev === item.revisionId ? null : item.revisionId
                          );
                          setRescheduleDateDraft(todayKey);
                        }}
                      >
                        📅 Reschedule
                      </button>
                    </div>
                    {reschedulingRevId === item.revisionId && (
                      <div className="row" style={{ marginTop: '6px', gap: '6px' }}>
                        <input
                          type="date"
                          value={rescheduleDateDraft}
                          aria-label={`New date for ${item.chapterName} ${item.label}`}
                          onChange={(e) => setRescheduleDateDraft(e.target.value)}
                        />
                        <button
                          type="button"
                          className="s pri"
                          onClick={() => {
                            if (rescheduleDateDraft) {
                              onRescheduleRevision(
                                item.chapterId,
                                item.revisionId,
                                rescheduleDateDraft
                              );
                              setReschedulingRevId(null);
                            }
                          }}
                        >
                          Save Date
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {dueFiltered.length > 0 && (
              <div>
                <small
                  style={{
                    display: 'block',
                    color: 'var(--em)',
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    marginBottom: '4px',
                  }}
                >
                  Due on {sel} ({dueFiltered.length})
                </small>
                {dueFiltered.map((item) => (
                  <div
                    key={item.revisionId}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '12px',
                      background: 'var(--c2)',
                      border: '1px solid var(--bd)',
                      marginBottom: '6px',
                    }}
                  >
                    <div className="row sp" style={{ gap: '8px' }}>
                      <label
                        className="row g"
                        style={{ cursor: 'pointer', gap: '8px' }}
                      >
                        <input
                          type="checkbox"
                          style={{ width: '18px', height: '18px' }}
                          checked={false}
                          onChange={() =>
                            onCompleteRevision(item.chapterId, item.revisionId)
                          }
                        />
                        <i
                          className="dot"
                          style={{ '--sc': item.subject.color } as React.CSSProperties}
                        />
                        <div className="g">
                          <b>
                            {item.subject.e} {item.chapterName}
                          </b>
                          <small>
                            {item.subject.name} · Due {item.date}
                          </small>
                        </div>
                      </label>
                      <span
                        className="pill mono"
                        style={{
                          padding: '2px 8px',
                          fontSize: '11px',
                          borderColor: item.subject.color,
                        }}
                      >
                        {item.label}
                      </span>
                      <button
                        type="button"
                        className="s"
                        style={{ padding: '4px 8px', fontSize: '11px' }}
                        onClick={() => {
                          setReschedulingRevId((prev) =>
                            prev === item.revisionId ? null : item.revisionId
                          );
                          setRescheduleDateDraft(addD(sel, 1));
                        }}
                      >
                        📅 Reschedule
                      </button>
                    </div>
                    {reschedulingRevId === item.revisionId && (
                      <div className="row" style={{ marginTop: '6px', gap: '6px' }}>
                        <input
                          type="date"
                          value={rescheduleDateDraft}
                          aria-label={`New date for ${item.chapterName} ${item.label}`}
                          onChange={(e) => setRescheduleDateDraft(e.target.value)}
                        />
                        <button
                          type="button"
                          className="s pri"
                          onClick={() => {
                            if (rescheduleDateDraft) {
                              onRescheduleRevision(
                                item.chapterId,
                                item.revisionId,
                                rescheduleDateDraft
                              );
                              setReschedulingRevId(null);
                            }
                          }}
                        >
                          Save Date
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Daily Focus Tip Card */}
      <div
        className="card"
        style={{
          borderLeft: '4px solid var(--ac)',
          background: 'linear-gradient(135deg, var(--c1) 0%, var(--c2) 100%)',
        }}
      >
        <div className="row sp" style={{ marginBottom: '6px' }}>
          <div className="row" style={{ gap: '8px' }}>
            <span
              className="pill"
              style={{
                padding: '3px 9px',
                fontSize: '11px',
                background: 'color-mix(in srgb, var(--ac) 20%, transparent)',
                color: 'var(--tx)',
                borderColor: 'var(--ac)',
              }}
            >
              💡 Daily Focus Tip · {focusTip.tag}
            </span>
          </div>
          <button
            type="button"
            className="s"
            onClick={() => setTipOffset((prev) => prev + 1)}
            aria-label="Next daily focus tip"
          >
            Next Tip ↻
          </button>
        </div>
        <b style={{ display: 'block', fontSize: '14px', marginBottom: '4px' }}>
          {focusTip.title}
        </b>
        <small style={{ display: 'block', lineHeight: 1.45, fontSize: '12.5px' }}>
          {focusTip.tip}
        </small>
      </div>

      {/* Quick Session Subject Picker + Heading & Timer / Manual Logger Card */}
      <div className="card">
        <div className="row sp" style={{ marginBottom: '8px' }}>
          <div>
            <h3 style={{ marginBottom: '2px' }}>Start or Log Study Session</h3>
            <small>Pick a subject, type a heading &amp; start any timer</small>
          </div>
          <button
            type="button"
            className="s pri"
            onClick={() => onOpenManualSession(quickSubjectId)}
          >
            + Log Hours
          </button>
        </div>

        {/* Subject Picker Chips (A10) */}
        <div className="chips wrap" style={{ marginBottom: '8px', paddingBottom: 0 }}>
          {subjects.map((sub) => (
            <button
              type="button"
              key={sub.id}
              className={`sub-chip ${quickSubjectId === sub.id ? 'active' : ''}`}
              style={{ '--sc': sub.color } as React.CSSProperties}
              onClick={() => {
                setQuickSubjectId(sub.id);
                setQuickChapterId('');
              }}
            >
              <i className="dot" style={{ '--sc': sub.color } as React.CSSProperties} />
              {sub.e} {sub.name}
            </button>
          ))}
        </div>

        {/* 1.1 Optional Chapter Dropdown Filtered by Selected Subject */}
        {quickSubjectChapters.length > 0 && (
          <select
            value={quickChapterId}
            onChange={(e) => setQuickChapterId(e.target.value)}
            aria-label="Link session to syllabus chapter"
            style={{ marginBottom: '8px' }}
          >
            <option value="">📖 Link Chapter (Optional) — General {getSubject(state, quickSubjectId).name}</option>
            {quickSubjectChapters.map((ch) => (
              <option key={ch.id} value={ch.id}>
                {ch.name}
              </option>
            ))}
          </select>
        )}

        <input
          type="text"
          value={quickHeading}
          onChange={(e) => setQuickHeading(e.target.value)}
          placeholder="Session heading (leave blank to use chapter or subject name)"
          style={{ marginBottom: '8px' }}
        />
        <div className="row" style={{ gap: '6px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="s em-btn"
            style={{ flex: 1 }}
            onClick={() => {
              const sub = getSubject(state, quickSubjectId);
              const linkedChap = quickChapterId
                ? state.chapters.find((c) => c.id === quickChapterId)
                : undefined;
              onQuickStartSession(
                sub.id,
                quickHeading.trim() || linkedChap?.name || `${sub.name} Study Session`,
                'pomo',
                quickChapterId || undefined
              );
            }}
          >
            🍅 Start Pomodoro
          </button>
          <button
            type="button"
            className="s"
            style={{ flex: 1, borderColor: 'var(--em)', color: 'var(--em)' }}
            onClick={() => {
              const sub = getSubject(state, quickSubjectId);
              const linkedChap = quickChapterId
                ? state.chapters.find((c) => c.id === quickChapterId)
                : undefined;
              onQuickStartSession(
                sub.id,
                quickHeading.trim() || linkedChap?.name || `${sub.name} Study Session`,
                'stopwatch',
                quickChapterId || undefined
              );
            }}
          >
            ⏱️ Start Stopwatch
          </button>
          <button
            type="button"
            className="s"
            style={{ flex: 1 }}
            onClick={() => {
              const sub = getSubject(state, quickSubjectId);
              const linkedChap = quickChapterId
                ? state.chapters.find((c) => c.id === quickChapterId)
                : undefined;
              onQuickStartSession(
                sub.id,
                quickHeading.trim() || linkedChap?.name || `${sub.name} Study Session`,
                'countdown',
                quickChapterId || undefined
              );
            }}
          >
            ⏳ Countdown
          </button>
        </div>

        {daySessions.length > 0 && (
          <div style={{ marginTop: '12px', borderTop: '1px solid var(--bd)', paddingTop: '10px' }}>
            <div className="row sp" style={{ marginBottom: '6px' }}>
              <small style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Completed Sessions ({daySessions.length})
              </small>
              <button
                type="button"
                className="s"
                style={{ padding: '3px 8px', fontSize: '11px' }}
                onClick={() => onSwitchTab('stats')}
              >
                Full Summary →
              </button>
            </div>
            {daySessions.slice(0, 4).map((s) => {
              const sub = getSubject(state, s.subjectId);
              const heading = getSessionHeading(state, s);
              return (
                <div
                  key={s.id}
                  className="row"
                  style={{
                    padding: '8px 0',
                    borderBottom: '1px solid var(--bd)',
                    alignItems: 'flex-start',
                  }}
                >
                  <span
                    style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      background: sub.color,
                      marginTop: '5px',
                      flexShrink: 0,
                    }}
                  />
                  <div className="g">
                    <div className="row sp">
                      <b style={{ fontSize: '13.5px' }}>
                        {sub.e} {sub.name} · {heading}
                      </b>
                      <span
                        className="mono"
                        style={{ color: 'var(--em)', fontWeight: 700, fontSize: '12.5px' }}
                      >
                        {fmtHMShort(s.activeMs)}
                      </span>
                    </div>
                    <small>
                      {fmtClockTime(s.startTs)} – {fmtClockTime(s.endTs)} · {s.mode.toUpperCase()}
                      {s.overtimeMs ? ` · +${fmtHMShort(s.overtimeMs)} OT` : ''}
                    </small>
                    {s.note && (
                      <small style={{ display: 'block', color: 'var(--tx)', marginTop: '3px' }}>
                        “{s.note}”
                      </small>
                    )}
                  </div>
                  <button
                    type="button"
                    className="s del"
                    style={{ padding: '4px 8px' }}
                    aria-label="Delete session"
                    onClick={() => onDeleteSession(s.id)}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Habits Section */}
      {!state.habits.length ? (
        <div className="card">
          <h3>Starter Habits (Auto-Sync Ready)</h3>
          <small>Tap to add.</small>
          <div className="chips wrap" style={{ marginTop: '8px' }}>
            {STARTERS.map((s, i) => (
              <button
                type="button"
                key={s.name}
                onClick={() => onAddStarter(i)}
              >
                {s.e} {s.name}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="pri"
            style={{ marginTop: '10px' }}
            onClick={onNewHabit}
          >
            + Custom Habit
          </button>
        </div>
      ) : (
        <>
          <div className="row sp" style={{ margin: '12px 0 6px' }}>
            <div className="chips" style={{ paddingBottom: 0 }}>
              {(['All', ...CATS] as const).map((c) => (
                <button
                  type="button"
                  key={c}
                  className={c === cat ? 'on' : ''}
                  onClick={() => onSelectCat(c)}
                >
                  {c}
                </button>
              ))}
            </div>
            <button type="button" className="s pri" onClick={onNewHabit}>
              + Habit
            </button>
          </div>
          {hs.length ? (
            hs.map(renderHabitCard)
          ) : (
            <div className="card mu">No habits scheduled in {cat}.</div>
          )}
        </>
      )}

      {/* Daily Reflection, Mood, Sleep & Energy (1.11) */}
      <div className="card mood">
        <h3>Daily Reflection, Mood &amp; Wellbeing</h3>
        <div className="row">
          {['😞', '😕', '😐', '🙂', '😄'].map((m, i) => (
            <button
              type="button"
              key={m}
              className={currentMood === i + 1 ? 'on' : ''}
              onClick={() => onSetMood(i + 1)}
              style={{ fontSize: '22px', flex: 1 }}
              aria-label={`Mood ${i + 1} of 5`}
            >
              {m}
            </button>
          ))}
        </div>

        {/* 1.11 Compact Sleep Stepper (0-14h, step 0.5) & Energy Chips (1-5) */}
        {onUpdateWellbeing && (
          <div
            className="row sp wrap"
            style={{
              marginTop: '10px',
              padding: '8px 10px',
              borderRadius: '12px',
              background: 'var(--c2)',
              gap: '10px',
            }}
          >
            <div className="row" style={{ gap: '6px', alignItems: 'center' }}>
              <small style={{ fontWeight: 700 }}>😴 Sleep:</small>
              <button
                type="button"
                className="s"
                style={{ padding: '3px 9px' }}
                aria-label="Decrease sleep hours"
                onClick={() => {
                  const cur = state.wellbeing?.[sel]?.sleep ?? 7;
                  onUpdateWellbeing(sel, { sleep: Math.max(0, cur - 0.5) });
                }}
              >
                −
              </button>
              <b className="mono" style={{ fontSize: '13px', minWidth: '42px', textAlign: 'center' }}>
                {state.wellbeing?.[sel]?.sleep !== undefined
                  ? `${state.wellbeing[sel].sleep}h`
                  : '—'}
              </b>
              <button
                type="button"
                className="s"
                style={{ padding: '3px 9px' }}
                aria-label="Increase sleep hours"
                onClick={() => {
                  const cur = state.wellbeing?.[sel]?.sleep ?? 6.5;
                  onUpdateWellbeing(sel, { sleep: Math.min(14, cur + 0.5) });
                }}
              >
                +
              </button>
            </div>

            <div className="row" style={{ gap: '4px', alignItems: 'center' }}>
              <small style={{ fontWeight: 700, marginRight: '2px' }}>⚡ Energy:</small>
              {([1, 2, 3, 4, 5] as const).map((eVal) => {
                const isSelected = state.wellbeing?.[sel]?.energy === eVal;
                return (
                  <button
                    key={eVal}
                    type="button"
                    className={isSelected ? 'on' : 's'}
                    style={{
                      width: '28px',
                      height: '28px',
                      padding: 0,
                      borderRadius: '8px',
                      fontSize: '12px',
                      fontWeight: 800,
                    }}
                    onClick={() => onUpdateWellbeing(sel, { energy: eVal })}
                    aria-label={`Energy ${eVal} of 5`}
                  >
                    {eVal}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <textarea
          id="note"
          rows={2}
          maxLength={500}
          placeholder="Key takeaways, lecture notes, blockers..."
          style={{ marginTop: '8px' }}
          value={state.notes[sel] || ''}
          onChange={(e) => onSetNote(e.target.value)}
        />
      </div>
    </div>
  );
};
