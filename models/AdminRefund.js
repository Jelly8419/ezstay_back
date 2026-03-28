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
 * AdminRefund 모델 - 관리자 직접 환불 처리 이력
 * 게스트 refunds 테이블(정책 기반)과 분리된 관리자 수동 환불 전용 테이블
 */
const AdminRefund = sequelize.define('AdminRefund', {
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
    // references 옵션 제거 - models/index.js에서 belongsTo로 관계 설정
  },
  adminId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'admin_id',
    comment: '처리한 관리자 ID'
  },
  refundType: {
    type: DataTypes.ENUM('FULL', 'PARTIAL_ITEMS'),
    allowNull: false,
    field: 'refund_type',
    comment: '환불 유형: FULL=전체, PARTIAL_ITEMS=상품별 선택'
  },
  refundAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'refund_amount',
    comment: '환불 금액'
  },
  rentalFeeRefundAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'rental_fee_refund_amount',
    comment: '임대료 환불 금액'
  },
  maintenanceFeeRefundAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'maintenance_fee_refund_amount',
    comment: '관리비 환불 금액'
  },
  cleaningFeeRefundAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'cleaning_fee_refund_amount',
    comment: '청소비 환불 금액'
  },
  platformFeeRefundAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'platform_fee_refund_amount',
    comment: '서비스 수수료 환불 금액'
  },
  depositRefundAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'deposit_refund_amount',
    comment: '보증금 환불 금액'
  },
  rentalItemsRefundAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'rental_items_refund_amount',
    comment: '렌탈 상품 환불 금액 (rental_orders 기준)'
  },
  totalRefundAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'total_refund_amount',
    comment: '총 환불 금액 (계약 + 렌탈)'
  },
  finalRefundAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'final_refund_amount',
    comment: '최종 확정 환불 금액'
  },
  originalRentalFee: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'original_rental_fee',
    comment: '원래 임대료'
  },
  originalMaintenanceFee: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'original_maintenance_fee',
    comment: '원래 관리비'
  },
  originalCleaningFee: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'original_cleaning_fee',
    comment: '원래 청소비'
  },
  originalPlatformFee: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'original_platform_fee',
    comment: '원래 서비스 수수료'
  },
  originalDeposit: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'original_deposit',
    comment: '원래 보증금'
  },
  originalTotalAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'original_total_amount',
    comment: '원래 총 결제 금액'
  },
  refundStatus: {
    type: DataTypes.ENUM('COMPLETED', 'FAILED'),
    allowNull: false,
    defaultValue: 'COMPLETED',
    field: 'refund_status',
    comment: '환불 처리 상태'
  },
  refundMethod: {
    type: DataTypes.ENUM('ORIGINAL_PAYMENT', 'BANK_TRANSFER'),
    allowNull: false,
    defaultValue: 'ORIGINAL_PAYMENT',
    field: 'refund_method',
    comment: '환불 수단'
  },
  refundReason: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'refund_reason',
    comment: '환불 사유'
  },
  adminNotes: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'admin_notes',
    comment: '관리자 메모'
  },
  completedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'completed_at',
    comment: '환불 완료 일시'
  }
}, {
  tableName: 'admin_refunds',
  timestamps: true,
  underscored: true
});

module.exports = AdminRefund;
