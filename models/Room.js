const { DataTypes } = require('sequelize');
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize('ezstay', process.env.DB_USER || 'root', process.env.DB_PASSWORD || '', {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  dialect: 'mysql'
});

const Room = sequelize.define('Room', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  hostId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  // 기본 정보
  roomName: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  address: {
    type: DataTypes.STRING(500),
    allowNull: false
  },
  detailAddress: {
    type: DataTypes.STRING(500),
    allowNull: false
  },
  latitude: {
    type: DataTypes.DECIMAL(10, 8),
    allowNull: true,
    comment: '위도 (WGS84)'
  },
  longitude: {
    type: DataTypes.DECIMAL(11, 8),
    allowNull: true,
    comment: '경도 (WGS84)'
  },
  area: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    validate: {
      min: 0
    }
  },
  floor: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  buildingType: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  parkingAvailable: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  parkingInfo: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  elevatorAvailable: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  roomCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: {
      min: 0
    }
  },
  bathroomCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: {
      min: 0
    }
  },
  livingRoomCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: {
      min: 0
    }
  },
  kitchenCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: {
      min: 0
    }
  },
  isDuplex: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  entrancePassword: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  // 요금 정보 (1일 기준)
  dailyRent: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'daily_rent',
    comment: '1일 임대료',
    validate: {
      min: 1000,
      max: 10000000,
      isMultipleOf1000(value) {
        if (value && value % 1000 !== 0) {
          throw new Error('임대료는 1,000원 단위로만 입력 가능합니다.');
        }
      }
    }
  },
  dailyMaintenanceFee: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'daily_maintenance_fee',
    comment: '1일 관리비',
    validate: {
      min: 0,
      max: 10000000,
      isMultipleOf1000(value) {
        if (value && value % 1000 !== 0) {
          throw new Error('관리비는 1,000원 단위로만 입력 가능합니다.');
        }
      }
    }
  },
  maintenanceDetail: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  longTermWeeks: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'long_term_weeks',
    comment: '장기 할인 기준 주수'
  },
  longTermDiscount: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '장기 할인율 (%)'
  },
  quickMoveIn: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  quickMoveInDiscount: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '빠른 입주 할인율 (%)'
  },
  includeElectricity: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  includeWater: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  includeGas: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  includeInternet: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  cleaningFee: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '청소비 (1회)'
  },
  minContractWeeks: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'min_contract_weeks',
    comment: '최소 계약 주수'
  },
  refundPolicy: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  // 방 소개
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  transportation: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  houseRules: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  // 상태 관리
  status: {
    type: DataTypes.ENUM('draft', 'pending_review', 'approved', 'rejected', 'published'),
    allowNull: false,
    defaultValue: 'draft'
  },
  submittedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  approvedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  publishedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  rejectionReason: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '매물 반려 사유'
  }
}, {
  tableName: 'rooms',
  timestamps: true,
  underscored: true
});

module.exports = { Room, sequelize };