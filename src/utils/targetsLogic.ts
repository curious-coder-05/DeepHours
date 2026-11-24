import type {
  Chapter,
  CustomReminder,
  DDay,
  DeadlineChecklistItem,
  DeadlineTarget,
  PulseHabitState,
  ReminderCategory,
} from '../types';
import {
  formatLocalDateKey,
  sanitizeTextControlChars,
  stripDangerousKeys,
} from './security';

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_24H_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const VALID_REMINDER_CATEGORIES: ReadonlySet<ReminderCategory> = new Set([
  'exam',
  'admin',
  'study',
  'personal',
]);

export const LEAD_DAY_OPTIONS: ReadonlyArray<{ value: number; label: string; shortLabel: string }> = [
  { value: 0, label: 'On the day', shortLabel: 'On day' },
  { value: 1, label: '1d before', shortLabel: '1d' },
  { value: 3, label: '3d before', shortLabel: '3d' },
  { value: 7, label: '7d before', shortLabel: '7d' },
];

export const REMINDER_CATEGORY_LABELS: Record<ReminderCategory, string> = {
  exam: 'Exam',
  admin: 'Admin',
  study: 'Study',
  personal: 'Personal',
};

const MONTH_SHORT_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const MONTH_LONG_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const WEEKDAY_SHORT_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function parseDateKeyParts(dateKey: string): { y: number; m: number; d: number } | null {
  if (typeof dateKey !== 'string') return null;
  const match = DATE_KEY_RE.exec(dateKey.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (y < 1970 || y > 2150 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const check = new Date(Date.UTC(y, m - 1, d));
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== m - 1 ||
    check.getUTCDate() !== d
  ) {
    return null;
  }
  return { y, m, d };
}

export function isValidDateKey(value: unknown): value is string {
  return typeof value === 'string' && parseDateKeyParts(value) !== null;
}

export function isValidTime24h(value: unknown): value is string {
  return typeof value === 'string' && TIME_24H_RE.test(value.trim());
}

/**
 * Computes signed whole-day difference (targetDate - todayDate) using pure UTC-midnight
 * arithmetic on calendar parts so DST transitions and timezones (e.g. IST +05:30) never skew results.
 */
export function computeDaysUntilDate(dateKey: string, todayKey: string): number {
  const a = parseDateKeyParts(dateKey);
  const b = parseDateKeyParts(todayKey);
  if (!a || !b) return 0;
  const utcA = Date.UTC(a.y, a.m - 1, a.d);
  const utcB = Date.UTC(b.y, b.m - 1, b.d);
  return Math.round((utcA - utcB) / 86_400_000);
}

/**
 * Adds deltaDays to a local YYYY-MM-DD key using pure calendar math (zero timezone drift).
 */
export function shiftDateKey(dateKey: string, deltaDays: number): string {
  const parts = parseDateKeyParts(dateKey);
  if (!parts) return formatLocalDateKey(new Date());
  const d = new Date(Date.UTC(parts.y, parts.m - 1, parts.d + Math.trunc(deltaDays)));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatShortDateLabel(dateKey: string, includeYear = false): string {
  const parts = parseDateKeyParts(dateKey);
  if (!parts) return dateKey;
  const base = `${parts.d} ${MONTH_SHORT_NAMES[parts.m - 1]}`;
  return includeYear ? `${base} ${parts.y}` : base;
}

export function formatFullDateLabel(dateKey: string): string {
  const parts = parseDateKeyParts(dateKey);
  if (!parts) return dateKey;
  const wd = new Date(Date.UTC(parts.y, parts.m - 1, parts.d)).getUTCDay();
  return `${WEEKDAY_SHORT_NAMES[wd]}, ${parts.d} ${MONTH_SHORT_NAMES[parts.m - 1]} ${parts.y}`;
}

export function formatMonthYearHeading(year: number, monthIndex: number): string {
  const safeIdx = ((monthIndex % 12) + 12) % 12;
  return `${MONTH_LONG_NAMES[safeIdx]} ${year}`;
}

export function formatTime12h(time24?: string): string {
  if (!time24 || !isValidTime24h(time24)) return '';
  const [hhStr, mmStr] = time24.trim().split(':');
  const hh = Number(hhStr);
  const suffix = hh >= 12 ? 'PM' : 'AM';
  const hour12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${hour12}:${mmStr} ${suffix}`;
}

export function formatDeadlineUrgency(daysUntil: number): {
  label: string;
  tone: 'overdue' | 'today' | 'soon' | 'calm';
} {
  if (daysUntil < 0) {
    const past = Math.abs(daysUntil);
    return {
      label: past === 1 ? '1d overdue' : `${past}d overdue`,
      tone: 'overdue',
    };
  }
  if (daysUntil === 0) {
    return { label: 'Due today', tone: 'today' };
  }
  if (daysUntil === 1) {
    return { label: 'Due tomorrow', tone: 'soon' };
  }
  if (daysUntil <= 3) {
    return { label: `${daysUntil}d left`, tone: 'soon' };
  }
  return { label: `${daysUntil}d left`, tone: 'calm' };
}

export interface TargetProgress {
  doneCount: number;
  totalCount: number;
  percent: number;
  isComplete: boolean;
}

export function computeTargetProgress(target: DeadlineTarget): TargetProgress {
  const items = Array.isArray(target.items) ? target.items : [];
  const totalCount = items.length;
  const doneCount = items.reduce((acc, item) => acc + (item.done ? 1 : 0), 0);
  const percent = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
  const isComplete = totalCount > 0 && doneCount === totalCount;
  return { doneCount, totalCount, percent, isComplete };
}

function makeEntityId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function sanitizeOptionalNote(raw: unknown, maxLen = 800): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const cleaned = sanitizeTextControlChars(raw, maxLen, { allowNewlines: true });
  return cleaned || undefined;
}

export function normalizeLeadDays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [0];
  const set = new Set<number>();
  for (const v of raw) {
    const n = Number(v);
    if (Number.isFinite(n)) {
      const clamped = Math.max(0, Math.min(60, Math.round(n)));
      set.add(clamped);
    }
  }
  if (set.size === 0) set.add(0);
  return Array.from(set).sort((a, b) => b - a);
}

function normalizeChecklistItems(raw: unknown): DeadlineChecklistItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: DeadlineChecklistItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = stripDangerousKeys(entry) as Record<string, unknown>;
    const text =
      typeof rec.text === 'string' ? sanitizeTextControlChars(rec.text, 200) : '';
    if (!text) continue;
    let id =
      typeof rec.id === 'string' ? sanitizeTextControlChars(rec.id, 64) : '';
    if (!id || seen.has(id)) {
      id = makeEntityId('tci');
    }
    seen.add(id);
    const done = Boolean(rec.done);
    const doneAtNum = Number(rec.doneAt);
    const item: DeadlineChecklistItem = {
      id,
      text,
      done,
    };
    if (done && Number.isFinite(doneAtNum) && doneAtNum > 0) {
      item.doneAt = Math.floor(doneAtNum);
    }
    out.push(item);
    if (out.length >= 200) break;
  }
  return out;
}

export function normalizeDeadlineTargets(raw: unknown, fallbackTodayKey?: string): DeadlineTarget[] {
  if (!Array.isArray(raw)) return [];
  const today = fallbackTodayKey && isValidDateKey(fallbackTodayKey)
    ? fallbackTodayKey
    : formatLocalDateKey(new Date());
  const seen = new Set<string>();
  const out: DeadlineTarget[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = stripDangerousKeys(entry) as Record<string, unknown>;
    const title =
      typeof rec.title === 'string' ? sanitizeTextControlChars(rec.title, 140) : '';
    if (!title) continue;

    const deadlineDate = isValidDateKey(rec.deadlineDate) ? rec.deadlineDate.trim() : '';
    if (!deadlineDate) continue;

    const startDate = isValidDateKey(rec.startDate) ? rec.startDate.trim() : today;
    let id =
      typeof rec.id === 'string' ? sanitizeTextControlChars(rec.id, 64) : '';
    if (!id || seen.has(id)) {
      id = makeEntityId('tgt');
    }
    seen.add(id);

    const subjectId =
      typeof rec.subjectId === 'string'
        ? sanitizeTextControlChars(rec.subjectId, 64) || undefined
        : undefined;
    const notes = sanitizeOptionalNote(rec.notes);
    const createdAtRaw = Number(rec.createdAt);
    const createdAt =
      Number.isFinite(createdAtRaw) && createdAtRaw > 0 ? Math.floor(createdAtRaw) : Date.now();
    const updatedAtRaw = Number(rec.updatedAt);
    const updatedAt =
      Number.isFinite(updatedAtRaw) && updatedAtRaw > 0 ? Math.floor(updatedAtRaw) : createdAt;

    const normalized: DeadlineTarget = {
      id,
      title,
      startDate,
      deadlineDate,
      items: normalizeChecklistItems(rec.items),
      archived: Boolean(rec.archived),
      createdAt,
      updatedAt,
    };
    if (subjectId) normalized.subjectId = subjectId;
    if (notes) normalized.notes = notes;
    out.push(normalized);
    if (out.length >= 200) break;
  }

  return out;
}

export function normalizeCustomReminders(raw: unknown): CustomReminder[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: CustomReminder[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = stripDangerousKeys(entry) as Record<string, unknown>;
    const title =
      typeof rec.title === 'string' ? sanitizeTextControlChars(rec.title, 140) : '';
    if (!title) continue;

    const date = isValidDateKey(rec.date) ? rec.date.trim() : '';
    if (!date) continue;

    let id =
      typeof rec.id === 'string' ? sanitizeTextControlChars(rec.id, 64) : '';
    if (!id || seen.has(id)) {
      id = makeEntityId('rem');
    }
    seen.add(id);

    const time = isValidTime24h(rec.time) ? rec.time.trim() : undefined;
    const leadDays = normalizeLeadDays(rec.leadDays);
    const catRaw = typeof rec.category === 'string' ? rec.category.trim() : 'admin';
    const category: ReminderCategory = VALID_REMINDER_CATEGORIES.has(catRaw as ReminderCategory)
      ? (catRaw as ReminderCategory)
      : 'admin';
    const notes = sanitizeOptionalNote(rec.notes);
    const createdAtRaw = Number(rec.createdAt);
    const createdAt =
      Number.isFinite(createdAtRaw) && createdAtRaw > 0 ? Math.floor(createdAtRaw) : Date.now();
    const updatedAtRaw = Number(rec.updatedAt);
    const updatedAt =
      Number.isFinite(updatedAtRaw) && updatedAtRaw > 0 ? Math.floor(updatedAtRaw) : createdAt;

    const normalized: CustomReminder = {
      id,
      title,
      date,
      leadDays,
      category,
      done: Boolean(rec.done),
      createdAt,
      updatedAt,
    };
    if (time) normalized.time = time;
    if (notes) normalized.notes = notes;
    out.push(normalized);
    if (out.length >= 300) break;
  }

  return out;
}

/**
 * Safely attaches defensively-normalized deadlineTargets and reminders onto a PulseHabitState
 * right after studyLogic.norm(), preserving legacy compatibility without touching studyLogic.ts.
 */
export function attachNormalizedTargetsAndReminders(
  state: PulseHabitState,
  rawSource: unknown,
  fallbackTodayKey?: string
): PulseHabitState {
  const src =
    rawSource && typeof rawSource === 'object' && !Array.isArray(rawSource)
      ? (rawSource as Record<string, unknown>)
      : {};
  const rawTargets = Array.isArray(src.deadlineTargets)
    ? src.deadlineTargets
    : Array.isArray(state.deadlineTargets)
      ? state.deadlineTargets
      : [];
  const rawReminders = Array.isArray(src.reminders)
    ? src.reminders
    : Array.isArray(state.reminders)
      ? state.reminders
      : [];

  return {
    ...state,
    deadlineTargets: normalizeDeadlineTargets(rawTargets, fallbackTodayKey),
    reminders: normalizeCustomReminders(rawReminders),
  };
}

export function createDeadlineTarget(input: {
  title: string;
  startDate: string;
  deadlineDate: string;
  subjectId?: string;
  notes?: string;
  itemTexts?: string[];
  now?: number;
}): DeadlineTarget {
  const now = input.now ?? Date.now();
  const title = sanitizeTextControlChars(input.title, 140);
  const items: DeadlineChecklistItem[] = (input.itemTexts || [])
    .map((t) => sanitizeTextControlChars(t, 200))
    .filter(Boolean)
    .map((text, idx) => ({
      id: `tci_${now.toString(36)}_${idx}_${Math.random().toString(36).slice(2, 5)}`,
      text,
      done: false,
    }));

  const target: DeadlineTarget = {
    id: makeEntityId('tgt'),
    title,
    startDate: isValidDateKey(input.startDate) ? input.startDate : formatLocalDateKey(new Date(now)),
    deadlineDate: isValidDateKey(input.deadlineDate)
      ? input.deadlineDate
      : formatLocalDateKey(new Date(now)),
    items,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  const cleanSubject = input.subjectId?.trim();
  if (cleanSubject) target.subjectId = cleanSubject;
  const cleanNotes = sanitizeOptionalNote(input.notes);
  if (cleanNotes) target.notes = cleanNotes;
  return target;
}

export function createCustomReminder(input: {
  title: string;
  date: string;
  time?: string;
  leadDays?: number[];
  category?: ReminderCategory;
  notes?: string;
  now?: number;
}): CustomReminder {
  const now = input.now ?? Date.now();
  const title = sanitizeTextControlChars(input.title, 140);
  const category: ReminderCategory =
    input.category && VALID_REMINDER_CATEGORIES.has(input.category) ? input.category : 'admin';

  const reminder: CustomReminder = {
    id: makeEntityId('rem'),
    title,
    date: isValidDateKey(input.date) ? input.date : formatLocalDateKey(new Date(now)),
    leadDays: normalizeLeadDays(input.leadDays ?? [0, 1, 3]),
    category,
    done: false,
    createdAt: now,
    updatedAt: now,
  };
  if (input.time && isValidTime24h(input.time)) {
    reminder.time = input.time.trim();
  }
  const cleanNotes = sanitizeOptionalNote(input.notes);
  if (cleanNotes) reminder.notes = cleanNotes;
  return reminder;
}

export type UpcomingAlertKind = 'target' | 'reminder' | 'exam' | 'revision';

export interface UpcomingAlert {
  id: string;
  kind: UpcomingAlertKind;
  sourceId: string;
  title: string;
  date: string;
  time?: string;
  daysUntil: number;
  /** True when a custom reminder's selected lead-alert window matches today (e.g. 3d before). */
  isLeadAlertActive: boolean;
  leadNotice?: string;
  subjectId?: string;
  category?: ReminderCategory;
  target?: DeadlineTarget;
  reminder?: CustomReminder;
  exam?: DDay;
  chapter?: Chapter;
}

export function formatAlertCountdownPrefix(daysUntil: number): string {
  if (daysUntil < 0) {
    const past = Math.abs(daysUntil);
    return past === 1 ? '1d overdue' : `${past}d overdue`;
  }
  if (daysUntil === 0) return 'Today';
  if (daysUntil === 1) return 'Tomorrow';
  return `In ${daysUntil} days`;
}

/**
 * Returns a sorted, unified list of upcoming items across active Deadline Targets,
 * Custom Reminders (respecting lead-alert windows), Exam D-Days, and Spaced Revisions due.
 */
export function getUpcomingAlerts(
  state: Pick<PulseHabitState, 'deadlineTargets' | 'reminders' | 'ddays' | 'chapters'>,
  todayKey: string,
  windowDays = 7
): UpcomingAlert[] {
  const alerts: UpcomingAlert[] = [];

  for (const target of state.deadlineTargets || []) {
    if (target.archived) continue;
    const progress = computeTargetProgress(target);
    if (progress.isComplete) continue;
    const daysUntil = computeDaysUntilDate(target.deadlineDate, todayKey);
    if (daysUntil <= windowDays) {
      alerts.push({
        id: `alert_target_${target.id}`,
        kind: 'target',
        sourceId: target.id,
        title: target.title,
        date: target.deadlineDate,
        daysUntil,
        isLeadAlertActive: daysUntil <= 1,
        leadNotice: `${formatAlertCountdownPrefix(daysUntil)} · ${target.title}`,
        subjectId: target.subjectId,
        target,
      });
    }
  }

  for (const rem of state.reminders || []) {
    if (rem.done) continue;
    const daysUntil = computeDaysUntilDate(rem.date, todayKey);
    const maxLead = rem.leadDays.length > 0 ? Math.max(...rem.leadDays) : 0;
    const withinLead = daysUntil >= 0 && daysUntil <= maxLead;
    const isExactLeadTrigger = rem.leadDays.includes(daysUntil);
    const withinWindow = daysUntil <= Math.max(windowDays, maxLead);

    if (withinWindow) {
      const prefix = formatAlertCountdownPrefix(daysUntil);
      const timeSuffix = rem.time ? ` · ${formatTime12h(rem.time)}` : '';
      alerts.push({
        id: `alert_rem_${rem.id}`,
        kind: 'reminder',
        sourceId: rem.id,
        title: rem.title,
        date: rem.date,
        time: rem.time,
        daysUntil,
        isLeadAlertActive: daysUntil <= 0 || isExactLeadTrigger || withinLead,
        leadNotice: `${prefix}${timeSuffix} · ${rem.title}`,
        category: rem.category,
        reminder: rem,
      });
    }
  }

  for (const exam of state.ddays || []) {
    if (!isValidDateKey(exam.date)) continue;
    const daysUntil = computeDaysUntilDate(exam.date, todayKey);
    if (daysUntil >= 0 && daysUntil <= Math.max(windowDays, 14)) {
      alerts.push({
        id: `alert_exam_${exam.id}`,
        kind: 'exam',
        sourceId: exam.id,
        title: exam.title,
        date: exam.date,
        daysUntil,
        isLeadAlertActive: daysUntil <= 7,
        leadNotice: `${formatAlertCountdownPrefix(daysUntil)} · ${exam.title}`,
        exam,
      });
    }
  }

  for (const chapter of state.chapters || []) {
    const pendingRevs = (chapter.revisions || [])
      .filter((r) => !r.done && isValidDateKey(r.date))
      .sort((a, b) => a.date.localeCompare(b.date));
    const nextRev = pendingRevs[0];
    if (!nextRev) continue;
    const daysUntil = computeDaysUntilDate(nextRev.date, todayKey);
    if (daysUntil <= Math.min(windowDays, 3)) {
      alerts.push({
        id: `alert_rev_${chapter.id}_${nextRev.id}`,
        kind: 'revision',
        sourceId: chapter.id,
        title: chapter.name,
        date: nextRev.date,
        daysUntil,
        isLeadAlertActive: daysUntil <= 0,
        leadNotice: `${formatAlertCountdownPrefix(daysUntil)} · Revise ${chapter.name}`,
        subjectId: chapter.subjectId,
        chapter,
      });
    }
  }

  const kindPriority: Record<UpcomingAlertKind, number> = {
    reminder: 0,
    target: 1,
    exam: 2,
    revision: 3,
  };

  return alerts.sort((a, b) => {
    if (a.daysUntil !== b.daysUntil) return a.daysUntil - b.daysUntil;
    if (kindPriority[a.kind] !== kindPriority[b.kind]) {
      return kindPriority[a.kind] - kindPriority[b.kind];
    }
    return a.title.localeCompare(b.title);
  });
}

export interface CalendarLeadAlertRef {
  reminder: CustomReminder;
  leadDaysBefore: number;
}

export interface CalendarDayBucket {
  dateKey: string;
  targets: DeadlineTarget[];
  reminders: CustomReminder[];
  exams: DDay[];
  revisions: Chapter[];
  leadAlerts: CalendarLeadAlertRef[];
}

export function createEmptyDayBucket(dateKey: string): CalendarDayBucket {
  return {
    dateKey,
    targets: [],
    reminders: [],
    exams: [],
    revisions: [],
    leadAlerts: [],
  };
}

/**
 * Indexes all Target Deadlines, Custom Reminders (plus their lead-alert days), Exam D-Days,
 * and Spaced Revisions due within a specific calendar month (year, 0-based monthIndex).
 */
export function buildMonthlyCalendarIndex(
  state: Pick<PulseHabitState, 'deadlineTargets' | 'reminders' | 'ddays' | 'chapters'>,
  year: number,
  monthIndex: number
): Record<string, CalendarDayBucket> {
  const index: Record<string, CalendarDayBucket> = {};
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const monthPrefix = `${year}-${String(monthIndex + 1).padStart(2, '0')}-`;

  for (let d = 1; d <= daysInMonth; d++) {
    const dk = `${monthPrefix}${String(d).padStart(2, '0')}`;
    index[dk] = createEmptyDayBucket(dk);
  }

  for (const target of state.deadlineTargets || []) {
    if (target.archived) continue;
    const bucket = index[target.deadlineDate];
    if (bucket) {
      bucket.targets.push(target);
    }
  }

  for (const rem of state.reminders || []) {
    const bucket = index[rem.date];
    if (bucket) {
      bucket.reminders.push(rem);
    }
    if (!rem.done) {
      for (const lead of rem.leadDays || []) {
        if (lead > 0) {
          const alertDate = shiftDateKey(rem.date, -lead);
          const alertBucket = index[alertDate];
          if (alertBucket) {
            alertBucket.leadAlerts.push({ reminder: rem, leadDaysBefore: lead });
          }
        }
      }
    }
  }

  for (const exam of state.ddays || []) {
    if (!isValidDateKey(exam.date)) continue;
    const bucket = index[exam.date];
    if (bucket) {
      bucket.exams.push(exam);
    }
  }

  for (const ch of state.chapters || []) {
    const addedDates = new Set<string>();
    for (const rev of ch.revisions || []) {
      if (rev.done || !isValidDateKey(rev.date) || addedDates.has(rev.date)) continue;
      const bucket = index[rev.date];
      if (bucket) {
        addedDates.add(rev.date);
        bucket.revisions.push(ch);
      }
    }
  }

  return index;
}

export interface CalendarGridCell {
  dateKey: string;
  dayNumber: number;
  inCurrentMonth: boolean;
}

/**
 * Generates a 7-column (Sunday–Saturday) monthly grid covering the requested month.
 */
export function buildMonthGridCells(year: number, monthIndex: number): CalendarGridCell[] {
  const firstWeekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const prevMonthDays = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();

  const prevYear = monthIndex === 0 ? year - 1 : year;
  const prevMonth = monthIndex === 0 ? 11 : monthIndex - 1;
  const nextYear = monthIndex === 11 ? year + 1 : year;
  const nextMonth = monthIndex === 11 ? 0 : monthIndex + 1;

  const cells: CalendarGridCell[] = [];

  for (let i = firstWeekday - 1; i >= 0; i--) {
    const day = prevMonthDays - i;
    const dk = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    cells.push({ dateKey: dk, dayNumber: day, inCurrentMonth: false });
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dk = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ dateKey: dk, dayNumber: d, inCurrentMonth: true });
  }

  const trailingCount = (7 - (cells.length % 7)) % 7;
  for (let d = 1; d <= trailingCount; d++) {
    const dk = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ dateKey: dk, dayNumber: d, inCurrentMonth: false });
  }

  return cells;
}

export function formatLeadDaysSummary(leadDays: number[]): string {
  const normalized = normalizeLeadDays(leadDays);
  return normalized
    .map((d) => (d === 0 ? 'On day' : `${d}d before`))
    .join(' · ');
}
