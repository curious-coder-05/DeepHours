import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Chapter, MockTest } from '../types';
import {
  computeAvgClockTime,
  computeConsistencyCalendar,
  computeMockScore,
  computeMocksOverview,
  computeStudySummary,
  createBlankState,
  getDueAndOverdueRevisions,
  getSortedChapterRevisions,
  logicalKey,
  mkHabit,
  norm,
  syncStudyHabitsForDays,
} from './studyLogic';

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
});

