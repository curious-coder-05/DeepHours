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
import type { AppTab, SyncStatus, TimerMetrics } from '../types';
import { fmtHMS } from '../utils/studyLogic';
import { IconButton, TopBar } from './ui';

export type MainNavTab = 'today' | 'focus' | 'prep' | 'stats' | 'groups';

export interface AppShellProps {
  activeTab: AppTab;
  settingsOpen: boolean;
  onSelectTab: (tab: MainNavTab) => void;
  onCloseSettings: () => void;
  topBarTitle: string;
  topBarSubtitle?: string;
  avatarEmoji: string;
  syncStatus: SyncStatus;
  isOnline: boolean;
  isSignedIn: boolean;
  onOpenQuickActions: () => void;
  onOpenSettings: () => void;
  onOpenSyncSettings: () => void;
  activeMetrics: TimerMetrics | null;
  onToggleTimerPause: () => void;
  todayPct: number;
  children: React.ReactNode;
}

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
  avatarEmoji,
  syncStatus,
  isOnline,
  isSignedIn,
  onOpenQuickActions,
  onOpenSettings,
  onOpenSyncSettings,
  activeMetrics,
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
          <div
            aria-hidden="true"
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '10px',
              background: 'var(--ac)',
              color: 'var(--ac-on)',
              display: 'grid',
              placeItems: 'center',
              fontWeight: 700,
              fontSize: '15px',
              flexShrink: 0,
            }}
          >
            DH
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '15px', fontWeight: 700, lineHeight: 1.2 }}>
              Deep Hours
            </div>
            <div style={{ fontSize: '12px', color: 'var(--tx-2)' }}>
              {todayPct}% daily goal
            </div>
          </div>
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
      <div className="dh-main-wrap">
        <TopBar
          title={topBarTitle}
          subtitle={topBarSubtitle}
          avatarEmoji={avatarEmoji}
          syncStatus={syncStatus}
          isOnline={isOnline}
          isSignedIn={isSignedIn}
          onOpenQuickActions={onOpenQuickActions}
          onOpenSettings={onOpenSettings}
          onOpenSyncSettings={onOpenSyncSettings}
        />

        <div className="dh-stage">{children}</div>
      </div>

      {/* Mini Active Timer Bar when away from Focus */}
      {showMiniTimer && activeMetrics && (
        <div
          className="dh-mini-timer"
          role="region"
          aria-label="Active study timer"
        >
          <button
            type="button"
            onClick={() => handleNavClick('focus')}
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
                background: activeMetrics.subject.color,
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
                {activeMetrics.heading}
              </span>
              <span style={{ display: 'block', fontSize: '12px', color: 'var(--tx-2)' }}>
                {activeMetrics.status === 'paused' ? 'Paused' : 'Studying'} ·{' '}
                {activeMetrics.subject.name}
              </span>
            </span>
            <span
              className="mono"
              style={{
                fontSize: '15px',
                fontWeight: 700,
                color: activeMetrics.status === 'paused' ? 'var(--warn-ink)' : 'var(--ok-ink)',
                flexShrink: 0,
              }}
            >
              {fmtHMS(activeMetrics.totalActiveMs)}
            </span>
          </button>

          <IconButton
            aria-label={
              activeMetrics.status === 'running' ? 'Pause session' : 'Resume session'
            }
            size={40}
            variant="primary"
            onClick={(e) => {
              e.stopPropagation();
              onToggleTimerPause();
            }}
          >
            {activeMetrics.status === 'running' ? (
              <Pause size={18} strokeWidth={2} aria-hidden="true" />
            ) : (
              <Play size={18} strokeWidth={2} aria-hidden="true" />
            )}
          </IconButton>
        </div>
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
