# 옵션 상품 재고 구조

## 핵심 필드

| 필드 | DB 컬럼 | 의미 |
|------|---------|------|
| `totalStock` | `total_stock` | 물리적 총 보유량 |

`availableStock` 컬럼은 **제거됨** (2026-04-04). 분실·파손 관리는 초기 단계에 불필요하다고 판단.

---

## 재고 설계 구조

```
totalStock
  └─ reservedQuantity  ← RentalItemReservation 테이블에서 기간 기준 자동 집계
       └─ 예약 가능 수량 = totalStock - reservedQuantity
```

### 예시
```
totalStock = 10개

4/10~4/20 예약된 수량 = 7개  (Reservation 테이블 SUM)

→ 4/10~4/20 예약 가능 수량 = 10 - 7 = 3개
```

---

## RentalItemReservation 테이블

예약 생성 시 레코드를 INSERT하고, 취소 시 status를 `CANCELLED`로 변경.
`totalStock`을 직접 건드리지 않고 이 테이블로 예약 점유를 관리.

### 기간 충돌 조건 (3가지 OR)
```js
reservedFrom BETWEEN [checkIn, checkOut]               // 예약 시작이 내 기간 안
reservedUntil BETWEEN [checkIn, checkOut]              // 예약 종료가 내 기간 안
reservedFrom <= checkIn AND reservedUntil >= checkOut  // 내 기간을 완전히 포함
```

### status 값
| 값 | 의미 |
|----|------|
| `RESERVED` | 예약됨 |
| `CONFIRMED` | 확정됨 |
| `COMPLETED` | 완료됨 |
| `CANCELLED` | 취소됨 |

예약 가능 수량 계산 시 `RESERVED`, `CONFIRMED`만 집계.

---

## CRUD 지도

### totalStock 변경 포인트

| 시점 | 파일 | 방식 |
|------|------|------|
| 물품 최초 등록 | `rentalItemController.js` | `totalStock` 직접 set |
| 관리자 총 재고 수정 | `rentalItemController.js` — `updateRentalItem()` | `totalStock` 직접 set |

### Reservation 레코드 변경 포인트

| 시점 | 파일 | 동작 |
|------|------|------|
| 계약 생성 (옵션 포함) | `rentalOrderHelper.js` | `RESERVED` INSERT |
| 예약 가능 수량 조회 | `rentalOrderHelper.js`, `contractHelper.js` | `RESERVED + CONFIRMED` SUM |
| 환불·취소 처리 | `adminPaymentController.js` | `CANCELLED` UPDATE |

---

## 주문 가능 여부 검증 흐름

```
프론트 주문 요청
       ↓
contractHelper / rentalOrderHelper
       ↓
totalStock - reservedQuantity(Reservation 집계) = 주문 가능 수량
       ↓
주문 수량 > 주문 가능 수량 → 재고 부족 에러 반환
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
| GET | `/api/admin/rental-items/:id/calendar?year=&month=` | 월별 날짜별 예약 현황 조회 |

- `salesType = 'RENTAL'` 아이템만 지원 (SALE 요청 시 400)
- 해당 월과 겹치는 `RESERVED`, `CONFIRMED` 상태 Reservation 조회
- JS 레벨에서 날짜별 `quantity` 합산 → `reservedQuantity` / `availableQuantity` 반환
- 예약 없는 날짜도 포함 (`reservedQuantity: 0`)

### 구현 파일

| 파일 | 변경 내용 |
|------|----------|
| `controllers/rentalItemController.js` | `getRentalItemCalendar` 함수 추가 |
| `routes/rentalItemRoutes.js` | `/:id/calendar` 라우트 추가 (`/:id` 앞에 등록) |

### 연동 가이드

프론트엔드 연동 가이드 및 시나리오: `claudedocs/rental_calendar_api_guide.md`
