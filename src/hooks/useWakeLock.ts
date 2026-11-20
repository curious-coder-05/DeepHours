import { useEffect, useState } from 'react';

/**
 * Module-level ref-counted WakeLock coordinator so multiple consumers
 * (running focus timer + StandByDeskOverlay) never fight over duplicate sentinels
 * and release cleanly as soon as the last active consumer unmounts or deactivates.
 */
let activeConsumerCount = 0;
let sharedSentinel: WakeLockSentinel | null = null;
let acquiring = false;
const statusListeners = new Set<() => void>();

function notifyListeners(): void {
  for (const fn of statusListeners) {
    fn();
  }
}

function isWakeLockSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'wakeLock' in navigator &&
    typeof navigator.wakeLock?.request === 'function'
  );
}

async function acquireSharedWakeLock(): Promise<void> {
  if (
    !isWakeLockSupported() ||
    activeConsumerCount <= 0 ||
    sharedSentinel ||
    acquiring ||
    (typeof document !== 'undefined' && document.visibilityState !== 'visible')
  ) {
    return;
  }
  acquiring = true;
  try {
    const sentinel = await navigator.wakeLock.request('screen');
    // If all consumers deactivated while awaiting request, release immediately
    if (activeConsumerCount <= 0) {
      try {
        await sentinel.release();
      } catch {
        // ignore release error
      }
      return;
    }
    sharedSentinel = sentinel;
    sentinel.addEventListener('release', () => {
      if (sharedSentinel === sentinel) {
        sharedSentinel = null;
        notifyListeners();
      }
    });
    notifyListeners();
  } catch {
    // Graceful silent fallback when blocked by mobile browser / iframe policy
  } finally {
    acquiring = false;
  }
}

async function releaseSharedWakeLock(): Promise<void> {
  const sentinel = sharedSentinel;
  sharedSentinel = null;
  if (sentinel) {
    try {
      await sentinel.release();
    } catch {
      // ignore release errors
    }
    notifyListeners();
  }
}

let visListenerAttached = false;
function handleVisibilityChange(): void {
  if (
    typeof document !== 'undefined' &&
    document.visibilityState === 'visible' &&
    activeConsumerCount > 0
  ) {
    void acquireSharedWakeLock();
  }
}

function attachVisibilityListener(): void {
  if (visListenerAttached || typeof document === 'undefined') return;
  visListenerAttached = true;
  document.addEventListener('visibilitychange', handleVisibilityChange);
}

function detachVisibilityListenerIfIdle(): void {
  if (!visListenerAttached || activeConsumerCount > 0 || typeof document === 'undefined') {
    return;
  }
  visListenerAttached = false;
  document.removeEventListener('visibilitychange', handleVisibilityChange);
}

export interface WakeLockStatus {
  isSupported: boolean;
  isActive: boolean;
}

/**
 * Keeps the screen awake via the Screen Wake Lock API while `active` is true.
 * Automatically re-acquires on `visibilitychange` and releases cleanly on unmount/exit.
 */
export function useWakeLock(active: boolean): WakeLockStatus {
  const [isActive, setIsActive] = useState<boolean>(() => Boolean(sharedSentinel));
  const supported = isWakeLockSupported();

  useEffect(() => {
    const sync = () => setIsActive(Boolean(sharedSentinel));
    statusListeners.add(sync);
    sync();
    return () => {
      statusListeners.delete(sync);
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    activeConsumerCount += 1;
    attachVisibilityListener();
    void acquireSharedWakeLock();

    return () => {
      activeConsumerCount = Math.max(0, activeConsumerCount - 1);
      if (activeConsumerCount === 0) {
        detachVisibilityListenerIfIdle();
        void releaseSharedWakeLock();
      }
    };
  }, [active]);

  return {
    isSupported: supported,
    isActive,
  };
}

/**
 * Requests browser fullscreen for StandBy Desk Mode with graceful silent fallback
 * when blocked by mobile browser or iframe policy.
 */
export async function requestDeskFullscreen(): Promise<boolean> {
  try {
    if (typeof document === 'undefined') return false;
    if (document.fullscreenElement) return true;
    const el = document.documentElement;
    if (typeof el.requestFullscreen === 'function') {
      await el.requestFullscreen();
      return true;
    }
  } catch {
    // Graceful silent fallback when policy blocks fullscreen
  }
  return false;
}

/**
 * Exits fullscreen cleanly if currently active. Never throws.
 */
export async function exitDeskFullscreen(): Promise<void> {
  try {
    if (
      typeof document !== 'undefined' &&
      document.fullscreenElement &&
      typeof document.exitFullscreen === 'function'
    ) {
      await document.exitFullscreen();
    }
  } catch {
    // ignore fullscreen exit errors
  }
}
