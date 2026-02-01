# 렌탈 주문 시스템 설계 문서

## 1. 개요

### 1.1 배경
- **방 임대**: 호스트-게스트 간 직접 계약 (`Contract` 테이블)
- **렌탈 아이템**: 플랫폼에서 제공하는 서비스 (헤어드라이어, 침구, 어메니티 등)

현재 렌탈 아이템은 계약 생성 시점에만 선택 가능하며, 이후 추가/삭제가 불가능합니다.

### 1.2 요구사항
1. 계약 확정 후에도 렌탈 아이템 추가/삭제 가능
2. **입주일 5일 전까지** 수정 가능
3. 추가 시 별도 결제, 취소 시 환불 처리
4. 도메인 분리: 방 계약(호스트-게스트) vs 렌탈 서비스(플랫폼)
5. **모든 변경 이력 추적** (게스트/관리자 조회 가능)

---

## 2. 설계 결정

### 2.1 최종 결정: 완전 분리 + 이력 관리

| 구분 | 기존 | 변경 |
|------|------|------|
| 초기 렌탈 | Contract.rentalItems (JSON) | RentalOrder (INITIAL) |
| 추가 렌탈 | 없음 | RentalOrder (ADDITIONAL) |
| 이력 관리 | 없음 | RentalOrderLog |
| Contract | 렌탈 포함 | 렌탈 제외 (방 계약만) |

### 2.2 선택 이유

1. **도메인 분리**: 방 계약(호스트-게스트)과 플랫폼 서비스(렌탈) 명확히 구분
2. **이력 추적**: 모든 주문/결제/환불 이력을 타임라인으로 조회 가능
3. **독립 결제**: 렌탈 추가/환불을 계약과 무관하게 처리
4. **확장성**: 향후 다른 플랫폼 서비스 추가 용이

---

## 3. 아키텍처 개요

```
┌─────────────────────────────────────────────────────────────────┐
│                        Contract (방 임대)                        │
│  ├── 임대료, 관리비, 청소비, 수수료, 보증금                        │
│  ├── finalTotalAmount (렌탈 제외)                                │
│  └── rentalItems, rentalItemsFee → DEPRECATED                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ 1:N
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    RentalOrder (렌탈 주문)                        │
│  ├── orderType: 'INITIAL' | 'ADDITIONAL'                        │
│  ├── 결제/환불 상태 및 금액                                       │
│  └── modifiableUntil (입주 5일 전)                               │
└─────────────────────────────────────────────────────────────────┘
           │                                    │
           │ 1:N                                │ 1:N
           ▼                                    ▼
┌─────────────────────┐              ┌─────────────────────────────┐
│  RentalOrderItem    │              │     RentalOrderLog          │
│  ├── 아이템 상세     │              │  ├── 모든 변경 이력          │
│  └── 취소/환불 상태  │              │  └── 타임라인 조회용         │
└─────────────────────┘              └─────────────────────────────┘
           │
           │ 1:1
           ▼
┌─────────────────────┐
│RentalItemReservation│
│  └── 재고 관리       │
└─────────────────────┘
```

---

## 4. 데이터베이스 설계

### 4.1 RentalOrder (렌탈 주문)

```sql
CREATE TABLE rental_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  contract_id INT NOT NULL COMMENT '연결된 계약 ID',
  order_id VARCHAR(15) NOT NULL UNIQUE COMMENT '주문번호 (YYMMDD-R0001)',
  order_type ENUM('INITIAL', 'ADDITIONAL') NOT NULL COMMENT '주문 유형',

  -- 금액 정보
  subtotal INT NOT NULL DEFAULT 0 COMMENT '렌탈 아이템 합계',
  platform_fee INT NOT NULL DEFAULT 0 COMMENT '플랫폼 수수료 (9.9%)',
  total_amount INT NOT NULL DEFAULT 0 COMMENT '결제 예정 금액',

  -- 실제 결제/환불 금액
  paid_amount INT NOT NULL DEFAULT 0 COMMENT '실제 결제된 금액',
  refunded_amount INT NOT NULL DEFAULT 0 COMMENT '환불된 총 금액',

  -- 결제 상태
  status ENUM(
    'PENDING',           -- 결제 대기
    'PAID',              -- 결제 완료
    'PARTIAL_REFUND',    -- 부분 환불
    'FULLY_REFUNDED',    -- 전액 환불
    'CANCELLED'          -- 결제 전 취소
  ) NOT NULL DEFAULT 'PENDING' COMMENT '주문 상태',

  -- 결제 정보
  payment_key VARCHAR(100) NULL COMMENT '토스페이먼츠 결제키',
  payment_method VARCHAR(50) NULL COMMENT '결제 수단',
  paid_at DATETIME NULL COMMENT '결제 완료 시점',

  -- 수정 기한
  modifiable_until DATETIME NOT NULL COMMENT '수정 가능 기한 (체크인 5일 전)',

  -- 스냅샷 (분쟁 대비)
  items_snapshot JSON NULL COMMENT '주문 시점 아이템 정보',

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_rental_orders_contract FOREIGN KEY (contract_id)
    REFERENCES contracts(id) ON DELETE NO ACTION ON UPDATE CASCADE,

  INDEX idx_contract_id (contract_id),
  INDEX idx_order_type (order_type),
  INDEX idx_status (status),
  INDEX idx_modifiable_until (modifiable_until),
  INDEX idx_paid_at (paid_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='렌탈 아이템 주문 (플랫폼 서비스)';
```

### 4.2 RentalOrderItem (주문 상세)

```sql
CREATE TABLE rental_order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rental_order_id INT NOT NULL COMMENT '렌탈 주문 ID',
  rental_item_id INT NOT NULL COMMENT '렌탈 아이템 ID',

  -- 수량 및 가격
  quantity INT NOT NULL DEFAULT 1 COMMENT '수량',
  price_per_item DECIMAL(10,2) NOT NULL COMMENT '개당 가격 (주문 시점)',
  total_price DECIMAL(10,2) NOT NULL COMMENT '총 가격 (수량 * 개당가격)',

  -- 상태
  status ENUM('ACTIVE', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE' COMMENT '상태',
  cancelled_at DATETIME NULL COMMENT '취소 시점',
  refund_amount DECIMAL(10,2) NULL COMMENT '환불 금액',
  cancel_reason VARCHAR(255) NULL COMMENT '취소 사유',

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_order_items_order FOREIGN KEY (rental_order_id)
    REFERENCES rental_orders(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_order_items_item FOREIGN KEY (rental_item_id)
    REFERENCES rental_items(id) ON DELETE NO ACTION ON UPDATE CASCADE,

  INDEX idx_rental_order_id (rental_order_id),
  INDEX idx_rental_item_id (rental_item_id),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='렌탈 주문 상세 아이템';
```

### 4.3 RentalOrderLog (이력 관리)

```sql
CREATE TABLE rental_order_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  contract_id INT NOT NULL COMMENT '계약 ID (빠른 조회용)',
  rental_order_id INT NULL COMMENT '렌탈 주문 ID',
  rental_order_item_id INT NULL COMMENT '렌탈 주문 아이템 ID',

  -- 액션 정보
  action ENUM(
    'ORDER_CREATED',        -- 주문 생성
    'ITEM_ADDED',           -- 아이템 추가 (주문 내)
    'ITEM_CANCELLED',       -- 아이템 취소
    'PAYMENT_PENDING',      -- 결제 대기
    'PAYMENT_COMPLETED',    -- 결제 완료
    'PAYMENT_FAILED',       -- 결제 실패
    'REFUND_REQUESTED',     -- 환불 요청
    'REFUND_COMPLETED',     -- 환불 완료
    'REFUND_FAILED',        -- 환불 실패
    'ORDER_CANCELLED'       -- 주문 전체 취소
  ) NOT NULL COMMENT '액션 유형',

  -- 행위자 정보
  actor ENUM('GUEST', 'HOST', 'ADMIN', 'SYSTEM') NOT NULL COMMENT '행위자',
  actor_id INT NULL COMMENT '행위자 ID (User 또는 Admin)',

  -- 금액 변동
  amount_change INT DEFAULT 0 COMMENT '금액 변동 (+결제, -환불)',
  balance_after INT DEFAULT 0 COMMENT '변동 후 잔액 (순 결제액)',

  -- 상세 정보
  metadata JSON NULL COMMENT '상세 정보 (아이템명, 수량, 결제키 등)',
  description VARCHAR(500) NULL COMMENT '설명 (관리자용)',

  -- 추적 정보
  ip_address VARCHAR(45) NULL,
  user_agent VARCHAR(500) NULL,

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_logs_contract FOREIGN KEY (contract_id)
    REFERENCES contracts(id) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT fk_logs_order FOREIGN KEY (rental_order_id)
    REFERENCES rental_orders(id) ON DELETE SET NULL ON UPDATE CASCADE,

  INDEX idx_contract_id (contract_id),
  INDEX idx_rental_order_id (rental_order_id),
  INDEX idx_action (action),
  INDEX idx_actor (actor),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='렌탈 주문 변경 이력';
```

### 4.4 RentalItemReservation 수정

```sql
-- 기존 테이블에 컬럼 추가
ALTER TABLE rental_item_reservations
  ADD COLUMN rental_order_id INT NULL COMMENT '렌탈 주문 ID' AFTER contract_id,
  ADD COLUMN rental_order_item_id INT NULL COMMENT '렌탈 주문 아이템 ID' AFTER rental_order_id,
  ADD CONSTRAINT fk_reservation_rental_order
    FOREIGN KEY (rental_order_id) REFERENCES rental_orders(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD INDEX idx_rental_order_id (rental_order_id);
```

### 4.5 Contract 테이블 변경 (향후)

```sql
-- Phase 2에서 적용 (데이터 마이그레이션 후)
-- 기존 필드는 유지하되 DEPRECATED 처리
-- rentalItems, rentalItemsFee 필드는 조회용으로만 유지
```

---

## 5. API 설계

### 5.1 게스트용 API

#### 렌탈 주문 목록 조회
```
GET /api/contracts/:contractId/rental-orders

Response:
{
  "success": true,
  "data": {
    "modifiable": true,
    "modifiableUntil": "2025-02-10T23:59:59Z",
    "daysRemaining": 5,

    "summary": {
      "totalPaid": 60000,
      "totalRefunded": 25000,
      "netAmount": 35000,
      "activeItemsCount": 3
    },

    "orders": [
      {
        "id": 1,
        "orderId": "250201-R0001",
        "orderType": "INITIAL",
        "status": "PARTIAL_REFUND",
        "totalAmount": 45000,
        "paidAmount": 45000,
        "refundedAmount": 25000,
        "paidAt": "2025-02-01T10:05:00Z",
        "items": [
          {
            "id": 1,
            "name": "헤어드라이어",
            "quantity": 2,
            "pricePerItem": 10000,
            "totalPrice": 20000,
            "status": "ACTIVE"
          },
          {
            "id": 2,
            "name": "침구세트",
            "quantity": 1,
            "pricePerItem": 25000,
            "totalPrice": 25000,
            "status": "CANCELLED",
            "cancelledAt": "2025-02-03T14:00:00Z",
            "refundAmount": 25000
          }
        ]
      },
      {
        "id": 2,
        "orderId": "250205-R0001",
        "orderType": "ADDITIONAL",
        "status": "PAID",
        "totalAmount": 15000,
        "paidAmount": 15000,
        "refundedAmount": 0,
        "paidAt": "2025-02-05T09:05:00Z",
        "items": [
          {
            "id": 3,
            "name": "어메니티 키트",
            "quantity": 1,
            "pricePerItem": 15000,
            "totalPrice": 15000,
            "status": "ACTIVE"
          }
        ]
      }
    ]
  }
}
```

#### 렌탈 수정 가능 여부 확인
```
GET /api/contracts/:contractId/rental-modifiable

Response:
{
  "success": true,
  "data": {
    "modifiable": true,
    "modifiableUntil": "2025-02-10T23:59:59Z",
    "daysRemaining": 5,
    "checkInDate": "2025-02-15T15:00:00Z",
    "contractStatus": "PAYMENT_COMPLETED"
  }
}
```

#### 추가 렌탈 주문 생성
```
POST /api/contracts/:contractId/rental-orders

Body:
{
  "items": [
    { "itemId": 1, "quantity": 2 },
    { "itemId": 3, "quantity": 1 }
  ]
}

Response:
{
  "success": true,
  "data": {
    "rentalOrderId": 123,
    "orderId": "250201-R0002",
    "orderType": "ADDITIONAL",
    "subtotal": 40909,
    "platformFee": 4091,
    "totalAmount": 45000,
    "status": "PENDING",
    "modifiableUntil": "2025-02-10T23:59:59Z",
    "items": [...]
  },
  "message": "렌탈 주문이 생성되었습니다. 결제를 진행해주세요."
}
```

#### 추가 결제 정보 조회
```
GET /api/rental-orders/:rentalOrderId/payment-info

Response:
{
  "success": true,
  "data": {
    "rentalOrderId": 123,
    "orderId": "250201-R0002",
    "amount": 45000,
    "orderName": "렌탈 아이템 추가 (헤어드라이어 외 1건)",
    "customerEmail": "guest@example.com",
    "customerName": "홍길동"
  }
}
```

#### 추가 결제 승인
```
POST /api/rental-orders/:rentalOrderId/confirm-payment

Body:
{
  "paymentKey": "tvivaTV20240201...",
  "orderId": "250201-R0002",
  "amount": 45000
}

Response:
{
  "success": true,
  "data": {
    "rentalOrderId": 123,
    "status": "PAID",
    "paidAmount": 45000,
    "paidAt": "2025-02-01T10:30:00Z",
    "paymentKey": "tvivaTV20240201..."
  },
  "message": "결제가 완료되었습니다."
}
```

#### 렌탈 아이템 취소 (환불)
```
POST /api/rental-orders/:rentalOrderId/items/:itemId/cancel

Body:
{
  "reason": "필요 없어졌습니다"  // 선택
}

Response:
{
  "success": true,
  "data": {
    "itemId": 2,
    "itemName": "침구세트",
    "refundAmount": 25000,
    "refundStatus": "COMPLETED",  // 또는 "PROCESSING"
    "cancelledAt": "2025-02-03T14:00:00Z",
    "orderStatus": "PARTIAL_REFUND"
  },
  "message": "아이템이 취소되었습니다. 환불이 처리됩니다."
}
```

#### 미결제 주문 취소
```
DELETE /api/rental-orders/:rentalOrderId

Response:
{
  "success": true,
  "message": "주문이 취소되었습니다."
}
```

### 5.2 관리자용 API

#### 계약별 렌탈 이력 조회 (타임라인)
```
GET /api/admin/contracts/:contractId/rental-logs

Query:
  - page, limit (페이지네이션)
  - action (필터: ORDER_CREATED, PAYMENT_COMPLETED 등)
  - startDate, endDate (기간 필터)

Response:
{
  "success": true,
  "data": {
    "contract": {
      "id": 123,
      "orderId": "250201-00001",
      "guestName": "홍길동",
      "guestPhone": "010-1234-5678",
      "checkInDate": "2025-02-15T15:00:00Z",
      "checkOutDate": "2025-03-15T11:00:00Z"
    },

    "summary": {
      "totalPaid": 60000,
      "totalRefunded": 25000,
      "netAmount": 35000,
      "orderCount": 2,
      "activeItemsCount": 3
    },

    "timeline": [
      {
        "id": 5,
        "timestamp": "2025-02-05T09:05:00Z",
        "action": "PAYMENT_COMPLETED",
        "actionLabel": "결제 완료",
        "actor": "GUEST",
        "actorName": "홍길동",
        "orderId": "250205-R0001",
        "amountChange": 15000,
        "balanceAfter": 35000,
        "metadata": {
          "paymentKey": "tvivaTV...",
          "paymentMethod": "CARD"
        }
      },
      {
        "id": 4,
        "timestamp": "2025-02-05T09:00:00Z",
        "action": "ORDER_CREATED",
        "actionLabel": "추가 주문 생성",
        "actor": "GUEST",
        "actorName": "홍길동",
        "orderId": "250205-R0001",
        "amountChange": 0,
        "metadata": {
          "orderType": "ADDITIONAL",
          "items": [
            { "name": "어메니티 키트", "quantity": 1, "price": 15000 }
          ]
        }
      },
      {
        "id": 3,
        "timestamp": "2025-02-03T14:00:00Z",
        "action": "ITEM_CANCELLED",
        "actionLabel": "아이템 취소",
        "actor": "GUEST",
        "actorName": "홍길동",
        "orderId": "250201-R0001",
        "amountChange": -25000,
        "balanceAfter": 20000,
        "metadata": {
          "itemName": "침구세트",
          "quantity": 1,
          "refundAmount": 25000
        }
      },
      {
        "id": 2,
        "timestamp": "2025-02-01T10:05:00Z",
        "action": "PAYMENT_COMPLETED",
        "actionLabel": "결제 완료",
        "actor": "GUEST",
        "actorName": "홍길동",
        "orderId": "250201-R0001",
        "amountChange": 45000,
        "balanceAfter": 45000,
        "metadata": {
          "paymentKey": "tvivaTV...",
          "paymentMethod": "CARD"
        }
      },
      {
        "id": 1,
        "timestamp": "2025-02-01T10:00:00Z",
        "action": "ORDER_CREATED",
        "actionLabel": "초기 주문 생성",
        "actor": "GUEST",
        "actorName": "홍길동",
        "orderId": "250201-R0001",
        "amountChange": 0,
        "metadata": {
          "orderType": "INITIAL",
          "items": [
            { "name": "헤어드라이어", "quantity": 2, "price": 20000 },
            { "name": "침구세트", "quantity": 1, "price": 25000 }
          ]
        }
      }
    ],

    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 5,
      "totalPages": 1
    }
  }
}
```

#### 관리자 렌탈 아이템 강제 취소
```
POST /api/admin/rental-orders/:rentalOrderId/items/:itemId/cancel

Body:
{
  "reason": "고객 요청 (전화)",
  "refundAmount": 25000  // 선택: 기본값은 전액
}

Response:
{
  "success": true,
  "data": { ... },
  "message": "관리자에 의해 아이템이 취소되었습니다."
}
```

### 5.3 라우트 구조

```javascript
// routes/rentalOrderRoutes.js (게스트용)
router.get('/contracts/:contractId/rental-orders', authenticateToken, getRentalOrders);
router.get('/contracts/:contractId/rental-modifiable', authenticateToken, checkModifiable);
router.post('/contracts/:contractId/rental-orders', authenticateToken, createRentalOrder);

router.get('/rental-orders/:rentalOrderId/payment-info', authenticateToken, getPaymentInfo);
router.post('/rental-orders/:rentalOrderId/confirm-payment', authenticateToken, confirmPayment);
router.delete('/rental-orders/:rentalOrderId', authenticateToken, cancelOrder);
router.post('/rental-orders/:rentalOrderId/items/:itemId/cancel', authenticateToken, cancelItem);

// routes/adminRoutes.js (관리자용)
router.get('/contracts/:contractId/rental-logs', authenticateAdmin, getRentalLogs);
router.post('/rental-orders/:rentalOrderId/items/:itemId/cancel', authenticateAdmin, adminCancelItem);
```

---

## 6. 비즈니스 로직

### 6.1 수정 가능 기간 체크

```javascript
const RENTAL_MODIFIABLE_DAYS_BEFORE = 5; // 입주 5일 전까지

function checkRentalModifiable(contract) {
  const now = new Date();
  const checkInDate = new Date(contract.checkInDate);

  // 입주일 5일 전 23:59:59까지 수정 가능
  const modifiableUntil = new Date(checkInDate);
  modifiableUntil.setDate(modifiableUntil.getDate() - RENTAL_MODIFIABLE_DAYS_BEFORE);
  modifiableUntil.setHours(23, 59, 59, 999);

  const modifiable = now <= modifiableUntil;
  const daysRemaining = Math.max(0, Math.ceil((modifiableUntil - now) / (1000 * 60 * 60 * 24)));

  return {
    modifiable,
    modifiableUntil,
    daysRemaining,
    checkInDate
  };
}
```

### 6.2 허용 상태 정의

```javascript
// 렌탈 추가/수정이 가능한 계약 상태
const RENTAL_MODIFIABLE_STATUSES = [
  'APPROVED',           // 승인됨 (첫 결제 전)
  'PAYMENT_COMPLETED',  // 결제 완료
  'IN_PROGRESS'         // 입주 중
];

// 렌탈 환불이 가능한 상태
const RENTAL_REFUNDABLE_STATUSES = [
  'PAYMENT_COMPLETED',
  'IN_PROGRESS'
];
```

### 6.3 주문번호 생성

```javascript
/**
 * 렌탈 주문번호 생성
 * 형식: YYMMDD-R0001
 */
async function generateRentalOrderId(transaction) {
  const today = new Date();
  const datePrefix = today.toISOString().slice(2, 10).replace(/-/g, '');

  const count = await RentalOrder.count({
    where: {
      orderId: { [Op.like]: `${datePrefix}-R%` }
    },
    transaction
  });

  const sequence = String(count + 1).padStart(4, '0');
  return `${datePrefix}-R${sequence}`;
}
```

### 6.4 플랫폼 수수료

```javascript
const RENTAL_PLATFORM_FEE_RATE = 0.099; // 9.9%

function calculateRentalFees(subtotal) {
  const platformFee = Math.floor(subtotal * RENTAL_PLATFORM_FEE_RATE);
  const totalAmount = subtotal + platformFee;
  return { subtotal, platformFee, totalAmount };
}
```

### 6.5 이력 로깅

```javascript
async function logRentalAction({
  contractId,
  rentalOrderId,
  rentalOrderItemId,
  action,
  actor,
  actorId,
  amountChange,
  balanceAfter,
  metadata,
  description,
  req,
  transaction
}) {
  return await RentalOrderLog.create({
    contractId,
    rentalOrderId,
    rentalOrderItemId,
    action,
    actor,
    actorId,
    amountChange: amountChange || 0,
    balanceAfter: balanceAfter || 0,
    metadata: metadata || null,
    description,
    ipAddress: req?.ip || req?.connection?.remoteAddress,
    userAgent: req?.headers?.['user-agent']?.substring(0, 500)
  }, { transaction });
}
```

---

## 7. 시나리오별 플로우

### 7.1 첫 결제 (계약 + 초기 렌탈)

```
[게스트] 계약 요청 + 렌탈 아이템 선택
    │
    ▼
[서버] Contract 생성 (렌탈 제외 금액)
    │
    ▼
[서버] RentalOrder(INITIAL) 생성, status: PENDING
    │   └── RentalOrderItem 생성
    │   └── Log: ORDER_CREATED
    │
    ▼
[호스트] 승인
    │
    ▼
[게스트] 결제 (Contract + RentalOrder 합산)
    │
    ▼
[서버] 토스페이먼츠 결제 승인
    │
    ▼
[서버] Contract 결제 처리 + RentalOrder.status = PAID
    │   └── RentalItemReservation.status = CONFIRMED
    │   └── Log: PAYMENT_COMPLETED, amountChange: +45000
    │
    ▼
[완료]
```

### 7.2 추가 렌탈 주문

```
[게스트] 추가 렌탈 아이템 선택
    │
    ▼
[서버] 수정 가능 기간 체크 (입주 5일 전)
    │   └── 불가 시: 에러 반환
    │
    ▼
[서버] 재고 확인
    │
    ▼
[서버] RentalOrder(ADDITIONAL) 생성, status: PENDING
    │   └── RentalOrderItem 생성
    │   └── RentalItemReservation(RESERVED) 생성
    │   └── Log: ORDER_CREATED
    │
    ▼
[게스트] 추가 결제 (토스페이먼츠)
    │
    ▼
[서버] 결제 승인 처리
    │   └── RentalOrder.status = PAID
    │   └── RentalItemReservation.status = CONFIRMED
    │   └── Log: PAYMENT_COMPLETED, amountChange: +15000
    │
    ▼
[완료]
```

### 7.3 아이템 취소 (환불)

```
[게스트] 아이템 취소 요청
    │
    ▼
[서버] 수정 가능 기간 체크 (입주 5일 전)
    │   └── 불가 시: 에러 반환
    │
    ▼
[서버] 환불 금액 계산 (100% 환불)
    │
    ▼
[서버] 토스페이먼츠 부분 환불 API 호출
    │
    ▼
[서버] 데이터 업데이트
    │   └── RentalOrderItem.status = CANCELLED
    │   └── RentalOrderItem.refundAmount = 25000
    │   └── RentalOrder.refundedAmount += 25000
    │   └── RentalOrder.status = PARTIAL_REFUND (또는 FULLY_REFUNDED)
    │   └── RentalItemReservation.status = CANCELLED
    │   └── Log: ITEM_CANCELLED, amountChange: -25000
    │
    ▼
[완료] 재고 자동 복구
```

### 7.4 미결제 주문 취소

```
[게스트] 미결제 주문 취소 요청
    │
    ▼
[서버] 주문 상태 확인 (PENDING만 가능)
    │
    ▼
[서버] 데이터 업데이트
    │   └── RentalOrder.status = CANCELLED
    │   └── RentalOrderItem.status = CANCELLED
    │   └── RentalItemReservation.status = CANCELLED
    │   └── Log: ORDER_CANCELLED
    │
    ▼
[완료] 재고 자동 복구
```

---

## 8. 에러 코드

| 코드 | 메시지 | 설명 |
|------|--------|------|
| 4601 | 입주 5일 전까지만 렌탈 변경이 가능합니다 | 수정 기한 초과 |
| 4602 | 렌탈 주문을 찾을 수 없습니다 | 잘못된 주문 ID |
| 4603 | 결제 대기 상태의 주문만 결제할 수 있습니다 | 잘못된 결제 시도 |
| 4604 | 이미 취소된 아이템입니다 | 중복 취소 |
| 4605 | 현재 계약 상태에서는 렌탈 변경이 불가합니다 | 허용되지 않는 상태 |
| 4606 | 렌탈 아이템 재고가 부족합니다 | 재고 부족 |
| 4607 | 결제된 주문만 취소할 수 있습니다 | 환불 불가 상태 |
| 4608 | 렌탈 아이템을 찾을 수 없습니다 | 잘못된 아이템 |
| 4609 | 결제 금액이 일치하지 않습니다 | 금액 불일치 |
| 4610 | 미결제 주문만 삭제할 수 있습니다 | 삭제 불가 |

---

## 9. 마이그레이션 계획

### Phase 1: 신규 테이블 생성 및 API 추가

1. **테이블 생성**
   - `rental_orders` 테이블 생성
   - `rental_order_items` 테이블 생성
   - `rental_order_logs` 테이블 생성
   - `rental_item_reservations`에 `rental_order_id` 컬럼 추가

2. **모델 생성**
   - `RentalOrder.js`
   - `RentalOrderItem.js`
   - `RentalOrderLog.js`
   - `models/index.js` 관계 설정

3. **컨트롤러/라우트**
   - `rentalOrderController.js`
   - `rentalOrderRoutes.js`
   - 관리자 API 추가

4. **기존 로직 수정**
   - `contractController.createContractRequest`: RentalOrder(INITIAL) 생성 추가
   - `contractController.confirmPayment`: RentalOrder 결제 처리 추가

### Phase 2: 데이터 마이그레이션 (선택)

1. 기존 `Contract.rentalItems` 데이터를 `RentalOrder(INITIAL)`로 마이그레이션
2. `Contract.rentalItemsFee` → `RentalOrder.paidAmount`
3. 기존 `RentalItemReservation`에 `rental_order_id` 연결

### Phase 3: Contract 필드 정리 (선택)

1. `Contract.rentalItems` 필드 deprecated 처리
2. `Contract.rentalItemsFee` 필드 deprecated 처리
3. 조회 API에서 RentalOrder로 통합 조회

---

## 10. 변경 이력

| 버전 | 날짜 | 작성자 | 내용 |
|------|------|--------|------|
| 1.0 | 2025-02-01 | Claude | 초안 작성 (하이브리드 방식) |
| 2.0 | 2025-02-01 | Claude | 완전 분리 + 이력 관리 추가 |
