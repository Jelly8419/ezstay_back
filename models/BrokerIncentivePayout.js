const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

/**
 * BrokerIncentivePayout 모델 - 월별 지급 단위 (중개인 × 월)
 *
 * Admin 이 월별 리스트 조회 시 동기 계산 / upsert.
 * UNIQUE(broker_id, settlement_month). 지급 완료된 행은 재계산 금지.
 */
const BrokerIncentivePayout = sequelize.define('BrokerIncentivePayout', {
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
  settlementMonth: {
    type: DataTypes.CHAR(7),
    allowNull: false,
    field: 'settlement_month',
    comment: 'YYYY-MM'
  },

  contractCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'contract_count',
    comment: '집계된 계약 수'
  },
  totalGross: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'total_gross',
    comment: '지급대상액 합계 (세전)'
  },
  totalWithholding: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'total_withholding',
    comment: '원천징수 합계 (individual)'
  },
  totalSupply: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'total_supply',
    comment: '공급가액 합계 (business)'
  },
  totalVat: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'total_vat',
    comment: '부가세 합계 (business)'
  },
  totalNet: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'total_net',
    comment: '실지급액 합계'
  },

  status: {
    type: DataTypes.ENUM('PENDING', 'PAID'),
    allowNull: false,
    defaultValue: 'PENDING',
    comment: 'PENDING=지급대기, PAID=지급완료'
  },
  paidAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'paid_at',
    comment: '지급 완료 시각'
  },
  paidByAdminId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'paid_by_admin_id',
    comment: '지급 처리 관리자 ID'
  },
  memo: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '관리자 메모'
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
  tableName: 'broker_incentive_payouts',
  timestamps: true,
  underscored: false,
  indexes: [
    {
      fields: ['broker_id', 'settlement_month'],
      unique: true,
      name: 'uq_broker_incentive_payout_broker_month'
    },
    { fields: ['status'], name: 'idx_broker_incentive_payout_status' },
    { fields: ['settlement_month'], name: 'idx_broker_incentive_payout_month' }
  ]
});

BrokerIncentivePayout.STATUS_LABELS = {
  PENDING: '지급대기',
  PAID: '지급완료'
};

module.exports = BrokerIncentivePayout;
