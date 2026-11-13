import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Moon } from 'lucide-react';
import { PulseHabitState } from '../types';
import {
  computeWeeklyReview,
  formatWeeklyReviewClipboard,
  getWeekStartKey,
} from '../utils/insights';
import { addD, fmtDuration } from '../utils/studyLogic';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { IconButton } from './ui/IconButton';
import { Meter } from './ui/Meter';
import { SectionHeader } from './ui/SectionHeader';
import { Stat } from './ui/Stat';

interface ReviewViewProps {
  state: PulseHabitState;
  todayKey: string;
  onToast: (msg: string, icon?: string) => void;
}

export const ReviewView: React.FC<ReviewViewProps> = ({
  state,
  todayKey,
  onToast,
}) => {
  const ws = state.set.ws ?? 1;
  const currentWeekStart = useMemo(() => getWeekStartKey(todayKey, ws), [todayKey, ws]);
  const [selectedWeekStart, setSelectedWeekStart] = useState<string>(currentWeekStart);

  const review = useMemo(
    () => computeWeeklyReview(state, selectedWeekStart, todayKey),
    [state, selectedWeekStart, todayKey]
  );

  const handleCopySummary = async () => {
    const text = formatWeeklyReviewClipboard(review);
    try {
      await navigator.clipboard.writeText(text);
      onToast('Weekly review copied to clipboard');
    } catch {
      onToast('Could not copy to clipboard');
    }
  };

  return (
    <div className="space-y-4">
      {/* Week Picker & Copy Summary */}
      <Card>
        <div className="split flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <IconButton
              label="Previous week"
              onClick={() => setSelectedWeekStart(addD(selectedWeekStart, -7))}
            >
              <ChevronLeft size={18} />
            </IconButton>
            <div>
              <div className="tnum text-[15px] font-semibold text-[var(--tx)]">
                {review.weekStartKey} → {review.weekEndKey}
              </div>
              <div className="text-[12px] text-[var(--tx-2)]">
                {selectedWeekStart === currentWeekStart
                  ? 'Current week review'
                  : 'Past week review'}
              </div>
            </div>
            <IconButton
              label="Next week"
              disabled={selectedWeekStart >= currentWeekStart}
              onClick={() => setSelectedWeekStart(addD(selectedWeekStart, 7))}
            >
              <ChevronRight size={18} />
            </IconButton>
            {selectedWeekStart !== currentWeekStart && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setSelectedWeekStart(currentWeekStart)}
              >
                This week
              </Button>
            )}
          </div>

          <Button
            variant="primary"
            size="sm"
            icon={<Copy size={15} />}
            onClick={handleCopySummary}
          >
            Copy summary
          </Button>
        </div>
      </Card>

      {/* Key Weekly KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <Stat
            label="Total focus"
            value={fmtDuration(review.totalStudyMs)}
            sub="Logged this week"
          />
        </Card>
        <Card>
          <Stat
            label="Min days met"
            value={`${review.daysMeetingMin}/7`}
            sub={
              review.restDaysUsedInWeek > 0
                ? `Includes ${review.restDaysUsedInWeek} rest pass`
                : 'Daily minimum target'
            }
          />
        </Card>
        <Card>
          <Stat
            label="Consistency"
            value={
              review.consistencyScore !== null
                ? `${review.consistencyScore}/100`
                : '—'
            }
            sub="14-day composite"
          />
        </Card>
        <Card>
          <Stat
            label="Revisions"
            value={String(review.revisionsDone)}
            sub={`${review.revisionsOnTime} completed on time`}
          />
        </Card>
      </div>

      {/* Subject Hours vs Weekly Targets */}
      <Card>
        <SectionHeader
          title="Hours per subject vs weekly targets"
          subtitle="Progress toward your subject-wise weekly study allocation"
        />
        <div className="mt-3 space-y-3">
          {review.subjectRows.map((row) => {
            const actualHrs = (row.weeklyActualMins / 60).toFixed(1);
            const targetHrs =
              row.weeklyTargetMins > 0
                ? (row.weeklyTargetMins / 60).toFixed(1)
                : null;
            const pct =
              row.weeklyTargetMins > 0
                ? row.weeklyPct
                : Math.min(100, Math.round((row.weeklyActualMins / 600) * 100));
            return (
              <div key={row.subjectId}>
                <div className="split mb-1 text-[13px]">
                  <span className="flex items-center gap-2 font-medium text-[var(--tx)]">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: row.color }}
                    />
                    {row.subjectEmoji} {row.subjectName}
                  </span>
                  <span className="tnum text-[var(--tx-2)]">
                    {actualHrs}h{targetHrs ? ` / ${targetHrs}h (${row.weeklyPct}%)` : ''}
                  </span>
                </div>
                <Meter value={pct} max={100} color={row.color} />
              </div>
            );
          })}
        </div>
      </Card>

      {/* Secondary Weekly Metrics */}
      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-[var(--line)] bg-[var(--sf-2)] p-3">
            <span className="block text-[12px] text-[var(--tx-2)]">Tasks completed</span>
            <strong className="tnum mt-1 block text-[15px] text-[var(--tx)]">
              {review.tasksDone} / {review.tasksTotal} tasks done
            </strong>
          </div>
          <div className="rounded-xl border border-[var(--line)] bg-[var(--sf-2)] p-3">
            <span className="block text-[12px] text-[var(--tx-2)]">Mock score trend</span>
            <strong className="tnum mt-1 block text-[15px] text-[var(--tx)]">
              {review.mockScoreTrendLabel}
            </strong>
          </div>
          <div className="rounded-xl border border-[var(--line)] bg-[var(--sf-2)] p-3">
            <span className="block text-[12px] text-[var(--tx-2)]">Mistakes logged</span>
            <strong className="tnum mt-1 block text-[15px] text-[var(--tx)]">
              {review.mistakesAdded} added · {review.mistakesResolved} resolved
            </strong>
          </div>
          <div className="rounded-xl border border-[var(--line)] bg-[var(--sf-2)] p-3">
            <span className="block text-[12px] text-[var(--tx-2)]">Best &amp; lightest day</span>
            <div className="tnum mt-1 text-[12.5px] text-[var(--tx)]">
              <div>
                Best:{' '}
                {review.bestDay
                  ? `${review.bestDay.dayKey} (${fmtDuration(review.bestDay.ms)})`
                  : '—'}
              </div>
              <div className="text-[var(--tx-2)]">
                Lightest:{' '}
                {review.worstDay
                  ? `${review.worstDay.dayKey} (${fmtDuration(review.worstDay.ms)})`
                  : '—'}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Next Week Priority Chapters */}
      <Card>
        <SectionHeader
          title="Next week priority focus"
          subtitle="Top 3 chapters recommended from your syllabus queue"
        />
        {review.nextWeekFocus.length === 0 ? (
          <p className="mt-2 text-[13px] text-[var(--tx-2)]">
            Add chapters in Prep &gt; Syllabus to generate your priority focus queue.
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {review.nextWeekFocus.map((item, idx) => (
              <div
                key={item.chapter.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3.5 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: item.subjectColor }}
                    />
                    <span className="truncate text-[14px] font-semibold text-[var(--tx)]">
                      {idx + 1}. {item.subjectEmoji} {item.chapter.name}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[12px] text-[var(--tx-2)]">
                    {item.reasons.join(' · ')}
                  </p>
                </div>
                <span className="tnum rounded-md bg-[var(--sf-1)] px-2.5 py-1 text-[12px] font-medium text-[var(--tx-2)]">
                  Conf {item.confidence}/5
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Sleep vs Focus Insight */}
      <Card>
        <div className="flex items-center gap-2.5">
          <Moon size={18} className="shrink-0 text-[var(--ac)]" />
          <div>
            <h4 className="text-[14px] font-semibold text-[var(--tx)]">
              Sleep &amp; focus correlation
            </h4>
            <p className="text-[13px] text-[var(--tx-2)]">
              {review.sleepInsight.summaryText}
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
};
