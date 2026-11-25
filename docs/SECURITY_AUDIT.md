# Deep Hours — Final Security Audit, Crash-Proofing & Repo Hygiene Report (v41–v42)

## 1. Executive Summary
Deep Hours v41–v42 completes a full-codebase security hardening, server-side `firestore.rules` lock-down, crash-proofing, edge-case audit, and repository hygiene pass with **zero new npm packages**, **zero UI regressions**, and **all unit tests passing** (including comprehensive security, Firestore contract, and Insights Canvas edge-case suites in `src/utils/security.test.ts` and `src/utils/groups.test.ts`).

---

## 2. Client-Side Security Hardening

All shared security and resilience primitives are consolidated in `src/utils/security.ts` and wired across untrusted boundaries:

| Area | Vulnerability / Risk Addressed | Hardening Implemented |
| --- | --- | --- |
| **Prototype Pollution** | Raw `JSON.parse` on user-supplied backups, `.dhvault.json` archives, and `localStorage` sidecars could accept `__proto__`, `constructor`, or `prototype` keys. | Added `safeJsonParse`, `safeJsonParseStrict`, and `stripDangerousKeys` (reviver + recursive plain-object clone) across `App.tsx` (`onImportJson`), `storage.ts`, `vaultArchive.ts`, `cloudSync.ts`, `groups.ts`, `GroupsView.tsx`, `vaultCurtain.ts`, `mockLeaks.ts`, `mockReport.ts`, `ambientMixer.ts`, `parkingLot.ts`, and `examClock.ts`. |
| **Vault File & Archive Uploads** | `vaultImage.ts` previously accepted `image/svg+xml` via broad `image/*` matching and lacked binary header checks and pixel decompression-bomb caps; `vaultArchive.ts` permitted GIF/AVIF and did not verify decoded binary signatures or total decoded archive bytes. | Restricted `VaultCaptureSheet.tsx`, `vaultImage.ts`, and `vaultArchive.ts` strictly to raster JPEG, PNG, and WebP (`image/jpeg`, `image/png`, `image/webp`). Added binary magic-byte header verification (`detectImageMagicBytes` / `validateImageFileSignature`) blocking SVG, HTML, plain text, and spoofed extensions/MIME types. Enforced pixel dimension (`<= 12,000 px`), decompression-bomb (`<= 48 MP`), per-file (`<= 25 MB`), and total `.dhvault.json` decoded-bytes (`<= 45 MB`) caps. |
| **CSV Formula Injection** | `onExportCsv` in `App.tsx` left date/numeric fields unquoted and did not neutralize standalone leading `\t` / `\r` payloads. | Routed every CSV export row through RFC-4180 `encodeCsvRow` / `sanitizeCsvCell`, neutralizing leading `=`, `+`, `-`, `@`, `\t`, and `\r` (including after leading whitespace) with a single-quote prefix inside quoted cells. |
| **XSS & DOM Sinks** | Two legacy `container.innerHTML = ''` DOM clears existed in `src/components/three/Scene3D.tsx`. | Replaced both with `container.replaceChildren()`. Verified zero `dangerouslySetInnerHTML`, `eval`, `new Function`, or `javascript:` URLs across `src/`. |
| **Privacy, Anti-Cheat & Quota Guards** | Fallback nickname in `groups.ts:buildMyMemberEntry` could bypass `sanitizePlainText` and leak `@` or control chars; rapid Wave/cheer clicks or Live Aura toggles lacked client-side write cooldowns; `partitionStateToCloudDocs` did not clamp impossible `activeMs` values; `sanitizeActiveSessionAura` previously accepted `rgb()`/`hsl()`. | Hardened `buildMyMemberEntry` fallback nickname to strip `@` and control chars; verified zero `email` or `photoURL` fields ever enter squad docs; clamped synced `activeMs` to `[0, 86_400_000]` (24h max); added `createCooldownGuard` throttling on `sendCheerInCloud` (2.5s) and `handleToggleLiveAuraEnabled` (1.5s); tightened `activeSession.subjectColor` to strict `#RGB`/`#RRGGBB`/`#RRGGBBAA` hex (fallback `#F5C542`) and integer ms `startedAt`. |
| **Cross-Account Device Isolation** | Signing out or switching Google accounts on a shared device left in-memory and `localStorage` sync outbox (`dh_sync_meta`) and squad snapshots (`dh_groups_cache_v1`, `dh_groups_budget_v1`) behind. | Added `clearSyncOutboxOnSignOut()` in `cloudSync.ts` and `clearAllCachedGroupSnapshots()` in `groups.ts`, invoked automatically on sign-out (`onSignOutGoogle`) and whenever `subscribeToAuthChanges` observes sign-out or a UID change. |
| **Service Worker & Referrer Policy** | `public/sw.js` did not explicitly bypass Firebase Auth/Hosting/API routes; `index.html` lacked a referrer policy meta tag and used an outdated `#0B0D10` `theme-color`. | Updated `public/sw.js` (`CACHE_NAME = 'deep-hours-v42'`) to explicitly bypass `/__/auth/`, `/__/firebase/`, `/api/`, and Google/Firebase API origins (`googleapis.com`, `gstatic.com`, `identitytoolkit`, `securetoken`, `firebaseapp.com`). Added `<meta name="referrer" content="strict-origin-when-cross-origin" />` and pure `#000000` AMOLED `theme-color` (`#F6F4EF` in Light mode) across `index.html` and `App.tsx`. |

---

## 3. Server-Side `firestore.rules` Red-Team Audit & v42 Hardening

A line-by-line review of `firestore.rules` against every read/write path in `src/utils/cloudSync.ts`, `src/utils/groups.ts`, and `src/components/GroupsView.tsx` verified all baseline invariants and applied three zero-regression v42 server-side protections:

1. **Authentication & Verification**: Every read/write requires `request.auth != null && request.auth.token.email_verified == true`.
2. **Owner-Only User Sync (`users/{userId}/{coll}/{docId}`)**: Strictly enforces `request.auth.uid == userId`, restricts collections to `['meta', 'months']`, validates `docId` regexes, caps document key counts (`<= 20`), and requires positive `updatedAt`.
3. **Squad Anti-Scraping & Immutability (`groups/{groupId}`)**:
   - `allow list: if false` prevents collection enumeration/scraping; invite codes use a 10-character unambiguous alphabet (`32^10` keyspace).
   - `ownerUid`, `createdAt`, `memberCap`, and per-member `joinedAt` are immutable after creation.
   - `members.{uid}` enforces strict `hasAll`/`hasOnly` allowlists (16 bounded keys, zero `email`/`photoURL`), caps `mocks` to `<= 10` items with exact `['d', 's', 'm']` keys.
4. **v42 Tightened Protections (Deployed Live)**:
   - **Cheer Backfill / Quota-Burn Defense (`groups/{groupId}/cheers/{cheerId}`)**: All static checks remain strictly BEFORE `exists()` / `get()` so rejected writes cost `0` Firestore reads. Added `ts` server-clock bounding (`request.time.toMillis() ± 93600000`, i.e., `±26h`) and `isRecentCheerDayKey(dayKey)` calendar validation (`y in 2020..2100`, `m in 1..12`, `d in 1..31`, and `timestamp.date(y, m, d)` within `±48h` of `request.time`) to tolerate worldwide timezones and custom day-reset hours while blocking multi-year cheer backfill spam.
   - **Prevent Orphaned Squads (`groups/{groupId}` Case B SELF Removal)**: Added `resource.data.ownerUid != request.auth.uid` on Case B self-removal (matching Case C), and routed squad owners cleanly in `GroupsView.tsx` and `groups.ts` to **Owner tools -> Close squad** so owners never encounter `permission-denied` or leave an ownerless squad behind.
   - **Strict `activeSession` Typing (`isValidMemberEntry`)**: Tightened `activeSession.startedAt` from `number` to `int && > 0` and enforced `activeSession.subjectColor.matches('^#[0-9a-fA-F]{3,8}$')`, paired with client-side integer clamping and strict hex fallback (`#F5C542`) in `groups.ts`.
5. **Default Deny**: Catch-all `match /{document=**} { allow read, write: if false; }` remains enforced.

All tightened rules are continuously locked by automated unit tests (`validateFirestoreUserDocContract`, `validateFirestoreMemberEntryContract`, `validateFirestoreCheerContract`, `validateFirestoreGroupSelfLeaveContract`, plus static `firestore.rules` assertions) in `src/utils/security.test.ts`.

### Intentionally Deferred Structural Items (Tracked for Future Architecture)
1. **Per-key value validation inside `days` / `xpDays` / `weeks` maps**: Firestore Rules CEL does not provide arbitrary map-value iteration without fixed keys. Document size and map cardinality (`days.size() <= 25`, `xpDays.size() <= 25`, `weeks.size() <= 14`) are enforced server-side, while values are clamped client-side. Strict per-entry value validation would require migrating member history to fixed-slot schemas or a Cloud Function writer.
2. **Persistent kick-rejoin blocklists**: Because squads currently store all members inside a single `groups/{groupId}` document (keeping Spark-tier reads at 1 per squad view), removed members who still know the invite code can technically rejoin unless the owner rotates/recreates the squad. A persistent server-enforced blocklist (`groups/{groupId}/banned/{uid}` or bounded `bannedUids` array) is intentionally deferred to a future schema migration to avoid breaking existing squad documents.

### Pre-Release Recommendation: Firebase App Check
Before broad public rollout, enable **Firebase App Check** (reCAPTCHA Enterprise or reCAPTCHA v3 for Web) in the Firebase Console and enforce it on Cloud Firestore so automated off-app scripts cannot consume Spark/Blaze read/write quota even with valid Google tokens.

---

## 4. Recommended Hosting Security Headers (CSP)

Because Deep Hours is deployed as a static SPA/PWA, set the following response headers on your hosting provider (e.g., Firebase Hosting `firebase.json`, Cloudflare Pages `_headers`, or Vercel `vercel.json`):

```http
Content-Security-Policy: default-src 'self'; script-src 'self' https://apis.google.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob:; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com; frame-src https://*.firebaseapp.com https://accounts.google.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none';
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(self), microphone=(), geolocation=()
```

*(Note: `img-src blob: data:` and `media-src blob:` are required for Question Vault IndexedDB image previews, Canvas Proof Cards, and Floating Video PiP `captureStream`.)*

---

## 5. Dependency Audit Note
- Direct runtime dependencies (`react`, `react-dom`, `three`, `firebase`, `lucide-react`, `@fontsource-variable/geist*`) have **zero** known browser-bundle vulnerabilities.
- `bun audit` flags two advisories solely inside `@grpc/grpc-js@1.9.16`, a Node.js-only transitive dependency pulled by the `firebase` meta-package for server-side environments. Vite tree-shakes and excludes `@grpc/grpc-js` completely from the client production bundle.

---

## 6. Bug Hunt, Crash-Proofing & Resource-Leak Fixes

1. **Scoped Error Containment (`ErrorBoundary.tsx`, `App.tsx`, `FocusView.tsx`, `PrepView.tsx`)**:
   - Upgraded `ErrorBoundary` with `variant="section"`, `resetKey` auto-recovery, and `silentFallback`.
   - Wrapped every active tab (`Today`, `Prep`, `Focus`, `Community`, `Insights`, `Settings`) in an isolated pure-AMOLED section `ErrorBoundary` offering **Reload view** and **Download backup JSON** so a single tab fault never white-screens the app.
   - Wrapped lazy Three.js scenes (`FocusOrbitScene` and `SyllabusAstrolabeScene`) in silent `ErrorBoundary` wrappers so WebGL driver/context failures degrade gracefully without interrupting timer or syllabus controls.
2. **Storage Quota & IndexedDB Resilience (`security.ts`, `storage.ts`, `vaultStore.ts`, `App.tsx`)**:
   - Wired `onStorageQuotaExceeded` to surface a throttled, non-crashing toast instructing the user to export a JSON backup or free browser space on `QuotaExceededError`.
   - Replaced static single-shot `idbPromise` in `storage.ts` with retryable `openPrimaryIdb()` handling `onversionchange`, `onblocked`, `tx.onabort`, and `tx.onerror`; added `onblocked` handling to `vaultStore.ts`.
3. **Cooldown Bug Caught by Unit Tests**:
   - Verified `createCooldownGuard().tryAcquire()` return contract (`{ allowed, remainingMs }`) and ensured callers in `groups.ts` and `App.tsx` check `.allowed` rather than truthiness of the object.
4. **Local Midnight Date-Key Audit (IST UTC+5:30 Safe)**:
   - Confirmed zero `toISOString()` calls across `src/` for day keys; verified `GroupsView.tsx` `Date.UTC` usage operates strictly on already-local `YYYY-MM-DD` components for DST-safe weekday arithmetic.
5. **Resource-Leak Audit**:
   - Verified cleanup of `URL.createObjectURL` revocations, `ResizeObserver`, `IntersectionObserver`, WebGL renderer/geometry/material disposal, and `setInterval` timers across all views and hooks.
   - Preserved `useTimerTick` isolation in `App.tsx` and the `60 Hz` `0.001`-gain Floating Video PiP audio keepalive path untouched.

---

## 7. Surgical Dead-Code Purge & Production Bundle Summary

### Provably Dead Files Deleted (Verified Zero Static/Dynamic References)
- `src/components/MoreView.tsx` (superseded by `SettingsDrawer` + `SettingsView`)
- `src/components/DoubtsView.tsx` (superseded by `VaultView` in `Prep`)
- `src/components/MistakesView.tsx` (superseded by `VaultView` + `mockLeaks` in `Prep`)
- `src/components/ui/Sparkline.tsx` (unused standalone duplicate)

### Provably Dead Exports Removed
- `Sparkline`, `RadialClock24h`, `HeatmapGrid` (and prop interfaces `SparklineProps`, `RadialClock24hProps`, `HeatmapGridProps`, `HeatmapCell`) from `src/components/ui/Charts.tsx` and `src/components/ui/index.ts`.
- Active charts preserved intact: `AreaLineChart`, `BarChart`, `DonutChart`, `SemiCircleGauge`.

### Production Build Chunk Summary (`npm run build`, Vite 8.3.5)
| Chunk | Raw Size | Gzip Size | Notes |
| --- | --- | --- | --- |
| `index-*.js` (entry) | `439.6 kB` | `111.1 kB` | Includes scoped ErrorBoundaries; `three` & `firebase` stay strictly lazy |
| `index-*.css` | `174.8 kB` | `30.5 kB` | Pure `#000000` AMOLED + Rose Copper design system |
| `security-*.js` (shared chunk) | `4.1 kB` | `1.9 kB` | Deduplicated security/storage/CSV/magic-byte module shared across lazy chunks |
| `PrepView-*.js` (lazy) | `141.1 kB` | `32.4 kB` | Syllabus, Mocks, Score Lab, Mock Report, PYQs |
| `StatsView-*.js` (lazy) | `135.6 kB` | `28.7 kB` | 3D Monolith & Chronograph 2D Canvas Insights (zero WebGL) |
| `VaultView-*.js` (lazy) | `109.7 kB` | `23.9 kB` | Question Vault + Answer Curtain + magic-byte validation |
| `FocusView-*.js` (lazy) | `77.7 kB` | `17.6 kB` | Timer, Exam Hall, StandBy Desk Mode, Ambient Mixer |
| `GroupsView-*.js` (lazy) | `75.6 kB` | `17.7 kB` | Squads, Live Aura, Leaderboards |
| `SettingsView-*.js` (lazy) | `46.6 kB` | `10.9 kB` | Settings Stack + Sound Lab |
| `firebase-*.js` (lazy) | `569.5 kB` | `171.0 kB` | Loaded on demand for Cloud Sync / Squads |
| `three-*.js` (lazy) | `744.7 kB` | `188.2 kB` | Loaded on demand only on Focus & Syllabus |

---

## 8. v47 Pre-Publish Security, Bug & Dead-File Cleanup Sweep

1. **Vault Image Upload Defense (`src/utils/vaultImage.ts`, `src/utils/security.ts`, `src/utils/vaultStore.ts`)**:
   - Tightened pre-compression image upload cap from `25 MB` to `10 MB` (`MAX_IMAGE_FILE_BYTES = 10 * 1024 * 1024`) across both metadata pre-checks and binary magic-byte verification (strict JPEG `FF D8 FF`, PNG `89 50 4E 47`, and WebP `RIFF...WEBP` headers; SVG, HTML, scripts, and spoofed files are blocked with a calm inline alert).
   - Verified every `URL.createObjectURL` across Vault capture, list, cropper, and revision deck is revoked on replace, close, delete, or unmount.
   - Added IndexedDB `QuotaExceededError` detection inside `vaultStore.ts` (`waitTx`) and `storage.ts` (`persistState`) so full-device storage triggers the throttled backup warning toast instead of failing silently.
2. **XSS, Prototype Pollution, Backup Clamping & `.ics` Injection Defense (`src/utils/security.ts`, `src/utils/calendarExport.ts`, `src/components/TargetsCalendarView.tsx`, `src/App.tsx`)**:
   - Audited `src/` and confirmed zero `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `eval`, `new Function`, or `window.open` sinks.
   - Added `safeExternalHttpsUrl` to restrict external anchor targets (such as the Google Calendar quick-add link in `TargetsCalendarView.tsx`) strictly to validated `https://` URLs with `rel="noopener noreferrer"`.
   - Added `sanitizeImportedStatePayload` in `security.ts` and wired it into `App.tsx` JSON backup import (`onImportJson`), recursively stripping `__proto__`, `constructor`, and `prototype` keys and clamping `sessions`, `chapters`, `mocks`, `deadlineTargets`, `reminders`, and `profile` (finite positive timestamps, bounded non-negative durations, control-character-stripped length-capped strings).
   - Added `escapeIcsSingleLine` and CR/LF stripping inside `foldIcsLine` (`calendarExport.ts`) so single-line `.ics` properties (`SUMMARY`, `UID`, `CATEGORIES`, `VALARM DESCRIPTION`) cannot be broken by injected newlines while escaping RFC-5545 delimiters (`\`, `;`, `,`).
3. **Cloud Sync Dirty-Tracking & Sharding Bug Fix for `v44` Targets/Reminders (`src/utils/cloudSync.ts`)**:
   - Fixed a real sync bug where `detectDirtyDocKeys` only checked `prevState.tasks !== nextState.tasks`, omitting `deadlineTargets` and `reminders` changes from automatic `meta/tasks` dirty marking; also added both collections to `hasMeaningfulLocalData`.
   - Upgraded `splitDocIfOversized` so oversized `meta/tasks` documents shard `items`, `deadlineTargets`, and `reminders` cleanly across `meta/tasks__N` documents while staying under `MAX_DOC_BYTES` and Firestore's `<= 20` keys rule (`firestore.rules` left completely intact).
4. **Security Headers, Repository Hygiene & Dead-Code Cleanup (`index.html`, `.gitignore`, `public/sw.js`)**:
   - Added a strict `<meta http-equiv="Content-Security-Policy">` header alongside `<meta name="referrer" content="strict-origin-when-cross-origin" />` in `index.html`.
   - Expanded `.gitignore` to cover `*.keystore`, `*.jks`, `google-services.json`, and `.playwright-cli/`.
   - Routed remaining direct `localStorage.setItem` writes (`App.tsx`, `SettingsView.tsx`, `VaultView.tsx`, `uiHelpers.ts`) through `safeLocalStorageSet` for uniform quota handling.
   - Removed duplicate stale `/bun.lock` and 8 provably unused symbols/imports (`GroupsUserConfig`, `parseKey`, `syncLiveStatusForState` in `App.tsx`; `Award`, `Check`, `Illustration` in `GroupsView.tsx`; `total` in `StatsView.tsx`; `ConcentricRingSegment` in `TodayView.tsx`). Verified zero `console.log` statements in `src/` and zero hardcoded secrets.
   - `npm audit --omit=dev` reports only transitive advisories inside `@grpc/grpc-js` (Node.js server transport inside the `firebase` package, never bundled into the browser client).
   - Bumped `public/sw.js` `CACHE_NAME` to `'deep-hours-v47'`.

