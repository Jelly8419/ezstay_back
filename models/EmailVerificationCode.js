const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('EmailVerificationCode', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      comment: '인증 요청한 이메일 주소',
      validate: {
        isEmail: true
      }
    },
    code: {
      type: DataTypes.STRING(6),
      allowNull: false,
      comment: '6자리 인증코드'
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
      comment: '인증코드 만료 시간'
    },
    verified: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: '인증 완료 여부'
    },
    verifiedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: '인증 완료 시간'
    },
    attempts: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: '인증 시도 횟수 (최대 5회)'
    },
    ipAddress: {
      type: DataTypes.STRING(45),
      allowNull: true,
      comment: '요청 IP 주소 (보안 감사용)'
    }
  }, {
    tableName: 'email_verification_codes',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['email', 'code'],
        name: 'email_code_index'
      },
      {
        fields: ['email', 'created_at'],
        name: 'email_created_at_index'
      },
      {
        fields: ['expires_at'],
        name: 'expires_at_index'
      },
      {
        fields: ['verified'],
        name: 'verified_index'
      }
    ]
  });
};
