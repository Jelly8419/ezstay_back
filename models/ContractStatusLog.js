const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

/**
 * ContractStatusLog 모델 - 계약 상태 변경 이력
 * 모든 상태 변경을 기록하여 감사 추적 및 분석 가능
 * 로그는 영구 보존됨
 */
const ContractStatusLog = sequelize.define('ContractStatusLog', {
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
  },

  // 상태 변경 정보
  fromStatus: {
    type: DataTypes.STRING(50),
    allowNull: true,  // 최초 생성 시 null
    field: 'from_status',
    comment: '변경 전 상태'
  },
  toStatus: {
    type: DataTypes.STRING(50),
    allowNull: false,
    field: 'to_status',
    comment: '변경 후 상태'
  },

  // 변경 주체
  changedBy: {
    type: DataTypes.ENUM('GUEST', 'HOST', 'ADMIN', 'SYSTEM'),
    allowNull: false,
    field: 'changed_by',
    comment: '변경 주체'
  },
  changedByUserId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'changed_by_user_id',
    comment: '변경한 사용자 ID (User 또는 Admin)'
  },

  // 상세 정보
  reason: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '변경 사유'
  },
  metadata: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: '추가 메타데이터 (환불 금액, 위약금 등)',
    get() {
      const rawValue = this.getDataValue('metadata');
      return typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
    }
  },

  // IP 및 디바이스 정보 (보안 감사용)
  ipAddress: {
    type: DataTypes.STRING(45),
    allowNull: true,
    field: 'ip_address',
    comment: '요청 IP 주소'
  },
  userAgent: {
    type: DataTypes.STRING(500),
    allowNull: true,
    field: 'user_agent',
    comment: '사용자 에이전트'
  },

  createdAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'created_at'
  }
}, {
  tableName: 'contract_status_logs',
  timestamps: false,  // updatedAt 불필요 (로그는 수정하지 않음)
  indexes: [
    {
      fields: ['contract_id'],
      name: 'idx_contract'
    },
    {
      fields: ['to_status'],
      name: 'idx_to_status'
    },
    {
      fields: ['changed_by'],
      name: 'idx_changed_by'
    },
    {
      fields: ['created_at'],
      name: 'idx_created_at'
    },
    {
      // 복합 인덱스: 특정 계약의 최신 로그 조회 최적화
      fields: ['contract_id', 'created_at'],
      name: 'idx_contract_created'
    }
  ]
});

/**
 * 변경 주체 한글명 매핑
 */
ContractStatusLog.CHANGED_BY_LABELS = {
  GUEST: '게스트',
  HOST: '호스트',
  ADMIN: '관리자',
  SYSTEM: '시스템'
};

/**
 * 상태 변경 로그 생성 헬퍼 함수
 * @param {Object} params - 로그 생성 파라미터
 * @param {number} params.contractId - 계약 ID
 * @param {string} params.fromStatus - 변경 전 상태
 * @param {string} params.toStatus - 변경 후 상태
 * @param {string} params.changedBy - 변경 주체 (GUEST, HOST, ADMIN, SYSTEM)
 * @param {number} [params.changedByUserId] - 변경한 사용자 ID
 * @param {string} [params.reason] - 변경 사유
 * @param {Object} [params.metadata] - 추가 메타데이터
 * @param {Object} [params.req] - Express request 객체 (IP, User-Agent 추출용)
 * @param {Object} [params.transaction] - Sequelize 트랜잭션
 * @returns {Promise<ContractStatusLog>}
 */
ContractStatusLog.createLog = async function({
  contractId,
  fromStatus,
  toStatus,
  changedBy,
  changedByUserId = null,
  reason = null,
  metadata = null,
  req = null,
  transaction = null
}) {
  const logData = {
    contractId,
    fromStatus,
    toStatus,
    changedBy,
    changedByUserId,
    reason,
    metadata
  };

  // Request 객체에서 IP와 User-Agent 추출
  if (req) {
    logData.ipAddress = req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress;
    logData.userAgent = req.headers['user-agent']?.substring(0, 500);
  }

  const options = transaction ? { transaction } : {};
  return await ContractStatusLog.create(logData, options);
};

/**
 * 특정 계약의 상태 변경 이력 조회
 * @param {number} contractId - 계약 ID
 * @param {Object} [options] - 조회 옵션
 * @param {number} [options.limit] - 조회 개수 제한
 * @param {string} [options.order] - 정렬 순서 ('ASC' | 'DESC')
 * @returns {Promise<ContractStatusLog[]>}
 */
ContractStatusLog.getLogsByContractId = async function(contractId, options = {}) {
  const { limit, order = 'DESC' } = options;

  const queryOptions = {
    where: { contractId },
    order: [['createdAt', order]]
  };

  if (limit) {
    queryOptions.limit = limit;
  }

  return await ContractStatusLog.findAll(queryOptions);
};

module.exports = ContractStatusLog;
