const { DataTypes } = require('sequelize');

/**
 * MoveInGuestRefundRequest 모델
 * 입주 준비 서비스 — 임차인 옵션 "반품" 요청 (관리자 승인/거절 대상)
 *
 * 정책 (Notion "임대인, 임차인 환불 로직 추가 필요"):
 *  - 취소(결제완료~입주 D-5, 배송 전)는 즉시 환불 — 이 테이블 사용 X
 *  - 반품(입주일~퇴실일, 배송 완료 후)은 요청 → 관리자 승인/거절
 *  - 승인 시 PG 환불 + 왕복배송비(수거비) 차감
 *
 * 참고: 기존 RentalOrderRefundRequest 와 동일 패턴 (입주 준비 도메인 분리)
 */
module.exports = (sequelize) => {
  const MoveInGuestRefundRequest = sequelize.define('MoveInGuestRefundRequest', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },

    guestOrderId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'guest_order_id',
      comment: '대상 게스트 주문 ID (move_in_guest_orders.id)'
    },

    caseId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'case_id',
      comment: '입주 준비 케이스 ID (빠른 조회용)'
    },

    requestedBy: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'requested_by',
      comment: '요청한 임차인 user_id'
    },

    status: {
      type: DataTypes.ENUM('PENDING', 'APPROVED', 'REJECTED'),
      allowNull: false,
      defaultValue: 'PENDING',
      comment: '처리 상태'
    },

    returnReason: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'return_reason',
      comment: '임차인 반품 사유'
    },

    rejectReason: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'reject_reason',
      comment: '관리자 거절 사유'
    },

    deliveryStatusSnapshot: {
      type: DataTypes.ENUM('PENDING', 'IN_TRANSIT', 'DELIVERED'),
      allowNull: false,
      field: 'delivery_status_snapshot',
      comment: '요청 시점의 배송 상태'
    },

    itemTotalAmount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'item_total_amount',
      comment: '반품 대상 아이템 합계 (배송비 차감 전)'
    },

    shippingDeduction: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'shipping_deduction',
      comment: '왕복배송비(수거비) 차감액 (승인 시 확정)'
    },

    finalRefundAmount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'final_refund_amount',
      comment: '실제 환불 금액 (승인 시 확정)'
    },

    adminId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'admin_id',
      comment: '처리한 관리자 admin_id'
    },

    processedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'processed_at',
      comment: '승인/거절 처리 시점'
    }
  }, {
    tableName: 'move_in_guest_refund_requests',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['guest_order_id'], name: 'idx_migrr_guest_order_id' },
      { fields: ['case_id'], name: 'idx_migrr_case_id' },
      { fields: ['requested_by'], name: 'idx_migrr_requested_by' },
      { fields: ['status'], name: 'idx_migrr_status' },
      { fields: ['created_at'], name: 'idx_migrr_created_at' }
    ]
  });

  MoveInGuestRefundRequest.STATUS_LABELS = {
    PENDING:  '처리 대기',
    APPROVED: '승인됨',
    REJECTED: '거절됨'
  };

  return MoveInGuestRefundRequest;
};
