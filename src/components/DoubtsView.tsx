import React, { useMemo, useState } from 'react';
import { PulseHabitState } from '../types';
import { getSubject } from '../utils/studyLogic';

interface DoubtsViewProps {
  state: PulseHabitState;
  onAddDoubt: (doubt: { subjectId: string; chapterId?: string; text: string }) => void;
  onToggleDoubtResolved: (doubtId: string) => void;
  onDeleteDoubt: (doubtId: string) => void;
}

export const DoubtsView: React.FC<DoubtsViewProps> = ({
  state,
  onAddDoubt,
  onToggleDoubtResolved,
  onDeleteDoubt,
}) => {
  const activeSubjects = useMemo(
    () => state.subjects.filter((s) => !s.arch),
    [state.subjects]
  );

  const [formSubId, setFormSubId] = useState(activeSubjects[0]?.id || 'sub_phy');
  const [formChapId, setFormChapId] = useState('');
  const [formText, setFormText] = useState('');

  const [filterSub, setFilterSub] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<'open' | 'resolved' | 'all'>('open');

  const availableChapters = useMemo(
    () => state.chapters.filter((ch) => ch.subjectId === formSubId),
    [state.chapters, formSubId]
  );

  const doubts = state.doubts || [];
  const openCount = doubts.filter((d) => !d.resolved).length;
  const resolvedCount = doubts.filter((d) => d.resolved).length;

  const filteredDoubts = useMemo(() => {
    return doubts
      .filter((d) => {
        if (filterSub !== 'all' && d.subjectId !== filterSub) return false;
        if (filterStatus === 'open' && d.resolved) return false;
        if (filterStatus === 'resolved' && !d.resolved) return false;
        return true;
      })
      .sort((a, b) => Number(a.resolved) - Number(b.resolved) || b.createdAt - a.createdAt);
  }, [doubts, filterSub, filterStatus]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = formText.trim();
    if (!clean) return;
    onAddDoubt({
      subjectId: formSubId,
      chapterId: formChapId || undefined,
      text: clean,
    });
    setFormText('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Quick Add Doubt Card */}
      <div className="card" style={{ marginBottom: 0 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 10,
          }}
        >
          <div>
            <div style={{ fontSize: '0.92rem', fontWeight: 900, color: '#f8fafc' }}>
              ❓ Doubt Queue
            </div>
            <div style={{ fontSize: '0.73rem', color: 'var(--muted)', fontWeight: 600 }}>
              {openCount} open • {resolvedCount} resolved • Park questions while studying, clear them
              later
            </div>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 9,
            padding: 12,
            borderRadius: 14,
            background: 'rgba(15, 23, 42, 0.72)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
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
                    padding: '5px 11px',
                    borderRadius: 999,
                    fontSize: '0.73rem',
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

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(120px, 1fr) 2fr auto',
              gap: 8,
              alignItems: 'center',
            }}
          >
            <select
              className="inp"
              value={formChapId}
              onChange={(e) => setFormChapId(e.target.value)}
              style={{ padding: '8px 10px', fontSize: '0.76rem' }}
            >
              <option value="">Chapter (optional)</option>
              {availableChapters.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  {ch.name}
                </option>
              ))}
            </select>

            <input
              type="text"
              className="inp"
              placeholder="Write your doubt or question..."
              value={formText}
              onChange={(e) => setFormText(e.target.value)}
              style={{ padding: '8px 12px', fontSize: '0.8rem' }}
            />

            <button
              type="submit"
              className="btn-main"
              disabled={!formText.trim()}
              style={{ width: 'auto', padding: '8px 14px', fontSize: '0.76rem' }}
            >
              + Add
            </button>
          </div>
        </form>
      </div>

      {/* Filters */}
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

      {/* Doubts List */}
      {filteredDoubts.length === 0 ? (
        <div
          className="card"
          style={{ textAlign: 'center', padding: '26px 16px', color: 'var(--muted)' }}
        >
          <div style={{ fontSize: '1.6rem', marginBottom: 6 }}>💡</div>
          <div style={{ fontSize: '0.84rem', fontWeight: 800, color: 'var(--text)' }}>
            No doubts in this view
          </div>
          <div style={{ fontSize: '0.74rem', marginTop: 4 }}>
            Jot down questions quickly without breaking your study flow, then clear them with your
            teacher or notes.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filteredDoubts.map((d) => {
            const sub = getSubject(state, d.subjectId);
            const ch = d.chapterId
              ? state.chapters.find((c) => c.id === d.chapterId)
              : undefined;
            const dateStr = new Date(d.createdAt).toISOString().slice(0, 10);

            return (
              <div
                key={d.id}
                className="card"
                style={{
                  marginBottom: 0,
                  padding: '12px 14px',
                  borderLeft: `4px solid ${d.resolved ? '#10b981' : sub.color}`,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                  opacity: d.resolved ? 0.75 : 1,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      flexWrap: 'wrap',
                      marginBottom: 3,
                    }}
                  >
                    <span style={{ fontSize: '0.72rem', fontWeight: 800, color: sub.color }}>
                      {sub.e} {sub.name}
                    </span>
                    {ch && (
                      <span
                        style={{
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          color: '#e2e8f0',
                          background: 'rgba(255,255,255,0.06)',
                          padding: '2px 7px',
                          borderRadius: 6,
                        }}
                      >
                        📖 {ch.name}
                      </span>
                    )}
                    <span style={{ fontSize: '0.67rem', color: 'var(--muted)' }}>
                      • Added {dateStr}
                    </span>
                  </div>

                  <div
                    style={{
                      fontSize: '0.84rem',
                      fontWeight: 700,
                      color: d.resolved ? 'var(--muted)' : '#f8fafc',
                      textDecoration: d.resolved ? 'line-through' : 'none',
                    }}
                  >
                    {d.text}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => onToggleDoubtResolved(d.id)}
                    style={{
                      padding: '5px 10px',
                      borderRadius: 8,
                      fontSize: '0.72rem',
                      fontWeight: 800,
                      border: `1px solid ${
                        d.resolved ? 'rgba(16,185,129,0.4)' : 'rgba(255,255,255,0.14)'
                      }`,
                      background: d.resolved
                        ? 'rgba(16,185,129,0.15)'
                        : 'rgba(15,23,42,0.65)',
                      color: d.resolved ? '#10b981' : '#e2e8f0',
                      cursor: 'pointer',
                    }}
                  >
                    {d.resolved ? '✓ Cleared' : 'Mark Cleared'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteDoubt(d.id)}
                    title="Delete doubt"
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
            );
          })}
        </div>
      )}
    </div>
  );
};
