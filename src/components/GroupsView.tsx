import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  GroupSharingFlags,
  GroupsUserConfig,
  JoinedGroupPreference,
  PulseHabitState,
  UserProfile,
} from '../types';
import {
  ALLOWED_CHEER_EMOJIS,
  type CachedGroupSnapshot,
  type CheerEmoji,
  DEFAULT_SHARING_FLAGS,
  GROUP_AUTO_REFRESH_MS,
  GROUP_CACHE_STALE_MS,
  GROUP_MANUAL_REFRESH_COOLDOWN_MS,
  type GroupPublishBudgetController,
  MAX_JOINED_GROUPS,
  type MockSortMode,
  type XpSortMode,
  cleanupOldOwnCheers,
  computeCompletedWeekStandings,
  computeMemberMedals,
  computeWeeklyGroupGoalProgress,
  createGroupInCloud,
  fetchGroupSnapshotFromCloud,
  formatGroupCode,
  formatMinutesAsHoursMins,
  getActiveStudyingNowMembers,
  joinGroupInCloud,
  leaveGroupInCloud,
  loadCachedGroupSnapshots,
  ownerCloseGroupInCloud,
  ownerUpdateGroupSettings,
  publishMyEntryToGroup,
  rankMocksBoard,
  rankStreakBoard,
  rankTodayBoard,
  rankWeekBoard,
  rankXpBoard,
  recordWeekStandingInHistory,
  sendCheerInCloud,
  validateNickname,
} from '../utils/groups';

type BoardTab = 'today' | 'week' | 'xp' | 'streak' | 'mocks' | 'history';

const GROUP_EMOJIS = ['🩺', '🧬', '🔬', '⚕️', '🔥', '🎯', '📚', '⚡', '🧠', '🏆'];

function formatRelativeAgo(ts: number, now: number): string {
  if (!ts || ts <= 0) return 'never';
  const diffSec = Math.max(0, Math.floor((now - ts) / 1000));
  if (diffSec < 45) return 'just now';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

interface GroupsViewProps {
  state: PulseHabitState;
  todayKey: string;
  myUid: string | null;
  isOnline: boolean;
  groupBudget: GroupPublishBudgetController;
  onSignIn: () => void;
  onOpenProfileModal: (reason?: string) => void;
  onUpdateGroupsConfig: (
    updater: (prev: GroupsUserConfig) => GroupsUserConfig
  ) => void;
  onRecordWeekHistory: (
    groupId: string,
    weekKey: string,
    standing: { rank: number; of: number; minutes: number; xp: number }
  ) => void;
  showToast: (msg: string) => void;
}

export const GroupsView: React.FC<GroupsViewProps> = ({
  state,
  todayKey,
  myUid,
  isOnline,
  groupBudget,
  onSignIn,
  onOpenProfileModal,
  onUpdateGroupsConfig,
  onRecordWeekHistory,
  showToast,
}) => {
  const groupsConfig: GroupsUserConfig = state.groupsConfig || {
    consentAccepted: false,
    joined: [],
  };
  const joinedGroups = groupsConfig.joined || [];
  const activeGroupId =
    groupsConfig.activeGroupId &&
    joinedGroups.some((g) => g.groupId === groupsConfig.activeGroupId)
      ? groupsConfig.activeGroupId
      : joinedGroups[0]?.groupId || '';

  const activeGroupPref: JoinedGroupPreference | undefined = joinedGroups.find(
    (g) => g.groupId === activeGroupId
  );

  const [snapshots, setSnapshots] = useState<Record<string, CachedGroupSnapshot>>(() =>
    loadCachedGroupSnapshots()
  );
  const [boardTab, setBoardTab] = useState<BoardTab>('today');
  const [xpSortMode, setXpSortMode] = useState<XpSortMode>('weekly');
  const [mockSortMode, setMockSortMode] = useState<MockSortMode>('latest');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastManualRefreshTs, setLastManualRefreshTs] = useState(0);
  const [nowTick, setNowTick] = useState(() => Date.now());

  // Create / Join modal state
  const [dialogMode, setDialogMode] = useState<'none' | 'create' | 'join'>('none');
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupEmoji, setNewGroupEmoji] = useState('🩺');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Owner tools state
  const [ownerEditName, setOwnerEditName] = useState('');
  const [ownerEditEmoji, setOwnerEditEmoji] = useState('🩺');
  const [ownerGoalHoursInput, setOwnerGoalHoursInput] = useState('');
  const [confirmLeaveGroupId, setConfirmLeaveGroupId] = useState<string | null>(null);
  const [confirmCloseGroupId, setConfirmCloseGroupId] = useState<string | null>(null);
  const [confirmKickUid, setConfirmKickUid] = useState<string | null>(null);
  const [sentCheersLocal, setSentCheersLocal] = useState<Record<string, CheerEmoji>>({});

  const cleanupRanForGroupRef = useRef<Set<string>>(new Set());

  // Tick every 30s to keep relative timestamps ("updated X ago") fresh
  useEffect(() => {
    const iv = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(iv);
  }, []);

  const activeSnapshot = activeGroupId ? snapshots[activeGroupId] : undefined;
  const activeGroupDoc = activeSnapshot?.doc;

  // Keep owner inputs synced with active group doc
  useEffect(() => {
    if (activeGroupDoc) {
      setOwnerEditName(activeGroupDoc.name);
      setOwnerEditEmoji(activeGroupDoc.emoji);
      setOwnerGoalHoursInput(
        activeGroupDoc.goal?.weeklyMinutes
          ? String(Math.round((activeGroupDoc.goal.weeklyMinutes / 60) * 10) / 10)
          : ''
      );
      if (boardTab === 'mocks' && !activeGroupDoc.mockBoard) {
        setBoardTab('today');
      }
    }
  }, [activeGroupId, activeGroupDoc?.name, activeGroupDoc?.emoji, activeGroupDoc?.goal?.weeklyMinutes, activeGroupDoc?.mockBoard, boardTab]);

  // Refresh a group snapshot from Firestore
  const refreshGroup = useCallback(
    async (groupId: string, manual = false) => {
      if (!myUid || !groupId || !isOnline) return;
      if (manual) {
        const elapsed = Date.now() - lastManualRefreshTs;
        if (elapsed < GROUP_MANUAL_REFRESH_COOLDOWN_MS) {
          const waitSec = Math.ceil((GROUP_MANUAL_REFRESH_COOLDOWN_MS - elapsed) / 1000);
          showToast(`Please wait ${waitSec}s before refreshing again.`);
          return;
        }
        setLastManualRefreshTs(Date.now());
      }
      setIsRefreshing(true);
      try {
        const snap = await fetchGroupSnapshotFromCloud({
          groupId,
          todayKey,
          budget: groupBudget,
        });
        if (snap) {
          setSnapshots((prev) => ({ ...prev, [groupId]: snap }));
          // Update local group name/emoji in joined preferences if changed
          onUpdateGroupsConfig((prev) => {
            const existing = prev.joined.find((j) => j.groupId === groupId);
            if (
              !existing ||
              (existing.name === snap.doc.name && existing.emoji === snap.doc.emoji)
            ) {
              return prev;
            }
            return {
              ...prev,
              joined: prev.joined.map((j) =>
                j.groupId === groupId
                  ? { ...j, name: snap.doc.name, emoji: snap.doc.emoji }
                  : j
              ),
            };
          });

          // Milestone 2.6: Check and record last week's completed standings
          const completedStanding = computeCompletedWeekStandings(snap.doc, todayKey);
          if (completedStanding && myUid && completedStanding.standings[myUid]) {
            const myStanding = completedStanding.standings[myUid];
            const existingHist =
              state.groupHistory?.[groupId]?.[completedStanding.weekKey];
            if (!existingHist) {
              onRecordWeekHistory(groupId, completedStanding.weekKey, myStanding);
            }
          }

          // Milestone 2.3: Occasional cleanup of own cheers older than 14 days
          if (!cleanupRanForGroupRef.current.has(groupId)) {
            cleanupRanForGroupRef.current.add(groupId);
            void cleanupOldOwnCheers({
              groupId,
              todayKey,
              budget: groupBudget,
            });
          }
        } else {
          // Group was closed/deleted by owner or user was removed
          setSnapshots((prev) => {
            const next = { ...prev };
            delete next[groupId];
            return next;
          });
        }
      } catch (err) {
        if (manual) {
          showToast(
            err instanceof Error ? err.message : 'Could not refresh group right now.'
          );
        }
      } finally {
        setIsRefreshing(false);
        setNowTick(Date.now());
      }
    },
    [
      myUid,
      isOnline,
      lastManualRefreshTs,
      todayKey,
      groupBudget,
      onUpdateGroupsConfig,
      state.groupHistory,
      onRecordWeekHistory,
      showToast,
    ]
  );

  // Auto-refresh on open if cache > 5m old, and every 3m while visible
  useEffect(() => {
    if (!myUid || !activeGroupId || !isOnline) return;
    const cached = loadCachedGroupSnapshots()[activeGroupId];
    const age = cached ? Date.now() - cached.fetchedAt : Infinity;
    if (age > GROUP_CACHE_STALE_MS) {
      void refreshGroup(activeGroupId, false);
    }
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      void refreshGroup(activeGroupId, false);
    }, GROUP_AUTO_REFRESH_MS);
    return () => clearInterval(interval);
  }, [myUid, activeGroupId, isOnline, refreshGroup]);

  const ensureValidProfileBeforeGroupAction = (actionLabel: string): boolean => {
    const check = validateNickname(state.profile?.nick || '');
    if (!check.valid) {
      onOpenProfileModal(
        `Set an anonymous nickname (2–20 chars) before you ${actionLabel}.`
      );
      return false;
    }
    return true;
  };

  const handleAcceptConsent = () => {
    onUpdateGroupsConfig((prev) => ({
      ...prev,
      consentAccepted: true,
      updatedAt: Date.now(),
    }));
    const check = validateNickname(state.profile?.nick || '');
    if (!check.valid) {
      onOpenProfileModal('Choose your anonymous nickname for Study Groups.');
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ensureValidProfileBeforeGroupAction('create a group')) return;
    if (joinedGroups.length >= MAX_JOINED_GROUPS) {
      setActionError(`You can join at most ${MAX_JOINED_GROUPS} groups.`);
      return;
    }
    setActionBusy(true);
    setActionError(null);
    try {
      const { groupId, groupDoc } = await createGroupInCloud({
        name: newGroupName,
        emoji: newGroupEmoji,
        state,
        todayKey,
        sh: DEFAULT_SHARING_FLAGS,
        budget: groupBudget,
      });
      const now = Date.now();
      onUpdateGroupsConfig((prev) => ({
        ...prev,
        consentAccepted: true,
        activeGroupId: groupId,
        updatedAt: now,
        joined: [
          ...prev.joined.filter((j) => j.groupId !== groupId),
          {
            groupId,
            name: groupDoc.name,
            emoji: groupDoc.emoji,
            joinedAt: now,
            sh: { ...DEFAULT_SHARING_FLAGS },
          },
        ].slice(0, MAX_JOINED_GROUPS),
      }));
      setSnapshots((prev) => ({
        ...prev,
        [groupId]: {
          groupId,
          doc: groupDoc,
          fetchedAt: now,
          receivedCheers: [],
        },
      }));
      setNewGroupName('');
      setDialogMode('none');
      showToast(`Created group "${groupDoc.name}"!`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to create group.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleJoinGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ensureValidProfileBeforeGroupAction('join a group')) return;
    if (joinedGroups.length >= MAX_JOINED_GROUPS) {
      setActionError(`You can join at most ${MAX_JOINED_GROUPS} groups.`);
      return;
    }
    setActionBusy(true);
    setActionError(null);
    try {
      const { groupId, groupDoc } = await joinGroupInCloud({
        rawCode: joinCodeInput,
        state,
        todayKey,
        sh: DEFAULT_SHARING_FLAGS,
        budget: groupBudget,
      });
      const now = Date.now();
      onUpdateGroupsConfig((prev) => ({
        ...prev,
        consentAccepted: true,
        activeGroupId: groupId,
        updatedAt: now,
        joined: [
          ...prev.joined.filter((j) => j.groupId !== groupId),
          {
            groupId,
            name: groupDoc.name,
            emoji: groupDoc.emoji,
            joinedAt: now,
            sh: { ...DEFAULT_SHARING_FLAGS },
          },
        ].slice(0, MAX_JOINED_GROUPS),
      }));
      setSnapshots((prev) => ({
        ...prev,
        [groupId]: {
          groupId,
          doc: groupDoc,
          fetchedAt: now,
          receivedCheers: [],
        },
      }));
      setJoinCodeInput('');
      setDialogMode('none');
      showToast(`Joined "${groupDoc.name}"!`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to join group.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleLeaveGroup = async (groupId: string) => {
    setActionBusy(true);
    try {
      await leaveGroupInCloud({ groupId, budget: groupBudget });
      onUpdateGroupsConfig((prev) => {
        const remaining = prev.joined.filter((j) => j.groupId !== groupId);
        return {
          ...prev,
          joined: remaining,
          activeGroupId:
            prev.activeGroupId === groupId ? remaining[0]?.groupId : prev.activeGroupId,
          updatedAt: Date.now(),
        };
      });
      setSnapshots((prev) => {
        const next = { ...prev };
        delete next[groupId];
        return next;
      });
      setConfirmLeaveGroupId(null);
      showToast('Left study group.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to leave group.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleToggleSharingFlag = async (
    flagKey: keyof GroupSharingFlags | 'paused',
    nextVal: boolean
  ) => {
    if (!activeGroupPref || !activeGroupId) return;
    const nextSh: GroupSharingFlags =
      flagKey === 'paused'
        ? { ...activeGroupPref.sh }
        : { ...activeGroupPref.sh, [flagKey]: nextVal };
    const nextPaused = flagKey === 'paused' ? nextVal : Boolean(activeGroupPref.paused);

    onUpdateGroupsConfig((prev) => ({
      ...prev,
      updatedAt: Date.now(),
      joined: prev.joined.map((j) =>
        j.groupId === activeGroupId
          ? {
              ...j,
              sh: nextSh,
              ...(nextPaused ? { paused: true } : { paused: undefined }),
            }
          : j
      ),
    }));

    // Queue debounced publish and immediately update local snapshot preview
    try {
      const updatedEntry = await publishMyEntryToGroup({
        groupId: activeGroupId,
        state,
        todayKey,
        joinedAt: activeGroupPref.joinedAt,
        sh: nextSh,
        paused: nextPaused,
        budget: groupBudget,
        force: true,
      });
      if (updatedEntry && myUid && activeGroupDoc) {
        setSnapshots((prev) => {
          const cur = prev[activeGroupId];
          if (!cur) return prev;
          return {
            ...prev,
            [activeGroupId]: {
              ...cur,
              doc: {
                ...cur.doc,
                members: {
                  ...cur.doc.members,
                  [myUid]: updatedEntry,
                },
              },
            },
          };
        });
      }
    } catch {
      groupBudget.markGroupDirty(activeGroupId);
    }
  };

  const handleCopyInvite = async (code: string) => {
    const formatted = formatGroupCode(code);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(formatted);
        showToast(`Invite code ${formatted} copied!`);
      }
    } catch {
      showToast(`Invite code: ${formatted}`);
    }
  };

  const handleShareInvite = async (code: string, name: string) => {
    const formatted = formatGroupCode(code);
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: `Join "${name}" on Deep Hours`,
          text: `Join our NEET study group "${name}" on Deep Hours with invite code: ${formatted}`,
        });
        return;
      } catch {
        // Fallback to copy if share sheet dismissed
      }
    }
    await handleCopyInvite(code);
  };

  const handleSendCheer = async (toUid: string, toNick: string, emoji: CheerEmoji) => {
    if (!activeGroupId || !myUid) return;
    if (!groupBudget.canSendCheer()) {
      showToast('Daily cheer limit (10/day) reached.');
      return;
    }
    const myNick = state.profile?.nick || 'Member';
    try {
      await sendCheerInCloud({
        groupId: activeGroupId,
        toUid,
        fromNick: myNick,
        dayKey: todayKey,
        emoji,
        budget: groupBudget,
      });
      setSentCheersLocal((prev) => ({
        ...prev,
        [`${activeGroupId}_${toUid}_${todayKey}`]: emoji,
      }));
      showToast(`Sent ${emoji} to ${toNick}!`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not send cheer.');
    }
  };

  const handleOwnerSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeGroupId || !activeGroupDoc) return;
    setActionBusy(true);
    try {
      const parsedGoalHours = ownerGoalHoursInput.trim()
        ? Number(ownerGoalHoursInput.trim())
        : null;
      await ownerUpdateGroupSettings({
        groupId: activeGroupId,
        name: ownerEditName,
        emoji: ownerEditEmoji,
        weeklyGoalHours:
          parsedGoalHours !== null && Number.isFinite(parsedGoalHours) && parsedGoalHours >= 1
            ? parsedGoalHours
            : null,
        budget: groupBudget,
      });
      await refreshGroup(activeGroupId, false);
      showToast('Group settings updated.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update group.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleOwnerToggleMockBoard = async (enabled: boolean) => {
    if (!activeGroupId) return;
    setActionBusy(true);
    try {
      await ownerUpdateGroupSettings({
        groupId: activeGroupId,
        mockBoard: enabled,
        budget: groupBudget,
      });
      await refreshGroup(activeGroupId, false);
      showToast(enabled ? 'Mock leaderboard enabled.' : 'Mock leaderboard hidden.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to toggle mock board.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleOwnerRemoveMember = async (targetUid: string, targetNick: string) => {
    if (!activeGroupId) return;
    setActionBusy(true);
    try {
      await ownerUpdateGroupSettings({
        groupId: activeGroupId,
        removeMemberUid: targetUid,
        budget: groupBudget,
      });
      setConfirmKickUid(null);
      await refreshGroup(activeGroupId, false);
      showToast(`Removed ${targetNick} from group.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to remove member.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleOwnerCloseGroup = async (groupId: string) => {
    setActionBusy(true);
    try {
      await ownerCloseGroupInCloud({ groupId, budget: groupBudget });
      onUpdateGroupsConfig((prev) => {
        const remaining = prev.joined.filter((j) => j.groupId !== groupId);
        return {
          ...prev,
          joined: remaining,
          activeGroupId:
            prev.activeGroupId === groupId ? remaining[0]?.groupId : prev.activeGroupId,
          updatedAt: Date.now(),
        };
      });
      setSnapshots((prev) => {
        const next = { ...prev };
        delete next[groupId];
        return next;
      });
      setConfirmCloseGroupId(null);
      showToast('Study group closed and deleted.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to close group.');
    } finally {
      setActionBusy(false);
    }
  };

  // Computed leaderboard rows for active group
  const rankedRows = useMemo(() => {
    if (!activeGroupDoc) return [];
    const members = activeGroupDoc.members || {};
    switch (boardTab) {
      case 'today':
        return rankTodayBoard(members, todayKey);
      case 'week':
        return rankWeekBoard(members, todayKey);
      case 'xp':
        return rankXpBoard(members, todayKey, xpSortMode);
      case 'streak':
        return rankStreakBoard(members, todayKey);
      case 'mocks':
        return rankMocksBoard(members, todayKey, mockSortMode);
      default:
        return [];
    }
  }, [activeGroupDoc, boardTab, todayKey, xpSortMode, mockSortMode]);

  const studyingNowList = useMemo(() => {
    if (!activeGroupDoc || !activeSnapshot) return [];
    return getActiveStudyingNowMembers(activeGroupDoc, activeSnapshot.fetchedAt, nowTick);
  }, [activeGroupDoc, activeSnapshot, nowTick]);

  const weeklyGoalProg = useMemo(() => {
    if (!activeGroupDoc) return null;
    return computeWeeklyGroupGoalProgress(activeGroupDoc, todayKey);
  }, [activeGroupDoc, todayKey]);

  const todayCheersReceived = useMemo(() => {
    if (!activeSnapshot?.receivedCheers) return [];
    return activeSnapshot.receivedCheers.filter((c) => c.dayKey === todayKey);
  }, [activeSnapshot, todayKey]);

  // 1. Signed-out state
  if (!myUid) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 24 }}>
        <div style={{ fontSize: 38, marginBottom: 8 }} aria-hidden="true">
          🏆
        </div>
        <b style={{ fontSize: 16, display: 'block', marginBottom: 6 }}>
          NEET Study Groups & Leaderboards
        </b>
        <p className="mut" style={{ fontSize: 13, maxWidth: 360, margin: '0 auto 16px' }}>
          Study with up to 3 private groups using invite codes. Compare timer-tracked hours, XP v2,
          and consistency streaks while keeping your identity 100% anonymous.
        </p>
        <button
          type="button"
          className="btn pri"
          onClick={onSignIn}
          style={{ minHeight: 44, padding: '0 20px' }}
        >
          Sign in with Google to use Groups
        </button>
      </div>
    );
  }

  // 2. First-time privacy consent screen
  if (!groupsConfig.consentAccepted) {
    return (
      <div className="card" style={{ padding: 20 }}>
        <div className="row" style={{ gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 28 }} aria-hidden="true">
            🛡️
          </span>
          <div>
            <b style={{ fontSize: 16 }}>Privacy-First Study Groups</b>
            <div className="mut" style={{ fontSize: 12 }}>
              How group sharing works in Deep Hours
            </div>
          </div>
        </div>
        <ul
          style={{
            margin: '0 0 16px',
            paddingLeft: 18,
            fontSize: 13,
            lineHeight: 1.55,
            color: 'var(--tx)',
          }}
        >
          <li style={{ marginBottom: 6 }}>
            <b>Anonymous by design:</b> Your Google email, real name, and account ID are never
            visible to other members. You pick an anonymous nickname & emoji.
          </li>
          <li style={{ marginBottom: 6 }}>
            <b>Timer-verified fairness:</b> Only timer-tracked sessions count toward group study
            time and XP. Manual sessions stay in your personal log only.
          </li>
          <li style={{ marginBottom: 6 }}>
            <b>Granular controls:</b> You can toggle Study Time, XP, Streak, Mock Scores (OFF by
            default), and Studying-Now status per group, or pause sharing anytime.
          </li>
        </ul>
        <button
          type="button"
          className="btn pri"
          onClick={handleAcceptConsent}
          style={{ minHeight: 44, width: '100%' }}
        >
          I Understand — Continue to Groups
        </button>
      </div>
    );
  }

  const memberCount = activeGroupDoc ? Object.keys(activeGroupDoc.members || {}).length : 0;
  const isOwner = Boolean(activeGroupDoc && myUid && activeGroupDoc.ownerUid === myUid);
  const refreshCooldownLeftSec = Math.max(
    0,
    Math.ceil((GROUP_MANUAL_REFRESH_COOLDOWN_MS - (nowTick - lastManualRefreshTs)) / 1000)
  );

  return (
    <div>
      {/* Top Bar: Profile Badge + Group Chips + Create / Join */}
      <div className="card" style={{ padding: 14, marginBottom: 12 }}>
        <div className="row sp" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn s"
              onClick={() => onOpenProfileModal()}
              aria-label="Edit anonymous group profile"
              style={{ minHeight: 44, padding: '0 12px', fontSize: 13 }}
            >
              <span>{state.profile?.emoji || '🩺'}</span>{' '}
              <b>{state.profile?.nick || 'Set Nickname'}</b>
              {state.profile?.examYear ? (
                <span className="mut" style={{ fontSize: 11, marginLeft: 4 }}>
                  '{String(state.profile.examYear).slice(-2)}
                </span>
              ) : null}{' '}
              <span className="mut" style={{ fontSize: 11, marginLeft: 4 }}>
                ✎
              </span>
            </button>
          </div>

          <div className="row" style={{ gap: 6 }}>
            {joinedGroups.length < MAX_JOINED_GROUPS ? (
              <>
                <button
                  type="button"
                  className="btn pri"
                  onClick={() => {
                    if (!ensureValidProfileBeforeGroupAction('create a group')) return;
                    setActionError(null);
                    setDialogMode(dialogMode === 'create' ? 'none' : 'create');
                  }}
                  style={{ minHeight: 44, padding: '0 12px', fontSize: 12 }}
                >
                  + Create
                </button>
                <button
                  type="button"
                  className="btn s"
                  onClick={() => {
                    if (!ensureValidProfileBeforeGroupAction('join a group')) return;
                    setActionError(null);
                    setDialogMode(dialogMode === 'join' ? 'none' : 'join');
                  }}
                  style={{ minHeight: 44, padding: '0 12px', fontSize: 12 }}
                >
                  🔑 Join Code
                </button>
              </>
            ) : (
              <span className="pill" style={{ fontSize: 11 }}>
                {joinedGroups.length}/{MAX_JOINED_GROUPS} groups joined
              </span>
            )}
          </div>
        </div>

        {/* Group Selector Chips */}
        {joinedGroups.length > 0 && (
          <div
            className="chips"
            style={{ overflowX: 'auto', paddingBottom: 2, gap: 6, flexWrap: 'nowrap' }}
          >
            {joinedGroups.map((g) => {
              const snapDoc = snapshots[g.groupId]?.doc;
              const label = snapDoc?.name || g.name || formatGroupCode(g.groupId);
              const em = snapDoc?.emoji || g.emoji || '🩺';
              const isSelected = g.groupId === activeGroupId;
              return (
                <button
                  key={g.groupId}
                  type="button"
                  className={`chip ${isSelected ? 'on' : ''}`}
                  onClick={() =>
                    onUpdateGroupsConfig((prev) => ({
                      ...prev,
                      activeGroupId: g.groupId,
                    }))
                  }
                  style={{ minHeight: 44, whiteSpace: 'nowrap' }}
                >
                  {em} {label}
                </button>
              );
            })}
          </div>
        )}

        {/* Inline Create Group Form */}
        {dialogMode === 'create' && (
          <form
            onSubmit={handleCreateGroup}
            style={{
              marginTop: 12,
              paddingTop: 12,
              borderTop: '1px solid var(--bd)',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
              Create a New Study Group
            </div>
            <div style={{ marginBottom: 10 }}>
              <input
                type="text"
                placeholder="Group Name (e.g. AIIMS Delhi 2026 Squad)"
                maxLength={32}
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                aria-label="New study group name"
                style={{ minHeight: 44, width: '100%' }}
                required
              />
            </div>
            <div className="chips" style={{ marginBottom: 10, gap: 6, flexWrap: 'wrap' }}>
              {GROUP_EMOJIS.map((em) => (
                <button
                  key={em}
                  type="button"
                  className={`chip ${newGroupEmoji === em ? 'on' : ''}`}
                  onClick={() => setNewGroupEmoji(em)}
                  style={{ minHeight: 40 }}
                >
                  {em}
                </button>
              ))}
            </div>
            {actionError && (
              <div style={{ color: '#f43f5e', fontSize: 12, marginBottom: 8 }}>
                {actionError}
              </div>
            )}
            <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn s"
                onClick={() => setDialogMode('none')}
                style={{ minHeight: 44 }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn pri"
                disabled={actionBusy}
                style={{ minHeight: 44 }}
              >
                {actionBusy ? 'Creating…' : 'Create Group'}
              </button>
            </div>
          </form>
        )}

        {/* Inline Join Group Form */}
        {dialogMode === 'join' && (
          <form
            onSubmit={handleJoinGroup}
            style={{
              marginTop: 12,
              paddingTop: 12,
              borderTop: '1px solid var(--bd)',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
              Join with 10-Character Invite Code
            </div>
            <div className="row" style={{ gap: 8, marginBottom: 8 }}>
              <input
                type="text"
                placeholder="ABCDE-23456"
                maxLength={15}
                value={joinCodeInput}
                onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                aria-label="Group invite code"
                className="mono"
                style={{ minHeight: 44, flex: 1, letterSpacing: 1 }}
                required
              />
              <button
                type="submit"
                className="btn pri"
                disabled={actionBusy}
                style={{ minHeight: 44, padding: '0 16px' }}
              >
                {actionBusy ? 'Joining…' : 'Join'}
              </button>
              <button
                type="button"
                className="btn s"
                onClick={() => setDialogMode('none')}
                style={{ minHeight: 44 }}
              >
                Cancel
              </button>
            </div>
            {actionError && (
              <div style={{ color: '#f43f5e', fontSize: 12, marginTop: 4 }}>
                {actionError}
              </div>
            )}
          </form>
        )}
      </div>

      {/* Empty state when user hasn't joined any group yet */}
      {joinedGroups.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 24 }}>
          <div style={{ fontSize: 34, marginBottom: 8 }} aria-hidden="true">
            🤝
          </div>
          <b style={{ fontSize: 15, display: 'block', marginBottom: 6 }}>
            No Study Groups Yet
          </b>
          <p className="mut" style={{ fontSize: 13, maxWidth: 340, margin: '0 auto 14px' }}>
            Tap <b>+ Create</b> to start a private group for your batchmates or <b>🔑 Join Code</b>{' '}
            to enter a 10-character invite code.
          </p>
          {!validateNickname(state.profile?.nick || '').valid && (
            <button
              type="button"
              className="btn s"
              onClick={() =>
                onOpenProfileModal(
                  'Configure your anonymous nickname (2–20 chars) and emoji avatar before joining a group.'
                )
              }
              style={{ minHeight: 44, padding: '0 16px' }}
            >
              {state.profile?.emoji || '🩺'} Configure Study Profile First
            </button>
          )}
        </div>
      )}

      {/* Loading / Uncached state when a group is selected but snapshot hasn't loaded yet */}
      {activeGroupId && !activeGroupDoc && (
        <div className="card" style={{ textAlign: 'center', padding: 24, marginBottom: 12 }}>
          <div style={{ fontSize: 30, marginBottom: 8 }} aria-hidden="true">
            {isRefreshing ? '⏳' : '📡'}
          </div>
          <b style={{ fontSize: 15, display: 'block', marginBottom: 6 }}>
            {isRefreshing ? 'Loading Group Leaderboard…' : 'Group Snapshot Unavailable Offline'}
          </b>
          <p className="mut" style={{ fontSize: 13, maxWidth: 340, margin: '0 auto 14px' }}>
            {isRefreshing
              ? 'Fetching latest study hours and XP standings from Cloud Firestore…'
              : 'Connect to the internet and tap Refresh to load this study group.'}
          </p>
          <button
            type="button"
            className="btn pri"
            disabled={isRefreshing || !isOnline}
            onClick={() => refreshGroup(activeGroupId, true)}
            style={{ minHeight: 44, padding: '0 18px' }}
          >
            🔄 {isRefreshing ? 'Refreshing…' : 'Refresh Group'}
          </button>
        </div>
      )}

      {/* Active Group Dashboard */}
      {activeGroupId && activeGroupDoc && (
        <>
          {/* Group Header Card */}
          <div className="card" style={{ padding: 14, marginBottom: 12 }}>
            <div className="row sp" style={{ flexWrap: 'wrap', gap: 8 }}>
              <div className="row" style={{ gap: 10 }}>
                <span style={{ fontSize: 28 }} aria-hidden="true">
                  {activeGroupDoc.emoji}
                </span>
                <div>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    <b style={{ fontSize: 16 }}>{activeGroupDoc.name}</b>
                    <span className="pill mono" style={{ fontSize: 11 }}>
                      {memberCount} / {activeGroupDoc.memberCap || 50}
                    </span>
                  </div>
                  <div className="mut" style={{ fontSize: 11, marginTop: 2 }}>
                    Code:{' '}
                    <b className="mono" style={{ color: 'var(--tx)' }}>
                      {formatGroupCode(activeGroupId)}
                    </b>{' '}
                    · Fetched{' '}
                    {formatRelativeAgo(activeSnapshot?.fetchedAt || 0, nowTick)}
                  </div>
                </div>
              </div>

              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn s"
                  onClick={() => handleCopyInvite(activeGroupId)}
                  aria-label="Copy group invite code"
                  style={{ minHeight: 44, padding: '0 10px', fontSize: 12 }}
                >
                  📋 Copy
                </button>
                <button
                  type="button"
                  className="btn s"
                  onClick={() => handleShareInvite(activeGroupId, activeGroupDoc.name)}
                  aria-label="Share group invite code"
                  style={{ minHeight: 44, padding: '0 10px', fontSize: 12 }}
                >
                  📤 Share
                </button>
                <button
                  type="button"
                  className="btn s"
                  disabled={isRefreshing || refreshCooldownLeftSec > 0 || !isOnline}
                  onClick={() => refreshGroup(activeGroupId, true)}
                  aria-label="Refresh group leaderboard"
                  style={{ minHeight: 44, padding: '0 10px', fontSize: 12 }}
                >
                  🔄{' '}
                  {isRefreshing
                    ? '…'
                    : refreshCooldownLeftSec > 0
                      ? `${refreshCooldownLeftSec}s`
                      : 'Refresh'}
                </button>
              </div>
            </div>

            {/* Studying Now Live Strip (Milestone 2.1) */}
            {studyingNowList.length > 0 && (
              <div
                style={{
                  marginTop: 12,
                  padding: '8px 12px',
                  borderRadius: 10,
                  background: 'rgba(16, 185, 129, 0.12)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  fontSize: 12,
                }}
              >
                <b style={{ color: '#10b981' }}>
                  🟢 Studying now ({studyingNowList.length}):
                </b>{' '}
                {studyingNowList.map((m, idx) => (
                  <span key={m.uid}>
                    {idx > 0 ? ' · ' : ''}
                    {m.emoji} <b>{m.nick}</b> ({m.elapsedMins}m)
                  </span>
                ))}
              </div>
            )}

            {/* Received Cheers Chip (Milestone 2.3) */}
            {todayCheersReceived.length > 0 && (
              <div
                style={{
                  marginTop: 10,
                  padding: '8px 12px',
                  borderRadius: 10,
                  background: 'rgba(245, 158, 11, 0.12)',
                  border: '1px solid rgba(245, 158, 11, 0.32)',
                  fontSize: 12,
                }}
              >
                <b>
                  🎉 You got {todayCheersReceived.length} cheer
                  {todayCheersReceived.length === 1 ? '' : 's'} today:
                </b>{' '}
                {todayCheersReceived.map((c, idx) => (
                  <span key={c.id}>
                    {idx > 0 ? ', ' : ''}
                    {c.e} {c.fromNick}
                  </span>
                ))}
              </div>
            )}

            {/* Weekly Group Hours Goal (Milestone 2.2) */}
            {weeklyGoalProg && weeklyGoalProg.hasGoal && (
              <div style={{ marginTop: 12 }}>
                <div className="row sp" style={{ fontSize: 12, marginBottom: 4 }}>
                  <span className="mut">
                    🎯 Weekly Group Goal:{' '}
                    <b style={{ color: 'var(--tx)' }}>
                      {formatMinutesAsHoursMins(weeklyGoalProg.combinedMinutes)}
                    </b>{' '}
                    / {formatMinutesAsHoursMins(weeklyGoalProg.targetMinutes)}
                  </span>
                  <b className="mono">{weeklyGoalProg.pct}%</b>
                </div>
                <div className="pbar" style={{ height: 8 }}>
                  <div
                    className="pfill"
                    style={{
                      width: `${weeklyGoalProg.pct}%`,
                      background: weeklyGoalProg.reached ? '#10b981' : 'var(--ac)',
                    }}
                  />
                </div>
                {weeklyGoalProg.reached && (
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 12,
                      color: '#10b981',
                      fontWeight: 700,
                    }}
                  >
                    🏆 Goal reached! Awesome collective effort this week!
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Horizontally Scrollable Board Tabs */}
          <div
            className="chips"
            role="tablist"
            aria-label="Group leaderboard tabs"
            style={{
              overflowX: 'auto',
              flexWrap: 'nowrap',
              gap: 6,
              marginBottom: 12,
              paddingBottom: 2,
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={boardTab === 'today'}
              className={`chip ${boardTab === 'today' ? 'on' : ''}`}
              onClick={() => setBoardTab('today')}
              style={{ minHeight: 44, whiteSpace: 'nowrap' }}
            >
              ☀️ Today
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={boardTab === 'week'}
              className={`chip ${boardTab === 'week' ? 'on' : ''}`}
              onClick={() => setBoardTab('week')}
              style={{ minHeight: 44, whiteSpace: 'nowrap' }}
            >
              📅 Week
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={boardTab === 'xp'}
              className={`chip ${boardTab === 'xp' ? 'on' : ''}`}
              onClick={() => setBoardTab('xp')}
              style={{ minHeight: 44, whiteSpace: 'nowrap' }}
            >
              ⚡ XP
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={boardTab === 'streak'}
              className={`chip ${boardTab === 'streak' ? 'on' : ''}`}
              onClick={() => setBoardTab('streak')}
              style={{ minHeight: 44, whiteSpace: 'nowrap' }}
            >
              🔥 Streak
            </button>
            {activeGroupDoc.mockBoard && (
              <button
                type="button"
                role="tab"
                aria-selected={boardTab === 'mocks'}
                className={`chip ${boardTab === 'mocks' ? 'on' : ''}`}
                onClick={() => setBoardTab('mocks')}
                style={{ minHeight: 44, whiteSpace: 'nowrap' }}
              >
                📝 Mocks
              </button>
            )}
            <button
              type="button"
              role="tab"
              aria-selected={boardTab === 'history'}
              className={`chip ${boardTab === 'history' ? 'on' : ''}`}
              onClick={() => setBoardTab('history')}
              style={{ minHeight: 44, whiteSpace: 'nowrap' }}
            >
              🏅 History
            </button>
          </div>

          {/* Sub-controls for XP or Mocks */}
          {boardTab === 'xp' && (
            <div className="row" style={{ gap: 6, marginBottom: 10 }}>
              <button
                type="button"
                className={`chip ${xpSortMode === 'weekly' ? 'on' : ''}`}
                onClick={() => setXpSortMode('weekly')}
                style={{ minHeight: 40 }}
              >
                This Week XP
              </button>
              <button
                type="button"
                className={`chip ${xpSortMode === 'allTime' ? 'on' : ''}`}
                onClick={() => setXpSortMode('allTime')}
                style={{ minHeight: 40 }}
              >
                All-Time XP & Level
              </button>
            </div>
          )}

          {boardTab === 'mocks' && activeGroupDoc.mockBoard && (
            <div style={{ marginBottom: 10 }}>
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: 10,
                  background: 'var(--sf2)',
                  fontSize: 12,
                  marginBottom: 8,
                  color: 'var(--mut)',
                }}
              >
                💡 <i>Scores are shared only by choice. Rank is not your worth.</i>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button
                  type="button"
                  className={`chip ${mockSortMode === 'latest' ? 'on' : ''}`}
                  onClick={() => setMockSortMode('latest')}
                  style={{ minHeight: 40 }}
                >
                  Latest Score
                </button>
                <button
                  type="button"
                  className={`chip ${mockSortMode === 'best' ? 'on' : ''}`}
                  onClick={() => setMockSortMode('best')}
                  style={{ minHeight: 40 }}
                >
                  Best Score
                </button>
                <button
                  type="button"
                  className={`chip ${mockSortMode === 'avg5' ? 'on' : ''}`}
                  onClick={() => setMockSortMode('avg5')}
                  style={{ minHeight: 40 }}
                >
                  Avg of Last 5
                </button>
              </div>
            </div>
          )}

          {/* Leaderboard Rows (Today / Week / XP / Streak / Mocks) */}
          {boardTab !== 'history' && (
            <div className="card" style={{ padding: 12, marginBottom: 12 }}>
              {rankedRows.length === 0 ? (
                <div className="mut" style={{ textAlign: 'center', padding: 18, fontSize: 13 }}>
                  No members on this leaderboard yet.
                </div>
              ) : (
                rankedRows.map((row) => {
                  const isMe = row.uid === myUid;
                  const rankBadge =
                    row.rank === 1
                      ? '🥇'
                      : row.rank === 2
                        ? '🥈'
                        : row.rank === 3
                          ? '🥉'
                          : row.rank !== null
                            ? `#${row.rank}`
                            : '—';
                const sentCheer =
                  sentCheersLocal[`${activeGroupId}_${row.uid}_${todayKey}`];

                return (
                  <div
                    key={row.uid}
                    className="row sp"
                    style={{
                      padding: '10px 8px',
                      borderBottom: '1px solid var(--bd)',
                      opacity: row.hidden ? 0.62 : 1,
                      background: isMe ? 'rgba(56, 189, 248, 0.07)' : 'transparent',
                      borderRadius: isMe ? 8 : 0,
                      gap: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    <div className="row" style={{ gap: 10, minWidth: 0, flex: 1 }}>
                      <span
                        className="mono"
                        style={{
                          minWidth: 28,
                          textAlign: 'center',
                          fontWeight: 700,
                          fontSize: row.rank && row.rank <= 3 ? 18 : 13,
                        }}
                      >
                        {rankBadge}
                      </span>
                      <span style={{ fontSize: 22 }} aria-hidden="true">
                        {row.entry.emoji}
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                          <b style={{ fontSize: 14 }}>
                            {row.entry.nick}
                            {isMe ? ' (You)' : ''}
                          </b>
                          {row.entry.examYear && (
                            <span className="mut" style={{ fontSize: 11 }}>
                              '{String(row.entry.examYear).slice(-2)}
                            </span>
                          )}
                          {(row.medals.gold > 0 ||
                            row.medals.silver > 0 ||
                            row.medals.bronze > 0) && (
                            <span
                              style={{ fontSize: 11 }}
                              title="Weekly podium trophies"
                            >
                              {row.medals.gold > 0 ? `🥇${row.medals.gold} ` : ''}
                              {row.medals.silver > 0 ? `🥈${row.medals.silver} ` : ''}
                              {row.medals.bronze > 0 ? `🥉${row.medals.bronze}` : ''}
                            </span>
                          )}
                        </div>
                        <div className="mut" style={{ fontSize: 11 }}>
                          updated {formatRelativeAgo(row.entry.updatedAt, nowTick)}
                          {row.subLabel ? ` · ${row.subLabel}` : ''}
                        </div>
                      </div>
                    </div>

                    <div className="row" style={{ gap: 8 }}>
                      <div style={{ textAlign: 'right' }}>
                        <b
                          className="mono"
                          style={{
                            fontSize: 14,
                            color: row.hidden ? 'var(--mut)' : 'var(--tx)',
                          }}
                        >
                          {row.displayLabel}
                        </b>
                      </div>

                      {/* Cheer buttons for other members */}
                      {!isMe && (
                        <div className="row" style={{ gap: 2 }}>
                          {ALLOWED_CHEER_EMOJIS.map((ce) => (
                            <button
                              key={ce}
                              type="button"
                              className="ib"
                              onClick={() => handleSendCheer(row.uid, row.entry.nick, ce)}
                              aria-label={`Send ${ce} cheer to ${row.entry.nick}`}
                              title={`Cheer ${row.entry.nick} with ${ce}`}
                              style={{
                                minWidth: 36,
                                minHeight: 40,
                                fontSize: 14,
                                background:
                                  sentCheer === ce
                                    ? 'rgba(16, 185, 129, 0.2)'
                                    : 'transparent',
                              }}
                            >
                              {ce}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
              )}
            </div>
          )}

          {/* History & Trophies Tab (Milestone 2.6) */}
          {boardTab === 'history' && (
            <div className="card" style={{ padding: 14, marginBottom: 12 }}>
              <b style={{ fontSize: 14, display: 'block', marginBottom: 8 }}>
                🏅 Weekly Standings & Trophy Cabinet (Last 12 Weeks)
              </b>
              {(() => {
                const myEntry = myUid ? activeGroupDoc.members[myUid] : undefined;
                const combinedWeeks = {
                  ...(myEntry?.weeks || {}),
                  ...(state.groupHistory?.[activeGroupId] || {}),
                };
                const weekKeys = Object.keys(combinedWeeks).sort().reverse().slice(0, 12);
                const myMedals = myEntry
                  ? computeMemberMedals({ ...myEntry, weeks: combinedWeeks })
                  : { gold: 0, silver: 0, bronze: 0 };

                return (
                  <>
                    <div
                      className="row"
                      style={{
                        gap: 12,
                        marginBottom: 12,
                        padding: '10px 12px',
                        borderRadius: 10,
                        background: 'var(--sf2)',
                      }}
                    >
                      <span>🥇 Gold: <b>{myMedals.gold}</b></span>
                      <span>🥈 Silver: <b>{myMedals.silver}</b></span>
                      <span>🥉 Bronze: <b>{myMedals.bronze}</b></span>
                    </div>

                    {weekKeys.length === 0 ? (
                      <div className="mut" style={{ fontSize: 13 }}>
                        Completed weekly standings appear here automatically each Monday when at
                        least 2 members share study time.
                      </div>
                    ) : (
                      weekKeys.map((wk) => {
                        const w = combinedWeeks[wk];
                        if (!w) return null;
                        const medal =
                          w.rank === 1 ? '🥇' : w.rank === 2 ? '🥈' : w.rank === 3 ? '🥉' : '🏅';
                        return (
                          <div
                            key={wk}
                            className="row sp"
                            style={{
                              padding: '8px 4px',
                              borderBottom: '1px solid var(--bd)',
                              fontSize: 13,
                            }}
                          >
                            <span>
                              {medal} Week of <b className="mono">{wk}</b>
                            </span>
                            <span className="mono">
                              Rank <b>#{w.rank}</b> of {w.of} ·{' '}
                              {formatMinutesAsHoursMins(w.minutes)} · {w.xp} XP
                            </span>
                          </div>
                        );
                      })
                    )}
                  </>
                );
              })()}
            </div>
          )}

          {/* Per-Group Privacy & Sharing Switches */}
          {activeGroupPref && (
            <div className="card" style={{ padding: 14, marginBottom: 12 }}>
              <b style={{ fontSize: 14, display: 'block', marginBottom: 4 }}>
                🔒 My Sharing Preferences in "{activeGroupDoc.name}"
              </b>
              <div className="mut" style={{ fontSize: 12, marginBottom: 10 }}>
                Unchecked items are omitted from your group entry and shown as "hidden".
              </div>

              {(
                [
                  {
                    key: 't' as const,
                    label: 'Share timer-tracked study hours (Today & Week)',
                    checked: activeGroupPref.sh.t,
                  },
                  {
                    key: 'x' as const,
                    label: 'Share XP v2 & level',
                    checked: activeGroupPref.sh.x,
                  },
                  {
                    key: 's' as const,
                    label: 'Share consistency score & minimum-day streak',
                    checked: activeGroupPref.sh.s,
                  },
                  {
                    key: 'm' as const,
                    label: 'Share last 10 mock test scores (opt-in)',
                    checked: activeGroupPref.sh.m,
                  },
                  {
                    key: 'l' as const,
                    label: 'Show "Studying now" live indicator when timer runs',
                    checked: activeGroupPref.sh.l,
                  },
                  {
                    key: 'paused' as const,
                    label: 'Pause all sharing in this group (hide all stats)',
                    checked: Boolean(activeGroupPref.paused),
                  },
                ] as const
              ).map((item) => (
                <label
                  key={item.key}
                  className="row sp"
                  style={{
                    minHeight: 44,
                    padding: '4px 0',
                    borderBottom: '1px solid var(--bd)',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  <span>{item.label}</span>
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={(e) => handleToggleSharingFlag(item.key, e.target.checked)}
                    style={{ width: 20, height: 20 }}
                  />
                </label>
              ))}

              <div className="row sp" style={{ marginTop: 12 }}>
                <span className="mut" style={{ fontSize: 11 }}>
                  Group writes today: {groupBudget.getWritesToday()}/60 · Reads:{' '}
                  {groupBudget.getReadsToday()}/150
                </span>
                {confirmLeaveGroupId === activeGroupId ? (
                  <div className="row" style={{ gap: 6 }}>
                    <button
                      type="button"
                      className="btn dg"
                      disabled={actionBusy}
                      onClick={() => handleLeaveGroup(activeGroupId)}
                      style={{ minHeight: 40, fontSize: 12 }}
                    >
                      Confirm Leave
                    </button>
                    <button
                      type="button"
                      className="btn s"
                      onClick={() => setConfirmLeaveGroupId(null)}
                      style={{ minHeight: 40, fontSize: 12 }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn s"
                    onClick={() => setConfirmLeaveGroupId(activeGroupId)}
                    style={{ minHeight: 40, fontSize: 12, color: '#f43f5e' }}
                  >
                    Leave Group
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Owner Tools Card (Milestone 2.7) */}
          {isOwner && (
            <div className="card" style={{ padding: 14, marginBottom: 12 }}>
              <b style={{ fontSize: 14, display: 'block', marginBottom: 10 }}>
                👑 Group Owner Tools
              </b>
              <form onSubmit={handleOwnerSaveSettings} style={{ marginBottom: 12 }}>
                <div className="row" style={{ gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    value={ownerEditName}
                    maxLength={32}
                    onChange={(e) => setOwnerEditName(e.target.value)}
                    placeholder="Group Name"
                    aria-label="Edit group name"
                    style={{ minHeight: 44, flex: 1 }}
                  />
                  <input
                    type="number"
                    min={0}
                    max={5000}
                    step="1"
                    value={ownerGoalHoursInput}
                    onChange={(e) => setOwnerGoalHoursInput(e.target.value)}
                    placeholder="Weekly Goal (hrs, blank=none)"
                    aria-label="Weekly group goal in hours"
                    style={{ minHeight: 44, width: 170 }}
                  />
                  <button
                    type="submit"
                    className="btn pri"
                    disabled={actionBusy}
                    style={{ minHeight: 44 }}
                  >
                    Save
                  </button>
                </div>
              </form>

              <label
                className="row sp"
                style={{
                  minHeight: 44,
                  padding: '6px 0',
                  borderTop: '1px solid var(--bd)',
                  borderBottom: '1px solid var(--bd)',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                <span>Enable Mock Score Leaderboard tab for this group</span>
                <input
                  type="checkbox"
                  checked={Boolean(activeGroupDoc.mockBoard)}
                  onChange={(e) => handleOwnerToggleMockBoard(e.target.checked)}
                  style={{ width: 20, height: 20 }}
                />
              </label>

              {/* Member Removal List */}
              {Object.keys(activeGroupDoc.members).length > 1 && (
                <div style={{ marginTop: 10 }}>
                  <div className="mut" style={{ fontSize: 12, marginBottom: 6 }}>
                    Manage Members
                  </div>
                  {Object.entries(activeGroupDoc.members)
                    .filter(([uid]) => uid !== myUid)
                    .map(([uid, m]) => (
                      <div
                        key={uid}
                        className="row sp"
                        style={{ padding: '4px 0', fontSize: 13 }}
                      >
                        <span>
                          {m.emoji} {m.nick}
                        </span>
                        {confirmKickUid === uid ? (
                          <div className="row" style={{ gap: 6 }}>
                            <button
                              type="button"
                              className="btn dg"
                              disabled={actionBusy}
                              onClick={() => handleOwnerRemoveMember(uid, m.nick)}
                              style={{ minHeight: 38, fontSize: 12 }}
                            >
                              Confirm Remove
                            </button>
                            <button
                              type="button"
                              className="btn s"
                              onClick={() => setConfirmKickUid(null)}
                              style={{ minHeight: 38, fontSize: 12 }}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="btn s"
                            onClick={() => setConfirmKickUid(uid)}
                            style={{ minHeight: 38, fontSize: 12 }}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    ))}
                </div>
              )}

              {/* Close Group */}
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--bd)' }}>
                {confirmCloseGroupId === activeGroupId ? (
                  <div className="row sp">
                    <span style={{ fontSize: 12, color: '#f43f5e' }}>
                      Permanently delete this group for all members?
                    </span>
                    <div className="row" style={{ gap: 6 }}>
                      <button
                        type="button"
                        className="btn dg"
                        disabled={actionBusy}
                        onClick={() => handleOwnerCloseGroup(activeGroupId)}
                        style={{ minHeight: 40, fontSize: 12 }}
                      >
                        Yes, Close Group
                      </button>
                      <button
                        type="button"
                        className="btn s"
                        onClick={() => setConfirmCloseGroupId(null)}
                        style={{ minHeight: 40, fontSize: 12 }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn dg"
                    onClick={() => setConfirmCloseGroupId(activeGroupId)}
                    style={{ minHeight: 40, fontSize: 12 }}
                  >
                    Close & Delete Group
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
