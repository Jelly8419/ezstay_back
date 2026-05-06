# EZStay Backend - CLAUDE.md

## 프로젝트
단기 임대 플랫폼 백엔드 API. Node.js / Express v5 / MySQL(Sequelize) / JWT / Kakao OAuth.

## ⚡ 항상 적용되는 규칙
- 응답은 반드시 `utils/responseHelper.js` 사용 (`res.json()` 직접 사용 금지)
- `User.destroy()` 절대 금지 → Soft Delete만 허용
- 모델에 `references` 옵션 사용 금지 → `models/index.js`에서만 관계 설정
- `sync({ alter: false })` 유지
- **JSON 컬럼**: MariaDB는 `LONGTEXT + json_valid` 형태로 저장됨. `DataTypes.JSON` 사용 시 char-by-char 객체 변환 이슈 발생 → **`DataTypes.TEXT('long')` + 명시적 `get/set` 직렬화 사용** (예: `models/MoveInRoom.js`의 `beds`, `models/MoveInCase.js`의 `roomSnapshot`)

---

## 📅 날짜/시간 처리 규칙

### 환경 특성 (반드시 숙지)
- **DB 저장: UTC 통일**
  - `models/db.js` → Sequelize `timezone: '+00:00'`
  - MySQL DATETIME 컬럼에 UTC 시각이 저장됨. Sequelize 가 읽으면 UTC 기준 `Date` 객체 반환.
- **프로세스 로컬 TZ: Asia/Seoul**
  - `server.js` 최상단에서 `process.env.TZ = 'Asia/Seoul'` 설정
  - `new Date().getHours()` 등 **로컬 메서드**는 KST 기준으로 동작
  - `d.setHours(14)` 는 KST 14:00 을 의도 → 저장될 땐 UTC 05:00 으로 자동 변환
- **API 응답 전환**: DB 에서 읽은 UTC Date 는 **반드시 `toKSTString()` 으로 KST 문자열로 변환**하여 내려줌
- `.toISOString()` 은 UTC(Z) 반환 → API 응답에 직접 사용 금지

### DB에 상수 DATETIME 값 INSERT/UPDATE 시 (SQL 직접 작성)
세션 타임존이 UTC(+00:00) 이므로 SQL 문자열도 **UTC 로 작성**해야 함.
```sql
-- ✅ KST 2026-08-31 23:59:59 을 저장하려면 UTC 환산값을 직접 입력
UPDATE promotion_events SET end_at = '2026-08-31 14:59:59'  -- UTC = KST 23:59:59
WHERE code = 'LAUNCH_HOST_2026';

-- ❌ 금지 — KST 의도로 '23:59:59' 쓰면 UTC 로 저장되어 KST 기준 9시간 밀림
UPDATE promotion_events SET end_at = '2026-08-31 23:59:59' WHERE ...;
```

### API 응답 시 날짜 변환 규칙

**`DataTypes.DATE` 컬럼 (시간 포함, checkInDate / checkOutDate / createdAt / approvedAt 등)**
```js
// ✅ 반드시 toKSTString() 사용
checkInDate: toKSTString(contract.checkInDate)
// → "2026-04-10T14:00:00+09:00"

// ❌ 금지 — UTC ISO 형식으로 직렬화됨
checkInDate: contract.checkInDate
// → "2026-04-10T05:00:00.000Z"
```

**`DataTypes.DATEONLY` 컬럼 (날짜만, expectedDate / payableAfter 등)**
```js
// ✅ 문자열로 저장되므로 그대로 사용 가능
expectedDate: settlement.expectedDate
// → "2026-04-10"
```

### 날짜 유틸 함수 위치: `utils/dateHelper.js`
| 함수 | 용도 | 반환 예시 |
|------|------|----------|
| `toKSTString(date)` | DATE 컬럼 API 응답 변환 | `"2026-04-10T14:00:00+09:00"` |
| `toDateStrKST(date)` | Date 객체 → KST 날짜 문자열 | `"2026-04-10"` |
| `todayKST()` | 오늘 날짜 문자열 (KST) | `"2026-04-10"` |
| `nowKSTString()` | 로그용 KST 타임스탬프 | `"2026-04-10T14:00:00+09:00"` |

### 날짜 필터 쿼리 규칙
```js
// ✅ 'YYYY-MM-DD' 문자열은 반드시 '+09:00' 붙여서 KST 명시
new Date(startDate + 'T00:00:00+09:00')   // KST 자정으로 파싱 → UTC Date 객체
new Date(endDate + 'T23:59:59+09:00')     // KST 끝으로 파싱 → UTC Date 객체

// ❌ 금지 — 'YYYY-MM-DD' 단독 파싱은 UTC 자정으로 해석됨 (9시간 오차)
new Date(startDate)
```

### new Date() 조작 후 응답 포함 시
```js
// ✅ toKSTString 으로 감싸서 응답
estimatedCompletionDate: toKSTString(someDate)

// ❌ 금지
estimatedCompletionDate: someDate          // Date 객체 직접 포함
estimatedCompletionDate: someDate.toISOString()  // UTC Z 반환
```

### 참고: 마이그레이션 배경은 `docs/utc-migration-plan.md`

---

## 📂 스킬 자동 매칭 규칙

### conventions-skill.md 로드 조건
**항상 로드**: 새 컨트롤러/서비스/모델/라우트 작성 시
**키워드**: API 응답, 에러 코드, 인증, 미들웨어, 검증, 트랜잭션, Sequelize

### architecture-skill.md 로드 조건
**키워드**: 구조, 모델 관계, 방 등록, 관리자, 권한, 흐름
**파일 경로**: `models/`, `routes/`, `controllers/`, `services/`
**의도**: 새 기능 추가, 모델 수정, 관리자 API 작업

---

## API 기본 URL
`http://localhost:8080`

## 주요 라우트
```
/api/auth              # 인증 (이메일/카카오)
/api/user              # 사용자 관리
/api/host              # 호스트 방 등록/관리
/api/host/move-in      # 입주 준비 서비스 (외부 플랫폼 임대인용 청소·옵션 부가 서비스)
/api/rooms             # 방 조회 (게스트용)
/api/contracts         # 계약/예약
/api/chats             # 채팅
/api/admin             # 관리자 전용 (service-tasks는 ?source=internal|move_in|all 분기)
```

---

## 🧹 입주 준비 서비스 (Move-in Service)

외부 플랫폼(에어비앤비 등)에서 단기임대 계약이 발생한 임대인이 EZstay의 청소·옵션 부가 서비스만 사용하도록 한 **분리된 서브 도메인**.

### 핵심 원칙 (PRD 15절)
- 기존 `Room`/`Contract`/`ServiceTask`와 **절대 합치지 말 것** (목적·상태값 다름)
- 임차인 옵션 결제 흐름과 임대인 청소 결제 흐름은 **독립 이벤트**로 처리
- 청소비는 **서버에서만 산정** (`utils/moveInCleaningPriceCalculator.js`) — 클라이언트 amount 신뢰 X
- 도어락/공동현관 비밀번호는 **AES-256-GCM 암호화 저장** (`utils/cryptoHelper.js`, env: `MOVE_IN_PASSWORD_KEY`)
- 케이스에 `room_snapshot` JSON 락인 → 방 수정해도 기존 케이스 영향 X (PRD 12.5)

### 도메인 모델
```
move_in_rooms              간편 방 정보 (정식 Room과 분리, 심사 X)
  └─ move_in_cases         입주 준비 등록 (외부 계약 1건 단위)
        ├─ move_in_payment_requests   임차인 옵션 결제 요청 토큰 (1:1)
        ├─ move_in_payments           임대인 청소 결제 (별도 결제 테이블)
        └─ move_in_service_tasks      외부 청소 업체 예약 (관리자 처리)
              └─ move_in_service_task_logs   상태 변경 이력
```

### 결제 흐름 (PayTag + Mock 하이브리드)
- `orderId`: `M + yymmdd + 5자리` (예: `M260507_00001`) — `utils/orderIdGenerator.js#generateMoveInOrderId`
- `PAYMENT_USE_MOCK=true` 환경변수로 PayTag 미연동 환경에서도 동작
- 실패 시 `MoveInPayment.status=FAILED`, 케이스 `cleaning_status=PAYMENT_PENDING` 유지 (재시도 가능)

### 알림톡 (현재 TODO)
`controllers/moveInPaymentRequestController.js`의 `dispatchPaymentRequestNotification`에 알리고 연동 hook만 작성됨. 템플릿명 `MOVE_IN_PAYMENT_REQUEST` 등록 후 주석 해제.

### 스케줄러 (`schedulers/moveInScheduler.js`)
- 매 10분 실행 (기존 contractScheduler와 독립)
- `cleaning_status=PAID` & 퇴실일 D-7 이내 케이스 → `MoveInServiceTask(CLEANING, PENDING)` 자동 생성

### 관리자 화면 통합
기존 `/api/admin/service-tasks`에 `?source=` 쿼리로 분기:
- `internal` (기본): 기존 ServiceTask
- `move_in`: MoveInServiceTask (도어락 비밀번호 자동 복호화 응답)
- `all`: 두 도메인 합쳐서 referenceDate 정렬 + `breakdown` 포함

### 상세 문서
- API: `C:\study\backend_md_list\입주준비서비스_임대인_API.md`
- 관리자: `C:\study\backend_md_list\입주준비서비스_관리자_API.md`
- 구현 이력: `C:\study\backend_md_list\입주준비서비스_임대인_구현계획.md`
