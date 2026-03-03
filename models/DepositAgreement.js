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
 * DepositAgreement 모델 - 보증금 합의 정보
 * 퇴실 보류(HOST_PENDING) 상태에서 호스트가 제출하는 보증금 차감 합의 내용
 *
 * 플로우:
 * 1. 호스트가 퇴실 확인 보류 (checkoutStatus → HOST_PENDING)
 * 2. 호스트가 합의 내용 제출 (DepositAgreement 생성, checkoutStatus는 HOST_PENDING 유지)
 * 3. 게스트가 합의 동의 (acceptedAt 기록, checkoutStatus → HOST_CONFIRMED → COMPLETED)
 * 4. 퇴실+10일 데드라인 초과 시 자동 전액 반환 (스케줄러)
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

  // 합의 내용
  deductAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'deduct_amount',
    comment: '보증금 차감 요청 금액'
  },
  agreementText: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: '합의 내용 (호스트 작성)'
  },

  // 보류 사유 (퇴실 확인 보류 시 입력한 사유)
  holdReason: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'hold_reason',
    comment: '퇴실 확인 보류 사유'
  },

  // 시간 기록
  submittedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'submitted_at',
    comment: '합의 내용 제출 시각'
  },
  acceptedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'accepted_at',
    comment: '게스트 합의 동의 시각 (NULL이면 미동의)'
  },
  adminApprovedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'admin_approved_at',
    comment: '관리자 보류 승인 시점 (합의 프로세스 시작 시점)'
  },

  // 상태
  status: {
    type: DataTypes.ENUM(
      'SUBMITTED',    // 호스트가 합의 내용 제출
      'ACCEPTED',     // 게스트가 합의 동의
      'AUTO_RETURNED' // 데드라인 초과로 전액 자동 반환
    ),
    allowNull: false,
    defaultValue: 'SUBMITTED',
    comment: '합의 상태'
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
      unique: true,
      name: 'idx_deposit_agreement_contract_id',
      comment: '계약당 1개의 보증금 합의 레코드'
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
  SUBMITTED: '합의 내용 제출됨',
  ACCEPTED: '합의 동의 완료',
  AUTO_RETURNED: '자동 전액 반환'
};

module.exports = DepositAgreement;
