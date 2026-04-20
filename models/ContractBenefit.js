const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

const ContractBenefit = sequelize.define('ContractBenefit', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  contractId: {
    type: DataTypes.INTEGER,
    allowNull: false
    // references 금지 - models/index.js에서 관계 설정
  },
  promotionEventId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '적용된 이벤트 (레거시 데이터는 NULL)'
  },
  benefitType: {
    type: DataTypes.ENUM('HOST_FEE_WAIVER', 'GUEST_DISCOUNT'),
    allowNull: false
  },
  discountAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  status: {
    type: DataTypes.ENUM('ACTIVE', 'VOIDED'),
    allowNull: false,
    defaultValue: 'ACTIVE',
    comment: 'ACTIVE=유효, VOIDED=계약 취소/거절/만료로 무효화'
  },
  voidedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  voidedReason: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  appliedAt: {
    type: DataTypes.DATE,
    allowNull: false
  }
}, {
  tableName: 'contract_benefits',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['contract_id', 'status'], name: 'idx_contract_status' },
    { fields: ['promotion_event_id'], name: 'idx_event' }
  ]
});

module.exports = ContractBenefit;
