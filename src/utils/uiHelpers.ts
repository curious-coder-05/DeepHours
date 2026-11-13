import type { DDay, PulseHabitState } from '../types.ts';
import { computePaceReport, type PaceReport } from './pace.ts';
import { ACS } from './studyLogic.ts';

export const LUMEN_ACCENT = '#F5C451';
export const LUMEN_ACCENT_ON = '#1A1400';
export const AMOLED_STORAGE_KEY = 'dh_amoled';

export interface AccentSwatch {
  hex: string;
  label: string;
}

export const UI_ACCENT_SWATCHES: AccentSwatch[] = [
  { hex: LUMEN_ACCENT, label: 'Lumen' },
  { hex: ACS[0], label: 'Sky' },
  { hex: ACS[1], label: 'Mint' },
  { hex: ACS[2], label: 'Indigo' },
  { hex: ACS[3], label: 'Violet' },
  { hex: ACS[4], label: 'Rose' },
  { hex: ACS[5], label: 'Amber' },
];

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = (hex || '').trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(clean)) {
    return {
      r: parseInt(clean[0] + clean[0], 16),
      g: parseInt(clean[1] + clean[1], 16),
      b: parseInt(clean[2] + clean[2], 16),
    };
  }
  if (/^[0-9a-fA-F]{6}$/.test(clean)) {
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16),
    };
  }
  return null;
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
}

export function contrastRatio(hexA: string, hexB: string): number {
  const l1 = relativeLuminance(hexA);
  const l2 = relativeLuminance(hexB);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Computes WCAG-compliant text color to render on top of a solid color fill.
 * On Lumen (#F5C451), returns #1A1400 (10.8:1).
 */
export function getReadableOnColor(bgHex: string): string {
  const darkInk = LUMEN_ACCENT_ON;
  const lightInk = '#FFFFFF';
  return contrastRatio(bgHex, darkInk) >= contrastRatio(bgHex, lightInk)
    ? darkInk
    : lightInk;
}

/**
 * Computes an AA-readable accent ink color for text/icons inside tinted chips
 * and subtle indicators against the active theme surface.
 */
export function getReadableAccentText(
  accentHex: string,
  themeMode: 'dark' | 'light'
): string {
  const rgb = hexToRgb(accentHex);
  if (!rgb) return themeMode === 'light' ? '#7A5400' : LUMEN_ACCENT;

  const surface = themeMode === 'light' ? '#EFECE5' : '#181C22';
  const targetRatio = 4.6;
  if (contrastRatio(accentHex, surface) >= targetRatio) {
    return accentHex;
  }

  let { r, g, b } = rgb;
  for (let step = 0; step < 32; step++) {
    if (themeMode === 'light') {
      r = Math.floor(r * 0.88);
      g = Math.floor(g * 0.88);
      b = Math.floor(b * 0.88);
    } else {
      r = Math.ceil(r + (255 - r) * 0.14);
      g = Math.ceil(g + (255 - g) * 0.14);
      b = Math.ceil(b + (255 - b) * 0.14);
    }
    const candidate = rgbToHex(r, g, b);
    if (contrastRatio(candidate, surface) >= targetRatio) {
      return candidate;
    }
  }
  return themeMode === 'light' ? '#5C3D00' : '#F8E3A3';
}

export function getAmoledPref(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(AMOLED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setAmoledPref(enabled: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(AMOLED_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // ignore storage errors
  }
}

/**
 * Selects the exam D-Day to highlight in Today and Syllabus Pace UI without
 * mutating pace.ts. Prefers an explicitly marked `primary: true` exam, then
 * falls back to the nearest upcoming D-Day (`date >= todayKey`), then the most
 * recent past D-Day.
 */
export function resolveUiExam(
  state: Pick<PulseHabitState, 'ddays'>,
  todayKey: string
): DDay | null {
  const list = state.ddays || [];
  if (list.length === 0) return null;
  const markedPrimary = list.find((d) => Boolean(d.primary));
  if (markedPrimary) return markedPrimary;

  const upcoming = list
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date) && d.date >= todayKey)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (upcoming.length > 0) return upcoming[0];

  const sortedPast = [...list].sort((a, b) => b.date.localeCompare(a.date));
  return sortedPast[0] || list[0];
}

/**
 * Computes PaceReport for UI components, ensuring an upcoming D-Day is picked
 * even when no D-Day has `primary: true` explicitly checked.
 */
export function computeUiPaceReport(
  state: PulseHabitState,
  todayKey: string
): PaceReport {
  const exam = resolveUiExam(state, todayKey);
  if (!exam || exam.primary) {
    return computePaceReport(state, todayKey);
  }
  const patchedState: PulseHabitState = {
    ...state,
    ddays: state.ddays.map((d) =>
      d.id === exam.id ? { ...d, primary: true } : d
    ),
  };
  return computePaceReport(patchedState, todayKey);
}

export function getTimerStyleDisplayLabel(
  aesthetic?: 'neon' | 'minimal' | 'retro'
): 'Digital' | 'Mono' | 'Analog' {
  if (aesthetic === 'minimal') return 'Mono';
  if (aesthetic === 'retro') return 'Analog';
  return 'Digital';
}

export const CHART_THEME = {
  gridStroke: 'rgba(255,255,255,0.08)',
  tickStyle: { fill: 'var(--tx-3)', fontSize: 12 },
  tooltipStyle: {
    backgroundColor: 'var(--sf-1)',
    border: '1px solid var(--line)',
    borderRadius: '12px',
    color: 'var(--tx)',
    fontSize: '12px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
  },
  barRadius: [6, 6, 0, 0] as [number, number, number, number],
  strokeWidth: 2,
};

export type Ui3dSetting = 'auto' | 'on' | 'off';
export type QualityTier = 'normal' | 'lite' | 'off';

export interface Ui3dEnvironmentProbe {
  ui3dSetting: Ui3dSetting;
  webgl2Supported: boolean;
  isSoftwareGl: boolean;
  prefersReducedMotion: boolean;
  saveData: boolean;
  hardwareConcurrency?: number;
  deviceMemory?: number;
  deskMode?: boolean;
}

export interface Ui3dResolution {
  enabled: boolean;
  tier: QualityTier;
  maxDpr: number;
  antialias: boolean;
  targetFps: number;
  particleBudget: number;
  isSoftwareGl: boolean;
  reason?: string;
}

/**
 * Pure, deterministic evaluator for 3D scene gating and quality tier selection.
 */
export function evaluateUi3dEligibility(probe: Ui3dEnvironmentProbe): Ui3dResolution {
  if (probe.deskMode) {
    return {
      enabled: false,
      tier: 'off',
      maxDpr: 1,
      antialias: false,
      targetFps: 0,
      particleBudget: 0,
      isSoftwareGl: probe.isSoftwareGl,
      reason: 'desk-mode',
    };
  }

  if (probe.ui3dSetting === 'off') {
    return {
      enabled: false,
      tier: 'off',
      maxDpr: 1,
      antialias: false,
      targetFps: 0,
      particleBudget: 0,
      isSoftwareGl: probe.isSoftwareGl,
      reason: 'user-off',
    };
  }

  if (!probe.webgl2Supported) {
    return {
      enabled: false,
      tier: 'off',
      maxDpr: 1,
      antialias: false,
      targetFps: 0,
      particleBudget: 0,
      isSoftwareGl: probe.isSoftwareGl,
      reason: 'no-webgl2',
    };
  }

  const lowCores =
    typeof probe.hardwareConcurrency === 'number' &&
    probe.hardwareConcurrency > 0 &&
    probe.hardwareConcurrency <= 2;
  const lowMemory =
    typeof probe.deviceMemory === 'number' &&
    probe.deviceMemory > 0 &&
    probe.deviceMemory <= 2;
  const isWeakHardware = lowCores || lowMemory || probe.isSoftwareGl;

  if (probe.ui3dSetting === 'auto') {
    if (probe.prefersReducedMotion) {
      return {
        enabled: false,
        tier: 'off',
        maxDpr: 1,
        antialias: false,
        targetFps: 0,
        particleBudget: 0,
        isSoftwareGl: probe.isSoftwareGl,
        reason: 'reduced-motion',
      };
    }
    if (probe.saveData) {
      return {
        enabled: false,
        tier: 'off',
        maxDpr: 1,
        antialias: false,
        targetFps: 0,
        particleBudget: 0,
        isSoftwareGl: probe.isSoftwareGl,
        reason: 'save-data',
      };
    }
    if (lowCores || lowMemory) {
      return {
        enabled: false,
        tier: 'off',
        maxDpr: 1,
        antialias: false,
        targetFps: 0,
        particleBudget: 0,
        isSoftwareGl: probe.isSoftwareGl,
        reason: 'low-hardware',
      };
    }
  }

  const tier: QualityTier =
    isWeakHardware || probe.prefersReducedMotion || probe.saveData ? 'lite' : 'normal';

  return {
    enabled: true,
    tier,
    maxDpr: tier === 'lite' ? 1 : 1.5,
    antialias: tier === 'normal' && !probe.isSoftwareGl,
    targetFps: tier === 'lite' ? 30 : 60,
    particleBudget: tier === 'lite' ? 200 : 600,
    isSoftwareGl: probe.isSoftwareGl,
  };
}

export interface WindowRangeResult {
  startIndex: number;
  endIndex: number;
  topSpacerPx: number;
  bottomSpacerPx: number;
}

/**
 * Pure sliding-window index and spacer calculator for lists exceeding 100 rows.
 */
export function computeWindowRange(params: {
  totalCount: number;
  containerTopPx: number;
  viewportHeightPx: number;
  estimatedRowHeightPx: number;
  measuredHeights?: ReadonlyMap<number, number>;
  overscan?: number;
}): WindowRangeResult {
  const {
    totalCount,
    containerTopPx,
    viewportHeightPx,
    estimatedRowHeightPx,
    measuredHeights,
    overscan = 16,
  } = params;

  if (totalCount <= 0) {
    return { startIndex: 0, endIndex: -1, topSpacerPx: 0, bottomSpacerPx: 0 };
  }

  const rowH = Math.max(24, estimatedRowHeightPx);
  const getH = (idx: number) => measuredHeights?.get(idx) ?? rowH;

  const visibleTopOffset = Math.max(0, -containerTopPx);
  const visibleBottomOffset = Math.max(0, viewportHeightPx - containerTopPx);

  let acc = 0;
  let firstVisible = 0;
  let lastVisible = totalCount - 1;
  let foundFirst = false;

  for (let i = 0; i < totalCount; i++) {
    const h = getH(i);
    if (!foundFirst && acc + h >= visibleTopOffset) {
      firstVisible = i;
      foundFirst = true;
    }
    if (acc <= visibleBottomOffset) {
      lastVisible = i;
    }
    acc += h;
  }

  const startIndex = Math.max(0, firstVisible - overscan);
  const endIndex = Math.min(totalCount - 1, Math.max(startIndex, lastVisible + overscan));

  let topSpacerPx = 0;
  for (let i = 0; i < startIndex; i++) {
    topSpacerPx += getH(i);
  }
  let bottomSpacerPx = 0;
  for (let i = endIndex + 1; i < totalCount; i++) {
    bottomSpacerPx += getH(i);
  }

  return {
    startIndex,
    endIndex,
    topSpacerPx,
    bottomSpacerPx,
  };
}

