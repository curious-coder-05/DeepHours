import type { Chapter, CustomReminder, DDay, DeadlineTarget, PulseHabitState } from '../types';
import {
  computeDaysUntilDate,
  isValidDateKey,
  isValidTime24h,
  normalizeLeadDays,
  shiftDateKey,
} from './targetsLogic';

export interface CalendarEventInput {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD (local date)
  time?: string; // optional HH:MM (24h)
  durationMins?: number; // default 30 when timed
  description?: string;
  leadDays?: number[]; // e.g. [3, 1, 0]
  category?: string;
}

const CRLF = '\r\n';
const MAX_LINE_OCTETS = 75;

/**
 * Escapes RFC-5545 TEXT values (\, ;, ,, and line breaks).
 */
export function escapeIcsText(raw: string): string {
  return String(raw || '')
    .replace(/\r\n|\r|\n/g, '\n')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * Folds a single ICS content line at <= 75 UTF-8 octets per RFC-5545 §3.1,
 * never splitting multi-byte UTF-8 code points across folded lines.
 */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= MAX_LINE_OCTETS) {
    return line;
  }

  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;
  let limit = MAX_LINE_OCTETS;

  for (const ch of line) {
    const chBytes = encoder.encode(ch).length;
    if (currentBytes + chBytes > limit && current.length > 0) {
      chunks.push(current);
      current = ch;
      currentBytes = chBytes;
      // Continuation lines start with a single SPACE octet (1 byte)
      limit = MAX_LINE_OCTETS - 1;
    } else {
      current += ch;
      currentBytes += chBytes;
    }
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks.join(`${CRLF} `);
}

function formatIcsDateCompact(dateKey: string): string {
  return dateKey.replace(/-/g, '');
}

function formatIcsUtcStamp(now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  const ss = String(now.getUTCSeconds()).padStart(2, '0');
  return `${y}${m}${d}T${hh}${mm}${ss}Z`;
}

function formatTimedStartAndEnd(
  dateKey: string,
  time24: string,
  durationMins = 30
): { dtStart: string; dtEnd: string } {
  const [hhStr, mmStr] = time24.trim().split(':');
  const startTotalMins = Number(hhStr) * 60 + Number(mmStr);
  const safeDuration = Math.max(15, Math.min(240, Math.round(durationMins)));
  const endTotalMins = startTotalMins + safeDuration;

  const extraDays = Math.floor(endTotalMins / 1440);
  const endMinsInDay = endTotalMins % 1440;
  const endHh = String(Math.floor(endMinsInDay / 60)).padStart(2, '0');
  const endMm = String(endMinsInDay % 60).padStart(2, '0');

  const startDateCompact = formatIcsDateCompact(dateKey);
  const endDateKey = extraDays > 0 ? shiftDateKey(dateKey, extraDays) : dateKey;
  const endDateCompact = formatIcsDateCompact(endDateKey);

  return {
    dtStart: `${startDateCompact}T${hhStr}${mmStr}00`,
    dtEnd: `${endDateCompact}T${endHh}${endMm}00`,
  };
}

function buildValarmLines(
  title: string,
  leadDays: number[],
  isAllDay: boolean
): string[] {
  const lines: string[] = [];
  const offsets = normalizeLeadDays(leadDays);

  for (const offset of offsets) {
    // For all-day events starting at 00:00 local, offset=0 fires at 09:00 (+PT9H),
    // while lead offsets > 0 fire at 09:00 on the lead day (-P{offset}D + 9h = -P{offset-1}DT15H or standard -P{offset}D).
    // Standard RFC-5545 TRIGGER values (-P{d}D / PT0M / PT9H) are universally supported by Google Calendar & Apple Calendar.
    let trigger: string;
    let label: string;
    if (offset === 0) {
      trigger = isAllDay ? 'PT9H' : 'PT0M';
      label = `${title} (Today)`;
    } else {
      trigger = `-P${offset}D`;
      label = `${title} (in ${offset} ${offset === 1 ? 'day' : 'days'})`;
    }

    lines.push('BEGIN:VALARM');
    lines.push('ACTION:DISPLAY');
    lines.push(`DESCRIPTION:${escapeIcsText(label)}`);
    lines.push(`TRIGGER:${trigger}`);
    lines.push('END:VALARM');
  }

  return lines;
}

/**
 * Generates an RFC-5545 VEVENT block (without VCALENDAR wrapper).
 */
export function buildIcsEvent(input: CalendarEventInput, now = new Date()): string {
  const safeId = String(input.id || 'event')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 64) || 'event';
  const uid = `dh-${safeId}@deephours.app`;
  const dtStamp = formatIcsUtcStamp(now);
  const summary = escapeIcsText(input.title || 'Deep Hours Event');
  const hasValidTime = Boolean(input.time && isValidTime24h(input.time));

  const lines: string[] = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
  ];

  if (hasValidTime && input.time) {
    const { dtStart, dtEnd } = formatTimedStartAndEnd(
      input.date,
      input.time,
      input.durationMins ?? 30
    );
    lines.push(`DTSTART:${dtStart}`);
    lines.push(`DTEND:${dtEnd}`);
  } else {
    const startCompact = formatIcsDateCompact(input.date);
    const nextDayCompact = formatIcsDateCompact(shiftDateKey(input.date, 1));
    lines.push(`DTSTART;VALUE=DATE:${startCompact}`);
    lines.push(`DTEND;VALUE=DATE:${nextDayCompact}`);
  }

  lines.push(`SUMMARY:${summary}`);

  if (input.description && input.description.trim()) {
    lines.push(`DESCRIPTION:${escapeIcsText(input.description.trim())}`);
  }

  if (input.category && input.category.trim()) {
    lines.push(`CATEGORIES:${escapeIcsText(input.category.trim().toUpperCase())}`);
  }

  const leadDays = input.leadDays && input.leadDays.length > 0 ? input.leadDays : [0];
  lines.push(...buildValarmLines(input.title || 'Deep Hours Event', leadDays, !hasValidTime));

  lines.push('END:VEVENT');

  return lines.map(foldIcsLine).join(CRLF);
}

/**
 * Wraps one or more CalendarEventInput items into a complete RFC-5545 VCALENDAR file
 * with CRLF line endings and 75-octet folded lines.
 */
export function buildIcsCalendar(events: CalendarEventInput[], now = new Date()): string {
  const header = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Deep Hours//NEET Study Logger//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Deep Hours',
  ].map(foldIcsLine);

  const validEvents = events.filter((ev) => isValidDateKey(ev.date));
  const body = validEvents.map((ev) => buildIcsEvent(ev, now));

  return [...header, ...body, 'END:VCALENDAR'].join(CRLF) + CRLF;
}

/**
 * Triggers a clean client-side .ics download and revokes the Blob URL immediately after dispatch.
 */
export function downloadIcsFile(filename: string, icsContent: string): void {
  if (typeof document === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') {
    return;
  }
  const safeBase = filename
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'deep-hours-calendar';
  const finalName = safeBase.endsWith('.ics') ? safeBase : `${safeBase}.ics`;

  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = finalName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    window.setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore revoke failures
      }
    }, 1000);
  }
}

/**
 * Builds a pre-filled Google Calendar web quick-add URL (zero OAuth required).
 */
export function buildGoogleCalendarUrl(input: CalendarEventInput): string {
  const params = new URLSearchParams();
  params.set('action', 'TEMPLATE');
  params.set('text', input.title || 'Deep Hours');

  if (input.time && isValidTime24h(input.time)) {
    const { dtStart, dtEnd } = formatTimedStartAndEnd(
      input.date,
      input.time,
      input.durationMins ?? 30
    );
    params.set('dates', `${dtStart}/${dtEnd}`);
  } else {
    const startCompact = formatIcsDateCompact(input.date);
    const nextDayCompact = formatIcsDateCompact(shiftDateKey(input.date, 1));
    params.set('dates', `${startCompact}/${nextDayCompact}`);
  }

  if (input.description && input.description.trim()) {
    params.set('details', input.description.trim());
  }

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function buildTargetCalendarInput(
  target: DeadlineTarget,
  subjectName?: string
): CalendarEventInput {
  const checklistLines = (target.items || []).map(
    (item) => `${item.done ? '[x]' : '[ ]'} ${item.text}`
  );
  const descParts: string[] = [];
  if (subjectName) descParts.push(`Subject: ${subjectName}`);
  descParts.push(`Sprint window: ${target.startDate} to ${target.deadlineDate}`);
  if (target.notes) descParts.push(target.notes);
  if (checklistLines.length > 0) {
    descParts.push(`Checklist:\n${checklistLines.join('\n')}`);
  }
  descParts.push('Created in Deep Hours');

  return {
    id: `target_${target.id}`,
    title: `Target deadline: ${target.title}`,
    date: target.deadlineDate,
    description: descParts.join('\n\n'),
    leadDays: [3, 1, 0],
    category: 'STUDY TARGET',
  };
}

export function buildReminderCalendarInput(reminder: CustomReminder): CalendarEventInput {
  const descParts: string[] = [`Category: ${reminder.category}`];
  if (reminder.notes) descParts.push(reminder.notes);
  descParts.push('Created in Deep Hours');

  return {
    id: `rem_${reminder.id}`,
    title: reminder.title,
    date: reminder.date,
    time: reminder.time,
    durationMins: 30,
    description: descParts.join('\n\n'),
    leadDays: normalizeLeadDays(reminder.leadDays),
    category: reminder.category,
  };
}

export function buildExamCalendarInput(exam: DDay): CalendarEventInput {
  return {
    id: `exam_${exam.id}`,
    title: `Exam D-Day: ${exam.title}`,
    date: exam.date,
    description: `Countdown milestone in Deep Hours (${exam.title}).`,
    leadDays: [7, 3, 1, 0],
    category: 'EXAM',
  };
}

export function buildRevisionCalendarInput(
  chapter: Chapter,
  revisionDate: string,
  subjectName?: string
): CalendarEventInput {
  return {
    id: `rev_${chapter.id}_${revisionDate}`,
    title: `Spaced revision: ${chapter.name}`,
    date: revisionDate,
    description: `${subjectName ? `Subject: ${subjectName}\n` : ''}Spaced repetition review due in Deep Hours.`,
    leadDays: [0],
    category: 'REVISION',
  };
}

/**
 * Collects all upcoming (today or future) active Target Deadlines, Reminders, Exam D-Days,
 * and Spaced Revisions into a single CalendarEventInput array for 1-tap `Sync all (.ics)`.
 */
export function buildCalendarEventsForAllUpcoming(
  state: Pick<PulseHabitState, 'deadlineTargets' | 'reminders' | 'ddays' | 'chapters' | 'subjects'>,
  todayKey: string
): CalendarEventInput[] {
  const subjectNameById = new Map<string, string>(
    (state.subjects || []).map((s) => [s.id, s.name])
  );
  const events: CalendarEventInput[] = [];

  for (const target of state.deadlineTargets || []) {
    if (target.archived) continue;
    if (!isValidDateKey(target.deadlineDate)) continue;
    if (computeDaysUntilDate(target.deadlineDate, todayKey) < 0) continue;
    events.push(
      buildTargetCalendarInput(
        target,
        target.subjectId ? subjectNameById.get(target.subjectId) : undefined
      )
    );
  }

  for (const rem of state.reminders || []) {
    if (rem.done) continue;
    if (!isValidDateKey(rem.date)) continue;
    if (computeDaysUntilDate(rem.date, todayKey) < 0) continue;
    events.push(buildReminderCalendarInput(rem));
  }

  for (const exam of state.ddays || []) {
    if (!isValidDateKey(exam.date)) continue;
    if (computeDaysUntilDate(exam.date, todayKey) < 0) continue;
    events.push(buildExamCalendarInput(exam));
  }

  for (const ch of state.chapters || []) {
    for (const rev of ch.revisions || []) {
      if (rev.done || !isValidDateKey(rev.date)) continue;
      if (computeDaysUntilDate(rev.date, todayKey) < 0) continue;
      events.push(buildRevisionCalendarInput(ch, rev.date, subjectNameById.get(ch.subjectId)));
    }
  }

  return events.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}
