/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ActiveTimerMode,
  AppSettings,
  AppTab,
  Chapter,
  ChapterStatus,
  DDay,
  Doubt,
  Habit,
  HabitCategory,
  MistakeEntry,
  MockTest,
  PYQEntry,
  PrepSubTab,
  PulseHabitState,
  SoundscapeMode,
  StatsSubTab,
  StudySession,
  SubjectTargets,
  SyncStatus,
  WellbeingEntry,
} from './types';
import {
  type DeletedEntityRecord,
  STARTERS,
  addChapterRevisionDate,
  addD,
  addTombstone,
  applyChapterUpdate,
  cloneLog,
  computeMockScore,
  createBlankState,
  createDailyTask,
  createDefaultState,
  done,
  due,
  dueOn,
  ent,
  fmtHMS,
  fmtHMShort,
  getDailyStudyGoalProgress,
  getSessionHeading,
  getSortedChapterRevisions,
  getTimerMetrics,
  isAutoStudyHabit,
  logicalKey,
  mkHabit,
  moveUnfinishedTasksToToday,
  norm,
  pad,
  restoreDeletedItem,
  shouldFireFiveMinWarning,
  syncStudyHabitsForDays,
  syncStudyHabitsInPlace,
  uid,
  updateChapterRevisionDate,
} from './utils/studyLogic';
import { toggleRestDay } from './utils/insights';
import {
  loadInitialState,
  persistState,
  restoreFromLatestBackup,
  subscribeBroadcast,
  writeSafetyBackupSnapshot,
} from './utils/storage';
import {
  SyncBudgetController,
  addDirtyDocsToOutbox,
  checkRedirectSignInResult,
  deleteAllUserCloudData,
  detectDirtyDocKeys,
  getSyncTodayWrites,
  performCloudSyncCycle,
  signInWithGoogleAccount,
  signOutGoogleAccount,
  subscribeToAuthChanges,
  testFirestoreConnection,
} from './utils/cloudSync';
import {
  beep,
  ensureAudioEngine,
  setSoundscapeVolume,
  updateSoundscape,
} from './utils/audioEngine';
import { useFloatingTimerPiP } from './hooks/useFloatingTimerPiP';
import { TodayView } from './components/TodayView';
import { PrepView } from './components/PrepView';
import { FocusView } from './components/FocusView';
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
  const palette = ['#10b981', '#38bdf8', '#fbbf24', '#a78bfa', '#f472b6', '#34d399'];
  for (let i = 0; i < 44; i++) {
    const e = document.createElement('i');
    const isStar = i % 3 === 0;
    const isOrb = i % 3 === 1;
    e.className = isStar ? 'cf cf-star' : 'cf';
    const color = palette[i % palette.length];
    const size = isStar ? 13 : isOrb ? 9 : 8;
    const height = isStar ? 13 : isOrb ? 9 : 14;
    const br = isOrb ? '50%' : '2px';
    const angle = (Math.PI * 2 * i) / 44 + (Math.random() - 0.5) * 0.25;
    const dist = 90 + Math.random() * 210;
    const tx = Math.cos(angle) * dist;
    const ty = -80 - Math.abs(Math.sin(angle)) * 190 - Math.random() * 60;
    const dur = (1.1 + Math.random() * 0.45).toFixed(2) + 's';
    e.style.cssText = `left:50%;top:36%;background:${color};--w:${size}px;--h:${height}px;--br:${br};--x:${tx.toFixed(
      1
    )}px;--y:${ty.toFixed(1)}px;--r:${Math.round(
      (Math.random() - 0.5) * 960
    )}deg;--dur:${dur}`;
    document.body.append(e);
    setTimeout(() => e.remove(), 1600);
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
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [backupRestoreMsg, setBackupRestoreMsg] = useState<string | null>(null);
  const [confirmStartFresh, setConfirmStartFresh] = useState(false);

  const [state, setState] = useState<PulseHabitState>(() => createDefaultState());
  const [tab, setTab] = useState<AppTab>('today');
  const [prepSubTab, setPrepSubTab] = useState<PrepSubTab>('syllabus');
  const [statsSubTab, setStatsSubTab] = useState<StatsSubTab>('summary');
  const [sel, setSel] = useState<string>(() => logicalKey(new Date(), 4));
  const [cat, setCat] = useState<'All' | HabitCategory>('All');
  const [deskMode, setDeskMode] = useState(false);
  const [modal, setModal] = useState<ModalState>({ type: 'none' });
  const [toastState, setToastState] = useState<{
    msg: string;
    undoFn?: () => void;
    actionLabel?: string;
    onTap?: () => void;
  } | null>(null);
  const [waitingSw, setWaitingSw] = useState<ServiceWorker | null>(null);
  const [perfectDayBanner, setPerfectDayBanner] = useState(false);
  const [, setTickCounter] = useState(0);

  // Milestone 2: Firebase Auth & Cloud Sync state
  const [authUser, setAuthUser] = useState<{
    uid: string;
    email: string | null;
    displayName: string | null;
  } | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('off');
  const [syncErrorMsg, setSyncErrorMsg] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | undefined>(undefined);
  const [syncWritesToday, setSyncWritesToday] = useState<number>(() =>
    getSyncTodayWrites()
  );

  const readyRef = useRef(false);
  const stateRef = useRef<PulseHabitState>(state);
  stateRef.current = state;
  const authUserRef = useRef(authUser);
  authUserRef.current = authUser;
  const syncControllerRef = useRef<SyncBudgetController | null>(null);

  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const perfectDayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRemindersRef = useRef<Set<string>>(new Set());
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const swReloadRequestedRef = useRef(false);

  const todayKey = logicalKey(new Date(), state.set.dayResetHour ?? 4);
  const prevTodayKeyRef = useRef(todayKey);

  const showToast = useCallback(
    (
      msg: string,
      undoFn?: () => void,
      opts?: { durationMs?: number; actionLabel?: string; onTap?: () => void }
    ) => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      setToastState({
        msg,
        undoFn,
        actionLabel: opts?.actionLabel,
        onTap: opts?.onTap,
      });
      const dur = opts?.durationMs ?? 4500;
      if (dur > 0) {
        toastTimeoutRef.current = setTimeout(() => {
          setToastState(null);
        }, dur);
      }
    },
    []
  );

  // A3 & A4: Never persist before initial IndexedDB load completes, and never run side effects inside setState
  const saveNextState = useCallback((next: PulseHabitState) => {
    const prev = stateRef.current;
    const dirtyKeys = readyRef.current ? detectDirtyDocKeys(prev, next) : [];
    const stamped: PulseHabitState = {
      ...next,
      savedAt: Date.now(),
    };
    stateRef.current = stamped;
    setState(stamped);
    if (readyRef.current) {
      persistState(stamped);
      if (dirtyKeys.length > 0) {
        addDirtyDocsToOutbox(dirtyKeys);
        if (authUserRef.current && syncControllerRef.current) {
          syncControllerRef.current.markDirty(dirtyKeys);
        }
      }
    }
  }, []);

  const updateAndSave = useCallback(
    (updater: (prev: PulseHabitState) => PulseHabitState) => {
      const prev = stateRef.current;
      const draft = updater(prev);
      const next: PulseHabitState = {
        ...draft,
        log: cloneLog(draft.log),
      };
      const curToday = logicalKey(new Date(), next.set.dayResetHour ?? 4);
      syncStudyHabitsInPlace(next, curToday, curToday);
      saveNextState(next);
    },
    [saveNextState]
  );

  const hydrateLoadedState = useCallback((loaded: PulseHabitState) => {
    const next: PulseHabitState = {
      ...loaded,
      log: cloneLog(loaded.log),
    };
    const curToday = logicalKey(new Date(), next.set.dayResetHour ?? 4);
    syncStudyHabitsInPlace(next, curToday, curToday);
    readyRef.current = true;
    stateRef.current = next;
    prevTodayKeyRef.current = curToday;
    setLoadError(null);
    setBackupRestoreMsg(null);
    setConfirmStartFresh(false);
    setState(next);
    setSel(curToday);
    setReady(true);
  }, []);

  const attemptLoadState = useCallback(() => {
    setLoadError(null);
    setBackupRestoreMsg(null);
    loadInitialState()
      .then((loaded) => {
        hydrateLoadedState(loaded);
      })
      .catch((err) => {
        // F4: Do NOT start blank silently when real data could not be loaded
        readyRef.current = false;
        setReady(false);
        setLoadError(
          err instanceof Error
            ? err.message
            : 'Both local storage stores were unreadable or corrupted.'
        );
      });
  }, [hydrateLoadedState]);

  // F6: Apply waiting Service Worker only when tapped and no timer is running
  const handleApplyWaitingSw = useCallback(
    (worker?: ServiceWorker | null) => {
      const targetSw = worker || waitingSw;
      if (!targetSw) return;
      if (stateRef.current.activeTimer?.status === 'running') {
        showToast('Pause or finish your running timer before reloading');
        return;
      }
      swReloadRequestedRef.current = true;
      try {
        targetSw.postMessage({ type: 'SKIP_WAITING' });
      } catch {
        // ignore postMessage errors
      }
      setTimeout(() => {
        if (
          swReloadRequestedRef.current &&
          stateRef.current.activeTimer?.status !== 'running'
        ) {
          window.location.reload();
        }
      }, 600);
    },
    [showToast, waitingSw]
  );

  // A3, F4, F6: Load initial state and register Service Worker with update detection
  useEffect(() => {
    let mounted = true;
    loadInitialState()
      .then((loaded) => {
        if (!mounted) return;
        hydrateLoadedState(loaded);
      })
      .catch((err) => {
        if (!mounted) return;
        readyRef.current = false;
        setReady(false);
        setLoadError(
          err instanceof Error
            ? err.message
            : 'Both local storage stores were unreadable or corrupted.'
        );
      });

    const unsub = subscribeBroadcast((latest) => {
      if (!mounted || !readyRef.current) return;
      stateRef.current = latest;
      setState(latest);
    });

    const onControllerChange = () => {
      if (
        swReloadRequestedRef.current &&
        stateRef.current.activeTimer?.status !== 'running'
      ) {
        window.location.reload();
      }
    };

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          if (!mounted) return;
          const notifyWaiting = (sw: ServiceWorker) => {
            if (!mounted) return;
            setWaitingSw(sw);
            showToast('New version ready, tap to reload', undefined, {
              durationMs: 0,
              actionLabel: 'Reload',
              onTap: () => handleApplyWaitingSw(sw),
            });
          };

          if (reg.waiting) {
            notifyWaiting(reg.waiting);
          }

          reg.addEventListener('updatefound', () => {
            const installing = reg.installing;
            if (!installing) return;
            installing.addEventListener('statechange', () => {
              if (
                installing.state === 'installed' &&
                navigator.serviceWorker.controller
              ) {
                notifyWaiting(installing);
              }
            });
          });
        })
        .catch(() => {});
    }

    return () => {
      mounted = false;
      unsub();
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener(
          'controllerchange',
          onControllerChange
        );
      }
    };
  }, [handleApplyWaitingSw, hydrateLoadedState, showToast]);

  // A7: Idle day-rollover interval every 30s so todayKey and sel advance automatically past dayResetHour
  useEffect(() => {
    const id = setInterval(() => {
      setTickCounter((c) => c + 1);
    }, 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const prevToday = prevTodayKeyRef.current;
    if (prevToday !== todayKey) {
      prevTodayKeyRef.current = todayKey;
      setSel((curSel) => (curSel === prevToday ? todayKey : curSel));
    }
  }, [todayKey]);

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

  // Milestone 2: Cloud Sync Controller & Firebase Auth lifecycle
  const runCloudSync = useCallback(
    async (opts?: {
      forcePull?: boolean;
      isFirstSignIn?: boolean;
      dirtyDocKeys?: string[];
    }): Promise<SyncStatus> => {
      const user = authUserRef.current;
      const controller = syncControllerRef.current;
      if (!user || !controller || !readyRef.current) return 'off';
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setSyncStatus('offline');
        return 'offline';
      }

      setSyncStatus('syncing');
      setSyncErrorMsg(null);

      try {
        // 2.4: On first sign-in on a device that already has local data, write a safety snapshot first
        if (opts?.isFirstSignIn && stateRef.current.syncMeta?.uid !== user.uid) {
          await writeSafetyBackupSnapshot(stateRef.current);
        }

        const res = await performCloudSyncCycle(
          user.uid,
          stateRef.current,
          controller,
          { forcePull: opts?.forcePull, dirtyDocKeys: opts?.dirtyDocKeys }
        );
        setSyncWritesToday(getSyncTodayWrites());
        setSyncStatus(res.status);
        if (res.errorMessage) {
          setSyncErrorMsg(res.errorMessage);
        }
        if (res.mergedState.syncMeta?.lastSyncedAt) {
          setLastSyncedAt(res.mergedState.syncMeta.lastSyncedAt);
        }
        if (res.status === 'synced' || res.pulledDocs > 0) {
          const curToday = logicalKey(
            new Date(),
            res.mergedState.set.dayResetHour ?? 4
          );
          const syncedState: PulseHabitState = {
            ...res.mergedState,
            log: cloneLog(res.mergedState.log),
            savedAt: Date.now(),
          };
          syncStudyHabitsInPlace(syncedState, curToday, curToday);
          stateRef.current = syncedState;
          setState(syncedState);
          persistState(syncedState);
        }
        return res.status;
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Cloud sync encountered an unexpected error';
        setSyncStatus('error');
        setSyncErrorMsg(msg);
        return 'error';
      }
    },
    []
  );

  // Trigger initial cloud sync once IndexedDB state is ready if auth resolved first
  useEffect(() => {
    if (ready && authUser) {
      setLastSyncedAt((prev) => prev ?? stateRef.current.syncMeta?.lastSyncedAt);
      void runCloudSync({ forcePull: true, isFirstSignIn: true });
    }
  }, [ready, authUser, runCloudSync]);

  useEffect(() => {
    const controller = new SyncBudgetController(async (dirtyDocKeys) => {
      await runCloudSync({ forcePull: false, dirtyDocKeys });
    });
    syncControllerRef.current = controller;

    checkRedirectSignInResult().catch(() => {});

    const unsubAuth = subscribeToAuthChanges((user) => {
      if (user) {
        const u = {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
        };
        authUserRef.current = u;
        setAuthUser(u);
        setLastSyncedAt(stateRef.current.syncMeta?.lastSyncedAt);
        testFirestoreConnection().catch(() => {});
      } else {
        authUserRef.current = null;
        setAuthUser(null);
        setSyncStatus('off');
      }
    });

    const onVisHide = () => {
      if (document.visibilityState === 'hidden' && authUserRef.current) {
        controller.flushOnBackground();
      } else if (document.visibilityState === 'visible' && authUserRef.current) {
        runCloudSync({ forcePull: false });
      }
    };
    const onOnline = () => {
      if (authUserRef.current) runCloudSync({ forcePull: false });
    };
    const onOffline = () => {
      if (authUserRef.current) setSyncStatus('offline');
    };

    document.addEventListener('visibilitychange', onVisHide);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      unsubAuth();
      controller.dispose();
      document.removeEventListener('visibilitychange', onVisHide);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [runCloudSync]);

  // Timer actions (A4: side effects outside state updaters)
  const startTimer = useCallback(
    (
      subjectId?: string,
      heading?: string,
      mode?: ActiveTimerMode,
      customTargetMins?: number,
      chapterId?: string
    ) => {
      ensureAudioEngine();
      const prev = stateRef.current;
      const resolvedSubId =
        subjectId ||
        prev.activeTimer?.subjectId ||
        prev.subjects.find((s) => !s.arch)?.id ||
        'sub_phy';
      const sub = prev.subjects.find((s) => s.id === resolvedSubId);
      const resolvedChapId =
        chapterId !== undefined ? chapterId || undefined : prev.activeTimer?.chapterId;
      const chap = resolvedChapId
        ? prev.chapters.find((c) => c.id === resolvedChapId)
        : undefined;
      const m: ActiveTimerMode = mode || prev.set.defaultMode || 'pomo';
      const cleanHeading =
        (heading && heading.trim()) ||
        chap?.name ||
        (m === 'fullMock'
          ? 'Full Mock'
          : sub
            ? `${sub.name} Study`
            : 'Deep Study Session');
      const targetMins =
        m === 'pomo'
          ? prev.set.pomoWork || 25
          : m === 'countdown'
            ? customTargetMins || prev.set.countdownMins || 45
            : m === 'fullMock'
              ? customTargetMins || prev.set.fullMockMins || 200
              : 0;
      const now = Date.now();

      beep('ok', !!prev.set.snd);
      updateAndSave((cur) => ({
        ...cur,
        set: {
          ...cur.set,
          defaultMode: m,
        },
        activeTimer: {
          status: 'running',
          mode: m,
          phase: 'work',
          subjectId: resolvedSubId,
          chapterId: resolvedChapId,
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
          fiveMinWarnFired: false,
          mockSections: m === 'fullMock' ? [] : undefined,
          sectionStartActiveMs: m === 'fullMock' ? 0 : undefined,
        },
      }));
    },
    [updateAndSave]
  );

  // Milestone 1.14: Record elapsed time per section in Full Mock mode from timestamps
  const handleNextMockSection = useCallback(() => {
    const prev = stateRef.current;
    const t = prev.activeTimer;
    if (!t || t.mode !== 'fullMock') return;
    const now = Date.now();
    const curPause =
      t.status === 'paused' && t.pauseStartTs ? Math.max(0, now - t.pauseStartTs) : 0;
    const totalPaused = (t.pausedDurationMs || 0) + curPause;
    const totalActive = Math.max(0, now - t.startTs - totalPaused);
    const prevSplit = t.sectionStartActiveMs || 0;
    const elapsedMs = Math.max(0, totalActive - prevSplit);
    const existing = t.mockSections || [];
    const nextLabel = `Section ${existing.length + 1}`;

    beep('ok', !!prev.set.snd);
    updateAndSave((cur) => {
      if (!cur.activeTimer || cur.activeTimer.mode !== 'fullMock') return cur;
      return {
        ...cur,
        activeTimer: {
          ...cur.activeTimer,
          mockSections: [...existing, { label: nextLabel, elapsedMs }],
          sectionStartActiveMs: totalActive,
        },
      };
    });
    showToast(`${nextLabel} recorded (${fmtHMS(elapsedMs)})`);
  }, [showToast, updateAndSave]);

  const pauseTimer = useCallback(() => {
    const prev = stateRef.current;
    const t = prev.activeTimer;
    if (!t || t.status === 'paused') return;
    beep('no', !!prev.set.snd);
    updateAndSave((cur) => {
      const ct = cur.activeTimer;
      if (!ct || ct.status === 'paused') return cur;
      return {
        ...cur,
        activeTimer: {
          ...ct,
          status: 'paused',
          pauseStartTs: Date.now(),
          pauseCount: (ct.pauseCount || 0) + 1,
          slicePauseCount: (ct.slicePauseCount || 0) + 1,
        },
      };
    });
  }, [updateAndSave]);

  const resumeTimer = useCallback(() => {
    ensureAudioEngine();
    const prev = stateRef.current;
    const t = prev.activeTimer;
    if (!t || t.status !== 'paused') return;
    beep('ok', !!prev.set.snd);
    updateAndSave((cur) => {
      const ct = cur.activeTimer;
      if (!ct || ct.status !== 'paused') return cur;
      const now = Date.now();
      const deltaPause = ct.pauseStartTs ? Math.max(0, now - ct.pauseStartTs) : 0;
      return {
        ...cur,
        activeTimer: {
          ...ct,
          status: 'running',
          pauseStartTs: null,
          pausedDurationMs: (ct.pausedDurationMs || 0) + deltaPause,
          slicePausedMs: (ct.slicePausedMs || 0) + deltaPause,
        },
      };
    });
  }, [updateAndSave]);

  const toggleTimerPause = useCallback(() => {
    const cur = stateRef.current.activeTimer;
    if (!cur) return;
    if (cur.status === 'running') pauseTimer();
    else resumeTimer();
  }, [pauseTimer, resumeTimer]);

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
            fiveMinWarnFired: false,
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
    reflection: {
      subjectId?: string;
      chapterId?: string;
      heading?: string;
      rating: number;
      note: string;
    }
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
    const finalSubjectId =
      reflection.subjectId ||
      t.subjectId ||
      prev.subjects.find((s) => !s.arch)?.id ||
      'sub_phy';
    const finalChapterId =
      reflection.chapterId !== undefined
        ? reflection.chapterId || undefined
        : t.chapterId;
    const chap = finalChapterId
      ? prev.chapters.find((c) => c.id === finalChapterId)
      : undefined;
    const sub = prev.subjects.find((s) => s.id === finalSubjectId);
    const finalHeading =
      (reflection.heading && reflection.heading.trim()) ||
      chap?.name ||
      (t.heading && t.heading.trim()) ||
      (t.mode === 'fullMock'
        ? 'Full Mock'
        : sub
          ? `${sub.name} Study`
          : 'Deep Study Session');

    const entry: StudySession = {
      id: uid('ses'),
      subjectId: finalSubjectId,
      chapterId: finalChapterId,
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
      log: cloneLog(prev.log),
      sessions: [...prev.sessions, entry],
      bonus: (prev.bonus || 0) + Math.max(5, Math.round(sliceActiveMs / 60000)),
    };
    const curToday = logicalKey(now, next.set.dayResetHour ?? 4);
    syncStudyHabitsInPlace(next, entry.dayKey, curToday, now);
    return { next, savedEntry: entry };
  };

  const switchTopicMidSession = useCallback(
    (newSubjectId: string, newHeading: string, newChapterId?: string) => {
      const prev = stateRef.current;
      const t = prev.activeTimer;
      if (!t) return;
      const sub = prev.subjects.find((s) => s.id === newSubjectId);
      const chap = newChapterId
        ? prev.chapters.find((c) => c.id === newChapterId)
        : undefined;
      const clean =
        newHeading.trim() ||
        chap?.name ||
        (sub ? `${sub.name} Study` : 'Deep Study Session');
      if (
        t.subjectId === newSubjectId &&
        t.heading === clean &&
        (t.chapterId || '') === (newChapterId || '')
      ) {
        return;
      }

      const now = Date.now();
      const { next, savedEntry } = commitSliceInState(prev, now, {
        subjectId: t.subjectId,
        chapterId: t.chapterId,
        heading: t.heading,
        rating: 5,
        note: 'Auto-logged on topic switch',
      });
      const updated: PulseHabitState = {
        ...next,
        activeTimer: {
          ...t,
          subjectId: newSubjectId,
          chapterId: newChapterId || undefined,
          heading: clean,
          sliceStartTs: now,
          slicePausedMs: 0,
          slicePauseCount: 0,
          pauseStartTs: t.status === 'paused' ? now : null,
        },
      };
      const curToday = logicalKey(now, updated.set.dayResetHour ?? 4);
      syncStudyHabitsInPlace(updated, curToday, curToday, now);
      saveNextState(updated);

      showToast(
        savedEntry
          ? `Saved ${fmtHMShort(savedEntry.activeMs)} · Switched to "${clean}"`
          : `Switched session topic to "${clean}"`
      );
    },
    [saveNextState, showToast]
  );

  const stopTimerAndReflect = useCallback(() => {
    const cur = stateRef.current;
    const t = cur.activeTimer;
    if (!t) return;
    const now = Date.now();
    const m = getTimerMetrics(cur, now);
    if (t.status === 'running') {
      pauseTimer();
    }
    if (!m || m.sliceActiveMs < 1000 || t.phase === 'break') {
      updateAndSave((prev) => ({ ...prev, activeTimer: null }));
      return;
    }

    // Milestone 1.14: On Full Mock stop, save as normal study session with heading "Full Mock"
    // and open the mock modal pre-filled with date, duration, and section times in note.
    if (t.mode === 'fullMock') {
      const existingSplits = t.mockSections || [];
      const finalSplitElapsed = Math.max(
        0,
        m.totalActiveMs - (t.sectionStartActiveMs || 0)
      );
      const allSplits =
        finalSplitElapsed >= 1000
          ? [
              ...existingSplits,
              {
                label: `Section ${existingSplits.length + 1}`,
                elapsedMs: finalSplitElapsed,
              },
            ]
          : existingSplits;
      const splitsSummary =
        allSplits.length > 0
          ? `Section times: ${allSplits
              .map((s) => `${s.label}: ${fmtHMS(s.elapsedMs)}`)
              .join(' | ')}`
          : 'Full Mock completed';

      const { next } = commitSliceInState(cur, now, {
        subjectId: t.subjectId,
        chapterId: t.chapterId,
        heading: 'Full Mock',
        rating: 5,
        note: splitsSummary,
      });
      saveNextState({
        ...next,
        activeTimer: null,
      });
      setModal({
        type: 'mock',
        prefillDayKey: logicalKey(now, cur.set.dayResetHour ?? 4),
        prefillDurationMins: Math.max(1, Math.round(m.totalActiveMs / 60000)),
        prefillNote: splitsSummary,
      });
      showToast('Logged Full Mock study session · Enter your mock scores');
      return;
    }

    setModal({ type: 'reflect', metrics: m });
  }, [pauseTimer, saveNextState, showToast, updateAndSave]);

  const togglePomoPhase = useCallback(() => {
    const prev = stateRef.current;
    const t = prev.activeTimer;
    if (!t || t.mode !== 'pomo') return;
    const now = Date.now();
    let workingState = prev;
    let nextPhase: 'work' | 'break' = 'work';
    let nextTargetMs = (prev.set.pomoWork || 25) * 60000;

    if (t.phase === 'work') {
      const res = commitSliceInState(prev, now, {
        subjectId: t.subjectId,
        heading: t.heading,
        rating: 5,
        note: 'Pomodoro work sprint',
      });
      workingState = res.next;
      nextPhase = 'break';
      nextTargetMs = (prev.set.pomoBreak || 5) * 60000;
    }

    beep('ok', !!prev.set.snd);
    const updated: PulseHabitState = {
      ...workingState,
      log: cloneLog(workingState.log),
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
        fiveMinWarnFired: false,
      },
    };
    const curToday = logicalKey(now, updated.set.dayResetHour ?? 4);
    syncStudyHabitsInPlace(updated, curToday, curToday, now);
    saveNextState(updated);
  }, [saveNextState]);

  const {
    canvasRef,
    videoRef,
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
      const prev = stateRef.current;
      if (!prev.activeTimer) return;

      const now = Date.now();
      const m = getTimerMetrics(prev, now);
      let changed = false;
      let nextTimer = prev.activeTimer;

      // Subtle 5-minute remaining audio & vibration cue for task wrap-up planning
      if (m && shouldFireFiveMinWarning(nextTimer, m)) {
        nextTimer = { ...nextTimer, fiveMinWarnFired: true };
        changed = true;
        beep('fiveMin', !!prev.set.snd);
        showToast('⏳ 5 minutes remaining — start planning your session wrap-up');
        sendNotification(
          `⏳ 5 Minutes Remaining · ${m.heading}`,
          'Start wrapping up key takeaways before your session ends.'
        );
      }

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
      const draft: PulseHabitState = {
        ...prev,
        log: cloneLog(prev.log),
        activeTimer: nextTimer,
      };
      const habitChanged = syncStudyHabitsInPlace(draft, curToday, curToday, now);

      if (changed || habitChanged) {
        saveNextState(draft);
      }
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
  }, [renderTick, saveNextState, showToast, state.activeTimer]);

  // Scheduled Habit Reminders check
  useEffect(() => {
    const id = setInterval(() => {
      const cur = stateRef.current;
      if (!cur.set.notif) return;
      const n = new Date();
      const hm = `${pad(n.getHours())}:${pad(n.getMinutes())}`;
      const tKey = logicalKey(n, cur.set.dayResetHour ?? 4);
      cur.habits
        .filter((h) => !h.arch)
        .forEach((h) => {
          const remKey = h.id + tKey;
          if (
            h.rem === hm &&
            due(cur, h, tKey) &&
            !done(cur, h, tKey) &&
            !firedRemindersRef.current.has(remKey)
          ) {
            firedRemindersRef.current.add(remKey);
            sendNotification(`${h.e} ${h.name}`, 'Time for your scheduled habit');
          }
        });
    }, 20000);
    return () => clearInterval(id);
  }, []);

  // Habit Handlers (A4 & A11: pure state updates, auto-study habits cannot be manually incremented)
  const setHabitValue = useCallback(
    (id: string, dayKey: string, delta: number) => {
      const prev = stateRef.current;
      const h = prev.habits.find((x) => x.id === id);
      if (!h || isAutoStudyHabit(h)) return;

      const next: PulseHabitState = JSON.parse(JSON.stringify(prev));
      const nextH = next.habits.find((x) => x.id === id);
      if (!nextH) return;

      const now = Date.now();
      const L = (next.log[id] ??= {});
      const e = (L[dayKey] ??= { v: 0, s: 0 });
      const wasDone = done(next, nextH, dayKey);
      e.s = 0;
      e.v = Math.max(0, e.v + delta);
      e.t = now;
      e.updatedAt = now;
      if (!e.v) delete L[dayKey];
      if (dayKey < nextH.created) nextH.created = dayKey;
      const nowDone = done(next, nextH, dayKey);

      const curToday = logicalKey(new Date(), next.set.dayResetHour ?? 4);
      syncStudyHabitsInPlace(next, curToday, curToday);
      saveNextState(next);

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
        if (perfectDayTimeoutRef.current) clearTimeout(perfectDayTimeoutRef.current);
        setPerfectDayBanner(true);
        perfectDayTimeoutRef.current = setTimeout(() => {
          setPerfectDayBanner(false);
        }, 2900);
        showToast('Perfect day 🎉');
      }
    },
    [saveNextState, showToast]
  );

  const toggleHabit = useCallback(
    (id: string) => {
      const cur = stateRef.current;
      const h = cur.habits.find((x) => x.id === id);
      if (!h || isAutoStudyHabit(h)) return;
      const e = ent(cur, h, sel);
      const isDone = done(cur, h, sel);
      setHabitValue(id, sel, isDone ? -(e?.v || 0) : h.tn - (e?.v || 0));
    },
    [sel, setHabitValue]
  );

  const skipHabit = useCallback(
    (id: string) => {
      const now = Date.now();
      updateAndSave((prev) => {
        const next: PulseHabitState = JSON.parse(JSON.stringify(prev));
        const L = (next.log[id] ??= {});
        const e = (L[sel] ??= { v: 0, s: 0 });
        e.s = e.s ? 0 : 1;
        if (e.s) e.v = 0;
        e.t = now;
        e.updatedAt = now;
        if (!e.s && !e.v) delete L[sel];
        return next;
      });
    },
    [sel, updateAndSave]
  );

  // F1 & A5: Delete session with item-only Undo at original index + multi-day habit sync + tombstone
  const handleDeleteSession = useCallback(
    (id: string) => {
      const prev = stateRef.current;
      const index = prev.sessions.findIndex((x) => x.id === id);
      if (index === -1) return;
      const target = prev.sessions[index];
      const record: DeletedEntityRecord = {
        kind: 'session',
        item: JSON.parse(JSON.stringify(target)),
        index,
      };

      const withTomb = addTombstone(prev, id);
      const next: PulseHabitState = {
        ...withTomb,
        log: cloneLog(prev.log),
        sessions: prev.sessions.filter((x) => x.id !== id),
      };
      syncStudyHabitsForDays(next, [target.dayKey, sel, todayKey], todayKey);
      saveNextState(next);

      showToast('Session deleted', () => {
        const cur = stateRef.current;
        const restored = restoreDeletedItem(cur, record);
        const curToday = logicalKey(new Date(), restored.set.dayResetHour ?? 4);
        syncStudyHabitsForDays(restored, [target.dayKey, sel, curToday], curToday);
        saveNextState(restored);
      });
    },
    [saveNextState, sel, showToast, todayKey]
  );

  // B2 & F3: Chapter & Revision Handlers
  const handleAddChapters = useCallback(
    (subjectId: string, names: string[]) => {
      const cleanLines = names.map((l) => l.trim()).filter(Boolean);
      if (!cleanLines.length) return;
      const now = Date.now();
      updateAndSave((prev) => ({
        ...prev,
        chapters: [
          ...prev.chapters,
          ...cleanLines.map((name) => ({
            id: uid('ch'),
            subjectId,
            name: name.slice(0, 100),
            status: 'notStarted' as ChapterStatus,
            revisions: [],
            confidenceLog: [],
            updatedAt: now,
          })),
        ],
      }));
      if (cleanLines.length > 1) {
        showToast(`Added ${cleanLines.length} chapters`);
      }
    },
    [showToast, updateAndSave]
  );

  const handleUpdateChapter = useCallback(
    (chapterId: string, patch: Partial<Chapter>) => {
      const now = Date.now();
      updateAndSave((prev) => ({
        ...prev,
        chapters: prev.chapters.map((ch) =>
          ch.id === chapterId ? applyChapterUpdate(ch, patch, todayKey, now) : ch
        ),
      }));
    },
    [todayKey, updateAndSave]
  );

  const handleAddRevision = useCallback(
    (chapterId: string, date: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      const prev = stateRef.current;
      const targetCh = prev.chapters.find((c) => c.id === chapterId);
      if (!targetCh) return;
      const res = addChapterRevisionDate(targetCh, date, uid('rev'));
      if (res.duplicate) {
        showToast('Revision date already exists for this chapter');
        return;
      }
      const now = Date.now();
      updateAndSave((cur) => ({
        ...cur,
        chapters: cur.chapters.map((ch) =>
          ch.id === chapterId
            ? { ...addChapterRevisionDate(ch, date, uid('rev')).chapter, updatedAt: now }
            : ch
        ),
      }));
    },
    [showToast, updateAndSave]
  );

  const handleToggleRevisionDone = useCallback(
    (chapterId: string, revId: string) => {
      const now = Date.now();
      updateAndSave((prev) => ({
        ...prev,
        chapters: prev.chapters.map((ch) => {
          if (ch.id !== chapterId) return ch;
          return {
            ...ch,
            updatedAt: now,
            revisions: ch.revisions.map((r) =>
              r.id === revId
                ? {
                    ...r,
                    done: !r.done,
                    doneOn: !r.done ? todayKey : undefined,
                  }
                : r
            ),
          };
        }),
      }));
    },
    [todayKey, updateAndSave]
  );

  const handleUpdateRevisionDate = useCallback(
    (chapterId: string, revId: string, newDate: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return;
      const prev = stateRef.current;
      const targetCh = prev.chapters.find((c) => c.id === chapterId);
      if (!targetCh) return;
      const res = updateChapterRevisionDate(targetCh, revId, newDate);
      if (res.duplicate) {
        showToast('Revision date already exists for this chapter');
        return;
      }
      const now = Date.now();
      updateAndSave((cur) => ({
        ...cur,
        chapters: cur.chapters.map((ch) =>
          ch.id === chapterId
            ? { ...updateChapterRevisionDate(ch, revId, newDate).chapter, updatedAt: now }
            : ch
        ),
      }));
    },
    [showToast, updateAndSave]
  );

  const handleDeleteRevision = useCallback(
    (chapterId: string, revId: string) => {
      const now = Date.now();
      updateAndSave((prev) => ({
        ...prev,
        chapters: prev.chapters.map((ch) => {
          if (ch.id !== chapterId) return ch;
          return {
            ...ch,
            updatedAt: now,
            revisions: ch.revisions.filter((r) => r.id !== revId),
          };
        }),
      }));
    },
    [updateAndSave]
  );

  // F1: Delete chapter with item-only Undo at original index
  const handleDeleteChapter = useCallback(
    (chapterId: string) => {
      const prev = stateRef.current;
      const index = prev.chapters.findIndex((ch) => ch.id === chapterId);
      if (index === -1) return;
      const record: DeletedEntityRecord = {
        kind: 'chapter',
        item: JSON.parse(JSON.stringify(prev.chapters[index])),
        index,
      };
      updateAndSave((cur) => ({
        ...addTombstone(cur, chapterId),
        chapters: cur.chapters.filter((ch) => ch.id !== chapterId),
      }));
      showToast('Chapter deleted', () => {
        updateAndSave((cur) => restoreDeletedItem(cur, record));
      });
    },
    [showToast, updateAndSave]
  );

  // F1: Delete mock test with item-only Undo at original index
  const handleDeleteMock = useCallback(
    (mockId: string) => {
      const prev = stateRef.current;
      const index = prev.mocks.findIndex((m) => m.id === mockId);
      if (index === -1) return;
      const record: DeletedEntityRecord = {
        kind: 'mock',
        item: JSON.parse(JSON.stringify(prev.mocks[index])),
        index,
      };
      updateAndSave((cur) => ({
        ...addTombstone(cur, mockId),
        mocks: cur.mocks.filter((m) => m.id !== mockId),
      }));
      setModal({ type: 'none' });
      showToast('Mock test deleted', () => {
        updateAndSave((cur) => restoreDeletedItem(cur, record));
      });
    },
    [showToast, updateAndSave]
  );

  // F1: Delete subject with item-only Undo at original index
  const handleDeleteSubject = useCallback(
    (subjectId: string) => {
      const prev = stateRef.current;
      const activeCount = prev.subjects.filter((s) => !s.arch).length;
      if (activeCount <= 1) {
        showToast('At least one active subject is required');
        return;
      }
      const index = prev.subjects.findIndex((s) => s.id === subjectId);
      if (index === -1) return;
      const record: DeletedEntityRecord = {
        kind: 'subject',
        item: JSON.parse(JSON.stringify(prev.subjects[index])),
        index,
      };
      updateAndSave((cur) => ({
        ...addTombstone(cur, subjectId),
        subjects: cur.subjects.filter((s) => s.id !== subjectId),
      }));
      showToast('Subject deleted', () => {
        updateAndSave((cur) => restoreDeletedItem(cur, record));
      });
    },
    [showToast, updateAndSave]
  );

  // Milestone 1.3: Mistake Log handlers (pure updaters + item-only Undo)
  const handleAddMistake = useCallback(
    (
      entry: Omit<MistakeEntry, 'id' | 'createdAt' | 'updatedAt' | 'resolved'>
    ) => {
      const now = Date.now();
      const newMistake: MistakeEntry = {
        id: uid('mis'),
        subjectId: entry.subjectId,
        chapterId: entry.chapterId,
        mockId: entry.mockId,
        dayKey: entry.dayKey || todayKey,
        reason: entry.reason,
        note: entry.note,
        resolved: false,
        createdAt: now,
        updatedAt: now,
      };
      updateAndSave((cur) => ({
        ...cur,
        mistakes: [...(cur.mistakes || []), newMistake],
      }));
      showToast('Mistake logged');
    },
    [showToast, todayKey, updateAndSave]
  );

  const handleToggleMistakeResolved = useCallback(
    (mistakeId: string) => {
      const now = Date.now();
      updateAndSave((cur) => ({
        ...cur,
        mistakes: (cur.mistakes || []).map((m) =>
          m.id === mistakeId
            ? { ...m, resolved: !m.resolved, updatedAt: now }
            : m
        ),
      }));
    },
    [updateAndSave]
  );

  const handleDeleteMistake = useCallback(
    (mistakeId: string) => {
      const prev = stateRef.current;
      const list = prev.mistakes || [];
      const index = list.findIndex((m) => m.id === mistakeId);
      if (index === -1) return;
      const record: DeletedEntityRecord = {
        kind: 'mistake',
        item: JSON.parse(JSON.stringify(list[index])),
        index,
      };
      updateAndSave((cur) => ({
        ...addTombstone(cur, mistakeId),
        mistakes: (cur.mistakes || []).filter((m) => m.id !== mistakeId),
      }));
      showToast('Mistake deleted', () => {
        updateAndSave((cur) => restoreDeletedItem(cur, record));
      });
    },
    [showToast, updateAndSave]
  );

  // Milestone 1.4: Doubt List handlers (pure updaters + item-only Undo)
  const handleAddDoubt = useCallback(
    (subjectId: string, text: string, chapterId?: string) => {
      const clean = text.trim().slice(0, 300);
      if (!clean) return;
      const now = Date.now();
      const doubt: Doubt = {
        id: uid('dbt'),
        subjectId,
        chapterId: chapterId || undefined,
        text: clean,
        createdAt: now,
        resolved: false,
        updatedAt: now,
      };
      updateAndSave((cur) => ({
        ...cur,
        doubts: [...(cur.doubts || []), doubt],
      }));
      showToast('Doubt added to queue');
    },
    [showToast, updateAndSave]
  );

  const handleToggleDoubtResolved = useCallback(
    (doubtId: string) => {
      const now = Date.now();
      updateAndSave((cur) => ({
        ...cur,
        doubts: (cur.doubts || []).map((d) =>
          d.id === doubtId
            ? {
                ...d,
                resolved: !d.resolved,
                resolvedAt: !d.resolved ? now : undefined,
                updatedAt: now,
              }
            : d
        ),
      }));
    },
    [updateAndSave]
  );

  const handleDeleteDoubt = useCallback(
    (doubtId: string) => {
      const prev = stateRef.current;
      const list = prev.doubts || [];
      const index = list.findIndex((d) => d.id === doubtId);
      if (index === -1) return;
      const record: DeletedEntityRecord = {
        kind: 'doubt',
        item: JSON.parse(JSON.stringify(list[index])),
        index,
      };
      updateAndSave((cur) => ({
        ...addTombstone(cur, doubtId),
        doubts: (cur.doubts || []).filter((d) => d.id !== doubtId),
      }));
      showToast('Doubt deleted', () => {
        updateAndSave((cur) => restoreDeletedItem(cur, record));
      });
    },
    [showToast, updateAndSave]
  );

  // Milestone 1.5: PYQ Tracker handlers (pure updaters + item-only Undo)
  const handleAddPYQ = useCallback(
    (chapterId: string, attempted: number, correct: number, dayKey: string) => {
      const att = Math.max(1, Math.round(attempted));
      const cor = Math.min(att, Math.max(0, Math.round(correct)));
      const now = Date.now();
      const entry: PYQEntry = {
        id: uid('pyq'),
        chapterId,
        dayKey: dayKey || todayKey,
        attempted: att,
        correct: cor,
        updatedAt: now,
      };
      updateAndSave((cur) => ({
        ...cur,
        pyq: [...(cur.pyq || []), entry],
      }));
      showToast(`Logged ${cor}/${att} PYQs`);
    },
    [showToast, todayKey, updateAndSave]
  );

  const handleDeletePYQ = useCallback(
    (pyqId: string) => {
      const prev = stateRef.current;
      const list = prev.pyq || [];
      const index = list.findIndex((p) => p.id === pyqId);
      if (index === -1) return;
      const record: DeletedEntityRecord = {
        kind: 'pyq',
        item: JSON.parse(JSON.stringify(list[index])),
        index,
      };
      updateAndSave((cur) => ({
        ...addTombstone(cur, pyqId),
        pyq: (cur.pyq || []).filter((p) => p.id !== pyqId),
      }));
      showToast('PYQ entry deleted', () => {
        updateAndSave((cur) => restoreDeletedItem(cur, record));
      });
    },
    [showToast, updateAndSave]
  );

  // Milestone 1.8, 1.9, 1.11, 1.12: Targets, Rest Days, Wellbeing, Burnout Dismissal
  const handleToggleRestDay = useCallback(
    (dayKey: string) => {
      const prev = stateRef.current;
      const res = toggleRestDay(prev, dayKey);
      if (!res.allowed) {
        showToast(res.reason || 'Monthly rest pass limit reached');
        return;
      }
      saveNextState(res.nextState);
      const isNowRest = res.nextState.restDays.includes(dayKey);
      showToast(
        isNowRest
          ? 'Rest Day pass activated — minimum-day streak protected'
          : 'Rest Day pass removed'
      );
    },
    [saveNextState, showToast]
  );

  const handleDismissBurnout = useCallback(() => {
    const until = addD(todayKey, 3);
    updateAndSave((cur) => ({
      ...cur,
      burnoutDismissedUntil: until,
    }));
  }, [todayKey, updateAndSave]);

  const handleUpdateWellbeing = useCallback(
    (dayKey: string, patch: Partial<WellbeingEntry>) => {
      const now = Date.now();
      updateAndSave((cur) => {
        const existing = cur.wellbeing?.[dayKey] || {};
        return {
          ...cur,
          wellbeing: {
            ...(cur.wellbeing || {}),
            [dayKey]: {
              ...existing,
              ...patch,
              updatedAt: now,
            },
          },
        };
      });
    },
    [updateAndSave]
  );

  const handleUpdateTargets = useCallback(
    (patch: Partial<SubjectTargets>) => {
      const now = Date.now();
      updateAndSave((cur) => ({
        ...cur,
        set: {
          ...cur.set,
          updatedAt: now,
          targets: {
            ...(cur.set.targets || {
              dailyMinutes: {},
              weeklyMinutes: {},
              minDayMinutes: 240,
              restPassesPerMonth: 4,
            }),
            ...patch,
          },
        },
      }));
    },
    [updateAndSave]
  );

  // Daily Task Handlers (pure updaters, item-only Undo, same beep/haptic as habit completion)
  const handleAddTask = useCallback(
    (title: string, dayKey: string, subjectId?: string) => {
      const task = createDailyTask(title, dayKey, subjectId, Date.now());
      if (!task) return;
      updateAndSave((cur) => ({
        ...cur,
        tasks: [...(cur.tasks || []), task],
      }));
    },
    [updateAndSave]
  );

  const handleToggleTask = useCallback(
    (taskId: string) => {
      const prev = stateRef.current;
      const target = (prev.tasks || []).find((t) => t.id === taskId);
      if (!target) return;
      const nowDone = !target.done;
      const now = Date.now();
      updateAndSave((cur) => ({
        ...cur,
        tasks: (cur.tasks || []).map((t) =>
          t.id === taskId
            ? {
                ...t,
                done: nowDone,
                doneAt: nowDone ? now : undefined,
                updatedAt: now,
              }
            : t
        ),
      }));
      beep(nowDone ? 'ok' : 'no', !!prev.set.snd);
    },
    [updateAndSave]
  );

  const handleEditTaskTitle = useCallback(
    (taskId: string, newTitle: string) => {
      const clean = newTitle.trim().slice(0, 140);
      if (!clean) return;
      const now = Date.now();
      updateAndSave((cur) => ({
        ...cur,
        tasks: (cur.tasks || []).map((t) =>
          t.id === taskId ? { ...t, title: clean, updatedAt: now } : t
        ),
      }));
    },
    [updateAndSave]
  );

  const handleChangeTaskDate = useCallback(
    (taskId: string, newDayKey: string) => {
      const cleanDate = newDayKey.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) return;
      const now = Date.now();
      updateAndSave((cur) => ({
        ...cur,
        tasks: (cur.tasks || []).map((t) =>
          t.id === taskId ? { ...t, dayKey: cleanDate, updatedAt: now } : t
        ),
      }));
    },
    [updateAndSave]
  );

  const handleDeleteTask = useCallback(
    (taskId: string) => {
      const prev = stateRef.current;
      const list = prev.tasks || [];
      const index = list.findIndex((t) => t.id === taskId);
      if (index === -1) return;
      const record: DeletedEntityRecord = {
        kind: 'task',
        item: JSON.parse(JSON.stringify(list[index])),
        index,
      };
      updateAndSave((cur) => ({
        ...addTombstone(cur, taskId),
        tasks: (cur.tasks || []).filter((t) => t.id !== taskId),
      }));
      showToast('Task deleted', () => {
        updateAndSave((cur) => restoreDeletedItem(cur, record));
      });
    },
    [showToast, updateAndSave]
  );

  const handleMoveTaskToToday = useCallback(
    (taskId: string) => {
      updateAndSave((cur) => moveUnfinishedTasksToToday(cur, todayKey, taskId));
    },
    [todayKey, updateAndSave]
  );

  const handleMoveAllUnfinishedToToday = useCallback(() => {
    updateAndSave((cur) => moveUnfinishedTasksToToday(cur, todayKey));
  }, [todayKey, updateAndSave]);

  // F4: Storage load failure screen (readyRef.current remains false so existing data is never overwritten)
  if (loadError) {
    return (
      <main
        id="v"
        style={{
          display: 'grid',
          placeItems: 'center',
          minHeight: '85vh',
          padding: '20px',
        }}
      >
        <div
          className="card"
          style={{
            maxWidth: '430px',
            width: '100%',
            padding: '22px',
            borderColor: 'rgba(239, 68, 68, 0.45)',
          }}
        >
          <h2 style={{ fontSize: '19px', marginBottom: '6px', color: '#f87171' }}>
            Your saved data could not be loaded
          </h2>
          <small style={{ display: 'block', marginBottom: '12px', lineHeight: 1.5 }}>
            Deep Hours paused startup so your stored study log is not overwritten. You can
            restore from the latest rolling backup, retry loading, or start fresh.
          </small>
          {backupRestoreMsg && (
            <small
              style={{
                display: 'block',
                marginBottom: '10px',
                color: '#fbbf24',
                fontWeight: 600,
              }}
            >
              {backupRestoreMsg}
            </small>
          )}
          <div style={{ display: 'grid', gap: '8px' }}>
            <button
              type="button"
              className="pri"
              onClick={async () => {
                setBackupRestoreMsg(null);
                const restored = await restoreFromLatestBackup();
                if (restored) {
                  hydrateLoadedState(restored);
                  persistState(restored);
                  showToast('Restored from last automatic backup');
                } else {
                  setBackupRestoreMsg(
                    'No rolling backup snapshot was found in IndexedDB.'
                  );
                }
              }}
            >
              Restore from last backup
            </button>
            <button
              type="button"
              onClick={() => {
                attemptLoadState();
              }}
            >
              Retry
            </button>
            {!confirmStartFresh ? (
              <button
                type="button"
                className="dg-btn"
                onClick={() => setConfirmStartFresh(true)}
              >
                Start fresh
              </button>
            ) : (
              <div
                className="stat-box"
                style={{
                  border: '1px solid rgba(239, 68, 68, 0.45)',
                  marginTop: '4px',
                }}
              >
                <small style={{ display: 'block', marginBottom: '8px', color: '#fca5a5' }}>
                  Are you sure you want to start fresh? This will overwrite unreadable
                  local storage with a new blank state.
                </small>
                <div className="row" style={{ gap: '8px' }}>
                  <button
                    type="button"
                    className="g"
                    onClick={() => setConfirmStartFresh(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="g dg"
                    onClick={() => {
                      const fresh = createBlankState();
                      readyRef.current = true;
                      hydrateLoadedState(fresh);
                      persistState(fresh);
                    }}
                  >
                    Confirm Start fresh
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    );
  }

  // A3: Show minimal loading splash until IndexedDB/localStorage hydration settles
  if (!ready) {
    return (
      <main
        id="v"
        style={{
          display: 'grid',
          placeItems: 'center',
          minHeight: '80vh',
          textAlign: 'center',
        }}
      >
        <div>
          <b style={{ fontSize: '18px' }}>⚡ Deep Hours</b>
          <small style={{ display: 'block', marginTop: '6px' }}>
            Loading your study log…
          </small>
        </div>
      </main>
    );
  }

  const todayStudyProg = getDailyStudyGoalProgress(state, todayKey, todayKey);
  const navRingR = 11.5;
  const navRingCirc = 2 * Math.PI * navRingR;
  const navRingOffset = navRingCirc * (1 - todayStudyProg.pct / 100);

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
            onQuickStartSession={(subjectId, heading, mode, chapterId) => {
              setTab('focus');
              startTimer(subjectId, heading, mode, undefined, chapterId);
            }}
            onNewDDay={() => setModal({ type: 'dday' })}
            onEditDDay={(id) => setModal({ type: 'dday', id })}
            onOpenManualSession={(defaultSubjectId, defaultChapterId) =>
              setModal({ type: 'manualSession', defaultSubjectId, defaultChapterId })
            }
            onDeleteSession={handleDeleteSession}
            onCompleteRevision={handleToggleRevisionDone}
            onRescheduleRevision={handleUpdateRevisionDate}
            onAddTask={handleAddTask}
            onToggleTask={handleToggleTask}
            onEditTaskTitle={handleEditTaskTitle}
            onChangeTaskDate={handleChangeTaskDate}
            onDeleteTask={handleDeleteTask}
            onMoveTaskToToday={handleMoveTaskToToday}
            onMoveAllUnfinishedToToday={handleMoveAllUnfinishedToToday}
            onToggleRestDay={handleToggleRestDay}
            onDismissBurnout={handleDismissBurnout}
            onUpdateWellbeing={handleUpdateWellbeing}
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

        {tab === 'prep' && (
          <PrepView
            state={state}
            todayKey={todayKey}
            subTab={prepSubTab}
            onChangeSubTab={setPrepSubTab}
            onAddChapters={handleAddChapters}
            onUpdateChapter={handleUpdateChapter}
            onDeleteChapter={handleDeleteChapter}
            onAddRevision={handleAddRevision}
            onToggleRevision={handleToggleRevisionDone}
            onUpdateRevisionDate={handleUpdateRevisionDate}
            onDeleteRevision={handleDeleteRevision}
            onOpenNewMock={() => setModal({ type: 'mock' })}
            onEditMock={(mockId) => setModal({ type: 'mock', id: mockId })}
            onDeleteMock={handleDeleteMock}
            onUpdateTargetScore={(target: number) => {
              updateAndSave((prev) => ({
                ...prev,
                set: { ...prev.set, targetMockScore: target },
              }));
            }}
            onAddMistake={handleAddMistake}
            onToggleMistakeResolved={handleToggleMistakeResolved}
            onDeleteMistake={handleDeleteMistake}
            onAddDoubt={(doubt) =>
              handleAddDoubt(doubt.subjectId, doubt.text, doubt.chapterId)
            }
            onToggleDoubtResolved={handleToggleDoubtResolved}
            onDeleteDoubt={handleDeleteDoubt}
            onAddPYQ={(entry) =>
              handleAddPYQ(entry.chapterId, entry.attempted, entry.correct, entry.dayKey)
            }
            onDeletePYQ={handleDeletePYQ}
            onStartChapterFocus={(
              subjectId: string,
              chapterId: string,
              chapterName: string
            ) => {
              setTab('focus');
              startTimer(subjectId, chapterName, undefined, undefined, chapterId);
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
            onSwitchTopic={(newSubId, newHeading, newChapId) => {
              if (state.activeTimer) {
                switchTopicMidSession(newSubId, newHeading, newChapId);
              }
            }}
            onSetMode={(m) => {
              updateAndSave((prev) => {
                const targetMins =
                  m === 'pomo'
                    ? prev.set.pomoWork || 25
                    : m === 'countdown'
                      ? prev.set.countdownMins || 45
                      : m === 'fullMock'
                        ? prev.set.fullMockMins || 200
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
                        mockSections:
                          m === 'fullMock'
                            ? prev.activeTimer.mockSections || []
                            : undefined,
                        sectionStartActiveMs:
                          m === 'fullMock'
                            ? prev.activeTimer.sectionStartActiveMs || 0
                            : undefined,
                      }
                    : null,
                };
              });
            }}
            onStartTimer={(subjectId, heading, mode, customTargetMins, chapterId) =>
              startTimer(subjectId, heading, mode, customTargetMins, chapterId)
            }
            onNextMockSection={handleNextMockSection}
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
            onOpenManualSession={(defaultSubjectId, defaultChapterId) =>
              setModal({ type: 'manualSession', defaultSubjectId, defaultChapterId })
            }
            onEditSession={(sesId) => setModal({ type: 'manualSession', id: sesId })}
          />
        )}

        {tab === 'stats' && (
          <StatsView
            state={state}
            sel={sel}
            todayKey={todayKey}
            subTab={statsSubTab}
            onChangeSubTab={setStatsSubTab}
            onEditSession={(sesId) => setModal({ type: 'manualSession', id: sesId })}
            onOpenManualSession={() => setModal({ type: 'manualSession' })}
            onToast={showToast}
          />
        )}

        {tab === 'more' && (
          <MoreView
            state={state}
            authUser={authUser}
            syncStatus={syncStatus}
            syncErrorMsg={syncErrorMsg}
            lastSyncedAt={lastSyncedAt ?? state.syncMeta?.lastSyncedAt}
            syncWritesToday={syncWritesToday}
            onSignInGoogle={async () => {
              try {
                await signInWithGoogleAccount();
              } catch (err) {
                showToast(
                  err instanceof Error ? err.message : 'Google sign-in could not start'
                );
              }
            }}
            onSignOutGoogle={async () => {
              await signOutGoogleAccount();
              showToast('Signed out of Cloud Sync');
            }}
            onSyncNow={async () => {
              const status = await runCloudSync({ forcePull: true });
              if (status === 'synced') {
                showToast('Cloud sync complete');
              } else if (status === 'paused-quota') {
                showToast('Cloud sync paused for today (daily write cap)');
              } else if (status === 'offline') {
                showToast('You are offline — changes saved locally');
              } else if (status === 'error') {
                showToast('Cloud sync failed — check Sync Notice for details');
              }
            }}
            onDeleteCloudData={async () => {
              if (!authUser) return;
              try {
                setSyncStatus('syncing');
                await deleteAllUserCloudData(authUser.uid);
                setSyncWritesToday(getSyncTodayWrites());
                setSyncStatus('synced');
                showToast('Deleted all your cloud data from Firestore');
              } catch (err) {
                setSyncStatus('error');
                showToast(
                  err instanceof Error
                    ? err.message
                    : 'Could not delete cloud data'
                );
              }
            }}
            onSelectAvatarEmoji={(emoji) => {
              const now = Date.now();
              updateAndSave((prev) => ({
                ...prev,
                set: { ...prev.set, avatarEmoji: emoji, updatedAt: now },
              }));
            }}
            onUpdateTargets={handleUpdateTargets}
            onNewHabit={() => setModal({ type: 'habit' })}
            onEditHabit={(id) => setModal({ type: 'habit', id })}
            onOpenManualSession={() => setModal({ type: 'manualSession' })}
            onAddSubject={(name, e, color) => {
              const now = Date.now();
              updateAndSave((prev) => ({
                ...prev,
                subjects: [
                  ...prev.subjects,
                  {
                    id: uid('sub'),
                    name,
                    e,
                    color,
                    dailyGoalMins: 60,
                    arch: 0,
                    todos: [],
                    updatedAt: now,
                  },
                ],
              }));
              showToast(`Added subject "${name}"`);
            }}
            onDeleteSubject={handleDeleteSubject}
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
              // A12: Confirm before changing dayResetHour and recomputing session dayKeys
              if (key === 'dayResetHour') {
                const newHr = Number(val);
                if (newHr === stateRef.current.set.dayResetHour) return;
                setModal({ type: 'confirmResetHour', newHour: newHr });
                return;
              }
              const now = Date.now();
              updateAndSave((prev) => ({
                ...prev,
                set: { ...prev.set, [key]: val, updatedAt: now },
              }));
            }}
            onExportJson={() => {
              const now = Date.now();
              const updated: PulseHabitState = {
                ...stateRef.current,
                exp: now,
              };
              saveNextState(updated);
              downloadFile(
                `deep-hours-backup-${todayKey}.json`,
                JSON.stringify(updated, null, 2),
                'application/json'
              );
            }}
            onExportCsv={() => {
              const cur = stateRef.current;
              const escCsv = (val: string): string => {
                const safe = /^[=+\-@]/.test(val) ? `'${val}` : val;
                return `"${safe.replace(/"/g, '""')}"`;
              };
              const rows = [
                'type,date,subject,heading_or_title,minutes_or_score,purity_or_accuracy_pct,note',
              ];
              cur.sessions.forEach((s) => {
                const sub = cur.subjects.find((x) => x.id === s.subjectId);
                const subName = sub ? sub.name : 'General';
                const heading = getSessionHeading(cur, s);
                rows.push(
                  `study_session,${s.dayKey},${escCsv(subName)},${escCsv(heading)},${Math.round(
                    s.activeMs / 60000
                  )},${s.purity || 100},${escCsv(s.note || '')}`
                );
              });
              cur.habits.forEach((h) =>
                Object.entries(cur.log[h.id] || {})
                  .sort()
                  .forEach(([k, e]) => {
                    rows.push(
                      `habit,${k},"Habit",${escCsv(h.name)},${e.v},100,""`
                    );
                  })
              );
              cur.mocks.forEach((m) => {
                const sc = computeMockScore(m, cur.subjects);
                rows.push(
                  `mock_test,${m.dayKey},"All Subjects",${escCsv(m.name)},${sc.totalScore},${
                    sc.accuracyPct
                  },${escCsv(m.note || '')}`
                );
              });
              cur.chapters.forEach((ch) => {
                const sub = cur.subjects.find((x) => x.id === ch.subjectId);
                const subName = sub ? sub.name : 'Subject';
                const revs = getSortedChapterRevisions(ch);
                if (revs.length === 0) {
                  rows.push(
                    `chapter,${ch.completedOn || ''},${escCsv(subName)},${escCsv(ch.name)},${
                      ch.confidence || 0
                    },100,${escCsv(`status:${ch.status}`)}`
                  );
                } else {
                  revs.forEach((r) => {
                    rows.push(
                      `chapter_revision,${r.date},${escCsv(subName)},${escCsv(
                        `${ch.name} (${r.label})`
                      )},${r.done ? 1 : 0},100,${escCsv(
                        r.done ? `done:${r.doneOn || r.date}` : 'pending'
                      )}`
                    );
                  });
                }
              });
              (cur.mistakes || []).forEach((m) => {
                const sub = cur.subjects.find((x) => x.id === m.subjectId);
                const subName = sub ? sub.name : 'Subject';
                rows.push(
                  `mistake,${m.dayKey},${escCsv(subName)},${escCsv(m.reason)},${
                    m.resolved ? 1 : 0
                  },100,${escCsv(m.note || '')}`
                );
              });
              (cur.doubts || []).forEach((d) => {
                const sub = cur.subjects.find((x) => x.id === d.subjectId);
                const subName = sub ? sub.name : 'Subject';
                const dateStr = logicalKey(d.createdAt, cur.set.dayResetHour ?? 4);
                rows.push(
                  `doubt,${dateStr},${escCsv(subName)},${escCsv(d.text)},${
                    d.resolved ? 1 : 0
                  },100,"${d.resolved ? 'resolved' : 'open'}"`
                );
              });
              (cur.pyq || []).forEach((p) => {
                const ch = cur.chapters.find((c) => c.id === p.chapterId);
                const sub = ch
                  ? cur.subjects.find((x) => x.id === ch.subjectId)
                  : undefined;
                const subName = sub ? sub.name : 'Subject';
                const chName = ch ? ch.name : p.chapterId;
                const acc =
                  p.attempted > 0 ? Math.round((p.correct / p.attempted) * 100) : 0;
                rows.push(
                  `pyq,${p.dayKey},${escCsv(subName)},${escCsv(chName)},${
                    p.attempted
                  },${acc},"correct:${p.correct}/${p.attempted}"`
                );
              });
              Object.entries(cur.wellbeing || {})
                .sort(([a], [b]) => a.localeCompare(b))
                .forEach(([dk, wb]) => {
                  rows.push(
                    `wellbeing,${dk},"Wellbeing","Sleep & Energy",${wb.sleep ?? 0},${
                      wb.energy ?? 0
                    },"sleep:${wb.sleep ?? '-'}h energy:${wb.energy ?? '-'}"`
                  );
                });
              (cur.restDays || []).forEach((dk) => {
                rows.push(`rest_day,${dk},"Rest Pass","Protected Rest Day",1,100,""`);
              });
              rows.push('date,task,done,subject');
              (cur.tasks || []).forEach((t) => {
                const sub = t.subjectId
                  ? cur.subjects.find((x) => x.id === t.subjectId)
                  : undefined;
                const subName = sub ? sub.name : '';
                rows.push(
                  `${t.dayKey},${escCsv(t.title)},${
                    t.done ? 'true' : 'false'
                  },${escCsv(subName)}`
                );
              });
              downloadFile(
                `deep-hours-export-${todayKey}.csv`,
                rows.join('\n'),
                'text/csv'
              );
            }}
            onImportJson={async (file) => {
              if (file.size > 10 * 1024 * 1024) {
                showToast('Backup file exceeds the 10 MB limit');
                return;
              }
              // F1: Keep whole-state snapshot for JSON import
              const snapJson = JSON.stringify(stateRef.current);
              try {
                const parsed = JSON.parse(await file.text());
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                  throw new Error('Invalid schema');
                }
                const restored = norm(parsed);
                const newToday = logicalKey(new Date(), restored.set.dayResetHour);
                const allDays = new Set<string>([
                  newToday,
                  ...restored.sessions.map((s) => s.dayKey),
                ]);
                syncStudyHabitsForDays(restored, allDays, newToday);
                setSel(newToday);
                saveNextState(restored);
                showToast('Full backup restored!', () => {
                  const reverted = norm(JSON.parse(snapJson));
                  saveNextState(reverted);
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
          title={`Today Study Progress: ${fmtHMShort(todayStudyProg.studiedMs)} / ${fmtHMShort(todayStudyProg.goalMs)} (${todayStudyProg.pct}%)`}
          onClick={() => {
            setTab('today');
            window.scrollTo(0, 0);
          }}
        >
          <span className="nav-today-icon-wrap">
            <svg
              className="nav-today-ring-svg"
              viewBox="0 0 28 28"
              aria-hidden="true"
            >
              <circle
                className="nav-today-ring-track"
                cx="14"
                cy="14"
                r={navRingR}
              />
              <circle
                className="nav-today-ring-prog"
                cx="14"
                cy="14"
                r={navRingR}
                strokeDasharray={navRingCirc.toFixed(1)}
                strokeDashoffset={navRingOffset.toFixed(1)}
              />
            </svg>
            <b>⚡</b>
          </span>
          Today
        </button>
        <button
          type="button"
          className={tab === 'prep' ? 'on' : ''}
          onClick={() => {
            setTab('prep');
            window.scrollTo(0, 0);
          }}
        >
          <b>🎯</b>Prep
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

      {/* Modals */}
      <Modals
        modal={modal}
        state={state}
        sel={sel}
        todayKey={todayKey}
        onClose={() => setModal({ type: 'none' })}
        onSaveHabit={(id, data: Partial<Habit>) => {
          updateAndSave((prev) => {
            const next: PulseHabitState = {
              ...prev,
              ob: 1,
              log: cloneLog(prev.log),
            };
            if (id) {
              next.habits = prev.habits.map((h) =>
                h.id === id ? { ...h, ...data, u: Date.now() } : h
              );
            } else {
              next.habits = [...prev.habits, mkHabit(data, todayKey)];
            }
            syncStudyHabitsForDays(next, [sel, todayKey], todayKey);
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
          // F1: Restore only deleted habit + its habit log at original index
          const prev = stateRef.current;
          const index = prev.habits.findIndex((x) => x.id === id);
          if (index === -1) return;
          const record: DeletedEntityRecord = {
            kind: 'habit',
            item: JSON.parse(JSON.stringify(prev.habits[index])),
            index,
            logEntries: prev.log[id]
              ? JSON.parse(JSON.stringify(prev.log[id]))
              : undefined,
          };
          updateAndSave((cur) => {
            const withTomb = addTombstone(cur, id);
            const nextLog = cloneLog(cur.log);
            delete nextLog[id];
            return {
              ...withTomb,
              habits: cur.habits.filter((x) => x.id !== id),
              log: nextLog,
            };
          });
          setModal({ type: 'none' });
          showToast('Habit deleted', () => {
            const cur = stateRef.current;
            const restored = restoreDeletedItem(cur, record);
            const curToday = logicalKey(new Date(), restored.set.dayResetHour ?? 4);
            syncStudyHabitsForDays(restored, [sel, curToday], curToday);
            saveNextState(restored);
          });
        }}
        onSubmitReflection={(subjectId, heading, rating, note, chapterId) => {
          const prev = stateRef.current;
          const { next } = commitSliceInState(prev, Date.now(), {
            subjectId,
            chapterId,
            heading,
            rating,
            note,
          });
          const updated: PulseHabitState = {
            ...next,
            activeTimer: null,
          };
          saveNextState(updated);
          closePiP();
          beep('win', !!updated.set.snd);
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
          const prev = stateRef.current;
          const oldSession = id ? prev.sessions.find((x) => x.id === id) : undefined;
          const payload: StudySession = {
            id: id || uid('ses'),
            ...sessionData,
          };
          const nextSessions = id
            ? prev.sessions.map((x) => (x.id === id ? payload : x))
            : [...prev.sessions, payload];
          const next: PulseHabitState = {
            ...prev,
            log: cloneLog(prev.log),
            sessions: nextSessions,
          };
          // A5: Re-sync study habits for both old dayKey (if edited) and new dayKey
          syncStudyHabitsForDays(
            next,
            [oldSession?.dayKey, payload.dayKey, sel, todayKey],
            todayKey
          );
          saveNextState(next);
          setModal({ type: 'none' });
          showToast(`Logged "${sessionData.heading || 'Study Session'}"`);
        }}
        onDeleteSession={(id) => {
          handleDeleteSession(id);
          setModal({ type: 'none' });
        }}
        onSaveMock={(id, mockData, queuedMistakes) => {
          const now = Date.now();
          const payload: MockTest = {
            id: id || uid('mock'),
            ...mockData,
            marksPerWrong: -Math.abs(Number(mockData.marksPerWrong) || 0),
            updatedAt: now,
          };
          const newMistakes: MistakeEntry[] = (queuedMistakes || []).map((qm) => ({
            id: uid('mis'),
            subjectId: qm.subjectId,
            chapterId: qm.chapterId,
            mockId: payload.id,
            dayKey: payload.dayKey,
            reason: qm.reason,
            note: qm.note,
            resolved: false,
            createdAt: now,
            updatedAt: now,
          }));
          updateAndSave((prev) => ({
            ...prev,
            mocks: id
              ? prev.mocks.map((m) => (m.id === id ? payload : m))
              : [...prev.mocks, payload],
            mistakes:
              newMistakes.length > 0
                ? [...(prev.mistakes || []), ...newMistakes]
                : prev.mistakes || [],
          }));
          setModal({ type: 'none' });
          const sc = computeMockScore(payload, stateRef.current.subjects);
          showToast(
            `Saved "${payload.name}" (${sc.totalScore}/${payload.maxMarks})${
              newMistakes.length > 0 ? ` + ${newMistakes.length} mistakes` : ''
            }`
          );
        }}
        onDeleteMock={handleDeleteMock}
        onSaveTimerConfig={(pomoWork, pomoBreak, countdownMins, fullMockMins) => {
          updateAndSave((prev) => ({
            ...prev,
            set: {
              ...prev.set,
              pomoWork,
              pomoBreak,
              countdownMins,
              fullMockMins: fullMockMins ?? prev.set.fullMockMins ?? 200,
            },
          }));
          setModal({ type: 'none' });
        }}
        onSaveDDay={(id, data: Omit<DDay, 'id'>) => {
          const cleanTitle = (data.title || '').trim();
          if (!cleanTitle || !/^\d{4}-\d{2}-\d{2}$/.test(data.date || '')) return;
          const now = Date.now();
          updateAndSave((prev) => {
            const targetId = id || uid('dd');
            const isPrimary = Boolean(data.primary);
            const baseList = id
              ? prev.ddays.map((d) =>
                  d.id === id
                    ? { ...d, ...data, title: cleanTitle, updatedAt: now }
                    : isPrimary
                      ? { ...d, primary: false, updatedAt: now }
                      : d
                )
              : [
                  ...prev.ddays.map((d) =>
                    isPrimary ? { ...d, primary: false, updatedAt: now } : d
                  ),
                  { id: targetId, ...data, title: cleanTitle, updatedAt: now },
                ];
            return {
              ...prev,
              ddays: baseList,
            };
          });
          setModal({ type: 'none' });
          showToast(`Saved countdown "${cleanTitle}"`);
        }}
        onDeleteDDay={(id) => {
          // F1: Restore only deleted D-Day at original index
          const prev = stateRef.current;
          const index = prev.ddays.findIndex((x) => x.id === id);
          if (index === -1) return;
          const record: DeletedEntityRecord = {
            kind: 'dday',
            item: JSON.parse(JSON.stringify(prev.ddays[index])),
            index,
          };
          updateAndSave((cur) => ({
            ...addTombstone(cur, id),
            ddays: cur.ddays.filter((x) => x.id !== id),
          }));
          setModal({ type: 'none' });
          showToast('Countdown deleted', () => {
            updateAndSave((cur) => restoreDeletedItem(cur, record));
          });
        }}
        onConfirmResetHour={(newHour) => {
          // A12: Recompute dayKey for all sessions and re-sync study habits for all affected days
          const prev = stateRef.current;
          const affectedDays = new Set<string>([sel, todayKey]);
          const updatedSessions = prev.sessions.map((s) => {
            affectedDays.add(s.dayKey);
            const nextDayKey = logicalKey(s.startTs, newHour);
            affectedDays.add(nextDayKey);
            return { ...s, dayKey: nextDayKey };
          });
          const newToday = logicalKey(new Date(), newHour);
          affectedDays.add(newToday);

          const next: PulseHabitState = {
            ...prev,
            set: { ...prev.set, dayResetHour: newHour },
            log: cloneLog(prev.log),
            sessions: updatedSessions,
          };
          syncStudyHabitsForDays(next, affectedDays, newToday);
          saveNextState(next);
          setSel(newToday);
          setModal({ type: 'none' });
          showToast(`Day reset hour set to ${pad(newHour)}:00 AM`);
        }}
        onConfirmReset={() => {
          // F1 & A6: Keep whole-state snapshot for "Erase all data"
          const snapJson = JSON.stringify(stateRef.current);
          const fresh = createBlankState();
          const newToday = logicalKey(new Date(), fresh.set.dayResetHour);
          saveNextState(fresh);
          setSel(newToday);
          setModal({ type: 'none' });
          showToast('All device data reset to a clean slate', () => {
            const reverted = norm(JSON.parse(snapJson));
            saveNextState(reverted);
          });
        }}
      />

      {/* Lightweight SVG Perfect Day Celebration Overlay */}
      {perfectDayBanner && (
        <div
          className="perfect-day-overlay"
          role="dialog"
          aria-label="Perfect Day Celebration"
          onClick={() => setPerfectDayBanner(false)}
        >
          <div className="perfect-day-card">
            <div className="pd-svg-wrap">
              <svg
                viewBox="0 0 120 120"
                width="96"
                height="96"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id="pdGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#34d399" />
                    <stop offset="50%" stopColor="#38bdf8" />
                    <stop offset="100%" stopColor="#fbbf24" />
                  </linearGradient>
                </defs>
                <g className="pd-rays" stroke="url(#pdGrad)" strokeWidth="2.5" strokeLinecap="round" opacity="0.55">
                  <line x1="60" y1="4" x2="60" y2="14" />
                  <line x1="60" y1="106" x2="60" y2="116" />
                  <line x1="4" y1="60" x2="14" y2="60" />
                  <line x1="106" y1="60" x2="116" y2="60" />
                  <line x1="20" y1="20" x2="28" y2="28" />
                  <line x1="92" y1="92" x2="100" y2="100" />
                  <line x1="100" y1="20" x2="92" y2="28" />
                  <line x1="28" y1="92" x2="20" y2="100" />
                </g>
                <circle
                  cx="60"
                  cy="60"
                  r="38"
                  fill="rgba(16, 185, 129, 0.16)"
                  stroke="url(#pdGrad)"
                  strokeWidth="4.5"
                  strokeLinecap="round"
                  className="pd-ring-circle"
                />
                <path
                  d="M44 61 L55 72 L77 48"
                  fill="none"
                  stroke="#f8fafc"
                  strokeWidth="5.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="pd-check-path"
                />
              </svg>
            </div>
            <span
              className="pill"
              style={{
                background: 'rgba(16, 185, 129, 0.2)',
                borderColor: 'rgba(52, 211, 153, 0.5)',
                color: '#6ee7b7',
                marginBottom: '8px',
              }}
            >
              ✨ 100% Daily Goal Achieved
            </span>
            <h3 style={{ fontSize: '21px', marginBottom: '4px', color: '#f8fafc' }}>
              Perfect Day Unlocked! 🎉
            </h3>
            <small style={{ color: '#cbd5e1', display: 'block' }}>
              Every scheduled habit for this day is complete. Keep the streak alive!
            </small>
          </div>
        </div>
      )}

      {/* Toast Notification (supports Undo or Service Worker tap-to-reload) */}
      {toastState && (
        <div
          id="toast"
          role="status"
          style={toastState.onTap ? { cursor: 'pointer' } : undefined}
          onClick={() => {
            if (toastState.onTap) {
              toastState.onTap();
            }
          }}
        >
          <span>{toastState.msg}</span>
          {toastState.undoFn && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toastState.undoFn?.();
                setToastState(null);
              }}
            >
              Undo
            </button>
          )}
          {toastState.onTap && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toastState.onTap?.();
              }}
            >
              {toastState.actionLabel || 'Reload'}
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
        {...({ autopictureinpicture: '' } as React.VideoHTMLAttributes<HTMLVideoElement>)}
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
