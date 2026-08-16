import {
  PutRuleCommand,
  PutTargetsCommand,
  DeleteRuleCommand,
  RemoveTargetsCommand,
  ListRulesCommand,
} from '@aws-sdk/client-eventbridge';
import {
  CreateFunctionCommand,
  GetFunctionCommand,
  AddPermissionCommand,
} from '@aws-sdk/client-lambda';
import {
  CreateRoleCommand,
  AttachRolePolicyCommand,
  GetRoleCommand,
} from '@aws-sdk/client-iam';
import { z } from 'zod';
import { getEventBridgeClient, getLambdaClient, getIAMClient } from '../lib/aws-client.js';
import { getProject } from '../lib/state-store.js';
import { toAwsTags } from '../lib/tag-filter.js';

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const CreateScheduleInputSchema = z.object({
  projectName: z.string().min(1),
  stopCron: z.string().describe('Cron expression for stopping (e.g. "cron(0 19 * * ? *)" for 7PM UTC)'),
  startCron: z.string().optional().describe('Cron expression for starting (optional)'),
  timezone: z.string().default('Asia/Seoul'),
  region: z.string().default('ap-northeast-2'),
});

export const DeleteScheduleInputSchema = z.object({
  scheduleName: z.string(),
  region: z.string().default('ap-northeast-2'),
});

export const ListSchedulesInputSchema = z.object({
  region: z.string().default('ap-northeast-2'),
});

export type CreateScheduleInput = z.infer<typeof CreateScheduleInputSchema>;
export type DeleteScheduleInput = z.infer<typeof DeleteScheduleInputSchema>;
export type ListSchedulesInput = z.infer<typeof ListSchedulesInputSchema>;

// ─── IAM Role Helper ──────────────────────────────────────────────────────────

async function ensureLambdaExecutionRole(projectName: string): Promise<string> {
  const iam = getIAMClient();
  const roleName = `aws-cost-optimizer-lambda-${projectName}`;

  try {
    const existing = await iam.send(new GetRoleCommand({ RoleName: roleName }));
    return existing.Role!.Arn!;
  } catch {
    // Role doesn't exist, create it
  }

  const createResponse = await iam.send(new CreateRoleCommand({
    RoleName: roleName,
    AssumeRolePolicyDocument: JSON.stringify({
      Version: '2012-10-17',
      Statement: [{
        Effect: 'Allow',
        Principal: { Service: 'lambda.amazonaws.com' },
        Action: 'sts:AssumeRole',
      }],
    }),
    Tags: toAwsTags({ ManagedBy: 'aws-deploy-optimizer', ProjectName: projectName }) as { Key: string; Value: string }[],
  }));

  const roleArn = createResponse.Role?.Arn;
  if (!roleArn) throw new Error('Failed to create Lambda execution role');

  await iam.send(new AttachRolePolicyCommand({
    RoleName: roleName,
    PolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
  }));
  await iam.send(new AttachRolePolicyCommand({
    RoleName: roleName,
    PolicyArn: 'arn:aws:iam::aws:policy/AmazonEC2FullAccess',
  }));

  // Wait for role propagation
  await new Promise(resolve => setTimeout(resolve, 10000));

  return roleArn;
}

// ─── Lambda Helper ────────────────────────────────────────────────────────────

async function ensureStopLambda(
  projectName: string,
  instanceId: string,
  region: string,
): Promise<string> {
  const lambda = getLambdaClient({ region });
  const functionName = `aws-cost-optimizer-stop-${projectName}`;

  try {
    const existing = await lambda.send(new GetFunctionCommand({ FunctionName: functionName }));
    return existing.Configuration!.FunctionArn!;
  } catch {
    // Function doesn't exist, create it
  }

  const roleArn = await ensureLambdaExecutionRole(projectName);

  const handlerCode = `
const { EC2Client, StopInstancesCommand } = require('@aws-sdk/client-ec2');
exports.handler = async () => {
  const client = new EC2Client({ region: '${region}' });
  await client.send(new StopInstancesCommand({ InstanceIds: ['${instanceId}'] }));
  return { statusCode: 200, body: 'Stopped ${instanceId}' };
};
  `.trim();

  const zipBuffer = Buffer.from(
    `UEsDBAoAAAAAABRMzlYAAAAAAAAAAAAAAAAHABwAdW5kZWZpbmVkUEsBAhQDCgAAAAAAFEzOVgAAAAAAAAAAAAAAAAcAGAAAAAAAAAAAAKSBAAAAAHVuZGVmaW5lZFBLBQYAAAAAAQABAE0AAAA=`,
    'base64'
  );

  // Create a minimal zip with the handler
  const { execSync } = await import('child_process');
  const { writeFileSync, readFileSync, mkdirSync, rmSync } = await import('fs');
  const { tmpdir } = await import('os');
  const { join } = await import('path');

  const tmpDir = join(tmpdir(), `lambda-${projectName}-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(join(tmpDir, 'index.js'), handlerCode);

  let zipData: Buffer;
  try {
    execSync(`cd ${tmpDir} && zip -r function.zip index.js`);
    zipData = readFileSync(join(tmpDir, 'function.zip'));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  const createResponse = await lambda.send(new CreateFunctionCommand({
    FunctionName: functionName,
    Runtime: 'nodejs20.x' as never,
    Role: roleArn,
    Handler: 'index.handler',
    Code: { ZipFile: zipData },
    Timeout: 30,
    Description: `Auto-stop for ${projectName} managed by aws-deploy-optimizer`,
    Tags: { ManagedBy: 'aws-deploy-optimizer', ProjectName: projectName },
  }));

  return createResponse.FunctionArn!;
}

// ─── Tool Implementations ─────────────────────────────────────────────────────

export async function createShutdownSchedule(input: CreateScheduleInput): Promise<{
  success: boolean;
  stopRuleName?: string;
  startRuleName?: string;
  error?: string;
}> {
  try {
    const project = getProject(input.projectName);
    if (!project) throw new Error(`Project "${input.projectName}" not found in state store`);
    if (!project.ec2InstanceId) throw new Error(`No EC2 instance recorded for "${input.projectName}"`);

    const eb = getEventBridgeClient({ region: input.region });
    const lambda = getLambdaClient({ region: input.region });
    const lambdaArn = await ensureStopLambda(input.projectName, project.ec2InstanceId, input.region);

    const stopRuleName = `aws-cost-optimizer-stop-${input.projectName}`;
    await eb.send(new PutRuleCommand({
      Name: stopRuleName,
      ScheduleExpression: input.stopCron,
      State: 'ENABLED',
      Description: `Auto-stop ${input.projectName} managed by aws-deploy-optimizer`,
    }));

    await lambda.send(new AddPermissionCommand({
      FunctionName: lambdaArn,
      StatementId: `allow-eventbridge-stop-${input.projectName}`,
      Action: 'lambda:InvokeFunction',
      Principal: 'events.amazonaws.com',
      SourceArn: `arn:aws:events:${input.region}:*:rule/${stopRuleName}`,
    }));

    await eb.send(new PutTargetsCommand({
      Rule: stopRuleName,
      Targets: [{ Id: '1', Arn: lambdaArn }],
    }));

    let startRuleName: string | undefined;
    if (input.startCron) {
      startRuleName = `aws-cost-optimizer-start-${input.projectName}`;
      await eb.send(new PutRuleCommand({
        Name: startRuleName,
        ScheduleExpression: input.startCron,
        State: 'ENABLED',
        Description: `Auto-start ${input.projectName} managed by aws-deploy-optimizer`,
      }));
    }

    return { success: true, stopRuleName, startRuleName };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function listShutdownSchedules(input: ListSchedulesInput): Promise<{
  schedules: Array<{ name: string; state: string; scheduleExpression: string }>;
  error?: string;
}> {
  try {
    const eb = getEventBridgeClient({ region: input.region });
    const response = await eb.send(new ListRulesCommand({
      NamePrefix: 'aws-cost-optimizer-',
    }));

    const schedules = (response.Rules ?? []).map(rule => ({
      name: rule.Name ?? '',
      state: rule.State ?? 'UNKNOWN',
      scheduleExpression: rule.ScheduleExpression ?? '',
    }));

    return { schedules };
  } catch (err) {
    return { schedules: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteShutdownSchedule(input: DeleteScheduleInput): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const eb = getEventBridgeClient({ region: input.region });

    await eb.send(new RemoveTargetsCommand({ Rule: input.scheduleName, Ids: ['1'] }));
    await eb.send(new DeleteRuleCommand({ Name: input.scheduleName }));

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
