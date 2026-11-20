export interface ParkedThought {
  id: string;
  text: string;
  createdAt: number;
  subjectId?: string;
  chapterId?: string;
}

export const PARKING_LOT_STORAGE_KEY = 'dh_parking_lot_v1';
const MAX_THOUGHT_LENGTH = 160;
const MAX_THOUGHTS = 40;

interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

function getSafeStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // ignore
  }
  return null;
}

export function loadParkedThoughts(storage?: StorageLike): ParkedThought[] {
  const store = getSafeStorage(storage);
  if (!store) return [];
  try {
    const raw = store.getItem(PARKING_LOT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is ParkedThought =>
          Boolean(
            item &&
              typeof item === 'object' &&
              typeof item.id === 'string' &&
              typeof item.text === 'string' &&
              item.text.trim().length > 0
          )
      )
      .slice(0, MAX_THOUGHTS);
  } catch {
    return [];
  }
}

export function saveParkedThoughts(
  thoughts: ParkedThought[],
  storage?: StorageLike
): void {
  const store = getSafeStorage(storage);
  if (!store) return;
  try {
    if (thoughts.length === 0) {
      store.removeItem(PARKING_LOT_STORAGE_KEY);
    } else {
      store.setItem(
        PARKING_LOT_STORAGE_KEY,
        JSON.stringify(thoughts.slice(0, MAX_THOUGHTS))
      );
    }
  } catch {
    // ignore storage errors
  }
}

export function addParkedThought(
  thoughts: ParkedThought[],
  rawText: string,
  meta?: { subjectId?: string; chapterId?: string; now?: number }
): { next: ParkedThought[]; added: ParkedThought | null } {
  const clean = rawText.replace(/\s+/g, ' ').trim().slice(0, MAX_THOUGHT_LENGTH);
  if (!clean) return { next: thoughts, added: null };

  const now = meta?.now ?? Date.now();
  const added: ParkedThought = {
    id: `park_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    text: clean,
    createdAt: now,
    ...(meta?.subjectId ? { subjectId: meta.subjectId } : {}),
    ...(meta?.chapterId ? { chapterId: meta.chapterId } : {}),
  };

  const next = [...thoughts, added].slice(-MAX_THOUGHTS);
  return { next, added };
}

export function removeParkedThought(
  thoughts: ParkedThought[],
  id: string
): ParkedThought[] {
  return thoughts.filter((t) => t.id !== id);
}

export function clearParkedThoughts(): ParkedThought[] {
  return [];
}

export function buildTaskPayloadFromThought(
  thought: ParkedThought,
  todayKey: string,
  fallbackSubjectId?: string
): { title: string; dayKey: string; subjectId?: string } {
  return {
    title: thought.text.trim().slice(0, 140),
    dayKey: todayKey,
    subjectId: thought.subjectId || fallbackSubjectId || undefined,
  };
}
