import React, { useEffect, useState } from 'react';
import { ArrowLeft, Flame, Plus } from 'lucide-react';
import type { SyncStatus } from '../../types';
import { getMenuSyncDotState } from '../../utils/navHelpers';
import { triggerHaptic } from '../../utils/haptics';

export interface TopBarProps {
  title: string;
  subtitle?: string;
  syncStatus: SyncStatus;
  isOnline: boolean;
  isSignedIn: boolean;
  streakCount: number;
  streakMetToday: boolean;
  level: number;
  xpProgressPct: number;
  settingsMode?: boolean;
  onOpenDrawer: () => void;
  onBackFromSettings?: () => void;
  onOpenStreak: () => void;
  onOpenProfile: () => void;
  onOpenQuickActions: () => void;
}

const StaggeredMenuIcon: React.FC = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <line x1="3.5" y1="6.5" x2="15.5" y2="6.5" />
    <line x1="3.5" y1="12" x2="20.5" y2="12" />
    <line x1="3.5" y1="17.5" x2="11.5" y2="17.5" />
  </svg>
);

export const TopBar: React.FC<TopBarProps> = ({
  title,
  subtitle,
  syncStatus,
  isOnline,
  isSignedIn,
  streakCount,
  streakMetToday,
  level,
  xpProgressPct,
  settingsMode = false,
  onOpenDrawer,
  onBackFromSettings,
  onOpenStreak,
  onOpenProfile,
  onOpenQuickActions,
}) => {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setCollapsed(window.scrollY > 24);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const syncDot = getMenuSyncDotState({ isOnline, isSignedIn, syncStatus });
  const menuAriaLabel = syncDot.visible
    ? `Open settings menu (${syncDot.label})`
    : 'Open settings menu';

  const clampedXpPct = Math.min(100, Math.max(0, Math.round(xpProgressPct)));

  const menuTriggerButton = (
    <button
      type="button"
      className="dh-topbar-menu-btn"
      aria-label={menuAriaLabel}
      title={syncDot.visible ? syncDot.label : 'Settings & account'}
      onClick={() => {
        triggerHaptic('tap');
        onOpenDrawer();
      }}
    >
      <StaggeredMenuIcon />
      {syncDot.visible && syncDot.tone && (
        <span
          aria-hidden="true"
          className={`dh-menu-sync-dot dh-menu-sync-dot-${syncDot.tone}`}
        />
      )}
    </button>
  );

  if (settingsMode) {
    return (
      <header className={`dh-topbar dh-topbar-settings ${collapsed ? 'collapsed' : ''}`}>
        <div className="dh-topbar-inner">
          <div className="dh-topbar-left">
            <button
              type="button"
              className="dh-topbar-back-pill"
              aria-label="Back to previous view"
              onClick={() => {
                triggerHaptic('tap');
                onBackFromSettings?.();
              }}
            >
              <ArrowLeft size={16} strokeWidth={2} aria-hidden="true" />
              <span>Back</span>
            </button>
            <div className="dh-topbar-title-group">
              <h1 className="dh-topbar-title dh-topbar-title-settings">{title}</h1>
              {subtitle && <div className="dh-topbar-sub">{subtitle}</div>}
            </div>
          </div>

          <div className="dh-topbar-actions">{menuTriggerButton}</div>
        </div>
      </header>
    );
  }

  return (
    <header className={`dh-topbar ${collapsed ? 'collapsed' : ''}`}>
      <div className="dh-topbar-inner">
        <div className="dh-topbar-left">
          {menuTriggerButton}
          <div className="dh-topbar-title-group">
            <h1 className="dh-topbar-title">{title}</h1>
          </div>
        </div>

        <div className="dh-topbar-actions">
          <button
            type="button"
            className={`dh-topbar-pill dh-topbar-streak-pill ${streakMetToday ? 'is-met' : ''}`}
            aria-label={`Study streak: ${streakCount} days. Tap for streak details`}
            title={`Study streak: ${streakCount}d`}
            onClick={() => {
              triggerHaptic('tap');
              onOpenStreak();
            }}
          >
            <Flame
              size={14}
              strokeWidth={2}
              className={streakCount >= 3 ? 'dh-flame-flicker' : undefined}
              style={{
                color: streakMetToday ? 'var(--ok-ink)' : 'var(--ac-ink)',
                flexShrink: 0,
              }}
              aria-hidden="true"
            />
            <span className="tabular-nums">{streakCount}</span>
          </button>

          <button
            type="button"
            className="dh-topbar-pill dh-topbar-level-pill"
            aria-label={`Level ${level} (${clampedXpPct}% to next level). Tap to open Profile and level`}
            title={`Level ${level} · ${clampedXpPct}% XP`}
            onClick={() => {
              triggerHaptic('tap');
              onOpenProfile();
            }}
          >
            <span className="tabular-nums">Lv {level}</span>
            <span className="dh-topbar-xp-track" aria-hidden="true">
              <span
                className="dh-topbar-xp-fill"
                style={{ width: `${clampedXpPct}%` }}
              />
            </span>
          </button>

          <button
            type="button"
            className="dh-topbar-pill dh-topbar-plus-pill"
            aria-label="Quick actions"
            title="Quick actions"
            onClick={() => {
              triggerHaptic('tap');
              onOpenQuickActions();
            }}
          >
            <Plus size={18} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  );
};
