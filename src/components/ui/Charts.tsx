import React, { useId, useState } from 'react';

export interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  label?: string;
  showArea?: boolean;
  showEndDot?: boolean;
}

export const Sparkline: React.FC<SparklineProps> = ({
  values,
  width = 110,
  height = 28,
  color = 'var(--ac)',
  label,
  showArea = true,
  showEndDot = true,
}) => {
  const gradId = useId();
  if (!values.length) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-label={label}
      />
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 3;
  const innerW = Math.max(1, width - pad * 2);
  const innerH = Math.max(1, height - pad * 2);

  const coords = values.map((v, i) => ({
    x: values.length === 1 ? width / 2 : pad + (i / (values.length - 1)) * innerW,
    y: pad + innerH - ((v - min) / span) * innerH,
  }));

  const polylinePts = coords.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const first = coords[0];
  const last = coords[coords.length - 1];
  const areaPath =
    coords.length > 1
      ? `M ${first.x.toFixed(1)} ${height - pad} L ${coords
          .map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
          .join(' L ')} L ${last.x.toFixed(1)} ${height - pad} Z`
      : '';

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={!label}
      style={{ overflow: 'visible' }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {showArea && areaPath && <path d={areaPath} fill={`url(#${gradId})`} />}
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={polylinePts}
      />
      {showEndDot && last && (
        <circle cx={last.x} cy={last.y} r="3" fill={color} />
      )}
    </svg>
  );
};

export interface ChartPoint {
  label: string;
  value: number;
  hint?: string;
  color?: string;
}

function buildSmoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(
      1
    )}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

export interface AreaLineChartProps {
  data: ChartPoint[];
  height?: number;
  color?: string;
  goalValue?: number;
  goalLabel?: string;
  valueFormatter?: (v: number) => string;
  ariaLabel?: string;
}

export const AreaLineChart: React.FC<AreaLineChartProps> = ({
  data,
  height = 180,
  color = 'var(--ac)',
  goalValue,
  goalLabel,
  valueFormatter = (v) => String(Math.round(v)),
  ariaLabel = 'Trend chart',
}) => {
  const gradId = useId();
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const w = 360;
  const padL = 42;
  const padR = 14;
  const padT = 16;
  const padB = 28;
  const innerW = w - padL - padR;
  const innerH = height - padT - padB;

  const rawMax = Math.max(
    1,
    goalValue ?? 0,
    ...data.map((d) => d.value)
  );
  const maxVal = rawMax * 1.1;

  const coords = data.map((d, i) => ({
    x: data.length <= 1 ? padL + innerW / 2 : padL + (i / (data.length - 1)) * innerW,
    y: padT + innerH - (Math.max(0, d.value) / maxVal) * innerH,
    point: d,
  }));

  const linePath = buildSmoothPath(coords);
  const areaPath =
    coords.length > 1
      ? `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${(padT + innerH).toFixed(
          1
        )} L ${coords[0].x.toFixed(1)} ${(padT + innerH).toFixed(1)} Z`
      : '';

  const goalY =
    typeof goalValue === 'number' && goalValue >= 0
      ? padT + innerH - (Math.min(maxVal, goalValue) / maxVal) * innerH
      : null;

  const activePoint = activeIdx !== null ? coords[activeIdx] : null;
  const tickStep = Math.max(1, Math.ceil(data.length / 6));

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      {activePoint && (
        <div
          role="status"
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            zIndex: 2,
            background: 'var(--sf-1)',
            border: '1px solid var(--line)',
            borderRadius: '10px',
            padding: '6px 10px',
            fontSize: '13px',
            color: 'var(--tx)',
            boxShadow: 'var(--shadow-card)',
            pointerEvents: 'none',
          }}
        >
          <span style={{ color: 'var(--tx-2)', marginRight: 6 }}>
            {activePoint.point.label}:
          </span>
          <strong className="tabular-nums">
            {valueFormatter(activePoint.point.value)}
          </strong>
          {activePoint.point.hint ? ` · ${activePoint.point.hint}` : ''}
        </div>
      )}

      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${w} ${height}`}
        role="img"
        aria-label={ariaLabel}
        style={{ display: 'block', overflow: 'visible' }}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.32" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Horizontal grid lines */}
        {[0, 0.5, 1].map((frac, idx) => {
          const y = padT + innerH * (1 - frac);
          const tickVal = maxVal * frac;
          return (
            <g key={idx}>
              <line
                x1={padL}
                y1={y}
                x2={w - padR}
                y2={y}
                stroke="var(--line)"
                strokeWidth="1"
              />
              <text
                x={padL - 6}
                y={y + 4}
                textAnchor="end"
                fill="var(--tx-3)"
                fontSize="13"
              >
                {valueFormatter(tickVal)}
              </text>
            </g>
          );
        })}

        {/* Goal reference line */}
        {goalY !== null && (
          <g>
            <line
              x1={padL}
              y1={goalY}
              x2={w - padR}
              y2={goalY}
              stroke="var(--ok)"
              strokeWidth="1.5"
              strokeDasharray="4 4"
            />
            {goalLabel && (
              <text
                x={w - padR}
                y={Math.max(12, goalY - 5)}
                textAnchor="end"
                fill="var(--ok-ink)"
                fontSize="13"
                fontWeight="600"
              >
                {goalLabel}
              </text>
            )}
          </g>
        )}

        {areaPath && <path d={areaPath} fill={`url(#${gradId})`} />}
        {linePath && (
          <path
            d={linePath}
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        )}

        {coords.map((c, idx) => {
          const isSelected = activeIdx === idx;
          return (
            <g key={idx}>
              {idx % tickStep === 0 && (
                <text
                  x={c.x}
                  y={height - 6}
                  textAnchor="middle"
                  fill="var(--tx-2)"
                  fontSize="13"
                >
                  {c.point.label}
                </text>
              )}
              <circle
                cx={c.x}
                cy={c.y}
                r={isSelected ? 5 : 3}
                fill={isSelected ? 'var(--tx)' : color}
                stroke={isSelected ? color : 'none'}
                strokeWidth={isSelected ? 2 : 0}
              />
              <rect
                x={c.x - Math.max(10, innerW / Math.max(2, data.length * 2))}
                y={padT}
                width={Math.max(20, innerW / Math.max(1, data.length))}
                height={innerH}
                fill="transparent"
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setActiveIdx(idx)}
                onMouseLeave={() => setActiveIdx(null)}
                onClick={() => setActiveIdx((cur) => (cur === idx ? null : idx))}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
};

export interface BarChartProps {
  data: ChartPoint[];
  height?: number;
  orientation?: 'vertical' | 'horizontal';
  color?: string;
  goalValue?: number;
  goalLabel?: string;
  valueFormatter?: (v: number) => string;
  ariaLabel?: string;
}

export const BarChart: React.FC<BarChartProps> = ({
  data,
  height = 170,
  orientation = 'vertical',
  color = 'var(--ac)',
  goalValue,
  goalLabel,
  valueFormatter = (v) => String(Math.round(v)),
  ariaLabel = 'Bar chart',
}) => {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  if (orientation === 'horizontal') {
    const rowH = 38;
    const totalH = Math.max(rowH, data.length * rowH + (goalValue ? 24 : 8));
    const maxVal = Math.max(1, goalValue ?? 0, ...data.map((d) => d.value));

    return (
      <div
        role="img"
        aria-label={ariaLabel}
        style={{ display: 'grid', gap: '8px', minHeight: Math.min(height, totalH) }}
      >
        {data.map((item, idx) => {
          const pct = Math.max(0, Math.min(100, (item.value / maxVal) * 100));
          const goalPct =
            typeof goalValue === 'number' && maxVal > 0
              ? Math.max(0, Math.min(100, (goalValue / maxVal) * 100))
              : null;
          const barColor = item.color || color;
          const isActive = activeIdx === idx;
          return (
            <div
              key={`${item.label}-${idx}`}
              style={{ position: 'relative', cursor: 'pointer' }}
              onClick={() => setActiveIdx((cur) => (cur === idx ? null : idx))}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '13px',
                  marginBottom: '4px',
                  gap: '8px',
                }}
              >
                <span style={{ color: 'var(--tx-2)' }}>{item.label}</span>
                <strong className="tabular-nums" style={{ color: 'var(--tx)' }}>
                  {valueFormatter(item.value)}
                  {item.hint ? ` · ${item.hint}` : ''}
                </strong>
              </div>
              <div
                style={{
                  position: 'relative',
                  height: '12px',
                  borderRadius: '99px',
                  background: 'var(--sf-3)',
                  border: '1px solid var(--line)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    borderRadius: '99px',
                    background: barColor,
                    opacity: isActive ? 1 : 0.92,
                    transition: 'width var(--dur-slow) var(--ease-out)',
                  }}
                />
                {goalPct !== null && (
                  <div
                    aria-hidden="true"
                    title={goalLabel}
                    style={{
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      left: `${goalPct}%`,
                      width: '2px',
                      background: 'var(--ok)',
                    }}
                  />
                )}
              </div>
            </div>
          );
        })}
        {goalLabel && typeof goalValue === 'number' && (
          <div style={{ fontSize: '13px', color: 'var(--ok-ink)', textAlign: 'right' }}>
            Target: {goalLabel} ({valueFormatter(goalValue)})
          </div>
        )}
      </div>
    );
  }

  const w = 360;
  const padL = 38;
  const padR = 10;
  const padT = 16;
  const padB = 26;
  const innerW = w - padL - padR;
  const innerH = height - padT - padB;
  const maxVal = Math.max(1, goalValue ?? 0, ...data.map((d) => d.value)) * 1.1;
  const slotW = innerW / Math.max(1, data.length);
  const barW = Math.max(6, Math.min(28, slotW * 0.62));
  const goalY =
    typeof goalValue === 'number' && goalValue >= 0
      ? padT + innerH - (Math.min(maxVal, goalValue) / maxVal) * innerH
      : null;

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      {activeIdx !== null && data[activeIdx] && (
        <div
          role="status"
          style={{
            position: 'absolute',
            top: 2,
            right: 4,
            zIndex: 2,
            background: 'var(--sf-1)',
            border: '1px solid var(--line)',
            borderRadius: '10px',
            padding: '4px 10px',
            fontSize: '13px',
            boxShadow: 'var(--shadow-card)',
            pointerEvents: 'none',
          }}
        >
          <span style={{ color: 'var(--tx-2)', marginRight: 6 }}>
            {data[activeIdx].label}:
          </span>
          <strong className="tabular-nums">{valueFormatter(data[activeIdx].value)}</strong>
        </div>
      )}
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${w} ${height}`}
        role="img"
        aria-label={ariaLabel}
        style={{ display: 'block', overflow: 'visible' }}
      >
        {[0, 0.5, 1].map((frac, idx) => {
          const y = padT + innerH * (1 - frac);
          return (
            <g key={idx}>
              <line x1={padL} y1={y} x2={w - padR} y2={y} stroke="var(--line)" />
              <text x={padL - 6} y={y + 4} textAnchor="end" fill="var(--tx-3)" fontSize="13">
                {valueFormatter(maxVal * frac)}
              </text>
            </g>
          );
        })}

        {goalY !== null && (
          <line
            x1={padL}
            y1={goalY}
            x2={w - padR}
            y2={goalY}
            stroke="var(--ok)"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
        )}

        {data.map((d, idx) => {
          const x = padL + idx * slotW + (slotW - barW) / 2;
          const barH = Math.max(2, (Math.max(0, d.value) / maxVal) * innerH);
          const y = padT + innerH - barH;
          const fill = d.color || color;
          return (
            <g
              key={idx}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setActiveIdx(idx)}
              onMouseLeave={() => setActiveIdx(null)}
              onClick={() => setActiveIdx((cur) => (cur === idx ? null : idx))}
            >
              <rect x={x} y={y} width={barW} height={barH} rx="5" fill={fill} opacity={activeIdx === idx ? 1 : 0.88} />
              {(data.length <= 8 || idx % Math.ceil(data.length / 7) === 0) && (
                <text
                  x={x + barW / 2}
                  y={height - 6}
                  textAnchor="middle"
                  fill="var(--tx-2)"
                  fontSize="13"
                >
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
};

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

export interface DonutChartProps {
  segments: DonutSegment[];
  size?: number;
  strokeWidth?: number;
  centerLabel?: React.ReactNode;
  centerSublabel?: React.ReactNode;
  valueFormatter?: (v: number) => string;
  ariaLabel?: string;
}

export const DonutChart: React.FC<DonutChartProps> = ({
  segments,
  size = 152,
  strokeWidth = 18,
  centerLabel,
  centerSublabel,
  valueFormatter = (v) => String(Math.round(v)),
  ariaLabel = 'Distribution donut chart',
}) => {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const total = segments.reduce((acc, s) => acc + Math.max(0, s.value), 0);
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  let runningPct = 0;

  const activeSeg = activeIdx !== null ? segments[activeIdx] : null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
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
          role="img"
          aria-label={ariaLabel}
          style={{ transform: 'rotate(-90deg)' }}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--sf-2)"
            strokeWidth={strokeWidth}
          />
          {total > 0 &&
            segments.map((seg, idx) => {
              const frac = Math.max(0, seg.value) / total;
              const dashLen = frac * c;
              const offset = -runningPct * c;
              runningPct += frac;
              if (dashLen <= 0.5) return null;
              return (
                <circle
                  key={`${seg.label}-${idx}`}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth={activeIdx === idx ? strokeWidth + 3 : strokeWidth}
                  strokeDasharray={`${Math.max(1, dashLen - 2)} ${c}`}
                  strokeDashoffset={offset}
                  style={{ cursor: 'pointer', transition: 'stroke-width 140ms ease' }}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onMouseLeave={() => setActiveIdx(null)}
                  onClick={() => setActiveIdx((cur) => (cur === idx ? null : idx))}
                />
              );
            })}
        </svg>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: `${strokeWidth + 6}px`,
            textAlign: 'center',
            pointerEvents: 'none',
          }}
        >
          <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--tx)', lineHeight: 1.15 }} className="tabular-nums">
            {activeSeg ? valueFormatter(activeSeg.value) : centerLabel}
          </div>
          {(activeSeg || centerSublabel) && (
            <div
              style={{
                fontSize: '13px',
                color: 'var(--tx-2)',
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {activeSeg ? activeSeg.label : centerSublabel}
            </div>
          )}
        </div>
      </div>

      <div style={{ flex: '1 1 150px', display: 'grid', gap: '6px', minWidth: 0 }}>
        {segments.map((seg, idx) => (
          <button
            key={`${seg.label}-${idx}`}
            type="button"
            onClick={() => setActiveIdx((cur) => (cur === idx ? null : idx))}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              padding: '6px 10px',
              minHeight: '36px',
              background: activeIdx === idx ? 'var(--sf-3)' : 'var(--sf-2)',
              border: '1px solid var(--line)',
              borderRadius: '10px',
              fontSize: '13px',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
              <span
                aria-hidden="true"
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: '50%',
                  background: seg.color,
                  flexShrink: 0,
                }}
              />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {seg.label}
              </span>
            </span>
            <strong className="tabular-nums">{valueFormatter(seg.value)}</strong>
          </button>
        ))}
      </div>
    </div>
  );
};

export interface RadialClock24hProps {
  hourlyMinutes: number[]; // length 24
  size?: number;
  color?: string;
  ariaLabel?: string;
}

export const RadialClock24h: React.FC<RadialClock24hProps> = ({
  hourlyMinutes,
  size = 180,
  color = 'var(--ac)',
  ariaLabel = '24-hour study distribution clock',
}) => {
  const [activeHr, setActiveHr] = useState<number | null>(null);
  const cx = size / 2;
  const cy = size / 2;
  const innerR = size * 0.25;
  const maxBar = size * 0.21;
  const maxVal = Math.max(1, ...hourlyMinutes);

  return (
    <div style={{ display: 'grid', justifyItems: 'center', gap: '6px' }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={ariaLabel}
      >
        <circle cx={cx} cy={cy} r={innerR} fill="var(--sf-2)" stroke="var(--line)" />
        {Array.from({ length: 24 }).map((_, hr) => {
          const val = hourlyMinutes[hr] || 0;
          const angle = ((hr / 24) * 360 - 90) * (Math.PI / 180);
          const len = val > 0 ? Math.max(5, (val / maxVal) * maxBar) : 3;
          const x1 = cx + Math.cos(angle) * (innerR + 4);
          const y1 = cy + Math.sin(angle) * (innerR + 4);
          const x2 = cx + Math.cos(angle) * (innerR + 4 + len);
          const y2 = cy + Math.sin(angle) * (innerR + 4 + len);
          const isHot = activeHr === hr;
          return (
            <line
              key={hr}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={val > 0 ? (isHot ? 'var(--tx)' : color) : 'var(--sf-3)'}
              strokeWidth={isHot ? 6 : 4.5}
              strokeLinecap="round"
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setActiveHr(hr)}
              onMouseLeave={() => setActiveHr(null)}
              onClick={() => setActiveHr((cur) => (cur === hr ? null : hr))}
            />
          );
        })}
        <text
          x={cx}
          y={cy + 4}
          textAnchor="middle"
          fill="var(--tx)"
          fontSize="13"
          fontWeight="600"
        >
          {activeHr !== null
            ? `${String(activeHr).padStart(2, '0')}:00 · ${Math.round(
                hourlyMinutes[activeHr] || 0
              )}m`
            : '24h'}
        </text>
      </svg>
    </div>
  );
};

export interface HeatmapCell {
  key: string;
  label: string;
  level: 0 | 1 | 2 | 3 | 4;
  valueLabel?: string;
}

export interface HeatmapGridProps {
  cells: HeatmapCell[];
  columns?: number;
  onSelectCell?: (cell: HeatmapCell) => void;
  ariaLabel?: string;
}

export const HeatmapGrid: React.FC<HeatmapGridProps> = ({
  cells,
  columns = 12,
  onSelectCell,
  ariaLabel = 'Study consistency heatmap',
}) => {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const activeCell = cells.find((c) => c.key === selectedKey);

  return (
    <div style={{ display: 'grid', gap: '8px' }}>
      <div
        role="grid"
        aria-label={ariaLabel}
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gap: '4px',
        }}
      >
        {cells.map((cell) => {
          const fill =
            cell.level === 0
              ? 'var(--sf-2)'
              : cell.level === 1
                ? 'color-mix(in srgb, var(--ac) 26%, var(--sf-2))'
                : cell.level === 2
                  ? 'color-mix(in srgb, var(--ac) 48%, var(--sf-2))'
                  : cell.level === 3
                    ? 'color-mix(in srgb, var(--ac) 74%, var(--sf-2))'
                    : 'var(--ac)';
          return (
            <button
              key={cell.key}
              type="button"
              aria-label={`${cell.label}${cell.valueLabel ? `: ${cell.valueLabel}` : ''}`}
              onClick={() => {
                setSelectedKey(cell.key);
                onSelectCell?.(cell);
              }}
              style={{
                width: '100%',
                minHeight: '16px',
                aspectRatio: '1 / 1',
                padding: 0,
                borderRadius: '4px',
                background: fill,
                border:
                  selectedKey === cell.key
                    ? '1px solid var(--tx)'
                    : '1px solid var(--line)',
              }}
            />
          );
        })}
      </div>
      {activeCell && (
        <div style={{ fontSize: '13px', color: 'var(--tx-2)' }}>
          <strong style={{ color: 'var(--tx)' }}>{activeCell.label}</strong>
          {activeCell.valueLabel ? ` · ${activeCell.valueLabel}` : ''}
        </div>
      )}
    </div>
  );
};

export interface SemiCircleGaugeProps {
  value: number;
  max: number;
  label?: string;
  sublabel?: string;
  color?: string;
  width?: number;
}

export const SemiCircleGauge: React.FC<SemiCircleGaugeProps> = ({
  value,
  max,
  label,
  sublabel,
  color = 'var(--ac)',
  width = 220,
}) => {
  const height = Math.round(width * 0.56);
  const stroke = 14;
  const r = (width - stroke * 2) / 2;
  const cx = width / 2;
  const cy = height - 10;
  const semiLen = Math.PI * r;
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const offset = semiLen * (1 - pct);

  return (
    <div style={{ display: 'grid', justifyItems: 'center' }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={label ? `${label}: ${Math.round(pct * 100)}%` : 'Progress gauge'}
      >
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke="var(--sf-3)"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={semiLen}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset var(--dur-slow) var(--ease-out)' }}
        />
        {label && (
          <text
            x={cx}
            y={cy - 18}
            textAnchor="middle"
            fill="var(--tx)"
            fontSize="22"
            fontWeight="700"
          >
            {label}
          </text>
        )}
        {sublabel && (
          <text
            x={cx}
            y={cy + 2}
            textAnchor="middle"
            fill="var(--tx-2)"
            fontSize="13"
          >
            {sublabel}
          </text>
        )}
      </svg>
    </div>
  );
};
