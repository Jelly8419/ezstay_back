const { DataTypes } = require('sequelize');

/**
 * MoveInRoomStatusHistory 모델
 * 입주 준비 방 심사 상태 변경 이력 (보안 감사 + 호스트 화면 표시용)
 *
 * - 등록 시 SYSTEM 이 PENDING 으로 최초 기록 (previous_status=NULL)
 * - 호스트가 트리거 필드 수정 시 HOST 가 PENDING 으로 재진입 기록
 * - 관리자가 승인/반려 시 ADMIN 이 기록
 */
module.exports = (sequelize) => {
  const MoveInRoomStatusHistory = sequelize.define('MoveInRoomStatusHistory', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },

    moveInRoomId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'move_in_room_id',
      comment: '방 ID'
    },

    adminId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'admin_id',
      comment: '변경한 관리자 ID (SYSTEM/HOST 전이 시 NULL)'
    },

    changedBy: {
      type: DataTypes.ENUM('HOST', 'ADMIN', 'SYSTEM'),
      allowNull: false,
      defaultValue: 'ADMIN',
      field: 'changed_by',
      comment: '변경 주체'
    },

    previousStatus: {
      type: DataTypes.ENUM('PENDING', 'APPROVED', 'REJECTED'),
      allowNull: true,
      field: 'previous_status',
      comment: '변경 전 상태 (최초 등록 시 NULL)'
    },

    newStatus: {
      type: DataTypes.ENUM('PENDING', 'APPROVED', 'REJECTED'),
      allowNull: false,
      field: 'new_status',
      comment: '변경 후 상태'
    },

    reason: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: '반려 사유 또는 재심사 트리거 메모'
    },

    triggeredFields: {
      // MariaDB JSON 컬럼 char-by-char 이슈 회피 (MoveInRoom.beds 와 동일 패턴)
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'triggered_fields',
      comment: '재심사 트리거 필드 목록 (JSON 문자열)',
      get() {
        const raw = this.getDataValue('triggeredFields');
        if (raw == null) return null;
        if (typeof raw === 'object') return raw;
        try { return JSON.parse(raw); } catch { return null; }
      },
      set(val) {
        if (val == null) {
          this.setDataValue('triggeredFields', null);
        } else if (typeof val === 'string') {
          this.setDataValue('triggeredFields', val);
        } else {
          this.setDataValue('triggeredFields', JSON.stringify(val));
        }
      }
    },

    ipAddress: {
      type: DataTypes.STRING(45),
      allowNull: true,
      field: 'ip_address'
    },

    userAgent: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'user_agent'
    },

    changedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'changed_at'
    }
  }, {
    tableName: 'move_in_room_status_histories',
    timestamps: false,
    underscored: true,
    indexes: [
      { fields: ['move_in_room_id', 'changed_at'], name: 'idx_mir_history_room' },
      { fields: ['admin_id'], name: 'idx_mir_history_admin' }
    ]
  });

  return MoveInRoomStatusHistory;
};
