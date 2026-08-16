import type { Tag } from '@aws-sdk/client-ec2';

export const MANAGED_BY_TAG = 'aws-deploy-optimizer';
export const MANAGED_BY_KEY = 'ManagedBy';
export const PROJECT_NAME_KEY = 'ProjectName';

export interface TagFilter {
  projectName?: string;
}

/**
 * Returns the EC2 SDK tag filter array for describing managed resources.
 */
export function getManagedTagFilters(filter?: TagFilter): { Name: string; Values: string[] }[] {
  const filters: { Name: string; Values: string[] }[] = [
    { Name: `tag:${MANAGED_BY_KEY}`, Values: [MANAGED_BY_TAG] },
  ];
  if (filter?.projectName) {
    filters.push({ Name: `tag:${PROJECT_NAME_KEY}`, Values: [filter.projectName] });
  }
  return filters;
}

/**
 * Converts a Record<string,string> to the AWS SDK Tag array format.
 */
export function toAwsTags(tags: Record<string, string>): Tag[] {
  return Object.entries(tags).map(([Key, Value]) => ({ Key, Value }));
}

/**
 * Converts an AWS SDK Tag array back to a plain Record.
 */
export function fromAwsTags(tags: Tag[] | undefined): Record<string, string> {
  if (!tags) return {};
  return Object.fromEntries(
    tags
      .filter((t): t is Required<Tag> => t.Key !== undefined && t.Value !== undefined)
      .map(t => [t.Key, t.Value])
  );
}

/**
 * Builds the standard set of management tags for a new deployment.
 */
export function buildManagedTags(projectName: string, trafficScale: string, monthlyBudget: number): Record<string, string> {
  return {
    [MANAGED_BY_KEY]: MANAGED_BY_TAG,
    [PROJECT_NAME_KEY]: projectName,
    DeployedAt: new Date().toISOString(),
    TrafficScale: trafficScale,
    MonthlyBudget: String(monthlyBudget),
  };
}
