const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

const PromotionParticipant = sequelize.define('PromotionParticipant', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  promotionEventId: {
    type: DataTypes.INTEGER,
    allowNull: false
    // references 금지 - models/index.js에서 관계 설정
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  appliedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    comment: '자격 신청/등록 시점'
  },
  notifiedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '알림톡 발송 시점 (향후 연동용)'
  },
  consumedContractId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '혜택을 소진한 계약 ID (NULL=미사용, 취소 시 복구됨)'
  },
  consumedAt: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'promotion_participants',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      unique: true,
      fields: ['promotion_event_id', 'user_id'],
      name: 'uk_event_user'
    },
    { fields: ['user_id'], name: 'idx_user' },
    { fields: ['promotion_event_id', 'consumed_contract_id'], name: 'idx_event_consumed' }
  ]
});

module.exports = PromotionParticipant;
