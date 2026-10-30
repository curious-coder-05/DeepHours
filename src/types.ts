export type HabitCategory = 'Health' | 'Mind' | 'Work' | 'Learn' | 'Social' | 'Other';
export type HabitSchedule = 'daily' | 'days' | 'week';
export type TimerMode = 'pomo' | 'countdown' | 'stopwatch' | 'manual' | 'fullMock';
export type ActiveTimerMode = 'pomo' | 'countdown' | 'stopwatch' | 'fullMock';
export type TimerPhase = 'work' | 'break';
export type SoundscapeMode = 'off' | 'brown' | 'pink' | 'rain';
export type PiPPreference = 'video' | 'doc';
export type TimerAesthetic = 'neon' | 'minimal' | 'retro';
export type AppTab = 'today' | 'prep' | 'focus' | 'stats' | 'more' | 'planner';
export type PrepSubTab = 'syllabus' | 'mocks' | 'mistakes' | 'doubts';
export type StatsSubTab = 'summary' | 'timeline' | 'review' | 'groups';
export type ChapterStatus = 'notStarted' | 'inProgress' | 'completed';
export type MistakeReason = 'concept' | 'silly' | 'time' | 'guess' | 'forgot';
export type SyncStatus =
  | 'off'
  | 'idle'
  | 'syncing'
  | 'synced'
  | 'offline'
  | 'error'
  | 'paused'
  | 'paused-quota';

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
  updatedAt?: number;
}

export interface HabitLogDay {
  v: number;
  s: number;
  t?: number;
  updatedAt?: number;
}

export type HabitLogMap = Record<string, Record<string, HabitLogDay>>;

export interface StudyTodo {
  id: string;
  text: string;
  done: boolean;
  updatedAt?: number;
}

export interface Subject {
  id: string;
  name: string;
  e: string;
  color: string;
  dailyGoalMins?: number;
  arch: number;
  todos: StudyTodo[];
  updatedAt?: number;
}

export interface StudySession {
  id: string;
  subjectId: string;
  chapterId?: string;
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
  source?: 'timer' | 'manual';
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
  primary?: boolean;
  updatedAt?: number;
}

export interface MockSectionTiming {
  name?: string;
  label?: string;
  elapsedMs: number;
}

export interface ActiveTimer {
  status: 'running' | 'paused';
  mode: ActiveTimerMode;
  phase: TimerPhase;
  subjectId: string;
  chapterId?: string;
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
  mockSections?: MockSectionTiming[];
  sectionStartTs?: number;
  sectionStartActiveMs?: number;
  sectionPausedMs?: number;
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

export interface ChapterConfidenceEntry {
  dayKey: string;
  value: 1 | 2 | 3 | 4 | 5;
}

export interface Chapter {
  id: string;
  subjectId: string;
  name: string;
  status: ChapterStatus;
  completedOn?: string;
  revisions: ChapterRevision[];
  note?: string;
  confidence?: 1 | 2 | 3 | 4 | 5;
  confidenceLog?: ChapterConfidenceEntry[];
  updatedAt?: number;
}

export interface MistakeEntry {
  id: string;
  mockId?: string;
  dayKey: string;
  subjectId: string;
  chapterId?: string;
  reason: MistakeReason;
  note?: string;
  resolved: boolean;
  createdAt: number;
  updatedAt?: number;
}

export interface Doubt {
  id: string;
  subjectId: string;
  chapterId?: string;
  text: string;
  createdAt: number;
  resolved: boolean;
  resolvedAt?: number;
  updatedAt?: number;
}

export interface PYQEntry {
  id: string;
  chapterId: string;
  dayKey: string;
  attempted: number;
  correct: number;
  updatedAt?: number;
}

export interface TargetsConfig {
  dailyMinutes?: Record<string, number>;
  weeklyMinutes?: Record<string, number>;
  minDayMinutes: number;
  restPassesPerMonth: number;
}

export type SubjectTargets = TargetsConfig;

export interface WellbeingEntry {
  sleep?: number;
  energy?: 1 | 2 | 3 | 4 | 5;
  updatedAt?: number;
}

export interface CloudAccountInfo {
  uid?: string;
  email?: string | null;
  displayName?: string | null;
  avatarEmoji?: string;
  lastSyncedAt?: number;
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
  revisionBufferDays?: number;
  targets?: TargetsConfig;
  fullMockMins?: number;
  revisionIntervals?: number[];
  revisionSuggestDays?: number[];
  burnoutDismissedUntil?: string;
  avatarEmoji?: string;
  cloudAccount?: CloudAccountInfo;
  updatedAt?: number;
}

export interface DailyTask {
  id: string;
  title: string;
  dayKey: string;
  done: boolean;
  createdAt: number;
  doneAt?: number;
  subjectId?: string;
  updatedAt?: number;
}

export interface UserProfile {
  nick: string;
  emoji: string;
  examYear?: number;
  updatedAt?: number;
}

export interface GroupWeekHistoryEntry {
  rank: number;
  of: number;
  minutes: number;
  xp: number;
}

export type GroupHistoryMap = Record<string, Record<string, GroupWeekHistoryEntry>>;

export interface GroupSharingFlags {
  t: boolean; // study time (default true)
  x: boolean; // XP & level (default true)
  s: boolean; // streak & consistency (default true)
  m: boolean; // mock scores (default false)
  l: boolean; // studying now live status (default false)
}

export interface JoinedGroupPreference {
  groupId: string;
  name?: string;
  emoji?: string;
  joinedAt: number;
  sh: GroupSharingFlags;
  paused?: boolean;
}

export interface GroupsUserConfig {
  consentAccepted: boolean;
  joined: JoinedGroupPreference[];
  activeGroupId?: string;
  updatedAt?: number;
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
  mistakes: MistakeEntry[];
  doubts: Doubt[];
  pyq: PYQEntry[];
  restDays: string[];
  wellbeing: Record<string, WellbeingEntry>;
  activeTimer: ActiveTimer | null;
  notes: Record<string, string>;
  mood: Record<string, number>;
  bonus: number;
  exp: number;
  ob: number;
  del: string[];
  delAt?: Record<string, number>;
  savedAt?: number;
  burnoutDismissedUntil?: string;
  profile: UserProfile;
  groupHistory: GroupHistoryMap;
  groupsConfig?: GroupsUserConfig;
  syncMeta?: {
    uid?: string;
    lastSyncedAt?: number;
  };
  set: AppSettings;
}

export interface TimerMetrics {
  status: 'running' | 'paused';
  mode: ActiveTimerMode;
  phase: TimerPhase;
  subject: Subject;
  chapterId?: string;
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
