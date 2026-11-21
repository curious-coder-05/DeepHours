import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PIP_BREAK_COLOR,
  PIP_CRIMSON_COLOR,
  PIP_LUMEN_COLOR,
  clampPiPProgress,
  computePiPViewModel,
  hexToRgba,
  resolvePiPCanvasStatus,
  stripPiPEmojis,
  truncatePiPText,
} from './pipHelpers.ts';
import { createInitialExamClockState, startExamClock } from './examClock.ts';
import { createDefaultState } from './studyLogic.ts';

test('hexToRgba converts 3-digit and 6-digit hex strings safely', () => {
  assert.equal(hexToRgba('#F5C451', 0.5), 'rgba(245, 196, 81, 0.5)');
  assert.equal(hexToRgba('#fff', 0.25), 'rgba(255, 255, 255, 0.25)');
});

test('stripPiPEmojis removes leading and inline Unicode emojis cleanly', () => {
  assert.equal(stripPiPEmojis('⚛️ Physics Study'), 'Physics Study');
  assert.equal(stripPiPEmojis('🧬 Biology · Cell Cycle 🔬'), 'Biology · Cell Cycle');
  assert.equal(stripPiPEmojis('🧪 Organic Chem 🔥 Sprint ⏱️'), 'Organic Chem Sprint');
  assert.equal(stripPiPEmojis('⚛️   '), '');
  assert.equal(stripPiPEmojis('Physics'), 'Physics');
});

test('resolvePiPCanvasStatus returns exact status label and dot color across running, paused, break, ready, and exam overtime', () => {
  const focusing = resolvePiPCanvasStatus({
    isActive: true,
    isRunning: true,
    isPaused: false,
    isBreak: false,
    isExamOvertime: false,
  });
  assert.equal(focusing.label, 'FOCUSING');
  assert.equal(focusing.dotColor, '#34D399');
  assert.equal(focusing.isCrimson, false);

  const paused = resolvePiPCanvasStatus({
    isActive: true,
    isRunning: false,
    isPaused: true,
    isBreak: false,
    isExamOvertime: false,
  });
  assert.equal(paused.label, 'PAUSED');
  assert.equal(paused.dotColor, '#FDE047');
  assert.equal(paused.isCrimson, false);

  const overtime = resolvePiPCanvasStatus({
    isActive: true,
    isRunning: true,
    isPaused: false,
    isBreak: false,
    isExamOvertime: true,
  });
  assert.equal(overtime.label, 'OVERTIME');
  assert.equal(overtime.dotColor, '#FB7185');
  assert.equal(overtime.isCrimson, true);

  const ready = resolvePiPCanvasStatus({
    isActive: false,
    isRunning: false,
    isPaused: false,
    isBreak: false,
    isExamOvertime: false,
  });
  assert.equal(ready.label, 'READY');
  assert.equal(ready.isCrimson, false);
});

test('clampPiPProgress and truncatePiPText handle bounds and edge cases cleanly', () => {
  assert.equal(clampPiPProgress(-0.5), 0);
  assert.equal(clampPiPProgress(0), 0);
  assert.equal(clampPiPProgress(0.42), 0.42);
  assert.equal(clampPiPProgress(1.8), 1);
  assert.equal(clampPiPProgress(Number.NaN), 0);
  assert.equal(clampPiPProgress(Number.POSITIVE_INFINITY), 0);

  assert.equal(truncatePiPText('Physics Study', 20), 'Physics Study');
  assert.equal(
    truncatePiPText('Electrostatics and Capacitance Practice', 16),
    'Electrostatics…'
  );
  assert.equal(truncatePiPText('Abc', 1), '…');
  assert.equal(truncatePiPText('   ', 10), '');
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
      heading: '⚛️ Thermodynamics',
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
  const studyingVm = computePiPViewModel(studyingState, now, null);
  assert.equal(studyingVm.statusLabel, 'Studying');
  assert.equal(studyingVm.canvasStatus.label, 'FOCUSING');
  assert.equal(studyingVm.accentColor, sub.color);
  assert.equal(studyingVm.cleanTitle, `${sub.name} · Thermodynamics`);
  assert.equal(studyingVm.displayTitle.includes('⚛'), false);
  assert.equal(studyingVm.contextAction.kind, 'extend5');
  assert.equal(studyingVm.contextAction.label, '+5m');
  assert.match(studyingVm.footerText, /^Purity 100% · Today /);
  assert.ok(studyingVm.progressRatio > 0.39 && studyingVm.progressRatio < 0.41);

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
  const pausedVm = computePiPViewModel(pausedState, now, null);
  assert.equal(pausedVm.statusLabel, 'Paused');
  assert.equal(pausedVm.canvasStatus.label, 'PAUSED');
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
  const overtimeVm = computePiPViewModel(overtimeState, now, null);
  assert.equal(overtimeVm.statusLabel, 'Flow Overtime');
  assert.equal(overtimeVm.accentColor, PIP_LUMEN_COLOR);
  assert.equal(overtimeVm.isOvertime, true);
  assert.equal(overtimeVm.progressRatio, 1);
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
  const breakVm = computePiPViewModel(breakState, now, null);
  assert.equal(breakVm.statusLabel, 'Break');
  assert.equal(breakVm.canvasStatus.label, 'BREAK');
  assert.equal(breakVm.accentColor, PIP_BREAK_COLOR);
});

test('computePiPViewModel handles Stopwatch 15m milestones, Full Mock Next Section, and Exam Hall overtime', () => {
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
  const swVm = computePiPViewModel(swState, now, null);
  assert.equal(swVm.isStopwatch, true);
  assert.equal(swVm.contextAction.kind, 'milestone');
  assert.equal(swVm.stopwatchMilestone.remainingStr, '03:00');
  assert.equal(swVm.contextAction.label, '15m · 03:00');
  assert.equal(swVm.captionText, '15m Milestone · 03:00 left');
  assert.ok(Math.abs(swVm.progressRatio - 0.8) < 1e-6);

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
  const mockVm = computePiPViewModel(mockState, now, null);
  assert.equal(mockVm.contextAction.kind, 'nextSection');
  assert.equal(mockVm.contextAction.label, 'Next Section (2)');

  // Exam Hall running in Overtime (Biology budget = 50m, elapsed = 53m)
  const examStart = now - 53 * 60000;
  const examState = startExamClock(createInitialExamClockState(), 'bio', examStart);
  const examVm = computePiPViewModel(base, now, examState);
  assert.equal(examVm.isExamHall, true);
  assert.equal(examVm.isExamOvertime, true);
  assert.equal(examVm.canvasStatus.label, 'OVERTIME');
  assert.equal(examVm.canvasStatus.isCrimson, true);
  assert.equal(examVm.accentColor, PIP_CRIMSON_COLOR);
  assert.equal(examVm.cleanTitle, 'Biology · Exam Hall');
  assert.equal(examVm.progressRatio, 1);
  assert.ok(examVm.clockStr.startsWith('+00:03:'));
});
