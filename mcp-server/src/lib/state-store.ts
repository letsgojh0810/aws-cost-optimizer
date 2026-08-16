import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync } from 'fs';

export interface ProjectRecord {
  id: string;
  projectName: string;
  repoPath: string | null;
  region: string;
  ec2InstanceId: string | null;
  rdsInstanceId: string | null;
  monthlyBudget: number | null;
  trafficScale: string | null;
  deployedAt: string | null;
  tags: Record<string, string>;
}

const DB_DIR = join(homedir(), '.aws-cost-optimizer');
const DB_PATH = join(DB_DIR, 'state.db');

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;

  mkdirSync(DB_DIR, { recursive: true });
  _db = new Database(DB_PATH);

  _db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      project_name TEXT NOT NULL,
      repo_path TEXT,
      region TEXT NOT NULL DEFAULT 'ap-northeast-2',
      ec2_instance_id TEXT,
      rds_instance_id TEXT,
      monthly_budget REAL,
      traffic_scale TEXT,
      deployed_at TEXT,
      tags TEXT
    )
  `);

  return _db;
}

function toRow(p: ProjectRecord): Record<string, string | number | null> {
  return {
    id: p.id,
    project_name: p.projectName,
    repo_path: p.repoPath,
    region: p.region,
    ec2_instance_id: p.ec2InstanceId,
    rds_instance_id: p.rdsInstanceId,
    monthly_budget: p.monthlyBudget,
    traffic_scale: p.trafficScale,
    deployed_at: p.deployedAt,
    tags: JSON.stringify(p.tags),
  };
}

function fromRow(row: Record<string, unknown>): ProjectRecord {
  return {
    id: row['id'] as string,
    projectName: row['project_name'] as string,
    repoPath: (row['repo_path'] as string | null) ?? null,
    region: row['region'] as string,
    ec2InstanceId: (row['ec2_instance_id'] as string | null) ?? null,
    rdsInstanceId: (row['rds_instance_id'] as string | null) ?? null,
    monthlyBudget: (row['monthly_budget'] as number | null) ?? null,
    trafficScale: (row['traffic_scale'] as string | null) ?? null,
    deployedAt: (row['deployed_at'] as string | null) ?? null,
    tags: JSON.parse((row['tags'] as string | null) ?? '{}') as Record<string, string>,
  };
}

export function upsertProject(project: ProjectRecord): void {
  const db = getDb();
  const row = toRow(project);
  db.prepare(`
    INSERT INTO projects (id, project_name, repo_path, region, ec2_instance_id,
      rds_instance_id, monthly_budget, traffic_scale, deployed_at, tags)
    VALUES (@id, @project_name, @repo_path, @region, @ec2_instance_id,
      @rds_instance_id, @monthly_budget, @traffic_scale, @deployed_at, @tags)
    ON CONFLICT(id) DO UPDATE SET
      project_name = excluded.project_name,
      repo_path = excluded.repo_path,
      region = excluded.region,
      ec2_instance_id = excluded.ec2_instance_id,
      rds_instance_id = excluded.rds_instance_id,
      monthly_budget = excluded.monthly_budget,
      traffic_scale = excluded.traffic_scale,
      deployed_at = excluded.deployed_at,
      tags = excluded.tags
  `).run(row);
}

export function getProject(projectName: string): ProjectRecord | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM projects WHERE project_name = ?')
    .get(projectName) as Record<string, unknown> | undefined;
  return row ? fromRow(row) : null;
}

export function listProjects(): ProjectRecord[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM projects ORDER BY deployed_at DESC')
    .all() as Record<string, unknown>[];
  return rows.map(fromRow);
}

export function updateInstanceIds(
  projectName: string,
  updates: { ec2InstanceId?: string; rdsInstanceId?: string }
): void {
  const db = getDb();
  if (updates.ec2InstanceId !== undefined) {
    db.prepare('UPDATE projects SET ec2_instance_id = ? WHERE project_name = ?')
      .run(updates.ec2InstanceId, projectName);
  }
  if (updates.rdsInstanceId !== undefined) {
    db.prepare('UPDATE projects SET rds_instance_id = ? WHERE project_name = ?')
      .run(updates.rdsInstanceId, projectName);
  }
}
