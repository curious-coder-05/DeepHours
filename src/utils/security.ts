/**
 * Deep Hours Shared Security & Resilience Utilities (v41)
 * - Prototype pollution defense (`safeJsonParse`, `stripDangerousKeys`)
 * - Strict raster image magic-byte signature validation (JPEG / PNG / WebP only)
 * - RFC-4180 CSV cell encoding with formula-injection neutralization
 * - Control-character stripping and length bounding
 * - Quota-safe `localStorage` helpers with global QuotaExceeded notification hook
 * - Local-timezone calendar date-key formatting (IST UTC+5:30 safe)
 * - Client-side write cooldown rate limiter
 * - Firestore security-rule contract validators (mirrors `firestore.rules` v24)
 */

export const DANGEROUS_OBJECT_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

export function isDangerousKey(key: string): boolean {
  return DANGEROUS_OBJECT_KEYS.has(key);
}

/**
 * Recursively clones plain objects/arrays while stripping `__proto__`,
 * `constructor`, and `prototype` keys to neutralize prototype pollution.
 */
export function stripDangerousKeys<T>(value: T, depth = 0): T {
  if (depth > 48 || value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => stripDangerousKeys(item, depth + 1)) as unknown as T;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    return value;
  }
  const clean: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (isDangerousKey(key)) continue;
    clean[key] = stripDangerousKeys(
      (value as Record<string, unknown>)[key],
      depth + 1
    );
  }
  return clean as T;
}

/**
 * Parses JSON while stripping prototype-pollution keys during reviver execution
 * and recursively sanitizing the resulting object graph. Throws on invalid JSON.
 */
export function safeJsonParseStrict(raw: string): unknown {
  const parsed: unknown = JSON.parse(raw, (key, value) => {
    if (isDangerousKey(key)) {
      return undefined;
    }
    return value;
  });
  return stripDangerousKeys(parsed);
}

/**
 * Safe JSON parser that never throws and never permits prototype-pollution keys.
 */
export function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T;
export function safeJsonParse<T = unknown>(
  raw: string | null | undefined
): T | undefined;
export function safeJsonParse<T>(
  raw: string | null | undefined,
  fallback?: T
): T | undefined {
  if (typeof raw !== 'string' || raw.length === 0) {
    return fallback;
  }
  try {
    return safeJsonParseStrict(raw) as T;
  } catch {
    return fallback;
  }
}

/* ── Strict Raster Image Magic-Byte Validation ── */

export type AllowedRasterImageMime =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp';

export const ALLOWED_RASTER_IMAGE_MIMES = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export const MAX_IMAGE_PIXEL_DIMENSION = 12_000;
export const MAX_IMAGE_TOTAL_PIXELS = 48_000_000; // 48 MP decompression-bomb cap

const FORBIDDEN_IMAGE_EXTENSIONS = /\.(svgz?|html?|xhtml|xml|txt|js|mjs|cjs|pdf|php|sh|exe)$/i;
const ALLOWED_RASTER_EXTENSIONS = /\.(jpe?g|png|webp)$/i;

export function normalizeAllowedRasterMime(
  rawMime: unknown
): AllowedRasterImageMime | null {
  if (typeof rawMime !== 'string') return null;
  const cleaned = rawMime.trim().toLowerCase();
  const mapped = cleaned === 'image/jpg' ? 'image/jpeg' : cleaned;
  if (ALLOWED_RASTER_IMAGE_MIMES.has(mapped)) {
    return mapped as AllowedRasterImageMime;
  }
  return null;
}

/**
 * Inspects binary header bytes to identify JPEG, PNG, or WebP raster images.
 * Rejects SVG, HTML, plain text, GIF, AVIF, BMP, and arbitrary binaries.
 */
export function detectImageMagicBytes(
  bytes: Uint8Array
): AllowedRasterImageMime | null {
  if (!bytes || bytes.length < 3) return null;

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A (8 bytes)
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }

  // WebP: "RIFF" (bytes 0..3) + 4-byte chunk size + "WEBP" (bytes 8..11)
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  ) {
    return 'image/webp';
  }

  return null;
}

/**
 * Fast synchronous metadata pre-check for candidate image files.
 * Strictly allows JPG, PNG, and WebP only — explicitly rejects SVG, HTML, and text.
 */
export function validateRasterImageMetadata(
  file: { type?: string; size: number; name?: string },
  maxBytes = 25 * 1024 * 1024
): { ok: boolean; reason?: string } {
  const type = (file.type || '').trim().toLowerCase();
  const name = (file.name || '').trim().toLowerCase();

  if (
    type.includes('svg') ||
    type.includes('html') ||
    type.includes('xml') ||
    type.startsWith('text/') ||
    FORBIDDEN_IMAGE_EXTENSIONS.test(name)
  ) {
    return {
      ok: false,
      reason: 'SVG, HTML, and text files are blocked. Please choose a JPG, PNG, or WebP photo.',
    };
  }

  const normalizedMime = normalizeAllowedRasterMime(type);
  const validExt = ALLOWED_RASTER_EXTENSIONS.test(name);
  // If browser supplied a non-empty MIME, it must be in the raster allowlist.
  // If MIME is empty (some Android file pickers), require an allowed raster extension.
  if (type ? !normalizedMime : !validExt) {
    return {
      ok: false,
      reason: 'Please choose a JPG, PNG, or WebP image file.',
    };
  }

  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, reason: 'The selected image file is empty.' };
  }
  if (file.size > maxBytes) {
    const maxMb = Math.max(1, Math.round(maxBytes / (1024 * 1024)));
    return {
      ok: false,
      reason: `Image exceeds the ${maxMb} MB limit. Please crop or choose a smaller photo.`,
    };
  }
  return { ok: true };
}

/**
 * Full binary signature verification on an uploaded File/Blob.
 * Reads the first 16 bytes and confirms authentic JPEG, PNG, or WebP magic bytes.
 */
export async function validateImageFileSignature(
  file: Blob & { name?: string; type?: string },
  maxBytes = 25 * 1024 * 1024
): Promise<{
  ok: boolean;
  detectedMime?: AllowedRasterImageMime;
  reason?: string;
}> {
  const metaCheck = validateRasterImageMetadata(
    { type: file.type, size: file.size, name: file.name },
    maxBytes
  );
  if (!metaCheck.ok) {
    return metaCheck;
  }

  let headerBytes: Uint8Array;
  try {
    const slice = file.slice(0, 16);
    const buf = await slice.arrayBuffer();
    headerBytes = new Uint8Array(buf);
  } catch {
    return { ok: false, reason: 'Could not read image header bytes.' };
  }

  const detectedMime = detectImageMagicBytes(headerBytes);
  if (!detectedMime) {
    return {
      ok: false,
      reason:
        'File signature is not a valid JPG, PNG, or WebP image. Spoofed or vector files are blocked.',
    };
  }

  return { ok: true, detectedMime };
}

export function validateImagePixelBounds(
  width: number,
  height: number
): { ok: boolean; reason?: string } {
  const w = Math.round(Number(width));
  const h = Math.round(Number(height));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { ok: false, reason: 'Image has invalid dimensions.' };
  }
  if (
    w > MAX_IMAGE_PIXEL_DIMENSION ||
    h > MAX_IMAGE_PIXEL_DIMENSION ||
    w * h > MAX_IMAGE_TOTAL_PIXELS
  ) {
    return {
      ok: false,
      reason: 'Image resolution exceeds safety limits (max 12,000 px / 48 MP).',
    };
  }
  return { ok: true };
}

/* ── CSV Formula-Injection Neutralization (RFC-4180) ── */

const CSV_FORMULA_TRIGGER_RE = /^[\t\r]|^[ \t\r\n\u0000-\u001f]*[=+\-@]/;

/**
 * Neutralizes spreadsheet formula injection (`=`, `+`, `-`, `@`, `\t`, `\r` at
 * start or after leading whitespace) and applies RFC-4180 double-quote escaping.
 */
export function sanitizeCsvCell(value: unknown): string {
  const raw =
    value === null || value === undefined
      ? ''
      : String(value).replace(/\u0000/g, '');
  const needsFormulaGuard =
    raw.length > 0 &&
    (raw[0] === '\t' ||
      raw[0] === '\r' ||
      CSV_FORMULA_TRIGGER_RE.test(raw));
  const guarded = needsFormulaGuard ? `'${raw}` : raw;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function encodeCsvRow(cells: readonly unknown[]): string {
  return cells.map((cell) => sanitizeCsvCell(cell)).join(',');
}

/* ── Control-Character Stripping & Text Bounding ── */

export function sanitizeTextControlChars(
  input: unknown,
  maxLen: number,
  options?: { allowNewlines?: boolean; stripAngleBrackets?: boolean }
): string {
  if (typeof input !== 'string') return '';
  const pattern = options?.allowNewlines
    ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
    : /[\u0000-\u001F\u007F]/g;
  let cleaned = input.replace(pattern, '');
  if (options?.stripAngleBrackets) {
    cleaned = cleaned.replace(/[<>]/g, '');
  }
  return cleaned.trim().slice(0, Math.max(0, maxLen));
}

/* ── Safe localStorage Wrapper & Quota-Exceeded Hook ── */

export interface SafeStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

type QuotaListener = (key: string) => void;
const quotaListeners = new Set<QuotaListener>();
let lastQuotaEmitTs = 0;

export function onStorageQuotaExceeded(listener: QuotaListener): () => void {
  quotaListeners.add(listener);
  return () => {
    quotaListeners.delete(listener);
  };
}

export function isQuotaExceededError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: number; message?: string };
  if (
    e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.code === 22 ||
    e.code === 1014
  ) {
    return true;
  }
  return typeof e.message === 'string' && /quota/i.test(e.message);
}

function notifyQuotaExceeded(key: string): void {
  const now = Date.now();
  // Throttle to at most once every 10s so rapid saves never spam toasts
  if (now - lastQuotaEmitTs < 10_000) return;
  lastQuotaEmitTs = now;
  for (const listener of quotaListeners) {
    try {
      listener(key);
    } catch {
      // ignore listener errors
    }
  }
}

export function resolveSafeStorage(
  storage?: SafeStorageLike | null
): SafeStorageLike | null {
  if (storage) return storage;
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage;
    }
  } catch {
    // Private browsing or blocked storage SecurityError
  }
  return null;
}

export function safeLocalStorageGet(
  key: string,
  storage?: SafeStorageLike | null
): string | null {
  const store = resolveSafeStorage(storage);
  if (!store) return null;
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

export function safeLocalStorageSet(
  key: string,
  value: string,
  storage?: SafeStorageLike | null
): { ok: boolean; quotaExceeded: boolean } {
  const store = resolveSafeStorage(storage);
  if (!store) return { ok: false, quotaExceeded: false };
  try {
    store.setItem(key, value);
    return { ok: true, quotaExceeded: false };
  } catch (err) {
    const quotaExceeded = isQuotaExceededError(err);
    if (quotaExceeded) {
      notifyQuotaExceeded(key);
    }
    return { ok: false, quotaExceeded };
  }
}

export function safeLocalStorageRemove(
  key: string,
  storage?: SafeStorageLike | null
): boolean {
  const store = resolveSafeStorage(storage);
  if (!store || typeof store.removeItem !== 'function') return false;
  try {
    store.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function safeLocalStorageGetJson<T>(
  key: string,
  fallback: T,
  storage?: SafeStorageLike | null
): T {
  const raw = safeLocalStorageGet(key, storage);
  if (raw === null) return fallback;
  return safeJsonParse<T>(raw, fallback);
}

/* ── Local Midnight Date-Key Helper (IST UTC+5:30 Safe) ── */

/**
 * Formats a timestamp or Date as a local calendar `YYYY-MM-DD` string using
 * local year/month/day (never `toISOString()` UTC shifting).
 */
export function formatLocalDateKey(input: Date | number = new Date()): string {
  const d = input instanceof Date ? input : new Date(input);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* ── Client-Side Write Cooldown Guard ── */

export interface CooldownGuard {
  tryAcquire(key?: string): { allowed: boolean; remainingMs: number };
  reset(key?: string): void;
}

export function createCooldownGuard(
  cooldownMs: number,
  getNow: () => number = () => Date.now()
): CooldownGuard {
  const lastByKey = new Map<string, number>();
  const safeCooldown = Math.max(0, cooldownMs);

  return {
    tryAcquire(key = '__default__') {
      const now = getNow();
      const prev = lastByKey.get(key) ?? -Infinity;
      const elapsed = now - prev;
      if (elapsed < safeCooldown) {
        return {
          allowed: false,
          remainingMs: Math.max(1, Math.ceil(safeCooldown - elapsed)),
        };
      }
      lastByKey.set(key, now);
      return { allowed: true, remainingMs: 0 };
    },
    reset(key?: string) {
      if (key === undefined) {
        lastByKey.clear();
      } else {
        lastByKey.delete(key);
      }
    },
  };
}

/* ── Firestore Rules v24 Contract Validators (for unit testing & pre-flight verification) ── */

const ALLOWED_MEMBER_KEYS = new Set([
  'nick',
  'emoji',
  'examYear',
  'joinedAt',
  'updatedAt',
  'sh',
  'paused',
  'days',
  'xpDays',
  'xpTotal',
  'streak',
  'consistency',
  'mocks',
  'live',
  'activeSession',
  'weeks',
]);

const REQUIRED_MEMBER_KEYS = ['nick', 'emoji', 'joinedAt', 'updatedAt', 'sh'];
const ALLOWED_SH_KEYS = new Set(['t', 'x', 's', 'm', 'l']);
const ALLOWED_CHEER_KEYS = new Set(['from', 'to', 'fromNick', 'dayKey', 'e', 'ts']);
const ALLOWED_CHEER_SET = new Set(['👏', '🔥', '💪']);

export function validateFirestoreMemberEntryContract(
  entry: unknown
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return { ok: false, errors: ['MemberEntry must be a plain map'] };
  }
  const m = entry as Record<string, unknown>;
  const keys = Object.keys(m);

  for (const req of REQUIRED_MEMBER_KEYS) {
    if (!(req in m)) errors.push(`Missing required key: ${req}`);
  }
  for (const k of keys) {
    if (!ALLOWED_MEMBER_KEYS.has(k)) {
      errors.push(`Disallowed MemberEntry key: ${k}`);
    }
  }
  if ('email' in m || 'photoURL' in m || 'photoUrl' in m) {
    errors.push('PII leak: email/photoURL must never appear in MemberEntry');
  }
  if (typeof m.nick !== 'string' || m.nick.length < 2 || m.nick.length > 20) {
    errors.push('nick must be 2..20 chars');
  }
  if (typeof m.emoji !== 'string' || m.emoji.length < 1 || m.emoji.length > 8) {
    errors.push('emoji must be 1..8 chars');
  }
  if (!Number.isInteger(m.joinedAt) || (m.joinedAt as number) <= 0) {
    errors.push('joinedAt must be positive int');
  }
  if (!Number.isInteger(m.updatedAt) || (m.updatedAt as number) <= 0) {
    errors.push('updatedAt must be positive int');
  }
  if (
    'examYear' in m &&
    (!Number.isInteger(m.examYear) ||
      (m.examYear as number) < 2020 ||
      (m.examYear as number) > 2035)
  ) {
    errors.push('examYear must be int in 2020..2035');
  }
  if ('paused' in m && typeof m.paused !== 'boolean') {
    errors.push('paused must be boolean');
  }

  if (!m.sh || typeof m.sh !== 'object' || Array.isArray(m.sh)) {
    errors.push('sh must be a map');
  } else {
    const sh = m.sh as Record<string, unknown>;
    const shKeys = Object.keys(sh);
    if (shKeys.length !== 5 || shKeys.some((k) => !ALLOWED_SH_KEYS.has(k))) {
      errors.push('sh must have exact keys t,x,s,m,l');
    }
    for (const k of ALLOWED_SH_KEYS) {
      if (typeof sh[k] !== 'boolean') errors.push(`sh.${k} must be boolean`);
    }
  }

  if ('days' in m) {
    if (!m.days || typeof m.days !== 'object' || Array.isArray(m.days)) {
      errors.push('days must be a map');
    } else if (Object.keys(m.days).length > 25) {
      errors.push('days size must be <= 25');
    }
  }
  if ('xpDays' in m) {
    if (!m.xpDays || typeof m.xpDays !== 'object' || Array.isArray(m.xpDays)) {
      errors.push('xpDays must be a map');
    } else if (Object.keys(m.xpDays).length > 25) {
      errors.push('xpDays size must be <= 25');
    }
  }
  if (
    'xpTotal' in m &&
    (!Number.isInteger(m.xpTotal) ||
      (m.xpTotal as number) < 0 ||
      (m.xpTotal as number) > 10_000_000)
  ) {
    errors.push('xpTotal must be int in 0..10000000');
  }
  if (
    'streak' in m &&
    (!Number.isInteger(m.streak) ||
      (m.streak as number) < 0 ||
      (m.streak as number) > 3650)
  ) {
    errors.push('streak must be int in 0..3650');
  }
  if (
    'consistency' in m &&
    (!Number.isInteger(m.consistency) ||
      (m.consistency as number) < 0 ||
      (m.consistency as number) > 100)
  ) {
    errors.push('consistency must be int in 0..100');
  }

  if ('mocks' in m) {
    if (!Array.isArray(m.mocks) || m.mocks.length > 10) {
      errors.push('mocks must be list of <= 10 items');
    } else {
      for (const item of m.mocks) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          errors.push('mock point must be map');
          continue;
        }
        const mp = item as Record<string, unknown>;
        const mpKeys = Object.keys(mp);
        if (
          mpKeys.length !== 3 ||
          !('d' in mp) ||
          !('s' in mp) ||
          !('m' in mp)
        ) {
          errors.push('mock point must have exact keys d,s,m');
        }
        if (typeof mp.d !== 'string' || mp.d.length !== 10) {
          errors.push('mock.d must be 10-char YYYY-MM-DD');
        }
        if (
          !Number.isInteger(mp.s) ||
          (mp.s as number) < -1000 ||
          (mp.s as number) > 1000
        ) {
          errors.push('mock.s must be int in -1000..1000');
        }
        if (
          !Number.isInteger(mp.m) ||
          (mp.m as number) < 1 ||
          (mp.m as number) > 2000
        ) {
          errors.push('mock.m must be int in 1..2000');
        }
      }
    }
  }

  if ('activeSession' in m && m.activeSession !== null) {
    const a = m.activeSession as Record<string, unknown>;
    if (!a || typeof a !== 'object' || Array.isArray(a)) {
      errors.push('activeSession must be null or map');
    } else {
      const aKeys = Object.keys(a);
      if (
        aKeys.length !== 3 ||
        !('startedAt' in a) ||
        !('subjectLabel' in a) ||
        !('subjectColor' in a)
      ) {
        errors.push('activeSession must have exact keys startedAt,subjectLabel,subjectColor');
      }
      if (typeof a.startedAt !== 'number' || !Number.isFinite(a.startedAt) || a.startedAt <= 0) {
        errors.push('activeSession.startedAt must be positive number');
      }
      if (
        typeof a.subjectLabel !== 'string' ||
        a.subjectLabel.length < 1 ||
        a.subjectLabel.length > 40
      ) {
        errors.push('activeSession.subjectLabel must be 1..40 chars');
      }
      if (
        typeof a.subjectColor !== 'string' ||
        a.subjectColor.length < 1 ||
        a.subjectColor.length > 24
      ) {
        errors.push('activeSession.subjectColor must be 1..24 chars');
      }
    }
  }

  if ('weeks' in m) {
    if (!m.weeks || typeof m.weeks !== 'object' || Array.isArray(m.weeks)) {
      errors.push('weeks must be map');
    } else if (Object.keys(m.weeks).length > 14) {
      errors.push('weeks size must be <= 14');
    }
  }

  return { ok: errors.length === 0, errors };
}

export function validateFirestoreCheerContract(
  cheerId: string,
  cheer: unknown
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!cheer || typeof cheer !== 'object' || Array.isArray(cheer)) {
    return { ok: false, errors: ['Cheer must be a plain map'] };
  }
  const c = cheer as Record<string, unknown>;
  const keys = Object.keys(c);
  if (keys.length !== 6 || keys.some((k) => !ALLOWED_CHEER_KEYS.has(k))) {
    errors.push('Cheer must have exact keys from,to,fromNick,dayKey,e,ts');
  }
  if (typeof c.from !== 'string' || !c.from) errors.push('from must be non-empty string');
  if (typeof c.to !== 'string' || !c.to) errors.push('to must be non-empty string');
  if (c.from === c.to) errors.push('Self-cheer is forbidden');
  if (
    typeof c.fromNick !== 'string' ||
    c.fromNick.length < 1 ||
    c.fromNick.length > 20
  ) {
    errors.push('fromNick must be 1..20 chars');
  }
  if (typeof c.dayKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(c.dayKey)) {
    errors.push('dayKey must be YYYY-MM-DD');
  }
  if (typeof c.e !== 'string' || !ALLOWED_CHEER_SET.has(c.e)) {
    errors.push('e must be one of 👏, 🔥, 💪');
  }
  if (!Number.isInteger(c.ts) || (c.ts as number) <= 0) {
    errors.push('ts must be positive int');
  }
  const expectedId = `${String(c.dayKey)}_${String(c.from)}_${String(c.to)}`;
  if (cheerId !== expectedId) {
    errors.push(`cheerId mismatch: expected ${expectedId}`);
  }
  return { ok: errors.length === 0, errors };
}

export function validateFirestoreUserDocContract(
  coll: string,
  docId: string,
  payload: unknown
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (coll !== 'meta' && coll !== 'months') {
    errors.push(`Invalid collection: ${coll}`);
  }
  if (
    coll === 'meta' &&
    !/^(index|core|habits|syllabus|mocks|mistakes|doubts|pyq|tasks)(__[0-9]{1,2})?$/.test(
      docId
    )
  ) {
    errors.push(`Invalid meta docId: ${docId}`);
  }
  if (
    coll === 'months' &&
    !/^[0-9]{4}-[0-9]{2}(__[0-9]{1,2})?$/.test(docId)
  ) {
    errors.push(`Invalid months docId: ${docId}`);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    errors.push('Payload must be a plain object');
    return { ok: false, errors };
  }
  const rec = payload as Record<string, unknown>;
  if (Object.keys(rec).length > 20) {
    errors.push('Document key count exceeds 20-key rule ceiling');
  }
  if (typeof rec.updatedAt !== 'number' || !Number.isFinite(rec.updatedAt) || rec.updatedAt <= 0) {
    errors.push('updatedAt must be positive finite number');
  }
  return { ok: errors.length === 0, errors };
}
