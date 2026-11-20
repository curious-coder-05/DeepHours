import React from 'react';
import { ArrowRight, Clock, Repeat, Share2 } from 'lucide-react';
import {
  formatBleedDelta,
  formatBleedMinutes,
  formatExamClockMs,
  type ExamPaceRecord,
} from '../utils/examClock';
import { triggerHaptic } from '../utils/haptics';
import { BottomSheet } from './BottomSheet';
import { Button } from './ui';

export interface ExamBleedSheetProps {
  record: ExamPaceRecord | null;
  onClose: () => void;
  onLogMockScore: (record: ExamPaceRecord) => void;
  onShareProofCard?: (record: ExamPaceRecord) => void;
}

export const ExamBleedSheet: React.FC<ExamBleedSheetProps> = ({
  record,
  onClose,
  onLogMockScore,
  onShareProofCard,
}) => {
  const open = Boolean(record);

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      snap="tall"
      title="Exam pace & bleed diagnostic"
      subtitle={
        record
          ? `${formatExamClockMs(record.totalElapsedMs, { forceHours: true })} elapsed · ${record.switchCount} section switch${record.switchCount === 1 ? '' : 'es'}`
          : undefined
      }
      footer={
        record ? (
          <div style={{ display: 'grid', gap: 8 }}>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              className="dh-focus-cta"
              icon={<ArrowRight size={17} strokeWidth={2} />}
              onClick={() => {
                triggerHaptic('tap');
                onLogMockScore(record);
              }}
            >
              Log mock score
            </Button>
            {onShareProofCard && (
              <Button
                variant="secondary"
                size="md"
                fullWidth
                className="dh-glass-btn"
                icon={<Share2 size={15} strokeWidth={1.9} />}
                onClick={() => {
                  triggerHaptic('tap');
                  onShareProofCard(record);
                }}
              >
                Share proof card
              </Button>
            )}
            <Button
              variant="secondary"
              size="md"
              fullWidth
              className="dh-glass-btn"
              onClick={() => {
                triggerHaptic('tap');
                onClose();
              }}
            >
              Done
            </Button>
          </div>
        ) : undefined
      }
    >
      {record && (
        <>
          {/* Summary Pills */}
          <div className="dh-bleed-summary-strip">
            <div className="dh-bleed-stat-box">
              <span className="dh-bleed-stat-label">
                <Clock size={14} strokeWidth={1.75} aria-hidden="true" />
                Total time
              </span>
              <strong className="tabular-nums dh-bleed-stat-val">
                {formatExamClockMs(record.totalElapsedMs, { forceHours: true })}
              </strong>
            </div>
            <div className="dh-bleed-stat-box">
              <span className="dh-bleed-stat-label">
                <Repeat size={14} strokeWidth={1.75} aria-hidden="true" />
                Switches
              </span>
              <strong className="tabular-nums dh-bleed-stat-val">
                {record.switchCount}
              </strong>
            </div>
          </div>

          {/* Target vs Actual Bleed Table */}
          <div className="dh-sheet-field">
            <span className="dh-sheet-field-label">Target vs actual section pace</span>
            <div className="dh-bleed-table" role="table" aria-label="Target vs actual section pace">
              {record.sections.map((row) => {
                const targetMins = Math.round(row.targetMs / 60_000);
                const actualText = formatBleedMinutes(row.actualMs);
                const deltaText = formatBleedDelta(row.deltaMs);
                const deltaToneClass =
                  row.status === 'bleed'
                    ? 'is-bleed'
                    : row.status === 'starved'
                      ? 'is-starved'
                      : 'is-target';
                return (
                  <div key={row.id} className="dh-bleed-row" role="row">
                    <div className="dh-bleed-row-left" role="cell">
                      <span
                        className="dh-bleed-dot"
                        style={{ background: row.color }}
                        aria-hidden="true"
                      />
                      <div style={{ minWidth: 0 }}>
                        <div className="dh-bleed-sec-name">{row.label}</div>
                        <div className="dh-bleed-sec-visits tabular-nums">
                          {row.visits} visit{row.visits === 1 ? '' : 's'}
                        </div>
                      </div>
                    </div>
                    <div className="dh-bleed-row-right" role="cell">
                      <span className="dh-bleed-ratio tabular-nums">
                        {actualText} / {targetMins}m
                      </span>
                      <span className={`dh-bleed-delta tabular-nums ${deltaToneClass}`}>
                        {deltaText}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Chronological Visit Timeline */}
          {record.visitLog.length > 0 && (
            <div className="dh-sheet-field">
              <span className="dh-sheet-field-label">
                Chronological visit timeline ({record.visitLog.length})
              </span>
              <div className="dh-bleed-timeline">
                {record.visitLog.map((visit, idx) => (
                  <div key={`${visit.sectionId}_${visit.startedAt}_${idx}`} className="dh-bleed-visit-row">
                    <span className="dh-bleed-visit-idx tabular-nums">{idx + 1}.</span>
                    <span
                      className="dh-bleed-dot"
                      style={{ background: visit.color }}
                      aria-hidden="true"
                    />
                    <span className="dh-bleed-visit-name">{visit.label}</span>
                    <span className="dh-bleed-visit-dur tabular-nums">
                      {formatExamClockMs(visit.durationMs)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </BottomSheet>
  );
};
