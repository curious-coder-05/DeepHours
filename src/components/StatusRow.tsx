import React, { useState } from 'react';
import {
  Activity,
  Award,
  BedDouble,
  Calendar,
  ChevronRight,
  Flame,
} from 'lucide-react';
import type { PulseHabitState } from '../types';
import type { ConsistencyBreakdown, MinDayStreakInfo } from '../utils/insights';
import {
  XP_V2_PLAIN_RULES,
  computeDayXpBreakdown,
  computeLevelInfo,
  computeTotalXp,
} from '../utils/xp';
import { parseKey } from '../utils/studyLogic';
import { resolveUiExam } from '../utils/uiHelpers';
import { Button, Card, Meter, Sheet, Stat } from './ui';

export interface StatusRowProps {
  state: PulseHabitState;
  sel: string;
  todayKey: string;
  minStreakInfo: MinDayStreakInfo;
  consistencyInfo: ConsistencyBreakdown;
  onToggleRestDay?: (dayKey: string) => void;
}

type OpenSheetKind = 'streak' | 'consistency' | 'level' | null;

export const StatusRow: React.FC<StatusRowProps> = ({
  state,
  sel,
  todayKey,
  minStreakInfo,
  consistencyInfo,
  onToggleRestDay,
}) => {
  const [openSheet, setOpenSheet] = useState<OpenSheetKind>(null);
  const totalXp = computeTotalXp(state, todayKey);
  const levelInfo = computeLevelInfo(totalXp);
  const todayBreakdown = computeDayXpBreakdown(state, todayKey);
  const isSelRestDay = (state.restDays || []).includes(sel);

  return (
    <>
      <div className="dh-status-row" role="region" aria-label="Study status">
        <button
          type="button"
          className="dh-status-pill"
          onClick={() => setOpenSheet('streak')}
          style={{
            borderColor:
              minStreakInfo.todayMetMinimum || minStreakInfo.todayIsRestDay
                ? 'color-mix(in srgb, var(--ok) 48%, var(--line))'
                : 'var(--line)',
          }}
        >
          <Flame
            size={16}
            strokeWidth={1.75}
            style={{
              color:
                minStreakInfo.todayMetMinimum || minStreakInfo.todayIsRestDay
                  ? 'var(--ok-ink)'
                  : 'var(--ac-ink)',
            }}
            aria-hidden="true"
          />
          <span className="dh-status-pill-label">Streak</span>
          <span className="tabular-nums" style={{ fontWeight: 600 }}>
            {minStreakInfo.streak}d
          </span>
        </button>

        <button
          type="button"
          className="dh-status-pill"
          onClick={() => setOpenSheet('consistency')}
        >
          <Activity
            size={16}
            strokeWidth={1.75}
            style={{ color: 'var(--info-ink)' }}
            aria-hidden="true"
          />
          <span className="dh-status-pill-label">Consistency</span>
          <span className="tabular-nums" style={{ fontWeight: 600 }}>
            {consistencyInfo.total !== null ? `${consistencyInfo.total}/100` : 'Building'}
          </span>
        </button>

        <button
          type="button"
          className="dh-status-pill"
          onClick={() => setOpenSheet('level')}
        >
          <Award
            size={16}
            strokeWidth={1.75}
            style={{ color: 'var(--ac-ink)' }}
            aria-hidden="true"
          />
          <span className="dh-status-pill-label">Level</span>
          <span className="tabular-nums" style={{ fontWeight: 600 }}>
            Lv {levelInfo.level} · {totalXp} XP
          </span>
        </button>

        {isSelRestDay && (
          <button
            type="button"
            className="dh-status-pill"
            onClick={() => setOpenSheet('streak')}
            style={{
              borderColor: 'color-mix(in srgb, var(--ok) 48%, var(--line))',
              color: 'var(--ok-ink)',
            }}
          >
            <BedDouble size={16} strokeWidth={1.75} aria-hidden="true" />
            <span>Rest day active</span>
          </button>
        )}
      </div>

      {/* Streak & Rest Pass Sheet */}
      <Sheet
        open={openSheet === 'streak'}
        onClose={() => setOpenSheet(null)}
        title="Study streak"
        subtitle={`Qualifies with ${minStreakInfo.minDayMinutes}+ min/day or a Rest Pass`}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: '10px',
          }}
        >
          <Stat
            label="Current streak"
            value={`${minStreakInfo.streak} days`}
            tone={minStreakInfo.todayMetMinimum ? 'ok' : 'default'}
          />
          <Stat
            label="Rest passes left"
            value={`${minStreakInfo.restPassesRemaining} / ${minStreakInfo.restPassesPerMonth}`}
            hint="Resets monthly"
          />
        </div>

        <Card padding="compact" style={{ margin: 0 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '13px',
              marginBottom: '8px',
            }}
          >
            <span>Today&apos;s minimum-day progress</span>
            <span className="tabular-nums" style={{ fontWeight: 600 }}>
              {minStreakInfo.todayStudiedMins} / {minStreakInfo.minDayMinutes}m
            </span>
          </div>
          <Meter
            value={minStreakInfo.todayStudiedMins}
            max={minStreakInfo.minDayMinutes || 240}
            color={minStreakInfo.todayMetMinimum ? 'var(--ok)' : 'var(--ac)'}
            label="Minimum daily study goal"
          />
          <p
            style={{
              margin: '10px 0 0',
              fontSize: '13px',
              color: 'var(--tx-2)',
              lineHeight: 1.45,
            }}
          >
            Every logical day with at least {minStreakInfo.minDayMinutes} minutes of
            logged study extends your streak. Need recovery? Protect any day with a
            Rest Pass without breaking momentum.
          </p>
        </Card>

        {onToggleRestDay && (
          <Button
            variant={isSelRestDay ? 'secondary' : 'primary'}
            size="lg"
            fullWidth
            onClick={() => onToggleRestDay(sel)}
          >
            <BedDouble size={18} strokeWidth={1.75} aria-hidden="true" />
            {isSelRestDay
              ? `Remove Rest Pass for ${sel === todayKey ? 'today' : sel}`
              : `Use Rest Pass for ${sel === todayKey ? 'today' : sel}`}
          </Button>
        )}
      </Sheet>

      {/* Consistency Score Breakdown Sheet */}
      <Sheet
        open={openSheet === 'consistency'}
        onClose={() => setOpenSheet(null)}
        title="Consistency score"
        subtitle="14-day weighted index from 0 to 100"
      >
        {consistencyInfo.total === null ? (
          <Card padding="compact" style={{ margin: 0 }}>
            <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>
              Building baseline
            </div>
            <p
              style={{
                margin: 0,
                fontSize: '13px',
                color: 'var(--tx-2)',
                lineHeight: 1.5,
              }}
            >
              {consistencyInfo.displayLabel ||
                'Log a few days of study sessions and habits to unlock your 14-day score.'}
            </p>
          </Card>
        ) : (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: '10px',
              }}
            >
              <Stat
                label="Score (14d)"
                value={`${consistencyInfo.total} / 100`}
                tone="accent"
              />
              <Stat
                label="Min-goal days (40%)"
                value={`${consistencyInfo.minDayScore100} / 100`}
                hint={`${consistencyInfo.minDaysMetCount} / 14 days`}
              />
              <Stat
                label="Start regularity (20%)"
                value={
                  consistencyInfo.startRegularityScore100 !== null
                    ? `${consistencyInfo.startRegularityScore100} / 100`
                    : '—'
                }
                hint={
                  consistencyInfo.startStdDevMins !== null
                    ? `±${consistencyInfo.startStdDevMins}m`
                    : 'Needs 2+ days'
                }
              />
              <Stat
                label="Revisions on time (20%)"
                value={
                  consistencyInfo.revisionOnTimeScore100 !== null
                    ? `${consistencyInfo.revisionOnTimeScore100} / 100`
                    : '—'
                }
                hint={
                  consistencyInfo.revisionsTotalCount > 0
                    ? `${consistencyInfo.revisionsOnTimeCount}/${consistencyInfo.revisionsTotalCount}`
                    : 'No revisions due'
                }
              />
              <Stat
                label="Focus purity (20%)"
                value={
                  consistencyInfo.purityScore100 !== null
                    ? `${consistencyInfo.purityScore100} / 100`
                    : '—'
                }
              />
            </div>
            <p
              style={{
                margin: 0,
                fontSize: '13px',
                color: 'var(--tx-2)',
                lineHeight: 1.45,
              }}
            >
              Measures how reliably you hit daily minimum hours (40%), keep a consistent
              start time (20%), finish spaced revisions on time (20%), and maintain
              session focus purity (20%).
            </p>
          </>
        )}
      </Sheet>

      {/* Level & XP Breakdown Sheet */}
      <Sheet
        open={openSheet === 'level'}
        onClose={() => setOpenSheet(null)}
        title={`Level ${levelInfo.level}`}
        subtitle={`${totalXp.toLocaleString()} total XP`}
      >
        <Card padding="compact" style={{ margin: 0 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '13px',
              marginBottom: '8px',
            }}
          >
            <span>Progress to Level {levelInfo.level + 1}</span>
            <span className="tabular-nums" style={{ fontWeight: 600 }}>
              {levelInfo.xpIntoLevel} / {levelInfo.xpNeededForNext} XP
            </span>
          </div>
          <Meter
            value={levelInfo.xpIntoLevel}
            max={levelInfo.xpNeededForNext || 150}
            color="var(--ac)"
            label="Level XP progress"
          />
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '12px',
              color: 'var(--tx-2)',
              marginTop: '8px',
            }}
          >
            <span>Earned today: +{todayBreakdown.total} XP</span>
            <span>{levelInfo.xpRemainingToNext} XP remaining</span>
          </div>
        </Card>

        <div style={{ display: 'grid', gap: '8px' }}>
          <div style={{ fontSize: '14px', fontWeight: 600 }}>How XP is earned</div>
          {XP_V2_PLAIN_RULES.map((item) => (
            <div
              key={item.label}
              style={{
                padding: '10px 12px',
                borderRadius: '12px',
                background: 'var(--sf-2)',
                border: '1px solid var(--line)',
                fontSize: '13px',
                color: 'var(--tx-2)',
                lineHeight: 1.4,
              }}
            >
              <strong style={{ color: 'var(--tx)' }}>{item.label}:</strong> {item.rule}
            </div>
          ))}
        </div>
      </Sheet>
    </>
  );
};

export interface ExamCountdownCardProps {
  state: PulseHabitState;
  todayKey: string;
  onManageExams: () => void;
  onAddExam: () => void;
}

export const ExamCountdownCard: React.FC<ExamCountdownCardProps> = ({
  state,
  todayKey,
  onManageExams,
  onAddExam,
}) => {
  const exam = resolveUiExam(state, todayKey);
  if (!exam) {
    return (
      <button
        type="button"
        onClick={onAddExam}
        style={{
          width: '100%',
          margin: '6px 0 10px',
          padding: '12px 14px',
          borderRadius: '14px',
          background: 'var(--sf-1)',
          border: '1px dashed var(--line)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          textAlign: 'left',
          minHeight: '52px',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Calendar size={18} strokeWidth={1.75} style={{ color: 'var(--ac-ink)' }} />
          <span>
            <span style={{ display: 'block', fontSize: '14px', fontWeight: 600 }}>
              Set your exam date
            </span>
            <span style={{ display: 'block', fontSize: '12px', color: 'var(--tx-2)' }}>
              Powers Syllabus Pace and daily countdown
            </span>
          </span>
        </span>
        <ChevronRight size={18} strokeWidth={1.75} style={{ color: 'var(--tx-3)' }} />
      </button>
    );
  }

  const diff = Math.round(
    (parseKey(exam.date).getTime() - parseKey(todayKey).getTime()) / 86400000
  );
  const headline =
    diff === 0
      ? `${exam.title} is today`
      : diff > 0
        ? `${exam.title} in ${diff} day${diff === 1 ? '' : 's'}`
        : `${exam.title} (${Math.abs(diff)}d ago)`;

  return (
    <button
      type="button"
      onClick={onManageExams}
      style={{
        width: '100%',
        margin: '6px 0 10px',
        padding: '12px 14px',
        borderRadius: '14px',
        background: 'var(--sf-1)',
        border: '1px solid var(--line)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '10px',
        textAlign: 'left',
        minHeight: '52px',
      }}
      aria-label={`Exam countdown: ${headline}. Tap to manage exams in Settings`}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
        <span
          aria-hidden="true"
          style={{
            width: '10px',
            height: '10px',
            borderRadius: '99px',
            background: exam.color || 'var(--ac)',
            flexShrink: 0,
          }}
        />
        <span style={{ minWidth: 0 }}>
          <span
            className="tabular-nums"
            style={{
              display: 'block',
              fontSize: '14px',
              fontWeight: 600,
              color: 'var(--tx)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {headline}
          </span>
          <span style={{ display: 'block', fontSize: '12px', color: 'var(--tx-2)' }}>
            {exam.date}
            {state.ddays.length > 1 ? ` · ${state.ddays.length} exams` : ''}
          </span>
        </span>
      </span>
      <ChevronRight size={18} strokeWidth={1.75} style={{ color: 'var(--tx-3)', flexShrink: 0 }} />
    </button>
  );
};
