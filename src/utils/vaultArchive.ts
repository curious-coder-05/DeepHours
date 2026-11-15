import { sanitizeVaultItem } from './vaultLogic.ts';
import type { VaultItem } from './vaultTypes.ts';

export const VAULT_ARCHIVE_FORMAT = 'deep-hours-vault-archive' as const;
export const VAULT_ARCHIVE_VERSION = 1 as const;
export const VAULT_ARCHIVE_EXTENSION = '.dhvault.json' as const;

export interface VaultArchiveEncodedBlob {
  mime: string;
  width: number;
  height: number;
  bytes: number;
  dataUrl: string;
}

export interface VaultArchiveEntry {
  item: VaultItem;
  qImage: VaultArchiveEncodedBlob;
  sImage?: VaultArchiveEncodedBlob;
}

export interface VaultArchiveBundle {
  format: typeof VAULT_ARCHIVE_FORMAT;
  version: typeof VAULT_ARCHIVE_VERSION;
  exportedAt: number;
  itemCount: number;
  entries: VaultArchiveEntry[];
}

export interface VaultArchiveSourceRecord {
  item: VaultItem;
  qImage?: {
    blob: Blob;
    width: number;
    height: number;
    mime: string;
  } | null;
  sImage?: {
    blob: Blob;
    width: number;
    height: number;
    mime: string;
  } | null;
}

export interface VaultArchiveImportPlan {
  toSave: VaultArchiveEntry[];
  addedCount: number;
  updatedCount: number;
  skippedCount: number;
}

export function buildVaultArchiveFilename(dayKey?: string): string {
  const cleanDay =
    typeof dayKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dayKey.trim())
      ? dayKey.trim()
      : (() => {
          const d = new Date();
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          return `${y}-${m}-${day}`;
        })();
  return `deep-hours-vault-${cleanDay}${VAULT_ARCHIVE_EXTENSION}`;
}

export function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    parts.push(String.fromCharCode(...slice));
  }
  return btoa(parts.join(''));
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export async function encodeVaultBlob(input: {
  blob: Blob;
  width: number;
  height: number;
  mime: string;
}): Promise<VaultArchiveEncodedBlob> {
  const mime = (input.mime || input.blob.type || 'image/webp').trim() || 'image/webp';
  const buf = await input.blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const base64 = bytesToBase64(bytes);
  return {
    mime,
    width: Math.max(0, Math.round(Number(input.width) || 0)),
    height: Math.max(0, Math.round(Number(input.height) || 0)),
    bytes: bytes.byteLength,
    dataUrl: `data:${mime};base64,${base64}`,
  };
}

export function decodeVaultBlob(encoded: VaultArchiveEncodedBlob): {
  blob: Blob;
  width: number;
  height: number;
  mime: string;
} {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(
    (encoded.dataUrl || '').trim()
  );
  if (!match) {
    throw new Error('Vault archive contains an invalid image payload.');
  }
  const mime = (encoded.mime || match[1] || 'image/webp').trim();
  const cleanB64 = match[2].replace(/\s+/g, '');
  const bytes = base64ToBytes(cleanB64);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: mime });
  return {
    blob,
    width: Math.max(0, Math.round(Number(encoded.width) || 0)),
    height: Math.max(0, Math.round(Number(encoded.height) || 0)),
    mime,
  };
}

export async function buildVaultArchiveBundle(
  records: readonly VaultArchiveSourceRecord[],
  exportedAt = Date.now()
): Promise<VaultArchiveBundle> {
  const entries: VaultArchiveEntry[] = [];

  for (const rec of records) {
    if (!rec.item || rec.item.deletedAt || !rec.qImage?.blob) {
      continue;
    }
    const qEncoded = await encodeVaultBlob(rec.qImage);
    const sEncoded =
      rec.item.hasSolutionImage && rec.sImage?.blob
        ? await encodeVaultBlob(rec.sImage)
        : undefined;

    const cleanItem = sanitizeVaultItem({
      ...rec.item,
      qBytes: qEncoded.bytes,
      mime: qEncoded.mime,
      width: qEncoded.width || rec.item.width,
      height: qEncoded.height || rec.item.height,
      hasSolutionImage: Boolean(sEncoded),
    });

    entries.push({
      item: cleanItem,
      qImage: qEncoded,
      ...(sEncoded ? { sImage: sEncoded } : {}),
    });
  }

  return {
    format: VAULT_ARCHIVE_FORMAT,
    version: VAULT_ARCHIVE_VERSION,
    exportedAt,
    itemCount: entries.length,
    entries,
  };
}

function isValidEncodedBlob(val: unknown): val is VaultArchiveEncodedBlob {
  if (!val || typeof val !== 'object') return false;
  const candidate = val as Partial<VaultArchiveEncodedBlob>;
  if (typeof candidate.dataUrl !== 'string') return false;
  return /^data:image\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=\r\n]+$/.test(
    candidate.dataUrl.trim()
  );
}

export function parseVaultArchiveJson(rawJson: string): VaultArchiveBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('Selected file is not valid JSON.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('This file is not a valid Deep Hours Vault archive (.dhvault.json).');
  }

  const obj = parsed as Partial<VaultArchiveBundle>;
  if (obj.format !== VAULT_ARCHIVE_FORMAT || obj.version !== VAULT_ARCHIVE_VERSION) {
    throw new Error('This file is not a supported Deep Hours Vault archive (.dhvault.json).');
  }

  if (!Array.isArray(obj.entries)) {
    throw new Error('Vault archive is missing question entries.');
  }

  const sanitizedEntries: VaultArchiveEntry[] = [];
  for (const rawEntry of obj.entries) {
    if (!rawEntry || typeof rawEntry !== 'object') continue;
    const entry = rawEntry as Partial<VaultArchiveEntry>;
    if (
      !entry.item ||
      typeof entry.item !== 'object' ||
      typeof entry.item.id !== 'string' ||
      !entry.item.id.trim() ||
      typeof entry.item.subjectId !== 'string' ||
      !entry.item.subjectId.trim()
    ) {
      continue;
    }
    if (!isValidEncodedBlob(entry.qImage)) {
      throw new Error(`Question "${entry.item.id}" has a missing or corrupted image.`);
    }

    const sValid = entry.sImage && isValidEncodedBlob(entry.sImage) ? entry.sImage : undefined;
    const cleanItem = sanitizeVaultItem({
      ...entry.item,
      id: entry.item.id.trim(),
      subjectId: entry.item.subjectId.trim(),
      hasSolutionImage: Boolean(sValid),
      syncState: 'pending',
    });

    sanitizedEntries.push({
      item: cleanItem,
      qImage: {
        mime: (entry.qImage.mime || 'image/webp').trim(),
        width: Math.max(0, Math.round(Number(entry.qImage.width) || 0)),
        height: Math.max(0, Math.round(Number(entry.qImage.height) || 0)),
        bytes: Math.max(0, Math.round(Number(entry.qImage.bytes) || 0)),
        dataUrl: entry.qImage.dataUrl.trim(),
      },
      ...(sValid
        ? {
            sImage: {
              mime: (sValid.mime || 'image/webp').trim(),
              width: Math.max(0, Math.round(Number(sValid.width) || 0)),
              height: Math.max(0, Math.round(Number(sValid.height) || 0)),
              bytes: Math.max(0, Math.round(Number(sValid.bytes) || 0)),
              dataUrl: sValid.dataUrl.trim(),
            },
          }
        : {}),
    });
  }

  return {
    format: VAULT_ARCHIVE_FORMAT,
    version: VAULT_ARCHIVE_VERSION,
    exportedAt: typeof obj.exportedAt === 'number' ? obj.exportedAt : Date.now(),
    itemCount: sanitizedEntries.length,
    entries: sanitizedEntries,
  };
}

export function planVaultArchiveImport(
  existingItems: readonly VaultItem[],
  incomingEntries: readonly VaultArchiveEntry[]
): VaultArchiveImportPlan {
  const existingById = new Map<string, VaultItem>();
  for (const item of existingItems) {
    if (item && !item.deletedAt) {
      existingById.set(item.id, item);
    }
  }

  // Deduplicate duplicate IDs inside the archive itself (newest updatedAt wins)
  const dedupedIncoming = new Map<string, VaultArchiveEntry>();
  for (const entry of incomingEntries) {
    if (!entry?.item?.id || entry.item.deletedAt) continue;
    const prev = dedupedIncoming.get(entry.item.id);
    if (!prev || (entry.item.updatedAt || 0) > (prev.item.updatedAt || 0)) {
      dedupedIncoming.set(entry.item.id, entry);
    }
  }

  const toSave: VaultArchiveEntry[] = [];
  let addedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  for (const entry of dedupedIncoming.values()) {
    const existing = existingById.get(entry.item.id);
    if (!existing) {
      addedCount += 1;
      toSave.push(entry);
    } else if ((entry.item.updatedAt || 0) > (existing.updatedAt || 0)) {
      updatedCount += 1;
      toSave.push(entry);
    } else {
      skippedCount += 1;
    }
  }

  return {
    toSave,
    addedCount,
    updatedCount,
    skippedCount,
  };
}

export function formatVaultImportSummary(result: {
  addedCount: number;
  updatedCount: number;
  skippedCount: number;
  itemCount?: number;
}): string {
  const { addedCount, updatedCount, skippedCount, itemCount } = result;
  const restored = addedCount + updatedCount;
  if (itemCount === 0 || (restored === 0 && skippedCount === 0)) {
    return 'No questions found in this Vault archive';
  }
  if (restored === 0) {
    return `All ${skippedCount} Vault question${skippedCount === 1 ? '' : 's'} already on this device`;
  }
  const parts: string[] = [];
  if (addedCount > 0) {
    parts.push(`Restored ${addedCount} question${addedCount === 1 ? '' : 's'}`);
  }
  if (updatedCount > 0) {
    parts.push(`updated ${updatedCount}`);
  }
  const base = parts.join(' & ');
  return skippedCount > 0
    ? `${base} (${skippedCount} already up to date)`
    : `${base} into Vault`;
}
