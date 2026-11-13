import React, { useCallback, useEffect, useRef, useState } from 'react';
import { computeWindowRange } from '../../utils/uiHelpers';

export interface WindowedListProps<T> {
  items: readonly T[];
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => React.ReactNode;
  threshold?: number;
  estimatedRowHeight?: number;
  overscan?: number;
  className?: string;
  style?: React.CSSProperties;
  itemLabel?: string;
}

export function WindowedList<T>({
  items,
  getKey,
  renderItem,
  threshold = 100,
  estimatedRowHeight = 76,
  overscan = 16,
  className = '',
  style,
  itemLabel = 'rows',
}: WindowedListProps<T>) {
  const isLarge = items.length > threshold;
  const [showAll, setShowAll] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const measuredHeightsRef = useRef<Map<number, number>>(new Map());
  const rafRef = useRef<number | null>(null);

  const [range, setRange] = useState(() => ({
    startIndex: 0,
    endIndex: Math.min(items.length - 1, Math.max(39, overscan * 2)),
    topSpacerPx: 0,
    bottomSpacerPx: Math.max(0, (items.length - Math.min(items.length, 40)) * estimatedRowHeight),
  }));

  const recalc = useCallback(() => {
    if (!isLarge || showAll) return;
    const el = containerRef.current;
    const rectTop = el ? el.getBoundingClientRect().top : 0;
    const vh = typeof window !== 'undefined' ? window.innerHeight || 800 : 800;
    const next = computeWindowRange({
      totalCount: items.length,
      containerTopPx: rectTop,
      viewportHeightPx: vh,
      estimatedRowHeightPx: estimatedRowHeight,
      measuredHeights: measuredHeightsRef.current,
      overscan,
    });
    setRange((prev) =>
      prev.startIndex === next.startIndex &&
      prev.endIndex === next.endIndex &&
      Math.abs(prev.topSpacerPx - next.topSpacerPx) < 4 &&
      Math.abs(prev.bottomSpacerPx - next.bottomSpacerPx) < 4
        ? prev
        : next
    );
  }, [estimatedRowHeight, isLarge, items.length, overscan, showAll]);

  useEffect(() => {
    if (!isLarge || showAll) return;
    recalc();
    const schedule = () => {
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        recalc();
      });
    };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isLarge, recalc, showAll]);

  const measureRowRef = useCallback(
    (index: number) => (node: HTMLDivElement | null) => {
      if (!node || !isLarge || showAll) return;
      const h = node.getBoundingClientRect().height;
      if (h > 0) {
        const prev = measuredHeightsRef.current.get(index);
        if (prev === undefined || Math.abs(prev - h) >= 2) {
          measuredHeightsRef.current.set(index, h);
        }
      }
    },
    [isLarge, showAll]
  );

  if (!isLarge || showAll) {
    return (
      <div className={className} style={style}>
        {isLarge && showAll && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-[var(--line)] bg-[var(--sf-2)] px-2.5 py-1.5 text-[12px] text-[var(--tx-2)]">
            <span className="tnum">
              Showing all {items.length} {itemLabel}
            </span>
            <button
              type="button"
              onClick={() => setShowAll(false)}
              className="text-[12px] font-semibold text-[var(--ac-ink)] underline"
              style={{ minHeight: '28px', padding: '2px 8px' }}
            >
              Use windowed view
            </button>
          </div>
        )}
        {items.map((item, idx) => (
          <React.Fragment key={getKey(item, idx)}>
            {renderItem(item, idx)}
          </React.Fragment>
        ))}
      </div>
    );
  }

  const sliceStart = Math.max(0, Math.min(items.length - 1, range.startIndex));
  const sliceEnd = Math.max(sliceStart, Math.min(items.length - 1, range.endIndex));
  const visibleSlice = items.slice(sliceStart, sliceEnd + 1);

  return (
    <div ref={containerRef} className={className} style={style}>
      <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-[var(--line)] bg-[var(--sf-2)] px-2.5 py-1.5 text-[12px] text-[var(--tx-2)]">
        <span className="tnum">
          Showing {sliceStart + 1}–{sliceEnd + 1} of {items.length} {itemLabel}
        </span>
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="text-[12px] font-semibold text-[var(--ac-ink)] underline"
          style={{ minHeight: '28px', padding: '2px 8px' }}
        >
          Show all
        </button>
      </div>
      {range.topSpacerPx > 0 && (
        <div aria-hidden="true" style={{ height: range.topSpacerPx }} />
      )}
      {visibleSlice.map((item, offset) => {
        const realIdx = sliceStart + offset;
        return (
          <div key={getKey(item, realIdx)} ref={measureRowRef(realIdx)}>
            {renderItem(item, realIdx)}
          </div>
        );
      })}
      {range.bottomSpacerPx > 0 && (
        <div aria-hidden="true" style={{ height: range.bottomSpacerPx }} />
      )}
    </div>
  );
}
