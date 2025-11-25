# EzService 리팩토링 설계 문서

## 📋 목차
1. [개요](#개요)
2. [현재 구조 분석](#현재-구조-분석)
3. [변경 사항 요약](#변경-사항-요약)
4. [데이터베이스 스키마 변경](#데이터베이스-스키마-변경)
5. [모델 변경](#모델-변경)
6. [API 변경](#api-변경)
7. [마이그레이션 계획](#마이그레이션-계획)
8. [작업 순서](#작업-순서)

---

## 개요

### 정책 변경 사항
- **서비스 이름**: `room_free_services` → `EzService` (이지서비스)
- **렌탈 아이템 운영 방식**: 호스트 동의 방식 → 플랫폼 직접 판매 방식
- **영향받는 렌탈 아이템**: 헤어드라이어, 침구류, 어메니티 키트, 타월 세트

### 목표
1. 테이블 및 모델 이름을 새로운 정책에 맞게 변경
2. 렌탈 아이템 관련 컬럼을 제거하여 스키마 단순화
3. 기존 데이터 무결성 유지하면서 안전한 마이그레이션
4. API 호환성 유지 또는 명확한 Breaking Change 문서화

---

## 현재 구조 분석

### 1. RoomFreeService 모델 (삭제 예정)
**테이블명**: `room_free_services`
**파일**: `models/RoomFreeService.js`

```javascript
{
  roomId: INTEGER (PK),
  cleaningService: BOOLEAN,           // ✅ 유지 → EzService로 이동
  hairDryerRental: BOOLEAN,          // ❌ 제거 (RentalItem으로 이동)
  beddingService: BOOLEAN,           // ❌ 제거 (RentalItem으로 이동)
  amenityKit: BOOLEAN,               // ❌ 제거 (RentalItem으로 이동)
  towelSetRental: BOOLEAN,           // ❌ 제거 (RentalItem으로 이동)
  autoPasswordChange: BOOLEAN,        // ✅ 유지 → EzService로 이동
  roomPassword: STRING(100)           // ✅ 유지 → EzService로 이동
}
```

### 2. RentalItem 모델 (유지)
**테이블명**: `rental_items`
**파일**: `models/RentalItem.js`

```javascript
{
  id: INTEGER (PK),
  itemType: ENUM('hair_dryer', 'bedding_set', 'amenity_kit', 'towel_set', 'other'),
  name: STRING(100),
  description: TEXT,
  price: DECIMAL(10, 2),
  totalStock: INTEGER,
  availableStock: INTEGER,
  imageUrl: STRING(255),
  isActive: BOOLEAN
}
```

**특징**:
- ✅ 이미 렌탈 아이템 카탈로그 시스템 구현됨
- ✅ 재고 관리 기능 포함
- ✅ 플랫폼 직접 판매 구조에 적합

### 3. 사용 위치 분석
- `controllers/contractController.js`: 계약 시 무료 청소 서비스 확인
- `controllers/adminController.js`: 관리자 매물 상세 조회
- `controllers/hostController.js`: 호스트 방 등록/조회
- `utils/roomProgress.js`: 방 등록 진행률 추적

---

## 변경 사항 요약

### 테이블 변경
| Before | After | 비고 |
|--------|-------|------|
| `room_free_services` | `ez_services` | 테이블명 변경 |
| 7개 컬럼 | 4개 컬럼 | 렌탈 관련 4개 컬럼 제거 |

### 모델 변경
| Before | After | 비고 |
|--------|-------|------|
| `RoomFreeService` | `EzService` | 모델명 변경 |
| `freeService` (alias) | `ezService` | 관계 별칭 변경 |

### 제거되는 컬럼
- `hairDryerRental` (헤어드라이어 대여)
- `beddingService` (침구 서비스)
- `amenityKit` (어메니티 키트)
- `towelSetRental` (타월 세트 대여)

### 유지되는 컬럼
- `cleaningService` (청소 서비스) - 무료 제공 서비스
- `autoPasswordChange` (자동 비밀번호 변경) - 무료 제공 서비스
- `roomPassword` (방 비밀번호) - 자동 변경 기능과 연동

---

## 데이터베이스 스키마 변경

### 새로운 테이블 정의: `ez_services`

```sql
CREATE TABLE ez_services (
  room_id INT NOT NULL PRIMARY KEY COMMENT '방 ID (외래키)',
  cleaning_service TINYINT(1) NOT NULL DEFAULT 0 COMMENT '무료 청소 서비스 제공 여부',
  auto_password_change TINYINT(1) NOT NULL DEFAULT 0 COMMENT '자동 비밀번호 변경 여부',
  room_password VARCHAR(100) DEFAULT NULL COMMENT '방 출입 비밀번호',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_ez_services_room_id FOREIGN KEY (room_id)
    REFERENCES rooms(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='이지서비스 (호스트 제공 무료 부가 서비스)';

-- 인덱스
CREATE INDEX idx_cleaning_service ON ez_services(cleaning_service);
CREATE INDEX idx_auto_password_change ON ez_services(auto_password_change);
```

### 컬럼 매핑

| room_free_services | ez_services | 비고 |
|-------------------|-------------|------|
| `room_id` | `room_id` | 동일 |
| `cleaning_service` | `cleaning_service` | 동일 |
| `auto_password_change` | `auto_password_change` | 동일 |
| `room_password` | `room_password` | 동일 |
| `hair_dryer_rental` | **삭제** | RentalItem으로 이동 |
| `bedding_service` | **삭제** | RentalItem으로 이동 |
| `amenity_kit` | **삭제** | RentalItem으로 이동 |
| `towel_set_rental` | **삭제** | RentalItem으로 이동 |

---

## 모델 변경

### 1. 새로운 EzService 모델

**파일**: `models/EzService.js` (신규 생성)

```javascript
const { DataTypes } = require('sequelize');
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize('ezstay', process.env.DB_USER || 'root', process.env.DB_PASSWORD || '', {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  dialect: 'mysql',
  logging: false
});

/**
 * EzService 모델 - 이지서비스 (호스트가 제공하는 무료 부가 서비스)
 *
 * 변경 이력:
 * - 2025-01: RoomFreeService에서 EzService로 이름 변경
 * - 렌탈 아이템 관련 컬럼 제거 (플랫폼 직접 판매로 전환)
 *
 * 제공 서비스:
 * - cleaningService: 무료 청소 서비스
 * - autoPasswordChange: 자동 비밀번호 변경
 */
const EzService = sequelize.define('EzService', {
  roomId: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    comment: '방 ID (외래키)'
    // references 옵션 제거 - models/index.js에서 belongsTo로 관계 설정
  },
  cleaningService: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: '무료 청소 서비스 제공 여부'
  },
  autoPasswordChange: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: '자동 비밀번호 변경 여부'
  },
  roomPassword: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: '방 출입 비밀번호 (자동 변경 기능과 연동)'
  }
}, {
  tableName: 'ez_services',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      fields: ['cleaning_service'],
      name: 'idx_cleaning_service'
    },
    {
      fields: ['auto_password_change'],
      name: 'idx_auto_password_change'
    }
  ],
  comment: '이지서비스 (호스트 제공 무료 부가 서비스)'
});

module.exports = { EzService, sequelize };
```

### 2. models/index.js 수정

**변경 전**:
```javascript
const { RoomFreeService } = require('./RoomFreeService');

// 관계 설정
Room.hasOne(RoomFreeService, {
  foreignKey: 'roomId',
  as: 'freeService'
});

RoomFreeService.belongsTo(Room, {
  foreignKey: 'roomId',
  as: 'room'
});
```

**변경 후**:
```javascript
const { EzService } = require('./EzService');

// 관계 설정
Room.hasOne(EzService, {
  foreignKey: 'roomId',
  as: 'ezService'  // ✅ 별칭 변경
});

EzService.belongsTo(Room, {
  foreignKey: 'roomId',
  as: 'room'
});
```

### 3. RoomFreeService.js 삭제
- `models/RoomFreeService.js` 파일 삭제 (마이그레이션 완료 후)

---

## API 변경

### 1. 응답 필드명 변경

#### Before (기존)
```json
{
  "freeServices": {
    "cleaningService": true,
    "hairDryerRental": false,
    "beddingService": false,
    "amenityKit": false,
    "towelSetRental": false,
    "autoPasswordChange": true,
    "roomPassword": "1234"
  }
}
```

#### After (변경 후)
```json
{
  "ezService": {
    "cleaningService": true,
    "autoPasswordChange": true,
    "roomPassword": "1234"
  }
}
```

### 2. 영향받는 API 엔드포인트

#### 호스트 API

**1) 방 등록 - 무료 부가서비스 단계**
- **엔드포인트**: `PATCH /api/host/rooms/:roomId/free-services`
- **변경**: URL 및 요청 본문 필드 변경 필요

**변경 전**:
```javascript
PATCH /api/host/rooms/:roomId/free-services
{
  "cleaningService": true,
  "hairDryerRental": false,
  "beddingService": false,
  "amenityKit": false,
  "towelSetRental": false,
  "autoPasswordChange": true,
  "roomPassword": "1234"
}
```

**변경 후**:
```javascript
PATCH /api/host/rooms/:roomId/ez-service  // ✅ URL 변경
{
  "cleaningService": true,
  "autoPasswordChange": true,
  "roomPassword": "1234"
}
```

**2) 호스트 방 목록 조회**
- **엔드포인트**: `GET /api/host/rooms`
- **변경**: 응답 필드명 변경

**3) 호스트 방 상세 조회**
- **엔드포인트**: `GET /api/host/rooms/:roomId`
- **변경**: 응답 필드명 변경

#### 게스트 API

**1) 방 상세 조회**
- **엔드포인트**: `GET /api/rooms/:roomId`
- **변경**: 응답 필드명 변경 (렌탈 관련 필드는 이미 제외)

#### 관리자 API

**1) 매물 상세 조회**
- **엔드포인트**: `GET /api/admin/properties/:roomId`
- **변경**: 응답 필드명 변경

**2) 매물 목록 조회**
- **엔드포인트**: `GET /api/admin/properties`
- **변경**: 응답 필드명 변경 (include 사용 시)

### 3. 렌탈 아이템 조회 API (신규/강화)

플랫폼 직접 판매 방식으로 전환되므로, 렌탈 아이템 조회 API가 중요해집니다.

**신규 엔드포인트**: `GET /api/rental-items`
```javascript
// 응답 예시
{
  "success": true,
  "data": {
    "items": [
      {
        "id": 1,
        "itemType": "hair_dryer",
        "name": "고급 헤어드라이어",
        "description": "1800W 고출력 헤어드라이어",
        "price": 5000,
        "availableStock": 50,
        "imageUrl": "/uploads/rental/hair_dryer.jpg"
      },
      {
        "id": 2,
        "itemType": "bedding_set",
        "name": "프리미엄 침구 세트",
        "description": "호텔식 침구 세트",
        "price": 15000,
        "availableStock": 30,
        "imageUrl": "/uploads/rental/bedding.jpg"
      }
    ]
  }
}
```

**필터 옵션**:
- `itemType`: 특정 카테고리만 조회
- `available`: 재고가 있는 아이템만 조회

---

## 마이그레이션 계획

### 1. 마이그레이션 스크립트

**파일**: `scripts/migration_rename_free_service_to_ez_service.sql`

```sql
-- =====================================================
-- EzService 리팩토링 마이그레이션
-- 작성일: 2025-01-XX
-- 목적: room_free_services → ez_services 변경
-- =====================================================

-- Step 1: 새로운 테이블 생성
CREATE TABLE ez_services (
  room_id INT NOT NULL PRIMARY KEY COMMENT '방 ID (외래키)',
  cleaning_service TINYINT(1) NOT NULL DEFAULT 0 COMMENT '무료 청소 서비스 제공 여부',
  auto_password_change TINYINT(1) NOT NULL DEFAULT 0 COMMENT '자동 비밀번호 변경 여부',
  room_password VARCHAR(100) DEFAULT NULL COMMENT '방 출입 비밀번호',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_ez_services_room_id FOREIGN KEY (room_id)
    REFERENCES rooms(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='이지서비스 (호스트 제공 무료 부가 서비스)';

-- Step 2: 인덱스 생성
CREATE INDEX idx_cleaning_service ON ez_services(cleaning_service);
CREATE INDEX idx_auto_password_change ON ez_services(auto_password_change);

-- Step 3: 기존 데이터 마이그레이션 (렌탈 관련 컬럼 제외)
INSERT INTO ez_services (room_id, cleaning_service, auto_password_change, room_password, created_at, updated_at)
SELECT
  room_id,
  cleaning_service,
  auto_password_change,
  room_password,
  created_at,
  updated_at
FROM room_free_services;

-- Step 4: 데이터 검증
SELECT
  '데이터 마이그레이션 결과' AS description,
  (SELECT COUNT(*) FROM room_free_services) AS original_count,
  (SELECT COUNT(*) FROM ez_services) AS migrated_count,
  CASE
    WHEN (SELECT COUNT(*) FROM room_free_services) = (SELECT COUNT(*) FROM ez_services)
    THEN 'SUCCESS ✅'
    ELSE 'FAILED ❌'
  END AS status;

-- Step 5: 롤백 스크립트 (주석 처리, 필요 시 사용)
/*
DROP TABLE IF EXISTS ez_services;
*/

-- Step 6: 기존 테이블 삭제 (모든 검증 완료 후 수동 실행)
/*
DROP TABLE IF EXISTS room_free_services;
*/
```

### 2. 롤백 계획

**파일**: `scripts/rollback_ez_service_migration.sql`

```sql
-- =====================================================
-- EzService 마이그레이션 롤백
-- 작성일: 2025-01-XX
-- 목적: 문제 발생 시 원상 복구
-- =====================================================

-- Step 1: 기존 테이블이 남아있는지 확인
SELECT
  TABLE_NAME,
  TABLE_ROWS
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'ezstay'
  AND TABLE_NAME IN ('room_free_services', 'ez_services');

-- Step 2: ez_services 테이블 삭제
DROP TABLE IF EXISTS ez_services;

-- Step 3: 검증 (room_free_services가 그대로 남아있는지 확인)
SELECT COUNT(*) AS room_free_services_count FROM room_free_services;
```

### 3. 데이터 무결성 검증 스크립트

**파일**: `scripts/verify_ez_service_migration.sql`

```sql
-- =====================================================
-- EzService 마이그레이션 검증
-- =====================================================

-- 1. 레코드 개수 비교
SELECT
  'Record Count Check' AS test_name,
  (SELECT COUNT(*) FROM room_free_services) AS original_count,
  (SELECT COUNT(*) FROM ez_services) AS migrated_count,
  CASE
    WHEN (SELECT COUNT(*) FROM room_free_services) = (SELECT COUNT(*) FROM ez_services)
    THEN 'PASS ✅'
    ELSE 'FAIL ❌'
  END AS result;

-- 2. 데이터 일치성 검증 (샘플 10개)
SELECT
  'Data Consistency Check' AS test_name,
  o.room_id,
  o.cleaning_service = n.cleaning_service AS cleaning_match,
  o.auto_password_change = n.auto_password_change AS password_change_match,
  COALESCE(o.room_password, '') = COALESCE(n.room_password, '') AS password_match,
  CASE
    WHEN o.cleaning_service = n.cleaning_service
      AND o.auto_password_change = n.auto_password_change
      AND COALESCE(o.room_password, '') = COALESCE(n.room_password, '')
    THEN 'PASS ✅'
    ELSE 'FAIL ❌'
  END AS result
FROM room_free_services o
JOIN ez_services n ON o.room_id = n.room_id
LIMIT 10;

-- 3. Null 값 검증
SELECT
  'Null Values Check' AS test_name,
  COUNT(*) AS total_records,
  SUM(CASE WHEN cleaning_service IS NULL THEN 1 ELSE 0 END) AS null_cleaning,
  SUM(CASE WHEN auto_password_change IS NULL THEN 1 ELSE 0 END) AS null_auto_password,
  CASE
    WHEN SUM(CASE WHEN cleaning_service IS NULL THEN 1 ELSE 0 END) = 0
      AND SUM(CASE WHEN auto_password_change IS NULL THEN 1 ELSE 0 END) = 0
    THEN 'PASS ✅'
    ELSE 'FAIL ❌'
  END AS result
FROM ez_services;

-- 4. 외래키 제약조건 검증
SELECT
  'Foreign Key Check' AS test_name,
  COUNT(*) AS orphaned_records,
  CASE
    WHEN COUNT(*) = 0 THEN 'PASS ✅'
    ELSE 'FAIL ❌'
  END AS result
FROM ez_services e
LEFT JOIN rooms r ON e.room_id = r.id
WHERE r.id IS NULL;
```

---

## 작업 순서

### Phase 1: 준비 단계 (1일)

**1.1 백업**
```bash
# 데이터베이스 전체 백업
mysqldump -u root -p ezstay > backup_ezstay_before_ezservice_migration_$(date +%Y%m%d).sql

# room_free_services 테이블만 백업
mysqldump -u root -p ezstay room_free_services > backup_room_free_services_$(date +%Y%m%d).sql
```

**1.2 설계 문서 검토**
- [ ] 팀원과 설계 문서 공유 및 피드백 수렴
- [ ] API Breaking Change 확인 및 프론트엔드 팀 협의
- [ ] 마이그레이션 일정 조율

**1.3 개발 환경 테스트**
- [ ] 개발 DB에 마이그레이션 스크립트 실행
- [ ] 데이터 무결성 검증 스크립트 실행
- [ ] 롤백 스크립트 테스트

### Phase 2: 모델 및 코드 변경 (2-3일)

**2.1 새로운 모델 생성**
- [ ] `models/EzService.js` 생성
- [ ] `models/index.js`에 관계 설정 추가

**2.2 기존 모델 유지 (호환성)**
```javascript
// models/RoomFreeService.js (임시 유지)
// ⚠️ DEPRECATED: EzService 사용 권장
const { EzService } = require('./EzService');

// 하위 호환성을 위한 별칭
const RoomFreeService = EzService;

module.exports = { RoomFreeService, sequelize };
```

**2.3 컨트롤러 수정**

**우선순위 1**: `controllers/hostController.js`
- [ ] `PATCH /api/host/rooms/:roomId/free-services` → `/ez-service`
- [ ] 요청 검증 로직 업데이트 (렌탈 관련 필드 제거)
- [ ] 응답 필드명 변경 (`freeServices` → `ezService`)

**우선순위 2**: `controllers/adminController.js`
- [ ] 매물 상세 조회 응답 필드 변경
- [ ] include 구문 수정 (`freeService` → `ezService`)

**우선순위 3**: `controllers/contractController.js`
- [ ] 계약 생성 시 청소 서비스 확인 로직 수정
- [ ] include 구문 수정

**우선순위 4**: `controllers/roomController.js`
- [ ] 게스트 방 조회 응답 필드 변경 (이미 렌탈 필드 제외되어 있을 가능성 높음)

**2.4 유틸리티 수정**
- [ ] `utils/roomProgress.js`: 진행률 추적 로직 업데이트

**2.5 라우트 수정**
- [ ] `routes/hostRoutes.js`: 엔드포인트 URL 변경
- [ ] API 문서 업데이트

### Phase 3: 마이그레이션 실행 (1일)

**3.1 스테이징 환경 마이그레이션**
```bash
# 1. 백업
mysqldump -u root -p ezstay_staging > backup_staging_$(date +%Y%m%d).sql

# 2. 마이그레이션 실행
mysql -u root -p ezstay_staging < scripts/migration_rename_free_service_to_ez_service.sql

# 3. 검증
mysql -u root -p ezstay_staging < scripts/verify_ez_service_migration.sql

# 4. 애플리케이션 재시작
pm2 restart ezstay-backend-staging
```

**3.2 스테이징 환경 테스트**
- [ ] 방 등록 플로우 E2E 테스트
- [ ] 호스트 방 목록/상세 조회 테스트
- [ ] 관리자 매물 관리 테스트
- [ ] 계약 생성 및 청소 서비스 확인 테스트

**3.3 프로덕션 마이그레이션 (피크 시간 외)**
```bash
# 1. 유지보수 모드 활성화 (선택)
pm2 stop ezstay-backend

# 2. 백업
mysqldump -u root -p ezstay > backup_production_$(date +%Y%m%d_%H%M%S).sql

# 3. 마이그레이션 실행
mysql -u root -p ezstay < scripts/migration_rename_free_service_to_ez_service.sql

# 4. 검증
mysql -u root -p ezstay < scripts/verify_ez_service_migration.sql

# 5. 애플리케이션 재시작
pm2 restart ezstay-backend

# 6. 헬스 체크
curl http://localhost:3000/health
```

### Phase 4: 후속 작업 (1-2일)

**4.1 모니터링 (1주일)**
- [ ] 에러 로그 모니터링
- [ ] API 응답 시간 모니터링
- [ ] 사용자 피드백 수집

**4.2 정리 작업 (검증 완료 후)**
```bash
# 1. 기존 테이블 삭제
mysql -u root -p ezstay -e "DROP TABLE IF EXISTS room_free_services;"

# 2. 기존 모델 파일 삭제
rm models/RoomFreeService.js

# 3. Git 커밋
git add .
git commit -m "refactor: Rename RoomFreeService to EzService and remove rental columns"
```

**4.3 문서 업데이트**
- [ ] `CLAUDE.md` 업데이트
- [ ] `docs/API_DOCUMENTATION.md` 업데이트
- [ ] `docs/ADMIN_API_DOCUMENTATION.md` 업데이트
- [ ] `README.md` 변경 사항 기록

### Phase 5: 프론트엔드 연동 (병렬 진행)

**5.1 프론트엔드 API 클라이언트 수정**
- [ ] API 엔드포인트 변경 (`/free-services` → `/ez-service`)
- [ ] 요청 본문 필드 변경 (렌탈 관련 필드 제거)
- [ ] 응답 필드명 변경 (`freeServices` → `ezService`)

**5.2 UI 수정**
- [ ] 방 등록 폼: 렌탈 관련 체크박스 제거
- [ ] 방 상세 페이지: 렌탈 아이템 표시 제거
- [ ] 렌탈 아이템 별도 섹션 추가 (플랫폼 직접 판매)

---

## Breaking Changes 및 주의사항

### API Breaking Changes

**영향받는 API**:
1. `PATCH /api/host/rooms/:roomId/free-services` → `/ez-service`
   - 요청 본문에서 렌탈 관련 필드 제거 필요

2. `GET /api/host/rooms` / `GET /api/host/rooms/:roomId`
   - 응답 필드명 변경: `freeServices` → `ezService`

3. `GET /api/admin/properties/:roomId`
   - 응답 필드명 변경: `freeServices` → `ezService`

**마이그레이션 가이드 (프론트엔드)**:
```javascript
// Before
const response = await fetch('/api/host/rooms/123/free-services', {
  method: 'PATCH',
  body: JSON.stringify({
    cleaningService: true,
    hairDryerRental: false,  // ❌ 제거됨
    beddingService: false,   // ❌ 제거됨
    amenityKit: false,       // ❌ 제거됨
    towelSetRental: false    // ❌ 제거됨
  })
});

const data = await response.json();
console.log(data.freeServices);  // ❌ 필드명 변경됨

// After
const response = await fetch('/api/host/rooms/123/ez-service', {  // ✅ URL 변경
  method: 'PATCH',
  body: JSON.stringify({
    cleaningService: true,
    autoPasswordChange: true,
    roomPassword: '1234'
  })
});

const data = await response.json();
console.log(data.ezService);  // ✅ 새로운 필드명
```

### 데이터베이스 주의사항

**외래키 제약조건**:
- `ez_services.room_id`는 `rooms.id`를 참조
- `ON DELETE CASCADE`: 방 삭제 시 EzService도 함께 삭제
- `ON UPDATE CASCADE`: 방 ID 변경 시 EzService도 업데이트

**타임스탬프**:
- 마이그레이션 시 기존 `created_at`, `updated_at` 유지
- 새로운 레코드는 현재 시간으로 자동 설정

**Null 값 처리**:
- `cleaningService`, `autoPasswordChange`: NOT NULL (기본값 false)
- `roomPassword`: NULL 허용 (비밀번호 미사용 시)

---

## 테스트 체크리스트

### 단위 테스트
- [ ] EzService 모델 생성 테스트
- [ ] EzService 모델 조회 테스트
- [ ] EzService 모델 업데이트 테스트
- [ ] EzService 모델 삭제 테스트 (CASCADE)

### 통합 테스트
- [ ] 방 등록 플로우 (EzService 포함)
- [ ] 호스트 방 목록 조회 (EzService include)
- [ ] 호스트 방 상세 조회 (EzService include)
- [ ] 관리자 매물 조회 (EzService include)
- [ ] 계약 생성 시 청소 서비스 확인

### E2E 테스트
- [ ] 호스트가 방 등록 → EzService 설정 → 심사 요청
- [ ] 게스트가 방 조회 → EzService 정보 확인
- [ ] 관리자가 매물 승인 → EzService 정보 포함 확인

### 성능 테스트
- [ ] 방 목록 조회 성능 (EzService include)
- [ ] 데이터베이스 인덱스 활용 확인
- [ ] 쿼리 실행 계획 분석 (EXPLAIN)

---

## FAQ

### Q1: 기존 데이터는 어떻게 되나요?
**A**: 마이그레이션 스크립트가 `room_free_services`의 데이터를 `ez_services`로 복사합니다. 렌탈 관련 컬럼(`hairDryerRental`, `beddingService`, `amenityKit`, `towelSetRental`)은 제외되고, 나머지 컬럼(`cleaningService`, `autoPasswordChange`, `roomPassword`)만 이동됩니다.

### Q2: 기존 API는 언제까지 지원되나요?
**A**: 하위 호환성을 위해 초기에는 `freeServices` 별칭을 유지할 수 있지만, 장기적으로는 `ezService`로 통일하는 것이 권장됩니다. 프론트엔드 팀과 협의하여 마이그레이션 기간을 설정하세요.

### Q3: 렌탈 아이템은 어떻게 관리하나요?
**A**: `RentalItem` 모델(테이블: `rental_items`)을 통해 플랫폼에서 직접 관리합니다. 호스트의 동의 없이 게스트에게 직접 판매하는 구조입니다.

### Q4: 롤백이 필요하면 어떻게 하나요?
**A**: `scripts/rollback_ez_service_migration.sql` 스크립트를 실행하여 `ez_services` 테이블을 삭제하고 기존 `room_free_services` 테이블로 복구할 수 있습니다. 단, 롤백 전에 백업을 필수로 확인하세요.

### Q5: 프로덕션 마이그레이션은 언제 하나요?
**A**: 피크 시간(점심, 저녁)을 피하고, 새벽(오전 2-4시) 또는 주말에 진행하는 것이 안전합니다. 유지보수 공지를 사용자에게 미리 알려주세요.

---

## 참고 문서

- `CLAUDE.md`: 프로젝트 전체 가이드
- `docs/API_DOCUMENTATION.md`: 일반 API 문서
- `docs/ADMIN_API_DOCUMENTATION.md`: 관리자 API 문서
- `models/RentalItem.js`: 렌탈 아이템 모델 참고

---

**문서 버전**: 1.0.0
**작성일**: 2025-01-XX
**작성자**: Claude Code
**최종 수정일**: 2025-01-XX
