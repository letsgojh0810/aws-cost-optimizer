import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import type { IStateStore } from './base.js';
import type { AggregatedMetrics, MetricRecord, ProjectRecord } from '../types.js';

const DEFAULT_REGION = process.env['AWS_REGION'] ?? 'ap-northeast-2';
const DEFAULT_PREFIX = 'aws-cost-optimizer';

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.95);
  return sorted[Math.min(idx, sorted.length - 1)] ?? 0;
}

export class DynamoDBStateStore implements IStateStore {
  private client: DynamoDBDocumentClient;
  private projectsTable: string;
  private metricsTable: string;

  constructor(region = DEFAULT_REGION, tablePrefix = DEFAULT_PREFIX) {
    const base = new DynamoDBClient({ region });
    this.client = DynamoDBDocumentClient.from(base);
    this.projectsTable = `${tablePrefix}-projects`;
    this.metricsTable = `${tablePrefix}-metrics`;
  }

  async upsertProject(project: ProjectRecord): Promise<void> {
    await this.client.send(new PutCommand({
      TableName: this.projectsTable,
      Item: { ...project, tags: JSON.stringify(project.tags) },
    }));
  }

  async getProject(projectName: string): Promise<ProjectRecord | null> {
    const response = await this.client.send(new GetCommand({
      TableName: this.projectsTable,
      Key: { id: `${projectName}-${DEFAULT_REGION}` },
    }));
    if (!response.Item) return null;
    const item = response.Item as Record<string, unknown>;
    return { ...(item as unknown as ProjectRecord), tags: JSON.parse(item['tags'] as string ?? '{}') as Record<string, string> };
  }

  async listProjects(): Promise<ProjectRecord[]> {
    const response = await this.client.send(new ScanCommand({ TableName: this.projectsTable }));
    return (response.Items ?? []).map(item => ({
      ...(item as ProjectRecord),
      tags: JSON.parse((item as Record<string, unknown>)['tags'] as string ?? '{}') as Record<string, string>,
    }));
  }

  async updateProject(projectName: string, updates: Partial<Omit<ProjectRecord, 'id' | 'projectName'>>): Promise<void> {
    const expressions: string[] = [];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};

    Object.entries(updates).forEach(([key, value], i) => {
      const attr = `#k${i}`;
      const val = `:v${i}`;
      expressions.push(`${attr} = ${val}`);
      names[attr] = key;
      values[val] = value;
    });

    if (expressions.length === 0) return;

    await this.client.send(new UpdateCommand({
      TableName: this.projectsTable,
      Key: { id: `${projectName}-${DEFAULT_REGION}` },
      UpdateExpression: `SET ${expressions.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }));
  }

  async deleteProject(projectName: string): Promise<void> {
    await this.client.send(new DeleteCommand({
      TableName: this.projectsTable,
      Key: { id: `${projectName}-${DEFAULT_REGION}` },
    }));
  }

  async insertMetric(metric: MetricRecord): Promise<void> {
    await this.client.send(new PutCommand({
      TableName: this.metricsTable,
      Item: metric,
    }));
  }

  async getMetrics(projectName: string, fromDate: string, toDate: string): Promise<MetricRecord[]> {
    const response = await this.client.send(new QueryCommand({
      TableName: this.metricsTable,
      KeyConditionExpression: 'project_name = :pn AND collected_at BETWEEN :from AND :to',
      ExpressionAttributeValues: { ':pn': projectName, ':from': fromDate, ':to': toDate },
    }));
    return (response.Items ?? []) as MetricRecord[];
  }

  async getLatestMetric(projectName: string): Promise<MetricRecord | null> {
    const response = await this.client.send(new QueryCommand({
      TableName: this.metricsTable,
      KeyConditionExpression: 'project_name = :pn',
      ExpressionAttributeValues: { ':pn': projectName },
      ScanIndexForward: false,
      Limit: 1,
    }));
    return (response.Items?.[0] as MetricRecord | undefined) ?? null;
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

  close(): void { /* DynamoDB client has no close */ }
}
