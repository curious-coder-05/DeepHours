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

// ---------------------------------------------------------------------------
// v30: 3D Gyroscopic Astrolabe Pure Layout & Status Mapping
// ---------------------------------------------------------------------------

export type AstrolabeNodeVisualState =
  | 'completed'
  | 'inProgress'
  | 'alert'
  | 'notStarted';

export interface AstrolabeRingSpec {
  subject: Subject;
  subjectIdx: number;
  radius: number;
  tiltX: number;
  tiltZ: number;
  phaseOffset: number;
  color: string;
  chapterCount: number;
  completedCount: number;
  dueCount: number;
}

export interface AstrolabeNode {
  chapter: Chapter;
  subject: Subject;
  subjectIdx: number;
  ringIdx: number;
  indexInRing: number;
  angle: number;
  localPosition: [number, number, number];
  worldPosition: [number, number, number];
  baseScale: number;
  visualState: AstrolabeNodeVisualState;
  isDue: boolean;
}

export interface SyllabusAstrolabeLayout {
  rings: AstrolabeRingSpec[];
  nodes: AstrolabeNode[];
  ringBySubjectId: Map<string, AstrolabeRingSpec>;
  maxRadius: number;
}

/**
 * Maps a syllabus chapter + revision-due flag into its canonical Astrolabe visual state:
 * - 'alert': revision due / overdue, OR actively studied with shaky confidence (<= 2)
 * - 'completed': luminous Lumen gold
 * - 'inProgress': warm amber glow
 * - 'notStarted': sleek smoked obsidian glass with subtle subject-tinted rim
 */
export function resolveAstrolabeNodeState(
  chapter: Pick<Chapter, 'status' | 'confidence'>,
  isDue: boolean
): AstrolabeNodeVisualState {
  if (isDue) return 'alert';
  const conf = Number(chapter.confidence);
  const hasShakyConfidence =
    chapter.status !== 'notStarted' && Number.isFinite(conf) && conf > 0 && conf <= 2;
  if (hasShakyConfidence) return 'alert';
  if (chapter.status === 'completed') return 'completed';
  if (chapter.status === 'inProgress') return 'inProgress';
  return 'notStarted';
}

/**
 * Pure Euler XYZ(tiltX, 0, tiltZ) transform for placing a point on a tilted orbital ring
 * in exact agreement with Three.js Group.rotation.set(tiltX, 0, tiltZ) (default 'XYZ' order).
 */
export function transformRingLocalToWorld(
  local: [number, number, number],
  tiltX: number,
  tiltZ: number
): [number, number, number] {
  const [lx, ly, lz] = local;
  // In Three.js Euler order 'XYZ', M = Rx(tiltX) * Ry(0) * Rz(tiltZ)
  // Step 1: Rotate around Z by tiltZ
  const cz = Math.cos(tiltZ);
  const sz = Math.sin(tiltZ);
  const x1 = lx * cz - ly * sz;
  const y1 = lx * sz + ly * cz;
  const z1 = lz;

  // Step 2: Rotate around X by tiltX
  const cx = Math.cos(tiltX);
  const sx = Math.sin(tiltX);
  const x2 = x1;
  const y2 = y1 * cx - z1 * sx;
  const z2 = y1 * sx + z1 * cx;

  return [x2, y2, z2];
}

// Horological tilt presets (radians) so concentric subject rings interleave gracefully
const ASTROLABE_TILT_PRESETS: ReadonlyArray<[number, number]> = [
  [0.28, 0.14],
  [-0.36, 0.34],
  [0.48, -0.26],
  [-0.22, -0.44],
  [0.62, 0.24],
  [-0.54, 0.16],
];

/**
 * Builds deterministic concentric tilted orbital rings (one per active subject)
 * and mounts each chapter node cleanly along its subject's orbital track.
 */
export function buildSyllabusAstrolabeLayout(
  activeSubjects: ReadonlyArray<Subject>,
  chapters: ReadonlyArray<Chapter>,
  dueChapterIds: ReadonlySet<string>,
  maxNodes = 600
): SyllabusAstrolabeLayout {
  const rings: AstrolabeRingSpec[] = [];
  const nodes: AstrolabeNode[] = [];
  const ringBySubjectId = new Map<string, AstrolabeRingSpec>();

  const subCount = activeSubjects.length;
  // Clear central molten-gold geodesic sun core (radius 1.12, wireframe cage 1.22) + 0.20 faceted crystals
  const baseRadius = subCount <= 3 ? 2.18 : 1.98;
  const radiusStep = subCount <= 4 ? 0.56 : Math.max(0.44, 2.35 / Math.max(1, subCount - 1));

  activeSubjects.forEach((sub, sIdx) => {
    const subChapters = chapters.filter((ch) => ch.subjectId === sub.id);
    const preset = ASTROLABE_TILT_PRESETS[sIdx % ASTROLABE_TILT_PRESETS.length];
    const extraRingCycle = Math.floor(sIdx / ASTROLABE_TILT_PRESETS.length);
    const tiltX = preset[0] + extraRingCycle * 0.11;
    const tiltZ = preset[1] - extraRingCycle * 0.09;
    const radius = baseRadius + sIdx * radiusStep;
    const phaseOffset = sIdx * 0.85;

    let completedCount = 0;
    let dueCount = 0;

    subChapters.forEach((ch) => {
      if (ch.status === 'completed') completedCount += 1;
      if (dueChapterIds.has(ch.id)) dueCount += 1;
    });

    const ringSpec: AstrolabeRingSpec = {
      subject: sub,
      subjectIdx: sIdx,
      radius,
      tiltX,
      tiltZ,
      phaseOffset,
      color: sub.color || '#F5C451',
      chapterCount: subChapters.length,
      completedCount,
      dueCount,
    };
    rings.push(ringSpec);
    ringBySubjectId.set(sub.id, ringSpec);

    const countInRing = Math.max(1, subChapters.length);
    subChapters.forEach((ch, cIdx) => {
      if (nodes.length >= maxNodes) return;
      const angle = phaseOffset + (cIdx / countInRing) * Math.PI * 2;
      const localPosition: [number, number, number] = [
        Math.cos(angle) * radius,
        0,
        Math.sin(angle) * radius,
      ];
      const worldPosition = transformRingLocalToWorld(localPosition, tiltX, tiltZ);
      const isDue = dueChapterIds.has(ch.id);
      const visualState = resolveAstrolabeNodeState(ch, isDue);
      const conf = Math.max(1, Math.min(5, Number(ch.confidence) || 3));
      const baseScale =
        visualState === 'completed'
          ? 0.96 + conf * 0.06
          : visualState === 'alert'
            ? 1.02
            : visualState === 'inProgress'
              ? 0.88 + conf * 0.04
              : 0.78;

      nodes.push({
        chapter: ch,
        subject: sub,
        subjectIdx: sIdx,
        ringIdx: sIdx,
        indexInRing: cIdx,
        angle,
        localPosition,
        worldPosition,
        baseScale,
        visualState,
        isDue,
      });
    });
  });

  const maxRadius =
    rings.length > 0 ? rings[rings.length - 1].radius : baseRadius + 0.8;

  return { rings, nodes, ringBySubjectId, maxRadius };
}

// ---------------------------------------------------------------------------
// v30: Focus Orb Solar Eclipse Palette & Session Heat Helpers
// ---------------------------------------------------------------------------

export type FocusOrbStyle = 'solar-eclipse' | 'lumen-gold' | 'crimson-ember';

export const FOCUS_ORB_STYLE_STORAGE_KEY = 'dh_focus_orb_style_v1';
export const FOCUS_ORB_STYLE_EVENT = 'dh-focus-orb-style-change';

export interface FocusOrbPalette {
  id: FocusOrbStyle;
  label: string;
  coreCenterHex: string;
  whiteHotHex: string;
  innerRimHex: string;
  outerCoronaHex: string;
  wireframeHex: string;
  ringPrimaryHex: string;
  ringSecondaryHex: string;
  emberPrimaryHex: string;
  emberSecondaryHex: string;
}

const FOCUS_ORB_PALETTES: Record<FocusOrbStyle, FocusOrbPalette> = {
  'solar-eclipse': {
    id: 'solar-eclipse',
    label: 'Solar Eclipse',
    coreCenterHex: '#020102',
    whiteHotHex: '#FFF3B0',
    innerRimHex: '#F59E0B',
    outerCoronaHex: '#E11D48',
    wireframeHex: '#F5C451',
    ringPrimaryHex: '#FBBF24',
    ringSecondaryHex: '#E11D48',
    emberPrimaryHex: '#FDE68A',
    emberSecondaryHex: '#F43F5E',
  },
  'lumen-gold': {
    id: 'lumen-gold',
    label: 'Lumen Gold',
    coreCenterHex: '#030201',
    whiteHotHex: '#FFF3B0',
    innerRimHex: '#F59E0B',
    outerCoronaHex: '#B45309',
    wireframeHex: '#FCD34D',
    ringPrimaryHex: '#FDE68A',
    ringSecondaryHex: '#D97706',
    emberPrimaryHex: '#FFF3B0',
    emberSecondaryHex: '#F59E0B',
  },
  'crimson-ember': {
    id: 'crimson-ember',
    label: 'Crimson Ember',
    coreCenterHex: '#040102',
    whiteHotHex: '#FDA4AF',
    innerRimHex: '#EF4444',
    outerCoronaHex: '#991B1B',
    wireframeHex: '#FB7185',
    ringPrimaryHex: '#FB7185',
    ringSecondaryHex: '#DC2626',
    emberPrimaryHex: '#FDA4AF',
    emberSecondaryHex: '#EF4444',
  },
};

export function isFocusOrbStyle(value: unknown): value is FocusOrbStyle {
  return (
    value === 'solar-eclipse' ||
    value === 'lumen-gold' ||
    value === 'crimson-ember'
  );
}

export function getFocusOrbPalette(style?: FocusOrbStyle | null): FocusOrbPalette {
  if (style && isFocusOrbStyle(style)) {
    return FOCUS_ORB_PALETTES[style];
  }
  return FOCUS_ORB_PALETTES['solar-eclipse'];
}

export function loadFocusOrbStyle(
  storage?: Pick<Storage, 'getItem'>
): FocusOrbStyle {
  try {
    const store =
      storage || (typeof window !== 'undefined' ? window.localStorage : null);
    if (!store) return 'solar-eclipse';
    const raw = store.getItem(FOCUS_ORB_STYLE_STORAGE_KEY);
    return isFocusOrbStyle(raw) ? raw : 'solar-eclipse';
  } catch {
    return 'solar-eclipse';
  }
}

export function saveFocusOrbStyle(
  style: FocusOrbStyle,
  storage?: Pick<Storage, 'setItem'>
): void {
  const safeStyle: FocusOrbStyle = isFocusOrbStyle(style)
    ? style
    : 'solar-eclipse';
  try {
    const store =
      storage || (typeof window !== 'undefined' ? window.localStorage : null);
    store?.setItem(FOCUS_ORB_STYLE_STORAGE_KEY, safeStyle);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent<FocusOrbStyle>(FOCUS_ORB_STYLE_EVENT, {
          detail: safeStyle,
        })
      );
    }
  } catch {
    // Ignore storage quota errors
  }
}

export interface FocusSessionHeatMetrics {
  /** Normalized 0..1 session heat progression (0 = idle/start, ~0.92 at 60m, 1.0 in overtime) */
  heat: number;
  /** Subtle outer corona scale multiplier (1.0 .. 1.24) */
  coronaScale: number;
  /** Ember orbital drift speed multiplier */
  emberSpeed: number;
  /** Weight of the blazing outer crimson corona vs Lumen gold inner corona (0..1) */
  crimsonWeight: number;
}

/**
 * Computes calm, monotonic Session Heat progression for the Solar Eclipse Focus Orb.
 * Idle or early sessions emphasize the molten Lumen gold inner corona; as a live Focus
 * or Full Mock session deepens from 0m toward 60m+, the crimson outer corona and ember
 * drift gently intensify without distracting from the high-contrast center digits.
 */
export function computeFocusSessionHeat(params: {
  status: 'idle' | 'running' | 'paused';
  phase: 'work' | 'break';
  totalActiveMs: number;
  overtimeMs: number;
}): FocusSessionHeatMetrics {
  const { status, phase, totalActiveMs, overtimeMs } = params;
  const safeMs = Math.max(0, Number.isFinite(totalActiveMs) ? totalActiveMs : 0);
  const safeOvertime = Math.max(0, Number.isFinite(overtimeMs) ? overtimeMs : 0);

  if (phase === 'break') {
    return {
      heat: 0.08,
      coronaScale: 1.0,
      emberSpeed: 0.38,
      crimsonWeight: 0.14,
    };
  }

  if (status === 'idle') {
    return {
      heat: 0.12,
      coronaScale: 1.02,
      emberSpeed: 0.45,
      crimsonWeight: 0.22,
    };
  }

  // Smooth ease-out curve from 0m -> 60m (3,600,000 ms)
  const minsRatio = Math.min(1, safeMs / 3_600_000);
  const curved = 1 - Math.pow(1 - minsRatio, 1.45);
  let heat = 0.18 + curved * 0.74; // 0.18 at 0m -> 0.92 at 60m
  if (safeOvertime > 0) {
    heat = Math.min(1, heat + 0.08 + Math.min(0.08, safeOvertime / 1_800_000));
  }
  if (status === 'paused') {
    heat *= 0.65;
  }

  const clampedHeat = Math.max(0, Math.min(1, heat));
  return {
    heat: clampedHeat,
    coronaScale: 1.0 + clampedHeat * 0.22,
    emberSpeed: status === 'paused' ? 0.18 : 0.52 + clampedHeat * 0.78,
    crimsonWeight: 0.24 + clampedHeat * 0.68,
  };
}

