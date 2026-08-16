import type { AggregatedMetrics, MetricRecord, ProjectRecord } from '../types.js';

export interface IStateStore {
  upsertProject(project: ProjectRecord): Promise<void>;
  getProject(projectName: string): Promise<ProjectRecord | null>;
  listProjects(): Promise<ProjectRecord[]>;
  updateProject(projectName: string, updates: Partial<Omit<ProjectRecord, 'id' | 'projectName'>>): Promise<void>;
  deleteProject(projectName: string): Promise<void>;

  insertMetric(metric: MetricRecord): Promise<void>;
  getMetrics(projectName: string, fromDate: string, toDate: string): Promise<MetricRecord[]>;
  getLatestMetric(projectName: string): Promise<MetricRecord | null>;
  getAggregatedMetrics(projectName: string, days: number): Promise<AggregatedMetrics>;

  close(): void;
}
