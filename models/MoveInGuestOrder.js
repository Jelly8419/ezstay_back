const { DataTypes } = require('sequelize');

/**
 * MoveInGuestOrder 모델
 * 임차인 입주 준비 옵션 주문 (= 결제 1건 단위)
 *
 * - 한 케이스에 INITIAL 1건 + ADDITIONAL N건 가능 (정책 4)
 * - modifiable_until: 입주일 -5일 KST 23:59:59 (정책 2)
 * - items_snapshot: 결제 당시 옵션 정보 락인 (가격 변경/옵션 비활성화 영향 차단)
 *
 * NOTE: MariaDB JSON 컬럼은 LONGTEXT + json_valid 형태라 DataTypes.JSON 호환 이슈가 있어
 *       items_snapshot 은 TEXT('long') + 명시적 직렬화 getter/setter 사용.
 */
module.exports = (sequelize) => {
  const MoveInGuestOrder = sequelize.define('MoveInGuestOrder', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },

    caseId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'case_id',
      comment: 'move_in_cases.id'
    },

    guestUserId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'guest_user_id',
      comment: 'users.id (PRD 10.2: 결제는 매칭된 게스트만)'
    },

    orderId: {
      type: DataTypes.STRING(15),
      allowNull: false,
      unique: true,
      field: 'order_id',
      comment: '주문번호 YYMMDD-G####'
    },

    orderType: {
      type: DataTypes.ENUM('INITIAL', 'ADDITIONAL'),
      allowNull: false,
      field: 'order_type',
      comment: 'INITIAL=최초 결제, ADDITIONAL=추가 결제(정책4)'
    },

    totalAmount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'total_amount',
      comment: '주문 총액 (원)',
      validate: { min: 0 }
    },

    paidAmount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'paid_amount',
      comment: '실제 결제된 금액',
      validate: { min: 0 }
    },

    refundedAmount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'refunded_amount',
      comment: '환불된 금액',
      validate: { min: 0 }
    },

    status: {
      type: DataTypes.ENUM('PENDING', 'PAID', 'PARTIAL_REFUND', 'FULLY_REFUNDED', 'CANCELLED'),
      allowNull: false,
      defaultValue: 'PENDING',
      comment: '주문 상태'
    },

    paymentKey: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: 'payment_key',
      comment: 'PG 결제키'
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
      comment: '결제 완료 시각'
    },

    modifiableUntil: {
      type: DataTypes.DATE,
      allowNull: false,
      field: 'modifiable_until',
      comment: '결제/취소 가능 기한 (입주일 -5일 KST 23:59:59)'
    },

    itemsSnapshot: {
      // MariaDB 호환을 위해 TEXT('long') + 명시 직렬화.
      // (참고: MoveInCase.roomSnapshot 동일 패턴)
      type: DataTypes.TEXT('long'),
      allowNull: true,
      field: 'items_snapshot',
      comment: '주문 시점 옵션 정보 스냅샷 JSON',
      get() {
        const raw = this.getDataValue('itemsSnapshot');
        if (raw == null) return null;
        if (typeof raw === 'object') return raw;
        try { return JSON.parse(raw); } catch { return null; }
      },
      set(val) {
        if (val == null) {
          this.setDataValue('itemsSnapshot', null);
        } else if (typeof val === 'string') {
          this.setDataValue('itemsSnapshot', val);
        } else {
          this.setDataValue('itemsSnapshot', JSON.stringify(val));
        }
      }
    },

    deliveryStatus: {
      type: DataTypes.ENUM('PENDING', 'IN_TRANSIT', 'DELIVERED'),
      allowNull: false,
      defaultValue: 'PENDING',
      field: 'delivery_status',
      comment: '배송 상태'
    },

    deliveredAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'delivered_at',
      comment: '배송 완료 시각'
    }
  }, {
    tableName: 'move_in_guest_orders',
    timestamps: true,
    underscored: true
  });

  /**
   * 상태 한글 라벨
   */
  MoveInGuestOrder.STATUS_LABELS = {
    PENDING:         '결제 대기',
    PAID:            '결제 완료',
    PARTIAL_REFUND:  '부분 환불',
    FULLY_REFUNDED:  '전액 환불',
    CANCELLED:       '취소'
  };

  MoveInGuestOrder.DELIVERY_STATUS_LABELS = {
    PENDING:    '배송 전',
    IN_TRANSIT: '배송 중',
    DELIVERED:  '배송 완료'
  };

  MoveInGuestOrder.ORDER_TYPE_LABELS = {
    INITIAL:    '최초 주문',
    ADDITIONAL: '추가 주문'
  };

  /**
   * 결제 가능 (PENDING) 여부
   */
  MoveInGuestOrder.prototype.isPayable = function () {
    return this.status === 'PENDING';
  };

  /**
   * 미결제 취소 가능 여부
   */
  MoveInGuestOrder.prototype.isCancellable = function () {
    return this.status === 'PENDING';
  };

  /**
   * 순 결제액 (paid - refunded)
   */
  MoveInGuestOrder.prototype.getNetAmount = function () {
    return this.paidAmount - this.refundedAmount;
  };

  return MoveInGuestOrder;
};
