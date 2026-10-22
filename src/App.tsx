/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ActiveTimerMode,
  AppSettings,
  AppTab,
  DDay,
  Habit,
  HabitCategory,
  PulseHabitState,
  SoundscapeMode,
  StudySession,
} from './types';
import {
  STARTERS,
  createDefaultState,
  done,
  due,
  dueOn,
  ent,
  fmtHMS,
  fmtHMShort,
  fmtMS,
  getHeadingColor,
  getSessionHeading,
  getTimerMetrics,
  logicalKey,
  mkHabit,
  norm,
  pad,
  syncStudyHabitsInPlace,
  uid,
} from './utils/studyLogic';
import { loadInitialState, persistState, subscribeBroadcast } from './utils/storage';
import {
  beep,
  ensureAudioEngine,
  setSoundscapeVolume,
  updateSoundscape,
} from './utils/audioEngine';
import { useFloatingTimerPiP } from './hooks/useFloatingTimerPiP';
import { TodayView } from './components/TodayView';
import { FocusView } from './components/FocusView';
import { PlannerView } from './components/PlannerView';
import { StatsView } from './components/StatsView';
import { MoreView } from './components/MoreView';
import { Modals, type ModalState } from './components/Modals';

function boomConfetti() {
  if (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion:reduce)').matches
  ) {
    return;
  }
  for (let i = 0; i < 28; i++) {
    const e = document.createElement('i');
    e.className = 'cf';
    e.style.cssText = `left:50%;top:38%;background:hsl(${
      Math.random() * 360
    } 90% 65%);--x:${(Math.random() - 0.5) * 380}px;--y:${
      -120 - Math.random() * 240
    }px;--r:${Math.random() * 720}deg`;
    document.body.append(e);
    setTimeout(() => e.remove(), 1200);
  }
}

async function sendNotification(title: string, body: string) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(title, { body, icon: '/icon.svg', tag: 'ph' });
    } else {
      new Notification(title, { body });
    }
  } catch {
    // ignore notification errors
  }
}

function downloadFile(name: string, content: string, mimeType: string) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const [state, setState] = useState<PulseHabitState>(() => createDefaultState());
  const [tab, setTab] = useState<AppTab>('today');
  const [sel, setSel] = useState<string>(() => logicalKey(new Date(), 4));
  const [cat, setCat] = useState<'All' | HabitCategory>('All');
  const [deskMode, setDeskMode] = useState(false);
  const [modal, setModal] = useState<ModalState>({ type: 'none' });
  const [toastState, setToastState] = useState<{
    msg: string;
    undoFn?: () => void;
  } | null>(null);
  const [, setTickCounter] = useState(0);

  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRemindersRef = useRef<Set<string>>(new Set());
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const todayKey = logicalKey(new Date(), state.set.dayResetHour ?? 4);

  const showToast = useCallback((msg: string, undoFn?: () => void) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastState({ msg, undoFn });
    toastTimeoutRef.current = setTimeout(() => {
      setToastState(null);
    }, 4500);
  }, []);

  const updateAndSave = useCallback(
    (updater: (prev: PulseHabitState) => PulseHabitState) => {
      setState((prev) => {
        const next = updater(prev);
        const curToday = logicalKey(new Date(), next.set.dayResetHour ?? 4);
        syncStudyHabitsInPlace(next, curToday, curToday);
        persistState(next);
        return { ...next };
      });
    },
    []
  );

  // Load initial state from IndexedDB / localStorage and register service worker
  useEffect(() => {
    let mounted = true;
    loadInitialState().then((loaded) => {
      if (!mounted) return;
      const curToday = logicalKey(new Date(), loaded.set.dayResetHour ?? 4);
      syncStudyHabitsInPlace(loaded, curToday, curToday);
      setState(loaded);
      setSel(curToday);
    });

    const unsub = subscribeBroadcast((latest) => {
      if (!mounted) return;
      setState(latest);
    });

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  // Theme application
  useEffect(() => {
    const applyTheme = () => {
      const t =
        state.set.theme === 'auto'
          ? window.matchMedia('(prefers-color-scheme:light)').matches
            ? 'light'
            : 'dark'
          : state.set.theme;
      document.documentElement.dataset.t = t;
      document.documentElement.style.setProperty('--ac', state.set.ac);
      const metaTheme = document.querySelector('meta[name=theme-color]');
      if (metaTheme) {
        metaTheme.setAttribute('content', t === 'light' ? '#f4f6fb' : '#090d16');
      }
    };
    applyTheme();
    const mq = window.matchMedia('(prefers-color-scheme:light)');
    mq.addEventListener('change', applyTheme);
    return () => mq.removeEventListener('change', applyTheme);
  }, [state.set.theme, state.set.ac]);

  // Desk mode class on body
  useEffect(() => {
    document.body.classList.toggle('desk-mode', deskMode);
  }, [deskMode]);

  // Screen Wake Lock sync
  const syncWakeLock = useCallback(async () => {
    const shouldLock = state.activeTimer?.status === 'running' || deskMode;
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    try {
      if (
        shouldLock &&
        !wakeLockRef.current &&
        document.visibilityState === 'visible'
      ) {
        const sentinel = await navigator.wakeLock.request('screen');
        sentinel.addEventListener('release', () => {
          wakeLockRef.current = null;
        });
        wakeLockRef.current = sentinel;
      } else if (!shouldLock && wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
    } catch {
      // ignore wakeLock permission restrictions in iframe
    }
  }, [deskMode, state.activeTimer?.status]);

  useEffect(() => {
    syncWakeLock();
    const onVisChange = () => {
      if (!document.hidden) syncWakeLock();
    };
    document.addEventListener('visibilitychange', onVisChange);
    return () => document.removeEventListener('visibilitychange', onVisChange);
  }, [syncWakeLock]);

  // Soundscape sync
  useEffect(() => {
    updateSoundscape(
      state.set.soundscape,
      state.activeTimer?.status === 'running',
      state.set.soundVol ?? 0.35
    );
  }, [state.set.soundscape, state.activeTimer?.status, state.set.soundVol]);

  // Timer actions
  const startTimer = useCallback(
    (
      heading?: string,
      mode?: ActiveTimerMode,
      customTargetMins?: number
    ) => {
      ensureAudioEngine();
      updateAndSave((prev) => {
        const cleanHeading = (heading && heading.trim()) || 'Deep Study Session';
        const m: ActiveTimerMode = mode || prev.set.defaultMode || 'pomo';
        const targetMins =
          m === 'pomo'
            ? prev.set.pomoWork || 25
            : m === 'countdown'
              ? customTargetMins || prev.set.countdownMins || 45
              : 0;
        const now = Date.now();
        beep('ok', !!prev.set.snd);
        return {
          ...prev,
          set: {
            ...prev.set,
            defaultMode: m,
          },
          activeTimer: {
            status: 'running',
            mode: m,
            phase: 'work',
            subjectId: 'sub_code',
            heading: cleanHeading,
            startTs: now,
            sliceStartTs: now,
            pauseStartTs: null,
            pausedDurationMs: 0,
            slicePausedMs: 0,
            pauseCount: 0,
            slicePauseCount: 0,
            targetMs: targetMins * 60000,
            chimeFired: false,
          },
        };
      });
    },
    [updateAndSave]
  );

  const pauseTimer = useCallback(() => {
    updateAndSave((prev) => {
      const t = prev.activeTimer;
      if (!t || t.status === 'paused') return prev;
      beep('no', !!prev.set.snd);
      return {
        ...prev,
        activeTimer: {
          ...t,
          status: 'paused',
          pauseStartTs: Date.now(),
          pauseCount: (t.pauseCount || 0) + 1,
          slicePauseCount: (t.slicePauseCount || 0) + 1,
        },
      };
    });
  }, [updateAndSave]);

  const resumeTimer = useCallback(() => {
    ensureAudioEngine();
    updateAndSave((prev) => {
      const t = prev.activeTimer;
      if (!t || t.status !== 'paused') return prev;
      const now = Date.now();
      const deltaPause = t.pauseStartTs ? Math.max(0, now - t.pauseStartTs) : 0;
      beep('ok', !!prev.set.snd);
      return {
        ...prev,
        activeTimer: {
          ...t,
          status: 'running',
          pauseStartTs: null,
          pausedDurationMs: (t.pausedDurationMs || 0) + deltaPause,
          slicePausedMs: (t.slicePausedMs || 0) + deltaPause,
        },
      };
    });
  }, [updateAndSave]);

  const toggleTimerPause = useCallback(() => {
    if (!state.activeTimer) return;
    if (state.activeTimer.status === 'running') pauseTimer();
    else resumeTimer();
  }, [pauseTimer, resumeTimer, state.activeTimer]);

  const extendTimerTarget = useCallback(
    (extraMins: number) => {
      updateAndSave((prev) => {
        const t = prev.activeTimer;
        if (!t || t.mode === 'stopwatch') return prev;
        const nextTargetMs = Math.max(60000, (t.targetMs || 0) + extraMins * 60000);
        return {
          ...prev,
          activeTimer: {
            ...t,
            targetMs: nextTargetMs,
            chimeFired: false,
          },
        };
      });
      showToast(`Added +${extraMins}m to session target`);
    },
    [showToast, updateAndSave]
  );

  const commitSliceInState = (
    prev: PulseHabitState,
    now: number,
    reflection: { heading?: string; rating: number; note: string }
  ): { next: PulseHabitState; savedEntry: StudySession | null } => {
    const t = prev.activeTimer;
    if (!t || t.phase === 'break') return { next: prev, savedEntry: null };

    const curPause =
      t.status === 'paused' && t.pauseStartTs ? Math.max(0, now - t.pauseStartTs) : 0;
    const slicePausedMs = (t.slicePausedMs || 0) + curPause;
    const sliceActiveMs = Math.max(0, now - t.sliceStartTs - slicePausedMs);

    if (sliceActiveMs < 1000) return { next: prev, savedEntry: null };

    const totalPaused = (t.pausedDurationMs || 0) + curPause;
    const totalActive = Math.max(0, now - t.startTs - totalPaused);
    const overtimeMs =
      t.mode !== 'stopwatch' && t.targetMs && totalActive > t.targetMs
        ? Math.min(sliceActiveMs, totalActive - t.targetMs)
        : 0;
    const denom = sliceActiveMs + slicePausedMs;
    const purity = denom > 0 ? Math.round((sliceActiveMs / denom) * 100) : 100;
    const finalHeading =
      (reflection.heading && reflection.heading.trim()) ||
      (t.heading && t.heading.trim()) ||
      'Deep Study Session';

    const entry: StudySession = {
      id: uid('ses'),
      subjectId: t.subjectId || 'sub_code',
      heading: finalHeading,
      dayKey: logicalKey(t.sliceStartTs, prev.set.dayResetHour ?? 4),
      startTs: t.sliceStartTs,
      endTs: now,
      activeMs: sliceActiveMs,
      pausedMs: slicePausedMs,
      pauseCount: t.slicePauseCount || 0,
      overtimeMs,
      purity,
      mode: t.mode,
      rating: reflection.rating || 5,
      note: reflection.note || '',
      updatedAt: now,
    };

    const next: PulseHabitState = {
      ...prev,
      sessions: [...prev.sessions, entry],
      bonus: (prev.bonus || 0) + Math.max(5, Math.round(sliceActiveMs / 60000)),
    };
    const curToday = logicalKey(now, next.set.dayResetHour ?? 4);
    syncStudyHabitsInPlace(next, entry.dayKey, curToday, now);
    return { next, savedEntry: entry };
  };

  const switchHeadingMidSession = useCallback(
    (newHeading: string) => {
      const clean = newHeading.trim() || 'Deep Study Session';
      updateAndSave((prev) => {
        const t = prev.activeTimer;
        if (!t || t.heading === clean) return prev;
        const now = Date.now();
        const { next, savedEntry } = commitSliceInState(prev, now, {
          heading: t.heading,
          rating: 5,
          note: 'Auto-logged on topic switch',
        });
        showToast(
          savedEntry
            ? `Saved ${fmtHMShort(savedEntry.activeMs)} · Switched to "${clean}"`
            : `Switched session heading to "${clean}"`
        );
        return {
          ...next,
          activeTimer: {
            ...t,
            heading: clean,
            sliceStartTs: now,
            slicePausedMs: 0,
            slicePauseCount: 0,
            pauseStartTs: t.status === 'paused' ? now : null,
          },
        };
      });
    },
    [showToast, updateAndSave]
  );

  const stopTimerAndReflect = useCallback(() => {
    const t = state.activeTimer;
    if (!t) return;
    const m = getTimerMetrics(state);
    if (t.status === 'running') {
      pauseTimer();
    }
    if (!m || m.sliceActiveMs < 1000 || t.phase === 'break') {
      updateAndSave((prev) => ({ ...prev, activeTimer: null }));
      return;
    }
    setModal({ type: 'reflect', metrics: m });
  }, [pauseTimer, state, updateAndSave]);

  const togglePomoPhase = useCallback(() => {
    updateAndSave((prev) => {
      const t = prev.activeTimer;
      if (!t || t.mode !== 'pomo') return prev;
      const now = Date.now();
      let workingState = prev;
      let nextPhase: 'work' | 'break' = 'work';
      let nextTargetMs = (prev.set.pomoWork || 25) * 60000;

      if (t.phase === 'work') {
        const res = commitSliceInState(prev, now, {
          heading: t.heading,
          rating: 5,
          note: 'Pomodoro work sprint',
        });
        workingState = res.next;
        nextPhase = 'break';
        nextTargetMs = (prev.set.pomoBreak || 5) * 60000;
      }

      beep('ok', !!prev.set.snd);
      return {
        ...workingState,
        activeTimer: {
          ...t,
          phase: nextPhase,
          targetMs: nextTargetMs,
          startTs: now,
          sliceStartTs: now,
          pausedDurationMs: 0,
          slicePausedMs: 0,
          pauseStartTs: null,
          status: 'running',
          chimeFired: false,
        },
      };
    });
  }, [updateAndSave]);

  const {
    canvasRef,
    videoRef,
    inAppPiPOpen,
    setInAppPiPOpen,
    togglePiP,
    renderTick,
    closePiP,
  } = useFloatingTimerPiP(state, {
    onStart: () => startTimer(),
    onPause: pauseTimer,
    onResume: resumeTimer,
    onTogglePause: toggleTimerPause,
    onStopAndReflect: stopTimerAndReflect,
    onToast: showToast,
  });

  // 500ms Zero-Drift Timer Loop backed by an unthrottled Web Worker + fallback setInterval
  useEffect(() => {
    if (!state.activeTimer) return;

    const handleTick = () => {
      setTickCounter((c) => c + 1);
      setState((prev) => {
        if (!prev.activeTimer) return prev;
        const now = Date.now();
        const m = getTimerMetrics(prev, now);
        let changed = false;
        let nextTimer = prev.activeTimer;

        if (
          nextTimer.status === 'running' &&
          nextTimer.mode !== 'stopwatch' &&
          m &&
          m.overtimeMs > 0 &&
          !nextTimer.chimeFired
        ) {
          nextTimer = { ...nextTimer, chimeFired: true };
          changed = true;
          beep('chime', !!prev.set.snd);
          sendNotification(
            `⚡ ${m.heading} target reached!`,
            'Entering Flow State Overtime (+00:01)'
          );
        }

        const curToday = logicalKey(now, prev.set.dayResetHour ?? 4);
        const habitChanged = syncStudyHabitsInPlace(prev, curToday, curToday, now);

        if (changed || habitChanged) {
          const updated = { ...prev, activeTimer: nextTimer };
          persistState(updated);
          return updated;
        }
        return prev;
      });
      renderTick();
    };

    let worker: Worker | null = null;
    let workerUrl: string | null = null;
    try {
      const blob = new Blob(
        ['setInterval(() => postMessage("tick"), 500);'],
        { type: 'application/javascript' }
      );
      workerUrl = URL.createObjectURL(blob);
      worker = new Worker(workerUrl);
      worker.onmessage = handleTick;
    } catch {
      // Fallback to standard setInterval below if Worker is restricted
    }

    const fallbackId = setInterval(() => {
      if (!worker) handleTick();
    }, 500);

    return () => {
      clearInterval(fallbackId);
      if (worker) worker.terminate();
      if (workerUrl) URL.revokeObjectURL(workerUrl);
    };
  }, [renderTick, state.activeTimer]);

  // Scheduled Habit Reminders check
  useEffect(() => {
    const id = setInterval(() => {
      if (!state.set.notif) return;
      const n = new Date();
      const hm = `${pad(n.getHours())}:${pad(n.getMinutes())}`;
      const tKey = logicalKey(n, state.set.dayResetHour ?? 4);
      state.habits
        .filter((h) => !h.arch)
        .forEach((h) => {
          const remKey = h.id + tKey;
          if (
            h.rem === hm &&
            due(state, h, tKey) &&
            !done(state, h, tKey) &&
            !firedRemindersRef.current.has(remKey)
          ) {
            firedRemindersRef.current.add(remKey);
            sendNotification(`${h.e} ${h.name}`, 'Time for your scheduled habit');
          }
        });
    }, 20000);
    return () => clearInterval(id);
  }, [state]);

  // Habit Handlers
  const setHabitValue = useCallback(
    (id: string, dayKey: string, delta: number) => {
      updateAndSave((prev) => {
        const next: PulseHabitState = JSON.parse(JSON.stringify(prev));
        const h = next.habits.find((x) => x.id === id);
        if (!h) return prev;
        const L = (next.log[id] ??= {});
        const e = (L[dayKey] ??= { v: 0, s: 0 });
        const wasDone = done(next, h, dayKey);
        e.s = 0;
        e.v = Math.max(0, e.v + delta);
        if (!e.v) delete L[dayKey];
        if (dayKey < h.created) h.created = dayKey;
        const nowDone = done(next, h, dayKey);
        beep(nowDone ? 'ok' : 'no', !!next.set.snd);
        const dueList = dueOn(next, dayKey);
        if (
          nowDone &&
          !wasDone &&
          dueList.length > 0 &&
          dueList.every((x) => done(next, x, dayKey))
        ) {
          beep('win', !!next.set.snd);
          boomConfetti();
          showToast('Perfect day 🎉');
        }
        return next;
      });
    },
    [showToast, updateAndSave]
  );

  const toggleHabit = useCallback(
    (id: string) => {
      const h = state.habits.find((x) => x.id === id);
      if (!h) return;
      const e = ent(state, h, sel);
      const isDone = done(state, h, sel);
      setHabitValue(id, sel, isDone ? -(e?.v || 0) : h.tn - (e?.v || 0));
    },
    [sel, setHabitValue, state]
  );

  const skipHabit = useCallback(
    (id: string) => {
      updateAndSave((prev) => {
        const next: PulseHabitState = JSON.parse(JSON.stringify(prev));
        const L = (next.log[id] ??= {});
        const e = (L[sel] ??= { v: 0, s: 0 });
        e.s = e.s ? 0 : 1;
        if (e.s) e.v = 0;
        if (!e.s && !e.v) delete L[sel];
        return next;
      });
    },
    [sel, updateAndSave]
  );

  const activeMetrics = getTimerMetrics(state);
  const pipHeading = activeMetrics ? activeMetrics.heading : 'Deep Study Session';
  const pipColor = getHeadingColor(pipHeading);

  return (
    <>
      <main id="v" aria-live="polite">
        {tab === 'today' && (
          <TodayView
            state={state}
            sel={sel}
            todayKey={todayKey}
            cat={cat}
            onSelectDay={setSel}
            onSelectCat={setCat}
            onSwitchTab={(t) => {
              setTab(t);
              window.scrollTo(0, 0);
            }}
            onToggleHabit={toggleHabit}
            onIncrementHabit={(id, d) => setHabitValue(id, sel, d)}
            onSkipHabit={skipHabit}
            onAddStarter={(idx) => {
              updateAndSave((prev) => ({
                ...prev,
                ob: 1,
                habits: [...prev.habits, mkHabit(STARTERS[idx], todayKey)],
              }));
            }}
            onNewHabit={() => setModal({ type: 'habit' })}
            onEditHabit={(id) => setModal({ type: 'habit', id })}
            onQuickStartSession={(heading, mode) => {
              setTab('focus');
              startTimer(heading, mode);
            }}
            onNewDDay={() => setModal({ type: 'dday' })}
            onEditDDay={(id) => setModal({ type: 'dday', id })}
            onOpenManualSession={() => setModal({ type: 'manualSession' })}
            onDeleteSession={(id) => {
              updateAndSave((prev) => {
                const next = {
                  ...prev,
                  sessions: prev.sessions.filter((x) => x.id !== id),
                };
                syncStudyHabitsInPlace(next, sel, todayKey);
                return next;
              });
              showToast('Session removed');
            }}
            onSetMood={(v) => {
              updateAndSave((prev) => ({
                ...prev,
                mood: {
                  ...prev.mood,
                  [sel]: prev.mood[sel] === v ? 0 : v,
                },
              }));
            }}
            onSetNote={(txt) => {
              updateAndSave((prev) => ({
                ...prev,
                notes: { ...prev.notes, [sel]: txt },
              }));
            }}
          />
        )}

        {tab === 'focus' && (
          <FocusView
            state={state}
            sel={sel}
            todayKey={todayKey}
            deskMode={deskMode}
            onToggleDeskMode={() => setDeskMode((d) => !d)}
            onOpenPiP={() => togglePiP()}
            onSwitchHeading={(newHeading) => {
              if (state.activeTimer) {
                switchHeadingMidSession(newHeading);
              }
            }}
            onSetMode={(m) => {
              updateAndSave((prev) => {
                const targetMins =
                  m === 'pomo'
                    ? prev.set.pomoWork || 25
                    : m === 'countdown'
                      ? prev.set.countdownMins || 45
                      : 0;
                return {
                  ...prev,
                  set: {
                    ...prev.set,
                    defaultMode: m,
                  },
                  activeTimer: prev.activeTimer
                    ? {
                        ...prev.activeTimer,
                        mode: m,
                        targetMs: targetMins * 60000,
                        chimeFired: false,
                      }
                    : null,
                };
              });
            }}
            onStartTimer={(heading, mode, customTargetMins) =>
              startTimer(heading, mode, customTargetMins)
            }
            onExtendTarget={extendTimerTarget}
            onTogglePause={toggleTimerPause}
            onTogglePomoPhase={togglePomoPhase}
            onStopAndReflect={stopTimerAndReflect}
            onOpenTimerConfig={() => setModal({ type: 'timerConfig' })}
            onSetSoundscape={(mode: SoundscapeMode) => {
              ensureAudioEngine();
              updateAndSave((prev) => ({
                ...prev,
                set: { ...prev.set, soundscape: mode },
              }));
            }}
            onSetSoundVolume={(vol: number) => {
              setSoundscapeVolume(vol);
              updateAndSave((prev) => ({
                ...prev,
                set: { ...prev.set, soundVol: vol },
              }));
            }}
            onAddTodo={(text) => {
              updateAndSave((prev) => ({
                ...prev,
                todos: [...(prev.todos || []), { id: uid('td'), text, done: false }],
              }));
            }}
            onToggleTodo={(todoId) => {
              updateAndSave((prev) => ({
                ...prev,
                todos: (prev.todos || []).map((td) =>
                  td.id === todoId ? { ...td, done: !td.done } : td
                ),
              }));
            }}
            onDeleteTodo={(todoId) => {
              updateAndSave((prev) => ({
                ...prev,
                todos: (prev.todos || []).filter((td) => td.id !== todoId),
              }));
            }}
            onOpenManualSession={() => setModal({ type: 'manualSession' })}
            onEditSession={(sesId) => setModal({ type: 'manualSession', id: sesId })}
          />
        )}

        {tab === 'planner' && (
          <PlannerView
            state={state}
            sel={sel}
            todayKey={todayKey}
            onOpenManualSession={() => setModal({ type: 'manualSession' })}
            onToast={showToast}
          />
        )}

        {tab === 'stats' && (
          <StatsView
            state={state}
            todayKey={todayKey}
            onEditSession={(sesId) => setModal({ type: 'manualSession', id: sesId })}
          />
        )}

        {tab === 'more' && (
          <MoreView
            state={state}
            onNewHabit={() => setModal({ type: 'habit' })}
            onEditHabit={(id) => setModal({ type: 'habit', id })}
            onOpenManualSession={() => setModal({ type: 'manualSession' })}
            onUpdateSetting={async <K extends keyof AppSettings>(
              key: K,
              val: AppSettings[K]
            ) => {
              if (
                key === 'notif' &&
                val === 1 &&
                'Notification' in window &&
                (await Notification.requestPermission()) !== 'granted'
              ) {
                showToast('Notifications are blocked in browser settings');
                return;
              }
              updateAndSave((prev) => {
                const nextSet = { ...prev.set, [key]: val };
                if (key === 'dayResetHour' || key === 'ws') {
                  setSel(logicalKey(new Date(), nextSet.dayResetHour));
                }
                return { ...prev, set: nextSet };
              });
            }}
            onExportJson={() => {
              const now = Date.now();
              updateAndSave((prev) => {
                const updated = { ...prev, exp: now };
                downloadFile(
                  `deep-hours-backup-${todayKey}.json`,
                  JSON.stringify(updated, null, 2),
                  'application/json'
                );
                return updated;
              });
            }}
            onExportCsv={() => {
              const rows = ['type,date,session_heading_or_habit,minutes_or_value,purity_pct,note'];
              state.sessions.forEach((s) => {
                const heading = getSessionHeading(state, s);
                rows.push(
                  `study_session,${s.dayKey},"${heading.replace(/"/g, '""')}",${Math.round(
                    s.activeMs / 60000
                  )},${s.purity || 100},"${(s.note || '').replace(/"/g, '""')}"`
                );
              });
              state.habits.forEach((h) =>
                Object.entries(state.log[h.id] || {})
                  .sort()
                  .forEach(([k, e]) => {
                    rows.push(
                      `habit,${k},"${h.name.replace(/"/g, '""')}",${e.v},100,""`
                    );
                  })
              );
              downloadFile(
                `deep-hours-export-${todayKey}.csv`,
                rows.join('\n'),
                'text/csv'
              );
            }}
            onImportJson={async (file) => {
              const snapJson = JSON.stringify(state);
              try {
                const parsed = JSON.parse(await file.text());
                if (!parsed || !Array.isArray(parsed.habits)) {
                  throw new Error('Invalid schema');
                }
                const restored = norm(parsed);
                const newToday = logicalKey(new Date(), restored.set.dayResetHour);
                setSel(newToday);
                setState(restored);
                persistState(restored);
                showToast('Full backup restored!', () => {
                  const reverted = norm(JSON.parse(snapJson));
                  setState(reverted);
                  persistState(reverted);
                });
              } catch {
                showToast('Invalid Deep Hours JSON backup file');
              }
            }}
            onRequestReset={() => setModal({ type: 'confirmReset' })}
          />
        )}
      </main>

      {/* Bottom Navigation Bar */}
      <nav aria-label="Main">
        <button
          type="button"
          className={tab === 'today' ? 'on' : ''}
          onClick={() => {
            setTab('today');
            window.scrollTo(0, 0);
          }}
        >
          <b>⚡</b>Today
        </button>
        <button
          type="button"
          className={tab === 'planner' ? 'on' : ''}
          onClick={() => {
            setTab('planner');
            window.scrollTo(0, 0);
          }}
        >
          <b>🗓️</b>10m Grid
        </button>
        <button
          type="button"
          className="fab"
          aria-label="Log study session manually"
          onClick={() => setModal({ type: 'manualSession' })}
        >
          +
        </button>
        <button
          type="button"
          className={tab === 'focus' ? 'on' : ''}
          onClick={() => {
            setTab('focus');
            window.scrollTo(0, 0);
          }}
        >
          <b>⏱️</b>Focus PiP
        </button>
        <button
          type="button"
          className={tab === 'stats' ? 'on' : ''}
          onClick={() => {
            setTab('stats');
            window.scrollTo(0, 0);
          }}
        >
          <b>📊</b>Summary
        </button>
        <button
          type="button"
          className={tab === 'more' ? 'on' : ''}
          onClick={() => {
            setTab('more');
            window.scrollTo(0, 0);
          }}
        >
          <b>⚙️</b>More
        </button>
      </nav>

      {/* In-App Floating Lecture PiP Companion Overlay (when toggled inside iframe/browser) */}
      {inAppPiPOpen && (
        <aside
          className="pip-floating-overlay"
          aria-label="Floating Lecture PiP Timer"
          style={
            {
              '--pip-bd':
                activeMetrics?.status === 'paused' ? '#f59e0b' : '#10b981',
            } as React.CSSProperties
          }
        >
          <div className="pip-top">
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <i
                className="dot"
                style={{ '--sc': pipColor } as React.CSSProperties}
              />
              ⚡ {pipHeading.slice(0, 16)}
            </span>
            <span
              style={{
                color:
                  activeMetrics?.status === 'paused' ? '#fbbf24' : '#34d399',
              }}
            >
              {activeMetrics && activeMetrics.overtimeMs > 0
                ? `+${fmtMS(activeMetrics.overtimeMs)}`
                : activeMetrics?.status === 'paused'
                  ? 'PAUSED'
                  : activeMetrics?.status === 'running'
                    ? `${activeMetrics.purity}%`
                    : 'IDLE'}
            </span>
          </div>
          <div className="pip-clock">
            {activeMetrics
              ? fmtHMS(
                  activeMetrics.overtimeMs > 0
                    ? activeMetrics.totalActiveMs
                    : activeMetrics.displayMs
                )
              : '00:00:00'}
          </div>
          <div className="pip-actions">
            <button
              type="button"
              style={{
                background:
                  activeMetrics?.status === 'running' ? '#f59e0b' : '#10b981',
                color: '#052e16',
              }}
              onClick={() => {
                if (!state.activeTimer) startTimer();
                else toggleTimerPause();
              }}
            >
              {activeMetrics?.status === 'running'
                ? '⏸ Pause'
                : activeMetrics?.status === 'paused'
                  ? '▶ Resume'
                  : '▶ Start'}
            </button>
            {activeMetrics && (
              <button
                type="button"
                style={{ background: '#334155', color: '#fca5a5' }}
                onClick={() => {
                  setInAppPiPOpen(false);
                  stopTimerAndReflect();
                }}
              >
                ⏹ Stop
              </button>
            )}
            <button
              type="button"
              style={{ background: '#1e293b', color: '#94a3b8', flex: 'none' }}
              aria-label="Close Floating PiP"
              onClick={() => setInAppPiPOpen(false)}
            >
              ×
            </button>
          </div>
        </aside>
      )}

      {/* Modals */}
      <Modals
        modal={modal}
        state={state}
        sel={sel}
        todayKey={todayKey}
        onClose={() => setModal({ type: 'none' })}
        onSaveHabit={(id, data: Partial<Habit>) => {
          updateAndSave((prev) => {
            const next = { ...prev, ob: 1 };
            if (id) {
              next.habits = prev.habits.map((h) =>
                h.id === id ? { ...h, ...data, u: Date.now() } : h
              );
            } else {
              next.habits = [...prev.habits, mkHabit(data, todayKey)];
            }
            return next;
          });
          setModal({ type: 'none' });
        }}
        onArchiveHabit={(id) => {
          updateAndSave((prev) => ({
            ...prev,
            habits: prev.habits.map((h) =>
              h.id === id ? { ...h, arch: h.arch ? 0 : 1, u: Date.now() } : h
            ),
          }));
          setModal({ type: 'none' });
        }}
        onDeleteHabit={(id) => {
          const snapJson = JSON.stringify(state);
          updateAndSave((prev) => {
            const nextLog = { ...prev.log };
            delete nextLog[id];
            return {
              ...prev,
              habits: prev.habits.filter((x) => x.id !== id),
              log: nextLog,
              del: [...(prev.del || []), id],
            };
          });
          setModal({ type: 'none' });
          showToast('Habit deleted', () => {
            const restored = norm(JSON.parse(snapJson));
            setState(restored);
            persistState(restored);
          });
        }}
        onSubmitReflection={(heading, rating, note) => {
          updateAndSave((prev) => {
            const { next } = commitSliceInState(prev, Date.now(), {
              heading,
              rating,
              note,
            });
            return {
              ...next,
              activeTimer: null,
            };
          });
          closePiP();
          beep('win', !!state.set.snd);
          boomConfetti();
          setModal({ type: 'none' });
          showToast(`Logged session: ${heading}`);
        }}
        onDiscardSession={() => {
          updateAndSave((prev) => ({ ...prev, activeTimer: null }));
          closePiP();
          setModal({ type: 'none' });
        }}
        onSaveManualSession={(id, sessionData) => {
          updateAndSave((prev) => {
            const payload: StudySession = {
              id: id || uid('ses'),
              ...sessionData,
            };
            const nextSessions = id
              ? prev.sessions.map((x) => (x.id === id ? payload : x))
              : [...prev.sessions, payload];
            const next = { ...prev, sessions: nextSessions };
            syncStudyHabitsInPlace(next, payload.dayKey, todayKey);
            return next;
          });
          setModal({ type: 'none' });
          showToast(`Logged "${sessionData.heading || 'Study Session'}"`);
        }}
        onDeleteSession={(id) => {
          updateAndSave((prev) => {
            const next = {
              ...prev,
              sessions: prev.sessions.filter((x) => x.id !== id),
            };
            syncStudyHabitsInPlace(next, sel, todayKey);
            return next;
          });
          setModal({ type: 'none' });
        }}
        onSaveTimerConfig={(pomoWork, pomoBreak, countdownMins) => {
          updateAndSave((prev) => ({
            ...prev,
            set: { ...prev.set, pomoWork, pomoBreak, countdownMins },
          }));
          setModal({ type: 'none' });
        }}
        onSaveDDay={(id, data: Omit<DDay, 'id'>) => {
          updateAndSave((prev) => {
            if (id) {
              return {
                ...prev,
                ddays: prev.ddays.map((d) =>
                  d.id === id ? { ...d, ...data } : d
                ),
              };
            }
            return {
              ...prev,
              ddays: [...prev.ddays, { id: uid('dd'), ...data }],
            };
          });
          setModal({ type: 'none' });
        }}
        onDeleteDDay={(id) => {
          updateAndSave((prev) => ({
            ...prev,
            ddays: prev.ddays.filter((x) => x.id !== id),
          }));
          setModal({ type: 'none' });
        }}
        onConfirmReset={() => {
          const fresh = createDefaultState();
          setState(fresh);
          persistState(fresh);
          setModal({ type: 'none' });
          showToast('All device data reset');
        }}
      />

      {/* Toast Notification */}
      {toastState && (
        <div id="toast" role="status">
          <span>{toastState.msg}</span>
          {toastState.undoFn && (
            <button
              type="button"
              onClick={() => {
                toastState.undoFn?.();
                setToastState(null);
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}

      {/* Hidden offscreen Canvas & Video for Android Chrome PiP Stream (16:9 480x270) */}
      <canvas
        id="pipCanvas"
        ref={canvasRef}
        width={480}
        height={270}
        style={{
          position: 'fixed',
          left: '-9999px',
          top: '-9999px',
          pointerEvents: 'none',
        }}
      />
      <video
        id="pipVideo"
        ref={videoRef}
        playsInline
        style={{
          position: 'fixed',
          left: '-9999px',
          top: '-9999px',
          width: '1px',
          height: '1px',
          opacity: 0,
          pointerEvents: 'none',
        }}
      />
    </>
  );
}
