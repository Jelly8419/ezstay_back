const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

/**
 * Broker 모델 - 중개인 마스터
 *
 * 중개인이 유입시킨 임대인(호스트)의 계약에 대해 플랫폼이 월 단위로 인센티브를 지급한다.
 * 세무 처리는 broker_type 에 따라 분기:
 *   - individual: 기타소득 원천징수 8.8%
 *   - business  : 세금계산서 수취 (원천징수 없음, tax_id 필수)
 */
const Broker = sequelize.define('Broker', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },

  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: '중개인명 (개인 이름 또는 상호)'
  },
  phone: {
    type: DataTypes.STRING(20),
    allowNull: false,
    comment: '연락처'
  },

  brokerType: {
    type: DataTypes.ENUM('individual', 'business'),
    allowNull: false,
    field: 'broker_type',
    comment: '세무 구분: individual=기타소득 8.8% 원천, business=세금계산서'
  },
  taxId: {
    type: DataTypes.STRING(20),
    allowNull: true,
    field: 'tax_id',
    comment: '사업자등록번호 (business 일 때 필수, 앱 레벨 검증)'
  },

  bankName: {
    type: DataTypes.STRING(50),
    allowNull: true,
    field: 'bank_name',
    comment: '지급 계좌 은행명'
  },
  bankAccount: {
    type: DataTypes.STRING(50),
    allowNull: true,
    field: 'bank_account',
    comment: '지급 계좌번호'
  },
  bankHolder: {
    type: DataTypes.STRING(50),
    allowNull: true,
    field: 'bank_holder',
    comment: '예금주'
  },

  startDate: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    field: 'start_date',
    comment: '활동 시작일 (이 날 포함)'
  },
  endDate: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    field: 'end_date',
    comment: '활동 종료일 (이 날 포함)'
  },

  status: {
    type: DataTypes.ENUM('active', 'inactive'),
    allowNull: false,
    defaultValue: 'active',
    comment: '활성 여부 (inactive 시 요율 0% 취급)'
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
  tableName: 'brokers',
  timestamps: true,
  underscored: false,
  indexes: [
    { fields: ['status'], name: 'idx_brokers_status' },
    {
      fields: ['status', 'start_date', 'end_date'],
      name: 'idx_brokers_active_range'
    }
  ]
});

Broker.TYPE_LABELS = {
  individual: '개인',
  business: '사업자'
};

Broker.STATUS_LABELS = {
  active: '활성',
  inactive: '비활성'
};

module.exports = Broker;
