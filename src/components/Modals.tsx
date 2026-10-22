import React, { useEffect, useRef, useState } from 'react';
import type {
  DDay,
  Habit,
  HabitCategory,
  HabitSchedule,
  PulseHabitState,
  StudySession,
  Subject,
  TimerMetrics,
} from '../types';
import {
  CATS,
  DN,
  SUB_COLORS,
  addD,
  fmtHMS,
  mkHabit,
  pad,
} from '../utils/studyLogic';

export type ModalState =
  | { type: 'none' }
  | { type: 'habit'; id?: string }
  | { type: 'subject'; id?: string }
  | { type: 'reflect'; metrics: TimerMetrics }
  | { type: 'manualSession'; id?: string }
  | { type: 'timerConfig' }
  | { type: 'dday'; id?: string }
  | { type: 'confirmReset' };

interface ModalsProps {
  modal: ModalState;
  state: PulseHabitState;
  sel: string;
  todayKey: string;
  onClose: () => void;
  onSaveHabit: (id: string | undefined, data: Partial<Habit>) => void;
  onArchiveHabit: (id: string) => void;
  onDeleteHabit: (id: string) => void;
  onSaveSubject: (id: string | undefined, data: Partial<Subject>) => void;
  onSubmitReflection: (rating: number, note: string) => void;
  onDiscardSession: () => void;
  onSaveManualSession: (id: string | undefined, session: Omit<StudySession, 'id'>) => void;
  onDeleteSession: (id: string) => void;
  onSaveTimerConfig: (pomoWork: number, pomoBreak: number, countdownMins: number) => void;
  onSaveDDay: (id: string | undefined, data: Omit<DDay, 'id'>) => void;
  onDeleteDDay: (id: string) => void;
  onConfirmReset: () => void;
}

export const Modals: React.FC<ModalsProps> = ({
  modal,
  state,
  sel,
  todayKey,
  onClose,
  onSaveHabit,
  onArchiveHabit,
  onDeleteHabit,
  onSaveSubject,
  onSubmitReflection,
  onDiscardSession,
  onSaveManualSession,
  onDeleteSession,
  onSaveTimerConfig,
  onSaveDDay,
  onDeleteDDay,
  onConfirmReset,
}) => {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  // Habit modal state
  const existingHabit =
    modal.type === 'habit' && modal.id
      ? state.habits.find((x) => x.id === modal.id)
      : undefined;
  const defaultHabit = existingHabit || mkHabit({}, todayKey);
  const [hEmoji, setHEmoji] = useState(defaultHabit.e);
  const [hName, setHName] = useState(defaultHabit.name);
  const [hCat, setHCat] = useState<HabitCategory>(defaultHabit.c);
  const [hSch, setHSch] = useState<HabitSchedule>(defaultHabit.sch);
  const [hDays, setHDays] = useState<number[]>(defaultHabit.days);
  const [hTn, setHTn] = useState(defaultHabit.tn);
  const [hTu, setHTu] = useState(defaultHabit.tu);
  const [hSubId, setHSubId] = useState(defaultHabit.subjectId || '');
  const [hWeeklyN, setHWeeklyN] = useState(defaultHabit.n);
  const [hRem, setHRem] = useState(defaultHabit.rem);

  // Subject modal state
  const existingSub =
    modal.type === 'subject' && modal.id
      ? state.subjects.find((x) => x.id === modal.id)
      : undefined;
  const [sEmoji, setSEmoji] = useState('📚');
  const [sName, setSName] = useState('');
  const [sColor, setSColor] = useState('#6366f1');
  const [sGoal, setSGoal] = useState(120);

  // Reflection modal state
  const [refRating, setRefRating] = useState(5);
  const [refNote, setRefNote] = useState('');

  // Manual Session modal state
  const existingSes =
    modal.type === 'manualSession' && modal.id
      ? state.sessions.find((x) => x.id === modal.id)
      : undefined;
  const [msSubId, setMsSubId] = useState(state.subjects[0]?.id || 'sub_code');
  const [msDayKey, setMsDayKey] = useState(sel);
  const [msStartTime, setMsStartTime] = useState('09:00');
  const [msEndTime, setMsEndTime] = useState('10:00');
  const [msPauseMins, setMsPauseMins] = useState(0);
  const [msRating, setMsRating] = useState(5);
  const [msNote, setMsNote] = useState('');

  // Timer Config state
  const [cfgPomoWork, setCfgPomoWork] = useState(state.set.pomoWork || 25);
  const [cfgPomoBreak, setCfgPomoBreak] = useState(state.set.pomoBreak || 5);
  const [cfgCountdown, setCfgCountdown] = useState(state.set.countdownMins || 45);

  // D-Day state
  const existingDDay =
    modal.type === 'dday' && modal.id
      ? state.ddays.find((x) => x.id === modal.id)
      : undefined;
  const [ddEmoji, setDdEmoji] = useState('🎓');
  const [ddTitle, setDdTitle] = useState('');
  const [ddDate, setDdDate] = useState(addD(todayKey, 14));
  const [ddColor, setDdColor] = useState('#10b981');

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;

    if (modal.type === 'none') {
      if (dlg.open) dlg.close();
      return;
    }

    if (modal.type === 'habit') {
      const h = modal.id
        ? state.habits.find((x) => x.id === modal.id) || mkHabit({}, todayKey)
        : mkHabit({}, todayKey);
      setHEmoji(h.e);
      setHName(h.name);
      setHCat(h.c);
      setHSch(h.sch);
      setHDays(h.days);
      setHTn(h.tn);
      setHTu(h.tu);
      setHSubId(h.subjectId || '');
      setHWeeklyN(h.n);
      setHRem(h.rem);
    } else if (modal.type === 'subject') {
      const s = modal.id ? state.subjects.find((x) => x.id === modal.id) : undefined;
      setSEmoji(s?.e || '📚');
      setSName(s?.name || '');
      setSColor(
        s?.color || SUB_COLORS[state.subjects.length % SUB_COLORS.length]
      );
      setSGoal(s?.dailyGoalMins || 120);
    } else if (modal.type === 'reflect') {
      setRefRating(5);
      setRefNote('');
    } else if (modal.type === 'manualSession') {
      const ex = modal.id
        ? state.sessions.find((x) => x.id === modal.id)
        : undefined;
      const now = new Date();
      const oneHrAgo = new Date(now.getTime() - 3600000);
      const startD = ex ? new Date(ex.startTs) : oneHrAgo;
      const endD = ex ? new Date(ex.endTs) : now;
      setMsSubId(ex?.subjectId || state.subjects[0]?.id || 'sub_code');
      setMsDayKey(ex ? ex.dayKey : sel);
      setMsStartTime(`${pad(startD.getHours())}:${pad(startD.getMinutes())}`);
      setMsEndTime(`${pad(endD.getHours())}:${pad(endD.getMinutes())}`);
      setMsPauseMins(ex ? Math.round((ex.pausedMs || 0) / 60000) : 0);
      setMsRating(ex?.rating || 5);
      setMsNote(ex?.note || '');
    } else if (modal.type === 'timerConfig') {
      setCfgPomoWork(state.set.pomoWork || 25);
      setCfgPomoBreak(state.set.pomoBreak || 5);
      setCfgCountdown(state.set.countdownMins || 45);
    } else if (modal.type === 'dday') {
      const d = modal.id ? state.ddays.find((x) => x.id === modal.id) : undefined;
      setDdEmoji(d?.e || '🎓');
      setDdTitle(d?.title || '');
      setDdDate(d?.date || addD(todayKey, 14));
      setDdColor(d?.color || '#10b981');
    }

    if (!dlg.open) {
      try {
        dlg.showModal();
      } catch {
        dlg.setAttribute('open', 'true');
      }
    }
  }, [modal, sel, state.ddays, state.habits, state.sessions, state.set, state.subjects, todayKey]);

  const toggleDayInHabit = (dayIdx: number) => {
    setHDays((prev) =>
      prev.includes(dayIdx) ? prev.filter((x) => x !== dayIdx) : [...prev, dayIdx]
    );
  };

  return (
    <dialog
      id="dlg"
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      {modal.type === 'habit' && (
        <form
          id="hf"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = hName.trim();
            if (!trimmed) return;
            onSaveHabit(modal.id, {
              name: trimmed,
              e: hEmoji.trim() || '✨',
              c: hCat,
              sch: hSch,
              days: hDays.length ? hDays : [0, 1, 2, 3, 4, 5, 6],
              n: Math.min(7, Math.max(1, Number(hWeeklyN) || 3)),
              tn: Math.min(999, Math.max(1, Number(hTn) || 1)),
              tu: hSubId ? 'min' : hTu.trim(),
              rem: hRem,
              subjectId: hSubId,
            });
          }}
        >
          <h3>{modal.id ? 'Edit' : 'New'} Habit</h3>
          <div className="row">
            <input
              className="em"
              name="e"
              value={hEmoji}
              onChange={(e) => setHEmoji(e.target.value)}
              maxLength={4}
              aria-label="Habit Emoji"
            />
            <input
              name="name"
              value={hName}
              onChange={(e) => setHName(e.target.value)}
              placeholder="e.g. Study 2 hours of Coding"
              required
              maxLength={60}
              aria-label="Habit Name"
            />
          </div>
          <div className="row">
            <label className="g">
              Category
              <select
                name="c"
                value={hCat}
                onChange={(e) => setHCat(e.target.value as HabitCategory)}
              >
                {CATS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="g">
              Schedule
              <select
                name="sch"
                value={hSch}
                onChange={(e) => setHSch(e.target.value as HabitSchedule)}
              >
                <option value="daily">Every day</option>
                <option value="days">Specific days</option>
                <option value="week">X times / week</option>
              </select>
            </label>
          </div>
          <div className="dys">
            {DN.map((d, i) => (
              <label key={i}>
                <input
                  type="checkbox"
                  checked={hDays.includes(i)}
                  onChange={() => toggleDayInHabit(i)}
                />
                {d}
              </label>
            ))}
          </div>
          <div className="row">
            <label className="g">
              Daily Target
              <input
                type="number"
                name="tn"
                min={1}
                max={999}
                value={hTn}
                onChange={(e) => setHTn(Number(e.target.value))}
              />
            </label>
            <label className="g">
              Unit
              <input
                name="tu"
                value={hTu}
                onChange={(e) => setHTu(e.target.value)}
                maxLength={12}
                placeholder="min, pages"
              />
            </label>
          </div>
          <label>
            🔗 Auto-Complete from Study Subject (logs minutes automatically)
            <select
              name="subjectId"
              value={hSubId}
              onChange={(e) => setHSubId(e.target.value)}
            >
              <option value="">Manual check-in only</option>
              <option value="any">⏱️ Any Study Subject (Total Minutes)</option>
              {state.subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.e} {s.name} (Minutes)
                </option>
              ))}
            </select>
          </label>
          <div className="row">
            <label className="g">
              Times/week (if weekly)
              <input
                type="number"
                name="n"
                min={1}
                max={7}
                value={hWeeklyN}
                onChange={(e) => setHWeeklyN(Number(e.target.value))}
              />
            </label>
            <label className="g">
              Reminder
              <input
                type="time"
                name="rem"
                value={hRem}
                onChange={(e) => setHRem(e.target.value)}
              />
            </label>
          </div>
          <div className="row">
            <button className="pri g" type="submit">
              Save Habit
            </button>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
          {modal.id && existingHabit && (
            <div className="row">
              <button
                type="button"
                className="g"
                onClick={() => onArchiveHabit(modal.id!)}
              >
                {existingHabit.arch ? 'Unarchive' : 'Archive'}
              </button>
              <button
                type="button"
                className="dg-btn g"
                onClick={() => onDeleteHabit(modal.id!)}
              >
                Delete
              </button>
            </div>
          )}
        </form>
      )}

      {modal.type === 'subject' && (
        <form
          id="subForm"
          onSubmit={(e) => {
            e.preventDefault();
            onSaveSubject(modal.id, {
              name: sName.trim() || 'Subject',
              e: sEmoji.trim() || '📚',
              color: sColor || '#6366f1',
              dailyGoalMins: Number(sGoal) || 120,
            });
          }}
        >
          <h3>{modal.id ? 'Edit' : 'New'} Subject</h3>
          <div className="row">
            <input
              className="em"
              name="e"
              value={sEmoji}
              onChange={(e) => setSEmoji(e.target.value)}
              maxLength={4}
              aria-label="Subject Emoji"
            />
            <input
              name="name"
              value={sName}
              onChange={(e) => setSName(e.target.value)}
              placeholder="Subject Name (e.g. Algorithms)"
              required
              maxLength={40}
              aria-label="Subject Name"
            />
          </div>
          <div className="row">
            <label className="g">
              Color
              <input
                type="color"
                name="color"
                value={sColor}
                onChange={(e) => setSColor(e.target.value)}
                style={{ height: '42px', padding: '4px' }}
              />
            </label>
            <label className="g">
              Daily Goal (mins)
              <input
                type="number"
                name="dailyGoalMins"
                min={10}
                max={960}
                value={sGoal}
                onChange={(e) => setSGoal(Number(e.target.value))}
              />
            </label>
          </div>
          <div className="row">
            <button className="pri g" type="submit">
              Save Subject
            </button>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {modal.type === 'reflect' && (
        <form
          id="reflectForm"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmitReflection(refRating, refNote.trim());
          }}
        >
          <h3>🎉 Session Complete!</h3>
          <div className="stat-mini">
            <div className="stat-box">
              <small>Focused</small>
              <b className="mono" style={{ color: 'var(--em)' }}>
                {fmtHMS(modal.metrics.sliceActiveMs)}
              </b>
            </div>
            <div className="stat-box">
              <small>Focus Purity</small>
              <b className="mono">
                {modal.metrics.purity}% ({modal.metrics.pauseCount}p)
              </b>
            </div>
          </div>
          <label
            style={{ textAlign: 'center', display: 'block', marginTop: '6px' }}
          >
            Rate Focus Quality
          </label>
          <div className="stars" id="starPicker">
            {[1, 2, 3, 4, 5].map((v) => (
              <button
                key={v}
                type="button"
                className={v <= refRating ? 'lit' : ''}
                onClick={() => setRefRating(v)}
                aria-label={`Rate ${v} stars`}
              >
                ★
              </button>
            ))}
          </div>
          <textarea
            name="note"
            rows={3}
            maxLength={300}
            value={refNote}
            onChange={(e) => setRefNote(e.target.value)}
            placeholder="What did you accomplish or learn in this session?"
          />
          <div className="row">
            <button className="em-btn g" type="submit">
              Save &amp; Log Session
            </button>
            <button
              type="button"
              className="dg-btn"
              onClick={onDiscardSession}
            >
              Discard
            </button>
          </div>
        </form>
      )}

      {modal.type === 'manualSession' && (
        <form
          id="manualSesForm"
          onSubmit={(e) => {
            e.preventDefault();
            const [sh, sm] = msStartTime.split(':').map(Number);
            const [eh, em] = msEndTime.split(':').map(Number);
            const [yr, mo, dy] = msDayKey.split('-').map(Number);
            const startTs = new Date(yr, mo - 1, dy, sh, sm).getTime();
            let endTs = new Date(yr, mo - 1, dy, eh, em).getTime();
            if (endTs <= startTs) endTs += 86400000;
            const pausedMs = Math.max(0, (Number(msPauseMins) || 0) * 60000);
            const activeMs = Math.max(60000, endTs - startTs - pausedMs);
            const purity = Math.round((activeMs / (activeMs + pausedMs)) * 100);

            onSaveManualSession(modal.id, {
              subjectId: msSubId,
              dayKey: msDayKey,
              startTs,
              endTs,
              activeMs,
              pausedMs,
              pauseCount: pausedMs > 0 ? 1 : 0,
              overtimeMs: 0,
              purity,
              mode: 'manual',
              rating: Math.min(5, Math.max(1, Number(msRating) || 5)),
              note: msNote.trim(),
              updatedAt: Date.now(),
            });
          }}
        >
          <h3>{existingSes ? 'Edit Logged Session' : 'Manual Study Entry'}</h3>
          <label>
            Subject
            <select
              name="subjectId"
              value={msSubId}
              onChange={(e) => setMsSubId(e.target.value)}
            >
              {state.subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.e} {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Logical Date
            <input
              type="date"
              name="dayKey"
              value={msDayKey}
              onChange={(e) => setMsDayKey(e.target.value)}
              required
            />
          </label>
          <div className="row">
            <label className="g">
              Start Time
              <input
                type="time"
                name="startTime"
                value={msStartTime}
                onChange={(e) => setMsStartTime(e.target.value)}
                required
              />
            </label>
            <label className="g">
              End Time
              <input
                type="time"
                name="endTime"
                value={msEndTime}
                onChange={(e) => setMsEndTime(e.target.value)}
                required
              />
            </label>
          </div>
          <div className="row">
            <label className="g">
              Paused (mins)
              <input
                type="number"
                name="pauseMins"
                min={0}
                max={300}
                value={msPauseMins}
                onChange={(e) => setMsPauseMins(Number(e.target.value))}
              />
            </label>
            <label className="g">
              Focus Stars (1–5)
              <input
                type="number"
                name="rating"
                min={1}
                max={5}
                value={msRating}
                onChange={(e) => setMsRating(Number(e.target.value))}
              />
            </label>
          </div>
          <label>
            Study Note
            <input
              name="note"
              value={msNote}
              onChange={(e) => setMsNote(e.target.value)}
              placeholder="Topics covered..."
            />
          </label>
          <div className="row">
            <button className="pri g" type="submit">
              Save Session
            </button>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
          {existingSes && (
            <button
              type="button"
              className="dg-btn"
              onClick={() => onDeleteSession(existingSes.id)}
            >
              Delete Session
            </button>
          )}
        </form>
      )}

      {modal.type === 'timerConfig' && (
        <form
          id="cfgTimerForm"
          onSubmit={(e) => {
            e.preventDefault();
            onSaveTimerConfig(
              Math.max(5, Number(cfgPomoWork) || 25),
              Math.max(1, Number(cfgPomoBreak) || 5),
              Math.max(5, Number(cfgCountdown) || 45)
            );
          }}
        >
          <h3>Timer Durations</h3>
          <div className="row">
            <label className="g">
              Pomodoro Work (min)
              <input
                type="number"
                name="pomoWork"
                min={5}
                max={180}
                value={cfgPomoWork}
                onChange={(e) => setCfgPomoWork(Number(e.target.value))}
              />
            </label>
            <label className="g">
              Pomodoro Break (min)
              <input
                type="number"
                name="pomoBreak"
                min={1}
                max={60}
                value={cfgPomoBreak}
                onChange={(e) => setCfgPomoBreak(Number(e.target.value))}
              />
            </label>
          </div>
          <label>
            Default Countdown Target (min)
            <input
              type="number"
              name="countdownMins"
              min={5}
              max={360}
              value={cfgCountdown}
              onChange={(e) => setCfgCountdown(Number(e.target.value))}
            />
          </label>
          <div className="row">
            <button className="pri g" type="submit">
              Save
            </button>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {modal.type === 'dday' && (
        <form
          id="ddayForm"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ddTitle.trim()) return;
            onSaveDDay(modal.id, {
              title: ddTitle.trim(),
              date: ddDate,
              e: ddEmoji.trim() || '🎓',
              color: ddColor || '#10b981',
            });
          }}
        >
          <h3>{modal.id ? 'Edit' : 'New'} D-Day Countdown</h3>
          <div className="row">
            <input
              className="em"
              name="e"
              value={ddEmoji}
              onChange={(e) => setDdEmoji(e.target.value)}
              maxLength={4}
              aria-label="D-Day Emoji"
            />
            <input
              name="title"
              value={ddTitle}
              onChange={(e) => setDdTitle(e.target.value)}
              placeholder="e.g. Midterm Exam"
              required
              maxLength={40}
              aria-label="D-Day Title"
            />
          </div>
          <div className="row">
            <label className="g">
              Target Date
              <input
                type="date"
                name="date"
                value={ddDate}
                onChange={(e) => setDdDate(e.target.value)}
                required
              />
            </label>
            <label className="g">
              Badge Color
              <input
                type="color"
                name="color"
                value={ddColor}
                onChange={(e) => setDdColor(e.target.value)}
                style={{ height: '42px', padding: '4px' }}
              />
            </label>
          </div>
          <div className="row">
            <button className="pri g" type="submit">
              Save D-Day
            </button>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
          {modal.id && existingDDay && (
            <button
              type="button"
              className="dg-btn"
              onClick={() => onDeleteDDay(modal.id!)}
            >
              Remove D-Day
            </button>
          )}
        </form>
      )}

      {modal.type === 'confirmReset' && (
        <div style={{ display: 'grid', gap: '12px' }}>
          <h3>Erase All Device Data?</h3>
          <small>
            This will reset all study sessions, habits, and 10-minute plans on this
            device. Export a JSON backup first if you want to keep your records.
          </small>
          <div className="row">
            <button
              type="button"
              className="dg-btn g"
              onClick={onConfirmReset}
            >
              Erase Everything
            </button>
            <button type="button" className="g" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
};
