import React, { Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Archive,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit3,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  Images,
  Maximize2,
  MoreHorizontal,
  Play,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { Chapter, PulseHabitState, Subject } from '../types';
import { getSubject } from '../utils/studyLogic';
import { triggerHaptic } from '../utils/haptics';
import { safeLocalStorageSet } from '../utils/security';
import {
  MAX_VAULT_ARCHIVE_BYTES,
  buildVaultArchiveFilename,
  formatVaultImportSummary,
  VAULT_ARCHIVE_EXTENSION,
} from '../utils/vaultArchive';
import {
  INITIAL_REVEAL_STATE,
  buildVaultSubjectFolders,
  computeVaultCounts,
  filterAndSortChapterQuestions,
  filterVaultItems,
  formatRelativeVaultDate,
  resolveVaultChapterName,
  resolveVaultSubjectLabel,
  revealReducer,
  type VaultChapterFolder,
  type VaultChapterSortOrder,
  type VaultChapterStatusFilter,
  type VaultChapterTagFilter,
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
import { BottomSheet } from './BottomSheet';
import { VaultCaptureSheet } from './VaultCaptureSheet';
import { VaultZoomViewer } from './VaultZoomViewer';
import {
  VaultAnswerCurtainStage,
  VaultCurtainToolbar,
  useVaultCurtain,
} from './VaultAnswerCurtain';
import {
  Button,
  Chip,
  Dialog,
  IconButton,
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
  const urlRef = useRef<string | null>(null);
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
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
      setUrl(null);
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
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
      }
      urlRef.current = nextUrl;
      setUrl(nextUrl);
    })();
    return () => {
      cancelled = true;
    };
  }, [inView, itemId, slot]);

  useEffect(() => {
    return () => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
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
  onMenuOpenChange?: (open: boolean) => void;
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
  onMenuOpenChange,
}) => {
  const [reveal, dispatchReveal] = useReducer(revealReducer, INITIAL_REVEAL_STATE);
  const [menuOpen, setMenuOpen] = useState(false);

  const setCardMenuOpen = useCallback(
    (next: boolean) => {
      setMenuOpen((prev) => {
        if (prev !== next) {
          onMenuOpenChange?.(next);
        }
        return next;
      });
    },
    [onMenuOpenChange]
  );

  useEffect(() => {
    return () => {
      if (menuOpen) onMenuOpenChange?.(false);
    };
  }, [menuOpen, onMenuOpenChange]);

  return (
    <>
      <article className="dh-vault-card">
        {/* Card Meta Strip */}
        <div className="dh-vault-card-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', minWidth: 0 }}>
            <span
              aria-hidden="true"
              className="dh-sub-dot"
              style={{ background: subject.color }}
            />
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--tx)' }}>
              {subject.name}
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
            <IconButton label="Question actions" onClick={() => setCardMenuOpen(true)}>
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
            variant="secondary"
            size="sm"
            className={reveal.answerOpen ? 'dh-glass-accent-btn' : 'dh-glass-btn'}
            onClick={() => {
              triggerHaptic('tap');
              dispatchReveal({ type: 'toggle_answer' });
            }}
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
            variant="secondary"
            size="sm"
            className={reveal.solutionOpen ? 'dh-glass-accent-btn' : 'dh-glass-btn'}
            onClick={() => {
              triggerHaptic('tap');
              dispatchReveal({ type: 'toggle_solution' });
            }}
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
            onClick={() => {
              triggerHaptic('success');
              onToggleMastered(item);
            }}
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

      <BottomSheet
        open={menuOpen}
        onClose={() => setCardMenuOpen(false)}
        title={chapterName || subject.name}
        subtitle={item.kind === 'hard' ? 'Hard / Trap question' : 'Unsolved question'}
      >
        <div style={{ display: 'grid', gap: '8px' }}>
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            className="dh-glass-btn"
            onClick={() => {
              triggerHaptic('tap');
              setCardMenuOpen(false);
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
            className="dh-glass-btn"
            onClick={() => {
              triggerHaptic('tap');
              setCardMenuOpen(false);
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
            className="dh-glass-btn"
            onClick={() => {
              triggerHaptic('success');
              setCardMenuOpen(false);
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
              triggerHaptic('stop');
              setCardMenuOpen(false);
              onRequestDelete(item);
            }}
          >
            <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
            Delete question
          </Button>
        </div>
      </BottomSheet>
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
  const [zoomSrc, setZoomSrc] = useState<{
    src: string;
    alt: string;
    caption?: string;
    itemId?: string;
  } | null>(null);
  const urlCacheRef = useRef<Map<string, string>>(new Map());
  const openRef = useRef<boolean>(open);
  openRef.current = open;
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const thumbStripRef = useRef<HTMLDivElement | null>(null);

  // Always revoke cached Blob URLs on unmount (even if unmounted while open)
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
  const curtain = useVaultCurtain(open ? currentItem?.id : null);

  const ensureBlobUrl = useCallback(async (itemId: string, slot: 'q' | 's') => {
    const key = `${itemId}:${slot}`;
    const cached = urlCacheRef.current.get(key);
    if (cached) return cached;
    const blob = await getVaultBlob(itemId, slot);
    if (!blob || !openRef.current) return null;
    const existingAfterAwait = urlCacheRef.current.get(key);
    if (existingAfterAwait) return existingAfterAwait;
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
                  itemId: currentItem.id,
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
          className="dh-sub-dot"
          style={{ background: subject.color }}
        />
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--tx)' }}>
          {subject.name}
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

      {/* Answer Curtain Quick Controls */}
      <div className="dh-vault-quickview-curtain-bar">
        <VaultCurtainToolbar curtain={curtain} />
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
          <VaultAnswerCurtainStage curtain={curtain}>
            <img
              src={qUrl}
              alt={chapterName ? `${chapterName} question` : 'Vault study photo'}
              className="dh-vault-quickview-img"
              onClick={() =>
                setZoomSrc({
                  src: qUrl,
                  alt: chapterName ? `${chapterName} study photo` : 'Vault study photo',
                  caption: chapterName || subject.name,
                  itemId: currentItem.id,
                })
              }
            />
          </VaultAnswerCurtainStage>
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
          className="dh-glass-btn"
          disabled={index === 0}
          aria-label="Previous study photo"
          onClick={() => {
            triggerHaptic('tap');
            stepTo(index - 1);
          }}
        >
          <ChevronLeft size={18} strokeWidth={1.75} aria-hidden="true" />
          Prev
        </Button>

        <Button
          variant="secondary"
          size="md"
          className={reveal.answerOpen ? 'dh-glass-accent-btn' : 'dh-glass-btn'}
          style={{ flex: 1, minHeight: '48px' }}
          onClick={() => {
            triggerHaptic('tap');
            dispatchReveal({ type: 'toggle_answer' });
          }}
        >
          {reveal.answerOpen ? (
            <EyeOff size={15} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <Eye size={15} strokeWidth={1.75} aria-hidden="true" />
          )}
          Answer
        </Button>

        <Button
          variant="secondary"
          size="md"
          className={reveal.solutionOpen ? 'dh-glass-accent-btn' : 'dh-glass-btn'}
          style={{ flex: 1, minHeight: '48px' }}
          onClick={() => {
            triggerHaptic('tap');
            dispatchReveal({ type: 'toggle_solution' });
          }}
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
          onClick={() => {
            triggerHaptic('tap');
            stepTo(index + 1);
          }}
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
        itemId={zoomSrc?.itemId}
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
  const [selectedFolder, setSelectedFolder] = useState<{
    subjectId: string;
    chapterId?: string;
    isUncategorized: boolean;
  } | null>(null);
  const [emptyChaptersExpanded, setEmptyChaptersExpanded] = useState<boolean>(false);

  // Per-chapter Question Deck filters & sorting
  const [chapterStatusFilter, setChapterStatusFilter] =
    useState<VaultChapterStatusFilter>('active');
  const [chapterTagFilter, setChapterTagFilter] = useState<VaultChapterTagFilter>('all');
  const [chapterSort, setChapterSort] = useState<VaultChapterSortOrder>('newest');

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

  // Modals / Sheets
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
  const [zoomState, setZoomState] = useState<{
    src: string;
    alt: string;
    caption?: string;
    itemId?: string;
  } | null>(null);

  // Vault Quick-View overlay
  const [quickViewConfig, setQuickViewConfig] = useState<{
    open: boolean;
    scope: 'subject' | 'search' | 'folder';
    folderSubjectId?: string;
    folderChapterId?: string;
    initialItemId: string | null;
  }>({ open: false, scope: 'subject', initialItemId: null });

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
  const [openCardMenus, setOpenCardMenus] = useState<number>(0);
  const [archiveBusy, setArchiveBusy] = useState<'export' | 'import' | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const handleCardMenuOpenChange = useCallback((isOpen: boolean) => {
    setOpenCardMenus((count) => Math.max(0, count + (isOpen ? 1 : -1)));
  }, []);

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
      const subId = initialChapterFilter.subjectId || 'all';
      setSubjectFilter(subId);
      if (initialChapterFilter.chapterId && initialChapterFilter.chapterId !== 'all') {
        const isUncat = initialChapterFilter.chapterId === '__unassigned__';
        setSelectedFolder({
          subjectId: subId === 'all' ? activeSubjects[0]?.id || 'sub_phy' : subId,
          chapterId: isUncat ? undefined : initialChapterFilter.chapterId,
          isUncategorized: isUncat,
        });
        setChapterStatusFilter('all');
        setChapterTagFilter('all');
      } else {
        setSelectedFolder(null);
      }
      setSearchQuery('');
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
    safeLocalStorageSet(DENSITY_STORAGE_KEY, density);
  }, [density]);

  const counts = useMemo(() => computeVaultCounts(items), [items]);
  const activeSubjects = useMemo(
    () => state.subjects.filter((s) => !s.arch),
    [state.subjects]
  );

  const subjectScopedItems = useMemo(
    () =>
      items
        .filter((i) => !i.deletedAt && (subjectFilter === 'all' || i.subjectId === subjectFilter))
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt),
    [items, subjectFilter]
  );

  const subjectActiveItems = useMemo(
    () => subjectScopedItems.filter((i) => !i.mastered),
    [subjectScopedItems]
  );

  const subjectMasteredCount = subjectScopedItems.length - subjectActiveItems.length;

  const isGlobalSearchActive = !selectedFolder && searchQuery.trim().length > 0;

  // Global search override across the selected subject
  const searchMatchingItems = useMemo(() => {
    if (!isGlobalSearchActive) return [];
    return filterVaultItems(items, {
      subjectId: subjectFilter,
      chapterId: 'all',
      status: 'all',
      kind: 'all',
      query: searchQuery,
      subjects: state.subjects,
      chapters: state.chapters,
    });
  }, [
    isGlobalSearchActive,
    items,
    searchQuery,
    state.chapters,
    state.subjects,
    subjectFilter,
  ]);

  const subjectFolders = useMemo(
    () => buildVaultSubjectFolders(items, state.subjects, state.chapters, subjectFilter),
    [items, state.chapters, state.subjects, subjectFilter]
  );

  // Selected Chapter Drill-Down computed data
  const folderAllItems = useMemo(() => {
    if (!selectedFolder) return [];
    return items
      .filter((i) => {
        if (i.deletedAt || i.subjectId !== selectedFolder.subjectId) return false;
        if (selectedFolder.chapterId) return i.chapterId === selectedFolder.chapterId;
        return !i.chapterId;
      })
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [items, selectedFolder]);

  const folderCounts = useMemo(() => {
    let active = 0;
    let mastered = 0;
    let hard = 0;
    for (const it of folderAllItems) {
      if (it.mastered) mastered += 1;
      else active += 1;
      if (it.kind === 'hard') hard += 1;
    }
    return { total: folderAllItems.length, active, mastered, hard };
  }, [folderAllItems]);

  const chapterDeckItems = useMemo(() => {
    if (!selectedFolder) return [];
    return filterAndSortChapterQuestions(items, {
      subjectId: selectedFolder.subjectId,
      chapterId: selectedFolder.chapterId,
      status: chapterStatusFilter,
      tag: chapterTagFilter,
      sort: chapterSort,
      subjects: state.subjects,
      chapters: state.chapters,
    });
  }, [
    chapterSort,
    chapterStatusFilter,
    chapterTagFilter,
    items,
    selectedFolder,
    state.chapters,
    state.subjects,
  ]);

  const visibleListItems = useMemo(() => {
    if (selectedFolder) return chapterDeckItems.slice(0, visibleLimit);
    if (isGlobalSearchActive) return searchMatchingItems.slice(0, visibleLimit);
    return [];
  }, [chapterDeckItems, isGlobalSearchActive, searchMatchingItems, selectedFolder, visibleLimit]);

  const quickViewItems = useMemo(() => {
    if (quickViewConfig.scope === 'folder' && quickViewConfig.folderSubjectId) {
      return items
        .filter((i) => {
          if (i.deletedAt || i.subjectId !== quickViewConfig.folderSubjectId) return false;
          if (quickViewConfig.folderChapterId) {
            return i.chapterId === quickViewConfig.folderChapterId;
          }
          return !i.chapterId;
        })
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt);
    }
    if (quickViewConfig.scope === 'search' && searchQuery.trim().length > 0) {
      return searchMatchingItems;
    }
    return subjectScopedItems;
  }, [
    items,
    quickViewConfig.folderChapterId,
    quickViewConfig.folderSubjectId,
    quickViewConfig.scope,
    searchMatchingItems,
    searchQuery,
    subjectScopedItems,
  ]);

  const openChapterFolder = useCallback((folder: VaultChapterFolder) => {
    setSelectedFolder({
      subjectId: folder.subjectId,
      chapterId: folder.chapterId,
      isUncategorized: folder.isUncategorized,
    });
    setChapterStatusFilter(folder.activeCount > 0 ? 'active' : 'all');
    setChapterTagFilter('all');
    setChapterSort('newest');
    setVisibleLimit(PAGE_SIZE);
  }, []);

  const clearChapterFilters = () => {
    setChapterStatusFilter('all');
    setChapterTagFilter('all');
    setChapterSort('newest');
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
        if (file.size > MAX_VAULT_ARCHIVE_BYTES) {
          throw new Error('Vault archive is too large to import safely (60 MB limit).');
        }
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

  const activeSubjectLabel =
    subjectFilter === 'all'
      ? 'Vault'
      : resolveVaultSubjectLabel(state.subjects, subjectFilter).name;

  const selectedFolderSubject = selectedFolder
    ? resolveVaultSubjectLabel(state.subjects, selectedFolder.subjectId)
    : null;

  const selectedFolderTitle = selectedFolder
    ? selectedFolder.isUncategorized
      ? 'General / Uncategorized'
      : resolveVaultChapterName(state.chapters, selectedFolder.chapterId)
    : '';

  const renderQuestionList = (list: readonly VaultItem[]) =>
    density === 'comfortable' ? (
      <div className="dh-vault-grid">
        {list.map((item) => {
          const sub = resolveVaultSubjectLabel(state.subjects, item.subjectId);
          const chName = item.chapterId
            ? resolveVaultChapterName(state.chapters, item.chapterId)
            : 'General / Uncategorized';
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
                  itemId: it.id,
                })
              }
              onQuickView={(it) =>
                setQuickViewConfig({
                  open: true,
                  scope: selectedFolder
                    ? 'folder'
                    : isGlobalSearchActive
                      ? 'search'
                      : 'subject',
                  folderSubjectId: selectedFolder?.subjectId,
                  folderChapterId: selectedFolder?.chapterId,
                  initialItemId: it.id,
                })
              }
              onMenuOpenChange={handleCardMenuOpenChange}
            />
          );
        })}
      </div>
    ) : (
      <div style={{ display: 'grid', gap: '8px' }}>
        {list.map((item) => {
          const sub = resolveVaultSubjectLabel(state.subjects, item.subjectId);
          const chName = item.chapterId
            ? resolveVaultChapterName(state.chapters, item.chapterId)
            : 'General / Uncategorized';
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
                        color: item.kind === 'hard' ? 'var(--warn-ink)' : 'var(--tx-2)',
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
                    {item.note || sub.name} ·{' '}
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
    );

  const renderChapterFolderCard = (folder: VaultChapterFolder, emptyMode = false) => {
    const masteredPct =
      folder.totalCount > 0 ? Math.round((folder.masteredCount / folder.totalCount) * 100) : 0;

    return (
      <div key={folder.key} className="dh-vault-folder-card">
        <button
          type="button"
          className="dh-vault-folder-main"
          onClick={() => openChapterFolder(folder)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            {emptyMode ? (
              <Folder size={17} strokeWidth={1.75} aria-hidden="true" style={{ color: 'var(--tx-3)', flexShrink: 0 }} />
            ) : (
              <FolderOpen size={17} strokeWidth={1.75} aria-hidden="true" style={{ color: folder.subjectColor, flexShrink: 0 }} />
            )}
            <span
              style={{
                fontSize: '15px',
                fontWeight: 600,
                color: emptyMode ? 'var(--tx-2)' : 'var(--tx)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {folder.chapterName}
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flexWrap: 'wrap',
              fontSize: '13px',
              color: 'var(--tx-2)',
            }}
          >
            {(subjectFilter === 'all' || folder.isUncategorized) && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: '7px',
                    height: '7px',
                    borderRadius: '99px',
                    background: folder.subjectColor,
                  }}
                />
                <span>{folder.subjectName}</span>
                <span>·</span>
              </span>
            )}
            <span className="tabular-nums">
              {emptyMode
                ? '0 questions'
                : `${folder.activeCount} active · ${folder.masteredCount} mastered`}
            </span>
            {folder.hardCount > 0 && (
              <span
                className="tabular-nums"
                style={{
                  padding: '1px 7px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  background: 'color-mix(in srgb, var(--warn) 14%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--warn) 35%, transparent)',
                  color: 'var(--warn-ink)',
                }}
              >
                {folder.hardCount} Hard / Trap
              </span>
            )}
          </div>

          {!emptyMode && (
            <div className="dh-vault-folder-progress" aria-hidden="true">
              <div
                className="dh-vault-folder-progress-fill"
                style={{ width: `${masteredPct}%` }}
              />
            </div>
          )}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
          {!emptyMode && folder.totalCount > 0 && (
            <IconButton
              size={44}
              label={`Quick-View ${folder.chapterName}`}
              title={`Quick-View ${folder.chapterName}`}
              onClick={(e) => {
                e.stopPropagation();
                setQuickViewConfig({
                  open: true,
                  scope: 'folder',
                  folderSubjectId: folder.subjectId,
                  folderChapterId: folder.chapterId,
                  initialItemId: folder.items[0]?.id ?? null,
                });
              }}
            >
              <Images size={17} strokeWidth={1.75} />
            </IconButton>
          )}
          {!emptyMode && folder.activeCount > 0 && (
            <IconButton
              size={44}
              className="dh-glass-accent-btn"
              label={`Revise ${folder.chapterName}`}
              title={`Revise ${folder.chapterName}`}
              onClick={(e) => {
                e.stopPropagation();
                triggerHaptic('tap');
                launchRevisionForItems(folder.items, folder.chapterName);
              }}
            >
              <Play size={16} strokeWidth={1.75} />
            </IconButton>
          )}
          {emptyMode && (
            <ChevronRight size={18} strokeWidth={1.75} aria-hidden="true" style={{ color: 'var(--tx-3)' }} />
          )}
        </div>
      </div>
    );
  };

  const isAnyOverlayOpen =
    captureOpen ||
    quickViewConfig.open ||
    deckScope.open ||
    Boolean(zoomState) ||
    Boolean(compactDetailItem) ||
    Boolean(deleteTarget) ||
    backupSheetOpen ||
    openCardMenus > 0;

  const openThumbZoneCapture = useCallback(() => {
    triggerHaptic('tap');
    setEditingItem(null);
    if (selectedFolder) {
      setCaptureSeed({
        subjectId: selectedFolder.subjectId,
        chapterId: selectedFolder.chapterId,
      });
    } else {
      setCaptureSeed(subjectFilter !== 'all' ? { subjectId: subjectFilter } : null);
    }
    setCaptureOpen(true);
  }, [selectedFolder, subjectFilter]);

  return (
    <div style={{ display: 'grid', gap: '14px', paddingBottom: '88px' }}>
      <input
        ref={importInputRef}
        type="file"
        accept={`${VAULT_ARCHIVE_EXTENSION},.json,application/json`}
        hidden
        onChange={(e) => void handleImportVaultFile(e.target.files?.[0])}
      />

      {/* LEVEL 1 & 2 VIEW: Subject Tabs -> Chapter Folders (or Search Override) */}
      {!selectedFolder ? (
        <>
          {/* Borderless AMOLED Vault Header */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="dh-eyebrow">Question vault</h2>
              <p className="tnum mt-1 text-[13px] text-[var(--tx-2)]">
                {subjectScopedItems.length === 0
                  ? `${activeSubjectLabel} · 0 saved`
                  : `${subjectActiveItems.length} active · ${subjectMasteredCount} mastered`}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {subjectScopedItems.length > 0 && (
                <button
                  type="button"
                  className="dh-ghost-pill"
                  onClick={() => {
                    triggerHaptic('tap');
                    setQuickViewConfig({
                      open: true,
                      scope: isGlobalSearchActive ? 'search' : 'subject',
                      initialItemId:
                        (isGlobalSearchActive ? searchMatchingItems : subjectScopedItems)[0]
                          ?.id ?? null,
                    });
                  }}
                >
                  <Images size={14} strokeWidth={1.75} aria-hidden="true" />
                  Quick-View
                </button>
              )}
              {subjectActiveItems.length > 0 && (
                <button
                  type="button"
                  className="dh-ghost-pill"
                  onClick={() => {
                    triggerHaptic('tap');
                    launchRevisionForItems(
                      subjectActiveItems,
                      subjectFilter === 'all' ? 'Vault' : activeSubjectLabel
                    );
                  }}
                >
                  <Play size={13} strokeWidth={1.75} aria-hidden="true" />
                  Revise ({subjectActiveItems.length})
                </button>
              )}
              <IconButton
                size={38}
                label="Export or import Vault backup"
                title="Export or import Vault backup"
                onClick={() => {
                  triggerHaptic('tap');
                  setArchiveError(null);
                  setBackupSheetOpen(true);
                }}
              >
                <Archive size={16} strokeWidth={1.75} aria-hidden="true" />
              </IconButton>
            </div>
          </div>

          {/* Sticky Subject Tabs + Global Search Bar */}
          <div className="dh-vault-filterbar">
            {/* Top Horizontal Subject Tabs (synced with Prep syllabus active subjects) */}
            <div
              className="dh-vault-chips-scroll"
              role="tablist"
              aria-label="Vault subjects"
            >
              <Chip
                role="tab"
                aria-selected={subjectFilter === 'all'}
                selected={subjectFilter === 'all'}
                onClick={() => {
                  setSubjectFilter('all');
                  setVisibleLimit(PAGE_SIZE);
                }}
              >
                <span>All</span>
                <span className="tnum text-[12px] opacity-75">
                  {counts.active}
                </span>
              </Chip>

              {activeSubjects.map((sub: Subject) => {
                const activeCount = counts.bySubject[sub.id]?.active ?? 0;
                const isSelected = subjectFilter === sub.id;
                return (
                  <Chip
                    key={sub.id}
                    role="tab"
                    aria-selected={isSelected}
                    selected={isSelected}
                    colorDot={sub.color}
                    onClick={() => {
                      setSubjectFilter(sub.id);
                      setVisibleLimit(PAGE_SIZE);
                    }}
                  >
                    <span>{sub.name}</span>
                    <span className="tnum text-[12px] opacity-75">
                      {activeCount}
                    </span>
                  </Chip>
                );
              })}
            </div>

            {/* Global Search Override Bar */}
            {counts.total > 0 && (
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
                  placeholder={
                    subjectFilter === 'all'
                      ? 'Search across all chapters by tag, note, or subject…'
                      : `Search inside ${activeSubjectLabel} by tag, note, or chapter…`
                  }
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
                      {searchMatchingItems.length}
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
            )}
          </div>

          {/* Main Folder / Search Content */}
          {loading ? (
            <div style={{ display: 'grid', gap: '12px' }}>
              <Skeleton height={88} />
              <Skeleton height={88} />
            </div>
          ) : isGlobalSearchActive ? (
            /* Global Search Override: Show matching question cards directly across selected subject */
            searchMatchingItems.length === 0 ? (
              <div className="dh-empty-inline">
                <span>No matches in {activeSubjectLabel} for &ldquo;{searchQuery.trim()}&rdquo;.</span>
                <button
                  type="button"
                  className="dh-eyebrow-link"
                  onClick={() => setSearchQuery('')}
                >
                  Clear ›
                </button>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '12px' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                    flexWrap: 'wrap',
                  }}
                >
                  <span className="tabular-nums" style={{ fontSize: '13px', color: 'var(--tx-2)' }}>
                    Showing {searchMatchingItems.length} search match
                    {searchMatchingItems.length === 1 ? '' : 'es'} across {activeSubjectLabel}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => setSearchQuery('')}>
                    Clear search
                  </Button>
                </div>

                {renderQuestionList(visibleListItems)}

                {searchMatchingItems.length > visibleLimit && (
                  <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '4px' }}>
                    <Button
                      variant="secondary"
                      size="lg"
                      onClick={() => setVisibleLimit((n) => n + PAGE_SIZE)}
                    >
                      Show more ({searchMatchingItems.length - visibleLimit} remaining)
                    </Button>
                  </div>
                )}
              </div>
            )
          ) : (
            /* Chapter Folder List (Default View per Subject) */
            <div style={{ display: 'grid', gap: '16px' }}>
              {counts.total === 0 && (
                <div className="dh-empty-inline">
                  <span>No saved questions yet.</span>
                  <button
                    type="button"
                    className="dh-eyebrow-link shrink-0"
                    disabled={archiveBusy !== null}
                    onClick={() => {
                      triggerHaptic('tap');
                      setArchiveError(null);
                      importInputRef.current?.click();
                    }}
                  >
                    {archiveBusy === 'import' ? 'Importing…' : 'Import backup ›'}
                  </button>
                </div>
              )}

              {subjectFolders.populatedFolders.length > 0 ? (
                <div className="dh-vault-folder-grid">
                  {subjectFolders.populatedFolders.map((folder) =>
                    renderChapterFolderCard(folder, false)
                  )}
                </div>
              ) : (
                counts.total > 0 && (
                  <div className="dh-empty-inline">
                    <span>No saved questions in {activeSubjectLabel} yet.</span>
                    <button
                      type="button"
                      className="dh-eyebrow-link"
                      onClick={openThumbZoneCapture}
                    >
                      Add question ›
                    </button>
                  </div>
                )
              )}

              {/* Collapsible Empty Syllabus Chapters */}
              {subjectFolders.emptyFolders.length > 0 && (
                <div style={{ display: 'grid', gap: '10px' }}>
                  <button
                    type="button"
                    aria-expanded={emptyChaptersExpanded}
                    className="dh-vault-empty-toggle"
                    onClick={() => setEmptyChaptersExpanded((v) => !v)}
                  >
                    <span className="tabular-nums">
                      Empty syllabus chapters ({subjectFolders.emptyFolders.length})
                    </span>
                    {emptyChaptersExpanded ? (
                      <ChevronDown size={18} strokeWidth={1.75} aria-hidden="true" />
                    ) : (
                      <ChevronRight size={18} strokeWidth={1.75} aria-hidden="true" />
                    )}
                  </button>

                  {emptyChaptersExpanded && (
                    <div className="dh-vault-folder-grid">
                      {subjectFolders.emptyFolders.map((folder) =>
                        renderChapterFolderCard(folder, true)
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* V12 Collapsed Older Notes (Legacy Mistakes & Doubts) */}
          {hasLegacyNotes && !isGlobalSearchActive && (
            <section className="dh-amoled-section border-t border-[var(--hairline)] pt-4">
              <button
                type="button"
                aria-expanded={legacyExpanded}
                onClick={() => setLegacyExpanded((v) => !v)}
                className="flex w-full items-center justify-between gap-2 text-left text-[13px] font-semibold text-[var(--tx-2)]"
              >
                <span className="tnum">
                  Older notes · {legacyMistakes.length} mistake
                  {legacyMistakes.length === 1 ? '' : 's'}, {legacyDoubts.length} doubt
                  {legacyDoubts.length === 1 ? '' : 's'}
                </span>
                {legacyExpanded ? (
                  <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
                ) : (
                  <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
                )}
              </button>

              {legacyExpanded && (
                <div className="dh-hairline-list mt-2">
                  {legacyMistakes.map((m) => {
                    const sub = getSubject(state, m.subjectId);
                    const ch = m.chapterId
                      ? state.chapters.find((c) => c.id === m.chapterId)
                      : undefined;
                    return (
                      <div
                        key={m.id}
                        className="dh-hairline-row flex items-center justify-between gap-3"
                        style={{ opacity: m.resolved ? 0.65 : 1 }}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--tx)]">
                            <span
                              className="dh-sub-dot"
                              style={{ background: sub.color }}
                              aria-hidden="true"
                            />
                            <span>
                              {sub.name}
                              {ch ? ` · ${ch.name}` : ''} · {m.reason} ({m.dayKey})
                            </span>
                          </div>
                          {m.note && (
                            <div
                              className="mt-0.5 text-[13px] text-[var(--tx-2)]"
                              style={{ textDecoration: m.resolved ? 'line-through' : undefined }}
                            >
                              {m.note}
                            </div>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            className="dh-ghost-pill"
                            onClick={() => onToggleMistakeResolved(m.id)}
                          >
                            {m.resolved ? 'Reopen' : 'Resolve'}
                          </button>
                          <IconButton
                            size={36}
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
                        className="dh-hairline-row flex items-center justify-between gap-3"
                        style={{ opacity: d.resolved ? 0.65 : 1 }}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--tx)]">
                            <span
                              className="dh-sub-dot"
                              style={{ background: sub.color }}
                              aria-hidden="true"
                            />
                            <span>
                              {sub.name}
                              {ch ? ` · ${ch.name}` : ''}
                            </span>
                          </div>
                          <div
                            className="mt-0.5 text-[13px] text-[var(--tx-2)]"
                            style={{ textDecoration: d.resolved ? 'line-through' : undefined }}
                          >
                            {d.text}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            className="dh-ghost-pill"
                            onClick={() => onToggleDoubtResolved(d.id)}
                          >
                            {d.resolved ? 'Reopen' : 'Resolve'}
                          </button>
                          <IconButton
                            size={36}
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
            </section>
          )}
        </>
      ) : (
        /* LEVEL 3 VIEW: Dedicated Chapter Question Deck Drill-Down */
        <>
          <div className="dh-vault-deck-topbar">
            {/* Row 1: Back to Subject + Chapter Action Buttons */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                flexWrap: 'wrap',
              }}
            >
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedFolder(null);
                  setVisibleLimit(PAGE_SIZE);
                }}
                style={{ minHeight: '44px', paddingLeft: '6px', paddingRight: '10px' }}
              >
                <ChevronLeft size={17} strokeWidth={1.75} aria-hidden="true" />
                Back to {selectedFolderSubject?.name || 'Subject'}
              </Button>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                {folderAllItems.length > 0 && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="dh-glass-btn"
                    onClick={() => {
                      triggerHaptic('tap');
                      setQuickViewConfig({
                        open: true,
                        scope: 'folder',
                        folderSubjectId: selectedFolder.subjectId,
                        folderChapterId: selectedFolder.chapterId,
                        initialItemId:
                          (chapterDeckItems[0] || folderAllItems[0])?.id ?? null,
                      });
                    }}
                    style={{ minHeight: '40px' }}
                  >
                    <Images size={15} strokeWidth={1.75} aria-hidden="true" />
                    Quick-View
                  </Button>
                )}
                {folderCounts.active > 0 && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="dh-glass-accent-btn"
                    onClick={() => {
                      triggerHaptic('tap');
                      launchRevisionForItems(folderAllItems, selectedFolderTitle);
                    }}
                    style={{ minHeight: '40px' }}
                  >
                    <Play size={14} strokeWidth={1.75} aria-hidden="true" />
                    Revise chapter ({folderCounts.active})
                  </Button>
                )}
              </div>
            </div>

            {/* Row 2: Chapter Title + Progress Meter */}
            <div style={{ display: 'grid', gap: '6px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                  flexWrap: 'wrap',
                }}
              >
                <h2
                  style={{
                    margin: 0,
                    fontSize: '20px',
                    fontWeight: 600,
                    color: 'var(--tx)',
                    minWidth: 0,
                  }}
                >
                  {selectedFolderTitle}
                </h2>
                <span className="tabular-nums" style={{ fontSize: '13px', color: 'var(--tx-2)' }}>
                  {folderCounts.active} active · {folderCounts.mastered} mastered
                </span>
              </div>
              {folderCounts.total > 0 && (
                <div className="dh-vault-folder-progress" aria-hidden="true">
                  <div
                    className="dh-vault-folder-progress-fill"
                    style={{
                      width: `${Math.round((folderCounts.mastered / folderCounts.total) * 100)}%`,
                    }}
                  />
                </div>
              )}
            </div>

            {/* Row 3: Status, Tag & Sort Pills */}
            {folderAllItems.length > 0 && (
              <div style={{ display: 'grid', gap: '8px' }}>
                <div className="dh-vault-pill-strip" role="region" aria-label="Filter chapter questions">
                  <Chip
                    selected={chapterStatusFilter === 'active'}
                    onClick={() => {
                      setChapterStatusFilter('active');
                      setVisibleLimit(PAGE_SIZE);
                    }}
                  >
                    Active
                  </Chip>
                  <Chip
                    selected={chapterStatusFilter === 'mastered'}
                    onClick={() => {
                      setChapterStatusFilter('mastered');
                      setVisibleLimit(PAGE_SIZE);
                    }}
                  >
                    Mastered
                  </Chip>
                  <Chip
                    selected={chapterStatusFilter === 'all'}
                    onClick={() => {
                      setChapterStatusFilter('all');
                      setVisibleLimit(PAGE_SIZE);
                    }}
                  >
                    All
                  </Chip>

                  <Chip
                    selected={chapterTagFilter === 'hard'}
                    onClick={() => {
                      setChapterTagFilter((cur) => (cur === 'hard' ? 'all' : 'hard'));
                      setVisibleLimit(PAGE_SIZE);
                    }}
                  >
                    Hard
                  </Chip>
                  <Chip
                    selected={chapterTagFilter === 'trap'}
                    onClick={() => {
                      setChapterTagFilter((cur) => (cur === 'trap' ? 'all' : 'trap'));
                      setVisibleLimit(PAGE_SIZE);
                    }}
                  >
                    Trap
                  </Chip>
                  <Chip
                    selected={chapterTagFilter === 'unsolved'}
                    onClick={() => {
                      setChapterTagFilter((cur) => (cur === 'unsolved' ? 'all' : 'unsolved'));
                      setVisibleLimit(PAGE_SIZE);
                    }}
                  >
                    Unsolved
                  </Chip>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    flexWrap: 'wrap',
                  }}
                >
                  <div className="dh-vault-pill-strip" role="region" aria-label="Sort chapter questions">
                    <Chip
                      selected={chapterSort === 'newest'}
                      onClick={() => setChapterSort('newest')}
                    >
                      Newest
                    </Chip>
                    <Chip
                      selected={chapterSort === 'oldest'}
                      onClick={() => setChapterSort('oldest')}
                    >
                      Oldest
                    </Chip>
                    <Chip
                      selected={chapterSort === 'hardest'}
                      onClick={() => setChapterSort('hardest')}
                    >
                      Hardest first
                    </Chip>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setDensity((d) => (d === 'comfortable' ? 'compact' : 'comfortable'))
                    }
                  >
                    {density === 'comfortable' ? 'Compact view' : 'Card view'}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Chapter Question List */}
          {folderAllItems.length === 0 ? (
            <div className="dh-empty-inline">
              <span>No questions in {selectedFolderTitle} yet.</span>
              <button
                type="button"
                className="dh-eyebrow-link"
                onClick={openThumbZoneCapture}
              >
                Add question ›
              </button>
            </div>
          ) : chapterDeckItems.length === 0 ? (
            <div className="dh-empty-inline">
              <span>No questions match these filters.</span>
              <button
                type="button"
                className="dh-eyebrow-link"
                onClick={clearChapterFilters}
              >
                Show all ›
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '14px' }}>
              {renderQuestionList(visibleListItems)}

              {chapterDeckItems.length > visibleLimit && (
                <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '4px' }}>
                  <Button
                    variant="secondary"
                    size="lg"
                    onClick={() => setVisibleLimit((n) => n + PAGE_SIZE)}
                  >
                    Show more ({chapterDeckItems.length - visibleLimit} remaining)
                  </Button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Compact Row Detail Frosted BottomSheet */}
      <BottomSheet
        open={Boolean(compactDetailItem)}
        onClose={() => setCompactDetailItem(null)}
        title={
          compactDetailItem?.chapterId
            ? resolveVaultChapterName(state.chapters, compactDetailItem.chapterId)
            : 'General / Uncategorized'
        }
      >
        {compactDetailItem && (
          <VaultQuestionCard
            item={compactDetailItem}
            subject={resolveVaultSubjectLabel(state.subjects, compactDetailItem.subjectId)}
            chapterName={
              compactDetailItem.chapterId
                ? resolveVaultChapterName(state.chapters, compactDetailItem.chapterId)
                : 'General / Uncategorized'
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
                itemId: it.id,
              })
            }
            onQuickView={(it) => {
              setCompactDetailItem(null);
              setQuickViewConfig({
                open: true,
                scope: selectedFolder
                  ? 'folder'
                  : isGlobalSearchActive
                    ? 'search'
                    : 'subject',
                folderSubjectId: selectedFolder?.subjectId,
                folderChapterId: selectedFolder?.chapterId,
                initialItemId: it.id,
              });
            }}
            onMenuOpenChange={handleCardMenuOpenChange}
          />
        )}
      </BottomSheet>

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
        open={quickViewConfig.open}
        items={quickViewItems}
        initialItemId={quickViewConfig.initialItemId}
        subjects={state.subjects}
        chapters={state.chapters}
        onClose={() =>
          setQuickViewConfig((prev) => ({ ...prev, open: false, initialItemId: null }))
        }
        onToggleMastered={(it) => void handleToggleMastered(it)}
      />

      {/* Full-Screen Zoom Viewer */}
      <VaultZoomViewer
        open={Boolean(zoomState)}
        src={zoomState?.src || null}
        alt={zoomState?.alt || 'Vault image'}
        caption={zoomState?.caption}
        itemId={zoomState?.itemId}
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
            timerState={state}
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

      {/* Local Vault Backup & Restore Frosted BottomSheet */}
      <BottomSheet
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
              background: 'var(--glass-pill)',
              border: '1px solid var(--glass-bd)',
              borderRadius: '14px',
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
              onClick={() => {
                triggerHaptic('tap');
                void handleExportVault();
              }}
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
              className="dh-glass-btn"
              disabled={archiveBusy !== null}
              onClick={() => {
                triggerHaptic('tap');
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
      </BottomSheet>

      {/* Thumb-Zone Single Gold CTA FAB (Portaled to document.body, hidden when overlays open) */}
      {!isAnyOverlayOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <button
            type="button"
            className={`dh-vault-fab ${activeTimerText ? 'has-mini-timer' : ''}`}
            aria-label={
              selectedFolder
                ? `Add question to ${selectedFolderTitle}`
                : subjectFilter !== 'all'
                  ? `Add question to ${activeSubjectLabel}`
                  : 'Add question to Vault'
            }
            onClick={openThumbZoneCapture}
          >
            <Plus size={18} strokeWidth={2.25} aria-hidden="true" />
            <span>Add</span>
          </button>,
          document.body
        )}
    </div>
  );
};
