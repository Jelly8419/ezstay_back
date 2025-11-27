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
 * Contract 모델 - 계약 정보
 * 게스트가 호스트에게 방 계약 승인을 요청하고, 호스트가 승인/거절하는 계약 정보를 관리
 */
const Contract = sequelize.define('Contract', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  orderId: {
    type: DataTypes.STRING(11),
    allowNull: false,
    unique: true,
    field: 'order_id',
    comment: '계약 주문번호 (yymmdd + 5자리 숫자)'
  },
  roomId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'room_id',
    comment: '방 ID'
    // references 옵션 제거 - models/index.js에서 belongsTo로 관계 설정
  },
  hostId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'host_id',
    comment: '호스트 ID'
    // references 옵션 제거 - models/index.js에서 belongsTo로 관계 설정
  },
  guestId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'guest_id',
    comment: '게스트 ID'
    // references 옵션 제거 - models/index.js에서 belongsTo로 관계 설정
  },

  // 체크인/체크아웃 정보
  checkInDate: {
    type: DataTypes.DATE,
    allowNull: false,
    field: 'check_in_date',
    comment: '체크인 날짜 및 시간'
  },
  checkOutDate: {
    type: DataTypes.DATE,
    allowNull: false,
    field: 'check_out_date',
    comment: '체크아웃 날짜 및 시간'
  },
  totalDays: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'total_days',
    comment: '총 숙박 일수',
    validate: {
      min: 1
    }
  },
  totalWeeks: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'total_weeks',
    comment: '총 숙박 주수 (할인 계산용)',
    validate: {
      min: 0
    }
  },

  // 금액 정보 (단위: 원)
  rentalFee: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'rental_fee',
    comment: '임대료 (일일 임대료 * 계약 일수)',
    validate: {
      min: 0
    }
  },
  maintenanceFee: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'maintenance_fee',
    comment: '관리비 (일일 관리비 * 계약 일수)',
    validate: {
      min: 0
    }
  },
  cleaningFee: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'cleaning_fee',
    comment: '청소비용 (1회)',
    validate: {
      min: 0
    }
  },
  rentalItemsFee: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'rental_items_fee',
    comment: '렌탈 아이템 비용',
    validate: {
      min: 0
    }
  },
  platformFee: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'platform_fee',
    comment: '플랫폼 수수료',
    validate: {
      min: 0
    }
  },
  discountAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'discount_amount',
    comment: '할인 금액',
    validate: {
      min: 0
    }
  },
  discountType: {
    type: DataTypes.ENUM('NONE', 'LONG_TERM_DISCOUNT', 'QUICK_MOVE_IN', 'COUPON', 'PROMOTIONAL'),
    allowNull: true,
    field: 'discount_type',
    comment: '할인 유형'
  },
  discountCode: {
    type: DataTypes.STRING(50),
    allowNull: true,
    field: 'discount_code',
    comment: '쿠폰 코드 (사용된 경우)'
  },

  // 계산된 금액
  subtotal: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'subtotal',
    comment: '소계 (할인 전)',
    validate: {
      min: 0
    }
  },
  totalUsageFee: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'total_usage_fee',
    comment: '실이용 금액 (할인 적용 후, 수수료 포함)',
    validate: {
      min: 0
    }
  },
  deposit: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'deposit',
    comment: '보증금',
    validate: {
      min: 0
    }
  },
  finalTotalAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'final_total_amount',
    comment: '최종 결제 금액 (실이용 + 보증금)',
    validate: {
      min: 0
    }
  },

  // 렌탈 아이템 정보 (JSON 저장)
  rentalItems: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'rental_items',
    comment: '선택한 렌탈 아이템 정보 (JSON)',
    get() {
      const rawValue = this.getDataValue('rentalItems');
      return rawValue ? JSON.parse(rawValue) : {};
    },
    set(value) {
      this.setDataValue('rentalItems', JSON.stringify(value));
    }
  },

  // 호스트 권장 렌탈 아이템 (JSON 저장)
  recommendedItems: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'recommended_items',
    comment: '호스트가 권장하는 렌탈 아이템 목록 (JSON)',
    get() {
      const rawValue = this.getDataValue('recommendedItems');
      return rawValue ? JSON.parse(rawValue) : null;
    },
    set(value) {
      this.setDataValue('recommendedItems', value ? JSON.stringify(value) : null);
    }
  },

  // 결제 정보
  paymentMethod: {
    type: DataTypes.ENUM('CREDIT_CARD', 'BANK_TRANSFER', 'SIMPLE_PAY'),
    allowNull: true,
    field: 'payment_method',
    comment: '결제 수단'
  },
  installmentMonths: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'installment_months',
    comment: '할부 개월 수 (0이면 일시불)',
    validate: {
      min: 0,
      max: 12
    }
  },

  // 메시지 및 요청사항
  guestMessage: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'guest_message',
    comment: '게스트 메시지 (계약 요청 시 전달 메시지)'
  },
  hostMessage: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'host_message',
    comment: '호스트 응답 메시지'
  },
  cancellationReason: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'cancellation_reason',
    comment: '취소/거절 사유'
  },

  // 특별 요청사항 (JSON 저장)
  specialRequests: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'special_requests',
    comment: '특별 요청사항 (JSON)',
    get() {
      const rawValue = this.getDataValue('specialRequests');
      return rawValue ? JSON.parse(rawValue) : {};
    },
    set(value) {
      this.setDataValue('specialRequests', JSON.stringify(value));
    }
  },

  // 약관 동의 정보 (JSON 저장)
  termsAgreed: {
    type: DataTypes.TEXT,
    allowNull: false,
    field: 'terms_agreed',
    comment: '약관 동의 정보 (JSON)',
    get() {
      const rawValue = this.getDataValue('termsAgreed');
      return rawValue ? JSON.parse(rawValue) : {};
    },
    set(value) {
      this.setDataValue('termsAgreed', JSON.stringify(value));
    }
  },

  // 가격 스냅샷 (분쟁 대비)
  pricingSnapshot: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'pricing_snapshot',
    comment: '가격 정책 스냅샷 (JSON)',
    get() {
      const rawValue = this.getDataValue('pricingSnapshot');
      return rawValue ? JSON.parse(rawValue) : {};
    },
    set(value) {
      this.setDataValue('pricingSnapshot', JSON.stringify(value));
    }
  },

  // 환불정책 스냅샷 (계약 시점의 정책 보존)
  refundPolicyType: {
    type: DataTypes.STRING(50),
    allowNull: true,
    field: 'refund_policy_type',
    comment: '계약 시점의 환불정책 타입 (약하게, 보통, 엄격하게)'
  },
  refundPolicySnapshot: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'refund_policy_snapshot',
    comment: '계약 시점의 환불정책 상세 규칙 (JSON)',
    get() {
      const rawValue = this.getDataValue('refundPolicySnapshot');
      return rawValue ? JSON.parse(rawValue) : null;
    },
    set(value) {
      this.setDataValue('refundPolicySnapshot', value ? JSON.stringify(value) : null);
    }
  },

  // 계약 상태
  status: {
    type: DataTypes.ENUM(
      'PENDING_APPROVAL',              // 승인 대기
      'APPROVED',                      // 승인됨 (결제 대기)
      'REJECTED',                      // 거절됨
      'PAYMENT_COMPLETED',             // 결제 완료
      'IN_PROGRESS',                   // 계약 진행중 (체크인 완료)
      'COMPLETED',                     // 계약 완료 (체크아웃 완료)
      'CANCELLED_BY_GUEST',            // 게스트 취소
      'CANCELLED_BY_HOST',             // 호스트 취소
      'CANCELLED_BY_ADMIN_WITH_REFUND', // 관리자 취소 (환불 O)
      'CANCELLED_BY_ADMIN_NO_REFUND',   // 관리자 취소 (환불 X)
      'REFUNDED',                      // 환불 완료
      'APPROVAL_EXPIRED',              // 미승인 만료
      'PAYMENT_EXPIRED'                // 미결제 만료
    ),
    allowNull: false,
    defaultValue: 'PENDING_APPROVAL',
    comment: '계약 상태'
  },

  // 취소 상세 정보
  cancellationType: {
    type: DataTypes.ENUM(
      'BEFORE_PAYMENT',    // 결제 전 취소
      'AFTER_PAYMENT',     // 결제 후 취소 (체크인 전)
      'DURING_STAY',       // 입실 중 취소
      'AFTER_COMPLETION'   // 완료 후 취소 (분쟁 등)
    ),
    allowNull: true,
    field: 'cancellation_type',
    comment: '취소 유형 (취소된 경우에만 값 존재)'
  },
  cancelledByAdminId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'cancelled_by_admin_id',
    comment: '취소한 관리자 ID (관리자 취소인 경우)'
  },

  // 계약 진행 시점 기록
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
  paidAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'paid_at',
    comment: '결제 완료 시점'
  },
  checkedInAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'checked_in_at',
    comment: '체크인 완료 시점'
  },
  checkedOutAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'checked_out_at',
    comment: '체크아웃 완료 시점'
  },
  cancelledAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'cancelled_at',
    comment: '취소 시점'
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
  tableName: 'contracts',
  timestamps: true,
  underscored: false,
  indexes: [
    {
      fields: ['room_id'],
      name: 'idx_room_id'
    },
    {
      fields: ['host_id'],
      name: 'idx_host_id'
    },
    {
      fields: ['guest_id'],
      name: 'idx_guest_id'
    },
    {
      fields: ['status'],
      name: 'idx_status'
    },
    {
      fields: ['check_in_date'],
      name: 'idx_check_in_date'
    },
    {
      fields: ['check_out_date'],
      name: 'idx_check_out_date'
    },
    {
      fields: ['created_at'],
      name: 'idx_created_at'
    },
    {
      fields: ['status', 'check_out_date', 'check_in_date'],
      name: 'idx_status_dates',
      comment: '지도 검색 시 예약 가능 여부 조회 최적화 (getUnavailableRoomIds)'
    },
    {
      fields: ['cancellation_type'],
      name: 'idx_cancellation_type'
    },
    {
      fields: ['cancelled_by_admin_id'],
      name: 'idx_cancelled_by_admin'
    },
    {
      fields: ['refund_policy_type'],
      name: 'idx_refund_policy_type'
    }
  ]
});

/**
 * 계약 상태 한글명 매핑
 */
Contract.STATUS_LABELS = {
  PENDING_APPROVAL: '승인 대기',
  APPROVED: '승인됨',
  REJECTED: '거절됨',
  PAYMENT_COMPLETED: '결제 완료',
  IN_PROGRESS: '계약 진행중',
  COMPLETED: '계약 완료',
  CANCELLED_BY_GUEST: '게스트 취소',
  CANCELLED_BY_HOST: '호스트 취소',
  CANCELLED_BY_ADMIN_WITH_REFUND: '관리자 취소 (환불)',
  CANCELLED_BY_ADMIN_NO_REFUND: '관리자 취소 (환불 없음)',
  REFUNDED: '환불 완료',
  APPROVAL_EXPIRED: '미승인 만료',
  PAYMENT_EXPIRED: '미결제 만료'
};

/**
 * 취소 유형 한글명 매핑
 */
Contract.CANCELLATION_TYPE_LABELS = {
  BEFORE_PAYMENT: '결제 전 취소',
  AFTER_PAYMENT: '결제 후 취소',
  DURING_STAY: '입실 중 취소',
  AFTER_COMPLETION: '완료 후 취소'
};

/**
 * 환불정책 타입 한글명 매핑
 */
Contract.REFUND_POLICY_TYPE_LABELS = {
  flexible: '약하게 (유연)',
  moderate: '보통',
  strict: '엄격하게'
};

/**
 * 할인 유형 한글명 매핑
 */
Contract.DISCOUNT_TYPE_LABELS = {
  NONE: '할인 없음',
  LONG_TERM_DISCOUNT: '장기 할인',
  QUICK_MOVE_IN: '빠른 입주 할인',
  COUPON: '쿠폰 할인',
  PROMOTIONAL: '프로모션 할인'
};

module.exports = Contract;
