# 보증금 보류 — 호스트 / 게스트 가이드

> 권한: 호스트 전용 / 게스트 전용 (별도 표기)

---

## 상태 흐름 개요

```
[호스트] 보류 신청 (PATCH checkout-hold)
    └─ checkoutStatus: HOLD_REQUESTED
       depositAgreement row 생성 (status: REQUESTED)

[관리자] 승인
    └─ checkoutStatus: HOST_PENDING
       depositAgreement: APPROVED
       합의 기한 10일 시작

[관리자] 거절
    └─ checkoutStatus: HOLD_REJECTED  ← 반려 표시 (재신청 가능)
       depositAgreement: REJECTED
       rejectedReason, rejectedAt 세팅

[호스트] 합의 내용 제출 (POST deposit-agreement)
    └─ depositAgreement: SUBMITTED

[게스트] 합의 동의 (POST deposit-agreement/accept)
    └─ checkoutStatus: HOST_CONFIRMED
       depositAgreement: ACCEPTED
       depositStatus: DEDUCTION_CONFIRMED | RETURN_CONFIRMED
       PG 부분환불 실행

[스케줄러] 합의 기한(10일) 초과 시 자동 전액 반환
    └─ depositAgreement: AUTO_RETURNED
       depositStatus: RETURN_CONFIRMED → RETURNED
```

---

## checkoutStatus 값 정의

| 값 | 설명 |
|----|------|
| `NOT_STARTED` | 퇴실 전 |
| `GUEST_COMPLETED` | 게스트 퇴실 완료 — 보류 신청 가능 |
| `HOLD_REQUESTED` | 보류 신청 후 관리자 검토 중 |
| `HOLD_REJECTED` | 보류 신청 반려 — 재신청 가능 **(신규)** |
| `HOST_PENDING` | 보류 승인 후 합의 진행 중 |
| `HOST_CONFIRMED` | 합의 완료 |

## depositAgreement status 값 정의

| 값 | 설명 |
|----|------|
| `REQUESTED` | 호스트 보류 신청 **(신규)** |
| `APPROVED` | 관리자 승인 **(신규)** |
| `REJECTED` | 관리자 거절 **(신규)** |
| `SUBMITTED` | 호스트 합의 내용 제출 |
| `ACCEPTED` | 게스트 합의 동의 |
| `AUTO_RETURNED` | 데드라인 초과 자동 반환 |

---

## API 목록

| 메서드 | 경로 | 권한 | 설명 |
|--------|------|------|------|
| PATCH | `/api/contracts/:contractId/checkout-hold` | 호스트 | 보류 신청 / 재신청 |
| POST | `/api/contracts/:contractId/deposit-agreement` | 호스트 | 합의 내용 제출 |
| GET | `/api/contracts/:contractId/deposit-agreement` | 호스트·게스트 | 합의 내용 + 이력 조회 |
| POST | `/api/contracts/:contractId/deposit-agreement/accept` | 게스트 | 합의 동의 |
| GET | `/api/contracts/host` | 호스트 | 계약 목록 조회 (반려 정보 포함) |
| GET | `/api/contracts/:contractId` | 호스트·게스트 | 계약 상세 조회 (합의 이력 포함) |

---

## 1. 보류 신청 / 재신청

```
PATCH /api/contracts/:contractId/checkout-hold
```

> **호스트 전용**

- 진입 조건: `checkoutStatus === 'GUEST_COMPLETED'` 또는 **`'HOLD_REJECTED'`** (반려 후 재신청)
- 처리: `DepositAgreement` row 새로 생성 (`status: REQUESTED`), `checkoutStatus → HOLD_REQUESTED`

### Request Body

```json
{
  "reason": "벽면 훼손 및 청소 불량"
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `reason` | string | **Y** | 보류 사유 (관리자·게스트에게 노출) |

### 응답

```json
{
  "data": {
    "contractId": 123,
    "checkoutStatus": "HOLD_REQUESTED",
    "holdReason": "벽면 훼손 및 청소 불량",
    "holdRemainingMs": 14400000
  },
  "message": "퇴실 확인 보류가 신청되었습니다. 관리자 승인을 기다립니다."
}
```

> `holdRemainingMs` — 게스트 퇴실완료 시점 기준 48h 카운트다운의 남은 시간(ms). 보류 신청 시점에 캡처되어 저장됩니다. 거절 후 재신청 시에도 해당 값이 갱신됩니다.

### 에러 코드

| 코드 | 설명 |
|------|------|
| 4630 | 보류 사유 누락 |
| 4631 | 계약 완료 상태가 아님 |
| 4632 | 게스트 퇴실 완료 또는 반려 상태에서만 신청 가능 |
| 4633 | 퇴실 확인 완료 후 신청 불가 |

---

## 2. 합의 내용 제출

```
POST /api/contracts/:contractId/deposit-agreement
```

> **호스트 전용**

- 진입 조건: `checkoutStatus === 'HOST_PENDING'` (관리자 승인 완료)
- 처리: 최신 `APPROVED` row → `SUBMITTED` 상태로 업데이트 (재제출 가능)
- 기한: 관리자 승인 시점으로부터 10일

### Request Body

```json
{
  "deductAmount": 50000,
  "agreementText": "벽면 훼손으로 인한 수리비 청구"
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `deductAmount` | number | **Y** | 차감 요청 금액 (0 이상, 보증금 이하) |
| `agreementText` | string | **Y** | 합의 내용 설명 |

### 응답

```json
{
  "data": {
    "contractId": 123,
    "checkoutStatus": "HOST_PENDING",
    "depositAgreement": {
      "deductAmount": 50000,
      "agreementText": "벽면 훼손으로 인한 수리비 청구",
      "submittedAt": "2026-04-05T10:00:00.000Z",
      "deposit": 300000
    }
  },
  "message": "합의 내용이 제출되었습니다. 게스트의 동의를 기다립니다."
}
```

### 에러 코드

| 코드 | 설명 |
|------|------|
| 4640 | 차감 금액 누락 또는 음수 |
| 4641 | 합의 내용 누락 |
| 4642 | 계약 완료 상태가 아님 |
| 4643 | 관리자 승인 후 합의 진행 상태(`HOST_PENDING`)가 아님 |
| 4644 | 차감 금액이 보증금 초과 |
| 4645 | 승인된 보류 신청 없음 |
| 4646 | 합의 기한(10일) 초과 |
| 4647 | 게스트 이미 동의 완료 — 수정 불가 |

---

## 3. 합의 내용 + 이력 조회

```
GET /api/contracts/:contractId/deposit-agreement
```

> **호스트 · 게스트 모두 조회 가능**

### 응답

```json
{
  "data": {
    "contractId": 123,
    "deposit": 300000,
    "checkoutStatus": "HOST_PENDING",
    "depositAgreement": {
      "id": 3,
      "status": "SUBMITTED",
      "statusLabel": "호스트 합의 제출",
      "holdReason": "벽면 훼손",
      "requestedAt": "2026-04-03T09:00:00.000Z",
      "rejectedAt": null,
      "rejectedReason": null,
      "adminApprovedAt": "2026-04-04T10:00:00.000Z",
      "deductAmount": 50000,
      "agreementText": "벽면 훼손 수리비",
      "submittedAt": "2026-04-05T10:00:00.000Z",
      "acceptedAt": null,
      "refundableAmount": 250000
    },
    "history": [
      {
        "id": 3,
        "status": "SUBMITTED",
        "statusLabel": "호스트 합의 제출",
        "holdReason": "벽면 훼손",
        "requestedAt": "2026-04-03T09:00:00.000Z",
        "rejectedAt": null,
        "rejectedReason": null,
        "createdAt": "2026-04-03T09:00:00.000Z"
      },
      {
        "id": 2,
        "status": "REJECTED",
        "statusLabel": "보류 거절",
        "holdReason": "청소 불량",
        "requestedAt": "2026-04-01T08:00:00.000Z",
        "rejectedAt": "2026-04-02T09:00:00.000Z",
        "rejectedReason": "사진 증빙 없음",
        "createdAt": "2026-04-01T08:00:00.000Z"
      },
      {
        "id": 1,
        "status": "REJECTED",
        "statusLabel": "보류 거절",
        "holdReason": "벽 훼손",
        "requestedAt": "2026-03-30T07:00:00.000Z",
        "rejectedAt": "2026-03-31T10:00:00.000Z",
        "rejectedReason": "증빙 자료 부족",
        "createdAt": "2026-03-30T07:00:00.000Z"
      }
    ]
  }
}
```

> - `depositAgreement` — 최신 신청 건 상세 (현재 진행 중인 건)
> - `history` — 전체 신청 이력 최신순. 거절 내역 포함
> - `refundableAmount` — 보증금 - deductAmount (합의 제출 전엔 null)

### 에러 코드

| 코드 | 설명 |
|------|------|
| 4650 | 보류 신청 이력 없음 |

---

## 4. 합의 동의

```
POST /api/contracts/:contractId/deposit-agreement/accept
```

> **게스트 전용**

- 진입 조건: `checkoutStatus === 'HOST_PENDING'` + `depositAgreement.status === 'SUBMITTED'`
- 처리: `depositAgreement → ACCEPTED`, `checkoutStatus → HOST_CONFIRMED`
- PG: `refundableDeposit > 0`이면 즉시 부분환불 실행

### 응답

```json
{
  "data": {
    "contractId": 123,
    "status": "COMPLETED",
    "checkoutStatus": "HOST_CONFIRMED",
    "deposit": 300000,
    "depositDeduction": 50000,
    "refundableDeposit": 250000,
    "depositStatus": "RETURN_CONFIRMED"
  },
  "message": "합의가 완료되었습니다. 보증금 정산이 진행됩니다."
}
```

> `depositStatus`
> - `DEDUCTION_CONFIRMED` — 차감 금액 > 0 (호스트 수령 + 나머지 환급)
> - `RETURN_CONFIRMED` — 차감 금액 = 0 (전액 환급)

### 에러 코드

| 코드 | 설명 |
|------|------|
| 4660 | 합의 진행 상태(`HOST_PENDING`)가 아님 |
| 4661 | 호스트가 제출한 합의 내용 없음 |

---

## 5. 호스트 계약 목록 — 반려 관련 신규 필드

```
GET /api/contracts/host
```

기존 응답에서 보증금 관련 필드가 추가되었습니다.

### 추가된 응답 필드

```json
{
  "contracts": [
    {
      "checkoutStatus": "HOLD_REJECTED",
      "checkoutStatusLabel": "보류 신청 반려",
      "depositAgreementStatus": "REJECTED",
      "holdRejectedReason": "증빙 자료 부족으로 반려합니다.",
      "..."
    }
  ]
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `checkoutStatus` | string | 기존 필드. `HOLD_REJECTED` 값 추가 |
| `checkoutStatusLabel` | string | 기존 필드. `'보류 신청 반려'` 값 추가 |
| `depositAgreementStatus` | string \| null | 최신 `DepositAgreement` row의 status **(신규)** |
| `holdRejectedReason` | string \| null | `checkoutStatus === 'HOLD_REJECTED'`일 때만 값 있음 **(신규)** |

> **UI 활용 예시**
> - `checkoutStatus === 'HOLD_REJECTED'` → 반려 배지 표시 + `holdRejectedReason` 노출
> - `depositAgreementStatus === 'REQUESTED'` → "관리자 검토 중" 안내
> - `depositAgreementStatus === 'SUBMITTED'` → "게스트 동의 대기 중" 안내

---

## 6. 계약 상세 조회 — depositAgreements 이력

```
GET /api/contracts/:contractId
```

기존 응답의 `depositAgreements`가 단수(1건)에서 **배열(전체 이력)**로 변경되었습니다.

### 변경된 응답 구조

```json
{
  "contract": {
    "checkoutStatus": "HOLD_REJECTED",
    "checkoutStatusLabel": "보류 신청 반려",
    "depositStatus": "HOLDING",
    "depositAgreements": [
      {
        "id": 2,
        "status": "REJECTED",
        "statusLabel": "보류 거절",
        "holdReason": "청소 불량",
        "requestedAt": "2026-04-01T08:00:00.000Z",
        "rejectedAt": "2026-04-02T09:00:00.000Z",
        "rejectedReason": "사진 증빙 없음",
        "adminApprovedAt": null,
        "deductAmount": null,
        "agreementText": null,
        "submittedAt": null,
        "acceptedAt": null,
        "createdAt": "2026-04-01T08:00:00.000Z"
      },
      {
        "id": 1,
        "status": "REJECTED",
        "statusLabel": "보류 거절",
        "holdReason": "벽 훼손",
        "requestedAt": "2026-03-30T07:00:00.000Z",
        "rejectedAt": "2026-03-31T10:00:00.000Z",
        "rejectedReason": "증빙 자료 부족",
        "adminApprovedAt": null,
        "deductAmount": null,
        "agreementText": null,
        "submittedAt": null,
        "acceptedAt": null,
        "createdAt": "2026-03-30T07:00:00.000Z"
      }
    ]
  }
}
```

> - 배열 정렬: **최신순 (createdAt DESC)**
> - 신청 → 거절 → 재신청 → 승인 → 합의 전체 사이클이 누적됨
> - `rejectedReason` — `status === 'REJECTED'`일 때만 값 있음

### depositAgreement row 필드 설명

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | number | row ID |
| `status` | string | `REQUESTED \| APPROVED \| REJECTED \| SUBMITTED \| ACCEPTED \| AUTO_RETURNED` |
| `statusLabel` | string | 한국어 상태명 |
| `holdReason` | string | 호스트가 입력한 보류 사유 |
| `requestedAt` | string | 호스트 신청 시각 |
| `rejectedAt` | string \| null | 관리자 거절 시각 |
| `rejectedReason` | string \| null | 관리자 거절 사유 |
| `adminApprovedAt` | string \| null | 관리자 승인 시각 |
| `deductAmount` | number \| null | 호스트 차감 요청 금액 |
| `agreementText` | string \| null | 합의 내용 설명 |
| `submittedAt` | string \| null | 호스트 합의 제출 시각 |
| `acceptedAt` | string \| null | 게스트 동의 시각 |
| `createdAt` | string | row 생성 시각 |
