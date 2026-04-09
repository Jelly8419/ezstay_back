const { DataTypes, Sequelize } = require('sequelize');

const sequelize = new Sequelize(process.env.DB_NAME || 'ezstay', process.env.DB_USER || 'root', process.env.DB_PASSWORD || '', {
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
 * RentalOrderLog 모델 - 렌탈 주문 변경 이력
 * 모든 렌탈 관련 액션을 타임라인으로 기록
 */
const RentalOrderLog = sequelize.define('RentalOrderLog', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  contractId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'contract_id',
    comment: '계약 ID (빠른 조회용)'
  },
  rentalOrderId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'rental_order_id',
    comment: '렌탈 주문 ID'
  },
  rentalOrderItemId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'rental_order_item_id',
    comment: '렌탈 주문 아이템 ID'
  },

  // 액션 정보
  action: {
    type: DataTypes.ENUM(
      'ORDER_CREATED',        // 주문 생성
      'ITEM_ADDED',           // 아이템 추가 (주문 내)
      'ITEM_CANCELLED',       // 아이템 취소
      'PAYMENT_PENDING',      // 결제 대기
      'PAYMENT_COMPLETED',    // 결제 완료
      'PAYMENT_FAILED',       // 결제 실패
      'REFUND_REQUESTED',     // 환불 요청
      'REFUND_COMPLETED',     // 환불 완료
      'REFUND_FAILED',        // 환불 실패
      'ORDER_CANCELLED',      // 주문 전체 취소
      'ORDER_EXPIRED',        // 주문 자동 만료 (미결제/기한 초과)
      'CANCEL_REQUESTED',     // 반품/취소 요청 (게스트)
      'DELIVERY_STARTED',     // 배송 시작
      'DELIVERY_COMPLETED',   // 배송 완료
      'ADMIN_REFUND',         // 관리자 직접 환불
      'PG_DB_MISMATCH'        // [긴급] PG 취소 성공 후 DB 업데이트 실패 - 수동 확인 필요
    ),
    allowNull: false,
    comment: '액션 유형'
  },

  // 행위자 정보
  actor: {
    type: DataTypes.ENUM('GUEST', 'HOST', 'ADMIN', 'SYSTEM'),
    allowNull: false,
    comment: '행위자'
  },
  actorId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'actor_id',
    comment: '행위자 ID (User 또는 Admin)'
  },

  // 금액 변동
  amountChange: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 0,
    field: 'amount_change',
    comment: '금액 변동 (+결제, -환불)'
  },
  balanceAfter: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 0,
    field: 'balance_after',
    comment: '변동 후 잔액 (순 결제액)'
  },

  // 상세 정보
  metadata: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: '상세 정보 (아이템명, 수량, 결제키 등)'
  },
  description: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: '설명 (관리자용)'
  },

  // 추적 정보
  ipAddress: {
    type: DataTypes.STRING(45),
    allowNull: true,
    field: 'ip_address'
  },
  userAgent: {
    type: DataTypes.STRING(500),
    allowNull: true,
    field: 'user_agent'
  },

  createdAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'created_at'
  }
}, {
  tableName: 'rental_order_logs',
  timestamps: false, // updatedAt 불필요 (이력은 수정되지 않음)
  underscored: false,
  indexes: [
    {
      fields: ['contract_id'],
      name: 'idx_rental_order_logs_contract_id'
    },
    {
      fields: ['rental_order_id'],
      name: 'idx_rental_order_logs_order_id'
    },
    {
      fields: ['action'],
      name: 'idx_rental_order_logs_action'
    },
    {
      fields: ['actor'],
      name: 'idx_rental_order_logs_actor'
    },
    {
      fields: ['created_at'],
      name: 'idx_rental_order_logs_created_at'
    }
  ]
});

/**
 * 액션 레이블
 */
RentalOrderLog.ACTION_LABELS = {
  ORDER_CREATED: '주문 생성',
  ITEM_ADDED: '아이템 추가',
  ITEM_CANCELLED: '아이템 취소',
  PAYMENT_PENDING: '결제 대기',
  PAYMENT_COMPLETED: '결제 완료',
  PAYMENT_FAILED: '결제 실패',
  REFUND_REQUESTED: '환불 요청',
  REFUND_COMPLETED: '환불 완료',
  REFUND_FAILED: '환불 실패',
  ORDER_CANCELLED: '주문 취소',
  ORDER_EXPIRED: '주문 자동 만료',
  CANCEL_REQUESTED: '반품/취소 요청',
  DELIVERY_STARTED: '배송 시작',
  DELIVERY_COMPLETED: '배송 완료'
};

/**
 * 행위자 레이블
 */
RentalOrderLog.ACTOR_LABELS = {
  GUEST: '게스트',
  HOST: '호스트',
  ADMIN: '관리자',
  SYSTEM: '시스템'
};

/**
 * 이력 로그 생성 헬퍼
 * @param {Object} params - 로그 파라미터
 * @param {Object} transaction - Sequelize 트랜잭션
 * @returns {Promise<RentalOrderLog>}
 */
RentalOrderLog.createLog = async function({
  contractId,
  rentalOrderId = null,
  rentalOrderItemId = null,
  action,
  actor,
  actorId = null,
  amountChange = 0,
  balanceAfter = 0,
  metadata = null,
  description = null,
  req = null
}, transaction = null) {
  const logData = {
    contractId,
    rentalOrderId,
    rentalOrderItemId,
    action,
    actor,
    actorId,
    amountChange,
    balanceAfter,
    metadata,
    description,
    ipAddress: req?.ip || req?.connection?.remoteAddress || null,
    userAgent: req?.headers?.['user-agent']?.substring(0, 500) || null
  };

  const options = transaction ? { transaction } : {};
  return await RentalOrderLog.create(logData, options);
};

/**
 * 계약별 타임라인 조회
 * @param {number} contractId - 계약 ID
 * @param {Object} options - 조회 옵션
 * @returns {Promise<Array>}
 */
RentalOrderLog.getTimeline = async function(contractId, options = {}) {
  const {
    action = null,
    startDate = null,
    endDate = null,
    limit = 50,
    offset = 0
  } = options;

  const where = { contractId };

  if (action) {
    where.action = action;
  }

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) {
      where.createdAt[Sequelize.Op.gte] = startDate;
    }
    if (endDate) {
      where.createdAt[Sequelize.Op.lte] = endDate;
    }
  }

  return await RentalOrderLog.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    limit,
    offset
  });
};

module.exports = RentalOrderLog;
