const { DataTypes } = require('sequelize');

/**
 * MoveInGuestOrderLog 모델
 * 임차인 주문/결제/배송 상태 변경 이력
 *
 * - actor: GUEST(임차인 본인) / ADMIN(관리자) / SYSTEM(스케줄러 등)
 * - action 표준값:
 *     ORDER_CREATED, ORDER_CANCELLED,
 *     PAYMENT_SUCCESS, PAYMENT_FAILED, PAYMENT_REFUND,
 *     ITEM_CANCELLED,
 *     DELIVERY_UPDATED, DELIVERY_COMPLETED
 *
 * NOTE: metadata 는 LONGTEXT + 직렬화 (MariaDB JSON 호환)
 */
module.exports = (sequelize) => {
  const MoveInGuestOrderLog = sequelize.define('MoveInGuestOrderLog', {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true
    },

    guestOrderId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'guest_order_id',
      comment: 'move_in_guest_orders.id'
    },

    guestOrderItemId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'guest_order_item_id',
      comment: 'move_in_guest_order_items.id (라인 단위 액션 시)'
    },

    caseId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'case_id',
      comment: 'move_in_cases.id (조회 편의)'
    },

    actor: {
      type: DataTypes.ENUM('GUEST', 'ADMIN', 'SYSTEM'),
      allowNull: false,
      comment: '주체'
    },

    actorId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'actor_id',
      comment: 'users.id 또는 admins.id'
    },

    action: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: '액션 식별자'
    },

    amountChange: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'amount_change',
      comment: '금액 변동 (양수=증가, 음수=환불)'
    },

    balanceAfter: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'balance_after',
      comment: '액션 후 net 결제 금액'
    },

    metadata: {
      // MariaDB JSON 호환: TEXT('long') + 직렬화
      type: DataTypes.TEXT('long'),
      allowNull: true,
      comment: '부가 정보 JSON',
      get() {
        const raw = this.getDataValue('metadata');
        if (raw == null) return null;
        if (typeof raw === 'object') return raw;
        try { return JSON.parse(raw); } catch { return null; }
      },
      set(val) {
        if (val == null) {
          this.setDataValue('metadata', null);
        } else if (typeof val === 'string') {
          this.setDataValue('metadata', val);
        } else {
          this.setDataValue('metadata', JSON.stringify(val));
        }
      }
    },

    description: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: '설명'
    },

    ipAddress: {
      type: DataTypes.STRING(45),
      allowNull: true,
      field: 'ip_address',
      comment: '요청 IP'
    },

    userAgent: {
      type: DataTypes.STRING(500),
      allowNull: true,
      field: 'user_agent',
      comment: 'User-Agent'
    },

    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'created_at'
    }
  }, {
    tableName: 'move_in_guest_order_logs',
    timestamps: false,
    underscored: true
  });

  /**
   * 로그 생성 헬퍼
   * - 컨트롤러/서비스에서 req 를 그대로 넘기면 IP/UA 자동 채움
   */
  MoveInGuestOrderLog.createLog = async function ({
    guestOrderId,
    guestOrderItemId = null,
    caseId,
    actor,
    actorId = null,
    action,
    amountChange = 0,
    balanceAfter = 0,
    metadata = null,
    description = null,
    req = null
  }, transaction = null) {
    const logData = {
      guestOrderId,
      guestOrderItemId,
      caseId,
      actor,
      actorId,
      action,
      amountChange,
      balanceAfter,
      metadata,
      description,
      ipAddress: req?.ip
        || req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
        || req?.connection?.remoteAddress
        || null,
      userAgent: req?.headers?.['user-agent']?.substring(0, 500) || null
    };

    const options = transaction ? { transaction } : {};
    return await MoveInGuestOrderLog.create(logData, options);
  };

  return MoveInGuestOrderLog;
};
