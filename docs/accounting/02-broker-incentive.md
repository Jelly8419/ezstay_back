# 02. 중개인(Broker) 인센티브 시스템

> 회계 시스템 30일 런칭 로드맵 **Week 2** 결과물
> 작성: 2026-04-23 / 브랜치: `feature/broker-incentive`

## 1. 목표

중개인이 유입시킨 임대인(호스트)의 계약에 대해, **플랫폼이 월 단위로
정산수수료(호스트 3.3%)의 일부를 중개인에게 인센티브로 지급**하는 체계를
구축. 운영자가 중개인/요율/귀속을 관리하고 월별 지급을 수동 처리할 수 있게
한다.

**PRD 원본**: "중개인(인센티브) 관리 메뉴" (2026-04-23).

---

## 2. 핵심 정책

### 2-1. 판정 기준 시점 = 결제 승인 시점 (`payments.approvedAt`)

- **활동기간 내 결제인지**: `approvedAt` 기준 (= `now` at `paymentApprovalService`)
- **몇 월 지급 대상인지**: `settlement.expected_date` 의 YYYY-MM
- 활동기간(2025-04 ~ 07) 내 결제였다면 계약이 2026-09 에 체크인해도 인센티브 발생

### 2-2. 스냅샷 불변식

결제 승인 시점에 `contracts` 에 3필드(`broker_id_snapshot`, `broker_rate_snapshot`,
`broker_type_snapshot`) 박아둔다. 이후 중개인 요율/매핑이 변경돼도 **과거
계약의 인센티브는 절대 바뀌지 않음**. Week 1 VAT 분리와 동일한 스냅샷 철학.

### 2-3. 세무 분기 (Q3 반영)

중개인 인센티브는 플랫폼의 "소득 지급" 처리. 타입에 따라 다르게 기록:

| 구분 | individual (개인) | business (사업자) |
|------|-------------------|-------------------|
| 성격 | 기타소득 | 사업소득 (세금계산서 수취) |
| 원천징수 | `withholding = floor(gross × 8.8%)` | 0 |
| VAT 분리 | 0 | `supply = floor(gross × 10/11)`, `vat = gross - supply` |
| 실지급액 | `net = gross - withholding` | `net = gross` |
| 필수 필드 | - | `tax_id` (사업자등록번호) |

**불변식** (테스트로 보장):
```
individual → gross = withholding + net,  supply = 0, vat = 0
business   → gross = supply + vat,        net = gross, withholding = 0
```

### 2-4. Settlement 상태 전환 ↔ BrokerIncentive 동기화

- BrokerIncentive 는 Settlement.create 와 **같은 트랜잭션**에서 생성 (status=PENDING)
- Settlement → READY 전환 후에는 환불 차단 ([contractController.js:2017](../../controllers/contractController.js))
  → 이 시점 이후 인센티브 역전 시나리오 원천 차단
- Settlement → ON_HOLD 전환 시 PENDING 인센티브만 ON_HOLD 동기 전환
  (AGGREGATED 는 지급 집계가 완료돼 건드리지 않음)

### 2-5. 원 미만 절사 (Math.floor) 정책

Week 1 의 feeCalculator 와 동일. 런칭 후 세무사 상담 결과에 따라 반올림 전환
가능하며, 전환 시 **기존 스냅샷은 유지** 하고 **신규 계약부터 적용**.

---

## 3. 아키텍처 개요

### 3-1. 신규 테이블 (5개)

| 테이블 | 역할 | 키 |
|--------|------|----|
| `brokers` | 중개인 마스터 (이름/연락처/타입/활동기간/계좌) | PK |
| `broker_rates` | 시간 구간별 적용률 (`effective_to=NULL` = 현재) | idx(broker_id, from, to) |
| `broker_host_mappings` | 중개인↔임대인 귀속 (`end_date=NULL` = 현재) | idx(host_id, end_date) |
| `broker_incentives` | 계약×중개인 = 1:1 스냅샷 | UNIQUE(settlement_id) |
| `broker_incentive_payouts` | 월별 지급 단위 | UNIQUE(broker_id, settlement_month) |

### 3-2. contracts 신규 컬럼 (3개)

| 컬럼 | 타입 | 기본값 |
|------|------|--------|
| `broker_id_snapshot` | INT NULL | NULL = 미귀속 |
| `broker_rate_snapshot` | DECIMAL(5,4) NULL | NULL = 미귀속 |
| `broker_type_snapshot` | ENUM('individual','business') NULL | NULL = 미귀속 |

### 3-3. 코드 구성

```
결제 요청
   │
   ▼
controllers/contractController.js::confirmPayment
   │   (검증 → PG 승인 → 트랜잭션)
   ▼
services/paymentApprovalService.js::approveContractPayment
   │   (Payment → Contract → RentalOrder → Settlement → Payout)
   ▼
services/paymentApprovalService.js::createBrokerIncentiveIfEligible  ← Phase 3
   │
   ├─> services/brokerResolver.js::resolveBrokerForHostAt            ← Phase 2
   │      (매핑 + broker 활성/기간 + 요율 유효성 3단 판정)
   │
   └─> utils/brokerIncentiveCalculator.js::calculateBrokerIncentive  ← Phase 2
          (개인/사업자 분기, 절사 정책, 불변식)
          → Contract 스냅샷 업데이트 + BrokerIncentive.create
```

```
Admin 월별 조회
   │
   ▼
controllers/adminBrokerIncentiveController.js::listMonthlyPayouts    ← Phase 5
   │
   └─> services/brokerIncentiveAggregator.js::aggregateMonth         ← Phase 4
          (PENDING/AGGREGATED 를 broker×month 별 SUM → payout upsert)
          (PAID payout 은 재계산 금지 = 금액 보호)
```

---

## 4. 결제 플로우 변경점

### 4-1. 결제 승인 경로 ([paymentApprovalService.js](../../services/paymentApprovalService.js))

```js
const settlement = await Settlement.create({ ... });
await Payout.create({ ... });

// ── 중개인 인센티브 처리 (결제 시점 귀속 판정 + 스냅샷) ──
const brokerIncentive = await createBrokerIncentiveIfEligible(
  contract, settlement, now, transaction
);
// 미귀속이면 null → 스냅샷 NULL 유지, BrokerIncentive 행 미생성
```

### 4-2. 브로커 해석 로직 ([brokerResolver.js](../../services/brokerResolver.js))

```
1) BrokerHostMapping: host_id=X, start_date ≤ approvedAt < (end_date OR ∞)
2) Broker:           status='active', start_date ≤ DATE(approvedAt) ≤ end_date
3) BrokerRate:       broker_id=Y, effective_from ≤ approvedAt < (effective_to OR ∞)
   + rate > 0

→ 하나라도 실패하면 null (= 미귀속 처리)
```

### 4-3. Settlement ON_HOLD 전환 지점 ([contractController.js](../../controllers/contractController.js))

```js
// 계약 취소(L.2257) / 호스트 취소(L.3615) 2곳
await Settlement.update(
  { status: 'ON_HOLD', ... },
  { where: { contractId, status: 'PENDING' }, transaction }
);
// 연계된 중개인 인센티브도 동기 ON_HOLD (PENDING 상태만)
await BrokerIncentive.update(
  { status: 'ON_HOLD' },
  { where: { contractId, status: 'PENDING' }, transaction }
);
```

---

## 5. 월별 집계 메커니즘

### 5-1. 트리거 방식

**온디맨드 집계** — 스케줄러 없음. Admin 이 월별 리스트를 조회할 때마다
`aggregateMonth(month)` 호출 → broker×month 별 SUM → BrokerIncentivePayout
upsert.

### 5-2. 집계 대상

```sql
-- 집계 대상: 해당 월 + PENDING or AGGREGATED
WHERE settlement_month = :month
  AND status IN ('PENDING', 'AGGREGATED')

-- 제외: ON_HOLD (계약 취소), CANCELLED
```

### 5-3. PAID 금액 보호

```js
if (existing.status === 'PAID') {
  // 지급완료 건은 재계산 금지 (금액 변조 방지)
  return null;
}
```

이미 지급 처리된 broker×month 는 이후 인센티브가 새로 들어와도 **합계가
변하지 않음**. 필요 시 관리자가 수동으로 payout 행을 강제 재계산하는 별도
엔드포인트를 둘 수 있으나 Week 2 스코프 외.

---

## 6. Admin API 요약

라우트 prefix: `/api/admin`. 쓰기 작업은 `super_admin` / `admin` 역할 요구.

### 6-1. 중개인 관리
```
GET    /brokers                           목록 (currentRate/hostCount 포함)
POST   /brokers                           생성 (initialRate 옵션)
GET    /brokers/:brokerId                 상세 (요율 이력 + 귀속 호스트)
PATCH  /brokers/:brokerId                 정보 수정
GET    /brokers/:brokerId/rates           요율 이력
POST   /brokers/:brokerId/rates           새 요율 (기존 활성 row 자동 마감)
GET    /brokers/:brokerId/hosts           귀속 임대인 목록
POST   /brokers/:brokerId/hosts           임대인 귀속 (중복 검증)
DELETE /brokers/:brokerId/hosts/:hostId   귀속 해제 (soft end)
```

### 6-2. 월별 인센티브
```
GET    /broker-incentives/monthly?month=YYYY-MM       월별 집계 리스트
GET    /broker-incentives/monthly/:payoutId           상세 (계약 리스트)
PATCH  /broker-incentives/monthly/:payoutId/pay       지급 완료 처리 (멱등)
GET    /broker-incentives/monthly/:payoutId/csv       payout 별 CSV
GET    /broker-incentives/monthly/csv?month=YYYY-MM   월별 전체 CSV
```

### 6-3. 에러 코드

| 코드 | 설명 |
|------|------|
| 4910 | BROKER_NOT_FOUND |
| 4911 | BROKER_TAX_ID_REQUIRED (사업자 타입에 tax_id 누락) |
| 4912 | BROKER_INVALID_DATE_RANGE (종료일 ≤ 시작일) |
| 4913 | BROKER_RATE_INVALID (0 ≥ rate 또는 rate > 1) |
| 4914 | BROKER_HOST_ALREADY_MAPPED (중복 활성 매핑) |
| 4915 | BROKER_HOST_MAPPING_NOT_FOUND |
| 4916 | BROKER_INCENTIVE_PAYOUT_NOT_FOUND |
| 4917 | BROKER_INCENTIVE_ALREADY_PAID |
| 4918 | BROKER_MONTH_INVALID (YYYY-MM 형식 아님) |
| 4919 | BROKER_HOST_NOT_FOUND |

---

## 7. 부가세 신고용 쿼리

### 7-1. 사업자 중개인 수수료 수취 (공급가액 + VAT)

```sql
SELECT
  broker_id,
  SUM(gross_amount)  AS total_paid,
  SUM(supply_amount) AS reverse_supply,    -- 매입세액 공제 가능분
  SUM(vat_amount)    AS reverse_vat
FROM broker_incentives bi
JOIN brokers b ON b.id = bi.broker_id
WHERE bi.status IN ('AGGREGATED')
  AND b.broker_type = 'business'
  AND bi.settlement_month BETWEEN '2026-04' AND '2026-06'  -- 분기
GROUP BY broker_id;
```

### 7-2. 개인 중개인 원천징수 신고

```sql
SELECT
  broker_id,
  COUNT(*)                  AS contract_count,
  SUM(gross_amount)          AS gross_income,
  SUM(withholding_amount)    AS withheld_tax,
  SUM(net_amount)            AS net_paid
FROM broker_incentives bi
JOIN brokers b ON b.id = bi.broker_id
WHERE bi.status IN ('AGGREGATED')
  AND b.broker_type = 'individual'
  AND bi.settlement_month BETWEEN '2026-04' AND '2026-06'
GROUP BY broker_id;
```

### 7-3. 불변식 검증

```sql
-- individual: gross = withholding + net
SELECT id FROM broker_incentives
WHERE broker_type = 'individual'
  AND gross_amount <> withholding_amount + net_amount;

-- business: gross = supply + vat AND net = gross
SELECT id FROM broker_incentives
WHERE broker_type = 'business'
  AND (gross_amount <> supply_amount + vat_amount
       OR net_amount <> gross_amount);
```

---

## 8. 테스트 결과

| 구분 | 테스트 | 결과 |
|------|--------|------|
| Unit: [brokerIncentiveCalculator](../../tests/unit/brokerIncentiveCalculator.test.js) | 28 | 28/28 ✅ |
| Integration: [brokerResolver](../../tests/integration/broker/brokerResolver.test.js) | 16 | 16/16 ✅ |
| Integration: [paymentIntegration](../../tests/integration/broker/paymentIntegration.test.js) | 7 | 7/7 ✅ |
| Integration: [adminBrokerApi](../../tests/integration/broker/adminBrokerApi.test.js) | 15 | 15/15 ✅ |

**기존 테스트 회귀 0건** (baseline `31 failed` 그대로, `ezstay_test` DB 의 `promotion_events` 테이블 부재 때문).

### 8-1. 테스트 환경 한계

`paymentIntegration.test.js` 와 `adminBrokerApi.test.js` 는 결제 플로우를
거치는데, `applyHostBenefit` 이 `ezstay_test` 에 없는 `promotion_events`
테이블을 조회하므로 **`promotionService` 를 no-op mock** 처리했다. 이는
우리 브랜치 이전부터의 환경 문제이며 기존 실패 29건의 원인과 동일. 별도 PR 로
`promotion_events` 를 테스트 DB 스키마에 맞추면 해소 가능.

---

## 9. 제약사항 및 체크리스트

- [x] 스냅샷 불변식: 요율 변경이 기존 인센티브에 영향 없음
- [x] PAID payout 재계산 금지 (금액 보호)
- [x] ON_HOLD 동기화는 PENDING 인센티브만 대상
- [x] 개인/사업자 세무 분기 (withholding vs VAT)
- [x] 불변식 `gross = withholding + net` / `gross = supply + vat, net = gross`
- [x] 중복 활성 매핑 방지 (host 1명 = 1 broker 활성)
- [x] 런칭 전이라 기존 데이터 백필 불요 (모든 신규 컬럼 NULL 허용)
- [x] 절사 정책 feeCalculator 와 일관 (`Math.floor`)
- [x] 이관 시나리오 지원 (`broker_host_mappings.end_date` 구간)

---

## 10. 후속 작업 (Week 3 이후)

### 10-1. Week 3 원장(Ledger) 통합

Week 1 VAT 분리값 + Week 2 브로커 분리값을 모두 복식부기 분개에 사용:

```
게스트 결제            : 차변 현금 / 대변 [임대료 수취 + 플랫폼 수수료 수취 + VAT]
호스트 정산            : 차변 호스트 수수료 비용 / 대변 현금
                        + VAT 분리: 매출세액 인식
중개인 인센티브 지급   :
  individual: 차변 수수료 비용 / 대변 [현금 + 원천세 예수금]
  business  : 차변 수수료 비용 + 매입세액 / 대변 [현금 + 예수금(해당 없음)]
환불 역전              : 기존 VAT 분리값 역전 분개
```

### 10-2. 관리자 운영 편의 기능

- Payout 강제 재계산 엔드포인트 (PAID 되어 금액 보호 중인 행을 운영 실수로 변경 필요한 경우)
- 중개인 자기결제 차단 (host_id == broker 의 연결된 user_id 일 때 검증)
- 관리자 액션 로그 통합 (현재는 `req.admin?.id` 만 기록, 상세 감사 로그 없음)

### 10-3. 리포트

- 분기별 원천세 납부 자동 집계 (개인 broker 전용)
- 사업자 broker 별 세금계산서 수취 대사
- 누적 인센티브 지급 추이 대시보드

---

## 11. 변경 파일 요약 (Phase 1~5)

### 신규
```
migrations/sql/add_broker_incentive_schema.sql
models/Broker.js
models/BrokerRate.js
models/BrokerHostMapping.js
models/BrokerIncentive.js
models/BrokerIncentivePayout.js
utils/brokerIncentiveCalculator.js
services/brokerResolver.js
services/brokerIncentiveAggregator.js
controllers/adminBrokerController.js
controllers/adminBrokerIncentiveController.js
tests/unit/brokerIncentiveCalculator.test.js
tests/integration/broker/brokerResolver.test.js
tests/integration/broker/paymentIntegration.test.js
tests/integration/broker/adminBrokerApi.test.js
docs/accounting/02-broker-incentive.md (this file)
```

### 수정
```
models/Contract.js          +3 필드 (broker*_snapshot)
models/index.js             +10 관계 정의
services/paymentApprovalService.js  +브로커 처리 블록 (결제 트랜잭션 내부)
controllers/contractController.js   +ON_HOLD 동기화 2지점
routes/adminRoutes.js                +12 엔드포인트
utils/responseHelper.js              +10 에러코드 (4910-4919)
```

### 선행 작업 (별도 PR, 머지 완료)
```
PR #139: refactor: 결제 승인 DB 트랜잭션 블록을 paymentApprovalService 로 추출
```
