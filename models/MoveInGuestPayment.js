const { DataTypes } = require('sequelize');

/**
 * MoveInGuestPayment 모델
 * 임차인 옵션 결제 (PG 결제)
 *
 * - 청소 결제 (move_in_payments) 와는 완전히 분리된 별도 테이블 (PRD 14.7 독립 원칙)
 * - 한 주문(guest_order)에 결제 시도가 여러 번 발생 가능 (실패 → 재시도)
 */
module.exports = (sequelize) => {
  const MoveInGuestPayment = sequelize.define('MoveInGuestPayment', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },

    guestOrderId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'guest_order_id',
      comment: 'move_in_guest_orders.id'
    },

    caseId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'case_id',
      comment: 'move_in_cases.id (조회 편의)'
    },

    guestUserId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'guest_user_id',
      comment: 'users.id (조회 편의)'
    },

    orderId: {
      type: DataTypes.STRING(15),
      allowNull: true,
      field: 'order_id',
      comment: '주문번호 YYMMDD-G####'
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

    paidAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'paid_at',
      comment: '결제 완료 시각'
    },

    failedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'failed_at',
      comment: '결제 실패 시각'
    },

    failureReason: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'failure_reason',
      comment: '실패 사유'
    }
  }, {
    tableName: 'move_in_guest_payments',
    timestamps: true,
    underscored: true
  });

  return MoveInGuestPayment;
};
