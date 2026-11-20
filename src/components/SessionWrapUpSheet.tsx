import React from 'react';
import { Camera, CheckCircle2, Lightbulb, Plus, Share2, X } from 'lucide-react';
import type { Chapter, Subject } from '../types';
import { fmtHMShort } from '../utils/studyLogic';
import { triggerHaptic } from '../utils/haptics';
import {
  ALL_SUBJECTS_COLOR,
  ALL_SUBJECTS_LABEL,
  isAllSubjectsMockId,
} from '../utils/focusSessionHelpers';
import type { ParkedThought } from '../utils/parkingLot';
import {
  CHAPTER_CONFIDENCE_OPTIONS,
  type ChapterConfidenceLevel,
  type SessionWrapUpSummary,
} from '../utils/sessionWrapUp';
import { BottomSheet } from './BottomSheet';
import { Button } from './ui';

export interface SessionWrapUpSheetProps {
  summary: SessionWrapUpSummary | null;
  subject?: Subject;
  chapter?: Chapter;
  parkedThoughts?: ParkedThought[];
  onClose: () => void;
  onSnapToVault: (subjectId: string, chapterId?: string) => void;
  onSetChapterConfidence: (chapterId: string, confidence: ChapterConfidenceLevel) => void;
  onAddThoughtToTodayTasks?: (thought: ParkedThought) => void;
  onDismissThought?: (thoughtId: string) => void;
  onShareProofCard?: () => void;
}

export const SessionWrapUpSheet: React.FC<SessionWrapUpSheetProps> = ({
  summary,
  subject,
  chapter,
  parkedThoughts = [],
  onClose,
  onSnapToVault,
  onSetChapterConfidence,
  onAddThoughtToTodayTasks,
  onDismissThought,
  onShareProofCard,
}) => {
  const open = Boolean(summary);
  const isAllSubjects = Boolean(summary && isAllSubjectsMockId(summary.subjectId));
  const subjectName = isAllSubjects
    ? `${ALL_SUBJECTS_LABEL} · Full Mock`
    : subject?.name || 'Study session';
  const subjectEmoji = isAllSubjects ? '📝' : subject?.e || '📘';
  const subjectColor = isAllSubjects ? ALL_SUBJECTS_COLOR : subject?.color || 'var(--ac)';

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Session logged"
      subtitle={
        summary
          ? `${subjectEmoji} ${subjectName}${chapter ? ` · ${chapter.name}` : ''}`
          : undefined
      }
      footer={
        summary ? (
          <div style={{ display: 'grid', gap: 8 }}>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              className="dh-focus-cta"
              icon={<Camera size={17} strokeWidth={2} />}
              onClick={() => {
                triggerHaptic('tap');
                onSnapToVault(summary.subjectId, summary.chapterId);
              }}
            >
              Snap a tough question to Vault
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
                  onShareProofCard();
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
      {summary && (
        <>
          {/* Calm Logged Duration & Subject Summary */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '12px 14px',
              borderRadius: 14,
              background: 'var(--glass-pill)',
              border: '1px solid var(--glass-bd)',
              boxShadow: 'var(--glass-specular)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span
                aria-hidden="true"
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: subjectColor,
                  flexShrink: 0,
                }}
              />
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    color: 'var(--tx)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {summary.heading || chapter?.name || subjectName}
                </div>
                <div
                  className="tabular-nums"
                  style={{ fontSize: 13, color: 'var(--tx-2)', marginTop: 2 }}
                >
                  {summary.purity}% focus purity
                </div>
              </div>
            </div>

            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                flexShrink: 0,
                color: 'var(--ok-ink)',
                fontSize: 16,
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <CheckCircle2 size={17} strokeWidth={2} aria-hidden="true" />
              <span>{fmtHMShort(summary.activeMs)}</span>
            </div>
          </div>

          {/* Quick 1-Tap Chapter Confidence Check (when syllabus chapter is attached) */}
          {chapter && (
            <div className="dh-sheet-field">
              <div className="split" style={{ gap: 8 }}>
                <span className="dh-sheet-field-label">
                  How confident do you feel in {chapter.name}?
                </span>
                {chapter.confidence && (
                  <span
                    className="tabular-nums"
                    style={{ fontSize: 13, fontWeight: 600, color: 'var(--ac-ink)' }}
                  >
                    {chapter.confidence}/5
                  </span>
                )}
              </div>
              <div
                className="dh-confidence-grid"
                role="radiogroup"
                aria-label={`Confidence level for ${chapter.name}`}
              >
                {CHAPTER_CONFIDENCE_OPTIONS.map((opt) => {
                  const selected = chapter.confidence === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={`dh-confidence-pill ${selected ? 'active' : ''}`}
                      onClick={() => {
                        triggerHaptic('success');
                        onSetChapterConfidence(chapter.id, opt.value);
                      }}
                    >
                      <span className="dh-confidence-num tabular-nums">{opt.value}</span>
                      <span className="dh-confidence-lbl">{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Mid-Session Parked Thoughts Conversion */}
          {parkedThoughts.length > 0 && (
            <div className="dh-sheet-field" aria-label="Parked thoughts">
              <div className="split" style={{ gap: 8 }}>
                <span
                  className="dh-sheet-field-label"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <Lightbulb size={14} strokeWidth={1.9} style={{ color: 'var(--ac-ink)' }} aria-hidden="true" />
                  Parked thoughts ({parkedThoughts.length})
                </span>
              </div>
              <div className="dh-wrapup-parked-list">
                {parkedThoughts.map((note) => (
                  <div key={note.id} className="dh-wrapup-parked-row">
                    <span className="dh-wrapup-parked-text">{note.text}</span>
                    <div className="dh-wrapup-parked-actions">
                      {onAddThoughtToTodayTasks && (
                        <button
                          type="button"
                          className="dh-glass-accent-btn dh-wrapup-task-btn"
                          onClick={() => {
                            triggerHaptic('success');
                            onAddThoughtToTodayTasks(note);
                          }}
                        >
                          <Plus size={13} strokeWidth={2.2} aria-hidden="true" />
                          <span>Add to Today&apos;s tasks</span>
                        </button>
                      )}
                      {onDismissThought && (
                        <button
                          type="button"
                          className="dh-parking-dismiss-btn"
                          aria-label={`Dismiss parked thought: ${note.text}`}
                          title="Dismiss"
                          onClick={() => {
                            triggerHaptic('tap');
                            onDismissThought(note.id);
                          }}
                        >
                          <X size={14} strokeWidth={2} aria-hidden="true" />
                        </button>
                      )}
                    </div>
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
