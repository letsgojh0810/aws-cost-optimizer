import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';

const DB_PATH = join(homedir(), '.aws-cost-optimizer', 'state.db');

export interface ProjectRecord {
  id: string;
  projectName: string;
  region: string;
  ec2InstanceId: string | null;
  rdsInstanceId: string | null;
  albDnsName: string | null;
  monthlyBudget: number | null;
  trafficScale: string | null;
  deployedAt: string | null;
  tags: Record<string, string>;
}

export interface MetricRecord {
  projectName: string;
  collectedAt: string;
  ec2CpuAvg: number | null;
  ec2CpuP95: number | null;
  ec2NetInMb: number | null;
  ec2NetOutMb: number | null;
  costUsd: number | null;
}

function openDb(): Database.Database | null {
  try {
    return new Database(DB_PATH, { readonly: true, fileMustExist: true });
  } catch {
    return null;
  }
}

export function listProjects(): ProjectRecord[] {
  const db = openDb();
  if (!db) return [];
  try {
    const rows = db.prepare('SELECT * FROM projects ORDER BY last_updated DESC').all() as Record<string, unknown>[];
    return rows.map(r => ({
      id: r['id'] as string,
      projectName: r['project_name'] as string,
      region: (r['region'] as string) ?? 'ap-northeast-2',
      ec2InstanceId: (r['ec2_instance_id'] as string | null) ?? null,
      rdsInstanceId: (r['rds_instance_id'] as string | null) ?? null,
      albDnsName: (r['alb_dns_name'] as string | null) ?? null,
      monthlyBudget: (r['monthly_budget'] as number | null) ?? null,
      trafficScale: (r['traffic_scale'] as string | null) ?? null,
      deployedAt: (r['deployed_at'] as string | null) ?? null,
      tags: JSON.parse((r['tags'] as string | null) ?? '{}') as Record<string, string>,
    }));
  } finally {
    db.close();
  }
}

export function getMetrics(projectName: string, hours = 168): MetricRecord[] {
  const db = openDb();
  if (!db) return [];
  try {
    const fromDate = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const rows = db.prepare(
      'SELECT * FROM metrics WHERE project_name = ? AND collected_at >= ? ORDER BY collected_at ASC'
    ).all(projectName, fromDate) as Record<string, unknown>[];
    return rows.map(r => ({
      projectName: r['project_name'] as string,
      collectedAt: r['collected_at'] as string,
      ec2CpuAvg: (r['ec2_cpu_avg'] as number | null) ?? null,
      ec2CpuP95: (r['ec2_cpu_p95'] as number | null) ?? null,
      ec2NetInMb: (r['ec2_net_in_mb'] as number | null) ?? null,
      ec2NetOutMb: (r['ec2_net_out_mb'] as number | null) ?? null,
      costUsd: (r['cost_usd'] as number | null) ?? null,
    }));
  } finally {
    db.close();
  }
}

export function getMonthCost(projectName: string): number {
  const db = openDb();
  if (!db) return 0;
  try {
    const start = new Date();
    start.setDate(1); start.setHours(0, 0, 0, 0);
    const row = db.prepare(
      'SELECT SUM(cost_usd) as total FROM metrics WHERE project_name = ? AND collected_at >= ?'
    ).get(projectName, start.toISOString()) as { total: number | null } | undefined;
    return row?.total ?? 0;
  } finally {
    db.close();
  }
}
