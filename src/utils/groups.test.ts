import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SHARING_FLAGS,
  GROUP_PUBLISH_DEBOUNCE_MS,
  GROUP_PUBLISH_MIN_INTERVAL_MS,
  GroupPublishBudgetController,
  buildMyMemberEntry,
  hashMemberEntry,
  mergeCachedGroupMemberUpdate,
  shouldAcceptGroupSnapshot,
  type CachedGroupSnapshot,
  type GroupDoc,
} from './groups.ts';
import { createBlankState } from './studyLogic.ts';

describe('Community Squad Auto-Publish Diff-Check & Immediate Live Flush', () => {
  it('uses ~6s debounce and 10s min interval defaults for responsive squad updates', () => {
    assert.equal(GROUP_PUBLISH_DEBOUNCE_MS, 6000);
    assert.equal(GROUP_PUBLISH_MIN_INTERVAL_MS, 10000);
  });

  it('skips Firestore write (0 writes) when MemberEntry hash is identical and writes when stats or live status change', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
    t.mock.timers.setTime(new Date('2026-11-01T10:00:00Z').getTime());

    const writes: string[] = [];
    const ctrl = new GroupPublishBudgetController(
      async (gid) => {
        writes.push(gid);
        ctrl.recordWrite(1);
      },
      { initialOnline: true }
    );

    const state = createBlankState();
    state.profile = { nick: 'MedAspirant', emoji: '🩺' };
    const e1 = buildMyMemberEntry(state, '2026-11-01', {
      joinedAt: 1000,
      sh: DEFAULT_SHARING_FLAGS,
      now: Date.now(),
    });

    // Initial dirty entry flushes after ~6s
    ctrl.markGroupDirty('GRP1234567', e1);
    t.mock.timers.tick(5000);
    assert.equal(writes.length, 0);
    t.mock.timers.tick(1500);
    await Promise.resolve();
    assert.equal(writes.length, 1);
    ctrl.commitEntryHash('GRP1234567', e1);

    // Identical entry (only updatedAt differs) -> 0 writes!
    const e1Later = { ...e1, updatedAt: Date.now() + 9999 };
    assert.equal(hashMemberEntry(e1), hashMemberEntry(e1Later));
    ctrl.markGroupDirty('GRP1234567', e1Later);
    t.mock.timers.tick(30_000);
    await Promise.resolve();
    assert.equal(writes.length, 1);

    // Start study timer -> live status changes -> flushNow() triggers immediate write
    const eLive = buildMyMemberEntry(state, '2026-11-01', {
      joinedAt: 1000,
      sh: DEFAULT_SHARING_FLAGS,
      live: { since: Date.now(), until: Date.now() + 3600_000 },
      now: Date.now(),
    });
    ctrl.markGroupDirty('GRP1234567', eLive);
    await ctrl.flushNow(['GRP1234567']);
    assert.equal(writes.length, 2);
    ctrl.commitEntryHash('GRP1234567', eLive);

    // Pause then resume within 6s with same live window -> reverted hash cancels pending write (0 writes!)
    const ePaused = { ...eLive, live: undefined, updatedAt: Date.now() + 1000 };
    ctrl.markGroupDirty('GRP1234567', ePaused);
    t.mock.timers.tick(2000);
    ctrl.markGroupDirty('GRP1234567', { ...eLive, updatedAt: Date.now() + 2000 });
    t.mock.timers.tick(20_000);
    await Promise.resolve();
    assert.equal(writes.length, 2);

    // Study session logged -> xpTotal & days change -> auto-publishes after ~10s min interval
    const eWithSession = {
      ...eLive,
      live: undefined,
      days: { ...eLive.days, '2026-11-01': 45 },
      xpTotal: (eLive.xpTotal || 0) + 60,
      updatedAt: Date.now(),
    };
    ctrl.markGroupDirty('GRP1234567', eWithSession);
    t.mock.timers.tick(11_000);
    await Promise.resolve();
    assert.equal(writes.length, 3);

    ctrl.dispose();
  });

  it('prevents overlapping double-writes, retries transient failures, and blocks permission-denied groups', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
    t.mock.timers.setTime(new Date('2026-11-19T10:00:00Z').getTime());

    let releaseFirstWrite: () => void = () => {};
    let calls = 0;
    const ctrl = new GroupPublishBudgetController(
      async (gid) => {
        calls += 1;
        if (gid === 'GRP_CONCUR' && calls === 1) {
          await new Promise<void>((resolve) => {
            releaseFirstWrite = resolve;
          });
          return;
        }
        if (gid === 'GRP_FLAKY' && calls === 2) {
          throw new Error('unavailable: transient blip');
        }
        if (gid === 'GRP_DENIED') {
          const err = new Error('Missing or insufficient permissions');
          (err as { code?: string }).code = 'permission-denied';
          throw err;
        }
      },
      { initialOnline: true }
    );

    const state = createBlankState();
    const entry = buildMyMemberEntry(state, '2026-11-19', {
      joinedAt: 1000,
      sh: DEFAULT_SHARING_FLAGS,
      now: Date.now(),
    });

    // 1. Overlapping flushNow while already flushing must NOT trigger a second concurrent write
    ctrl.markGroupDirty('GRP_CONCUR', entry);
    const p1 = ctrl.flushNow(['GRP_CONCUR']);
    const p2 = ctrl.flushNow(['GRP_CONCUR']);
    assert.equal(calls, 1);
    releaseFirstWrite();
    await Promise.all([p1, p2]);
    assert.equal(calls, 1);
    ctrl.commitEntryHash('GRP_CONCUR', entry);

    // 2. Transient network error re-queues and retries instead of silently dropping
    ctrl.markGroupDirty('GRP_FLAKY', entry);
    await ctrl.flushNow(['GRP_FLAKY']);
    assert.equal(calls, 2);
    t.mock.timers.tick(16_000);
    await Promise.resolve();
    assert.equal(calls, 3);
    assert.equal(ctrl.isGroupBlocked('GRP_FLAKY'), false);

    // 3. permission-denied trips circuit-breaker so further dirty marks do not waste writes
    ctrl.markGroupDirty('GRP_DENIED', entry);
    await ctrl.flushNow(['GRP_DENIED']);
    assert.equal(ctrl.isGroupBlocked('GRP_DENIED'), true);
    const callsAfterDenied = calls;
    ctrl.markGroupDirty('GRP_DENIED', { ...entry, xpTotal: 999 });
    t.mock.timers.tick(30_000);
    await Promise.resolve();
    assert.equal(calls, callsAfterDenied);

    ctrl.dispose();
  });

  it('rejects stale group snapshots and preserves concurrent competitor updates when publishing', () => {
    const state = createBlankState();
    const me = buildMyMemberEntry(state, '2026-11-19', {
      joinedAt: 1000,
      sh: DEFAULT_SHARING_FLAGS,
      now: 2000,
    });
    const competitor = {
      ...me,
      nick: 'RivalTopper',
      days: { '2026-11-19': 180 },
      updatedAt: 5000,
    };

    const newerDoc: GroupDoc = {
      name: 'AIIMS Squad',
      emoji: '🩺',
      ownerUid: 'uid-me',
      createdAt: 1000,
      updatedAt: 5000,
      memberCap: 12,
      mockBoard: true,
      members: {
        'uid-me': me,
        'uid-rival': competitor,
      },
    };
    const existingCached: CachedGroupSnapshot = {
      groupId: 'GRP1234567',
      doc: newerDoc,
      fetchedAt: 5000,
      receivedCheers: [],
    };

    // Stale reconnect snapshot (updatedAt 3000 < 5000) must be rejected
    assert.equal(
      shouldAcceptGroupSnapshot(existingCached, { ...newerDoc, updatedAt: 3000 }),
      false
    );
    // Newer or equal snapshot is accepted
    assert.equal(
      shouldAcceptGroupSnapshot(existingCached, { ...newerDoc, updatedAt: 5000 }),
      true
    );
    assert.equal(
      shouldAcceptGroupSnapshot(existingCached, { ...newerDoc, updatedAt: 6000 }),
      true
    );

    // Merging our own member publish onto the latest cached snapshot keeps competitor's fresh data intact
    const myUpdated = { ...me, days: { '2026-11-19': 90 }, updatedAt: 6000 };
    const merged = mergeCachedGroupMemberUpdate(existingCached, 'uid-me', myUpdated, 6000);
    assert.ok(merged);
    assert.equal(merged.doc.members['uid-me'].days?.['2026-11-19'], 90);
    assert.equal(merged.doc.members['uid-rival'].days?.['2026-11-19'], 180);
    assert.equal(merged.doc.updatedAt, 6000);
  });
});
