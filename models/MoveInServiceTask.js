const { DataTypes } = require('sequelize');

/**
 * MoveInServiceTask 모델
 * 입주 준비 서비스용 외부 업체 청소 예약 (관리자 처리)
 *
 * - 기존 ServiceTask와 분리 (PRD: 합치지 말 것)
 * - MVP는 CLEANING만, V2에서 침구 추가 가능
 * - 케이스당 task_type 1개 (UNIQUE)
 * - D-7 스케줄러가 cleaning_status='PAID' 케이스 대상으로 자동 생성
 */
module.exports = (sequelize) => {
  const MoveInServiceTask = sequelize.define('MoveInServiceTask', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },

    caseId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'case_id',
      comment: '입주 준비 등록 ID'
    },

    taskType: {
      type: DataTypes.ENUM('CLEANING', 'BEDDING_DELIVERY', 'BEDDING_RETRIEVAL'),
      allowNull: false,
      field: 'task_type',
      comment: 'MVP는 CLEANING, V2에서 침구 추가'
    },

    referenceDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      field: 'reference_date',
      comment: '기준일 (CLEANING=퇴실일)'
    },

    quantity: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: '침구 수량 (CLEANING은 NULL)'
    },

    status: {
      type: DataTypes.ENUM('PENDING', 'RESERVED', 'COMPLETED', 'ISSUE'),
      allowNull: false,
      defaultValue: 'PENDING',
      comment: '상태'
    },

    vendorName: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: 'vendor_name',
      comment: '업체명'
    },

    vendorContact: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: 'vendor_contact',
      comment: '담당자'
    },

    vendorRefNo: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: 'vendor_ref_no',
      comment: '예약번호'
    },

    reservedAmount: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'reserved_amount',
      comment: '예약 시 견적 금액'
    },

    actualAmount: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'actual_amount',
      comment: '완료 후 실제 청구 금액'
    },

    issueNote: {
      type: DataTypes.STRING(500),
      allowNull: true,
      field: 'issue_note',
      comment: 'ISSUE 상태 메모'
    }
  }, {
    tableName: 'move_in_service_tasks',
    timestamps: true,
    underscored: true
  });

  return MoveInServiceTask;
};
