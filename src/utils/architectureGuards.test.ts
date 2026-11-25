import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeCleanAxisScale,
  formatChapterConfidence,
  formatRankedChapterLabel,
  stripLeadingListNumber,
} from './chartHelpers.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..');

function readRepoFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT_DIR, relPath), 'utf8');
}

describe('v36 architecture guardrails', () => {
  it('enforces v24 tick isolation: src/App.tsx never imports or calls useTimerTick', () => {
    const appSource = readRepoFile('src/App.tsx');
    assert.doesNotMatch(
      appSource,
      /\buseTimerTick\b/,
      'src/App.tsx must never import or call useTimerTick (timer ticks stay isolated to FocusView and ActiveTimerPill)'
    );
  });

  it('enforces lazy WebGL isolation: three is never statically imported in entry modules', () => {
    const entryFiles = ['src/App.tsx', 'src/main.tsx'];
    for (const relPath of entryFiles) {
      const source = readRepoFile(relPath);
      assert.doesNotMatch(
        source,
        /^\s*import\s+[^'"]*['"]three(?:\/[^'"]*)?['"]/m,
        `${relPath} must never statically import "three"`
      );
      assert.doesNotMatch(
        source,
        /\bfrom\s+['"]three(?:\/[^'"]*)?['"]/,
        `${relPath} must keep Three.js strictly lazy-loaded`
      );
    }
    const statsSource = readRepoFile('src/components/StatsView.tsx');
    assert.doesNotMatch(
      statsSource,
      /\b(three|Scene3D|StudySkylineScene)\b/,
      'src/components/StatsView.tsx must stay 100% 2D Canvas (zero Three.js / WebGL imports)'
    );
  });

  it('preserves Firestore security rules and synced document field contracts', () => {
    const rules = readRepoFile('firestore.rules');
    const cloudSync = readRepoFile('src/utils/cloudSync.ts');

    // Mock point fields strictly ['d', 's', 'm'] and max 10 mocks in group leaderboard
    assert.match(rules, /hasOnly\(\['d',\s*'s',\s*'m'\]\)/);
    assert.match(rules, /mocks\.size\(\)\s*<=\s*10/);

    // Member entry allowed keys contract remains intact
    const expectedMemberKeys = [
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
    ];
    for (const key of expectedMemberKeys) {
      assert.ok(
        rules.includes(`'${key}'`),
        `firestore.rules member schema missing expected key: ${key}`
      );
    }

    // Personal sync document collections and keys cap remain intact
    assert.match(rules, /coll\s+in\s+\['meta',\s*'months'\]/);
    assert.match(rules, /request\.resource\.data\.keys\(\)\.size\(\)\s*<=\s*20/);
    assert.match(cloudSync, /meta/);
    assert.match(cloudSync, /months/);
  });
});

describe('v36 pure chart & label helpers', () => {
  it('snaps minute-based chart axes to clean round hour intervals without awkward fractions', () => {
    // 6h daily target -> 0, 2h, 4h, 6h (never 3h 18m / 6h 36m)
    const sixHour = computeCleanAxisScale(360, 'minutes');
    assert.equal(sixHour.max, 360);
    assert.deepEqual(sixHour.ticks, [0, 120, 240, 360]);

    // 7h (420m) -> 0, 3h, 6h, 9h
    const sevenHour = computeCleanAxisScale(420, 'minutes');
    assert.equal(sevenHour.max, 540);
    assert.deepEqual(sevenHour.ticks, [0, 180, 360, 540]);

    // 3h (180m) -> 0, 1h, 2h, 3h
    const threeHour = computeCleanAxisScale(180, 'minutes');
    assert.equal(threeHour.max, 180);
    assert.deepEqual(threeHour.ticks, [0, 60, 120, 180]);

    // 0m fallback -> clean 0, 30m, 1h
    const zeroMins = computeCleanAxisScale(0, 'minutes');
    assert.deepEqual(zeroMins.ticks, [0, 30, 60]);
  });

  it('snaps hour-based and numeric chart axes cleanly', () => {
    assert.deepEqual(computeCleanAxisScale(6, 'hours').ticks, [0, 2, 4, 6]);
    assert.deepEqual(computeCleanAxisScale(7.5, 'hours').ticks, [0, 3, 6, 9]);
    assert.deepEqual(computeCleanAxisScale(680, 'number').ticks, [0, 250, 500, 750]);
  });

  it('deduplicates chapter numbering prefixes without corrupting chemical or 3D titles', () => {
    assert.equal(
      stripLeadingListNumber('1. Units and Measurements'),
      'Units and Measurements'
    );
    assert.equal(
      stripLeadingListNumber('1. 1. Units and Measurements'),
      'Units and Measurements'
    );
    assert.equal(stripLeadingListNumber('02) Rotational Motion'), 'Rotational Motion');
    assert.equal(stripLeadingListNumber('2-Methylpropane'), '2-Methylpropane');
    assert.equal(stripLeadingListNumber('3D Geometry'), '3D Geometry');

    assert.equal(
      formatRankedChapterLabel(1, '1. Units and Measurements'),
      '1. Units and Measurements'
    );
    assert.equal(
      formatRankedChapterLabel(2, 'Electrostatics'),
      '2. Electrostatics'
    );
  });

  it('hides confidence label when chapter confidence is unrated', () => {
    assert.equal(formatChapterConfidence(undefined), null);
    assert.equal(formatChapterConfidence(null), null);
    assert.equal(formatChapterConfidence(0), null);
    assert.equal(formatChapterConfidence(NaN), null);
    assert.equal(formatChapterConfidence(1), '1/5');
    assert.equal(formatChapterConfidence(4), '4/5');
    assert.equal(formatChapterConfidence(5), '5/5');
  });
});

describe('v45 StandBy Desk Mode architectural guardrails', () => {
  it('unmounts FocusOrbitScene whenever Desk Mode is active so WebGL contexts remain <= 1', () => {
    const focusSource = readRepoFile('src/components/FocusView.tsx');
    assert.match(
      focusSource,
      /const\s+show3dCore\s*=\s*!deskMode\b/,
      'FocusView.tsx must gate show3dCore on !deskMode'
    );
    assert.match(
      focusSource,
      /show3dCore\s*&&\s*\([\s\S]*?<FocusOrbitScene/,
      'FocusView.tsx must keep FocusOrbitScene unmounted while deskMode is true'
    );
  });

  it('prevents fullscreen ping-pong flicker, strips v43 scrubber/pill chrome, and isolates 1Hz timer ticks from DeskChronoScene', () => {
    const deskSource = readRepoFile('src/components/StandByDeskOverlay.tsx');
    assert.doesNotMatch(
      deskSource,
      /\brequestDeskFullscreen\b/,
      'StandByDeskOverlay.tsx must never auto-request fullscreen inside effects or taps'
    );
    assert.doesNotMatch(
      deskSource,
      /addEventListener\s*\(\s*['"]fullscreenchange['"]/,
      'StandByDeskOverlay.tsx must not listen to fullscreenchange to close or re-request fullscreen'
    );
    assert.match(
      deskSource,
      /const\s+mount3D\s*=\s*shouldMountDeskChrono3D\s*\(/,
      'StandByDeskOverlay.tsx must gate DeskChronoScene via shouldMountDeskChrono3D'
    );
    assert.match(
      deskSource,
      /mount3D\s*&&\s*\([\s\S]*?<DeskChronoScene/,
      'StandByDeskOverlay.tsx must completely unmount DeskChronoScene when mount3D is false (0 WebGL canvases)'
    );
    assert.doesNotMatch(
      deskSource,
      /dh-standby-filament|dh-standby-eclipse-/,
      'StandByDeskOverlay.tsx must not render the legacy v43 progress filament bar or muddy red eclipse backdrop'
    );
    assert.match(
      deskSource,
      /pickRandomDeskSculpture\(/,
      'StandByDeskOverlay.tsx must randomly select a sculpture on Desk Mode entry'
    );
  });

  it('enforces pure #000000 backdrop, zero-ambient high-contrast PMREM strips, persistent hot-swap, exact Monolith & Kinetic Wave geometry, DPR<=2 cap, document.hidden pause, and strict disposal on DeskChronoScene', () => {
    const chronoSource = readRepoFile('src/components/three/DeskChronoScene.tsx');
    const deskSource = readRepoFile('src/components/StandByDeskOverlay.tsx');
    assert.doesNotMatch(
      deskSource,
      /<DeskChronoScene[^>]*\bkey=/,
      'StandByDeskOverlay.tsx must never pass key={sculpture} to DeskChronoScene'
    );
    assert.match(chronoSource, /setClearColor\(\s*0x000000\s*,\s*1\s*\)/);
    assert.match(chronoSource, /PMREMGenerator/);
    assert.match(chronoSource, /buildStudioEnv/);
    assert.match(chronoSource, /ENV_STRIPS/);
    assert.match(chronoSource, /swapSculpture/);
    assert.doesNotMatch(chronoSource, /AmbientLight/);
    assert.doesNotMatch(chronoSource, /SphereGeometry/);
    assert.match(chronoSource, /IcosahedronGeometry\(\s*1\.48\s*,\s*1\s*\)/);
    assert.match(chronoSource, /createRoundedSquarePath/);
    assert.match(chronoSource, /ExtrudeGeometry/);
    assert.match(chronoSource, /Math\.min\(window\.devicePixelRatio\s*\|\|\s*1,\s*2\)/);
    assert.match(chronoSource, /document\.hidden/);
    assert.match(chronoSource, /renderer\.dispose\(\)/);
    assert.match(chronoSource, /envRenderTarget\.dispose\(\)/);
    assert.match(chronoSource, /buildMonolithSculpture/);
    assert.match(chronoSource, /buildKineticWaveSculpture/);
    assert.match(chronoSource, /resolveDeskTargetFps/);
    assert.match(chronoSource, /DESK_NIGHT_DIM_FACTOR/);
    assert.match(chronoSource, /propsRef/);
    assert.doesNotMatch(
      chronoSource,
      /\buseTimerTick\b|\bclockMs\b/,
      'DeskChronoScene.tsx must remain completely isolated from 1-second timer ticks'
    );
  });

  it('enforces v46 Night Dim persistence, portrait label contrast, 60s ±3px burn-in guard, and battery-aware frame pacing', () => {
    const deskSource = readRepoFile('src/components/StandByDeskOverlay.tsx');
    const cssSource = readRepoFile('src/index.css');
    const chronoSource = readRepoFile('src/components/three/DeskChronoScene.tsx');

    assert.match(deskSource, /dh_desk_night_dim_v1/);
    assert.match(deskSource, /data-testid="standby-dim-btn"/);
    assert.match(deskSource, /nightDim=\{nightDim\}/);
    assert.match(deskSource, /battery=\{battery\}/);

    assert.match(cssSource, /@keyframes dhStandbyBurnInOrbit/);
    assert.match(cssSource, /translate3d\(3px,\s*1px,\s*0\)/);
    assert.match(cssSource, /animation:\s*dhStandbyBurnInOrbit 60s linear infinite/);
    assert.match(cssSource, /rgba\(229,\s*224,\s*220,\s*0\.48\)/);
    assert.match(cssSource, /color:\s*#d4d4d8;/);

    assert.match(chronoSource, /battery\.level\s*>=\s*0\.2/);
    assert.match(chronoSource, /return nightDim \? 20 : 30;/);
  });

  it('unlocks PWA manifest orientation for sideways desk mode, enforces index.html security headers, and bumps Service Worker cache to v47', () => {
    const manifest = JSON.parse(readRepoFile('public/manifest.webmanifest')) as {
      orientation?: string;
    };
    assert.equal(
      manifest.orientation,
      'any',
      'public/manifest.webmanifest must set "orientation": "any" so Desk Mode rotates naturally'
    );

    const swSource = readRepoFile('public/sw.js');
    assert.match(
      swSource,
      /const CACHE_NAME = 'deep-hours-v47';/,
      'public/sw.js must bump CACHE_NAME to deep-hours-v47'
    );

    const htmlSource = readRepoFile('index.html');
    assert.match(htmlSource, /name="referrer"\s+content="strict-origin-when-cross-origin"/);
    assert.match(htmlSource, /http-equiv="Content-Security-Policy"/);
    assert.match(htmlSource, /object-src 'none'/);

    const targetsViewSource = readRepoFile('src/components/TargetsCalendarView.tsx');
    assert.doesNotMatch(
      targetsViewSource,
      /Scene3D|from 'three'|getContext\(['"]webgl/,
      'TargetsCalendarView.tsx must stay strictly zero-WebGL'
    );
  });
});

