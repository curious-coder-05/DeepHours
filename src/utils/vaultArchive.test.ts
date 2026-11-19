import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_VAULT_ARCHIVE_ENTRIES,
  MAX_VAULT_IMAGE_BYTES,
  VAULT_ARCHIVE_FORMAT,
  VAULT_ARCHIVE_VERSION,
  base64ToBytes,
  buildVaultArchiveBundle,
  buildVaultArchiveFilename,
  bytesToBase64,
  decodeVaultBlob,
  formatVaultImportSummary,
  parseVaultArchiveJson,
  planVaultArchiveImport,
} from './vaultArchive.ts';
import type { VaultItem } from './vaultTypes.ts';

function makeItem(overrides: Partial<VaultItem> = {}): VaultItem {
  return {
    id: 'vq-1',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    subjectId: 'phy',
    chapterId: 'phy-kinematics',
    kind: 'unsolved',
    answerText: 'B',
    solutionText: 'Use conservation of mechanical energy at the highest point.',
    note: 'Forgot normal force = 0 at top',
    hasSolutionImage: false,
    qBytes: 4,
    width: 640,
    height: 480,
    mime: 'image/webp',
    mastered: false,
    revisionCount: 2,
    lastRevisedAt: 1_700_000_100_000,
    syncState: 'pending',
    ...overrides,
  };
}

describe('vaultArchive', () => {
  it('round-trips binary bytes via chunked base64', () => {
    const sample = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
    const encoded = bytesToBase64(sample);
    const decoded = base64ToBytes(encoded);
    assert.deepEqual(Array.from(decoded), Array.from(sample));
  });

  it('builds, serializes, parses, and restores question + solution blobs cleanly', async () => {
    const qBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x10, 0x20, 0x30]);
    const sBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a]);
    const qBlob = new Blob([qBytes], { type: 'image/webp' });
    const sBlob = new Blob([sBytes], { type: 'image/png' });

    const itemWithSol = makeItem({
      id: 'vq-sol',
      kind: 'hard',
      hasSolutionImage: true,
      qBytes: qBytes.byteLength,
      revisionCount: 4,
      mastered: false,
    });
    const deletedTombstone = makeItem({
      id: 'vq-deleted',
      deletedAt: 1_700_000_200_000,
    });

    const bundle = await buildVaultArchiveBundle(
      [
        {
          item: itemWithSol,
          qImage: { blob: qBlob, width: 800, height: 600, mime: 'image/webp' },
          sImage: { blob: sBlob, width: 720, height: 540, mime: 'image/png' },
        },
        {
          item: deletedTombstone,
          qImage: { blob: qBlob, width: 800, height: 600, mime: 'image/webp' },
        },
      ],
      1_700_000_500_000
    );

    assert.equal(bundle.format, VAULT_ARCHIVE_FORMAT);
    assert.equal(bundle.version, VAULT_ARCHIVE_VERSION);
    assert.equal(bundle.exportedAt, 1_700_000_500_000);
    assert.equal(bundle.itemCount, 1);
    assert.equal(bundle.entries.length, 1);

    const serialized = JSON.stringify(bundle);
    const parsed = parseVaultArchiveJson(serialized);

    assert.equal(parsed.itemCount, 1);
    assert.equal(parsed.entries[0].item.id, 'vq-sol');
    assert.equal(parsed.entries[0].item.kind, 'hard');
    assert.equal(parsed.entries[0].item.answerText, 'B');
    assert.equal(
      parsed.entries[0].item.solutionText,
      'Use conservation of mechanical energy at the highest point.'
    );
    assert.equal(parsed.entries[0].item.hasSolutionImage, true);
    assert.ok(parsed.entries[0].sImage);

    const restoredQ = decodeVaultBlob(parsed.entries[0].qImage);
    const restoredS = decodeVaultBlob(parsed.entries[0].sImage);
    assert.equal(restoredQ.mime, 'image/webp');
    assert.equal(restoredQ.width, 800);
    assert.equal(restoredQ.height, 600);
    assert.deepEqual(
      Array.from(new Uint8Array(await restoredQ.blob.arrayBuffer())),
      Array.from(qBytes)
    );
    assert.equal(restoredS.mime, 'image/png');
    assert.deepEqual(
      Array.from(new Uint8Array(await restoredS.blob.arrayBuffer())),
      Array.from(sBytes)
    );
  });

  it('deduplicates by ID and merges without overwriting newer local items', async () => {
    const qBlob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/webp' });
    const existingSame = makeItem({ id: 'vq-same', updatedAt: 2000 });
    const existingNewerLocal = makeItem({ id: 'vq-local-newer', updatedAt: 5000 });
    const existingOlderLocal = makeItem({ id: 'vq-update', updatedAt: 1000 });
    const existingUnrelated = makeItem({ id: 'vq-keep', updatedAt: 3000 });

    const bundle = await buildVaultArchiveBundle([
      {
        item: makeItem({ id: 'vq-same', updatedAt: 2000 }),
        qImage: { blob: qBlob, width: 400, height: 300, mime: 'image/webp' },
      },
      {
        item: makeItem({ id: 'vq-local-newer', updatedAt: 3000 }),
        qImage: { blob: qBlob, width: 400, height: 300, mime: 'image/webp' },
      },
      {
        item: makeItem({ id: 'vq-update', updatedAt: 4000, answerText: 'C' }),
        qImage: { blob: qBlob, width: 400, height: 300, mime: 'image/webp' },
      },
      {
        item: makeItem({ id: 'vq-new', updatedAt: 1500 }),
        qImage: { blob: qBlob, width: 400, height: 300, mime: 'image/webp' },
      },
      {
        item: makeItem({ id: 'vq-new', updatedAt: 2500, answerText: 'D' }),
        qImage: { blob: qBlob, width: 400, height: 300, mime: 'image/webp' },
      },
    ]);

    const plan = planVaultArchiveImport(
      [existingSame, existingNewerLocal, existingOlderLocal, existingUnrelated],
      bundle.entries
    );

    assert.equal(plan.addedCount, 1);
    assert.equal(plan.updatedCount, 1);
    assert.equal(plan.skippedCount, 2);
    assert.deepEqual(
      plan.toSave.map((e) => e.item.id).sort(),
      ['vq-new', 'vq-update']
    );
    const savedNew = plan.toSave.find((e) => e.item.id === 'vq-new');
    assert.equal(savedNew?.item.answerText, 'D');
  });

  it('rejects malformed JSON, unsupported archive formats, and corrupt image payloads', () => {
    assert.throws(() => parseVaultArchiveJson('{bad json'), /not valid JSON/);
    assert.throws(
      () => parseVaultArchiveJson(JSON.stringify({ format: 'wrong', version: 1, entries: [] })),
      /supported Deep Hours Vault archive/
    );
    assert.throws(
      () =>
        parseVaultArchiveJson(
          JSON.stringify({
            format: VAULT_ARCHIVE_FORMAT,
            version: VAULT_ARCHIVE_VERSION,
            entries: [
              {
                item: { id: 'vq-bad', subjectId: 'phy' },
                qImage: { dataUrl: 'data:text/plain;base64,SGVsbG8=' },
              },
            ],
          })
        ),
      /missing or corrupted image/
    );
  });

  it('blocks SVG/HTML XSS data URLs, ignores spoofed MIME headers, and strips prototype-pollution/untrusted fields', () => {
    const validPngDataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    const svgXssDataUrl = 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIi8+';

    // 1. SVG data URL must be rejected in both parseVaultArchiveJson and decodeVaultBlob
    assert.throws(
      () =>
        parseVaultArchiveJson(
          JSON.stringify({
            format: VAULT_ARCHIVE_FORMAT,
            version: VAULT_ARCHIVE_VERSION,
            entries: [
              {
                item: { id: 'vq-svg', subjectId: 'phy' },
                qImage: { mime: 'image/svg+xml', dataUrl: svgXssDataUrl },
              },
            ],
          })
        ),
      /missing or corrupted image/
    );
    assert.throws(
      () =>
        decodeVaultBlob({
          mime: 'image/webp',
          width: 100,
          height: 100,
          bytes: 16,
          dataUrl: svgXssDataUrl,
        }),
      /invalid or unsupported image/
    );

    // 2. Spoofed encoded.mime ('text/html' / 'image/svg+xml') must be ignored in favor of validated raster MIME
    const decoded = decodeVaultBlob({
      mime: 'text/html',
      width: 100,
      height: 100,
      bytes: 8,
      dataUrl: validPngDataUrl,
    });
    assert.equal(decoded.mime, 'image/png');
    assert.equal(decoded.blob.type, 'image/png');

    // 3. Prototype-pollution keys and unknown fields on item are stripped by reviver + strict allowlist
    const maliciousJson = `{"format":"${VAULT_ARCHIVE_FORMAT}","version":${VAULT_ARCHIVE_VERSION},"entries":[{"item":{"id":"vq-clean","subjectId":"phy","__proto__":{"polluted":true},"constructor":{"prototype":{"x":1}},"evilInjectedField":"bad","note":"safe"},"qImage":{"mime":"text/html","dataUrl":"${validPngDataUrl}"}}]}`;
    const parsed = parseVaultArchiveJson(maliciousJson);
    assert.equal(parsed.entries.length, 1);
    const cleanItem = parsed.entries[0].item as unknown as Record<string, unknown>;
    assert.equal(cleanItem.evilInjectedField, undefined);
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
    assert.equal(parsed.entries[0].qImage.mime, 'image/png');
    assert.equal(parsed.entries[0].item.mime, 'image/png');
  });

  it('rejects unpadded/corrupted base64, corrupted sImage, oversized images, and excess entry counts upfront', () => {
    const validPngDataUrl = 'data:image/png;base64,iVBORw0KGgo=';

    // Unpadded / invalid base64 length (not divisible by 4)
    assert.throws(
      () =>
        parseVaultArchiveJson(
          JSON.stringify({
            format: VAULT_ARCHIVE_FORMAT,
            version: VAULT_ARCHIVE_VERSION,
            entries: [
              {
                item: { id: 'vq-b64', subjectId: 'phy' },
                qImage: { dataUrl: 'data:image/webp;base64,ABC' },
              },
            ],
          })
        ),
      /missing or corrupted image/
    );

    // Corrupted solution image (sImage) must fail upfront rather than mid-transaction
    assert.throws(
      () =>
        parseVaultArchiveJson(
          JSON.stringify({
            format: VAULT_ARCHIVE_FORMAT,
            version: VAULT_ARCHIVE_VERSION,
            entries: [
              {
                item: { id: 'vq-sol-bad', subjectId: 'phy', hasSolutionImage: true },
                qImage: { dataUrl: validPngDataUrl },
                sImage: { dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' },
              },
            ],
          })
        ),
      /missing or corrupted solution image/
    );

    // Oversized image (> MAX_VAULT_IMAGE_BYTES) rejected
    const oversizedB64Len = Math.ceil(((MAX_VAULT_IMAGE_BYTES + 64) * 4) / 3 / 4) * 4;
    const oversizedDataUrl = `data:image/webp;base64,${'A'.repeat(oversizedB64Len)}`;
    assert.throws(
      () =>
        decodeVaultBlob({
          mime: 'image/webp',
          width: 1000,
          height: 1000,
          bytes: MAX_VAULT_IMAGE_BYTES + 64,
          dataUrl: oversizedDataUrl,
        }),
      /invalid or unsupported image/
    );

    // Excess entry count (> MAX_VAULT_ARCHIVE_ENTRIES) rejected
    const tooManyEntries = Array.from({ length: MAX_VAULT_ARCHIVE_ENTRIES + 1 }, () => null);
    assert.throws(
      () =>
        parseVaultArchiveJson(
          JSON.stringify({
            format: VAULT_ARCHIVE_FORMAT,
            version: VAULT_ARCHIVE_VERSION,
            entries: tooManyEntries,
          })
        ),
      /safety limit/
    );
  });

  it('formats archive filenames and toast summaries cleanly', () => {
    assert.equal(
      buildVaultArchiveFilename('2026-11-15'),
      'deep-hours-vault-2026-11-15.dhvault.json'
    );
    assert.equal(
      formatVaultImportSummary({ addedCount: 3, updatedCount: 0, skippedCount: 2, itemCount: 5 }),
      'Restored 3 questions (2 already up to date)'
    );
    assert.equal(
      formatVaultImportSummary({ addedCount: 0, updatedCount: 0, skippedCount: 4, itemCount: 4 }),
      'All 4 Vault questions already on this device'
    );
    assert.equal(
      formatVaultImportSummary({ addedCount: 0, updatedCount: 0, skippedCount: 0, itemCount: 0 }),
      'No questions found in this Vault archive'
    );
  });
});
