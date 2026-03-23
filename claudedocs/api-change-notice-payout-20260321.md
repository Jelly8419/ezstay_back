# API 변경사항 공지 - 지급(Payout) 시스템 도입

**작성일**: 2026-03-21
**버전**: v1.5.0
**대상**: 관리자 프론트엔드 개발자, 게스트/호스트 앱 프론트엔드 개발자

---

## 목차

1. [요약](#1-요약)
2. [앱 개발자 공지 - 변경사항 없음](#2-앱-개발자-공지---변경사항-없음)
3. [영업일 계산 로직 변경](#3-영업일-계산-로직-변경)
4. [지급 상태 흐름도](#4-지급-상태-흐름도)
5. [지급 유형별 생성 시점](#5-지급-유형별-생성-시점)
6. [신규 관리자 API 명세](#6-신규-관리자-api-명세)
7. [에러 코드 정의](#7-에러-코드-정의)
8. [DB 마이그레이션 안내](#8-db-마이그레이션-안내)
9. [주의사항](#9-주의사항)

---

## 1. 요약

이번 배포에서 **지급(Payout) 시스템**이 새로 도입됩니다. 계약 정산금, 위약금, 보증금 차감분, 취소 보상금 등 플랫폼에서 발생하는 모든 지급 항목을 관리자가 단일 페이지에서 조회하고 처리할 수 있습니다.

| 구분 | 내용 |
|------|------|
| 게스트/호스트 앱 | **변경 없음** - 기존 결제, 취소, 환불 흐름 동일 |
| 관리자 패널 | 신규 지급 관리 페이지 구현 필요 |
| 영업일 계산 | 공휴일 반영으로 날짜 필드 값 변동 가능 |

---

## 2. 앱 개발자 공지 - 변경사항 없음

게스트 앱, 호스트 앱 개발자는 **이번 배포에서 코드 수정이 필요하지 않습니다.**

다음 API들의 요청/응답 스펙은 변경되지 않았습니다.

| API | 설명 |
|-----|------|
| `POST /api/contracts/:id/payment/confirm` | 결제 확인 |
| `POST /api/contracts/:id/refund` | 게스트 취소/환불 요청 |
| `POST /api/contracts/:id/cancel-by-host` | 호스트 귀책 취소 |
| `POST /api/contracts/:id/deposit-agreement/accept` | 보증금 차감 합의 동의 |

위 API가 호출될 때 서버 내부적으로 지급 레코드가 자동 생성되지만, 응답 스펙에는 영향이 없습니다.

**단, 날짜 필드 관련 안내**: 아래 [3번 항목](#3-영업일-계산-로직-변경)을 참고하세요. `payableAfter`, `expectedDate` 값이 공휴일 여부에 따라 기존과 다르게 계산될 수 있습니다. 앱에서 이 날짜를 화면에 표시하고 있다면 영향이 있을 수 있습니다.

---

## 3. 영업일 계산 로직 변경

### 변경 내용

| 구분 | 변경 전 | 변경 후 |
|------|---------|---------|
| 영업일 계산 기준 | 주말(토, 일)만 제외 | 주말 + **한국 공휴일** 제외 |
| 공휴일 데이터 출처 | 없음 | 공공데이터포털 API (캐시 기반) |

### 영향받는 날짜 필드

- **`payableAfter`**: Payout 레코드의 지급 가능 최소 날짜 (결제 승인일 + 3영업일)
- **`expectedDate`**: Settlement 레코드의 정산 예정일 (입주일 + 3영업일)

### 동작 방식

공휴일 데이터는 서버 시작 시 캐시에 로드됩니다. 캐시에 해당 연도의 공휴일 데이터가 없는 경우 기존과 동일하게 주말만 제외하는 방식으로 폴백합니다.

---

## 4. 지급 상태 흐름도

```
[생성 시점]
    │
    ▼
PENDING (지급 대기)
  - 생성 직후 상태
  - payableAfter 날짜 미도래 시 유지
    │
    │ [스케줄러 자동 전환 - payableAfter 도래 시]
    ▼
PAYABLE (지급 가능)
  - 관리자 지급 실행 대기 상태
  - 이 상태에서 관리자 액션 가능
    │
    ├─── [관리자: execute] ───────────────▶ COMPLETED (지급 완료)
    │                                          - 최종 상태, 되돌릴 수 없음
    │
    ├─── [관리자: fail] ──────────────────▶ FAILED (지급 실패)
    │                                          │
    │                                          │ [관리자: retry]
    │                                          ▼
    │                                        PAYABLE (재시도)
    │                                          - 최신 계좌 정보로 재스냅샷
    │
    └─── [관리자: cancel] ─────────────── ┐
                                           │
PENDING ─── [관리자: cancel] ─────────────┤
                                           │
FAILED ──── [관리자: cancel] ─────────────┘
                                           │
                                           ▼
                                        CANCELLED (지급 취소)
                                          - 최종 상태, 되돌릴 수 없음
```

### 상태별 허용 액션 요약

| 현재 상태 | execute | fail | cancel | retry | note 수정 |
|-----------|---------|------|--------|-------|-----------|
| PENDING | - | - | 가능 | - | 가능 |
| PAYABLE | **가능** | 가능 | 가능 | - | 가능 |
| PROCESSING | - | 가능 | - | - | 가능 |
| COMPLETED | - | - | - | - | - |
| FAILED | - | - | 가능 | **가능** | 가능 |
| CANCELLED | - | - | - | - | - |

> **참고**: 현재 구현에서 execute는 PAYABLE → COMPLETED로 즉시 전환됩니다. PROCESSING 상태는 향후 자동화 이체 연동 시 활용될 중간 상태입니다.

---

## 5. 지급 유형별 생성 시점

| 지급 유형 | 한국어 | 수령인 | 생성 트리거 API | 생성 조건 |
|-----------|--------|--------|-----------------|-----------|
| `CONTRACT_SETTLEMENT` | 계약 정산 | 호스트 | `POST /api/contracts/:id/payment/confirm` | 결제 완료 시 항상 생성 |
| `GUEST_PENALTY` | 게스트 취소 위약금 | 호스트 | `POST /api/contracts/:id/refund` | 취소 위약금이 0원 초과인 경우 |
| `HOST_CANCELLATION_COMPENSATION` | 호스트 귀책 취소 보상 | 게스트 | `POST /api/contracts/:id/cancel-by-host` | 보상금이 0원 초과인 경우 |
| `DEPOSIT_DEDUCTION` | 보증금 차감 | 호스트 | `POST /api/contracts/:id/deposit-agreement/accept` | 합의 차감액이 0원 초과인 경우 |

### 계좌 정보 스냅샷 정책

지급 레코드 생성 시점의 계좌 정보를 스냅샷으로 저장합니다.

- **호스트 수령**: `UserBankAccount` 테이블의 기본 계좌 (`isDefault: true`)
- **게스트 수령**: `GuestRefundAccount` 테이블의 환불 계좌

계좌 정보가 없는 경우에도 지급 레코드는 생성되며, 계좌 필드가 `null`로 저장됩니다. 관리자가 retry 액션을 실행하면 해당 시점의 최신 계좌 정보로 재스냅샷됩니다.

---

## 6. 신규 관리자 API 명세

**Base URL**: `/api/admin/payouts`

**인증**: 모든 엔드포인트에 관리자 JWT 토큰 필요 (`Authorization: Bearer <token>`)

**권한**: 조회는 모든 관리자 역할 허용. 지급 실행/실패/취소/재시도/메모 수정은 `super_admin`, `admin` 역할만 허용

---

### 6-1. 지급 목록 조회

```
GET /api/admin/payouts
```

#### Query Parameters

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `page` | number | 아니오 | 1 | 페이지 번호 |
| `limit` | number | 아니오 | 20 | 페이지당 항목 수 |
| `status` | string | 아니오 | - | 상태 필터 (아래 ENUM 참고) |
| `payoutType` | string | 아니오 | - | 지급 유형 필터 |
| `recipientType` | string | 아니오 | - | 수령인 유형 (`HOST` \| `GUEST`) |
| `startDate` | string | 아니오 | - | 조회 시작일 (YYYY-MM-DD, `payableAfter` 기준) |
| `endDate` | string | 아니오 | - | 조회 종료일 (YYYY-MM-DD, `payableAfter` 기준) |
| `search` | string | 아니오 | - | 수령인 이름 또는 닉네임 검색 |

**`status` 허용값**: `PENDING` \| `PAYABLE` \| `PROCESSING` \| `COMPLETED` \| `FAILED` \| `CANCELLED`

**`payoutType` 허용값**: `CONTRACT_SETTLEMENT` \| `GUEST_PENALTY` \| `DEPOSIT_DEDUCTION` \| `HOST_CANCELLATION_COMPENSATION`

#### Response

```json
{
  "success": true,
  "data": {
    "total": 42,
    "page": 1,
    "limit": 20,
    "payouts": [
      {
        "id": 1,
        "contractId": 123,
        "payoutType": "CONTRACT_SETTLEMENT",
        "payoutTypeLabel": "계약 정산",
        "recipientType": "HOST",
        "recipientId": 45,
        "recipientName": "홍길동",
        "amount": 350000,
        "status": "PAYABLE",
        "statusLabel": "지급 가능",
        "payableAfter": "2026-03-24",
        "processedAt": null,
        "createdAt": "2026-03-21T10:00:00.000Z"
      }
    ]
  }
}
```

#### 목록 응답 필드 설명

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | number | 지급 레코드 ID |
| `contractId` | number | 연관 계약 ID |
| `payoutType` | string | 지급 유형 (ENUM) |
| `payoutTypeLabel` | string | 지급 유형 한국어 |
| `recipientType` | string | 수령인 유형 (`HOST` \| `GUEST`) |
| `recipientId` | number | 수령인 User ID |
| `recipientName` | string \| null | 수령인 이름 (없으면 닉네임) |
| `amount` | number | 지급 금액 (원) |
| `status` | string | 현재 상태 (ENUM) |
| `statusLabel` | string | 상태 한국어 |
| `payableAfter` | string | 지급 가능 최소 날짜 (YYYY-MM-DD) |
| `processedAt` | string \| null | 처리 완료 시각 (ISO 8601) |
| `createdAt` | string | 생성 시각 (ISO 8601) |

---

### 6-2. 지급 상세 조회

```
GET /api/admin/payouts/:payoutId
```

#### Path Parameters

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `payoutId` | number | 지급 레코드 ID |

#### Response

```json
{
  "success": true,
  "data": {
    "id": 1,
    "contractId": 123,
    "settlementId": 5,
    "refundId": null,
    "payoutType": "CONTRACT_SETTLEMENT",
    "payoutTypeLabel": "계약 정산",
    "recipientType": "HOST",
    "recipient": {
      "id": 45,
      "name": "홍길동",
      "nickname": "host123",
      "phoneNumber": "010-****-5678"
    },
    "amount": 350000,
    "status": "PAYABLE",
    "statusLabel": "지급 가능",
    "payableAfter": "2026-03-24",
    "bankName": "국민은행",
    "accountNumber": "123-****-456",
    "accountHolder": "홍길동",
    "adminId": null,
    "processedByAdmin": null,
    "processedAt": null,
    "failureReason": null,
    "note": null,
    "contract": {
      "id": 123,
      "checkInDate": "2026-03-21",
      "checkOutDate": "2026-03-28",
      "rentalFee": 400000,
      "maintenanceFee": 20000,
      "cleaningFee": 30000,
      "finalTotalAmount": 450000
    },
    "settlement": {
      "id": 5,
      "status": "READY",
      "netAmount": 350000,
      "expectedDate": "2026-03-26",
      "payoutAvailableDate": "2026-03-24"
    },
    "refund": null,
    "createdAt": "2026-03-21T10:00:00.000Z",
    "updatedAt": "2026-03-21T10:00:00.000Z"
  }
}
```

#### 상세 응답 추가 필드 설명

| 필드 | 타입 | 설명 |
|------|------|------|
| `settlementId` | number \| null | 연관 Settlement ID (CONTRACT_SETTLEMENT 타입에서 값 있음) |
| `refundId` | number \| null | 연관 Refund ID (GUEST_PENALTY, DEPOSIT_DEDUCTION 타입에서 값 있음) |
| `recipient.phoneNumber` | string | 뒷자리 마스킹 처리됨 |
| `bankName` | string \| null | 수령 계좌 은행명 (계좌 미등록 시 null) |
| `accountNumber` | string \| null | 계좌번호 (마스킹 처리됨, 예: `123-****-456`) |
| `accountHolder` | string \| null | 예금주명 |
| `processedByAdmin` | object \| null | 처리한 관리자 정보 (`id`, `name`) |
| `failureReason` | string \| null | 지급 실패 사유 (FAILED 상태 시) |
| `note` | string \| null | 관리자 메모 |
| `contract` | object | 연관 계약 요약 |
| `settlement` | object \| null | 연관 정산 정보 |
| `refund` | object \| null | 연관 환불 정보 (위약금, 보증금 차감 타입 시) |

---

### 6-3. 지급 실행

```
POST /api/admin/payouts/:payoutId/execute
```

**권한**: `super_admin`, `admin`

**실행 가능 상태**: `PAYABLE` 전용

관리자가 수동으로 이체를 완료한 후 완료 처리하는 엔드포인트입니다. `CONTRACT_SETTLEMENT` 타입인 경우 연관 Settlement의 상태도 `COMPLETED`로 함께 업데이트됩니다.

#### Request Body

```json
{
  "note": "이체 완료 - 국민은행 123-456-789"
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `note` | string | 아니오 | 처리 메모 |

#### Response (200)

```json
{
  "success": true,
  "message": "지급이 완료되었습니다.",
  "data": {
    "payoutId": 1,
    "status": "COMPLETED",
    "processedAt": "2026-03-24T14:30:00.000Z"
  }
}
```

---

### 6-4. 지급 실패 처리

```
POST /api/admin/payouts/:payoutId/fail
```

**권한**: `super_admin`, `admin`

**실행 가능 상태**: `PAYABLE`, `PROCESSING`

계좌번호 오류, 지급 반송 등 이체 실패 시 사용합니다. 실패 처리 후 retry로 재시도할 수 있습니다.

#### Request Body

```json
{
  "failureReason": "계좌번호 오류로 이체 반송"
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `failureReason` | string | **필수** | 실패 사유 |

#### Response (200)

```json
{
  "success": true,
  "message": "지급 실패로 처리되었습니다. 재시도가 필요합니다.",
  "data": {
    "payoutId": 1,
    "status": "FAILED"
  }
}
```

---

### 6-5. 지급 취소

```
POST /api/admin/payouts/:payoutId/cancel
```

**권한**: `super_admin`, `admin`

**실행 가능 상태**: `PENDING`, `PAYABLE`, `FAILED`

지급을 영구 취소합니다. 취소 후에는 되돌릴 수 없습니다.

#### Request Body

```json
{
  "note": "계약 분쟁으로 인한 지급 보류"
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `note` | string | 아니오 | 취소 사유 메모 |

#### Response (200)

```json
{
  "success": true,
  "message": "지급이 취소되었습니다.",
  "data": {
    "payoutId": 1,
    "status": "CANCELLED"
  }
}
```

---

### 6-6. 지급 재시도

```
POST /api/admin/payouts/:payoutId/retry
```

**권한**: `super_admin`, `admin`

**실행 가능 상태**: `FAILED` 전용

실패 처리된 지급을 `PAYABLE` 상태로 되돌립니다. 재시도 시 수령인의 **현재 등록된 최신 계좌 정보**로 재스냅샷합니다. 계좌 정보를 수정한 뒤 retry를 실행하면 변경된 계좌로 지급됩니다.

#### Request Body

없음

#### Response (200)

```json
{
  "success": true,
  "message": "지급 재시도 대기 상태로 변경되었습니다.",
  "data": {
    "payoutId": 1,
    "status": "PAYABLE"
  }
}
```

---

### 6-7. 지급 메모 수정

```
PATCH /api/admin/payouts/:payoutId/note
```

**권한**: `super_admin`, `admin`

**실행 가능 상태**: 모든 상태 (COMPLETED, CANCELLED 포함)

상태와 무관하게 언제든 메모를 수정할 수 있습니다.

#### Request Body

```json
{
  "note": "2026-03-24 홍길동 담당자 확인 완료"
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `note` | string | **필수** | 메모 내용 |

#### Response (200)

```json
{
  "success": true,
  "message": "메모가 업데이트되었습니다.",
  "data": {
    "payoutId": 1,
    "note": "2026-03-24 홍길동 담당자 확인 완료"
  }
}
```

---

## 7. 에러 코드 정의

| 코드 | HTTP 상태 | 메시지 | 발생 상황 |
|------|-----------|--------|-----------|
| `4801` | 404 | 지급 내역을 찾을 수 없습니다. | 존재하지 않는 `payoutId` 요청 |
| `4802` | 400 | 지급 가능 상태(PAYABLE)에서만 실행할 수 있습니다. | execute 시 상태가 PAYABLE이 아닌 경우 |
| `4803` | 400 | 실패 사유를 입력해주세요. | fail 요청 시 `failureReason` 미입력 |
| `4804` | 400 | PAYABLE 또는 PROCESSING 상태에서만 실패 처리 가능합니다. | fail 시 허용되지 않는 상태 |
| `4805` | 400 | PENDING/PAYABLE/FAILED 상태에서만 취소 가능합니다. | cancel 시 허용되지 않는 상태 |
| `4806` | 400 | FAILED 상태에서만 재시도 가능합니다. | retry 시 상태가 FAILED가 아닌 경우 |

### 에러 응답 형식

```json
{
  "success": false,
  "error": {
    "code": 4802,
    "message": "지급 가능 상태(PAYABLE)에서만 실행할 수 있습니다. 현재 상태: 지급 대기"
  }
}
```

---

## 8. DB 마이그레이션 안내

이번 배포에는 DB 스키마 변경이 포함됩니다. **서버 배포 전에 반드시 DBA 또는 백엔드 담당자에게 마이그레이션 실행을 요청하세요.**

### 변경 내용

| 구분 | 대상 | 내용 |
|------|------|------|
| 테이블 신규 생성 | `payouts` | 지급 관리 테이블 전체 |
| 컬럼 추가 | `settlements` | `payout_available_date`, `payout_id`, `payout_completed_at` 3개 컬럼 |

### 실행 파일

```
sql/add_payout_system.sql
```

---

## 9. 주의사항

### 관리자 개발자 대상

**COMPLETED, CANCELLED 상태는 되돌릴 수 없습니다.** execute 및 cancel 버튼은 확인 다이얼로그를 반드시 포함해야 합니다.

**계좌 정보는 생성 시점 스냅샷입니다.** 상세 페이지에서 표시하는 계좌 정보는 지급 레코드 생성 당시에 저장된 값입니다. 수령인이 이후에 계좌를 변경하더라도 해당 레코드의 계좌 정보는 바뀌지 않습니다. 최신 계좌 정보를 반영하려면 FAILED 처리 후 retry를 실행하세요.

**계좌번호는 마스킹됩니다.** `accountNumber` 필드는 중간 자리가 `****`로 처리된 값으로 반환됩니다. 전체 계좌번호는 API를 통해 제공되지 않습니다.

**search 파라미터는 이름과 닉네임 모두 검색합니다.** `LIKE %검색어%` 방식으로 동작합니다.

**`payableAfter` 날짜 범위 필터**는 `startDate` 이상, `endDate` 이하 범위로 조회됩니다. 날짜가 `payableAfter`를 기준으로 하므로 지급 생성일과는 다를 수 있습니다.

### 앱 개발자 대상

`payableAfter`나 `expectedDate`를 사용자에게 표시하고 있다면, 이 날짜가 공휴일에 따라 기존보다 1일 이상 늦게 계산될 수 있습니다. "영업일 기준 3일" 안내 문구를 "영업일(공휴일 제외) 기준 3일"로 수정하는 것을 권장합니다.

---

문의사항은 백엔드 채널로 연락해주세요.
