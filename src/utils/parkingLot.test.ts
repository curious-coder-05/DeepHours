import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addParkedThought,
  buildTaskPayloadFromThought,
  clearParkedThoughts,
  loadParkedThoughts,
  removeParkedThought,
  saveParkedThoughts,
} from './parkingLot';

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

test('parkingLot — add, persist, convert to Today task payload, dismiss, and clear', () => {
  const store = createMemoryStorage();
  let list = loadParkedThoughts(store);
  assert.equal(list.length, 0);

  // Ignores blank thoughts
  const emptyRes = addParkedThought(list, '   ');
  assert.equal(emptyRes.added, null);
  assert.equal(emptyRes.next.length, 0);

  // Adds normalized thoughts with subject metadata
  const r1 = addParkedThought(list, '  Check   Nernst equation sign convention  ', {
    subjectId: 'sub_chem',
    now: 1000,
  });
  assert.ok(r1.added);
  assert.equal(r1.added.text, 'Check Nernst equation sign convention');
  list = r1.next;

  const r2 = addParkedThought(list, 'Revise Plant Growth Regulators NCERT table', {
    subjectId: 'sub_bot',
    now: 2000,
  });
  assert.ok(r2.added);
  list = r2.next;

  // Persists and reloads cleanly
  saveParkedThoughts(list, store);
  const reloaded = loadParkedThoughts(store);
  assert.equal(reloaded.length, 2);
  assert.equal(reloaded[0].text, 'Check Nernst equation sign convention');

  // Converts to Today's task payload preserving subject
  const payload = buildTaskPayloadFromThought(reloaded[0], '2026-11-19', 'sub_phy');
  assert.deepEqual(payload, {
    title: 'Check Nernst equation sign convention',
    dayKey: '2026-11-19',
    subjectId: 'sub_chem',
  });

  // Removes handled note & clears remaining
  const afterRemove = removeParkedThought(reloaded, reloaded[0].id);
  assert.equal(afterRemove.length, 1);
  assert.equal(afterRemove[0].id, reloaded[1].id);

  const cleared = clearParkedThoughts();
  saveParkedThoughts(cleared, store);
  assert.equal(loadParkedThoughts(store).length, 0);
});
