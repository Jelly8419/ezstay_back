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
 * DepositAgreement 모델 - 보증금 보류 신청 및 합의 이력
 * 보류 신청마다 1 row 생성, 재신청 시 새 row 추가 (1:N)
 *
 * 플로우:
 * 1. 호스트 보류 신청 → status: REQUESTED (row 생성)
 * 2. 관리자 승인 → status: APPROVED / 거절 → status: REJECTED
 * 3. 호스트 합의 내용 제출 → status: SUBMITTED (APPROVED row 업데이트)
 * 4. 게스트 합의 동의 → status: ACCEPTED
 * 5. 10일 데드라인 초과 → status: AUTO_RETURNED (스케줄러)
 */
const DepositAgreement = sequelize.define('DepositAgreement', {
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

  // 보류 신청 정보
  holdReason: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'hold_reason',
    comment: '퇴실 확인 보류 사유 (호스트 작성)'
  },
  requestedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'requested_at',
    comment: '보류 신청 시각'
  },

  // 관리자 거절 정보
  rejectedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'rejected_at',
    comment: '관리자 거절 시각'
  },
  rejectedReason: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'rejected_reason',
    comment: '거절 사유'
  },
  rejectedByAdminId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'rejected_by_admin_id',
    comment: '거절 관리자 ID'
  },

  // 합의 내용 (APPROVED 후 호스트 제출)
  deductAmount: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 0,
    field: 'deduct_amount',
    comment: '보증금 차감 요청 금액'
  },
  agreementText: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'agreement_text',
    comment: '합의 내용 (호스트 작성)'
  },

  // 시간 기록
  adminApprovedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'admin_approved_at',
    comment: '관리자 승인 시각'
  },
  submittedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'submitted_at',
    comment: '합의 내용 제출 시각'
  },
  acceptedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'accepted_at',
    comment: '게스트 합의 동의 시각'
  },

  // 상태
  status: {
    type: DataTypes.ENUM(
      'REQUESTED',    // 호스트 보류 신청
      'APPROVED',     // 관리자 승인 (합의 진행 중)
      'REJECTED',     // 관리자 거절
      'SUBMITTED',    // 호스트 합의 내용 제출
      'ACCEPTED',     // 게스트 합의 동의
      'AUTO_RETURNED' // 데드라인 초과 자동 반환
    ),
    allowNull: false,
    defaultValue: 'REQUESTED',
    comment: '보류/합의 상태'
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
  tableName: 'deposit_agreements',
  timestamps: true,
  underscored: false,
  indexes: [
    {
      fields: ['contract_id'],
      name: 'idx_deposit_agreement_contract_id'
    },
    {
      fields: ['status'],
      name: 'idx_deposit_agreement_status'
    }
  ]
});

/**
 * 합의 상태 한글명 매핑
 */
DepositAgreement.STATUS_LABELS = {
  REQUESTED: '보류 신청',
  APPROVED: '보류 승인',
  REJECTED: '보류 거절',
  SUBMITTED: '합의 내용 제출됨',
  ACCEPTED: '합의 동의 완료',
  AUTO_RETURNED: '자동 전액 반환'
};

module.exports = DepositAgreement;
