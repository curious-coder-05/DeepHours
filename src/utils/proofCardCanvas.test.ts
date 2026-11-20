import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROOF_CARD_HEIGHT,
  PROOF_CARD_WIDTH,
  buildDailyProofPayload,
  buildProofCardFilename,
  redactProofPayload,
  type DailyProofPayload,
  type SessionProofPayload,
} from './proofCardCanvas.ts';
import { ALL_SUBJECTS_COLOR, ALL_SUBJECTS_LABEL, ALL_SUBJECTS_MOCK_ID } from './focusSessionHelpers.ts';
import { createBlankState } from './studyLogic.ts';

describe('Strava-Style Study Proof Cards (v29)', () => {
  it('uses crisp 4:5 portrait dimensions (1080x1350) and deterministic PNG filenames', () => {
    assert.equal(PROOF_CARD_WIDTH, 1080);
    assert.equal(PROOF_CARD_HEIGHT, 1350);

    const sessionPayload: SessionProofPayload = {
      kind: 'session',
      durationMs: 90 * 60_000,
      subjectLabel: 'Physics',
      subjectColor: '#60A5FA',
      chapterName: 'Rotational Motion',
      topicHeading: 'Moment of Inertia PYQs',
      focusPurity: 96,
      streakDays: 14,
      dateLabel: 'Fri, 20 Nov 2026',
      dayKey: '2026-11-20',
      modeLabel: 'Pomodoro',
    };

    const dailyPayload: DailyProofPayload = {
      kind: 'daily',
      totalMs: 6 * 60 * 60_000,
      goalMs: 6 * 60 * 60_000,
      sessionsCount: 4,
      avgPurity: 94,
      habitsDone: 2,
      habitsTotal: 2,
      tasksDone: 5,
      tasksTotal: 6,
      streakDays: 14,
      dateLabel: 'Fri, 20 Nov 2026',
      dayKey: '2026-11-20',
      slices: [],
      topTopics: ['Rotational Motion', 'Organic GOC'],
    };

    assert.equal(buildProofCardFilename(sessionPayload), 'deep-hours-session-2026-11-20.png');
    assert.equal(buildProofCardFilename(dailyPayload), 'deep-hours-daily-2026-11-20.png');
  });

  it('redacts personal chapter/topic details while keeping generic Full Mock/Exam Hall headings', () => {
    const personalSession: SessionProofPayload = {
      kind: 'session',
      durationMs: 55 * 60_000,
      subjectLabel: 'Chemistry',
      subjectColor: '#F59E0B',
      chapterName: 'Chemical Bonding',
      topicHeading: 'VSEPR Exceptions & Dipole Moment',
      focusPurity: 92,
      streakDays: 7,
      dateLabel: 'Fri, 20 Nov 2026',
      dayKey: '2026-11-20',
      modeLabel: 'Countdown',
    };

    // Unredacted preserves chapter and topic
    const unredacted = redactProofPayload(personalSession, false);
    assert.equal(unredacted.chapterName, 'Chemical Bonding');
    assert.equal(unredacted.topicHeading, 'VSEPR Exceptions & Dipole Moment');

    // Redacted strips personal chapter & topic but keeps subject, purity, duration, streak
    const redacted = redactProofPayload(personalSession, true);
    assert.equal(redacted.chapterName, undefined);
    assert.equal(redacted.topicHeading, undefined);
    assert.equal(redacted.subjectLabel, 'Chemistry');
    assert.equal(redacted.durationMs, 55 * 60_000);
    assert.equal(redacted.focusPurity, 92);
    assert.equal(redacted.streakDays, 7);

    // Generic Exam Hall / Full Mock heading is preserved cleanly when redacted
    const examSession: SessionProofPayload = {
      ...personalSession,
      subjectLabel: ALL_SUBJECTS_LABEL,
      subjectColor: ALL_SUBJECTS_COLOR,
      chapterName: 'Private Mock Series #12',
      topicHeading: 'Exam Hall · NEET Mock',
    };
    const redactedExam = redactProofPayload(examSession, true);
    assert.equal(redactedExam.chapterName, undefined);
    assert.equal(redactedExam.topicHeading, 'Exam Hall · NEET Mock');

    // Daily payload redacts topTopics list
    const daily: DailyProofPayload = {
      kind: 'daily',
      totalMs: 180 * 60_000,
      goalMs: 360 * 60_000,
      sessionsCount: 2,
      avgPurity: 95,
      habitsDone: 1,
      habitsTotal: 1,
      tasksDone: 3,
      tasksTotal: 3,
      streakDays: 10,
      dateLabel: 'Fri, 20 Nov 2026',
      dayKey: '2026-11-20',
      slices: [],
      topTopics: ['Optics NCERT', 'Electrostatics'],
    };
    assert.deepEqual(redactProofPayload(daily, true).topTopics, []);
  });

  it('aggregates daily proof payload cleanly including sub_All_Subjects mocks without polluting subject slices', () => {
    const state = createBlankState();
    const dayKey = '2026-11-20';
    state.sessions.push(
      {
        id: 's1',
        subjectId: 'sub_phy',
        heading: 'Kinematics PYQs',
        dayKey,
        startTs: 1000,
        endTs: 1000 + 60 * 60_000,
        activeMs: 60 * 60_000,
        pausedMs: 0,
        pauseCount: 0,
        overtimeMs: 0,
        purity: 95,
        mode: 'pomo',
        source: 'timer',
        rating: 5,
        note: '',
        updatedAt: 2000,
      },
      {
        id: 's2',
        subjectId: ALL_SUBJECTS_MOCK_ID,
        heading: 'Exam Hall · NEET Mock',
        dayKey,
        startTs: 3000,
        endTs: 3000 + 180 * 60_000,
        activeMs: 180 * 60_000,
        pausedMs: 0,
        pauseCount: 0,
        overtimeMs: 0,
        purity: 99,
        mode: 'fullMock',
        source: 'timer',
        rating: 5,
        note: '',
        updatedAt: 4000,
      }
    );

    const payload = buildDailyProofPayload(state, dayKey, dayKey);
    assert.equal(payload.kind, 'daily');
    assert.equal(payload.totalMs, 240 * 60_000);
    assert.equal(payload.sessionsCount, 2);
    assert.equal(payload.avgPurity, 97);
    assert.equal(payload.slices.length, 2);
    // Largest slice (All Subjects 180m) sorted first
    assert.equal(payload.slices[0].id, ALL_SUBJECTS_MOCK_ID);
    assert.equal(payload.slices[0].label, ALL_SUBJECTS_LABEL);
    assert.equal(payload.slices[0].color, ALL_SUBJECTS_COLOR);
    assert.equal(payload.slices[0].pct, 75);
    assert.equal(payload.slices[1].id, 'sub_phy');
    assert.equal(payload.slices[1].pct, 25);
    // Generic Exam Hall heading excluded from personal topTopics
    assert.deepEqual(payload.topTopics, ['Kinematics PYQs']);
  });
});
