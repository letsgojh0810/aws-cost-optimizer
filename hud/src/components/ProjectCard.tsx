'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CostMeter } from './CostMeter';

interface ProjectCardProps {
  projectName: string;
  region: string;
  ec2InstanceType?: string;
  rdsInstanceType?: string;
  monthCostUsd: number;
  budgetUsd: number | null;
  cpuAvg7d: number | null;
  isRunning: boolean;
}

export function ProjectCard({
  projectName,
  region,
  ec2InstanceType,
  rdsInstanceType,
  monthCostUsd,
  budgetUsd,
  cpuAvg7d,
  isRunning,
}: ProjectCardProps) {
  const router = useRouter();
  const [analyzing, setAnalyzing] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);

  const overBudget = budgetUsd !== null && monthCostUsd > budgetUsd;
  const isIdle = cpuAvg7d !== null && cpuAvg7d < 5;

  const statusDot = !isRunning
    ? 'bg-red-400'
    : overBudget
    ? 'bg-yellow-400'
    : 'bg-green-400';

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setSuggestion(null);
    try {
      await new Promise(r => setTimeout(r, 1200));
      const parts: string[] = [];
      if (isIdle && cpuAvg7d !== null) parts.push(`CPU ${cpuAvg7d}% (7일 평균) — 다운사이징 권장`);
      if (overBudget && budgetUsd !== null) parts.push(`예산 $${budgetUsd} 초과 중 (현재 $${monthCostUsd.toFixed(2)})`);
      setSuggestion(parts.length > 0 ? parts.join(' / ') : '현재 최적화된 상태입니다.');
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-3 hover:border-gray-500 transition-colors">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${statusDot} flex-shrink-0`} />
          <span className="font-semibold text-white truncate">{projectName}</span>
        </div>
        <span className="text-gray-300 font-mono text-sm">${monthCostUsd.toFixed(1)}/월</span>
      </div>

      {/* Instance info */}
      <div className="text-xs text-gray-400">
        {ec2InstanceType && <span>EC2 {ec2InstanceType}</span>}
        {rdsInstanceType && <span> · RDS {rdsInstanceType}</span>}
        {!ec2InstanceType && !rdsInstanceType && <span>{region}</span>}
      </div>

      {/* CPU badge */}
      {cpuAvg7d !== null && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-400">CPU {cpuAvg7d.toFixed(1)}% (7일 평균)</span>
          {isIdle && (
            <span className="bg-yellow-900 text-yellow-300 px-1.5 py-0.5 rounded text-xs">
              ⚠️ 다운사이징 후보
            </span>
          )}
        </div>
      )}

      {/* Cost meter */}
      <CostMeter monthCostUsd={monthCostUsd} budgetUsd={budgetUsd} />

      {/* Suggestion */}
      {suggestion && (
        <div className="text-xs text-blue-300 bg-blue-900/30 rounded p-2 border border-blue-800">
          {suggestion}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => router.push(`/projects/${encodeURIComponent(projectName)}`)}
          className="flex-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 px-3 py-1.5 rounded-lg transition-colors"
        >
          상세보기
        </button>
        <button
          onClick={handleAnalyze}
          disabled={analyzing}
          className="flex-1 text-xs bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition-colors"
        >
          {analyzing ? '분석 중...' : '내려도 돼?'}
        </button>
      </div>
    </div>
  );
}
