import type {
  Chapter,
  ChapterConfidenceEntry,
  ChapterRevision,
  ChapterStatus,
  DDay,
  DailyTask,
  Doubt,
  GroupHistoryMap,
  GroupsUserConfig,
  Habit,
  HabitCategory,
  HabitLogDay,
  HabitLogMap,
  JoinedGroupPreference,
  MistakeEntry,
  MistakeReason,
  MockSubjectScore,
  MockTest,
  PYQEntry,
  PulseHabitState,
  StudySession,
  Subject,
  TargetsConfig,
  TimerMetrics,
  TimerMode,
  UserProfile,
  WellbeingEntry,
} from '../types';

export const DN = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;
export const CATS: HabitCategory[] = ['Health', 'Mind', 'Work', 'Learn', 'Social', 'Other'];
export const CC: Record<HabitCategory, string> = {
  Health: '#34d399',
  Mind: '#a78bfa',
  Work: '#60a5fa',
  Learn: '#fbbf24',
  Social: '#f472b6',
  Other: '#94a3b8',
};
export const ACS = ['#38bdf8', '#10b981', '#6366f1', '#a855f7', '#f43f5e', '#f59e0b'];
export const SUB_COLORS = [
  '#3b82f6',
  '#f59e0b',
  '#10b981',
  '#ec4899',
  '#6366f1',
  '#a855f7',
  '#14b8a6',
  '#f97316',
];

export interface DailyFocusTip {
  id: string;
  title: string;
  tip: string;
  tag: string;
}

export const DAILY_FOCUS_TIPS: DailyFocusTip[] = [
  {
    id: 'tip_1',
    title: 'Active Recall Over Re-Reading',
    tip: 'Close your NCERT or notes after every 25-minute block and write down everything you remember from scratch. Retrieval strengthens neural pathways 3× faster than passive highlighting.',
    tag: 'Memory Science',
  },
  {
    id: 'tip_2',
    title: 'The 2-Minute Ignition Rule',
    tip: 'When resistance is high, commit to starting your timer and writing just the session heading for 2 minutes. Momentum almost always carries you into deep flow.',
    tag: 'Anti-Procrastination',
  },
  {
    id: 'tip_3',
    title: 'Single-Task Context Locking',
    tip: 'Give every study session one specific, concrete heading (e.g., "Rotational Mechanics PYQs" instead of "Study"). Clear scope eliminates mid-session decision fatigue.',
    tag: 'Deep Work',
  },
  {
    id: 'tip_4',
    title: 'Ultradian 90-Minute Wave',
    tip: 'Your brain naturally cycles through 90-minute peaks of high alertness followed by a 20-minute trough. Pair two 45m countdown sessions before taking a real walk.',
    tag: 'Circadian Rhythm',
  },
  {
    id: 'tip_5',
    title: 'Interleaving Practice Problems',
    tip: 'Mix three different problem types in one session rather than grinding 20 identical drills. Your brain learns how to select the right strategy under exam pressure.',
    tag: 'Problem Solving',
  },
  {
    id: 'tip_6',
    title: 'Feynman Summary Note',
    tip: 'When ending your session, write a 1-sentence summary of what you completed as if explaining it to a classmate. Any gap in your explanation reveals what to revise next.',
    tag: 'Retention',
  },
  {
    id: 'tip_7',
    title: 'Visual Distraction Purge',
    tip: 'Keep your phone out of your peripheral vision and use Picture-in-Picture mode while watching lectures so only the live study clock stays in view.',
    tag: 'Attention Control',
  },
  {
    id: 'tip_8',
    title: 'Ride the Flow Overtime',
    tip: 'If your Pomodoro hits 00:00 while you are deep in concentration, do not force a break—let the timer count up in overtime until you hit a natural stopping point.',
    tag: 'Flow State',
  },
];

export function getDailyFocusTip(dayKey: string, offset = 0): DailyFocusTip {
  let hash = 0;
  for (let i = 0; i < dayKey.length; i++) {
    hash = (hash * 31 + dayKey.charCodeAt(i)) >>> 0;
  }
  const idx = (hash + Math.max(0, offset)) % DAILY_FOCUS_TIPS.length;
  return DAILY_FOCUS_TIPS[idx];
}

export const STUDY_MOTIVATIONAL_QUOTES: string[] = [
  'Deep focus compounds: every uninterrupted minute builds exam-day intuition.',
  'Mastery is built one NCERT line, one derivation, and one PYQ at a time.',
  'Protect this block of attention—what you understand deeply today stays with you.',
  'Consistency beats intensity when practiced daily without negotiation.',
  'Clarity comes from working through the hard problems, not skipping around them.',
  'Your future rank is the quiet sum of blocks just like this one.',
  'Stay with the concept for 5 more minutes; breakthroughs happen right past resistance.',
  'Precision in practice becomes calm confidence in the examination hall.',
  'Active recall turns fleeting reading into permanent neural wiring.',
  'Small daily improvements in focus purity create massive syllabus momentum.',
  'Calm mind, sharp pencil, zero distractions—own this study sprint.',
  'Every solved mistake today is four marks rescued on exam day.',
];

export function getStudyQuoteForTimer(
  startTs: number,
  activeMs: number,
  manualOffset = 0
): string {
  const safeStart = Number.isFinite(startTs) ? Math.max(0, Math.floor(startTs / 1000)) : 0;
  const rotationStep = Math.max(0, Math.floor((Number(activeMs) || 0) / 180000)); // rotates every 3 mins of active time
  const idx =
    (safeStart + rotationStep + Math.max(0, Math.floor(manualOffset))) %
    STUDY_MOTIVATIONAL_QUOTES.length;
  return STUDY_MOTIVATIONAL_QUOTES[idx];
}

export const STARTERS: Array<Partial<Habit> & { name: string; e: string; c: HabitCategory }> = [
  {
    name: 'Deep Study (3 hrs)',
    e: '📚',
    c: 'Learn',
    tn: 180,
    tu: 'min',
    subjectId: 'any',
    autoMins: 180,
  },
  { name: 'NCERT Line-by-Line Reading', e: '📖', c: 'Learn', tn: 1, tu: '' },
  {
    name: 'Physics Numericals Practice',
    e: '⚛️',
    c: 'Learn',
    tn: 60,
    tu: 'min',
    subjectId: 'sub_phy',
    autoMins: 60,
  },
  { name: 'Drink water', e: '💧', c: 'Health', tn: 8, tu: 'glasses' },
  { name: 'Mistake Notebook Review', e: '📝', c: 'Learn', tn: 1, tu: '' },
];

export const DEFAULT_SUBJECTS: Subject[] = [
  {
    id: 'sub_phy',
    name: 'Physics',
    e: '⚛️',
    color: '#3b82f6',
    dailyGoalMins: 0,
    arch: 0,
    todos: [],
  },
  {
    id: 'sub_chem',
    name: 'Chemistry',
    e: '🧪',
    color: '#f59e0b',
    dailyGoalMins: 0,
    arch: 0,
    todos: [],
  },
  {
    id: 'sub_bot',
    name: 'Botany',
    e: '🌿',
    color: '#10b981',
    dailyGoalMins: 0,
    arch: 0,
    todos: [],
  },
  {
    id: 'sub_zoo',
    name: 'Zoology',
    e: '🧬',
    color: '#ec4899',
    dailyGoalMins: 0,
    arch: 0,
    todos: [],
  },
];

const LEGACY_SUBJECT_FALLBACKS: Record<string, { name: string; e: string; color: string }> = {
  sub_code: { name: 'Coding & CS', e: '💻', color: '#6366f1' },
  sub_math: { name: 'Mathematics', e: '📐', color: '#10b981' },
  sub_lec: { name: 'Lectures', e: '🎧', color: '#f59e0b' },
  sub_read: { name: 'Reading & Review', e: '📖', color: '#ec4899' },
};

export const pad = (n: number): string => String(Math.floor(Math.abs(n))).padStart(2, '0');

export const uid = (p: string): string =>
  p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function keyFromDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function logicalKey(tsOrDate: number | Date = new Date(), dayResetHour = 4): string {
  const d = new Date(tsOrDate);
  d.setHours(d.getHours() - dayResetHour);
  return keyFromDate(d);
}

export function parseKey(k: string): Date {
  const [a, b, c] = k.split('-').map(Number);
  return new Date(a, (b || 1) - 1, c || 1);
}

export const parseD = parseKey;

export function addD(k: string, n: number): string {
  const d = parseKey(k);
  d.setDate(d.getDate() + n);
  return keyFromDate(d);
}

export function daysBetweenKeys(laterKey: string, earlierKey: string): number {
  const t1 = parseKey(laterKey).getTime();
  const t0 = parseKey(earlierKey).getTime();
  return Math.round((t1 - t0) / 86400000);
}

export function fmtHMS(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function fmtMS(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${pad(m)}:${pad(s)}`;
}

export function fmtHMShort(ms: number): string {
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export const fmtDuration = fmtHMShort;

export function fmtHoursDecimal(ms: number): string {
  const hrs = ms / 3600000;
  return hrs.toFixed(1) + 'h';
}

export function fmtClockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function getHeadingColor(heading?: string): string {
  const clean = (heading || 'Study Session').trim().toLowerCase();
  if (!clean) return SUB_COLORS[0];
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = (hash * 31 + clean.charCodeAt(i)) >>> 0;
  }
  return SUB_COLORS[hash % SUB_COLORS.length];
}

export function getSubject(state: PulseHabitState, id?: string): Subject {
  if (id) {
    const found = state.subjects?.find((x) => x.id === id);
    if (found) return found;
    const legacy = LEGACY_SUBJECT_FALLBACKS[id];
    if (legacy) {
      return {
        id,
        name: legacy.name,
        e: legacy.e,
        color: legacy.color,
        dailyGoalMins: 0,
        arch: 0,
        todos: [],
      };
    }
    return {
      id,
      name: id.replace(/^sub_/, '').replace(/_/g, ' ') || 'General Study',
      e: '📚',
      color: getHeadingColor(id),
      dailyGoalMins: 0,
      arch: 0,
      todos: [],
    };
  }
  return state.subjects?.[0] || DEFAULT_SUBJECTS[0];
}

export function getSessionHeading(state: PulseHabitState, session: StudySession): string {
  if (session.heading && session.heading.trim()) {
    return session.heading.trim();
  }
  if (session.chapterId) {
    const ch = state.chapters?.find((c) => c.id === session.chapterId);
    if (ch && ch.name.trim()) return ch.name.trim();
  }
  const sub = getSubject(state, session.subjectId);
  return sub.name || 'Study Session';
}

export function cloneLog(log: HabitLogMap | undefined): HabitLogMap {
  const out: HabitLogMap = {};
  if (!log || typeof log !== 'object') return out;
  for (const hId of Object.keys(log)) {
    const dayMap = log[hId];
    if (!dayMap || typeof dayMap !== 'object') continue;
    out[hId] = {};
    for (const dKey of Object.keys(dayMap)) {
      const entry = dayMap[dKey];
      if (entry && typeof entry === 'object') {
        out[hId][dKey] = {
          v: Number(entry.v) || 0,
          s: Number(entry.s) || 0,
          ...(Number.isFinite(entry.updatedAt) ? { updatedAt: Number(entry.updatedAt) } : {}),
        };
      }
    }
  }
  return out;
}

export function createBlankState(): PulseHabitState {
  return {
    habits: [],
    log: {},
    subjects: JSON.parse(JSON.stringify(DEFAULT_SUBJECTS)),
    todos: [],
    tasks: [],
    sessions: [],
    plans: {},
    ddays: [],
    mocks: [],
    chapters: [],
    mistakes: [],
    doubts: [],
    pyq: [],
    restDays: [],
    wellbeing: {},
    activeTimer: null,
    notes: {},
    mood: {},
    bonus: 0,
    exp: 0,
    ob: 0,
    del: [],
    delAt: {},
    savedAt: 0,
    profile: {
      nick: '',
      emoji: '🩺',
    },
    groupHistory: {},
    groupsConfig: {
      consentAccepted: false,
      joined: [],
    },
    set: {
      theme: 'dark',
      ac: ACS[0],
      snd: 1,
      ws: 1,
      notif: 0,
      dayResetHour: 4,
      pomoWork: 25,
      pomoBreak: 5,
      countdownMins: 45,
      defaultMode: 'pomo',
      pipPref: 'video',
      timerAesthetic: 'neon',
      soundscape: 'off',
      soundVol: 0.35,
      targetMockScore: 650,
      revisionBufferDays: 30,
      fullMockMins: 200,
      revisionIntervals: [1, 3, 7, 21],
      revisionSuggestDays: [1, 3, 7, 21],
      avatarEmoji: '🩺',
      targets: {
        dailyMinutes: {},
        weeklyMinutes: {},
        minDayMinutes: 240,
        restPassesPerMonth: 4,
      },
      updatedAt: 0,
    },
  };
}

export function createDefaultState(): PulseHabitState {
  return createBlankState();
}

export function mkHabit(p: Partial<Habit>, todayKey = logicalKey(new Date(), 4)): Habit {
  const isAuto = Boolean(p.subjectId || p.autoMins);
  const rawTarget = Number(p.autoMins || p.tn) || (isAuto ? 60 : 1);
  const targetVal = Math.max(1, rawTarget);
  const now = Date.now();
  return {
    id: p.id || uid('h'),
    name: p.name || 'Habit',
    e: p.e || '✨',
    c: p.c || 'Other',
    sch: p.sch || 'daily',
    days: Array.isArray(p.days) && p.days.length ? p.days : [0, 1, 2, 3, 4, 5, 6],
    n: p.n || 3,
    tn: targetVal,
    tu: isAuto ? 'min' : p.tu || '',
    rem: p.rem || '',
    arch: p.arch || 0,
    created: p.created || todayKey,
    subjectId: p.subjectId || (p.autoMins ? 'any' : ''),
    autoMins: isAuto ? targetVal : 0,
    u: p.u || now,
    updatedAt: p.updatedAt || p.u || now,
  };
}

export function norm(raw: unknown): PulseHabitState {
  const d = createBlankState();
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const s = Object.assign({}, d, src) as PulseHabitState;

  // Settings
  s.set = Object.assign({}, d.set, src.set && typeof src.set === 'object' ? src.set : {});
  if (!s.set.defaultMode) s.set.defaultMode = 'pomo';
  if (
    s.set.timerAesthetic !== 'neon' &&
    s.set.timerAesthetic !== 'minimal' &&
    s.set.timerAesthetic !== 'retro'
  ) {
    s.set.timerAesthetic = 'neon';
  }
  if (!Number.isFinite(s.set.dayResetHour)) s.set.dayResetHour = 4;
  if (!Number.isFinite(s.set.targetMockScore)) s.set.targetMockScore = 650;
  s.set.revisionBufferDays = Number.isFinite(s.set.revisionBufferDays)
    ? Math.max(0, Math.floor(Number(s.set.revisionBufferDays)))
    : 30;
  s.set.fullMockMins =
    Number.isFinite(s.set.fullMockMins) && Number(s.set.fullMockMins) >= 10
      ? Math.floor(Number(s.set.fullMockMins))
      : 200;
  const rawRevInts = Array.isArray(s.set.revisionIntervals)
    ? s.set.revisionIntervals
    : Array.isArray(s.set.revisionSuggestDays)
      ? s.set.revisionSuggestDays
      : null;
  if (rawRevInts) {
    const cleanInts = Array.from(
      new Set(
        rawRevInts
          .map((n) => Math.floor(Number(n)))
          .filter((n) => Number.isFinite(n) && n >= 1 && n <= 365)
      )
    ).sort((a, b) => a - b);
    const finalInts = cleanInts.length > 0 ? cleanInts : [1, 3, 7, 21];
    s.set.revisionIntervals = finalInts;
    s.set.revisionSuggestDays = [...finalInts];
  } else {
    s.set.revisionIntervals = [1, 3, 7, 21];
    s.set.revisionSuggestDays = [1, 3, 7, 21];
  }
  const rawTargets =
    s.set.targets && typeof s.set.targets === 'object'
      ? (s.set.targets as unknown as Record<string, unknown>)
      : {};
  const cleanDailyMins: Record<string, number> = {};
  if (rawTargets.dailyMinutes && typeof rawTargets.dailyMinutes === 'object') {
    for (const [k, v] of Object.entries(rawTargets.dailyMinutes as Record<string, unknown>)) {
      const n = Math.floor(Number(v));
      if (Number.isFinite(n) && n >= 0) cleanDailyMins[k] = n;
    }
  }
  const cleanWeeklyMins: Record<string, number> = {};
  if (rawTargets.weeklyMinutes && typeof rawTargets.weeklyMinutes === 'object') {
    for (const [k, v] of Object.entries(rawTargets.weeklyMinutes as Record<string, unknown>)) {
      const n = Math.floor(Number(v));
      if (Number.isFinite(n) && n >= 0) cleanWeeklyMins[k] = n;
    }
  }
  const normalizedTargets: TargetsConfig = {
    dailyMinutes: cleanDailyMins,
    weeklyMinutes: cleanWeeklyMins,
    minDayMinutes:
      Number.isFinite(rawTargets.minDayMinutes) && Number(rawTargets.minDayMinutes) >= 0
        ? Math.floor(Number(rawTargets.minDayMinutes))
        : 240,
    restPassesPerMonth:
      Number.isFinite(rawTargets.restPassesPerMonth) && Number(rawTargets.restPassesPerMonth) >= 0
        ? Math.floor(Number(rawTargets.restPassesPerMonth))
        : 4,
  };
  s.set.targets = normalizedTargets;
  s.set.avatarEmoji =
    typeof s.set.avatarEmoji === 'string' && s.set.avatarEmoji.trim()
      ? s.set.avatarEmoji.trim().slice(0, 8)
      : '🩺';
  s.set.burnoutDismissedUntil =
    typeof s.set.burnoutDismissedUntil === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(s.set.burnoutDismissedUntil)
      ? s.set.burnoutDismissedUntil
      : undefined;
  s.set.updatedAt = Number.isFinite(s.set.updatedAt) ? Number(s.set.updatedAt) : 0;

  // Subjects: preserve existing user subjects if non-empty
  if (Array.isArray(src.subjects) && src.subjects.length > 0) {
    s.subjects = src.subjects
      .filter(
        (sub): sub is Subject =>
          Boolean(sub) &&
          typeof sub === 'object' &&
          typeof (sub as Subject).id === 'string' &&
          Boolean((sub as Subject).id.trim()) &&
          typeof (sub as Subject).name === 'string' &&
          Boolean((sub as Subject).name.trim())
      )
      .map((sub) => ({
        ...sub,
        e: sub.e || '📚',
        color: sub.color || getHeadingColor(sub.name),
        arch: sub.arch || 0,
        todos: Array.isArray(sub.todos) ? sub.todos : [],
        updatedAt: Number.isFinite(sub.updatedAt) ? Number(sub.updatedAt) : 0,
      }));
    if (!s.subjects.length) {
      s.subjects = JSON.parse(JSON.stringify(DEFAULT_SUBJECTS));
    }
  } else {
    s.subjects = JSON.parse(JSON.stringify(DEFAULT_SUBJECTS));
  }

  // Habits (A8 + A11 validation: drop habits without string id/name, keep autoMins & tn in sync)
  if (Array.isArray(src.habits)) {
    s.habits = src.habits
      .filter(
        (h): h is Habit =>
          Boolean(h) &&
          typeof h === 'object' &&
          typeof (h as Habit).id === 'string' &&
          Boolean((h as Habit).id.trim()) &&
          typeof (h as Habit).name === 'string' &&
          Boolean((h as Habit).name.trim())
      )
      .map((h) => {
        const isAuto = Boolean(h.subjectId || h.autoMins);
        const syncedTarget = isAuto
          ? Math.max(1, Number(h.tn || h.autoMins) || 60)
          : Math.max(1, Number(h.tn) || 1);
        return {
          ...h,
          e: typeof h.e === 'string' && h.e.trim() ? h.e : '✨',
          c: CATS.includes(h.c) ? h.c : 'Other',
          sch: h.sch === 'days' || h.sch === 'week' ? h.sch : 'daily',
          days: Array.isArray(h.days) && h.days.length ? h.days : [0, 1, 2, 3, 4, 5, 6],
          n: Math.max(1, Number(h.n) || 3),
          tn: syncedTarget,
          tu: isAuto ? 'min' : typeof h.tu === 'string' ? h.tu : '',
          rem: typeof h.rem === 'string' ? h.rem : '',
          arch: h.arch ? 1 : 0,
          created:
            typeof h.created === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(h.created)
              ? h.created
              : logicalKey(new Date(), s.set.dayResetHour),
          subjectId: isAuto ? h.subjectId || 'any' : '',
          autoMins: isAuto ? syncedTarget : 0,
          updatedAt: Number.isFinite(h.updatedAt) ? Number(h.updatedAt) : 0,
        };
      });
  } else {
    s.habits = [];
  }

  // Log
  s.log = cloneLog(src.log as HabitLogMap | undefined);

  // Todos
  if (Array.isArray(src.todos)) {
    s.todos = src.todos
      .filter(
        (td): td is NonNullable<PulseHabitState['todos']>[number] =>
          Boolean(td) &&
          typeof td === 'object' &&
          typeof (td as { id?: unknown }).id === 'string' &&
          typeof (td as { text?: unknown }).text === 'string'
      )
      .map((td) => ({
        ...td,
        updatedAt: Number.isFinite(td.updatedAt) ? Number(td.updatedAt) : 0,
      }));
  } else {
    const mergedTodos = s.subjects.flatMap((sub) => sub.todos || []);
    s.todos = mergedTodos;
  }

  // Daily Tasks (one-off items per dayKey)
  if (Array.isArray(src.tasks)) {
    s.tasks = src.tasks
      .map((rawTask): DailyTask | null => {
        if (!rawTask || typeof rawTask !== 'object') return null;
        const rec = rawTask as Record<string, unknown>;
        const id = typeof rec.id === 'string' ? rec.id.trim() : '';
        const title =
          typeof rec.title === 'string' ? rec.title.trim().slice(0, 140) : '';
        const dayKey = typeof rec.dayKey === 'string' ? rec.dayKey.trim() : '';
        if (!id || !title || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return null;
        const isDone = Boolean(rec.done);
        const createdAt = Number.isFinite(rec.createdAt)
          ? Number(rec.createdAt)
          : Date.now();
        const doneAt =
          isDone && Number.isFinite(rec.doneAt) ? Number(rec.doneAt) : undefined;
        const subjectId =
          typeof rec.subjectId === 'string' && rec.subjectId.trim()
            ? rec.subjectId.trim()
            : undefined;
        const updatedAt = Number.isFinite(rec.updatedAt)
          ? Number(rec.updatedAt)
          : doneAt || createdAt;
        return {
          id,
          title,
          dayKey,
          done: isDone,
          createdAt,
          updatedAt,
          ...(doneAt !== undefined ? { doneAt } : {}),
          ...(subjectId ? { subjectId } : {}),
        };
      })
      .filter((t): t is DailyTask => t !== null);
  } else {
    s.tasks = [];
  }

  // Sessions (A8 validation: drop sessions without string id or finite startTs/endTs)
  const fallbackSubId = s.subjects[0]?.id || 'sub_phy';
  if (Array.isArray(src.sessions)) {
    s.sessions = src.sessions
      .filter(
        (ses): ses is StudySession =>
          Boolean(ses) &&
          typeof ses === 'object' &&
          typeof (ses as StudySession).id === 'string' &&
          Boolean((ses as StudySession).id.trim()) &&
          Number.isFinite((ses as StudySession).startTs) &&
          Number.isFinite((ses as StudySession).endTs)
      )
      .map((ses) => {
        const subjectId =
          typeof ses.subjectId === 'string' && ses.subjectId.trim()
            ? ses.subjectId
            : fallbackSubId;
        const chapterId =
          typeof ses.chapterId === 'string' && ses.chapterId.trim()
            ? ses.chapterId.trim()
            : undefined;
        const sub = getSubject(s, subjectId);
        const heading =
          typeof ses.heading === 'string' && ses.heading.trim()
            ? ses.heading.trim()
            : sub.name || 'Study Session';
        const wallMs = Math.max(0, ses.endTs - ses.startTs);
        const activeMs = Number.isFinite(ses.activeMs) ? Math.max(0, ses.activeMs) : wallMs;
        const dayKey =
          typeof ses.dayKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ses.dayKey)
            ? ses.dayKey
            : logicalKey(ses.startTs, s.set.dayResetHour);
        return {
          ...ses,
          subjectId,
          ...(chapterId ? { chapterId } : {}),
          heading,
          dayKey,
          activeMs,
          pausedMs: Number.isFinite(ses.pausedMs) ? Math.max(0, ses.pausedMs) : 0,
          pauseCount: Number.isFinite(ses.pauseCount) ? Math.max(0, ses.pauseCount) : 0,
          overtimeMs: Number.isFinite(ses.overtimeMs) ? Math.max(0, ses.overtimeMs) : 0,
          purity: Number.isFinite(ses.purity) ? Math.min(100, Math.max(0, ses.purity)) : 100,
          mode:
            ses.mode === 'pomo' ||
            ses.mode === 'countdown' ||
            ses.mode === 'stopwatch' ||
            ses.mode === 'manual' ||
            ses.mode === 'fullMock'
              ? ses.mode
              : 'pomo',
          ...(ses.source === 'manual' || ses.mode === 'manual'
            ? { source: 'manual' as const }
            : ses.source === 'timer'
              ? { source: 'timer' as const }
              : {}),
          rating: Number.isFinite(ses.rating) ? Math.min(5, Math.max(1, ses.rating)) : 5,
          note: typeof ses.note === 'string' ? ses.note : '',
          updatedAt: Number.isFinite(ses.updatedAt) ? ses.updatedAt : ses.endTs,
        };
      });
  } else {
    s.sessions = [];
  }

  // Plans
  s.plans = src.plans && typeof src.plans === 'object' ? (src.plans as PulseHabitState['plans']) : {};

  // D-Days (preserve custom title across JSON stringify/parse cycle, including legacy 'name' key + primary flag)
  if (Array.isArray(src.ddays)) {
    s.ddays = src.ddays
      .map((dd): PulseHabitState['ddays'][number] | null => {
        if (!dd || typeof dd !== 'object') return null;
        const rec = dd as Record<string, unknown>;
        const id = typeof rec.id === 'string' ? rec.id.trim() : '';
        const rawTitle =
          typeof rec.title === 'string' && rec.title.trim()
            ? rec.title.trim()
            : typeof rec.name === 'string' && rec.name.trim()
              ? rec.name.trim()
              : '';
        const date = typeof rec.date === 'string' ? rec.date.trim() : '';
        if (!id || !rawTitle || !date) return null;
        return {
          id,
          title: rawTitle,
          date,
          e: typeof rec.e === 'string' && rec.e.trim() ? rec.e.trim() : '🎯',
          color:
            typeof rec.color === 'string' && rec.color.trim()
              ? rec.color.trim()
              : '#10b981',
          primary: Boolean(rec.primary),
          updatedAt: Number.isFinite(rec.updatedAt) ? Number(rec.updatedAt) : 0,
        };
      })
      .filter((dd): dd is PulseHabitState['ddays'][number] => dd !== null);
    // Ensure at least one primary DDay if none is marked primary (default NEET or first)
    if (s.ddays.length > 0 && !s.ddays.some((d) => d.primary)) {
      const neetIdx = s.ddays.findIndex((d) => /neet/i.test(d.title));
      const primaryIdx = neetIdx >= 0 ? neetIdx : 0;
      s.ddays[primaryIdx] = { ...s.ddays[primaryIdx], primary: true };
    }
  } else {
    s.ddays = [];
  }

  // Mock Tests (B1 + A8 + F2 validation)
  if (Array.isArray(src.mocks)) {
    s.mocks = src.mocks
      .filter(
        (m): m is MockTest =>
          Boolean(m) &&
          typeof m === 'object' &&
          typeof (m as MockTest).id === 'string' &&
          Boolean((m as MockTest).id.trim()) &&
          typeof (m as MockTest).name === 'string' &&
          Boolean((m as MockTest).name.trim()) &&
          typeof (m as MockTest).dayKey === 'string' &&
          Boolean((m as MockTest).dayKey.trim())
      )
      .map((m) => {
        const cleanSubs: Record<string, MockSubjectScore> = {};
        if (m.subjects && typeof m.subjects === 'object') {
          for (const [subId, sc] of Object.entries(m.subjects)) {
            if (sc && typeof sc === 'object') {
              cleanSubs[subId] = {
                correct: Math.max(0, Math.floor(Number(sc.correct) || 0)),
                wrong: Math.max(0, Math.floor(Number(sc.wrong) || 0)),
                unattempted: Math.max(0, Math.floor(Number(sc.unattempted) || 0)),
              };
            }
          }
        }
        const rawWrong = Number(m.marksPerWrong);
        const marksPerWrong = Number.isFinite(rawWrong)
          ? rawWrong === 0
            ? 0
            : -Math.abs(rawWrong)
          : -1;
        return {
          id: m.id,
          name: m.name.trim(),
          dayKey: m.dayKey,
          durationMins:
            Number.isFinite(m.durationMins) && (m.durationMins || 0) > 0
              ? Number(m.durationMins)
              : undefined,
          subjects: cleanSubs,
          marksPerCorrect: Number.isFinite(m.marksPerCorrect) ? Number(m.marksPerCorrect) : 4,
          marksPerWrong,
          maxMarks:
            Number.isFinite(m.maxMarks) && m.maxMarks > 0 ? Number(m.maxMarks) : 720,
          note: typeof m.note === 'string' ? m.note : '',
          updatedAt: Number.isFinite(m.updatedAt) ? Number(m.updatedAt) : Date.now(),
        };
      });
  } else {
    s.mocks = [];
  }

  // Chapters (B2 + A8 + F3 + 1.6 confidence validation)
  const fallbackTodayKey = logicalKey(new Date(), s.set.dayResetHour);
  if (Array.isArray(src.chapters)) {
    s.chapters = src.chapters
      .filter(
        (ch): ch is Chapter =>
          Boolean(ch) &&
          typeof ch === 'object' &&
          typeof (ch as Chapter).id === 'string' &&
          Boolean((ch as Chapter).id.trim()) &&
          typeof (ch as Chapter).subjectId === 'string' &&
          Boolean((ch as Chapter).subjectId.trim()) &&
          typeof (ch as Chapter).name === 'string' &&
          Boolean((ch as Chapter).name.trim())
      )
      .map((ch) => {
        const status: ChapterStatus =
          ch.status === 'completed' || ch.status === 'inProgress'
            ? ch.status
            : 'notStarted';
        const seenRevDates = new Set<string>();
        const revisions: ChapterRevision[] = Array.isArray(ch.revisions)
          ? ch.revisions
              .filter(
                (r): r is ChapterRevision =>
                  Boolean(r) &&
                  typeof r === 'object' &&
                  typeof (r as ChapterRevision).id === 'string' &&
                  Boolean((r as ChapterRevision).id.trim()) &&
                  typeof (r as ChapterRevision).date === 'string' &&
                  /^\d{4}-\d{2}-\d{2}$/.test((r as ChapterRevision).date)
              )
              .filter((r) => {
                if (seenRevDates.has(r.date)) return false;
                seenRevDates.add(r.date);
                return true;
              })
              .map((r) => ({
                id: r.id,
                date: r.date,
                done: Boolean(r.done),
                doneOn: typeof r.doneOn === 'string' ? r.doneOn : undefined,
              }))
          : [];
        const rawCompletedOn =
          typeof ch.completedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ch.completedOn.trim())
            ? ch.completedOn.trim()
            : undefined;
        const completedOn =
          status === 'notStarted'
            ? undefined
            : status === 'completed'
              ? rawCompletedOn || fallbackTodayKey
              : rawCompletedOn;
        const rawConf = Number(ch.confidence);
        const confidence =
          Number.isFinite(rawConf) && rawConf >= 1 && rawConf <= 5
            ? (Math.round(rawConf) as 1 | 2 | 3 | 4 | 5)
            : undefined;
        const confidenceLog: ChapterConfidenceEntry[] = Array.isArray(ch.confidenceLog)
          ? ch.confidenceLog
              .filter(
                (entry): entry is ChapterConfidenceEntry =>
                  Boolean(entry) &&
                  typeof entry === 'object' &&
                  typeof (entry as ChapterConfidenceEntry).dayKey === 'string' &&
                  /^\d{4}-\d{2}-\d{2}$/.test((entry as ChapterConfidenceEntry).dayKey) &&
                  Number.isFinite((entry as ChapterConfidenceEntry).value) &&
                  (entry as ChapterConfidenceEntry).value >= 1 &&
                  (entry as ChapterConfidenceEntry).value <= 5
              )
              .slice(-50)
          : [];
        return {
          id: ch.id,
          subjectId: ch.subjectId,
          name: ch.name.trim(),
          status,
          completedOn,
          revisions,
          note: typeof ch.note === 'string' ? ch.note : '',
          ...(confidence !== undefined ? { confidence } : {}),
          ...(confidenceLog.length > 0 ? { confidenceLog } : {}),
          updatedAt: Number.isFinite(ch.updatedAt) ? Number(ch.updatedAt) : 0,
        };
      });
  } else {
    s.chapters = [];
  }

  // Mistakes (1.3)
  const validReasons = new Set<MistakeReason>(['concept', 'silly', 'time', 'guess', 'forgot']);
  if (Array.isArray(src.mistakes)) {
    s.mistakes = src.mistakes
      .map((raw): MistakeEntry | null => {
        if (!raw || typeof raw !== 'object') return null;
        const rec = raw as Record<string, unknown>;
        const id = typeof rec.id === 'string' ? rec.id.trim() : '';
        const subjectId = typeof rec.subjectId === 'string' ? rec.subjectId.trim() : '';
        const dayKey =
          typeof rec.dayKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rec.dayKey.trim())
            ? rec.dayKey.trim()
            : fallbackTodayKey;
        if (!id || !subjectId) return null;
        const reason: MistakeReason = validReasons.has(rec.reason as MistakeReason)
          ? (rec.reason as MistakeReason)
          : 'concept';
        const createdAt = Number.isFinite(rec.createdAt) ? Number(rec.createdAt) : Date.now();
        const updatedAt = Number.isFinite(rec.updatedAt) ? Number(rec.updatedAt) : createdAt;
        return {
          id,
          ...(typeof rec.mockId === 'string' && rec.mockId.trim()
            ? { mockId: rec.mockId.trim() }
            : {}),
          dayKey,
          subjectId,
          ...(typeof rec.chapterId === 'string' && rec.chapterId.trim()
            ? { chapterId: rec.chapterId.trim() }
            : {}),
          reason,
          ...(typeof rec.note === 'string' ? { note: rec.note } : {}),
          resolved: Boolean(rec.resolved),
          createdAt,
          updatedAt,
        };
      })
      .filter((m): m is MistakeEntry => m !== null);
  } else {
    s.mistakes = [];
  }

  // Doubts (1.4)
  if (Array.isArray(src.doubts)) {
    s.doubts = src.doubts
      .map((raw): Doubt | null => {
        if (!raw || typeof raw !== 'object') return null;
        const rec = raw as Record<string, unknown>;
        const id = typeof rec.id === 'string' ? rec.id.trim() : '';
        const subjectId = typeof rec.subjectId === 'string' ? rec.subjectId.trim() : '';
        const text = typeof rec.text === 'string' ? rec.text.trim() : '';
        if (!id || !subjectId || !text) return null;
        const createdAt = Number.isFinite(rec.createdAt) ? Number(rec.createdAt) : Date.now();
        const resolved = Boolean(rec.resolved);
        const resolvedAt =
          resolved && Number.isFinite(rec.resolvedAt) ? Number(rec.resolvedAt) : undefined;
        const updatedAt = Number.isFinite(rec.updatedAt)
          ? Number(rec.updatedAt)
          : resolvedAt || createdAt;
        return {
          id,
          subjectId,
          ...(typeof rec.chapterId === 'string' && rec.chapterId.trim()
            ? { chapterId: rec.chapterId.trim() }
            : {}),
          text,
          createdAt,
          resolved,
          ...(resolvedAt !== undefined ? { resolvedAt } : {}),
          updatedAt,
        };
      })
      .filter((d): d is Doubt => d !== null);
  } else {
    s.doubts = [];
  }

  // PYQ Entries (1.5)
  if (Array.isArray(src.pyq)) {
    s.pyq = src.pyq
      .map((raw): PYQEntry | null => {
        if (!raw || typeof raw !== 'object') return null;
        const rec = raw as Record<string, unknown>;
        const id = typeof rec.id === 'string' ? rec.id.trim() : '';
        const chapterId = typeof rec.chapterId === 'string' ? rec.chapterId.trim() : '';
        const dayKey =
          typeof rec.dayKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rec.dayKey.trim())
            ? rec.dayKey.trim()
            : fallbackTodayKey;
        const attempted = Math.max(0, Math.floor(Number(rec.attempted) || 0));
        const correct = Math.min(attempted, Math.max(0, Math.floor(Number(rec.correct) || 0)));
        if (!id || !chapterId || attempted <= 0) return null;
        const updatedAt = Number.isFinite(rec.updatedAt) ? Number(rec.updatedAt) : Date.now();
        return {
          id,
          chapterId,
          dayKey,
          attempted,
          correct,
          updatedAt,
        };
      })
      .filter((p): p is PYQEntry => p !== null);
  } else {
    s.pyq = [];
  }

  // Rest Days (1.9)
  if (Array.isArray(src.restDays)) {
    const uniqueRest = Array.from(
      new Set(
        src.restDays.filter(
          (dk): dk is string => typeof dk === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dk.trim())
        )
      )
    ).sort();
    s.restDays = uniqueRest;
  } else {
    s.restDays = [];
  }

  // Wellbeing (1.11)
  if (src.wellbeing && typeof src.wellbeing === 'object') {
    const wb: Record<string, WellbeingEntry> = {};
    for (const [dk, val] of Object.entries(src.wellbeing as Record<string, unknown>)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dk) || !val || typeof val !== 'object') continue;
      const rec = val as Record<string, unknown>;
      const rawSleep = Number(rec.sleep);
      const sleep =
        Number.isFinite(rawSleep) && rawSleep >= 0 && rawSleep <= 14
          ? Math.round(rawSleep * 2) / 2
          : undefined;
      const rawEnergy = Number(rec.energy);
      const energy =
        Number.isFinite(rawEnergy) && rawEnergy >= 1 && rawEnergy <= 5
          ? (Math.round(rawEnergy) as 1 | 2 | 3 | 4 | 5)
          : undefined;
      if (sleep !== undefined || energy !== undefined) {
        wb[dk] = {
          ...(sleep !== undefined ? { sleep } : {}),
          ...(energy !== undefined ? { energy } : {}),
          updatedAt: Number.isFinite(rec.updatedAt) ? Number(rec.updatedAt) : 0,
        };
      }
    }
    s.wellbeing = wb;
  } else {
    s.wellbeing = {};
  }

  // Burnout dismissal (1.12)
  if (
    typeof src.burnoutDismissedUntil === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(src.burnoutDismissedUntil.trim())
  ) {
    s.burnoutDismissedUntil = src.burnoutDismissedUntil.trim();
  } else {
    s.burnoutDismissedUntil = undefined;
  }

  // ActiveTimer
  if (
    src.activeTimer &&
    typeof src.activeTimer === 'object' &&
    Number.isFinite((src.activeTimer as { startTs?: unknown }).startTs) &&
    Number.isFinite((src.activeTimer as { sliceStartTs?: unknown }).sliceStartTs)
  ) {
    const at = src.activeTimer as NonNullable<PulseHabitState['activeTimer']>;
    s.activeTimer = {
      ...at,
      subjectId:
        typeof at.subjectId === 'string' && at.subjectId.trim()
          ? at.subjectId
          : fallbackSubId,
      ...(typeof at.chapterId === 'string' && at.chapterId.trim()
        ? { chapterId: at.chapterId.trim() }
        : {}),
      chimeFired: Boolean(at.chimeFired),
      fiveMinWarnFired: Boolean(at.fiveMinWarnFired),
      ...(Array.isArray(at.mockSections) ? { mockSections: at.mockSections } : {}),
      ...(Number.isFinite(at.sectionStartActiveMs)
        ? { sectionStartActiveMs: Number(at.sectionStartActiveMs) }
        : {}),
    };
  } else {
    s.activeTimer = null;
  }

  s.notes = src.notes && typeof src.notes === 'object' ? (src.notes as Record<string, string>) : {};
  s.mood = src.mood && typeof src.mood === 'object' ? (src.mood as Record<string, number>) : {};
  s.bonus = Number.isFinite(src.bonus) ? Number(src.bonus) : 0;
  s.exp = Number.isFinite(src.exp) ? Number(src.exp) : 0;
  s.ob = src.ob ? 1 : 0;

  // Tombstones (2.3: support string[] in s.del + timestamps in s.delAt, and accept { id, deletedAt } in raw.del)
  const delSet = new Set<string>();
  const delAtMap: Record<string, number> = {};
  if (src.delAt && typeof src.delAt === 'object') {
    for (const [id, ts] of Object.entries(src.delAt as Record<string, unknown>)) {
      if (typeof id === 'string' && id.trim() && Number.isFinite(ts)) {
        delAtMap[id.trim()] = Number(ts);
      }
    }
  }
  if (Array.isArray(src.del)) {
    for (const item of src.del) {
      if (typeof item === 'string' && item.trim()) {
        delSet.add(item.trim());
        if (!delAtMap[item.trim()]) delAtMap[item.trim()] = 0;
      } else if (item && typeof item === 'object') {
        const rec = item as { id?: unknown; deletedAt?: unknown };
        if (typeof rec.id === 'string' && rec.id.trim()) {
          const cleanId = rec.id.trim();
          delSet.add(cleanId);
          if (Number.isFinite(rec.deletedAt)) {
            delAtMap[cleanId] = Number(rec.deletedAt);
          }
        }
      }
    }
  }
  // Prune tombstones older than 90 days when they have a non-zero timestamp
  const ninetyDaysAgo = Date.now() - 90 * 86400000;
  for (const id of Array.from(delSet)) {
    const ts = delAtMap[id];
    if (ts && ts > 0 && ts < ninetyDaysAgo) {
      delSet.delete(id);
      delete delAtMap[id];
    }
  }
  s.del = Array.from(delSet);
  s.delAt = delAtMap;

  s.savedAt = Number.isFinite(src.savedAt) ? Number(src.savedAt) : 0;

  // Profile (Milestone 1.2: nick 0..20 chars, emoji default from set.avatarEmoji || '🩺', optional examYear)
  const defaultProfileEmoji = s.set.avatarEmoji || '🩺';
  if (src.profile && typeof src.profile === 'object') {
    const rawProf = src.profile as Record<string, unknown>;
    const rawNick = typeof rawProf.nick === 'string' ? rawProf.nick.trim().slice(0, 20) : '';
    const rawEmoji =
      typeof rawProf.emoji === 'string' && rawProf.emoji.trim()
        ? rawProf.emoji.trim().slice(0, 8)
        : defaultProfileEmoji;
    const rawExamYear = Number(rawProf.examYear);
    const examYear =
      Number.isFinite(rawExamYear) && rawExamYear >= 2020 && rawExamYear <= 2035
        ? Math.floor(rawExamYear)
        : undefined;
    const prof: UserProfile = {
      nick: rawNick,
      emoji: rawEmoji,
      ...(examYear !== undefined ? { examYear } : {}),
      ...(Number.isFinite(rawProf.updatedAt) ? { updatedAt: Number(rawProf.updatedAt) } : {}),
    };
    s.profile = prof;
  } else {
    s.profile = {
      nick: '',
      emoji: defaultProfileEmoji,
    };
  }

  // Group History (Milestone 2.6: Record<groupId, Record<weekKey, { rank, of, minutes, xp }>>, keep last 12 weeks)
  if (src.groupHistory && typeof src.groupHistory === 'object') {
    const cleanGh: GroupHistoryMap = {};
    for (const [gid, rawWeeks] of Object.entries(src.groupHistory as Record<string, unknown>)) {
      if (typeof gid !== 'string' || !gid.trim() || !rawWeeks || typeof rawWeeks !== 'object') {
        continue;
      }
      const weekEntries: Array<[string, { rank: number; of: number; minutes: number; xp: number }]> = [];
      for (const [wk, rawEntry] of Object.entries(rawWeeks as Record<string, unknown>)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(wk) || !rawEntry || typeof rawEntry !== 'object') {
          continue;
        }
        const rec = rawEntry as Record<string, unknown>;
        const rank = Math.max(1, Math.min(50, Math.floor(Number(rec.rank) || 1)));
        const of = Math.max(rank, Math.min(50, Math.floor(Number(rec.of) || rank)));
        const minutes = Math.max(0, Math.min(10080, Math.floor(Number(rec.minutes) || 0)));
        const xpVal = Math.max(0, Math.min(50000, Math.floor(Number(rec.xp) || 0)));
        weekEntries.push([wk, { rank, of, minutes, xp: xpVal }]);
      }
      weekEntries.sort((a, b) => a[0].localeCompare(b[0]));
      const trimmed = weekEntries.slice(-12);
      if (trimmed.length > 0) {
        cleanGh[gid.trim()] = Object.fromEntries(trimmed);
      }
    }
    s.groupHistory = cleanGh;
  } else {
    s.groupHistory = {};
  }

  // Groups Config (local & synced membership list up to 3 groups + sharing switches)
  if (src.groupsConfig && typeof src.groupsConfig === 'object') {
    const rawGc = src.groupsConfig as Record<string, unknown>;
    const joined: JoinedGroupPreference[] = [];
    const seenGids = new Set<string>();
    if (Array.isArray(rawGc.joined)) {
      for (const item of rawGc.joined) {
        if (!item || typeof item !== 'object') continue;
        const rec = item as Record<string, unknown>;
        const groupId =
          typeof rec.groupId === 'string'
            ? rec.groupId.toUpperCase().replace(/[^A-Z0-9]/g, '')
            : '';
        if (groupId.length !== 10 || seenGids.has(groupId)) continue;
        seenGids.add(groupId);
        const rawSh =
          rec.sh && typeof rec.sh === 'object' ? (rec.sh as Record<string, unknown>) : {};
        joined.push({
          groupId,
          ...(typeof rec.name === 'string' && rec.name.trim()
            ? { name: rec.name.trim().slice(0, 32) }
            : {}),
          ...(typeof rec.emoji === 'string' && rec.emoji.trim()
            ? { emoji: rec.emoji.trim().slice(0, 8) }
            : {}),
          joinedAt: Number.isFinite(rec.joinedAt) ? Number(rec.joinedAt) : Date.now(),
          sh: {
            t: rawSh.t !== undefined ? Boolean(rawSh.t) : true,
            x: rawSh.x !== undefined ? Boolean(rawSh.x) : true,
            s: rawSh.s !== undefined ? Boolean(rawSh.s) : true,
            m: rawSh.m !== undefined ? Boolean(rawSh.m) : false,
            l: rawSh.l !== undefined ? Boolean(rawSh.l) : false,
          },
          ...(rec.paused ? { paused: true } : {}),
        });
        if (joined.length >= 3) break;
      }
    }
    const activeGroupId =
      typeof rawGc.activeGroupId === 'string' &&
      joined.some((j) => j.groupId === rawGc.activeGroupId)
        ? rawGc.activeGroupId
        : joined[0]?.groupId;
    const gc: GroupsUserConfig = {
      consentAccepted: Boolean(rawGc.consentAccepted),
      joined,
      ...(activeGroupId ? { activeGroupId } : {}),
      ...(Number.isFinite(rawGc.updatedAt) ? { updatedAt: Number(rawGc.updatedAt) } : {}),
    };
    s.groupsConfig = gc;
  } else {
    s.groupsConfig = {
      consentAccepted: false,
      joined: [],
    };
  }

  return s;
}

export function isManualStudySession(ses: StudySession): boolean {
  return ses.source === 'manual' || ses.mode === 'manual';
}

export function shouldFireFiveMinWarning(
  timer: PulseHabitState['activeTimer'],
  metrics: TimerMetrics | null
): boolean {
  if (!timer || !metrics) return false;
  if (timer.status !== 'running') return false;
  if (timer.mode === 'stopwatch') return false;
  if (timer.phase === 'break') return false;
  if (timer.fiveMinWarnFired) return false;
  const fiveMinMs = 5 * 60 * 1000;
  if ((timer.targetMs || 0) <= fiveMinMs) return false;
  return metrics.overtimeMs === 0 && metrics.displayMs > 0 && metrics.displayMs <= fiveMinMs;
}

export function getTimerMetrics(state: PulseHabitState, now = Date.now()): TimerMetrics | null {
  const t = state?.activeTimer;
  if (!t) return null;

  const curPauseMs =
    t.status === 'paused' && t.pauseStartTs ? Math.max(0, now - t.pauseStartTs) : 0;
  const totalPausedMs = (t.pausedDurationMs || 0) + curPauseMs;
  const slicePausedMs = (t.slicePausedMs || 0) + curPauseMs;

  const totalActiveMs = Math.max(0, now - t.startTs - totalPausedMs);
  const sliceActiveMs = Math.max(0, now - t.sliceStartTs - slicePausedMs);

  let displayMs = totalActiveMs;
  let overtimeMs = 0;
  let progressPct = 0;

  if (t.mode === 'stopwatch') {
    displayMs = totalActiveMs;
    progressPct = ((totalActiveMs / 1000) % 3600) / 36;
  } else {
    const target = t.targetMs || 1500000;
    if (totalActiveMs <= target) {
      displayMs = target - totalActiveMs;
      progressPct = Math.min(100, (totalActiveMs / target) * 100);
    } else {
      displayMs = 0;
      overtimeMs = totalActiveMs - target;
      progressPct = 100;
    }
  }

  const denom = totalActiveMs + totalPausedMs;
  const purity = denom > 0 ? Math.round((totalActiveMs / denom) * 100) : 100;
  const baseSub = getSubject(state, t.subjectId);
  const linkedChapter = t.chapterId
    ? state.chapters.find((ch) => ch.id === t.chapterId)
    : undefined;
  const heading =
    (t.heading && t.heading.trim()) ||
    linkedChapter?.name ||
    baseSub.name ||
    'Study Session';

  return {
    status: t.status,
    mode: t.mode,
    phase: t.phase || 'work',
    subject: baseSub,
    chapterId: t.chapterId,
    heading,
    totalActiveMs,
    totalPausedMs,
    sliceActiveMs,
    slicePausedMs,
    displayMs,
    overtimeMs,
    progressPct,
    purity,
    pauseCount: t.pauseCount || 0,
  };
}

export function getTodaySubjectMs(
  state: PulseHabitState,
  subId: string,
  dayKey: string,
  todayKey: string | boolean = '',
  now = Date.now()
): number {
  let ms = state.sessions
    .filter(
      (s) => s.dayKey === dayKey && (!subId || subId === 'any' || s.subjectId === subId)
    )
    .reduce((acc, s) => acc + (s.activeMs || 0), 0);

  const effectiveTodayKey =
    typeof todayKey === 'boolean' ? (todayKey ? dayKey : '') : todayKey;

  if (state.activeTimer && effectiveTodayKey && dayKey === effectiveTodayKey) {
    const m = getTimerMetrics(state, now);
    if (
      m &&
      m.phase !== 'break' &&
      (!subId || subId === 'any' || state.activeTimer.subjectId === subId)
    ) {
      ms += m.sliceActiveMs;
    }
  }
  return ms;
}

export function getDayTotalStudyMs(
  state: PulseHabitState,
  dayKey: string,
  todayKey: string | boolean = '',
  now = Date.now()
): number {
  return getTodaySubjectMs(state, 'any', dayKey, todayKey, now);
}

export function getDayStudyMs(
  state: PulseHabitState,
  dayKey: string,
  includeRunning: string | boolean = false,
  now = Date.now()
): number {
  return getDayTotalStudyMs(state, dayKey, includeRunning, now);
}

export function getDailyStudyGoalProgress(
  state: PulseHabitState,
  dayKey: string,
  todayKey: string,
  now = Date.now()
): { studiedMs: number; goalMs: number; pct: number } {
  const studiedMs = getDayTotalStudyMs(state, dayKey, todayKey, now);
  const subjectGoalMins = (state.subjects || [])
    .filter((s) => !s.arch && (s.dailyGoalMins || 0) > 0)
    .reduce((acc, s) => acc + (s.dailyGoalMins || 0), 0);
  const habitGoalMins = (state.habits || [])
    .filter((h) => !h.arch && isAutoStudyHabit(h))
    .reduce((maxM, h) => Math.max(maxM, Number(h.tn || h.autoMins) || 0), 0);
  const goalMins = subjectGoalMins > 0 ? subjectGoalMins : habitGoalMins > 0 ? habitGoalMins : 180;
  const goalMs = Math.max(1, goalMins) * 60000;
  const pct = Math.min(100, Math.max(0, Math.round((studiedMs / goalMs) * 100)));
  return { studiedMs, goalMs, pct };
}

export function isAutoStudyHabit(h: Habit): boolean {
  return Boolean(h.subjectId || h.autoMins);
}

/**
 * Pure-safe habit sync: clones `state.log` before mutating any habit day entry
 * so `prev.log` references are never mutated in place (A4).
 */
export function syncStudyHabitsInPlace(
  state: PulseHabitState,
  dayKey: string,
  todayKey: string,
  now = Date.now()
): boolean {
  return syncStudyHabitsForDays(state, [dayKey], todayKey, now);
}

export function syncStudyHabitsForDays(
  state: PulseHabitState,
  dayKeys: Iterable<string | undefined>,
  todayKey: string,
  now = Date.now()
): boolean {
  const uniqueDays = Array.from(
    new Set(Array.from(dayKeys).filter((x): x is string => Boolean(x)))
  );
  if (!uniqueDays.length) return false;

  let changed = false;
  let clonedLog: HabitLogMap | null = null;

  state.habits.forEach((h) => {
    if (!h.subjectId && !h.autoMins) return;
    const targetSub = h.subjectId || 'any';
    uniqueDays.forEach((dayKey) => {
      const mins = Math.floor(getTodaySubjectMs(state, targetSub, dayKey, todayKey, now) / 60000);
      const currentLog = clonedLog || state.log;
      const prev = currentLog[h.id]?.[dayKey]?.v || 0;
      const prevSkip = currentLog[h.id]?.[dayKey]?.s || 0;
      if (mins !== prev) {
        if (!clonedLog) {
          clonedLog = cloneLog(state.log);
        }
        const L = (clonedLog[h.id] ??= {});
        if (mins > 0 || prevSkip > 0) {
          L[dayKey] = { v: mins, s: prevSkip };
        } else {
          delete L[dayKey];
        }
        changed = true;
      }
    });
  });

  if (changed && clonedLog) {
    state.log = clonedLog;
  }
  return changed;
}

/**
 * Computes average clock time (HH:MM) measured relative to `dayResetHour`
 * so late-night times (e.g. 00:30) average properly with evening times (e.g. 22:00),
 * and rounds total minutes BEFORE modulo 60 so "xx:60" can never occur (A2).
 */
export function computeAvgClockTime(tsList: number[], dayResetHour = 4): string {
  if (!tsList.length) return '--:--';
  const resetMins = (Number.isFinite(dayResetHour) ? dayResetHour : 4) * 60;
  const avgOffset =
    tsList.reduce((acc, ts) => {
      const d = new Date(ts);
      const clockMins = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
      const offsetFromReset = (((clockMins - resetMins) % 1440) + 1440) % 1440;
      return acc + offsetFromReset;
    }, 0) / tsList.length;
  const roundedOffset = Math.round(avgOffset);
  const totalClockMins = (((roundedOffset + resetMins) % 1440) + 1440) % 1440;
  const hh = Math.floor(totalClockMins / 60);
  const mm = totalClockMins % 60;
  return `${pad(hh)}:${pad(mm)}`;
}

export interface StudySummaryReport {
  todayMs: number;
  weekTotalMs: number;
  weekAvgMsPerDay: number;
  weekAvgActiveDayMs: number;
  weekActiveDays: number;
  prevWeekTotalMs: number;
  weekDeltaPct: number;
  monthTotalMs: number;
  monthAvgMsPerDay: number;
  monthActiveDays: number;
  allTimeTotalMs: number;
  totalSessionsCount: number;
  avgSessionMs: number;
  avgPurity: number;
  hourlyMs: number[];
  peakHourIndex: number;
  peakHourWindowLabel: string;
  peakPeriodLabel: string;
  avgStartHourLabel: string;
  avgEndHourLabel: string;
  last7Days: Array<{
    key: string;
    dayName: string;
    shortDate: string;
    ms: number;
    sessionsCount: number;
  }>;
  last30Days: Array<{
    key: string;
    dayName: string;
    shortDate: string;
    ms: number;
    hours: number;
    minutes: number;
    formatted: string;
    sessionsCount: number;
  }>;
  modeBreakdown: Array<{
    mode: TimerMode;
    label: string;
    ms: number;
    count: number;
    pct: number;
  }>;
  subjectBreakdown: Array<{
    subjectId: string;
    name: string;
    e: string;
    color: string;
    ms: number;
    count: number;
    pct: number;
  }>;
  headingBreakdown: Array<{
    heading: string;
    color: string;
    ms: number;
    count: number;
    lastDayKey: string;
    pct: number;
  }>;
}

export function computeStudySummary(
  state: PulseHabitState,
  todayKey: string,
  now = Date.now()
): StudySummaryReport {
  const dayResetHour = state.set.dayResetHour ?? 4;
  const todayMs = getDayTotalStudyMs(state, todayKey, todayKey, now);

  // Last 7 days (this week window)
  const last7Days: StudySummaryReport['last7Days'] = [];
  let weekTotalMs = 0;
  let weekActiveDays = 0;

  for (let i = 6; i >= 0; i--) {
    const k = addD(todayKey, -i);
    const d = parseKey(k);
    const daySessions = state.sessions.filter((s) => s.dayKey === k);
    const ms = getDayTotalStudyMs(state, k, todayKey, now);
    if (ms > 0) weekActiveDays++;
    weekTotalMs += ms;
    last7Days.push({
      key: k,
      dayName: d.toLocaleDateString(undefined, { weekday: 'short' }),
      shortDate: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      ms,
      sessionsCount: daySessions.length,
    });
  }

  // Previous 7 days for comparison
  let prevWeekTotalMs = 0;
  for (let i = 13; i >= 7; i--) {
    const k = addD(todayKey, -i);
    prevWeekTotalMs += getDayTotalStudyMs(state, k, todayKey, now);
  }
  const weekDeltaPct =
    prevWeekTotalMs > 0
      ? Math.round(((weekTotalMs - prevWeekTotalMs) / prevWeekTotalMs) * 100)
      : weekTotalMs > 0
        ? 100
        : 0;

  // Last 30 days (monthly window & Deep Work Frequency series)
  const last30Days: StudySummaryReport['last30Days'] = [];
  let monthTotalMs = 0;
  let monthActiveDays = 0;
  for (let i = 29; i >= 0; i--) {
    const k = addD(todayKey, -i);
    const d = parseKey(k);
    const daySessions = state.sessions.filter((s) => s.dayKey === k);
    const ms = getDayTotalStudyMs(state, k, todayKey, now);
    if (ms > 0) monthActiveDays++;
    monthTotalMs += ms;
    last30Days.push({
      key: k,
      dayName: d.toLocaleDateString(undefined, { weekday: 'short' }),
      shortDate: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      ms,
      hours: Number((ms / 3600000).toFixed(2)),
      minutes: Math.round(ms / 60000),
      formatted: fmtHMShort(ms),
      sessionsCount:
        daySessions.length +
        (k === todayKey && state.activeTimer && state.activeTimer.phase !== 'break' ? 1 : 0),
    });
  }

  const completedSessionsMs = state.sessions.reduce((acc, s) => acc + (s.activeMs || 0), 0);
  const runningSliceMs =
    state.activeTimer && state.activeTimer.phase !== 'break'
      ? getTimerMetrics(state, now)?.sliceActiveMs || 0
      : 0;
  const allTimeTotalMs = completedSessionsMs + runningSliceMs;

  const totalSessionsCount = state.sessions.length;
  // A2: avgSessionMs divides completed-session time only (excluding running timer)
  const avgSessionMs =
    totalSessionsCount > 0 ? Math.round(completedSessionsMs / totalSessionsCount) : 0;
  const avgPurity =
    totalSessionsCount > 0
      ? Math.round(
          state.sessions.reduce((acc, s) => acc + (s.purity ?? 100), 0) / totalSessionsCount
        )
      : 100;

  // 24-hour activity distribution (A2: use s.activeMs ?? wallDuration)
  const hourlyMs = new Array(24).fill(0);
  state.sessions.forEach((s) => {
    if (!s.startTs || !s.endTs || s.endTs <= s.startTs) return;
    const wallDuration = s.endTs - s.startTs;
    const ratio =
      wallDuration > 0 ? Math.min(1, (s.activeMs ?? wallDuration) / wallDuration) : 1;

    let cur = s.startTs;
    while (cur < s.endTs) {
      const d = new Date(cur);
      const hr = d.getHours();
      const nextHour = new Date(
        d.getFullYear(),
        d.getMonth(),
        d.getDate(),
        hr + 1,
        0,
        0,
        0
      ).getTime();
      const segEnd = Math.min(s.endTs, nextHour);
      const segMs = Math.max(0, segEnd - cur) * ratio;
      hourlyMs[hr] += segMs;
      cur = segEnd;
    }
  });

  // A2: Find peak 2-hour window by summing consecutive hours (hour i + hour (i+1)%24)
  let peakHourIndex = 9;
  let maxTwoHourMs = 0;
  for (let hr = 0; hr < 24; hr++) {
    const twoHrMs = hourlyMs[hr] + hourlyMs[(hr + 1) % 24];
    if (twoHrMs > maxTwoHourMs) {
      maxTwoHourMs = twoHrMs;
      peakHourIndex = hr;
    }
  }

  const endPeakHr = (peakHourIndex + 2) % 24;
  const peakHourWindowLabel =
    maxTwoHourMs > 0
      ? `${pad(peakHourIndex)}:00 – ${pad(endPeakHr)}:00`
      : 'No study sessions yet';

  let peakPeriodLabel = 'Morning Focus Peak';
  if (peakHourIndex >= 5 && peakHourIndex < 12) peakPeriodLabel = 'Morning Focus Peak';
  else if (peakHourIndex >= 12 && peakHourIndex < 17) peakPeriodLabel = 'Afternoon Focus Peak';
  else if (peakHourIndex >= 17 && peakHourIndex < 22) peakPeriodLabel = 'Evening Focus Peak';
  else peakPeriodLabel = 'Late-Night Focus Peak';

  // Earliest start & latest wrap-up per logical day (measured from dayResetHour)
  const byDay: Record<string, { minStart: number; maxEnd: number }> = {};
  state.sessions.forEach((s) => {
    if (!Number.isFinite(s.startTs) || !Number.isFinite(s.endTs)) return;
    if (!byDay[s.dayKey]) {
      byDay[s.dayKey] = { minStart: s.startTs, maxEnd: s.endTs };
    } else {
      byDay[s.dayKey].minStart = Math.min(byDay[s.dayKey].minStart, s.startTs);
      byDay[s.dayKey].maxEnd = Math.max(byDay[s.dayKey].maxEnd, s.endTs);
    }
  });
  const dayRecords = Object.values(byDay);
  const avgStartHourLabel = computeAvgClockTime(
    dayRecords.map((x) => x.minStart),
    dayResetHour
  );
  const avgEndHourLabel = computeAvgClockTime(
    dayRecords.map((x) => x.maxEnd),
    dayResetHour
  );

  // Mode breakdown
  const modeLabels: Record<TimerMode, string> = {
    pomo: '🍅 Pomodoro',
    countdown: '⏳ Countdown',
    stopwatch: '⏱️ Stopwatch',
    manual: '✍️ Manual Entry',
    fullMock: '📝 Full Mock',
  };
  const modeMap: Record<TimerMode, { ms: number; count: number }> = {
    pomo: { ms: 0, count: 0 },
    countdown: { ms: 0, count: 0 },
    stopwatch: { ms: 0, count: 0 },
    manual: { ms: 0, count: 0 },
    fullMock: { ms: 0, count: 0 },
  };
  state.sessions.forEach((s) => {
    const m: TimerMode = modeMap[s.mode] ? s.mode : 'pomo';
    modeMap[m].ms += s.activeMs || 0;
    modeMap[m].count += 1;
  });
  const modeBreakdown = (Object.keys(modeMap) as TimerMode[]).map((mode) => ({
    mode,
    label: modeLabels[mode],
    ms: modeMap[mode].ms,
    count: modeMap[mode].count,
    pct: completedSessionsMs > 0 ? Math.round((modeMap[mode].ms / completedSessionsMs) * 100) : 0,
  }));

  // Subject breakdown (A10: includes configured subjects + any legacy/unknown subjectIds)
  const subMap = new Map<
    string,
    { subjectId: string; name: string; e: string; color: string; ms: number; count: number }
  >();
  state.subjects
    .filter((sub) => !sub.arch)
    .forEach((sub) => {
      subMap.set(sub.id, {
        subjectId: sub.id,
        name: sub.name,
        e: sub.e,
        color: sub.color,
        ms: 0,
        count: 0,
      });
    });

  state.sessions.forEach((s) => {
    const sub = getSubject(state, s.subjectId);
    const existing = subMap.get(sub.id);
    if (!existing) {
      subMap.set(sub.id, {
        subjectId: sub.id,
        name: sub.name,
        e: sub.e,
        color: sub.color,
        ms: s.activeMs || 0,
        count: 1,
      });
    } else {
      existing.ms += s.activeMs || 0;
      existing.count += 1;
    }
  });

  if (state.activeTimer && state.activeTimer.phase !== 'break' && runningSliceMs > 0) {
    const activeSub = getSubject(state, state.activeTimer.subjectId);
    const existing = subMap.get(activeSub.id);
    if (!existing) {
      subMap.set(activeSub.id, {
        subjectId: activeSub.id,
        name: activeSub.name,
        e: activeSub.e,
        color: activeSub.color,
        ms: runningSliceMs,
        count: 1,
      });
    } else {
      existing.ms += runningSliceMs;
    }
  }

  const subjectBreakdown = Array.from(subMap.values())
    .sort((a, b) => b.ms - a.ms)
    .map((item) => ({
      ...item,
      pct: allTimeTotalMs > 0 ? Math.round((item.ms / allTimeTotalMs) * 100) : 0,
    }));

  // Heading breakdown
  const headingMap = new Map<
    string,
    { heading: string; ms: number; count: number; lastDayKey: string }
  >();
  state.sessions.forEach((s) => {
    const h = getSessionHeading(state, s);
    const key = h.toLowerCase();
    const prev = headingMap.get(key);
    if (!prev) {
      headingMap.set(key, {
        heading: h,
        ms: s.activeMs || 0,
        count: 1,
        lastDayKey: s.dayKey,
      });
    } else {
      prev.ms += s.activeMs || 0;
      prev.count += 1;
      if (s.dayKey > prev.lastDayKey) prev.lastDayKey = s.dayKey;
    }
  });
  const headingBreakdown = Array.from(headingMap.values())
    .sort((a, b) => b.ms - a.ms)
    .map((item) => ({
      ...item,
      color: getHeadingColor(item.heading),
      pct: completedSessionsMs > 0 ? Math.round((item.ms / completedSessionsMs) * 100) : 0,
    }));

  return {
    todayMs,
    weekTotalMs,
    weekAvgMsPerDay: Math.round(weekTotalMs / 7),
    weekAvgActiveDayMs: weekActiveDays > 0 ? Math.round(weekTotalMs / weekActiveDays) : 0,
    weekActiveDays,
    prevWeekTotalMs,
    weekDeltaPct,
    monthTotalMs,
    monthAvgMsPerDay: Math.round(monthTotalMs / 30),
    monthActiveDays,
    allTimeTotalMs,
    totalSessionsCount,
    avgSessionMs,
    avgPurity,
    hourlyMs,
    peakHourIndex,
    peakHourWindowLabel,
    peakPeriodLabel,
    avgStartHourLabel,
    avgEndHourLabel,
    last7Days,
    last30Days,
    modeBreakdown,
    subjectBreakdown,
    headingBreakdown,
  };
}

// ==========================================
// PART B1: MOCK TEST & SCORE LOG ANALYTICS
// ==========================================

export interface MockSubjectComputed {
  subjectId: string;
  name: string;
  e: string;
  color: string;
  correct: number;
  wrong: number;
  unattempted: number;
  attempted: number;
  totalQuestions: number;
  score: number;
  accuracyPct: number;
  attemptRatePct: number;
}

export interface MockScoreReport {
  totalScore: number;
  maxMarks: number;
  pct: number;
  totalCorrect: number;
  totalWrong: number;
  totalUnattempted: number;
  totalAttempted: number;
  totalQuestions: number;
  accuracyPct: number;
  attemptRatePct: number;
  bySubject: MockSubjectComputed[];
}

export function computeMockScore(mock: MockTest, subjects: Subject[] = DEFAULT_SUBJECTS): MockScoreReport {
  const marksPerCorrect = Number.isFinite(mock.marksPerCorrect) ? mock.marksPerCorrect : 4;
  const rawWrong = Number(mock.marksPerWrong);
  const marksPerWrong = Number.isFinite(rawWrong)
    ? rawWrong === 0
      ? 0
      : -Math.abs(rawWrong)
    : -1;
  const maxMarks = Number.isFinite(mock.maxMarks) && mock.maxMarks > 0 ? mock.maxMarks : 720;

  const subjectOrder: Subject[] = [...subjects];
  for (const subId of Object.keys(mock.subjects || {})) {
    if (!subjectOrder.some((s) => s.id === subId)) {
      const legacy = LEGACY_SUBJECT_FALLBACKS[subId];
      subjectOrder.push({
        id: subId,
        name: legacy?.name || subId,
        e: legacy?.e || '📚',
        color: legacy?.color || getHeadingColor(subId),
        arch: 0,
        todos: [],
      });
    }
  }

  let totalScore = 0;
  let totalCorrect = 0;
  let totalWrong = 0;
  let totalUnattempted = 0;

  const bySubject: MockSubjectComputed[] = subjectOrder.map((sub) => {
    const raw = mock.subjects?.[sub.id] || { correct: 0, wrong: 0, unattempted: 0 };
    const correct = Math.max(0, Math.floor(Number(raw.correct) || 0));
    const wrong = Math.max(0, Math.floor(Number(raw.wrong) || 0));
    const unattempted = Math.max(0, Math.floor(Number(raw.unattempted) || 0));
    const attempted = correct + wrong;
    const totalQuestions = attempted + unattempted;
    const score = correct * marksPerCorrect + wrong * marksPerWrong;
    const accuracyPct = attempted > 0 ? Math.round((correct / attempted) * 100) : 0;
    const attemptRatePct = totalQuestions > 0 ? Math.round((attempted / totalQuestions) * 100) : 0;

    totalScore += score;
    totalCorrect += correct;
    totalWrong += wrong;
    totalUnattempted += unattempted;

    return {
      subjectId: sub.id,
      name: sub.name,
      e: sub.e,
      color: sub.color,
      correct,
      wrong,
      unattempted,
      attempted,
      totalQuestions,
      score,
      accuracyPct,
      attemptRatePct,
    };
  });

  const totalAttempted = totalCorrect + totalWrong;
  const totalQuestions = totalAttempted + totalUnattempted;
  const accuracyPct = totalAttempted > 0 ? Math.round((totalCorrect / totalAttempted) * 100) : 0;
  const attemptRatePct =
    totalQuestions > 0 ? Math.round((totalAttempted / totalQuestions) * 100) : 0;

  const pct = maxMarks > 0 ? Math.max(0, Math.round((totalScore / maxMarks) * 100)) : 0;

  return {
    totalScore,
    maxMarks,
    pct,
    totalCorrect,
    totalWrong,
    totalUnattempted,
    totalAttempted,
    totalQuestions,
    accuracyPct,
    attemptRatePct,
    bySubject,
  };
}

export interface MocksOverviewSummary {
  newestFirst: Array<{ mock: MockTest; report: MockScoreReport }>;
  chronological: Array<{ mock: MockTest; report: MockScoreReport }>;
  avgLast5Score: number;
  bestScore: number;
  lowestAccuracySubject: {
    subjectId: string;
    name: string;
    e: string;
    color: string;
    accuracyPct: number;
  } | null;
}

export function computeMocksOverview(state: PulseHabitState): MocksOverviewSummary {
  const enriched = (state.mocks || []).map((mock) => ({
    mock,
    report: computeMockScore(mock, state.subjects),
  }));

  const newestFirst = enriched.slice().sort((a, b) => {
    if (b.mock.dayKey !== a.mock.dayKey) return b.mock.dayKey.localeCompare(a.mock.dayKey);
    return (b.mock.updatedAt || 0) - (a.mock.updatedAt || 0);
  });

  const chronological = newestFirst.slice().reverse();

  const last5 = newestFirst.slice(0, 5);
  const avgLast5Score =
    last5.length > 0
      ? Math.round(last5.reduce((acc, x) => acc + x.report.totalScore, 0) / last5.length)
      : 0;

  const bestScore =
    enriched.length > 0 ? Math.max(...enriched.map((x) => x.report.totalScore)) : 0;

  // Aggregate per-subject accuracy across all mocks to find "needs attention" subject
  const subTotals = new Map<
    string,
    { subject: Subject; correct: number; attempted: number }
  >();
  state.subjects.forEach((sub) => {
    subTotals.set(sub.id, { subject: sub, correct: 0, attempted: 0 });
  });

  enriched.forEach(({ report }) => {
    report.bySubject.forEach((bs) => {
      const entry = subTotals.get(bs.subjectId) || {
        subject: getSubject(state, bs.subjectId),
        correct: 0,
        attempted: 0,
      };
      entry.correct += bs.correct;
      entry.attempted += bs.attempted;
      subTotals.set(bs.subjectId, entry);
    });
  });

  let lowestAccuracySubject: MocksOverviewSummary['lowestAccuracySubject'] = null;
  for (const { subject, correct, attempted } of subTotals.values()) {
    if (attempted <= 0) continue;
    const acc = Math.round((correct / attempted) * 100);
    if (!lowestAccuracySubject || acc < lowestAccuracySubject.accuracyPct) {
      lowestAccuracySubject = {
        subjectId: subject.id,
        name: subject.name,
        e: subject.e,
        color: subject.color,
        accuracyPct: acc,
      };
    }
  }

  return {
    newestFirst,
    chronological,
    avgLast5Score,
    bestScore,
    lowestAccuracySubject,
  };
}

// ==========================================
// PART B2: CHAPTER SYLLABUS & REVISIONS
// ==========================================

export interface LabeledRevision extends ChapterRevision {
  revNumber: number;
  label: string;
}

export function getSortedChapterRevisions(chapter: Chapter): LabeledRevision[] {
  return (chapter.revisions || [])
    .slice()
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.id.localeCompare(b.id);
    })
    .map((r, idx) => ({
      ...r,
      revNumber: idx + 1,
      label: `R${idx + 1}`,
    }));
}

export interface RevisionDueItem {
  chapterId: string;
  chapterName: string;
  subject: Subject;
  revisionId: string;
  date: string;
  label: string;
  revNumber: number;
  daysLate: number;
  isOverdue: boolean;
}

export function getDueAndOverdueRevisions(
  state: PulseHabitState,
  sel: string,
  todayKey: string
): {
  dueOnSel: RevisionDueItem[];
  overdue: RevisionDueItem[];
} {
  const dueOnSel: RevisionDueItem[] = [];
  const overdue: RevisionDueItem[] = [];

  (state.chapters || []).forEach((ch) => {
    const subject = getSubject(state, ch.subjectId);
    const sortedRevs = getSortedChapterRevisions(ch);
    sortedRevs.forEach((rev) => {
      if (rev.done) return;
      if (rev.date === sel) {
        dueOnSel.push({
          chapterId: ch.id,
          chapterName: ch.name,
          subject,
          revisionId: rev.id,
          date: rev.date,
          label: rev.label,
          revNumber: rev.revNumber,
          daysLate: rev.date < todayKey ? Math.max(1, daysBetweenKeys(todayKey, rev.date)) : 0,
          isOverdue: rev.date < todayKey,
        });
      }
      if (rev.date < todayKey) {
        overdue.push({
          chapterId: ch.id,
          chapterName: ch.name,
          subject,
          revisionId: rev.id,
          date: rev.date,
          label: rev.label,
          revNumber: rev.revNumber,
          daysLate: Math.max(1, daysBetweenKeys(todayKey, rev.date)),
          isOverdue: true,
        });
      }
    });
  });

  dueOnSel.sort((a, b) => a.chapterName.localeCompare(b.chapterName));
  overdue.sort((a, b) => b.daysLate - a.daysLate || a.date.localeCompare(b.date));

  return { dueOnSel, overdue };
}

export const ent = (state: PulseHabitState, h: Habit, k: string) => state.log[h.id]?.[k];
export const done = (state: PulseHabitState, h: Habit, k: string): boolean => {
  const e = ent(state, h, k);
  return !!e && !e.s && e.v >= h.tn;
};
export const skip = (state: PulseHabitState, h: Habit, k: string): boolean =>
  !!ent(state, h, k)?.s;
export const live = (state: PulseHabitState): Habit[] => state.habits.filter((h) => !h.arch);

export const wkS = (state: PulseHabitState, k: string): string =>
  addD(k, -((parseKey(k).getDay() - state.set.ws + 7) % 7));

export const wkC = (state: PulseHabitState, h: Habit, k: string): number => {
  const s = wkS(state, k);
  let c = 0;
  for (let i = 0; i < 7; i++) if (done(state, h, addD(s, i))) c++;
  return c;
};

export const due = (state: PulseHabitState, h: Habit, k: string): boolean =>
  h.sch === 'days'
    ? h.days.includes(parseKey(k).getDay())
    : h.sch === 'week'
      ? done(state, h, k) || wkC(state, h, k) < h.n
      : true;

export const dueOn = (state: PulseHabitState, k: string): Habit[] =>
  live(state).filter((h) => due(state, h, k));

export function streak(
  state: PulseHabitState,
  h: Habit,
  todayKey: string
): { cur: number; best: number } {
  let run = 0;
  let best = 0;
  if (h.sch !== 'week') {
    for (let k = h.created; k <= todayKey; k = addD(k, 1)) {
      if (h.sch === 'days' && !h.days.includes(parseKey(k).getDay())) continue;
      if (done(state, h, k)) run++;
      else if (!skip(state, h, k) && k !== todayKey) run = 0;
      best = Math.max(best, run);
    }
  } else {
    for (let k = wkS(state, h.created); k <= todayKey; k = addD(k, 7)) {
      const c = wkC(state, h, k);
      if (c >= h.n) run++;
      else if (addD(k, 7) <= todayKey) run = 0;
      best = Math.max(best, run);
    }
  }
  return { cur: run, best };
}

export const pct = (state: PulseHabitState, k: string): number => {
  const a = dueOn(state, k);
  return a.length ? a.filter((h) => done(state, h, k)).length / a.length : 0;
};

export interface DayProgress {
  habitsDone: number;
  habitsTotal: number;
  tasksDone: number;
  tasksTotal: number;
  done: number;
  total: number;
  pct: number;
}

export function getDayProgress(state: PulseHabitState, dayKey: string): DayProgress {
  const dueHabits = dueOn(state, dayKey);
  const habitsTotal = dueHabits.length;
  const habitsDone = dueHabits.filter((h) => done(state, h, dayKey)).length;
  const dayTasks = (state.tasks || []).filter((t) => t.dayKey === dayKey);
  const tasksTotal = dayTasks.length;
  const tasksDone = dayTasks.filter((t) => t.done).length;
  const doneCount = habitsDone + tasksDone;
  const totalCount = habitsTotal + tasksTotal;
  const progressPct = totalCount ? doneCount / totalCount : 0;
  return {
    habitsDone,
    habitsTotal,
    tasksDone,
    tasksTotal,
    done: doneCount,
    total: totalCount,
    pct: progressPct,
  };
}

export function createDailyTask(
  title: string,
  dayKey: string,
  subjectId?: string,
  now = Date.now()
): DailyTask | null {
  const cleanTitle = typeof title === 'string' ? title.trim().slice(0, 140) : '';
  const cleanDayKey = typeof dayKey === 'string' ? dayKey.trim() : '';
  if (!cleanTitle || !/^\d{4}-\d{2}-\d{2}$/.test(cleanDayKey)) return null;
  const cleanSubjectId =
    typeof subjectId === 'string' && subjectId.trim() ? subjectId.trim() : undefined;
  return {
    id: uid('tsk'),
    title: cleanTitle,
    dayKey: cleanDayKey,
    done: false,
    createdAt: now,
    ...(cleanSubjectId ? { subjectId: cleanSubjectId } : {}),
  };
}

export function moveUnfinishedTasksToToday(
  state: PulseHabitState,
  todayKey: string,
  taskId?: string
): PulseHabitState {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(todayKey)) return state;
  const currentTasks = state.tasks || [];
  let changed = false;
  const nextTasks = currentTasks.map((t) => {
    const isEligible = !t.done && t.dayKey < todayKey;
    const matchesTarget = taskId ? t.id === taskId : true;
    if (isEligible && matchesTarget) {
      changed = true;
      return { ...t, dayKey: todayKey };
    }
    return t;
  });
  if (!changed) return state;
  return {
    ...state,
    tasks: nextTasks,
  };
}

export function rate(state: PulseHabitState, h: Habit, n: number, todayKey: string): number {
  let d = 0;
  let c = 0;
  for (let i = 0; i < n; i++) {
    const k = addD(todayKey, -i);
    if (k < h.created || (h.sch === 'days' && !h.days.includes(parseKey(k).getDay()))) continue;
    if (skip(state, h, k)) continue;
    d++;
    if (done(state, h, k)) c++;
  }
  return d ? Math.round((c / d) * 100) : 0;
}

export const total = (state: PulseHabitState, h: Habit): number =>
  Object.keys(state.log[h.id] || {}).filter((k) => done(state, h, k)).length;

export function xp(state: PulseHabitState, todayKey: string): number {
  let x = state.bonus || 0;
  state.habits.forEach((h) => {
    x += total(state, h) * 20 + streak(state, h, todayKey).best * 5;
  });
  return x;
}

export const lvl = (x: number): number => Math.floor(Math.sqrt(x / 60)) + 1;

export function badges(state: PulseHabitState, todayKey: string): Array<[string, boolean]> {
  const hs = state.habits;
  const all = hs.reduce((a, h) => a + total(state, h), 0);
  const bs = Math.max(0, ...hs.map((h) => streak(state, h, todayKey).best));
  const totalStudyHrs =
    state.sessions.reduce((a, s) => a + (s.activeMs || 0), 0) / 3600000;
  let perf = 0;
  for (let i = 0; i < 60; i++) {
    const k = addD(todayKey, -i);
    if (dueOn(state, k).length >= 2 && pct(state, k) === 1) perf++;
  }
  return [
    ['🌱 First check-in', all >= 1],
    ['🔥 7-day streak', bs >= 7],
    ['🏔️ 30-day streak', bs >= 30],
    ['🎧 10h studied', totalStudyHrs >= 10],
    ['🎓 50h studied', totalStudyHrs >= 50],
    ['⭐ Perfect day', perf >= 1],
    ['💯 100 check-ins', all >= 100],
  ];
}

export interface ConsistencyDay {
  key: string;
  shortDate: string;
  dayName: string;
  monthShort: string;
  dayOfWeek: number;
  dueCount: number;
  doneCount: number;
  pct: number;
  densityLevel: 0 | 1 | 2 | 3 | 4;
  studyMs: number;
}

export interface ConsistencyCalendarSummary {
  days: ConsistencyDay[];
  weeks: Array<Array<ConsistencyDay | null>>;
  avgPct: number;
  perfectDays: number;
  activeDays: number;
}

export function computeConsistencyCalendar(
  state: PulseHabitState,
  todayKey: string,
  numDays = 90
): ConsistencyCalendarSummary {
  const days: ConsistencyDay[] = [];
  let sumPct = 0;
  let scheduledDays = 0;
  let perfectDays = 0;
  let activeDays = 0;

  for (let i = numDays - 1; i >= 0; i--) {
    const k = addD(todayKey, -i);
    const d = parseKey(k);
    const dueHabits = dueOn(state, k);
    const dueCount = dueHabits.length;
    const doneCount = dueHabits.filter((h) => done(state, h, k)).length;
    const dayPct = dueCount > 0 ? Math.round((doneCount / dueCount) * 100) : 0;
    const studyMs = getTodaySubjectMs(state, 'any', k, todayKey);

    let densityLevel: 0 | 1 | 2 | 3 | 4 = 0;
    if (dayPct >= 100 && dueCount > 0) {
      densityLevel = 4;
    } else if (dayPct >= 67) {
      densityLevel = 3;
    } else if (dayPct >= 34) {
      densityLevel = 2;
    } else if (dayPct > 0) {
      densityLevel = 1;
    }

    if (dueCount > 0) {
      sumPct += dayPct;
      scheduledDays++;
    }
    if (dueCount > 0 && doneCount === dueCount) {
      perfectDays++;
    }
    if (doneCount > 0 || studyMs > 0) {
      activeDays++;
    }

    days.push({
      key: k,
      shortDate: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      dayName: d.toLocaleDateString(undefined, { weekday: 'short' }),
      monthShort: d.toLocaleDateString(undefined, { month: 'short' }),
      dayOfWeek: d.getDay(),
      dueCount,
      doneCount,
      pct: dayPct,
      densityLevel,
      studyMs,
    });
  }

  // Build GitHub-style weekly columns (7 rows per column, aligned to week start state.set.ws)
  const ws = state.set.ws ?? 1;
  const weeks: Array<Array<ConsistencyDay | null>> = [];
  if (days.length > 0) {
    const firstDow = (days[0].dayOfWeek - ws + 7) % 7;
    let currentWeek: Array<ConsistencyDay | null> = new Array(firstDow).fill(null);
    for (const day of days) {
      currentWeek.push(day);
      if (currentWeek.length === 7) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
    }
    if (currentWeek.length > 0) {
      while (currentWeek.length < 7) {
        currentWeek.push(null);
      }
      weeks.push(currentWeek);
    }
  }

  const avgPct = scheduledDays > 0 ? Math.round(sumPct / scheduledDays) : 0;

  return {
    days,
    weeks,
    avgPct,
    perfectDays,
    activeDays,
  };
}

// ==========================================
// PART F3: CHAPTER COMPLETION & REVISION HELPERS
// ==========================================

/**
 * F3: Applies a patch to a chapter while enforcing:
 * 1. The completion date can never be saved empty (ignore an empty value and keep the previous one).
 * 2. Setting status to 'completed' sets completedOn to today's logical key when empty.
 * 3. Setting status back to 'notStarted' clears completedOn.
 */
export function applyChapterUpdate(
  chapter: Chapter,
  patch: Partial<Chapter>,
  todayKey: string,
  now = Date.now()
): Chapter {
  const nextStatus: ChapterStatus = patch.status ?? chapter.status;
  let nextCompletedOn = chapter.completedOn;

  if ('completedOn' in patch) {
    const candidate = typeof patch.completedOn === 'string' ? patch.completedOn.trim() : '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
      nextCompletedOn = candidate;
    }
    // If candidate is empty, ignore it and keep previous chapter.completedOn
  }

  if (nextStatus === 'notStarted') {
    nextCompletedOn = undefined;
  } else if (nextStatus === 'completed' && !nextCompletedOn) {
    nextCompletedOn = todayKey;
  }

  let nextConfidence = chapter.confidence;
  let nextConfidenceLog = chapter.confidenceLog ? [...chapter.confidenceLog] : [];
  if (
    patch.confidence !== undefined &&
    patch.confidence >= 1 &&
    patch.confidence <= 5
  ) {
    nextConfidence = patch.confidence;
    nextConfidenceLog = [
      ...nextConfidenceLog,
      { dayKey: todayKey, value: patch.confidence },
    ].slice(-50);
  }

  return {
    ...chapter,
    ...patch,
    status: nextStatus,
    completedOn: nextCompletedOn,
    ...(nextConfidence !== undefined ? { confidence: nextConfidence } : {}),
    ...(nextConfidenceLog.length > 0 ? { confidenceLog: nextConfidenceLog } : {}),
    updatedAt: patch.updatedAt ?? now,
  };
}

/**
 * 1.1: Returns total study milliseconds and session count linked to a chapter.
 */
export function getChapterStudyMs(
  state: PulseHabitState,
  chapterId: string
): { totalMs: number; sessionCount: number } {
  let totalMs = 0;
  let sessionCount = 0;
  for (const ses of state.sessions) {
    if (ses.chapterId === chapterId) {
      totalMs += ses.activeMs || 0;
      sessionCount += 1;
    }
  }
  return { totalMs, sessionCount };
}

/**
 * 1.1: Computes hours-per-chapter breakdown for StatsView.
 */
export function computeChapterBreakdown(state: PulseHabitState): Array<{
  chapterId: string;
  chapterName: string;
  subjectId: string;
  subjectName: string;
  subjectEmoji: string;
  color: string;
  ms: number;
  studiedMs: number;
  pct: number;
  count: number;
}> {
  const map: Record<string, { ms: number; count: number }> = {};
  let totalLinkedMs = 0;
  for (const ses of state.sessions) {
    if (!ses.chapterId) continue;
    const ms = ses.activeMs || 0;
    if (!map[ses.chapterId]) {
      map[ses.chapterId] = { ms: 0, count: 0 };
    }
    map[ses.chapterId].ms += ms;
    map[ses.chapterId].count += 1;
    totalLinkedMs += ms;
  }
  const rows: Array<{
    chapterId: string;
    chapterName: string;
    subjectId: string;
    subjectName: string;
    subjectEmoji: string;
    color: string;
    ms: number;
    studiedMs: number;
    pct: number;
    count: number;
  }> = [];
  for (const [chapterId, stat] of Object.entries(map)) {
    const ch = state.chapters.find((c) => c.id === chapterId);
    const sub = getSubject(state, ch?.subjectId || '');
    rows.push({
      chapterId,
      chapterName: ch?.name || 'Deleted Chapter',
      subjectId: ch?.subjectId || sub.id,
      subjectName: sub.name,
      subjectEmoji: sub.e,
      color: sub.color,
      ms: stat.ms,
      studiedMs: stat.ms,
      pct: totalLinkedMs > 0 ? Math.round((stat.ms / totalLinkedMs) * 100) : 0,
      count: stat.count,
    });
  }
  return rows.sort((a, b) => b.ms - a.ms);
}

/**
 * 1.5: Cumulative PYQ stats for a chapter.
 */
export function getChapterPYQStats(
  state: PulseHabitState,
  chapterId: string
): { attempted: number; correct: number; accuracyPct: number | null; entries: PYQEntry[] } {
  const entries = (state.pyq || []).filter((p) => p.chapterId === chapterId);
  let attempted = 0;
  let correct = 0;
  for (const e of entries) {
    attempted += e.attempted || 0;
    correct += e.correct || 0;
  }
  return {
    attempted,
    correct,
    accuracyPct: attempted > 0 ? Math.round((correct / attempted) * 100) : null,
    entries,
  };
}

/**
 * 2.3: Adds a tombstone ID with a timestamp so cloud sync deletions beat older edits.
 */
export function addTombstone(
  state: PulseHabitState,
  id: string,
  now = Date.now()
): PulseHabitState {
  const del = state.del.includes(id) ? state.del : [...state.del, id];
  const delAt = { ...(state.delAt || {}), [id]: now };
  return { ...state, del, delAt };
}

export function removeTombstone(
  state: PulseHabitState,
  id: string
): { del: string[]; delAt: Record<string, number> } {
  const del = (state.del || []).filter((x) => x !== id);
  const delAt = { ...(state.delAt || {}) };
  delete delAt[id];
  return { del, delAt };
}

export function pruneExpiredTombstones(
  delAt: Record<string, number> | undefined,
  now = Date.now(),
  ttlMs = 90 * 86400000
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!delAt || typeof delAt !== 'object') return out;
  const cutoff = now - ttlMs;
  for (const [id, ts] of Object.entries(delAt)) {
    if (typeof id === 'string' && id.trim() && Number.isFinite(ts) && Number(ts) >= cutoff) {
      out[id.trim()] = Number(ts);
    }
  }
  return out;
}

/**
 * F3: Adds a revision date to a chapter, blocking duplicate revision dates on the same chapter.
 */
export function addChapterRevisionDate(
  chapter: Chapter,
  date: string,
  revId?: string,
  now = Date.now()
): { chapter: Chapter; added: boolean; duplicate: boolean } {
  const cleanDate = typeof date === 'string' ? date.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
    return { chapter, added: false, duplicate: false };
  }
  if (chapter.revisions.some((r) => r.date === cleanDate)) {
    return { chapter, added: false, duplicate: true };
  }
  const nextRevs = [
    ...chapter.revisions,
    { id: revId || uid('rev'), date: cleanDate, done: false },
  ].sort((a, b) => a.date.localeCompare(b.date));
  return {
    chapter: { ...chapter, revisions: nextRevs, updatedAt: now },
    added: true,
    duplicate: false,
  };
}

/**
 * F3: Updates an existing revision date on a chapter, blocking duplicate revision dates on the same chapter.
 */
export function updateChapterRevisionDate(
  chapter: Chapter,
  revId: string,
  newDate: string,
  now = Date.now()
): { chapter: Chapter; updated: boolean; duplicate: boolean } {
  const cleanDate = typeof newDate === 'string' ? newDate.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
    return { chapter, updated: false, duplicate: false };
  }
  const target = chapter.revisions.find((r) => r.id === revId);
  if (!target) {
    return { chapter, updated: false, duplicate: false };
  }
  if (target.date === cleanDate) {
    return { chapter, updated: false, duplicate: false };
  }
  if (chapter.revisions.some((r) => r.id !== revId && r.date === cleanDate)) {
    return { chapter, updated: false, duplicate: true };
  }
  const nextRevs = chapter.revisions
    .map((r) => (r.id === revId ? { ...r, date: cleanDate } : r))
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    chapter: { ...chapter, revisions: nextRevs, updatedAt: now },
    updated: true,
    duplicate: false,
  };
}

// ==========================================
// PART F1: ITEM-LEVEL UNDO RESTORE HELPER
// ==========================================

export type DeletedEntityRecord =
  | {
      kind: 'habit';
      item: Habit;
      index: number;
      logEntries?: Record<string, HabitLogDay>;
    }
  | { kind: 'chapter'; item: Chapter; index: number }
  | { kind: 'mock'; item: MockTest; index: number }
  | { kind: 'session'; item: StudySession; index: number }
  | { kind: 'dday'; item: DDay; index: number }
  | { kind: 'subject'; item: Subject; index: number }
  | { kind: 'task'; item: DailyTask; index: number }
  | { kind: 'mistake'; item: MistakeEntry; index: number }
  | { kind: 'doubt'; item: Doubt; index: number }
  | { kind: 'pyq'; item: PYQEntry; index: number };

export function insertAtIndex<T extends { id: string }>(
  list: T[],
  item: T,
  index: number
): T[] {
  if (list.some((x) => x.id === item.id)) {
    return list.map((x) => (x.id === item.id ? item : x));
  }
  const safeIdx = Math.max(0, Math.min(list.length, index));
  return [...list.slice(0, safeIdx), item, ...list.slice(safeIdx)];
}

/**
 * F1: Restores ONLY the deleted item into `currentState` at its original position,
 * preserving all newer unrelated changes (and never reverting a running timer).
 */
export function restoreDeletedItem(
  currentState: PulseHabitState,
  record: DeletedEntityRecord,
  todayKey = logicalKey(new Date(), currentState.set.dayResetHour ?? 4)
): PulseHabitState {
  const nextLog = cloneLog(currentState.log);
  const { del, delAt } = removeTombstone(currentState, record.item.id);
  const now = Date.now();
  const restoredWithTs = { ...record.item, updatedAt: now };

  switch (record.kind) {
    case 'habit': {
      if (record.logEntries) {
        nextLog[record.item.id] = {
          ...(nextLog[record.item.id] || {}),
          ...JSON.parse(JSON.stringify(record.logEntries)),
        };
      }
      const next: PulseHabitState = {
        ...currentState,
        habits: insertAtIndex(currentState.habits, restoredWithTs as Habit, record.index),
        log: nextLog,
        del,
        delAt,
      };
      if (isAutoStudyHabit(record.item)) {
        syncStudyHabitsForDays(next, [todayKey], todayKey);
      }
      return next;
    }
    case 'chapter': {
      return {
        ...currentState,
        log: nextLog,
        del,
        delAt,
        chapters: insertAtIndex(currentState.chapters, restoredWithTs as Chapter, record.index),
      };
    }
    case 'mock': {
      return {
        ...currentState,
        log: nextLog,
        del,
        delAt,
        mocks: insertAtIndex(currentState.mocks, restoredWithTs as MockTest, record.index),
      };
    }
    case 'session': {
      const next: PulseHabitState = {
        ...currentState,
        log: nextLog,
        del,
        delAt,
        sessions: insertAtIndex(currentState.sessions, restoredWithTs as StudySession, record.index),
      };
      syncStudyHabitsForDays(next, [record.item.dayKey, todayKey], todayKey);
      return next;
    }
    case 'dday': {
      return {
        ...currentState,
        log: nextLog,
        del,
        delAt,
        ddays: insertAtIndex(currentState.ddays, restoredWithTs as DDay, record.index),
      };
    }
    case 'subject': {
      return {
        ...currentState,
        log: nextLog,
        del,
        delAt,
        subjects: insertAtIndex(currentState.subjects, restoredWithTs as Subject, record.index),
      };
    }
    case 'task': {
      return {
        ...currentState,
        log: nextLog,
        del,
        delAt,
        tasks: insertAtIndex(currentState.tasks || [], restoredWithTs as DailyTask, record.index),
      };
    }
    case 'mistake': {
      return {
        ...currentState,
        log: nextLog,
        del,
        delAt,
        mistakes: insertAtIndex(currentState.mistakes || [], restoredWithTs as MistakeEntry, record.index),
      };
    }
    case 'doubt': {
      return {
        ...currentState,
        log: nextLog,
        del,
        delAt,
        doubts: insertAtIndex(currentState.doubts || [], restoredWithTs as Doubt, record.index),
      };
    }
    case 'pyq': {
      return {
        ...currentState,
        log: nextLog,
        del,
        delAt,
        pyq: insertAtIndex(currentState.pyq || [], restoredWithTs as PYQEntry, record.index),
      };
    }
  }
}


