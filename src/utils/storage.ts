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

export async function loadInitialState(): Promise<PulseHabitState> {
  let raw: unknown = null;
  try {
    raw = await kv('get', 's');
  } catch {
    // fallback to localStorage
  }
  if (!raw) {
    try {
      const ls = localStorage.getItem('dh') || localStorage.getItem('ph');
      if (ls) raw = JSON.parse(ls);
    } catch {
      // ignore parse errors
    }
  }
  return norm(raw);
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
const bc =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('deephours') : null;

export function persistState(state: PulseHabitState, onSaved?: () => void): void {
  try {
    const serialized = JSON.stringify(state);
    localStorage.setItem('dh', serialized);
    localStorage.setItem('ph', serialized);
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
