import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SHARING_FLAGS,
  GROUP_PUBLISH_DEBOUNCE_MS,
  GROUP_PUBLISH_MIN_INTERVAL_MS,
  GroupPublishBudgetController,
  buildMyMemberEntry,
  hashMemberEntry,
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
});
