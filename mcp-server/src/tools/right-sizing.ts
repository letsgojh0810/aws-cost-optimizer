import {
  StopInstancesCommand,
  StartInstancesCommand,
  ModifyInstanceAttributeCommand,
  DescribeInstancesCommand,
  waitUntilInstanceStopped,
  waitUntilInstanceRunning,
} from '@aws-sdk/client-ec2';
import { ModifyDBInstanceCommand } from '@aws-sdk/client-rds';
import { z } from 'zod';
import { getEC2Client, getRDSClient } from '../lib/aws-client.js';
import { getProject, updateInstanceIds } from '../lib/state-store.js';

export const ApplyRightSizingInputSchema = z.object({
  projectName: z.string().min(1),
  newInstanceType: z.string().min(1),
  targetResource: z.enum(['ec2', 'rds']),
  region: z.string().default('ap-northeast-2'),
});

export type ApplyRightSizingInput = z.infer<typeof ApplyRightSizingInputSchema>;

export async function applyRightSizing(input: ApplyRightSizingInput): Promise<{
  success: boolean;
  previousInstanceType?: string;
  newInstanceType?: string;
  instanceId?: string;
  error?: string;
}> {
  try {
    const project = getProject(input.projectName);
    if (!project) throw new Error(`Project "${input.projectName}" not found`);

    if (input.targetResource === 'ec2') {
      const instanceId = project.ec2InstanceId;
      if (!instanceId) throw new Error(`No EC2 instance for "${input.projectName}"`);

      const ec2 = getEC2Client({ region: input.region });

      // Get current instance type
      const describeResponse = await ec2.send(new DescribeInstancesCommand({
        InstanceIds: [instanceId],
      }));
      const currentType = describeResponse.Reservations?.[0]?.Instances?.[0]?.InstanceType ?? 'unknown';

      // Stop → modify → start
      await ec2.send(new StopInstancesCommand({ InstanceIds: [instanceId] }));
      await waitUntilInstanceStopped(
        { client: ec2, maxWaitTime: 300 },
        { InstanceIds: [instanceId] }
      );

      await ec2.send(new ModifyInstanceAttributeCommand({
        InstanceId: instanceId,
        InstanceType: { Value: input.newInstanceType },
      }));

      await ec2.send(new StartInstancesCommand({ InstanceIds: [instanceId] }));
      await waitUntilInstanceRunning(
        { client: ec2, maxWaitTime: 300 },
        { InstanceIds: [instanceId] }
      );

      return {
        success: true,
        previousInstanceType: currentType,
        newInstanceType: input.newInstanceType,
        instanceId,
      };
    } else {
      // RDS
      const rdsInstanceId = project.rdsInstanceId;
      if (!rdsInstanceId) throw new Error(`No RDS instance for "${input.projectName}"`);

      const rds = getRDSClient({ region: input.region });

      await rds.send(new ModifyDBInstanceCommand({
        DBInstanceIdentifier: rdsInstanceId,
        DBInstanceClass: input.newInstanceType,
        ApplyImmediately: true,
      }));

      return {
        success: true,
        newInstanceType: input.newInstanceType,
        instanceId: rdsInstanceId,
      };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
