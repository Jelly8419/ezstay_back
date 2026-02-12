/**
 * RoomMemo Model
 * 관리자가 방에 대해 작성하는 메모 정보
 */

const { DataTypes } = require('sequelize');

const RoomMemo = (sequelize) => sequelize.define('RoomMemo', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    comment: '메모 고유 ID'
  },
  roomId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '방 ID (외래키는 models/index.js에서 설정)'
  },
  adminId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '작성한 관리자 ID (외래키는 models/index.js에서 설정)'
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: '메모 내용'
  }
}, {
  tableName: 'room_memos',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      fields: ['room_id'],
      name: 'idx_room_memos_room_id',
      comment: '방별 메모 조회 최적화'
    },
    {
      fields: ['admin_id'],
      name: 'idx_room_memos_admin_id',
      comment: '관리자별 메모 조회 최적화'
    },
    {
      fields: ['created_at'],
      name: 'idx_room_memos_created_at',
      comment: '최신순 정렬 최적화'
    }
  ],
  comment: '방 관리 메모 테이블 (관리자 전용)'
});

module.exports = RoomMemo;
