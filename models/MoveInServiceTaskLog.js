const { DataTypes } = require('sequelize');

/**
 * MoveInServiceTaskLog 모델
 * MoveInServiceTask 상태 변경 이력
 * - 기존 ServiceTaskLog와 동일 패턴, FK만 신규 테이블 참조
 */
module.exports = (sequelize) => {
  const MoveInServiceTaskLog = sequelize.define('MoveInServiceTaskLog', {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true
    },

    serviceTaskId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'service_task_id',
      comment: 'move_in_service_tasks.id'
    },

    caseId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'case_id',
      comment: '케이스 ID (빠른 조회용)'
    },

    fromStatus: {
      type: DataTypes.STRING(20),
      allowNull: true,
      field: 'from_status',
      comment: '변경 전 상태 (NULL=최초 생성)'
    },

    toStatus: {
      type: DataTypes.STRING(20),
      allowNull: false,
      field: 'to_status',
      comment: '변경 후 상태'
    },

    changedBy: {
      type: DataTypes.ENUM('ADMIN', 'SYSTEM'),
      allowNull: false,
      defaultValue: 'ADMIN',
      field: 'changed_by'
    },

    adminId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'admin_id'
    },

    adminName: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: 'admin_name',
      comment: '관리자 이름 스냅샷'
    },

    clearedVendorName: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: 'cleared_vendor_name'
    },

    clearedVendorContact: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: 'cleared_vendor_contact'
    },

    clearedVendorRefNo: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: 'cleared_vendor_ref_no'
    },

    clearedReservedAmount: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'cleared_reserved_amount'
    },

    clearedActualAmount: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'cleared_actual_amount'
    },

    ipAddress: {
      type: DataTypes.STRING(45),
      allowNull: true,
      field: 'ip_address'
    },

    note: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: '관리자 메모'
    },

    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'created_at'
    }
  }, {
    tableName: 'move_in_service_task_logs',
    timestamps: false,
    underscored: true
  });

  /**
   * 상태 변경 로그 생성 헬퍼
   */
  MoveInServiceTaskLog.createLog = async function ({
    serviceTaskId,
    caseId,
    fromStatus,
    toStatus,
    changedBy = 'ADMIN',
    adminId = null,
    adminName = null,
    clearedVendor = null,
    note = null,
    req = null
  }, transaction = null) {
    const logData = {
      serviceTaskId,
      caseId,
      fromStatus,
      toStatus,
      changedBy,
      adminId,
      adminName,
      clearedVendorName:     clearedVendor?.name           ?? null,
      clearedVendorContact:  clearedVendor?.contact        ?? null,
      clearedVendorRefNo:    clearedVendor?.refNo          ?? null,
      clearedReservedAmount: clearedVendor?.reservedAmount ?? null,
      clearedActualAmount:   clearedVendor?.actualAmount   ?? null,
      note,
      ipAddress: req?.ip
        || req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
        || req?.connection?.remoteAddress
        || null
    };

    const options = transaction ? { transaction } : {};
    return await MoveInServiceTaskLog.create(logData, options);
  };

  return MoveInServiceTaskLog;
};
