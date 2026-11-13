import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  fullWidth = false,
  icon,
  className = '',
  style,
  type = 'button',
  children,
  ...rest
}) => {
  const variantClass =
    variant === 'primary'
      ? 'dh-btn-primary'
      : variant === 'ghost'
        ? 'dh-btn-ghost'
        : variant === 'danger'
          ? 'dh-btn-danger'
          : 'dh-btn-secondary';

  return (
    <button
      type={type}
      className={`dh-btn ${variantClass} ${size === 'lg' ? 'dh-btn-lg' : ''} ${className}`.trim()}
      style={{
        ...(size === 'sm' ? { minHeight: '36px', padding: '6px 12px', fontSize: '13px' } : {}),
        ...(fullWidth ? { width: '100%' } : {}),
        ...style,
      }}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
};
