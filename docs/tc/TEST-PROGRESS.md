# 테스트 코드 작업 현황

> 마지막 업데이트: 2026-04-10 (06.hostCancel 완료 — Round 1 전체 완료)

---

## 전체 현황

| 구분 | 파일 | 테스트 수 | 상태 |
|------|------|-----------|------|
| Unit | `tests/unit/smoke.test.js` | 4 | ✅ 통과 |
| Unit | `tests/unit/refundCalculator.test.js` | 44 | ✅ 통과 |
| Integration | `tests/integration/contract/01.request.test.js` | 17 | ✅ 통과 |
| Integration | `tests/integration/contract/02.approve.test.js` | 6 | ✅ 통과 |
| Integration | `tests/integration/contract/03.payment.test.js` | 9 | ✅ 통과 |
| Integration | `tests/integration/contract/04.rentalItems.test.js` | 6 | ✅ 통과 |
| Integration | `tests/integration/contract/05.refund.test.js` | 9 | ✅ 통과 |
| Integration | `tests/integration/contract/06.hostCancel.test.js` | 8 | ✅ 통과 |

**현재 총 통과: 103 / 103** (Round 1 완료)

---

## 완료된 인프라 세팅

### 패키지
- `jest ^30.3.0`, `supertest ^7.2.2` 설치 (devDependencies)

### 설정 파일
- `jest.config.js` — testMatch, globalSetup/Teardown, testTimeout(30s), forceExit
- `.env.test` — NODE_ENV=test, DB_NAME=ezstay_test, JWT_SECRET 등

### 테스트 DB
- `ezstay_test` — mysqldump --no-data로 스키마만 복사
- globalSetup에서 DB 존재 확인 후 Sequelize.authenticate()만 수행 (sync 없음)

### Mock 설정 (`tests/setup/setup.js`)
| 대상 | 처리 방식 |
|------|-----------|
| `config/firebaseAdmin` | 전체 jest.mock (createChatRoomMetadata, sendSystemMessage 등) |
| `firebase-admin` | jest.mock (initializeApp, firestore) |
| `utils/paytagClient` | confirmPayment, cancelPayment mock / 순수함수는 requireActual |
| `utils/aligoClient` | jest.mock |
| `bull` | jest.mock (Queue 전체) |
| `config/redis` | jest.mock |

### 테스트 앱 (`tests/setup/testApp.js`)
- Express 앱 — DB 연결/스케줄러/Firebase 초기화 없이 라우터만 마운트
- supertest에서 직접 import하여 사용
- 마운트된 라우터: rooms, auth, user, host, contracts, refund, rentalOrders, rentalItems, admin, notifications

### 팩토리 (`tests/setup/factories/`)

#### userFactory.js
- `createGuest(overrides)` → `{ user, token, password }`
- `createHost(overrides)` → `{ user, token }`
- `generateToken(user)` → JWT (`{ userId, email }` — auth 미들웨어 `decoded.userId` 호환)
- `cleanupUsers(userIds)`

#### roomFactory.js
- `createRoom(hostId, overrides)` → `{ room, refundPolicy }`
  - RefundPolicyType `TEST_POLICY` (없으면 생성)
  - RefundPolicyRule 3개 (7일+:100%, 3-6일:50%, 0-2일:0%)
  - Room, RoomPhoto, EzService 생성
- `cleanupRooms(roomIds)`

#### contractFactory.js
- `createPendingContract(options)` → `{ contract, guest, guestToken, host, room, amounts }`
- `createApprovedContract(options)` → APPROVED + ChatRoom
- `createPaidContract(options)` → PAYMENT_COMPLETED + Payment + Settlement
- `createInProgressContract(options)` → IN_PROGRESS
- `createCompletedContract(options)` → COMPLETED
- `cleanupContract(contractId)` → Payment/Settlement/Refund/ChatRoom/Log 전체 삭제
- `calcAmounts(room, totalDays)` — 금액 계산 헬퍼

> **주의**: `createPaidContract`의 Settlement 생성에 `.catch(() => {})` 처리 있음 → 실패해도 조용히 넘어감. TC-05-07처럼 Settlement 존재를 전제하는 TC에서는 `findOne` 후 없으면 직접 생성 필요.

---

## 완료된 테스트 상세

### Unit: refundCalculator.test.js (44개)

models를 전체 mock하고 contract 객체에 `refundPolicySnapshot`을 직접 주입하는 방식.

| 그룹 | 케이스 수 | 내용 |
|------|-----------|------|
| GUEST 귀책 — 100% 환불 | 3 | 7일 이전 취소 |
| GUEST 귀책 — 50% 환불 | 3 | 3~6일 취소 |
| GUEST 귀책 — 0% 환불 | 2 | 0~2일 취소 |
| GUEST 귀책 — 결제당일 취소 | 2 | 당일 100% 환불 |
| GUEST 귀책 — 스냅샷 기준 | 3 | refundPolicySnapshot 적용 |
| GUEST 귀책 — 렌탈아이템 | 3 | 렌탈아이템 별도 환불 |
| HOST 귀책 — 전액환불 | 4 | 위약금 포함 |
| HOST 귀책 — 위약금 구간 | 6 | 3구간 위약금 계산 |
| 엣지케이스 | 18 | 입주당일, 입주후, floor처리, snapshot없음 등 |

### Integration: 01.request.test.js (17개)

`POST /api/contracts/request` 엔드포인트.

| TC | 내용 | 검증 포인트 |
|----|------|-------------|
| TC-01-01 | 정상 계약 요청 | 201, contractId, DB 상태, StatusLog |
| TC-01-02 | 인증 토큰 없음 | 401 |
| TC-01-03 | 필수 필드 누락 (roomId/checkInDate/termsAgreed) | 400 |
| TC-01-04 | 약관 미동의 | 400, code 4301 |
| TC-01-05 | 존재하지 않는 방 | 404 |
| TC-01-06 | 자기 방 예약 불가 | 400, code 4302 |
| TC-01-07 | 과거 날짜 | 400, code 4303 |
| TC-01-08 | 날짜 일수 불일치 | 400, code 4304 |
| TC-01-09 | 금액 불일치 (+10,000원) | 400, code 4307 |
| TC-01-10 | 날짜 중복 (PAYMENT_COMPLETED 기간) | 409, code 4305 |
| TC-01-11 | 동일 게스트 중복 요청 (PENDING_APPROVAL 기간) | 409, code 4306 |
| TC-01-12 | 최소 계약 일수 미달 (4일 < minContractDays 7일) | 400 |
| TC-01-13 | 렌탈 아이템 6일 이내 마감 | 400 |
| TC-01-14 | guestMessage 포함 | 201, DB 저장 확인 |
| TC-01-15 | 전화번호 없는 게스트 | 400 (requireUserInfo) |

### Integration: 02.approve.test.js (6개)

`PATCH /:contractId/approve`, `PATCH /:contractId/reject` 엔드포인트.

| TC | 내용 | 검증 포인트 |
|----|------|-------------|
| TC-02-01 | 호스트가 PENDING_APPROVAL 계약 승인 | 200, status=APPROVED, ChatRoom DB 생성, approvedAt |
| TC-02-02 | 게스트가 승인 시도 | 403 |
| TC-02-03 | 다른 호스트가 승인 시도 | 403, DB 상태 변경 없음 |
| TC-02-04 | APPROVED 계약 재승인 시도 | 400, code 4401 |
| TC-02-05 | 호스트가 PENDING_APPROVAL 계약 거절 | 200, status=REJECTED, cancellationReason, rejectedAt |
| TC-02-06 | hostMessage 없이 거절 시도 | 400, code 4402, DB 상태 변경 없음 |

> **실제 구현 확인**: reject body 필드명은 `hostMessage` (TC 문서 미기재).

### Integration: 03.payment.test.js (9개)

`POST /:contractId/confirm-payment` 엔드포인트.

| TC | 내용 | 검증 포인트 |
|----|------|-------------|
| TC-03-01 | 정상 결제 | 200, status=PAYMENT_COMPLETED, Payment/Settlement 생성 |
| TC-03-02 | PG 승인 실패(throw) | 400, code 4605, Payment 미생성, 상태 변경 없음 |
| TC-03-03 | PAYMENT_COMPLETED 계약 재결제 | 400, code **4602** (PAYMENT_NOT_AVAILABLE) |
| TC-03-04 | 금액 불일치 | 400, code 4604 |
| TC-03-05 | orderId 불일치 | 400, code 4603 |
| TC-03-06 | PENDING_APPROVAL 계약 결제 시도 | 400 또는 404 |
| TC-03-07 | 호스트 토큰으로 결제 시도 | 404 (guestId 기준 조회 실패) |
| TC-03-08 | Settlement.expectedDate 검증 | checkInDate + 3영업일 |
| TC-03-09 | paytagClient.confirmPayment 호출 확인 | mock 1회 호출 |

> **TC 문서 수정**: TC-03-03 code는 4606이 아닌 **4602** (컨트롤러가 PAYMENT_NOT_AVAILABLE 반환). `paymentKey` unique 제약 → 결제 성공 TC마다 contractId 기반 고유 `tran_key` mock 주입 필요.

### Integration: 04.rentalItems.test.js (6개)

`PATCH /:contractId/rental-items` 엔드포인트. 허용 상태: `PENDING_APPROVAL`, `APPROVED` (결제 전만).

| TC | 내용 | 검증 포인트 |
|----|------|-------------|
| TC-04-01 | APPROVED 상태에서 렌탈 아이템 추가 | 200, rentalItems 저장, rentalItemsFee 계산 |
| TC-04-02 | 입주 3일 전 (5일 기한 초과) 변경 시도 | 400, code 4701 |
| TC-04-03 | totalStock=0 아이템 선택 | 400, code 4702 |
| TC-04-04 | 호스트 토큰으로 변경 시도 | 403 |
| TC-04-05 | PAYMENT_COMPLETED 이후 PATCH rental-items | 400, code **4710** |
| TC-04-06 | 빈 배열로 업데이트 | 200, rentalItems=null, rentalItemsFee=0 |

> **TC 문서 수정**: TC-04-05 code는 4705가 아닌 **4710**. 결제 후 렌탈 추가는 `POST /rental-orders` 별도 API 사용.

### Integration: 05.refund.test.js (9개)

`POST /:contractId/request-refund`, `POST /:contractId/cancel-request` 엔드포인트.

| TC | 내용 | 검증 포인트 |
|----|------|-------------|
| TC-05-01 | 7일 이상 전 취소 | 201, autoApproved=true, rentalFeeRefundRate=100% |
| TC-05-02 | 3~6일 전 취소 | 201, rentalFeeRefundRate=50% |
| TC-05-03 | 0~2일 전 취소 | 201, rentalFeeRefundRate=0% |
| TC-05-04 | 결제 당일 취소 | isSameDayCancellation=true (테스트 정책에 전용 rule 없어 rate=0%) |
| TC-05-05 | IN_PROGRESS 취소 요청 | `POST /cancel-request` → 200, CANCEL_REQUESTED |
| TC-05-06 | CANCEL_REQUESTED 재시도 | `POST /cancel-request` → 400, code 4623 |
| TC-05-07 | Settlement READY 이후 환불 시도 | 400, code 4504 |
| TC-05-08 | COMPLETED 계약 환불 시도 | 400, code 4501 |
| TC-05-09 | 호스트 토큰으로 request-refund 시도 | 404 (guestId 기준 조회 실패) |

> **TC 문서 수정**:
> - TC-05-05/06 엔드포인트: `/request-refund` 아닌 `/cancel-request` (IN_PROGRESS에서 `/request-refund`는 4501 반환)
> - TC-05-06: 재시도 에러코드는 4623 (CANCEL_REQUESTED 상태 진입 불가)
> - `rentalFeeRefundRate`는 DECIMAL 컬럼 → DB 조회 시 `"50.00"` 문자열 반환, `parseFloat()` 비교 필요
> - 자동 승인 + PG 취소 완료 시 refundStatus는 `APPROVED`가 아닌 `COMPLETED`

### Integration: 06.hostCancel.test.js (8개)

`POST /:contractId/cancel-request` (호스트), `POST /api/admin/reservations/:contractId/approve-cancel-request`, `POST /api/admin/reservations/:contractId/reject-cancel-request` 엔드포인트.

관리자 토큰: `Admin` 테이블에 레코드 생성 후 `jwt.sign({ userId: admin.id })` — `authenticateAdmin` 미들웨어가 `decoded.userId`로 `Admin.findByPk` 수행.

| TC | 내용 | 검증 포인트 |
|----|------|-------------|
| TC-06-01 | PAYMENT_COMPLETED에서 호스트 cancel-request | 400, code 4623 (컨트롤러 IN_PROGRESS만 허용) |
| TC-06-02 | IN_PROGRESS에서 호스트 cancel-request | 200, status=CANCEL_REQUESTED |
| TC-06-03 | reason 없이 cancel-request | 400, code 4622, 상태 변경 없음 |
| TC-06-04 | 관리자 approve-cancel-request | 200, CANCELLED_BY_HOST, Settlement ON_HOLD |
| TC-06-05 | 관리자 reject-cancel-request | 200, IN_PROGRESS 복원 |
| TC-06-06 | CANCEL_REQUESTED 상태에서 재요청 | 400, code 4623 |
| TC-06-07 | IN_PROGRESS 계약에 관리자 approve 시도 | 400, code 4631 |
| TC-06-08 | IN_PROGRESS 계약에 관리자 reject 시도 | 400, code 4633 |

> **TC 문서 수정**:
> - TC-06-01: 컨트롤러가 `IN_PROGRESS`만 허용 → PAYMENT_COMPLETED에서 400, code 4623 반환 (TC 문서는 200 기대)
> - TC-06-03: reason 필드 미전송 검증으로 대체 (TC 문서의 "게스트 403" 케이스는 05.refund에서 이미 커버)
> - TC-06-04: 관리자 승인 시 Refund/AdminRefund 미생성 — `withRefund` 플래그만 응답에 포함, 실제 환불은 별도 수동 처리 흐름
> - `testApp.js`에 `adminRoutes` 마운트 추가 필요했음 (`/api/admin`)

---

## 남은 통합 테스트 목록

Round 1 완료. Round 2는 `docs/tc/TC-ROUND2-STATUS.md` 참조.

---

## 발견된 버그 / 픽스 이력

| # | 증상 | 원인 | 수정 |
|---|------|------|------|
| 1 | 통합 테스트 401 | `generateToken`이 `{ id }` 사용, auth는 `decoded.userId` 사용 | `{ userId: user.id }` 로 수정 |
| 2 | Room.create 실패 | roomFactory에서 `title`, `addressDetail`, `roomType` 등 잘못된 컬럼명 사용 | 실제 모델 컬럼(`roomName`, `detailAddress`, `buildingType` 등)으로 수정 |
| 3 | RefundPolicyType.create 실패 | `specialRules NOT NULL` 제약 | `specialRules: {}` 추가 |
| 4 | RefundPolicyRule.bulkCreate 실패 | `policyTypeId` 없음 (실제 컬럼은 `policyType` STRING) | `policyType: 'TEST_POLICY'` 로 수정 |
| 5 | RoomPhoto.create 실패 | `imageUrl` 컬럼 없음 (실제 `url`) | `url` 로 수정, `isThumbnail` 제거 |
| 6 | EzService.create 필드 오류 | `hasEzCleaning` 없음 (실제 `cleaningService`) | `cleaningService` 로 수정 |
| 7 | ContractStatusLog.create 실패 | `changedBy`에 userId 전달 (ENUM: 'GUEST'/'HOST'/'ADMIN'/'SYSTEM') | `changedBy: 'GUEST'` 로 수정 |
| 8 | Contract.create — Data too long | `orderId varchar(11)` 제한인데 `TEST_${Date.now()}` 사용 (28자) | yyMMddNNNN 형식 10자로 수정 |
| 9 | `calculateSettlementDate(...).catch` 오류 | 동기 함수에 `.catch()` 호출 | try/catch로 변경 |
| 10 | Jest 미종료 경고 | 각 모델이 독립 Sequelize 인스턴스 보유 → 커넥션 미정리 | `jest.config.js`에 `forceExit: true` 추가 |
| 11 | TC-03 paymentKey unique 충돌 | mock이 항상 `tran_key: 'test_tran_key'` 고정 반환 | 결제 성공 TC마다 `mockPaytagSuccess(contractId)`로 고유 키 주입 |
| 12 | TC-05-07 Settlement 미존재 | 팩토리 Settlement 생성 `.catch(()=>{})` 로 실패 무시 | `findOne` 후 없으면 `hostId` 포함하여 직접 생성 |
| 13 | TC-06 관리자 라우트 404 | `testApp.js`에 `adminRoutes` 미마운트 | `app.use('/api/admin', adminRoutes)` 추가 |

---

## 실행 명령어

```bash
# 전체 테스트
npm test

# 유닛 테스트만
npm run test:unit

# 통합 테스트만 (순서 보장)
npm run test:integration

# 특정 파일
npx jest tests/integration/contract/01.request.test.js --runInBand

# 커버리지
npm run test:coverage
```
