import type {
  ArchitectureRule,
  ArchitectureDecision,
  AwsRegion,
  BudgetCheckResult,
  CodeAnalysis,
  CostBreakdown,
  CostLineItem,
  EvaluationResult,
  RegionPriceTable,
  UserInput,
} from './rule-types.js';

// ─── Cost Reference Table (ap-northeast-2, on-demand, 2026) ──────────────────

export const AP_NORTHEAST_2_PRICES: RegionPriceTable = {
  region: 'ap-northeast-2',
  ec2: [
    { instanceType: 't4g.nano',   arch: 'arm64',  monthlyCost: 3.07,  vcpu: 2, memoryGb: 0.5 },
    { instanceType: 't4g.micro',  arch: 'arm64',  monthlyCost: 6.13,  vcpu: 2, memoryGb: 1   },
    { instanceType: 't4g.small',  arch: 'arm64',  monthlyCost: 12.26, vcpu: 2, memoryGb: 2   },
    { instanceType: 't4g.medium', arch: 'arm64',  monthlyCost: 24.53, vcpu: 2, memoryGb: 4   },
    { instanceType: 't3.nano',    arch: 'x86_64', monthlyCost: 3.80,  vcpu: 2, memoryGb: 0.5 },
    { instanceType: 't3.micro',   arch: 'x86_64', monthlyCost: 7.59,  vcpu: 2, memoryGb: 1   },
    { instanceType: 't3.small',   arch: 'x86_64', monthlyCost: 15.18, vcpu: 2, memoryGb: 2   },
    { instanceType: 't3.medium',  arch: 'x86_64', monthlyCost: 30.37, vcpu: 2, memoryGb: 4   },
    { instanceType: 't3.large',   arch: 'x86_64', monthlyCost: 60.74, vcpu: 2, memoryGb: 8   },
    { instanceType: 'm5.large',   arch: 'x86_64', monthlyCost: 87.60, vcpu: 2, memoryGb: 8   },
  ],
  rds: [
    { instanceType: 'db.t3.micro',   arch: 'x86_64', monthlyCost: 13.14, vcpu: 2, memoryGb: 1  },
    { instanceType: 'db.t3.small',   arch: 'x86_64', monthlyCost: 26.28, vcpu: 2, memoryGb: 2  },
    { instanceType: 'db.t3.medium',  arch: 'x86_64', monthlyCost: 52.56, vcpu: 2, memoryGb: 4  },
    { instanceType: 'db.t3.large',   arch: 'x86_64', monthlyCost: 105.12, vcpu: 2, memoryGb: 8 },
    { instanceType: 'db.t4g.micro',  arch: 'arm64',  monthlyCost: 11.04, vcpu: 2, memoryGb: 1  },
    { instanceType: 'db.t4g.small',  arch: 'arm64',  monthlyCost: 22.08, vcpu: 2, memoryGb: 2  },
    { instanceType: 'db.t4g.medium', arch: 'arm64',  monthlyCost: 44.16, vcpu: 2, memoryGb: 4  },
  ],
  ebsGp3PerGbMonth: 0.08,
  albPerHour: 0.018,
};

export const PRICE_TABLES: Record<AwsRegion, RegionPriceTable> = {
  'ap-northeast-2': AP_NORTHEAST_2_PRICES,
  'us-east-1': {
    ...AP_NORTHEAST_2_PRICES,
    region: 'us-east-1',
    ec2: AP_NORTHEAST_2_PRICES.ec2.map(p => ({ ...p, monthlyCost: p.monthlyCost * 0.9 })),
    rds: AP_NORTHEAST_2_PRICES.rds.map(p => ({ ...p, monthlyCost: p.monthlyCost * 0.88 })),
    ebsGp3PerGbMonth: 0.08,
    albPerHour: 0.018,
  },
  'us-west-2': {
    ...AP_NORTHEAST_2_PRICES,
    region: 'us-west-2',
    ec2: AP_NORTHEAST_2_PRICES.ec2.map(p => ({ ...p, monthlyCost: p.monthlyCost * 0.9 })),
    rds: AP_NORTHEAST_2_PRICES.rds.map(p => ({ ...p, monthlyCost: p.monthlyCost * 0.88 })),
    ebsGp3PerGbMonth: 0.08,
    albPerHour: 0.018,
  },
  'eu-west-1': {
    ...AP_NORTHEAST_2_PRICES,
    region: 'eu-west-1',
    ec2: AP_NORTHEAST_2_PRICES.ec2.map(p => ({ ...p, monthlyCost: p.monthlyCost * 0.95 })),
    rds: AP_NORTHEAST_2_PRICES.rds.map(p => ({ ...p, monthlyCost: p.monthlyCost * 0.95 })),
    ebsGp3PerGbMonth: 0.088,
    albPerHour: 0.02,
  },
};

// ─── Extensible Rule Table ────────────────────────────────────────────────────

export const ARCHITECTURE_RULES: ArchitectureRule[] = [
  {
    id: 'personal-no-db',
    description: '개인/사이드 프로젝트, DB 불필요',
    priority: 10,
    condition: (u, c) => u.trafficScale === 'personal' && !c.needsDatabase,
    action: {
      vpc: { type: 'default' },
      ec2: { instanceType: 't4g.micro', arch: 'arm64', alb: false },
    },
  },
  {
    id: 'personal-with-db-disposable',
    description: '개인/사이드 프로젝트, DB 있음, 데이터 날려도 됨',
    priority: 11,
    condition: (u, c) =>
      u.trafficScale === 'personal' &&
      c.needsDatabase &&
      u.dbCriticality === 'disposable',
    action: {
      vpc: { type: 'default' },
      ec2: { instanceType: 't4g.micro', arch: 'arm64', alb: false },
      rds: { instanceType: 'db.t3.micro', multiAz: false, backupRetentionDays: 0 },
    },
  },
  {
    id: 'personal-with-db-backup',
    description: '개인/사이드 프로젝트, DB 있음, 백업 필요',
    priority: 12,
    condition: (u, c) =>
      u.trafficScale === 'personal' &&
      c.needsDatabase &&
      u.dbCriticality === 'backup-needed',
    action: {
      vpc: { type: 'default' },
      ec2: { instanceType: 't4g.micro', arch: 'arm64', alb: false },
      rds: { instanceType: 'db.t3.micro', multiAz: false, backupRetentionDays: 1 },
    },
  },
  {
    id: 'team-no-db',
    description: '팀/사내 서비스, DB 불필요',
    priority: 20,
    condition: (u, c) => u.trafficScale === 'team' && !c.needsDatabase,
    action: {
      vpc: { type: 'default' },
      ec2: { instanceType: 't3.small', arch: 'x86_64', alb: false },
    },
  },
  {
    id: 'team-with-db-backup',
    description: '팀/사내 서비스, DB 있음, 백업 필요',
    priority: 21,
    condition: (u, c) =>
      u.trafficScale === 'team' &&
      c.needsDatabase &&
      (u.dbCriticality === 'backup-needed' || u.dbCriticality === 'disposable'),
    action: {
      vpc: { type: 'default' },
      ec2: { instanceType: 't3.small', arch: 'x86_64', alb: false },
      rds: { instanceType: 'db.t3.small', multiAz: false, backupRetentionDays: 7 },
    },
  },
  {
    id: 'team-with-db-ha',
    description: '팀/사내 서비스, DB 있음, 무중단 필요',
    priority: 22,
    condition: (u, c) =>
      u.trafficScale === 'team' &&
      c.needsDatabase &&
      u.dbCriticality === 'ha-required',
    action: {
      vpc: { type: 'default' },
      ec2: { instanceType: 't3.medium', arch: 'x86_64', alb: true },
      rds: { instanceType: 'db.t3.small', multiAz: true, backupRetentionDays: 7 },
    },
  },
  {
    id: 'production-no-db',
    description: '프로덕션, DB 불필요',
    priority: 30,
    condition: (u, _c) => u.trafficScale === 'production' && !_c.needsDatabase,
    action: {
      vpc: { type: 'new', publicSubnets: 2, privateSubnets: 2 },
      ec2: {
        instanceType: 't3.medium',
        arch: 'x86_64',
        alb: true,
        autoScaling: { min: 2, max: 10, targetCpuPercent: 70 },
      },
    },
  },
  {
    id: 'production-with-db',
    description: '프로덕션, DB 있음',
    priority: 31,
    condition: (u, c) => u.trafficScale === 'production' && c.needsDatabase,
    action: {
      vpc: { type: 'new', publicSubnets: 2, privateSubnets: 2 },
      ec2: {
        instanceType: 't3.medium',
        arch: 'x86_64',
        alb: true,
        autoScaling: { min: 2, max: 10, targetCpuPercent: 70 },
      },
      rds: { instanceType: 'db.t3.medium', multiAz: true, backupRetentionDays: 7 },
    },
  },
];

// ─── Cost Calculation ─────────────────────────────────────────────────────────

export function calculateMonthlyCost(
  decision: ArchitectureDecision,
  region: AwsRegion = 'ap-northeast-2'
): CostBreakdown {
  const prices = PRICE_TABLES[region];
  const items: CostLineItem[] = [];

  const ec2Price = prices.ec2.find(p => p.instanceType === decision.ec2.instanceType);
  if (ec2Price) {
    const minInstances = decision.ec2.autoScaling?.min ?? 1;
    items.push({
      label: `EC2 ${decision.ec2.instanceType} × ${minInstances}`,
      instanceType: decision.ec2.instanceType,
      monthlyCost: parseFloat((ec2Price.monthlyCost * minInstances).toFixed(2)),
    });
  }

  const ebsGb = decision.ec2.ebsVolumeGb;
  items.push({
    label: `EBS gp3 ${ebsGb}GB`,
    monthlyCost: parseFloat((ebsGb * prices.ebsGp3PerGbMonth).toFixed(2)),
  });

  if (decision.ec2.alb) {
    const albMonthly = parseFloat((prices.albPerHour * 730).toFixed(2));
    items.push({ label: 'ALB', monthlyCost: albMonthly });
  }

  if (decision.rds) {
    const rdsPrice = prices.rds.find(p => p.instanceType === decision.rds!.instanceType);
    if (rdsPrice) {
      const multiAzMultiplier = decision.rds.multiAz ? 2 : 1;
      const rdsCost = parseFloat((rdsPrice.monthlyCost * multiAzMultiplier).toFixed(2));
      const label = decision.rds.multiAz
        ? `RDS ${decision.rds.instanceType} Multi-AZ`
        : `RDS ${decision.rds.instanceType}`;
      items.push({ label, instanceType: decision.rds.instanceType, monthlyCost: rdsCost });

      const rdsStorageCost = parseFloat((decision.rds.storageGb * prices.ebsGp3PerGbMonth).toFixed(2));
      items.push({ label: `RDS Storage ${decision.rds.storageGb}GB`, monthlyCost: rdsStorageCost });
    }
  }

  const total = parseFloat(items.reduce((sum, item) => sum + item.monthlyCost, 0).toFixed(2));

  return { items, total, currency: 'USD', region };
}

// ─── Budget Check ─────────────────────────────────────────────────────────────

function buildDecisionFromRule(
  rule: ArchitectureRule,
  userInput: UserInput,
  codeAnalysis: CodeAnalysis,
  region: AwsRegion
): ArchitectureDecision {
  const dbEngine =
    codeAnalysis.dbEngine !== 'none' && codeAnalysis.dbEngine !== 'mongodb'
      ? codeAnalysis.dbEngine
      : 'postgresql';

  const rds = rule.action.rds
    ? {
        instanceType: rule.action.rds.instanceType ?? 'db.t3.micro',
        engine: (rule.action.rds.engine ?? dbEngine) as Exclude<typeof codeAnalysis.dbEngine, 'none' | 'mongodb'>,
        multiAz: rule.action.rds.multiAz,
        backupRetentionDays: rule.action.rds.backupRetentionDays,
        storageGb: rule.action.rds.storageGb ?? 20,
      }
    : undefined;

  const ec2: ArchitectureDecision['ec2'] = {
    instanceType: rule.action.ec2.instanceType,
    arch: rule.action.ec2.arch,
    alb: rule.action.ec2.alb,
    ...(rule.action.ec2.autoScaling !== undefined && { autoScaling: rule.action.ec2.autoScaling }),
    ebsVolumeGb: rule.action.ec2.ebsVolumeGb ?? 20,
  };

  const tags: Record<string, string> = {
    ManagedBy: 'aws-deploy-optimizer',
    ProjectName: codeAnalysis.projectName,
    DeployedAt: new Date().toISOString(),
    TrafficScale: userInput.trafficScale,
    MonthlyBudget: String(userInput.monthlyBudget),
  };

  const decision: ArchitectureDecision = {
    ruleId: rule.id,
    vpc: rule.action.vpc,
    ec2,
    ...(rds !== undefined && { rds }),
    region,
    tags,
    estimatedMonthlyCost: 0,
    withinBudget: false,
  };

  const cost = calculateMonthlyCost(decision, region);
  decision.estimatedMonthlyCost = cost.total;
  decision.withinBudget = cost.total <= userInput.monthlyBudget;

  return decision;
}

function findCheaperAlternative(
  userInput: UserInput,
  codeAnalysis: CodeAnalysis,
  region: AwsRegion
): ArchitectureDecision | undefined {
  const downgradedInput: UserInput = {
    ...userInput,
    trafficScale:
      userInput.trafficScale === 'production'
        ? 'team'
        : userInput.trafficScale === 'team'
        ? 'personal'
        : 'personal',
  };

  const sortedRules = [...ARCHITECTURE_RULES].sort((a, b) => a.priority - b.priority);
  const fallbackRule = sortedRules.find(rule =>
    rule.condition(downgradedInput, codeAnalysis)
  );

  if (!fallbackRule) return undefined;

  return buildDecisionFromRule(fallbackRule, downgradedInput, codeAnalysis, region);
}

export function checkBudget(
  decision: ArchitectureDecision,
  userInput: UserInput,
  codeAnalysis: CodeAnalysis
): BudgetCheckResult {
  const withinBudget = decision.estimatedMonthlyCost <= userInput.monthlyBudget;
  const overageAmount = Math.max(0, parseFloat(
    (decision.estimatedMonthlyCost - userInput.monthlyBudget).toFixed(2)
  ));

  if (withinBudget) {
    return {
      withinBudget: true,
      estimatedCost: decision.estimatedMonthlyCost,
      budget: userInput.monthlyBudget,
      overageAmount: 0,
    };
  }

  const alternative = findCheaperAlternative(userInput, codeAnalysis, decision.region);

  return {
    withinBudget: false,
    estimatedCost: decision.estimatedMonthlyCost,
    budget: userInput.monthlyBudget,
    overageAmount,
    ...(alternative !== undefined && {
      alternativeDecision: alternative,
      alternativeCost: alternative.estimatedMonthlyCost,
    }),
  };
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export function evaluateRules(
  userInput: UserInput,
  codeAnalysis: CodeAnalysis,
  region: AwsRegion = 'ap-northeast-2'
): EvaluationResult {
  const sortedRules = [...ARCHITECTURE_RULES].sort((a, b) => a.priority - b.priority);

  const matchedRule = sortedRules.find(rule => rule.condition(userInput, codeAnalysis));

  if (!matchedRule) {
    throw new Error(
      `No rule matched for trafficScale=${userInput.trafficScale}, ` +
      `needsDatabase=${codeAnalysis.needsDatabase}, ` +
      `dbCriticality=${userInput.dbCriticality}`
    );
  }

  const decision = buildDecisionFromRule(matchedRule, userInput, codeAnalysis, region);
  const costBreakdown = calculateMonthlyCost(decision, region);
  const budgetCheck = checkBudget(decision, userInput, codeAnalysis);

  return {
    decision,
    costBreakdown,
    budgetCheck,
    matchedRuleId: matchedRule.id,
  };
}
