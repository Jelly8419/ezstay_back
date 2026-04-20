const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

const PromotionEvent = sequelize.define('PromotionEvent', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  code: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
    comment: '이벤트 식별 코드 (LAUNCH_HOST_2026)'
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: '이벤트 이름 (관리자 표시용)'
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  targetRole: {
    type: DataTypes.ENUM('HOST', 'GUEST'),
    allowNull: false
  },
  benefitType: {
    type: DataTypes.ENUM('HOST_FEE_WAIVER', 'GUEST_DISCOUNT'),
    allowNull: false
  },
  discountAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '할인 금액 (원)'
  },
  participantLimit: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '선착순 제한 (NULL=무제한)'
  },
  applyTrigger: {
    type: DataTypes.ENUM('CONTRACT', 'SETTLEMENT'),
    allowNull: false,
    comment: '혜택 적용 시점'
  },
  applyOnce: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    comment: '1인 1회 제한'
  },
  startAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  endAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  }
}, {
  tableName: 'promotion_events',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['target_role', 'is_active'], name: 'idx_target_active' },
    { fields: ['apply_trigger', 'is_active'], name: 'idx_trigger_active' }
  ]
});

module.exports = PromotionEvent;
