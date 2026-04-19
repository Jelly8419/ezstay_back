const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

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
    comment: '추가 옵션 (도어락, CCTV, 가구 등)'
  },
  convenienceOptions: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: {},
    comment: '편의 옵션 (냉난방기, 공기청정기, 주방용품 등)'
  },
  petsAllowed: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: '반려동물 동반 가능 여부'
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

module.exports = { RoomAmenity };
