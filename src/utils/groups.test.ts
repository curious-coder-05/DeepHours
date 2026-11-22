import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SHARING_FLAGS,
  GROUP_PUBLISH_DEBOUNCE_MS,
  GROUP_PUBLISH_MIN_INTERVAL_MS,
  GroupPublishBudgetController,
  LIVE_AURA_MAX_AGE_MS,
  LIVE_AURA_MAX_FUTURE_MS,
  LIVE_AURA_START_DEBOUNCE_MS,
  LiveAuraPresenceController,
  buildActiveSessionAuraPayload,
  buildMyMemberEntry,
  formatLiveAuraElapsed,
  getActiveStudyingNowMembers,
  hashMemberEntry,
  isLiveAuraActive,
  loadLiveAuraPrivacyEnabled,
  mergeCachedGroupMemberUpdate,
  sanitizeActiveSessionAura,
  saveLiveAuraPrivacyEnabled,
  shouldAcceptGroupSnapshot,
  type ActiveSessionAura,
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

describe('Zero-Chat Live Co-Study Aura (v29)', () => {
  it('debounces session start by 15s (skipping quick start-cancel), publishes once without heartbeats, and clears cleanly to null on stop', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
    t.mock.timers.setTime(new Date('2026-11-20T09:00:00Z').getTime());

    assert.equal(LIVE_AURA_START_DEBOUNCE_MS, 15_000);

    const published: Array<ActiveSessionAura | null> = [];
    const ctrl = new LiveAuraPresenceController({
      enabled: true,
      onPublish: (aura) => {
        published.push(aura);
      },
    });

    const phyAura: ActiveSessionAura = {
      startedAt: Date.now(),
      subjectLabel: 'Physics',
      subjectColor: '#60A5FA',
    };

    // 1. Accidental start + cancel within 10s -> 0 writes!
    ctrl.handleSessionChange(phyAura);
    t.mock.timers.tick(10_000);
    assert.equal(published.length, 0);
    ctrl.handleSessionChange(null);
    t.mock.timers.tick(20_000);
    assert.equal(published.length, 0);

    // 2. Confirmed start past 15s -> exactly 1 write, even after 2 hours (zero heartbeats!)
    ctrl.handleSessionChange(phyAura);
    t.mock.timers.tick(14_999);
    assert.equal(published.length, 0);
    t.mock.timers.tick(1);
    assert.equal(published.length, 1);
    assert.deepEqual(published[0], phyAura);

    // Wait 2 hours: zero periodic heartbeat writes!
    t.mock.timers.tick(2 * 60 * 60_000);
    assert.equal(published.length, 1);

    // 3. Pause / Stop -> exactly 1 immediate null clear write
    ctrl.handleSessionChange(null);
    assert.equal(published.length, 2);
    assert.equal(published[1], null);

    // Duplicate stop emits 0 extra writes
    ctrl.handleSessionChange(null);
    assert.equal(published.length, 2);

    ctrl.dispose();
  });

  it('respects local privacy opt-out by skipping start writes and clearing active published aura', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
    t.mock.timers.setTime(new Date('2026-11-20T10:00:00Z').getTime());

    const published: Array<ActiveSessionAura | null> = [];
    const ctrl = new LiveAuraPresenceController({
      enabled: false,
      onPublish: (aura) => {
        published.push(aura);
      },
    });

    const aura: ActiveSessionAura = {
      startedAt: Date.now(),
      subjectLabel: 'Biology',
      subjectColor: '#34D399',
    };

    // Disabled -> 0 writes
    ctrl.handleSessionChange(aura);
    t.mock.timers.tick(60_000);
    assert.equal(published.length, 0);

    // Enable -> publishes after 15s
    ctrl.setEnabled(true);
    ctrl.handleSessionChange(aura);
    t.mock.timers.tick(15_000);
    assert.equal(published.length, 1);

    // Turn privacy switch OFF while studying -> immediately clears to null
    ctrl.setEnabled(false);
    assert.equal(published.length, 2);
    assert.equal(published[1], null);

    // Storage persistence helper check
    const mem = new Map<string, string>();
    const fakeStore = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
    };
    assert.equal(loadLiveAuraPrivacyEnabled(fakeStore), true);
    saveLiveAuraPrivacyEnabled(false, fakeStore);
    assert.equal(loadLiveAuraPrivacyEnabled(fakeStore), false);
    saveLiveAuraPrivacyEnabled(true, fakeStore);
    assert.equal(loadLiveAuraPrivacyEnabled(fakeStore), true);

    ctrl.dispose();
  });

  it('filters out stale (>6h) and future (>5m) activeSession auras and formats live durations cleanly', () => {
    const now = Date.parse('2026-11-20T12:00:00Z');
    assert.equal(LIVE_AURA_MAX_AGE_MS, 21_600_000);
    assert.equal(LIVE_AURA_MAX_FUTURE_MS, 300_000);

    const freshAura: ActiveSessionAura = {
      startedAt: now - 42 * 60_000,
      subjectLabel: 'Physics',
      subjectColor: '#60A5FA',
    };
    const staleAura: ActiveSessionAura = {
      startedAt: now - LIVE_AURA_MAX_AGE_MS - 1_000,
      subjectLabel: 'Chemistry',
      subjectColor: '#F59E0B',
    };
    const futureAura: ActiveSessionAura = {
      startedAt: now + LIVE_AURA_MAX_FUTURE_MS + 1_000,
      subjectLabel: 'Biology',
      subjectColor: '#34D399',
    };

    assert.equal(isLiveAuraActive(freshAura, now), true);
    assert.equal(isLiveAuraActive(staleAura, now), false);
    assert.equal(isLiveAuraActive(futureAura, now), false);
    assert.equal(isLiveAuraActive(null, now), false);

    assert.equal(formatLiveAuraElapsed(now - 20_000, now), '<1m');
    assert.equal(formatLiveAuraElapsed(now - 42 * 60_000, now), '42m');
    assert.equal(formatLiveAuraElapsed(now - 72 * 60_000, now), '1h 12m');
    assert.equal(formatLiveAuraElapsed(now - 120 * 60_000, now), '2h');

    // Sanitizer rejects invalid colors/empty labels
    assert.equal(sanitizeActiveSessionAura({ startedAt: now, subjectLabel: '' }), null);
    const sanitized = sanitizeActiveSessionAura({
      startedAt: now,
      subjectLabel: 'Physics',
      subjectColor: 'javascript:alert(1)',
    });
    assert.deepEqual(sanitized, {
      startedAt: now,
      subjectLabel: 'Physics',
      subjectColor: '#F5C542',
    });
    const sanitizedRgb = sanitizeActiveSessionAura({
      startedAt: now + 0.75,
      subjectLabel: 'Physics',
      subjectColor: 'rgb(255, 0, 0)',
    });
    assert.deepEqual(sanitizedRgb, {
      startedAt: Math.floor(now),
      subjectLabel: 'Physics',
      subjectColor: '#F5C542',
    });

    // Squad filtering only keeps active members (excludes stale >6h and future >5m)
    const state = createBlankState();
    const baseEntry = buildMyMemberEntry(state, '2026-11-20', {
      joinedAt: 1000,
      sh: { ...DEFAULT_SHARING_FLAGS, l: true },
      now,
    });
    const doc: GroupDoc = {
      name: 'NEET 2027',
      emoji: '🩺',
      ownerUid: 'u1',
      createdAt: 1000,
      updatedAt: now,
      memberCap: 30,
      mockBoard: true,
      members: {
        u1: { ...baseEntry, nick: 'ActiveKid', activeSession: freshAura },
        u2: { ...baseEntry, nick: 'StaleGhost', activeSession: staleAura },
        u3: { ...baseEntry, nick: 'FutureClock', activeSession: futureAura },
        u4: { ...baseEntry, nick: 'PrivateUser', sh: { ...DEFAULT_SHARING_FLAGS, l: false }, activeSession: freshAura },
      },
    };
    const active = getActiveStudyingNowMembers(doc, now, now);
    assert.equal(active.length, 1);
    assert.equal(active[0].uid, 'u1');
    assert.equal(active[0].subjectLabel, 'Physics');
    assert.equal(active[0].elapsedLabel, '42m');
    assert.equal(active[0].isLiveAura, true);
  });

  it('builds canonical aura payloads for Full Mock, Exam Hall, and single subjects', () => {
    const ts = 1_760_000_000_000;
    assert.deepEqual(
      buildActiveSessionAuraPayload({
        startedAt: ts,
        isExamHall: true,
      }),
      { startedAt: ts, subjectLabel: 'Exam Hall', subjectColor: '#F5C451' }
    );
    assert.deepEqual(
      buildActiveSessionAuraPayload({
        startedAt: ts,
        mode: 'fullMock',
        subjectId: 'sub_All_Subjects',
      }),
      { startedAt: ts, subjectLabel: 'Full Mock', subjectColor: '#F5C451' }
    );
    assert.deepEqual(
      buildActiveSessionAuraPayload({
        startedAt: ts,
        mode: 'pomodoro',
        subjectId: 'sub_phy',
        subjectName: 'Physics',
        subjectColor: '#60A5FA',
      }),
      { startedAt: ts, subjectLabel: 'Physics', subjectColor: '#60A5FA' }
    );
  });
});

