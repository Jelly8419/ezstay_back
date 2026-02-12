/**
 * RoomStatusHistory Model
 * 방 게시 상태 변경 이력 (보안 감사 및 추적용)
 */

const { DataTypes } = require('sequelize');

const RoomStatusHistory = (sequelize) => sequelize.define('RoomStatusHistory', {
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
  previousStatus: {
    type: DataTypes.ENUM('draft', 'pending_review', 'approved', 'rejected', 'published', 'hidden_by_admin'),
    allowNull: false,
    comment: '변경 전 상태'
  },
  newStatus: {
    type: DataTypes.ENUM('draft', 'pending_review', 'approved', 'rejected', 'published', 'hidden_by_admin'),
    allowNull: false,
    comment: '변경 후 상태'
  },
  reason: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: '변경 사유 (예: 부적절한 콘텐츠, 호스트 요청, 임시 숨김)'
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
    comment: '상태 변경 시각'
  }
}, {
  tableName: 'room_status_histories',
  timestamps: false,
  underscored: true,
  indexes: [
    {
      fields: ['room_id', 'changed_at'],
      name: 'idx_room_status_history_room_time',
      comment: '방별 상태 변경 이력 조회 최적화'
    },
    {
      fields: ['admin_id'],
      name: 'idx_room_status_history_admin',
      comment: '관리자별 상태 변경 이력 조회'
    },
    {
      fields: ['changed_at'],
      name: 'idx_room_status_history_time',
      comment: '시간순 정렬 최적화'
    },
    {
      fields: ['new_status'],
      name: 'idx_room_status_history_new_status',
      comment: '특정 상태로 변경된 이력 조회'
    }
  ],
  comment: '방 게시 상태 변경 이력 테이블 (보안 감사용)'
});

module.exports = RoomStatusHistory;
