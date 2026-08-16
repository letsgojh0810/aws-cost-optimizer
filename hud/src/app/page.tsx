import { listProjects, getLatestMetrics, getMonthCost } from '@/lib/store-client';
import { ProjectCard } from '@/components/ProjectCard';

export const revalidate = 60;

export default function DashboardPage() {
  const projects = listProjects();

  const projectsWithMetrics = projects.map(p => {
    const latest = getLatestMetrics(p.projectName);
    const monthCost = getMonthCost(p.projectName);
    return { project: p, latest, monthCost };
  });

  const totalCost = projectsWithMetrics.reduce((s, { monthCost }) => s + monthCost, 0);

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      <div className="flex items-center justify-between bg-gray-800 rounded-xl px-5 py-3">
        <span className="text-gray-400 text-sm">이번 달 총 비용</span>
        <span className="text-white font-mono font-semibold">${totalCost.toFixed(2)}</span>
      </div>

      {projects.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <p className="text-xl mb-2">관리 중인 프로젝트가 없습니다</p>
          <p className="text-sm">Claude Code에서 "AWS에 배포해줘"라고 입력해 첫 프로젝트를 배포하세요.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projectsWithMetrics.map(({ project, latest, monthCost }) => (
            <ProjectCard
              key={project.id}
              projectName={project.projectName}
              region={project.region}
              ec2InstanceType={project.ec2InstanceId ? project.tags['EC2Type'] ?? undefined : undefined}
              rdsInstanceType={project.rdsInstanceId ? project.tags['RDSType'] ?? undefined : undefined}
              monthCostUsd={monthCost}
              budgetUsd={project.monthlyBudget}
              cpuAvg7d={latest?.ec2CpuAvg ?? null}
              isRunning={project.ec2InstanceId !== null}
            />
          ))}
        </div>
      )}
    </div>
  );
}
