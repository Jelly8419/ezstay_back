const { DataTypes } = require('sequelize');
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize('ezstay', process.env.DB_USER || 'root', process.env.DB_PASSWORD || '', {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  dialect: 'mysql',
  logging: false
});

const UserBankAccount = sequelize.define('UserBankAccount', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    comment: '계좌 정보 고유 ID'
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '사용자 ID (users 테이블 참조)'
    // references 옵션 제거 - models/index.js에서 belongsTo로 관계 설정
  },
  bankName: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: '은행명 (예: 국민은행, 신한은행)'
  },
  accountNumber: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: '계좌번호 (하이픈 제거된 숫자)'
  },
  accountHolder: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: '예금주명 (실명)'
  },
  isPrimary: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    comment: '주 계좌 여부 (정산용 기본 계좌)'
  },
  isVerified: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: '계좌 인증 완료 여부'
  },
  verifiedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '계좌 인증 완료 시간'
  }
}, {
  tableName: 'user_bank_accounts',
  timestamps: true,
  underscored: true,
  comment: '호스트 계좌 정보 테이블 (정산용)'
});

module.exports = { UserBankAccount, sequelize };