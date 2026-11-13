# Deep Hours — Feature Parity & Information Architecture Map

This document inventories every feature, view, subtab, modal, setting, chart, keyboard/PWA shortcut, and background/sync capability verified in the codebase and maps each item to its redesigned location.

> **Duplicate Auto-Study Habits Notice (Reported, Not Deleted):**
> Starter habit presets and custom habits can create multiple active auto-from-timer habits (e.g., `STARTERS[0]` `"Deep Study (3 hrs)"` alongside another auto-study habit such as `"STUDY"`). Both share `subjectId`/`autoMins` auto-completion logic via `syncStudyHabitsInPlace`. Per design rules, existing user habits are **never** automatically deleted or merged; both remain visible and editable in **Today -> Habits** and **Settings -> Habits**.

---

## 1. Navigation & Global Shell

| Feature / Element | Previous Location | New Location | Status |
| --- | --- | --- | --- |
| Primary bottom navigation (Phone `<768px`) | 6 items + center `+` FAB | 5 tabs with Lucide SVG icons (`Today`, `Focus`, `Prep`, `Insights`, `Community`); no FAB | `[x]` |
| Tablet / Desktop navigation (`>=768px`) | Centered single column only | Fixed left navigation rail (`232px`), `32px` gutters, `1120px` max content width | `[x]` |
| Desktop 2-column Today workspace (`>=1100px`) | Single vertical scroll (~3 screens) | Main left column + right rail for Today's timeline & reflection | `[x]` |
| Top bar & page header | Embedded inside `TodayView` + per-view headers | Collapsing `TopBar` with title, sync status dot, `+` Quick actions trigger, Avatar (`Settings`) | `[x]` |
| Mini active timer bar | Small pill inside `TodayView` header | Docked `MiniTimerBar` above bottom tabs / bottom edge whenever active timer exists and user is not on `Focus` | `[x]` |
| Offline indicator & Cloud Sync status | Buried in `MoreView` | Sync status dot in `TopBar` + live online/offline banner + full controls in `Settings > Account and cloud sync` | `[x]` |
| PWA App Shortcuts (`/?shortcut=start`, `/?shortcut=task`) | Not yet registered | Registered in `manifest.webmanifest` and handled in `App.tsx` on load | `[x]` |
| Service Worker update prompt & BroadcastChannel cross-tab sync | `App.tsx` toast | Preserved in `App.tsx` with `Toast` component (safe guard when timer running) | `[x]` |
| ErrorBoundary + Raw JSON recovery + Storage load failure recovery | `ErrorBoundary.tsx`, `App.tsx` | Preserved in `ErrorBoundary.tsx` and `App.tsx` (`Restore from last backup`, `Retry`, `Start fresh`) | `[x]` |

---

## 2. Quick Actions (`TopBar +`) & Status Row

| Feature / Element | Previous Location | New Location | Status |
| --- | --- | --- | --- |
| `+` Quick Actions sheet | Center FAB (manual session only) | `TopBar +` opens `QuickActionsSheet`: Start session, Log session, Add task, Add habit, Add chapter, Log mock, Add mistake, Add doubt, Log PYQ, Add D-Day | `[x]` |
| Streak status chip + explanation + Rest Pass toggle | Top pill (`🔥 Nd min-streak`) + inline button | Labelled `StatusRow` item (`Streak`) -> opens Streak explanation `Sheet` with `minDayMinutes` rule, progress, and Rest Pass toggle (`handleToggleRestDay`) | `[x]` |
| Consistency status chip + explanation | Top pill (`⚡ N`) without label | Labelled `StatusRow` item (`Consistency`) -> opens Consistency explanation `Sheet` with 0–100 breakdown (minimum days, weekly volume, avg purity, habit completion) | `[x]` |
| Level & XP chip + explanation | Top pill (`Lv N · X XP`) without tap | Labelled `StatusRow` item (`Level`) -> opens Level & XP explanation `Sheet` with progress meter, today's breakdown, and all 9 XP rules | `[x]` |
| Exam D-Day strip & Pace fallback | Multi-card horizontal strip + strict `primary` check | Compact `ExamCountdownCard` (`"Exam in N days"` using `primary` or nearest upcoming D-Day fallback); full exam CRUD in `Settings > Exams` | `[x]` |

---

## 3. Core Views Parity

### Today (`tab === 'today'`)
| Feature | Mapping & Notes | Milestone | Status |
| --- | --- | --- | --- |
| 7-day rolling week selector + proportional study mini bars | Kept in `TodayView` (`.wk-bar-track` / `.wk-bar-fill` scaled by daily study / goal) | R2 | `[x]` |
| Concentric hero ring (study goal by subject outer + habits/tasks inner), `40–46px` hero readout + coaching copy | `TodayView` top Lumen Hero card (`ConcentricProgressRing`, `CountUp`) | R2 | `[x]` |
| Pace summary line + Burnout check-in card (dismissible 3d) | Uses `computeUiPaceReport` (upcoming D-Day fallback); refined in M3/R2 | M2 / M3 | `[x]` |
| Subject daily targets & "Study Next (Top 3 Chapters)" | Kept in `TodayView` as horizontal snap-scroll `.dh-carousel` (<768px) / 3-col grid (>=768px) with `Focus` CTA | R2 | `[x]` |
| Daily tasks (add, subject tag, complete, edit title, move tomorrow, change date, delete + Undo, unfinished earlier days rollover) | Circular `.dh-task-check` toggle, animated strike-through, `EmptyState` illustration | R2 | `[x]` |
| Revisions due & overdue (complete, reschedule date picker) | Kept in `TodayView` with `.dh-scroll-chips` | M3 / R2 | `[x]` |
| Daily Focus Tip & Next Tip rotator | Kept in `TodayView` | M3 | `[x]` |
| Quick session starter (subject chips, chapter, heading, mode chips + `56px` XL `Start focus` CTA) + completed sessions list (`EmptyState` illustration) | Promoted to top Hero card in `TodayView` + accessible from `+ Quick Actions` | R2 | `[x]` |
| Habits list (category filter, starters onboarding, toggle, `+/-`, skip, auto-from-timer indicator, edit modal) | Preserves all habits including any duplicate auto-from-timer habits | M3 | `[x]` |
| Daily reflection, mood 1–5, sleep stepper (0–14h), energy 1–5, daily note | Kept in `TodayView` (desktop right rail in CSS grid) | M3 | `[x]` |

### Focus (`tab === 'focus'`)
| Feature | Mapping & Notes | Milestone | Status |
| --- | --- | --- | --- |
| Active timer display (`Digital`, `Mono`, `Analog`), phase toggle (Work/Break), overtime `+MM:SS`, focus purity bar | Centered non-blocking clock staged over full-bleed `320px` 3D Focus Core (`!deskMode`), `56px` XL Start/Pause/Resume CTA | R2 | `[x]` |
| Live session progress vs target SVG chart | Uses zero-dep SVG `BarChart` (`Charts.tsx`); hidden in Stopwatch mode (shows 15m milestone pill instead) | R2 | `[x]` |
| Mode switcher (`Pomodoro`, `Countdown`, `Stopwatch`, `Full Mock` 180m default) + Full Mock section splits | Preserved via non-wrapping `Segmented` control (`overflow-x: auto`) | M4 / R2 | `[x]` |
| Mid-session topic/subject/chapter switcher & slice auto-commit | Preserved via floating interactive Subject/Chapter chip opening Topic `Sheet` (`#sessionHeadingInput`) | R2 | `[x]` |
| Picture-in-Picture (`video` Android/Chrome Canvas PiP + `doc` Document PiP), Fullscreen Desk mode, Wake Lock | Canvas & Doc PiP untouched (`useFloatingTimerPiP.ts`); compact bar above log | M4 / R2 | `[x]` |
| Web Audio focus soundscapes (`off`, `brown`, `pink`, `rain`) + volume slider | Preserved (`audioEngine.ts` untouched); copy normalized to `"Focus sounds"` in Settings/Focus | M4 | `[x]` |
| `Space` keyboard shortcut to Pause/Resume active timer + Session checklist (`todos`) + Today study log | Preserved with `noSessions` `EmptyState` illustration | M4 / R2 | `[x]` |
| Stopwatch / Timer quick presets & `timerConfig` dialog | Preserved (`Modals.tsx` Sheet/Dialog) | M2 | `[x]` |

### Prep (`tab === 'prep'`)
| Feature | Mapping & Notes | Milestone | Status |
| --- | --- | --- | --- |
| Syllabus Galaxy 3D hero + subject filter sync | Top `268px` `SyllabusGalaxyScene` with synced `.dh-scroll-chips` subject filter dimming non-matching stars and auto-highlighting active subject | R3 | `[x]` |
| Syllabus Pace Calculator (D-Day days remaining, chapters/day, revision buffer, status) | Fixed upcoming D-Day fallback (`computeUiPaceReport`) in M2; horizontal overflow prevented | M2 / R3 | `[x]` |
| Chapters CRUD & Subject Completion Donut (single + bulk paste Sheet, status, confidence log 1–5, study focus launch) | `PrepView` subject `DonutChart`, collapsible chapter groups, `Meter` progress, `Select` Sheet pickers, `noSyllabus` `EmptyState` | R3 | `[x]` |
| Spaced Revisions per chapter (`suggestRevisionDates` editable draft, manual add, done toggle, reschedule, delete) | Preserved with inline date pickers and suggested +1/+3/+7/+21d prompt | M5 / R3 | `[x]` |
| Dedicated PYQ Tracker subtab (`PYQView`) + inline PYQ logger & per-chapter accuracy breakdown | 5-segment Prep navigation (`Syllabus \| Mocks \| Mistakes \| Doubts \| PYQs`), `Sheet` form, `noPyqs` `EmptyState` | M5 / R3 | `[x]` |
| Mock Tests log, `AreaLineChart` progression (`>= 2` mocks), target score setting, mock edit/delete + Undo | Redesigned in `PrepView` (`Mocks` subtab) with zero-dep SVG `AreaLineChart` and `noMocks` `EmptyState` | R3 | `[x]` |
| Mistake Log (`MistakesView`) & filter by reason/subject/resolved + 1-tap `Rev +1d` | Root-cause `Meter` bars, `Select` Sheet filters, `Sheet` modal, unnested `noMistakes` `EmptyState` | M5 / R3 | `[x]` |
| Doubt Queue (`DoubtsView`) open/resolved toggle & chapter linkage | Inline capture + `Sheet` modal, `Select` Sheet pickers, `noDoubts` `EmptyState` | M5 / R3 | `[x]` |

### Insights (`tab === 'stats'`, formerly "Summary")
| Feature | Mapping & Notes | Milestone | Status |
| --- | --- | --- | --- |
| Overview 3D Study Skyline top hero & SVG analytics (`Overview \| Weekly review \| History \| Timeline`) | 12-week `StudySkylineScene` promoted to top hero of `Overview` (`HeatmapGrid` flat fallback), `.dh-hero-lumen` 7d hero (`Sparkline` + SVG `BarChart`), `DonutChart`, `RadialClock24h`, `SemiCircleGauge`, `AreaLineChart`, `noSessions` `EmptyState` | R3 | `[x]` |
| Day History (`DayHistoryView`, `"History"`) collapsible calendar & `Did` / `Didn't do` snapshot rows | Redesigned inside `Insights > History` (`buildDayArchiveRecord` preserved) | M5 / R3 | `[x]` |
| 10m Timeline (`PlannerView`) active window `±1h` default with `"Show full 24h"` `Switch` & tap-to-inspect slot bar | Redesigned inside `Insights > Timeline` (`Geist Mono` clock grid, widened `58px` hour column) | M5 / R3 | `[x]` |
| Weekly Review (`ReviewView`) narrative stats, subject hours vs weekly target `Meter`s, sleep insight & `"Copy summary"` | Redesigned inside `Insights > Weekly review` | M5 / R3 | `[x]` |

### Community (`tab === 'groups'`, formerly "Groups")
| Feature | Mapping & Notes | Milestone | Status |
| --- | --- | --- | --- |
| `.dh-hero-lumen` signed-out landing card (`signedOutCommunity` illustration, 3 trust points, `"Sign in with Google"` button), consent gate, profile requirement | Redesigned in `GroupsView` | R3 | `[x]` |
| Create / Join / Leave group with invite code (`XXXX-XXXXXX`), active group chips, privacy sharing `Switch`es (`t`, `x`, `s`, `m`, `l`) | Redesigned in `GroupsView` with `Sheet` modals and `Switch` controls | M5 | `[x]` |
| Sticky segmented leaderboards (`Today`, `Week`, `XP`, `Streak`, `Mocks`, `History`) + animated top-3 podium + pull-to-refresh + manual refresh | Redesigned in `GroupsView` with overflow-safe podium cards | M5 / R3 | `[x]` |
| Member list with Early Bird / Night Owl badges, hover tooltip for active Studying Now duration, tap member name to expand 7-day SVG consistency chart | Zero-dependency SVG `BarChart` (`Charts.tsx`) replacing `recharts` | R3 | `[x]` |
| Peer pace target comparison, weekly group goal meter, Cheer modal/cooldown, Owner management drawer | Redesigned in `GroupsView` | M5 | `[x]` |

---

## 4. Settings Stack (`TopBar Avatar` & `tab === 'more'`)

All old `MoreView` controls map into a grouped navigation stack in `SettingsView`:

| Settings Group | Contained Controls & Actions | Status |
| --- | --- | --- |
| 1. Profile and level | Avatar emoji grid, Anonymous Study Profile (`ProfileModal`) button, current level & XP summary | `[x]` |
| 2. Account and cloud sync | Google sign-in / sign-out, Sync Now, today's write budget (`writes / DAILY_WRITE_CAP`), last synced timestamp, online/offline status, Delete All Cloud Data confirmation, privacy note | `[x]` |
| 3. Study | Day reset hour (`Select` Sheet picker -> `confirmResetHour`), Week start (`Segmented` Mon/Sun), Timer style (`Segmented` `Digital \| Mono \| Analog` storing `'neon' \| 'minimal' \| 'retro'`), PiP engine (`Segmented` Video/Document) | `[x]` |
| 4. Goals and targets | Min streak study minutes/day, monthly Rest Passes, revision buffer days, full mock duration (min, default 180), target mock score, spaced revision intervals (`1, 3, 7, 21`), per-subject daily & weekly minute targets | `[x]` |
| 5. Exams | Full D-Days list, primary exam toggle, Edit / Remove existing D-Day, `+ Add Exam Countdown` | `[x]` |
| 6. Subjects | Active subjects list, inline Edit (emoji, name, color via `Select` Sheet), Delete with Undo, `+ Add Subject` | `[x]` |
| 7. Habits | `+ New Habit` trigger, active and archived habits list with one-tap edit (`Modals` habit sheet) | `[x]` |
| 8. Appearance | Theme mode (`Segmented` Auto/Dark/Light), AMOLED true-black (`Switch` persisted in `localStorage` `'dh_amoled'`), Accent swatch picker (including `Lumen #F5C451` + `ACS` with AA labels), 3D scenes (`Segmented` Auto/On/Off persisted in `settings.ui3d`), 3D detail quality (`Segmented` Auto/High/Lite persisted in `settings.ui3dQuality`) | `[x]` |
| 9. Notifications and sound | Completion sounds & haptics (`Switch`), browser study reminders (`Switch`), PWA Install button & collapsible iOS Safari guide | `[x]` |
| 10. Data | Last backup date, Export JSON backup, Export CSV spreadsheet, Import JSON backup (10 MB limit, with Undo), Erase All Device Data (`confirmReset`) | `[x]` |
| 11. About | App version, offline-first storage notes, Focus sounds & Study Logger action notice (moved to `+` Quick Actions) | `[x]` |

*(Removed `"Study Logger Actions"` card per spec; its Log Session / Add Habit actions live in `TopBar +` Quick Actions and `Settings > Habits`.)*

---

## 5. Modals, Dialogs & First-Run Onboarding (`Modals.tsx`, `ProfileModal.tsx`, `OnboardingSheet.tsx`)

| Modal | New Presentation | Status |
| --- | --- | --- |
| `OnboardingSheet` (first run) | Skippable 3-step `Sheet` persisted in `localStorage` (`dh_onboarded_v2`): live lazy 3D `FocusOrbitScene` preview, optional exam D-Day + daily goal presets, and active subjects selector | `[x]` |
| `habit` (`#hf`) | `Sheet` with `Select` sheets for Category, Schedule, and Subject | `[x]` |
| `reflect` (`#reflectForm`) | `Sheet` with `Select` sheet for Chapter, focus star rating, note, discard | `[x]` |
| `manualSession` (`#manualSesForm`) | `Sheet` with `Select` sheet for Chapter, logical day/start time/duration inputs, delete with Undo | `[x]` |
| `mock` (`#mockForm`) | `Sheet` preserving `exceedsMaxQuestions` warning, per-subject scoring, and `queuedMistakes` with `Select` sheets | `[x]` |
| `timerConfig` (`#cfgTimerForm`) | `Sheet` for Pomodoro work/break, countdown, and Full Mock (default 180m) | `[x]` |
| `dday` (`#ddayForm`) | `Sheet` with presets, target date, swatch color picker (`Select` / swatches), primary toggle, delete with Undo | `[x]` |
| `confirmResetHour` | `Dialog` confirmation before recalculating session `dayKey`s | `[x]` |
| `confirmReset` | `Dialog` confirmation before wiping device data (with Undo toast) | `[x]` |
| `ProfileModal` | `Sheet` / `Dialog` with nickname validation (`validateNickname`), emoji picker, exam year chips | `[x]` |

---

## 6. Interaction, Motion & Keyboard Shortcuts

| Feature | Implementation | Status |
| --- | --- | --- |
| Swipe-to-complete & swipe-to-delete on tasks & habits | `SwipeableRow.tsx` touch-event listeners (`onTouchStart`, `onTouchMove`, `onTouchEnd`) with visual feedback, `navigator.vibrate` haptics, Undo toast support, and visible button alternatives | `[x]` |
| Command Palette (`Ctrl/Cmd+K`) | `CommandPalette.tsx` keyboard-navigable dialog to jump to screens (`Today`, `Prep`, `Focus`, `Insights`, `Community`, `Settings`), syllabus chapters, and quick actions | `[x]` |
| Desktop Keyboard Shortcuts (`Space`, `N`, `1`–`5`, `?`) | Global `keydown` listener in `App.tsx` (disabled when typing in inputs) + `KeyboardShortcutsSheet.tsx` | `[x]` |
| Pull-to-refresh on Community & View Transitions API | Touch pull-to-refresh in `GroupsView.tsx` + progressive `document.startViewTransition` on tab switches (respecting `prefers-reduced-motion`) | `[x]` |

---

## 7. Three.js Optional, Lazy, GPU-Safe Scenes (Milestone 5 & Round 2)

| Scene / Component | Location & Behavior | Status |
| --- | --- | --- |
| `Scene3D.tsx` Core Wrapper | `src/components/three/Scene3D.tsx` · Dynamic `import('three')` lazy chunking, `ResizeObserver`, `IntersectionObserver` + `document.hidden` + `deskMode` auto-pause, full geometry/material/texture/renderer disposal, `webglcontextlost`/`restored` handling, error boundary fallback, and `evaluateUi3dEligibility` (`auto` / `on` / `off`, Lite vs. Normal tiers) | `[x]` |
| `FocusOrbitScene.tsx` | `src/components/three/FocusOrbitScene.tsx` in `FocusView.tsx` & `OnboardingSheet.tsx` · `320px` (or `200px` preview) interactive Focus Core (`THREE.ShaderMaterial` Fresnel + 3D noise vertex wobble core, additive halo sprite, `1500` High / `400` Lite curl-drifting dust particles, 60-segment `InstancedMesh` progress arc, up to 12 Pomodoro satellite orbs), state-reactive motion, drag-to-spin inertia, tap pulse + haptics, press-and-hold (`>460ms`) 4-4-4 breathing cue, pause-animation toggle, and accessible `sr-only` readout | `[x]` |
| `StudySkylineScene.tsx` | `src/components/three/StudySkylineScene.tsx` promoted to top hero in `StatsView.tsx` (`Insights > Overview`) · 12-week × 7-day 3D bar matrix (`THREE.InstancedMesh`, 84 bars) on grounded plinth, pointer drag-orbit with clamped polar angles (`0.42–1.28` rad), raycaster hover/tap DOM tooltip with `"Open day record"`, and `"3D Skyline" \| "Flat view"` toggle with SVG `HeatmapGrid` fallback | `[x]` |
| `SyllabusGalaxyScene.tsx` | `src/components/three/SyllabusGalaxyScene.tsx` in `PrepView.tsx` (`Prep > Syllabus`) · `268px` spatial star clusters per active NEET subject (`THREE.InstancedMesh`, up to 600 stars), synced `.dh-scroll-chips` subject filter dimming non-matching stars and auto-highlighting active clusters, raycaster hover/tap DOM tooltip with `"Focus chapter"` action | `[x]` |
| `Settings > Appearance > 3D scenes & quality` | `src/components/SettingsView.tsx` · `ui3d` (`Auto \| On \| Off`) + `ui3dQuality` (`Auto \| High \| Lite`) `Segmented` controls with battery/performance note | `[x]` |

---

## 8. Offline Precaching, Performance & Accessibility (Milestone 6 & Round 2)

| Capability | Implementation & Location | Status |
| --- | --- | --- |
| Build-time precache manifest | `vite.config.ts` (`precacheManifestPlugin`) emits `precache-manifest.json` on build listing all generated JS, CSS, and self-hosted Geist font assets | `[x]` |
| Service worker offline precaching & reload prompt | `public/sw.js` (`CACHE_NAME = 'deep-hours-v9'`) precaches `precache-manifest.json` entries + `/icon-maskable.svg` on `install`, keeps network-first navigation, and applies `SKIP_WAITING` only via user-tapped reload toast | `[x]` |
| Lazy chunk isolation | `vite.config.ts` (`manualChunks`) + dynamic `import()` / `React.lazy` keep Firebase, `three`, and `OnboardingSheet` out of the entry bundle (`recharts` completely removed) | `[x]` |
| Lightweight list windowing (>100 rows) | `src/components/ui/WindowedList.tsx` & `computeWindowRange` (`src/utils/uiHelpers.ts`) active on `PrepView` chapters & mocks, `PYQView` summaries & logs, `MistakesView`, `DoubtsView`, `StatsView` session log, `DayHistoryView` sessions, `TodayView` tasks & sessions, and `FocusView` expanded sessions | `[x]` |
| WCAG AA contrast & keyboard focus | `--tx-3` darkened/lightened (`#8E97A6` / `#565E6B`), `-ink` semantic color tokens across Dark, AMOLED, and Light, `:focus-visible` focus rings on all interactive elements, `13px` minimum UI font floor, `Field.tsx` auto-`htmlFor` / `aria-label` coverage, 200% text scaling reflow without clipping, and `prefers-reduced-motion` support | `[x]` |

