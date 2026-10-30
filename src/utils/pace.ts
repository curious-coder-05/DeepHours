import type { Chapter, DDay, PulseHabitState } from '../types';
import { addD, getSubject, parseD } from './studyLogic.ts';

export type PaceStatus = 'ahead' | 'behind' | 'on track' | 'no-exam' | 'past-exam' | 'no-chapters' | 'completed';

export interface SubjectPaceSummary {
  subjectId: string;
  subjectName: string;
  subjectEmoji: string;
  color: string;
  totalChapters: number;
  completedChapters: number;
  remainingChapters: number;
  requiredPerWeek: number;
  actualPerWeek: number;
  projectedFinishDate: string | null;
  projectedDaysDelta: number | null; // positive = days after syllabusEnd, negative = days before syllabusEnd
  behindByChapters: number;
  status: PaceStatus;
}

export interface PaceGroupMetrics {
  total: number;
  completed: number;
  remaining: number;
  totalChapters: number;
  completedChapters: number;
  remainingChapters: number;
  completedLast28Days: number;
  requiredPerWeek: number;
  actualPerWeek: number;
  projectedFinishDate: string | null;
  projectedDaysDelta: number | null;
  behindByChapters: number;
  status: PaceStatus;
}

export interface PaceReport {
  exam: DDay | null;
  examDate: string | null;
  pastExam: boolean;
  revisionBufferDays: number;
  syllabusEndDate: string | null;
  daysToExam: number | null;
  daysToSyllabusEnd: number | null;
  weeksLeft: number;
  totalChapters: number;
  completedChapters: number;
  remainingChapters: number;
  completedLast28Days: number;
  requiredPerWeek: number;
  actualPerWeek: number;
  projectedFinishDate: string | null;
  projectedDaysDelta: number | null;
  behindByChapters: number;
  status: PaceStatus;
  overall: PaceGroupMetrics;
  compactSummary: string;
  perSubject: SubjectPaceSummary[];
}

export function diffDays(fromKey: string, toKey: string): number {
  const d1 = parseD(fromKey).getTime();
  const d2 = parseD(toKey).getTime();
  return Math.round((d2 - d1) / 86400000);
}

export function getPrimaryExam(state: PulseHabitState): DDay | null {
  if (!state.ddays || state.ddays.length === 0) return null;
  const explicitPrimary = state.ddays.find((d) => d.primary);
  if (explicitPrimary) return explicitPrimary;
  const neet = state.ddays.find((d) => /neet/i.test(d.title));
  return neet || state.ddays[0];
}

function evaluateGroupPace(
  chapters: Chapter[],
  todayKey: string,
  syllabusEndDate: string,
  weeksLeft: number
): PaceGroupMetrics {
  const totalChapters = chapters.length;
  const completedList = chapters.filter((ch) => ch.status === 'completed');
  const completedChapters = completedList.length;
  const remainingChapters = Math.max(0, totalChapters - completedChapters);

  const windowStartKey = addD(todayKey, -27); // inclusive 28-day window [today-27 .. today]
  const completedLast28Days = completedList.filter(
    (ch) => ch.completedOn && ch.completedOn >= windowStartKey && ch.completedOn <= todayKey
  ).length;

  const actualPerWeek = Number((completedLast28Days / 4).toFixed(2));

  if (totalChapters === 0) {
    return {
      total: 0,
      completed: 0,
      remaining: 0,
      totalChapters: 0,
      completedChapters: 0,
      remainingChapters: 0,
      completedLast28Days: 0,
      requiredPerWeek: 0,
      actualPerWeek: 0,
      projectedFinishDate: null,
      projectedDaysDelta: null,
      behindByChapters: 0,
      status: 'ahead',
    };
  }

  if (remainingChapters === 0) {
    return {
      total: totalChapters,
      completed: completedChapters,
      remaining: 0,
      totalChapters,
      completedChapters,
      remainingChapters: 0,
      completedLast28Days,
      requiredPerWeek: 0,
      actualPerWeek,
      projectedFinishDate: todayKey,
      projectedDaysDelta: diffDays(syllabusEndDate, todayKey),
      behindByChapters: 0,
      status: 'ahead',
    };
  }

  const effectiveWeeksLeft = Math.max(1 / 7, weeksLeft);
  const requiredPerWeek =
    weeksLeft > 0 ? Number((remainingChapters / effectiveWeeksLeft).toFixed(2)) : remainingChapters;

  let projectedFinishDate: string | null = null;
  let projectedDaysDelta: number | null = null;
  let status: PaceStatus = 'on track';
  let behindByChapters = 0;

  if (weeksLeft <= 0) {
    // Syllabus deadline already passed while chapters remain
    status = 'behind';
    behindByChapters = remainingChapters;
    if (actualPerWeek > 0) {
      const daysNeeded = Math.ceil((remainingChapters / actualPerWeek) * 7);
      projectedFinishDate = addD(todayKey, daysNeeded);
      projectedDaysDelta = diffDays(syllabusEndDate, projectedFinishDate);
    }
  } else if (actualPerWeek <= 0) {
    // No recent completions in last 28 days
    status = 'behind';
    const expectedAtThisPace = 0;
    behindByChapters = Math.max(1, Math.round(remainingChapters - expectedAtThisPace));
  } else {
    const daysNeeded = Math.ceil((remainingChapters / actualPerWeek) * 7);
    projectedFinishDate = addD(todayKey, daysNeeded);
    // projectedDaysDelta > 0 means projectedFinish is AFTER syllabusEnd
    // projectedDaysDelta < 0 means projectedFinish is BEFORE syllabusEnd
    projectedDaysDelta = diffDays(syllabusEndDate, projectedFinishDate);

    if (projectedDaysDelta <= -7) {
      status = 'ahead';
      behindByChapters = 0;
    } else if (projectedDaysDelta >= 7) {
      status = 'behind';
      const canFinishByDeadline = actualPerWeek * Math.max(0, weeksLeft);
      behindByChapters = Math.max(1, Math.ceil(remainingChapters - canFinishByDeadline));
    } else {
      status = 'on track';
      behindByChapters = 0;
    }
  }

  return {
    total: totalChapters,
    completed: completedChapters,
    remaining: remainingChapters,
    totalChapters,
    completedChapters,
    remainingChapters,
    completedLast28Days,
    requiredPerWeek,
    actualPerWeek,
    projectedFinishDate,
    projectedDaysDelta,
    behindByChapters,
    status,
  };
}

export function computePaceReport(state: PulseHabitState, todayKey: string): PaceReport {
  const exam = getPrimaryExam(state);
  const revisionBufferDays = Math.max(
    0,
    Math.min(180, Number(state.set.revisionBufferDays ?? 30))
  );

  const totalCh = state.chapters.length;
  const compCh = state.chapters.filter((c) => c.status === 'completed').length;
  const remCh = state.chapters.filter((c) => c.status !== 'completed').length;

  if (!exam || !/^\d{4}-\d{2}-\d{2}$/.test(exam.date)) {
    const fallbackOverall: PaceGroupMetrics = {
      total: totalCh,
      completed: compCh,
      remaining: remCh,
      totalChapters: totalCh,
      completedChapters: compCh,
      remainingChapters: remCh,
      completedLast28Days: 0,
      requiredPerWeek: 0,
      actualPerWeek: 0,
      projectedFinishDate: null,
      projectedDaysDelta: null,
      behindByChapters: 0,
      status: 'no-exam',
    };
    return {
      exam: null,
      examDate: null,
      pastExam: false,
      revisionBufferDays,
      syllabusEndDate: null,
      daysToExam: null,
      daysToSyllabusEnd: null,
      weeksLeft: 0,
      ...fallbackOverall,
      overall: fallbackOverall,
      compactSummary: 'Set a primary D-Day exam to unlock your Syllabus Pace Calculator.',
      perSubject: [],
    };
  }

  const examDate = exam.date;
  const daysToExam = diffDays(todayKey, examDate);
  const syllabusEndDate = addD(examDate, -revisionBufferDays);
  const daysToSyllabusEnd = diffDays(todayKey, syllabusEndDate);
  const weeksLeft = Number((daysToSyllabusEnd / 7).toFixed(2));

  if (daysToExam < 0) {
    const pastOverall: PaceGroupMetrics = {
      total: totalCh,
      completed: compCh,
      remaining: remCh,
      totalChapters: totalCh,
      completedChapters: compCh,
      remainingChapters: remCh,
      completedLast28Days: 0,
      requiredPerWeek: 0,
      actualPerWeek: 0,
      projectedFinishDate: null,
      projectedDaysDelta: null,
      behindByChapters: remCh,
      status: 'behind',
    };
    return {
      exam,
      examDate,
      pastExam: true,
      revisionBufferDays,
      syllabusEndDate,
      daysToExam,
      daysToSyllabusEnd,
      weeksLeft,
      ...pastOverall,
      status: 'past-exam',
      overall: pastOverall,
      compactSummary: `${exam.title} date (${examDate}) has passed. Update your primary D-Day to recalculate pace.`,
      perSubject: [],
    };
  }

  const overall = evaluateGroupPace(state.chapters, todayKey, syllabusEndDate, weeksLeft);

  const activeSubjects = state.subjects.filter((s) => !s.arch);
  const perSubject: SubjectPaceSummary[] = activeSubjects.map((sub) => {
    const subChaps = state.chapters.filter((ch) => ch.subjectId === sub.id);
    const group = evaluateGroupPace(subChaps, todayKey, syllabusEndDate, weeksLeft);
    return {
      subjectId: sub.id,
      subjectName: sub.name,
      subjectEmoji: sub.e,
      color: sub.color,
      totalChapters: group.totalChapters,
      completedChapters: group.completedChapters,
      remainingChapters: group.remainingChapters,
      requiredPerWeek: group.requiredPerWeek,
      actualPerWeek: group.actualPerWeek,
      projectedFinishDate: group.projectedFinishDate,
      projectedDaysDelta: group.projectedDaysDelta,
      behindByChapters: group.behindByChapters,
      status: group.status,
    };
  });

  let compactSummary = '';
  if (overall.totalChapters === 0) {
    compactSummary = `Add syllabus chapters in Prep to track your pace for ${exam.title}.`;
  } else if (overall.remainingChapters === 0) {
    compactSummary = `All ${overall.totalChapters} chapters completed! ${Math.max(0, daysToExam)}d left for revision.`;
  } else if (overall.status === 'ahead') {
    compactSummary = `Pace: Ahead (${overall.actualPerWeek}/wk vs ${overall.requiredPerWeek}/wk needed • ${overall.remainingChapters} ch left)`;
  } else if (overall.status === 'behind') {
    compactSummary = `Pace: Behind by ${overall.behindByChapters} chapter${overall.behindByChapters === 1 ? '' : 's'} (need ${overall.requiredPerWeek}/wk, doing ${overall.actualPerWeek}/wk)`;
  } else {
    compactSummary = `Pace: On track (${overall.actualPerWeek}/wk vs ${overall.requiredPerWeek}/wk needed • ${overall.remainingChapters} ch left)`;
  }

  return {
    exam,
    examDate,
    pastExam: false,
    revisionBufferDays,
    syllabusEndDate,
    daysToExam,
    daysToSyllabusEnd,
    weeksLeft,
    ...overall,
    overall,
    compactSummary,
    perSubject,
  };
}

// ==========================================
// 1.7 "STUDY NEXT" RECOMMENDER
// ==========================================

export interface StudyNextItem {
  chapterId: string;
  chapter: Chapter;
  subjectName: string;
  subjectEmoji: string;
  subjectColor: string;
  score: number;
  confidence: number;
  openMistakes: number;
  daysSinceLastTouched: number;
  lastTouchedKey: string | null;
  reasons: string[];
}

export function getChapterLastTouchedKey(
  state: PulseHabitState,
  chapter: Chapter
): string | null {
  let latest: string | null = null;
  const consider = (dk?: string) => {
    if (dk && /^\d{4}-\d{2}-\d{2}$/.test(dk)) {
      if (!latest || dk > latest) latest = dk;
    }
  };

  consider(chapter.completedOn);
  for (const rev of chapter.revisions || []) {
    if (rev.done) {
      consider(rev.doneOn || rev.date);
    }
  }
  for (const ses of state.sessions || []) {
    if (ses.chapterId === chapter.id) {
      consider(ses.dayKey);
    }
  }
  return latest;
}

/**
 * 1.7: Per chapter score =
 *   0.4 * ((6 - (confidence ?? 3)) / 5) +
 *   0.3 * (min(openMistakes, 5) / 5) +
 *   0.2 * (min(daysSinceLastTouched, 60) / 60) +
 *   0.1 * (status !== 'completed' ? 1 : 0)
 */
export function scoreChapterForStudyNext(
  state: PulseHabitState,
  chapter: Chapter,
  todayKey: string
): StudyNextItem {
  const confidence = chapter.confidence ?? 3;
  const openMistakes = (state.mistakes || []).filter(
    (m) => m.chapterId === chapter.id && !m.resolved
  ).length;

  const lastTouchedKey = getChapterLastTouchedKey(state, chapter);
  const daysSinceLastTouched = lastTouchedKey
    ? Math.max(0, diffDays(lastTouchedKey, todayKey))
    : 60;

  const confTerm = 0.4 * ((6 - confidence) / 5);
  const mistakeTerm = 0.3 * (Math.min(openMistakes, 5) / 5);
  const touchTerm = 0.2 * (Math.min(daysSinceLastTouched, 60) / 60);
  const statusTerm = 0.1 * (chapter.status !== 'completed' ? 1 : 0);

  const score = Number((confTerm + mistakeTerm + touchTerm + statusTerm).toFixed(4));

  const reasons: string[] = [];
  if (confidence <= 2) {
    reasons.push('low confidence');
  } else if (chapter.confidence === undefined) {
    reasons.push('unrated confidence');
  }
  if (openMistakes > 0) {
    reasons.push(`${openMistakes} open mistake${openMistakes === 1 ? '' : 's'}`);
  }
  if (!lastTouchedKey) {
    reasons.push('not touched yet');
  } else if (daysSinceLastTouched >= 7) {
    reasons.push(`not touched in ${daysSinceLastTouched} days`);
  }
  if (chapter.status !== 'completed') {
    reasons.push(chapter.status === 'inProgress' ? 'in progress' : 'not completed');
  }
  if (reasons.length === 0) {
    reasons.push('due for reinforcement');
  }

  const sub = getSubject(state, chapter.subjectId);
  return {
    chapterId: chapter.id,
    chapter,
    subjectName: sub.name,
    subjectEmoji: sub.e,
    subjectColor: sub.color,
    score,
    confidence,
    openMistakes,
    daysSinceLastTouched,
    lastTouchedKey,
    reasons,
  };
}

export function computeStudyNext(
  state: PulseHabitState,
  todayKey: string,
  limit = 3,
  subjectIdFilter?: string
): StudyNextItem[] {
  const candidates = state.chapters.filter((ch) =>
    subjectIdFilter && subjectIdFilter !== 'all' ? ch.subjectId === subjectIdFilter : true
  );
  return candidates
    .map((ch) => scoreChapterForStudyNext(state, ch, todayKey))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.openMistakes !== a.openMistakes) return b.openMistakes - a.openMistakes;
      return b.daysSinceLastTouched - a.daysSinceLastTouched;
    })
    .slice(0, limit);
}

// ==========================================
// 1.15 REVISION DATE SUGGESTIONS
// ==========================================

export function suggestRevisionDates(
  baseDateOrChapter: string | Chapter,
  intervalsOrBaseDate: number[] | string = [1, 3, 7, 21],
  existingDatesOrIntervals: string[] | number[] = []
): string[] {
  let baseDateKey: string;
  let intervals: number[];
  let existingDates: string[];

  if (typeof baseDateOrChapter === 'object' && baseDateOrChapter !== null) {
    baseDateKey =
      typeof intervalsOrBaseDate === 'string'
        ? intervalsOrBaseDate
        : baseDateOrChapter.completedOn || new Date().toISOString().slice(0, 10);
    intervals = Array.isArray(existingDatesOrIntervals)
      ? (existingDatesOrIntervals as number[])
      : [1, 3, 7, 21];
    existingDates = (baseDateOrChapter.revisions || []).map((r) => r.date);
  } else {
    baseDateKey = baseDateOrChapter;
    intervals = Array.isArray(intervalsOrBaseDate) ? intervalsOrBaseDate : [1, 3, 7, 21];
    existingDates = Array.isArray(existingDatesOrIntervals)
      ? (existingDatesOrIntervals as string[])
      : [];
  }

  const cleanBase = /^\d{4}-\d{2}-\d{2}$/.test(baseDateKey)
    ? baseDateKey
    : new Date().toISOString().slice(0, 10);
  const existingSet = new Set(existingDates);
  const cleanIntervals =
    Array.isArray(intervals) && intervals.length > 0 ? intervals : [1, 3, 7, 21];

  const out: string[] = [];
  for (const offset of cleanIntervals) {
    const days = Math.max(1, Math.min(365, Math.floor(Number(offset) || 1)));
    const candidate = addD(cleanBase, days);
    if (!existingSet.has(candidate) && !out.includes(candidate)) {
      out.push(candidate);
    }
  }
  return out.sort();
}
