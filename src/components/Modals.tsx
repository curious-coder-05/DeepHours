import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Star } from 'lucide-react';
import type {
  DDay,
  Habit,
  HabitCategory,
  HabitSchedule,
  MistakeReason,
  MockSubjectScore,
  MockTest,
  PulseHabitState,
  StudySession,
  TimerMetrics,
} from '../types';
import {
  ACS,
  CATS,
  DN,
  SUB_COLORS,
  addD,
  computeMockScore,
  fmtHMS,
  getSessionHeading,
  mkHabit,
  pad,
} from '../utils/studyLogic';
import { Button, Chip, Dialog, Field, Select, type SelectOption, Sheet, Stat, Switch } from './ui';

export type ModalState =
  | { type: 'none' }
  | { type: 'habit'; id?: string }
  | { type: 'reflect'; metrics: TimerMetrics }
  | {
      type: 'manualSession';
      id?: string;
      defaultSubjectId?: string;
      defaultChapterId?: string;
    }
  | {
      type: 'mock';
      id?: string;
      prefillDurationMins?: number;
      prefillNote?: string;
      prefillDayKey?: string;
    }
  | { type: 'timerConfig' }
  | { type: 'dday'; id?: string }
  | { type: 'confirmReset' }
  | { type: 'confirmResetHour'; newHour: number };

export interface QueuedMockMistake {
  subjectId: string;
  chapterId?: string;
  reason: MistakeReason;
  note?: string;
}

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
    note: string,
    chapterId?: string
  ) => void;
  onDiscardSession: () => void;
  onSaveManualSession: (id: string | undefined, session: Omit<StudySession, 'id'>) => void;
  onDeleteSession: (id: string) => void;
  onSaveMock: (
    id: string | undefined,
    mock: Omit<MockTest, 'id'>,
    queuedMistakes?: QueuedMockMistake[],
    openMistakesTab?: boolean
  ) => void;
  onDeleteMock: (id: string) => void;
  onSaveTimerConfig: (
    pomoWork: number,
    pomoBreak: number,
    countdownMins: number,
    fullMockMins?: number
  ) => void;
  onSaveDDay: (id: string | undefined, data: Omit<DDay, 'id'>) => void;
  onDeleteDDay: (id: string) => void;
  onConfirmReset: () => void;
  onConfirmResetHour: (newHour: number) => void;
}

const HABIT_CATEGORY_OPTIONS: SelectOption<HabitCategory>[] = CATS.map((c) => ({
  value: c,
  label: c,
}));

const HABIT_SCHEDULE_OPTIONS: SelectOption<HabitSchedule>[] = [
  { value: 'daily', label: 'Every day' },
  { value: 'days', label: 'Specific days' },
  { value: 'week', label: 'X times per week' },
];

const MISTAKE_REASON_OPTIONS: SelectOption<MistakeReason>[] = [
  { value: 'concept', label: 'Concept gap' },
  { value: 'silly', label: 'Silly / calculation' },
  { value: 'time', label: 'Time pressure' },
  { value: 'guess', label: 'Guess / 50-50' },
  { value: 'forgot', label: 'Forgot formula or fact' },
];

const DDAY_COLORS = Array.from(
  new Set(['#10b981', '#6366f1', '#f59e0b', '#ec4899', ...SUB_COLORS, ...ACS])
);

const DDAY_COLOR_LABELS: Record<string, string> = {
  '#10b981': 'Emerald',
  '#6366f1': 'Indigo',
  '#f59e0b': 'Amber',
  '#ec4899': 'Rose',
  '#3b82f6': 'Blue',
  '#8b5cf6': 'Violet',
  '#14b8a6': 'Teal',
  '#38bdf8': 'Sky',
  '#34d399': 'Mint',
  '#a78bfa': 'Lavender',
  '#f472b6': 'Pink',
  '#fbbf24': 'Gold',
};

const DDAY_COLOR_OPTIONS: SelectOption<string>[] = DDAY_COLORS.map((hex) => ({
  value: hex,
  label: DDAY_COLOR_LABELS[hex.toLowerCase()] || hex.toUpperCase(),
  subtitle: hex.toUpperCase(),
  swatchColor: hex,
}));

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
  const activeSubjects = useMemo(
    () => state.subjects.filter((s) => !s.arch),
    [state.subjects]
  );

  // Keep latest references so modal-open initialization only fires when modalKey changes
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
          ? `reflect:${modal.metrics.subject?.id || ''}:${modal.metrics.chapterId || ''}:${modal.metrics.heading || ''}`
          : modal.type === 'mock'
            ? `mock:${modal.id || 'new'}:${modal.prefillDurationMins || ''}:${modal.prefillDayKey || ''}`
            : `${modal.type}:${'id' in modal ? modal.id || 'new' : ''}:${'defaultSubjectId' in modal ? modal.defaultSubjectId || '' : ''}:${'defaultChapterId' in modal ? modal.defaultChapterId || '' : ''}`;

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
  const [refChapterId, setRefChapterId] = useState('');
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
  const [msChapterId, setMsChapterId] = useState('');
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
  const [mockScores, setMockScores] = useState<Record<string, MockSubjectScore>>({});
  const [mockNote, setMockNote] = useState('');
  const [queuedMistakes, setQueuedMistakes] = useState<QueuedMockMistake[]>([]);
  const [mkMisSubId, setMkMisSubId] = useState(activeSubjects[0]?.id || 'sub_phy');
  const [mkMisChapId, setMkMisChapId] = useState('');
  const [mkMisReason, setMkMisReason] = useState<MistakeReason>('concept');
  const [mkMisNote, setMkMisNote] = useState('');

  // Timer Config state
  const [cfgPomoWork, setCfgPomoWork] = useState(state.set.pomoWork || 25);
  const [cfgPomoBreak, setCfgPomoBreak] = useState(state.set.pomoBreak || 5);
  const [cfgCountdown, setCfgCountdown] = useState(state.set.countdownMins || 45);
  const [cfgFullMock, setCfgFullMock] = useState(state.set.fullMockMins || 180);

  // D-Day state
  const existingDDay =
    modal.type === 'dday' && modal.id
      ? state.ddays.find((x) => x.id === modal.id)
      : undefined;
  const [ddEmoji, setDdEmoji] = useState('🎯');
  const [ddTitle, setDdTitle] = useState('');
  const [ddDate, setDdDate] = useState(addD(todayKey, 90));
  const [ddColor, setDdColor] = useState('#10b981');
  const [ddPrimary, setDdPrimary] = useState(false);

  useEffect(() => {
    const curModal = modalRef.current;
    const curState = stateRef.current;
    const curSel = selRef.current;
    const curTodayKey = todayKeyRef.current;
    const curActiveSubjects = activeSubjectsRef.current;

    if (curModal.type === 'none') return;

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
      setRefChapterId(curModal.metrics.chapterId || '');
      setRefHeading(curModal.metrics.heading || '');
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
      setMsChapterId(ex?.chapterId || curModal.defaultChapterId || '');
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
      setMockName(ex?.name || (curModal.prefillDurationMins ? 'Full Mock Test' : ''));
      setMockDayKey(ex?.dayKey || curModal.prefillDayKey || curTodayKey);
      setMockDurationMins(
        ex?.durationMins !== undefined
          ? String(ex.durationMins)
          : curModal.prefillDurationMins !== undefined
            ? String(curModal.prefillDurationMins)
            : '180'
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
      setMockNote(ex?.note || curModal.prefillNote || '');
      setQueuedMistakes([]);
      setMkMisSubId(curActiveSubjects[0]?.id || 'sub_phy');
      setMkMisChapId('');
      setMkMisReason('concept');
      setMkMisNote('');
    } else if (curModal.type === 'timerConfig') {
      setCfgPomoWork(curState.set.pomoWork || 25);
      setCfgPomoBreak(curState.set.pomoBreak || 5);
      setCfgCountdown(curState.set.countdownMins || 45);
      setCfgFullMock(curState.set.fullMockMins || 180);
    } else if (curModal.type === 'dday') {
      const d = curModal.id
        ? curState.ddays.find((x) => x.id === curModal.id)
        : undefined;
      setDdEmoji(d?.e || '🎯');
      setDdTitle(d?.title || '');
      setDdDate(d?.date || addD(curTodayKey, 90));
      setDdColor(d?.color || '#10b981');
      setDdPrimary(Boolean(d?.primary ?? curState.ddays.length === 0));
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

  const autoSubjectOptions: SelectOption<string>[] = [
    { value: 'any', label: 'All subjects combined' },
    ...activeSubjects.map((s) => ({
      value: s.id,
      label: `${s.e} ${s.name}`,
      swatchColor: s.color,
    })),
  ];

  const subjectSelectOptions: SelectOption<string>[] = activeSubjects.map((s) => ({
    value: s.id,
    label: `${s.e} ${s.name}`,
    swatchColor: s.color,
  }));

  const buildChapterOptions = (subjectId: string, emptyLabel = 'Any / general'): SelectOption<string>[] => [
    { value: '', label: emptyLabel },
    ...state.chapters
      .filter((ch) => ch.subjectId === subjectId)
      .map((ch) => ({ value: ch.id, label: ch.name })),
  ];

  const sheetTitle =
    modal.type === 'habit'
      ? modal.id
        ? 'Edit habit'
        : 'New habit'
      : modal.type === 'reflect'
        ? 'Session complete'
        : modal.type === 'manualSession'
          ? existingSes
            ? 'Edit study session'
            : 'Log study session'
          : modal.type === 'mock'
            ? existingMock
              ? 'Edit mock test'
              : 'Log NEET mock test'
            : modal.type === 'timerConfig'
              ? 'Timer durations'
              : modal.type === 'dday'
                ? modal.id
                  ? 'Edit exam countdown'
                  : 'New exam countdown'
                : undefined;

  const isSheetOpen =
    modal.type === 'habit' ||
    modal.type === 'reflect' ||
    modal.type === 'manualSession' ||
    modal.type === 'mock' ||
    modal.type === 'timerConfig' ||
    modal.type === 'dday';

  return (
    <>
      <Sheet
        open={isSheetOpen}
        onClose={onClose}
        title={sheetTitle}
        snap={modal.type === 'mock' || modal.type === 'manualSession' ? 'tall' : 'auto'}
      >
        {modal.type === 'habit' && (
          <form
            id="hf"
            style={{ display: 'grid', gap: '12px' }}
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
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                className="em"
                name="e"
                value={hEmoji}
                onChange={(e) => setHEmoji(e.target.value)}
                maxLength={4}
                aria-label="Habit Emoji"
                style={{ width: '56px', textAlign: 'center', flexShrink: 0 }}
              />
              <input
                name="name"
                value={hName}
                onChange={(e) => setHName(e.target.value)}
                placeholder="e.g. Study 180 mins of Physics"
                required
                autoFocus
                maxLength={60}
                aria-label="Habit Name"
                style={{ flex: 1, minWidth: 0 }}
              />
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: '10px',
              }}
            >
              <Field label="Category">
                <Select
                  aria-label="Habit category"
                  title="Category"
                  value={hCat}
                  options={HABIT_CATEGORY_OPTIONS}
                  onChange={setHCat}
                />
              </Field>
              <Field label="Schedule">
                <Select
                  aria-label="Habit schedule"
                  title="Schedule"
                  value={hSch}
                  options={HABIT_SCHEDULE_OPTIONS}
                  onChange={setHSch}
                />
              </Field>
            </div>

            <Field label="Active days">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {DN.map((d, i) => (
                  <Chip
                    key={d}
                    selected={hDays.includes(i)}
                    onClick={() => toggleDayInHabit(i)}
                  >
                    {d}
                  </Chip>
                ))}
              </div>
            </Field>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: '10px',
              }}
            >
              <Field label={`Daily target ${hAutoStudy ? '(mins)' : ''}`}>
                <input
                  type="number"
                  name="tn"
                  min={1}
                  max={999}
                  value={hTn}
                  onChange={(e) => setHTn(Number(e.target.value))}
                />
              </Field>
              <Field label="Unit">
                <input
                  name="tu"
                  value={hAutoStudy ? 'min' : hTu}
                  onChange={(e) => setHTu(e.target.value)}
                  maxLength={12}
                  placeholder="min, pages, MCQs"
                  disabled={hAutoStudy}
                />
              </Field>
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
                <div style={{ fontSize: '14px', fontWeight: 500 }}>Auto-complete from timer</div>
                <div style={{ fontSize: '12px', color: 'var(--tx-2)' }}>
                  Tracks study minutes logged for today
                </div>
              </div>
              <Switch
                aria-label="Auto-complete from study timer"
                checked={hAutoStudy}
                onChange={setHAutoStudy}
              />
            </div>

            {hAutoStudy && (
              <Field label="Count study minutes from subject">
                <Select
                  aria-label="Count study minutes from subject"
                  title="Subject filter"
                  value={hSubjectId}
                  options={autoSubjectOptions}
                  onChange={setHSubjectId}
                />
              </Field>
            )}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: '10px',
              }}
            >
              <Field label="Times per week">
                <input
                  type="number"
                  name="n"
                  min={1}
                  max={7}
                  value={hWeeklyN}
                  onChange={(e) => setHWeeklyN(Number(e.target.value))}
                />
              </Field>
              <Field label="Reminder">
                <input
                  type="time"
                  name="rem"
                  value={hRem}
                  onChange={(e) => setHRem(e.target.value)}
                />
              </Field>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <Button variant="secondary" onClick={onClose} style={{ flex: 1 }}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" style={{ flex: 2 }}>
                Save Habit
              </Button>
            </div>

            {modal.id && existingHabit && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <Button
                  variant="secondary"
                  style={{ flex: 1 }}
                  onClick={() => onArchiveHabit(modal.id!)}
                >
                  {existingHabit.arch ? 'Unarchive' : 'Archive'}
                </Button>
                <Button
                  variant="danger"
                  style={{ flex: 1 }}
                  onClick={() => onDeleteHabit(modal.id!)}
                >
                  Delete
                </Button>
              </div>
            )}
          </form>
        )}

        {modal.type === 'reflect' && (
          <form
            id="reflectForm"
            style={{ display: 'grid', gap: '12px' }}
            onSubmit={(e) => {
              e.preventDefault();
              const chosenChapter = refChapterId
                ? state.chapters.find((c) => c.id === refChapterId)
                : undefined;
              const sub = state.subjects.find((s) => s.id === refSubjectId);
              const resolvedHeading =
                refHeading.trim() ||
                chosenChapter?.name ||
                (sub ? `${sub.name} Study` : 'Deep Study Session');
              onSubmitReflection(
                refSubjectId,
                resolvedHeading,
                refRating,
                refNote.trim(),
                refChapterId || undefined
              );
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: '10px',
              }}
            >
              <Stat
                label="Studied duration"
                value={fmtHMS(modal.metrics.sliceActiveMs)}
                tone="ok"
              />
              <Stat
                label="Focus purity"
                value={`${modal.metrics.purity}% (${modal.metrics.pauseCount}p)`}
              />
            </div>

            <Field label="Subject">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {activeSubjects.map((s) => (
                  <Chip
                    key={s.id}
                    selected={refSubjectId === s.id}
                    colorDot={s.color}
                    onClick={() => {
                      setRefSubjectId(s.id);
                      setRefChapterId('');
                    }}
                  >
                    {s.e} {s.name}
                  </Chip>
                ))}
              </div>
            </Field>

            <Field label="Chapter (optional)">
              <Select
                aria-label="Session chapter"
                title="Chapter"
                value={refChapterId}
                options={buildChapterOptions(refSubjectId)}
                onChange={setRefChapterId}
              />
            </Field>

            <Field label="Session heading" hint="Defaults to chapter or subject if left blank">
              <input
                type="text"
                value={refHeading}
                onChange={(e) => setRefHeading(e.target.value)}
                placeholder="e.g. Electrostatics — Gauss Law PYQs"
                maxLength={90}
              />
            </Field>

            <Field label="Focus quality">
              <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
                {[1, 2, 3, 4, 5].map((v) => {
                  const lit = v <= refRating;
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setRefRating(v)}
                      aria-label={`Rate ${v} stars`}
                      aria-pressed={lit}
                      style={{
                        width: '44px',
                        height: '44px',
                        padding: 0,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: lit ? 'var(--ac-soft)' : 'var(--sf-2)',
                        borderColor: lit ? 'var(--ac)' : 'var(--line)',
                        color: lit ? 'var(--ac-ink)' : 'var(--tx-3)',
                      }}
                    >
                      <Star
                        size={20}
                        strokeWidth={1.75}
                        fill={lit ? 'currentColor' : 'none'}
                        aria-hidden="true"
                      />
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field label="What did you cover?">
              <textarea
                name="note"
                rows={3}
                maxLength={300}
                value={refNote}
                onChange={(e) => setRefNote(e.target.value)}
                placeholder="Summarize NCERT pages read, PYQs solved, or mistakes noted..."
              />
            </Field>

            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <Button variant="danger" onClick={onDiscardSession}>
                Discard
              </Button>
              <Button variant="primary" type="submit" style={{ flex: 1 }}>
                Save &amp; Log Session
              </Button>
            </div>
          </form>
        )}

        {modal.type === 'manualSession' && (
          <form
            id="manualSesForm"
            style={{ display: 'grid', gap: '12px' }}
            onSubmit={(e) => {
              e.preventDefault();
              const sub = state.subjects.find((s) => s.id === msSubjectId);
              const chosenChapter = msChapterId
                ? state.chapters.find((c) => c.id === msChapterId)
                : undefined;
              const headingClean =
                msHeading.trim() ||
                chosenChapter?.name ||
                (sub ? `${sub.name} Study` : 'Deep Study Session');
              const totalDurationMins = Math.min(
                1440,
                Math.max(1, (Number(msHours) || 0) * 60 + (Number(msMins) || 0))
              );
              const activeMs = totalDurationMins * 60000;
              if (!/^\d{4}-\d{2}-\d{2}$/.test(msDayKey)) return;

              const [shStr, smStr] = msStartTime.split(':');
              const sh = Number(shStr);
              const sm = Number(smStr);
              const safeSh = Number.isFinite(sh) ? sh : 9;
              const safeSm = Number.isFinite(sm) ? sm : 0;
              const [yr, mo, dy] = msDayKey.split('-').map(Number);
              const resetHr = state.set.dayResetHour ?? 0;
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
                chapterId: msChapterId || undefined,
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
                source:
                  existingSes?.source ||
                  (existingSes && existingSes.mode !== 'manual' ? 'timer' : 'manual'),
                rating: Math.min(5, Math.max(1, Number(msRating) || 5)),
                note: msNote.trim(),
                updatedAt: Date.now(),
              });
            }}
          >
            <Field label="Subject">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {activeSubjects.map((s) => (
                  <Chip
                    key={s.id}
                    selected={msSubjectId === s.id}
                    colorDot={s.color}
                    onClick={() => {
                      setMsSubjectId(s.id);
                      setMsChapterId('');
                    }}
                  >
                    {s.e} {s.name}
                  </Chip>
                ))}
              </div>
            </Field>

            <Field label="Chapter (optional)">
              <Select
                aria-label="Manual session chapter"
                title="Chapter"
                value={msChapterId}
                options={buildChapterOptions(msSubjectId)}
                onChange={setMsChapterId}
              />
            </Field>

            <Field label="Session heading" hint="Defaults to chapter if blank">
              <input
                type="text"
                name="heading"
                value={msHeading}
                onChange={(e) => setMsHeading(e.target.value)}
                placeholder="e.g., Rotational Motion PYQs"
                maxLength={90}
              />
            </Field>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: '10px',
              }}
            >
              <Field label="Hours studied">
                <input
                  type="number"
                  name="hours"
                  min={0}
                  max={24}
                  value={msHours}
                  onChange={(e) => setMsHours(Math.max(0, Number(e.target.value)))}
                />
              </Field>
              <Field label="Minutes studied">
                <input
                  type="number"
                  name="mins"
                  min={0}
                  max={59}
                  value={msMins}
                  onChange={(e) => setMsMins(Math.max(0, Number(e.target.value)))}
                />
              </Field>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: '10px',
              }}
            >
              <Field label="Logical study date">
                <input
                  type="date"
                  name="dayKey"
                  value={msDayKey}
                  onChange={(e) => setMsDayKey(e.target.value)}
                  required
                />
              </Field>
              <Field label="Start time">
                <input
                  type="time"
                  name="startTime"
                  value={msStartTime}
                  onChange={(e) => setMsStartTime(e.target.value)}
                  required
                />
              </Field>
            </div>

            <Field label="What did you cover?">
              <textarea
                name="note"
                rows={3}
                maxLength={300}
                value={msNote}
                onChange={(e) => setMsNote(e.target.value)}
                placeholder="e.g., Completed NCERT reading and solved 45 questions..."
              />
            </Field>

            <Field label="Focus rating (1–5)">
              <input
                type="number"
                name="rating"
                min={1}
                max={5}
                value={msRating}
                onChange={(e) => setMsRating(Number(e.target.value))}
              />
            </Field>

            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <Button variant="secondary" onClick={onClose} style={{ flex: 1 }}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" style={{ flex: 2 }}>
                Save Session
              </Button>
            </div>

            {existingSes && (
              <Button
                variant="danger"
                fullWidth
                onClick={() => onDeleteSession(existingSes.id)}
              >
                Delete Session
              </Button>
            )}
          </form>
        )}

        {modal.type === 'mock' && (
          <form
            id="mockForm"
            style={{ display: 'grid', gap: '12px' }}
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
              onSaveMock(
                modal.id,
                {
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
                },
                queuedMistakes
              );
            }}
          >
            <Field label="Test name / series">
              <input
                type="text"
                value={mockName}
                onChange={(e) => setMockName(e.target.value)}
                placeholder="e.g. Allen Major Test #4 / Aakash FTS-02"
                required
                autoFocus
                maxLength={80}
              />
            </Field>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: '10px',
              }}
            >
              <Field label="Date">
                <input
                  type="date"
                  value={mockDayKey}
                  onChange={(e) => setMockDayKey(e.target.value)}
                  required
                />
              </Field>
              <Field label="Duration (mins)">
                <input
                  type="number"
                  min={10}
                  max={300}
                  value={mockDurationMins}
                  onChange={(e) => setMockDurationMins(e.target.value)}
                  placeholder="180"
                />
              </Field>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gap: '8px',
              }}
            >
              <Field label="+Correct">
                <input
                  type="number"
                  step="0.5"
                  min={0.5}
                  value={mockMarksCorrect}
                  onChange={(e) => setMockMarksCorrect(Number(e.target.value))}
                />
              </Field>
              <Field label="-Wrong">
                <input
                  type="number"
                  min={0}
                  step="0.25"
                  value={mockMarksLost}
                  onChange={(e) =>
                    setMockMarksLost(Math.max(0, Number(e.target.value) || 0))
                  }
                />
              </Field>
              <Field label="Max marks">
                <input
                  type="number"
                  min={1}
                  max={2000}
                  value={mockMaxMarks}
                  onChange={(e) => setMockMaxMarks(Number(e.target.value))}
                />
              </Field>
            </div>

            {exceedsMaxQuestions && (
              <div
                role="status"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 12px',
                  borderRadius: '10px',
                  background: 'color-mix(in srgb, var(--warn) 14%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--warn) 42%, transparent)',
                  color: 'var(--warn-ink)',
                  fontSize: '12px',
                  fontWeight: 600,
                }}
              >
                <AlertTriangle size={16} strokeWidth={1.75} aria-hidden="true" style={{ flexShrink: 0 }} />
                <span>
                  Total questions ({previewMockStats.totalQuestions}) exceed{' '}
                  {expectedMaxQuestions} questions for {mockMaxMarks} max marks.
                </span>
              </div>
            )}

            <div
              style={{
                border: '1px solid var(--line)',
                borderRadius: '12px',
                padding: '12px',
                display: 'grid',
                gap: '10px',
                background: 'var(--sf-2)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600 }}>Subject question counts</span>
                <span className="dh-chip active tabular-nums">
                  {previewMockStats.totalScore}/{mockMaxMarks} ({previewMockStats.accuracyPct}%)
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
                      borderTop: '1px solid var(--line)',
                      paddingTop: '10px',
                      display: 'grid',
                      gap: '6px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600 }}>
                        <span
                          aria-hidden="true"
                          style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '99px',
                            background: sub.color,
                          }}
                        />
                        {sub.e} {sub.name}
                      </span>
                      <span className="tabular-nums" style={{ fontSize: '12px', color: 'var(--tx-2)' }}>
                        {subDetail
                          ? `${subDetail.score} marks · ${subDetail.accuracyPct}%`
                          : ''}
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                        gap: '6px',
                      }}
                    >
                      <label style={{ fontSize: '12px', color: 'var(--tx-2)', margin: 0 }}>
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
                          style={{ marginTop: '4px', minHeight: '38px', padding: '6px 8px' }}
                        />
                      </label>
                      <label style={{ fontSize: '12px', color: 'var(--tx-2)', margin: 0 }}>
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
                          style={{ marginTop: '4px', minHeight: '38px', padding: '6px 8px' }}
                        />
                      </label>
                      <label style={{ fontSize: '12px', color: 'var(--tx-2)', margin: 0 }}>
                        Skipped
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
                          style={{ marginTop: '4px', minHeight: '38px', padding: '6px 8px' }}
                        />
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>

            <Field label="Mistakes & analysis note">
              <textarea
                rows={3}
                maxLength={400}
                value={mockNote}
                onChange={(e) => setMockNote(e.target.value)}
                placeholder="Silly mistakes, weak topics to revise before next test..."
              />
            </Field>

            <div
              style={{
                border: '1px solid var(--line)',
                borderRadius: '12px',
                padding: '12px',
                background: 'var(--sf-2)',
                display: 'grid',
                gap: '8px',
              }}
            >
              <div style={{ fontSize: '13px', fontWeight: 600 }}>
                Log mistakes from this mock ({queuedMistakes.length} queued)
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                  gap: '8px',
                }}
              >
                <Select
                  aria-label="Mistake Subject"
                  title="Subject"
                  value={mkMisSubId}
                  options={subjectSelectOptions}
                  onChange={(val) => {
                    setMkMisSubId(val);
                    setMkMisChapId('');
                  }}
                />
                <Select
                  aria-label="Mistake Chapter"
                  title="Chapter (optional)"
                  value={mkMisChapId}
                  options={buildChapterOptions(mkMisSubId, 'Chapter (optional)')}
                  onChange={setMkMisChapId}
                />
                <Select
                  aria-label="Mistake Reason"
                  title="Mistake reason"
                  value={mkMisReason}
                  options={MISTAKE_REASON_OPTIONS}
                  onChange={setMkMisReason}
                />
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="Short mistake note (optional)..."
                  value={mkMisNote}
                  onChange={(e) => setMkMisNote(e.target.value)}
                  maxLength={140}
                  style={{ flex: 1, minWidth: 0 }}
                />
                <Button
                  variant="secondary"
                  onClick={() => {
                    setQueuedMistakes((prev) => [
                      ...prev,
                      {
                        subjectId: mkMisSubId,
                        chapterId: mkMisChapId || undefined,
                        reason: mkMisReason,
                        note: mkMisNote.trim() || undefined,
                      },
                    ]);
                    setMkMisNote('');
                  }}
                >
                  + Queue
                </Button>
              </div>
              {queuedMistakes.length > 0 && (
                <div style={{ display: 'grid', gap: '6px' }}>
                  {queuedMistakes.map((qm, idx) => {
                    const sub = state.subjects.find((s) => s.id === qm.subjectId);
                    const ch = qm.chapterId
                      ? state.chapters.find((c) => c.id === qm.chapterId)
                      : undefined;
                    return (
                      <div
                        key={idx}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '8px',
                          fontSize: '12px',
                          padding: '6px 8px',
                          borderRadius: '8px',
                          background: 'var(--sf-1)',
                          border: '1px solid var(--line)',
                        }}
                      >
                        <span style={{ minWidth: 0 }}>
                          {sub?.e} <strong>{qm.reason}</strong>
                          {ch ? ` · ${ch.name}` : ''}
                          {qm.note ? ` — ${qm.note}` : ''}
                        </span>
                        <Button
                          variant="danger"
                          onClick={() =>
                            setQueuedMistakes((prev) =>
                              prev.filter((_, i) => i !== idx)
                            )
                          }
                          aria-label="Remove queued mistake"
                          style={{ minHeight: '32px', padding: '0 8px' }}
                        >
                          Remove
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <Button variant="secondary" onClick={onClose} style={{ flex: 1 }}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" style={{ flex: 2 }}>
                Save Mock Test
              </Button>
            </div>

            {existingMock && (
              <Button
                variant="danger"
                fullWidth
                onClick={() => onDeleteMock(existingMock.id)}
              >
                Delete Mock Test
              </Button>
            )}
          </form>
        )}

        {modal.type === 'timerConfig' && (
          <form
            id="cfgTimerForm"
            style={{ display: 'grid', gap: '12px' }}
            onSubmit={(e) => {
              e.preventDefault();
              onSaveTimerConfig(
                Math.max(5, Number(cfgPomoWork) || 25),
                Math.max(1, Number(cfgPomoBreak) || 5),
                Math.max(5, Number(cfgCountdown) || 45),
                Math.max(10, Number(cfgFullMock) || 180)
              );
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: '10px',
              }}
            >
              <Field label="Pomodoro work (min)">
                <input
                  type="number"
                  name="pomoWork"
                  min={5}
                  max={180}
                  value={cfgPomoWork}
                  onChange={(e) => setCfgPomoWork(Number(e.target.value))}
                />
              </Field>
              <Field label="Pomodoro break (min)">
                <input
                  type="number"
                  name="pomoBreak"
                  min={1}
                  max={60}
                  value={cfgPomoBreak}
                  onChange={(e) => setCfgPomoBreak(Number(e.target.value))}
                />
              </Field>
              <Field label="Countdown default (min)">
                <input
                  type="number"
                  name="countdownMins"
                  min={5}
                  max={360}
                  value={cfgCountdown}
                  onChange={(e) => setCfgCountdown(Number(e.target.value))}
                />
              </Field>
              <Field label="Full mock duration (min)">
                <input
                  type="number"
                  name="fullMockMins"
                  min={10}
                  max={360}
                  value={cfgFullMock}
                  onChange={(e) => setCfgFullMock(Number(e.target.value))}
                />
              </Field>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <Button variant="secondary" onClick={onClose} style={{ flex: 1 }}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" style={{ flex: 2 }}>
                Save
              </Button>
            </div>
          </form>
        )}

        {modal.type === 'dday' && (
          <form
            id="ddayForm"
            style={{ display: 'grid', gap: '12px' }}
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
                primary: ddPrimary,
                updatedAt: Date.now(),
              });
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {[
                { e: '🎯', title: 'NEET UG Exam', color: '#10b981' },
                { e: '🧪', title: 'Grand Mock Test', color: '#6366f1' },
                { e: '📚', title: 'Syllabus Completion', color: '#f59e0b' },
                { e: '🏫', title: 'Board / Term Exam', color: '#ec4899' },
              ].map((preset) => (
                <Chip
                  key={preset.title}
                  onClick={() => {
                    setDdEmoji(preset.e);
                    setDdTitle(preset.title);
                    setDdColor(preset.color);
                  }}
                >
                  {preset.e} {preset.title}
                </Chip>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                className="em"
                name="e"
                value={ddEmoji}
                onChange={(e) => setDdEmoji(e.target.value)}
                maxLength={4}
                aria-label="D-Day Emoji"
                style={{ width: '56px', textAlign: 'center', flexShrink: 0 }}
              />
              <input
                type="text"
                id="ddayTitleInput"
                name="title"
                value={ddTitle}
                onChange={(e) => setDdTitle(e.target.value)}
                placeholder="Exam or milestone name..."
                required
                autoFocus
                maxLength={40}
                aria-label="D-Day Title"
                style={{ flex: 1, minWidth: 0 }}
              />
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: '10px',
              }}
            >
              <Field label="Target date">
                <input
                  type="date"
                  name="date"
                  value={ddDate}
                  onChange={(e) => setDdDate(e.target.value)}
                  required
                />
              </Field>
              <Field label="Indicator color">
                <Select
                  aria-label="D-Day badge color"
                  title="Indicator color"
                  value={ddColor}
                  options={DDAY_COLOR_OPTIONS}
                  onChange={setDdColor}
                />
              </Field>
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
                <div style={{ fontSize: '14px', fontWeight: 500 }}>Primary exam</div>
                <div style={{ fontSize: '12px', color: 'var(--tx-2)' }}>
                  Used for Syllabus Pace calculations
                </div>
              </div>
              <Switch
                aria-label="Primary exam"
                checked={ddPrimary}
                onChange={setDdPrimary}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <Button variant="secondary" onClick={onClose} style={{ flex: 1 }}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" style={{ flex: 2 }}>
                Save D-Day
              </Button>
            </div>

            {modal.id && existingDDay && (
              <Button
                variant="danger"
                fullWidth
                onClick={() => onDeleteDDay(modal.id!)}
              >
                Remove D-Day
              </Button>
            )}
          </form>
        )}
      </Sheet>

      <Dialog
        open={modal.type === 'confirmResetHour'}
        onClose={onClose}
        title={
          modal.type === 'confirmResetHour'
            ? `Change day reset hour to ${pad(modal.newHour)}:00${modal.newHour === 0 ? ' (Midnight)' : ' AM'}?`
            : 'Change day reset hour?'
        }
      >
        {modal.type === 'confirmResetHour' && (
          <>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--tx-2)', lineHeight: 1.5 }}>
              This recalculates the logical study date for all saved sessions and re-syncs
              auto-study habits across affected days.
            </p>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--tx)', lineHeight: 1.5 }}>
              Habit ticks, tasks, notes, mood, and planner blocks keep their original dates.
            </p>
            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <Button variant="secondary" onClick={onClose} style={{ flex: 1 }}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => onConfirmResetHour(modal.newHour)}
                style={{ flex: 2 }}
              >
                Confirm &amp; Recalculate
              </Button>
            </div>
          </>
        )}
      </Dialog>

      <Dialog
        open={modal.type === 'confirmReset'}
        onClose={onClose}
        title="Erase all device data?"
      >
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--tx-2)', lineHeight: 1.5 }}>
          This resets all study sessions, habits, syllabus chapters, and mock tests on this
          device to a clean slate. Export a JSON backup first if you want to keep your records.
        </p>
        <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
          <Button variant="secondary" onClick={onClose} style={{ flex: 1 }}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirmReset} style={{ flex: 1 }}>
            Erase Everything
          </Button>
        </div>
      </Dialog>
    </>
  );
};
