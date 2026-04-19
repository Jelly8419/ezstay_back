const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

const HostBenefit = sequelize.define('HostBenefit', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  hostId: {
    type: DataTypes.INTEGER,
    allowNull: false
    // references 금지 - models/index.js에서 관계 설정
  },
  registeredAt: {
    type: DataTypes.DATE,
    allowNull: false
  }
}, {
  tableName: 'host_benefits',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      unique: true,
      fields: ['host_id'],
      name: 'host_benefits_host_id_unique'
    }
  ]
});

module.exports = HostBenefit;
