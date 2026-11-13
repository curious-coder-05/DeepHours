import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string> {
  options: Array<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  'aria-label'?: string;
  ariaLabel?: string;
  id?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  'aria-label': ariaLabelDash,
  ariaLabel: ariaLabelCamel,
  id,
}: SegmentedProps<T>) {
  const resolvedAriaLabel = ariaLabelDash || ariaLabelCamel || 'Segmented options';
  const containerRef = useRef<HTMLDivElement | null>(null);
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [thumbRect, setThumbRect] = useState<{ left: number; width: number } | null>(
    null
  );

  const activeIndex = Math.max(
    0,
    options.findIndex((opt) => opt.value === value)
  );

  const measureThumb = () => {
    const activeBtn = btnRefs.current[activeIndex];
    if (!activeBtn) return;
    setThumbRect({
      left: activeBtn.offsetLeft,
      width: activeBtn.offsetWidth,
    });
  };

  useLayoutEffect(() => {
    measureThumb();
  }, [activeIndex, options.length, value]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measureThumb());
    ro.observe(el);
    return () => ro.disconnect();
  }, [activeIndex, options.length]);

  useEffect(() => {
    const activeBtn = btnRefs.current[activeIndex];
    if (activeBtn && typeof activeBtn.scrollIntoView === 'function') {
      const container = containerRef.current;
      if (container && container.scrollWidth > container.clientWidth + 2) {
        activeBtn.scrollIntoView({
          behavior: 'auto',
          block: 'nearest',
          inline: 'nearest',
        });
      }
    }
  }, [activeIndex]);

  const count = Math.max(1, options.length);
  const fallbackLeft = `calc(4px + ${activeIndex} * ((100% - 8px - ${(count - 1) * 4}px) / ${count} + 4px))`;
  const fallbackWidth = `calc((100% - 8px - ${(count - 1) * 4}px) / ${count})`;

  return (
    <div
      ref={containerRef}
      id={id}
      role="tablist"
      aria-label={resolvedAriaLabel}
      className="dh-segmented"
    >
      <span
        aria-hidden="true"
        className="dh-seg-thumb"
        style={
          thumbRect
            ? {
                left: '0px',
                width: `${thumbRect.width}px`,
                transform: `translateX(${thumbRect.left}px)`,
              }
            : {
                left: fallbackLeft,
                width: fallbackWidth,
              }
        }
      />
      {options.map((opt, idx) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              btnRefs.current[idx] = el;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={opt.disabled}
            className={`dh-seg-btn ${selected ? 'active' : ''}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
