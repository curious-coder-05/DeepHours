import React, { useMemo, useState } from 'react';
import { PulseHabitState } from '../types';
import {
  computeWeeklyReview,
  formatWeeklyReviewClipboard,
  getWeekStartKey,
} from '../utils/insights';
import { addD, fmtDuration } from '../utils/studyLogic';

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
      onToast('Weekly review copied to clipboard', '📋');
    } catch {
      onToast('Could not copy to clipboard', '⚠️');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Week Picker & Copy Summary Header */}
      <div className="card" style={{ marginBottom: 0 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="btn-ghost"
              style={{ width: 'auto', padding: '6px 11px', fontSize: '0.78rem' }}
              onClick={() => setSelectedWeekStart(addD(selectedWeekStart, -7))}
              title="Previous Week"
            >
              ◀
            </button>
            <div>
              <div style={{ fontSize: '0.88rem', fontWeight: 900, color: '#f8fafc' }}>
                {review.weekStartKey} → {review.weekEndKey}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--muted)', fontWeight: 700 }}>
                {selectedWeekStart === currentWeekStart ? 'Current Week' : 'Past Week Review'}
              </div>
            </div>
            <button
              type="button"
              className="btn-ghost"
              style={{ width: 'auto', padding: '6px 11px', fontSize: '0.78rem' }}
              disabled={selectedWeekStart >= currentWeekStart}
              onClick={() => setSelectedWeekStart(addD(selectedWeekStart, 7))}
              title="Next Week"
            >
              ▶
            </button>
            {selectedWeekStart !== currentWeekStart && (
              <button
                type="button"
                className="btn-ghost"
                style={{ width: 'auto', padding: '5px 10px', fontSize: '0.7rem' }}
                onClick={() => setSelectedWeekStart(currentWeekStart)}
              >
                This Week
              </button>
            )}
          </div>

          <button
            type="button"
            className="btn-main"
            style={{ width: 'auto', padding: '8px 14px', fontSize: '0.75rem' }}
            onClick={handleCopySummary}
          >
            📋 Copy summary
          </button>
        </div>
      </div>

      {/* Key Weekly KPIs */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))',
          gap: 10,
        }}
      >
        <div className="card" style={{ marginBottom: 0, padding: '12px 14px' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 800, color: 'var(--muted)' }}>
            TOTAL FOCUS
          </div>
          <div
            style={{
              fontSize: '1.2rem',
              fontWeight: 900,
              color: '#a5b4fc',
              fontFamily: 'var(--mono)',
              marginTop: 2,
            }}
          >
            {fmtDuration(review.totalStudyMs)}
          </div>
        </div>

        <div className="card" style={{ marginBottom: 0, padding: '12px 14px' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 800, color: 'var(--muted)' }}>
            MIN DAYS MET
          </div>
          <div
            style={{
              fontSize: '1.2rem',
              fontWeight: 900,
              color: '#10b981',
              fontFamily: 'var(--mono)',
              marginTop: 2,
            }}
          >
            {review.daysMeetingMin}/7
          </div>
          {review.restDaysUsedInWeek > 0 && (
            <div style={{ fontSize: '0.66rem', color: 'var(--muted)' }}>
              Includes {review.restDaysUsedInWeek} rest pass
            </div>
          )}
        </div>

        <div className="card" style={{ marginBottom: 0, padding: '12px 14px' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 800, color: 'var(--muted)' }}>
            CONSISTENCY
          </div>
          <div
            style={{
              fontSize: '1.2rem',
              fontWeight: 900,
              color: '#38bdf8',
              fontFamily: 'var(--mono)',
              marginTop: 2,
            }}
          >
            {review.consistencyScore !== null ? `${review.consistencyScore}/100` : '-'}
          </div>
        </div>

        <div className="card" style={{ marginBottom: 0, padding: '12px 14px' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 800, color: 'var(--muted)' }}>
            REVISIONS
          </div>
          <div
            style={{
              fontSize: '1.2rem',
              fontWeight: 900,
              color: '#f59e0b',
              fontFamily: 'var(--mono)',
              marginTop: 2,
            }}
          >
            {review.revisionsDone}{' '}
            <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
              ({review.revisionsOnTime} on time)
            </span>
          </div>
        </div>
      </div>

      {/* Hours per Subject vs Weekly Targets */}
      <div className="card" style={{ marginBottom: 0 }}>
        <div
          style={{
            fontSize: '0.82rem',
            fontWeight: 900,
            color: '#f8fafc',
            marginBottom: 10,
          }}
        >
          📚 Hours per Subject vs Weekly Targets
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {review.subjectRows.map((row) => {
            const actualHrs = (row.weeklyActualMins / 60).toFixed(1);
            const targetHrs =
              row.weeklyTargetMins > 0 ? (row.weeklyTargetMins / 60).toFixed(1) : null;
            return (
              <div key={row.subjectId}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '0.78rem',
                    fontWeight: 800,
                    marginBottom: 4,
                  }}
                >
                  <span style={{ color: '#e2e8f0' }}>
                    {row.subjectEmoji} {row.subjectName}
                  </span>
                  <span style={{ fontFamily: 'var(--mono)', color: row.color }}>
                    {actualHrs}h{targetHrs ? ` / ${targetHrs}h (${row.weeklyPct}%)` : ''}
                  </span>
                </div>
                <div
                  style={{
                    height: 7,
                    borderRadius: 999,
                    background: 'rgba(255,255,255,0.07)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${
                        row.weeklyTargetMins > 0
                          ? row.weeklyPct
                          : Math.min(100, (row.weeklyActualMins / 600) * 100)
                      }%`,
                      height: '100%',
                      borderRadius: 999,
                      background: row.color,
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Tasks, Mocks, Mistakes & Best/Worst Day */}
      <div
        className="card"
        style={{
          marginBottom: 0,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--muted)' }}>
            ✅ TASKS COMPLETED
          </div>
          <div style={{ fontSize: '0.92rem', fontWeight: 800, color: '#f8fafc', marginTop: 2 }}>
            {review.tasksDone} / {review.tasksTotal} tasks done
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--muted)' }}>
            🧪 MOCK SCORE TREND
          </div>
          <div style={{ fontSize: '0.88rem', fontWeight: 800, color: '#f8fafc', marginTop: 2 }}>
            {review.mockScoreTrendLabel}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--muted)' }}>
            🎯 MISTAKES LOGGED / RESOLVED
          </div>
          <div style={{ fontSize: '0.88rem', fontWeight: 800, color: '#f8fafc', marginTop: 2 }}>
            {review.mistakesAdded} added • {review.mistakesResolved} resolved
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--muted)' }}>
            ⚡ BEST & LIGHTEST DAY
          </div>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#e2e8f0', marginTop: 2 }}>
            Best: {review.bestDay ? `${review.bestDay.dayKey} (${fmtDuration(review.bestDay.ms)})` : '-'}
            <br />
            Lightest:{' '}
            {review.worstDay ? `${review.worstDay.dayKey} (${fmtDuration(review.worstDay.ms)})` : '-'}
          </div>
        </div>
      </div>

      {/* Next Week Focus (from top 3 Study-next chapters) */}
      <div className="card" style={{ marginBottom: 0 }}>
        <div
          style={{
            fontSize: '0.82rem',
            fontWeight: 900,
            color: '#f8fafc',
            marginBottom: 8,
          }}
        >
          🧭 Next Week Focus (Top 3 Priority Chapters)
        </div>
        {review.nextWeekFocus.length === 0 ? (
          <div style={{ fontSize: '0.76rem', color: 'var(--muted)' }}>
            Add chapters in Prep &gt; Syllabus to generate your priority focus queue.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {review.nextWeekFocus.map((item, idx) => (
              <div
                key={item.chapter.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 12px',
                  borderRadius: 10,
                  background: 'rgba(15, 23, 42, 0.65)',
                  border: `1px solid ${item.subjectColor}33`,
                }}
              >
                <div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#f8fafc' }}>
                    {idx + 1}. {item.subjectEmoji} {item.chapter.name}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--muted)', fontWeight: 700 }}>
                    {item.reasons.join(' • ')}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: 800,
                    color: item.subjectColor,
                    fontFamily: 'var(--mono)',
                  }}
                >
                  Conf {item.confidence}/5
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sleep vs Focus Insight */}
      <div className="card" style={{ marginBottom: 0 }}>
        <div
          style={{
            fontSize: '0.82rem',
            fontWeight: 900,
            color: '#f8fafc',
            marginBottom: 4,
          }}
        >
          😴 Sleep & Focus Insight
        </div>
        <div
          style={{
            fontSize: '0.78rem',
            fontWeight: 700,
            color: review.sleepInsight.available ? '#a5b4fc' : 'var(--muted)',
          }}
        >
          {review.sleepInsight.summaryText}
        </div>
      </div>
    </div>
  );
};
