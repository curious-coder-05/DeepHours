# Firestore Security Specification — Deep Hours (v42)

## 1. Access Control Model
All rules are enforced in [`firestore.rules`](./firestore.rules) (`rules_version = '2'`) with a catch-all default deny (`match /{document=**} { allow read, write: if false; }`).

- **Verified Authentication Required**: Every allowed read or write requires `request.auth != null && request.auth.token.email_verified == true`.
- **Personal Cloud Sync (`/users/{userId}/{coll}/{docId}`)**:
  - Owner-only access (`request.auth.uid == userId`).
  - Restricted strictly to collections `meta` (allowlisted doc IDs `index|core|habits|syllabus|mocks|mistakes|doubts|pyq|tasks` with optional `__NN` shard suffix) and `months` (`YYYY-MM` with optional `__NN` shard suffix).
  - Document key ceiling `<= 20` and positive numeric `updatedAt` required on writes.
- **Study Squads (`/groups/{groupId}`)**:
  - `allow list: if false` prevents scraping or enumerating squads; `allow get` requires a valid 10-character unambiguous invite code (`^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$`).
  - Immutable fields after creation: `ownerUid`, `createdAt`, `memberCap` (`2..50`), and each member's `joinedAt`.
  - `members.{uid}` enforces strict 16-key allowlists (zero `email` or `photoURL` PII), bounded `mocks[0..9]` (`['d','s','m']`), bounded `live` (`<= 2h`), and v42 strict `activeSession` typing (`startedAt is int && > 0`, `subjectLabel` 1..40 chars, `subjectColor` matching `^#[0-9a-fA-F]{3,8}$`).
  - Update paths are strictly partitioned into Case A (**Join**: non-member adds only their own key), Case B (**Self**: member updates their own key with immutable `joinedAt`, or non-owner removes only their own key — v42 blocks `ownerUid` from self-leaving to prevent orphaned squads), and Case C (**Owner**: metadata updates or removing at most 1 non-owner member). Only `ownerUid` may delete the squad.
- **Squad Cheers (`/groups/{groupId}/cheers/{cheerId}`)**:
  - Readable only by `from` or `to`; immutable (`allow update: if false`); deletable only by `from`.
  - **Zero-Read DoS & Backfill Defense (v42)**: All static field checks run **before** `exists()` / `get()` (`bothAreGroupMembers`) so rejected writes cost `0` Firestore reads. Enforces `from == request.auth.uid`, `from != to`, deterministic `cheerId == dayKey + '_' + from + '_' + to`, emoji allowlist (`👏`, `🔥`, `💪`), `ts` within `±26h` (`93600000` ms) of `request.time.toMillis()`, and valid calendar `dayKey` (`isRecentCheerDayKey`) within `±48h` of `request.time`.

## 2. Resource Limits & Spark Free-Tier Protection
- Each personal sync document is bounded below 700 KB client-side (`splitDocIfOversized` in `src/utils/cloudSync.ts`) and strictly below Firestore's 1 MB limit.
- Client-side `SyncBudgetController` enforces debounce, minimum interval, pull throttling, and a daily write cap (`DAILY_WRITE_CAP`); Squad cheers and Live Aura toggles enforce client-side cooldown guards (`src/utils/security.ts`).
- Automated contract tests in `src/utils/security.test.ts` lock every client write payload and static `firestore.rules` invariant.
