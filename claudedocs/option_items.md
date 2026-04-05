# 옵션 상품 재고 구조

## salesType (판매 유형)

| 값 | 의미 | 재고 관리 방식 |
|----|------|---------------|
| `RENTAL` | 대여형 | `RentalItemReservation` 기간 기반 점유 |
| `SALE` | 판매형 | `totalStock` 직접 차감/복구 |

---

## 핵심 필드

| 필드 | DB 컬럼 | 의미 |
|------|---------|------|
| `totalStock` | `total_stock` | 물리적 총 보유량 |

`availableStock` 컬럼은 **제거됨** (2026-04-04). 분실·파손 관리는 초기 단계에 불필요하다고 판단.

---

## 재고 설계 구조

### RENTAL 타입
```
totalStock
  └─ reservedQuantity  ← RentalItemReservation 테이블에서 기간 기준 자동 집계
       └─ 예약 가능 수량 = totalStock - reservedQuantity
```

#### 예시
```
totalStock = 10개

4/10~4/20 예약된 수량 = 7개  (Reservation 테이블 SUM)

→ 4/10~4/20 예약 가능 수량 = 10 - 7 = 3개
```

### SALE 타입
```
totalStock  ← 구매 시 직접 차감, 취소(배송 전)시 직접 복구
```

날짜 기반 점유 없음. `RentalItemReservation` 미사용.

---

## RentalItemReservation 테이블 (RENTAL 전용)

RENTAL 타입 아이템에만 사용. SALE 타입은 이 테이블을 사용하지 않음.

### status 흐름
```
계약 생성 (결제 전)  → RESERVED   (재고 선점)
결제 완료           → CONFIRMED  (rentalOrderId 연결)
취소/만료           → CANCELLED  (재고 해제)
```

### 기간 충돌 조건 (3가지 OR)
```js
reservedFrom BETWEEN [checkIn, checkOut]               // 예약 시작이 내 기간 안
reservedUntil BETWEEN [checkIn, checkOut]              // 예약 종료가 내 기간 안
reservedFrom <= checkIn AND reservedUntil >= checkOut  // 내 기간을 완전히 포함
```

예약 가능 수량 계산 시 `RESERVED`, `CONFIRMED`만 집계.

---

## CRUD 지도

### totalStock 변경 포인트

| 시점 | 파일 | 대상 | 방식 |
|------|------|------|------|
| 물품 최초 등록 | `rentalItemController.js` | 전체 | `totalStock` 직접 set |
| 관리자 총 재고 수정 | `rentalItemController.js` — `updateRentalItem()` | 전체 | `totalStock` 직접 set |
| 계약 생성 (결제 전) | `contractHelper.js` — `reserveRentalItems()` | SALE | `totalStock--` |
| 결제 후 추가 주문 | `rentalOrderHelper.js` — `createAdditionalRentalOrder()` | SALE | `totalStock--` |
| 계약 취소/만료 | `contractHelper.js` — `cancelRentalItemReservations()` | SALE | `totalStock++` |
| 게스트 렌탈 취소 (배송 전) | `rentalOrderHelper.js` — `cancelPaidRentalOrder()` | SALE | `totalStock++` |
| 게스트 아이템 즉시환불 (배송 전) | `rentalOrderController.js` — `cancelRentalItemsByGuest()` | SALE | `totalStock++` |

### Reservation 레코드 변경 포인트 (RENTAL 전용)

| 시점 | 파일 | 동작 |
|------|------|------|
| 계약 생성 (결제 전) | `contractHelper.js` — `reserveRentalItems()` | `RESERVED` INSERT |
| 결제 완료 | `rentalOrderHelper.js` — `createInitialRentalOrder()` | `RESERVED` → `CONFIRMED` + `rentalOrderId` 연결 |
| 결제 후 추가 주문 | `rentalOrderHelper.js` — `createAdditionalRentalOrder()` | `CONFIRMED` INSERT |
| 예약 가능 수량 조회 | `rentalOrderHelper.js`, `contractHelper.js` | `RESERVED + CONFIRMED` SUM |
| 계약 취소/만료 | `contractHelper.js` — `cancelRentalItemReservations()` | `CANCELLED` UPDATE |
| 렌탈 주문 취소 | `rentalOrderHelper.js` — `cancelPaidRentalOrder()` | `CANCELLED` UPDATE |
| 게스트 아이템 즉시환불 | `rentalOrderController.js` — `cancelRentalItemsByGuest()` | `CANCELLED` UPDATE |

---

## 주문 가능 여부 검증 흐름

```
프론트 주문 요청
       ↓
contractHelper.validateRentalItemsStock()
또는 rentalOrderHelper.validateRentalStock()
       ↓
  salesType === 'SALE'?
  ├─ YES → totalStock 직접 비교
  └─ NO  → totalStock - reservedQuantity(Reservation 집계) 비교
       ↓
주문 수량 > 가용 수량 → 재고 부족 에러 반환
```

검증은 항상 백엔드에서 수행. 프론트의 totalStock 표시값과 무관.

---

## API 목록

### 게스트용 (인증 불필요)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/rental-items` | 목록 조회 (`?itemType=` 필터 가능) |
| GET | `/api/rental-items/:id` | 단건 상세 |
| GET | `/api/rental-items/type/:itemType` | 카테고리별 조회 |
| GET | `/api/rental-items/categories` | 카테고리 목록 |

### 관리자용 (authenticateAdmin 필요)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/admin/rental-items` | 전체 목록 (`?itemType=`, `?isActive=` 필터) |
| GET | `/api/admin/rental-items/stats` | 카테고리별 통계 |
| GET | `/api/admin/rental-items/:id` | 단건 상세 |
| POST | `/api/admin/rental-items` | 등록 |
| PATCH | `/api/admin/rental-items/:id` | 정보 수정 (totalStock 포함) |
| DELETE | `/api/admin/rental-items/:id` | 삭제 |

`PATCH /api/admin/rental-items/:id/stock` (adjustStock) — **제거됨**

---

## 프론트엔드 변경 공유 사항 (2026-04-04)

`availableStock` 제거에 따른 API 응답 변경:

| API | 제거된 필드 | 변경 |
|-----|------------|------|
| `GET /api/rental-items` | `availableStock` | `totalStock`으로 대체 |
| `GET /api/rental-items/:id` | `availableStock` | `totalStock`으로 대체 |
| `GET /api/admin/rental-items` | `isOutOfStock`, `rentedStock` | 제거 |
| `GET /api/admin/rental-items/:id` | `isOutOfStock`, `rentedStock` | 제거 |
| `GET /api/admin/rental-items/stats` | `availableStock`, `rentedStock` | 제거 |
| 방 상세 내 rentalItems | `availableStock` | `totalStock`으로 대체 |
| `PATCH /:id/stock` | — | 엔드포인트 자체 삭제 |

쿼리 파라미터 `?inStock=true` — **제거됨** (동작 안 함, 무시됨)

---

## DB 마이그레이션 (수동 실행 필요)

```sql
ALTER TABLE rental_items DROP CONSTRAINT CONSTRAINT_3;
ALTER TABLE rental_items DROP INDEX idx_available_stock;
ALTER TABLE rental_items DROP COLUMN available_stock;
```

---

## 데드코드 — 제거 완료 (2026-04-04)

| 함수 | 위치 | 사유 |
|------|------|------|
| `decreaseStock()` | `RentalItem.js` | 예약은 Reservation으로 관리, 불필요 |
| `increaseStock()` | `RentalItem.js` | 예약 취소와 availableStock 무관 |
| `updateTotalStock()` | `RentalItem.js` | availableStock 재계산 로직 제거로 불필요 |
| `adjustStock()` | `rentalItemController.js` | availableStock 수동 조정 API 제거 |

---

## 구현 완료 — 렌탈 캘린더 API (2026-04-05)

### 추가된 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/admin/rental-items/:id/calendar?year=&month=` | 단건 월별 캘린더 조회 |
| GET | `/api/admin/rental-items/calendar?year=&month=` | 전체 일괄 월별 캘린더 조회 |

- `salesType = 'RENTAL'` 아이템만 지원 (SALE 요청 시 400)
- 해당 월과 겹치는 `RESERVED`, `CONFIRMED` 상태 Reservation 조회
- JS 레벨에서 날짜별 `quantity` 합산 → `reservedQuantity` / `availableQuantity` 반환
- 예약 없는 날짜도 포함 (`reservedQuantity: 0`)
- 일괄 조회는 Reservation 테이블 1회 쿼리로 전체 아이템 처리

### 구현 파일

| 파일 | 변경 내용 |
|------|----------|
| `controllers/rentalItemController.js` | `getRentalItemCalendar`, `getAllRentalItemsCalendar` 함수 추가 |
| `routes/rentalItemRoutes.js` | `/calendar`, `/:id/calendar` 라우트 추가 (`/:id` 앞에 등록) |

### 연동 가이드

프론트엔드 연동 가이드 및 시나리오: `claudedocs/rental_calendar_api_guide.md`

---

## 구현 완료 — 배송·회수 버퍼 재고 점유 (2026-04-05)

실제 임대 기간 앞뒤 N일을 배송·회수 기간으로 간주해 재고 점유에 반영.

### 상수

```js
// utils/rentalOrderHelper.js
const RENTAL_BUFFER_DAYS = 3;
```

배송/회수 시스템이 체계화되면 `0`으로 변경하거나 제거. 이 상수 하나로 전체 반영됨.

### 적용 범위

| 위치 | 적용 내용 |
|------|----------|
| `utils/rentalOrderHelper.js` — `validateRentalStock()` | 신규 주문 재고 검증 시 기존 Reservation 기간을 ±buffer 확장해 충돌 검사 |
| `utils/contractHelper.js` — `validateRentalItemsStock()` | 계약 생성 시 재고 검증 동일 적용 |
| `controllers/rentalItemController.js` — 캘린더 집계 (단건·일괄) | 날짜별 집계 시 각 Reservation의 기간을 ±buffer 확장해 점유 수량 계산 |

### 시나리오 예시

```
실제 임대 기간: 3/24 ~ 3/31
버퍼 적용 후:  3/21 ~ 4/3

→ 4월 1일 캘린더: reservedQuantity > 0 (사용 불가로 표시)
```

---

## 구현 완료 — SALE 타입 재고 로직 (2026-04-05)

### 개요

기존에는 `salesType`이 모델에만 정의되어 있고 실제 로직에서는 SALE/RENTAL 구분 없이 모두 Reservation 방식으로 처리됐음. 이를 타입별로 분리 구현.

### SALE 재고 흐름

| 시점 | 동작 |
|------|------|
| 계약 생성 (결제 전) | `totalStock--` |
| 아이템 변경 (updatePendingRentalItems) | 기존 점유 `totalStock++` → 새 선택 `totalStock--` |
| 계약 취소 / 미승인 만료 / 미결제 만료 | `totalStock++` |
| 결제 완료 | 변경 없음 (이미 차감 완료) |
| 취소 — 배송 전 (`deliveryStatus = PENDING`) | `totalStock++` |
| 취소 — 배송 후 | 복구 없음 |

### 변경 파일

| 파일 | 변경 내용 |
|------|----------|
| `utils/contractHelper.js` | `validateRentalItemsStock()` SALE 분기, `reserveRentalItems()` SALE→totalStock--, `cancelRentalItemReservations()` SALE→totalStock++ |
| `utils/contractHelper.js` | `validateRentalItemsStock()` 시그니처에서 불필요한 `roomId` 파라미터 제거 |
| `controllers/contractController.js` | `createContract()` 에 `reserveRentalItems()` 호출 추가 |
| `controllers/contractController.js` | `updatePendingRentalItems()` 에 해제 후 재점유 추가 |
| `schedulers/contractScheduler.js` | `updateApprovalExpired()`, `updatePaymentExpired()` 에 `cancelRentalItemReservations()` 호출 추가 |
| `utils/rentalOrderHelper.js` | `validateRentalStock()` SALE 분기, `createInitialRentalOrder()` RENTAL Reservation INSERT → CONFIRMED 업데이트로 변경, `cancelPaidRentalOrder()` SALE 재고 복구 분기 |
| `controllers/rentalOrderController.js` | `cancelRentalItemsByGuest()` SALE 재고 복구 + RENTAL Reservation 취소 추가 (기존 누락 버그 수정) |

### RENTAL Reservation status 흐름 (변경 후)

```
계약 생성      → RESERVED   (contractHelper.reserveRentalItems)
결제 완료      → CONFIRMED  (rentalOrderHelper.createInitialRentalOrder)
추가 주문 결제 → CONFIRMED  (rentalOrderHelper.createAdditionalRentalOrder, 신규 INSERT)
취소/만료      → CANCELLED
```
