const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('User', {
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
    nickname: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: '표시 이름 (카카오: profile.nickname, 이메일: 본인인증 name)'
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
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    accountStatus: {
      type: DataTypes.ENUM('active', 'suspended', 'withdrawn'),
      allowNull: false,
      defaultValue: 'active',
      comment: '계정 상태: active(활성), suspended(정지), withdrawn(탈퇴)'
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
    },
    // KMC 본인인증 정보
    ci: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'KMC 연계정보(CI) - 서비스 간 동일인 식별'
    },
    di: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'KMC 중복가입확인정보(DI) - 동일 서비스 내 중복가입 방지'
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
    userMode: {
      type: DataTypes.ENUM('guest', 'host'),
      allowNull: false,
      defaultValue: 'guest',
      comment: '현재 활성 모드 (guest | host)'
    }
  }, {
    tableName: 'users',
    timestamps: true,
    underscored: true
  });
};
