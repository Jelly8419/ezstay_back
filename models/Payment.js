const { DataTypes } = require('sequelize');

/**
 * Payment 모델 - 결제 정보
 * 토스페이먼츠로부터 받은 결제 데이터를 저장합니다.
 */
module.exports = (sequelize) => {
  const Payment = sequelize.define('Payment', {
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
    paymentKey: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
      comment: '토스 결제 고유 키'
    },
    orderId: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: '주문번호 (Contract의 orderId와 동일)'
    },
    method: {
      type: DataTypes.ENUM('CARD', 'VIRTUAL_ACCOUNT', 'TRANSFER', 'MOBILE', 'EASY_PAY'),
      allowNull: false,
      comment: '결제 수단'
    },
    status: {
      type: DataTypes.ENUM(
        'READY',           // 결제 대기
        'IN_PROGRESS',     // 결제 진행 중
        'WAITING_FOR_DEPOSIT', // 입금 대기 (가상계좌)
        'DONE',            // 결제 완료
        'CANCELED',        // 결제 취소
        'PARTIAL_CANCELED', // 부분 취소
        'ABORTED',         // 결제 중단
        'EXPIRED'          // 결제 만료
      ),
      allowNull: false,
      defaultValue: 'READY',
      comment: '결제 상태'
    },
    requestedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      comment: '결제 요청 시각'
    },
    approvedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: '결제 승인 시각'
    },
    totalAmount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: '총 결제 금액'
    },
    balanceAmount: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: '취소 가능 금액 (잔액)'
    },
    suppliedAmount: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: '공급가액'
    },
    vat: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: '부가세'
    },
    taxFreeAmount: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      comment: '비과세 금액'
    },
    currency: {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: 'KRW',
      comment: '통화 (기본: KRW)'
    },
    receiptUrl: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: '영수증 URL'
    },
    checkoutUrl: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: '결제 페이지 URL'
    },
    paymentResponse: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: '토스 API 전체 응답 (JSON 저장)'
    }
  }, {
    tableName: 'payments',
    timestamps: true, // createdAt, updatedAt 자동 생성
    charset: 'utf8mb4',
    collate: 'utf8mb4_unicode_ci',
    indexes: [
      {
        name: 'idx_payment_contract_id',
        fields: ['contractId']
      },
      {
        name: 'idx_payment_key',
        unique: true,
        fields: ['paymentKey']
      },
      {
        name: 'idx_payment_order_id',
        fields: ['orderId']
      },
      {
        name: 'idx_payment_status',
        fields: ['status']
      }
    ]
  });

  return Payment;
};
