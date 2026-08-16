import {
  GetCostAndUsageCommand,
  type GetCostAndUsageCommandInput,
} from '@aws-sdk/client-cost-explorer';
import { z } from 'zod';
import { getCostExplorerClient } from '../lib/aws-client.js';
import { MANAGED_BY_TAG, MANAGED_BY_KEY } from '../lib/tag-filter.js';
import { listProjects } from '../lib/state-store.js';

export const GetDailyCostTrendInputSchema = z.object({
  days: z.number().int().min(1).max(90).default(14),
});

export const GetCostByServiceInputSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional()
    .describe('Month in YYYY-MM format, defaults to current month'),
});

export const GetCostByTagInputSchema = z.object({
  days: z.number().int().min(1).max(90).default(30),
});

function currentMonthRange(): { start: string; end: string } {
  const now = new Date();
  const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const end = now.toISOString().split('T')[0]!;
  return { start, end };
}

export async function getDailyCostTrend(input: z.infer<typeof GetDailyCostTrendInputSchema>): Promise<{
  trend: Array<{ date: string; costUsd: number }>;
  totalUsd: number;
  error?: string;
}> {
  try {
    const ce = getCostExplorerClient();
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - input.days * 24 * 60 * 60 * 1000);

    const params: GetCostAndUsageCommandInput = {
      TimePeriod: {
        Start: startDate.toISOString().split('T')[0]!,
        End: endDate.toISOString().split('T')[0]!,
      },
      Granularity: 'DAILY',
      Metrics: ['UnblendedCost'],
    };

    const response = await ce.send(new GetCostAndUsageCommand(params));

    const trend = (response.ResultsByTime ?? []).map(r => ({
      date: r.TimePeriod?.Start ?? '',
      costUsd: parseFloat(r.Total?.['UnblendedCost']?.Amount ?? '0'),
    }));

    const totalUsd = parseFloat(trend.reduce((s, t) => s + t.costUsd, 0).toFixed(2));

    return { trend, totalUsd };
  } catch (err) {
    return { trend: [], totalUsd: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getCostByService(input: z.infer<typeof GetCostByServiceInputSchema>): Promise<{
  services: Array<{ service: string; costUsd: number }>;
  totalUsd: number;
  error?: string;
}> {
  try {
    const ce = getCostExplorerClient();
    const range = input.month
      ? { start: `${input.month}-01`, end: `${input.month}-31` }
      : currentMonthRange();

    const response = await ce.send(new GetCostAndUsageCommand({
      TimePeriod: { Start: range.start, End: range.end },
      Granularity: 'MONTHLY',
      Metrics: ['UnblendedCost'],
      GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
    }));

    const services = (response.ResultsByTime?.[0]?.Groups ?? [])
      .map(g => ({
        service: g.Keys?.[0] ?? '',
        costUsd: parseFloat(g.Metrics?.['UnblendedCost']?.Amount ?? '0'),
      }))
      .filter(s => s.costUsd > 0)
      .sort((a, b) => b.costUsd - a.costUsd);

    const totalUsd = parseFloat(services.reduce((s, svc) => s + svc.costUsd, 0).toFixed(2));

    return { services, totalUsd };
  } catch (err) {
    return { services: [], totalUsd: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getCostByTag(input: z.infer<typeof GetCostByTagInputSchema>): Promise<{
  projects: Array<{ projectName: string; costUsd: number }>;
  totalUsd: number;
  error?: string;
}> {
  try {
    const ce = getCostExplorerClient();
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - input.days * 24 * 60 * 60 * 1000);

    const response = await ce.send(new GetCostAndUsageCommand({
      TimePeriod: {
        Start: startDate.toISOString().split('T')[0]!,
        End: endDate.toISOString().split('T')[0]!,
      },
      Granularity: 'MONTHLY',
      Metrics: ['UnblendedCost'],
      Filter: {
        Tags: {
          Key: MANAGED_BY_KEY,
          Values: [MANAGED_BY_TAG],
          MatchOptions: ['EQUALS'],
        },
      },
      GroupBy: [{ Type: 'TAG', Key: 'ProjectName' }],
    }));

    const projects = (response.ResultsByTime?.[0]?.Groups ?? [])
      .map(g => ({
        projectName: g.Keys?.[0]?.replace('ProjectName$', '') ?? '',
        costUsd: parseFloat(g.Metrics?.['UnblendedCost']?.Amount ?? '0'),
      }))
      .filter(p => p.costUsd > 0)
      .sort((a, b) => b.costUsd - a.costUsd);

    const totalUsd = parseFloat(projects.reduce((s, p) => s + p.costUsd, 0).toFixed(2));

    return { projects, totalUsd };
  } catch (err) {
    return { projects: [], totalUsd: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function generateOptimizationReport(_input: Record<string, never>): Promise<{
  report: string;
  error?: string;
}> {
  try {
    const [costTrend, costByService, costByTag] = await Promise.all([
      getDailyCostTrend({ days: 14 }),
      getCostByService({}),
      getCostByTag({ days: 30 }),
    ]);

    const projects = listProjects();
    const lines: string[] = [
      `# AWS Cost Optimization Report`,
      `Generated: ${new Date().toISOString()}`,
      ``,
      `## Managed Projects (${projects.length})`,
      ...projects.map(p => `- **${p.projectName}** | ${p.region} | EC2: ${p.ec2InstanceId ?? 'N/A'} | Budget: $${p.monthlyBudget ?? 'N/A'}/mo`),
      ``,
      `## 14-Day Cost Trend`,
      `Total: $${costTrend.totalUsd.toFixed(2)}`,
      ...costTrend.trend.slice(-7).map(t => `- ${t.date}: $${t.costUsd.toFixed(2)}`),
      ``,
      `## Top Services This Month`,
      ...costByService.services.slice(0, 5).map(s => `- ${s.service}: $${s.costUsd.toFixed(2)}`),
      ``,
      `## Cost by Project (30 days)`,
      ...costByTag.projects.map(p => `- ${p.projectName}: $${p.costUsd.toFixed(2)}`),
    ];

    return { report: lines.join('\n') };
  } catch (err) {
    return { report: '', error: err instanceof Error ? err.message : String(err) };
  }
}
