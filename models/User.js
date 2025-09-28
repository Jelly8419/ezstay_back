const { DataTypes } = require('sequelize');
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize('livemoment', process.env.DB_USER || 'root', process.env.DB_PASSWORD || '', {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  dialect: 'mysql'
});

const User = sequelize.define('User', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true,
    validate: {
      isEmail: true
    }
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  phoneNumber: {
    type: DataTypes.STRING(20),
    allowNull: true,
    comment: '휴대폰 번호'
  },
  phoneVerified: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: '휴대폰 인증 여부'
  },
  phoneVerifiedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '휴대폰 인증 완료 시간'
  },
  profileImageUrl: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  userType: {
    type: DataTypes.ENUM('local', 'social'),
    allowNull: false,
    comment: 'local: 일반 회원, social: 소셜 회원'
  },
  refreshToken: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  lastLoginAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // 약관 동의 정보
  serviceTermsAgreed: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: '서비스 이용약관 동의 여부'
  },
  privacyPolicyAgreed: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: '개인정보처리방침 동의 여부'
  },
  marketingConsent: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: '마케팅 정보 수신 동의 여부'
  },
  ageConfirmed: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: '만 19세 이상 확인 여부'
  },
  termsAgreedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '약관 동의 시간'
  }
}, {
  tableName: 'users',
  timestamps: true,
  underscored: true
});

module.exports = { User, sequelize };