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
 * RentalOrderItem 모델 - 렌탈 주문 상세 아이템
 * 개별 렌탈 아이템의 수량, 가격, 취소 상태 관리
 */
const RentalOrderItem = sequelize.define('RentalOrderItem', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  rentalOrderId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'rental_order_id',
    comment: '렌탈 주문 ID'
  },
  rentalItemId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'rental_item_id',
    comment: '렌탈 아이템 ID'
  },

  // 수량 및 가격
  quantity: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
    comment: '수량',
    validate: {
      min: 1
    }
  },
  pricePerItem: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    field: 'price_per_item',
    comment: '개당 가격 (주문 시점)'
  },
  totalPrice: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    field: 'total_price',
    comment: '총 가격 (수량 * 개당가격)'
  },

  // 상태
  status: {
    type: DataTypes.ENUM('ACTIVE', 'CANCEL_REQUESTED', 'CANCELLED'),
    allowNull: false,
    defaultValue: 'ACTIVE',
    comment: '상태 (입주 중 취소 요청 시 CANCEL_REQUESTED → 관리자 처리 후 CANCELLED)'
  },
  cancelledAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'cancelled_at',
    comment: '취소 시점'
  },
  refundAmount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    field: 'refund_amount',
    comment: '환불 금액'
  },
  cancelReason: {
    type: DataTypes.STRING(255),
    allowNull: true,
    field: 'cancel_reason',
    comment: '취소 사유'
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
  tableName: 'rental_order_items',
  timestamps: true,
  underscored: false,
  indexes: [
    {
      fields: ['rental_order_id'],
      name: 'idx_rental_order_items_order_id'
    },
    {
      fields: ['rental_item_id'],
      name: 'idx_rental_order_items_item_id'
    },
    {
      fields: ['status'],
      name: 'idx_rental_order_items_status'
    }
  ]
});

/**
 * 상태 레이블
 */
RentalOrderItem.STATUS_LABELS = {
  ACTIVE: '활성',
  CANCEL_REQUESTED: '취소 요청',
  CANCELLED: '취소됨'
};

/**
 * 활성 상태인지 확인
 * @returns {boolean}
 */
RentalOrderItem.prototype.isActive = function() {
  return this.status === 'ACTIVE';
};

/**
 * 취소 가능 여부 확인
 * @returns {boolean}
 */
RentalOrderItem.prototype.isCancellable = function() {
  return this.status === 'ACTIVE';
};

/**
 * 아이템 취소 처리
 * @param {string} reason - 취소 사유
 * @param {number} refundAmount - 환불 금액 (기본값: totalPrice)
 */
RentalOrderItem.prototype.cancel = async function(reason = null, refundAmount = null) {
  this.status = 'CANCELLED';
  this.cancelledAt = new Date();
  this.cancelReason = reason;
  this.refundAmount = refundAmount !== null ? refundAmount : this.totalPrice;
  await this.save();
};

module.exports = RentalOrderItem;
