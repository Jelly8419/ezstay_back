# 코딩 컨벤션 & 개발 규칙 - EZStay Backend

## API 응답 (반드시 responseHelper 사용)
```javascript
const { success, created, updated, deleted, error, ErrorCodes } = require('../utils/responseHelper');

success(res, data, '메시지')          // 200
created(res, data, '생성 메시지')     // 201
updated(res, data, '수정 메시지')     // 200
deleted(res, '삭제 메시지')           // 200
error(res, ErrorCodes.UNAUTHORIZED, 401)
error(res, ErrorCodes.ROOM_NOT_FOUND, 404)
error(res, ErrorCodes.VALIDATION_ERROR, 400, { field: '상세' })
```
직접 `res.json()` 사용 금지

## 에러 코드 체계
- `1xxx` 인증 | `2xxx` 권한 | `3xxx` 리소스 | `4xxx` 검증
- `41xx` 파일업로드 | `42xx` 방등록 | `429x` Rate Limit | `5xxx` 서버

## 인증 미들웨어
```javascript
const { authenticateToken } = require('../middleware/auth');
router.post('/route', authenticateToken, controller); // req.user.id 사용 가능
```

## 파일 업로드
```javascript
const { uploadRoomPhotos, uploadSingleImage } = require('../middleware/upload');
// MIME + 확장자 둘 다 검증 / 허용: jpeg, jpg, png, webp / 최대 10MB
```

## 입력 검증
```javascript
const { validateEmail, validatePassword } = require('../utils/validator');
```

## 트랜잭션
여러 테이블 동시 수정 시 트랜잭션 필수 → `utils/transactionHelper.js` 사용

## Rate Limiting
```javascript
const { authLimiter, adminAuthLimiter, adminApiLimiter } = require('../middleware/rateLimiter');
// 인증 API: authLimiter | 일반 API: /api/* 자동 적용
```

## Sequelize 핵심 원칙 ⚠️ 실제 장애 경험 기반

### 문제 1: unique 인덱스 중복 생성 → MySQL 64개 인덱스 제한 초과
> 실제 발생: 서버 재시작마다 동일 인덱스가 누적 생성되어 수십 개 중복 발생

**원인**: 컬럼에 `unique: true` + `indexes` 배열에 동일 필드를 동시 정의하면 인덱스가 2개 생성됨

```javascript
// ❌ 절대 금지 - 서버 재시작마다 중복 인덱스 누적 생성
const Model = sequelize.define('Model', {
  field: {
    type: DataTypes.STRING,
    unique: true,  // ← 자동 인덱스 생성
  }
}, {
  indexes: [
    { unique: true, fields: ['field'] }  // ← 또 다른 인덱스 생성 (중복!)
  ]
});

// ✅ indexes 배열에서만 정의 (명시적 이름 필수)
const Model = sequelize.define('Model', {
  field: {
    type: DataTypes.STRING
    // unique: true 제거
  }
}, {
  indexes: [
    { unique: true, fields: ['field'], name: 'model_field_unique' }
  ]
});
```

### 문제 2: 외래키 중복 생성 → 테이블당 외래키 수십 개 누적
> 실제 발생: notices 테이블에 외래키 62개 중복 생성 (notices_ibfk_1 ~ notices_ibfk_62)

**원인**: 모델 컬럼의 `references` 옵션 + `models/index.js`의 `belongsTo` 동시 사용

```javascript
// ❌ 절대 금지 - 외래키 이중 정의
// models/Notice.js
const Notice = sequelize.define('Notice', {
  createdBy: {
    type: DataTypes.INTEGER,
    references: { model: 'Admins', key: 'id' }  // ← 첫 번째 외래키
  }
});
// models/index.js
Notice.belongsTo(Admin, { foreignKey: 'createdBy' });  // ← 두 번째 외래키 (중복!)

// ✅ models/index.js에서만 관계 정의
// models/Notice.js
const Notice = sequelize.define('Notice', {
  createdBy: {
    type: DataTypes.INTEGER
    // references 옵션 제거
  }
});
// models/index.js
Notice.belongsTo(Admin, { foreignKey: 'createdBy', as: 'author' });  // 여기서만!
```

### sync 설정
`sync({ alter: false })` 사용 — 스키마 변경은 마이그레이션으로

## 데이터 보존 (절대 원칙)
```javascript
// ✅ Soft Delete만 허용
await User.update({ isActive: false, refreshToken: null }, { where: { id: userId } });

// ❌ Hard Delete 절대 금지
await User.destroy({ where: { id: userId } });
```
계약/결제/방/채팅 등 핵심 데이터는 `onDelete: 'NO ACTION'` 설정됨

## 게스트용 API 보안
방 목록/상세 조회 시 `published` 상태만 노출
민감정보 제외: `entrancePassword`, `hostId`, `detailAddress`, `status`
