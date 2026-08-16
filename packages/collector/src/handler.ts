import { SQLiteStateStore } from '../../state-store/src/adapters/sqlite.js';
import { fetchEC2Metrics } from './cloudwatch.js';
import { fetchDailyCost } from './cost-fetcher.js';
import { aggregate } from './aggregator.js';
import type { MetricRecord } from '../../state-store/src/types.js';

const STORE_TYPE = process.env['STORE_TYPE'] ?? 'sqlite';
const DYNAMODB_REGION = process.env['AWS_REGION'] ?? 'ap-northeast-2';

async function getStore() {
  if (STORE_TYPE === 'dynamodb') {
    const { DynamoDBStateStore } = await import('../../state-store/src/adapters/dynamodb.js');
    return new DynamoDBStateStore(DYNAMODB_REGION);
  }
  return new SQLiteStateStore();
}

export const handler = async (_event: unknown): Promise<{ processed: number; errors: number }> => {
  const store = await getStore();
  const projects = await store.listProjects();
  let processed = 0;
  let errors = 0;

  for (const project of projects) {
    if (!project.ec2InstanceId) continue;

    try {
      const rawMetrics = await fetchEC2Metrics(project.ec2InstanceId, project.region, 1);
      const costUsd = await fetchDailyCost(project.projectName, project.region);
      const agg = aggregate(rawMetrics);

      const now = new Date().toISOString();
      const metric: MetricRecord = {
        id: `${project.projectName}-${now}`,
        projectName: project.projectName,
        collectedAt: now,
        periodHours: 1,
        ec2CpuAvg: agg.cpuAvg,
        ec2CpuP95: agg.cpuP95,
        ec2MemAvg: null,
        ec2NetInMb: agg.netInMb,
        ec2NetOutMb: agg.netOutMb,
        rdsCpuAvg: null,
        rdsConnections: null,
        costUsd,
      };

      await store.insertMetric(metric);
      processed++;
    } catch (err) {
      console.error(`Failed to collect metrics for ${project.projectName}:`, err);
      errors++;
    }
  }

  store.close();
  console.log(`Collector complete: processed=${processed}, errors=${errors}`);
  return { processed, errors };
};
