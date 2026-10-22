import React, { useRef, useState } from 'react';
import type { AppSettings, PulseHabitState } from '../types';
import { ACS, pad } from '../utils/studyLogic';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface MoreViewProps {
  state: PulseHabitState;
  onNewHabit: () => void;
  onEditHabit: (id: string) => void;
  onOpenManualSession: () => void;
  onUpdateSetting: <K extends keyof AppSettings>(key: K, val: AppSettings[K]) => void;
  onExportJson: () => void;
  onExportCsv: () => void;
  onImportJson: (file: File) => void;
  onRequestReset: () => void;
}

export const MoreView: React.FC<MoreViewProps> = ({
  state,
  onNewHabit,
  onEditHabit,
  onOpenManualSession,
  onUpdateSetting,
  onExportJson,
  onExportCsv,
  onImportJson,
  onRequestReset,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  const set = state.set;

  return (
    <div>
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
          Chapters &amp; Revisions, Mock Tests, D-Days).{' '}
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
