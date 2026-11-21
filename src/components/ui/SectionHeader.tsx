import React from 'react';

export interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  subtitle,
  action,
}) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      marginBottom: '8px',
    }}
  >
    <div style={{ minWidth: 0 }}>
      <h2 className="dh-eyebrow">{title}</h2>
      {subtitle && (
        <div style={{ fontSize: '13px', color: 'var(--tx-2)', marginTop: '3px' }}>
          {subtitle}
        </div>
      )}
    </div>
    {action && (
      <div style={{ flexShrink: 0, color: 'var(--tx-2)' }}>{action}</div>
    )}
  </div>
);
