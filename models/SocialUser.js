const { DataTypes } = require('sequelize');
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize('ezstay', process.env.DB_USER || 'root', process.env.DB_PASSWORD || '', {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  dialect: 'mysql'
});

const SocialUser = sequelize.define('SocialUser', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    },
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE'
  },
  provider: {
    type: DataTypes.ENUM('kakao'),
    allowNull: false,
    comment: '소셜 로그인 제공자'
  },
  providerId: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: '제공자별 고유 ID'
  },
  providerEmail: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: '제공자에서 받아온 이메일 (다를 수 있음)'
  },
  accessToken: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '제공자 액세스 토큰 (선택적 저장)'
  },
  refreshTokenProvider: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '제공자 리프레시 토큰'
  },
  tokenExpiresAt: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '제공자 토큰 만료일'
  },
  additionalData: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: '제공자별 추가 정보 (JSON 형태)'
  }
}, {
  tableName: 'social_users',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      fields: ['user_id']
    },
    {
      unique: true,
      fields: ['provider', 'provider_id'],
      name: 'unique_provider_user'
    },
    {
      fields: ['provider']
    }
  ]
});

module.exports = { SocialUser, sequelize };