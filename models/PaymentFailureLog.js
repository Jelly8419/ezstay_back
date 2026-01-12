const { DataTypes } = require('sequelize');

/**
 * PaymentFailureLog 모델 - 결제 실패 로그
 * 결제 실패 시 상세 정보를 기록하여 디버깅 및 고객 지원에 활용합니다.
 */
module.exports = (sequelize) => {
  const PaymentFailureLog = sequelize.define('PaymentFailureLog', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    contractId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: '계약 ID'
      // references는 models/index.js의 belongsTo에서 정의
    },
    orderId: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: '주문번호'
    },
    failureCode: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: '토스 에러 코드'
    },
    failureMessage: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: '실패 사유 메시지'
    },
    requestData: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: '결제 요청 데이터 (JSON)'
    },
    responseData: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: '토스 API 응답 데이터 (JSON)'
    },
    userAgent: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: '사용자 브라우저 정보'
    },
    ipAddress: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: '사용자 IP 주소'
    }
  }, {
    tableName: 'payment_failure_logs',
    timestamps: true, // createdAt, updatedAt 자동 생성
    charset: 'utf8mb4',
    collate: 'utf8mb4_unicode_ci',
    indexes: [
      {
        name: 'idx_failure_log_contract_id',
        fields: ['contractId']
      },
      {
        name: 'idx_failure_log_order_id',
        fields: ['orderId']
      },
      {
        name: 'idx_failure_log_created_at',
        fields: ['createdAt']
      }
    ]
  });

  return PaymentFailureLog;
};
