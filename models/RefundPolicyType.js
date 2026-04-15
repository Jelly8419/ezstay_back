const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

/**
 * RefundPolicyType 모델 - 환불 정책 마스터 테이블
 * 환불 정책 타입(약하게, 보통, 엄격하게) 및 특별 규칙 관리
 */
const RefundPolicyType = sequelize.define('RefundPolicyType', {
  policyType: {
    type: DataTypes.STRING(50),
    primaryKey: true,
    field: 'policy_type',
    comment: '정책 타입 (약하게, 보통, 엄격하게)'
  },
  displayName: {
    type: DataTypes.STRING(100),
    allowNull: false,
    field: 'display_name',
    comment: '표시명 (한글)'
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '정책 설명'
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    field: 'is_active',
    comment: '활성화 여부'
  },
  specialRules: {
    type: DataTypes.JSON,
    allowNull: false,
    field: 'special_rules',
    comment: '특별 규칙 (청소비/관리비 환불 등)',
    get() {
      const rawValue = this.getDataValue('specialRules');
      // JSON 자동 파싱 (Sequelize가 자동으로 처리하지만 명시적으로 보장)
      return typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
    }
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
  tableName: 'refund_policy_types',
  timestamps: true,
  underscored: false,
  indexes: [
    {
      fields: ['is_active'],
      name: 'idx_active'
    }
  ]
});

/**
 * 특별 규칙 JSON 구조 예시:
 * {
 *   "alwaysRefund": {
 *     "cleaningFee": true,
 *     "maintenanceFee": true
 *   }
 * }
 */

module.exports = RefundPolicyType;
