/**
 * RoomPasswordHistory Model
 * 방 비밀번호 변경 이력 (보안 감사 및 추적용)
 */

const { DataTypes } = require('sequelize');

const RoomPasswordHistory = (sequelize) => sequelize.define('RoomPasswordHistory', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    comment: '이력 고유 ID'
  },
  roomId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '방 ID (외래키는 models/index.js에서 설정)'
  },
  adminId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '변경한 관리자 ID (외래키는 models/index.js에서 설정)'
  },
  previousPassword: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: '변경 전 비밀번호 (최초 설정 시 null)'
  },
  newPassword: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: '변경 후 비밀번호'
  },
  reason: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: '변경 사유 (예: 호스트 분실 신고, 게스트 체크아웃 후 변경)'
  },
  ipAddress: {
    type: DataTypes.STRING(45),
    allowNull: true,
    comment: '관리자 IP 주소 (IPv4/IPv6, 보안 감사용)'
  },
  userAgent: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: '관리자 브라우저/디바이스 정보 (보안 감사용)'
  },
  changedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    comment: '비밀번호 변경 시각'
  }
}, {
  tableName: 'room_password_histories',
  timestamps: false,
  underscored: true,
  indexes: [
    {
      fields: ['room_id', 'changed_at'],
      name: 'idx_room_password_history_room_time',
      comment: '방별 비밀번호 변경 이력 조회 최적화'
    },
    {
      fields: ['admin_id'],
      name: 'idx_room_password_history_admin',
      comment: '관리자별 비밀번호 변경 이력 조회'
    },
    {
      fields: ['changed_at'],
      name: 'idx_room_password_history_time',
      comment: '시간순 정렬 최적화'
    }
  ],
  comment: '방 비밀번호 변경 이력 테이블 (보안 감사용)'
});

module.exports = RoomPasswordHistory;
