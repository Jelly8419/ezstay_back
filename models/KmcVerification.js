const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('KmcVerification', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    certNum: {
      type: DataTypes.STRING(40),
      allowNull: false,
      comment: 'KMC 요청번호 (유니크 키)'
    },
    name: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: '성명'
    },
    phoneNumber: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: '휴대폰 번호'
    },
    birth: {
      type: DataTypes.STRING(8),
      allowNull: true,
      comment: '생년월일 (YYYYMMDD)'
    },
    gender: {
      type: DataTypes.STRING(1),
      allowNull: true,
      comment: '성별 (M/F)'
    },
    ci: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'KMC 연계정보(CI)'
    },
    di: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'KMC 중복가입확인정보(DI)'
    },
    used: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: '사용 여부 (회원가입 시 1회 사용 후 소멸)'
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
      comment: '만료 시각 (10분)'
    },
    ipAddress: {
      type: DataTypes.STRING(45),
      allowNull: true,
      comment: '요청 IP (보안 감사용)'
    }
  }, {
    tableName: 'kmc_verifications',
    timestamps: true,
    underscored: true,
    indexes: [
      { unique: true, fields: ['cert_num'], name: 'uq_kmc_cert_num' },
      { fields: ['expires_at'], name: 'idx_kmc_expires_at' },
      { fields: ['ci'], name: 'idx_kmc_ci' }
    ]
  });
};
