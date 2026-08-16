import {
  CloudWatchClient,
  GetMetricDataCommand,
  type MetricDataQuery,
} from '@aws-sdk/client-cloudwatch';
import type { RawMetrics } from './aggregator.js';

export async function fetchEC2Metrics(
  instanceId: string,
  region: string,
  periodHours: number,
): Promise<RawMetrics> {
  const client = new CloudWatchClient({ region });
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - periodHours * 3600 * 1000);
  const period = periodHours * 3600;

  const queries: MetricDataQuery[] = [
    {
      Id: 'cpu',
      MetricStat: {
        Metric: {
          Namespace: 'AWS/EC2',
          MetricName: 'CPUUtilization',
          Dimensions: [{ Name: 'InstanceId', Value: instanceId }],
        },
        Period: period,
        Stat: 'Average',
      },
    },
    {
      Id: 'netIn',
      MetricStat: {
        Metric: {
          Namespace: 'AWS/EC2',
          MetricName: 'NetworkIn',
          Dimensions: [{ Name: 'InstanceId', Value: instanceId }],
        },
        Period: period,
        Stat: 'Sum',
      },
    },
    {
      Id: 'netOut',
      MetricStat: {
        Metric: {
          Namespace: 'AWS/EC2',
          MetricName: 'NetworkOut',
          Dimensions: [{ Name: 'InstanceId', Value: instanceId }],
        },
        Period: period,
        Stat: 'Sum',
      },
    },
  ];

  const response = await client.send(new GetMetricDataCommand({
    MetricDataQueries: queries,
    StartTime: startTime,
    EndTime: endTime,
  }));

  const findValues = (id: string): number[] =>
    response.MetricDataResults?.find(r => r.Id === id)?.Values ?? [];

  return {
    cpuDatapoints: findValues('cpu'),
    memDatapoints: [],
    netInBytes: findValues('netIn'),
    netOutBytes: findValues('netOut'),
  };
}
