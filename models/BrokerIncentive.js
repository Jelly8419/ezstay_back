const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

/**
 * BrokerIncentive 모델 - 계약별 중개인 인센티브 스냅샷
 *
 * Settlement 당 최대 1개 (UNIQUE). Settlement.status = READY 전환 시점에 생성한다.
 *
 * 세무 분기:
 *   - individual: gross = withholding + net, supply/vat = 0
 *   - business  : gross = supply + vat, net = gross, withholding = 0
 *
 * 스냅샷 불변식: base_fee, applied_rate, broker_type 은 생성 후 변경 금지.
 * 요율/매핑이 나중에 바뀌어도 이 행은 그대로.
 */
const BrokerIncentive = sequelize.define('BrokerIncentive', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },

  settlementId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'settlement_id',
    comment: '정산 ID (1:1)'
  },
  contractId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'contract_id',
    comment: '계약 ID'
  },
  brokerId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'broker_id',
    comment: '중개인 ID'
  },

  // 스냅샷 (불변)
  baseFee: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'base_fee',
    comment: '기준 금액 = settlement.host_platform_fee (VAT 포함 총액)'
  },
  appliedRate: {
    type: DataTypes.DECIMAL(5, 4),
    allowNull: false,
    field: 'applied_rate',
    comment: '적용 요율 스냅샷 (0.5000 = 50%)',
    get() {
      const v = this.getDataValue('appliedRate');
      return v === null || v === undefined ? null : parseFloat(v);
    }
  },
  brokerType: {
    type: DataTypes.ENUM('individual', 'business'),
    allowNull: false,
    field: 'broker_type',
    comment: '중개인 타입 스냅샷 (결제 시점 기준)'
  },

  // 계산 결과
  grossAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'gross_amount',
    comment: '지급 대상액 = floor(base_fee × applied_rate) (세전)'
  },
  withholdingAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'withholding_amount',
    comment: '원천징수액 (individual 만 >0)'
  },
  supplyAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'supply_amount',
    comment: '공급가액 (business 만 >0, floor(gross × 10/11))'
  },
  vatAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'vat_amount',
    comment: '부가세 (business 만 >0, gross - supply)'
  },
  netAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'net_amount',
    comment: '실지급액. individual=gross-withholding, business=gross'
  },

  // 집계 키
  settlementMonth: {
    type: DataTypes.CHAR(7),
    allowNull: false,
    field: 'settlement_month',
    comment: 'YYYY-MM (settlement.expected_date 기준월)'
  },

  // 상태
  status: {
    type: DataTypes.ENUM('PENDING', 'AGGREGATED', 'ON_HOLD', 'CANCELLED'),
    allowNull: false,
    defaultValue: 'PENDING',
    comment: 'PENDING=생성, AGGREGATED=월별 payout 집계, ON_HOLD=보류, CANCELLED=취소'
  },
  payoutId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'payout_id',
    comment: '집계된 월별 지급 ID'
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
  tableName: 'broker_incentives',
  timestamps: true,
  underscored: false,
  indexes: [
    {
      fields: ['settlement_id'],
      unique: true,
      name: 'uq_broker_incentive_settlement'
    },
    {
      fields: ['broker_id', 'settlement_month'],
      name: 'idx_broker_incentive_broker_month'
    },
    { fields: ['status'], name: 'idx_broker_incentive_status' },
    { fields: ['payout_id'], name: 'idx_broker_incentive_payout' },
    { fields: ['contract_id'], name: 'idx_broker_incentive_contract' }
  ]
});

BrokerIncentive.STATUS_LABELS = {
  PENDING: '집계 전',
  AGGREGATED: '월별 집계됨',
  ON_HOLD: '보류',
  CANCELLED: '취소'
};

module.exports = BrokerIncentive;
