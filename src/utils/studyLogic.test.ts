import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Chapter, DailyTask, MockTest } from '../types';
import {
  addChapterRevisionDate,
  applyChapterUpdate,
  computeAvgClockTime,
  computeConsistencyCalendar,
  computeMockScore,
  computeMocksOverview,
  computeStudySummary,
  createBlankState,
  createDailyTask,
  getDailyStudyGoalProgress,
  getDayProgress,
  getDueAndOverdueRevisions,
  getSortedChapterRevisions,
  getStudyQuoteForTimer,
  getTimerMetrics,
  logicalKey,
  mkHabit,
  moveUnfinishedTasksToToday,
  norm,
  pct,
  restoreDeletedItem,
  shouldFireFiveMinWarning,
  syncStudyHabitsForDays,
  updateChapterRevisionDate,
} from './studyLogic.ts';

describe('Part C: Deep Hours NEET Study & Habit Logger Unit Tests', () => {
  it('1. logicalKey around midnight and the reset hour (04:00 AM)', () => {
    const resetHour = 4;
    // 2026-10-22 23:59 -> belongs to 2026-10-22
    const ts2359 = new Date(2026, 9, 22, 23, 59, 0).getTime();
    assert.equal(logicalKey(ts2359, resetHour), '2026-10-22');

    // 2026-10-23 00:30 -> before 4 AM reset, belongs to 2026-10-22
    const ts0030 = new Date(2026, 9, 23, 0, 30, 0).getTime();
    assert.equal(logicalKey(ts0030, resetHour), '2026-10-22');

    // 2026-10-23 03:59 -> before 4 AM reset, belongs to 2026-10-22
    const ts0359 = new Date(2026, 9, 23, 3, 59, 59).getTime();
    assert.equal(logicalKey(ts0359, resetHour), '2026-10-22');

    // 2026-10-23 04:00 -> at/after 4 AM reset, belongs to 2026-10-23
    const ts0400 = new Date(2026, 9, 23, 4, 0, 0).getTime();
    assert.equal(logicalKey(ts0400, resetHour), '2026-10-23');
  });

  it('2. computeStudySummary average start time with sessions at 22:00 and 00:30 equals 23:15 and never formats xx:60', () => {
    const resetHour = 4;
    const s2200 = new Date(2026, 9, 21, 22, 0, 0).getTime();
    const s0030 = new Date(2026, 9, 23, 0, 30, 0).getTime();
    assert.equal(computeAvgClockTime([s2200, s0030], resetHour), '23:15');

    // Verify rounding edge case where fractional minutes could round to 60 (e.g. 10:59.6)
    const t1 = new Date(2026, 9, 21, 10, 59, 0).getTime();
    const t2 = new Date(2026, 9, 22, 11, 0, 0).getTime();
    const avgRounding = computeAvgClockTime([t1, t2, t2], resetHour);
    assert.equal(avgRounding, '11:00');
    assert.ok(!avgRounding.endsWith(':60'));

    // Full computeStudySummary integration check
    const state = createBlankState();
    state.sessions = [
      {
        id: 'ses_1',
        subjectId: 'sub_phy',
        heading: 'Electrostatics',
        dayKey: '2026-10-21',
        startTs: s2200,
        endTs: s2200 + 3600000,
        activeMs: 3600000,
        pausedMs: 0,
        pauseCount: 0,
        overtimeMs: 0,
        purity: 100,
        mode: 'pomo',
        rating: 5,
        note: '',
        updatedAt: s2200 + 3600000,
      },
      {
        id: 'ses_2',
        subjectId: 'sub_chem',
        heading: 'Thermodynamics',
        dayKey: '2026-10-22',
        startTs: s0030,
        endTs: s0030 + 5400000,
        activeMs: 5400000,
        pausedMs: 0,
        pauseCount: 0,
        overtimeMs: 0,
        purity: 100,
        mode: 'pomo',
        rating: 5,
        note: '',
        updatedAt: s0030 + 5400000,
      },
    ];
    const summary = computeStudySummary(state, '2026-10-22', s0030 + 6000000);
    assert.equal(summary.avgStartHourLabel, '23:15');
    // Peak 2-hour window must sum 2 consecutive hours
    assert.equal(summary.peakHourWindowLabel, '00:00 – 02:00');
    // avgSessionMs divides completed sessions only ((60m + 90m) / 2 = 75m)
    assert.equal(summary.avgSessionMs, 4500000);
  });

  it('3. Mock score, accuracy %, and attempt rate % calculation', () => {
    const mock: MockTest = {
      id: 'mock_1',
      name: 'NEET Full Syllabus Mock #1',
      dayKey: '2026-10-22',
      marksPerCorrect: 4,
      marksPerWrong: -1,
      maxMarks: 720,
      subjects: {
        sub_phy: { correct: 35, wrong: 10, unattempted: 5 }, // 35*4 - 10 = 130, acc = 35/45 = 78%
        sub_chem: { correct: 40, wrong: 5, unattempted: 5 }, // 40*4 - 5 = 155, acc = 40/45 = 89%
        sub_bot: { correct: 42, wrong: 3, unattempted: 5 }, // 42*4 - 3 = 165, acc = 42/45 = 93%
        sub_zoo: { correct: 43, wrong: 2, unattempted: 5 }, // 43*4 - 2 = 170, acc = 43/45 = 96%
      },
      note: 'Revise AC & Ray Optics',
      updatedAt: 1761123600000,
    };

    const score = computeMockScore(mock);
    // Total correct = 160 (640), total wrong = 20 (-20) => 620
    assert.equal(score.totalScore, 620);
    assert.equal(score.totalCorrect, 160);
    assert.equal(score.totalWrong, 20);
    assert.equal(score.totalUnattempted, 20);
    assert.equal(score.totalAttempted, 180);
    assert.equal(score.totalQuestions, 200);
    // Accuracy = Math.round((160 / 180) * 100) = 89%
    assert.equal(score.accuracyPct, 89);
    // Attempt rate = Math.round((180 / 200) * 100) = 90%
    assert.equal(score.attemptRatePct, 90);

    const state = createBlankState();
    state.mocks = [mock];
    const overview = computeMocksOverview(state);
    assert.equal(overview.bestScore, 620);
    assert.equal(overview.avgLast5Score, 620);
    assert.equal(overview.lowestAccuracySubject?.subjectId, 'sub_phy');
  });

  it('4. Revision due/overdue selection and R1/R2/R3 date ordering', () => {
    const ch1: Chapter = {
      id: 'ch_1',
      subjectId: 'sub_phy',
      name: 'Current Electricity',
      status: 'completed',
      completedOn: '2026-10-15',
      revisions: [
        { id: 'r3', date: '2026-10-25', done: false },
        { id: 'r1', date: '2026-10-18', done: true, doneOn: '2026-10-18' },
        { id: 'r2', date: '2026-10-20', done: false },
      ],
    };
    const sorted = getSortedChapterRevisions(ch1);
    assert.deepEqual(
      sorted.map((r) => ({ id: r.id, label: r.label })),
      [
        { id: 'r1', label: 'R1' },
        { id: 'r2', label: 'R2' },
        { id: 'r3', label: 'R3' },
      ]
    );

    const state = createBlankState();
    state.chapters = [
      ch1,
      {
        id: 'ch_2',
        subjectId: 'sub_bot',
        name: 'Cell: The Unit of Life',
        status: 'inProgress',
        revisions: [{ id: 'r_today', date: '2026-10-22', done: false }],
      },
    ];

    const { dueOnSel, overdue } = getDueAndOverdueRevisions(
      state,
      '2026-10-22',
      '2026-10-22'
    );
    // r1 is done, r3 is on 2026-10-25 (future), so r2 is overdue by 2 days (R2) and r_today is due on sel (R1)
    assert.equal(overdue.length, 1);
    assert.equal(overdue[0].revisionId, 'r2');
    assert.equal(overdue[0].label, 'R2');
    assert.equal(overdue[0].daysLate, 2);

    assert.equal(dueOnSel.length, 1);
    assert.equal(dueOnSel[0].revisionId, 'r_today');
    assert.equal(dueOnSel[0].label, 'R1');
    assert.equal(dueOnSel[0].daysLate, 0);
  });

  it('5. norm() safely loads legacy saved state with no new fields and drops corrupted entries', () => {
    const legacyRaw = {
      habits: [
        {
          id: 'h_old',
          name: 'Study 120 mins',
          e: '📚',
          c: 'Work',
          sch: 'daily',
          days: [0, 1, 2, 3, 4, 5, 6],
          n: 3,
          tn: 120,
          tu: 'min',
          rem: '',
          arch: 0,
          created: '2026-10-01',
          subjectId: 'any',
          autoMins: 90, // mismatched with tn, norm() should sync to 120
        },
        // Corrupted habit (missing name) -> should be dropped per A8
        { id: 'h_bad', name: '' },
      ],
      log: {
        h_old: { '2026-10-21': { v: 120, s: 0 } },
      },
      subjects: [
        {
          id: 'sub_code',
          name: 'Coding & CS',
          e: '💻',
          color: '#6366f1',
          dailyGoalMins: 180,
          arch: 0,
          todos: [],
        },
      ],
      sessions: [
        {
          id: 'ses_valid',
          subjectId: 'sub_code',
          heading: 'Graphs',
          dayKey: '2026-10-21',
          startTs: 1761050000000,
          endTs: 1761053600000,
          activeMs: 3600000,
          pausedMs: 0,
          pauseCount: 0,
          overtimeMs: 0,
          purity: 100,
          mode: 'pomo',
          rating: 5,
          note: 'Good session',
          updatedAt: 1761053600000,
        },
        // Corrupted session (missing startTs / negative activeMs) -> should be dropped per A8
        { id: 'ses_bad', dayKey: 'not-a-date', activeMs: -50 },
      ],
      notes: { '2026-10-21': 'Kept note' },
      mood: { '2026-10-21': 5 },
      bonus: 45,
      ob: 1,
    };

    const normalized = norm(legacyRaw);
    assert.equal(normalized.habits.length, 1);
    assert.equal(normalized.habits[0].id, 'h_old');
    // A11: tn and autoMins synced
    assert.equal(normalized.habits[0].tn, 120);
    assert.equal(normalized.habits[0].autoMins, 120);

    // Existing user's custom subjects preserved
    assert.equal(normalized.subjects.length, 1);
    assert.equal(normalized.subjects[0].id, 'sub_code');

    // Valid session preserved, corrupted session dropped
    assert.equal(normalized.sessions.length, 1);
    assert.equal(normalized.sessions[0].id, 'ses_valid');

    // New collections safely initialized
    assert.deepEqual(normalized.mocks, []);
    assert.deepEqual(normalized.chapters, []);
    assert.equal(normalized.notes['2026-10-21'], 'Kept note');
    assert.equal(normalized.bonus, 45);

    // Multi-day habit sync updates past day when session is edited/deleted
    syncStudyHabitsForDays(normalized, ['2026-10-21'], '2026-10-22');
    assert.equal(normalized.log.h_old['2026-10-21']?.v, 60);
    assert.equal(normalized.set.timerAesthetic, 'neon');
  });

  it('6. computeConsistencyCalendar calculates 90-day habit completion percentages and density levels', () => {
    const state = createBlankState();
    const h1 = mkHabit({ id: 'h1', name: 'Habit 1', tn: 1 }, '2026-07-01');
    const h2 = mkHabit({ id: 'h2', name: 'Habit 2', tn: 1 }, '2026-07-01');
    state.habits = [h1, h2];
    state.log = {
      h1: {
        '2026-10-22': { v: 1, s: 0 },
        '2026-10-21': { v: 1, s: 0 },
      },
      h2: {
        '2026-10-22': { v: 1, s: 0 },
      },
    };
    const cal = computeConsistencyCalendar(state, '2026-10-22', 90);
    assert.equal(cal.days.length, 90);
    assert.equal(cal.perfectDays, 1);
    const todayCell = cal.days[cal.days.length - 1];
    const yesterdayCell = cal.days[cal.days.length - 2];
    assert.equal(todayCell.pct, 100);
    assert.equal(todayCell.densityLevel, 4);
    assert.equal(yesterdayCell.pct, 50);
    assert.equal(yesterdayCell.densityLevel, 2);
  });

  it('7. shouldFireFiveMinWarning, getStudyQuoteForTimer, and getDailyStudyGoalProgress', () => {
    const state = createBlankState();
    const now = 1761120000000;
    // 25-minute Pomodoro with 4m50s remaining (20m10s elapsed)
    state.activeTimer = {
      status: 'running',
      mode: 'pomo',
      phase: 'work',
      subjectId: 'sub_phy',
      heading: 'Optics',
      startTs: now - (20 * 60 + 10) * 1000,
      sliceStartTs: now - (20 * 60 + 10) * 1000,
      pauseStartTs: null,
      pausedDurationMs: 0,
      slicePausedMs: 0,
      pauseCount: 0,
      slicePauseCount: 0,
      targetMs: 25 * 60 * 1000,
      chimeFired: false,
      fiveMinWarnFired: false,
    };
    const m = getTimerMetrics(state, now);
    assert.equal(shouldFireFiveMinWarning(state.activeTimer, m), true);

    // Once fiveMinWarnFired is true, it does not fire again
    state.activeTimer.fiveMinWarnFired = true;
    assert.equal(shouldFireFiveMinWarning(state.activeTimer, m), false);

    // Quotes rotate deterministically by activeMs and manualOffset
    const q1 = getStudyQuoteForTimer(1000, 0, 0);
    const q2 = getStudyQuoteForTimer(1000, 0, 1);
    assert.ok(q1.length > 10);
    assert.notEqual(q1, q2);

    // Daily study progress ring percentage calculation
    const prog = getDailyStudyGoalProgress(state, '2026-10-22', '2026-10-22', now);
    assert.equal(prog.goalMs, 180 * 60000);
    assert.equal(prog.pct, Math.round(((20 * 60 + 10) * 1000) / (180 * 60000) * 100));
  });

  it('8. F2: norm() converts positive marksPerWrong to negative and computeMockScore subtracts penalty accurately', () => {
    const rawWithPositivePenalty = {
      mocks: [
        {
          id: 'm_pos',
          name: 'Allen Major Test',
          dayKey: '2026-10-22',
          marksPerCorrect: 4,
          marksPerWrong: 1, // positive in legacy/mistyped input -> must become -1
          maxMarks: 720,
          subjects: {
            sub_phy: { correct: 30.8, wrong: 5.2, unattempted: -3 },
          },
          note: '',
          updatedAt: 1761123600000,
        },
      ],
    };

    const normalized = norm(rawWithPositivePenalty);
    assert.equal(normalized.mocks.length, 1);
    assert.equal(normalized.mocks[0].marksPerWrong, -1);
    // Clamped to whole numbers >= 0
    assert.equal(normalized.mocks[0].subjects.sub_phy.correct, 30);
    assert.equal(normalized.mocks[0].subjects.sub_phy.wrong, 5);
    assert.equal(normalized.mocks[0].subjects.sub_phy.unattempted, 0);

    // Score math: 30 * 4 + 5 * (-1) = 115
    const score = computeMockScore(normalized.mocks[0], normalized.subjects);
    assert.equal(score.totalScore, 115);

    // Even if computeMockScore receives a positive marksPerWrong directly, it applies -Math.abs
    const directScore = computeMockScore(
      {
        ...normalized.mocks[0],
        marksPerWrong: 2,
      },
      normalized.subjects
    );
    assert.equal(directScore.totalScore, 30 * 4 - 5 * 2);
  });

  it('9. F3: applyChapterUpdate ignores empty completion date, sets/clears on status transitions, and rejects duplicate revision dates', () => {
    const ch: Chapter = {
      id: 'ch_test',
      subjectId: 'sub_phy',
      name: 'Laws of Motion',
      status: 'notStarted',
      revisions: [],
    };

    // Setting status to completed auto-fills completedOn with todayKey when empty
    const completedCh = applyChapterUpdate(ch, { status: 'completed' }, '2026-10-24');
    assert.equal(completedCh.status, 'completed');
    assert.equal(completedCh.completedOn, '2026-10-24');

    // Empty completion date patch is ignored and preserves existing completedOn
    const afterEmptyDate = applyChapterUpdate(
      completedCh,
      { completedOn: '' },
      '2026-10-24'
    );
    assert.equal(afterEmptyDate.completedOn, '2026-10-24');

    // Valid new completion date updates completedOn
    const afterValidDate = applyChapterUpdate(
      afterEmptyDate,
      { completedOn: '2026-10-20' },
      '2026-10-24'
    );
    assert.equal(afterValidDate.completedOn, '2026-10-20');

    // Setting status back to notStarted clears completedOn
    const resetCh = applyChapterUpdate(
      afterValidDate,
      { status: 'notStarted' },
      '2026-10-24'
    );
    assert.equal(resetCh.status, 'notStarted');
    assert.equal(resetCh.completedOn, undefined);

    // Adding revision dates and rejecting duplicates
    const r1 = addChapterRevisionDate(completedCh, '2026-10-28', 'rev_1');
    assert.equal(r1.added, true);
    assert.equal(r1.duplicate, false);
    assert.equal(r1.chapter.revisions.length, 1);

    const dupAdd = addChapterRevisionDate(r1.chapter, '2026-10-28', 'rev_2');
    assert.equal(dupAdd.added, false);
    assert.equal(dupAdd.duplicate, true);
    assert.equal(dupAdd.chapter.revisions.length, 1);

    // Updating a second revision to collide with an existing revision date is rejected
    const r2 = addChapterRevisionDate(r1.chapter, '2026-11-02', 'rev_2');
    assert.equal(r2.added, true);
    const dupUpdate = updateChapterRevisionDate(r2.chapter, 'rev_2', '2026-10-28');
    assert.equal(dupUpdate.updated, false);
    assert.equal(dupUpdate.duplicate, true);
    assert.equal(
      dupUpdate.chapter.revisions.find((r) => r.id === 'rev_2')?.date,
      '2026-11-02'
    );
  });

  it('10. F1: restoreDeletedItem restores only the deleted item at its original index while keeping newer state changes and running timers', () => {
    const state = createBlankState();
    const h0 = mkHabit({ id: 'h_0', name: 'First Habit' }, '2026-10-01');
    const h1 = mkHabit({ id: 'h_1', name: 'Deleted Habit' }, '2026-10-01');
    const h2 = mkHabit({ id: 'h_2', name: 'Third Habit' }, '2026-10-01');
    state.habits = [h0, h1, h2];
    state.log = {
      h_1: { '2026-10-22': { v: 1, s: 0 } },
    };
    state.chapters = [
      { id: 'c_0', subjectId: 'sub_phy', name: 'Units', status: 'completed', completedOn: '2026-10-10', revisions: [] },
      { id: 'c_1', subjectId: 'sub_phy', name: 'Kinematics', status: 'inProgress', revisions: [] },
    ];

    // Simulate deleting h_1 at index 1 and c_0 at index 0
    const afterDelete = {
      ...state,
      habits: [h0, h2],
      log: {},
      del: ['h_1'],
      chapters: [state.chapters[1]],
    };

    // Simulate user starting a timer and adding a note during the undo window
    afterDelete.activeTimer = {
      status: 'running',
      mode: 'pomo',
      phase: 'work',
      subjectId: 'sub_phy',
      heading: 'Live Timer During Undo Window',
      startTs: 1761120000000,
      sliceStartTs: 1761120000000,
      pauseStartTs: null,
      pausedDurationMs: 0,
      slicePausedMs: 0,
      pauseCount: 0,
      slicePauseCount: 0,
      targetMs: 1500000,
      chimeFired: false,
      fiveMinWarnFired: false,
    };
    afterDelete.notes['2026-10-24'] = 'New note written before clicking Undo';

    // Restore h_1 at original index 1
    const restoredHabitState = restoreDeletedItem(afterDelete, {
      kind: 'habit',
      item: h1,
      index: 1,
      logEntries: { '2026-10-22': { v: 1, s: 0 } },
    });

    assert.deepEqual(
      restoredHabitState.habits.map((h) => h.id),
      ['h_0', 'h_1', 'h_2']
    );
    assert.equal(restoredHabitState.log.h_1?.['2026-10-22']?.v, 1);
    assert.equal(restoredHabitState.del.includes('h_1'), false);
    // Newer changes & running timer must remain intact!
    assert.equal(
      restoredHabitState.activeTimer?.heading,
      'Live Timer During Undo Window'
    );
    assert.equal(
      restoredHabitState.notes['2026-10-24'],
      'New note written before clicking Undo'
    );

    // Restore chapter c_0 at original index 0
    const restoredChapterState = restoreDeletedItem(restoredHabitState, {
      kind: 'chapter',
      item: state.chapters[0],
      index: 0,
    });
    assert.deepEqual(
      restoredChapterState.chapters.map((c) => c.id),
      ['c_0', 'c_1']
    );

    // Verify D-Day custom titles survive JSON stringify/parse + norm() (both title and legacy name)
    const rawDDays = JSON.parse(
      JSON.stringify({
        ddays: [
          { id: 'dd_1', title: 'AIIMS Custom Exam 2027', date: '2027-05-03', e: '🎯', color: '#10b981' },
          { id: 'dd_2', name: 'Legacy Named Exam', date: '2027-06-01', e: '🧪', color: '#6366f1' },
        ],
      })
    );
    const normDDays = norm(rawDDays);
    assert.equal(normDDays.ddays.length, 2);
    assert.equal(normDDays.ddays[0].title, 'AIIMS Custom Exam 2027');
    assert.equal(normDDays.ddays[1].title, 'Legacy Named Exam');
  });

  it('11. Daily Tasks: getDayProgress mixes habits and tasks (including 0 totals and tasks on other days) while leaving pct() untouched', () => {
    const state = createBlankState();
    const emptyProg = getDayProgress(state, '2026-10-25');
    assert.deepEqual(emptyProg, {
      habitsDone: 0,
      habitsTotal: 0,
      tasksDone: 0,
      tasksTotal: 0,
      done: 0,
      total: 0,
      pct: 0,
    });

    const h1 = mkHabit({ id: 'h_1', name: 'Revise Bio', tn: 1 }, '2026-10-01');
    const h2 = mkHabit({ id: 'h_2', name: 'Physics PYQ', tn: 1 }, '2026-10-01');
    state.habits = [h1, h2];
    state.log = {
      h_1: { '2026-10-25': { v: 1, s: 0 } },
    };

    const t1: DailyTask = {
      id: 't_1',
      title: 'Solve 30 Organic Chem MCQs',
      dayKey: '2026-10-25',
      done: true,
      createdAt: 1000,
      doneAt: 2000,
      subjectId: 'sub_che',
    };
    const t2: DailyTask = {
      id: 't_2',
      title: 'Read NCERT Plant Kingdom',
      dayKey: '2026-10-25',
      done: false,
      createdAt: 1500,
      subjectId: 'sub_bio',
    };
    const tOtherDay: DailyTask = {
      id: 't_other',
      title: 'Earlier Unfinished Task',
      dayKey: '2026-10-24',
      done: false,
      createdAt: 500,
    };
    state.tasks = [t1, t2, tOtherDay];

    // Existing pct() only measures habits (1/2 = 0.5)
    assert.equal(pct(state, '2026-10-25'), 0.5);

    // getDayProgress combines habits (1/2) and tasks for that dayKey only (1/2) -> 2/4 = 0.5
    const prog = getDayProgress(state, '2026-10-25');
    assert.deepEqual(prog, {
      habitsDone: 1,
      habitsTotal: 2,
      tasksDone: 1,
      tasksTotal: 2,
      done: 2,
      total: 4,
      pct: 0.5,
    });

    // Check day with only tasks (2026-10-24 has 2 habits due, 0 done, 1 task due, 0 done -> 0/3)
    const prevDayProg = getDayProgress(state, '2026-10-24');
    assert.equal(prevDayProg.habitsTotal, 2);
    assert.equal(prevDayProg.tasksTotal, 1);
    assert.equal(prevDayProg.tasksDone, 0);
    assert.equal(prevDayProg.done, 0);
    assert.equal(prevDayProg.total, 3);
    assert.equal(prevDayProg.pct, 0);
  });

  it('12. Daily Tasks: norm() loads an OLD saved state with no tasks field and drops malformed tasks on import', () => {
    const legacyRaw = {
      habits: [],
      log: {},
      sessions: [],
      notes: { '2026-10-25': 'Legacy study note' },
    };
    const loadedFromLegacy = norm(legacyRaw);
    assert.ok(Array.isArray(loadedFromLegacy.tasks));
    assert.equal(loadedFromLegacy.tasks.length, 0);
    assert.equal(loadedFromLegacy.notes['2026-10-25'], 'Legacy study note');

    const longTitle = 'A'.repeat(180);
    const importedWithMalformed = norm({
      tasks: [
        {
          id: 't_valid',
          title: `  ${longTitle}  `,
          dayKey: '2026-10-25',
          done: true,
          createdAt: 1761000000000,
          doneAt: 1761000500000,
          subjectId: 'sub_phy',
        },
        // Malformed: empty id
        { id: '   ', title: 'Valid Title', dayKey: '2026-10-25', done: false, createdAt: 100 },
        // Malformed: non-string id
        { id: 123, title: 'Valid Title', dayKey: '2026-10-25', done: false, createdAt: 100 },
        // Malformed: empty title
        { id: 't_bad_title', title: '   ', dayKey: '2026-10-25', done: false, createdAt: 100 },
        // Malformed: invalid dayKey
        { id: 't_bad_date', title: 'Task with bad date', dayKey: '25-10-2026', done: false, createdAt: 100 },
        null,
      ],
    });

    assert.equal(importedWithMalformed.tasks.length, 1);
    assert.equal(importedWithMalformed.tasks[0].id, 't_valid');
    assert.equal(importedWithMalformed.tasks[0].title.length, 140);
    assert.equal(importedWithMalformed.tasks[0].dayKey, '2026-10-25');
    assert.equal(importedWithMalformed.tasks[0].done, true);
    assert.equal(importedWithMalformed.tasks[0].subjectId, 'sub_phy');
  });

  it('13. Daily Tasks: restoreDeletedItem for a task keeps newer unrelated changes and moveUnfinishedTasksToToday updates dayKey', () => {
    const state = createBlankState();
    const t0 = createDailyTask('Task Zero', '2026-10-23', 'sub_phy', 1000)!;
    const t1 = createDailyTask('Task One (Deleted)', '2026-10-24', 'sub_che', 2000)!;
    const t2 = createDailyTask('Task Two (Completed Earlier)', '2026-10-24', 'sub_bio', 3000)!;
    t2.done = true;
    t2.doneAt = 3500;

    state.tasks = [t0, t1, t2];

    // Delete t1 at index 1
    const afterDelete = {
      ...state,
      tasks: [t0, t2],
    };
    // Make an unrelated change during the undo window
    afterDelete.notes = { ...afterDelete.notes, '2026-10-25': 'Added while undo toast visible' };

    const restored = restoreDeletedItem(afterDelete, {
      kind: 'task',
      item: t1,
      index: 1,
    });

    assert.deepEqual(
      restored.tasks.map((t) => t.id),
      [t0.id, t1.id, t2.id]
    );
    assert.equal(restored.notes['2026-10-25'], 'Added while undo toast visible');

    // Move single unfinished task (t0) to today ('2026-10-25')
    const movedOne = moveUnfinishedTasksToToday(restored, '2026-10-25', t0.id);
    assert.equal(movedOne.tasks.find((t) => t.id === t0.id)?.dayKey, '2026-10-25');
    assert.equal(movedOne.tasks.find((t) => t.id === t1.id)?.dayKey, '2026-10-24');

    // Move all remaining unfinished earlier tasks to today ('2026-10-25')
    const movedAll = moveUnfinishedTasksToToday(movedOne, '2026-10-25');
    assert.equal(movedAll.tasks.find((t) => t.id === t0.id)?.dayKey, '2026-10-25');
    assert.equal(movedAll.tasks.find((t) => t.id === t1.id)?.dayKey, '2026-10-25');
    // Completed earlier task (t2) stays on its original dayKey
    assert.equal(movedAll.tasks.find((t) => t.id === t2.id)?.dayKey, '2026-10-24');
  });
});
