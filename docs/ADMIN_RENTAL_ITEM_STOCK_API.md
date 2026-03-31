# 관리자 옵션 재고 관리 API 가이드

> **관리자 프론트엔드 개발자를 위한 옵션 상품 재고 관리 연동 가이드**

---

## 개요

옵션 상품(헤어드라이어, 침구류, 어메니티 키트 등)의 재고 현황 조회 및 관리 기능입니다.

### 주요 개념

| 개념 | 설명 |
|------|------|
| **salesType** | 판매 유형. `SALE`(판매형) / `RENTAL`(대여형) |
| **totalStock** | 총 보유 재고 수량 |
| **availableStock** | 현재 주문 가능한 수량 |
| **rentedStock** | 현재 대여/판매 중인 수량 (`totalStock - availableStock`) |
| **isOutOfStock** | 품절 여부 (`availableStock === 0`이면 `true`) |
| **isActive** | 상품 활성화 여부. `false`이면 게스트 화면에 노출되지 않음 |

### salesType 정책

| salesType | 설명 | 환불 시 재고 복구 | 반품 시 재고 복구 |
|-----------|------|-----------------|-----------------|
| `SALE` | 판매형 (어메니티 키트, 수건 등) | ✅ 복구 | ❌ 복구 안 함 |
| `RENTAL` | 대여형 (침구류, 헤어드라이어 등) | ✅ 복구 | ✅ 수거 완료 시 복구 |

> **참고**: `isActive = false`로 설정하면 게스트 노출이 완전히 차단됩니다.  
> 재고만 소진된 경우는 `isOutOfStock: true`로 응답에 표시됩니다 (별도 토글 불필요).

---

## 공통 사항

### 인증
모든 관리자 API는 `Authorization` 헤더가 필요합니다.

```
Authorization: Bearer {accessToken}
```

### 공통 응답 구조

**성공**
```json
{
  "success": true,
  "message": "메시지",
  "data": { ... }
}
```

**실패**
```json
{
  "success": false,
  "code": 4005,
  "message": "에러 메시지",
  "details": { ... }
}
```

### Base URL
```
http://localhost:8080
```

---

## API 목록

| 메서드 | 엔드포인트 | 설명 |
|--------|-----------|------|
| GET | `/api/admin/rental-items` | 상품 목록 조회 |
| GET | `/api/admin/rental-items/stats` | 카테고리별 재고 통계 |
| GET | `/api/admin/rental-items/:id` | 상품 단건 조회 |
| POST | `/api/admin/rental-items` | 상품 등록 |
| PATCH | `/api/admin/rental-items/:id` | 상품 정보 수정 (활성/비활성 포함) |
| PATCH | `/api/admin/rental-items/:id/stock` | 재고 수량 수동 조정 |
| DELETE | `/api/admin/rental-items/:id` | 상품 삭제 |

---

## API 상세

---

### 1. 상품 목록 조회

```
GET /api/admin/rental-items
Authorization: Bearer {accessToken}
```

#### Query Parameters

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `itemType` | string | 선택 | 카테고리 필터. `hair_dryer` / `bedding_set` / `amenity_kit` / `towel_set` / `other` |
| `isActive` | boolean | 선택 | 활성화 상태 필터. `true` / `false` |

#### 요청 예시

```
GET /api/admin/rental-items
GET /api/admin/rental-items?isActive=true
GET /api/admin/rental-items?itemType=amenity_kit&isActive=true
```

#### 응답 예시

```json
{
  "success": true,
  "message": "대여 물품 목록을 조회했습니다.",
  "data": [
    {
      "id": 1,
      "itemType": "amenity_kit",
      "itemTypeLabel": "어메니티 키트",
      "salesType": "SALE",
      "salesTypeLabel": "판매형",
      "name": "프리미엄 어메니티 키트",
      "description": "칫솔, 치약, 면도기 등 포함",
      "price": "15000.00",
      "totalStock": 50,
      "availableStock": 30,
      "rentedStock": 20,
      "isOutOfStock": false,
      "imageUrl": "http://localhost:8080/uploads/items/amenity.jpg",
      "isActive": true,
      "createdAt": "2025-01-01T00:00:00.000Z",
      "updatedAt": "2025-04-01T00:00:00.000Z"
    },
    {
      "id": 2,
      "itemType": "bedding_set",
      "itemTypeLabel": "침구 세트",
      "salesType": "RENTAL",
      "salesTypeLabel": "대여형",
      "name": "기본 침구 세트",
      "description": "이불, 베개, 커버 포함",
      "price": "30000.00",
      "totalStock": 20,
      "availableStock": 0,
      "rentedStock": 20,
      "isOutOfStock": true,
      "imageUrl": null,
      "isActive": true,
      "createdAt": "2025-01-01T00:00:00.000Z",
      "updatedAt": "2025-04-01T00:00:00.000Z"
    }
  ]
}
```

#### 재고 부족 상태 표시

`isOutOfStock: true`인 항목에 품절 배지를 표시하세요.

```
availableStock === 0  →  isOutOfStock: true  →  "품절" 배지 표시
```

---

### 2. 카테고리별 재고 통계

재고 현황 대시보드 또는 요약 화면에 사용합니다.

```
GET /api/admin/rental-items/stats
Authorization: Bearer {accessToken}
```

> ⚠️ `/stats`는 `/:id`보다 먼저 선언되어 있으므로 라우팅 충돌 없이 사용 가능합니다.

#### 응답 예시

```json
{
  "success": true,
  "message": "대여 물품 통계를 조회했습니다.",
  "data": [
    {
      "itemType": "amenity_kit",
      "itemTypeLabel": "어메니티 키트",
      "salesType": "SALE",
      "salesTypeLabel": "판매형",
      "itemCount": 2,
      "totalStock": 100,
      "availableStock": 65,
      "rentedStock": 35
    },
    {
      "itemType": "bedding_set",
      "itemTypeLabel": "침구 세트",
      "salesType": "RENTAL",
      "salesTypeLabel": "대여형",
      "itemCount": 1,
      "totalStock": 20,
      "availableStock": 0,
      "rentedStock": 20
    }
  ]
}
```

---

### 3. 상품 단건 조회

```
GET /api/admin/rental-items/:id
Authorization: Bearer {accessToken}
```

#### 응답 예시

```json
{
  "success": true,
  "message": "대여 물품 정보를 조회했습니다.",
  "data": {
    "id": 1,
    "itemType": "amenity_kit",
    "itemTypeLabel": "어메니티 키트",
    "salesType": "SALE",
    "salesTypeLabel": "판매형",
    "name": "프리미엄 어메니티 키트",
    "description": "칫솔, 치약, 면도기 등 포함",
    "price": "15000.00",
    "totalStock": 50,
    "availableStock": 30,
    "rentedStock": 20,
    "isOutOfStock": false,
    "imageUrl": "http://localhost:8080/uploads/items/amenity.jpg",
    "isActive": true,
    "createdAt": "2025-01-01T00:00:00.000Z",
    "updatedAt": "2025-04-01T00:00:00.000Z"
  }
}
```

#### 에러 응답

| HTTP | code | 설명 |
|------|------|------|
| 404 | 3010 | 해당 ID의 상품이 없음 |

---

### 4. 상품 등록

```
POST /api/admin/rental-items
Authorization: Bearer {accessToken}
Content-Type: application/json
```

#### Request Body

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `itemType` | string | ✅ | `hair_dryer` / `bedding_set` / `amenity_kit` / `towel_set` / `other` |
| `salesType` | string | ✅ | `SALE` / `RENTAL` |
| `name` | string | ✅ | 상품명 (최대 100자) |
| `price` | number | ✅ | 1회 가격 (0 이상) |
| `totalStock` | number | ✅ | 총 재고 수량 (0 이상) |
| `description` | string | 선택 | 상품 설명 |
| `imageUrl` | string | 선택 | 이미지 URL |
| `isActive` | boolean | 선택 | 활성화 여부 (기본값: `true`) |

#### 요청 예시

```json
{
  "itemType": "amenity_kit",
  "salesType": "SALE",
  "name": "프리미엄 어메니티 키트",
  "description": "칫솔, 치약, 면도기 포함",
  "price": 15000,
  "totalStock": 50,
  "imageUrl": "http://localhost:8080/uploads/items/amenity.jpg",
  "isActive": true
}
```

#### 응답 예시 (HTTP 201)

```json
{
  "success": true,
  "message": "대여 물품이 등록되었습니다.",
  "data": {
    "id": 5,
    "itemType": "amenity_kit",
    "salesType": "SALE",
    "name": "프리미엄 어메니티 키트",
    "description": "칫솔, 치약, 면도기 포함",
    "price": "15000.00",
    "totalStock": 50,
    "availableStock": 50,
    "imageUrl": "http://localhost:8080/uploads/items/amenity.jpg",
    "isActive": true,
    "createdAt": "2025-04-01T00:00:00.000Z",
    "updatedAt": "2025-04-01T00:00:00.000Z"
  }
}
```

> 등록 시 `availableStock`은 `totalStock`과 동일하게 자동 설정됩니다.

#### 에러 응답

| HTTP | code | 설명 |
|------|------|------|
| 400 | - | 필수 필드 누락 (`itemType`, `salesType`, `name`, `price`, `totalStock`) |
| 400 | 4010 | `salesType`이 `SALE` 또는 `RENTAL`이 아닌 경우 |
| 400 | 4005 | `price` 또는 `totalStock`이 음수인 경우 |

---

### 5. 상품 정보 수정

부분 수정(PATCH)입니다. 보내지 않은 필드는 변경되지 않습니다.

```
PATCH /api/admin/rental-items/:id
Authorization: Bearer {accessToken}
Content-Type: application/json
```

#### Request Body (모두 선택)

| 필드 | 타입 | 설명 |
|------|------|------|
| `salesType` | string | `SALE` / `RENTAL` |
| `name` | string | 상품명 |
| `description` | string | 상품 설명 |
| `price` | number | 가격 (0 이상) |
| `totalStock` | number | 총 재고. 현재 대여 중인 수량보다 낮게 설정 불가 |
| `imageUrl` | string | 이미지 URL |
| `isActive` | boolean | 활성화 여부 |

#### 상품 활성/비활성 전환 (일시 품절 처리)

```json
{ "isActive": false }
```

```json
{ "isActive": true }
```

> `isActive: false`로 설정하면 게스트 화면에서 상품이 완전히 숨겨집니다.

#### 총 재고 변경

```json
{ "totalStock": 30 }
```

> 현재 대여 중인 수량(`rentedStock`)보다 낮게 설정하면 에러가 반환됩니다.  
> 총 재고 변경 시 `availableStock`은 자동으로 `newTotal - rentedStock`으로 재계산됩니다.

#### 요청 예시 (복합)

```json
{
  "name": "프리미엄 어메니티 키트 v2",
  "price": 18000,
  "isActive": true
}
```

#### 응답 예시 (HTTP 200)

```json
{
  "success": true,
  "message": "대여 물품 정보가 수정되었습니다.",
  "data": {
    "id": 1,
    "itemType": "amenity_kit",
    "salesType": "SALE",
    "name": "프리미엄 어메니티 키트 v2",
    "price": "18000.00",
    "totalStock": 50,
    "availableStock": 30,
    "isActive": true,
    ...
  }
}
```

#### 에러 응답

| HTTP | code | 설명 |
|------|------|------|
| 404 | 3010 | 해당 ID의 상품이 없음 |
| 400 | 4010 | `salesType`이 유효하지 않음 |
| 400 | 4005 | `price`가 음수 |
| 400 | 4006 | `totalStock`이 현재 대여 중인 수량보다 낮음 |

---

### 6. 재고 수량 수동 조정

`availableStock`(현재 이용 가능 재고)을 직접 지정합니다.  
분실, 파손 등 예외 상황에서 재고를 강제로 맞출 때 사용합니다.

```
PATCH /api/admin/rental-items/:id/stock
Authorization: Bearer {accessToken}
Content-Type: application/json
```

#### Request Body

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `availableStock` | number | ✅ | 새로운 이용 가능 수량 (0 이상, `totalStock` 이하) |

#### 요청 예시

```json
{ "availableStock": 15 }
```

#### 응답 예시 (HTTP 200)

```json
{
  "success": true,
  "message": "재고가 조정되었습니다.",
  "data": {
    "id": 1,
    "totalStock": 50,
    "availableStock": 15,
    ...
  }
}
```

#### 에러 응답

| HTTP | code | 설명 |
|------|------|------|
| 404 | 3010 | 해당 ID의 상품이 없음 |
| 400 | 4008 | `availableStock`이 음수 또는 누락 |
| 400 | 4009 | `availableStock`이 `totalStock`을 초과 |

---

### 7. 상품 삭제

```
DELETE /api/admin/rental-items/:id
Authorization: Bearer {accessToken}
```

> ⚠️ 현재 대여/판매 중인 수량(`rentedStock > 0`)이 있으면 삭제가 차단됩니다.  
> 이 경우 `isActive: false`로 비활성화하는 것을 권장합니다.

#### 응답 예시 (HTTP 200)

```json
{
  "success": true,
  "message": "대여 물품이 삭제되었습니다."
}
```

#### 에러 응답

| HTTP | code | 설명 |
|------|------|------|
| 404 | 3010 | 해당 ID의 상품이 없음 |
| 400 | 4007 | 대여 중인 수량이 있어 삭제 불가 |

---

## Enum 값 레퍼런스

### itemType

| 값 | 한글명 | salesType 기본값 |
|----|--------|-----------------|
| `hair_dryer` | 헤어드라이어 | `RENTAL` |
| `bedding_set` | 침구 세트 | `RENTAL` |
| `amenity_kit` | 어메니티 키트 | `SALE` |
| `towel_set` | 수건 세트 | `SALE` |
| `other` | 기타 | `SALE` |

### salesType

| 값 | 한글명 |
|----|--------|
| `SALE` | 판매형 |
| `RENTAL` | 대여형 |

---

## 재고 상태 계산 공식

```
rentedStock    = totalStock - availableStock   // 현재 사용 중
isOutOfStock   = availableStock === 0          // 품절 여부
```

### 예시

| totalStock | availableStock | rentedStock | isOutOfStock |
|-----------|---------------|------------|-------------|
| 50 | 30 | 20 | false |
| 20 | 0 | 20 | true ← 품절 배지 표시 |
| 10 | 10 | 0 | false |

---

## 관리자 화면 구현 가이드

### 재고 목록 테이블 권장 컬럼

```
상품명 | 카테고리 | 판매유형 | 총재고 | 사용중 | 가능수량 | 상태 | 활성여부 | 액션
```

### 상태 배지 처리

```javascript
// 품절 여부
if (item.isOutOfStock) {
  // 빨간 배지: "품절"
}

// 활성화 여부
if (!item.isActive) {
  // 회색 배지: "비활성"
} else if (item.isOutOfStock) {
  // 빨간 배지: "품절"
} else {
  // 초록 배지: "판매중"
}
```

### 총 재고 수정 주의사항

```javascript
// totalStock 수정 전 rentedStock 확인
const rentedStock = item.totalStock - item.availableStock;

if (newTotalStock < rentedStock) {
  alert(`현재 ${rentedStock}개 대여 중입니다. ${rentedStock}개 이상으로만 설정 가능합니다.`);
  return;
}
```

### 비활성화 vs 재고 조정

| 상황 | 권장 액션 |
|------|---------|
| 상품을 게스트에게 숨기고 싶을 때 | `isActive: false` |
| 일시적으로 주문을 막고 싶을 때 | `availableStock: 0` |
| 분실/파손으로 실재고와 다를 때 | `/stock` 엔드포인트로 `availableStock` 직접 조정 |
| 신규 입고로 총 재고가 늘었을 때 | `totalStock` 수정 (PATCH `/:id`) |
