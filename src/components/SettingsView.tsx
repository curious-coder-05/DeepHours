import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
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
} from 'lucide-react';
import type { AppSettings, PulseHabitState, SubjectTargets, SyncStatus } from '../types';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { ACS, SUB_COLORS, logicalKey, pad, parseKey } from '../utils/studyLogic';
import { UI_ACCENT_SWATCHES, getTimerStyleDisplayLabel, resolveUiExam } from '../utils/uiHelpers';
import {
  XP_V2_PLAIN_RULES,
  computeDayXpBreakdown,
  computeLevelInfo,
  computeTotalXp,
} from '../utils/xp';
import {
  Button,
  Card,
  EmptyState,
  Field,
  ListGroup,
  ListRow,
  Meter,
  Segmented,
  Select,
  type SelectOption,
  Stat,
  Switch,
} from './ui';

export type SettingsSection =
  | 'profile'
  | 'sync'
  | 'study'
  | 'targets'
  | 'exams'
  | 'subjects'
  | 'habits'
  | 'appearance'
  | 'notifications'
  | 'data'
  | 'about';

export interface SettingsViewProps {
  state: PulseHabitState;
  activeSection?: SettingsSection | null;
  onChangeSection?: (section: SettingsSection | null) => void;
  amoled?: boolean;
  onToggleAmoled?: (enabled: boolean) => void;
  onNewHabit: () => void;
  onEditHabit: (id: string) => void;
  onOpenManualSession: () => void;
  onNewDDay?: () => void;
  onEditDDay?: (id: string) => void;
  onAddSubject?: (name: string, emoji: string, color: string) => void;
  onUpdateSubject?: (
    subjectId: string,
    patch: { name: string; e: string; color: string }
  ) => void;
  onDeleteSubject?: (subjectId: string) => void;
  onUpdateSetting: <K extends keyof AppSettings>(key: K, val: AppSettings[K]) => void;
  onUpdateTargets?: (patch: Partial<SubjectTargets>) => void;
  onSelectAvatarEmoji?: (emoji: string) => void;
  onExportJson: () => void;
  onExportCsv: () => void;
  onImportJson: (file: File) => void;
  onRequestReset: () => void;
  cloudUser?: { uid: string; displayName: string | null; email: string | null } | null;
  authUser?: { uid: string; displayName: string | null; email: string | null } | null;
  syncStatus?: SyncStatus;
  syncErrorMsg?: string | null;
  lastSyncedAt?: number;
  dailyWritesUsed?: number;
  dailyWriteCap?: number;
  syncWritesToday?: number;
  isOnline?: boolean;
  onSignInGoogle?: () => void;
  onSignOutGoogle?: () => void;
  onSyncNow?: () => void;
  onDeleteCloudData?: () => void;
  todayKey?: string;
  onOpenProfileModal?: () => void;
}

const AVATAR_EMOJIS = ['🧑‍⚕️', '🩺', '🧬', '⚡', '🦁', '🎯', '🚀', '🦉'];

const COLOR_NAME_MAP: Record<string, string> = {
  '#F5C451': 'Lumen Gold',
  '#38BDF8': 'Sky Blue',
  '#38bdf8': 'Sky Blue',
  '#34D399': 'Mint Green',
  '#34d399': 'Mint Green',
  '#6366F1': 'Indigo',
  '#6366f1': 'Indigo',
  '#A78BFA': 'Violet',
  '#a78bfa': 'Violet',
  '#F472B6': 'Rose Pink',
  '#f472b6': 'Rose Pink',
  '#FBBF24': 'Amber',
  '#fbbf24': 'Amber',
  '#3B82F6': 'Ocean Blue',
  '#3b82f6': 'Ocean Blue',
  '#10B981': 'Emerald',
  '#10b981': 'Emerald',
  '#F59E0B': 'Warm Amber',
  '#f59e0b': 'Warm Amber',
  '#8B5CF6': 'Royal Violet',
  '#8b5cf6': 'Royal Violet',
  '#EC4899': 'Magenta Rose',
  '#ec4899': 'Magenta Rose',
  '#14B8A6': 'Teal',
  '#14b8a6': 'Teal',
};

const ALL_SUBJECT_COLORS = Array.from(new Set([...SUB_COLORS, ...ACS]));

const SUBJECT_COLOR_SELECT_OPTIONS: SelectOption<string>[] = ALL_SUBJECT_COLORS.map((hex) => ({
  value: hex,
  label: COLOR_NAME_MAP[hex] || COLOR_NAME_MAP[hex.toUpperCase()] || `Color ${hex.toUpperCase()}`,
  subtitle: hex.toUpperCase(),
  swatchColor: hex,
}));

const DAY_RESET_OPTIONS: SelectOption<string>[] = [0, 1, 2, 3, 4, 5, 6].map((h) => ({
  value: String(h),
  label: h === 0 ? '00:00 (Midnight)' : `${pad(h)}:00 AM`,
  subtitle:
    h === 0
      ? 'Calendar midnight boundary'
      : `Sessions between 00:00 and ${pad(h)}:00 count toward previous day`,
}));

const SECTION_META: Record<
  SettingsSection,
  { title: string; subtitle: string }
> = {
  profile: {
    title: 'Profile and level',
    subtitle: 'Avatar, study identity, and XP breakdown',
  },
  sync: {
    title: 'Account and cloud sync',
    subtitle: 'Google backup, sync quota, and privacy controls',
  },
  study: {
    title: 'Study preferences',
    subtitle: 'Day reset hour, week start, timer style, and PiP engine',
  },
  targets: {
    title: 'Goals and targets',
    subtitle: 'Daily minimum, mock duration, revision intervals, and subject quotas',
  },
  exams: {
    title: 'Exams',
    subtitle: 'Manage D-Day countdowns and your primary exam target',
  },
  subjects: {
    title: 'Subjects',
    subtitle: 'Customize active subjects, icons, and accent colors',
  },
  habits: {
    title: 'Habits',
    subtitle: 'Create, edit, and organize daily or auto-synced habits',
  },
  appearance: {
    title: 'Appearance',
    subtitle: 'Theme, AMOLED black, accent color, and 3D depth',
  },
  notifications: {
    title: 'Notifications and sound',
    subtitle: 'Chimes, haptics, reminders, and app install',
  },
  data: {
    title: 'Data and backup',
    subtitle: 'Export JSON/CSV, restore backups, or reset device storage',
  },
  about: {
    title: 'About Deep Hours',
    subtitle: 'Version info and offline storage details',
  },
};

export const SettingsView: React.FC<SettingsViewProps> = ({
  state,
  activeSection: controlledSection,
  onChangeSection,
  amoled = false,
  onToggleAmoled,
  onNewHabit,
  onEditHabit,
  onNewDDay,
  onEditDDay,
  onAddSubject,
  onUpdateSubject,
  onDeleteSubject,
  onUpdateSetting,
  onSelectAvatarEmoji,
  onExportJson,
  onExportCsv,
  onImportJson,
  onRequestReset,
  cloudUser: cloudUserProp,
  authUser,
  syncStatus = 'off',
  syncErrorMsg,
  lastSyncedAt,
  dailyWritesUsed: dailyWritesUsedProp,
  dailyWriteCap = 150,
  syncWritesToday,
  isOnline = true,
  onSignInGoogle,
  onSignOutGoogle,
  onSyncNow,
  onDeleteCloudData,
  todayKey: todayKeyProp,
  onOpenProfileModal,
}) => {
  const [internalSection, setInternalSection] = useState<SettingsSection | null>(null);
  const activeSection =
    controlledSection !== undefined ? controlledSection : internalSection;
  const setSection = (next: SettingsSection | null) => {
    if (onChangeSection) onChangeSection(next);
    else setInternalSection(next);
    window.scrollTo(0, 0);
  };

  const effectiveTodayKey =
    todayKeyProp || logicalKey(new Date(), state.set?.dayResetHour ?? 0);
  const todayBreakdown = useMemo(
    () => computeDayXpBreakdown(state, effectiveTodayKey),
    [state, effectiveTodayKey]
  );
  const totalXp = useMemo(
    () => computeTotalXp(state, effectiveTodayKey),
    [state, effectiveTodayKey]
  );
  const levelInfo = useMemo(() => computeLevelInfo(totalXp), [totalXp]);
  const resolvedExam = useMemo(
    () => resolveUiExam(state, effectiveTodayKey),
    [state, effectiveTodayKey]
  );

  const cloudUser = cloudUserProp ?? authUser ?? null;
  const dailyWritesUsed = dailyWritesUsedProp ?? syncWritesToday ?? 0;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [newSubName, setNewSubName] = useState('');
  const [newSubEmoji, setNewSubEmoji] = useState('📘');
  const [newSubColor, setNewSubColor] = useState(ALL_SUBJECT_COLORS[0]);
  const [editingSubId, setEditingSubId] = useState<string | null>(null);
  const [editSubName, setEditSubName] = useState('');
  const [editSubEmoji, setEditSubEmoji] = useState('📘');
  const [editSubColor, setEditSubColor] = useState(ALL_SUBJECT_COLORS[0]);
  const [confirmDeleteCloud, setConfirmDeleteCloud] = useState(false);
  const revisionIntervalsStr = (state.set.revisionIntervals || [1, 3, 7, 21]).join(', ');
  const [intervalsInput, setIntervalsInput] = useState(revisionIntervalsStr);
  useEffect(() => {
    setIntervalsInput(revisionIntervalsStr);
  }, [revisionIntervalsStr]);

  const set = state.set;
  const activeSubjects = state.subjects.filter((s) => !s.arch);
  const targets = set.targets || {
    dailyMinutes: {},
    weeklyMinutes: {},
    minDayMinutes: 240,
    restPassesPerMonth: 4,
  };
  const currentAvatar = set.cloudAccount?.avatarEmoji || set.avatarEmoji || '🧑‍⚕️';
  const currentAccentSwatch = UI_ACCENT_SWATCHES.find(
    (sw) => sw.hex.toLowerCase() === (set.ac || '').toLowerCase()
  );

  const handleAvatarChange = (emoji: string) => {
    onSelectAvatarEmoji?.(emoji);
    onUpdateSetting('cloudAccount', {
      ...(set.cloudAccount || {}),
      avatarEmoji: emoji,
    });
  };

  const handleSubjectTargetChange = (
    subjectId: string,
    kind: 'dailyMinutes' | 'weeklyMinutes',
    mins: number
  ) => {
    const cleanMins = Math.max(0, Math.min(10080, Math.floor(mins || 0)));
    onUpdateSetting('targets', {
      ...targets,
      [kind]: {
        ...(targets[kind] || {}),
        [subjectId]: cleanMins,
      },
    });
  };

  const syncStatusLabel = !isOnline
    ? 'Offline'
    : syncStatus === 'syncing'
      ? 'Syncing...'
      : syncStatus === 'paused-quota'
        ? 'Paused (daily quota)'
        : syncStatus === 'error'
          ? 'Sync error'
          : cloudUser
            ? 'Connected'
            : 'Local only';

  const currentTimerStyleLabel = getTimerStyleDisplayLabel(set.timerAesthetic);
  const currentUi3d = set.ui3d || 'auto';

  if (!activeSection) {
    return (
      <div style={{ display: 'grid', gap: '20px' }}>
        <ListGroup aria-label="Profile and sync settings">
          <ListRow
            leading={<User size={20} strokeWidth={1.75} aria-hidden="true" />}
            title="Profile and level"
            subtitle={
              state.profile?.nick
                ? `${state.profile.nick} · Level ${levelInfo.level} · ${totalXp.toLocaleString()} XP`
                : `Level ${levelInfo.level} · ${totalXp.toLocaleString()} XP`
            }
            trailing={<span style={{ fontSize: '20px' }}>{currentAvatar}</span>}
            chevron
            onClick={() => setSection('profile')}
          />
          <ListRow
            leading={<Cloud size={20} strokeWidth={1.75} aria-hidden="true" />}
            title="Account and cloud sync"
            subtitle={
              cloudUser
                ? `${cloudUser.email || cloudUser.displayName || 'Google Account'} · ${dailyWritesUsed}/${dailyWriteCap} writes`
                : 'Local-only mode · Sign in to sync across devices'
            }
            trailing={syncStatusLabel}
            chevron
            onClick={() => setSection('sync')}
          />
        </ListGroup>

        <ListGroup aria-label="Study configuration">
          <ListRow
            leading={<Sliders size={20} strokeWidth={1.75} aria-hidden="true" />}
            title="Study"
            subtitle={`Reset ${pad(set.dayResetHour ?? 0)}:00 · ${currentTimerStyleLabel} timer · ${set.pipPref === 'doc' ? 'Document PiP' : 'Video PiP'}`}
            chevron
            onClick={() => setSection('study')}
          />
          <ListRow
            leading={<Target size={20} strokeWidth={1.75} aria-hidden="true" />}
            title="Goals and targets"
            subtitle={`Min ${targets.minDayMinutes ?? 240}m/day · Full mock ${set.fullMockMins ?? 180}m · Target ${set.targetMockScore ?? 650}`}
            chevron
            onClick={() => setSection('targets')}
          />
          <ListRow
            leading={<Calendar size={20} strokeWidth={1.75} aria-hidden="true" />}
            title="Exams"
            subtitle={
              resolvedExam
                ? `${resolvedExam.title} (${resolvedExam.date})`
                : `${state.ddays.length} exam countdowns`
            }
            trailing={String(state.ddays.length)}
            chevron
            onClick={() => setSection('exams')}
          />
          <ListRow
            leading={<BookOpen size={20} strokeWidth={1.75} aria-hidden="true" />}
            title="Subjects"
            subtitle={`${activeSubjects.length} active subjects`}
            chevron
            onClick={() => setSection('subjects')}
          />
          <ListRow
            leading={<Repeat size={20} strokeWidth={1.75} aria-hidden="true" />}
            title="Habits"
            subtitle={`${state.habits.filter((h) => !h.arch).length} active habits`}
            chevron
            onClick={() => setSection('habits')}
          />
        </ListGroup>

        <ListGroup aria-label="Appearance, alerts, and data">
          <ListRow
            leading={<Palette size={20} strokeWidth={1.75} aria-hidden="true" />}
            title="Appearance"
            subtitle={`${set.theme[0].toUpperCase() + set.theme.slice(1)}${amoled ? ' · AMOLED' : ''} · ${currentAccentSwatch?.label || 'Custom'} · 3D ${currentUi3d}`}
            chevron
            onClick={() => setSection('appearance')}
          />
          <ListRow
            leading={<Bell size={20} strokeWidth={1.75} aria-hidden="true" />}
            title="Notifications and sound"
            subtitle={`${set.snd ? 'Sounds on' : 'Muted'} · ${set.notif ? 'Reminders on' : 'Reminders off'}`}
            chevron
            onClick={() => setSection('notifications')}
          />
          <ListRow
            leading={<Database size={20} strokeWidth={1.75} aria-hidden="true" />}
            title="Data"
            subtitle={
              state.exp
                ? `Last backup ${new Date(state.exp).toLocaleDateString()}`
                : 'JSON and CSV export, restore, reset'
            }
            chevron
            onClick={() => setSection('data')}
          />
          <ListRow
            leading={<Info size={20} strokeWidth={1.75} aria-hidden="true" />}
            title="About"
            subtitle="Offline storage architecture and quick actions guide"
            chevron
            onClick={() => setSection('about')}
          />
        </ListGroup>
      </div>
    );
  }

  const meta = SECTION_META[activeSection];

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      {/* Sub-view Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          paddingBottom: '4px',
        }}
      >
        <Button
          variant="secondary"
          size="md"
          onClick={() => setSection(null)}
          aria-label="Back to settings"
        >
          <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
          Settings
        </Button>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>{meta.title}</h2>
          <div style={{ fontSize: '13px', color: 'var(--tx-2)' }}>{meta.subtitle}</div>
        </div>
      </div>

      {/* 1. Profile and level */}
      {activeSection === 'profile' && (
        <div style={{ display: 'grid', gap: '14px' }}>
          <Card style={{ margin: 0, display: 'grid', gap: '14px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '14px',
                    background: 'var(--sf-2)',
                    border: '1px solid var(--line)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '24px',
                    flexShrink: 0,
                  }}
                >
                  {state.profile?.emoji || currentAvatar}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '16px', fontWeight: 600 }}>
                    {state.profile?.nick || 'Anonymous profile not set'}
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--tx-2)' }}>
                    {state.profile?.examYear
                      ? `NEET ${state.profile.examYear} · Used only in Community`
                      : 'Used only in Community · Never shares your Google name or email'}
                  </div>
                </div>
              </div>
              {onOpenProfileModal && (
                <Button variant="secondary" onClick={onOpenProfileModal}>
                  Edit study profile
                </Button>
              )}
            </div>

            <Field label="Header avatar emoji">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {AVATAR_EMOJIS.map((em) => {
                  const selected = currentAvatar === em;
                  return (
                    <button
                      key={em}
                      type="button"
                      aria-label={`Choose avatar ${em}`}
                      aria-pressed={selected}
                      onClick={() => handleAvatarChange(em)}
                      style={{
                        width: '44px',
                        height: '44px',
                        minWidth: '44px',
                        minHeight: '44px',
                        padding: 0,
                        fontSize: '20px',
                        borderRadius: '12px',
                        background: selected ? 'var(--ac-soft)' : 'var(--sf-2)',
                        border: selected ? '1px solid var(--ac)' : '1px solid var(--line)',
                      }}
                    >
                      {em}
                    </button>
                  );
                })}
              </div>
            </Field>
          </Card>

          <Card style={{ margin: 0, display: 'grid', gap: '12px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div style={{ fontSize: '16px', fontWeight: 600 }}>
                  Level {levelInfo.level} · {totalXp.toLocaleString()} XP
                </div>
                <div style={{ fontSize: '13px', color: 'var(--tx-2)' }}>
                  {levelInfo.xpRemainingToNext.toLocaleString()} XP to Level {levelInfo.level + 1} (
                  {levelInfo.progressPct}%)
                </div>
              </div>
              <span className="dh-chip active tabular-nums">Today: +{todayBreakdown.total} XP</span>
            </div>

            <Meter
              value={levelInfo.xpIntoLevel}
              max={levelInfo.xpNeededForNext || 150}
              color="var(--ac)"
              label="XP level progress"
            />

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {[
                { label: 'Timer study', val: todayBreakdown.study },
                { label: 'Focus bonus', val: todayBreakdown.focusBonus },
                { label: 'Daily min', val: todayBreakdown.minDayBonus },
                { label: 'Streak bonus', val: todayBreakdown.streakBonus },
                { label: 'Revisions', val: todayBreakdown.revisions },
                { label: 'Chapters', val: todayBreakdown.chapters },
                { label: 'Mocks', val: todayBreakdown.mocks },
                { label: 'Tasks', val: todayBreakdown.tasks },
                { label: 'Habits', val: todayBreakdown.habits },
              ].map((cat) => (
                <Stat
                  key={cat.label}
                  label={cat.label}
                  value={`+${cat.val} XP`}
                  tone={cat.val > 0 ? 'accent' : 'default'}
                />
              ))}
            </div>

            <div style={{ borderTop: '1px solid var(--line)', paddingTop: '12px', display: 'grid', gap: '6px' }}>
              <div style={{ fontSize: '14px', fontWeight: 600 }}>How XP works</div>
              {XP_V2_PLAIN_RULES.map((item) => (
                <div key={item.label} style={{ fontSize: '13px', color: 'var(--tx-2)', lineHeight: 1.45 }}>
                  <strong style={{ color: 'var(--tx)' }}>{item.label}:</strong> {item.rule}
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* 2. Account and cloud sync */}
      {activeSection === 'sync' && (
        <Card style={{ margin: 0, display: 'grid', gap: '14px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '16px', fontWeight: 600 }}>
                {cloudUser
                  ? cloudUser.displayName || cloudUser.email || 'Signed-in account'
                  : 'Local-only mode'}
              </div>
              <div style={{ fontSize: '13px', color: 'var(--tx-2)' }}>
                {cloudUser
                  ? cloudUser.email || 'Google account connected'
                  : 'Everything works offline. Sign in to sync across devices.'}
              </div>
            </div>
            <span className="dh-status-pill">{syncStatusLabel}</span>
          </div>

          {syncStatus === 'paused-quota' && (
            <div
              role="status"
              style={{
                padding: '12px',
                borderRadius: '12px',
                background: 'color-mix(in srgb, var(--warn) 12%, transparent)',
                border: '1px solid color-mix(in srgb, var(--warn) 40%, transparent)',
                fontSize: '13px',
                color: 'var(--warn-ink)',
                lineHeight: 1.45,
              }}
            >
              Cloud sync is paused for today to stay safely within the daily quota. Changes
              are saved locally and will sync automatically tomorrow.
            </div>
          )}

          {syncErrorMsg && syncStatus === 'error' && (
            <div
              role="alert"
              style={{
                fontSize: '13px',
                color: 'var(--err-ink)',
                fontWeight: 600,
              }}
            >
              Sync notice: {syncErrorMsg} (Your data remains safe on this device.)
            </div>
          )}

          {cloudUser ? (
            <>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  gap: '10px',
                }}
              >
                <Stat
                  label="Last synced"
                  value={
                    lastSyncedAt
                      ? new Date(lastSyncedAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : 'Not yet'
                  }
                />
                <Stat
                  label="Daily writes"
                  value={`${dailyWritesUsed} / ${dailyWriteCap}`}
                  tone="ok"
                />
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                <Button
                  variant="primary"
                  disabled={!isOnline || syncStatus === 'syncing' || syncStatus === 'paused-quota'}
                  onClick={onSyncNow}
                >
                  {syncStatus === 'syncing' ? 'Syncing...' : 'Sync now'}
                </Button>
                <Button variant="secondary" onClick={onExportJson}>
                  Download backup
                </Button>
                <Button variant="secondary" onClick={onSignOutGoogle}>
                  Sign out
                </Button>
              </div>

              {!confirmDeleteCloud ? (
                <div>
                  <Button
                    variant="danger"
                    onClick={() => setConfirmDeleteCloud(true)}
                  >
                    Delete my cloud data
                  </Button>
                </div>
              ) : (
                <div
                  style={{
                    padding: '12px',
                    borderRadius: '12px',
                    background: 'color-mix(in srgb, var(--err) 10%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--err) 38%, transparent)',
                    display: 'grid',
                    gap: '10px',
                  }}
                >
                  <div style={{ fontSize: '13px', color: 'var(--err-ink)', fontWeight: 600 }}>
                    Delete all synced data from the cloud? Your local device data will remain untouched.
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <Button
                      variant="danger"
                      onClick={() => {
                        setConfirmDeleteCloud(false);
                        onDeleteCloudData?.();
                      }}
                    >
                      Yes, delete cloud data
                    </Button>
                    <Button variant="secondary" onClick={() => setConfirmDeleteCloud(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              <Button variant="primary" onClick={onSignInGoogle}>
                Sign in with Google
              </Button>
              <Button variant="secondary" onClick={onExportJson}>
                Download backup
              </Button>
            </div>
          )}

          <p
            style={{
              margin: 0,
              paddingTop: '10px',
              borderTop: '1px solid var(--line)',
              fontSize: '12px',
              lineHeight: 1.5,
              color: 'var(--tx-2)',
            }}
          >
            Automatic sync saves changes locally first (IndexedDB and localStorage) and syncs
            to your private cloud folder (<code>users/&#123;uid&#125;</code>) when signed in.
            Deleting your cloud data removes your group entries and closes any groups you own.
          </p>
        </Card>
      )}

      {/* 3. Study */}
      {activeSection === 'study' && (
        <Card style={{ margin: 0, display: 'grid', gap: '16px' }}>
          <Field
            label="Day-reset hour"
            hint="Sessions started before this hour count toward the previous study day."
          >
            <Select
              aria-label="Day-reset hour"
              title="Day-reset hour"
              value={String(set.dayResetHour ?? 0)}
              options={DAY_RESET_OPTIONS}
              onChange={(val) => onUpdateSetting('dayResetHour', Number(val))}
            />
          </Field>

          <Field label="Week starts on">
            <Segmented<'1' | '0'>
              aria-label="Week starts on"
              value={String(set.ws ?? 1) === '0' ? '0' : '1'}
              options={[
                { value: '1', label: 'Monday' },
                { value: '0', label: 'Sunday' },
              ]}
              onChange={(val) => onUpdateSetting('ws', Number(val))}
            />
          </Field>

          <Field
            label="Timer style"
            hint="Controls the Focus clock face and floating Picture-in-Picture dial."
          >
            <Segmented<'neon' | 'minimal' | 'retro'>
              aria-label="Timer style"
              value={set.timerAesthetic || 'neon'}
              options={[
                { value: 'neon', label: 'Digital' },
                { value: 'minimal', label: 'Mono' },
                { value: 'retro', label: 'Analog' },
              ]}
              onChange={(val) => onUpdateSetting('timerAesthetic', val)}
            />
          </Field>

          <Field
            label="Floating Picture-in-Picture engine"
            hint="Video works across Android Chrome and desktop; Document provides an interactive mini window on desktop."
          >
            <Segmented<'video' | 'doc'>
              aria-label="Floating PiP engine"
              value={set.pipPref || 'video'}
              options={[
                { value: 'video', label: 'Video (Universal)' },
                { value: 'doc', label: 'Document (Desktop)' },
              ]}
              onChange={(val) => onUpdateSetting('pipPref', val)}
            />
          </Field>
        </Card>
      )}

      {/* 4. Goals and targets */}
      {activeSection === 'targets' && (
        <Card style={{ margin: 0, display: 'grid', gap: '14px' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: '10px',
            }}
          >
            <Field label="Min study day (mins)" htmlFor="setMinDayMins">
              <input
                id="setMinDayMins"
                type="number"
                min={15}
                max={960}
                value={targets.minDayMinutes ?? 240}
                onChange={(e) =>
                  onUpdateSetting('targets', {
                    ...targets,
                    minDayMinutes: Math.max(15, Math.min(960, Number(e.target.value) || 240)),
                  })
                }
              />
            </Field>
            <Field label="Rest passes / month" htmlFor="setRestPasses">
              <input
                id="setRestPasses"
                type="number"
                min={0}
                max={15}
                value={targets.restPassesPerMonth ?? 4}
                onChange={(e) =>
                  onUpdateSetting('targets', {
                    ...targets,
                    restPassesPerMonth: Math.max(0, Math.min(15, Number(e.target.value) || 0)),
                  })
                }
              />
            </Field>
            <Field label="Revision buffer (days before exam)" htmlFor="setRevBuffer">
              <input
                id="setRevBuffer"
                type="number"
                min={0}
                max={180}
                value={set.revisionBufferDays ?? 30}
                onChange={(e) =>
                  onUpdateSetting(
                    'revisionBufferDays',
                    Math.max(0, Math.min(180, Number(e.target.value) || 0))
                  )
                }
              />
            </Field>
            <Field label="Full mock duration (mins)" htmlFor="setFullMockMins">
              <input
                id="setFullMockMins"
                type="number"
                min={30}
                max={360}
                value={set.fullMockMins ?? 180}
                onChange={(e) =>
                  onUpdateSetting(
                    'fullMockMins',
                    Math.max(30, Math.min(360, Number(e.target.value) || 180))
                  )
                }
              />
            </Field>
            <Field label="Target mock score" htmlFor="setTargetMockScore">
              <input
                id="setTargetMockScore"
                type="number"
                min={0}
                max={720}
                value={set.targetMockScore ?? 650}
                onChange={(e) =>
                  onUpdateSetting(
                    'targetMockScore',
                    Math.max(0, Math.min(720, Number(e.target.value) || 0))
                  )
                }
              />
            </Field>
          </div>

          <Field
            label="Suggested revision intervals (days after completion)"
            htmlFor="setRevIntervals"
          >
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                id="setRevIntervals"
                type="text"
                value={intervalsInput}
                onChange={(e) => setIntervalsInput(e.target.value)}
                placeholder="1, 3, 7, 21"
                style={{ flex: 1, minWidth: 0 }}
              />
              <Button
                variant="primary"
                onClick={() => {
                  const parsed = intervalsInput
                    .split(',')
                    .map((s) => Math.floor(Number(s.trim())))
                    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 365);
                  const finalIntervals = parsed.length > 0 ? parsed : [1, 3, 7, 21];
                  setIntervalsInput(finalIntervals.join(', '));
                  onUpdateSetting('revisionIntervals', finalIntervals);
                }}
              >
                Save
              </Button>
            </div>
          </Field>

          <div style={{ borderTop: '1px solid var(--line)', paddingTop: '12px', display: 'grid', gap: '8px' }}>
            <div style={{ fontSize: '14px', fontWeight: 600 }}>
              Subject targets (daily &amp; weekly minutes)
            </div>
            {activeSubjects.map((sub) => (
              <div
                key={sub.id}
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                  padding: '10px 12px',
                  borderRadius: '12px',
                  background: 'var(--sf-2)',
                  border: '1px solid var(--line)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '140px' }}>
                  <span
                    aria-hidden="true"
                    style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '99px',
                      background: sub.color,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: '14px', fontWeight: 600 }}>
                    {sub.e} {sub.name}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '8px', flex: '0 1 auto' }}>
                  <label style={{ fontSize: '12px', color: 'var(--tx-2)', width: '96px', margin: 0 }}>
                    Daily (m)
                    <input
                      type="number"
                      min={0}
                      max={720}
                      step={15}
                      value={targets.dailyMinutes?.[sub.id] ?? 0}
                      onChange={(e) =>
                        handleSubjectTargetChange(sub.id, 'dailyMinutes', Number(e.target.value))
                      }
                      style={{ marginTop: '4px', padding: '6px 8px', minHeight: '38px' }}
                    />
                  </label>
                  <label style={{ fontSize: '12px', color: 'var(--tx-2)', width: '96px', margin: 0 }}>
                    Weekly (m)
                    <input
                      type="number"
                      min={0}
                      max={5040}
                      step={30}
                      value={targets.weeklyMinutes?.[sub.id] ?? 0}
                      onChange={(e) =>
                        handleSubjectTargetChange(sub.id, 'weeklyMinutes', Number(e.target.value))
                      }
                      style={{ marginTop: '4px', padding: '6px 8px', minHeight: '38px' }}
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 5. Exams */}
      {activeSection === 'exams' && (
        <div style={{ display: 'grid', gap: '12px' }}>
          {onNewDDay && (
            <Button variant="primary" size="lg" fullWidth onClick={onNewDDay}>
              + Add exam countdown
            </Button>
          )}
          {state.ddays.length === 0 ? (
            <EmptyState
              icon={<Calendar size={24} strokeWidth={1.75} />}
              title="No exam dates yet"
              description="Add your NEET exam or mock target date to enable Syllabus Pace and countdown cards."
              action={
                onNewDDay ? (
                  <Button variant="primary" onClick={onNewDDay}>
                    Add exam countdown
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ListGroup>
              {state.ddays.map((d) => {
                const diff = Math.round(
                  (parseKey(d.date).getTime() - parseKey(effectiveTodayKey).getTime()) / 86400000
                );
                const badge =
                  diff === 0 ? 'D-Day' : diff > 0 ? `D-${diff}` : `D+${Math.abs(diff)}`;
                const isUsedForPace = resolvedExam?.id === d.id;
                return (
                  <ListRow
                    key={d.id}
                    leading={
                      <span
                        aria-hidden="true"
                        style={{
                          width: '12px',
                          height: '12px',
                          borderRadius: '99px',
                          background: d.color || 'var(--ac)',
                        }}
                      />
                    }
                    title={`${d.e || '🎯'} ${d.title}`}
                    subtitle={
                      `${d.date}` +
                      (d.primary
                        ? ' · Primary exam'
                        : isUsedForPace
                          ? ' · Active pace target'
                          : '')
                    }
                    trailing={<span className="tabular-nums" style={{ fontWeight: 600 }}>{badge}</span>}
                    chevron
                    onClick={() => onEditDDay?.(d.id)}
                  />
                );
              })}
            </ListGroup>
          )}
        </div>
      )}

      {/* 6. Subjects */}
      {activeSection === 'subjects' && (
        <Card style={{ margin: 0, display: 'grid', gap: '10px' }}>
          {activeSubjects.map((sub) =>
            editingSubId === sub.id ? (
              <form
                key={sub.id}
                style={{
                  padding: '12px',
                  borderRadius: '12px',
                  background: 'var(--sf-2)',
                  border: '1px solid var(--line)',
                  display: 'grid',
                  gap: '10px',
                }}
                onSubmit={(e) => {
                  e.preventDefault();
                  const clean = editSubName.trim();
                  if (!clean || !onUpdateSubject) return;
                  onUpdateSubject(sub.id, {
                    name: clean,
                    e: editSubEmoji.trim() || '📘',
                    color: editSubColor,
                  });
                  setEditingSubId(null);
                }}
              >
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    value={editSubEmoji}
                    onChange={(e) => setEditSubEmoji(e.target.value)}
                    style={{ width: '56px', textAlign: 'center', flexShrink: 0 }}
                    maxLength={4}
                    aria-label={`Edit emoji for ${sub.name}`}
                  />
                  <input
                    type="text"
                    value={editSubName}
                    onChange={(e) => setEditSubName(e.target.value)}
                    placeholder="Subject name..."
                    style={{ flex: 1, minWidth: 0 }}
                    maxLength={40}
                    aria-label={`Edit name for ${sub.name}`}
                  />
                </div>
                <Select
                  aria-label={`Edit color for ${sub.name}`}
                  title="Subject accent color"
                  value={editSubColor}
                  options={SUBJECT_COLOR_SELECT_OPTIONS}
                  onChange={setEditSubColor}
                />
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <Button variant="secondary" onClick={() => setEditingSubId(null)}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="primary" aria-label={`Save subject ${sub.name}`}>
                    Save
                  </Button>
                </div>
              </form>
            ) : (
              <div
                key={sub.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                  padding: '10px 12px',
                  borderRadius: '12px',
                  background: 'var(--sf-2)',
                  border: '1px solid var(--line)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  <span
                    aria-hidden="true"
                    style={{
                      width: '12px',
                      height: '12px',
                      borderRadius: '99px',
                      background: sub.color,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: '15px', fontWeight: 600, minWidth: 0 }}>
                    {sub.e} {sub.name}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                  {onUpdateSubject && (
                    <Button
                      variant="secondary"
                      aria-label={`Edit subject ${sub.name}`}
                      onClick={() => {
                        setEditingSubId(sub.id);
                        setEditSubName(sub.name);
                        setEditSubEmoji(sub.e || '📘');
                        setEditSubColor(sub.color || ALL_SUBJECT_COLORS[0]);
                      }}
                    >
                      Edit
                    </Button>
                  )}
                  {onDeleteSubject && activeSubjects.length > 1 && (
                    <Button
                      variant="danger"
                      aria-label={`Delete subject ${sub.name}`}
                      onClick={() => {
                        if (editingSubId === sub.id) setEditingSubId(null);
                        onDeleteSubject(sub.id);
                      }}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            )
          )}

          {onAddSubject && (
            <form
              style={{
                borderTop: '1px solid var(--line)',
                paddingTop: '12px',
                marginTop: '4px',
                display: 'grid',
                gap: '10px',
              }}
              onSubmit={(e) => {
                e.preventDefault();
                const clean = newSubName.trim();
                if (!clean) return;
                onAddSubject(clean, newSubEmoji.trim() || '📘', newSubColor);
                setNewSubName('');
              }}
            >
              <div style={{ fontSize: '14px', fontWeight: 600 }}>Add subject</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  value={newSubEmoji}
                  onChange={(e) => setNewSubEmoji(e.target.value)}
                  style={{ width: '56px', textAlign: 'center', flexShrink: 0 }}
                  maxLength={4}
                  aria-label="New subject emoji"
                />
                <input
                  type="text"
                  value={newSubName}
                  onChange={(e) => setNewSubName(e.target.value)}
                  placeholder="New subject name..."
                  style={{ flex: 1, minWidth: 0 }}
                  maxLength={40}
                  aria-label="New subject name"
                />
              </div>
              <Select
                aria-label="New subject color"
                title="New subject color"
                value={newSubColor}
                options={SUBJECT_COLOR_SELECT_OPTIONS}
                onChange={setNewSubColor}
              />
              <Button type="submit" variant="primary">
                + Add subject
              </Button>
            </form>
          )}
        </Card>
      )}

      {/* 7. Habits */}
      {activeSection === 'habits' && (
        <div style={{ display: 'grid', gap: '12px' }}>
          <Button variant="primary" size="lg" fullWidth onClick={onNewHabit}>
            + New habit
          </Button>
          {state.habits.length === 0 ? (
            <EmptyState
              icon={<Repeat size={24} strokeWidth={1.75} />}
              title="No habits yet"
              description="Add a daily habit or an auto-completed study habit tracked from your Focus timer."
              action={
                <Button variant="primary" onClick={onNewHabit}>
                  Create habit
                </Button>
              }
            />
          ) : (
            <ListGroup>
              {state.habits.map((h) => {
                const sub =
                  h.subjectId && h.subjectId !== 'any'
                    ? state.subjects.find((s) => s.id === h.subjectId)
                    : null;
                const autoLabel =
                  h.subjectId || h.autoMins
                    ? ` · Auto from timer (${sub ? sub.name : 'All subjects'})`
                    : '';
                return (
                  <ListRow
                    key={h.id}
                    leading={<span style={{ fontSize: '20px' }}>{h.e}</span>}
                    title={h.name}
                    subtitle={`${h.c} · ${h.sch === 'week' ? `${h.n}×/wk` : 'Daily'}${autoLabel}${h.arch ? ' · Archived' : ''}`}
                    trailing="Edit"
                    chevron
                    onClick={() => onEditHabit(h.id)}
                  />
                );
              })}
            </ListGroup>
          )}
        </div>
      )}

      {/* 8. Appearance */}
      {activeSection === 'appearance' && (
        <Card style={{ margin: 0, display: 'grid', gap: '16px' }}>
          <Field label="Theme">
            <Segmented<'auto' | 'dark' | 'light'>
              aria-label="Theme"
              value={set.theme}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' },
              ]}
              onChange={(val) => onUpdateSetting('theme', val)}
            />
          </Field>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              padding: '10px 12px',
              borderRadius: '12px',
              background: 'var(--sf-2)',
              border: '1px solid var(--line)',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '14px', fontWeight: 600 }}>AMOLED true black</div>
              <div style={{ fontSize: '12px', color: 'var(--tx-2)' }}>
                Pure #000000 background on dark theme for OLED displays
              </div>
            </div>
            <Switch
              aria-label="AMOLED true black"
              checked={amoled}
              onChange={(checked) => onToggleAmoled?.(checked)}
            />
          </div>

          <Field label="Accent color">
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))',
                gap: '8px',
              }}
            >
              {UI_ACCENT_SWATCHES.map((sw) => {
                const customAcSet =
                  typeof window !== 'undefined' &&
                  window.localStorage.getItem('dh_custom_ac') === '1';
                const effectiveAc =
                  !set.ac || (set.ac.toLowerCase() === '#38bdf8' && !customAcSet)
                    ? '#F5C451'
                    : set.ac;
                const isSelected =
                  effectiveAc.toLowerCase() === sw.hex.toLowerCase();
                return (
                  <button
                    key={sw.hex}
                    type="button"
                    aria-label={`Accent ${sw.label}`}
                    aria-pressed={isSelected}
                    onClick={() => {
                      try {
                        window.localStorage.setItem('dh_custom_ac', '1');
                      } catch {
                        // ignore storage quota errors
                      }
                      onUpdateSetting('ac', sw.hex);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px 10px',
                      minHeight: '44px',
                      borderRadius: '12px',
                      background: isSelected ? 'var(--ac-soft)' : 'var(--sf-2)',
                      border: isSelected ? '1px solid var(--ac)' : '1px solid var(--line)',
                      color: isSelected ? 'var(--ac-ink)' : 'var(--tx)',
                      fontSize: '13px',
                      fontWeight: 600,
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: '16px',
                        height: '16px',
                        borderRadius: '99px',
                        background: sw.hex,
                        border: '1px solid rgba(255,255,255,0.2)',
                        flexShrink: 0,
                      }}
                    />
                    <span>{sw.label}</span>
                  </button>
                );
              })}
            </div>
          </Field>

          <Field
            label="3D scenes"
            hint="Auto pauses off-screen and on battery-saver or low-memory devices; Off never loads WebGL."
          >
            <Segmented<'auto' | 'on' | 'off'>
              aria-label="3D scenes"
              value={currentUi3d}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'on', label: 'On' },
                { value: 'off', label: 'Off' },
              ]}
              onChange={(val) => onUpdateSetting('ui3d', val)}
            />
          </Field>

          {currentUi3d !== 'off' && (
            <Field
              label="3D detail quality"
              hint="Auto uses High on modern GPUs and Lite on software or low-power devices."
            >
              <Segmented<'auto' | 'high' | 'lite'>
                aria-label="3D detail quality"
                value={set.ui3dQuality || 'auto'}
                options={[
                  { value: 'auto', label: 'Auto' },
                  { value: 'high', label: 'High' },
                  { value: 'lite', label: 'Lite' },
                ]}
                onChange={(val) => onUpdateSetting('ui3dQuality', val)}
              />
            </Field>
          )}
        </Card>
      )}

      {/* 9. Notifications and sound */}
      {activeSection === 'notifications' && (
        <Card style={{ margin: 0, display: 'grid', gap: '12px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              padding: '10px 12px',
              borderRadius: '12px',
              background: 'var(--sf-2)',
              border: '1px solid var(--line)',
            }}
          >
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600 }}>Sounds, chimes &amp; haptics</div>
              <div style={{ fontSize: '13px', color: 'var(--tx-2)' }}>
                Audio cues when completing tasks, sprints, and timer targets
              </div>
            </div>
            <Switch
              aria-label="Sounds, chimes, and haptics"
              checked={Boolean(set.snd)}
              onChange={(checked) => onUpdateSetting('snd', checked ? 1 : 0)}
            />
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              padding: '10px 12px',
              borderRadius: '12px',
              background: 'var(--sf-2)',
              border: '1px solid var(--line)',
            }}
          >
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600 }}>Study &amp; habit reminders</div>
              <div style={{ fontSize: '12px', color: 'var(--tx-2)' }}>
                Browser notifications for 5-minute sprint warnings and scheduled habits
              </div>
            </div>
            <Switch
              aria-label="Study and habit reminders"
              checked={Boolean(set.notif)}
              onChange={(checked) => onUpdateSetting('notif', checked ? 1 : 0)}
            />
          </div>

          {!isInstalled && isInstallable && (
            <Button variant="primary" size="lg" fullWidth onClick={install}>
              Install Deep Hours app
            </Button>
          )}
          {!isInstalled && isIOS && (
            <>
              <Button
                variant="primary"
                size="lg"
                fullWidth
                onClick={() => setShowIOSGuide((v) => !v)}
              >
                Install on iPhone or iPad
              </Button>
              {showIOSGuide && (
                <div
                  style={{
                    padding: '12px',
                    borderRadius: '12px',
                    background: 'var(--sf-2)',
                    border: '1px solid var(--line)',
                    fontSize: '13px',
                    color: 'var(--tx-2)',
                  }}
                >
                  <strong style={{ color: 'var(--tx)', display: 'block', marginBottom: '4px' }}>
                    Install on iOS Safari
                  </strong>
                  1. Tap the Share button in Safari toolbar. 2. Tap &ldquo;Add to Home Screen&rdquo;.
                </div>
              )}
            </>
          )}
        </Card>
      )}

      {/* 10. Data */}
      {activeSection === 'data' && (
        <Card style={{ margin: 0, display: 'grid', gap: '12px' }}>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--tx-2)', lineHeight: 1.5 }}>
            Full IndexedDB and localStorage snapshot containing study sessions, habits, tasks,
            syllabus chapters, revisions, mocks, mistakes, doubts, PYQs, and exam dates.{' '}
            {state.exp
              ? `Last backup: ${new Date(state.exp).toLocaleDateString()}`
              : 'No backup created yet.'}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            <Button variant="primary" onClick={onExportJson}>
              Export JSON
            </Button>
            <Button variant="secondary" onClick={onExportCsv}>
              Export CSV
            </Button>
            <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
              Import JSON backup
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onImportJson(file);
                e.target.value = '';
              }}
            />
          </div>
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: '12px' }}>
            <Button variant="danger" onClick={onRequestReset}>
              Erase all device data
            </Button>
          </div>
        </Card>
      )}

      {/* 11. About */}
      {activeSection === 'about' && (
        <Card style={{ margin: 0, display: 'grid', gap: '10px' }}>
          <div style={{ fontSize: '16px', fontWeight: 600 }}>Deep Hours</div>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--tx-2)', lineHeight: 1.5 }}>
            Local-first NEET preparation workspace built with timestamp-accurate timers,
            offline storage, Picture-in-Picture support, and optional Firebase sync.
          </p>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--tx-2)', lineHeight: 1.5 }}>
            Quick actions such as logging past study sessions, adding tasks, and capturing
            mistakes or doubts are available anytime via the <strong>+</strong> button in the top bar.
            Focus sounds can be toggled directly inside Focus.
          </p>
        </Card>
      )}
    </div>
  );
};
