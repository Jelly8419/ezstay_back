# 관리자 API 문서

> **작성일**: 2025-10-27
> **최종 갱신일**: 2026-02-09
> **버전**: 4.0.0 (결제 관리, 정산 관리 API 추가)
> **베이스 URL**: `http://localhost:3000/api/admin`

---

## 📋 목차

1. [인증](#인증)
2. [관리자 인증 API](#관리자-인증-api)
3. [대시보드 API](#대시보드-api)
4. [유저 관리 API](#유저-관리-api)
5. [매물 관리 API](#매물-관리-api)
6. [예약 관리 API](#예약-관리-api)
7. [방 정보 관리 API](#방-정보-관리-api)
8. [액션 로그 API](#액션-로그-api) 🆕
9. [고객센터 - 공지사항 API](#고객센터---공지사항-api) 🆕
10. [고객센터 - FAQ API](#고객센터---faq-api) 🆕
11. [고객센터 - 문의 관리 API](#고객센터---문의-관리-api) 🆕
12. [환불 관리 API](#환불-관리-api)
13. [렌탈 주문 관리 API](#렌탈-주문-관리-api)
14. [결제 관리 API](#결제-관리-api) 🆕
15. [정산 관리 API](#정산-관리-api) 🆕
16. [에러 코드](#에러-코드)

---

## 🔐 인증

### 중요 변경사항 (v2.0.0)
관리자는 일반 유저(User 테이블)와 **완전히 분리된 Admin 테이블**에서 관리됩니다.

### 인증 흐름
1. 관리자 전용 로그인: `POST /api/admin/auth/login`
2. 발급받은 JWT 토큰으로 API 호출
3. 모든 관리자 API는 `Admin` 테이블 기반 인증

### 헤더 요구사항
```http
Authorization: Bearer <access_token>
```

### 권한 레벨
- **super_admin**: 최고 관리자 (모든 권한)
- **admin**: 일반 관리자 (대부분의 관리 권한)
- **cs_admin**: 고객센터 관리자 (제한적 권한)

### Admin 테이블 구조
```javascript
{
  id: number,
  username: string (UNIQUE),    // 로그인 ID
  password: string (bcrypt),
  name: string,
  phoneNumber: string | null,
  role: 'super_admin' | 'admin' | 'cs_admin',
  isActive: boolean,
  lastLoginAt: Date | null,
  refreshToken: string | null
}
```

### 미들웨어 적용 순서
```
POST /auth/login → adminAuthLimiter (Rate Limit)
↓ (이후 모든 라우트)
authenticateAdmin → adminApiLimiter → actionLogger → 각 핸들러
```

### Rate Limiting
- **관리자 로그인**: 15분당 10회
- **관리자 일반 API**: 15분당 300회

### 액션 로깅
POST, PATCH, PUT, DELETE 요청은 자동으로 `admin_action_logs` 테이블에 기록됩니다.

---

## 🔑 관리자 인증 API

### 1. 관리자 로그인

```
POST /api/admin/auth/login
```

> 인증 불필요

**Request Body:**
```json
{
  "username": "admin@ezstay.com",
  "password": "yourPassword123"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "admin": {
      "id": 1,
      "username": "admin@ezstay.com",
      "name": "관리자",
      "role": "super_admin",
      "lastLoginAt": "2026-02-09T10:00:00.000Z"
    },
    "tokens": {
      "accessToken": "eyJhbGciOiJIUzI1NiIs...",
      "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
    }
  },
  "message": "로그인 성공"
}
```

**Error Cases:**
| Status | Code | Message |
|--------|------|---------|
| 400 | 4001 | 아이디와 비밀번호를 입력해주세요 |
| 401 | 1001 | 아이디 또는 비밀번호가 일치하지 않습니다 |
| 403 | 2001 | 비활성화된 계정입니다 |

---

### 2. 관리자 로그아웃

```
POST /api/admin/auth/logout
```

> 🔒 관리자 인증 필요

**Response (200):**
```json
{
  "success": true,
  "message": "로그아웃 성공"
}
```

---

### 3. 내 정보 조회

```
GET /api/admin/auth/me
```

> 🔒 관리자 인증 필요

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "username": "admin@ezstay.com",
    "name": "관리자",
    "phoneNumber": "010-1234-5678",
    "role": "super_admin",
    "isActive": true,
    "lastLoginAt": "2026-02-09T10:00:00.000Z",
    "createdAt": "2025-10-01T00:00:00.000Z"
  },
  "message": "관리자 정보 조회 성공"
}
```

---

## 📊 대시보드 API

### 1. 대시보드 통계

```
GET /api/admin/dashboard/stats
```

> 🔒 관리자 인증 필요

**Response (200):**
```json
{
  "success": true,
  "data": {
    "totalUsers": 150,
    "totalProperties": 45,
    "activeReservations": 23,
    "monthlyRevenue": 15000000,
    "pendingReviews": 3,
    "pendingInquiries": 7,
    "trends": {
      "user": { "value": 12.5, "isPositive": true },
      "property": { "value": 5.3, "isPositive": true },
      "reservation": { "value": -2.1, "isPositive": false },
      "revenue": { "value": 8.7, "isPositive": true }
    }
  },
  "message": "대시보드 통계 조회 성공"
}
```

**필드 설명:**
| 필드 | 설명 |
|------|------|
| `totalUsers` | 활성 사용자 수 |
| `totalProperties` | published 상태 매물 수 |
| `activeReservations` | PAYMENT_COMPLETED + IN_PROGRESS 예약 수 |
| `monthlyRevenue` | 이번 달 매출 (결제 완료 기준) |
| `pendingReviews` | pending_review 상태 매물 수 |
| `pendingInquiries` | pending 상태 문의 수 |
| `trends.*.value` | 전월 대비 증감률 (%) |

---

### 2. 최근 활동

```
GET /api/admin/dashboard/recent-activities
```

> 🔒 관리자 인증 필요

**Response (200):**
```json
{
  "success": true,
  "data": {
    "recentReservations": [
      {
        "id": 1,
        "status": "PAYMENT_COMPLETED",
        "guest": { "id": 10, "name": "홍길동", "nickname": "길동이", "email": "hong@test.com" },
        "room": { "id": 5, "roomName": "강남 원룸", "address": "서울시 강남구..." },
        "createdAt": "2026-02-08T14:30:00.000Z"
      }
    ],
    "recentInquiries": []
  },
  "message": "최근 활동 조회 성공"
}
```

---

## 👥 유저 관리 API

### 1. 유저 목록

```
GET /api/admin/users
```

> 🔒 관리자 인증 필요

**Query Parameters:**
| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `page` | number | 1 | 페이지 번호 |
| `limit` | number | 20 | 페이지당 항목 수 |
| `search` | string | '' | 검색어 (이메일, 이름, 닉네임, 전화번호) |
| `userType` | string | '' | 필터: 'local', 'social' |
| `isActive` | string | '' | 필터: 'true', 'false' |
| `sortBy` | string | 'createdAt' | 정렬 기준 |
| `sortOrder` | string | 'DESC' | 정렬 순서: 'ASC', 'DESC' |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "users": [
      {
        "id": 1,
        "email": "user@test.com",
        "name": "홍길동",
        "nickname": "길동이",
        "phoneNumber": "010-1234-5678",
        "userType": "local",
        "isActive": true,
        "role": "host",
        "createdAt": "2025-10-01T00:00:00.000Z"
      }
    ],
    "pagination": {
      "total": 150,
      "page": 1,
      "limit": 20,
      "totalPages": 8
    }
  },
  "message": "유저 목록 조회 성공"
}
```

---

### 2. 유저 상세

```
GET /api/admin/users/:userId
```

> 🔒 관리자 인증 필요

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "email": "user@test.com",
    "name": "홍길동",
    "nickname": "길동이",
    "phoneNumber": "010-1234-5678",
    "userType": "local",
    "isActive": true,
    "role": "host",
    "accountTypeDetail": {
      "type": "email",
      "emailVerified": true,
      "failedLoginAttempts": 0,
      "isLocked": false
    },
    "bankAccounts": [
      {
        "id": 1,
        "bankName": "국민은행",
        "accountNumber": "123-456-7890",
        "accountHolder": "홍길동",
        "isPrimary": true,
        "isVerified": true,
        "verifiedAt": "2025-10-05T00:00:00.000Z"
      }
    ],
    "hasVerifiedBankAccount": true,
    "hostRoomsCount": 3,
    "guestReservationsCount": 5
  },
  "message": "유저 상세 조회 성공"
}
```

**accountTypeDetail 분기:**
- `type: "email"` → `emailVerified`, `failedLoginAttempts`, `isLocked`
- `type: "social"` → `providers: [{ provider, providerEmail, connectedAt }]`

---

### 3. 유저 상태 변경

```
PATCH /api/admin/users/:userId/status
```

> 🔒 super_admin, admin만 가능

**Request Body:**
```json
{
  "isActive": false
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "isActive": false
  },
  "message": "유저 상태 변경 완료"
}
```

---

## 🏠 매물 관리 API

### 1. 매물 목록

```
GET /api/admin/properties
```

> 🔒 관리자 인증 필요

**Query Parameters:**
| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `page` | number | 1 | 페이지 번호 |
| `limit` | number | 20 | 페이지당 항목 수 |
| `search` | string | '' | 검색어 (방 이름, 주소) |
| `status` | string | '' | 필터: 'draft', 'pending_review', 'approved', 'published', 'rejected', 'hidden_by_admin' |
| `sortBy` | string | 'createdAt' | 정렬 기준 |
| `sortOrder` | string | 'DESC' | 정렬 순서 |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "properties": [
      {
        "id": 1,
        "roomName": "강남 원룸",
        "address": "서울시 강남구...",
        "status": "published",
        "dailyRent": 50000,
        "host": {
          "id": 10,
          "name": "김호스트",
          "nickname": "호스트님",
          "email": "host@test.com",
          "phoneNumber": "010-9876-5432"
        },
        "photos": [
          { "id": 1, "url": "/uploads/rooms/photo1.jpg" }
        ],
        "createdAt": "2025-11-01T00:00:00.000Z"
      }
    ],
    "pagination": {
      "total": 45,
      "page": 1,
      "limit": 20,
      "totalPages": 3
    }
  },
  "message": "매물 목록 조회 성공"
}
```

---

### 2. 심사 대기 매물

```
GET /api/admin/properties/pending-review
```

> 🔒 관리자 인증 필요

**Query Parameters:**
| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `page` | number | 1 | 페이지 번호 |
| `limit` | number | 20 | 페이지당 항목 수 |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "properties": [
      {
        "id": 5,
        "roomName": "홍대 투룸",
        "status": "pending_review",
        "submittedAt": "2026-02-07T10:00:00.000Z",
        "host": { "id": 15, "name": "...", "email": "..." },
        "photos": [
          { "id": 10, "url": "/uploads/rooms/photo10.jpg", "order": 1 }
        ]
      }
    ],
    "pagination": { "total": 3, "page": 1, "limit": 20, "totalPages": 1 }
  },
  "message": "심사 대기 매물 조회 성공"
}
```

---

### 3. 매물 상세 (심사용)

```
GET /api/admin/properties/:roomId
```

> 🔒 관리자 인증 필요

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": 5,
    "roomName": "홍대 투룸",
    "address": "서울시 마포구...",
    "detailAddress": "101호",
    "latitude": 37.5563,
    "longitude": 126.9239,
    "area": 33.5,
    "floor": 3,
    "buildingType": "원룸",
    "parkingAvailable": true,
    "parkingInfo": "건물 지하 주차장",
    "elevatorAvailable": true,
    "roomCount": 1,
    "bathroomCount": 1,
    "isDuplex": false,
    "entrancePassword": "1234",

    "dailyRent": 50000,
    "dailyMaintenanceFee": 5000,
    "longTermWeeks": 4,
    "longTermDiscount": 10,
    "quickMoveIn": true,
    "quickMoveInDiscount": 5,
    "maintenanceDetail": "인터넷, 수도 포함",
    "includeElectricity": false,
    "includeWater": true,
    "includeGas": false,
    "includeInternet": true,
    "cleaningFee": 30000,
    "minContractWeeks": 1,
    "refundPolicy": "flexible",

    "photos": [
      { "id": 10, "url": "/uploads/rooms/photo10.jpg", "order": 1 }
    ],
    "amenities": {
      "basicOptions": ["에어컨", "냉장고"],
      "additionalOptions": ["세탁기"],
      "convenienceOptions": ["와이파이"],
      "petsAllowed": false
    },
    "ezService": {
      "cleaningService": true,
      "autoPasswordChange": false,
      "roomPassword": null
    },
    "description": "깨끗한 원룸입니다.",
    "maxGuests": 2,

    "status": "pending_review",
    "submittedAt": "2026-02-07T10:00:00.000Z",
    "approvedAt": null,
    "publishedAt": null,
    "rejectionReason": null,
    "createdAt": "2026-02-01T00:00:00.000Z",

    "host": {
      "id": 15,
      "name": "김호스트",
      "email": "host@test.com",
      "phoneNumber": "010-9876-5432",
      "phoneVerified": true,
      "hasBankAccount": true
    },
    "registrationProgress": {
      "totalSteps": 7,
      "completedSteps": 7,
      "percentage": 100,
      "steps": {}
    }
  },
  "message": "매물 상세 조회 성공"
}
```

---

### 4. 매물 승인

```
POST /api/admin/properties/:roomId/approve
```

> 🔒 super_admin, admin만 가능

**Request Body:** 없음

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": 5,
    "status": "approved",
    "approvedAt": "2026-02-09T10:00:00.000Z"
  },
  "message": "매물 승인 완료"
}
```

**Error Cases:**
| Status | Code | Message |
|--------|------|---------|
| 404 | 3002 | 방을 찾을 수 없습니다 |
| 400 | 4301 | 심사 대기 중인 매물만 승인할 수 있습니다 |

---

### 5. 매물 반려

```
POST /api/admin/properties/:roomId/reject
```

> 🔒 super_admin, admin만 가능

**Request Body:**
```json
{
  "rejectionReason": "사진 품질이 기준에 미달합니다."
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": 5,
    "status": "rejected",
    "rejectionReason": "사진 품질이 기준에 미달합니다."
  },
  "message": "매물 반려 완료"
}
```

**Error Cases:**
| Status | Code | Message |
|--------|------|---------|
| 400 | 4000 | 필수 입력값이 누락되었습니다 (rejectionReason) |
| 404 | 3002 | 방을 찾을 수 없습니다 |
| 400 | 4302 | 심사 대기 중인 매물만 반려할 수 있습니다 |

---

## 📅 예약 관리 API

### 1. 예약 목록

```
GET /api/admin/reservations
```

> 🔒 관리자 인증 필요

**Query Parameters:**
| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `page` | number | 1 | 페이지 번호 |
| `limit` | number | 20 | 페이지당 항목 수 |
| `status` | string | '' | 필터: 'PENDING_APPROVAL', 'APPROVED', 'PAYMENT_COMPLETED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED' |
| `search` | string | '' | 게스트 이름/이메일 검색 |
| `sortBy` | string | 'createdAt' | 정렬 기준 |
| `sortOrder` | string | 'DESC' | 정렬 순서 |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "reservations": [
      {
        "id": 1,
        "orderId": "ORD-20260208-001",
        "status": "IN_PROGRESS",
        "checkInDate": "2026-02-01",
        "checkOutDate": "2026-02-15",
        "totalAmount": 700000,
        "guest": { "id": 10, "name": "홍길동", "nickname": "길동이", "email": "hong@test.com", "phoneNumber": "010-1234-5678" },
        "host": { "id": 15, "name": "김호스트", "nickname": "호스트님", "email": "host@test.com" },
        "room": { "id": 5, "roomName": "강남 원룸", "address": "서울시 강남구..." },
        "createdAt": "2026-01-25T10:00:00.000Z"
      }
    ],
    "pagination": {
      "total": 23,
      "page": 1,
      "limit": 20,
      "totalPages": 2
    }
  },
  "message": "예약 목록 조회 성공"
}
```

---

### 2. 예약 상세

```
GET /api/admin/reservations/:contractId
```

> 🔒 관리자 인증 필요

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "orderId": "ORD-20260208-001",
    "status": "IN_PROGRESS",
    "checkInDate": "2026-02-01",
    "checkOutDate": "2026-02-15",
    "totalDays": 14,
    "rentalFee": 700000,
    "maintenanceFee": 70000,
    "cleaningFee": 30000,
    "platformFee": 79200,
    "finalTotalAmount": 879200,
    "paidAt": "2026-01-26T14:30:00.000Z",
    "guest": {
      "id": 10,
      "name": "홍길동",
      "email": "hong@test.com",
      "phoneNumber": "010-1234-5678"
    },
    "host": {
      "id": 15,
      "name": "김호스트",
      "email": "host@test.com"
    },
    "room": {
      "id": 5,
      "roomName": "강남 원룸",
      "photos": [{ "id": 10, "url": "/uploads/rooms/photo10.jpg", "order": 1 }]
    }
  },
  "message": "예약 상세 조회 성공"
}
```

---

## 🏗️ 방 정보 관리 API

### 1. 방 관리 상세 (메모, 계약 포함)

```
GET /api/admin/properties/:roomId/management
```

> 🔒 관리자 인증 필요

**Response (200):**
```json
{
  "success": true,
  "data": {
    "roomInfo": {
      "id": 5,
      "roomName": "강남 원룸",
      "status": "published",
      "entrancePassword": "1234",
      "address": "서울시 강남구...",
      "detailAddress": "101호",
      "dailyRent": 50000,
      "createdAt": "2025-11-01T00:00:00.000Z",
      "updatedAt": "2026-02-08T10:00:00.000Z"
    },
    "hostInfo": {
      "id": 15,
      "name": "김호스트",
      "email": "host@test.com",
      "phoneNumber": "010-9876-5432"
    },
    "contracts": [
      {
        "id": 1,
        "guestName": "홍길동",
        "guestPhone": "010-1234-5678",
        "checkInDate": "2026-02-01",
        "checkOutDate": "2026-02-15",
        "status": "IN_PROGRESS",
        "totalAmount": 700000,
        "createdAt": "2026-01-25T10:00:00.000Z"
      }
    ],
    "memos": [
      {
        "id": 1,
        "content": "청소 상태 점검 필요",
        "createdBy": "관리자",
        "createdAt": "2026-02-05T10:00:00.000Z",
        "updatedAt": "2026-02-05T10:00:00.000Z"
      }
    ]
  },
  "message": "방 상세 정보 조회 완료"
}
```

---

### 2. 방 상태 변경

```
PATCH /api/admin/properties/:roomId/status
```

> 🔒 super_admin, admin만 가능

**Request Body:**
```json
{
  "status": "hidden_by_admin",
  "reason": "관리자 판단에 의한 비공개 처리"
}
```

허용 상태값: `published`, `hidden_by_admin`

**Response (200):**
```json
{
  "success": true,
  "data": {
    "roomId": 5,
    "previousStatus": "published",
    "newStatus": "hidden_by_admin",
    "reason": "관리자 판단에 의한 비공개 처리"
  },
  "message": "방 상태 변경 완료"
}
```

---

### 3. 방 상태 변경 이력

```
GET /api/admin/properties/:roomId/status-history
```

> 🔒 super_admin, admin만 가능

**Query Parameters:**
| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `limit` | number | 20 | 최대 50 |
| `offset` | number | 0 | 오프셋 |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "total": 5,
    "histories": [
      {
        "id": 1,
        "previousStatus": "published",
        "newStatus": "hidden_by_admin",
        "reason": "관리자 판단에 의한 비공개 처리",
        "changedBy": "관리자",
        "changedAt": "2026-02-08T10:00:00.000Z",
        "ipAddress": "192.168.1.1",
        "userAgent": "Mozilla/5.0..."
      }
    ],
    "pagination": {
      "limit": 20,
      "offset": 0,
      "hasMore": false
    }
  },
  "message": "상태 변경 이력 조회 완료"
}
```

> ⚠️ `ipAddress`, `userAgent`는 **super_admin**만 볼 수 있습니다.

---

### 4. 방 비밀번호 변경

```
PATCH /api/admin/properties/:roomId/password
```

> 🔒 super_admin, admin만 가능

**Request Body:**
```json
{
  "newPassword": "*1234#",
  "reason": "게스트 체크아웃 후 변경"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "roomId": 5,
    "previousPassword": "1234",
    "newPassword": "*1234#",
    "changedAt": "2026-02-09T10:00:00.000Z",
    "reason": "게스트 체크아웃 후 변경"
  },
  "message": "방 비밀번호 변경 완료"
}
```

**Error Cases:**
| Status | Code | Message |
|--------|------|---------|
| 400 | 4003 | 새 비밀번호를 입력해주세요 |
| 400 | 4004 | 비밀번호는 4~50자 이내로 입력해주세요 |
| 404 | 3002 | 방을 찾을 수 없습니다 |

---

### 5. 방 비밀번호 변경 이력

```
GET /api/admin/properties/:roomId/password-history
```

> 🔒 super_admin, admin만 가능

**Query Parameters:**
| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `limit` | number | 10 | 최대 50 |
| `offset` | number | 0 | 오프셋 |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "total": 3,
    "histories": [
      {
        "id": 1,
        "previousPassword": "1234",
        "newPassword": "*1234#",
        "reason": "게스트 체크아웃 후 변경",
        "changedBy": "관리자",
        "changedAt": "2026-02-09T10:00:00.000Z",
        "ipAddress": "192.168.1.1",
        "userAgent": "Mozilla/5.0..."
      }
    ],
    "pagination": {
      "limit": 10,
      "offset": 0,
      "hasMore": false
    }
  },
  "message": "비밀번호 변경 이력 조회 완료"
}
```

> ⚠️ `ipAddress`, `userAgent`는 **super_admin**만 볼 수 있습니다.

---

### 6. 메모 생성

```
POST /api/admin/properties/:roomId/memos
```

> 🔒 관리자 인증 필요

**Request Body:**
```json
{
  "content": "청소 상태 점검 필요"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "content": "청소 상태 점검 필요",
    "createdBy": "관리자",
    "createdAt": "2026-02-09T10:00:00.000Z"
  },
  "message": "메모 생성 완료"
}
```

---

### 7. 메모 수정

```
PATCH /api/admin/properties/:roomId/memos/:memoId
```

> 🔒 관리자 인증 필요

**Request Body:**
```json
{
  "content": "청소 상태 점검 완료 - 이상 없음"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "content": "청소 상태 점검 완료 - 이상 없음",
    "createdBy": "관리자",
    "updatedAt": "2026-02-09T11:00:00.000Z"
  },
  "message": "메모 수정 완료"
}
```

---

### 8. 메모 삭제

```
DELETE /api/admin/properties/:roomId/memos/:memoId
```

> 🔒 관리자 인증 필요

**Response (200):**
```json
{
  "success": true,
  "data": { "id": "1" },
  "message": "메모 삭제 완료"
}
```

---

## 📝 액션 로그 API

> 🔒 **super_admin만** 접근 가능

### 1. 액션 로그 목록

```
GET /api/admin/action-logs
```

**Query Parameters:**
| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `page` | number | 1 | 페이지 번호 |
| `limit` | number | 50 | 페이지당 항목 수 |
| `adminId` | number | - | 관리자 ID로 필터 |
| `actionType` | string | - | 액션 타입: 'CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'ACTIVATE', 'DEACTIVATE', 'SUSPEND', 'EXPORT' |
| `resourceType` | string | - | 리소스 타입: 'USER', 'PROPERTY', 'RESERVATION', 'PAYMENT', 'SETTLEMENT', 'INQUIRY', 'NOTIFICATION', 'ADMIN', 'SYSTEM' |
| `startDate` | string | - | 시작일 (ISO 8601) |
| `endDate` | string | - | 종료일 (ISO 8601) |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "logs": [
      {
        "id": 1,
        "adminId": 1,
        "adminEmail": "admin@ezstay.com",
        "adminName": "관리자",
        "actionType": "APPROVE",
        "resourceType": "PROPERTY",
        "resourceId": "5",
        "method": "POST",
        "endpoint": "/api/admin/properties/5/approve",
        "requestBody": {},
        "responseStatus": 200,
        "ipAddress": "192.168.1.1",
        "userAgent": "Mozilla/5.0...",
        "description": "관리자님이 PROPERTY #5을(를) 승인했습니다.",
        "createdAt": "2026-02-09T10:00:00.000Z",
        "admin": {
          "id": 1,
          "username": "admin@ezstay.com",
          "name": "관리자",
          "role": "super_admin"
        }
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 50,
      "total": 120,
      "totalPages": 3
    }
  },
  "message": "액션 로그 조회 성공"
}
```

---

### 2. 액션 로그 통계

```
GET /api/admin/action-logs/stats
```

**Query Parameters:**
| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `startDate` | string | - | 시작일 (ISO 8601) |
| `endDate` | string | - | 종료일 (ISO 8601) |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "totalLogs": 520,
    "actionTypeStats": [
      { "actionType": "UPDATE", "count": 200 },
      { "actionType": "CREATE", "count": 150 },
      { "actionType": "APPROVE", "count": 100 },
      { "actionType": "DELETE", "count": 70 }
    ],
    "resourceTypeStats": [
      { "resourceType": "PROPERTY", "count": 180 },
      { "resourceType": "USER", "count": 150 },
      { "resourceType": "RESERVATION", "count": 120 }
    ],
    "adminActivityStats": [
      {
        "adminId": 1,
        "adminName": "관리자",
        "adminEmail": "admin@ezstay.com",
        "count": 300
      }
    ]
  },
  "message": "액션 로그 통계 조회 성공"
}
```

---

### 3. 액션 로그 상세

```
GET /api/admin/action-logs/:id
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "adminId": 1,
    "adminEmail": "admin@ezstay.com",
    "adminName": "관리자",
    "actionType": "APPROVE",
    "resourceType": "PROPERTY",
    "resourceId": "5",
    "method": "POST",
    "endpoint": "/api/admin/properties/5/approve",
    "requestBody": {},
    "responseStatus": 200,
    "ipAddress": "192.168.1.1",
    "userAgent": "Mozilla/5.0...",
    "description": "관리자님이 PROPERTY #5을(를) 승인했습니다.",
    "createdAt": "2026-02-09T10:00:00.000Z",
    "admin": {
      "id": 1,
      "username": "admin@ezstay.com",
      "name": "관리자",
      "role": "super_admin"
    }
  },
  "message": "액션 로그 상세 조회 성공"
}
```

---

## 📢 고객센터 - 공지사항 API

### 1. 공지사항 목록 (관리자용)

```
GET /api/admin/support/notices
```

> 🔒 관리자 인증 필요

**Query Parameters:**
| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `page` | number | 1 | 페이지 번호 |
| `limit` | number | 20 | 페이지당 항목 수 |
| `status` | string | - | 필터: 'draft', 'published', 'archived' |
| `userType` | string | - | 필터: 'all', 'host', 'guest' |
| `search` | string | - | 제목/내용 검색 |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "notices": [
      {
        "id": 1,
        "title": "서비스 점검 안내",
        "status": "published",
        "userType": "all",
        "isImportant": true,
        "author": {
          "id": 1,
          "username": "admin@ezstay.com",
          "name": "관리자"
        },
        "editor": null,
        "createdAt": "2026-02-01T00:00:00.000Z",
        "updatedAt": "2026-02-01T00:00:00.000Z"
      }
    ],
    "pagination": {
      "total": 15,
      "page": 1,
      "limit": 20,
      "totalPages": 1
    }
  },
  "message": "공지사항 목록을 조회했습니다."
}
```

---

### 2. 공지사항 상세 (관리자용)

```
GET /api/admin/support/notices/:id
```

> 🔒 관리자 인증 필요

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "title": "서비스 점검 안내",
    "content": "2월 10일 새벽 2시~4시 서버 점검이 예정되어 있습니다.",
    "status": "published",
    "userType": "all",
    "isImportant": true,
    "publishedAt": "2026-02-01T10:00:00.000Z",
    "expiresAt": null,
    "viewCount": 120,
    "author": { "id": 1, "username": "admin@ezstay.com", "name": "관리자" },
    "editor": null,
    "createdAt": "2026-02-01T00:00:00.000Z",
    "updatedAt": "2026-02-01T00:00:00.000Z"
  },
  "message": "공지사항을 조회했습니다."
}
```

---

### 3. 공지사항 생성

```
POST /api/admin/support/notices
```

> 🔒 관리자 인증 필요

**Request Body:**
```json
{
  "title": "서비스 점검 안내",
  "content": "2월 10일 새벽 2시~4시 서버 점검이 예정되어 있습니다.",
  "isImportant": true,
  "userType": "all",
  "publishedAt": "2026-02-01T10:00:00.000Z",
  "expiresAt": null,
  "status": "draft"
}
```

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `title` | string | ✅ | - | 제목 |
| `content` | string | ✅ | - | 내용 |
| `isImportant` | boolean | - | false | 중요 공지 여부 |
| `userType` | string | - | 'all' | 대상: 'all', 'host', 'guest' |
| `publishedAt` | string | - | null | 게시 예정일 (ISO 8601) |
| `expiresAt` | string | - | null | 만료일 (ISO 8601) |
| `status` | string | - | 'draft' | 상태: 'draft', 'published', 'archived' |

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": 2,
    "title": "서비스 점검 안내",
    "status": "draft",
    "createdBy": 1
  },
  "message": "공지사항이 생성되었습니다."
}
```

---

### 4. 공지사항 수정

```
PATCH /api/admin/support/notices/:id
```

> 🔒 관리자 인증 필요

**Request Body:** (부분 업데이트 가능)
```json
{
  "title": "서비스 점검 안내 (수정)",
  "isImportant": false
}
```

---

### 5. 공지사항 삭제

```
DELETE /api/admin/support/notices/:id
```

> 🔒 관리자 인증 필요

**Response (200):**
```json
{
  "success": true,
  "message": "공지사항이 삭제되었습니다."
}
```

---

### 6. 공지사항 게시 (알림 발송 포함)

```
PATCH /api/admin/support/notices/:id/publish
```

> 🔒 관리자 인증 필요

공지사항을 `published` 상태로 변경하고, 대상 사용자(userType 기반)에게 **알림을 자동 발송**합니다.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": 2,
    "status": "published",
    "publishedAt": "2026-02-09T10:00:00.000Z"
  },
  "message": "공지사항이 게시되었습니다."
}
```

---

## ❓ 고객센터 - FAQ API

### 1. FAQ 카테고리 목록 (관리자용)

```
GET /api/admin/support/faq/categories
```

> 🔒 관리자 인증 필요

**Query Parameters:**
| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `userType` | string | - | 필터: 'all', 'host', 'guest' |
| `isActive` | string | - | 필터: 'true', 'false' |

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "입주/퇴거",
      "userType": "guest",
      "displayOrder": 1,
      "isActive": true,
      "createdAt": "2025-12-01T00:00:00.000Z"
    }
  ],
  "message": "FAQ 카테고리 목록을 조회했습니다."
}
```

---

### 2. FAQ 카테고리 생성

```
POST /api/admin/support/faq/categories
```

> 🔒 관리자 인증 필요

**Request Body:**
```json
{
  "name": "결제/환불",
  "userType": "all",
  "displayOrder": 3
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `name` | string | ✅ | 카테고리명 |
| `userType` | string | ✅ | 대상: 'all', 'host', 'guest' |
| `displayOrder` | number | - | 표시 순서 (기본: 0) |

**Error Cases:**
| Status | Code | Message |
|--------|------|---------|
| 400 | 4000 | name, userType는 필수입니다 |
| 400 | - | 이미 동일한 카테고리가 존재합니다 |

---

### 3. FAQ 카테고리 수정

```
PATCH /api/admin/support/faq/categories/:id
```

> 🔒 관리자 인증 필요

**Request Body:** (부분 업데이트 가능)
```json
{
  "name": "결제/환불/정산",
  "isActive": false
}
```

---

### 4. FAQ 카테고리 삭제

```
DELETE /api/admin/support/faq/categories/:id
```

> 🔒 관리자 인증 필요

> ⚠️ 해당 카테고리에 FAQ가 존재하면 삭제할 수 없습니다.

**Error Cases:**
| Status | Code | Message |
|--------|------|---------|
| 404 | - | FAQ 카테고리를 찾을 수 없습니다 |
| 400 | - | 해당 카테고리에 FAQ가 존재하여 삭제할 수 없습니다 |

---

### 5. FAQ 목록 (관리자용)

```
GET /api/admin/support/faqs
```

> 🔒 관리자 인증 필요

**Query Parameters:**
| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `page` | number | 1 | 페이지 번호 |
| `limit` | number | 20 | 페이지당 항목 수 |
| `categoryId` | number | - | 카테고리 ID 필터 |
| `isActive` | string | - | 필터: 'true', 'false' |
| `search` | string | - | 질문/답변 검색 |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "faqs": [
      {
        "id": 1,
        "categoryId": 1,
        "question": "체크인은 어떻게 하나요?",
        "answer": "체크인 당일 오후 3시부터 입주 가능합니다.",
        "displayOrder": 1,
        "viewCount": 45,
        "isActive": true,
        "category": { "id": 1, "name": "입주/퇴거", "userType": "guest" },
        "author": { "id": 1, "username": "admin@ezstay.com", "name": "관리자" },
        "editor": null,
        "createdAt": "2025-12-15T00:00:00.000Z",
        "updatedAt": "2025-12-15T00:00:00.000Z"
      }
    ],
    "pagination": {
      "total": 25,
      "page": 1,
      "limit": 20,
      "totalPages": 2
    }
  },
  "message": "FAQ 목록을 조회했습니다."
}
```

---

### 6. FAQ 상세 (관리자용)

```
GET /api/admin/support/faqs/:id
```

> 🔒 관리자 인증 필요

**Response:** FAQ 전체 정보 + category, author, editor 포함

---

### 7. FAQ 생성

```
POST /api/admin/support/faqs
```

> 🔒 관리자 인증 필요

**Request Body:**
```json
{
  "categoryId": 1,
  "question": "체크인은 어떻게 하나요?",
  "answer": "체크인 당일 오후 3시부터 입주 가능합니다.",
  "displayOrder": 1,
  "isActive": true
}
```

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `categoryId` | number | ✅ | - | FAQ 카테고리 ID |
| `question` | string | ✅ | - | 질문 |
| `answer` | string | ✅ | - | 답변 |
| `displayOrder` | number | - | 0 | 표시 순서 |
| `isActive` | boolean | - | true | 활성 여부 |

---

### 8. FAQ 수정

```
PATCH /api/admin/support/faqs/:id
```

> 🔒 관리자 인증 필요

**Request Body:** (부분 업데이트 가능)
```json
{
  "answer": "체크인 당일 오후 3시부터 가능하며, 사전 요청 시 오후 2시 얼리체크인 가능합니다.",
  "categoryId": 2
}
```

---

### 9. FAQ 삭제

```
DELETE /api/admin/support/faqs/:id
```

> 🔒 관리자 인증 필요

---

## 💬 고객센터 - 문의 관리 API

### 1. 문의 목록 (관리자용)

```
GET /api/admin/support/inquiries
```

> 🔒 관리자 인증 필요

**Query Parameters:**
| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `page` | number | 1 | 페이지 번호 |
| `limit` | number | 20 | 페이지당 항목 수 |
| `status` | string | - | 필터: 'pending', 'answered', 'closed' |
| `categoryType` | string | - | 필터: 'general', 'reservation', 'payment', 'room', 'account', 'other' |
| `userType` | string | - | 필터: 'host', 'guest' |
| `search` | string | - | 제목/내용 검색 |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "inquiries": [
      {
        "id": 1,
        "categoryType": "reservation",
        "userType": "guest",
        "title": "체크인 시간 변경 문의",
        "content": "체크인 시간을 오후 2시로 변경할 수 있나요?",
        "status": "pending",
        "answer": null,
        "answeredAt": null,
        "answeredBy": null,
        "user": {
          "id": 10,
          "name": "홍길동",
          "nickname": "길동이",
          "email": "hong@test.com",
          "phoneNumber": "010-1234-5678"
        },
        "admin": null,
        "createdAt": "2026-02-08T14:30:00.000Z"
      }
    ],
    "pagination": {
      "total": 7,
      "page": 1,
      "limit": 20,
      "totalPages": 1
    }
  },
  "message": "문의 목록을 조회했습니다."
}
```

> 정렬: `status ASC` (pending 먼저), `createdAt DESC`

---

### 2. 문의 상세 (관리자용)

```
GET /api/admin/support/inquiries/:id
```

> 🔒 관리자 인증 필요

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "categoryType": "reservation",
    "userType": "guest",
    "title": "체크인 시간 변경 문의",
    "content": "체크인 시간을 오후 2시로 변경할 수 있나요?",
    "status": "answered",
    "answer": "오후 2시 얼리체크인 가능합니다. 호스트에게 전달하겠습니다.",
    "answeredAt": "2026-02-09T09:00:00.000Z",
    "user": {
      "id": 10,
      "name": "홍길동",
      "nickname": "길동이",
      "email": "hong@test.com",
      "phoneNumber": "010-1234-5678"
    },
    "admin": {
      "id": 1,
      "name": "관리자"
    },
    "createdAt": "2026-02-08T14:30:00.000Z"
  },
  "message": "문의를 조회했습니다."
}
```

---

### 3. 문의 답변

```
POST /api/admin/support/inquiries/:id/answer
```

> 🔒 관리자 인증 필요

**Request Body:**
```json
{
  "answer": "오후 2시 얼리체크인 가능합니다. 호스트에게 전달하겠습니다."
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `answer` | string | ✅ | 답변 내용 |

답변 시 자동으로:
- `status` → `'answered'`
- `answeredBy` → 현재 관리자 ID
- `answeredAt` → 현재 시간
- 사용자에게 **알림 자동 발송**

> 이미 답변된 문의도 다시 답변 가능 (기존 답변 덮어쓰기)

---

### 4. 문의 상태 변경

```
PATCH /api/admin/support/inquiries/:id/status
```

> 🔒 관리자 인증 필요

**Request Body:**
```json
{
  "status": "closed"
}
```

허용 상태값: `pending`, `answered`, `closed`

---

### 5. 문의 삭제 (관리자)

```
DELETE /api/admin/support/inquiries/:id
```

> 🔒 관리자 인증 필요

> 관리자는 상태와 관계없이 모든 문의를 삭제할 수 있습니다.

---

## 💸 환불 관리 API

### 1. 환불 목록

```
GET /api/admin/refunds
```

> 🔒 관리자 인증 필요

**Query Parameters:**
| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `page` | number | 1 | 페이지 번호 |
| `limit` | number | 20 | 페이지당 항목 수 |
| `status` | string | - | 필터: 'REQUESTED', 'APPROVED', 'REJECTED', 'COMPLETED' |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "total": 12,
    "refunds": [
      {
        "id": 1,
        "refundStatus": "REQUESTED",
        "contract": {
          "id": 5,
          "checkInDate": "2026-02-15",
          "checkOutDate": "2026-03-01",
          "room": { "id": 10, "roomName": "강남 원룸", "address": "서울시 강남구..." },
          "guest": { "id": 20, "name": "홍길동", "phoneNumber": "010-1234-5678", "email": "hong@test.com" }
        },
        "policyTypeUsed": "flexible",
        "daysBeforeCheckin": 10,
        "isSameDayCancellation": false,
        "totalRefundAmount": 650000,
        "finalRefundAmount": 620000,
        "refundMethod": "ORIGINAL",
        "cancellationReason": "일정 변경",
        "requestedAt": "2026-02-05T14:30:00.000Z",
        "approvedAt": null,
        "rejectedAt": null,
        "completedAt": null
      }
    ],
    "pagination": {
      "currentPage": 1,
      "limit": 20,
      "totalPages": 1,
      "hasMore": false
    }
  },
  "message": "환불 요청 목록을 조회했습니다."
}
```

---

### 2. 환불 상세

```
GET /api/admin/refunds/:refundId
```

> 🔒 관리자 인증 필요

**Response (200):**
```json
{
  "success": true,
  "data": {
    "refund": {
      "id": 1,
      "refundStatus": "REQUESTED",

      "contract": {
        "id": 5,
        "checkInDate": "2026-02-15",
        "checkOutDate": "2026-03-01",
        "totalDays": 14,
        "room": { "id": 10, "roomName": "강남 원룸", "address": "서울시 강남구...", "refundPolicy": "flexible" },
        "host": { "id": 15, "name": "김호스트", "nickname": "호스트님", "phoneNumber": "010-9876-5432", "email": "host@test.com" },
        "guest": { "id": 20, "name": "홍길동", "nickname": "길동이", "phoneNumber": "010-1234-5678", "email": "hong@test.com" }
      },

      "policyTypeUsed": "flexible",
      "cancellationDate": "2026-02-05",
      "checkInDate": "2026-02-15",
      "daysBeforeCheckin": 10,
      "isSameDayCancellation": false,

      "originalRentalFee": 700000,
      "originalCleaningFee": 30000,
      "originalMaintenanceFee": 70000,
      "originalTotalAmount": 800000,

      "rentalFeeRefundRate": 100,
      "rentalFeeRefundAmount": 700000,
      "cleaningFeeRefundAmount": 30000,
      "maintenanceFeeRefundAmount": 70000,
      "totalRefundAmount": 800000,

      "platformFeeDeducted": 79200,
      "penaltyAmount": 0,
      "finalRefundAmount": 720800,

      "refundMethod": "ORIGINAL",
      "refundAccountInfo": null,

      "cancellationReason": "일정 변경",
      "rejectionReason": null,
      "adminNotes": null,

      "requestedAt": "2026-02-05T14:30:00.000Z",
      "approvedAt": null,
      "rejectedAt": null,
      "completedAt": null,
      "createdAt": "2026-02-05T14:30:00.000Z",
      "updatedAt": "2026-02-05T14:30:00.000Z"
    }
  },
  "message": "환불 요청 상세를 조회했습니다."
}
```

---

### 3. 환불 승인

```
PATCH /api/admin/refunds/:refundId/approve
```

> 🔒 super_admin, admin만 가능

**Request Body:**
```json
{
  "admin_notes": "정상 환불 처리"
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `admin_notes` | string | - | 관리자 메모 |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "refundId": 1,
    "refundStatus": "APPROVED",
    "approvedAt": "2026-02-09T10:00:00.000Z",
    "finalRefundAmount": 720800
  },
  "message": "환불이 승인되었습니다. 실제 환불 처리는 영업일 기준 3-5일 소요됩니다."
}
```

**Error Cases:**
| Status | Code | Message |
|--------|------|---------|
| 404 | 3006 | 환불 요청을 찾을 수 없습니다 |
| 400 | 4503 | 요청 상태의 환불만 승인할 수 있습니다 |

---

### 4. 환불 거절

```
PATCH /api/admin/refunds/:refundId/reject
```

> 🔒 super_admin, admin만 가능

**Request Body:**
```json
{
  "rejection_reason": "환불 정책 기준 미충족",
  "admin_notes": "체크인 당일 취소 불가"
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `rejection_reason` | string | ✅ | 거절 사유 |
| `admin_notes` | string | - | 관리자 메모 |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "refundId": 1,
    "refundStatus": "REJECTED",
    "rejectionReason": "환불 정책 기준 미충족",
    "rejectedAt": "2026-02-09T10:00:00.000Z"
  },
  "message": "환불 요청이 거절되었습니다."
}
```

**Error Cases:**
| Status | Code | Message |
|--------|------|---------|
| 400 | 4504 | 거절 사유를 입력해주세요 |
| 404 | 3006 | 환불 요청을 찾을 수 없습니다 |
| 400 | 4505 | 요청 상태의 환불만 거절할 수 있습니다 |

> 환불 거절 시 계약 상태가 `PAYMENT_COMPLETED`로 자동 복원됩니다.

---

## 📦 렌탈 주문 관리 API

### 1. 렌탈 주문 목록

```
GET /api/admin/rental-orders
```

> 🔒 관리자 인증 필요

**Query Parameters:**
| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `page` | number | 1 | 페이지 번호 |
| `limit` | number | 20 | 페이지당 항목 수 |
| `status` | string | - | 주문 상태: 'PENDING', 'PAID', 'PARTIAL_REFUND', 'FULL_REFUND', 'CANCELLED' |
| `deliveryStatus` | string | - | 배송 상태: 'PENDING', 'IN_TRANSIT', 'DELIVERED' |
| `orderType` | string | - | 주문 유형 |
| `contractId` | number | - | 계약 ID 필터 |
| `startDate` | string | - | 시작일 (YYYY-MM-DD) |
| `endDate` | string | - | 종료일 (YYYY-MM-DD) |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "orders": [
      {
        "id": 1,
        "rentalOrderId": "RO-20260208-001",
        "orderType": "INITIAL",
        "status": "PAID",
        "deliveryStatus": "DELIVERED",
        "deliveryStatusLabel": "배송 완료",
        "deliveredAt": "2026-02-09T14:00:00.000Z",
        "totalAmount": 150000,
        "refundedAmount": 0,
        "modifiableUntil": "2026-02-10T00:00:00.000Z",
        "paidAt": "2026-02-08T10:00:00.000Z",
        "createdAt": "2026-02-08T09:30:00.000Z",
        "contract": {
          "id": 5,
          "orderId": "ORD-20260208-001",
          "status": "IN_PROGRESS",
          "checkInDate": "2026-02-01",
          "checkOutDate": "2026-02-15",
          "guest": { "id": 20, "name": "홍길동", "nickname": "길동이", "email": "hong@test.com" },
          "room": { "id": 10, "roomName": "강남 원룸" }
        },
        "items": [
          {
            "id": 1,
            "name": "침구 세트",
            "quantity": 1,
            "pricePerItem": 50000,
            "totalPrice": 50000,
            "status": "ACTIVE"
          },
          {
            "id": 2,
            "name": "타월 세트",
            "quantity": 2,
            "pricePerItem": 15000,
            "totalPrice": 30000,
            "status": "ACTIVE"
          }
        ]
      }
    ],
    "pagination": {
      "total": 8,
      "page": 1,
      "limit": 20,
      "totalPages": 1
    }
  },
  "message": "렌탈 주문 목록을 조회했습니다."
}
```

---

### 2. 렌탈 주문 상세

```
GET /api/admin/rental-orders/:rentalOrderId
```

> 🔒 관리자 인증 필요

> **URL 파라미터**: `rentalOrderId`는 주문번호 문자열 (예: "RO-20260208-001")

**Response (200):**
```json
{
  "success": true,
  "data": {
    "order": {
      "id": 1,
      "rentalOrderId": "RO-20260208-001",
      "orderType": "INITIAL",
      "status": "PAID",
      "deliveryStatus": "DELIVERED",
      "deliveryStatusLabel": "배송 완료",
      "deliveredAt": "2026-02-09T14:00:00.000Z",
      "totalAmount": 150000,
      "refundedAmount": 0,
      "modifiableUntil": "2026-02-10T00:00:00.000Z",
      "paymentKey": "toss_pay_key_xxx",
      "paidAt": "2026-02-08T10:00:00.000Z",
      "createdAt": "2026-02-08T09:30:00.000Z",
      "updatedAt": "2026-02-09T14:00:00.000Z",
      "contract": {
        "id": 5,
        "orderId": "ORD-20260208-001",
        "status": "IN_PROGRESS",
        "checkInDate": "2026-02-01",
        "checkOutDate": "2026-02-15",
        "guest": { "id": 20, "name": "홍길동", "nickname": "길동이", "email": "hong@test.com", "phoneNumber": "010-1234-5678" },
        "host": { "id": 15, "name": "김호스트", "nickname": "호스트님", "email": "host@test.com", "phoneNumber": "010-9876-5432" },
        "room": { "id": 10, "roomName": "강남 원룸", "address": "서울시 강남구..." }
      },
      "items": [
        {
          "id": 1,
          "rentalItemId": 101,
          "name": "침구 세트",
          "category": "bedding",
          "quantity": 1,
          "pricePerItem": 50000,
          "totalPrice": 50000,
          "status": "ACTIVE",
          "cancelledAt": null,
          "cancelReason": null,
          "refundAmount": null
        }
      ]
    },
    "logs": [
      {
        "id": 1,
        "action": "ORDER_CREATED",
        "actionLabel": "주문 생성",
        "description": "렌탈 주문이 생성되었습니다.",
        "metadata": {},
        "createdAt": "2026-02-08T09:30:00.000Z"
      },
      {
        "id": 2,
        "action": "DELIVERY_COMPLETED",
        "actionLabel": "배송 완료",
        "description": "배송 상태 변경: 배송 준비중 → 배송 완료",
        "metadata": { "previousStatus": "PENDING", "newStatus": "DELIVERED" },
        "createdAt": "2026-02-09T14:00:00.000Z"
      }
    ]
  },
  "message": "렌탈 주문 상세를 조회했습니다."
}
```

---

### 3. 계약별 렌탈 이력

```
GET /api/admin/contracts/:contractId/rental-history
```

> 🔒 관리자 인증 필요

**Response (200):**
```json
{
  "success": true,
  "data": {
    "contract": {
      "id": 5,
      "orderId": "ORD-20260208-001",
      "status": "IN_PROGRESS",
      "checkInDate": "2026-02-01",
      "checkOutDate": "2026-02-15",
      "guest": { "id": 20, "name": "홍길동", "nickname": "길동이" },
      "room": { "id": 10, "roomName": "강남 원룸" }
    },
    "summary": {
      "totalOrders": 2,
      "totalPaid": 200000,
      "totalRefunded": 30000,
      "activeItems": 3,
      "cancelledItems": 1
    },
    "orders": [
      {
        "id": 1,
        "rentalOrderId": "RO-20260208-001",
        "orderType": "INITIAL",
        "status": "PAID",
        "totalAmount": 150000,
        "refundedAmount": 30000,
        "paidAt": "2026-02-08T10:00:00.000Z",
        "createdAt": "2026-02-08T09:30:00.000Z",
        "items": [
          { "id": 1, "name": "침구 세트", "quantity": 1, "totalPrice": 50000, "status": "ACTIVE", "cancelledAt": null },
          { "id": 2, "name": "타월 세트", "quantity": 2, "totalPrice": 30000, "status": "CANCELLED", "cancelledAt": "2026-02-09T10:00:00.000Z" }
        ]
      }
    ],
    "timeline": [
      { "id": 1, "rentalOrderId": 1, "action": "ORDER_CREATED", "actionLabel": "주문 생성", "description": "렌탈 주문이 생성되었습니다.", "metadata": {}, "createdAt": "2026-02-08T09:30:00.000Z" },
      { "id": 2, "rentalOrderId": 1, "action": "ADMIN_ITEM_CANCELLED", "actionLabel": "관리자 아이템 취소", "description": "관리자가 아이템을 취소했습니다: 타월 세트 x2", "metadata": {}, "createdAt": "2026-02-09T10:00:00.000Z" }
    ]
  },
  "message": "계약 렌탈 이력을 조회했습니다."
}
```

---

### 4. 렌탈 아이템 취소 (관리자 강제 취소)

```
POST /api/admin/rental-orders/:rentalOrderId/items/:itemId/cancel
```

> 🔒 super_admin, admin만 가능

> **URL 파라미터**: `rentalOrderId`는 주문번호 문자열, `itemId`는 아이템 ID (숫자)

**Request Body:**
```json
{
  "reason": "재고 소진으로 인한 취소",
  "refundAmount": 30000
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `reason` | string | ✅ | 취소 사유 |
| `refundAmount` | number | - | 환불 금액 (미지정 시 아이템 전액) |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "rentalOrderId": "RO-20260208-001",
    "item": {
      "id": 2,
      "name": "타월 세트",
      "status": "CANCELLED",
      "refundAmount": 30000
    },
    "orderStatus": "PARTIAL_REFUND",
    "totalRefunded": 30000
  },
  "message": "렌탈 아이템이 취소되었습니다."
}
```

**Error Cases:**
| Status | Code | Message |
|--------|------|---------|
| 400 | 4000 | 필수 입력값이 누락되었습니다 (reason) |
| 404 | - | 렌탈 주문을 찾을 수 없습니다 |
| 404 | - | 렌탈 아이템을 찾을 수 없습니다 |
| 400 | - | 이미 취소된 아이템입니다 |

---

### 5. 배송 상태 변경

```
PATCH /api/admin/rental-orders/:rentalOrderId/delivery-status
```

> 🔒 super_admin, admin만 가능

> **URL 파라미터**: `rentalOrderId`는 주문 ID (숫자, PK)

**Request Body:**
```json
{
  "deliveryStatus": "DELIVERED"
}
```

허용 상태값: `PENDING`, `IN_TRANSIT`, `DELIVERED`

**Response (200):**
```json
{
  "success": true,
  "data": {
    "rentalOrderId": 1,
    "orderId": "ORD-20260208-001",
    "previousDeliveryStatus": "IN_TRANSIT",
    "deliveryStatus": "DELIVERED",
    "deliveryStatusLabel": "배송 완료",
    "deliveredAt": "2026-02-09T14:00:00.000Z"
  },
  "message": "배송 상태가 '배송 완료'(으)로 변경되었습니다."
}
```

**Error Cases:**
| Status | Code | Message |
|--------|------|---------|
| 400 | 4001 | 유효한 배송 상태를 입력해주세요. (PENDING, IN_TRANSIT, DELIVERED) |
| 404 | - | 렌탈 주문을 찾을 수 없습니다 |
| 400 | 4001 | 결제 완료된 주문만 배송 상태를 변경할 수 있습니다 |
| 400 | 4001 | 이미 해당 상태입니다 |

---

## 💳 결제 관리 API

### 1. 결제 목록

```
GET /api/admin/payments
```

> 🔒 관리자 인증 필요

**Query Parameters:**
| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `page` | number | 1 | 페이지 번호 |
| `limit` | number | 20 | 페이지당 항목 수 |
| `status` | string | '' | 필터: 'READY', 'IN_PROGRESS', 'DONE', 'CANCELED', 'PARTIAL_CANCELED', 'ABORTED', 'EXPIRED' |
| `method` | string | '' | 필터: 'CARD', 'VIRTUAL_ACCOUNT', 'TRANSFER', 'MOBILE', 'EASY_PAY' |
| `search` | string | '' | 검색 (결제 ID, 계약 ID - 숫자) 또는 (paymentKey, orderId - 문자열) |
| `startDate` | string | - | 결제 요청 시작일 (YYYY-MM-DD) |
| `endDate` | string | - | 결제 요청 종료일 (YYYY-MM-DD) |
| `sortBy` | string | 'createdAt' | 정렬: 'createdAt', 'totalAmount', 'approvedAt', 'requestedAt' |
| `sortOrder` | string | 'DESC' | 'ASC' 또는 'DESC' |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "payments": [
      {
        "id": 1,
        "contractId": 5,
        "contractOrderId": "ORD-20260208-001",
        "paymentKey": "toss_pay_key_xxx",
        "orderId": "ORDER-20260208-001",
        "method": "CARD",
        "status": "DONE",
        "totalAmount": 879200,
        "balanceAmount": 879200,
        "requestedAt": "2026-02-08T10:00:00.000Z",
        "approvedAt": "2026-02-08T10:00:30.000Z",
        "createdAt": "2026-02-08T10:00:00.000Z",
        "guest": {
          "id": 20,
          "name": "홍길동",
          "email": "hong@test.com"
        },
        "room": {
          "id": 10,
          "roomName": "강남 원룸"
        },
        "contractStatus": "IN_PROGRESS"
      }
    ],
    "pagination": {
      "total": 30,
      "page": 1,
      "limit": 20,
      "totalPages": 2
    }
  },
  "message": "결제 목록 조회 성공"
}
```

---

### 2. 결제 상세

```
GET /api/admin/payments/:paymentId
```

> 🔒 관리자 인증 필요

**Response (200):**
```json
{
  "success": true,
  "data": {
    "payment": {
      "id": 1,
      "paymentKey": "toss_pay_key_xxx",
      "orderId": "ORDER-20260208-001",
      "method": "CARD",
      "status": "DONE",
      "totalAmount": 879200,
      "balanceAmount": 879200,
      "suppliedAmount": 799273,
      "vat": 79927,
      "taxFreeAmount": 0,
      "currency": "KRW",
      "receiptUrl": "https://dashboard.tosspayments.com/receipt/...",
      "requestedAt": "2026-02-08T10:00:00.000Z",
      "approvedAt": "2026-02-08T10:00:30.000Z",
      "createdAt": "2026-02-08T10:00:00.000Z",
      "updatedAt": "2026-02-08T10:00:30.000Z"
    },
    "contract": {
      "id": 5,
      "orderId": "ORD-20260208-001",
      "status": "IN_PROGRESS",
      "paymentMethod": "CREDIT_CARD",
      "finalTotalAmount": 879200,
      "rentalFee": 700000,
      "maintenanceFee": 70000,
      "cleaningFee": 30000,
      "platformFee": 79200,
      "hostPlatformFee": 26400,
      "deposit": 0,
      "checkInDate": "2026-02-01",
      "checkOutDate": "2026-02-15",
      "paidAt": "2026-02-08T10:00:30.000Z"
    },
    "guest": {
      "id": 20,
      "name": "홍길동",
      "nickname": "길동이",
      "email": "hong@test.com",
      "phoneNumber": "010-1234-5678"
    },
    "host": {
      "id": 15,
      "name": "김호스트",
      "nickname": "호스트님",
      "email": "host@test.com",
      "phoneNumber": "010-9876-5432"
    },
    "room": {
      "id": 10,
      "roomName": "강남 원룸",
      "address": "서울시 강남구..."
    },
    "refunds": [
      {
        "id": 1,
        "refundStatus": "COMPLETED",
        "totalRefundAmount": 100000,
        "finalRefundAmount": 100000,
        "cancellationReason": "부분 환불 요청",
        "requestedAt": "2026-02-10T10:00:00.000Z",
        "completedAt": "2026-02-10T10:05:00.000Z"
      }
    ],
    "failureLogs": [
      {
        "id": 1,
        "failureCode": "REJECT_CARD_COMPANY",
        "failureMessage": "카드사 거절",
        "createdAt": "2026-02-08T09:55:00.000Z"
      }
    ]
  },
  "message": "결제 상세 조회 성공"
}
```

---

### 3. 관리자 환불 처리 (토스페이먼츠 연동)

```
POST /api/admin/payments/:paymentId/refund
```

> 🔒 super_admin, admin만 가능

토스페이먼츠 취소 API를 호출하여 실제 결제 취소를 수행합니다.

**Request Body:**
```json
{
  "refundAmount": 100000,
  "refundReason": "고객 요청에 의한 부분 환불"
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `refundAmount` | number | ✅ | 환불 금액 (0보다 커야 함) |
| `refundReason` | string | ✅ | 환불 사유 |

**처리 로직:**
1. Payment 상태가 `DONE` 또는 `PARTIAL_CANCELED`인지 확인
2. `refundAmount ≤ balanceAmount` 확인
3. 토스페이먼츠 취소 API 호출 (`POST /v1/payments/{paymentKey}/cancel`)
4. Payment 상태/잔액 업데이트 (전액 환불 시 `CANCELED`, 부분 환불 시 `PARTIAL_CANCELED`)
5. Refund 레코드 생성

**Response (200):**
```json
{
  "success": true,
  "data": {
    "refundId": 1,
    "paymentId": 1,
    "refundAmount": 100000,
    "newBalance": 779200,
    "paymentStatus": "PARTIAL_CANCELED",
    "cancelStatus": "DONE"
  },
  "message": "환불이 처리되었습니다."
}
```

**Error Cases:**
| Status | Code | Message |
|--------|------|---------|
| 400 | 4001 | 환불 금액/사유 미입력 |
| 404 | 4608 | 결제 정보를 찾을 수 없습니다 |
| 400 | 4609 | 환불 가능한 상태가 아닙니다 (DONE/PARTIAL_CANCELED만 가능) |
| 400 | 4610 | 환불 금액이 잔액을 초과합니다 |
| 400 | 4609 | 토스페이먼츠 취소 실패 (details에 tossErrorCode/tossErrorMessage 포함) |

---

## 📊 정산 관리 API

### 정산 상태 설명

정산은 기본적으로 **자동 계산**됩니다:
- **정산 예정** (`pending`): 체크아웃 후 7일 이내 → 정산 대기 중
- **정산 완료** (`completed`): 체크아웃 후 7일 경과 → 자동 완료

관리자는 `settlementStatus` 필드로 상태를 **오버라이드**할 수 있습니다:
- `auto` (기본): 날짜 기반 자동 계산
- `completed`: 관리자가 수동으로 완료 처리
- `on_hold`: 관리자가 보류 처리 (사유 필수)

### 정산 금액 계산 공식
```
소계 = 임대료 + 관리비 + 청소비(EZ청소 미사용 시)
호스트수수료 = 소계 × 3.3%
기본정산액 = 소계 - 호스트수수료
최종정산액 = 기본정산액 - 환불금액
```

---

### 1. 정산 목록

```
GET /api/admin/settlements
```

> 🔒 관리자 인증 필요

**Query Parameters:**
| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `page` | number | 1 | 페이지 번호 |
| `limit` | number | 20 | 페이지당 항목 수 |
| `status` | string | '' | 필터: 'pending', 'completed', 'on_hold' |
| `search` | string | '' | 호스트 이름/이메일 검색 |
| `hostId` | number | - | 호스트 ID 필터 |
| `startDate` | string | - | 체크아웃 시작일 (YYYY-MM-DD) |
| `endDate` | string | - | 체크아웃 종료일 (YYYY-MM-DD) |
| `sortBy` | string | 'checkOutDate' | 정렬: 'checkOutDate', 'createdAt', 'finalTotalAmount' |
| `sortOrder` | string | 'DESC' | 'ASC' 또는 'DESC' |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "settlements": [
      {
        "contractId": 5,
        "contractNumber": "C-20260208-001",
        "host": {
          "id": 15,
          "name": "김호스트",
          "email": "host@test.com"
        },
        "room": {
          "id": 10,
          "roomName": "강남 원룸"
        },
        "guestName": "홍길동",
        "checkInDate": "2026-02-01",
        "checkOutDate": "2026-02-15",
        "rentalDays": 14,
        "settlementAmount": 773600,
        "settlementDate": "2026-02-22",
        "status": "pending",
        "statusLabel": "정산 예정",
        "settlementCompletedAt": null,
        "settlementNote": null,
        "hasRefund": false,
        "refundAmount": 0
      }
    ],
    "summary": {
      "pendingCount": 5,
      "completedCount": 20,
      "onHoldCount": 1
    },
    "pagination": {
      "total": 26,
      "page": 1,
      "limit": 20,
      "totalPages": 2
    }
  },
  "message": "정산 목록 조회 성공"
}
```

---

### 2. 정산 엑셀 내보내기

```
GET /api/admin/settlements/export
```

> 🔒 관리자 인증 필요

> ⚠️ 이 라우트는 `/settlements/:contractId`보다 먼저 등록되어 파라미터 충돌을 방지합니다.

**Query Parameters:**
| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `status` | string | '' | 필터: 'pending', 'completed', 'on_hold' |
| `hostId` | number | - | 호스트 ID 필터 |
| `startDate` | string | - | 체크아웃 시작일 |
| `endDate` | string | - | 체크아웃 종료일 |

**Response:** 엑셀 파일 (`.xlsx`) 다운로드

**Response Headers:**
```
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename="admin_settlement_2026-02-09.xlsx"
```

**엑셀 컬럼:**
| 컬럼 | 설명 |
|------|------|
| 계약번호 | 계약 고유번호 |
| 방 이름 | 매물명 |
| 게스트명 | 게스트 이름 |
| 입실일 | 체크인 날짜 |
| 퇴실일 | 체크아웃 날짜 |
| 이용일수 | 숙박 일수 |
| 임대료 | 임대료 |
| 관리비 | 관리비 |
| 청소비 | 호스트 정산 청소비 (EZ서비스 사용 시 0) |
| EZ청소 | EZ청소서비스 사용 여부 (O/-) |
| 소계 | 소계 금액 |
| 플랫폼 수수료(3.3%) | 호스트 수수료 |
| 환불금액 | 환불 차감 금액 |
| 정산금액 | 최종 호스트 수령액 |
| 정산예정일 | 정산 예정일 |
| 상태 | 정산 예정/정산 완료/보류 |

---

### 3. 정산 상세

```
GET /api/admin/settlements/:contractId
```

> 🔒 관리자 인증 필요

> 관리자 조회 시 계좌번호 마스킹 없이 **전체 표시**됩니다 (호스트 API와 차이점).

**Response (200):**
```json
{
  "success": true,
  "data": {
    "contract": {
      "contractId": 5,
      "contractNumber": "C-20260208-001",
      "orderId": "ORD-20260208-001",
      "status": "COMPLETED",
      "checkInDate": "2026-02-01",
      "checkOutDate": "2026-02-15",
      "rentalDays": 14,
      "paidAt": "2026-01-26T14:30:00.000Z"
    },
    "host": {
      "id": 15,
      "name": "김호스트",
      "email": "host@test.com",
      "phoneNumber": "010-9876-5432"
    },
    "room": {
      "id": 10,
      "roomName": "강남 원룸",
      "address": "서울시 강남구...",
      "thumbnail": "/uploads/rooms/photo10.jpg"
    },
    "guest": {
      "id": 20,
      "name": "홍길동",
      "email": "hong@test.com",
      "phoneNumber": "010-1234-5678"
    },
    "payment": {
      "id": 1,
      "paymentKey": "toss_pay_key_xxx",
      "method": "CARD",
      "status": "DONE",
      "totalAmount": 879200,
      "balanceAmount": 879200,
      "approvedAt": "2026-01-26T14:30:00.000Z"
    },
    "breakdown": {
      "rentalFee": 700000,
      "maintenanceFee": 70000,
      "cleaningFee": 30000,
      "originalCleaningFee": 30000,
      "hasEzCleaningService": false,
      "subtotal": 800000,
      "platformFee": 26400,
      "platformFeeRate": 3.3,
      "grossSettlement": 773600
    },
    "refunds": [
      {
        "id": 1,
        "refundStatus": "COMPLETED",
        "policyTypeUsed": "flexible",
        "cancellationReason": "부분 환불",
        "rentalFeeRefund": 50000,
        "maintenanceFeeRefund": 0,
        "cleaningFeeRefund": 0,
        "finalRefundAmount": 50000,
        "completedAt": "2026-02-10T10:00:00.000Z"
      }
    ],
    "settlement": {
      "finalAmount": 723600,
      "settlementDate": "2026-02-22",
      "status": "pending",
      "statusLabel": "정산 예정",
      "settlementCompletedAt": null,
      "settlementNote": null,
      "bankInfo": {
        "bankName": "국민은행",
        "accountNumber": "123-456-7890123",
        "accountHolder": "김호스트"
      }
    }
  },
  "message": "정산 상세 조회 성공"
}
```

**Error Cases:**
| Status | Code | Message |
|--------|------|---------|
| 404 | 4901 | 정산 정보를 찾을 수 없습니다 |

---

### 4. 정산 완료 처리

```
PATCH /api/admin/settlements/:contractId/complete
```

> 🔒 super_admin, admin만 가능

관리자가 수동으로 정산 완료를 확인 처리합니다.

**Request Body:**
```json
{
  "note": "은행 이체 확인 완료"
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `note` | string | - | 관리자 메모 (미입력 시 자동 생성) |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "contractId": 5,
    "settlementStatus": "completed",
    "settlementCompletedAt": "2026-02-09T10:00:00.000Z",
    "settlementNote": "은행 이체 확인 완료"
  },
  "message": "정산 완료 처리되었습니다."
}
```

**Error Cases:**
| Status | Code | Message |
|--------|------|---------|
| 404 | 4901 | 정산 정보를 찾을 수 없습니다 |

---

### 5. 정산 보류 처리

```
PATCH /api/admin/settlements/:contractId/hold
```

> 🔒 super_admin, admin만 가능

정산을 보류하고 사유를 기록합니다.

**Request Body:**
```json
{
  "reason": "호스트 계좌 정보 불일치 확인 필요"
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `reason` | string | ✅ | 보류 사유 |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "contractId": 5,
    "settlementStatus": "on_hold",
    "settlementNote": "[보류 사유] 호스트 계좌 정보 불일치 확인 필요 (관리자 ID:1)"
  },
  "message": "정산이 보류 처리되었습니다."
}
```

**Error Cases:**
| Status | Code | Message |
|--------|------|---------|
| 400 | 4001 | 보류 사유 미입력 (field: reason) |
| 404 | 4901 | 정산 정보를 찾을 수 없습니다 |

---

## ⚠️ 에러 코드

### 공통 에러 코드
| 코드 | HTTP | 설명 |
|------|------|------|
| 1001 | 401 | 인증 실패 (UNAUTHORIZED) |
| 1002 | 401 | 유효하지 않은 토큰 (INVALID_TOKEN) |
| 1003 | 401 | 토큰 만료 (TOKEN_EXPIRED) |
| 2001 | 403 | 권한 없음 (FORBIDDEN) |
| 3001 | 404 | 리소스 없음 (NOT_FOUND) |
| 3002 | 404 | 방 없음 (ROOM_NOT_FOUND) |
| 3003 | 404 | 유저 없음 (USER_NOT_FOUND) |
| 3005 | 404 | 예약 없음 |
| 3006 | 404 | 환불 요청 없음 |
| 4000 | 400 | 필수 입력값 누락 (MISSING_REQUIRED_FIELDS) |
| 4001 | 400 | 검증 실패 (VALIDATION_ERROR) |
| 5001 | 500 | 서버 내부 오류 (INTERNAL_ERROR) |

### 매물 관리 에러 코드
| 코드 | HTTP | 설명 |
|------|------|------|
| 4301 | 400 | 심사 대기 매물만 승인 가능 |
| 4302 | 400 | 심사 대기 매물만 반려 가능 |

### 방 관리 에러 코드
| 코드 | HTTP | 설명 |
|------|------|------|
| 4001 | 400 | 허용되지 않은 상태값 |
| 4002 | 400 | 이미 해당 상태 |
| 4003 | 400 | 새 비밀번호 필수 |
| 4004 | 400 | 비밀번호 길이 제한 (4~50자) |
| 4005 | 400 | 메모 내용 필수 |
| 4006 | 404 | 메모 없음 |

### 환불 관리 에러 코드
| 코드 | HTTP | 설명 |
|------|------|------|
| 4503 | 400 | 요청 상태만 승인 가능 |
| 4504 | 400 | 거절 사유 필수 |
| 4505 | 400 | 요청 상태만 거절 가능 |

### 결제 관리 에러 코드
| 코드 | HTTP | 설명 |
|------|------|------|
| 4608 | 404 | 결제 정보를 찾을 수 없습니다 (PAYMENT_NOT_FOUND) |
| 4609 | 400 | 환불 가능한 상태가 아닙니다 (PAYMENT_NOT_REFUNDABLE) |
| 4610 | 400 | 환불 금액이 잔액을 초과합니다 (REFUND_EXCEEDS_BALANCE) |

### 정산 관리 에러 코드
| 코드 | HTTP | 설명 |
|------|------|------|
| 4901 | 404 | 정산 정보를 찾을 수 없습니다 (SETTLEMENT_NOT_FOUND) |

### Rate Limiting 에러 코드
| 코드 | HTTP | 설명 |
|------|------|------|
| 4294 | 429 | 관리자 인증 요청 초과 |
| 4295 | 429 | 관리자 API 요청 초과 |

---

## 📌 API 엔드포인트 요약

### 인증 (인증 불필요)
| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/auth/login` | 관리자 로그인 |

### 인증 (인증 필요)
| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/auth/logout` | 로그아웃 |
| GET | `/auth/me` | 내 정보 조회 |

### 대시보드
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/dashboard/stats` | 통계 조회 |
| GET | `/dashboard/recent-activities` | 최근 활동 |

### 유저 관리
| Method | Endpoint | 권한 | 설명 |
|--------|----------|------|------|
| GET | `/users` | 모든 관리자 | 유저 목록 |
| GET | `/users/:userId` | 모든 관리자 | 유저 상세 |
| PATCH | `/users/:userId/status` | super_admin, admin | 유저 상태 변경 |

### 매물 관리
| Method | Endpoint | 권한 | 설명 |
|--------|----------|------|------|
| GET | `/properties` | 모든 관리자 | 매물 목록 |
| GET | `/properties/pending-review` | 모든 관리자 | 심사 대기 목록 |
| GET | `/properties/:roomId` | 모든 관리자 | 매물 상세 |
| POST | `/properties/:roomId/approve` | super_admin, admin | 매물 승인 |
| POST | `/properties/:roomId/reject` | super_admin, admin | 매물 반려 |

### 방 정보 관리
| Method | Endpoint | 권한 | 설명 |
|--------|----------|------|------|
| GET | `/properties/:roomId/management` | 모든 관리자 | 방 관리 상세 |
| PATCH | `/properties/:roomId/status` | super_admin, admin | 방 상태 변경 |
| GET | `/properties/:roomId/status-history` | super_admin, admin | 상태 변경 이력 |
| PATCH | `/properties/:roomId/password` | super_admin, admin | 비밀번호 변경 |
| GET | `/properties/:roomId/password-history` | super_admin, admin | 비밀번호 이력 |
| POST | `/properties/:roomId/memos` | 모든 관리자 | 메모 생성 |
| PATCH | `/properties/:roomId/memos/:memoId` | 모든 관리자 | 메모 수정 |
| DELETE | `/properties/:roomId/memos/:memoId` | 모든 관리자 | 메모 삭제 |

### 예약 관리
| Method | Endpoint | 권한 | 설명 |
|--------|----------|------|------|
| GET | `/reservations` | 모든 관리자 | 예약 목록 |
| GET | `/reservations/:contractId` | 모든 관리자 | 예약 상세 |

### 액션 로그
| Method | Endpoint | 권한 | 설명 |
|--------|----------|------|------|
| GET | `/action-logs` | super_admin | 로그 목록 |
| GET | `/action-logs/stats` | super_admin | 로그 통계 |
| GET | `/action-logs/:id` | super_admin | 로그 상세 |

### 고객센터 - 공지사항
| Method | Endpoint | 권한 | 설명 |
|--------|----------|------|------|
| GET | `/support/notices` | 모든 관리자 | 공지 목록 |
| GET | `/support/notices/:id` | 모든 관리자 | 공지 상세 |
| POST | `/support/notices` | 모든 관리자 | 공지 생성 |
| PATCH | `/support/notices/:id` | 모든 관리자 | 공지 수정 |
| DELETE | `/support/notices/:id` | 모든 관리자 | 공지 삭제 |
| PATCH | `/support/notices/:id/publish` | 모든 관리자 | 공지 게시 (알림) |

### 고객센터 - FAQ
| Method | Endpoint | 권한 | 설명 |
|--------|----------|------|------|
| GET | `/support/faq/categories` | 모든 관리자 | 카테고리 목록 |
| POST | `/support/faq/categories` | 모든 관리자 | 카테고리 생성 |
| PATCH | `/support/faq/categories/:id` | 모든 관리자 | 카테고리 수정 |
| DELETE | `/support/faq/categories/:id` | 모든 관리자 | 카테고리 삭제 |
| GET | `/support/faqs` | 모든 관리자 | FAQ 목록 |
| GET | `/support/faqs/:id` | 모든 관리자 | FAQ 상세 |
| POST | `/support/faqs` | 모든 관리자 | FAQ 생성 |
| PATCH | `/support/faqs/:id` | 모든 관리자 | FAQ 수정 |
| DELETE | `/support/faqs/:id` | 모든 관리자 | FAQ 삭제 |

### 고객센터 - 문의
| Method | Endpoint | 권한 | 설명 |
|--------|----------|------|------|
| GET | `/support/inquiries` | 모든 관리자 | 문의 목록 |
| GET | `/support/inquiries/:id` | 모든 관리자 | 문의 상세 |
| POST | `/support/inquiries/:id/answer` | 모든 관리자 | 문의 답변 |
| PATCH | `/support/inquiries/:id/status` | 모든 관리자 | 문의 상태 변경 |
| DELETE | `/support/inquiries/:id` | 모든 관리자 | 문의 삭제 |

### 환불 관리
| Method | Endpoint | 권한 | 설명 |
|--------|----------|------|------|
| GET | `/refunds` | 모든 관리자 | 환불 목록 |
| GET | `/refunds/:refundId` | 모든 관리자 | 환불 상세 |
| PATCH | `/refunds/:refundId/approve` | super_admin, admin | 환불 승인 |
| PATCH | `/refunds/:refundId/reject` | super_admin, admin | 환불 거절 |

### 렌탈 주문 관리
| Method | Endpoint | 권한 | 설명 |
|--------|----------|------|------|
| GET | `/rental-orders` | 모든 관리자 | 주문 목록 |
| GET | `/rental-orders/:rentalOrderId` | 모든 관리자 | 주문 상세 |
| GET | `/contracts/:contractId/rental-history` | 모든 관리자 | 계약별 렌탈 이력 |
| POST | `/rental-orders/:rentalOrderId/items/:itemId/cancel` | super_admin, admin | 아이템 취소 |
| PATCH | `/rental-orders/:rentalOrderId/delivery-status` | super_admin, admin | 배송 상태 변경 |

---

> 총 **55개** 관리자 API 엔드포인트 (v3.0.0 기준)
