# Deep Hours — Design System Specification (v45 Rose Copper AMOLED & Hardware StandBy Desk Mode)

## 1. Art Direction
- **Flagship OLED Hardware Restraint**: Deep Hours is a precision daily study instrument for NEET preparation. Dark and AMOLED modes anchor directly onto pure `#000000` black so timers, chapters, mock analytics, and canvas instruments stay crisp and battery-friendly over multi-hour sessions.
- **Strict 3-Tier Surface Hierarchy**:
  - **Tier 0 (Canvas)**: Pure `#000000` borderless sections separated by `28px` vertical rhythm and `1px solid rgba(255, 255, 255, 0.07)` hairlines.
  - **Tier 1 (Single Hero Card per Viewport)**: At most one elevated obsidian card (`.dh-hero-tier1`, `#0C0909` → `#050404`) per primary screen, lit by a calibrated **Rose Copper** top skylight (`rgba(251, 146, 60, 0.175)` → `rgba(244, 114, 182, 0.095)`) and a crisp top specular rim (`rgba(253, 186, 116, 0.26)` border / `rgba(254, 215, 170, 0.19)` inner edge). Never box secondary sections into competing hero cards.
  - **Tier 2 (Grouped Lists & Ghost Controls)**: Neutral dark obsidian inset groups (`#0B0909` surface, `#0F0D0D` active dock controls, `16px` radius, `16px`-indented hairlines) and tactile hairline ghost buttons (`scale(0.975)` active press).
- **Single Primary CTA Discipline**: One solid **Lumen Gold** (`#F5C542`, `#09090B` ink) primary action per viewport. No gradient buttons, no gradient headline text, no neon outer glows, and no nested cards inside cards.
- **Icons & Subject Dots**: Lucide SVG icons (`1.75` stroke width) for all UI chrome. Subjects render with standardized `6px` semantic color dots across Today, Focus, Prep, Vault, Insights, and PYQs (zero subject emojis in chips or Floating Video PiP headers). Emoji are restricted to user-chosen identity avatars, habit icons, and cheer reactions.

---

## 2. Color Tokens

### Pure AMOLED Dark Default (`[data-t="dark"]` — Rose Copper AMOLED)
| Token | Value | Usage |
| --- | --- | --- |
| `--bg` | `#000000` | Pure AMOLED base canvas (`theme-color: #000000`) |
| `--sf-1` | `#0B0909` | Inset grouped lists, sheets, and navigation rail surface |
| `--sf-2` | `#0F0D0D` | Secondary controls, inputs, and hero dock pills |
| `--sf-3` | `#181515` | Hover / pressed / elevated controls |
| `--line` | `rgba(255, 255, 255, 0.08)` | Hairline borders & section dividers |
| `--tx` | `#FFFFFF` / `#F4F4F5` | Primary text & zero-glow tabular readouts |
| `--tx-2` | `#A1A1AA` | Secondary text |
| `--tx-3` | `#8E97A6` | Tertiary metadata text (AA readable) |
| Rose Copper Skylight | `rgba(251, 146, 60, 0.175)` → `rgba(244, 114, 182, 0.095)` | Top skylight restricted strictly to Tier-1 hero cards & Floating Video PiP |

### Light Warm Paper (`[data-t="light"]` — Unaffected)
- `--bg: #F6F4EF` (`theme-color: #F6F4EF`)
- `--sf-1: #FFFFFF`
- `--sf-2: #EFECE5`
- `--sf-3: #E6E1D7`
- `--line: rgba(20, 22, 26, 0.10)`
- `--tx: #14161A`, `--tx-2: #4B515C`, `--tx-3: #565E6B`

### Accent & Semantic Tokens
- Default signature accent **"Lumen Gold"**: `#F5C542` with `#09090B` primary button ink.
- User-selectable accents (`Lumen`, `Sky`, `Mint`, `Indigo`, `Violet`, `Rose`, `Amber`) dynamically compute WCAG AA `--ac-on`, `--ac-ink`, `--ac-soft`, and `--ac-bd`.
- **ProgressRing**: Machined obsidian channels (`#12151C`), molten amber-to-gold outer study arc (`#EA580C` → `#F59E0B` → `#FCD34D`), and vivid emerald inner habits arc (`#059669` → `#10B981` → `#34D399`).
- **Semantic**: `--ok` `#4ADE80` / `#15803D`, `--warn` `#FB923C` / `#C2410C`, `--err` `#F87171` / `#B91C1C`, `--info` `#60A5FA` / `#1D4ED8`.

---

## 3. Typography
- **UI Typeface**: `Geist Variable` (self-hosted `@fontsource-variable/geist`) with `font-variant-numeric: tabular-nums` on every numeric counter, KPI ledger, and table.
- **Monospace & StandBy Precision Typefaces**: `Geist Mono Variable` (self-hosted `@fontsource-variable/geist-mono`) is used on study timers (`FocusView`, `MiniTimerBar`, PiP), the `10m Timeline` clock grid, and revealed Answer chips inside Question Vault & Revision Deck cards. `StandByDeskOverlay` uses container-relative ultra-light Precision tabular numerals (`'Inter', 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif`, `font-weight: 200`, `tabular-nums`, `clamp(3.6rem, min(16.8cqw, 40cqh), 12.5rem)`, three two-digit groups `00 42 55` with `0.25em` gap, `#F5F7FA`, soft dark drop-shadow) beneath a centered tracked uppercase subject micro-label (`letter-spacing: 0.38em`, `rgba(235, 240, 248, 0.50)`).
- **Type Scale**:
  - Display: `40px`–`46px` (`font-weight: 700`, `letter-spacing: -0.025em`)
  - Title: `clamp()` fluid header sizing (`24px`–`32px`, `font-weight: 700`)
  - Heading: `18px`–`20px` (`font-weight: 600`)
  - Body: `15px`–`16px` (`font-weight: 500`)
  - Secondary / Caption: `13px`–`14px` (with restrained `11px` uppercase `SectionHeader` eyebrows tracking section cadence)

---

## 4. Layout Grid, Navigation & Motion
- **Grid**: `4pt` base unit; `16px`–`20px` phone gutters, `32px` tablet/desktop gutters, `1120px` max content width.
- **Navigation Shell**:
  - `<768px`: Translucent AMOLED bottom 5-tab dock (`rgba(5, 5, 7, 0.86)`, `blur(22px)`) with `Today`, `Focus`, `Prep`, `Insights`, `Community` and a centered `4px` Lumen Gold active dot (no FAB).
  - `>=768px`: Fixed left navigation rail (`232px`) + scrollable content stage; `>=1100px` `Today` uses a 2-column workspace.
  - **Settings & Account**: Portaled frosted left slide-over `SettingsDrawer` opened via top-bar menu icon (`☰`), drilling cleanly into full-screen `SettingsView` sections.
- **Motion & Tactile Feedback**:
  - Press physics `active:scale-[0.975]`, cubic ease-out (`1 - (1 - t)^3`) staggered canvas entrance on `StudyMonolithCanvas` (zero overshoot, skipped cleanly under `prefers-reduced-motion: reduce`), and ref-counted haptics (`src/utils/haptics.ts`).

---

## 5. UI Primitives, Charts & 2D Canvas Instruments
- **Primitives (`src/components/ui/`)**: `Button`, `IconButton`, `Card`, `ListRow`, `Segmented` (minimal `2px` gold underline rail), `Chip`, `Switch`, `Field`, `Select` (searchable `Sheet` picker), `Sheet`, `BottomSheet` (frosted AMOLED bottom sheet), `Dialog`, `ProgressRing`, `ConcentricProgressRing`, `Meter`, `Stat`, `CountUp`, `EmptyState`, `Skeleton`, `Toast`, `TopBar`, `BrandLogo`, `SectionHeader`, `WindowedList`, `OnboardingSheet`.
- **Zero-Dependency SVG Chart Kit (`src/components/ui/Charts.tsx`)**: Active exports are `AreaLineChart`, `BarChart`, `DonutChart`, and `SemiCircleGauge` (no `recharts` dependency; dead legacy exports removed in v41).
- **High-DPI 2D Canvas Instruments (Zero WebGL on Insights)**:
  - `StudyMonolithCanvas.tsx` (Top Rose Copper Tier-1 hero in `Insights > Overview`): 3D isometric monolith bars (`7d`/`14d`), Subject `Stack` 3-face shading, translucent Goal Horizon plane, molten Lumen Gold goal ignition + soft top halo, `4px` obsidian plinths on `0m` days, staggered cubic ease-out entrance (`380ms`, `28ms`/`16ms` stagger, zero overshoot), pointer scrubbing, `Open day ›`, and `Share proof`.
  - `StudyChronographCanvas.tsx` (Directly below on pure `#000000`, `28px` vertical rhythm + `1px` hairline): Dual-mode watch-face dial (`30d Rhythm` 30-spoke dial with dashed goal ring & perimeter streak arc; `24h Clock` with Rose Copper peak-2h midnight-wrap wedge), live radial scrubbing into `#050404` center hub, and companion 2×2 hairline Telemetry Ledger.
  - **Floating Video & Document PiP (`useFloatingTimerPiP.ts`, `pipHelpers.ts`)**: `1280×720` 2x Rose Copper obsidian canvas (`rgba(251, 146, 60, 0.15)` → `rgba(244, 114, 182, 0.08)` skylight, `#FFFFFF` zero-glow tabular digits, emoji-free subject dot header, solar crimson Exam Hall overtime, and `0.001`-gain `60 Hz` audio keepalive).

---

## 6. Three.js Scenes Policy (`settings.ui3d` & `settings.ui3dQuality`)
- `three` is strictly lazy-loaded and isolated from the entry bundle. Active WebGL contexts stay `<= 1` (`priority="overlay"` suspends background stage; `StandByDeskOverlay` unmounts `FocusOrbitScene` completely and guarantees `0` WebGL canvases whenever Desk Mode is closed, `settings.ui3d === 'off'`, or `prefers-reduced-motion: reduce`; `Insights` uses `0` WebGL canvases).
- Respects `settings.ui3d` (`Auto | On | Off`), `settings.ui3dQuality` (`Auto | High | Lite`), `prefers-reduced-motion`, and the 2-second FPS Governor (`evaluateFpsGovernor`). Every Three.js scene is wrapped in a silent `ErrorBoundary` so driver failures degrade gracefully.
- **Active 3D Scenes**:
  - `FocusOrbitScene` (**Solar Eclipse Focus Core** in `FocusView` & `OnboardingSheet`): Continuous-Fresnel volcanic obsidian-ember sphere (`SphereGeometry(1.48)`), BackSide corona fading strictly to `0.0` at silhouette, subtle geodesic cage & 72-tick champagne ring, circular ember dust, live Session Heat progression, and local `Solar Eclipse | Lumen Gold | Crimson Ember` palettes.
  - `DeskChronoScene` (**Procedural Hardware Sculptures** in `StandByDeskOverlay`): Pure pitch-black `#000000` (`setClearColor(0x000000, 1)`) AMOLED stage initialized once per Desk Mode session (`WebGLRenderer`, `PerspectiveCamera`, `ResizeObserver` on the inner `container-type: size` stage, and RAF loop stay mounted across sculpture switches via synchronous `swapSculpture` for zero blank flash). Uses compact framing (`FOV 36`, `baseZ = 7.6` Monolith / `7.5` Kinetic Wave in landscape, `(baseZ * 1.2) / max(aspect, 0.46)` in portrait so outer `00`/`55` digit pairs clear the sculpture onto pure black in every orientation), zero `AmbientLight` with pure `0x000000` aimed studio strip PMREM (`ENV_STRIPS`, `sigma = 0.02`, zero external HDRIs), `dpr <= 2` cap, `document.hidden` pause, zero 1Hz timer-tick re-renders, and full GPU disposal on swap/unmount. Randomly instantiates ONE sculpture per entry (`Math.random() < 0.5`):
    - **Sculpture A (`monolith` — Mirror-Faceted Rose Copper Obsidian Crystal)**: Glossy 80-face (`detail = 1`) flat-shaded `IcosahedronGeometry(1.48, 1)` smoked obsidian crystal (`0x0e0a09`, `metalness: 0.88`, `roughness: 0.12`, `clearcoat: 1.0`, `opacity: 0.90`, `envMapIntensity: 3.1`) + fine Rose Copper facet wireframe (`0xd99b82`, `opacity: 0.52`, `scale: 1.003`) + soft feathered 128×128 `CanvasTexture` radial ember glow sprite (`AdditiveBlending`, zero hard circular disc) + tiny deep faceted nucleus (`IcosahedronGeometry(0.30, 0)`) and warm `PointLight`.
    - **Sculpture B (`kinetic-wave` — Razor-Thin High-Contrast Obsidian Steel 22-Rib Coil)**: 22 razor-thin (`0.045` wall, `0.72` outer / `0.675` inner hole, beveled `ExtrudeGeometry`) gleaming dark obsidian-steel loops (`MeshPhysicalMaterial`, `0x3a4350`, `metalness: 0.92`, `roughness: 0.22`, `clearcoat: 0.85`, `envMapIntensity: 2.9`) sweeping horizontally-diagonally (`rotation.set(0.24, 0.78, -0.22)`, `SPACING = 0.138`, cosine taper `0.82..1.0`) with smooth torsional wave propagation.
  - `SyllabusAstrolabeScene` (**3D Gyroscopic Astrolabe** in `Prep > Syllabus`): Full-bleed `#000000` borderless stage with molten-gold Fresnel geodesic sun core, champagne-gold tilted orbital rings, 4-state PBR faceted octahedron chapter crystals (`RoomEnvironment` reflections), dual-torus target reticle, and floating top/bottom scrim overlays.
  - `RewardBurstDialog`: Lazy milestone overlay (`ExtrudeGeometry` 3D medal + `InstancedMesh` confetti) with 2D reduced-motion fallback.
- **Zero-WebGL Planning Surface (`Prep > Targets` & `Today > Targets & upcoming`)**: Pure `#000000` AMOLED hairline cards for Deadline Target Sprints (sole `+ New target` Lumen Gold `#F5C542` CTA, freeform checklist rows with `>= 44px` touch targets), Unified Monthly Calendar with `4px` semantic event dots (`#F5C542` Target, `#FB923C` Reminder, `#F43F5E` Exam D-Day, `#38BDF8` Spaced Revision), and `CalendarPushSheet` (RFC-5545 `.ics` with `VALARM` triggers + Google Calendar template links).

