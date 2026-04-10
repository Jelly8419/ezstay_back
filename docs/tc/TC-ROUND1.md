# TC Round 1 — 계약 요청 · 결제 · 환불 · 호스트 취소

> 기준 날짜: 2026-04-10  
> 대상 범위: 계약 요청 → 승인 → 결제 → (게스트 환불 | 호스트 취소)  
> Mock 대상: `paytagClient`, `aligoClient`, `notificationService` (외부 API)

---

## 목차

1. [계약 요청](#1-계약-요청)
2. [호스트 승인 / 거절](#2-호스트-승인--거절)
3. [결제](#3-결제)
4. [렌탈 아이템 (옵션)](#4-렌탈-아이템-옵션)
5. [게스트 환불](#5-게스트-환불)
6. [호스트 취소](#6-호스트-취소)

---

## 상태 전이 요약

```
PENDING_APPROVAL
  → (승인) APPROVED
    → (결제) PAYMENT_COMPLETED
      → (게스트 환불) REFUNDED / CANCEL_REQUESTED
      → (호스트 취소) CANCELLED_BY_HOST
  → (거절) REJECTED
  → (게스트취소) CANCELLED_BY_GUEST
  → (만료) APPROVAL_EXPIRED
```

---

## 1. 계약 요청

`POST /api/contracts/request`  
Auth: 게스트 JWT

### TC-01-01 정상 계약 요청

| 항목 | 내용 |
|------|------|
| **전제조건** | 게스트 로그인, 방 published 상태, 날짜 중복 없음, 재고 충분 |
| **입력** | roomId, checkInDate, checkOutDate, totalDays, termsAgreed(모두 true), 서버 재계산 금액과 일치하는 finalTotalAmount |
| **기대 결과** | HTTP 200, Contract.status = `PENDING_APPROVAL` |
| **DB 검증** | Contract 생성, refundPolicySnapshot 저장됨, pricingSnapshot 저장됨 |
| **알림 검증** | 호스트에게 `CONTRACT_REQUEST_HOST` 알림 발송 |

### TC-01-02 약관 미동의

| 항목 | 내용 |
|------|------|
| **입력** | termsAgreed.cancellationPolicy = false |
| **기대 결과** | HTTP 400, 에러코드 TERMS_NOT_AGREED |
| **DB 검증** | Contract 생성 안 됨 |

### TC-01-03 자신의 방 예약 시도

| 항목 | 내용 |
|------|------|
| **전제조건** | 요청 게스트 = 방 호스트 동일 계정 |
| **기대 결과** | HTTP 400, 에러코드 CANNOT_BOOK_OWN_ROOM |

### TC-01-04 published 아닌 방 예약

| 항목 | 내용 |
|------|------|
| **전제조건** | 방 status = `draft` 또는 `inactive` |
| **기대 결과** | HTTP 404 또는 400 |

### TC-01-05 날짜 중복 — 기존 PAYMENT_COMPLETED 계약 존재

| 항목 | 내용 |
|------|------|
| **전제조건** | 동일 roomId + 겹치는 날짜에 PAYMENT_COMPLETED 계약 존재 |
| **기대 결과** | HTTP 409, 중복 예약 에러 |

### TC-01-06 날짜 중복 — IN_PROGRESS 계약 존재

| 항목 | 내용 |
|------|------|
| **전제조건** | 동일 roomId + 겹치는 날짜에 IN_PROGRESS 계약 존재 |
| **기대 결과** | HTTP 409 |

### TC-01-07 동일 게스트 중복 신청 — PENDING_APPROVAL 존재

| 항목 | 내용 |
|------|------|
| **전제조건** | 동일 게스트가 같은 방에 PENDING_APPROVAL 계약 이미 있음 |
| **기대 결과** | HTTP 409 |

### TC-01-08 동일 게스트 중복 신청 — APPROVED 존재

| 항목 | 내용 |
|------|------|
| **전제조건** | 동일 게스트가 같은 방에 APPROVED 계약 이미 있음 |
| **기대 결과** | HTTP 409 |

### TC-01-09 최소 계약일수 미달

| 항목 | 내용 |
|------|------|
| **전제조건** | 방 minContractDays = 14, 요청 totalDays = 7 |
| **기대 결과** | HTTP 400, 최소 계약일수 에러 |

### TC-01-10 서버 계산 금액과 불일치 (1원 초과)

| 항목 | 내용 |
|------|------|
| **입력** | finalTotalAmount = 서버계산값 + 2 |
| **기대 결과** | HTTP 400, 금액 불일치 에러 |

### TC-01-11 금액 오차 1원 이하 허용

| 항목 | 내용 |
|------|------|
| **입력** | finalTotalAmount = 서버계산값 + 1 |
| **기대 결과** | HTTP 200, 정상 생성 |

### TC-01-12 렌탈 아이템 — 입주 6일 전 기한 초과

| 항목 | 내용 |
|------|------|
| **전제조건** | 오늘 = 입주일 - 5일 (기한 초과) |
| **입력** | rentalItems 포함 |
| **기대 결과** | HTTP 400, 렌탈 아이템 기한 초과 에러 |

### TC-01-13 렌탈 아이템 — 재고 부족

| 항목 | 내용 |
|------|------|
| **전제조건** | SALE 타입 아이템 totalStock = 0 |
| **기대 결과** | HTTP 400, 재고 부족 에러 |

### TC-01-14 금액 계산 검증 — 렌탈 아이템 포함

| 항목 | 내용 |
|------|------|
| **전제조건** | rentalFee=1,000,000 / maintenanceFee=100,000 / cleaningFee=50,000 / rentalItemsFee=200,000 / deposit=300,000 / 할인없음 |
| **기대 결과** | platformFee = floor((1,000,000+100,000+50,000) × 0.099) = 114,345, finalTotalAmount = 1,764,345 |
| **검증 목적** | 서버 금액 재계산 로직 정확성 |

### TC-01-15 금액 계산 검증 — EZ청소서비스 사용 시

| 항목 | 내용 |
|------|------|
| **전제조건** | EZ청소서비스 이용, cleaningFee=50,000 |
| **기대 결과** | platformFee 산정 기준에서 cleaningFee 제외됨, 게스트 청소비 부담 없음 |

---

## 2. 호스트 승인 / 거절

`PATCH /api/contracts/:contractId/approve`  
`PATCH /api/contracts/:contractId/reject`  
Auth: 호스트 JWT

### TC-02-01 정상 승인

| 항목 | 내용 |
|------|------|
| **전제조건** | Contract.status = `PENDING_APPROVAL`, 본인 방 계약 |
| **기대 결과** | HTTP 200, Contract.status = `APPROVED` |
| **DB 검증** | ChatRoom 생성됨 (MySQL + Firestore) |
| **시스템메시지** | 채팅방에 `CONTRACT_APPROVED` 메시지 발송 |
| **알림** | 게스트에게 `CONTRACT_APPROVED` 알림 |

### TC-02-02 PENDING_APPROVAL 아닌 상태에서 승인 시도

| 항목 | 내용 |
|------|------|
| **전제조건** | Contract.status = `APPROVED` (이미 승인됨) |
| **기대 결과** | HTTP 400 |

### TC-02-03 타 호스트 계약 승인 시도

| 항목 | 내용 |
|------|------|
| **전제조건** | 로그인 호스트 ≠ 계약 방의 호스트 |
| **기대 결과** | HTTP 403 |

### TC-02-04 정상 거절

| 항목 | 내용 |
|------|------|
| **전제조건** | Contract.status = `PENDING_APPROVAL` |
| **기대 결과** | HTTP 200, Contract.status = `REJECTED` |
| **DB 검증** | ChatRoom 생성 안 됨 |
| **알림** | 게스트에게 `CONTRACT_REJECTED` 알림 |

### TC-02-05 승인 후 결제 만료 시간 설정 확인

| 항목 | 내용 |
|------|------|
| **기대 결과** | Contract.approvedAt 기록, paymentDeadline = approvedAt + 24시간 |

---

## 3. 결제

`POST /api/contracts/:contractId/confirm-payment`  
Auth: 게스트 JWT  
Mock: `paytagClient.confirmPayment` → 성공 응답 반환

### TC-03-01 정상 결제

| 항목 | 내용 |
|------|------|
| **전제조건** | Contract.status = `APPROVED` |
| **입력** | orderId = contract.orderId, amount = contract.finalTotalAmount |
| **기대 결과** | HTTP 200, Contract.status = `PAYMENT_COMPLETED` |
| **DB 검증 — Payment** | status=`DONE`, totalAmount=finalTotalAmount, balanceAmount=finalTotalAmount, paymentType=`CONTRACT` |
| **DB 검증 — Settlement** | 생성됨, status=`PENDING` |
| **DB 검증 — Settlement 날짜** | expectedDate = checkInDate + 3영업일 |
| **DB 검증 — payoutAvailableDate** | max(결제일+3영업일, checkInDate+1일) |
| **알림** | 호스트·게스트 모두 `PAYMENT_COMPLETED` 알림 |
| **시스템메시지** | 채팅방 `PAYMENT_COMPLETED` |
| **알림톡** | 알리고 발송 확인 (mock 호출) |

### TC-03-02 APPROVED 아닌 상태에서 결제

| 항목 | 내용 |
|------|------|
| **전제조건** | Contract.status = `PAYMENT_COMPLETED` (이미 결제됨) |
| **기대 결과** | HTTP 400 |
| **DB 검증** | Payment 추가 생성 안 됨 |

### TC-03-03 orderId 불일치

| 항목 | 내용 |
|------|------|
| **입력** | orderId = `WRONG_ORDER_ID` |
| **기대 결과** | HTTP 400 |

### TC-03-04 금액 불일치

| 항목 | 내용 |
|------|------|
| **입력** | amount = contract.finalTotalAmount + 1000 |
| **기대 결과** | HTTP 400 |
| **DB 검증** | Contract 상태 변경 안 됨 |

### TC-03-05 PG 결제 실패 (네트워크/카드 오류)

| 항목 | 내용 |
|------|------|
| **Mock 설정** | `paytagClient.confirmPayment` → 에러 throw (resultcode: '1001') |
| **기대 결과** | HTTP 400 또는 500 |
| **DB 검증** | Contract.status = `APPROVED` 유지 (롤백) |
| **DB 검증** | Payment 생성 안 됨, Settlement 생성 안 됨 |
| **DB 검증** | PaymentFailureLog 생성됨 |

### TC-03-06 Settlement 중복 생성 방지

| 항목 | 내용 |
|------|------|
| **전제조건** | 이미 Settlement 존재하는 상태에서 재결제 시도 |
| **기대 결과** | Settlement 1개만 존재 |

### TC-03-07 payoutAvailableDate 계산 — 결제일 기준이 더 늦은 경우

| 항목 | 내용 |
|------|------|
| **전제조건** | checkInDate = 오늘+1일, 결제일+3영업일 > checkInDate+1일 |
| **기대 결과** | payoutAvailableDate = 결제일+3영업일 |

### TC-03-08 payoutAvailableDate 계산 — 입주일 기준이 더 늦은 경우

| 항목 | 내용 |
|------|------|
| **전제조건** | checkInDate = 오늘+30일 |
| **기대 결과** | payoutAvailableDate = checkInDate+1일 |

### TC-03-09 렌탈 아이템 포함 결제 — RentalOrder 처리

| 항목 | 내용 |
|------|------|
| **전제조건** | 계약에 rentalItems 포함 |
| **기대 결과** | RentalOrder 결제 처리 완료, 아이템 status 변경 |

---

## 4. 렌탈 아이템 (옵션)

`PATCH /api/contracts/:contractId/rental-items`  
Auth: 게스트 JWT

### TC-04-01 PENDING_APPROVAL 상태에서 수정

| 항목 | 내용 |
|------|------|
| **전제조건** | Contract.status = `PENDING_APPROVAL`, 입주 6일 전 이상 |
| **기대 결과** | HTTP 200, rentalItemsFee 재계산, finalTotalAmount 업데이트 |
| **DB 검증** | 기존 RentalItemReservation 해제, 새 예약 생성 |

### TC-04-02 APPROVED 상태에서 수정

| 항목 | 내용 |
|------|------|
| **전제조건** | Contract.status = `APPROVED` |
| **기대 결과** | HTTP 200 |

### TC-04-03 PAYMENT_COMPLETED 이후 수정 시도

| 항목 | 내용 |
|------|------|
| **전제조건** | Contract.status = `PAYMENT_COMPLETED` |
| **기대 결과** | HTTP 400 |

### TC-04-04 입주 5일 전 기한 초과 수정 시도

| 항목 | 내용 |
|------|------|
| **전제조건** | 오늘 = checkInDate - 4일 |
| **기대 결과** | HTTP 400, 기한 초과 에러 |

### TC-04-05 SALE 타입 재고 부족

| 항목 | 내용 |
|------|------|
| **전제조건** | 아이템 totalStock = 0 |
| **기대 결과** | HTTP 400 |

### TC-04-06 옵션 제거 → 재고 복구

| 항목 | 내용 |
|------|------|
| **입력** | 기존 아이템 제거 |
| **기대 결과** | SALE 타입: totalStock 증가 / RENTAL 타입: Reservation 삭제 |

---

## 5. 게스트 환불

### 5-1. 환불 미리보기

`POST /api/contracts/:contractId/calculate-refund`  
Auth: 게스트 JWT

#### TC-05-01 PAYMENT_COMPLETED 상태에서 조회

| 항목 | 내용 |
|------|------|
| **기대 결과** | HTTP 200, 환불 금액 계산 결과 반환 |

#### TC-05-02 IN_PROGRESS 상태에서 조회

| 항목 | 내용 |
|------|------|
| **기대 결과** | HTTP 200 |

#### TC-05-03 결제 전(APPROVED) 상태에서 조회

| 항목 | 내용 |
|------|------|
| **기대 결과** | HTTP 400 |

#### TC-05-04 환불율 계산 — 100% 환불 정책 (입주 30일 전)

| 항목 | 내용 |
|------|------|
| **전제조건** | 환불 정책: 7일 전까지 100%, daysBeforeCheckin=30 |
| **기대 결과** | rentalFeeRefundRate=100, penaltyAmount=0, 보증금+관리비+청소비+수수료 전액 반환 |

#### TC-05-05 환불율 계산 — 50% 환불 정책

| 항목 | 내용 |
|------|------|
| **전제조건** | 환불 정책: 해당 기간 50%, daysBeforeCheckin=3 |
| **기대 결과** | rentalFeeRefundAmount = floor(rentalFee × 0.5), penaltyAmount = floor(rentalFee × 0.5), 보증금+관리비+청소비 전액 반환, 수수료 미환불 |

#### TC-05-06 환불율 계산 — 0% 환불 정책

| 항목 | 내용 |
|------|------|
| **전제조건** | 환불 정책: 0%, daysBeforeCheckin=0 |
| **기대 결과** | rentalFeeRefundAmount=0, penaltyAmount=rentalFee, 보증금+관리비+청소비만 반환 |

#### TC-05-07 결제 당일 취소 — 결제당일 규칙 vs 기간 규칙 중 높은 쪽 적용

| 항목 | 내용 |
|------|------|
| **전제조건** | 결제 당일 취소, 결제당일 규칙 100%, 기간 규칙 0% |
| **기대 결과** | refundRate=100 (높은 쪽 적용) |

#### TC-05-08 refundPolicySnapshot 기준 적용

| 항목 | 내용 |
|------|------|
| **전제조건** | 계약 시점 정책 100%, 현재 방 정책 0%로 변경됨 |
| **기대 결과** | 스냅샷 기준 100% 적용 |

#### TC-05-09 렌탈 아이템 항상 100% 환불

| 항목 | 내용 |
|------|------|
| **전제조건** | 환불율=0%, rentalItemsFee=200,000 |
| **기대 결과** | rentalItemsFeeRefundAmount=200,000 (환불율 무관) |

---

### 5-2. 환불 요청

`POST /api/contracts/:contractId/request-refund`  
Auth: 게스트 JWT  
Mock: `paytagClient.cancelPayment` → 성공 응답

#### TC-05-10 입주 전 자동 승인

| 항목 | 내용 |
|------|------|
| **전제조건** | Contract.status=`PAYMENT_COMPLETED`, 오늘 < checkInDate |
| **기대 결과** | HTTP 200 |
| **DB 검증 — Refund** | refundStatus=`APPROVED`, approvedAt 기록됨 |
| **DB 검증 — Contract** | status=`REFUNDED` |
| **DB 검증 — Payment** | balanceAmount 차감됨 (전액 취소 시 0) |
| **DB 검증 — Settlement** | status=`ON_HOLD` |
| **시스템메시지** | `REFUND_APPROVED` |
| **채팅** | isReadOnly=true (쓰기 마감) |
| **알림** | 호스트·게스트 `CONTRACT_CANCELED` 알림 |
| **Mock 검증** | `paytagClient.cancelPayment` 1회 호출됨 |

#### TC-05-11 입주 전 — 위약금 있을 때 Payout 생성

| 항목 | 내용 |
|------|------|
| **전제조건** | 환불율=50%, penaltyAmount>0 |
| **기대 결과** | `GUEST_PENALTY` Payout 생성, amount=penaltyAmount |

#### TC-05-12 입주 전 — 위약금 없을 때 Payout 미생성

| 항목 | 내용 |
|------|------|
| **전제조건** | 환불율=100%, penaltyAmount=0 |
| **기대 결과** | Payout 생성 안 됨 |

#### TC-05-13 입주 후 관리자 승인 대기

| 항목 | 내용 |
|------|------|
| **전제조건** | Contract.status=`PAYMENT_COMPLETED`, 오늘 >= checkInDate |
| **기대 결과** | HTTP 200 |
| **DB 검증 — Refund** | refundStatus=`REQUESTED`, approvedAt=null |
| **DB 검증 — Contract** | status=`CANCEL_REQUESTED` |
| **DB 검증 — Payment** | balanceAmount 변경 안 됨 (PG 취소 안 함) |
| **시스템메시지** | `REFUND_REQUESTED` |
| **Mock 검증** | `paytagClient.cancelPayment` 호출 안 됨 |

#### TC-05-14 IN_PROGRESS 상태에서 요청 시도

| 항목 | 내용 |
|------|------|
| **전제조건** | Contract.status=`IN_PROGRESS` |
| **기대 결과** | HTTP 400 |

#### TC-05-15 이미 진행 중인 환불 재요청

| 항목 | 내용 |
|------|------|
| **전제조건** | Refund.refundStatus=`REQUESTED` 이미 존재 |
| **기대 결과** | HTTP 400 |

#### TC-05-16 정산 READY 이후 환불 차단

| 항목 | 내용 |
|------|------|
| **전제조건** | Settlement.status=`READY` |
| **기대 결과** | HTTP 400 |

#### TC-05-17 정산 PROCESSING 이후 환불 차단

| 항목 | 내용 |
|------|------|
| **전제조건** | Settlement.status=`PROCESSING` |
| **기대 결과** | HTTP 400 |

#### TC-05-18 체크인 당일 + 결제 당일 아닌 경우 차단

| 항목 | 내용 |
|------|------|
| **전제조건** | 오늘=checkInDate, 결제일≠오늘 |
| **기대 결과** | HTTP 400 |

#### TC-05-19 PG 취소 실패 시 롤백

| 항목 | 내용 |
|------|------|
| **Mock 설정** | `paytagClient.cancelPayment` → 에러 throw |
| **기대 결과** | HTTP 500 |
| **DB 검증** | Contract.status=`PAYMENT_COMPLETED` 유지 (롤백), Refund 생성 안 됨 |

---

## 6. 호스트 취소

### 6-1. 취소 미리보기

`GET /api/contracts/:contractId/cancel-by-host/preview`  
Auth: 호스트 JWT

#### TC-06-01 정상 미리보기

| 항목 | 내용 |
|------|------|
| **전제조건** | Contract.status=`PAYMENT_COMPLETED` |
| **기대 결과** | HTTP 200, hostBurdenAmount = penaltyAmount + originalPlatformFee |

#### TC-06-02 100% 환불 정책 기준 미리보기

| 항목 | 내용 |
|------|------|
| **전제조건** | 입주 30일 전, 환불 정책 100% |
| **기대 결과** | totalRefundAmount = finalTotalAmount (전액), hostBurdenAmount = 0 + platformFee |

---

### 6-2. 호스트 취소 실행

`POST /api/contracts/:contractId/cancel-by-host`  
Auth: 호스트 JWT  
Mock: `paytagClient.confirmPayment` (부담금), `paytagClient.cancelPayment` (게스트 환불)

#### TC-06-03 정상 호스트 취소 — 부담금 있음

| 항목 | 내용 |
|------|------|
| **전제조건** | Contract.status=`PAYMENT_COMPLETED`, 입주 3일 전 (환불율 50%) |
| **기대 결과** | HTTP 200, Contract.status=`CANCELLED_BY_HOST` |
| **DB 검증 — Payment(HOST_BURDEN)** | paymentType=`HOST_BURDEN`, status=`DONE`, amount=hostBurdenAmount |
| **DB 검증 — Payment(CONTRACT)** | balanceAmount=0, status=`CANCELED` |
| **DB 검증 — Refund** | refundStatus=`APPROVED`, hostBurdenStatus=`PAID` |
| **DB 검증 — Settlement** | status=`CANCELLED` |
| **DB 검증 — Payout** | `HOST_CANCELLATION_COMPENSATION` 생성, amount=guestCompensationAmount |
| **채팅** | isReadOnly=true |
| **알림** | 호스트·게스트 취소 알림 |
| **Mock 검증** | confirmPayment 1회, cancelPayment 1회 호출 |

#### TC-06-04 정상 호스트 취소 — 부담금 없음 (100% 환불)

| 항목 | 내용 |
|------|------|
| **전제조건** | 입주 30일 전, 환불율=100%, penaltyAmount=0 |
| **기대 결과** | HTTP 200 |
| **DB 검증** | Payment(HOST_BURDEN) 생성 안 됨 |
| **Mock 검증** | confirmPayment 호출 안 됨, cancelPayment 1회 호출 |

#### TC-06-05 PAYMENT_COMPLETED 아닌 상태에서 취소

| 항목 | 내용 |
|------|------|
| **전제조건** | Contract.status=`IN_PROGRESS` |
| **기대 결과** | HTTP 400 (IN_PROGRESS는 cancel-request API 사용해야 함) |

#### TC-06-06 타 호스트 계약 취소 시도

| 항목 | 내용 |
|------|------|
| **기대 결과** | HTTP 403 |

#### TC-06-07 부담금 PG 결제 실패 시 전체 롤백

| 항목 | 내용 |
|------|------|
| **Mock 설정** | `paytagClient.confirmPayment` (부담금) → 에러 throw |
| **기대 결과** | HTTP 400 또는 500 |
| **DB 검증** | Contract.status=`PAYMENT_COMPLETED` 유지, Refund 생성 안 됨 |

#### TC-06-08 게스트 환불 PG 실패 시 처리

| 항목 | 내용 |
|------|------|
| **Mock 설정** | confirmPayment 성공 → cancelPayment 에러 throw |
| **기대 결과** | HTTP 500 |
| **DB 검증** | 호스트 부담금 PG 원복 시도됨, Contract 롤백 |

---

## 환불 금액 계산 공식 참조

```
-- GUEST 귀책 --
totalRefundAmount (100%) = deposit + usageFee + cleaningFee + maintenanceFee + platformFee + rentalItemsFee
totalRefundAmount (N%)   = deposit + floor(usageFee×N%) + cleaningFee + maintenanceFee + rentalItemsFee
totalRefundAmount (0%)   = deposit + cleaningFee + maintenanceFee + rentalItemsFee
penaltyAmount            = floor(usageFee × (100-N)%)

-- HOST 귀책 --
totalRefundAmount        = finalTotalAmount (전액)
penaltyAmount            = floor(usageFee × (100-N)%)  ← 호스트가 부담

-- 공통 --
hostBurdenAmount         = penaltyAmount + originalPlatformFee
```

---

## 알림 발송 매트릭스

| 시점 | 알림 타입 | 게스트 | 호스트 | 채팅 시스템메시지 |
|------|----------|:------:|:------:|:---------------:|
| 계약 요청 | CONTRACT_REQUEST | O | O | — |
| 승인 | CONTRACT_APPROVED | O | — | CONTRACT_APPROVED |
| 거절 | CONTRACT_REJECTED | O | — | CONTRACT_REJECTED |
| 결제 완료 | PAYMENT_COMPLETED | O | O | PAYMENT_COMPLETED |
| 환불 자동승인 | CONTRACT_CANCELED | O | O | REFUND_APPROVED |
| 환불 관리자대기 | CONTRACT_CANCELED | O | O | REFUND_REQUESTED |
| 호스트 취소 | CONTRACT_CANCELED | O | O | CONTRACT_CANCELED_BY_HOST |

---

*작성일: 2026-04-10*  
*Round 2 범위: 퇴실/보증금 반환, 정산, 스케줄러 자동화 → [TC-ROUND2-STATUS.md](./TC-ROUND2-STATUS.md) 참조*
