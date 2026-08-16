#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import {
  provisionArchitecture,
  ProvisionArchitectureInputSchema,
} from './tools/provision-architecture.js';
import {
  createShutdownSchedule,
  listShutdownSchedules,
  deleteShutdownSchedule,
  CreateScheduleInputSchema,
  DeleteScheduleInputSchema,
  ListSchedulesInputSchema,
} from './tools/shutdown-schedule.js';
import {
  applyRightSizing,
  ApplyRightSizingInputSchema,
} from './tools/right-sizing.js';
import {
  analyzeEC2Costs,
  identifyIdleInstances,
  findUnusedEbsVolumes,
  detectUnusedEips,
  recommendInstanceRightSizing,
  calculateSavingsPotential,
  AnalyzeEC2CostsInputSchema,
  IdentifyIdleInstancesInputSchema,
  FindUnusedEbsInputSchema,
  DetectUnusedEipsInputSchema,
} from './tools/ec2-analyzer.js';
import {
  getDailyCostTrend,
  getCostByService,
  getCostByTag,
  generateOptimizationReport,
  GetDailyCostTrendInputSchema,
  GetCostByServiceInputSchema,
  GetCostByTagInputSchema,
} from './tools/cost-explorer.js';

const server = new Server(
  { name: 'aws-cost-optimizer', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

// ─── Tool Definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'provision_architecture',
    description: '규칙 테이블 결과에 따라 VPC/EC2/RDS를 AWS에 실제로 프로비저닝합니다. ManagedBy 태그를 자동 부착하고 상태 저장소에 기록합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        projectName: { type: 'string', description: '프로젝트 이름' },
        region: { type: 'string', default: 'ap-northeast-2' },
        trafficScale: { type: 'string', enum: ['personal', 'team', 'production'] },
        monthlyBudget: { type: 'number' },
        vpc: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['default', 'new'] },
            publicSubnets: { type: 'number' },
            privateSubnets: { type: 'number' },
          },
          required: ['type'],
        },
        ec2: {
          type: 'object',
          properties: {
            instanceType: { type: 'string' },
            arch: { type: 'string', enum: ['arm64', 'x86_64'] },
            alb: { type: 'boolean' },
            ebsVolumeGb: { type: 'number', default: 20 },
            autoScaling: {
              type: 'object',
              properties: {
                min: { type: 'number' }, max: { type: 'number' }, targetCpuPercent: { type: 'number' },
              },
            },
          },
          required: ['instanceType', 'arch', 'alb'],
        },
        rds: {
          type: 'object',
          properties: {
            instanceType: { type: 'string' },
            engine: { type: 'string', enum: ['mysql', 'postgresql'] },
            multiAz: { type: 'boolean' },
            backupRetentionDays: { type: 'number' },
            storageGb: { type: 'number', default: 20 },
          },
          required: ['instanceType', 'engine', 'multiAz', 'backupRetentionDays'],
        },
      },
      required: ['projectName', 'vpc', 'ec2', 'trafficScale', 'monthlyBudget'],
    },
  },
  {
    name: 'create_shutdown_schedule',
    description: 'EventBridge cron으로 EC2 인스턴스 자동 중지/시작 스케줄을 생성합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        projectName: { type: 'string' },
        stopCron: { type: 'string', description: 'e.g. cron(0 19 * * ? *)' },
        startCron: { type: 'string' },
        timezone: { type: 'string', default: 'Asia/Seoul' },
        region: { type: 'string', default: 'ap-northeast-2' },
      },
      required: ['projectName', 'stopCron'],
    },
  },
  {
    name: 'list_shutdown_schedules',
    description: '관리 중인 모든 EC2 스케줄 목록을 반환합니다.',
    inputSchema: {
      type: 'object',
      properties: { region: { type: 'string', default: 'ap-northeast-2' } },
    },
  },
  {
    name: 'delete_shutdown_schedule',
    description: 'EventBridge 스케줄 규칙을 삭제합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        scheduleName: { type: 'string' },
        region: { type: 'string', default: 'ap-northeast-2' },
      },
      required: ['scheduleName'],
    },
  },
  {
    name: 'apply_right_sizing',
    description: '승인된 다운사이징을 실행합니다. EC2는 중지→타입변경→시작, RDS는 즉시 적용.',
    inputSchema: {
      type: 'object',
      properties: {
        projectName: { type: 'string' },
        newInstanceType: { type: 'string' },
        targetResource: { type: 'string', enum: ['ec2', 'rds'] },
        region: { type: 'string', default: 'ap-northeast-2' },
      },
      required: ['projectName', 'newInstanceType', 'targetResource'],
    },
  },
  {
    name: 'analyze_ec2_costs',
    description: '관리 중인 EC2 인스턴스의 월 예상 비용을 분석합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        region: { type: 'string', default: 'ap-northeast-2' },
        projectName: { type: 'string' },
      },
    },
  },
  {
    name: 'identify_idle_instances',
    description: 'CPU 사용률이 낮은 유휴 인스턴스를 찾아 다운사이징 후보를 식별합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        region: { type: 'string', default: 'ap-northeast-2' },
        cpuThresholdPercent: { type: 'number', default: 5 },
        lookbackDays: { type: 'number', default: 7 },
      },
    },
  },
  {
    name: 'find_unused_ebs_volumes',
    description: '어디에도 연결되지 않은 유휴 EBS 볼륨을 찾습니다.',
    inputSchema: {
      type: 'object',
      properties: { region: { type: 'string', default: 'ap-northeast-2' } },
    },
  },
  {
    name: 'detect_unused_eips',
    description: '실행 중인 인스턴스에 연결되지 않은 EIP를 찾습니다.',
    inputSchema: {
      type: 'object',
      properties: { region: { type: 'string', default: 'ap-northeast-2' } },
    },
  },
  {
    name: 'recommend_instance_right_sizing',
    description: '유휴 인스턴스에 대해 구체적인 다운사이징 타입과 절감 금액을 추천합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        region: { type: 'string', default: 'ap-northeast-2' },
        cpuThresholdPercent: { type: 'number', default: 5 },
        lookbackDays: { type: 'number', default: 7 },
      },
    },
  },
  {
    name: 'calculate_savings_potential',
    description: '계정 전체의 절감 가능 금액을 계산합니다 (유휴 인스턴스 + 미사용 EBS/EIP).',
    inputSchema: {
      type: 'object',
      properties: {
        region: { type: 'string', default: 'ap-northeast-2' },
        projectName: { type: 'string' },
      },
    },
  },
  {
    name: 'get_daily_cost_trend',
    description: '최근 N일간 일별 AWS 비용 추이를 반환합니다.',
    inputSchema: {
      type: 'object',
      properties: { days: { type: 'number', default: 14 } },
    },
  },
  {
    name: 'get_cost_by_service',
    description: '이번 달 서비스별 비용 내역을 반환합니다.',
    inputSchema: {
      type: 'object',
      properties: { month: { type: 'string', description: 'YYYY-MM format' } },
    },
  },
  {
    name: 'get_cost_by_tag',
    description: 'ManagedBy 태그로 필터링한 프로젝트별 비용을 반환합니다.',
    inputSchema: {
      type: 'object',
      properties: { days: { type: 'number', default: 30 } },
    },
  },
  {
    name: 'generate_optimization_report',
    description: '관리 중인 모든 프로젝트의 비용 최적화 리포트를 생성합니다.',
    inputSchema: { type: 'object', properties: {} },
  },
] as const;

// ─── List Tools Handler ───────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

// ─── Call Tool Handler ────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const input = args ?? {};

  try {
    let result: unknown;

    switch (name) {
      case 'provision_architecture':
        result = await provisionArchitecture(ProvisionArchitectureInputSchema.parse(input));
        break;
      case 'create_shutdown_schedule':
        result = await createShutdownSchedule(CreateScheduleInputSchema.parse(input));
        break;
      case 'list_shutdown_schedules':
        result = await listShutdownSchedules(ListSchedulesInputSchema.parse(input));
        break;
      case 'delete_shutdown_schedule':
        result = await deleteShutdownSchedule(DeleteScheduleInputSchema.parse(input));
        break;
      case 'apply_right_sizing':
        result = await applyRightSizing(ApplyRightSizingInputSchema.parse(input));
        break;
      case 'analyze_ec2_costs':
        result = await analyzeEC2Costs(AnalyzeEC2CostsInputSchema.parse(input));
        break;
      case 'identify_idle_instances':
        result = await identifyIdleInstances(IdentifyIdleInstancesInputSchema.parse(input));
        break;
      case 'find_unused_ebs_volumes':
        result = await findUnusedEbsVolumes(FindUnusedEbsInputSchema.parse(input));
        break;
      case 'detect_unused_eips':
        result = await detectUnusedEips(DetectUnusedEipsInputSchema.parse(input));
        break;
      case 'recommend_instance_right_sizing':
        result = await recommendInstanceRightSizing(IdentifyIdleInstancesInputSchema.parse(input));
        break;
      case 'calculate_savings_potential':
        result = await calculateSavingsPotential(AnalyzeEC2CostsInputSchema.parse(input));
        break;
      case 'get_daily_cost_trend':
        result = await getDailyCostTrend(GetDailyCostTrendInputSchema.parse(input));
        break;
      case 'get_cost_by_service':
        result = await getCostByService(GetCostByServiceInputSchema.parse(input));
        break;
      case 'get_cost_by_tag':
        result = await getCostByTag(GetCostByTagInputSchema.parse(input));
        break;
      case 'generate_optimization_report':
        result = await generateOptimizationReport({});
        break;
      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
});

// ─── Start Server ─────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
