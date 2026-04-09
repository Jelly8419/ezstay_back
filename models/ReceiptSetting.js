const { DataTypes } = require('sequelize');
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(process.env.DB_NAME || 'ezstay', process.env.DB_USER || 'root', process.env.DB_PASSWORD || '', {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  dialect: 'mysql',
  logging: false
});

const ReceiptSetting = sequelize.define('ReceiptSetting', {
  id: {
    type: DataTypes.INTEGER.UNSIGNED,
    primaryKey: true,
    autoIncrement: true,
    comment: '영수증 설정 고유 ID'
  },
  userId: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    unique: true,
    comment: '사용자 ID (호스트/게스트)'
  },
  receiptType: {
    type: DataTypes.ENUM('personal', 'business', 'tax_invoice'),
    allowNull: false,
    comment: '영수증 종류 (personal: 개인소득공제용, business: 사업자증빙용, tax_invoice: 전자세금계산서)'
  },
  receiptNumber: {
    type: DataTypes.STRING(30),
    allowNull: false,
    comment: '폰번호/카드번호/사업자번호'
  },
  businessName: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: '사업자명 (tax_invoice, business 전용)'
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
  }
}, {
  tableName: 'receipt_settings',
  timestamps: true,
  underscored: true,
  comment: '사용자 영수증 발급 정보 설정 테이블'
});

module.exports = { ReceiptSetting, sequelize };
