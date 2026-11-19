import React from 'react';
import {
  BarChart2,
  BookOpen,
  CalendarCheck,
  Pause,
  Play,
  Timer,
  Users,
} from 'lucide-react';
import type { AppTab, PulseHabitState, SyncStatus, TimerMetrics } from '../types';
import { fmtHMS, getTimerMetrics } from '../utils/studyLogic';
import { useTimerTick } from '../utils/timerTicker';
import { BrandLogo, IconButton, TopBar } from './ui';

export type MainNavTab = 'today' | 'focus' | 'prep' | 'stats' | 'groups';

export interface AppShellProps {
  activeTab: AppTab;
  settingsOpen: boolean;
  onSelectTab: (tab: MainNavTab) => void;
  onCloseSettings: () => void;
  topBarTitle: string;
  topBarSubtitle?: string;
  syncStatus: SyncStatus;
  isOnline: boolean;
  isSignedIn: boolean;
  streakCount: number;
  streakMetToday: boolean;
  level: number;
  xpProgressPct: number;
  onOpenDrawer: () => void;
  onBackFromSettings: () => void;
  onOpenStreak: () => void;
  onOpenProfile: () => void;
  onOpenQuickActions: () => void;
  activeMetrics: TimerMetrics | null;
  timerState?: PulseHabitState;
  onToggleTimerPause: () => void;
  todayPct: number;
  children: React.ReactNode;
}

const LiveMiniTimerBar: React.FC<{
  fallbackMetrics: TimerMetrics;
  timerState?: PulseHabitState;
  onOpenFocus: () => void;
  onToggleTimerPause: () => void;
}> = ({ fallbackMetrics, timerState, onOpenFocus, onToggleTimerPause }) => {
  const isRunning = Boolean(
    timerState
      ? timerState.activeTimer?.status === 'running'
      : fallbackMetrics.status === 'running'
  );
  useTimerTick(isRunning);
  const liveMetrics =
    (timerState?.activeTimer ? getTimerMetrics(timerState, Date.now()) : null) ||
    fallbackMetrics;

  return (
    <div
      className="dh-mini-timer"
      role="region"
      aria-label="Active study timer"
    >
      <button
        type="button"
        onClick={onOpenFocus}
        style={{
          flex: 1,
          minWidth: 0,
          background: 'transparent',
          border: 0,
          padding: 0,
          minHeight: '40px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          textAlign: 'left',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: '10px',
            height: '10px',
            borderRadius: '99px',
            background: liveMetrics.subject.color,
            flexShrink: 0,
          }}
        />
        <span style={{ minWidth: 0, flex: 1 }}>
          <span
            style={{
              display: 'block',
              fontSize: '14px',
              fontWeight: 600,
              color: 'var(--tx)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {liveMetrics.heading}
          </span>
          <span style={{ display: 'block', fontSize: '13px', color: 'var(--tx-2)' }}>
            {liveMetrics.status === 'paused' ? 'Paused' : 'Studying'} ·{' '}
            {liveMetrics.subject.name}
          </span>
        </span>
        <span
          className="mono"
          style={{
            fontSize: '15px',
            fontWeight: 700,
            color: liveMetrics.status === 'paused' ? 'var(--warn-ink)' : 'var(--ok-ink)',
            flexShrink: 0,
          }}
        >
          {fmtHMS(liveMetrics.totalActiveMs)}
        </span>
      </button>

      <IconButton
        aria-label={
          liveMetrics.status === 'running' ? 'Pause session' : 'Resume session'
        }
        size={40}
        variant="primary"
        onClick={(e) => {
          e.stopPropagation();
          onToggleTimerPause();
        }}
      >
        {liveMetrics.status === 'running' ? (
          <Pause size={18} strokeWidth={2} aria-hidden="true" />
        ) : (
          <Play size={18} strokeWidth={2} aria-hidden="true" />
        )}
      </IconButton>
    </div>
  );
};

const NAV_ITEMS: Array<{
  id: MainNavTab;
  label: string;
  Icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
}> = [
  { id: 'today', label: 'Today', Icon: CalendarCheck },
  { id: 'focus', label: 'Focus', Icon: Timer },
  { id: 'prep', label: 'Prep', Icon: BookOpen },
  { id: 'stats', label: 'Insights', Icon: BarChart2 },
  { id: 'groups', label: 'Community', Icon: Users },
];

export const AppShell: React.FC<AppShellProps> = ({
  activeTab,
  settingsOpen,
  onSelectTab,
  onCloseSettings,
  topBarTitle,
  topBarSubtitle,
  syncStatus,
  isOnline,
  isSignedIn,
  streakCount,
  streakMetToday,
  level,
  xpProgressPct,
  onOpenDrawer,
  onBackFromSettings,
  onOpenStreak,
  onOpenProfile,
  onOpenQuickActions,
  activeMetrics,
  timerState,
  onToggleTimerPause,
  todayPct,
  children,
}) => {
  const effectiveTab: MainNavTab =
    activeTab === 'focus' ||
    activeTab === 'prep' ||
    activeTab === 'stats' ||
    activeTab === 'groups'
      ? activeTab
      : 'today';

  const handleNavClick = (id: MainNavTab) => {
    if (settingsOpen) onCloseSettings();
    onSelectTab(id);
    window.scrollTo(0, 0);
  };

  const showMiniTimer = Boolean(
    activeMetrics && (settingsOpen || effectiveTab !== 'focus')
  );

  return (
    <div className="dh-shell">
      {/* Tablet / Desktop Left Rail */}
      <aside className="dh-rail" aria-label="Primary navigation">
        <div className="dh-rail-brand">
          <BrandLogo
            size={36}
            showWordmark
            subtitle={`${todayPct}% daily goal`}
          />
        </div>

        <nav className="dh-rail-nav" aria-label="Main views">
          {NAV_ITEMS.map(({ id, label, Icon }) => {
            const isActive = !settingsOpen && effectiveTab === id;
            return (
              <button
                key={id}
                type="button"
                className={`dh-rail-item ${isActive ? 'active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => handleNavClick(id)}
              >
                <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main Column */}
      <div className="dh-main-wrap max-w-full overflow-x-clip">
        <TopBar
          title={topBarTitle}
          subtitle={topBarSubtitle}
          syncStatus={syncStatus}
          isOnline={isOnline}
          isSignedIn={isSignedIn}
          streakCount={streakCount}
          streakMetToday={streakMetToday}
          level={level}
          xpProgressPct={xpProgressPct}
          settingsMode={settingsOpen}
          onOpenDrawer={onOpenDrawer}
          onBackFromSettings={onBackFromSettings}
          onOpenStreak={onOpenStreak}
          onOpenProfile={onOpenProfile}
          onOpenQuickActions={onOpenQuickActions}
        />

        <div
          className={
            showMiniTimer
              ? 'dh-stage max-w-full overflow-x-clip has-mini-timer'
              : 'dh-stage max-w-full overflow-x-clip'
          }
        >
          {children}
        </div>
      </div>

      {/* Mini Active Timer Bar when away from Focus */}
      {showMiniTimer && activeMetrics && (
        <LiveMiniTimerBar
          fallbackMetrics={activeMetrics}
          timerState={timerState}
          onOpenFocus={() => handleNavClick('focus')}
          onToggleTimerPause={onToggleTimerPause}
        />
      )}

      {/* Mobile 5-Tab Bottom Bar (<768px, NO FAB) */}
      <nav className="dh-tabbar" aria-label="Main">
        {NAV_ITEMS.map(({ id, label, Icon }) => {
          const isActive = !settingsOpen && effectiveTab === id;
          return (
            <button
              key={id}
              type="button"
              className={`dh-tab-btn ${isActive ? 'active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => handleNavClick(id)}
            >
              <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};
