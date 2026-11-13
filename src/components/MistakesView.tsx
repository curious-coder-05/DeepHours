import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarPlus,
  Check,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import type { MistakeEntry, MistakeReason, PulseHabitState } from '../types';
import { addD, getSubject } from '../utils/studyLogic';
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

interface MistakesViewProps {
  state: PulseHabitState;
  todayKey: string;
  onAddMistake: (
    entry: Omit<MistakeEntry, 'id' | 'createdAt' | 'updatedAt' | 'resolved'>
  ) => void;
  onToggleResolved: (id: string) => void;
  onDeleteMistake: (id: string) => void;
  onScheduleRevision?: (chapterId: string, date: string) => void;
}

const MISTAKE_REASON_LIST: MistakeReason[] = [
  'concept',
  'silly',
  'time',
  'guess',
  'forgot',
];

const REASON_LABELS: Record<MistakeReason, { label: string; color: string }> = {
  concept: { label: 'Concept gap', color: '#F87171' },
  silly: { label: 'Calculation / silly', color: '#F5C451' },
  time: { label: 'Time pressure', color: '#60A5FA' },
  guess: { label: 'Guessed', color: '#4ADE80' },
  forgot: { label: 'Forgot formula / fact', color: '#FB923C' },
};

export const MistakesView: React.FC<MistakesViewProps> = ({
  state,
  todayKey,
  onAddMistake,
  onToggleResolved,
  onDeleteMistake,
  onScheduleRevision,
}) => {
  const defaultSubjectId = state.subjects[0]?.id || 'phy';
  const [subjectId, setSubjectId] = useState<string>(defaultSubjectId);
  const [chapterId, setChapterId] = useState<string>('');
  const [mockId, setMockId] = useState<string>('');
  const [reason, setReason] = useState<MistakeReason>('concept');
  const [note, setNote] = useState<string>('');
  const [sheetOpen, setSheetOpen] = useState<boolean>(false);

  const [filterSubject, setFilterSubject] = useState<string>('all');
  const [filterReason, setFilterReason] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'open' | 'resolved'>('open');

  const patterns = useMemo(() => {
    const all = state.mistakes || [];
    const totalCount = all.length;
    const openCount = all.filter((m) => !m.resolved).length;
    const reasonMap: Record<MistakeReason, number> = {
      concept: 0,
      silly: 0,
      time: 0,
      guess: 0,
      forgot: 0,
    };
    const chapterCountMap: Record<string, number> = {};
    for (const m of all) {
      if (reasonMap[m.reason] !== undefined) {
        reasonMap[m.reason] += 1;
      }
      if (!m.resolved && m.chapterId) {
        chapterCountMap[m.chapterId] = (chapterCountMap[m.chapterId] || 0) + 1;
      }
    }
    const byReason = MISTAKE_REASON_LIST.map((r) => ({
      reason: r,
      count: reasonMap[r],
      pct: totalCount > 0 ? Math.round((reasonMap[r] / totalCount) * 100) : 0,
    })).sort((a, b) => b.count - a.count);

    const topWeakChapters = Object.entries(chapterCountMap)
      .map(([cid, count]) => {
        const ch = state.chapters.find((c) => c.id === cid);
        const sub = getSubject(state, ch?.subjectId || defaultSubjectId);
        return {
          chapterId: cid,
          chapterName: ch?.name || 'Chapter',
          subjectEmoji: sub.e,
          count,
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    return {
      totalCount,
      openCount,
      byReason,
      topWeakChapters,
    };
  }, [state, defaultSubjectId]);

  const subjectChapters = useMemo(
    () => state.chapters.filter((ch) => ch.subjectId === subjectId),
    [state.chapters, subjectId]
  );

  const filteredMistakes = useMemo(() => {
    return (state.mistakes || [])
      .filter((m) => {
        if (filterSubject !== 'all' && m.subjectId !== filterSubject) return false;
        if (filterReason !== 'all' && m.reason !== filterReason) return false;
        if (filterStatus === 'open' && m.resolved) return false;
        if (filterStatus === 'resolved' && !m.resolved) return false;
        return true;
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [state.mistakes, filterSubject, filterReason, filterStatus]);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    onAddMistake({
      dayKey: todayKey,
      subjectId,
      chapterId: chapterId || undefined,
      mockId: mockId || undefined,
      reason,
      note: note.trim(),
    });
    setNote('');
    setSheetOpen(false);
  };

  return (
    <div className="space-y-4">
      {/* Header & Pattern Insights */}
      <Card>
        <div className="split mb-3 flex-wrap gap-2">
          <div>
            <h3 className="text-[16px] font-semibold text-[var(--tx)]">
              Mistake notebook &amp; root-cause log
            </h3>
            <p className="text-[12px] text-[var(--tx-2)]">
              Convert mock and practice errors into targeted revisions
            </p>
          </div>
          <Button
            variant="primary"
            size="sm"
            icon={<Plus size={16} />}
            onClick={() => setSheetOpen(true)}
          >
            Log mistake
          </Button>
        </div>

        {patterns.totalCount === 0 ? (
          <div className="rounded-xl border border-[var(--line)] bg-[var(--sf-2)] p-3 text-[13px] text-[var(--tx-2)]">
            No mistakes logged yet. Record errors after mock tests or PYQ practice to spot recurring traps.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-[var(--tx-2)]">
              <span>
                Open mistakes:{' '}
                <strong className="tnum text-[var(--tx)]">{patterns.openCount}</strong> · Total logged:{' '}
                <strong className="tnum text-[var(--tx)]">{patterns.totalCount}</strong>
              </span>
            </div>

            <div className="grid gap-2.5 sm:grid-cols-2">
              {patterns.byReason
                .filter((r) => r.count > 0)
                .map((r) => {
                  const meta = REASON_LABELS[r.reason];
                  return (
                    <div
                      key={r.reason}
                      className="rounded-xl border border-[var(--line)] bg-[var(--sf-2)] p-2.5"
                    >
                      <div className="split mb-1.5 text-[12px]">
                        <span className="font-medium text-[var(--tx)]">{meta.label}</span>
                        <span className="tnum text-[var(--tx-2)]">
                          {r.count} ({r.pct}%)
                        </span>
                      </div>
                      <Meter value={r.pct} max={100} color={meta.color} />
                    </div>
                  );
                })}
            </div>

            {patterns.topWeakChapters.length > 0 && (
              <div className="pt-1">
                <div className="mb-1.5 text-[12px] font-medium text-[var(--tx-2)]">
                  Chapters with most open mistakes
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {patterns.topWeakChapters.map((wc) => (
                    <span
                      key={wc.chapterId}
                      className="tnum inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--sf-2)] px-2.5 py-1 text-[12px] text-[var(--tx)]"
                    >
                      <span>{wc.subjectEmoji}</span>
                      <span>{wc.chapterName}</span>
                      <span className="text-[var(--bad)] font-semibold">{wc.count}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Filters */}
      <Card>
        <div className="space-y-3">
          <Segmented<'all' | 'open' | 'resolved'>
            value={filterStatus}
            onChange={setFilterStatus}
            ariaLabel="Filter mistakes by status"
            options={[
              { value: 'open', label: 'Open' },
              { value: 'resolved', label: 'Resolved' },
              { value: 'all', label: 'All' },
            ]}
          />

          <div className="grid gap-2.5 sm:grid-cols-2">
            <Select
              value={filterSubject}
              onChange={setFilterSubject}
              ariaLabel="Filter mistakes by subject"
              options={[
                { value: 'all', label: 'All subjects' },
                ...state.subjects.map((s) => ({
                  value: s.id,
                  label: `${s.e} ${s.name}`,
                })),
              ]}
            />
            <Select
              value={filterReason}
              onChange={setFilterReason}
              ariaLabel="Filter mistakes by root cause"
              options={[
                { value: 'all', label: 'All root causes' },
                ...MISTAKE_REASON_LIST.map((r) => ({
                  value: r,
                  label: REASON_LABELS[r].label,
                })),
              ]}
            />
          </div>
        </div>
      </Card>

      {/* Mistake Entries */}
      <Card>
        <SectionHeader
          title="Mistake log"
          subtitle={`${filteredMistakes.length} matching entries`}
        />

        {filteredMistakes.length === 0 ? (
          <div className="py-6">
            <EmptyState
              icon={<AlertTriangle size={22} />}
              title={
                filterStatus === 'open'
                  ? 'No open mistakes in this view'
                  : 'No mistakes match your filter'
              }
              description="Log mistakes after mock tests or practice sets so you never repeat the same error on exam day."
              action={
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Plus size={15} />}
                  onClick={() => setSheetOpen(true)}
                >
                  Log mistake
                </Button>
              }
            />
          </div>
        ) : (
          <div className="mt-2 divide-y divide-[var(--line)]">
            {filteredMistakes.map((m) => {
              const sub = getSubject(state, m.subjectId);
              const ch = m.chapterId
                ? state.chapters.find((c) => c.id === m.chapterId)
                : null;
              const mk = m.mockId ? state.mocks.find((x) => x.id === m.mockId) : null;
              const reasonMeta = REASON_LABELS[m.reason] || REASON_LABELS.concept;

              return (
                <div
                  key={m.id}
                  className={`py-3 transition-opacity ${m.resolved ? 'opacity-65' : ''}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ background: sub.color }}
                        />
                        <span className="text-[13px] font-semibold text-[var(--tx)]">
                          {sub.e} {sub.name}
                        </span>
                        {ch && (
                          <span className="rounded-md bg-[var(--sf-2)] px-2 py-0.5 text-[12px] text-[var(--tx-2)]">
                            {ch.name}
                          </span>
                        )}
                        <span
                          className="rounded-md px-2 py-0.5 text-[12px] font-medium"
                          style={{
                            background: 'var(--sf-2)',
                            color: reasonMeta.color,
                            border: `1px solid ${reasonMeta.color}44`,
                          }}
                        >
                          {reasonMeta.label}
                        </span>
                        {mk && (
                          <span className="text-[12px] text-[var(--tx-3)]">
                            Mock: {mk.name}
                          </span>
                        )}
                        <span className="tnum text-[12px] text-[var(--tx-3)]">
                          {m.dayKey}
                        </span>
                      </div>

                      {m.note && (
                        <p
                          className={`mt-1.5 text-[13.5px] text-[var(--tx)] ${
                            m.resolved ? 'line-through text-[var(--tx-2)]' : ''
                          }`}
                        >
                          {m.note}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      {ch && !m.resolved && onScheduleRevision && (
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<CalendarPlus size={14} />}
                          onClick={() => onScheduleRevision(ch.id, addD(todayKey, 1))}
                        >
                          Rev +1d
                        </Button>
                      )}
                      <Button
                        variant={m.resolved ? 'secondary' : 'primary'}
                        size="sm"
                        icon={m.resolved ? <RotateCcw size={14} /> : <Check size={14} />}
                        onClick={() => onToggleResolved(m.id)}
                      >
                        {m.resolved ? 'Reopen' : 'Resolved'}
                      </Button>
                      <IconButton
                        label="Delete mistake"
                        onClick={() => onDeleteMistake(m.id)}
                      >
                        <Trash2 size={16} />
                      </IconButton>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Sheet to Log Mistake */}
      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Log mistake"
      >
        <form onSubmit={handleAdd} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Subject">
              <Select
                value={subjectId}
                onChange={(nextSub) => {
                  setSubjectId(nextSub);
                  setChapterId('');
                }}
                options={state.subjects.map((s) => ({
                  value: s.id,
                  label: `${s.e} ${s.name}`,
                }))}
              />
            </Field>

            <Field label="Chapter (optional)">
              <Select
                value={chapterId}
                onChange={setChapterId}
                options={[
                  { value: '', label: 'General / Unlinked' },
                  ...subjectChapters.map((c) => ({
                    value: c.id,
                    label: c.name,
                  })),
                ]}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Root cause">
              <Select
                value={reason}
                onChange={(val) => setReason(val as MistakeReason)}
                options={MISTAKE_REASON_LIST.map((r) => ({
                  value: r,
                  label: REASON_LABELS[r].label,
                }))}
              />
            </Field>

            <Field label="Linked mock test (optional)">
              <Select
                value={mockId}
                onChange={setMockId}
                options={[
                  { value: '', label: 'Independent practice' },
                  ...(state.mocks || []).map((mk) => ({
                    value: mk.id,
                    label: `${mk.name} (${mk.dayKey})`,
                  })),
                ]}
              />
            </Field>
          </div>

          <Field label="What went wrong & takeaway">
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Forgot sign convention in lens maker formula; review NCERT fig 9.18"
              className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3 text-[14px] text-[var(--tx)]"
            />
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setSheetOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" icon={<Plus size={16} />}>
              Save mistake
            </Button>
          </div>
        </form>
      </Sheet>
    </div>
  );
};
