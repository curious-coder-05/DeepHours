import type { AppTab, DDay, SyncStatus } from '../types.ts';
import { parseKey } from './studyLogic.ts';

export type MainNavTab = 'today' | 'focus' | 'prep' | 'stats' | 'groups';

export type SettingsSectionId =
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

export const SETTINGS_SECTION_META: Record<
  SettingsSectionId,
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

export const SETTINGS_DRAWER_GROUPS: ReadonlyArray<{
  ariaLabel: string;
  sections: ReadonlyArray<SettingsSectionId>;
}> = [
  {
    ariaLabel: 'Profile and sync settings',
    sections: ['profile', 'sync'],
  },
  {
    ariaLabel: 'Study configuration',
    sections: ['study', 'targets', 'exams', 'subjects', 'habits'],
  },
  {
    ariaLabel: 'Appearance, alerts, and data',
    sections: ['appearance', 'notifications', 'data', 'about'],
  },
];

export interface MenuSyncDotState {
  visible: boolean;
  tone: 'syncing' | 'pending' | 'error' | null;
  label: string;
}

/**
 * Shows a subtle 6px corner dot on the top-left menu icon ONLY when cloud sync
 * is actively syncing, offline/pending, or errored/paused. Hides completely when
 * synced or idle so the icon stays ultra-clean.
 */
export function getMenuSyncDotState(params: {
  isOnline: boolean;
  isSignedIn: boolean;
  syncStatus: SyncStatus;
}): MenuSyncDotState {
  const { isOnline, isSignedIn, syncStatus } = params;

  if (!isOnline || syncStatus === 'offline') {
    return {
      visible: true,
      tone: 'pending',
      label: 'Offline — changes saved locally',
    };
  }
  if (syncStatus === 'error') {
    return {
      visible: true,
      tone: 'error',
      label: 'Sync error — open menu for details',
    };
  }
  if (syncStatus === 'paused-quota' || syncStatus === 'paused') {
    return {
      visible: true,
      tone: 'error',
      label: 'Cloud sync paused (daily cap)',
    };
  }
  if (syncStatus === 'syncing') {
    return {
      visible: true,
      tone: 'syncing',
      label: 'Syncing with cloud',
    };
  }
  return {
    visible: false,
    tone: null,
    label: isSignedIn ? 'Synced with cloud' : 'Local device storage',
  };
}

export interface TodayDateCountdownLabel {
  dateLabel: string;
  countdownLabel: string | null;
  fullLabel: string;
}

/**
 * Formats the interactive Today sub-header trigger:
 * e.g. "Thu, Nov 19 · 163d to NEET" (or just "Thu, Nov 19" when no exam is configured).
 */
export function formatTodayDateCountdownLabel(params: {
  selDayKey: string;
  todayKey: string;
  exam: Pick<DDay, 'title' | 'date'> | null;
}): TodayDateCountdownLabel {
  const { selDayKey, todayKey, exam } = params;
  const dateObj = parseKey(selDayKey);
  const dateLabel = dateObj.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  if (!exam || !exam.title?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(exam.date)) {
    return {
      dateLabel,
      countdownLabel: null,
      fullLabel: dateLabel,
    };
  }

  const diff = Math.round(
    (parseKey(exam.date).getTime() - parseKey(todayKey).getTime()) / 86400000
  );
  const title = exam.title.trim();
  const countdownLabel =
    diff > 0 ? `${diff}d to ${title}` : diff === 0 ? `${title} today` : title;

  return {
    dateLabel,
    countdownLabel,
    fullLabel: `${dateLabel} · ${countdownLabel}`,
  };
}

export interface DrawerSwipeEvaluation {
  isHorizontalLeft: boolean;
  shouldDismiss: boolean;
  translateX: number;
}

/**
 * Strict horizontal swipe-left intent evaluator for SettingsDrawer so vertical
 * scrolling never triggers accidental dismissal (|dx| > |dy| * 1.4, threshold >= 64px).
 */
export function evaluateDrawerSwipe(params: {
  dx: number;
  dy: number;
  thresholdPx?: number;
  intentRatio?: number;
}): DrawerSwipeEvaluation {
  const { dx, dy, thresholdPx = 64, intentRatio = 1.4 } = params;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  const isHorizontalLeft = dx < 0 && absX > absY * intentRatio;
  const translateX = isHorizontalLeft ? dx : 0;
  const shouldDismiss = isHorizontalLeft && absX >= thresholdPx;
  return {
    isHorizontalLeft,
    shouldDismiss,
    translateX,
  };
}

/**
 * Resolves a valid main navigation tab for returning from a Settings sub-screen.
 */
export function resolveReturnTab(tab: AppTab | null | undefined): MainNavTab {
  if (
    tab === 'today' ||
    tab === 'focus' ||
    tab === 'prep' ||
    tab === 'stats' ||
    tab === 'groups'
  ) {
    return tab;
  }
  return 'today';
}
