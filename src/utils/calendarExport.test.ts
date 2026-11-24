import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCalendarEventsForAllUpcoming,
  buildGoogleCalendarUrl,
  buildIcsCalendar,
  buildIcsEvent,
  buildTargetCalendarInput,
  escapeIcsText,
  foldIcsLine,
} from './calendarExport';
import { createCustomReminder, createDeadlineTarget } from './targetsLogic';

describe('calendarExport — RFC-5545 ICS & Google Calendar Links', () => {
  it('escapes RFC-5545 special characters (backslash, semicolon, comma, newline)', () => {
    const escaped = escapeIcsText('Pay fee, NEET; Phase\\1\nBring ID\r\nDone');
    assert.equal(escaped, 'Pay fee\\, NEET\\; Phase\\\\1\\nBring ID\\nDone');
  });

  it('folds lines exceeding 75 UTF-8 octets with CRLF + leading space without corrupting UTF-8', () => {
    const longLine = `DESCRIPTION:${'A'.repeat(180)}`;
    const folded = foldIcsLine(longLine);
    const parts = folded.split('\r\n');
    assert.ok(parts.length >= 3);
    const encoder = new TextEncoder();
    for (const part of parts) {
      assert.ok(
        encoder.encode(part).length <= 75,
        `Expected folded line <= 75 octets, got ${encoder.encode(part).length}`
      );
    }
    // Continuation lines start with a single space
    assert.equal(parts[1].startsWith(' '), true);
    assert.equal(parts[2].startsWith(' '), true);
    // Unfolding recovers the exact original line
    assert.equal(folded.replace(/\r\n /g, ''), longLine);
  });

  it('builds a valid all-day VEVENT with exact VALARM blocks for lead reminders', () => {
    const fixedNow = new Date('2026-11-24T06:00:00Z');
    const vevent = buildIcsEvent(
      {
        id: 'rem_fee_1',
        title: 'NEET registration fee payment',
        date: '2026-11-29',
        leadDays: [7, 3, 1, 0],
        description: 'Portal closes at 11:50 PM',
        category: 'admin',
      },
      fixedNow
    );

    assert.match(vevent, /^BEGIN:VEVENT\r\n/);
    assert.match(vevent, /\r\nUID:dh-rem_fee_1@deephours\.app\r\n/);
    assert.match(vevent, /\r\nDTSTAMP:20261124T060000Z\r\n/);
    assert.match(vevent, /\r\nDTSTART;VALUE=DATE:20261129\r\n/);
    assert.match(vevent, /\r\nDTEND;VALUE=DATE:20261130\r\n/);
    assert.match(vevent, /\r\nTRIGGER:-P7D\r\n/);
    assert.match(vevent, /\r\nTRIGGER:-P3D\r\n/);
    assert.match(vevent, /\r\nTRIGGER:-P1D\r\n/);
    assert.match(vevent, /\r\nTRIGGER:PT9H\r\n/);
    const alarmCount = (vevent.match(/BEGIN:VALARM/g) || []).length;
    assert.equal(alarmCount, 4);
  });

  it('builds a timed VEVENT (30-min block) with PT0M trigger and Google Calendar quick-add URL', () => {
    const vevent = buildIcsEvent(
      {
        id: 'rem_timed',
        title: 'Submit Physics practical',
        date: '2026-11-29',
        time: '14:30',
        leadDays: [1, 0],
      },
      new Date('2026-11-24T06:00:00Z')
    );

    assert.match(vevent, /\r\nDTSTART:20261129T143000\r\n/);
    assert.match(vevent, /\r\nDTEND:20261129T150000\r\n/);
    assert.match(vevent, /\r\nTRIGGER:-P1D\r\n/);
    assert.match(vevent, /\r\nTRIGGER:PT0M\r\n/);

    const gcalUrl = buildGoogleCalendarUrl({
      id: 'rem_timed',
      title: 'Submit Physics practical',
      date: '2026-11-29',
      time: '14:30',
      description: 'Bring lab journal',
    });
    const parsed = new URL(gcalUrl);
    assert.equal(parsed.origin, 'https://calendar.google.com');
    assert.equal(parsed.searchParams.get('action'), 'TEMPLATE');
    assert.equal(parsed.searchParams.get('text'), 'Submit Physics practical');
    assert.equal(parsed.searchParams.get('dates'), '20261129T143000/20261129T150000');
    assert.equal(parsed.searchParams.get('details'), 'Bring lab journal');
  });

  it('wraps multiple events into a valid VCALENDAR and formats target checklists into DESCRIPTION', () => {
    const target = createDeadlineTarget({
      title: 'Finish Electrostatics',
      startDate: '2026-11-24',
      deadlineDate: '2026-11-30',
      subjectId: 'sub_phy',
      itemTexts: ['Read NCERT', 'Solve 50 PYQs'],
    });
    target.items[0].done = true;

    const targetEvent = buildTargetCalendarInput(target, 'Physics');
    assert.match(targetEvent.description || '', /\[x\] Read NCERT/);
    assert.match(targetEvent.description || '', /\[ \] Solve 50 PYQs/);

    const rem = createCustomReminder({
      title: 'NEET fee',
      date: '2026-11-29',
      leadDays: [3, 0],
    });
    const allEvents = buildCalendarEventsForAllUpcoming(
      {
        deadlineTargets: [target],
        reminders: [rem],
        ddays: [{ id: 'ex1', title: 'NEET UG', date: '2027-05-02', e: '🎯', color: '#F43F5E' }],
        chapters: [],
        subjects: [{ id: 'sub_phy', name: 'Physics', e: '⚛️', color: '#3b82f6', arch: 0, todos: [] }],
      },
      '2026-11-24'
    );

    assert.equal(allEvents.length, 3);
    const ics = buildIcsCalendar(allEvents, new Date('2026-11-24T06:00:00Z'));
    assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
    assert.match(ics, /PRODID:-\/\/Deep Hours\/\/NEET Study Logger\/\/EN\r\n/);
    assert.match(ics, /END:VCALENDAR\r\n$/);
    assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 3);
  });
});
