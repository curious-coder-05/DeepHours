import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Eye,
  EyeOff,
  Lightbulb,
  Minimize2,
  Moon,
  Pause,
  Play,
  Sun,
} from 'lucide-react';
import type { PulseHabitState } from '../types';
import {
  fmtHMS,
  fmtMS,
  getSubject,
  getTimerMetrics,
} from '../utils/studyLogic';
import { useTimerTick } from '../utils/timerTicker';
import {
  computeExamClockSnapshot,
  formatExamClockMs,
  formatExamSectionDisplay,
  type ExamClockState,
  type ExamSectionId,
} from '../utils/examClock';
import {
  exitDeskFullscreen,
  requestDeskFullscreen,
  useWakeLock,
} from '../hooks/useWakeLock';
import { prefersReducedMotion, triggerHaptic } from '../utils/haptics';
import { HoldProgressButton } from './HoldProgressButton';

/**
 * 8-step subtle OLED burn-in protection micro-orbit (4px–8px shifts every 60s,
 * GPU-only translate3d).
 */
const BURN_IN_ORBIT: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [6, 2],
  [4, 7],
  [-4, 6],
  [-7, 0],
  [-5, -6],
  [4, -5],
  [7, -2],
];

export interface StandByDeskOverlayProps {
  open: boolean;
  mode: 'focus' | 'exam';
  state: PulseHabitState;
  examState: ExamClockState;
  parkedCount: number;
  parkingSheetOpen: boolean;
  onExit: () => void;
  onOpenParkingLot: () => void;
  // Focus mode actions
  onToggleFocusPause: () => void;
  onStopFocus: () => void;
  // Exam mode actions
  onSwitchExamSection: (sectionId: ExamSectionId) => void;
  onToggleExamPause: () => void;
  onFinishExam: () => void;
}

export const StandByDeskOverlay: React.FC<StandByDeskOverlayProps> = ({
  open,
  mode,
  state,
  examState,
  parkedCount,
  parkingSheetOpen,
  onExit,
  onOpenParkingLot,
  onToggleFocusPause,
  onStopFocus,
  onSwitchExamSection,
  onToggleExamPause,
  onFinishExam,
}) => {
  const [nightDim, setNightDim] = useState(false);
  const [hideSeconds, setHideSeconds] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(false);
  const [orbitIdx, setOrbitIdx] = useState(0);
  const [examTick, setExamTick] = useState(0);
  const holdingRef = useRef(false);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Screen Wake Lock while StandBy Desk Mode is active
  useWakeLock(open);

  // Isolated 1Hz subscription for Focus timer (0 re-renders when paused/idle)
  const isFocusRunning =
    open && mode === 'focus' && state.activeTimer?.status === 'running';
  useTimerTick(isFocusRunning);

  // Isolated 1Hz local tick ONLY when Desk Mode is displaying a running Exam clock
  const isExamRunning =
    open && mode === 'exam' && examState.status === 'running';
  useEffect(() => {
    if (!isExamRunning) return;
    const id = setInterval(() => {
      setExamTick((n) => n + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [isExamRunning]);
  void examTick;

  // Fullscreen lifecycle with silent graceful fallback
  useEffect(() => {
    if (!open) return;
    void requestDeskFullscreen();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !parkingSheetOpen) {
        e.stopPropagation();
        onExit();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
      void exitDeskFullscreen();
    };
  }, [open, onExit, parkingSheetOpen]);

  // Subtle 60-second OLED pixel-shift micro-orbit (disabled for prefers-reduced-motion)
  useEffect(() => {
    if (!open) return;
    if (prefersReducedMotion()) {
      setOrbitIdx(0);
      return;
    }
    const id = setInterval(() => {
      setOrbitIdx((i) => (i + 1) % BURN_IN_ORBIT.length);
    }, 60_000);
    return () => clearInterval(id);
  }, [open]);

  const clearAutoFade = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  const scheduleAutoFade = useCallback(() => {
    clearAutoFade();
    if (holdingRef.current || parkingSheetOpen) return;
    hideTimeoutRef.current = setTimeout(() => {
      if (!holdingRef.current) {
        setControlsVisible(false);
      }
    }, 3000);
  }, [clearAutoFade, parkingSheetOpen]);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    scheduleAutoFade();
  }, [scheduleAutoFade]);

  useEffect(() => {
    if (!open) {
      clearAutoFade();
      setControlsVisible(false);
      return;
    }
    // Start cleanly hidden during study; tap anywhere to reveal
    setControlsVisible(false);
    return clearAutoFade;
  }, [open, clearAutoFade]);

  useEffect(() => {
    if (parkingSheetOpen) {
      clearAutoFade();
    } else if (controlsVisible && open) {
      scheduleAutoFade();
    }
  }, [parkingSheetOpen, controlsVisible, open, clearAutoFade, scheduleAutoFade]);

  if (!open) return null;

  const [shiftX, shiftY] = BURN_IN_ORBIT[orbitIdx];
  const t = state.activeTimer;
  const focusMetrics = mode === 'focus' ? getTimerMetrics(state) : null;
  const curSubject = t ? getSubject(state, t.subjectId) : state.subjects[0];
  const curChapter = t?.chapterId
    ? state.chapters.find((c) => c.id === t.chapterId)
    : undefined;

  const defaultIdleMs = (state.set.pomoWork || 25) * 60_000;
  const displayMs = focusMetrics ? focusMetrics.displayMs : defaultIdleMs;
  const isStopwatch = t?.mode === 'stopwatch';

  const focusClockStr = hideSeconds
    ? formatExamClockMs(displayMs, { hideSeconds: true })
    : isStopwatch || displayMs >= 3_600_000
      ? fmtHMS(displayMs)
      : fmtMS(displayMs);

  const examSnapshot = mode === 'exam' ? computeExamClockSnapshot(examState) : null;
  const totalExamStr = examSnapshot
    ? examSnapshot.totalOvertimeMs > 0
      ? `+${formatExamClockMs(examSnapshot.totalOvertimeMs, { hideSeconds })} over`
      : formatExamClockMs(examSnapshot.totalRemainingMs, {
          hideSeconds,
          forceHours: true,
        })
    : '03:00:00';

  const overlayNode = (
    <div
      className={`dh-standby-overlay ${nightDim ? 'is-night-dim' : ''} ${
        controlsVisible ? 'controls-visible' : ''
      } ${mode === 'exam' ? 'is-exam-mode' : 'is-focus-mode'}`.trim()}
      role="dialog"
      aria-modal="true"
      aria-label={
        mode === 'exam'
          ? 'AMOLED StandBy Exam Hall Desk Mode'
          : 'AMOLED StandBy Desk Mode'
      }
      onClick={() => {
        if (controlsVisible) {
          clearAutoFade();
          setControlsVisible(false);
        } else {
          revealControls();
        }
      }}
    >
      {/* Top Frosted Controls Bar (Auto-fades after 3s) */}
      <div
        className={`dh-standby-bar dh-standby-bar-top ${
          controlsVisible ? 'is-visible' : ''
        }`}
        aria-hidden={!controlsVisible}
        onClick={(e) => {
          e.stopPropagation();
          revealControls();
        }}
      >
        <div className="dh-standby-bar-group">
          <button
            type="button"
            className={`dh-standby-pill ${nightDim ? 'is-active' : ''}`}
            tabIndex={controlsVisible ? 0 : -1}
            aria-pressed={nightDim}
            onClick={() => {
              triggerHaptic('tap');
              setNightDim((v) => !v);
              revealControls();
            }}
          >
            {nightDim ? (
              <Sun size={15} strokeWidth={1.8} aria-hidden="true" />
            ) : (
              <Moon size={15} strokeWidth={1.8} aria-hidden="true" />
            )}
            <span>Night dim</span>
          </button>

          <button
            type="button"
            className={`dh-standby-pill ${hideSeconds ? 'is-active' : ''}`}
            tabIndex={controlsVisible ? 0 : -1}
            aria-pressed={hideSeconds}
            onClick={() => {
              triggerHaptic('tap');
              setHideSeconds((v) => !v);
              revealControls();
            }}
          >
            {hideSeconds ? (
              <Eye size={15} strokeWidth={1.8} aria-hidden="true" />
            ) : (
              <EyeOff size={15} strokeWidth={1.8} aria-hidden="true" />
            )}
            <span>{hideSeconds ? 'Show sec' : 'Hide sec'}</span>
          </button>

          <button
            type="button"
            className="dh-standby-pill"
            tabIndex={controlsVisible ? 0 : -1}
            onClick={() => {
              triggerHaptic('tap');
              onOpenParkingLot();
            }}
          >
            <Lightbulb size={15} strokeWidth={1.8} aria-hidden="true" />
            <span>Park thought</span>
            {parkedCount > 0 && (
              <span className="dh-park-badge tabular-nums">{parkedCount}</span>
            )}
          </button>
        </div>

        <button
          type="button"
          className="dh-standby-pill dh-standby-exit-pill"
          tabIndex={controlsVisible ? 0 : -1}
          aria-label="Exit desk mode"
          onClick={() => {
            triggerHaptic('tap');
            onExit();
          }}
        >
          <Minimize2 size={15} strokeWidth={1.8} aria-hidden="true" />
          <span>Exit</span>
        </button>
      </div>

      {/* Main AMOLED Burn-In Protected Stage */}
      <div
        className="dh-standby-stage"
        style={{
          transform: `translate3d(${shiftX}px, ${shiftY}px, 0)`,
        }}
      >
        {mode === 'focus' ? (
          <div className="dh-standby-focus-core">
            <div className="dh-standby-meta">
              <span
                className="dh-standby-subject-dot"
                style={{
                  background: nightDim
                    ? '#933519'
                    : curSubject?.color || 'var(--ac)',
                }}
                aria-hidden="true"
              />
              <span className="dh-standby-subject-label">
                {curSubject?.name || 'Deep Study'}
                {curChapter ? ` · ${curChapter.name}` : t?.heading ? ` · ${t.heading}` : ''}
              </span>
              {t?.status === 'paused' && (
                <span className="dh-standby-paused-tag">Paused</span>
              )}
            </div>

            <div
              className="dh-standby-clock tabular-nums"
              data-testid="standby-focus-clock"
            >
              {focusClockStr}
            </div>

            {focusMetrics && focusMetrics.overtimeMs > 0 && (
              <div className="dh-standby-overtime tabular-nums">
                +{formatExamClockMs(focusMetrics.overtimeMs, { hideSeconds })} overtime
              </div>
            )}
          </div>
        ) : (
          examSnapshot && (
            <div className="dh-standby-exam-core">
              <div className="dh-standby-exam-header">
                <span className="dh-standby-exam-label">
                  NEET Exam Hall {examState.status === 'paused' ? '· Paused' : ''}
                </span>
                <span
                  className={`dh-standby-exam-total tabular-nums ${
                    examSnapshot.totalOvertimeMs > 0 ? 'is-overtime' : ''
                  }`}
                  data-testid="standby-exam-total"
                >
                  {totalExamStr}
                </span>
              </div>

              <div
                className={`dh-standby-exam-grid cols-${examSnapshot.sections.length}`}
                onClick={(e) => e.stopPropagation()}
              >
                {examSnapshot.sections.map((sec) => {
                  const clockText = formatExamSectionDisplay(
                    sec.remainingMs,
                    sec.overtimeMs,
                    { hideSeconds }
                  );
                  return (
                    <button
                      key={sec.id}
                      type="button"
                      className={`dh-standby-pad ${sec.isActive ? 'is-active' : ''} ${
                        sec.isOvertime ? 'is-overtime dh-exam-overtime-pulse' : ''
                      }`.trim()}
                      style={
                        {
                          '--pad-color': nightDim ? '#B84A27' : sec.color,
                        } as React.CSSProperties
                      }
                      aria-pressed={sec.isActive}
                      onClick={(e) => {
                        e.stopPropagation();
                        triggerHaptic('tap');
                        onSwitchExamSection(sec.id);
                      }}
                    >
                      <span className="dh-standby-pad-top">
                        <span className="dh-standby-pad-name">{sec.label}</span>
                        <span className="dh-standby-pad-visits tabular-nums">
                          {sec.visits}×
                        </span>
                      </span>
                      <span className="dh-standby-pad-clock tabular-nums">
                        {clockText}
                      </span>
                      <span className="dh-standby-pad-foot tabular-nums">
                        {sec.isActive
                          ? examState.status === 'paused'
                            ? 'Paused · tap to resume'
                            : 'Active'
                          : `${Math.round(sec.budgetMs / 60_000)}m budget`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )
        )}
      </div>

      {/* Bottom Frosted Transport & Anti-Accidental Hold-to-Stop Bar */}
      <div
        className={`dh-standby-bar dh-standby-bar-bottom ${
          controlsVisible ? 'is-visible' : ''
        }`}
        aria-hidden={!controlsVisible}
        onClick={(e) => {
          e.stopPropagation();
          revealControls();
        }}
      >
        {mode === 'focus' ? (
          t ? (
            <>
              <button
                type="button"
                className="dh-standby-pill dh-standby-transport-pill"
                tabIndex={controlsVisible ? 0 : -1}
                onClick={() => {
                  triggerHaptic('tap');
                  onToggleFocusPause();
                  revealControls();
                }}
              >
                {t.status === 'running' ? (
                  <>
                    <Pause size={16} strokeWidth={2} aria-hidden="true" />
                    <span>Pause</span>
                  </>
                ) : (
                  <>
                    <Play size={16} strokeWidth={2} aria-hidden="true" />
                    <span>Resume</span>
                  </>
                )}
              </button>

              <HoldProgressButton
                label="Hold to stop"
                holdingLabel="Stopping…"
                durationMs={1500}
                onHoldStart={() => {
                  holdingRef.current = true;
                  clearAutoFade();
                }}
                onHoldEnd={() => {
                  holdingRef.current = false;
                  scheduleAutoFade();
                }}
                onComplete={() => {
                  onExit();
                  onStopFocus();
                }}
              />
            </>
          ) : (
            <span className="dh-standby-hint">Tap anywhere to hide controls</span>
          )
        ) : (
          <>
            <button
              type="button"
              className="dh-standby-pill dh-standby-transport-pill"
              tabIndex={controlsVisible ? 0 : -1}
              onClick={() => {
                triggerHaptic('tap');
                onToggleExamPause();
                revealControls();
              }}
            >
              {examState.status === 'running' ? (
                <>
                  <Pause size={16} strokeWidth={2} aria-hidden="true" />
                  <span>Pause exam</span>
                </>
              ) : (
                <>
                  <Play size={16} strokeWidth={2} aria-hidden="true" />
                  <span>Resume exam</span>
                </>
              )}
            </button>

            <HoldProgressButton
              label="Hold to finish paper"
              holdingLabel="Finishing…"
              durationMs={1500}
              onHoldStart={() => {
                holdingRef.current = true;
                clearAutoFade();
              }}
              onHoldEnd={() => {
                holdingRef.current = false;
                scheduleAutoFade();
              }}
              onComplete={() => {
                onExit();
                onFinishExam();
              }}
            />
          </>
        )}
      </div>
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(overlayNode, document.body)
    : overlayNode;
};
