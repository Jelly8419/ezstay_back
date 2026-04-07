# 보증금 보류 관리 API — 관리자 가이드

> 권한: `super_admin`, `admin` 전용 (별도 표기 없는 한 동일)

---

## 상태 흐름 개요

```
[호스트] 보류 신청
    └─ checkoutStatus: HOLD_REQUESTED
       deposit_agreements: REQUESTED row 생성

[관리자] 승인 / 거절
    ├─ 승인 → checkoutStatus: HOST_PENDING
    │         deposit_agreements: APPROVED
    │         합의 기한 10일 시작
    │
    └─ 거절 → checkoutStatus: HOLD_REJECTED   ← 신규
              deposit_agreements: REJECTED
              카운트다운 재개 (holdRemainingMs 기준)
              호스트가 재신청 가능

[호스트] 합의 내용 제출
    └─ deposit_agreements: SUBMITTED

[게스트] 합의 동의
    └─ checkoutStatus: HOST_CONFIRMED
       deposit_agreements: ACCEPTED
       depositStatus: DEDUCTION_CONFIRMED | RETURN_CONFIRMED
       PG 부분환불 실행

[스케줄러] 10일 초과 시 자동 전액 반환
    └─ deposit_agreements: AUTO_RETURNED
       depositStatus: RETURN_CONFIRMED → RETURNED
```

---

## checkoutStatus 값 정의

| 값 | 설명 |
|----|------|
| `NOT_STARTED` | 퇴실 전 |
| `GUEST_COMPLETED` | 게스트 퇴실 완료 |
| `HOLD_REQUESTED` | 호스트 보류 신청 대기 |
| `HOLD_REJECTED` | 보류 신청 반려 **(신규)** |
| `HOST_PENDING` | 보류 승인 후 합의 진행 중 |
| `HOST_CONFIRMED` | 호스트 확인 완료 |

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

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/admin/deposits` | 보류 목록 조회 |
| GET | `/api/admin/deposits/pending-holds` | 신청 대기 목록 (하위호환) |
| GET | `/api/admin/deposits/:contractId` | 보류 상세 + 이력 조회 |
| POST | `/api/admin/deposits/:contractId/approve-hold` | 보류 승인 |
| POST | `/api/admin/deposits/:contractId/reject-hold` | 보류 거절 |
| POST | `/api/admin/deposits/:contractId/force-hold` | 강제 반환보류 |
| POST | `/api/admin/deposits/:contractId/retry-refund` | 환불 재시도 |

---

## 1. 보류 목록 조회

```
GET /api/admin/deposits
```

### Query Parameters

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `status` | string | N | 상태 필터 (아래 표 참고) |
| `contractId` | number | N | 특정 계약 ID |
| `hostName` | string | N | 호스트 이름 검색 |
| `startDate` | string | N | 보류 신청일 시작 `YYYY-MM-DD` |
| `endDate` | string | N | 보류 신청일 종료 `YYYY-MM-DD` |
| `page` | number | N | 페이지 (기본값: 1) |
| `limit` | number | N | 페이지당 항목 수 (기본값: 20) |

**status 필터값**

| 값 | 조회 대상 |
|----|----------|
| `REQUESTED` | 승인 대기 중 (`HOLD_REQUESTED`) |
| `REJECTED` | 거절된 건 (`HOLD_REJECTED`) **(신규)** |
| `APPROVED` | 승인됨, 합의 미제출 |
| `HOST_SUBMITTED` | 호스트 합의 제출 완료 |
| `AGREED` | 게스트 합의 동의 완료 |
| `AUTO_REFUNDED` | 데드라인 초과 자동반환 |
| _(없음)_ | 전체 (위 모든 상태 포함) |

### 응답

```json
{
  "data": {
    "holds": [
      {
        "contractId": 123,
        "room": { "id": 10, "roomName": "강남 원룸" },
        "guest": { "id": 55, "name": "김게스트" },
        "host": { "id": 30, "name": "이호스트" },
        "deposit": 300000,
        "deductRequestAmount": 100000,
        "holdReason": "벽 훼손",
        "holdRequestedAt": "2026-04-01T10:00:00.000Z",
        "holdApprovedAt": null,
        "holdStatus": "REJECTED",
        "rejectedReason": "증빙 자료 부족",
        "rejectedAt": "2026-04-02T09:00:00.000Z"
      }
    ],
    "pagination": {
      "total": 42,
      "page": 1,
      "limit": 20,
      "totalPages": 3
    }
  }
}
```

> `rejectedReason`, `rejectedAt` — `holdStatus === 'REJECTED'`일 때만 값 있음

---

## 2. 보류 상세 조회

```
GET /api/admin/deposits/:contractId
```

### 응답

```json
{
  "data": {
    "contractId": 123,
    "checkInDate": "2026-03-01T14:00:00",
    "checkOutDate": "2026-04-01T11:00:00",
    "guest": { "id": 55, "name": "김게스트", "email": "guest@example.com", "phoneNumber": "010-1234-5678" },
    "host": { "id": 30, "name": "이호스트", "email": "host@example.com", "phoneNumber": "010-9876-5432" },
    "room": { "id": 10, "roomName": "강남 원룸", "address": "서울시 강남구..." },
    "deposit": 300000,
    "holdStatus": "REJECTED",
    "holdReason": "벽 훼손",
    "holdRequestedAt": "2026-04-01T10:00:00.000Z",
    "holdApprovedAt": null,
    "refundableDeposit": 300000,
    "depositStatus": "HOLDING",
    "depositAgreements": [
      {
        "id": 2,
        "status": "REJECTED",
        "statusLabel": "보류 거절",
        "holdReason": "벽 훼손",
        "requestedAt": "2026-04-01T10:00:00.000Z",
        "rejectedAt": "2026-04-02T09:00:00.000Z",
        "rejectedReason": "증빙 자료 부족",
        "adminApprovedAt": null,
        "deductAmount": null,
        "agreementText": null,
        "submittedAt": null,
        "acceptedAt": null,
        "createdAt": "2026-04-01T10:00:00.000Z"
      },
      {
        "id": 1,
        "status": "REJECTED",
        "statusLabel": "보류 거절",
        "holdReason": "청소 불량",
        "requestedAt": "2026-03-30T08:00:00.000Z",
        "rejectedAt": "2026-03-31T10:00:00.000Z",
        "rejectedReason": "사진 증빙 없음",
        "adminApprovedAt": null,
        "deductAmount": null,
        "agreementText": null,
        "submittedAt": null,
        "acceptedAt": null,
        "createdAt": "2026-03-30T08:00:00.000Z"
      }
    ]
  }
}
```

> `depositAgreements` — 최신순 정렬, 신청/승인/거절/합의 전체 이력

---

## 3. 보류 승인

```
POST /api/admin/deposits/:contractId/approve-hold
```

- 진입 조건: `checkoutStatus === 'HOLD_REQUESTED'`
- 처리: 최신 `REQUESTED` row → `APPROVED`, Contract → `HOST_PENDING` / `RETURN_HOLD`

### 응답

```json
{
  "data": {
    "contractId": 123,
    "checkoutStatus": "HOST_PENDING",
    "depositStatus": "RETURN_HOLD",
    "holdApprovedAt": "2026-04-03T10:00:00.000Z",
    "agreementDeadline": "2026-04-13T10:00:00.000Z"
  },
  "message": "보증금 보류가 승인되었습니다. 합의 기한: 10일"
}
```

### 에러 코드

| 코드 | 설명 |
|------|------|
| 4670 | 보류 신청 대기 상태가 아닙니다 |
| 4672 | 보류 신청 이력을 찾을 수 없습니다 |

---

## 4. 보류 거절

```
POST /api/admin/deposits/:contractId/reject-hold
```

- 진입 조건: `checkoutStatus === 'HOLD_REQUESTED'`
- 처리: 최신 `REQUESTED` row → `REJECTED`, Contract → `HOLD_REJECTED`
- 카운트다운 재개: `holdRemainingMs` 기준으로 `checkoutRequestedAt` 재계산

### Request Body

```json
{
  "reason": "증빙 자료 부족으로 반려합니다."
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `reason` | string | N | 거절 사유 (호스트에게 노출됨) |

### 응답

```json
{
  "data": {
    "contractId": 123,
    "checkoutStatus": "HOLD_REJECTED",
    "holdRemainingMs": 14400000,
    "rejectReason": "증빙 자료 부족으로 반려합니다."
  },
  "message": "보증금 보류 신청이 거절되었습니다. 퇴실 확인 카운트다운이 재개됩니다."
}
```

> `holdRemainingMs` — 호스트가 재신청 가능한 남은 시간(ms). null이면 48h 카운트다운 이미 만료.

### 에러 코드

| 코드 | 설명 |
|------|------|
| 4671 | 보류 신청 대기 상태가 아닙니다 |
| 4673 | 보류 신청 이력을 찾을 수 없습니다 |

---

## 5. 강제 반환보류

```
POST /api/admin/deposits/:contractId/force-hold
```

- 호스트 신청 없이 관리자가 직접 `RETURN_HOLD` 처리
- 진입 조건: `contract.status === 'COMPLETED'` + `depositStatus`가 `RETURN_HOLD / DEDUCTION_CONFIRMED / RETURNED`가 아닌 경우

### Request Body

```json
{
  "reason": "분쟁 접수로 인한 강제 보류"
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `reason` | string | **Y** | 강제 보류 사유 |

### 응답

```json
{
  "data": {
    "contractId": 123,
    "checkoutStatus": "HOST_PENDING",
    "depositStatus": "RETURN_HOLD",
    "holdApprovedAt": "2026-04-03T10:00:00.000Z",
    "agreementDeadline": "2026-04-13T10:00:00.000Z",
    "forceHoldReason": "분쟁 접수로 인한 강제 보류"
  }
}
```

### 에러 코드

| 코드 | 설명 |
|------|------|
| 4675 | 강제 반환보류 사유 필수 |
| 4676 | 계약 완료 상태에서만 가능 |
| 4677 | 현재 보증금 상태에서 강제 보류 불가 |

---

## 6. 환불 재시도

```
POST /api/admin/deposits/:contractId/retry-refund
```

- 진입 조건: `depositStatus === 'REFUND_FAILED'`
- PG 재호출 후 성공 시 이전 확정 상태 복원

### 응답

```json
{
  "data": {
    "contractId": 123,
    "depositStatus": "RETURN_CONFIRMED",
    "refundedAmount": 200000
  },
  "message": "보증금 환불 재시도 성공"
}
```

### 에러 코드

| 코드 | 설명 |
|------|------|
| 4680 | 환불 실패 상태의 계약만 재시도 가능 |
| 4681 | 환불할 보증금 없음 |
| 4682 | 원결제 정보 없음 |
| 4900 | PG 재시도 실패 (502) |
