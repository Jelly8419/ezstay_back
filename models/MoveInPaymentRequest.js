const { DataTypes } = require('sequelize');

/**
 * MoveInPaymentRequest 모델
 * 임차인용 옵션 결제 요청 토큰 (case와 1:1)
 *
 * - PRD 10.1: 결제 완료 여부는 임대인에게 비노출
 *   따라서 status는 발송 상태(NOT_SENT/SENT)만 추적
 * - 휴대폰 번호 변경 시 신규 토큰 발급 권장 (PRD 9.2)
 * - 만료: case.check_out_date + 1일
 */
module.exports = (sequelize) => {
  const MoveInPaymentRequest = sequelize.define('MoveInPaymentRequest', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },

    caseId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true,
      field: 'case_id',
      comment: '입주 준비 등록 ID (1:1)'
    },

    token: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
      comment: '임차인 결제 링크 토큰 (UUID v4)'
    },

    status: {
      type: DataTypes.ENUM('NOT_SENT', 'SENT'),
      allowNull: false,
      defaultValue: 'NOT_SENT',
      comment: '발송 상태 (PRD: 결제 완료 여부는 임대인 비노출)'
    },

    sentAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'sent_at',
      comment: '최초 발송 일시'
    },

    lastResentAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'last_resent_at',
      comment: '마지막 재발송 일시'
    },

    resendCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'resend_count',
      comment: '재발송 횟수'
    },

    expiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'expires_at',
      comment: '토큰 만료 시각 (퇴실일+1일)'
    }
  }, {
    tableName: 'move_in_payment_requests',
    timestamps: true,
    underscored: true
  });

  return MoveInPaymentRequest;
};
