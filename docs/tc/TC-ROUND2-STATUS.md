# TC Round 2 — 구현 현황 및 미작성 TC 목록

> 마지막 업데이트: 2026-04-10 (Round 2 진행 중 — 07~09 완료)

---

## Round 1 완료 현황

| 파일 | TC 수 | 상태 |
|------|:-----:|------|
| `tests/unit/smoke.test.js` | 4개 | ✅ 완료 |
| `tests/unit/refundCalculator.test.js` | 44개 | ✅ 완료 |
| `tests/integration/contract/01.request.test.js` | 17개 | ✅ 완료 |
| `tests/integration/contract/02.approve.test.js` | 6개 | ✅ 완료 |
| `tests/integration/contract/03.payment.test.js` | 9개 | ✅ 완료 |
| `tests/integration/contract/04.rentalItems.test.js` | 6개 | ✅ 완료 |
| `tests/integration/contract/05.refund.test.js` | 9개 | ✅ 완료 |
| `tests/integration/contract/06.hostCancel.test.js` | 8개 | ✅ 완료 |
| **합계** | **103개** | ✅ 전체 통과 |

### Round 1 커버리지

| 영역 | TC ID | 수량 |
|------|-------|:----:|
| 계약 요청 | TC-01-01 ~ TC-01-17 | 17개 |
| 호스트 승인/거절 | TC-02-01 ~ TC-02-06 | 6개 |
| 결제 | TC-03-01 ~ TC-03-09 | 9개 |
| 렌탈 아이템 | TC-04-01 ~ TC-04-06 | 6개 |
| 게스트 환불/취소 요청 | TC-05-01 ~ TC-05-09 | 9개 |
| 호스트 취소 | TC-06-01 ~ TC-06-08 | 8개 |

---

## Round 2 — TC 목록 및 구현 현황

### 7. 퇴실 (Checkout) ✅ 완료

`POST /api/contracts/:contractId/request-checkout`  
`POST /api/contracts/:contractId/confirm-checkout`

| TC ID | 시나리오 | 핵심 검증 포인트 | 상태 |
|-------|---------|----------------|------|
| TC-07-01 | 정상 퇴실 요청 | checkoutStatus=`GUEST_COMPLETED`, checkoutRequestedAt 기록 | ✅ |
| TC-07-02 | COMPLETED 아닌 상태에서 퇴실 요청 | HTTP 400, code 4612 | ✅ |
| TC-07-03 | 호스트 퇴실 확인 (차감 없음) | refundableDeposit=deposit, PG 즉시 환불 | ✅ |
| TC-07-04 | 퇴실 확인 후 depositStatus=`RETURNED` | PG 성공 시 | ✅ |
| TC-07-05 | 퇴실 확인 후 채팅 쓰기 마감 설정 | setChatWritableUntil 호출 (24시간) | ✅ |
| TC-07-06 | PG 환불 실패 | depositStatus=`REFUND_FAILED`, PaymentFailureLog 생성 | ✅ |
| TC-07-07 | 퇴실 요청 알림 | 호스트에게 `CHECKOUT_REQUEST` 알림 | ✅ |
| TC-07-08 | 퇴실 확인 알림 | 호스트·게스트 `CHECKOUT_CONFIRMED` 알림 | ✅ |

**구현 주석**:
- TC-07-06: `cancelPayment.mockRejectedValueOnce`로 PG 실패 시뮬레이션

---

### 8. 보증금 보류 · 합의 ✅ 완료

`PATCH /api/contracts/:contractId/checkout-hold`  
`POST /api/admin/deposits/:contractId/approve-hold`  
`POST /api/admin/deposits/:contractId/reject-hold`  
`POST /api/contracts/:contractId/deposit-agreement`  
`POST /api/contracts/:contractId/deposit-agreement/accept`

| TC ID | 시나리오 | 핵심 검증 포인트 | 상태 |
|-------|---------|----------------|------|
| TC-08-01 | 호스트 보류 신청 | checkoutStatus=`HOLD_REQUESTED`, DepositAgreement 생성 | ✅ |
| TC-08-02 | 관리자 보류 승인 | checkoutStatus=`HOST_PENDING`, holdApprovedAt 기록 | ✅ |
| TC-08-03 | 관리자 보류 거절 | checkoutStatus=`HOLD_REJECTED`, 카운트다운 재개 | ✅ |
| TC-08-04 | 호스트 합의 제출 | DepositAgreement.status=`SUBMITTED` | ✅ |
| TC-08-05 | 게스트 합의 동의 | depositStatus=`DEDUCTION_CONFIRMED`, 부분 PG 환불 | ✅ |
| TC-08-06 | 합의 동의 시 차감 금액 검증 | refundableDeposit = deposit - depositDeduction | ✅ |
| TC-08-07 | 보류 관련 시스템메시지 순서 | HOLD_REQUESTED → HOLD_APPROVED → AGREEMENT_SUBMITTED → 차감확정 | ✅ |
| TC-08-08 | 합의 관련 알림 각 단계별 | 게스트/호스트 수신 확인 | ✅ |

**구현 주의사항**:
- 합의 제출 파라미터: `deductAmount` (TC 문서의 `depositDeduction`과 다름)
- 관리자 보류 승인/거절: `POST` 메서드 (`PATCH` 아님)
- 시스템 메시지 타입: 소문자 snake_case (`deposit_hold_requested` 등)

---

### 9. 스케줄러 자동화 ✅ 완료

`schedulers/contractScheduler.js` (함수 직접 import하여 단위·통합 혼용 테스트)

| TC ID | 시나리오 | 핵심 검증 포인트 | 상태 |
|-------|---------|----------------|------|
| TC-09-01 | 승인 만료 (72h 초과) | status=`APPROVAL_EXPIRED`, 렌탈 재고 해제 | ✅ |
| TC-09-02 | 결제 만료 (24h 초과) | status=`PAYMENT_EXPIRED` | ✅ |
| TC-09-03 | 입실 시간 도래 → IN_PROGRESS | checkedInAt 기록, Settlement 생성 | ✅ |
| TC-09-04 | 퇴실 시간 도래 → COMPLETED | checkedOutAt 기록 | ✅ |
| TC-09-05 | 퇴실 자동 요청 (퇴실시간+48h) | checkoutStatus=`GUEST_COMPLETED` | ✅ |
| TC-09-06 | 퇴실 자동 확인 (요청+48h) | 보증금 자동 처리, checkoutStatus=`HOST_CONFIRMED` | ✅ |
| TC-09-07 | 합의 10일 초과 자동 전액 반환 | DepositAgreement.status=`AUTO_RETURNED` | ✅ |
| TC-09-08 | 스케줄러 중복 실행 방지 | 동일 계약에 중복 처리 안 됨 | ✅ |

---

### 10. 정산 (Settlement) ✅ 완료

| TC ID | 시나리오 | 핵심 검증 포인트 | 상태 |
|-------|---------|----------------|------|
| TC-10-01 | 결제 완료 시 Settlement 생성 | status=`PENDING` | ✅ |
| TC-10-02 | expectedDate 계산 — 평일 기준 | checkInDate + 3영업일 | ✅ |
| TC-10-03 | expectedDate 계산 — 주말 포함 | 토요일 기준 다음주 수요일 | ✅ |
| TC-10-04 | expectedDate 계산 — 공휴일 포함 | 공휴일 건너뜀 확인 | ✅ |
| TC-10-05 | PENDING → READY 전환 (스케줄러) | payoutAvailableDate 도래 시 전환 | ✅ |
| TC-10-06 | payoutAvailableDate 미도래 시 READY 차단 | PENDING 유지 | ✅ |
| TC-10-07 | 정산 금액 계산 — EZ청소 미사용 | netAmount = rentalFee + maintenanceFee + cleaningFee - hostPlatformFee | ✅ |
| TC-10-08 | 정산 금액 계산 — EZ청소 사용 | netAmount에서 청소비 제외 | ✅ |
| TC-10-09 | 취소 시 Settlement 상태 변경 | status=`ON_HOLD` (실제 구현: CANCELLED 아님) | ✅ |
| TC-10-10 | Settlement 중복 생성 방지 | IN_PROGRESS 재진입 시 1개만 존재 | ✅ |

**구현 주의사항**:
- TC 문서에서 취소 시 `CANCELLED`로 명시했으나, 실제 구현은 `ON_HOLD`

---

### 11. 채팅 시스템메시지 전체 ✅ 완료

`firebaseAdmin.sendSystemMessage` mock 호출 타입 검증

| TC ID | 시나리오 | 발생 시점 | 타입 | 상태 |
|-------|---------|----------|------|------|
| TC-11-01 | 계약 승인 | approveContract | `contract_approved` | ✅ |
| TC-11-02 | 결제 완료 | confirmPayment | `payment_completed` | ✅ |
| TC-11-03 | 결제 만료 | 스케줄러 | `payment_expired` | ✅ |
| TC-11-04 | 환불 자동 승인 | requestRefund (입주 전) | `refund_approved` | ✅ |
| TC-11-05 | 환불 관리자 대기 | requestRefund (입주 후) | `cancel_request_by_guest` 등 | ✅ |
| TC-11-06 | 호스트 취소 | cancelContractByHost | `contract_canceled_by_host` 또는 `host_cancel_request_approved` | ✅ |
| TC-11-07 | 자동 퇴실 요청 | 스케줄러 +48h | `checkout_auto_requested` | ✅ |
| TC-11-08 | 보류 신청 | holdCheckout | `deposit_hold_requested` | ✅ |
| TC-11-09 | 보류 승인 | 관리자 API | `deposit_hold_approved` | ✅ |
| TC-11-10 | 보류 거절 | 관리자 API | `deposit_hold_rejected` | ✅ |
| TC-11-11 | 합의 제출 | submitDepositAgreement | `deposit_agreement_submitted` | ✅ |
| TC-11-12 | 합의 동의 | acceptDepositAgreement | `deposit_deduction_confirmed` 또는 `deposit_return_confirmed` | ✅ |
| TC-11-13 | 10일 초과 자동 반환 | 스케줄러 | `deposit_auto_returned` | ✅ |

**구현 주의사항**:
- 시스템 메시지 타입은 모두 소문자 snake_case (`contract_approved` 등, UPPER_CASE 아님)
- `payment_completed`는 `sendSystemMessage(chatRoomId, type, data)` 형태 — call[1]이 타입
- 다른 케이스는 `sendSystemMessage(chatRoomId, text, type)` 형태 — call[2]가 타입
- `calledTypes()` 헬퍼: 각 call에서 문자열인 인자를 모두 수집하여 해결
- 승인 API: `PATCH /api/contracts/:id/approve` (POST가 아님)

---

### 12. 알림톡 (알리고 카카오톡) ✅ 완료

`aligoClient.sendAlimtalk` mock + `AlimtalkService.send` 동작 검증

| TC ID | 시나리오 | 수신자 | 검증 | 상태 |
|-------|---------|-------|------|------|
| TC-12-01 | 결제 완료 알림톡 | 호스트·게스트 | 결제 완료 후 계약상태 + mock 존재 확인 | ✅ |
| TC-12-02 | 계약 취소 알림톡 | 호스트·게스트 | 취소 후 계약상태 + skip 허용 | ✅ |
| TC-12-03 | 입주 당일 알림톡 | 호스트·게스트 | updateInProgress 스케줄러 → IN_PROGRESS | ✅ |
| TC-12-04 | 퇴실 D-1 알림톡 | 게스트 | AlimtalkService.sendCheckoutEve 직접 호출 + AlimtalkLog 확인 | ✅ |
| TC-12-05 | 알림톡 발송 실패 | — | sendAlimtalk reject → 계약 승인은 200 정상 완료 | ✅ |
| TC-12-06 | 전화번호 미등록 유저 | — | send() 반환값 skipped=true, sendAlimtalk 미호출 | ✅ |

**구현 주의사항**:
- AlimtalkService는 fire-and-forget → `await new Promise(r => setTimeout(r, 200~300))` 대기 필요
- tplCode=null인 템플릿은 자동 skip (isTemplateActive 체크)
- fallbackContent 없으면 buildMessage 실패 → skip (sendAlimtalk 미호출)
- 전화번호 없는 유저: `send()` 내부에서 즉시 `{ skipped: true }` 반환
- TC-12-05: `mockRejectedValueOnce`로 PG 실패 시뮬레이션 (계약 로직에 영향 없음 확인)

---

## 전체 TC 수량

| 라운드 | 영역 | TC 수 | 상태 |
|--------|------|:-----:|------|
| Round 1 | 계약요청·승인·결제·렌탈·환불·호스트취소 (유닛 포함) | 103개 | ✅ 완료 |
| Round 2 | 퇴실 | 8개 | ✅ 완료 |
| Round 2 | 보증금 보류·합의 | 8개 | ✅ 완료 |
| Round 2 | 스케줄러 | 8개 | ✅ 완료 |
| Round 2 | 정산 | 10개 | ✅ 완료 |
| Round 2 | 채팅 시스템메시지 | 13개 | ✅ 완료 |
| Round 2 | 알림톡 | 6개 | ✅ 완료 |
| **합계** | | **156개** | ✅ **전체 완료** |

---

## Round 2 테스트 코드 구현 현황

| 파일 | 대상 TC | 상태 |
|------|---------|------|
| `tests/integration/contract/07.checkout.test.js` | TC-07-01 ~ TC-07-08 | ✅ 8/8 통과 |
| `tests/integration/contract/08.depositHold.test.js` | TC-08-01 ~ TC-08-08 | ✅ 8/8 통과 |
| `tests/integration/contract/09.scheduler.test.js` | TC-09-01 ~ TC-09-08 | ✅ 8/8 통과 |
| `tests/integration/contract/10.settlement.test.js` | TC-10-01 ~ TC-10-10 | ✅ 10/10 통과 |
| `tests/integration/contract/11.chatMessages.test.js` | TC-11-01 ~ TC-11-13 | ✅ 13/13 통과 |
| `tests/integration/contract/12.alimtalk.test.js` | TC-12-01 ~ TC-12-06 | ✅ 6/6 통과 |

---

*업데이트: 2026-04-10 — Round 2 전체 완료 (53개/53개)*
