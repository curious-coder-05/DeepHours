import React from 'react';

export interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
}

export const Field: React.FC<FieldProps> = ({
  label,
  htmlFor,
  hint,
  error,
  children,
}) => (
  <div style={{ display: 'grid', gap: '6px', minWidth: 0 }}>
    <label
      htmlFor={htmlFor}
      style={{
        fontSize: '13px',
        fontWeight: 500,
        color: 'var(--tx-2)',
      }}
    >
      {label}
    </label>
    {children}
    {hint && !error && (
      <span style={{ fontSize: '12px', color: 'var(--tx-3)', lineHeight: 1.35 }}>
        {hint}
      </span>
    )}
    {error && (
      <span
        role="alert"
        style={{
          fontSize: '12px',
          color: 'var(--err-ink)',
          fontWeight: 600,
          lineHeight: 1.35,
        }}
      >
        {error}
      </span>
    )}
  </div>
);
