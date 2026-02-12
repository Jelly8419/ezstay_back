# 방 일정 관리 API 구현 계획서

**작성일**: 2026-01-16
**대상 명세서**: 방 일정 관리 백엔드 API 명세서 v1.0

---

## 📊 현황 분석

### ✅ 기존 구현 완료
1. **Contract 모델**: 계약 정보 완전히 구현됨
   - 체크인/체크아웃 날짜 관리
   - 계약 상태 (PENDING_APPROVAL, APPROVED, PAYMENT_COMPLETED, IN_PROGRESS, COMPLETED, CANCELLED 등)
   - 금액 정보, 결제 정보, 환불정책 스냅샷

2. **Room 모델**: 방 기본 정보 완전히 구현됨
   - 방 이름, 주소, 상태 관리
   - isActive, deletedAt 필드 추가 완료 (2026-01-16)

### ❌ 미구현 항목
1. **BlockedPeriod 모델**: 계약 불가 기간 관리용 테이블 **미존재**
2. **일정 관리 API 엔드포인트**: 7개 API 모두 미구현
3. **일정 조회 서비스 로직**: 계약/불가 기간 통합 조회 로직 없음

---

## 🎯 구현 목표

### Phase 1: 필수 기능 (우선순위 높음)
1. ✅ `GET /api/host/rooms/{roomId}/schedule` - 통합 일정 조회 (최우선)
2. ✅ `POST /api/host/rooms/{roomId}/blocked-periods` - 불가 기간 생성
3. ✅ `DELETE /api/host/rooms/{roomId}/blocked-periods/{blockedId}` - 불가 기간 삭제

### Phase 2: 부가 기능 (우선순위 중간)
4. ⏳ `POST /api/host/rooms/{roomId}/blocked-periods/unblock` - 부분 해제 (기간 분할)
5. ⏳ `GET /api/host/rooms/{roomId}/contracts` - 계약 목록 상세 조회
6. ⏳ `GET /api/host/rooms/{roomId}/blocked-periods` - 불가 기간 목록 조회
7. ⏳ `GET /api/host/rooms/{roomId}/schedule-info` - 방 기본 정보 조회

---

## 📐 데이터베이스 설계

### 1. BlockedPeriod 모델 (신규 생성)

**테이블명**: `blocked_periods`

**컬럼 정의**:
```sql
CREATE TABLE blocked_periods (
  id INT AUTO_INCREMENT PRIMARY KEY,
  room_id INT NOT NULL,
  start_date DATE NOT NULL COMMENT '불가 시작 날짜 (YYYY-MM-DD)',
  end_date DATE NOT NULL COMMENT '불가 종료 날짜 (YYYY-MM-DD)',
  reason VARCHAR(200) NULL COMMENT '불가 사유 (최대 200자)',
  created_by INT NOT NULL COMMENT '생성한 호스트 ID',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- 외래키
  CONSTRAINT fk_blocked_period_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  CONSTRAINT fk_blocked_period_host FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE NO ACTION,

  -- 인덱스
  INDEX idx_room_id (room_id),
  INDEX idx_start_date (start_date),
  INDEX idx_end_date (end_date),
  INDEX idx_date_range (room_id, start_date, end_date) COMMENT '날짜 범위 조회 최적화',

  -- 제약조건
  CONSTRAINT chk_date_order CHECK (end_date >= start_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='계약 불가 기간 관리';
```

**Sequelize 모델 파일**: `models/BlockedPeriod.js`

**주요 필드**:
- `roomId`: 방 ID (외래키)
- `startDate`: 시작 날짜 (DATE 타입)
- `endDate`: 종료 날짜 (DATE 타입)
- `reason`: 불가 사유 (선택사항, 최대 200자)
- `createdBy`: 생성한 호스트 ID (외래키)

**관계 설정**:
- `Room hasMany BlockedPeriod`
- `BlockedPeriod belongsTo Room`
- `BlockedPeriod belongsTo User (as: 'host')`

---

## 🗂️ 파일 구조

### 신규 생성 파일
```
c:\study\ezstay_back\
├── models\
│   └── BlockedPeriod.js                 # 신규 모델
├── controllers\
│   └── scheduleController.js            # 신규 컨트롤러
├── routes\
│   └── scheduleRoutes.js                # 신규 라우트
├── services\
│   └── scheduleService.js               # 신규 서비스 (비즈니스 로직)
├── migrations\
│   └── create_blocked_periods_table.sql # DB 마이그레이션
└── utils\
    └── dateHelper.js                    # 날짜 유틸리티 (옵션)
```

### 수정 파일
```
c:\study\ezstay_back\
├── models\
│   └── index.js                         # BlockedPeriod 관계 추가
├── server.js                            # scheduleRoutes 등록
├── utils\
│   └── responseHelper.js                # 에러 코드 추가
└── docs\
    └── API_DOCUMENTATION.md             # API 문서 업데이트
```

---

## 🔧 구현 상세

### 1. BlockedPeriod 모델 생성

**파일**: `models/BlockedPeriod.js`

**주요 메서드**:
- `findOverlapping(roomId, startDate, endDate)`: 겹치는 불가 기간 조회
- `findByRoomAndDateRange(roomId, startDate, endDate)`: 날짜 범위 내 불가 기간 조회

**검증 규칙**:
- `startDate <= endDate` (체크 제약조건)
- `startDate >= 오늘` (과거 날짜 불가)
- `reason` 최대 200자

---

### 2. scheduleService.js (비즈니스 로직)

**파일**: `services/scheduleService.js`

**주요 함수**:

#### `getScheduleData(roomId, startDate, endDate)`
- 방 정보, 계약 목록, 불가 기간 목록을 **한 번에 조회**
- JOIN 쿼리 최적화로 Network Round-Trip 최소화
- 반환 형식:
  ```javascript
  {
    roomInfo: { roomId, propertyName, propertyAddress },
    contracts: [...],
    blockedPeriods: [...],
    totalContracts: number,
    totalBlockedPeriods: number
  }
  ```

#### `createBlockedPeriod(roomId, hostId, startDate, endDate, reason)`
- 날짜 검증: startDate >= 오늘, endDate >= startDate
- **계약 충돌 검증**: 해당 날짜에 확정된 계약(`PAYMENT_COMPLETED`, `IN_PROGRESS`) 있는지 확인
- 충돌 시 409 Conflict 에러 반환
- 정상 생성 시 201 Created

#### `deleteBlockedPeriod(blockedId, hostId)`
- 권한 검증: 해당 불가 기간의 createdBy가 hostId와 일치하는지 확인
- 삭제 성공 시 200 OK

#### `unblockPeriod(roomId, hostId, startDate, endDate)` (Phase 2)
- 선택한 날짜 범위가 포함된 모든 불가 기간 검색
- 각 불가 기간을 분할:
  - 이전 부분: `blocked.startDate` ~ `(선택 startDate - 1일)`
  - 이후 부분: `(선택 endDate + 1일)` ~ `blocked.endDate`
- 원본 삭제 후 분할된 부분 생성
- 트랜잭션 처리로 원자성 보장

---

### 3. scheduleController.js (요청/응답 핸들링)

**파일**: `controllers/scheduleController.js`

**주요 함수**:

#### `getSchedule(req, res)`
- `GET /api/host/rooms/:roomId/schedule`
- 쿼리 파라미터: startDate, endDate (옵션)
- 기본값: 오늘 ~ 오늘+12개월
- `scheduleService.getScheduleData()` 호출
- 응답: `success(res, data, '일정 조회 성공')`

#### `createBlockedPeriod(req, res)`
- `POST /api/host/rooms/:roomId/blocked-periods`
- 요청 본문: `{ startDate, endDate, reason? }`
- 입력 검증: 날짜 형식(YYYY-MM-DD), 필수 필드
- `scheduleService.createBlockedPeriod()` 호출
- 응답: `created(res, data, '계약 불가 기간이 설정되었습니다')`
- 에러: 계약 충돌 시 `error(res, ErrorCodes.CONFLICT_WITH_CONTRACT, 409)`

#### `deleteBlockedPeriod(req, res)`
- `DELETE /api/host/rooms/:roomId/blocked-periods/:blockedId`
- `scheduleService.deleteBlockedPeriod()` 호출
- 응답: `deleted(res, '계약 불가 기간이 삭제되었습니다')`

#### `unblockPeriod(req, res)` (Phase 2)
- `POST /api/host/rooms/:roomId/blocked-periods/unblock`
- 요청 본문: `{ startDate, endDate }`
- `scheduleService.unblockPeriod()` 호출
- 응답: `success(res, data, '계약 가능으로 전환되었습니다')`

#### `getContracts(req, res)` (Phase 2)
- `GET /api/host/rooms/:roomId/contracts`
- Contract 모델 직접 조회
- 필터: `status IN ('PAYMENT_COMPLETED', 'IN_PROGRESS')`
- 응답: `success(res, { contracts, totalCount })`

#### `getBlockedPeriods(req, res)` (Phase 2)
- `GET /api/host/rooms/:roomId/blocked-periods`
- BlockedPeriod 모델 직접 조회
- 응답: `success(res, { blockedPeriods, totalCount })`

#### `getRoomScheduleInfo(req, res)` (Phase 2)
- `GET /api/host/rooms/:roomId/schedule-info`
- Room 모델에서 id, roomName, address만 조회
- 응답: `success(res, { roomId, propertyName, propertyAddress })`

---

### 4. scheduleRoutes.js (라우팅)

**파일**: `routes/scheduleRoutes.js`

```javascript
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const scheduleController = require('../controllers/scheduleController');

// 모든 라우트에 인증 미들웨어 적용
router.use(authenticateToken);

// Phase 1: 필수 기능
router.get('/rooms/:roomId/schedule', scheduleController.getSchedule);
router.post('/rooms/:roomId/blocked-periods', scheduleController.createBlockedPeriod);
router.delete('/rooms/:roomId/blocked-periods/:blockedId', scheduleController.deleteBlockedPeriod);

// Phase 2: 부가 기능
router.post('/rooms/:roomId/blocked-periods/unblock', scheduleController.unblockPeriod);
router.get('/rooms/:roomId/contracts', scheduleController.getContracts);
router.get('/rooms/:roomId/blocked-periods', scheduleController.getBlockedPeriods);
router.get('/rooms/:roomId/schedule-info', scheduleController.getRoomScheduleInfo);

module.exports = router;
```

**server.js 등록**:
```javascript
const scheduleRoutes = require('./routes/scheduleRoutes');
app.use('/api/host', scheduleRoutes);
```

---

### 5. 에러 코드 추가

**파일**: `utils/responseHelper.js`

```javascript
// 일정 관리 관련 (43xx)
CONFLICT_WITH_CONTRACT: { code: 4300, message: '해당 기간에 이미 확정된 계약이 있습니다.' },
CONFLICT_WITH_BLOCKED_PERIOD: { code: 4301, message: '이미 계약 불가로 설정된 기간입니다.' },
INVALID_DATE_RANGE: { code: 4302, message: '종료일은 시작일보다 이후여야 합니다.' },
PAST_DATE_NOT_ALLOWED: { code: 4303, message: '과거 날짜는 선택할 수 없습니다.' },
BLOCKED_PERIOD_NOT_FOUND: { code: 4304, message: '계약 불가 기간을 찾을 수 없습니다.' },
```

---

## 🧪 테스트 시나리오

### 1. 불가 기간 생성 테스트
```
[성공] 예약 가능한 날짜에 불가 기간 설정
[실패] 계약된 날짜에 불가 기간 설정 → 409 Conflict
[실패] 과거 날짜에 불가 기간 설정 → 400 Bad Request
[실패] endDate < startDate → 400 Bad Request
[실패] 다른 호스트가 접근 → 403 Forbidden
```

### 2. 불가 기간 삭제 테스트
```
[성공] 존재하는 불가 기간 삭제
[실패] 존재하지 않는 불가 기간 삭제 → 404 Not Found
[실패] 다른 호스트가 삭제 시도 → 403 Forbidden
```

### 3. 통합 일정 조회 테스트
```
[성공] roomId로 방 정보, 계약, 불가 기간 한 번에 조회
[성공] startDate, endDate 쿼리 파라미터로 필터링
[실패] 존재하지 않는 roomId → 404 Not Found
[실패] 다른 호스트가 조회 → 403 Forbidden
```

### 4. 부분 해제 테스트 (Phase 2)
```
[성공] 불가 기간 중간 날짜 해제 → 기간 분할
[성공] 시작일 포함 해제 → 종료일만 남음
[성공] 종료일 포함 해제 → 시작일만 남음
[성공] 전체 기간 해제 → 원본 삭제만
```

---

## 📅 구현 일정

### Phase 1 (필수 기능) - 2일
- **Day 1 (1일차)**:
  - BlockedPeriod 모델 생성 ✅
  - DB 마이그레이션 실행 ✅
  - scheduleService.js 작성 (핵심 로직) ✅

- **Day 2 (2일차)**:
  - scheduleController.js 작성 ✅
  - scheduleRoutes.js 작성 ✅
  - server.js 연동 ✅
  - 에러 코드 추가 ✅
  - Phase 1 API 테스트 ✅

### Phase 2 (부가 기능) - 1일
- **Day 3 (3일차)**:
  - 부분 해제 API 구현 ✅
  - 개별 조회 API 구현 (contracts, blocked-periods, schedule-info) ✅
  - Phase 2 API 테스트 ✅
  - API 문서 업데이트 ✅

**총 소요 시간**: 3일

---

## 🔒 보안 고려사항

1. **권한 검증**:
   - 모든 API에서 `req.user.id`와 방의 `hostId` 일치 여부 확인
   - 다른 호스트의 일정 접근 차단

2. **SQL Injection 방지**:
   - Sequelize ORM의 파라미터화된 쿼리 사용
   - 사용자 입력 직접 SQL 삽입 금지

3. **입력 검증**:
   - 날짜 형식 검증 (YYYY-MM-DD)
   - 날짜 논리 검증 (startDate <= endDate)
   - 과거 날짜 차단

4. **Rate Limiting**:
   - 불가 기간 생성/삭제 API에 Rate Limiter 적용
   - 15분 내 20회 제한 권장

5. **로깅**:
   - 모든 일정 변경 작업 로그 기록
   - 에러 발생 시 상세 로그 (민감 정보 제외)

---

## 📈 성능 최적화

### 1. 인덱스 전략
- `(room_id, start_date, end_date)` 복합 인덱스로 날짜 범위 조회 최적화
- `status` 인덱스로 계약 상태 필터링 최적화

### 2. 캐싱 전략 (향후 적용)
```javascript
// Redis 캐싱 예시 (Phase 3)
const cacheKey = `schedule:${roomId}:${startDate}:${endDate}`;
const cachedData = await redisClient.get(cacheKey);

if (cachedData) {
  return JSON.parse(cachedData);
}

const data = await fetchScheduleData(roomId, startDate, endDate);
await redisClient.setex(cacheKey, 300, JSON.stringify(data)); // 5분 캐시
return data;
```

### 3. N+1 쿼리 방지
- `include` 옵션으로 eager loading 사용
- 계약, 불가 기간, 방 정보를 JOIN으로 한 번에 조회

---

## 🎯 성공 기준

### Phase 1 완료 조건
- [ ] BlockedPeriod 모델 생성 및 DB 동기화
- [ ] 3개 필수 API 정상 작동 (통합 조회, 생성, 삭제)
- [ ] 계약 충돌 검증 로직 동작
- [ ] 권한 검증 통과 (다른 호스트 차단)
- [ ] 에러 핸들링 정상 작동 (400, 403, 404, 409)

### Phase 2 완료 조건
- [ ] 부분 해제 API 정상 작동 (기간 분할)
- [ ] 4개 부가 API 정상 작동
- [ ] API 문서 업데이트 완료
- [ ] 모든 테스트 시나리오 통과

---

## 📚 참고 자료

### 관련 파일
- `models/Contract.js`: 계약 모델 참고
- `controllers/hostController.js`: 호스트 컨트롤러 패턴 참고
- `utils/responseHelper.js`: 응답 형식 및 에러 코드 참고

### 명세서
- 방 일정 관리 백엔드 API 명세서 v1.0 (2026-01-16)

---

## ✅ 검토 체크리스트

구현 전 확인사항:
- [ ] BlockedPeriod 모델 설계 검토 완료
- [ ] API 엔드포인트 경로 확정
- [ ] 에러 코드 체계 검토 완료
- [ ] 권한 검증 로직 확인
- [ ] 계약 충돌 검증 로직 확인
- [ ] 날짜 검증 규칙 확인
- [ ] 응답 형식 표준화 확인

구현 후 확인사항:
- [ ] 모든 API 수동 테스트 완료
- [ ] Postman 테스트 컬렉션 작성
- [ ] API 문서 업데이트 완료
- [ ] 에러 핸들링 검증 완료
- [ ] 보안 취약점 점검 완료
- [ ] 코드 리뷰 완료

---

**작성자**: Claude Code
**최종 수정**: 2026-01-16
