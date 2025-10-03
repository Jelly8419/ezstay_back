const { DataTypes } = require('sequelize');
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize('livemoment', process.env.DB_USER || 'root', process.env.DB_PASSWORD || '', {
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
  // 요금 정보
  weeklyRent: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  longTermWeeks: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  longTermDiscount: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  quickMoveIn: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  quickMoveInDiscount: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  maintenanceFee: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  maintenanceDetail: {
    type: DataTypes.STRING(500),
    allowNull: true
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
    allowNull: true
  },
  minContractWeeks: {
    type: DataTypes.INTEGER,
    allowNull: true
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
  }
}, {
  tableName: 'rooms',
  timestamps: true,
  underscored: true
});

module.exports = { Room, sequelize };