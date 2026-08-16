import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getProject, getMetrics, getMonthCost } from '@/lib/store-client';
import { MetricsChart } from '@/components/MetricsChart';
import { CostMeter } from '@/components/CostMeter';

export const revalidate = 60;

interface PageProps {
  params: { name: string };
  searchParams: { days?: string };
}

export default function ProjectDetailPage({ params, searchParams }: PageProps) {
  const projectName = decodeURIComponent(params.name);
  const days = parseInt(searchParams.days ?? '7', 10);

  const project = getProject(projectName);
  if (!project) notFound();

  const metrics = getMetrics(projectName, days);
  const monthCost = getMonthCost(projectName);
  const hourlyRate = monthCost / (new Date().getDate() * 24);

  const deployedAt = project.deployedAt ? new Date(project.deployedAt) : null;
  const uptimeMs = deployedAt ? Date.now() - deployedAt.getTime() : 0;
  const uptimeDays = Math.floor(uptimeMs / (1000 * 3600 * 24));
  const uptimeHours = Math.floor((uptimeMs % (1000 * 3600 * 24)) / (1000 * 3600));

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Back + title */}
      <div className="flex items-center gap-3">
        <Link href="/" className="text-gray-400 hover:text-white text-sm">← 대시보드</Link>
        <span className="text-gray-600">/</span>
        <h1 className="text-xl font-bold text-white">{projectName}</h1>
        <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded">{project.region}</span>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: '이번 달 비용', value: `$${monthCost.toFixed(2)}` },
          { label: '시간당', value: `$${hourlyRate.toFixed(4)}` },
          { label: '가동 시간', value: deployedAt ? `${uptimeDays}일 ${uptimeHours}시간` : '-' },
          { label: '트래픽 규모', value: project.trafficScale ?? '-' },
        ].map(({ label, value }) => (
          <div key={label} className="bg-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-400 mb-1">{label}</p>
            <p className="text-lg font-semibold text-white font-mono">{value}</p>
          </div>
        ))}
      </div>

      {/* Budget meter */}
      {project.monthlyBudget && (
        <div className="bg-gray-800 rounded-xl p-4">
          <p className="text-sm text-gray-400 mb-2">예산 현황</p>
          <CostMeter monthCostUsd={monthCost} budgetUsd={project.monthlyBudget} hourlyRate={hourlyRate} />
        </div>
      )}

      {/* Charts */}
      <div className="bg-gray-800 rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-300">CPU 사용률</h2>
          <div className="flex gap-2 text-xs">
            {[7, 30].map(d => (
              <Link
                key={d}
                href={`/projects/${encodeURIComponent(projectName)}?days=${d}`}
                className={`px-2 py-1 rounded ${days === d ? 'bg-indigo-700 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                {d}일
              </Link>
            ))}
          </div>
        </div>
        <MetricsChart data={metrics} metric="cpu" />
      </div>

      <div className="bg-gray-800 rounded-xl p-4 space-y-2">
        <h2 className="text-sm font-semibold text-gray-300">시간별 비용</h2>
        <MetricsChart data={metrics} metric="cost" />
      </div>

      {/* Resource details */}
      <div className="bg-gray-800 rounded-xl p-4 space-y-2">
        <h2 className="text-sm font-semibold text-gray-300 mb-3">리소스 정보</h2>
        <div className="grid grid-cols-2 gap-2 text-sm">
          {project.ec2InstanceId && (
            <><span className="text-gray-400">EC2 Instance</span><span className="text-white font-mono">{project.ec2InstanceId}</span></>
          )}
          {project.rdsInstanceId && (
            <><span className="text-gray-400">RDS Instance</span><span className="text-white font-mono">{project.rdsInstanceId}</span></>
          )}
          {project.vpcId && (
            <><span className="text-gray-400">VPC</span><span className="text-white font-mono">{project.vpcId}</span></>
          )}
          {project.albDnsName && (
            <><span className="text-gray-400">ALB DNS</span><span className="text-white font-mono text-xs truncate">{project.albDnsName}</span></>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        <button className="bg-gray-700 hover:bg-gray-600 text-gray-200 px-4 py-2 rounded-lg text-sm transition-colors">
          일시정지
        </button>
        <button className="bg-gray-700 hover:bg-gray-600 text-gray-200 px-4 py-2 rounded-lg text-sm transition-colors">
          스케줄 설정
        </button>
        <button className="bg-indigo-700 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm transition-colors">
          사이즈 조정 제안 보기
        </button>
      </div>
    </div>
  );
}
