import React, { Suspense, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Edit3,
  Flame,
  Gauge,
  Minus,
  MoreHorizontal,
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
import {
  BLEEDING_CATEGORIES,
  aggregateMockDiagnostics,
  computeCleanScore,
  formatSubjectTimeSummary,
  hasBleedingEntries,
  loadAllMockDiagnostics,
} from '../utils/mockDiagnostics';
import {
  MOCK_LEAK_CATEGORIES,
  NEET_MARKS_PER_WRONG_SWING,
  aggregateAvoidableBleed,
  computeNetMarksBleed,
  createEmptyMockLeaks,
  getTotalLeakErrors,
  loadAllMockLeaks,
  saveMockLeaks,
  type MockLeakCategoryKey,
  type MockLeakCounts,
  type MockLeakMap,
} from '../utils/mockLeaks';
import {
  loadAllMockReportDetails,
  type ComputedMockReport,
  type MockReportDetails,
  type MockReportMap,
} from '../utils/mockReport';
import type { ScoreLabSidecarSeed } from '../utils/scoreLab';
import { triggerHaptic } from '../utils/haptics';
import { computeUiPaceReport } from '../utils/uiHelpers';
import { formatChapterConfidence } from '../utils/chartHelpers';
import { ErrorBoundary } from './ErrorBoundary';
import { computeVaultCounts } from '../utils/vaultLogic';
import { listVaultItems } from '../utils/vaultStore';
import { MockReportSheet } from './MockReportSheet';
import { PYQView } from './PYQView';
import { ScoreLabSheet } from './ScoreLabSheet';
import {
  TargetsCalendarView,
  type ReminderDraftInput,
  type TargetDraftInput,
} from './TargetsCalendarView';
import type { VaultCaptureRequest } from './VaultView';
import { SyllabusAstrolabeScene } from './three/SyllabusAstrolabeScene';
import {
  AreaLineChart,
  Button,
  Card,
  Chip,
  DonutChart,
  Field,
  IconButton,
  Meter,
  SectionHeader,
  Segmented,
  Select,
  Sheet,
  Skeleton,
  WindowedList,
} from './ui';

const VaultView = React.lazy(() =>
  import('./VaultView').then((m) => ({ default: m.VaultView }))
);

interface PrepViewProps {
  state: PulseHabitState;
  todayKey: string;
  subTab: PrepSubTab;
  pyqJumpNonce?: number;
  vaultCaptureRequest?: VaultCaptureRequest | null;
  targetComposerRequest?: { kind: 'target' | 'reminder'; nonce: number } | null;
  activeTimerText?: string | null;
  onNotify?: (msg: string, undo?: () => void) => void;
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
  onSyncMockFromReport?: (mockId: string, details: MockReportDetails) => void;
  onUpdateTargetScore: (nextTarget: number) => void;
  onAddMistake?: (
    entry: Omit<MistakeEntry, 'id' | 'createdAt' | 'updatedAt' | 'resolved'>
  ) => void;
  onToggleMistakeResolved: (id: string) => void;
  onDeleteMistake: (id: string) => void;
  onAddDoubt?: (doubt: Omit<Doubt, 'id' | 'createdAt' | 'resolved'>) => void;
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
  onAddTarget?: (draft: TargetDraftInput) => void;
  onUpdateTarget?: (id: string, draft: TargetDraftInput) => void;
  onToggleTargetItem?: (targetId: string, itemId: string) => void;
  onAddTargetItem?: (targetId: string, text: string) => void;
  onDeleteTargetItem?: (targetId: string, itemId: string) => void;
  onToggleArchiveTarget?: (targetId: string) => void;
  onDeleteTarget?: (targetId: string) => void;
  onAddReminder?: (draft: ReminderDraftInput) => void;
  onUpdateReminder?: (id: string, draft: ReminderDraftInput) => void;
  onToggleReminderDone?: (id: string) => void;
  onDeleteReminder?: (id: string) => void;
}

export type PrepUiTab = 'syllabus' | 'targets' | 'mocks' | 'vault' | 'pyqs';

const STATUS_OPTIONS: Array<{ value: ChapterStatus; label: string }> = [
  { value: 'notStarted', label: 'Not started' },
  { value: 'inProgress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
];

export const PrepView: React.FC<PrepViewProps> = ({
  state,
  todayKey,
  subTab,
  pyqJumpNonce,
  vaultCaptureRequest,
  targetComposerRequest,
  activeTimerText,
  onNotify,
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
  onSyncMockFromReport,
  onUpdateTargetScore,
  onToggleMistakeResolved,
  onDeleteMistake,
  onToggleDoubtResolved,
  onDeleteDoubt,
  onAddPYQ,
  onDeletePYQ,
  onStartChapterFocus,
  onAddTarget,
  onUpdateTarget,
  onToggleTargetItem,
  onAddTargetItem,
  onDeleteTargetItem,
  onToggleArchiveTarget,
  onDeleteTarget,
  onAddReminder,
  onUpdateReminder,
  onToggleReminderDone,
  onDeleteReminder,
}) => {
  const [showPyqsTab, setShowPyqsTab] = useState<boolean>(false);
  const [vaultChapterJump, setVaultChapterJump] = useState<{
    nonce: number;
    subjectId: string;
    chapterId: string;
  } | null>(null);
  const [chapterVaultCounts, setChapterVaultCounts] = useState<
    Record<string, { total: number; active: number }>
  >({});

  const normalizedSubTab: PrepUiTab =
    subTab === 'mistakes' || subTab === 'doubts' ? 'vault' : subTab;
  const activeUiTab: PrepUiTab = showPyqsTab ? 'pyqs' : normalizedSubTab;

  useEffect(() => {
    if (pyqJumpNonce && pyqJumpNonce > 0) {
      setShowPyqsTab(true);
    }
  }, [pyqJumpNonce]);

  useEffect(() => {
    if (vaultCaptureRequest && vaultCaptureRequest.nonce > 0) {
      setShowPyqsTab(false);
    }
  }, [vaultCaptureRequest]);

  useEffect(() => {
    if (targetComposerRequest && targetComposerRequest.nonce > 0) {
      setShowPyqsTab(false);
    }
  }, [targetComposerRequest]);

  useEffect(() => {
    if (subTab === 'targets') {
      setShowPyqsTab(false);
    }
  }, [subTab]);

  useEffect(() => {
    let cancelled = false;
    void listVaultItems()
      .then((list) => {
        if (cancelled) return;
        setChapterVaultCounts(computeVaultCounts(list).byChapter);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeUiTab]);

  const handleSelectUiTab = (next: PrepUiTab) => {
    if (next === 'pyqs') {
      setShowPyqsTab(true);
    } else if (next === 'vault') {
      setShowPyqsTab(false);
      onChangeSubTab('mistakes');
    } else {
      setShowPyqsTab(false);
      onChangeSubTab(next);
    }
  };

  const defaultSubjectId = state.subjects[0]?.id || 'sub_phy';
  const [newChapterSub, setNewChapterSub] = useState<string>(defaultSubjectId);
  const [newChapterName, setNewChapterName] = useState<string>('');

  const [filterSub, setFilterSub] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | ChapterStatus>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [collapsedSubjects, setCollapsedSubjects] = useState<Record<string, boolean>>({});
  const [newRevDates, setNewRevDates] = useState<Record<string, string>>({});
  const [suggestedRevDrafts, setSuggestedRevDrafts] = useState<
    Record<string, string[]>
  >({});

  // Bulk Paste Sheet
  const [showBulkPasteSheet, setShowBulkPasteSheet] = useState<boolean>(false);
  const [bulkSubjectId, setBulkSubjectId] = useState<string>(defaultSubjectId);
  const [bulkText, setBulkText] = useState<string>('');

  // Inline PYQ Drawer & Expandable 2-Line Chapter Row state
  const [expandedChapterId, setExpandedChapterId] = useState<string | null>(null);
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

  const [mockLeaksMap, setMockLeaksMap] = useState<MockLeakMap>(() =>
    loadAllMockLeaks()
  );
  const [mockReportMap, setMockReportMap] = useState<MockReportMap>(() =>
    loadAllMockReportDetails()
  );
  const [expandedLeakMockId, setExpandedLeakMockId] = useState<string | null>(null);
  const [activeReportMockId, setActiveReportMockId] = useState<string | null>(null);
  const [scoreLabOpen, setScoreLabOpen] = useState<boolean>(false);
  const [scoreLabFocusMockId, setScoreLabFocusMockId] = useState<string | undefined>(
    undefined
  );
  const [scoreLabSidecarSeed, setScoreLabSidecarSeed] =
    useState<ScoreLabSidecarSeed | null>(null);

  useEffect(() => {
    setMockLeaksMap(loadAllMockLeaks());
    setMockReportMap(loadAllMockReportDetails());
  }, [state.mocks]);

  const activeReportMock = useMemo(
    () =>
      activeReportMockId
        ? state.mocks.find((m) => m.id === activeReportMockId) ?? null
        : null,
    [activeReportMockId, state.mocks]
  );

  const handleOpenScoreLabFromHeader = () => {
    triggerHaptic('tap');
    setScoreLabFocusMockId(undefined);
    setScoreLabSidecarSeed(null);
    setScoreLabOpen(true);
  };

  const handleOpenScoreLabFromReport = (computed: ComputedMockReport) => {
    setActiveReportMockId(null);
    setScoreLabFocusMockId(computed.mockId);
    setScoreLabSidecarSeed({
      overallScore: computed.overallScore,
      phyScore: computed.phyScore,
      chemBioScore: computed.chemScore + computed.bioScore,
      wrongCount: computed.wrong,
    });
    setScoreLabOpen(true);
  };

  const avoidableBleed = useMemo(
    () => aggregateAvoidableBleed(state.mocks, mockLeaksMap),
    [state.mocks, mockLeaksMap]
  );

  const handleAdjustMockLeak = (
    mockId: string,
    key: MockLeakCategoryKey,
    delta: number
  ) => {
    triggerHaptic('tap');
    setMockLeaksMap((prev) => {
      const current: MockLeakCounts = prev[mockId]?.counts
        ? { ...prev[mockId].counts }
        : createEmptyMockLeaks();
      const nextVal = Math.max(0, Math.min(200, current[key] + delta));
      const nextCounts: MockLeakCounts = { ...current, [key]: nextVal };
      saveMockLeaks(mockId, nextCounts);
      return loadAllMockLeaks();
    });
  };

  const mocksOverview = useMemo(() => computeMocksOverview(state), [state]);
  const mockDiagnosticsMap = useMemo(
    () => loadAllMockDiagnostics(),
    [state.mocks]
  );
  const mockDiagnosticsAgg = useMemo(
    () => aggregateMockDiagnostics(state.mocks, mockDiagnosticsMap),
    [state.mocks, mockDiagnosticsMap]
  );
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
          { value: 'targets', label: 'Targets' },
          { value: 'mocks', label: 'Mocks' },
          { value: 'vault', label: 'Vault' },
          { value: 'pyqs', label: 'PYQs' },
        ]}
      />

      {/* ==========================================
          SUB-VIEW 0: TARGET SPRINTS, REMINDERS & CALENDAR
          ========================================== */}
      {activeUiTab === 'targets' && (
        <TargetsCalendarView
          state={state}
          todayKey={todayKey}
          composerRequest={targetComposerRequest}
          onAddTarget={(draft) => onAddTarget?.(draft)}
          onUpdateTarget={(id, draft) => onUpdateTarget?.(id, draft)}
          onToggleTargetItem={(targetId, itemId) => onToggleTargetItem?.(targetId, itemId)}
          onAddTargetItem={(targetId, text) => onAddTargetItem?.(targetId, text)}
          onDeleteTargetItem={(targetId, itemId) => onDeleteTargetItem?.(targetId, itemId)}
          onToggleArchiveTarget={(targetId) => onToggleArchiveTarget?.(targetId)}
          onDeleteTarget={(targetId) => onDeleteTarget?.(targetId)}
          onAddReminder={(draft) => onAddReminder?.(draft)}
          onUpdateReminder={(id, draft) => onUpdateReminder?.(id, draft)}
          onToggleReminderDone={(id) => onToggleReminderDone?.(id)}
          onDeleteReminder={(id) => onDeleteReminder?.(id)}
          onShowToast={(msg) => onNotify?.(msg)}
        />
      )}

      {/* ==========================================
          SUB-VIEW 1: SYLLABUS & REVISIONS
          ========================================== */}
      {activeUiTab === 'syllabus' && (
        <div className="dh-amoled-flow">
          {/* Optional 3D Syllabus Astrolabe Scene */}
          <ErrorBoundary
            variant="section"
            scopeLabel="3D syllabus astrolabe"
            resetKey={`${state.set.ui3d || 'auto'}-${state.set.ui3dQuality || 'auto'}`}
            silentFallback={null}
          >
            <SyllabusAstrolabeScene
              subjects={state.subjects}
              chapters={state.chapters}
              dueChapterIds={dueChapterIds}
              ui3dSetting={state.set.ui3d || 'auto'}
              ui3dQuality={state.set.ui3dQuality || 'auto'}
              activeSubjectId={filterSub}
              onSelectSubjectFilter={setFilterSub}
              onSelectChapter={(ch) =>
                onStartChapterFocus(ch.subjectId, ch.id, ch.name)
              }
              onOpenAddChapter={() => {
                const el = document.getElementById('newChapterNameInput');
                el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el?.focus();
              }}
              onOpenBulkPaste={() => setShowBulkPasteSheet(true)}
            />
          </ErrorBoundary>

          {/* Syllabus Pace Calculator — Borderless AMOLED Ledger */}
          <section className="dh-amoled-section">
            <div className="dh-eyebrow-row">
              <div className="min-w-0">
                <h3 className="dh-eyebrow">Syllabus pace</h3>
                {paceReport.exam && (
                  <p className="tnum mt-1 text-[13px] text-[var(--tx-2)]">
                    {paceReport.exam.title} ({paceReport.exam.date}) · {paceReport.revisionBufferDays}d buffer
                  </p>
                )}
              </div>
              {paceReport.overall.status !== 'no-exam' &&
                paceReport.overall.status !== 'past-exam' &&
                paceReport.overall.status !== 'no-chapters' && (
                  <span
                    className="tnum text-[13px] font-semibold"
                    style={{
                      color:
                        paceReport.overall.status === 'ahead' ||
                        paceReport.overall.status === 'completed'
                          ? 'var(--ok-ink)'
                          : paceReport.overall.status === 'on track'
                            ? 'var(--ac-ink)'
                            : 'var(--warn-ink)',
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
              <div className="dh-empty-inline">
                <span>Add an exam D-Day in Settings to calculate your weekly chapter pace.</span>
              </div>
            ) : paceReport.overall.status === 'past-exam' ? (
              <div className="dh-empty-inline">
                <span>Exam date ({paceReport.exam?.date}) passed — update it in Settings → Exams.</span>
              </div>
            ) : paceReport.overall.status === 'no-chapters' ? (
              <div className="dh-empty-inline">
                <span>Add chapters below to project completion before {paceReport.syllabusEndDate}.</span>
              </div>
            ) : (
              <div className="dh-ledger-2x2">
                <div className="dh-ledger-cell">
                  <div className="dh-ledger-label">Deadline</div>
                  <div className="dh-ledger-val tnum">{paceReport.syllabusEndDate || '—'}</div>
                  <div className="dh-ledger-sub tnum">
                    {Math.max(0, paceReport.daysToSyllabusEnd ?? 0)}d left
                  </div>
                </div>
                <div className="dh-ledger-cell">
                  <div className="dh-ledger-label">Required pace</div>
                  <div className="dh-ledger-val tnum">{paceReport.overall.requiredPerWeek}/wk</div>
                  <div className="dh-ledger-sub tnum">
                    {paceReport.overall.remaining} ch left
                  </div>
                </div>
                <div className="dh-ledger-cell">
                  <div className="dh-ledger-label">28d velocity</div>
                  <div className="dh-ledger-val tnum">{paceReport.overall.actualPerWeek}/wk</div>
                  <div className="dh-ledger-sub tnum">
                    {paceReport.overall.completedLast28Days} ch in 28d
                  </div>
                </div>
                <div className="dh-ledger-cell">
                  <div className="dh-ledger-label">Projected finish</div>
                  <div className="dh-ledger-val tnum">
                    {paceReport.overall.projectedFinishDate || 'Need 1+ done'}
                  </div>
                  <div className="dh-ledger-sub">At current pace</div>
                </div>
              </div>
            )}
          </section>

          {/* Completion per Subject Donut + Progress Rows */}
          <section className="dh-amoled-section">
            <div className="dh-eyebrow-row">
              <div>
                <h3 className="dh-eyebrow">Subject completion</h3>
                <p className="tnum mt-1 text-[13px] text-[var(--tx-2)]">
                  {syllabusMetrics.completed} of {syllabusMetrics.total} done ({syllabusMetrics.pct}%) · {syllabusMetrics.inProgress} active
                </p>
              </div>
              <span className="tnum text-[14px] font-semibold text-[var(--ac-ink)]">
                {syllabusMetrics.pct}%
              </span>
            </div>

            <DonutChart
              segments={syllabusMetrics.bySubject.map((row) => ({
                label: row.subject.name,
                value: row.completed,
                color: row.subject.color,
                detail: `${row.completed}/${row.total} (${row.pct}%)${
                  row.inProgress > 0 ? ` · ${row.inProgress} active` : ''
                }`,
                progressPct: row.pct,
              }))}
              centerLabel={`${syllabusMetrics.pct}%`}
              centerSublabel={`${syllabusMetrics.completed}/${syllabusMetrics.total}`}
              valueFormatter={(v) => `${v} ch`}
              ariaLabel="Syllabus completion breakdown by subject"
            />
          </section>

          {/* Study Next Recommender */}
          {studyNextList.length > 0 && (
            <section className="dh-amoled-section">
              <SectionHeader title="Recommended next" />
              <div className="dh-hairline-list">
                {studyNextList.map((item) => {
                  const sub = getSubject(state, item.chapter.subjectId);
                  return (
                    <div
                      key={item.chapter.id}
                      className="dh-hairline-row flex flex-wrap items-center justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className="dh-sub-dot"
                            style={{ background: sub.color }}
                            aria-hidden="true"
                          />
                          <span className="text-[14px] font-medium text-[var(--tx)]">
                            {item.chapter.name}
                          </span>
                          <span className="text-[13px] text-[var(--tx-3)]">
                            {sub.name}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[13px] text-[var(--tx-2)]">
                          {item.reasons.join(' · ')}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="dh-ghost-pill"
                        onClick={() =>
                          onStartChapterFocus(
                            item.chapter.subjectId,
                            item.chapter.id,
                            item.chapter.name
                          )
                        }
                      >
                        Focus ›
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Add Chapter & Bulk Paste */}
          <section className="dh-amoled-section">
            <div className="dh-eyebrow-row">
              <h3 className="dh-eyebrow">Add syllabus chapters</h3>
              <button
                type="button"
                className="dh-eyebrow-link"
                onClick={() => setShowBulkPasteSheet(true)}
              >
                Bulk paste ›
              </button>
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
                      label: s.name,
                    }))}
                />
              </div>
              <div className="sm:col-span-6">
                <input
                  id="newChapterNameInput"
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
                  variant="secondary"
                  className="w-full"
                  disabled={!newChapterName.trim()}
                >
                  Add
                </Button>
              </div>
            </form>
          </section>

          {/* Search & Filters + Collapsible Subject Chapter Groups */}
          <section className="dh-amoled-section">
            <SectionHeader title="Chapters" />

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
                      {s.name}
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

            {state.chapters.length === 0 ? (
              <div className="dh-empty-inline mt-2">
                <span>No syllabus chapters yet.</span>
                <button
                  type="button"
                  className="dh-eyebrow-link"
                  onClick={() => setShowBulkPasteSheet(true)}
                >
                  Bulk paste ›
                </button>
              </div>
            ) : (
              <div className="mt-2 space-y-6">
                {chaptersBySubject.map(({ subject, chapters, totalCount, completedCount }) => {
                  if (chapters.length === 0 && filterSub === 'all' && totalCount === 0) {
                    return null;
                  }
                  const isCollapsed = Boolean(collapsedSubjects[subject.id]);
                  const pct =
                    totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

                  return (
                    <div key={subject.id}>
                      <button
                        type="button"
                        onClick={() => toggleSubjectCollapse(subject.id)}
                        className="dh-sub-group-toggle"
                        aria-expanded={!isCollapsed}
                      >
                        <div className="flex items-center gap-2">
                          {isCollapsed ? (
                            <ChevronRight size={16} className="text-[var(--tx-3)]" />
                          ) : (
                            <ChevronDown size={16} className="text-[var(--tx-3)]" />
                          )}
                          <span
                            className="dh-sub-dot"
                            style={{ background: subject.color }}
                            aria-hidden="true"
                          />
                          <span className="text-[14.5px] font-semibold text-[var(--tx)]">
                            {subject.name}
                          </span>
                        </div>
                        <span className="tnum text-[13px] text-[var(--tx-2)]">
                          {completedCount}/{totalCount} ({pct}%)
                        </span>
                      </button>

                      {!isCollapsed && (
                        <div>
                          {chapters.length === 0 ? (
                            <div className="dh-empty-inline">
                              <span>No chapters match the current filter in {subject.name}.</span>
                            </div>
                          ) : (
                            <WindowedList
                              items={chapters}
                              threshold={100}
                              estimatedRowHeight={68}
                              itemLabel="chapters"
                              className="dh-hairline-list"
                              getKey={(ch) => ch.id}
                              renderItem={(ch) => {
                                const revs = getSortedChapterRevisions(ch);
                                const pyqSummary = getChapterPYQStats(state, ch.id);
                                const suggestedDraft = suggestedRevDrafts[ch.id];
                                const isPyqOpen = openPyqChapterId === ch.id;
                                const isConfPrompt = confidencePromptChapterId === ch.id;
                                const isExpanded =
                                  expandedChapterId === ch.id ||
                                  isPyqOpen ||
                                  Boolean(suggestedDraft) ||
                                  isConfPrompt;
                                const statusLabel =
                                  ch.status === 'completed'
                                    ? 'Completed'
                                    : ch.status === 'inProgress'
                                      ? 'In progress'
                                      : 'Not started';
                                const activeVaultCount = chapterVaultCounts[ch.id]?.active ?? 0;

                                const metaParts: string[] = [statusLabel];
                                const confText = formatChapterConfidence(ch.confidence);
                                if (confText) metaParts.push(confText);
                                if (pyqSummary.attempted > 0) {
                                  metaParts.push(`PYQ ${pyqSummary.accuracyPct}%`);
                                }
                                if (revs.length > 0) {
                                  metaParts.push(`${revs.length} rev`);
                                }
                                if (ch.completedOn && ch.status === 'completed') {
                                  metaParts.push(ch.completedOn);
                                }

                                return (
                                  <div className="dh-ch-row">
                                    {/* Collapsed 2-Line Head */}
                                    <div className="dh-ch-row-head">
                                      <button
                                        type="button"
                                        className="dh-ch-row-main"
                                        aria-expanded={isExpanded}
                                        onClick={() =>
                                          setExpandedChapterId((prev) =>
                                            prev === ch.id ? null : ch.id
                                          )
                                        }
                                      >
                                        <div className="dh-ch-row-title">
                                          <span
                                            className="dh-sub-dot"
                                            style={{
                                              background:
                                                ch.status === 'completed'
                                                  ? 'var(--ok)'
                                                  : ch.status === 'inProgress'
                                                    ? subject.color
                                                    : 'var(--tx-3)',
                                            }}
                                            aria-hidden="true"
                                          />
                                          <span className="truncate">{ch.name}</span>
                                          {activeVaultCount > 0 && (
                                            <span className="tnum shrink-0 text-[12px] font-medium text-[var(--tx-3)]">
                                              · {activeVaultCount} Vault
                                            </span>
                                          )}
                                        </div>
                                        <div className="dh-ch-row-sub tnum">
                                          {metaParts.join(' · ')}
                                        </div>
                                      </button>

                                      <div className="flex shrink-0 items-center gap-1.5">
                                        <button
                                          type="button"
                                          className="dh-ghost-pill"
                                          aria-label={`Start focus for ${ch.name}`}
                                          onClick={() =>
                                            onStartChapterFocus(ch.subjectId, ch.id, ch.name)
                                          }
                                        >
                                          <Play size={12} aria-hidden="true" />
                                          Focus
                                        </button>
                                        <IconButton
                                          size={36}
                                          label={`More actions for ${ch.name}`}
                                          aria-expanded={isExpanded}
                                          onClick={() =>
                                            setExpandedChapterId((prev) =>
                                              prev === ch.id ? null : ch.id
                                            )
                                          }
                                        >
                                          <MoreHorizontal size={16} />
                                        </IconButton>
                                      </div>
                                    </div>

                                    {/* Expanded Inline Controls Tray */}
                                    {isExpanded && (
                                      <div className="dh-ch-tray">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                          <div className="w-40">
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
                                                  const intervals =
                                                    state.set.revisionIntervals &&
                                                    state.set.revisionIntervals.length > 0
                                                      ? state.set.revisionIntervals
                                                      : [1, 3, 7, 21];
                                                  setSuggestedRevDrafts((prev) => ({
                                                    ...prev,
                                                    [ch.id]: intervals.map((d) => addD(base, d)),
                                                  }));
                                                  setConfidencePromptChapterId(ch.id);
                                                }
                                              }}
                                              ariaLabel={`Status for ${ch.name}`}
                                              options={STATUS_OPTIONS}
                                            />
                                          </div>

                                          <div className="flex flex-wrap items-center gap-1.5">
                                            <button
                                              type="button"
                                              className="dh-ghost-pill"
                                              onClick={() =>
                                                setOpenPyqChapterId(isPyqOpen ? null : ch.id)
                                              }
                                            >
                                              PYQ
                                            </button>
                                            {activeVaultCount > 0 && (
                                              <button
                                                type="button"
                                                className="dh-ghost-pill tnum"
                                                onClick={() => {
                                                  setVaultChapterJump({
                                                    nonce: Date.now(),
                                                    subjectId: ch.subjectId,
                                                    chapterId: ch.id,
                                                  });
                                                  handleSelectUiTab('vault');
                                                }}
                                              >
                                                <Camera size={12} strokeWidth={1.75} aria-hidden="true" />
                                                Vault · {activeVaultCount}
                                              </button>
                                            )}
                                            <IconButton
                                              size={36}
                                              label={`Delete ${ch.name}`}
                                              onClick={() => onDeleteChapter(ch.id)}
                                            >
                                              <Trash2 size={15} />
                                            </IconButton>
                                          </div>
                                        </div>

                                        {/* Confidence 1-5 selector + Add revision */}
                                        <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-[var(--tx-2)]">
                                          <div className="flex items-center gap-1.5">
                                            <span>Confidence</span>
                                            {([1, 2, 3, 4, 5] as const).map((lvl) => {
                                              const active = (ch.confidence ?? 0) >= lvl;
                                              return (
                                                <button
                                                  key={lvl}
                                                  type="button"
                                                  onClick={() => {
                                                    onUpdateChapter(ch.id, { confidence: lvl });
                                                    if (isConfPrompt) {
                                                      setConfidencePromptChapterId(null);
                                                    }
                                                  }}
                                                  aria-label={`Set confidence ${lvl} of 5 for ${ch.name}`}
                                                  className={`tnum h-7 w-7 rounded-md border text-[13px] font-semibold transition-colors ${
                                                    active
                                                      ? 'border-[var(--ac)] bg-[var(--ac-soft)] text-[var(--ac-ink)]'
                                                      : 'border-[var(--line)] bg-[var(--sf-2)] text-[var(--tx-3)]'
                                                  }`}
                                                >
                                                  {lvl}
                                                </button>
                                              );
                                            })}
                                            {isConfPrompt && (
                                              <span className="text-[13px] text-[var(--ac-ink)]">
                                                Rate confidence
                                              </span>
                                            )}
                                          </div>

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
                                              className="h-8 rounded-lg border border-[var(--line)] bg-[var(--sf-2)] px-2 text-[13px] text-[var(--tx)]"
                                            />
                                            <button
                                              type="button"
                                              className="dh-ghost-pill"
                                              onClick={() => {
                                                const dt = newRevDates[ch.id] || addD(todayKey, 3);
                                                onAddRevision(ch.id, dt);
                                                setNewRevDates((prev) => ({ ...prev, [ch.id]: '' }));
                                              }}
                                            >
                                              + Rev
                                            </button>
                                          </div>
                                        </div>

                                        {/* Suggested Spaced Revisions */}
                                        {suggestedDraft && (
                                          <div className="rounded-xl border border-[var(--ac-line)] bg-[var(--ac-soft)] p-3">
                                            <div className="split mb-2 flex-wrap gap-2">
                                              <span className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--ac-ink)]">
                                                <Sparkles size={14} aria-hidden="true" /> Suggested spaced revisions (
                                                {(state.set.revisionIntervals &&
                                                state.set.revisionIntervals.length > 0
                                                  ? state.set.revisionIntervals
                                                  : [1, 3, 7, 21]
                                                )
                                                  .map((d) => `+${d}d`)
                                                  .join(', ')}
                                                )
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
                                                  Schedule all {suggestedDraft.length}
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
                                                  aria-label={`Suggested revision ${idx + 1} date for ${ch.name}`}
                                                  value={dVal}
                                                  onChange={(e) => {
                                                    const copy = [...suggestedDraft];
                                                    copy[idx] = e.target.value;
                                                    setSuggestedRevDrafts((prev) => ({
                                                      ...prev,
                                                      [ch.id]: copy,
                                                    }));
                                                  }}
                                                  className="h-8 rounded-lg border border-[var(--line)] bg-[var(--sf-1)] px-2 text-[13px] text-[var(--tx)]"
                                                />
                                              ))}
                                            </div>
                                          </div>
                                        )}

                                        {/* Inline PYQ Quick Drawer */}
                                        {isPyqOpen && (
                                          <div className="rounded-xl border border-[var(--line)] bg-[var(--sf-2)] p-3">
                                            <div className="mb-2 text-[13px] font-semibold text-[var(--tx)]">
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
                                                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[13px] ${
                                                    rev.done
                                                      ? 'border-[var(--ok)]/30 bg-[var(--ok)]/10 text-[var(--ok-ink)]'
                                                      : isOverdue
                                                        ? 'border-[var(--err)]/40 bg-[var(--err)]/10 text-[var(--err-ink)]'
                                                        : 'border-[var(--line)] bg-[var(--sf-2)] text-[var(--tx-2)]'
                                                  }`}
                                                >
                                                  <button
                                                    type="button"
                                                    onClick={() => onToggleRevision(ch.id, rev.id)}
                                                    className="flex items-center gap-1 font-semibold"
                                                  >
                                                    <Check size={12} aria-hidden="true" />
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
                                                    className="tnum bg-transparent text-[13px] focus:outline-none"
                                                  />
                                                  <button
                                                    type="button"
                                                    onClick={() => onDeleteRevision(ch.id, rev.id)}
                                                    aria-label={`Delete ${rev.label}`}
                                                    className="text-[var(--tx-3)] hover:text-[var(--err-ink)]"
                                                  >
                                                    ×
                                                  </button>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              }}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

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
                      label: s.name,
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
        <div className="dh-amoled-flow">
          {/* Tier-1 Hero Card — Single Gold CTA + Hairline 2x2 Ledger */}
          <Card className="dh-hero-tier1">
            <div className="split mb-4 flex-wrap gap-2">
              <h3 className="dh-eyebrow">Mock tests</h3>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-testid="score-lab-open-btn"
                  className="dh-ghost-pill"
                  onClick={handleOpenScoreLabFromHeader}
                >
                  <Gauge size={14} strokeWidth={1.85} aria-hidden="true" />
                  <span>Score Lab</span>
                </button>
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Plus size={15} />}
                  onClick={onOpenNewMock}
                >
                  Log mock test
                </Button>
              </div>
            </div>

            <div className="dh-ledger-2x2">
              <div className="dh-ledger-cell">
                <div className="dh-ledger-label">Mocks logged</div>
                <div className="dh-ledger-val tnum">{state.mocks.length}</div>
                <div className="dh-ledger-sub">Full &amp; part tests</div>
              </div>
              <div className="dh-ledger-cell">
                <div className="dh-ledger-label">Last 5 avg</div>
                <div className="dh-ledger-val tnum">
                  {state.mocks.length > 0 ? `${mocksOverview.avgLast5Score}/720` : '—'}
                </div>
                <div className="dh-ledger-sub">Recent trend</div>
              </div>
              <div className="dh-ledger-cell">
                <div className="dh-ledger-label">Personal best</div>
                <div className="dh-ledger-val tnum">
                  {state.mocks.length > 0 ? `${mocksOverview.bestScore}/720` : '—'}
                </div>
                <div className="dh-ledger-sub tnum">Target {targetScore}</div>
              </div>
              <div className="dh-ledger-cell">
                <label htmlFor="targetMockScoreInput" className="dh-ledger-label block">
                  Target score
                </label>
                <input
                  id="targetMockScoreInput"
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
                  className="tnum mt-1 h-8 w-20 rounded-none border-0 border-b border-[var(--hairline)] bg-transparent px-0 text-[18px] font-semibold text-[var(--ac-ink)] focus:border-[var(--ac)] focus:outline-none"
                />
              </div>
            </div>

            {mocksOverview.lowestAccuracySubject && (
              <div className="mt-4 flex items-center gap-2 border-t border-[var(--hairline)] pt-3 text-[13px] text-[var(--warn-ink)]">
                <AlertTriangle size={14} className="shrink-0" aria-hidden="true" />
                <span>
                  Lowest accuracy: <strong className="text-[var(--tx)]">{mocksOverview.lowestAccuracySubject.name}</strong> ({mocksOverview.lowestAccuracySubject.accuracyPct}%) across recent mocks.
                </span>
              </div>
            )}
          </Card>

          {/* Negative-Marking Leak Detector — Shown once at least 1 mock is logged */}
          {state.mocks.length > 0 && (
            <section className="dh-amoled-section" data-testid="avoidable-bleed-card">
              <div className="dh-eyebrow-row">
                <div className="flex items-center gap-2">
                  <Flame size={14} strokeWidth={1.9} className="dh-leak-icon" aria-hidden="true" />
                  <h3 className="dh-eyebrow">Avoidable marks bleed</h3>
                </div>
                {avoidableBleed.totalErrors > 0 && (
                  <div className="dh-leak-total-pill tnum" data-testid="avoidable-bleed-total">
                    −{avoidableBleed.totalNetMarksLost} marks
                  </div>
                )}
              </div>

              {avoidableBleed.totalErrors > 0 && avoidableBleed.topLeak ? (
                <div className="dh-leak-body">
                  <div className="dh-leak-callout" data-testid="avoidable-bleed-top-leak">
                    <span className="dh-leak-callout-label">#1 leak</span>
                    <strong className="text-[var(--tx)]">{avoidableBleed.topLeak.label}</strong>
                    <span className="tnum dh-leak-callout-val">
                      −{avoidableBleed.topLeak.netMarksLost} marks ({avoidableBleed.topLeak.count} Q · {avoidableBleed.topLeak.sharePct}%)
                    </span>
                    <span className="tnum dh-leak-callout-meta">
                      Last {avoidableBleed.includedMocksCount} tagged {avoidableBleed.includedMocksCount === 1 ? 'mock' : 'mocks'} · avg −{avoidableBleed.avgMarksLostPerMock}/mock
                    </span>
                  </div>

                  <div className="dh-leak-bars">
                    {avoidableBleed.categories.map((cat) => (
                      <div key={cat.key} className="dh-leak-bar-row">
                        <div className="dh-leak-bar-head">
                          <span className={`dh-leak-bar-name ${avoidableBleed.topLeak?.key === cat.key ? 'is-top' : ''}`}>
                            {cat.label}
                          </span>
                          <span className="tnum dh-leak-bar-metrics">
                            {cat.count} Q · −{cat.netMarksLost}m
                          </span>
                        </div>
                        <div className="dh-leak-track" aria-hidden="true">
                          <div
                            className={`dh-leak-fill is-${cat.accent}`}
                            style={{
                              width: `${cat.count > 0 ? Math.max(6, cat.sharePct) : 0}%`,
                              background: cat.barColor,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="dh-empty-inline">
                  <span>
                    Open Leak Detector on any mock below (−{NEET_MARKS_PER_WRONG_SWING} net marks per wrong Q).
                  </span>
                </div>
              )}
            </section>
          )}

          {/* Mock Score Progression Chart */}
          {mocksOverview.newestFirst.length >= 2 && (
            <section className="dh-amoled-section">
              <SectionHeader title="Score progression" />
              <AreaLineChart
                height={190}
                data={mocksOverview.newestFirst
                  .slice()
                  .reverse()
                  .map(({ mock, report }) => ({
                    label: mock.dayKey.slice(5),
                    value: report.totalScore,
                    hint: `${mock.name} · ${report.accuracyPct}% acc`,
                  }))}
                goalValue={targetScore}
                goalLabel={`Target ${targetScore}`}
                valueFormatter={(v) => `${Math.round(v)}`}
                ariaLabel="Mock test score progression"
              />
            </section>
          )}

          {/* Error & Pacing Insights */}
          {mockDiagnosticsAgg.mocksWithDiagnosticsCount >= 1 && (
            <section className="dh-amoled-section">
              <div className="dh-eyebrow-row">
                <h3 className="dh-eyebrow">Error &amp; pacing</h3>
                <span className="tnum text-[13px] text-[var(--tx-2)]">
                  {mockDiagnosticsAgg.totalLostMarks} lost · {mockDiagnosticsAgg.totalRecoverableMarks} recoverable
                </span>
              </div>

              <div className="space-y-4">
                <div className="dh-hairline-list">
                  {BLEEDING_CATEGORIES.map((cat) => {
                    const count = mockDiagnosticsAgg.bleedingCounts[cat.key];
                    const lostMarks = mockDiagnosticsAgg.bleedingMarks[cat.key];
                    return (
                      <div key={cat.key} className="dh-hairline-row space-y-1.5">
                        <div className="split text-[13px]">
                          <span className="font-medium text-[var(--tx)]">
                            {cat.label}
                          </span>
                          <span className="tnum font-semibold text-[var(--tx)]">
                            {count} Q · {lostMarks}m
                          </span>
                        </div>
                        <Meter
                          value={lostMarks}
                          max={Math.max(1, mockDiagnosticsAgg.totalLostMarks)}
                          color={cat.color}
                          height={6}
                          label={`${cat.label} lost marks`}
                        />
                      </div>
                    );
                  })}
                </div>

                {mockDiagnosticsAgg.timedMocksCount >= 1 && (
                  <div className="space-y-2 pt-2">
                    <div className="dh-eyebrow-row">
                      <span className="dh-eyebrow">Avg subject pacing</span>
                      <span className="tnum text-[13px] text-[var(--tx-2)]">
                        {mockDiagnosticsAgg.timedMocksCount} timed
                      </span>
                    </div>
                    {(() => {
                      const pacingEntries = Object.values(
                        mockDiagnosticsAgg.subjectPacing
                      );
                      const orderedPacing = state.subjects
                        .filter((s) => mockDiagnosticsAgg.subjectPacing[s.id])
                        .map((s) => ({
                          subject: s,
                          pacing: mockDiagnosticsAgg.subjectPacing[s.id],
                        }));
                      const totalAvgMins = pacingEntries.reduce(
                        (sum, item) => sum + item.avgMinutes,
                        0
                      );
                      return (
                        <div className="dh-hairline-list">
                          {orderedPacing.map(({ subject, pacing }) => (
                            <div key={subject.id} className="dh-hairline-row space-y-1.5">
                              <div className="split text-[13px]">
                                <span className="flex items-center gap-2 font-medium text-[var(--tx)]">
                                  <span
                                    aria-hidden="true"
                                    className="dh-sub-dot"
                                    style={{ background: subject.color }}
                                  />
                                  {subject.name}
                                </span>
                                <span className="tnum font-semibold text-[var(--tx)]">
                                  {pacing.avgMinutes}m avg
                                </span>
                              </div>
                              <Meter
                                value={pacing.avgMinutes}
                                max={Math.max(1, totalAvgMins)}
                                color={subject.color}
                                height={6}
                                label={`${subject.name} average minutes`}
                              />
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Mock List — Hairline AMOLED Ledger */}
          <section className="dh-amoled-section">
            <SectionHeader title="Logged mocks" />
            {mocksOverview.newestFirst.length === 0 ? (
              <div className="dh-empty-inline">
                <span>No mock tests logged yet.</span>
                <button
                  type="button"
                  className="dh-eyebrow-link"
                  onClick={onOpenNewMock}
                >
                  Log first mock ›
                </button>
              </div>
            ) : (
              <WindowedList
                items={mocksOverview.newestFirst}
                threshold={100}
                estimatedRowHeight={168}
                itemLabel="mocks"
                className="dh-hairline-list"
                getKey={({ mock }) => mock.id}
                renderItem={({ mock, report }) => {
                  const diag = mockDiagnosticsMap[mock.id];
                  const showCleanBadge = Boolean(
                    diag && hasBleedingEntries(diag.bleeding)
                  );
                  const cleanInfo = showCleanBadge
                    ? computeCleanScore(
                        report.totalScore,
                        mock.maxMarks,
                        diag?.bleeding
                      )
                    : null;
                  const timeSummary = diag
                    ? formatSubjectTimeSummary(
                        diag.subjectMinutes,
                        state.subjects
                      )
                    : '';

                  return (
                    <div
                      className="dh-hairline-row dh-mock-card-clickable py-4"
                      data-testid={`mock-card-${mock.id}`}
                      onClick={() => {
                        triggerHaptic('tap');
                        setActiveReportMockId(mock.id);
                      }}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-[15px] font-semibold text-[var(--tx)]">
                              {mock.name}
                            </h4>
                            <span className="tnum text-[14px] font-bold text-[var(--ac-ink)]">
                              {report.totalScore}/{mock.maxMarks} ({report.pct}%)
                            </span>
                            {cleanInfo && (
                              <span className="tnum text-[13px] font-semibold text-[var(--ok-ink)]">
                                · Clean {cleanInfo.cleanScore}
                              </span>
                            )}
                          </div>
                          <p className="tnum mt-1 text-[13px] text-[var(--tx-2)]">
                            {mock.dayKey} · {report.accuracyPct}% acc · +{report.totalCorrect} / −{report.totalWrong} / {report.totalUnattempted} left
                          </p>
                          {timeSummary && (
                            <p className="tnum mt-0.5 text-[13px] text-[var(--tx-3)]">
                              {timeSummary}
                            </p>
                          )}
                          {mock.note && (
                            <p className="mt-1 text-[13px] text-[var(--tx-2)]">{mock.note}</p>
                          )}
                        </div>
                        <div
                          className="flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            data-testid={`mock-report-open-${mock.id}`}
                            aria-label={`Open scorecard report for ${mock.name}`}
                            className="dh-ghost-pill"
                            onClick={(e) => {
                              e.stopPropagation();
                              triggerHaptic('tap');
                              setActiveReportMockId(mock.id);
                            }}
                          >
                            <span>Report</span>
                            <ChevronRight size={13} strokeWidth={2} aria-hidden="true" />
                          </button>
                          <IconButton
                            size={36}
                            label={`Edit ${mock.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onEditMock(mock.id);
                            }}
                          >
                            <Edit3 size={15} />
                          </IconButton>
                          <IconButton
                            size={36}
                            label={`Delete ${mock.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteMock(mock.id);
                            }}
                          >
                            <Trash2 size={15} />
                          </IconButton>
                        </div>
                      </div>

                      {/* Clean inline subject breakdown strip */}
                      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px]">
                        {report.bySubject
                          .filter((bs) => bs.attempted > 0 || bs.unattempted > 0)
                          .map((bs) => {
                            const subObj = getSubject(state, bs.subjectId);
                            return (
                              <div key={bs.subjectId} className="inline-flex items-center gap-1.5">
                                <span
                                  className="dh-sub-dot"
                                  style={{ background: subObj.color }}
                                  aria-hidden="true"
                                />
                                <span className="text-[var(--tx-2)]">{bs.name}</span>
                                <span className="tnum font-semibold text-[var(--tx)]">
                                  {bs.score}
                                </span>
                                <span className="tnum text-[var(--tx-3)]">
                                  ({bs.accuracyPct}%)
                                </span>
                              </div>
                            );
                          })}
                      </div>

                      {/* Per-Mock Inline Expandable Negative-Marking Leak Detector */}
                      {(() => {
                        const leakCounts =
                          mockLeaksMap[mock.id]?.counts ?? createEmptyMockLeaks();
                        const taggedTotal = getTotalLeakErrors(leakCounts);
                        const taggedMarksLost = computeNetMarksBleed(taggedTotal);
                        const isLeakOpen = expandedLeakMockId === mock.id;
                        return (
                          <div
                            className="dh-leak-mock-wrap"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              data-testid={`mock-leak-toggle-${mock.id}`}
                              aria-expanded={isLeakOpen}
                              className={`dh-leak-mock-trigger ${isLeakOpen ? 'is-open' : ''}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                triggerHaptic('tap');
                                setExpandedLeakMockId(isLeakOpen ? null : mock.id);
                              }}
                            >
                              <span className="dh-leak-mock-trigger-left">
                                <Flame size={14} strokeWidth={1.9} aria-hidden="true" />
                                <span>Leak Detector</span>
                                {taggedTotal > 0 ? (
                                  <span className="dh-leak-mock-badge tnum">
                                    {taggedTotal} Q · −{taggedMarksLost}m
                                  </span>
                                ) : (
                                  <span className="dh-leak-mock-hint">Tag error causes</span>
                                )}
                              </span>
                              <ChevronDown
                                size={15}
                                strokeWidth={1.85}
                                className={`dh-leak-chevron ${isLeakOpen ? 'is-open' : ''}`}
                                aria-hidden="true"
                              />
                            </button>

                            {isLeakOpen && (
                              <div
                                className="dh-leak-drawer"
                                data-testid={`mock-leak-drawer-${mock.id}`}
                              >
                                <div className="dh-leak-drawer-grid">
                                  {MOCK_LEAK_CATEGORIES.map((cat) => {
                                    const val = leakCounts[cat.key];
                                    const lost = computeNetMarksBleed(val);
                                    return (
                                      <div key={cat.key} className="dh-leak-stepper-row">
                                        <div className="min-w-0">
                                          <div className="dh-leak-stepper-label">{cat.label}</div>
                                          <div className="dh-leak-stepper-sub tnum">
                                            {val > 0 ? `−${lost} net marks` : '0 errors'}
                                          </div>
                                        </div>
                                        <div className="dh-leak-stepper-controls">
                                          <button
                                            type="button"
                                            aria-label={`Decrease ${cat.label} for ${mock.name}`}
                                            data-testid={`leak-dec-${mock.id}-${cat.key}`}
                                            className="dh-leak-step-btn"
                                            disabled={val <= 0}
                                            onClick={() =>
                                              handleAdjustMockLeak(mock.id, cat.key, -1)
                                            }
                                          >
                                            <Minus size={14} strokeWidth={2} aria-hidden="true" />
                                          </button>
                                          <span
                                            className="dh-leak-step-val tnum"
                                            data-testid={`leak-val-${mock.id}-${cat.key}`}
                                          >
                                            {val}
                                          </span>
                                          <button
                                            type="button"
                                            aria-label={`Increase ${cat.label} for ${mock.name}`}
                                            data-testid={`leak-inc-${mock.id}-${cat.key}`}
                                            className="dh-leak-step-btn"
                                            onClick={() =>
                                              handleAdjustMockLeak(mock.id, cat.key, 1)
                                            }
                                          >
                                            <Plus size={14} strokeWidth={2} aria-hidden="true" />
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                }}
              />
            )}
          </section>

          <MockReportSheet
            open={Boolean(activeReportMock)}
            mock={activeReportMock}
            allMocks={state.mocks}
            subjects={state.subjects}
            targetScore={targetScore}
            reportMap={mockReportMap}
            leakMap={mockLeaksMap}
            onClose={() => setActiveReportMockId(null)}
            onReportDetailsChanged={() =>
              setMockReportMap(loadAllMockReportDetails())
            }
            onAdjustMockLeak={handleAdjustMockLeak}
            onOpenScoreLab={handleOpenScoreLabFromReport}
            onSyncCoreMock={onSyncMockFromReport}
            onNotify={(msg) => onNotify?.(msg)}
          />

          <ScoreLabSheet
            open={scoreLabOpen}
            onClose={() => {
              setScoreLabOpen(false);
              setScoreLabFocusMockId(undefined);
              setScoreLabSidecarSeed(null);
            }}
            mocks={state.mocks}
            subjects={state.subjects}
            targetMockScore={targetScore}
            leakMap={mockLeaksMap}
            focusMockId={scoreLabFocusMockId}
            sidecarOverride={scoreLabSidecarSeed}
          />
        </div>
      )}

      {/* ==========================================
          SUB-VIEW 3: QUESTION VAULT (LAZY-LOADED)
          ========================================== */}
      {activeUiTab === 'vault' && (
        <Suspense
          fallback={
            <div className="space-y-3">
              <Skeleton height={88} />
              <Skeleton height={200} />
            </div>
          }
        >
          <VaultView
            state={state}
            todayKey={todayKey}
            initialChapterFilter={vaultChapterJump}
            captureRequest={vaultCaptureRequest}
            activeTimerText={activeTimerText}
            onNotify={(msg, undo) => onNotify?.(msg, undo)}
            onToggleMistakeResolved={onToggleMistakeResolved}
            onDeleteMistake={onDeleteMistake}
            onToggleDoubtResolved={onToggleDoubtResolved}
            onDeleteDoubt={onDeleteDoubt}
          />
        </Suspense>
      )}

      {/* ==========================================
          SUB-VIEW 4: PYQ TRACKER
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
