import React from 'react';

export type IllustrationName =
  | 'noSyllabus'
  | 'noSessions'
  | 'noTasks'
  | 'signedOutCommunity'
  | 'noMocks'
  | 'noMistakes'
  | 'noDoubts'
  | 'noPyqs';

export interface IllustrationProps {
  name: IllustrationName;
  width?: number;
  height?: number;
}

export const Illustration: React.FC<IllustrationProps> = ({
  name,
  width = 124,
  height = 88,
}) => {
  const strokeBase = 'var(--tx-2)';
  const strokeSoft = 'var(--line-strong, rgba(255,255,255,0.22))';

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 124 88"
      fill="none"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      {/* Subtle orbital ambient ring behind every illustration */}
      <circle
        cx="62"
        cy="44"
        r="34"
        fill="var(--ac-soft)"
        stroke="var(--ac)"
        strokeOpacity="0.22"
        strokeWidth="1"
        strokeDasharray="3 4"
      />

      {name === 'noSyllabus' && (
        <g strokeLinecap="round" strokeLinejoin="round">
          <path
            d="M28 24 C42 20, 54 22, 62 28 C70 22, 82 20, 96 24 V66 C82 62, 70 64, 62 70 C54 64, 42 62, 28 66 Z"
            fill="var(--sf-2)"
            stroke={strokeBase}
            strokeWidth="1.75"
          />
          <line x1="62" y1="28" x2="62" y2="70" stroke={strokeSoft} strokeWidth="1.5" />
          <line x1="36" y1="36" x2="54" y2="38" stroke={strokeSoft} strokeWidth="1.5" />
          <line x1="36" y1="45" x2="52" y2="47" stroke={strokeSoft} strokeWidth="1.5" />
          <path d="M72 36 H88 M72 45 H84" stroke={strokeSoft} strokeWidth="1.5" />
          <path d="M79 18 V33 L83.5 30 L88 33 V18 Z" fill="var(--ac)" stroke="var(--ac)" strokeWidth="1.2" />
          <circle cx="94" cy="20" r="3" fill="var(--ac)" />
        </g>
      )}

      {name === 'noSessions' && (
        <g strokeLinecap="round" strokeLinejoin="round">
          <line x1="44" y1="20" x2="80" y2="20" stroke={strokeBase} strokeWidth="2" />
          <line x1="44" y1="68" x2="80" y2="68" stroke={strokeBase} strokeWidth="2" />
          <path
            d="M48 20 C48 34, 62 40, 62 44 C62 48, 48 54, 48 68"
            stroke={strokeBase}
            strokeWidth="1.75"
          />
          <path
            d="M76 20 C76 34, 62 40, 62 44 C62 48, 76 54, 76 68"
            stroke={strokeBase}
            strokeWidth="1.75"
          />
          <path d="M53 27 H71 C70 33 62 38 62 40 C62 38 54 33 53 27 Z" fill="var(--ac)" fillOpacity="0.85" />
          <path d="M54 63 L62 54 L70 63 Z" fill="var(--ac)" />
          <ellipse cx="62" cy="44" rx="28" ry="10" transform="rotate(-18 62 44)" stroke="var(--ac)" strokeWidth="1.4" strokeOpacity="0.7" />
        </g>
      )}

      {name === 'noTasks' && (
        <g strokeLinecap="round" strokeLinejoin="round">
          <rect
            x="34"
            y="18"
            width="56"
            height="54"
            rx="10"
            fill="var(--sf-2)"
            stroke={strokeBase}
            strokeWidth="1.75"
          />
          <circle cx="46" cy="34" r="4.5" stroke="var(--ac)" strokeWidth="1.75" />
          <path d="M44 34 L45.6 35.8 L48.8 32" stroke="var(--ac)" strokeWidth="1.5" />
          <line x1="56" y1="34" x2="78" y2="34" stroke={strokeBase} strokeWidth="1.6" />
          <circle cx="46" cy="48" r="4.5" stroke={strokeSoft} strokeWidth="1.5" />
          <line x1="56" y1="48" x2="75" y2="48" stroke={strokeSoft} strokeWidth="1.5" />
          <circle cx="46" cy="60" r="4.5" stroke={strokeSoft} strokeWidth="1.5" />
          <line x1="56" y1="60" x2="70" y2="60" stroke={strokeSoft} strokeWidth="1.5" />
          <circle cx="88" cy="20" r="4" fill="var(--ac)" />
        </g>
      )}

      {name === 'signedOutCommunity' && (
        <g strokeLinecap="round" strokeLinejoin="round">
          <circle cx="62" cy="36" r="10" fill="var(--sf-2)" stroke="var(--ac)" strokeWidth="1.75" />
          <path
            d="M45 62 C45 53, 52 48, 62 48 C72 48, 79 53, 79 62"
            fill="var(--sf-2)"
            stroke="var(--ac)"
            strokeWidth="1.75"
          />
          <circle cx="34" cy="40" r="6" stroke={strokeSoft} strokeWidth="1.5" />
          <circle cx="90" cy="40" r="6" stroke={strokeSoft} strokeWidth="1.5" />
          <path d="M26 57 C27 51, 31 48, 36 48" stroke={strokeSoft} strokeWidth="1.5" />
          <path d="M98 57 C97 51, 93 48, 88 48" stroke={strokeSoft} strokeWidth="1.5" />
          <circle cx="84" cy="22" r="3" fill="var(--ac)" />
        </g>
      )}

      {name === 'noMocks' && (
        <g strokeLinecap="round" strokeLinejoin="round">
          <rect
            x="30"
            y="22"
            width="64"
            height="46"
            rx="8"
            fill="var(--sf-2)"
            stroke={strokeBase}
            strokeWidth="1.75"
          />
          <path d="M40 56 L53 45 L64 50 L82 32" stroke="var(--ac)" strokeWidth="2.2" />
          <circle cx="82" cy="32" r="3.5" fill="var(--ac)" />
          <line x1="40" y1="58" x2="84" y2="58" stroke={strokeSoft} strokeWidth="1.5" />
          <circle cx="53" cy="45" r="2.2" fill="var(--tx)" />
          <circle cx="64" cy="50" r="2.2" fill="var(--tx)" />
        </g>
      )}

      {name === 'noMistakes' && (
        <g strokeLinecap="round" strokeLinejoin="round">
          <circle cx="57" cy="41" r="17" fill="var(--sf-2)" stroke={strokeBase} strokeWidth="1.75" />
          <line x1="70" y1="54" x2="84" y2="68" stroke={strokeBase} strokeWidth="2.5" />
          <path d="M50 41 L55 46 L65 36" stroke="var(--ac)" strokeWidth="2.2" />
          <circle cx="82" cy="24" r="3" fill="var(--ac)" />
        </g>
      )}

      {name === 'noDoubts' && (
        <g strokeLinecap="round" strokeLinejoin="round">
          <path
            d="M48 42 C48 33, 54 27, 62 27 C70 27, 76 33, 76 42 C76 48, 71 51, 69 56 H55 C53 51, 48 48, 48 42 Z"
            fill="var(--sf-2)"
            stroke={strokeBase}
            strokeWidth="1.75"
          />
          <line x1="56" y1="62" x2="68" y2="62" stroke={strokeBase} strokeWidth="1.75" />
          <line x1="58" y1="67" x2="66" y2="67" stroke={strokeSoft} strokeWidth="1.75" />
          <path d="M62 17 V21 M39 39 H35 M89 39 H85 M45 24 L48 27 M79 24 L76 27" stroke="var(--ac)" strokeWidth="1.75" />
          <path d="M58 44 L61 47 L67 39" stroke="var(--ac)" strokeWidth="1.8" />
        </g>
      )}

      {name === 'noPyqs' && (
        <g strokeLinecap="round" strokeLinejoin="round">
          <rect x="34" y="28" width="56" height="40" rx="8" fill="var(--sf-2)" stroke={strokeBase} strokeWidth="1.75" />
          <path d="M34 36 H90" stroke={strokeSoft} strokeWidth="1.5" />
          <path d="M40 22 H60 L65 28" stroke={strokeBase} strokeWidth="1.75" />
          <rect x="44" y="44" width="18" height="6" rx="3" fill="var(--ac)" />
          <line x1="44" y1="56" x2="78" y2="56" stroke={strokeSoft} strokeWidth="1.6" />
          <circle cx="84" cy="22" r="3" fill="var(--ac)" />
        </g>
      )}
    </svg>
  );
};
