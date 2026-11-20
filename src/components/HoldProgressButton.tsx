import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Square } from 'lucide-react';
import { triggerHaptic } from '../utils/haptics';

export interface HoldProgressButtonProps {
  label: string;
  holdingLabel?: string;
  durationMs?: number;
  onComplete: () => void;
  onHoldStart?: () => void;
  onHoldEnd?: () => void;
  className?: string;
  compact?: boolean;
  icon?: React.ReactNode;
}

/**
 * 1.5-second press-and-hold radial progress button that prevents accidental
 * desk bumps from stopping a study session or finishing a 3-hour exam paper.
 */
export const HoldProgressButton: React.FC<HoldProgressButtonProps> = ({
  label,
  holdingLabel = 'Keep holding…',
  durationMs = 1500,
  onComplete,
  onHoldStart,
  onHoldEnd,
  className = '',
  compact = false,
  icon,
}) => {
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const startTsRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const completedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const cancelHold = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    startTsRef.current = null;
    setHolding(false);
    setProgress(0);
    onHoldEnd?.();
  }, [onHoldEnd]);

  const startHold = useCallback(() => {
    if (startTsRef.current !== null) return;
    completedRef.current = false;
    startTsRef.current = performance.now();
    setHolding(true);
    setProgress(0);
    onHoldStart?.();
    triggerHaptic('tap');

    const step = (now: number) => {
      if (startTsRef.current === null) return;
      const elapsed = now - startTsRef.current;
      const pct = Math.min(1, elapsed / durationMs);
      setProgress(pct);
      if (pct >= 1) {
        if (!completedRef.current) {
          completedRef.current = true;
          startTsRef.current = null;
          rafRef.current = null;
          setHolding(false);
          setProgress(0);
          triggerHaptic('stop');
          onHoldEnd?.();
          onCompleteRef.current();
        }
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, [durationMs, onHoldEnd, onHoldStart]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const radius = compact ? 11 : 12;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress);

  return (
    <button
      type="button"
      className={`dh-hold-btn ${holding ? 'is-holding' : ''} ${compact ? 'is-compact' : ''} ${className}`.trim()}
      aria-label={`${label} (press and hold ${(durationMs / 1000).toFixed(1)} seconds)`}
      onPointerDown={(e) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        e.stopPropagation();
        startHold();
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        if (!completedRef.current) cancelHold();
      }}
      onPointerLeave={() => {
        if (!completedRef.current && holding) cancelHold();
      }}
      onPointerCancel={() => {
        if (!completedRef.current) cancelHold();
      }}
      onKeyDown={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
          e.preventDefault();
          startHold();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          if (!completedRef.current) cancelHold();
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="dh-hold-ring-wrap" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 28 28" className="dh-hold-ring-svg">
          <circle
            cx="14"
            cy="14"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.22"
            strokeWidth="2.4"
          />
          <circle
            cx="14"
            cy="14"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            transform="rotate(-90 14 14)"
          />
        </svg>
        <span className="dh-hold-ring-icon">
          {icon || <Square size={10} strokeWidth={2.4} fill="currentColor" />}
        </span>
      </span>
      <span className="dh-hold-btn-label">{holding ? holdingLabel : label}</span>
    </button>
  );
};
