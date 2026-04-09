const { DataTypes } = require('sequelize');
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(process.env.DB_NAME || 'ezstay', process.env.DB_USER || 'root', process.env.DB_PASSWORD || '', {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  dialect: 'mysql',
  logging: false
});

const RoomPhoto = sequelize.define('RoomPhoto', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  roomId: {
    type: DataTypes.INTEGER,
    allowNull: false
    // references 옵션 제거 - models/index.js에서 belongsTo로 관계 설정
  },
  url: {
    type: DataTypes.STRING(500),
    allowNull: false
  },
  order: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  }
}, {
  tableName: 'room_photos',
  timestamps: true,
  underscored: true
});

module.exports = { RoomPhoto, sequelize };
