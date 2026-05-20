const { DataTypes } = require('sequelize');

/**
 * MoveInPayment 모델
 * 임대인 청소 결제 (게스트 결제 흐름과 분리된 별도 테이블)
 *
 * - 정산/환불 흐름이 게스트(payments)와 다르므로 별도 분리
 * - 한 케이스에 결제 시도가 여러 번 발생할 수 있음 (실패 → 재시도)
 */
module.exports = (sequelize) => {
  const MoveInPayment = sequelize.define('MoveInPayment', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },

    caseId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'case_id',
      comment: '입주 준비 등록 ID'
    },

    orderId: {
      type: DataTypes.STRING(20),
      allowNull: true,
      unique: true,
      field: 'order_id',
      comment: 'PG 주문번호 (M+yymmdd+00001)'
    },

    hostId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'host_id',
      comment: '임대인 user_id'
    },

    amount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: '결제 금액 (원)',
      validate: { min: 0 }
    },

    status: {
      type: DataTypes.ENUM('PENDING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED'),
      allowNull: false,
      defaultValue: 'PENDING',
      comment: '결제 상태'
    },

    pgProvider: {
      type: DataTypes.STRING(30),
      allowNull: true,
      field: 'pg_provider',
      comment: 'PG사 (toss/kcp 등)'
    },

    pgTid: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: 'pg_tid',
      comment: 'PG 거래번호'
    },

    pgMethod: {
      type: DataTypes.STRING(30),
      allowNull: true,
      field: 'pg_method',
      comment: '결제 수단 (CARD 등)'
    },

    easyPayProvider: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: 'easy_pay_provider',
      comment: '간편결제 제공사 (KAKAOPAY/NAVERPAY/PAYCO 등)'
    },

    paidAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'paid_at',
      comment: '결제 완료 일시'
    },

    refundedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'refunded_at',
      comment: '환불 완료 시각'
    },

    refundReason: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'refund_reason',
      comment: '환불 사유'
    },

    failedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'failed_at',
      comment: '결제 실패 일시'
    },

    failureReason: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'failure_reason',
      comment: '실패 사유'
    }
  }, {
    tableName: 'move_in_payments',
    timestamps: true,
    underscored: true
  });

  return MoveInPayment;
};
