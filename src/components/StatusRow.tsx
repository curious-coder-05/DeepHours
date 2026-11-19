import React, { useState } from 'react';
import {
  Activity,
  ArrowRight,
  Award,
  BedDouble,
  Calendar,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Flame,
} from 'lucide-react';
import type { PulseHabitState } from '../types';
import type { ConsistencyBreakdown, MinDayStreakInfo } from '../utils/insights';
import type { PaceReport } from '../utils/pace';
import {
  XP_V2_PLAIN_RULES,
  computeDayXpBreakdown,
  computeLevelInfo,
  computeTotalXp,
} from '../utils/xp';
import { parseKey } from '../utils/studyLogic';
import { resolveUiExam } from '../utils/uiHelpers';
import { pluralize } from '../utils/format';
import { BottomSheet } from './BottomSheet';
import { Button, Card, Meter, Stat } from './ui';

export interface StatusRowProps {
  state: PulseHabitState;
  sel: string;
  todayKey: string;
  minStreakInfo: MinDayStreakInfo;
  consistencyInfo: ConsistencyBreakdown;
  paceReport?: PaceReport;
  onToggleRestDay?: (dayKey: string) => void;
  onManageExams?: () => void;
  onAddExam?: () => void;
  onOpenSyllabus?: () => void;
}

type OpenSheetKind = 'streak' | 'consistency' | 'level' | null;

export const StatusRow: React.FC<StatusRowProps> = ({
  state,
  sel,
  todayKey,
  minStreakInfo,
  consistencyInfo,
  paceReport,
  onToggleRestDay,
  onManageExams,
  onAddExam,
  onOpenSyllabus,
}) => {
  const [expanded, setExpanded] = useState<boolean>(false);
  const [openSheet, setOpenSheet] = useState<OpenSheetKind>(null);
  const totalXp = computeTotalXp(state, todayKey);
  const levelInfo = computeLevelInfo(totalXp);
  const todayBreakdown = computeDayXpBreakdown(state, todayKey);
  const isSelRestDay = (state.restDays || []).includes(sel);

  const xpTarget = Math.max(1, levelInfo.xpNeededForNext);
  const xpProgressPct = Math.min(
    100,
    Math.max(0, Math.round((levelInfo.xpIntoLevel / xpTarget) * 100))
  );

  const exam = resolveUiExam(state, todayKey);
  const examDiff = exam
    ? Math.round(
        (parseKey(exam.date).getTime() - parseKey(todayKey).getTime()) / 86400000
      )
    : null;
  const compactExamLabel = exam
    ? examDiff === 0
      ? `${exam.title} today`
      : examDiff !== null && examDiff > 0
        ? `${examDiff}d to ${exam.title}`
        : `${exam.title}`
    : 'Set exam date';

  const showPaceCard = Boolean(
    paceReport?.exam && !paceReport.pastExam && paceReport.totalChapters > 0
  );

  return (
    <>
      <section
        className="dh-glance-strip"
        aria-label="Study status summary"
      >
        <button
          type="button"
          className="dh-glance-trigger"
          aria-expanded={expanded}
          aria-controls="dh-status-drawer"
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="dh-glance-items">
            <span className={exam ? 'dh-glance-accent' : 'dh-glance-strong'}>
              {compactExamLabel}
            </span>
            <span className="dh-glance-sep" aria-hidden="true">
              ·
            </span>
            <span
              className="dh-glance-strong"
              style={
                minStreakInfo.todayMetMinimum || minStreakInfo.todayIsRestDay
                  ? { color: 'var(--ok-ink)' }
                  : undefined
              }
            >
              {minStreakInfo.streak}d streak
            </span>
            <span className="dh-glance-sep" aria-hidden="true">
              ·
            </span>
            <span>
              {consistencyInfo.total !== null
                ? `${consistencyInfo.total}%`
                : 'Building'}
            </span>
            <span className="dh-glance-sep" aria-hidden="true">
              ·
            </span>
            <span>Lv {levelInfo.level}</span>
          </span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--tx-3)',
              flexShrink: 0,
            }}
            aria-hidden="true"
          >
            {expanded ? (
              <ChevronUp size={17} strokeWidth={1.75} />
            ) : (
              <ChevronDown size={17} strokeWidth={1.75} />
            )}
          </span>
          <span className="dh-glance-xp-hairline" aria-hidden="true">
            <span
              className="dh-glance-xp-fill"
              style={{ width: `${xpProgressPct}%` }}
            />
          </span>
        </button>

        {expanded && (
          <div id="dh-status-drawer" className="dh-glance-drawer">
            {/* Level & XP Bar */}
            <button
              type="button"
              className="dh-status-level-bar"
              onClick={() => setOpenSheet('level')}
            >
              <div className="dh-status-level-row">
                <span className="dh-status-level-left">
                  <Award
                    size={16}
                    strokeWidth={1.75}
                    style={{ color: 'var(--ac-ink)', flexShrink: 0 }}
                    aria-hidden="true"
                  />
                  <span className="dh-status-pill-label">Level</span>
                  <span
                    className="tabular-nums"
                    style={{ fontWeight: 600, color: 'var(--tx)' }}
                  >
                    · Lv {levelInfo.level} · {totalXp.toLocaleString()} XP
                  </span>
                </span>
                <span
                  className="tabular-nums"
                  style={{ fontSize: '13px', color: 'var(--tx-3)', flexShrink: 0 }}
                >
                  {levelInfo.xpIntoLevel}/{levelInfo.xpNeededForNext}
                </span>
              </div>
              <div className="dh-status-xp-track" aria-hidden="true">
                <div
                  className="dh-status-xp-fill"
                  style={{ width: `${xpProgressPct}%` }}
                />
              </div>
            </button>

            {/* 2-Column Streak & Consistency Row */}
            <div className="dh-status-grid grid grid-cols-2 gap-2 min-w-0">
              <button
                type="button"
                className="dh-status-card min-w-0"
                onClick={() => setOpenSheet('streak')}
                style={{
                  borderColor:
                    minStreakInfo.todayMetMinimum || minStreakInfo.todayIsRestDay
                      ? 'color-mix(in srgb, var(--ok) 48%, var(--line))'
                      : 'var(--hairline)',
                }}
              >
                <span className="dh-status-card-left">
                  <Flame
                    size={15}
                    strokeWidth={1.75}
                    className={
                      minStreakInfo.streak >= 3 ? 'dh-flame-flicker' : undefined
                    }
                    style={{
                      color:
                        minStreakInfo.todayMetMinimum || minStreakInfo.todayIsRestDay
                          ? 'var(--ok-ink)'
                          : 'var(--ac-ink)',
                      flexShrink: 0,
                    }}
                    aria-hidden="true"
                  />
                  <span className="dh-status-pill-label">Streak</span>
                  {isSelRestDay && (
                    <BedDouble
                      size={14}
                      strokeWidth={1.75}
                      style={{ color: 'var(--ok-ink)', flexShrink: 0 }}
                      aria-label="Rest day active"
                    />
                  )}
                </span>
                <span className="tabular-nums dh-status-card-val">
                  {minStreakInfo.streak}d
                </span>
              </button>

              <button
                type="button"
                className="dh-status-card min-w-0"
                onClick={() => setOpenSheet('consistency')}
                style={{ borderColor: 'var(--hairline)' }}
              >
                <span className="dh-status-card-left">
                  <Activity
                    size={15}
                    strokeWidth={1.75}
                    style={{ color: 'var(--info-ink)', flexShrink: 0 }}
                    aria-hidden="true"
                  />
                  <span className="dh-status-pill-label">Consistency</span>
                </span>
                <span className="tabular-nums dh-status-card-val">
                  {consistencyInfo.total !== null
                    ? `${consistencyInfo.total}/100`
                    : 'Building'}
                </span>
              </button>
            </div>

            {/* Exam Countdown & Syllabus Pace Row */}
            {(onManageExams || onAddExam) && (
              <div
                className={
                  showPaceCard
                    ? 'grid grid-cols-2 gap-2 w-full max-w-full min-w-0'
                    : 'w-full max-w-full min-w-0'
                }
                style={{ alignItems: 'stretch' }}
              >
                <div className="min-w-0 max-w-full">
                  <ExamCountdownCard
                    state={state}
                    todayKey={todayKey}
                    onManageExams={onManageExams || (() => {})}
                    onAddExam={onAddExam || (() => {})}
                  />
                </div>

                {showPaceCard && paceReport && (
                  <button
                    type="button"
                    className="w-full max-w-full min-w-0 box-border"
                    onClick={onOpenSyllabus}
                    style={{
                      height: '100%',
                      minWidth: 0,
                      maxWidth: '100%',
                      boxSizing: 'border-box',
                      margin: 0,
                      padding: '10px 11px',
                      borderRadius: 12,
                      background: 'var(--sf-1)',
                      border: '1px solid var(--hairline)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 6,
                      textAlign: 'left',
                      minHeight: 52,
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span
                        style={{
                          display: 'block',
                          fontSize: 13,
                          color: 'var(--tx-2)',
                          fontWeight: 500,
                          lineHeight: 1.3,
                        }}
                      >
                        Syllabus pace
                      </span>
                      <span
                        className="tabular-nums"
                        style={{
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          fontSize: 13,
                          fontWeight: 600,
                          lineHeight: 1.3,
                          whiteSpace: 'normal',
                          overflowWrap: 'break-word',
                          color:
                            paceReport.status === 'ahead'
                              ? 'var(--ok-ink)'
                              : paceReport.status === 'behind'
                                ? 'var(--warn-ink)'
                                : 'var(--ac-ink)',
                        }}
                      >
                        {paceReport.compactSummary}
                      </span>
                    </div>
                    <ArrowRight
                      size={15}
                      strokeWidth={1.75}
                      style={{ color: 'var(--tx-3)', flexShrink: 0 }}
                    />
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      <StreakDetailSheet
        open={openSheet === 'streak'}
        onClose={() => setOpenSheet(null)}
        sel={sel}
        todayKey={todayKey}
        minStreakInfo={minStreakInfo}
        isSelRestDay={isSelRestDay}
        onToggleRestDay={onToggleRestDay}
      />

      <ConsistencyDetailSheet
        open={openSheet === 'consistency'}
        onClose={() => setOpenSheet(null)}
        consistencyInfo={consistencyInfo}
      />

      {/* Level & XP Breakdown Sheet */}
      <BottomSheet
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
              fontSize: '13px',
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
      </BottomSheet>
    </>
  );
};

export interface StreakDetailSheetProps {
  open: boolean;
  onClose: () => void;
  sel: string;
  todayKey: string;
  minStreakInfo: MinDayStreakInfo;
  isSelRestDay: boolean;
  onToggleRestDay?: (dayKey: string) => void;
}

export const StreakDetailSheet: React.FC<StreakDetailSheetProps> = ({
  open,
  onClose,
  sel,
  todayKey,
  minStreakInfo,
  isSelRestDay,
  onToggleRestDay,
}) => (
  <BottomSheet
    open={open}
    onClose={onClose}
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
        value={pluralize(minStreakInfo.streak, 'day')}
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
        max={minStreakInfo.minDayMinutes || 360}
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
  </BottomSheet>
);

export interface ConsistencyDetailSheetProps {
  open: boolean;
  onClose: () => void;
  consistencyInfo: ConsistencyBreakdown;
}

export const ConsistencyDetailSheet: React.FC<ConsistencyDetailSheetProps> = ({
  open,
  onClose,
  consistencyInfo,
}) => (
  <BottomSheet
    open={open}
    onClose={onClose}
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
  </BottomSheet>
);

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
        className="dh-status-card min-w-0"
        style={{
          width: '100%',
          height: '100%',
          borderStyle: 'dashed',
          borderColor: 'var(--line)',
        }}
      >
        <span
          className="dh-status-card-left"
          style={{ width: '100%', justifyContent: 'space-between' }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              minWidth: 0,
            }}
          >
            <Calendar
              size={15}
              strokeWidth={1.75}
              style={{ color: 'var(--ac-ink)', flexShrink: 0 }}
              aria-hidden="true"
            />
            <span className="dh-status-pill-label">Exam date</span>
          </span>
          <ChevronRight
            size={14}
            strokeWidth={1.75}
            style={{ color: 'var(--tx-3)', flexShrink: 0 }}
            aria-hidden="true"
          />
        </span>
        <span
          className="dh-status-card-val"
          style={{ color: 'var(--ac-ink)', fontSize: '14px' }}
        >
          Set countdown
        </span>
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
        ? `${exam.title} in ${pluralize(diff, 'day')}`
        : `${exam.title} (${Math.abs(diff)}d ago)`;
  const compactValue =
    diff === 0
      ? 'Today'
      : diff > 0
        ? `${pluralize(diff, 'day')} left`
        : `${Math.abs(diff)}d ago`;

  return (
    <button
      type="button"
      onClick={onManageExams}
      className="dh-status-card min-w-0"
      style={{
        width: '100%',
        height: '100%',
        borderColor: 'var(--hairline)',
      }}
      aria-label={`Exam countdown: ${headline}. Tap to manage exams in Settings`}
    >
      <span
        className="dh-status-card-left"
        style={{ width: '100%', justifyContent: 'space-between' }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '99px',
              background: exam.color || 'var(--ac)',
              flexShrink: 0,
            }}
          />
          <span
            className="dh-status-pill-label"
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {exam.title}
          </span>
        </span>
        <ChevronRight
          size={14}
          strokeWidth={1.75}
          style={{ color: 'var(--tx-3)', flexShrink: 0 }}
          aria-hidden="true"
        />
      </span>
      <span className="tabular-nums dh-status-card-val" style={{ fontSize: '14px' }}>
        {compactValue}
      </span>
    </button>
  );
};
