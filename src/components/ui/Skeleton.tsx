import React from 'react';

export interface SkeletonProps {
  height?: number | string;
  width?: number | string;
  radius?: number;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  height = 80,
  width = '100%',
  radius = 16,
}) => (
  <div
    aria-hidden="true"
    style={{
      height,
      width,
      borderRadius: radius,
      background: 'var(--sf-2)',
      border: '1px solid var(--line)',
      opacity: 0.72,
    }}
  />
);
