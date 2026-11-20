import test from 'node:test';
import assert from 'node:assert/strict';
import type { MockTest, Subject } from '../types';
import {
  SCORE_LAB_DEFAULT_BASELINE,
  SCORE_LAB_DEFAULT_TARGET,
  SCORE_LAB_MAX_MARKS,
  buildScoreLabBaseline,
  computeScoreLabProjection,
  createZeroScoreLabInputs,
} from './scoreLab';

const SUBJECTS: Subject[] = [
  { id: 'sub_phy', name: 'Physics', e: '⚛️', color: '#3b82f6', arch: 0, todos: [] },
  { id: 'sub_chem', name: 'Chemistry', e: '🧪', color: '#f59e0b', arch: 0, todos: [] },
  { id: 'sub_bio', name: 'Biology', e: '🧬', color: '#10b981', arch: 0, todos: [] },
];

test('scoreLab: provides clean NEET baseline defaults when no mocks are logged', () => {
  const baseline = buildScoreLabBaseline([], SUBJECTS);
  assert.equal(baseline.source, 'neet-default');
  assert.equal(baseline.baselineScore, SCORE_LAB_DEFAULT_BASELINE);
  assert.equal(baseline.targetScore, SCORE_LAB_DEFAULT_TARGET);

  const zero = computeScoreLabProjection(baseline, createZeroScoreLabInputs());
  assert.equal(zero.projectedScore, SCORE_LAB_DEFAULT_BASELINE);
  assert.equal(zero.netDelta, 0);
  assert.equal(zero.targetCleared, false);
});

test('scoreLab: seeds baseline from latest mock and crosses target cleanly into targetCleared', () => {
  const olderMock: MockTest = {
    id: 'm_old',
    name: 'Part Test 1',
    dayKey: '2026-11-01',
    subjects: {
      sub_phy: { correct: 20, wrong: 10, unattempted: 15 },
      sub_chem: { correct: 30, wrong: 5, unattempted: 10 },
      sub_bio: { correct: 70, wrong: 10, unattempted: 10 },
    },
    marksPerCorrect: 4,
    marksPerWrong: -1,
    maxMarks: 720,
    note: '',
    updatedAt: 10,
  };
  // Latest mock score: Phy 30*4 - 5 = 115, Chem 38*4 - 4 = 148, Bio 82*4 - 6 = 322 => Total = 585, Wrong = 15
  const latestMock: MockTest = {
    id: 'm_new',
    name: 'Full Mock 4',
    dayKey: '2026-11-18',
    subjects: {
      sub_phy: { correct: 30, wrong: 5, unattempted: 10 },
      sub_chem: { correct: 38, wrong: 4, unattempted: 3 },
      sub_bio: { correct: 82, wrong: 6, unattempted: 2 },
    },
    marksPerCorrect: 4,
    marksPerWrong: -1,
    maxMarks: 720,
    note: '',
    updatedAt: 20,
  };

  const baseline = buildScoreLabBaseline([olderMock, latestMock], SUBJECTS, 650, {
    m_new: { counts: { misread: 5, formula: 3, timePanic: 2, concept: 1 }, updatedAt: 25 },
  });

  assert.equal(baseline.source, 'latest-mock');
  assert.equal(baseline.mockName, 'Full Mock 4');
  assert.equal(baseline.baselineScore, 585);
  assert.equal(baseline.wrongCount, 15);
  assert.equal(baseline.taggedLeakErrors, 11);

  const proj = computeScoreLabProjection(baseline, {
    cutNegativeErrors: 8, // +40 marks
    physicsBoostPct: 10, // +18 marks
    chemBioLiftPct: 5, // +27 marks
  });
  // 585 + 40 + 18 + 27 = 670 >= 650
  assert.equal(proj.marksFromCutErrors, 40);
  assert.equal(proj.marksFromPhysics, 18);
  assert.equal(proj.marksFromChemBio, 27);
  assert.equal(proj.projectedScore, 670);
  assert.equal(proj.netDelta, 85);
  assert.equal(proj.targetCleared, true);
  assert.equal(proj.marksToTarget, 0);
});

test('scoreLab: clamps projected score strictly inside [0, 720]', () => {
  const highMock: MockTest = {
    id: 'm_top',
    name: 'Topper Mock',
    dayKey: '2026-11-19',
    subjects: {
      sub_phy: { correct: 43, wrong: 2, unattempted: 0 }, // 170
      sub_chem: { correct: 44, wrong: 1, unattempted: 0 }, // 175
      sub_bio: { correct: 89, wrong: 1, unattempted: 0 }, // 355 -> total 700
    },
    marksPerCorrect: 4,
    marksPerWrong: -1,
    maxMarks: 720,
    note: '',
    updatedAt: 30,
  };

  const baseline = buildScoreLabBaseline([highMock], SUBJECTS, 680);
  const maxed = computeScoreLabProjection(baseline, {
    cutNegativeErrors: 30,
    physicsBoostPct: 25,
    chemBioLiftPct: 20,
  });
  assert.equal(maxed.projectedScore, SCORE_LAB_MAX_MARKS);
  assert.equal(maxed.targetCleared, true);
  assert.ok(maxed.projectedScore <= 720 && maxed.projectedScore >= 0);
});
