export type HabitCategory = 'Health' | 'Mind' | 'Work' | 'Learn' | 'Social' | 'Other';
export type HabitSchedule = 'daily' | 'days' | 'week';
export type TimerMode = 'pomo' | 'countdown' | 'stopwatch' | 'manual';
export type ActiveTimerMode = 'pomo' | 'countdown' | 'stopwatch';
export type TimerPhase = 'work' | 'break';
export type SoundscapeMode = 'off' | 'brown' | 'pink' | 'rain';
export type PiPPreference = 'video' | 'doc';
export type TimerAesthetic = 'neon' | 'minimal' | 'retro';
export type AppTab = 'today' | 'prep' | 'focus' | 'stats' | 'more' | 'planner';
export type PrepSubTab = 'syllabus' | 'mocks';
export type StatsSubTab = 'summary' | 'timeline';
export type ChapterStatus = 'notStarted' | 'inProgress' | 'completed';

export interface Habit {
  id: string;
  name: string;
  e: string;
  c: HabitCategory;
  sch: HabitSchedule;
  days: number[];
  n: number;
  tn: number;
  tu: string;
  rem: string;
  arch: number;
  created: string;
  subjectId?: string;
  autoMins?: number;
  u?: number;
}

export interface HabitLogDay {
  v: number;
  s: number;
}

export type HabitLogMap = Record<string, Record<string, HabitLogDay>>;

export interface StudyTodo {
  id: string;
  text: string;
  done: boolean;
}

export interface Subject {
  id: string;
  name: string;
  e: string;
  color: string;
  dailyGoalMins?: number;
  arch: number;
  todos: StudyTodo[];
}

export interface StudySession {
  id: string;
  subjectId: string;
  heading?: string;
  dayKey: string;
  startTs: number;
  endTs: number;
  activeMs: number;
  pausedMs: number;
  pauseCount: number;
  overtimeMs: number;
  purity: number;
  mode: TimerMode;
  rating: number;
  note: string;
  updatedAt: number;
}

export type DayPlanSlots = Record<string, string>;
export type PlansMap = Record<string, DayPlanSlots>;

export interface DDay {
  id: string;
  title: string;
  date: string;
  e: string;
  color: string;
}

export interface ActiveTimer {
  status: 'running' | 'paused';
  mode: ActiveTimerMode;
  phase: TimerPhase;
  subjectId: string;
  heading?: string;
  startTs: number;
  sliceStartTs: number;
  pauseStartTs: number | null;
  pausedDurationMs: number;
  slicePausedMs: number;
  pauseCount: number;
  slicePauseCount: number;
  targetMs: number;
  chimeFired: boolean;
  fiveMinWarnFired?: boolean;
}

export interface MockSubjectScore {
  correct: number;
  wrong: number;
  unattempted: number;
}

export interface MockTest {
  id: string;
  name: string;
  dayKey: string;
  durationMins?: number;
  subjects: Record<string, MockSubjectScore>;
  marksPerCorrect: number;
  marksPerWrong: number;
  maxMarks: number;
  note: string;
  updatedAt: number;
}

export interface ChapterRevision {
  id: string;
  date: string;
  done: boolean;
  doneOn?: string;
}

export interface Chapter {
  id: string;
  subjectId: string;
  name: string;
  status: ChapterStatus;
  completedOn?: string;
  revisions: ChapterRevision[];
  note?: string;
}

export interface AppSettings {
  theme: 'auto' | 'dark' | 'light';
  ac: string;
  snd: number;
  ws: number;
  notif: number;
  dayResetHour: number;
  pomoWork: number;
  pomoBreak: number;
  countdownMins: number;
  defaultMode?: ActiveTimerMode;
  pipPref: PiPPreference;
  timerAesthetic?: TimerAesthetic;
  soundscape: SoundscapeMode;
  soundVol: number;
  targetMockScore?: number;
}

export interface DailyTask {
  id: string;
  title: string;
  dayKey: string;
  done: boolean;
  createdAt: number;
  doneAt?: number;
  subjectId?: string;
}

export interface PulseHabitState {
  habits: Habit[];
  log: HabitLogMap;
  subjects: Subject[];
  todos?: StudyTodo[];
  tasks: DailyTask[];
  sessions: StudySession[];
  plans: PlansMap;
  ddays: DDay[];
  mocks: MockTest[];
  chapters: Chapter[];
  activeTimer: ActiveTimer | null;
  notes: Record<string, string>;
  mood: Record<string, number>;
  bonus: number;
  exp: number;
  ob: number;
  del: string[];
  savedAt?: number;
  set: AppSettings;
}

export interface TimerMetrics {
  status: 'running' | 'paused';
  mode: ActiveTimerMode;
  phase: TimerPhase;
  subject: Subject;
  heading: string;
  totalActiveMs: number;
  totalPausedMs: number;
  sliceActiveMs: number;
  slicePausedMs: number;
  displayMs: number;
  overtimeMs: number;
  progressPct: number;
  purity: number;
  pauseCount: number;
}
