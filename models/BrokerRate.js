const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

/**
 * BrokerRate 모델 - 중개인 적용률 (시간 구간)
 *
 * 관리자가 요율을 변경할 때 기존 활성 row 의 effective_to 를 변경 시점으로 마감하고
 * 새 row 를 effective_to = NULL 로 추가한다.
 *
 * 결제 시점 판정: broker_id = X, effective_from <= approvedAt < (effective_to OR 무한대).
 */
const BrokerRate = sequelize.define('BrokerRate', {
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

  rate: {
    type: DataTypes.DECIMAL(5, 4),
    allowNull: false,
    comment: '적용률 (0.5000 = 50%). 호스트 수수료 3.3% 에 곱해 인센티브 산출',
    get() {
      const v = this.getDataValue('rate');
      return v === null || v === undefined ? null : parseFloat(v);
    }
  },

  effectiveFrom: {
    type: DataTypes.DATE,
    allowNull: false,
    field: 'effective_from',
    comment: '요율 적용 시작 시점 (이 시점 포함)'
  },
  effectiveTo: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'effective_to',
    comment: 'NULL = 현재 유효'
  },

  createdAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'created_at'
  }
}, {
  tableName: 'broker_rates',
  timestamps: false,
  underscored: false,
  indexes: [
    { fields: ['broker_id'], name: 'idx_broker_rates_broker' },
    {
      fields: ['broker_id', 'effective_from', 'effective_to'],
      name: 'idx_broker_rates_range'
    }
  ]
});

module.exports = BrokerRate;
