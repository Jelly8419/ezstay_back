# 청소·침구류 예약 관리 API 연동 가이드

> 대상: 관리자 프론트엔드 개발자  
> 기준일: 2026-04-01  
> Base URL: `http://localhost:8080/api/admin`  
> 인증: 모든 요청에 `Authorization: Bearer {adminToken}` 헤더 필요

---

## 개요

외부 업체에 맡겨야 하는 작업(청소, 침구류 대여·회수)을 **작업 단위로 관리**하는 기능입니다.

### 작업 타입 3종

| taskType | 설명 | 기준일 |
|---|---|---|
| `CLEANING` | 청소 서비스 | 퇴실일 |
| `BEDDING_DELIVERY` | 침구류 대여 (배달) | 입주일 |
| `BEDDING_RETRIEVAL` | 침구류 회수 | 퇴실일 |

### 상태값 4종

| status | 레이블 | 설명 |
|---|---|---|
| `PENDING` | 예약 필요 | 초기 상태, 아직 외부 업체 예약 안 됨 |
| `RESERVED` | 예약 완료 | 업체 예약 완료, 업체 정보 입력 가능 |
| `COMPLETED` | 작업 완료 | 실제 작업까지 완료 |
| `ISSUE` | 이슈 발생 | 문제 발생, 재처리 필요 |

### 상태 전환 규칙

```
PENDING    → RESERVED, COMPLETED, ISSUE
RESERVED   → COMPLETED, ISSUE
ISSUE      → RESERVED, COMPLETED
COMPLETED  → PENDING, RESERVED, ISSUE  (관리자 권한만 가능)
```

### 자동 생성 시점

서버 스케줄러(매 10분)가 아래 조건 충족 시 자동 생성합니다.
별도 수동 생성 API 없습니다.

- 계약 상태: `PAYMENT_COMPLETED` 또는 `IN_PROGRESS`
- 입주일 또는 퇴실일이 **오늘 ~ 오늘+7일** 이내
- 한 계약에 같은 타입은 1개만 생성 (중복 방지)

### 자동 삭제 시점

계약이 아래 상태로 변경되면 `PENDING` 태스크 자동 삭제:
- 게스트 취소, 호스트 취소, 관리자 강제 취소, 미승인 만료, 미결제 만료

---

## API 목록

| Method | Endpoint | 권한 | 설명 |
|---|---|---|---|
| GET | `/service-tasks` | 모든 관리자 | 목록 조회 |
| PATCH | `/service-tasks/:id/status` | super_admin, admin | 상태 변경 |

---

## 1. 목록 조회

### `GET /api/admin/service-tasks`

#### Query Parameters

| 파라미터 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `tab` | string | - | `pending`: 예약 필요 탭 (status=PENDING 자동 필터) / `all`: 전체 |
| `task_type` | string | - | `CLEANING` \| `BEDDING_DELIVERY` \| `BEDDING_RETRIEVAL` |
| `status` | string | - | `PENDING` \| `RESERVED` \| `COMPLETED` \| `ISSUE` |
| `date_from` | string | - | 기준일 시작 `YYYY-MM-DD` |
| `date_to` | string | - | 기준일 종료 `YYYY-MM-DD` |
| `page` | number | - | 페이지 번호 (기본: 1) |
| `limit` | number | - | 페이지당 건수 (기본: 20) |

> `tab=pending`과 `status`를 동시에 전달하면 `tab`이 우선됩니다.

#### 요청 예시

```
# 예약 필요 탭
GET /api/admin/service-tasks?tab=pending

# 전체 탭 (청소만)
GET /api/admin/service-tasks?tab=all&task_type=CLEANING

# 날짜 범위 필터
GET /api/admin/service-tasks?date_from=2026-04-01&date_to=2026-04-07

# 페이징
GET /api/admin/service-tasks?tab=pending&page=2&limit=10
```

#### 응답

```json
{
  "success": true,
  "data": {
    "total": 42,
    "page": 1,
    "limit": 20,
    "items": [
      {
        "id": 1,
        "contractId": 100,
        "roomName": "강남 원룸 A호",
        "taskType": "CLEANING",
        "referenceDate": "2026-04-05",
        "dDay": -4,
        "quantity": null,
        "status": "PENDING",
        "vendorName": null,
        "vendorContact": null,
        "vendorRefNo": null,
        "createdAt": "2026-03-29T10:00:00.000Z",
        "updatedAt": "2026-03-29T10:00:00.000Z"
      },
      {
        "id": 2,
        "contractId": 100,
        "roomName": "강남 원룸 A호",
        "taskType": "BEDDING_DELIVERY",
        "referenceDate": "2026-04-03",
        "dDay": -2,
        "quantity": 2,
        "status": "RESERVED",
        "vendorName": "침구나라",
        "vendorContact": "홍길동",
        "vendorRefNo": "BED-2026-0401",
        "createdAt": "2026-03-29T10:00:00.000Z",
        "updatedAt": "2026-04-01T09:00:00.000Z"
      }
    ]
  }
}
```

#### `dDay` 해석

| 값 | 의미 | 표시 예 |
|---|---|---|
| 양수 (예: `3`) | 3일 남음 | **D-3** |
| `0` | 오늘 | **D-day** |
| 음수 (예: `-2`) | 2일 지남 | **D+2** (초과) |

> **프론트 권장**: `dDay <= 3`이면 임박 강조 표시 (빨간색 등)

---

## 2. 상태 변경

### `PATCH /api/admin/service-tasks/:id/status`

권한: `super_admin`, `admin`

#### Request Body

```json
{
  "status": "RESERVED",
  "vendorName": "청소나라",
  "vendorContact": "김철수",
  "vendorRefNo": "CLN-2026-0401"
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `status` | string | **필수** | 변경할 상태값 |
| `vendorName` | string | 선택 | 업체명 (`RESERVED` 상태로 변경 시 함께 저장) |
| `vendorContact` | string | 선택 | 담당자 이름 또는 연락처 |
| `vendorRefNo` | string | 선택 | 외부 업체 예약번호 |

> 업체 정보는 `RESERVED` 상태일 때만 저장됩니다.  
> `vendorName` 등을 전달하지 않으면 기존 값 유지됩니다.

#### 응답 (성공)

```json
{
  "success": true,
  "data": {
    "id": 1,
    "status": "RESERVED",
    "vendorName": "청소나라",
    "vendorContact": "김철수",
    "vendorRefNo": "CLN-2026-0401",
    "updatedAt": "2026-04-01T11:30:00.000Z"
  }
}
```

#### 응답 (실패 - 잘못된 상태 전환)

```http
HTTP 400
```
```json
{
  "success": false,
  "error": {
    "message": "COMPLETED → PENDING 전환은 허용되지 않습니다."
  }
}
```

---

## 화면 구성 가이드

### 탭 구성

```
[예약 필요]  [전체 이행 현황]
```

- **예약 필요 탭**: `?tab=pending` — 가장 중요, 기본 진입 탭 권장
- **전체 이행 현황 탭**: `?tab=all` — 상태 필터/날짜 필터 제공

### 리스트 컬럼 구성 (권장)

| 컬럼 | 필드 | 비고 |
|---|---|---|
| 계약 ID | `contractId` | 계약 상세 링크 |
| 방 이름 | `roomName` | |
| 타입 | `taskType` | 레이블 변환 (아래 참조) |
| 기준일 | `referenceDate` | `YYYY-MM-DD` |
| D-day | `dDay` 계산값 | D-3 이하 강조 표시 |
| 수량 | `quantity` | CLEANING은 `-` 표시 |
| 상태 | `status` | 배지/칩 형태 |
| 업체명 | `vendorName` | 없으면 `-` |
| 담당자 | `vendorContact` | 없으면 `-` |
| 예약번호 | `vendorRefNo` | 없으면 `-` |
| 액션 | - | 상태 변경 버튼 |

### 타입 레이블 변환

```javascript
const TASK_TYPE_LABELS = {
  CLEANING: '청소',
  BEDDING_DELIVERY: '침구 대여',
  BEDDING_RETRIEVAL: '침구 회수'
};
```

### 상태 레이블 및 색상 (권장)

```javascript
const STATUS_CONFIG = {
  PENDING:   { label: '예약 필요', color: 'red'    },
  RESERVED:  { label: '예약 완료', color: 'blue'   },
  COMPLETED: { label: '작업 완료', color: 'green'  },
  ISSUE:     { label: '이슈 발생', color: 'orange' }
};
```

### D-day 표시 로직

```javascript
function formatDDay(dDay) {
  if (dDay > 0) return `D-${dDay}`;
  if (dDay === 0) return 'D-day';
  return `D+${Math.abs(dDay)}`; // 초과
}

function isDayUrgent(dDay) {
  return dDay <= 3; // 3일 이하 임박
}
```

---

## 사용 시나리오

### 시나리오 1: 예약 필요 탭 확인 → 업체 예약 후 상태 변경

1. `GET /service-tasks?tab=pending` 로 예약 필요 목록 조회
2. D-3 이하 임박 건 확인 (강조 표시)
3. 외부 업체에 전화/앱으로 예약
4. `PATCH /service-tasks/1/status` 호출
   ```json
   {
     "status": "RESERVED",
     "vendorName": "청소나라",
     "vendorContact": "김철수",
     "vendorRefNo": "CLN-2026-0401"
   }
   ```
5. 목록에서 해당 row가 `RESERVED`로 변경됨

---

### 시나리오 2: 작업 완료 처리

1. 업체로부터 작업 완료 연락 수신
2. `PATCH /service-tasks/1/status`
   ```json
   { "status": "COMPLETED" }
   ```

---

### 시나리오 3: 이슈 발생 → 재처리

1. 업체 사정으로 방문 불가 → `ISSUE`로 변경
   ```json
   { "status": "ISSUE" }
   ```
2. 다른 업체 재예약 → `RESERVED`로 변경하며 업체 정보 갱신
   ```json
   {
     "status": "RESERVED",
     "vendorName": "새청소업체",
     "vendorContact": "이영희",
     "vendorRefNo": "NEW-2026-0402"
   }
   ```

---

### 시나리오 4: 한 계약에 여러 타입 존재

계약 #100이 청소 서비스 + 침구 2세트 주문인 경우:

```
계약 #100  강남 원룸 A호
  ├─ CLEANING         퇴실일 2026-04-10  D-9   PENDING
  ├─ BEDDING_DELIVERY 입주일 2026-04-05  D-4   PENDING  수량: 2
  └─ BEDDING_RETRIEVAL 퇴실일 2026-04-10 D-9   PENDING  수량: 2
```

각 row는 독립적으로 상태 관리합니다.

---

## 에러 코드

| HTTP | 상황 |
|---|---|
| `400` | 필수 파라미터 누락, 유효하지 않은 status, 허용되지 않는 상태 전환 |
| `403` | 권한 없음 (PATCH는 super_admin, admin만 가능) |
| `404` | 해당 서비스 태스크 없음 |
| `500` | 서버 내부 오류 |
