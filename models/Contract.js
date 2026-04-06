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
    comment: '게스트 플랫폼 수수료 (9.9%, 게스트가 추가 결제)',
    validate: {
      min: 0
    }
  },
  hostPlatformFee: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'host_platform_fee',
    comment: '호스트 플랫폼 수수료 (3.3%, 정산 시 차감)',
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
    type: DataTypes.ENUM('NONE', 'LONG_TERM_DISCOUNT', 'QUICK_MOVE_IN', 'BOTH'),
    allowNull: true,
    field: 'discount_type',
    comment: '할인 유형'
  },
  // 계산된 금액 (VIRTUAL: DB 저장 없이 항상 실시간 계산)
  subtotal: {
    type: DataTypes.VIRTUAL,
    get() {
      return (this.rentalFee || 0) + (this.maintenanceFee || 0)
           + (this.cleaningFee || 0) + (this.rentalItemsFee || 0);
    },
    comment: '소계 (할인 전) - rentalFee + maintenanceFee + cleaningFee + rentalItemsFee'
  },
  totalUsageFee: {
    type: DataTypes.VIRTUAL,
    get() {
      return (this.subtotal || 0) - (this.discountAmount || 0) + (this.platformFee || 0);
    },
    comment: '실이용 금액 (할인 적용 후, 수수료 포함) - subtotal - discountAmount + platformFee'
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

  // 계약 시점 스냅샷 (방·호스트·게스트 정보 보존, 분쟁 대비)
  snapshot: {
    type: DataTypes.TEXT('medium'),
    allowNull: true,
    field: 'snapshot',
    comment: '계약 시점 스냅샷 (방·호스트·게스트 정보 JSON)',
    get() {
      const rawValue = this.getDataValue('snapshot');
      return rawValue ? JSON.parse(rawValue) : null;
    },
    set(value) {
      this.setDataValue('snapshot', value ? JSON.stringify(value) : null);
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
      'PAYMENT_EXPIRED',               // 미결제 만료
      'CANCEL_REQUESTED'               // 취소 요청 (관리자 승인 대기)
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

  // 퇴실 프로세스 관리
  checkoutRequested: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'checkout_requested',
    comment: '게스트 퇴실 요청 여부'
  },
  checkoutRequestedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'checkout_requested_at',
    comment: '게스트 퇴실 요청 시점'
  },
  hostCheckedOut: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'host_checked_out',
    comment: '호스트 퇴실 확인 여부'
  },
  hostCheckedOutAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'host_checked_out_at',
    comment: '호스트 퇴실 확인 시점'
  },

  // 보증금 정산 관리
  depositDeduction: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'deposit_deduction',
    comment: '보증금 차감 금액',
    validate: {
      min: 0
    }
  },
  deductionReason: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'deduction_reason',
    comment: '보증금 차감 사유'
  },
  refundableDeposit: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'refundable_deposit',
    comment: '반환 가능 보증금 (보증금 - 차감액)'
  },
  depositStatus: {
    type: DataTypes.ENUM('HOLDING', 'RETURN_PENDING', 'RETURN_HOLD', 'RETURN_CONFIRMED', 'DEDUCTION_CONFIRMED', 'RETURNED', 'REFUND_FAILED'),
    allowNull: false,
    defaultValue: 'HOLDING',
    field: 'deposit_status',
    comment: '보증금 상태 (HOLDING=보관중, RETURN_PENDING=반환대기, RETURN_HOLD=반환보류, RETURN_CONFIRMED=반환확정, DEDUCTION_CONFIRMED=차감확정, RETURNED=반환완료, REFUND_FAILED=환불실패)'
  },

  depositReturnedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'deposit_returned_at',
    comment: '보증금 환급 완료 시각 (PG 취소 성공 시점)'
  },

  // 퇴실 세부 상태 (PRD v2)
  checkoutStatus: {
    type: DataTypes.ENUM('NOT_STARTED', 'GUEST_COMPLETED', 'HOST_CONFIRMED', 'HOLD_REQUESTED', 'HOST_PENDING'),
    allowNull: false,
    defaultValue: 'NOT_STARTED',
    field: 'checkout_status',
    comment: '퇴실 세부 상태 (NOT_STARTED=시작전, GUEST_COMPLETED=게스트퇴실완료, HOST_CONFIRMED=호스트확인완료, HOLD_REQUESTED=보류신청대기, HOST_PENDING=보류승인후합의중)'
  },

  // 보증금 보류 관련 필드
  holdRequestedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'hold_requested_at',
    comment: '호스트 보류 신청 시점'
  },
  holdRemainingMs: {
    type: DataTypes.BIGINT,
    allowNull: true,
    field: 'hold_remaining_ms',
    comment: '보류 거절 시 남은 카운트다운(ms)'
  },
  holdApprovedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'hold_approved_at',
    comment: '관리자 보류 승인 시점 (합의 데드라인 기준)'
  },
  holdApprovedByAdminId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'hold_approved_by_admin_id',
    comment: '보류 승인 관리자 ID'
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
    },
    {
      fields: ['checkout_requested', 'checkout_requested_at'],
      name: 'idx_checkout_request',
      comment: '48시간 자동 퇴실확정 스케줄러 최적화'
    },
    {
      fields: ['deposit_status'],
      name: 'idx_deposit_status',
      comment: '보증금 상태 조회 최적화'
    },
    {
      fields: ['checkout_status'],
      name: 'idx_checkout_status',
      comment: '퇴실 세부 상태 조회 최적화 (스케줄러 HOST_PENDING 제외 등)'
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
  PAYMENT_EXPIRED: '미결제 만료',
  CANCEL_REQUESTED: '취소 요청 (관리자 승인 대기)'
};

/**
 * 퇴실 세부 상태 한글명 매핑
 */
Contract.CHECKOUT_STATUS_LABELS = {
  NOT_STARTED: '퇴실 전',
  GUEST_COMPLETED: '게스트 퇴실 완료',
  HOST_CONFIRMED: '호스트 확인 완료',
  HOST_PENDING: '퇴실 확인 보류'
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
  BOTH: '빠른 입주 + 장기 할인'
};

/**
 * 결제 완료 후 finalTotalAmount 변경 차단
 * - previousStatus: 이미 잠긴 상태의 계약에 변경 시도 차단
 * - currentStatus: 잠금 상태로 전환하면서 동시에 금액도 바꾸는 시도 차단
 */
const LOCKED_STATUSES = [
  'PAYMENT_COMPLETED', 'IN_PROGRESS', 'COMPLETED',
  'CANCELLED_BY_GUEST', 'CANCELLED_BY_HOST',
  'CANCELLED_BY_ADMIN_WITH_REFUND', 'CANCELLED_BY_ADMIN_NO_REFUND',
  'REFUNDED', 'APPROVAL_EXPIRED', 'PAYMENT_EXPIRED', 'CANCEL_REQUESTED'
];

Contract.beforeUpdate((contract) => {
  if (contract.changed('finalTotalAmount')) {
    const previousStatus = contract.previous('status');
    const currentStatus = contract.status;
    if (LOCKED_STATUSES.includes(previousStatus) || LOCKED_STATUSES.includes(currentStatus)) {
      throw new Error(
        `[Contract] finalTotalAmount 변경 불가: 결제 완료 이후 상태 (previous=${previousStatus}, current=${currentStatus})`
      );
    }
  }
});

module.exports = Contract;
