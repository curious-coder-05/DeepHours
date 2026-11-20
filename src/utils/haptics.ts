export type HapticPattern = 'tap' | 'success' | 'stop' | 'overtime';

export interface HapticEnvironment {
  vibrate?: ((pattern: number | number[]) => boolean) | null;
  matchMedia?: ((query: string) => { matches: boolean }) | null;
}

const PATTERN_MS: Record<HapticPattern, number | number[]> = {
  tap: 8,
  success: [10, 24, 14],
  stop: 14,
  overtime: [30, 50, 30, 50, 45],
};

/**
 * Checks whether the user prefers reduced motion. Safe in SSR/Node environments.
 */
export function prefersReducedMotion(env?: HapticEnvironment): boolean {
  try {
    const mm =
      env && 'matchMedia' in env
        ? env.matchMedia
        : typeof window !== 'undefined' && typeof window.matchMedia === 'function'
          ? window.matchMedia.bind(window)
          : null;
    return Boolean(mm?.('(prefers-reduced-motion: reduce)')?.matches);
  } catch {
    return false;
  }
}

/**
 * Fires a tiny, safe haptic pulse when supported and reduced-motion is not active.
 * Never throws in unsupported browsers or restricted contexts.
 */
export function triggerHaptic(
  pattern: HapticPattern = 'tap',
  env?: HapticEnvironment
): boolean {
  if (prefersReducedMotion(env)) return false;
  try {
    const vibrateFn =
      env && 'vibrate' in env
        ? env.vibrate
        : typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
          ? navigator.vibrate.bind(navigator)
          : null;
    if (!vibrateFn) return false;
    const result = vibrateFn(PATTERN_MS[pattern]);
    return result !== false;
  } catch {
    return false;
  }
}
