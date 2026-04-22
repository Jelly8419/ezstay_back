# 01. 수수료 계산 통합 + VAT 분리

> 회계 시스템 30일 런칭 로드맵 **Week 1** 결과물
> 작성: 2026-04-22 / 브랜치: `feature/accounting-vat-separation`

## 1. 목표

런칭 전에 "절대 포기 금지" 3가지 중 하나 — **수수료 계산을 단일 지점으로
통합하고 VAT를 분리 저장**. 분기별 부가세 신고 시 공급가액과 매출세액을
단순 `SUM()` 쿼리로 뽑을 수 있게 만드는 게 목표.

---

## 2. 기존 문제점

| 문제 | 위치 | 결과 |
|------|------|------|
| 수수료 계산이 3곳에 분산 | [contractController.js:390](../../controllers/contractController.js), [settlementService.js:79](../../services/settlementService.js), [refundCalculator.js:200](../../utils/refundCalculator.js) | 로직 변경 시 3곳 모두 수정 필요 → 누락/불일치 위험 |
| VAT 분리 저장 없음 | `contracts.platform_fee`, `settlements.host_platform_fee`, `refunds.original_platform_fee` 모두 **VAT 포함 총액만** | 부가세 신고 시 행마다 `/1.1` 반올림 계산 → 회계 정합성 훼손 |
| 런칭 후 컬럼 추가 시 기존 행 NULL | — | 런칭 시점을 경계로 "NULL 구간" / "값 있는 구간" 이 영구 분리됨 |

---

## 3. 변경 요약

### 3-1. 신규 파일

- [utils/feeCalculator.js](../../utils/feeCalculator.js) — 수수료 계산 단일 유틸
- [tests/unit/feeCalculator.test.js](../../tests/unit/feeCalculator.test.js) — 27개 단위 테스트 (모두 통과)
- [migrations/sql/add_vat_columns.sql](../../migrations/sql/add_vat_columns.sql) — VAT 컬럼 마이그레이션

### 3-2. 수정 파일

| 파일 | 변경 |
|------|------|
| [models/Contract.js](../../models/Contract.js) | `platformFeeSupply`, `platformFeeVat`, `hostPlatformFeeSupply`, `hostPlatformFeeVat` 추가 |
| [models/Settlement.js](../../models/Settlement.js) | `hostPlatformFeeSupply`, `hostPlatformFeeVat` 추가 |
| [models/Refund.js](../../models/Refund.js) | `originalPlatformFeeSupply`, `originalPlatformFeeVat` 추가 |
| [controllers/contractController.js](../../controllers/contractController.js) | feeCalculator 호출로 교체, Contract/Refund.create 시 VAT 필드 저장 |
| [services/settlementService.js](../../services/settlementService.js) | 스냅샷 우선 → 없으면 역산/재계산, 반환 객체에 supply/vat 포함 |
| [utils/refundCalculator.js](../../utils/refundCalculator.js) | 환불 계산 결과에 `originalPlatformFeeSupply/Vat`, `platformFeeDeductedSupply/Vat` 추가 |
| [schedulers/contractScheduler.js](../../schedulers/contractScheduler.js) | Settlement.create 호출 시 VAT 필드 저장 |

---

## 4. `feeCalculator.js` API

### 상수
```js
GUEST_FEE_RATE = 0.099  // VAT 포함
HOST_FEE_RATE  = 0.033  // VAT 포함
VAT_RATE       = 0.1
```

### 함수

#### `calculateFeeBase({ rentalFee, maintenanceFee, cleaningFee, discountAmount, hasEzCleaningService })`
수수료 산출 기준 금액 계산.
- `hasEzCleaningService=true` → `cleaningFee` 를 feeBase에서 제외 (청소비는 플랫폼 귀속)
- 음수 방어: `Math.max(0, ...)`

#### `calculateGuestFee(feeBase)` → `{ total, supply, vat }`
게스트 수수료 9.9% VAT 포함 총액 + 공급가액/부가세 분리 반환.

#### `calculateHostFee(feeBase)` → `{ total, supply, vat }`
호스트 수수료 3.3% 동일.

#### `splitVatFromTotal(total)` → `{ total, supply, vat }`
이미 저장된 VAT 포함 총액을 공급가액/부가세로 역분리.
- 기존 스냅샷(supply/vat 없음)과의 호환, 프로모션 감면 후 재분리에 사용
- `supply = Math.round(total × 10/11)`, `vat = total - supply`
- 불변식: **`supply + vat === total`**

### 반올림 정책 (절사)

EZStay 는 모든 수수료 산출에서 **원 미만 절사(Math.floor)** 를 사용합니다.

- 수수료 총액: `Math.floor(feeBase × 0.099)` (게스트), `Math.floor(feeBase × 0.033)` (호스트)
- 공급가액 분리: `Math.floor((total × 10) / 11)`
- VAT: `total - supply` (잔여)

#### 구현 주의사항

공급가액 계산에서 `Math.floor(total / 1.1)` 방식은 부동소수점 오차로
`26,400` 같은 값이 `23,999` 로 잘못 계산되는 버그가 있어 **사용 금지**.
반드시 `Math.floor((total * 10) / 11)` 순서로 정수 연산을 먼저 수행합니다.

#### 세법 관례와의 차이

세법 관례는 `공급가액 × 1.1 = 총액` 이지만, 절사 정책 적용 시 일부 금액에서
1원 차이가 발생할 수 있습니다. 예:

| 총액 | 절사 정책 공급가액 | 재구성 (supply × 1.1) | 차이 |
|------|-------------------|----------------------|------|
| 1,000,000 | 909,090 | 999,999 | −1 |
| 12,345 | 11,222 | 12,344.2 | −0.8 |
| 26,400 | 24,000 | 26,400 | 0 |

런칭 후 세무사 상담 결과에 따라 반올림 정책으로 전환 가능합니다. 전환 시
**기존 스냅샷은 유지** 하고 **신규 계약부터 적용** (과거 행의 재계산 금지).

#### 불변식

`supply + vat === total` 은 절사·반올림 정책과 무관하게 항상 성립합니다.
`vat` 는 언제나 잔여 계산이기 때문입니다.

---

## 5. 기존 로직과의 차이

### 5-1. 계약 생성 (`contractController.createContractRequest`)

**기존** (L.382-394):
```js
const feeBase = Math.max(0,
  rentalFee + maintenanceFee +
  (hasFreeCleaningService ? 0 : cleaningFee) - discountAmount
);
serverCalculated.platformFee = Math.floor(feeBase * 0.099);
serverCalculated.hostPlatformFee = Math.floor(feeBase * 0.033);
```

**현재**:
```js
const feeBase = calculateFeeBase({
  rentalFee, maintenanceFee, cleaningFee,
  discountAmount: discountAmountServer,
  hasEzCleaningService: hasFreeCleaningService,
});
const guestFee = calculateGuestFee(feeBase);  // { total, supply, vat }
const hostFee = calculateHostFee(feeBase);

serverCalculated.platformFee         = guestFee.total;
serverCalculated.platformFeeSupply   = guestFee.supply;
serverCalculated.platformFeeVat      = guestFee.vat;
serverCalculated.hostPlatformFee     = hostFee.total;
serverCalculated.hostPlatformFeeSupply = hostFee.supply;
serverCalculated.hostPlatformFeeVat  = hostFee.vat;
```

- **요율/반올림 결과는 기존과 동일** (`Math.floor(feeBase × 0.099)` 는 `calculateGuestFee` 내부와 일치)
- 추가된 것은 **supply/vat 분리값만** → 기존 계약금액/스냅샷과 완벽히 호환

### 5-2. 정산 (`settlementService.calculateSettlementAmount`)

**기존**:
```js
const hostPlatformFee = storedHostPlatformFee != null
  ? storedHostPlatformFee
  : Math.floor(subtotal * 0.033);
```

**현재** (3단 우선순위):
1. Contract에 `hostPlatformFee` + `supply` + `vat` 모두 스냅샷된 경우 → 그대로 사용
2. `hostPlatformFee` 만 있으면 → `splitVatFromTotal` 로 역산
3. 아예 없으면 → `calculateHostFee(subtotal)` 로 재계산

또한 `applyHostBenefit` (호스트 프로모션 감면) 적용 후 감면된 `platformFee` 에
대해서도 `splitVatFromTotal` 로 supply/vat 재분리. 이로써 프로모션 감면으로
총액이 변한 케이스도 부가세 신고액이 정확히 반영됩니다.

### 5-3. 환불 (`refundCalculator.calculateRefund`)

반환 객체에 추가된 필드:
- `originalPlatformFeeSupply`, `originalPlatformFeeVat` — 환불 시점의 **원본 수수료** VAT 분리
- `platformFeeDeductedSupply`, `platformFeeDeductedVat` — 비환불 수수료(플랫폼 실수익분)의 VAT 분리

두 Refund.create 호출 지점([contractController.js:2101](../../controllers/contractController.js), [contractController.js:3607](../../controllers/contractController.js))에서
`originalPlatformFeeSupply/Vat` 를 DB에 저장하도록 수정됨.

---

## 6. DB 스키마 변경

### 6-1. 추가된 컬럼

**`contracts`**
| 컬럼 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `platform_fee_supply`       | BIGINT | 0 | 게스트 수수료 공급가액 |
| `platform_fee_vat`          | BIGINT | 0 | 게스트 수수료 부가세 |
| `host_platform_fee_supply`  | BIGINT | 0 | 호스트 수수료 공급가액 |
| `host_platform_fee_vat`     | BIGINT | 0 | 호스트 수수료 부가세 |

**`settlements`**
| 컬럼 | 타입 | 기본값 |
|------|------|--------|
| `host_platform_fee_supply` | BIGINT | 0 |
| `host_platform_fee_vat`    | BIGINT | 0 |

**`refunds`**
| 컬럼 | 타입 | 기본값 |
|------|------|--------|
| `original_platform_fee_supply` | BIGINT | 0 |
| `original_platform_fee_vat`    | BIGINT | 0 |

### 6-2. 기존 컬럼 처리

`platform_fee`, `host_platform_fee`, `original_platform_fee` 는 **VAT 포함 총액 그대로 유지** (하위 호환).
삭제 금지. 세 값이 모두 DB에 있어야 감사·디버깅 시 `supply + vat === total` 불변식을 검증할 수 있음.

### 6-3. 적용 명령

실 DB:
```bash
mysql -u <user> -p <db> < migrations/sql/add_vat_columns.sql
```

본 작업에서는 실 DB(`ezstay`)와 테스트 DB(`ezstay_test`) 양쪽에 ALTER 이미 적용됨.

---

## 7. 분기별 부가세 신고 쿼리 예시

### 게스트 수수료 매출 (9.9%) — 특정 분기 기준
```sql
SELECT
  SUM(platform_fee)        AS total_incl_vat,
  SUM(platform_fee_supply) AS supply_amount,   -- 공급가액
  SUM(platform_fee_vat)    AS vat_amount        -- 매출세액
FROM contracts
WHERE paid_at >= '2026-04-01 00:00:00'
  AND paid_at <  '2026-07-01 00:00:00'
  AND status IN ('PAYMENT_COMPLETED','IN_PROGRESS','COMPLETED');
```

### 호스트 수수료 매출 (3.3%) — Settlement 완료 기준
```sql
SELECT
  SUM(host_platform_fee)        AS total_incl_vat,
  SUM(host_platform_fee_supply) AS supply_amount,
  SUM(host_platform_fee_vat)    AS vat_amount
FROM settlements
WHERE completed_at >= '2026-04-01 00:00:00'
  AND completed_at <  '2026-07-01 00:00:00'
  AND status = 'COMPLETED';
```

### 환불로 역전된 게스트 수수료 매출 — 전액 환불 분
```sql
-- 100% 환불은 원본 공급가액/VAT 전체가 매출 차감 (세금계산서 취소)
SELECT
  SUM(original_platform_fee)        AS reverted_total,
  SUM(original_platform_fee_supply) AS reverted_supply,
  SUM(original_platform_fee_vat)    AS reverted_vat
FROM refunds
WHERE completed_at >= '2026-04-01 00:00:00'
  AND completed_at <  '2026-07-01 00:00:00'
  AND refund_status = 'COMPLETED'
  AND guest_service_fee_refunded = TRUE;
```

### 플랫폼 실수익 (게스트 매출 − 호스트 매출 = 6.6% 차액)
```sql
-- 같은 분기의 게스트 총액 − 호스트 총액
-- Settlement 완료 기준이므로 Contract 조인 필요
SELECT
  SUM(c.platform_fee_supply  - s.host_platform_fee_supply) AS net_platform_supply,
  SUM(c.platform_fee_vat     - s.host_platform_fee_vat)    AS net_platform_vat
FROM settlements s
JOIN contracts   c ON c.id = s.contract_id
WHERE s.completed_at >= '2026-04-01 00:00:00'
  AND s.completed_at <  '2026-07-01 00:00:00'
  AND s.status = 'COMPLETED';
```

---

## 8. 불변식 (검증용)

모든 VAT 관련 행에 대해 다음 불변식이 성립해야 합니다:

```
platform_fee              === platform_fee_supply + platform_fee_vat
host_platform_fee         === host_platform_fee_supply + host_platform_fee_vat  (contracts)
host_platform_fee         === host_platform_fee_supply + host_platform_fee_vat  (settlements)
original_platform_fee     === original_platform_fee_supply + original_platform_fee_vat
```

검증 쿼리 (이상 있으면 0건 이상 반환):
```sql
SELECT id, platform_fee, platform_fee_supply, platform_fee_vat
FROM contracts
WHERE platform_fee <> 0
  AND platform_fee <> platform_fee_supply + platform_fee_vat;
```

---

## 9. 테스트 결과

| 구분 | 리팩토링 전 | 리팩토링 후 |
|------|-----------|-----------|
| Unit (`tests/unit`) | 43 passed / 1 failed (기존 HOST 귀책 테스트 오류, 본 작업과 무관) | 74 passed / 1 failed |
| Integration (`tests/integration`) | 101 passed / 29 failed (`ezstay_test` DB에 일부 테이블 부재로 인한 기존 실패) | 101 passed / 29 failed |

→ **본 리팩토링으로 인한 회귀 0건**.

---

## 10. 후속 작업 (Week 2 이후)

- 원장(ledger) 인프라 구축 시 이 VAT 분리값을 그대로 복식부기 분개에 사용
- 게스트 수수료 `rev_guest_fee` ← `platform_fee_supply`, `vat_payable` ← `platform_fee_vat`
- 호스트 수수료 `rev_host_fee` ← `host_platform_fee_supply`, `vat_payable` ← `host_platform_fee_vat`
- 환불 역분개 시 `original_platform_fee_supply/vat` 를 역전 분개액으로 사용

---

## 11. 제약사항 확인

- [x] 기존 `platformFee`, `hostPlatformFee`, `originalPlatformFee` 컬럼 유지 (삭제 없음)
- [x] 기존 테스트 회귀 0건
- [x] 런칭 전이므로 기존 데이터 백필 불요 (DEFAULT 0 으로 신규 행만 유효)
- [x] 수수료 계산 로직의 **결과값**은 기존과 완전 동일 (요율/반올림 변경 없음)
