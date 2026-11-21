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
