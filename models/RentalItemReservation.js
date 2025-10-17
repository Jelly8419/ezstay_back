const { DataTypes, Sequelize } = require('sequelize');

const sequelize = new Sequelize('livemoment', process.env.DB_USER || 'root', process.env.DB_PASSWORD || '', {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  dialect: 'mysql'
});

/**
 * RentalItemReservation 모델 - 렌탈 아이템 예약 기록
 * 계약에 포함된 렌탈 아이템의 예약 정보를 관리하여 재고를 추적
 */
const RentalItemReservation = sequelize.define('RentalItemReservation', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  contractId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'contract_id',
    references: {
      model: 'contracts',
      key: 'id'
    },
    comment: '계약 ID'
  },
  rentalItemId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'rental_item_id',
    references: {
      model: 'rental_items',
      key: 'id'
    },
    comment: '렌탈 아이템 ID'
  },
  quantity: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '예약 수량',
    validate: {
      min: 1
    }
  },
  pricePerItem: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    field: 'price_per_item',
    comment: '아이템당 가격 (예약 당시 가격)',
    validate: {
      min: 0
    }
  },
  totalPrice: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    field: 'total_price',
    comment: '총 가격 (수량 * 아이템당 가격)',
    validate: {
      min: 0
    }
  },
  reservedFrom: {
    type: DataTypes.DATE,
    allowNull: false,
    field: 'reserved_from',
    comment: '예약 시작일 (체크인 날짜)'
  },
  reservedUntil: {
    type: DataTypes.DATE,
    allowNull: false,
    field: 'reserved_until',
    comment: '예약 종료일 (체크아웃 날짜)'
  },
  status: {
    type: DataTypes.ENUM('RESERVED', 'CONFIRMED', 'COMPLETED', 'CANCELLED'),
    allowNull: false,
    defaultValue: 'RESERVED',
    comment: '예약 상태'
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
  tableName: 'rental_item_reservations',
  timestamps: true,
  underscored: false,
  indexes: [
    {
      fields: ['contract_id'],
      name: 'idx_contract_id'
    },
    {
      fields: ['rental_item_id'],
      name: 'idx_rental_item_id'
    },
    {
      fields: ['status'],
      name: 'idx_status'
    },
    {
      fields: ['reserved_from', 'reserved_until'],
      name: 'idx_reservation_period'
    }
  ]
});

/**
 * 예약 상태 한글명 매핑
 */
RentalItemReservation.STATUS_LABELS = {
  RESERVED: '예약됨',
  CONFIRMED: '확정됨',
  COMPLETED: '완료됨',
  CANCELLED: '취소됨'
};

module.exports = RentalItemReservation;
