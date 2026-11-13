import React, { useEffect, useState } from 'react';
import { Cloud, CloudOff, Plus, RefreshCw } from 'lucide-react';
import type { SyncStatus } from '../../types';
import { IconButton } from './IconButton';

export interface TopBarProps {
  title: string;
  subtitle?: string;
  avatarEmoji: string;
  syncStatus: SyncStatus;
  isOnline: boolean;
  isSignedIn: boolean;
  onOpenQuickActions: () => void;
  onOpenSettings: () => void;
  onOpenSyncSettings: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  title,
  subtitle,
  avatarEmoji,
  syncStatus,
  isOnline,
  isSignedIn,
  onOpenQuickActions,
  onOpenSettings,
  onOpenSyncSettings,
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

  const syncDotColor = !isOnline || syncStatus === 'offline'
    ? 'var(--warn)'
    : syncStatus === 'error' || syncStatus === 'paused-quota' || syncStatus === 'paused'
      ? 'var(--err)'
      : syncStatus === 'syncing'
        ? 'var(--info)'
        : isSignedIn && syncStatus === 'synced'
          ? 'var(--ok)'
          : 'var(--tx-3)';

  const syncLabel = !isOnline || syncStatus === 'offline'
    ? 'Offline — changes saved locally'
    : !isSignedIn
      ? 'Cloud sync off (local device storage)'
      : syncStatus === 'syncing'
        ? 'Syncing with cloud'
        : syncStatus === 'error'
          ? 'Sync error — tap for details'
          : syncStatus === 'paused-quota'
            ? 'Cloud sync paused (daily cap)'
            : 'Synced with cloud';

  return (
    <header className={`dh-topbar ${collapsed ? 'collapsed' : ''}`}>
      <div className="dh-topbar-inner">
        <div className="dh-topbar-title-group">
          {subtitle && <div className="dh-topbar-sub">{subtitle}</div>}
          <h1 className="dh-topbar-title">{title}</h1>
        </div>

        <div className="dh-topbar-actions">
          <button
            type="button"
            onClick={onOpenSyncSettings}
            aria-label={syncLabel}
            title={syncLabel}
            style={{
              height: '44px',
              minHeight: '44px',
              padding: '0 10px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              borderRadius: '12px',
              background: 'var(--sf-2)',
              border: '1px solid var(--line)',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '99px',
                background: syncDotColor,
              }}
            />
            {!isOnline ? (
              <CloudOff size={16} strokeWidth={1.75} aria-hidden="true" />
            ) : syncStatus === 'syncing' ? (
              <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <Cloud size={16} strokeWidth={1.75} aria-hidden="true" />
            )}
          </button>

          <IconButton
            aria-label="Quick actions"
            title="Quick actions"
            variant="primary"
            onClick={onOpenQuickActions}
          >
            <Plus size={20} strokeWidth={2} aria-hidden="true" />
          </IconButton>

          <IconButton
            aria-label="Profile and settings"
            title="Profile and settings"
            onClick={onOpenSettings}
          >
            <span style={{ fontSize: '20px', lineHeight: 1 }} aria-hidden="true">
              {avatarEmoji || '🩺'}
            </span>
          </IconButton>
        </div>
      </div>
    </header>
  );
};
