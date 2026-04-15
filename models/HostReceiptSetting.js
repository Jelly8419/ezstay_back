const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

const HostReceiptSetting = sequelize.define('HostReceiptSetting', {
  id: {
    type: DataTypes.INTEGER.UNSIGNED,
    primaryKey: true,
    autoIncrement: true,
    comment: '영수증 설정 고유 ID'
  },
  hostId: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '호스트 User ID'
    // references 옵션 제거 - models/index.js에서 belongsTo로 관계 설정
  },
  receiptRequired: {
    type: DataTypes.ENUM('yes', 'no'),
    allowNull: false,
    defaultValue: 'no',
    comment: '영수증 신청 여부'
  },
  receiptType: {
    type: DataTypes.ENUM('personal', 'business', 'tax_invoice'),
    allowNull: true,
    comment: '영수증 종류 (personal: 개인소득공제용, business: 사업자증빙용, tax_invoice: 전자세금계산서)'
  },
  receiptNumber: {
    type: DataTypes.STRING(30),
    allowNull: true,
    comment: '폰번호/카드번호/사업자번호'
  },
  businessName: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: '사업자명 (tax_invoice 전용)'
  },
  repName: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: '대표자명 (tax_invoice 전용)'
  },
  email: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: '이메일 (tax_invoice 전용)'
  },
  issueStatus: {
    type: DataTypes.ENUM('none', 'requested', 'issued', 'rejected'),
    allowNull: false,
    defaultValue: 'none',
    comment: '발급상태 (none: 미신청, requested: 발급요청, issued: 발급완료, rejected: 반려)'
  },
  issuedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '발급 완료 일시'
  },
  issuedBy: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: true,
    comment: '발급 처리 관리자 ID'
    // references 옵션 제거 - models/index.js에서 belongsTo로 관계 설정
  },
  issueNote: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: '관리자 메모 (발급/반려 사유 등)'
  }
}, {
  tableName: 'host_receipt_settings',
  timestamps: true,
  underscored: true,
  comment: '호스트 영수증 설정 테이블'
});

module.exports = { HostReceiptSetting, sequelize };
