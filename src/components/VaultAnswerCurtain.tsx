import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, GripHorizontal, PanelBottomClose } from 'lucide-react';
import { triggerHaptic } from '../utils/haptics';
import {
  CURTAIN_MAX_TOP_PCT,
  CURTAIN_MIN_TOP_PCT,
  VAULT_CURTAIN_CHANGE_EVENT,
  computeCurtainTopPctFromPointer,
  createMaskBottomHalfConfig,
  getVaultCurtainConfig,
  saveVaultCurtainConfig,
  type VaultCurtainConfig,
} from '../utils/vaultCurtain';

export interface UseVaultCurtainResult {
  config: VaultCurtainConfig;
  peeled: boolean;
  setPeeled: React.Dispatch<React.SetStateAction<boolean>>;
  toggleEnabled: () => void;
  applyMaskBottomHalf: () => void;
  setTopPct: (nextPct: number, persist?: boolean) => void;
  togglePeel: () => void;
}

export function useVaultCurtain(itemId: string | null | undefined): UseVaultCurtainResult {
  const [config, setConfig] = useState<VaultCurtainConfig>(() =>
    getVaultCurtainConfig(itemId)
  );
  const [peeled, setPeeled] = useState<boolean>(false);

  // Reload whenever itemId changes (e.g., stepping to next photo in Quick-View or Revision Deck)
  useEffect(() => {
    setConfig(getVaultCurtainConfig(itemId));
    setPeeled(false);
  }, [itemId]);

  // Stay in sync across Quick-View, Zoom Viewer, and Revision Deck
  useEffect(() => {
    if (!itemId || typeof window === 'undefined') return;
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ itemId: string; config: VaultCurtainConfig }>).detail;
      if (detail && detail.itemId === itemId) {
        setConfig(detail.config);
      }
    };
    window.addEventListener(VAULT_CURTAIN_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(VAULT_CURTAIN_CHANGE_EVENT, onChange);
  }, [itemId]);

  const commit = useCallback(
    (next: VaultCurtainConfig) => {
      const saved = itemId ? saveVaultCurtainConfig(itemId, next) : next;
      setConfig(saved);
    },
    [itemId]
  );

  const toggleEnabled = useCallback(() => {
    triggerHaptic('tap');
    setPeeled(false);
    commit({ ...config, enabled: !config.enabled });
  }, [commit, config]);

  const applyMaskBottomHalf = useCallback(() => {
    triggerHaptic('tap');
    setPeeled(false);
    commit(createMaskBottomHalfConfig());
  }, [commit]);

  const setTopPct = useCallback(
    (nextPct: number, persist = true) => {
      const next: VaultCurtainConfig = {
        enabled: true,
        topPct: Math.round(
          Math.max(CURTAIN_MIN_TOP_PCT, Math.min(CURTAIN_MAX_TOP_PCT, nextPct))
        ),
      };
      if (persist && itemId) {
        const saved = saveVaultCurtainConfig(itemId, next);
        setConfig(saved);
      } else {
        setConfig(next);
      }
    },
    [itemId]
  );

  const togglePeel = useCallback(() => {
    triggerHaptic('tap');
    setPeeled((prev) => !prev);
  }, []);

  return {
    config,
    peeled,
    setPeeled,
    toggleEnabled,
    applyMaskBottomHalf,
    setTopPct,
    togglePeel,
  };
}

export interface VaultCurtainToolbarProps {
  curtain: UseVaultCurtainResult;
  compact?: boolean;
}

export const VaultCurtainToolbar: React.FC<VaultCurtainToolbarProps> = ({
  curtain,
  compact = false,
}) => {
  const { config, peeled, toggleEnabled, applyMaskBottomHalf, togglePeel } = curtain;

  return (
    <div
      className={`dh-curtain-toolbar ${compact ? 'is-compact' : ''}`}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        data-testid="vault-curtain-toggle"
        aria-pressed={config.enabled}
        className={`dh-curtain-pill ${config.enabled ? 'is-active' : ''}`}
        onClick={toggleEnabled}
      >
        <PanelBottomClose size={14} strokeWidth={1.8} aria-hidden="true" />
        <span>Answer curtain</span>
      </button>

      <button
        type="button"
        data-testid="vault-curtain-mask-half"
        className="dh-curtain-pill"
        onClick={applyMaskBottomHalf}
      >
        <span>Mask bottom half</span>
      </button>

      {config.enabled && (
        <button
          type="button"
          data-testid="vault-curtain-peek-btn"
          aria-pressed={peeled}
          className={`dh-curtain-pill ${peeled ? 'is-peeled' : 'is-accent'}`}
          onClick={togglePeel}
        >
          {peeled ? (
            <EyeOff size={14} strokeWidth={1.8} aria-hidden="true" />
          ) : (
            <Eye size={14} strokeWidth={1.8} aria-hidden="true" />
          )}
          <span>{peeled ? 'Snap curtain' : 'Peek / Reveal'}</span>
        </button>
      )}
    </div>
  );
};

export interface VaultAnswerCurtainStageProps {
  curtain: UseVaultCurtainResult;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}

/**
 * Wraps a saved Vault question photo and overlays a frosted AMOLED Answer Curtain
 * covering the lower `(100 - topPct)%` of the image.
 * - Dragging the Lumen amber top handle (`touch-action: none` ONLY on the handle)
 *   smoothly resizes the split height (`20%..85%`) without breaking page scroll or pinch-zoom.
 * - Tapping the frosted curtain body once peels it away to expose the answer;
 *   tapping the bottom restore pill snaps it cleanly back up.
 */
export const VaultAnswerCurtainStage: React.FC<VaultAnswerCurtainStageProps> = ({
  curtain,
  className,
  style,
  children,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef<boolean>(false);
  const latestPctRef = useRef<number>(curtain.config.topPct);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  latestPctRef.current = curtain.config.topPct;

  const { config, peeled, setTopPct, togglePeel } = curtain;

  const handleDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    draggingRef.current = true;
    setIsDragging(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore synthetic events
    }
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const next = computeCurtainTopPctFromPointer(e.clientY, rect.top, rect.height);
      latestPctRef.current = next;
      setTopPct(next, false);
    }
  };

  const handleDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || !containerRef.current) return;
    e.stopPropagation();
    const rect = containerRef.current.getBoundingClientRect();
    const next = computeCurtainTopPctFromPointer(e.clientY, rect.top, rect.height);
    latestPctRef.current = next;
    setTopPct(next, false);
  };

  const handleDragEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    e.stopPropagation();
    draggingRef.current = false;
    setIsDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    setTopPct(latestPctRef.current, true);
    triggerHaptic('tap');
  };

  const handleKeyAdjust = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      setTopPct(config.topPct - 5, true);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      setTopPct(config.topPct + 5, true);
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      togglePeel();
    }
  };

  return (
    <div
      ref={containerRef}
      className={`dh-curtain-stage ${className || ''}`.trim()}
      style={style}
    >
      {children}

      {config.enabled && (
        <>
          <div
            data-testid="vault-curtain-overlay"
            data-peeled={peeled ? '1' : '0'}
            data-top-pct={config.topPct}
            className={`dh-curtain-overlay ${peeled ? 'is-peeled' : ''} ${isDragging ? 'is-dragging' : ''}`}
            style={{ top: `${config.topPct}%` }}
            onClick={(e) => {
              e.stopPropagation();
              togglePeel();
            }}
          >
            {/* Top Lumen Amber Drag Handle — touch-action: none strictly isolated here */}
            <div
              role="slider"
              tabIndex={0}
              aria-label="Answer curtain height"
              aria-valuemin={CURTAIN_MIN_TOP_PCT}
              aria-valuemax={CURTAIN_MAX_TOP_PCT}
              aria-valuenow={config.topPct}
              aria-valuetext={`Covering bottom ${100 - config.topPct}% of question photo`}
              data-testid="vault-curtain-handle"
              className="dh-curtain-handle"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={handleDragStart}
              onPointerMove={handleDragMove}
              onPointerUp={handleDragEnd}
              onPointerCancel={handleDragEnd}
              onKeyDown={handleKeyAdjust}
            >
              <span className="dh-curtain-handle-line" aria-hidden="true" />
              <span className="dh-curtain-handle-badge">
                <GripHorizontal size={13} strokeWidth={2} aria-hidden="true" />
                <span>Hold or drag to reveal</span>
              </span>
            </div>

            {/* Frosted Glass Curtain Body (tap once to peel away) */}
            <div className="dh-curtain-body">
              <span className="dh-curtain-tap-hint">Tap frosted area to peek</span>
            </div>
          </div>

          {peeled && (
            <button
              type="button"
              data-testid="vault-curtain-restore-pill"
              className="dh-curtain-restore-pill"
              onClick={(e) => {
                e.stopPropagation();
                togglePeel();
              }}
            >
              <EyeOff size={14} strokeWidth={1.8} aria-hidden="true" />
              <span>Tap to pull curtain back up</span>
            </button>
          )}
        </>
      )}
    </div>
  );
};
