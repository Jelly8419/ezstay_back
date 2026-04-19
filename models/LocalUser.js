const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('LocalUser', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false
      // references 옵션 제거 - models/index.js에서 belongsTo로 관계 설정
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
        unique: true,
        fields: ['user_id'],
        name: 'local_users_user_id_unique'
      },
      {
        fields: ['password_reset_token']
      },
      {
        fields: ['email_verification_token']
      }
    ]
  });
};
