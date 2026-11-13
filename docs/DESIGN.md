# Deep Hours — Design System Specification

## 1. Art Direction
- **Restrained, content-first, calm**: Deep Hours is a daily study instrument for medical entrance preparation. Surfaces stay quiet so timers, chapters, mocks, and analytics remain legible for hours.
- **No decorative clutter**:
  - Flat surface fills only — no gradient buttons, no gradient headline text, no animated background drifts.
  - No neon outer glows or colored shadows.
  - Translucent glass (`backdrop-filter: blur(14px)`) is restricted strictly to the sticky `TopBar` and `BottomTabBar`.
  - No nested cards inside cards — secondary groupings inside cards use flat subtle containers (`--sf-2`) or hairline dividers (`--line`).
  - **Icons**: Lucide SVG icons (`1.75` stroke width, `20px` / `24px`) for all UI chrome. Emoji are kept only where user-chosen or user content (avatars, habit icons, subject icons).
  - **Microcopy**: Sentence case, plain language, zero hype or jargon (`Insights`, `Community`, `History`, `Focus sounds`, `Digital`, `Mono`, `Analog`). All-caps micro labels are prohibited.

---

## 2. Color Tokens

### Dark Default (`[data-t="dark"]` — Graphite Depth)
| Token | Value | Usage |
| --- | --- | --- |
| `--bg` | `#0B0D10` | Canvas background |
| `--sf-1` | `#14181F` | Primary card & navigation rail surface |
| `--sf-2` | `#1B2029` | Controls, inputs, secondary rows |
| `--sf-3` | `#232A35` | Hover / pressed / elevated controls |
| `--line` | `rgba(255, 255, 255, 0.10)` | Hairline borders & dividers |
| `--tx` | `#ECEFF4` | Primary text |
| `--tx-2` | `#A3ABB8` | Secondary text |
| `--tx-3` | `#8E97A6` | Tertiary metadata text (AA readable) |

### AMOLED True-Black Dark (`[data-t="dark"][data-amoled="1"]`)
Persisted separately in `localStorage` under `dh_amoled` (`"1"` / `"0"`):
- `--bg: #000000`
- `--sf-1: #0A0C0F`
- `--sf-2: #12151A`
- `--sf-3: #1A1E25`
- `--line: rgba(255, 255, 255, 0.10)`

### Light Warm Paper (`[data-t="light"]`)
- `--bg: #F6F4EF`
- `--sf-1: #FFFFFF`
- `--sf-2: #EFECE5`
- `--sf-3: #E6E1D7`
- `--line: rgba(20, 22, 26, 0.10)`
- `--tx: #14161A`
- `--tx-2: #4B515C`
- `--tx-3: #68707D`

### Accent & Contrast Rules
- Default signature accent **"Lumen"**: `#F5C451` with on-accent ink `#1A1400`.
- All user-selectable accent presets (`Lumen`, `Sky`, `Mint`, `Indigo`, `Violet`, `Rose`, `Amber`) dynamically compute:
  - `--ac`: selected accent hex
  - `--ac-on`: highest-contrast dark (`#1A1400`) or light (`#FFFFFF`) text for solid primary controls (`>= 4.5:1` WCAG AA)
  - `--ac-ink`: readable accent text for tinted states (`12%` accent fill + `1px` accent border), automatically darkened on light warm paper so yellow/amber accents achieve `>= 4.5:1` contrast everywhere.
  - `--ac-soft`: `color-mix(in srgb, var(--ac) 12%, transparent)`
  - `--ac-bd`: `color-mix(in srgb, var(--ac) 48%, transparent)`

### Semantic Colors
- `--ok` (Success): `#4ADE80` (dark) / `#15803D` (light ink)
- `--warn` (Warning): `#FB923C` (dark) / `#C2410C` (light ink)
- `--err` (Danger): `#F87171` (dark) / `#B91C1C` (light ink)
- `--info` (Info): `#60A5FA` (dark) / `#1D4ED8` (light ink)

### Subject Colors
User subject colors stay intact and are used exclusively as **dots, thin progress meters, bar series, and subtle borders** — never as full card fills. Any text placed directly over a subject fill computes its readable ink via `getReadableOnColor`.

---

## 3. Typography
- **UI Typeface**: `Geist Variable` (self-hosted `@fontsource-variable/geist`) with `font-variant-numeric: tabular-nums` on numeric counters and tables.
- **Monospace Typeface**: `Geist Mono Variable` (self-hosted `@fontsource-variable/geist-mono`) used **exclusively** on study timers (`FocusView`, `MiniTimerBar`, active counters) and the `10m Timeline` clock grid.
- **Type Scale** (minimum UI font size `13px`; zero `<13px` text in shell/cards):
  - Display: `46px` (`font-weight: 700`, `line-height: 1.02`, `letter-spacing: -0.025em`)
  - Title: `30px` phone / `32px` desktop (`font-weight: 700`, `line-height: 1.15`, `letter-spacing: -0.02em`)
  - Heading: `20px` (`font-weight: 600`, `line-height: 1.25`)
  - Body: `16px` (`font-weight: 500`, `line-height: 1.5`)
  - Secondary: `14px` (`font-weight: 500`, `line-height: 1.45`)
  - Caption / Meta: `13px` (`font-weight: 500`, `line-height: 1.35`)

---

## 4. Layout Grid, Spacing & Motion
- **Grid**: `4pt` base unit.
- **Gutters & Max Width**: `20px` phone (`<768px`), `32px` tablet & desktop (`>=768px`); max content width `1120px`.
- **Navigation Shell**:
  - `<768px`: Bottom 5-tab bar (`Today`, `Focus`, `Prep`, `Insights`, `Community`) — no FAB.
  - `>=768px`: Fixed left navigation rail (`232px`), scrollable content stage.
  - `>=1100px`: `Today` shifts to a two-column workspace with today's sessions & reflection anchored in the right rail.
- **Sizing & Radii**:
  - Card padding: `16px`–`20px`; section gap: `32px` (or `24px` compact within views).
  - List rows: `min-height: 56px`; interactive tap targets: `>=48px` (controls `40px`/`48px`).
  - Border radius: Controls `12px`, Cards `16px`, Sheets `24px`.
- **Motion**:
  - Durations: `120ms` (press/hover), `200ms` (state switch/segmented), `320ms` (sheet/modal/page).
  - Curves: `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)` and `--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1)`.
  - Respects `prefers-reduced-motion: reduce`.

---

## 5. UI Primitives (`src/components/ui/`)
- `Button` (`primary` | `secondary` | `ghost` | `danger`, size `40` | `48`)
- `IconButton` (required `aria-label`, `>=44/48px` target)
- `Card` (flat `--sf-1`, `1px solid var(--line)`, radius `16px`)
- `ListRow` (leading, title, subtitle, trailing, optional chevron, `>=56px`)
- `Segmented` (animated sliding thumb via `transform`, accessible `role="tablist"`)
- `Chip` (tinted active state with `12%` accent background + `--ac-ink` + `1px` border)
- `Switch` (`role="switch"`, keyboard accessible)
- `Field` (accessible label, hint, error message)
- `Select` (button trigger opening a searchable/scrollable `Sheet` option picker instead of native `<select>`)
- `Sheet` (drag handle pill mobile bottom sheet / centered modal desktop, backdrop & Escape dismiss, focus trap)
- `Dialog` (confirmation & prompt dialog with focus return)
- `ProgressRing`, `ConcentricProgressRing`, `Meter`, `Stat`, `CountUp`, `EmptyState`, `Illustration` (`noSyllabus` | `noSessions` | `noTasks` | `signedOutCommunity` | `noMocks` | `noMistakes` | `noDoubts` | `noPyqs`), `Skeleton`, `Toast`, `TopBar`, `BrandLogo`, `SectionHeader`, `OnboardingSheet` (`localStorage` `'dh_onboarded_v2'`)
- **Custom SVG Chart Kit (`src/components/ui/Charts.tsx`)**: `Sparkline`, `AreaLineChart`, `BarChart`, `DonutChart`, `RadialClock24h`, `HeatmapGrid`, `SemiCircleGauge` — crisp zero-dependency interactive SVG charts (no `recharts` dependency) using `--tx-3` `13px` labels, horizontal hairlines (`--line`), smooth pointer tooltips, and explicit `EmptyState` fallbacks.
- **Hero & Surface Elevation**: Hero Lumen cards (`.dh-hero-lumen`) carry an ambient radial Lumen wash above crisp top inner-edge highlights (`--sf-highlight`), and are never applied directly onto `Scene3D` WebGL containers.

---

## 6. 3D Scenes Policy (`settings.ui3d` & `settings.ui3dQuality`)
- `settings.ui3d`: `'auto' | 'on' | 'off'` (default `'auto'`).
- `settings.ui3dQuality`: `'auto' | 'high' | 'lite'` (default `'auto'`), exposed in `Settings > Appearance` whenever `ui3d !== 'off'`.
- `'off'` disables WebGL canvas creation completely.
- `'auto'` enables interactive Three.js visuals (`FocusOrbitScene` Fresnel plasma/crystal shader core + orbiting Pomodoro satellites + curl particles, `StudySkylineScene` promoted hero in `Insights > Overview`, `SyllabusGalaxyScene` synced with subject filters in `Prep > Syllabus`) only when WebGL2 is available, hardware performance isn't throttled, and `prefers-reduced-motion` is not enabled, pausing automatically when `document.hidden === true`.
