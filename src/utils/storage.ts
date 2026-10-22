import type { PulseHabitState } from '../types';
import { norm } from './studyLogic';

const idbPromise: Promise<IDBDatabase> | null =
  typeof indexedDB !== 'undefined'
    ? new Promise((resolve, reject) => {
        const req = indexedDB.open('deephours', 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains('kv')) {
            req.result.createObjectStore('kv');
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
    : null;

export function kv(mode: 'get' | 'put', key: string, val?: unknown): Promise<unknown> {
  if (!idbPromise) return Promise.reject(new Error('IndexedDB unavailable'));
  return idbPromise.then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction('kv', mode === 'get' ? 'readonly' : 'readwrite');
        const store = tx.objectStore('kv');
        const req = mode === 'get' ? store.get(key) : store.put(val, key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

function readLegacyPulseHabitIdb(key: string): Promise<unknown> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open('pulsehabit');
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        const db = req.result;
        const storeName = db.objectStoreNames.contains('kv')
          ? 'kv'
          : db.objectStoreNames.contains('pulsehabit')
            ? 'pulsehabit'
            : null;
        if (!storeName) {
          db.close();
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

export async function loadInitialState(): Promise<PulseHabitState> {
  let raw: unknown = null;
  let migratedFromLegacyOrLs = false;

  try {
    raw = await kv('get', 's');
  } catch {
    // fallback below
  }

  if (!raw) {
    try {
      raw = await readLegacyPulseHabitIdb('s');
      if (raw) migratedFromLegacyOrLs = true;
    } catch {
      // ignore legacy IDB errors
    }
  }

  if (!raw) {
    try {
      const ls =
        typeof localStorage !== 'undefined'
          ? localStorage.getItem('dh') || localStorage.getItem('ph')
          : null;
      if (ls) {
        raw = JSON.parse(ls);
        migratedFromLegacyOrLs = true;
      }
    } catch {
      // ignore parse errors
    }
  }

  const state = norm(raw);
  if (migratedFromLegacyOrLs) {
    try {
      await kv('put', 's', state);
      if (typeof localStorage !== 'undefined') {
        const serialized = JSON.stringify(state);
        localStorage.setItem('dh', serialized);
        localStorage.setItem('ph', serialized);
      }
    } catch {
      // ignore write errors
    }
  }
  return state;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
const bc =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('deephours') : null;

export function persistState(state: PulseHabitState, onSaved?: () => void): void {
  try {
    if (typeof localStorage !== 'undefined') {
      const serialized = JSON.stringify(state);
      localStorage.setItem('dh', serialized);
      localStorage.setItem('ph', serialized);
    }
  } catch {
    // ignore quota errors
  }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await kv('put', 's', state);
    } catch {
      // fallback already written to localStorage
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
