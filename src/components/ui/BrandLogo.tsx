import React from 'react';

export interface BrandLogoProps {
  size?: number;
  showWordmark?: boolean;
  subtitle?: string;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 36,
  showWordmark = false,
  subtitle,
}) => {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '10px',
        minWidth: 0,
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 40 40"
        fill="none"
        aria-hidden="true"
        style={{ flexShrink: 0 }}
      >
        <rect
          x="1"
          y="1"
          width="38"
          height="38"
          rx="11"
          fill="var(--sf-2)"
          stroke="var(--line-strong, var(--line))"
          strokeWidth="1.25"
        />
        <ellipse
          cx="20"
          cy="20"
          rx="14.5"
          ry="5.8"
          transform="rotate(-24 20 20)"
          stroke="var(--ac)"
          strokeOpacity="0.65"
          strokeWidth="1.5"
        />
        <path
          d="M14.2 10.5H25.8M14.2 29.5H25.8"
          stroke="var(--tx)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M15.4 10.5C15.4 16 20 18 20 20C20 22 15.4 24 15.4 29.5"
          stroke="var(--tx)"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M24.6 10.5C24.6 16 20 18 20 20C20 22 24.6 24 24.6 29.5"
          stroke="var(--tx)"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M17 13H23C22.6 15.8 20 17.8 20 18.7C20 17.8 17.4 15.8 17 13Z"
          fill="var(--ac)"
          fillOpacity="0.92"
        />
        <path d="M17.2 27.8L20 24.4L22.8 27.8H17.2Z" fill="var(--ac)" />
        <circle cx="31.5" cy="13.8" r="2.1" fill="var(--ac)" />
      </svg>

      {showWordmark && (
        <span style={{ minWidth: 0, textAlign: 'left' }}>
          <span
            style={{
              display: 'block',
              fontSize: '16px',
              fontWeight: 700,
              lineHeight: 1.2,
              letterSpacing: '-0.015em',
              color: 'var(--tx)',
            }}
          >
            Deep Hours
          </span>
          {subtitle && (
            <span
              style={{
                display: 'block',
                fontSize: '13px',
                lineHeight: 1.3,
                color: 'var(--tx-2)',
              }}
            >
              {subtitle}
            </span>
          )}
        </span>
      )}
    </span>
  );
};
