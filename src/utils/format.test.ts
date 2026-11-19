import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatCountSummary, pluralWord, pluralize } from './format.ts';

describe('format — pluralization helpers', () => {
  it('pluralizes 0, 1, and multi-item counts accurately', () => {
    assert.equal(pluralize(0, 'habit'), '0 habits');
    assert.equal(pluralize(1, 'habit'), '1 habit');
    assert.equal(pluralize(2, 'habit'), '2 habits');
    assert.equal(pluralize(1, 'task'), '1 task');
    assert.equal(pluralize(0, 'task'), '0 tasks');
    assert.equal(pluralize(5, 'session'), '5 sessions');
    assert.equal(pluralize(1, 'day'), '1 day');
    assert.equal(pluralize(14, 'day'), '14 days');
  });

  it('supports custom irregular plurals and handles non-finite inputs safely', () => {
    assert.equal(pluralWord(1, 'study', 'studies'), 'study');
    assert.equal(pluralWord(3, 'study', 'studies'), 'studies');
    assert.equal(pluralize(0, 'entry', 'entries'), '0 entries');
    assert.equal(pluralize(1, 'entry', 'entries'), '1 entry');
    assert.equal(pluralize(Number.NaN, 'habit'), '0 habits');
    assert.equal(pluralize(-1, 'day'), '-1 day');
  });

  it('formats multi-metric count summaries cleanly', () => {
    assert.equal(
      formatCountSummary([
        { count: 1, singular: 'habit' },
        { count: 0, singular: 'task' },
      ]),
      '1 habit · 0 tasks'
    );
    assert.equal(
      formatCountSummary([
        { count: 3, singular: 'habit' },
        { count: 1, singular: 'task' },
      ]),
      '3 habits · 1 task'
    );
  });
});
