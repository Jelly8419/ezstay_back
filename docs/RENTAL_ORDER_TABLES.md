# 렌탈 주문 시스템 테이블 구조

## 개요
렌탈 주문 시스템은 계약(Contract)과 분리된 독립적인 렌탈 아이템 주문 관리 시스템입니다.
- 플랫폼이 직접 제공하는 서비스로 **수수료 없음**
- 체크인 5일 전까지 추가/취소 가능
- 모든 변경 이력 추적

---

## 1. rental_orders (렌탈 주문)

렌탈 아이템 주문의 메인 테이블입니다.

| 컬럼명 | 타입 | NULL | 기본값 | 설명 |
|--------|------|------|--------|------|
| `id` | INT | NO | AUTO_INCREMENT | 기본키 |
| `contract_id` | INT | NO | - | 연결된 계약 ID (FK → contracts.id) |
| `order_id` | VARCHAR(15) | NO | - | 주문번호 (YYMMDD-R0001 형식), UNIQUE |
| `order_type` | ENUM | NO | - | 주문 유형: `INITIAL`(초기), `ADDITIONAL`(추가) |
| `total_amount` | INT | NO | 0 | 결제 예정 금액 (아이템 합계, 수수료 없음) |
| `paid_amount` | INT | NO | 0 | 실제 결제된 금액 |
| `refunded_amount` | INT | NO | 0 | 환불된 총 금액 |
| `status` | ENUM | NO | 'PENDING' | 주문 상태 (아래 참조) |
| `payment_key` | VARCHAR(100) | YES | NULL | 토스페이먼츠 결제키 |
| `payment_method` | VARCHAR(50) | YES | NULL | 결제 수단 (카드, 계좌이체 등) |
| `paid_at` | DATETIME | YES | NULL | 결제 완료 시점 |
| `modifiable_until` | DATETIME | NO | - | 수정 가능 기한 (체크인 5일 전 23:59:59) |
| `items_snapshot` | JSON | YES | NULL | 주문 시점 아이템 정보 스냅샷 (분쟁 대비) |
| `created_at` | DATETIME | NO | CURRENT_TIMESTAMP | 생성일시 |
| `updated_at` | DATETIME | NO | CURRENT_TIMESTAMP | 수정일시 |

### 주문 상태 (status)
| 값 | 설명 |
|----|------|
| `PENDING` | 결제 대기 |
| `PAID` | 결제 완료 |
| `PARTIAL_REFUND` | 부분 환불 |
| `FULLY_REFUNDED` | 전액 환불 |
| `CANCELLED` | 결제 전 취소 |

### 주문 유형 (order_type)
| 값 | 설명 |
|----|------|
| `INITIAL` | 초기 주문 - 계약 시 선택한 렌탈 아이템 |
| `ADDITIONAL` | 추가 주문 - 계약 후 추가로 주문한 렌탈 아이템 |

### 인덱스
- `idx_rental_orders_contract_id` - contract_id
- `idx_rental_orders_order_type` - order_type
- `idx_rental_orders_status` - status
- `idx_rental_orders_modifiable_until` - modifiable_until
- `idx_rental_orders_paid_at` - paid_at

---

## 2. rental_order_items (렌탈 주문 아이템)

주문에 포함된 개별 렌탈 아이템 정보입니다.

| 컬럼명 | 타입 | NULL | 기본값 | 설명 |
|--------|------|------|--------|------|
| `id` | INT | NO | AUTO_INCREMENT | 기본키 |
| `rental_order_id` | INT | NO | - | 렌탈 주문 ID (FK → rental_orders.id, CASCADE) |
| `rental_item_id` | INT | NO | - | 렌탈 아이템 ID (FK → rental_items.id) |
| `quantity` | INT | NO | 1 | 수량 |
| `price_per_item` | DECIMAL(10,2) | NO | - | 개당 가격 (주문 시점 가격 고정) |
| `total_price` | DECIMAL(10,2) | NO | - | 총 가격 (수량 × 개당가격) |
| `status` | ENUM | NO | 'ACTIVE' | 상태: `ACTIVE`, `CANCELLED` |
| `cancelled_at` | DATETIME | YES | NULL | 취소 시점 |
| `refund_amount` | DECIMAL(10,2) | YES | NULL | 환불 금액 |
| `cancel_reason` | VARCHAR(255) | YES | NULL | 취소 사유 |
| `created_at` | DATETIME | NO | CURRENT_TIMESTAMP | 생성일시 |
| `updated_at` | DATETIME | NO | CURRENT_TIMESTAMP | 수정일시 |

### 아이템 상태 (status)
| 값 | 설명 |
|----|------|
| `ACTIVE` | 활성 (정상 주문 상태) |
| `CANCELLED` | 취소됨 |

### 인덱스
- `idx_rental_order_items_order_id` - rental_order_id
- `idx_rental_order_items_item_id` - rental_item_id
- `idx_rental_order_items_status` - status

### 외래키
- `rental_order_id` → `rental_orders.id` (ON DELETE CASCADE)
- `rental_item_id` → `rental_items.id` (ON DELETE NO ACTION)

---

## 3. rental_order_logs (렌탈 주문 로그)

모든 렌탈 주문 관련 변경 이력을 추적합니다.

| 컬럼명 | 타입 | NULL | 기본값 | 설명 |
|--------|------|------|--------|------|
| `id` | INT | NO | AUTO_INCREMENT | 기본키 |
| `contract_id` | INT | NO | - | 계약 ID (빠른 조회용, FK → contracts.id) |
| `rental_order_id` | INT | YES | NULL | 렌탈 주문 ID (FK → rental_orders.id) |
| `rental_order_item_id` | INT | YES | NULL | 렌탈 주문 아이템 ID |
| `action` | ENUM | NO | - | 액션 유형 (아래 참조) |
| `actor` | ENUM | NO | - | 행위자: `GUEST`, `HOST`, `ADMIN`, `SYSTEM` |
| `actor_id` | INT | YES | NULL | 행위자 ID (User 또는 Admin) |
| `amount_change` | INT | NO | 0 | 금액 변동 (+결제, -환불) |
| `balance_after` | INT | NO | 0 | 변동 후 잔액 (순 결제액) |
| `metadata` | JSON | YES | NULL | 상세 정보 (아이템명, 수량, 결제키 등) |
| `description` | VARCHAR(500) | YES | NULL | 설명 (관리자용) |
| `ip_address` | VARCHAR(45) | YES | NULL | 요청 IP 주소 |
| `user_agent` | VARCHAR(500) | YES | NULL | 요청 User-Agent |
| `created_at` | DATETIME | NO | CURRENT_TIMESTAMP | 생성일시 |

### 액션 유형 (action)
| 값 | 설명 |
|----|------|
| `ORDER_CREATED` | 주문 생성 |
| `ITEM_ADDED` | 아이템 추가 (주문 내) |
| `ITEM_CANCELLED` | 아이템 취소 |
| `PAYMENT_PENDING` | 결제 대기 |
| `PAYMENT_COMPLETED` | 결제 완료 |
| `PAYMENT_FAILED` | 결제 실패 |
| `REFUND_REQUESTED` | 환불 요청 |
| `REFUND_COMPLETED` | 환불 완료 |
| `REFUND_FAILED` | 환불 실패 |
| `ORDER_CANCELLED` | 주문 전체 취소 |

### 행위자 (actor)
| 값 | 설명 |
|----|------|
| `GUEST` | 게스트 (임차인) |
| `HOST` | 호스트 (임대인) |
| `ADMIN` | 관리자 |
| `SYSTEM` | 시스템 자동 처리 |

### 인덱스
- `idx_rental_order_logs_contract_id` - contract_id
- `idx_rental_order_logs_order_id` - rental_order_id
- `idx_rental_order_logs_action` - action
- `idx_rental_order_logs_actor` - actor
- `idx_rental_order_logs_created_at` - created_at

---

## 4. rental_item_reservations 추가 컬럼

기존 테이블에 추가된 컬럼입니다.

| 컬럼명 | 타입 | NULL | 기본값 | 설명 |
|--------|------|------|--------|------|
| `rental_order_id` | INT | YES | NULL | 렌탈 주문 ID (FK → rental_orders.id) |
| `rental_order_item_id` | INT | YES | NULL | 렌탈 주문 아이템 ID |

---

## 테이블 관계도

```
contracts (계약)
    │
    ├── 1:N ── rental_orders (렌탈 주문)
    │              │
    │              ├── 1:N ── rental_order_items (주문 아이템)
    │              │              │
    │              │              └── N:1 ── rental_items (렌탈 상품 마스터)
    │              │
    │              └── 1:N ── rental_order_logs (변경 이력)
    │
    └── 1:N ── rental_item_reservations (재고 예약)
                   │
                   ├── N:1 ── rental_orders (주문 연결)
                   └── N:1 ── rental_items (아이템 연결)
```

---

## 주문번호 형식

| 형식 | 예시 | 설명 |
|------|------|------|
| `YYMMDD-R0001` | 250201-R0001 | 일반 주문 (R = Rental) |
| `YYMMDD-M0001` | 250201-M0001 | 마이그레이션 데이터 (M = Migration) |

- 날짜별로 순번 초기화
- 동일 날짜 내 순차 증가 (0001, 0002, ...)

---

## 금액 계산

```
totalAmount = Σ(아이템 가격 × 수량)  // 수수료 없음
paidAmount = 실제 결제된 금액
refundedAmount = 환불된 금액
netAmount = paidAmount - refundedAmount  // 순 결제액
```

**중요**: 렌탈 아이템은 플랫폼 직접 제공 서비스로 **수수료가 없습니다**.
(방 계약이나 호스트 직접 청소에만 수수료 적용)

---

## 마이그레이션 데이터

기존 `contracts.rental_items` JSON 데이터가 새 시스템으로 마이그레이션된 경우:
- `order_id`가 `-M`으로 끝남 (예: `250201-M0023`)
- `rental_order_logs.description`에 "마이그레이션" 포함
- `rental_order_logs.metadata.migration = true`
