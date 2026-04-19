const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

/**
 * RefundPolicyRule 모델 - 환불 정책 기간별 규칙
 * 각 정책 타입의 기간별 환불율 규칙 관리
 */
const RefundPolicyRule = sequelize.define('RefundPolicyRule', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  policyType: {
    type: DataTypes.STRING(50),
    allowNull: false,
    field: 'policy_type',
    comment: '정책 타입 (FK)'
    // references 옵션 제거 - models/index.js에서 belongsTo로 관계 설정
  },
  daysBeforeMin: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'days_before_min',
    comment: '최소 일수 (N일 이전)',
    validate: {
      min: 0
    }
  },
  daysBeforeMax: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'days_before_max',
    comment: '최대 일수 (NULL이면 무제한)',
    validate: {
      min: 0
    }
  },
  refundRate: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    field: 'refund_rate',
    comment: '환불율 (0-100)',
    validate: {
      min: 0,
      max: 100
    }
  },
  isSameDayCancellation: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'is_same_day_cancellation',
    comment: '계약 당일 취소 규칙 여부'
  },
  description: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: '규칙 설명'
  },
  createdAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'created_at'
  }
}, {
  tableName: 'refund_policy_rules',
  timestamps: false, // updatedAt 불필요 (환불 규칙은 수정보다는 신규 생성)
  underscored: false,
  indexes: [
    {
      fields: ['policy_type', 'days_before_min', 'days_before_max'],
      name: 'idx_policy_days'
    }
  ],
  validate: {
    // 테이블 레벨 검증: days_before_max >= days_before_min
    checkDaysRange() {
      if (this.daysBeforeMax !== null && this.daysBeforeMax < this.daysBeforeMin) {
        throw new Error('days_before_max는 days_before_min보다 크거나 같아야 합니다.');
      }
    }
  }
});

/**
 * days_before 정의:
 * - days_before_max = NULL: "N일 이전" (상한 없음)
 * - days_before_min = 0, days_before_max = 0: "입주일 당일"
 * - days_before_min = 1, days_before_max = 7: "7~1일 이전"
 *
 * 예시:
 * - days_before_min: 15, days_before_max: NULL → "15일 이전" (15일 이상)
 * - days_before_min: 8, days_before_max: 14 → "14~8일 이전"
 * - days_before_min: 0, days_before_max: 0 → "입주일 당일"
 *
 * 계약 당일 취소 규칙:
 * - is_same_day_cancellation = TRUE인 경우, 계약 체결일과 취소일이 같은 날일 때 적용
 * - 정책별로 다른 환불율 설정 가능 (예: 약하게 90%, 보통 80%, 엄격하게 70%)
 */

module.exports = RefundPolicyRule;
