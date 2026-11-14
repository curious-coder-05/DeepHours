import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PIP_BREAK_COLOR,
  PIP_LUMEN_COLOR,
  computePiPViewModel,
  hexToRgba,
} from './pipHelpers.ts';
import { createDefaultState } from './studyLogic.ts';

test('hexToRgba converts 3-digit and 6-digit hex strings safely', () => {
  assert.equal(hexToRgba('#F5C451', 0.5), 'rgba(245, 196, 81, 0.5)');
  assert.equal(hexToRgba('#fff', 0.25), 'rgba(255, 255, 255, 0.25)');
});

test('computePiPViewModel uses subject color when studying, Lumen when paused/overtime, sky blue on break', () => {
  const base = createDefaultState();
  const sub = base.subjects[0];
  const now = new Date('2026-11-14T10:00:00Z').getTime();

  // Studying (running work)
  const studyingState = {
    ...base,
    activeTimer: {
      status: 'running' as const,
      mode: 'pomo' as const,
      phase: 'work' as const,
      subjectId: sub.id,
      heading: 'Thermodynamics',
      startTs: now - 10 * 60000,
      sliceStartTs: now - 10 * 60000,
      pauseStartTs: null,
      pausedDurationMs: 0,
      slicePausedMs: 0,
      pauseCount: 0,
      slicePauseCount: 0,
      targetMs: 25 * 60000,
      chimeFired: false,
    },
  };
  const studyingVm = computePiPViewModel(studyingState, now);
  assert.equal(studyingVm.statusLabel, 'Studying');
  assert.equal(studyingVm.accentColor, sub.color);
  assert.equal(studyingVm.contextAction.kind, 'extend5');
  assert.equal(studyingVm.contextAction.label, '+5m');
  assert.match(studyingVm.footerText, /^Purity 100% · Today /);

  // Paused
  const pausedState = {
    ...studyingState,
    activeTimer: {
      ...studyingState.activeTimer,
      status: 'paused' as const,
      pauseStartTs: now - 5 * 60000,
      pausedDurationMs: 5 * 60000,
      pauseCount: 1,
    },
  };
  const pausedVm = computePiPViewModel(pausedState, now);
  assert.equal(pausedVm.statusLabel, 'Paused');
  assert.equal(pausedVm.accentColor, PIP_LUMEN_COLOR);

  // Flow Overtime
  const overtimeState = {
    ...studyingState,
    activeTimer: {
      ...studyingState.activeTimer,
      startTs: now - 30 * 60000,
      sliceStartTs: now - 30 * 60000,
    },
  };
  const overtimeVm = computePiPViewModel(overtimeState, now);
  assert.equal(overtimeVm.statusLabel, 'Flow Overtime');
  assert.equal(overtimeVm.accentColor, PIP_LUMEN_COLOR);
  assert.equal(overtimeVm.isOvertime, true);
  assert.ok(overtimeVm.overtimeStr?.startsWith('+05:'));

  // Break
  const breakState = {
    ...studyingState,
    activeTimer: {
      ...studyingState.activeTimer,
      phase: 'break' as const,
      targetMs: 5 * 60000,
    },
  };
  const breakVm = computePiPViewModel(breakState, now);
  assert.equal(breakVm.statusLabel, 'Break');
  assert.equal(breakVm.accentColor, PIP_BREAK_COLOR);
});

test('computePiPViewModel handles Stopwatch 15m milestones and Full Mock Next Section', () => {
  const base = createDefaultState();
  const sub = base.subjects[0];
  const now = new Date('2026-11-14T10:00:00Z').getTime();

  const swState = {
    ...base,
    activeTimer: {
      status: 'running' as const,
      mode: 'stopwatch' as const,
      phase: 'work' as const,
      subjectId: sub.id,
      heading: 'Organic Chemistry',
      startTs: now - 12 * 60000,
      sliceStartTs: now - 12 * 60000,
      pauseStartTs: null,
      pausedDurationMs: 0,
      slicePausedMs: 0,
      pauseCount: 0,
      slicePauseCount: 0,
      targetMs: 0,
      chimeFired: false,
    },
  };
  const swVm = computePiPViewModel(swState, now);
  assert.equal(swVm.isStopwatch, true);
  assert.equal(swVm.contextAction.kind, 'milestone');
  assert.equal(swVm.stopwatchMilestone.remainingStr, '03:00');
  assert.equal(swVm.contextAction.label, '15m · 03:00');

  const mockState = {
    ...base,
    activeTimer: {
      ...swState.activeTimer,
      mode: 'fullMock' as const,
      targetMs: 180 * 60000,
      mockSections: [{ label: 'Section 1', elapsedMs: 1800000 }],
      sectionStartActiveMs: 1800000,
    },
  };
  const mockVm = computePiPViewModel(mockState, now);
  assert.equal(mockVm.contextAction.kind, 'nextSection');
  assert.equal(mockVm.contextAction.label, 'Next Section (2)');
});
