const { DataTypes, Sequelize } = require('sequelize');

const sequelize = new Sequelize('ezstay', process.env.DB_USER || 'root', process.env.DB_PASSWORD || '', {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  dialect: 'mysql',
  timezone: '+09:00',
  dialectOptions: {
    timezone: '+09:00'
  },
  logging: false
});

/**
 * Refund 모델 - 환불 요청 및 처리 이력
 * 게스트의 계약 취소 및 환불 요청, 관리자 승인/거절, 환불 처리 이력 관리
 */
const Refund = sequelize.define('Refund', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  contractId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'contract_id',
    comment: '계약 ID'
    // references 옵션 제거 - models/index.js에서 belongsTo로 관계 설정
  },
  refundStatus: {
    type: DataTypes.ENUM(
      'REQUESTED',        // 환불 요청
      'CALCULATING',      // 계산 중
      'APPROVED',         // 승인됨
      'REJECTED',         // 거절됨
      'PROCESSING',       // 처리 중
      'COMPLETED',        // 완료
      'FAILED'            // 실패
    ),
    allowNull: false,
    defaultValue: 'REQUESTED',
    field: 'refund_status',
    comment: '환불 상태'
  },

  // 환불 계산 정보
  policyTypeUsed: {
    type: DataTypes.STRING(50),
    allowNull: false,
    field: 'policy_type_used',
    comment: '적용된 정책 타입'
  },
  cancellationDate: {
    type: DataTypes.DATE,
    allowNull: false,
    field: 'cancellation_date',
    comment: '취소 시점'
  },
  checkInDate: {
    type: DataTypes.DATE,
    allowNull: false,
    field: 'check_in_date',
    comment: '입주 예정일'
  },
  daysBeforeCheckin: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'days_before_checkin',
    comment: '입주일까지 남은 일수',
    validate: {
      min: 0
    }
  },

  // 원본 금액
  originalRentalFee: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'original_rental_fee',
    comment: '원본 임대료',
    validate: {
      min: 0
    }
  },
  originalCleaningFee: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'original_cleaning_fee',
    comment: '원본 청소비',
    validate: {
      min: 0
    }
  },
  originalMaintenanceFee: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'original_maintenance_fee',
    comment: '원본 관리비',
    validate: {
      min: 0
    }
  },
  originalTotalAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'original_total_amount',
    comment: '원본 총액',
    validate: {
      min: 0
    }
  },

  // 환불 금액 (계산 결과)
  rentalFeeRefundRate: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    field: 'rental_fee_refund_rate',
    comment: '임대료 환불율 (%)',
    validate: {
      min: 0,
      max: 100
    }
  },
  rentalFeeRefundAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'rental_fee_refund_amount',
    comment: '임대료 환불액',
    validate: {
      min: 0
    }
  },
  cleaningFeeRefundAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'cleaning_fee_refund_amount',
    comment: '청소비 환불액',
    validate: {
      min: 0
    }
  },
  maintenanceFeeRefundAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'maintenance_fee_refund_amount',
    comment: '관리비 환불액',
    validate: {
      min: 0
    }
  },
  totalRefundAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'total_refund_amount',
    comment: '총 환불액',
    validate: {
      min: 0
    }
  },

  // 수수료 및 공제액
  platformFeeDeducted: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'platform_fee_deducted',
    comment: '플랫폼 수수료 공제',
    validate: {
      min: 0
    }
  },
  penaltyAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'penalty_amount',
    comment: '위약금',
    validate: {
      min: 0
    }
  },
  finalRefundAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'final_refund_amount',
    comment: '최종 환불액 (총 환불액 - 수수료 - 위약금)',
    validate: {
      min: 0
    }
  },

  // 환불 처리 정보
  refundMethod: {
    type: DataTypes.ENUM('ORIGINAL_PAYMENT', 'BANK_TRANSFER'),
    allowNull: true,
    field: 'refund_method',
    comment: '환불 방법'
  },
  refundAccountInfo: {
    type: DataTypes.JSON,
    allowNull: true,
    field: 'refund_account_info',
    comment: '환불 계좌 정보',
    get() {
      const rawValue = this.getDataValue('refundAccountInfo');
      return typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
    }
  },

  // 사유 및 메시지
  cancellationReason: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'cancellation_reason',
    comment: '취소 사유'
  },
  rejectionReason: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'rejection_reason',
    comment: '환불 거절 사유'
  },
  adminNotes: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'admin_notes',
    comment: '관리자 메모'
  },

  // 타임스탬프
  requestedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'requested_at',
    comment: '요청 시점'
  },
  approvedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'approved_at',
    comment: '승인 시점'
  },
  rejectedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'rejected_at',
    comment: '거절 시점'
  },
  completedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'completed_at',
    comment: '완료 시점'
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
  tableName: 'refunds',
  timestamps: true,
  underscored: false,
  indexes: [
    {
      fields: ['contract_id'],
      name: 'idx_contract'
    },
    {
      fields: ['refund_status'],
      name: 'idx_status'
    },
    {
      fields: ['requested_at'],
      name: 'idx_requested_at'
    }
  ],
  validate: {
    // 테이블 레벨 검증: final_refund_amount <= total_refund_amount
    checkRefundAmounts() {
      if (this.finalRefundAmount > this.totalRefundAmount) {
        throw new Error('최종 환불액은 총 환불액을 초과할 수 없습니다.');
      }
    }
  }
});

/**
 * 환불 상태 한글명 매핑
 */
Refund.STATUS_LABELS = {
  REQUESTED: '환불 요청',
  CALCULATING: '계산 중',
  APPROVED: '승인됨',
  REJECTED: '거절됨',
  PROCESSING: '처리 중',
  COMPLETED: '완료',
  FAILED: '실패'
};

/**
 * 환불 방법 한글명 매핑
 */
Refund.METHOD_LABELS = {
  ORIGINAL_PAYMENT: '원결제 수단으로 환불',
  BANK_TRANSFER: '계좌 이체'
};

module.exports = Refund;
