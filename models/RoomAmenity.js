const { DataTypes } = require('sequelize');
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize('ezstay', process.env.DB_USER || 'root', process.env.DB_PASSWORD || '', {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  dialect: 'mysql',
  logging: false
});

const RoomAmenity = sequelize.define('RoomAmenity', {
  roomId: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    references: {
      model: 'rooms',
      key: 'id'
    },
    onDelete: 'CASCADE'
  },
  basicOptions: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: {}
  },
  additionalOptions: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: {}
  },
  convenienceOptions: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: {}
  },
  petsAllowed: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  }
}, {
  tableName: 'room_amenities',
  timestamps: true,
  underscored: true
});

module.exports = { RoomAmenity, sequelize };
