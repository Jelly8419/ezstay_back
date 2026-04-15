const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

const Receipt = sequelize.define('Receipt', {
  id: {
    type: DataTypes.INTEGER.UNSIGNED,
    primaryKey: true,
    autoIncrement: true,
    comment: '영수증 발급 건 고유 ID'
  },
  userId: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '대상 사용자 ID'
  },
  userType: {
    type: DataTypes.ENUM('HOST', 'GUEST'),
    allowNull: false,
    comment: '사용자 유형'
  },
  contractId: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: true,
    comment: '관련 계약 ID'
  },
  settlementId: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: true,
    comment: '관련 정산 ID'
  },
  receiptType: {
    type: DataTypes.ENUM('personal', 'business', 'tax_invoice'),
    allowNull: false,
    comment: '영수증 종류 (설정에서 스냅샷)'
  },
  targetType: {
    type: DataTypes.ENUM('CONTRACT_FEE', 'HOST_CANCEL_FEE', 'GUEST_CANCEL_FEE', 'OPTION_SALE', 'CLEANING_FEE', 'OPTION_SALE_REFUND', 'CLEANING_FEE_REFUND'),
    allowNull: false,
    comment: '발급 유형 (CONTRACT_FEE: 계약수수료, HOST_CANCEL_FEE: 호스트취소수수료, GUEST_CANCEL_FEE: 게스트취소위약금, OPTION_SALE: 옵션상품판매, CLEANING_FEE: 이지청소비, OPTION_SALE_REFUND: 옵션상품환불, CLEANING_FEE_REFUND: 이지청소환불)'
  },
  amount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '발급 대상 금액 (플랫폼 수익)'
  },
  date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    comment: '결제일 또는 정산 지급일'
  },
  status: {
    type: DataTypes.ENUM('PENDING', 'ISSUED'),
    allowNull: false,
    defaultValue: 'PENDING',
    comment: '발급 상태 (PENDING: 발급대기, ISSUED: 발급완료)'
  },
  issuedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '발급 완료 시각'
  },
  issuedBy: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: true,
    comment: '발급 처리 관리자 ID'
  },
  issueNote: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: '관리자 메모'
  },
  // 발급 정보 스냅샷 (설정 테이블에서 생성 시점에 복사)
  receiptNumber: {
    type: DataTypes.STRING(30),
    allowNull: false,
    comment: '폰번호/카드번호/사업자번호 (스냅샷)'
  },
  businessName: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: '사업자명 (스냅샷)'
  },
  repName: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: '대표자명 (스냅샷)'
  },
  email: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: '이메일 (스냅샷)'
  }
}, {
  tableName: 'receipts',
  timestamps: true,
  underscored: true,
  comment: '영수증 발급 건 관리 테이블',
  indexes: [
    {
      name: 'idx_receipts_user',
      fields: ['user_id', 'user_type']
    },
    {
      name: 'idx_receipts_status',
      fields: ['status']
    },
    {
      name: 'idx_receipts_contract',
      fields: ['contract_id']
    },
    {
      name: 'idx_receipts_date',
      fields: ['date']
    }
  ]
});

module.exports = Receipt;
