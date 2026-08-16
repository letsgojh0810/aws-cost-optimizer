import {
  CreateVpcCommand,
  CreateSubnetCommand,
  CreateInternetGatewayCommand,
  AttachInternetGatewayCommand,
  CreateRouteTableCommand,
  CreateRouteCommand,
  AssociateRouteTableCommand,
  DescribeVpcsCommand,
  CreateSecurityGroupCommand,
  AuthorizeSecurityGroupIngressCommand,
  DescribeImagesCommand,
  RunInstancesCommand,
  CreateTagsCommand,
  CreateLaunchTemplateCommand,
} from '@aws-sdk/client-ec2';
import {
  CreateDBSubnetGroupCommand,
  CreateDBInstanceCommand,
} from '@aws-sdk/client-rds';
import {
  CreateLoadBalancerCommand,
  CreateTargetGroupCommand,
  CreateListenerCommand,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import {
  CreateAutoScalingGroupCommand,
} from '@aws-sdk/client-auto-scaling';
import { GetParameterCommand } from '@aws-sdk/client-ssm';
import { z } from 'zod';

import {
  getEC2Client,
  getRDSClient,
  getELBv2Client,
  getAutoScalingClient,
  getSSMClient,
} from '../lib/aws-client.js';
import { upsertProject } from '../lib/state-store.js';
import { buildManagedTags, toAwsTags } from '../lib/tag-filter.js';

// ─── Input Schema ──────────────────────────────────────────────────────────────

export const ProvisionArchitectureInputSchema = z.object({
  projectName: z.string().min(1).max(64),
  region: z.string().default('ap-northeast-2'),
  trafficScale: z.enum(['personal', 'team', 'production']),
  monthlyBudget: z.number().positive(),
  vpc: z.object({
    type: z.enum(['default', 'new']),
    publicSubnets: z.number().int().min(1).max(4).optional(),
    privateSubnets: z.number().int().min(0).max(4).optional(),
  }),
  ec2: z.object({
    instanceType: z.string(),
    arch: z.enum(['arm64', 'x86_64']),
    alb: z.boolean(),
    ebsVolumeGb: z.number().int().min(8).max(1000).default(20),
    autoScaling: z.object({
      min: z.number().int().min(1),
      max: z.number().int().min(1),
      targetCpuPercent: z.number().min(1).max(100),
    }).optional(),
  }),
  rds: z.object({
    instanceType: z.string(),
    engine: z.enum(['mysql', 'postgresql']),
    multiAz: z.boolean(),
    backupRetentionDays: z.number().int().min(0).max(35),
    storageGb: z.number().int().min(20).max(1000).default(20),
  }).optional(),
});

export type ProvisionArchitectureInput = z.infer<typeof ProvisionArchitectureInputSchema>;

export interface ProvisionArchitectureResult {
  success: boolean;
  projectName: string;
  region: string;
  vpcId: string;
  ec2InstanceId: string;
  rdsInstanceId?: string;
  albDnsName?: string;
  securityGroupIds: string[];
  estimatedMonthlyCost: number;
  error?: string;
}

// ─── AMI Lookup ───────────────────────────────────────────────────────────────

async function getLatestAmazonLinux2023Ami(region: string, arch: 'arm64' | 'x86_64'): Promise<string> {
  const ssmClient = getSSMClient({ region });
  const archParam = arch === 'arm64' ? 'arm64' : 'x86_64';
  const paramName = `/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-${archParam}`;

  const response = await ssmClient.send(new GetParameterCommand({ Name: paramName }));
  const amiId = response.Parameter?.Value;
  if (!amiId) throw new Error(`Could not find AMI for arch=${arch} in region=${region}`);
  return amiId;
}

// ─── VPC Setup ────────────────────────────────────────────────────────────────

async function getDefaultVpcId(region: string): Promise<string> {
  const ec2 = getEC2Client({ region });
  const response = await ec2.send(new DescribeVpcsCommand({
    Filters: [{ Name: 'isDefault', Values: ['true'] }],
  }));
  const vpcId = response.Vpcs?.[0]?.VpcId;
  if (!vpcId) throw new Error('No default VPC found in region ' + region);
  return vpcId;
}

async function createNewVpc(
  region: string,
  tags: Record<string, string>,
  publicSubnetCount: number,
  privateSubnetCount: number,
): Promise<{ vpcId: string; subnetIds: string[] }> {
  const ec2 = getEC2Client({ region });

  const vpcResponse = await ec2.send(new CreateVpcCommand({
    CidrBlock: '10.0.0.0/16',
    TagSpecifications: [{
      ResourceType: 'vpc',
      Tags: toAwsTags({ ...tags, Name: `${tags['ProjectName']}-vpc` }),
    }],
  }));
  const vpcId = vpcResponse.Vpc?.VpcId;
  if (!vpcId) throw new Error('Failed to create VPC');

  const igwResponse = await ec2.send(new CreateInternetGatewayCommand({
    TagSpecifications: [{
      ResourceType: 'internet-gateway',
      Tags: toAwsTags({ ...tags, Name: `${tags['ProjectName']}-igw` }),
    }],
  }));
  const igwId = igwResponse.InternetGateway?.InternetGatewayId;
  if (!igwId) throw new Error('Failed to create Internet Gateway');

  await ec2.send(new AttachInternetGatewayCommand({ InternetGatewayId: igwId, VpcId: vpcId }));

  const routeTableResponse = await ec2.send(new CreateRouteTableCommand({
    VpcId: vpcId,
    TagSpecifications: [{
      ResourceType: 'route-table',
      Tags: toAwsTags({ ...tags, Name: `${tags['ProjectName']}-public-rt` }),
    }],
  }));
  const routeTableId = routeTableResponse.RouteTable?.RouteTableId;
  if (!routeTableId) throw new Error('Failed to create route table');

  await ec2.send(new CreateRouteCommand({
    RouteTableId: routeTableId,
    DestinationCidrBlock: '0.0.0.0/0',
    GatewayId: igwId,
  }));

  const subnetIds: string[] = [];
  const azSuffixes = ['a', 'b', 'c', 'd'];

  for (let i = 0; i < publicSubnetCount; i++) {
    const subnetResponse = await ec2.send(new CreateSubnetCommand({
      VpcId: vpcId,
      CidrBlock: `10.0.${i}.0/24`,
      AvailabilityZone: `${region}${azSuffixes[i] ?? 'a'}`,
      TagSpecifications: [{
        ResourceType: 'subnet',
        Tags: toAwsTags({ ...tags, Name: `${tags['ProjectName']}-public-${i + 1}` }),
      }],
    }));
    const subnetId = subnetResponse.Subnet?.SubnetId;
    if (!subnetId) throw new Error(`Failed to create public subnet ${i + 1}`);
    subnetIds.push(subnetId);
    await ec2.send(new AssociateRouteTableCommand({ SubnetId: subnetId, RouteTableId: routeTableId }));
  }

  for (let i = 0; i < privateSubnetCount; i++) {
    const subnetResponse = await ec2.send(new CreateSubnetCommand({
      VpcId: vpcId,
      CidrBlock: `10.0.${publicSubnetCount + i}.0/24`,
      AvailabilityZone: `${region}${azSuffixes[i] ?? 'a'}`,
      TagSpecifications: [{
        ResourceType: 'subnet',
        Tags: toAwsTags({ ...tags, Name: `${tags['ProjectName']}-private-${i + 1}` }),
      }],
    }));
    const subnetId = subnetResponse.Subnet?.SubnetId;
    if (!subnetId) throw new Error(`Failed to create private subnet ${i + 1}`);
    subnetIds.push(subnetId);
  }

  return { vpcId, subnetIds };
}

// ─── Security Groups ──────────────────────────────────────────────────────────

async function createSecurityGroups(
  region: string,
  vpcId: string,
  projectName: string,
  tags: Record<string, string>,
  rdsEngine?: 'mysql' | 'postgresql',
): Promise<{ ec2SgId: string; rdsSgId?: string }> {
  const ec2 = getEC2Client({ region });

  const ec2SgResponse = await ec2.send(new CreateSecurityGroupCommand({
    GroupName: `${projectName}-ec2-sg`,
    Description: `EC2 security group for ${projectName}`,
    VpcId: vpcId,
    TagSpecifications: [{
      ResourceType: 'security-group',
      Tags: toAwsTags({ ...tags, Name: `${projectName}-ec2-sg` }),
    }],
  }));
  const ec2SgId = ec2SgResponse.GroupId;
  if (!ec2SgId) throw new Error('Failed to create EC2 security group');

  await ec2.send(new AuthorizeSecurityGroupIngressCommand({
    GroupId: ec2SgId,
    IpPermissions: [
      { IpProtocol: 'tcp', FromPort: 80, ToPort: 80, IpRanges: [{ CidrIp: '0.0.0.0/0' }] },
      { IpProtocol: 'tcp', FromPort: 443, ToPort: 443, IpRanges: [{ CidrIp: '0.0.0.0/0' }] },
      { IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: '0.0.0.0/0' }] },
    ],
  }));

  if (!rdsEngine) return { ec2SgId };

  const rdsSgResponse = await ec2.send(new CreateSecurityGroupCommand({
    GroupName: `${projectName}-rds-sg`,
    Description: `RDS security group for ${projectName}`,
    VpcId: vpcId,
    TagSpecifications: [{
      ResourceType: 'security-group',
      Tags: toAwsTags({ ...tags, Name: `${projectName}-rds-sg` }),
    }],
  }));
  const rdsSgId = rdsSgResponse.GroupId;
  if (!rdsSgId) throw new Error('Failed to create RDS security group');

  const dbPort = rdsEngine === 'mysql' ? 3306 : 5432;
  await ec2.send(new AuthorizeSecurityGroupIngressCommand({
    GroupId: rdsSgId,
    IpPermissions: [{
      IpProtocol: 'tcp',
      FromPort: dbPort,
      ToPort: dbPort,
      UserIdGroupPairs: [{ GroupId: ec2SgId }],
    }],
  }));

  return { ec2SgId, rdsSgId };
}

// ─── Main Provision Function ──────────────────────────────────────────────────

export async function provisionArchitecture(
  input: ProvisionArchitectureInput,
): Promise<ProvisionArchitectureResult> {
  const { projectName, region, trafficScale, monthlyBudget, vpc, ec2: ec2Config, rds } = input;
  const tags = buildManagedTags(projectName, trafficScale, monthlyBudget);

  try {
    // Step 1: VPC
    let vpcId: string;
    let subnetIds: string[] = [];

    if (vpc.type === 'default') {
      vpcId = await getDefaultVpcId(region);
    } else {
      const result = await createNewVpc(
        region,
        tags,
        vpc.publicSubnets ?? 2,
        vpc.privateSubnets ?? 2,
      );
      vpcId = result.vpcId;
      subnetIds = result.subnetIds;
    }

    // Step 2: Security Groups
    const { ec2SgId, rdsSgId } = await createSecurityGroups(
      region,
      vpcId,
      projectName,
      tags,
      rds?.engine,
    );

    // Step 3: EC2 Instance
    const amiId = await getLatestAmazonLinux2023Ami(region, ec2Config.arch);
    const ec2Client = getEC2Client({ region });

    const runResponse = await ec2Client.send(new RunInstancesCommand({
      ImageId: amiId,
      InstanceType: ec2Config.instanceType as never,
      MinCount: 1,
      MaxCount: 1,
      SecurityGroupIds: [ec2SgId],
      ...(subnetIds.length > 0 && { SubnetId: subnetIds[0] }),
      BlockDeviceMappings: [{
        DeviceName: '/dev/xvda',
        Ebs: {
          VolumeSize: ec2Config.ebsVolumeGb,
          VolumeType: 'gp3',
          DeleteOnTermination: true,
        },
      }],
      TagSpecifications: [{
        ResourceType: 'instance',
        Tags: toAwsTags({ ...tags, Name: projectName }),
      }],
    }));

    const ec2InstanceId = runResponse.Instances?.[0]?.InstanceId;
    if (!ec2InstanceId) throw new Error('EC2 instance launch failed');

    const securityGroupIds = [ec2SgId];
    if (rdsSgId) securityGroupIds.push(rdsSgId);

    // Step 4: RDS
    let rdsInstanceId: string | undefined;
    if (rds && rdsSgId) {
      const rdsClient = getRDSClient({ region });
      const subnetGroupName = `${projectName}-subnet-group`;

      if (subnetIds.length >= 2) {
        await rdsClient.send(new CreateDBSubnetGroupCommand({
          DBSubnetGroupName: subnetGroupName,
          DBSubnetGroupDescription: `Subnet group for ${projectName}`,
          SubnetIds: subnetIds.slice(0, 2),
          Tags: toAwsTags(tags),
        }));
      }

      const engineMap = { mysql: 'mysql', postgresql: 'postgres' } as const;
      const engineVersionMap = { mysql: '8.0', postgresql: '16.1' } as const;

      const rdsResponse = await rdsClient.send(new CreateDBInstanceCommand({
        DBInstanceIdentifier: `${projectName}-db`,
        DBInstanceClass: rds.instanceType,
        Engine: engineMap[rds.engine],
        EngineVersion: engineVersionMap[rds.engine],
        MasterUsername: 'admin',
        MasterUserPassword: `${projectName}-${Date.now()}`,
        AllocatedStorage: rds.storageGb,
        StorageType: 'gp3',
        MultiAZ: rds.multiAz,
        BackupRetentionPeriod: rds.backupRetentionDays,
        VpcSecurityGroupIds: [rdsSgId],
        ...(subnetIds.length >= 2 && { DBSubnetGroupName: subnetGroupName }),
        Tags: toAwsTags(tags),
        DeletionProtection: rds.backupRetentionDays > 0,
      }));

      rdsInstanceId = rdsResponse.DBInstance?.DBInstanceIdentifier;
    }

    // Step 5: ALB
    let albDnsName: string | undefined;
    if (ec2Config.alb && subnetIds.length >= 2) {
      const elbClient = getELBv2Client({ region });

      const albResponse = await elbClient.send(new CreateLoadBalancerCommand({
        Name: `${projectName}-alb`,
        Subnets: subnetIds.slice(0, 2),
        SecurityGroups: [ec2SgId],
        Tags: toAwsTags(tags) as { Key: string; Value: string }[],
      }));

      const albArn = albResponse.LoadBalancers?.[0]?.LoadBalancerArn;
      albDnsName = albResponse.LoadBalancers?.[0]?.DNSName;

      if (albArn) {
        const tgResponse = await elbClient.send(new CreateTargetGroupCommand({
          Name: `${projectName}-tg`,
          Protocol: 'HTTP',
          Port: 80,
          VpcId: vpcId,
          TargetType: 'instance',
        }));

        const tgArn = tgResponse.TargetGroups?.[0]?.TargetGroupArn;
        if (tgArn) {
          await elbClient.send(new CreateListenerCommand({
            LoadBalancerArn: albArn,
            Protocol: 'HTTP',
            Port: 80,
            DefaultActions: [{ Type: 'forward', TargetGroupArn: tgArn }],
          }));
        }
      }
    }

    // Step 6: Auto Scaling Group
    if (ec2Config.autoScaling && subnetIds.length > 0) {
      const asgClient = getAutoScalingClient({ region });

      await ec2Client.send(new CreateLaunchTemplateCommand({
        LaunchTemplateName: `${projectName}-lt`,
        LaunchTemplateData: {
          ImageId: amiId,
          InstanceType: ec2Config.instanceType as never,
          SecurityGroupIds: [ec2SgId],
          TagSpecifications: [{
            ResourceType: 'instance',
            Tags: toAwsTags({ ...tags, Name: projectName }),
          }],
        },
      }));

      await asgClient.send(new CreateAutoScalingGroupCommand({
        AutoScalingGroupName: `${projectName}-asg`,
        LaunchTemplate: { LaunchTemplateName: `${projectName}-lt`, Version: '$Latest' },
        MinSize: ec2Config.autoScaling.min,
        MaxSize: ec2Config.autoScaling.max,
        DesiredCapacity: ec2Config.autoScaling.min,
        VPCZoneIdentifier: subnetIds.slice(0, 2).join(','),
        Tags: Object.entries(tags).map(([Key, Value]) => ({
          Key, Value, ResourceId: `${projectName}-asg`, ResourceType: 'auto-scaling-group', PropagateAtLaunch: true,
        })),
      }));
    }

    // Step 7: Save to state store
    upsertProject({
      id: `${projectName}-${region}`,
      projectName,
      repoPath: null,
      region,
      ec2InstanceId,
      rdsInstanceId: rdsInstanceId ?? null,
      monthlyBudget,
      trafficScale,
      deployedAt: new Date().toISOString(),
      tags,
    });

    return {
      success: true,
      projectName,
      region,
      vpcId,
      ec2InstanceId,
      ...(rdsInstanceId !== undefined && { rdsInstanceId }),
      ...(albDnsName !== undefined && { albDnsName }),
      securityGroupIds,
      estimatedMonthlyCost: monthlyBudget,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      projectName,
      region,
      vpcId: '',
      ec2InstanceId: '',
      securityGroupIds: [],
      estimatedMonthlyCost: 0,
      error: message,
    };
  }
}
