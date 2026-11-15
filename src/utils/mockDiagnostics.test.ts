import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { MockTest } from '../types';
import {
  MOCK_DIAGNOSTICS_STORAGE_KEY,
  aggregateMockDiagnostics,
  computeCleanScore,
  deleteMockDiagnostic,
  formatSubjectTimeSummary,
  getMockDiagnostic,
  loadAllMockDiagnostics,
  saveMockDiagnostic,
  type StorageLike,
} from './mockDiagnostics';

function createMemoryStorage(): StorageLike {
  const store = new Map<string, string>();
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, v);
    },
    removeItem: (k) => {
      store.delete(k);
    },
  };
}

function makeMock(id: string, name = 'Mock'): MockTest {
  return {
    id,
    name,
    dayKey: '2026-11-15',
    marksPerCorrect: 4,
    marksPerWrong: -1,
    maxMarks: 720,
    subjects: {},
    note: '',
    updatedAt: 1,
  };
}

describe('mockDiagnostics pure helpers & store', () => {
  it('computeCleanScore adds (silly + ncert + time) * 5 and ignores concept gap', () => {
    const res = computeCleanScore(635, 720, {
      silly: 4,
      ncert: 3,
      concept: 5,
      time: 1,
    });
    assert.equal(res.recoverableMarks, 40);
    assert.equal(res.cleanScore, 675);
    assert.equal(res.totalLostQuestions, 13);
  });

  it('computeCleanScore clamps cleanScore to maxScore cleanly', () => {
    const res = computeCleanScore(705, 720, {
      silly: 5,
      ncert: 2,
      concept: 1,
      time: 0,
    });
    assert.equal(res.cleanScore, 720);
    assert.equal(res.recoverableMarks, 15);
    assert.equal(res.totalLostQuestions, 8);
  });

  it('saveMockDiagnostic, getMockDiagnostic, and deleteMockDiagnostic manage dh_mock_diagnostics_v1 cleanly', () => {
    const storage = createMemoryStorage();

    saveMockDiagnostic(
      'm1',
      {
        bleeding: { silly: 3, ncert: 2, concept: 4, time: 1 },
        subjectMinutes: { sub_phy: 80, sub_chem: 45, sub_bio: 45 },
      },
      storage
    );

    const saved = getMockDiagnostic('m1', storage);
    assert.ok(saved !== null);
    assert.deepEqual(saved.bleeding, { silly: 3, ncert: 2, concept: 4, time: 1 });
    assert.deepEqual(saved.subjectMinutes, { sub_phy: 80, sub_chem: 45, sub_bio: 45 });

    saveMockDiagnostic(
      'm2',
      {
        bleeding: { silly: 0, ncert: 0, concept: 0, time: 0 },
        subjectMinutes: { sub_phy: 0 },
      },
      storage
    );
    assert.equal(getMockDiagnostic('m2', storage), null);

    deleteMockDiagnostic('m1', storage);
    assert.equal(getMockDiagnostic('m1', storage), null);
    assert.equal(storage.getItem(MOCK_DIAGNOSTICS_STORAGE_KEY), null);
    assert.deepEqual(loadAllMockDiagnostics(storage), {});
  });

  it('aggregateMockDiagnostics sums bleeding counts/marks and averages subject pacing across timed mocks only', () => {
    const mocks = [makeMock('m1'), makeMock('m2'), makeMock('m3')];
    const storage = createMemoryStorage();

    saveMockDiagnostic(
      'm1',
      {
        bleeding: { silly: 4, ncert: 2, concept: 3, time: 1 },
        subjectMinutes: { sub_phy: 80, sub_chem: 40, sub_bio: 50 },
      },
      storage
    );
    saveMockDiagnostic(
      'm2',
      {
        bleeding: { silly: 2, ncert: 4, concept: 1, time: 3 },
        subjectMinutes: { sub_phy: 70, sub_chem: 50 },
      },
      storage
    );
    saveMockDiagnostic(
      'deleted_mock',
      {
        bleeding: { silly: 10, ncert: 10, concept: 10, time: 10 },
        subjectMinutes: { sub_phy: 120 },
      },
      storage
    );

    const map = loadAllMockDiagnostics(storage);
    const agg = aggregateMockDiagnostics(mocks, map);

    assert.equal(agg.mocksWithDiagnosticsCount, 2);
    assert.equal(agg.timedMocksCount, 2);
    assert.deepEqual(agg.bleedingCounts, { silly: 6, ncert: 6, concept: 4, time: 4 });
    assert.deepEqual(agg.bleedingMarks, { silly: 30, ncert: 30, concept: 20, time: 20 });
    assert.equal(agg.totalLostQuestions, 20);
    assert.equal(agg.totalLostMarks, 100);
    assert.equal(agg.totalRecoverableMarks, 80);
    assert.equal(agg.subjectPacing.sub_phy.avgMinutes, 75);
    assert.equal(agg.subjectPacing.sub_chem.avgMinutes, 45);
    assert.equal(agg.subjectPacing.sub_bio.avgMinutes, 50);
    assert.equal(agg.subjectPacing.sub_bio.timedMockCount, 1);
  });

  it('formatSubjectTimeSummary orders active subjects and abbreviates names cleanly', () => {
    const summary = formatSubjectTimeSummary(
      { sub_chem: 45, sub_phy: 80, sub_bio: 45 },
      [
        { id: 'sub_phy', name: 'Physics', e: '⚡', color: '#3b82f6', arch: 0, todos: [] },
        { id: 'sub_chem', name: 'Chemistry', e: '🧪', color: '#10b981', arch: 0, todos: [] },
        { id: 'sub_bio', name: 'Biology', e: '🧬', color: '#f59e0b', arch: 0, todos: [] },
      ]
    );
    assert.equal(summary, 'Phy 80m · Chem 45m · Bio 45m');
  });
});
