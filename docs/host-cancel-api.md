# 호스트 귀책 계약 취소 API

> 대상: 프론트엔드 개발자  
> 적용 상태: `PAYMENT_COMPLETED` (결제 완료, 입주 전)

---

## 개요

호스트가 입주 전 계약을 취소하는 플로우입니다.  
취소 전 부담금을 미리 확인하고, 결제 후 게스트 환불이 자동 처리됩니다.

```
[취소 버튼 클릭]
      ↓
1. GET  /cancel-by-host/preview   → 부담금 금액 표시
      ↓
[결제하기 버튼 클릭]
      ↓
2. POST /cancel-by-host           → 호스트 PG 결제 + 게스트 환불 처리
```

---

## 1. 취소 부담금 미리보기

### Request

```
GET /api/contracts/:contractId/cancel-by-host/preview
Authorization: Bearer {hostToken}
```

### Response 200

```json
{
  "success": true,
  "data": {
    "originalRentalFee": 300000,
    "originalCleaningFee": 300000,
    "originalMaintenanceFee": 100000,
    "originalDeposit": 300000,
    "originalPlatformFee": 99000,
    "originalRentalItemsFee": 0,
    "originalTotalAmount": 1099000,

    "rentalFeeRefundAmount": 270000,
    "cleaningFeeRefundAmount": 300000,
    "maintenanceFeeRefundAmount": 100000,
    "depositRefundAmount": 300000,
    "rentalItemsFeeRefundAmount": 0,

    "hostBurdenAmount": 129000,
    "penaltyAmount": 30000,

    "guestRefundAmount": 1099000,
    "guestCompensationAmount": 30000,

    "daysBeforeCheckin": 45,
    "refundRate": 90,
    "policyDisplayName": "보통",
    "applicableRuleDescription": "30일 이전 취소",
    "message": "입주일 45일 전 취소로 임대료의 90%가 환불됩니다."
  },
  "message": "호스트 취소 부담금 미리보기"
}
```

### 필드 설명

**원본 결제 항목**

| 필드 | 설명 |
|------|------|
| `originalRentalFee` | 임대료 |
| `originalCleaningFee` | 청소비 |
| `originalMaintenanceFee` | 관리비 |
| `originalDeposit` | 보증금 |
| `originalPlatformFee` | 게스트 서비스 수수료 🔴 호스트 부담 |
| `originalRentalItemsFee` | 옵션상품 합계 |
| `originalTotalAmount` | 게스트 총 결제금액 |

**항목별 환불 금액**

| 필드 | 설명 | 비고 |
|------|------|------|
| `rentalFeeRefundAmount` | 임대료 환불액 | 🔴 위약금 차감 후 금액 |
| `cleaningFeeRefundAmount` | 청소비 환불액 | 항상 전액 |
| `maintenanceFeeRefundAmount` | 관리비 환불액 | 항상 전액 |
| `depositRefundAmount` | 보증금 환불액 | 항상 전액 |
| `rentalItemsFeeRefundAmount` | 옵션상품 환불액 | 항상 전액 |

**호스트 납부 / 게스트 수령**

| 필드 | 설명 |
|------|------|
| `hostBurdenAmount` | 호스트 납부 총액 = `penaltyAmount` + `originalPlatformFee` |
| `penaltyAmount` | 위약금 = 임대료 × 위약률 🔴 호스트 부담 |
| `guestRefundAmount` | 게스트 즉시 환불액 (결제 전액) |
| `guestCompensationAmount` | 게스트 보전액 (결제일+3영업일 후 별도 지급) |
| `refundRate` | 현재 시점 환불율 (%) |

### 금액 계산 예시

```
임대료 300,000 / 청소비 300,000 / 관리비 100,000 / 보증금 300,000 / 수수료 99,000
총 결제: 1,099,000원 / 환불율 90% 기간

위약금       = 300,000 × (100-90)% = 30,000원
hostBurdenAmount = 30,000 + 99,000 = 129,000원

게스트 즉시 환불 = 1,099,000원 (전액)
게스트 보전액    = 30,000원 (결제일+3영업일 후)
```

---

## 2. 계약 취소 + 부담금 결제

### Request

```
POST /api/contracts/:contractId/cancel-by-host
Authorization: Bearer {hostToken}
Content-Type: application/json
```

#### hostBurdenAmount > 0 인 경우 (일반)

```json
{
  "cancellationReason": "개인 사정으로 취소합니다.",
  "recvPayparam": "PayTag에서 전달받은 결제 파라미터",
  "payType": "CARD",
  "orderId": "250111-00001",
  "amount": 129000
}
```

#### hostBurdenAmount = 0 인 경우 (환불율 100% 기간)

```json
{
  "cancellationReason": "개인 사정으로 취소합니다."
}
```

> `hostBurdenAmount`가 0이면 `recvPayparam`, `orderId`, `amount` 불필요

### Response 200

```json
{
  "success": true,
  "data": {
    "contractId": 123,
    "status": "CANCELLED_BY_HOST",
    "cancelledAt": "2026-04-08T10:00:00",
    "refundId": 456,
    "hostBurdenAmount": 129000,
    "guestRefundAmount": 1099000,
    "guestCompensationAmount": 30000
  },
  "message": "계약이 취소되었습니다. 게스트에게 전액 환불이 진행됩니다."
}
```

### 처리 순서 (내부)

```
1. 호스트 부담금 PG 결제 (hostBurdenAmount > 0)
2. 게스트 결제금 PG 취소 → 즉시 환불
3. Refund 레코드 생성 (hostBurdenStatus: PAID)
4. 계약 상태 → CANCELLED_BY_HOST
5. 게스트 보전 Payout 생성 (payableAfter = 결제일 + 3영업일)
6. 알림 발송 (게스트)
```

---

## 에러 코드

| HTTP | code | 메시지 | 원인 |
|------|------|--------|------|
| 400 | 4620 | 취소 사유를 입력해주세요. | `cancellationReason` 누락 |
| 400 | 4621 | 결제 완료 상태에서만 호스트 취소가 가능합니다. | 잘못된 계약 상태 |
| 400 | 4624 | 부담금 결제 정보가 필요합니다. | `recvPayparam`/`orderId`/`amount` 누락 |
| 400 | 4603 | 주문번호가 일치하지 않습니다. | `orderId` 불일치 |
| 400 | 4604 | 결제 금액이 일치하지 않습니다. | `amount` ≠ `hostBurdenAmount` |
| 400 | 4605 | 결제 승인에 실패했습니다. | PG 결제 실패 |
| 403 | 2001 | 권한이 없습니다. | 본인 계약 아님 |
| 404 | 3005 | 계약을 찾을 수 없습니다. | 잘못된 contractId |
| 502 | 4900 | 게스트 환불 처리 실패 | 게스트 환불 PG 취소 실패 |

---

## 사용 시나리오

### 시나리오 A. 일반 취소 (위약금 있음)

```
조건: 입주 45일 전, 환불율 90%, 임대료 300,000원

1. 호스트가 취소 버튼 클릭
2. GET /preview 호출
   → "부담금 129,000원이 발생합니다"
   → "게스트에게 1,099,000원이 즉시 환불됩니다"
   → "게스트 보전액 30,000원은 3영업일 후 지급됩니다"
3. 호스트가 PG 결제창에서 129,000원 결제
4. POST /cancel-by-host 호출 (recvPayparam 포함)
5. 완료 → 게스트에게 환불 알림 발송
```

### 시나리오 B. 위약금 없음 (환불율 100% 기간)

```
조건: 입주 60일 전, 환불율 100%

1. 호스트가 취소 버튼 클릭
2. GET /preview 호출
   → hostBurdenAmount: 0
   → "부담금 없이 취소 가능합니다"
3. 호스트가 취소 사유만 입력 후 확인
4. POST /cancel-by-host 호출 (결제 파라미터 없음)
5. 완료 → 게스트 전액 즉시 환불
```

### 시나리오 C. PG 결제 실패

```
1. GET /preview → 부담금 129,000원 확인
2. POST /cancel-by-host → PG 결제 실패 (4605)
   → 계약 상태 변경 없음, 게스트 환불 없음
   → 프론트: 결제 실패 안내 후 재시도 유도
```

### 시나리오 D. 게스트 환불 실패 (502)

```
1. 호스트 PG 결제 성공
2. 게스트 환불 PG 취소 실패
   → 호스트 부담금 PG 자동 원복 시도 (cancelPayment)
   → 트랜잭션 롤백 → 계약 상태 유지, DB 변경 없음
   → 502 반환
   → 프론트: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요" 안내
```

> **주의**: 호스트 PG 원복마저 실패한 경우 서버 로그에 `[cancelByHost] 호스트 부담금 PG 원복 실패` 가 기록됩니다. 운영팀이 로그 모니터링 후 수동 PG 취소 처리 필요.

---

## 참고

- `orderId`: `GET /api/contracts/:contractId/payment-info` 응답의 `orderId` 사용
- `guestCompensationAmount` 지급: 스케줄러가 `payableAfter` 도래 시 자동 처리
- 입주 후(`IN_PROGRESS`) 취소는 별도 플로우(`POST /cancel-request`) 사용
