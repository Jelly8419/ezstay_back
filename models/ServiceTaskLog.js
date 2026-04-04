const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ServiceTaskLog = sequelize.define('ServiceTaskLog', {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true
    },

    serviceTaskId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'service_task_id',
      comment: '서비스 태스크 ID'
    },

    contractId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'contract_id',
      comment: '계약 ID (빠른 조회용)'
    },

    // 상태 전환
    fromStatus: {
      type: DataTypes.STRING(20),
      allowNull: true,
      field: 'from_status',
      comment: '변경 전 상태 (NULL = 최초 생성)'
    },
    toStatus: {
      type: DataTypes.STRING(20),
      allowNull: false,
      field: 'to_status',
      comment: '변경 후 상태'
    },

    // 행위자
    changedBy: {
      type: DataTypes.ENUM('ADMIN', 'SYSTEM'),
      allowNull: false,
      defaultValue: 'ADMIN',
      field: 'changed_by'
    },
    adminId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'admin_id',
      comment: '관리자 ID'
    },
    adminName: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: 'admin_name',
      comment: '관리자 이름 (로그 스냅샷)'
    },

    // PENDING 복귀 시 초기화된 업체 정보 스냅샷
    clearedVendorName: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: 'cleared_vendor_name',
      comment: 'PENDING 복귀 시 초기화된 업체명'
    },
    clearedVendorContact: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: 'cleared_vendor_contact',
      comment: 'PENDING 복귀 시 초기화된 담당자'
    },
    clearedVendorRefNo: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: 'cleared_vendor_ref_no',
      comment: 'PENDING 복귀 시 초기화된 예약번호'
    },

    clearedReservedAmount: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'cleared_reserved_amount',
      comment: 'PENDING 복귀 시 초기화된 견적 금액'
    },

    clearedActualAmount: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'cleared_actual_amount',
      comment: 'PENDING 복귀 시 초기화된 실제 청구 금액'
    },

    // 추적
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
    tableName: 'service_task_logs',
    timestamps: false,
    underscored: true,
    indexes: [
      { fields: ['service_task_id'], name: 'idx_stl_service_task_id' },
      { fields: ['contract_id'],     name: 'idx_stl_contract_id' },
      { fields: ['to_status'],       name: 'idx_stl_to_status' },
      { fields: ['created_at'],      name: 'idx_stl_created_at' }
    ]
  });

  /**
   * 상태 변경 로그 생성 헬퍼
   * @param {Object} params
   * @param {number}  params.serviceTaskId
   * @param {number}  params.contractId
   * @param {string}  params.fromStatus      - 변경 전 상태
   * @param {string}  params.toStatus        - 변경 후 상태
   * @param {string}  [params.changedBy]     - 'ADMIN' | 'SYSTEM'
   * @param {number}  [params.adminId]
   * @param {string}  [params.adminName]
   * @param {Object}  [params.clearedVendor] - { name, contact, refNo, reservedAmount, actualAmount } PENDING 복귀 시 전달
   * @param {string}  [params.note]
   * @param {Object}  [params.req]           - Express request (IP 추출용)
   * @param {Object}  [transaction]          - Sequelize 트랜잭션
   */
  ServiceTaskLog.createLog = async function({
    serviceTaskId,
    contractId,
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
      contractId,
      fromStatus,
      toStatus,
      changedBy,
      adminId,
      adminName,
      clearedVendorName:    clearedVendor?.name           ?? null,
      clearedVendorContact: clearedVendor?.contact        ?? null,
      clearedVendorRefNo:   clearedVendor?.refNo          ?? null,
      clearedReservedAmount: clearedVendor?.reservedAmount ?? null,
      clearedActualAmount:   clearedVendor?.actualAmount   ?? null,
      note,
      ipAddress: req?.ip
        || req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
        || req?.connection?.remoteAddress
        || null
    };

    const options = transaction ? { transaction } : {};
    return await ServiceTaskLog.create(logData, options);
  };

  return ServiceTaskLog;
};
