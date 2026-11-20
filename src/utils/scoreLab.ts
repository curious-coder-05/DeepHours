import type { MockTest, Subject } from '../types';
import { computeMockScore } from './studyLogic';
import {
  NEET_MARKS_PER_WRONG_SWING,
  getTotalLeakErrors,
  type MockLeakMap,
} from './mockLeaks';

export const SCORE_LAB_MAX_MARKS = 720;
export const SCORE_LAB_DEFAULT_TARGET = 650;
export const SCORE_LAB_DEFAULT_BASELINE = 545;
export const SCORE_LAB_MAX_PHYSICS_BOOST_PCT = 25;
export const SCORE_LAB_MAX_CHEM_BIO_LIFT_PCT = 20;

// Standard NEET 720-mark subject ceilings: Physics 180 (45Q), Chemistry 180 (45Q), Biology 360 (90Q)
export const NEET_PHYSICS_MAX_MARKS = 180;
export const NEET_CHEM_BIO_MAX_MARKS = 540;

export interface ScoreLabBaseline {
  source: 'latest-mock' | 'neet-default';
  mockName: string;
  mockDate?: string;
  baselineScore: number;
  targetScore: number;
  wrongCount: number;
  taggedLeakErrors: number;
  physicsScore: number;
  physicsMaxMarks: number;
  chemBioScore: number;
  chemBioMaxMarks: number;
  maxCutErrors: number;
}

export interface ScoreLabInputs {
  /** Number of negative errors eliminated (each recovers +5 net marks). */
  cutNegativeErrors: number;
  /** Physics accuracy boost in percentage points (0..25). */
  physicsBoostPct: number;
  /** Chemistry & Biology recall lift in percentage points (0..20). */
  chemBioLiftPct: number;
}

export interface ScoreLabProjection {
  baselineScore: number;
  targetScore: number;
  projectedScore: number;
  netDelta: number;
  marksFromCutErrors: number;
  marksFromPhysics: number;
  marksFromChemBio: number;
  targetCleared: boolean;
  marksToTarget: number;
  progressFraction: number;
  targetFraction: number;
}

function clamp(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, val));
}

function isPhysicsSubject(subjectId: string, subjectName: string): boolean {
  const id = subjectId.toLowerCase();
  const name = subjectName.toLowerCase();
  return id.includes('phy') || name.includes('physics');
}

function isChemOrBioSubject(subjectId: string, subjectName: string): boolean {
  const id = subjectId.toLowerCase();
  const name = subjectName.toLowerCase();
  return (
    id.includes('chem') ||
    id.includes('bio') ||
    id.includes('bot') ||
    id.includes('zoo') ||
    name.includes('chem') ||
    name.includes('bio') ||
    name.includes('botany') ||
    name.includes('zoology')
  );
}

export interface ScoreLabSidecarSeed {
  overallScore: number;
  phyScore: number;
  chemBioScore: number;
  wrongCount: number;
}

/**
 * Seeds the Score Lab 650+ Simulator from a specific `focusMockId` (when opened
 * from a Mock Report Card) or the user's latest logged mock test
 * (or realistic NEET baseline defaults when no mock is logged yet).
 */
export function buildScoreLabBaseline(
  mocks: readonly MockTest[],
  subjects: readonly Subject[],
  targetMockScore?: number,
  leakMap?: MockLeakMap,
  focusMockId?: string,
  sidecarOverride?: ScoreLabSidecarSeed | null
): ScoreLabBaseline {
  const targetScore = Math.round(
    clamp(targetMockScore ?? SCORE_LAB_DEFAULT_TARGET, 100, SCORE_LAB_MAX_MARKS)
  );

  if (!mocks || mocks.length === 0) {
    return {
      source: 'neet-default',
      mockName: 'NEET 720 Baseline',
      baselineScore: SCORE_LAB_DEFAULT_BASELINE,
      targetScore,
      wrongCount: 16,
      taggedLeakErrors: 0,
      physicsScore: 118,
      physicsMaxMarks: NEET_PHYSICS_MAX_MARKS,
      chemBioScore: 427,
      chemBioMaxMarks: NEET_CHEM_BIO_MAX_MARKS,
      maxCutErrors: 20,
    };
  }

  const focused = focusMockId
    ? mocks.find((m) => m.id === focusMockId)
    : undefined;

  const latest =
    focused ||
    mocks
      .slice()
      .sort((a, b) => {
        if (b.dayKey !== a.dayKey) return b.dayKey.localeCompare(a.dayKey);
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      })[0];

  const report = computeMockScore(latest, [...subjects]);
  const baselineScore = sidecarOverride
    ? Math.round(clamp(sidecarOverride.overallScore, 0, SCORE_LAB_MAX_MARKS))
    : Math.round(clamp(report.totalScore, 0, SCORE_LAB_MAX_MARKS));

  let physicsScore = 0;
  let chemBioScore = 0;

  if (sidecarOverride) {
    physicsScore = sidecarOverride.phyScore;
    chemBioScore = sidecarOverride.chemBioScore;
  } else {
    let hasSubjectSplits = false;

    for (const bs of report.bySubject) {
      if (bs.attempted > 0 || bs.unattempted > 0) {
        hasSubjectSplits = true;
        if (isPhysicsSubject(bs.subjectId, bs.name)) {
          physicsScore += bs.score;
        } else if (isChemOrBioSubject(bs.subjectId, bs.name)) {
          chemBioScore += bs.score;
        } else {
          chemBioScore += bs.score;
        }
      }
    }

    if (!hasSubjectSplits) {
      physicsScore = Math.round(baselineScore * 0.25);
      chemBioScore = Math.max(0, baselineScore - physicsScore);
    }
  }

  const wrongCount = sidecarOverride
    ? Math.max(0, Math.round(sidecarOverride.wrongCount))
    : Math.max(0, report.totalWrong);
  const latestTagged = leakMap ? getTotalLeakErrors(leakMap[latest.id]?.counts) : 0;
  const maxCutErrors = Math.max(
    12,
    Math.min(45, Math.max(wrongCount, latestTagged, 15))
  );

  return {
    source: 'latest-mock',
    mockName: latest.name || 'Latest mock',
    mockDate: latest.dayKey,
    baselineScore,
    targetScore,
    wrongCount,
    taggedLeakErrors: latestTagged,
    physicsScore: Math.round(clamp(physicsScore, 0, NEET_PHYSICS_MAX_MARKS)),
    physicsMaxMarks: NEET_PHYSICS_MAX_MARKS,
    chemBioScore: Math.round(clamp(chemBioScore, 0, NEET_CHEM_BIO_MAX_MARKS)),
    chemBioMaxMarks: NEET_CHEM_BIO_MAX_MARKS,
    maxCutErrors,
  };
}

export function createZeroScoreLabInputs(): ScoreLabInputs {
  return {
    cutNegativeErrors: 0,
    physicsBoostPct: 0,
    chemBioLiftPct: 0,
  };
}

/**
 * Pure Score Lab projection engine:
 * - Cut negative errors: +5 net marks per avoided wrong question (+4 earned + 1 penalty saved)
 * - Physics accuracy boost (0..25%): % of Physics 180-mark section (capped by remaining Physics headroom)
 * - Chemistry & Bio recall lift (0..20%): % of Chem+Bio 540-mark block (capped by remaining Chem+Bio headroom)
 * - Projected score is strictly clamped to [0, 720].
 */
export function computeScoreLabProjection(
  baseline: ScoreLabBaseline,
  rawInputs: ScoreLabInputs
): ScoreLabProjection {
  const cutNegativeErrors = Math.round(
    clamp(rawInputs.cutNegativeErrors, 0, Math.max(1, baseline.maxCutErrors))
  );
  const physicsBoostPct = Math.round(
    clamp(rawInputs.physicsBoostPct, 0, SCORE_LAB_MAX_PHYSICS_BOOST_PCT)
  );
  const chemBioLiftPct = Math.round(
    clamp(rawInputs.chemBioLiftPct, 0, SCORE_LAB_MAX_CHEM_BIO_LIFT_PCT)
  );

  const marksFromCutErrors = cutNegativeErrors * NEET_MARKS_PER_WRONG_SWING;

  const physicsHeadroom = Math.max(
    0,
    baseline.physicsMaxMarks - baseline.physicsScore
  );
  const rawPhysicsGain = Math.round(
    (physicsBoostPct / 100) * baseline.physicsMaxMarks
  );
  const marksFromPhysics = Math.min(physicsHeadroom, rawPhysicsGain);

  const chemBioHeadroom = Math.max(
    0,
    baseline.chemBioMaxMarks - baseline.chemBioScore
  );
  const rawChemBioGain = Math.round(
    (chemBioLiftPct / 100) * baseline.chemBioMaxMarks
  );
  const marksFromChemBio = Math.min(chemBioHeadroom, rawChemBioGain);

  const unclamped =
    baseline.baselineScore +
    marksFromCutErrors +
    marksFromPhysics +
    marksFromChemBio;

  const projectedScore = Math.round(clamp(unclamped, 0, SCORE_LAB_MAX_MARKS));
  const netDelta = projectedScore - baseline.baselineScore;
  const targetScore = Math.round(
    clamp(baseline.targetScore, 100, SCORE_LAB_MAX_MARKS)
  );
  const targetCleared = projectedScore >= targetScore;
  const marksToTarget = Math.max(0, targetScore - projectedScore);

  return {
    baselineScore: baseline.baselineScore,
    targetScore,
    projectedScore,
    netDelta,
    marksFromCutErrors,
    marksFromPhysics,
    marksFromChemBio,
    targetCleared,
    marksToTarget,
    progressFraction: projectedScore / SCORE_LAB_MAX_MARKS,
    targetFraction: targetScore / SCORE_LAB_MAX_MARKS,
  };
}
