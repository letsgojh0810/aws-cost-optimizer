import {
  CostExplorerClient,
  GetCostAndUsageCommand,
} from '@aws-sdk/client-cost-explorer';

export async function fetchDailyCost(projectName: string, _region: string): Promise<number> {
  const client = new CostExplorerClient({ region: 'us-east-1' });

  const today = new Date();
  const startDate = today.toISOString().split('T')[0]!;
  const tomorrow = new Date(today.getTime() + 24 * 3600 * 1000);
  const endDate = tomorrow.toISOString().split('T')[0]!;

  try {
    const response = await client.send(new GetCostAndUsageCommand({
      TimePeriod: { Start: startDate, End: endDate },
      Granularity: 'DAILY',
      Metrics: ['UnblendedCost'],
      Filter: {
        Tags: {
          Key: 'ProjectName',
          Values: [projectName],
          MatchOptions: ['EQUALS'],
        },
      },
    }));

    const amount = response.ResultsByTime?.[0]?.Total?.['UnblendedCost']?.Amount ?? '0';
    return parseFloat(amount);
  } catch {
    return 0;
  }
}
