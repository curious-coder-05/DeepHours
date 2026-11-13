import React from 'react';

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
  const activeIndex = Math.max(
    0,
    options.findIndex((opt) => opt.value === value)
  );
  const count = Math.max(1, options.length);

  return (
    <div
      id={id}
      role="tablist"
      aria-label={resolvedAriaLabel}
      className="dh-segmented"
    >
      <span
        aria-hidden="true"
        className="dh-seg-thumb"
        style={{
          width: `calc((100% - 8px - ${(count - 1) * 4}px) / ${count})`,
          transform: `translateX(calc(${activeIndex * 100}% + ${activeIndex * 4}px))`,
        }}
      />
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
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
