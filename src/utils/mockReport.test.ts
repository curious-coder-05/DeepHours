import test from 'node:test';
import assert from 'node:assert/strict';
import type { MockTest, Subject } from '../types';
import {
  MOCK_REPORT_STORAGE_KEY,
  NEET_PERCENTILE_CURVE,
  buildComputedMockReport,
  buildCoreMockSubjectsFromReport,
  computeMockPersonalRank,
  deleteMockReportDetails,
  estimateNeetPercentile,
  getMockReportDetails,
  getMockReportTier,
  loadAllMockReportDetails,
  normalizeMockReportDetails,
  saveMockReportDetails,
  validateMockReportDetailsInput,
  type StorageLike,
} from './mockReport';
import {
  MOCK_REPORT_CANVAS_HEIGHT,
  MOCK_REPORT_CANVAS_WIDTH,
  buildMockReportCanvasPayload,
  buildMockReportFilename,
} from './mockReportCanvas';

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

const NEET_SUBJECTS: Subject[] = [
  { id: 'sub_bio', name: 'Biology', e: '🧬', color: '#34D399', arch: 0, todos: [] },
  { id: 'sub_phy', name: 'Physics', e: '⚡', color: '#60A5FA', arch: 0, todos: [] },
  { id: 'sub_chem', name: 'Chemistry', e: '⚗️', color: '#FBBF24', arch: 0, todos: [] },
];

function makeMock(
  id: string,
  name: string,
  dayKey: string,
  bio: [number, number, number],
  phy: [number, number, number],
  chem: [number, number, number],
  durationMins?: number
): MockTest {
  return {
    id,
    name,
    dayKey,
    durationMins,
    marksPerCorrect: 4,
    marksPerWrong: -1,
    maxMarks: 720,
    subjects: {
      sub_bio: { correct: bio[0], wrong: bio[1], unattempted: bio[2] },
      sub_phy: { correct: phy[0], wrong: phy[1], unattempted: phy[2] },
      sub_chem: { correct: chem[0], wrong: chem[1], unattempted: chem[2] },
    },
    note: '',
    updatedAt: 1000,
  };
}

test('estimateNeetPercentile matches anchors and is strictly monotonic across 0..720', () => {
  assert.equal(estimateNeetPercentile(720), 99.99);
  assert.equal(estimateNeetPercentile(750), 99.99);
  assert.equal(estimateNeetPercentile(650), 99.18);
  assert.equal(estimateNeetPercentile(600), 97.15);
  assert.equal(estimateNeetPercentile(0), 0);
  assert.equal(estimateNeetPercentile(-45), 0);

  for (const [score, expectedPct] of NEET_PERCENTILE_CURVE) {
    assert.equal(estimateNeetPercentile(score), expectedPct);
  }

  let prev = -1;
  for (let s = 0; s <= 720; s += 5) {
    const p = estimateNeetPercentile(s);
    assert.ok(p >= prev, `Expected monotonic percentile at ${s}: ${p} >= ${prev}`);
    assert.ok(p >= 0 && p <= 99.99);
    prev = p;
  }

  // Midpoint interpolation check between 650 (99.18) and 670 (99.64) -> 660 => 99.41
  assert.equal(estimateNeetPercentile(660), 99.41);
});

test('getMockReportTier resolves emerald, gold, and crimson accurately', () => {
  assert.equal(getMockReportTier(650, 650), 'emerald');
  assert.equal(getMockReportTier(695, 650), 'emerald');
  assert.equal(getMockReportTier(649, 650), 'gold');
  assert.equal(getMockReportTier(580, 650), 'gold');
  assert.equal(getMockReportTier(579, 650), 'crimson');
  assert.equal(getMockReportTier(-20, 650), 'crimson');

  // Custom target score (e.g., 680)
  assert.equal(getMockReportTier(665, 680), 'gold');
  assert.equal(getMockReportTier(680, 680), 'emerald');
});

test('buildComputedMockReport computes exact +4/-1 math, accuracy, netBleed, and fallback', () => {
  // Bio: 85*4 - 5 = 335, Phy: 40*4 - 3 = 157, Chem: 42*4 - 2 = 166
  // Total: 167 correct, 10 wrong -> attempted 177, unattempted 3, +668, -10 => 658
  const m1 = makeMock('m1', 'Allen Major #1', '2026-11-18', [85, 5, 0], [40, 3, 2], [42, 2, 1], 174);
  const report = buildComputedMockReport(m1, [m1], NEET_SUBJECTS, {
    targetScore: 650,
  });

  assert.equal(report.hasSidecar, false);
  assert.equal(report.overallScore, 658);
  assert.equal(report.bioScore, 335);
  assert.equal(report.phyScore, 157);
  assert.equal(report.chemScore, 166);
  assert.equal(report.correct, 167);
  assert.equal(report.wrong, 10);
  assert.equal(report.attempted, 177);
  assert.equal(report.unattempted, 3);
  assert.equal(report.positiveScore, 668);
  assert.equal(report.marksLost, 10);
  assert.equal(report.netBleed, 50);
  assert.equal(report.accuracyPct, 94.35);
  assert.equal(report.timeTakenMin, 174);
  assert.equal(report.tier, 'emerald');
  assert.equal(report.personalRank.rank, 1);
  assert.equal(report.personalRank.totalMocks, 1);
});

test('edge cases: 0 attempted and negative total score are handled cleanly', () => {
  const zeroMock = makeMock('m0', 'Empty Mock', '2026-11-10', [0, 0, 90], [0, 0, 45], [0, 0, 45]);
  const r0 = buildComputedMockReport(zeroMock, [zeroMock], NEET_SUBJECTS, { targetScore: 650 });
  assert.equal(r0.attempted, 0);
  assert.equal(r0.unattempted, 180);
  assert.equal(r0.accuracyPct, 0);
  assert.equal(r0.overallScore, 0);
  assert.equal(r0.percentile, 0);
  assert.equal(r0.percentileFormatted, '0.00');
  assert.equal(r0.tier, 'crimson');

  const negMock = makeMock('mn', 'Negative Mock', '2026-11-11', [0, 20, 70], [0, 10, 35], [0, 10, 35], 120);
  const rn = buildComputedMockReport(negMock, [negMock], NEET_SUBJECTS, { targetScore: 650 });
  assert.equal(rn.correct, 0);
  assert.equal(rn.wrong, 40);
  assert.equal(rn.attempted, 40);
  assert.equal(rn.positiveScore, 0);
  assert.equal(rn.marksLost, 40);
  assert.equal(rn.netBleed, 200);
  assert.equal(rn.overallScore, -40);
  assert.equal(rn.accuracyPct, 0);
  assert.equal(rn.percentile, 0);
  assert.equal(rn.tier, 'crimson');
});

test('computeMockPersonalRank ranks mocks descending with competition ties and sidecar overrides', () => {
  const high = makeMock('m_hi', 'FTS 3', '2026-11-19', [88, 2, 0], [42, 2, 1], [43, 1, 1], 172); // 687
  const mid = makeMock('m_mid', 'FTS 2', '2026-11-15', [80, 6, 4], [38, 4, 3], [38, 4, 3], 178); // 610
  const low = makeMock('m_low', 'FTS 1', '2026-11-10', [72, 10, 8], [30, 8, 7], [32, 6, 7], 180); // 512
  const all = [low, high, mid];

  assert.deepEqual(computeMockPersonalRank('m_hi', all, NEET_SUBJECTS), { rank: 1, totalMocks: 3 });
  assert.deepEqual(computeMockPersonalRank('m_mid', all, NEET_SUBJECTS), { rank: 2, totalMocks: 3 });
  assert.deepEqual(computeMockPersonalRank('m_low', all, NEET_SUBJECTS), { rank: 3, totalMocks: 3 });

  // Override m_low via sidecar to 700 (176 right, 4 wrong -> 700)
  const reportMap = {
    m_low: normalizeMockReportDetails({
      bioScore: 355,
      phyScore: 170,
      chemScore: 175,
      correct: 176,
      wrong: 4,
      timeTakenMin: 165,
    }),
  };
  assert.deepEqual(computeMockPersonalRank('m_low', all, NEET_SUBJECTS, reportMap), {
    rank: 1,
    totalMocks: 3,
  });
  assert.deepEqual(computeMockPersonalRank('m_hi', all, NEET_SUBJECTS, reportMap), {
    rank: 2,
    totalMocks: 3,
  });
});

test('sidecar persistence saves, normalizes, loads, and deletes cleanly in localStorage', () => {
  const store = createMemoryStorage();
  assert.equal(getMockReportDetails('m1', store), null);

  saveMockReportDetails(
    'm1',
    {
      bioScore: 340,
      phyScore: 165,
      chemScore: 170,
      correct: 170,
      wrong: 5,
      timeTakenMin: 168,
    },
    store
  );

  const loaded = getMockReportDetails('m1', store);
  assert.ok(loaded);
  assert.equal(loaded.bioScore, 340);
  assert.equal(loaded.phyScore, 165);
  assert.equal(loaded.chemScore, 170);
  assert.equal(loaded.correct, 170);
  assert.equal(loaded.wrong, 5);
  assert.equal(loaded.timeTakenMin, 168);

  // Clamping guard: wrong clamped to 180 - correct
  saveMockReportDetails(
    'm2',
    {
      bioScore: 400,
      phyScore: 200,
      chemScore: -100,
      correct: 170,
      wrong: 40,
      timeTakenMin: 900,
    },
    store
  );
  const clamped = getMockReportDetails('m2', store);
  assert.ok(clamped);
  assert.equal(clamped.bioScore, 360);
  assert.equal(clamped.phyScore, 180);
  assert.equal(clamped.chemScore, -45);
  assert.equal(clamped.correct, 170);
  assert.equal(clamped.wrong, 10);
  assert.equal(clamped.timeTakenMin, 600);

  assert.equal(Object.keys(loadAllMockReportDetails(store)).length, 2);

  deleteMockReportDetails('m1', store);
  assert.equal(getMockReportDetails('m1', store), null);
  assert.ok(getMockReportDetails('m2', store));

  // Verify storage key used
  assert.ok(store.getItem(MOCK_REPORT_STORAGE_KEY)?.includes('m2'));
});

test('validateMockReportDetailsInput catches invalid correct+wrong overflow and bounds', () => {
  assert.equal(
    validateMockReportDetailsInput({
      bioScore: 320,
      phyScore: 150,
      chemScore: 155,
      correct: 160,
      wrong: 15,
      timeTakenMin: 175,
    }),
    null
  );
  assert.ok(
    validateMockReportDetailsInput({
      bioScore: 320,
      phyScore: 150,
      chemScore: 155,
      correct: 160,
      wrong: 25,
      timeTakenMin: 175,
    })?.includes('180')
  );
  assert.ok(
    validateMockReportDetailsInput({
      bioScore: 370,
      phyScore: 150,
      chemScore: 155,
      correct: 160,
      wrong: 10,
      timeTakenMin: 175,
    })?.includes('360')
  );
});

test('buildCoreMockSubjectsFromReport produces bounded Firestore-safe subject counts', () => {
  const subjectsMap = buildCoreMockSubjectsFromReport(
    {
      bioScore: 340,
      phyScore: 156,
      chemScore: 165,
      correct: 168,
      wrong: 11,
      timeTakenMin: 170,
    },
    NEET_SUBJECTS
  );

  let totalC = 0;
  let totalW = 0;
  let totalQ = 0;
  for (const sc of Object.values(subjectsMap)) {
    assert.ok(sc.correct >= 0 && sc.wrong >= 0 && sc.unattempted >= 0);
    totalC += sc.correct;
    totalW += sc.wrong;
    totalQ += sc.correct + sc.wrong + sc.unattempted;
  }
  assert.equal(totalC, 168);
  assert.equal(totalW, 11);
  assert.equal(totalQ, 180);
});

test('Canvas report payload and filename formatting match 1080x1350 spec', () => {
  assert.equal(MOCK_REPORT_CANVAS_WIDTH, 1080);
  assert.equal(MOCK_REPORT_CANVAS_HEIGHT, 1350);

  const m1 = makeMock('m1', 'Aakash FTS #04', '2026-11-20', [86, 4, 0], [39, 4, 2], [41, 3, 1], 176);
  const report = buildComputedMockReport(m1, [m1], NEET_SUBJECTS, { targetScore: 650 });
  const payload = buildMockReportCanvasPayload(report);

  assert.equal(payload.title, 'Aakash FTS #04');
  assert.equal(payload.overallScoreText, '653');
  assert.equal(payload.maxMarksText, '/720');
  assert.equal(payload.bioScoreText, '340');
  assert.equal(payload.phyScoreText, '152');
  assert.equal(payload.chemScoreText, '161');
  assert.equal(payload.tier, 'emerald');
  assert.equal(payload.tiles.length, 6);
  assert.equal(payload.tiles[0].label, 'MOCK RANK');
  assert.equal(payload.tiles[0].value, '#1');
  assert.equal(payload.tiles[0].suffix, '/1');
  assert.equal(payload.tiles[1].label, 'QS ATTEMPTED');
  assert.equal(payload.tiles[1].value, '177');
  assert.equal(payload.tiles[1].suffix, '/180');
  assert.equal(payload.tiles[2].label, 'ACCURACY');
  assert.equal(payload.tiles[2].value, '93.79%');
  assert.equal(payload.tiles[3].label, 'POSITIVE SCORE');
  assert.equal(payload.tiles[3].value, '664');
  assert.equal(payload.tiles[4].label, 'MARKS LOST');
  assert.equal(payload.tiles[4].value, '11');
  assert.equal(payload.tiles[4].accentColor, '#FB7185');
  assert.equal(payload.tiles[5].label, 'TIME TAKEN');
  assert.equal(payload.tiles[5].value, '176');
  assert.equal(payload.tiles[5].suffix, 'min');

  assert.equal(
    buildMockReportFilename('Aakash FTS #04', '2026-11-20'),
    'deep-hours-report-aakash-fts-04-2026-11-20.png'
  );
});
