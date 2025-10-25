const { DataTypes } = require('sequelize');
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize('ezstay', process.env.DB_USER || 'root', process.env.DB_PASSWORD || '', {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  dialect: 'mysql'
});

const LocalUser = sequelize.define('LocalUser', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    unique: true,
    references: {
      model: 'users',
      key: 'id'
    },
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE'
  },
  password: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: '암호화된 비밀번호'
  },
  passwordResetToken: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: '비밀번호 재설정 토큰'
  },
  passwordResetExpires: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '비밀번호 재설정 토큰 만료일'
  },
  emailVerified: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: '이메일 인증 여부'
  },
  emailVerificationToken: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: '이메일 인증 토큰'
  },
  failedLoginAttempts: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: '로그인 실패 횟수'
  },
  lockUntil: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '계정 잠금 해제 시간'
  }
}, {
  tableName: 'local_users',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      fields: ['user_id']
    },
    {
      fields: ['password_reset_token']
    },
    {
      fields: ['email_verification_token']
    }
  ]
});

module.exports = { LocalUser, sequelize };