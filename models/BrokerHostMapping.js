const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

/**
 * BrokerHostMapping 모델 - 중개인 ↔ 임대인 귀속 (시간 구간)
 *
 * 호스트가 중개인 간 이관될 수 있으므로 시간 구간으로 관리.
 * 동일 호스트에 대한 중복 활성 매핑(end_date IS NULL) 은 앱 레벨에서 검증.
 *
 * 결제 시점 판정: host_id = X, start_date <= approvedAt < (end_date OR 무한대).
 */
const BrokerHostMapping = sequelize.define('BrokerHostMapping', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },

  brokerId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'broker_id',
    comment: '중개인 ID'
  },
  hostId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'host_id',
    comment: '임대인 (users.id, userMode=host)'
  },

  startDate: {
    type: DataTypes.DATE,
    allowNull: false,
    field: 'start_date',
    comment: '귀속 시작 시점'
  },
  endDate: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'end_date',
    comment: 'NULL = 현재 유효'
  },

  createdByAdminId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'created_by_admin_id',
    comment: '등록한 관리자 ID'
  },

  createdAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'created_at'
  }
}, {
  tableName: 'broker_host_mappings',
  timestamps: false,
  underscored: false,
  indexes: [
    {
      fields: ['host_id', 'end_date'],
      name: 'idx_broker_host_mappings_host_active'
    },
    {
      fields: ['broker_id'],
      name: 'idx_broker_host_mappings_broker'
    }
  ]
});

module.exports = BrokerHostMapping;
