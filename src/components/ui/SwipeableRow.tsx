import React, { useRef, useState } from 'react';
import { Check, Trash2 } from 'lucide-react';

export interface SwipeableRowProps {
  children: React.ReactNode;
  onSwipeRight?: () => void;
  onSwipeLeft?: () => void;
  rightLabel?: string;
  leftLabel?: string;
  disabled?: boolean;
}

const SWIPE_THRESHOLD = 64;
const MAX_OFFSET = 108;

export const SwipeableRow: React.FC<SwipeableRowProps> = ({
  children,
  onSwipeRight,
  onSwipeLeft,
  rightLabel = 'Complete',
  leftLabel = 'Delete',
  disabled = false,
}) => {
  const startXRef = useRef<number | null>(null);
  const startYRef = useRef<number | null>(null);
  const isSwipingRef = useRef<boolean>(false);
  const thresholdCrossedRef = useRef<boolean>(false);
  const [offsetX, setOffsetX] = useState<number>(0);

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (disabled || e.touches.length !== 1) return;
    const target = e.target as HTMLElement | null;
    if (target && target.closest('input, textarea, select')) return;
    startXRef.current = e.touches[0].clientX;
    startYRef.current = e.touches[0].clientY;
    isSwipingRef.current = false;
    thresholdCrossedRef.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (disabled || startXRef.current === null || startYRef.current === null) return;
    const dx = e.touches[0].clientX - startXRef.current;
    const dy = e.touches[0].clientY - startYRef.current;

    if (!isSwipingRef.current) {
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
        startXRef.current = null;
        startYRef.current = null;
        return;
      }
      if (Math.abs(dx) > 12) {
        isSwipingRef.current = true;
      } else {
        return;
      }
    }

    if (dx > 0 && !onSwipeRight) return;
    if (dx < 0 && !onSwipeLeft) return;

    const clamped = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, dx));
    const crossed = Math.abs(clamped) >= SWIPE_THRESHOLD;
    if (crossed && !thresholdCrossedRef.current) {
      thresholdCrossedRef.current = true;
      try {
        navigator.vibrate?.(10);
      } catch {
        // Ignore haptics errors on unsupported devices
      }
    } else if (!crossed && thresholdCrossedRef.current) {
      thresholdCrossedRef.current = false;
    }

    setOffsetX(clamped);
  };

  const handleTouchEnd = () => {
    if (disabled || !isSwipingRef.current) {
      startXRef.current = null;
      startYRef.current = null;
      setOffsetX(0);
      return;
    }
    const finalOffset = offsetX;
    startXRef.current = null;
    startYRef.current = null;
    isSwipingRef.current = false;
    thresholdCrossedRef.current = false;
    setOffsetX(0);

    if (finalOffset >= SWIPE_THRESHOLD && onSwipeRight) {
      try {
        navigator.vibrate?.(14);
      } catch {
        // Ignore
      }
      onSwipeRight();
    } else if (finalOffset <= -SWIPE_THRESHOLD && onSwipeLeft) {
      try {
        navigator.vibrate?.([12, 24, 12]);
      } catch {
        // Ignore
      }
      onSwipeLeft();
    }
  };

  const isRightActive = offsetX > 8;
  const isLeftActive = offsetX < -8;
  const triggered = Math.abs(offsetX) >= SWIPE_THRESHOLD;

  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 12,
        touchAction: 'pan-y',
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={() => {
        startXRef.current = null;
        startYRef.current = null;
        isSwipingRef.current = false;
        setOffsetX(0);
      }}
    >
      {/* Background action indicator */}
      {(isRightActive || isLeftActive) && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: isRightActive ? 'flex-start' : 'flex-end',
            padding: '0 16px',
            borderRadius: 12,
            background: isRightActive
              ? triggered
                ? 'var(--ok)'
                : 'color-mix(in srgb, var(--ok) 25%, var(--sf-2))'
              : triggered
                ? 'var(--err)'
                : 'color-mix(in srgb, var(--err) 25%, var(--sf-2))',
            color: triggered
              ? isRightActive
                ? 'var(--ok-on)'
                : 'var(--err-on)'
              : 'var(--tx)',
            fontWeight: 600,
            fontSize: 12,
            gap: 6,
            transition: 'background 120ms ease',
          }}
        >
          {isRightActive ? (
            <>
              <Check size={16} strokeWidth={2.25} />
              <span>{rightLabel}</span>
            </>
          ) : (
            <>
              <span>{leftLabel}</span>
              <Trash2 size={16} strokeWidth={2} />
            </>
          )}
        </div>
      )}

      <div
        style={{
          transform: offsetX !== 0 ? `translate3d(${offsetX}px, 0, 0)` : undefined,
          transition: isSwipingRef.current
            ? 'none'
            : 'transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        }}
      >
        {children}
      </div>
    </div>
  );
};
