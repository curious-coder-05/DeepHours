import type { Chapter, StudySession } from '../types';

export const MIN_SESSION_WRAPUP_MS = 60_000;

export type ChapterConfidenceLevel = NonNullable<Chapter['confidence']>;

export interface ConfidenceOption {
  value: ChapterConfidenceLevel;
  label: string;
}

export const CHAPTER_CONFIDENCE_OPTIONS: readonly ConfidenceOption[] = [
  { value: 1, label: 'Shaky' },
  { value: 2, label: 'Weak' },
  { value: 3, label: 'Okay' },
  { value: 4, label: 'Solid' },
  { value: 5, label: 'Strong' },
];

export interface SessionWrapUpSummary {
  sessionId: string;
  subjectId: string;
  chapterId?: string;
  heading: string;
  activeMs: number;
  purity: number;
}

/**
 * Only show the calm post-session micro-capture sheet for real study blocks (>= 60s),
 * skipping accidental starts or trivial <60s cancels.
 */
export function shouldOpenSessionWrapUp(
  session: Pick<StudySession, 'activeMs'> | null | undefined
): boolean {
  if (!session || !Number.isFinite(session.activeMs)) return false;
  return session.activeMs >= MIN_SESSION_WRAPUP_MS;
}

export function buildSessionWrapUpSummary(
  session: StudySession
): SessionWrapUpSummary {
  return {
    sessionId: session.id,
    subjectId: session.subjectId,
    chapterId: session.chapterId,
    heading: session.heading || '',
    activeMs: session.activeMs,
    purity: session.purity || 100,
  };
}
