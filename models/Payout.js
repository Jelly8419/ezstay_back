const { DataTypes } = require('sequelize');

/**
 * Payout 모델 - 지급 관리
 *
 * PG 정산 완료 후 호스트/게스트에게 지급할 금액을 관리합니다.
 *
 * 지급 유형:
 * - CONTRACT_SETTLEMENT          : 계약 정산 → 호스트
 * - GUEST_PENALTY                : 게스트 취소 위약금 → 호스트
 * - DEPOSIT_DEDUCTION            : 보증금 차감 합의분 → 호스트
 * - HOST_CANCELLATION_COMPENSATION: 호스트 귀책 취소 보상 → 게스트
 *
 * 상태 흐름:
 * PENDING → PAYABLE → PROCESSING → COMPLETED
 *                   ↘ CANCELLED
 *                   ↘ FAILED
 */
module.exports = (sequelize) => {
  const Payout = sequelize.define('Payout', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },

    // 연관 정보
    contractId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'contract_id',
      comment: '계약 ID'
    },
    settlementId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'settlement_id',
      comment: '연관 Settlement ID (CONTRACT_SETTLEMENT 타입)'
    },
    refundId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'refund_id',
      comment: '연관 Refund ID (GUEST_PENALTY, DEPOSIT_DEDUCTION 타입)'
    },

    // 지급 분류
    payoutType: {
      type: DataTypes.ENUM(
        'CONTRACT_SETTLEMENT',            // 계약 정산 (호스트)
        'GUEST_PENALTY',                  // 게스트 취소 위약금 (호스트)
        'DEPOSIT_DEDUCTION',              // 보증금 차감 합의분 (호스트)
        'HOST_CANCELLATION_COMPENSATION'  // 호스트 귀책 취소 보상 (게스트)
      ),
      allowNull: false,
      field: 'payout_type',
      comment: '지급 유형'
    },

    // 수령인
    recipientType: {
      type: DataTypes.ENUM('HOST', 'GUEST'),
      allowNull: false,
      field: 'recipient_type',
      comment: '수령인 유형'
    },
    recipientId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'recipient_id',
      comment: '수령인 User ID'
    },

    // 금액
    amount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: '지급 금액'
    },

    // 상태
    status: {
      type: DataTypes.ENUM(
        'PENDING',     // 대기 (PG 정산 미완료 또는 payable_after 미도래)
        'PAYABLE',     // 지급 가능 (조건 충족, 관리자 실행 대기)
        'PROCESSING',  // 지급 처리 중
        'COMPLETED',   // 지급 완료
        'FAILED',      // 지급 실패 (재시도 필요)
        'CANCELLED'    // 취소 (환불 충돌 등)
      ),
      allowNull: false,
      defaultValue: 'PENDING',
      comment: '지급 상태'
    },

    // 지급 가능 최소 날짜 (결제 승인일 + 3영업일)
    payableAfter: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      field: 'payable_after',
      comment: '지급 가능 최소 날짜 (결제 승인일 + 3영업일)'
    },

    // 수령 계좌 정보 스냅샷 (지급 시점 기준)
    bankName: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: 'bank_name',
      comment: '수령 은행명'
    },
    accountNumber: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: 'account_number',
      comment: '수령 계좌번호'
    },
    accountHolder: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: 'account_holder',
      comment: '수령 예금주명'
    },

    // 처리 정보
    adminId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'admin_id',
      comment: '처리한 관리자 ID'
    },
    processedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'processed_at',
      comment: '지급 완료 시각'
    },
    failureReason: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'failure_reason',
      comment: '지급 실패 사유'
    },
    note: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: '관리자 메모'
    }
  }, {
    tableName: 'payouts',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['contract_id'], name: 'idx_payout_contract_id' },
      { fields: ['status', 'payable_after'], name: 'idx_payout_status_date' },
      { fields: ['recipient_type', 'recipient_id'], name: 'idx_payout_recipient' },
      { fields: ['payout_type'], name: 'idx_payout_type' }
    ]
  });

  Payout.TYPE_LABELS = {
    CONTRACT_SETTLEMENT: '계약 정산',
    GUEST_PENALTY: '게스트 취소 위약금',
    DEPOSIT_DEDUCTION: '보증금 차감',
    HOST_CANCELLATION_COMPENSATION: '호스트 귀책 취소 보상'
  };

  Payout.STATUS_LABELS = {
    PENDING: '지급 대기',
    PAYABLE: '지급 가능',
    PROCESSING: '처리 중',
    COMPLETED: '지급 완료',
    FAILED: '지급 실패',
    CANCELLED: '지급 취소'
  };

  return Payout;
};
