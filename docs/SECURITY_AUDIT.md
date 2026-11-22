# Deep Hours — Final Security Audit, Crash-Proofing & Dead-Code Report (v41)

## 1. Executive Summary
Deep Hours v41 completes a full-codebase security hardening, crash-proofing, resource-leak audit, and verified dead-code purge with **zero new npm packages**, **zero UI regressions**, and **173/173 passing unit tests** (including 14 new security and Firestore contract tests in `src/utils/security.test.ts`).

---

## 2. Client-Side Security Hardening

All shared security and resilience primitives are consolidated in `src/utils/security.ts` and wired across untrusted boundaries:

| Area | Vulnerability / Risk Addressed | Hardening Implemented |
| --- | --- | --- |
| **Prototype Pollution** | Raw `JSON.parse` on user-supplied backups, `.dhvault.json` archives, and `localStorage` sidecars could accept `__proto__`, `constructor`, or `prototype` keys. | Added `safeJsonParse`, `safeJsonParseStrict`, and `stripDangerousKeys` (reviver + recursive plain-object clone) across `App.tsx` (`onImportJson`), `storage.ts`, `vaultArchive.ts`, `cloudSync.ts`, `groups.ts`, `GroupsView.tsx`, `vaultCurtain.ts`, `mockLeaks.ts`, `mockReport.ts`, `ambientMixer.ts`, `parkingLot.ts`, and `examClock.ts`. |
| **Vault File & Archive Uploads** | `vaultImage.ts` previously accepted `image/svg+xml` via broad `image/*` matching and lacked binary header checks and pixel decompression-bomb caps; `vaultArchive.ts` permitted GIF/AVIF and did not verify decoded binary signatures or total decoded archive bytes. | Restricted `VaultCaptureSheet.tsx`, `vaultImage.ts`, and `vaultArchive.ts` strictly to raster JPEG, PNG, and WebP (`image/jpeg`, `image/png`, `image/webp`). Added binary magic-byte header verification (`detectImageMagicBytes` / `validateImageFileSignature`) blocking SVG, HTML, plain text, and spoofed extensions/MIME types. Enforced pixel dimension (`<= 12,000 px`), decompression-bomb (`<= 48 MP`), per-file (`<= 25 MB`), and total `.dhvault.json` decoded-bytes (`<= 45 MB`) caps. |
| **CSV Formula Injection** | `onExportCsv` in `App.tsx` left date/numeric fields unquoted and did not neutralize standalone leading `\t` / `\r` payloads. | Routed every CSV export row through RFC-4180 `encodeCsvRow` / `sanitizeCsvCell`, neutralizing leading `=`, `+`, `-`, `@`, `\t`, and `\r` (including after leading whitespace) with a single-quote prefix inside quoted cells. |
| **XSS & DOM Sinks** | Two legacy `container.innerHTML = ''` DOM clears existed in `src/components/three/Scene3D.tsx`. | Replaced both with `container.replaceChildren()`. Verified zero `dangerouslySetInnerHTML`, `eval`, `new Function`, or `javascript:` URLs across `src/`. |
| **Privacy, Anti-Cheat & Quota Guards** | Fallback nickname in `groups.ts:buildMyMemberEntry` could bypass `sanitizePlainText` and leak `@` or control chars; rapid Wave/cheer clicks or Live Aura toggles lacked client-side write cooldowns; `partitionStateToCloudDocs` did not clamp impossible `activeMs` values. | Hardened `buildMyMemberEntry` fallback nickname to strip `@` and control chars; verified zero `email` or `photoURL` fields ever enter squad docs; clamped synced `activeMs` to `[0, 86_400_000]` (24h max); added `createCooldownGuard` throttling on `sendCheerInCloud` (2.5s) and `handleToggleLiveAuraEnabled` (1.5s). |
| **Cross-Account Device Isolation** | Signing out or switching Google accounts on a shared device left in-memory and `localStorage` sync outbox (`dh_sync_meta`) and squad snapshots (`dh_groups_cache_v1`, `dh_groups_budget_v1`) behind. | Added `clearSyncOutboxOnSignOut()` in `cloudSync.ts` and `clearAllCachedGroupSnapshots()` in `groups.ts`, invoked automatically on sign-out (`onSignOutGoogle`) and whenever `subscribeToAuthChanges` observes sign-out or a UID change. |
| **Service Worker & Referrer Policy** | `public/sw.js` did not explicitly bypass Firebase Auth/Hosting/API routes; `index.html` lacked a referrer policy meta tag. | Updated `public/sw.js` (`CACHE_NAME = 'deep-hours-v41'`) to explicitly bypass `/__/auth/`, `/__/firebase/`, `/api/`, and Google/Firebase API origins (`googleapis.com`, `gstatic.com`, `identitytoolkit`, `securetoken`, `firebaseapp.com`). Added `<meta name="referrer" content="strict-origin-when-cross-origin" />` to `index.html`. |

---

## 3. Server-Side `firestore.rules` Red-Team Audit

A line-by-line review of `firestore.rules` (v24) against every read/write path in `src/utils/cloudSync.ts` and `src/utils/groups.ts` confirmed:

1. **Authentication & Verification**: Every read/write requires `request.auth != null && request.auth.token.email_verified == true`.
2. **Owner-Only User Sync (`users/{userId}/{coll}/{docId}`)**: Strictly enforces `request.auth.uid == userId`, restricts collections to `['meta', 'months']`, validates `docId` regexes, caps document key counts (`<= 20`), and requires positive `updatedAt`.
3. **Squad Anti-Scraping & Immutability (`groups/{groupId}`)**:
   - `allow list: if false` prevents any collection enumeration/scraping.
   - Invite codes use a 10-character unambiguous alphabet (`32^10` keyspace).
   - `ownerUid`, `createdAt`, `memberCap`, and per-member `joinedAt` are immutable after creation.
   - `members.{uid}` enforces strict `hasAll`/`hasOnly` allowlists (16 bounded keys, zero `email`/`photoURL`), caps `mocks` to `<= 10` items with exact `['d', 's', 'm']` keys, and bounds `activeSession` (`startedAt`, `subjectLabel <= 40`, `subjectColor <= 24`).
4. **Zero-Read Cheer DoS Protection (`groups/{groupId}/cheers/{cheerId}`)**: Static field validation (`from == request.auth.uid`, `from != to`, deterministic `cheerId == dayKey_from_to`, emoji allowlist) runs **before** `exists()` / `get()`, preventing unauthenticated or malformed writes from triggering billable rule reads.
5. **Default Deny**: Catch-all `match /{document=**} { allow read, write: if false; }` remains enforced.

**Decision**: `firestore.rules` required **zero modifications**, preserving 100% live compatibility for Cloud Sync and Squads. Payload adherence is continuously locked by automated contract tests (`validateFirestoreUserDocContract`, `validateFirestoreMemberEntryContract`, `validateFirestoreCheerContract`) in `src/utils/security.test.ts`.

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
