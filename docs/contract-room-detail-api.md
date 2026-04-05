# 계약 시점 방 상세 조회 API

> **[변경 공지]**
> - `roomSnapshot` 키가 **`snapshot`** 으로 변경되었습니다.
> - `snapshot`에 **게스트 정보(`guest`)** 가 추가되었습니다.
> - 영향받는 API: `GET /api/contracts/guest`, `GET /api/contracts/host`, `GET /api/contracts/:contractId`

---

## 개요

계약 요청 전 게스트가 봤던 방 상세 페이지를 **계약 시점 스냅샷 기반**으로 재현합니다.

현재 방 정보가 아닌 **계약 당시 확정된 정보**를 반환하므로 호스트가 방을 수정해도 영향받지 않습니다.

> `/api/rooms/:roomId` 응답 구조와 동일하므로 기존 방 상세 컴포넌트를 **그대로 재사용** 가능합니다.

---

## Breaking Changes

### 1. `roomSnapshot` → `snapshot` 키 변경

기존 계약 관련 API 응답에서 `roomSnapshot` 키가 `snapshot`으로 변경되었습니다.

**영향 API:**
- `GET /api/contracts/guest`
- `GET /api/contracts/host`
- `GET /api/contracts/:contractId`

```js
// 변경 전
contract.roomSnapshot.roomName

// 변경 후
contract.snapshot.roomName
```

---

### 2. `snapshot`에 `guest` 필드 추가

계약 시점의 게스트 정보가 `snapshot.guest`에 저장됩니다.

```json
"snapshot": {
  "roomId": 779,
  "roomName": "강남 조용한 원룸",
  "...",
  "host": {
    "id": 42,
    "name": "김호스트",
    "nickname": "친절한호스트",
    "profileImageUrl": "...",
    "phoneVerified": true
  },
  "guest": {
    "id": 15,
    "name": "이게스트",
    "nickname": "여행자",
    "profileImageUrl": "...",
    "phoneVerified": true
  },
  "capturedAt": "2026-03-15T10:23:00.000Z"
}
```

> `host`와 `guest` 모두 계약 당시 시점 기준입니다. 이후 프로필 변경이 있어도 계약 당시 정보가 유지됩니다.

---

## 엔드포인트

```
GET /api/contracts/:contractId/room-detail
Authorization: Bearer {token}
```

### 접근 권한
계약 당사자(호스트 또는 게스트)만 조회 가능합니다.

---

## 응답 구조

```json
{
  "success": true,
  "data": {
    "id": 779,
    "roomName": "강남 조용한 원룸",
    "address": "서울시 강남구 역삼동 123",
    "detailAddress": "101호",
    "latitude": 37.4979,
    "longitude": 127.0276,
    "area": 33,
    "floor": 3,
    "buildingType": "VILLA",
    "roomCount": 1,
    "bathroomCount": 1,
    "isDuplex": false,
    "elevatorAvailable": true,
    "parkingAvailable": false,
    "parkingInfo": null,
    "maxGuests": 2,
    "description": "역삼역 도보 5분...",
    "checkInTime": "15:00",
    "checkOutTime": "11:00",

    "dailyRent": 50000,
    "dailyMaintenanceFee": 5000,
    "maintenanceDetail": "전기/수도 포함",
    "includeElectricity": true,
    "includeWater": true,
    "includeGas": false,
    "includeInternet": true,
    "cleaningFee": 30000,
    "minContractDays": 7,
    "refundPolicy": "MODERATE",
    "deposit": 300000,
    "weeklyRent": 350000,

    "longTermWeeks": 4,
    "longTermDiscount": 10,
    "quickMoveIn": true,
    "quickMoveInDiscount": 5,
    "finalDailyRent": 47500,
    "totalDiscountAmount": 75000,
    "appliedDiscounts": ["longTerm"],
    "discounts": {
      "quick": {
        "quickMoveIn": true,
        "quickMoveInDiscount": 5,
        "isApplicable": false,
        "discountAmount": 0,
        "daysUntilCheckIn": null
      },
      "longTerm": {
        "longTermWeeks": 4,
        "longTermDiscount": 10,
        "isApplicable": true,
        "discountAmount": 75000,
        "stayWeeks": 4
      }
    },

    "photos": [
      { "url": "http://localhost:8080/uploads/rooms/photo1.jpg", "order": 1 },
      { "url": "http://localhost:8080/uploads/rooms/photo2.jpg", "order": 2 }
    ],

    "amenity": {
      "basicOptions": { "wifi": true, "tv": true, "airConditioner": true },
      "additionalOptions": { "washer": true, "dryer": false },
      "convenienceOptions": { "kitchen": true, "microwave": true },
      "petsAllowed": false
    },

    "ezService": {
      "cleaningService": true
    },

    "host": {
      "id": 42,
      "name": "김호스트",
      "nickname": "친절한호스트",
      "profileImageUrl": "http://localhost:8080/uploads/profiles/host.jpg",
      "phoneVerified": true
    },

    "guest": {
      "id": 15,
      "name": "이게스트",
      "nickname": "여행자",
      "profileImageUrl": "http://localhost:8080/uploads/profiles/guest.jpg",
      "phoneVerified": true
    },

    "capturedAt": "2026-03-15T10:23:00.000Z"
  }
}
```

---

## 필드 설명

### 기본 정보

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | number | 방 ID |
| `roomName` | string | 방 이름 |
| `address` | string | 기본 주소 |
| `detailAddress` | string \| null | 상세 주소 — 결제완료 이상 상태에서만 노출 |
| `latitude` | number \| null | 위도 |
| `longitude` | number \| null | 경도 |
| `area` | number | 면적 (㎡) |
| `floor` | number | 층수 |
| `buildingType` | string | 건물 유형 |
| `checkInTime` | string | 입실 시간 (예: `"15:00"`) |
| `checkOutTime` | string | 퇴실 시간 (예: `"11:00"`) |

### 요금 정보

| 필드 | 타입 | 설명 |
|------|------|------|
| `dailyRent` | number | 1일 임대료 |
| `dailyMaintenanceFee` | number | 1일 관리비 |
| `cleaningFee` | number | 청소비 |
| `deposit` | number | 보증금 (플랫폼 고정값) |
| `weeklyRent` | number | 주간 임대료 (`dailyRent × 7`) |

### 할인 정보

| 필드 | 타입 | 설명 |
|------|------|------|
| `finalDailyRent` | number | 할인 적용 후 1일 임대료 |
| `totalDiscountAmount` | number | 총 할인 금액 |
| `appliedDiscounts` | string[] | 적용된 할인 종류 (`"quick"`, `"longTerm"`) |
| `discounts.quick.daysUntilCheckIn` | null | 계약 당시 시점 재현 불가 — 항상 `null` |

### 호스트 / 게스트 정보

| 필드 | 타입 | 설명 |
|------|------|------|
| `host.id` | number | 호스트 ID |
| `host.name` | string | 호스트 실명 |
| `host.nickname` | string | 호스트 닉네임 |
| `host.profileImageUrl` | string | 절대경로 URL |
| `host.phoneVerified` | boolean | 전화번호 인증 여부 |
| `guest.id` | number | 게스트 ID |
| `guest.name` | string | 게스트 실명 |
| `guest.nickname` | string | 게스트 닉네임 |
| `guest.profileImageUrl` | string | 절대경로 URL |
| `guest.phoneVerified` | boolean | 전화번호 인증 여부 |

> `host`, `guest` 모두 계약 시점 기준 정보입니다. 이후 프로필 변경과 무관하게 고정됩니다.

### 메타

| 필드 | 타입 | 설명 |
|------|------|------|
| `capturedAt` | string (ISO 8601) | 스냅샷 생성 시각 |

---

## 사용 시나리오

### 시나리오 1 — 계약 상세 페이지에서 "방 정보 보기"

계약 상세 페이지에 방 정보 탭 또는 모달을 구성할 때 사용합니다.

```
계약 상세 페이지 진입
→ GET /api/contracts/:contractId              계약 정보 조회
→ GET /api/contracts/:contractId/room-detail  방 상세 (탭/모달)
```

기존 `/api/rooms/:roomId` 응답과 구조가 동일하므로 **방 상세 컴포넌트를 그대로 재사용**할 수 있습니다.

---

### 시나리오 2 — `detailAddress` 조건부 노출

결제 전에는 상세 주소를 숨깁니다.

| 계약 상태 | detailAddress |
|-----------|---------------|
| `PENDING_APPROVAL` | `null` |
| `APPROVED` | `null` |
| `PAYMENT_COMPLETED` 이상 | 실제 주소 노출 |

```js
const fullAddress = data.detailAddress
  ? `${data.address} ${data.detailAddress}`
  : data.address;
```

---

### 시나리오 3 — 할인 적용 여부 판단

```js
const isLongTermApplied = data.appliedDiscounts.includes('longTerm');
const isQuickApplied    = data.appliedDiscounts.includes('quick');
```

`discounts` 객체는 계약 당시 적용된 할인 기준이며, `quick.daysUntilCheckIn`은 계약 시점 재현이 불가하여 항상 `null`입니다.

---

### 시나리오 4 — 호스트/게스트 입장별 상대방 정보 표시

```js
// 게스트가 조회 → 호스트 정보 표시
if (myId === contract.guestId) {
  showProfile(data.host);
}

// 호스트가 조회 → 게스트 정보 표시
if (myId === contract.hostId) {
  showProfile(data.guest);
}
```

---

### 시나리오 5 — 스냅샷 시점 안내 문구

`capturedAt`을 활용해 "계약 당시 정보"임을 사용자에게 안내할 수 있습니다.

```js
const capturedDate = new Date(data.capturedAt).toLocaleDateString('ko-KR');
// 예: "계약 시점(2026. 3. 15.) 기준 방 정보입니다."
```

---

## 에러 코드

| HTTP | code | 상황 |
|------|------|------|
| 401 | — | 인증 토큰 없음 |
| 403 | — | 계약 당사자(호스트/게스트)가 아님 |
| 404 | 3005 | 계약 없음 |
| 404 | 3006 | snapshot 없음 (구 데이터) |
| 500 | — | 서버 오류 |

### 3006 에러 대응

구 계약 데이터의 경우 snapshot이 없을 수 있습니다. 마이그레이션 스크립트 실행 후 재시도하세요.

```bash
node scripts/migrate-contract-room-snapshot-photos.js
```

---

## 참고

- `photos[].url`, `host.profileImageUrl`, `guest.profileImageUrl` 모두 절대경로로 반환되므로 별도 URL 처리 불필요
- `amenity`의 `basicOptions`, `additionalOptions`, `convenienceOptions`는 파싱된 객체로 반환 (문자열 아님)
- 방 정보는 계약 당시 스냅샷 기반이므로 현재 방 상태와 다를 수 있음
- 구 계약(`guest` 필드 없음)의 경우 `data.guest === null` 방어 처리 필요
