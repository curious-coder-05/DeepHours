import type { PulseHabitState } from '../types';
import { logicalKey, norm } from './studyLogic';

export class StorageLoadError extends Error {
  constructor(message = 'Your saved data could not be loaded') {
    super(message);
    this.name = 'StorageLoadError';
  }
}

export interface DailyBackupSnapshot {
  dayKey: string;
  savedAt: number;
  state: PulseHabitState;
}

const idbPromise: Promise<IDBDatabase> | null =
  typeof indexedDB !== 'undefined'
    ? new Promise((resolve, reject) => {
        try {
          const req = indexedDB.open('deephours', 1);
          req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains('kv')) {
              req.result.createObjectStore('kv');
            }
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error || new Error('IndexedDB open error'));
        } catch (err) {
          reject(err);
        }
      })
    : null;

export function kv(mode: 'get' | 'put', key: string, val?: unknown): Promise<unknown> {
  if (!idbPromise) return Promise.reject(new Error('IndexedDB unavailable'));
  return idbPromise.then(
    (db) =>
      new Promise((resolve, reject) => {
        try {
          const tx = db.transaction('kv', mode === 'get' ? 'readonly' : 'readwrite');
          const store = tx.objectStore('kv');
          const req = mode === 'get' ? store.get(key) : store.put(val, key);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error || new Error('IndexedDB request error'));
        } catch (err) {
          reject(err);
        }
      })
  );
}

/**
 * Marks localStorage key "dh_seen" after any successful save so future loads
 * can distinguish a brand-new install from a device where data previously existed.
 */
function markDataSeen(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('dh_seen', '1');
    }
  } catch {
    // ignore localStorage access errors
  }
}

/**
 * F5: Legacy IndexedDB check must not create an empty "pulsehabit" database.
 * Check indexedDB.databases() when available, or open it and delete it again if it had no stores.
 */
async function readLegacyPulseHabitIdb(key: string): Promise<unknown> {
  if (typeof indexedDB === 'undefined') return null;

  const idbWithDatabases = indexedDB as IDBFactory & {
    databases?: () => Promise<Array<{ name?: string; version?: number }>>;
  };

  if (typeof idbWithDatabases.databases === 'function') {
    try {
      const dbList = await idbWithDatabases.databases();
      if (Array.isArray(dbList) && !dbList.some((d) => d && d.name === 'pulsehabit')) {
        return null;
      }
    } catch {
      // Fall through to open-and-check below if databases() fails
    }
  }

  return new Promise((resolve) => {
    try {
      let createdDuringOpen = false;
      const req = indexedDB.open('pulsehabit');
      req.onupgradeneeded = () => {
        createdDuringOpen = true;
      };
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        const db = req.result;
        const storeName = db.objectStoreNames.contains('kv')
          ? 'kv'
          : db.objectStoreNames.contains('pulsehabit')
            ? 'pulsehabit'
            : null;
        if (createdDuringOpen || db.objectStoreNames.length === 0 || !storeName) {
          db.close();
          try {
            indexedDB.deleteDatabase('pulsehabit');
          } catch {
            // ignore delete errors
          }
          resolve(null);
          return;
        }
        try {
          const tx = db.transaction(storeName, 'readonly');
          const store = tx.objectStore(storeName);
          const getReq = store.get(key);
          getReq.onsuccess = () => {
            const res = getReq.result ?? null;
            db.close();
            resolve(res);
          };
          getReq.onerror = () => {
            db.close();
            resolve(null);
          };
        } catch {
          db.close();
          resolve(null);
        }
      };
    } catch {
      resolve(null);
    }
  });
}

function isPlainStateRecord(val: unknown): val is Record<string, unknown> {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

function getSavedAt(val: unknown): number {
  if (!isPlainStateRecord(val)) return 0;
  const ts = Number(val.savedAt);
  return Number.isFinite(ts) && ts > 0 ? ts : 0;
}

let lastBackupDayKey: string | null = null;

async function readValidBackups(): Promise<DailyBackupSnapshot[]> {
  try {
    const rawBackups = await kv('get', 'backup');
    if (!Array.isArray(rawBackups)) return [];
    return rawBackups
      .filter(
        (b): b is DailyBackupSnapshot =>
          Boolean(b) &&
          typeof b === 'object' &&
          typeof (b as DailyBackupSnapshot).dayKey === 'string' &&
          isPlainStateRecord((b as DailyBackupSnapshot).state)
      )
      .sort((a, b) => b.savedAt - a.savedAt || b.dayKey.localeCompare(a.dayKey));
  } catch {
    return [];
  }
}

/**
 * F4: Keep an automatic rolling safety backup in IndexedDB key "backup":
 * the latest 3 daily snapshots, written at most once per day.
 */
async function maybeWriteDailyBackup(state: PulseHabitState): Promise<void> {
  try {
    const dayKey = logicalKey(new Date(), state.set?.dayResetHour ?? 4);
    if (lastBackupDayKey === dayKey) return;

    const existing = await readValidBackups();

    if (existing.some((b) => b.dayKey === dayKey)) {
      lastBackupDayKey = dayKey;
      return;
    }

    const snapshot: DailyBackupSnapshot = {
      dayKey,
      savedAt: state.savedAt || Date.now(),
      state: JSON.parse(JSON.stringify(state)),
    };

    const updated = [snapshot, ...existing]
      .sort((a, b) => b.dayKey.localeCompare(a.dayKey) || b.savedAt - a.savedAt)
      .slice(0, 3);

    await kv('put', 'backup', updated);
    lastBackupDayKey = dayKey;
  } catch {
    // ignore backup write errors
  }
}

export async function restoreFromLatestBackup(): Promise<PulseHabitState | null> {
  try {
    const valid = await readValidBackups();
    if (!valid.length) return null;

    const restored = norm({
      ...valid[0].state,
      savedAt: Date.now(),
    });
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('dh', JSON.stringify(restored));
        markDataSeen();
      }
    } catch {
      // ignore localStorage error
    }
    try {
      await kv('put', 's', restored);
      markDataSeen();
    } catch {
      // ignore IndexedDB error
    }
    return restored;
  } catch {
    return null;
  }
}

function isNonEmptySerializedPayload(str: string | null | undefined): str is string {
  if (typeof str !== 'string') return false;
  const trimmed = str.trim();
  return Boolean(trimmed && trimmed !== '{}' && trimmed !== 'null' && trimmed !== '""');
}

/**
 * Reads raw saved data for ErrorBoundary emergency download:
 * 1. IndexedDB key "s" first
 * 2. Latest IndexedDB "backup" snapshot second
 * 3. localStorage "dh", then "ph"
 * Never returns an empty "{}" string; returns null if nothing is found.
 */
export async function readRawSavedDataForDownload(): Promise<string | null> {
  // 1. Try IndexedDB key "s"
  try {
    const idbState = await kv('get', 's');
    if (typeof idbState === 'string' && isNonEmptySerializedPayload(idbState)) {
      return idbState;
    }
    if (isPlainStateRecord(idbState) && Object.keys(idbState).length > 0) {
      const serialized = JSON.stringify(idbState, null, 2);
      if (isNonEmptySerializedPayload(serialized)) {
        return serialized;
      }
    }
  } catch {
    // Fall through to backup
  }

  // 2. Try latest IndexedDB "backup" snapshot
  try {
    const validBackups = await readValidBackups();
    if (validBackups.length > 0) {
      const latestState = validBackups[0].state;
      if (isPlainStateRecord(latestState) && Object.keys(latestState).length > 0) {
        const serialized = JSON.stringify(latestState, null, 2);
        if (isNonEmptySerializedPayload(serialized)) {
          return serialized;
        }
      }
    }
  } catch {
    // Fall through to localStorage
  }

  // 3. Try localStorage "dh" then "ph"
  try {
    if (typeof localStorage !== 'undefined') {
      const dh = localStorage.getItem('dh');
      if (isNonEmptySerializedPayload(dh)) {
        return dh;
      }
      const ph = localStorage.getItem('ph');
      if (isNonEmptySerializedPayload(ph)) {
        return ph;
      }
    }
  } catch {
    // ignore localStorage read error
  }

  return null;
}

export async function loadInitialState(): Promise<PulseHabitState> {
  let idbRaw: unknown = null;
  let idbError = false;
  let idbHadEntry = false;
  let lsRaw: unknown = null;
  let lsError = false;
  let lsHadEntry = false;
  let seenFlag = false;
  let migratedFromLegacy = false;

  // 1. Read IndexedDB ('deephours' -> 'kv' -> 's')
  try {
    const val = await kv('get', 's');
    if (val !== undefined && val !== null) {
      idbHadEntry = true;
      if (isPlainStateRecord(val)) {
        idbRaw = val;
      } else {
        idbError = true;
      }
    }
  } catch {
    idbError = true;
  }

  // 2. Read localStorage ('dh' first, fallback to legacy 'ph' for migration, and check 'dh_seen')
  try {
    if (typeof localStorage !== 'undefined') {
      seenFlag = localStorage.getItem('dh_seen') !== null;
      const dhStr = localStorage.getItem('dh');
      const phStr = dhStr === null ? localStorage.getItem('ph') : null;
      const rawStr = dhStr ?? phStr;
      if (rawStr !== null) {
        lsHadEntry = true;
        const parsed = JSON.parse(rawStr);
        if (isPlainStateRecord(parsed)) {
          lsRaw = parsed;
          if (dhStr === null && phStr !== null) {
            migratedFromLegacy = true;
          }
        } else {
          lsError = true;
        }
      }
    }
  } catch {
    lsError = true;
  }

  // 3. If no valid state was loaded yet, check whether any rolling backup exists
  let hasBackup = false;
  if (!idbRaw && !lsRaw) {
    const backups = await readValidBackups();
    hasBackup = backups.length > 0;
  }

  const hasPriorDataEvidence =
    seenFlag || idbHadEntry || lsHadEntry || hasBackup;

  // F4 (Refined): Do NOT treat a brand-new install as a load failure.
  // Only throw StorageLoadError when no valid state could be loaded AND there is
  // evidence that data existed before (e.g. "dh_seen", an unreadable/corrupted entry, or a backup).
  if (!idbRaw && !lsRaw && hasPriorDataEvidence && (idbError || lsError || hasBackup)) {
    throw new StorageLoadError('Your saved data could not be loaded');
  }

  let chosenRaw: unknown = null;
  let needsResave = migratedFromLegacy;

  // F4: Compare IndexedDB vs localStorage by savedAt and use the newer one
  if (idbRaw && lsRaw) {
    const idbTs = getSavedAt(idbRaw);
    const lsTs = getSavedAt(lsRaw);
    if (lsTs > idbTs) {
      chosenRaw = lsRaw;
      needsResave = true;
    } else {
      chosenRaw = idbRaw;
      if (idbTs > lsTs) needsResave = true;
    }
  } else if (idbRaw) {
    chosenRaw = idbRaw;
  } else if (lsRaw) {
    chosenRaw = lsRaw;
    needsResave = true;
  } else {
    // Neither store had data: check legacy 'pulsehabit' IndexedDB without creating an empty DB (F5)
    try {
      const legacyVal = await readLegacyPulseHabitIdb('s');
      if (isPlainStateRecord(legacyVal)) {
        chosenRaw = legacyVal;
        needsResave = true;
      }
    } catch {
      // ignore legacy IDB error
    }
  }

  const state = norm(chosenRaw);
  if (chosenRaw && !state.savedAt) {
    state.savedAt = Date.now();
  }

  if (chosenRaw) {
    markDataSeen();
  }

  if (needsResave && chosenRaw) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('dh', JSON.stringify(state));
        markDataSeen();
      }
    } catch {
      // ignore localStorage write error
    }
    try {
      await kv('put', 's', state);
      markDataSeen();
      await maybeWriteDailyBackup(state);
    } catch {
      // ignore IndexedDB write error
    }
  } else if (chosenRaw) {
    void maybeWriteDailyBackup(state);
  }

  return state;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
const bc =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('deephours') : null;

export function persistState(state: PulseHabitState, onSaved?: () => void): void {
  const now = Date.now();
  state.savedAt = now;
  const stamped: PulseHabitState = {
    ...state,
    savedAt: now,
  };

  try {
    if (typeof localStorage !== 'undefined') {
      // F4: Write only localStorage key "dh" going forward + mark "dh_seen"
      localStorage.setItem('dh', JSON.stringify(stamped));
      markDataSeen();
    }
  } catch {
    // ignore quota errors
  }

  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await kv('put', 's', stamped);
      markDataSeen();
      await maybeWriteDailyBackup(stamped);
    } catch {
      // fallback already written to localStorage "dh"
    }
    bc?.postMessage(1);
    onSaved?.();
  }, 100);
}

export function subscribeBroadcast(onUpdate: (newState: PulseHabitState) => void): () => void {
  if (!bc) return () => {};
  const handler = async () => {
    try {
      const latest = await loadInitialState();
      onUpdate(latest);
    } catch {
      // ignore
    }
  };
  bc.addEventListener('message', handler);
  return () => bc.removeEventListener('message', handler);
}
