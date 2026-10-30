import React, { useRef, useState } from 'react';
import type { AppSettings, PulseHabitState, SubjectTargets, SyncStatus } from '../types';
import { ACS, pad } from '../utils/studyLogic';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { DAILY_WRITE_CAP } from '../utils/cloudSync';

interface MoreViewProps {
  state: PulseHabitState;
  onNewHabit: () => void;
  onEditHabit: (id: string) => void;
  onOpenManualSession: () => void;
  onAddSubject?: (name: string, emoji: string, color: string) => void;
  onDeleteSubject?: (subjectId: string) => void;
  onUpdateSetting: <K extends keyof AppSettings>(key: K, val: AppSettings[K]) => void;
  onUpdateTargets?: (patch: Partial<SubjectTargets>) => void;
  onSelectAvatarEmoji?: (emoji: string) => void;
  onExportJson: () => void;
  onExportCsv: () => void;
  onImportJson: (file: File) => void;
  onRequestReset: () => void;
  // Milestone 2 Cloud Sync props
  cloudUser?: { uid: string; displayName: string | null; email: string | null } | null;
  authUser?: { uid: string; displayName: string | null; email: string | null } | null;
  syncStatus?: SyncStatus;
  syncErrorMsg?: string | null;
  lastSyncedAt?: number;
  dailyWritesUsed?: number;
  syncWritesToday?: number;
  isOnline?: boolean;
  onSignInGoogle?: () => void;
  onSignOutGoogle?: () => void;
  onSyncNow?: () => void;
  onDeleteCloudData?: () => void;
}

const AVATAR_EMOJIS = ['🧑‍⚕️', '🩺', '🧬', '⚡', '🦁', '🎯', '🚀', '🦉'];

export const MoreView: React.FC<MoreViewProps> = ({
  state,
  onNewHabit,
  onEditHabit,
  onOpenManualSession,
  onAddSubject,
  onDeleteSubject,
  onUpdateSetting,
  onSelectAvatarEmoji,
  onExportJson,
  onExportCsv,
  onImportJson,
  onRequestReset,
  cloudUser: cloudUserProp,
  authUser,
  syncStatus = 'idle',
  syncErrorMsg,
  lastSyncedAt,
  dailyWritesUsed: dailyWritesUsedProp,
  syncWritesToday,
  isOnline = true,
  onSignInGoogle,
  onSignOutGoogle,
  onSyncNow,
  onDeleteCloudData,
}) => {
  const cloudUser = cloudUserProp ?? authUser ?? null;
  const dailyWritesUsed = dailyWritesUsedProp ?? syncWritesToday ?? 0;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [newSubName, setNewSubName] = useState('');
  const [newSubEmoji, setNewSubEmoji] = useState('📘');
  const [newSubColor, setNewSubColor] = useState(ACS[0]);
  const [confirmDeleteCloud, setConfirmDeleteCloud] = useState(false);
  const [intervalsInput, setIntervalsInput] = useState(
    (state.set.revisionIntervals || [1, 3, 7, 21]).join(', ')
  );

  const set = state.set;
  const activeSubjects = state.subjects.filter((s) => !s.arch);
  const targets = set.targets || {
    dailyMinutes: {},
    weeklyMinutes: {},
    minDayMinutes: 240,
    restPassesPerMonth: 4,
  };
  const currentAvatar = set.cloudAccount?.avatarEmoji || set.avatarEmoji || '🧑‍⚕️';

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

  return (
    <div>
      {/* 2.1 & 2.6 Account & Cloud Sync Section */}
      <h2>Account &amp; Cloud Sync</h2>
      <div className="card" style={{ display: 'grid', gap: '10px' }}>
        <div className="row sp" style={{ alignItems: 'center', gap: '8px' }}>
          <div className="row" style={{ gap: '10px', alignItems: 'center' }}>
            <span
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '14px',
                background: 'var(--c2)',
                border: '1px solid var(--bd)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '22px',
              }}
            >
              {currentAvatar}
            </span>
            <div>
              <b style={{ fontSize: '14.5px', display: 'block' }}>
                {cloudUser
                  ? cloudUser.displayName || cloudUser.email || 'Signed-In Aspirant'
                  : 'Local-Only Mode (Signed Out)'}
              </b>
              <small>
                {cloudUser
                  ? cloudUser.email || 'Google Account Connected'
                  : 'App works 100% offline. Sign in to back up & sync across devices.'}
              </small>
            </div>
          </div>

          <span
            className="pill mono"
            style={{
              fontSize: '11px',
              borderColor: !isOnline
                ? '#f59e0b'
                : syncStatus === 'error' || syncStatus === 'paused-quota'
                  ? '#ef4444'
                  : syncStatus === 'syncing'
                    ? '#38bdf8'
                    : '#10b981',
              color: !isOnline
                ? '#fbbf24'
                : syncStatus === 'error' || syncStatus === 'paused-quota'
                  ? '#f87171'
                  : syncStatus === 'syncing'
                    ? '#38bdf8'
                    : '#10b981',
            }}
          >
            {!isOnline
              ? '⚡ Offline'
              : syncStatus === 'syncing'
                ? '↻ Syncing...'
                : syncStatus === 'paused-quota'
                  ? '⏸ Paused (Daily Cap)'
                  : syncStatus === 'error'
                    ? '⚠️ Sync Error'
                    : cloudUser
                      ? '● Online'
                      : '● Local Ready'}
          </span>
        </div>

        {/* Emoji Avatar Picker (No photo upload per 2.1) */}
        <div>
          <small style={{ display: 'block', marginBottom: '4px', fontWeight: 700 }}>
            Profile Avatar Emoji:
          </small>
          <div className="row wrap" style={{ gap: '6px' }}>
            {AVATAR_EMOJIS.map((em) => (
              <button
                key={em}
                type="button"
                className={currentAvatar === em ? 'on' : 's'}
                style={{ width: '36px', height: '36px', padding: 0, fontSize: '18px' }}
                onClick={() => handleAvatarChange(em)}
                aria-label={`Choose avatar ${em}`}
              >
                {em}
              </button>
            ))}
          </div>
        </div>

        {syncStatus === 'paused-quota' && (
          <div
            style={{
              padding: '8px 10px',
              borderRadius: '10px',
              background: 'rgba(245, 158, 11, 0.14)',
              border: '1px solid rgba(245, 158, 11, 0.4)',
              fontSize: '12px',
              color: '#fde68a',
            }}
          >
            ⏸ Cloud sync is paused for today to stay safely within the free tier quota. All changes
            are saved locally and will automatically sync tomorrow.
          </div>
        )}

        {syncErrorMsg && syncStatus === 'error' && (
          <small style={{ color: '#f87171', fontWeight: 700 }}>
            Sync notice: {syncErrorMsg} (Your data remains safe on this device.)
          </small>
        )}

        {cloudUser ? (
          <>
            <div className="stat-mini" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
              <div className="stat-box">
                <small>Last Synced</small>
                <b className="mono" style={{ fontSize: '12.5px' }}>
                  {lastSyncedAt
                    ? new Date(lastSyncedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : 'Not yet'}
                </b>
              </div>
              <div className="stat-box">
                <small>Today&apos;s sync usage</small>
                <b className="mono" style={{ fontSize: '12.5px', color: 'var(--em)' }}>
                  {dailyWritesUsed} / {DAILY_WRITE_CAP} writes
                </b>
              </div>
            </div>

            <div className="row wrap" style={{ gap: '6px' }}>
              <button
                type="button"
                className="pri g"
                disabled={!isOnline || syncStatus === 'syncing' || syncStatus === 'paused-quota'}
                onClick={onSyncNow}
              >
                {syncStatus === 'syncing' ? 'Syncing...' : '↻ Sync now'}
              </button>
              <button type="button" className="s g" onClick={onExportJson}>
                ⬇ Download backup
              </button>
              <button type="button" className="s" onClick={onSignOutGoogle}>
                Sign out
              </button>
            </div>

            {!confirmDeleteCloud ? (
              <button
                type="button"
                className="s dg"
                style={{ justifySelf: 'start', fontSize: '11.5px' }}
                onClick={() => setConfirmDeleteCloud(true)}
              >
                🗑️ Delete my cloud data
              </button>
            ) : (
              <div
                style={{
                  padding: '10px',
                  borderRadius: '10px',
                  background: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                }}
              >
                <small style={{ display: 'block', color: '#fca5a5', fontWeight: 700, marginBottom: '6px' }}>
                  Delete all synced data from the cloud? Your local device data will NOT be erased.
                </small>
                <div className="row" style={{ gap: '6px' }}>
                  <button
                    type="button"
                    className="s dg"
                    onClick={() => {
                      setConfirmDeleteCloud(false);
                      onDeleteCloudData?.();
                    }}
                  >
                    Yes, delete cloud data
                  </button>
                  <button
                    type="button"
                    className="s"
                    onClick={() => setConfirmDeleteCloud(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="row wrap" style={{ gap: '8px' }}>
            <button
              type="button"
              className="pri g"
              onClick={onSignInGoogle}
            >
              🔐 Sign in with Google
            </button>
            <button type="button" className="s" onClick={onExportJson}>
              ⬇ Download backup
            </button>
          </div>
        )}

        {/* 2.6 Plain-language privacy note */}
        <small
          style={{
            display: 'block',
            paddingTop: '8px',
            borderTop: '1px solid var(--bd)',
            fontSize: '11px',
            lineHeight: 1.45,
            color: 'var(--mu)',
          }}
        >
          🔒 <b>Privacy Note:</b> Your study data is stored locally on your device first (IndexedDB
          &amp; localStorage). Signing in with Google is optional and only syncs your data to your
          private cloud folder (<code>users/&#123;uid&#125;</code>) so you can back up or switch
          devices. There are zero analytics, zero ads, and zero third-party trackers.
        </small>
      </div>

      {/* 1.8, 1.2, 1.14, 1.15 Targets & Coaching Configuration */}
      <h2>Targets &amp; Coaching Settings</h2>
      <div className="card" style={{ display: 'grid', gap: '10px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
          <label style={{ marginTop: 0 }}>
            Min Study Day (mins)
            <input
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
          </label>
          <label style={{ marginTop: 0 }}>
            Rest Passes / Month
            <input
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
          </label>
          <label style={{ marginTop: 0 }}>
            Revision Buffer Days (Before Exam)
            <input
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
          </label>
          <label style={{ marginTop: 0 }}>
            Full Mock Duration (mins)
            <input
              type="number"
              min={30}
              max={360}
              value={set.fullMockMins ?? 200}
              onChange={(e) =>
                onUpdateSetting(
                  'fullMockMins',
                  Math.max(30, Math.min(360, Number(e.target.value) || 200))
                )
              }
            />
          </label>
        </div>

        <label style={{ marginTop: 0 }}>
          Suggested Revision Intervals (days after completion, comma-separated)
          <div className="row" style={{ gap: '6px', marginTop: '4px' }}>
            <input
              type="text"
              value={intervalsInput}
              onChange={(e) => setIntervalsInput(e.target.value)}
              placeholder="1, 3, 7, 21"
            />
            <button
              type="button"
              className="s pri"
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
            </button>
          </div>
        </label>

        {/* Per-Subject Daily & Weekly Target Minutes */}
        <div style={{ borderTop: '1px solid var(--bd)', paddingTop: '8px' }}>
          <small style={{ display: 'block', fontWeight: 700, marginBottom: '6px' }}>
            Subject Targets (Daily &amp; Weekly Minutes)
          </small>
          <div style={{ display: 'grid', gap: '8px' }}>
            {activeSubjects.map((sub) => (
              <div
                key={sub.id}
                className="row sp wrap"
                style={{
                  background: 'var(--c2)',
                  padding: '8px 10px',
                  borderRadius: '10px',
                  borderLeft: `3px solid ${sub.color}`,
                  gap: '8px',
                }}
              >
                <b style={{ fontSize: '13px', minWidth: '100px' }}>
                  {sub.e} {sub.name}
                </b>
                <div className="row" style={{ gap: '8px', flex: 1, justifyContent: 'flex-end' }}>
                  <label style={{ margin: 0, fontSize: '11px', width: '95px' }}>
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
                      style={{ padding: '4px 6px', fontSize: '12px' }}
                    />
                  </label>
                  <label style={{ margin: 0, fontSize: '11px', width: '105px' }}>
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
                      style={{ padding: '4px 6px', fontSize: '12px' }}
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <h2>Study Logger Actions</h2>
      <div className="card" style={{ display: 'grid', gap: '8px' }}>
        <small>
          Log completed study hours manually with a subject, custom session heading, and notes, or use the Pomodoro / Countdown / Stopwatch timers in the Focus tab.
        </small>
        <button
          type="button"
          className="pri"
          style={{ width: '100%' }}
          onClick={onOpenManualSession}
        >
          + Log Study Session Manually
        </button>
      </div>

      <h2>Habits</h2>
      <button
        type="button"
        className="pri"
        style={{ width: '100%', marginBottom: '8px' }}
        onClick={onNewHabit}
      >
        + New Habit
      </button>
      {state.habits.length === 0 && (
        <div className="card">
          <small>
            No habits yet. Tap &ldquo;+ New Habit&rdquo; above to add a daily habit or an auto-synced study habit.
          </small>
        </div>
      )}
      {state.habits.map((h) => {
        const sub =
          h.subjectId && h.subjectId !== 'any'
            ? state.subjects.find((s) => s.id === h.subjectId)
            : null;
        return (
          <div
            key={h.id}
            className={`c ${h.arch ? 'sk' : ''}`}
            onClick={() => onEditHabit(h.id)}
          >
            <span style={{ fontSize: '22px' }}>{h.e}</span>
            <div className="g">
              <b>{h.name}</b>
              <small>
                {h.c} · {h.sch === 'week' ? `${h.n}×/wk` : 'daily'}
                {h.subjectId || h.autoMins
                  ? ` · 🔗 Auto from timer (${sub ? sub.name : 'All subjects'})`
                  : ''}
                {h.arch ? ' · archived' : ''}
              </small>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEditHabit(h.id);
              }}
            >
              Edit
            </button>
          </div>
        );
      })}

      <h2>Subjects</h2>
      <div className="card" style={{ display: 'grid', gap: '8px' }}>
        {activeSubjects.map((sub) => (
          <div
            key={sub.id}
            className="row sp"
            style={{
              background: 'var(--c2)',
              padding: '8px 12px',
              borderRadius: '12px',
              borderLeft: `3px solid ${sub.color}`,
            }}
          >
            <div className="row" style={{ gap: '8px' }}>
              <span style={{ fontSize: '18px' }}>{sub.e}</span>
              <b>{sub.name}</b>
            </div>
            {onDeleteSubject && activeSubjects.length > 1 && (
              <button
                type="button"
                className="s dg"
                aria-label={`Delete subject ${sub.name}`}
                onClick={() => onDeleteSubject(sub.id)}
              >
                Delete
              </button>
            )}
          </div>
        ))}
        {onAddSubject && (
          <form
            className="row wrap"
            style={{ gap: '6px', marginTop: '4px' }}
            onSubmit={(e) => {
              e.preventDefault();
              const clean = newSubName.trim();
              if (!clean) return;
              onAddSubject(clean, newSubEmoji.trim() || '📘', newSubColor);
              setNewSubName('');
            }}
          >
            <input
              type="text"
              value={newSubEmoji}
              onChange={(e) => setNewSubEmoji(e.target.value)}
              style={{ width: '56px', textAlign: 'center' }}
              maxLength={4}
              aria-label="New subject emoji"
            />
            <input
              type="text"
              value={newSubName}
              onChange={(e) => setNewSubName(e.target.value)}
              placeholder="New subject name..."
              style={{ flex: '1 1 140px' }}
              maxLength={40}
              aria-label="New subject name"
            />
            <select
              value={newSubColor}
              onChange={(e) => setNewSubColor(e.target.value)}
              style={{ width: '96px' }}
              aria-label="New subject color"
            >
              {ACS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button type="submit" className="s pri">
              + Add Subject
            </button>
          </form>
        )}
      </div>

      <h2>Study &amp; App Settings</h2>
      <div className="card" style={{ display: 'grid', gap: '10px' }}>
        <label>
          Night-Owl Day Reset Hour (Sessions before this belong to previous day)
          <select
            value={set.dayResetHour}
            onChange={(e) => onUpdateSetting('dayResetHour', Number(e.target.value))}
          >
            {[0, 1, 2, 3, 4, 5, 6].map((h) => (
              <option key={h} value={h}>
                {pad(h)}:00 AM
              </option>
            ))}
          </select>
        </label>
        <label>
          Floating PiP Engine Preference
          <select
            value={set.pipPref}
            onChange={(e) =>
              onUpdateSetting('pipPref', e.target.value as 'video' | 'doc')
            }
          >
            <option value="video">
              Android / Universal Video+Audio Stream PiP (16:9)
            </option>
            <option value="doc">Desktop Document PiP (260×130 Interactive)</option>
          </select>
        </label>
        <div>
          <label htmlFor="timerAestheticSelect" style={{ marginBottom: '6px' }}>
            Timer Aesthetic (Focus View &amp; PiP Clock Face)
          </label>
          <div
            className="chips wrap"
            role="group"
            aria-label="Timer Aesthetic"
            style={{ paddingBottom: 0, gap: '6px', marginBottom: '6px' }}
          >
            {(
              [
                ['neon', '⚡ Neon Digital'],
                ['minimal', '⌨️ Minimalist Mono'],
                ['retro', '🕰️ Analog Retro'],
              ] as const
            ).map(([key, label]) => {
              const isSelected = (set.timerAesthetic || 'neon') === key;
              return (
                <button
                  type="button"
                  key={key}
                  className={isSelected ? 'on' : ''}
                  style={{ flex: 1, minWidth: '120px' }}
                  onClick={() => onUpdateSetting('timerAesthetic', key)}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <select
            id="timerAestheticSelect"
            aria-label="Timer Aesthetic Select"
            value={set.timerAesthetic || 'neon'}
            onChange={(e) =>
              onUpdateSetting(
                'timerAesthetic',
                e.target.value as 'neon' | 'minimal' | 'retro'
              )
            }
          >
            <option value="neon">Neon Digital (Glowing Cyber HUD)</option>
            <option value="minimal">Minimalist Mono (Clean Swiss Tabular)</option>
            <option value="retro">Analog Retro (Chronometer Dial + Phosphor)</option>
          </select>
        </div>
        <label>
          Theme
          <select
            value={set.theme}
            onChange={(e) =>
              onUpdateSetting('theme', e.target.value as 'auto' | 'dark' | 'light')
            }
          >
            {(['auto', 'dark', 'light'] as const).map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Week starts
          <select
            value={set.ws}
            onChange={(e) => onUpdateSetting('ws', Number(e.target.value))}
          >
            <option value={1}>Monday</option>
            <option value={0}>Sunday</option>
          </select>
        </label>
        <div className="row">
          {ACS.map((c) => (
            <button
              type="button"
              key={c}
              className={`sw ${c === set.ac ? 'on' : ''}`}
              style={{ background: c }}
              onClick={() => onUpdateSetting('ac', c)}
              aria-label={`Accent ${c}`}
            />
          ))}
        </div>
        <label className="row">
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={!!set.snd}
            onChange={(e) => onUpdateSetting('snd', e.target.checked ? 1 : 0)}
          />{' '}
          Sounds, chimes, and haptics
        </label>
        <label className="row">
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={!!set.notif}
            onChange={(e) => onUpdateSetting('notif', e.target.checked ? 1 : 0)}
          />{' '}
          Habit &amp; sprint notifications
        </label>

        {!isInstalled && isInstallable && (
          <button type="button" className="pri" onClick={install}>
            📲 Install Deep Hours PWA
          </button>
        )}
        {!isInstalled && isIOS && (
          <button
            type="button"
            className="pri"
            onClick={() => setShowIOSGuide((v) => !v)}
          >
            📲 Install Deep Hours on iPhone / iPad
          </button>
        )}
        {showIOSGuide && (
          <div className="stat-box">
            <b>Install on iOS Safari</b>
            <small>
              1. Tap the Share button in Safari toolbar. 2. Tap &ldquo;Add to Home
              Screen&rdquo;.
            </small>
          </div>
        )}
      </div>

      <h2>1-Tap Local Backup &amp; Restore</h2>
      <div className="card" style={{ display: 'grid', gap: '8px' }}>
        <small>
          Full IndexedDB/localStorage snapshot (Habits, Study Sessions, Syllabus
          Chapters &amp; Revisions, Mock Tests, Mistakes, Doubts, PYQs, D-Days).{' '}
          {state.exp
            ? `Last backup: ${new Date(state.exp).toLocaleDateString()}`
            : 'No backup yet.'}
        </small>
        <div className="row">
          <button type="button" className="g pri" onClick={onExportJson}>
            ⬇ Export Full JSON
          </button>
          <button type="button" className="g" onClick={onExportCsv}>
            ⬇ Export CSV
          </button>
        </div>
        <div className="row">
          <button
            type="button"
            className="g"
            onClick={() => fileInputRef.current?.click()}
          >
            ⬆ Import JSON Backup
          </button>
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
        <button type="button" className="dg-btn" onClick={onRequestReset}>
          Erase All Device Data
        </button>
      </div>
    </div>
  );
};
