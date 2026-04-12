const { DataTypes } = require('sequelize');

/**
 * ContractCancelRequest 모델 - 임대중 계약 취소요청 관리
 * IN_PROGRESS 상태에서 호스트/게스트가 요청한 취소 건을 별도 테이블로 관리
 */
const ContractCancelRequest = (sequelize) => {
  const model = sequelize.define('ContractCancelRequest', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    contractId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'contract_id'
    },
    requesterRole: {
      type: DataTypes.ENUM('HOST', 'GUEST'),
      allowNull: false,
      field: 'requester_role'
    },
    requesterUserId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'requester_user_id'
    },
    reason: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('PENDING', 'APPROVED', 'REJECTED'),
      allowNull: false,
      defaultValue: 'PENDING'
    },
    adminId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'admin_id'
    },
    adminNote: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'admin_note'
    },
    requestedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: 'requested_at'
    },
    processedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'processed_at'
    }
  }, {
    tableName: 'contract_cancel_requests',
    timestamps: false,
    indexes: [
      { fields: ['contract_id'], name: 'idx_contract_id' },
      { fields: ['status'], name: 'idx_status' },
      { fields: ['requested_at'], name: 'idx_requested_at' },
      { fields: ['requester_role'], name: 'idx_requester_role' }
    ]
  });

  return model;
};

module.exports = ContractCancelRequest;
