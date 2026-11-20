import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  ChevronRight,
  Clock,
  Crosshair,
  Edit3,
  Flame,
  Info,
  ListChecks,
  Minus,
  Plus,
  Share2,
  TrendingDown,
  TrendingUp,
  Trophy,
  X,
} from 'lucide-react';
import type { MockTest, Subject } from '../types';
import { triggerHaptic } from '../utils/haptics';
import {
  MOCK_LEAK_CATEGORIES,
  computeNetMarksBleed,
  createEmptyMockLeaks,
  getTotalLeakErrors,
  type MockLeakCategoryKey,
  type MockLeakCounts,
  type MockLeakMap,
} from '../utils/mockLeaks';
import {
  NEET_MAX_MARKS,
  NEET_SUBJECT_CAPS,
  NEET_SUBJECT_MINS,
  NEET_TOTAL_QUESTIONS,
  buildComputedMockReport,
  normalizeMockReportDetails,
  saveMockReportDetails,
  validateMockReportDetailsInput,
  type ComputedMockReport,
  type MockReportDetails,
  type MockReportMap,
} from '../utils/mockReport';
import {
  buildMockReportFilename,
  renderMockReportBlob,
} from '../utils/mockReportCanvas';

export interface MockReportSheetProps {
  open: boolean;
  mock: MockTest | null;
  allMocks: readonly MockTest[];
  subjects: readonly Subject[];
  targetScore: number;
  reportMap: MockReportMap;
  leakMap: MockLeakMap;
  onClose: () => void;
  onReportDetailsChanged: () => void;
  onAdjustMockLeak: (mockId: string, key: MockLeakCategoryKey, delta: number) => void;
  onOpenScoreLab: (report: ComputedMockReport) => void;
  onSyncCoreMock?: (mockId: string, details: MockReportDetails) => void;
  onNotify?: (msg: string) => void;
}

type TileId =
  | 'rank'
  | 'attempted'
  | 'accuracy'
  | 'positive'
  | 'lost'
  | 'time';

interface ActivePopover {
  id: TileId;
  text: string;
  top: number;
  left: number;
  caretOffset: number;
  placement: 'above' | 'below';
}

export const MockReportSheet: React.FC<MockReportSheetProps> = ({
  open,
  mock,
  allMocks,
  subjects,
  targetScore,
  reportMap,
  leakMap,
  onClose,
  onReportDetailsChanged,
  onAdjustMockLeak,
  onOpenScoreLab,
  onSyncCoreMock,
  onNotify,
}) => {
  const sealPathId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const activeBlobUrlsRef = useRef<Set<string>>(new Set());

  const [activePopover, setActivePopover] = useState<ActivePopover | null>(null);
  const activePopoverRef = useRef<ActivePopover | null>(null);
  activePopoverRef.current = activePopover;
  const [editOpen, setEditOpen] = useState(false);
  const [leaksOpen, setLeaksOpen] = useState(false);
  const [sharingPng, setSharingPng] = useState(false);

  // Edit stats form state
  const [draftBio, setDraftBio] = useState('0');
  const [draftPhy, setDraftPhy] = useState('0');
  const [draftChem, setDraftChem] = useState('0');
  const [draftCorrect, setDraftCorrect] = useState('0');
  const [draftWrong, setDraftWrong] = useState('0');
  const [draftTime, setDraftTime] = useState('180');
  const [syncCoreChecked, setSyncCoreChecked] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const report = useMemo(() => {
    if (!mock) return null;
    return buildComputedMockReport(mock, allMocks, subjects, {
      targetScore,
      reportMap,
    });
  }, [mock, allMocks, subjects, targetScore, reportMap]);

  const leakCounts: MockLeakCounts = useMemo(() => {
    if (!mock) return createEmptyMockLeaks();
    return leakMap[mock.id]?.counts ?? createEmptyMockLeaks();
  }, [mock, leakMap]);

  const totalLeakErrors = useMemo(
    () => getTotalLeakErrors(leakCounts),
    [leakCounts]
  );

  // Sync draft editor values whenever mock changes or edit panel opens
  useEffect(() => {
    if (!report) return;
    setDraftBio(String(report.bioScore));
    setDraftPhy(String(report.phyScore));
    setDraftChem(String(report.chemScore));
    setDraftCorrect(String(report.correct));
    setDraftWrong(String(report.wrong));
    setDraftTime(String(report.timeTakenMin));
    setSyncCoreChecked(false);
    setEditError(null);
  }, [report?.mockId, editOpen]);

  // Reset sub-drawers when sheet closes or switches mock
  useEffect(() => {
    if (!open) {
      setActivePopover(null);
      setEditOpen(false);
      setLeaksOpen(false);
    }
  }, [open, mock?.id]);

  // Cleanup any created Blob URLs on unmount (zero-leak guarantee)
  useEffect(() => {
    return () => {
      for (const url of activeBlobUrlsRef.current) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      }
      activeBlobUrlsRef.current.clear();
    };
  }, []);

  // Body scroll lock, focus trap, focus restoration, Escape handling
  useEffect(() => {
    if (!open || !mock) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (activePopoverRef.current) {
          setActivePopover(null);
          return;
        }
        onCloseRef.current();
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
          )
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    const handleScrollOrResize = () => {
      setActivePopover(null);
    };

    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('resize', handleScrollOrResize);
    const frameId = requestAnimationFrame(() => {
      dialogRef.current?.focus();
    });

    return () => {
      cancelAnimationFrame(frameId);
      document.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('resize', handleScrollOrResize);
      document.body.style.overflow = prevOverflow;
      if (
        previousFocusRef.current &&
        typeof previousFocusRef.current.focus === 'function'
      ) {
        previousFocusRef.current.focus();
      }
    };
  }, [open, mock?.id]);

  const togglePopover = useCallback(
    (
      id: TileId,
      text: string,
      triggerEl: HTMLButtonElement
    ) => {
      triggerHaptic('tap');
      setActivePopover((prev) => {
        if (prev?.id === id) return null;
        const rect = triggerEl.getBoundingClientRect();
        const vw = window.innerWidth;
        const margin = 12;
        const maxPopW = Math.min(264, vw - margin * 2);
        const triggerCx = rect.left + rect.width / 2;
        const clampedCenterX = Math.max(
          margin + maxPopW / 2,
          Math.min(vw - margin - maxPopW / 2, triggerCx)
        );
        const caretOffset = Math.max(
          -(maxPopW / 2 - 16),
          Math.min(maxPopW / 2 - 16, triggerCx - clampedCenterX)
        );
        const showBelow = rect.top < 110;
        return {
          id,
          text,
          top: showBelow ? rect.bottom + 10 : rect.top - 10,
          left: clampedCenterX,
          caretOffset,
          placement: showBelow ? 'below' : 'above',
        };
      });
    },
    []
  );

  const handleSaveEditStats = (e: React.FormEvent) => {
    e.preventDefault();
    if (!mock) return;
    const parsed = {
      bioScore: Number(draftBio),
      phyScore: Number(draftPhy),
      chemScore: Number(draftChem),
      correct: Number(draftCorrect),
      wrong: Number(draftWrong),
      timeTakenMin: Number(draftTime),
    };
    const err = validateMockReportDetailsInput(parsed);
    if (err) {
      setEditError(err);
      return;
    }
    const normalized = normalizeMockReportDetails(parsed);
    saveMockReportDetails(mock.id, normalized);
    onReportDetailsChanged();
    if (syncCoreChecked && onSyncCoreMock) {
      onSyncCoreMock(mock.id, normalized);
    }
    triggerHaptic('success');
    setEditError(null);
    setEditOpen(false);
    onNotify?.('Scorecard stats updated');
  };

  const handleSharePng = async () => {
    if (!report || sharingPng) return;
    triggerHaptic('tap');
    setSharingPng(true);
    try {
      const blob = await renderMockReportBlob(report);
      const filename = buildMockReportFilename(report.mockName, report.dayKey);
      const file = new File([blob], filename, { type: 'image/png' });

      const nav = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
      };
      if (
        typeof nav.share === 'function' &&
        typeof nav.canShare === 'function' &&
        nav.canShare({ files: [file] })
      ) {
        try {
          await nav.share({
            title: `${report.mockName} · ${report.overallScore}/720`,
            text: `NEET UG Mock Report — ${report.overallScore}/720 (${report.percentileFormatted}%ile)`,
            files: [file],
          });
          onNotify?.('Mock report PNG shared');
          return;
        } catch (err) {
          if ((err as Error)?.name === 'AbortError') {
            return;
          }
          // Fall back to direct PNG download if Web Share rejects
        }
      }

      const url = URL.createObjectURL(blob);
      activeBlobUrlsRef.current.add(url);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
        activeBlobUrlsRef.current.delete(url);
      }, 4000);
      onNotify?.(`Saved ${filename}`);
    } catch {
      onNotify?.('Could not generate report PNG');
    } finally {
      setSharingPng(false);
    }
  };

  if (!open || !mock || !report) return null;

  const parsedDraftCorrect = Math.max(0, Math.round(Number(draftCorrect) || 0));
  const parsedDraftWrong = Math.max(0, Math.round(Number(draftWrong) || 0));
  const draftAttempted = parsedDraftCorrect + parsedDraftWrong;
  const draftLiveScore = Math.max(
    -180,
    Math.min(NEET_MAX_MARKS, parsedDraftCorrect * 4 - parsedDraftWrong * 1)
  );
  const draftLiveAcc =
    draftAttempted > 0
      ? ((parsedDraftCorrect / draftAttempted) * 100).toFixed(2)
      : '0.00';

  const tiles: Array<{
    id: TileId;
    label: string;
    icon: React.ReactNode;
    tooltip: string;
    content: React.ReactNode;
  }> = [
    {
      id: 'rank',
      label: 'MOCK RANK',
      icon: <Trophy size={13} strokeWidth={1.9} aria-hidden="true" />,
      tooltip:
        'Personal rank across your logged mocks. Tap Score Lab to simulate 650+.',
      content: (
        <div className="dh-bento-rank-row">
          <div className="dh-bento-metric-val tnum">
            <span>#{report.personalRank.rank}</span>
            <span className="dh-bento-metric-denom">
              /{Math.max(1, report.personalRank.totalMocks)}
            </span>
          </div>
          <button
            type="button"
            data-testid="mock-report-scorelab-btn"
            className="dh-bento-scorelab-pill"
            onClick={(e) => {
              e.stopPropagation();
              triggerHaptic('tap');
              setActivePopover(null);
              onOpenScoreLab(report);
            }}
          >
            <span>Score Lab</span>
            <ChevronRight size={12} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      ),
    },
    {
      id: 'attempted',
      label: 'QS ATTEMPTED',
      icon: <ListChecks size={13} strokeWidth={1.9} aria-hidden="true" />,
      tooltip: `Total questions attempted out of 180 (${report.unattempted} left unattempted).`,
      content: (
        <div className="dh-bento-metric-val tnum">
          <span>{report.attempted}</span>
          <span className="dh-bento-metric-denom">/{NEET_TOTAL_QUESTIONS}</span>
        </div>
      ),
    },
    {
      id: 'accuracy',
      label: 'ACCURACY',
      icon: <Crosshair size={13} strokeWidth={1.9} aria-hidden="true" />,
      tooltip: `Correct answers divided by total attempted (${report.correct} right / ${report.attempted} attempted).`,
      content: (
        <div className="dh-bento-metric-val tnum">
          <span>{report.accuracyPct.toFixed(2)}%</span>
        </div>
      ),
    },
    {
      id: 'positive',
      label: 'POSITIVE SCORE',
      icon: <TrendingUp size={13} strokeWidth={1.9} aria-hidden="true" />,
      tooltip: `Gross marks earned from ${report.correct} correct answers (+4 each).`,
      content: (
        <div className="dh-bento-metric-val tnum">
          <span>{report.positiveScore}</span>
          <span className="dh-bento-metric-denom">/{NEET_MAX_MARKS}</span>
        </div>
      ),
    },
    {
      id: 'lost',
      label: 'MARKS LOST',
      icon: <TrendingDown size={13} strokeWidth={1.9} aria-hidden="true" />,
      tooltip: `-${report.marksLost} direct negative penalty from ${report.wrong} wrong answers (-${report.netBleed} net marks lost vs getting them right).`,
      content: (
        <div className="dh-bento-metric-val tnum">
          <span style={{ color: report.marksLost > 0 ? '#FB7185' : '#F8FAFC' }}>
            {report.marksLost}
          </span>
          <span className="dh-bento-metric-denom">/{NEET_MAX_MARKS}</span>
        </div>
      ),
    },
    {
      id: 'time',
      label: 'TIME TAKEN',
      icon: <Clock size={13} strokeWidth={1.9} aria-hidden="true" />,
      tooltip:
        'Total duration spent completing this paper (auto-filled from Exam Hall when linked).',
      content: (
        <div className="dh-bento-metric-val tnum">
          <span>{report.timeTakenMin}</span>
          <span className="dh-bento-metric-denom"> min</span>
        </div>
      ),
    },
  ];

  const sheetNode = (
    <div
      className="dh-bento-backdrop"
      role="presentation"
      data-testid="mock-report-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          if (activePopover) {
            setActivePopover(null);
          } else {
            onClose();
          }
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${report.mockName} scorecard report`}
        tabIndex={-1}
        data-testid="mock-report-sheet"
        data-tier={report.tier}
        className="dh-bento-sheet"
        onClick={() => {
          if (activePopover) setActivePopover(null);
        }}
        onScroll={() => {
          if (activePopover) setActivePopover(null);
        }}
      >
        {/* Top Header Bar */}
        <header className="dh-bento-header">
          <div className="dh-bento-header-left">
            <h2 className="dh-bento-title">{report.mockName}</h2>
            <p className="dh-bento-date tnum">{report.formattedDate}</p>
          </div>
          <div className="dh-bento-header-actions">
            <button
              type="button"
              data-testid="mock-report-edit-btn"
              aria-expanded={editOpen}
              className={`dh-bento-frosted-btn ${editOpen ? 'is-active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                triggerHaptic('tap');
                setActivePopover(null);
                setEditOpen((v) => !v);
              }}
            >
              <Edit3 size={14} strokeWidth={1.9} aria-hidden="true" />
              <span>Edit stats</span>
            </button>
            <button
              type="button"
              data-testid="mock-report-close-btn"
              aria-label="Close mock report"
              className="dh-bento-close-btn"
              onClick={(e) => {
                e.stopPropagation();
                triggerHaptic('tap');
                onClose();
              }}
            >
              <X size={18} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        </header>

        {/* Inline Frosted Edit Stats Drawer */}
        {editOpen && (
          <form
            className="dh-bento-edit-drawer"
            data-testid="mock-report-edit-drawer"
            onSubmit={handleSaveEditStats}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dh-bento-edit-head">
              <span className="dh-bento-edit-title">
                Edit NEET UG scorecard stats
              </span>
              <span className="dh-bento-edit-preview tnum">
                {draftLiveScore}/720 · {draftLiveAcc}% acc
              </span>
            </div>

            <div className="dh-bento-edit-grid">
              <label className="dh-bento-edit-field">
                <span>Bio (/360)</span>
                <input
                  type="number"
                  data-testid="edit-stat-bio"
                  min={NEET_SUBJECT_MINS.bio}
                  max={NEET_SUBJECT_CAPS.bio}
                  value={draftBio}
                  onChange={(e) => setDraftBio(e.target.value)}
                />
              </label>
              <label className="dh-bento-edit-field">
                <span>Phy (/180)</span>
                <input
                  type="number"
                  data-testid="edit-stat-phy"
                  min={NEET_SUBJECT_MINS.phy}
                  max={NEET_SUBJECT_CAPS.phy}
                  value={draftPhy}
                  onChange={(e) => setDraftPhy(e.target.value)}
                />
              </label>
              <label className="dh-bento-edit-field">
                <span>Chem (/180)</span>
                <input
                  type="number"
                  data-testid="edit-stat-chem"
                  min={NEET_SUBJECT_MINS.chem}
                  max={NEET_SUBJECT_CAPS.chem}
                  value={draftChem}
                  onChange={(e) => setDraftChem(e.target.value)}
                />
              </label>
              <label className="dh-bento-edit-field">
                <span>Correct Qs</span>
                <input
                  type="number"
                  data-testid="edit-stat-correct"
                  min={0}
                  max={NEET_TOTAL_QUESTIONS}
                  value={draftCorrect}
                  onChange={(e) => setDraftCorrect(e.target.value)}
                />
              </label>
              <label className="dh-bento-edit-field">
                <span>Wrong Qs</span>
                <input
                  type="number"
                  data-testid="edit-stat-wrong"
                  min={0}
                  max={NEET_TOTAL_QUESTIONS}
                  value={draftWrong}
                  onChange={(e) => setDraftWrong(e.target.value)}
                />
              </label>
              <label className="dh-bento-edit-field">
                <span>Time (min)</span>
                <input
                  type="number"
                  data-testid="edit-stat-time"
                  min={0}
                  max={600}
                  value={draftTime}
                  onChange={(e) => setDraftTime(e.target.value)}
                />
              </label>
            </div>

            {onSyncCoreMock && (
              <label className="dh-bento-edit-check">
                <input
                  type="checkbox"
                  checked={syncCoreChecked}
                  onChange={(e) => setSyncCoreChecked(e.target.checked)}
                />
                <span>Also update core mock log score &amp; duration</span>
              </label>
            )}

            {editError && (
              <div className="dh-bento-edit-error" role="alert">
                {editError}
              </div>
            )}

            <div className="dh-bento-edit-actions">
              <button
                type="button"
                className="dh-bento-frosted-btn"
                onClick={() => setEditOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                data-testid="mock-report-edit-save-btn"
                className="dh-bento-edit-save-btn"
              >
                <Check size={14} strokeWidth={2.2} aria-hidden="true" />
                <span>Save stats</span>
              </button>
            </div>
          </form>
        )}

        {/* Row 1: Dual Hero Cards */}
        <section className="dh-bento-heroes" aria-label="Score and percentile overview">
          {/* Hero Left: Overall Score Card */}
          <div className="dh-bento-hero-score" data-testid="mock-report-hero-score">
            <div className="dh-bento-hero-score-top">
              <span className="dh-bento-hero-score-label">Overall Score</span>
              {/* 56px rotated circular SVG stamp */}
              <svg
                width="56"
                height="56"
                viewBox="0 0 64 64"
                className="dh-bento-seal"
                aria-hidden="true"
              >
                <defs>
                  <path
                    id={sealPathId}
                    d="M 32, 32 m -21, 0 a 21,21 0 1,1 42,0 a 21,21 0 1,1 -42,0"
                  />
                </defs>
                <circle
                  cx="32"
                  cy="32"
                  r="30"
                  fill="rgba(167, 139, 250, 0.14)"
                  stroke="rgba(196, 181, 253, 0.32)"
                  strokeWidth="1.25"
                />
                <circle
                  cx="32"
                  cy="32"
                  r="14.5"
                  fill="none"
                  stroke="rgba(196, 181, 253, 0.24)"
                  strokeWidth="0.9"
                  strokeDasharray="2.5 2.5"
                />
                <text
                  fill="#C4B5FD"
                  fontSize="6.1"
                  fontWeight="700"
                  letterSpacing="1.15"
                >
                  <textPath href={`#${sealPathId}`} startOffset="2%">
                    DEEP HOURS · NEET MOCK ·
                  </textPath>
                </text>
                <text
                  x="32"
                  y="34.5"
                  textAnchor="middle"
                  fill="#C4B5FD"
                  fontSize="8.5"
                  fontWeight="800"
                >
                  720
                </text>
              </svg>
            </div>

            <div className="dh-bento-primary-score-row">
              <span className="dh-bento-score-bar" aria-hidden="true" />
              <div className="dh-bento-score-figure tnum" data-testid="mock-report-overall-score">
                <span className="dh-bento-score-num">{report.overallScore}</span>
                <span className="dh-bento-score-max">/{NEET_MAX_MARKS}</span>
              </div>
            </div>

            <div className="dh-bento-subjects-row">
              <div className="dh-bento-sub-col">
                <span className="dh-bento-sub-label">Bio Score</span>
                <div className="dh-bento-sub-val tnum">
                  <span style={{ color: '#34D399' }}>{report.bioScore}</span>
                  <span className="dh-bento-sub-max">/360</span>
                </div>
              </div>
              <div className="dh-bento-sub-col">
                <span className="dh-bento-sub-label">Phy Score</span>
                <div className="dh-bento-sub-val tnum">
                  <span style={{ color: '#60A5FA' }}>{report.phyScore}</span>
                  <span className="dh-bento-sub-max">/180</span>
                </div>
              </div>
              <div className="dh-bento-sub-col">
                <span className="dh-bento-sub-label">Chem Score</span>
                <div className="dh-bento-sub-val tnum">
                  <span style={{ color: '#FBBF24' }}>{report.chemScore}</span>
                  <span className="dh-bento-sub-max">/180</span>
                </div>
              </div>
            </div>
          </div>

          {/* Hero Right: Glowing Potential Percentile Card */}
          <div
            className={`dh-bento-hero-pct is-${report.tier}`}
            data-testid="mock-report-hero-percentile"
            data-tier={report.tier}
          >
            <span className="dh-bento-pct-watermark" aria-hidden="true">
              %
            </span>
            <div className="dh-bento-pct-brand">Deep Hours</div>
            <div className="dh-bento-pct-kicker">✦ Potential Percentile</div>
            <div className="dh-bento-pct-num tnum" data-testid="mock-report-percentile-value">
              {report.percentileFormatted}%
            </div>
            <p className="dh-bento-pct-disclaimer">
              Estimated percentile based on historical NEET UG score curves.
            </p>
          </div>
        </section>

        {/* Row 2: 6-Tile Bento Stat Grid */}
        <section className="dh-bento-grid" aria-label="Detailed mock statistics">
          {tiles.map((tile) => {
            const isOpen = activePopover?.id === tile.id;
            return (
              <div
                key={tile.id}
                className="dh-bento-tile"
                data-testid={`mock-report-tile-${tile.id}`}
              >
                <div className="dh-bento-tile-head">
                  <span className="dh-bento-tile-label">
                    {tile.icon}
                    <span>{tile.label}</span>
                  </span>
                  <button
                    type="button"
                    data-testid={`mock-report-info-${tile.id}`}
                    aria-label={`Info about ${tile.label}`}
                    aria-expanded={isOpen}
                    className={`dh-bento-info-btn ${isOpen ? 'is-open' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePopover(tile.id, tile.tooltip, e.currentTarget);
                    }}
                  >
                    <Info size={13} strokeWidth={2.1} aria-hidden="true" />
                  </button>
                </div>
                <div className="dh-bento-tile-body">{tile.content}</div>
              </div>
            );
          })}
        </section>

        {/* Inline 4-Bucket Leak Detector Drawer (synced with dh_mock_leaks_v1) */}
        {leaksOpen && (
          <section
            className="dh-bento-leaks-drawer"
            data-testid="mock-report-leaks-drawer"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dh-bento-edit-head">
              <span className="dh-bento-edit-title">
                <Flame size={15} strokeWidth={1.9} style={{ color: '#FB7185' }} aria-hidden="true" />
                <span>Negative-Marking Leak Tags</span>
              </span>
              <span className="dh-bento-leaks-total tnum">
                {totalLeakErrors > 0
                  ? `${totalLeakErrors} Q · −${computeNetMarksBleed(totalLeakErrors)} net marks`
                  : '0 errors tagged'}
              </span>
            </div>

            <div className="dh-leak-drawer-grid">
              {MOCK_LEAK_CATEGORIES.map((cat) => {
                const val = leakCounts[cat.key];
                const lost = computeNetMarksBleed(val);
                return (
                  <div key={cat.key} className="dh-leak-stepper-row">
                    <div className="min-w-0">
                      <div className="dh-leak-stepper-label">{cat.label}</div>
                      <div className="dh-leak-stepper-sub tnum">
                        {val > 0 ? `−${lost} net marks` : '0 errors'}
                      </div>
                    </div>
                    <div className="dh-leak-stepper-controls">
                      <button
                        type="button"
                        aria-label={`Decrease ${cat.label}`}
                        data-testid={`report-leak-dec-${cat.key}`}
                        className="dh-leak-step-btn"
                        disabled={val <= 0}
                        onClick={() => onAdjustMockLeak(mock.id, cat.key, -1)}
                      >
                        <Minus size={14} strokeWidth={2} aria-hidden="true" />
                      </button>
                      <span
                        className="dh-leak-step-val tnum"
                        data-testid={`report-leak-val-${cat.key}`}
                      >
                        {val}
                      </span>
                      <button
                        type="button"
                        aria-label={`Increase ${cat.label}`}
                        data-testid={`report-leak-inc-${cat.key}`}
                        className="dh-leak-step-btn"
                        onClick={() => onAdjustMockLeak(mock.id, cat.key, 1)}
                      >
                        <Plus size={14} strokeWidth={2} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Bottom Action Bar (Secondary frosted Leak Tags + Single Gold CTA Share Report PNG) */}
        <footer className="dh-bento-footer" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            data-testid="mock-report-leaks-btn"
            aria-expanded={leaksOpen}
            className={`dh-bento-secondary-cta ${leaksOpen ? 'is-active' : ''}`}
            onClick={() => {
              triggerHaptic('tap');
              setActivePopover(null);
              setLeaksOpen((v) => !v);
            }}
          >
            <Flame size={16} strokeWidth={1.9} aria-hidden="true" />
            <span>Log Leak Tags</span>
            {totalLeakErrors > 0 && (
              <span className="dh-bento-leaks-badge tnum">{totalLeakErrors}</span>
            )}
          </button>

          <button
            type="button"
            data-testid="mock-report-share-btn"
            className="dh-bento-gold-cta"
            disabled={sharingPng}
            onClick={() => void handleSharePng()}
          >
            <Share2 size={16} strokeWidth={2.1} aria-hidden="true" />
            <span>{sharingPng ? 'Rendering PNG…' : 'Share Report PNG'}</span>
          </button>
        </footer>
      </div>

      {/* Crisp High-Contrast Light Floating (i) Tooltip Popover (viewport-clamped) */}
      {activePopover && (
        <div
          role="tooltip"
          data-testid="mock-report-popover"
          className={`dh-bento-popover is-${activePopover.placement}`}
          style={{
            top: `${activePopover.top}px`,
            left: `${activePopover.left}px`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <span>{activePopover.text}</span>
          <span
            className="dh-bento-popover-caret"
            style={{
              transform: `translateX(${activePopover.caretOffset}px) rotate(45deg)`,
            }}
            aria-hidden="true"
          />
        </div>
      )}
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(sheetNode, document.body)
    : sheetNode;
};
