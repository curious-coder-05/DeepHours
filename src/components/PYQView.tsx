import React, { useMemo, useState } from 'react';
import { BookCheck, CheckCircle2, Plus, Trash2 } from 'lucide-react';
import type { PulseHabitState } from '../types';
import { getChapterPYQStats, getSubject } from '../utils/studyLogic';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { Chip } from './ui/Chip';
import { EmptyState } from './ui/EmptyState';
import { Field } from './ui/Field';
import { IconButton } from './ui/IconButton';
import { Meter } from './ui/Meter';
import { SectionHeader } from './ui/SectionHeader';
import { Select } from './ui/Select';
import { Sheet } from './ui/Sheet';
import { Stat } from './ui/Stat';
import { WindowedList } from './ui/WindowedList';

export interface PYQViewProps {
  state: PulseHabitState;
  todayKey: string;
  onAddPYQ: (entry: {
    chapterId: string;
    attempted: number;
    correct: number;
    dayKey: string;
  }) => void;
  onDeletePYQ: (id: string) => void;
}

export const PYQView: React.FC<PYQViewProps> = ({
  state,
  todayKey,
  onAddPYQ,
  onDeletePYQ,
}) => {
  const [filterSubjectId, setFilterSubjectId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sheetOpen, setSheetOpen] = useState<boolean>(false);

  const defaultSubjectId = state.subjects[0]?.id || 'phy';
  const [formSubjectId, setFormSubjectId] = useState<string>(defaultSubjectId);
  const [formChapterId, setFormChapterId] = useState<string>('');
  const [attemptedInput, setAttemptedInput] = useState<string>('30');
  const [correctInput, setCorrectInput] = useState<string>('25');
  const [dayKeyInput, setDayKeyInput] = useState<string>(todayKey);

  const availableFormChapters = useMemo(
    () => state.chapters.filter((ch) => ch.subjectId === formSubjectId),
    [state.chapters, formSubjectId]
  );

  const effectiveChapterId = useMemo(() => {
    if (formChapterId && availableFormChapters.some((c) => c.id === formChapterId)) {
      return formChapterId;
    }
    return availableFormChapters[0]?.id || '';
  }, [formChapterId, availableFormChapters]);

  const pyqStats = useMemo(() => {
    const entries = (state.pyq || [])
      .slice()
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    let totalAttempted = 0;
    let totalCorrect = 0;
    for (const e of entries) {
      totalAttempted += Math.max(0, Number(e.attempted) || 0);
      totalCorrect += Math.max(0, Number(e.correct) || 0);
    }
    const overallAcc =
      totalAttempted > 0 ? Math.round((totalCorrect / totalAttempted) * 100) : null;

    const chapterSummaries = state.chapters
      .map((ch) => ({
        chapter: ch,
        subject: getSubject(state, ch.subjectId),
        summary: getChapterPYQStats(state, ch.id),
      }))
      .filter((item) => {
        if (filterSubjectId !== 'all' && item.chapter.subjectId !== filterSubjectId) {
          return false;
        }
        const q = searchQuery.trim().toLowerCase();
        if (
          q &&
          !item.chapter.name.toLowerCase().includes(q) &&
          !item.subject.name.toLowerCase().includes(q)
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.summary.attempted - a.summary.attempted);

    const filteredEntries = entries.filter((entry) => {
      const ch = state.chapters.find((c) => c.id === entry.chapterId);
      if (filterSubjectId !== 'all' && ch?.subjectId !== filterSubjectId) {
        return false;
      }
      const q = searchQuery.trim().toLowerCase();
      if (q) {
        const chName = (ch?.name || '').toLowerCase();
        if (!chName.includes(q) && !entry.dayKey.includes(q)) return false;
      }
      return true;
    });

    return {
      totalLogs: entries.length,
      totalAttempted,
      totalCorrect,
      overallAcc,
      chapterSummaries,
      filteredEntries,
    };
  }, [state, filterSubjectId, searchQuery]);

  const openLogForChapter = (chapterId?: string, subjectId?: string) => {
    if (subjectId) setFormSubjectId(subjectId);
    if (chapterId) {
      const ch = state.chapters.find((c) => c.id === chapterId);
      if (ch) setFormSubjectId(ch.subjectId);
      setFormChapterId(chapterId);
    }
    setDayKeyInput(todayKey);
    setSheetOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveChapterId) return;
    const att = Math.max(1, Math.round(Number(attemptedInput) || 0));
    const cor = Math.max(0, Math.min(att, Math.round(Number(correctInput) || 0)));
    onAddPYQ({
      chapterId: effectiveChapterId,
      attempted: att,
      correct: cor,
      dayKey: dayKeyInput || todayKey,
    });
    setSheetOpen(false);
  };

  return (
    <div className="space-y-4">
      {/* Summary KPIs */}
      <Card>
        <div className="split mb-3 flex-wrap gap-2">
          <div>
            <h3 className="text-[16px] font-semibold text-[var(--tx)]">
              Previous Year Questions (PYQ) Tracker
            </h3>
            <p className="text-[12px] text-[var(--tx-2)]">
              Track chapter-wise NEET PYQ volume and accuracy across 37-year question banks
            </p>
          </div>
          <Button
            variant="primary"
            size="sm"
            icon={<Plus size={16} />}
            onClick={() => openLogForChapter()}
            disabled={state.chapters.length === 0}
          >
            Log PYQ set
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          <Stat
            label="Questions solved"
            value={pyqStats.totalAttempted.toLocaleString()}
            sub={`${pyqStats.totalLogs} sets logged`}
          />
          <Stat
            label="Correct answers"
            value={pyqStats.totalCorrect.toLocaleString()}
            sub="Verified PYQs"
          />
          <Stat
            label="Overall accuracy"
            value={pyqStats.overallAcc !== null ? `${pyqStats.overallAcc}%` : '—'}
            sub={
              pyqStats.overallAcc !== null && pyqStats.overallAcc >= 85
                ? 'Strong accuracy'
                : 'Target 85%+'
            }
          />
        </div>
      </Card>

      {/* Filter Bar */}
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            <Chip
              selected={filterSubjectId === 'all'}
              onClick={() => setFilterSubjectId('all')}
            >
              All subjects
            </Chip>
            {state.subjects.map((s) => (
              <Chip
                key={s.id}
                selected={filterSubjectId === s.id}
                colorDot={s.color}
                onClick={() => setFilterSubjectId(s.id)}
              >
                {s.e} {s.name}
              </Chip>
            ))}
          </div>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search chapter…"
            aria-label="Search PYQ chapters"
            className="h-10 rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3 text-[13px] text-[var(--tx)] sm:w-56"
          />
        </div>
      </Card>

      {state.chapters.length === 0 ? (
        <EmptyState
          icon={<BookCheck size={22} />}
          title="Add syllabus chapters first"
          description="Add chapters in the Syllabus tab to start logging chapter-wise PYQ practice sets."
        />
      ) : (
        <>
          {/* Chapter-wise PYQ coverage */}
          <Card>
            <SectionHeader
              title="Chapter-wise PYQ coverage"
              subtitle="Tap + Log on any chapter to record a new PYQ batch"
            />
            <WindowedList
              items={pyqStats.chapterSummaries}
              threshold={100}
              estimatedRowHeight={74}
              itemLabel="chapters"
              className="mt-2 divide-y divide-[var(--line)]"
              getKey={({ chapter }) => chapter.id}
              renderItem={({ chapter, subject, summary }) => {
                const accColor =
                  summary.accuracyPct === null
                    ? 'var(--tx-3)'
                    : summary.accuracyPct >= 80
                      ? 'var(--ok)'
                      : summary.accuracyPct >= 60
                        ? 'var(--warn)'
                        : 'var(--err)';
                return (
                  <div className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: subject.color }}
                        />
                        <span className="truncate text-[14px] font-medium text-[var(--tx)]">
                          {chapter.name}
                        </span>
                        <span className="text-[12px] text-[var(--tx-3)]">
                          {subject.e} {subject.name}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-3">
                        <div className="w-32 sm:w-44">
                          <Meter
                            value={summary.accuracyPct ?? 0}
                            max={100}
                            color={accColor}
                          />
                        </div>
                        <span className="tnum text-[12px] text-[var(--tx-2)]">
                          {summary.attempted > 0
                            ? `${summary.correct}/${summary.attempted} (${summary.accuracyPct}%)`
                            : 'No PYQs logged'}
                        </span>
                      </div>
                    </div>

                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openLogForChapter(chapter.id, chapter.subjectId)}
                    >
                      + Log
                    </Button>
                  </div>
                );
              }}
            />
          </Card>

          {/* Recent PYQ Logs */}
          <Card>
            <SectionHeader
              title="Recent PYQ logs"
              subtitle={`${pyqStats.filteredEntries.length} recorded practice batches`}
            />
            {pyqStats.filteredEntries.length === 0 ? (
              <div className="py-6 text-center text-[13px] text-[var(--tx-2)]">
                No PYQ batches logged for this filter yet.
              </div>
            ) : (
              <WindowedList
                items={pyqStats.filteredEntries}
                threshold={100}
                estimatedRowHeight={62}
                itemLabel="PYQ logs"
                className="mt-2 divide-y divide-[var(--line)]"
                getKey={(entry) => entry.id}
                renderItem={(entry) => {
                  const ch = state.chapters.find((c) => c.id === entry.chapterId);
                  const sub = getSubject(state, ch?.subjectId || defaultSubjectId);
                  const acc =
                    entry.attempted > 0
                      ? Math.round((entry.correct / entry.attempted) * 100)
                      : 0;
                  return (
                    <div className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ background: sub.color }}
                          />
                          <span className="text-[13.5px] font-medium text-[var(--tx)]">
                            {ch ? ch.name : 'Chapter'}
                          </span>
                          <span className="tnum rounded-md bg-[var(--sf-2)] px-2 py-0.5 text-[12px] font-medium text-[var(--ac-ink)]">
                            {entry.correct}/{entry.attempted} ({acc}%)
                          </span>
                          <span className="tnum text-[12px] text-[var(--tx-3)]">
                            {entry.dayKey || todayKey}
                          </span>
                        </div>
                      </div>
                      <IconButton
                        label="Delete PYQ log"
                        onClick={() => onDeletePYQ(entry.id)}
                      >
                        <Trash2 size={16} />
                      </IconButton>
                    </div>
                  );
                }}
              />
            )}
          </Card>
        </>
      )}

      {/* Sheet to Log PYQ Batch */}
      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Log PYQ practice batch"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Subject">
            <Select
              value={formSubjectId}
              onChange={(nextSub) => {
                setFormSubjectId(nextSub);
                const firstCh = state.chapters.find((c) => c.subjectId === nextSub);
                setFormChapterId(firstCh?.id || '');
              }}
              options={state.subjects.map((s) => ({
                value: s.id,
                label: `${s.e} ${s.name}`,
              }))}
            />
          </Field>

          <Field label="Chapter">
            {availableFormChapters.length === 0 ? (
              <div className="rounded-xl border border-[var(--line)] bg-[var(--sf-2)] p-3 text-[13px] text-[var(--tx-2)]">
                No chapters in this subject yet. Add a chapter in the Syllabus tab first.
              </div>
            ) : (
              <Select
                value={effectiveChapterId}
                onChange={(val) => setFormChapterId(val)}
                options={availableFormChapters.map((c) => ({
                  value: c.id,
                  label: c.name,
                }))}
              />
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Attempted questions">
              <input
                type="number"
                min={1}
                max={2000}
                value={attemptedInput}
                onChange={(e) => setAttemptedInput(e.target.value)}
                className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3 text-[14px] text-[var(--tx)]"
                required
              />
            </Field>
            <Field label="Correct answers">
              <input
                type="number"
                min={0}
                max={2000}
                value={correctInput}
                onChange={(e) => setCorrectInput(e.target.value)}
                className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3 text-[14px] text-[var(--tx)]"
                required
              />
            </Field>
          </div>

          <Field label="Date">
            <input
              type="date"
              value={dayKeyInput}
              onChange={(e) => setDayKeyInput(e.target.value)}
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
            <Button
              type="submit"
              variant="primary"
              icon={<CheckCircle2 size={16} />}
              disabled={!effectiveChapterId}
            >
              Save PYQ log
            </Button>
          </div>
        </form>
      </Sheet>
    </div>
  );
};
