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

let fullscreenRequestPending = false;

/**
 * Requests browser fullscreen for StandBy Desk Mode ONCE inside an explicit user click.
 * Uses `{ navigationUI: 'hide' }` with graceful fallback when blocked by mobile/iframe policy.
 */
export async function requestDeskFullscreen(): Promise<boolean> {
  if (fullscreenRequestPending) return false;
  try {
    if (typeof document === 'undefined') return false;
    if (document.fullscreenElement) return true;
    const el = document.documentElement;
    if (typeof el.requestFullscreen === 'function') {
      fullscreenRequestPending = true;
      try {
        await el.requestFullscreen({ navigationUI: 'hide' });
        return true;
      } catch {
        try {
          await el.requestFullscreen();
          return true;
        } catch {
          return false;
        }
      } finally {
        fullscreenRequestPending = false;
      }
    }
  } catch {
    fullscreenRequestPending = false;
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

/**
 * Attempts native Screen Orientation landscape lock. Returns false cleanly if rejected or unsupported.
 */
export async function lockLandscapeOrientation(): Promise<boolean> {
  try {
    const orient =
      typeof screen !== 'undefined'
        ? (screen.orientation as ScreenOrientation & {
            lock?: (orientation: string) => Promise<void>;
          })
        : undefined;
    if (orient && typeof orient.lock === 'function') {
      await orient.lock('landscape');
      return true;
    }
  } catch {
    // Graceful fallback to CSS Simulated Landscape Stage when OS auto-rotate/fullscreen blocks lock
  }
  return false;
}

/**
 * Unlocks screen orientation cleanly on Desk Mode exit. Never throws.
 */
export function unlockScreenOrientation(): void {
  try {
    const orient =
      typeof screen !== 'undefined'
        ? (screen.orientation as ScreenOrientation & { unlock?: () => void })
        : undefined;
    if (orient && typeof orient.unlock === 'function') {
      orient.unlock();
    }
  } catch {
    // ignore orientation unlock errors
  }
}

interface BatteryManagerLike extends EventTarget {
  level: number;
  charging: boolean;
}

export interface DeskBatteryStatus {
  level: number;
  charging: boolean;
}

/**
 * Feature-detected Web Battery Status hook (zero permissions, zero network calls).
 * Subscribes only while `active` is true and cleans up all listeners on unmount/close.
 */
export function useBatteryStatus(active: boolean): DeskBatteryStatus | null {
  const [battery, setBattery] = useState<DeskBatteryStatus | null>(null);

  useEffect(() => {
    if (!active || typeof navigator === 'undefined') {
      setBattery(null);
      return;
    }
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<BatteryManagerLike>;
    };
    if (typeof nav.getBattery !== 'function') {
      setBattery(null);
      return;
    }

    let cancelled = false;
    let manager: BatteryManagerLike | null = null;
    const sync = () => {
      if (cancelled || !manager) return;
      setBattery({
        level: Number.isFinite(manager.level) ? manager.level : 0,
        charging: Boolean(manager.charging),
      });
    };

    nav
      .getBattery()
      .then((bm) => {
        if (cancelled || !bm) return;
        manager = bm;
        sync();
        bm.addEventListener('levelchange', sync);
        bm.addEventListener('chargingchange', sync);
      })
      .catch(() => {
        if (!cancelled) setBattery(null);
      });

    return () => {
      cancelled = true;
      if (manager) {
        manager.removeEventListener('levelchange', sync);
        manager.removeEventListener('chargingchange', sync);
      }
    };
  }, [active]);

  return battery;
}

