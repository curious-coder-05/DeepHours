import React, { useMemo, useState } from 'react';
import type {
  Chapter,
  ChapterStatus,
  MistakeReason,
  PrepSubTab,
  PulseHabitState,
} from '../types';
import {
  computeMocksOverview,
  fmtDuration,
  getChapterPYQStats,
  getChapterStudyMs,
  getSortedChapterRevisions,
  getSubject,
} from '../utils/studyLogic';
import {
  computePaceReport,
  computeStudyNext,
  suggestRevisionDates,
} from '../utils/pace';
import { MistakesView } from './MistakesView';
import { DoubtsView } from './DoubtsView';

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
  onUpdateRevisionDate: (chapterId: string, revId: string, newDate: string) => void;
  onDeleteRevision: (chapterId: string, revId: string) => void;
  onOpenNewMock: () => void;
  onEditMock: (mockId: string) => void;
  onDeleteMock: (mockId: string) => void;
  onUpdateTargetScore: (target: number) => void;
  onAddMistake?: (mistake: {
    subjectId: string;
    chapterId?: string;
    mockId?: string;
    dayKey: string;
    reason: MistakeReason;
    note?: string;
  }) => void;
  onToggleMistakeResolved?: (mistakeId: string) => void;
  onDeleteMistake?: (mistakeId: string) => void;
  onAddDoubt?: (doubt: { subjectId: string; chapterId?: string; text: string }) => void;
  onToggleDoubtResolved?: (doubtId: string) => void;
  onDeleteDoubt?: (doubtId: string) => void;
  onAddPYQ?: (entry: {
    chapterId: string;
    dayKey: string;
    attempted: number;
    correct: number;
  }) => void;
  onDeletePYQ?: (pyqId: string) => void;
  onStartChapterFocus?: (subjectId: string, chapterId: string, chapterName: string) => void;
}

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
  const subjects = state.subjects.filter((s) => !s.arch);
  const defaultSubId = subjects[0]?.id || 'sub_phy';

  const [selectedSubjectFilter, setSelectedSubjectFilter] = useState<string>('all');
  const [addSubjectId, setAddSubjectId] = useState<string>(defaultSubId);
  const [bulkMode, setBulkMode] = useState(false);
  const [singleName, setSingleName] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [newRevDates, setNewRevDates] = useState<Record<string, string>>({});

  // 1.15 Suggested revision dates draft per chapter: chapterId -> string[]
  const [suggestedRevDrafts, setSuggestedRevDrafts] = useState<Record<string, string[]>>({});

  // 1.6 Optional skippable confidence prompt after completing a chapter or revision
  const [confidencePromptChapterId, setConfidencePromptChapterId] = useState<string | null>(
    null
  );

  // 1.5 PYQ inline logger state per chapter
  const [openPyqChapterId, setOpenPyqChapterId] = useState<string | null>(null);
  const [pyqAttempted, setPyqAttempted] = useState<string>('20');
  const [pyqCorrect, setPyqCorrect] = useState<string>('16');

  // Syllabus metrics
  const totalChapters = state.chapters.length;
  const completedChapters = state.chapters.filter((c) => c.status === 'completed').length;
  const overallChapterPct =
    totalChapters > 0 ? Math.round((completedChapters / totalChapters) * 100) : 0;

  const filteredChapters = state.chapters.filter(
    (c) => selectedSubjectFilter === 'all' || c.subjectId === selectedSubjectFilter
  );

  // 1.2 Pace Calculator & 1.7 Study Next
  const paceReport = useMemo(() => computePaceReport(state, todayKey), [state, todayKey]);
  const studyNextTop3 = useMemo(
    () => computeStudyNext(state, todayKey, 3, selectedSubjectFilter),
    [state, todayKey, selectedSubjectFilter]
  );

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const targetSub = addSubjectId || defaultSubId;
    if (bulkMode) {
      const names = bulkText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (!names.length) return;
      onAddChapters(targetSub, names);
      setBulkText('');
    } else {
      const clean = singleName.trim();
      if (!clean) return;
      onAddChapters(targetSub, [clean]);
      setSingleName('');
    }
  };

  const handleSuggestDatesForChapter = (ch: Chapter) => {
    const baseDate = ch.completedOn || todayKey;
    const intervals = state.set.revisionIntervals || [1, 3, 7, 21];
    const existingDates = (ch.revisions || []).map((r) => r.date);
    const suggested = suggestRevisionDates(baseDate, intervals, existingDates);
    setSuggestedRevDrafts((prev) => ({
      ...prev,
      [ch.id]: suggested,
    }));
  };

  const handleUpdateSuggestedDate = (chapterId: string, idx: number, newDate: string) => {
    setSuggestedRevDrafts((prev) => {
      const list = [...(prev[chapterId] || [])];
      list[idx] = newDate;
      return { ...prev, [chapterId]: list };
    });
  };

  const handleRemoveSuggestedDate = (chapterId: string, idx: number) => {
    setSuggestedRevDrafts((prev) => {
      const list = (prev[chapterId] || []).filter((_, i) => i !== idx);
      const next = { ...prev };
      if (list.length === 0) delete next[chapterId];
      else next[chapterId] = list;
      return next;
    });
  };

  const handleSaveSuggestedDates = (chapterId: string) => {
    const list = suggestedRevDrafts[chapterId] || [];
    for (const dt of list) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dt)) {
        onAddRevision(chapterId, dt);
      }
    }
    setSuggestedRevDrafts((prev) => {
      const next = { ...prev };
      delete next[chapterId];
      return next;
    });
  };

  // Mocks overview
  const mocksOverview = computeMocksOverview(state);
  const targetScore = state.set.targetMockScore ?? 650;
  const openMistakesCount = (state.mistakes || []).filter((m) => !m.resolved).length;
  const openDoubtsCount = (state.doubts || []).filter((d) => !d.resolved).length;

  return (
    <div>
      {/* Header + Horizontally Scrollable Segmented Switch: Syllabus | Mocks | Mistakes | Doubts */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ marginBottom: '8px' }}>
          <h2>NEET Prep Tracker</h2>
          <small>Syllabus pace, revisions, mocks, mistake analysis &amp; doubt queue</small>
        </div>
        <div
          style={{
            display: 'flex',
            overflowX: 'auto',
            background: 'var(--c2)',
            padding: '4px',
            borderRadius: '14px',
            gap: '4px',
            scrollbarWidth: 'none',
          }}
        >
          <button
            type="button"
            className={subTab === 'syllabus' ? 'on' : ''}
            style={{
              padding: '6px 12px',
              fontSize: '12.5px',
              borderRadius: '10px',
              whiteSpace: 'nowrap',
              flex: '1 0 auto',
            }}
            onClick={() => onChangeSubTab('syllabus')}
          >
            📚 Syllabus
          </button>
          <button
            type="button"
            className={subTab === 'mocks' ? 'on' : ''}
            style={{
              padding: '6px 12px',
              fontSize: '12.5px',
              borderRadius: '10px',
              whiteSpace: 'nowrap',
              flex: '1 0 auto',
            }}
            onClick={() => onChangeSubTab('mocks')}
          >
            🧪 Mocks
          </button>
          <button
            type="button"
            className={subTab === 'mistakes' ? 'on' : ''}
            style={{
              padding: '6px 12px',
              fontSize: '12.5px',
              borderRadius: '10px',
              whiteSpace: 'nowrap',
              flex: '1 0 auto',
            }}
            onClick={() => onChangeSubTab('mistakes')}
          >
            🎯 Mistakes{openMistakesCount > 0 ? ` (${openMistakesCount})` : ''}
          </button>
          <button
            type="button"
            className={subTab === 'doubts' ? 'on' : ''}
            style={{
              padding: '6px 12px',
              fontSize: '12.5px',
              borderRadius: '10px',
              whiteSpace: 'nowrap',
              flex: '1 0 auto',
            }}
            onClick={() => onChangeSubTab('doubts')}
          >
            ❓ Doubts{openDoubtsCount > 0 ? ` (${openDoubtsCount})` : ''}
          </button>
        </div>
      </div>

      {subTab === 'syllabus' && (
        <div>
          {/* 1.2 Pace Calculator Card */}
          <div className="card" style={{ borderLeft: '4px solid #6366f1' }}>
            <div className="row sp" style={{ marginBottom: '6px' }}>
              <div>
                <h3 style={{ margin: 0 }}>⏱️ Syllabus Pace Calculator</h3>
                <small>
                  {paceReport.exam
                    ? `${paceReport.exam.e} ${paceReport.exam.title} (${paceReport.examDate}) · ${paceReport.revisionBufferDays}d revision buffer → Deadline ${paceReport.syllabusEndDate}`
                    : 'Add a D-Day exam on Today tab to compute required weekly chapter velocity'}
                </small>
              </div>
              {paceReport.exam && paceReport.totalChapters > 0 && (
                <span
                  className="pill mono"
                  style={{
                    fontSize: '11.5px',
                    fontWeight: 800,
                    borderColor:
                      paceReport.status === 'ahead' || paceReport.status === 'completed'
                        ? '#10b981'
                        : paceReport.status === 'behind'
                          ? '#ef4444'
                          : '#38bdf8',
                    color:
                      paceReport.status === 'ahead' || paceReport.status === 'completed'
                        ? '#10b981'
                        : paceReport.status === 'behind'
                          ? '#f87171'
                          : '#38bdf8',
                  }}
                >
                  {paceReport.status === 'ahead'
                    ? '🚀 Ahead'
                    : paceReport.status === 'behind'
                      ? `⚠️ Behind by ${paceReport.behindByChapters} ch`
                      : paceReport.status === 'completed'
                        ? '✅ Completed'
                        : '✓ On track'}
                </span>
              )}
            </div>

            <div
              style={{
                fontSize: '12.5px',
                fontWeight: 700,
                color: '#e2e8f0',
                marginBottom: paceReport.perSubject.length > 0 ? '10px' : 0,
              }}
            >
              {paceReport.compactSummary}
              {paceReport.projectedFinishDate && paceReport.remainingChapters > 0 && (
                <span style={{ color: 'var(--mu)', fontWeight: 600 }}>
                  {' '}
                  · Projected finish: {paceReport.projectedFinishDate}
                </span>
              )}
            </div>

            {paceReport.perSubject.length > 0 && paceReport.totalChapters > 0 && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                  gap: '7px',
                }}
              >
                {paceReport.perSubject.map((ps) => (
                  <div
                    key={ps.subjectId}
                    className="stat-box"
                    style={{ borderLeft: `3px solid ${ps.color}`, padding: '8px 10px' }}
                  >
                    <div className="row sp">
                      <small style={{ fontWeight: 700, color: 'var(--tx)' }}>
                        {ps.subjectEmoji} {ps.subjectName}
                      </small>
                      <small
                        className="mono"
                        style={{
                          fontSize: '10.5px',
                          fontWeight: 800,
                          color:
                            ps.status === 'ahead' || ps.status === 'completed'
                              ? '#10b981'
                              : ps.status === 'behind'
                                ? '#f87171'
                                : '#94a3b8',
                        }}
                      >
                        {ps.status === 'behind'
                          ? `-${ps.behindByChapters} ch`
                          : ps.status}
                      </small>
                    </div>
                    <small style={{ display: 'block', fontSize: '11px', marginTop: '3px' }}>
                      {ps.remainingChapters} left · Need <b>{ps.requiredPerWeek}/wk</b> · Actual{' '}
                      <b>{ps.actualPerWeek}/wk</b>
                    </small>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 1.7 "Study Next" Top 3 Recommendations Card */}
          {studyNextTop3.length > 0 && (
            <div className="card" style={{ borderLeft: '4px solid #10b981' }}>
              <div className="row sp" style={{ marginBottom: '8px' }}>
                <div>
                  <h3 style={{ margin: 0 }}>🧭 Study Next (Priority Chapters)</h3>
                  <small>Ranked by confidence, open mistakes, recency &amp; status</small>
                </div>
              </div>
              <div style={{ display: 'grid', gap: '7px' }}>
                {studyNextTop3.map((item, idx) => (
                  <div
                    key={item.chapter.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px 10px',
                      borderRadius: '10px',
                      background: 'var(--c2)',
                      borderLeft: `3px solid ${item.subjectColor}`,
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: 800, color: '#f8fafc' }}>
                        {idx + 1}. {item.subjectEmoji} {item.chapter.name}
                      </div>
                      <small style={{ display: 'block', fontSize: '11px', color: '#94a3b8' }}>
                        {item.reasons.join(' • ')}
                      </small>
                    </div>
                    {onStartChapterFocus && (
                      <button
                        type="button"
                        className="s pri"
                        style={{ padding: '5px 10px', fontSize: '11.5px', whiteSpace: 'nowrap' }}
                        onClick={() =>
                          onStartChapterFocus(
                            item.chapter.subjectId,
                            item.chapter.id,
                            item.chapter.name
                          )
                        }
                      >
                        ▶ Focus
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Overall & Subject Progress Summary */}
          <div className="card">
            <div className="row sp" style={{ marginBottom: '8px' }}>
              <div>
                <h3>Syllabus Completion</h3>
                <small>
                  {completedChapters} of {totalChapters} chapters completed
                </small>
              </div>
              <span className="pill mono" style={{ fontSize: '14px', fontWeight: 800 }}>
                {overallChapterPct}%
              </span>
            </div>
            <div className="pbar" style={{ height: '9px', marginBottom: '12px' }}>
              <i
                style={{
                  width: `${overallChapterPct}%`,
                  background: 'linear-gradient(90deg, var(--ac), var(--em))',
                }}
              />
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '8px',
              }}
            >
              {subjects.map((sub) => {
                const subChaps = state.chapters.filter((c) => c.subjectId === sub.id);
                const subDone = subChaps.filter((c) => c.status === 'completed').length;
                const subInProg = subChaps.filter((c) => c.status === 'inProgress').length;
                const subPct =
                  subChaps.length > 0 ? Math.round((subDone / subChaps.length) * 100) : 0;
                return (
                  <div
                    key={sub.id}
                    className="stat-box"
                    style={{
                      borderLeft: `3px solid ${sub.color}`,
                      padding: '9px 11px',
                    }}
                  >
                    <div className="row sp">
                      <b style={{ fontSize: '13px' }}>
                        {sub.e} {sub.name}
                      </b>
                      <span className="mono" style={{ fontSize: '12px', fontWeight: 700 }}>
                        {subDone}/{subChaps.length}
                      </span>
                    </div>
                    <div className="pbar" style={{ height: '5px', margin: '6px 0 4px' }}>
                      <i style={{ width: `${subPct}%`, background: sub.color }} />
                    </div>
                    <small style={{ fontSize: '11px' }}>
                      {subPct}% done · {subInProg} in progress
                    </small>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Add / Bulk-Add Chapters */}
          <div className="card">
            <div className="row sp" style={{ marginBottom: '8px' }}>
              <h3>{bulkMode ? 'Bulk Paste Chapters' : 'Add Chapter'}</h3>
              <button
                type="button"
                className="s"
                onClick={() => setBulkMode((v) => !v)}
              >
                {bulkMode ? 'Single Add' : 'Bulk Paste (1 per line)'}
              </button>
            </div>
            <form onSubmit={handleAddSubmit}>
              <div className="row" style={{ marginBottom: '8px' }}>
                <select
                  value={addSubjectId}
                  onChange={(e) => setAddSubjectId(e.target.value)}
                  aria-label="Select Subject for Chapter"
                  style={{ maxWidth: '180px' }}
                >
                  {subjects.map((sub) => (
                    <option key={sub.id} value={sub.id}>
                      {sub.e} {sub.name}
                    </option>
                  ))}
                </select>
              </div>
              {bulkMode ? (
                <div>
                  <textarea
                    rows={4}
                    value={bulkText}
                    onChange={(e) => setBulkText(e.target.value)}
                    placeholder={
                      'Units and Measurements\nMotion in a Straight Line\nMotion in a Plane\nLaws of Motion'
                    }
                    aria-label="Bulk chapter names, one per line"
                  />
                  <div className="row" style={{ justifyContent: 'flex-end', marginTop: '8px' }}>
                    <button type="submit" className="pri">
                      + Add Chapters
                    </button>
                  </div>
                </div>
              ) : (
                <div className="row">
                  <input
                    type="text"
                    value={singleName}
                    onChange={(e) => setSingleName(e.target.value)}
                    placeholder="Chapter name (e.g., Rotational Motion, Chemical Bonding...)"
                    maxLength={90}
                    aria-label="Chapter name"
                  />
                  <button type="submit" className="pri" style={{ whiteSpace: 'nowrap' }}>
                    + Add Chapter
                  </button>
                </div>
              )}
            </form>
          </div>

          {/* Filter by Subject */}
          <div className="chips wrap" style={{ margin: '10px 0 6px' }}>
            <button
              type="button"
              className={selectedSubjectFilter === 'all' ? 'on' : ''}
              onClick={() => setSelectedSubjectFilter('all')}
            >
              All ({state.chapters.length})
            </button>
            {subjects.map((sub) => {
              const count = state.chapters.filter((c) => c.subjectId === sub.id).length;
              return (
                <button
                  type="button"
                  key={sub.id}
                  className={selectedSubjectFilter === sub.id ? 'on' : ''}
                  onClick={() => setSelectedSubjectFilter(sub.id)}
                >
                  {sub.e} {sub.name} ({count})
                </button>
              );
            })}
          </div>

          {/* Chapter List */}
          {filteredChapters.length === 0 ? (
            <div className="card mu">
              No chapters added yet. Add chapters above or use Bulk Paste to import your syllabus.
            </div>
          ) : (
            filteredChapters.map((ch) => {
              const sub = getSubject(state, ch.subjectId);
              const sortedRevs = getSortedChapterRevisions(ch);
              const revDateDraft = newRevDates[ch.id] ?? todayKey;
              const draftBeforeCompletion =
                Boolean(ch.completedOn && revDateDraft && revDateDraft < ch.completedOn);
              const studyStats = getChapterStudyMs(state, ch.id);
              const pyqStats = getChapterPYQStats(state, ch.id);
              const suggestedDates = suggestedRevDrafts[ch.id] || [];
              const showConfidencePrompt = confidencePromptChapterId === ch.id;
              const isPyqOpen = openPyqChapterId === ch.id;

              return (
                <div
                  key={ch.id}
                  className="card"
                  style={{ borderLeft: `4px solid ${sub.color}` }}
                >
                  <div className="row sp" style={{ alignItems: 'flex-start', gap: '8px' }}>
                    <div className="g">
                      <div className="row" style={{ gap: '6px', flexWrap: 'wrap' }}>
                        <span
                          className="pill"
                          style={{
                            padding: '2px 8px',
                            fontSize: '11px',
                            borderColor: sub.color,
                          }}
                        >
                          {sub.e} {sub.name}
                        </span>
                        <b style={{ fontSize: '15px' }}>{ch.name}</b>
                        {/* 1.1 Total study time badge */}
                        {studyStats.totalMs > 0 && (
                          <span
                            className="pill mono"
                            style={{
                              padding: '2px 7px',
                              fontSize: '11px',
                              color: '#a5b4fc',
                              borderColor: 'rgba(99,102,241,0.4)',
                            }}
                          >
                            ⏱️ {fmtDuration(studyStats.totalMs)} ({studyStats.sessionCount}s)
                          </span>
                        )}
                        {/* 1.5 PYQ accuracy badge */}
                        {pyqStats.attempted > 0 && (
                          <span
                            className="pill mono"
                            style={{
                              padding: '2px 7px',
                              fontSize: '11px',
                              color: '#10b981',
                              borderColor: 'rgba(16,185,129,0.4)',
                            }}
                          >
                            🎯 PYQ {pyqStats.correct}/{pyqStats.attempted} ({pyqStats.accuracyPct}%)
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="row" style={{ gap: '4px' }}>
                      {onStartChapterFocus && (
                        <button
                          type="button"
                          className="s"
                          style={{ padding: '4px 8px', fontSize: '11.5px' }}
                          onClick={() => onStartChapterFocus(ch.subjectId, ch.id, ch.name)}
                          title="Start Focus Session on this Chapter"
                        >
                          ▶ Focus
                        </button>
                      )}
                      <button
                        type="button"
                        className="s dg"
                        aria-label={`Delete chapter ${ch.name}`}
                        onClick={() => onDeleteChapter(ch.id)}
                      >
                        ×
                      </button>
                    </div>
                  </div>

                  {/* Status & Completion Date (F3) */}
                  <div
                    className="row wrap"
                    style={{ marginTop: '10px', gap: '8px', alignItems: 'center' }}
                  >
                    <label style={{ flex: '1 1 150px', fontSize: '12px' }}>
                      Status
                      <select
                        value={ch.status}
                        aria-label={`Status for ${ch.name}`}
                        onChange={(e) => {
                          const nextStatus = e.target.value as ChapterStatus;
                          onUpdateChapter(ch.id, { status: nextStatus });
                          if (nextStatus === 'completed') {
                            setConfidencePromptChapterId(ch.id);
                          }
                        }}
                      >
                        <option value="notStarted">Not Started</option>
                        <option value="inProgress">In Progress</option>
                        <option value="completed">Completed</option>
                      </select>
                    </label>

                    <label style={{ flex: '1 1 150px', fontSize: '12px' }}>
                      Completed Date
                      <input
                        type="date"
                        value={
                          ch.completedOn ||
                          (ch.status === 'completed' ? todayKey : '')
                        }
                        aria-label={`Completion date for ${ch.name}`}
                        onChange={(e) => {
                          const val = e.target.value.trim();
                          if (!val) return;
                          onUpdateChapter(ch.id, {
                            completedOn: val,
                          });
                        }}
                      />
                    </label>
                  </div>

                  {/* 1.6 Confidence Rating (1..5) + PYQ Tracker toggle */}
                  <div
                    className="row sp wrap"
                    style={{
                      marginTop: '10px',
                      paddingTop: '8px',
                      borderTop: '1px solid var(--bd)',
                      gap: '8px',
                    }}
                  >
                    <div className="row" style={{ gap: '5px', alignItems: 'center' }}>
                      <small style={{ fontWeight: 700, marginRight: '4px' }}>Confidence:</small>
                      {([1, 2, 3, 4, 5] as const).map((val) => {
                        const active = ch.confidence === val;
                        return (
                          <button
                            key={val}
                            type="button"
                            onClick={() => onUpdateChapter(ch.id, { confidence: val })}
                            style={{
                              width: '26px',
                              height: '26px',
                              padding: 0,
                              borderRadius: '8px',
                              fontSize: '12px',
                              fontWeight: 800,
                              background: active ? sub.color : 'var(--c2)',
                              color: active ? '#090d16' : 'var(--tx)',
                              border: `1px solid ${active ? sub.color : 'var(--bd)'}`,
                            }}
                            title={`Rate confidence ${val}/5`}
                          >
                            {val}
                          </button>
                        );
                      })}
                    </div>

                    <button
                      type="button"
                      className="s"
                      style={{ fontSize: '11.5px', padding: '5px 10px' }}
                      onClick={() =>
                        setOpenPyqChapterId(isPyqOpen ? null : ch.id)
                      }
                    >
                      📝 PYQ Tracker ({pyqStats.attempted} Qs
                      {pyqStats.accuracyPct !== null ? ` · ${pyqStats.accuracyPct}%` : ''})
                    </button>
                  </div>

                  {/* 1.6 Optional skippable prompt after marking chapter/revision complete */}
                  {showConfidencePrompt && (
                    <div
                      style={{
                        marginTop: '8px',
                        padding: '8px 10px',
                        borderRadius: '10px',
                        background: 'rgba(16, 185, 129, 0.12)',
                        border: '1px solid rgba(16, 185, 129, 0.35)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                        flexWrap: 'wrap',
                      }}
                    >
                      <small style={{ color: '#a7f3d0', fontWeight: 700 }}>
                        ✨ Rate your confidence on {ch.name} (1–5)?
                      </small>
                      <div className="row" style={{ gap: '4px' }}>
                        {([1, 2, 3, 4, 5] as const).map((v) => (
                          <button
                            key={v}
                            type="button"
                            className="s"
                            style={{
                              padding: '3px 8px',
                              fontSize: '11.5px',
                              background: ch.confidence === v ? '#10b981' : 'var(--c2)',
                              color: ch.confidence === v ? '#090d16' : '#fff',
                            }}
                            onClick={() => {
                              onUpdateChapter(ch.id, { confidence: v });
                              setConfidencePromptChapterId(null);
                            }}
                          >
                            {v}
                          </button>
                        ))}
                        <button
                          type="button"
                          className="s"
                          style={{ padding: '3px 8px', fontSize: '11px' }}
                          onClick={() => setConfidencePromptChapterId(null)}
                        >
                          Skip
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 1.5 PYQ Tracker Drawer */}
                  {isPyqOpen && (
                    <div
                      style={{
                        marginTop: '8px',
                        padding: '10px',
                        borderRadius: '10px',
                        background: 'var(--c2)',
                      }}
                    >
                      <div className="row sp" style={{ marginBottom: '6px' }}>
                        <small style={{ fontWeight: 700 }}>
                          Log Previous Year Questions (PYQs) — Cumulative:{' '}
                          {pyqStats.correct}/{pyqStats.attempted} correct (
                          {pyqStats.accuracyPct !== null ? `${pyqStats.accuracyPct}%` : '—'})
                        </small>
                      </div>
                      <div className="row wrap" style={{ gap: '6px' }}>
                        <label style={{ fontSize: '11px', flex: '1 1 90px' }}>
                          Attempted
                          <input
                            type="number"
                            min={1}
                            max={500}
                            value={pyqAttempted}
                            onChange={(e) => setPyqAttempted(e.target.value)}
                            style={{ padding: '5px 8px', fontSize: '12px' }}
                          />
                        </label>
                        <label style={{ fontSize: '11px', flex: '1 1 90px' }}>
                          Correct
                          <input
                            type="number"
                            min={0}
                            max={Number(pyqAttempted) || 500}
                            value={pyqCorrect}
                            onChange={(e) => setPyqCorrect(e.target.value)}
                            style={{ padding: '5px 8px', fontSize: '12px' }}
                          />
                        </label>
                        <button
                          type="button"
                          className="s pri"
                          style={{ alignSelf: 'flex-end', padding: '7px 12px' }}
                          onClick={() => {
                            const att = Math.max(1, Math.floor(Number(pyqAttempted) || 0));
                            const cor = Math.min(
                              att,
                              Math.max(0, Math.floor(Number(pyqCorrect) || 0))
                            );
                            onAddPYQ?.({
                              chapterId: ch.id,
                              dayKey: todayKey,
                              attempted: att,
                              correct: cor,
                            });
                          }}
                        >
                          + Log PYQs
                        </button>
                      </div>

                      {pyqStats.entries.length > 0 && (
                        <div style={{ marginTop: '8px', display: 'grid', gap: '4px' }}>
                          {pyqStats.entries.slice(-5).map((entry) => {
                            const pct = Math.round((entry.correct / entry.attempted) * 100);
                            return (
                              <div
                                key={entry.id}
                                className="row sp"
                                style={{
                                  fontSize: '11.5px',
                                  padding: '4px 8px',
                                  borderRadius: '6px',
                                  background: 'rgba(15,23,42,0.5)',
                                }}
                              >
                                <span>
                                  {entry.dayKey}: <b>{entry.correct}/{entry.attempted}</b> ({pct}%)
                                </span>
                                {onDeletePYQ && (
                                  <button
                                    type="button"
                                    className="s dg"
                                    style={{ padding: '2px 6px', fontSize: '10px' }}
                                    onClick={() => onDeletePYQ(entry.id)}
                                  >
                                    ×
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Manual Revision Dates + 1.15 Suggest Dates */}
                  <div
                    style={{
                      marginTop: '10px',
                      paddingTop: '8px',
                      borderTop: '1px solid var(--bd)',
                    }}
                  >
                    <div className="row sp" style={{ marginBottom: '6px' }}>
                      <small style={{ fontWeight: 700 }}>
                        Manual Revision Schedule ({sortedRevs.filter((r) => r.done).length}/
                        {sortedRevs.length} done)
                      </small>
                      <button
                        type="button"
                        className="s"
                        style={{ padding: '3px 9px', fontSize: '11px' }}
                        onClick={() => handleSuggestDatesForChapter(ch)}
                      >
                        ✨ Suggest dates (+{(state.set.revisionIntervals || [1, 3, 7, 21]).join(', +')}d)
                      </button>
                    </div>

                    {/* 1.15 Suggested dates editable preview before saving */}
                    {suggestedDates.length > 0 && (
                      <div
                        style={{
                          marginBottom: '8px',
                          padding: '8px 10px',
                          borderRadius: '10px',
                          background: 'rgba(99, 102, 241, 0.12)',
                          border: '1px solid rgba(99, 102, 241, 0.35)',
                        }}
                      >
                        <small style={{ display: 'block', fontWeight: 700, marginBottom: '6px', color: '#a5b4fc' }}>
                          Suggested Revision Dates (Edit or remove before saving):
                        </small>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
                          {suggestedDates.map((dt, idx) => (
                            <div
                              key={idx}
                              className="row"
                              style={{
                                gap: '4px',
                                background: 'var(--c2)',
                                padding: '3px 6px',
                                borderRadius: '8px',
                              }}
                            >
                              <input
                                type="date"
                                value={dt}
                                style={{ width: '132px', padding: '3px 6px', fontSize: '11.5px' }}
                                onChange={(e) =>
                                  handleUpdateSuggestedDate(ch.id, idx, e.target.value)
                                }
                              />
                              <button
                                type="button"
                                className="s dg"
                                style={{ padding: '2px 6px', fontSize: '11px' }}
                                onClick={() => handleRemoveSuggestedDate(ch.id, idx)}
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                        <div className="row" style={{ justifyContent: 'flex-end', gap: '6px' }}>
                          <button
                            type="button"
                            className="s"
                            style={{ padding: '4px 10px', fontSize: '11.5px' }}
                            onClick={() =>
                              setSuggestedRevDrafts((prev) => {
                                const next = { ...prev };
                                delete next[ch.id];
                                return next;
                              })
                            }
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="s pri"
                            style={{ padding: '4px 10px', fontSize: '11.5px' }}
                            onClick={() => handleSaveSuggestedDates(ch.id)}
                          >
                            Save Suggested Dates ({suggestedDates.length})
                          </button>
                        </div>
                      </div>
                    )}

                    {sortedRevs.length > 0 && (
                      <div style={{ display: 'grid', gap: '6px', marginBottom: '8px' }}>
                        {sortedRevs.map((rev) => {
                          const isLate = !rev.done && rev.date < todayKey;
                          const isBeforeCompletion = Boolean(
                            ch.completedOn && rev.date < ch.completedOn
                          );
                          return (
                            <div
                              key={rev.id}
                              style={{
                                background: 'var(--c2)',
                                padding: '6px 10px',
                                borderRadius: '10px',
                              }}
                            >
                              <div className="row sp" style={{ gap: '8px' }}>
                                <label
                                  className="row"
                                  style={{ cursor: 'pointer', gap: '6px', flex: 1 }}
                                >
                                  <input
                                    type="checkbox"
                                    style={{ width: '17px', height: '17px' }}
                                    checked={rev.done}
                                    onChange={() => {
                                      const wasDone = rev.done;
                                      onToggleRevision(ch.id, rev.id);
                                      if (!wasDone) {
                                        setConfidencePromptChapterId(ch.id);
                                      }
                                    }}
                                  />
                                  <span
                                    className="pill mono"
                                    style={{
                                      padding: '2px 7px',
                                      fontSize: '11px',
                                      borderColor: sub.color,
                                    }}
                                  >
                                    {rev.label}
                                  </span>
                                  {isLate && (
                                    <span
                                      style={{
                                        color: 'var(--dg)',
                                        fontSize: '11px',
                                        fontWeight: 700,
                                      }}
                                    >
                                      Overdue
                                    </span>
                                  )}
                                  {rev.done && rev.doneOn && (
                                    <small style={{ fontSize: '11px', color: 'var(--em)' }}>
                                      ✓ Done ({rev.doneOn})
                                    </small>
                                  )}
                                </label>
                                <input
                                  type="date"
                                  value={rev.date}
                                  aria-label={`${rev.label} date for ${ch.name}`}
                                  style={{ width: '142px', padding: '5px 8px', fontSize: '12px' }}
                                  onChange={(e) => {
                                    if (e.target.value) {
                                      onUpdateRevisionDate(ch.id, rev.id, e.target.value);
                                    }
                                  }}
                                />
                                <button
                                  type="button"
                                  className="s dg"
                                  style={{ padding: '4px 8px' }}
                                  aria-label={`Delete ${rev.label} for ${ch.name}`}
                                  onClick={() => onDeleteRevision(ch.id, rev.id)}
                                >
                                  ×
                                </button>
                              </div>
                              {isBeforeCompletion && (
                                <small
                                  style={{
                                    display: 'block',
                                    marginTop: '4px',
                                    fontSize: '11px',
                                    color: '#fbbf24',
                                  }}
                                >
                                  Note: Revision date ({rev.date}) is earlier than completion date (
                                  {ch.completedOn}).
                                </small>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div className="row" style={{ gap: '6px' }}>
                      <input
                        type="date"
                        value={revDateDraft}
                        aria-label={`New revision date for ${ch.name}`}
                        onChange={(e) =>
                          setNewRevDates((prev) => ({
                            ...prev,
                            [ch.id]: e.target.value,
                          }))
                        }
                      />
                      <button
                        type="button"
                        className="s pri"
                        onClick={() => {
                          const targetDate = newRevDates[ch.id] || todayKey;
                          if (!targetDate) return;
                          onAddRevision(ch.id, targetDate);
                        }}
                      >
                        + Add Revision Date
                      </button>
                    </div>
                    {draftBeforeCompletion && (
                      <small
                        style={{
                          display: 'block',
                          marginTop: '4px',
                          fontSize: '11px',
                          color: '#fbbf24',
                        }}
                      >
                        Note: Selected revision date ({revDateDraft}) is earlier than completion
                        date ({ch.completedOn}).
                      </small>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {subTab === 'mocks' && (
        /* Mock Tests Sub-Tab (Part B1) */
        <div>
          <div className="row sp" style={{ marginBottom: '10px' }}>
            <div>
              <h3>Mock Test &amp; Score Log</h3>
              <small>Track NEET mock scores, subject accuracy &amp; attempt rate</small>
            </div>
            <button type="button" className="pri" onClick={onOpenNewMock}>
              + Log Mock Test
            </button>
          </div>

          {/* KPI Summary Row */}
          <div
            className="stat-mini"
            style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '10px' }}
          >
            <div className="stat-box">
              <small>Avg (Last 5)</small>
              <b className="mono" style={{ color: 'var(--ac)', fontSize: '18px' }}>
                {mocksOverview.newestFirst.length ? mocksOverview.avgLast5Score : '—'}
              </b>
            </div>
            <div className="stat-box">
              <small>Best Score</small>
              <b className="mono" style={{ color: 'var(--em)', fontSize: '18px' }}>
                {mocksOverview.newestFirst.length ? mocksOverview.bestScore : '—'}
              </b>
            </div>
            <div className="stat-box">
              <small>Target Score</small>
              <input
                type="number"
                min={0}
                max={720}
                value={targetScore}
                aria-label="Target Mock Score"
                style={{
                  marginTop: '2px',
                  padding: '4px 8px',
                  fontSize: '14px',
                  fontWeight: 700,
                }}
                onChange={(e) => onUpdateTargetScore(Math.max(0, Number(e.target.value) || 0))}
              />
            </div>
          </div>

          {/* Needs Attention Subject Banner */}
          {mocksOverview.lowestAccuracySubject && (
            <div
              className="card"
              style={{
                padding: '10px 14px',
                borderLeft: '4px solid var(--am)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <span
                  className="pill"
                  style={{
                    background: 'color-mix(in srgb, var(--am) 22%, transparent)',
                    borderColor: 'var(--am)',
                    color: '#fbbf24',
                    fontSize: '11px',
                  }}
                >
                  ⚠️ Needs Attention
                </span>
                <b style={{ display: 'block', marginTop: '4px' }}>
                  {mocksOverview.lowestAccuracySubject.e}{' '}
                  {mocksOverview.lowestAccuracySubject.name} has the lowest overall accuracy (
                  {mocksOverview.lowestAccuracySubject.accuracyPct}%)
                </b>
              </div>
            </div>
          )}

          {/* Plain SVG Total Score Line Chart Over Time */}
          <div className="card">
            <div className="row sp" style={{ marginBottom: '8px' }}>
              <div>
                <h3>Mock Score Progression (SVG)</h3>
                <small>
                  Chronological total score trend
                  {targetScore > 0 ? ` · Dashed line = Target (${targetScore})` : ''}
                </small>
              </div>
              <span className="pill mono">{mocksOverview.chronological.length} tests</span>
            </div>

            {mocksOverview.chronological.length > 0 ? (
              (() => {
                const pts = mocksOverview.chronological;
                const W = 560;
                const H = 190;
                const padL = 42;
                const padR = 20;
                const padT = 18;
                const padB = 30;
                const plotW = W - padL - padR;
                const plotH = H - padT - padB;
                const maxY = Math.max(
                  720,
                  targetScore,
                  ...pts.map((p) => p.report.maxMarks),
                  ...pts.map((p) => p.report.totalScore)
                );
                const minY = Math.min(0, ...pts.map((p) => p.report.totalScore));
                const rangeY = Math.max(100, maxY - minY);

                const toX = (i: number) =>
                  pts.length === 1
                    ? padL + plotW / 2
                    : padL + (i / (pts.length - 1)) * plotW;
                const toY = (val: number) =>
                  padT + plotH - ((val - minY) / rangeY) * plotH;

                const polyPoints = pts
                  .map((p, i) => `${toX(i).toFixed(1)},${toY(p.report.totalScore).toFixed(1)}`)
                  .join(' ');

                const targetY = targetScore > 0 ? toY(targetScore) : null;

                return (
                  <svg
                    viewBox={`0 0 ${W} ${H}`}
                    style={{ width: '100%', height: '190px', display: 'block' }}
                    role="img"
                    aria-label="Mock Test Score Trend Chart"
                  >
                    {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
                      const val = Math.round(minY + frac * rangeY);
                      const y = toY(val);
                      return (
                        <g key={frac}>
                          <line
                            x1={padL}
                            y1={y}
                            x2={W - padR}
                            y2={y}
                            stroke="rgba(148,163,184,0.16)"
                            strokeDasharray="3 3"
                          />
                          <text
                            x={padL - 6}
                            y={y + 4}
                            textAnchor="end"
                            fill="#94a3b8"
                            fontSize="10"
                          >
                            {val}
                          </text>
                        </g>
                      );
                    })}

                    {targetY !== null && targetY >= padT && targetY <= H - padB && (
                      <g>
                        <line
                          x1={padL}
                          y1={targetY}
                          x2={W - padR}
                          y2={targetY}
                          stroke="#f59e0b"
                          strokeWidth="1.5"
                          strokeDasharray="5 4"
                        />
                        <text
                          x={W - padR - 4}
                          y={targetY - 4}
                          textAnchor="end"
                          fill="#fbbf24"
                          fontSize="10"
                          fontWeight="700"
                        >
                          Target {targetScore}
                        </text>
                      </g>
                    )}

                    {pts.length > 1 && (
                      <polyline
                        fill="none"
                        stroke="#10b981"
                        strokeWidth="2.75"
                        points={polyPoints}
                      />
                    )}

                    {pts.map((p, i) => {
                      const cx = toX(i);
                      const cy = toY(p.report.totalScore);
                      return (
                        <g key={p.mock.id}>
                          <circle
                            cx={cx}
                            cy={cy}
                            r="4.5"
                            fill="#10b981"
                            stroke="#090d16"
                            strokeWidth="2"
                          >
                            <title>{`${p.mock.name} (${p.mock.dayKey}): ${p.report.totalScore}/${p.report.maxMarks}`}</title>
                          </circle>
                          <text
                            x={cx}
                            y={cy - 8}
                            textAnchor="middle"
                            fill="#f8fafc"
                            fontSize="10"
                            fontWeight="700"
                          >
                            {p.report.totalScore}
                          </text>
                          <text
                            x={cx}
                            y={H - 8}
                            textAnchor="middle"
                            fill="#94a3b8"
                            fontSize="9.5"
                          >
                            {p.mock.dayKey.slice(5)}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                );
              })()
            ) : (
              <small className="mu">
                Log your first mock test to see your score progression chart.
              </small>
            )}
          </div>

          {/* Newest-First Mock Test Cards */}
          {mocksOverview.newestFirst.length === 0 ? (
            <div className="card mu">No mock tests logged yet.</div>
          ) : (
            mocksOverview.newestFirst.map(({ mock, report }) => (
              <div key={mock.id} className="card">
                <div className="row sp" style={{ alignItems: 'flex-start' }}>
                  <div>
                    <b style={{ fontSize: '15px' }}>{mock.name}</b>
                    <small style={{ display: 'block' }}>
                      📅 {mock.dayKey}
                      {mock.durationMins ? ` · ⏱️ ${mock.durationMins}m` : ''} · Accuracy{' '}
                      <b>{report.accuracyPct}%</b> · Attempt Rate{' '}
                      <b>{report.attemptRatePct}%</b>
                    </small>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <b
                      className="mono"
                      style={{ fontSize: '18px', color: 'var(--em)', display: 'block' }}
                    >
                      {report.totalScore}{' '}
                      <small style={{ fontSize: '12px', color: 'var(--mu)' }}>
                        / {report.maxMarks}
                      </small>
                    </b>
                  </div>
                </div>

                {/* Per-subject mini score cards */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: '7px',
                    marginTop: '10px',
                  }}
                >
                  {report.bySubject.map((bs) => {
                    const isNeedsAtt =
                      mocksOverview.lowestAccuracySubject?.subjectId === bs.subjectId &&
                      bs.attempted > 0;
                    return (
                      <div
                        key={bs.subjectId}
                        className="stat-box"
                        style={{ borderLeft: `3px solid ${bs.color}` }}
                      >
                        <div className="row sp">
                          <small style={{ fontWeight: 700, color: 'var(--tx)' }}>
                            {bs.e} {bs.name}
                            {isNeedsAtt ? ' ⚠️' : ''}
                          </small>
                          <b className="mono" style={{ fontSize: '13.5px' }}>
                            {bs.score}
                          </b>
                        </div>
                        <small style={{ display: 'block', fontSize: '11px', marginTop: '3px' }}>
                          ✓{bs.correct} · ✗{bs.wrong} · ○{bs.unattempted}
                        </small>
                        <small style={{ display: 'block', fontSize: '11px' }}>
                          Acc: <b>{bs.accuracyPct}%</b> · Att: <b>{bs.attemptRatePct}%</b>
                        </small>
                      </div>
                    );
                  })}
                </div>

                {mock.note && (
                  <small style={{ display: 'block', color: 'var(--tx)', marginTop: '8px' }}>
                    Mistakes / Notes: “{mock.note}”
                  </small>
                )}

                <div className="row" style={{ justifyContent: 'flex-end', marginTop: '10px' }}>
                  <button
                    type="button"
                    className="s"
                    onClick={() => onEditMock(mock.id)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="s dg"
                    onClick={() => onDeleteMock(mock.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {subTab === 'mistakes' && (
        <MistakesView
          state={state}
          todayKey={todayKey}
          onAddMistake={(m) => onAddMistake?.(m)}
          onToggleResolved={(id) => onToggleMistakeResolved?.(id)}
          onDeleteMistake={(id) => onDeleteMistake?.(id)}
          onScheduleRevision={(chapterId, date) => onAddRevision(chapterId, date)}
        />
      )}

      {subTab === 'doubts' && (
        <DoubtsView
          state={state}
          onAddDoubt={(d) => onAddDoubt?.(d)}
          onToggleDoubtResolved={(id) => onToggleDoubtResolved?.(id)}
          onDeleteDoubt={(id) => onDeleteDoubt?.(id)}
        />
      )}
    </div>
  );
};
