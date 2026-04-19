const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

const RegionAlert = sequelize.define('RegionAlert', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false
    // references 금지 - models/index.js에서 관계 설정
  },
  alertedAt: {
    type: DataTypes.DATE,
    allowNull: false
  },
  notifiedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '오픈 알림톡 실제 발송 시점 — 이 시점부터 1개월간 게스트 혜택 유효'
  }
}, {
  tableName: 'region_alerts',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      unique: true,
      fields: ['user_id'],
      name: 'region_alerts_user_id_unique'
    }
  ]
});

module.exports = RegionAlert;
