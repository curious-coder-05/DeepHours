import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DESK_HUD_AUTO_HIDE_MS,
  DESK_MOUNT_GRACE_MS,
  KINETIC_WAVE_RIB_COUNT,
  computeKineticWaveRibTransform,
  computeMonolithMotion,
  formatBatteryPercent,
  formatDeskPrecisionClock,
  formatDeskPrecisionClockParts,
  formatDeskSubjectLabel,
  getDeskSculptureLabel,
  getOppositeDeskSculpture,
  isWithinMountGraceWindow,
  pickRandomDeskSculpture,
  shouldAutoHideDeskHud,
  shouldMountDeskChrono3D,
} from './deskModeHelpers.ts';

describe('v45 StandBy Desk Mode pure helpers', () => {
  it('randomly selects monolith or kinetic-wave at 0.5 split and toggles cleanly', () => {
    assert.equal(pickRandomDeskSculpture(() => 0.0), 'monolith');
    assert.equal(pickRandomDeskSculpture(() => 0.499), 'monolith');
    assert.equal(pickRandomDeskSculpture(() => 0.5), 'kinetic-wave');
    assert.equal(pickRandomDeskSculpture(() => 0.99), 'kinetic-wave');

    assert.equal(getOppositeDeskSculpture('monolith'), 'kinetic-wave');
    assert.equal(getOppositeDeskSculpture('kinetic-wave'), 'monolith');
    assert.equal(getDeskSculptureLabel('monolith'), 'Monolith');
    assert.equal(getDeskSculptureLabel('kinetic-wave'), 'Kinetic wave');
  });

  it('formats space-separated Swiss-horology HH MM SS precision clock and overtime cleanly', () => {
    assert.equal(formatDeskPrecisionClock(0), '00 00 00');
    assert.equal(formatDeskPrecisionClock((43 * 60 + 3) * 1000), '00 43 03');
    assert.equal(formatDeskPrecisionClock((3600 + 5 * 60 + 9) * 1000), '01 05 09');
    assert.equal(formatDeskPrecisionClock(-5000), '00 00 00');
    assert.equal(
      formatDeskPrecisionClock(0, { overtimeMs: (2 * 60 + 15) * 1000 }),
      '+00 02 15'
    );
    assert.deepEqual(formatDeskPrecisionClockParts((42 * 60 + 55) * 1000), {
      prefix: '',
      hours: '00',
      minutes: '42',
      seconds: '55',
    });
    assert.deepEqual(
      formatDeskPrecisionClockParts(0, { overtimeMs: (2 * 60 + 15) * 1000 }),
      {
        prefix: '+',
        hours: '00',
        minutes: '02',
        seconds: '15',
      }
    );
  });

  it('normalizes uppercase tracked subject micro-label and strips emojis', () => {
    assert.equal(formatDeskSubjectLabel('Physics'), 'PHYSICS');
    assert.equal(formatDeskSubjectLabel('  ⚡ Chemistry  '), 'CHEMISTRY');
    assert.equal(formatDeskSubjectLabel(''), 'DEEP STUDY');
    assert.equal(formatDeskSubjectLabel(undefined), 'DEEP STUDY');
  });

  it('strictly unmounts DeskChronoScene when closed, ui3d is off, or reduced motion is active', () => {
    assert.equal(
      shouldMountDeskChrono3D({ open: true, ui3dSetting: 'auto', reducedMotion: false }),
      true
    );
    assert.equal(
      shouldMountDeskChrono3D({ open: true, ui3dSetting: 'on', reducedMotion: false }),
      true
    );
    assert.equal(
      shouldMountDeskChrono3D({ open: false, ui3dSetting: 'auto', reducedMotion: false }),
      false
    );
    assert.equal(
      shouldMountDeskChrono3D({ open: true, ui3dSetting: 'off', reducedMotion: false }),
      false
    );
    assert.equal(
      shouldMountDeskChrono3D({ open: true, ui3dSetting: 'auto', reducedMotion: true }),
      false
    );
  });

  it('enforces 3s HUD auto-hide when visible and blocks hide during hold or open sheet', () => {
    assert.equal(DESK_HUD_AUTO_HIDE_MS, 3000);
    assert.equal(
      shouldAutoHideDeskHud({
        open: true,
        controlsVisible: true,
        holding: false,
        parkingSheetOpen: false,
      }),
      true
    );
    assert.equal(
      shouldAutoHideDeskHud({
        open: true,
        controlsVisible: false,
        holding: false,
        parkingSheetOpen: false,
      }),
      false
    );
    assert.equal(
      shouldAutoHideDeskHud({
        open: true,
        controlsVisible: true,
        holding: true,
        parkingSheetOpen: false,
      }),
      false
    );
    assert.equal(
      shouldAutoHideDeskHud({
        open: true,
        controlsVisible: true,
        holding: false,
        parkingSheetOpen: true,
      }),
      false
    );
  });

  it('enforces the 400ms mount grace window against leaked opening clicks', () => {
    assert.equal(DESK_MOUNT_GRACE_MS, 400);
    assert.equal(isWithinMountGraceWindow(1000, 1000), true);
    assert.equal(isWithinMountGraceWindow(1399, 1000), true);
    assert.equal(isWithinMountGraceWindow(1400, 1000), false);
    assert.equal(isWithinMountGraceWindow(2500, 1000), false);
  });

  it('dims and settles Monolith internal core smoothly when paused (energy 0 vs 1)', () => {
    const running = computeMonolithMotion(1.2, 1);
    const paused = computeMonolithMotion(1.2, 0);
    assert.ok(running.coreEmissiveIntensity > paused.coreEmissiveIntensity);
    assert.ok(running.coreLightIntensity > paused.coreLightIntensity);
    assert.ok(running.coreHaloOpacity > paused.coreHaloOpacity);
    assert.ok(Number.isFinite(running.rotX) && Number.isFinite(running.rotY));
  });

  it('computes 22-rib Kinetic Wave transforms symmetrically along spine with phase propagation', () => {
    assert.equal(KINETIC_WAVE_RIB_COUNT, 22);
    const first = computeKineticWaveRibTransform(0, KINETIC_WAVE_RIB_COUNT, 1.0, 1);
    const mid = computeKineticWaveRibTransform(10, KINETIC_WAVE_RIB_COUNT, 1.0, 1);
    const last = computeKineticWaveRibTransform(21, KINETIC_WAVE_RIB_COUNT, 1.0, 1);

    assert.ok(first.x < 0 && last.x > 0);
    assert.ok(Math.abs(first.x + last.x) < 1e-6);
    assert.ok(mid.scaleY > first.scaleY);

    // Paused (energy=0) softens wave amplitude compared to running (energy=1)
    const runRib = computeKineticWaveRibTransform(5, KINETIC_WAVE_RIB_COUNT, 2.0, 1);
    const pauseRib = computeKineticWaveRibTransform(5, KINETIC_WAVE_RIB_COUNT, 2.0, 0);
    assert.ok(Math.abs(pauseRib.yOffset) < Math.abs(runRib.yOffset) || Math.abs(runRib.yOffset) < 1e-3);
  });

  it('formats battery percentages with safe clamping', () => {
    assert.equal(formatBatteryPercent(0.846), 85);
    assert.equal(formatBatteryPercent(0), 0);
    assert.equal(formatBatteryPercent(1), 100);
    assert.equal(formatBatteryPercent(1.4), 100);
    assert.equal(formatBatteryPercent(-0.2), 0);
    assert.equal(formatBatteryPercent(Number.NaN), 0);
  });
});
