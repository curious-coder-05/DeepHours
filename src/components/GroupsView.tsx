import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Award,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Crown,
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  Share2,
  ShieldCheck,
  Target,
  Timer,
  Users,
} from 'lucide-react';
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
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { Chip } from './ui/Chip';
import { EmptyState } from './ui/EmptyState';
import { Field } from './ui/Field';
import { Meter } from './ui/Meter';
import { SectionHeader } from './ui/SectionHeader';
import { Segmented } from './ui/Segmented';
import { Sheet } from './ui/Sheet';
import { Stat } from './ui/Stat';
import { Switch } from './ui/Switch';

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
  const dow = dt.getUTCDay();
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
  previousRanks?: Record<string, number | null>;
}

export type WeeklyStudyLeaderboardProps = LeaderboardProps;

export interface RankTrendInfo {
  direction: 'up' | 'down' | 'same' | 'none';
  delta: number;
  previousRank: number | null;
}

export function computeRankDelta(
  previousRank: number | null | undefined,
  currentRank: number | null | undefined
): RankTrendInfo {
  if (
    typeof previousRank !== 'number' ||
    typeof currentRank !== 'number' ||
    !Number.isFinite(previousRank) ||
    !Number.isFinite(currentRank) ||
    previousRank <= 0 ||
    currentRank <= 0
  ) {
    return { direction: 'none', delta: 0, previousRank: null };
  }
  if (currentRank < previousRank) {
    return {
      direction: 'up',
      delta: previousRank - currentRank,
      previousRank,
    };
  }
  if (currentRank > previousRank) {
    return {
      direction: 'down',
      delta: currentRank - previousRank,
      previousRank,
    };
  }
  return { direction: 'same', delta: 0, previousRank };
}

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

export interface TimeOfDayBadgeInfo {
  type: 'earlyBird' | 'nightOwl';
  label: 'Early Bird' | 'Night Owl';
  emoji: '🌅' | '🦉';
  hour: number;
  tooltip: string;
}

export function getMemberTimeOfDayBadge(
  entry: MemberEntry | undefined,
  latestSessionTs?: number
): TimeOfDayBadgeInfo | null {
  if (!entry || entry.paused) return null;

  const candidateTs =
    typeof latestSessionTs === 'number' &&
    Number.isFinite(latestSessionTs) &&
    latestSessionTs > 0
      ? latestSessionTs
      : typeof entry.live?.since === 'number' &&
          Number.isFinite(entry.live.since) &&
          entry.live.since > 0
        ? entry.live.since
        : 0;

  if (!candidateTs || candidateTs <= 0) return null;

  const dt = new Date(candidateTs);
  const hour = dt.getHours();
  if (!Number.isFinite(hour)) return null;

  const timeFormatted = dt.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });

  if (hour < 8) {
    return {
      type: 'earlyBird',
      label: 'Early Bird',
      emoji: '🌅',
      hour,
      tooltip: `Early Bird — Latest study session at ${timeFormatted} (before 8 AM)`,
    };
  }

  if (hour >= 23) {
    return {
      type: 'nightOwl',
      label: 'Night Owl',
      emoji: '🦉',
      hour,
      tooltip: `Night Owl — Latest study session at ${timeFormatted} (after 11 PM)`,
    };
  }

  return null;
}

export interface MemberConsistencyDayPoint {
  dayKey: string;
  label: string;
  minutes: number;
}

export function buildMemberLast7DaysConsistencyData(
  entry: MemberEntry | undefined,
  todayKey: string
): {
  days: MemberConsistencyDayPoint[];
  activeDaysCount: number;
  totalMinutes: number;
  consistencyPct: number;
} {
  const days: MemberConsistencyDayPoint[] = [];
  let activeDaysCount = 0;
  let totalMinutes = 0;

  for (let i = 6; i >= 0; i--) {
    const dk = addD(todayKey, -i);
    const mins = Math.max(0, Math.round(Number(entry?.days?.[dk]) || 0));
    if (mins > 0) activeDaysCount += 1;
    totalMinutes += mins;
    days.push({
      dayKey: dk,
      label: dk.slice(5),
      minutes: mins,
    });
  }

  const consistencyPct =
    typeof entry?.consistency === 'number' && Number.isFinite(entry.consistency)
      ? Math.max(0, Math.min(100, Math.round(entry.consistency)))
      : Math.round((activeDaysCount / 7) * 100);

  return {
    days,
    activeDaysCount,
    totalMinutes,
    consistencyPct,
  };
}

export const Leaderboard: React.FC<LeaderboardProps> = ({
  members,
  todayKey,
  myUid,
  nowTs,
  onRefresh,
  isRefreshing = false,
  lastUpdatedAt = null,
  previousRanks,
}) => {
  const [refreshTickTs, setRefreshTickTs] = useState<number>(() =>
    typeof nowTs === 'number' ? nowTs : Date.now()
  );
  const [localRefreshing, setLocalRefreshing] = useState(false);
  const [hoveredLiveKey, setHoveredLiveKey] = useState<string | null>(null);
  const [expandedMemberUid, setExpandedMemberUid] = useState<string | null>(null);

  const rows = useMemo(
    () => rankWeekBoard(members, todayKey),
    [members, todayKey]
  );

  const currentRanksMap = useMemo(() => {
    const map: Record<string, number | null> = {};
    for (const r of rows) {
      map[r.uid] = r.rank;
    }
    return map;
  }, [rows]);

  const [prevRanksState, setPrevRanksState] = useState<Record<string, number | null>>(
    () => currentRanksMap
  );
  const lastCommittedRanksRef =
    useRef<Record<string, number | null>>(currentRanksMap);

  useEffect(() => {
    const prevCommitted = lastCommittedRanksRef.current;
    let hasRankChange = false;
    for (const uid of Object.keys(currentRanksMap)) {
      if (
        prevCommitted[uid] !== undefined &&
        prevCommitted[uid] !== currentRanksMap[uid]
      ) {
        hasRankChange = true;
        break;
      }
    }
    if (hasRankChange) {
      setPrevRanksState(prevCommitted);
    }
    lastCommittedRanksRef.current = currentRanksMap;
  }, [currentRanksMap]);

  const effectiveNowTs = typeof nowTs === 'number' ? nowTs : refreshTickTs;
  const busyRefreshing = isRefreshing || localRefreshing;

  const handleManualRefresh = async () => {
    if (busyRefreshing) return;
    setPrevRanksState(lastCommittedRanksRef.current);
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
      <div className="split mb-3 border-b border-[var(--line)] pb-2.5 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <strong className="text-[14px] font-semibold text-[var(--tx)]">
            Weekly study leaderboard
          </strong>
          <span className="tnum rounded-md bg-[var(--sf-2)] px-2 py-0.5 text-[12px] text-[var(--tx-2)]">
            {rows.length} {rows.length === 1 ? 'member' : 'members'}
          </span>
          {lastUpdatedAt ? (
            <span className="tnum text-[12px] text-[var(--tx-3)]">
              · Synced {Math.max(0, Math.floor((effectiveNowTs - lastUpdatedAt) / 60000))}m
              ago
            </span>
          ) : null}
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={<RefreshCw size={14} />}
          onClick={handleManualRefresh}
          disabled={busyRefreshing}
          aria-label="Refresh leaderboard stats"
        >
          {busyRefreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="py-6 text-center text-[13px] text-[var(--tx-2)]">
          No members in this weekly study leaderboard yet.
        </div>
      ) : (
        <div
          role="list"
          aria-label="Weekly study duration leaderboard"
          className="divide-y divide-[var(--line)]"
        >
          {rows.map((row) => {
            const isMe = Boolean(myUid && row.uid === myUid);
            const studyingNow = isMemberStudyingNow(row.entry, effectiveNowTs);
            const liveTooltip = studyingNow
              ? getStudyingNowTooltipText(row.entry, effectiveNowTs)
              : '';
            const activeToday = (row.entry.days?.[todayKey] || 0) > 0;
            const pctBar = row.hidden
              ? 0
              : Math.min(100, Math.round((row.primaryValue / maxWeeklyMinutes) * 100));
            const rankBadge =
              row.rank !== null ? `#${row.rank}` : '—';
            const dotHoverKey = `dot_${row.uid}`;
            const badgeHoverKey = `badge_${row.uid}`;

            const prevRankForMember =
              previousRanks && row.uid in previousRanks
                ? previousRanks[row.uid]
                : prevRanksState[row.uid];
            const rankTrend = computeRankDelta(prevRankForMember, row.rank);
            const timeBadge = getMemberTimeOfDayBadge(row.entry);
            const isExpanded = expandedMemberUid === row.uid;
            const consistencyData = isExpanded
              ? buildMemberLast7DaysConsistencyData(row.entry, todayKey)
              : null;

            return (
              <div
                key={row.uid}
                role="listitem"
                className={`py-3 px-2 transition-colors ${
                  isMe ? 'rounded-xl bg-[var(--ac-soft)]' : ''
                }`}
                style={{ opacity: row.hidden ? 0.65 : 1 }}
              >
                <div className="split gap-3">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="tnum w-8 text-center text-[13px] font-bold text-[var(--tx-2)]">
                      {rankBadge}
                    </span>

                    <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--sf-2)]">
                      <span className="text-[20px] leading-none" aria-hidden="true">
                        {row.entry.emoji}
                      </span>
                      <span
                        role="status"
                        tabIndex={studyingNow ? 0 : undefined}
                        onMouseEnter={() => {
                          if (studyingNow) setHoveredLiveKey(dotHoverKey);
                        }}
                        onMouseLeave={() => {
                          if (hoveredLiveKey === dotHoverKey) setHoveredLiveKey(null);
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
                        className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[var(--sf-1)]"
                        style={{
                          background: studyingNow
                            ? 'var(--ok)'
                            : row.entry.paused
                              ? 'var(--warn)'
                              : activeToday
                                ? 'var(--info)'
                                : 'var(--line)',
                        }}
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedMemberUid((cur) =>
                              cur === row.uid ? null : row.uid
                            )
                          }
                          aria-expanded={isExpanded}
                          title="Click to view 7-day study consistency chart"
                          className="inline-flex items-center gap-1 text-left text-[14px] font-semibold text-[var(--tx)] hover:text-[var(--ac)]"
                        >
                          <span className="truncate">
                            {row.entry.nick}
                            {isMe ? ' (You)' : ''}
                          </span>
                          <span className="text-[12px] text-[var(--ac)]" aria-hidden="true">
                            {isExpanded ? '▴' : '▾'}
                          </span>
                        </button>

                        {timeBadge && (
                          <span
                            title={timeBadge.tooltip}
                            aria-label={timeBadge.tooltip}
                            className="inline-flex items-center gap-1 rounded-md border border-[var(--line)] bg-[var(--sf-2)] px-2 py-0.5 text-[12px] font-medium text-[var(--tx-2)]"
                          >
                            <span aria-hidden="true">{timeBadge.emoji}</span>
                            <span>{timeBadge.label}</span>
                          </span>
                        )}

                        {studyingNow && (
                          <span
                            title={liveTooltip}
                            aria-label={liveTooltip}
                            onMouseEnter={() => setHoveredLiveKey(badgeHoverKey)}
                            onMouseLeave={() => {
                              if (hoveredLiveKey === badgeHoverKey) setHoveredLiveKey(null);
                            }}
                            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--sf-2)] px-2 py-0.5 text-[12px] font-medium text-[var(--ok)]"
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)]" />
                            Studying now
                          </span>
                        )}
                      </div>

                      {!row.hidden && (
                        <div className="mt-1.5 max-w-[180px]">
                          <Meter
                            value={pctBar}
                            max={100}
                            color={studyingNow ? 'var(--ok)' : 'var(--ac)'}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {(rankTrend.direction === 'up' ||
                        rankTrend.direction === 'down') && (
                        <span
                          aria-label={
                            rankTrend.direction === 'up'
                              ? `Moved up ${rankTrend.delta}`
                              : `Moved down ${rankTrend.delta}`
                          }
                          className="tnum rounded px-1.5 py-0.5 text-[12px] font-semibold"
                          style={{
                            color:
                              rankTrend.direction === 'up'
                                ? 'var(--ok)'
                                : 'var(--bad)',
                            background: 'var(--sf-2)',
                          }}
                        >
                          {rankTrend.direction === 'up' ? '▲' : '▼'}
                          {rankTrend.delta > 1 ? rankTrend.delta : ''}
                        </span>
                      )}
                      <strong className="tnum text-[14px] text-[var(--tx)]">
                        {row.displayLabel}
                      </strong>
                    </div>
                    {row.subLabel && (
                      <div className="tnum text-[12px] text-[var(--tx-2)]">
                        {row.subLabel}
                      </div>
                    )}
                  </div>
                </div>

                {isExpanded && consistencyData && (
                  <div
                    aria-label={`7-day study consistency chart for ${row.entry.nick}`}
                    className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--sf-2)] p-3"
                  >
                    <div className="split mb-2 flex-wrap gap-2 text-[12px]">
                      <strong className="text-[var(--tx)]">
                        7-day study consistency ({row.entry.nick})
                      </strong>
                      <span className="tnum text-[var(--tx-2)]">
                        {consistencyData.activeDaysCount}/7 days active ·{' '}
                        {consistencyData.consistencyPct}% consistency ·{' '}
                        {formatMinutesAsHoursMins(consistencyData.totalMinutes)} total
                      </span>
                    </div>
                    <div className="h-[104px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={consistencyData.days}
                          margin={{ top: 6, right: 6, bottom: 2, left: 6 }}
                        >
                          <XAxis
                            dataKey="label"
                            tick={{ fontSize: 12, fill: '#A3ABB8' }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis hide domain={[0, 'dataMax + 30']} />
                          <Tooltip
                            contentStyle={{
                              background: '#181C22',
                              border: '1px solid rgba(255,255,255,0.08)',
                              borderRadius: 8,
                              fontSize: 12,
                              color: '#ECEFF4',
                            }}
                            formatter={(value) => [
                              formatMinutesAsHoursMins(Number(value ?? 0)),
                              'Study time',
                            ]}
                            labelFormatter={(label) => `Date: ${label}`}
                          />
                          <Bar
                            dataKey="minutes"
                            fill={studyingNow ? '#4ADE80' : '#F5C451'}
                            radius={[4, 4, 0, 0]}
                            barSize={18}
                            isAnimationActive={false}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
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
  const [prevGroupDocs, setPrevGroupDocs] = useState<
    Record<string, CachedGroupSnapshot['doc']>
  >({});
  const snapshotsRef = useRef<Record<string, CachedGroupSnapshot>>(snapshots);
  useEffect(() => {
    snapshotsRef.current = snapshots;
  }, [snapshots]);

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

  // Pull-to-refresh touch state
  const pullStartYRef = useRef<number | null>(null);
  const [pullOffsetY, setPullOffsetY] = useState<number>(0);

  // Create / Join Sheet state
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

  useEffect(() => {
    const iv = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(iv);
  }, []);

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
        960,
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

    let latestMySessionTs = state.activeTimer?.startTs || 0;
    for (const ses of state.sessions || []) {
      if (!ses) continue;
      const ts = Number(ses.startTs) || Number(ses.endTs) || 0;
      if (ts > latestMySessionTs) {
        latestMySessionTs = ts;
      }
    }

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
      latestMySessionTs,
    };
  }, [state, todayKey]);

  const activeSnapshot = activeGroupId ? snapshots[activeGroupId] : undefined;
  const activeGroupDoc = activeSnapshot?.doc;

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
          const priorDoc = snapshotsRef.current[groupId]?.doc;
          if (priorDoc) {
            setPrevGroupDocs((prev) => ({ ...prev, [groupId]: priorDoc }));
          }
          setSnapshots((prev) => ({ ...prev, [groupId]: snap }));
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

  // Pull-to-refresh touch handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    if (window.scrollY > 10 || !activeGroupId || !myUid) {
      pullStartYRef.current = null;
      return;
    }
    pullStartYRef.current = e.touches[0].clientY;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (pullStartYRef.current === null) return;
    const dy = e.touches[0].clientY - pullStartYRef.current;
    if (dy > 0 && window.scrollY <= 5) {
      setPullOffsetY(Math.min(80, Math.round(dy * 0.45)));
    } else {
      setPullOffsetY(0);
    }
  };

  const handleTouchEnd = () => {
    if (pullOffsetY >= 48 && activeGroupId && myUid && isOnline) {
      if (state.set.snd && typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(12);
      }
      void refreshGroup(activeGroupId, true);
    }
    pullStartYRef.current = null;
    setPullOffsetY(0);
  };

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
        showToast(`Set ${targetNick} as your friendly Pace Target`);
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
    if (sentCheersLocal[`${activeGroupId}_${toUid}_${todayKey}`]) {
      showToast(`You already cheered ${toNick} today.`);
      return;
    }
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

  const previousBoardRanksMap = useMemo(() => {
    const map: Record<string, number | null> = {};
    const prevDoc = activeGroupId ? prevGroupDocs[activeGroupId] : undefined;
    if (!prevDoc) return map;
    const members = prevDoc.members || {};
    let prevRows: RankedMemberRow[] = [];
    switch (boardTab) {
      case 'today':
        prevRows = rankTodayBoard(members, todayKey);
        break;
      case 'week':
        prevRows = rankWeekBoard(members, todayKey);
        break;
      case 'xp':
        prevRows = rankXpBoard(members, todayKey, xpSortMode);
        break;
      case 'streak':
        prevRows = rankStreakBoard(members, todayKey);
        break;
      case 'mocks':
        prevRows = rankMocksBoard(members, todayKey, mockSortMode);
        break;
      default:
        prevRows = [];
    }
    for (const r of prevRows) {
      map[r.uid] = r.rank;
    }
    return map;
  }, [activeGroupId, prevGroupDocs, boardTab, todayKey, xpSortMode, mockSortMode]);

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

  const boardOptions = useMemo(() => {
    const opts: Array<{ value: BoardTab; label: string }> = [
      { value: 'today', label: 'Today' },
      { value: 'week', label: 'Week' },
      { value: 'xp', label: 'XP' },
      { value: 'streak', label: 'Streak' },
    ];
    if (activeGroupDoc?.mockBoard) {
      opts.push({ value: 'mocks', label: 'Mocks' });
    }
    opts.push({ value: 'history', label: 'History' });
    return opts;
  }, [activeGroupDoc?.mockBoard]);

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="space-y-4"
    >
      {/* Pull-to-refresh visual indicator */}
      {pullOffsetY > 0 && (
        <div
          className="flex items-center justify-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--sf-1)] py-2 text-[12.5px] font-medium text-[var(--ac)] transition-all"
          style={{ height: `${Math.max(36, pullOffsetY)}px` }}
        >
          <RefreshCw
            size={15}
            className={pullOffsetY >= 48 ? 'animate-spin' : ''}
          />
          <span>
            {pullOffsetY >= 48
              ? 'Release to refresh leaderboard'
              : 'Pull down to refresh'}
          </span>
        </div>
      )}

      {/* Personal Live XP v2 & Timer Standing Card */}
      <Card className="space-y-3">
        <div className="split flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onOpenProfileModal()}
              aria-label="Edit anonymous group profile"
              title="Tap to edit your anonymous nickname & avatar"
              className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--ac-line)] bg-[var(--ac-soft)] text-[24px]"
            >
              {state.profile?.emoji || '🩺'}
            </button>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-[15px] font-semibold text-[var(--tx)]">
                  {state.profile?.nick || 'Anonymous Aspirant'}
                </strong>
                {state.profile?.examYear ? (
                  <span className="tnum text-[12px] text-[var(--tx-2)]">
                    · NEET {state.profile.examYear}
                  </span>
                ) : null}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onOpenProfileModal()}
                >
                  Edit profile
                </Button>
              </div>
              <p className="tnum mt-0.5 text-[12.5px] text-[var(--tx-2)]">
                Level <strong>{myPersonalStats.levelInfo.level}</strong> ·{' '}
                <strong>{myPersonalStats.totalXp.toLocaleString()} XP</strong>
                {myRankOnCurrentBoard ? (
                  <span>
                    {' '}
                    · Group rank <strong>#{myRankOnCurrentBoard}</strong>
                  </span>
                ) : null}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowMyXpDrawer((v) => !v)}
              aria-expanded={showMyXpDrawer}
            >
              Today: +{myPersonalStats.todayXp} XP {showMyXpDrawer ? '▴' : '▾'}
            </Button>
            {myUid && activeGroupId && activeGroupPref && (
              <Button
                variant="primary"
                size="sm"
                disabled={isPublishingMine || !isOnline}
                onClick={handlePushMyStatsNow}
              >
                {isPublishingMine ? 'Syncing…' : 'Sync my stats'}
              </Button>
            )}
            {onGoToFocus && (
              <Button
                variant="secondary"
                size="sm"
                icon={<Timer size={15} />}
                onClick={onGoToFocus}
              >
                Focus timer
              </Button>
            )}
          </div>
        </div>

        {/* Level Progress Meter */}
        <div>
          <div className="split mb-1 text-[12px] text-[var(--tx-2)]">
            <span>
              Lv. {myPersonalStats.levelInfo.level} → Lv.{' '}
              {myPersonalStats.levelInfo.level + 1} (
              {myPersonalStats.levelInfo.progressPct}%)
            </span>
            <span className="tnum">
              {myPersonalStats.levelInfo.xpIntoLevel} /{' '}
              {myPersonalStats.levelInfo.xpNeededForNext} XP
            </span>
          </div>
          <Meter value={myPersonalStats.levelInfo.progressPct} max={100} />
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          <Stat
            label="Today timer"
            value={formatMinutesAsHoursMins(myPersonalStats.todayTimerMins)}
          />
          <Stat
            label="Week timer"
            value={formatMinutesAsHoursMins(myPersonalStats.weekTimerMins)}
          />
          <Stat
            label="Week XP v2"
            value={`+${myPersonalStats.weekXp} XP`}
          />
        </div>

        {showMyXpDrawer && (
          <div className="space-y-3 border-t border-[var(--line)] pt-3 text-[12.5px]">
            <div className="split">
              <strong className="text-[var(--tx)]">
                Today&apos;s XP v2 breakdown ({todayKey})
              </strong>
              <span className="tnum font-semibold text-[var(--ok)]">
                Total: +{myPersonalStats.todayBreakdown.total} XP
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                {
                  label: 'Timer study',
                  val: myPersonalStats.todayBreakdown.study,
                  cap: 'max 960/d',
                },
                {
                  label: 'Focus purity ≥90%',
                  val: myPersonalStats.todayBreakdown.focusBonus,
                  cap: 'max 20/d',
                },
                {
                  label: 'Min-day goal met',
                  val: myPersonalStats.todayBreakdown.minDayBonus,
                  cap: '+30/d',
                },
                {
                  label: 'Streak bonus',
                  val: myPersonalStats.todayBreakdown.streakBonus,
                  cap: 'max 20/d',
                },
                {
                  label: 'Revisions done',
                  val: myPersonalStats.todayBreakdown.revisions,
                  cap: '+10 on-time',
                },
                {
                  label: 'Chapters completed',
                  val: myPersonalStats.todayBreakdown.chapters,
                  cap: '+25 each',
                },
                {
                  label: 'Mock logged',
                  val: myPersonalStats.todayBreakdown.mocks,
                  cap: 'max 25/d',
                },
                {
                  label: 'Tasks & habits',
                  val:
                    myPersonalStats.todayBreakdown.tasks +
                    myPersonalStats.todayBreakdown.habits,
                  cap: 'max 65/d',
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="split rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3 py-2"
                >
                  <div>
                    <div className="font-medium text-[var(--tx)]">{item.label}</div>
                    <span className="text-[12px] text-[var(--tx-3)]">{item.cap}</span>
                  </div>
                  <strong
                    className="tnum"
                    style={{
                      color: item.val > 0 ? 'var(--ok)' : 'var(--tx-2)',
                    }}
                  >
                    +{item.val}
                  </strong>
                </div>
              ))}
            </div>
            <details className="text-[12px] text-[var(--tx-2)]">
              <summary className="cursor-pointer font-medium text-[var(--tx)]">
                How XP v2 &amp; fair group scoring work
              </summary>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {XP_V2_PLAIN_RULES.map((r) => (
                  <li key={r.label}>
                    <strong>{r.label}:</strong> {r.rule}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        )}
      </Card>

      {/* 1. Signed-Out Landing Card */}
      {!myUid ? (
        <Card className="space-y-4 p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--ac-line)] bg-[var(--ac-soft)] text-[var(--ac)]">
              <Users size={22} />
            </div>
            <div>
              <h3 className="text-[17px] font-semibold text-[var(--tx)]">
                Sign in to join private study groups
              </h3>
              <p className="mt-1 text-[13.5px] text-[var(--tx-2)]">
                Study alongside up to 3 private NEET squads using 10-character invite
                codes. Compare timer-verified hours, XP v2, consistency streaks, and 7-day
                pace while keeping your Google account private.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <div className="rounded-xl border border-[var(--line)] bg-[var(--sf-2)] p-3">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--tx)]">
                <ShieldCheck size={16} className="text-[var(--ok)]" />
                Anonymous identity
              </div>
              <p className="mt-1 text-[12px] text-[var(--tx-2)]">
                Your email and Google profile are never exposed. You choose a nickname and
                avatar.
              </p>
            </div>
            <div className="rounded-xl border border-[var(--line)] bg-[var(--sf-2)] p-3">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--tx)]">
                <Timer size={16} className="text-[var(--ac)]" />
                Timer-verified hours
              </div>
              <p className="mt-1 text-[12px] text-[var(--tx-2)]">
                Only real focus timer sessions count toward squad leaderboards.
              </p>
            </div>
            <div className="rounded-xl border border-[var(--line)] bg-[var(--sf-2)] p-3">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--tx)]">
                <Lock size={16} className="text-[var(--info)]" />
                Granular sharing
              </div>
              <p className="mt-1 text-[12px] text-[var(--tx-2)]">
                Toggle hours, XP, streak, mocks, or live status per group anytime.
              </p>
            </div>
          </div>

          <div className="flex justify-start">
            <Button variant="primary" onClick={onSignIn}>
              Sign in with Google
            </Button>
          </div>
        </Card>
      ) : !groupsConfig.consentAccepted ? (
        /* 2. First-time Privacy Consent Screen */
        <Card className="space-y-4 p-5">
          <div>
            <h3 className="text-[16px] font-semibold text-[var(--tx)]">
              Privacy-first study groups
            </h3>
            <p className="text-[12.5px] text-[var(--tx-2)]">
              How group sharing works in Deep Hours
            </p>
          </div>
          <ul className="list-disc space-y-2 pl-5 text-[13.5px] text-[var(--tx)]">
            <li>
              <strong>Anonymous by design:</strong> Your Google email, real name, and
              account ID are never visible to other members. You pick an anonymous nickname
              and emoji.
            </li>
            <li>
              <strong>Timer-verified fairness:</strong> Only timer-tracked sessions count
              toward group study time and XP. Manual sessions stay in your personal log
              only.
            </li>
            <li>
              <strong>Granular controls:</strong> You can toggle Study Time, XP, Streak,
              Mock Scores (off by default), and Studying-Now status per group, or pause
              sharing anytime.
            </li>
          </ul>
          <Button variant="primary" fullWidth onClick={handleAcceptConsent}>
            I understand — Continue to groups
          </Button>
        </Card>
      ) : (
        <>
          {/* Group Switcher & Create/Join Bar */}
          <Card className="space-y-3">
            <div className="split flex-wrap gap-2">
              <div>
                <h3 className="text-[15px] font-semibold text-[var(--tx)]">
                  My study squads ({joinedGroups.length}/{MAX_JOINED_GROUPS})
                </h3>
                <p className="text-[12px] text-[var(--tx-2)]">
                  Switch groups or create/join with a 10-character code
                </p>
              </div>

              <div className="flex items-center gap-2">
                {joinedGroups.length < MAX_JOINED_GROUPS ? (
                  <>
                    <Button
                      variant="primary"
                      size="sm"
                      icon={<Plus size={15} />}
                      onClick={() => {
                        if (!ensureValidProfileBeforeGroupAction('create a group'))
                          return;
                        setActionError(null);
                        setDialogMode('create');
                      }}
                    >
                      Create group
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<KeyRound size={15} />}
                      onClick={() => {
                        if (!ensureValidProfileBeforeGroupAction('join a group'))
                          return;
                        setActionError(null);
                        setDialogMode('join');
                      }}
                    >
                      Join code
                    </Button>
                  </>
                ) : (
                  <span className="tnum text-[12px] text-[var(--tx-2)]">
                    Max {MAX_JOINED_GROUPS} groups joined
                  </span>
                )}
              </div>
            </div>

            {joinedGroups.length > 0 && (
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
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
                    <Chip
                      key={g.groupId}
                      selected={isSelected}
                      onClick={() => {
                        setExpandedMemberUid(null);
                        onUpdateGroupsConfig((prev) => ({
                          ...prev,
                          activeGroupId: g.groupId,
                        }));
                      }}
                    >
                      {em} {label}
                      {mCount !== undefined ? ` (${mCount})` : ''}
                    </Chip>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Create Group Sheet */}
          <Sheet
            open={dialogMode === 'create'}
            onClose={() => setDialogMode('none')}
            title="Create a new study group"
          >
            <form onSubmit={handleCreateGroup} className="space-y-4">
              <Field label="Group name">
                <input
                  type="text"
                  placeholder="e.g. AIIMS Delhi 2026 Squad"
                  maxLength={32}
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  aria-label="New study group name"
                  className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3 text-[14px] text-[var(--tx)]"
                  required
                />
              </Field>
              <Field label="Squad icon">
                <div className="flex flex-wrap gap-2">
                  {GROUP_EMOJIS.map((em) => (
                    <Chip
                      key={em}
                      selected={newGroupEmoji === em}
                      onClick={() => setNewGroupEmoji(em)}
                    >
                      {em}
                    </Chip>
                  ))}
                </div>
              </Field>
              {actionError && (
                <p className="text-[12.5px] text-[var(--bad)]">{actionError}</p>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setDialogMode('none')}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={actionBusy}>
                  {actionBusy ? 'Creating…' : 'Create group'}
                </Button>
              </div>
            </form>
          </Sheet>

          {/* Join Group Sheet */}
          <Sheet
            open={dialogMode === 'join'}
            onClose={() => setDialogMode('none')}
            title="Join with 10-character invite code"
          >
            <form onSubmit={handleJoinGroup} className="space-y-4">
              <Field label="Invite code">
                <input
                  type="text"
                  placeholder="ABCDE-23456"
                  maxLength={15}
                  value={joinCodeInput}
                  onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                  aria-label="Group invite code"
                  className="mono h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3 text-[15px] tracking-wider text-[var(--tx)]"
                  required
                />
              </Field>
              {actionError && (
                <p className="text-[12.5px] text-[var(--bad)]">{actionError}</p>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setDialogMode('none')}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={actionBusy}>
                  {actionBusy ? 'Joining…' : 'Join squad'}
                </Button>
              </div>
            </form>
          </Sheet>

          {/* Empty state when user hasn't joined any group yet */}
          {joinedGroups.length === 0 && (
            <EmptyState
              icon={<Users size={22} />}
              title="No study groups joined yet"
              description="Create a private study group for your batchmates or enter a 10-character invite code to compare daily timer hours, weekly XP v2, and 7-day consistency."
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Plus size={15} />}
                    onClick={() => {
                      if (!ensureValidProfileBeforeGroupAction('create a group'))
                        return;
                      setDialogMode('create');
                    }}
                  >
                    Create study group
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<KeyRound size={15} />}
                    onClick={() => {
                      if (!ensureValidProfileBeforeGroupAction('join a group'))
                        return;
                      setDialogMode('join');
                    }}
                  >
                    Enter invite code
                  </Button>
                </div>
              }
            />
          )}

          {/* Uncached / Loading state */}
          {activeGroupId && !activeGroupDoc && (
            <Card className="p-6 text-center space-y-3">
              <strong className="block text-[15px] text-[var(--tx)]">
                {isRefreshing
                  ? 'Loading group leaderboard…'
                  : 'Group snapshot unavailable offline'}
              </strong>
              <p className="mx-auto max-w-sm text-[13px] text-[var(--tx-2)]">
                {isRefreshing
                  ? 'Fetching latest study hours and XP standings from Cloud Firestore…'
                  : 'Connect to the internet and tap Refresh to load this study group.'}
              </p>
              <Button
                variant="primary"
                size="sm"
                icon={<RefreshCw size={15} />}
                disabled={isRefreshing || !isOnline}
                onClick={() => refreshGroup(activeGroupId, true)}
              >
                {isRefreshing ? 'Refreshing…' : 'Refresh group'}
              </Button>
            </Card>
          )}

          {/* Active Group Dashboard */}
          {activeGroupId && activeGroupDoc && (
            <>
              {/* Group Header & Live Activity */}
              <Card className="space-y-3">
                <div className="split flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <span className="text-[28px]" aria-hidden="true">
                      {activeGroupDoc.emoji}
                    </span>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-[16px] font-semibold text-[var(--tx)]">
                          {activeGroupDoc.name}
                        </strong>
                        <span className="tnum text-[12px] text-[var(--tx-2)]">
                          · {memberCount}/{activeGroupDoc.memberCap || 50} members
                        </span>
                      </div>
                      <p className="tnum text-[12px] text-[var(--tx-2)]">
                        Invite code:{' '}
                        <strong className="mono text-[var(--tx)]">
                          {formatGroupCode(activeGroupId)}
                        </strong>{' '}
                        · Updated{' '}
                        {formatRelativeAgo(activeSnapshot?.fetchedAt || 0, nowTick)}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Copy size={14} />}
                      onClick={() => handleCopyInvite(activeGroupId)}
                    >
                      Copy code
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Share2 size={14} />}
                      onClick={() =>
                        handleShareInvite(activeGroupId, activeGroupDoc.name)
                      }
                    >
                      Invite
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<RefreshCw size={14} />}
                      disabled={
                        isRefreshing || refreshCooldownLeftSec > 0 || !isOnline
                      }
                      onClick={() => refreshGroup(activeGroupId, true)}
                    >
                      {isRefreshing
                        ? '…'
                        : refreshCooldownLeftSec > 0
                          ? `${refreshCooldownLeftSec}s`
                          : 'Refresh'}
                    </Button>
                  </div>
                </div>

                {/* Studying Now Strip */}
                {studyingNowList.length > 0 && (
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3.5 py-2.5 text-[13px]">
                    <strong className="text-[var(--ok)]">
                      Studying right now ({studyingNowList.length}):
                    </strong>{' '}
                    {studyingNowList.map((m, idx) => (
                      <span key={m.uid}>
                        {idx > 0 ? ' · ' : ''}
                        {m.emoji} <strong>{m.nick}</strong> ({m.elapsedMins}m)
                      </span>
                    ))}
                  </div>
                )}

                {/* Received Cheers */}
                {todayCheersReceived.length > 0 && (
                  <div className="rounded-xl border border-[var(--ac-line)] bg-[var(--ac-soft)] px-3.5 py-2.5 text-[13px] text-[var(--tx)]">
                    <strong>
                      You received {todayCheersReceived.length} cheer
                      {todayCheersReceived.length === 1 ? '' : 's'} today:
                    </strong>{' '}
                    {todayCheersReceived.map((c, idx) => (
                      <span key={c.id}>
                        {idx > 0 ? ', ' : ''}
                        {c.e} {c.fromNick}
                      </span>
                    ))}
                  </div>
                )}

                {/* Friendly Rival Pace Comparison */}
                {paceComparison && (
                  <div className="split flex-wrap gap-2 rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3.5 py-2.5 text-[12.5px]">
                    <div>
                      <strong className="text-[var(--tx)]">
                        Pace target: {paceComparison.entry.emoji}{' '}
                        {paceComparison.entry.nick}
                      </strong>
                      <div className="tnum mt-0.5 text-[var(--tx-2)]">
                        Today:{' '}
                        <strong
                          style={{
                            color:
                              paceComparison.diffTodayMins >= 0
                                ? 'var(--ok)'
                                : 'var(--warn)',
                          }}
                        >
                          {paceComparison.diffTodayMins >= 0
                            ? `You lead by +${formatMinutesAsHoursMins(paceComparison.diffTodayMins)}`
                            : `${formatMinutesAsHoursMins(Math.abs(paceComparison.diffTodayMins))} to catch up`}
                        </strong>{' '}
                        · Week:{' '}
                        <strong
                          style={{
                            color:
                              paceComparison.diffWeekMins >= 0
                                ? 'var(--ok)'
                                : 'var(--warn)',
                          }}
                        >
                          {paceComparison.diffWeekMins >= 0
                            ? `+${formatMinutesAsHoursMins(paceComparison.diffWeekMins)} ahead`
                            : `${formatMinutesAsHoursMins(Math.abs(paceComparison.diffWeekMins))} behind`}
                        </strong>
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        handleTogglePaceTarget(
                          paceComparison.uid,
                          paceComparison.entry.nick
                        )
                      }
                    >
                      Clear target
                    </Button>
                  </div>
                )}

                {/* Weekly Group Goal */}
                {weeklyGoalProg && weeklyGoalProg.hasGoal && (
                  <div className="space-y-2 pt-1">
                    <div className="split text-[12.5px]">
                      <span className="text-[var(--tx-2)]">
                        Weekly squad goal:{' '}
                        <strong className="tnum text-[var(--tx)]">
                          {formatMinutesAsHoursMins(weeklyGoalProg.combinedMinutes)}
                        </strong>{' '}
                        / {formatMinutesAsHoursMins(weeklyGoalProg.targetMinutes)}
                      </span>
                      <div className="flex items-center gap-2">
                        <strong className="tnum text-[var(--ac)]">
                          {weeklyGoalProg.pct}%
                        </strong>
                        {weeklyMemberContributions.length > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowGoalBreakdown((v) => !v)}
                          >
                            {showGoalBreakdown ? 'Hide split' : 'Contributions'}
                          </Button>
                        )}
                      </div>
                    </div>
                    <Meter
                      value={weeklyGoalProg.pct}
                      max={100}
                      color={weeklyGoalProg.reached ? 'var(--ok)' : 'var(--ac)'}
                    />
                    {showGoalBreakdown && weeklyMemberContributions.length > 0 && (
                      <div className="rounded-xl border border-[var(--line)] bg-[var(--sf-2)] p-3 text-[12.5px] space-y-1.5">
                        {weeklyMemberContributions.map((c) => (
                          <div key={c.uid} className="split">
                            <span>
                              {c.emoji} <strong>{c.nick}</strong>
                              {c.uid === myUid ? ' (You)' : ''}
                            </span>
                            <span className="tnum">
                              <strong>{formatMinutesAsHoursMins(c.minutes)}</strong> (
                              {c.sharePct}%)
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </Card>

              {/* Sticky Segmented Board Tabs */}
              <div className="sticky top-[56px] z-10 rounded-xl bg-[var(--bg)] py-1">
                <Segmented<BoardTab>
                  value={boardTab}
                  onChange={setBoardTab}
                  ariaLabel="Group leaderboard tabs"
                  options={boardOptions}
                />
              </div>

              {/* Sub-controls for XP or Mocks + Member Filter & Search */}
              {boardTab !== 'history' && (
                <Card>
                  <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {boardTab === 'xp' && (
                        <>
                          <Chip
                            selected={xpSortMode === 'weekly'}
                            onClick={() => setXpSortMode('weekly')}
                          >
                            This week XP
                          </Chip>
                          <Chip
                            selected={xpSortMode === 'allTime'}
                            onClick={() => setXpSortMode('allTime')}
                          >
                            All-time XP &amp; level
                          </Chip>
                        </>
                      )}
                      {boardTab === 'mocks' && activeGroupDoc.mockBoard && (
                        <>
                          <Chip
                            selected={mockSortMode === 'latest'}
                            onClick={() => setMockSortMode('latest')}
                          >
                            Latest score
                          </Chip>
                          <Chip
                            selected={mockSortMode === 'best'}
                            onClick={() => setMockSortMode('best')}
                          >
                            Best score
                          </Chip>
                          <Chip
                            selected={mockSortMode === 'avg5'}
                            onClick={() => setMockSortMode('avg5')}
                          >
                            Avg of last 5
                          </Chip>
                        </>
                      )}
                      {(
                        [
                          { id: 'all' as const, label: 'All' },
                          { id: 'activeToday' as const, label: 'Active today' },
                          { id: 'top3' as const, label: 'Top 3' },
                          ...(studyingNowList.length > 0
                            ? [{ id: 'studyingNow' as const, label: 'Studying now' }]
                            : []),
                        ] as const
                      ).map((f) => (
                        <Chip
                          key={f.id}
                          selected={memberFilter === f.id}
                          onClick={() => setMemberFilter(f.id)}
                        >
                          {f.label}
                        </Chip>
                      ))}
                    </div>

                    {rankedRows.length >= 4 && (
                      <input
                        type="search"
                        value={memberSearch}
                        onChange={(e) => setMemberSearch(e.target.value)}
                        placeholder="Filter member…"
                        aria-label="Filter group members by nickname"
                        className="h-9 rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3 text-[12.5px] sm:w-44"
                      />
                    )}
                  </div>
                </Card>
              )}

              {/* Animated Top-3 Podium Card */}
              {boardTab !== 'history' &&
                memberFilter === 'all' &&
                !memberSearch.trim() &&
                podiumRows.length > 0 && (
                  <Card className="space-y-3">
                    <div className="split text-[12.5px]">
                      <strong className="text-[var(--tx)]">
                        Top podium ·{' '}
                        {boardTab === 'today'
                          ? "Today's study time"
                          : boardTab === 'week'
                            ? 'This week study time'
                            : boardTab === 'xp'
                              ? xpSortMode === 'weekly'
                                ? 'Weekly XP v2'
                                : 'All-time XP & level'
                              : boardTab === 'streak'
                                ? 'Consistency & streak'
                                : 'Mock test standings'}
                      </strong>
                      <span className="text-[var(--tx-2)]">
                        Tap any member to compare 7-day pace
                      </span>
                    </div>

                    <div className="grid grid-cols-3 items-end gap-2.5">
                      {[2, 1, 3].map((targetRank) => {
                        const pRow = podiumRows.find((r) => r.rank === targetRank);
                        if (!pRow) {
                          return (
                            <div
                              key={targetRank}
                              className="grid min-h-[100px] place-items-center rounded-xl border border-dashed border-[var(--line)] p-3 text-center text-[12px] text-[var(--tx-3)]"
                            >
                              #{targetRank} open
                            </div>
                          );
                        }
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
                            className={`podium-rise flex flex-col items-center justify-center gap-1 rounded-xl border p-3 text-center transition-colors ${
                              targetRank === 1
                                ? 'min-h-[126px] border-[var(--ac)] bg-[var(--ac-soft)]'
                                : isMe
                                  ? 'min-h-[106px] border-[var(--ac-line)] bg-[var(--sf-2)]'
                                  : 'min-h-[106px] border-[var(--line)] bg-[var(--sf-2)]'
                            }`}
                          >
                            <span className="tnum text-[12px] font-bold text-[var(--ac)]">
                              #{targetRank}
                            </span>
                            <span className="text-[22px]">{pRow.entry.emoji}</span>
                            <strong className="max-w-full truncate text-[13px] text-[var(--tx)]">
                              {pRow.entry.nick}
                              {isMe ? ' (You)' : ''}
                            </strong>
                            <span className="tnum text-[12.5px] font-semibold text-[var(--ac)]">
                              {pRow.displayLabel}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </Card>
                )}

              {/* Leaderboard Member List + Expandable 7-Day Consistency Chart */}
              {boardTab !== 'history' && (
                <Card>
                  {filteredRows.length === 0 ? (
                    <div className="py-6 text-center text-[13px] text-[var(--tx-2)]">
                      No members match the current filter on this leaderboard.
                    </div>
                  ) : (
                    <div className="divide-y divide-[var(--line)]">
                      {filteredRows.map((row) => {
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
                        const rankBadge =
                          row.rank !== null ? `#${row.rank}` : '—';
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
                        const memberTimeBadge = getMemberTimeOfDayBadge(
                          row.entry,
                          isMe ? myPersonalStats.latestMySessionTs : undefined
                        );
                        const rowRankTrend = computeRankDelta(
                          previousBoardRanksMap[row.uid],
                          row.rank
                        );

                        return (
                          <div
                            key={row.uid}
                            className={`py-3 px-2 ${
                              isMe ? 'rounded-xl bg-[var(--ac-soft)]' : ''
                            }`}
                            style={{ opacity: row.hidden ? 0.65 : 1 }}
                          >
                            <div
                              className="split cursor-pointer flex-wrap gap-2"
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
                            >
                              <div className="flex min-w-0 flex-1 items-center gap-3">
                                <span className="tnum w-8 text-center text-[13px] font-bold text-[var(--tx-2)]">
                                  {rankBadge}
                                </span>

                                <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--sf-2)]">
                                  <span className="text-[20px] leading-none">
                                    {row.entry.emoji}
                                  </span>
                                  <span
                                    title={
                                      isLiveNow
                                        ? liveTooltipText
                                        : row.entry.paused
                                          ? 'Sharing paused'
                                          : memberTodayMins > 0
                                            ? `Studied ${formatMinutesAsHoursMins(memberTodayMins)} today`
                                            : 'No study logged yet today'
                                    }
                                    className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[var(--sf-1)]"
                                    style={{
                                      background: isLiveNow
                                        ? 'var(--ok)'
                                        : row.entry.paused
                                          ? 'var(--warn)'
                                          : memberTodayMins > 0
                                            ? 'var(--info)'
                                            : 'var(--line)',
                                    }}
                                  />
                                </div>

                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <strong className="text-[14px] font-semibold text-[var(--tx)]">
                                      {row.entry.nick}
                                      {isMe ? ' (You)' : ''}
                                    </strong>
                                    {memberTimeBadge && (
                                      <span
                                        title={memberTimeBadge.tooltip}
                                        aria-label={memberTimeBadge.tooltip}
                                        className="inline-flex items-center gap-1 rounded-md border border-[var(--line)] bg-[var(--sf-2)] px-2 py-0.5 text-[12px] font-medium text-[var(--tx-2)]"
                                      >
                                        <span aria-hidden="true">
                                          {memberTimeBadge.emoji}
                                        </span>
                                        <span>{memberTimeBadge.label}</span>
                                      </span>
                                    )}
                                    {isLiveNow && (
                                      <span
                                        title={liveTooltipText}
                                        className="inline-flex items-center gap-1.5 rounded-md bg-[var(--sf-2)] px-2 py-0.5 text-[12px] font-medium text-[var(--ok)]"
                                      >
                                        <span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)]" />
                                        Studying now
                                      </span>
                                    )}
                                    {isPaceTarget && (
                                      <span className="rounded-md bg-[var(--sf-2)] px-2 py-0.5 text-[12px] font-medium text-[var(--ac)]">
                                        Target
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[12px] text-[var(--tx-2)]">
                                    Updated{' '}
                                    {formatRelativeAgo(row.entry.updatedAt, nowTick)}
                                    {row.subLabel ? ` · ${row.subLabel}` : ''} ·{' '}
                                    <span className="text-[var(--ac)]">
                                      {isExpanded ? 'Hide ▴' : 'Compare ▾'}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              <div
                                className="flex items-center gap-2"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="text-right">
                                  <div className="flex items-center justify-end gap-1.5">
                                    {(rowRankTrend.direction === 'up' ||
                                      rowRankTrend.direction === 'down') && (
                                      <span
                                        className="tnum rounded bg-[var(--sf-2)] px-1.5 py-0.5 text-[12px] font-semibold"
                                        style={{
                                          color:
                                            rowRankTrend.direction === 'up'
                                              ? 'var(--ok)'
                                              : 'var(--bad)',
                                        }}
                                      >
                                        {rowRankTrend.direction === 'up' ? '▲' : '▼'}
                                        {rowRankTrend.delta > 1
                                          ? rowRankTrend.delta
                                          : ''}
                                      </span>
                                    )}
                                    <strong className="tnum text-[14.5px] text-[var(--tx)]">
                                      {row.displayLabel}
                                    </strong>
                                  </div>
                                </div>

                                {!isMe && (
                                  <div className="flex items-center gap-1">
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
                                        className={`flex h-9 w-9 items-center justify-center rounded-lg border text-[14px] transition-colors ${
                                          sentCheer === ce
                                            ? 'border-[var(--ok)] bg-[var(--sf-2)]'
                                            : 'border-transparent hover:bg-[var(--sf-2)]'
                                        }`}
                                      >
                                        {ce}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Expandable 7-Day Study Consistency Recharts Drawer */}
                            {isExpanded && (
                              <div className="mt-3 space-y-3 border-t border-[var(--line)] pt-3 text-[12.5px]">
                                <div className="split flex-wrap gap-2">
                                  <strong className="text-[var(--tx)]">
                                    7-day study comparison:{' '}
                                    {isMe
                                      ? 'Your last 7 days'
                                      : `You vs ${row.entry.nick}`}
                                  </strong>
                                  {!isMe && (
                                    <Button
                                      variant={isPaceTarget ? 'primary' : 'secondary'}
                                      size="sm"
                                      icon={<Target size={14} />}
                                      onClick={() =>
                                        handleTogglePaceTarget(
                                          row.uid,
                                          row.entry.nick
                                        )
                                      }
                                    >
                                      {isPaceTarget
                                        ? 'Active pace target'
                                        : 'Set as pace target'}
                                    </Button>
                                  )}
                                </div>

                                {(() => {
                                  const memberConsistency =
                                    buildMemberLast7DaysConsistencyData(
                                      row.entry,
                                      todayKey
                                    );
                                  return (
                                    <div
                                      aria-label={`7-day study consistency chart for ${row.entry.nick}`}
                                      className="rounded-xl border border-[var(--line)] bg-[var(--sf-2)] p-3"
                                    >
                                      <div className="split mb-2 text-[12px]">
                                        <span className="text-[var(--tx-2)]">
                                          7-day consistency ({row.entry.nick})
                                        </span>
                                        <span className="tnum text-[var(--tx-2)]">
                                          {memberConsistency.activeDaysCount}/7 days ·{' '}
                                          {memberConsistency.consistencyPct}%
                                        </span>
                                      </div>
                                      <div className="h-[96px] w-full">
                                        <ResponsiveContainer
                                          width="100%"
                                          height="100%"
                                        >
                                          <BarChart
                                            data={memberConsistency.days}
                                            margin={{
                                              top: 4,
                                              right: 4,
                                              bottom: 0,
                                              left: 4,
                                            }}
                                          >
                                            <XAxis
                                              dataKey="label"
                                              tick={{
                                                fontSize: 12,
                                                fill: '#A3ABB8',
                                              }}
                                              axisLine={false}
                                              tickLine={false}
                                            />
                                            <YAxis
                                              hide
                                              domain={[0, 'dataMax + 30']}
                                            />
                                            <Tooltip
                                              contentStyle={{
                                                background: '#181C22',
                                                border:
                                                  '1px solid rgba(255,255,255,0.08)',
                                                borderRadius: 8,
                                                fontSize: 12,
                                                color: '#ECEFF4',
                                              }}
                                              formatter={(value) => [
                                                formatMinutesAsHoursMins(
                                                  Number(value ?? 0)
                                                ),
                                                'Study time',
                                              ]}
                                              labelFormatter={(label) =>
                                                `Date: ${label}`
                                              }
                                            />
                                            <Bar
                                              dataKey="minutes"
                                              fill={
                                                isLiveNow ? '#4ADE80' : '#F5C451'
                                              }
                                              radius={[4, 4, 0, 0]}
                                              barSize={18}
                                              isAnimationActive={false}
                                            />
                                          </BarChart>
                                        </ResponsiveContainer>
                                      </div>
                                    </div>
                                  );
                                })()}

                                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                  <div className="rounded-xl border border-[var(--line)] bg-[var(--sf-2)] p-2.5">
                                    <span className="block text-[12px] text-[var(--tx-2)]">
                                      Today study
                                    </span>
                                    <strong className="tnum text-[13.5px] text-[var(--tx)]">
                                      {row.entry.sh.t
                                        ? formatMinutesAsHoursMins(memberTodayMins)
                                        : 'Hidden'}
                                    </strong>
                                  </div>
                                  <div className="rounded-xl border border-[var(--line)] bg-[var(--sf-2)] p-2.5">
                                    <span className="block text-[12px] text-[var(--tx-2)]">
                                      This week study
                                    </span>
                                    <strong className="tnum text-[13.5px] text-[var(--tx)]">
                                      {row.entry.sh.t
                                        ? formatMinutesAsHoursMins(memberWeekMins)
                                        : 'Hidden'}
                                    </strong>
                                  </div>
                                  <div className="rounded-xl border border-[var(--line)] bg-[var(--sf-2)] p-2.5">
                                    <span className="block text-[12px] text-[var(--tx-2)]">
                                      Week / total XP
                                    </span>
                                    <strong className="tnum text-[13.5px] text-[var(--tx)]">
                                      {row.entry.sh.x
                                        ? `${memberWeekXp} / ${(row.entry.xpTotal || 0).toLocaleString()}`
                                        : 'Hidden'}
                                    </strong>
                                  </div>
                                  <div className="rounded-xl border border-[var(--line)] bg-[var(--sf-2)] p-2.5">
                                    <span className="block text-[12px] text-[var(--tx-2)]">
                                      Streak &amp; consistency
                                    </span>
                                    <strong className="tnum text-[13.5px] text-[var(--tx)]">
                                      {row.entry.sh.s
                                        ? `${row.entry.streak ?? 0}d · ${row.entry.consistency ?? 0}%`
                                        : 'Hidden'}
                                    </strong>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>
              )}

              {/* History & Trophies Tab */}
              {boardTab === 'history' && (
                <Card className="space-y-3">
                  <SectionHeader
                    title="Weekly standings &amp; trophy cabinet"
                    subtitle="Last 12 completed weeks"
                  />
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
                        <div className="grid grid-cols-3 gap-2.5">
                          <Stat label="1st place" value={String(myMedals.gold)} />
                          <Stat label="2nd place" value={String(myMedals.silver)} />
                          <Stat label="3rd place" value={String(myMedals.bronze)} />
                        </div>

                        {weekKeys.length === 0 ? (
                          <p className="text-[13px] text-[var(--tx-2)]">
                            Completed weekly standings appear here automatically each
                            Monday when at least 2 members share study time.
                          </p>
                        ) : (
                          <div className="divide-y divide-[var(--line)]">
                            {weekKeys.map((wk) => {
                              const w = combinedWeeks[wk];
                              if (!w) return null;
                              return (
                                <div
                                  key={wk}
                                  className="split py-2.5 text-[13.5px]"
                                >
                                  <span className="tnum text-[var(--tx)]">
                                    Week of <strong>{wk}</strong>
                                  </span>
                                  <span className="tnum text-[var(--tx-2)]">
                                    Rank <strong>#{w.rank}</strong> of {w.of} ·{' '}
                                    {formatMinutesAsHoursMins(w.minutes)} · {w.xp} XP
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </Card>
              )}

              {/* Per-Group Privacy & Sharing Switches */}
              {activeGroupPref && (
                <Card className="space-y-3">
                  <div>
                    <h4 className="text-[14.5px] font-semibold text-[var(--tx)]">
                      My sharing preferences in &ldquo;{activeGroupDoc.name}&rdquo;
                    </h4>
                    <p className="text-[12px] text-[var(--tx-2)]">
                      Turned-off items are omitted from your group entry and shown as
                      hidden.
                    </p>
                  </div>

                  <div className="divide-y divide-[var(--line)]">
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
                      <div
                        key={item.key}
                        className="split py-2.5 text-[13.5px] text-[var(--tx)]"
                      >
                        <span>{item.label}</span>
                        <Switch
                          checked={item.checked}
                          onChange={(nextVal) =>
                            handleToggleSharingFlag(item.key, nextVal)
                          }
                          label={item.label}
                        />
                      </div>
                    ))}
                  </div>

                  <div className="split flex-wrap gap-2 pt-2">
                    <span className="tnum text-[12px] text-[var(--tx-3)]">
                      Group writes today: {groupBudget.getWritesToday()}/60 · Reads:{' '}
                      {groupBudget.getReadsToday()}/150
                    </span>
                    {confirmLeaveGroupId === activeGroupId ? (
                      <div className="flex items-center gap-2">
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={actionBusy}
                          onClick={() => handleLeaveGroup(activeGroupId)}
                        >
                          Confirm leave
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setConfirmLeaveGroupId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => setConfirmLeaveGroupId(activeGroupId)}
                      >
                        Leave group
                      </Button>
                    )}
                  </div>
                </Card>
              )}

              {/* Owner Tools Card */}
              {isOwner && (
                <Card className="space-y-3">
                  <div className="split">
                    <div className="flex items-center gap-2">
                      <Crown size={17} className="text-[var(--ac)]" />
                      <strong className="text-[14.5px] text-[var(--tx)]">
                        Group owner tools
                      </strong>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={
                        showOwnerDrawer ? (
                          <ChevronUp size={15} />
                        ) : (
                          <ChevronDown size={15} />
                        )
                      }
                      onClick={() => setShowOwnerDrawer((v) => !v)}
                    >
                      {showOwnerDrawer ? 'Hide' : 'Manage squad'}
                    </Button>
                  </div>

                  {showOwnerDrawer && (
                    <div className="space-y-4 border-t border-[var(--line)] pt-3">
                      <form
                        onSubmit={handleOwnerSaveSettings}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <input
                          type="text"
                          value={ownerEditName}
                          maxLength={32}
                          onChange={(e) => setOwnerEditName(e.target.value)}
                          placeholder="Group Name"
                          aria-label="Edit group name"
                          className="h-11 min-w-[160px] flex-1 rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3 text-[13.5px]"
                        />
                        <input
                          type="number"
                          min={0}
                          max={5000}
                          step="1"
                          value={ownerGoalHoursInput}
                          onChange={(e) => setOwnerGoalHoursInput(e.target.value)}
                          placeholder="Weekly goal (hrs)"
                          aria-label="Weekly group goal in hours"
                          className="h-11 w-44 rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3 text-[13.5px]"
                        />
                        <Button
                          type="submit"
                          variant="primary"
                          disabled={actionBusy}
                        >
                          Save
                        </Button>
                      </form>

                      <div className="split border-y border-[var(--line)] py-2.5 text-[13.5px]">
                        <span>Enable Mock Score Leaderboard tab for this group</span>
                        <Switch
                          checked={Boolean(activeGroupDoc.mockBoard)}
                          onChange={(checked) => handleOwnerToggleMockBoard(checked)}
                          label="Enable Mock Score Leaderboard tab"
                        />
                      </div>

                      {Object.keys(activeGroupDoc.members).length > 1 && (
                        <div className="space-y-2">
                          <span className="block text-[12.5px] font-medium text-[var(--tx-2)]">
                            Manage members
                          </span>
                          {Object.entries(activeGroupDoc.members)
                            .filter(([uid]) => uid !== myUid)
                            .map(([uid, m]) => (
                              <div
                                key={uid}
                                className="split py-1.5 text-[13.5px]"
                              >
                                <span>
                                  {m.emoji} {m.nick}
                                </span>
                                {confirmKickUid === uid ? (
                                  <div className="flex items-center gap-2">
                                    <Button
                                      variant="danger"
                                      size="sm"
                                      disabled={actionBusy}
                                      onClick={() =>
                                        handleOwnerRemoveMember(uid, m.nick)
                                      }
                                    >
                                      Confirm remove
                                    </Button>
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      onClick={() => setConfirmKickUid(null)}
                                    >
                                      Cancel
                                    </Button>
                                  </div>
                                ) : (
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => setConfirmKickUid(uid)}
                                  >
                                    Remove
                                  </Button>
                                )}
                              </div>
                            ))}
                        </div>
                      )}

                      <div className="border-t border-[var(--line)] pt-3">
                        {confirmCloseGroupId === activeGroupId ? (
                          <div className="split flex-wrap gap-2">
                            <span className="text-[12.5px] text-[var(--bad)]">
                              Permanently delete this group for all members?
                            </span>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="danger"
                                size="sm"
                                disabled={actionBusy}
                                onClick={() =>
                                  handleOwnerCloseGroup(activeGroupId)
                                }
                              >
                                Yes, close group
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setConfirmCloseGroupId(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => setConfirmCloseGroupId(activeGroupId)}
                          >
                            Close &amp; delete group
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </Card>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};
