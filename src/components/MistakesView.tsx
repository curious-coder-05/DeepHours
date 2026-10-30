import React, { useMemo, useState } from 'react';
import { MistakeEntry, MistakeReason, PulseHabitState } from '../types';
import { addD, getSubject } from '../utils/studyLogic';

interface MistakesViewProps {
  state: PulseHabitState;
  todayKey: string;
  onAddMistake: (mistake: {
    subjectId: string;
    chapterId?: string;
    mockId?: string;
    dayKey: string;
    reason: MistakeReason;
    note?: string;
  }) => void;
  onToggleResolved: (mistakeId: string) => void;
  onDeleteMistake: (mistakeId: string) => void;
  onScheduleRevision: (chapterId: string, date: string) => void;
}

export const MISTAKE_REASON_META: Record<
  MistakeReason,
  { label: string; emoji: string; color: string; bg: string }
> = {
  concept: {
    label: 'Concept Gap',
    emoji: '🧠',
    color: '#818cf8',
    bg: 'rgba(129, 140, 248, 0.14)',
  },
  silly: {
    label: 'Silly / Calculation',
    emoji: '🤦',
    color: '#fbbf24',
    bg: 'rgba(251, 191, 36, 0.14)',
  },
  time: {
    label: 'Time Pressure',
    emoji: '⏱️',
    color: '#f97316',
    bg: 'rgba(249, 115, 22, 0.14)',
  },
  guess: {
    label: 'Guessed / 50-50',
    emoji: '🎲',
    color: '#ec4899',
    bg: 'rgba(236, 72, 153, 0.14)',
  },
  forgot: {
    label: 'Forgot Formula/Fact',
    emoji: '🌫️',
    color: '#38bdf8',
    bg: 'rgba(56, 189, 248, 0.14)',
  },
};

export const MistakesView: React.FC<MistakesViewProps> = ({
  state,
  todayKey,
  onAddMistake,
  onToggleResolved,
  onDeleteMistake,
  onScheduleRevision,
}) => {
  const activeSubjects = useMemo(
    () => state.subjects.filter((s) => !s.arch),
    [state.subjects]
  );

  // Add mistake form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [formSubId, setFormSubId] = useState(activeSubjects[0]?.id || 'sub_phy');
  const [formChapId, setFormChapId] = useState('');
  const [formMockId, setFormMockId] = useState('');
  const [formReason, setFormReason] = useState<MistakeReason>('concept');
  const [formNote, setFormNote] = useState('');

  // Filters
  const [filterSub, setFilterSub] = useState<string>('all');
  const [filterReason, setFilterReason] = useState<MistakeReason | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<'open' | 'resolved' | 'all'>('open');

  // Schedule revision inline picker state: mistakeId -> date
  const [schedulingMistakeId, setSchedulingMistakeId] = useState<string | null>(null);
  const [scheduleDate, setScheduleDate] = useState<string>(() => addD(todayKey, 1));
  const [scheduleChapterOverride, setScheduleChapterOverride] = useState<string>('');

  const availableChaptersForForm = useMemo(
    () => state.chapters.filter((ch) => ch.subjectId === formSubId),
    [state.chapters, formSubId]
  );

  const mistakes = state.mistakes || [];

  // Counts by reason (open vs total)
  const reasonCounts = useMemo(() => {
    const map: Record<MistakeReason, { open: number; total: number }> = {
      concept: { open: 0, total: 0 },
      silly: { open: 0, total: 0 },
      time: { open: 0, total: 0 },
      guess: { open: 0, total: 0 },
      forgot: { open: 0, total: 0 },
    };
    for (const m of mistakes) {
      if (filterSub !== 'all' && m.subjectId !== filterSub) continue;
      const r = map[m.reason] ? m.reason : 'concept';
      map[r].total += 1;
      if (!m.resolved) map[r].open += 1;
    }
    return map;
  }, [mistakes, filterSub]);

  // Counts by chapter (top chapters with open mistakes)
  const chapterMistakeHotspots = useMemo(() => {
    const map: Record<string, { open: number; total: number }> = {};
    for (const m of mistakes) {
      if (!m.chapterId) continue;
      if (filterSub !== 'all' && m.subjectId !== filterSub) continue;
      if (!map[m.chapterId]) map[m.chapterId] = { open: 0, total: 0 };
      map[m.chapterId].total += 1;
      if (!m.resolved) map[m.chapterId].open += 1;
    }
    return Object.entries(map)
      .map(([chapterId, counts]) => {
        const ch = state.chapters.find((c) => c.id === chapterId);
        const sub = getSubject(state, ch?.subjectId || '');
        return {
          chapterId,
          chapterName: ch?.name || 'Deleted Chapter',
          subjectEmoji: sub.e,
          subjectColor: sub.color,
          ...counts,
        };
      })
      .sort((a, b) => b.open - a.open || b.total - a.total)
      .slice(0, 6);
  }, [mistakes, state, filterSub]);

  const filteredMistakes = useMemo(() => {
    return mistakes
      .filter((m) => {
        if (filterSub !== 'all' && m.subjectId !== filterSub) return false;
        if (filterReason !== 'all' && m.reason !== filterReason) return false;
        if (filterStatus === 'open' && m.resolved) return false;
        if (filterStatus === 'resolved' && !m.resolved) return false;
        return true;
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [mistakes, filterSub, filterReason, filterStatus]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAddMistake({
      subjectId: formSubId,
      chapterId: formChapId || undefined,
      mockId: formMockId || undefined,
      dayKey: todayKey,
      reason: formReason,
      note: formNote.trim() || undefined,
    });
    setFormNote('');
    setShowAddForm(false);
  };

  const openScheduleModal = (m: MistakeEntry) => {
    setSchedulingMistakeId(m.id);
    setScheduleDate(addD(todayKey, 1)); // default tomorrow per spec 1.3
    const subChapters = state.chapters.filter((ch) => ch.subjectId === m.subjectId);
    setScheduleChapterOverride(m.chapterId || subChapters[0]?.id || '');
  };

  const confirmScheduleRevision = (m: MistakeEntry) => {
    const targetChapterId = m.chapterId || scheduleChapterOverride;
    if (!targetChapterId || !/^\d{4}-\d{2}-\d{2}$/.test(scheduleDate)) return;
    onScheduleRevision(targetChapterId, scheduleDate);
    setSchedulingMistakeId(null);
  };

  const openCount = mistakes.filter((m) => !m.resolved).length;
  const resolvedCount = mistakes.filter((m) => m.resolved).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Top Summary & Add Action */}
      <div className="card" style={{ marginBottom: 0 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
            marginBottom: 12,
          }}
        >
          <div>
            <div style={{ fontSize: '0.92rem', fontWeight: 900, color: '#f8fafc' }}>
              🎯 Mistake Log & Error Analysis
            </div>
            <div style={{ fontSize: '0.73rem', color: 'var(--muted)', fontWeight: 600 }}>
              {openCount} open • {resolvedCount} resolved • Turn every error into a revision
            </div>
          </div>
          <button
            className="btn-main"
            style={{ width: 'auto', padding: '8px 14px', fontSize: '0.76rem' }}
            onClick={() => setShowAddForm((v) => !v)}
          >
            {showAddForm ? 'Close' : '+ Log Mistake'}
          </button>
        </div>

        {/* Add Mistake Form */}
        {showAddForm && (
          <form
            onSubmit={handleSubmit}
            style={{
              padding: 12,
              borderRadius: 14,
              background: 'rgba(15, 23, 42, 0.75)',
              border: '1px solid rgba(99, 102, 241, 0.3)',
              marginBottom: 14,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ fontSize: '0.74rem', fontWeight: 800, color: 'var(--acc2)' }}>
              LOG NEW MISTAKE
            </div>

            {/* Subject chips */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {activeSubjects.map((sub) => {
                const active = formSubId === sub.id;
                return (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => {
                      setFormSubId(sub.id);
                      setFormChapId('');
                    }}
                    style={{
                      padding: '6px 11px',
                      borderRadius: 999,
                      fontSize: '0.74rem',
                      fontWeight: 800,
                      border: `1px solid ${active ? sub.color : 'rgba(255,255,255,0.1)'}`,
                      background: active ? `${sub.color}22` : 'rgba(15,23,42,0.6)',
                      color: active ? '#fff' : 'var(--muted)',
                      cursor: 'pointer',
                    }}
                  >
                    {sub.e} {sub.name}
                  </button>
                );
              })}
            </div>

            {/* Chapter & Optional Mock Test row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label className="lbl" style={{ marginTop: 0 }}>
                  Chapter (Optional)
                </label>
                <select
                  className="inp"
                  value={formChapId}
                  onChange={(e) => setFormChapId(e.target.value)}
                  style={{ padding: '8px 10px', fontSize: '0.78rem' }}
                >
                  <option value="">— Any / General —</option>
                  {availableChaptersForForm.map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      {ch.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="lbl" style={{ marginTop: 0 }}>
                  Linked Mock (Optional)
                </label>
                <select
                  className="inp"
                  value={formMockId}
                  onChange={(e) => setFormMockId(e.target.value)}
                  style={{ padding: '8px 10px', fontSize: '0.78rem' }}
                >
                  <option value="">— Standalone —</option>
                  {state.mocks.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.dayKey})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Reason selector */}
            <div>
              <label className="lbl" style={{ marginTop: 0 }}>
                Why did this mistake happen?
              </label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(Object.keys(MISTAKE_REASON_META) as MistakeReason[]).map((rKey) => {
                  const meta = MISTAKE_REASON_META[rKey];
                  const active = formReason === rKey;
                  return (
                    <button
                      key={rKey}
                      type="button"
                      onClick={() => setFormReason(rKey)}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 10,
                        fontSize: '0.73rem',
                        fontWeight: 800,
                        border: `1px solid ${active ? meta.color : 'rgba(255,255,255,0.08)'}`,
                        background: active ? meta.bg : 'rgba(15,23,42,0.5)',
                        color: active ? meta.color : 'var(--muted)',
                        cursor: 'pointer',
                      }}
                    >
                      {meta.emoji} {meta.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Note / takeaway */}
            <div>
              <label className="lbl" style={{ marginTop: 0 }}>
                Takeaway / Concept Note
              </label>
              <input
                type="text"
                className="inp"
                placeholder="e.g. Sign convention in lens maker's formula..."
                value={formNote}
                onChange={(e) => setFormNote(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                className="btn-ghost"
                style={{ width: 'auto', padding: '7px 14px', fontSize: '0.75rem' }}
                onClick={() => setShowAddForm(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-main"
                style={{ width: 'auto', padding: '7px 16px', fontSize: '0.75rem' }}
              >
                Save Mistake
              </button>
            </div>
          </form>
        )}

        {/* Counts by Reason */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(95px, 1fr))',
            gap: 8,
          }}
        >
          {(Object.keys(MISTAKE_REASON_META) as MistakeReason[]).map((rKey) => {
            const meta = MISTAKE_REASON_META[rKey];
            const stat = reasonCounts[rKey];
            const isSelected = filterReason === rKey;
            return (
              <button
                key={rKey}
                type="button"
                onClick={() => setFilterReason(isSelected ? 'all' : rKey)}
                style={{
                  padding: '8px 10px',
                  borderRadius: 12,
                  background: isSelected ? meta.bg : 'rgba(15, 23, 42, 0.55)',
                  border: `1px solid ${isSelected ? meta.color : 'rgba(255,255,255,0.06)'}`,
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <div
                  style={{
                    fontSize: '0.68rem',
                    fontWeight: 800,
                    color: meta.color,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {meta.emoji} {meta.label}
                </div>
                <div
                  style={{
                    fontSize: '0.95rem',
                    fontWeight: 900,
                    color: '#f8fafc',
                    marginTop: 2,
                  }}
                >
                  {stat.open}{' '}
                  <span style={{ fontSize: '0.68rem', color: 'var(--muted)', fontWeight: 700 }}>
                    open ({stat.total})
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Counts by Chapter Hotspots */}
        {chapterMistakeHotspots.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div
              style={{
                fontSize: '0.68rem',
                fontWeight: 800,
                color: 'var(--muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: 6,
              }}
            >
              By Chapter (Open / Total)
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {chapterMistakeHotspots.map((ch) => (
                <span
                  key={ch.chapterId}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 999,
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    background: 'rgba(15,23,42,0.75)',
                    border: `1px solid ${ch.subjectColor}44`,
                    color: '#e2e8f0',
                  }}
                >
                  {ch.subjectEmoji} {ch.chapterName}:{' '}
                  <strong style={{ color: ch.open > 0 ? '#f87171' : '#10b981' }}>
                    {ch.open}
                  </strong>
                  /{ch.total}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Filter Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
          <button
            type="button"
            onClick={() => setFilterSub('all')}
            style={{
              padding: '5px 11px',
              borderRadius: 999,
              fontSize: '0.72rem',
              fontWeight: 800,
              border: `1px solid ${filterSub === 'all' ? 'var(--acc)' : 'var(--border)'}`,
              background: filterSub === 'all' ? 'rgba(99,102,241,0.18)' : 'rgba(15,23,42,0.5)',
              color: filterSub === 'all' ? '#fff' : 'var(--muted)',
              cursor: 'pointer',
            }}
          >
            All Subjects
          </button>
          {activeSubjects.map((sub) => (
            <button
              key={sub.id}
              type="button"
              onClick={() => setFilterSub(sub.id)}
              style={{
                padding: '5px 11px',
                borderRadius: 999,
                fontSize: '0.72rem',
                fontWeight: 800,
                border: `1px solid ${filterSub === sub.id ? sub.color : 'var(--border)'}`,
                background: filterSub === sub.id ? `${sub.color}22` : 'rgba(15,23,42,0.5)',
                color: filterSub === sub.id ? '#fff' : 'var(--muted)',
                cursor: 'pointer',
              }}
            >
              {sub.e} {sub.name}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 4 }}>
          {(['open', 'resolved', 'all'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setFilterStatus(st)}
              style={{
                padding: '5px 10px',
                borderRadius: 8,
                fontSize: '0.7rem',
                fontWeight: 800,
                textTransform: 'capitalize',
                border: `1px solid ${filterStatus === st ? 'var(--acc2)' : 'var(--border)'}`,
                background: filterStatus === st ? 'rgba(99,102,241,0.18)' : 'transparent',
                color: filterStatus === st ? '#fff' : 'var(--muted)',
                cursor: 'pointer',
              }}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {/* Mistakes List */}
      {filteredMistakes.length === 0 ? (
        <div
          className="card"
          style={{ textAlign: 'center', padding: '26px 16px', color: 'var(--muted)' }}
        >
          <div style={{ fontSize: '1.6rem', marginBottom: 6 }}>✨</div>
          <div style={{ fontSize: '0.84rem', fontWeight: 800, color: 'var(--text)' }}>
            No mistakes matching this filter
          </div>
          <div style={{ fontSize: '0.74rem', marginTop: 4 }}>
            Log errors from your mock tests or daily practice to turn weak spots into high-yield
            revisions.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filteredMistakes.map((m) => {
            const sub = getSubject(state, m.subjectId);
            const ch = m.chapterId
              ? state.chapters.find((c) => c.id === m.chapterId)
              : undefined;
            const mock = m.mockId ? state.mocks.find((mk) => mk.id === m.mockId) : undefined;
            const rMeta = MISTAKE_REASON_META[m.reason] || MISTAKE_REASON_META.concept;
            const isScheduling = schedulingMistakeId === m.id;
            const subChapters = state.chapters.filter((c) => c.subjectId === m.subjectId);

            return (
              <div
                key={m.id}
                className="card"
                style={{
                  marginBottom: 0,
                  padding: '12px 14px',
                  borderLeft: `4px solid ${m.resolved ? '#10b981' : rMeta.color}`,
                  opacity: m.resolved ? 0.78 : 1,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: 10,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        flexWrap: 'wrap',
                        marginBottom: 4,
                      }}
                    >
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: 999,
                          fontSize: '0.68rem',
                          fontWeight: 800,
                          background: rMeta.bg,
                          color: rMeta.color,
                        }}
                      >
                        {rMeta.emoji} {rMeta.label}
                      </span>
                      <span
                        style={{
                          fontSize: '0.72rem',
                          fontWeight: 800,
                          color: sub.color,
                        }}
                      >
                        {sub.e} {sub.name}
                      </span>
                      {ch && (
                        <span
                          style={{
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            color: '#e2e8f0',
                            background: 'rgba(255,255,255,0.06)',
                            padding: '2px 8px',
                            borderRadius: 6,
                          }}
                        >
                          📖 {ch.name}
                        </span>
                      )}
                      {mock && (
                        <span
                          style={{
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            color: 'var(--muted)',
                          }}
                        >
                          • Mock: {mock.name}
                        </span>
                      )}
                      <span style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>
                        • {m.dayKey}
                      </span>
                    </div>

                    {m.note && (
                      <div
                        style={{
                          fontSize: '0.82rem',
                          fontWeight: 700,
                          color: m.resolved ? 'var(--muted)' : '#f8fafc',
                          textDecoration: m.resolved ? 'line-through' : 'none',
                          marginTop: 4,
                        }}
                      >
                        {m.note}
                      </div>
                    )}
                  </div>

                  {/* Right Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={() => onToggleResolved(m.id)}
                      style={{
                        padding: '5px 10px',
                        borderRadius: 8,
                        fontSize: '0.7rem',
                        fontWeight: 800,
                        border: `1px solid ${
                          m.resolved ? 'rgba(16,185,129,0.4)' : 'rgba(255,255,255,0.14)'
                        }`,
                        background: m.resolved
                          ? 'rgba(16,185,129,0.15)'
                          : 'rgba(15,23,42,0.65)',
                        color: m.resolved ? '#10b981' : '#e2e8f0',
                        cursor: 'pointer',
                      }}
                    >
                      {m.resolved ? '✓ Resolved' : 'Mark Resolved'}
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        isScheduling ? setSchedulingMistakeId(null) : openScheduleModal(m)
                      }
                      style={{
                        padding: '5px 10px',
                        borderRadius: 8,
                        fontSize: '0.7rem',
                        fontWeight: 800,
                        border: '1px solid rgba(99,102,241,0.35)',
                        background: 'rgba(99,102,241,0.14)',
                        color: '#a5b4fc',
                        cursor: 'pointer',
                      }}
                    >
                      📅 Schedule revision
                    </button>

                    <button
                      type="button"
                      onClick={() => onDeleteMistake(m.id)}
                      title="Delete mistake"
                      style={{
                        padding: '5px 8px',
                        borderRadius: 8,
                        fontSize: '0.72rem',
                        border: '1px solid rgba(239,68,68,0.25)',
                        background: 'rgba(239,68,68,0.1)',
                        color: '#f87171',
                        cursor: 'pointer',
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Inline Schedule Revision Date Picker (default tomorrow) */}
                {isScheduling && (
                  <div
                    style={{
                      marginTop: 10,
                      padding: '10px 12px',
                      borderRadius: 10,
                      background: 'rgba(15, 23, 42, 0.85)',
                      border: '1px solid rgba(99, 102, 241, 0.35)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    {!m.chapterId && (
                      <select
                        className="inp"
                        value={scheduleChapterOverride}
                        onChange={(e) => setScheduleChapterOverride(e.target.value)}
                        style={{
                          width: 'auto',
                          minWidth: 150,
                          padding: '6px 10px',
                          fontSize: '0.75rem',
                        }}
                      >
                        <option value="">Select chapter...</option>
                        {subChapters.map((sc) => (
                          <option key={sc.id} value={sc.id}>
                            {sc.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <input
                      type="date"
                      className="inp"
                      value={scheduleDate}
                      onChange={(e) => setScheduleDate(e.target.value)}
                      style={{ width: 'auto', padding: '6px 10px', fontSize: '0.75rem' }}
                    />
                    <button
                      type="button"
                      className="btn-main"
                      style={{ width: 'auto', padding: '6px 12px', fontSize: '0.73rem' }}
                      disabled={!m.chapterId && !scheduleChapterOverride}
                      onClick={() => confirmScheduleRevision(m)}
                    >
                      Add Revision Date
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      style={{ width: 'auto', padding: '6px 10px', fontSize: '0.73rem' }}
                      onClick={() => setSchedulingMistakeId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
