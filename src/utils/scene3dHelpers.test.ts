import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Chapter, StudySession } from '../types.ts';
import { createBlankState, DEFAULT_SUBJECTS } from './studyLogic.ts';
import {
  buildStudyCityDays,
  buildSyllabusGalaxyLayout,
  detectRewardMilestone,
  evaluateFpsGovernor,
} from './scene3dHelpers.ts';

describe('scene3dHelpers — FPS Governor, Study City, Syllabus Galaxy & Milestones', () => {
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
