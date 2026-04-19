# EZStay Backend - CLAUDE.md

## 프로젝트
단기 임대 플랫폼 백엔드 API. Node.js / Express v5 / MySQL(Sequelize) / JWT / Kakao OAuth.

## ⚡ 항상 적용되는 규칙
- 응답은 반드시 `utils/responseHelper.js` 사용 (`res.json()` 직접 사용 금지)
- `User.destroy()` 절대 금지 → Soft Delete만 허용
- 모델에 `references` 옵션 사용 금지 → `models/index.js`에서만 관계 설정
- `sync({ alter: false })` 유지

---

## 📅 날짜/시간 처리 규칙

### 환경 특성 (반드시 숙지)
- `process.env.TZ = 'Asia/Seoul'` — `new Date()`, `getHours()` 등 로컬 메서드가 KST 기준으로 동작
- Sequelize `timezone: '+09:00'`, `dialectOptions.timezone: '+09:00'` 설정
- MySQL DATETIME 컬럼은 **시간대 정보 없이 저장** → Sequelize가 읽을 때 KST로 해석하여 Date 객체 반환
- Date 객체의 `.toISOString()`은 **항상 UTC(Z)** 반환 → API 응답에 직접 사용 금지

### API 응답 시 날짜 변환 규칙

**`DataTypes.DATE` 컬럼 (시간 포함, checkInDate / checkOutDate 등)**
```js
// ✅ 반드시 toKSTString() 사용
checkInDate: toKSTString(contract.checkInDate)
// → "2026-04-10T14:00:00"  (TZ 환경에서 로컬값 그대로)

// ❌ 금지 — UTC로 직렬화되어 9시간 감소
checkInDate: contract.checkInDate
// → "2026-04-09T05:00:00.000Z"
```

**`DataTypes.DATEONLY` 컬럼 (날짜만, expectedDate / payableAfter 등)**
```js
// ✅ 문자열로 저장되므로 그대로 사용 가능
expectedDate: settlement.expectedDate
// → "2026-04-10"
```

**타임스탬프 컬럼 (createdAt / updatedAt / approvedAt / paidAt 등)**
```js
// ✅ 반드시 toKSTString() 사용 — UTC 통일 이후 모든 DATE 컬럼 동일 규칙
createdAt: toKSTString(contract.createdAt)
// → "2026-04-10T14:00:00+09:00"

// ❌ 금지 — .000Z 형태로 UTC 그대로 전달됨
createdAt: contract.createdAt
// → "2026-04-10T05:00:00.000Z"
```

### 날짜 유틸 함수 위치: `utils/dateHelper.js`
| 함수 | 용도 | 반환 예시 |
|------|------|----------|
| `toKSTString(date)` | DATE 컬럼 API 응답 변환 | `"2026-04-10T14:00:00+09:00"` |
| `toDateStrKST(date)` | Date 객체 → 날짜 문자열 | `"2026-04-10"` |
| `todayKST()` | 오늘 날짜 문자열 | `"2026-04-10"` |
| `nowKSTString()` | 로그용 타임스탬프 | `"2026-04-10T14:00:00+09:00"` |

### 날짜 필터 쿼리 규칙
```js
// ✅ 'YYYY-MM-DD' 문자열은 반드시 '+09:00' 붙여서 KST 명시
new Date(startDate + 'T00:00:00+09:00')   // KST 자정으로 파싱 → UTC로 정규화
new Date(endDate + 'T23:59:59+09:00')     // KST 끝으로 파싱 → UTC로 정규화

// ❌ 금지 — 'YYYY-MM-DD' 단독 파싱은 UTC 자정으로 해석됨 (9시간 오차)
new Date(startDate)
```

### new Date() 조작 후 응답 포함 시
```js
// ✅ toKSTString으로 감싸서 응답
estimatedCompletionDate: toKSTString(someDate)

// ❌ 금지
estimatedCompletionDate: someDate          // Date 객체 직접 포함
estimatedCompletionDate: someDate.toISOString()  // UTC Z 반환
```

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
/api/auth      # 인증 (이메일/카카오)
/api/user      # 사용자 관리
/api/host      # 호스트 방 등록/관리
/api/rooms     # 방 조회 (게스트용)
/api/contracts # 계약/예약
/api/chats     # 채팅
/api/admin     # 관리자 전용
```
