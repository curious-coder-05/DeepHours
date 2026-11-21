import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { StudySession } from '../types.ts';
import { DEFAULT_SUBJECTS } from './studyLogic.ts';
import {
  angleToSpokeIndex,
  buildChronograph24h,
  buildChronograph30d,
  buildLocalDayKeys,
  buildMonolithSeries,
  computeMonolithScale,
  shadeHexColor,
} from './insightsCanvas.ts';

function makeSession(overrides: Partial<StudySession> & { id: string; dayKey: string }): StudySession {
  const startTs = overrides.startTs ?? new Date(2026, 10, 20, 9, 0, 0).getTime();
  const activeMs = overrides.activeMs ?? 60 * 60000;
  return {
    id: overrides.id,
    subjectId: overrides.subjectId ?? 'sub_phy',
    dayKey: overrides.dayKey,
    startTs,
    endTs: overrides.endTs ?? startTs + activeMs,
    activeMs,
    pausedMs: overrides.pausedMs ?? 0,
    pauseCount: overrides.pauseCount ?? 0,
    overtimeMs: overrides.overtimeMs ?? 0,
    purity: overrides.purity ?? 98,
    mode: overrides.mode ?? 'pomo',
    rating: overrides.rating ?? 4,
    note: overrides.note ?? '',
    updatedAt: overrides.updatedAt ?? startTs,
  };
}

describe('insightsCanvas — Monolith & Chronograph pure helpers', () => {
  it('buildMonolithSeries handles 7d and 14d local-date windows, empty days, goal hits, and subject slices', () => {
    const todayKey = '2026-11-21';
    const sessions: StudySession[] = [
      makeSession({
        id: 'm1',
        dayKey: '2026-11-21',
        subjectId: 'sub_phy',
        activeMs: 240 * 60000, // 4h
        purity: 96,
      }),
      makeSession({
        id: 'm2',
        dayKey: '2026-11-21',
        subjectId: 'sub_bio',
        activeMs: 180 * 60000, // 3h -> 7h total (>= 6h goal)
        purity: 100,
      }),
      makeSession({
        id: 'm3',
        dayKey: '2026-11-19',
        subjectId: 'sub_chem',
        activeMs: 150 * 60000, // 2h 30m (< 6h goal)
        purity: 90,
      }),
    ];

    const series7 = buildMonolithSeries(todayKey, sessions, DEFAULT_SUBJECTS, 7, 360);
    assert.equal(series7.length, 7);
    assert.equal(series7[0].dateKey, '2026-11-15');
    assert.equal(series7[6].dateKey, '2026-11-21');
    assert.equal(series7[6].isToday, true);
    assert.equal(series7[6].totalMin, 420);
    assert.equal(series7[6].hitGoal, true);
    assert.equal(series7[6].goalPct, 117);
    assert.equal(series7[6].sessionCount, 2);
    assert.equal(series7[6].purityPct, 98);
    assert.equal(series7[6].subjectSlices.length, 2);
    assert.equal(series7[6].subjectSlices[0].subjectId, 'sub_phy');
    assert.equal(series7[6].subjectSlices[0].minutes, 240);
    assert.equal(series7[6].subjectSlices[1].subjectId, 'sub_bio');
    assert.equal(series7[6].subjectSlices[1].minutes, 180);

    // Day with 0m stays cleanly zeroed
    assert.equal(series7[5].dateKey, '2026-11-20');
    assert.equal(series7[5].totalMin, 0);
    assert.equal(series7[5].hitGoal, false);
    assert.equal(series7[5].subjectSlices.length, 0);

    // Below-goal active day
    assert.equal(series7[4].dateKey, '2026-11-19');
    assert.equal(series7[4].totalMin, 150);
    assert.equal(series7[4].hitGoal, false);
    assert.equal(series7[4].goalPct, 42);

    // 14d chronological range with explicit local day keys array
    const keys14 = buildLocalDayKeys(todayKey, 14);
    const series14 = buildMonolithSeries(keys14, sessions, DEFAULT_SUBJECTS, 14, 360);
    assert.equal(series14.length, 14);
    assert.equal(series14[0].dateKey, '2026-11-08');
    assert.equal(series14[13].dateKey, '2026-11-21');
  });

  it('computeMonolithScale snaps ceilings to clean round hours >= dailyGoalMin * 1.15', () => {
    // 6h goal, 0m studied -> must be >= 414m (6.9h), snaps cleanly to 8h (480m)
    const empty6h = computeMonolithScale(0, 360);
    assert.ok(empty6h.maxMin >= 360 * 1.15);
    assert.equal(empty6h.maxMin, 480);
    assert.deepEqual(empty6h.tickLabels, ['0h', '2h', '4h', '6h', '8h']);

    // 6h goal, 8h studied -> 480 * 1.06 = 508.8 -> snaps to 9h (540m) with 0h, 3h, 6h, 9h
    const high8h = computeMonolithScale(480, 360);
    assert.equal(high8h.maxMin, 540);
    assert.deepEqual(high8h.ticks, [0, 180, 360, 540]);
    assert.deepEqual(high8h.tickLabels, ['0h', '3h', '6h', '9h']);

    // 4h goal (240m), 2h studied -> 240 * 1.15 = 276 -> snaps to 6h (360m)
    const goal4h = computeMonolithScale(120, 240);
    assert.equal(goal4h.maxMin, 360);
    assert.deepEqual(goal4h.tickLabels, ['0h', '2h', '4h', '6h']);

    // 10h studied (600m) -> snaps to 12h (720m)
    const marathon = computeMonolithScale(600, 360);
    assert.equal(marathon.maxMin, 720);
    assert.deepEqual(marathon.tickLabels, ['0h', '4h', '8h', '12h']);
  });

  it('buildChronograph30d orders latest day at spoke 0 and computes cadence, goal hits, streak, and purity', () => {
    const todayKey = '2026-11-21';
    const sessions: StudySession[] = [
      makeSession({ id: 'c1', dayKey: '2026-11-21', activeMs: 420 * 60000, purity: 98 }), // today: hit goal
      makeSession({ id: 'c2', dayKey: '2026-11-20', activeMs: 360 * 60000, purity: 94 }), // -1d: hit goal
      makeSession({ id: 'c3', dayKey: '2026-11-19', activeMs: 120 * 60000, purity: 90 }), // -2d: active
      // gap on 2026-11-18
      makeSession({ id: 'c4', dayKey: '2026-11-10', activeMs: 400 * 60000, purity: 100 }), // -11d: hit goal
    ];

    const chrono = buildChronograph30d(todayKey, sessions, DEFAULT_SUBJECTS, 360);
    assert.equal(chrono.spokes.length, 30);
    assert.equal(chrono.spokes[0].dateKey, '2026-11-21');
    assert.equal(chrono.spokes[0].daysAgo, 0);
    assert.equal(chrono.spokes[0].hitGoal, true);
    assert.equal(chrono.spokes[1].dateKey, '2026-11-20');
    assert.equal(chrono.spokes[29].dateKey, '2026-10-23');

    assert.equal(chrono.activeDays30, 4);
    assert.equal(chrono.goalHitCount30, 3);
    assert.equal(chrono.goalHitRatePct, 10);
    assert.equal(chrono.totalMin30, 1300);
    assert.equal(chrono.avgMinPerDay30, Math.round(1300 / 30));
    assert.equal(chrono.currentStreak, 3);
    assert.equal(chrono.streakStartIndex, 0);
    assert.ok(chrono.avgPurity30 >= 95 && chrono.avgPurity30 <= 98);
  });

  it('buildChronograph24h buckets across local hours and detects midnight wrap-around peak 23:00-01:00', () => {
    // Late-night session crossing midnight: 23:00 to 01:00 (2 hours = 60m in hour 23 + 60m in hour 0)
    const lateStart = new Date(2026, 10, 20, 23, 0, 0).getTime();
    const lateEnd = new Date(2026, 10, 21, 1, 0, 0).getTime();
    const lateStart2 = new Date(2026, 10, 19, 23, 15, 0).getTime();
    const lateEnd2 = new Date(2026, 10, 20, 0, 45, 0).getTime();

    const sessions: StudySession[] = [
      makeSession({
        id: 'n1',
        dayKey: '2026-11-20',
        startTs: lateStart,
        endTs: lateEnd,
        activeMs: 120 * 60000,
      }),
      makeSession({
        id: 'n2',
        dayKey: '2026-11-19',
        startTs: lateStart2,
        endTs: lateEnd2,
        activeMs: 90 * 60000,
      }),
      makeSession({
        id: 'n3',
        dayKey: '2026-11-18',
        startTs: new Date(2026, 10, 18, 10, 0, 0).getTime(),
        endTs: new Date(2026, 10, 18, 10, 30, 0).getTime(),
        activeMs: 30 * 60000,
      }),
    ];

    const clock = buildChronograph24h(sessions);
    assert.equal(clock.slots.length, 24);
    assert.equal(clock.slots[23].minutes, 105); // 60 + 45
    assert.equal(clock.slots[0].minutes, 105); // 60 + 45
    assert.equal(clock.slots[10].minutes, 30);
    assert.equal(clock.peakWindowStart, 23);
    assert.equal(clock.peakWindowLabel, '23:00–01:00');
    assert.equal(clock.peakLabel, 'Late-Night');
    assert.equal(clock.slots[23].inPeakWindow, true);
    assert.equal(clock.slots[0].inPeakWindow, true);
    assert.equal(clock.slots[10].inPeakWindow, false);
    assert.equal(clock.slots[23].sharePct, Math.round((105 / 240) * 100));

    // Empty sessions fallback
    const empty = buildChronograph24h([]);
    assert.equal(empty.totalMin, 0);
    assert.equal(empty.peakWindowStart, null);
    assert.equal(empty.peakWindowLabel, '—');
    assert.equal(empty.peakLabel, 'No sessions yet');
    assert.equal(empty.avgStartTime, '—');
    assert.equal(empty.avgWrapUpTime, '—');
  });

  it('angleToSpokeIndex maps 12 oclock boundary and all 4 quadrants cleanly', () => {
    // 24-hour clock
    assert.equal(angleToSpokeIndex(0, -100, 24), 0); // 12 o'clock exact
    assert.equal(angleToSpokeIndex(-2, -100, 24), 0); // just CCW of 12 o'clock wraps cleanly to 0
    assert.equal(angleToSpokeIndex(2, -100, 24), 0); // just CW of 12 o'clock stays 0
    assert.equal(angleToSpokeIndex(100, 0, 24), 6); // 3 o'clock (06:00)
    assert.equal(angleToSpokeIndex(0, 100, 24), 12); // 6 o'clock (12:00)
    assert.equal(angleToSpokeIndex(-100, 0, 24), 18); // 9 o'clock (18:00)

    // 30-day chronograph
    assert.equal(angleToSpokeIndex(0, -100, 30), 0); // 12 o'clock (TODAY)
    assert.equal(angleToSpokeIndex(0, 100, 30), 15); // 6 o'clock (-15d)
    assert.equal(angleToSpokeIndex(100, -100, 30), 4); // ~1:30 quadrant 1
    assert.equal(angleToSpokeIndex(-100, -100, 30), 26); // ~10:30 quadrant 4
    assert.equal(angleToSpokeIndex(0, 0, 30), 0); // dead center safe default
  });

  it('shadeHexColor darkens and lightens hex strings cleanly for 3D prism faces', () => {
    assert.equal(shadeHexColor('#646464', -0.3), '#464646');
    assert.equal(shadeHexColor('#000000', 0.2), '#333333');
    assert.equal(shadeHexColor('#fff', -0.5), '#808080');
  });
});
