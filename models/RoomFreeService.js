const { DataTypes } = require('sequelize');
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize('livemoment', process.env.DB_USER || 'root', process.env.DB_PASSWORD || '', {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  dialect: 'mysql'
});

const RoomFreeService = sequelize.define('RoomFreeService', {
  roomId: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    references: {
      model: 'rooms',
      key: 'id'
    },
    onDelete: 'CASCADE'
  },
  agreeTerms: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  cleaningService: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  cleaningToolImageUrl: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  hairDryerRental: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  beddingService: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  bedSizeSuperSingle: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  bedSizeQueen: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  bedSizeKing: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  amenityKit: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  towelSetRental: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'towel_set_rental'
  },
  autoPasswordChange: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  roomPassword: {
    type: DataTypes.STRING(100),
    allowNull: true
  }
}, {
  tableName: 'room_free_services',
  timestamps: true,
  underscored: true
});

module.exports = { RoomFreeService, sequelize };
