import type { MockTest, Subject } from '../types';

export const MOCK_DIAGNOSTICS_STORAGE_KEY = 'dh_mock_diagnostics_v1';

export type BleedingCategory = 'silly' | 'ncert' | 'concept' | 'time';

export interface MockBleedingTally {
  silly: number;
  ncert: number;
  concept: number;
  time: number;
}

export interface MockDiagnosticsEntry {
  bleeding: MockBleedingTally;
  subjectMinutes: Record<string, number>;
  updatedAt?: number;
}

export type MockDiagnosticsMap = Record<string, MockDiagnosticsEntry>;

export interface CleanScoreResult {
  cleanScore: number;
  recoverableMarks: number;
  totalLostQuestions: number;
}

export interface SubjectPacingAverage {
  subjectId: string;
  totalMinutes: number;
  timedMockCount: number;
  avgMinutes: number;
}

export interface AggregatedMockDiagnostics {
  mocksWithDiagnosticsCount: number;
  timedMocksCount: number;
  totalLostQuestions: number;
  totalLostMarks: number;
  totalRecoverableMarks: number;
  bleedingCounts: MockBleedingTally;
  bleedingMarks: MockBleedingTally;
  subjectPacing: Record<string, SubjectPacingAverage>;
}

export interface BleedingCategoryMeta {
  key: BleedingCategory;
  label: string;
  recoverable: boolean;
  color: string;
}

export const BLEEDING_CATEGORIES: ReadonlyArray<BleedingCategoryMeta> = [
  { key: 'silly', label: 'Silly / Calc', recoverable: true, color: 'var(--warn)' },
  { key: 'ncert', label: 'NCERT Line', recoverable: true, color: 'var(--ac)' },
  { key: 'concept', label: 'Concept Gap', recoverable: false, color: 'var(--err)' },
  { key: 'time', label: 'Time Panic', recoverable: true, color: 'var(--info)' },
];

export const createEmptyBleedingTally = (): MockBleedingTally => ({
  silly: 0,
  ncert: 0,
  concept: 0,
  time: 0,
});

export const createEmptyMockDiagnosticsEntry = (): MockDiagnosticsEntry => ({
  bleeding: createEmptyBleedingTally(),
  subjectMinutes: {},
});

function clampCount(raw: unknown): number {
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.min(200, Math.floor(num));
}

function clampMinutes(raw: unknown): number {
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.min(600, Math.round(num));
}

export function normalizeBleedingTally(
  raw?: Partial<MockBleedingTally> | null
): MockBleedingTally {
  return {
    silly: clampCount(raw?.silly),
    ncert: clampCount(raw?.ncert),
    concept: clampCount(raw?.concept),
    time: clampCount(raw?.time),
  };
}

export function normalizeSubjectMinutes(
  raw?: Record<string, unknown> | null
): Record<string, number> {
  if (!raw || typeof raw !== 'object') return {};
  const next: Record<string, number> = {};
  for (const [subId, val] of Object.entries(raw)) {
    if (!subId) continue;
    const mins = clampMinutes(val);
    if (mins > 0) {
      next[subId] = mins;
    }
  }
  return next;
}

export function normalizeMockDiagnostic(
  raw?: Partial<MockDiagnosticsEntry> | null
): MockDiagnosticsEntry {
  const updatedAt =
    typeof raw?.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
      ? raw.updatedAt
      : undefined;
  return {
    bleeding: normalizeBleedingTally(raw?.bleeding),
    subjectMinutes: normalizeSubjectMinutes(raw?.subjectMinutes),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
  };
}

export function hasBleedingEntries(bleeding?: Partial<MockBleedingTally> | null): boolean {
  if (!bleeding) return false;
  const norm = normalizeBleedingTally(bleeding);
  return norm.silly + norm.ncert + norm.concept + norm.time > 0;
}

export function hasSubjectMinutesEntries(
  subjectMinutes?: Record<string, unknown> | null
): boolean {
  if (!subjectMinutes) return false;
  return Object.keys(normalizeSubjectMinutes(subjectMinutes)).length > 0;
}

export function hasMockDiagnostics(entry?: Partial<MockDiagnosticsEntry> | null): boolean {
  if (!entry) return false;
  return (
    hasBleedingEntries(entry.bleeding) ||
    hasSubjectMinutesEntries(entry.subjectMinutes)
  );
}

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

function resolveStorage(custom?: StorageLike | null): StorageLike | null {
  if (custom) return custom;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

export function loadAllMockDiagnostics(
  storage?: StorageLike | null
): MockDiagnosticsMap {
  const store = resolveStorage(storage);
  if (!store) return {};
  try {
    const raw = store.getItem(MOCK_DIAGNOSTICS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const clean: MockDiagnosticsMap = {};
    for (const [mockId, entry] of Object.entries(parsed)) {
      if (!mockId || !entry || typeof entry !== 'object') continue;
      const normalized = normalizeMockDiagnostic(entry as Partial<MockDiagnosticsEntry>);
      if (hasMockDiagnostics(normalized)) {
        clean[mockId] = normalized;
      }
    }
    return clean;
  } catch {
    return {};
  }
}

function writeAllMockDiagnostics(
  map: MockDiagnosticsMap,
  storage?: StorageLike | null
): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    const keys = Object.keys(map);
    if (keys.length === 0) {
      store.removeItem(MOCK_DIAGNOSTICS_STORAGE_KEY);
    } else {
      store.setItem(MOCK_DIAGNOSTICS_STORAGE_KEY, JSON.stringify(map));
    }
  } catch {
    // ignore storage quota / privacy mode errors
  }
}

export function getMockDiagnostic(
  mockId: string,
  storage?: StorageLike | null
): MockDiagnosticsEntry | null {
  if (!mockId) return null;
  const all = loadAllMockDiagnostics(storage);
  return all[mockId] || null;
}

export function saveMockDiagnostic(
  mockId: string,
  entry: Partial<MockDiagnosticsEntry>,
  storage?: StorageLike | null
): MockDiagnosticsMap {
  if (!mockId) return loadAllMockDiagnostics(storage);
  const all = loadAllMockDiagnostics(storage);
  const normalized = normalizeMockDiagnostic({
    ...entry,
    updatedAt: Date.now(),
  });
  if (!hasMockDiagnostics(normalized)) {
    delete all[mockId];
  } else {
    all[mockId] = normalized;
  }
  writeAllMockDiagnostics(all, storage);
  return all;
}

export function deleteMockDiagnostic(
  mockId: string,
  storage?: StorageLike | null
): MockDiagnosticsMap {
  if (!mockId) return loadAllMockDiagnostics(storage);
  const all = loadAllMockDiagnostics(storage);
  if (mockId in all) {
    delete all[mockId];
    writeAllMockDiagnostics(all, storage);
  }
  return all;
}

export function replaceAllMockDiagnostics(
  map: MockDiagnosticsMap,
  storage?: StorageLike | null
): void {
  writeAllMockDiagnostics(map, storage);
}

export function clearAllMockDiagnostics(storage?: StorageLike | null): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.removeItem(MOCK_DIAGNOSTICS_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function computeCleanScore(
  actualScore: number,
  maxScore: number,
  bleeding?: Partial<MockBleedingTally> | null
): CleanScoreResult {
  const safeActual = Number.isFinite(actualScore) ? Math.round(actualScore) : 0;
  const safeMax = Number.isFinite(maxScore) && maxScore > 0 ? Math.round(maxScore) : 0;
  const norm = normalizeBleedingTally(bleeding);
  const totalLostQuestions = norm.silly + norm.ncert + norm.concept + norm.time;
  const recoverableQuestions = norm.silly + norm.ncert + norm.time;
  const rawRecoverable = recoverableQuestions * 5;

  if (safeMax > 0) {
    const cleanScore = Math.min(safeMax, safeActual + rawRecoverable);
    const recoverableMarks = Math.max(0, cleanScore - safeActual);
    return {
      cleanScore,
      recoverableMarks,
      totalLostQuestions,
    };
  }

  return {
    cleanScore: safeActual + rawRecoverable,
    recoverableMarks: rawRecoverable,
    totalLostQuestions,
  };
}

export function aggregateMockDiagnostics(
  mocks: MockTest[],
  diagnosticsMap: MockDiagnosticsMap
): AggregatedMockDiagnostics {
  const bleedingCounts = createEmptyBleedingTally();
  const pacingTotals: Record<string, { totalMinutes: number; timedMockCount: number }> = {};

  let mocksWithDiagnosticsCount = 0;
  let timedMocksCount = 0;

  for (const mock of mocks) {
    const entry = diagnosticsMap[mock.id];
    if (!entry || !hasMockDiagnostics(entry)) continue;

    const norm = normalizeMockDiagnostic(entry);
    mocksWithDiagnosticsCount += 1;

    bleedingCounts.silly += norm.bleeding.silly;
    bleedingCounts.ncert += norm.bleeding.ncert;
    bleedingCounts.concept += norm.bleeding.concept;
    bleedingCounts.time += norm.bleeding.time;

    const splitEntries = Object.entries(norm.subjectMinutes).filter(
      ([, mins]) => mins > 0
    );
    if (splitEntries.length > 0) {
      timedMocksCount += 1;
      for (const [subId, mins] of splitEntries) {
        if (!pacingTotals[subId]) {
          pacingTotals[subId] = { totalMinutes: 0, timedMockCount: 0 };
        }
        pacingTotals[subId].totalMinutes += mins;
        pacingTotals[subId].timedMockCount += 1;
      }
    }
  }

  const bleedingMarks: MockBleedingTally = {
    silly: bleedingCounts.silly * 5,
    ncert: bleedingCounts.ncert * 5,
    concept: bleedingCounts.concept * 5,
    time: bleedingCounts.time * 5,
  };

  const totalLostQuestions =
    bleedingCounts.silly +
    bleedingCounts.ncert +
    bleedingCounts.concept +
    bleedingCounts.time;
  const totalLostMarks = totalLostQuestions * 5;
  const totalRecoverableMarks =
    bleedingMarks.silly + bleedingMarks.ncert + bleedingMarks.time;

  const subjectPacing: Record<string, SubjectPacingAverage> = {};
  for (const [subId, acc] of Object.entries(pacingTotals)) {
    subjectPacing[subId] = {
      subjectId: subId,
      totalMinutes: acc.totalMinutes,
      timedMockCount: acc.timedMockCount,
      avgMinutes: Math.round(acc.totalMinutes / acc.timedMockCount),
    };
  }

  return {
    mocksWithDiagnosticsCount,
    timedMocksCount,
    totalLostQuestions,
    totalLostMarks,
    totalRecoverableMarks,
    bleedingCounts,
    bleedingMarks,
    subjectPacing,
  };
}

export function shortSubjectLabel(name: string): string {
  const lower = name.trim().toLowerCase();
  if (lower.startsWith('phys')) return 'Phy';
  if (lower.startsWith('chem')) return 'Chem';
  if (lower.startsWith('biol')) return 'Bio';
  if (lower.startsWith('botan')) return 'Bot';
  if (lower.startsWith('zool')) return 'Zoo';
  return name.trim().slice(0, 4) || 'Sub';
}

export function formatSubjectTimeSummary(
  subjectMinutes: Record<string, number>,
  subjects: Subject[]
): string {
  const parts: string[] = [];
  const seen = new Set<string>();

  for (const sub of subjects) {
    const mins = subjectMinutes[sub.id];
    if (typeof mins === 'number' && mins > 0) {
      parts.push(`${shortSubjectLabel(sub.name)} ${mins}m`);
      seen.add(sub.id);
    }
  }

  for (const [subId, mins] of Object.entries(subjectMinutes)) {
    if (seen.has(subId) || !(mins > 0)) continue;
    parts.push(`${subId} ${mins}m`);
  }

  return parts.join(' · ');
}
