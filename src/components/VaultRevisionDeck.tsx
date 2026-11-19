import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Maximize2,
  RotateCcw,
  Shuffle,
  X,
} from 'lucide-react';
import type { Chapter, PulseHabitState, Subject } from '../types';
import { fmtHMS, getTimerMetrics } from '../utils/studyLogic';
import { useTimerTick } from '../utils/timerTicker';
import {
  INITIAL_REVEAL_STATE,
  orderRevisionDeck,
  resolveVaultChapterName,
  resolveVaultSubjectLabel,
  revealReducer,
} from '../utils/vaultLogic';
import { getVaultBlob } from '../utils/vaultStore';
import type { VaultItem } from '../utils/vaultTypes';
import { VaultZoomViewer } from './VaultZoomViewer';
import { Button, IconButton } from './ui';

export interface VaultRevisionDeckProps {
  open: boolean;
  items: readonly VaultItem[];
  subjects: readonly Subject[];
  chapters: readonly Chapter[];
  deckLabel: string;
  activeTimerText?: string | null;
  timerState?: PulseHabitState;
  onClose: () => void;
  onRecordRevised: (item: VaultItem) => Promise<void> | void;
  onMarkMastered: (item: VaultItem) => Promise<void> | void;
  onEditItem?: (item: VaultItem) => void;
}

const LiveRevisionTimerBadge: React.FC<{
  timerState?: PulseHabitState;
  fallbackText?: string | null;
}> = ({ timerState, fallbackText }) => {
  const isRunning = Boolean(timerState?.activeTimer?.status === 'running');
  useTimerTick(isRunning);
  const metrics = timerState?.activeTimer
    ? getTimerMetrics(timerState, Date.now())
    : null;
  const text = metrics
    ? `${metrics.status === 'paused' ? 'Paused ' : ''}${fmtHMS(metrics.totalActiveMs)}`
    : fallbackText;
  if (!text) return null;
  return (
    <span
      className="tabular-nums"
      style={{
        padding: '5px 10px',
        borderRadius: '10px',
        background: 'var(--ac-soft)',
        border: '1px solid var(--ac-bd)',
        color: 'var(--ac-ink)',
        fontFamily: 'var(--font-mono)',
        fontSize: '13px',
        fontWeight: 600,
      }}
    >
      {text}
    </span>
  );
};

export const VaultRevisionDeck: React.FC<VaultRevisionDeckProps> = ({
  open,
  items,
  subjects,
  chapters,
  deckLabel,
  activeTimerText,
  timerState,
  onClose,
  onRecordRevised,
  onMarkMastered,
  onEditItem,
}) => {
  const [shuffled, setShuffled] = useState<boolean>(false);
  const [deckOrder, setDeckOrder] = useState<VaultItem[]>([]);
  const [index, setIndex] = useState<number>(0);
  const [finished, setFinished] = useState<boolean>(false);
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(() => new Set());
  const [masteredIds, setMasteredIds] = useState<Set<string>>(() => new Set());

  const [reveal, dispatchReveal] = useReducer(revealReducer, INITIAL_REVEAL_STATE);

  const [qUrl, setQUrl] = useState<string | null>(null);
  const [sUrl, setSUrl] = useState<string | null>(null);
  const [zoomOpen, setZoomOpen] = useState<boolean>(false);
  const urlCacheRef = useRef<Map<string, string>>(new Map());
  const openRef = useRef<boolean>(open);
  openRef.current = open;
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);

  // Revoke all cached Blob URLs on unmount even if unmounted while open
  useEffect(() => {
    const cache = urlCacheRef.current;
    return () => {
      openRef.current = false;
      for (const u of cache.values()) {
        URL.revokeObjectURL(u);
      }
      cache.clear();
    };
  }, []);

  const rebuildDeck = useCallback(
    (useShuffle: boolean) => {
      const ordered = orderRevisionDeck(items, useShuffle);
      setDeckOrder(ordered);
      setIndex(0);
      setFinished(ordered.length === 0);
      setReviewedIds(new Set());
      setMasteredIds(new Set());
      dispatchReveal({ type: 'reset' });
    },
    [items]
  );

  // Initialize deck when opened
  useEffect(() => {
    if (!open) {
      for (const u of urlCacheRef.current.values()) {
        URL.revokeObjectURL(u);
      }
      urlCacheRef.current.clear();
      setQUrl(null);
      setSUrl(null);
      setZoomOpen(false);
      return;
    }
    rebuildDeck(shuffled);
    // Only rebuild automatically when opened or deck scope items set changes meaningfully on open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep item metadata synced in deckOrder if user edits or marks mastered
  useEffect(() => {
    if (!open) return;
    const itemMap = new Map<string, VaultItem>();
    for (const it of items) itemMap.set(it.id, it);
    setDeckOrder((prev) =>
      prev.map((card) => itemMap.get(card.id) || card)
    );
  }, [items, open]);

  const currentItem = !finished && deckOrder[index] ? deckOrder[index] : null;
  const nextItem = !finished && deckOrder[index + 1] ? deckOrder[index + 1] : null;

  const ensureBlobUrl = useCallback(async (itemId: string, slot: 'q' | 's') => {
    const key = `${itemId}:${slot}`;
    const cached = urlCacheRef.current.get(key);
    if (cached) return cached;
    const blob = await getVaultBlob(itemId, slot);
    if (!blob || !openRef.current) return null;
    const existingAfterAwait = urlCacheRef.current.get(key);
    if (existingAfterAwait) return existingAfterAwait;
    const url = URL.createObjectURL(blob);
    urlCacheRef.current.set(key, url);
    return url;
  }, []);

  // Load current question image and preload next card image
  useEffect(() => {
    if (!open || !currentItem) {
      setQUrl(null);
      setSUrl(null);
      return;
    }
    let cancelled = false;
    setSUrl(null);
    void (async () => {
      const url = await ensureBlobUrl(currentItem.id, 'q');
      if (!cancelled) setQUrl(url);
      if (nextItem) {
        void ensureBlobUrl(nextItem.id, 'q');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentItem, ensureBlobUrl, nextItem, open]);

  // Load solution image ONLY when solution panel is revealed
  useEffect(() => {
    if (!open || !currentItem || !reveal.solutionOpen || !currentItem.hasSolutionImage) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const url = await ensureBlobUrl(currentItem.id, 's');
      if (!cancelled) setSUrl(url);
    })();
    return () => {
      cancelled = true;
    };
  }, [currentItem, ensureBlobUrl, open, reveal.solutionOpen]);

  const markCardRevisedAndAdvance = useCallback(
    (card: VaultItem | null, moveDelta: 1 | -1) => {
      if (!card) return;
      if (moveDelta > 0) {
        setReviewedIds((prev) => {
          const next = new Set(prev);
          next.add(card.id);
          return next;
        });
        void onRecordRevised(card);
      }

      dispatchReveal({ type: 'reset' });
      setZoomOpen(false);

      if (moveDelta > 0) {
        if (index + 1 >= deckOrder.length) {
          setFinished(true);
        } else {
          setIndex((i) => i + 1);
        }
      } else {
        setFinished(false);
        setIndex((i) => Math.max(0, i - 1));
      }
    },
    [deckOrder.length, index, onRecordRevised]
  );

  const handleMarkMastered = useCallback(() => {
    if (!currentItem) return;
    setReviewedIds((prev) => {
      const next = new Set(prev);
      next.add(currentItem.id);
      return next;
    });
    setMasteredIds((prev) => {
      const next = new Set(prev);
      next.add(currentItem.id);
      return next;
    });
    void onMarkMastered(currentItem);
    dispatchReveal({ type: 'reset' });
    setZoomOpen(false);

    if (index + 1 >= deckOrder.length) {
      setFinished(true);
    } else {
      setIndex((i) => i + 1);
    }
  }, [currentItem, deckOrder.length, index, onMarkMastered]);

  // Desktop keyboard navigation
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (zoomOpen) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (finished) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        markCardRevisedAndAdvance(currentItem, 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (index > 0) markCardRevisedAndAdvance(currentItem, -1);
      } else if (e.key.toLowerCase() === 'a') {
        e.preventDefault();
        dispatchReveal({ type: 'toggle_answer' });
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        dispatchReveal({ type: 'toggle_solution' });
      } else if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        handleMarkMastered();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    currentItem,
    finished,
    handleMarkMastered,
    index,
    markCardRevisedAndAdvance,
    onClose,
    open,
    zoomOpen,
  ]);

  const remainingActiveCount = useMemo(() => {
    const activeIds = new Set(
      items.filter((i) => !i.mastered && !i.deletedAt).map((i) => i.id)
    );
    for (const mid of masteredIds) activeIds.delete(mid);
    return activeIds.size;
  }, [items, masteredIds]);

  if (!open) return null;

  const progressPct =
    deckOrder.length > 0
      ? finished
        ? 100
        : Math.round(((index + 1) / deckOrder.length) * 100)
      : 0;

  const subjectMeta = currentItem
    ? resolveVaultSubjectLabel(subjects, currentItem.subjectId)
    : null;
  const chapterLabel = currentItem?.chapterId
    ? resolveVaultChapterName(chapters, currentItem.chapterId)
    : undefined;

  const hasRevealDrawer = reveal.answerOpen || reveal.solutionOpen;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Vault revision deck"
      className="dh-vault-deck"
    >
      {/* Top Bar */}
      <header className="dh-vault-deck-top">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            <IconButton label="Close revision deck" onClick={onClose}>
              <X size={20} strokeWidth={1.75} />
            </IconButton>
            <div style={{ minWidth: 0 }}>
              <div
                className="tabular-nums"
                style={{
                  fontSize: '15px',
                  fontWeight: 600,
                  color: 'var(--tx)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {deckLabel}{' '}
                {deckOrder.length > 0 && !finished
                  ? `· ${index + 1} / ${deckOrder.length}`
                  : ''}
              </div>
              {currentItem && subjectMeta && (
                <div style={{ fontSize: '13px', color: 'var(--tx-2)' }}>
                  {subjectMeta.emoji} {subjectMeta.name}
                  {chapterLabel ? ` · ${chapterLabel}` : ''} ·{' '}
                  {currentItem.kind === 'hard' ? 'Hard / Trap' : 'Unsolved'}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <LiveRevisionTimerBadge
              timerState={timerState}
              fallbackText={activeTimerText}
            />
            <Button
              variant={shuffled ? 'primary' : 'secondary'}
              size="sm"
              aria-pressed={shuffled}
              onClick={() => {
                const next = !shuffled;
                setShuffled(next);
                rebuildDeck(next);
              }}
            >
              <Shuffle size={15} strokeWidth={1.75} aria-hidden="true" />
              Shuffle
            </Button>
          </div>
        </div>

        {/* Thin Progress Track */}
        <div
          style={{
            height: '3px',
            borderRadius: '99px',
            background: 'var(--sf-2)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${progressPct}%`,
              background: 'var(--ac)',
              transition: 'width 200ms var(--ease-out)',
            }}
          />
        </div>
      </header>

      {/* Main Content Stage */}
      {finished || !currentItem ? (
        <div
          style={{
            flex: 1,
            display: 'grid',
            placeItems: 'center',
            padding: '24px',
            overflowY: 'auto',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '420px',
              padding: '24px 20px',
              borderRadius: '16px',
              background: 'var(--sf-1)',
              border: '1px solid var(--line)',
              textAlign: 'center',
              display: 'grid',
              gap: '14px',
            }}
          >
            <div style={{ fontSize: '20px', fontWeight: 600, color: 'var(--tx)' }}>
              {deckOrder.length === 0
                ? 'No active questions in this deck'
                : 'Revision round complete'}
            </div>
            <div
              className="tabular-nums"
              style={{ fontSize: '15px', color: 'var(--tx-2)', lineHeight: 1.5 }}
            >
              {reviewedIds.size} reviewed · {masteredIds.size} mastered · {remainingActiveCount} still active
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
              {items.some((i) => !i.mastered && !i.deletedAt) && (
                <Button variant="secondary" onClick={() => rebuildDeck(shuffled)}>
                  <RotateCcw size={16} strokeWidth={1.75} aria-hidden="true" />
                  Restart
                </Button>
              )}
              <Button variant="primary" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div
            className="dh-vault-deck-stage"
            onTouchStart={(e) => {
              if (e.touches.length === 1) {
                swipeStartRef.current = {
                  x: e.touches[0].clientX,
                  y: e.touches[0].clientY,
                };
              }
            }}
            onTouchEnd={(e) => {
              const start = swipeStartRef.current;
              swipeStartRef.current = null;
              if (!start || e.changedTouches.length === 0) return;
              const dx = e.changedTouches[0].clientX - start.x;
              const dy = e.changedTouches[0].clientY - start.y;
              if (Math.abs(dx) >= 64 && Math.abs(dy) < 48) {
                if (dx < 0) {
                  markCardRevisedAndAdvance(currentItem, 1);
                } else if (index > 0) {
                  markCardRevisedAndAdvance(currentItem, -1);
                }
              }
            }}
          >
            <div className="dh-vault-deck-img-wrap">
              {qUrl ? (
                <img
                  src={qUrl}
                  alt={`Vault question ${index + 1}`}
                  onClick={() => setZoomOpen(true)}
                  style={{
                    width: '100%',
                    maxWidth: '920px',
                    height: 'auto',
                    objectFit: 'contain',
                    borderRadius: '12px',
                    border: '1px solid var(--line)',
                    background: 'var(--sf-1)',
                    cursor: 'zoom-in',
                  }}
                />
              ) : (
                <div
                  style={{
                    width: '100%',
                    maxWidth: '640px',
                    height: '260px',
                    borderRadius: '12px',
                    background: 'var(--sf-1)',
                    border: '1px solid var(--line)',
                    display: 'grid',
                    placeItems: 'center',
                    color: 'var(--tx-2)',
                    fontSize: '14px',
                  }}
                >
                  Loading question…
                </div>
              )}

              {currentItem.note && (
                <p
                  style={{
                    margin: '10px 0 0',
                    fontSize: '14px',
                    color: 'var(--tx-2)',
                    maxWidth: '920px',
                    textAlign: 'left',
                    width: '100%',
                  }}
                >
                  {currentItem.note}
                </p>
              )}

              {qUrl && (
                <div style={{ marginTop: '8px' }}>
                  <Button variant="ghost" size="sm" onClick={() => setZoomOpen(true)}>
                    <Maximize2 size={14} strokeWidth={1.75} aria-hidden="true" />
                    Tap photo to zoom
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Slide-up Reveal Panel (strictly absent from DOM until revealed) */}
          {hasRevealDrawer && (
            <div
              aria-live="polite"
              className="dh-vault-reveal-panel"
            >
              <div style={{ display: 'grid', gap: '10px', maxWidth: '760px', margin: '0 auto' }}>
                {reveal.answerOpen && (
                  <div
                    style={{
                      padding: '10px 12px',
                      borderRadius: '12px',
                      background: 'var(--ac-soft)',
                      border: '1px solid var(--ac-bd)',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '13px',
                        fontWeight: 600,
                        color: 'var(--ac-ink)',
                        marginBottom: '4px',
                      }}
                    >
                      Answer
                    </div>
                    {currentItem.answerText ? (
                      <div
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '20px',
                          fontWeight: 700,
                          color: 'var(--tx)',
                          lineHeight: 1.3,
                          wordBreak: 'break-word',
                        }}
                      >
                        {currentItem.answerText}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                        <span style={{ fontSize: '14px', color: 'var(--tx-2)' }}>No answer saved yet</span>
                        {onEditItem && (
                          <Button variant="secondary" size="sm" onClick={() => onEditItem(currentItem)}>
                            Add answer
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {reveal.solutionOpen && (
                  <div
                    style={{
                      padding: '10px 12px',
                      borderRadius: '12px',
                      background: 'var(--sf-2)',
                      border: '1px solid var(--line)',
                      display: 'grid',
                      gap: '8px',
                    }}
                  >
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--tx-2)' }}>
                      Solution
                    </div>
                    {currentItem.solutionText ? (
                      <div
                        style={{
                          fontSize: '14px',
                          color: 'var(--tx)',
                          lineHeight: 1.55,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        {currentItem.solutionText}
                      </div>
                    ) : !currentItem.hasSolutionImage ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                        <span style={{ fontSize: '14px', color: 'var(--tx-2)' }}>No solution saved yet</span>
                        {onEditItem && (
                          <Button variant="secondary" size="sm" onClick={() => onEditItem(currentItem)}>
                            Add solution
                          </Button>
                        )}
                      </div>
                    ) : null}

                    {currentItem.hasSolutionImage && sUrl && (
                      <img
                        src={sUrl}
                        alt="Saved solution"
                        style={{
                          width: '100%',
                          maxHeight: '240px',
                          objectFit: 'contain',
                          borderRadius: '10px',
                          background: 'var(--sf-1)',
                          border: '1px solid var(--line)',
                        }}
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Fixed Bottom Controls (56px rows) */}
          <footer className="dh-vault-deck-bottom">
            <div className="dh-vault-deck-btn-row">
              <Button
                variant={reveal.answerOpen ? 'primary' : 'secondary'}
                size="lg"
                onClick={() => dispatchReveal({ type: 'toggle_answer' })}
                style={{ flex: 1, minHeight: '50px' }}
              >
                {reveal.answerOpen ? <EyeOff size={16} strokeWidth={1.75} /> : <Eye size={16} strokeWidth={1.75} />}
                {reveal.answerOpen ? 'Hide answer' : 'Reveal answer'}
              </Button>
              <Button
                variant={reveal.solutionOpen ? 'primary' : 'secondary'}
                size="lg"
                onClick={() => dispatchReveal({ type: 'toggle_solution' })}
                style={{ flex: 1, minHeight: '50px' }}
              >
                {reveal.solutionOpen ? <EyeOff size={16} strokeWidth={1.75} /> : <Eye size={16} strokeWidth={1.75} />}
                {reveal.solutionOpen ? 'Hide solution' : 'Reveal solution'}
              </Button>
            </div>

            <div className="dh-vault-deck-btn-row">
              <Button
                variant="secondary"
                size="lg"
                disabled={index <= 0}
                onClick={() => markCardRevisedAndAdvance(currentItem, -1)}
                style={{ flex: 1, minHeight: '50px' }}
              >
                <ChevronLeft size={17} strokeWidth={1.75} />
                Back
              </Button>
              <Button
                variant="secondary"
                size="lg"
                onClick={handleMarkMastered}
                style={{ flex: 1.2, minHeight: '50px' }}
              >
                <CheckCircle2 size={17} strokeWidth={1.75} />
                Mastered
              </Button>
              <Button
                variant="primary"
                size="lg"
                onClick={() => markCardRevisedAndAdvance(currentItem, 1)}
                style={{ flex: 1, minHeight: '50px' }}
              >
                {index + 1 >= deckOrder.length ? 'Finish' : 'Next'}
                <ChevronRight size={17} strokeWidth={1.75} />
              </Button>
            </div>
          </footer>
        </>
      )}

      <VaultZoomViewer
        open={zoomOpen}
        src={qUrl}
        alt={`Vault question ${index + 1}`}
        caption={chapterLabel || (subjectMeta ? `${subjectMeta.emoji} ${subjectMeta.name}` : undefined)}
        onClose={() => setZoomOpen(false)}
      />
    </div>
  );
};
