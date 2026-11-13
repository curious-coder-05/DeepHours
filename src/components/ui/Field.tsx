import React, { useId } from 'react';

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
}) => {
  const autoId = useId();
  const isIntrinsicControl =
    React.isValidElement<{ id?: string }>(children) &&
    (children.type === 'input' ||
      children.type === 'textarea' ||
      children.type === 'select');
  const existingChildId = isIntrinsicControl ? children.props.id : undefined;
  const resolvedHtmlFor =
    htmlFor || existingChildId || (isIntrinsicControl ? autoId : undefined);
  const renderedChildren =
    isIntrinsicControl && !existingChildId && resolvedHtmlFor
      ? React.cloneElement(children, { id: resolvedHtmlFor })
      : children;

  return (
    <div style={{ display: 'grid', gap: '6px', minWidth: 0 }}>
      <label
        htmlFor={resolvedHtmlFor}
        style={{
          fontSize: '13px',
          fontWeight: 500,
          color: 'var(--tx-2)',
        }}
      >
        {label}
      </label>
      {renderedChildren}
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
};
