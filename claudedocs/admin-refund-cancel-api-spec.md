# 관리자 환불/취소 API 스펙

> **Base URL:** `http://localhost:8080/api/admin`
> **인증:** 모든 요청에 `Authorization: Bearer <adminToken>` 필요
> **권한:** `super_admin` 또는 `admin` 역할 필요 (별도 표기 없는 한)

---

## 변경 이력

| 날짜 | 변경 내용 |
|------|-----------|
| 2026-03-28 | 계약 취소/환불 역할 분리 원칙 적용 — 상태 변경 API와 환불 API 완전 독립 |
| 2026-03-28 | `processAdminRefund` — `refundType` 추가 (FULL/PARTIAL_AMOUNT/PARTIAL_ITEMS), `admin_refunds` 테이블 분리, `items.rentalItems` 배열 형식 변경 |
| 2026-03-28 | `adminForceCancel`, `approveHostCancelRequest` — Refund 생성/PG 취소 제거, 상태 변경만 수행 |
| 2026-03-28 | `POST /rental-payments/:rentalOrderId/refund` 신규 추가 — ADDITIONAL 렌탈 주문 전용 환불 API |
| 2026-03-28 | `POST /rental-orders/:rentalOrderId/cancel` **Deprecated** — 위 신규 API로 대체 |
| 2026-03-27 | 환불 승인 / 강제 취소 / 렌탈 취소 — PG 실제 연동 구현 완료 |

---

## 핵심 원칙: 계약관리 vs 결제관리 역할 분리

```
계약관리 (contract status)     결제관리 (refund / payment)
─────────────────────────      ─────────────────────────────
계약 상태만 변경               금액 처리만 담당
환불 로직 포함 ❌              계약 상태 변경 ❌

강제 취소 API        ──▶       이후 환불이 필요하면 환불 API 별도 호출
호스트 취소 승인 API ──▶       이후 환불이 필요하면 환불 API 별도 호출
```

**`withRefund` 필드 역할:** 환불 실행이 아니라, 계약 상태 저장값 결정용
- `withRefund: true` → `CANCELLED_BY_ADMIN_WITH_REFUND` (이 계약은 환불이 필요함)
- `withRefund: false` → `CANCELLED_BY_ADMIN_NO_REFUND` (환불 없이 종료)

---

## 1. 관리자 환불 처리 (상품별 / 금액 직접 입력 / 전체)

```
POST /payments/:contractId/refund
권한: super_admin, admin
```

> 계약 결제 및 렌탈 주문에 대해 관리자가 환불 유형을 선택하여 처리합니다.
> 환불 이력은 `admin_refunds` 테이블에 저장됩니다 (게스트 정책 기반 `refunds` 테이블과 분리).

### Request

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `refundType` | string | ✅ | `FULL` / `PARTIAL_AMOUNT` / `PARTIAL_ITEMS` |
| `refundReason` | string | ✅ | 환불 사유 |
| `refundAmount` | number | `PARTIAL_AMOUNT` 시 필수 | 환불 금액 (balanceAmount 이하) |
| `items` | object | `PARTIAL_ITEMS` 시 사용 | 상품별 환불 금액 |
| `items.rentalFee` | number | | 임대료 환불액 |
| `items.maintenanceFee` | number | | 관리비 환불액 |
| `items.cleaningFee` | number | | 청소비 환불액 |
| `items.platformFee` | number | | 서비스 수수료 환불액 |
| `items.deposit` | number | | 보증금 환불액 |
| `items.rentalItems` | array | | INITIAL 렌탈 아이템별 환불 목록 `[{ rentalOrderItemId, refundAmount }]` |

> `items.rentalItems`는 **배열** 형식입니다. 단순 금액 입력이 아니라 아이템 ID별 환불액을 지정합니다.
> ADDITIONAL 렌탈 주문 환불은 [API 8 (렌탈 추가결제 환불)](#8-렌탈-추가결제-환불-additional-렌탈-주문-전용)을 사용하세요.

#### refundType별 동작

| refundType | 설명 | 필수 입력 |
|------------|------|----------|
| `FULL` | 계약 결제 잔액 전체 + INITIAL 렌탈 주문 활성 아이템 전체 환불 | `refundReason`만 |
| `PARTIAL_AMOUNT` | 관리자가 직접 금액 입력 (계약 결제에서만 차감, INITIAL 렌탈 아이템 변경 없음) | `refundAmount` |
| `PARTIAL_ITEMS` | 상품 항목별로 금액 지정 + INITIAL 렌탈 아이템 개별 지정 가능 | `items` 내 항목 금액 |

#### 예시 1: 전체 환불

```json
{
  "refundType": "FULL",
  "refundReason": "관리자 판단 전액 환불"
}
```

#### 예시 2: 금액 직접 입력 환불

```json
{
  "refundType": "PARTIAL_AMOUNT",
  "refundAmount": 150000,
  "refundReason": "분쟁 조정 결과 일부 환불"
}
```

#### 예시 3: 상품별 환불 (계약 항목 + INITIAL 렌탈 아이템)

```json
{
  "refundType": "PARTIAL_ITEMS",
  "refundReason": "청소비 및 렌탈 아이템 환불",
  "items": {
    "cleaningFee": 50000,
    "rentalItems": [
      { "rentalOrderItemId": 11, "refundAmount": 20000 },
      { "rentalOrderItemId": 12, "refundAmount": 10000 }
    ]
  }
}
```

### 처리 흐름

1. Payment 상태 확인: `DONE` 또는 `PARTIAL_CANCELED`
2. refundType에 따라 금액 산정 및 검증
   - 항목별 원금 초과 여부 검증 (PARTIAL_ITEMS)
   - balanceAmount 초과 여부 검증
   - `rentalItems` 배열 내 각 `rentalOrderItemId` 존재 여부 및 금액 유효성 검증
3. Payment DB 업데이트 (balanceAmount 차감, status 변경)
4. `admin_refunds` 레코드 생성
5. INITIAL 렌탈 아이템 DB 상태 변경 (`CANCELLED`) — **별도 PG 호출 없음** (INITIAL 렌탈은 계약 결제와 동일 트랜잭션)
6. 계약 결제 PG 취소 API 호출 1회 (계약 상품 금액 + INITIAL 렌탈 금액 합산)
7. commit
8. 응답에 계약 상태가 아직 활성(`PAYMENT_COMPLETED`, `IN_PROGRESS`)이면 `warning` 포함

> **PG 실패 시:** rollback → DB 원복 → 재시도 가능

> **INITIAL vs ADDITIONAL 렌탈 구분:**
> - INITIAL 렌탈 주문: 계약 결제와 같은 PG 트랜잭션 → 이 API로 처리 (DB만 업데이트, PG는 계약 결제 취소에 포함)
> - ADDITIONAL 렌탈 주문: 별도 `rental_payments` 트랜잭션 → [API 8](#8-렌탈-추가결제-환불-additional-렌탈-주문-전용) 사용

### Response — 성공 `200`

```json
{
  "success": true,
  "data": {
    "adminRefundId": 5,
    "refundType": "PARTIAL_ITEMS",
    "totalRefundAmount": 80000,
    "paymentStatus": "PARTIAL_CANCELED",
    "pgReceiptUrl": "https://...",
    "contractItems": {
      "rentalFee": 0,
      "maintenanceFee": 0,
      "cleaningFee": 50000,
      "platformFee": 0,
      "deposit": 0
    },
    "cancelledRentalItems": [
      { "id": 11, "name": "청소기", "refundAmount": 20000 },
      { "id": 12, "name": "수건", "refundAmount": 10000 }
    ],
    "warning": "환불 처리 완료. 계약 상태가 아직 활성 상태입니다. 계약 관리에서 상태를 확인하세요."
  },
  "message": "환불이 처리되었습니다."
}
```

> - `contractItems`: `PARTIAL_ITEMS` 유형일 때만 포함 (계약 상품별 환불액)
> - `cancelledRentalItems`: INITIAL 렌탈 아이템이 취소된 경우에만 포함
> - `warning`: 환불 후 계약이 `PAYMENT_COMPLETED` 또는 `IN_PROGRESS` 상태면 포함. 계약 관리에서 별도 상태 변경 필요

### Response — 에러

| 상태코드 | code | 상황 |
|----------|------|------|
| 400 | VALIDATION_ERROR | `refundType` 누락 또는 유효하지 않은 값 |
| 400 | VALIDATION_ERROR | `refundReason` 누락 |
| 400 | VALIDATION_ERROR | `refundAmount` 누락 또는 0 이하 (PARTIAL_AMOUNT) |
| 400 | VALIDATION_ERROR | 항목별 환불액이 원금 초과 (PARTIAL_ITEMS) |
| 400 | VALIDATION_ERROR | `items.rentalItems` 배열 형식 아님 또는 빈 배열 (PARTIAL_ITEMS에서 rentalItems 지정 시) |
| 400 | VALIDATION_ERROR | `rentalOrderItemId` 해당 계약의 INITIAL 렌탈 주문에 없음 |
| 400 | VALIDATION_ERROR | `rentalOrderItemId` 이미 CANCELLED 상태 |
| 400 | VALIDATION_ERROR | 아이템 환불액이 아이템 금액 초과 |
| 400 | VALIDATION_ERROR | 환불 가능한 INITIAL 렌탈 주문 없음 (rentalItems 지정 시) |
| 404 | PAYMENT_NOT_FOUND | 계약 결제 정보 없음 |
| 400 | PAYMENT_NOT_REFUNDABLE | Payment 상태가 `DONE`/`PARTIAL_CANCELED` 아님 |
| 400 | REFUND_EXCEEDS_BALANCE | 환불 요청액이 잔액 초과 |
| 400 | 4901 | 이미 취소 완료된 결제 (PG 에러코드 `1023`) |
| 400 | 4902 | PG사 취소 거부 (PG 에러코드 `1021`) |
| 502 | 4900 | 기타 PG 취소 실패 — DB rollback됨, 재시도 가능 |

---

## 2. 관리자 강제 취소 (계약 상태 변경만)

```
POST /reservations/:contractId/force-cancel
권한: super_admin, admin
```

> **계약 상태만 변경합니다. 환불/PG 취소는 이 API에서 처리하지 않습니다.**
> 환불이 필요하면 이 API 호출 후 `POST /payments/:contractId/refund`를 별도 호출하세요.

### Request

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `reason` | string | ✅ | 강제 취소 사유 |
| `withRefund` | boolean | | `true`: 환불 필요함 표시 / `false`(기본): 환불 없이 종료 |

```json
{
  "reason": "규정 위반으로 강제 취소 처리",
  "withRefund": true
}
```

### 강제 취소 가능 계약 상태

| 계약 상태 | 취소 유형(cancellationType) | 비고 |
|----------|---------------------------|------|
| `PENDING_APPROVAL`, `APPROVED` | `BEFORE_PAYMENT` | 결제 전 — 환불 대상 없음 |
| `PAYMENT_COMPLETED` | `AFTER_PAYMENT` | 결제 완료 후 미입주 |
| `IN_PROGRESS`, `CANCEL_REQUESTED` | `DURING_STAY` | 임대 진행 중 |

### 계약 상태 변경 결과

| withRefund | 새 계약 status |
|------------|---------------|
| `true` | `CANCELLED_BY_ADMIN_WITH_REFUND` |
| `false` 또는 미입력 | `CANCELLED_BY_ADMIN_NO_REFUND` |

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
    "reason": "규정 위반으로 강제 취소 처리"
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

---

## 3. 호스트 취소 요청 승인 (계약 상태 변경만)

```
POST /reservations/:contractId/approve-cancel-request
권한: super_admin, admin
```

> **계약 상태만 변경합니다. 환불/PG 취소는 이 API에서 처리하지 않습니다.**
> `withRefund: true`로 승인했다면 `POST /payments/:contractId/refund`를 별도 호출하세요.

### Request

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `withRefund` | boolean | | 게스트 환불 필요 여부 (metadata에 기록용) |
| `adminNote` | string | | 관리자 메모 |

```json
{
  "withRefund": true,
  "adminNote": "호스트 귀책으로 게스트 환불 승인"
}
```

### 처리 조건

- 계약 `status === 'IN_PROGRESS'`
- `ContractStatusLog`에 `CANCEL_REQUEST_BY_HOST` 이력 존재

### 처리 결과

- 계약 상태: `CANCELLED_BY_HOST`
- `withRefund` 값은 `ContractStatusLog.metadata`에 기록됨
- 호스트 + 게스트 푸시 알림 발송

### Response — 성공 `200`

```json
{
  "success": true,
  "data": {
    "contractId": 55,
    "previousStatus": "IN_PROGRESS",
    "newStatus": "CANCELLED_BY_HOST",
    "withRefund": true,
    "adminNote": "호스트 귀책으로 게스트 환불 승인"
  },
  "message": "호스트 취소 요청이 승인되었습니다."
}
```

### Response — 에러

| 상태코드 | code | 상황 |
|----------|------|------|
| 404 | CONTRACT_NOT_FOUND | 계약을 찾을 수 없음 |
| 400 | 4631 | `IN_PROGRESS` 상태 아님 (`currentStatus` 포함) |
| 404 | 4632 | 호스트 취소 요청 이력 없음 |

---

## 4. 호스트 취소 요청 거절

```
POST /reservations/:contractId/reject-cancel-request
권한: super_admin, admin
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
- 거절 이력만 `ContractStatusLog`에 기록
- 호스트에게 푸시 알림 발송

### Response — 성공 `200`

```json
{
  "success": true,
  "data": {
    "contractId": 55,
    "status": "IN_PROGRESS",
    "adminNote": "호스트 귀책 사유 불충분"
  },
  "message": "호스트 취소 요청이 거절되었습니다."
}
```

### Response — 에러

| 상태코드 | code | 상황 |
|----------|------|------|
| 404 | CONTRACT_NOT_FOUND | 계약을 찾을 수 없음 |
| 400 | 4633 | `IN_PROGRESS` 상태 아님 |
| 404 | 4634 | 호스트 취소 요청 이력 없음 |

---

## 5. 게스트 환불 요청 승인

```
PATCH /refunds/:refundId/approve
```

> 게스트가 직접 요청한 환불(정책 기반)을 관리자가 승인합니다.
> `refunds` 테이블 대상 (관리자 직접 환불과 별개).

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

- `refundStatus === 'REQUESTED'` 상태만 승인 가능
- `finalRefundAmount > 0` 이면 PayTag PG 취소 API 호출
- PG 성공 → `refundStatus: COMPLETED`
- `finalRefundAmount === 0` 이면 PG 없이 즉시 `COMPLETED`
- PG 실패 → `refundStatus: REFUND_FAILED`, `PaymentFailureLog` 기록

### Response — 성공 `200`

```json
{
  "success": true,
  "data": {
    "refundId": 12,
    "refundStatus": "COMPLETED",
    "approvedAt": "2026-03-28T10:00:00.000Z",
    "completedAt": "2026-03-28T10:00:00.000Z",
    "finalRefundAmount": 150000
  },
  "message": "환불이 승인되어 PG 취소가 완료되었습니다."
}
```

### Response — 에러

| 상태코드 | code | 상황 |
|----------|------|------|
| 404 | 3006 | 환불 요청을 찾을 수 없음 |
| 400 | 4503 | `REQUESTED` 상태가 아님 (`currentStatus` 포함) |
| 502 | 4900 | PG 취소 실패 — `refundStatus: REFUND_FAILED` 로 변경, 수동 처리 필요 |

> **502 발생 시:** `REFUND_FAILED` 상태 건을 관리자 화면에서 별도 식별하여 수동 처리 안내 필요.

---

## 6. 게스트 환불 요청 거절

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

- `refundStatus === 'REQUESTED'` 상태만 거절 가능
- 계약 상태를 `CANCEL_REQUESTED` 이전 상태로 복원 (`ContractStatusLog` 기반)
- PG 호출 없음

### Response — 성공 `200`

```json
{
  "success": true,
  "data": {
    "refundId": 12,
    "refundStatus": "REJECTED",
    "rejectionReason": "중복 요청으로 거절합니다.",
    "rejectedAt": "2026-03-28T10:00:00.000Z"
  },
  "message": "환불 요청이 거절되었습니다."
}
```

### Response — 에러

| 상태코드 | code | 상황 |
|----------|------|------|
| 404 | 3006 | 환불 요청을 찾을 수 없음 |
| 400 | 4504 | `rejection_reason` 누락 |
| 400 | 4505 | `REQUESTED` 상태 아님 |

---

## 7. ~~렌탈 주문 전체 취소~~ (Deprecated)

```
[DEPRECATED] POST /rental-orders/:rentalOrderId/cancel
```

> ⚠️ **이 API는 Deprecated 되었습니다.**
> INITIAL 렌탈 주문 환불은 [API 1 (관리자 환불 처리)](#1-관리자-환불-처리-상품별--금액-직접-입력--전체)의 `items.rentalItems`를 사용하세요.
> ADDITIONAL 렌탈 주문 환불은 [API 8 (렌탈 추가결제 환불)](#8-렌탈-추가결제-환불-additional-렌탈-주문-전용)을 사용하세요.

---

## 8. 렌탈 추가결제 환불 (ADDITIONAL 렌탈 주문 전용)

```
POST /rental-payments/:rentalOrderId/refund
권한: super_admin, admin
```

> ADDITIONAL 타입 렌탈 주문의 `rental_payments` 결제건을 대상으로 환불합니다.
> INITIAL 렌탈 주문은 계약 결제와 동일 PG 트랜잭션이므로 이 API 대상이 아닙니다.

### Request

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `refundType` | string | ✅ | `FULL` / `PARTIAL_AMOUNT` / `PARTIAL_ITEMS` |
| `refundReason` | string | ✅ | 환불 사유 |
| `refundAmount` | number | `PARTIAL_AMOUNT` 시 필수 | 환불 금액 |
| `items` | array | `PARTIAL_ITEMS` 시 필수 | `[{ rentalOrderItemId, refundAmount }]` |

#### refundType별 동작

| refundType | 설명 | 필수 입력 |
|------------|------|----------|
| `FULL` | `rental_payments` 잔액 전체 + 활성 아이템 전체 CANCELLED | `refundReason`만 |
| `PARTIAL_AMOUNT` | 직접 금액 입력 (아이템 상태 변경 없음) | `refundAmount` |
| `PARTIAL_ITEMS` | 아이템별 환불액 지정 | `items` 배열 |

#### 예시 1: 전체 환불

```json
{
  "refundType": "FULL",
  "refundReason": "관리자 판단 전액 환불"
}
```

#### 예시 2: 아이템별 부분 환불

```json
{
  "refundType": "PARTIAL_ITEMS",
  "refundReason": "특정 아이템 환불",
  "items": [
    { "rentalOrderItemId": 21, "refundAmount": 15000 }
  ]
}
```

### 처리 흐름

1. RentalOrder 조회 (rentalOrderId 기준) — `FULLY_REFUNDED`/`CANCELLED` 이면 오류
2. RentalPayment 조회 (`DONE` 또는 `PARTIAL_CANCELED` 상태)
3. refundType에 따라 금액 산정 및 검증
4. RentalOrderItem 상태 변경 CANCELLED (FULL / PARTIAL_ITEMS)
5. RentalOrder.refundedAmount 누적, status 결정
6. RentalPayment.balanceAmount 차감, status 결정
7. `RentalOrderLog` 기록 (action: `ADMIN_REFUND`)
8. `rental_payments` PG 취소 API 호출
9. commit

> **PG 실패 시:** rollback → DB 원복 → 재시도 가능

### Response — 성공 `200`

```json
{
  "success": true,
  "data": {
    "rentalOrderId": "260101-R0001",
    "refundType": "PARTIAL_ITEMS",
    "refundAmount": 15000,
    "orderStatus": "PARTIAL_REFUND",
    "paymentStatus": "PARTIAL_CANCELED",
    "cancelledItems": [
      { "id": 21, "name": "청소기", "refundAmount": 15000 }
    ]
  },
  "message": "렌탈 추가결제 환불이 처리되었습니다."
}
```

> - `cancelledItems`: FULL 또는 PARTIAL_ITEMS 유형일 때만 포함

### Response — 에러

| 상태코드 | code | 상황 |
|----------|------|------|
| 404 | RENTAL_ORDER_NOT_FOUND | 렌탈 주문을 찾을 수 없음 |
| 400 | RENTAL_ORDER_ALREADY_CANCELLED | 이미 `FULLY_REFUNDED`/`CANCELLED` 상태 |
| 404 | PAYMENT_NOT_FOUND | `DONE`/`PARTIAL_CANCELED` 상태의 rental_payments 없음 |
| 400 | VALIDATION_ERROR | `refundType`/`refundReason` 누락 또는 유효하지 않은 값 |
| 400 | VALIDATION_ERROR | `refundAmount` 0 이하 또는 잔액 초과 (PARTIAL_AMOUNT) |
| 400 | VALIDATION_ERROR | `items` 빈 배열 또는 형식 오류 (PARTIAL_ITEMS) |
| 400 | VALIDATION_ERROR | `rentalOrderItemId` 없음 또는 이미 CANCELLED |
| 400 | VALIDATION_ERROR | 아이템 환불액이 아이템 금액 초과 |
| 400 | REFUND_EXCEEDS_BALANCE | 전체 환불 요청액이 잔액 초과 |
| 400 | 4901 | 이미 취소 완료된 결제 (PG 에러코드 `1023`) |
| 400 | 4902 | PG사 취소 거부 (PG 에러코드 `1021`) |
| 502 | 4900 | 기타 PG 취소 실패 — DB rollback됨, 재시도 가능 |

---

## 주요 플로우 예시

### 플로우 A: 관리자가 계약을 강제 취소하고 환불까지 처리

```
1. POST /reservations/55/force-cancel
   Body: { "reason": "규정 위반", "withRefund": true }
   → contracts.status = CANCELLED_BY_ADMIN_WITH_REFUND

2. POST /payments/55/refund
   Body: { "refundType": "FULL", "refundReason": "강제 취소 전액 환불" }
   → admin_refunds 생성, 계약 결제 PG 취소 (INITIAL 렌탈 포함)
```

### 플로우 B: 관리자가 환불 없이 계약만 종료

```
1. POST /reservations/55/force-cancel
   Body: { "reason": "입주 포기 확인", "withRefund": false }
   → contracts.status = CANCELLED_BY_ADMIN_NO_REFUND
   (환불 API 호출 불필요)
```

### 플로우 C: 호스트 취소 요청 승인 후 게스트 환불

```
1. POST /reservations/55/approve-cancel-request
   Body: { "withRefund": true, "adminNote": "호스트 귀책 확인" }
   → contracts.status = CANCELLED_BY_HOST

2. POST /payments/55/refund
   Body: {
     "refundType": "PARTIAL_ITEMS",
     "refundReason": "호스트 귀책 환불",
     "items": {
       "rentalFee": 200000,
       "rentalItems": [{ "rentalOrderItemId": 11, "refundAmount": 20000 }]
     }
   }
   → admin_refunds 생성, 계약 결제 PG 부분 취소 (INITIAL 렌탈 아이템 DB 취소 포함)
```

### 플로우 D: ADDITIONAL 렌탈 추가결제 환불

```
1. POST /rental-payments/260101-R0002/refund
   Body: {
     "refundType": "PARTIAL_ITEMS",
     "refundReason": "아이템 반납 확인",
     "items": [{ "rentalOrderItemId": 21, "refundAmount": 15000 }]
   }
   → RentalPayment PG 부분 취소, RentalOrderItem CANCELLED
   (계약 상태 변경 없음)
```

---

## 공통 에러 응답 형식

```json
{
  "success": false,
  "error": {
    "code": 4900,
    "message": "에러 메시지",
    "pgErrorCode": "1021"
  }
}
```

---

## PG 실패 처리 가이드

| API | PG 실패 시 동작 | 응답 코드 | 프론트 처리 |
|-----|----------------|-----------|------------|
| 관리자 환불 처리 (계약) | DB rollback → 상태 원복 | 502 | 에러 토스트, 재시도 가능 안내 |
| 렌탈 추가결제 환불 | DB rollback → 상태 원복 | 502 | 에러 토스트, 재시도 가능 안내 |
| 게스트 환불 승인 | `REFUND_FAILED` 상태로 변경 (rollback 없음) | 502 | 에러 토스트, 관리자 수동 처리 필요 |
| 강제 취소 | PG 호출 없음 (순수 상태 변경) | — | — |
| 호스트 취소 승인 | PG 호출 없음 (순수 상태 변경) | — | — |

---

## DB 저장 위치 참고

| 환불 종류 | 저장 테이블 | 비고 |
|----------|------------|------|
| 게스트 직접 취소 (정책 기반) | `refunds` | `policy_type_used`, `days_before_checkin` 등 정책 컬럼 포함 |
| 관리자 계약 환불 (INITIAL 렌탈 포함) | `admin_refunds` | `refund_type`, `admin_id` 포함, 정책 컬럼 없음 |
| 관리자 렌탈 추가결제 환불 (ADDITIONAL) | `rental_order_logs` | action: `ADMIN_REFUND`, `RentalPayment.balanceAmount` 차감 |
| INITIAL 렌탈 아이템 DB 취소 | `rental_order_items` | `status: CANCELLED`, `refund_amount` 기록 — 별도 PG 호출 없음 |
