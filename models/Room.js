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
  buildingType: {
    type: DataTypes.ENUM('아파트', '오피스텔', '빌라', '주택', '원룸', '기타'),
    allowNull: false
  },
  parkingAvailable: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
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
  hostId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id'
    }
  }
}, {
  tableName: 'rooms',
  timestamps: true,
  underscored: true
});

module.exports = { Room, sequelize };