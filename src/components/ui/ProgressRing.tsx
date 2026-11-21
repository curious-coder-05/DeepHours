import React, { useId } from 'react';

export interface ProgressRingProps {
  /** 0..100 */
  value: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
  label?: string;
  children?: React.ReactNode;
  className?: string;
}

export const ProgressRing: React.FC<ProgressRingProps> = ({
  value,
  size = 120,
  strokeWidth = 10,
  color,
  trackColor = 'var(--ring-track, #12151C)',
  label,
  children,
  className = '',
}) => {
  const uid = useId().replace(/:/g, '');
  const gradId = `dh-ring-gold-${uid}`;
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const r = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - clamped / 100);
  const useMoltenGradient = !color;
  const strokePaint = useMoltenGradient ? `url(#${gradId})` : color;

  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`.trim()}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
        style={{ overflow: 'visible' }}
      >
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#EA580C" />
            <stop offset="52%" stopColor="#F59E0B" />
            <stop offset="100%" stopColor="#FCD34D" />
          </linearGradient>
        </defs>
        {/* Machined obsidian channel track */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        {/* Crisp recessed inner rim stroke */}
        <circle
          cx={cx}
          cy={cy}
          r={Math.max(1, r - strokeWidth / 2 + 0.5)}
          fill="none"
          stroke="var(--ring-track-rim, rgba(255, 255, 255, 0.06))"
          strokeWidth={1}
        />
        {/* Active progress arc */}
        {clamped > 0 && (
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={strokePaint}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${cx} ${cy})`}
            style={{
              transition: 'stroke-dashoffset 0.55s cubic-bezier(0.22, 1, 0.36, 1)',
              filter: useMoltenGradient
                ? 'drop-shadow(0 0 7px rgba(245, 158, 11, 0.35))'
                : undefined,
            }}
          />
        )}
        {/* 12 o'clock calibration pip at 0% */}
        {clamped <= 0 && (
          <g>
            <circle
              cx={cx}
              cy={cy - r}
              r={Math.max(3.5, strokeWidth * 0.42)}
              fill="rgba(245, 158, 11, 0.24)"
            />
            <circle
              cx={cx}
              cy={cy - r}
              r={Math.max(2.2, strokeWidth * 0.24)}
              fill="#F59E0B"
            />
          </g>
        )}
      </svg>
      {children && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            pointerEvents: 'none',
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
};

export interface ConcentricRingSegment {
  id: string;
  value: number;
  color: string;
}

export interface ConcentricProgressRingProps {
  /** Outer ring 0..100 (e.g. study goal %) */
  outerPct: number;
  /** Optional subject breakdown segments for the outer ring */
  outerSegments?: ConcentricRingSegment[];
  /** Total reference value for outerSegments (defaults to sum of segments) */
  outerTotal?: number;
  /** Inner ring 0..100 (e.g. habits/tasks completion %) */
  innerPct: number;
  size?: number;
  outerStroke?: number;
  innerStroke?: number;
  gap?: number;
  outerColor?: string;
  innerColor?: string;
  children?: React.ReactNode;
}

export const ConcentricProgressRing: React.FC<ConcentricProgressRingProps> = ({
  outerPct,
  outerSegments,
  outerTotal,
  innerPct,
  size = 164,
  outerStroke = 10,
  innerStroke = 7,
  gap = 7,
  outerColor,
  innerColor,
  children,
}) => {
  const uid = useId().replace(/:/g, '');
  const outerGradId = `dh-concentric-gold-${uid}`;
  const innerGradId = `dh-concentric-emerald-${uid}`;

  const clampedOuter = Math.max(
    0,
    Math.min(100, Number.isFinite(outerPct) ? outerPct : 0)
  );
  const clampedInner = Math.max(
    0,
    Math.min(100, Number.isFinite(innerPct) ? innerPct : 0)
  );

  const cx = size / 2;
  const cy = size / 2;
  const outerR = (size - outerStroke) / 2;
  const innerR = outerR - outerStroke / 2 - gap - innerStroke / 2;
  const outerC = 2 * Math.PI * outerR;
  const innerC = 2 * Math.PI * innerR;

  const validSegments = (outerSegments || []).filter((s) => s.value > 0);
  const segSum = validSegments.reduce((acc, s) => acc + s.value, 0);
  const denom = Math.max(outerTotal || segSum, segSum, 1);

  const useOuterGoldGradient = !outerColor;
  const useInnerEmeraldGradient = !innerColor || innerColor === 'var(--ok)';

  let runningLen = 0;

  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
      role="img"
      aria-label={`Study progress ${Math.round(clampedOuter)}%, daily habits ${Math.round(clampedInner)}%`}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
        style={{ overflow: 'visible' }}
      >
        <defs>
          <linearGradient id={outerGradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#EA580C" />
            <stop offset="52%" stopColor="#F59E0B" />
            <stop offset="100%" stopColor="#FCD34D" />
          </linearGradient>
          <linearGradient id={innerGradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#059669" />
            <stop offset="52%" stopColor="#10B981" />
            <stop offset="100%" stopColor="#34D399" />
          </linearGradient>
        </defs>

        {/* Outer track: machined obsidian channel + crisp inner rim */}
        <circle
          cx={cx}
          cy={cy}
          r={outerR}
          fill="none"
          stroke="var(--ring-track, #12151C)"
          strokeWidth={outerStroke}
        />
        <circle
          cx={cx}
          cy={cy}
          r={Math.max(1, outerR - outerStroke / 2 + 0.5)}
          fill="none"
          stroke="var(--ring-track-rim, rgba(255, 255, 255, 0.06))"
          strokeWidth={1}
        />

        {/* Outer active arc(s) */}
        {validSegments.length > 0 ? (
          validSegments.map((seg) => {
            const frac = Math.min(1, seg.value / denom);
            const segLen = Math.max(2, frac * outerC);
            const dashOffset = -runningLen;
            runningLen += segLen;
            return (
              <circle
                key={seg.id}
                cx={cx}
                cy={cy}
                r={outerR}
                fill="none"
                stroke={seg.color}
                strokeWidth={outerStroke}
                strokeLinecap="round"
                strokeDasharray={`${Math.max(0, segLen - 1.5)} ${outerC}`}
                strokeDashoffset={dashOffset}
                transform={`rotate(-90 ${cx} ${cy})`}
                style={{
                  transition: 'stroke-dasharray 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
                }}
              />
            );
          })
        ) : clampedOuter > 0 ? (
          <circle
            cx={cx}
            cy={cy}
            r={outerR}
            fill="none"
            stroke={useOuterGoldGradient ? `url(#${outerGradId})` : outerColor}
            strokeWidth={outerStroke}
            strokeLinecap="round"
            strokeDasharray={outerC}
            strokeDashoffset={outerC * (1 - clampedOuter / 100)}
            transform={`rotate(-90 ${cx} ${cy})`}
            style={{
              transition: 'stroke-dashoffset 0.55s cubic-bezier(0.22, 1, 0.36, 1)',
              filter: useOuterGoldGradient
                ? 'drop-shadow(0 0 8px rgba(245, 158, 11, 0.35))'
                : undefined,
            }}
          />
        ) : null}

        {/* Crisp 12 o'clock amber calibration pip when outer progress is 0% */}
        {validSegments.length === 0 && clampedOuter <= 0 && (
          <g data-testid="ring-origin-pip">
            <circle
              cx={cx}
              cy={cy - outerR}
              r={Math.max(4, outerStroke * 0.44)}
              fill="rgba(245, 158, 11, 0.24)"
            />
            <circle
              cx={cx}
              cy={cy - outerR}
              r={Math.max(2.4, outerStroke * 0.25)}
              fill="#F59E0B"
            />
          </g>
        )}

        {/* Inner track (Habits): machined obsidian channel + crisp inner rim */}
        <circle
          cx={cx}
          cy={cy}
          r={innerR}
          fill="none"
          stroke="var(--ring-track, #12151C)"
          strokeWidth={innerStroke}
        />
        <circle
          cx={cx}
          cy={cy}
          r={Math.max(1, innerR - innerStroke / 2 + 0.5)}
          fill="none"
          stroke="var(--ring-track-rim, rgba(255, 255, 255, 0.06))"
          strokeWidth={1}
        />

        {/* Inner active arc (vivid emerald gradient) */}
        {clampedInner > 0 && (
          <circle
            cx={cx}
            cy={cy}
            r={innerR}
            fill="none"
            stroke={useInnerEmeraldGradient ? `url(#${innerGradId})` : innerColor}
            strokeWidth={innerStroke}
            strokeLinecap="round"
            strokeDasharray={innerC}
            strokeDashoffset={innerC * (1 - clampedInner / 100)}
            transform={`rotate(-90 ${cx} ${cy})`}
            style={{
              transition: 'stroke-dashoffset 0.55s cubic-bezier(0.22, 1, 0.36, 1)',
              filter: useInnerEmeraldGradient
                ? 'drop-shadow(0 0 6px rgba(16, 185, 129, 0.3))'
                : undefined,
            }}
          />
        )}
      </svg>
      {children && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            pointerEvents: 'none',
            padding: 18,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
};
