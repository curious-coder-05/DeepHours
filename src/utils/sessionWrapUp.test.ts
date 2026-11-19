import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAPTER_CONFIDENCE_OPTIONS,
  MIN_SESSION_WRAPUP_MS,
  buildSessionWrapUpSummary,
  shouldOpenSessionWrapUp,
} from './sessionWrapUp.ts';

describe('sessionWrapUp — post-focus micro-capture gating & confidence options', () => {
  it('skips null, invalid, and trivial <60s sessions', () => {
    assert.equal(shouldOpenSessionWrapUp(null), false);
    assert.equal(shouldOpenSessionWrapUp(undefined), false);
    assert.equal(shouldOpenSessionWrapUp({ activeMs: 0 }), false);
    assert.equal(shouldOpenSessionWrapUp({ activeMs: 59_999 }), false);
    assert.equal(shouldOpenSessionWrapUp({ activeMs: Number.NaN }), false);
  });

  it('opens for completed or saved focus sessions >= 60s', () => {
    assert.equal(shouldOpenSessionWrapUp({ activeMs: MIN_SESSION_WRAPUP_MS }), true);
    assert.equal(shouldOpenSessionWrapUp({ activeMs: 25 * 60_000 }), true);
  });

  it('builds a clean summary and exposes all 1-5 chapter confidence levels', () => {
    const summary = buildSessionWrapUpSummary({
      id: 'ses_1',
      subjectId: 'sub_phy',
      chapterId: 'ch_rot',
      heading: 'Rotational Motion',
      dayKey: '2026-11-19',
      startTs: 1000,
      endTs: 1_501_000,
      activeMs: 1_500_000,
      pausedMs: 0,
      pauseCount: 0,
      overtimeMs: 0,
      purity: 98,
      mode: 'pomo',
      source: 'timer',
      rating: 5,
      note: '',
      updatedAt: 1_501_000,
    });

    assert.deepEqual(summary, {
      sessionId: 'ses_1',
      subjectId: 'sub_phy',
      chapterId: 'ch_rot',
      heading: 'Rotational Motion',
      activeMs: 1_500_000,
      purity: 98,
    });

    assert.deepEqual(
      CHAPTER_CONFIDENCE_OPTIONS.map((o) => o.value),
      [1, 2, 3, 4, 5]
    );
  });
});
