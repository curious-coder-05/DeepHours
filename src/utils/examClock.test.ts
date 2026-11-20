import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acknowledgeOvertimeAlerts,
  buildExamPaceRecord,
  computeExamClockSnapshot,
  createInitialExamClockState,
  finishExamClock,
  formatBleedDelta,
  formatExamSectionDisplay,
  loadActiveExamClockState,
  loadExamPaceRecords,
  pauseExamClock,
  resumeExamClock,
  saveActiveExamClockState,
  saveExamPaceRecord,
  startExamClock,
  switchExamSection,
  updateExamSectionConfig,
} from './examClock';

function createMemoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

test('examClock — non-locking multi-revisit summing and visit log integrity', () => {
  const t0 = 1_700_000_000_000;
  let state = createInitialExamClockState();
  assert.equal(state.totalDurationMins, 180);

  // Start Biology for 20m
  state = startExamClock(state, 'bio', t0);
  // Switch to Chemistry at +20m, stay for 30m
  state = switchExamSection(state, 'chem', t0 + 20 * 60_000);
  // Switch to Physics at +50m, stay for 40m
  state = switchExamSection(state, 'phy', t0 + 50 * 60_000);
  // Revisit Biology at +90m, stay for 15m (non-locking revisit!)
  state = switchExamSection(state, 'bio', t0 + 90 * 60_000);

  const snap = computeExamClockSnapshot(state, t0 + 105 * 60_000);
  const bio = snap.sections.find((s) => s.id === 'bio')!;
  const chem = snap.sections.find((s) => s.id === 'chem')!;
  const phy = snap.sections.find((s) => s.id === 'phy')!;

  assert.equal(bio.elapsedMs, 35 * 60_000);
  assert.equal(bio.visits, 2);
  assert.equal(chem.elapsedMs, 30 * 60_000);
  assert.equal(chem.visits, 1);
  assert.equal(phy.elapsedMs, 40 * 60_000);
  assert.equal(phy.visits, 1);
  assert.equal(snap.totalElapsedMs, 105 * 60_000);
  assert.equal(state.switchCount, 3);
  assert.equal(state.visitLog.length, 4);
  assert.equal(state.visitLog[0].sectionId, 'bio');
  assert.equal(state.visitLog[3].sectionId, 'bio');
  assert.equal(state.visitLog[3].endedAt, null);
});

test('examClock — strict Date.now() background resume math & pause/resume accuracy', () => {
  const store = createMemoryStorage();
  const t0 = 1_700_000_000_000;
  let state = startExamClock(createInitialExamClockState(), 'phy', t0);
  // Persist active state before simulated reload / background screen lock
  saveActiveExamClockState(state, store);

  // Reload 45 minutes later — zero tick drift!
  const reloaded = loadActiveExamClockState(store);
  assert.ok(reloaded);
  const snapAfterLock = computeExamClockSnapshot(reloaded, t0 + 45 * 60_000);
  assert.equal(snapAfterLock.totalElapsedMs, 45 * 60_000);
  assert.equal(snapAfterLock.sections.find((s) => s.id === 'phy')?.remainingMs, 25 * 60_000);

  // Pause at +45m for 10m, then resume at +55m and inspect at +60m -> active should be 50m (not 60m)
  const paused = pauseExamClock(reloaded, t0 + 45 * 60_000);
  const snapWhilePaused = computeExamClockSnapshot(paused, t0 + 52 * 60_000);
  assert.equal(snapWhilePaused.totalElapsedMs, 45 * 60_000);

  const resumed = resumeExamClock(paused, t0 + 55 * 60_000);
  const snapAfterResume = computeExamClockSnapshot(resumed, t0 + 60 * 60_000);
  assert.equal(snapAfterResume.totalElapsedMs, 50 * 60_000);
  assert.equal(resumed.visitCounts.phy, 1);
});

test('examClock — single-fire overtime crossing detection & seamless overtime display', () => {
  const t0 = 1_700_000_000_000;
  let state = createInitialExamClockState();
  state = updateExamSectionConfig(state, 'bio', { budgetMins: 50 });
  state = startExamClock(state, 'bio', t0);

  // At 49m59s: not overtime yet
  const beforeZero = computeExamClockSnapshot(state, t0 + 50 * 60_000 - 1000);
  assert.deepEqual(beforeZero.newlyOvertimeSectionIds, []);
  const bioBefore = beforeZero.sections.find((s) => s.id === 'bio')!;
  assert.equal(bioBefore.isOvertime, false);
  assert.equal(formatExamSectionDisplay(bioBefore.remainingMs, bioBefore.overtimeMs), '00:01');

  // At 54m12s: crosses zero seamlessly into +04:12 over and flags single-fire alert
  const afterZero = computeExamClockSnapshot(state, t0 + 54 * 60_000 + 12_000);
  assert.deepEqual(afterZero.newlyOvertimeSectionIds, ['bio']);
  const bioAfter = afterZero.sections.find((s) => s.id === 'bio')!;
  assert.equal(bioAfter.isOvertime, true);
  assert.equal(formatExamSectionDisplay(bioAfter.remainingMs, bioAfter.overtimeMs), '+04:12 over');

  // Acknowledge alert -> subsequent ticks never fire again for Biology
  state = acknowledgeOvertimeAlerts(state, afterZero.newlyOvertimeSectionIds);
  const secondCheck = computeExamClockSnapshot(state, t0 + 56 * 60_000);
  assert.deepEqual(secondCheck.newlyOvertimeSectionIds, []);
  assert.equal(secondCheck.sections.find((s) => s.id === 'bio')?.overtimeMs, 6 * 60_000);
});

test('examClock — target-vs-actual bleed diagnostic, OMR toggle & local record persistence', () => {
  const store = createMemoryStorage();
  const t0 = 1_700_000_000_000;
  let state = createInitialExamClockState();
  // Disable OMR so 3 core sections sum to 170m
  state = updateExamSectionConfig(state, 'omr', { enabled: false });
  assert.equal(state.totalDurationMins, 170);

  state = startExamClock(state, 'bio', t0); // Bio budget 50m -> spend 58m (+8m bleed)
  state = switchExamSection(state, 'chem', t0 + 58 * 60_000); // Chem budget 50m -> spend 52m (+2m bleed)
  state = switchExamSection(state, 'phy', t0 + 110 * 60_000); // Phy budget 70m -> spend 60m (-10m starved)

  const { nextState, record } = finishExamClock(state, t0 + 170 * 60_000);
  assert.equal(nextState.status, 'finished');
  assert.equal(record.sections.length, 3);
  assert.equal(record.switchCount, 2);

  const bioRow = record.sections.find((r) => r.id === 'bio')!;
  const chemRow = record.sections.find((r) => r.id === 'chem')!;
  const phyRow = record.sections.find((r) => r.id === 'phy')!;

  assert.equal(bioRow.status, 'bleed');
  assert.equal(formatBleedDelta(bioRow.deltaMs), '+8m bleed');
  assert.equal(chemRow.status, 'bleed');
  assert.equal(formatBleedDelta(chemRow.deltaMs), '+2m bleed');
  assert.equal(phyRow.status, 'starved');
  assert.equal(formatBleedDelta(phyRow.deltaMs), '-10m starved');

  saveExamPaceRecord(record, store);
  const loadedRecords = loadExamPaceRecords(store);
  assert.equal(loadedRecords.length, 1);
  assert.equal(loadedRecords[0].id, record.id);

  // Verify buildExamPaceRecord matches finished record
  const rebuilt = buildExamPaceRecord(nextState, t0 + 170 * 60_000);
  assert.equal(rebuilt.totalElapsedMs, 170 * 60_000);
});
