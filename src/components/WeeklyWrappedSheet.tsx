import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Flame,
  Play,
  Share2,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { fmtHMShort } from '../utils/studyLogic';
import { triggerHaptic } from '../utils/haptics';
import type { WeeklyWrappedReport } from '../utils/weeklyWrapped';
import { BottomSheet } from './BottomSheet';

export interface WeeklyWrappedSheetProps {
  open: boolean;
  onClose: () => void;
  report: WeeklyWrappedReport;
  onFocusSubject: (subjectId: string) => void;
  onShareWeeklyProof: () => void;
}

const TOTAL_SLIDES = 4;

export const WeeklyWrappedSheet: React.FC<WeeklyWrappedSheetProps> = ({
  open,
  onClose,
  report,
  onFocusSubject,
  onShareWeeklyProof,
}) => {
  const [slideIndex, setSlideIndex] = useState<number>(0);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (open) {
      setSlideIndex(0);
    }
  }, [open]);

  const goNext = useCallback(() => {
    setSlideIndex((prev) => {
      if (prev >= TOTAL_SLIDES - 1) return prev;
      triggerHaptic('tap');
      return prev + 1;
    });
  }, []);

  const goPrev = useCallback(() => {
    setSlideIndex((prev) => {
      if (prev <= 0) return prev;
      triggerHaptic('tap');
      return prev - 1;
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [goNext, goPrev, open]);

  const peakHoursSet = new Set<number>();
  if (report.peakWindow) {
    for (let i = 0; i < 3; i++) {
      peakHoursSet.add((report.peakWindow.startHour + i) % 24);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Sunday Night Study Wrapped"
      subtitle={report.dateRangeLabel}
      snap="tall"
    >
      <div
        className="dh-wrapped-shell"
        data-testid="weekly-wrapped-sheet"
        data-slide={slideIndex}
        onTouchStart={(e) => {
          if (e.touches.length === 1) {
            swipeStartRef.current = {
              x: e.touches[0].clientX,
              y: e.touches[0].clientY,
            };
          }
        }}
        onTouchEnd={(e) => {
          const start = swipeStartRef.current;
          swipeStartRef.current = null;
          if (!start || e.changedTouches.length !== 1) return;
          const dx = e.changedTouches[0].clientX - start.x;
          const dy = e.changedTouches[0].clientY - start.y;
          if (Math.abs(dx) >= 44 && Math.abs(dx) > Math.abs(dy) * 1.2) {
            if (dx < 0) goNext();
            else goPrev();
          }
        }}
      >
        {/* Top Story Progress Bars */}
        <div
          className="dh-wrapped-progress"
          role="tablist"
          aria-label="Weekly Wrapped slides"
        >
          {[
            'Deep Hours vs Last Week',
            'Peak Focus Window',
            'Quietly Dodged Subject',
            'Weekly Proof Card',
          ].map((label, idx) => (
            <button
              key={label}
              type="button"
              role="tab"
              aria-selected={idx === slideIndex}
              aria-label={`Slide ${idx + 1}: ${label}`}
              className="dh-wrapped-progress-hit"
              onClick={() => {
                triggerHaptic('tap');
                setSlideIndex(idx);
              }}
            >
              <span
                className={`dh-wrapped-progress-bar ${
                  idx < slideIndex
                    ? 'is-done'
                    : idx === slideIndex
                      ? 'is-current'
                      : ''
                }`}
              />
            </button>
          ))}
        </div>

        {/* Slide Stage with Left/Right Edge Tap Zones */}
        <div className="dh-wrapped-stage">
          {slideIndex > 0 && (
            <button
              type="button"
              aria-label="Previous slide"
              className="dh-wrapped-tap-zone is-left"
              onClick={goPrev}
            />
          )}
          {slideIndex < TOTAL_SLIDES - 1 && (
            <button
              type="button"
              aria-label="Next slide"
              className="dh-wrapped-tap-zone is-right"
              onClick={goNext}
            />
          )}

          {/* SLIDE 1: Deep Hours vs Last Week */}
          {slideIndex === 0 && (
            <div className="dh-wrapped-slide" data-testid="wrapped-slide-0">
              <div className="dh-wrapped-eyebrow">
                <Flame size={14} strokeWidth={1.9} aria-hidden="true" />
                <span>Deep Hours vs Last Week</span>
              </div>

              <div className="dh-wrapped-hero-metric tnum">
                {report.totalMs > 0 ? fmtHMShort(report.totalMs) : '0m'}
              </div>

              <div
                className={`dh-wrapped-delta-pill tnum ${
                  report.deltaDirection === 'up'
                    ? 'is-up'
                    : report.deltaDirection === 'down'
                      ? 'is-down'
                      : ''
                }`}
              >
                {report.deltaDirection === 'up' && (
                  <TrendingUp size={14} strokeWidth={2} aria-hidden="true" />
                )}
                {report.deltaDirection === 'down' && (
                  <TrendingDown size={14} strokeWidth={2} aria-hidden="true" />
                )}
                <span>{report.deltaLabel}</span>
              </div>

              <p className="dh-wrapped-copy">
                {report.hasSessionsThisWeek
                  ? `You logged ${report.sessionsCount} focused ${
                      report.sessionsCount === 1 ? 'session' : 'sessions'
                    } across ${report.activeDays} of 7 days.`
                  : 'No study sessions logged this week yet. One clean 25-minute block sets your baseline.'}
              </p>

              <div className="dh-wrapped-stat-grid">
                <div className="dh-wrapped-stat-box">
                  <span className="dh-wrapped-stat-label">Focus purity</span>
                  <strong className="dh-wrapped-stat-val tnum">
                    {report.avgPurity !== null ? `${report.avgPurity}%` : '—'}
                  </strong>
                </div>
                <div className="dh-wrapped-stat-box">
                  <span className="dh-wrapped-stat-label">Active streak</span>
                  <strong className="dh-wrapped-stat-val tnum">
                    {report.streakDays}d
                  </strong>
                </div>
              </div>
            </div>
          )}

          {/* SLIDE 2: Peak Focus Window */}
          {slideIndex === 1 && (
            <div className="dh-wrapped-slide" data-testid="wrapped-slide-1">
              <div className="dh-wrapped-eyebrow">
                <Clock size={14} strokeWidth={1.9} aria-hidden="true" />
                <span>Peak Focus Window</span>
              </div>

              {report.peakWindow ? (
                <>
                  <div className="dh-wrapped-hero-window tnum">
                    {report.peakWindow.label}
                  </div>
                  <div className="dh-wrapped-delta-pill is-up tnum">
                    <span>
                      {report.peakWindow.avgPurity}% purity ·{' '}
                      {fmtHMShort(report.peakWindow.volumeMs)} logged
                    </span>
                  </div>
                  <p className="dh-wrapped-copy">
                    Your sharpest 3-hour window this week. Protect this block for heavy Physics numericals or timed full mocks.
                  </p>
                </>
              ) : (
                <>
                  <div className="dh-wrapped-hero-window">Waiting for signal</div>
                  <p className="dh-wrapped-copy">
                    Log a few focus sessions this week and Deep Hours will pinpoint your highest-purity 3-hour biological prime window.
                  </p>
                </>
              )}

              {/* 24-hour rhythm bar */}
              <div className="dh-wrapped-rhythm-card" aria-hidden="true">
                <div className="dh-wrapped-rhythm-bars">
                  {Array.from({ length: 24 }, (_, hr) => {
                    const isPeak = peakHoursSet.has(hr);
                    return (
                      <span
                        key={hr}
                        className={`dh-wrapped-rhythm-col ${isPeak ? 'is-peak' : ''}`}
                      />
                    );
                  })}
                </div>
                <div className="dh-wrapped-rhythm-labels tnum">
                  <span>12 AM</span>
                  <span>6 AM</span>
                  <span>12 PM</span>
                  <span>6 PM</span>
                  <span>11 PM</span>
                </div>
              </div>
            </div>
          )}

          {/* SLIDE 3: Quietly Dodged Subject */}
          {slideIndex === 2 && (
            <div className="dh-wrapped-slide" data-testid="wrapped-slide-2">
              <div className="dh-wrapped-eyebrow">
                <Sparkles size={14} strokeWidth={1.9} aria-hidden="true" />
                <span>Quietly Dodged Subject</span>
              </div>

              {report.dodgedSubject ? (
                <>
                  <div className="dh-wrapped-subject-badge">
                    <span
                      className="dh-wrapped-subject-dot"
                      style={{ background: report.dodgedSubject.color }}
                    />
                    <span>
                      {report.dodgedSubject.emoji} {report.dodgedSubject.name}
                    </span>
                  </div>

                  <div className="dh-wrapped-hero-metric tnum">
                    {report.dodgedSubject.studiedMs > 0
                      ? fmtHMShort(report.dodgedSubject.studiedMs)
                      : '0m'}
                  </div>

                  <p className="dh-wrapped-copy">
                    {report.dodgedSubject.studiedMs === 0
                      ? `${report.dodgedSubject.name} received zero study minutes over the last 7 days. Break the friction with one short block right now.`
                      : `Only ${report.dodgedSubject.sharePct}% of your weekly study hours went to ${report.dodgedSubject.name}. Rebalance before your next mock.`}
                  </p>

                  <button
                    type="button"
                    data-testid="wrapped-focus-dodged-btn"
                    className="dh-btn-gold dh-wrapped-cta"
                    onClick={(e) => {
                      e.stopPropagation();
                      triggerHaptic('success');
                      onFocusSubject(report.dodgedSubject!.subjectId);
                    }}
                  >
                    <Play size={16} strokeWidth={2.1} aria-hidden="true" />
                    <span>Focus {report.dodgedSubject.name} now</span>
                  </button>
                </>
              ) : (
                <p className="dh-wrapped-copy">
                  Add active subjects in Settings to see which subject needs attention next week.
                </p>
              )}
            </div>
          )}

          {/* SLIDE 4: Weekly Proof Card */}
          {slideIndex === 3 && (
            <div className="dh-wrapped-slide" data-testid="wrapped-slide-3">
              <div className="dh-wrapped-eyebrow">
                <Share2 size={14} strokeWidth={1.9} aria-hidden="true" />
                <span>Weekly Proof Card</span>
              </div>

              <div className="dh-wrapped-proof-card">
                <div className="dh-wrapped-proof-top">
                  <span className="tnum dh-wrapped-proof-total">
                    {report.totalMs > 0 ? fmtHMShort(report.totalMs) : '0m'}
                  </span>
                  <span className="tnum dh-wrapped-proof-range">
                    {report.dateRangeLabel}
                  </span>
                </div>

                <div className="dh-wrapped-proof-metrics tnum">
                  <span>
                    {report.sessionsCount}{' '}
                    {report.sessionsCount === 1 ? 'session' : 'sessions'}
                  </span>
                  <span>·</span>
                  <span>{report.activeDays}/7 days</span>
                  <span>·</span>
                  <span>
                    {report.avgPurity !== null ? `${report.avgPurity}% purity` : 'Fresh start'}
                  </span>
                </div>

                {report.subjectSlices.length > 0 ? (
                  <div className="dh-wrapped-proof-slices">
                    {report.subjectSlices.slice(0, 4).map((sl) => (
                      <div key={sl.id} className="dh-wrapped-proof-slice-row">
                        <span className="dh-wrapped-proof-slice-name">
                          <span
                            className="dh-wrapped-subject-dot"
                            style={{ background: sl.color }}
                          />
                          <span className="truncate">{sl.label}</span>
                        </span>
                        <span className="tnum dh-wrapped-proof-slice-val">
                          {fmtHMShort(sl.ms)} ({sl.pct}%)
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="dh-wrapped-copy" style={{ margin: 0 }}>
                    Log your first session this week to populate your subject split.
                  </p>
                )}
              </div>

              <button
                type="button"
                data-testid="wrapped-share-proof-btn"
                className="dh-btn-gold dh-wrapped-cta"
                onClick={(e) => {
                  e.stopPropagation();
                  triggerHaptic('success');
                  onShareWeeklyProof();
                }}
              >
                <Share2 size={16} strokeWidth={2} aria-hidden="true" />
                <span>Share weekly proof</span>
              </button>
            </div>
          )}
        </div>

        {/* Bottom Stepper Controls */}
        <div className="dh-wrapped-nav">
          <button
            type="button"
            data-testid="wrapped-prev-btn"
            className="dh-curtain-pill"
            disabled={slideIndex === 0}
            onClick={goPrev}
          >
            <ChevronLeft size={16} strokeWidth={1.8} aria-hidden="true" />
            <span>Back</span>
          </button>

          <span className="dh-wrapped-counter tnum">
            {slideIndex + 1} / {TOTAL_SLIDES}
          </span>

          {slideIndex < TOTAL_SLIDES - 1 ? (
            <button
              type="button"
              data-testid="wrapped-next-btn"
              className="dh-curtain-pill is-accent"
              onClick={goNext}
            >
              <span>Next</span>
              <ChevronRight size={16} strokeWidth={1.8} aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              className="dh-curtain-pill"
              onClick={onClose}
            >
              <span>Done</span>
            </button>
          )}
        </div>
      </div>
    </BottomSheet>
  );
};
