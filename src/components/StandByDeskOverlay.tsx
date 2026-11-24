import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BatteryCharging,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  Box,
  Eye,
  EyeOff,
  Lightbulb,
  Minimize2,
  Moon,
  Pause,
  Play,
  RotateCw,
  Sun,
  X,
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
  DESK_HUD_AUTO_HIDE_MS,
  DESK_MOUNT_GRACE_MS,
  computeDeskProgressFilament,
  formatBatteryPercent,
  isWithinMountGraceWindow,
  loadDesk3dPreference,
  saveDesk3dPreference,
  shouldAutoHideDeskHud,
  shouldMountDeskChrono3D,
} from '../utils/deskModeHelpers';
import {
  exitDeskFullscreen,
  lockLandscapeOrientation,
  unlockScreenOrientation,
  useBatteryStatus,
  useWakeLock,
} from '../hooks/useWakeLock';
import { prefersReducedMotion, triggerHaptic } from '../utils/haptics';
import { ErrorBoundary } from './ErrorBoundary';
import { HoldProgressButton } from './HoldProgressButton';

const DeskChronoScene = lazy(() =>
  import('./three/DeskChronoScene').then((m) => ({ default: m.DeskChronoScene }))
);

/**
 * 8-step subtle OLED burn-in protection micro-orbit (±6px shifts every 60s,
 * GPU-only translate3d strictly on the typography layer).
 */
const BURN_IN_ORBIT: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [6, 2],
  [4, 6],
  [-4, 5],
  [-6, 0],
  [-4, -5],
  [3, -6],
  [6, -2],
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
  const ui3dSetting = state.set.ui3d || 'auto';
  const ui3dQuality = state.set.ui3dQuality || 'auto';

  const [nightDim, setNightDim] = useState(false);
  const [hideSeconds, setHideSeconds] = useState(false);
  const [desk3dEnabled, setDesk3dEnabled] = useState<boolean>(() =>
    loadDesk3dPreference(ui3dSetting)
  );
  const [simLandscape, setSimLandscape] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [orbitIdx, setOrbitIdx] = useState(0);
  const [examTick, setExamTick] = useState(0);

  const holdingRef = useRef(false);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedAtRef = useRef<number>(0);
  const nativeLandscapeLockedRef = useRef<boolean>(false);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const parkingOpenRef = useRef(parkingSheetOpen);
  parkingOpenRef.current = parkingSheetOpen;

  // Keep Desk 3D state synced if user toggles global settings.ui3d
  useEffect(() => {
    setDesk3dEnabled(loadDesk3dPreference(ui3dSetting));
  }, [ui3dSetting]);

  // Screen Wake Lock while StandBy Desk Mode is active
  useWakeLock(open);

  // Low-glare Battery API status (zero permissions, zero network calls, full cleanup on unmount)
  const battery = useBatteryStatus(open);

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

  // Lifecycle strictly keyed to `open` ONLY (never re-runs on parent re-renders or fullscreenchange).
  // Native fullscreen is requested ONCE inside the click that opens Desk Mode — NEVER auto-re-requested here.
  useEffect(() => {
    if (!open) return;
    mountedAtRef.current = performance.now();
    setControlsVisible(true);
    setSimLandscape(false);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !parkingOpenRef.current) {
        e.stopPropagation();
        onExitRef.current();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
      setSimLandscape(false);
      nativeLandscapeLockedRef.current = false;
      unlockScreenOrientation();
      void exitDeskFullscreen();
    };
  }, [open]);

  // Subtle 60-second OLED pixel-shift micro-orbit (±6px, disabled for prefers-reduced-motion)
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

  // Derive active timer & exam states for HUD auto-hide and 3D reactivity
  const t = state.activeTimer;
  const focusMetrics = open && mode === 'focus' ? getTimerMetrics(state) : null;
  const examSnapshot = open && mode === 'exam' ? computeExamClockSnapshot(examState) : null;

  const isRunning =
    mode === 'focus' ? t?.status === 'running' : examState.status === 'running';
  const isPaused =
    mode === 'focus' ? t?.status === 'paused' : examState.status === 'paused';
  const isOvertime =
    mode === 'focus'
      ? Boolean(focusMetrics && focusMetrics.overtimeMs > 0)
      : Boolean(
          examSnapshot &&
            (examSnapshot.totalOvertimeMs > 0 ||
              examSnapshot.sections.some((s) => s.isOvertime))
        );

  const canAutoHide = shouldAutoHideDeskHud({
    open,
    isRunning,
    isPaused,
    isOvertime,
    holding: holdingRef.current,
    parkingSheetOpen,
  });

  const clearAutoFade = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  const scheduleAutoFade = useCallback(() => {
    clearAutoFade();
    if (!canAutoHide || holdingRef.current || parkingOpenRef.current) return;
    hideTimeoutRef.current = setTimeout(() => {
      if (!holdingRef.current && !parkingOpenRef.current) {
        setControlsVisible(false);
      }
    }, DESK_HUD_AUTO_HIDE_MS);
  }, [clearAutoFade, canAutoHide]);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    scheduleAutoFade();
  }, [scheduleAutoFade]);

  // Keep controls visible whenever Paused, Overtime, or Parking Lot opens; auto-hide after 4.5s while running
  useEffect(() => {
    if (!open) {
      clearAutoFade();
      return;
    }
    if (isPaused || isOvertime) {
      clearAutoFade();
      setControlsVisible(true);
      return;
    }
    if (parkingSheetOpen) {
      clearAutoFade();
      return;
    }
    if (controlsVisible && canAutoHide) {
      scheduleAutoFade();
    } else {
      clearAutoFade();
    }
    return clearAutoFade;
  }, [
    open,
    isPaused,
    isOvertime,
    parkingSheetOpen,
    controlsVisible,
    canAutoHide,
    clearAutoFade,
    scheduleAutoFade,
  ]);

  const handleToggleRotate = useCallback(async () => {
    triggerHaptic('tap');
    revealControls();

    if (simLandscape) {
      setSimLandscape(false);
      nativeLandscapeLockedRef.current = false;
      unlockScreenOrientation();
      return;
    }

    const isNativeLandscape =
      typeof window !== 'undefined' && window.innerWidth > window.innerHeight;
    if (nativeLandscapeLockedRef.current && isNativeLandscape) {
      nativeLandscapeLockedRef.current = false;
      unlockScreenOrientation();
      return;
    }

    const locked = await lockLandscapeOrientation();
    if (locked) {
      // Allow a brief layout tick to verify whether the OS actually rotated the viewport
      await new Promise((resolve) => setTimeout(resolve, 120));
      if (typeof window !== 'undefined' && window.innerWidth > window.innerHeight) {
        nativeLandscapeLockedRef.current = true;
        setSimLandscape(false);
        return;
      }
    }

    // Fallback: CSS hardware-rotated Simulated Landscape Stage works on demand even if OS Auto-Rotate is off
    setSimLandscape(true);
  }, [simLandscape, revealControls]);

  const handleToggle3d = useCallback(() => {
    triggerHaptic('tap');
    if (ui3dSetting === 'off') return;
    setDesk3dEnabled((prev) => {
      const next = !prev;
      saveDesk3dPreference(next);
      return next;
    });
    revealControls();
  }, [ui3dSetting, revealControls]);

  if (!open) return null;

  const [shiftX, shiftY] = BURN_IN_ORBIT[orbitIdx];
  const curSubject = t ? getSubject(state, t.subjectId) : state.subjects[0];
  const curChapter = t?.chapterId
    ? state.chapters.find((c) => c.id === t.chapterId)
    : undefined;

  const defaultIdleMs = (state.set.pomoWork || 25) * 60_000;
  const displayMs = focusMetrics ? focusMetrics.displayMs : defaultIdleMs;
  const isStopwatch = t?.mode === 'stopwatch';
  const isCountdown = mode === 'focus' ? !isStopwatch : true;

  const focusClockStr = hideSeconds
    ? formatExamClockMs(displayMs, { hideSeconds: true })
    : isStopwatch || displayMs >= 3_600_000
      ? fmtHMS(displayMs)
      : fmtMS(displayMs);

  const isHmsFormat = !hideSeconds && focusClockStr.length >= 7;

  const totalExamStr = examSnapshot
    ? examSnapshot.totalOvertimeMs > 0
      ? `+${formatExamClockMs(examSnapshot.totalOvertimeMs, { hideSeconds })} over`
      : formatExamClockMs(examSnapshot.totalRemainingMs, {
          hideSeconds,
          forceHours: true,
        })
    : '03:00:00';

  const activeExamSection = examSnapshot?.sections.find((s) => s.isActive);

  // Strict 0-WebGL guarantee when Night dim is ON, 3D is OFF, settings.ui3d === 'off', or prefers-reduced-motion
  const reducedMotion = prefersReducedMotion();
  const mount3D = shouldMountDeskChrono3D({
    open,
    nightDim,
    desk3dEnabled,
    ui3dSetting,
    reducedMotion,
  });

  const chronoClockMs =
    mode === 'focus'
      ? isStopwatch
        ? focusMetrics?.totalActiveMs ?? 0
        : displayMs
      : examSnapshot?.totalRemainingMs ?? 0;

  const filament = computeDeskProgressFilament({
    mode,
    isStopwatch,
    isRunning,
    isPaused,
    isOvertime,
    progressPct: focusMetrics?.progressPct ?? 0,
    remainingMs: focusMetrics ? Math.max(0, focusMetrics.displayMs) : 0,
    totalActiveMs: focusMetrics?.totalActiveMs ?? 0,
    overtimeMs: focusMetrics?.overtimeMs ?? 0,
    activeExamLabel: activeExamSection?.label,
    examTotalElapsedMs: examSnapshot?.totalElapsedMs ?? 0,
    examTotalBudgetMs: (examState.totalDurationMins || 180) * 60_000,
  });

  const batteryPct = battery !== null ? formatBatteryPercent(battery.level) : null;
  const renderBatteryIcon = () => {
    if (!battery) return null;
    if (battery.charging) {
      return <BatteryCharging size={14} strokeWidth={1.75} aria-hidden="true" />;
    }
    if (batteryPct !== null && batteryPct <= 20) {
      return <BatteryLow size={14} strokeWidth={1.75} aria-hidden="true" />;
    }
    if (batteryPct !== null && batteryPct <= 65) {
      return <BatteryMedium size={14} strokeWidth={1.75} aria-hidden="true" />;
    }
    return <BatteryFull size={14} strokeWidth={1.75} aria-hidden="true" />;
  };

  const handleStageClick = () => {
    // 400ms mount grace window so opening tap from FocusView never leaks through to hide controls
    if (isWithinMountGraceWindow(performance.now(), mountedAtRef.current, DESK_MOUNT_GRACE_MS)) {
      return;
    }
    if (controlsVisible) {
      clearAutoFade();
      setControlsVisible(false);
    } else {
      revealControls();
    }
  };

  const overlayNode = (
    <div
      className={`dh-standby-overlay ${nightDim ? 'is-night-dim' : ''} ${
        controlsVisible ? 'controls-visible' : ''
      } ${mode === 'exam' ? 'is-exam-mode' : 'is-focus-mode'}`.trim()}
      data-testid="standby-desk-overlay"
      data-sim-landscape={simLandscape ? 'true' : 'false'}
      data-night-dim={nightDim ? 'true' : 'false'}
      data-3d-mounted={mount3D ? 'true' : 'false'}
      role="dialog"
      aria-modal="true"
      aria-label={
        mode === 'exam'
          ? 'AMOLED StandBy Exam Hall Desk Mode'
          : 'AMOLED StandBy Desk Mode'
      }
      onClick={handleStageClick}
    >
      {/* Viewport container: full-screen or hardware-rotated Simulated Landscape Stage centered on #000000 */}
      <div
        className={`dh-standby-viewport ${simLandscape ? 'is-sim-landscape' : ''}`.trim()}
        data-testid="standby-viewport"
      >
        {/* Pitch-Black #000000 3D Orbital Chronometer Backdrop (unmounted completely in Night dim / 3D off / reduced motion) */}
        {mount3D && (
          <div className="dh-standby-3d-layer" aria-hidden="true">
            <ErrorBoundary
              variant="section"
              scopeLabel="Desk 3D chronometer"
              resetKey={`${ui3dSetting}-${ui3dQuality}-${simLandscape}`}
              silentFallback={null}
            >
              <Suspense fallback={null}>
                <DeskChronoScene
                  ui3dSetting={ui3dSetting}
                  ui3dQuality={ui3dQuality}
                  isRunning={isRunning}
                  isPaused={isPaused}
                  isOvertime={isOvertime}
                  isCountdown={isCountdown}
                  clockMs={chronoClockMs}
                  simLandscape={simLandscape}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}

        {/* Always-Reachable Low-Glare Persistent Corner Exit (×) when Main HUD Fades Out */}
        {!controlsVisible && (
          <button
            type="button"
            className="dh-standby-corner-exit"
            data-testid="standby-corner-exit"
            aria-label="Exit desk mode"
            onClick={(e) => {
              e.stopPropagation();
              triggerHaptic('tap');
              onExit();
            }}
          >
            <X size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}

        {/* Top Auto-Fading Monochrome HUD Dock */}
        <div
          className={`dh-standby-bar dh-standby-bar-top ${
            controlsVisible ? 'is-visible' : ''
          }`}
          data-testid="standby-top-hud"
          aria-hidden={!controlsVisible}
          onClick={(e) => {
            e.stopPropagation();
            revealControls();
          }}
        >
          <div className="dh-standby-bar-group">
            {battery !== null && batteryPct !== null && (
              <span
                className="dh-standby-battery tabular-nums"
                data-testid="standby-battery"
                aria-label={`Battery ${batteryPct} percent${battery.charging ? ', charging' : ''}`}
              >
                {renderBatteryIcon()}
                <span>{batteryPct}%</span>
              </span>
            )}

            <button
              type="button"
              className={`dh-standby-pill ${simLandscape ? 'is-active' : ''}`}
              data-testid="standby-rotate-btn"
              tabIndex={controlsVisible ? 0 : -1}
              aria-pressed={simLandscape}
              onClick={() => {
                void handleToggleRotate();
              }}
            >
              <RotateCw size={14} strokeWidth={1.75} aria-hidden="true" />
              <span>Rotate</span>
            </button>

            <button
              type="button"
              className={`dh-standby-pill ${desk3dEnabled && ui3dSetting !== 'off' && !nightDim ? 'is-active' : ''}`}
              data-testid="standby-3d-btn"
              tabIndex={controlsVisible ? 0 : -1}
              disabled={ui3dSetting === 'off'}
              aria-pressed={desk3dEnabled && ui3dSetting !== 'off'}
              title={ui3dSetting === 'off' ? '3D scenes disabled in Settings' : 'Toggle 3D chronometer'}
              onClick={handleToggle3d}
            >
              <Box size={14} strokeWidth={1.75} aria-hidden="true" />
              <span>3D</span>
            </button>

            <button
              type="button"
              className={`dh-standby-pill ${nightDim ? 'is-active' : ''}`}
              data-testid="standby-night-dim-btn"
              tabIndex={controlsVisible ? 0 : -1}
              aria-pressed={nightDim}
              onClick={() => {
                triggerHaptic('tap');
                setNightDim((v) => !v);
                revealControls();
              }}
            >
              {nightDim ? (
                <Sun size={14} strokeWidth={1.75} aria-hidden="true" />
              ) : (
                <Moon size={14} strokeWidth={1.75} aria-hidden="true" />
              )}
              <span>Night dim</span>
            </button>

            <button
              type="button"
              className={`dh-standby-pill ${hideSeconds ? 'is-active' : ''}`}
              data-testid="standby-hide-sec-btn"
              tabIndex={controlsVisible ? 0 : -1}
              aria-pressed={hideSeconds}
              onClick={() => {
                triggerHaptic('tap');
                setHideSeconds((v) => !v);
                revealControls();
              }}
            >
              {hideSeconds ? (
                <Eye size={14} strokeWidth={1.75} aria-hidden="true" />
              ) : (
                <EyeOff size={14} strokeWidth={1.75} aria-hidden="true" />
              )}
              <span>{hideSeconds ? 'Show sec' : 'Hide sec'}</span>
            </button>

            <button
              type="button"
              className="dh-standby-pill"
              data-testid="standby-park-btn"
              tabIndex={controlsVisible ? 0 : -1}
              onClick={() => {
                triggerHaptic('tap');
                onOpenParkingLot();
              }}
            >
              <Lightbulb size={14} strokeWidth={1.75} aria-hidden="true" />
              <span>Park thought</span>
              {parkedCount > 0 && (
                <span className="dh-park-badge tabular-nums">{parkedCount}</span>
              )}
            </button>
          </div>

          <button
            type="button"
            className="dh-standby-pill dh-standby-exit-pill"
            data-testid="standby-exit-btn"
            tabIndex={controlsVisible ? 0 : -1}
            aria-label="Exit desk mode"
            onClick={() => {
              triggerHaptic('tap');
              onExit();
            }}
          >
            <Minimize2 size={14} strokeWidth={1.75} aria-hidden="true" />
            <span>Exit</span>
          </button>
        </div>

        {/* Main OLED Burn-In Protected Hardware Typography Stage (±6px every 60s) */}
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
                      ? '#DC2626'
                      : curSubject?.color || '#F5C542',
                  }}
                  aria-hidden="true"
                />
                <span className="dh-standby-subject-label">
                  {curSubject?.name || 'Deep Study'}
                  {curChapter
                    ? ` · ${curChapter.name}`
                    : t?.heading
                      ? ` · ${t.heading}`
                      : ''}
                </span>
                {t?.status === 'paused' && (
                  <span className="dh-standby-state-chip is-paused">Paused</span>
                )}
                {focusMetrics && focusMetrics.overtimeMs > 0 && (
                  <span className="dh-standby-state-chip is-overtime tabular-nums">
                    +{formatExamClockMs(focusMetrics.overtimeMs, { hideSeconds })} over
                  </span>
                )}
              </div>

              <div
                className={`dh-standby-clock tabular-nums ${
                  hideSeconds ? 'is-hide-sec' : ''
                } ${isHmsFormat ? 'is-hms' : ''}`.trim()}
                data-testid="standby-focus-clock"
              >
                {focusClockStr}
              </div>
            </div>
          ) : (
            examSnapshot && (
              <div className="dh-standby-exam-core">
                <div className="dh-standby-exam-header">
                  <span className="dh-standby-exam-label">
                    NEET Exam Hall
                  </span>
                  {examState.status === 'paused' && (
                    <span className="dh-standby-state-chip is-paused">Paused</span>
                  )}
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
                            '--pad-color': nightDim ? '#DC2626' : sec.color,
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

        {/* Bottom Dock Wrapper: Transport Controls + Razor-Thin 2px Lumen Progress Filament */}
        <div className="dh-standby-footer-zone">
          <div
            className={`dh-standby-bar dh-standby-bar-bottom ${
              controlsVisible ? 'is-visible' : ''
            }`}
            data-testid="standby-bottom-hud"
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
                        <Pause size={16} strokeWidth={1.75} aria-hidden="true" />
                        <span>Pause</span>
                      </>
                    ) : (
                      <>
                        <Play size={16} strokeWidth={1.75} aria-hidden="true" />
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
                <span className="dh-standby-hint">Tap stage to toggle controls</span>
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
                      <Pause size={16} strokeWidth={1.75} aria-hidden="true" />
                      <span>Pause exam</span>
                    </>
                  ) : (
                    <>
                      <Play size={16} strokeWidth={1.75} aria-hidden="true" />
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

          {/* Bottom Edge: Razor-Thin 2px Lumen Gold Progress Filament + Right-Aligned ETA / Milestone Meta */}
          <div className="dh-standby-filament-wrap" data-testid="standby-progress-filament">
            <div className="dh-standby-filament-meta tabular-nums">
              {filament.metaLabel}
            </div>
            <div className="dh-standby-filament-track" aria-hidden="true">
              <div
                className={`dh-standby-filament-fill tone-${filament.tone}`}
                style={{ width: `${filament.pct}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(overlayNode, document.body)
    : overlayNode;
};
