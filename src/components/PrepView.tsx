import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  Compass,
  Edit3,
  FileSpreadsheet,
  Play,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type {
  Chapter,
  ChapterStatus,
  Doubt,
  MistakeEntry,
  PrepSubTab,
  PulseHabitState,
} from '../types';
import {
  addD,
  computeMocksOverview,
  getChapterPYQStats,
  getDueAndOverdueRevisions,
  getSortedChapterRevisions,
  getSubject,
} from '../utils/studyLogic';
import { computeStudyNext } from '../utils/pace';
import { computeUiPaceReport } from '../utils/uiHelpers';
import { MistakesView } from './MistakesView';
import { DoubtsView } from './DoubtsView';
import { PYQView } from './PYQView';
import { SyllabusGalaxyScene } from './three/SyllabusGalaxyScene';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { Chip } from './ui/Chip';
import { EmptyState } from './ui/EmptyState';
import { Field } from './ui/Field';
import { IconButton } from './ui/IconButton';
import { Meter } from './ui/Meter';
import { SectionHeader } from './ui/SectionHeader';
import { Segmented } from './ui/Segmented';
import { Select } from './ui/Select';
import { Sheet } from './ui/Sheet';
import { Stat } from './ui/Stat';

interface PrepViewProps {
  state: PulseHabitState;
  todayKey: string;
  subTab: PrepSubTab;
  onChangeSubTab: (sub: PrepSubTab) => void;
  onAddChapters: (subjectId: string, names: string[]) => void;
  onUpdateChapter: (chapterId: string, patch: Partial<Chapter>) => void;
  onDeleteChapter: (chapterId: string) => void;
  onAddRevision: (chapterId: string, date: string) => void;
  onToggleRevision: (chapterId: string, revId: string) => void;
  onUpdateRevisionDate: (chapterId: string, revId: string, nextDate: string) => void;
  onDeleteRevision: (chapterId: string, revId: string) => void;
  onOpenNewMock: () => void;
  onEditMock: (mockId: string) => void;
  onDeleteMock: (mockId: string) => void;
  onUpdateTargetScore: (nextTarget: number) => void;
  onAddMistake: (
    entry: Omit<MistakeEntry, 'id' | 'createdAt' | 'updatedAt' | 'resolved'>
  ) => void;
  onToggleMistakeResolved: (id: string) => void;
  onDeleteMistake: (id: string) => void;
  onAddDoubt: (doubt: Omit<Doubt, 'id' | 'createdAt' | 'resolved'>) => void;
  onToggleDoubtResolved: (id: string) => void;
  onDeleteDoubt: (id: string) => void;
  onAddPYQ: (entry: {
    chapterId: string;
    attempted: number;
    correct: number;
    dayKey: string;
  }) => void;
  onDeletePYQ: (id: string) => void;
  onStartChapterFocus: (
    subjectId: string,
    chapterId: string,
    chapterName: string
  ) => void;
}

type PrepUiTab = PrepSubTab | 'pyqs';

const STATUS_OPTIONS: Array<{ value: ChapterStatus; label: string }> = [
  { value: 'notStarted', label: 'Not started' },
  { value: 'inProgress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
];

export const PrepView: React.FC<PrepViewProps> = ({
  state,
  todayKey,
  subTab,
  onChangeSubTab,
  onAddChapters,
  onUpdateChapter,
  onDeleteChapter,
  onAddRevision,
  onToggleRevision,
  onUpdateRevisionDate,
  onDeleteRevision,
  onOpenNewMock,
  onEditMock,
  onDeleteMock,
  onUpdateTargetScore,
  onAddMistake,
  onToggleMistakeResolved,
  onDeleteMistake,
  onAddDoubt,
  onToggleDoubtResolved,
  onDeleteDoubt,
  onAddPYQ,
  onDeletePYQ,
  onStartChapterFocus,
}) => {
  const [showPyqsTab, setShowPyqsTab] = useState<boolean>(false);
  const activeUiTab: PrepUiTab = showPyqsTab ? 'pyqs' : subTab;

  const handleSelectUiTab = (next: PrepUiTab) => {
    if (next === 'pyqs') {
      setShowPyqsTab(true);
    } else {
      setShowPyqsTab(false);
      onChangeSubTab(next);
    }
  };

  const defaultSubjectId = state.subjects[0]?.id || 'phy';
  const [newChapterSub, setNewChapterSub] = useState<string>(defaultSubjectId);
  const [newChapterName, setNewChapterName] = useState<string>('');

  const [filterSub, setFilterSub] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | ChapterStatus>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [collapsedSubjects, setCollapsedSubjects] = useState<Record<string, boolean>>({});
  const [newRevDates, setNewRevDates] = useState<Record<string, string>>({});
  const [suggestedRevDrafts, setSuggestedRevDrafts] = useState<
    Record<string, [string, string, string, string]>
  >({});

  // Bulk Paste Sheet
  const [showBulkPasteSheet, setShowBulkPasteSheet] = useState<boolean>(false);
  const [bulkSubjectId, setBulkSubjectId] = useState<string>(defaultSubjectId);
  const [bulkText, setBulkText] = useState<string>('');

  // Inline PYQ Drawer inside chapter
  const [openPyqChapterId, setOpenPyqChapterId] = useState<string | null>(null);
  const [pyqAttemptedDraft, setPyqAttemptedDraft] = useState<string>('30');
  const [pyqCorrectDraft, setPyqCorrectDraft] = useState<string>('24');
  const [confidencePromptChapterId, setConfidencePromptChapterId] = useState<string | null>(
    null
  );

  const syllabusMetrics = useMemo(() => {
    const total = state.chapters.length;
    const completed = state.chapters.filter((ch) => ch.status === 'completed').length;
    const inProgress = state.chapters.filter((ch) => ch.status === 'inProgress').length;
    const notStarted = state.chapters.filter((ch) => ch.status === 'notStarted').length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    const bySubject = state.subjects
      .filter((s) => !s.arch)
      .map((s) => {
        const subChaps = state.chapters.filter((ch) => ch.subjectId === s.id);
        const subComp = subChaps.filter((ch) => ch.status === 'completed').length;
        const subInProg = subChaps.filter((ch) => ch.status === 'inProgress').length;
        return {
          subject: s,
          total: subChaps.length,
          completed: subComp,
          inProgress: subInProg,
          pct: subChaps.length > 0 ? Math.round((subComp / subChaps.length) * 100) : 0,
        };
      });
    return { total, completed, inProgress, notStarted, pct, bySubject };
  }, [state]);

  const mocksOverview = useMemo(() => computeMocksOverview(state), [state]);
  const paceReport = useMemo(
    () => computeUiPaceReport(state, todayKey),
    [state, todayKey]
  );
  const studyNextList = useMemo(
    () => computeStudyNext(state, todayKey, 3),
    [state, todayKey]
  );

  const filteredChapters = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return state.chapters.filter((ch) => {
      if (filterSub !== 'all' && ch.subjectId !== filterSub) return false;
      if (filterStatus !== 'all' && ch.status !== filterStatus) return false;
      if (q && !ch.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [state.chapters, filterSub, filterStatus, searchQuery]);

  const chaptersBySubject = useMemo(() => {
    return state.subjects
      .filter((s) => !s.arch && (filterSub === 'all' || s.id === filterSub))
      .map((sub) => {
        const list = filteredChapters.filter((ch) => ch.subjectId === sub.id);
        const totalSubChapters = state.chapters.filter((ch) => ch.subjectId === sub.id);
        const completedSubCount = totalSubChapters.filter(
          (ch) => ch.status === 'completed'
        ).length;
        return {
          subject: sub,
          chapters: list,
          totalCount: totalSubChapters.length,
          completedCount: completedSubCount,
        };
      });
  }, [state.subjects, state.chapters, filteredChapters, filterSub]);

  const handleAddChapterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newChapterName.trim();
    if (!trimmed) return;
    onAddChapters(newChapterSub || defaultSubjectId, [trimmed]);
    setNewChapterName('');
  };

  const handleBulkSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const lines = bulkText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) return;
    onAddChapters(bulkSubjectId || defaultSubjectId, lines);
    setBulkText('');
    setShowBulkPasteSheet(false);
  };

  const toggleSubjectCollapse = (subjectId: string) => {
    setCollapsedSubjects((prev) => ({
      ...prev,
      [subjectId]: !prev[subjectId],
    }));
  };

  const dueChapterIds = useMemo(() => {
    const { dueOnSel, overdue } = getDueAndOverdueRevisions(
      state,
      todayKey,
      todayKey
    );
    return new Set<string>([
      ...dueOnSel.map((item) => item.chapterId),
      ...overdue.map((item) => item.chapterId),
    ]);
  }, [state, todayKey]);

  const targetScore = state.set.targetMockScore ?? 650;

  return (
    <div className="space-y-4">
      {/* Top 5-Option Segmented Navigation */}
      <Segmented<PrepUiTab>
        value={activeUiTab}
        onChange={handleSelectUiTab}
        ariaLabel="Preparation sections"
        options={[
          { value: 'syllabus', label: 'Syllabus' },
          { value: 'mocks', label: 'Mocks' },
          { value: 'mistakes', label: 'Mistakes' },
          { value: 'doubts', label: 'Doubts' },
          { value: 'pyqs', label: 'PYQs' },
        ]}
      />

      {/* ==========================================
          SUB-VIEW 1: SYLLABUS & REVISIONS
          ========================================== */}
      {activeUiTab === 'syllabus' && (
        <div className="space-y-4">
          {/* Optional 3D Syllabus Galaxy Scene */}
          <SyllabusGalaxyScene
            subjects={state.subjects}
            chapters={state.chapters}
            dueChapterIds={dueChapterIds}
            ui3dSetting={state.set.ui3d || 'auto'}
            onSelectChapter={(ch) =>
              onStartChapterFocus(ch.subjectId, ch.id, ch.name)
            }
          />

          {/* Syllabus Pace Calculator Card (with nearest upcoming D-Day fallback) */}
          <Card>
            <div className="split mb-3 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Compass size={18} className="text-[var(--ac)]" />
                <div>
                  <h3 className="text-[15px] font-semibold text-[var(--tx)]">
                    Syllabus pace calculator
                  </h3>
                  {paceReport.exam && (
                    <p className="text-[12px] text-[var(--tx-2)]">
                      Target: {paceReport.exam.e} {paceReport.exam.title} ({paceReport.exam.date}) ·{' '}
                      {paceReport.revisionBufferDays}d revision buffer
                    </p>
                  )}
                </div>
              </div>
              {paceReport.overall.status !== 'no-exam' &&
                paceReport.overall.status !== 'past-exam' &&
                paceReport.overall.status !== 'no-chapters' && (
                  <span
                    className="rounded-lg px-2.5 py-1 text-[12px] font-semibold"
                    style={{
                      background:
                        paceReport.overall.status === 'ahead' ||
                        paceReport.overall.status === 'completed'
                          ? 'rgba(74, 222, 128, 0.14)'
                          : paceReport.overall.status === 'on track'
                            ? 'var(--ac-soft)'
                            : 'rgba(251, 146, 60, 0.16)',
                      color:
                        paceReport.overall.status === 'ahead' ||
                        paceReport.overall.status === 'completed'
                          ? 'var(--ok)'
                          : paceReport.overall.status === 'on track'
                            ? 'var(--ac)'
                            : 'var(--warn)',
                    }}
                  >
                    {paceReport.overall.status === 'completed'
                      ? '100% Completed'
                      : paceReport.overall.status === 'ahead'
                        ? 'Ahead of schedule'
                        : paceReport.overall.status === 'on track'
                          ? 'On track'
                          : `Behind by ${paceReport.overall.behindByChapters} ch`}
                  </span>
                )}
            </div>

            {paceReport.overall.status === 'no-exam' ? (
              <div className="rounded-xl border border-[var(--line)] bg-[var(--sf-2)] p-3 text-[13px] text-[var(--tx-2)]">
                Add an upcoming exam countdown on the Today tab or Settings → Exams to calculate your weekly chapter pace and projected finish date.
              </div>
            ) : paceReport.overall.status === 'past-exam' ? (
              <div className="rounded-xl border border-[var(--line)] bg-[var(--sf-2)] p-3 text-[13px] text-[var(--tx-2)]">
                Your exam date ({paceReport.exam?.date}) has passed. Update your exam date in Settings → Exams to recalculate your syllabus pace.
              </div>
            ) : paceReport.overall.status === 'no-chapters' ? (
              <div className="rounded-xl border border-[var(--line)] bg-[var(--sf-2)] p-3 text-[13px] text-[var(--tx-2)]">
                Add chapters below (or use Bulk Paste) to calculate your weekly completion velocity before{' '}
                <strong className="text-[var(--tx)]">{paceReport.syllabusEndDate}</strong>.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  <Stat
                    label="Syllabus deadline"
                    value={paceReport.syllabusEndDate || '—'}
                    sub={`${Math.max(0, paceReport.daysToSyllabusEnd ?? 0)}d left`}
                  />
                  <Stat
                    label="Required pace"
                    value={`${paceReport.overall.requiredPerWeek}/wk`}
                    sub={`${paceReport.overall.remaining} ch remaining`}
                  />
                  <Stat
                    label="Your 28d pace"
                    value={`${paceReport.overall.actualPerWeek}/wk`}
                    sub={`${paceReport.overall.completedLast28Days} ch in 28d`}
                  />
                  <Stat
                    label="Projected finish"
                    value={paceReport.overall.projectedFinishDate || 'Need 1+ done'}
                    sub="At current velocity"
                  />
                </div>
              </div>
            )}
          </Card>

          {/* Completion per Subject Progress Rows */}
          <Card>
            <div className="split mb-3 flex-wrap gap-2">
              <div>
                <h3 className="text-[15px] font-semibold text-[var(--tx)]">
                  Subject completion
                </h3>
                <p className="tnum text-[12px] text-[var(--tx-2)]">
                  {syllabusMetrics.completed} of {syllabusMetrics.total} chapters completed ({syllabusMetrics.pct}%) ·{' '}
                  {syllabusMetrics.inProgress} in progress
                </p>
              </div>
              <span className="tnum rounded-lg bg-[var(--ac-soft)] px-2.5 py-1 text-[13px] font-semibold text-[var(--ac)]">
                {syllabusMetrics.pct}%
              </span>
            </div>

            <div className="mb-4">
              <Meter value={syllabusMetrics.pct} max={100} color="var(--ac)" />
            </div>

            <div className="space-y-2.5">
              {syllabusMetrics.bySubject.map((row) => (
                <div key={row.subject.id} className="space-y-1">
                  <div className="split text-[13px]">
                    <span className="flex items-center gap-2 font-medium text-[var(--tx)]">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: row.subject.color }}
                      />
                      <span>
                        {row.subject.e} {row.subject.name}
                      </span>
                    </span>
                    <span className="tnum text-[12px] text-[var(--tx-2)]">
                      {row.completed}/{row.total} ({row.pct}%)
                      {row.inProgress > 0 ? ` · ${row.inProgress} active` : ''}
                    </span>
                  </div>
                  <Meter value={row.pct} max={100} color={row.subject.color} />
                </div>
              ))}
            </div>
          </Card>

          {/* Study Next Recommender */}
          {studyNextList.length > 0 && (
            <Card>
              <SectionHeader
                title="Recommended next chapters"
                subtitle="Prioritized by low confidence, open mistakes, and days since last touch"
              />
              <div className="mt-2 divide-y divide-[var(--line)]">
                {studyNextList.map((item) => {
                  const sub = getSubject(state, item.chapter.subjectId);
                  return (
                    <div
                      key={item.chapter.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ background: sub.color }}
                          />
                          <span className="text-[14px] font-medium text-[var(--tx)]">
                            {item.chapter.name}
                          </span>
                          <span className="text-[12px] text-[var(--tx-3)]">
                            {sub.e} {sub.name}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[12px] text-[var(--tx-2)]">
                          {item.reasons.join(' · ')}
                        </p>
                      </div>
                      <Button
                        variant="primary"
                        size="sm"
                        icon={<Play size={14} />}
                        onClick={() =>
                          onStartChapterFocus(
                            item.chapter.subjectId,
                            item.chapter.id,
                            item.chapter.name
                          )
                        }
                      >
                        Focus
                      </Button>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* Add Chapter & Bulk Paste */}
          <Card>
            <div className="split mb-3 flex-wrap gap-2">
              <h3 className="text-[15px] font-semibold text-[var(--tx)]">
                Add syllabus chapters
              </h3>
              <Button
                variant="secondary"
                size="sm"
                icon={<FileSpreadsheet size={15} />}
                onClick={() => setShowBulkPasteSheet(true)}
              >
                Bulk paste
              </Button>
            </div>

            <form
              onSubmit={handleAddChapterSubmit}
              className="grid gap-2.5 sm:grid-cols-12"
            >
              <div className="sm:col-span-4">
                <Select
                  value={newChapterSub}
                  onChange={setNewChapterSub}
                  ariaLabel="Chapter subject"
                  options={state.subjects
                    .filter((s) => !s.arch)
                    .map((s) => ({
                      value: s.id,
                      label: `${s.e} ${s.name}`,
                    }))}
                />
              </div>
              <div className="sm:col-span-6">
                <input
                  type="text"
                  value={newChapterName}
                  onChange={(e) => setNewChapterName(e.target.value)}
                  placeholder="Chapter name (e.g. Rotational Motion)"
                  aria-label="Chapter name"
                  className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3 text-[14px] text-[var(--tx)]"
                />
              </div>
              <div className="sm:col-span-2">
                <Button
                  type="submit"
                  variant="primary"
                  className="w-full"
                  disabled={!newChapterName.trim()}
                >
                  Add
                </Button>
              </div>
            </form>
          </Card>

          {/* Search & Filters */}
          <Card>
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                <Chip
                  selected={filterSub === 'all'}
                  onClick={() => setFilterSub('all')}
                >
                  All subjects
                </Chip>
                {state.subjects
                  .filter((s) => !s.arch)
                  .map((s) => (
                    <Chip
                      key={s.id}
                      selected={filterSub === s.id}
                      colorDot={s.color}
                      onClick={() => setFilterSub(s.id)}
                    >
                      {s.e} {s.name}
                    </Chip>
                  ))}
              </div>

              <div className="grid gap-2.5 sm:grid-cols-2">
                <Select
                  value={filterStatus}
                  onChange={(val) => setFilterStatus(val as 'all' | ChapterStatus)}
                  ariaLabel="Filter by chapter status"
                  options={[
                    { value: 'all', label: 'All statuses' },
                    ...STATUS_OPTIONS,
                  ]}
                />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search chapters…"
                  aria-label="Search chapters"
                  className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3 text-[14px] text-[var(--tx)]"
                />
              </div>
            </div>
          </Card>

          {/* Collapsible Subject Chapter Groups */}
          {state.chapters.length === 0 ? (
            <EmptyState
              icon={<BookOpen size={22} />}
              title="Your syllabus tracker is empty"
              description="Add chapters individually or paste your entire NEET syllabus to track completion, confidence, and spaced revisions."
              action={
                <Button
                  variant="primary"
                  size="sm"
                  icon={<FileSpreadsheet size={15} />}
                  onClick={() => setShowBulkPasteSheet(true)}
                >
                  Bulk paste chapters
                </Button>
              }
            />
          ) : (
            <div className="space-y-3">
              {chaptersBySubject.map(({ subject, chapters, totalCount, completedCount }) => {
                if (chapters.length === 0 && filterSub === 'all' && totalCount === 0) {
                  return null;
                }
                const isCollapsed = Boolean(collapsedSubjects[subject.id]);
                const pct =
                  totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

                return (
                  <Card key={subject.id}>
                    <button
                      type="button"
                      onClick={() => toggleSubjectCollapse(subject.id)}
                      className="flex w-full items-center justify-between gap-3 text-left"
                      aria-expanded={!isCollapsed}
                    >
                      <div className="flex items-center gap-2.5">
                        {isCollapsed ? (
                          <ChevronRight size={18} className="text-[var(--tx-2)]" />
                        ) : (
                          <ChevronDown size={18} className="text-[var(--tx-2)]" />
                        )}
                        <span
                          className="h-3 w-3 rounded-full"
                          style={{ background: subject.color }}
                        />
                        <span className="text-[15px] font-semibold text-[var(--tx)]">
                          {subject.e} {subject.name}
                        </span>
                      </div>
                      <span className="tnum text-[12px] text-[var(--tx-2)]">
                        {completedCount}/{totalCount} done ({pct}%)
                      </span>
                    </button>

                    {!isCollapsed && (
                      <div className="mt-3 divide-y divide-[var(--line)]">
                        {chapters.length === 0 ? (
                          <div className="py-4 text-center text-[13px] text-[var(--tx-2)]">
                            No chapters match the current filter in {subject.name}.
                          </div>
                        ) : (
                          chapters.map((ch) => {
                            const revs = getSortedChapterRevisions(ch);
                            const pyqSummary = getChapterPYQStats(state, ch.id);
                            const suggestedDraft = suggestedRevDrafts[ch.id];
                            const isPyqOpen = openPyqChapterId === ch.id;
                            const isConfPrompt = confidencePromptChapterId === ch.id;

                            return (
                              <div key={ch.id} className="space-y-2.5 py-3">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="text-[14.5px] font-semibold text-[var(--tx)]">
                                        {ch.name}
                                      </span>
                                      {ch.completedOn && ch.status === 'completed' && (
                                        <span className="tnum rounded-md bg-[var(--sf-2)] px-2 py-0.5 text-[12px] text-[var(--ok)]">
                                          Done {ch.completedOn}
                                        </span>
                                      )}
                                      {pyqSummary.attempted > 0 && (
                                        <span className="tnum rounded-md bg-[var(--sf-2)] px-2 py-0.5 text-[12px] text-[var(--ac)]">
                                          PYQ {pyqSummary.correct}/{pyqSummary.attempted} (
                                          {pyqSummary.accuracyPct}%)
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <div className="w-36">
                                      <Select
                                        value={ch.status}
                                        onChange={(nextVal) => {
                                          const nextStatus = nextVal as ChapterStatus;
                                          onUpdateChapter(ch.id, { status: nextStatus });
                                          if (
                                            nextStatus === 'completed' &&
                                            ch.status !== 'completed'
                                          ) {
                                            const base = todayKey;
                                            setSuggestedRevDrafts((prev) => ({
                                              ...prev,
                                              [ch.id]: [
                                                addD(base, 1),
                                                addD(base, 3),
                                                addD(base, 7),
                                                addD(base, 21),
                                              ],
                                            }));
                                            setConfidencePromptChapterId(ch.id);
                                          }
                                        }}
                                        ariaLabel={`Status for ${ch.name}`}
                                        options={STATUS_OPTIONS}
                                      />
                                    </div>

                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      icon={<Play size={13} />}
                                      onClick={() =>
                                        onStartChapterFocus(ch.subjectId, ch.id, ch.name)
                                      }
                                    >
                                      Focus
                                    </Button>

                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() =>
                                        setOpenPyqChapterId(isPyqOpen ? null : ch.id)
                                      }
                                    >
                                      PYQ
                                    </Button>

                                    <IconButton
                                      label={`Delete ${ch.name}`}
                                      onClick={() => onDeleteChapter(ch.id)}
                                    >
                                      <Trash2 size={16} />
                                    </IconButton>
                                  </div>
                                </div>

                                {/* Confidence 1-5 selector */}
                                <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-[var(--tx-2)]">
                                  <div className="flex items-center gap-1.5">
                                    <span>Confidence:</span>
                                    {([1, 2, 3, 4, 5] as const).map((lvl) => {
                                      const active = (ch.confidence ?? 0) >= lvl;
                                      return (
                                        <button
                                          key={lvl}
                                          type="button"
                                          onClick={() =>
                                            onUpdateChapter(ch.id, { confidence: lvl })
                                          }
                                          aria-label={`Set confidence ${lvl} of 5 for ${ch.name}`}
                                          className={`tnum h-6 w-6 rounded-md border text-[12px] font-semibold transition-colors ${
                                            active
                                              ? 'border-[var(--ac)] bg-[var(--ac-soft)] text-[var(--ac)]'
                                              : 'border-[var(--line)] bg-[var(--sf-2)] text-[var(--tx-3)]'
                                          }`}
                                        >
                                          {lvl}
                                        </button>
                                      );
                                    })}
                                    {isConfPrompt && (
                                      <span className="text-[12px] text-[var(--ac)]">
                                        Rate your confidence!
                                      </span>
                                    )}
                                  </div>

                                  {/* Add revision date inline */}
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      type="date"
                                      value={newRevDates[ch.id] || ''}
                                      onChange={(e) =>
                                        setNewRevDates((prev) => ({
                                          ...prev,
                                          [ch.id]: e.target.value,
                                        }))
                                      }
                                      aria-label={`Revision date for ${ch.name}`}
                                      className="h-8 rounded-lg border border-[var(--line)] bg-[var(--sf-2)] px-2 text-[12px] text-[var(--tx)]"
                                    />
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      onClick={() => {
                                        const dt = newRevDates[ch.id] || addD(todayKey, 3);
                                        onAddRevision(ch.id, dt);
                                        setNewRevDates((prev) => ({ ...prev, [ch.id]: '' }));
                                      }}
                                    >
                                      + Rev
                                    </Button>
                                  </div>
                                </div>

                                {/* Suggested Spaced Revisions */}
                                {suggestedDraft && (
                                  <div className="rounded-xl border border-[var(--ac-line)] bg-[var(--ac-soft)] p-3">
                                    <div className="split mb-2 flex-wrap gap-2">
                                      <span className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--ac)]">
                                        <Sparkles size={14} /> Suggested spaced revisions (+1, +3, +7, +21d)
                                      </span>
                                      <div className="flex gap-1.5">
                                        <Button
                                          variant="primary"
                                          size="sm"
                                          onClick={() => {
                                            for (const dt of suggestedDraft) {
                                              if (dt) onAddRevision(ch.id, dt);
                                            }
                                            setSuggestedRevDrafts((prev) => {
                                              const next = { ...prev };
                                              delete next[ch.id];
                                              return next;
                                            });
                                          }}
                                        >
                                          Schedule all 4
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() =>
                                            setSuggestedRevDrafts((prev) => {
                                              const next = { ...prev };
                                              delete next[ch.id];
                                              return next;
                                            })
                                          }
                                        >
                                          Dismiss
                                        </Button>
                                      </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                      {suggestedDraft.map((dVal, idx) => (
                                        <input
                                          key={idx}
                                          type="date"
                                          value={dVal}
                                          onChange={(e) => {
                                            const copy: [string, string, string, string] = [
                                              ...suggestedDraft,
                                            ] as [string, string, string, string];
                                            copy[idx] = e.target.value;
                                            setSuggestedRevDrafts((prev) => ({
                                              ...prev,
                                              [ch.id]: copy,
                                            }));
                                          }}
                                          className="h-8 rounded-lg border border-[var(--line)] bg-[var(--sf-1)] px-2 text-[12px] text-[var(--tx)]"
                                        />
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Inline PYQ Quick Drawer */}
                                {isPyqOpen && (
                                  <div className="rounded-xl border border-[var(--line)] bg-[var(--sf-2)] p-3">
                                    <div className="mb-2 text-[12px] font-semibold text-[var(--tx)]">
                                      Log PYQ batch for {ch.name}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <input
                                        type="number"
                                        min={1}
                                        value={pyqAttemptedDraft}
                                        onChange={(e) => setPyqAttemptedDraft(e.target.value)}
                                        placeholder="Attempted"
                                        aria-label="Attempted PYQs"
                                        className="h-9 w-24 rounded-lg border border-[var(--line)] bg-[var(--sf-1)] px-2.5 text-[13px] text-[var(--tx)]"
                                      />
                                      <input
                                        type="number"
                                        min={0}
                                        value={pyqCorrectDraft}
                                        onChange={(e) => setPyqCorrectDraft(e.target.value)}
                                        placeholder="Correct"
                                        aria-label="Correct PYQs"
                                        className="h-9 w-24 rounded-lg border border-[var(--line)] bg-[var(--sf-1)] px-2.5 text-[13px] text-[var(--tx)]"
                                      />
                                      <Button
                                        variant="primary"
                                        size="sm"
                                        onClick={() => {
                                          const att = Math.max(
                                            1,
                                            Math.round(Number(pyqAttemptedDraft) || 0)
                                          );
                                          const cor = Math.max(
                                            0,
                                            Math.min(
                                              att,
                                              Math.round(Number(pyqCorrectDraft) || 0)
                                            )
                                          );
                                          onAddPYQ({
                                            chapterId: ch.id,
                                            attempted: att,
                                            correct: cor,
                                            dayKey: todayKey,
                                          });
                                          setOpenPyqChapterId(null);
                                        }}
                                      >
                                        Save PYQ
                                      </Button>
                                    </div>
                                  </div>
                                )}

                                {/* Revisions pills */}
                                {revs.length > 0 && (
                                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                                    {revs.map((rev) => {
                                      const isOverdue = !rev.done && rev.date < todayKey;
                                      return (
                                        <div
                                          key={rev.id}
                                          className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[12px] ${
                                            rev.done
                                              ? 'border-[var(--ok)]/30 bg-[var(--ok)]/10 text-[var(--ok)]'
                                              : isOverdue
                                                ? 'border-[var(--bad)]/40 bg-[var(--bad)]/10 text-[var(--bad)]'
                                                : 'border-[var(--line)] bg-[var(--sf-2)] text-[var(--tx-2)]'
                                          }`}
                                        >
                                          <button
                                            type="button"
                                            onClick={() => onToggleRevision(ch.id, rev.id)}
                                            className="flex items-center gap-1 font-semibold"
                                          >
                                            <Check size={12} />
                                            <span>{rev.label}</span>
                                          </button>
                                          <input
                                            type="date"
                                            value={rev.date}
                                            onChange={(e) =>
                                              onUpdateRevisionDate(
                                                ch.id,
                                                rev.id,
                                                e.target.value
                                              )
                                            }
                                            aria-label={`${rev.label} revision date`}
                                            className="tnum bg-transparent text-[12px] focus:outline-none"
                                          />
                                          <button
                                            type="button"
                                            onClick={() => onDeleteRevision(ch.id, rev.id)}
                                            aria-label={`Delete ${rev.label}`}
                                            className="text-[var(--tx-3)] hover:text-[var(--bad)]"
                                          >
                                            ×
                                          </button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}

          {/* Bulk Paste Chapters Sheet */}
          <Sheet
            open={showBulkPasteSheet}
            onClose={() => setShowBulkPasteSheet(false)}
            title="Bulk paste syllabus chapters"
          >
            <form onSubmit={handleBulkSubmit} className="space-y-4">
              <Field label="Target subject">
                <Select
                  value={bulkSubjectId}
                  onChange={setBulkSubjectId}
                  options={state.subjects
                    .filter((s) => !s.arch)
                    .map((s) => ({
                      value: s.id,
                      label: `${s.e} ${s.name}`,
                    }))}
                />
              </Field>
              <Field
                label="Chapters (one per line)"
                hint="Paste chapter titles from NCERT or your coaching planner"
              >
                <textarea
                  rows={8}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={'Units and Measurements\nMotion in a Straight Line\nMotion in a Plane'}
                  className="w-full rounded-xl border border-[var(--line)] bg-[var(--sf-2)] p-3 text-[14px] text-[var(--tx)]"
                />
              </Field>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setShowBulkPasteSheet(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={!bulkText.trim()}
                >
                  Import chapters
                </Button>
              </div>
            </form>
          </Sheet>
        </div>
      )}

      {/* ==========================================
          SUB-VIEW 2: MOCK TESTS & ANALYTICS
          ========================================== */}
      {activeUiTab === 'mocks' && (
        <div className="space-y-4">
          <Card>
            <div className="split mb-3 flex-wrap gap-2">
              <div>
                <h3 className="text-[16px] font-semibold text-[var(--tx)]">
                  Mock test performance &amp; accuracy
                </h3>
                <p className="text-[12px] text-[var(--tx-2)]">
                  NEET 720-mark progression, negative marking analysis &amp; subject breakdown
                </p>
              </div>
              <Button
                variant="primary"
                size="sm"
                icon={<Plus size={16} />}
                onClick={onOpenNewMock}
              >
                Log mock test
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <Stat
                label="Mocks logged"
                value={String(state.mocks.length)}
                sub="Full & part tests"
              />
              <Stat
                label="Last 5 avg"
                value={
                  state.mocks.length > 0 ? `${mocksOverview.avgLast5Score}/720` : '—'
                }
                sub="Recent trend"
              />
              <Stat
                label="Personal best"
                value={state.mocks.length > 0 ? `${mocksOverview.bestScore}/720` : '—'}
                sub={`Target ${targetScore}`}
              />
              <div className="rounded-xl border border-[var(--line)] bg-[var(--sf-2)] p-3">
                <Field label="Target score">
                  <input
                    type="number"
                    min={100}
                    max={720}
                    step={5}
                    value={targetScore}
                    onChange={(e) =>
                      onUpdateTargetScore(
                        Math.max(100, Math.min(720, Number(e.target.value) || 650))
                      )
                    }
                    aria-label="Target mock score"
                    className="tnum h-8 w-full rounded-lg border border-[var(--line)] bg-[var(--sf-1)] px-2 text-[14px] font-semibold text-[var(--ac)]"
                  />
                </Field>
              </div>
            </div>

            {mocksOverview.lowestAccuracySubject && (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-[var(--warn)]/30 bg-[var(--warn)]/10 px-3 py-2 text-[12.5px] text-[var(--warn)]">
                <AlertTriangle size={15} />
                <span>
                  Focus area: <strong>{mocksOverview.lowestAccuracySubject.e} {mocksOverview.lowestAccuracySubject.name}</strong> has the lowest accuracy ({mocksOverview.lowestAccuracySubject.accuracyPct}%) across recent mocks.
                </span>
              </div>
            )}
          </Card>

          {/* Mock List */}
          {mocksOverview.newestFirst.length === 0 ? (
            <EmptyState
              icon={<Calendar size={22} />}
              title="No mock tests logged yet"
              description="Log your coaching or full-length NEET mock scores to visualize score trends, accuracy, and negative marking losses."
              action={
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Plus size={15} />}
                  onClick={onOpenNewMock}
                >
                  Log first mock test
                </Button>
              }
            />
          ) : (
            <div className="space-y-3">
              {mocksOverview.newestFirst.map(({ mock, report }) => (
                <Card key={mock.id}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-[15px] font-semibold text-[var(--tx)]">
                          {mock.name}
                        </h4>
                        <span className="tnum rounded-lg bg-[var(--ac-soft)] px-2.5 py-0.5 text-[13px] font-bold text-[var(--ac)]">
                          {report.totalScore} / {mock.maxMarks} ({report.pct}%)
                        </span>
                      </div>
                      <p className="tnum mt-0.5 text-[12px] text-[var(--tx-2)]">
                        {mock.dayKey} · Accuracy {report.accuracyPct}% · +{report.totalCorrect} correct · −{report.totalWrong} wrong · {report.totalUnattempted} left
                      </p>
                      {mock.note && (
                        <p className="mt-1 text-[13px] text-[var(--tx-2)]">{mock.note}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <IconButton
                        label={`Edit ${mock.name}`}
                        onClick={() => onEditMock(mock.id)}
                      >
                        <Edit3 size={16} />
                      </IconButton>
                      <IconButton
                        label={`Delete ${mock.name}`}
                        onClick={() => onDeleteMock(mock.id)}
                      >
                        <Trash2 size={16} />
                      </IconButton>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    {report.bySubject
                      .filter((bs) => bs.attempted > 0 || bs.unattempted > 0)
                      .map((bs) => (
                        <div
                          key={bs.subjectId}
                          className="rounded-xl border border-[var(--line)] bg-[var(--sf-2)] p-2.5"
                        >
                          <div className="split text-[12px]">
                            <span className="font-medium text-[var(--tx)]">
                              {bs.e} {bs.name}
                            </span>
                            <span className="tnum font-semibold text-[var(--tx)]">
                              {bs.score} pts ({bs.accuracyPct}%)
                            </span>
                          </div>
                          <div className="tnum mt-1 text-[12px] text-[var(--tx-3)]">
                            +{bs.correct} / −{bs.wrong} / {bs.unattempted} skip
                          </div>
                        </div>
                      ))}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ==========================================
          SUB-VIEW 3: MISTAKES
          ========================================== */}
      {activeUiTab === 'mistakes' && (
        <MistakesView
          state={state}
          todayKey={todayKey}
          onAddMistake={onAddMistake}
          onToggleResolved={onToggleMistakeResolved}
          onDeleteMistake={onDeleteMistake}
          onScheduleRevision={onAddRevision}
        />
      )}

      {/* ==========================================
          SUB-VIEW 4: DOUBTS
          ========================================== */}
      {activeUiTab === 'doubts' && (
        <DoubtsView
          state={state}
          onAddDoubt={onAddDoubt}
          onToggleDoubtResolved={onToggleDoubtResolved}
          onDeleteDoubt={onDeleteDoubt}
        />
      )}

      {/* ==========================================
          SUB-VIEW 5: PYQ TRACKER
          ========================================== */}
      {activeUiTab === 'pyqs' && (
        <PYQView
          state={state}
          todayKey={todayKey}
          onAddPYQ={onAddPYQ}
          onDeletePYQ={onDeletePYQ}
        />
      )}
    </div>
  );
};
