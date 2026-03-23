# 프로젝트 구조 & 아키텍처 - EZStay Backend

## 기술 스택
Node.js / Express.js v5 / MySQL + Sequelize / JWT (passport-jwt) / Kakao OAuth / Multer / Redis

## 프로젝트 구조
```
ezstay_back/
├── config/         # app.config.js, redis.js
├── controllers/    # 요청/응답 핸들링
├── services/       # 도메인 비즈니스 로직
├── models/         # Sequelize 데이터 모델
├── routes/         # API 라우팅
├── middleware/     # auth, validation, upload, errorHandler, rateLimiter
├── utils/          # auth, responseHelper, validator, transactionHelper
└── server.js
```

## 모델 관계
```
User ─1:1→ LocalUser | ─1:N→ SocialUser | ─1:N→ Room | ─1:N→ UserBankAccount
Room ─1:N→ RoomPhoto | ─1:1→ RoomAmenity | ─1:1→ RoomFreeService
```

## 방 등록 흐름 (단계별)
```
POST /api/host/rooms          → status: draft (기본정보 + 좌표 자동변환)
PATCH .../pricing             → 요금 설정
POST  .../photos              → 사진 (최소 5장, 최대 20장)
PATCH .../amenities           → 편의시설
PATCH .../free-services       → 무료 부가서비스
PATCH .../description         → 방 소개
POST  .../submit-review       → status: pending_review
```
**방 상태**: `draft → pending_review → approved → published` (또는 `rejected`)

## 관리자 시스템
Admin 테이블은 User와 완전히 분리된 별도 테이블
```javascript
const { authenticateAdmin, requireAdminRole } = require('../middleware/auth');
router.get('/stats', authenticateAdmin, controller);
router.patch('/users/:id', authenticateAdmin, requireAdminRole(['super_admin', 'admin']), controller);
```
**권한**: `super_admin` > `admin` > `cs_admin`
**관리자 로그인**: `POST /api/admin/auth/login` (일반 로그인과 별도)

## 환경변수 (.env)
```
PORT / NODE_ENV / DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_LOGGING
JWT_SECRET (32자 이상) / JWT_REFRESH_SECRET
KAKAO_CLIENT_ID / KAKAO_CLIENT_SECRET / KAKAO_CALLBACK_URL
ALLOWED_ORIGINS / UPLOADS_PUBLIC_PATH / AUTO_APPROVE_CONTRACTS
```

## 서버 실행
```bash
npm run dev   # 개발 (nodemon)
npm start     # 프로덕션
```

## API 문서
- 일반 API: `docs/API_DOCUMENTATION.md`
- 관리자 API: `docs/ADMIN_API_DOCUMENTATION.md`
