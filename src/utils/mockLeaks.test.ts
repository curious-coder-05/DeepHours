import test from 'node:test';
import assert from 'node:assert/strict';
import type { MockTest } from '../types';
import {
  NEET_MARKS_PER_WRONG_SWING,
  aggregateAvoidableBleed,
  computeNetMarksBleed,
  deleteMockLeaks,
  getMockLeaks,
  saveMockLeaks,
  type StorageLike,
} from './mockLeaks';

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

function makeMock(id: string, dayKey: string): MockTest {
  return {
    id,
    name: `Mock ${id}`,
    dayKey,
    subjects: {},
    marksPerCorrect: 4,
    marksPerWrong: -1,
    maxMarks: 720,
    note: '',
    updatedAt: 1,
  };
}

test('mockLeaks: computes exact NEET -5 net marks bleed per wrong question', () => {
  assert.equal(NEET_MARKS_PER_WRONG_SWING, 5);
  assert.equal(computeNetMarksBleed(0), 0);
  assert.equal(computeNetMarksBleed(8), 40);
  assert.equal(computeNetMarksBleed(-3), 0);
});

test('mockLeaks: persists leak breakdown by mock ID and prunes zeroed entries', () => {
  const mem = createMemoryStorage();
  saveMockLeaks(
    'm1',
    { misread: 4, formula: 2, timePanic: 1, concept: 3 },
    mem
  );
  assert.deepEqual(getMockLeaks('m1', mem), {
    misread: 4,
    formula: 2,
    timePanic: 1,
    concept: 3,
  });

  saveMockLeaks(
    'm1',
    { misread: 0, formula: 0, timePanic: 0, concept: 0 },
    mem
  );
  assert.deepEqual(getMockLeaks('m1', mem), {
    misread: 0,
    formula: 0,
    timePanic: 0,
    concept: 0,
  });

  saveMockLeaks('m2', { misread: 3, formula: 0, timePanic: 0, concept: 0 }, mem);
  deleteMockLeaks('m2', mem);
  assert.deepEqual(getMockLeaks('m2', mem), {
    misread: 0,
    formula: 0,
    timePanic: 0,
    concept: 0,
  });
});

test('mockLeaks: aggregates only the 5 most recent tagged mocks and identifies #1 leak category', () => {
  const mocks = [
    makeMock('m1', '2026-10-01'),
    makeMock('m2', '2026-10-05'),
    makeMock('m3', '2026-10-10'),
    makeMock('m4', '2026-10-15'),
    makeMock('m5', '2026-10-20'),
    makeMock('m6', '2026-10-25'),
    makeMock('m7', '2026-10-30'), // untagged
  ];

  // m1 is the 6th-oldest tagged mock, so its 50 concept errors must NOT be included in last-5 aggregation
  const leakMap = {
    m1: { counts: { misread: 0, formula: 0, timePanic: 0, concept: 50 }, updatedAt: 1 },
    m2: { counts: { misread: 3, formula: 1, timePanic: 0, concept: 1 }, updatedAt: 2 },
    m3: { counts: { misread: 4, formula: 0, timePanic: 1, concept: 0 }, updatedAt: 3 },
    m4: { counts: { misread: 2, formula: 2, timePanic: 1, concept: 0 }, updatedAt: 4 },
    m5: { counts: { misread: 5, formula: 1, timePanic: 0, concept: 1 }, updatedAt: 5 },
    m6: { counts: { misread: 2, formula: 1, timePanic: 1, concept: 0 }, updatedAt: 6 },
  };

  const summary = aggregateAvoidableBleed(mocks, leakMap);
  assert.equal(summary.taggedMocksCount, 6);
  assert.equal(summary.includedMocksCount, 5);
  // misread = 3+4+2+5+2 = 16; formula = 1+0+2+1+1 = 5; timePanic = 0+1+1+0+1 = 3; concept = 1+0+0+1+0 = 2
  assert.equal(summary.totalErrors, 26);
  assert.equal(summary.totalNetMarksLost, 130);
  assert.equal(summary.topLeak?.key, 'misread');
  assert.equal(summary.topLeak?.count, 16);
  assert.equal(summary.topLeak?.netMarksLost, 80);
  assert.equal(summary.topLeak?.sharePct, 62);
});
