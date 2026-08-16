export const PROJECTS_TABLE = 'projects';
export const METRICS_TABLE = 'metrics';

export const CREATE_PROJECTS_SQL = `
  CREATE TABLE IF NOT EXISTS ${PROJECTS_TABLE} (
    id              TEXT PRIMARY KEY,
    project_name    TEXT NOT NULL UNIQUE,
    repo_path       TEXT,
    region          TEXT NOT NULL DEFAULT 'ap-northeast-2',
    ec2_instance_id TEXT,
    rds_instance_id TEXT,
    alb_dns_name    TEXT,
    vpc_id          TEXT,
    monthly_budget  REAL,
    traffic_scale   TEXT CHECK(traffic_scale IN ('personal','team','production')),
    deployed_at     TEXT,
    last_updated    TEXT,
    tags            TEXT
  )
`;

export const CREATE_METRICS_SQL = `
  CREATE TABLE IF NOT EXISTS ${METRICS_TABLE} (
    id              TEXT PRIMARY KEY,
    project_name    TEXT NOT NULL,
    collected_at    TEXT NOT NULL,
    period_hours    INTEGER NOT NULL DEFAULT 1,
    ec2_cpu_avg     REAL,
    ec2_cpu_p95     REAL,
    ec2_mem_avg     REAL,
    ec2_net_in_mb   REAL,
    ec2_net_out_mb  REAL,
    rds_cpu_avg     REAL,
    rds_connections INTEGER,
    cost_usd        REAL,
    FOREIGN KEY (project_name) REFERENCES ${PROJECTS_TABLE}(project_name)
  )
`;

export const CREATE_METRICS_IDX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_metrics_project_collected
  ON ${METRICS_TABLE}(project_name, collected_at)
`;
