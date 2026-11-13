import type { Chapter, PulseHabitState, StudySession, Subject } from '../types.ts';
import { computeMinDayStreak } from './insights.ts';
import { parseKey } from './studyLogic.ts';
import { computeLevelInfo, computeTotalXp } from './xp.ts';

export interface FpsGovernorEvaluation {
  ready: boolean;
  shouldDowngrade: boolean;
  avgFrameMs: number;
}

/**
 * Pure FPS governor evaluator: checks active frame deltas over a 2-second sampling window.
 * If average frame time exceeds 28ms (~35 fps), recommends downgrading to Lite tier.
 */
export function evaluateFpsGovernor(
  frameDeltasMs: readonly number[],
  activeElapsedMs: number,
  windowMs = 2000,
  thresholdMs = 28
): FpsGovernorEvaluation {
  if (activeElapsedMs < windowMs || frameDeltasMs.length < 10) {
    return { ready: false, shouldDowngrade: false, avgFrameMs: 0 };
  }
  let sum = 0;
  for (let i = 0; i < frameDeltasMs.length; i++) {
    sum += frameDeltasMs[i];
  }
  const avgFrameMs = sum / frameDeltasMs.length;
  return {
    ready: true,
    shouldDowngrade: avgFrameMs > thresholdMs,
    avgFrameMs,
  };
}

export interface CitySubjectSegment {
  subjectId: string;
  name: string;
  emoji: string;
  color: string;
  hrs: number;
}

export interface StudyCityDayData {
  key: string;
  future: boolean;
  hrs: number;
  lvlClass: string;
  sessionsCount: number;
  isWeekend: boolean;
  isToday: boolean;
  isBestDay: boolean;
  topSubject: CitySubjectSegment | null;
  segments: CitySubjectSegment[];
  col: number;
  row: number;
}

export function buildStudyCityDays(
  cells: ReadonlyArray<{ key: string; future: boolean; hrs: number; lvlClass: string }>,
  sessions: ReadonlyArray<StudySession>,
  subjects: ReadonlyArray<Subject>,
  range: '12w' | '30d',
  todayKey: string
): StudyCityDayData[] {
  const subjectMap = new Map<string, Subject>();
  for (const s of subjects) {
    subjectMap.set(s.id, s);
  }

  // Group sessions by dayKey -> subjectId -> ms
  const byDay = new Map<
    string,
    { count: number; subMs: Map<string, number> }
  >();
  for (const ses of sessions) {
    if (!ses || !ses.dayKey) continue;
    let bucket = byDay.get(ses.dayKey);
    if (!bucket) {
      bucket = { count: 0, subMs: new Map() };
      byDay.set(ses.dayKey, bucket);
    }
    bucket.count += 1;
    const prevMs = bucket.subMs.get(ses.subjectId) || 0;
    bucket.subMs.set(ses.subjectId, prevMs + Math.max(0, ses.activeMs || 0));
  }

  const nonFuture = cells.filter((c) => !c.future);
  const sliced =
    range === '30d'
      ? nonFuture.slice(-30)
      : cells.slice(0, 84);

  let bestIdx = -1;
  let bestHrs = 0;
  for (let i = 0; i < sliced.length; i++) {
    const c = sliced[i];
    if (!c.future && c.hrs > bestHrs) {
      bestHrs = c.hrs;
      bestIdx = i;
    }
  }

  return sliced.map((c, idx) => {
    const dayBucket = byDay.get(c.key);
    const segments: CitySubjectSegment[] = [];
    if (dayBucket && !c.future) {
      for (const [subId, ms] of dayBucket.subMs.entries()) {
        if (ms <= 0) continue;
        const sub = subjectMap.get(subId);
        segments.push({
          subjectId: subId,
          name: sub?.name || 'Study',
          emoji: sub?.e || '📘',
          color: sub?.color || '#F5C451',
          hrs: ms / 3600000,
        });
      }
      segments.sort((a, b) => b.hrs - a.hrs);
    } else if (!c.future && c.hrs > 0) {
      segments.push({
        subjectId: 'general',
        name: 'Deep Study',
        emoji: '⏱️',
        color: '#4ADE80',
        hrs: c.hrs,
      });
    }

    const dow = parseKey(c.key).getDay();
    const isWeekend = dow === 0 || dow === 6;
    const col = range === '30d' ? idx % 6 : Math.floor(idx / 7);
    const row = range === '30d' ? Math.floor(idx / 6) : idx % 7;

    return {
      key: c.key,
      future: c.future,
      hrs: c.hrs,
      lvlClass: c.lvlClass,
      sessionsCount: dayBucket?.count || (c.hrs > 0 ? 1 : 0),
      isWeekend,
      isToday: c.key === todayKey,
      isBestDay: idx === bestIdx && bestHrs > 0,
      topSubject: segments[0] || null,
      segments,
      col,
      row,
    };
  });
}

export interface GalaxyStarNode {
  chapter: Chapter;
  subject: Subject;
  subjectIdx: number;
  indexInArm: number;
  position: [number, number, number];
  armCenter: [number, number, number];
  baseScale: number;
  isDue: boolean;
}

export interface GalaxyConstellationLink {
  subjectId: string;
  color: string;
  from: [number, number, number];
  to: [number, number, number];
  bothCompleted: boolean;
  oneCompleted: boolean;
}

export interface SyllabusGalaxyLayout {
  nodes: GalaxyStarNode[];
  links: GalaxyConstellationLink[];
  armCenters: Map<string, [number, number, number]>;
}

/**
 * Pure spiral-arm galaxy layout: places each active subject along its own spiral arm,
 * with chapters progressing outward in completion/constellation order.
 */
export function buildSyllabusGalaxyLayout(
  activeSubjects: ReadonlyArray<Subject>,
  chapters: ReadonlyArray<Chapter>,
  dueChapterIds: ReadonlySet<string>,
  maxNodes = 600
): SyllabusGalaxyLayout {
  const nodes: GalaxyStarNode[] = [];
  const links: GalaxyConstellationLink[] = [];
  const armCenters = new Map<string, [number, number, number]>();
  const subCount = Math.max(1, activeSubjects.length);

  activeSubjects.forEach((sub, sIdx) => {
    const armAngle = (sIdx / subCount) * Math.PI * 2;
    const armCountRadius = subCount === 1 ? 0 : 1.75;
    const armCenter: [number, number, number] = [
      Math.cos(armAngle) * armCountRadius,
      Math.sin(armAngle * 2) * 0.14,
      Math.sin(armAngle) * armCountRadius * 0.85,
    ];
    armCenters.set(sub.id, armCenter);

    const subChapters = chapters.filter((ch) => ch.subjectId === sub.id);
    const armNodes: GalaxyStarNode[] = [];

    subChapters.forEach((ch, cIdx) => {
      if (nodes.length >= maxNodes) return;
      // Logarithmic-like spiral arm radiating out from galaxy core
      const spiralT = 0.55 + cIdx * 0.36;
      const theta = armAngle + spiralT * 0.72;
      const r = (subCount === 1 ? 0.55 : 0.95) + Math.sqrt(cIdx + 0.5) * 0.62;
      const yWave = Math.sin(theta * 2 + cIdx * 0.6) * 0.16 + (((cIdx * 17) % 7) - 3) * 0.04;

      const x = Math.cos(theta) * r;
      const y = yWave;
      const z = Math.sin(theta) * r * 0.86;

      const conf = Math.max(1, Math.min(5, Number(ch.confidence) || 3));
      const baseScale = 0.65 + conf * 0.16;

      const node: GalaxyStarNode = {
        chapter: ch,
        subject: sub,
        subjectIdx: sIdx,
        indexInArm: cIdx,
        position: [x, y, z],
        armCenter,
        baseScale,
        isDue: dueChapterIds.has(ch.id),
      };
      nodes.push(node);
      armNodes.push(node);
    });

    for (let i = 1; i < armNodes.length; i++) {
      const prevNode = armNodes[i - 1];
      const nextNode = armNodes[i];
      const prevDone = prevNode.chapter.status === 'completed';
      const nextDone = nextNode.chapter.status === 'completed';
      links.push({
        subjectId: sub.id,
        color: sub.color || '#F5C451',
        from: prevNode.position,
        to: nextNode.position,
        bothCompleted: prevDone && nextDone,
        oneCompleted: prevDone || nextDone,
      });
    }
  });

  return { nodes, links, armCenters };
}

export type RewardMilestoneKind = 'levelUp' | 'streak7' | 'streak30' | 'perfectDay';

export interface RewardMilestonePayload {
  kind: RewardMilestoneKind;
  title: string;
  subtitle: string;
  badgeText: string;
  accentColor: string;
}

export function detectRewardMilestone(
  prev: PulseHabitState,
  next: PulseHabitState,
  todayKey: string
): RewardMilestonePayload | null {
  const prevStreak = computeMinDayStreak(prev, todayKey).streak;
  const nextStreak = computeMinDayStreak(next, todayKey).streak;

  if (nextStreak >= 30 && prevStreak < 30) {
    return {
      kind: 'streak30',
      title: '30-Day Streak Milestone!',
      subtitle: 'One full month of hitting your daily minimum study target.',
      badgeText: '30-Day Legend',
      accentColor: '#F5C451',
    };
  }
  if (nextStreak >= 7 && prevStreak < 7) {
    return {
      kind: 'streak7',
      title: '7-Day Streak Milestone!',
      subtitle: 'Seven straight days meeting your minimum daily study goal.',
      badgeText: '7-Day Streak',
      accentColor: '#4ADE80',
    };
  }

  const prevLevel = computeLevelInfo(computeTotalXp(prev, todayKey)).level;
  const nextLevel = computeLevelInfo(computeTotalXp(next, todayKey)).level;
  if (nextLevel > prevLevel) {
    return {
      kind: 'levelUp',
      title: `Level ${nextLevel} Reached!`,
      subtitle: `Consistent focus pushed your rank from Level ${prevLevel} to Level ${nextLevel}.`,
      badgeText: `Level ${nextLevel}`,
      accentColor: '#60A5FA',
    };
  }

  return null;
}
