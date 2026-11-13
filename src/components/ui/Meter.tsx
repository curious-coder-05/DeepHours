import React from 'react';

export interface MeterProps {
  value: number;
  max?: number;
  color?: string;
  height?: number;
  label?: string;
}

export const Meter: React.FC<MeterProps> = ({
  value,
  max = 100,
  color = 'var(--ac)',
  height = 8,
  label,
}) => {
  const safeMax = max > 0 ? max : 100;
  const pct = Math.max(0, Math.min(100, (value / safeMax) * 100));

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={Math.round(safeMax)}
      aria-label={label}
      style={{
        width: '100%',
        height,
        background: 'var(--sf-2)',
        borderRadius: '99px',
        overflow: 'hidden',
        border: '1px solid var(--line)',
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: '100%',
          borderRadius: '99px',
          background: color,
          transition: 'width var(--dur-slow) var(--ease-out)',
        }}
      />
    </div>
  );
};
