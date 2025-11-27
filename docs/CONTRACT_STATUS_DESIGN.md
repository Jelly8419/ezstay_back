# Contract 상태값 및 로그 테이블 설계

> **구현 완료**: 2025-01-26
> **관련 파일**:
> - [Contract.js](../models/Contract.js) - ENUM 및 컬럼 추가
> - [ContractStatusLog.js](../models/ContractStatusLog.js) - 신규 모델
> - [migration_contract_status_enhancement.sql](../scripts/migration_contract_status_enhancement.sql) - DB 마이그레이션

## 1. 현재 상태 분석

### 기존 Contract.status ENUM 값
```
PENDING_APPROVAL    → 승인 대기 (게스트가 요청)
APPROVED            → 승인됨 (결제 대기)
REJECTED            → 거절됨 (호스트가 거절)
PAYMENT_COMPLETED   → 결제 완료
IN_PROGRESS         → 계약 진행중 (체크인 완료)
COMPLETED           → 계약 완료 (체크아웃 완료)
CANCELLED_BY_GUEST  → 게스트 취소
CANCELLED_BY_HOST   → 호스트 취소
REFUNDED            → 환불 완료
APPROVAL_EXPIRED    → 미승인 만료
PAYMENT_EXPIRED     → 미결제 만료
```

### 현재 문제점

1. **취소 시점 구분 불가**
   - `CANCELLED_BY_GUEST`: 결제 전 취소인지 결제 후 취소인지 알 수 없음
   - `CANCELLED_BY_HOST`: 동일한 문제

2. **관리자 취소 상태 부재**
   - 관리자가 강제 취소하는 케이스가 없음
   - 환불 여부에 따른 구분 불가

3. **환불과 취소의 관계 불명확**
   - `REFUNDED`가 `CANCELLED_*` 이후에 오는지 독립적인지 불명확

---

## 2. 취소 시나리오 분석

### 시나리오 A: 결제 전 취소 (APPROVED 상태)

| 취소 주체 | 환불 여부 | 위약금 | 설명 |
|-----------|-----------|--------|------|
| 게스트 | 없음 (결제 전) | 없음 | 단순 취소 |
| 호스트 | 없음 (결제 전) | 없음 | 단순 취소 |
| 관리자 | 없음 (결제 전) | 없음 | 강제 취소 |

### 시나리오 B: 결제 후 취소 (PAYMENT_COMPLETED 상태)

| 취소 주체 | 환불 여부 | 위약금 | 설명 |
|-----------|-----------|--------|------|
| 게스트 | O (정책 적용) | O (환불정책에 따라) | 환불금 = 결제금 - 위약금 |
| 호스트 | O (전액 또는 일부) | 호스트 페널티 가능 | 플랫폼 정책 적용 |
| 관리자 | O (전액) | 없음 | 입실 전 강제 취소 |
| 관리자 | X (없음) | 없음 | 입실 후 강제 취소 |

### 시나리오 C: 입실 후 취소 (IN_PROGRESS 상태)

| 취소 주체 | 환불 여부 | 위약금 | 설명 |
|-----------|-----------|--------|------|
| 게스트 | △ (잔여일 기준) | O (높음) | 조기 퇴실 |
| 호스트 | O (잔여일 전액) | 호스트 페널티 | 강제 퇴실 요청 |
| 관리자 | △ (상황에 따라) | 케이스별 | 분쟁 조정 |

---

## 3. 설계 방안 비교

### 방안 A: ENUM 값 세분화 (❌ 비권장)

```javascript
status: ENUM(
  // ... 기존 값들 ...
  'CANCELLED_BEFORE_PAYMENT_BY_GUEST',
  'CANCELLED_BEFORE_PAYMENT_BY_HOST',
  'CANCELLED_AFTER_PAYMENT_BY_GUEST',
  'CANCELLED_AFTER_PAYMENT_BY_HOST',
  'CANCELLED_BY_ADMIN_WITH_REFUND',
  'CANCELLED_BY_ADMIN_NO_REFUND'
)
```

**단점**:
- ENUM 값이 너무 많아짐 (유지보수 어려움)
- 향후 새로운 케이스 추가 시 마이그레이션 필요
- 쿼리 복잡도 증가

---

### 방안 B: 취소 관련 컬럼 추가 (⚠️ 보통)

```javascript
// Contract 모델에 추가
cancelledBy: ENUM('GUEST', 'HOST', 'ADMIN', 'SYSTEM'),
cancellationType: ENUM('BEFORE_PAYMENT', 'AFTER_PAYMENT', 'DURING_STAY'),
hasRefund: BOOLEAN
```

**장점**: 기존 ENUM 유지, 쿼리 단순
**단점**: 컬럼 증가, NULL 관리 필요

---

### 방안 C: 기존 구조 유지 + 로그 테이블 (✅ 권장)

**핵심 아이디어**:
1. 기존 ENUM에 **관리자 취소만 추가**
2. **ContractStatusLog** 테이블에서 모든 상태 변경 이력 관리
3. 취소 상세 정보는 **Refund 테이블**에서 관리 (이미 존재)

**장점**:
- 기존 호환성 유지
- 이력 추적 가능 (감사 로그)
- 유연한 확장성
- 정규화된 데이터 구조

---

## 4. 권장 설계안 (방안 C 상세)

### 4.1 Contract.status ENUM 수정 ✅ 구현 완료

```javascript
status: DataTypes.ENUM(
  // 진행 상태
  'PENDING_APPROVAL',              // 승인 대기
  'APPROVED',                      // 승인됨 (결제 대기)
  'REJECTED',                      // 거절됨
  'PAYMENT_COMPLETED',             // 결제 완료
  'IN_PROGRESS',                   // 계약 진행중 (체크인 완료)
  'COMPLETED',                     // 계약 완료 (체크아웃 완료)

  // 취소 상태 (기존)
  'CANCELLED_BY_GUEST',            // 게스트 취소
  'CANCELLED_BY_HOST',             // 호스트 취소

  // 취소 상태 (신규) - 관리자 취소 환불 여부로 세분화
  'CANCELLED_BY_ADMIN_WITH_REFUND', // 관리자 취소 (환불 O) ← 추가
  'CANCELLED_BY_ADMIN_NO_REFUND',   // 관리자 취소 (환불 X) ← 추가

  // 완료 상태
  'REFUNDED',                      // 환불 완료

  // 만료 상태
  'APPROVAL_EXPIRED',              // 미승인 만료
  'PAYMENT_EXPIRED'                // 미결제 만료
)
```

### 4.2 Contract 모델에 취소 관련 컬럼 추가 ✅ 구현 완료

```javascript
// 취소 상세 정보 (취소 시에만 값이 채워짐)
cancellationType: {
  type: DataTypes.ENUM(
    'BEFORE_PAYMENT',      // 결제 전 취소
    'AFTER_PAYMENT',       // 결제 후 취소 (체크인 전)
    'DURING_STAY',         // 입실 중 취소
    'AFTER_COMPLETION'     // 완료 후 취소 (분쟁 등)
  ),
  allowNull: true,
  field: 'cancellation_type',
  comment: '취소 유형 (취소된 경우에만 값 존재)'
},
cancelledByAdminId: {
  type: DataTypes.INTEGER,
  allowNull: true,
  field: 'cancelled_by_admin_id',
  comment: '취소한 관리자 ID (관리자 취소인 경우)'
}
```

> **참고**: `refundEligible` 컬럼은 제외됨. 관리자 취소의 경우 status 값 자체로 환불 여부 구분 가능
> - `CANCELLED_BY_ADMIN_WITH_REFUND` → 환불 O
> - `CANCELLED_BY_ADMIN_NO_REFUND` → 환불 X

### 4.3 ContractStatusLog 테이블 신규 생성 ✅ 구현 완료

> **로그 보존 정책**: 영구 보존 (삭제하지 않음)

```javascript
/**
 * ContractStatusLog 모델 - 계약 상태 변경 이력
 * 모든 상태 변경을 기록하여 감사 추적 및 분석 가능
 * 로그는 영구 보존됨
 */
const ContractStatusLog = sequelize.define('ContractStatusLog', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  contractId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'contract_id',
    comment: '계약 ID'
  },

  // 상태 변경 정보
  fromStatus: {
    type: DataTypes.STRING(50),
    allowNull: true,  // 최초 생성 시 null
    field: 'from_status',
    comment: '변경 전 상태'
  },
  toStatus: {
    type: DataTypes.STRING(50),
    allowNull: false,
    field: 'to_status',
    comment: '변경 후 상태'
  },

  // 변경 주체
  changedBy: {
    type: DataTypes.ENUM('GUEST', 'HOST', 'ADMIN', 'SYSTEM'),
    allowNull: false,
    field: 'changed_by',
    comment: '변경 주체'
  },
  changedByUserId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'changed_by_user_id',
    comment: '변경한 사용자 ID (User 또는 Admin)'
  },

  // 상세 정보
  reason: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '변경 사유'
  },
  metadata: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: '추가 메타데이터 (환불 금액, 위약금 등)',
    get() {
      const rawValue = this.getDataValue('metadata');
      return typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
    }
  },

  // IP 및 디바이스 정보 (보안 감사용)
  ipAddress: {
    type: DataTypes.STRING(45),
    allowNull: true,
    field: 'ip_address',
    comment: '요청 IP 주소'
  },
  userAgent: {
    type: DataTypes.STRING(500),
    allowNull: true,
    field: 'user_agent',
    comment: '사용자 에이전트'
  },

  createdAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'created_at'
  }
}, {
  tableName: 'contract_status_logs',
  timestamps: false,  // updatedAt 불필요 (로그는 수정하지 않음)
  indexes: [
    {
      fields: ['contract_id'],
      name: 'idx_contract'
    },
    {
      fields: ['to_status'],
      name: 'idx_to_status'
    },
    {
      fields: ['changed_by'],
      name: 'idx_changed_by'
    },
    {
      fields: ['created_at'],
      name: 'idx_created_at'
    },
    {
      // 복합 인덱스: 특정 계약의 최신 로그 조회 최적화
      fields: ['contract_id', 'created_at'],
      name: 'idx_contract_created'
    }
  ]
});
```

---

## 5. 상태 전이 다이어그램

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Contract 상태 전이도                              │
└─────────────────────────────────────────────────────────────────────────┘

[생성] ──→ PENDING_APPROVAL
              │
              ├──→ APPROVED (호스트 승인)
              │       │
              │       ├──→ PAYMENT_COMPLETED (결제 완료)
              │       │       │
              │       │       ├──→ IN_PROGRESS (체크인)
              │       │       │       │
              │       │       │       ├──→ COMPLETED (체크아웃)
              │       │       │       │
              │       │       │       ├──→ CANCELLED_BY_GUEST (조기 퇴실)
              │       │       │       │       └──→ REFUNDED (부분 환불)
              │       │       │       │
              │       │       │       ├──→ CANCELLED_BY_HOST (강제 퇴실)
              │       │       │       │       └──→ REFUNDED (잔여일 환불)
              │       │       │       │
              │       │       │       └──→ CANCELLED_BY_ADMIN (관리자 취소)
              │       │       │               └──→ REFUNDED (상황별)
              │       │       │
              │       │       ├──→ CANCELLED_BY_GUEST (결제 후 취소)
              │       │       │       └──→ REFUNDED (정책 적용)
              │       │       │
              │       │       ├──→ CANCELLED_BY_HOST (결제 후 취소)
              │       │       │       └──→ REFUNDED (전액 환불)
              │       │       │
              │       │       └──→ CANCELLED_BY_ADMIN (관리자 취소)
              │       │               └──→ REFUNDED (전액/부분)
              │       │
              │       ├──→ CANCELLED_BY_GUEST (결제 전 취소)
              │       │
              │       ├──→ CANCELLED_BY_HOST (결제 전 취소)
              │       │
              │       ├──→ CANCELLED_BY_ADMIN (관리자 취소)
              │       │
              │       └──→ PAYMENT_EXPIRED (결제 기한 만료)
              │
              ├──→ REJECTED (호스트 거절)
              │
              └──→ APPROVAL_EXPIRED (승인 기한 만료)
```

---

## 6. 취소 처리 플로우

### 6.1 게스트 취소 (결제 전)

```javascript
// 1. 상태 변경
contract.status = 'CANCELLED_BY_GUEST';
contract.cancellationType = 'BEFORE_PAYMENT';
contract.refundEligible = false;  // 결제 전이므로 환불 대상 아님
contract.cancelledAt = new Date();

// 2. 로그 기록
ContractStatusLog.create({
  contractId: contract.id,
  fromStatus: 'APPROVED',
  toStatus: 'CANCELLED_BY_GUEST',
  changedBy: 'GUEST',
  changedByUserId: guestId,
  reason: '게스트 사정으로 인한 취소',
  metadata: { cancellationType: 'BEFORE_PAYMENT' }
});
```

### 6.2 게스트 취소 (결제 후, 체크인 전)

```javascript
// 1. 상태 변경
contract.status = 'CANCELLED_BY_GUEST';
contract.cancellationType = 'AFTER_PAYMENT';
contract.refundEligible = true;
contract.cancelledAt = new Date();

// 2. 환불 계산 및 Refund 생성
const refund = await Refund.create({
  contractId: contract.id,
  refundStatus: 'REQUESTED',
  policyTypeUsed: room.refundPolicy,
  // ... 환불 금액 계산 ...
});

// 3. 로그 기록
ContractStatusLog.create({
  contractId: contract.id,
  fromStatus: 'PAYMENT_COMPLETED',
  toStatus: 'CANCELLED_BY_GUEST',
  changedBy: 'GUEST',
  changedByUserId: guestId,
  reason: cancellationReason,
  metadata: {
    cancellationType: 'AFTER_PAYMENT',
    refundId: refund.id,
    estimatedRefundAmount: refund.finalRefundAmount,
    penaltyAmount: refund.penaltyAmount
  }
});
```

### 6.3 관리자 취소 (환불 포함)

```javascript
// 1. 상태 변경
contract.status = 'CANCELLED_BY_ADMIN';
contract.cancellationType = 'AFTER_PAYMENT';
contract.refundEligible = true;
contract.cancelledByAdminId = adminId;
contract.cancelledAt = new Date();

// 2. 전액 환불 처리 (관리자 취소는 위약금 없음)
const refund = await Refund.create({
  contractId: contract.id,
  refundStatus: 'APPROVED',  // 관리자가 직접 처리하므로 즉시 승인
  penaltyAmount: 0,
  finalRefundAmount: contract.finalTotalAmount,
  // ...
});

// 3. 로그 기록
ContractStatusLog.create({
  contractId: contract.id,
  fromStatus: previousStatus,
  toStatus: 'CANCELLED_BY_ADMIN',
  changedBy: 'ADMIN',
  changedByUserId: adminId,
  reason: adminReason,
  metadata: {
    cancellationType: 'AFTER_PAYMENT',
    refundId: refund.id,
    refundAmount: refund.finalRefundAmount,
    adminAction: 'CANCEL_WITH_FULL_REFUND'
  }
});
```

### 6.4 관리자 취소 (환불 없음 - 입실 후)

```javascript
// 1. 상태 변경
contract.status = 'CANCELLED_BY_ADMIN';
contract.cancellationType = 'DURING_STAY';
contract.refundEligible = false;  // 환불 없음
contract.cancelledByAdminId = adminId;
contract.cancelledAt = new Date();

// 2. 로그 기록
ContractStatusLog.create({
  contractId: contract.id,
  fromStatus: 'IN_PROGRESS',
  toStatus: 'CANCELLED_BY_ADMIN',
  changedBy: 'ADMIN',
  changedByUserId: adminId,
  reason: '이용 약관 위반으로 인한 강제 퇴실',
  metadata: {
    cancellationType: 'DURING_STAY',
    refundEligible: false,
    adminAction: 'FORCE_CHECKOUT_NO_REFUND',
    violationType: 'TERMS_VIOLATION'
  }
});
```

---

## 7. metadata 활용 예시

### 취소 관련 메타데이터

```javascript
// 결제 전 취소
metadata: {
  cancellationType: 'BEFORE_PAYMENT',
  originalAmount: 500000,
  daysSinceApproval: 2
}

// 결제 후 취소 (환불 포함)
metadata: {
  cancellationType: 'AFTER_PAYMENT',
  refundId: 123,
  originalAmount: 500000,
  refundAmount: 350000,
  penaltyAmount: 150000,
  penaltyRate: 30,
  daysBeforeCheckin: 5,
  policyApplied: 'MODERATE'
}

// 관리자 취소
metadata: {
  cancellationType: 'DURING_STAY',
  adminAction: 'FORCE_CHECKOUT',
  refundEligible: false,
  violationType: 'NOISE_COMPLAINT',
  evidenceFiles: ['evidence1.jpg', 'evidence2.jpg'],
  guestNotified: true,
  hostNotified: true
}
```

---

## 8. 마이그레이션 계획 ✅ 스크립트 작성 완료

> **마이그레이션 파일**: [scripts/migration_contract_status_enhancement.sql](../scripts/migration_contract_status_enhancement.sql)

### 8.1 실행 방법

```bash
# MySQL 클라이언트로 마이그레이션 실행
mysql -u root -p ezstay < scripts/migration_contract_status_enhancement.sql
```

### 8.2 마이그레이션 내용 요약

1. **contracts 테이블 ENUM 수정**
   - `CANCELLED_BY_ADMIN_WITH_REFUND` 추가
   - `CANCELLED_BY_ADMIN_NO_REFUND` 추가

2. **contracts 테이블 컬럼 추가**
   - `cancellation_type` ENUM 컬럼
   - `cancelled_by_admin_id` INT 컬럼
   - 관련 인덱스 2개

3. **contract_status_logs 테이블 생성**
   - 상태 변경 이력 저장
   - 5개 인덱스 포함

### 8.3 기존 데이터 처리

> **결정사항**: 기존 데이터는 마이그레이션하지 않고 그대로 유지
> - 기존 취소 계약의 `cancellation_type`은 NULL로 유지
> - 신규 취소 건부터 값이 채워짐

---

## 9. API 영향도

### 변경이 필요한 API

| API | 변경 내용 |
|-----|-----------|
| `POST /api/contracts/:id/cancel` | cancellationType, refundEligible 처리 추가, 로그 기록 |
| `POST /api/admin/contracts/:id/cancel` | 신규 API (관리자 취소) |
| `GET /api/contracts/:id` | 로그 조회 옵션 추가 |
| `GET /api/admin/contracts/:id/logs` | 신규 API (상태 변경 이력 조회) |

### 신규 API 엔드포인트

```javascript
// 관리자 계약 취소
POST /api/admin/contracts/:contractId/cancel
Body: {
  reason: string,           // 취소 사유 (필수)
  refundEligible: boolean,  // 환불 여부 (필수)
  refundAmount?: number,    // 환불 금액 (환불 시)
  notifyParties: boolean    // 당사자 알림 여부
}

// 계약 상태 변경 이력 조회
GET /api/admin/contracts/:contractId/logs
Response: {
  logs: [
    {
      id: number,
      fromStatus: string,
      toStatus: string,
      changedBy: string,
      changedByUser: { id, name, type },
      reason: string,
      metadata: object,
      createdAt: datetime
    }
  ]
}
```

---

## 10. 예상 효과

### Before (현재)
- 취소 시점 구분 불가 → 통계/분석 어려움
- 관리자 취소 불가 → 분쟁 해결 한계
- 상태 변경 이력 없음 → 감사 추적 불가

### After (개선 후)
- ✅ 취소 유형별 명확한 구분
- ✅ 관리자 개입 시스템화
- ✅ 모든 상태 변경 감사 추적 가능
- ✅ 환불/위약금 정보 메타데이터로 보존
- ✅ 통계 및 분석 데이터 확보

---

## 11. 구현 우선순위

1. **Phase 1**: ContractStatusLog 테이블 생성 및 모델 작성
2. **Phase 2**: Contract 모델에 신규 컬럼/ENUM 추가
3. **Phase 3**: 기존 취소 API 수정 (로그 기록 추가)
4. **Phase 4**: 관리자 취소 API 구현
5. **Phase 5**: 기존 데이터 마이그레이션

---

## 12. 결정 사항 요약

| 항목 | 결정 내용 |
|------|----------|
| **ENUM 값 추가** | `CANCELLED_BY_ADMIN_WITH_REFUND`, `CANCELLED_BY_ADMIN_NO_REFUND` 2개로 세분화 |
| **로그 보존 기간** | 영구 보존 (삭제하지 않음) |
| **기존 데이터 처리** | 마이그레이션 없이 그대로 유지 |

---

## 13. 다음 단계 (TODO)

- [x] 마이그레이션 SQL 실행
- [x] 취소 API에 로그 기록 로직 추가 (`ContractStatusLog.createLog()` 활용)
  - [x] `createContractRequest` - 계약 생성 로그
  - [x] `approveContract` - 계약 승인 로그
  - [x] `rejectContract` - 계약 거절 로그
  - [x] `cancelContractByGuest` - 게스트 취소 로그
  - [x] `requestRefund` - 환불 요청 로그
- [x] 스케줄러 상태 변경에 로그 기록 추가
  - [x] `updateApprovalExpired` - 미승인 만료 로그
  - [x] `updatePaymentExpired` - 미결제 만료 로그
  - [x] `updateInProgress` - 임대중 상태 로그
  - [x] `updateCompleted` - 계약 종료 로그
- [ ] 관리자 취소 API 구현 (`POST /api/admin/contracts/:id/cancel`)
- [ ] 상태 변경 이력 조회 API 구현 (`GET /api/admin/contracts/:id/logs`)

---

*작성일: 2025-01-26*
*버전: 1.2*
*최종 수정: 2025-01-28 - 상태 변경 로그 시스템 구현 완료*
