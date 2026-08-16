import { EC2Client } from '@aws-sdk/client-ec2';
import { RDSClient } from '@aws-sdk/client-rds';
import { CostExplorerClient } from '@aws-sdk/client-cost-explorer';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { SSMClient } from '@aws-sdk/client-ssm';
import { IAMClient } from '@aws-sdk/client-iam';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { ElasticLoadBalancingV2Client } from '@aws-sdk/client-elastic-load-balancing-v2';
import { AutoScalingClient } from '@aws-sdk/client-auto-scaling';

export type SupportedRegion =
  | 'ap-northeast-2'
  | 'us-east-1'
  | 'us-west-2'
  | 'eu-west-1';

export interface AwsClientConfig {
  region?: SupportedRegion | string;
}

function resolveRegion(config?: AwsClientConfig): string {
  return (
    config?.region ??
    process.env['AWS_REGION'] ??
    process.env['AWS_DEFAULT_REGION'] ??
    'ap-northeast-2'
  );
}

export function getEC2Client(config?: AwsClientConfig): EC2Client {
  return new EC2Client({ region: resolveRegion(config) });
}

export function getRDSClient(config?: AwsClientConfig): RDSClient {
  return new RDSClient({ region: resolveRegion(config) });
}

export function getCostExplorerClient(): CostExplorerClient {
  // Cost Explorer is only available in us-east-1
  return new CostExplorerClient({ region: 'us-east-1' });
}

export function getEventBridgeClient(config?: AwsClientConfig): EventBridgeClient {
  return new EventBridgeClient({ region: resolveRegion(config) });
}

export function getCloudWatchClient(config?: AwsClientConfig): CloudWatchClient {
  return new CloudWatchClient({ region: resolveRegion(config) });
}

export function getSSMClient(config?: AwsClientConfig): SSMClient {
  return new SSMClient({ region: resolveRegion(config) });
}

export function getIAMClient(): IAMClient {
  // IAM is global
  return new IAMClient({ region: 'us-east-1' });
}

export function getLambdaClient(config?: AwsClientConfig): LambdaClient {
  return new LambdaClient({ region: resolveRegion(config) });
}

export function getELBv2Client(config?: AwsClientConfig): ElasticLoadBalancingV2Client {
  return new ElasticLoadBalancingV2Client({ region: resolveRegion(config) });
}

export function getAutoScalingClient(config?: AwsClientConfig): AutoScalingClient {
  return new AutoScalingClient({ region: resolveRegion(config) });
}
