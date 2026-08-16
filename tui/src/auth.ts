import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface AwsIdentity {
  accountId: string;
  arn: string;
  userId: string;
}

export async function checkCredentials(): Promise<AwsIdentity | null> {
  try {
    const client = new STSClient({
      region: process.env['AWS_REGION'] ?? process.env['AWS_DEFAULT_REGION'] ?? 'ap-northeast-2',
    });
    const response = await client.send(new GetCallerIdentityCommand({}));
    if (!response.Account) return null;
    return {
      accountId: response.Account,
      arn: response.Arn ?? '',
      userId: response.UserId ?? '',
    };
  } catch {
    return null;
  }
}

export function saveCredentials(
  accessKeyId: string,
  secretAccessKey: string,
  region: string,
): void {
  const awsDir = join(homedir(), '.aws');
  mkdirSync(awsDir, { recursive: true });

  // ~/.aws/credentials
  const credsPath = join(awsDir, 'credentials');
  let credsContent = existsSync(credsPath) ? readFileSync(credsPath, 'utf-8') : '';

  // Replace or append [default] block
  const defaultBlock = `[default]\naws_access_key_id = ${accessKeyId}\naws_secret_access_key = ${secretAccessKey}\n`;
  if (credsContent.includes('[default]')) {
    credsContent = credsContent.replace(
      /\[default\][\s\S]*?(?=\[|\s*$)/,
      defaultBlock + '\n'
    );
  } else {
    credsContent = defaultBlock + '\n' + credsContent;
  }
  writeFileSync(credsPath, credsContent, { mode: 0o600 });

  // ~/.aws/config
  const configPath = join(awsDir, 'config');
  let configContent = existsSync(configPath) ? readFileSync(configPath, 'utf-8') : '';
  const configBlock = `[default]\nregion = ${region}\noutput = json\n`;
  if (configContent.includes('[default]')) {
    configContent = configContent.replace(
      /\[default\][\s\S]*?(?=\[|\s*$)/,
      configBlock + '\n'
    );
  } else {
    configContent = configBlock + '\n' + configContent;
  }
  writeFileSync(configPath, configContent, { mode: 0o600 });

  // Set for current process so AWS SDK picks up immediately
  process.env['AWS_ACCESS_KEY_ID'] = accessKeyId;
  process.env['AWS_SECRET_ACCESS_KEY'] = secretAccessKey;
  process.env['AWS_REGION'] = region;
}
