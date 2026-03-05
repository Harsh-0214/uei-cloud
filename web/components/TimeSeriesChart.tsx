'use client';

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

interface LineConfig {
  key: string;
  label: string;
  color: string;
  unit: string;
}

interface Props {
  data: Record<string, unknown>[];
  title: string;
  lines: LineConfig[];
}

export default function TimeSeriesChart({ data, title, lines }: Props) {
  const formatted = data.map((d) => ({
    ...d,
    _label: new Date(d.time as string).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  }));

  const unit = lines[0]?.unit ?? '';

  return (
    <div className="bg-slate-900 rounded-xl p-5 border border-slate-700">
      <h3 className="text-slate-300 text-sm font-semibold mb-4">{title}</h3>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={formatted} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="_label"
            tick={{ fill: '#64748b', fontSize: 11 }}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fill: '#64748b', fontSize: 11 }}
            unit={unit}
            width={55}
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px' }}
            labelStyle={{ color: '#94a3b8', fontSize: 12 }}
            itemStyle={{ color: '#e2e8f0', fontSize: 12 }}
          />
          {lines.length > 1 && <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />}
          {lines.map((l) => (
            <Line
              key={l.key}
              type="monotone"
              dataKey={l.key}
              name={l.label}
              stroke={l.color}
              dot={false}
              strokeWidth={2}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
