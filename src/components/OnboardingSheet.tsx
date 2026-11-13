import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { Calendar, CheckCircle2, Sparkles, Target } from 'lucide-react';
import type { PulseHabitState } from '../types';
import { LUMEN_ACCENT } from '../utils/uiHelpers';
import { addD } from '../utils/studyLogic';
import { Button } from './ui/Button';
import { Chip } from './ui/Chip';
import { Field } from './ui/Field';
import { Sheet } from './ui/Sheet';
import { Skeleton } from './ui/Skeleton';

const FocusOrbitScene = React.lazy(() =>
  import('./three/FocusOrbitScene').then((m) => ({ default: m.FocusOrbitScene }))
);

export interface OnboardingResult {
  examTitle?: string;
  examDate?: string;
  minDayMinutes: number;
  activeSubjectIds: string[];
}

export interface OnboardingSheetProps {
  open: boolean;
  state: PulseHabitState;
  todayKey: string;
  onClose: () => void;
  onComplete: (result: OnboardingResult) => void;
}

const DAILY_TARGET_PRESETS = [
  { label: '4h', mins: 240 },
  { label: '6h', mins: 360 },
  { label: '8h', mins: 480 },
  { label: '10h', mins: 600 },
];

export const OnboardingSheet: React.FC<OnboardingSheetProps> = ({
  open,
  state,
  todayKey,
  onClose,
  onComplete,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [examTitle, setExamTitle] = useState('');
  const [examDate, setExamDate] = useState('');
  const [minDayMinutes, setMinDayMinutes] = useState(
    () => state.set.targets?.minDayMinutes || 360
  );
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>(() => {
    const active = state.subjects.filter((s) => !s.arch).map((s) => s.id);
    return active.length > 0 ? active : state.subjects.map((s) => s.id);
  });

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setMinDayMinutes(state.set.targets?.minDayMinutes || 360);
    const active = state.subjects.filter((s) => !s.arch).map((s) => s.id);
    setSelectedSubjectIds(active.length > 0 ? active : state.subjects.map((s) => s.id));
  }, [open, state.set.targets?.minDayMinutes, state.subjects]);

  const examPresets = useMemo(
    () => [
      { title: 'NEET UG', emoji: '🩺', date: addD(todayKey, 180) },
      { title: 'INI-CET', emoji: '🧬', date: addD(todayKey, 120) },
      { title: 'FMGE', emoji: '⚕️', date: addD(todayKey, 90) },
    ],
    [todayKey]
  );

  const toggleSubject = (id: string) => {
    setSelectedSubjectIds((cur) => {
      if (cur.includes(id)) {
        if (cur.length <= 1) return cur;
        return cur.filter((x) => x !== id);
      }
      return [...cur, id];
    });
  };

  const handleFinish = () => {
    const clampedMins = Math.max(60, Math.min(960, Math.round(Number(minDayMinutes) || 360)));
    onComplete({
      examTitle: examTitle.trim() || undefined,
      examDate: /^\d{4}-\d{2}-\d{2}$/.test(examDate.trim()) ? examDate.trim() : undefined,
      minDayMinutes: clampedMins,
      activeSubjectIds:
        selectedSubjectIds.length > 0
          ? selectedSubjectIds
          : state.subjects.slice(0, 1).map((s) => s.id),
    });
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={
        step === 1
          ? 'Welcome to Deep Hours'
          : step === 2
            ? 'Exam & daily study goal'
            : 'Choose active subjects'
      }
      subtitle={`Step ${step} of 3 · Skippable setup`}
    >
      <div className="space-y-4">
        {/* Progress step indicator */}
        <div className="flex items-center gap-2" aria-label={`Onboarding step ${step} of 3`}>
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="h-1.5 flex-1 rounded-full transition-colors"
              style={{
                background: n <= step ? 'var(--ac)' : 'var(--sf-3)',
              }}
            />
          ))}
        </div>

        {/* Step 1: Welcome + Live 3D Focus Core Preview */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--sf-2)]">
              <Suspense fallback={<Skeleton height={200} />}>
                <FocusOrbitScene
                  ui3dSetting={state.set.ui3d || 'auto'}
                  ui3dQuality={state.set.ui3dQuality || 'auto'}
                  deskMode={false}
                  priority="overlay"
                  hapticsEnabled={Boolean(state.set.snd)}
                  status="running"
                  mode="pomo"
                  phase="work"
                  subjectColor={LUMEN_ACCENT}
                  subjectName="Deep Focus"
                  progressPct={65}
                  totalActiveMs={900000}
                  overtimeMs={0}
                  completedPomodorosToday={2}
                  height={200}
                />
              </Suspense>
            </div>

            <div className="space-y-2">
              <h3 className="text-[17px] font-semibold text-[var(--tx)]">
                A calm instrument for serious medical prep
              </h3>
              <ul className="space-y-2 text-[13.5px] leading-snug text-[var(--tx-2)]">
                <li className="flex items-start gap-2.5">
                  <Sparkles
                    size={16}
                    className="mt-0.5 shrink-0 text-[var(--ac-ink)]"
                    aria-hidden="true"
                  />
                  <span>
                    <strong className="text-[var(--tx)]">Deep focus timer:</strong> Pomodoro,
                    Countdown, Stopwatch &amp; Full Mock (180m) with soundscapes.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Target
                    size={16}
                    className="mt-0.5 shrink-0 text-[var(--ac-ink)]"
                    aria-hidden="true"
                  />
                  <span>
                    <strong className="text-[var(--tx)]">Prep &amp; pace engine:</strong>{' '}
                    Syllabus chapters, spaced revisions, mocks, mistakes, doubts &amp; PYQs.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Calendar
                    size={16}
                    className="mt-0.5 shrink-0 text-[var(--ac-ink)]"
                    aria-hidden="true"
                  />
                  <span>
                    <strong className="text-[var(--tx)]">Offline-first privacy:</strong> Stored
                    locally on your device with optional Google cloud sync &amp; study squads.
                  </span>
                </li>
              </ul>
            </div>
          </div>
        )}

        {/* Step 2: Optional Exam D-Day & Daily Minimum Goal */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <span className="block text-[13px] font-medium text-[var(--tx-2)]">
                Exam target preset (optional)
              </span>
              <div className="flex flex-wrap gap-2">
                {examPresets.map((preset) => (
                  <Chip
                    key={preset.title}
                    selected={examTitle.trim() === preset.title}
                    onClick={() => {
                      setExamTitle(preset.title);
                      setExamDate(preset.date);
                    }}
                  >
                    {preset.emoji} {preset.title}
                  </Chip>
                ))}
                {(examTitle || examDate) && (
                  <Chip
                    selected={false}
                    onClick={() => {
                      setExamTitle('');
                      setExamDate('');
                    }}
                  >
                    Clear
                  </Chip>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Exam name (optional)">
                <input
                  type="text"
                  value={examTitle}
                  onChange={(e) => setExamTitle(e.target.value)}
                  placeholder="e.g. NEET UG 2026"
                  maxLength={40}
                  className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3 text-[14px] text-[var(--tx)]"
                />
              </Field>
              <Field label="Target date (optional)">
                <input
                  type="date"
                  value={examDate}
                  onChange={(e) => setExamDate(e.target.value)}
                  className="tnum h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3 text-[14px] text-[var(--tx)]"
                />
              </Field>
            </div>

            <div className="space-y-2">
              <Field
                label="Daily minimum study target (minutes)"
                hint="Required daily study volume to protect your streak"
              >
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {DAILY_TARGET_PRESETS.map((p) => (
                      <Chip
                        key={p.mins}
                        selected={minDayMinutes === p.mins}
                        onClick={() => setMinDayMinutes(p.mins)}
                      >
                        {p.label} ({p.mins}m)
                      </Chip>
                    ))}
                  </div>
                  <input
                    type="number"
                    min={60}
                    max={960}
                    step={15}
                    value={minDayMinutes}
                    onChange={(e) =>
                      setMinDayMinutes(Math.max(60, Math.min(960, Number(e.target.value) || 60)))
                    }
                    className="tnum h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3 text-[14px] text-[var(--tx)]"
                  />
                </div>
              </Field>
            </div>
          </div>
        )}

        {/* Step 3: Active Subjects */}
        {step === 3 && (
          <div className="space-y-3">
            <p className="text-[13.5px] leading-snug text-[var(--tx-2)]">
              Toggle the subjects you want active on Today, Focus, and Syllabus. You can
              customize or add subjects anytime in Settings.
            </p>
            <div className="flex flex-wrap gap-2">
              {state.subjects.map((sub) => {
                const isSelected = selectedSubjectIds.includes(sub.id);
                return (
                  <Chip
                    key={sub.id}
                    selected={isSelected}
                    colorDot={sub.color}
                    onClick={() => toggleSubject(sub.id)}
                  >
                    {sub.e} {sub.name}
                  </Chip>
                );
              })}
            </div>
            <p className="tnum text-[13px] text-[var(--tx-3)]">
              {selectedSubjectIds.length} active subject
              {selectedSubjectIds.length === 1 ? '' : 's'} selected (at least 1 required)
            </p>
          </div>
        )}

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-2 border-t border-[var(--line)] pt-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            Skip setup
          </Button>
          <div className="flex items-center gap-2">
            {step > 1 && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setStep((s) => (s === 3 ? 2 : 1))}
              >
                Back
              </Button>
            )}
            {step < 3 ? (
              <Button
                type="button"
                variant="primary"
                onClick={() => setStep((s) => (s === 1 ? 2 : 3))}
              >
                Next
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                icon={<CheckCircle2 size={16} aria-hidden="true" />}
                onClick={handleFinish}
              >
                Finish setup
              </Button>
            )}
          </div>
        </div>
      </div>
    </Sheet>
  );
};
