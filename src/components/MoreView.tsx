import React, { useRef, useState } from 'react';
import type { AppSettings, PulseHabitState } from '../types';
import { ACS, pad } from '../utils/studyLogic';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface MoreViewProps {
  state: PulseHabitState;
  onNewSubject: () => void;
  onEditSubject: (id: string) => void;
  onNewHabit: () => void;
  onEditHabit: (id: string) => void;
  onUpdateSetting: <K extends keyof AppSettings>(key: K, val: AppSettings[K]) => void;
  onExportJson: () => void;
  onExportCsv: () => void;
  onImportJson: (file: File) => void;
  onRequestReset: () => void;
}

export const MoreView: React.FC<MoreViewProps> = ({
  state,
  onNewSubject,
  onEditSubject,
  onNewHabit,
  onEditHabit,
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
      <h2>Subjects</h2>
      <button
        type="button"
        className="pri"
        style={{ width: '100%', marginBottom: '8px' }}
        onClick={onNewSubject}
      >
        + New Subject
      </button>
      {state.subjects.map((s) => (
        <div key={s.id} className="c" onClick={() => onEditSubject(s.id)}>
          <span style={{ fontSize: '22px' }}>{s.e}</span>
          <div className="g">
            <b>
              <i className="dot" style={{ '--sc': s.color } as React.CSSProperties} />{' '}
              {s.name}
            </b>
            <small>
              Daily Goal: {s.dailyGoalMins || 0}m · {(s.todos || []).length} sub-tasks
            </small>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEditSubject(s.id);
            }}
          >
            Edit
          </button>
        </div>
      ))}

      <h2>Habits</h2>
      <button
        type="button"
        className="pri"
        style={{ width: '100%', marginBottom: '8px' }}
        onClick={onNewHabit}
      >
        + New Habit
      </button>
      {state.habits.map((h) => (
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
              {h.subjectId ? ' · 🔗 Auto-Study' : ''}
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
      ))}

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
            📲 Install PulseHabit PWA
          </button>
        )}
        {!isInstalled && isIOS && (
          <button
            type="button"
            className="pri"
            onClick={() => setShowIOSGuide((v) => !v)}
          >
            📲 Install PulseHabit on iPhone / iPad
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
          Full IndexedDB/localStorage snapshot (Habits, Study Sessions, 10-Min Plans,
          Subjects, D-Days).{' '}
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
