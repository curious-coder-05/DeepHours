import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bell,
  BookOpen,
  Calendar,
  Cloud,
  Database,
  Info,
  Palette,
  Repeat,
  Sliders,
  Target,
  User,
  X,
} from 'lucide-react';
import type { PulseHabitState, SyncStatus } from '../types';
import { logicalKey, pad } from '../utils/studyLogic';
import {
  UI_ACCENT_SWATCHES,
  getTimerStyleDisplayLabel,
  resolveUiExam,
} from '../utils/uiHelpers';
import { computeLevelInfo, computeTotalXp } from '../utils/xp';
import {
  evaluateDrawerSwipe,
  type SettingsSectionId,
} from '../utils/navHelpers';
import { triggerHaptic } from '../utils/haptics';
import { IconButton, ListGroup, ListRow } from './ui';

export interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  onSelectSection: (section: SettingsSectionId) => void;
  activeSection?: SettingsSectionId | null;
  state: PulseHabitState;
  todayKey?: string;
  amoled?: boolean;
  cloudUser?: { uid: string; displayName: string | null; email: string | null } | null;
  syncStatus?: SyncStatus;
  dailyWritesUsed?: number;
  dailyWriteCap?: number;
  isOnline?: boolean;
}

export const SettingsDrawer: React.FC<SettingsDrawerProps> = ({
  open,
  onClose,
  onSelectSection,
  activeSection = null,
  state,
  todayKey: todayKeyProp,
  amoled = false,
  cloudUser = null,
  syncStatus = 'off',
  dailyWritesUsed = 0,
  dailyWriteCap = 500,
  isOnline = true,
}) => {
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Touch swipe-left-to-close gesture state (strict horizontal intent; no edge-open)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const swipeAxisRef = useRef<'pending' | 'horizontal' | 'vertical'>('pending');
  const [dragOffsetX, setDragOffsetX] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  useEffect(() => {
    if (!open) {
      setDragOffsetX(0);
      setIsDragging(false);
      return;
    }

    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === 'Tab' && drawerRef.current) {
        const focusables = Array.from(
          drawerRef.current.querySelectorAll<HTMLElement>(
            'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
          )
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    const frameId = requestAnimationFrame(() => {
      drawerRef.current?.focus();
    });

    return () => {
      cancelAnimationFrame(frameId);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = prevOverflow;
      if (
        previousFocusRef.current &&
        typeof previousFocusRef.current.focus === 'function'
      ) {
        previousFocusRef.current.focus();
      }
    };
  }, [open]);

  const effectiveTodayKey =
    todayKeyProp || logicalKey(new Date(), state.set?.dayResetHour ?? 0);
  const totalXp = useMemo(
    () => (open ? computeTotalXp(state, effectiveTodayKey) : 0),
    [open, state, effectiveTodayKey]
  );
  const levelInfo = useMemo(() => computeLevelInfo(totalXp), [totalXp]);
  const resolvedExam = useMemo(
    () => (open ? resolveUiExam(state, effectiveTodayKey) : null),
    [open, state, effectiveTodayKey]
  );

  if (!open) return null;

  const set = state.set;
  const activeSubjects = state.subjects.filter((s) => !s.arch);
  const targets = set.targets || {
    dailyMinutes: {},
    weeklyMinutes: {},
    minDayMinutes: 360,
    restPassesPerMonth: 4,
  };
  const minDayMins = Math.max(15, Number(targets.minDayMinutes) || 360);
  const minDayFormatted = `${Math.floor(minDayMins / 60)}h ${minDayMins % 60}m`;
  const currentAvatar = set.cloudAccount?.avatarEmoji || set.avatarEmoji || '🧑‍⚕️';
  const currentAccentSwatch = UI_ACCENT_SWATCHES.find(
    (sw) => sw.hex.toLowerCase() === (set.ac || '').toLowerCase()
  );
  const currentTimerStyleLabel = getTimerStyleDisplayLabel(set.timerAesthetic);
  const currentUi3d = set.ui3d || 'auto';

  const syncStatusLabel = !isOnline
    ? 'Offline'
    : syncStatus === 'syncing'
      ? 'Syncing...'
      : syncStatus === 'paused-quota'
        ? 'Paused'
        : syncStatus === 'error'
          ? 'Error'
          : cloudUser
            ? 'Connected'
            : 'Local';

  const syncBadgeColor = !isOnline || syncStatus === 'offline'
    ? 'var(--warn-ink)'
    : syncStatus === 'error' || syncStatus === 'paused-quota'
      ? 'var(--err-ink)'
      : syncStatus === 'syncing'
        ? 'var(--info-ink)'
        : cloudUser
          ? 'var(--ok-ink)'
          : 'var(--tx-2)';

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
    swipeAxisRef.current = 'pending';
    setIsDragging(false);
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!touchStartRef.current || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - touchStartRef.current.x;
    const dy = t.clientY - touchStartRef.current.y;

    if (swipeAxisRef.current === 'vertical') return;

    if (swipeAxisRef.current === 'pending') {
      if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) {
        swipeAxisRef.current = 'vertical';
        return;
      }
      if (Math.abs(dx) > 10) {
        const evalRes = evaluateDrawerSwipe({ dx, dy });
        if (evalRes.isHorizontalLeft) {
          swipeAxisRef.current = 'horizontal';
          setIsDragging(true);
          setDragOffsetX(evalRes.translateX);
        } else if (dx > 10) {
          swipeAxisRef.current = 'vertical';
        }
      }
      return;
    }

    if (swipeAxisRef.current === 'horizontal') {
      const clampedX = Math.min(0, dx);
      setDragOffsetX(clampedX);
    }
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!touchStartRef.current) return;
    const start = touchStartRef.current;
    const endTouch = e.changedTouches[0];
    touchStartRef.current = null;
    const axis = swipeAxisRef.current;
    swipeAxisRef.current = 'pending';
    setIsDragging(false);

    if (axis === 'horizontal' && endTouch) {
      const dx = endTouch.clientX - start.x;
      const dy = endTouch.clientY - start.y;
      const res = evaluateDrawerSwipe({ dx, dy, thresholdPx: 64, intentRatio: 1.4 });
      if (res.shouldDismiss) {
        triggerHaptic('tap');
        setDragOffsetX(0);
        onClose();
        return;
      }
    }
    setDragOffsetX(0);
  };

  const handlePick = (section: SettingsSectionId) => {
    triggerHaptic('tap');
    onSelectSection(section);
  };

  const drawerNode = (
    <div
      className="dh-drawer-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          triggerHaptic('tap');
          onClose();
        }
      }}
    >
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Settings menu"
        tabIndex={-1}
        className={`dh-drawer-panel ${isDragging ? 'is-dragging' : ''}`.trim()}
        style={
          dragOffsetX < 0
            ? { transform: `translateX(${dragOffsetX}px)` }
            : undefined
        }
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={() => {
          touchStartRef.current = null;
          swipeAxisRef.current = 'pending';
          setIsDragging(false);
          setDragOffsetX(0);
        }}
      >
        <div className="dh-drawer-head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 className="dh-drawer-title">Settings</h2>
            <p className="dh-drawer-sub">Account, preferences &amp; backups</p>
          </div>
          <IconButton
            aria-label="Close settings menu"
            size={40}
            variant="ghost"
            onClick={() => {
              triggerHaptic('tap');
              onClose();
            }}
          >
            <X size={20} strokeWidth={1.75} aria-hidden="true" />
          </IconButton>
        </div>

        <nav className="dh-drawer-body" aria-label="Settings sections">
          {/* Group 1: Profile & Account */}
          <ListGroup className="dh-drawer-group" aria-label="Profile and sync settings">
            <ListRow
              className={`dh-drawer-row ${activeSection === 'profile' ? 'is-active' : ''}`}
              leading={<User size={19} strokeWidth={1.75} aria-hidden="true" />}
              title="Profile and level"
              subtitle={
                state.profile?.nick
                  ? `${state.profile.nick} · Level ${levelInfo.level} · ${totalXp.toLocaleString()} XP`
                  : `Level ${levelInfo.level} · ${totalXp.toLocaleString()} XP`
              }
              trailing={<span style={{ fontSize: '18px', lineHeight: 1 }}>{currentAvatar}</span>}
              chevron
              onClick={() => handlePick('profile')}
            />
            <ListRow
              className={`dh-drawer-row ${activeSection === 'sync' ? 'is-active' : ''}`}
              leading={<Cloud size={19} strokeWidth={1.75} aria-hidden="true" />}
              title="Account and cloud sync"
              subtitle={
                cloudUser
                  ? `${cloudUser.email || cloudUser.displayName || 'Google Account'} · ${dailyWritesUsed}/${dailyWriteCap} writes`
                  : 'Local-only mode · Sign in to sync across devices'
              }
              trailing={
                <span
                  style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    color: syncBadgeColor,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {syncStatusLabel}
                </span>
              }
              chevron
              onClick={() => handlePick('sync')}
            />
          </ListGroup>

          {/* Group 2: Study configuration */}
          <ListGroup className="dh-drawer-group" aria-label="Study configuration">
            <ListRow
              className={`dh-drawer-row ${activeSection === 'study' ? 'is-active' : ''}`}
              leading={<Sliders size={19} strokeWidth={1.75} aria-hidden="true" />}
              title="Study"
              subtitle={`Reset ${pad(set.dayResetHour ?? 0)}:00 · ${currentTimerStyleLabel} timer · ${set.pipPref === 'doc' ? 'Document PiP' : 'Video PiP'}`}
              chevron
              onClick={() => handlePick('study')}
            />
            <ListRow
              className={`dh-drawer-row ${activeSection === 'targets' ? 'is-active' : ''}`}
              leading={<Target size={19} strokeWidth={1.75} aria-hidden="true" />}
              title="Goals and targets"
              subtitle={`Goal ${minDayFormatted}/day (${minDayMins}m) · Full mock ${set.fullMockMins ?? 180}m · Target ${set.targetMockScore ?? 650}`}
              chevron
              onClick={() => handlePick('targets')}
            />
            <ListRow
              className={`dh-drawer-row ${activeSection === 'exams' ? 'is-active' : ''}`}
              leading={<Calendar size={19} strokeWidth={1.75} aria-hidden="true" />}
              title="Exams"
              subtitle={
                resolvedExam
                  ? `${resolvedExam.title} (${resolvedExam.date})`
                  : `${state.ddays.length} exam countdowns`
              }
              trailing={<span className="tabular-nums">{String(state.ddays.length)}</span>}
              chevron
              onClick={() => handlePick('exams')}
            />
            <ListRow
              className={`dh-drawer-row ${activeSection === 'subjects' ? 'is-active' : ''}`}
              leading={<BookOpen size={19} strokeWidth={1.75} aria-hidden="true" />}
              title="Subjects"
              subtitle={`${activeSubjects.length} active subjects`}
              chevron
              onClick={() => handlePick('subjects')}
            />
            <ListRow
              className={`dh-drawer-row ${activeSection === 'habits' ? 'is-active' : ''}`}
              leading={<Repeat size={19} strokeWidth={1.75} aria-hidden="true" />}
              title="Habits"
              subtitle={`${state.habits.filter((h) => !h.arch).length} active habits`}
              chevron
              onClick={() => handlePick('habits')}
            />
          </ListGroup>

          {/* Group 3: Appearance, alerts, and data */}
          <ListGroup className="dh-drawer-group" aria-label="Appearance, alerts, and data">
            <ListRow
              className={`dh-drawer-row ${activeSection === 'appearance' ? 'is-active' : ''}`}
              leading={<Palette size={19} strokeWidth={1.75} aria-hidden="true" />}
              title="Appearance"
              subtitle={`${set.theme[0].toUpperCase() + set.theme.slice(1)}${amoled ? ' · AMOLED' : ''} · ${currentAccentSwatch?.label || 'Custom'} · 3D ${currentUi3d}`}
              chevron
              onClick={() => handlePick('appearance')}
            />
            <ListRow
              className={`dh-drawer-row ${activeSection === 'notifications' ? 'is-active' : ''}`}
              leading={<Bell size={19} strokeWidth={1.75} aria-hidden="true" />}
              title="Notifications and sound"
              subtitle={`${set.snd ? 'Sounds on' : 'Muted'} · ${set.notif ? 'Reminders on' : 'Reminders off'}`}
              chevron
              onClick={() => handlePick('notifications')}
            />
            <ListRow
              className={`dh-drawer-row ${activeSection === 'data' ? 'is-active' : ''}`}
              leading={<Database size={19} strokeWidth={1.75} aria-hidden="true" />}
              title="Data"
              subtitle={
                state.exp
                  ? `Last backup ${new Date(state.exp).toLocaleDateString()}`
                  : 'JSON and CSV export, restore, reset'
              }
              chevron
              onClick={() => handlePick('data')}
            />
            <ListRow
              className={`dh-drawer-row ${activeSection === 'about' ? 'is-active' : ''}`}
              leading={<Info size={19} strokeWidth={1.75} aria-hidden="true" />}
              title="About"
              subtitle="Offline storage architecture and quick actions guide"
              chevron
              onClick={() => handlePick('about')}
            />
          </ListGroup>
        </nav>
      </div>
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(drawerNode, document.body)
    : drawerNode;
};
