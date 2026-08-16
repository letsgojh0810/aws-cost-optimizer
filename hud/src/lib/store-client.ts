import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';

const DB_PATH = join(homedir(), '.aws-cost-optimizer', 'state.db');

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
  trafficScale: string | null;
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

function openDb(): Database.Database | null {
  try {
    return new Database(DB_PATH, { readonly: true, fileMustExist: true });
  } catch {
    return null;
  }
}

function rowToProject(row: Record<string, unknown>): ProjectRecord {
  return {
    id: row['id'] as string,
    projectName: row['project_name'] as string,
    repoPath: (row['repo_path'] as string | null) ?? null,
    region: (row['region'] as string) ?? 'ap-northeast-2',
    ec2InstanceId: (row['ec2_instance_id'] as string | null) ?? null,
    rdsInstanceId: (row['rds_instance_id'] as string | null) ?? null,
    albDnsName: (row['alb_dns_name'] as string | null) ?? null,
    vpcId: (row['vpc_id'] as string | null) ?? null,
    monthlyBudget: (row['monthly_budget'] as number | null) ?? null,
    trafficScale: (row['traffic_scale'] as string | null) ?? null,
    deployedAt: (row['deployed_at'] as string | null) ?? null,
    lastUpdated: (row['last_updated'] as string | null) ?? null,
    tags: JSON.parse((row['tags'] as string | null) ?? '{}') as Record<string, string>,
  };
}

function rowToMetric(row: Record<string, unknown>): MetricRecord {
  return {
    id: row['id'] as string,
    projectName: row['project_name'] as string,
    collectedAt: row['collected_at'] as string,
    periodHours: (row['period_hours'] as number) ?? 1,
    ec2CpuAvg: (row['ec2_cpu_avg'] as number | null) ?? null,
    ec2CpuP95: (row['ec2_cpu_p95'] as number | null) ?? null,
    ec2MemAvg: (row['ec2_mem_avg'] as number | null) ?? null,
    ec2NetInMb: (row['ec2_net_in_mb'] as number | null) ?? null,
    ec2NetOutMb: (row['ec2_net_out_mb'] as number | null) ?? null,
    rdsCpuAvg: (row['rds_cpu_avg'] as number | null) ?? null,
    rdsConnections: (row['rds_connections'] as number | null) ?? null,
    costUsd: (row['cost_usd'] as number | null) ?? null,
  };
}

export function listProjects(): ProjectRecord[] {
  const db = openDb();
  if (!db) return [];
  try {
    const rows = db.prepare('SELECT * FROM projects ORDER BY last_updated DESC').all() as Record<string, unknown>[];
    return rows.map(rowToProject);
  } finally {
    db.close();
  }
}

export function getProject(projectName: string): ProjectRecord | null {
  const db = openDb();
  if (!db) return null;
  try {
    const row = db.prepare('SELECT * FROM projects WHERE project_name = ?').get(projectName) as Record<string, unknown> | undefined;
    return row ? rowToProject(row) : null;
  } finally {
    db.close();
  }
}

export function getMetrics(projectName: string, days = 7): MetricRecord[] {
  const db = openDb();
  if (!db) return [];
  try {
    const fromDate = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    const rows = db.prepare(
      'SELECT * FROM metrics WHERE project_name = ? AND collected_at >= ? ORDER BY collected_at ASC'
    ).all(projectName, fromDate) as Record<string, unknown>[];
    return rows.map(rowToMetric);
  } finally {
    db.close();
  }
}

export function getLatestMetrics(projectName: string): MetricRecord | null {
  const db = openDb();
  if (!db) return null;
  try {
    const row = db.prepare(
      'SELECT * FROM metrics WHERE project_name = ? ORDER BY collected_at DESC LIMIT 1'
    ).get(projectName) as Record<string, unknown> | undefined;
    return row ? rowToMetric(row) : null;
  } finally {
    db.close();
  }
}

export function getMonthCost(projectName: string): number {
  const db = openDb();
  if (!db) return 0;
  try {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const result = db.prepare(
      'SELECT SUM(cost_usd) as total FROM metrics WHERE project_name = ? AND collected_at >= ?'
    ).get(projectName, startOfMonth.toISOString()) as { total: number | null } | undefined;
    return result?.total ?? 0;
  } finally {
    db.close();
  }
}
