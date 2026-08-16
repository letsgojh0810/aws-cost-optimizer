// ─── User Inputs (from the 3 questions) ───────────────────────────────────────

export type TrafficScale = 'personal' | 'team' | 'production';
export type DbCriticality = 'disposable' | 'backup-needed' | 'ha-required';
export type DbEngine = 'mysql' | 'postgresql' | 'mongodb' | 'none';
export type ProjectComplexity = 'simple' | 'moderate' | 'complex';
export type AwsRegion = 'ap-northeast-2' | 'us-east-1' | 'us-west-2' | 'eu-west-1';
export type InstanceArch = 'x86_64' | 'arm64';
export type VpcType = 'default' | 'new';

export interface UserInput {
  trafficScale: TrafficScale;
  dbCriticality: DbCriticality;
  monthlyBudget: number;
}

// ─── Code Analysis (auto-detected from codebase) ──────────────────────────────

export interface CodeAnalysis {
  language: string;
  framework: string;
  needsDatabase: boolean;
  dbEngine: DbEngine;
  estimatedComplexity: ProjectComplexity;
  projectName: string;
  repoPath: string;
}

// ─── Architecture Components ──────────────────────────────────────────────────

export interface VpcConfig {
  type: VpcType;
  publicSubnets?: number;
  privateSubnets?: number;
}

export interface AutoScalingConfig {
  min: number;
  max: number;
  targetCpuPercent: number;
}

export interface EC2Config {
  instanceType: string;
  arch: InstanceArch;
  alb: boolean;
  autoScaling?: AutoScalingConfig;
  ebsVolumeGb: number;
}

export interface RDSConfig {
  instanceType: string;
  engine: Exclude<DbEngine, 'none' | 'mongodb'>;
  multiAz: boolean;
  backupRetentionDays: number;
  storageGb: number;
}

// ─── Architecture Decision (output of rule evaluation) ────────────────────────

export interface ArchitectureDecision {
  ruleId: string;
  vpc: VpcConfig;
  ec2: EC2Config;
  rds?: RDSConfig;
  region: AwsRegion;
  tags: Record<string, string>;
  estimatedMonthlyCost: number;
  withinBudget: boolean;
}

// ─── Cost Breakdown ───────────────────────────────────────────────────────────

export interface CostLineItem {
  label: string;
  instanceType?: string;
  monthlyCost: number;
}

export interface CostBreakdown {
  items: CostLineItem[];
  total: number;
  currency: 'USD';
  region: AwsRegion;
}

// ─── Rule Definition ──────────────────────────────────────────────────────────

export type RuleCondition = (
  userInput: UserInput,
  codeAnalysis: CodeAnalysis
) => boolean;

export interface RuleAction {
  vpc: VpcConfig;
  ec2: Omit<EC2Config, 'ebsVolumeGb'> & { ebsVolumeGb?: number };
  rds?: Omit<RDSConfig, 'engine' | 'storageGb'> & {
    engine?: Exclude<DbEngine, 'none' | 'mongodb'>;
    storageGb?: number;
  };
}

export interface ArchitectureRule {
  id: string;
  description: string;
  priority: number;
  condition: RuleCondition;
  action: RuleAction;
}

// ─── Cost Reference Table ─────────────────────────────────────────────────────

export interface InstancePrice {
  instanceType: string;
  arch: InstanceArch;
  monthlyCost: number;
  vcpu: number;
  memoryGb: number;
}

export interface StoragePrice {
  type: 'gp3' | 'gp2' | 'io1';
  costPerGbMonth: number;
}

export interface RegionPriceTable {
  region: AwsRegion;
  ec2: InstancePrice[];
  rds: InstancePrice[];
  ebsGp3PerGbMonth: number;
  albPerHour: number;
}

// ─── Budget Check Result ──────────────────────────────────────────────────────

export interface BudgetCheckResult {
  withinBudget: boolean;
  estimatedCost: number;
  budget: number;
  overageAmount: number;
  alternativeDecision?: ArchitectureDecision;
  alternativeCost?: number;
}

// ─── Evaluation Result ────────────────────────────────────────────────────────

export interface EvaluationResult {
  decision: ArchitectureDecision;
  costBreakdown: CostBreakdown;
  budgetCheck: BudgetCheckResult;
  matchedRuleId: string;
}
