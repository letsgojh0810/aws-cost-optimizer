export type TrafficScale = 'personal' | 'team' | 'production';

export interface ProjectRecord {
  id: string;
  projectName: string;
  repoPath: string | null;
  region: string;
  ec2InstanceId: string | null;
  rdsInstanceId: string | null;
  albDnsName: string | null;
  vpcId: string | null;
  monthlyBudget: number | null;
  trafficScale: TrafficScale | null;
  deployedAt: string | null;
  lastUpdated: string | null;
  tags: Record<string, string>;
}

export interface MetricRecord {
  id: string;
  projectName: string;
  collectedAt: string;
  periodHours: number;
  ec2CpuAvg: number | null;
  ec2CpuP95: number | null;
  ec2MemAvg: number | null;
  ec2NetInMb: number | null;
  ec2NetOutMb: number | null;
  rdsCpuAvg: number | null;
  rdsConnections: number | null;
  costUsd: number | null;
}

export interface AggregatedMetrics {
  projectName: string;
  periodDays: number;
  ec2CpuAvg: number;
  ec2CpuP95: number;
  ec2NetInMbTotal: number;
  ec2NetOutMbTotal: number;
  totalCostUsd: number;
  dataPoints: number;
}
