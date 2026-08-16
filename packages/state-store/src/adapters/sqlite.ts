import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync } from 'fs';
import type { IStateStore } from './base.js';
import type { AggregatedMetrics, MetricRecord, ProjectRecord, TrafficScale } from '../types.js';
import { CREATE_METRICS_IDX_SQL, CREATE_METRICS_SQL, CREATE_PROJECTS_SQL } from '../schema.js';

const DEFAULT_DB_PATH = join(homedir(), '.aws-cost-optimizer', 'state.db');

function toProjectRow(p: ProjectRecord): Record<string, string | number | null> {
  return {
    id: p.id,
    project_name: p.projectName,
    repo_path: p.repoPath,
    region: p.region,
    ec2_instance_id: p.ec2InstanceId,
    rds_instance_id: p.rdsInstanceId,
    alb_dns_name: p.albDnsName,
    vpc_id: p.vpcId,
    monthly_budget: p.monthlyBudget,
    traffic_scale: p.trafficScale,
    deployed_at: p.deployedAt,
    last_updated: p.lastUpdated ?? new Date().toISOString(),
    tags: JSON.stringify(p.tags),
  };
}

function fromProjectRow(row: Record<string, unknown>): ProjectRecord {
  return {
    id: row['id'] as string,
    projectName: row['project_name'] as string,
    repoPath: (row['repo_path'] as string | null) ?? null,
    region: row['region'] as string,
    ec2InstanceId: (row['ec2_instance_id'] as string | null) ?? null,
    rdsInstanceId: (row['rds_instance_id'] as string | null) ?? null,
    albDnsName: (row['alb_dns_name'] as string | null) ?? null,
    vpcId: (row['vpc_id'] as string | null) ?? null,
    monthlyBudget: (row['monthly_budget'] as number | null) ?? null,
    trafficScale: (row['traffic_scale'] as TrafficScale | null) ?? null,
    deployedAt: (row['deployed_at'] as string | null) ?? null,
    lastUpdated: (row['last_updated'] as string | null) ?? null,
    tags: JSON.parse((row['tags'] as string | null) ?? '{}') as Record<string, string>,
  };
}

function toMetricRow(m: MetricRecord): Record<string, string | number | null> {
  return {
    id: m.id,
    project_name: m.projectName,
    collected_at: m.collectedAt,
    period_hours: m.periodHours,
    ec2_cpu_avg: m.ec2CpuAvg,
    ec2_cpu_p95: m.ec2CpuP95,
    ec2_mem_avg: m.ec2MemAvg,
    ec2_net_in_mb: m.ec2NetInMb,
    ec2_net_out_mb: m.ec2NetOutMb,
    rds_cpu_avg: m.rdsCpuAvg,
    rds_connections: m.rdsConnections,
    cost_usd: m.costUsd,
  };
}

function fromMetricRow(row: Record<string, unknown>): MetricRecord {
  return {
    id: row['id'] as string,
    projectName: row['project_name'] as string,
    collectedAt: row['collected_at'] as string,
    periodHours: row['period_hours'] as number,
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

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.95);
  return sorted[Math.min(idx, sorted.length - 1)] ?? 0;
}

export class SQLiteStateStore implements IStateStore {
  private db: Database.Database;

  constructor(dbPath = DEFAULT_DB_PATH) {
    mkdirSync(join(dbPath, '..'), { recursive: true });
    this.db = new Database(dbPath);
    this.db.exec(CREATE_PROJECTS_SQL);
    this.db.exec(CREATE_METRICS_SQL);
    this.db.exec(CREATE_METRICS_IDX_SQL);
  }

  async upsertProject(project: ProjectRecord): Promise<void> {
    const row = toProjectRow(project);
    this.db.prepare(`
      INSERT INTO projects (id, project_name, repo_path, region, ec2_instance_id,
        rds_instance_id, alb_dns_name, vpc_id, monthly_budget, traffic_scale,
        deployed_at, last_updated, tags)
      VALUES (@id, @project_name, @repo_path, @region, @ec2_instance_id,
        @rds_instance_id, @alb_dns_name, @vpc_id, @monthly_budget, @traffic_scale,
        @deployed_at, @last_updated, @tags)
      ON CONFLICT(id) DO UPDATE SET
        project_name = excluded.project_name,
        repo_path = excluded.repo_path,
        region = excluded.region,
        ec2_instance_id = excluded.ec2_instance_id,
        rds_instance_id = excluded.rds_instance_id,
        alb_dns_name = excluded.alb_dns_name,
        vpc_id = excluded.vpc_id,
        monthly_budget = excluded.monthly_budget,
        traffic_scale = excluded.traffic_scale,
        deployed_at = excluded.deployed_at,
        last_updated = excluded.last_updated,
        tags = excluded.tags
    `).run(row);
    return Promise.resolve();
  }

  async getProject(projectName: string): Promise<ProjectRecord | null> {
    const row = this.db.prepare('SELECT * FROM projects WHERE project_name = ?').get(projectName) as Record<string, unknown> | undefined;
    return Promise.resolve(row ? fromProjectRow(row) : null);
  }

  async listProjects(): Promise<ProjectRecord[]> {
    const rows = this.db.prepare('SELECT * FROM projects ORDER BY last_updated DESC').all() as Record<string, unknown>[];
    return Promise.resolve(rows.map(fromProjectRow));
  }

  async updateProject(projectName: string, updates: Partial<Omit<ProjectRecord, 'id' | 'projectName'>>): Promise<void> {
    const setClauses: string[] = [];
    const values: Record<string, unknown> = { project_name: projectName };

    if (updates.ec2InstanceId !== undefined) { setClauses.push('ec2_instance_id = @ec2_instance_id'); values['ec2_instance_id'] = updates.ec2InstanceId; }
    if (updates.rdsInstanceId !== undefined) { setClauses.push('rds_instance_id = @rds_instance_id'); values['rds_instance_id'] = updates.rdsInstanceId; }
    if (updates.albDnsName !== undefined) { setClauses.push('alb_dns_name = @alb_dns_name'); values['alb_dns_name'] = updates.albDnsName; }
    if (updates.vpcId !== undefined) { setClauses.push('vpc_id = @vpc_id'); values['vpc_id'] = updates.vpcId; }
    if (updates.monthlyBudget !== undefined) { setClauses.push('monthly_budget = @monthly_budget'); values['monthly_budget'] = updates.monthlyBudget; }
    if (updates.trafficScale !== undefined) { setClauses.push('traffic_scale = @traffic_scale'); values['traffic_scale'] = updates.trafficScale; }
    if (updates.tags !== undefined) { setClauses.push('tags = @tags'); values['tags'] = JSON.stringify(updates.tags); }

    setClauses.push('last_updated = @last_updated');
    values['last_updated'] = new Date().toISOString();

    if (setClauses.length > 1) {
      this.db.prepare(`UPDATE projects SET ${setClauses.join(', ')} WHERE project_name = @project_name`).run(values);
    }
    return Promise.resolve();
  }

  async deleteProject(projectName: string): Promise<void> {
    this.db.prepare('DELETE FROM projects WHERE project_name = ?').run(projectName);
    return Promise.resolve();
  }

  async insertMetric(metric: MetricRecord): Promise<void> {
    const row = toMetricRow(metric);
    this.db.prepare(`
      INSERT OR REPLACE INTO metrics (id, project_name, collected_at, period_hours,
        ec2_cpu_avg, ec2_cpu_p95, ec2_mem_avg, ec2_net_in_mb, ec2_net_out_mb,
        rds_cpu_avg, rds_connections, cost_usd)
      VALUES (@id, @project_name, @collected_at, @period_hours,
        @ec2_cpu_avg, @ec2_cpu_p95, @ec2_mem_avg, @ec2_net_in_mb, @ec2_net_out_mb,
        @rds_cpu_avg, @rds_connections, @cost_usd)
    `).run(row);
    return Promise.resolve();
  }

  async getMetrics(projectName: string, fromDate: string, toDate: string): Promise<MetricRecord[]> {
    const rows = this.db.prepare(
      'SELECT * FROM metrics WHERE project_name = ? AND collected_at >= ? AND collected_at <= ? ORDER BY collected_at ASC'
    ).all(projectName, fromDate, toDate) as Record<string, unknown>[];
    return Promise.resolve(rows.map(fromMetricRow));
  }

  async getLatestMetric(projectName: string): Promise<MetricRecord | null> {
    const row = this.db.prepare(
      'SELECT * FROM metrics WHERE project_name = ? ORDER BY collected_at DESC LIMIT 1'
    ).get(projectName) as Record<string, unknown> | undefined;
    return Promise.resolve(row ? fromMetricRow(row) : null);
  }

  async getAggregatedMetrics(projectName: string, days: number): Promise<AggregatedMetrics> {
    const fromDate = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    const toDate = new Date().toISOString();
    const metrics = await this.getMetrics(projectName, fromDate, toDate);

    const cpuValues = metrics.map(m => m.ec2CpuAvg ?? 0).filter(v => v > 0);
    const netIn = metrics.reduce((s, m) => s + (m.ec2NetInMb ?? 0), 0);
    const netOut = metrics.reduce((s, m) => s + (m.ec2NetOutMb ?? 0), 0);
    const totalCost = metrics.reduce((s, m) => s + (m.costUsd ?? 0), 0);

    return {
      projectName,
      periodDays: days,
      ec2CpuAvg: cpuValues.length > 0 ? parseFloat((cpuValues.reduce((s, v) => s + v, 0) / cpuValues.length).toFixed(2)) : 0,
      ec2CpuP95: parseFloat(p95(cpuValues).toFixed(2)),
      ec2NetInMbTotal: parseFloat(netIn.toFixed(2)),
      ec2NetOutMbTotal: parseFloat(netOut.toFixed(2)),
      totalCostUsd: parseFloat(totalCost.toFixed(2)),
      dataPoints: metrics.length,
    };
  }

  close(): void {
    this.db.close();
  }
}
