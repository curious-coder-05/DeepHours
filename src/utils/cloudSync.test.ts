import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAILY_WRITE_CAP,
  DEBOUNCE_MS,
  MIN_SYNC_INTERVAL_MS,
  SyncBudgetController,
  computeCloudDocSignature,
  loadSyncOutboxMeta,
  partitionStateToCloudDocs,
  planCloudDocWrites,
  saveSyncOutboxMeta,
  scopeOutboxMetaForUid,
} from './cloudSync.ts';
import { createBlankState, createDailyTask } from './studyLogic.ts';

describe('Cloud Sync Diff-Check & Budget Hardening', () => {
  it('uses raised 500 daily write cap and 8s debounce defaults', () => {
    assert.equal(DAILY_WRITE_CAP, 500);
    assert.equal(DEBOUNCE_MS, 8000);
    assert.equal(MIN_SYNC_INTERVAL_MS, 15000);
  });

  it('computeCloudDocSignature ignores updatedAt/savedAt metadata and object key ordering', () => {
    const state = createBlankState();
    state.tasks.push(createDailyTask('Solve 45 Physics PYQs', '2026-10-30', 'sub_phy', 1000)!);
    state.sessions.push({
      id: 'ses_diff_1',
      subjectId: 'sub_phy',
      heading: 'Electrostatics',
      dayKey: '2026-10-30',
      startTs: 1000,
      endTs: 1801000,
      activeMs: 1800000,
      pausedMs: 0,
      pauseCount: 0,
      overtimeMs: 0,
      purity: 100,
      mode: 'pomo',
      rating: 5,
      note: 'Clean focus',
      updatedAt: 2000,
    });

    const p1 = partitionStateToCloudDocs(state, 10_000);
    // Mutate only updatedAt / savedAt timestamps without changing real data
    const stateTimestampBumped = {
      ...state,
      savedAt: 99_999,
      set: { ...state.set, updatedAt: 99_999 },
      sessions: state.sessions.map((s) => ({ ...s, updatedAt: 99_999 })),
      tasks: state.tasks.map((t) => ({ ...t, updatedAt: 99_999 })),
    };
    const p2 = partitionStateToCloudDocs(stateTimestampBumped, 88_888);

    for (const docKey of Object.keys(p1.docs)) {
      assert.equal(
        computeCloudDocSignature(p1.docs[docKey]),
        computeCloudDocSignature(p2.docs[docKey]),
        `Expected identical canonical signature for ${docKey}`
      );
    }

    // Key order invariance
    const sigA = computeCloudDocSignature({ a: 1, b: { c: 2, d: 3 }, updatedAt: 100 });
    const sigB = computeCloudDocSignature({ b: { d: 3, c: 2 }, a: 1, updatedAt: 999, savedAt: 555 });
    assert.equal(sigA, sigB);
  });

  it('planCloudDocWrites skips identical docs (0 writes) and writes only modified docs', () => {
    const state = createBlankState();
    state.tasks.push(createDailyTask('Revise Organic Reactions', '2026-10-30', 'sub_che', 1000)!);
    state.sessions.push({
      id: 'ses_diff_2',
      subjectId: 'sub_che',
      heading: 'GOC',
      dayKey: '2026-10-30',
      startTs: 1000,
      endTs: 3601000,
      activeMs: 3600000,
      pausedMs: 0,
      pauseCount: 0,
      overtimeMs: 0,
      purity: 100,
      mode: 'pomo',
      rating: 4,
      note: '',
      updatedAt: 2000,
    });

    const initial = partitionStateToCloudDocs(state, 5000);
    const allKeys = Object.keys(initial.docs);

    // First sync: no signatures yet -> all docs queued
    const firstPlan = planCloudDocWrites({
      partitionedDocs: initial.docs,
      candidateKeys: allKeys,
      lastSyncedSignatures: {},
      remoteIndexDocs: {},
    });
    assert.equal(firstPlan.writes.length, allKeys.length);
    assert.equal(firstPlan.unchangedKeys.length, 0);

    // Record signatures from first upload
    const syncedSigs: Record<string, string> = {};
    const remoteIndexDocs: Record<string, number> = {};
    for (const w of firstPlan.writes) {
      syncedSigs[w.docKey] = w.signature;
      remoteIndexDocs[w.docKey] = 5000;
    }

    // Re-sync with bumped updatedAt only -> 0 writes!
    const bumpedState = {
      ...state,
      set: { ...state.set, updatedAt: 55_000 },
    };
    const bumped = partitionStateToCloudDocs(bumpedState, 55_000);
    const secondPlan = planCloudDocWrites({
      partitionedDocs: bumped.docs,
      candidateKeys: Object.keys(bumped.docs),
      lastSyncedSignatures: syncedSigs,
      remoteIndexDocs,
    });
    assert.equal(secondPlan.writes.length, 0);
    assert.equal(secondPlan.unchangedKeys.length, allKeys.length);

    // Modify ONLY a month session -> ONLY months/2026-10 is written (meta/* skipped!)
    const editedState = {
      ...bumpedState,
      sessions: [
        ...bumpedState.sessions,
        {
          id: 'ses_diff_3',
          subjectId: 'sub_bio',
          heading: 'Cell Cycle',
          dayKey: '2026-10-30',
          startTs: 6000,
          endTs: 1806000,
          activeMs: 1800000,
          pausedMs: 0,
          pauseCount: 0,
          overtimeMs: 0,
          purity: 100,
          mode: 'pomo' as const,
          rating: 5,
          note: '',
          updatedAt: 60000,
        },
      ],
    };
    const edited = partitionStateToCloudDocs(editedState, 60_000);
    const thirdPlan = planCloudDocWrites({
      partitionedDocs: edited.docs,
      candidateKeys: Object.keys(edited.docs),
      lastSyncedSignatures: syncedSigs,
      remoteIndexDocs,
    });
    assert.deepEqual(
      thirdPlan.writes.map((w) => w.docKey),
      ['months/2026-10']
    );
    assert.ok(thirdPlan.unchangedKeys.includes('meta/core'));
    assert.ok(thirdPlan.unchangedKeys.includes('meta/tasks'));
  });

  it('SyncOutboxMeta persists lastSyncedSignatures cleanly and SyncBudgetController enforces 500/day cap', () => {
    saveSyncOutboxMeta({
      dirtyDocs: [],
      lastPushTs: 1000,
      lastPullTs: 1000,
      knownRemoteDocTs: { 'meta/core': 1000 },
      lastSyncedSignatures: { 'meta/core': 'v1:10:abcdef0102030405' },
      dailyWritesDayKey: '2026-10-30',
      dailyWritesCount: 12,
      quotaPausedUntilDayKey: null,
      firstSignInMergedUids: ['u1'],
    });
    const loaded = loadSyncOutboxMeta();
    assert.equal(loaded.lastSyncedSignatures['meta/core'], 'v1:10:abcdef0102030405');

    const ctrl = new SyncBudgetController({
      initialMeta: loaded,
      getNow: () => new Date('2026-10-30T12:00:00Z').getTime(),
      onFlushDocs: async () => ({ writesUsed: 0 }),
    });
    assert.equal(ctrl.getRemainingDailyWrites(), 488);
    assert.equal(ctrl.canWrite(488), true);
    assert.equal(ctrl.canWrite(489), false);
    ctrl.dispose();
  });

  it('Google Sign-In uses only default basic identity scopes (no Drive scopes or addScope)', () => {
    const src = readFileSync(path.resolve(import.meta.dirname, './cloudSync.ts'), 'utf8');
    assert.ok(src.includes('new GoogleAuthProvider()'));
    assert.equal(src.includes('addScope'), false);
    assert.equal(src.includes('googleapis.com/auth/drive'), false);
    assert.equal(src.includes('googleapis.com/drive'), false);
  });

  it('scopeOutboxMetaForUid isolates sync caches when switching Google accounts on the same device', () => {
    const metaUserA = {
      activeUid: 'user-a',
      dirtyDocs: ['meta/core', 'months/2026-11'],
      lastPushTs: 5000,
      lastPullTs: 5000,
      knownRemoteDocTs: { 'meta/core': 5000, 'months/2026-11': 5000 },
      lastSyncedSignatures: { 'meta/core': 'v1:10:aaaa', 'months/2026-11': 'v1:20:bbbb' },
      dailyWritesDayKey: '2026-11-19',
      dailyWritesCount: 4,
      quotaPausedUntilDayKey: null,
      firstSignInMergedUids: ['user-a'],
    };

    // Same user preserves all sync caches
    const same = scopeOutboxMetaForUid(metaUserA, 'user-a');
    assert.deepEqual(same.dirtyDocs, metaUserA.dirtyDocs);
    assert.deepEqual(same.knownRemoteDocTs, metaUserA.knownRemoteDocTs);
    assert.deepEqual(same.lastSyncedSignatures, metaUserA.lastSyncedSignatures);

    // Different user wipes per-account caches while retaining device daily quota counter
    const switched = scopeOutboxMetaForUid(metaUserA, 'user-b');
    assert.equal(switched.activeUid, 'user-b');
    assert.deepEqual(switched.dirtyDocs, []);
    assert.deepEqual(switched.knownRemoteDocTs, {});
    assert.deepEqual(switched.lastSyncedSignatures, {});
    assert.equal(switched.dailyWritesCount, 4);
  });

  it('SyncBudgetController preserves dirtyDocs and notifies listeners when a flush fails', async () => {
    let notifiedDirtyCount = 0;
    const ctrl = new SyncBudgetController({
      initialMeta: {
        dirtyDocs: [],
        lastPushTs: 0,
        lastPullTs: 0,
        knownRemoteDocTs: {},
        lastSyncedSignatures: {},
        dailyWritesDayKey: '2026-11-19',
        dailyWritesCount: 0,
        quotaPausedUntilDayKey: null,
        firstSignInMergedUids: [],
      },
      getNow: () => new Date('2026-11-19T12:00:00Z').getTime(),
      onFlushDocs: async () => {
        throw new Error('network-request-failed');
      },
      onMetaChanged: (m) => {
        notifiedDirtyCount = m.dirtyDocs.length;
      },
    });

    ctrl.markDirty(['meta/core', 'months/2026-11']);
    await assert.rejects(() => ctrl.flush(true), /network-request-failed/);
    assert.deepEqual(ctrl.getMeta().dirtyDocs.sort(), ['meta/core', 'months/2026-11']);
    assert.equal(notifiedDirtyCount, 2);
    ctrl.dispose();
  });

  it('firestore.rules enforces valid Firestore CEL (no request.resource.size()), verified email, joinedAt immutability, full mocks validation, and zero-read cheer static checks', () => {
    const rules = readFileSync(path.resolve(import.meta.dirname, '../../firestore.rules'), 'utf8');

    // Cloud Firestore v2 has NO request.resource.size() (Cloud Storage only)
    assert.equal(rules.includes('request.resource.size('), false);

    // Open-signup verified-email gate
    assert.ok(rules.includes('request.auth.token.email_verified == true'));

    // joinedAt immutability on member self-update
    assert.ok(rules.includes('resource.data.members[request.auth.uid].joinedAt'));

    // Full mocks list validation across indices 0..9
    assert.ok(rules.includes('function isValidMocksList('));
    assert.ok(rules.includes('isValidMockPoint(mocks[9])'));

    // Cheers static validation must execute BEFORE any exists() / get() lookup
    const cheersSection = rules.slice(rules.indexOf('match /cheers/{cheerId}'));
    const staticCheckIdx = cheersSection.indexOf('request.resource.data.from == request.auth.uid');
    const lookupIdx = cheersSection.indexOf('bothAreGroupMembers(');
    assert.ok(staticCheckIdx > 0 && lookupIdx > staticCheckIdx);
    assert.ok(cheersSection.includes('allow update: if false;'));
  });
});
