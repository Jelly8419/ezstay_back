# Ezstay Backend 아키텍처 문서

> 부동산 단기 임대 플랫폼 백엔드 시스템의 전체 아키텍처 문서

---

## 📋 목차

1. [프로젝트 개요](#1-프로젝트-개요)
2. [아키텍처 다이어그램](#2-아키텍처-다이어그램)
3. [데이터베이스 스키마](#3-데이터베이스-스키마)
4. [API 엔드포인트](#4-api-엔드포인트)
5. [인증 및 보안](#5-인증-및-보안)
6. [핵심 기능 플로우](#6-핵심-기능-플로우)
7. [기술 스택](#7-기술-스택)
8. [배포 및 운영](#8-배포-및-운영)

---

## 1. 프로젝트 개요

### 1.1 서비스 설명
**Ezstay**는 호스트가 단기 임대 숙소를 등록하고 게스트가 이를 예약하여 이용할 수 있는 부동산 단기 임대 플랫폼입니다.

### 1.2 주요 기능
- **사용자 관리**: 이메일/소셜 로그인, 본인인증, 계좌 등록
- **숙소 관리**: 방 등록/수정/삭제, 사진 업로드, 편의시설 관리
- **계약 관리**: 예약 요청, 승인/거절, 결제, 체크인/체크아웃
- **지도 검색**: Geohash 기반 지도 영역 검색, Redis 캐싱
- **렌탈 아이템**: 침구, 청소도구 등 추가 물품 대여

### 1.3 사용자 역할
- **게스트(Guest)**: 숙소를 검색하고 예약하는 사용자
- **호스트(Host)**: 숙소를 등록하고 관리하는 사용자
- **관리자(Admin)**: 플랫폼 전체를 관리하는 운영자 (향후 구현 예정)

---

## 2. 아키텍처 다이어그램

### 2.1 시스템 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                       Client Layer                          │
│  (React/Next.js Frontend - http://localhost:3000)           │
└────────────────────┬────────────────────────────────────────┘
                     │ HTTP/REST API
                     │ Authorization: Bearer JWT
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    API Gateway Layer                         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Express.js Server (Port 8080)                       │   │
│  │  - CORS, Helmet, Morgan                              │   │
│  │  - Rate Limiting (General, Auth, Upload)             │   │
│  │  - Error Handler, Not Found Handler                  │   │
│  └──────────────────────────────────────────────────────┘   │
└────────────────────┬────────────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
┌───────────┐ ┌───────────┐ ┌───────────┐
│  Routes   │ │Middleware │ │  Utils    │
│           │ │           │ │           │
│ - auth    │ │ - auth    │ │ - auth    │
│ - user    │ │ - upload  │ │ - validator│
│ - room    │ │ - rateLim │ │ - geocoding│
│ - host    │ │ - errorHdl│ │ - response│
│ - contract│ │ - validate│ │ - contract│
│ - account │ │           │ │           │
└─────┬─────┘ └─────┬─────┘ └─────┬─────┘
      │             │             │
      └─────────────┼─────────────┘
                    ▼
┌─────────────────────────────────────────────────────────────┐
│                   Business Logic Layer                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │             Controllers                              │   │
│  │  - authController                                    │   │
│  │  - oauthController                                   │   │
│  │  - userController                                    │   │
│  │  - roomController                                    │   │
│  │  - hostController                                    │   │
│  │  - contractController                                │   │
│  │  - accountController                                 │   │
│  │  - rentalItemController                              │   │
│  └──────────────────────────────────────────────────────┘   │
└────────────────────┬────────────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
┌───────────────┐ ┌──────────┐ ┌────────────┐
│  Data Layer   │ │  Cache   │ │ External   │
│               │ │          │ │  Services  │
│  MySQL        │ │  Redis   │ │            │
│  (Sequelize)  │ │          │ │ - Kakao    │
│               │ │ Geohash  │ │   OAuth    │
│ - users       │ │ based    │ │ - Kakao    │
│ - rooms       │ │ room     │ │   Local API│
│ - contracts   │ │ caching  │ │   (Geocode)│
│ - photos      │ │          │ │            │
│ - amenities   │ │          │ │            │
└───────────────┘ └──────────┘ └────────────┘
```

### 2.2 레이어 구조

#### **API Gateway Layer**
- Express.js 기반 HTTP 서버
- CORS 정책 관리
- Rate Limiting (Brute Force 방어)
- 전역 에러 핸들링
- 보안 헤더 설정 (Helmet)

#### **Business Logic Layer**
- RESTful API 라우팅
- 비즈니스 로직 처리 (Controllers)
- 데이터 검증 (Middleware)
- 인증/인가 처리 (JWT)

#### **Data Layer**
- MySQL 데이터베이스 (Sequelize ORM)
- Redis 캐시 (지도 검색 최적화)
- 파일 저장소 (Multer - /uploads)

#### **External Services**
- Kakao OAuth 2.0
- Kakao Local API (주소 → 좌표 변환)

---

## 3. 데이터베이스 스키마

### 3.1 ERD 다이어그램

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Users (공통 사용자)                          │
│  - id (PK)                                                           │
│  - email (unique)                                                    │
│  - name                                                              │
│  - phoneNumber, phoneVerified, phoneVerifiedAt                       │
│  - profileImageUrl                                                   │
│  - userType (local/social)                                           │
│  - refreshToken                                                      │
│  - isActive, lastLoginAt                                             │
│  - serviceTermsAgreed, privacyPolicyAgreed, marketingConsent         │
│  - ageConfirmed, termsAgreedAt                                       │
│  - createdAt, updatedAt                                              │
└────────┬─────────────────┬──────────────┬──────────────┬─────────────┘
         │ 1:1             │ 1:N          │ 1:N          │ 1:N
         ▼                 ▼              ▼              ▼
┌──────────────┐  ┌──────────────┐  ┌─────────┐  ┌──────────────────┐
│  LocalUser   │  │ SocialUser   │  │  Rooms  │  │ UserBankAccount  │
│  (이메일회원) │  │ (소셜회원)    │  │ (숙소)  │  │  (계좌정보)      │
├──────────────┤  ├──────────────┤  ├─────────┤  ├──────────────────┤
│ - id (PK)    │  │ - id (PK)    │  │ - id(PK)│  │ - id (PK)        │
│ - userId(FK) │  │ - userId(FK) │  │ -hostId │  │ - userId (FK)    │
│ - password   │  │ - provider   │  │  (FK)   │  │ - bankName       │
│              │  │ - providerId │  │ - name  │  │ - accountNumber  │
│              │  │ - accessToken│  │ - addr  │  │ - accountHolder  │
│              │  │              │  │ - lat   │  │ - isDefault      │
└──────────────┘  └──────────────┘  │ - lng   │  └──────────────────┘
                                    │ - area  │
                                    │ - rent  │
                      ┌─────────────┤ - status│───────┐
                      │             │ - ...   │       │
                      │             └────┬────┘       │
                      │ 1:N              │ 1:1        │ 1:N
                      ▼                  ▼            ▼
              ┌──────────────┐  ┌──────────────┐  ┌──────────┐
              │  RoomPhoto   │  │ RoomAmenity  │  │ Contract │
              │  (방 사진)    │  │ (편의시설)    │  │ (계약)   │
              ├──────────────┤  ├──────────────┤  ├──────────┤
              │ - id (PK)    │  │ - id (PK)    │  │ - id(PK) │
              │ - roomId(FK) │  │ - roomId(FK) │  │ -roomId  │
              │ - photoUrl   │  │ - wifi       │  │ -hostId  │
              │ - order      │  │ - aircon     │  │ -guestId │
              └──────────────┘  │ - parking    │  │ -checkIn │
                                │ - ...        │  │ -checkOut│
                                └──────────────┘  │ -status  │
                                                  │ -amounts │
              ┌───────────────────────────────────┤ -...     │
              │ 1:1                               └────┬─────┘
              ▼                                        │ 1:N
      ┌──────────────────┐                            ▼
      │ RoomFreeService  │              ┌────────────────────────────┐
      │ (무료부가서비스)  │              │ RentalItemReservation      │
      ├──────────────────┤              │ (렌탈아이템 예약)           │
      │ - id (PK)        │              ├────────────────────────────┤
      │ - roomId (FK)    │              │ - id (PK)                  │
      │ - cleaning       │              │ - contractId (FK)          │
      │ - bedding        │              │ - rentalItemId (FK)        │
      │ - hairDryer      │              │ - quantity                 │
      │ - ...            │              │ - totalPrice               │
      └──────────────────┘              └────────────────────────────┘
                                                     │ N:1
                                                     ▼
                                        ┌────────────────────────────┐
                                        │ RentalItem                 │
                                        │ (렌탈 아이템 마스터)        │
                                        ├────────────────────────────┤
                                        │ - id (PK)                  │
                                        │ - name                     │
                                        │ - category                 │
                                        │ - pricePerDay              │
                                        │ - stock                    │
                                        │ - imageUrl                 │
                                        └────────────────────────────┘
```

### 3.2 주요 테이블 설명

#### **Users (사용자 공통 정보)**
- 이메일/소셜 회원 통합 관리
- JWT Refresh Token 저장
- 약관 동의 정보 포함
- 본인인증 상태 관리

#### **Rooms (방/숙소)**
- 호스트가 등록한 임대 숙소 정보
- 위도/경도 좌표 저장 (Geohash 인덱싱)
- 일일 임대료 기준으로 저장 (dailyRent, dailyMaintenanceFee)
- 상태 관리: draft → pending_review → approved → published

#### **Contracts (계약)**
- 게스트와 호스트 간의 임대 계약 정보
- 체크인/체크아웃 일시, 총 일수 저장
- 금액 정보: 임대료, 관리비, 청소비, 렌탈비, 수수료, 할인, 보증금
- 상태 관리: PENDING_APPROVAL → APPROVED → PAYMENT_COMPLETED → IN_PROGRESS → COMPLETED
- 자동 만료 처리: APPROVAL_EXPIRED (48시간), PAYMENT_EXPIRED (24시간)

#### **RentalItemReservation (렌탈 아이템 예약)**
- 계약별 렌탈 아이템 예약 내역
- 재고 관리 연동 (RentalItem)

### 3.3 인덱스 전략
```sql
-- Users
INDEX idx_email (email)
INDEX idx_user_type (userType)

-- Rooms
INDEX idx_host_id (hostId)
INDEX idx_status (status)
INDEX idx_coordinates (latitude, longitude)
INDEX idx_published_at (publishedAt)

-- Contracts
INDEX idx_room_id (roomId)
INDEX idx_host_id (hostId)
INDEX idx_guest_id (guestId)
INDEX idx_status (status)
INDEX idx_check_in_date (checkInDate)
INDEX idx_check_out_date (checkOutDate)
INDEX idx_created_at (createdAt)

-- RoomPhoto
INDEX idx_room_id_order (roomId, order)
```

---

## 4. API 엔드포인트

### 4.1 인증 API (`/api/auth`)
| Method | Endpoint | 설명 | 인증 |
|--------|----------|------|------|
| POST | `/register` | 이메일 회원가입 | ❌ |
| POST | `/login` | 이메일 로그인 | ❌ |
| POST | `/kakao` | 카카오 소셜 로그인 | ❌ |
| POST | `/refresh` | Access Token 갱신 | ❌ |
| POST | `/logout` | 로그아웃 | ✅ |
| GET | `/profile` | 사용자 프로필 조회 | ✅ |
| GET | `/dev-bypass/:userid` | 개발 전용 로그인 우회 | ❌ |

### 4.2 사용자 API (`/api/user`)
| Method | Endpoint | 설명 | 인증 |
|--------|----------|------|------|
| GET | `/profile` | 프로필 조회 | ✅ |
| PATCH | `/profile` | 프로필 수정 | ✅ |
| POST | `/profile/image` | 프로필 이미지 업로드 | ✅ |

### 4.3 계정 관리 API (`/api/account`)
| Method | Endpoint | 설명 | 인증 |
|--------|----------|------|------|
| POST | `/verification` | 본인인증 정보 저장 | ✅ |
| POST | `/bank` | 계좌 정보 등록 | ✅ |
| GET | `/bank` | 계좌 목록 조회 | ✅ |
| POST | `/terms` | 약관 동의 처리 | ✅ |

### 4.4 게스트 방 검색 API (`/api/rooms`)
| Method | Endpoint | 설명 | 인증 |
|--------|----------|------|------|
| GET | `/map` | 지도 영역 내 방 조회 (Geohash) | ❌ |
| GET | `/` | 방 목록 조회 (필터링) | ❌ |
| GET | `/:id` | 방 상세 정보 조회 | ❌ |

### 4.5 호스트 방 관리 API (`/api/host/rooms`)
| Method | Endpoint | 설명 | 인증 |
|--------|----------|------|------|
| POST | `/` | 방 기본 정보 등록 | ✅ |
| GET | `/` | 내가 등록한 방 목록 | ✅ |
| GET | `/:roomId` | 방 상세 정보 조회 | ✅ |
| PATCH | `/:roomId/pricing` | 요금 정보 수정 | ✅ |
| POST | `/:roomId/photos` | 사진 업로드 (6~20장) | ✅ |
| PATCH | `/:roomId/photos/reorder` | 사진 순서 변경 | ✅ |
| DELETE | `/:roomId/photos/:photoId` | 사진 삭제 | ✅ |
| PATCH | `/:roomId/amenities` | 편의시설 수정 | ✅ |
| PATCH | `/:roomId/free-services` | 무료 부가서비스 수정 | ✅ |
| PATCH | `/:roomId/description` | 방 소개 수정 | ✅ |
| POST | `/:roomId/submit-review` | 심사 요청 | ✅ |

### 4.6 계약 API (`/api/contracts`)
| Method | Endpoint | 설명 | 인증 |
|--------|----------|------|------|
| POST | `/request` | 계약 요청 (게스트) | ✅ |
| GET | `/guest` | 내 계약 요청 목록 (게스트) | ✅ |
| GET | `/host` | 받은 계약 요청 목록 (호스트) | ✅ |
| GET | `/:contractId` | 계약 상세 정보 조회 | ✅ |
| PATCH | `/:contractId/approve` | 계약 승인 (호스트) | ✅ |
| PATCH | `/:contractId/reject` | 계약 거절 (호스트) | ✅ |
| PATCH | `/:contractId/cancel` | 계약 취소 (게스트) | ✅ |

### 4.7 렌탈 아이템 API (`/api/admin/rental-items`)
| Method | Endpoint | 설명 | 인증 |
|--------|----------|------|------|
| POST | `/` | 렌탈 아이템 등록 | ✅ (관리자) |
| GET | `/` | 렌탈 아이템 목록 조회 | ❌ |
| GET | `/:id` | 렌탈 아이템 상세 조회 | ❌ |
| PATCH | `/:id` | 렌탈 아이템 수정 | ✅ (관리자) |
| DELETE | `/:id` | 렌탈 아이템 삭제 | ✅ (관리자) |

---

## 5. 인증 및 보안

### 5.1 JWT 인증 시스템

```javascript
// 토큰 구조
{
  accessToken: {
    payload: { userId, email },
    expiresIn: '1h'
  },
  refreshToken: {
    payload: { userId },
    expiresIn: '7d'
  }
}
```

**플로우:**
1. 로그인 → Access Token + Refresh Token 발급
2. API 요청 시 `Authorization: Bearer {accessToken}` 헤더 전송
3. Access Token 만료 시 `/api/auth/refresh`로 갱신
4. Refresh Token 검증 후 새로운 Access Token 발급

### 5.2 OAuth 2.0 (카카오 로그인)

```
사용자 → 카카오 로그인 화면 → 카카오 인증 서버
         ↓ (authorization code)
백엔드 서버 → 카카오 Access Token 발급
         ↓
     사용자 정보 조회
         ↓
    기존 계정 연동 or 신규 가입
         ↓
    JWT 토큰 발급 → 클라이언트
```

### 5.3 Rate Limiting

| 대상 | 제한 | 목적 |
|------|------|------|
| 일반 API (`/api/*`) | 15분/100회 | DDoS 방어 |
| 인증 API (`/api/auth/login`, `/register`) | 15분/5회 | Brute Force 방어 |
| 파일 업로드 | 1시간/20회 | 서버 부하 방지 |
| 지도 API (`/api/rooms/map`) | 제한 없음 | 빈번한 요청 필요 |

### 5.4 입력 검증

#### **이메일 검증**
```javascript
// RFC 5322 표준 정규식
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
```

#### **비밀번호 강도 검증**
- 최소 8자
- 대문자, 소문자, 숫자 각 1개 이상 포함
- 특수문자 권장

#### **전화번호 검증**
- 010-1234-5678 형식
- 숫자만 추출 후 11자리 검증

### 5.5 파일 업로드 보안

```javascript
// 허용 MIME 타입
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp'
];

// 확장자 검증
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

// 최대 파일 크기
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
```

### 5.6 CORS 정책

```javascript
// 개발 환경: localhost 허용
// 프로덕션: 환경변수 ALLOWED_ORIGINS 도메인만 허용
const allowedOrigins = process.env.ALLOWED_ORIGINS.split(',');
```

### 5.7 보안 헤더 (Helmet)

```javascript
// 자동 적용되는 보안 헤더
- X-Content-Type-Options: nosniff
- X-Frame-Options: SAMEORIGIN
- X-XSS-Protection: 1; mode=block
- Strict-Transport-Security
- Content-Security-Policy
```

---

## 6. 핵심 기능 플로우

### 6.1 회원가입 및 로그인

```
┌─────────────────────────────────────────────────────────────┐
│                    회원가입 플로우                           │
└─────────────────────────────────────────────────────────────┘

[클라이언트]              [백엔드]              [데이터베이스]
     │                      │                       │
     │──POST /auth/register─→│                      │
     │  { email, password }  │                      │
     │                       │                       │
     │                       │──이메일 중복 확인────→│
     │                       │←─────────────────────│
     │                       │                       │
     │                       │──비밀번호 해싱────────│
     │                       │  (bcryptjs)           │
     │                       │                       │
     │                       │──User 생성───────────→│
     │                       │──LocalUser 생성──────→│
     │                       │←─────────────────────│
     │                       │                       │
     │                       │──JWT 토큰 생성────────│
     │                       │  (Access + Refresh)   │
     │                       │                       │
     │←────201 Created───────│                       │
     │  { accessToken, ... } │                       │
     │                       │                       │

┌─────────────────────────────────────────────────────────────┐
│                   소셜 로그인 플로우                         │
└─────────────────────────────────────────────────────────────┘

[클라이언트]         [백엔드]          [카카오]        [DB]
     │                 │                  │            │
     │──카카오 로그인──→│                  │            │
     │                 │──인가 코드 요청──→│            │
     │←────리다이렉트──│                  │            │
     │──authorization──→│                  │            │
     │      code       │                  │            │
     │                 │──Access Token────→│            │
     │                 │      요청         │            │
     │                 │←─────────────────│            │
     │                 │                  │            │
     │                 │──사용자 정보──────→│            │
     │                 │      요청         │            │
     │                 │←─────────────────│            │
     │                 │                  │            │
     │                 │──이메일로 User ───→│            │
     │                 │     검색          │            │
     │                 │←──────────────────────────────│
     │                 │                  │            │
     │                 │──SocialUser 생성/│            │
     │                 │      업데이트     │            │
     │                 │                  │            │
     │                 │──JWT 토큰 생성───│            │
     │←────200 OK──────│                  │            │
     │  { tokens, ... }│                  │            │
```

### 6.2 방 등록 플로우

```
┌─────────────────────────────────────────────────────────────┐
│              호스트 방 등록 7단계 플로우                      │
└─────────────────────────────────────────────────────────────┘

[호스트]                    [백엔드]                  [외부 API]

1. 기본 정보 등록
   │─POST /host/rooms──────→│
   │  { name, address, ... }│──Kakao Local API─────→│
   │                        │  (주소 → 좌표 변환)    │
   │                        │←─────────────────────│
   │                        │  { lat, lng }         │
   │                        │                       │
   │                        │──Room 생성 (draft)───→ [DB]
   │←──201 Created──────────│
   │   { roomId }           │

2. 요금 설정
   │─PATCH /rooms/:id/pricing→│
   │  { dailyRent, ... }    │──Room 업데이트────────→ [DB]
   │←──200 OK───────────────│

3. 사진 업로드 (6~20장)
   │─POST /rooms/:id/photos─→│
   │  FormData(photos[])    │──Multer 검증──────────│
   │                        │──파일 저장 (/uploads)─│
   │                        │──RoomPhoto 생성×N─────→ [DB]
   │←──200 OK───────────────│
   │   { photoUrls[] }      │

4. 편의시설 설정
   │─PATCH /rooms/:id/amenities→│
   │  { wifi, parking, ... }│──RoomAmenity 생성/────→ [DB]
   │                        │    업데이트            │
   │←──200 OK───────────────│

5. 무료 부가서비스
   │─PATCH /rooms/:id/free-services→│
   │  { cleaning, ... }     │──RoomFreeService──────→ [DB]
   │                        │    생성/업데이트       │
   │←──200 OK───────────────│

6. 방 소개 작성
   │─PATCH /rooms/:id/description→│
   │  { desc, rules, ... }  │──Room 업데이트────────→ [DB]
   │←──200 OK───────────────│

7. 심사 요청
   │─POST /rooms/:id/submit-review→│
   │                        │──필수 정보 검증────────│
   │                        │  (사진 6장, 요금, 소개)│
   │                        │──Room.status──────────→ [DB]
   │                        │  = 'pending_review'   │
   │←──200 OK───────────────│
   │   { status, ... }      │

   (관리자 심사 후)
   Room.status → 'approved' → 'published'
```

### 6.3 계약 요청 및 승인 플로우

```
┌─────────────────────────────────────────────────────────────┐
│                  계약 요청 → 승인 → 결제 플로우              │
└─────────────────────────────────────────────────────────────┘

[게스트]               [백엔드]               [호스트]        [스케줄러]

1. 계약 요청
   │─POST /contracts/request─→│
   │  { roomId, checkIn,      │──날짜 중복 확인──────→ [DB]
   │    checkOut, amounts,    │←─────────────────────│
   │    termsAgreed, ... }    │                       │
   │                          │──Contract 생성────────→ [DB]
   │                          │  status='PENDING_     │
   │                          │         APPROVAL'     │
   │                          │                       │
   │                          │──RentalItem 재고──────→ [DB]
   │                          │    예약 (lock)        │
   │←──201 Created────────────│                       │
   │   { contractId }         │                       │
   │                          │                       │
   │                          │──알림 전송────────────→│
   │                          │  (새 계약 요청)       │

2. 호스트 승인/거절
                             │←─PATCH /contracts/:id/approve─│
                             │  { hostMessage }              │
                             │                               │
                             │──Contract.status──────→ [DB]  │
                             │  = 'APPROVED'                 │
                             │──approvedAt 기록              │
                             │                               │
   ←──알림 (승인됨)──────────│                               │
   │                         │                               │

3. 게스트 결제 (24시간 내)
   │─결제 API 호출────────────→│
   │                          │──Contract.status──────→ [DB]
   │                          │  = 'PAYMENT_COMPLETED'│
   │                          │──paidAt 기록          │
   │←──200 OK─────────────────│                       │
   │                          │                       │

4. 자동 만료 처리
                                                         │
                                                         │
   [매 1시간마다 실행]                                   │
                             │←─Scheduler 실행───────────│
                             │  checkExpiredContracts()  │
                             │                           │
                             │──PENDING_APPROVAL────→ [DB]
                             │  + 48시간 경과            │
                             │  → APPROVAL_EXPIRED       │
                             │                           │
                             │──APPROVED────────────→ [DB]
                             │  + 24시간 경과 + 미결제   │
                             │  → PAYMENT_EXPIRED        │
                             │                           │
                             │──RentalItem 재고 복원────→│
```

### 6.4 지도 검색 (Geohash + Redis 캐싱)

```
┌─────────────────────────────────────────────────────────────┐
│           지도 영역 검색 (Geohash + Redis 캐싱)              │
└─────────────────────────────────────────────────────────────┘

[클라이언트]            [백엔드]            [Redis]        [MySQL]

사용자가 지도 이동/확대
   │                      │                   │            │
   │─GET /rooms/map?──────→│                  │            │
   │  swLat=37.5&swLng=   │                   │            │
   │  127.0&neLat=37.6&   │                   │            │
   │  neLng=127.1         │                   │            │
   │                      │                   │            │
   │                      │──좌표 → Geohash──│            │
   │                      │   변환 (정밀도 6) │            │
   │                      │                   │            │
   │                      │──Redis 캐시 조회─→│            │
   │                      │  key: rooms:geo:  │            │
   │                      │       {geohash}   │            │
   │                      │←─HIT/MISS─────────│            │
   │                      │                   │            │
   │  [캐시 HIT 시]       │                   │            │
   │                      │←─캐싱된 데이터────│            │
   │←─200 OK──────────────│                   │            │
   │  { rooms[] }         │                   │            │
   │                      │                   │            │
   │  [캐시 MISS 시]      │                   │            │
   │                      │──DB 쿼리──────────────────────→│
   │                      │  WHERE lat BETWEEN            │
   │                      │    AND lng BETWEEN            │
   │                      │    AND status='published'     │
   │                      │←─────────────────────────────│
   │                      │                   │            │
   │                      │──Redis에 캐싱─────→│            │
   │                      │  (TTL: 10분)      │            │
   │←─200 OK──────────────│                   │            │
   │  { rooms[] }         │                   │            │
   │                      │                   │            │

[방 업데이트 시 캐시 무효화]
                         │←─PATCH /rooms/:id─────────────│
                         │                   │            │
                         │──Room 업데이트───────────────→│
                         │                   │            │
                         │──캐시 무효화──────→│            │
                         │  DEL rooms:geo:*  │            │
                         │←──────────────────│            │
```

---

## 7. 기술 스택

### 7.1 Backend
```json
{
  "runtime": "Node.js",
  "framework": "Express.js v5.1.0",
  "orm": "Sequelize v6.37.7",
  "database": "MySQL 8.0 / MariaDB 11.5",
  "cache": "Redis v5.8.3",
  "authentication": {
    "jwt": "jsonwebtoken v9.0.2",
    "oauth": "passport-kakao v1.0.1"
  },
  "fileUpload": "multer v2.0.2",
  "security": [
    "helmet v8.1.0",
    "bcryptjs v3.0.2",
    "express-rate-limit v8.1.0"
  ],
  "validation": "validator v13.15.15",
  "geospatial": "ngeohash v0.6.3",
  "scheduler": "node-cron v4.2.1",
  "http": "axios v1.12.2"
}
```

### 7.2 개발 도구
```json
{
  "devServer": "nodemon v3.1.10",
  "logging": "morgan v1.10.1",
  "env": "dotenv v17.2.2"
}
```

### 7.3 외부 API
- **Kakao OAuth 2.0**: 소셜 로그인
- **Kakao Local API**: 주소 → 좌표 변환 (Geocoding)

---

## 8. 배포 및 운영

### 8.1 환경 변수

```bash
# Server
PORT=8080
NODE_ENV=production

# Database
DB_HOST=your-db-host
DB_PORT=3306
DB_USER=your-db-user
DB_PASSWORD=your-db-password
DB_NAME=livemoment

# Redis
REDIS_HOST=your-redis-host
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password

# JWT
JWT_SECRET=your-jwt-secret-min-32-chars
JWT_REFRESH_SECRET=your-refresh-secret-min-32-chars

# Kakao API
KAKAO_CLIENT_ID=your-kakao-rest-api-key
KAKAO_CLIENT_SECRET=your-kakao-client-secret
KAKAO_CALLBACK_URL=https://yourdomain.com/api/auth/oauth/kakao/callback

# CORS
ALLOWED_ORIGINS=https://yourdomain.com,https://app.yourdomain.com

# File Upload
UPLOADS_PUBLIC_PATH=/uploads
```

### 8.2 스케줄러

**계약 만료 자동 처리** (`schedulers/contractScheduler.js`)
```javascript
// 매 1시간마다 실행
cron.schedule('0 * * * *', async () => {
  // 1. PENDING_APPROVAL + 48시간 경과 → APPROVAL_EXPIRED
  // 2. APPROVED + 24시간 경과 + 미결제 → PAYMENT_EXPIRED
  // 3. 재고 자동 복원 (RentalItemReservation)
});
```

### 8.3 성능 최적화

#### **Redis 캐싱 전략**
- 지도 검색: Geohash 기반 캐싱 (TTL: 10분)
- 방 업데이트 시 관련 캐시 무효화

#### **데이터베이스 최적화**
- 복합 인덱스: (latitude, longitude), (roomId, order)
- Eager Loading: `include` 옵션으로 N+1 쿼리 방지

#### **파일 최적화**
- 이미지 압축 (프론트엔드에서 처리 권장)
- CDN 활용 권장

### 8.4 모니터링 및 로깅

```javascript
// Morgan 로그 형식: combined
- IP, Method, URL, Status, Response Time, User Agent
- 프로덕션: 파일 저장 권장

// 에러 로깅
- 전역 에러 핸들러에서 console.error
- 프로덕션: Sentry, CloudWatch 등 도입 권장
```

### 8.5 백업 전략

- **데이터베이스**: 일일 자동 백업 (mysqldump)
- **파일 저장소**: S3 또는 Object Storage 마이그레이션 권장
- **Redis**: RDB 스냅샷 (매 6시간)

---

## 9. 향후 개선 사항

### 9.1 단기 계획
- [ ] 결제 시스템 통합 (토스페이먼츠, 아임포트)
- [ ] 관리자 대시보드 구축
- [ ] 이메일 인증 (회원가입, 비밀번호 재설정)
- [ ] 푸시 알림 시스템 (FCM)

### 9.2 중장기 계획
- [ ] 리뷰 및 평점 시스템
- [ ] 채팅 기능 (Socket.io)
- [ ] 쿠폰 및 프로모션 관리
- [ ] 다국어 지원 (i18n)
- [ ] AI 기반 가격 추천
- [ ] 검색 엔진 최적화 (SEO)

### 9.3 인프라 개선
- [ ] Docker 컨테이너화
- [ ] CI/CD 파이프라인 구축 (GitHub Actions)
- [ ] 로드 밸런싱 및 Auto Scaling
- [ ] CDN 연동 (CloudFront, Cloudflare)
- [ ] APM 도입 (New Relic, Datadog)

---

## 10. 참고 문서

- [API 문서](./API_DOCUMENTATION.md)
- [Claude Code 가이드](./CLAUDE.md)
- [Express.js 공식 문서](https://expressjs.com/)
- [Sequelize 공식 문서](https://sequelize.org/)
- [Redis 공식 문서](https://redis.io/)
- [Kakao Developers](https://developers.kakao.com/)

---

**문서 버전**: 1.0.0
**최종 수정일**: 2025-10-25
**작성자**: Claude Code Assistant
