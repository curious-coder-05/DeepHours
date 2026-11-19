import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SETTINGS_DRAWER_GROUPS,
  evaluateDrawerSwipe,
  formatTodayDateCountdownLabel,
  getMenuSyncDotState,
  resolveReturnTab,
} from './navHelpers.ts';

test('navHelpers — menu sync dot is hidden when synced or idle and shown for active/offline/error states', () => {
  assert.deepEqual(
    getMenuSyncDotState({ isOnline: true, isSignedIn: true, syncStatus: 'synced' }),
    { visible: false, tone: null, label: 'Synced with cloud' }
  );
  assert.deepEqual(
    getMenuSyncDotState({ isOnline: true, isSignedIn: false, syncStatus: 'off' }),
    { visible: false, tone: null, label: 'Local device storage' }
  );

  const syncing = getMenuSyncDotState({
    isOnline: true,
    isSignedIn: true,
    syncStatus: 'syncing',
  });
  assert.equal(syncing.visible, true);
  assert.equal(syncing.tone, 'syncing');

  const offline = getMenuSyncDotState({
    isOnline: false,
    isSignedIn: true,
    syncStatus: 'synced',
  });
  assert.equal(offline.visible, true);
  assert.equal(offline.tone, 'pending');

  const err = getMenuSyncDotState({
    isOnline: true,
    isSignedIn: true,
    syncStatus: 'error',
  });
  assert.equal(err.visible, true);
  assert.equal(err.tone, 'error');

  const quota = getMenuSyncDotState({
    isOnline: true,
    isSignedIn: true,
    syncStatus: 'paused-quota',
  });
  assert.equal(quota.visible, true);
  assert.equal(quota.tone, 'error');
});

test('navHelpers — Today date + exam countdown sub-header formats cleanly with or without an exam', () => {
  const withExam = formatTodayDateCountdownLabel({
    selDayKey: '2026-11-19',
    todayKey: '2026-11-19',
    exam: { title: 'NEET', date: '2027-05-01' },
  });
  assert.equal(withExam.dateLabel, 'Thu, Nov 19');
  assert.equal(withExam.countdownLabel, '163d to NEET');
  assert.equal(withExam.fullLabel, 'Thu, Nov 19 · 163d to NEET');

  const examToday = formatTodayDateCountdownLabel({
    selDayKey: '2026-11-19',
    todayKey: '2026-11-19',
    exam: { title: 'NEET', date: '2026-11-19' },
  });
  assert.equal(examToday.countdownLabel, 'NEET today');
  assert.equal(examToday.fullLabel, 'Thu, Nov 19 · NEET today');

  const noExam = formatTodayDateCountdownLabel({
    selDayKey: '2026-11-18',
    todayKey: '2026-11-19',
    exam: null,
  });
  assert.equal(noExam.dateLabel, 'Wed, Nov 18');
  assert.equal(noExam.countdownLabel, null);
  assert.equal(noExam.fullLabel, 'Wed, Nov 18');
});

test('navHelpers — drawer swipe-left enforces strict horizontal intent (1.4x) and 64px threshold', () => {
  // Diagonal / mostly vertical scroll should NOT trigger swipe-left
  const verticalScroll = evaluateDrawerSwipe({ dx: -70, dy: 60 });
  assert.equal(verticalScroll.isHorizontalLeft, false);
  assert.equal(verticalScroll.shouldDismiss, false);
  assert.equal(verticalScroll.translateX, 0);

  // Horizontal right swipe should NOT dismiss or pull past 0
  const swipeRight = evaluateDrawerSwipe({ dx: 90, dy: 5 });
  assert.equal(swipeRight.isHorizontalLeft, false);
  assert.equal(swipeRight.shouldDismiss, false);
  assert.equal(swipeRight.translateX, 0);

  // Short horizontal left drag follows finger but does not dismiss below 64px
  const shortLeft = evaluateDrawerSwipe({ dx: -40, dy: 8 });
  assert.equal(shortLeft.isHorizontalLeft, true);
  assert.equal(shortLeft.shouldDismiss, false);
  assert.equal(shortLeft.translateX, -40);

  // Strong horizontal left drag >= 64px dismisses cleanly
  const strongLeft = evaluateDrawerSwipe({ dx: -72, dy: 12 });
  assert.equal(strongLeft.isHorizontalLeft, true);
  assert.equal(strongLeft.shouldDismiss, true);
  assert.equal(strongLeft.translateX, -72);
});

test('navHelpers — preserves exact 3-group Settings hierarchy and resolves return tabs safely', () => {
  assert.deepEqual(
    SETTINGS_DRAWER_GROUPS.map((g) => g.sections),
    [
      ['profile', 'sync'],
      ['study', 'targets', 'exams', 'subjects', 'habits'],
      ['appearance', 'notifications', 'data', 'about'],
    ]
  );

  assert.equal(resolveReturnTab('prep'), 'prep');
  assert.equal(resolveReturnTab('groups'), 'groups');
  assert.equal(resolveReturnTab('more'), 'today');
  assert.equal(resolveReturnTab(null), 'today');
});
