import React from 'react';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
}) => (
  <div
    style={{
      background: 'var(--sf-1)',
      border: '1px solid var(--line)',
      borderRadius: '16px',
      padding: '24px 20px',
      textAlign: 'center',
      display: 'grid',
      gap: '8px',
      justifyItems: 'center',
    }}
  >
    {icon && (
      <div style={{ color: 'var(--tx-2)', marginBottom: '2px' }}>{icon}</div>
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
