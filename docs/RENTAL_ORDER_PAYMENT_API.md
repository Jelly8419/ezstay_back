# 렌탈 아이템 추가 주문 결제 API 가이드

> **프론트엔드 개발자를 위한 렌탈 추가 결제 연동 가이드**

## 개요

계약 결제 완료 후 렌탈 아이템을 추가로 주문할 때 사용하는 API입니다.
**토스페이먼츠 SDK를 반드시 호출**해야 결제가 완료됩니다.

### 주요 제한 사항

| 항목 | 제한 |
|------|------|
| **결제 제한 시간** | 주문 생성 후 **15분** 이내 결제 필요 |
| **주문 가능 기간** | 입주일 **5일 전**까지 |
| **미결제 주문** | 15분 경과 시 **자동 취소** (재고 반환) |

> ⚠️ 주문 생성 후 15분이 지나면 자동으로 취소되므로, 결제 화면에서 남은 시간을 표시해주세요.

---

## 전체 플로우

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        렌탈 추가 주문 결제 플로우                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. 이용 가능 아이템 조회                                                    │
│     GET /api/contracts/:contractId/available-rental-items                   │
│                              ↓                                              │
│  2. 추가 렌탈 주문 생성 (결제 대기 상태)                                      │
│     POST /api/contracts/:contractId/rental-orders                           │
│                              ↓                                              │
│  3. 결제 정보 조회 (토스 SDK용)                                              │
│     GET /api/rental-orders/:rentalOrderId/payment-info                      │
│                              ↓                                              │
│  4. 토스페이먼츠 SDK 호출 ⭐ (프론트엔드)                                     │
│     tossPayments.requestPayment()                                           │
│                              ↓                                              │
│  5. 결제 승인 요청 (paymentKey 전달)                                         │
│     POST /api/rental-orders/:rentalOrderId/confirm-payment                  │
│                              ↓                                              │
│  6. 결제 완료!                                                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## API 상세

### 1. 이용 가능한 렌탈 아이템 조회

해당 계약 기간에 대여 가능한 아이템 목록을 조회합니다.

```
GET /api/contracts/:contractId/available-rental-items
Authorization: Bearer {accessToken}
```

**Response**
```json
{
  "success": true,
  "data": {
    "modifiable": true,
    "modifiableUntil": "2025-02-10T23:59:59.999Z",
    "checkInDate": "2025-02-15",
    "checkOutDate": "2025-02-20",
    "items": [
      {
        "id": 1,
        "name": "침구세트",
        "itemType": "BEDDING",
        "itemTypeLabel": "침구류",
        "description": "프리미엄 침구세트",
        "price": 30000,
        "imageUrl": "/uploads/rental/bedding.jpg",
        "totalStock": 10,
        "availableQuantity": 5
      }
    ]
  }
}
```

> ⚠️ `modifiable: false`인 경우 입주일 5일 전이 지나 더 이상 주문할 수 없습니다.

---

### 2. 추가 렌탈 주문 생성

렌탈 아이템을 선택하여 주문을 생성합니다. (결제 대기 상태)

```
POST /api/contracts/:contractId/rental-orders
Authorization: Bearer {accessToken}
Content-Type: application/json

{
  "items": [
    { "itemId": 1, "quantity": 2 },
    { "itemId": 3, "quantity": 1 }
  ]
}
```

**Response**
```json
{
  "success": true,
  "data": {
    "rentalOrderId": 15,
    "orderId": "260203-R0001",
    "orderType": "ADDITIONAL",
    "totalAmount": 90000,
    "status": "PENDING",
    "modifiableUntil": "2025-02-10T23:59:59.999Z",
    "items": [
      {
        "id": 101,
        "name": "침구세트",
        "quantity": 2,
        "pricePerItem": 30000,
        "totalPrice": 60000
      },
      {
        "id": 102,
        "name": "전자레인지",
        "quantity": 1,
        "pricePerItem": 30000,
        "totalPrice": 30000
      }
    ]
  },
  "message": "렌탈 주문이 생성되었습니다. 결제를 진행해주세요."
}
```

> 🔴 **주의**: 이 단계에서는 아직 결제가 완료되지 않았습니다!

---

### 3. 결제 정보 조회 (토스 SDK용)

토스페이먼츠 SDK에 전달할 결제 정보를 조회합니다.

```
GET /api/rental-orders/:rentalOrderId/payment-info
Authorization: Bearer {accessToken}
```

**Response**
```json
{
  "success": true,
  "data": {
    "rentalOrderId": 15,
    "orderId": "260203-R0001",
    "amount": 90000,
    "orderName": "렌탈 아이템 추가 (침구세트 외 1건)",
    "customerEmail": "guest@example.com",
    "customerName": "홍길동",
    "customerPhone": "010-1234-5678"
  }
}
```

---

### 4. 토스페이먼츠 SDK 호출 ⭐

> **이 단계가 반드시 필요합니다!**

```javascript
// 토스페이먼츠 SDK 초기화
const tossPayments = TossPayments(TOSS_CLIENT_KEY);

// 결제 정보 조회 API 호출
const paymentInfo = await fetch(`/api/rental-orders/${rentalOrderId}/payment-info`, {
  headers: { Authorization: `Bearer ${accessToken}` }
}).then(res => res.json());

// 토스페이먼츠 결제창 호출
await tossPayments.requestPayment('카드', {
  amount: paymentInfo.data.amount,
  orderId: paymentInfo.data.orderId,
  orderName: paymentInfo.data.orderName,
  customerName: paymentInfo.data.customerName,
  customerEmail: paymentInfo.data.customerEmail,

  // 결제 성공/실패 시 리다이렉트 URL
  successUrl: `${window.location.origin}/rental-payment/success?rentalOrderId=${rentalOrderId}`,
  failUrl: `${window.location.origin}/rental-payment/fail?rentalOrderId=${rentalOrderId}`
});
```

**성공 시 리다이렉트 URL 파라미터**
```
/rental-payment/success?rentalOrderId=15&paymentKey=xxx&orderId=260203-R0001&amount=90000
```

---

### 5. 결제 승인 요청

토스 SDK에서 받은 `paymentKey`를 서버로 전달하여 결제를 최종 승인합니다.

```
POST /api/rental-orders/:rentalOrderId/confirm-payment
Authorization: Bearer {accessToken}
Content-Type: application/json

{
  "paymentKey": "tgen_20240203120000abcd1234",
  "orderId": "260203-R0001",
  "amount": 90000
}
```

**Response (성공)**
```json
{
  "success": true,
  "data": {
    "rentalOrderId": 15,
    "orderId": "260203-R0001",
    "status": "PAID",
    "paidAmount": 90000,
    "paidAt": "2025-02-03T12:30:00.000Z",
    "paymentKey": "tgen_20240203120000abcd1234",
    "receiptUrl": "https://dashboard.tosspayments.com/receipt/..."
  },
  "message": "결제가 완료되었습니다."
}
```

**Response (실패)**
```json
{
  "success": false,
  "error": {
    "code": 5001,
    "message": "결제 승인에 실패했습니다.",
    "tossErrorCode": "INVALID_PAYMENT_KEY",
    "tossErrorMessage": "유효하지 않은 결제키입니다."
  }
}
```

---

## 프론트엔드 구현 예시 (React)

```tsx
// RentalPaymentPage.tsx
import { useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { loadTossPayments } from '@tosspayments/payment-sdk';

const TOSS_CLIENT_KEY = process.env.REACT_APP_TOSS_CLIENT_KEY;

// 결제 성공 페이지
export function RentalPaymentSuccessPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const confirmPayment = async () => {
      const rentalOrderId = searchParams.get('rentalOrderId');
      const paymentKey = searchParams.get('paymentKey');
      const orderId = searchParams.get('orderId');
      const amount = searchParams.get('amount');

      try {
        const response = await fetch(
          `/api/rental-orders/${rentalOrderId}/confirm-payment`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${getAccessToken()}`
            },
            body: JSON.stringify({ paymentKey, orderId, amount: Number(amount) })
          }
        );

        const result = await response.json();

        if (result.success) {
          alert('결제가 완료되었습니다!');
          navigate(`/contracts/${contractId}/rental-orders`);
        } else {
          alert(`결제 실패: ${result.error.message}`);
          navigate(`/contracts/${contractId}/rental-orders`);
        }
      } catch (error) {
        console.error('결제 승인 오류:', error);
        alert('결제 처리 중 오류가 발생했습니다.');
      }
    };

    confirmPayment();
  }, [searchParams]);

  return <div>결제 처리 중...</div>;
}

// 렌탈 아이템 선택 및 결제 시작
export async function startRentalPayment(rentalOrderId: number) {
  // 1. 결제 정보 조회
  const paymentInfoRes = await fetch(
    `/api/rental-orders/${rentalOrderId}/payment-info`,
    { headers: { Authorization: `Bearer ${getAccessToken()}` } }
  );
  const paymentInfo = await paymentInfoRes.json();

  // 2. 토스페이먼츠 SDK 로드 및 결제창 호출
  const tossPayments = await loadTossPayments(TOSS_CLIENT_KEY);

  await tossPayments.requestPayment('카드', {
    amount: paymentInfo.data.amount,
    orderId: paymentInfo.data.orderId,
    orderName: paymentInfo.data.orderName,
    customerName: paymentInfo.data.customerName,
    customerEmail: paymentInfo.data.customerEmail,
    successUrl: `${window.location.origin}/rental-payment/success?rentalOrderId=${rentalOrderId}`,
    failUrl: `${window.location.origin}/rental-payment/fail?rentalOrderId=${rentalOrderId}`
  });
}
```

---

## 기타 API

### 렌탈 주문 목록 조회

```
GET /api/contracts/:contractId/rental-orders
Authorization: Bearer {accessToken}
```

### 미결제 주문 취소

```
DELETE /api/rental-orders/:rentalOrderId
Authorization: Bearer {accessToken}
```

### 결제 완료된 아이템 환불 요청

```
POST /api/rental-orders/:rentalOrderId/items/:itemId/cancel
Authorization: Bearer {accessToken}
Content-Type: application/json

{
  "reason": "필요 없어졌습니다"
}
```

---

## 에러 코드

| 코드 | 메시지 | 설명 |
|------|--------|------|
| 3010 | 계약을 찾을 수 없습니다 | 존재하지 않는 계약 ID |
| 6501 | 렌탈 주문을 찾을 수 없습니다 | 존재하지 않는 렌탈 주문 ID |
| 6502 | 게스트만 렌탈 주문을 할 수 있습니다 | 권한 없음 |
| 6503 | 렌탈 변경 기간이 만료되었습니다 | 입주일 5일 전 경과 |
| 6504 | 재고가 부족합니다 | 해당 기간 가용 수량 부족 |
| 6505 | 결제 대기 상태가 아닙니다 | 이미 결제/취소된 주문 |
| 6506 | 주문번호가 일치하지 않습니다 | orderId 불일치 |
| 6507 | 결제 금액이 일치하지 않습니다 | amount 불일치 (변조 감지) |
| 5001 | 결제 승인에 실패했습니다 | 토스 API 호출 실패 |

---

## 중요 사항

1. **토스 SDK 필수 호출**: 렌탈 주문 생성만으로는 결제가 완료되지 않습니다!
2. **수정 가능 기간**: 입주일 5일 전까지만 렌탈 추가/취소 가능
3. **금액 검증**: 서버에서 금액 변조 여부를 검증합니다
4. **환불 정책**: 결제 완료 후에도 수정 가능 기간 내 환불 가능

---

## 환경 변수 (프론트엔드)

```env
REACT_APP_TOSS_CLIENT_KEY=test_ck_xxx  # 테스트 클라이언트 키
# 프로덕션: live_ck_xxx
```
