import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  padding?: 'compact' | 'normal';
}

export const Card: React.FC<CardProps> = ({
  padding = 'normal',
  className = '',
  style,
  children,
  ...rest
}) => {
  return (
    <div
      className={`dh-card ${className}`.trim()}
      style={{
        padding: padding === 'compact' ? '16px' : '20px',
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
};
