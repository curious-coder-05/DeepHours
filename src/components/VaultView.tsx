import React, { Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  Archive,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit3,
  Eye,
  EyeOff,
  Images,
  Maximize2,
  MoreHorizontal,
  Play,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { Chapter, PulseHabitState, Subject } from '../types';
import { getSubject } from '../utils/studyLogic';
import {
  buildVaultArchiveFilename,
  formatVaultImportSummary,
  VAULT_ARCHIVE_EXTENSION,
} from '../utils/vaultArchive';
import {
  INITIAL_REVEAL_STATE,
  computeVaultCounts,
  filterVaultItems,
  formatRelativeVaultDate,
  groupVaultItemsByChapter,
  resolveVaultChapterName,
  resolveVaultSubjectLabel,
  revealReducer,
} from '../utils/vaultLogic';
import {
  deleteVaultItemLocal,
  exportVaultArchiveBundle,
  getVaultBlob,
  importVaultArchiveBundle,
  listVaultItems,
  saveVaultItem,
} from '../utils/vaultStore';
import type { VaultItem, VaultKind } from '../utils/vaultTypes';
import { VaultCaptureSheet } from './VaultCaptureSheet';
import { VaultZoomViewer } from './VaultZoomViewer';
import {
  Button,
  Card,
  Chip,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Segmented,
  Sheet,
  Skeleton,
} from './ui';

const VaultRevisionDeck = React.lazy(() =>
  import('./VaultRevisionDeck').then((m) => ({ default: m.VaultRevisionDeck }))
);

const DENSITY_STORAGE_KEY = 'dh_vault_density';
const PAGE_SIZE = 30;

type VaultDensity = 'comfortable' | 'compact';

export interface VaultCaptureRequest {
  nonce: number;
  kind?: VaultKind;
  subjectId?: string;
  chapterId?: string;
}

export interface VaultViewProps {
  state: PulseHabitState;
  todayKey?: string;
  initialChapterFilter?: {
    nonce: number;
    subjectId: string;
    chapterId: string;
  } | null;
  captureRequest?: VaultCaptureRequest | null;
  activeTimerText?: string | null;
  onNotify: (msg: string, undo?: () => void) => void;
  onToggleMistakeResolved: (id: string) => void;
  onDeleteMistake: (id: string) => void;
  onToggleDoubtResolved: (id: string) => void;
  onDeleteDoubt: (id: string) => void;
}

interface LazyBlobImageProps {
  itemId: string;
  slot: 'q' | 's';
  alt: string;
  className?: string;
  style?: React.CSSProperties;
  onClick?: (url: string) => void;
}

const LazyVaultBlobImage: React.FC<LazyBlobImageProps> = ({
  itemId,
  slot,
  alt,
  className,
  style,
  onClick,
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState<boolean>(false);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          setInView(entry.isIntersecting);
        }
      },
      { rootMargin: '260px 0px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!inView) {
      setUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }
    let cancelled = false;
    void (async () => {
      const blob = await getVaultBlob(itemId, slot);
      if (!blob || cancelled) return;
      const nextUrl = URL.createObjectURL(blob);
      if (cancelled) {
        URL.revokeObjectURL(nextUrl);
        return;
      }
      setUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return nextUrl;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [inView, itemId, slot]);

  useEffect(() => {
    return () => {
      setUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, []);

  return (
    <div ref={hostRef} className={className} style={style}>
      {url ? (
        <img
          src={url}
          alt={alt}
          loading="lazy"
          onClick={onClick ? () => onClick(url) : undefined}
          style={{
            width: '100%',
            height: '100%',
            objectFit: className?.includes('thumb') ? 'cover' : 'contain',
            display: 'block',
            borderRadius: '10px',
            cursor: onClick ? 'zoom-in' : undefined,
          }}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            minHeight: className?.includes('thumb') ? '52px' : '150px',
            borderRadius: '10px',
            background: 'var(--sf-2)',
          }}
        />
      )}
    </div>
  );
};

interface VaultCardProps {
  item: VaultItem;
  subject: { name: string; emoji: string; color: string };
  chapterName?: string;
  onToggleMastered: (item: VaultItem) => void;
  onEdit: (item: VaultItem) => void;
  onRequestDelete: (item: VaultItem) => void;
  onZoom: (url: string, item: VaultItem) => void;
  onQuickView: (item: VaultItem) => void;
}

const VaultQuestionCard: React.FC<VaultCardProps> = ({
  item,
  subject,
  chapterName,
  onToggleMastered,
  onEdit,
  onRequestDelete,
  onZoom,
  onQuickView,
}) => {
  const [reveal, dispatchReveal] = useReducer(revealReducer, INITIAL_REVEAL_STATE);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <article className="dh-vault-card">
        {/* Card Meta Strip */}
        <div className="dh-vault-card-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', minWidth: 0 }}>
            <span
              aria-hidden="true"
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '99px',
                background: subject.color,
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--tx)' }}>
              {subject.emoji} {subject.name}
            </span>
            {chapterName && (
              <span
                style={{
                  fontSize: '13px',
                  color: 'var(--tx-2)',
                  maxWidth: '170px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                · {chapterName}
              </span>
            )}
            <span
              style={{
                padding: '2px 8px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                background:
                  item.kind === 'hard'
                    ? 'color-mix(in srgb, var(--warn) 14%, transparent)'
                    : 'var(--sf-2)',
                border:
                  item.kind === 'hard'
                    ? '1px solid color-mix(in srgb, var(--warn) 35%, transparent)'
                    : '1px solid var(--line)',
                color: item.kind === 'hard' ? 'var(--warn-ink)' : 'var(--tx-2)',
              }}
            >
              {item.kind === 'hard' ? 'Hard / Trap' : 'Unsolved'}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
            <span className="tabular-nums" style={{ fontSize: '13px', color: 'var(--tx-3)' }}>
              {formatRelativeVaultDate(item.createdAt)}
            </span>
            <IconButton label="Question actions" onClick={() => setMenuOpen(true)}>
              <MoreHorizontal size={17} strokeWidth={1.75} />
            </IconButton>
          </div>
        </div>

        {/* Question Image */}
        <LazyVaultBlobImage
          itemId={item.id}
          slot="q"
          alt={chapterName ? `${chapterName} question` : 'Vault question'}
          className="dh-vault-card-media"
          onClick={(url) => onZoom(url, item)}
        />

        {item.note && (
          <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--tx-2)', lineHeight: 1.45 }}>
            {item.note}
          </p>
        )}

        {/* Strict Two-Stage Reveal Row */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <Button
            variant={reveal.answerOpen ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => dispatchReveal({ type: 'toggle_answer' })}
            style={{ flex: '1 1 120px' }}
          >
            {reveal.answerOpen ? (
              <EyeOff size={14} strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <Eye size={14} strokeWidth={1.75} aria-hidden="true" />
            )}
            {reveal.answerOpen ? 'Hide answer' : 'Reveal answer'}
          </Button>
          <Button
            variant={reveal.solutionOpen ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => dispatchReveal({ type: 'toggle_solution' })}
            style={{ flex: '1 1 120px' }}
          >
            {reveal.solutionOpen ? (
              <EyeOff size={14} strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <Eye size={14} strokeWidth={1.75} aria-hidden="true" />
            )}
            {reveal.solutionOpen ? 'Hide solution' : 'Reveal solution'}
          </Button>
          <Button
            variant={item.mastered ? 'secondary' : 'ghost'}
            size="sm"
            aria-label={item.mastered ? 'Move back to active' : 'Mark mastered'}
            onClick={() => onToggleMastered(item)}
            style={{
              color: item.mastered ? 'var(--ok-ink)' : 'var(--tx-2)',
              borderColor: item.mastered
                ? 'color-mix(in srgb, var(--ok) 36%, transparent)'
                : undefined,
            }}
          >
            {item.mastered ? (
              <RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <Check size={15} strokeWidth={1.75} aria-hidden="true" />
            )}
            {item.mastered ? 'Active' : 'Mastered'}
          </Button>
        </div>

        {/* Conditionally mounted reveal region — strictly absent from DOM until toggled */}
        {(reveal.answerOpen || reveal.solutionOpen) && (
          <div aria-live="polite" style={{ display: 'grid', gap: '8px' }}>
            {reveal.answerOpen && (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: '10px',
                  background: 'var(--ac-soft)',
                  border: '1px solid var(--ac-bd)',
                }}
              >
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ac-ink)' }}>
                  Answer
                </div>
                {item.answerText ? (
                  <div
                    style={{
                      marginTop: '2px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '20px',
                      fontWeight: 700,
                      color: 'var(--tx)',
                      wordBreak: 'break-word',
                    }}
                  >
                    {item.answerText}
                  </div>
                ) : (
                  <div
                    style={{
                      marginTop: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                    }}
                  >
                    <span style={{ fontSize: '13px', color: 'var(--tx-2)' }}>No answer saved</span>
                    <Button variant="secondary" size="sm" onClick={() => onEdit(item)}>
                      Add answer
                    </Button>
                  </div>
                )}
              </div>
            )}

            {reveal.solutionOpen && (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: '10px',
                  background: 'var(--sf-2)',
                  border: '1px solid var(--line)',
                  display: 'grid',
                  gap: '8px',
                }}
              >
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--tx-2)' }}>
                  Solution
                </div>
                {item.solutionText ? (
                  <div
                    style={{
                      fontSize: '14px',
                      color: 'var(--tx)',
                      lineHeight: 1.5,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {item.solutionText}
                  </div>
                ) : !item.hasSolutionImage ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                    }}
                  >
                    <span style={{ fontSize: '13px', color: 'var(--tx-2)' }}>
                      No solution saved
                    </span>
                    <Button variant="secondary" size="sm" onClick={() => onEdit(item)}>
                      Add solution
                    </Button>
                  </div>
                ) : null}

                {item.hasSolutionImage && (
                  <LazyVaultBlobImage
                    itemId={item.id}
                    slot="s"
                    alt="Solution photo"
                    style={{ maxHeight: '220px', overflow: 'hidden' }}
                    onClick={(url) => onZoom(url, item)}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </article>

      <Sheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={chapterName || `${subject.emoji} ${subject.name}`}
        subtitle={item.kind === 'hard' ? 'Hard / Trap question' : 'Unsolved question'}
      >
        <div style={{ display: 'grid', gap: '8px' }}>
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            onClick={() => {
              setMenuOpen(false);
              onQuickView(item);
            }}
          >
            <Images size={16} strokeWidth={1.75} aria-hidden="true" />
            Open in Quick-View
          </Button>
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            onClick={() => {
              setMenuOpen(false);
              onEdit(item);
            }}
          >
            <Edit3 size={16} strokeWidth={1.75} aria-hidden="true" />
            Edit question &amp; solution
          </Button>
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            onClick={() => {
              setMenuOpen(false);
              onToggleMastered(item);
            }}
          >
            {item.mastered ? (
              <RotateCcw size={16} strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <Check size={16} strokeWidth={1.75} aria-hidden="true" />
            )}
            {item.mastered ? 'Move back to Active' : 'Mark as Mastered'}
          </Button>
          <Button
            variant="danger"
            size="lg"
            fullWidth
            onClick={() => {
              setMenuOpen(false);
              onRequestDelete(item);
            }}
          >
            <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
            Delete question
          </Button>
        </div>
      </Sheet>
    </>
  );
};

export interface VaultQuickViewProps {
  open: boolean;
  items: readonly VaultItem[];
  initialItemId?: string | null;
  subjects: readonly Subject[];
  chapters: readonly Chapter[];
  onClose: () => void;
  onToggleMastered: (item: VaultItem) => void;
}

export const VaultQuickView: React.FC<VaultQuickViewProps> = ({
  open,
  items,
  initialItemId,
  subjects,
  chapters,
  onClose,
  onToggleMastered,
}) => {
  const orderedItems = useMemo(
    () =>
      items
        .filter((it) => !it.deletedAt)
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt),
    [items]
  );

  const [index, setIndex] = useState<number>(0);
  const [reveal, dispatchReveal] = useReducer(revealReducer, INITIAL_REVEAL_STATE);
  const [qUrl, setQUrl] = useState<string | null>(null);
  const [sUrl, setSUrl] = useState<string | null>(null);
  const [zoomSrc, setZoomSrc] = useState<{ src: string; alt: string; caption?: string } | null>(
    null
  );
  const urlCacheRef = useRef<Map<string, string>>(new Map());
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const thumbStripRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      for (const u of urlCacheRef.current.values()) {
        URL.revokeObjectURL(u);
      }
      urlCacheRef.current.clear();
      setQUrl(null);
      setSUrl(null);
      setZoomSrc(null);
      dispatchReveal({ type: 'reset' });
      return;
    }
    const targetIdx =
      initialItemId && orderedItems.length > 0
        ? Math.max(
            0,
            orderedItems.findIndex((it) => it.id === initialItemId)
          )
        : 0;
    setIndex(targetIdx);
    dispatchReveal({ type: 'reset' });
  }, [initialItemId, open, orderedItems.length]);

  // Clamp index if items are deleted/filtered while open
  useEffect(() => {
    if (!open) return;
    if (orderedItems.length === 0) {
      onClose();
      return;
    }
    if (index >= orderedItems.length) {
      setIndex(orderedItems.length - 1);
    }
  }, [index, onClose, open, orderedItems.length]);

  const currentItem = open && orderedItems[index] ? orderedItems[index] : null;
  const prevItem = open && index > 0 ? orderedItems[index - 1] : null;
  const nextItem = open && index + 1 < orderedItems.length ? orderedItems[index + 1] : null;

  const ensureBlobUrl = useCallback(async (itemId: string, slot: 'q' | 's') => {
    const key = `${itemId}:${slot}`;
    const cached = urlCacheRef.current.get(key);
    if (cached) return cached;
    const blob = await getVaultBlob(itemId, slot);
    if (!blob) return null;
    const nextUrl = URL.createObjectURL(blob);
    urlCacheRef.current.set(key, nextUrl);
    return nextUrl;
  }, []);

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
      if (nextItem) void ensureBlobUrl(nextItem.id, 'q');
      if (prevItem) void ensureBlobUrl(prevItem.id, 'q');
    })();
    return () => {
      cancelled = true;
    };
  }, [currentItem, ensureBlobUrl, nextItem, open, prevItem]);

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

  // Keep active thumbnail visible in scrubber strip
  useEffect(() => {
    if (!open || !thumbStripRef.current) return;
    const activeEl = thumbStripRef.current.children[index] as HTMLElement | undefined;
    if (activeEl && typeof activeEl.scrollIntoView === 'function') {
      activeEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [index, open]);

  const stepTo = useCallback(
    (nextIndex: number) => {
      if (orderedItems.length === 0) return;
      const bounded = Math.max(0, Math.min(orderedItems.length - 1, nextIndex));
      if (bounded === index) return;
      setIndex(bounded);
      dispatchReveal({ type: 'reset' });
      setZoomSrc(null);
    },
    [index, orderedItems.length]
  );

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (zoomSrc) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        stepTo(index + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepTo(index - 1);
      } else if (e.key.toLowerCase() === 'a') {
        e.preventDefault();
        dispatchReveal({ type: 'toggle_answer' });
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        dispatchReveal({ type: 'toggle_solution' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [index, onClose, open, stepTo, zoomSrc]);

  if (!open || !currentItem) return null;

  const subject = resolveVaultSubjectLabel(subjects, currentItem.subjectId);
  const chapterName = currentItem.chapterId
    ? resolveVaultChapterName(chapters, currentItem.chapterId)
    : undefined;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Vault Quick-View"
      className="dh-vault-quickview"
    >
      <div className="dh-vault-quickview-top">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--tx)' }}>
              Vault Quick-View
            </div>
            <div className="tabular-nums" style={{ fontSize: '13px', color: 'var(--tx-2)' }}>
              {index + 1} / {orderedItems.length} · {formatRelativeVaultDate(currentItem.createdAt)}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <Button
            variant={currentItem.mastered ? 'secondary' : 'ghost'}
            size="sm"
            aria-label={currentItem.mastered ? 'Move back to active' : 'Mark mastered'}
            onClick={() => onToggleMastered(currentItem)}
            style={{
              minHeight: '40px',
              color: currentItem.mastered ? 'var(--ok-ink)' : 'var(--tx-2)',
            }}
          >
            {currentItem.mastered ? (
              <RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <Check size={15} strokeWidth={1.75} aria-hidden="true" />
            )}
            <span>{currentItem.mastered ? 'Mastered' : 'Mark done'}</span>
          </Button>
          {qUrl && (
            <IconButton
              size={44}
              label="Zoom study photo"
              onClick={() =>
                setZoomSrc({
                  src: qUrl,
                  alt: chapterName ? `${chapterName} study photo` : 'Vault study photo',
                  caption: chapterName || subject.name,
                })
              }
            >
              <Maximize2 size={18} strokeWidth={1.75} />
            </IconButton>
          )}
          <IconButton size={48} label="Close Vault Quick-View" onClick={onClose}>
            <X size={20} strokeWidth={1.75} />
          </IconButton>
        </div>
      </div>

      {/* Tag & Subject Strip */}
      <div className="dh-vault-quickview-meta">
        <span
          aria-hidden="true"
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '99px',
            background: subject.color,
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--tx)' }}>
          {subject.emoji} {subject.name}
        </span>
        {chapterName && (
          <span style={{ fontSize: '13px', color: 'var(--tx-2)' }}>· {chapterName}</span>
        )}
        <span
          style={{
            padding: '2px 8px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            background:
              currentItem.kind === 'hard'
                ? 'color-mix(in srgb, var(--warn) 14%, transparent)'
                : 'var(--sf-2)',
            border:
              currentItem.kind === 'hard'
                ? '1px solid color-mix(in srgb, var(--warn) 35%, transparent)'
                : '1px solid var(--line)',
            color: currentItem.kind === 'hard' ? 'var(--warn-ink)' : 'var(--tx-2)',
          }}
        >
          {currentItem.kind === 'hard' ? 'Hard / Trap' : 'Unsolved'}
        </span>
        {currentItem.note && (
          <span style={{ fontSize: '13px', color: 'var(--tx-2)' }}>· {currentItem.note}</span>
        )}
      </div>

      {/* Main Photo Stage (supports left/right horizontal touch swipe) */}
      <div
        className="dh-vault-quickview-stage"
        onTouchStart={(e) => {
          if (e.touches.length === 1) {
            swipeStartRef.current = {
              x: e.touches[0].clientX,
              y: e.touches[0].clientY,
            };
          }
        }}
        onTouchEnd={(e) => {
          if (!swipeStartRef.current || e.changedTouches.length !== 1) return;
          const dx = e.changedTouches[0].clientX - swipeStartRef.current.x;
          const dy = e.changedTouches[0].clientY - swipeStartRef.current.y;
          swipeStartRef.current = null;
          if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.25) {
            if (dx < 0) stepTo(index + 1);
            else stepTo(index - 1);
          }
        }}
      >
        {qUrl ? (
          <img
            src={qUrl}
            alt={chapterName ? `${chapterName} question` : 'Vault study photo'}
            className="dh-vault-quickview-img"
            onClick={() =>
              setZoomSrc({
                src: qUrl,
                alt: chapterName ? `${chapterName} study photo` : 'Vault study photo',
                caption: chapterName || subject.name,
              })
            }
          />
        ) : (
          <div
            style={{
              width: 'min(100%, 420px)',
              height: '240px',
              borderRadius: '14px',
              background: 'var(--sf-2)',
              border: '1px solid var(--line)',
            }}
          />
        )}

        {(reveal.answerOpen || reveal.solutionOpen) && (
          <div
            aria-live="polite"
            style={{
              width: 'min(100%, 720px)',
              display: 'grid',
              gap: '8px',
            }}
          >
            {reveal.answerOpen && (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: '10px',
                  background: 'var(--ac-soft)',
                  border: '1px solid var(--ac-bd)',
                }}
              >
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ac-ink)' }}>
                  Answer
                </div>
                <div
                  style={{
                    marginTop: '2px',
                    fontFamily: currentItem.answerText ? 'var(--font-mono)' : undefined,
                    fontSize: currentItem.answerText ? '18px' : '13px',
                    fontWeight: currentItem.answerText ? 700 : 500,
                    color: currentItem.answerText ? 'var(--tx)' : 'var(--tx-2)',
                  }}
                >
                  {currentItem.answerText || 'No answer saved'}
                </div>
              </div>
            )}
            {reveal.solutionOpen && (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: '10px',
                  background: 'var(--sf-1)',
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
                      lineHeight: 1.5,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {currentItem.solutionText}
                  </div>
                ) : !currentItem.hasSolutionImage ? (
                  <div style={{ fontSize: '13px', color: 'var(--tx-2)' }}>No solution saved</div>
                ) : null}
                {currentItem.hasSolutionImage && sUrl && (
                  <img
                    src={sUrl}
                    alt="Solution photo"
                    onClick={() =>
                      setZoomSrc({
                        src: sUrl,
                        alt: 'Solution photo',
                        caption: chapterName || subject.name,
                      })
                    }
                    style={{
                      maxWidth: '100%',
                      maxHeight: '200px',
                      objectFit: 'contain',
                      borderRadius: '10px',
                      cursor: 'zoom-in',
                    }}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Recent Photo Filmstrip Scrubber */}
      {orderedItems.length > 1 && (
        <div
          ref={thumbStripRef}
          className="dh-vault-quickview-strip"
          role="listbox"
          aria-label="Recent tagged study photos"
        >
          {orderedItems.map((it, idx) => {
            const sub = resolveVaultSubjectLabel(subjects, it.subjectId);
            const active = idx === index;
            return (
              <button
                key={it.id}
                type="button"
                role="option"
                aria-selected={active}
                aria-label={`Photo ${idx + 1}: ${sub.name}${it.note ? ` — ${it.note}` : ''}`}
                className={`dh-vault-quickview-thumb ${active ? 'active' : ''}`}
                onClick={() => stepTo(idx)}
              >
                <LazyVaultBlobImage
                  itemId={it.id}
                  slot="q"
                  alt=""
                  className="thumb"
                  style={{ width: '100%', height: '100%' }}
                />
              </button>
            );
          })}
        </div>
      )}

      {/* Bottom Cycling & Peek Controls */}
      <div className="dh-vault-quickview-bottom">
        <Button
          variant="secondary"
          size="lg"
          disabled={index === 0}
          aria-label="Previous study photo"
          onClick={() => stepTo(index - 1)}
        >
          <ChevronLeft size={18} strokeWidth={1.75} aria-hidden="true" />
          Prev
        </Button>

        <Button
          variant={reveal.answerOpen ? 'primary' : 'secondary'}
          size="md"
          style={{ flex: 1, minHeight: '48px' }}
          onClick={() => dispatchReveal({ type: 'toggle_answer' })}
        >
          {reveal.answerOpen ? (
            <EyeOff size={15} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <Eye size={15} strokeWidth={1.75} aria-hidden="true" />
          )}
          Answer
        </Button>

        <Button
          variant={reveal.solutionOpen ? 'primary' : 'secondary'}
          size="md"
          style={{ flex: 1, minHeight: '48px' }}
          onClick={() => dispatchReveal({ type: 'toggle_solution' })}
        >
          {reveal.solutionOpen ? (
            <EyeOff size={15} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <Eye size={15} strokeWidth={1.75} aria-hidden="true" />
          )}
          Solution
        </Button>

        <Button
          variant="primary"
          size="lg"
          disabled={index >= orderedItems.length - 1}
          aria-label="Next study photo"
          onClick={() => stepTo(index + 1)}
        >
          Next
          <ChevronRight size={18} strokeWidth={1.75} aria-hidden="true" />
        </Button>
      </div>

      <VaultZoomViewer
        open={Boolean(zoomSrc)}
        src={zoomSrc?.src || null}
        alt={zoomSrc?.alt || 'Vault study photo'}
        caption={zoomSrc?.caption}
        onClose={() => setZoomSrc(null)}
      />
    </div>
  );
};

export const VaultView: React.FC<VaultViewProps> = ({
  state,
  todayKey,
  initialChapterFilter,
  captureRequest,
  activeTimerText,
  onNotify,
  onToggleMistakeResolved,
  onDeleteMistake,
  onToggleDoubtResolved,
  onDeleteDoubt,
}) => {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const [subjectFilter, setSubjectFilter] = useState<string>('all');
  const [chapterFilter, setChapterFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'active' | 'mastered' | 'all'>('active');
  const [kindFilter, setKindFilter] = useState<'all' | VaultKind>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [density, setDensity] = useState<VaultDensity>(() => {
    try {
      const saved =
        typeof window !== 'undefined' ? window.localStorage.getItem(DENSITY_STORAGE_KEY) : null;
      return saved === 'compact' ? 'compact' : 'comfortable';
    } catch {
      return 'comfortable';
    }
  });
  const [visibleLimit, setVisibleLimit] = useState<number>(PAGE_SIZE);

  // Sticky row B hide-on-scroll-down / show-on-scroll-up
  const [hideRowB, setHideRowB] = useState<boolean>(false);
  const lastScrollYRef = useRef<number>(0);

  // Modals / Sheets
  const [chapterPickerOpen, setChapterPickerOpen] = useState<boolean>(false);
  const [filtersSheetOpen, setFiltersSheetOpen] = useState<boolean>(false);
  const [captureOpen, setCaptureOpen] = useState<boolean>(false);
  const [captureSeed, setCaptureSeed] = useState<{
    subjectId?: string;
    chapterId?: string;
    kind?: VaultKind;
  } | null>(null);
  const [editingItem, setEditingItem] = useState<VaultItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VaultItem | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);

  // Compact row detail sheet
  const [compactDetailItem, setCompactDetailItem] = useState<VaultItem | null>(null);

  // Zoom viewer
  const [zoomState, setZoomState] = useState<{ src: string; alt: string; caption?: string } | null>(
    null
  );

  // Vault Quick-View overlay
  const [quickViewState, setQuickViewState] = useState<{
    open: boolean;
    initialItemId: string | null;
  }>({ open: false, initialItemId: null });

  // Revision Deck
  const [deckScope, setDeckScope] = useState<{
    open: boolean;
    items: VaultItem[];
    label: string;
  }>({ open: false, items: [], label: 'Vault' });

  // Legacy collapsed accordion (V12)
  const [legacyExpanded, setLegacyExpanded] = useState<boolean>(false);

  // Local Vault Export / Import archive
  const [backupSheetOpen, setBackupSheetOpen] = useState<boolean>(false);
  const [archiveBusy, setArchiveBusy] = useState<'export' | 'import' | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const loadItems = useCallback(async () => {
    try {
      const list = await listVaultItems();
      setItems(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  // Apply external chapter filter jump (e.g. from Syllabus row chip)
  useEffect(() => {
    if (initialChapterFilter && initialChapterFilter.nonce > 0) {
      setSubjectFilter(initialChapterFilter.subjectId || 'all');
      setChapterFilter(initialChapterFilter.chapterId || 'all');
      setStatusFilter('all');
      setVisibleLimit(PAGE_SIZE);
    }
  }, [initialChapterFilter]);

  // Apply external capture trigger (from + Quick Actions or Mock Test modal)
  useEffect(() => {
    if (captureRequest && captureRequest.nonce > 0) {
      setEditingItem(null);
      setCaptureSeed({
        kind: captureRequest.kind,
        subjectId: captureRequest.subjectId,
        chapterId: captureRequest.chapterId,
      });
      setCaptureOpen(true);
    }
  }, [captureRequest]);

  // Persist density
  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(DENSITY_STORAGE_KEY, density);
      }
    } catch {
      // ignore
    }
  }, [density]);

  // Scroll listener for Row B hide/reveal
  useEffect(() => {
    if (typeof window === 'undefined') return;
    lastScrollYRef.current = window.scrollY || 0;
    const onScroll = () => {
      const y = window.scrollY || 0;
      const delta = y - lastScrollYRef.current;
      if (y <= 64) {
        setHideRowB(false);
      } else if (delta > 16) {
        setHideRowB(true);
      } else if (delta < -12) {
        setHideRowB(false);
      }
      lastScrollYRef.current = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const counts = useMemo(() => computeVaultCounts(items), [items]);
  const activeSubjects = useMemo(
    () => state.subjects.filter((s) => !s.arch),
    [state.subjects]
  );

  const filteredItems = useMemo(
    () =>
      filterVaultItems(items, {
        subjectId: subjectFilter,
        chapterId: chapterFilter,
        status: statusFilter,
        kind: kindFilter,
        query: searchQuery,
        subjects: state.subjects,
        chapters: state.chapters,
      }),
    [
      chapterFilter,
      items,
      kindFilter,
      searchQuery,
      state.chapters,
      state.subjects,
      statusFilter,
      subjectFilter,
    ]
  );

  const quickViewItems = useMemo(() => {
    if (filteredItems.length > 0) return filteredItems;
    return items.filter((i) => !i.deletedAt).slice().sort((a, b) => b.createdAt - a.createdAt);
  }, [filteredItems, items]);

  const pagedItems = useMemo(
    () => filteredItems.slice(0, visibleLimit),
    [filteredItems, visibleLimit]
  );

  const groupedByChapter = useMemo(
    () => groupVaultItemsByChapter(pagedItems, state.subjects, state.chapters),
    [pagedItems, state.chapters, state.subjects]
  );

  const selectedChapterList = useMemo(() => {
    if (subjectFilter === 'all') return [];
    const subChapters = state.chapters.filter((c) => c.subjectId === subjectFilter);
    return subChapters.map((c) => ({
      chapter: c,
      count: counts.byChapter[c.id]?.total ?? 0,
      activeCount: counts.byChapter[c.id]?.active ?? 0,
    }));
  }, [counts.byChapter, state.chapters, subjectFilter]);

  const unassignedCountForSelectedSubject = useMemo(() => {
    if (subjectFilter === 'all') return 0;
    return items.filter(
      (i) => !i.deletedAt && i.subjectId === subjectFilter && !i.chapterId
    ).length;
  }, [items, subjectFilter]);

  const activeFilterBadgeCount =
    (kindFilter !== 'all' ? 1 : 0) + (density === 'compact' ? 1 : 0);

  const clearAllFilters = () => {
    setSubjectFilter('all');
    setChapterFilter('all');
    setStatusFilter('active');
    setKindFilter('all');
    setSearchQuery('');
    setVisibleLimit(PAGE_SIZE);
  };

  const handleToggleMastered = useCallback(
    async (item: VaultItem) => {
      const nextMastered = !item.mastered;
      const now = Date.now();
      const updated = await saveVaultItem({
        ...item,
        mastered: nextMastered,
        masteredAt: nextMastered ? now : undefined,
        updatedAt: now,
        syncState: 'pending',
      });
      await loadItems();
      onNotify(
        nextMastered ? 'Moved to Mastered' : 'Moved back to Active',
        () => {
          void saveVaultItem({
            ...updated,
            mastered: item.mastered,
            masteredAt: item.masteredAt,
            updatedAt: Date.now(),
            syncState: 'pending',
          }).then(() => {
            void loadItems();
          });
        }
      );
    },
    [loadItems, onNotify]
  );

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteVaultItemLocal(deleteTarget.id);
      setDeleteTarget(null);
      setCompactDetailItem((cur) => (cur?.id === deleteTarget.id ? null : cur));
      await loadItems();
      onNotify('Question deleted from Vault');
    } finally {
      setDeleting(false);
    }
  };

  const handleRecordRevisedInDeck = useCallback(
    async (item: VaultItem) => {
      const now = Date.now();
      await saveVaultItem({
        ...item,
        revisionCount: (item.revisionCount || 0) + 1,
        lastRevisedAt: now,
        updatedAt: now,
        syncState: 'pending',
      });
      await loadItems();
    },
    [loadItems]
  );

  const handleMarkMasteredInDeck = useCallback(
    async (item: VaultItem) => {
      await handleToggleMastered({ ...item, mastered: false });
    },
    [handleToggleMastered]
  );

  const launchRevisionForItems = (targetItems: VaultItem[], label: string) => {
    const activeOnes = targetItems.filter((i) => !i.mastered && !i.deletedAt);
    if (activeOnes.length === 0) {
      onNotify('No active questions to revise in this group');
      return;
    }
    setDeckScope({ open: true, items: activeOnes, label });
  };

  const totalVaultBytes = useMemo(
    () => items.reduce((acc, it) => acc + (it.qBytes || 0), 0),
    [items]
  );

  const formattedVaultSize = useMemo(() => {
    if (totalVaultBytes <= 0) return '0 KB';
    if (totalVaultBytes >= 1024 * 1024) {
      return `${(totalVaultBytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${Math.max(1, Math.round(totalVaultBytes / 1024))} KB`;
  }, [totalVaultBytes]);

  const handleExportVault = useCallback(async () => {
    if (archiveBusy || counts.total === 0) return;
    setArchiveBusy('export');
    setArchiveError(null);
    try {
      const bundle = await exportVaultArchiveBundle();
      if (bundle.itemCount === 0) {
        onNotify('No Vault questions to export');
        return;
      }
      const json = JSON.stringify(bundle);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = buildVaultArchiveFilename(todayKey);
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      setBackupSheetOpen(false);
      onNotify(
        `Exported ${bundle.itemCount} Vault question${bundle.itemCount === 1 ? '' : 's'}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to export Vault archive';
      setArchiveError(msg);
    } finally {
      setArchiveBusy(null);
    }
  }, [archiveBusy, counts.total, onNotify, todayKey]);

  const handleImportVaultFile = useCallback(
    async (file?: File | null) => {
      if (!file || archiveBusy) return;
      setArchiveBusy('import');
      setArchiveError(null);
      try {
        const rawJson = await file.text();
        const result = await importVaultArchiveBundle(rawJson);
        await loadItems();
        setBackupSheetOpen(false);
        onNotify(formatVaultImportSummary(result));
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Could not import Vault archive';
        setArchiveError(msg);
        if (!backupSheetOpen) {
          onNotify(msg);
        }
      } finally {
        setArchiveBusy(null);
        if (importInputRef.current) {
          importInputRef.current.value = '';
        }
      }
    },
    [archiveBusy, backupSheetOpen, loadItems, onNotify]
  );

  const legacyMistakes = state.mistakes || [];
  const legacyDoubts = state.doubts || [];
  const hasLegacyNotes = legacyMistakes.length > 0 || legacyDoubts.length > 0;

  const selectedChapterLabel =
    chapterFilter === 'all'
      ? 'All chapters'
      : chapterFilter === '__unassigned__'
        ? 'Unassigned'
        : resolveVaultChapterName(state.chapters, chapterFilter);

  const singleChapterStats = useMemo(() => {
    if (chapterFilter === 'all') return null;
    const allInChapter = items.filter((i) => {
      if (i.deletedAt) return false;
      if (subjectFilter !== 'all' && i.subjectId !== subjectFilter) return false;
      if (chapterFilter === '__unassigned__') return !i.chapterId;
      return i.chapterId === chapterFilter;
    });
    const activeCount = allInChapter.filter((i) => !i.mastered).length;
    const masteredCount = allInChapter.filter((i) => i.mastered).length;
    return { allInChapter, activeCount, masteredCount };
  }, [chapterFilter, items, subjectFilter]);

  return (
    <div style={{ display: 'grid', gap: '14px' }}>
      <input
        ref={importInputRef}
        type="file"
        accept={`${VAULT_ARCHIVE_EXTENSION},.json,application/json`}
        hidden
        onChange={(e) => void handleImportVaultFile(e.target.files?.[0])}
      />

      {/* V1 Header */}
      <Card style={{ margin: 0, display: 'grid', gap: '12px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: 'var(--tx)' }}>
              Vault
            </h2>
            <p className="tabular-nums" style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--tx-2)' }}>
              {counts.total === 0
                ? 'Unsolved and hard questions ready to snap & revise'
                : `${counts.active} active · ${counts.mastered} mastered`}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {counts.total > 0 && (
              <Button
                variant="secondary"
                size="md"
                onClick={() =>
                  setQuickViewState({
                    open: true,
                    initialItemId: quickViewItems[0]?.id ?? null,
                  })
                }
              >
                <Images size={15} strokeWidth={1.75} aria-hidden="true" />
                Quick-View
              </Button>
            )}
            {counts.active > 0 && (
              <Button
                variant="secondary"
                size="md"
                onClick={() =>
                  launchRevisionForItems(
                    filteredItems,
                    chapterFilter !== 'all' ? selectedChapterLabel : 'Vault'
                  )
                }
              >
                <Play size={15} strokeWidth={1.75} aria-hidden="true" />
                Start revision ({filteredItems.filter((i) => !i.mastered).length})
              </Button>
            )}
            <IconButton
              size={48}
              label="Export or import Vault backup"
              title="Export or import Vault backup"
              onClick={() => {
                setArchiveError(null);
                setBackupSheetOpen(true);
              }}
            >
              <Archive size={18} strokeWidth={1.75} aria-hidden="true" />
            </IconButton>
            <Button
              variant="primary"
              size="md"
              onClick={() => {
                setEditingItem(null);
                setCaptureSeed(null);
                setCaptureOpen(true);
              }}
            >
              <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
              Add question
            </Button>
          </div>
        </div>
      </Card>

      {/* V2 Sticky Filter & Search Bar (shown when Vault has at least 1 question) */}
      {counts.total > 0 && (
        <div className="dh-vault-filterbar">
          {/* Search by tag, note, subject, or chapter */}
          <div className="dh-vault-search-wrap">
            <Search
              size={16}
              strokeWidth={1.75}
              aria-hidden="true"
              style={{ color: 'var(--tx-3)', flexShrink: 0 }}
            />
            <input
              type="search"
              className="dh-vault-search-input"
              aria-label="Search Vault by tag, note, or subject"
              placeholder="Search by tag, note, subject, or chapter…"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setVisibleLimit(PAGE_SIZE);
              }}
            />
            {searchQuery.trim().length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                <span
                  className="tabular-nums"
                  style={{ fontSize: '13px', color: 'var(--tx-2)', paddingRight: '2px' }}
                >
                  {filteredItems.length}
                </span>
                <IconButton
                  size={40}
                  variant="ghost"
                  label="Clear Vault search"
                  onClick={() => {
                    setSearchQuery('');
                    setVisibleLimit(PAGE_SIZE);
                  }}
                >
                  <X size={16} strokeWidth={1.75} />
                </IconButton>
              </div>
            )}
          </div>

          {/* Row A: Horizontal Subject Chips */}
          <div className="dh-vault-chips-scroll" role="region" aria-label="Filter by subject">
            <Chip
              selected={subjectFilter === 'all'}
              onClick={() => {
                setSubjectFilter('all');
                setChapterFilter('all');
                setVisibleLimit(PAGE_SIZE);
              }}
            >
              All ({counts.total})
            </Chip>
            {activeSubjects.map((sub: Subject) => {
              const c = counts.bySubject[sub.id]?.total ?? 0;
              return (
                <Chip
                  key={sub.id}
                  selected={subjectFilter === sub.id}
                  colorDot={sub.color}
                  onClick={() => {
                    setSubjectFilter(sub.id);
                    setChapterFilter('all');
                    setVisibleLimit(PAGE_SIZE);
                  }}
                >
                  {sub.e} {sub.name} ({c})
                </Chip>
              );
            })}
          </div>

          {/* Row B: Chapter Picker + Status Segmented + Filters Sheet Trigger */}
          <div className={`dh-vault-filter-rowb ${hideRowB ? 'hidden-scroll' : ''}`}>
            <Button
              variant="secondary"
              size="sm"
              disabled={subjectFilter === 'all'}
              onClick={() => setChapterPickerOpen(true)}
              style={{
                maxWidth: '170px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {subjectFilter === 'all' ? 'All chapters' : selectedChapterLabel}
              </span>
              <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />
            </Button>

            <div style={{ flex: '1 1 200px', minWidth: 0 }}>
              <Segmented<'active' | 'mastered' | 'all'>
                ariaLabel="Vault question status"
                value={statusFilter}
                onChange={(v) => {
                  setStatusFilter(v);
                  setVisibleLimit(PAGE_SIZE);
                }}
                options={[
                  { value: 'active', label: `Active (${counts.active})` },
                  { value: 'mastered', label: `Mastered (${counts.mastered})` },
                  { value: 'all', label: 'All' },
                ]}
              />
            </div>

            <Button
              variant="secondary"
              size="sm"
              aria-label="More Vault filters and density"
              onClick={() => setFiltersSheetOpen(true)}
            >
              <SlidersHorizontal size={15} strokeWidth={1.75} aria-hidden="true" />
              <span>Filters</span>
              {activeFilterBadgeCount > 0 && (
                <span
                  className="tabular-nums"
                  style={{
                    minWidth: '18px',
                    height: '18px',
                    padding: '0 5px',
                    borderRadius: '99px',
                    background: 'var(--ac)',
                    color: 'var(--ac-on)',
                    fontSize: '12px',
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {activeFilterBadgeCount}
                </span>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Main Content */}
      {loading ? (
        <div style={{ display: 'grid', gap: '12px' }}>
          <Skeleton height={180} />
          <Skeleton height={180} />
        </div>
      ) : counts.total === 0 ? (
        <Card style={{ margin: 0 }}>
          <EmptyState
            illustration="noVault"
            title="Snap it, crop it, revise it"
            description="Keep photographed physics derivations, tricky organic traps, and unsolved NCERT questions organized by chapter."
            action={
              <div style={{ display: 'grid', gap: '10px', justifyItems: 'center' }}>
                <ul
                  style={{
                    margin: '0 0 6px',
                    padding: 0,
                    listStyle: 'none',
                    display: 'grid',
                    gap: '4px',
                    fontSize: '13px',
                    color: 'var(--tx-2)',
                    textAlign: 'left',
                  }}
                >
                  <li>• Answers &amp; solutions stay hidden until you tap to reveal</li>
                  <li>• High-contrast B&amp;W scan mode keeps photos under 150 KB</li>
                  <li>• Stored offline on this device inside IndexedDB</li>
                </ul>
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() => {
                    setEditingItem(null);
                    setCaptureSeed(null);
                    setCaptureOpen(true);
                  }}
                >
                  <Camera size={17} strokeWidth={1.75} aria-hidden="true" />
                  Add your first question
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  disabled={archiveBusy !== null}
                  onClick={() => {
                    setArchiveError(null);
                    importInputRef.current?.click();
                  }}
                >
                  <Upload size={16} strokeWidth={1.75} aria-hidden="true" />
                  {archiveBusy === 'import' ? 'Importing Vault…' : 'Import Vault backup'}
                </Button>
              </div>
            }
          />
        </Card>
      ) : filteredItems.length === 0 ? (
        <Card style={{ margin: 0 }}>
          <EmptyState
            compact
            illustration="noVault"
            title="No questions match these filters"
            description="Try clearing your search, switching status to All, or clearing subject and type filters."
            action={
              <Button variant="secondary" onClick={clearAllFilters}>
                Clear filters
              </Button>
            }
          />
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: '16px' }}>
          {/* V3 Single-chapter header card */}
          {chapterFilter !== 'all' && singleChapterStats && (
            <Card style={{ margin: 0, display: 'grid', gap: '10px' }}>
              <div className="split" style={{ gap: '8px', flexWrap: 'wrap' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
                    {selectedChapterLabel}
                  </h3>
                  <div className="tabular-nums" style={{ fontSize: '13px', color: 'var(--tx-2)' }}>
                    {singleChapterStats.activeCount} active · {singleChapterStats.masteredCount}{' '}
                    mastered
                  </div>
                </div>
              </div>
              {singleChapterStats.activeCount > 0 && (
                <Button
                  variant="primary"
                  size="lg"
                  fullWidth
                  onClick={() =>
                    launchRevisionForItems(singleChapterStats.allInChapter, selectedChapterLabel)
                  }
                >
                  <Play size={16} strokeWidth={1.75} aria-hidden="true" />
                  Start revision ({singleChapterStats.activeCount})
                </Button>
              )}
            </Card>
          )}

          {/* V3 Grouped by Chapter */}
          {groupedByChapter.map((group) => (
            <section key={group.key} style={{ display: 'grid', gap: '10px' }}>
              {chapterFilter === 'all' && (
                <div className="dh-vault-group-head">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                    <span
                      aria-hidden="true"
                      style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '99px',
                        background: group.subjectColor,
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        fontSize: '14px',
                        fontWeight: 600,
                        color: 'var(--tx)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {group.chapterName}
                    </span>
                    <span className="tabular-nums" style={{ fontSize: '13px', color: 'var(--tx-2)' }}>
                      · {group.activeCount} active
                    </span>
                  </div>

                  {group.activeCount > 0 && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        launchRevisionForItems(
                          items.filter(
                            (i) =>
                              !i.deletedAt &&
                              i.subjectId === group.subjectId &&
                              (group.chapterId ? i.chapterId === group.chapterId : !i.chapterId)
                          ),
                          group.chapterName
                        )
                      }
                    >
                      <Play size={14} strokeWidth={1.75} aria-hidden="true" />
                      Start revision
                    </Button>
                  )}
                </div>
              )}

              {density === 'comfortable' ? (
                <div className="dh-vault-grid">
                  {group.items.map((item) => {
                    const sub = resolveVaultSubjectLabel(state.subjects, item.subjectId);
                    const chName = item.chapterId
                      ? resolveVaultChapterName(state.chapters, item.chapterId)
                      : undefined;
                    return (
                      <VaultQuestionCard
                        key={item.id}
                        item={item}
                        subject={sub}
                        chapterName={chName}
                        onToggleMastered={(it) => void handleToggleMastered(it)}
                        onEdit={(it) => {
                          setEditingItem(it);
                          setCaptureSeed(null);
                          setCaptureOpen(true);
                        }}
                        onRequestDelete={(it) => setDeleteTarget(it)}
                        onZoom={(src, it) =>
                          setZoomState({
                            src,
                            alt: chName ? `${chName} question` : 'Vault question',
                            caption: chName || sub.name,
                          })
                        }
                        onQuickView={(it) =>
                          setQuickViewState({ open: true, initialItemId: it.id })
                        }
                      />
                    );
                  })}
                </div>
              ) : (
                <div style={{ display: 'grid', gap: '8px' }}>
                  {group.items.map((item) => {
                    const sub = resolveVaultSubjectLabel(state.subjects, item.subjectId);
                    const chName = item.chapterId
                      ? resolveVaultChapterName(state.chapters, item.chapterId)
                      : `${sub.name} · General`;
                    return (
                      <div key={item.id} className="dh-vault-compact-row">
                        <button
                          type="button"
                          onClick={() => setCompactDetailItem(item)}
                          style={{
                            flex: 1,
                            minWidth: 0,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            textAlign: 'left',
                            background: 'transparent',
                            border: 'none',
                            padding: 0,
                            color: 'inherit',
                            cursor: 'pointer',
                          }}
                        >
                          <LazyVaultBlobImage
                            itemId={item.id}
                            slot="q"
                            alt={chName}
                            className="dh-vault-compact-thumb thumb"
                          />
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                              <span
                                style={{
                                  fontSize: '14px',
                                  fontWeight: 600,
                                  color: 'var(--tx)',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {chName}
                              </span>
                              <span
                                style={{
                                  padding: '1px 7px',
                                  borderRadius: '6px',
                                  fontSize: '13px',
                                  fontWeight: 600,
                                  background:
                                    item.kind === 'hard'
                                      ? 'color-mix(in srgb, var(--warn) 14%, transparent)'
                                      : 'var(--sf-2)',
                                  color:
                                    item.kind === 'hard' ? 'var(--warn-ink)' : 'var(--tx-2)',
                                }}
                              >
                                {item.kind === 'hard' ? 'Hard / Trap' : 'Unsolved'}
                              </span>
                            </div>
                            <div
                              className="tabular-nums"
                              style={{
                                fontSize: '13px',
                                color: 'var(--tx-2)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                marginTop: '2px',
                              }}
                            >
                              {item.note || `${sub.emoji} ${sub.name}`} ·{' '}
                              {formatRelativeVaultDate(item.createdAt)}
                            </div>
                          </div>
                        </button>

                        <Button
                          variant={item.mastered ? 'secondary' : 'ghost'}
                          size="sm"
                          aria-label={item.mastered ? 'Move back to active' : 'Mark mastered'}
                          onClick={() => void handleToggleMastered(item)}
                        >
                          {item.mastered ? (
                            <RotateCcw size={15} strokeWidth={1.75} />
                          ) : (
                            <Check size={16} strokeWidth={1.75} />
                          )}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          ))}

          {/* Pagination */}
          {filteredItems.length > visibleLimit && (
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '4px' }}>
              <Button
                variant="secondary"
                size="lg"
                onClick={() => setVisibleLimit((n) => n + PAGE_SIZE)}
              >
                Show more ({filteredItems.length - visibleLimit} remaining)
              </Button>
            </div>
          )}
        </div>
      )}

      {/* V12 Collapsed Older Notes (Legacy Mistakes & Doubts) */}
      {hasLegacyNotes && (
        <Card style={{ margin: 0, padding: '12px 16px' }}>
          <button
            type="button"
            aria-expanded={legacyExpanded}
            onClick={() => setLegacyExpanded((v) => !v)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              background: 'transparent',
              border: 'none',
              padding: '6px 0',
              color: 'var(--tx-2)',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <span className="tabular-nums">
              Older notes · {legacyMistakes.length} mistake
              {legacyMistakes.length === 1 ? '' : 's'}, {legacyDoubts.length} doubt
              {legacyDoubts.length === 1 ? '' : 's'}
            </span>
            {legacyExpanded ? (
              <ChevronDown size={18} strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <ChevronRight size={18} strokeWidth={1.75} aria-hidden="true" />
            )}
          </button>

          {legacyExpanded && (
            <div style={{ display: 'grid', gap: '12px', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--line)' }}>
              {legacyMistakes.map((m) => {
                const sub = getSubject(state, m.subjectId);
                const ch = m.chapterId
                  ? state.chapters.find((c) => c.id === m.chapterId)
                  : undefined;
                return (
                  <div
                    key={m.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '10px',
                      padding: '10px 12px',
                      borderRadius: '12px',
                      background: 'var(--sf-2)',
                      border: '1px solid var(--line)',
                      opacity: m.resolved ? 0.65 : 1,
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--tx)' }}>
                        {sub.e} {sub.name}
                        {ch ? ` · ${ch.name}` : ''} · {m.reason} ({m.dayKey})
                      </div>
                      {m.note && (
                        <div
                          style={{
                            fontSize: '13px',
                            color: 'var(--tx-2)',
                            marginTop: '2px',
                            textDecoration: m.resolved ? 'line-through' : undefined,
                          }}
                        >
                          {m.note}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => onToggleMistakeResolved(m.id)}
                      >
                        {m.resolved ? 'Reopen' : 'Resolve'}
                      </Button>
                      <IconButton
                        label="Delete older mistake"
                        onClick={() => onDeleteMistake(m.id)}
                      >
                        <Trash2 size={15} strokeWidth={1.75} />
                      </IconButton>
                    </div>
                  </div>
                );
              })}

              {legacyDoubts.map((d) => {
                const sub = getSubject(state, d.subjectId);
                const ch = d.chapterId
                  ? state.chapters.find((c) => c.id === d.chapterId)
                  : undefined;
                return (
                  <div
                    key={d.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '10px',
                      padding: '10px 12px',
                      borderRadius: '12px',
                      background: 'var(--sf-2)',
                      border: '1px solid var(--line)',
                      opacity: d.resolved ? 0.65 : 1,
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--tx)' }}>
                        {sub.e} {sub.name}
                        {ch ? ` · ${ch.name}` : ''}
                      </div>
                      <div
                        style={{
                          fontSize: '13px',
                          color: 'var(--tx-2)',
                          marginTop: '2px',
                          textDecoration: d.resolved ? 'line-through' : undefined,
                        }}
                      >
                        {d.text}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => onToggleDoubtResolved(d.id)}
                      >
                        {d.resolved ? 'Reopen' : 'Resolve'}
                      </Button>
                      <IconButton
                        label="Delete older doubt"
                        onClick={() => onDeleteDoubt(d.id)}
                      >
                        <Trash2 size={15} strokeWidth={1.75} />
                      </IconButton>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* Chapter Picker Sheet */}
      <Sheet
        open={chapterPickerOpen}
        onClose={() => setChapterPickerOpen(false)}
        title="Filter by chapter"
        subtitle={
          subjectFilter !== 'all'
            ? resolveVaultSubjectLabel(state.subjects, subjectFilter).name
            : undefined
        }
      >
        <div style={{ display: 'grid', gap: '8px' }}>
          <Button
            variant={chapterFilter === 'all' ? 'primary' : 'secondary'}
            size="md"
            fullWidth
            onClick={() => {
              setChapterFilter('all');
              setChapterPickerOpen(false);
              setVisibleLimit(PAGE_SIZE);
            }}
          >
            All chapters
          </Button>
          {unassignedCountForSelectedSubject > 0 && (
            <Button
              variant={chapterFilter === '__unassigned__' ? 'primary' : 'secondary'}
              size="md"
              fullWidth
              onClick={() => {
                setChapterFilter('__unassigned__');
                setChapterPickerOpen(false);
                setVisibleLimit(PAGE_SIZE);
              }}
            >
              Unassigned ({unassignedCountForSelectedSubject})
            </Button>
          )}
          {selectedChapterList.map(({ chapter, count }) => (
            <Button
              key={chapter.id}
              variant={chapterFilter === chapter.id ? 'primary' : 'secondary'}
              size="md"
              fullWidth
              onClick={() => {
                setChapterFilter(chapter.id);
                setChapterPickerOpen(false);
                setVisibleLimit(PAGE_SIZE);
              }}
            >
              <span style={{ flex: 1, textAlign: 'left' }}>{chapter.name}</span>
              <span className="tabular-nums">{count}</span>
            </Button>
          ))}
        </div>
      </Sheet>

      {/* Filters & Density Sheet */}
      <Sheet
        open={filtersSheetOpen}
        onClose={() => setFiltersSheetOpen(false)}
        title="Filters & layout"
      >
        <div style={{ display: 'grid', gap: '16px' }}>
          <Field label="Question type">
            <Segmented<'all' | VaultKind>
              ariaLabel="Filter by question type"
              value={kindFilter}
              onChange={(v) => {
                setKindFilter(v);
                setVisibleLimit(PAGE_SIZE);
              }}
              options={[
                { value: 'all', label: 'All' },
                { value: 'unsolved', label: `Unsolved (${counts.unsolved})` },
                { value: 'hard', label: `Hard / Trap (${counts.hard})` },
              ]}
            />
          </Field>

          <Field label="View density">
            <Segmented<VaultDensity>
              ariaLabel="Vault card density"
              value={density}
              onChange={setDensity}
              options={[
                { value: 'comfortable', label: 'Comfortable' },
                { value: 'compact', label: 'Compact' },
              ]}
            />
          </Field>

          <div style={{ display: 'flex', gap: '8px' }}>
            <Button
              variant="secondary"
              style={{ flex: 1 }}
              onClick={() => {
                setKindFilter('all');
                setDensity('comfortable');
              }}
            >
              Reset
            </Button>
            <Button
              variant="primary"
              style={{ flex: 2 }}
              onClick={() => setFiltersSheetOpen(false)}
            >
              Done
            </Button>
          </div>
        </div>
      </Sheet>

      {/* Compact Row Detail Sheet */}
      <Sheet
        open={Boolean(compactDetailItem)}
        onClose={() => setCompactDetailItem(null)}
        title={
          compactDetailItem?.chapterId
            ? resolveVaultChapterName(state.chapters, compactDetailItem.chapterId)
            : 'Vault question'
        }
      >
        {compactDetailItem && (
          <VaultQuestionCard
            item={compactDetailItem}
            subject={resolveVaultSubjectLabel(state.subjects, compactDetailItem.subjectId)}
            chapterName={
              compactDetailItem.chapterId
                ? resolveVaultChapterName(state.chapters, compactDetailItem.chapterId)
                : undefined
            }
            onToggleMastered={(it) => {
              void handleToggleMastered(it);
              setCompactDetailItem(null);
            }}
            onEdit={(it) => {
              setCompactDetailItem(null);
              setEditingItem(it);
              setCaptureSeed(null);
              setCaptureOpen(true);
            }}
            onRequestDelete={(it) => {
              setCompactDetailItem(null);
              setDeleteTarget(it);
            }}
            onZoom={(src, it) =>
              setZoomState({
                src,
                alt: 'Vault question',
                caption: it.chapterId
                  ? resolveVaultChapterName(state.chapters, it.chapterId)
                  : undefined,
              })
            }
            onQuickView={(it) => {
              setCompactDetailItem(null);
              setQuickViewState({ open: true, initialItemId: it.id });
            }}
          />
        )}
      </Sheet>

      {/* Add / Edit Capture Sheet */}
      <VaultCaptureSheet
        open={captureOpen}
        subjects={state.subjects}
        chapters={state.chapters}
        editingItem={editingItem}
        initialSubjectId={captureSeed?.subjectId}
        initialChapterId={captureSeed?.chapterId}
        initialKind={captureSeed?.kind}
        onClose={() => {
          setCaptureOpen(false);
          setEditingItem(null);
          setCaptureSeed(null);
        }}
        onSaved={(_saved, addAnother) => {
          void loadItems();
          onNotify(
            editingItem
              ? 'Question updated'
              : addAnother
                ? 'Saved to Vault — add next'
                : 'Saved to Vault'
          );
        }}
      />

      {/* Vault Quick-View Overlay */}
      <VaultQuickView
        open={quickViewState.open}
        items={quickViewItems}
        initialItemId={quickViewState.initialItemId}
        subjects={state.subjects}
        chapters={state.chapters}
        onClose={() => setQuickViewState({ open: false, initialItemId: null })}
        onToggleMastered={(it) => void handleToggleMastered(it)}
      />

      {/* Full-Screen Zoom Viewer */}
      <VaultZoomViewer
        open={Boolean(zoomState)}
        src={zoomState?.src || null}
        alt={zoomState?.alt || 'Vault image'}
        caption={zoomState?.caption}
        onClose={() => setZoomState(null)}
      />

      {/* Lazy Full-Screen Revision Deck */}
      {deckScope.open && (
        <Suspense fallback={null}>
          <VaultRevisionDeck
            open={deckScope.open}
            items={deckScope.items}
            subjects={state.subjects}
            chapters={state.chapters}
            deckLabel={deckScope.label}
            activeTimerText={activeTimerText}
            onClose={() => setDeckScope((d) => ({ ...d, open: false }))}
            onRecordRevised={handleRecordRevisedInDeck}
            onMarkMastered={handleMarkMasteredInDeck}
            onEditItem={(it) => {
              setDeckScope((d) => ({ ...d, open: false }));
              setEditingItem(it);
              setCaptureSeed(null);
              setCaptureOpen(true);
            }}
          />
        </Suspense>
      )}

      {/* V7 Exact Delete Confirmation Dialog */}
      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        title="Delete this question?"
      >
        <p style={{ margin: 0, fontSize: '14px', color: 'var(--tx-2)', lineHeight: 1.5 }}>
          The photo, answer, and solution will be permanently removed from this device.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
          <Button
            variant="secondary"
            disabled={deleting}
            onClick={() => setDeleteTarget(null)}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={deleting}
            onClick={() => void handleConfirmDelete()}
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </Dialog>

      {/* Local Vault Backup & Restore Sheet */}
      <Sheet
        open={backupSheetOpen}
        onClose={() => {
          if (!archiveBusy) {
            setBackupSheetOpen(false);
          }
        }}
        title="Vault backup & restore"
        subtitle={`Self-contained ${VAULT_ARCHIVE_EXTENSION} archive stored offline on this device`}
      >
        <div style={{ display: 'grid', gap: '14px' }}>
          <div
            style={{
              background: 'var(--sf-2)',
              border: '1px solid var(--line)',
              borderRadius: '12px',
              padding: '14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
            }}
          >
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--tx)' }}>
                Local Vault storage
              </div>
              <div className="tabular-nums" style={{ fontSize: '13px', color: 'var(--tx-2)', marginTop: '2px' }}>
                {counts.total === 0
                  ? 'No saved questions on this device yet'
                  : `${counts.total} question${counts.total === 1 ? '' : 's'} · ${formattedVaultSize} photos`}
              </div>
            </div>
          </div>

          {archiveError && (
            <div
              role="alert"
              style={{
                background: 'color-mix(in srgb, var(--err) 12%, transparent)',
                border: '1px solid color-mix(in srgb, var(--err) 40%, transparent)',
                borderRadius: '12px',
                padding: '12px 14px',
                fontSize: '13px',
                color: 'var(--err)',
                lineHeight: 1.45,
              }}
            >
              {archiveError}
            </div>
          )}

          <div style={{ display: 'grid', gap: '10px' }}>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              disabled={archiveBusy !== null || counts.total === 0}
              onClick={() => void handleExportVault()}
            >
              <Download size={17} strokeWidth={1.75} aria-hidden="true" />
              {archiveBusy === 'export'
                ? 'Preparing Vault archive…'
                : `Export Vault (${counts.total})`}
            </Button>
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              disabled={archiveBusy !== null}
              onClick={() => {
                setArchiveError(null);
                importInputRef.current?.click();
              }}
            >
              <Upload size={17} strokeWidth={1.75} aria-hidden="true" />
              {archiveBusy === 'import' ? 'Importing Vault archive…' : 'Import Vault backup'}
            </Button>
          </div>

          <p style={{ margin: 0, fontSize: '13px', color: 'var(--tx-3)', lineHeight: 1.5 }}>
            Exports include question photos, solutions, answers, and mastery progress. Imports
            safely merge new or updated questions by ID without deleting existing Vault items.
          </p>
        </div>
      </Sheet>
    </div>
  );
};
