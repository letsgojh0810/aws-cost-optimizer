import { evaluateRules, calculateMonthlyCost, checkBudget, AP_NORTHEAST_2_PRICES } from './architecture-rules';
import type { CodeAnalysis, UserInput } from './rule-types';

const BASE_CODE: CodeAnalysis = {
  language: 'TypeScript',
  framework: 'Express',
  needsDatabase: false,
  dbEngine: 'none',
  estimatedComplexity: 'simple',
  projectName: 'test-project',
  repoPath: '/tmp/test-project',
};

const BASE_USER: UserInput = {
  trafficScale: 'personal',
  dbCriticality: 'backup-needed',
  monthlyBudget: 50,
};

describe('Rule Engine — evaluateRules', () => {
  test('personal + no DB → t4g.micro ARM, default VPC, no RDS', () => {
    const result = evaluateRules(BASE_USER, BASE_CODE);
    expect(result.matchedRuleId).toBe('personal-no-db');
    expect(result.decision.ec2.instanceType).toBe('t4g.micro');
    expect(result.decision.ec2.arch).toBe('arm64');
    expect(result.decision.vpc.type).toBe('default');
    expect(result.decision.rds).toBeUndefined();
  });

  test('personal + DB + backup-needed → db.t3.micro single-AZ', () => {
    const code = { ...BASE_CODE, needsDatabase: true, dbEngine: 'postgresql' as const };
    const result = evaluateRules(BASE_USER, code);
    expect(result.matchedRuleId).toBe('personal-with-db-backup');
    expect(result.decision.rds).toBeDefined();
    expect(result.decision.rds?.multiAz).toBe(false);
    expect(result.decision.rds?.backupRetentionDays).toBe(1);
  });

  test('personal + DB + disposable → backupRetentionDays 0', () => {
    const code = { ...BASE_CODE, needsDatabase: true, dbEngine: 'postgresql' as const };
    const user = { ...BASE_USER, dbCriticality: 'disposable' as const };
    const result = evaluateRules(user, code);
    expect(result.matchedRuleId).toBe('personal-with-db-disposable');
    expect(result.decision.rds?.backupRetentionDays).toBe(0);
  });

  test('team + DB + backup-needed → t3.small, db.t3.small', () => {
    const code = { ...BASE_CODE, needsDatabase: true, dbEngine: 'mysql' as const };
    const user = { ...BASE_USER, trafficScale: 'team' as const };
    const result = evaluateRules(user, code);
    expect(result.matchedRuleId).toBe('team-with-db-backup');
    expect(result.decision.ec2.instanceType).toBe('t3.small');
    expect(result.decision.rds?.instanceType).toBe('db.t3.small');
    expect(result.decision.rds?.backupRetentionDays).toBe(7);
  });

  test('team + DB + ha-required → t3.medium, Multi-AZ', () => {
    const code = { ...BASE_CODE, needsDatabase: true, dbEngine: 'postgresql' as const };
    const user = { ...BASE_USER, trafficScale: 'team' as const, dbCriticality: 'ha-required' as const };
    const result = evaluateRules(user, code);
    expect(result.matchedRuleId).toBe('team-with-db-ha');
    expect(result.decision.rds?.multiAz).toBe(true);
    expect(result.decision.ec2.alb).toBe(true);
  });

  test('production + DB → new VPC, ALB, Auto Scaling, Multi-AZ RDS', () => {
    const code = { ...BASE_CODE, needsDatabase: true, dbEngine: 'postgresql' as const };
    const user = { ...BASE_USER, trafficScale: 'production' as const, monthlyBudget: 500 };
    const result = evaluateRules(user, code);
    expect(result.matchedRuleId).toBe('production-with-db');
    expect(result.decision.vpc.type).toBe('new');
    expect(result.decision.ec2.alb).toBe(true);
    expect(result.decision.ec2.autoScaling?.min).toBe(2);
    expect(result.decision.rds?.multiAz).toBe(true);
  });

  test('tags contain required keys', () => {
    const result = evaluateRules(BASE_USER, BASE_CODE);
    expect(result.decision.tags['ManagedBy']).toBe('aws-deploy-optimizer');
    expect(result.decision.tags['ProjectName']).toBe('test-project');
    expect(result.decision.tags['TrafficScale']).toBe('personal');
    expect(result.decision.tags['MonthlyBudget']).toBe('50');
  });
});

describe('Cost Calculation', () => {
  test('cost breakdown includes EC2, EBS items', () => {
    const result = evaluateRules(BASE_USER, BASE_CODE);
    const { items } = result.costBreakdown;
    const hasEC2 = items.some(i => i.label.includes('EC2'));
    const hasEBS = items.some(i => i.label.includes('EBS'));
    expect(hasEC2).toBe(true);
    expect(hasEBS).toBe(true);
  });

  test('Multi-AZ doubles RDS cost', () => {
    const code = { ...BASE_CODE, needsDatabase: true, dbEngine: 'postgresql' as const };
    const userSingleAz = { ...BASE_USER, trafficScale: 'team' as const, dbCriticality: 'backup-needed' as const };
    const userMultiAz = { ...BASE_USER, trafficScale: 'team' as const, dbCriticality: 'ha-required' as const };
    const single = evaluateRules(userSingleAz, code);
    const multi = evaluateRules(userMultiAz, code);
    const singleRdsCost = single.costBreakdown.items.find(i => i.label.includes('RDS') && !i.label.includes('Storage'))?.monthlyCost ?? 0;
    const multiRdsCost = multi.costBreakdown.items.find(i => i.label.includes('Multi-AZ'))?.monthlyCost ?? 0;
    expect(multiRdsCost).toBeGreaterThan(singleRdsCost);
  });

  test('ALB adds cost', () => {
    const code = { ...BASE_CODE, needsDatabase: true, dbEngine: 'postgresql' as const };
    const userNoAlb = { ...BASE_USER, trafficScale: 'personal' as const };
    const userAlb = { ...BASE_USER, trafficScale: 'team' as const, dbCriticality: 'ha-required' as const, monthlyBudget: 200 };
    const noAlb = evaluateRules(userNoAlb, code);
    const withAlb = evaluateRules(userAlb, code);
    expect(withAlb.costBreakdown.total).toBeGreaterThan(noAlb.costBreakdown.total);
  });
});

describe('Budget Check', () => {
  test('within budget → withinBudget true, no alternative', () => {
    const result = evaluateRules({ ...BASE_USER, monthlyBudget: 100 }, BASE_CODE);
    expect(result.budgetCheck.withinBudget).toBe(true);
    expect(result.budgetCheck.alternativeDecision).toBeUndefined();
  });

  test('over budget → withinBudget false, alternative provided', () => {
    const code = { ...BASE_CODE, needsDatabase: true, dbEngine: 'postgresql' as const };
    const user = { ...BASE_USER, trafficScale: 'production' as const, monthlyBudget: 5 };
    const result = evaluateRules(user, code);
    expect(result.budgetCheck.withinBudget).toBe(false);
    expect(result.budgetCheck.overageAmount).toBeGreaterThan(0);
    expect(result.budgetCheck.alternativeDecision).toBeDefined();
    expect(result.budgetCheck.alternativeCost).toBeLessThan(result.decision.estimatedMonthlyCost);
  });
});

describe('Price Table', () => {
  test('ap-northeast-2 prices are defined for common instance types', () => {
    const types = ['t4g.micro', 't3.micro', 't3.small', 't3.medium'];
    for (const t of types) {
      expect(AP_NORTHEAST_2_PRICES.ec2.find(p => p.instanceType === t)).toBeDefined();
    }
  });

  test('t4g.micro ARM is cheaper than t3.micro x86', () => {
    const arm = AP_NORTHEAST_2_PRICES.ec2.find(p => p.instanceType === 't4g.micro')!;
    const x86 = AP_NORTHEAST_2_PRICES.ec2.find(p => p.instanceType === 't3.micro')!;
    expect(arm.monthlyCost).toBeLessThan(x86.monthlyCost);
  });
});
