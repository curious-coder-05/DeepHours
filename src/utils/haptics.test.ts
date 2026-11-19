import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { prefersReducedMotion, triggerHaptic } from './haptics.ts';

describe('haptics — safe reduced-motion-aware vibration helper', () => {
  it('fires 8ms tap, double-pulse success, and 14ms stop patterns when supported', () => {
    const calls: Array<number | number[]> = [];
    const env = {
      vibrate: (p: number | number[]) => {
        calls.push(p);
        return true;
      },
      matchMedia: () => ({ matches: false }),
    };

    assert.equal(triggerHaptic('tap', env), true);
    assert.equal(triggerHaptic('success', env), true);
    assert.equal(triggerHaptic('stop', env), true);

    assert.deepEqual(calls, [8, [10, 24, 14], 14]);
  });

  it('suppresses vibration when prefers-reduced-motion is enabled', () => {
    let called = false;
    const env = {
      vibrate: () => {
        called = true;
        return true;
      },
      matchMedia: (q: string) => ({ matches: q.includes('prefers-reduced-motion') }),
    };

    assert.equal(prefersReducedMotion(env), true);
    assert.equal(triggerHaptic('tap', env), false);
    assert.equal(called, false);
  });

  it('never throws when vibrate is unavailable or throws an error', () => {
    assert.equal(triggerHaptic('tap', { vibrate: null, matchMedia: null }), false);
    assert.equal(
      triggerHaptic('tap', {
        vibrate: () => {
          throw new Error('Blocked by browser policy');
        },
        matchMedia: () => {
          throw new Error('Unavailable');
        },
      }),
      false
    );
  });
});
