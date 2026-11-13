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
  const isIdAcceptingControl =
    React.isValidElement<{ id?: string }>(children) &&
    (children.type === 'input' ||
      children.type === 'textarea' ||
      children.type === 'select' ||
      (typeof children.type === 'function' &&
        (children.type as { displayName?: string }).displayName === 'Select'));
  const existingChildId = isIdAcceptingControl ? children.props.id : undefined;
  const resolvedHtmlFor =
    htmlFor || existingChildId || (isIdAcceptingControl ? autoId : undefined);
  const renderedChildren =
    isIdAcceptingControl && !existingChildId && resolvedHtmlFor
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
        <span style={{ fontSize: '13px', color: 'var(--tx-3)', lineHeight: 1.35 }}>
          {hint}
        </span>
      )}
      {error && (
        <span
          role="alert"
          style={{
            fontSize: '13px',
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
