const { DataTypes } = require('sequelize');

// 중앙 sequelize 인스턴스를 require로 가져옵니다
// (순환 참조 방지를 위해 함수 내부에서 가져옵니다)
const getSequelize = () => {
  const { sequelize } = require('./index');
  return sequelize;
};

const Admin = (sequelize) => sequelize.define('Admin', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  username: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: '관리자 아이디 (로그인 ID)'
  },
  password: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: '비밀번호 (bcrypt 해싱)'
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: '관리자 이름'
  },
  phoneNumber: {
    type: DataTypes.STRING(20),
    allowNull: true,
    comment: '휴대폰 번호'
  },
  role: {
    type: DataTypes.ENUM('super_admin', 'admin', 'cs_admin'),
    allowNull: false,
    defaultValue: 'admin',
    comment: 'super_admin: 최고관리자, admin: 일반관리자, cs_admin: 고객센터 관리자'
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    comment: '계정 활성화 여부'
  },
  lastLoginAt: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '마지막 로그인 시간'
  },
  refreshToken: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'JWT Refresh Token'
  }
}, {
  tableName: 'admins',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      unique: true,
      fields: ['username'],
      name: 'admins_username_unique' // 명시적인 이름 지정으로 중복 방지
    }
  ]
});

// 모듈 export를 팩토리 패턴으로 변경
module.exports = Admin;
