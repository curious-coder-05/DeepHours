import React, { useEffect, useState } from 'react';
import {
  Lightbulb,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react';
import {
  computeExamClockSnapshot,
  formatBleedDelta,
  formatExamClockMs,
  formatExamSectionDisplay,
  type ExamClockState,
  type ExamPaceRecord,
  type ExamSectionId,
} from '../utils/examClock';
import { triggerHaptic } from '../utils/haptics';
import { Button, Card, Switch } from './ui';
import { HoldProgressButton } from './HoldProgressButton';

export interface ExamClockViewProps {
  examState: ExamClockState;
  paceRecords: ExamPaceRecord[];
  parkedCount: number;
  onUpdateSection: (
    sectionId: ExamSectionId,
    patch: { budgetMins?: number; enabled?: boolean }
  ) => void;
  onStartExam: (initialSectionId: ExamSectionId) => void;
  onSwitchSection: (sectionId: ExamSectionId) => void;
  onTogglePause: () => void;
  onFinishExam: () => void;
  onResetIdle: () => void;
  onOpenDeskMode: () => void;
  onOpenParkingLot: () => void;
  onInspectRecord: (record: ExamPaceRecord) => void;
}

export const ExamClockView: React.FC<ExamClockViewProps> = ({
  examState,
  paceRecords,
  parkedCount,
  onUpdateSection,
  onStartExam,
  onSwitchSection,
  onTogglePause,
  onFinishExam,
  onResetIdle,
  onOpenDeskMode,
  onOpenParkingLot,
  onInspectRecord,
}) => {
  const [startSectionId, setStartSectionId] = useState<ExamSectionId>('bio');
  const [tick, setTick] = useState(0);

  // Isolated 1Hz tick ONLY while the Exam Chess-Clock is running (0 App.tsx re-renders)
  useEffect(() => {
    if (examState.status !== 'running') return;
    const id = setInterval(() => {
      setTick((n) => n + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [examState.status]);
  void tick;

  const isActive = examState.status === 'running' || examState.status === 'paused';
  const snap = computeExamClockSnapshot(examState);
  const enabledSections = examState.sections.filter((s) => s.enabled);

  const effectiveStartId = enabledSections.some((s) => s.id === startSectionId)
    ? startSectionId
    : enabledSections[0]?.id || 'bio';

  if (!isActive) {
    const omrConfig = examState.sections.find((s) => s.id === 'omr');
    return (
      <div className="dh-exam-wrap dh-amoled-flow">
        <Card className="dh-hero-tier1 dh-exam-setup-card">
          <div className="split" style={{ marginBottom: 12, gap: 10 }}>
            <div>
              <h2 className="dh-exam-title">NEET 3-Hour Chess-Clock</h2>
              <p className="dh-exam-sub">
                Switch freely between sections any time — clocks never lock and
                sum every revisit.
              </p>
            </div>
            <span className="dh-exam-total-badge tabular-nums">
              {examState.totalDurationMins}m total
            </span>
          </div>

          {/* Per-Section Target Budget Editor */}
          <div className="dh-exam-budget-list">
            {examState.sections.map((sec) => {
              const isOmr = sec.id === 'omr';
              return (
                <div
                  key={sec.id}
                  className={`dh-exam-budget-row ${!sec.enabled ? 'is-disabled' : ''}`}
                >
                  <div className="dh-exam-budget-left">
                    <span
                      className="dh-bleed-dot"
                      style={{ background: sec.color }}
                      aria-hidden="true"
                    />
                    <span className="dh-exam-budget-name">{sec.label}</span>
                  </div>

                  <div className="dh-exam-budget-controls">
                    {isOmr && (
                      <Switch
                        checked={Boolean(omrConfig?.enabled)}
                        aria-label="Enable OMR / Review section"
                        onChange={(checked) => {
                          triggerHaptic('tap');
                          onUpdateSection('omr', { enabled: checked });
                        }}
                      />
                    )}
                    {sec.enabled && (
                      <div className="dh-exam-stepper">
                        <button
                          type="button"
                          className="s dh-exam-step-btn"
                          aria-label={`Decrease ${sec.label} budget by 5 minutes`}
                          onClick={() => {
                            triggerHaptic('tap');
                            onUpdateSection(sec.id, {
                              budgetMins: Math.max(5, sec.budgetMins - 5),
                            });
                          }}
                        >
                          −
                        </button>
                        <span className="dh-exam-step-val tabular-nums">
                          {sec.budgetMins}m
                        </span>
                        <button
                          type="button"
                          className="s dh-exam-step-btn"
                          aria-label={`Increase ${sec.label} budget by 5 minutes`}
                          onClick={() => {
                            triggerHaptic('tap');
                            onUpdateSection(sec.id, {
                              budgetMins: Math.min(180, sec.budgetMins + 5),
                            });
                          }}
                        >
                          +
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Starting Section Selector */}
          <div className="dh-exam-start-picker">
            <span className="dh-sheet-field-label">Start paper with</span>
            <div className="dh-exam-start-chips" role="radiogroup" aria-label="Starting exam section">
              {enabledSections.map((sec) => {
                const selected = sec.id === effectiveStartId;
                return (
                  <button
                    key={sec.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`dh-exam-start-chip ${selected ? 'is-selected' : ''}`}
                    onClick={() => {
                      triggerHaptic('tap');
                      setStartSectionId(sec.id);
                    }}
                  >
                    <span
                      className="dh-bleed-dot"
                      style={{ background: sec.color }}
                      aria-hidden="true"
                    />
                    <span>{sec.shortLabel}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Single Gold CTA */}
          <Button
            variant="primary"
            size="xl"
            fullWidth
            className="dh-focus-cta"
            icon={<Play size={20} strokeWidth={2} />}
            onClick={() => {
              triggerHaptic('success');
              onStartExam(effectiveStartId);
            }}
          >
            Start exam clock
          </Button>
        </Card>

        {/* Recent Local Exam Pace Splits (Tier-0 Hairline Section on #000000) */}
        {paceRecords.length > 0 && (
          <section className="dh-amoled-section">
            <div className="dh-eyebrow-row">
              <h3 className="dh-eyebrow">Recent exam pace logs</h3>
              <span className="dh-meta-count tabular-nums" style={{ fontSize: 12, color: 'var(--tx-3)' }}>
                {paceRecords.length} saved
              </span>
            </div>
            <div className="dh-hairline-list">
              {paceRecords.slice(0, 5).map((rec) => {
                const worstBleed = rec.sections.find((s) => s.status === 'bleed');
                return (
                  <button
                    key={rec.id}
                    type="button"
                    className="dh-hairline-row"
                    style={{ border: 0, borderBottom: '1px solid var(--hairline)', borderRadius: 0, width: '100%', textAlign: 'left', padding: '12px 0', background: 'transparent' }}
                    onClick={() => {
                      triggerHaptic('tap');
                      onInspectRecord(rec);
                    }}
                  >
                    <div style={{ minWidth: 0, textAlign: 'left' }}>
                      <div className="dh-exam-history-title tabular-nums">
                        {formatExamClockMs(rec.totalElapsedMs, { forceHours: true })} ·{' '}
                        {rec.switchCount} switches
                      </div>
                      <div className="dh-exam-history-sub">
                        {new Date(rec.completedAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                        })}
                        {worstBleed
                          ? ` · ${worstBleed.label} ${formatBleedDelta(worstBleed.deltaMs)}`
                          : ' · Balanced pace'}
                      </div>
                    </div>
                    <span className="dh-exam-history-link">View bleed ›</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </div>
    );
  }

  const totalDisplay =
    snap.totalOvertimeMs > 0
      ? `+${formatExamClockMs(snap.totalOvertimeMs)} over`
      : formatExamClockMs(snap.totalRemainingMs, { forceHours: true });

  return (
    <div className="dh-exam-wrap">
      <Card className="dh-hero-tier1 dh-exam-live-card">
        {/* Top Live Header */}
        <div className="dh-exam-live-head">
          <div style={{ minWidth: 0 }}>
            <div className="dh-exam-live-eyebrow">
              <span
                className={`dh-exam-live-dot ${
                  examState.status === 'running' ? 'is-running' : 'is-paused'
                }`}
                aria-hidden="true"
              />
              <span>
                {examState.status === 'running' ? 'Exam Hall live' : 'Exam paused'} ·{' '}
                <span className="tabular-nums">{examState.switchCount}</span> switch
                {examState.switchCount === 1 ? '' : 'es'}
              </span>
            </div>
            <div
              className={`dh-exam-live-total tabular-nums ${
                snap.totalOvertimeMs > 0 ? 'is-overtime' : ''
              }`}
              data-testid="exam-total-clock"
            >
              {totalDisplay}
            </div>
          </div>

          <div className="dh-exam-live-top-actions">
            <button
              type="button"
              className="dh-glass-btn dh-exam-icon-pill"
              onClick={() => {
                triggerHaptic('tap');
                onOpenParkingLot();
              }}
              aria-label="Park a thought without pausing exam"
            >
              <Lightbulb size={15} strokeWidth={1.8} aria-hidden="true" />
              <span>Park</span>
              {parkedCount > 0 && (
                <span className="dh-park-badge tabular-nums">{parkedCount}</span>
              )}
            </button>
            <button
              type="button"
              className="dh-glass-btn dh-exam-icon-pill"
              onClick={() => {
                triggerHaptic('tap');
                onOpenDeskMode();
              }}
              aria-label="Open AMOLED StandBy Desk Mode for exam"
            >
              <Maximize2 size={15} strokeWidth={1.8} aria-hidden="true" />
              <span>Desk</span>
            </button>
          </div>
        </div>

        {/* Non-Locking Chess-Clock Pads */}
        <div
          className="dh-exam-pads-grid"
          role="group"
          aria-label="Exam section chess-clock pads"
        >
          {snap.sections.map((sec) => {
            const padClock = formatExamSectionDisplay(sec.remainingMs, sec.overtimeMs);
            return (
              <button
                key={sec.id}
                type="button"
                data-testid={`exam-pad-${sec.id}`}
                aria-pressed={sec.isActive}
                className={`dh-exam-pad ${sec.isActive ? 'is-active' : ''} ${
                  sec.isOvertime ? 'is-overtime dh-exam-overtime-pulse' : ''
                }`.trim()}
                style={{ '--pad-color': sec.color } as React.CSSProperties}
                onClick={() => {
                  triggerHaptic('tap');
                  onSwitchSection(sec.id);
                }}
              >
                <span className="dh-exam-pad-top">
                  <span className="dh-exam-pad-name">
                    <span
                      className="dh-bleed-dot"
                      style={{ background: sec.color }}
                      aria-hidden="true"
                    />
                    <span className="dh-exam-pad-name-text">{sec.label}</span>
                  </span>
                  <span className="dh-exam-pad-visits tabular-nums">
                    {sec.visits}×
                  </span>
                </span>

                <span className="dh-exam-pad-clock tabular-nums">{padClock}</span>

                <span className="dh-exam-pad-meta tabular-nums">
                  {sec.isOvertime ? (
                    <span className="dh-exam-pad-overtime-label">
                      <ShieldAlert size={13} strokeWidth={2} aria-hidden="true" />
                      Over {Math.round(sec.budgetMs / 60_000)}m budget
                    </span>
                  ) : sec.isActive ? (
                    examState.status === 'paused' ? (
                      'Paused · tap to resume'
                    ) : (
                      'Running · tap another to switch'
                    )
                  ) : (
                    `Budget ${Math.round(sec.budgetMs / 60_000)}m`
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {/* Bottom Transport: Pause/Resume + 1.5s Press-and-Hold Finish Paper */}
        <div className="dh-exam-live-controls">
          <Button
            variant="secondary"
            size="lg"
            className="dh-glass-btn"
            icon={
              examState.status === 'running' ? (
                <Pause size={17} strokeWidth={2} />
              ) : (
                <Play size={17} strokeWidth={2} />
              )
            }
            onClick={() => {
              triggerHaptic('tap');
              onTogglePause();
            }}
          >
            {examState.status === 'running' ? 'Pause' : 'Resume'}
          </Button>

          <HoldProgressButton
            label="Finish paper"
            holdingLabel="Finishing…"
            durationMs={1500}
            onComplete={onFinishExam}
          />

          <button
            type="button"
            className="dh-exam-discard-btn"
            aria-label="Discard active exam clock"
            title="Discard exam clock"
            onClick={() => {
              triggerHaptic('tap');
              onResetIdle();
            }}
          >
            <RotateCcw size={15} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      </Card>
    </div>
  );
};
