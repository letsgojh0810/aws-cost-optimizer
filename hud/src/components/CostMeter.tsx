'use client';

interface CostMeterProps {
  monthCostUsd: number;
  budgetUsd: number | null;
  hourlyRate?: number;
}

export function CostMeter({ monthCostUsd, budgetUsd, hourlyRate }: CostMeterProps) {
  const pct = budgetUsd ? Math.min((monthCostUsd / budgetUsd) * 100, 100) : 0;
  const overBudget = budgetUsd !== null && monthCostUsd > budgetUsd;
  const barColor = overBudget ? 'bg-red-500' : pct > 80 ? 'bg-yellow-500' : 'bg-green-500';

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-400">
        <span>이번 달 ${monthCostUsd.toFixed(2)}</span>
        {budgetUsd && <span>예산 ${budgetUsd}/월</span>}
      </div>
      {budgetUsd && (
        <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
        </div>
      )}
      {hourlyRate !== undefined && (
        <div className="text-xs text-gray-500">시간당 ${hourlyRate.toFixed(4)}</div>
      )}
    </div>
  );
}
