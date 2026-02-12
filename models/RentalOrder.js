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
 * RentalOrder 모델 - 렌탈 아이템 주문
 * 플랫폼에서 제공하는 렌탈 서비스 주문 (계약과 분리)
 */
const RentalOrder = sequelize.define('RentalOrder', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  contractId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'contract_id',
    comment: '연결된 계약 ID'
  },
  orderId: {
    type: DataTypes.STRING(15),
    allowNull: false,
    unique: true,
    field: 'order_id',
    comment: '주문번호 (YYMMDD-R0001)'
  },
  orderType: {
    type: DataTypes.ENUM('INITIAL', 'ADDITIONAL'),
    allowNull: false,
    field: 'order_type',
    comment: '주문 유형 (INITIAL: 초기, ADDITIONAL: 추가)'
  },

  // 금액 정보
  totalAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'total_amount',
    comment: '결제 예정 금액 (렌탈 아이템 합계, 수수료 없음)'
  },

  // 실제 결제/환불 금액
  paidAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'paid_amount',
    comment: '실제 결제된 금액'
  },
  refundedAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'refunded_amount',
    comment: '환불된 총 금액'
  },

  // 결제 상태
  status: {
    type: DataTypes.ENUM('PENDING', 'PAID', 'PARTIAL_REFUND', 'FULLY_REFUNDED', 'CANCELLED'),
    allowNull: false,
    defaultValue: 'PENDING',
    comment: '주문 상태'
  },

  // 결제 정보
  paymentKey: {
    type: DataTypes.STRING(100),
    allowNull: true,
    field: 'payment_key',
    comment: '토스페이먼츠 결제키'
  },
  paymentMethod: {
    type: DataTypes.STRING(50),
    allowNull: true,
    field: 'payment_method',
    comment: '결제 수단'
  },
  paidAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'paid_at',
    comment: '결제 완료 시점'
  },

  // 수정 기한
  modifiableUntil: {
    type: DataTypes.DATE,
    allowNull: false,
    field: 'modifiable_until',
    comment: '수정 가능 기한 (체크인 5일 전)'
  },

  // 스냅샷 (분쟁 대비)
  itemsSnapshot: {
    type: DataTypes.JSON,
    allowNull: true,
    field: 'items_snapshot',
    comment: '주문 시점 아이템 정보'
  },

  // 배송 상태
  deliveryStatus: {
    type: DataTypes.ENUM('PENDING', 'IN_TRANSIT', 'DELIVERED'),
    allowNull: false,
    defaultValue: 'PENDING',
    field: 'delivery_status',
    comment: '배송 상태 (PENDING: 배송전, IN_TRANSIT: 배송중, DELIVERED: 배송완료)'
  },
  deliveredAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'delivered_at',
    comment: '배송 완료 시점'
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
  tableName: 'rental_orders',
  timestamps: true,
  underscored: false,
  indexes: [
    {
      fields: ['contract_id'],
      name: 'idx_rental_orders_contract_id'
    },
    {
      fields: ['order_type'],
      name: 'idx_rental_orders_order_type'
    },
    {
      fields: ['status'],
      name: 'idx_rental_orders_status'
    },
    {
      fields: ['modifiable_until'],
      name: 'idx_rental_orders_modifiable_until'
    },
    {
      fields: ['paid_at'],
      name: 'idx_rental_orders_paid_at'
    },
    {
      fields: ['delivery_status'],
      name: 'idx_rental_orders_delivery_status'
    }
  ]
});

/**
 * 주문 상태 레이블
 */
RentalOrder.STATUS_LABELS = {
  PENDING: '결제 대기',
  PAID: '결제 완료',
  PARTIAL_REFUND: '부분 환불',
  FULLY_REFUNDED: '전액 환불',
  CANCELLED: '취소'
};

/**
 * 배송 상태 레이블
 */
RentalOrder.DELIVERY_STATUS_LABELS = {
  PENDING: '배송전',
  IN_TRANSIT: '배송중',
  DELIVERED: '배송완료'
};

/**
 * 주문 유형 레이블
 */
RentalOrder.ORDER_TYPE_LABELS = {
  INITIAL: '초기 주문',
  ADDITIONAL: '추가 주문'
};

/**
 * 수정 가능 기한 (입주 N일 전)
 */
RentalOrder.MODIFIABLE_DAYS_BEFORE = 5;

/**
 * 수정 가능 기한 계산
 * @param {Date} checkInDate - 체크인 날짜
 * @returns {Date} 수정 가능 기한 (체크인 5일 전 23:59:59)
 */
RentalOrder.calculateModifiableUntil = function(checkInDate) {
  const modifiableUntil = new Date(checkInDate);
  modifiableUntil.setDate(modifiableUntil.getDate() - RentalOrder.MODIFIABLE_DAYS_BEFORE);
  modifiableUntil.setHours(23, 59, 59, 999);
  return modifiableUntil;
};

/**
 * 현재 순 결제액 계산 (결제 - 환불)
 * @returns {number} 순 결제액
 */
RentalOrder.prototype.getNetAmount = function() {
  return this.paidAmount - this.refundedAmount;
};

/**
 * 결제 가능 여부 확인
 * @returns {boolean}
 */
RentalOrder.prototype.isPayable = function() {
  return this.status === 'PENDING';
};

/**
 * 환불 가능 여부 확인
 * @returns {boolean}
 */
RentalOrder.prototype.isRefundable = function() {
  return ['PAID', 'PARTIAL_REFUND'].includes(this.status);
};

/**
 * 취소 가능 여부 확인 (미결제 주문)
 * @returns {boolean}
 */
RentalOrder.prototype.isCancellable = function() {
  return this.status === 'PENDING';
};

module.exports = RentalOrder;
