import type {
  ActiveTimer,
  DDay,
  Habit,
  HabitCategory,
  PulseHabitState,
  StudySession,
  Subject,
  TimerMetrics,
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
export const ACS = ['#6366f1', '#10b981', '#8b7bff', '#ff7eb6', '#fbbf24', '#38bdf8'];
export const SUB_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#3b82f6', '#a855f7', '#14b8a6', '#f97316'];

export const STARTERS: Array<Partial<Habit> & { name: string; e: string; c: HabitCategory }> = [
  { name: 'Deep Study (2 hrs)', e: '📚', c: 'Learn', tn: 120, tu: 'min', subjectId: 'any', autoMins: 120 },
  { name: 'Drink water', e: '💧', c: 'Health', tn: 8, tu: 'glasses' },
  { name: 'Coding Practice', e: '💻', c: 'Work', tn: 90, tu: 'min', subjectId: 'sub_code', autoMins: 90 },
  { name: 'Exercise', e: '🏋️', c: 'Health', sch: 'week', n: 3 },
  { name: 'Review Lecture Notes', e: '📝', c: 'Learn' },
];

export const DEFAULT_SUBJECTS: Subject[] = [
  {
    id: 'sub_code',
    name: 'Coding & CS',
    e: '💻',
    color: '#6366f1',
    dailyGoalMins: 180,
    arch: 0,
    todos: [
      { id: 'td_1', text: 'Implement Floating PiP Hook', done: true },
      { id: 'td_2', text: 'Practice Graph DP problems', done: false },
    ],
  },
  {
    id: 'sub_math',
    name: 'Mathematics',
    e: '📐',
    color: '#10b981',
    dailyGoalMins: 120,
    arch: 0,
    todos: [{ id: 'td_3', text: 'Solve 10 practice problems', done: false }],
  },
  {
    id: 'sub_lec',
    name: 'Video Lectures',
    e: '🎧',
    color: '#f59e0b',
    dailyGoalMins: 90,
    arch: 0,
    todos: [],
  },
  {
    id: 'sub_read',
    name: 'Reading & Papers',
    e: '📖',
    color: '#ec4899',
    dailyGoalMins: 60,
    arch: 0,
    todos: [],
  },
];

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
  return new Date(a, b - 1, c);
}

export function addD(k: string, n: number): string {
  const d = parseKey(k);
  d.setDate(d.getDate() + n);
  return keyFromDate(d);
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

export function fmtClockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function createBlankState(nowDate = new Date()): PulseHabitState {
  const curKey = logicalKey(nowDate, 4);
  return {
    habits: [],
    log: {},
    subjects: JSON.parse(JSON.stringify(DEFAULT_SUBJECTS)),
    sessions: [],
    plans: {},
    ddays: [
      {
        id: 'dd_1',
        title: 'Final Systems Exam',
        date: addD(curKey, 24),
        e: '🎓',
        color: '#10b981',
      },
    ],
    activeTimer: null,
    notes: {},
    mood: {},
    bonus: 0,
    exp: 0,
    ob: 0,
    del: [],
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
      pipPref: 'video',
      soundscape: 'off',
      soundVol: 0.35,
    },
  };
}

export function createDefaultState(nowDate = new Date()): PulseHabitState {
  const curKey = logicalKey(nowDate, 4);
  const [yr, mo, dy] = curKey.split('-').map(Number);
  const morningStartTs = new Date(yr, mo - 1, dy, 9, 0, 0).getTime();
  const morningEndTs = morningStartTs + 5400000; // 10:30 AM (90m wall clock, 85m active, 5m paused)
  const yestKey = addD(curKey, -1);
  const twoDaysAgoKey = addD(curKey, -2);

  return {
    habits: [
      {
        id: 'h_1',
        name: 'Study 3 hours of Coding',
        e: '💻',
        c: 'Work',
        sch: 'daily',
        days: [0, 1, 2, 3, 4, 5, 6],
        n: 3,
        tn: 180,
        tu: 'min',
        rem: '09:00',
        arch: 0,
        created: addD(curKey, -21),
        subjectId: 'sub_code',
        autoMins: 180,
      },
      {
        id: 'h_2',
        name: 'Drink water',
        e: '💧',
        c: 'Health',
        sch: 'daily',
        days: [0, 1, 2, 3, 4, 5, 6],
        n: 3,
        tn: 8,
        tu: 'glasses',
        rem: '',
        arch: 0,
        created: addD(curKey, -14),
      },
      {
        id: 'h_3',
        name: 'Review Lecture Notes',
        e: '📝',
        c: 'Learn',
        sch: 'daily',
        days: [0, 1, 2, 3, 4, 5, 6],
        n: 3,
        tn: 1,
        tu: '',
        rem: '',
        arch: 0,
        created: addD(curKey, -10),
      },
    ],
    log: {
      h_1: {
        [twoDaysAgoKey]: { v: 180, s: 0 },
        [yestKey]: { v: 195, s: 0 },
        [curKey]: { v: 85, s: 0 },
      },
      h_2: {
        [twoDaysAgoKey]: { v: 8, s: 0 },
        [yestKey]: { v: 8, s: 0 },
        [curKey]: { v: 5, s: 0 },
      },
      h_3: {
        [twoDaysAgoKey]: { v: 1, s: 0 },
        [yestKey]: { v: 1, s: 0 },
        [curKey]: { v: 1, s: 0 },
      },
    },
    subjects: JSON.parse(JSON.stringify(DEFAULT_SUBJECTS)),
    sessions: [
      {
        id: 'ses_prev2',
        subjectId: 'sub_math',
        dayKey: twoDaysAgoKey,
        startTs: morningStartTs - 2 * 86400000 + 5 * 3600000,
        endTs: morningStartTs - 2 * 86400000 + 7 * 3600000,
        activeMs: 7200000,
        pausedMs: 0,
        pauseCount: 0,
        overtimeMs: 900000,
        purity: 100,
        mode: 'countdown',
        rating: 5,
        note: 'Linear algebra problem set and eigenvalues.',
        updatedAt: morningStartTs - 2 * 86400000 + 7 * 3600000,
      },
      {
        id: 'ses_prev1',
        subjectId: 'sub_code',
        dayKey: yestKey,
        startTs: morningStartTs - 86400000 + 2 * 3600000,
        endTs: morningStartTs - 86400000 + 5.25 * 3600000,
        activeMs: 11700000,
        pausedMs: 0,
        pauseCount: 0,
        overtimeMs: 1200000,
        purity: 98,
        mode: 'pomo',
        rating: 5,
        note: 'Dynamic programming & graph shortest paths.',
        updatedAt: morningStartTs - 86400000 + 5.25 * 3600000,
      },
      {
        id: 'ses_m2k9x',
        subjectId: 'sub_code',
        dayKey: curKey,
        startTs: morningStartTs,
        endTs: morningEndTs,
        activeMs: 5100000,
        pausedMs: 300000,
        pauseCount: 1,
        overtimeMs: 600000,
        purity: 94,
        mode: 'pomo',
        rating: 5,
        note: 'Finished lecture 7 and implemented tree traversal.',
        updatedAt: morningEndTs,
      },
    ],
    plans: {
      [curKey]: {
        '54': 'sub_code',
        '55': 'sub_code',
        '56': 'sub_code',
        '57': 'sub_code',
        '58': 'sub_code',
        '59': 'sub_code',
        '66': 'sub_math',
        '67': 'sub_math',
        '68': 'sub_math',
      },
    },
    ddays: [
      {
        id: 'dd_1',
        title: 'Final Systems Exam',
        date: addD(curKey, 24),
        e: '🎓',
        color: '#10b981',
      },
    ],
    activeTimer: null,
    notes: { [curKey]: 'Great flow state in the morning.' },
    mood: { [curKey]: 5 },
    bonus: 45,
    exp: 0,
    ob: 1,
    del: [],
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
      pipPref: 'video',
      soundscape: 'off',
      soundVol: 0.35,
    },
  };
}

export function mkHabit(o: Partial<Habit>, todayKey: string): Habit {
  return {
    id: 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    name: '',
    e: '✨',
    c: 'Other',
    sch: 'daily',
    days: [0, 1, 2, 3, 4, 5, 6],
    n: 3,
    tn: 1,
    tu: '',
    rem: '',
    arch: 0,
    subjectId: '',
    autoMins: 0,
    created: todayKey,
    ...o,
  };
}

export function norm(raw: unknown, nowDate = new Date()): PulseHabitState {
  const isEmptyBoot = raw === null || raw === undefined;
  const d = isEmptyBoot ? createDefaultState(nowDate) : createBlankState(nowDate);
  const s = Object.assign(d, raw && typeof raw === 'object' ? raw : {}) as PulseHabitState;
  s.set = Object.assign(createBlankState(nowDate).set, s.set || {});
  if (!Array.isArray(s.habits)) s.habits = [];
  if (!s.log || typeof s.log !== 'object') s.log = {};
  if (!Array.isArray(s.subjects) || !s.subjects.length) {
    s.subjects = JSON.parse(JSON.stringify(DEFAULT_SUBJECTS));
  }
  s.subjects.forEach((sub) => {
    if (!Array.isArray(sub.todos)) sub.todos = [];
  });
  if (!Array.isArray(s.sessions)) s.sessions = [];
  if (!s.plans || typeof s.plans !== 'object') s.plans = {};
  if (!Array.isArray(s.ddays)) s.ddays = [];
  if (!s.notes || typeof s.notes !== 'object') s.notes = {};
  if (!s.mood || typeof s.mood !== 'object') s.mood = {};
  if (!Array.isArray(s.del)) s.del = [];
  return s;
}

export function getSubject(state: PulseHabitState, id?: string): Subject {
  return (
    state.subjects.find((x) => x.id === id) ||
    state.subjects[0] ||
    DEFAULT_SUBJECTS[0]
  );
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

  return {
    status: t.status,
    mode: t.mode,
    phase: t.phase || 'work',
    subject: getSubject(state, t.subjectId),
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
  todayKey: string,
  now = Date.now()
): number {
  let ms = state.sessions
    .filter((s) => s.dayKey === dayKey && (subId === 'any' || s.subjectId === subId))
    .reduce((acc, s) => acc + (s.activeMs || 0), 0);

  if (state.activeTimer && dayKey === todayKey) {
    const m = getTimerMetrics(state, now);
    if (m && m.phase !== 'break' && (subId === 'any' || state.activeTimer.subjectId === subId)) {
      ms += m.sliceActiveMs;
    }
  }
  return ms;
}

export function syncStudyHabitsInPlace(
  state: PulseHabitState,
  dayKey: string,
  todayKey: string,
  now = Date.now()
): boolean {
  let changed = false;
  state.habits.forEach((h) => {
    if (!h.subjectId) return;
    const mins = Math.floor(getTodaySubjectMs(state, h.subjectId, dayKey, todayKey, now) / 60000);
    const L = (state.log[h.id] ??= {});
    const prev = L[dayKey]?.v || 0;
    if (mins !== prev) {
      L[dayKey] = { v: mins, s: L[dayKey]?.s || 0 };
      changed = true;
    }
  });
  return changed;
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

export function mergeStates(a: PulseHabitState, b: PulseHabitState): PulseHabitState {
  const m = norm(JSON.parse(JSON.stringify(b)));
  const D = new Set([...(a.del || []), ...(m.del || [])]);
  m.del = [...D];
  a.habits.forEach((h) => {
    if (!m.habits.some((x) => x.id === h.id)) m.habits.push(h);
  });
  m.habits = m.habits
    .filter((h) => !D.has(h.id))
    .map((r) => {
      const l = a.habits.find((x) => x.id === r.id);
      return l && (l.u || 0) > (r.u || 0) ? l : r;
    });
  (a.subjects || []).forEach((s) => {
    if (!m.subjects.some((x) => x.id === s.id)) m.subjects.push(s);
  });
  (a.sessions || []).forEach((s) => {
    if (!m.sessions.some((x) => x.id === s.id)) m.sessions.push(s);
  });
  for (const id in a.log) {
    if (D.has(id)) continue;
    const L = (m.log[id] ??= {});
    for (const k in a.log[id]) {
      const x = a.log[id][k];
      const y = L[k];
      if (!y || x.v >= y.v) L[k] = x;
    }
  }
  return m;
}
