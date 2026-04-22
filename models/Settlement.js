const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

/**
 * Settlement 모델 - 정산 정보
 * 계약 완료 후 호스트에게 정산될 금액과 상태를 관리
 *
 * 정책: 입주일(checkInDate) + 3영업일에 정산 예정
 * (향후 토스 서브몰 연동 시 실제 정산 처리)
 */
const Settlement = sequelize.define('Settlement', {
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
  hostId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'host_id',
    comment: '호스트 ID'
  },

  // 정산 상태
  status: {
    type: DataTypes.ENUM(
      'PENDING',       // 정산 대기 (계약 진행 중, 아직 정산일 도래 안 함)
      'READY',         // 정산 가능 (정산 예정일 도래, 토스 서브몰 정산 가능)
      'PROCESSING',    // 정산 처리 중 (토스 서브몰 처리 중)
      'COMPLETED',     // 정산 완료
      'ON_HOLD',       // 정산 보류 (분쟁, 관리자 조치)
      'FAILED'         // 정산 실패 (재시도 필요)
    ),
    allowNull: false,
    defaultValue: 'PENDING',
    comment: '정산 상태'
  },

  // 정산 금액 정보
  rentalFee: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'rental_fee',
    comment: '임대료'
  },
  maintenanceFee: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'maintenance_fee',
    comment: '관리비'
  },
  cleaningFee: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'cleaning_fee',
    comment: '청소비 (EZ청소서비스 사용 시 0)'
  },
  hostPlatformFee: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'host_platform_fee',
    comment: '호스트 플랫폼 수수료 (3.3% VAT 포함 총액)'
  },
  hostPlatformFeeSupply: {
    type: DataTypes.BIGINT,
    allowNull: false,
    defaultValue: 0,
    field: 'host_platform_fee_supply',
    comment: '호스트 수수료 공급가액 (round(hostPlatformFee × 10/11))'
  },
  hostPlatformFeeVat: {
    type: DataTypes.BIGINT,
    allowNull: false,
    defaultValue: 0,
    field: 'host_platform_fee_vat',
    comment: '호스트 수수료 부가세 (hostPlatformFee - hostPlatformFeeSupply)'
  },
  refundDeduction: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'refund_deduction',
    comment: '환불 차감액'
  },
  grossAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'gross_amount',
    comment: '정산 총액 (수수료 차감 전)'
  },
  netAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'net_amount',
    comment: '실 정산 금액 (수수료/환불 차감 후, 호스트 수령액)'
  },

  // 정산 일정
  expectedDate: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    field: 'expected_date',
    comment: '정산 예정일 (입주일 + 3영업일)'
  },
  completedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'completed_at',
    comment: '정산 완료 시점'
  },

  // 관리자 관리
  note: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '관리자 메모 (보류 사유 등)'
  },
  adminId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'admin_id',
    comment: '처리한 관리자 ID'
  },

  // PG 정산 확인 정보 (관리자가 PG사 정산 입금 확인 시 기록)
  pgSettledAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'pg_settled_at',
    comment: 'PG 정산 입금 확인 시각 (관리자 확인 시점)'
  },
  pgSettledConfirmedBy: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'pg_settled_confirmed_by',
    comment: 'PG 정산 확인한 관리자 ID'
  },
  payoutAvailableDate: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    field: 'payout_available_date',
    comment: '지급 가능 최소 날짜 (결제 승인일 + 3영업일, Payout.payableAfter와 동기화)'
  },

  // 토스 서브몰 연동 정보 (향후 사용)
  tossData: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'toss_data',
    comment: '토스 서브몰 정산 데이터 (JSON)',
    get() {
      const rawValue = this.getDataValue('tossData');
      return rawValue ? JSON.parse(rawValue) : null;
    },
    set(value) {
      this.setDataValue('tossData', value ? JSON.stringify(value) : null);
    }
  },

  // 정산 스냅샷 (정산 시점의 계약/금액 정보 보존)
  settlementSnapshot: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'settlement_snapshot',
    comment: '정산 시점 스냅샷 (JSON)',
    get() {
      const rawValue = this.getDataValue('settlementSnapshot');
      return rawValue ? JSON.parse(rawValue) : null;
    },
    set(value) {
      this.setDataValue('settlementSnapshot', value ? JSON.stringify(value) : null);
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
  tableName: 'settlements',
  timestamps: true,
  underscored: false,
  indexes: [
    {
      fields: ['contract_id'],
      unique: true,
      name: 'idx_settlement_contract_id',
      comment: '계약당 1개의 정산 레코드'
    },
    {
      fields: ['host_id'],
      name: 'idx_settlement_host_id'
    },
    {
      fields: ['status'],
      name: 'idx_settlement_status'
    },
    {
      fields: ['expected_date'],
      name: 'idx_settlement_expected_date',
      comment: '정산 예정일 조회 최적화'
    },
    {
      fields: ['status', 'expected_date'],
      name: 'idx_settlement_status_date',
      comment: '정산 스케줄러 조회 최적화'
    }
  ]
});

/**
 * 정산 상태 한글명 매핑
 */
Settlement.STATUS_LABELS = {
  PENDING: '정산 대기',
  READY: '정산 가능',
  PROCESSING: '정산 처리 중',
  COMPLETED: '정산 완료',
  ON_HOLD: '정산 보류',
  FAILED: '정산 실패'
};

module.exports = Settlement;
