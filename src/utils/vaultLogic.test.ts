import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  INITIAL_REVEAL_STATE,
  buildVaultManifest,
  clampVaultSolutionText,
  clampVaultText,
  computeVaultCounts,
  filterVaultItems,
  mergeVaultManifest,
  orderRevisionDeck,
  parseVaultManifest,
  revealReducer,
} from './vaultLogic.ts';
import { VAULT_LIMITS, type VaultItem } from './vaultTypes.ts';

function makeVaultItem(overrides: Partial<VaultItem> = {}): VaultItem {
  return {
    id: 'vq_1',
    createdAt: 1000,
    updatedAt: 1000,
    subjectId: 'sub_phy',
    chapterId: 'ch_rot',
    kind: 'unsolved',
    mastered: false,
    hasSolutionImage: false,
    qBytes: 50_000,
    width: 1080,
    height: 720,
    mime: 'image/webp',
    revisionCount: 0,
    syncState: 'pending',
    ...overrides,
  };
}

describe('vaultLogic filtering, revision deck, reveal reducer, and Drive LWW merge', () => {
  it('computes accurate counts and filters by subject, chapter, status, and kind', () => {
    const items: VaultItem[] = [
      makeVaultItem({ id: 'a', subjectId: 'sub_phy', chapterId: 'ch_rot', kind: 'unsolved', mastered: false, qBytes: 40_000 }),
      makeVaultItem({ id: 'b', subjectId: 'sub_phy', chapterId: undefined, kind: 'hard', mastered: false, qBytes: 60_000 }),
      makeVaultItem({ id: 'c', subjectId: 'sub_chem', chapterId: 'ch_eq', kind: 'hard', mastered: true, masteredAt: 2000, qBytes: 30_000 }),
    ];

    const counts = computeVaultCounts(items);
    assert.equal(counts.total, 3);
    assert.equal(counts.active, 2);
    assert.equal(counts.mastered, 1);
    assert.equal(counts.unsolved, 1);
    assert.equal(counts.hard, 2);
    assert.equal(counts.totalBytes, 130_000);
    assert.equal(counts.bySubject.sub_phy.active, 2);
    assert.equal(counts.byChapter.__unassigned__.active, 1);

    assert.deepEqual(
      filterVaultItems(items, { subjectId: 'all', chapterId: '__unassigned__', status: 'all', kind: 'all' }).map((x) => x.id),
      ['b']
    );
    assert.deepEqual(
      filterVaultItems(items, { subjectId: 'all', chapterId: 'all', status: 'active', kind: 'hard' }).map((x) => x.id),
      ['b']
    );
    assert.deepEqual(
      filterVaultItems(items, { subjectId: 'all', chapterId: 'all', status: 'mastered', kind: 'all' }).map((x) => x.id),
      ['c']
    );
  });

  it('orders Revision Deck (never revised first, oldest lastRevisedAt) and shuffles without dropping items', () => {
    const items: VaultItem[] = [
      makeVaultItem({ id: 'rev_recent', createdAt: 100, lastRevisedAt: 900, mastered: false }),
      makeVaultItem({ id: 'rev_oldest', createdAt: 200, lastRevisedAt: 500, mastered: false }),
      makeVaultItem({ id: 'never_2', createdAt: 400, lastRevisedAt: undefined, mastered: false }),
      makeVaultItem({ id: 'never_1', createdAt: 300, lastRevisedAt: undefined, mastered: false }),
      makeVaultItem({ id: 'done', createdAt: 50, mastered: true, masteredAt: 950 }),
    ];

    const ordered = orderRevisionDeck(items, false);
    assert.deepEqual(
      ordered.map((x) => x.id),
      ['never_1', 'never_2', 'rev_oldest', 'rev_recent']
    );

    let seed = 0.25;
    const deterministicRng = () => {
      seed = (seed + 0.37) % 1;
      return seed;
    };
    const shuffled = orderRevisionDeck(items, true, deterministicRng);
    assert.equal(shuffled.length, 4);
    assert.deepEqual(
      shuffled.map((x) => x.id).sort(),
      ['never_1', 'never_2', 'rev_oldest', 'rev_recent'].sort()
    );
  });

  it('keeps two-stage reveal flags strictly independent', () => {
    let st = INITIAL_REVEAL_STATE;
    assert.deepEqual(st, { answerOpen: false, solutionOpen: false });

    st = revealReducer(st, { type: 'toggle_answer' });
    assert.deepEqual(st, { answerOpen: true, solutionOpen: false });

    st = revealReducer(st, { type: 'toggle_solution' });
    assert.deepEqual(st, { answerOpen: true, solutionOpen: true });

    st = revealReducer(st, { type: 'toggle_answer' });
    assert.deepEqual(st, { answerOpen: false, solutionOpen: true });

    st = revealReducer(st, { type: 'reset' });
    assert.deepEqual(st, { answerOpen: false, solutionOpen: false });
  });

  it('enforces answer (200), note (200), and solution (4000) length limits', () => {
    assert.equal(clampVaultText('   ', VAULT_LIMITS.answerMax), undefined);
    assert.equal(
      clampVaultText('x'.repeat(VAULT_LIMITS.answerMax + 50), VAULT_LIMITS.answerMax)?.length,
      VAULT_LIMITS.answerMax
    );
    assert.equal(
      clampVaultSolutionText('Line 1\r\n' + 'y'.repeat(VAULT_LIMITS.solutionMax + 20))?.length,
      VAULT_LIMITS.solutionMax
    );
  });

  it('merges manifests with LWW and tombstones + serializes cleanly', () => {
    const localItems = [
      makeVaultItem({ id: 'keep_local', updatedAt: 5000, answerText: '42', driveQId: 'dq_1' }),
      makeVaultItem({ id: 'stale_local', updatedAt: 1000, answerText: 'old' }),
      makeVaultItem({ id: 'revived_later', updatedAt: 9000, answerText: 'restored' }),
    ];
    const localTombstones = [{ id: 'del_local', deletedAt: 7000, driveQId: 'dq_del' }];

    const remoteManifest = buildVaultManifest(
      [
        makeVaultItem({ id: 'keep_local', updatedAt: 2000, answerText: 'older_remote', driveQId: 'dq_1' }),
        makeVaultItem({ id: 'stale_local', updatedAt: 6000, answerText: 'newer_remote', driveQId: 'dq_remote' }),
        makeVaultItem({ id: 'new_remote', updatedAt: 6500, driveQId: 'dq_new' }),
        makeVaultItem({ id: 'del_local', updatedAt: 3000, driveQId: 'dq_del' }),
      ],
      [{ id: 'revived_later', deletedAt: 4000 }],
      8000
    );

    const parsed = parseVaultManifest(JSON.stringify(remoteManifest));
    assert.ok(parsed);

    const merged = mergeVaultManifest(localItems, localTombstones, parsed);
    const mergedMap = new Map(merged.mergedItems.map((i) => [i.id, i]));

    // Local newer update wins
    assert.equal(mergedMap.get('keep_local')?.answerText, '42');
    // Remote newer update wins
    assert.equal(mergedMap.get('stale_local')?.answerText, 'newer_remote');
    // Newer local edit beats older remote tombstone
    assert.equal(mergedMap.get('revived_later')?.answerText, 'restored');
    // Newer local tombstone deletes older remote item and queues Drive blob deletion
    assert.equal(mergedMap.has('del_local'), false);
    assert.ok(merged.driveFileIdsToDelete.includes('dq_del'));
    // Brand new remote item needs blob download
    assert.deepEqual(
      merged.itemsNeedingBlobDownload.map((i) => i.id),
      ['new_remote']
    );
  });
});
