import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LUMEN_ACCENT,
  LUMEN_ACCENT_ON,
  computeUiPaceReport,
  computeWindowRange,
  contrastRatio,
  evaluateUi3dEligibility,
  getReadableAccentText,
  getReadableOnColor,
  getTimerStyleDisplayLabel,
  getUiDailyGoalMinutes,
  getUiDailyStudyGoalProgress,
  resolveUiExam,
} from './uiHelpers.ts';
import { createBlankState, mkHabit } from './studyLogic.ts';

describe('UI Helpers — contrast, D-Day pace fallback, display labels', () => {
  it('computes WCAG AA contrast on Lumen accent and legacy yellow/sky accents', () => {
    assert.equal(getReadableOnColor(LUMEN_ACCENT), LUMEN_ACCENT_ON);
    assert.ok(contrastRatio(LUMEN_ACCENT, LUMEN_ACCENT_ON) >= 4.5);
    assert.equal(getReadableOnColor('#f59e0b'), LUMEN_ACCENT_ON);
    assert.equal(getReadableOnColor('#38bdf8'), LUMEN_ACCENT_ON);
    assert.equal(getReadableOnColor('#6366f1'), '#FFFFFF');
  });

  it('darkens bright yellow accents on light warm paper to preserve AA contrast', () => {
    const lightInk = getReadableAccentText(LUMEN_ACCENT, 'light');
    assert.ok(contrastRatio(lightInk, '#EFECE5') >= 4.5);

    const darkInk = getReadableAccentText(LUMEN_ACCENT, 'dark');
    assert.ok(contrastRatio(darkInk, '#181C22') >= 4.5);
  });

  it('resolveUiExam and computeUiPaceReport fall back to nearest upcoming D-Day when none is primary', () => {
    const state = createBlankState();
    state.chapters = [
      {
        id: 'ch_1',
        subjectId: 'sub_phy',
        name: 'Kinematics',
        status: 'notStarted',
        revisions: [],
      },
    ];
    state.ddays = [
      {
        id: 'dd_past',
        title: 'Past Practice',
        date: '2026-09-01',
        e: '📝',
        color: '#6366f1',
        primary: false,
      },
      {
        id: 'dd_far',
        title: 'Far Target',
        date: '2027-06-01',
        e: '🎯',
        color: '#10b981',
        primary: false,
      },
      {
        id: 'dd_near',
        title: 'Upcoming NEET',
        date: '2026-12-20',
        e: '🩺',
        color: '#f59e0b',
        primary: false,
      },
    ];

    const chosen = resolveUiExam(state, '2026-11-01');
    assert.equal(chosen?.id, 'dd_near');

    const pace = computeUiPaceReport(state, '2026-11-01');
    assert.equal(pace.exam?.id, 'dd_near');
    assert.equal(pace.exam?.title, 'Upcoming NEET');
    assert.equal(pace.daysToExam, 49);
  });

  it('maps stored timer aesthetic keys to restrained display labels', () => {
    assert.equal(getTimerStyleDisplayLabel('neon'), 'Digital');
    assert.equal(getTimerStyleDisplayLabel('minimal'), 'Mono');
    assert.equal(getTimerStyleDisplayLabel('retro'), 'Analog');
    assert.equal(getTimerStyleDisplayLabel(undefined), 'Digital');
  });

  it('evaluates 3D scene gating and Lite vs Normal quality tiers accurately', () => {
    // 'off' never enables WebGL
    const offRes = evaluateUi3dEligibility({
      ui3dSetting: 'off',
      webgl2Supported: true,
      isSoftwareGl: false,
      prefersReducedMotion: false,
      saveData: false,
      hardwareConcurrency: 8,
      deviceMemory: 8,
    });
    assert.equal(offRes.enabled, false);
    assert.equal(offRes.tier, 'off');

    // 'auto' disables on prefersReducedMotion, saveData, or low hardware (<=2 cores/memory)
    assert.equal(
      evaluateUi3dEligibility({
        ui3dSetting: 'auto',
        webgl2Supported: true,
        isSoftwareGl: false,
        prefersReducedMotion: true,
        saveData: false,
        hardwareConcurrency: 8,
        deviceMemory: 8,
      }).enabled,
      false
    );
    assert.equal(
      evaluateUi3dEligibility({
        ui3dSetting: 'auto',
        webgl2Supported: true,
        isSoftwareGl: false,
        prefersReducedMotion: false,
        saveData: true,
        hardwareConcurrency: 8,
        deviceMemory: 8,
      }).enabled,
      false
    );
    assert.equal(
      evaluateUi3dEligibility({
        ui3dSetting: 'auto',
        webgl2Supported: true,
        isSoftwareGl: false,
        prefersReducedMotion: false,
        saveData: false,
        hardwareConcurrency: 2,
        deviceMemory: 8,
      }).enabled,
      false
    );

    // 'auto' on capable hardware -> Normal tier (DPR 1.5, 60fps, 600 particles)
    const normalRes = evaluateUi3dEligibility({
      ui3dSetting: 'auto',
      webgl2Supported: true,
      isSoftwareGl: false,
      prefersReducedMotion: false,
      saveData: false,
      hardwareConcurrency: 8,
      deviceMemory: 8,
    });
    assert.equal(normalRes.enabled, true);
    assert.equal(normalRes.tier, 'normal');
    assert.equal(normalRes.maxDpr, 1.5);
    assert.equal(normalRes.particleBudget, 600);

    // 'on' forces enablement when WebGL2 is supported, using Lite tier on software GL
    const forcedSwRes = evaluateUi3dEligibility({
      ui3dSetting: 'on',
      webgl2Supported: true,
      isSoftwareGl: true,
      prefersReducedMotion: true,
      saveData: false,
      hardwareConcurrency: 2,
      deviceMemory: 2,
    });
    assert.equal(forcedSwRes.enabled, true);
    assert.equal(forcedSwRes.tier, 'lite');
    assert.equal(forcedSwRes.maxDpr, 1);
    assert.equal(forcedSwRes.particleBudget, 200);

    // deskMode always disables 3D canvas
    assert.equal(
      evaluateUi3dEligibility({
        ui3dSetting: 'on',
        webgl2Supported: true,
        isSoftwareGl: false,
        prefersReducedMotion: false,
        saveData: false,
        deskMode: true,
      }).enabled,
      false
    );

    // ui3dQuality 'lite' and 'high' resolve tiers & budgets cleanly
    const liteOverride = evaluateUi3dEligibility({
      ui3dSetting: 'auto',
      ui3dQuality: 'lite',
      webgl2Supported: true,
      isSoftwareGl: false,
      prefersReducedMotion: false,
      saveData: false,
      hardwareConcurrency: 8,
      deviceMemory: 8,
    });
    assert.equal(liteOverride.tier, 'lite');
    assert.equal(liteOverride.resolvedQuality, 'lite');
    assert.equal(liteOverride.particleBudget, 400);

    const highOverride = evaluateUi3dEligibility({
      ui3dSetting: 'auto',
      ui3dQuality: 'high',
      webgl2Supported: true,
      isSoftwareGl: false,
      prefersReducedMotion: false,
      saveData: false,
      hardwareConcurrency: 8,
      deviceMemory: 8,
    });
    assert.equal(highOverride.tier, 'normal');
    assert.equal(highOverride.resolvedQuality, 'high');
    assert.equal(highOverride.particleBudget, 1500);
  });

  it('computes deterministic WindowedList ranges with overscan clamping and measured heights', () => {
    const empty = computeWindowRange({
      totalCount: 0,
      containerTopPx: 0,
      viewportHeightPx: 600,
      estimatedRowHeightPx: 60,
    });
    assert.deepEqual(empty, {
      startIndex: 0,
      endIndex: -1,
      topSpacerPx: 0,
      bottomSpacerPx: 0,
    });

    // Top of a 250-item uniform 60px list inside a 600px viewport with 4-row overscan
    const atTop = computeWindowRange({
      totalCount: 250,
      containerTopPx: 0,
      viewportHeightPx: 600,
      estimatedRowHeightPx: 60,
      overscan: 4,
    });
    assert.equal(atTop.startIndex, 0);
    assert.equal(atTop.endIndex, 14);
    assert.equal(atTop.topSpacerPx, 0);
    assert.equal(atTop.bottomSpacerPx, (250 - 15) * 60);

    // Mid-scroll with variable measured row heights (container scrolled 1200px above viewport top)
    const measuredHeights = new Map<number, number>([
      [0, 100],
      [1, 100],
    ]);
    const mid = computeWindowRange({
      totalCount: 150,
      containerTopPx: -1200,
      viewportHeightPx: 400,
      estimatedRowHeightPx: 50,
      measuredHeights,
      overscan: 2,
    });
    assert.ok(mid.startIndex > 0);
    assert.ok(mid.endIndex < 149);
    assert.ok(mid.topSpacerPx > 0);
    assert.ok(mid.bottomSpacerPx > 0);
  });

  it('returns no-chapters pace status when totalChapters is 0 and derives unified daily goal from minDayMinutes', () => {
    const state = createBlankState();
    state.ddays = [
      {
        id: 'dd_neet',
        title: 'NEET UG',
        date: '2026-12-20',
        e: '🩺',
        color: '#F5C451',
        primary: true,
      },
    ];
    state.chapters = [];

    const pace = computeUiPaceReport(state, '2026-11-01');
    assert.equal(pace.totalChapters, 0);
    assert.equal(pace.status, 'no-chapters');
    assert.equal(pace.overall.status, 'no-chapters');

    // When minDayMinutes is unset, defaults to 360m (6h 0m) even if Deep Study (3 hrs) habit exists
    state.set.targets = undefined;
    state.habits = [
      mkHabit({ id: 'h_deep', name: 'Deep Study (3 hrs)', subjectId: 'any', autoMins: 180, tn: 180, tu: 'min' }, '2026-11-01'),
    ];
    assert.equal(getUiDailyGoalMinutes(state), 360);

    state.set.targets = {
      dailyMinutes: {},
      weeklyMinutes: {},
      minDayMinutes: 360,
      restPassesPerMonth: 4,
    };
    state.sessions = [
      {
        id: 's_1',
        subjectId: 'sub_phy',
        heading: 'Optics',
        dayKey: '2026-11-01',
        startTs: 1000,
        endTs: 1000 + 180 * 60000,
        activeMs: 180 * 60000,
        pausedMs: 0,
        pauseCount: 0,
        overtimeMs: 0,
        purity: 100,
        mode: 'stopwatch',
        source: 'timer',
        rating: 5,
        note: '',
        updatedAt: 2000,
      },
    ];
    const prog = getUiDailyStudyGoalProgress(state, '2026-11-01', '2026-11-01');
    assert.equal(prog.goalMins, 360);
    assert.equal(prog.goalMs, 360 * 60000);
    assert.equal(prog.pct, 50);
  });
});
