import React from 'react';

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  'aria-label'?: string;
  label?: string;
  size?: number;
  variant?: 'default' | 'ghost' | 'primary';
}

export const IconButton: React.FC<IconButtonProps> = ({
  size = 44,
  variant = 'default',
  className = '',
  style,
  type = 'button',
  label,
  children,
  ...rest
}) => {
  const resolvedAriaLabel = rest['aria-label'] || label || rest.title || 'Action';
  const variantStyle: React.CSSProperties =
    variant === 'ghost'
      ? { background: 'transparent', borderColor: 'transparent' }
      : variant === 'primary'
        ? {
            background: 'var(--ac)',
            color: 'var(--ac-on)',
            borderColor: 'transparent',
          }
        : {};

  return (
    <button
      type={type}
      aria-label={resolvedAriaLabel}
      className={`dh-icon-btn ${className}`.trim()}
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        ...variantStyle,
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
};
