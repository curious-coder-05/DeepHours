import React, { useMemo, useState } from 'react';
import { Check, HelpCircle, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { Doubt, PulseHabitState } from '../types';
import { getSubject } from '../utils/studyLogic';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { Chip } from './ui/Chip';
import { EmptyState } from './ui/EmptyState';
import { Field } from './ui/Field';
import { IconButton } from './ui/IconButton';
import { SectionHeader } from './ui/SectionHeader';
import { Segmented } from './ui/Segmented';
import { Select } from './ui/Select';
import { Sheet } from './ui/Sheet';

interface DoubtsViewProps {
  state: PulseHabitState;
  onAddDoubt: (doubt: Omit<Doubt, 'id' | 'createdAt' | 'resolved'>) => void;
  onToggleDoubtResolved: (id: string) => void;
  onDeleteDoubt: (id: string) => void;
}

export const DoubtsView: React.FC<DoubtsViewProps> = ({
  state,
  onAddDoubt,
  onToggleDoubtResolved,
  onDeleteDoubt,
}) => {
  const defaultSubjectId = state.subjects[0]?.id || 'phy';
  const [subjectId, setSubjectId] = useState<string>(defaultSubjectId);
  const [chapterId, setChapterId] = useState<string>('');
  const [text, setText] = useState<string>('');
  const [sheetOpen, setSheetOpen] = useState<boolean>(false);

  const [filterSubject, setFilterSubject] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'open' | 'resolved'>('open');

  const availableChapters = useMemo(
    () => state.chapters.filter((ch) => ch.subjectId === subjectId),
    [state.chapters, subjectId]
  );

  const filteredDoubts = useMemo(() => {
    return (state.doubts || [])
      .slice()
      .sort((a, b) => {
        if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
        return b.createdAt - a.createdAt;
      })
      .filter((d) => {
        if (filterSubject !== 'all' && d.subjectId !== filterSubject) return false;
        if (filterStatus === 'open' && d.resolved) return false;
        if (filterStatus === 'resolved' && !d.resolved) return false;
        return true;
      });
  }, [state.doubts, filterSubject, filterStatus]);

  const openCount = (state.doubts || []).filter((d) => !d.resolved).length;
  const resolvedCount = (state.doubts || []).filter((d) => d.resolved).length;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    onAddDoubt({
      subjectId,
      chapterId: chapterId || undefined,
      text: trimmed,
    });
    setText('');
    setSheetOpen(false);
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="split mb-3 flex-wrap gap-2">
          <div>
            <h3 className="text-[16px] font-semibold text-[var(--tx)]">
              Doubts &amp; questions queue
            </h3>
            <p className="text-[12px] text-[var(--tx-2)]">
              Capture conceptual questions during study blocks without breaking focus
            </p>
          </div>
          <Button
            variant="primary"
            size="sm"
            icon={<Plus size={16} />}
            onClick={() => setSheetOpen(true)}
          >
            Add doubt
          </Button>
        </div>

        {/* Quick inline capture */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row">
          <div className="sm:w-44">
            <Select
              value={subjectId}
              onChange={(nextSub) => {
                setSubjectId(nextSub);
                setChapterId('');
              }}
              ariaLabel="Select subject for doubt"
              options={state.subjects.map((s) => ({
                value: s.id,
                label: `${s.e} ${s.name}`,
              }))}
            />
          </div>
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type a question or concept to clarify later…"
            aria-label="Doubt description"
            className="h-11 flex-1 rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3 text-[14px] text-[var(--tx)]"
          />
          <Button type="submit" variant="primary" disabled={!text.trim()}>
            Save
          </Button>
        </form>
      </Card>

      {/* Filter Bar */}
      <Card>
        <div className="flex flex-col gap-3">
          <div className="split flex-wrap gap-2">
            <Segmented
              value={filterStatus}
              onChange={setFilterStatus}
              ariaLabel="Doubt status filter"
              options={[
                { value: 'open', label: `Open (${openCount})` },
                { value: 'resolved', label: `Resolved (${resolvedCount})` },
                { value: 'all', label: `All (${(state.doubts || []).length})` },
              ]}
            />
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            <Chip
              selected={filterSubject === 'all'}
              onClick={() => setFilterSubject('all')}
            >
              All subjects
            </Chip>
            {state.subjects.map((s) => (
              <Chip
                key={s.id}
                selected={filterSubject === s.id}
                colorDot={s.color}
                onClick={() => setFilterSubject(s.id)}
              >
                {s.e} {s.name}
              </Chip>
            ))}
          </div>
        </div>
      </Card>

      {filteredDoubts.length === 0 ? (
        <EmptyState
          icon={<HelpCircle size={22} />}
          title="No doubts in this view"
          description="Jot down tricky NCERT lines or numerical doubts here so you never lose track before your next teacher session."
          action={
            <Button
              variant="secondary"
              size="sm"
              icon={<Plus size={16} />}
              onClick={() => setSheetOpen(true)}
            >
              Add with chapter tag
            </Button>
          }
        />
      ) : (
        <Card>
          <SectionHeader
            title="Saved doubts"
            subtitle={`${filteredDoubts.length} items`}
          />
          <div className="mt-2 divide-y divide-[var(--line)]">
            {filteredDoubts.map((d) => {
              const sub = getSubject(state, d.subjectId);
              const ch = d.chapterId
                ? state.chapters.find((c) => c.id === d.chapterId)
                : null;
              return (
                <div
                  key={d.id}
                  className={`flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between ${
                    d.resolved ? 'opacity-65' : ''
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: sub.color }}
                      />
                      <span className="text-[13px] font-medium text-[var(--tx)]">
                        {sub.e} {sub.name}
                      </span>
                      {ch && (
                        <span className="rounded-md bg-[var(--sf-2)] px-2 py-0.5 text-[12px] text-[var(--tx-2)]">
                          {ch.name}
                        </span>
                      )}
                      <span className="tnum text-[12px] text-[var(--tx-3)]">
                        {new Date(d.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <p
                      className={`mt-1 text-[14px] text-[var(--tx)] ${
                        d.resolved ? 'line-through' : ''
                      }`}
                    >
                      {d.text}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant={d.resolved ? 'secondary' : 'primary'}
                      size="sm"
                      icon={d.resolved ? <RotateCcw size={14} /> : <Check size={14} />}
                      onClick={() => onToggleDoubtResolved(d.id)}
                    >
                      {d.resolved ? 'Reopen' : 'Resolved'}
                    </Button>
                    <IconButton
                      label="Delete doubt"
                      onClick={() => onDeleteDoubt(d.id)}
                    >
                      <Trash2 size={16} />
                    </IconButton>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Detailed Doubt Sheet */}
      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Add doubt with chapter tag"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
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
                { value: '', label: 'General / No chapter' },
                ...availableChapters.map((c) => ({
                  value: c.id,
                  label: c.name,
                })),
              ]}
            />
          </Field>

          <Field label="Doubt question">
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Describe the concept or problem…"
              className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3 text-[14px] text-[var(--tx)]"
              required
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
            <Button type="submit" variant="primary" disabled={!text.trim()}>
              Save doubt
            </Button>
          </div>
        </form>
      </Sheet>
    </div>
  );
};
