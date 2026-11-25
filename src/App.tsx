/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  UserProfile,
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
import { computeMinDayStreak, toggleRestDay } from './utils/insights';
import { computeLevelInfo, computeTotalXp } from './utils/xp';
import {
  attachNormalizedTargetsAndReminders,
  createCustomReminder,
  createDeadlineTarget,
  isValidDateKey,
  isValidTime24h,
  normalizeLeadDays,
} from './utils/targetsLogic';
import { sanitizeTextControlChars } from './utils/security';
import type {
  ReminderDraftInput,
  TargetDraftInput,
} from './components/TargetsCalendarView';
import {
  SETTINGS_SECTION_META,
  resolveReturnTab,
  type MainNavTab,
  type SettingsSectionId,
} from './utils/navHelpers';
import {
  clearAllMockDiagnostics,
  deleteMockDiagnostic,
  getMockDiagnostic,
  loadAllMockDiagnostics,
  replaceAllMockDiagnostics,
  saveMockDiagnostic,
} from './utils/mockDiagnostics';
import {
  deleteMockLeaks,
  getMockLeaks,
  hasAnyMockLeaks,
  saveMockLeaks,
} from './utils/mockLeaks';
import {
  buildCoreMockSubjectsFromReport,
  clearAllMockReportDetails,
  deleteMockReportDetails,
  getMockReportDetails,
  loadAllMockReportDetails,
  saveMockReportDetails,
  type MockReportDetails,
} from './utils/mockReport';
import type {
  ActiveSessionAura,
  GroupLiveStatus,
  GroupPublishBudgetController,
  LiveAuraPresenceController,
} from './utils/groups';
import type { SyncBudgetController } from './utils/cloudSync';
import { emitTimerTick } from './utils/timerTicker';
import {
  ALL_SUBJECTS_COLOR,
  ALL_SUBJECTS_LABEL,
  ALL_SUBJECTS_MOCK_ID,
  buildExamHallStudySession,
  hasLoggedExamHallRecord,
  isAllSubjectsMockId,
  markExamHallRecordLogged,
} from './utils/focusSessionHelpers';
import {
  buildDailyProofPayload,
  formatProofDateLabel,
  type ProofCardPayload,
} from './utils/proofCardCanvas';
import {
  loadInitialState,
  persistState,
  restoreFromLatestBackup,
  subscribeBroadcast,
  writeSafetyBackupSnapshot,
} from './utils/storage';
import {
  beep,
  ensureAudioEngine,
  playSoundCue,
  setSoundscapeVolume,
  stopAmbientMixer,
  syncAmbientMixer,
} from './utils/audioEngine';
import {
  AMBIENT_MIXER_EVENT,
  hasActiveAmbientAudio,
  loadAmbientMixerState,
  type AmbientMixerState,
} from './utils/ambientMixer';
import { useFloatingTimerPiP } from './hooks/useFloatingTimerPiP';
import { useWakeLock } from './hooks/useWakeLock';
import {
  LUMEN_ACCENT,
  getAmoledPref,
  getReadableAccentText,
  getReadableOnColor,
  getUiDailyStudyGoalProgress,
  setAmoledPref,
} from './utils/uiHelpers';
import { AppShell } from './components/AppShell';
import { ErrorBoundary } from './components/ErrorBoundary';
import { QuickActionsSheet, type QuickActionKind } from './components/QuickActionsSheet';
import { Skeleton, Toast } from './components/ui';
import { TodayView } from './components/TodayView';
import {
  createCooldownGuard,
  encodeCsvRow,
  onStorageQuotaExceeded,
  safeJsonParseStrict,
  safeLocalStorageSet,
  sanitizeImportedStatePayload,
} from './utils/security';
import { Modals, type ModalState } from './components/Modals';
import { CommandPalette } from './components/CommandPalette';
import { KeyboardShortcutsSheet } from './components/KeyboardShortcutsSheet';
import type { OnboardingResult } from './components/OnboardingSheet';
import type { SettingsSection } from './components/SettingsView';
import { SettingsDrawer } from './components/SettingsDrawer';
import { ProofCardSheet } from './components/ProofCardSheet';
import { StreakDetailSheet } from './components/StatusRow';
import type { VaultCaptureRequest } from './components/VaultView';
import { SessionWrapUpSheet } from './components/SessionWrapUpSheet';
import { clearAllVaultData, ensurePersistentStorage } from './utils/vaultStore';
import {
  buildSessionWrapUpSummary,
  shouldOpenSessionWrapUp,
  type SessionWrapUpSummary,
} from './utils/sessionWrapUp';
import {
  addParkedThought,
  buildTaskPayloadFromThought,
  loadParkedThoughts,
  removeParkedThought,
  saveParkedThoughts,
  type ParkedThought,
} from './utils/parkingLot';
import { formatExamRecordNote, type ExamPaceRecord } from './utils/examClock';
import {
  detectRewardMilestone,
  type RewardMilestonePayload,
} from './utils/scene3dHelpers';

let cloudSyncCache: typeof import('./utils/cloudSync') | null = null;
let cloudSyncPromise: Promise<typeof import('./utils/cloudSync')> | null = null;
function getCloudSyncMod() {
  if (cloudSyncCache) return Promise.resolve(cloudSyncCache);
  if (!cloudSyncPromise) {
    cloudSyncPromise = import('./utils/cloudSync').then((mod) => {
      cloudSyncCache = mod;
      return mod;
    });
  }
  return cloudSyncPromise;
}

let groupsCache: typeof import('./utils/groups') | null = null;
let groupsPromise: Promise<typeof import('./utils/groups')> | null = null;
function getGroupsMod() {
  if (groupsCache) return Promise.resolve(groupsCache);
  if (!groupsPromise) {
    groupsPromise = import('./utils/groups').then((mod) => {
      groupsCache = mod;
      return mod;
    });
  }
  return groupsPromise;
}

const FocusView = React.lazy(() =>
  import('./components/FocusView').then((m) => ({ default: m.FocusView }))
);
const ProfileModal = React.lazy(() =>
  import('./components/ProfileModal').then((m) => ({ default: m.ProfileModal }))
);
const PrepView = React.lazy(() =>
  import('./components/PrepView').then((m) => ({ default: m.PrepView }))
);
const GroupsView = React.lazy(() =>
  import('./components/GroupsView').then((m) => ({ default: m.GroupsView }))
);
const StatsView = React.lazy(() =>
  import('./components/StatsView').then((m) => ({ default: m.StatsView }))
);
const SettingsView = React.lazy(() =>
  import('./components/SettingsView').then((m) => ({ default: m.SettingsView }))
);
const OnboardingSheet = React.lazy(() =>
  import('./components/OnboardingSheet').then((m) => ({ default: m.OnboardingSheet }))
);
const RewardBurstDialog = React.lazy(() =>
  import('./components/three/RewardBurstDialog').then((m) => ({
    default: m.RewardBurstDialog,
  }))
);

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
      await reg.showNotification(title, { body, icon: '/icon-512.png', tag: 'ph' });
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
  const [pyqJumpNonce, setPyqJumpNonce] = useState<number>(0);
  const [vaultCaptureRequest, setVaultCaptureRequest] =
    useState<VaultCaptureRequest | null>(null);
  const [targetComposerRequest, setTargetComposerRequest] = useState<{
    kind: 'target' | 'reminder';
    nonce: number;
  } | null>(null);
  const [sessionWrapUp, setSessionWrapUp] = useState<SessionWrapUpSummary | null>(null);
  const [parkedThoughts, setParkedThoughts] = useState<ParkedThought[]>(() =>
    loadParkedThoughts()
  );
  const [statsSubTab, setStatsSubTab] = useState<StatsSubTab>('summary');
  const [sel, setSel] = useState<string>(() => logicalKey(new Date(), 0));
  const [cat, setCat] = useState<'All' | HabitCategory>('All');
  const [deskMode, setDeskMode] = useState(false);
  const [modal, setModal] = useState<ModalState>({ type: 'none' });
  const [toastState, setToastState] = useState<{
    msg: string;
    undoFn?: () => void;
    actionLabel?: string;
    onTap?: () => void;
  } | null>(null);
  const [rewardBurst, setRewardBurst] = useState<RewardMilestonePayload | null>(null);
  const [dayRolloverKey, setDayRolloverKey] = useState<string>(() =>
    logicalKey(new Date(), 0)
  );

  // Milestone 2: Firebase Auth & Cloud Sync state
  const [authUser, setAuthUser] = useState<{
    uid: string;
    email: string | null;
    displayName: string | null;
  } | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('off');
  const [syncErrorMsg, setSyncErrorMsg] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | undefined>(undefined);
  const [syncWritesToday, setSyncWritesToday] = useState<number>(0);
  const [groupBudgetReady, setGroupBudgetReady] = useState<boolean>(false);
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' && 'onLine' in navigator ? navigator.onLine : true
  );
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profilePromptReason, setProfilePromptReason] = useState<string | undefined>(
    undefined
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null);
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false);
  const [previousTab, setPreviousTab] = useState<MainNavTab>('today');
  const [streakSheetOpen, setStreakSheetOpen] = useState(false);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [amoled, setAmoled] = useState<boolean>(() => getAmoledPref());

  const openSettingsSection = useCallback(
    (section: SettingsSectionId) => {
      if (!settingsOpen && tab !== 'more') {
        setPreviousTab(resolveReturnTab(tab));
      }
      setSettingsDrawerOpen(false);
      setSettingsSection(section);
      setSettingsOpen(true);
      window.scrollTo(0, 0);
    },
    [settingsOpen, tab]
  );

  const closeSettingsAndReturn = useCallback(() => {
    setSettingsOpen(false);
    setSettingsSection(null);
    setTab(previousTab);
    window.scrollTo(0, 0);
  }, [previousTab]);

  const handleToggleAmoled = useCallback((enabled: boolean) => {
    setAmoledPref(enabled);
    setAmoled(enabled);
  }, []);

  const switchTabWithTransition = useCallback((nextTab: AppTab) => {
    const apply = () => {
      setSettingsDrawerOpen(false);
      setSettingsOpen(false);
      setSettingsSection(null);
      setTab(nextTab);
    };
    const docWithTransition = document as Document & {
      startViewTransition?: (cb: () => void) => void;
    };
    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reducedMotion && typeof docWithTransition.startViewTransition === 'function') {
      try {
        docWithTransition.startViewTransition(apply);
        return;
      } catch {
        // Fallback if startViewTransition fails
      }
    }
    apply();
  }, []);

  const readyRef = useRef(false);
  const stateRef = useRef<PulseHabitState>(state);
  stateRef.current = state;
  const authUserRef = useRef(authUser);
  authUserRef.current = authUser;
  const syncControllerRef = useRef<SyncBudgetController | null>(null);
  const liveStatusRef = useRef<GroupLiveStatus | null>(null);
  const groupBudgetRef = useRef<GroupPublishBudgetController | null>(null);

  const [proofCardPayload, setProofCardPayload] = useState<ProofCardPayload | null>(null);
  const [liveAuraEnabled, setLiveAuraEnabled] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem('dh_live_aura_enabled_v1');
      if (raw === null) return true;
      return raw !== '0' && raw !== 'false';
    } catch {
      return true;
    }
  });
  const liveAuraEnabledRef = useRef<boolean>(liveAuraEnabled);
  liveAuraEnabledRef.current = liveAuraEnabled;
  const [examHallPresence, setExamHallPresence] = useState<{
    running: boolean;
    startedAt: number;
  } | null>(null);
  const publishedAuraRef = useRef<ActiveSessionAura | null>(null);
  const auraControllerRef = useRef<LiveAuraPresenceController | null>(null);

  const ensureGroupBudget = useCallback(async (): Promise<GroupPublishBudgetController> => {
    if (groupBudgetRef.current) return groupBudgetRef.current;
    const gm = await getGroupsMod();
    if (!groupBudgetRef.current) {
      groupBudgetRef.current = new gm.GroupPublishBudgetController(async (groupId) => {
        if (!authUserRef.current || !readyRef.current || !groupBudgetRef.current) return;
        const curState = stateRef.current;
        const joined = curState.groupsConfig?.joined?.find((j) => j.groupId === groupId);
        if (!joined) return;
        const curToday = logicalKey(new Date(), curState.set.dayResetHour ?? 0);
        const auraForGroup =
          joined.sh.l && !joined.paused && liveAuraEnabledRef.current
            ? publishedAuraRef.current
            : null;
        await gm.publishMyEntryToGroup({
          groupId,
          state: curState,
          todayKey: curToday,
          joinedAt: joined.joinedAt,
          sh: joined.sh,
          paused: joined.paused,
          live: null,
          activeSession: auraForGroup,
          budget: groupBudgetRef.current,
        });
      });
      setGroupBudgetReady(true);
    }
    return groupBudgetRef.current;
  }, []);

  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRemindersRef = useRef<Set<string>>(new Set());
  const parkedThoughtsRef = useRef<ParkedThought[]>(parkedThoughts);
  parkedThoughtsRef.current = parkedThoughts;
  const waitingSwRef = useRef<ServiceWorker | null>(null);
  const swReloadRequestedRef = useRef(false);

  const todayKey = logicalKey(new Date(), state.set.dayResetHour ?? 0);
  void dayRolloverKey;
  const prevTodayKeyRef = useRef(todayKey);

  const topBarStreakInfo = useMemo(
    () => computeMinDayStreak(state, todayKey),
    [state, todayKey]
  );
  const topBarTotalXp = useMemo(
    () => computeTotalXp(state, todayKey),
    [state, todayKey]
  );
  const topBarLevelInfo = useMemo(
    () => computeLevelInfo(topBarTotalXp),
    [topBarTotalXp]
  );
  const topBarXpProgressPct = Math.min(
    100,
    Math.max(
      0,
      Math.round(
        (topBarLevelInfo.xpIntoLevel / Math.max(1, topBarLevelInfo.xpNeededForNext)) * 100
      )
    )
  );

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

  useEffect(() => {
    const onFpsDowngrade = () => {
      showToast('Switched 3D quality to Lite for smooth battery performance');
    };
    window.addEventListener('dh-3d-fps-downgrade', onFpsDowngrade);
    return () => {
      window.removeEventListener('dh-3d-fps-downgrade', onFpsDowngrade);
    };
  }, [showToast]);

  // A3 & A4: Never persist before initial IndexedDB load completes, and never run side effects inside setState
  const saveNextState = useCallback(
    (next: PulseHabitState, opts?: { suppressMilestones?: boolean }) => {
      const prev = stateRef.current;
      const stamped: PulseHabitState = {
        ...next,
        savedAt: Date.now(),
      };
      stateRef.current = stamped;
      setState(stamped);
      if (readyRef.current) {
        if (!opts?.suppressMilestones) {
          const curTodayForMilestone = logicalKey(
            new Date(),
            stamped.set.dayResetHour ?? 0
          );
          const milestone = detectRewardMilestone(
            prev,
            stamped,
            curTodayForMilestone
          );
          if (milestone) {
            beep('win', !!stamped.set.snd);
            setRewardBurst(milestone);
          }
        }
        persistState(stamped);
      if (cloudSyncCache) {
        const dirtyKeys = cloudSyncCache.detectDirtyDocKeys(prev, next);
        if (dirtyKeys.length > 0) {
          cloudSyncCache.addDirtyDocsToOutbox(dirtyKeys);
          if (authUserRef.current && syncControllerRef.current) {
            syncControllerRef.current.markDirty(dirtyKeys);
          }
        }
      } else {
        void getCloudSyncMod().then((cs) => {
          const dirtyKeys = cs.detectDirtyDocKeys(prev, next);
          if (dirtyKeys.length > 0) {
            cs.addDirtyDocsToOutbox(dirtyKeys);
            if (authUserRef.current && syncControllerRef.current) {
              syncControllerRef.current.markDirty(dirtyKeys);
            }
          }
        });
      }
      // Queue debounced group stats publish for joined groups when relevant stats change
      // (Live aura start/stop is managed separately by the 15s-debounced zero-heartbeat controller)
      if (authUserRef.current) {
        const joinedList = stamped.groupsConfig?.joined || [];
        if (joinedList.length > 0) {
          const prevActive = prev.activeTimer;
          const nextActive = stamped.activeTimer;
          const justStoppedTimer = Boolean(
            prevActive &&
              prevActive.phase !== 'break' &&
              (!nextActive || nextActive.phase === 'break')
          );

          const curToday = logicalKey(new Date(), stamped.set.dayResetHour ?? 0);
          const activeAura = liveAuraEnabledRef.current
            ? publishedAuraRef.current
            : null;

          if (groupsCache && groupBudgetRef.current) {
            const immediateGroupIds: string[] = [];
            for (const g of joinedList) {
              const entry = groupsCache.buildMyMemberEntry(stamped, curToday, {
                joinedAt: g.joinedAt,
                sh: g.sh,
                paused: g.paused,
                live: null,
                activeSession: g.sh.l && !g.paused ? activeAura : null,
                groupId: g.groupId,
              });
              groupBudgetRef.current.markGroupDirty(g.groupId, entry);
              if (justStoppedTimer && !g.paused) {
                immediateGroupIds.push(g.groupId);
              }
            }
            if (immediateGroupIds.length > 0) {
              void groupBudgetRef.current.flushNow(immediateGroupIds);
            }
          } else {
            void Promise.all([getGroupsMod(), ensureGroupBudget()]).then(
              ([gm, budget]) => {
                const latest = stateRef.current;
                const latestToday = logicalKey(
                  new Date(),
                  latest.set.dayResetHour ?? 0
                );
                const latestAura = liveAuraEnabledRef.current
                  ? publishedAuraRef.current
                  : null;
                const immediateGroupIds: string[] = [];
                for (const g of latest.groupsConfig?.joined || []) {
                  const entry = gm.buildMyMemberEntry(latest, latestToday, {
                    joinedAt: g.joinedAt,
                    sh: g.sh,
                    paused: g.paused,
                    live: null,
                    activeSession: g.sh.l && !g.paused ? latestAura : null,
                    groupId: g.groupId,
                  });
                  budget.markGroupDirty(g.groupId, entry);
                  if (justStoppedTimer && !g.paused) {
                    immediateGroupIds.push(g.groupId);
                  }
                }
                if (immediateGroupIds.length > 0) {
                  void budget.flushNow(immediateGroupIds);
                }
              }
            );
          }
        }
      }
    }
  }, [ensureGroupBudget]);

  const updateAndSave = useCallback(
    (updater: (prev: PulseHabitState) => PulseHabitState) => {
      const prev = stateRef.current;
      const draft = updater(prev);
      const next: PulseHabitState = {
        ...draft,
        log: cloneLog(draft.log),
      };
      const curToday = logicalKey(new Date(), next.set.dayResetHour ?? 0);
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
    const curToday = logicalKey(new Date(), next.set.dayResetHour ?? 0);
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
      const targetSw = worker || waitingSwRef.current;
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
    [showToast]
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

    void ensurePersistentStorage();

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          if (!mounted) return;
          const notifyWaiting = (sw: ServiceWorker) => {
            if (!mounted) return;
            waitingSwRef.current = sw;
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

  // A7: Idle day-rollover check every 30s — only updates React state when logical day actually changes
  useEffect(() => {
    const id = setInterval(() => {
      const nextToday = logicalKey(
        new Date(),
        stateRef.current.set.dayResetHour ?? 0
      );
      setDayRolloverKey((prev) => (prev === nextToday ? prev : nextToday));
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

  // Theme & AMOLED & accessible accent token application
  useEffect(() => {
    const applyTheme = () => {
      const t: 'light' | 'dark' =
        state.set.theme === 'auto'
          ? window.matchMedia('(prefers-color-scheme:light)').matches
            ? 'light'
            : 'dark'
          : state.set.theme;
      const isAmoled = t === 'dark' && amoled;
      document.documentElement.dataset.t = t;
      document.documentElement.dataset.amoled = isAmoled ? '1' : '0';

      const customAcSet =
        typeof window !== 'undefined' &&
        window.localStorage.getItem('dh_custom_ac') === '1';
      const activeAccent =
        !state.set.ac ||
        (state.set.ac.toLowerCase() === '#38bdf8' && !customAcSet)
          ? LUMEN_ACCENT
          : state.set.ac;
      document.documentElement.style.setProperty('--ac', activeAccent);
      document.documentElement.style.setProperty(
        '--ac-on',
        getReadableOnColor(activeAccent)
      );
      document.documentElement.style.setProperty(
        '--ac-ink',
        getReadableAccentText(activeAccent, t)
      );

      const metaTheme = document.querySelector('meta[name=theme-color]');
      if (metaTheme) {
        metaTheme.setAttribute(
          'content',
          t === 'light' ? '#F6F4EF' : '#000000'
        );
      }
    };
    applyTheme();
    const mq = window.matchMedia('(prefers-color-scheme:light)');
    mq.addEventListener('change', applyTheme);
    return () => mq.removeEventListener('change', applyTheme);
  }, [state.set.theme, state.set.ac, amoled]);

  // Handle PWA shortcut query params (?shortcut=start | ?shortcut=task) once hydrated
  useEffect(() => {
    if (!ready || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const shortcut = params.get('shortcut');
    if (!shortcut) return;
    if (shortcut === 'start') {
      setSettingsOpen(false);
      setSettingsSection(null);
      setTab('focus');
    } else if (shortcut === 'task') {
      setSettingsOpen(false);
      setSettingsSection(null);
      setTab('today');
      const curToday = logicalKey(new Date(), stateRef.current.set.dayResetHour ?? 0);
      setSel(curToday);
      setTimeout(() => {
        const el = document.getElementById('dailyTaskTitleInput');
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el?.focus();
      }, 150);
    }
    params.delete('shortcut');
    const qs = params.toString();
    const nextUrl = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
    window.history.replaceState({}, '', nextUrl);
  }, [ready]);

  // First-run onboarding sheet for brand-new workspaces (persisted in localStorage)
  useEffect(() => {
    if (!ready || typeof window === 'undefined') return;
    try {
      if (localStorage.getItem('dh_onboarded_v2') === '1') return;
    } catch {
      return;
    }
    const cur = stateRef.current;
    if (
      !cur.activeTimer &&
      cur.sessions.length === 0 &&
      cur.chapters.length === 0 &&
      cur.ddays.length === 0
    ) {
      setOnboardingOpen(true);
    }
  }, [ready]);

  // Desk mode class on body
  useEffect(() => {
    document.body.classList.toggle('desk-mode', deskMode);
  }, [deskMode]);

  // Ref-counted Screen Wake Lock sync (re-acquires on visibilitychange, releases cleanly)
  useWakeLock(state.activeTimer?.status === 'running' || deskMode);

  // Mid-Session Parking Lot scratchpad handlers (strictly localStorage, zero Firestore writes)
  const handleAddParkedThought = useCallback(
    (text: string, meta?: { subjectId?: string; chapterId?: string }) => {
      setParkedThoughts((prev) => {
        const { next, added } = addParkedThought(prev, text, meta);
        if (!added) return prev;
        saveParkedThoughts(next);
        return next;
      });
      showToast('Thought parked for session wrap-up');
    },
    [showToast]
  );

  const handleRemoveParkedThought = useCallback((thoughtId: string) => {
    setParkedThoughts((prev) => {
      const next = removeParkedThought(prev, thoughtId);
      saveParkedThoughts(next);
      return next;
    });
  }, []);

  // v32: 3-Fader Offline Ambient Sound Mixer lifecycle (auto-starts with timer, releases cleanly on pause/stop/unmount)
  const prevTimerStatusRef = useRef<string | undefined>(state.activeTimer?.status);
  useEffect(() => {
    const curStatus = state.activeTimer?.status;
    const prevStatus = prevTimerStatusRef.current;
    prevTimerStatusRef.current = curStatus;

    if (curStatus === 'running') {
      const mixer = loadAmbientMixerState();
      if (hasActiveAmbientAudio(mixer)) {
        syncAmbientMixer(mixer, true);
      }
    } else if (prevStatus === 'running') {
      stopAmbientMixer();
    }
  }, [state.activeTimer?.status]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onMixerChange = (ev: Event) => {
      const custom = ev as CustomEvent<AmbientMixerState>;
      const next = custom.detail || loadAmbientMixerState();
      syncAmbientMixer(next, hasActiveAmbientAudio(next));
    };
    window.addEventListener(AMBIENT_MIXER_EVENT, onMixerChange);
    return () => {
      window.removeEventListener(AMBIENT_MIXER_EVENT, onMixerChange);
      stopAmbientMixer();
    };
  }, []);

  // Milestone 2: Cloud Sync Controller & Firebase Auth lifecycle (serialized + coalesced)
  const syncInFlightRef = useRef<Promise<SyncStatus> | null>(null);
  const queuedSyncOptsRef = useRef<{
    forcePull?: boolean;
    isFirstSignIn?: boolean;
    dirtyDocKeys?: string[];
  } | null>(null);

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

      // Coalesce overlapping triggers (visibilitychange, online, 8s debounce, 5m interval, manual button)
      if (syncInFlightRef.current) {
        const prev = queuedSyncOptsRef.current;
        const mergedDirty = new Set<string>([
          ...(prev?.dirtyDocKeys || []),
          ...(opts?.dirtyDocKeys || []),
        ]);
        queuedSyncOptsRef.current = {
          forcePull: Boolean(prev?.forcePull || opts?.forcePull),
          isFirstSignIn: Boolean(prev?.isFirstSignIn || opts?.isFirstSignIn),
          ...(mergedDirty.size > 0 ? { dirtyDocKeys: Array.from(mergedDirty) } : {}),
        };
        return syncInFlightRef.current;
      }

      const executeCycle = async (cycleOpts?: {
        forcePull?: boolean;
        isFirstSignIn?: boolean;
        dirtyDocKeys?: string[];
      }): Promise<SyncStatus> => {
        const activeUser = authUserRef.current;
        const activeController = syncControllerRef.current;
        if (!activeUser || !activeController || !readyRef.current) return 'off';
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          setSyncStatus('offline');
          return 'offline';
        }

        setSyncStatus('syncing');
        setSyncErrorMsg(null);

        try {
          const cs = await getCloudSyncMod();
          // 2.4: On first sign-in on a device that already has local data, write a safety snapshot first
          if (
            cycleOpts?.isFirstSignIn &&
            stateRef.current.syncMeta?.uid !== activeUser.uid
          ) {
            await writeSafetyBackupSnapshot(stateRef.current);
          }

          const stateSnapshotBeforePush = stateRef.current;
          const res = await cs.performCloudSyncCycle(
            activeUser.uid,
            stateSnapshotBeforePush,
            activeController,
            {
              forcePull: cycleOpts?.forcePull,
              dirtyDocKeys: cycleOpts?.dirtyDocKeys,
              getLatestLocalState: () => stateRef.current,
            }
          );
          setSyncWritesToday(cs.getSyncTodayWrites());
          setSyncStatus(res.status);
          if (res.errorMessage) {
            setSyncErrorMsg(res.errorMessage);
          }
          if (res.mergedState.syncMeta?.lastSyncedAt) {
            setLastSyncedAt(res.mergedState.syncMeta.lastSyncedAt);
          }
          if (res.status === 'synced' || res.pulledDocs > 0) {
            // Re-merge against the LATEST stateRef.current so local edits logged during batch.commit() are never wiped
            const latestNow = Date.now();
            const currentLatest = stateRef.current;
            const localMutatedMidFlight = currentLatest !== stateSnapshotBeforePush;
            let baseState: PulseHabitState;
            if (!localMutatedMidFlight) {
              baseState = res.mergedState;
            } else if (res.pulledDocs > 0 && res.downloadedDocs) {
              baseState = {
                ...cs.mergeStateWithCloudDocs(currentLatest, res.downloadedDocs, latestNow),
                syncMeta: res.mergedState.syncMeta,
              };
            } else {
              baseState = {
                ...currentLatest,
                syncMeta: res.mergedState.syncMeta,
              };
            }

            if (res.pulledDocs > 0 || baseState.syncMeta?.lastSyncedAt !== currentLatest.syncMeta?.lastSyncedAt) {
              const curToday = logicalKey(
                new Date(),
                baseState.set.dayResetHour ?? 0
              );
              const syncedState: PulseHabitState = {
                ...baseState,
                log: cloneLog(baseState.log),
                savedAt: latestNow,
              };
              syncStudyHabitsInPlace(syncedState, curToday, curToday);
              stateRef.current = syncedState;
              setState(syncedState);
              persistState(syncedState);
            }
          }
          return res.status;
        } catch (err) {
          const msg =
            err instanceof Error
              ? err.message
              : 'Cloud sync encountered an unexpected error';
          setSyncStatus('error');
          setSyncErrorMsg(msg);
          return 'error';
        }
      };

      const runPromise = (async (): Promise<SyncStatus> => {
        let lastStatus = await executeCycle(opts);
        while (queuedSyncOptsRef.current) {
          const nextOpts = queuedSyncOptsRef.current;
          queuedSyncOptsRef.current = null;
          lastStatus = await executeCycle(nextOpts);
        }
        return lastStatus;
      })();

      syncInFlightRef.current = runPromise;
      try {
        return await runPromise;
      } finally {
        if (syncInFlightRef.current === runPromise) {
          syncInFlightRef.current = null;
        }
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

  // Pre-load Groups chunk cleanly when Communities tab opens
  useEffect(() => {
    if (tab === 'groups' && !groupBudgetRef.current) {
      void ensureGroupBudget();
    }
  }, [tab, ensureGroupBudget]);

  useEffect(() => {
    let disposed = false;
    let unsubAuth: (() => void) | null = null;
    let controller: SyncBudgetController | null = null;

    void getCloudSyncMod().then((cs) => {
      if (disposed) return;
      setSyncWritesToday(cs.getSyncTodayWrites());
      controller = new cs.SyncBudgetController({
        initialMeta: cs.loadSyncOutboxMeta(),
        onFlushDocs: async (dirtyDocKeys) => {
          await runCloudSync({ forcePull: false, dirtyDocKeys });
          return { writesUsed: 0 };
        },
        onMetaChanged: (m) => {
          const stored = cs.loadSyncOutboxMeta();
          cs.saveSyncOutboxMeta({
            ...stored,
            dirtyDocs: m.dirtyDocs,
            lastPushTs: m.lastPushTs,
            dailyWritesDayKey: m.dailyWritesDayKey,
            dailyWritesCount: m.dailyWritesCount,
            quotaPausedUntilDayKey: m.quotaPausedUntilDayKey,
          });
        },
      });
      syncControllerRef.current = controller;

      cs.checkRedirectSignInResult().catch(() => {});

      unsubAuth = cs.subscribeToAuthChanges((user) => {
        const prevUid = authUserRef.current?.uid || null;
        if (user) {
          if (prevUid && prevUid !== user.uid) {
            // Account switch on same device: wipe previous account's cached sync/squad state
            syncControllerRef.current?.resetOutbox();
            cs.clearSyncOutboxOnSignOut();
            void getGroupsMod()
              .then((gm) => gm.clearAllCachedGroupSnapshots())
              .catch(() => {});
          }
          const u = {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
          };
          authUserRef.current = u;
          setAuthUser(u);
          setLastSyncedAt(stateRef.current.syncMeta?.lastSyncedAt);
          cs.testFirestoreConnection().catch(() => {});
          void ensureGroupBudget();
        } else {
          if (prevUid) {
            syncControllerRef.current?.resetOutbox();
            cs.clearSyncOutboxOnSignOut();
            void getGroupsMod()
              .then((gm) => gm.clearAllCachedGroupSnapshots())
              .catch(() => {});
          }
          authUserRef.current = null;
          setAuthUser(null);
          setSyncStatus('off');
        }
      });
    });

    const onVisHide = () => {
      if (document.visibilityState === 'hidden' && authUserRef.current) {
        syncControllerRef.current?.flushOnBackground();
        void groupBudgetRef.current?.flushOnBackground();
      } else if (document.visibilityState === 'visible' && authUserRef.current) {
        void runCloudSync({ forcePull: false });
      }
    };
    const onPageHide = () => {
      if (authUserRef.current) {
        syncControllerRef.current?.flushOnBackground();
        void groupBudgetRef.current?.flushOnBackground();
      }
    };
    const onOnline = () => {
      setIsOnline(true);
      groupBudgetRef.current?.setOnlineStatus(true);
      if (authUserRef.current) void runCloudSync({ forcePull: false });
    };
    const onOffline = () => {
      setIsOnline(false);
      groupBudgetRef.current?.setOnlineStatus(false);
      if (authUserRef.current) setSyncStatus('offline');
    };

    // Automatic periodic background cloud sync every 5 minutes while signed in and visible
    const autoSyncInterval = setInterval(() => {
      if (
        authUserRef.current &&
        typeof document !== 'undefined' &&
        document.visibilityState === 'visible' &&
        (typeof navigator === 'undefined' || navigator.onLine)
      ) {
        void runCloudSync({ forcePull: false });
      }
    }, 5 * 60_000);

    document.addEventListener('visibilitychange', onVisHide);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      disposed = true;
      unsubAuth?.();
      controller?.dispose();
      clearInterval(autoSyncInterval);
      document.removeEventListener('visibilitychange', onVisHide);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [ensureGroupBudget, runCloudSync]);

  // v29 Spark-Quota-Safe Zero-Chat Live Co-Study Aura (Zero Heartbeats, 15s Start Debounce)
  // Writes strictly ONCE after 15s of sustained study (Focus, Full mock, or Exam Hall)
  // and ONCE (`activeSession: null`) on pause, stop, completion, opt-out, or sign-out.
  const publishLiveAuraToJoinedGroups = useCallback(
    async (nextAura: ActiveSessionAura | null) => {
      publishedAuraRef.current = nextAura;
      if (!authUserRef.current || !readyRef.current) return;
      const curState = stateRef.current;
      const liveGroups = (curState.groupsConfig?.joined || []).filter(
        (g) => g.sh.l && !g.paused
      );
      if (liveGroups.length === 0) return;
      const [gm, budget] = await Promise.all([getGroupsMod(), ensureGroupBudget()]);
      const curToday = logicalKey(new Date(), curState.set.dayResetHour ?? 0);
      const idsToFlush: string[] = [];
      for (const g of liveGroups) {
        const entry = gm.buildMyMemberEntry(curState, curToday, {
          joinedAt: g.joinedAt,
          sh: g.sh,
          paused: g.paused,
          live: null,
          activeSession: nextAura,
          groupId: g.groupId,
        });
        if (budget.hasEntryChanged(g.groupId, entry)) {
          budget.markGroupDirty(g.groupId, entry);
          idsToFlush.push(g.groupId);
        }
      }
      if (idsToFlush.length > 0) {
        await budget.flushNow(idsToFlush);
      }
    },
    [ensureGroupBudget]
  );

  const liveAuraToggleCooldownRef = useRef(createCooldownGuard(1_500));

  useEffect(() => {
    const quotaToastCooldown = createCooldownGuard(15_000);
    return onStorageQuotaExceeded(() => {
      if (quotaToastCooldown.tryAcquire().allowed) {
        showToast(
          'Device storage is full — export a JSON backup or free browser space to keep saving.'
        );
      }
    });
  }, [showToast]);

  const handleToggleLiveAuraEnabled = useCallback(
    (enabled: boolean) => {
      if (!liveAuraToggleCooldownRef.current.tryAcquire().allowed) {
        showToast('Wait a moment before toggling Live Aura again');
        return;
      }
      setLiveAuraEnabled(enabled);
      liveAuraEnabledRef.current = enabled;
      safeLocalStorageSet('dh_live_aura_enabled_v1', enabled ? '1' : '0');
      auraControllerRef.current?.setEnabled(enabled);
      if (!enabled) {
        liveStatusRef.current = null;
        if (publishedAuraRef.current !== null) {
          void publishLiveAuraToJoinedGroups(null);
        }
      }
      showToast(
        enabled
          ? 'Live study aura enabled'
          : 'Live study aura paused — studying invisibly'
      );
    },
    [publishLiveAuraToJoinedGroups, showToast]
  );

  useEffect(() => {
    if (!ready || !authUser) {
      auraControllerRef.current?.dispose();
      auraControllerRef.current = null;
      publishedAuraRef.current = null;
      liveStatusRef.current = null;
      return;
    }

    const joinedLiveGroups = (state.groupsConfig?.joined || []).filter(
      (g) => g.sh.l && !g.paused
    );
    if (joinedLiveGroups.length === 0) {
      auraControllerRef.current?.dispose();
      auraControllerRef.current = null;
      publishedAuraRef.current = null;
      liveStatusRef.current = null;
      return;
    }

    let cancelled = false;

    void getGroupsMod().then((gm) => {
      if (cancelled) return;
      if (!auraControllerRef.current) {
        auraControllerRef.current = new gm.LiveAuraPresenceController({
          debounceMs: gm.LIVE_AURA_START_DEBOUNCE_MS,
          enabled: liveAuraEnabledRef.current,
          onPublish: publishLiveAuraToJoinedGroups,
        });
      }
      const ctrl = auraControllerRef.current;
      ctrl.setEnabled(liveAuraEnabled);

      let desiredAura: ActiveSessionAura | null = null;
      if (examHallPresence?.running && examHallPresence.startedAt > 0) {
        desiredAura = gm.buildActiveSessionAuraPayload({
          startedAt: examHallPresence.startedAt,
          isExamHall: true,
        });
      } else {
        const t = stateRef.current.activeTimer;
        if (t && t.status === 'running' && t.phase !== 'break') {
          const isAll = isAllSubjectsMockId(t.subjectId);
          const sub = isAll
            ? null
            : stateRef.current.subjects.find((s) => s.id === t.subjectId);
          desiredAura = gm.buildActiveSessionAuraPayload({
            startedAt: t.startTs,
            mode: t.mode,
            subjectId: t.subjectId,
            subjectName: isAll ? ALL_SUBJECTS_LABEL : sub?.name,
            subjectColor: isAll ? ALL_SUBJECTS_COLOR : sub?.color,
          });
        }
      }

      ctrl.handleSessionChange(desiredAura);
    });

    return () => {
      cancelled = true;
    };
  }, [
    ready,
    authUser,
    liveAuraEnabled,
    examHallPresence?.running,
    examHallPresence?.startedAt,
    state.activeTimer?.status,
    state.activeTimer?.phase,
    state.activeTimer?.startTs,
    state.activeTimer?.mode,
    state.activeTimer?.subjectId,
    state.groupsConfig?.joined,
    publishLiveAuraToJoinedGroups,
  ]);

  useEffect(() => {
    return () => {
      auraControllerRef.current?.dispose();
      auraControllerRef.current = null;
    };
  }, []);

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
      const m: ActiveTimerMode = mode || prev.set.defaultMode || 'pomo';
      const resolvedSubId =
        subjectId ||
        prev.activeTimer?.subjectId ||
        (m === 'fullMock'
          ? ALL_SUBJECTS_MOCK_ID
          : prev.subjects.find((s) => !s.arch)?.id || 'sub_phy');
      const isAll = isAllSubjectsMockId(resolvedSubId);
      const sub = isAll ? undefined : prev.subjects.find((s) => s.id === resolvedSubId);
      const resolvedChapId = isAll
        ? undefined
        : chapterId !== undefined
          ? chapterId || undefined
          : prev.activeTimer?.chapterId;
      const chap = resolvedChapId
        ? prev.chapters.find((c) => c.id === resolvedChapId)
        : undefined;
      const cleanHeading =
        (heading && heading.trim()) ||
        chap?.name ||
        (m === 'fullMock' || isAll
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
              ? customTargetMins || prev.set.fullMockMins || 180
              : 0;
      const now = Date.now();

      playSoundCue('timerStart', !!prev.set.snd);
      updateAndSave((cur) => ({
        ...cur,
        set: {
          ...cur.set,
          defaultMode: m,
          updatedAt: now,
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

  // Credit completed Exam Hall papers (>= 60s) once to daily study hours, timeline, consistency, streak & XP
  const handleLogExamHallSession = useCallback(
    (record: ExamPaceRecord) => {
      if (!record || hasLoggedExamHallRecord(record.id)) return;
      const prev = stateRef.current;
      const existingIds = new Set(prev.sessions.map((s) => s.id));
      const session = buildExamHallStudySession(
        record,
        prev.set.dayResetHour ?? 0,
        existingIds
      );
      if (!session) return;

      const now = Date.now();
      const next: PulseHabitState = {
        ...prev,
        log: cloneLog(prev.log),
        sessions: [...prev.sessions, session],
        bonus: (prev.bonus || 0) + Math.max(5, Math.round(session.activeMs / 60000)),
      };
      const curToday = logicalKey(now, next.set.dayResetHour ?? 0);
      syncStudyHabitsInPlace(next, session.dayKey, curToday, now);
      markExamHallRecordLogged(record.id);
      saveNextState(next);
      showToast(
        `Exam Hall logged (${fmtHMShort(session.activeMs)}) to today's hours`
      );
    },
    [saveNextState, showToast]
  );

  const handleOpenDailyProofCard = useCallback(
    (dayKey: string) => {
      const curState = stateRef.current;
      const curToday = logicalKey(new Date(), curState.set.dayResetHour ?? 0);
      setProofCardPayload(buildDailyProofPayload(curState, dayKey, curToday));
    },
    []
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
    playSoundCue('timerPause', !!prev.set.snd);
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
    playSoundCue('timerResume', !!prev.set.snd);
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
      (t.mode === 'fullMock'
        ? ALL_SUBJECTS_MOCK_ID
        : prev.subjects.find((s) => !s.arch)?.id || 'sub_phy');
    const isAllSubjects = isAllSubjectsMockId(finalSubjectId);
    const finalChapterId = isAllSubjects
      ? undefined
      : reflection.chapterId !== undefined
        ? reflection.chapterId || undefined
        : t.chapterId;
    const chap = finalChapterId
      ? prev.chapters.find((c) => c.id === finalChapterId)
      : undefined;
    const sub = isAllSubjects
      ? undefined
      : prev.subjects.find((s) => s.id === finalSubjectId);
    const finalHeading =
      (reflection.heading && reflection.heading.trim()) ||
      chap?.name ||
      (t.heading && t.heading.trim()) ||
      (t.mode === 'fullMock' || isAllSubjects
        ? 'Full Mock'
        : sub
          ? `${sub.name} Study`
          : 'Deep Study Session');

    const entry: StudySession = {
      id: uid('ses'),
      subjectId: finalSubjectId,
      chapterId: finalChapterId,
      heading: finalHeading,
      dayKey: logicalKey(t.sliceStartTs, prev.set.dayResetHour ?? 0),
      startTs: t.sliceStartTs,
      endTs: now,
      activeMs: sliceActiveMs,
      pausedMs: slicePausedMs,
      pauseCount: t.slicePauseCount || 0,
      overtimeMs,
      purity,
      mode: t.mode,
      source: 'timer',
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
    const curToday = logicalKey(now, next.set.dayResetHour ?? 0);
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
      const curToday = logicalKey(now, updated.set.dayResetHour ?? 0);
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
      playSoundCue('examFinish', !!cur.set.snd);
      setModal({
        type: 'mock',
        prefillDayKey: logicalKey(now, cur.set.dayResetHour ?? 0),
        prefillDurationMins: Math.max(1, Math.round(m.totalActiveMs / 60000)),
        prefillNote: splitsSummary,
      });
      showToast('Logged Full Mock study session · Enter your mock scores');
      return;
    }

    if (t.status === 'running') {
      updateAndSave((prev) => {
        const ct = prev.activeTimer;
        if (!ct || ct.status === 'paused') return prev;
        return {
          ...prev,
          activeTimer: {
            ...ct,
            status: 'paused',
            pauseStartTs: Date.now(),
            pauseCount: (ct.pauseCount || 0) + 1,
            slicePauseCount: (ct.slicePauseCount || 0) + 1,
          },
        };
      });
    }
    playSoundCue('stopAndLog', !!cur.set.snd);
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
        chapterId: t.chapterId,
        heading: t.heading,
        rating: 5,
        note: 'Pomodoro work sprint',
      });
      workingState = res.next;
      nextPhase = 'break';
      nextTargetMs = (prev.set.pomoBreak || 5) * 60000;
      if (shouldOpenSessionWrapUp(res.savedEntry)) {
        setSessionWrapUp(buildSessionWrapUpSummary(res.savedEntry!));
      }
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
    const curToday = logicalKey(now, updated.set.dayResetHour ?? 0);
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
    onExtendTarget: extendTimerTarget,
    onNextMockSection: handleNextMockSection,
    onToast: showToast,
  });

  // 500ms Zero-Drift Timer Loop backed by an unthrottled Web Worker + fallback setInterval
  // Emits 1Hz display ticks ONLY to subscribed timer widgets when running & visible (0 full-App re-renders!)
  const hasActiveTimer = Boolean(state.activeTimer);
  useEffect(() => {
    if (!hasActiveTimer) return;

    let lastEmittedSec = -1;
    let lastHabitSyncTs = 0;

    const handleTick = () => {
      const prev = stateRef.current;
      if (!prev.activeTimer) return;

      const now = Date.now();
      const isRunning = prev.activeTimer.status === 'running';
      const isHidden =
        typeof document !== 'undefined' && document.visibilityState === 'hidden';

      // Notify ONLY mounted clock subscribers at ~1Hz when running and visible
      if (isRunning && !isHidden) {
        const curSec = Math.floor(now / 1000);
        if (curSec !== lastEmittedSec) {
          lastEmittedSec = curSec;
          emitTimerTick();
        }
      }

      const m = isRunning ? getTimerMetrics(prev, now) : null;
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
        isRunning &&
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

      // Avoid deep-cloning the entire historical habit log every 500ms: sync auto-study habits every 15s while running
      const shouldSyncHabits =
        changed || (isRunning && now - lastHabitSyncTs >= 15000);
      if (shouldSyncHabits) {
        lastHabitSyncTs = now;
        const curToday = logicalKey(now, prev.set.dayResetHour ?? 0);
        const draft: PulseHabitState = {
          ...prev,
          log: cloneLog(prev.log),
          activeTimer: nextTimer,
        };
        const habitChanged = syncStudyHabitsInPlace(draft, curToday, curToday, now);

        if (changed || habitChanged) {
          saveNextState(draft);
        }
      }
      renderTick();
    };

    const onVisibilityRefresh = () => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'visible' &&
        stateRef.current.activeTimer
      ) {
        lastEmittedSec = -1;
        emitTimerTick();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityRefresh);
    }

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
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityRefresh);
      }
      clearInterval(fallbackId);
      if (worker) worker.terminate();
      if (workerUrl) URL.revokeObjectURL(workerUrl);
    };
  }, [hasActiveTimer, renderTick, saveNextState, showToast]);

  // Scheduled Habit Reminders check
  useEffect(() => {
    const id = setInterval(() => {
      const cur = stateRef.current;
      if (!cur.set.notif) return;
      const n = new Date();
      const hm = `${pad(n.getHours())}:${pad(n.getMinutes())}`;
      const tKey = logicalKey(n, cur.set.dayResetHour ?? 0);
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

      const curToday = logicalKey(new Date(), next.set.dayResetHour ?? 0);
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
        setRewardBurst({
          kind: 'perfectDay',
          title: 'Perfect Day Unlocked!',
          subtitle: 'Every scheduled habit for this day is complete. Keep the streak alive!',
          badgeText: '100% Daily Goal',
          accentColor: '#4ADE80',
        });
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

  const handleDeleteHabit = useCallback(
    (id: string) => {
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
        const curToday = logicalKey(new Date(), restored.set.dayResetHour ?? 0);
        syncStudyHabitsForDays(restored, [sel, curToday], curToday);
        saveNextState(restored, { suppressMilestones: true });
      });
    },
    [saveNextState, sel, showToast, updateAndSave]
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
        const curToday = logicalKey(new Date(), restored.set.dayResetHour ?? 0);
        syncStudyHabitsForDays(restored, [target.dayKey, sel, curToday], curToday);
        saveNextState(restored, { suppressMilestones: true });
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
      const savedDiag = getMockDiagnostic(mockId);
      const savedLeaks = getMockLeaks(mockId);
      const hadLeaks = hasAnyMockLeaks(savedLeaks);
      const savedReportDetails = getMockReportDetails(mockId);
      const record: DeletedEntityRecord = {
        kind: 'mock',
        item: JSON.parse(JSON.stringify(prev.mocks[index])),
        index,
      };
      deleteMockDiagnostic(mockId);
      deleteMockLeaks(mockId);
      deleteMockReportDetails(mockId);
      updateAndSave((cur) => ({
        ...addTombstone(cur, mockId),
        mocks: cur.mocks.filter((m) => m.id !== mockId),
      }));
      setModal({ type: 'none' });
      showToast('Mock test deleted', () => {
        if (savedDiag) {
          saveMockDiagnostic(mockId, savedDiag);
        }
        if (hadLeaks) {
          saveMockLeaks(mockId, savedLeaks);
        }
        if (savedReportDetails) {
          saveMockReportDetails(mockId, savedReportDetails);
        }
        updateAndSave((cur) => restoreDeletedItem(cur, record));
      });
    },
    [showToast, updateAndSave]
  );

  const handleSyncMockFromReport = useCallback(
    (mockId: string, details: MockReportDetails) => {
      const now = Date.now();
      updateAndSave((cur) => ({
        ...cur,
        mocks: cur.mocks.map((m) => {
          if (m.id !== mockId) return m;
          const nextSubjects = buildCoreMockSubjectsFromReport(
            details,
            cur.subjects
          );
          return {
            ...m,
            durationMins:
              details.timeTakenMin > 0 ? details.timeTakenMin : m.durationMins,
            marksPerCorrect: 4,
            marksPerWrong: -1,
            maxMarks: 720,
            subjects: nextSubjects,
            updatedAt: now,
          };
        }),
      }));
    },
    [updateAndSave]
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

  const handleUpdateSubject = useCallback(
    (subjectId: string, patch: { name: string; e: string; color: string }) => {
      const cleanName = patch.name.trim().slice(0, 40);
      if (!cleanName) return;
      const cleanEmoji = patch.e.trim().slice(0, 8) || '📘';
      const cleanColor = patch.color.trim() || '#3b82f6';
      const now = Date.now();
      updateAndSave((cur) => ({
        ...cur,
        subjects: cur.subjects.map((s) =>
          s.id === subjectId
            ? { ...s, name: cleanName, e: cleanEmoji, color: cleanColor, updatedAt: now }
            : s
        ),
      }));
      showToast(`Updated subject "${cleanName}"`);
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
      const res = toggleRestDay(prev, dayKey, Date.now());
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
    const now = Date.now();
    updateAndSave((cur) => ({
      ...cur,
      burnoutDismissedUntil: until,
      set: {
        ...cur.set,
        burnoutDismissedUntil: until,
        updatedAt: now,
      },
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
              minDayMinutes: 360,
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

  // Deadline Target Sprints & Custom Reminders handlers (v44)
  const handleAddTarget = useCallback(
    (draft: TargetDraftInput) => {
      const created = createDeadlineTarget({
        title: draft.title,
        startDate: todayKey,
        deadlineDate: draft.deadlineDate,
        subjectId: draft.subjectId,
        notes: draft.notes,
        itemTexts: draft.itemTexts,
      });
      if (!created.title) return;
      updateAndSave((cur) => ({
        ...cur,
        deadlineTargets: [created, ...(cur.deadlineTargets || [])],
      }));
      showToast(`Target created: ${created.title}`);
    },
    [showToast, todayKey, updateAndSave]
  );

  const handleUpdateTarget = useCallback(
    (id: string, draft: TargetDraftInput) => {
      const cleanTitle = sanitizeTextControlChars(draft.title, 140);
      if (!cleanTitle || !isValidDateKey(draft.deadlineDate)) return;
      const cleanNotes = draft.notes
        ? sanitizeTextControlChars(draft.notes, 800, { allowNewlines: true })
        : undefined;
      const now = Date.now();
      updateAndSave((cur) => ({
        ...cur,
        deadlineTargets: (cur.deadlineTargets || []).map((t) =>
          t.id === id
            ? {
                ...t,
                title: cleanTitle,
                deadlineDate: draft.deadlineDate,
                subjectId: draft.subjectId || undefined,
                notes: cleanNotes || undefined,
                updatedAt: now,
              }
            : t
        ),
      }));
      showToast('Target updated');
    },
    [showToast, updateAndSave]
  );

  const handleToggleTargetItem = useCallback(
    (targetId: string, itemId: string) => {
      const now = Date.now();
      updateAndSave((cur) => ({
        ...cur,
        deadlineTargets: (cur.deadlineTargets || []).map((t) => {
          if (t.id !== targetId) return t;
          return {
            ...t,
            updatedAt: now,
            items: t.items.map((item) =>
              item.id === itemId
                ? {
                    ...item,
                    done: !item.done,
                    doneAt: !item.done ? now : undefined,
                  }
                : item
            ),
          };
        }),
      }));
    },
    [updateAndSave]
  );

  const handleAddTargetItem = useCallback(
    (targetId: string, text: string) => {
      const cleanText = sanitizeTextControlChars(text, 200);
      if (!cleanText) return;
      const now = Date.now();
      const newItem = {
        id: uid('tci'),
        text: cleanText,
        done: false,
      };
      updateAndSave((cur) => ({
        ...cur,
        deadlineTargets: (cur.deadlineTargets || []).map((t) =>
          t.id === targetId
            ? {
                ...t,
                updatedAt: now,
                items: [...t.items, newItem],
              }
            : t
        ),
      }));
    },
    [updateAndSave]
  );

  const handleDeleteTargetItem = useCallback(
    (targetId: string, itemId: string) => {
      const now = Date.now();
      updateAndSave((cur) => ({
        ...cur,
        deadlineTargets: (cur.deadlineTargets || []).map((t) =>
          t.id === targetId
            ? {
                ...t,
                updatedAt: now,
                items: t.items.filter((item) => item.id !== itemId),
              }
            : t
        ),
      }));
    },
    [updateAndSave]
  );

  const handleToggleArchiveTarget = useCallback(
    (targetId: string) => {
      const now = Date.now();
      updateAndSave((cur) => ({
        ...cur,
        deadlineTargets: (cur.deadlineTargets || []).map((t) =>
          t.id === targetId ? { ...t, archived: !t.archived, updatedAt: now } : t
        ),
      }));
    },
    [updateAndSave]
  );

  const handleDeleteTarget = useCallback(
    (targetId: string) => {
      const prev = stateRef.current;
      const list = prev.deadlineTargets || [];
      const index = list.findIndex((t) => t.id === targetId);
      if (index === -1) return;
      const snapshot = JSON.parse(JSON.stringify(list[index]));
      updateAndSave((cur) => ({
        ...addTombstone(cur, targetId),
        deadlineTargets: (cur.deadlineTargets || []).filter((t) => t.id !== targetId),
      }));
      showToast('Target deleted', () => {
        updateAndSave((cur) => {
          const nextDel = (cur.del || []).filter((k) => k !== targetId);
          const nextDelAt = { ...(cur.delAt || {}) };
          delete nextDelAt[targetId];
          const existing = cur.deadlineTargets || [];
          const restored = existing.some((t) => t.id === targetId)
            ? existing
            : [
                ...existing.slice(0, index),
                { ...snapshot, updatedAt: Date.now() },
                ...existing.slice(index),
              ];
          return {
            ...cur,
            del: nextDel,
            delAt: nextDelAt,
            deadlineTargets: restored,
          };
        });
      });
    },
    [showToast, updateAndSave]
  );

  const handleAddReminder = useCallback(
    (draft: ReminderDraftInput) => {
      const created = createCustomReminder({
        title: draft.title,
        date: draft.date,
        time: draft.time,
        leadDays: draft.leadDays,
        category: draft.category,
        notes: draft.notes,
      });
      if (!created.title) return;
      updateAndSave((cur) => ({
        ...cur,
        reminders: [created, ...(cur.reminders || [])],
      }));
      showToast(`Reminder saved: ${created.title}`);
    },
    [showToast, updateAndSave]
  );

  const handleUpdateReminder = useCallback(
    (id: string, draft: ReminderDraftInput) => {
      const cleanTitle = sanitizeTextControlChars(draft.title, 140);
      if (!cleanTitle || !isValidDateKey(draft.date)) return;
      const cleanNotes = draft.notes
        ? sanitizeTextControlChars(draft.notes, 800, { allowNewlines: true })
        : undefined;
      const now = Date.now();
      updateAndSave((cur) => ({
        ...cur,
        reminders: (cur.reminders || []).map((r) =>
          r.id === id
            ? {
                ...r,
                title: cleanTitle,
                date: draft.date,
                time: draft.time && isValidTime24h(draft.time) ? draft.time.trim() : undefined,
                leadDays: normalizeLeadDays(draft.leadDays),
                category: draft.category,
                notes: cleanNotes || undefined,
                updatedAt: now,
              }
            : r
        ),
      }));
      showToast('Reminder updated');
    },
    [showToast, updateAndSave]
  );

  const handleToggleReminderDone = useCallback(
    (id: string) => {
      const now = Date.now();
      updateAndSave((cur) => ({
        ...cur,
        reminders: (cur.reminders || []).map((r) =>
          r.id === id ? { ...r, done: !r.done, updatedAt: now } : r
        ),
      }));
    },
    [updateAndSave]
  );

  const handleDeleteReminder = useCallback(
    (id: string) => {
      const prev = stateRef.current;
      const list = prev.reminders || [];
      const index = list.findIndex((r) => r.id === id);
      if (index === -1) return;
      const snapshot = JSON.parse(JSON.stringify(list[index]));
      updateAndSave((cur) => ({
        ...addTombstone(cur, id),
        reminders: (cur.reminders || []).filter((r) => r.id !== id),
      }));
      showToast('Reminder deleted', () => {
        updateAndSave((cur) => {
          const nextDel = (cur.del || []).filter((k) => k !== id);
          const nextDelAt = { ...(cur.delAt || {}) };
          delete nextDelAt[id];
          const existing = cur.reminders || [];
          const restored = existing.some((r) => r.id === id)
            ? existing
            : [
                ...existing.slice(0, index),
                { ...snapshot, updatedAt: Date.now() },
                ...existing.slice(index),
              ];
          return {
            ...cur,
            del: nextDel,
            delAt: nextDelAt,
            reminders: restored,
          };
        });
      });
    },
    [showToast, updateAndSave]
  );

  const handleQuickAction = useCallback(
    (action: QuickActionKind) => {
      setSettingsOpen(false);
      setSettingsSection(null);
      switch (action) {
        case 'startSession':
          setTab('focus');
          window.scrollTo(0, 0);
          break;
        case 'logSession':
          setModal({ type: 'manualSession' });
          break;
        case 'addTask':
          setTab('today');
          setSel(todayKey);
          setTimeout(() => {
            const el = document.getElementById('dailyTaskTitleInput');
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el?.focus();
          }, 120);
          break;
        case 'addTarget':
          setPrepSubTab('targets');
          setTab('prep');
          setTargetComposerRequest({ kind: 'target', nonce: Date.now() });
          window.scrollTo(0, 0);
          break;
        case 'addReminder':
          setPrepSubTab('targets');
          setTab('prep');
          setTargetComposerRequest({ kind: 'reminder', nonce: Date.now() });
          window.scrollTo(0, 0);
          break;
        case 'addHabit':
          setModal({ type: 'habit' });
          break;
        case 'addChapter':
          setPrepSubTab('syllabus');
          setTab('prep');
          window.scrollTo(0, 0);
          break;
        case 'logMock':
          setModal({ type: 'mock' });
          break;
        case 'addVault':
          setPrepSubTab('mistakes');
          setTab('prep');
          setVaultCaptureRequest({ nonce: Date.now() });
          window.scrollTo(0, 0);
          break;
        case 'logPyq':
          setPrepSubTab('syllabus');
          setPyqJumpNonce((n) => n + 1);
          setTab('prep');
          window.scrollTo(0, 0);
          break;
        case 'addDDay':
          setModal({ type: 'dday' });
          break;
      }
    },
    [todayKey]
  );

  // Desktop Keyboard Shortcuts & Command Palette (Ctrl/Cmd+K, ?, Space, N, 1-5)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((v) => !v);
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      const isTyping =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (isTyping) return;

      if (e.key === '?') {
        e.preventDefault();
        setShortcutsHelpOpen((v) => !v);
        return;
      }

      if (e.key === '1') {
        e.preventDefault();
        switchTabWithTransition('today');
        return;
      }
      if (e.key === '2') {
        e.preventDefault();
        switchTabWithTransition('prep');
        return;
      }
      if (e.key === '3') {
        e.preventDefault();
        switchTabWithTransition('focus');
        return;
      }
      if (e.key === '4') {
        e.preventDefault();
        switchTabWithTransition('stats');
        return;
      }
      if (e.key === '5') {
        e.preventDefault();
        switchTabWithTransition('groups');
        return;
      }
      if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        handleQuickAction('addTask');
        return;
      }
      if (e.key === ' ' && target?.tagName !== 'BUTTON' && target?.tagName !== 'A') {
        e.preventDefault();
        if (stateRef.current.activeTimer) {
          toggleTimerPause();
        } else {
          const defSub = stateRef.current.subjects.find((s) => !s.arch)?.id || 'sub_phy';
          switchTabWithTransition('focus');
          startTimer(defSub, 'Focus Session');
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleQuickAction, startTimer, switchTabWithTransition, toggleTimerPause]);

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
            borderColor: 'var(--err-line)',
          }}
        >
          <h2 style={{ fontSize: '19px', marginBottom: '6px', color: 'var(--err-ink)' }}>
            Your saved data could not be loaded
          </h2>
          <small style={{ display: 'block', marginBottom: '12px', lineHeight: 1.5, color: 'var(--tx-2)' }}>
            Deep Hours paused startup so your stored study log is not overwritten. You can
            restore from the latest rolling backup, retry loading, or start fresh.
          </small>
          {backupRestoreMsg && (
            <small
              style={{
                display: 'block',
                marginBottom: '10px',
                color: 'var(--warn-ink)',
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
                  border: '1px solid var(--err-line)',
                  marginTop: '4px',
                }}
              >
                <small style={{ display: 'block', marginBottom: '8px', color: 'var(--err-ink)' }}>
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
        <div style={{ display: 'grid', justifyItems: 'center', gap: '12px' }}>
          <img
            src="/icon-512.png"
            alt="Deep Hours"
            width={64}
            height={64}
            className="w-16 h-16 rounded-2xl shadow-lg object-cover border border-white/10"
          />
          <div>
            <b style={{ fontSize: '20px', display: 'block' }}>Deep Hours</b>
            <small style={{ display: 'block', marginTop: '4px', fontSize: '14px' }}>
              Loading your study log…
            </small>
          </div>
        </div>
      </main>
    );
  }

  const todayStudyProg = getUiDailyStudyGoalProgress(state, todayKey, todayKey);
  const activeMetrics = state.activeTimer ? getTimerMetrics(state, Date.now()) : null;
  const isSettingsOpen = settingsOpen || tab === 'more';
  const activeSettingsSection: SettingsSection = settingsSection || 'profile';
  const topBarTitle = isSettingsOpen
    ? SETTINGS_SECTION_META[activeSettingsSection].title
    : tab === 'focus'
      ? 'Focus'
      : tab === 'prep'
        ? 'Prep'
        : tab === 'stats'
          ? 'Insights'
          : tab === 'groups'
            ? 'Community'
            : 'Today';
  const topBarSubtitle = isSettingsOpen
    ? SETTINGS_SECTION_META[activeSettingsSection].subtitle
    : undefined;

  const lazyFallback = (
    <div style={{ display: 'grid', gap: '12px', paddingTop: '8px' }}>
      <Skeleton height={84} />
      <Skeleton height={160} />
      <Skeleton height={120} />
    </div>
  );

  return (
    <>
      <AppShell
        activeTab={tab}
        settingsOpen={isSettingsOpen}
        onSelectTab={(nextTab) => {
          switchTabWithTransition(nextTab);
        }}
        onCloseSettings={closeSettingsAndReturn}
        topBarTitle={topBarTitle}
        topBarSubtitle={topBarSubtitle}
        syncStatus={syncStatus}
        isOnline={isOnline}
        isSignedIn={Boolean(authUser)}
        streakCount={topBarStreakInfo.streak}
        streakMetToday={
          topBarStreakInfo.todayMetMinimum || topBarStreakInfo.todayIsRestDay
        }
        level={topBarLevelInfo.level}
        xpProgressPct={topBarXpProgressPct}
        onOpenDrawer={() => setSettingsDrawerOpen(true)}
        onBackFromSettings={closeSettingsAndReturn}
        onOpenStreak={() => setStreakSheetOpen(true)}
        onOpenProfile={() => openSettingsSection('profile')}
        onOpenQuickActions={() => setQuickActionsOpen(true)}
        activeMetrics={activeMetrics}
        timerState={state}
        onToggleTimerPause={toggleTimerPause}
        todayPct={todayStudyProg.pct}
      >
        <main id="v" aria-live="polite">
          {!isSettingsOpen && tab === 'today' && (
            <ErrorBoundary variant="section" scopeLabel="Today" resetKey={`today-${sel}`}>
              <TodayView
              state={state}
              sel={sel}
              todayKey={todayKey}
              cat={cat}
              onSelectDay={setSel}
              onSelectCat={setCat}
              onSwitchTab={(t) => {
                if (t === 'more') {
                  setSettingsDrawerOpen(true);
                } else {
                  switchTabWithTransition(t);
                  window.scrollTo(0, 0);
                }
              }}
              onManageExams={() => openSettingsSection('exams')}
              onManageTargets={() => openSettingsSection('targets')}
              onToggleHabit={toggleHabit}
            onIncrementHabit={(id, d) => setHabitValue(id, sel, d)}
            onSkipHabit={skipHabit}
            onDeleteHabit={handleDeleteHabit}
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
              const now = Date.now();
              updateAndSave((prev) => {
                const nextVal = prev.mood[sel] === v ? 0 : v;
                const nextMood = { ...prev.mood };
                if (nextVal > 0) {
                  nextMood[sel] = nextVal;
                } else {
                  delete nextMood[sel];
                }
                return {
                  ...prev,
                  mood: nextMood,
                  moodUpdatedAt: {
                    ...(prev.moodUpdatedAt || {}),
                    [sel]: now,
                  },
                };
              });
            }}
            onSetNote={(txt) => {
              const now = Date.now();
              updateAndSave((prev) => {
                const nextNotes = { ...prev.notes };
                if (txt) {
                  nextNotes[sel] = txt;
                } else {
                  delete nextNotes[sel];
                }
                return {
                  ...prev,
                  notes: nextNotes,
                  noteUpdatedAt: {
                    ...(prev.noteUpdatedAt || {}),
                    [sel]: now,
                  },
                };
              });
            }}
            onShareTodayProof={() => handleOpenDailyProofCard(sel)}
            onOpenTargetsTab={() => {
              setPrepSubTab('targets');
              switchTabWithTransition('prep');
              window.scrollTo(0, 0);
            }}
            onToggleTargetItem={handleToggleTargetItem}
            onToggleReminderDone={handleToggleReminderDone}
            onShowToast={showToast}
          />
          </ErrorBoundary>
        )}

        {!isSettingsOpen && tab === 'prep' && (
          <ErrorBoundary variant="section" scopeLabel="Prep" resetKey={`prep-${prepSubTab}`}>
          <Suspense fallback={lazyFallback}>
            <PrepView
              state={state}
              todayKey={todayKey}
              subTab={prepSubTab}
              pyqJumpNonce={pyqJumpNonce}
              vaultCaptureRequest={vaultCaptureRequest}
              targetComposerRequest={targetComposerRequest}
              activeTimerText={
                activeMetrics
                  ? `${activeMetrics.status === 'paused' ? 'Paused ' : ''}${fmtHMS(activeMetrics.totalActiveMs)}`
                  : null
              }
              onNotify={showToast}
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
              onSyncMockFromReport={handleSyncMockFromReport}
              onUpdateTargetScore={(target: number) => {
                const now = Date.now();
                updateAndSave((prev) => ({
                  ...prev,
                  set: { ...prev.set, targetMockScore: target, updatedAt: now },
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
              onAddTarget={handleAddTarget}
              onUpdateTarget={handleUpdateTarget}
              onToggleTargetItem={handleToggleTargetItem}
              onAddTargetItem={handleAddTargetItem}
              onDeleteTargetItem={handleDeleteTargetItem}
              onToggleArchiveTarget={handleToggleArchiveTarget}
              onDeleteTarget={handleDeleteTarget}
              onAddReminder={handleAddReminder}
              onUpdateReminder={handleUpdateReminder}
              onToggleReminderDone={handleToggleReminderDone}
              onDeleteReminder={handleDeleteReminder}
              onStartChapterFocus={(
                subjectId: string,
                chapterId: string,
                chapterName: string
              ) => {
                setTab('focus');
                startTimer(subjectId, chapterName, undefined, undefined, chapterId);
              }}
            />
          </Suspense>
          </ErrorBoundary>
        )}

        {!isSettingsOpen && tab === 'focus' && (
          <ErrorBoundary variant="section" scopeLabel="Focus" resetKey={`focus-${deskMode ? 'desk' : 'std'}`}>
          <Suspense fallback={lazyFallback}>
            <FocusView
              state={state}
              sel={sel}
              todayKey={todayKey}
              deskMode={deskMode}
              parkedThoughts={parkedThoughts}
              onToggleDeskMode={() => setDeskMode((d) => !d)}
              onSetDeskMode={(enabled) => setDeskMode(enabled)}
              onAddParkedThought={handleAddParkedThought}
              onRemoveParkedThought={handleRemoveParkedThought}
              onLogExamMockScore={(record: ExamPaceRecord) => {
                setDeskMode(false);
                setSettingsOpen(false);
                setSettingsSection(null);
                setPrepSubTab('mocks');
                setTab('prep');
                setModal({
                  type: 'mock',
                  prefillDayKey: todayKey,
                  prefillDurationMins: Math.max(
                    1,
                    Math.round(record.totalElapsedMs / 60_000)
                  ),
                  prefillNote: formatExamRecordNote(record),
                });
                window.scrollTo(0, 0);
              }}
              onLogExamHallSession={handleLogExamHallSession}
              onExamHallPresenceChange={setExamHallPresence}
              onOpenProofCard={setProofCardPayload}
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
                          ? prev.set.fullMockMins || 180
                          : 0;
                  return {
                    ...prev,
                    set: {
                      ...prev.set,
                      defaultMode: m,
                      updatedAt: Date.now(),
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
                const now = Date.now();
                updateAndSave((prev) => ({
                  ...prev,
                  set: { ...prev.set, soundscape: mode, updatedAt: now },
                }));
              }}
              onSetSoundVolume={(vol: number) => {
                setSoundscapeVolume(vol);
                const now = Date.now();
                updateAndSave((prev) => ({
                  ...prev,
                  set: { ...prev.set, soundVol: vol, updatedAt: now },
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
          </Suspense>
          </ErrorBoundary>
        )}

        {!isSettingsOpen && tab === 'groups' && (
          <ErrorBoundary variant="section" scopeLabel="Community" resetKey={`groups-${authUser?.uid || 'anon'}`}>
          <Suspense fallback={lazyFallback}>
            {groupBudgetReady && groupBudgetRef.current ? (
              <GroupsView
                state={state}
                todayKey={todayKey}
                myUid={authUser?.uid || null}
                isOnline={isOnline}
                isActive={!isSettingsOpen && tab === 'groups'}
                liveStatus={liveStatusRef.current}
                groupBudget={groupBudgetRef.current}
                onSignIn={async () => {
                  try {
                    const cs = await getCloudSyncMod();
                    await cs.signInWithGoogleAccount();
                  } catch (err) {
                    showToast(
                      err instanceof Error ? err.message : 'Google sign-in could not start'
                    );
                  }
                }}
                onOpenProfileModal={(reason) => {
                  setProfilePromptReason(reason);
                  setShowProfileModal(true);
                }}
                onUpdateGroupsConfig={(updater) => {
                  updateAndSave((prev) => ({
                    ...prev,
                    groupsConfig: updater(
                      prev.groupsConfig || { consentAccepted: false, joined: [] }
                    ),
                  }));
                }}
                onRecordWeekHistory={(groupId, weekKey, standing) => {
                  if (!groupsCache) return;
                  const recordFn = groupsCache.recordWeekStandingInHistory;
                  updateAndSave((prev) => ({
                    ...prev,
                    groupHistory: recordFn(
                      prev.groupHistory || {},
                      groupId,
                      weekKey,
                      standing
                    ),
                  }));
                }}
                onGoToFocus={() => {
                  setTab('focus');
                  window.scrollTo(0, 0);
                }}
                liveAuraEnabled={liveAuraEnabled}
                onToggleLiveAuraEnabled={handleToggleLiveAuraEnabled}
                activeSessionAura={publishedAuraRef.current}
                showToast={showToast}
              />
            ) : (
              lazyFallback
            )}
          </Suspense>
          </ErrorBoundary>
        )}

        {!isSettingsOpen && tab === 'stats' && (
          <ErrorBoundary variant="section" scopeLabel="Insights" resetKey={`stats-${statsSubTab}`}>
          <Suspense fallback={lazyFallback}>
            <StatsView
              state={state}
              sel={sel}
              todayKey={todayKey}
              subTab={statsSubTab}
              onChangeSubTab={setStatsSubTab}
              onEditSession={(sesId) => setModal({ type: 'manualSession', id: sesId })}
              onOpenManualSession={() => setModal({ type: 'manualSession' })}
              onSelectDateInToday={(dayKey) => {
                setSel(dayKey);
                setTab('today');
                window.scrollTo(0, 0);
              }}
              onShareTodayProof={() => handleOpenDailyProofCard(todayKey)}
              onShareWeeklyProof={(payload) => setProofCardPayload(payload)}
              onFocusSubject={(subjectId) => {
                switchTabWithTransition('focus');
                startTimer(subjectId);
                window.scrollTo(0, 0);
              }}
              onToast={showToast}
            />
          </Suspense>
          </ErrorBoundary>
        )}

        {isSettingsOpen && (
          <ErrorBoundary variant="section" scopeLabel="Settings" resetKey={`settings-${activeSettingsSection || 'root'}`}>
          <Suspense fallback={lazyFallback}>
            <SettingsView
              state={state}
              activeSection={activeSettingsSection}
              onChangeSection={(next) => {
                if (next) openSettingsSection(next);
                else closeSettingsAndReturn();
              }}
              onBack={closeSettingsAndReturn}
              hideSubHeader
              amoled={amoled}
              onToggleAmoled={handleToggleAmoled}
              todayKey={todayKey}
              isOnline={isOnline}
              authUser={authUser}
              syncStatus={syncStatus}
              syncErrorMsg={syncErrorMsg}
              lastSyncedAt={lastSyncedAt ?? state.syncMeta?.lastSyncedAt}
              dailyWriteCap={cloudSyncCache?.DAILY_WRITE_CAP ?? 500}
              syncWritesToday={syncWritesToday}
              onNewDDay={() => setModal({ type: 'dday' })}
              onEditDDay={(id) => setModal({ type: 'dday', id })}
            onOpenProfileModal={() => {
              setProfilePromptReason(undefined);
              setShowProfileModal(true);
            }}
            onSignInGoogle={async () => {
              try {
                const cs = await getCloudSyncMod();
                await cs.signInWithGoogleAccount();
              } catch (err) {
                showToast(
                  err instanceof Error ? err.message : 'Google sign-in could not start'
                );
              }
            }}
            onSignOutGoogle={async () => {
              try {
                await auraControllerRef.current?.clearImmediately();
              } catch {
                // Best-effort presence clear before revoking auth session
              }
              const [cs, gm] = await Promise.all([getCloudSyncMod(), getGroupsMod()]);
              await cs.signOutGoogleAccount();
              syncControllerRef.current?.resetOutbox();
              cs.clearSyncOutboxOnSignOut();
              gm.clearAllCachedGroupSnapshots();
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
                const [cs, gm] = await Promise.all([getCloudSyncMod(), getGroupsMod()]);
                await gm.cleanupUserGroupsOnCloudDelete(
                  stateRef.current,
                  groupBudgetRef.current || undefined
                );
                await cs.deleteAllUserCloudData(authUser.uid);
                syncControllerRef.current?.resetOutbox();
                const prev = stateRef.current;
                const cleanedState: PulseHabitState = {
                  ...prev,
                  log: cloneLog(prev.log),
                  syncMeta: undefined,
                  groupsConfig: {
                    consentAccepted: Boolean(prev.groupsConfig?.consentAccepted),
                    joined: [],
                    updatedAt: Date.now(),
                  },
                  savedAt: Date.now(),
                };
                stateRef.current = cleanedState;
                setState(cleanedState);
                persistState(cleanedState);
                setLastSyncedAt(undefined);
                setSyncWritesToday(cs.getSyncTodayWrites());
                setSyncStatus('synced');
                showToast('Deleted all your cloud data and study group entries');
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
                profile: {
                  ...(prev.profile || { nick: '', emoji }),
                  emoji: prev.profile?.nick ? prev.profile.emoji : emoji,
                  updatedAt: now,
                },
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
            onUpdateSubject={handleUpdateSubject}
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
              const rows = [
                'type,date,subject,heading_or_title,minutes_or_score,purity_or_accuracy_pct,note',
              ];
              cur.sessions.forEach((s) => {
                const sub = cur.subjects.find((x) => x.id === s.subjectId);
                const subName = sub ? sub.name : 'General';
                const heading = getSessionHeading(cur, s);
                rows.push(
                  encodeCsvRow([
                    'study_session',
                    s.dayKey,
                    subName,
                    heading,
                    Math.round(s.activeMs / 60000),
                    s.purity || 100,
                    s.note || '',
                  ])
                );
              });
              cur.habits.forEach((h) =>
                Object.entries(cur.log[h.id] || {})
                  .sort()
                  .forEach(([k, e]) => {
                    rows.push(
                      encodeCsvRow(['habit', k, 'Habit', h.name, e.v, 100, ''])
                    );
                  })
              );
              cur.mocks.forEach((m) => {
                const sc = computeMockScore(m, cur.subjects);
                rows.push(
                  encodeCsvRow([
                    'mock_test',
                    m.dayKey,
                    'All Subjects',
                    m.name,
                    sc.totalScore,
                    sc.accuracyPct,
                    m.note || '',
                  ])
                );
              });
              cur.chapters.forEach((ch) => {
                const sub = cur.subjects.find((x) => x.id === ch.subjectId);
                const subName = sub ? sub.name : 'Subject';
                const revs = getSortedChapterRevisions(ch);
                if (revs.length === 0) {
                  rows.push(
                    encodeCsvRow([
                      'chapter',
                      ch.completedOn || '',
                      subName,
                      ch.name,
                      ch.confidence || 0,
                      100,
                      `status:${ch.status}`,
                    ])
                  );
                } else {
                  revs.forEach((r) => {
                    rows.push(
                      encodeCsvRow([
                        'chapter_revision',
                        r.date,
                        subName,
                        `${ch.name} (${r.label})`,
                        r.done ? 1 : 0,
                        100,
                        r.done ? `done:${r.doneOn || r.date}` : 'pending',
                      ])
                    );
                  });
                }
              });
              (cur.mistakes || []).forEach((m) => {
                const sub = cur.subjects.find((x) => x.id === m.subjectId);
                const subName = sub ? sub.name : 'Subject';
                rows.push(
                  encodeCsvRow([
                    'mistake',
                    m.dayKey,
                    subName,
                    m.reason,
                    m.resolved ? 1 : 0,
                    100,
                    m.note || '',
                  ])
                );
              });
              (cur.doubts || []).forEach((d) => {
                const sub = cur.subjects.find((x) => x.id === d.subjectId);
                const subName = sub ? sub.name : 'Subject';
                const dateStr = logicalKey(d.createdAt, cur.set.dayResetHour ?? 0);
                rows.push(
                  encodeCsvRow([
                    'doubt',
                    dateStr,
                    subName,
                    d.text,
                    d.resolved ? 1 : 0,
                    100,
                    d.resolved ? 'resolved' : 'open',
                  ])
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
                  encodeCsvRow([
                    'pyq',
                    p.dayKey,
                    subName,
                    chName,
                    p.attempted,
                    acc,
                    `correct:${p.correct}/${p.attempted}`,
                  ])
                );
              });
              Object.entries(cur.wellbeing || {})
                .sort(([a], [b]) => a.localeCompare(b))
                .forEach(([dk, wb]) => {
                  rows.push(
                    encodeCsvRow([
                      'wellbeing',
                      dk,
                      'Wellbeing',
                      'Sleep & Energy',
                      wb.sleep ?? 0,
                      wb.energy ?? 0,
                      `sleep:${wb.sleep ?? '-'}h energy:${wb.energy ?? '-'}`,
                    ])
                  );
                });
              (cur.restDays || []).forEach((dk) => {
                rows.push(
                  encodeCsvRow(['rest_day', dk, 'Rest Pass', 'Protected Rest Day', 1, 100, ''])
                );
              });
              (cur.tasks || []).forEach((t) => {
                const sub = t.subjectId
                  ? cur.subjects.find((x) => x.id === t.subjectId)
                  : undefined;
                const subName = sub ? sub.name : 'General';
                rows.push(
                  encodeCsvRow([
                    'daily_task',
                    t.dayKey,
                    subName,
                    t.title,
                    t.done ? 1 : 0,
                    100,
                    t.done ? 'done' : 'pending',
                  ])
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
                const parsed = safeJsonParseStrict(await file.text());
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                  throw new Error('Invalid schema');
                }
                const sanitized = sanitizeImportedStatePayload(parsed);
                const restoredBase = norm(sanitized);
                const newToday = logicalKey(new Date(), restoredBase.set.dayResetHour);
                const restored = attachNormalizedTargetsAndReminders(
                  restoredBase,
                  sanitized,
                  newToday
                );
                const allDays = new Set<string>([
                  newToday,
                  ...restored.sessions.map((s) => s.dayKey),
                ]);
                syncStudyHabitsForDays(restored, allDays, newToday);
                setSel(newToday);
                saveNextState(restored, { suppressMilestones: true });
                showToast('Full backup restored!', () => {
                  const snapParsed = safeJsonParseStrict(snapJson);
                  const reverted = attachNormalizedTargetsAndReminders(
                    norm(snapParsed),
                    snapParsed
                  );
                  saveNextState(reverted, { suppressMilestones: true });
                });
              } catch {
                showToast('Invalid Deep Hours JSON backup file');
              }
            }}
              onRequestReset={() => setModal({ type: 'confirmReset' })}
            />
          </Suspense>
          </ErrorBoundary>
        )}
        </main>
      </AppShell>

      <SettingsDrawer
        open={settingsDrawerOpen}
        onClose={() => setSettingsDrawerOpen(false)}
        onSelectSection={openSettingsSection}
        activeSection={isSettingsOpen ? activeSettingsSection : null}
        state={state}
        todayKey={todayKey}
        amoled={amoled}
        cloudUser={authUser}
        syncStatus={syncStatus}
        dailyWritesUsed={syncWritesToday}
        dailyWriteCap={cloudSyncCache?.DAILY_WRITE_CAP ?? 500}
        isOnline={isOnline}
      />

      <StreakDetailSheet
        open={streakSheetOpen}
        onClose={() => setStreakSheetOpen(false)}
        sel={sel}
        todayKey={todayKey}
        minStreakInfo={topBarStreakInfo}
        isSelRestDay={(state.restDays || []).includes(sel)}
        onToggleRestDay={handleToggleRestDay}
      />

      <QuickActionsSheet
        open={quickActionsOpen}
        onClose={() => setQuickActionsOpen(false)}
        onAction={handleQuickAction}
      />

      <CommandPalette
        open={commandPaletteOpen}
        state={state}
        onClose={() => setCommandPaletteOpen(false)}
        onSelectTab={(nextTab) => {
          switchTabWithTransition(nextTab);
          window.scrollTo(0, 0);
        }}
        onSelectPrepSubTab={setPrepSubTab}
        onSelectStatsSubTab={setStatsSubTab}
        onOpenSettings={() => {
          setSettingsDrawerOpen(true);
        }}
        onQuickAction={handleQuickAction}
        onStartChapterFocus={(subjectId, chapterId, chapterName) => {
          switchTabWithTransition('focus');
          startTimer(subjectId, chapterName, undefined, undefined, chapterId);
        }}
        onOpenShortcutsHelp={() => setShortcutsHelpOpen(true)}
      />

      <KeyboardShortcutsSheet
        open={shortcutsHelpOpen}
        onClose={() => setShortcutsHelpOpen(false)}
      />

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
        onDeleteHabit={handleDeleteHabit}
        onSubmitReflection={(subjectId, heading, rating, note, chapterId) => {
          const prev = stateRef.current;
          const { next, savedEntry } = commitSliceInState(prev, Date.now(), {
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
          if (
            shouldOpenSessionWrapUp(savedEntry) ||
            (savedEntry && parkedThoughtsRef.current.length > 0)
          ) {
            setSessionWrapUp(buildSessionWrapUpSummary(savedEntry!));
          } else {
            showToast(`Logged session: ${heading}`);
          }
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
        onSaveMock={(id, mockData, queuedMistakes, openVaultAfter, diagnostics, reportDetails) => {
          const now = Date.now();
          const payload: MockTest = {
            id: id || uid('mock'),
            ...mockData,
            marksPerWrong: -Math.abs(Number(mockData.marksPerWrong) || 0),
            updatedAt: now,
          };
          if (diagnostics) {
            saveMockDiagnostic(payload.id, diagnostics);
          }
          if (reportDetails) {
            saveMockReportDetails(payload.id, reportDetails);
          }
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
          const openVaultHardCapture = () => {
            setSettingsOpen(false);
            setSettingsSection(null);
            setPrepSubTab('mistakes');
            setTab('prep');
            setVaultCaptureRequest({ nonce: Date.now(), kind: 'hard' });
            window.scrollTo(0, 0);
          };
          if (openVaultAfter) {
            openVaultHardCapture();
            showToast(
              `Saved "${payload.name}" (${sc.totalScore}/${payload.maxMarks}) — add hard questions to Vault`
            );
          } else {
            showToast(
              `Saved "${payload.name}" (${sc.totalScore}/${payload.maxMarks})${
                newMistakes.length > 0 ? ` + ${newMistakes.length} mistakes` : ''
              }`,
              undefined,
              {
                durationMs: 6500,
                actionLabel: 'Add to Vault',
                onTap: openVaultHardCapture,
              }
            );
          }
        }}
        onDeleteMock={handleDeleteMock}
        onSaveTimerConfig={(pomoWork, pomoBreak, countdownMins, fullMockMins) => {
          const now = Date.now();
          updateAndSave((prev) => ({
            ...prev,
            set: {
              ...prev.set,
              pomoWork,
              pomoBreak,
              countdownMins,
              fullMockMins: fullMockMins ?? prev.set.fullMockMins ?? 180,
              updatedAt: now,
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
            set: { ...prev.set, dayResetHour: newHour, updatedAt: Date.now() },
            log: cloneLog(prev.log),
            sessions: updatedSessions,
          };
          syncStudyHabitsForDays(next, affectedDays, newToday);
          saveNextState(next);
          setSel(newToday);
          setModal({ type: 'none' });
          showToast(
            `Day reset hour set to ${pad(newHour)}:00${newHour === 0 ? ' (Midnight)' : ' AM'}`
          );
        }}
        onConfirmReset={(eraseVault) => {
          // F1 & A6: Keep whole-state snapshot for "Erase all data"
          const snapJson = JSON.stringify(stateRef.current);
          const diagSnap = loadAllMockDiagnostics();
          const reportSnap = loadAllMockReportDetails();
          const fresh = createBlankState();
          const newToday = logicalKey(new Date(), fresh.set.dayResetHour);
          saveNextState(fresh, { suppressMilestones: true });
          clearAllMockDiagnostics();
          clearAllMockReportDetails();
          setSel(newToday);
          setModal({ type: 'none' });
          if (eraseVault) {
            void clearAllVaultData();
          }
          showToast(
            eraseVault
              ? 'All device data and local Vault erased'
              : 'All device data reset to a clean slate',
            () => {
              const snapParsed = JSON.parse(snapJson);
              const reverted = attachNormalizedTargetsAndReminders(norm(snapParsed), snapParsed);
              replaceAllMockDiagnostics(diagSnap);
              for (const [mId, rep] of Object.entries(reportSnap)) {
                saveMockReportDetails(mId, rep);
              }
              saveNextState(reverted, { suppressMilestones: true });
            }
          );
        }}
      />

      <SessionWrapUpSheet
        summary={sessionWrapUp}
        subject={
          sessionWrapUp
            ? state.subjects.find((s) => s.id === sessionWrapUp.subjectId)
            : undefined
        }
        chapter={
          sessionWrapUp?.chapterId
            ? state.chapters.find((c) => c.id === sessionWrapUp.chapterId)
            : undefined
        }
        parkedThoughts={parkedThoughts}
        onClose={() => setSessionWrapUp(null)}
        onSnapToVault={(subjectId, chapterId) => {
          setSessionWrapUp(null);
          setSettingsOpen(false);
          setSettingsSection(null);
          setPrepSubTab('mistakes');
          setTab('prep');
          setVaultCaptureRequest({
            nonce: Date.now(),
            kind: 'unsolved',
            subjectId,
            chapterId,
          });
          window.scrollTo(0, 0);
        }}
        onSetChapterConfidence={(chapterId, confidence) => {
          handleUpdateChapter(chapterId, { confidence });
          showToast(`Updated chapter confidence (${confidence}/5)`);
        }}
        onAddThoughtToTodayTasks={(thought) => {
          const payload = buildTaskPayloadFromThought(
            thought,
            todayKey,
            sessionWrapUp?.subjectId
          );
          handleAddTask(payload.title, payload.dayKey, payload.subjectId);
          handleRemoveParkedThought(thought.id);
          showToast(`Added to Today's tasks: ${payload.title}`);
        }}
        onDismissThought={(thoughtId) => {
          handleRemoveParkedThought(thoughtId);
        }}
        onShareProofCard={
          sessionWrapUp
            ? () => {
                const s = sessionWrapUp;
                const isAll = isAllSubjectsMockId(s.subjectId);
                const sub = isAll
                  ? undefined
                  : state.subjects.find((x) => x.id === s.subjectId);
                const chap = s.chapterId
                  ? state.chapters.find((c) => c.id === s.chapterId)
                  : undefined;
                const streakInfo = computeMinDayStreak(state, todayKey);
                setSessionWrapUp(null);
                setProofCardPayload({
                  kind: 'session',
                  durationMs: s.activeMs,
                  subjectLabel: isAll
                    ? `${ALL_SUBJECTS_LABEL} · Full Mock`
                    : sub?.name || 'Study Session',
                  subjectColor: isAll
                    ? ALL_SUBJECTS_COLOR
                    : sub?.color || ALL_SUBJECTS_COLOR,
                  chapterName: chap?.name,
                  topicHeading: s.heading,
                  focusPurity: s.purity,
                  streakDays: streakInfo.streak,
                  dateLabel: formatProofDateLabel(todayKey),
                  dayKey: todayKey,
                  modeLabel: isAll ? 'Full Mock' : 'Focus',
                });
              }
            : undefined
        }
      />

      <ProofCardSheet
        payload={proofCardPayload}
        onClose={() => setProofCardPayload(null)}
        onToast={showToast}
      />

      {showProfileModal && (
        <Suspense fallback={null}>
          <ProfileModal
            profile={state.profile || { nick: '', emoji: state.set.avatarEmoji || '🩺' }}
            promptReason={profilePromptReason}
            onClose={() => {
              setShowProfileModal(false);
              setProfilePromptReason(undefined);
            }}
            onSave={(nextProfile: UserProfile) => {
              updateAndSave((prev) => ({
                ...prev,
                profile: nextProfile,
                set: {
                  ...prev.set,
                  avatarEmoji: nextProfile.emoji,
                  updatedAt: nextProfile.updatedAt || Date.now(),
                },
              }));
              setShowProfileModal(false);
              setProfilePromptReason(undefined);
              showToast(`Saved profile: ${nextProfile.emoji} ${nextProfile.nick}`);
            }}
          />
        </Suspense>
      )}

      {onboardingOpen && (
        <Suspense fallback={null}>
          <OnboardingSheet
            open={onboardingOpen}
            state={state}
            todayKey={todayKey}
            onClose={() => {
              safeLocalStorageSet('dh_onboarded_v2', '1');
              setOnboardingOpen(false);
            }}
            onComplete={(result: OnboardingResult) => {
              safeLocalStorageSet('dh_onboarded_v2', '1');
              const now = Date.now();
              const activeSet = new Set(result.activeSubjectIds);
              updateAndSave((prev) => {
                const updatedSubjects = prev.subjects.map((s) => ({
                  ...s,
                  arch: (activeSet.has(s.id) ? 0 : 1) as 0 | 1,
                  updatedAt: now,
                }));
                let nextDdays = prev.ddays;
                if (result.examTitle && result.examDate) {
                  const cleanTitle = result.examTitle.trim();
                  const newDday: DDay = {
                    id: uid('dd'),
                    title: cleanTitle,
                    date: result.examDate,
                    e: cleanTitle.includes('INI')
                      ? '🧬'
                      : cleanTitle.includes('FMGE')
                        ? '⚕️'
                        : '🩺',
                    color: LUMEN_ACCENT,
                    primary: true,
                    updatedAt: now,
                  };
                  nextDdays = [
                    ...prev.ddays.map((d) => ({ ...d, primary: false, updatedAt: now })),
                    newDday,
                  ];
                }
                return {
                  ...prev,
                  ob: 1,
                  subjects: updatedSubjects,
                  ddays: nextDdays,
                  set: {
                    ...prev.set,
                    targets: {
                      ...(prev.set.targets || {}),
                      minDayMinutes: result.minDayMinutes,
                      restPassesPerMonth: prev.set.targets?.restPassesPerMonth ?? 2,
                    },
                    updatedAt: now,
                  },
                };
              });
              setOnboardingOpen(false);
              showToast('Workspace ready — start your first focus block!');
            }}
          />
        </Suspense>
      )}

      {/* Lazy 3D Milestone Reward Burst Overlay (Level-Up, 7d/30d Streak, Perfect Day) */}
      {rewardBurst && (
        <Suspense fallback={null}>
          <RewardBurstDialog
            burst={rewardBurst}
            ui3dSetting={state.set.ui3d || 'auto'}
            ui3dQuality={state.set.ui3dQuality || 'auto'}
            sndEnabled={Boolean(state.set.snd)}
            onClose={() => setRewardBurst(null)}
          />
        </Suspense>
      )}

      {/* Toast Notification (supports Undo or Service Worker tap-to-reload) */}
      {toastState && (
        <Toast
          message={toastState.msg}
          onUndo={toastState.undoFn}
          actionLabel={toastState.actionLabel}
          onAction={toastState.onTap}
          onDismiss={() => setToastState(null)}
        />
      )}

      {/* Hidden offscreen High-DPI 2x Canvas & Video for Android Chrome PiP Stream (16:9 960x540) */}
      <canvas
        id="pipCanvas"
        ref={canvasRef}
        width={960}
        height={540}
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
