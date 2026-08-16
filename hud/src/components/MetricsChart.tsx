'use client';

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

interface DataPoint {
  collectedAt: string;
  ec2CpuAvg: number | null;
  costUsd: number | null;
}

interface MetricsChartProps {
  data: DataPoint[];
  metric: 'cpu' | 'cost';
}

export function MetricsChart({ data, metric }: MetricsChartProps) {
  const chartData = data.map(d => ({
    time: new Date(d.collectedAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: 'numeric' }),
    value: metric === 'cpu' ? (d.ec2CpuAvg ?? 0) : (d.costUsd ?? 0),
  }));

  const label = metric === 'cpu' ? 'CPU %' : 'Cost $';
  const color = metric === 'cpu' ? '#34d399' : '#60a5fa';

  return (
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#9ca3af' }} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} />
        <Tooltip
          contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: 6 }}
          labelStyle={{ color: '#d1d5db' }}
          itemStyle={{ color }}
        />
        <Line type="monotone" dataKey="value" stroke={color} dot={false} strokeWidth={2} name={label} />
      </LineChart>
    </ResponsiveContainer>
  );
}
