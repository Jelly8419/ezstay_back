# 관리자 환불/취소 API 스펙

> **Base URL:** `http://localhost:8080/api/admin`
> **인증:** 모든 요청에 `Authorization: Bearer <adminToken>` 필요
> **권한:** `super_admin` 또는 `admin` 역할 필요 (별도 표기 없는 한)

---

## 변경 이력

| 날짜 | 변경 내용 |
|------|-----------|
| 2026-03-27 | 환불 승인 / 강제 취소 / 렌탈 취소 — PG 실제 연동 구현 완료 |

---

## 0. 결제 직접 환불 (부분/전체)

```
POST /payments/:contractId/refund
권한: super_admin, admin
```

> 계약 결제(Payment)에 대해 관리자가 금액을 직접 지정해 환불합니다.
> **`refundAmount = balanceAmount`로 요청하면 전체 취소**, 미만이면 부분 취소입니다.
> 별도의 전체취소 전용 API는 없으며 이 API 하나로 모두 처리합니다.

### Request

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `refundAmount` | number | ✅ | 환불 금액 (1 이상, balanceAmount 이하) |
| `refundReason` | string | ✅ | 환불 사유 |

```json
{
  "refundAmount": 200000,
  "refundReason": "관리자 직권 환불"
}
```

### 처리 흐름

- Payment 상태 조건: `DONE` 또는 `PARTIAL_CANCELED`
- `refundAmount == balanceAmount` → 전체취소 (`canceltype=0`)
- `refundAmount < balanceAmount` → 부분취소 (`canceltype=1`)
- DB update (payment, Refund 생성) → PG 취소 → commit
- PG 실패 시 rollback, DB 원복

### Response — 성공 `200`

```json
{
  "success": true,
  "data": {
    "refundId": 15,
    "paymentId": 3,
    "refundAmount": 200000,
    "newBalance": 0,
    "paymentStatus": "CANCELED",
    "pgReceiptUrl": "https://..."
  },
  "message": "환불이 처리되었습니다."
}
```

### Response — 에러

| 상태코드 | code | 상황 |
|----------|------|------|
| 400 | VALIDATION_ERROR | `refundAmount` 누락 또는 0 이하 |
| 400 | VALIDATION_ERROR | `refundReason` 누락 |
| 404 | PAYMENT_NOT_FOUND | 결제 정보 없음 |
| 400 | PAYMENT_NOT_REFUNDABLE | Payment 상태가 `DONE`/`PARTIAL_CANCELED` 아님 |
| 400 | REFUND_EXCEEDS_BALANCE | `refundAmount > balanceAmount` |
| 400 | 4901 | 이미 취소 완료된 결제 (PG 에러코드 `1023`) |
| 400 | 4902 | PG사 취소 거부 (PG 에러코드 `1021`) |
| 502 | 4900 | 기타 PG 취소 실패 — DB rollback됨, 재시도 가능 |

---

## 1. 환불 승인

```
PATCH /refunds/:refundId/approve
```

### Request

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `admin_notes` | string | | 관리자 메모 |

```json
{
  "admin_notes": "환불 승인 처리합니다."
}
```

### 처리 흐름

- `refundStatus === 'REQUESTED'` 상태인 경우에만 승인 가능
- `finalRefundAmount > 0` 이면 PayTag PG 취소 API 호출
- PG 성공 후 `refundStatus: COMPLETED` 로 변경
- `finalRefundAmount === 0` 이면 PG 없이 즉시 `COMPLETED`

### Response — 성공 `200`

```json
{
  "success": true,
  "data": {
    "refundId": 12,
    "refundStatus": "COMPLETED",
    "approvedAt": "2026-03-27T10:00:00.000Z",
    "completedAt": "2026-03-27T10:00:00.000Z",
    "finalRefundAmount": 150000
  },
  "message": "환불이 승인되어 PG 취소가 완료되었습니다."
}
```

### Response — 에러

| 상태코드 | code | 상황 |
|----------|------|------|
| 404 | 3006 | 환불 요청을 찾을 수 없음 |
| 400 | 4503 | `REQUESTED` 상태가 아님 (`currentStatus` 필드 포함) |
| 502 | 4900 | PG 취소 실패 — `refundStatus: REFUND_FAILED` 로 변경됨, 수동 처리 필요 |
| 500 | - | 서버 내부 오류 |

```json
// 400 예시
{
  "success": false,
  "error": {
    "code": 4503,
    "message": "요청 상태의 환불만 승인할 수 있습니다",
    "currentStatus": "COMPLETED"
  }
}

// 502 예시 (PG 실패)
{
  "success": false,
  "error": {
    "code": 4900,
    "message": "환불 처리 실패: 취소 불가 거래입니다.",
    "pgErrorCode": "1021"
  }
}
```

> **502 발생 시:** `refundStatus`가 `REFUND_FAILED`로 변경되며 `PaymentFailureLog`에 기록됩니다.
> 관리자 화면에서 `REFUND_FAILED` 상태 건을 별도 식별하여 수동 처리 안내가 필요합니다.

---

## 2. 환불 거절

```
PATCH /refunds/:refundId/reject
```

### Request

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `rejection_reason` | string | ✅ | 거절 사유 |
| `admin_notes` | string | | 관리자 메모 |

```json
{
  "rejection_reason": "중복 요청으로 거절합니다.",
  "admin_notes": "게스트에게 안내 완료"
}
```

### 처리 흐름

- `refundStatus === 'REQUESTED'` 상태인 경우에만 거절 가능
- 계약 상태를 `CANCEL_REQUESTED` 이전 상태로 복원 (ContractStatusLog 기반)
- PG 호출 없음

### Response — 성공 `200`

```json
{
  "success": true,
  "data": {
    "refundId": 12,
    "refundStatus": "REJECTED",
    "rejectionReason": "중복 요청으로 거절합니다.",
    "rejectedAt": "2026-03-27T10:00:00.000Z"
  },
  "message": "환불 요청이 거절되었습니다."
}
```

### Response — 에러

| 상태코드 | code | 상황 |
|----------|------|------|
| 404 | 3006 | 환불 요청을 찾을 수 없음 |
| 400 | 4504 | `rejection_reason` 누락 |
| 400 | 4505 | `REQUESTED` 상태가 아님 |

---

## 3. 계약 강제 취소

```
POST /reservations/:contractId/force-cancel
```

### Request

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `reason` | string | ✅ | 강제 취소 사유 |
| `withRefund` | boolean | | `true`: 환불 포함, `false`(기본): 환불 없이 취소 |

```json
{
  "reason": "규정 위반으로 강제 취소 처리",
  "withRefund": true
}
```

### 강제 취소 가능 계약 상태

| 계약 상태 | 취소 유형(cancellationType) | PG 환불 |
|----------|---------------------------|---------|
| `PENDING_APPROVAL`, `APPROVED` | `BEFORE_PAYMENT` | 없음 (결제 전) |
| `PAYMENT_COMPLETED` | `AFTER_PAYMENT` | `withRefund=true` 시 실행 |
| `IN_PROGRESS`, `CANCEL_REQUESTED` | `DURING_STAY` | `withRefund=true` 시 실행 |

### 처리 흐름

- `withRefund=true` + `BEFORE_PAYMENT` 아닌 경우 → Refund 레코드 생성 후 PG 취소
- PG 성공 → `refundStatus: COMPLETED`
- PG 실패 → 계약 취소는 유지, `refundStatus: APPROVED` 상태 유지 (수동 환불 필요), 응답에 `pgFailure: true` 포함

### Response — 성공 `200`

```json
{
  "success": true,
  "data": {
    "contractId": 55,
    "previousStatus": "IN_PROGRESS",
    "newStatus": "CANCELLED_BY_ADMIN_WITH_REFUND",
    "withRefund": true,
    "cancellationType": "DURING_STAY",
    "reason": "규정 위반으로 강제 취소 처리",
    "refundId": 13,
    "totalRefundAmount": 200000
  },
  "message": "계약이 강제 취소되었습니다."
}
```

### Response — 에러

| 상태코드 | code | 상황 |
|----------|------|------|
| 404 | CONTRACT_NOT_FOUND | 계약을 찾을 수 없음 |
| 400 | MISSING_REQUIRED_FIELDS | `reason` 누락 |
| 400 | 4630 | 강제 취소 불가 상태 (`currentStatus` 포함) |
| 502 | 4900 | PG 취소 실패 — DB rollback됨, 재시도 가능 |

---

## 4. 호스트 취소 요청 승인

```
POST /reservations/:contractId/approve-cancel-request
```

### Request

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `withRefund` | boolean | | 게스트 환불 포함 여부 |
| `adminNote` | string | | 관리자 메모 |

```json
{
  "withRefund": true,
  "adminNote": "호스트 귀책으로 환불 승인"
}
```

### 처리 조건

- 계약 `status === 'IN_PROGRESS'`
- ContractStatusLog에 `CANCEL_REQUEST_BY_HOST` 이력 존재

### Response — 성공 `200`

```json
{
  "success": true,
  "data": { ... },
  "message": "호스트 취소 요청이 승인되었습니다."
}
```

### Response — 에러

| 상태코드 | code | 상황 |
|----------|------|------|
| 404 | CONTRACT_NOT_FOUND | 계약을 찾을 수 없음 |
| 400 | 4631 | `IN_PROGRESS` 상태 아님 |
| 404 | 4632 | 호스트 취소 요청 이력 없음 |

---

## 5. 호스트 취소 요청 거절

```
POST /reservations/:contractId/reject-cancel-request
```

### Request

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `adminNote` | string | | 거절 사유 |

```json
{
  "adminNote": "호스트 귀책 사유 불충분"
}
```

### 처리 흐름

- 계약 상태 변경 없음 (`IN_PROGRESS` 유지)
- 거절 이력만 ContractStatusLog에 기록
- 호스트에게 푸시 알림 발송

### Response — 성공 `200`

```json
{
  "success": true,
  "data": { "contractId": 55 },
  "message": "호스트 취소 요청이 거절되었습니다."
}
```

---

## 6. 렌탈 주문 전체 취소

```
POST /rental-orders/:rentalOrderId/cancel
```

### Request

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `reason` | string | ✅ | 취소 사유 |
| `refundAmount` | number | | 환불 금액 (미지정 시 활성 아이템 전체 금액) |

```json
{
  "reason": "배송 불가 지역 확인으로 취소",
  "refundAmount": 50000
}
```

### 처리 흐름

- 활성 아이템(`status != CANCELLED`) 전체 → `CANCELLED`
- 주문 상태 → `FULLY_REFUNDED`
- `RentalPayment` 기준으로 PG 취소 실행
- PG 실패 시 주문 취소는 유지, `RentalPaymentFailureLog` 기록, 응답에 `pgFailure: true` 포함

### Response — 성공 `200`

```json
{
  "success": true,
  "data": {
    "rentalOrderId": "260101-R0001",
    "cancelledItems": [
      { "id": 3, "name": "청소기", "quantity": 1, "status": "CANCELLED" }
    ],
    "orderStatus": "FULLY_REFUNDED",
    "totalRefunded": 50000
  },
  "message": "렌탈 주문이 전체 취소되었습니다."
}
```

### Response — 에러

| 상태코드 | code | 상황 |
|----------|------|------|
| 404 | RENTAL_ORDER_NOT_FOUND | 주문을 찾을 수 없음 |
| 400 | MISSING_REQUIRED_FIELDS | `reason` 누락 |
| 400 | RENTAL_ORDER_ALREADY_CANCELLED | 이미 전체 취소된 주문 |
| 502 | 4900 | PG 취소 실패 — DB rollback됨, 재시도 가능 |

---

## 공통 에러 응답 형식

```json
{
  "success": false,
  "error": {
    "code": 4900,
    "message": "에러 메시지",
    "pgErrorCode": "1021"   // PG 관련 에러 시만 포함
  }
}
```

---

## PG 실패 처리 가이드 (프론트 대응)

| API | PG 실패 시 동작 | 응답 상태코드 | 프론트 처리 |
|-----|----------------|-------------|------------|
| 환불 승인 | DB rollback → 상태 `REQUESTED` 유지 | **502** | 에러 토스트, 재시도 가능 안내 |
| 강제 취소 | DB rollback → 계약/환불 모두 원복 | **502** | 에러 토스트, 재시도 가능 안내 |
| 렌탈 취소 | DB rollback → 주문/아이템 모두 원복 | **502** | 에러 토스트, 재시도 가능 안내 |

> PG 실패 시 3개 API 모두 DB가 원상복구되어 동일하게 재시도 가능합니다.
