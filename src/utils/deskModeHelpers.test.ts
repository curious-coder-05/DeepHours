import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DESK_3D_STORAGE_KEY,
  DESK_HUD_AUTO_HIDE_MS,
  DESK_MOUNT_GRACE_MS,
  computeChronoState,
  computeDeskProgressFilament,
  formatBatteryPercent,
  isWithinMountGraceWindow,
  loadDesk3dPreference,
  saveDesk3dPreference,
  shouldAutoHideDeskHud,
  shouldMountDeskChrono3D,
} from './deskModeHelpers.ts';

function createMemoryStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
  };
}

describe('v43 StandBy Desk Mode pure helpers', () => {
  it('defaults Desk 3D ON when ui3d !== off and persists toggle cleanly', () => {
    const store = createMemoryStorage();
    assert.equal(loadDesk3dPreference('auto', store), true);
    assert.equal(loadDesk3dPreference('on', store), true);
    assert.equal(loadDesk3dPreference('off', store), false);

    saveDesk3dPreference(false, store);
    assert.equal(store.getItem(DESK_3D_STORAGE_KEY), '0');
    assert.equal(loadDesk3dPreference('auto', store), false);

    saveDesk3dPreference(true, store);
    assert.equal(store.getItem(DESK_3D_STORAGE_KEY), '1');
    assert.equal(loadDesk3dPreference('auto', store), true);
    // Global ui3d='off' always overrides local Desk 3D preference
    assert.equal(loadDesk3dPreference('off', store), false);
  });

  it('strictly unmounts DeskChronoScene (0 WebGL canvases) when Night dim, 3D OFF, ui3d off, or reduced motion is active', () => {
    const base = {
      open: true,
      nightDim: false,
      desk3dEnabled: true,
      ui3dSetting: 'auto' as const,
      reducedMotion: false,
    };
    assert.equal(shouldMountDeskChrono3D(base), true);
    assert.equal(shouldMountDeskChrono3D({ ...base, open: false }), false);
    assert.equal(shouldMountDeskChrono3D({ ...base, nightDim: true }), false);
    assert.equal(shouldMountDeskChrono3D({ ...base, desk3dEnabled: false }), false);
    assert.equal(shouldMountDeskChrono3D({ ...base, ui3dSetting: 'off' }), false);
    assert.equal(shouldMountDeskChrono3D({ ...base, reducedMotion: true }), false);
  });

  it('enforces 4.5s HUD auto-hide ONLY while running and never when Paused, Overtime, Holding, or Parking Lot open', () => {
    assert.equal(DESK_HUD_AUTO_HIDE_MS, 4500);
    assert.equal(
      shouldAutoHideDeskHud({
        open: true,
        isRunning: true,
        isPaused: false,
        isOvertime: false,
        holding: false,
        parkingSheetOpen: false,
      }),
      true
    );
    assert.equal(
      shouldAutoHideDeskHud({
        open: true,
        isRunning: false,
        isPaused: true,
        isOvertime: false,
        holding: false,
        parkingSheetOpen: false,
      }),
      false
    );
    assert.equal(
      shouldAutoHideDeskHud({
        open: true,
        isRunning: true,
        isPaused: false,
        isOvertime: true,
        holding: false,
        parkingSheetOpen: false,
      }),
      false
    );
    assert.equal(
      shouldAutoHideDeskHud({
        open: true,
        isRunning: true,
        isPaused: false,
        isOvertime: false,
        holding: true,
        parkingSheetOpen: false,
      }),
      false
    );
    assert.equal(
      shouldAutoHideDeskHud({
        open: true,
        isRunning: true,
        isPaused: false,
        isOvertime: false,
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

  it('maps running, paused, and overtime states to crisp chronometer visual palettes and tick indices', () => {
    const running = computeChronoState({
      isRunning: true,
      isPaused: false,
      isOvertime: false,
      clockMs: 15_000,
    });
    assert.equal(running.visualMode, 'running');
    assert.equal(running.accentHex, '#F5C542');
    assert.equal(running.activeTickIndex, 15);
    assert.equal(running.intensity, 1.0);

    const paused = computeChronoState({
      isRunning: false,
      isPaused: true,
      isOvertime: false,
      clockMs: 30_000,
    });
    assert.equal(paused.visualMode, 'paused');
    assert.equal(paused.activeTickIndex, 30);
    assert.ok(paused.intensity < 0.6);

    const overtime = computeChronoState({
      isRunning: true,
      isPaused: false,
      isOvertime: true,
      clockMs: 45_000,
    });
    assert.equal(overtime.visualMode, 'overtime');
    assert.equal(overtime.accentHex, '#F43F5E');
    assert.equal(overtime.activeTickIndex, 45);
  });

  it('computes progress filament percentages and stopwatch 15m pulse cleanly', () => {
    const sw = computeDeskProgressFilament({
      mode: 'focus',
      isStopwatch: true,
      isRunning: true,
      isPaused: false,
      isOvertime: false,
      totalActiveMs: 1_350_000, // 22.5 min -> 1 hit, 50% into second 15m cycle
    });
    assert.equal(sw.pct, 50);
    assert.equal(sw.tone, 'gold');
    assert.match(sw.metaLabel, /1×15m/);

    const ot = computeDeskProgressFilament({
      mode: 'focus',
      isRunning: true,
      isPaused: false,
      isOvertime: true,
      overtimeMs: 125_000,
    });
    assert.equal(ot.pct, 100);
    assert.equal(ot.tone, 'crimson');
    assert.match(ot.metaLabel, /\+02:05/);

    const exam = computeDeskProgressFilament({
      mode: 'exam',
      isRunning: true,
      isPaused: false,
      isOvertime: false,
      activeExamLabel: 'Physics',
      examTotalElapsedMs: 5_400_000,
      examTotalBudgetMs: 10_800_000,
    });
    assert.equal(exam.pct, 50);
    assert.match(exam.metaLabel, /Physics/);
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
