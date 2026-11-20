import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_SUBJECTS_MOCK_ID,
  EXAM_HALL_MIN_LOG_MS,
  buildExamHallStudySession,
  getExamHallSessionId,
  hasLoggedExamHallRecord,
  isAllSubjectsMockId,
  markExamHallRecordLogged,
  resolveSubjectOnModeSwitch,
} from './focusSessionHelpers.ts';
import type { ExamPaceRecord } from './examClock.ts';

function makeRecord(overrides: Partial<ExamPaceRecord> = {}): ExamPaceRecord {
  const startedAt = Date.parse('2026-11-20T09:00:00Z');
  const totalElapsedMs = 172 * 60_000;
  const completedAt = startedAt + totalElapsedMs;
  return {
    id: 'exam_2026_11_20_01',
    completedAt,
    totalDurationMins: 180,
    totalElapsedMs,
    switchCount: 4,
    sections: [
      { id: 'bio', label: 'Biology', color: '#34D399', targetMs: 50 * 60_000, actualMs: 48 * 60_000, deltaMs: -2 * 60_000, status: 'on-target', visits: 1 },
      { id: 'chem', label: 'Chemistry', color: '#A78BFA', targetMs: 50 * 60_000, actualMs: 46 * 60_000, deltaMs: -4 * 60_000, status: 'on-target', visits: 1 },
      { id: 'phy', label: 'Physics', color: '#38BDF8', targetMs: 65 * 60_000, actualMs: 64 * 60_000, deltaMs: -1 * 60_000, status: 'on-target', visits: 2 },
      { id: 'omr', label: 'OMR Bubbling', color: '#F5C451', targetMs: 15 * 60_000, actualMs: 14 * 60_000, deltaMs: -1 * 60_000, status: 'on-target', visits: 1 },
    ],
    visitLog: [
      { sectionId: 'bio', label: 'Biology', color: '#34D399', startedAt, endedAt: completedAt, durationMs: totalElapsedMs },
    ],
    ...overrides,
  };
}

describe('Full Mock Subject Detach/Restore & Exam Hall Session Logging (v29)', () => {
  it('detaches single subject to sub_All_Subjects when entering fullMock and restores previous subject on exit', () => {
    assert.equal(isAllSubjectsMockId(ALL_SUBJECTS_MOCK_ID), true);
    assert.equal(isAllSubjectsMockId('sub_phy'), false);

    // 1. Entering fullMock from Physics -> detaches to sub_All_Subjects & remembers sub_phy
    const enterMock = resolveSubjectOnModeSwitch({
      prevMode: 'pomo',
      nextMode: 'fullMock',
      currentSubjectId: 'sub_phy',
      rememberedSingleSubjectId: 'sub_bio',
      fallbackSubjectId: 'sub_bio',
    });
    assert.equal(enterMock.nextSubjectId, ALL_SUBJECTS_MOCK_ID);
    assert.equal(enterMock.nextRememberedSingleSubjectId, 'sub_phy');
    assert.equal(enterMock.clearChapter, true);

    // 2. Exiting fullMock while still on sub_All_Subjects -> restores remembered sub_phy
    const exitMock = resolveSubjectOnModeSwitch({
      prevMode: 'fullMock',
      nextMode: 'stopwatch',
      currentSubjectId: ALL_SUBJECTS_MOCK_ID,
      rememberedSingleSubjectId: enterMock.nextRememberedSingleSubjectId,
      fallbackSubjectId: 'sub_bio',
    });
    assert.equal(exitMock.nextSubjectId, 'sub_phy');
    assert.equal(exitMock.nextRememberedSingleSubjectId, 'sub_phy');
    assert.equal(exitMock.clearChapter, false);

    // 3. Exiting fullMock after user manually overrode to Chemistry -> keeps Chemistry
    const exitAfterOverride = resolveSubjectOnModeSwitch({
      prevMode: 'fullMock',
      nextMode: 'countdown',
      currentSubjectId: 'sub_chem',
      rememberedSingleSubjectId: 'sub_phy',
      fallbackSubjectId: 'sub_bio',
    });
    assert.equal(exitAfterOverride.nextSubjectId, 'sub_chem');
    assert.equal(exitAfterOverride.nextRememberedSingleSubjectId, 'sub_chem');
  });

  it('skips Exam Hall papers under 60 seconds and converts >= 60s papers into a canonical StudySession', () => {
    assert.equal(EXAM_HALL_MIN_LOG_MS, 60_000);

    // Under 60s -> null (do not pollute study log)
    const tiny = makeRecord({ totalElapsedMs: 59_999 });
    assert.equal(buildExamHallStudySession(tiny, 4), null);

    // Exactly 60s -> valid session
    const minValid = makeRecord({ id: 'exam_min', totalElapsedMs: 60_000 });
    const minSes = buildExamHallStudySession(minValid, 4);
    assert.ok(minSes);
    assert.equal(minSes.id, getExamHallSessionId('exam_min'));
    assert.equal(minSes.subjectId, ALL_SUBJECTS_MOCK_ID);
    assert.equal(minSes.mode, 'fullMock');
    assert.equal(minSes.source, 'timer');
    assert.equal(minSes.heading, 'Exam Hall · NEET Mock');
    assert.equal(minSes.activeMs, 60_000);

    // Full 3-hour paper -> computes overtime & purity properly
    const overtimeStart = Date.parse('2026-11-20T09:00:00Z');
    const overtimeMs = 185 * 60_000;
    const overtimePaper = makeRecord({
      id: 'exam_overtime',
      totalDurationMins: 180,
      totalElapsedMs: overtimeMs,
      completedAt: overtimeStart + overtimeMs,
      visitLog: [
        { sectionId: 'bio', label: 'Biology', color: '#34D399', startedAt: overtimeStart, endedAt: overtimeStart + overtimeMs, durationMs: overtimeMs },
      ],
    });
    const overSes = buildExamHallStudySession(overtimePaper, 4);
    assert.ok(overSes);
    assert.equal(overSes.overtimeMs, 5 * 60_000);
    assert.equal(overSes.purity, 100);
  });

  it('strictly prevents duplicate Exam Hall session logging via deterministic IDs and local record ledger', () => {
    const rec = makeRecord({ id: 'exam_dedupe_99' });
    const expectedId = getExamHallSessionId(rec.id);

    // First build succeeds
    const existing = new Set<string>();
    const ses1 = buildExamHallStudySession(rec, 4, existing);
    assert.ok(ses1);
    assert.equal(ses1.id, expectedId);

    // Second build with existing session ID returns null
    existing.add(ses1.id);
    const ses2 = buildExamHallStudySession(rec, 4, existing);
    assert.equal(ses2, null);

    // Local storage logged ledger idempotency check
    const mem = new Map<string, string>();
    const fakeStore = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
    };
    assert.equal(hasLoggedExamHallRecord(rec.id, fakeStore), false);
    markExamHallRecordLogged(rec.id, fakeStore);
    assert.equal(hasLoggedExamHallRecord(rec.id, fakeStore), true);
  });
});
