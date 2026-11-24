import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Chapter, DDay, DeadlineTarget, CustomReminder } from '../types';
import {
  buildMonthGridCells,
  buildMonthlyCalendarIndex,
  computeDaysUntilDate,
  computeTargetProgress,
  createCustomReminder,
  createDeadlineTarget,
  formatDeadlineUrgency,
  getUpcomingAlerts,
  normalizeCustomReminders,
  normalizeDeadlineTargets,
  shiftDateKey,
} from './targetsLogic';

describe('targetsLogic — Deadline Target Sprints & Custom Reminders', () => {
  it('computes signed local date differences accurately across month/year/leap boundaries', () => {
    assert.equal(computeDaysUntilDate('2026-11-29', '2026-11-29'), 0);
    assert.equal(computeDaysUntilDate('2026-11-29', '2026-11-26'), 3);
    assert.equal(computeDaysUntilDate('2026-11-24', '2026-11-29'), -5);
    assert.equal(computeDaysUntilDate('2027-01-02', '2026-12-30'), 3);
    assert.equal(computeDaysUntilDate('2028-03-01', '2028-02-28'), 2); // leap year 2028
    assert.equal(shiftDateKey('2026-11-29', -3), '2026-11-26');
    assert.equal(shiftDateKey('2026-12-31', 1), '2027-01-01');
  });

  it('computes checklist progress accurately including empty, partial, and 100% completion', () => {
    const emptyTarget = createDeadlineTarget({
      title: 'Organic Revision',
      startDate: '2026-11-24',
      deadlineDate: '2026-11-30',
      itemTexts: [],
    });
    assert.deepEqual(computeTargetProgress(emptyTarget), {
      doneCount: 0,
      totalCount: 0,
      percent: 0,
      isComplete: false,
    });

    const partialTarget: DeadlineTarget = {
      ...emptyTarget,
      items: [
        { id: '1', text: 'Electrostatics PYQs', done: true, doneAt: 1700000000000 },
        { id: '2', text: 'Capacitors NCERT', done: false },
        { id: '3', text: 'Current Electricity notes', done: true, doneAt: 1700000001000 },
      ],
    };
    assert.deepEqual(computeTargetProgress(partialTarget), {
      doneCount: 2,
      totalCount: 3,
      percent: 67,
      isComplete: false,
    });

    const completeTarget: DeadlineTarget = {
      ...partialTarget,
      items: partialTarget.items.map((item) => ({ ...item, done: true })),
    };
    assert.deepEqual(computeTargetProgress(completeTarget), {
      doneCount: 3,
      totalCount: 3,
      percent: 100,
      isComplete: true,
    });
  });

  it('surfaces lead-alert notices for custom reminders and sorts unified alerts by urgency', () => {
    const target: DeadlineTarget = {
      id: 'tgt_1',
      title: 'Finish Optics',
      startDate: '2026-11-20',
      deadlineDate: '2026-11-28',
      items: [{ id: 'i1', text: 'Ray optics', done: false }],
      createdAt: 1700000000000,
    };
    const reminder: CustomReminder = {
      id: 'rem_fee',
      title: 'NEET registration fee payment',
      date: '2026-11-29',
      time: '14:00',
      leadDays: [7, 3, 1, 0],
      category: 'admin',
      done: false,
      createdAt: 1700000000000,
    };
    const exam: DDay = {
      id: 'ex_1',
      title: 'NEET Mock 05',
      date: '2026-12-01',
      e: '🎯',
      color: '#F43F5E',
    };
    const chapter: Chapter = {
      id: 'ch_1',
      subjectId: 'sub_phy',
      name: 'Rotational Motion',
      status: 'completed',
      revisions: [{ id: 'r1', date: '2026-11-26', done: false }],
    };

    const alerts = getUpcomingAlerts(
      {
        deadlineTargets: [target],
        reminders: [reminder],
        ddays: [exam],
        chapters: [chapter],
      },
      '2026-11-26',
      7
    );

    assert.equal(alerts.length, 4);
    assert.equal(alerts[0].kind, 'revision'); // Today (0d)
    assert.equal(alerts[1].kind, 'target'); // 2d
    assert.equal(alerts[2].kind, 'reminder'); // 3d (exact lead trigger)
    assert.equal(alerts[2].isLeadAlertActive, true);
    assert.match(alerts[2].leadNotice || '', /In 3 days.*NEET registration fee payment/);
    assert.equal(alerts[3].kind, 'exam'); // 5d
  });

  it('indexes target deadlines, reminders, lead-alert days, exams, and revisions into monthly buckets', () => {
    const target = createDeadlineTarget({
      title: 'Complete Physics Modern',
      startDate: '2026-11-20',
      deadlineDate: '2026-11-28',
      itemTexts: ['Dual Nature'],
    });
    const reminder = createCustomReminder({
      title: 'NEET registration fee payment',
      date: '2026-11-29',
      leadDays: [3, 1, 0],
      category: 'admin',
    });
    const ddays: DDay[] = [
      { id: 'd1', title: 'AITS 4', date: '2026-11-29', e: '🎯', color: '#F43F5E' },
    ];
    const chapters: Chapter[] = [
      {
        id: 'c1',
        subjectId: 'sub_bot',
        name: 'Genetics',
        status: 'inProgress',
        revisions: [{ id: 'r2', date: '2026-11-29', done: false }],
      },
    ];

    const index = buildMonthlyCalendarIndex(
      { deadlineTargets: [target], reminders: [reminder], ddays, chapters },
      2026,
      10 // November (0-based)
    );

    assert.equal(index['2026-11-28'].targets.length, 1);
    assert.equal(index['2026-11-29'].reminders.length, 1);
    assert.equal(index['2026-11-29'].exams.length, 1);
    assert.equal(index['2026-11-29'].revisions.length, 1);
    // Lead alert dates for 2026-11-29 with [3, 1, 0] => 2026-11-26 and 2026-11-28
    assert.equal(index['2026-11-26'].leadAlerts.length, 1);
    assert.equal(index['2026-11-26'].leadAlerts[0].leadDaysBefore, 3);
    assert.equal(index['2026-11-28'].leadAlerts.length, 1);
    assert.equal(index['2026-11-28'].leadAlerts[0].leadDaysBefore, 1);

    const grid = buildMonthGridCells(2026, 10);
    assert.equal(grid.length % 7, 0);
    assert.equal(grid.filter((c) => c.inCurrentMonth).length, 30);
  });

  it('sanitizes malformed or adversarial imported targets and reminders defensively', () => {
    const poisonedTargets = [
      {
        id: 'tgt_ok',
        title: 'Clean\u0000 Title\u0007',
        startDate: '2026-11-24',
        deadlineDate: '2026-11-30',
        items: [
          { id: 'i1', text: 'Read\u0000 NCERT', done: true },
          { id: 'i2', text: '   ', done: false },
        ],
        __proto__: { polluted: true },
      },
      {
        id: 'tgt_bad_date',
        title: 'Invalid Date',
        deadlineDate: '2026-02-30',
        items: [],
      },
      null,
    ];

    const targets = normalizeDeadlineTargets(poisonedTargets, '2026-11-24');
    assert.equal(targets.length, 1);
    assert.equal(targets[0].title, 'Clean Title');
    assert.equal(targets[0].items.length, 1);
    assert.equal(targets[0].items[0].text, 'Read NCERT');
    assert.equal(({} as Record<string, unknown>).polluted, undefined);

    const reminders = normalizeCustomReminders([
      {
        id: 'rem_ok',
        title: 'Pay\u0000 Exam Fee',
        date: '2026-11-29',
        time: '25:99', // invalid time should be stripped
        leadDays: [3, 3, -5, 999, 'bad'],
        category: 'hacked',
      },
      {
        id: 'rem_bad',
        title: '',
        date: '2026-11-29',
      },
    ]);

    assert.equal(reminders.length, 1);
    assert.equal(reminders[0].title, 'Pay Exam Fee');
    assert.equal(reminders[0].time, undefined);
    assert.deepEqual(reminders[0].leadDays, [60, 3, 0]);
    assert.equal(reminders[0].category, 'admin');

    assert.equal(formatDeadlineUrgency(-2).tone, 'overdue');
    assert.equal(formatDeadlineUrgency(0).label, 'Due today');
    assert.equal(formatDeadlineUrgency(1).label, 'Due tomorrow');
  });
});
