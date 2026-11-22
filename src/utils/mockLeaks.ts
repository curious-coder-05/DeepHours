import type { MockTest } from '../types';
import {
  isDangerousKey,
  safeJsonParse,
  safeLocalStorageSet,
} from './security.ts';

export const MOCK_LEAKS_STORAGE_KEY = 'dh_mock_leaks_v1';
export const NEET_MARKS_PER_WRONG_SWING = 5; // +4 marks lost + -1 negative penalty = -5 net marks
export const MAX_AGGREGATED_TAGGED_MOCKS = 5;

export type MockLeakCategoryKey = 'misread' | 'formula' | 'timePanic' | 'concept';

export interface MockLeakCategoryMeta {
  key: MockLeakCategoryKey;
  label: string;
  shortLabel: string;
  accent: 'crimson' | 'amber';
  barColor: string;
}

export const MOCK_LEAK_CATEGORIES: readonly MockLeakCategoryMeta[] = [
  {
    key: 'misread',
    label: 'Misread Question',
    shortLabel: 'Misread',
    accent: 'crimson',
    barColor: '#F43F5E',
  },
  {
    key: 'formula',
    label: 'Formula Blank',
    shortLabel: 'Formula',
    accent: 'amber',
    barColor: '#F59E0B',
  },
  {
    key: 'timePanic',
    label: 'Time Panic',
    shortLabel: 'Time panic',
    accent: 'crimson',
    barColor: '#FB7185',
  },
  {
    key: 'concept',
    label: 'Concept Gap',
    shortLabel: 'Concept gap',
    accent: 'amber',
    barColor: '#FBBF24',
  },
] as const;

export interface MockLeakCounts {
  misread: number;
  formula: number;
  timePanic: number;
  concept: number;
}

export interface MockLeakRecord {
  counts: MockLeakCounts;
  updatedAt: number;
}

export type MockLeakMap = Record<string, MockLeakRecord>;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface LeakCategorySummary {
  key: MockLeakCategoryKey;
  label: string;
  shortLabel: string;
  count: number;
  netMarksLost: number;
  sharePct: number;
  barColor: string;
  accent: 'crimson' | 'amber';
}

export interface AvoidableBleedSummary {
  taggedMocksCount: number;
  includedMocksCount: number;
  totalErrors: number;
  totalNetMarksLost: number;
  avgErrorsPerMock: number;
  avgMarksLostPerMock: number;
  topLeak: LeakCategorySummary | null;
  categories: LeakCategorySummary[];
}

export function createEmptyMockLeaks(): MockLeakCounts {
  return {
    misread: 0,
    formula: 0,
    timePanic: 0,
    concept: 0,
  };
}

export function clampLeakCount(val: unknown): number {
  const n = Math.round(Number(val));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(200, n);
}

export function normalizeMockLeakCounts(raw: unknown): MockLeakCounts {
  if (!raw || typeof raw !== 'object') return createEmptyMockLeaks();
  const obj = raw as Record<string, unknown>;
  return {
    misread: clampLeakCount(obj.misread),
    formula: clampLeakCount(obj.formula),
    timePanic: clampLeakCount(obj.timePanic),
    concept: clampLeakCount(obj.concept),
  };
}

export function getTotalLeakErrors(counts?: Partial<MockLeakCounts> | null): number {
  if (!counts) return 0;
  return (
    clampLeakCount(counts.misread) +
    clampLeakCount(counts.formula) +
    clampLeakCount(counts.timePanic) +
    clampLeakCount(counts.concept)
  );
}

export function hasAnyMockLeaks(counts?: Partial<MockLeakCounts> | null): boolean {
  return getTotalLeakErrors(counts) > 0;
}

export function computeNetMarksBleed(errorCount: number): number {
  return clampLeakCount(errorCount) * NEET_MARKS_PER_WRONG_SWING;
}

function getDefaultStorage(): StorageLike | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // ignore storage restriction
  }
  return null;
}

export function loadAllMockLeaks(
  storage: StorageLike | null = getDefaultStorage()
): MockLeakMap {
  if (!storage) return {};
  try {
    const raw = storage.getItem(MOCK_LEAKS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = safeJsonParse<unknown>(raw, null);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const out: MockLeakMap = {};
    for (const [mockId, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (!mockId.trim() || isDangerousKey(mockId) || !entry || typeof entry !== 'object') continue;
      const rec = entry as Record<string, unknown>;
      const counts = normalizeMockLeakCounts(rec.counts ?? rec);
      if (hasAnyMockLeaks(counts)) {
        out[mockId] = {
          counts,
          updatedAt: Number.isFinite(Number(rec.updatedAt)) ? Number(rec.updatedAt) : 0,
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function getMockLeaks(
  mockId: string,
  storage: StorageLike | null = getDefaultStorage()
): MockLeakCounts {
  const all = loadAllMockLeaks(storage);
  return all[mockId]?.counts
    ? normalizeMockLeakCounts(all[mockId].counts)
    : createEmptyMockLeaks();
}

export function saveMockLeaks(
  mockId: string,
  counts: MockLeakCounts,
  storage: StorageLike | null = getDefaultStorage()
): MockLeakCounts {
  const normalized = normalizeMockLeakCounts(counts);
  if (!mockId || !storage || isDangerousKey(mockId)) return normalized;
  const all = loadAllMockLeaks(storage);
  if (hasAnyMockLeaks(normalized)) {
    all[mockId] = {
      counts: normalized,
      updatedAt: Date.now(),
    };
  } else {
    delete all[mockId];
  }
  safeLocalStorageSet(MOCK_LEAKS_STORAGE_KEY, JSON.stringify(all), storage);
  return normalized;
}

export function deleteMockLeaks(
  mockId: string,
  storage: StorageLike | null = getDefaultStorage()
): void {
  if (!mockId || !storage || isDangerousKey(mockId)) return;
  const all = loadAllMockLeaks(storage);
  if (mockId in all) {
    delete all[mockId];
    safeLocalStorageSet(MOCK_LEAKS_STORAGE_KEY, JSON.stringify(all), storage);
  }
}

/**
 * Aggregates negative-marking leak tags across the most recent `limit` (default 5)
 * tagged mocks. Each wrong question represents -5 net NEET marks (+4 lost + -1 penalty).
 */
export function aggregateAvoidableBleed(
  mocks: readonly MockTest[],
  leakMap: MockLeakMap,
  limit = MAX_AGGREGATED_TAGGED_MOCKS
): AvoidableBleedSummary {
  const sortedNewest = mocks
    .slice()
    .sort((a, b) => {
      if (b.dayKey !== a.dayKey) return b.dayKey.localeCompare(a.dayKey);
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });

  const taggedMocks = sortedNewest.filter((m) => hasAnyMockLeaks(leakMap[m.id]?.counts));
  const included = taggedMocks.slice(0, Math.max(1, limit));

  const totals = createEmptyMockLeaks();
  for (const m of included) {
    const rec = leakMap[m.id];
    if (!rec) continue;
    totals.misread += clampLeakCount(rec.counts.misread);
    totals.formula += clampLeakCount(rec.counts.formula);
    totals.timePanic += clampLeakCount(rec.counts.timePanic);
    totals.concept += clampLeakCount(rec.counts.concept);
  }

  const totalErrors = getTotalLeakErrors(totals);
  const totalNetMarksLost = totalErrors * NEET_MARKS_PER_WRONG_SWING;

  const categories: LeakCategorySummary[] = MOCK_LEAK_CATEGORIES.map((meta) => {
    const count = totals[meta.key];
    const netMarksLost = count * NEET_MARKS_PER_WRONG_SWING;
    const sharePct = totalErrors > 0 ? Math.round((count / totalErrors) * 100) : 0;
    return {
      key: meta.key,
      label: meta.label,
      shortLabel: meta.shortLabel,
      count,
      netMarksLost,
      sharePct,
      barColor: meta.barColor,
      accent: meta.accent,
    };
  }).sort((a, b) => b.count - a.count);

  const topLeak = totalErrors > 0 ? categories[0] : null;
  const includedCount = included.length;

  return {
    taggedMocksCount: taggedMocks.length,
    includedMocksCount: includedCount,
    totalErrors,
    totalNetMarksLost,
    avgErrorsPerMock: includedCount > 0 ? Math.round(totalErrors / includedCount) : 0,
    avgMarksLostPerMock:
      includedCount > 0 ? Math.round(totalNetMarksLost / includedCount) : 0,
    topLeak,
    categories,
  };
}
