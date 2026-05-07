const { DataTypes } = require('sequelize');

/**
 * MoveInGuestOrderItem 모델
 * 임차인 주문의 옵션 라인
 *
 * - price_per_item / total_price 는 결제 당시 스냅샷 (옵션 가격 변경 영향 차단)
 * - 라인 단위 취소 가능 (status=CANCELLED)
 */
module.exports = (sequelize) => {
  const MoveInGuestOrderItem = sequelize.define('MoveInGuestOrderItem', {
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

    optionId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'option_id',
      comment: 'move_in_options.id'
    },

    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: '수량',
      validate: { min: 1 }
    },

    pricePerItem: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'price_per_item',
      comment: '개당 가격 스냅샷',
      validate: { min: 0 }
    },

    totalPrice: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'total_price',
      comment: '라인 총액 (quantity * price_per_item)',
      validate: { min: 0 }
    },

    status: {
      type: DataTypes.ENUM('ACTIVE', 'CANCELLED'),
      allowNull: false,
      defaultValue: 'ACTIVE',
      comment: '라인 상태'
    },

    cancelledAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'cancelled_at',
      comment: '취소 시각'
    },

    cancelReason: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'cancel_reason',
      comment: '취소 사유'
    },

    refundAmount: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'refund_amount',
      comment: '환불 금액 (취소 시)'
    }
  }, {
    tableName: 'move_in_guest_order_items',
    timestamps: true,
    underscored: true
  });

  MoveInGuestOrderItem.STATUS_LABELS = {
    ACTIVE:    '활성',
    CANCELLED: '취소됨'
  };

  /**
   * 활성 여부
   */
  MoveInGuestOrderItem.prototype.isActive = function () {
    return this.status === 'ACTIVE';
  };

  return MoveInGuestOrderItem;
};
