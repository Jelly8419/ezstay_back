const { DataTypes, Sequelize } = require('sequelize');

const sequelize = new Sequelize('ezstay', process.env.DB_USER || 'root', process.env.DB_PASSWORD || '', {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  dialect: 'mysql',
  timezone: '+09:00',
  dialectOptions: {
    timezone: '+09:00'
  },
  logging: false
});

/**
 * RentalOrderRefundRequest 모델 - 입주중 옵션상품 환불 요청 관리
 * 관리자 수락/거절 및 수거 상태 추적 전용 테이블
 */
const RentalOrderRefundRequest = sequelize.define('RentalOrderRefundRequest', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  rentalOrderId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'rental_order_id',
    comment: '대상 렌탈 주문 ID'
  },
  contractId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'contract_id',
    comment: '계약 ID (빠른 조회용)'
  },
  requestedBy: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'requested_by',
    comment: '요청한 게스트 user_id'
  },

  // 요청 상태
  status: {
    type: DataTypes.ENUM('PENDING', 'APPROVED', 'REJECTED'),
    allowNull: false,
    defaultValue: 'PENDING',
    comment: '처리 상태'
  },
  cancelReason: {
    type: DataTypes.STRING(255),
    allowNull: true,
    field: 'cancel_reason',
    comment: '게스트 취소 사유'
  },
  rejectReason: {
    type: DataTypes.STRING(255),
    allowNull: true,
    field: 'reject_reason',
    comment: '관리자 거절 사유'
  },

  // 요청 시점 스냅샷
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
    comment: '아이템 합계 금액 (배송비 차감 전)'
  },

  // 환불 확정 금액 (수락 시 확정)
  shippingDeduction: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'shipping_deduction',
    comment: '수거비 차감액 = 플랫폼 수거비 수입 (0 or 7000)'
  },
  finalRefundAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'final_refund_amount',
    comment: '실제 환불 금액 (수락 시 확정)'
  },

  // 수거 상태 (배송이 나간 경우에만 사용)
  retrievalStatus: {
    type: DataTypes.ENUM('RETRIEVAL_PENDING', 'IN_RETRIEVAL', 'RETRIEVED'),
    allowNull: true,
    defaultValue: null,
    field: 'retrieval_status',
    comment: '수거 상태 (수락 후 배송된 상품에만 적용)'
  },
  retrievalStartedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'retrieval_started_at',
    comment: '수거 시작 시점'
  },
  retrievalCompletedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'retrieval_completed_at',
    comment: '수거 완료 시점'
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
    comment: '수락/거절 처리 시점'
  },

  createdAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'created_at'
  },
  updatedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'updated_at'
  }
}, {
  tableName: 'rental_order_refund_requests',
  timestamps: true,
  underscored: false,
  indexes: [
    { fields: ['rental_order_id'], name: 'idx_rorr_rental_order_id' },
    { fields: ['contract_id'], name: 'idx_rorr_contract_id' },
    { fields: ['requested_by'], name: 'idx_rorr_requested_by' },
    { fields: ['status'], name: 'idx_rorr_status' },
    { fields: ['retrieval_status'], name: 'idx_rorr_retrieval_status' },
    { fields: ['created_at'], name: 'idx_rorr_created_at' }
  ]
});

RentalOrderRefundRequest.STATUS_LABELS = {
  PENDING: '처리 대기',
  APPROVED: '수락됨',
  REJECTED: '거절됨'
};

RentalOrderRefundRequest.RETRIEVAL_STATUS_LABELS = {
  RETRIEVAL_PENDING: '회수 준비중',
  IN_RETRIEVAL: '회수중',
  RETRIEVED: '회수 완료'
};

module.exports = RentalOrderRefundRequest;
