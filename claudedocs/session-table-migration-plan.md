# 세션 테이블 도입 구현 계획

> 작성일: 2026-03-27
> 목적: 단일 `refreshToken` 컬럼 방식 → `user_sessions` 테이블로 교체하여 기기별 다중 세션 관리 구현

---

## 배경 및 문제점

### 현재 구조

```
users 테이블
└── refresh_token: TEXT  ← 1개만 저장 가능
```

### 발생하는 문제

| 상황 | 결과 |
|------|------|
| 기기A 로그인 후 기기B 로그인 | DB의 refresh_token이 덮어써짐 |
| 기기A에서 토큰 갱신 시도 | 403 INVALID_TOKEN (기기B 토큰이 저장되어 있음) |
| accessToken 만료 전 (기본 1시간) | 기기A는 계속 작동하나 조용히 만료됨 |
| 토큰 탈취 시 | 공격자 재로그인 → 정상 사용자 세션 강제 종료 |

---

## 목표 구조

```
user_sessions 테이블
├── id (PK)
├── user_id       ← User.id 또는 Admin.id
├── user_type     ← 'user' | 'admin'
├── refresh_token
├── device_info   ← User-Agent 파싱 (선택)
├── ip_address
├── expires_at    ← refreshToken 만료 시각
└── last_used_at  ← 갱신 시마다 업데이트
```

---

## Phase 1: DB 스키마 변경 (수동 SQL)

> `sync({ alter: false })` 정책에 따라 수동 실행 필요

### 1-1. 세션 테이블 생성

```sql
CREATE TABLE user_sessions (
  id            BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id       INT          NOT NULL,
  refresh_token TEXT         NOT NULL,
  device_info   VARCHAR(255) NULL     COMMENT '기기 식별 (User-Agent 파싱)',
  ip_address    VARCHAR(45)  NULL     COMMENT 'IPv4/IPv6',
  user_type     ENUM('user','admin') NOT NULL DEFAULT 'user',
  expires_at    DATETIME     NOT NULL COMMENT 'refreshToken 만료 시각',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_sessions_user_id (user_id),
  INDEX idx_user_sessions_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 1-2. 기존 refreshToken 컬럼 제거

> **주의**: 이 단계는 코드 배포 완료 후 실행할 것. 실행 즉시 기존 모든 세션 무효화됨.

```sql
-- 사용자 테이블
ALTER TABLE users DROP COLUMN refresh_token;

-- 관리자 테이블
ALTER TABLE admins DROP COLUMN refresh_token;
```

---

## Phase 2: 모델 생성

### 신규 파일: `models/UserSession.js`

```js
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('UserSession', {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: 'User.id 또는 Admin.id'
    },
    refreshToken: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    deviceInfo: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'User-Agent 기반 기기 식별 문자열'
    },
    ipAddress: {
      type: DataTypes.STRING(45),
      allowNull: true,
      comment: 'IPv4/IPv6'
    },
    userType: {
      type: DataTypes.ENUM('user', 'admin'),
      allowNull: false,
      defaultValue: 'user'
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
      comment: 'refreshToken 만료 시각'
    },
    lastUsedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      comment: '마지막 토큰 갱신 시각'
    }
  }, {
    tableName: 'user_sessions',
    timestamps: true,   // created_at 자동 생성
    updatedAt: false,   // last_used_at으로 대체
    underscored: true
  });
};
```

### 수정 파일: `models/index.js`

```js
// 1. import 추가
const UserSessionModel = require('./UserSession');

// 2. 초기화
const UserSession = UserSessionModel(sequelize);

// 3. 관계 설정 (User.hasMany는 참고용, 직접 쿼리도 가능)
User.hasMany(UserSession, { foreignKey: 'userId', constraints: false });
UserSession.belongsTo(User, { foreignKey: 'userId', constraints: false });

// 4. exports에 추가
module.exports = {
  // ... 기존 exports
  UserSession,
};
```

---

## Phase 3: 컨트롤러 수정

### 3-1. `controllers/authController.js`

#### `login` 함수

```js
// 변경 전
await user.update({ refreshToken, lastLoginAt: new Date() }, { transaction });

// 변경 후
const { JWT_REFRESH_EXPIRES_IN } = require('../utils/auth'); // 또는 env 직접 참조
const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14일 (기본값)

await UserSession.create({
  userId: user.id,
  refreshToken,
  userType: 'user',
  deviceInfo: req.headers['user-agent']?.substring(0, 255) || null,
  ipAddress: req.ip || null,
  expiresAt
}, { transaction });

await user.update({ lastLoginAt: new Date() }, { transaction });
```

#### `refreshToken` 함수

```js
// 변경 전
const user = await User.findOne({
  where: { id: decoded.userId, refreshToken: token, accountStatus: 'active' }
});

// 변경 후
const session = await UserSession.findOne({
  where: { userId: decoded.userId, refreshToken: token, userType: 'user' }
});

if (!session || session.expiresAt < new Date()) {
  return error(res, ErrorCodes.INVALID_TOKEN, 403);
}

const user = await User.findOne({
  where: { id: decoded.userId, accountStatus: 'active' }
});

if (!user) {
  return error(res, ErrorCodes.INVALID_TOKEN, 403);
}

// 새 토큰으로 세션 업데이트
const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
await session.update({
  refreshToken: newRefreshToken,
  lastUsedAt: new Date(),
  expiresAt
});
```

#### `logout` 함수

```js
// 변경 전
await user.update({ refreshToken: null });

// 변경 후 — 요청에 사용된 refresh 토큰 기준으로 해당 세션만 삭제
const { refreshToken: token } = req.body; // body에서 전달받거나 별도 처리
await UserSession.destroy({
  where: { userId: req.user.id, refreshToken: token, userType: 'user' }
});
```

> **참고**: 현재 `logout`은 accessToken으로 인증하므로 어떤 세션을 삭제할지 특정이 필요함.
> 방법 1: body에 refreshToken 함께 전달
> 방법 2: 해당 userId의 세션 전체 삭제 (전체 로그아웃)

#### `register` 함수

```js
// 변경 전
await newUser.update({ refreshToken }, { transaction });

// 변경 후
const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
await UserSession.create({
  userId: newUser.id,
  refreshToken,
  userType: 'user',
  deviceInfo: req.headers['user-agent']?.substring(0, 255) || null,
  ipAddress: req.ip || null,
  expiresAt
}, { transaction });
```

---

### 3-2. `controllers/oauthController.js`

#### `kakaoLogin` 함수

```js
// 변경 전
await user.update({ refreshToken, lastLoginAt: new Date() }, { transaction });

// 변경 후
const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
await UserSession.create({
  userId: user.id,
  refreshToken,
  userType: 'user',
  deviceInfo: req.headers['user-agent']?.substring(0, 255) || null,
  ipAddress: req.ip || null,
  expiresAt
}, { transaction });

await user.update({ lastLoginAt: new Date() }, { transaction });
```

---

### 3-3. `controllers/adminAuthController.js`

#### `login` 함수

```js
// 변경 전
admin.refreshToken = refreshToken;
admin.lastLoginAt = new Date();
await admin.save();

// 변경 후
const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
await UserSession.create({
  userId: admin.id,
  refreshToken,
  userType: 'admin',
  deviceInfo: req.headers['user-agent']?.substring(0, 255) || null,
  ipAddress: req.ip || null,
  expiresAt
});
admin.lastLoginAt = new Date();
await admin.save();
```

#### `logout` 함수

```js
// 변경 전
admin.refreshToken = null;
await admin.save();

// 변경 후
const { refreshToken: token } = req.body;
await UserSession.destroy({
  where: { userId: req.admin.id, userType: 'admin', refreshToken: token }
});
```

---

## Phase 4: 스케줄러 — 만료 세션 자동 정리

기존 `node-cron` 스케줄러(매 10분 실행)의 마지막 단계에 추가:

```js
// 만료된 세션 정리
const deletedCount = await UserSession.destroy({
  where: {
    expiresAt: { [Op.lt]: new Date() }
  }
});
if (deletedCount > 0) {
  console.log(`[세션 정리] ${deletedCount}개 만료 세션 삭제`);
}
```

---

## Phase 5: 선택적 기능 (추후 구현)

### 5-1. 내 세션 목록 조회 API

```
GET /api/user/sessions
Authorization: Bearer {accessToken}
```

```json
{
  "sessions": [
    {
      "id": 1,
      "deviceInfo": "Chrome/Windows",
      "ipAddress": "123.456.789.0",
      "lastUsedAt": "2026-03-27T10:00:00Z",
      "expiresAt": "2026-04-10T10:00:00Z"
    }
  ]
}
```

### 5-2. 특정 세션 강제 종료 API

```
DELETE /api/user/sessions/:sessionId
Authorization: Bearer {accessToken}
```

### 5-3. 전체 로그아웃 API

```
DELETE /api/user/sessions
Authorization: Bearer {accessToken}
```

```js
await UserSession.destroy({
  where: { userId: req.user.id, userType: 'user' }
});
```

### 5-4. 단일 세션 강제 옵션 (로그인 시)

기기당 1개 세션만 허용하려면 로그인 시:

```js
// 기존 세션 모두 삭제 후 새 세션 생성
await UserSession.destroy({ where: { userId: user.id, userType: 'user' } });
await UserSession.create({ ... });
```

### 5-5. 세션 수 제한 옵션

최대 N개 세션 초과 시 가장 오래된 세션 삭제:

```js
const MAX_SESSIONS = 5;
const sessions = await UserSession.findAll({
  where: { userId: user.id, userType: 'user' },
  order: [['last_used_at', 'ASC']]
});

if (sessions.length >= MAX_SESSIONS) {
  await sessions[0].destroy(); // 가장 오래된 세션 삭제
}
```

---

## 변경 파일 체크리스트

```
[ ] 수동 SQL — user_sessions 테이블 CREATE          ← 개발/운영 DB 수동 실행 필요
[x] models/UserSession.js — 신규 생성
[x] models/index.js — import, 초기화, 관계, exports 추가
[x] controllers/authController.js — login, refreshToken, logout, register, devBypassLogin
[x] controllers/oauthController.js — kakaoLogin
[x] controllers/adminAuthController.js — login, logout
[x] schedulers/cleanupExpiredSessions.js — 신규 생성 및 server.js 등록
[ ] 수동 SQL — users, admins 테이블 refresh_token 컬럼 DROP (배포 완료 후 실행)
```

---

## 미들웨어 변경 없음

`middleware/auth.js`의 `authenticateToken`, `authenticateAdmin`은 **accessToken만 검증**하므로 변경 불필요.
`utils/auth.js`의 `generateTokens`, `verifyToken`도 변경 불필요.

---

## 배포 절차

```
1. 개발 DB에 user_sessions CREATE SQL 실행
2. 코드 변경 (Phase 2~4) 및 로컬 테스트
3. 운영 DB에 user_sessions CREATE SQL 실행
4. 코드 배포
5. 배포 확인 후 users/admins refresh_token DROP SQL 실행
   (이 시점에 기존 세션 전체 만료 → 사용자 재로그인 필요)
```

> **배포 시 사용자 안내**: Step 5 실행 시 모든 사용자가 자동 로그아웃됩니다.
