import React from 'react';

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  colorDot?: string;
}

export const Chip: React.FC<ChipProps> = ({
  selected = false,
  colorDot,
  className = '',
  type = 'button',
  children,
  ...rest
}) => (
  <button
    type={type}
    aria-pressed={selected}
    className={`dh-chip ${selected ? 'active' : ''} ${className}`.trim()}
    {...rest}
  >
    {colorDot && (
      <span
        aria-hidden="true"
        className="dh-sub-dot"
        style={{
          background: colorDot,
        }}
      />
    )}
    {children}
  </button>
);
