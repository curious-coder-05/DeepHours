/**
 * Deep Hours Shared Security & Resilience Utilities (v41)
 * - Prototype pollution defense (`safeJsonParse`, `stripDangerousKeys`)
 * - Strict raster image magic-byte signature validation (JPEG / PNG / WebP only)
 * - RFC-4180 CSV cell encoding with formula-injection neutralization
 * - Control-character stripping and length bounding
 * - Quota-safe `localStorage` helpers with global QuotaExceeded notification hook
 * - Local-timezone calendar date-key formatting (IST UTC+5:30 safe)
 * - Client-side write cooldown rate limiter
 * - Firestore security-rule contract validators (mirrors `firestore.rules` v42)
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
  maxBytes = 10 * 1024 * 1024
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
  maxBytes = 10 * 1024 * 1024
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

export function notifyQuotaExceeded(key: string): void {
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

/* ── Firestore Rules v42 Contract Validators (for unit testing & pre-flight verification) ── */

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
      if (!Number.isInteger(a.startedAt) || (a.startedAt as number) <= 0) {
        errors.push('activeSession.startedAt must be positive int');
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
        !/^#[0-9a-fA-F]{3,8}$/.test(a.subjectColor)
      ) {
        errors.push('activeSession.subjectColor must match ^#[0-9a-fA-F]{3,8}$');
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

export const CHEER_TS_WINDOW_MS = 93_600_000; // ±26 hours
export const CHEER_DAYKEY_WINDOW_MS = 48 * 3_600_000; // ±48 hours

export function validateFirestoreCheerContract(
  cheerId: string,
  cheer: unknown,
  requestTimeMs?: number
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
  const refTimeMs =
    typeof requestTimeMs === 'number' && Number.isFinite(requestTimeMs)
      ? requestTimeMs
      : typeof c.ts === 'number' && Number.isFinite(c.ts)
        ? c.ts
        : Date.now();
  if (typeof c.dayKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(c.dayKey)) {
    errors.push('dayKey must be YYYY-MM-DD');
  } else {
    const [yStr, mStr, dStr] = c.dayKey.split('-');
    const y = Number(yStr);
    const m = Number(mStr);
    const d = Number(dStr);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const validCalendarDate =
      y >= 2020 &&
      y <= 2100 &&
      m >= 1 &&
      m <= 12 &&
      d >= 1 &&
      d <= 31 &&
      dt.getUTCFullYear() === y &&
      dt.getUTCMonth() === m - 1 &&
      dt.getUTCDate() === d;
    if (!validCalendarDate) {
      errors.push('dayKey must be a valid calendar date in 2020..2100');
    } else {
      const dayUtcMs = dt.getTime();
      if (
        dayUtcMs < refTimeMs - CHEER_DAYKEY_WINDOW_MS ||
        dayUtcMs > refTimeMs + CHEER_DAYKEY_WINDOW_MS
      ) {
        errors.push('dayKey must fall within ±48 hours of request.time');
      }
    }
  }
  if (typeof c.e !== 'string' || !ALLOWED_CHEER_SET.has(c.e)) {
    errors.push('e must be one of 👏, 🔥, 💪');
  }
  if (!Number.isInteger(c.ts) || (c.ts as number) <= 0) {
    errors.push('ts must be positive int');
  } else if (
    (c.ts as number) < refTimeMs - CHEER_TS_WINDOW_MS ||
    (c.ts as number) > refTimeMs + CHEER_TS_WINDOW_MS
  ) {
    errors.push('ts must fall within ±26 hours of request.time');
  }
  const expectedId = `${String(c.dayKey)}_${String(c.from)}_${String(c.to)}`;
  if (cheerId !== expectedId) {
    errors.push(`cheerId mismatch: expected ${expectedId}`);
  }
  return { ok: errors.length === 0, errors };
}

export function validateFirestoreGroupSelfLeaveContract(
  groupDoc: { ownerUid: string; members: Record<string, unknown> },
  callerUid: string
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!callerUid || !(callerUid in groupDoc.members)) {
    errors.push('Caller must be an existing group member to self-leave');
  }
  if (groupDoc.ownerUid === callerUid) {
    errors.push('Squad owner cannot self-leave in Case B (prevents orphaned squads)');
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

/* ── External URL Validation & Backup Payload Clamping (v47) ── */

/**
 * Restricts external links strictly to valid `https://` URLs.
 * Rejects `javascript:`, `data:`, `http:`, protocol-relative, and malformed URLs.
 */
export function safeExternalHttpsUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || /[\u0000-\u001F\u007F]/.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' || !parsed.hostname) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

const MAX_SESSION_MS = 86_400_000; // 24 hours
const MAX_TIMESTAMP_MS = 4_102_444_800_000; // 2100-01-01T00:00:00Z
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function clampFiniteInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number
): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function clampPositiveTs(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(MAX_TIMESTAMP_MS, Math.round(n));
}

function clampOptionalDateKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.trim();
  return DATE_KEY_RE.test(cleaned) ? cleaned : undefined;
}

/**
 * Hardens an imported JSON backup payload before passing into state normalization:
 * - Recursively strips `__proto__`, `constructor`, and `prototype` keys.
 * - Clamps and bounds `sessions`, `chapters`, `mocks`, `deadlineTargets`, `reminders`,
 *   and `profile` fields (bounded non-negative durations, finite positive timestamps,
 *   and control-character-stripped length-capped strings).
 */
export function sanitizeImportedStatePayload(
  raw: unknown,
  now = Date.now()
): Record<string, unknown> {
  const safeNow = clampPositiveTs(now, Date.now());
  const cleaned = stripDangerousKeys(raw);
  if (!cleaned || typeof cleaned !== 'object' || Array.isArray(cleaned)) {
    return {};
  }
  const src = { ...(cleaned as Record<string, unknown>) };

  // 1. Sessions: finite positive timestamps, bounded non-negative durations, safe strings
  if (Array.isArray(src.sessions)) {
    src.sessions = src.sessions
      .slice(0, 20_000)
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
      .map((s) => {
        const startTs = clampPositiveTs(s.startTs, safeNow);
        const endTs = Math.max(startTs, clampPositiveTs(s.endTs, startTs));
        return {
          ...s,
          id: sanitizeTextControlChars(s.id, 80) || undefined,
          subjectId: sanitizeTextControlChars(s.subjectId, 64),
          chapterId: s.chapterId ? sanitizeTextControlChars(s.chapterId, 64) : undefined,
          dayKey: clampOptionalDateKey(s.dayKey),
          startTs,
          endTs,
          activeMs: clampFiniteInt(s.activeMs, 0, MAX_SESSION_MS, 0),
          pausedMs: clampFiniteInt(s.pausedMs, 0, MAX_SESSION_MS, 0),
          pauseCount: clampFiniteInt(s.pauseCount, 0, 1000, 0),
          overtimeMs: clampFiniteInt(s.overtimeMs, 0, MAX_SESSION_MS, 0),
          purity: clampFiniteInt(s.purity, 0, 100, 100),
          rating: clampFiniteInt(s.rating, 0, 5, 0),
          note: sanitizeTextControlChars(s.note, 500, { allowNewlines: true }),
          updatedAt: clampPositiveTs(s.updatedAt, endTs),
        };
      });
  }

  // 2. Chapters: length-capped names/notes, bounded confidence & revisions
  if (Array.isArray(src.chapters)) {
    src.chapters = src.chapters
      .slice(0, 2_000)
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
      .map((ch) => ({
        ...ch,
        id: sanitizeTextControlChars(ch.id, 80) || undefined,
        subjectId: sanitizeTextControlChars(ch.subjectId, 64),
        name: sanitizeTextControlChars(ch.name, 160),
        unit: ch.unit ? sanitizeTextControlChars(ch.unit, 120) : undefined,
        notes: ch.notes ? sanitizeTextControlChars(ch.notes, 1000, { allowNewlines: true }) : undefined,
        confidence:
          ch.confidence === undefined || ch.confidence === null
            ? undefined
            : clampFiniteInt(ch.confidence, 0, 5, 0),
        updatedAt: clampPositiveTs(ch.updatedAt, safeNow),
      }));
  }

  // 3. Mocks: bounded scores/counts/durations, length-capped labels
  if (Array.isArray(src.mocks)) {
    src.mocks = src.mocks
      .slice(0, 2_000)
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
      .map((m) => ({
        ...m,
        id: sanitizeTextControlChars(m.id, 80) || undefined,
        title: sanitizeTextControlChars(m.title, 160),
        date: clampOptionalDateKey(m.date),
        score: clampFiniteInt(m.score, -1000, 2000, 0),
        maxScore: clampFiniteInt(m.maxScore, 1, 2000, 720),
        durationMins:
          m.durationMins === undefined || m.durationMins === null
            ? undefined
            : clampFiniteInt(m.durationMins, 0, 1440, 200),
        correct:
          m.correct === undefined || m.correct === null
            ? undefined
            : clampFiniteInt(m.correct, 0, 1000, 0),
        wrong:
          m.wrong === undefined || m.wrong === null
            ? undefined
            : clampFiniteInt(m.wrong, 0, 1000, 0),
        skipped:
          m.skipped === undefined || m.skipped === null
            ? undefined
            : clampFiniteInt(m.skipped, 0, 1000, 0),
        notes: m.notes ? sanitizeTextControlChars(m.notes, 1000, { allowNewlines: true }) : undefined,
        updatedAt: clampPositiveTs(m.updatedAt, safeNow),
      }));
  }

  // 4. Deadline targets: length-capped titles/notes/items, finite positive timestamps
  if (Array.isArray(src.deadlineTargets)) {
    src.deadlineTargets = src.deadlineTargets
      .slice(0, 200)
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
      .map((t) => ({
        ...t,
        id: sanitizeTextControlChars(t.id, 80) || undefined,
        title: sanitizeTextControlChars(t.title, 140),
        subjectId: t.subjectId ? sanitizeTextControlChars(t.subjectId, 64) : undefined,
        startDate: clampOptionalDateKey(t.startDate),
        deadlineDate: clampOptionalDateKey(t.deadlineDate),
        notes: t.notes ? sanitizeTextControlChars(t.notes, 600, { allowNewlines: true }) : undefined,
        items: Array.isArray(t.items)
          ? t.items
              .slice(0, 100)
              .filter((it): it is Record<string, unknown> => Boolean(it && typeof it === 'object' && !Array.isArray(it)))
              .map((it) => ({
                ...it,
                id: sanitizeTextControlChars(it.id, 80) || undefined,
                text: sanitizeTextControlChars(it.text, 200),
                done: Boolean(it.done),
                doneAt: it.doneAt ? clampPositiveTs(it.doneAt, safeNow) : undefined,
              }))
          : [],
        archived: Boolean(t.archived),
        createdAt: clampPositiveTs(t.createdAt, safeNow),
        updatedAt: clampPositiveTs(t.updatedAt, safeNow),
      }));
  }

  // 5. Custom reminders: length-capped titles/notes, bounded leadDays, finite positive timestamps
  if (Array.isArray(src.reminders)) {
    src.reminders = src.reminders
      .slice(0, 300)
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
      .map((r) => ({
        ...r,
        id: sanitizeTextControlChars(r.id, 80) || undefined,
        title: sanitizeTextControlChars(r.title, 140),
        date: clampOptionalDateKey(r.date),
        time: typeof r.time === 'string' ? sanitizeTextControlChars(r.time, 8) : undefined,
        leadDays: Array.isArray(r.leadDays)
          ? r.leadDays
              .slice(0, 10)
              .map((d) => clampFiniteInt(d, 0, 30, 0))
          : [0],
        notes: r.notes ? sanitizeTextControlChars(r.notes, 600, { allowNewlines: true }) : undefined,
        done: Boolean(r.done),
        doneAt: r.doneAt ? clampPositiveTs(r.doneAt, safeNow) : undefined,
        createdAt: clampPositiveTs(r.createdAt, safeNow),
        updatedAt: clampPositiveTs(r.updatedAt, safeNow),
      }));
  }

  // 6. Profile: length-capped nick/emoji, bounded examYear, finite updatedAt
  if (src.profile && typeof src.profile === 'object' && !Array.isArray(src.profile)) {
    const p = src.profile as Record<string, unknown>;
    src.profile = {
      ...p,
      nick: sanitizeTextControlChars(p.nick, 20, { stripAngleBrackets: true }),
      emoji: sanitizeTextControlChars(p.emoji, 8) || '🎯',
      examYear:
        p.examYear === undefined || p.examYear === null
          ? undefined
          : clampFiniteInt(p.examYear, 2020, 2035, 2026),
      updatedAt: clampPositiveTs(p.updatedAt, safeNow),
    };
  }

  return src;
}

