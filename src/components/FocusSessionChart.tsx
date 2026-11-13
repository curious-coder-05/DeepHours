import React from 'react';
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CHART_THEME } from '../utils/uiHelpers';

export interface FocusSessionChartProps {
  data: Array<{ name: string; minutes: number }>;
  chartDomainMax: number;
  targetMins: number;
  fillColor: string;
}

export const FocusSessionChart: React.FC<FocusSessionChartProps> = ({
  data,
  chartDomainMax,
  targetMins,
  fillColor,
}) => (
  <ResponsiveContainer width="100%" height="100%">
    <BarChart
      data={data}
      layout="vertical"
      margin={{ top: 4, right: 10, left: 4, bottom: 4 }}
    >
      <XAxis type="number" domain={[0, chartDomainMax]} hide />
      <YAxis type="category" dataKey="name" hide />
      <Tooltip
        cursor={{ fill: 'transparent' }}
        contentStyle={CHART_THEME.tooltipStyle}
        formatter={(value) => [`${Number(value ?? 0)} min`, 'Elapsed']}
        labelFormatter={() => `Target: ${targetMins} min`}
      />
      <Bar
        dataKey="minutes"
        background={{ fill: 'var(--sf-3)', radius: 6 }}
        radius={[6, 6, 6, 6]}
        barSize={14}
        isAnimationActive={false}
      >
        <Cell fill={fillColor} />
      </Bar>
      {targetMins > 0 && (
        <ReferenceLine
          x={targetMins}
          stroke="var(--ok)"
          strokeWidth={2}
          strokeDasharray="3 3"
        />
      )}
    </BarChart>
  </ResponsiveContainer>
);
