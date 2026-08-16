# AWS Cost Optimizer

> 코드베이스를 분석해 오버스펙 없는 AWS 아키텍처를 자동 설계·배포하고,
> 배포 이후에도 지속적으로 비용을 관찰·재최적화해주는 Claude Code 플러그인 + 전용 HUD.

## 개요

| 기존 도구의 한계 | 이 프로젝트 |
|---|---|
| 배포 자동화 **또는** 모니터링 TUI — 따로 존재 | 두 기능을 하나의 지속적 관리 루프로 통합 |
| AWS 콘솔/IaC 직접 조작 필요 | VPC·서브넷 개념 완전 은닉, 3가지 질문만 |
| LLM이 상시 실행 (비용 낭비) | LLM은 배포·재최적화 판단 시에만 소환 |
| 1회성 배포, 이후 방치 | 배포 후 24/7 자동 수집·분석·알림 |

---

## 아키텍처

```
[Layer 1] Claude Code 플러그인
  ├─ Skill (SKILL.md)         자연어 의도 인식 → 6단계 배포 워크플로우
  ├─ MCP 서버 (mcp-server/)   AWS SDK v3 실제 API 호출 — 16개 도구
  └─ 규칙 엔진 (skill/rules/) 조건-액션 테이블로 아키텍처 자동 결정

[Layer 2] 백그라운드 수집기 (packages/collector/)
  └─ EventBridge(cron) → Lambda → CloudWatch/Cost Explorer → SQLite
     LLM 없음, 1시간마다 자동 집계

[Layer 3] HUD
  ├─ TUI (tui/)   blessed-contrib 터미널 대시보드  ← 권장
  └─ Web (hud/)   Next.js 14 웹 대시보드 (port 3721)
```

---

## 디렉토리 구조

```
aws-cost-optimizer/
├── skill/
│   ├── SKILL.md                  Claude Code 스킬 정의 (트리거, 워크플로우)
│   └── rules/
│       ├── rule-types.ts         TypeScript 인터페이스 전체
│       ├── architecture-rules.ts 규칙 테이블 + evaluateRules() + calculateMonthlyCost()
│       └── architecture-rules.test.ts  14개 단위 테스트
│
├── mcp-server/
│   └── src/
│       ├── index.ts              MCP 서버 진입점 (stdio, 16개 도구 등록)
│       ├── lib/
│       │   ├── aws-client.ts     AWS SDK v3 클라이언트 팩토리
│       │   ├── state-store.ts    SQLite 상태 저장소
│       │   └── tag-filter.ts     ManagedBy 태그 유틸
│       └── tools/
│           ├── provision-architecture.ts  VPC/EC2/RDS/ALB/ASG 프로비저닝
│           ├── shutdown-schedule.ts       EventBridge 자동 중지/시작
│           ├── right-sizing.ts            인스턴스 타입 변경
│           ├── ec2-analyzer.ts            유휴 인스턴스·EBS·EIP 분석
│           └── cost-explorer.ts           비용 추이·서비스별·태그별 분석
│
├── packages/
│   ├── state-store/              SQLite ↔ DynamoDB 추상화 레이어
│   │   └── src/
│   │       ├── types.ts          ProjectRecord, MetricRecord 인터페이스
│   │       ├── schema.ts         SQL DDL (projects + metrics 테이블)
│   │       ├── adapters/
│   │       │   ├── base.ts       IStateStore 인터페이스
│   │       │   ├── sqlite.ts     SQLite 구현체
│   │       │   └── dynamodb.ts   DynamoDB 구현체
│   │       └── factory.ts        createStateStore(config)
│   │
│   └── collector/                Lambda 백그라운드 수집기
│       └── src/
│           ├── handler.ts        Lambda 핸들러 (EventBridge cron)
│           ├── cloudwatch.ts     EC2 메트릭 수집 (GetMetricDataCommand)
│           ├── cost-fetcher.ts   Cost Explorer 일별 비용 수집
│           └── aggregator.ts     avg/p95 집계, bytes→MB 변환
│
├── tui/                          터미널 HUD (blessed-contrib)
│   └── src/
│       ├── auth.ts               AWS credentials 확인 + 인터랙티브 인증 폼
│       ├── store.ts              SQLite 읽기 (read-only)
│       └── index.ts              TUI 대시보드 진입점
│
└── hud/                          웹 HUD (Next.js 14, port 3721)
    └── src/
        ├── app/                  App Router 페이지 + API routes
        ├── components/           ProjectCard, CostMeter, MetricsChart, AlertBanner
        └── lib/store-client.ts   SQLite 읽기 (server-side)
```

---

## 빠른 시작

### 1. 터미널 HUD 실행

```bash
cd tui
npm install
npm run dev
```

처음 실행 시 AWS credentials가 없으면 인증 폼이 자동으로 표시됩니다.

```
┌─────────────────────────────────────────────────┐
│  AWS 인증 설정                                    │
│  Access Key ID:   [_____________________]        │
│  Secret Key:      [•••••••••••••••••••••]        │
│  Region:          [ap-northeast-2_______]        │
│  [ 확인 (Enter) ]          [ 취소 (Esc) ]        │
└─────────────────────────────────────────────────┘
```

이미 `~/.aws/credentials`에 유효한 credentials가 있으면 바로 대시보드가 열립니다.

**키바인딩**

| 키 | 동작 |
|---|---|
| `↑` / `↓` | 프로젝트 이동 |
| `Enter` | 프로젝트 선택 |
| `r` | 수동 새로고침 |
| `q` / `Ctrl+C` | 종료 |

### 2. 웹 HUD 실행 (선택)

```bash
cd hud
npm install
npm run dev
# → http://localhost:3721
```

### 3. Claude Code에서 배포

Claude Code 터미널에서 자연어로 배포합니다:

```
AWS에 배포해줘
```

```
이거 클라우드에 띄워줘
```

스킬이 자동으로 실행되어 코드베이스를 분석하고 3가지 질문만 합니다:

```
Q1. 예상 트래픽은?
   [1] 개인/사이드 (~10명)
   [2] 팀/사내 (~100명)
   [3] 프로덕션 (100명+)

Q2. DB 데이터 중요도는?
   [1] 날려도 됨   [2] 백업 필요   [3] 무중단 필요

Q3. 월 예산 상한선은? (USD)
```

답변 후 비용 명세를 보여주고 확인을 받은 뒤 배포합니다.

---

## MCP 서버 도구 목록

### 액션 (배포·변경)

| 도구 | 설명 |
|---|---|
| `provision_architecture` | VPC/EC2/RDS/ALB/ASG 전체 프로비저닝 |
| `create_shutdown_schedule` | EventBridge cron으로 자동 중지/시작 스케줄 생성 |
| `list_shutdown_schedules` | 등록된 스케줄 목록 조회 |
| `delete_shutdown_schedule` | 스케줄 삭제 |
| `apply_right_sizing` | 인스턴스 타입 변경 (EC2: stop→resize→start) |

### 분석

| 도구 | 설명 |
|---|---|
| `analyze_ec2_costs` | 관리 중인 EC2 월 예상 비용 분석 |
| `identify_idle_instances` | CPU < 5% 유휴 인스턴스 탐지 |
| `find_unused_ebs_volumes` | 미연결 EBS 볼륨 탐지 |
| `detect_unused_eips` | 미사용 EIP 탐지 |
| `recommend_instance_right_sizing` | 다운사이징 추천 + 절감 금액 계산 |
| `calculate_savings_potential` | 계정 전체 절감 가능 금액 합산 |

### 비용 추적

| 도구 | 설명 |
|---|---|
| `get_daily_cost_trend` | 최근 N일 일별 비용 추이 |
| `get_cost_by_service` | 서비스별 비용 내역 |
| `get_cost_by_tag` | 프로젝트 태그별 비용 |
| `generate_optimization_report` | 전체 최적화 리포트 생성 |

---

## 아키텍처 결정 규칙

VPC·서브넷은 사용자에게 노출되지 않습니다. 내부 규칙 테이블이 자동으로 결정합니다.

| 트래픽 규모 | DB 여부 | EC2 | RDS | VPC |
|---|---|---|---|---|
| 개인/사이드 | 없음 | t4g.micro (ARM) | — | 기본 VPC |
| 개인/사이드 | 있음 | t4g.micro (ARM) | db.t3.micro | 기본 VPC |
| 팀/사내 | 없음 | t3.small | — | 기본 VPC |
| 팀/사내 | 백업 필요 | t3.small | db.t3.small | 기본 VPC |
| 팀/사내 | 무중단 | t3.medium + ALB | db.t3.small Multi-AZ | 기본 VPC |
| 프로덕션 | 없음 | t3.medium + ALB + ASG | — | 신규 VPC |
| 프로덕션 | 있음 | t3.medium + ALB + ASG | db.t3.medium Multi-AZ | 신규 VPC |

예산 초과 시 트래픽 단계를 자동으로 한 단계 낮춘 대안 아키텍처를 함께 제안합니다.

---

## 상태 저장소

모든 배포 메타데이터와 수집 메트릭은 `~/.aws-cost-optimizer/state.db` (SQLite)에 저장됩니다.
DynamoDB로 교체하려면 `STORE_TYPE=dynamodb` 환경변수를 설정합니다.

```
projects 테이블   — 프로젝트 메타데이터 (배포 시 1회 기록)
metrics  테이블   — 1시간 집계 메트릭 (Lambda 수집기가 자동 적재)
```

---

## 개발

```bash
# 규칙 엔진 테스트
cd skill && npm test          # 14개 단위 테스트

# MCP 서버 타입 체크
cd mcp-server && npm run typecheck

# 상태 저장소 타입 체크
cd packages/state-store && npm run typecheck

# Lambda 수집기 번들
cd packages/collector && npm run build

# TUI 빌드
cd tui && npm run build
```

---

## 기술 스택

| 컴포넌트 | 스택 |
|---|---|
| Skill | Claude Code SKILL.md + TypeScript 규칙 엔진 |
| MCP 서버 | TypeScript + `@modelcontextprotocol/sdk` + AWS SDK v3 |
| 상태 저장소 | SQLite (`better-sqlite3`) / DynamoDB (`@aws-sdk/lib-dynamodb`) |
| Lambda 수집기 | TypeScript + esbuild (CJS 번들) |
| TUI | `blessed` + `blessed-contrib` |
| 웹 HUD | Next.js 14 App Router + Tailwind CSS + Recharts |

---

## 태그 규칙

이 도구가 생성하는 모든 AWS 리소스에는 다음 태그가 자동으로 부착됩니다.
HUD와 수집기는 이 태그로 관리 대상을 식별합니다.

```
ManagedBy    = aws-deploy-optimizer
ProjectName  = <프로젝트명>
DeployedAt   = <ISO 8601 타임스탬프>
TrafficScale = personal | team | production
MonthlyBudget = <USD>
```
