const { DataTypes } = require('sequelize');

/**
 * ServiceTask 모델
 * 청소 / 침구류 대여 / 침구류 회수 외부 업체 예약 관리
 *
 * - 계약 당 task_type 1개 (UNIQUE KEY)
 * - 스케줄러가 7일 이내 도래 시 자동 생성 (findOrCreate)
 * - 상태 변경은 관리자 수동
 */
module.exports = (sequelize) => {
  const ServiceTask = sequelize.define('ServiceTask', {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },

    contractId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: '연결된 계약 ID'
    },

    taskType: {
      type: DataTypes.ENUM('CLEANING', 'BEDDING_DELIVERY', 'BEDDING_RETRIEVAL'),
      allowNull: false,
      comment: '작업 유형: CLEANING(청소) / BEDDING_DELIVERY(침구 대여) / BEDDING_RETRIEVAL(침구 회수)'
    },

    referenceDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      comment: '기준일 (청소·침구회수 → 퇴실일, 침구대여 → 입주일)'
    },

    quantity: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
      comment: '침구 수량 (CLEANING은 NULL)'
    },

    status: {
      type: DataTypes.ENUM('PENDING', 'RESERVED', 'COMPLETED', 'ISSUE'),
      allowNull: false,
      defaultValue: 'PENDING',
      comment: '상태: PENDING(예약 필요) / RESERVED(예약 완료) / COMPLETED(작업 완료) / ISSUE(이슈 발생)'
    },

    vendorName: {
      type: DataTypes.STRING(100),
      allowNull: true,
      defaultValue: null,
      comment: '업체명'
    },

    vendorContact: {
      type: DataTypes.STRING(100),
      allowNull: true,
      defaultValue: null,
      comment: '담당자'
    },

    vendorRefNo: {
      type: DataTypes.STRING(100),
      allowNull: true,
      defaultValue: null,
      comment: '예약번호'
    },

    reservedAmount: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
      comment: '예약 시 견적 금액 (RESERVED 시 입력)'
    },

    actualAmount: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
      comment: '완료 후 실제 청구 금액 (COMPLETED 시 입력)'
    },

    issueNote: {
      type: DataTypes.STRING(500),
      allowNull: true,
      defaultValue: null,
      comment: 'ISSUE 상태 시 이슈 내용 메모'
    }
  }, {
    tableName: 'service_tasks',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['contract_id', 'task_type'],
        name: 'uq_contract_task'
      },
      { fields: ['status'] },
      { fields: ['reference_date'] },
      { fields: ['task_type'] }
    ]
  });

  return ServiceTask;
};
