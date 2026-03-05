interface Props {
  label: string;
  value: string | number;
  unit?: string;
  highlight?: 'normal' | 'warning' | 'danger' | 'success';
  showBar?: boolean;
  barValue?: number; // 0–100
}

export default function MetricCard({ label, value, unit, highlight = 'normal', showBar, barValue }: Props) {
  const borderClass = {
    normal: 'border-slate-700',
    warning: 'border-yellow-500',
    danger: 'border-red-500',
    success: 'border-green-600',
  }[highlight];

  const barColor =
    barValue === undefined ? 'bg-cyan-500'
    : barValue >= 50 ? 'bg-green-500'
    : barValue >= 20 ? 'bg-yellow-500'
    : 'bg-red-500';

  return (
    <div className={`bg-slate-900 rounded-xl p-4 border ${borderClass} flex flex-col gap-1`}>
      <span className="text-slate-400 text-xs uppercase tracking-wider">{label}</span>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold text-slate-100">{value}</span>
        {unit && <span className="text-sm text-slate-400">{unit}</span>}
      </div>
      {showBar && barValue !== undefined && (
        <div className="mt-2 h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            className={`h-full ${barColor} rounded-full transition-all duration-500`}
            style={{ width: `${Math.min(100, Math.max(0, barValue))}%` }}
          />
        </div>
      )}
    </div>
  );
}
