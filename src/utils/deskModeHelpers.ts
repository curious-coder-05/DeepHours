import { fmtClockTime, fmtMS } from './studyLogic.ts';
import type { Ui3dSetting } from './uiHelpers.ts';

export const DESK_3D_STORAGE_KEY = 'dh_desk_3d_v1';
export const DESK_HUD_AUTO_HIDE_MS = 4500;
export const DESK_MOUNT_GRACE_MS = 400;

export type DeskChronoVisualMode = 'running' | 'paused' | 'overtime';

export interface DeskChronoState {
  visualMode: DeskChronoVisualMode;
  /** Normalized 0..1 position of the live sweeping second marker within the 60s dial. */
  secondFraction: number;
  /** Integer 0..59 index of the active second tick on the 60-tick orbital ring. */
  activeTickIndex: number;
  /** Primary accent hex for the sweeping marker and active ticks. */
  accentHex: string;
  /** Secondary meridian gimbal hex. */
  meridianHex: string;
  /** Global luminance scalar for the 3D chronometer (low when paused, vivid in overtime). */
  intensity: number;
}

export interface DeskProgressFilament {
  /** Normalized 0..100 fill percentage for the bottom 2px filament. */
  pct: number;
  /** Semantic filament tone. */
  tone: 'gold' | 'crimson' | 'paused';
  /** Muted right-aligned ETA / milestone meta string. */
  metaLabel: string;
}

/**
 * Loads the user's Desk Mode 3D backdrop preference from localStorage.
 * Defaults to ON whenever `settings.ui3d !== 'off'`, and strictly OFF if global 3D is off.
 */
export function loadDesk3dPreference(
  ui3dSetting: Ui3dSetting = 'auto',
  storage?: Pick<Storage, 'getItem'> | null
): boolean {
  if (ui3dSetting === 'off') return false;
  try {
    const store =
      storage !== undefined
        ? storage
        : typeof window !== 'undefined'
          ? window.localStorage
          : null;
    if (!store) return true;
    const raw = store.getItem(DESK_3D_STORAGE_KEY);
    if (raw === '0' || raw === 'false') return false;
    if (raw === '1' || raw === 'true') return true;
    return true;
  } catch {
    return true;
  }
}

/**
 * Persists the Desk Mode 3D backdrop toggle strictly in localStorage.
 */
export function saveDesk3dPreference(
  enabled: boolean,
  storage?: Pick<Storage, 'setItem'> | null
): void {
  try {
    const store =
      storage !== undefined
        ? storage
        : typeof window !== 'undefined'
          ? window.localStorage
          : null;
    store?.setItem(DESK_3D_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // Ignore storage quota / private mode errors
  }
}

/**
 * Strict single-source-of-truth gate for mounting `DeskChronoScene`.
 * Guarantees 0 WebGL canvases whenever Desk Mode is closed, Night dim is ON,
 * 3D toggle is OFF, global `settings.ui3d === 'off'`, or `prefers-reduced-motion` is active.
 */
export function shouldMountDeskChrono3D(params: {
  open: boolean;
  nightDim: boolean;
  desk3dEnabled: boolean;
  ui3dSetting?: Ui3dSetting;
  reducedMotion: boolean;
}): boolean {
  const { open, nightDim, desk3dEnabled, ui3dSetting = 'auto', reducedMotion } = params;
  if (!open) return false;
  if (nightDim) return false;
  if (!desk3dEnabled) return false;
  if (ui3dSetting === 'off') return false;
  if (reducedMotion) return false;
  return true;
}

/**
 * Auto-hide HUD controls after 4.5s ONLY while the timer is actively running
 * and no sub-sheet or hold gesture is active. Keeps controls visible when Paused or Overtime.
 */
export function shouldAutoHideDeskHud(params: {
  open: boolean;
  isRunning: boolean;
  isPaused: boolean;
  isOvertime: boolean;
  holding: boolean;
  parkingSheetOpen: boolean;
}): boolean {
  const { open, isRunning, isPaused, isOvertime, holding, parkingSheetOpen } = params;
  return open && isRunning && !isPaused && !isOvertime && !holding && !parkingSheetOpen;
}

/**
 * Ignores stage background clicks during the initial 400ms mount grace window
 * so the tap opening Desk Mode from FocusView can never leak through and hide the HUD.
 */
export function isWithinMountGraceWindow(
  nowMs: number,
  mountedAtMs: number,
  graceMs = DESK_MOUNT_GRACE_MS
): boolean {
  if (!Number.isFinite(nowMs) || !Number.isFinite(mountedAtMs)) return false;
  return nowMs - mountedAtMs < graceMs;
}

/**
 * Computes pure visual parameters for the 3D Orbital Chronometer backdrop.
 */
export function computeChronoState(params: {
  isRunning: boolean;
  isPaused: boolean;
  isOvertime: boolean;
  /** Milliseconds driving the sweeping second position (active elapsed or remaining ms). */
  clockMs: number;
  /** True when counting down (sweeps clockwise with elapsed time when false, or ticking seconds). */
  isCountdown?: boolean;
}): DeskChronoState {
  const { isRunning, isPaused, isOvertime, clockMs, isCountdown = false } = params;
  const safeMs = Math.max(0, Number.isFinite(clockMs) ? clockMs : 0);
  const rawSec = (safeMs % 60_000) / 60_000;
  // For countdowns, sweep smoothly clockwise as seconds decrease from 60 -> 0
  const secondFraction = isCountdown ? (1 - rawSec) % 1 : rawSec;
  const activeTickIndex = Math.floor(secondFraction * 60) % 60;

  if (isOvertime) {
    return {
      visualMode: 'overtime',
      secondFraction,
      activeTickIndex,
      accentHex: '#F43F5E',
      meridianHex: '#FB7185',
      intensity: 1.16,
    };
  }

  if (isPaused || !isRunning) {
    return {
      visualMode: 'paused',
      secondFraction,
      activeTickIndex,
      accentHex: '#C28263',
      meridianHex: '#7A4B38',
      intensity: 0.44,
    };
  }

  return {
    visualMode: 'running',
    secondFraction,
    activeTickIndex,
    accentHex: '#F5C542',
    meridianHex: '#E88D67',
    intensity: 1.0,
  };
}

/**
 * Computes the razor-thin bottom 2px progress filament and muted ETA / milestone meta.
 */
export function computeDeskProgressFilament(params: {
  mode: 'focus' | 'exam';
  isStopwatch?: boolean;
  isRunning: boolean;
  isPaused: boolean;
  isOvertime: boolean;
  progressPct?: number;
  remainingMs?: number;
  totalActiveMs?: number;
  overtimeMs?: number;
  activeExamLabel?: string;
  examTotalElapsedMs?: number;
  examTotalBudgetMs?: number;
  nowMs?: number;
}): DeskProgressFilament {
  const {
    mode,
    isStopwatch = false,
    isRunning,
    isPaused,
    isOvertime,
    progressPct = 0,
    remainingMs = 0,
    totalActiveMs = 0,
    overtimeMs = 0,
    activeExamLabel,
    examTotalElapsedMs = 0,
    examTotalBudgetMs = 10_800_000,
    nowMs = Date.now(),
  } = params;

  const tone: DeskProgressFilament['tone'] = isOvertime
    ? 'crimson'
    : isPaused
      ? 'paused'
      : 'gold';

  if (mode === 'exam') {
    const safeBudget = Math.max(1, examTotalBudgetMs);
    const pct = Math.max(0, Math.min(100, (Math.max(0, examTotalElapsedMs) / safeBudget) * 100));
    const rem = Math.max(0, safeBudget - Math.max(0, examTotalElapsedMs));
    const metaLabel = isOvertime
      ? `${activeExamLabel ? `${activeExamLabel} · ` : ''}Overtime`
      : isPaused
        ? `${activeExamLabel ? `${activeExamLabel} · ` : ''}Paused`
        : `${activeExamLabel ? `${activeExamLabel} · ` : ''}Ends ${fmtClockTime(nowMs + rem)}`;
    return { pct, tone, metaLabel };
  }

  if (isStopwatch) {
    const safeActive = Math.max(0, totalActiveMs);
    const cycleMs = 900_000; // 15-minute milestone pulse
    const hits = Math.floor(safeActive / cycleMs);
    const intoCycle = safeActive % cycleMs;
    const pct = Math.max(0, Math.min(100, (intoCycle / cycleMs) * 100));
    const nextIn = Math.max(0, cycleMs - intoCycle);
    const metaLabel = isPaused
      ? hits > 0
        ? `${hits}×15m · Paused`
        : 'Stopwatch · Paused'
      : hits > 0
        ? `${hits}×15m · next in ${fmtMS(nextIn)}`
        : `15m pulse · next in ${fmtMS(nextIn)}`;
    return { pct, tone, metaLabel };
  }

  const pct = Math.max(0, Math.min(100, Number.isFinite(progressPct) ? progressPct : 0));
  if (isOvertime) {
    return {
      pct: 100,
      tone: 'crimson',
      metaLabel: `+${fmtMS(Math.max(0, overtimeMs))} over target`,
    };
  }
  if (isPaused) {
    return {
      pct,
      tone: 'paused',
      metaLabel: `${Math.round(pct)}% · Paused`,
    };
  }
  if (!isRunning) {
    return {
      pct: 0,
      tone: 'paused',
      metaLabel: 'Ready',
    };
  }
  return {
    pct,
    tone: 'gold',
    metaLabel: `Ends ${fmtClockTime(nowMs + Math.max(0, remainingMs))}`,
  };
}

/**
 * Formats a Web Battery API level (0..1) into a clamped 0..100 integer percentage.
 */
export function formatBatteryPercent(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.max(0, Math.min(100, Math.round(level * 100)));
}
