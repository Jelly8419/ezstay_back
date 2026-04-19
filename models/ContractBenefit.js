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
  benefitType: {
    type: DataTypes.ENUM('HOST_FEE_WAIVER', 'GUEST_DISCOUNT'),
    allowNull: false
  },
  discountAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  appliedAt: {
    type: DataTypes.DATE,
    allowNull: false
  }
}, {
  tableName: 'contract_benefits',
  timestamps: true,
  underscored: true
});

module.exports = ContractBenefit;
