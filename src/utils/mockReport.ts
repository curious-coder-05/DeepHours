import type { MockSubjectScore, MockTest, Subject } from '../types';
import { computeMockScore, parseD } from './studyLogic';
import { getMockDiagnostic } from './mockDiagnostics';
import { isDangerousKey, safeJsonParse, safeLocalStorageSet } from './security.ts';

export const MOCK_REPORT_STORAGE_KEY = 'dh_mock_report_v1';
export const NEET_MAX_MARKS = 720;
export const NEET_TOTAL_QUESTIONS = 180;

export const NEET_SUBJECT_CAPS = {
  bio: 360,
  phy: 180,
  chem: 180,
} as const;

export const NEET_SUBJECT_MINS = {
  bio: -90,
  phy: -45,
  chem: -45,
} as const;

/**
 * Historical NEET UG 720-mark percentile anchor curve (descending by score).
 * Smooth monotonic piecewise-linear interpolation between anchors.
 */
export const NEET_PERCENTILE_CURVE: readonly (readonly [number, number])[] = [
  [720, 99.99],
  [705, 99.95],
  [690, 99.86],
  [670, 99.64],
  [650, 99.18],
  [620, 98.12],
  [600, 97.15],
  [560, 94.75],
  [520, 91.6],
  [480, 88.1],
  [420, 81.9],
  [360, 73.5],
  [300, 64.0],
  [200, 44.0],
  [100, 22.0],
  [0, 0.0],
] as const;

export type MockReportTier = 'emerald' | 'gold' | 'crimson';

export interface MockReportDetails {
  bioScore: number;
  phyScore: number;
  chemScore: number;
  correct: number;
  wrong: number;
  timeTakenMin: number;
  updatedAt?: number;
}

export type MockReportMap = Record<string, MockReportDetails>;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface MockPersonalRank {
  rank: number;
  totalMocks: number;
}

export interface ComputedMockReport {
  mockId: string;
  mockName: string;
  dayKey: string;
  formattedDate: string;
  hasSidecar: boolean;
  overallScore: number;
  maxMarks: number;
  bioScore: number;
  phyScore: number;
  chemScore: number;
  correct: number;
  wrong: number;
  attempted: number;
  unattempted: number;
  totalQuestions: number;
  accuracyPct: number;
  positiveScore: number;
  marksLost: number;
  netBleed: number;
  timeTakenMin: number;
  percentile: number;
  percentileFormatted: string;
  tier: MockReportTier;
  targetScore: number;
  personalRank: MockPersonalRank;
}

function clamp(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, val));
}

function toInt(val: unknown, fallback = 0): number {
  const n = Math.round(Number(val));
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeMockReportDetails(
  raw: Partial<MockReportDetails> | null | undefined
): MockReportDetails {
  const bioScore = clamp(
    toInt(raw?.bioScore, 0),
    NEET_SUBJECT_MINS.bio,
    NEET_SUBJECT_CAPS.bio
  );
  const phyScore = clamp(
    toInt(raw?.phyScore, 0),
    NEET_SUBJECT_MINS.phy,
    NEET_SUBJECT_CAPS.phy
  );
  const chemScore = clamp(
    toInt(raw?.chemScore, 0),
    NEET_SUBJECT_MINS.chem,
    NEET_SUBJECT_CAPS.chem
  );
  const correct = clamp(toInt(raw?.correct, 0), 0, NEET_TOTAL_QUESTIONS);
  const wrong = clamp(
    toInt(raw?.wrong, 0),
    0,
    Math.max(0, NEET_TOTAL_QUESTIONS - correct)
  );
  const timeTakenMin = clamp(toInt(raw?.timeTakenMin, 0), 0, 600);
  const updatedAt =
    raw?.updatedAt !== undefined && Number.isFinite(Number(raw.updatedAt))
      ? Number(raw.updatedAt)
      : undefined;

  return {
    bioScore,
    phyScore,
    chemScore,
    correct,
    wrong,
    timeTakenMin,
    ...(updatedAt !== undefined ? { updatedAt } : {}),
  };
}

export function validateMockReportDetailsInput(input: {
  bioScore: number;
  phyScore: number;
  chemScore: number;
  correct: number;
  wrong: number;
  timeTakenMin: number;
}): string | null {
  if (
    !Number.isFinite(input.correct) ||
    !Number.isFinite(input.wrong) ||
    input.correct < 0 ||
    input.wrong < 0
  ) {
    return 'Correct and wrong counts must be 0 or higher.';
  }
  if (Math.round(input.correct) + Math.round(input.wrong) > NEET_TOTAL_QUESTIONS) {
    return `Correct + Wrong cannot exceed ${NEET_TOTAL_QUESTIONS} questions.`;
  }
  if (
    !Number.isFinite(input.bioScore) ||
    input.bioScore < NEET_SUBJECT_MINS.bio ||
    input.bioScore > NEET_SUBJECT_CAPS.bio
  ) {
    return `Bio score must be between ${NEET_SUBJECT_MINS.bio} and ${NEET_SUBJECT_CAPS.bio}.`;
  }
  if (
    !Number.isFinite(input.phyScore) ||
    input.phyScore < NEET_SUBJECT_MINS.phy ||
    input.phyScore > NEET_SUBJECT_CAPS.phy
  ) {
    return `Phy score must be between ${NEET_SUBJECT_MINS.phy} and ${NEET_SUBJECT_CAPS.phy}.`;
  }
  if (
    !Number.isFinite(input.chemScore) ||
    input.chemScore < NEET_SUBJECT_MINS.chem ||
    input.chemScore > NEET_SUBJECT_CAPS.chem
  ) {
    return `Chem score must be between ${NEET_SUBJECT_MINS.chem} and ${NEET_SUBJECT_CAPS.chem}.`;
  }
  if (
    !Number.isFinite(input.timeTakenMin) ||
    input.timeTakenMin < 0 ||
    input.timeTakenMin > 600
  ) {
    return 'Time taken must be between 0 and 600 minutes.';
  }
  return null;
}

/**
 * Deterministic NEET UG historical percentile estimator using smooth monotonic
 * piecewise-linear interpolation over NEET_PERCENTILE_CURVE.
 */
export function estimateNeetPercentile(score: number): number {
  if (!Number.isFinite(score) || score <= 0) return 0;
  if (score >= NEET_MAX_MARKS) return 99.99;

  for (let i = 0; i < NEET_PERCENTILE_CURVE.length - 1; i++) {
    const [sHi, pHi] = NEET_PERCENTILE_CURVE[i];
    const [sLo, pLo] = NEET_PERCENTILE_CURVE[i + 1];
    if (score <= sHi && score >= sLo) {
      if (sHi === sLo) return Number(pHi.toFixed(2));
      const t = (score - sLo) / (sHi - sLo);
      const interpolated = pLo + t * (pHi - pLo);
      return Number(clamp(interpolated, 0, 99.99).toFixed(2));
    }
  }
  return 0;
}

/**
 * Three-tier visual theme resolver for the Potential Percentile Hero Card:
 * - emerald: score >= targetScore (default 650)
 * - gold:    score >= 580 && score < targetScore
 * - crimson: score < 580
 */
export function getMockReportTier(
  score: number,
  targetScore = 650
): MockReportTier {
  const safeTarget = clamp(Math.round(Number(targetScore) || 650), 100, NEET_MAX_MARKS);
  if (!Number.isFinite(score)) return 'crimson';
  if (score >= safeTarget) return 'emerald';
  if (score >= 580) return 'gold';
  return 'crimson';
}

export function formatMockReportDate(dayKey: string): string {
  if (!dayKey || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return dayKey || '';
  const d = parseD(dayKey);
  try {
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return dayKey;
  }
}

function classifyNeetSubject(
  subjectId: string,
  subjectName: string
): 'bio' | 'phy' | 'chem' | 'other' {
  const id = (subjectId || '').toLowerCase();
  const name = (subjectName || '').toLowerCase();
  if (
    id.includes('bio') ||
    id.includes('bot') ||
    id.includes('zoo') ||
    name.includes('bio') ||
    name.includes('botany') ||
    name.includes('zoology')
  ) {
    return 'bio';
  }
  if (id.includes('phy') || name.includes('physics')) {
    return 'phy';
  }
  if (id.includes('chem') || name.includes('chem')) {
    return 'chem';
  }
  return 'other';
}

/**
 * Deterministically derives extended NEET scorecard fields from an existing
 * core `MockTest` when no `dh_mock_report_v1` sidecar entry exists yet.
 */
export function deriveFallbackReportDetails(
  mock: MockTest,
  subjects: readonly Subject[],
  diagnosticMinutesSum?: number
): MockReportDetails {
  const core = computeMockScore(mock, [...subjects]);
  let bioScore = 0;
  let phyScore = 0;
  let chemScore = 0;
  let hasNamedNeet = false;

  for (const bs of core.bySubject) {
    if (bs.attempted === 0 && bs.unattempted === 0) continue;
    const bucket = classifyNeetSubject(bs.subjectId, bs.name);
    if (bucket === 'bio') {
      bioScore += bs.score;
      hasNamedNeet = true;
    } else if (bucket === 'phy') {
      phyScore += bs.score;
      hasNamedNeet = true;
    } else if (bucket === 'chem') {
      chemScore += bs.score;
      hasNamedNeet = true;
    }
  }

  if (!hasNamedNeet && core.totalScore > 0) {
    // Proportional NEET 2:1:1 fallback (Bio 360, Phy 180, Chem 180)
    bioScore = Math.round(core.totalScore * 0.5);
    phyScore = Math.round(core.totalScore * 0.25);
    chemScore = core.totalScore - bioScore - phyScore;
  }

  const correct = clamp(core.totalCorrect, 0, NEET_TOTAL_QUESTIONS);
  const wrong = clamp(
    core.totalWrong,
    0,
    Math.max(0, NEET_TOTAL_QUESTIONS - correct)
  );

  let timeTakenMin = 180;
  if (
    mock.durationMins !== undefined &&
    Number.isFinite(Number(mock.durationMins)) &&
    Number(mock.durationMins) > 0
  ) {
    timeTakenMin = Math.round(Number(mock.durationMins));
  } else if (
    diagnosticMinutesSum !== undefined &&
    Number.isFinite(diagnosticMinutesSum) &&
    diagnosticMinutesSum > 0
  ) {
    timeTakenMin = Math.round(diagnosticMinutesSum);
  } else if (correct === 0 && wrong === 0) {
    timeTakenMin = 0;
  }

  return normalizeMockReportDetails({
    bioScore,
    phyScore,
    chemScore,
    correct,
    wrong,
    timeTakenMin,
  });
}

function computeEffectiveMockScore(
  mock: MockTest,
  subjects: readonly Subject[],
  reportMap: MockReportMap
): number {
  const sidecar = reportMap[mock.id];
  if (sidecar) {
    const norm = normalizeMockReportDetails(sidecar);
    return clamp(norm.correct * 4 - norm.wrong * 1, -180, NEET_MAX_MARKS);
  }
  const core = computeMockScore(mock, [...subjects]);
  return clamp(Math.round(core.totalScore), -180, NEET_MAX_MARKS);
}

/**
 * Computes exact 1-based personal rank of `targetMockId` among all logged mocks
 * sorted by score descending (ties share the higher rank).
 */
export function computeMockPersonalRank(
  targetMockId: string,
  mocks: readonly MockTest[],
  subjects: readonly Subject[],
  reportMap: MockReportMap = {}
): MockPersonalRank {
  if (!mocks || mocks.length === 0) {
    return { rank: 1, totalMocks: 0 };
  }
  const scored = mocks.map((m) => ({
    id: m.id,
    score: computeEffectiveMockScore(m, subjects, reportMap),
  }));
  const targetEntry = scored.find((item) => item.id === targetMockId);
  if (!targetEntry) {
    return { rank: mocks.length, totalMocks: mocks.length };
  }
  const strictlyHigher = scored.filter(
    (item) => item.score > targetEntry.score
  ).length;
  return {
    rank: strictlyHigher + 1,
    totalMocks: mocks.length,
  };
}

/**
 * Full NEET UG scorecard computation combining sidecar `dh_mock_report_v1`
 * (when present) with deterministic fallback derivation from core `MockTest`.
 */
export function buildComputedMockReport(
  mock: MockTest,
  allMocks: readonly MockTest[],
  subjects: readonly Subject[],
  options?: {
    targetScore?: number;
    reportMap?: MockReportMap;
    diagnosticMinutesSum?: number;
  }
): ComputedMockReport {
  const reportMap = options?.reportMap ?? {};
  const sidecar = reportMap[mock.id];
  const hasSidecar = Boolean(sidecar);

  let diagMinutes = options?.diagnosticMinutesSum;
  if (diagMinutes === undefined && !hasSidecar) {
    const diag = getMockDiagnostic(mock.id);
    if (diag?.subjectMinutes) {
      const sum = Object.values(diag.subjectMinutes).reduce(
        (acc, v) => acc + (Number.isFinite(v) && v > 0 ? v : 0),
        0
      );
      if (sum > 0) diagMinutes = sum;
    }
  }

  const details = sidecar
    ? normalizeMockReportDetails(sidecar)
    : deriveFallbackReportDetails(mock, subjects, diagMinutes);

  const attempted = clamp(
    details.correct + details.wrong,
    0,
    NEET_TOTAL_QUESTIONS
  );
  const unattempted = Math.max(0, NEET_TOTAL_QUESTIONS - attempted);
  const positiveScore = details.correct * 4;
  const marksLost = details.wrong * 1;
  const netBleed = details.wrong * 5;

  const core = computeMockScore(mock, [...subjects]);
  const overallScore = hasSidecar
    ? clamp(positiveScore - marksLost, -180, NEET_MAX_MARKS)
    : clamp(Math.round(core.totalScore), -180, NEET_MAX_MARKS);

  const accuracyPct =
    attempted > 0 ? Number(((details.correct / attempted) * 100).toFixed(2)) : 0;

  const targetScore = clamp(
    Math.round(Number(options?.targetScore) || 650),
    100,
    NEET_MAX_MARKS
  );

  const percentile = estimateNeetPercentile(overallScore);
  const tier = getMockReportTier(overallScore, targetScore);
  const personalRank = computeMockPersonalRank(
    mock.id,
    allMocks,
    subjects,
    reportMap
  );

  return {
    mockId: mock.id,
    mockName: mock.name || 'NEET Mock Test',
    dayKey: mock.dayKey,
    formattedDate: formatMockReportDate(mock.dayKey),
    hasSidecar,
    overallScore,
    maxMarks: NEET_MAX_MARKS,
    bioScore: details.bioScore,
    phyScore: details.phyScore,
    chemScore: details.chemScore,
    correct: details.correct,
    wrong: details.wrong,
    attempted,
    unattempted,
    totalQuestions: NEET_TOTAL_QUESTIONS,
    accuracyPct,
    positiveScore,
    marksLost,
    netBleed,
    timeTakenMin: details.timeTakenMin,
    percentile,
    percentileFormatted: percentile.toFixed(2),
    tier,
    targetScore,
    personalRank,
  };
}

/**
 * Helper to derive a Firestore-compatible `MockTest['subjects']` map when the user
 * confirms syncing edited report stats back into the core mock log.
 * Never adds any new keys/fields to `MockTest`.
 */
export function buildCoreMockSubjectsFromReport(
  details: MockReportDetails,
  subjects: readonly Subject[]
): Record<string, MockSubjectScore> {
  const norm = normalizeMockReportDetails(details);
  const active = subjects.filter((s) => !s.arch);

  const bioSub = active.find((s) => classifyNeetSubject(s.id, s.name) === 'bio');
  const phySub = active.find((s) => classifyNeetSubject(s.id, s.name) === 'phy');
  const chemSub = active.find((s) => classifyNeetSubject(s.id, s.name) === 'chem');

  const out: Record<string, MockSubjectScore> = {};
  for (const s of active) {
    out[s.id] = { correct: 0, wrong: 0, unattempted: 0 };
  }

  const slots: Array<{
    subId: string;
    score: number;
    maxQ: number;
  }> = [];

  if (bioSub) slots.push({ subId: bioSub.id, score: norm.bioScore, maxQ: 90 });
  if (phySub) slots.push({ subId: phySub.id, score: norm.phyScore, maxQ: 45 });
  if (chemSub) slots.push({ subId: chemSub.id, score: norm.chemScore, maxQ: 45 });

  if (slots.length === 0) {
    const firstId = active[0]?.id || 'sub_bio';
    out[firstId] = {
      correct: norm.correct,
      wrong: norm.wrong,
      unattempted: Math.max(0, NEET_TOTAL_QUESTIONS - norm.correct - norm.wrong),
    };
    return out;
  }

  // Solve approximate per-subject (c, w) that honor total correct and total wrong
  // while matching bio/phy/chem scores as closely as integer arithmetic allows.
  let remainingCorrect = norm.correct;
  let remainingWrong = norm.wrong;

  // Estimate per-subject correct first from score + share of wrong
  const totalMaxQ = slots.reduce((s, x) => s + x.maxQ, 0) || 180;
  const preliminary = slots.map((slot, idx) => {
    const isLast = idx === slots.length - 1;
    const estWrong = isLast
      ? remainingWrong
      : clamp(Math.round((norm.wrong * slot.maxQ) / totalMaxQ), 0, remainingWrong);
    // score = 4*c - w => c = round((score + w) / 4)
    const desiredC = Math.round((slot.score + estWrong) / 4);
    const c = isLast
      ? clamp(remainingCorrect, 0, slot.maxQ)
      : clamp(desiredC, 0, Math.min(slot.maxQ, remainingCorrect));
    // Re-fit w = 4*c - score within remaining bounds
    const desiredW = 4 * c - slot.score;
    const w = isLast
      ? clamp(remainingWrong, 0, Math.max(0, slot.maxQ - c))
      : clamp(desiredW, 0, Math.min(remainingWrong, Math.max(0, slot.maxQ - c)));
    remainingCorrect = Math.max(0, remainingCorrect - c);
    remainingWrong = Math.max(0, remainingWrong - w);
    return { slot, c, w };
  });

  // If any remainingCorrect or remainingWrong left due to clamping, distribute into headroom
  for (const item of preliminary) {
    while (remainingCorrect > 0 && item.c + item.w < item.slot.maxQ) {
      item.c += 1;
      remainingCorrect -= 1;
    }
    while (remainingWrong > 0 && item.c + item.w < item.slot.maxQ) {
      item.w += 1;
      remainingWrong -= 1;
    }
    out[item.slot.subId] = {
      correct: item.c,
      wrong: item.w,
      unattempted: Math.max(0, item.slot.maxQ - item.c - item.w),
    };
  }

  return out;
}

/* ── Strict Local-Only Sidecar Persistence (`dh_mock_report_v1`) ── */

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

export function loadAllMockReportDetails(
  storage: StorageLike | null = getDefaultStorage()
): MockReportMap {
  if (!storage) return {};
  try {
    const raw = storage.getItem(MOCK_REPORT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = safeJsonParse<unknown>(raw, null);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const out: MockReportMap = {};
    for (const [mockId, entry] of Object.entries(
      parsed as Record<string, unknown>
    )) {
      if (!mockId.trim() || isDangerousKey(mockId) || !entry || typeof entry !== 'object') continue;
      out[mockId] = normalizeMockReportDetails(
        entry as Partial<MockReportDetails>
      );
    }
    return out;
  } catch {
    return {};
  }
}

export function getMockReportDetails(
  mockId: string,
  storage: StorageLike | null = getDefaultStorage()
): MockReportDetails | null {
  if (!mockId) return null;
  const all = loadAllMockReportDetails(storage);
  return all[mockId] ? { ...all[mockId] } : null;
}

export function saveMockReportDetails(
  mockId: string,
  details: MockReportDetails,
  storage: StorageLike | null = getDefaultStorage()
): MockReportDetails {
  const normalized: MockReportDetails = {
    ...normalizeMockReportDetails(details),
    updatedAt: Date.now(),
  };
  if (!mockId || !storage || isDangerousKey(mockId)) return normalized;
  const all = loadAllMockReportDetails(storage);
  all[mockId] = normalized;
  safeLocalStorageSet(MOCK_REPORT_STORAGE_KEY, JSON.stringify(all), storage);
  return normalized;
}

export function deleteMockReportDetails(
  mockId: string,
  storage: StorageLike | null = getDefaultStorage()
): void {
  if (!mockId || !storage || isDangerousKey(mockId)) return;
  const all = loadAllMockReportDetails(storage);
  if (mockId in all) {
    delete all[mockId];
    safeLocalStorageSet(MOCK_REPORT_STORAGE_KEY, JSON.stringify(all), storage);
  }
}

export function clearAllMockReportDetails(
  storage: StorageLike | null = getDefaultStorage()
): void {
  if (!storage) return;
  safeLocalStorageSet(MOCK_REPORT_STORAGE_KEY, JSON.stringify({}), storage);
}
