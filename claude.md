# Ezstay Backend - Claude Code 가이드

## 프로젝트 개요
부동산 단기 임대 플랫폼(Ezstay)의 백엔드 API 서버입니다. 호스트가 숙소를 등록하고 게스트가 단기 임대할 수 있는 서비스를 제공합니다.

## 기술 스택
- **Runtime**: Node.js
- **Framework**: Express.js (v5.1.0)
- **Database**: MySQL (Sequelize ORM)
- **Authentication**: JWT (passport-jwt), OAuth (passport-kakao)
- **File Upload**: Multer
- **Security**: Helmet, bcryptjs
- **HTTP Client**: Axios

## 프로젝트 구조
```
ezstay_back/
├── controllers/          # 비즈니스 로직 처리
│   ├── authController.js       # 이메일 회원가입/로그인
│   ├── oauthController.js      # 소셜 로그인 (카카오)
│   ├── userController.js       # 사용자 정보 관리
│   ├── accountController.js    # 본인인증, 계좌정보, 약관동의
│   ├── hostController.js       # 호스트 방 목록 조회
│   ├── roomController.js       # 방 등록 및 관리 (CRUD)
│   ├── contractController.js   # 계약/예약 관리
│   ├── chatController.js       # Firebase 실시간 채팅
│   └── adminController.js      # 관리자 기능 (대시보드, 유저/매물/예약 관리)
├── models/              # Sequelize 데이터 모델
│   ├── User.js                # 공통 사용자 정보
│   ├── LocalUser.js           # 이메일 회원
│   ├── SocialUser.js          # 소셜 로그인 회원
│   ├── Room.js                # 방 기본 정보
│   ├── RoomPhoto.js           # 방 사진
│   ├── RoomAmenity.js         # 편의시설
│   ├── RoomFreeService.js     # 무료 부가서비스
│   ├── UserBankAccount.js     # 사용자 계좌정보
│   └── index.js               # 모델 관계 설정 및 Sequelize 인스턴스
├── routes/              # API 라우팅
│   ├── authRoutes.js          # /api/auth
│   ├── userRoutes.js          # /api/user
│   ├── accountRoutes.js       # /api/account
│   ├── hostRoutes.js          # /api/host
│   ├── roomRoutes.js          # /api/rooms
│   ├── contractRoutes.js      # /api/contracts
│   ├── chatRoutes.js          # /api/chats
│   └── adminRoutes.js         # /api/admin
├── middleware/          # 미들웨어
│   ├── auth.js                # JWT 인증 + 관리자 권한 미들웨어
│   ├── validation.js          # 요청 데이터 검증
│   ├── upload.js              # 파일 업로드 설정 (MIME 타입 검증)
│   ├── errorHandler.js        # 전역 에러 핸들러
│   └── rateLimiter.js         # Rate Limiting (Brute Force 방어)
├── utils/               # 유틸리티
│   ├── auth.js                # JWT 토큰 생성/검증 (Access + Refresh)
│   ├── responseHelper.js      # 표준화된 API 응답 (에러 코드 포함)
│   └── validator.js           # 입력 검증 (이메일, 비밀번호, 전화번호 등)
├── uploads/             # 업로드된 파일 저장소
├── server.js            # Express 앱 진입점
├── .env                 # 환경변수
└── API_DOCUMENTATION.md # API 문서
```

## 데이터베이스 모델 관계
```
User (공통 사용자 테이블)
├─ 1:1 → LocalUser (이메일 회원)
├─ 1:N → SocialUser (소셜 로그인 회원, provider별로 여러 개 가능)
├─ 1:N → Room (호스트가 등록한 방 목록)
└─ 1:N → UserBankAccount (계좌정보)

Room (방)
├─ latitude, longitude (위도/경도, WGS84 좌표계)
├─ 1:N → RoomPhoto (사진, 순서 있음)
├─ 1:1 → RoomAmenity (편의시설)
└─ 1:1 → RoomFreeService (무료 부가서비스)
```

## 핵심 기능

### 1. 인증 시스템
- **이메일 회원가입/로그인** (`/api/auth/register`, `/api/auth/login`)
  - bcryptjs로 비밀번호 해싱
  - JWT 토큰 발급 (access + refresh)
- **소셜 로그인** (`/api/auth/oauth/kakao`)
  - 카카오 OAuth 지원
  - 기존 계정 자동 연동
- **토큰 갱신** (`/api/auth/refresh`)

### 2. 사용자 정보 관리
- 본인인증 정보 저장 (`/api/account/verification`)
- 계좌 정보 등록 (`/api/account/bank`)
- 약관 동의 처리 (`/api/account/terms`)
- 프로필 조회/수정 (`/api/user/profile`)

### 3. 호스트 방 등록 (단계별 프로세스)
방 등록은 다단계로 진행되며, 각 단계별로 정보를 저장합니다:

1. **기본 정보** (`POST /api/host/rooms`) - status: `draft`
   - 주소 입력 시 카카오 로컬 API로 자동 위도/경도 변환
   - 좌표 변환 실패 시에도 등록은 계속 진행됨 (좌표는 선택사항)
2. **요금 설정** (`PATCH /api/host/rooms/:roomId/pricing`)
3. **사진 업로드** (`POST /api/host/rooms/:roomId/photos`) - 최소 6장, 최대 20장
4. **편의시설** (`PATCH /api/host/rooms/:roomId/amenities`)
5. **무료 부가서비스** (`PATCH /api/host/rooms/:roomId/free-services`)
6. **방 소개** (`PATCH /api/host/rooms/:roomId/description`)
7. **심사 요청** (`POST /api/host/rooms/:roomId/submit-review`) - status: `pending_review`

**방 상태(status) 흐름**:
`draft` → `pending_review` → `approved` → `published` (또는 `rejected`)

**주소-좌표 변환**:
- `utils/geocoding.js`를 통해 카카오 로컬 API 활용
- 도로명 주소를 WGS84 좌표계 위도/경도로 자동 변환
- 지도 표시, 거리 계산 등에 활용 가능

### 4. 호스트 방 관리
- 등록한 방 목록 조회 (`GET /api/host/rooms`)
- 방 상세 정보 조회 (`GET /api/host/rooms/:roomId`)
- 사진 순서 변경 (`PATCH /api/host/rooms/:roomId/photos/reorder`)
- 사진 삭제 (`DELETE /api/host/rooms/:roomId/photos/:photoId`)

## 코딩 컨벤션

### API 응답 형식
**반드시 `utils/responseHelper.js`를 사용**하여 일관된 응답을 반환합니다.

#### 성공 응답
```javascript
const { success, created, updated, deleted } = require('../utils/responseHelper');

// 일반 성공 (200)
return success(res, data, '메시지');

// 생성 성공 (201)
return created(res, data, '생성 메시지');

// 수정 성공 (200)
return updated(res, data, '수정 메시지');

// 삭제 성공 (200)
return deleted(res, '삭제 메시지');
```

#### 에러 응답
```javascript
const { error, ErrorCodes } = require('../utils/responseHelper');

// 인증 에러 (401)
return error(res, ErrorCodes.UNAUTHORIZED, 401);

// 권한 에러 (403)
return error(res, ErrorCodes.FORBIDDEN, 403);

// 리소스 없음 (404)
return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);

// 검증 에러 (400)
return error(res, ErrorCodes.VALIDATION_ERROR, 400, { field: '상세 정보' });

// 서버 에러 (500)
return error(res, ErrorCodes.INTERNAL_ERROR, 500);
```

### 에러 코드 체계
- **1xxx**: 인증 관련 (UNAUTHORIZED, INVALID_TOKEN, TOKEN_EXPIRED)
- **2xxx**: 권한 관련 (FORBIDDEN, NOT_OWNER, NOT_HOST)
- **3xxx**: 리소스 관련 (NOT_FOUND, ROOM_NOT_FOUND, USER_NOT_FOUND)
- **4xxx**: 검증 관련 (VALIDATION_ERROR, MISSING_REQUIRED_FIELDS, DUPLICATE_EMAIL)
- **41xx**: 파일 업로드 (NO_FILE_UPLOADED, MIN_PHOTOS_REQUIRED)
- **42xx**: 방 등록 (ROOM_INFO_INCOMPLETE, PRICING_INFO_REQUIRED)
- **429x**: Rate Limiting (4290: 일반 API 제한, 4291: 인증 API 제한, 4292: 파일 업로드 제한, 4293: 비밀번호 재설정 제한, 4294: 관리자 인증 제한, 4295: 관리자 API 제한)
- **5xxx**: 서버 관련 (INTERNAL_ERROR, DATABASE_ERROR)

### 인증 미들웨어 사용
```javascript
const { authenticateToken } = require('../middleware/auth');

// 보호된 라우트
router.post('/protected-route', authenticateToken, controller);
```

### 파일 업로드
```javascript
const { uploadRoomPhotos, uploadSingleImage } = require('../middleware/upload');

// 복수 사진 업로드 (최대 20장)
router.post('/photos', uploadRoomPhotos, controller);

// 단일 이미지 업로드
router.post('/image', uploadSingleImage, controller);
```

## 환경 변수 (.env)
```
PORT=3000
NODE_ENV=development  # production으로 설정 권장
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_LOGGING=false  # true: SQL 쿼리 로그 출력 (DDL 제외) | false: 모든 DB 로그 끄기
JWT_SECRET=your_jwt_secret
JWT_REFRESH_SECRET=your_refresh_secret
KAKAO_CLIENT_ID=your_kakao_rest_api_key  # 카카오 REST API 키 (OAuth + 로컬 API 공통 사용)
KAKAO_CLIENT_SECRET=your_kakao_client_secret
KAKAO_CALLBACK_URL=http://localhost:3000/api/auth/oauth/kakao/callback
```

### DB 로깅 제어
- **개발 환경**: `DB_LOGGING=true`로 설정하여 필요한 쿼리만 확인 (ALTER, SHOW INDEX 자동 필터링)
- **프로덕션 환경**: `DB_LOGGING=false`로 설정하여 성능 최적화 및 로그 정리

## 주요 명령어
```bash
# 개발 서버 실행 (nodemon)
npm run dev

# 프로덕션 서버 실행
npm start
```

## 보안 강화 사항 (2025-10)

### 1. **환경변수 보호**
- `.gitignore`에 `.env` 파일 포함
- Git 저장소에서 민감정보 제외
- JWT Secret은 **최소 32자 이상** 랜덤 문자열 사용 필수
- Access Token과 Refresh Token에 별도 시크릿 사용

### 2. **JWT 보안**
```javascript
// utils/auth.js에서 서버 시작 시 자동 검증
- JWT_SECRET 존재 여부 확인
- JWT_SECRET 최소 길이 검증 (32자)
- Refresh Token 검증 시 서명 및 만료 확인
```

### 3. **CORS 설정**
```javascript
// server.js
// 환경변수로 허용 도메인 제한
ALLOWED_ORIGINS=http://localhost:3000,https://yourdomain.com
```

### 4. **Rate Limiting**
**일반 사용자 API**:
- 일반 API: 15분/100회
- 로그인/회원가입: 15분/5회 (Brute Force 방어)
- 파일 업로드: 1시간/20회
- 비밀번호 재설정: 1시간/3회

**관리자 API** (업무 특성상 완화):
- 관리자 로그인: 15분/10회 (일반 사용자의 2배)
- 관리자 일반 API: 15분/300회 (일반 사용자의 3배)

```javascript
const { authLimiter, adminAuthLimiter, adminApiLimiter } = require('../middleware/rateLimiter');

// 일반 사용자 로그인
router.post('/login', authLimiter, login);

// 관리자 로그인
router.post('/admin/auth/login', adminAuthLimiter, adminLogin);

// 관리자 API (모든 인증된 관리자 라우트에 자동 적용)
router.use(adminApiLimiter);
```

### 5. **입력 검증**
```javascript
const { validateEmail, validatePassword } = require('../utils/validator');

// 이메일 검증
const emailValidation = validateEmail(email);
if (!emailValidation.valid) {
  return error(res, ErrorCodes.INVALID_EMAIL, 400);
}

// 비밀번호 강도 검증 (최소 8자, 대문자+소문자+숫자)
const passwordValidation = validatePassword(password);
if (!passwordValidation.valid) {
  return error(res, { code: 4004, message: passwordValidation.message }, 400);
}
```

### 6. **파일 업로드 보안**
- MIME 타입과 확장자 둘 다 검증
- 허용 형식: jpeg, jpg, png, webp
- 최대 파일 크기: 10MB

### 7. **전역 에러 핸들러**
- Multer, JWT, Sequelize 에러 자동 처리
- 프로덕션 환경에서 민감한 정보 노출 방지
- 일관된 에러 응답 형식

### 8. **Sequelize 모델 인덱스 중복 방지** (중요!)
Sequelize 모델에서 `unique: true`와 `indexes`를 함께 사용하면 인덱스가 중복 생성되어 MySQL의 64개 인덱스 제한을 초과할 수 있습니다.

**❌ 잘못된 예시** (중복 인덱스 생성):
```javascript
const Model = sequelize.define('Model', {
  field: {
    type: DataTypes.STRING,
    unique: true  // ❌ 자동 인덱스 생성
  }
}, {
  indexes: [
    {
      unique: true,
      fields: ['field']  // ❌ 또 다른 인덱스 생성
    }
  ]
});
```

**✅ 올바른 예시** (단일 인덱스):
```javascript
const Model = sequelize.define('Model', {
  field: {
    type: DataTypes.STRING
    // unique: true 제거
  }
}, {
  indexes: [
    {
      unique: true,
      fields: ['field'],
      name: 'model_field_unique'  // 명시적인 이름 지정 권장
    }
  ]
});
```

**적용된 모델**:
- [Admin.js](c:\study\ezstay_back\models\Admin.js): `username` 필드
- [ChatRoom.js](c:\study\ezstay_back\models\ChatRoom.js): `contractId`, `firebaseChatRoomId` 필드
- [LocalUser.js](c:\study\ezstay_back\models\LocalUser.js): `userId` 필드

## 개발 시 주의사항

1. **모든 컨트롤러에서 responseHelper 사용 필수**
   - 직접 `res.json()` 사용 금지
   - 에러 코드는 `ErrorCodes`에서 가져오기

2. **인증이 필요한 API는 `authenticateToken` 미들웨어 적용**
   - `req.user.id`로 현재 로그인한 사용자 ID 접근 가능

3. **입력 검증은 validator 사용**
   - 이메일, 비밀번호, 전화번호 등 표준 검증 함수 활용
   - 커스텀 검증이 필요한 경우 `utils/validator.js`에 추가

4. **Rate Limiting 적용**
   - 인증 관련 API: `authLimiter`
   - 파일 업로드: `uploadLimiter`
   - 일반 API: 자동 적용됨 (`/api/*`)

5. **방 등록은 단계별로 저장**
   - 각 PATCH 엔드포인트는 부분 업데이트만 수행
   - `submit-review`에서 필수 정보 완성 여부 검증

6. **파일 업로드 경로**
   - 환경변수 `UPLOADS_PUBLIC_PATH`로 관리
   - DB에는 상대 경로(`/uploads/...`) 저장

7. **Sequelize 관계 활용**
   - `include` 옵션으로 연관 데이터 조회
   - `as` 별칭 사용 (예: `photos`, `amenity`, `freeService`)

8. **트랜잭션 사용**
   - 여러 테이블 동시 수정 시 트랜잭션 필수
   - 에러 발생 시 rollback 후 에러 응답

9. **게스트용 API 보안**
   - 방 목록/상세 조회 시 `published` 상태만 노출
   - 민감정보 제외: `entrancePassword`, `hostId`, `detailAddress`, `status`

## API 문서
- **일반 API**: `docs\API_DOCUMENTATION.md` 파일 참조
- **관리자 API**: `docs\ADMIN_API_DOCUMENTATION.md` 파일 참조

## 관리자 기능 (2025-10-27 추가, v2.0.0 업데이트)

### 중요 변경사항 (v2.0.0)
관리자는 일반 유저(User)와 **완전히 분리된 Admin 테이블**에서 관리됩니다.

### Admin 모델 (별도 테이블)
```javascript
Admin {
  id: number,
  email: string (UNIQUE),
  password: string (bcrypt 해싱),
  name: string,
  phoneNumber: string | null,
  role: 'super_admin' | 'admin' | 'cs_admin',
  isActive: boolean,
  lastLoginAt: Date | null,
  refreshToken: string | null
}
```

**권한 레벨**:
- **super_admin**: 최고관리자 (모든 권한)
- **admin**: 일반관리자 (대부분의 관리 권한)
- **cs_admin**: 고객센터 관리자 (제한적 권한)

### 관리자 인증 시스템
```javascript
const { authenticateAdmin, requireAdminRole } = require('../middleware/auth');

// 모든 관리자가 접근 가능
router.get('/dashboard/stats', authenticateAdmin, controller);

// 특정 역할만 접근 가능
router.patch('/users/:id/status',
  authenticateAdmin,
  requireAdminRole(['super_admin', 'admin']),
  controller
);
```

### 관리자 전용 로그인
- **일반 유저 로그인**: `POST /api/auth/login`
- **관리자 로그인**: `POST /api/admin/auth/login` (별도 엔드포인트)

### 주요 관리자 API
#### 인증
- `POST /api/admin/auth/login` - 관리자 로그인
- `POST /api/admin/auth/logout` - 로그아웃
- `GET /api/admin/auth/me` - 내 정보 조회

#### 대시보드
- `GET /api/admin/dashboard/stats` - 통계 조회
- `GET /api/admin/dashboard/recent-activities` - 최근 활동

#### 유저 관리
- `GET /api/admin/users` - 유저 목록 (검색, 필터링, 페이지네이션)
- `GET /api/admin/users/:userId` - 유저 상세
- `PATCH /api/admin/users/:userId/status` - 유저 활성/비활성

#### 매물 관리
- `GET /api/admin/properties` - 매물 목록
- `GET /api/admin/properties/pending-review` - 심사 대기 매물
- `POST /api/admin/properties/:roomId/approve` - 매물 승인
- `POST /api/admin/properties/:roomId/reject` - 매물 반려

#### 예약 관리
- `GET /api/admin/reservations` - 예약 목록
- `GET /api/admin/reservations/:contractId` - 예약 상세

### 관리자 계정 생성
Admin 테이블에 직접 생성합니다:
```javascript
// scripts/createAdmin.js
const bcrypt = require('bcryptjs');
const { Admin } = require('./models');

async function createAdmin() {
  const hashedPassword = await bcrypt.hash('admin1234!', 10);

  await Admin.create({
    username: 'admin',
    password: hashedPassword,
    name: '관리자',
    phoneNumber: '010-1234-5678',
    role: 'super_admin',
    isActive: true
  });

  console.log('관리자 계정 생성 완료');
}

createAdmin();
```

상세한 관리자 API 문서는 `docs\ADMIN_API_DOCUMENTATION.md` 파일을 참조하세요.
