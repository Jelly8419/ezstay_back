# 옵션상품(렌탈아이템) 취소/반품 API 개발 문서

> 대상: 프론트엔드 개발자
> 최종 업데이트: 2026-03-30
> 연관 PRD: `docs/GUEST_OPTION__GOODS_PRD.md`

---

## 목차

1. [개요 및 흐름](#1-개요-및-흐름)
2. [UI 버튼 분기 기준](#2-ui-버튼-분기-기준)
3. [상품 상태 정의](#3-상품-상태-정의)
4. [API 명세](#4-api-명세)
   - [4.1 렌탈 주문 목록 조회](#41-렌탈-주문-목록-조회)
   - [4.2 결제취소 (즉시환불)](#42-결제취소-즉시환불)
   - [4.3 반품 신청](#43-반품-신청)
   - [4.4 반품 환불 예상 금액 조회](#44-반품-환불-예상-금액-조회)
5. [에러 코드](#5-에러-코드)
6. [구현 시 주의사항](#6-구현-시-주의사항)

---

## 1. 개요 및 흐름

게스트는 계약 관리 페이지에서 옵션 취소 모달을 통해 옵션상품을 취소할 수 있습니다.
취소 방식은 **배송 상태**에 따라 완전히 분리됩니다.

```
옵션 취소 모달 진입
        │
        ├─ [결제 취소] 버튼 탭
        │     └─ 배송전 상품만 표시/선택 가능
        │           └─ POST /contracts/:contractId/rental-items/cancel
        │                 └─ 즉시 PG 환불 처리 → 환불완료
        │
        └─ [반품 신청] 버튼 탭
              └─ 배송중 / 배송완료 상품만 표시/선택 가능
                    └─ POST /contracts/:contractId/rental-items/return-request
                          └─ 반품 신청 접수 → 관리자 처리 대기
```

---

## 2. UI 버튼 분기 기준

### 2.1 모달 내 탭 분기

옵션 취소 모달은 두 개의 탭(버튼)으로 구성됩니다.

| 탭 | 호출 API | 활성화 조건 |
|----|---------|-----------|
| 결제 취소 | `/rental-items/cancel` | 계약 상태 = `PAYMENT_COMPLETED` |
| 반품 신청 | `/rental-items/return-request` | 계약 상태 = `PAYMENT_COMPLETED` or `IN_PROGRESS` |

> 입주 전(`PAYMENT_COMPLETED`)에도 배송이 완료될 수 있으므로 반품 신청은 두 상태 모두 허용됩니다.

> 계약 상태가 `COMPLETED`, `CANCELLED` 등 종료 상태이면 모달 자체를 비활성화하세요.

### 2.2 상품 체크박스 활성화 기준

**[결제 취소] 탭에서 선택 가능한 상품:**

| 아이템 `status` | 주문 `deliveryStatus` | 체크박스 |
|---------------|----------------------|---------|
| `ACTIVE` | `PENDING` (배송전) | ✅ 활성 |
| 그 외 모든 경우 | - | ❌ 비활성 |

**[반품 신청] 탭에서 선택 가능한 상품:**

| 아이템 `status` | 주문 `deliveryStatus` | 체크박스 |
|---------------|----------------------|---------|
| `ACTIVE` | `IN_TRANSIT` (배송중) | ✅ 활성 |
| `ACTIVE` | `DELIVERED` (배송완료) | ✅ 활성 |
| `CANCEL_REQUESTED` | - | ❌ 비활성 (이미 신청됨) |
| 그 외 모든 경우 | - | ❌ 비활성 |

### 2.3 환불 금액 계산 (프론트 미리보기용)

**결제 취소:**
```
환불 예상 금액 = 선택한 아이템들의 totalPrice 합산
배송비 차감 없음 → 프론트에서 직접 계산 가능
```

**반품 신청:**
```
수거비(7,000원) 차감 여부가 "같은 계약 내 이미 수거 진행 중인 반품 건 존재 여부"에 따라 달라짐
→ 프론트에서 직접 계산하지 말고 반드시 preview API를 호출해 서버에서 계산된 값을 표시할 것
```

**preview API 사용 (4.4절 참조):**
```
GET /api/contracts/:contractId/rental-items/return-preview?itemIds=12,13
→ 응답의 summary.totalRefundAmount 값을 모달에 표시
→ shippingDeductionReason으로 수거비 면제/차감 사유도 함께 안내 가능
```

> 반품 신청 예상 금액은 참고용이며, 실제 환불 금액은 관리자 처리 후 확정됩니다. 모달에 "관리자 처리 후 최종 확정" 안내 문구를 표시하세요.

### 2.4 반품 신청 탭 추가 입력 필드

반품 신청 탭에서는 다음 입력이 필요합니다:

| 필드 | 필수 여부 | 설명 |
|------|---------|------|
| 반품 사유 | **필수** | 텍스트 입력, 미입력 시 API 400 에러 |
| 이미지 첨부 | 선택 | PRD 명시 항목이나 현재 API 미지원 (추후 구현) |

---

## 3. 상품 상태 정의

### 3.1 아이템 상태 (`rental_order_items.status`)

| 값 | 한글명 | 설명 |
|----|--------|------|
| `ACTIVE` | 활성 | 정상 상태, 취소/반품 신청 가능 |
| `CANCEL_REQUESTED` | 취소 요청 | 반품 신청 접수됨, 관리자 처리 대기 중 |
| `CANCELLED` | 취소됨 | 환불 완료된 최종 상태 |

### 3.2 주문 배송 상태 (`rental_orders.delivery_status`)

| 값 | 한글명 | 설명 |
|----|--------|------|
| `PENDING` | 배송전 | 아직 배송 시작 전 → **결제취소** 가능 |
| `IN_TRANSIT` | 배송중 | 배송 진행 중 → **반품신청** 가능 |
| `DELIVERED` | 배송완료 | 게스트 수령 완료 → **반품신청** 가능 |

### 3.3 상태 흐름도

```
[결제취소 경로]
ACTIVE (배송전) ──→ CANCELLED (환불완료)

[반품신청 경로]
ACTIVE (배송중/완료) ──→ CANCEL_REQUESTED (반품신청중)
                              │
              ┌───────────────┴───────────────┐
              ↓ 관리자 승인                    ↓ 관리자 거절
           CANCELLED                        ACTIVE (원복)
       + 수거 프로세스 시작              (deliveryStatus도 복원)
```

---

## 4. API 명세

### 공통

- **Base URL**: `http://localhost:8080/api`
- **인증**: Bearer Token (JWT) 필수
- **Content-Type**: `application/json`

---

### 4.1 렌탈 주문 목록 조회

모달 진입 시 호출하여 상품 목록 및 각 아이템 상태를 가져옵니다.

```
GET /api/contracts/:contractId/rental-orders
Authorization: Bearer {token}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "modifiable": true,
    "modifiableUntil": "2026-04-10T23:59:59.000Z",
    "daysRemaining": 11,
    "summary": {
      "totalPaid": 50000,
      "totalRefunded": 0,
      "netAmount": 50000,
      "activeItemsCount": 3
    },
    "orders": [
      {
        "id": 1,
        "orderId": "260320-R0001",
        "orderType": "INITIAL",
        "status": "PAID",
        "deliveryStatus": "PENDING",
        "deliveryStatusLabel": "배송전",
        "totalAmount": 30000,
        "paidAmount": 30000,
        "refundedAmount": 0,
        "items": [
          {
            "id": 10,
            "rentalItemId": 3,
            "name": "드라이기",
            "itemType": "hair_dryer",
            "imageUrl": "https://...",
            "quantity": 1,
            "pricePerItem": 10000,
            "totalPrice": 10000,
            "status": "ACTIVE",
            "statusLabel": "활성",
            "cancelledAt": null,
            "refundAmount": null,
            "cancelReason": null
          }
        ]
      }
    ]
  }
}
```

**프론트 활용 포인트:**
- `orders[].deliveryStatus` → 탭별 체크박스 활성화 판단
- `orders[].items[].status` → 아이템별 체크박스 활성화 판단
- `orders[].items[].id` → 취소/반품 신청 시 `itemIds` 배열에 담을 값

---

### 4.2 결제취소 (즉시환불)

배송전 상품을 선택해 즉시 PG 환불 처리합니다.

```
POST /api/contracts/:contractId/rental-items/cancel
Authorization: Bearer {token}
Content-Type: application/json
```

**Request Body:**
```json
{
  "itemIds": [10, 11],
  "reason": "필요 없어짐"
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `itemIds` | `number[]` | **필수** | 취소할 `rental_order_items.id` 배열, 여러 주문건 혼합 가능 |
| `reason` | `string` | 선택 | 취소 사유 |

**Response 200 (전체 성공):**
```json
{
  "success": true,
  "message": "선택한 상품이 모두 취소되었습니다.",
  "data": {
    "succeeded": [
      {
        "orderId": "260320-R0001",
        "refundAmount": 20000,
        "cancelledItems": [
          { "id": 10, "name": "드라이기", "quantity": 1 },
          { "id": 11, "name": "수건세트", "quantity": 2 }
        ]
      }
    ],
    "failed": [],
    "totalRefunded": 20000
  }
}
```

**Response 200 (부분 성공):**

> 여러 주문건 처리 중 일부 주문의 PG 취소가 실패하면 부분 성공 응답이 옵니다.
> HTTP 상태는 200이지만 `failed` 배열이 비어있지 않으면 실패 항목을 별도 안내하세요.

```json
{
  "success": true,
  "message": "1건 취소 완료, 1건 처리 실패.",
  "data": {
    "succeeded": [
      {
        "orderId": "260320-R0001",
        "refundAmount": 10000,
        "cancelledItems": [{ "id": 10, "name": "드라이기", "quantity": 1 }]
      }
    ],
    "failed": [
      {
        "orderId": "260320-R0002",
        "reason": "카드사 점검 중입니다. 잠시 후 다시 시도해주세요."
      }
    ],
    "totalRefunded": 10000
  }
}
```

**부분 성공 처리 가이드:**
```
if (data.failed.length > 0) {
  // 실패 항목에 대해 개별 안내 토스트 표시
  // "260320-R0002 주문 취소 실패: 카드사 점검 중..."
  // 성공 항목은 정상 처리됨을 표시
  // 실패 항목은 다시 선택해서 재시도 유도
}
```

---

### 4.3 반품 신청

배송중/배송완료 상품을 선택해 반품 신청을 접수합니다.
PG 호출 없이 접수만 하며, 실제 환불은 관리자 처리 후 진행됩니다.

```
POST /api/contracts/:contractId/rental-items/return-request
Authorization: Bearer {token}
Content-Type: application/json
```

**Request Body:**
```json
{
  "itemIds": [12, 13],
  "reason": "제품 불량"
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `itemIds` | `number[]` | **필수** | 반품 신청할 `rental_order_items.id` 배열, **단일 주문 내 아이템만 가능** (주문 혼합 불가) |
| `reason` | `string` | **필수** | 반품 사유 (미입력 시 400 에러) |

**Response 200:**
```json
{
  "success": true,
  "message": "반품 신청이 접수되었습니다.",
  "data": {
    "requestedOrders": [
      {
        "refundRequestId": 5,
        "orderId": "260320-R0002",
        "deliveryStatus": "IN_TRANSIT",
        "itemTotalAmount": 30000,
        "requestedItems": [
          { "id": 12, "name": "침구세트", "quantity": 1 },
          { "id": 13, "name": "타월세트", "quantity": 2 }
        ]
      }
    ],
    "totalOrderCount": 1,
    "message": "관리자 확인 후 환불이 처리됩니다."
  }
}
```

> 반품 신청은 전체 성공 또는 전체 실패입니다 (단일 트랜잭션). 부분 성공 없음.

---

### 4.4 반품 환불 예상 금액 조회

반품 신청 모달에서 확인 버튼 누르기 **전**, 선택한 아이템의 예상 환불 금액을 미리 보여줄 때 사용합니다.
관리자 승인 시 적용되는 것과 동일한 수거비 차감 로직을 그대로 사용합니다.

```
GET /api/contracts/:contractId/rental-items/return-preview?itemIds=12,13
Authorization: Bearer {token}
```

**Query Parameters:**

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `itemIds` | `string` | **필수** | 콤마(`,`)로 구분된 아이템 ID 목록 (예: `12,13,14`) |

**Response 200:**
```json
{
  "success": true,
  "message": "환불 예상 금액 조회 성공",
  "data": {
    "orderPreviews": [
      {
        "orderId": "260320-R0002",
        "rentalOrderId": 2,
        "deliveryStatus": "IN_TRANSIT",
        "itemTotalAmount": 30000,
        "shippingDeduction": 7000,
        "refundAmount": 23000,
        "shippingDeductionReason": "배송 완료 상품 수거비",
        "items": [
          { "id": 12, "name": "침구세트", "quantity": 1, "totalPrice": 20000 },
          { "id": 13, "name": "타월세트", "quantity": 2, "totalPrice": 10000 }
        ]
      }
    ],
    "summary": {
      "totalItemAmount": 30000,
      "totalShippingDeduction": 7000,
      "totalRefundAmount": 23000
    }
  }
}
```

**수거비 차감 여부 케이스:**

| 배송 상태 | 기존 수거 예정 건 | `shippingDeduction` | `shippingDeductionReason` |
|---------|----------------|--------------------|-----------------------------|
| `PENDING` (배송전) | 무관 | `0` | "배송 전 (수거비 없음)" |
| `IN_TRANSIT` / `DELIVERED` | 없음 | `7000` | "배송 완료 상품 수거비" |
| `IN_TRANSIT` / `DELIVERED` | 있음 (수거 진행 중) | `0` | "다른 반품 건과 수거 통합으로 면제" |

> **주의**: 이 API는 **예상 금액**입니다. 관리자 처리 시점에 수거 상황이 달라질 수 있으므로 모달에 "실제 환불 금액은 관리자 처리 후 확정됩니다" 안내 문구를 함께 표시하세요.

**사용 시점 권장:**
```
[반품 신청] 탭에서 아이템 선택
      ↓
아이템 선택 변경 시마다 (또는 확인 버튼 클릭 시)
GET /rental-items/return-preview?itemIds=12,13 호출
      ↓
예상 환불 금액 + shippingDeductionReason 표시
      ↓
게스트가 확인 후 반품 사유 입력
      ↓
POST /rental-items/return-request 호출
```

---

## 5. 에러 코드

| HTTP | code | 상황 | 프론트 대응 |
|------|------|------|-----------|
| 400 | 4421 | 입주 시작 후 7일 경과 | "취소 가능 기간이 지났습니다" 안내 |
| 400 | 4424 | 이미 처리 중인 반품 요청 존재 | "이미 반품 신청된 상품입니다" 안내 |
| 400 | 4425 | 배송 시작된 상품에 결제취소 시도 | 탭 분기 재확인 (정상적으로는 발생 안 함) |
| 400 | 4460 | 아이템 미존재 | itemIds 재확인 |
| 400 | 4461 | 다른 계약의 아이템 포함 | itemIds 재확인 |
| 400 | 4462 | ACTIVE가 아닌 아이템 선택 | 체크박스 비활성화 로직 재확인 |
| 400 | 4463 | 환불 불가 상태 주문 | 주문 상태 재확인 |
| 400 | 4470 | 배송전 상품에 반품신청 시도 | 탭 분기 재확인 (정상적으로는 발생 안 함) |
| 400 | 4471 | 반품신청에 여러 주문건 혼합 선택 | 주문별로 각각 신청 유도 |
| 403 | - | 본인 계약 아님 | 인증 재확인 |
| 404 | - | 계약 미존재 | contractId 재확인 |

> `4425`, `4470`은 프론트에서 탭 분기를 정확히 구현했다면 발생하지 않아야 합니다.
> 백엔드 이중 검증 목적으로만 존재합니다.

---

## 6. 구현 시 주의사항

### 6.1 itemIds 구성

`itemIds`는 `rental_order_items.id` (DB 레코드 ID)입니다.
주문 목록 조회 응답의 `orders[].items[].id` 값을 사용하세요.

```javascript
// 올바른 예시
const itemIds = selectedItems.map(item => item.id)  // item.id = rental_order_items.id

// 잘못된 예시
const itemIds = selectedItems.map(item => item.rentalItemId)  // 상품 카탈로그 ID (다름)
```

### 6.2 여러 주문건 혼합 선택

같은 탭 내에서는 여러 주문건의 아이템을 한 번에 선택해 단일 API 호출로 처리할 수 있습니다.

```javascript
// 주문A의 아이템 + 주문B의 아이템 동시 선택 가능
const itemIds = [10, 11, 15, 16]  // 주문A: 10,11 / 주문B: 15,16
```

### 6.3 결제취소 부분 성공 처리

결제취소 응답은 HTTP 200이어도 `failed` 배열을 반드시 확인하세요.

```javascript
const response = await cancelRentalItems(contractId, itemIds, reason)

if (response.data.failed.length > 0) {
  // 일부 실패 처리
  showPartialFailureToast(response.data.failed)
}

if (response.data.succeeded.length > 0) {
  // 성공 처리 (목록 갱신 등)
  refreshOrderList()
}
```

### 6.4 반품 신청 후 아이템 상태

반품 신청이 성공하면 해당 아이템의 `status`가 `CANCEL_REQUESTED`로 변경됩니다.
목록 재조회 시 해당 아이템은 체크박스 비활성화 처리해야 합니다.

### 6.5 탭 비활성화 조건 정리

```javascript
// 결제취소 탭 비활성화
const isCancelTabDisabled = contract.status !== 'PAYMENT_COMPLETED'

// 반품신청 탭 비활성화 (입주 전 배송 완료 케이스 포함)
const isReturnTabDisabled = !['PAYMENT_COMPLETED', 'IN_PROGRESS'].includes(contract.status)

// 모달 자체 비활성화
const terminalStatuses = ['COMPLETED', 'CANCELLED', 'CANCELLED_BY_GUEST',
                          'CANCELLED_BY_HOST', 'CANCELLED_BY_ADMIN_WITH_REFUND',
                          'CANCELLED_BY_ADMIN_NO_REFUND']
const isModalDisabled = terminalStatuses.includes(contract.status)
```
