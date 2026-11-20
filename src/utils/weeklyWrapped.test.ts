import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlankState } from './studyLogic';
import {
  buildWeeklyProofPayload,
  computeWeeklyWrapped,
  formatThreeHourWindowLabel,
} from './weeklyWrapped';

function makeLocalTs(dayKey: string, hour: number, minute = 0): number {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(y, m - 1, d, hour, minute, 0, 0).getTime();
}

test('weeklyWrapped: handles empty week gracefully without NaN or broken ratios', () => {
  const st = createBlankState();
  // 2026-11-22 is a Sunday
  const report = computeWeeklyWrapped(st, '2026-11-22');
  assert.equal(report.isSunday, true);
  assert.equal(report.highlightCard, true);
  assert.equal(report.hasSessionsThisWeek, false);
  assert.equal(report.totalMs, 0);
  assert.equal(report.priorTotalMs, 0);
  assert.equal(report.deltaDirection, 'first-week');
  assert.equal(report.avgPurity, null);
  assert.equal(report.peakWindow, null);
  assert.ok(report.dodgedSubject !== null);
  assert.equal(report.dodgedSubject?.studiedMs, 0);
  assert.equal(Number.isNaN(report.totalMs), false);
});

test('weeklyWrapped: calculates 7d vs prior 7d delta, peak 3h window, dodged subject, and weekly ProofCard payload', () => {
  const st = createBlankState();
  const todayKey = '2026-11-20'; // Friday
  const phyId = st.subjects[0].id;
  const chemId = st.subjects[1].id;
  const bioId = st.subjects[2].id;

  // Prior week: 2 hours total
  st.sessions.push({
    id: 's_prev_1',
    subjectId: phyId,
    dayKey: '2026-11-11',
    startTs: makeLocalTs('2026-11-11', 10),
    endTs: makeLocalTs('2026-11-11', 12),
    activeMs: 120 * 60_000,
    pausedMs: 0,
    pauseCount: 0,
    overtimeMs: 0,
    purity: 90,
    mode: 'pomo',
    rating: 4,
    note: '',
    updatedAt: 1,
  });

  // This week: 4h 40m total -> +2h 40m vs last week
  // Peak 3h window: 9 PM - 12 AM (hours 21, 22, 23) with 96% avg purity
  st.sessions.push(
    {
      id: 's_cur_1',
      subjectId: phyId,
      dayKey: '2026-11-18',
      startTs: makeLocalTs('2026-11-18', 21, 15),
      endTs: makeLocalTs('2026-11-18', 22, 45),
      activeMs: 90 * 60_000,
      pausedMs: 0,
      pauseCount: 0,
      overtimeMs: 0,
      purity: 96,
      mode: 'pomo',
      rating: 5,
      note: '',
      updatedAt: 2,
    },
    {
      id: 's_cur_2',
      subjectId: bioId,
      dayKey: '2026-11-19',
      startTs: makeLocalTs('2026-11-19', 22, 0),
      endTs: makeLocalTs('2026-11-19', 23, 50),
      activeMs: 170 * 60_000,
      pausedMs: 0,
      pauseCount: 0,
      overtimeMs: 0,
      purity: 96,
      mode: 'pomo',
      rating: 5,
      note: '',
      updatedAt: 3,
    },
    {
      id: 's_cur_3',
      subjectId: chemId,
      dayKey: '2026-11-20',
      startTs: makeLocalTs('2026-11-20', 9, 0),
      endTs: makeLocalTs('2026-11-20', 9, 20),
      activeMs: 20 * 60_000,
      pausedMs: 0,
      pauseCount: 0,
      overtimeMs: 0,
      purity: 88,
      mode: 'countdown',
      rating: 4,
      note: '',
      updatedAt: 4,
    }
  );

  // Archive remaining subjects beyond the first 3 so we deterministically test which of the 3 is dodged
  st.subjects = st.subjects.map((s, idx) => (idx < 3 ? { ...s, arch: 0 } : { ...s, arch: 1 }));

  const report = computeWeeklyWrapped(st, todayKey);
  assert.equal(report.totalMs, 280 * 60_000);
  assert.equal(report.priorTotalMs, 120 * 60_000);
  assert.equal(report.deltaDirection, 'up');
  assert.equal(report.deltaLabel, '+2h 40m vs last week');
  assert.equal(report.peakWindow?.label, formatThreeHourWindowLabel(21));
  assert.equal(report.peakWindow?.label, '9 PM - 12 AM');
  assert.equal(report.peakWindow?.avgPurity, 96);
  assert.equal(report.dodgedSubject?.subjectId, chemId);
  assert.equal(report.dodgedSubject?.studiedMs, 20 * 60_000);

  const proof = buildWeeklyProofPayload(report, st);
  assert.equal(proof.kind, 'daily');
  assert.equal(proof.totalMs, 280 * 60_000);
  assert.equal(proof.sessionsCount, 3);
  assert.ok(proof.dateLabel.startsWith('Weekly ·'));
  assert.equal(proof.slices.length, 3);
});
