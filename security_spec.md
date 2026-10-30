# Firestore Security Specification — Deep Hours

## 1. Access Control Model
- **Strict Per-User Isolation**: Every document in Firestore is stored under `/users/{userId}/meta/{docId}` or `/users/{userId}/months/{monthKey}`.
- **Authentication Required**: Unauthenticated requests (`request.auth == null`) are denied across the entire database.
- **Owner-Only Read/Write**: Only an authenticated user whose `request.auth.uid == userId` may read or write documents under `/users/{userId}/{document=**}`.
- **No Public or Cross-User Collections**: No shared or public collections exist; users can never read, list, or modify another user's study data.

## 2. Resource Limits & Free-Tier Protection
- Each document is bounded below 700 KB client-side (`splitDocIfOversized` in `src/utils/cloudSync.ts`) and strictly below Firestore's 1 MB limit.
- Client-side `SyncBudgetController` enforces a 60s debounce, 5m minimum interval, 15m pull throttle, and 150 writes/day cap.
