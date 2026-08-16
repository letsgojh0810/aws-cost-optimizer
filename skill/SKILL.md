---
name: aws-deploy-optimizer
description: >
  프로젝트를 분석해 AWS 아키텍처를 추천하고, 오버스펙 없이
  최적 사이즈로 EC2/RDS를 배포한다. "AWS에 배포해줘",
  "이거 클라우드에 띄워줘", "서버 올려줘", "배포해줘" 같은
  요청에 반응한다.
triggers:
  - "AWS에 배포"
  - "클라우드에 띄워"
  - "서버 올려"
  - "EC2 배포"
  - "배포해줘"
  - "aws deploy"
  - "cloud deploy"
---

# AWS Deploy Optimizer Skill

## 목적

코드베이스를 분석해 불필요한 오버스펙 없이 AWS에 배포하고,
배포 후에도 지속적으로 비용을 관찰·재최적화한다.

네트워킹 세부사항(VPC, 서브넷, 가용영역 등)은 내부적으로 결정하며
사용자에게 노출하지 않는다.

---

## 실행 단계

### 1단계 — 코드 분석

현재 디렉토리에서 다음을 자동 감지한다:

**언어 및 프레임워크**:
- `package.json` → Node.js/TypeScript 프로젝트, 프레임워크(Express, NestJS, Next.js 등)
- `build.gradle` / `pom.xml` → Java/Spring
- `requirements.txt` / `pyproject.toml` → Python (FastAPI, Django, Flask 등)
- `go.mod` → Go
- `Cargo.toml` → Rust

**DB 필요 여부**:
- `database.yml`, `ormconfig`, `datasource`, `DATABASE_URL` 등 설정 파일 스캔
- `prisma/schema.prisma` → PostgreSQL/MySQL
- `sequelize`, `typeorm`, `sqlalchemy`, `hibernate` import → DB 연결 확인
- 감지된 DB 엔진: `mysql` | `postgresql` | `mongodb` | `none`

**트래픽 단서**:
- README에서 "production", "enterprise", "scale" 키워드
- 부하 테스트 파일 존재 여부
- 테스트 커버리지 수준

분석 결과를 사용자에게 간략히 보여준다:
```
📦 감지된 스택: Node.js + Express
🗄️  DB: PostgreSQL (prisma 감지)
📊 예상 규모: 개인/사이드 프로젝트
```

---

### 2단계 — 사용자 질문 (3가지만)

다음 3가지를 순서대로 묻는다. VPC, 서브넷, 가용영역 같은 인프라 용어는 절대 사용하지 않는다.

**Q1. 예상 트래픽 규모는?**
```
[1] 개인/사이드 (~10명, 본인 포함 소수)
[2] 팀/사내 (~100명)
[3] 프로덕션 (100명+, 외부 서비스)
```

**Q2. DB 데이터 중요도는?** _(DB가 필요한 경우에만 질문)_
```
[1] 날려도 됨 (개발/테스트용)
[2] 백업 필요 (중요하지만 잠깐 중단은 OK)
[3] 무중단 필요 (서비스 운영 중)
```

**Q3. 월 예산 상한선은? (USD)**
```
예: 20 → 월 $20 이하로 유지
```

---

### 3단계 — 아키텍처 결정

`skill/rules/architecture-rules.ts`의 규칙 테이블을 기반으로 자동 결정한다.

결정 기준:
- 개인/사이드: 기본 VPC 재사용, ARM 인스턴스(t4g) 우선 (약 20% 저렴)
- 팀: 기본 VPC, x86 인스턴스(t3)
- 프로덕션: 전용 네트워크 자동 구성, ALB + Auto Scaling

예산 초과 시:
- 인스턴스 타입을 한 단계 다운사이징해서 재계산
- 대안 아키텍처를 함께 제안

---

### 4단계 — 미리보기 & 확인

사용자에게 비용 명세를 보여주고 확인을 받는다:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📐 추천 아키텍처 (ap-northeast-2)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  서버   EC2 t4g.micro (ARM)     $6.1/월
  DB     RDS db.t3.micro (PG)   $13.0/월
  기타   EBS 20GB gp3             $1.6/월
         ─────────────────────
  예상   합계                    $20.7/월
  예산   상한선                  $30.0/월  ✅
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[배포하기]  [사이즈 변경]  [취소]
```

---

### 5단계 — 배포 + 자동 태깅

MCP 서버의 `provision_architecture` 도구를 호출해 배포한다.

모든 리소스에 다음 태그를 자동으로 부착한다:
- `ManagedBy` = `aws-deploy-optimizer`
- `ProjectName` = _현재 디렉토리명_
- `DeployedAt` = _ISO 8601 타임스탬프_
- `TrafficScale` = _personal | team | production_
- `MonthlyBudget` = _예산 상한선 (USD)_

이 태그가 HUD와 백그라운드 수집기가 관리 대상 리소스를 식별하는 유일한 키다.

---

### 6단계 — 상태 저장소 등록

배포 완료 후 로컬 상태 저장소(SQLite)에 다음을 기록한다:

```json
{
  "projectName": "my-blog-api",
  "repoPath": "/Users/dev/my-blog-api",
  "region": "ap-northeast-2",
  "ec2InstanceId": "i-0abc123",
  "rdsInstanceId": "db-xyz456",
  "monthlyBudget": 30,
  "trafficScale": "personal",
  "deployedAt": "2026-08-16T10:00:00Z",
  "tags": { "ManagedBy": "aws-deploy-optimizer", ... }
}
```

이 레코드를 기준으로 Layer 2 백그라운드 수집기가 자동으로 모니터링을 시작한다.

---

## 재최적화 트리거

HUD에서 "내려도 돼?" 버튼을 누르거나 다음 요청이 들어올 때 이 Skill이 재호출된다:
- "다운사이징해줘"
- "비용 줄여줘"
- "사이즈 조정"
- "최적화해줘"

재호출 시에는 상태 저장소에서 현재 리소스 정보와 7일 집계 메트릭을 조회해서
LLM에 전달한다 (CloudWatch 원본 데이터가 아닌 사전 집계값만).

---

## 중요 원칙

1. **토큰 절약**: "계속 지켜보는 일"은 LLM이 하지 않는다. LLM은 ①최초 배포 설계, ②재최적화 판단 시에만 호출된다.
2. **VPC 은닉**: 사용자에게 네트워킹 개념을 노출하지 않는다. 모든 VPC/서브넷 결정은 내부 규칙 테이블이 담당한다.
3. **예산 우선**: 항상 예산 내에서 가장 적절한 스펙을 선택한다. 예산 초과 시 배포 전에 반드시 사용자에게 알린다.
4. **태그 일관성**: 관리 태그 없이는 배포하지 않는다. 태그가 HUD/수집기의 단일 진실 공급원(source of truth)이다.
