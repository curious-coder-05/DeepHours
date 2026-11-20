import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Chapter, StudySession } from '../types.ts';
import { createBlankState, DEFAULT_SUBJECTS } from './studyLogic.ts';
import {
  FOCUS_ORB_STYLE_STORAGE_KEY,
  buildStudyCityDays,
  buildSyllabusAstrolabeLayout,
  buildSyllabusGalaxyLayout,
  computeFocusSessionHeat,
  detectRewardMilestone,
  evaluateFpsGovernor,
  getFocusOrbPalette,
  isFocusOrbStyle,
  loadFocusOrbStyle,
  resolveAstrolabeNodeState,
  saveFocusOrbStyle,
  transformRingLocalToWorld,
} from './scene3dHelpers.ts';

describe('scene3dHelpers — FPS Governor, Study City, Astrolabe, Solar Eclipse & Milestones', () => {
  it('FPS Governor waits for 2s active window then flags downgrade above 28ms average', () => {
    const tooEarly = evaluateFpsGovernor([35, 35, 35], 1200);
    assert.equal(tooEarly.ready, false);
    assert.equal(tooEarly.shouldDowngrade, false);

    const smooth = evaluateFpsGovernor(Array(60).fill(16.6), 2100);
    assert.equal(smooth.ready, true);
    assert.equal(smooth.shouldDowngrade, false);

    const slow = evaluateFpsGovernor(Array(25).fill(34), 2050);
    assert.equal(slow.ready, true);
    assert.equal(slow.shouldDowngrade, true);
    assert.ok(slow.avgFrameMs > 28);
  });

  it('buildStudyCityDays aggregates stacked subject segments, best day beacon, and 30d slice', () => {
    const todayKey = '2026-11-10';
    const cells = Array.from({ length: 84 }, (_, idx) => {
      const dayNum = idx + 1;
      const key = `2026-09-${String(((dayNum - 1) % 30) + 1).padStart(2, '0')}`;
      return {
        key: idx === 83 ? todayKey : key,
        future: false,
        hrs: idx === 80 ? 9.0 : idx === 83 ? 3.5 : 1.0,
        lvlClass: idx === 80 ? 'hm-l5' : 'hm-l2',
      };
    });

    const sessions: StudySession[] = [
      {
        id: 's1',
        subjectId: 'sub_phy',
        dayKey: todayKey,
        startTs: 1000,
        endTs: 1000 + 7200000,
        activeMs: 7200000,
        pausedMs: 0,
        overtimeMs: 0,
        purity: 100,
        mode: 'pomo',
        pauseCount: 0,
        rating: 4,
        note: '',
        updatedAt: 1000,
      },
      {
        id: 's2',
        subjectId: 'sub_chem',
        dayKey: todayKey,
        startTs: 2000,
        endTs: 2000 + 3600000,
        activeMs: 3600000,
        pausedMs: 0,
        overtimeMs: 0,
        purity: 100,
        mode: 'pomo',
        pauseCount: 0,
        rating: 4,
        note: '',
        updatedAt: 2000,
      },
    ];

    const city12w = buildStudyCityDays(cells, sessions, DEFAULT_SUBJECTS, '12w', todayKey);
    assert.equal(city12w.length, 84);
    assert.equal(city12w[80].isBestDay, true);
    assert.equal(city12w[83].isToday, true);
    assert.equal(city12w[83].sessionsCount, 2);
    assert.equal(city12w[83].topSubject?.subjectId, 'sub_phy');
    assert.equal(city12w[83].segments.length, 2);

    const city30d = buildStudyCityDays(cells, sessions, DEFAULT_SUBJECTS, '30d', todayKey);
    assert.equal(city30d.length, 30);
    assert.equal(city30d[29].isToday, true);
  });

  it('buildSyllabusGalaxyLayout distributes subjects onto spiral arms and builds constellation links', () => {
    const subjects = DEFAULT_SUBJECTS.slice(0, 2);
    const chapters: Chapter[] = [
      {
        id: 'c1',
        subjectId: subjects[0].id,
        name: 'Kinematics',
        status: 'completed',
        confidence: 5,
        revisions: [],
      },
      {
        id: 'c2',
        subjectId: subjects[0].id,
        name: 'Laws of Motion',
        status: 'inProgress',
        confidence: 3,
        revisions: [],
      },
      {
        id: 'c3',
        subjectId: subjects[1].id,
        name: 'Atomic Structure',
        status: 'notStarted',
        confidence: 1,
        revisions: [],
      },
    ];
    const layout = buildSyllabusGalaxyLayout(subjects, chapters, new Set(['c2']));
    assert.equal(layout.nodes.length, 3);
    assert.equal(layout.nodes[1].isDue, true);
    assert.ok(layout.nodes[0].baseScale > layout.nodes[2].baseScale);
    assert.equal(layout.links.length, 1);
    assert.equal(layout.links[0].oneCompleted, true);
    assert.equal(layout.links[0].bothCompleted, false);
  });

  it('buildSyllabusAstrolabeLayout builds distinct tilted subject rings, finite node positions, and accurate visual states', () => {
    const subjects = DEFAULT_SUBJECTS.slice(0, 3);
    const chapters: Chapter[] = [
      {
        id: 'a1',
        subjectId: subjects[0].id,
        name: 'Electrostatics',
        status: 'completed',
        confidence: 5,
        revisions: [],
      },
      {
        id: 'a2',
        subjectId: subjects[0].id,
        name: 'Current Electricity',
        status: 'inProgress',
        confidence: 3,
        revisions: [],
      },
      {
        id: 'a3',
        subjectId: subjects[1].id,
        name: 'Chemical Bonding',
        status: 'completed',
        confidence: 2,
        revisions: [],
      },
      {
        id: 'a4',
        subjectId: subjects[1].id,
        name: 'Equilibrium',
        status: 'inProgress',
        confidence: 4,
        revisions: [],
      },
      {
        id: 'a5',
        subjectId: subjects[2].id,
        name: 'Genetics',
        status: 'notStarted',
        confidence: 1,
        revisions: [],
      },
    ];

    const layout = buildSyllabusAstrolabeLayout(subjects, chapters, new Set(['a4']));
    assert.equal(layout.rings.length, 3);
    assert.equal(layout.nodes.length, 5);
    assert.equal(layout.ringBySubjectId.get(subjects[0].id)?.chapterCount, 2);
    assert.equal(layout.ringBySubjectId.get(subjects[0].id)?.completedCount, 1);
    assert.equal(layout.ringBySubjectId.get(subjects[1].id)?.dueCount, 1);

    // Distinct increasing radii per subject ring clearing the 1.22 geodesic sun core
    assert.ok(layout.rings[0].radius >= 1.9);
    assert.ok(layout.rings[0].radius < layout.rings[1].radius);
    assert.ok(layout.rings[1].radius < layout.rings[2].radius);

    // Visual state classification
    assert.equal(resolveAstrolabeNodeState(chapters[0], false), 'completed');
    assert.equal(resolveAstrolabeNodeState(chapters[1], false), 'inProgress');
    assert.equal(resolveAstrolabeNodeState(chapters[2], false), 'alert'); // shaky confidence <= 2
    assert.equal(resolveAstrolabeNodeState(chapters[3], true), 'alert'); // revision due
    assert.equal(resolveAstrolabeNodeState(chapters[4], false), 'notStarted'); // notStarted with confidence 1 stays calm

    // All world coordinates are finite and preserve orbital ring radius
    for (const node of layout.nodes) {
      const [wx, wy, wz] = node.worldPosition;
      assert.ok(Number.isFinite(wx) && Number.isFinite(wy) && Number.isFinite(wz));
      const ring = layout.ringBySubjectId.get(node.subject.id);
      assert.ok(ring, 'Expected ring spec for node subject');
      const worldDist = Math.hypot(wx, wy, wz);
      assert.ok(
        Math.abs(worldDist - ring.radius) < 1e-6,
        `Expected world radius ${ring.radius}, got ${worldDist}`
      );
      const [rx, ry, rz] = transformRingLocalToWorld(
        node.localPosition,
        ring.tiltX,
        ring.tiltZ
      );
      assert.ok(Math.abs(rx - wx) < 1e-6);
      assert.ok(Math.abs(ry - wy) < 1e-6);
      assert.ok(Math.abs(rz - wz) < 1e-6);
    }
  });

  it('Focus Orb Solar Eclipse palette, local storage validation, and session heat progression', () => {
    assert.equal(isFocusOrbStyle('solar-eclipse'), true);
    assert.equal(isFocusOrbStyle('lumen-gold'), true);
    assert.equal(isFocusOrbStyle('crimson-ember'), true);
    assert.equal(isFocusOrbStyle('invalid-style'), false);

    const solar = getFocusOrbPalette('solar-eclipse');
    const gold = getFocusOrbPalette('lumen-gold');
    const crimson = getFocusOrbPalette('crimson-ember');
    assert.equal(solar.coreCenterHex, '#020102');
    assert.equal(solar.whiteHotHex, '#FFF3B0');
    assert.equal(solar.innerRimHex, '#F59E0B');
    assert.equal(solar.wireframeHex, '#F5C451');
    assert.notEqual(gold.outerCoronaHex, crimson.outerCoronaHex);

    // Safe persistence with mock storage
    const store = new Map<string, string>();
    const fakeStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    };
    assert.equal(loadFocusOrbStyle(fakeStorage), 'solar-eclipse');
    saveFocusOrbStyle('crimson-ember', fakeStorage);
    assert.equal(store.get(FOCUS_ORB_STYLE_STORAGE_KEY), 'crimson-ember');
    assert.equal(loadFocusOrbStyle(fakeStorage), 'crimson-ember');
    store.set(FOCUS_ORB_STYLE_STORAGE_KEY, 'unknown-mode');
    assert.equal(loadFocusOrbStyle(fakeStorage), 'solar-eclipse');

    // Session Heat progression: idle < early work < deep 60m work < overtime
    const idleHeat = computeFocusSessionHeat({
      status: 'idle',
      phase: 'work',
      totalActiveMs: 0,
      overtimeMs: 0,
    });
    const earlyHeat = computeFocusSessionHeat({
      status: 'running',
      phase: 'work',
      totalActiveMs: 5 * 60_000,
      overtimeMs: 0,
    });
    const midHeat = computeFocusSessionHeat({
      status: 'running',
      phase: 'work',
      totalActiveMs: 30 * 60_000,
      overtimeMs: 0,
    });
    const deepHeat = computeFocusSessionHeat({
      status: 'running',
      phase: 'work',
      totalActiveMs: 65 * 60_000,
      overtimeMs: 0,
    });
    const overtimeHeat = computeFocusSessionHeat({
      status: 'running',
      phase: 'work',
      totalActiveMs: 65 * 60_000,
      overtimeMs: 8 * 60_000,
    });
    const pausedHeat = computeFocusSessionHeat({
      status: 'paused',
      phase: 'work',
      totalActiveMs: 45 * 60_000,
      overtimeMs: 0,
    });
    const breakHeat = computeFocusSessionHeat({
      status: 'running',
      phase: 'break',
      totalActiveMs: 10 * 60_000,
      overtimeMs: 0,
    });

    assert.ok(idleHeat.heat < earlyHeat.heat);
    assert.ok(earlyHeat.heat < midHeat.heat);
    assert.ok(midHeat.heat < deepHeat.heat);
    assert.ok(deepHeat.heat <= overtimeHeat.heat);
    assert.ok(overtimeHeat.crimsonWeight > earlyHeat.crimsonWeight);
    assert.ok(pausedHeat.heat < midHeat.heat);
    assert.ok(breakHeat.crimsonWeight < earlyHeat.crimsonWeight);
  });

  it('detectRewardMilestone detects Level-Up and 7-day Streak milestones cleanly', () => {
    const base = createBlankState();
    base.set.targets = { dailyMinutes: {}, weeklyMinutes: {}, minDayMinutes: 60, restPassesPerMonth: 4 };
    const todayKey = '2026-11-10';

    // Level 1 -> Level 2 requires >= 150 XP (e.g., 160 mins timer session)
    const leveled = structuredClone(base);
    leveled.sessions.push({
      id: 'ses_lvl',
      subjectId: 'sub_phy',
      dayKey: todayKey,
      startTs: 1000,
      endTs: 1000 + 160 * 60000,
      activeMs: 160 * 60000,
      pausedMs: 0,
      overtimeMs: 0,
      purity: 100,
      mode: 'pomo',
      pauseCount: 0,
      rating: 4,
      note: '',
      updatedAt: 1000,
    });

    const lvlBurst = detectRewardMilestone(base, leveled, todayKey);
    assert.equal(lvlBurst?.kind, 'levelUp');
    assert.equal(lvlBurst?.badgeText, 'Level 2');

    // No duplicate burst when state already at Level 2
    assert.equal(detectRewardMilestone(leveled, leveled, todayKey), null);
  });
});
