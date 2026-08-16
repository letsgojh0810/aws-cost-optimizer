# AWS Cost Optimizer — Priority #1 Implementation Spec

## Scope: Skill Layer (Rule Engine)

### Files to build
1. `package.json` + `tsconfig.json` — TypeScript project config
2. `skill/SKILL.md` — Claude Code skill definition (triggers, workflow steps 1-6)
3. `skill/rules/rule-types.ts` — All TypeScript interfaces
4. `skill/rules/architecture-rules.ts` — Extensible condition-action rule engine (THE CORE)
5. `skill/rules/index.ts` — Clean exports
6. Placeholder dirs: `mcp-server/`, `hud/`

### Rule engine requirements
- Condition-action table (not if/else chains)
- `evaluateRules(userInput, codeAnalysis) → ArchitectureDecision`
- `calculateMonthlyCost(decision) → CostBreakdown`
- Budget overage → auto cheaper alternative suggestion
- ap-northeast-2 region prices hardcoded as reference table
- Zero `any` types, full TypeScript strict mode

### Key rules from spec
| trafficScale | needsDatabase | VPC | EC2 | RDS |
|---|---|---|---|---|
| personal | false | default | t4g.micro (ARM) | none |
| personal | true | default | t4g.micro (ARM) | db.t3.micro Single-AZ |
| team | false | default | t3.small | none |
| team | true | default | t3.small | db.t3.small 7-day backup |
| production | any | new (pub/priv subnets) | t3.medium + ALB + ASG min:2 | db.t3.medium Multi-AZ |

### Tagging standard
`ManagedBy=aws-deploy-optimizer`, `ProjectName=xxx`, `DeployedAt=timestamp`
