const { DataTypes } = require('sequelize');

/**
 * PayoutLog 모델 - 지급 상태 변경 이력
 *
 * 지급 건의 상태 변경 시마다 이력을 기록합니다.
 * 회계 추적 및 감사(audit) 목적으로 사용됩니다.
 */
module.exports = (sequelize) => {
  const PayoutLog = sequelize.define('PayoutLog', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    payoutId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'payout_id',
      comment: '지급 ID'
    },
    fromStatus: {
      type: DataTypes.STRING(20),
      allowNull: true,
      field: 'from_status',
      comment: '변경 전 상태'
    },
    toStatus: {
      type: DataTypes.STRING(20),
      allowNull: false,
      field: 'to_status',
      comment: '변경 후 상태'
    },
    adminId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'admin_id',
      comment: '변경한 관리자 ID (스케줄러 자동 변경 시 null)'
    },
    note: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: '변경 사유 메모'
    },
    changedBy: {
      type: DataTypes.ENUM('ADMIN', 'SYSTEM'),
      allowNull: false,
      defaultValue: 'SYSTEM',
      field: 'changed_by',
      comment: '변경 주체'
    }
  }, {
    tableName: 'payout_logs',
    timestamps: true,
    updatedAt: false,
    underscored: true,
    indexes: [
      { fields: ['payout_id'], name: 'idx_payout_log_payout_id' }
    ]
  });

  return PayoutLog;
};
