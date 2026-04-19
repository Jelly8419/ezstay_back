const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

const GuestRefundAccount = sequelize.define('GuestRefundAccount', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    comment: '환급 계좌 고유 ID'
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '사용자 ID (users 테이블 참조)'
    // references 옵션 제거 - models/index.js에서 belongsTo로 관계 설정
  },
  bankCode: {
    type: DataTypes.STRING(3),
    allowNull: false,
    comment: '은행 코드 (예: 004, 088)'
  },
  bankName: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: '은행명 (예: KB국민은행, 신한은행)'
  },
  accountNumber: {
    type: DataTypes.STRING(30),
    allowNull: false,
    comment: '계좌번호 (하이픈 제거된 숫자)'
  },
  accountHolder: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: '예금주명'
  },
  isVerified: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: '예금주 확인 완료 여부 (아임포트)'
  },
  verifiedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '예금주 확인 완료 시간'
  }
}, {
  tableName: 'guest_refund_accounts',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      unique: true,
      fields: ['user_id'],
      name: 'guest_refund_accounts_user_id_unique'
    }
  ],
  comment: '게스트 환급 계좌 정보 테이블 (무통장/가상계좌 환불용, 호스트 정산계좌와 별도)'
});

module.exports = GuestRefundAccount;
