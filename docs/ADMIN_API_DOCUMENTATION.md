# 관리자 API 문서

> **작성일**: 2025-10-27
> **버전**: 2.0.0 (Admin 테이블 분리)
> **베이스 URL**: `http://localhost:3000/api/admin`

---

## 📋 목차

1. [인증](#인증)
2. [관리자 인증 API](#관리자-인증-api)
3. [대시보드 API](#대시보드-api)
4. [유저 관리 API](#유저-관리-api)
5. [매물 관리 API](#매물-관리-api)
6. [예약 관리 API](#예약-관리-api)
7. [방 정보 관리 API](#방-정보-관리-api) ⭐ NEW
8. [에러 코드](#에러-코드)

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
  username: string (UNIQUE),
  password: string (bcrypt 해싱),
  name: string,
  phoneNumber: string | null,
  role: 'super_admin' | 'admin' | 'cs_admin',
  isActive: boolean,
  lastLoginAt: Date | null,
  refreshToken: string | null,
  createdAt: Date,
  updatedAt: Date
}
```

---

## 🔑 관리자 인증 API

### 1. 관리자 로그인

**엔드포인트**: `POST /api/admin/auth/login`

**인증 필요**: 없음

**설명**: 관리자 계정으로 로그인하여 JWT 토큰을 발급받습니다.

**요청 바디**:
```json
{
  "username": "admin",
  "password": "admin1234!"
}
```

**응답 예시**:
```json
{
  "success": true,
  "message": "로그인 성공",
  "data": {
    "admin": {
      "id": 1,
      "username": "admin",
      "name": "관리자",
      "role": "super_admin",
      "lastLoginAt": "2025-10-27T10:30:00.000Z"
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**에러 응답**:
```json
{
  "success": false,
  "code": 4007,
  "message": "아이디 또는 비밀번호가 올바르지 않습니다."
}
```

---

### 2. 관리자 로그아웃

**엔드포인트**: `POST /api/admin/auth/logout`

**인증 필요**: ✅ (관리자)

**설명**: 관리자 로그아웃 (Refresh Token 삭제)

**응답 예시**:
```json
{
  "success": true,
  "message": "로그아웃 성공"
}
```

---

### 3. 관리자 정보 조회

**엔드포인트**: `GET /api/admin/auth/me`

**인증 필요**: ✅ (관리자)

**설명**: 현재 로그인한 관리자의 정보를 조회합니다.

**응답 예시**:
```json
{
  "success": true,
  "message": "관리자 정보 조회 성공",
  "data": {
    "id": 1,
    "username": "admin",
    "name": "관리자",
    "phoneNumber": "010-1234-5678",
    "role": "super_admin",
    "isActive": true,
    "lastLoginAt": "2025-10-27T10:30:00.000Z",
    "createdAt": "2025-01-01T00:00:00.000Z",
    "updatedAt": "2025-10-27T10:30:00.000Z"
  }
}
```

---

## 📊 대시보드 API

### 1. 대시보드 통계 조회

**엔드포인트**: `GET /api/admin/dashboard/stats`

**권한**: 모든 관리자

**설명**: 대시보드에 표시할 주요 통계를 조회합니다.

**응답 예시**:
```json
{
  "success": true,
  "message": "대시보드 통계 조회 성공",
  "data": {
    "totalUsers": 1247,
    "totalProperties": 389,
    "activeReservations": 156,
    "monthlyRevenue": 45820000,
    "pendingReviews": 12,
    "pendingInquiries": 8,
    "trends": {
      "user": {
        "value": 12.5,
        "isPositive": true
      },
      "property": {
        "value": 8.3,
        "isPositive": true
      },
      "reservation": {
        "value": -3.2,
        "isPositive": false
      },
      "revenue": {
        "value": 15.2,
        "isPositive": true
      }
    }
  }
}
```

**응답 필드 설명**:
- `totalUsers`: 전체 활성 사용자 수
- `totalProperties`: 전체 등록 매물 수 (published 상태)
- `activeReservations`: 현재 활성 예약 수 (결제완료 + 진행중)
- `monthlyRevenue`: 이번 달 총 매출 (원)
- `pendingReviews`: 심사 대기 중인 매물 수
- `pendingInquiries`: 미답변 문의 수
- `trends`: 전월 대비 증감률 (%)
  - `value`: 증감률 (양수: 증가, 음수: 감소)
  - `isPositive`: 증가 여부

---

### 2. 최근 활동 조회

**엔드포인트**: `GET /api/admin/dashboard/recent-activities`

**권한**: 모든 관리자

**설명**: 최근 예약 및 문의 활동을 조회합니다.

**응답 예시**:
```json
{
  "success": true,
  "message": "최근 활동 조회 성공",
  "data": {
    "recentReservations": [
      {
        "id": 123,
        "status": "PAYMENT_COMPLETED",
        "checkInDate": "2025-11-01",
        "checkOutDate": "2025-11-15",
        "finalTotalAmount": 1200000,
        "guest": {
          "id": 45,
          "name": "홍길동",
          "email": "hong@example.com"
        },
        "room": {
          "id": 78,
          "roomName": "강남 신축 원룸",
          "address": "서울 강남구 테헤란로 123"
        },
        "createdAt": "2025-10-25T10:30:00.000Z"
      }
    ],
    "recentInquiries": []
  }
}
```

---

## 👥 유저 관리 API

### 1. 유저 목록 조회

**엔드포인트**: `GET /api/admin/users`

**권한**: 모든 관리자

**쿼리 파라미터**:
| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|---------|------|------|--------|------|
| page | number | X | 1 | 페이지 번호 |
| limit | number | X | 20 | 페이지당 항목 수 |
| search | string | X | - | 검색어 (이메일, 이름, 전화번호) |
| userType | string | X | - | 회원 타입 (local, social) |
| isActive | boolean | X | - | 활성 상태 (true, false) |
| sortBy | string | X | createdAt | 정렬 기준 |
| sortOrder | string | X | DESC | 정렬 순서 (ASC, DESC) |

**사용 예시**:
```http
GET /api/admin/users?page=1&limit=20&search=hong&userType=local&isActive=true
```

**응답 예시**:
```json
{
  "success": true,
  "message": "유저 목록 조회 성공",
  "data": {
    "users": [
      {
        "id": 1,
        "email": "hong@example.com",
        "name": "홍길동",
        "phoneNumber": "010-1234-5678",
        "phoneVerified": true,
        "userType": "local",
        "isActive": true,
        "isAdmin": false,
        "adminRole": null,
        "lastLoginAt": "2025-10-27T09:00:00.000Z",
        "createdAt": "2025-01-15T10:30:00.000Z"
      }
    ],
    "pagination": {
      "total": 1247,
      "page": 1,
      "limit": 20,
      "totalPages": 63
    }
  }
}
```

---

### 2. 유저 상세 조회

**엔드포인트**: `GET /api/admin/users/:userId`

**권한**: 모든 관리자

**URL 파라미터**:
- `userId` (number): 사용자 ID

**응답 예시**:
```json
{
  "success": true,
  "message": "유저 상세 조회 성공",
  "data": {
    "id": 1,
    "email": "hong@example.com",
    "name": "홍길동",
    "phoneNumber": "010-1234-5678",
    "phoneVerified": true,
    "phoneVerifiedAt": "2025-01-16T14:00:00.000Z",
    "profileImageUrl": "https://example.com/profile.jpg",
    "userType": "local",
    "isActive": true,
    "lastLoginAt": "2025-10-27T09:00:00.000Z",
    "serviceTermsAgreed": true,
    "privacyPolicyAgreed": true,
    "marketingConsent": false,
    "ageConfirmed": true,
    "termsAgreedAt": "2025-01-15T10:30:00.000Z",
    "isAdmin": false,
    "adminRole": null,
    "createdAt": "2025-01-15T10:30:00.000Z",
    "updatedAt": "2025-10-27T09:00:00.000Z",
    "rooms": [
      {
        "id": 78,
        "roomName": "강남 신축 원룸",
        "status": "published",
        "createdAt": "2025-02-01T10:00:00.000Z"
      }
    ],
    "hostRoomsCount": 1,
    "guestReservationsCount": 3
  }
}
```

---

### 3. 유저 상태 변경

**엔드포인트**: `PATCH /api/admin/users/:userId/status`

**권한**: super_admin, admin

**URL 파라미터**:
- `userId` (number): 사용자 ID

**요청 바디**:
```json
{
  "isActive": false
}
```

**요청 필드 설명**:
- `isActive` (boolean, 필수): 활성화 여부

**응답 예시**:
```json
{
  "success": true,
  "message": "유저 상태 변경 성공",
  "data": {
    "id": 1,
    "email": "hong@example.com",
    "isActive": false,
    "updatedAt": "2025-10-27T10:00:00.000Z"
  }
}
```

---

## 🏠 매물 관리 API

### 1. 매물 목록 조회

**엔드포인트**: `GET /api/admin/properties`

**권한**: 모든 관리자

**쿼리 파라미터**:
| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|---------|------|------|--------|------|
| page | number | X | 1 | 페이지 번호 |
| limit | number | X | 20 | 페이지당 항목 수 |
| search | string | X | - | 검색어 (방 이름, 주소) |
| status | string | X | - | 매물 상태 |
| sortBy | string | X | createdAt | 정렬 기준 |
| sortOrder | string | X | DESC | 정렬 순서 |

**매물 상태 종류**:
- `draft`: 작성중
- `pending_review`: 심사 대기
- `approved`: 승인됨
- `rejected`: 반려됨
- `published`: 게시됨

**사용 예시**:
```http
GET /api/admin/properties?page=1&limit=20&status=pending_review
```

**응답 예시**:
```json
{
  "success": true,
  "message": "매물 목록 조회 성공",
  "data": {
    "properties": [
      {
        "id": 78,
        "roomName": "강남 신축 원룸",
        "address": "서울 강남구 테헤란로 123",
        "area": 25.5,
        "dailyRent": 50000,
        "status": "pending_review",
        "submittedAt": "2025-10-25T10:00:00.000Z",
        "createdAt": "2025-10-20T14:00:00.000Z",
        "host": {
          "id": 1,
          "name": "홍길동",
          "email": "hong@example.com",
          "phoneNumber": "010-1234-5678"
        },
        "photos": [
          {
            "id": 201,
            "photoUrl": "/uploads/rooms/123/photo1.jpg"
          }
        ]
      }
    ],
    "pagination": {
      "total": 389,
      "page": 1,
      "limit": 20,
      "totalPages": 20
    }
  }
}
```

---

### 2. 심사 대기 매물 조회

**엔드포인트**: `GET /api/admin/properties/pending-review`

**권한**: 모든 관리자

**쿼리 파라미터**:
| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|---------|------|------|--------|------|
| page | number | X | 1 | 페이지 번호 |
| limit | number | X | 20 | 페이지당 항목 수 |

**설명**: `status='pending_review'` 상태인 매물만 조회하며, 제출일(submittedAt) 순으로 정렬됩니다.

**응답 예시**:
```json
{
  "success": true,
  "message": "심사 대기 매물 조회 성공",
  "data": {
    "properties": [
      {
        "id": 78,
        "roomName": "강남 신축 원룸",
        "address": "서울 강남구 테헤란로 123",
        "detailAddress": "101호",
        "area": 25.5,
        "dailyRent": 50000,
        "status": "pending_review",
        "submittedAt": "2025-10-25T10:00:00.000Z",
        "host": {
          "id": 1,
          "name": "홍길동",
          "email": "hong@example.com",
          "phoneNumber": "010-1234-5678"
        },
        "photos": [
          {
            "id": 201,
            "photoUrl": "/uploads/rooms/123/photo1.jpg",
            "displayOrder": 1
          },
          {
            "id": 202,
            "photoUrl": "/uploads/rooms/123/photo2.jpg",
            "displayOrder": 2
          }
        ]
      }
    ],
    "pagination": {
      "total": 12,
      "page": 1,
      "limit": 20,
      "totalPages": 1
    }
  }
}
```

---

### 3. 매물 상세 조회

**엔드포인트**: `GET /api/admin/properties/:roomId`

**권한**: 모든 관리자

**URL 파라미터**:
- `roomId` (number): 방 ID

**설명**:
- 심사를 위해 특정 매물의 **모든 상세 정보**를 조회합니다.
- 게스트용 API와 달리 **민감정보를 포함**합니다 (`entrancePassword`, `detailAddress`).
- 모든 상태(`draft`, `pending_review`, `approved`, `rejected`, `published`)의 매물을 조회할 수 있습니다.

**포함 데이터**:
- ✅ 방 기본 정보 (모든 필드)
- ✅ 요금 정보 (임대료, 관리비, 청소비, 할인율 등)
- ✅ 호스트 정보 (이름, 이메일, 전화번호)
- ✅ 모든 사진 (displayOrder 순)
- ✅ 편의시설 (RoomAmenity)
- ✅ 무료 부가서비스 (RoomFreeService)
- ✅ 방 소개 (description, transportation, houseRules)
- ✅ 민감정보 (entrancePassword, detailAddress)

**사용 예시**:
```http
GET /api/admin/properties/78
Authorization: Bearer {accessToken}
```

**응답 예시**:
```json
{
  "success": true,
  "message": "매물 상세 조회 성공",
  "data": {
    "id": 78,
    "roomName": "강남 신축 원룸",
    "address": "서울 강남구 테헤란로 123",
    "detailAddress": "101호",
    "latitude": 37.5012345,
    "longitude": 127.0398765,
    "area": 25.5,
    "floor": "4층",
    "buildingType": "오피스텔",
    "parkingAvailable": true,
    "parkingInfo": "1대 가능",
    "elevatorAvailable": true,
    "roomCount": 1,
    "bathroomCount": 1,
    "isDuplex": false,
    "entrancePassword": "1234*",

    "dailyRent": 50000,
    "dailyMaintenanceFee": 5000,
    "maintenanceDetail": "전기, 수도, 가스 포함",
    "longTermWeeks": 4,
    "longTermDiscount": 10,
    "quickMoveIn": "3일 이내",
    "quickMoveInDiscount": 5,
    "includeElectricity": true,
    "includeWater": true,
    "includeGas": true,
    "includeInternet": true,
    "cleaningFee": 30000,
    "minContractWeeks": 1,
    "refundPolicy": "유연",

    "photos": [
      {
        "id": 201,
        "url": "/uploads/rooms/photo1.jpg",
        "order": 0
      },
      {
        "id": 202,
        "url": "/uploads/rooms/photo2.jpg",
        "order": 1
      },
      {
        "id": 203,
        "url": "/uploads/rooms/photo3.jpg",
        "order": 2
      }
    ],

    "amenities": {
      "basicOptions": {
        "bed": true,
        "desk": true,
        "closet": true,
        "shoeRack": true
      },
      "additionalOptions": {
        "airConditioner": true,
        "refrigerator": true,
        "washingMachine": true,
        "tv": true
      },
      "convenienceOptions": {
        "wifi": true,
        "microwave": true,
        "inductionStove": true
      },
      "petsAllowed": false
    },

    "freeServices": {
      "agreeTerms": true,
      "cleaningService": true,
      "cleaningToolImageUrl": "/uploads/rooms/cleaning.jpg",
      "hairDryerRental": true,
      "beddingService": true,
      "bedSizes": {
        "슈퍼싱글": 1,
        "퀸": 0,
        "킹": 0
      },
      "amenityKit": true,
      "autoPasswordChange": false,
      "roomPassword": null
    },

    "description": "깔끔하게 리모델링한 신축 원룸입니다.",
    "transportation": "지하철 2호선 강남역 도보 5분, 버스 정류장 바로 앞",
    "houseRules": "금연, 반려동물 불가",

    "status": "pending_review",
    "submittedAt": "2025-10-25T10:00:00.000Z",
    "approvedAt": null,
    "publishedAt": null,
    "rejectionReason": null,
    "createdAt": "2025-10-20T14:00:00.000Z",
    "updatedAt": "2025-10-25T10:00:00.000Z",

    "host": {
      "id": 1,
      "name": "홍길동",
      "email": "hong@example.com",
      "phoneNumber": "010-1234-5678",
      "phoneVerified": true,
      "hasBankAccount": true
    },

    "registrationProgress": {
      "currentStep": "completed",
      "completionRate": 100,
      "steps": {
        "basicInfo": true,
        "pricing": true,
        "photosAndAmenities": true,
        "freeServices": true,
        "description": true
      }
    }
  }
}
```

**에러 응답**:
```json
{
  "success": false,
  "code": 3003,
  "message": "방을 찾을 수 없습니다."
}
```

---

### 4. 매물 승인

**엔드포인트**: `POST /api/admin/properties/:roomId/approve`

**권한**: super_admin, admin

**URL 파라미터**:
- `roomId` (number): 방 ID

**설명**:
- `pending_review` 상태의 매물을 `approved` 상태로 변경합니다.
- `approvedAt` 필드에 현재 시각이 기록됩니다.

**응답 예시**:
```json
{
  "success": true,
  "message": "매물 승인 완료",
  "data": {
    "id": 78,
    "roomName": "강남 신축 원룸",
    "status": "approved",
    "approvedAt": "2025-10-27T10:30:00.000Z",
    "updatedAt": "2025-10-27T10:30:00.000Z"
  }
}
```

**에러 응답**:
```json
{
  "success": false,
  "code": 4301,
  "message": "심사 대기 중인 매물만 승인할 수 있습니다."
}
```

---

### 5. 매물 반려

**엔드포인트**: `POST /api/admin/properties/:roomId/reject`

**권한**: super_admin, admin

**URL 파라미터**:
- `roomId` (number): 방 ID

**요청 바디**:
```json
{
  "rejectionReason": "사진 품질이 낮습니다. 밝고 선명한 사진으로 다시 업로드해주세요."
}
```

**요청 필드 설명**:
- `rejectionReason` (string, 필수): 반려 사유

**설명**:
- `pending_review` 상태의 매물을 `rejected` 상태로 변경합니다.
- `rejectionReason` 필드에 반려 사유가 저장됩니다.

**응답 예시**:
```json
{
  "success": true,
  "message": "매물 반려 완료",
  "data": {
    "id": 78,
    "roomName": "강남 신축 원룸",
    "status": "rejected",
    "rejectionReason": "사진 품질이 낮습니다. 밝고 선명한 사진으로 다시 업로드해주세요.",
    "updatedAt": "2025-10-27T10:30:00.000Z"
  }
}
```

---

## 📅 예약 관리 API

### 1. 예약 목록 조회

**엔드포인트**: `GET /api/admin/reservations`

**권한**: 모든 관리자

**쿼리 파라미터**:
| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|---------|------|------|--------|------|
| page | number | X | 1 | 페이지 번호 |
| limit | number | X | 20 | 페이지당 항목 수 |
| status | string | X | - | 예약 상태 |
| search | string | X | - | 검색어 (게스트 이름, 이메일) |
| sortBy | string | X | createdAt | 정렬 기준 |
| sortOrder | string | X | DESC | 정렬 순서 |

**예약 상태 종류**:
- `PENDING_APPROVAL`: 승인 대기
- `APPROVED`: 승인됨 (결제 대기)
- `REJECTED`: 거절됨
- `PAYMENT_COMPLETED`: 결제 완료
- `IN_PROGRESS`: 진행중 (체크인 완료)
- `COMPLETED`: 완료 (체크아웃 완료)
- `CANCELLED_BY_GUEST`: 게스트 취소
- `CANCELLED_BY_HOST`: 호스트 취소
- `REFUNDED`: 환불 완료
- `APPROVAL_EXPIRED`: 미승인 만료
- `PAYMENT_EXPIRED`: 미결제 만료

**사용 예시**:
```http
GET /api/admin/reservations?page=1&limit=20&status=PAYMENT_COMPLETED
```

**응답 예시**:
```json
{
  "success": true,
  "message": "예약 목록 조회 성공",
  "data": {
    "reservations": [
      {
        "id": 123,
        "status": "PAYMENT_COMPLETED",
        "checkInDate": "2025-11-01",
        "checkOutDate": "2025-11-15",
        "totalDays": 14,
        "rentalFee": 700000,
        "maintenanceFee": 200000,
        "cleaningFee": 50000,
        "platformFee": 150000,
        "discountAmount": 100000,
        "finalTotalAmount": 1200000,
        "paymentMethod": "card",
        "paidAt": "2025-10-26T14:00:00.000Z",
        "createdAt": "2025-10-25T10:30:00.000Z",
        "guest": {
          "id": 45,
          "name": "홍길동",
          "email": "hong@example.com",
          "phoneNumber": "010-1234-5678"
        },
        "host": {
          "id": 1,
          "name": "김호스트",
          "email": "host@example.com"
        },
        "room": {
          "id": 78,
          "roomName": "강남 신축 원룸",
          "address": "서울 강남구 테헤란로 123"
        }
      }
    ],
    "pagination": {
      "total": 156,
      "page": 1,
      "limit": 20,
      "totalPages": 8
    }
  }
}
```

---

### 2. 예약 상세 조회

**엔드포인트**: `GET /api/admin/reservations/:contractId`

**권한**: 모든 관리자

**URL 파라미터**:
- `contractId` (number): 계약 ID

**응답 예시**:
```json
{
  "success": true,
  "message": "예약 상세 조회 성공",
  "data": {
    "id": 123,
    "status": "PAYMENT_COMPLETED",
    "checkInDate": "2025-11-01",
    "checkOutDate": "2025-11-15",
    "totalDays": 14,
    "totalWeeks": 2,
    "rentalFee": 700000,
    "maintenanceFee": 200000,
    "cleaningFee": 50000,
    "rentalItemsFee": 30000,
    "platformFee": 150000,
    "discountAmount": 100000,
    "discountType": "long_term",
    "discountCode": null,
    "subtotal": 980000,
    "totalUsageFee": 1130000,
    "deposit": 500000,
    "finalTotalAmount": 1630000,
    "rentalItems": [
      {
        "itemType": "hair_dryer",
        "name": "헤어드라이기",
        "price": 15000,
        "quantity": 1
      },
      {
        "itemType": "bedding_set",
        "name": "침구 세트",
        "price": 15000,
        "quantity": 1
      }
    ],
    "paymentMethod": "card",
    "installmentMonths": 0,
    "guestMessage": "깨끗하게 사용하겠습니다.",
    "hostMessage": "환영합니다!",
    "specialRequests": {
      "earlyCheckIn": false,
      "lateCheckOut": false
    },
    "termsAgreed": {
      "serviceTerms": true,
      "cancellationPolicy": true
    },
    "pricingSnapshot": {
      "dailyRent": 50000,
      "dailyMaintenanceFee": 14285,
      "longTermDiscount": 10
    },
    "approvedAt": "2025-10-25T15:00:00.000Z",
    "paidAt": "2025-10-26T14:00:00.000Z",
    "createdAt": "2025-10-25T10:30:00.000Z",
    "updatedAt": "2025-10-26T14:00:00.000Z",
    "guest": {
      "id": 45,
      "email": "hong@example.com",
      "name": "홍길동",
      "phoneNumber": "010-1234-5678",
      "phoneVerified": true,
      "userType": "local",
      "isActive": true
    },
    "host": {
      "id": 1,
      "email": "host@example.com",
      "name": "김호스트",
      "phoneNumber": "010-9876-5432",
      "isActive": true
    },
    "room": {
      "id": 78,
      "roomName": "강남 신축 원룸",
      "address": "서울 강남구 테헤란로 123",
      "area": 25.5,
      "status": "published",
      "photos": [
        {
          "id": 201,
          "photoUrl": "/uploads/rooms/123/photo1.jpg",
          "displayOrder": 1
        }
      ]
    }
  }
}
```

---

## ❌ 에러 코드

### 인증 관련 (1xxx)
| 코드 | 메시지 | HTTP 상태 |
|-----|--------|----------|
| 1001 | 인증이 필요합니다. | 401 |
| 1002 | 유효하지 않은 토큰입니다. | 401 |
| 1003 | 토큰이 만료되었습니다. | 401 |

### 권한 관련 (2xxx)
| 코드 | 메시지 | HTTP 상태 |
|-----|--------|----------|
| 2001 | 권한이 없습니다. | 403 |
| 2002 | 소유자만 접근 가능합니다. | 403 |
| 2003 | 호스트만 접근 가능합니다. | 403 |

### 리소스 관련 (3xxx)
| 코드 | 메시지 | HTTP 상태 |
|-----|--------|----------|
| 3001 | 리소스를 찾을 수 없습니다. | 404 |
| 3002 | 방을 찾을 수 없습니다. | 404 |
| 3003 | 사용자를 찾을 수 없습니다. | 404 |
| 3005 | 예약을 찾을 수 없습니다. | 404 |

### 검증 관련 (4xxx)
| 코드 | 메시지 | HTTP 상태 |
|-----|--------|----------|
| 4001 | 입력값이 유효하지 않습니다. | 400 |
| 4002 | 필수 정보를 모두 입력해주세요. | 400 |
| 4301 | 심사 대기 중인 매물만 승인할 수 있습니다. | 400 |
| 4302 | 심사 대기 중인 매물만 반려할 수 있습니다. | 400 |

### 서버 관련 (5xxx)
| 코드 | 메시지 | HTTP 상태 |
|-----|--------|----------|
| 5001 | 서버 오류가 발생했습니다. | 500 |
| 5002 | 데이터베이스 오류가 발생했습니다. | 500 |

---

## 📝 사용 예시

### 1. 관리자 로그인 후 대시보드 조회

```javascript
// 1. 관리자 로그인 (Admin 테이블)
const loginResponse = await fetch('http://localhost:3000/api/admin/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'admin@ezstay.com',
    password: 'admin1234!'
  })
});

const { data: { accessToken } } = await loginResponse.json();

// 2. 대시보드 통계 조회
const statsResponse = await fetch('http://localhost:3000/api/admin/dashboard/stats', {
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});

const stats = await statsResponse.json();
console.log(stats.data);
```

### 2. 매물 심사 처리

```javascript
// 심사 대기 매물 조회
const pendingResponse = await fetch(
  'http://localhost:3000/api/admin/properties/pending-review?page=1&limit=10',
  {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  }
);

const { data: { properties } } = await pendingResponse.json();

// 첫 번째 매물 승인
const roomId = properties[0].id;
const approveResponse = await fetch(
  `http://localhost:3000/api/admin/properties/${roomId}/approve`,
  {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}` }
  }
);

// 또는 반려
const rejectResponse = await fetch(
  `http://localhost:3000/api/admin/properties/${roomId}/reject`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      rejectionReason: '사진 품질이 낮습니다.'
    })
  }
);
```

### 3. 유저 관리

```javascript
// 유저 검색
const usersResponse = await fetch(
  'http://localhost:3000/api/admin/users?search=hong&page=1&limit=20',
  {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  }
);

const { data: { users } } = await usersResponse.json();

// 특정 유저 상세 조회
const userId = users[0].id;
const userDetailResponse = await fetch(
  `http://localhost:3000/api/admin/users/${userId}`,
  {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  }
);

// 유저 비활성화
const updateStatusResponse = await fetch(
  `http://localhost:3000/api/admin/users/${userId}/status`,
  {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      isActive: false
    })
  }
);
```

---

## 🔧 개발 가이드

### 관리자 계정 생성 방법

**중요**: 관리자는 Admin 테이블에 별도로 생성됩니다. User 테이블과 완전히 분리되어 있습니다.

#### 방법 1: SQL로 직접 생성 (추천)

```sql
-- 비밀번호 해싱이 필요하므로, 먼저 bcrypt로 해싱된 비밀번호를 생성해야 합니다
-- Node.js에서 비밀번호 해싱:
-- const bcrypt = require('bcryptjs');
-- const hashedPassword = await bcrypt.hash('admin1234!', 10);

INSERT INTO admins (
  email,
  password,
  name,
  phone_number,
  role,
  is_active,
  created_at,
  updated_at
)
VALUES (
  'admin@ezstay.com',
  '$2a$10$...', -- bcrypt 해싱된 비밀번호
  '관리자',
  '010-1234-5678',
  'super_admin',
  true,
  NOW(),
  NOW()
);
```

#### 방법 2: Node.js 스크립트로 생성

`scripts/createAdmin.js` 파일을 만들어 실행:

```javascript
const bcrypt = require('bcryptjs');
const { Admin } = require('./models');

async function createAdmin() {
  const hashedPassword = await bcrypt.hash('admin1234!', 10);

  const admin = await Admin.create({
    email: 'admin@ezstay.com',
    password: hashedPassword,
    name: '관리자',
    phoneNumber: '010-1234-5678',
    role: 'super_admin',
    isActive: true
  });

  console.log('관리자 계정 생성 완료:', admin.email);
}

createAdmin();
```

```bash
node scripts/createAdmin.js
```

### 권한 체크 로직

미들웨어가 다음 순서로 권한을 체크합니다:

1. **authenticateAdmin**: JWT 토큰 검증 + Admin 테이블 조회
2. **requireAdminRole(['super_admin', 'admin'])**: 특정 역할 확인 (선택)

---

## 📌 주의사항

1. **모든 관리자 API는 `/api/admin` 경로 사용**
2. **권한이 필요한 작업은 `requireAdminRole` 미들웨어 적용**
3. **민감한 정보(refreshToken 등)는 응답에서 제외**
4. **검색/필터링 기능은 SQL Injection 방지를 위해 Sequelize ORM 사용**
5. **페이지네이션은 기본 20개 항목, 최대 100개까지 조회 가능**

---

## 📝 방 정보 관리 API

### 1. 방 상세 정보 조회 (관리자 전용)

**Endpoint**: `GET /api/admin/properties/:roomId/management`

**설명**: 방 번호, 호스트 정보, 계약 내역, 메모를 포함한 전체 정보 조회

**권한**: 모든 관리자

**응답 예시**:
```json
{
  "success": true,
  "message": "방 상세 정보 조회 완료",
  "data": {
    "roomInfo": {
      "id": 1,
      "roomName": "평화로에 위치한 대학생 아파트",
      "status": "published",
      "entrancePassword": "123456",
      "address": "서울 대학로",
      "detailAddress": "101동 502호",
      "dailyRent": 50000,
      "createdAt": "2023-12-01T10:00:00.000Z",
      "updatedAt": "2023-12-15T14:30:00.000Z"
    },
    "hostInfo": {
      "id": 10,
      "name": "김민준",
      "email": "minjun.kim@example.com",
      "phoneNumber": "010-1234-5678"
    },
    "contracts": [
      {
        "id": "20231201-001",
        "guestName": "이현우",
        "guestPhone": "010-9876-5432",
        "checkInDate": "2023-12-15",
        "checkOutDate": "2023-12-20",
        "status": "IN_PROGRESS",
        "totalAmount": 300000,
        "createdAt": "2023-12-01T09:00:00.000Z"
      }
    ],
    "memos": [
      {
        "id": 5,
        "content": "게스트 이연우님 계약 만료 후 재계약 요청",
        "createdBy": "관리자",
        "createdAt": "2023-12-10T15:20:00.000Z",
        "updatedAt": "2023-12-10T15:20:00.000Z"
      }
    ]
  }
}
```

---

### 2. 방 상태 변경

**Endpoint**: `PATCH /api/admin/properties/:roomId/status`

**설명**: 방 게시 상태를 변경합니다 (게시중 ↔ 비게시)

**권한**: super_admin, admin

**요청 Body**:
```json
{
  "status": "published",  // 또는 "hidden_by_admin"
  "reason": "호스트 요청으로 임시 비공개"  // hidden_by_admin 시 선택사항
}
```

**허용 상태값**:
- `published`: 게시중
- `hidden_by_admin`: 관리자가 임시로 숨긴 상태

**응답 예시**:
```json
{
  "success": true,
  "message": "방 상태 변경 완료",
  "data": {
    "roomId": 1,
    "previousStatus": "published",
    "newStatus": "hidden_by_admin",
    "reason": "호스트 요청으로 임시 비공개"
  }
}
```

**에러 응답**:
```json
{
  "success": false,
  "error": {
    "code": 4001,
    "message": "허용되지 않은 상태값입니다. (허용: published, hidden_by_admin)"
  }
}
```

---

### 3. 방 상태 변경 이력 조회

**Endpoint**: `GET /api/admin/properties/:roomId/status-history`

**설명**: 방 게시 상태 변경 이력을 조회합니다 (보안 감사용)

**권한**: super_admin, admin

**Query 파라미터**:
- `limit` (선택): 조회 개수 (기본값: 20, 최대: 50)
- `offset` (선택): 페이지네이션 오프셋 (기본값: 0)

**응답 예시 (super_admin)**:
```json
{
  "success": true,
  "message": "상태 변경 이력 조회 완료",
  "data": {
    "total": 15,
    "histories": [
      {
        "id": 3,
        "previousStatus": "published",
        "newStatus": "hidden_by_admin",
        "reason": "호스트 요청으로 임시 비공개",
        "changedBy": "김관리",
        "changedAt": "2023-12-15T14:30:00.000Z",
        "ipAddress": "192.168.1.100",
        "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      },
      {
        "id": 2,
        "previousStatus": "hidden_by_admin",
        "newStatus": "published",
        "reason": "문제 해결 완료",
        "changedBy": "이관리",
        "changedAt": "2023-12-10T09:15:00.000Z",
        "ipAddress": "192.168.1.50",
        "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"
      }
    ],
    "pagination": {
      "limit": 20,
      "offset": 0,
      "hasMore": false
    }
  }
}
```

**응답 예시 (admin, cs_admin - IP/UserAgent 제외)**:
```json
{
  "success": true,
  "message": "상태 변경 이력 조회 완료",
  "data": {
    "total": 15,
    "histories": [
      {
        "id": 3,
        "previousStatus": "published",
        "newStatus": "hidden_by_admin",
        "reason": "호스트 요청으로 임시 비공개",
        "changedBy": "김관리",
        "changedAt": "2023-12-15T14:30:00.000Z"
      }
    ],
    "pagination": {
      "limit": 20,
      "offset": 0,
      "hasMore": false
    }
  }
}
```

**에러 응답**:
```json
{
  "success": false,
  "error": {
    "code": 3001,
    "message": "방을 찾을 수 없습니다."
  }
}
```

---

### 4. 방 비밀번호 변경

**Endpoint**: `PATCH /api/admin/properties/:roomId/password`

**설명**: 방 출입 비밀번호를 변경합니다

**권한**: super_admin, admin

**요청 Body**:
```json
{
  "newPassword": "654321"
}
```

**비밀번호 형식**: 4~8자리 숫자만 가능

**응답 예시**:
```json
{
  "success": true,
  "message": "방 비밀번호 변경 완료",
  "data": {
    "roomId": 1,
    "previousPassword": "123456",
    "newPassword": "654321"
  }
}
```

**에러 응답**:
```json
{
  "success": false,
  "error": {
    "code": 4004,
    "message": "비밀번호는 4~50자 이내로 입력해주세요."
  }
}
```

---

### 5. 비밀번호 변경 이력 조회

**Endpoint**: `GET /api/admin/properties/:roomId/password-history`

**설명**: 특정 방의 비밀번호 변경 이력을 조회합니다 (보안 감사용)

**권한**: `super_admin`, `admin`

**Query Parameters**:
- `limit` (선택, 기본값: 20): 페이지당 항목 수
- `offset` (선택, 기본값: 0): 건너뛸 항목 수

**응답 예시 (super_admin)**:
```json
{
  "success": true,
  "message": "비밀번호 변경 이력 조회 완료",
  "data": {
    "histories": [
      {
        "id": 3,
        "previousPassword": "1234",
        "newPassword": "*1234#",
        "reason": "호스트 분실 신고로 인한 변경",
        "changedBy": "김철수",
        "changedAt": "2023-12-10T14:30:00.000Z",
        "ipAddress": "192.168.1.100",
        "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)..."
      },
      {
        "id": 2,
        "previousPassword": "5678",
        "newPassword": "1234",
        "reason": "게스트 체크아웃 후 보안 강화",
        "changedBy": "이영희",
        "changedAt": "2023-12-05T09:15:00.000Z",
        "ipAddress": "192.168.1.101",
        "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)..."
      }
    ],
    "pagination": {
      "total": 5,
      "limit": 20,
      "offset": 0,
      "hasMore": false
    }
  }
}
```

**응답 예시 (admin, cs_admin)**:
```json
{
  "success": true,
  "message": "비밀번호 변경 이력 조회 완료",
  "data": {
    "histories": [
      {
        "id": 3,
        "previousPassword": "1234",
        "newPassword": "*1234#",
        "reason": "호스트 분실 신고로 인한 변경",
        "changedBy": "김철수",
        "changedAt": "2023-12-10T14:30:00.000Z"
      }
    ],
    "pagination": {
      "total": 5,
      "limit": 20,
      "offset": 0,
      "hasMore": false
    }
  }
}
```

> **Note**: `ipAddress`와 `userAgent` 필드는 `super_admin` 권한에서만 조회 가능합니다.

**에러 응답**:
```json
{
  "success": false,
  "error": {
    "code": 3002,
    "message": "존재하지 않는 방입니다."
  }
}
```

---

### 6. 메모 생성

**Endpoint**: `POST /api/admin/properties/:roomId/memos`

**설명**: 방에 대한 관리 메모를 생성합니다

**권한**: 모든 관리자

**요청 Body**:
```json
{
  "content": "게스트 이연우님 계약 만료 후 재계약 요청"
}
```

**응답 예시**:
```json
{
  "success": true,
  "message": "메모 생성 완료",
  "data": {
    "id": 5,
    "content": "게스트 이연우님 계약 만료 후 재계약 요청",
    "createdBy": "관리자",
    "createdAt": "2023-12-10T15:20:00.000Z"
  }
}
```

**에러 응답**:
```json
{
  "success": false,
  "error": {
    "code": 4005,
    "message": "메모 내용을 입력해주세요."
  }
}
```

---

### 7. 메모 수정

**Endpoint**: `PATCH /api/admin/properties/:roomId/memos/:memoId`

**설명**: 기존 메모를 수정합니다

**권한**: 모든 관리자 (작성자와 무관하게 수정 가능)

**요청 Body**:
```json
{
  "content": "게스트 이연우님 재계약 완료 (12/15 ~ 12/20)"
}
```

**응답 예시**:
```json
{
  "success": true,
  "message": "메모 수정 완료",
  "data": {
    "id": 5,
    "content": "게스트 이연우님 재계약 완료 (12/15 ~ 12/20)",
    "createdBy": "관리자",
    "updatedAt": "2023-12-10T16:00:00.000Z"
  }
}
```

**에러 응답**:
```json
{
  "success": false,
  "error": {
    "code": 4006,
    "message": "해당 메모를 찾을 수 없습니다."
  }
}
```

---

### 8. 메모 삭제

**Endpoint**: `DELETE /api/admin/properties/:roomId/memos/:memoId`

**설명**: 메모를 삭제합니다

**권한**: 모든 관리자

**응답 예시**:
```json
{
  "success": true,
  "message": "메모 삭제 완료",
  "data": {
    "id": 5
  }
}
```

---

## 🚨 추가 에러 코드

| 코드 | 메시지 | 설명 |
|------|--------|------|
| 4001 | 허용되지 않은 상태값입니다 | 상태 변경 시 허용되지 않은 값 전송 |
| 4002 | 이미 해당 상태입니다 | 동일한 상태로 변경 시도 |
| 4003 | 새 비밀번호를 입력해주세요 | 비밀번호 누락 |
| 4004 | 비밀번호는 4~8자리 숫자만 가능합니다 | 비밀번호 형식 오류 |
| 4005 | 메모 내용을 입력해주세요 | 메모 내용 누락 |
| 4006 | 해당 메모를 찾을 수 없습니다 | 존재하지 않는 메모 접근 |

---

**작성자**: Ezstay Development Team
**최종 수정일**: 2025-01-14
