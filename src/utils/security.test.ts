import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  CHEER_DAYKEY_WINDOW_MS,
  CHEER_TS_WINDOW_MS,
  createCooldownGuard,
  detectImageMagicBytes,
  encodeCsvRow,
  formatLocalDateKey,
  onStorageQuotaExceeded,
  safeJsonParse,
  safeJsonParseStrict,
  safeLocalStorageGetJson,
  safeLocalStorageSet,
  sanitizeCsvCell,
  sanitizeTextControlChars,
  stripDangerousKeys,
  validateFirestoreCheerContract,
  validateFirestoreGroupSelfLeaveContract,
  validateFirestoreMemberEntryContract,
  validateFirestoreUserDocContract,
  validateImageFileSignature,
  validateImagePixelBounds,
  validateRasterImageMetadata,
  type SafeStorageLike,
} from './security.ts';
import { createDefaultState, logicalKey } from './studyLogic.ts';
import { partitionStateToCloudDocs } from './cloudSync.ts';
import {
  buildActiveSessionAuraPayload,
  buildMyMemberEntry,
  makeCheerId,
  sanitizeActiveSessionAura,
} from './groups.ts';
import {
  buildChronograph24h,
  buildChronograph30d,
  buildMonolithSeries,
  computeMonolithScale,
  formatGoalHoursLabel,
} from './insightsCanvas.ts';

// ---------------------------------------------------------------------------
// 1. Prototype pollution defense
// ---------------------------------------------------------------------------
test('safeJsonParse & stripDangerousKeys strip __proto__, constructor, and prototype keys recursively', () => {
  const maliciousJson =
    '{"name":"Physics","__proto__":{"polluted":true},"nested":{"constructor":{"prototype":{"evil":1}},"ok":42},"prototype":"bad"}';

  const parsed = safeJsonParse<Record<string, unknown>>(maliciousJson, {});
  assert.equal(parsed.name, 'Physics');
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, '__proto__'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, 'prototype'), false);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(({} as Record<string, unknown>).evil, undefined);

  const nested = parsed.nested as Record<string, unknown>;
  assert.equal(nested.ok, 42);
  assert.equal(Object.prototype.hasOwnProperty.call(nested, 'constructor'), false);

  const strict = safeJsonParseStrict(maliciousJson) as Record<string, unknown>;
  assert.equal(Object.prototype.hasOwnProperty.call(strict, '__proto__'), false);

  const unsafeObj: Record<string, unknown> = {
    a: 1,
    constructor: { bad: 2 },
    prototype: { bad: 3 },
  };
  Object.defineProperty(unsafeObj, '__proto__', {
    value: { bad: 1 },
    enumerable: true,
    configurable: true,
  });
  const stripped = stripDangerousKeys(unsafeObj);
  assert.deepEqual(Object.keys(stripped), ['a']);
});

test('safeJsonParse returns fallback on malformed JSON and safeJsonParseStrict throws', () => {
  const fb = { intact: true };
  assert.deepEqual(safeJsonParse('{not valid json', fb), fb);
  assert.deepEqual(safeJsonParse(null, fb), fb);
  assert.throws(() => safeJsonParseStrict('{not valid json'));
});

// ---------------------------------------------------------------------------
// 2. Raster magic-byte & decompression-bomb validation
// ---------------------------------------------------------------------------
test('detectImageMagicBytes accepts genuine JPEG, PNG, and WebP headers and rejects SVG/HTML/text', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const webp = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]);
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const html = new TextEncoder().encode('<!doctype html><html><body>xss</body></html>');
  const plain = new TextEncoder().encode('just plain text file');

  assert.equal(detectImageMagicBytes(jpeg), 'image/jpeg');
  assert.equal(detectImageMagicBytes(png), 'image/png');
  assert.equal(detectImageMagicBytes(webp), 'image/webp');
  assert.equal(detectImageMagicBytes(svg), null);
  assert.equal(detectImageMagicBytes(html), null);
  assert.equal(detectImageMagicBytes(plain), null);
});

test('validateRasterImageMetadata rejects SVG, GIF, HTML, empty files, and oversized files', () => {
  assert.equal(
    validateRasterImageMetadata({ name: 'pic.jpg', type: 'image/jpeg', size: 1024 }).ok,
    true
  );
  assert.equal(
    validateRasterImageMetadata({ name: 'vector.svg', type: 'image/svg+xml', size: 512 }).ok,
    false
  );
  assert.equal(
    validateRasterImageMetadata({ name: 'anim.gif', type: 'image/gif', size: 512 }).ok,
    false
  );
  assert.equal(
    validateRasterImageMetadata({ name: 'page.html', type: 'text/html', size: 512 }).ok,
    false
  );
  assert.equal(
    validateRasterImageMetadata({ name: 'empty.png', type: 'image/png', size: 0 }).ok,
    false
  );
  assert.equal(
    validateRasterImageMetadata({
      name: 'huge.png',
      type: 'image/png',
      size: 26 * 1024 * 1024,
    }).ok,
    false
  );
});

test('validateImageFileSignature catches spoofed PNG/WebP extensions containing SVG or HTML bytes', async () => {
  const svgBytes = new TextEncoder().encode('<svg onload="alert(1)"></svg>');
  const spoofedPng = Object.assign(new Blob([svgBytes], { type: 'image/png' }), {
    name: 'evil.png',
  });
  const spoofRes = await validateImageFileSignature(spoofedPng);
  assert.equal(spoofRes.ok, false);

  const realPngBytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  ]);
  const realPng = Object.assign(new Blob([realPngBytes], { type: 'image/png' }), {
    name: 'question.png',
  });
  const okRes = await validateImageFileSignature(realPng);
  assert.equal(okRes.ok, true);
  assert.equal(okRes.detectedMime, 'image/png');
});

test('validateImagePixelBounds blocks decompression bombs exceeding 12000px or 48 MP', () => {
  assert.equal(validateImagePixelBounds(2400, 1800).ok, true);
  assert.equal(validateImagePixelBounds(0, 100).ok, false);
  assert.equal(validateImagePixelBounds(14_000, 1000).ok, false);
  assert.equal(validateImagePixelBounds(8000, 7000).ok, false); // 56 MP > 48 MP cap
});

// ---------------------------------------------------------------------------
// 3. CSV formula injection neutralization
// ---------------------------------------------------------------------------
test('sanitizeCsvCell & encodeCsvRow neutralize formula prefixes, tabs, CRs, and quote properly', () => {
  assert.equal(sanitizeCsvCell('=SUM(A1:A10)'), `"'=SUM(A1:A10)"`);
  assert.equal(sanitizeCsvCell('+cmd|"/C calc"!A0'), `"'` + `+cmd|""/C calc""!A0"`);
  assert.equal(sanitizeCsvCell('-2+3'), `"'-2+3"`);
  assert.equal(sanitizeCsvCell('@HYPERLINK("http://evil")'), `"'@HYPERLINK(""http://evil"")"`);
  assert.equal(sanitizeCsvCell('   =1+1'), `"'   =1+1"`);
  assert.equal(sanitizeCsvCell('\t=1+1'), `"'\t=1+1"`);
  assert.equal(sanitizeCsvCell('\r1+1'), `"'\r1+1"`);
  assert.equal(sanitizeCsvCell('Organic "Chemistry"'), `"Organic ""Chemistry"""`);
  assert.equal(
    encodeCsvRow(['study_session', '2026-10-12', 'Physics', '=1+1', 45]),
    `"study_session","2026-10-12","Physics","'=1+1","45"`
  );
});

// ---------------------------------------------------------------------------
// 4. Quota-safe storage helpers
// ---------------------------------------------------------------------------
test('safeLocalStorageSet catches QuotaExceededError without throwing and notifies listeners', () => {
  const quotaEvents: string[] = [];
  const unsubscribe = onStorageQuotaExceeded((key) => quotaEvents.push(key));

  const failingStorage: SafeStorageLike = {
    getItem: () => null,
    setItem: () => {
      const err = new Error('Storage full');
      err.name = 'QuotaExceededError';
      throw err;
    },
    removeItem: () => {},
  };

  try {
    const res = safeLocalStorageSet('dh_test_key', '{"big":true}', failingStorage);
    assert.equal(res.ok, false);
    assert.equal(res.quotaExceeded, true);
    assert.deepEqual(quotaEvents, ['dh_test_key']);
  } finally {
    unsubscribe();
  }
});

test('safeLocalStorageGetJson recovers gracefully from corrupted JSON and private-mode SecurityError', () => {
  const brokenStorage: SafeStorageLike = {
    getItem: () => '{corrupt',
    setItem: () => {},
    removeItem: () => {},
  };
  assert.deepEqual(safeLocalStorageGetJson('k', { ok: true }, brokenStorage), { ok: true });

  const privateStorage: SafeStorageLike = {
    getItem: () => {
      const err = new Error('Blocked');
      err.name = 'SecurityError';
      throw err;
    },
    setItem: () => {
      const err = new Error('Blocked');
      err.name = 'SecurityError';
      throw err;
    },
    removeItem: () => {},
  };
  assert.deepEqual(safeLocalStorageGetJson('k', { safe: 1 }, privateStorage), { safe: 1 });
  assert.equal(safeLocalStorageSet('k', 'v', privateStorage).ok, false);
});

// ---------------------------------------------------------------------------
// 5. Local midnight date-key accuracy
// ---------------------------------------------------------------------------
test('formatLocalDateKey and logicalKey respect local midnight boundaries without UTC drift', () => {
  const justAfterMidnight = new Date(2026, 9, 15, 0, 5, 0); // 00:05 local
  const justBeforeMidnight = new Date(2026, 9, 15, 23, 55, 0); // 23:55 local

  assert.equal(formatLocalDateKey(justAfterMidnight), '2026-10-15');
  assert.equal(formatLocalDateKey(justBeforeMidnight), '2026-10-15');
  assert.equal(logicalKey(justAfterMidnight, 0), '2026-10-15');
  assert.equal(logicalKey(justBeforeMidnight, 0), '2026-10-15');
  // With 4 AM logical day reset, 00:05 belongs to the previous study day
  assert.equal(logicalKey(justAfterMidnight, 4), '2026-10-14');
});

// ---------------------------------------------------------------------------
// 6. Cooldown guard & control-char sanitizer
// ---------------------------------------------------------------------------
test('createCooldownGuard enforces minimum interval and allows after window elapses', () => {
  let now = 10_000;
  const guard = createCooldownGuard(2500, () => now);
  assert.deepEqual(guard.tryAcquire(), { allowed: true, remainingMs: 0 });
  now = 11_000;
  assert.deepEqual(guard.tryAcquire(), { allowed: false, remainingMs: 1500 });
  now = 12_500;
  assert.deepEqual(guard.tryAcquire(), { allowed: true, remainingMs: 0 });
  guard.reset();
  now = 12_600;
  assert.deepEqual(guard.tryAcquire(), { allowed: true, remainingMs: 0 });
});

test('sanitizeTextControlChars strips control characters and clamps length', () => {
  assert.equal(sanitizeTextControlChars('Aarav\u0000\u0007\n NEET', 20), 'Aarav NEET');
  assert.equal(sanitizeTextControlChars('VeryLongNickname1234567890', 10), 'VeryLongNi');
});

// ---------------------------------------------------------------------------
// 7. Firestore Rules v42 Contract Verification
// ---------------------------------------------------------------------------
test('partitionStateToCloudDocs payloads satisfy Firestore v42 user doc rules and clamp activeMs', () => {
  const state = createDefaultState();
  state.profile = { nick: 'Aarav\u0000\n', emoji: '🩺', updatedAt: 1_760_000_000_000 };
  state.sessions.push({
    id: 'ses_overflow',
    subjectId: state.subjects[0].id,
    dayKey: '2026-10-15',
    startTs: 1_760_000_000_000,
    endTs: 1_760_003_600_000,
    activeMs: 999_999_999, // impossible > 24h duration
    pausedMs: 0,
    pauseCount: 0,
    overtimeMs: 0,
    mode: 'stopwatch',
    purity: 100,
    rating: 0,
    note: '',
    updatedAt: 1_760_003_600_000,
  });

  const partitioned = partitionStateToCloudDocs(state, 1_760_003_600_000);
  for (const [docKey, payload] of Object.entries(partitioned.docs)) {
    const [coll, docId] = docKey.split('/');
    const check = validateFirestoreUserDocContract(coll, docId, payload);
    assert.equal(check.ok, true, `${docKey} failed rules contract: ${check.errors.join(', ')}`);
  }

  const monthDoc = partitioned.docs['months/2026-10'] as {
    sessions: Record<string, { activeMs: number }>;
  };
  assert.equal(monthDoc.sessions.ses_overflow.activeMs, 86_400_000);

  const coreDoc = partitioned.docs['meta/core'] as { profile: { nick: string } };
  assert.equal(coreDoc.profile.nick, 'Aarav');
});

test('buildMyMemberEntry & cheers satisfy Firestore v42 squad rules with zero PII leakage', () => {
  const state = createDefaultState();
  const reqTimeMs = Date.UTC(2026, 9, 15, 12, 0, 0);
  // Intentionally supply an invalid email-like nickname with control chars to verify fallback sanitization
  state.profile = {
    nick: 'evil@gmail.com\u0007',
    emoji: '🩺',
    examYear: 2027,
    updatedAt: reqTimeMs - 10_000,
  };

  const entry = buildMyMemberEntry(state, '2026-10-15', {
    joinedAt: reqTimeMs - 86_400_000,
    sh: { t: true, x: true, s: true, m: true, l: true },
    activeSession: {
      startedAt: reqTimeMs - 60_000,
      subjectLabel: 'Biology',
      subjectColor: '#34D399',
    },
    now: reqTimeMs,
  });

  const memberCheck = validateFirestoreMemberEntryContract(entry);
  assert.equal(memberCheck.ok, true, `MemberEntry failed rules contract: ${memberCheck.errors.join(', ')}`);
  assert.equal(entry.nick.includes('@'), false);
  assert.equal('email' in (entry as unknown as Record<string, unknown>), false);
  assert.equal('photoURL' in (entry as unknown as Record<string, unknown>), false);

  const cheerId = makeCheerId('2026-10-15', 'uid_sender', 'uid_target');
  const cheerCheck = validateFirestoreCheerContract(
    cheerId,
    {
      from: 'uid_sender',
      to: 'uid_target',
      fromNick: entry.nick,
      dayKey: '2026-10-15',
      e: '🔥',
      ts: reqTimeMs,
    },
    reqTimeMs
  );
  assert.equal(cheerCheck.ok, true, `Cheer failed rules contract: ${cheerCheck.errors.join(', ')}`);
});

test('v42 cheer contract enforces ±26h ts bounds and ±48h valid calendar dayKey bounds', () => {
  const reqTimeMs = Date.UTC(2026, 9, 15, 12, 0, 0); // 2026-10-15T12:00:00Z

  // Valid timezone/day-reset offset (-1 day and +1 day within ±48h, ts within ±26h)
  for (const dayKey of ['2026-10-14', '2026-10-15', '2026-10-16']) {
    const id = makeCheerId(dayKey, 'uidA', 'uidB');
    const res = validateFirestoreCheerContract(
      id,
      { from: 'uidA', to: 'uidB', fromNick: 'Aarav', dayKey, e: '👏', ts: reqTimeMs - 3_600_000 },
      reqTimeMs
    );
    assert.equal(res.ok, true, `Expected ${dayKey} to pass: ${res.errors.join(', ')}`);
  }

  // ts outside ±26h (±27h) must be rejected
  const staleTsRes = validateFirestoreCheerContract(
    makeCheerId('2026-10-15', 'uidA', 'uidB'),
    {
      from: 'uidA',
      to: 'uidB',
      fromNick: 'Aarav',
      dayKey: '2026-10-15',
      e: '🔥',
      ts: reqTimeMs - (CHEER_TS_WINDOW_MS + 3_600_000),
    },
    reqTimeMs
  );
  assert.equal(staleTsRes.ok, false);

  const futureTsRes = validateFirestoreCheerContract(
    makeCheerId('2026-10-15', 'uidA', 'uidB'),
    {
      from: 'uidA',
      to: 'uidB',
      fromNick: 'Aarav',
      dayKey: '2026-10-15',
      e: '🔥',
      ts: reqTimeMs + (CHEER_TS_WINDOW_MS + 3_600_000),
    },
    reqTimeMs
  );
  assert.equal(futureTsRes.ok, false);

  // Backdated / future-dated dayKeys beyond ±48h and invalid calendar dates must be rejected
  for (const badDayKey of ['2020-01-01', '2029-12-31', '2026-10-10', '2026-02-31', '2026-13-01']) {
    const res = validateFirestoreCheerContract(
      makeCheerId(badDayKey, 'uidA', 'uidB'),
      {
        from: 'uidA',
        to: 'uidB',
        fromNick: 'Aarav',
        dayKey: badDayKey,
        e: '💪',
        ts: reqTimeMs,
      },
      reqTimeMs
    );
    assert.equal(res.ok, false, `Expected backfilled/invalid dayKey ${badDayKey} to be rejected`);
  }
  assert.equal(CHEER_TS_WINDOW_MS, 93_600_000);
  assert.equal(CHEER_DAYKEY_WINDOW_MS, 172_800_000);
});

test('v42 squad Case B self-leave blocks ownerUid (prevents orphaned squads) and allows regular members', () => {
  const groupDoc = {
    ownerUid: 'uid_owner',
    members: {
      uid_owner: {},
      uid_member: {},
    },
  };
  const ownerLeave = validateFirestoreGroupSelfLeaveContract(groupDoc, 'uid_owner');
  assert.equal(ownerLeave.ok, false);

  const memberLeave = validateFirestoreGroupSelfLeaveContract(groupDoc, 'uid_member');
  assert.equal(memberLeave.ok, true, memberLeave.errors.join(', '));
});

test('v42 activeSession contract enforces integer startedAt and strict hex subjectColor', () => {
  const baseEntry = {
    nick: 'Aarav',
    emoji: '🩺',
    joinedAt: 1_760_000_000_000,
    updatedAt: 1_760_000_100_000,
    sh: { t: true, x: true, s: true, m: true, l: true },
  };

  for (const validHex of ['#FFF', '#F5C542', '#34D399CC']) {
    const ok = validateFirestoreMemberEntryContract({
      ...baseEntry,
      activeSession: {
        startedAt: 1_760_000_050_000,
        subjectLabel: 'Physics',
        subjectColor: validHex,
      },
    });
    assert.equal(ok.ok, true, `Expected ${validHex} to pass: ${ok.errors.join(', ')}`);
  }

  // Float startedAt rejected
  const floatStarted = validateFirestoreMemberEntryContract({
    ...baseEntry,
    activeSession: {
      startedAt: 1_760_000_050_000.5,
      subjectLabel: 'Physics',
      subjectColor: '#F5C542',
    },
  });
  assert.equal(floatStarted.ok, false);

  // Non-hex colors rejected
  for (const badColor of ['rgb(245, 197, 66)', 'gold', 'javascript:alert(1)', '#12', '#123456789']) {
    const bad = validateFirestoreMemberEntryContract({
      ...baseEntry,
      activeSession: {
        startedAt: 1_760_000_050_000,
        subjectLabel: 'Physics',
        subjectColor: badColor,
      },
    });
    assert.equal(bad.ok, false, `Expected non-hex ${badColor} to be rejected`);
  }

  // Client sanitizers guarantee v42 rule compliance with #F5C542 fallback and integer ms
  const sanitized = sanitizeActiveSessionAura({
    startedAt: 1_760_000_050_000.75,
    subjectLabel: 'Organic Chem',
    subjectColor: 'rgb(255, 100, 50)',
  });
  assert.ok(sanitized);
  assert.equal(Number.isInteger(sanitized.startedAt), true);
  assert.equal(sanitized.subjectColor, '#F5C542');

  const payload = buildActiveSessionAuraPayload({
    startedAt: 1_760_000_050_000.9,
    subjectName: 'Biology',
    subjectColor: 'not-a-hex',
  });
  assert.ok(payload);
  assert.equal(Number.isInteger(payload.startedAt), true);
  assert.equal(payload.subjectColor, '#F5C542');
});

test('firestore.rules contains v42 hardening clauses and keeps static cheer checks before exists()/get()', () => {
  const rulesText = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
  assert.match(rulesText, /function isRecentCheerDayKey\(dayKey\)/);
  assert.match(rulesText, /duration\.value\(48,\s*'h'\)/);
  assert.match(rulesText, /request\.time\.toMillis\(\)\s*-\s*93600000/);
  assert.match(rulesText, /request\.time\.toMillis\(\)\s*\+\s*93600000/);
  assert.match(rulesText, /resource\.data\.ownerUid != request\.auth\.uid/);
  assert.match(rulesText, /m\.activeSession\.startedAt is int && m\.activeSession\.startedAt > 0/);
  assert.match(rulesText, /m\.activeSession\.subjectColor\.matches\('\^#\[0-9a-fA-F\]\{3,8\}\$'\)/);

  // Zero-read DoS guard: static cheer checks must precede exists() and bothAreGroupMembers()
  const cheerSectionStart = rulesText.indexOf('match /cheers/{cheerId}');
  assert.ok(cheerSectionStart > 0);
  const cheerSection = rulesText.slice(cheerSectionStart);
  const dayKeyCheckIdx = cheerSection.indexOf('isRecentCheerDayKey(request.resource.data.dayKey)');
  const tsCheckIdx = cheerSection.indexOf('request.time.toMillis() - 93600000');
  const existsIdx = cheerSection.indexOf('exists(/databases/');
  const bothMembersIdx = cheerSection.indexOf('bothAreGroupMembers(');
  assert.ok(dayKeyCheckIdx > 0 && tsCheckIdx > 0 && existsIdx > 0 && bothMembersIdx > 0);
  assert.ok(dayKeyCheckIdx < existsIdx, 'isRecentCheerDayKey must run before exists()');
  assert.ok(tsCheckIdx < existsIdx, 'ts bounds check must run before exists()');
  assert.ok(existsIdx < bothMembersIdx, 'exists() must run before get() in bothAreGroupMembers');
});

// ---------------------------------------------------------------------------
// 8. v40–v42 Insights Canvas Edge-Case Guards (NaN, 0m, Midnight Wrap)
// ---------------------------------------------------------------------------
test('insightsCanvas helpers handle 0m days, single-session day, 24h midnight wrap, and NaN/0 goal safely', () => {
  assert.equal(formatGoalHoursLabel(Number.NaN), '6h GOAL');
  assert.equal(formatGoalHoursLabel(0), '6h GOAL');
  assert.equal(formatGoalHoursLabel(-120), '6h GOAL');
  assert.equal(formatGoalHoursLabel(360), '6h GOAL');

  const subjects = [
    { id: 'bio', name: 'Biology', color: '#34D399', e: '🧬', arch: 0, todos: [] },
    { id: 'phy', name: 'Physics', color: '#60A5FA', e: '⚛️', arch: 0, todos: [] },
  ];

  // Empty sessions + NaN goal must produce finite scale and 0m bars
  const emptyMonolith = buildMonolithSeries('2026-10-15', [], subjects, 7, Number.NaN);
  assert.equal(emptyMonolith.length, 7);
  assert.equal(emptyMonolith.every((d) => d.totalMin === 0), true);
  const emptyScale = computeMonolithScale(0, Number.NaN);
  assert.equal(Number.isFinite(emptyScale.maxMin) && emptyScale.maxMin > 0, true);

  // Single-session day + midnight wrap-around (23:30 -> 00:30 next morning)
  const lateStart = new Date(2026, 9, 14, 23, 30, 0).getTime();
  const lateEnd = lateStart + 60 * 60_000; // 60m crossing midnight
  const sessions = [
    {
      id: 's_wrap',
      subjectId: 'bio',
      dayKey: '2026-10-14',
      startTs: lateStart,
      endTs: lateEnd,
      activeMs: 60 * 60_000,
      pausedMs: 0,
      pauseCount: 0,
      overtimeMs: 0,
      mode: 'stopwatch' as const,
      purity: 100,
      rating: 0,
      note: '',
      updatedAt: lateEnd,
    },
    {
      id: 's_nan_ts',
      subjectId: 'phy',
      dayKey: '2026-10-15',
      startTs: Number.NaN,
      endTs: Number.NaN,
      activeMs: 30 * 60_000,
      pausedMs: 0,
      pauseCount: 0,
      overtimeMs: 0,
      mode: 'stopwatch' as const,
      purity: 100,
      rating: 0,
      note: '',
      updatedAt: lateEnd,
    },
  ];

  const clock24h = buildChronograph24h(sessions);
  assert.equal(clock24h.slots.length, 24);
  assert.equal(clock24h.slots[23].minutes, 30);
  assert.equal(clock24h.slots[0].minutes, 30);
  assert.equal(clock24h.peakWindowStart, 23);
  assert.equal(clock24h.slots[23].inPeakWindow, true);
  assert.equal(clock24h.slots[0].inPeakWindow, true);
  assert.equal(Number.isFinite(clock24h.maxHourMin), true);

  const rhythm30d = buildChronograph30d('2026-10-15', sessions, subjects, 0);
  assert.equal(rhythm30d.spokes.length, 30);
  assert.equal(Number.isFinite(rhythm30d.avgMinPerDay30), true);
  assert.equal(Number.isFinite(rhythm30d.goalHitRatePct), true);
  assert.equal(Number.isFinite(rhythm30d.maxDayMin), true);
});

