import React from 'react';
import { ChevronRight } from 'lucide-react';

export interface ListRowProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  chevron?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  'aria-label'?: string;
}

export const ListRow: React.FC<ListRowProps> = ({
  title,
  subtitle,
  leading,
  trailing,
  chevron = false,
  onClick,
  disabled = false,
  className = '',
  style,
  'aria-label': ariaLabel,
}) => {
  const inner = (
    <>
      {leading && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            color: 'var(--tx-2)',
          }}
        >
          {leading}
        </span>
      )}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: 'block',
            fontSize: '15px',
            fontWeight: 500,
            color: 'var(--tx)',
            lineHeight: 1.35,
          }}
        >
          {title}
        </span>
        {subtitle && (
          <span
            style={{
              display: 'block',
              fontSize: '13px',
              color: 'var(--tx-2)',
              lineHeight: 1.35,
              marginTop: '2px',
            }}
          >
            {subtitle}
          </span>
        )}
      </span>
      {trailing && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            flexShrink: 0,
            fontSize: '13px',
            color: 'var(--tx-2)',
          }}
        >
          {trailing}
        </span>
      )}
      {chevron && (
        <ChevronRight
          size={18}
          strokeWidth={1.75}
          aria-hidden="true"
          style={{ color: 'var(--tx-3)', flexShrink: 0 }}
        />
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={`dh-list-row ${className}`.trim()}
        onClick={onClick}
        disabled={disabled}
        style={style}
        aria-label={ariaLabel}
      >
        {inner}
      </button>
    );
  }

  return (
    <div className={`dh-list-row ${className}`.trim()} style={style}>
      {inner}
    </div>
  );
};

export const ListGroup: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className = '',
  children,
  ...rest
}) => (
  <div className={`dh-list-group ${className}`.trim()} {...rest}>
    {children}
  </div>
);
