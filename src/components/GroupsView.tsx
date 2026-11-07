import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  GroupSharingFlags,
  GroupsUserConfig,
  JoinedGroupPreference,
  PulseHabitState,
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
  type MemberEntry,
  type MockSortMode,
  type RankedMemberRow,
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
  sendCheerInCloud,
  validateNickname,
} from '../utils/groups';
import { addD, isManualStudySession } from '../utils/studyLogic';
import {
  XP_V2_PLAIN_RULES,
  computeDayXpBreakdown,
  computeLevelInfo,
  computeTotalXp,
  computeXpByDay,
} from '../utils/xp';

type BoardTab = 'today' | 'week' | 'xp' | 'streak' | 'mocks' | 'history';
type MemberFilterMode = 'all' | 'activeToday' | 'studyingNow' | 'top3';

const GROUP_EMOJIS = ['🩺', '🧬', '🔬', '⚕️', '🔥', '🎯', '📚', '⚡', '🧠', '🏆'];
const PACE_TARGET_STORAGE_KEY = 'dh_group_pace_targets_v1';

function loadPaceTargets(): Record<string, string> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(PACE_TARGET_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [gid, uid] of Object.entries(parsed)) {
      if (typeof gid === 'string' && typeof uid === 'string' && uid) {
        out[gid] = uid;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function savePaceTargets(map: Record<string, string>): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PACE_TARGET_STORAGE_KEY, JSON.stringify(map));
    }
  } catch {
    // ignore storage errors
  }
}

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

function getWeekDayKeysUpToToday(todayKey: string): string[] {
  const [y, m, d] = todayKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  const dow = dt.getUTCDay(); // 0 = Sun, 1 = Mon .. 6 = Sat
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const keys: string[] = [];
  for (let offset = diffToMon; offset <= 0; offset++) {
    keys.push(addD(todayKey, offset));
  }
  return keys;
}

function sumMemberRange(
  entry: MemberEntry | undefined,
  dayKeys: string[],
  field: 'm' | 'xp'
): number {
  const map = field === 'm' ? entry?.days : entry?.xpDays;
  if (!map) return 0;
  let sum = 0;
  for (const dk of dayKeys) {
    sum += Number(map[dk]) || 0;
  }
  return sum;
}

export interface LeaderboardProps {
  members: Record<string, MemberEntry>;
  todayKey: string;
  myUid?: string | null;
  nowTs?: number;
  onRefresh?: () => void | Promise<void>;
  isRefreshing?: boolean;
  lastUpdatedAt?: number | null;
}

export type WeeklyStudyLeaderboardProps = LeaderboardProps;

function isMemberStudyingNow(entry: MemberEntry, nowTs: number): boolean {
  return Boolean(
    !entry.paused &&
      entry.sh?.l &&
      entry.live &&
      entry.live.until > nowTs &&
      entry.live.since <= nowTs + 60_000
  );
}

export function formatCurrentSessionDuration(
  sinceMs: number | undefined,
  nowMs: number
): string {
  if (
    typeof sinceMs !== 'number' ||
    !Number.isFinite(sinceMs) ||
    sinceMs <= 0
  ) {
    return '1m 0s';
  }
  const elapsedSec = Math.max(1, Math.floor((nowMs - sinceMs) / 1000));
  const hours = Math.floor(elapsedSec / 3600);
  const mins = Math.floor((elapsedSec % 3600) / 60);
  const secs = elapsedSec % 60;
  if (hours > 0) {
    return `${hours}h ${mins}m ${secs}s`;
  }
  return `${mins}m ${secs}s`;
}

function getStudyingNowTooltipText(
  entry: MemberEntry,
  nowMs: number,
  fallbackSinceMs?: number
): string {
  const sinceMs = entry.live?.since ?? fallbackSinceMs;
  const exactDuration = formatCurrentSessionDuration(sinceMs, nowMs);
  return `Studying now — Current session: ${exactDuration}`;
}

export const Leaderboard: React.FC<LeaderboardProps> = ({
  members,
  todayKey,
  myUid,
  nowTs,
  onRefresh,
  isRefreshing = false,
  lastUpdatedAt = null,
}) => {
  const [refreshTickTs, setRefreshTickTs] = useState<number>(() =>
    typeof nowTs === 'number' ? nowTs : Date.now()
  );
  const [localRefreshing, setLocalRefreshing] = useState(false);
  const [hoveredLiveKey, setHoveredLiveKey] = useState<string | null>(null);

  const effectiveNowTs = typeof nowTs === 'number' ? nowTs : refreshTickTs;
  const busyRefreshing = isRefreshing || localRefreshing;

  const handleManualRefresh = async () => {
    if (busyRefreshing) return;
    setRefreshTickTs(Date.now());
    if (onRefresh) {
      try {
        setLocalRefreshing(true);
        await onRefresh();
      } finally {
        setLocalRefreshing(false);
        setRefreshTickTs(Date.now());
      }
    }
  };

  const rows = useMemo(
    () => rankWeekBoard(members, todayKey),
    [members, todayKey]
  );

  const maxWeeklyMinutes = useMemo(() => {
    let maxVal = 60;
    for (const r of rows) {
      if (!r.hidden && r.primaryValue > maxVal) {
        maxVal = r.primaryValue;
      }
    }
    return maxVal;
  }, [rows]);

  return (
    <div>
      <div
        className="row sp"
        style={{
          marginBottom: 10,
          padding: '4px 4px 8px',
          borderBottom: '1px solid var(--bd)',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <div className="row" style={{ gap: 8 }}>
          <b style={{ fontSize: 13.5 }}>Weekly Study Leaderboard</b>
          <span
            className="mut mono"
            style={{
              fontSize: 11,
              background: 'var(--c2)',
              padding: '2px 7px',
              borderRadius: 6,
            }}
          >
            {rows.length} {rows.length === 1 ? 'member' : 'members'}
          </span>
          {lastUpdatedAt ? (
            <span className="mut mono" style={{ fontSize: 11 }}>
              · Synced {Math.max(0, Math.floor((effectiveNowTs - lastUpdatedAt) / 60000))}m ago
            </span>
          ) : null}
        </div>
        <button
          type="button"
          className="g"
          onClick={handleManualRefresh}
          disabled={busyRefreshing}
          aria-label="Refresh leaderboard stats"
          title="Pull latest member stats on demand"
          style={{
            minHeight: 36,
            padding: '6px 12px',
            borderRadius: 10,
            fontSize: 12,
            fontWeight: 700,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            cursor: busyRefreshing ? 'not-allowed' : 'pointer',
            opacity: busyRefreshing ? 0.65 : 1,
          }}
        >
          <span aria-hidden="true">↻</span>
          <span>{busyRefreshing ? 'Refreshing...' : 'Refresh'}</span>
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="mut" style={{ textAlign: 'center', padding: 16 }}>
          No members in this weekly study leaderboard yet.
        </div>
      ) : (
        <div role="list" aria-label="Weekly study duration leaderboard">
          {rows.map((row) => {
            const isMe = Boolean(myUid && row.uid === myUid);
            const studyingNow = isMemberStudyingNow(row.entry, effectiveNowTs);
            const liveTooltip = studyingNow
              ? getStudyingNowTooltipText(row.entry, effectiveNowTs)
              : '';
            const activeToday = (row.entry.days?.[todayKey] || 0) > 0;
            const pctBar = row.hidden
              ? 0
              : Math.min(
                  100,
                  Math.round((row.primaryValue / maxWeeklyMinutes) * 100)
                );
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
            const dotHoverKey = `dot_${row.uid}`;
            const badgeHoverKey = `badge_${row.uid}`;

            return (
              <div
                key={row.uid}
                role="listitem"
                className="row sp"
                style={{
                  padding: '10px 12px',
                  borderBottom: '1px solid var(--bd)',
                  background: isMe ? 'rgba(56, 189, 248, 0.09)' : 'transparent',
                  borderRadius: isMe ? 12 : 0,
                  opacity: row.hidden ? 0.65 : 1,
                  gap: 10,
                }}
              >
                <div className="row" style={{ gap: 10, minWidth: 0, flex: 1 }}>
                  <span
                    className="mono"
                    style={{
                      minWidth: 30,
                      textAlign: 'center',
                      fontWeight: 800,
                      fontSize: row.rank && row.rank <= 3 ? 18 : 13,
                    }}
                  >
                    {rankBadge}
                  </span>

                  <div
                    style={{
                      position: 'relative',
                      width: 38,
                      height: 38,
                      borderRadius: 12,
                      background: studyingNow
                        ? 'rgba(16, 185, 129, 0.14)'
                        : 'var(--c2)',
                      border: studyingNow
                        ? '1.5px solid rgba(16, 185, 129, 0.55)'
                        : isMe
                          ? '1.5px solid rgba(56, 189, 248, 0.5)'
                          : '1px solid var(--bd)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{ fontSize: 20, lineHeight: 1 }}
                      aria-hidden="true"
                    >
                      {row.entry.emoji}
                    </span>
                    <span
                      role="status"
                      tabIndex={studyingNow ? 0 : undefined}
                      onMouseEnter={() => {
                        if (studyingNow) setHoveredLiveKey(dotHoverKey);
                      }}
                      onMouseLeave={() => {
                        if (hoveredLiveKey === dotHoverKey)
                          setHoveredLiveKey(null);
                      }}
                      onFocus={() => {
                        if (studyingNow) setHoveredLiveKey(dotHoverKey);
                      }}
                      onBlur={() => {
                        if (hoveredLiveKey === dotHoverKey)
                          setHoveredLiveKey(null);
                      }}
                      aria-label={
                        studyingNow
                          ? liveTooltip
                          : row.entry.paused
                            ? 'Sharing paused'
                            : activeToday
                              ? 'Studied today'
                              : 'Offline'
                      }
                      title={
                        studyingNow
                          ? liveTooltip
                          : row.entry.paused
                            ? 'Sharing paused'
                            : activeToday
                              ? 'Studied today'
                              : 'Idle today'
                      }
                      style={{
                        position: 'absolute',
                        right: -2,
                        bottom: -2,
                        width: 11,
                        height: 11,
                        borderRadius: '50%',
                        background: studyingNow
                          ? '#10b981'
                          : row.entry.paused
                            ? '#f59e0b'
                            : activeToday
                              ? '#38bdf8'
                              : 'var(--bd)',
                        border: '2px solid var(--card)',
                        boxShadow: studyingNow
                          ? '0 0 0 2px rgba(16, 185, 129, 0.28)'
                          : 'none',
                        cursor: studyingNow ? 'help' : 'default',
                      }}
                    />
                    {studyingNow && hoveredLiveKey === dotHoverKey && (
                      <div
                        role="tooltip"
                        className="mono"
                        style={{
                          position: 'absolute',
                          bottom: 'calc(100% + 6px)',
                          left: 0,
                          zIndex: 30,
                          whiteSpace: 'nowrap',
                          background: 'var(--card)',
                          color: 'var(--tx)',
                          border: '1px solid rgba(16, 185, 129, 0.5)',
                          boxShadow: '0 6px 18px rgba(0, 0, 0, 0.28)',
                          padding: '4px 8px',
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 700,
                          pointerEvents: 'none',
                        }}
                      >
                        {liveTooltip}
                      </div>
                    )}
                  </div>

                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      <b
                        style={{
                          fontSize: 13.5,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {row.entry.nick}
                        {isMe ? ' (You)' : ''}
                      </b>
                      {studyingNow && (
                        <span
                          title={liveTooltip}
                          aria-label={liveTooltip}
                          onMouseEnter={() => setHoveredLiveKey(badgeHoverKey)}
                          onMouseLeave={() => {
                            if (hoveredLiveKey === badgeHoverKey)
                              setHoveredLiveKey(null);
                          }}
                          style={{
                            position: 'relative',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: 10.5,
                            fontWeight: 700,
                            color: '#10b981',
                            background: 'rgba(16, 185, 129, 0.12)',
                            padding: '1px 7px',
                            borderRadius: 6,
                            cursor: 'help',
                          }}
                        >
                          <span
                            aria-hidden="true"
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              background: '#10b981',
                            }}
                          />
                          Studying now
                          {hoveredLiveKey === badgeHoverKey && (
                            <span
                              role="tooltip"
                              className="mono"
                              style={{
                                position: 'absolute',
                                bottom: 'calc(100% + 6px)',
                                left: 0,
                                zIndex: 30,
                                whiteSpace: 'nowrap',
                                background: 'var(--card)',
                                color: 'var(--tx)',
                                border: '1px solid rgba(16, 185, 129, 0.5)',
                                boxShadow: '0 6px 18px rgba(0, 0, 0, 0.28)',
                                padding: '4px 8px',
                                borderRadius: 6,
                                fontSize: 11,
                                fontWeight: 700,
                                pointerEvents: 'none',
                              }}
                            >
                              {liveTooltip}
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                    {!row.hidden && (
                      <div
                        style={{
                          marginTop: 4,
                          height: 4,
                          borderRadius: 4,
                          background: 'var(--c2)',
                          overflow: 'hidden',
                          maxWidth: 180,
                        }}
                      >
                        <div
                          style={{
                            width: `${pctBar}%`,
                            height: '100%',
                            borderRadius: 4,
                            background: studyingNow ? '#10b981' : 'var(--ac)',
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <b
                    className="mono"
                    style={{
                      fontSize: 14,
                      fontVariantNumeric: 'tabular-nums',
                      color: row.hidden ? 'var(--mu)' : 'var(--tx)',
                    }}
                  >
                    {row.displayLabel}
                  </b>
                  {row.subLabel && (
                    <div className="mut mono" style={{ fontSize: 10.5 }}>
                      {row.subLabel}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const WeeklyStudyLeaderboard = Leaderboard;

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
  onGoToFocus?: () => void;
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
  onGoToFocus,
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
  const [memberFilter, setMemberFilter] = useState<MemberFilterMode>('all');
  const [memberSearch, setMemberSearch] = useState('');
  const [expandedMemberUid, setExpandedMemberUid] = useState<string | null>(null);
  const [showMyXpDrawer, setShowMyXpDrawer] = useState(false);
  const [showGoalBreakdown, setShowGoalBreakdown] = useState(false);
  const [paceTargets, setPaceTargets] = useState<Record<string, string>>(() =>
    loadPaceTargets()
  );

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPublishingMine, setIsPublishingMine] = useState(false);
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
  const [showOwnerDrawer, setShowOwnerDrawer] = useState(false);
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

  // Personal XP v2 & Timer-verified study calculations from utils/xp.ts
  const myPersonalStats = useMemo(() => {
    const xpByDay = computeXpByDay(state);
    const totalXp = computeTotalXp(state, todayKey);
    const levelInfo = computeLevelInfo(totalXp);
    const todayBreakdown = computeDayXpBreakdown(state, todayKey);

    const weekKeys = getWeekDayKeysUpToToday(todayKey);
    const last7Keys: string[] = [];
    for (let i = 6; i >= 0; i--) {
      last7Keys.push(addD(todayKey, -i));
    }

    const timerMinsByDay: Record<string, number> = {};
    for (const ses of state.sessions || []) {
      if (!ses || isManualStudySession(ses)) continue;
      const mins = Math.min(
        360,
        Math.max(0, Math.floor((Number(ses.activeMs) || 0) / 60000))
      );
      if (mins <= 0) continue;
      timerMinsByDay[ses.dayKey] = Math.min(
        1440,
        (timerMinsByDay[ses.dayKey] || 0) + mins
      );
    }

    const todayTimerMins = timerMinsByDay[todayKey] || 0;
    const todayXp = xpByDay[todayKey]?.total || 0;
    const weekTimerMins = weekKeys.reduce(
      (acc: number, dk: string) => acc + (timerMinsByDay[dk] || 0),
      0
    );
    const weekXp = weekKeys.reduce(
      (acc: number, dk: string) => acc + (xpByDay[dk]?.total || 0),
      0
    );

    return {
      totalXp,
      levelInfo,
      todayBreakdown,
      todayTimerMins,
      todayXp,
      weekTimerMins,
      weekXp,
      timerMinsByDay,
      xpByDay,
      weekKeys,
      last7Keys,
    };
  }, [state, todayKey]);

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
  }, [
    activeGroupId,
    activeGroupDoc?.name,
    activeGroupDoc?.emoji,
    activeGroupDoc?.goal?.weeklyMinutes,
    activeGroupDoc?.mockBoard,
    boardTab,
  ]);

  // Refresh a group snapshot from Firestore
  const refreshGroup = useCallback(
    async (groupId: string, manual = false) => {
      if (!myUid || !groupId || !isOnline) return;
      if (manual) {
        const elapsed = Date.now() - lastManualRefreshTs;
        if (elapsed < GROUP_MANUAL_REFRESH_COOLDOWN_MS) {
          const waitSec = Math.ceil(
            (GROUP_MANUAL_REFRESH_COOLDOWN_MS - elapsed) / 1000
          );
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
          onUpdateGroupsConfig((prev) => {
            const existing = prev.joined.find((j) => j.groupId === groupId);
            if (
              !existing ||
              (existing.name === snap.doc.name &&
                existing.emoji === snap.doc.emoji)
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

          // Record last week's completed standings if available
          const completedStanding = computeCompletedWeekStandings(
            snap.doc,
            todayKey
          );
          if (
            completedStanding &&
            myUid &&
            completedStanding.standings[myUid]
          ) {
            const myStanding = completedStanding.standings[myUid];
            const existingHist =
              state.groupHistory?.[groupId]?.[completedStanding.weekKey];
            if (!existingHist) {
              onRecordWeekHistory(
                groupId,
                completedStanding.weekKey,
                myStanding
              );
            }
          }

          // Occasional cleanup of own cheers older than 14 days
          if (!cleanupRanForGroupRef.current.has(groupId)) {
            cleanupRanForGroupRef.current.add(groupId);
            void cleanupOldOwnCheers({
              groupId,
              todayKey,
              budget: groupBudget,
            });
          }
          if (manual) {
            showToast(`Refreshed "${snap.doc.name}" leaderboard`);
          }
        } else {
          setSnapshots((prev) => {
            const next = { ...prev };
            delete next[groupId];
            return next;
          });
        }
      } catch (err) {
        if (manual) {
          showToast(
            err instanceof Error
              ? err.message
              : 'Could not refresh group right now.'
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

  // 5-Minute Cache & Auto-Refresh Logic:
  // On opening GroupsView or switching activeGroupId, if cached snapshot is missing or > 5 minutes old
  // (GROUP_CACHE_STALE_MS), automatically fetch fresh snapshot from Firestore.
  useEffect(() => {
    if (!myUid || !activeGroupId || !isOnline) return;
    const cached = loadCachedGroupSnapshots()[activeGroupId];
    const age = cached ? Date.now() - cached.fetchedAt : Infinity;
    if (age > GROUP_CACHE_STALE_MS) {
      void refreshGroup(activeGroupId, false);
    }
    const interval = setInterval(() => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState !== 'visible'
      ) {
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

  const handlePushMyStatsNow = async () => {
    if (!activeGroupId || !activeGroupPref || !myUid) return;
    if (!isOnline) {
      showToast('You are offline — stats will publish when back online.');
      return;
    }
    setIsPublishingMine(true);
    try {
      const updatedEntry = await publishMyEntryToGroup({
        groupId: activeGroupId,
        state,
        todayKey,
        joinedAt: activeGroupPref.joinedAt,
        sh: activeGroupPref.sh,
        paused: activeGroupPref.paused,
        budget: groupBudget,
        force: true,
      });
      if (updatedEntry && activeGroupDoc) {
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
        showToast('Published your latest study time & XP to group!');
      } else {
        showToast('Your group stats are already up to date.');
      }
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Could not publish group stats.'
      );
    } finally {
      setIsPublishingMine(false);
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
      setActionError(
        err instanceof Error ? err.message : 'Failed to create group.'
      );
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
      setActionError(
        err instanceof Error ? err.message : 'Failed to join group.'
      );
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
            prev.activeGroupId === groupId
              ? remaining[0]?.groupId
              : prev.activeGroupId,
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
    const nextPaused =
      flagKey === 'paused' ? nextVal : Boolean(activeGroupPref.paused);

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

  const handleTogglePaceTarget = (targetUid: string, targetNick: string) => {
    if (!activeGroupId) return;
    setPaceTargets((prev) => {
      const next = { ...prev };
      if (next[activeGroupId] === targetUid) {
        delete next[activeGroupId];
        savePaceTargets(next);
        showToast(`Cleared pace target (${targetNick})`);
      } else {
        next[activeGroupId] = targetUid;
        savePaceTargets(next);
        showToast(`🎯 Set ${targetNick} as your friendly Pace Target!`);
      }
      return next;
    });
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
    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.share === 'function'
    ) {
      try {
        await navigator.share({
          title: `Join "${name}" on Deep Hours`,
          text: `Join our NEET study group "${name}" on Deep Hours with invite code: ${formatted}`,
        });
        return;
      } catch {
        // Fallback to copy
      }
    }
    await handleCopyInvite(code);
  };

  const handleSendCheer = async (
    toUid: string,
    toNick: string,
    emoji: CheerEmoji
  ) => {
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
          parsedGoalHours !== null &&
          Number.isFinite(parsedGoalHours) &&
          parsedGoalHours >= 1
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
      showToast(
        enabled ? 'Mock leaderboard enabled.' : 'Mock leaderboard hidden.'
      );
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Failed to toggle mock board.'
      );
    } finally {
      setActionBusy(false);
    }
  };

  const handleOwnerRemoveMember = async (
    targetUid: string,
    targetNick: string
  ) => {
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
            prev.activeGroupId === groupId
              ? remaining[0]?.groupId
              : prev.activeGroupId,
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

  const [hoveredLiveStatusKey, setHoveredLiveStatusKey] = useState<
    string | null
  >(null);

  const studyingNowList = useMemo(() => {
    if (!activeGroupDoc || !activeSnapshot) return [];
    return getActiveStudyingNowMembers(
      activeGroupDoc,
      activeSnapshot.fetchedAt,
      nowTick
    );
  }, [activeGroupDoc, activeSnapshot, nowTick]);

  const studyingNowUidSet = useMemo(
    () => new Set(studyingNowList.map((m) => m.uid)),
    [studyingNowList]
  );

  const studyingNowByUid = useMemo(() => {
    const map = new Map<string, (typeof studyingNowList)[number]>();
    for (const item of studyingNowList) {
      map.set(item.uid, item);
    }
    return map;
  }, [studyingNowList]);

  // Filtered rows for interactive search & filter chips
  const filteredRows = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    return rankedRows.filter((r) => {
      if (q && !r.entry.nick.toLowerCase().includes(q)) return false;
      if (memberFilter === 'activeToday') {
        const minsToday = r.entry.days?.[todayKey] || 0;
        const xpToday = r.entry.xpDays?.[todayKey] || 0;
        return minsToday > 0 || xpToday > 0;
      }
      if (memberFilter === 'studyingNow') {
        return studyingNowUidSet.has(r.uid);
      }
      if (memberFilter === 'top3') {
        return r.rank !== null && r.rank <= 3;
      }
      return true;
    });
  }, [rankedRows, memberSearch, memberFilter, todayKey, studyingNowUidSet]);

  // Top 3 podium entries (only visible ranked members with rank 1..3)
  const podiumRows = useMemo(() => {
    return rankedRows.filter(
      (r): r is RankedMemberRow & { rank: 1 | 2 | 3 } =>
        !r.hidden && (r.rank === 1 || r.rank === 2 || r.rank === 3)
    );
  }, [rankedRows]);

  const weeklyGoalProg = useMemo(() => {
    if (!activeGroupDoc) return null;
    return computeWeeklyGroupGoalProgress(activeGroupDoc, todayKey);
  }, [activeGroupDoc, todayKey]);

  // Member contribution breakdown for Weekly Group Goal
  const weeklyMemberContributions = useMemo(() => {
    if (!activeGroupDoc || !weeklyGoalProg || !weeklyGoalProg.hasGoal) return [];
    const weekKeys = getWeekDayKeysUpToToday(todayKey);
    const items: Array<{
      uid: string;
      nick: string;
      emoji: string;
      minutes: number;
      sharePct: number;
    }> = [];
    for (const [uid, entry] of Object.entries(activeGroupDoc.members || {})) {
      if (entry.paused || !entry.sh.t || !entry.days) continue;
      const mins = sumMemberRange(entry, weekKeys, 'm');
      if (mins <= 0) continue;
      const sharePct =
        weeklyGoalProg.targetMinutes > 0
          ? Math.min(
              100,
              Math.round((mins / weeklyGoalProg.targetMinutes) * 100)
            )
          : 0;
      items.push({
        uid,
        nick: entry.nick,
        emoji: entry.emoji,
        minutes: mins,
        sharePct,
      });
    }
    return items.sort((a, b) => b.minutes - a.minutes);
  }, [activeGroupDoc, weeklyGoalProg, todayKey]);

  const todayCheersReceived = useMemo(() => {
    if (!activeSnapshot?.receivedCheers) return [];
    return activeSnapshot.receivedCheers.filter((c) => c.dayKey === todayKey);
  }, [activeSnapshot, todayKey]);

  // Active Pace Target (Friendly Rival)
  const activePaceTargetUid = activeGroupId ? paceTargets[activeGroupId] : undefined;
  const activePaceTargetEntry =
    activePaceTargetUid && activeGroupDoc?.members?.[activePaceTargetUid]
      ? activeGroupDoc.members[activePaceTargetUid]
      : undefined;

  const paceComparison = useMemo(() => {
    if (!activePaceTargetEntry || !activePaceTargetUid) return null;
    const targetTodayMins = activePaceTargetEntry.days?.[todayKey] || 0;
    const targetWeekMins = sumMemberRange(
      activePaceTargetEntry,
      myPersonalStats.weekKeys,
      'm'
    );
    const targetWeekXp = sumMemberRange(
      activePaceTargetEntry,
      myPersonalStats.weekKeys,
      'xp'
    );
    const diffTodayMins = myPersonalStats.todayTimerMins - targetTodayMins;
    const diffWeekMins = myPersonalStats.weekTimerMins - targetWeekMins;
    const diffWeekXp = myPersonalStats.weekXp - targetWeekXp;
    return {
      uid: activePaceTargetUid,
      entry: activePaceTargetEntry,
      targetTodayMins,
      targetWeekMins,
      targetWeekXp,
      diffTodayMins,
      diffWeekMins,
      diffWeekXp,
    };
  }, [activePaceTargetEntry, activePaceTargetUid, todayKey, myPersonalStats]);

  const memberCount = activeGroupDoc
    ? Object.keys(activeGroupDoc.members || {}).length
    : 0;
  const isOwner = Boolean(
    activeGroupDoc && myUid && activeGroupDoc.ownerUid === myUid
  );
  const refreshCooldownLeftSec = Math.max(
    0,
    Math.ceil(
      (GROUP_MANUAL_REFRESH_COOLDOWN_MS - (nowTick - lastManualRefreshTs)) / 1000
    )
  );
  const myRankOnCurrentBoard = useMemo(() => {
    if (!myUid) return null;
    return rankedRows.find((r) => r.uid === myUid)?.rank ?? null;
  }, [rankedRows, myUid]);

  return (
    <div>
      {/* Page Title & Live Squad Overview */}
      <div className="top" style={{ marginBottom: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>🏆 Study Groups &amp; Arena</h2>
          <small>
            Anonymous NEET study squads · Timer-verified hours &amp; XP v2 leaderboards
          </small>
        </div>
        {onGoToFocus && (
          <button
            type="button"
            className="em-btn"
            onClick={onGoToFocus}
            style={{ minHeight: 44, padding: '0 14px', fontSize: 12.5, whiteSpace: 'nowrap' }}
          >
            ⏱️ Focus Timer
          </button>
        )}
      </div>

      {/* Personal Live XP v2 & Timer Standing Card (powered by utils/xp.ts) */}
      <div
        className="card"
        style={{
          padding: 15,
          marginBottom: 12,
          background:
            'linear-gradient(145deg, color-mix(in srgb, var(--ac) 12%, var(--card)), var(--card) 72%)',
          borderColor: 'color-mix(in srgb, var(--ac) 34%, var(--bd))',
        }}
      >
        <div className="row sp" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div className="row" style={{ gap: 10 }}>
            <button
              type="button"
              onClick={() => onOpenProfileModal()}
              aria-label="Edit anonymous group profile"
              title="Tap to edit your anonymous nickname & avatar"
              style={{
                width: 48,
                height: 48,
                borderRadius: 15,
                fontSize: 24,
                padding: 0,
                display: 'grid',
                placeItems: 'center',
                background: 'color-mix(in srgb, var(--ac) 18%, var(--c2))',
                border: '1px solid color-mix(in srgb, var(--ac) 40%, var(--bd))',
              }}
            >
              {state.profile?.emoji || '🩺'}
            </button>
            <div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <b style={{ fontSize: 15 }}>
                  {state.profile?.nick || 'Anonymous Aspirant'}
                </b>
                {state.profile?.examYear ? (
                  <small className="mono">
                    · NEET {state.profile.examYear}
                  </small>
                ) : null}
                <button
                  type="button"
                  className="s"
                  onClick={() => onOpenProfileModal()}
                  style={{
                    minHeight: 28,
                    padding: '2px 8px',
                    fontSize: 11,
                    borderRadius: 8,
                  }}
                >
                  ✎ Edit Profile
                </button>
              </div>
              <div className="mut" style={{ fontSize: 12, marginTop: 2 }}>
                Level <b>{myPersonalStats.levelInfo.level}</b> ·{' '}
                <b className="mono">{myPersonalStats.totalXp.toLocaleString()} XP</b>
                {myRankOnCurrentBoard ? (
                  <span>
                    {' '}
                    · Group Rank <b>#{myRankOnCurrentBoard}</b>
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="s"
              onClick={() => setShowMyXpDrawer((v) => !v)}
              aria-expanded={showMyXpDrawer}
              style={{ minHeight: 40, fontSize: 12 }}
            >
              ⚡ Today: +{myPersonalStats.todayXp} XP {showMyXpDrawer ? '▴' : '▾'}
            </button>
            {myUid && activeGroupId && activeGroupPref && (
              <button
                type="button"
                className="pri"
                disabled={isPublishingMine || !isOnline}
                onClick={handlePushMyStatsNow}
                title="Push your latest timer study hours & XP to this group"
                style={{ minHeight: 40, padding: '0 12px', fontSize: 12 }}
              >
                {isPublishingMine ? 'Syncing…' : '📤 Sync My Stats'}
              </button>
            )}
          </div>
        </div>

        {/* Level Progress Bar + Quick Metric Strip */}
        <div style={{ marginTop: 10 }}>
          <div className="row sp" style={{ fontSize: 11, marginBottom: 4 }}>
            <span className="mut">
              Lv. {myPersonalStats.levelInfo.level} → Lv.{' '}
              {myPersonalStats.levelInfo.level + 1} (
              {myPersonalStats.levelInfo.progressPct}%)
            </span>
            <span className="mono mut">
              {myPersonalStats.levelInfo.xpIntoLevel} /{' '}
              {myPersonalStats.levelInfo.xpNeededForNext} XP
            </span>
          </div>
          <div className="pbar" style={{ height: 7 }}>
            <div
              className="pfill"
              style={{ width: `${myPersonalStats.levelInfo.progressPct}%` }}
            />
          </div>
        </div>

        <div
          className="stat-mini"
          style={{
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 8,
            marginTop: 10,
          }}
        >
          <div className="stat-box" style={{ padding: '8px 10px' }}>
            <small style={{ fontSize: 11 }}>Today Timer</small>
            <b className="mono" style={{ fontSize: 14 }}>
              {formatMinutesAsHoursMins(myPersonalStats.todayTimerMins)}
            </b>
          </div>
          <div className="stat-box" style={{ padding: '8px 10px' }}>
            <small style={{ fontSize: 11 }}>Week Timer</small>
            <b className="mono" style={{ fontSize: 14 }}>
              {formatMinutesAsHoursMins(myPersonalStats.weekTimerMins)}
            </b>
          </div>
          <div className="stat-box" style={{ padding: '8px 10px' }}>
            <small style={{ fontSize: 11 }}>Week XP v2</small>
            <b className="mono" style={{ fontSize: 14, color: 'var(--em)' }}>
              +{myPersonalStats.weekXp} XP
            </b>
          </div>
        </div>

        {/* Expandable Interactive Today XP v2 Breakdown Drawer */}
        {showMyXpDrawer && (
          <div
            style={{
              marginTop: 12,
              paddingTop: 12,
              borderTop: '1px solid var(--bd)',
              fontSize: 12,
            }}
          >
            <div className="row sp" style={{ marginBottom: 8 }}>
              <b>⚡ Today's XP v2 Breakdown ({todayKey})</b>
              <span className="mono" style={{ color: 'var(--em)', fontWeight: 700 }}>
                Total: +{myPersonalStats.todayBreakdown.total} XP
              </span>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))',
                gap: 6,
                marginBottom: 10,
              }}
            >
              {[
                {
                  label: 'Timer Study',
                  val: myPersonalStats.todayBreakdown.study,
                  cap: 'max 960/d',
                },
                {
                  label: 'Focus Purity ≥90%',
                  val: myPersonalStats.todayBreakdown.focusBonus,
                  cap: 'max 20/d',
                },
                {
                  label: 'Min-Day Goal Met',
                  val: myPersonalStats.todayBreakdown.minDayBonus,
                  cap: '+30/d',
                },
                {
                  label: 'Streak Bonus',
                  val: myPersonalStats.todayBreakdown.streakBonus,
                  cap: 'max 20/d',
                },
                {
                  label: 'Revisions Done',
                  val: myPersonalStats.todayBreakdown.revisions,
                  cap: '+10 on-time',
                },
                {
                  label: 'Chapters Completed',
                  val: myPersonalStats.todayBreakdown.chapters,
                  cap: '+25 each',
                },
                {
                  label: 'Mock Logged',
                  val: myPersonalStats.todayBreakdown.mocks,
                  cap: 'max 25/d',
                },
                {
                  label: 'Tasks & Habits',
                  val:
                    myPersonalStats.todayBreakdown.tasks +
                    myPersonalStats.todayBreakdown.habits,
                  cap: 'max 65/d',
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="row sp"
                  style={{
                    padding: '6px 9px',
                    borderRadius: 10,
                    background: 'var(--c2)',
                    border: '1px solid var(--bd)',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>{item.label}</div>
                    <small style={{ fontSize: 10 }}>{item.cap}</small>
                  </div>
                  <b
                    className="mono"
                    style={{
                      color: item.val > 0 ? 'var(--em)' : 'var(--mu)',
                    }}
                  >
                    +{item.val}
                  </b>
                </div>
              ))}
            </div>
            <details style={{ fontSize: 11.5, color: 'var(--mu)' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                How XP v2 &amp; Fair Group Scoring Work
              </summary>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.5 }}>
                {XP_V2_PLAIN_RULES.map((r) => (
                  <li key={r.label}>
                    <b>{r.label}:</b> {r.rule}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        )}
      </div>

      {/* 1. Signed-out state */}
      {!myUid ? (
        <div className="card" style={{ textAlign: 'center', padding: 24 }}>
          <div style={{ fontSize: 38, marginBottom: 8 }} aria-hidden="true">
            🏆
          </div>
          <b style={{ fontSize: 16, display: 'block', marginBottom: 6 }}>
            Sign In to Join NEET Study Groups
          </b>
          <p
            className="mut"
            style={{ fontSize: 13, maxWidth: 380, margin: '0 auto 16px' }}
          >
            Study with up to 3 private squads using 10-character invite codes. Compare
            timer-verified study hours, XP v2, consistency streaks, and head-to-head
            7-day pace while keeping your Google identity 100% private.
          </p>
          <button
            type="button"
            className="pri"
            onClick={onSignIn}
            style={{ minHeight: 44, padding: '0 22px' }}
          >
            Sign in with Google to Use Groups
          </button>
        </div>
      ) : !groupsConfig.consentAccepted ? (
        /* 2. First-time privacy consent screen */
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
              <b>Anonymous by design:</b> Your Google email, real name, and account ID
              are never visible to other members. You pick an anonymous nickname &amp;
              emoji.
            </li>
            <li style={{ marginBottom: 6 }}>
              <b>Timer-verified fairness:</b> Only timer-tracked sessions count toward
              group study time and XP. Manual sessions stay in your personal log only.
            </li>
            <li style={{ marginBottom: 6 }}>
              <b>Granular controls:</b> You can toggle Study Time, XP, Streak, Mock
              Scores (OFF by default), and Studying-Now status per group, or pause
              sharing anytime.
            </li>
          </ul>
          <button
            type="button"
            className="pri"
            onClick={handleAcceptConsent}
            style={{ minHeight: 44, width: '100%' }}
          >
            I Understand — Continue to Groups
          </button>
        </div>
      ) : (
        <>
          {/* Group Switcher & Create/Join Bar */}
          <div className="card" style={{ padding: 14, marginBottom: 12 }}>
            <div
              className="row sp"
              style={{ flexWrap: 'wrap', gap: 8, marginBottom: joinedGroups.length > 0 ? 10 : 0 }}
            >
              <div>
                <b style={{ fontSize: 14 }}>
                  My Study Squads ({joinedGroups.length}/{MAX_JOINED_GROUPS})
                </b>
                <div className="mut" style={{ fontSize: 11.5 }}>
                  Switch groups or create/join with a 10-character code
                </div>
              </div>

              <div className="row" style={{ gap: 6 }}>
                {joinedGroups.length < MAX_JOINED_GROUPS ? (
                  <>
                    <button
                      type="button"
                      className="pri"
                      onClick={() => {
                        if (!ensureValidProfileBeforeGroupAction('create a group'))
                          return;
                        setActionError(null);
                        setDialogMode(dialogMode === 'create' ? 'none' : 'create');
                      }}
                      style={{ minHeight: 44, padding: '0 13px', fontSize: 12.5 }}
                    >
                      + Create Group
                    </button>
                    <button
                      type="button"
                      className="s"
                      onClick={() => {
                        if (!ensureValidProfileBeforeGroupAction('join a group'))
                          return;
                        setActionError(null);
                        setDialogMode(dialogMode === 'join' ? 'none' : 'join');
                      }}
                      style={{ minHeight: 44, padding: '0 13px', fontSize: 12.5 }}
                    >
                      🔑 Join Code
                    </button>
                  </>
                ) : (
                  <small className="mono">
                    Max {MAX_JOINED_GROUPS} groups joined
                  </small>
                )}
              </div>
            </div>

            {/* Group Selector Chips */}
            {joinedGroups.length > 0 && (
              <div
                className="chips"
                style={{
                  overflowX: 'auto',
                  paddingBottom: 2,
                  gap: 6,
                  flexWrap: 'nowrap',
                }}
              >
                {joinedGroups.map((g) => {
                  const snapDoc = snapshots[g.groupId]?.doc;
                  const label =
                    snapDoc?.name || g.name || formatGroupCode(g.groupId);
                  const em = snapDoc?.emoji || g.emoji || '🩺';
                  const mCount = snapDoc
                    ? Object.keys(snapDoc.members || {}).length
                    : undefined;
                  const isSelected = g.groupId === activeGroupId;
                  return (
                    <button
                      key={g.groupId}
                      type="button"
                      className={isSelected ? 'on' : ''}
                      onClick={() => {
                        setExpandedMemberUid(null);
                        onUpdateGroupsConfig((prev) => ({
                          ...prev,
                          activeGroupId: g.groupId,
                        }));
                      }}
                      style={{ minHeight: 44, whiteSpace: 'nowrap' }}
                    >
                      {em} {label}
                      {mCount !== undefined ? ` (${mCount})` : ''}
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
                <div
                  className="chips"
                  style={{ marginBottom: 10, gap: 6, flexWrap: 'wrap' }}
                >
                  {GROUP_EMOJIS.map((em) => (
                    <button
                      key={em}
                      type="button"
                      className={newGroupEmoji === em ? 'on' : ''}
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
                    className="s"
                    onClick={() => setDialogMode('none')}
                    style={{ minHeight: 44 }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="pri"
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
                <div className="row" style={{ gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    placeholder="ABCDE-23456"
                    maxLength={15}
                    value={joinCodeInput}
                    onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                    aria-label="Group invite code"
                    className="mono"
                    style={{ minHeight: 44, flex: 1, minWidth: 160, letterSpacing: 1 }}
                    required
                  />
                  <button
                    type="submit"
                    className="pri"
                    disabled={actionBusy}
                    style={{ minHeight: 44, padding: '0 16px' }}
                  >
                    {actionBusy ? 'Joining…' : 'Join Squad'}
                  </button>
                  <button
                    type="button"
                    className="s"
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
            <div className="card" style={{ textAlign: 'center', padding: 26 }}>
              <div style={{ fontSize: 38, marginBottom: 8 }} aria-hidden="true">
                🤝
              </div>
              <b style={{ fontSize: 16, display: 'block', marginBottom: 6 }}>
                No Study Groups Joined Yet
              </b>
              <p
                className="mut"
                style={{ fontSize: 13, maxWidth: 380, margin: '0 auto 16px' }}
              >
                Create a private study group for your NEET batchmates or enter a
                10-character invite code to compare daily timer hours, weekly XP v2,
                consistency streaks, and 7-day head-to-head graphs.
              </p>
              <div
                className="row"
                style={{ justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}
              >
                <button
                  type="button"
                  className="pri"
                  onClick={() => {
                    if (!ensureValidProfileBeforeGroupAction('create a group'))
                      return;
                    setDialogMode('create');
                  }}
                  style={{ minHeight: 44, padding: '0 18px' }}
                >
                  + Create Study Group
                </button>
                <button
                  type="button"
                  className="s"
                  onClick={() => {
                    if (!ensureValidProfileBeforeGroupAction('join a group'))
                      return;
                    setDialogMode('join');
                  }}
                  style={{ minHeight: 44, padding: '0 18px' }}
                >
                  🔑 Enter Invite Code
                </button>
                {!validateNickname(state.profile?.nick || '').valid && (
                  <button
                    type="button"
                    className="s"
                    onClick={() =>
                      onOpenProfileModal(
                        'Configure your anonymous nickname (2–20 chars) and emoji avatar before joining a group.'
                      )
                    }
                    style={{ minHeight: 44, padding: '0 16px' }}
                  >
                    {state.profile?.emoji || '🩺'} Set Up Profile First
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Loading / Uncached state when a group is selected but snapshot hasn't loaded yet */}
          {activeGroupId && !activeGroupDoc && (
            <div
              className="card"
              style={{ textAlign: 'center', padding: 24, marginBottom: 12 }}
            >
              <div style={{ fontSize: 30, marginBottom: 8 }} aria-hidden="true">
                {isRefreshing ? '⏳' : '📡'}
              </div>
              <b style={{ fontSize: 15, display: 'block', marginBottom: 6 }}>
                {isRefreshing
                  ? 'Loading Group Leaderboard…'
                  : 'Group Snapshot Unavailable Offline'}
              </b>
              <p
                className="mut"
                style={{ fontSize: 13, maxWidth: 340, margin: '0 auto 14px' }}
              >
                {isRefreshing
                  ? 'Fetching latest study hours and XP standings from Cloud Firestore…'
                  : 'Connect to the internet and tap Refresh to load this study group.'}
              </p>
              <button
                type="button"
                className="pri"
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
              {/* Group Header & Live Activity Card */}
              <div className="card" style={{ padding: 15, marginBottom: 12 }}>
                <div className="row sp" style={{ flexWrap: 'wrap', gap: 8 }}>
                  <div className="row" style={{ gap: 10 }}>
                    <span style={{ fontSize: 30 }} aria-hidden="true">
                      {activeGroupDoc.emoji}
                    </span>
                    <div>
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                        <b style={{ fontSize: 16.5 }}>{activeGroupDoc.name}</b>
                        <small className="mono">
                          · {memberCount}/{activeGroupDoc.memberCap || 50} members
                        </small>
                      </div>
                      <div className="mut" style={{ fontSize: 11.5, marginTop: 2 }}>
                        Invite Code:{' '}
                        <b className="mono" style={{ color: 'var(--tx)' }}>
                          {formatGroupCode(activeGroupId)}
                        </b>{' '}
                        · Updated{' '}
                        {formatRelativeAgo(activeSnapshot?.fetchedAt || 0, nowTick)}{' '}
                        <small>(5m auto-cache)</small>
                      </div>
                    </div>
                  </div>

                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="s"
                      onClick={() => handleCopyInvite(activeGroupId)}
                      aria-label="Copy group invite code"
                      style={{ minHeight: 44, padding: '0 11px', fontSize: 12 }}
                    >
                      📋 Copy Code
                    </button>
                    <button
                      type="button"
                      className="s"
                      onClick={() =>
                        handleShareInvite(activeGroupId, activeGroupDoc.name)
                      }
                      aria-label="Share group invite code"
                      style={{ minHeight: 44, padding: '0 11px', fontSize: 12 }}
                    >
                      📤 Invite
                    </button>
                    <button
                      type="button"
                      className="s"
                      disabled={
                        isRefreshing || refreshCooldownLeftSec > 0 || !isOnline
                      }
                      onClick={() => refreshGroup(activeGroupId, true)}
                      aria-label="Refresh group leaderboard"
                      style={{ minHeight: 44, padding: '0 11px', fontSize: 12 }}
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

                {/* Studying Now Live Strip */}
                {studyingNowList.length > 0 && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: '9px 12px',
                      borderRadius: 12,
                      background: 'rgba(16, 185, 129, 0.12)',
                      border: '1px solid rgba(16, 185, 129, 0.32)',
                      fontSize: 12.5,
                    }}
                  >
                    <b style={{ color: '#10b981' }}>
                      🟢 Studying right now ({studyingNowList.length}):
                    </b>{' '}
                    {studyingNowList.map((m, idx) => (
                      <span key={m.uid}>
                        {idx > 0 ? ' · ' : ''}
                        {m.emoji} <b>{m.nick}</b> ({m.elapsedMins}m)
                      </span>
                    ))}
                  </div>
                )}

                {/* Received Cheers Chip */}
                {todayCheersReceived.length > 0 && (
                  <div
                    style={{
                      marginTop: 10,
                      padding: '9px 12px',
                      borderRadius: 12,
                      background: 'rgba(245, 158, 11, 0.12)',
                      border: '1px solid rgba(245, 158, 11, 0.32)',
                      fontSize: 12.5,
                    }}
                  >
                    <b>
                      🎉 You received {todayCheersReceived.length} cheer
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

                {/* Interactive Pace Target (Friendly Rival) Card */}
                {paceComparison && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: '10px 12px',
                      borderRadius: 13,
                      background: 'color-mix(in srgb, var(--ac) 11%, var(--c2))',
                      border: '1px solid color-mix(in srgb, var(--ac) 32%, var(--bd))',
                      fontSize: 12.5,
                    }}
                  >
                    <div className="row sp" style={{ flexWrap: 'wrap', gap: 6 }}>
                      <div>
                        <b>
                          🎯 Pace Target: {paceComparison.entry.emoji}{' '}
                          {paceComparison.entry.nick}
                        </b>
                        <div className="mut" style={{ fontSize: 11.5, marginTop: 2 }}>
                          Today:{' '}
                          <b
                            className="mono"
                            style={{
                              color:
                                paceComparison.diffTodayMins >= 0
                                  ? '#10b981'
                                  : '#f59e0b',
                            }}
                          >
                            {paceComparison.diffTodayMins >= 0
                              ? `You lead by +${formatMinutesAsHoursMins(paceComparison.diffTodayMins)}`
                              : `${formatMinutesAsHoursMins(Math.abs(paceComparison.diffTodayMins))} to catch up`}
                          </b>{' '}
                          · Week:{' '}
                          <b
                            className="mono"
                            style={{
                              color:
                                paceComparison.diffWeekMins >= 0
                                  ? '#10b981'
                                  : '#f59e0b',
                            }}
                          >
                            {paceComparison.diffWeekMins >= 0
                              ? `+${formatMinutesAsHoursMins(paceComparison.diffWeekMins)} ahead`
                              : `${formatMinutesAsHoursMins(Math.abs(paceComparison.diffWeekMins))} behind`}
                          </b>{' '}
                          ({paceComparison.diffWeekXp >= 0 ? '+' : ''}
                          {paceComparison.diffWeekXp} XP)
                        </div>
                      </div>
                      <button
                        type="button"
                        className="s"
                        onClick={() =>
                          handleTogglePaceTarget(
                            paceComparison.uid,
                            paceComparison.entry.nick
                          )
                        }
                        style={{ minHeight: 34, padding: '4px 10px', fontSize: 11 }}
                      >
                        Clear Target
                      </button>
                    </div>
                  </div>
                )}

                {/* Weekly Group Hours Goal + Interactive Member Contribution Breakdown */}
                {weeklyGoalProg && weeklyGoalProg.hasGoal && (
                  <div style={{ marginTop: 12 }}>
                    <div className="row sp" style={{ fontSize: 12, marginBottom: 4 }}>
                      <span className="mut">
                        🎯 Weekly Squad Goal:{' '}
                        <b style={{ color: 'var(--tx)' }}>
                          {formatMinutesAsHoursMins(weeklyGoalProg.combinedMinutes)}
                        </b>{' '}
                        / {formatMinutesAsHoursMins(weeklyGoalProg.targetMinutes)}
                      </span>
                      <div className="row" style={{ gap: 8 }}>
                        <b className="mono">{weeklyGoalProg.pct}%</b>
                        {weeklyMemberContributions.length > 0 && (
                          <button
                            type="button"
                            className="s"
                            onClick={() => setShowGoalBreakdown((v) => !v)}
                            style={{
                              minHeight: 28,
                              padding: '2px 8px',
                              fontSize: 11,
                              borderRadius: 8,
                            }}
                          >
                            {showGoalBreakdown ? 'Hide Split ▴' : 'Contributions ▾'}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="pbar" style={{ height: 9 }}>
                      <div
                        className="pfill"
                        style={{
                          width: `${weeklyGoalProg.pct}%`,
                          background: weeklyGoalProg.reached
                            ? '#10b981'
                            : 'linear-gradient(90deg, var(--ac), var(--em))',
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
                        🏆 Squad goal achieved! Outstanding teamwork this week!
                      </div>
                    )}
                    {showGoalBreakdown && weeklyMemberContributions.length > 0 && (
                      <div
                        style={{
                          marginTop: 10,
                          padding: '10px 12px',
                          borderRadius: 12,
                          background: 'var(--c2)',
                          fontSize: 12,
                        }}
                      >
                        <div
                          className="mut"
                          style={{ fontSize: 11, marginBottom: 6, fontWeight: 600 }}
                        >
                          Member Contributions to Weekly Goal
                        </div>
                        {weeklyMemberContributions.map((c) => (
                          <div
                            key={c.uid}
                            className="row sp"
                            style={{ padding: '4px 0', fontSize: 12 }}
                          >
                            <span>
                              {c.emoji} <b>{c.nick}</b>
                              {c.uid === myUid ? ' (You)' : ''}
                            </span>
                            <span className="mono">
                              <b>{formatMinutesAsHoursMins(c.minutes)}</b> ({c.sharePct}
                              %)
                            </span>
                          </div>
                        ))}
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
                  marginBottom: 10,
                  paddingBottom: 2,
                }}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={boardTab === 'today'}
                  className={boardTab === 'today' ? 'on' : ''}
                  onClick={() => setBoardTab('today')}
                  style={{ minHeight: 44, whiteSpace: 'nowrap' }}
                >
                  ☀️ Today
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={boardTab === 'week'}
                  className={boardTab === 'week' ? 'on' : ''}
                  onClick={() => setBoardTab('week')}
                  style={{ minHeight: 44, whiteSpace: 'nowrap' }}
                >
                  📅 Week
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={boardTab === 'xp'}
                  className={boardTab === 'xp' ? 'on' : ''}
                  onClick={() => setBoardTab('xp')}
                  style={{ minHeight: 44, whiteSpace: 'nowrap' }}
                >
                  ⚡ XP
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={boardTab === 'streak'}
                  className={boardTab === 'streak' ? 'on' : ''}
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
                    className={boardTab === 'mocks' ? 'on' : ''}
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
                  className={boardTab === 'history' ? 'on' : ''}
                  onClick={() => setBoardTab('history')}
                  style={{ minHeight: 44, whiteSpace: 'nowrap' }}
                >
                  🏅 History
                </button>
              </div>

              {/* Sub-controls for XP or Mocks + Interactive Member Filter & Search */}
              {boardTab !== 'history' && (
                <div
                  className="row sp"
                  style={{
                    flexWrap: 'wrap',
                    gap: 8,
                    marginBottom: 10,
                  }}
                >
                  <div className="chips" style={{ paddingBottom: 0, gap: 5 }}>
                    {boardTab === 'xp' && (
                      <>
                        <button
                          type="button"
                          className={xpSortMode === 'weekly' ? 'on' : ''}
                          onClick={() => setXpSortMode('weekly')}
                          style={{ minHeight: 38, padding: '4px 12px', fontSize: 12 }}
                        >
                          This Week XP
                        </button>
                        <button
                          type="button"
                          className={xpSortMode === 'allTime' ? 'on' : ''}
                          onClick={() => setXpSortMode('allTime')}
                          style={{ minHeight: 38, padding: '4px 12px', fontSize: 12 }}
                        >
                          All-Time XP &amp; Level
                        </button>
                      </>
                    )}
                    {boardTab === 'mocks' && activeGroupDoc.mockBoard && (
                      <>
                        <button
                          type="button"
                          className={mockSortMode === 'latest' ? 'on' : ''}
                          onClick={() => setMockSortMode('latest')}
                          style={{ minHeight: 38, padding: '4px 12px', fontSize: 12 }}
                        >
                          Latest Score
                        </button>
                        <button
                          type="button"
                          className={mockSortMode === 'best' ? 'on' : ''}
                          onClick={() => setMockSortMode('best')}
                          style={{ minHeight: 38, padding: '4px 12px', fontSize: 12 }}
                        >
                          Best Score
                        </button>
                        <button
                          type="button"
                          className={mockSortMode === 'avg5' ? 'on' : ''}
                          onClick={() => setMockSortMode('avg5')}
                          style={{ minHeight: 38, padding: '4px 12px', fontSize: 12 }}
                        >
                          Avg of Last 5
                        </button>
                      </>
                    )}
                    {(
                      [
                        { id: 'all' as const, label: 'All' },
                        { id: 'activeToday' as const, label: 'Active Today' },
                        { id: 'top3' as const, label: 'Top 3' },
                        ...(studyingNowList.length > 0
                          ? [{ id: 'studyingNow' as const, label: '🟢 Live' }]
                          : []),
                      ] as const
                    ).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        className={memberFilter === f.id ? 'on' : ''}
                        onClick={() => setMemberFilter(f.id)}
                        style={{ minHeight: 38, padding: '4px 11px', fontSize: 12 }}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  {rankedRows.length >= 4 && (
                    <input
                      type="search"
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      placeholder="Filter member…"
                      aria-label="Filter group members by nickname"
                      style={{
                        minHeight: 38,
                        width: 155,
                        padding: '5px 10px',
                        fontSize: 12,
                      }}
                    />
                  )}
                </div>
              )}

              {boardTab === 'mocks' && activeGroupDoc.mockBoard && (
                <div
                  style={{
                    padding: '8px 12px',
                    borderRadius: 10,
                    background: 'var(--c2)',
                    fontSize: 12,
                    marginBottom: 10,
                    color: 'var(--mu)',
                  }}
                >
                  💡 <i>Scores are shared only by choice. Rank is not your worth.</i>
                </div>
              )}

              {/* Visual Top-3 Podium Card */}
              {boardTab !== 'history' &&
                memberFilter === 'all' &&
                !memberSearch.trim() &&
                podiumRows.length > 0 && (
                  <div
                    className="card"
                    style={{
                      padding: '14px 12px',
                      marginBottom: 12,
                      background:
                        'linear-gradient(180deg, color-mix(in srgb, var(--am) 9%, var(--card)), var(--card) 85%)',
                    }}
                  >
                    <div
                      className="row sp"
                      style={{ marginBottom: 10, fontSize: 12 }}
                    >
                      <b>
                        🏅 Top Podium ·{' '}
                        {boardTab === 'today'
                          ? "Today's Study Time"
                          : boardTab === 'week'
                            ? 'This Week Study Time'
                            : boardTab === 'xp'
                              ? xpSortMode === 'weekly'
                                ? 'Weekly XP v2'
                                : 'All-Time XP & Level'
                              : boardTab === 'streak'
                                ? 'Consistency & Streak'
                                : 'Mock Test Standings'}
                      </b>
                      <small>Tap any member to compare 7-day pace</small>
                    </div>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, 1fr)',
                        gap: 8,
                        alignItems: 'end',
                      }}
                    >
                      {[2, 1, 3].map((targetRank) => {
                        const pRow = podiumRows.find((r) => r.rank === targetRank);
                        if (!pRow) {
                          return (
                            <div
                              key={targetRank}
                              style={{
                                textAlign: 'center',
                                padding: '10px 6px',
                                borderRadius: 14,
                                border: '1px dashed var(--bd)',
                                opacity: 0.45,
                                minHeight: targetRank === 1 ? 116 : 98,
                                display: 'grid',
                                placeItems: 'center',
                                fontSize: 11,
                              }}
                            >
                              #{targetRank} Open
                            </div>
                          );
                        }
                        const medal =
                          targetRank === 1
                            ? '🥇'
                            : targetRank === 2
                              ? '🥈'
                              : '🥉';
                        const isMe = pRow.uid === myUid;
                        return (
                          <button
                            key={pRow.uid}
                            type="button"
                            onClick={() =>
                              setExpandedMemberUid((cur) =>
                                cur === pRow.uid ? null : pRow.uid
                              )
                            }
                            style={{
                              textAlign: 'center',
                              padding: targetRank === 1 ? '12px 8px' : '10px 6px',
                              borderRadius: 16,
                              background:
                                targetRank === 1
                                  ? 'linear-gradient(160deg, rgba(245, 158, 11, 0.2), color-mix(in srgb, var(--c2) 85%, transparent))'
                                  : 'var(--c2)',
                              border:
                                targetRank === 1
                                  ? '1.5px solid rgba(245, 158, 11, 0.5)'
                                  : isMe
                                    ? '1.5px solid var(--ac)'
                                    : '1px solid var(--bd)',
                              minHeight: targetRank === 1 ? 124 : 104,
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: 3,
                            }}
                          >
                            <span style={{ fontSize: targetRank === 1 ? 24 : 20 }}>
                              {medal} {pRow.entry.emoji}
                            </span>
                            <b
                              style={{
                                fontSize: 12.5,
                                maxWidth: '100%',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {pRow.entry.nick}
                              {isMe ? ' (You)' : ''}
                            </b>
                            <span
                              className="mono"
                              style={{
                                fontSize: 12,
                                fontWeight: 800,
                                color:
                                  targetRank === 1 ? '#fbbf24' : 'var(--ac)',
                              }}
                            >
                              {pRow.displayLabel}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

              {/* Leaderboard Member List + Expandable Head-to-Head Compare Drawer */}
              {boardTab !== 'history' && (
                <div className="card" style={{ padding: 12, marginBottom: 12 }}>
                  {filteredRows.length === 0 ? (
                    <div
                      className="mut"
                      style={{ textAlign: 'center', padding: 20, fontSize: 13 }}
                    >
                      No members match the current filter on this leaderboard.
                    </div>
                  ) : (
                    filteredRows.map((row) => {
                      const isMe = row.uid === myUid;
                      const isExpanded = expandedMemberUid === row.uid;
                      const isPaceTarget = activePaceTargetUid === row.uid;
                      const isLiveNow = studyingNowUidSet.has(row.uid);
                      const liveMemberInfo = studyingNowByUid.get(row.uid);
                      const liveTooltipText = isLiveNow
                        ? getStudyingNowTooltipText(
                            row.entry,
                            nowTick,
                            liveMemberInfo?.since
                          )
                        : '';
                      const dotHoverKey = `gv_dot_${row.uid}`;
                      const badgeHoverKey = `gv_badge_${row.uid}`;
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
                        sentCheersLocal[
                          `${activeGroupId}_${row.uid}_${todayKey}`
                        ];

                      const memberTodayMins = row.entry.days?.[todayKey] || 0;
                      const memberWeekMins = sumMemberRange(
                        row.entry,
                        myPersonalStats.weekKeys,
                        'm'
                      );
                      const memberWeekXp = sumMemberRange(
                        row.entry,
                        myPersonalStats.weekKeys,
                        'xp'
                      );

                      return (
                        <div
                          key={row.uid}
                          style={{
                            borderBottom: '1px solid var(--bd)',
                            padding: '10px 8px',
                            background: isMe
                              ? 'rgba(56, 189, 248, 0.09)'
                              : isExpanded
                                ? 'color-mix(in srgb, var(--c2) 60%, transparent)'
                                : 'transparent',
                            border: isMe
                              ? '1px solid rgba(56, 189, 248, 0.32)'
                              : undefined,
                            borderRadius: isMe || isExpanded ? 12 : 0,
                            marginBottom: isMe || isExpanded ? 4 : 0,
                            opacity: row.hidden ? 0.65 : 1,
                          }}
                        >
                          <div
                            className="row sp"
                            onClick={() =>
                              setExpandedMemberUid((cur) =>
                                cur === row.uid ? null : row.uid
                              )
                            }
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setExpandedMemberUid((cur) =>
                                  cur === row.uid ? null : row.uid
                                );
                              }
                            }}
                            aria-expanded={isExpanded}
                            style={{
                              cursor: 'pointer',
                              gap: 8,
                              flexWrap: 'wrap',
                            }}
                          >
                            <div
                              className="row"
                              style={{ gap: 10, minWidth: 0, flex: 1 }}
                            >
                              <span
                                className="mono"
                                style={{
                                  minWidth: 30,
                                  textAlign: 'center',
                                  fontWeight: 800,
                                  fontSize:
                                    row.rank && row.rank <= 3 ? 19 : 13,
                                }}
                              >
                                {rankBadge}
                              </span>

                              {/* Enhanced User Avatar with Status Indicator Dot */}
                              <div
                                style={{
                                  position: 'relative',
                                  width: 40,
                                  height: 40,
                                  borderRadius: 12,
                                  background: isLiveNow
                                    ? 'rgba(16, 185, 129, 0.14)'
                                    : isMe
                                      ? 'rgba(56, 189, 248, 0.14)'
                                      : 'var(--c2)',
                                  border: isLiveNow
                                    ? '1.5px solid rgba(16, 185, 129, 0.55)'
                                    : isMe
                                      ? '1.5px solid rgba(56, 189, 248, 0.48)'
                                      : '1px solid var(--bd)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  flexShrink: 0,
                                }}
                              >
                                <span
                                  style={{ fontSize: 21, lineHeight: 1 }}
                                  aria-hidden="true"
                                >
                                  {row.entry.emoji}
                                </span>
                                <span
                                  role="status"
                                  tabIndex={isLiveNow ? 0 : undefined}
                                  onMouseEnter={() => {
                                    if (isLiveNow)
                                      setHoveredLiveStatusKey(dotHoverKey);
                                  }}
                                  onMouseLeave={() => {
                                    if (hoveredLiveStatusKey === dotHoverKey)
                                      setHoveredLiveStatusKey(null);
                                  }}
                                  onFocus={() => {
                                    if (isLiveNow)
                                      setHoveredLiveStatusKey(dotHoverKey);
                                  }}
                                  onBlur={() => {
                                    if (hoveredLiveStatusKey === dotHoverKey)
                                      setHoveredLiveStatusKey(null);
                                  }}
                                  aria-label={
                                    isLiveNow
                                      ? liveTooltipText
                                      : row.entry.paused
                                        ? 'Sharing paused'
                                        : memberTodayMins > 0
                                          ? 'Studied today'
                                          : 'Idle today'
                                  }
                                  title={
                                    isLiveNow
                                      ? liveTooltipText
                                      : row.entry.paused
                                        ? 'Sharing paused'
                                        : memberTodayMins > 0
                                          ? `Studied ${formatMinutesAsHoursMins(memberTodayMins)} today`
                                          : 'No study logged yet today'
                                  }
                                  style={{
                                    position: 'absolute',
                                    right: -2,
                                    bottom: -2,
                                    width: 11,
                                    height: 11,
                                    borderRadius: '50%',
                                    background: isLiveNow
                                      ? '#10b981'
                                      : row.entry.paused
                                        ? '#f59e0b'
                                        : memberTodayMins > 0
                                          ? '#38bdf8'
                                          : 'var(--bd)',
                                    border: '2px solid var(--card)',
                                    boxShadow: isLiveNow
                                      ? '0 0 0 2px rgba(16, 185, 129, 0.3)'
                                      : 'none',
                                    cursor: isLiveNow ? 'help' : 'default',
                                  }}
                                />
                                {isLiveNow &&
                                  hoveredLiveStatusKey === dotHoverKey && (
                                    <div
                                      role="tooltip"
                                      className="mono"
                                      style={{
                                        position: 'absolute',
                                        bottom: 'calc(100% + 6px)',
                                        left: 0,
                                        zIndex: 30,
                                        whiteSpace: 'nowrap',
                                        background: 'var(--card)',
                                        color: 'var(--tx)',
                                        border:
                                          '1px solid rgba(16, 185, 129, 0.5)',
                                        boxShadow:
                                          '0 6px 18px rgba(0, 0, 0, 0.28)',
                                        padding: '4px 8px',
                                        borderRadius: 6,
                                        fontSize: 11,
                                        fontWeight: 700,
                                        pointerEvents: 'none',
                                      }}
                                    >
                                      {liveTooltipText}
                                    </div>
                                  )}
                              </div>

                              <div style={{ minWidth: 0 }}>
                                <div
                                  className="row"
                                  style={{ gap: 6, flexWrap: 'wrap' }}
                                >
                                  <b style={{ fontSize: 14 }}>
                                    {row.entry.nick}
                                    {isMe ? ' (You)' : ''}
                                  </b>
                                  {isLiveNow && (
                                    <span
                                      title={liveTooltipText}
                                      aria-label={liveTooltipText}
                                      onMouseEnter={() =>
                                        setHoveredLiveStatusKey(badgeHoverKey)
                                      }
                                      onMouseLeave={() => {
                                        if (
                                          hoveredLiveStatusKey === badgeHoverKey
                                        )
                                          setHoveredLiveStatusKey(null);
                                      }}
                                      style={{
                                        position: 'relative',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 4,
                                        color: '#10b981',
                                        background: 'rgba(16, 185, 129, 0.12)',
                                        border:
                                          '1px solid rgba(16, 185, 129, 0.3)',
                                        padding: '1px 7px',
                                        borderRadius: 6,
                                        fontWeight: 700,
                                        fontSize: 10.5,
                                        cursor: 'help',
                                      }}
                                    >
                                      <span
                                        aria-hidden="true"
                                        style={{
                                          width: 6,
                                          height: 6,
                                          borderRadius: '50%',
                                          background: '#10b981',
                                        }}
                                      />
                                      Studying now
                                      {hoveredLiveStatusKey ===
                                        badgeHoverKey && (
                                        <span
                                          role="tooltip"
                                          className="mono"
                                          style={{
                                            position: 'absolute',
                                            bottom: 'calc(100% + 6px)',
                                            left: 0,
                                            zIndex: 30,
                                            whiteSpace: 'nowrap',
                                            background: 'var(--card)',
                                            color: 'var(--tx)',
                                            border:
                                              '1px solid rgba(16, 185, 129, 0.5)',
                                            boxShadow:
                                              '0 6px 18px rgba(0, 0, 0, 0.28)',
                                            padding: '4px 8px',
                                            borderRadius: 6,
                                            fontSize: 11,
                                            fontWeight: 700,
                                            pointerEvents: 'none',
                                          }}
                                        >
                                          {liveTooltipText}
                                        </span>
                                      )}
                                    </span>
                                  )}
                                  {!isLiveNow && row.entry.paused && (
                                    <small
                                      style={{
                                        color: '#f59e0b',
                                        fontWeight: 600,
                                        fontSize: 10.5,
                                      }}
                                    >
                                      · Paused
                                    </small>
                                  )}
                                  {isPaceTarget && (
                                    <small
                                      style={{
                                        color: 'var(--ac)',
                                        fontWeight: 700,
                                        fontSize: 11,
                                      }}
                                    >
                                      · 🎯 Target
                                    </small>
                                  )}
                                  {row.entry.examYear && (
                                    <span
                                      className="mut"
                                      style={{ fontSize: 11 }}
                                    >
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
                                      {row.medals.gold > 0
                                        ? `🥇${row.medals.gold} `
                                        : ''}
                                      {row.medals.silver > 0
                                        ? `🥈${row.medals.silver} `
                                        : ''}
                                      {row.medals.bronze > 0
                                        ? `🥉${row.medals.bronze}`
                                        : ''}
                                    </span>
                                  )}
                                </div>
                                <div className="mut" style={{ fontSize: 11 }}>
                                  updated{' '}
                                  {formatRelativeAgo(
                                    row.entry.updatedAt,
                                    nowTick
                                  )}
                                  {row.subLabel ? ` · ${row.subLabel}` : ''} ·{' '}
                                  <span style={{ color: 'var(--ac)' }}>
                                    {isExpanded ? 'Hide ▴' : 'Compare ▾'}
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div
                              className="row"
                              style={{ gap: 8 }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div style={{ textAlign: 'right' }}>
                                <b
                                  className="mono"
                                  style={{
                                    fontSize: 14.5,
                                    color: row.hidden
                                      ? 'var(--mu)'
                                      : 'var(--tx)',
                                  }}
                                >
                                  {row.displayLabel}
                                </b>
                              </div>

                              {/* One-Tap Cheer Buttons for Other Members */}
                              {!isMe && (
                                <div className="row" style={{ gap: 2 }}>
                                  {ALLOWED_CHEER_EMOJIS.map((ce) => (
                                    <button
                                      key={ce}
                                      type="button"
                                      onClick={() =>
                                        handleSendCheer(
                                          row.uid,
                                          row.entry.nick,
                                          ce
                                        )
                                      }
                                      aria-label={`Send ${ce} cheer to ${row.entry.nick}`}
                                      title={`Cheer ${row.entry.nick} with ${ce}`}
                                      style={{
                                        minWidth: 34,
                                        minHeight: 40,
                                        padding: 0,
                                        borderRadius: 10,
                                        fontSize: 14,
                                        background:
                                          sentCheer === ce
                                            ? 'rgba(16, 185, 129, 0.22)'
                                            : 'transparent',
                                        borderColor:
                                          sentCheer === ce
                                            ? 'rgba(16, 185, 129, 0.45)'
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

                          {/* Expandable Head-to-Head Compare & 7-Day Sparkline Drawer */}
                          {isExpanded && (
                            <div
                              style={{
                                marginTop: 10,
                                paddingTop: 10,
                                borderTop: '1px dashed var(--bd)',
                                fontSize: 12,
                              }}
                            >
                              <div
                                className="row sp"
                                style={{
                                  flexWrap: 'wrap',
                                  gap: 8,
                                  marginBottom: 8,
                                }}
                              >
                                <b>
                                  ⚡ 7-Day Study Comparison:{' '}
                                  {isMe
                                    ? 'Your Last 7 Days'
                                    : `You vs ${row.entry.nick}`}
                                </b>
                                {!isMe && (
                                  <button
                                    type="button"
                                    className={isPaceTarget ? 'on' : 's'}
                                    onClick={() =>
                                      handleTogglePaceTarget(
                                        row.uid,
                                        row.entry.nick
                                      )
                                    }
                                    style={{
                                      minHeight: 34,
                                      padding: '4px 10px',
                                      fontSize: 11.5,
                                    }}
                                  >
                                    {isPaceTarget
                                      ? '🎯 Active Pace Target'
                                      : '🎯 Set as Pace Target'}
                                  </button>
                                )}
                              </div>

                              {/* 7-Day Sparkline Bars */}
                              <div
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns: 'repeat(7, 1fr)',
                                  gap: 6,
                                  marginBottom: 10,
                                  padding: '10px 8px',
                                  borderRadius: 12,
                                  background: 'var(--c2)',
                                }}
                              >
                                {myPersonalStats.last7Keys.map((dk) => {
                                  const myM =
                                    myPersonalStats.timerMinsByDay[dk] || 0;
                                  const theirM = row.entry.days?.[dk] || 0;
                                  const maxM = Math.max(
                                    240,
                                    myM,
                                    theirM
                                  );
                                  const myH = Math.round((myM / maxM) * 44);
                                  const theirH = Math.round(
                                    (theirM / maxM) * 44
                                  );
                                  return (
                                    <div
                                      key={dk}
                                      style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        gap: 4,
                                      }}
                                    >
                                      <div
                                        style={{
                                          height: 46,
                                          display: 'flex',
                                          alignItems: 'flex-end',
                                          gap: 3,
                                        }}
                                      >
                                        <div
                                          title={`You (${dk}): ${formatMinutesAsHoursMins(myM)}`}
                                          style={{
                                            width: isMe ? 14 : 9,
                                            height: Math.max(3, myH),
                                            borderRadius: 4,
                                            background: 'var(--ac)',
                                          }}
                                        />
                                        {!isMe && (
                                          <div
                                            title={`${row.entry.nick} (${dk}): ${formatMinutesAsHoursMins(theirM)}`}
                                            style={{
                                              width: 9,
                                              height: Math.max(3, theirH),
                                              borderRadius: 4,
                                              background: 'var(--em)',
                                            }}
                                          />
                                        )}
                                      </div>
                                      <span
                                        className="mono mut"
                                        style={{ fontSize: 10 }}
                                      >
                                        {dk.slice(8)}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>

                              {/* Head-to-Head Summary Metrics */}
                              <div
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns:
                                    'repeat(auto-fit, minmax(125px, 1fr))',
                                  gap: 6,
                                }}
                              >
                                <div
                                  className="stat-box"
                                  style={{ padding: '7px 9px' }}
                                >
                                  <small style={{ fontSize: 10.5 }}>
                                    Today Study
                                  </small>
                                  <b className="mono" style={{ fontSize: 13 }}>
                                    {row.entry.sh.t
                                      ? formatMinutesAsHoursMins(memberTodayMins)
                                      : 'Hidden'}
                                  </b>
                                </div>
                                <div
                                  className="stat-box"
                                  style={{ padding: '7px 9px' }}
                                >
                                  <small style={{ fontSize: 10.5 }}>
                                    This Week Study
                                  </small>
                                  <b className="mono" style={{ fontSize: 13 }}>
                                    {row.entry.sh.t
                                      ? formatMinutesAsHoursMins(memberWeekMins)
                                      : 'Hidden'}
                                  </b>
                                </div>
                                <div
                                  className="stat-box"
                                  style={{ padding: '7px 9px' }}
                                >
                                  <small style={{ fontSize: 10.5 }}>
                                    Week / Total XP
                                  </small>
                                  <b className="mono" style={{ fontSize: 13 }}>
                                    {row.entry.sh.x
                                      ? `${memberWeekXp} / ${(row.entry.xpTotal || 0).toLocaleString()}`
                                      : 'Hidden'}
                                  </b>
                                </div>
                                <div
                                  className="stat-box"
                                  style={{ padding: '7px 9px' }}
                                >
                                  <small style={{ fontSize: 10.5 }}>
                                    Streak &amp; Consistency
                                  </small>
                                  <b className="mono" style={{ fontSize: 13 }}>
                                    {row.entry.sh.s
                                      ? `${row.entry.streak ?? 0}d · ${row.entry.consistency ?? 0}%`
                                      : 'Hidden'}
                                  </b>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {/* History & Trophies Tab */}
              {boardTab === 'history' && (
                <div className="card" style={{ padding: 14, marginBottom: 12 }}>
                  <b style={{ fontSize: 14, display: 'block', marginBottom: 8 }}>
                    🏅 Weekly Standings &amp; Trophy Cabinet (Last 12 Weeks)
                  </b>
                  {(() => {
                    const myEntry = myUid
                      ? activeGroupDoc.members[myUid]
                      : undefined;
                    const combinedWeeks = {
                      ...(myEntry?.weeks || {}),
                      ...(state.groupHistory?.[activeGroupId] || {}),
                    };
                    const weekKeys = Object.keys(combinedWeeks)
                      .sort()
                      .reverse()
                      .slice(0, 12);
                    const myMedals = myEntry
                      ? computeMemberMedals({
                          ...myEntry,
                          weeks: combinedWeeks,
                        })
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
                            background: 'var(--c2)',
                          }}
                        >
                          <span>
                            🥇 Gold: <b>{myMedals.gold}</b>
                          </span>
                          <span>
                            🥈 Silver: <b>{myMedals.silver}</b>
                          </span>
                          <span>
                            🥉 Bronze: <b>{myMedals.bronze}</b>
                          </span>
                        </div>

                        {weekKeys.length === 0 ? (
                          <div className="mut" style={{ fontSize: 13 }}>
                            Completed weekly standings appear here automatically each
                            Monday when at least 2 members share study time.
                          </div>
                        ) : (
                          weekKeys.map((wk) => {
                            const w = combinedWeeks[wk];
                            if (!w) return null;
                            const medal =
                              w.rank === 1
                                ? '🥇'
                                : w.rank === 2
                                  ? '🥈'
                                  : w.rank === 3
                                    ? '🥉'
                                    : '🏅';
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
                                  {formatMinutesAsHoursMins(w.minutes)} · {w.xp}{' '}
                                  XP
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
                    Unchecked items are omitted from your group entry and shown as
                    "hidden".
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
                        onChange={(e) =>
                          handleToggleSharingFlag(item.key, e.target.checked)
                        }
                        style={{ width: 20, height: 20 }}
                      />
                    </label>
                  ))}

                  <div className="row sp" style={{ marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
                    <span className="mut" style={{ fontSize: 11 }}>
                      Group writes today: {groupBudget.getWritesToday()}/60 · Reads:{' '}
                      {groupBudget.getReadsToday()}/150
                    </span>
                    {confirmLeaveGroupId === activeGroupId ? (
                      <div className="row" style={{ gap: 6 }}>
                        <button
                          type="button"
                          className="dg-btn"
                          disabled={actionBusy}
                          onClick={() => handleLeaveGroup(activeGroupId)}
                          style={{ minHeight: 40, fontSize: 12 }}
                        >
                          Confirm Leave
                        </button>
                        <button
                          type="button"
                          className="s"
                          onClick={() => setConfirmLeaveGroupId(null)}
                          style={{ minHeight: 40, fontSize: 12 }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="s"
                        onClick={() => setConfirmLeaveGroupId(activeGroupId)}
                        style={{
                          minHeight: 40,
                          fontSize: 12,
                          color: '#f43f5e',
                        }}
                      >
                        Leave Group
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Owner Tools Card */}
              {isOwner && (
                <div className="card" style={{ padding: 14, marginBottom: 12 }}>
                  <div className="row sp">
                    <b style={{ fontSize: 14 }}>👑 Group Owner Tools</b>
                    <button
                      type="button"
                      className="s"
                      onClick={() => setShowOwnerDrawer((v) => !v)}
                      style={{ minHeight: 36, fontSize: 12 }}
                    >
                      {showOwnerDrawer ? 'Hide ▴' : 'Manage Squad ▾'}
                    </button>
                  </div>

                  {showOwnerDrawer && (
                    <div style={{ marginTop: 12 }}>
                      <form
                        onSubmit={handleOwnerSaveSettings}
                        style={{ marginBottom: 12 }}
                      >
                        <div
                          className="row"
                          style={{ gap: 8, marginBottom: 8, flexWrap: 'wrap' }}
                        >
                          <input
                            type="text"
                            value={ownerEditName}
                            maxLength={32}
                            onChange={(e) => setOwnerEditName(e.target.value)}
                            placeholder="Group Name"
                            aria-label="Edit group name"
                            style={{ minHeight: 44, flex: 1, minWidth: 160 }}
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
                            className="pri"
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
                        <span>
                          Enable Mock Score Leaderboard tab for this group
                        </span>
                        <input
                          type="checkbox"
                          checked={Boolean(activeGroupDoc.mockBoard)}
                          onChange={(e) =>
                            handleOwnerToggleMockBoard(e.target.checked)
                          }
                          style={{ width: 20, height: 20 }}
                        />
                      </label>

                      {/* Member Removal List */}
                      {Object.keys(activeGroupDoc.members).length > 1 && (
                        <div style={{ marginTop: 10 }}>
                          <div
                            className="mut"
                            style={{ fontSize: 12, marginBottom: 6 }}
                          >
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
                                      className="dg-btn"
                                      disabled={actionBusy}
                                      onClick={() =>
                                        handleOwnerRemoveMember(uid, m.nick)
                                      }
                                      style={{ minHeight: 38, fontSize: 12 }}
                                    >
                                      Confirm Remove
                                    </button>
                                    <button
                                      type="button"
                                      className="s"
                                      onClick={() => setConfirmKickUid(null)}
                                      style={{ minHeight: 38, fontSize: 12 }}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    className="s"
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
                      <div
                        style={{
                          marginTop: 12,
                          paddingTop: 10,
                          borderTop: '1px solid var(--bd)',
                        }}
                      >
                        {confirmCloseGroupId === activeGroupId ? (
                          <div className="row sp" style={{ flexWrap: 'wrap', gap: 8 }}>
                            <span style={{ fontSize: 12, color: '#f43f5e' }}>
                              Permanently delete this group for all members?
                            </span>
                            <div className="row" style={{ gap: 6 }}>
                              <button
                                type="button"
                                className="dg-btn"
                                disabled={actionBusy}
                                onClick={() =>
                                  handleOwnerCloseGroup(activeGroupId)
                                }
                                style={{ minHeight: 40, fontSize: 12 }}
                              >
                                Yes, Close Group
                              </button>
                              <button
                                type="button"
                                className="s"
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
                            className="dg-btn"
                            onClick={() => setConfirmCloseGroupId(activeGroupId)}
                            style={{ minHeight: 40, fontSize: 12 }}
                          >
                            Close &amp; Delete Group
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};
