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
    primaryKey: true
    // references 옵션 제거 - models/index.js에서 belongsTo로 관계 설정
  },
  basicOptions: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: {},
    comment: '기본 편의시설 (침대 정보 포함 가능: { "침대": { "킹": 3, "퀸": 0, "싱글": 1, "슈퍼싱글": 2 } })'
  },
  additionalOptions: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: {},
    comment: '추가 옵션 (petsAllowed 포함 가능)'
  },
  convenienceOptions: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: {}
  },
  wifiPassword: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: '와이파이 비밀번호 (호스트 제공 정보)'
  }
}, {
  tableName: 'room_amenities',
  timestamps: true,
  underscored: true
});

module.exports = { RoomAmenity, sequelize };
