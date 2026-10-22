import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addD,
  computeStudySummary,
  DAILY_FOCUS_TIPS,
  done,
  fmtHMS,
  fmtHMShort,
  fmtMS,
  getDailyFocusTip,
  getTimerMetrics,
  getTodaySubjectMs,
  logicalKey,
  norm,
  streak,
  syncStudyHabitsInPlace,
  xp,
} from './studyLogic';

test('logicalKey respects Night-Owl dayResetHour', () => {
  // 2026-10-22 at 02:30 AM local time with 4 AM reset -> belongs to 2026-10-21
  const earlyMorning = new Date(2026, 9, 22, 2, 30, 0);
  assert.equal(logicalKey(earlyMorning, 4), '2026-10-21');

  // 2026-10-22 at 04:15 AM local time with 4 AM reset -> belongs to 2026-10-22
  const afterReset = new Date(2026, 9, 22, 4, 15, 0);
  assert.equal(logicalKey(afterReset, 4), '2026-10-22');
});

test('time formatters format milliseconds accurately', () => {
  assert.equal(fmtHMS(3661000), '01:01:01');
  assert.equal(fmtMS(600000), '10:00');
  assert.equal(fmtHMShort(5100000), '1h 25m');
  assert.equal(fmtHMShort(2700000), '45m');
});

test('getDailyFocusTip returns deterministic daily tip and cycles with offset', () => {
  assert.ok(DAILY_FOCUS_TIPS.length >= 8);
  const tipA = getDailyFocusTip('2026-10-22', 0);
  const tipA2 = getDailyFocusTip('2026-10-22', 0);
  const tipNext = getDailyFocusTip('2026-10-22', 1);
  assert.equal(tipA.id, tipA2.id);
  assert.notEqual(tipA.id, tipNext.id);
});

test('norm preserves existing schema and initializes missing collections', () => {
  const sample = {
    habits: [
      {
        id: 'h_1',
        name: 'Study 3 hours of Coding',
        e: '💻',
        c: 'Work',
        sch: 'daily',
        days: [0, 1, 2, 3, 4, 5, 6],
        n: 3,
        tn: 180,
        tu: 'min',
        rem: '09:00',
        arch: 0,
        created: '2026-10-01',
        subjectId: 'sub_code',
        autoMins: 180,
      },
    ],
    log: {
      h_1: {
        '2026-10-22': { v: 185, s: 0 },
      },
    },
    bonus: 45,
  };
  const s = norm(sample);
  assert.equal(s.habits.length, 1);
  assert.equal(s.habits[0].subjectId, 'sub_code');
  assert.equal(s.log.h_1['2026-10-22'].v, 185);
  assert.equal(s.bonus, 45);
  assert.ok(s.subjects.length >= 4);
  assert.equal(s.set.dayResetHour, 4);
});

test('getTimerMetrics computes countdown, purity, flow overtime, and stopwatch count-up', () => {
  const s = norm({});
  const startTs = 1761130000000;
  s.activeTimer = {
    status: 'running',
    mode: 'pomo',
    phase: 'work',
    subjectId: 'sub_code',
    heading: 'Distributed Consensus Algorithms',
    startTs,
    sliceStartTs: startTs,
    pauseStartTs: null,
    pausedDurationMs: 300000, // 5 min paused
    slicePausedMs: 300000,
    pauseCount: 1,
    slicePauseCount: 1,
    targetMs: 1500000, // 25 min target
    chimeFired: false,
  };

  // At +20 mins wall clock: 15 mins active, 5 mins paused -> 10 mins remaining, 75% purity
  const m1 = getTimerMetrics(s, startTs + 20 * 60000);
  assert.ok(m1);
  assert.equal(m1.heading, 'Distributed Consensus Algorithms');
  assert.equal(m1.totalActiveMs, 15 * 60000);
  assert.equal(m1.displayMs, 10 * 60000);
  assert.equal(m1.overtimeMs, 0);
  assert.equal(m1.purity, 75);

  // At +35 mins wall clock: 30 mins active, 5 mins paused -> 5 mins overtime!
  const m2 = getTimerMetrics(s, startTs + 35 * 60000);
  assert.ok(m2);
  assert.equal(m2.totalActiveMs, 30 * 60000);
  assert.equal(m2.displayMs, 0);
  assert.equal(m2.overtimeMs, 5 * 60000);
  assert.equal(m2.progressPct, 100);

  // Stopwatch mode counts up from 00:00:00
  s.activeTimer.mode = 'stopwatch';
  s.activeTimer.pausedDurationMs = 0;
  s.activeTimer.slicePausedMs = 0;
  const mSw = getTimerMetrics(s, startTs + 75000); // 1m 15s elapsed
  assert.ok(mSw);
  assert.equal(mSw.mode, 'stopwatch');
  assert.equal(mSw.displayMs, 75000);
  assert.equal(mSw.overtimeMs, 0);
});

test('computeStudySummary calculates weekly, monthly, peak hours, last30Days, and heading breakdown', () => {
  const s = norm(null, new Date(2026, 9, 22, 12, 0, 0));
  const summary = computeStudySummary(s, '2026-10-22', new Date(2026, 9, 22, 12, 0, 0).getTime());
  assert.ok(summary.weekTotalMs > 0);
  assert.ok(summary.monthTotalMs >= summary.weekTotalMs);
  assert.equal(summary.last7Days.length, 7);
  assert.equal(summary.last30Days.length, 30);
  const todayPoint = summary.last30Days[summary.last30Days.length - 1];
  assert.equal(todayPoint.key, '2026-10-22');
  assert.equal(todayPoint.minutes, 85);
  assert.equal(todayPoint.formatted, '1h 25m');
  assert.ok(todayPoint.hours > 1.4);
  assert.ok(summary.peakHourWindowLabel.includes(':00'));
  assert.ok(summary.headingBreakdown.length >= 3);
});

test('syncStudyHabitsInPlace auto-completes study habits', () => {
  const s = norm({
    habits: [
      {
        id: 'h_code',
        name: 'Study 3 hours today',
        e: '💻',
        c: 'Work',
        sch: 'daily',
        days: [0, 1, 2, 3, 4, 5, 6],
        n: 3,
        tn: 180,
        tu: 'min',
        rem: '',
        arch: 0,
        created: '2026-10-20',
        subjectId: 'any',
        autoMins: 180,
      },
    ],
    sessions: [
      {
        id: 'ses_1',
        subjectId: 'sub_code',
        heading: 'Operating Systems Kernel Lab',
        dayKey: '2026-10-22',
        startTs: 1000,
        endTs: 1000 + 185 * 60000,
        activeMs: 185 * 60000,
        pausedMs: 0,
        pauseCount: 0,
        overtimeMs: 0,
        purity: 100,
        mode: 'stopwatch',
        rating: 5,
        note: 'Deep work',
        updatedAt: 2000,
      },
    ],
  });

  const totalMs = getTodaySubjectMs(s, 'any', '2026-10-22', '2026-10-22');
  assert.equal(totalMs, 185 * 60000);

  const changed = syncStudyHabitsInPlace(s, '2026-10-22', '2026-10-22');
  assert.equal(changed, true);
  assert.equal(done(s, s.habits[0], '2026-10-22'), true);
});

test('streak calculation forgives skipped days', () => {
  const s = norm({
    habits: [
      {
        id: 'h_1',
        name: 'Read',
        e: '📖',
        c: 'Learn',
        sch: 'daily',
        days: [0, 1, 2, 3, 4, 5, 6],
        n: 3,
        tn: 1,
        tu: '',
        rem: '',
        arch: 0,
        created: '2026-10-19',
      },
    ],
    log: {
      h_1: {
        '2026-10-19': { v: 1, s: 0 },
        '2026-10-20': { v: 0, s: 1 }, // skipped day
        '2026-10-21': { v: 1, s: 0 },
        '2026-10-22': { v: 1, s: 0 },
      },
    },
  });

  const st = streak(s, s.habits[0], '2026-10-22');
  assert.equal(st.cur, 3);
  assert.equal(st.best, 3);
  assert.ok(xp(s, '2026-10-22') > 0);
  assert.equal(addD('2026-10-22', 1), '2026-10-23');
});
