const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('UserSession', {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: 'User.id 또는 Admin.id'
    },
    refreshToken: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    deviceInfo: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'User-Agent 기반 기기 식별 문자열'
    },
    ipAddress: {
      type: DataTypes.STRING(45),
      allowNull: true,
      comment: 'IPv4/IPv6'
    },
    userType: {
      type: DataTypes.ENUM('user', 'admin'),
      allowNull: false,
      defaultValue: 'user'
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
      comment: 'refreshToken 만료 시각'
    },
    lastUsedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      comment: '마지막 토큰 갱신 시각'
    }
  }, {
    tableName: 'user_sessions',
    timestamps: true,   // createdAt 자동 생성
    updatedAt: false,   // lastUsedAt으로 대체
    underscored: true
  });
};
