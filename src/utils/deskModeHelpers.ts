import type { Ui3dSetting } from './uiHelpers.ts';

export const DESK_HUD_AUTO_HIDE_MS = 3000;
export const DESK_MOUNT_GRACE_MS = 400;
export const KINETIC_WAVE_RIB_COUNT = 22;

export type DeskSculptureKind = 'monolith' | 'kinetic-wave';

export interface MonolithMotionSnapshot {
  rotX: number;
  rotY: number;
  rotZ: number;
  coreRotY: number;
  corePulse: number;
  coreEmissiveIntensity: number;
  coreLightIntensity: number;
  coreHaloOpacity: number;
}

export interface KineticWaveRibTransform {
  x: number;
  yOffset: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  scaleY: number;
}

/**
 * Randomly selects one of the two procedural Obsidian Steel sculptures on Desk Mode entry.
 * Uses `Math.random() < 0.5` by default so only one sculpture is ever instantiated per session.
 */
export function pickRandomDeskSculpture(
  randFn: () => number = Math.random
): DeskSculptureKind {
  return randFn() < 0.5 ? 'monolith' : 'kinetic-wave';
}

/**
 * Returns the alternate sculpture when the user taps "Switch Sculpture".
 */
export function getOppositeDeskSculpture(
  current: DeskSculptureKind
): DeskSculptureKind {
  return current === 'monolith' ? 'kinetic-wave' : 'monolith';
}

/**
 * Human-readable sentence-case label for the active 3D sculpture.
 */
export function getDeskSculptureLabel(sculpture: DeskSculptureKind): string {
  return sculpture === 'monolith' ? 'Monolith' : 'Kinetic wave';
}

/**
 * Formats elapsed or remaining milliseconds into Swiss-horology space-separated
 * `HH MM SS` tabular numerals (e.g. `00 43 03`, `01 12 08`, or `+00 02 15` in overtime).
 */
export function formatDeskPrecisionClock(
  ms: number,
  opts?: { overtimeMs?: number }
): string {
  const overtimeMs = opts?.overtimeMs ?? 0;
  const isOvertime = Number.isFinite(overtimeMs) && overtimeMs > 0;
  const sourceMs = isOvertime ? overtimeMs : ms;
  const safeMs = Number.isFinite(sourceMs) ? Math.max(0, sourceMs) : 0;
  const totalSec = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  const formatted = `${hh} ${mm} ${ss}`;
  return isOvertime ? `+${formatted}` : formatted;
}

/**
 * Formats the quiet tracked uppercase subject micro-label centered above the timer.
 * Strips emojis and control characters to keep the AMOLED hardware aesthetic pure.
 */
export function formatDeskSubjectLabel(subjectName?: string | null): string {
  const raw = typeof subjectName === 'string' ? subjectName : '';
  const cleaned = raw
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F]/gu, '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || 'DEEP STUDY').toUpperCase();
}

/**
 * Single-source-of-truth gate for mounting the Desk Mode WebGL sculpture.
 * Guarantees 0 WebGL canvases when Desk Mode is closed, `settings.ui3d === 'off'`,
 * or `prefers-reduced-motion` is enabled.
 */
export function shouldMountDeskChrono3D(params: {
  open: boolean;
  ui3dSetting?: Ui3dSetting;
  reducedMotion: boolean;
}): boolean {
  const { open, ui3dSetting = 'auto', reducedMotion } = params;
  if (!open) return false;
  if (ui3dSetting === 'off') return false;
  if (reducedMotion) return false;
  return true;
}

/**
 * Auto-hides the frameless floating HUD back to `opacity: 0` after 3s of inactivity
 * whenever Desk Mode is open and no hold gesture or parking sheet is active.
 */
export function shouldAutoHideDeskHud(params: {
  open: boolean;
  controlsVisible: boolean;
  holding: boolean;
  parkingSheetOpen: boolean;
}): boolean {
  const { open, controlsVisible, holding, parkingSheetOpen } = params;
  return open && controlsVisible && !holding && !parkingSheetOpen;
}

/**
 * Ignores stage background clicks during the initial 400ms mount grace window
 * so the tap opening Desk Mode from FocusView never leaks through to toggle the HUD.
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
 * Pure kinematic snapshot for the Smoked Obsidian Monolith sculpture.
 * `energy` smoothly interpolates between `1` (running) and `0` (paused) inside the render loop.
 */
export function computeMonolithMotion(
  phase: number,
  energy: number
): MonolithMotionSnapshot {
  const e = Math.max(0, Math.min(1, Number.isFinite(energy) ? energy : 0));
  const p = Number.isFinite(phase) ? phase : 0;

  const breath = 0.5 + 0.5 * Math.sin(p * 1.35);
  const corePulse = 0.92 + breath * (0.04 + 0.1 * e);

  return {
    rotX: 0.22 + Math.sin(p * 0.42) * (0.06 + 0.12 * e),
    rotY: p * 0.34,
    rotZ: -0.08 + Math.cos(p * 0.31) * (0.04 + 0.08 * e),
    coreRotY: -p * 0.62,
    corePulse,
    coreEmissiveIntensity: 0.24 + e * (0.72 + breath * 0.48),
    coreLightIntensity: 0.55 + e * (1.85 + breath * 0.95),
    coreHaloOpacity: 0.05 + e * (0.12 + breath * 0.08),
  };
}

/**
 * Pure kinematic transform for rib `index` of the 22-Rib Kinetic Wave sculpture.
 * Produces a smooth continuous sinusoidal wave propagating across the horizontal spine,
 * tapering gracefully near the ends and slowing to a serene drift when paused (`energy -> 0`).
 */
export function computeKineticWaveRibTransform(
  index: number,
  totalRibs: number,
  phase: number,
  energy: number
): KineticWaveRibTransform {
  const count = Math.max(1, Math.floor(totalRibs));
  const clampedIdx = Math.max(0, Math.min(count - 1, index));
  const e = Math.max(0, Math.min(1, Number.isFinite(energy) ? energy : 0));
  const p = Number.isFinite(phase) ? phase : 0;

  // Normalized -1 .. +1 position along the horizontal spine
  const u = count === 1 ? 0 : (clampedIdx / (count - 1)) * 2 - 1;
  const spineHalfWidth = 3.52;
  const x = u * spineHalfWidth;

  // Gentle architectural bell envelope so end ribs taper subtly
  const envelope = 0.72 + 0.28 * Math.cos(u * Math.PI * 0.46);

  // Traveling sinusoidal wave with continuous phase offset across all 22 ribs
  const waveArg = clampedIdx * 0.31 - p * 1.45;
  const secondaryArg = clampedIdx * 0.15 + p * 0.55;
  const ampScale = 0.34 + 0.66 * e;

  const rotX = Math.sin(waveArg) * 0.88 * ampScale + u * 0.18;
  const rotY = Math.cos(waveArg * 0.5) * 0.16 * ampScale;
  const rotZ = Math.sin(secondaryArg) * 0.04 * ampScale;
  const yOffset = Math.sin(waveArg + 0.55) * 0.16 * ampScale * envelope;
  const scaleY = envelope * (0.94 + 0.08 * Math.sin(waveArg) * ampScale);

  return { x, yOffset, rotX, rotY, rotZ, scaleY };
}

/**
 * Formats a Web Battery API level (0..1) into a clamped 0..100 integer percentage.
 */
export function formatBatteryPercent(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.max(0, Math.min(100, Math.round(level * 100)));
}
