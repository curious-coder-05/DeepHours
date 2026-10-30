import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  DDay,
  Habit,
  HabitCategory,
  HabitSchedule,
  MockSubjectScore,
  MockTest,
  PulseHabitState,
  StudySession,
  TimerMetrics,
} from '../types';
import {
  CATS,
  DN,
  addD,
  computeMockScore,
  fmtHMS,
  getSessionHeading,
  mkHabit,
  pad,
} from '../utils/studyLogic';

export type ModalState =
  | { type: 'none' }
  | { type: 'habit'; id?: string }
  | { type: 'reflect'; metrics: TimerMetrics }
  | { type: 'manualSession'; id?: string; defaultSubjectId?: string }
  | { type: 'mock'; id?: string }
  | { type: 'timerConfig' }
  | { type: 'dday'; id?: string }
  | { type: 'confirmReset' }
  | { type: 'confirmResetHour'; newHour: number };

interface ModalsProps {
  modal: ModalState;
  state: PulseHabitState;
  sel: string;
  todayKey: string;
  onClose: () => void;
  onSaveHabit: (id: string | undefined, data: Partial<Habit>) => void;
  onArchiveHabit: (id: string) => void;
  onDeleteHabit: (id: string) => void;
  onSubmitReflection: (
    subjectId: string,
    heading: string,
    rating: number,
    note: string
  ) => void;
  onDiscardSession: () => void;
  onSaveManualSession: (id: string | undefined, session: Omit<StudySession, 'id'>) => void;
  onDeleteSession: (id: string) => void;
  onSaveMock: (id: string | undefined, mock: Omit<MockTest, 'id'>) => void;
  onDeleteMock: (id: string) => void;
  onSaveTimerConfig: (pomoWork: number, pomoBreak: number, countdownMins: number) => void;
  onSaveDDay: (id: string | undefined, data: Omit<DDay, 'id'>) => void;
  onDeleteDDay: (id: string) => void;
  onConfirmReset: () => void;
  onConfirmResetHour: (newHour: number) => void;
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
  onSubmitReflection,
  onDiscardSession,
  onSaveManualSession,
  onDeleteSession,
  onSaveMock,
  onDeleteMock,
  onSaveTimerConfig,
  onSaveDDay,
  onDeleteDDay,
  onConfirmReset,
  onConfirmResetHour,
}) => {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const activeSubjects = useMemo(
    () => state.subjects.filter((s) => !s.arch),
    [state.subjects]
  );

  // Keep latest references so the modal-open effect only runs when the active modal changes,
  // preventing keystrokes or background timer ticks from resetting form inputs.
  const stateRef = useRef(state);
  stateRef.current = state;
  const selRef = useRef(sel);
  selRef.current = sel;
  const todayKeyRef = useRef(todayKey);
  todayKeyRef.current = todayKey;
  const activeSubjectsRef = useRef(activeSubjects);
  activeSubjectsRef.current = activeSubjects;
  const modalRef = useRef(modal);
  modalRef.current = modal;

  const modalKey =
    modal.type === 'none'
      ? 'none'
      : modal.type === 'confirmResetHour'
        ? `confirmResetHour:${modal.newHour}`
        : modal.type === 'reflect'
          ? `reflect:${modal.metrics.subject?.id || ''}:${modal.metrics.heading || ''}`
          : `${modal.type}:${'id' in modal ? modal.id || 'new' : ''}:${'defaultSubjectId' in modal ? modal.defaultSubjectId || '' : ''}`;

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
  const [hAutoStudy, setHAutoStudy] = useState(
    Boolean(defaultHabit.subjectId || defaultHabit.autoMins)
  );
  const [hSubjectId, setHSubjectId] = useState(defaultHabit.subjectId || 'any');
  const [hWeeklyN, setHWeeklyN] = useState(defaultHabit.n);
  const [hRem, setHRem] = useState(defaultHabit.rem);

  // Reflection modal state
  const [refSubjectId, setRefSubjectId] = useState(
    activeSubjects[0]?.id || 'sub_phy'
  );
  const [refHeading, setRefHeading] = useState('Deep Study Session');
  const [refRating, setRefRating] = useState(5);
  const [refNote, setRefNote] = useState('');

  // Manual Session modal state
  const existingSes =
    modal.type === 'manualSession' && modal.id
      ? state.sessions.find((x) => x.id === modal.id)
      : undefined;
  const [msSubjectId, setMsSubjectId] = useState(
    activeSubjects[0]?.id || 'sub_phy'
  );
  const [msHeading, setMsHeading] = useState('');
  const [msDayKey, setMsDayKey] = useState(sel);
  const [msHours, setMsHours] = useState(1);
  const [msMins, setMsMins] = useState(30);
  const [msStartTime, setMsStartTime] = useState('09:00');
  const [msRating, setMsRating] = useState(5);
  const [msNote, setMsNote] = useState('');

  // Mock Test modal state
  const existingMock =
    modal.type === 'mock' && modal.id
      ? state.mocks.find((x) => x.id === modal.id)
      : undefined;
  const [mockName, setMockName] = useState('');
  const [mockDayKey, setMockDayKey] = useState(todayKey);
  const [mockDurationMins, setMockDurationMins] = useState<string>('180');
  const [mockMarksCorrect, setMockMarksCorrect] = useState<number>(4);
  const [mockMarksLost, setMockMarksLost] = useState<number>(1);
  const [mockMaxMarks, setMockMaxMarks] = useState<number>(720);
  const [mockScores, setMockScores] = useState<
    Record<string, MockSubjectScore>
  >({});
  const [mockNote, setMockNote] = useState('');

  // Timer Config state
  const [cfgPomoWork, setCfgPomoWork] = useState(state.set.pomoWork || 25);
  const [cfgPomoBreak, setCfgPomoBreak] = useState(state.set.pomoBreak || 5);
  const [cfgCountdown, setCfgCountdown] = useState(state.set.countdownMins || 45);

  // D-Day state
  const existingDDay =
    modal.type === 'dday' && modal.id
      ? state.ddays.find((x) => x.id === modal.id)
      : undefined;
  const [ddEmoji, setDdEmoji] = useState('🎯');
  const [ddTitle, setDdTitle] = useState('');
  const [ddDate, setDdDate] = useState(addD(todayKey, 90));
  const [ddColor, setDdColor] = useState('#10b981');

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;

    const curModal = modalRef.current;
    const curState = stateRef.current;
    const curSel = selRef.current;
    const curTodayKey = todayKeyRef.current;
    const curActiveSubjects = activeSubjectsRef.current;

    if (curModal.type === 'none') {
      if (dlg.open) dlg.close();
      return;
    }

    if (curModal.type === 'habit') {
      const h = curModal.id
        ? curState.habits.find((x) => x.id === curModal.id) || mkHabit({}, curTodayKey)
        : mkHabit({}, curTodayKey);
      const isAuto = Boolean(h.subjectId || h.autoMins);
      setHEmoji(h.e);
      setHName(h.name);
      setHCat(h.c);
      setHSch(h.sch);
      setHDays(h.days);
      setHTn(isAuto && h.autoMins ? h.autoMins : h.tn);
      setHTu(h.tu);
      setHAutoStudy(isAuto);
      setHSubjectId(h.subjectId || 'any');
      setHWeeklyN(h.n);
      setHRem(h.rem);
    } else if (curModal.type === 'reflect') {
      setRefSubjectId(
        curModal.metrics.subject?.id || curActiveSubjects[0]?.id || 'sub_phy'
      );
      setRefHeading(curModal.metrics.heading || 'Deep Study Session');
      setRefRating(5);
      setRefNote('');
    } else if (curModal.type === 'manualSession') {
      const ex = curModal.id
        ? curState.sessions.find((x) => x.id === curModal.id)
        : undefined;
      const now = new Date();
      const oneHrAgo = new Date(now.getTime() - 5400000);
      const startD = ex ? new Date(ex.startTs) : oneHrAgo;
      const totalMins = ex
        ? Math.max(1, Math.round((ex.activeMs || 3600000) / 60000))
        : 90;
      setMsSubjectId(
        ex?.subjectId ||
          curModal.defaultSubjectId ||
          curActiveSubjects[0]?.id ||
          'sub_phy'
      );
      setMsHeading(ex ? getSessionHeading(curState, ex) : '');
      setMsDayKey(ex ? ex.dayKey : curSel);
      setMsHours(Math.floor(totalMins / 60));
      setMsMins(totalMins % 60);
      setMsStartTime(`${pad(startD.getHours())}:${pad(startD.getMinutes())}`);
      setMsRating(ex?.rating || 5);
      setMsNote(ex?.note || '');
    } else if (curModal.type === 'mock') {
      const ex = curModal.id
        ? curState.mocks.find((x) => x.id === curModal.id)
        : undefined;
      setMockName(ex?.name || '');
      setMockDayKey(ex?.dayKey || curTodayKey);
      setMockDurationMins(
        ex?.durationMins !== undefined ? String(ex.durationMins) : '180'
      );
      setMockMarksCorrect(ex?.marksPerCorrect ?? 4);
      setMockMarksLost(
        ex?.marksPerWrong !== undefined && Number.isFinite(ex.marksPerWrong)
          ? Math.abs(ex.marksPerWrong)
          : 1
      );
      setMockMaxMarks(ex?.maxMarks ?? 720);
      const initScores: Record<string, MockSubjectScore> = {};
      curState.subjects.forEach((s) => {
        const sc = ex?.subjects?.[s.id];
        initScores[s.id] = {
          correct: Math.max(0, Math.floor(Number(sc?.correct) || 0)),
          wrong: Math.max(0, Math.floor(Number(sc?.wrong) || 0)),
          unattempted: Math.max(0, Math.floor(Number(sc?.unattempted) || 0)),
        };
      });
      setMockScores(initScores);
      setMockNote(ex?.note || '');
    } else if (curModal.type === 'timerConfig') {
      setCfgPomoWork(curState.set.pomoWork || 25);
      setCfgPomoBreak(curState.set.pomoBreak || 5);
      setCfgCountdown(curState.set.countdownMins || 45);
    } else if (curModal.type === 'dday') {
      const d = curModal.id
        ? curState.ddays.find((x) => x.id === curModal.id)
        : undefined;
      setDdEmoji(d?.e || '🎯');
      setDdTitle(d?.title || '');
      setDdDate(d?.date || addD(curTodayKey, 90));
      setDdColor(d?.color || '#10b981');
    }

    if (!dlg.open) {
      try {
        dlg.showModal();
      } catch {
        dlg.setAttribute('open', 'true');
      }
    }
  }, [modalKey]);

  const toggleDayInHabit = (dayIdx: number) => {
    setHDays((prev) =>
      prev.includes(dayIdx) ? prev.filter((x) => x !== dayIdx) : [...prev, dayIdx]
    );
  };

  const storedMarksPerWrong = (() => {
    const raw = Number(mockMarksLost);
    if (!Number.isFinite(raw)) return -1;
    return raw === 0 ? 0 : -Math.abs(raw);
  })();

  const previewMockStats = computeMockScore(
    {
      id: 'preview',
      name: mockName || 'Preview',
      dayKey: mockDayKey,
      marksPerCorrect: mockMarksCorrect,
      marksPerWrong: storedMarksPerWrong,
      maxMarks: mockMaxMarks,
      subjects: mockScores,
      note: '',
      updatedAt: 0,
    },
    state.subjects
  );

  const expectedMaxQuestions =
    mockMarksCorrect > 0 && mockMaxMarks > 0
      ? Math.floor(mockMaxMarks / mockMarksCorrect)
      : 0;
  const exceedsMaxQuestions =
    expectedMaxQuestions > 0 &&
    previewMockStats.totalQuestions > expectedMaxQuestions;

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
            const targetVal = Math.min(999, Math.max(1, Number(hTn) || 1));
            onSaveHabit(modal.id, {
              name: trimmed,
              e: hEmoji.trim() || '✨',
              c: hCat,
              sch: hSch,
              days: hDays.length ? hDays : [0, 1, 2, 3, 4, 5, 6],
              n: Math.min(7, Math.max(1, Number(hWeeklyN) || 3)),
              tn: targetVal,
              tu: hAutoStudy ? 'min' : hTu.trim(),
              rem: hRem,
              subjectId: hAutoStudy ? hSubjectId || 'any' : '',
              autoMins: hAutoStudy ? targetVal : 0,
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
              placeholder="e.g. Study 180 mins of Physics"
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
              Daily Target {hAutoStudy ? '(Minutes)' : ''}
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
                value={hAutoStudy ? 'min' : hTu}
                onChange={(e) => setHTu(e.target.value)}
                maxLength={12}
                placeholder="min, pages, MCQs"
                disabled={hAutoStudy}
              />
            </label>
          </div>
          <label className="row" style={{ marginTop: '10px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              style={{ width: 'auto' }}
              checked={hAutoStudy}
              onChange={(e) => setHAutoStudy(e.target.checked)}
            />
            🔗 Auto-complete from study timer minutes logged today
          </label>
          {hAutoStudy && (
            <label style={{ marginTop: '6px', display: 'block' }}>
              Count Study Minutes From Subject
              <select
                value={hSubjectId}
                onChange={(e) => setHSubjectId(e.target.value)}
              >
                <option value="any">All Subjects Combined</option>
                {activeSubjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.e} {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
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

      {modal.type === 'reflect' && (
        <form
          id="reflectForm"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmitReflection(
              refSubjectId,
              refHeading.trim() || 'Deep Study Session',
              refRating,
              refNote.trim()
            );
          }}
        >
          <h3>🎉 Session Complete!</h3>
          <div className="stat-mini">
            <div className="stat-box">
              <small>Studied Duration</small>
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

          <label style={{ display: 'block', marginTop: '6px' }}>
            Subject
          </label>
          <div className="chips" style={{ marginBottom: '6px' }}>
            {activeSubjects.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`sub-chip ${refSubjectId === s.id ? 'active' : ''}`}
                style={{ '--sc': s.color } as React.CSSProperties}
                onClick={() => setRefSubjectId(s.id)}
              >
                <i className="dot" style={{ '--sc': s.color } as React.CSSProperties} />{' '}
                {s.e} {s.name}
              </button>
            ))}
          </div>

          <label>
            Session Heading (What did you study?)
            <input
              type="text"
              value={refHeading}
              onChange={(e) => setRefHeading(e.target.value)}
              placeholder="e.g. Electrostatics — Gauss Law PYQs"
              required
              maxLength={90}
            />
          </label>
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
          <label>
            What did you do in this session?
            <textarea
              name="note"
              rows={3}
              maxLength={300}
              value={refNote}
              onChange={(e) => setRefNote(e.target.value)}
              placeholder="Summarize NCERT pages read, PYQs solved, or mistakes noted..."
            />
          </label>
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
            const sub = state.subjects.find((s) => s.id === msSubjectId);
            const headingClean =
              msHeading.trim() ||
              (sub ? `${sub.name} Study` : 'Deep Study Session');
            const totalDurationMins = Math.max(
              1,
              (Number(msHours) || 0) * 60 + (Number(msMins) || 0)
            );
            const activeMs = totalDurationMins * 60000;

            // A1: Use Number.isFinite so 00:xx is preserved as hour 0.
            // Times earlier than dayResetHour belong to the NEXT calendar date of the selected logical day.
            const [shStr, smStr] = msStartTime.split(':');
            const sh = Number(shStr);
            const sm = Number(smStr);
            const safeSh = Number.isFinite(sh) ? sh : 9;
            const safeSm = Number.isFinite(sm) ? sm : 0;
            const [yr, mo, dy] = msDayKey.split('-').map(Number);
            const resetHr = state.set.dayResetHour ?? 4;
            const dayOffset = safeSh < resetHr ? 1 : 0;
            const startTs = new Date(
              yr,
              mo - 1,
              dy + dayOffset,
              safeSh,
              safeSm,
              0,
              0
            ).getTime();
            const endTs = startTs + activeMs;

            onSaveManualSession(modal.id, {
              subjectId: msSubjectId || activeSubjects[0]?.id || 'sub_phy',
              heading: headingClean,
              dayKey: msDayKey,
              startTs,
              endTs,
              activeMs,
              pausedMs: 0,
              pauseCount: 0,
              overtimeMs: 0,
              purity: existingSes ? existingSes.purity : 100,
              mode: existingSes?.mode || 'manual',
              rating: Math.min(5, Math.max(1, Number(msRating) || 5)),
              note: msNote.trim(),
              updatedAt: Date.now(),
            });
          }}
        >
          <h3>{existingSes ? 'Edit Study Session' : 'Log Study Session Manually'}</h3>

          <label style={{ display: 'block', marginBottom: '4px' }}>
            Subject
          </label>
          <div className="chips" style={{ marginBottom: '8px' }}>
            {activeSubjects.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`sub-chip ${msSubjectId === s.id ? 'active' : ''}`}
                style={{ '--sc': s.color } as React.CSSProperties}
                onClick={() => setMsSubjectId(s.id)}
              >
                <i className="dot" style={{ '--sc': s.color } as React.CSSProperties} />{' '}
                {s.e} {s.name}
              </button>
            ))}
          </div>

          <label>
            Session Heading (Chapter / Topic)
            <input
              type="text"
              name="heading"
              value={msHeading}
              onChange={(e) => setMsHeading(e.target.value)}
              placeholder="e.g., Rotational Motion PYQs"
              required
              maxLength={90}
            />
          </label>
          <div className="row">
            <label className="g">
              Hours Studied
              <input
                type="number"
                name="hours"
                min={0}
                max={24}
                value={msHours}
                onChange={(e) => setMsHours(Math.max(0, Number(e.target.value)))}
              />
            </label>
            <label className="g">
              Minutes Studied
              <input
                type="number"
                name="mins"
                min={0}
                max={59}
                value={msMins}
                onChange={(e) => setMsMins(Math.max(0, Number(e.target.value)))}
              />
            </label>
          </div>
          <div className="row">
            <label className="g">
              Logical Study Date
              <input
                type="date"
                name="dayKey"
                value={msDayKey}
                onChange={(e) => setMsDayKey(e.target.value)}
                required
              />
            </label>
            <label className="g">
              Start Time (for 24h timeline)
              <input
                type="time"
                name="startTime"
                value={msStartTime}
                onChange={(e) => setMsStartTime(e.target.value)}
                required
              />
            </label>
          </div>
          <label>
            What did you do in this session?
            <textarea
              name="note"
              rows={3}
              maxLength={300}
              value={msNote}
              onChange={(e) => setMsNote(e.target.value)}
              placeholder="e.g., Completed NCERT reading and solved 45 questions..."
            />
          </label>
          <label>
            Focus Rating (1–5 Stars)
            <input
              type="number"
              name="rating"
              min={1}
              max={5}
              value={msRating}
              onChange={(e) => setMsRating(Number(e.target.value))}
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

      {modal.type === 'mock' && (
        <form
          id="mockForm"
          onSubmit={(e) => {
            e.preventDefault();
            const cleanName = mockName.trim() || 'NEET Mock Test';
            const durNum = Number(mockDurationMins);
            const clampedSubjects: Record<string, MockSubjectScore> = {};
            for (const [subId, sc] of Object.entries(mockScores)) {
              clampedSubjects[subId] = {
                correct: Math.max(0, Math.floor(Number(sc?.correct) || 0)),
                wrong: Math.max(0, Math.floor(Number(sc?.wrong) || 0)),
                unattempted: Math.max(0, Math.floor(Number(sc?.unattempted) || 0)),
              };
            }
            onSaveMock(modal.id, {
              name: cleanName,
              dayKey: mockDayKey || todayKey,
              durationMins:
                mockDurationMins.trim() && Number.isFinite(durNum) && durNum > 0
                  ? Math.round(durNum)
                  : undefined,
              marksPerCorrect: Number.isFinite(Number(mockMarksCorrect))
                ? Number(mockMarksCorrect)
                : 4,
              marksPerWrong: storedMarksPerWrong,
              maxMarks:
                Number.isFinite(Number(mockMaxMarks)) && Number(mockMaxMarks) > 0
                  ? Number(mockMaxMarks)
                  : 720,
              subjects: clampedSubjects,
              note: mockNote.trim(),
              updatedAt: Date.now(),
            });
          }}
        >
          <h3>{existingMock ? 'Edit Mock Test' : 'Log NEET Mock Test'}</h3>
          <label>
            Test Name / Series
            <input
              type="text"
              value={mockName}
              onChange={(e) => setMockName(e.target.value)}
              placeholder="e.g. Allen Major Test #4 / Aakash FTS-02"
              required
              maxLength={80}
            />
          </label>
          <div className="row">
            <label className="g">
              Date
              <input
                type="date"
                value={mockDayKey}
                onChange={(e) => setMockDayKey(e.target.value)}
                required
              />
            </label>
            <label className="g">
              Duration (mins, optional)
              <input
                type="number"
                min={10}
                max={300}
                value={mockDurationMins}
                onChange={(e) => setMockDurationMins(e.target.value)}
                placeholder="180"
              />
            </label>
          </div>
          <div className="row">
            <label className="g">
              +Correct Marks
              <input
                type="number"
                step="0.5"
                min={0.5}
                value={mockMarksCorrect}
                onChange={(e) => setMockMarksCorrect(Number(e.target.value))}
              />
            </label>
            <label className="g">
              Marks lost per wrong answer
              <input
                type="number"
                min={0}
                step="0.25"
                value={mockMarksLost}
                onChange={(e) =>
                  setMockMarksLost(Math.max(0, Number(e.target.value) || 0))
                }
              />
            </label>
            <label className="g">
              Max Marks
              <input
                type="number"
                min={1}
                max={2000}
                value={mockMaxMarks}
                onChange={(e) => setMockMaxMarks(Number(e.target.value))}
              />
            </label>
          </div>

          {exceedsMaxQuestions && (
            <small
              role="status"
              style={{
                display: 'block',
                marginTop: '6px',
                padding: '6px 10px',
                borderRadius: '8px',
                background: 'color-mix(in srgb, var(--am) 14%, transparent)',
                border: '1px solid color-mix(in srgb, var(--am) 42%, var(--bd))',
                color: '#fbbf24',
                fontWeight: 600,
              }}
            >
              ⚠️ Total questions ({previewMockStats.totalQuestions}) exceed maxMarks /
              marksPerCorrect ({expectedMaxQuestions} questions for {mockMaxMarks} max
              marks).
            </small>
          )}

          <div
            style={{
              border: '1px solid var(--bd)',
              borderRadius: '12px',
              padding: '10px',
              marginTop: '6px',
              display: 'grid',
              gap: '8px',
            }}
          >
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <small style={{ fontWeight: 700, color: 'var(--tx)' }}>
                Subject-wise Question Counts
              </small>
              <span className="pill mono" style={{ color: 'var(--em)' }}>
                Score: {previewMockStats.totalScore}/{mockMaxMarks} (
                {previewMockStats.accuracyPct}% acc)
              </span>
            </div>

            {activeSubjects.map((sub) => {
              const sc = mockScores[sub.id] || {
                correct: 0,
                wrong: 0,
                unattempted: 0,
              };
              const subDetail = previewMockStats.bySubject.find(
                (bs) => bs.subjectId === sub.id
              );
              return (
                <div
                  key={sub.id}
                  style={{
                    borderTop: '1px solid var(--bd)',
                    paddingTop: '8px',
                  }}
                >
                  <div
                    className="row"
                    style={{
                      justifyContent: 'space-between',
                      marginBottom: '4px',
                    }}
                  >
                    <b style={{ fontSize: '12px', color: sub.color }}>
                      {sub.e} {sub.name}
                    </b>
                    <small className="mono">
                      {subDetail
                        ? `${subDetail.score} marks · ${subDetail.accuracyPct}% acc`
                        : ''}
                    </small>
                  </div>
                  <div className="row">
                    <label className="g" style={{ margin: 0 }}>
                      Correct
                      <input
                        type="number"
                        min={0}
                        max={200}
                        step={1}
                        value={sc.correct}
                        onChange={(e) =>
                          setMockScores((prev) => ({
                            ...prev,
                            [sub.id]: {
                              ...sc,
                              correct: Math.max(
                                0,
                                Math.floor(Number(e.target.value) || 0)
                              ),
                            },
                          }))
                        }
                      />
                    </label>
                    <label className="g" style={{ margin: 0 }}>
                      Wrong
                      <input
                        type="number"
                        min={0}
                        max={200}
                        step={1}
                        value={sc.wrong}
                        onChange={(e) =>
                          setMockScores((prev) => ({
                            ...prev,
                            [sub.id]: {
                              ...sc,
                              wrong: Math.max(
                                0,
                                Math.floor(Number(e.target.value) || 0)
                              ),
                            },
                          }))
                        }
                      />
                    </label>
                    <label className="g" style={{ margin: 0 }}>
                      Unattempted
                      <input
                        type="number"
                        min={0}
                        max={200}
                        step={1}
                        value={sc.unattempted}
                        onChange={(e) =>
                          setMockScores((prev) => ({
                            ...prev,
                            [sub.id]: {
                              ...sc,
                              unattempted: Math.max(
                                0,
                                Math.floor(Number(e.target.value) || 0)
                              ),
                            },
                          }))
                        }
                      />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>

          <label>
            Mistakes &amp; Analysis Note
            <textarea
              rows={3}
              maxLength={400}
              value={mockNote}
              onChange={(e) => setMockNote(e.target.value)}
              placeholder="Silly mistakes, weak topics to revise before next test..."
            />
          </label>

          <div className="row">
            <button className="pri g" type="submit">
              Save Mock Test
            </button>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
          {existingMock && (
            <button
              type="button"
              className="dg-btn"
              onClick={() => onDeleteMock(existingMock.id)}
            >
              Delete Mock Test
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
            const formTitleInput = e.currentTarget.elements.namedItem(
              'title'
            ) as HTMLInputElement | null;
            const resolvedTitle = (ddTitle || formTitleInput?.value || '').trim();
            if (!resolvedTitle) return;
            onSaveDDay(modal.id, {
              title: resolvedTitle,
              date: ddDate || addD(todayKey, 90),
              e: ddEmoji.trim() || '🎯',
              color: ddColor || '#10b981',
            });
          }}
        >
          <h3>{modal.id ? 'Edit' : 'New'} Exam Countdown</h3>
          <div className="chips wrap" style={{ paddingBottom: 0 }}>
            {[
              { e: '🎯', title: 'NEET UG Exam', color: '#10b981' },
              { e: '🧪', title: 'Grand Mock Test', color: '#6366f1' },
              { e: '📚', title: 'Syllabus Completion', color: '#f59e0b' },
              { e: '🏫', title: 'Board / Term Exam', color: '#ec4899' },
            ].map((preset) => (
              <button
                type="button"
                key={preset.title}
                className="s"
                style={{ fontSize: '11.5px', padding: '4px 9px' }}
                onClick={() => {
                  setDdEmoji(preset.e);
                  setDdTitle(preset.title);
                  setDdColor(preset.color);
                }}
              >
                {preset.e} {preset.title}
              </button>
            ))}
          </div>
          <div className="row">
            <input
              type="text"
              className="em"
              name="e"
              value={ddEmoji}
              onChange={(e) => setDdEmoji(e.target.value)}
              maxLength={4}
              aria-label="D-Day Emoji"
            />
            <input
              type="text"
              id="ddayTitleInput"
              name="title"
              value={ddTitle}
              onChange={(e) => setDdTitle(e.target.value)}
              placeholder="Type custom exam or target name..."
              required
              autoFocus
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

      {modal.type === 'confirmResetHour' && (
        <div style={{ display: 'grid', gap: '12px' }}>
          <h3>Change Day Reset Hour to {pad(modal.newHour)}:00 AM?</h3>
          <small>
            This will recompute the logical study date for all existing study
            sessions and re-sync your auto-study habits across affected days.
          </small>
          <small style={{ color: 'var(--tx)', fontWeight: 600 }}>
            Sessions are re-dated. Habit ticks, tasks, notes, mood and planner blocks keep their original dates.
          </small>
          <div className="row">
            <button
              type="button"
              className="pri g"
              onClick={() => onConfirmResetHour(modal.newHour)}
            >
              Confirm &amp; Recalculate
            </button>
            <button type="button" className="g" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {modal.type === 'confirmReset' && (
        <div style={{ display: 'grid', gap: '12px' }}>
          <h3>Erase All Device Data?</h3>
          <small>
            This will reset all study sessions, habits, syllabus chapters, and
            mock tests on this device to a clean blank state. Export a JSON
            backup first if you want to keep your records.
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
