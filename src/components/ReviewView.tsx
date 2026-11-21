import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Moon } from 'lucide-react';
import { PulseHabitState } from '../types';
import {
  computeWeeklyReview,
  formatWeeklyReviewClipboard,
  getWeekStartKey,
} from '../utils/insights';
import {
  formatChapterConfidence,
  formatRankedChapterLabel,
} from '../utils/chartHelpers';
import { addD, fmtDuration } from '../utils/studyLogic';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import { Meter } from './ui/Meter';

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

  const hasAnySleepLogged =
    review.sleepInsight.highSleepDays + review.sleepInsight.lowSleepDays > 0;

  const goalMs = Math.max(15, Number(state.set.targets?.minDayMinutes) || 360) * 60000;

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
    <div className="dh-amoled-flow">
      {/* Week Picker & Copy Summary */}
      <section className="dh-amoled-section">
        <div
          className="split flex-wrap gap-3 pb-3"
          style={{ borderBottom: '1px solid var(--hairline)' }}
        >
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
              <div className="text-[12.5px] text-[var(--tx-3)]">
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

          <button
            type="button"
            className="dh-ghost-pill"
            onClick={handleCopySummary}
          >
            <Copy size={14} strokeWidth={1.75} aria-hidden="true" />
            <span>Copy summary</span>
          </button>
        </div>

        {/* Key Weekly KPIs — Hairline 2x2 Ledger */}
        <div className="dh-ledger-2x2">
          <div className="dh-ledger-cell">
            <span className="dh-ledger-label">Total focus</span>
            <span className="dh-ledger-val tnum">{fmtDuration(review.totalStudyMs)}</span>
            <span className="dh-ledger-sub">Logged this week</span>
          </div>
          <div className="dh-ledger-cell">
            <span className="dh-ledger-label">Min days met</span>
            <span className="dh-ledger-val tnum">{review.daysMeetingMin}/7</span>
            <span className="dh-ledger-sub">
              {review.restDaysUsedInWeek > 0
                ? `${fmtDuration(goalMs)}/d · ${review.restDaysUsedInWeek} rest pass`
                : `Goal ${fmtDuration(goalMs)}/day`}
            </span>
          </div>
          <div className="dh-ledger-cell">
            <span className="dh-ledger-label">Consistency</span>
            <span className="dh-ledger-val tnum">
              {review.consistencyScore !== null ? `${review.consistencyScore}/100` : '—'}
            </span>
            <span className="dh-ledger-sub">14-day composite</span>
          </div>
          <div className="dh-ledger-cell">
            <span className="dh-ledger-label">Revisions</span>
            <span className="dh-ledger-val tnum">{review.revisionsDone}</span>
            <span className="dh-ledger-sub">{review.revisionsOnTime} on time</span>
          </div>
        </div>
      </section>

      {/* Subject Hours vs Weekly Targets */}
      <section className="dh-amoled-section">
        <div className="dh-eyebrow-row">
          <h3 className="dh-eyebrow">Hours per subject vs weekly targets</h3>
        </div>
        <div className="dh-hairline-list">
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
              <div
                key={row.subjectId}
                style={{
                  padding: '11px 0',
                  borderBottom: '1px solid var(--hairline)',
                }}
              >
                <div className="split mb-1.5 text-[13.5px]">
                  <span className="flex items-center gap-2 font-medium text-[var(--tx)]">
                    <span
                      className="dh-sub-dot"
                      style={{ background: row.color }}
                      aria-hidden="true"
                    />
                    {row.subjectName}
                  </span>
                  <span className="tnum text-[13px] text-[var(--tx-2)]">
                    {actualHrs}h{targetHrs ? ` / ${targetHrs}h (${row.weeklyPct}%)` : ''}
                  </span>
                </div>
                <Meter value={pct} max={100} color={row.color} height={5} />
              </div>
            );
          })}
        </div>
      </section>

      {/* Secondary Weekly Metrics — Hairline 2x2 Ledger */}
      <section className="dh-amoled-section">
        <div className="dh-eyebrow-row">
          <h3 className="dh-eyebrow">Weekly ledger</h3>
        </div>
        <div className="dh-ledger-2x2">
          <div className="dh-ledger-cell">
            <span className="dh-ledger-label">Tasks completed</span>
            <span className="dh-ledger-val tnum">
              {review.tasksDone}/{review.tasksTotal}
            </span>
            <span className="dh-ledger-sub">Tasks done</span>
          </div>
          <div className="dh-ledger-cell">
            <span className="dh-ledger-label">Mock score trend</span>
            <span className="dh-ledger-val tnum" style={{ fontSize: 16 }}>
              {review.mockScoreTrendLabel}
            </span>
            <span className="dh-ledger-sub">
              {review.mocksCount > 0 ? `${review.mocksCount} logged` : 'No mocks yet'}
            </span>
          </div>
          <div className="dh-ledger-cell">
            <span className="dh-ledger-label">Mistakes</span>
            <span className="dh-ledger-val tnum">
              {review.mistakesAdded} / {review.mistakesResolved}
            </span>
            <span className="dh-ledger-sub">Added · resolved</span>
          </div>
          <div className="dh-ledger-cell">
            <span className="dh-ledger-label">Best &amp; lightest day</span>
            <span className="dh-ledger-val tnum" style={{ fontSize: 15 }}>
              {review.bestDay
                ? `${review.bestDay.dayKey.slice(5)} · ${fmtDuration(review.bestDay.ms)}`
                : '—'}
            </span>
            <span className="dh-ledger-sub tnum">
              Lightest:{' '}
              {review.worstDay
                ? `${review.worstDay.dayKey.slice(5)} (${fmtDuration(review.worstDay.ms)})`
                : '—'}
            </span>
          </div>
        </div>
      </section>

      {/* Next Week Priority Chapters */}
      <section className="dh-amoled-section">
        <div className="dh-eyebrow-row">
          <h3 className="dh-eyebrow">Next week priority focus</h3>
        </div>
        {review.nextWeekFocus.length === 0 ? (
          <div className="dh-empty-inline">
            <span>Add chapters in Prep › Syllabus to generate your priority focus queue.</span>
          </div>
        ) : (
          <div className="dh-hairline-list">
            {review.nextWeekFocus.map((item, idx) => {
              const confLabel = formatChapterConfidence(item.chapter.confidence);
              return (
                <div key={item.chapter.id} className="dh-hairline-row">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="dh-sub-dot"
                        style={{ background: item.subjectColor }}
                        aria-hidden="true"
                      />
                      <span className="truncate text-[14.5px] font-semibold text-[var(--tx)]">
                        {formatRankedChapterLabel(idx + 1, item.chapter.name)}
                      </span>
                    </div>
                    <p className="mt-0.5 pl-3.5 text-[12.5px] text-[var(--tx-3)]">
                      {item.subjectName} · {item.reasons.join(' · ')}
                    </p>
                  </div>
                  {confLabel && (
                    <span className="tnum shrink-0 text-[12.5px] font-medium text-[var(--tx-2)]">
                      {confLabel}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Sleep vs Focus Insight — Hidden until at least 1 sleep entry is logged */}
      {hasAnySleepLogged && (
        <section
          className="dh-amoled-section"
          style={{
            paddingTop: 14,
            borderTop: '1px solid var(--hairline)',
          }}
        >
          <div className="flex items-start gap-2.5">
            <Moon
              size={16}
              className="mt-0.5 shrink-0 text-[var(--ac-ink)]"
              aria-hidden="true"
            />
            <div>
              <h4 className="dh-eyebrow" style={{ color: 'var(--tx-2)' }}>
                Sleep &amp; focus correlation
              </h4>
              <p className="mt-1 text-[13px] text-[var(--tx-2)]">
                {review.sleepInsight.summaryText}
              </p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
};
