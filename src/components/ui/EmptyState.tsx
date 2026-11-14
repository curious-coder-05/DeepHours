import React from 'react';
import { Illustration, type IllustrationName } from './Illustrations';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  illustration?: IllustrationName;
  title: string;
  description?: string;
  action?: React.ReactNode;
  compact?: boolean;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  illustration,
  title,
  description,
  action,
  compact = false,
}) => (
  <div
    style={{
      background: 'var(--sf-1)',
      border: '1px solid var(--line)',
      borderRadius: '16px',
      padding: compact ? '18px 16px' : '36px 24px',
      minHeight: compact ? undefined : '220px',
      textAlign: 'center',
      display: 'grid',
      gap: '10px',
      justifyItems: 'center',
      alignContent: 'center',
    }}
  >
    {illustration ? (
      <div style={{ marginBottom: '2px' }}>
        <Illustration
          name={illustration}
          width={compact ? 104 : 124}
          height={compact ? 74 : 88}
        />
      </div>
    ) : (
      icon && <div style={{ color: 'var(--tx-2)', marginBottom: '2px' }}>{icon}</div>
    )}
    <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--tx)' }}>
      {title}
    </div>
    {description && (
      <div
        style={{
          fontSize: '13px',
          color: 'var(--tx-2)',
          maxWidth: '340px',
          lineHeight: 1.45,
        }}
      >
        {description}
      </div>
    )}
    {action && <div style={{ marginTop: '6px' }}>{action}</div>}
  </div>
);
