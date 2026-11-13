import React from 'react';

export interface StatProps {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  sub?: React.ReactNode;
  tone?: 'default' | 'accent' | 'ok' | 'warn' | 'err';
  mono?: boolean;
}

export const Stat: React.FC<StatProps> = ({
  label,
  value,
  hint,
  sub,
  tone = 'default',
  mono = false,
}) => {
  const subtitle = hint ?? sub;
  const color =
    tone === 'accent'
      ? 'var(--ac-ink)'
      : tone === 'ok'
        ? 'var(--ok-ink)'
        : tone === 'warn'
          ? 'var(--warn-ink)'
          : tone === 'err'
            ? 'var(--err-ink)'
            : 'var(--tx)';

  return (
    <div
      style={{
        background: 'var(--sf-2)',
        border: '1px solid var(--line)',
        borderRadius: '12px',
        padding: '12px',
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: '12px', color: 'var(--tx-2)', lineHeight: 1.3 }}>
        {label}
      </div>
      <div
        className={mono ? 'mono' : 'tabular-nums'}
        style={{
          fontSize: '18px',
          fontWeight: 600,
          color,
          marginTop: '4px',
          lineHeight: 1.2,
        }}
      >
        {value}
      </div>
      {subtitle && (
        <div style={{ fontSize: '12px', color: 'var(--tx-3)', marginTop: '2px' }}>
          {subtitle}
        </div>
      )}
    </div>
  );
};
