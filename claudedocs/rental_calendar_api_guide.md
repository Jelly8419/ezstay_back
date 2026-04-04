# 렌탈 아이템 캘린더 API 연동 가이드

> 대상: 관리자 프론트엔드 개발자  
> 작성일: 2026-04-05  
> 업데이트: 2026-04-05 (일괄 조회 API 추가)  
> 기준 서버: `http://localhost:8080`

---

## 개요

관리자 화면에서 렌탈 물품의 **날짜별 예약 현황**을 캘린더 형태로 표시하기 위한 API입니다.

- `salesType = 'RENTAL'`인 물품만 지원합니다. (`SALE` 타입 요청 시 400 반환)
- 예약 중(`RESERVED`) 및 확정(`CONFIRMED`) 상태의 예약만 집계합니다.
- 날짜별로 `reservedQuantity`(예약된 수량)와 `availableQuantity`(주문 가능 수량)를 반환합니다.

### API 선택 기준

| 화면 | 사용할 API |
|------|-----------|
| 전체 캘린더 대시보드 (모든 렌탈 물품 한눈에) | **일괄 조회** `GET /calendar` |
| 특정 아이템 상세 페이지 내 캘린더 탭 | **단건 조회** `GET /:id/calendar` |

---

## API 1 — 전체 일괄 조회

```
GET /api/admin/rental-items/calendar?year=2026&month=4
```

RENTAL 타입 활성 아이템 전체의 캘린더를 **DB 쿼리 2회**로 반환합니다. 아이템 수가 늘어도 요청 횟수는 항상 1회입니다.

### 인증

```
Authorization: Bearer <관리자_액세스_토큰>
```

### 쿼리 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `year` | integer | ✅ | 연도 (예: 2026) |
| `month` | integer | ✅ | 월 (1~12) |

### 성공 응답 (200)

```json
{
  "success": true,
  "message": "렌탈 아이템 캘린더를 조회했습니다.",
  "data": {
    "year": 2026,
    "month": 4,
    "items": [
      {
        "rentalItemId": 3,
        "name": "헤어드라이어",
        "itemType": "hair_dryer",
        "itemTypeLabel": "헤어드라이어",
        "totalStock": 10,
        "calendar": {
          "2026-04-01": { "reservedQuantity": 0, "availableQuantity": 10 },
          "2026-04-10": { "reservedQuantity": 7, "availableQuantity": 3 },
          "2026-04-11": { "reservedQuantity": 10, "availableQuantity": 0 }
        }
      },
      {
        "rentalItemId": 5,
        "name": "침구 세트",
        "itemType": "bedding_set",
        "itemTypeLabel": "침구 세트",
        "totalStock": 20,
        "calendar": {
          "2026-04-01": { "reservedQuantity": 5, "availableQuantity": 15 },
          "2026-04-10": { "reservedQuantity": 0, "availableQuantity": 20 }
        }
      }
    ]
  }
}
```

> RENTAL 타입 아이템이 없으면 `items: []`를 반환합니다. (200)

### 필드 설명

| 필드 | 타입 | 설명 |
|------|------|------|
| `year` | integer | 조회 연도 |
| `month` | integer | 조회 월 |
| `items` | array | RENTAL 타입 아이템 목록 |
| `items[].rentalItemId` | integer | 아이템 ID |
| `items[].name` | string | 아이템명 |
| `items[].itemType` | string | 카테고리 코드 |
| `items[].itemTypeLabel` | string | 카테고리 한글명 |
| `items[].totalStock` | integer | 총 보유 수량 |
| `items[].calendar` | object | 날짜별 예약 현황 (키: `"YYYY-MM-DD"`) |

### 에러 응답

| 상황 | HTTP | code |
|------|------|------|
| `year` / `month` 누락·비정상 | 400 | 4001 |

---

## API 2 — 단건 조회

```
GET /api/admin/rental-items/:id/calendar?year=2026&month=4
```

특정 아이템 하나의 캘린더를 조회합니다. 상세 페이지 내 캘린더 탭에 사용하세요.

### 인증

```
Authorization: Bearer <관리자_액세스_토큰>
```

### 경로 파라미터

| 파라미터 | 타입 | 설명 |
|---------|------|------|
| `id` | integer | 렌탈 아이템 ID |

### 쿼리 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `year` | integer | ✅ | 연도 (예: 2026) |
| `month` | integer | ✅ | 월 (1~12) |

### 성공 응답 (200)

```json
{
  "success": true,
  "message": "렌탈 아이템 캘린더를 조회했습니다.",
  "data": {
    "rentalItemId": 3,
    "name": "헤어드라이어",
    "totalStock": 10,
    "year": 2026,
    "month": 4,
    "calendar": {
      "2026-04-01": { "reservedQuantity": 0, "availableQuantity": 10 },
      "2026-04-02": { "reservedQuantity": 3, "availableQuantity": 7 },
      "2026-04-10": { "reservedQuantity": 7, "availableQuantity": 3 },
      "2026-04-11": { "reservedQuantity": 10, "availableQuantity": 0 },
      "2026-04-30": { "reservedQuantity": 2, "availableQuantity": 8 }
    }
  }
}
```

> `calendar` 객체는 해당 월의 **모든 날짜**를 키로 가집니다. (예약이 없는 날도 포함, `reservedQuantity: 0`)

### 필드 설명

| 필드 | 타입 | 설명 |
|------|------|------|
| `rentalItemId` | integer | 아이템 ID |
| `name` | string | 아이템명 |
| `totalStock` | integer | 총 보유 수량 |
| `year` | integer | 조회 연도 |
| `month` | integer | 조회 월 |
| `calendar` | object | 날짜별 예약 현황 (키: `"YYYY-MM-DD"`) |
| `calendar[날짜].reservedQuantity` | integer | 해당 날짜의 예약된 수량 |
| `calendar[날짜].availableQuantity` | integer | 해당 날짜의 주문 가능 수량 (`totalStock - reservedQuantity`) |

### 에러 응답

| 상황 | HTTP | code | message |
|------|------|------|---------|
| `year` / `month` 누락·비정상 | 400 | 4001 | year와 month는 필수이며 유효한 숫자여야 합니다. (month: 1-12) |
| SALE 타입 아이템 요청 | 400 | 4010 | 판매형(SALE) 물품은 캘린더 조회를 지원하지 않습니다. |
| 아이템 미존재 | 404 | 3010 | 대여 물품을 찾을 수 없습니다. |

---

## 연동 시나리오

### 시나리오 1: 전체 캘린더 대시보드 진입

**상황**: 관리자가 캘린더 메뉴에 진입하면 이번 달 전체 렌탈 물품 현황을 한 번에 표시한다.

**흐름**:

1. 페이지 마운트 시 일괄 조회 API 1회 호출
2. `items` 배열을 순회해 아이템별 캘린더 렌더링
3. 각 아이템 카드 내부에 날짜별 셀 표시

```js
const today = new Date();
const year = today.getFullYear();
const month = today.getMonth() + 1;

const response = await fetch(
  `/api/admin/rental-items/calendar?year=${year}&month=${month}`,
  { headers: { Authorization: `Bearer ${token}` } }
);
const { data } = await response.json();

// 아이템별 캘린더 렌더링
data.items.forEach(item => {
  renderItemCalendar(item); // item.calendar, item.totalStock, item.name 활용
});
```

---

### 시나리오 2: 단건 캘린더 표시

**상황**: 관리자가 렌탈 아이템 목록에서 특정 물품을 선택해 이번 달 재고 현황을 확인한다.

**흐름**:

1. 관리자가 목록에서 아이템 클릭
2. `year`, `month`를 현재 날짜 기준으로 자동 설정해 API 호출
3. `calendar` 객체를 순회해 날짜별 셀 렌더링
4. `availableQuantity === 0`인 날짜는 품절로 표시

```js
const today = new Date();
const year = today.getFullYear();
const month = today.getMonth() + 1;

const response = await fetch(
  `/api/admin/rental-items/${itemId}/calendar?year=${year}&month=${month}`,
  { headers: { Authorization: `Bearer ${token}` } }
);
const { data } = await response.json();

// 날짜별 렌더링
Object.entries(data.calendar).forEach(([date, { reservedQuantity, availableQuantity }]) => {
  renderCell(date, reservedQuantity, availableQuantity, data.totalStock);
});
```

---

### 시나리오 3: 월 이동 (이전/다음 달)

**상황**: 관리자가 캘린더에서 이전 달 또는 다음 달로 이동한다.

**흐름**:

1. 이전/다음 달 버튼 클릭
2. `year`, `month` 상태값 업데이트 후 API 재호출
3. 12월 → 다음 달: `year + 1`, `month = 1`로 처리
4. 1월 → 이전 달: `year - 1`, `month = 12`로 처리

```js
function moveToPrevMonth(year, month) {
  if (month === 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

function moveToNextMonth(year, month) {
  if (month === 12) return { year: year + 1, month: 1 };
  return { year, month: month + 1 };
}
```

> API는 월 범위를 서버에서 자동 계산하므로 프론트에서 말일 계산은 불필요합니다.

---

### 시나리오 4: 재고 부족 날짜 강조 표시

**상황**: 재고가 임박하거나 소진된 날짜를 색상으로 구분해 표시한다.

**권장 기준**:

| 상태 | 조건 | 표시 예시 |
|------|------|----------|
| 여유 | `availableQuantity >= totalStock * 0.5` | 초록 |
| 주의 | `availableQuantity > 0 && availableQuantity < totalStock * 0.5` | 노랑 |
| 품절 | `availableQuantity === 0` | 빨강 |

```js
function getStockStatus(availableQuantity, totalStock) {
  if (availableQuantity === 0) return 'soldout';
  if (availableQuantity < totalStock * 0.5) return 'warning';
  return 'available';
}
```

---

### 시나리오 5: SALE 타입 아이템 진입 방지

**상황**: 관리자 목록에서 SALE 타입 아이템에 캘린더 버튼이 노출되지 않아야 한다.

**권장 처리**: 목록 API(`GET /api/admin/rental-items`) 응답의 `salesType` 필드를 확인해 **RENTAL인 경우에만 캘린더 버튼 노출**.

```js
// 목록 렌더링 시
items.forEach(item => {
  const showCalendarBtn = item.salesType === 'RENTAL';
  renderItem(item, { showCalendarBtn });
});
```

> 방어 차원에서 API를 직접 호출하더라도 SALE 타입이면 400이 반환됩니다.

---

### 시나리오 6: 과거/미래 월 조회

**상황**: 관리자가 지난달 예약 현황을 회고하거나, 다음 달 여유 재고를 미리 파악한다.

- API는 과거/미래 월 제한 없이 모두 조회 가능합니다.
- 과거 월은 이미 `COMPLETED` 또는 `CANCELLED`된 예약이 많아 대부분 `reservedQuantity: 0`으로 표시될 수 있습니다. (집계 대상은 `RESERVED`, `CONFIRMED`만)
- 미래 월 조회 시 아직 생성된 예약이 없으면 전 날짜 `reservedQuantity: 0`으로 반환됩니다.

---

## 캘린더 UI 구현 참고

### 날짜 키 형식

응답의 `calendar` 키는 항상 `"YYYY-MM-DD"` 형식입니다. 패딩이 적용되어 있으므로 별도 변환 없이 바로 사용 가능합니다.

```
"2026-04-01", "2026-04-02", ... "2026-04-30"
```

### 표시 정보 구성 예시

```
┌─────────────────────────────┐
│     헤어드라이어 재고 현황    │
│         2026년 4월           │
│       총 보유 수량: 10개      │
├────┬────┬────┬────┬────┬────┤
│ 월 │ 화 │ 수 │ 목 │ 금 │ 토 │
├────┼────┼────┼────┼────┼────┤
│    │    │  1 │  2 │  3 │  4 │
│    │    │10개│ 7개│ 7개│10개│
├────┼────┼────┼────┼────┼────┤
│  7 │  8 │  9 │ 10 │ 11 │ 12 │
│10개│ 3개│ 3개│ 3개│ 0개│10개│
│    │    │    │    │품절│    │
└────┴────┴────┴────┴────┴────┘
```

> 각 셀에 `availableQuantity`를 표시하고, `totalStock` 대비 비율로 색상을 구분하는 것을 권장합니다.

---

## 주의사항

1. **실시간 반영 아님**: 캘린더 데이터는 호출 시점의 스냅샷입니다. 다른 관리자가 동시에 작업 중일 수 있으므로, 중요한 판단 전 새로고침을 권장합니다.

2. **availableQuantity 음수 가능성**: 관리자가 `totalStock`을 현재 예약 수량보다 낮게 수정하면 `availableQuantity`가 음수가 될 수 있습니다. UI에서 `Math.max(0, availableQuantity)`로 보정해 표시하는 것을 권장합니다.

3. **날짜 시간대**: 서버는 KST(UTC+9) 기준으로 집계합니다. 클라이언트 시간대와 무관하게 서버 기준으로 동일하게 반환됩니다.
