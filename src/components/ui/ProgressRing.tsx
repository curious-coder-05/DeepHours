import React from 'react';

export interface ProgressRingProps {
  pct: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  children?: React.ReactNode;
}

export const ProgressRing: React.FC<ProgressRingProps> = ({
  pct,
  size = 112,
  strokeWidth = 10,
  color = 'var(--ac)',
  children,
}) => {
  const clamped = Math.max(0, Math.min(100, pct));
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - clamped / 100);

  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}
        aria-hidden="true"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--sf-2)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{
            transition: 'stroke-dashoffset var(--dur-slow) var(--ease-out)',
          }}
        />
      </svg>
      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
        {children}
      </div>
    </div>
  );
};

export interface ConcentricRingSegment {
  id: string;
  value: number;
  color: string;
}

export interface ConcentricProgressRingProps {
  size?: number;
  outerPct: number;
  outerSegments?: ConcentricRingSegment[];
  outerTotal?: number;
  outerStrokeWidth?: number;
  innerPct: number;
  innerStrokeWidth?: number;
  innerColor?: string;
  children?: React.ReactNode;
}

export const ConcentricProgressRing: React.FC<ConcentricProgressRingProps> = ({
  size = 168,
  outerPct,
  outerSegments,
  outerTotal = 0,
  outerStrokeWidth = 12,
  innerPct,
  innerStrokeWidth = 9,
  innerColor = 'var(--ok)',
  children,
}) => {
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = (size - outerStrokeWidth) / 2;
  const cOuter = 2 * Math.PI * rOuter;

  const ringGap = 7;
  const rInner = Math.max(
    18,
    rOuter - outerStrokeWidth / 2 - ringGap - innerStrokeWidth / 2
  );
  const cInner = 2 * Math.PI * rInner;

  const clampedOuterPct = Math.max(0, Math.min(100, outerPct));
  const clampedInnerPct = Math.max(0, Math.min(100, innerPct));
  const innerOffset = cInner * (1 - clampedInnerPct / 100);

  const validSegments = (outerSegments || []).filter((s) => s.value > 0);
  const hasMultiSegments = validSegments.length > 0 && outerTotal > 0;

  let cumulativeFrac = 0;
  const segmentTotalVal = validSegments.reduce((acc, s) => acc + s.value, 0);
  const effectiveDenom = Math.max(outerTotal, segmentTotalVal, 1);

  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}
        aria-hidden="true"
      >
        {/* Outer Ring Track (Daily Study Goal) */}
        <circle
          cx={cx}
          cy={cy}
          r={rOuter}
          fill="none"
          stroke="var(--sf-2)"
          strokeWidth={outerStrokeWidth}
        />

        {hasMultiSegments ? (
          validSegments.map((seg) => {
            const frac = Math.min(1 - cumulativeFrac, seg.value / effectiveDenom);
            if (frac <= 0.002) return null;
            const segLen = frac * cOuter;
            const offset = -cumulativeFrac * cOuter;
            cumulativeFrac += frac;
            return (
              <circle
                key={seg.id}
                cx={cx}
                cy={cy}
                r={rOuter}
                fill="none"
                stroke={seg.color || 'var(--ac)'}
                strokeWidth={outerStrokeWidth}
                strokeLinecap={validSegments.length === 1 ? 'round' : 'butt'}
                strokeDasharray={`${Math.max(2, segLen - (validSegments.length > 1 ? 2.5 : 0))} ${cOuter}`}
                strokeDashoffset={offset}
                style={{
                  transition: 'stroke-dashoffset var(--dur-slow) var(--ease-out)',
                }}
              />
            );
          })
        ) : (
          <circle
            cx={cx}
            cy={cy}
            r={rOuter}
            fill="none"
            stroke={clampedOuterPct >= 100 ? 'var(--ok)' : 'var(--ac)'}
            strokeWidth={outerStrokeWidth}
            strokeLinecap="round"
            strokeDasharray={cOuter}
            strokeDashoffset={cOuter * (1 - clampedOuterPct / 100)}
            style={{
              transition: 'stroke-dashoffset var(--dur-slow) var(--ease-out)',
            }}
          />
        )}

        {/* Inner Ring Track (Habits + Tasks Completion) */}
        <circle
          cx={cx}
          cy={cy}
          r={rInner}
          fill="none"
          stroke="var(--sf-2)"
          strokeWidth={innerStrokeWidth}
        />
        <circle
          cx={cx}
          cy={cy}
          r={rInner}
          fill="none"
          stroke={innerColor}
          strokeWidth={innerStrokeWidth}
          strokeLinecap="round"
          strokeDasharray={cInner}
          strokeDashoffset={innerOffset}
          style={{
            transition: 'stroke-dashoffset var(--dur-slow) var(--ease-out)',
          }}
        />
      </svg>

      <div
        style={{
          position: 'relative',
          zIndex: 1,
          textAlign: 'center',
          maxWidth: rInner * 1.65,
        }}
      >
        {children}
      </div>
    </div>
  );
};
