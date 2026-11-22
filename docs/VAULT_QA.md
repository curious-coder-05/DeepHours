# Deep Hours Question Vault — Manual QA Checklist

Verify these flows on both mobile touch viewports (`360×800` / `390×844`) and desktop (`1280×800`):

## 1. Navigation & Entry Points
- [ ] `Prep` tab shows 4 segments: `Syllabus | Mocks | Vault | PYQs` (no legacy `Mistakes` or `Doubts` sub-tabs).
- [ ] TopBar `+` Quick Actions opens with `Add to Vault` (navigates straight to `Prep > Vault` and opens the 3-step capture Sheet).
- [ ] `Command Palette` (`Ctrl/Cmd+K`) includes `Add to Vault` and `Go to Prep -> Vault`.
- [ ] On `Prep > Syllabus`, chapters with Vault items display `Vault · N` and jump directly to `Prep > Vault` filtered to that chapter (`Single-chapter header` with back-to-all chip and `Start revision`).
- [ ] Saving a Mock Test offers both `"Save & add to Vault"` button inside the sheet and an `"Add to Vault"` toast action afterward, both opening capture pre-set to `Hard / Trap`.

## 2. Capture, Cropper & Image Pipeline
- [ ] Rejects non-image files and files larger than `25 MB` with a clear inline message.
- [ ] Step 2 (`Crop`): dragging crop box and 8 handles moves/resizes without accidentally dismissing the parent Sheet (`stopPropagation` + `touch-action: none`); minimum crop size `64px` enforced.
- [ ] `Rotate 90°`, `Reset`, and `Full image` update crop geometry accurately.
- [ ] `Enhance text` (default ON) stretches contrast cleanly; `Keep colors` (default OFF) switches between grayscale and color output with live byte estimate.
- [ ] Encoded image stays `<= 150 KB` (`WebP` with automatic `JPEG` fallback if WebP encoding is unavailable).
- [ ] Step 3 (`Details`): remembers last used Subject/Chapter across opens, enforces Answer (`200`), Solution (`4000`), and Note (`200`) limits, and supports optional cropped Solution photo.
- [ ] Closing mid-capture with unsaved edits prompts a discard confirmation `<Dialog>`.

## 3. Vault Feed, Two-Stage Reveal & Legacy Notes
- [ ] Sticky 2-row filterbar: Row A scrolls horizontally with subject chips + counts (`All (N)`, `Subject (N)`), Row B hides smoothly while scrolling down (`>24px` delta) and reappears on scroll up.
- [ ] Comfortable grid (`1 / 2 / 3` cols) renders question photos lazily via `IntersectionObserver`; Compact density renders `72px` rows + `52px` thumbnails opening a Detail Sheet.
- [ ] Cards keep `answerText`, `solutionText`, and solution image absent from the DOM until `"Reveal answer"` or `"Reveal solution"` is toggled.
- [ ] Marking a question `Mastered` removes it from Active view (or updates under `All`) with a working `Undo` toast.
- [ ] Deleting a question opens a confirmation `<Dialog>` and writes a tombstone in `deephours-vault` without mutating `PulseHabitState`.
- [ ] Any pre-existing `state.mistakes` or `state.doubts` appear only in a collapsed `"Older notes · N mistakes, M doubts"` accordion at the bottom of Vault.

## 4. Revision Deck & Zoom Viewer
- [ ] `Start revision` lazy-loads `VaultRevisionDeck` (`z-index: 90`) showing only unmastered items in the active scope, ordered never-revised first then oldest `lastRevisedAt`.
- [ ] Active study timer badge renders read-only if a timer is running.
- [ ] `Shuffle` reorders cleanly; swipe left/right and keyboard shortcuts (`ArrowLeft`/`ArrowRight`, `A`, `S`, `M`, `Escape`) work; Next image preloads cleanly.
- [ ] Tapping question or solution photo opens `VaultZoomViewer` (`z-index: 95`) supporting pinch-to-zoom, pan, double-tap zoom toggle, and `+`/`-`/`Reset` buttons.

## 5. Offline IndexedDB, `.dhvault.json` Archives & Upload Security
- [ ] Vault stores items, blobs, tombstones, and meta strictly locally in IndexedDB `deephours-vault` (`navigator.storage.persist()` requested on first save; `onblocked` handled cleanly across tabs).
- [ ] `Erase all device data` checkbox `"Also erase my Vault on this device"` defaults unchecked; when checked it wipes `deephours-vault`.
- [ ] Uploads strictly accept raster JPEG, PNG, and WebP only — SVG, GIF, HTML, plain text, spoofed `.png`/`.webp` files failing binary magic-byte checks, files `> 25 MB`, and decompression bombs (`> 12,000 px` or `> 48 MP`) are rejected with a clear inline message.
- [ ] Exporting a Vault archive writes a portable `.dhvault.json` bundle containing question metadata and encoded raster blobs without leaking prototype keys.
- [ ] Importing a `.dhvault.json` archive strips dangerous keys (`__proto__`, `constructor`, `prototype`), validates every Base64 image's binary raster magic bytes and total decoded byte cap (`<= 45 MB`), and commits in a single atomic IndexedDB transaction.
- [ ] `VaultAnswerCurtain` (`Answer curtain`, `Mask bottom half`, `Peek / Reveal`, and draggable amber handle) works inside Quick-View, Zoom Viewer, and Revision Deck without interfering with scroll or sheet gestures.
