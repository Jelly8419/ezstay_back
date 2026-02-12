# 렌탈 주문 시스템 구현 계획

## 개요

이 문서는 [RENTAL_ORDER_DESIGN.md](./RENTAL_ORDER_DESIGN.md)의 설계를 바탕으로 한 구현 계획입니다.

---

## 구현 Phase 개요

| Phase | 내용 | 의존성 |
|-------|------|--------|
| **Phase 1** | DB 테이블 및 모델 생성 | 없음 |
| **Phase 2** | 게스트 API 구현 | Phase 1 |
| **Phase 3** | 기존 계약 로직 수정 | Phase 1, 2 |
| **Phase 4** | 관리자 API 구현 | Phase 1, 2 |
| **Phase 5** | 테스트 및 검증 | Phase 1-4 |
| **Phase 6** | 데이터 마이그레이션 (선택) | Phase 1-5 |

---

## Phase 1: DB 테이블 및 모델 생성

### 1.1 마이그레이션 SQL 파일 생성

**파일**: `scripts/migration_rental_order_system.sql`

```sql
-- 1. rental_orders 테이블 생성
-- 2. rental_order_items 테이블 생성
-- 3. rental_order_logs 테이블 생성
-- 4. rental_item_reservations 컬럼 추가
```

### 1.2 Sequelize 모델 생성

| 파일 | 설명 |
|------|------|
| `models/RentalOrder.js` | 렌탈 주문 모델 |
| `models/RentalOrderItem.js` | 렌탈 주문 아이템 모델 |
| `models/RentalOrderLog.js` | 렌탈 주문 이력 모델 |

### 1.3 모델 관계 설정

**파일**: `models/index.js`

```javascript
// Contract ↔ RentalOrder
Contract.hasMany(RentalOrder, { foreignKey: 'contractId', as: 'rentalOrders' });
RentalOrder.belongsTo(Contract, { foreignKey: 'contractId', as: 'contract' });

// RentalOrder ↔ RentalOrderItem
RentalOrder.hasMany(RentalOrderItem, { foreignKey: 'rentalOrderId', as: 'items' });
RentalOrderItem.belongsTo(RentalOrder, { foreignKey: 'rentalOrderId', as: 'order' });

// RentalOrderItem ↔ RentalItem
RentalOrderItem.belongsTo(RentalItem, { foreignKey: 'rentalItemId', as: 'rentalItem' });

// RentalOrder ↔ RentalOrderLog
RentalOrder.hasMany(RentalOrderLog, { foreignKey: 'rentalOrderId', as: 'logs' });
RentalOrderLog.belongsTo(RentalOrder, { foreignKey: 'rentalOrderId', as: 'order' });

// Contract ↔ RentalOrderLog (빠른 조회용)
Contract.hasMany(RentalOrderLog, { foreignKey: 'contractId', as: 'rentalLogs' });

// RentalItemReservation ↔ RentalOrder
RentalItemReservation.belongsTo(RentalOrder, { foreignKey: 'rentalOrderId', as: 'rentalOrder' });
RentalOrder.hasMany(RentalItemReservation, { foreignKey: 'rentalOrderId', as: 'reservations' });
```

### 1.4 체크리스트

- [ ] `scripts/migration_rental_order_system.sql` 작성
- [ ] `models/RentalOrder.js` 생성
- [ ] `models/RentalOrderItem.js` 생성
- [ ] `models/RentalOrderLog.js` 생성
- [ ] `models/RentalItemReservation.js` 수정 (rental_order_id 추가)
- [ ] `models/index.js` 관계 설정 추가
- [ ] DB 마이그레이션 실행 및 테스트

---

## Phase 2: 게스트 API 구현

### 2.1 유틸리티 함수

**파일**: `utils/rentalOrderHelper.js`

| 함수 | 설명 |
|------|------|
| `checkRentalModifiable(contract)` | 수정 가능 기간 체크 |
| `generateRentalOrderId(transaction)` | 주문번호 생성 |
| `calculateRentalFees(subtotal)` | 수수료 계산 |
| `logRentalAction(params)` | 이력 로깅 |
| `getContractRentalSummary(contractId)` | 렌탈 요약 정보 조회 |

### 2.2 컨트롤러

**파일**: `controllers/rentalOrderController.js`

| 함수 | 엔드포인트 | 설명 |
|------|-----------|------|
| `getRentalOrders` | GET /contracts/:id/rental-orders | 렌탈 주문 목록 |
| `checkModifiable` | GET /contracts/:id/rental-modifiable | 수정 가능 여부 |
| `createRentalOrder` | POST /contracts/:id/rental-orders | 추가 주문 생성 |
| `getRentalOrderPaymentInfo` | GET /rental-orders/:id/payment-info | 결제 정보 |
| `confirmRentalOrderPayment` | POST /rental-orders/:id/confirm-payment | 결제 승인 |
| `cancelRentalOrder` | DELETE /rental-orders/:id | 미결제 주문 취소 |
| `cancelRentalOrderItem` | POST /rental-orders/:id/items/:itemId/cancel | 아이템 환불 |

### 2.3 라우트

**파일**: `routes/rentalOrderRoutes.js`

```javascript
const router = express.Router();

// 계약 기반 라우트
router.get('/contracts/:contractId/rental-orders', authenticateToken, getRentalOrders);
router.get('/contracts/:contractId/rental-modifiable', authenticateToken, checkModifiable);
router.post('/contracts/:contractId/rental-orders', authenticateToken, createRentalOrder);

// 렌탈 주문 기반 라우트
router.get('/rental-orders/:rentalOrderId/payment-info', authenticateToken, getRentalOrderPaymentInfo);
router.post('/rental-orders/:rentalOrderId/confirm-payment', authenticateToken, confirmRentalOrderPayment);
router.delete('/rental-orders/:rentalOrderId', authenticateToken, cancelRentalOrder);
router.post('/rental-orders/:rentalOrderId/items/:itemId/cancel', authenticateToken, cancelRentalOrderItem);

module.exports = router;
```

### 2.4 server.js 등록

```javascript
const rentalOrderRoutes = require('./routes/rentalOrderRoutes');
app.use('/api', rentalOrderRoutes);
```

### 2.5 에러 코드 추가

**파일**: `utils/responseHelper.js`

```javascript
// 렌탈 주문 관련 에러 코드 (46xx)
RENTAL_MODIFICATION_EXPIRED: { code: 4601, message: '입주 5일 전까지만 렌탈 변경이 가능합니다' },
RENTAL_ORDER_NOT_FOUND: { code: 4602, message: '렌탈 주문을 찾을 수 없습니다' },
// ...
```

### 2.6 체크리스트

- [ ] `utils/rentalOrderHelper.js` 생성
- [ ] `controllers/rentalOrderController.js` 생성
- [ ] `routes/rentalOrderRoutes.js` 생성
- [ ] `server.js`에 라우트 등록
- [ ] `utils/responseHelper.js`에 에러 코드 추가
- [ ] 각 API 단위 테스트

---

## Phase 3: 기존 계약 로직 수정

### 3.1 계약 생성 시 RentalOrder(INITIAL) 생성

**파일**: `controllers/contractController.js`

**수정 함수**: `createContractRequest`

```javascript
// 기존: Contract에 rentalItems, rentalItemsFee 저장
// 변경: Contract 생성 + RentalOrder(INITIAL) 생성

// 1. Contract 생성 (렌탈 제외)
const contract = await Contract.create({
  // ... (rentalItemsFee 제외 또는 0으로 설정)
}, { transaction });

// 2. 렌탈 아이템이 있으면 RentalOrder 생성
if (rentalItems && rentalItems.length > 0) {
  const rentalOrder = await createInitialRentalOrder(
    contract.id,
    rentalItems,
    checkInDate,
    checkOutDate,
    transaction
  );
}
```

### 3.2 결제 시 RentalOrder 함께 처리

**파일**: `controllers/contractController.js`

**수정 함수**: `confirmPayment`

```javascript
// 기존: Contract만 결제 처리
// 변경: Contract + RentalOrder(INITIAL) 함께 처리

// 1. Contract 결제 금액 + RentalOrder 결제 금액 합산 검증
// 2. 토스페이먼츠 결제 승인
// 3. Contract 상태 업데이트
// 4. RentalOrder 상태 업데이트 (PENDING → PAID)
// 5. RentalItemReservation 상태 업데이트 (RESERVED → CONFIRMED)
// 6. RentalOrderLog 기록
```

### 3.3 결제 정보 조회 수정

**파일**: `controllers/contractController.js`

**수정 함수**: `getPaymentInfo`

```javascript
// 기존: Contract.finalTotalAmount만 반환
// 변경: Contract 금액 + RentalOrder 금액 함께 반환

return success(res, {
  contractId: contract.id,
  orderId: contract.orderId,

  // 방 계약 금액
  contractAmount: contract.finalTotalAmount,

  // 렌탈 주문 금액 (INITIAL, PENDING 상태)
  rentalAmount: rentalOrder?.totalAmount || 0,

  // 총 결제 금액
  totalAmount: contract.finalTotalAmount + (rentalOrder?.totalAmount || 0),

  orderName: `${contract.room.roomName} (${contract.totalDays}박)`,
  // ...
});
```

### 3.4 Contract 조회 시 렌탈 정보 포함

**파일**: `controllers/contractController.js`

**수정 함수**: `getContractDetail`, `getGuestContracts`, `getHostContracts`

```javascript
// RentalOrder 정보 함께 조회
include: [
  // ... 기존 include
  {
    model: RentalOrder,
    as: 'rentalOrders',
    include: [
      {
        model: RentalOrderItem,
        as: 'items',
        include: [{ model: RentalItem, as: 'rentalItem' }]
      }
    ]
  }
]
```

### 3.5 체크리스트

- [ ] `createContractRequest` 수정 - RentalOrder(INITIAL) 생성 추가
- [ ] `confirmPayment` 수정 - RentalOrder 결제 처리 추가
- [ ] `getPaymentInfo` 수정 - 합산 금액 반환
- [ ] `getContractDetail` 수정 - 렌탈 정보 포함
- [ ] `getGuestContracts` 수정 - 렌탈 요약 포함
- [ ] `getHostContracts` 수정 - 렌탈 요약 포함
- [ ] 기존 테스트 케이스 업데이트

---

## Phase 4: 관리자 API 구현

### 4.1 관리자 컨트롤러 함수 추가

**파일**: `controllers/adminController.js`

| 함수 | 엔드포인트 | 설명 |
|------|-----------|------|
| `getRentalLogs` | GET /admin/contracts/:id/rental-logs | 렌탈 이력 조회 |
| `adminCancelRentalItem` | POST /admin/rental-orders/:id/items/:itemId/cancel | 강제 취소 |

### 4.2 관리자 라우트 추가

**파일**: `routes/adminRoutes.js`

```javascript
// 렌탈 관리
router.get('/contracts/:contractId/rental-logs', authenticateAdmin, getRentalLogs);
router.post('/rental-orders/:rentalOrderId/items/:itemId/cancel', authenticateAdmin, adminCancelRentalItem);
```

### 4.3 체크리스트

- [ ] `controllers/adminController.js`에 함수 추가
- [ ] `routes/adminRoutes.js`에 라우트 추가
- [ ] 관리자 API 문서 업데이트
- [ ] 관리자 API 테스트

---

## Phase 5: 테스트 및 검증

### 5.1 단위 테스트

| 테스트 대상 | 파일 |
|------------|------|
| 렌탈 주문 생성 | `tests/rentalOrder.create.test.js` |
| 렌탈 결제 처리 | `tests/rentalOrder.payment.test.js` |
| 렌탈 아이템 취소 | `tests/rentalOrder.cancel.test.js` |
| 수정 기한 체크 | `tests/rentalOrder.modifiable.test.js` |
| 이력 로깅 | `tests/rentalOrder.logging.test.js` |

### 5.2 통합 테스트 시나리오

1. **기본 플로우**
   - 계약 생성 + 렌탈 선택 → 결제 → 완료

2. **추가 주문 플로우**
   - 계약 완료 → 추가 렌탈 → 추가 결제 → 완료

3. **취소/환불 플로우**
   - 결제 완료 → 아이템 취소 → 부분 환불 → 확인

4. **기한 초과 플로우**
   - 입주 5일 이내 → 변경 시도 → 에러 확인

5. **복합 시나리오**
   - 초기 주문 → 일부 취소 → 추가 주문 → 추가 취소 → 이력 확인

### 5.3 체크리스트

- [ ] 단위 테스트 작성 및 통과
- [ ] 통합 테스트 시나리오 검증
- [ ] 에러 케이스 테스트
- [ ] 동시성 테스트 (재고 경쟁)
- [ ] 성능 테스트 (대량 조회)

---

## Phase 6: 데이터 마이그레이션 (선택)

### 6.1 마이그레이션 스크립트

**파일**: `scripts/migrate_existing_rentals.js`

```javascript
// 기존 Contract.rentalItems 데이터를 RentalOrder로 마이그레이션
async function migrateExistingRentals() {
  const contracts = await Contract.findAll({
    where: {
      rentalItems: { [Op.ne]: null },
      rentalItemsFee: { [Op.gt]: 0 }
    }
  });

  for (const contract of contracts) {
    // 1. RentalOrder(INITIAL) 생성
    // 2. RentalOrderItem 생성
    // 3. RentalItemReservation 연결
    // 4. RentalOrderLog 초기 기록
  }
}
```

### 6.2 검증 스크립트

**파일**: `scripts/verify_rental_migration.js`

```javascript
// 마이그레이션 결과 검증
async function verifyMigration() {
  // 1. 모든 Contract의 렌탈 금액 합계 비교
  // 2. RentalItemReservation 연결 확인
  // 3. 불일치 데이터 리포트
}
```

### 6.3 체크리스트

- [ ] 마이그레이션 스크립트 작성
- [ ] 검증 스크립트 작성
- [ ] 테스트 환경에서 마이그레이션 테스트
- [ ] 프로덕션 마이그레이션 실행
- [ ] 마이그레이션 결과 검증

---

## 파일 구조

```
ezstay_back/
├── models/
│   ├── RentalOrder.js          # 신규
│   ├── RentalOrderItem.js      # 신규
│   ├── RentalOrderLog.js       # 신규
│   ├── RentalItemReservation.js # 수정 (rental_order_id 추가)
│   └── index.js                # 수정 (관계 추가)
│
├── controllers/
│   ├── rentalOrderController.js # 신규
│   ├── contractController.js    # 수정
│   └── adminController.js       # 수정
│
├── routes/
│   ├── rentalOrderRoutes.js     # 신규
│   └── adminRoutes.js           # 수정
│
├── utils/
│   ├── rentalOrderHelper.js     # 신규
│   └── responseHelper.js        # 수정 (에러 코드 추가)
│
├── scripts/
│   ├── migration_rental_order_system.sql  # 신규
│   ├── migrate_existing_rentals.js        # 신규 (Phase 6)
│   └── verify_rental_migration.js         # 신규 (Phase 6)
│
├── docs/
│   ├── RENTAL_ORDER_DESIGN.md             # 완료
│   ├── RENTAL_ORDER_IMPLEMENTATION_PLAN.md # 본 문서
│   └── API_DOCUMENTATION.md               # 수정 필요
│
└── tests/
    └── rentalOrder/              # 신규
        ├── create.test.js
        ├── payment.test.js
        ├── cancel.test.js
        └── ...
```

---

## 일정 예상

| Phase | 작업 | 예상 규모 |
|-------|------|----------|
| Phase 1 | DB 및 모델 | 신규 3개, 수정 2개 |
| Phase 2 | 게스트 API | 컨트롤러 1개, 라우트 1개, 유틸 1개 |
| Phase 3 | 기존 로직 수정 | 함수 5-6개 수정 |
| Phase 4 | 관리자 API | 함수 2개 추가 |
| Phase 5 | 테스트 | 테스트 케이스 10+ |
| Phase 6 | 마이그레이션 | 스크립트 2개 (선택) |

---

## 주의사항

1. **하위 호환성**
   - 기존 Contract API 응답 형식 유지
   - rentalItems, rentalItemsFee 필드는 deprecated 처리 (즉시 제거 X)

2. **트랜잭션 처리**
   - 주문 생성/결제/취소 시 반드시 트랜잭션 사용
   - 재고와 주문 상태 동기화 보장

3. **동시성 제어**
   - 재고 확인 및 예약 시 `FOR UPDATE` 사용
   - Race Condition 방지

4. **결제 연동**
   - 초기 주문: Contract와 합산 결제 (기존 결제키 사용)
   - 추가 주문: 별도 결제 (새 결제키 발급)

5. **환불 처리**
   - 토스페이먼츠 부분 환불 API 사용
   - 원본 paymentKey로 환불 요청

---

## 변경 이력

| 버전 | 날짜 | 작성자 | 내용 |
|------|------|--------|------|
| 1.0 | 2025-02-01 | Claude | 초안 작성 |
