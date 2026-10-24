import React, { useState } from 'react';
import type {
  Chapter,
  ChapterStatus,
  PrepSubTab,
  PulseHabitState,
} from '../types';
import {
  computeMocksOverview,
  getSortedChapterRevisions,
  getSubject,
} from '../utils/studyLogic';

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
}) => {
  const subjects = state.subjects.filter((s) => !s.arch);
  const defaultSubId = subjects[0]?.id || 'sub_phy';

  const [selectedSubjectFilter, setSelectedSubjectFilter] = useState<string>('all');
  const [addSubjectId, setAddSubjectId] = useState<string>(defaultSubId);
  const [bulkMode, setBulkMode] = useState(false);
  const [singleName, setSingleName] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [newRevDates, setNewRevDates] = useState<Record<string, string>>({});

  // Syllabus metrics
  const totalChapters = state.chapters.length;
  const completedChapters = state.chapters.filter((c) => c.status === 'completed').length;
  const overallChapterPct =
    totalChapters > 0 ? Math.round((completedChapters / totalChapters) * 100) : 0;

  const filteredChapters = state.chapters.filter(
    (c) => selectedSubjectFilter === 'all' || c.subjectId === selectedSubjectFilter
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

  // Mocks overview
  const mocksOverview = computeMocksOverview(state);
  const targetScore = state.set.targetMockScore ?? 650;

  return (
    <div>
      {/* Segmented Switch: Syllabus | Mock Tests */}
      <div className="row sp" style={{ marginBottom: '10px' }}>
        <div>
          <h2>NEET Prep Tracker</h2>
          <small>Chapter syllabus, manual revision dates &amp; mock test analytics</small>
        </div>
        <div
          className="row"
          style={{
            background: 'var(--c2)',
            padding: '4px',
            borderRadius: '14px',
            gap: '4px',
          }}
        >
          <button
            type="button"
            className={subTab === 'syllabus' ? 'on' : ''}
            style={{ padding: '6px 12px', fontSize: '12.5px', borderRadius: '10px' }}
            onClick={() => onChangeSubTab('syllabus')}
          >
            📚 Syllabus
          </button>
          <button
            type="button"
            className={subTab === 'mocks' ? 'on' : ''}
            style={{ padding: '6px 12px', fontSize: '12.5px', borderRadius: '10px' }}
            onClick={() => onChangeSubTab('mocks')}
          >
            📝 Mock Tests
          </button>
        </div>
      </div>

      {subTab === 'syllabus' ? (
        <div>
          {/* Overall & Per-Subject Syllabus Progress Card */}
          <div className="card">
            <div className="row sp" style={{ marginBottom: '6px' }}>
              <div>
                <h3>Syllabus Completion</h3>
                <small>
                  {completedChapters} of {totalChapters} chapters completed
                </small>
              </div>
              <span className="pill mono" style={{ color: 'var(--em)', fontSize: '13px' }}>
                {overallChapterPct}%
              </span>
            </div>
            <div
              style={{
                height: '8px',
                background: 'var(--c2)',
                borderRadius: '99px',
                overflow: 'hidden',
                marginBottom: '12px',
              }}
            >
              <div
                style={{
                  height: '100%',
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
                const subChs = state.chapters.filter((c) => c.subjectId === sub.id);
                const subDone = subChs.filter((c) => c.status === 'completed').length;
                const subPct =
                  subChs.length > 0 ? Math.round((subDone / subChs.length) * 100) : 0;
                return (
                  <div
                    key={sub.id}
                    className="stat-box"
                    style={{ borderLeft: `3px solid ${sub.color}` }}
                  >
                    <div className="row sp">
                      <small style={{ fontWeight: 700, color: 'var(--tx)' }}>
                        {sub.e} {sub.name}
                      </small>
                      <small className="mono">
                        {subDone}/{subChs.length} ({subPct}%)
                      </small>
                    </div>
                    <div
                      style={{
                        height: '5px',
                        background: 'var(--c2)',
                        borderRadius: '99px',
                        overflow: 'hidden',
                        marginTop: '6px',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${subPct}%`,
                          background: sub.color,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Add / Bulk-Add Chapters Card */}
          <div className="card">
            <div className="row sp" style={{ marginBottom: '8px' }}>
              <div>
                <h3>Add Chapters</h3>
                <small>Add one chapter or paste multiple chapter names (one per line)</small>
              </div>
              <button
                type="button"
                className="s"
                onClick={() => setBulkMode((b) => !b)}
              >
                {bulkMode ? 'Single Mode' : '📋 Bulk Paste'}
              </button>
            </div>

            <form onSubmit={handleAddSubmit} style={{ display: 'grid', gap: '8px' }}>
              <div className="chips wrap" style={{ paddingBottom: 0 }}>
                {subjects.map((sub) => (
                  <button
                    type="button"
                    key={sub.id}
                    className={`sub-chip ${addSubjectId === sub.id ? 'active' : ''}`}
                    style={{ '--sc': sub.color } as React.CSSProperties}
                    onClick={() => setAddSubjectId(sub.id)}
                  >
                    <i className="dot" style={{ '--sc': sub.color } as React.CSSProperties} />
                    {sub.e} {sub.name}
                  </button>
                ))}
              </div>

              {bulkMode ? (
                <>
                  <textarea
                    rows={4}
                    value={bulkText}
                    onChange={(e) => setBulkText(e.target.value)}
                    placeholder={
                      'Paste one chapter name per line, e.g.:\nElectrostatics\nCurrent Electricity\nMoving Charges & Magnetism'
                    }
                    aria-label="Bulk chapter names"
                  />
                  <button type="submit" className="pri">
                    + Add All Chapters
                  </button>
                </>
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
                      </div>
                    </div>
                    <button
                      type="button"
                      className="s dg"
                      aria-label={`Delete chapter ${ch.name}`}
                      onClick={() => onDeleteChapter(ch.id)}
                    >
                      ×
                    </button>
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

                  {/* Manual Revision Dates */}
                  <div
                    style={{
                      marginTop: '10px',
                      paddingTop: '8px',
                      borderTop: '1px solid var(--bd)',
                    }}
                  >
                    <small style={{ display: 'block', fontWeight: 700, marginBottom: '6px' }}>
                      Manual Revision Schedule ({sortedRevs.filter((r) => r.done).length}/
                      {sortedRevs.length} done)
                    </small>

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
                                    onChange={() => onToggleRevision(ch.id, rev.id)}
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
      ) : (
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
    </div>
  );
};
