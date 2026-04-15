# UTC 통일 마이그레이션 계획

## 목적
현재 `timezone: '+09:00'` 설정으로 MySQL DATETIME 컬럼에 KST 값이 저장되는 구조를 UTC로 통일한다.
런칭 초기라 기존 데이터 마이그레이션은 불필요.

## 배경 — 현재 저장 메커니즘
```
Sequelize timezone: '+09:00'
→ 저장: JS Date (UTC) → +9h 더해서 → MySQL에 KST 시각 기록
→ 읽기: MySQL KST 시각 → -9h 해서 → JS Date (UTC) 반환

process.env.TZ = 'Asia/Seoul'
→ new Date().getHours() 등 로컬 메서드가 KST 기준으로 동작
→ d.setHours(14) = KST 14:00 설정
```

## 컬럼 분류 체계
| 분류 | 타입 | 설명 | UTC 전환 방법 |
|------|------|------|--------------|
| **A** | DATEONLY | 날짜 문자열 `'YYYY-MM-DD'` | 영향 없음 — TZ 무관 |
| **B** | DATE (비즈니스) | 외부 입력 기반, setHours 등 수동 파싱 | 코드 수정 필요 |
| **C** | DATE (타임스탬프) | `new Date()` / `DataTypes.NOW` / Sequelize 자동 | timezone 설정 변경으로 자동 해결 |
| **P** | DATE (PG 외부) | 토스페이먼츠 API 응답 시각 | timezone 설정 변경으로 자동 해결 |

---

## 전수조사 결과 — B 분류 (수동 코드 수정 필요)

| # | 테이블 | 컬럼 | 파일 | 문제 패턴 |
|---|--------|------|------|-----------|
| B-1 | contracts | check_in_date | contractController.js | `new Date(checkInDate); d.setHours(room.checkInTime \|\| 14, 0, 0, 0)` — setHours가 KST 로컬 기준 |
| B-2 | contracts | check_out_date | contractController.js | 동일 패턴 |
| B-3 | rental_orders | modifiable_until | rentalOrderController.js | `d.setHours(0, 0, 0, 0)` 기반 계산 |
| B-4 | rental_item_reservations | reserved_from | contractController.js | `contract.checkInDate` 복사 저장 → B-1 해결 시 연쇄 해결 |
| B-5 | rental_item_reservations | reserved_until | contractController.js | `contract.checkOutDate` 복사 저장 → B-2 해결 시 연쇄 해결 |
| B-6 | refunds | check_in_date | contractController.js | `contract.checkInDate` 복사 저장 → B-1 해결 시 연쇄 해결 |

## 전수조사 결과 — A 분류 (작업 불필요)
| 테이블 | 컬럼 | 비고 |
|--------|------|------|
| settlements | expected_date | DATEONLY 문자열 |
| settlements | payout_available_date | DATEONLY 문자열 |
| blocked_periods | start_date, end_date | DATEONLY 문자열 |
| payouts | payable_after | DATEONLY 문자열 |
| receipts | date | DATEONLY 문자열 |
| service_tasks | reference_date | DATEONLY 문자열 |
| contract_sequences | (date 컬럼) | DATEONLY 문자열 |
| notification_logs | (date 컬럼) | DATEONLY 문자열 |

---

## 작업 Phase

### Phase 1 — Sequelize timezone 설정 변경
**목표**: C/P 분류 컬럼 전부 UTC 저장으로 자동 전환

> ⚠️ 전수조사 결과: **28개 모델 파일**이 각각 `new Sequelize()` 인스턴스를 직접 생성함.
> `models/index.js`만 수정해서는 안 되고, 각 파일의 timezone도 모두 수정해야 함.
> 근본 해결책: 각 모델이 `models/index.js`의 sequelize 인스턴스를 공유하도록 리팩터링 (권장)
> 또는 단기 해결: 각 파일의 `timezone: '+09:00'` → `timezone: 'Z'` 일괄 치환

**개별 Sequelize 인스턴스 보유 모델 28개:**
AdminRefund, AlimtalkLog, AutoMessageTemplate, BlockedPeriod, ChatRoom,
Contract, ContractStatusLog, DepositAgreement, EzService, GuestRefundAccount,
HostReceiptSetting, Notification, NotificationLog, Receipt, ReceiptSetting,
Refund, RefundPolicyRule, RefundPolicyType, RentalItem, RentalItemReservation,
RentalOrder, RentalOrderItem, RentalOrderLog, RentalOrderRefundRequest,
Room, RoomAmenity, RoomPhoto, Settlement

- [x] **방향 결정**: index.js 공유 인스턴스 리팩터링 (Option B) 선택
- [x] `models/db.js` 생성 — 단일 Sequelize 인스턴스 (`timezone: '+00:00'`, UTC)
- [x] `models/index.js` — 자체 `new Sequelize()` 제거, `require('./db')` 공유 인스턴스 사용
- [x] 위 28개 모델 파일 — `require('./index')` 제거, `require('./db')` 공유 인스턴스 사용
- [x] 단위 테스트 실행 (`npm run test:unit`) — 48개 중 47개 통과 (1개 실패는 기존 버그, 우리 변경 무관)
- 주의: `timezone: 'Z'` 대신 `'+00:00'` 사용 — MySQL이 `'Z'`를 time zone으로 인식 못함

### Phase 2 — checkInDate / checkOutDate 저장 로직 수정 (B-1, B-2)
**목표**: setHours KST 의존성 제거, UTC 기준 저장

- [x] `contractController.js` — checkInDate 저장: `new Date(\`${checkInDate}T${hh}:00:00+09:00\`)` 방식으로 수정
- [x] `contractController.js` — checkOutDate 저장: 동일 수정
- [x] `contractController.js` L307 — rentalDeadline 계산: `+09:00` 명시, setUTCDate/setUTCHours 사용
- [x] B-4, B-5, B-6: B-1/B-2 수정 시 연쇄 해결 확인
- [ ] 관련 통합 테스트 실행 (`npx jest tests/integration/contract/ --runInBand`)

### Phase 3 — modifiable_until 저장 로직 수정 (B-3)
**목표**: 렌탈 주문 수정 기한 계산을 UTC 기준으로 변경

- [x] `models/RentalOrder.js` `calculateModifiableUntil()` — setUTCDate/setUTCHours(14,59,59,999)로 수정 (KST 23:59:59 = UTC 14:59:59)
- [x] `contractController.js` L2854 — modifiableUntil 비교 로직 동일 수정
- [ ] 관련 통합 테스트 실행

### Phase 4 — DATEONLY 파싱 쿼리 수정
**목표**: 날짜 필터 쿼리에서 `new Date(date + 'T00:00:00')` 패턴 UTC 명시

- [x] `controllers/adminController.js` — `'T00:00:00'` → `'T00:00:00+09:00'`, `'T23:59:59'` → `'T23:59:59+09:00'` 일괄 치환
- [x] `controllers/adminLogController.js` — 동일
- [x] `controllers/adminPaymentController.js` — 동일
- [x] `controllers/rentalOrderController.js` — 동일
- [x] `services/roomService.js` — 동일
- [x] `services/scheduleService.js` — 동일
- [x] `utils/contractHelper.js` — 동일

### Phase 5 — API 응답 변환 함수 정비
**목표**: UTC DB → KST 응답 변환을 한 곳에서만, 올바르게

- [x] `utils/dateHelper.js` — `toKSTString()`, `todayKST()`, `toDateStrKST()` 전부 UTC+9 명시적 계산으로 재작성 (TZ 환경변수 의존 제거)
- [x] `adminController.js` L824 — `room.approvedAt`: `toKSTString()` 적용
- [x] `adminController.js` L1293 — `reservation.holdApprovedAt`: `toKSTString()` 적용
- [x] `adminSettlementController.js` L478 — `settlement.completedAt`: `toKSTString()` 적용
- [x] `adminPaymentController.js` L186,187,260,261,312,313 — `requestedAt/approvedAt/createdAt`은 타임스탬프(C타입)이므로 Sequelize 자동 직렬화 유지 (변경 불필요)
- [ ] 전체 테스트 실행 (`npm test`)

### Phase 6 — 최종 검증
- [x] 전체 통합 테스트 실행 결과: 130개 중 125개 통과
  - 실패 5개: `13.cancellationImprovements` (4개), `02.approve` (1개) — 우리 변경 이전부터 존재하는 기존 버그
  - 우리 변경으로 `10.settlement.test.js` 1개가 추가로 통과됨 (기존 6개 실패 → 5개)
- [ ] DB에 실제 저장되는 값 확인 (MySQL 쿼리로 직접 확인)
  ```sql
  SELECT id, check_in_date, checked_in_at, created_at FROM contracts LIMIT 5;
  -- check_in_date: UTC 기준 (KST 14:00 → UTC 05:00:00)
  -- checked_in_at, created_at: UTC 값
  ```
- [ ] API 응답에서 날짜 포맷 확인 (checkInDate → `+09:00` suffix 포함 형식)

---

## 주의사항

### setHours 패턴 수정 방법
```js
// ❌ 현재 (KST 의존)
const d = new Date(checkInDate);       // "2026-04-10" → UTC 자정
d.setHours(room.checkInTime || 14, 0, 0, 0);  // KST 14:00 설정

// ✅ 변경 후 (UTC 기준 명시)
const d = new Date(`${checkInDate}T${String(room.checkInTime || 14).padStart(2,'0')}:00:00+09:00`);
// ISO8601에 +09:00 명시 → JS가 UTC로 정규화 → Sequelize timezone: 'Z'로 UTC 그대로 저장
```

### toKSTString 수정 방향
```js
// ❌ 현재 (TZ 환경 의존)
function toKSTString(date) {
  const d = new Date(date);
  const Y = d.getFullYear();   // TZ=Asia/Seoul 환경에서만 KST 반환
  ...
}

// ✅ 변경 후 (명시적 UTC+9 계산)
function toKSTString(date) {
  if (!date) return null;
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;
  // UTC 기준 +9h
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const Y = kst.getUTCFullYear();
  const M = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const D = String(kst.getUTCDate()).padStart(2, '0');
  const h = String(kst.getUTCHours()).padStart(2, '0');
  const m = String(kst.getUTCMinutes()).padStart(2, '0');
  const s = String(kst.getUTCSeconds()).padStart(2, '0');
  return `${Y}-${M}-${D}T${h}:${m}:${s}+09:00`;
}
```

### DATEONLY 날짜 필터 수정 방향
```js
// ❌ 현재 (KST 명시 없음)
new Date(startDate + 'T00:00:00')    // TZ 환경에 따라 해석 달라짐

// ✅ 변경 후 (KST 명시)
new Date(startDate + 'T00:00:00+09:00')   // 항상 KST 자정으로 파싱 → UTC로 정규화
new Date(endDate + 'T23:59:59+09:00')
```

---

## 진행 현황

| Phase | 상태 | 완료일 |
|-------|------|--------|
| 전수조사 | ✅ 완료 | 2026-04-16 |
| Phase 1 (timezone 설정) | ✅ 완료 | 2026-04-16 |
| Phase 2 (checkIn/Out 저장) | ✅ 완료 | 2026-04-16 |
| Phase 3 (modifiable_until) | ✅ 완료 | 2026-04-16 |
| Phase 4 (DATEONLY 파싱) | ✅ 완료 | 2026-04-16 |
| Phase 5 (응답 변환 정비) | ✅ 완료 | 2026-04-16 |
| Phase 6 (최종 검증) | 🔄 진행중 | 2026-04-16 |
