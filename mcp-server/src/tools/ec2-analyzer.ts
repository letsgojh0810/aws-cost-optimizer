import {
  DescribeInstancesCommand,
  DescribeVolumesCommand,
  DescribeAddressesCommand,
} from '@aws-sdk/client-ec2';
import {
  GetMetricStatisticsCommand,
} from '@aws-sdk/client-cloudwatch';
import { z } from 'zod';
import { getEC2Client, getCloudWatchClient } from '../lib/aws-client.js';
import { getManagedTagFilters } from '../lib/tag-filter.js';

const RegionSchema = z.string().default('ap-northeast-2');

export const AnalyzeEC2CostsInputSchema = z.object({
  region: RegionSchema,
  projectName: z.string().optional(),
});

export const IdentifyIdleInstancesInputSchema = z.object({
  region: RegionSchema,
  cpuThresholdPercent: z.number().min(0).max(100).default(5),
  lookbackDays: z.number().int().min(1).max(30).default(7),
});

export const FindUnusedEbsInputSchema = z.object({
  region: RegionSchema,
});

export const DetectUnusedEipsInputSchema = z.object({
  region: RegionSchema,
});

// Approximate on-demand prices for ap-northeast-2 ($/hr)
const EC2_HOURLY_PRICES: Record<string, number> = {
  't4g.nano': 0.0043, 't4g.micro': 0.0085, 't4g.small': 0.017, 't4g.medium': 0.034,
  't3.nano': 0.0053, 't3.micro': 0.0105, 't3.small': 0.021, 't3.medium': 0.0416,
  't3.large': 0.0832, 'm5.large': 0.12,
};

export async function analyzeEC2Costs(input: z.infer<typeof AnalyzeEC2CostsInputSchema>): Promise<{
  instances: Array<{
    instanceId: string;
    instanceType: string;
    state: string;
    projectName: string;
    estimatedMonthlyUsd: number;
    launchTime?: string;
  }>;
  totalEstimatedMonthlyUsd: number;
  error?: string;
}> {
  try {
    const ec2 = getEC2Client({ region: input.region });
    const response = await ec2.send(new DescribeInstancesCommand({
      Filters: getManagedTagFilters(input.projectName ? { projectName: input.projectName } : undefined),
    }));

    const instances = (response.Reservations ?? []).flatMap(r => r.Instances ?? []).map(inst => {
      const tags = Object.fromEntries(
        (inst.Tags ?? []).filter(t => t.Key && t.Value).map(t => [t.Key!, t.Value!])
      );
      const hourlyPrice = EC2_HOURLY_PRICES[inst.InstanceType ?? ''] ?? 0;
      const estimatedMonthlyUsd = parseFloat((hourlyPrice * 730).toFixed(2));
      return {
        instanceId: inst.InstanceId ?? '',
        instanceType: inst.InstanceType ?? '',
        state: inst.State?.Name ?? '',
        projectName: tags['ProjectName'] ?? '',
        estimatedMonthlyUsd,
        launchTime: inst.LaunchTime?.toISOString(),
      };
    });

    const totalEstimatedMonthlyUsd = parseFloat(
      instances.reduce((sum, i) => sum + i.estimatedMonthlyUsd, 0).toFixed(2)
    );

    return { instances, totalEstimatedMonthlyUsd };
  } catch (err) {
    return { instances: [], totalEstimatedMonthlyUsd: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function identifyIdleInstances(input: z.infer<typeof IdentifyIdleInstancesInputSchema>): Promise<{
  idleInstances: Array<{
    instanceId: string;
    instanceType: string;
    avgCpuPercent: number;
    projectName: string;
    recommendation: string;
  }>;
  error?: string;
}> {
  try {
    const ec2 = getEC2Client({ region: input.region });
    const cw = getCloudWatchClient({ region: input.region });

    const describeResponse = await ec2.send(new DescribeInstancesCommand({
      Filters: [
        ...getManagedTagFilters(),
        { Name: 'instance-state-name', Values: ['running'] },
      ],
    }));

    const instances = (describeResponse.Reservations ?? []).flatMap(r => r.Instances ?? []);
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - input.lookbackDays * 24 * 60 * 60 * 1000);

    const idleInstances = [];
    for (const inst of instances) {
      if (!inst.InstanceId) continue;

      const metricsResponse = await cw.send(new GetMetricStatisticsCommand({
        Namespace: 'AWS/EC2',
        MetricName: 'CPUUtilization',
        Dimensions: [{ Name: 'InstanceId', Value: inst.InstanceId }],
        StartTime: startTime,
        EndTime: endTime,
        Period: input.lookbackDays * 24 * 3600,
        Statistics: ['Average'],
      }));

      const avgCpu = metricsResponse.Datapoints?.[0]?.Average ?? 0;
      const tags = Object.fromEntries(
        (inst.Tags ?? []).filter(t => t.Key && t.Value).map(t => [t.Key!, t.Value!])
      );

      if (avgCpu < input.cpuThresholdPercent) {
        idleInstances.push({
          instanceId: inst.InstanceId,
          instanceType: inst.InstanceType ?? '',
          avgCpuPercent: parseFloat(avgCpu.toFixed(2)),
          projectName: tags['ProjectName'] ?? '',
          recommendation: `CPU ${avgCpu.toFixed(1)}% avg over ${input.lookbackDays}d — consider downsizing or scheduling shutdown`,
        });
      }
    }

    return { idleInstances };
  } catch (err) {
    return { idleInstances: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export async function findUnusedEbsVolumes(input: z.infer<typeof FindUnusedEbsInputSchema>): Promise<{
  unusedVolumes: Array<{
    volumeId: string;
    sizeGb: number;
    state: string;
    estimatedMonthlyUsd: number;
  }>;
  totalWastedUsd: number;
  error?: string;
}> {
  try {
    const ec2 = getEC2Client({ region: input.region });
    const response = await ec2.send(new DescribeVolumesCommand({
      Filters: [{ Name: 'status', Values: ['available'] }],
    }));

    const EBS_GP3_PER_GB = 0.08;
    const unusedVolumes = (response.Volumes ?? []).map(vol => ({
      volumeId: vol.VolumeId ?? '',
      sizeGb: vol.Size ?? 0,
      state: vol.State ?? '',
      estimatedMonthlyUsd: parseFloat(((vol.Size ?? 0) * EBS_GP3_PER_GB).toFixed(2)),
    }));

    const totalWastedUsd = parseFloat(
      unusedVolumes.reduce((sum, v) => sum + v.estimatedMonthlyUsd, 0).toFixed(2)
    );

    return { unusedVolumes, totalWastedUsd };
  } catch (err) {
    return { unusedVolumes: [], totalWastedUsd: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function detectUnusedEips(input: z.infer<typeof DetectUnusedEipsInputSchema>): Promise<{
  unusedEips: Array<{
    allocationId: string;
    publicIp: string;
    estimatedMonthlyUsd: number;
  }>;
  totalWastedUsd: number;
  error?: string;
}> {
  try {
    const ec2 = getEC2Client({ region: input.region });
    const response = await ec2.send(new DescribeAddressesCommand({
      Filters: [{ Name: 'domain', Values: ['vpc'] }],
    }));

    // EIPs not associated with a running instance cost ~$0.005/hr
    const EIP_HOURLY = 0.005;
    const unusedEips = (response.Addresses ?? [])
      .filter(addr => !addr.InstanceId && !addr.NetworkInterfaceId)
      .map(addr => ({
        allocationId: addr.AllocationId ?? '',
        publicIp: addr.PublicIp ?? '',
        estimatedMonthlyUsd: parseFloat((EIP_HOURLY * 730).toFixed(2)),
      }));

    const totalWastedUsd = parseFloat(
      unusedEips.reduce((sum, e) => sum + e.estimatedMonthlyUsd, 0).toFixed(2)
    );

    return { unusedEips, totalWastedUsd };
  } catch (err) {
    return { unusedEips: [], totalWastedUsd: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function recommendInstanceRightSizing(input: z.infer<typeof IdentifyIdleInstancesInputSchema>): Promise<{
  recommendations: Array<{
    instanceId: string;
    currentType: string;
    recommendedType: string;
    avgCpuPercent: number;
    estimatedSavingsUsd: number;
    projectName: string;
  }>;
  error?: string;
}> {
  const idleResult = await identifyIdleInstances(input);
  if (idleResult.error) return { recommendations: [], error: idleResult.error };

  const DOWNSIZE_MAP: Record<string, string> = {
    't3.large': 't3.medium', 't3.medium': 't3.small', 't3.small': 't3.micro', 't3.micro': 't3.nano',
    't4g.large': 't4g.medium', 't4g.medium': 't4g.small', 't4g.small': 't4g.micro', 't4g.micro': 't4g.nano',
    'm5.large': 't3.large',
  };

  const recommendations = idleResult.idleInstances
    .filter(inst => DOWNSIZE_MAP[inst.instanceType])
    .map(inst => {
      const recommended = DOWNSIZE_MAP[inst.instanceType]!;
      const currentHourly = EC2_HOURLY_PRICES[inst.instanceType] ?? 0;
      const recommendedHourly = EC2_HOURLY_PRICES[recommended] ?? 0;
      const estimatedSavingsUsd = parseFloat(((currentHourly - recommendedHourly) * 730).toFixed(2));
      return {
        instanceId: inst.instanceId,
        currentType: inst.instanceType,
        recommendedType: recommended,
        avgCpuPercent: inst.avgCpuPercent,
        estimatedSavingsUsd,
        projectName: inst.projectName,
      };
    });

  return { recommendations };
}

export async function calculateSavingsPotential(input: z.infer<typeof AnalyzeEC2CostsInputSchema>): Promise<{
  summary: {
    idleInstanceSavings: number;
    unusedEbsSavings: number;
    unusedEipSavings: number;
    totalPotentialSavings: number;
  };
  error?: string;
}> {
  try {
    const [idle, ebs, eips] = await Promise.all([
      recommendInstanceRightSizing({ region: input.region, cpuThresholdPercent: 5, lookbackDays: 7 }),
      findUnusedEbsVolumes({ region: input.region }),
      detectUnusedEips({ region: input.region }),
    ]);

    const idleInstanceSavings = idle.recommendations.reduce((s, r) => s + r.estimatedSavingsUsd, 0);
    const totalPotentialSavings = parseFloat(
      (idleInstanceSavings + ebs.totalWastedUsd + eips.totalWastedUsd).toFixed(2)
    );

    return {
      summary: {
        idleInstanceSavings: parseFloat(idleInstanceSavings.toFixed(2)),
        unusedEbsSavings: ebs.totalWastedUsd,
        unusedEipSavings: eips.totalWastedUsd,
        totalPotentialSavings,
      },
    };
  } catch (err) {
    return {
      summary: { idleInstanceSavings: 0, unusedEbsSavings: 0, unusedEipSavings: 0, totalPotentialSavings: 0 },
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
