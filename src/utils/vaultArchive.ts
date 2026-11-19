import { sanitizeVaultItem } from './vaultLogic.ts';
import type { VaultItem } from './vaultTypes.ts';

export const VAULT_ARCHIVE_FORMAT = 'deep-hours-vault-archive' as const;
export const VAULT_ARCHIVE_VERSION = 1 as const;
export const VAULT_ARCHIVE_EXTENSION = '.dhvault.json' as const;
export const MAX_VAULT_ARCHIVE_BYTES = 60 * 1024 * 1024; // 60 MB archive ceiling
export const MAX_VAULT_ARCHIVE_ENTRIES = 2000;
export const MAX_VAULT_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB per decoded image ceiling

export const ALLOWED_VAULT_IMAGE_MIMES = new Set<string>([
  'image/webp',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/avif',
]);

function normalizeAllowedImageMime(rawMime: unknown): string | null {
  if (typeof rawMime !== 'string') return null;
  const cleaned = rawMime.trim().toLowerCase();
  const mapped = cleaned === 'image/jpg' ? 'image/jpeg' : cleaned;
  return ALLOWED_VAULT_IMAGE_MIMES.has(mapped) ? mapped : null;
}

function estimateBase64DecodedBytes(cleanB64: string): number {
  const len = cleanB64.length;
  if (len === 0) return 0;
  const pad = cleanB64.endsWith('==') ? 2 : cleanB64.endsWith('=') ? 1 : 0;
  return Math.floor((len * 3) / 4) - pad;
}

function parseValidatedDataUrl(dataUrl: unknown): {
  mime: string;
  cleanB64: string;
  decodedBytes: number;
  normalizedDataUrl: string;
} | null {
  if (typeof dataUrl !== 'string') return null;
  const trimmed = dataUrl.trim();
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(trimmed);
  if (!match) return null;
  const mime = normalizeAllowedImageMime(match[1]);
  if (!mime) return null;
  const cleanB64 = match[2].replace(/\s+/g, '');
  if (
    cleanB64.length === 0 ||
    cleanB64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(cleanB64)
  ) {
    return null;
  }
  const decodedBytes = estimateBase64DecodedBytes(cleanB64);
  if (decodedBytes <= 0 || decodedBytes > MAX_VAULT_IMAGE_BYTES) {
    return null;
  }
  return {
    mime,
    cleanB64,
    decodedBytes,
    normalizedDataUrl: `data:${mime};base64,${cleanB64}`,
  };
}

function safeJsonParseArchive(rawJson: string): unknown {
  return JSON.parse(rawJson, (key, value) => {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return undefined;
    }
    return value;
  });
}

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
  const parsed = parseValidatedDataUrl(encoded?.dataUrl);
  if (!parsed) {
    throw new Error('Vault archive contains an invalid or unsupported image payload.');
  }
  // Always derive MIME strictly from the validated raster data URL (ignore spoofed encoded.mime)
  const { mime, cleanB64 } = parsed;
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(cleanB64);
  } catch {
    throw new Error('Vault archive contains corrupted base64 image data.');
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_VAULT_IMAGE_BYTES) {
    throw new Error('Vault archive image exceeds the 5 MB safety limit.');
  }
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mime });
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

function extractValidatedEncodedBlob(
  val: unknown
): VaultArchiveEncodedBlob | null {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return null;
  const candidate = val as Partial<VaultArchiveEncodedBlob>;
  const parsed = parseValidatedDataUrl(candidate.dataUrl);
  if (!parsed) return null;
  // Verify base64 decodes cleanly upfront before any IndexedDB transaction begins
  try {
    atob(parsed.cleanB64);
  } catch {
    return null;
  }
  return {
    mime: parsed.mime,
    width: Math.max(0, Math.round(Number(candidate.width) || 0)),
    height: Math.max(0, Math.round(Number(candidate.height) || 0)),
    bytes: parsed.decodedBytes,
    dataUrl: parsed.normalizedDataUrl,
  };
}

export function parseVaultArchiveJson(rawJson: string): VaultArchiveBundle {
  if (typeof rawJson !== 'string' || rawJson.length === 0) {
    throw new Error('Selected file is not valid JSON.');
  }
  if (rawJson.length > MAX_VAULT_ARCHIVE_BYTES) {
    throw new Error('Vault archive is too large to import safely (60 MB limit).');
  }

  let parsed: unknown;
  try {
    parsed = safeJsonParseArchive(rawJson);
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

  if (obj.entries.length > MAX_VAULT_ARCHIVE_ENTRIES) {
    throw new Error(
      `Vault archive exceeds the ${MAX_VAULT_ARCHIVE_ENTRIES}-question safety limit.`
    );
  }

  const sanitizedEntries: VaultArchiveEntry[] = [];
  for (const rawEntry of obj.entries) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) continue;
    const entry = rawEntry as Partial<VaultArchiveEntry>;
    if (
      !entry.item ||
      typeof entry.item !== 'object' ||
      Array.isArray(entry.item) ||
      typeof entry.item.id !== 'string' ||
      !entry.item.id.trim() ||
      typeof entry.item.subjectId !== 'string' ||
      !entry.item.subjectId.trim()
    ) {
      continue;
    }

    const qValid = extractValidatedEncodedBlob(entry.qImage);
    if (!qValid) {
      throw new Error(`Question "${entry.item.id}" has a missing or corrupted image.`);
    }

    let sValid: VaultArchiveEncodedBlob | undefined;
    if (entry.sImage !== undefined && entry.sImage !== null) {
      const parsedSol = extractValidatedEncodedBlob(entry.sImage);
      if (!parsedSol) {
        throw new Error(
          `Question "${entry.item.id}" has a missing or corrupted solution image.`
        );
      }
      sValid = parsedSol;
    }

    const cleanItem = sanitizeVaultItem({
      ...entry.item,
      id: entry.item.id.trim(),
      subjectId: entry.item.subjectId.trim(),
      qBytes: qValid.bytes,
      mime: qValid.mime,
      hasSolutionImage: Boolean(sValid),
      syncState: 'pending',
    });

    sanitizedEntries.push({
      item: cleanItem,
      qImage: qValid,
      ...(sValid ? { sImage: sValid } : {}),
    });
  }

  return {
    format: VAULT_ARCHIVE_FORMAT,
    version: VAULT_ARCHIVE_VERSION,
    exportedAt:
      typeof obj.exportedAt === 'number' && Number.isFinite(obj.exportedAt)
        ? obj.exportedAt
        : Date.now(),
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
