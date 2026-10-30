import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  Chapter,
  DailyTask,
  Doubt,
  MistakeEntry,
  MockTest,
  PYQEntry,
} from '../types';
import {
  addChapterRevisionDate,
  addTombstone,
  applyChapterUpdate,
  computeAvgClockTime,
  computeChapterBreakdown,
  computeConsistencyCalendar,
  computeMockScore,
  computeMocksOverview,
  computeStudySummary,
  createBlankState,
  createDailyTask,
  getChapterPYQStats,
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
  pruneExpiredTombstones,
  restoreDeletedItem,
  shouldFireFiveMinWarning,
  syncStudyHabitsForDays,
  updateChapterRevisionDate,
} from './studyLogic.ts';
import {
  computePaceReport,
  computeStudyNext,
  suggestRevisionDates,
} from './pace.ts';
import {
  checkBurnoutStatus,
  computeConsistencyScore,
  computeMinDayStreak,
  computeWeeklyReview,
  toggleRestDay,
} from './insights.ts';
import {
  SyncBudgetController,
  detectDirtyDocKeys,
  mergeEntityCollectionsLWW,
  mergeStateWithCloudDocs,
  partitionStateToCloudDocs,
  sanitizeForFirestore,
} from './cloudSync.ts';
import {
  computeDayXpBreakdown,
  computeLevelInfo,
  computeTotalXp,
  computeXpByDay,
} from './xp.ts';
import {
  DEFAULT_SHARING_FLAGS,
  type GroupDoc,
  GroupPublishBudgetController,
  buildMyMemberEntry,
  computeCompletedWeekStandings,
  computeMemberMedals,
  computeWeeklyGroupGoalProgress,
  formatGroupCode,
  generateGroupId,
  getActiveStudyingNowMembers,
  hashMemberEntry,
  isValidGroupCode,
  makeCheerId,
  normalizeGroupCode,
  rankMocksBoard,
  rankStreakBoard,
  rankTodayBoard,
  rankWeekBoard,
  rankXpBoard,
  recordWeekStandingInHistory,
  sanitizeRemoteGroupDoc,
  sanitizeRemoteMemberEntry,
  validateNickname,
} from './groups.ts';

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

  it('2. computeStudySummary average start time with sessions at 22:00 and 00:30 equals 22:15/23:15 and never formats xx:60', () => {
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

  it('14. Milestone 3.1: Pace calculation (ahead, behind, on track, past exam, zero chapters, no history)', () => {
    const todayKey = '2026-10-01';
    const state = createBlankState();
    state.set.revisionBufferDays = 30;
    // syllabusEnd = 2026-11-28 minus 30 days = 2026-10-29 -> 28 days (4.0 weeks) left from 2026-10-01
    state.ddays = [
      {
        id: 'dd_neet',
        title: 'NEET UG',
        date: '2026-11-28',
        e: '🎯',
        color: '#10b981',
        primary: true,
      },
    ];

    // Case A: Zero chapters
    const zeroRep = computePaceReport(state, todayKey);
    assert.equal(zeroRep.overall.total, 0);
    assert.equal(zeroRep.overall.remaining, 0);
    assert.equal(zeroRep.overall.status, 'ahead');

    // Case B: No history (remaining chapters > 0, 0 completed in last 28 days) -> behind
    state.chapters = [
      { id: 'c1', subjectId: 'sub_phy', name: 'Ch 1', status: 'notStarted', revisions: [] },
      { id: 'c2', subjectId: 'sub_phy', name: 'Ch 2', status: 'notStarted', revisions: [] },
      { id: 'c3', subjectId: 'sub_phy', name: 'Ch 3', status: 'notStarted', revisions: [] },
      { id: 'c4', subjectId: 'sub_phy', name: 'Ch 4', status: 'notStarted', revisions: [] },
    ];
    const noHistRep = computePaceReport(state, todayKey);
    assert.equal(noHistRep.overall.remaining, 4);
    assert.equal(noHistRep.overall.actualPerWeek, 0);
    assert.equal(noHistRep.overall.requiredPerWeek, 1); // 4 chapters / 4 weeks
    assert.equal(noHistRep.overall.status, 'behind');
    assert.equal(noHistRep.overall.behindByChapters, 4);

    // Case C: On track (4 remaining over 4 weeks = 1/wk required; 4 completed in last 28 days = 1/wk actual -> finishes right on syllabusEnd)
    state.chapters.push(
      { id: 'c5', subjectId: 'sub_phy', name: 'Ch 5', status: 'completed', completedOn: '2026-09-10', revisions: [] },
      { id: 'c6', subjectId: 'sub_phy', name: 'Ch 6', status: 'completed', completedOn: '2026-09-15', revisions: [] },
      { id: 'c7', subjectId: 'sub_phy', name: 'Ch 7', status: 'completed', completedOn: '2026-09-20', revisions: [] },
      { id: 'c8', subjectId: 'sub_phy', name: 'Ch 8', status: 'completed', completedOn: '2026-09-25', revisions: [] }
    );
    const onTrackRep = computePaceReport(state, todayKey);
    assert.equal(onTrackRep.overall.actualPerWeek, 1);
    assert.equal(onTrackRep.overall.requiredPerWeek, 1);
    assert.equal(onTrackRep.overall.status, 'on track');

    // Case D: Ahead (only 2 remaining over 4 weeks, actual pace = 1/wk -> projected finish in 14 days, 14 days before syllabusEnd >= 7)
    state.chapters[0].status = 'completed';
    state.chapters[0].completedOn = '2026-09-28';
    state.chapters[1].status = 'completed';
    state.chapters[1].completedOn = '2026-09-29';
    // Now 6 completed in last 28 days (1.5/wk), 2 remaining -> finishes in ~9 days (19 days before syllabusEnd)
    const aheadRep = computePaceReport(state, todayKey);
    assert.equal(aheadRep.overall.status, 'ahead');
    assert.equal(aheadRep.overall.behindByChapters, 0);

    // Case E: Past exam date
    state.ddays[0].date = '2026-09-15';
    const pastExamRep = computePaceReport(state, todayKey);
    assert.equal(pastExamRep.pastExam, true);
    assert.equal(pastExamRep.overall.status, 'behind');
  });

  it('15. Milestone 3.2: Study-next scoring, reason badges, and top-3 ordering (+ revision date suggestions)', () => {
    const todayKey = '2026-10-30';
    const state = createBlankState();
    state.chapters = [
      {
        id: 'ch_high_conf_done',
        subjectId: 'sub_phy',
        name: 'Units & Measurements',
        status: 'completed',
        completedOn: '2026-10-29',
        confidence: 5,
        revisions: [],
      },
      {
        id: 'ch_urgent',
        subjectId: 'sub_phy',
        name: 'Rotational Motion',
        status: 'inProgress',
        confidence: 1, // low confidence -> (6-1)/5 = 1.0 * 0.4 = 0.4
        revisions: [{ id: 'r1', date: '2026-09-01', done: true, doneOn: '2026-09-01' }], // 59 days ago
      },
      {
        id: 'ch_mistakes',
        subjectId: 'sub_che',
        name: 'Ionic Equilibrium',
        status: 'inProgress',
        confidence: 2,
        revisions: [],
      },
      {
        id: 'ch_untouched',
        subjectId: 'sub_bio',
        name: 'Genetics',
        status: 'notStarted',
        confidence: 3,
        revisions: [],
      },
    ];
    state.mistakes = [
      { id: 'm1', subjectId: 'sub_che', chapterId: 'ch_mistakes', dayKey: '2026-10-20', reason: 'concept', resolved: false, createdAt: 100 },
      { id: 'm2', subjectId: 'sub_che', chapterId: 'ch_mistakes', dayKey: '2026-10-21', reason: 'silly', resolved: false, createdAt: 200 },
      { id: 'm3', subjectId: 'sub_che', chapterId: 'ch_mistakes', dayKey: '2026-10-22', reason: 'time', resolved: false, createdAt: 300 },
      { id: 'm4', subjectId: 'sub_che', chapterId: 'ch_mistakes', dayKey: '2026-10-23', reason: 'forgot', resolved: false, createdAt: 400 },
      { id: 'm5_res', subjectId: 'sub_che', chapterId: 'ch_mistakes', dayKey: '2026-10-23', reason: 'guess', resolved: true, createdAt: 500 },
    ];

    const top3 = computeStudyNext(state, todayKey, 3);
    assert.equal(top3.length, 3);
    // ch_mistakes has confidence 2, 4 open mistakes, never touched, not completed -> highest score
    assert.equal(top3[0].chapterId, 'ch_mistakes');
    assert.ok(top3[0].reasons.includes('low confidence'));
    assert.ok(top3[0].reasons.includes('4 open mistakes'));

    // ch_urgent has confidence 1, 59 days since last touched, not completed -> second highest
    assert.equal(top3[1].chapterId, 'ch_urgent');
    assert.ok(top3[1].reasons.includes('low confidence'));
    assert.ok(top3[1].reasons.includes('not touched in 59 days'));

    // ch_high_conf_done is excluded from top 3
    assert.ok(!top3.some((x) => x.chapterId === 'ch_high_conf_done'));

    // Revision date suggestions (+1, +3, +7, +21)
    const suggested = suggestRevisionDates(
      state.chapters[0],
      '2026-10-30',
      [1, 3, 7, 21]
    );
    assert.deepEqual(suggested, [
      '2026-10-31',
      '2026-11-02',
      '2026-11-06',
      '2026-11-20',
    ]);
  });

  it('16. Milestone 3.3: Minimum-day streak with rest days, monthly pass limits, and incomplete today not breaking streak', () => {
    const todayKey = '2026-10-10';
    const state = createBlankState();
    state.set.targets = {
      dailyMinutes: {},
      weeklyMinutes: {},
      minDayMinutes: 240, // 4 hours
      restPassesPerMonth: 2,
    };

    // Studied >= 240m on Oct 7 and Oct 8, Rest day on Oct 9, Today (Oct 10) has 0m studied so far
    state.sessions = [
      {
        id: 's1',
        subjectId: 'sub_phy',
        heading: 'Phy',
        dayKey: '2026-10-07',
        startTs: 1000,
        endTs: 1000 + 250 * 60000,
        activeMs: 250 * 60000,
        pausedMs: 0,
        pauseCount: 0,
        overtimeMs: 0,
        purity: 100,
        mode: 'pomo',
        rating: 5,
        note: '',
        updatedAt: 2000,
      },
      {
        id: 's2',
        subjectId: 'sub_che',
        heading: 'Che',
        dayKey: '2026-10-08',
        startTs: 3000,
        endTs: 3000 + 240 * 60000,
        activeMs: 240 * 60000,
        pausedMs: 0,
        pauseCount: 0,
        overtimeMs: 0,
        purity: 100,
        mode: 'pomo',
        rating: 5,
        note: '',
        updatedAt: 4000,
      },
    ];
    state.restDays = ['2026-10-09'];

    // Incomplete today (Oct 10) must NOT break the streak of Oct 7, 8, 9 (streak = 3)
    const streakInfo = computeMinDayStreak(state, todayKey);
    assert.equal(streakInfo.todayMet, false);
    assert.equal(streakInfo.streak, 3);
    assert.equal(streakInfo.passesUsedThisMonth, 1);
    assert.equal(streakInfo.passesRemainingThisMonth, 1);

    // Toggling today (Oct 10) as a rest day uses the 2nd pass and increments streak to 4
    const t1 = toggleRestDay(state, todayKey);
    assert.equal(t1.allowed, true);
    const streakAfterRest = computeMinDayStreak(t1.nextState, todayKey);
    assert.equal(streakAfterRest.streak, 4);
    assert.equal(streakAfterRest.passesRemainingThisMonth, 0);

    // Attempting a 3rd rest day in the same month (2026-10) is blocked by restPassesPerMonth: 2
    const t2 = toggleRestDay(t1.nextState, '2026-10-06');
    assert.equal(t2.allowed, false);
  });

  it('17. Milestone 3.4: Consistency score (0-100) and "-" with missing data', () => {
    const todayKey = '2026-10-20';
    const emptyState = createBlankState();
    const emptyScore = computeConsistencyScore(emptyState, todayKey);
    assert.equal(emptyScore.hasData, false);
    assert.equal(emptyScore.totalScore, null);
    assert.equal(emptyScore.displayLabel, '-');

    // Populate 14 days meeting minDayMinutes (240m), starting at exact 08:00 AM every day (0 std dev = 100 regularity),
    // 100% purity, and on-time revisions
    const fullState = createBlankState();
    fullState.set.targets = {
      dailyMinutes: {},
      weeklyMinutes: {},
      minDayMinutes: 240,
      restPassesPerMonth: 4,
    };
    for (let i = 0; i < 14; i++) {
      const dk = `2026-10-${String(7 + i).padStart(2, '0')}`;
      const startTs = new Date(2026, 9, 7 + i, 8, 0, 0).getTime();
      fullState.sessions.push({
        id: `s_${i}`,
        subjectId: 'sub_phy',
        heading: 'Morning Block',
        dayKey: dk,
        startTs,
        endTs: startTs + 240 * 60000,
        activeMs: 240 * 60000,
        pausedMs: 0,
        pauseCount: 0,
        overtimeMs: 0,
        purity: 100,
        mode: 'pomo',
        rating: 5,
        note: '',
        updatedAt: startTs + 1000,
      });
    }
    fullState.chapters = [
      {
        id: 'c_rev',
        subjectId: 'sub_phy',
        name: 'Optics',
        status: 'completed',
        completedOn: '2026-10-01',
        revisions: [
          { id: 'r1', date: '2026-10-10', done: true, doneOn: '2026-10-10' },
          { id: 'r2', date: '2026-10-15', done: true, doneOn: '2026-10-14' },
        ],
      },
    ];

    const score = computeConsistencyScore(fullState, todayKey);
    assert.equal(score.hasData, true);
    assert.equal(score.minDaysScore, 100);
    assert.equal(score.regularityScore, 100);
    assert.equal(score.revisionScore, 100);
    assert.equal(score.purityScore, 100);
    assert.equal(score.totalScore, 100);
    assert.equal(score.displayLabel, '100');
  });

  it('18. Milestone 3.5: Burnout triggers (10+ consecutive days, low energy <= 2, low sleep < 6h, and 3-day dismissal)', () => {
    const todayKey = '2026-10-20';

    // Trigger 1: 10 consecutive days meeting minDayMinutes with no rest day
    const s1 = createBlankState();
    for (let i = 0; i < 10; i++) {
      const dk = `2026-10-${String(11 + i).padStart(2, '0')}`;
      s1.sessions.push({
        id: `b_${i}`,
        subjectId: 'sub_phy',
        heading: 'Heavy day',
        dayKey: dk,
        startTs: 1000,
        endTs: 1000 + 250 * 60000,
        activeMs: 250 * 60000,
        pausedMs: 0,
        pauseCount: 0,
        overtimeMs: 0,
        purity: 100,
        mode: 'pomo',
        rating: 5,
        note: '',
        updatedAt: 2000,
      });
    }
    const b1 = checkBurnoutStatus(s1, todayKey);
    assert.equal(b1.triggered, true);
    assert.equal(b1.consecutiveHardDays, 10);

    // Dismissal hides the card until burnoutDismissedUntil > todayKey
    s1.burnoutDismissedUntil = '2026-10-23';
    assert.equal(checkBurnoutStatus(s1, todayKey).triggered, false);

    // Trigger 2: Last 5 logged energy values average <= 2
    const s2 = createBlankState();
    s2.wellbeing = {
      '2026-10-16': { energy: 2 },
      '2026-10-17': { energy: 2 },
      '2026-10-18': { energy: 1 },
      '2026-10-19': { energy: 2 },
      '2026-10-20': { energy: 2 },
    };
    const b2 = checkBurnoutStatus(s2, todayKey);
    assert.equal(b2.triggered, true);
    assert.ok(b2.avgEnergyLast5 !== null && b2.avgEnergyLast5 <= 2);

    // Trigger 3: Last 5 logged sleep values average < 6h
    const s3 = createBlankState();
    s3.wellbeing = {
      '2026-10-16': { sleep: 5.5 },
      '2026-10-17': { sleep: 5.0 },
      '2026-10-18': { sleep: 6.0 },
      '2026-10-19': { sleep: 5.5 },
      '2026-10-20': { sleep: 5.0 },
    };
    const b3 = checkBurnoutStatus(s3, todayKey);
    assert.equal(b3.triggered, true);
    assert.ok(b3.avgSleepLast5 !== null && b3.avgSleepLast5 < 6);
  });

  it('19. Milestone 3.6: norm() loads an OLD state and an OLD backup JSON with zero data loss and initializes all new coaching fields', () => {
    const oldBackupJson = JSON.stringify({
      v: 5,
      habits: [
        {
          id: 'h_legacy',
          name: 'Morning Revision',
          e: '🌅',
          c: 'Study',
          sch: 'daily',
          days: [0, 1, 2, 3, 4, 5, 6],
          n: 7,
          tn: 1,
          tu: 'times',
          rem: '07:00',
          arch: 0,
          created: '2026-01-01',
        },
      ],
      log: { h_legacy: { '2026-10-01': { v: 1, s: 0 } } },
      notes: { '2026-10-01': 'Old backup note' },
      mood: { '2026-10-01': 4 },
      subjects: [
        { id: 'sub_phy', name: 'Physics', e: '⚡', color: '#38bdf8', dailyGoalMins: 120, arch: 0, todos: [] },
      ],
      sessions: [
        {
          id: 'ses_old',
          subjectId: 'sub_phy',
          heading: 'Kinematics',
          dayKey: '2026-10-01',
          startTs: 1759300000000,
          endTs: 1759303600000,
          activeMs: 3600000,
          pausedMs: 0,
          pauseCount: 0,
          overtimeMs: 0,
          purity: 100,
          mode: 'pomo',
          rating: 5,
          note: 'Legacy session',
          updatedAt: 1759303600000,
        },
      ],
      ddays: [{ id: 'dd_old', title: 'NEET 2027', date: '2027-05-02', e: '🎯', color: '#10b981' }],
    });

    const restored = norm(JSON.parse(oldBackupJson));
    assert.equal(restored.habits.length, 1);
    assert.equal(restored.habits[0].name, 'Morning Revision');
    assert.equal(restored.sessions.length, 1);
    assert.equal(restored.sessions[0].heading, 'Kinematics');
    assert.equal(restored.notes['2026-10-01'], 'Old backup note');
    // Default NEET D-Day automatically marked primary when none had primary flag
    assert.equal(restored.ddays[0].primary, true);
    // All new Milestone 1 & 2 collections initialized cleanly
    assert.deepEqual(restored.mistakes, []);
    assert.deepEqual(restored.doubts, []);
    assert.deepEqual(restored.pyq, []);
    assert.deepEqual(restored.restDays, []);
    assert.deepEqual(restored.wellbeing, {});
    assert.deepEqual(restored.delAt, {});
    assert.equal(restored.set.revisionBufferDays, 30);
    assert.equal(restored.set.fullMockMins, 200);
    assert.deepEqual(restored.set.revisionSuggestDays, [1, 3, 7, 21]);
    assert.equal(restored.set.targets?.minDayMinutes, 240);
    assert.equal(restored.set.targets?.restPassesPerMonth, 4);
  });

  it('20. Milestone 3.7: Merge/conflict rules (LWW by updatedAt), tombstones beating older edits, and 90-day tombstone pruning', () => {
    const now = 1762000000000;
    const localItems = [
      { id: 'item_keep_local', name: 'Newer Local', updatedAt: now - 1000 },
      { id: 'item_keep_remote', name: 'Older Local', updatedAt: now - 5000 },
      { id: 'item_deleted_remotely', name: 'Stale Local Edit', updatedAt: now - 3000 },
    ];
    const remoteItems = [
      { id: 'item_keep_local', name: 'Older Remote', updatedAt: now - 4000 },
      { id: 'item_keep_remote', name: 'Newer Remote', updatedAt: now - 500 },
      { id: 'item_deleted_locally', name: 'Stale Remote Edit', updatedAt: now - 6000 },
    ];
    const delAt: Record<string, number> = {
      // Deleted at now - 2000, which is newer than item_deleted_remotely's updatedAt (now - 3000)
      item_deleted_remotely: now - 2000,
      // Deleted at now - 2000, which is newer than item_deleted_locally's updatedAt (now - 6000)
      item_deleted_locally: now - 2000,
    };

    const merged = mergeEntityCollectionsLWW(localItems, remoteItems, delAt);
    assert.equal(merged.length, 2);
    assert.equal(merged.find((x) => x.id === 'item_keep_local')?.name, 'Newer Local');
    assert.equal(merged.find((x) => x.id === 'item_keep_remote')?.name, 'Newer Remote');
    assert.equal(merged.find((x) => x.id === 'item_deleted_remotely'), undefined);
    assert.equal(merged.find((x) => x.id === 'item_deleted_locally'), undefined);

    // 90-day tombstone pruning
    const ninetyOneDaysAgo = now - 91 * 86400000;
    const pruned = pruneExpiredTombstones(
      {
        old_tomb: ninetyOneDaysAgo,
        recent_tomb: now - 5 * 86400000,
      },
      now
    );
    assert.equal(pruned.old_tomb, undefined);
    assert.equal(pruned.recent_tomb, now - 5 * 86400000);

    // Full partition + mergeStateWithCloudDocs round-trip preserves activeTimer locally and never syncs it
    const state = createBlankState();
    state.activeTimer = {
      status: 'running',
      mode: 'pomo',
      phase: 'work',
      subjectId: 'sub_phy',
      heading: 'Local Active Timer',
      startTs: now - 60000,
      sliceStartTs: now - 60000,
      pauseStartTs: null,
      pausedDurationMs: 0,
      slicePausedMs: 0,
      pauseCount: 0,
      slicePauseCount: 0,
      targetMs: 1500000,
      chimeFired: false,
      fiveMinWarnFired: false,
    };
    const docs = partitionStateToCloudDocs(state, now);
    assert.equal('activeTimer' in (docs.metaDocs.core as Record<string, unknown>), false);
    const roundTrip = mergeStateWithCloudDocs(state, {
      metaDocs: docs.metaDocs,
      monthDocs: docs.monthDocs,
    });
    assert.equal(roundTrip.activeTimer?.heading, 'Local Active Timer');
  });

  it('21. Milestone 3.8: restoreDeletedItem for mistake, doubt, and pyq (plus chapter hours & PYQ stats)', () => {
    let state = createBlankState();
    const m1: MistakeEntry = {
      id: 'mis_1',
      subjectId: 'sub_phy',
      chapterId: 'ch_1',
      dayKey: '2026-10-25',
      reason: 'concept',
      note: 'Sign convention',
      resolved: false,
      createdAt: 1000,
      updatedAt: 1000,
    };
    const d1: Doubt = {
      id: 'dbt_1',
      subjectId: 'sub_che',
      chapterId: 'ch_2',
      text: 'Why does bond angle decrease here?',
      createdAt: 2000,
      resolved: false,
      updatedAt: 2000,
    };
    const p1: PYQEntry = {
      id: 'pyq_1',
      chapterId: 'ch_1',
      dayKey: '2026-10-25',
      attempted: 40,
      correct: 34,
      updatedAt: 3000,
    };

    state.mistakes = [m1];
    state.doubts = [d1];
    state.pyq = [p1];

    // Delete all three with tombstones
    state = addTombstone(state, 'mis_1', 5000);
    state = addTombstone(state, 'dbt_1', 5000);
    state = addTombstone(state, 'pyq_1', 5000);
    state.mistakes = [];
    state.doubts = [];
    state.pyq = [];

    // Restore each one via restoreDeletedItem
    state = restoreDeletedItem(state, { kind: 'mistake', item: m1, index: 0 });
    state = restoreDeletedItem(state, { kind: 'doubt', item: d1, index: 0 });
    state = restoreDeletedItem(state, { kind: 'pyq', item: p1, index: 0 });

    assert.equal(state.mistakes.length, 1);
    assert.equal(state.mistakes[0].id, 'mis_1');
    assert.equal(state.delAt?.mis_1, undefined);

    assert.equal(state.doubts.length, 1);
    assert.equal(state.doubts[0].id, 'dbt_1');
    assert.equal(state.delAt?.dbt_1, undefined);

    assert.equal(state.pyq.length, 1);
    assert.equal(state.pyq[0].id, 'pyq_1');
    assert.equal(state.delAt?.pyq_1, undefined);

    // Verify PYQ stats & chapter hours breakdown
    const pyqStats = getChapterPYQStats(state, 'ch_1');
    assert.equal(pyqStats.attempted, 40);
    assert.equal(pyqStats.correct, 34);
    assert.equal(pyqStats.accuracyPct, 85);

    state.chapters = [
      { id: 'ch_1', subjectId: 'sub_phy', name: 'Ray Optics', status: 'inProgress', revisions: [] },
    ];
    state.sessions = [
      {
        id: 'ses_ch1',
        subjectId: 'sub_phy',
        chapterId: 'ch_1',
        heading: 'Ray Optics',
        dayKey: '2026-10-25',
        startTs: 1000,
        endTs: 3601000,
        activeMs: 3600000,
        pausedMs: 0,
        pauseCount: 0,
        overtimeMs: 0,
        purity: 100,
        mode: 'pomo',
        rating: 5,
        note: '',
        updatedAt: 3601000,
      },
    ];
    const chapBreakdown = computeChapterBreakdown(state);
    assert.equal(chapBreakdown.length, 1);
    assert.equal(chapBreakdown[0].chapterId, 'ch_1');
    assert.equal(chapBreakdown[0].studiedMs, 3600000);

    // Weekly Review computation smoke check
    const review = computeWeeklyReview(state, '2026-10-19', '2026-10-25');
    assert.equal(review.totalStudiedMs, 3600000);
    assert.equal(review.mistakesAdded, 1);
  });

  it('22. Milestone 3.9: SyncBudgetController debounce (60s), coalescing, 5-min minimum interval, 150/day cap, and pause on quota error with fake timers', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
    t.mock.timers.setTime(new Date('2026-10-30T10:00:00Z').getTime());

    let flushCalls = 0;
    const ctrl = new SyncBudgetController(async () => {
      flushCalls += 1;
    });

    // Coalesce multiple rapid edits into a single flush after 60s
    ctrl.markDirty();
    t.mock.timers.tick(20_000);
    ctrl.markDirty();
    t.mock.timers.tick(30_000);
    assert.equal(flushCalls, 0);

    // Advance past 60s from the last markDirty -> triggers 1st flush
    t.mock.timers.tick(31_000);
    await Promise.resolve();
    assert.equal(flushCalls, 1);

    // Marking dirty again 30s later must wait until the 5-minute (300_000ms) minimum interval since lastFlushTs
    ctrl.markDirty();
    t.mock.timers.tick(65_000);
    await Promise.resolve();
    assert.equal(flushCalls, 1); // still throttled by 5m min interval

    t.mock.timers.tick(240_000);
    await Promise.resolve();
    assert.equal(flushCalls, 2);

    // Daily write budget cap at 150 writes/day
    assert.equal(ctrl.canWrite(100), true);
    ctrl.recordWrites(150);
    assert.equal(ctrl.getTodayWrites(), 150);
    assert.equal(ctrl.isPausedForToday(), true);
    assert.equal(ctrl.canWrite(1), false);

    // Advancing to the next UTC day resets the daily write counter and unpauses
    t.mock.timers.tick(24 * 3600 * 1000);
    assert.equal(ctrl.getTodayWrites(), 0);
    assert.equal(ctrl.isPausedForToday(), false);

    // Quota error immediately pauses sync until tomorrow
    ctrl.pauseForQuotaError();
    assert.equal(ctrl.isPausedForToday(), true);

    ctrl.dispose();
  });

  it('23. Firebase Sync Hardening: sanitizeForFirestore strips undefined fields, tombstones advance updatedAt, and detectDirtyDocKeys ignores local timer ticks', () => {
    const now = 1762500000000;
    const state = createBlankState();
    state.sessions.push({
      id: 'ses_undef',
      subjectId: 'sub_phy',
      chapterId: undefined,
      heading: 'Session without chapterId',
      dayKey: '2026-10-30',
      startTs: now - 3600000,
      endTs: now,
      activeMs: 3600000,
      pausedMs: 0,
      pauseCount: 0,
      overtimeMs: 0,
      purity: 100,
      mode: 'pomo',
      rating: 5,
      note: '',
      updatedAt: now,
    });
    state.tasks.push({
      id: 'tsk_undef',
      title: 'Task with undefined doneAt & subjectId',
      dayKey: '2026-10-30',
      done: false,
      createdAt: now,
      doneAt: undefined,
      subjectId: undefined,
      updatedAt: now,
    });
    state.doubts.push({
      id: 'dbt_undef',
      subjectId: 'sub_che',
      chapterId: undefined,
      text: 'Doubt with undefined resolvedAt',
      createdAt: now,
      resolved: false,
      resolvedAt: undefined,
      updatedAt: now,
    });

    const partitioned = partitionStateToCloudDocs(state, now);

    // Ensure no document in partitioned.docs has any `undefined` property value anywhere in its tree
    const hasUndefinedValue = (val: unknown): boolean => {
      if (val === undefined) return true;
      if (!val || typeof val !== 'object') return false;
      if (Array.isArray(val)) return val.some(hasUndefinedValue);
      return Object.values(val as Record<string, unknown>).some(hasUndefinedValue);
    };

    for (const [docKey, docPayload] of Object.entries(partitioned.docs)) {
      assert.equal(
        hasUndefinedValue(docPayload),
        false,
        `Document ${docKey} must not contain undefined values`
      );
      assert.equal(typeof docPayload.updatedAt, 'number');
      assert.ok((docPayload.updatedAt as number) > 0);
    }

    // Verify sanitizeForFirestore normalizes NaN / Infinity and strips undefined
    const cleaned = sanitizeForFirestore({
      a: 1,
      b: undefined,
      c: Number.NaN,
      d: [1, undefined, { nested: undefined, ok: 'yes' }],
    });
    assert.deepEqual(cleaned, {
      a: 1,
      c: 0,
      d: [1, { ok: 'yes' }],
    });

    // Verify deleting an item via addTombstone advances updatedAt on entity & month docs
    const tombTime = now + 50000;
    const afterDelete = addTombstone(
      {
        ...state,
        tasks: [],
        sessions: [],
      },
      'tsk_undef',
      tombTime
    );
    const partitionedAfterDelete = partitionStateToCloudDocs(afterDelete, tombTime);
    assert.equal(partitionedAfterDelete.metaDocs.tasks.updatedAt, tombTime);

    // Verify detectDirtyDocKeys ignores activeTimer-only changes and detects deleted session month
    const timerOnlyNext = {
      ...state,
      activeTimer: {
        status: 'running' as const,
        mode: 'pomo' as const,
        phase: 'work' as const,
        subjectId: 'sub_phy',
        heading: 'Optics',
        startTs: now,
        sliceStartTs: now,
        pauseStartTs: null,
        pausedDurationMs: 0,
        slicePausedMs: 0,
        pauseCount: 0,
        slicePauseCount: 0,
        targetMs: 1500000,
        chimeFired: false,
        fiveMinWarnFired: false,
      },
    };
    assert.deepEqual(detectDirtyDocKeys(state, timerOnlyNext), []);

    const dirtyOnDelete = detectDirtyDocKeys(state, afterDelete);
    assert.ok(dirtyOnDelete.includes('meta/core'));
    assert.ok(dirtyOnDelete.includes('meta/tasks'));
    assert.ok(dirtyOnDelete.includes('months/2026-10'));
  });

  it('24. Milestone 4.1: XP v2 engine — manual vs timer sessions, session/daily caps, focus bonus, min-day & streak bonus, revisions, chapters, mocks, tasks, habits, and level formula', () => {
    const state = createBlankState();
    state.set.targets = {
      dailyMinutes: {},
      weeklyMinutes: {},
      minDayMinutes: 240, // 4 hours
      restPassesPerMonth: 4,
    };

    // Day 1 (2026-10-20):
    // - 1 manual session of 300 mins -> 0 XP
    // - 1 timer session of 400 mins (clamped to 360m) with purity 95% -> 360 study XP + 5 focus XP
    // - 4 more timer sessions of 200m each (total counted study mins capped at 960m/day; focus bonus capped at 4 sessions = 20 XP/day)
    // - Total raw timer mins = 1200 >= 240 -> minDayBonus = +30, streak = 1 day -> streakBonus = +2
    state.sessions.push(
      {
        id: 'ses_manual',
        subjectId: 'sub_phy',
        heading: 'Manual Log',
        dayKey: '2026-10-20',
        startTs: 1000,
        endTs: 1000 + 300 * 60000,
        activeMs: 300 * 60000,
        pausedMs: 0,
        pauseCount: 0,
        overtimeMs: 0,
        purity: 100,
        mode: 'manual',
        source: 'manual',
        rating: 5,
        note: '',
        updatedAt: 2000,
      },
      {
        id: 'ses_long_timer',
        subjectId: 'sub_phy',
        heading: 'Marathon Timer',
        dayKey: '2026-10-20',
        startTs: 3000,
        endTs: 3000 + 400 * 60000,
        activeMs: 400 * 60000, // clamped to 360 per session
        pausedMs: 0,
        pauseCount: 0,
        overtimeMs: 0,
        purity: 95,
        mode: 'pomo',
        source: 'timer',
        rating: 5,
        note: '',
        updatedAt: 4000,
      }
    );
    for (let i = 0; i < 4; i++) {
      state.sessions.push({
        id: `ses_extra_${i}`,
        subjectId: 'sub_che',
        heading: 'Block',
        dayKey: '2026-10-20',
        startTs: 5000 + i * 1000,
        endTs: 5000 + i * 1000 + 200 * 60000,
        activeMs: 200 * 60000,
        pausedMs: 0,
        pauseCount: 0,
        overtimeMs: 0,
        purity: 92,
        mode: 'pomo',
        rating: 5,
        note: '',
        updatedAt: 6000 + i,
      });
    }

    // Add 12 completed tasks on 2026-10-20 -> capped at 10 tasks * 2 = 20 XP
    for (let i = 0; i < 12; i++) {
      state.tasks.push({
        id: `t_${i}`,
        title: `Task ${i}`,
        dayKey: '2026-10-20',
        done: true,
        createdAt: 1000,
        updatedAt: 1000,
      });
    }

    // Add 18 completed habits on 2026-10-20 -> capped at 15 habits * 3 = 45 XP
    for (let i = 0; i < 18; i++) {
      const hid = `h_cap_${i}`;
      state.habits.push(mkHabit({ id: hid, name: `Habit ${i}`, tn: 1 }, '2026-10-01'));
      state.log[hid] = { '2026-10-20': { v: 1, s: 0 } };
    }

    // Add 2 mocks on 2026-10-20 -> capped at 1 mock/day = 25 XP
    state.mocks.push(
      {
        id: 'm1',
        name: 'Mock 1',
        dayKey: '2026-10-20',
        marksPerCorrect: 4,
        marksPerWrong: -1,
        maxMarks: 720,
        subjects: {},
        note: '',
        updatedAt: 1000,
      },
      {
        id: 'm2',
        name: 'Mock 2',
        dayKey: '2026-10-20',
        marksPerCorrect: 4,
        marksPerWrong: -1,
        maxMarks: 720,
        subjects: {},
        note: '',
        updatedAt: 2000,
      }
    );

    // Add 1 completed chapter on 2026-10-20 (+25 XP) with 1 on-time revision (+10 XP) and 1 late revision (+5 XP)
    state.chapters.push({
      id: 'ch_xp',
      subjectId: 'sub_phy',
      name: 'Electrostatics',
      status: 'completed',
      completedOn: '2026-10-20',
      revisions: [
        { id: 'r_ontime', date: '2026-10-20', done: true, doneOn: '2026-10-20' },
        { id: 'r_late', date: '2026-10-18', done: true, doneOn: '2026-10-20' },
      ],
    });

    const d1Breakdown = computeDayXpBreakdown(state, '2026-10-20');
    assert.equal(d1Breakdown.study, 960); // daily cap 960
    assert.equal(d1Breakdown.focusBonus, 20); // max 4 sessions * 5
    assert.equal(d1Breakdown.minDayBonus, 30);
    assert.equal(d1Breakdown.streakBonus, 2); // 1-day streak * 2
    assert.equal(d1Breakdown.revisions, 15); // 10 on-time + 5 late
    assert.equal(d1Breakdown.chapters, 25);
    assert.equal(d1Breakdown.mocks, 25); // capped at 1 mock/day
    assert.equal(d1Breakdown.tasks, 20); // capped at 10 tasks * 2
    assert.equal(d1Breakdown.habits, 45); // capped at 15 habits * 3
    assert.equal(
      d1Breakdown.total,
      960 + 20 + 30 + 2 + 15 + 25 + 25 + 20 + 45
    );

    // Verify streak bonus cap (+20 at 10+ days)
    for (let d = 21; d <= 30; d++) {
      const dk = `2026-10-${String(d).padStart(2, '0')}`;
      state.sessions.push({
        id: `ses_streak_${d}`,
        subjectId: 'sub_phy',
        heading: 'Daily Min',
        dayKey: dk,
        startTs: 1000,
        endTs: 1000 + 240 * 60000,
        activeMs: 240 * 60000,
        pausedMs: 0,
        pauseCount: 0,
        overtimeMs: 0,
        purity: 80,
        mode: 'pomo',
        rating: 5,
        note: '',
        updatedAt: 2000,
      });
    }
    const byDay = computeXpByDay(state);
    // 2026-10-30 is the 11th consecutive day meeting minDayMinutes -> streakBonus capped at 20
    assert.equal(byDay['2026-10-30'].breakdown.streakBonus, 20);

    // Level formula: floor(sqrt(totalXp / 150)) + 1
    assert.equal(computeLevelInfo(0).level, 1);
    assert.equal(computeLevelInfo(149).level, 1);
    assert.equal(computeLevelInfo(150).level, 2);
    assert.equal(computeLevelInfo(600).level, 3);
    const totalXp = computeTotalXp(state, '2026-10-30');
    assert.ok(totalXp > 3000);
  });

  it('25. Milestone 4.2: Group entry builder & defensive reader — 21-day pruning, omitting disabled flags, paused stripping, clamping, and ignoring malformed keys', () => {
    const todayKey = '2026-10-30';
    const state = createBlankState();
    state.profile = { nick: 'DrWalter', emoji: '🩺', examYear: 2027 };

    // Add a timer session inside 21-day window ('2026-10-25'), an old timer session outside 21-day window ('2026-09-15'),
    // and a manual session today ('2026-10-30')
    state.sessions = [
      {
        id: 's_recent',
        subjectId: 'sub_phy',
        heading: 'Recent Timer',
        dayKey: '2026-10-25',
        startTs: 1000,
        endTs: 1000 + 120 * 60000,
        activeMs: 120 * 60000,
        pausedMs: 0,
        pauseCount: 0,
        overtimeMs: 0,
        purity: 100,
        mode: 'pomo',
        source: 'timer',
        rating: 5,
        note: '',
        updatedAt: 2000,
      },
      {
        id: 's_old',
        subjectId: 'sub_phy',
        heading: 'Old Timer',
        dayKey: '2026-09-15',
        startTs: 1000,
        endTs: 1000 + 180 * 60000,
        activeMs: 180 * 60000,
        pausedMs: 0,
        pauseCount: 0,
        overtimeMs: 0,
        purity: 100,
        mode: 'pomo',
        source: 'timer',
        rating: 5,
        note: '',
        updatedAt: 2000,
      },
      {
        id: 's_manual',
        subjectId: 'sub_phy',
        heading: 'Manual Today',
        dayKey: todayKey,
        startTs: 1000,
        endTs: 1000 + 90 * 60000,
        activeMs: 90 * 60000,
        pausedMs: 0,
        pauseCount: 0,
        overtimeMs: 0,
        purity: 100,
        mode: 'manual',
        source: 'manual',
        rating: 5,
        note: '',
        updatedAt: 2000,
      },
    ];

    const fullEntry = buildMyMemberEntry(state, todayKey, {
      joinedAt: 1000,
      sh: { t: true, x: true, s: true, m: false, l: false },
      now: 5000,
    });
    assert.equal(fullEntry.days?.['2026-10-25'], 120);
    // Old day (>21d) and manual session are excluded from group days
    assert.equal(fullEntry.days?.['2026-09-15'], undefined);
    assert.equal(fullEntry.days?.[todayKey], undefined);
    // Disabled flags (m: false, l: false) are omitted
    assert.equal('mocks' in fullEntry, false);
    assert.equal('live' in fullEntry, false);

    // Paused entry strips all stat fields
    const pausedEntry = buildMyMemberEntry(state, todayKey, {
      joinedAt: 1000,
      sh: DEFAULT_SHARING_FLAGS,
      paused: true,
      now: 6000,
    });
    assert.equal(pausedEntry.paused, true);
    assert.equal('days' in pausedEntry, false);
    assert.equal('xpDays' in pausedEntry, false);
    assert.equal('xpTotal' in pausedEntry, false);
    assert.equal('streak' in pausedEntry, false);

    // Defensive remote reader: clamps out-of-range numbers, drops old/invalid dayKeys, truncates nick
    const adversarialRaw = {
      nick: '  SuperLongNicknameOverTwentyChars  ',
      emoji: '🧬',
      joinedAt: 1000,
      updatedAt: 2000,
      sh: { t: true, x: true, s: true, m: true, l: true },
      days: {
        '2026-10-30': 99999, // clamp to 1440
        '2026-10-29': -50, // clamp to 0
        '2026-01-01': 300, // older than 21 days -> ignored
        'not-a-date': 100, // invalid dayKey -> ignored
      },
      xpDays: {
        '2026-10-30': 8000, // clamp to 3000
      },
      xpTotal: 99_999_999, // clamp to 10,000,000
      streak: 9999, // clamp to 3650
      consistency: 250, // clamp to 100
      mocks: [
        { d: '2026-10-28', s: 1500, m: 5000 }, // clamp s to 1000, m to 2000
        { d: '2026-10-29', s: -2000, m: 0 }, // clamp s to -1000, m to 1
        { bad: 'object' }, // ignored
      ],
    };

    const sanitized = sanitizeRemoteMemberEntry(adversarialRaw, todayKey)!;
    assert.ok(sanitized);
    assert.equal(sanitized.nick.length, 20);
    assert.equal(sanitized.days?.['2026-10-30'], 1440);
    assert.equal(sanitized.days?.['2026-10-29'], 0);
    assert.equal(sanitized.days?.['2026-01-01'], undefined);
    assert.equal(sanitized.days?.['not-a-date'], undefined);
    assert.equal(sanitized.xpDays?.['2026-10-30'], 3000);
    assert.equal(sanitized.xpTotal, 10_000_000);
    assert.equal(sanitized.streak, 3650);
    assert.equal(sanitized.consistency, 100);
    assert.equal(sanitized.mocks?.length, 2);
    assert.deepEqual(sanitized.mocks?.[0], { d: '2026-10-28', s: 1000, m: 2000 });
    assert.deepEqual(sanitized.mocks?.[1], { d: '2026-10-29', s: -1000, m: 1 });
  });

  it('26. Milestone 4.3: Leaderboards, tie-breaking, hidden members last, weekly group goal, rank history, and medals', () => {
    const todayKey = '2026-10-30'; // Friday (weekStart = 2026-10-26)
    const groupDoc: GroupDoc = {
      name: 'NEET Toppers',
      emoji: '🩺',
      ownerUid: 'u1',
      createdAt: 1000,
      updatedAt: 2000,
      memberCap: 30,
      mockBoard: true,
      goal: { weeklyMinutes: 600, updatedAt: 1500 },
      members: {
        u1: {
          nick: 'Zara',
          emoji: '🧬',
          joinedAt: 1000,
          updatedAt: 2000,
          sh: { t: true, x: true, s: true, m: true, l: false },
          days: { '2026-10-30': 200, '2026-10-27': 160, '2026-10-20': 300 },
          xpDays: { '2026-10-30': 250, '2026-10-27': 200, '2026-10-20': 350 },
          xpTotal: 1200,
          streak: 8,
          consistency: 85,
          mocks: [
            { d: '2026-10-20', s: 610, m: 720 },
            { d: '2026-10-28', s: 650, m: 720 },
          ],
          weeks: {
            '2026-10-12': { rank: 1, of: 3, minutes: 1200, xp: 1400 },
            '2026-10-19': { rank: 2, of: 3, minutes: 1100, xp: 1300 },
          },
        },
        u2: {
          nick: 'Aarav',
          emoji: '⚡',
          joinedAt: 1000,
          updatedAt: 2000,
          sh: { t: true, x: true, s: true, m: true, l: false },
          // Same today minutes as u1 (200), same today XP (250), but nickname 'Aarav' < 'Zara' -> wins tie-breaker!
          days: { '2026-10-30': 200, '2026-10-27': 100, '2026-10-20': 400 },
          xpDays: { '2026-10-30': 250, '2026-10-27': 100, '2026-10-20': 450 },
          xpTotal: 1500,
          streak: 5,
          consistency: 90,
          mocks: [{ d: '2026-10-29', s: 640, m: 720 }],
        },
        u3_hidden: {
          nick: 'HiddenUser',
          emoji: '🦉',
          joinedAt: 1000,
          updatedAt: 2000,
          sh: { t: false, x: false, s: false, m: false, l: false },
        },
      },
    };

    // Today board: u2 ('Aarav') and u1 ('Zara') tied on 200m and 250 XP -> Aarav ranks #1, Zara #2, u3_hidden last (rank null)
    const todayRows = rankTodayBoard(groupDoc.members, todayKey);
    assert.equal(todayRows[0].uid, 'u2');
    assert.equal(todayRows[0].rank, 1);
    assert.equal(todayRows[1].uid, 'u1');
    assert.equal(todayRows[1].rank, 2);
    assert.equal(todayRows[2].uid, 'u3_hidden');
    assert.equal(todayRows[2].hidden, true);
    assert.equal(todayRows[2].rank, null);

    // Week board: u1 has 200+160=360m, u2 has 200+100=300m -> u1 #1, u2 #2
    const weekRows = rankWeekBoard(groupDoc.members, todayKey);
    assert.equal(weekRows[0].uid, 'u1');
    assert.equal(weekRows[1].uid, 'u2');

    // XP board (weekly vs allTime)
    const xpWeekly = rankXpBoard(groupDoc.members, todayKey, 'weekly');
    assert.equal(xpWeekly[0].uid, 'u1'); // 450 vs 350
    const xpAllTime = rankXpBoard(groupDoc.members, todayKey, 'allTime');
    assert.equal(xpAllTime[0].uid, 'u2'); // 1500 vs 1200

    // Streak board: ranked by consistency (u2=90 vs u1=85)
    const streakRows = rankStreakBoard(groupDoc.members, todayKey);
    assert.equal(streakRows[0].uid, 'u2');
    assert.ok(streakRows[1].subLabel?.includes('🔥')); // u1 has 8d streak >= 7

    // Mocks board: u1 latest=650, u2 latest=640, u3_hidden='not shared'
    const mockRows = rankMocksBoard(groupDoc.members, todayKey, 'latest');
    assert.equal(mockRows[0].uid, 'u1');
    assert.equal(mockRows[2].displayLabel, 'not shared');

    // Weekly group goal progress: u1 (360m) + u2 (300m) = 660m >= 600m goal -> 100% & reached!
    const goalProg = computeWeeklyGroupGoalProgress(groupDoc, todayKey);
    assert.equal(goalProg.combinedMinutes, 660);
    assert.equal(goalProg.pct, 100);
    assert.equal(goalProg.reached, true);

    // Completed week standings for previous week (2026-10-19..2026-10-25): u2 had 400m, u1 had 300m
    const prevStandings = computeCompletedWeekStandings(groupDoc, todayKey)!;
    assert.equal(prevStandings.weekKey, '2026-10-19');
    assert.equal(prevStandings.standings.u2.rank, 1);
    assert.equal(prevStandings.standings.u1.rank, 2);
    assert.equal(prevStandings.standings.u1.of, 2);

    // Medal tally for u1 (1 gold, 1 silver)
    const u1Medals = computeMemberMedals(groupDoc.members.u1);
    assert.deepEqual(u1Medals, { gold: 1, silver: 1, bronze: 0 });

    // History map keeps at most 12 weeks per group
    let hist = {};
    for (let w = 1; w <= 15; w++) {
      const wk = `2026-07-${String(w).padStart(2, '0')}`;
      hist = recordWeekStandingInHistory(hist, 'G1', wk, {
        rank: 1,
        of: 4,
        minutes: 1000,
        xp: 1200,
      });
    }
    assert.equal(Object.keys(hist['G1' as keyof typeof hist]).length, 12);
  });

  it('27. Milestone 4.4: GroupPublishBudgetController — 2m debounce, 5m interval, unchanged hash skip, 60/day write cap, and pause on quota error with fake timers', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
    t.mock.timers.setTime(new Date('2026-10-30T12:00:00Z').getTime());

    const flushedGroups: string[] = [];
    const ctrl = new GroupPublishBudgetController(
      async (gid) => {
        flushedGroups.push(gid);
        ctrl. recordWrite(1);
      },
      { initialOnline: true }
    );

    const state = createBlankState();
    state.profile = { nick: 'MedCoder', emoji: '🩺' };
    const e1 = buildMyMemberEntry(state, '2026-10-30', {
      joinedAt: 1000,
      sh: DEFAULT_SHARING_FLAGS,
      now: Date.now(),
    });

    // Mark dirty -> waits 2 minutes (120_000 ms) before flushing
    ctrl.markGroupDirty('GRP2345678', e1);
    t.mock.timers.tick(60_000);
    assert.equal(flushedGroups.length, 0);

    t.mock.timers.tick(61_000);
    await Promise.resolve();
    assert.equal(flushedGroups.length, 1);
    ctrl.commitEntryHash('GRP2345678', e1);

    // Identical entry hash (only updatedAt differs) -> skipped!
    const e1Same = { ...e1, updatedAt: Date.now() + 5000 };
    assert.equal(hashMemberEntry(e1), hashMemberEntry(e1Same));
    ctrl.markGroupDirty('GRP2345678', e1Same);
    t.mock.timers.tick(300_000);
    await Promise.resolve();
    assert.equal(flushedGroups.length, 1);

    // Changed entry within 5 minutes of last write -> waits until 5-min minimum interval
    const e2 = { ...e1, xpTotal: 500, updatedAt: Date.now() };
    ctrl.commitEntryHash('GRP2345678', e1); // reset lastWriteTs to current mock time
    ctrl.markGroupDirty('GRP2345678', e2);
    t.mock.timers.tick(130_000); // 2m10s elapsed (< 5m)
    await Promise.resolve();
    assert.equal(flushedGroups.length, 1);

    t.mock.timers.tick(180_000); // now > 5m elapsed -> flushes!
    await Promise.resolve();
    assert.equal(flushedGroups.length, 2);

    // 60/day write cap
    ctrl.recordWrite(60);
    assert.equal(ctrl.isPausedForToday(), true);
    assert.equal(ctrl.canWrite(1), false);

    // Next UTC day resets budget
    t.mock.timers.tick(24 * 3600 * 1000);
    assert.equal(ctrl.isPausedForToday(), false);
    assert.equal(ctrl.getWritesToday(), 0);

    // Quota error pauses immediately
    ctrl.pauseForQuotaError();
    assert.equal(ctrl.isPausedForToday(), true);
    ctrl.dispose();
  });

  it('28. Milestone 4.5: Invite codes, nickname validation, cheer deterministic IDs, studying-now expiry, and norm() backward compatibility for profile & groupHistory', () => {
    // 1. Invite code generation & normalization
    const code = generateGroupId();
    assert.equal(code.length, 10);
    assert.equal(isValidGroupCode(code), true);
    const formatted = formatGroupCode(code);
    assert.equal(formatted.length, 11);
    assert.equal(normalizeGroupCode(` ${formatted.toLowerCase()} `), code);

    // 2. Nickname validation
    assert.equal(validateNickname('Dr. Arjun').valid, true);
    assert.equal(validateNickname('A').valid, false); // < 2 chars
    assert.equal(validateNickname('A'.repeat(21)).valid, false); // > 20 chars
    assert.equal(validateNickname('user@gmail.com').valid, false); // contains @
    assert.equal(validateNickname('Arjun9876543').valid, false); // 7+ digits

    // 3. Deterministic cheer ID
    assert.equal(
      makeCheerId('2026-10-30', 'uid_sender', 'uid_receiver'),
      '2026-10-30_uid_sender_uid_receiver'
    );

    // 4. Studying-now active filter (live.until > now AND fetchedAt < 15m ago)
    const now = 1762000000000;
    const gDoc = sanitizeRemoteGroupDoc(
      {
        name: 'Live Squad',
        emoji: '🔥',
        ownerUid: 'u1',
        createdAt: now - 10000,
        updatedAt: now,
        memberCap: 30,
        mockBoard: false,
        members: {
          u1: {
            nick: 'ActiveDoc',
            emoji: '🩺',
            joinedAt: now - 5000,
            updatedAt: now,
            sh: { t: true, x: true, s: true, m: false, l: true },
            live: { since: now - 10 * 60000, until: now + 50 * 60000 },
          },
          u2: {
            nick: 'ExpiredDoc',
            emoji: '🧬',
            joinedAt: now - 5000,
            updatedAt: now,
            sh: { t: true, x: true, s: true, m: false, l: true },
            live: { since: now - 70 * 60000, until: now - 10 * 60000 },
          },
        },
      },
      '2026-10-30'
    )!;
    const activeFresh = getActiveStudyingNowMembers(gDoc, now - 5 * 60000, now);
    assert.equal(activeFresh.length, 1);
    assert.equal(activeFresh[0].uid, 'u1');
    assert.equal(activeFresh[0].elapsedMins, 10);

    // If snapshot was fetched > 15m ago, returns empty
    const activeStale = getActiveStudyingNowMembers(gDoc, now - 16 * 60000, now);
    assert.equal(activeStale.length, 0);

    // 5. norm() backward compatibility for old state without profile or groupHistory
    const oldState = norm({
      set: { avatarEmoji: '🧬' },
      sessions: [],
    });
    assert.deepEqual(oldState.profile, { nick: '', emoji: '🧬' });
    assert.deepEqual(oldState.groupHistory, {});
    assert.deepEqual(oldState.groupsConfig, { consentAccepted: false, joined: [] });
  });
});

