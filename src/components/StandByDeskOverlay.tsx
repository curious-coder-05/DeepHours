import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BatteryCharging,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  Layers,
  Moon,
  Pause,
  Play,
  RotateCw,
  X,
} from 'lucide-react';
import type { PulseHabitState } from '../types';
import { getSubject, getTimerMetrics } from '../utils/studyLogic';
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
  formatBatteryPercent,
  formatDeskPrecisionClockParts,
  formatDeskSubjectLabel,
  getDeskSculptureLabel,
  getOppositeDeskSculpture,
  isWithinMountGraceWindow,
  pickRandomDeskSculpture,
  shouldAutoHideDeskHud,
  shouldMountDeskChrono3D,
  type DeskSculptureKind,
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

const DESK_NIGHT_DIM_STORAGE_KEY = 'dh_desk_night_dim_v1';

function readStoredNightDim(): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    return window.localStorage.getItem(DESK_NIGHT_DIM_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeStoredNightDim(enabled: boolean): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(DESK_NIGHT_DIM_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // ignore storage quota/privacy errors
  }
}

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

/**
 * Isolated 1Hz Focus Timer Readout.
 * Keeps `useTimerTick` strictly scoped here so 1-second timer ticks NEVER re-render
 * `StandByDeskOverlay` or `DeskChronoScene`.
 */
const StandByFocusClock: React.FC<{ state: PulseHabitState }> = ({ state }) => {
  const t = state.activeTimer;
  const isRunning = t?.status === 'running';
  useTimerTick(isRunning);

  const metrics = getTimerMetrics(state);
  const curSubject = t ? getSubject(state, t.subjectId) : state.subjects[0];
  const defaultIdleMs = (state.set.pomoWork || 25) * 60_000;
  const displayMs = metrics ? metrics.displayMs : defaultIdleMs;
  const parts = formatDeskPrecisionClockParts(displayMs, {
    overtimeMs: metrics?.overtimeMs ?? 0,
  });
  const subjectMicroLabel = formatDeskSubjectLabel(curSubject?.name);

  return (
    <div className="dh-standby-focus-core">
      <div
        className="dh-standby-subject-label"
        data-testid="standby-subject-label"
      >
        {subjectMicroLabel}
      </div>
      <div
        className="dh-standby-clock tabular-nums"
        data-testid="standby-focus-clock"
        aria-label={`${parts.prefix}${parts.hours} ${parts.minutes} ${parts.seconds}`}
      >
        <span className="dh-standby-clock-group">
          {parts.prefix}
          {parts.hours}
        </span>
        <span className="dh-standby-clock-group">{parts.minutes}</span>
        <span className="dh-standby-clock-group">{parts.seconds}</span>
      </div>
    </div>
  );
};

/**
 * Isolated 1Hz Exam Hall Stage (only mounts when `mode === 'exam'`).
 */
const StandByExamStage: React.FC<{
  examState: ExamClockState;
  onSwitchExamSection: (sectionId: ExamSectionId) => void;
}> = ({ examState, onSwitchExamSection }) => {
  const [examTick, setExamTick] = useState(0);
  const isExamRunning = examState.status === 'running';

  useEffect(() => {
    if (!isExamRunning) return;
    const id = setInterval(() => {
      setExamTick((n) => n + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [isExamRunning]);
  void examTick;

  const examSnapshot = computeExamClockSnapshot(examState);
  const totalExamStr =
    examSnapshot.totalOvertimeMs > 0
      ? `+${formatExamClockMs(examSnapshot.totalOvertimeMs)} over`
      : formatExamClockMs(examSnapshot.totalRemainingMs, { forceHours: true });

  return (
    <div className="dh-standby-exam-core">
      <div className="dh-standby-exam-header">
        <span className="dh-standby-subject-label">EXAM HALL</span>
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
          const clockText = formatExamSectionDisplay(sec.remainingMs, sec.overtimeMs);
          return (
            <button
              key={sec.id}
              type="button"
              className={`dh-standby-pad ${sec.isActive ? 'is-active' : ''} ${
                sec.isOvertime ? 'is-overtime' : ''
              }`.trim()}
              aria-pressed={sec.isActive}
              onClick={(e) => {
                e.stopPropagation();
                triggerHaptic('tap');
                onSwitchExamSection(sec.id);
              }}
            >
              <span className="dh-standby-pad-top">
                <span className="dh-standby-pad-name">{sec.label}</span>
                <span className="dh-standby-pad-visits tabular-nums">{sec.visits}×</span>
              </span>
              <span className="dh-standby-pad-clock tabular-nums">{clockText}</span>
              <span className="dh-standby-pad-foot tabular-nums">
                {sec.isActive
                  ? examState.status === 'paused'
                    ? 'Paused'
                    : 'Active'
                  : `${Math.round(sec.budgetMs / 60_000)}m`}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

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
  // Retained in prop signature for FocusView compatibility
  void parkedCount;
  void onOpenParkingLot;
  void onStopFocus;

  const ui3dSetting = state.set.ui3d || 'auto';
  const ui3dQuality = state.set.ui3dQuality || 'auto';

  const [sculpture, setSculpture] = useState<DeskSculptureKind>(() =>
    pickRandomDeskSculpture()
  );
  const [simLandscape, setSimLandscape] = useState(false);
  const [nightDim, setNightDim] = useState<boolean>(() => readStoredNightDim());
  // 100% clean by default on entry; tapping anywhere reveals the minimal frameless HUD for 3s
  const [controlsVisible, setControlsVisible] = useState(false);

  const holdingRef = useRef(false);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedAtRef = useRef<number>(0);
  const nativeLandscapeLockedRef = useRef<boolean>(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const parkingOpenRef = useRef(parkingSheetOpen);
  parkingOpenRef.current = parkingSheetOpen;

  // Screen Wake Lock while StandBy Desk Mode is active
  useWakeLock(open);

  // Subtle low-glare Battery API status (zero permissions, zero network calls)
  const battery = useBatteryStatus(open);

  // Lifecycle strictly keyed to `open` ONLY (never re-runs on parent re-renders or fullscreenchange).
  // Native fullscreen is requested ONCE inside the click that opens Desk Mode — NEVER auto-re-requested here.
  useEffect(() => {
    if (!open) return;
    mountedAtRef.current = performance.now();
    // Randomly select either 'monolith' or 'kinetic-wave' on every Desk Mode entry
    setSculpture(pickRandomDeskSculpture());
    // Default idle screen is 100% pure & uncluttered
    setControlsVisible(false);
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

  const clearAutoFade = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  const scheduleAutoFade = useCallback(() => {
    clearAutoFade();
    if (holdingRef.current || parkingOpenRef.current) return;
    hideTimeoutRef.current = setTimeout(() => {
      if (!holdingRef.current && !parkingOpenRef.current) {
        setControlsVisible(false);
      }
    }, DESK_HUD_AUTO_HIDE_MS);
  }, [clearAutoFade]);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    scheduleAutoFade();
  }, [scheduleAutoFade]);

  const canAutoHide = shouldAutoHideDeskHud({
    open,
    controlsVisible,
    holding: holdingRef.current,
    parkingSheetOpen,
  });

  useEffect(() => {
    if (!canAutoHide) {
      clearAutoFade();
      return;
    }
    scheduleAutoFade();
    return clearAutoFade;
  }, [canAutoHide, clearAutoFade, scheduleAutoFade]);

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
      await new Promise((resolve) => setTimeout(resolve, 120));
      if (typeof window !== 'undefined' && window.innerWidth > window.innerHeight) {
        nativeLandscapeLockedRef.current = true;
        setSimLandscape(false);
        return;
      }
    }

    // Fallback: CSS hardware-rotated Simulated Landscape Stage when OS Auto-Rotate is off
    setSimLandscape(true);
  }, [simLandscape, revealControls]);

  const handleSwitchSculpture = useCallback(() => {
    triggerHaptic('tap');
    setSculpture((prev) => getOppositeDeskSculpture(prev));
    revealControls();
  }, [revealControls]);

  const handleToggleNightDim = useCallback(() => {
    triggerHaptic('tap');
    setNightDim((prev) => {
      const next = !prev;
      writeStoredNightDim(next);
      return next;
    });
    revealControls();
  }, [revealControls]);

  if (!open) return null;

  const t = state.activeTimer;
  const isRunning =
    mode === 'focus' ? t?.status === 'running' : examState.status === 'running';
  const isPaused =
    mode === 'focus' ? t?.status === 'paused' : examState.status === 'paused';

  const reducedMotion = prefersReducedMotion();
  const mount3D = shouldMountDeskChrono3D({
    open,
    ui3dSetting,
    reducedMotion,
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
    // 400ms mount grace window so opening tap from FocusView never leaks through
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

  const nextSculptureLabel = getDeskSculptureLabel(getOppositeDeskSculpture(sculpture));

  const overlayNode = (
    <div
      className={`dh-standby-overlay ${controlsVisible ? 'controls-visible' : ''} ${
        nightDim ? 'is-night-dim' : ''
      } ${mode === 'exam' ? 'is-exam-mode' : 'is-focus-mode'}`.trim()}
      data-testid="standby-desk-overlay"
      data-sim-landscape={simLandscape ? 'true' : 'false'}
      data-3d-mounted={mount3D ? 'true' : 'false'}
      data-sculpture={sculpture}
      data-night-dim={nightDim ? 'true' : 'false'}
      data-hud-visible={controlsVisible ? 'true' : 'false'}
      role="dialog"
      aria-modal="true"
      aria-label={
        mode === 'exam'
          ? 'AMOLED StandBy Exam Hall Desk Mode'
          : 'AMOLED StandBy Desk Mode'
      }
      onClick={handleStageClick}
    >
      {/* Viewport container: pure #000000 or hardware-rotated Simulated Landscape Stage */}
      <div
        ref={viewportRef}
        className={`dh-standby-viewport ${simLandscape ? 'is-sim-landscape' : ''}`.trim()}
        data-testid="standby-viewport"
      >
        {/* Centered Procedural 3D Sculpture (only one geometry resident in GPU memory) */}
        {mount3D && (
          <div className="dh-standby-3d-layer" aria-hidden="true">
            <ErrorBoundary
              variant="section"
              scopeLabel="Desk 3D sculpture"
              resetKey={`${ui3dSetting}-${ui3dQuality}`}
              silentFallback={null}
            >
              <Suspense fallback={null}>
                <DeskChronoScene
                  sculpture={sculpture}
                  ui3dSetting={ui3dSetting}
                  ui3dQuality={ui3dQuality}
                  isRunning={isRunning}
                  isPaused={isPaused}
                  nightDim={nightDim}
                  battery={battery}
                  simLandscape={simLandscape}
                  stageRef={viewportRef}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}

        {/* Burn-In Protected Typography Layer: 60s smooth ±3px GPU translate3d micro-orbit */}
        <div
          className={`dh-standby-stage ${reducedMotion ? 'is-reduced-motion' : ''}`.trim()}
          data-testid="standby-typography-stage"
        >
          {mode === 'focus' ? (
            <StandByFocusClock state={state} />
          ) : (
            <StandByExamStage
              examState={examState}
              onSwitchExamSection={onSwitchExamSection}
            />
          )}
        </div>

        {/* Minimal Frameless Auto-Hiding Floating Control Bar (Tap Anywhere -> 3s Auto-Fade) */}
        <div
          className={`dh-standby-hud ${controlsVisible ? 'is-visible' : ''}`}
          data-testid="standby-floating-hud"
          aria-hidden={!controlsVisible}
          onClick={(e) => {
            e.stopPropagation();
            revealControls();
          }}
        >
          {mode === 'focus' && t && (
            <>
              <button
                type="button"
                className="dh-standby-action"
                data-testid="standby-pause-btn"
                tabIndex={controlsVisible ? 0 : -1}
                onClick={() => {
                  triggerHaptic('tap');
                  onToggleFocusPause();
                  revealControls();
                }}
              >
                {t.status === 'running' ? (
                  <>
                    <Pause size={15} strokeWidth={1.75} aria-hidden="true" />
                    <span>Pause</span>
                  </>
                ) : (
                  <>
                    <Play size={15} strokeWidth={1.75} aria-hidden="true" />
                    <span>Resume</span>
                  </>
                )}
              </button>
              <span className="dh-standby-sep" aria-hidden="true" />
            </>
          )}

          {mode === 'exam' && (
            <>
              <button
                type="button"
                className="dh-standby-action"
                data-testid="standby-pause-btn"
                tabIndex={controlsVisible ? 0 : -1}
                onClick={() => {
                  triggerHaptic('tap');
                  onToggleExamPause();
                  revealControls();
                }}
              >
                {examState.status === 'running' ? (
                  <>
                    <Pause size={15} strokeWidth={1.75} aria-hidden="true" />
                    <span>Pause</span>
                  </>
                ) : (
                  <>
                    <Play size={15} strokeWidth={1.75} aria-hidden="true" />
                    <span>Resume</span>
                  </>
                )}
              </button>
              <span className="dh-standby-sep" aria-hidden="true" />
              <HoldProgressButton
                label="Hold to finish"
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
              <span className="dh-standby-sep" aria-hidden="true" />
            </>
          )}

          {mount3D && (
            <>
              <button
                type="button"
                className="dh-standby-action"
                data-testid="standby-switch-sculpture-btn"
                tabIndex={controlsVisible ? 0 : -1}
                aria-label={`Switch sculpture to ${nextSculptureLabel}`}
                onClick={handleSwitchSculpture}
              >
                <Layers size={15} strokeWidth={1.75} aria-hidden="true" />
                <span>Sculpture</span>
              </button>
              <span className="dh-standby-sep" aria-hidden="true" />
            </>
          )}

          <button
            type="button"
            className={`dh-standby-action ${nightDim ? 'is-active' : ''}`}
            data-testid="standby-dim-btn"
            tabIndex={controlsVisible ? 0 : -1}
            aria-pressed={nightDim}
            aria-label={nightDim ? 'Disable night dim' : 'Enable night dim'}
            onClick={handleToggleNightDim}
          >
            <Moon size={15} strokeWidth={1.75} aria-hidden="true" />
            <span>Dim</span>
          </button>

          <span className="dh-standby-sep" aria-hidden="true" />

          <button
            type="button"
            className={`dh-standby-action ${simLandscape ? 'is-active' : ''}`}
            data-testid="standby-rotate-btn"
            tabIndex={controlsVisible ? 0 : -1}
            aria-pressed={simLandscape}
            aria-label="Toggle landscape rotation"
            onClick={() => {
              void handleToggleRotate();
            }}
          >
            <RotateCw size={15} strokeWidth={1.75} aria-hidden="true" />
            <span>Rotate</span>
          </button>

          {battery !== null && batteryPct !== null && (
            <>
              <span className="dh-standby-sep" aria-hidden="true" />
              <span
                className="dh-standby-battery tabular-nums"
                data-testid="standby-battery"
                aria-label={`Battery ${batteryPct} percent${battery.charging ? ', charging' : ''}`}
              >
                {renderBatteryIcon()}
                <span>{batteryPct}%</span>
              </span>
            </>
          )}

          <span className="dh-standby-sep" aria-hidden="true" />

          <button
            type="button"
            className="dh-standby-action dh-standby-action-exit"
            data-testid="standby-exit-btn"
            tabIndex={controlsVisible ? 0 : -1}
            aria-label="Exit desk mode"
            onClick={() => {
              triggerHaptic('tap');
              onExit();
            }}
          >
            <X size={15} strokeWidth={1.75} aria-hidden="true" />
            <span>Exit</span>
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(overlayNode, document.body)
    : overlayNode;
};
