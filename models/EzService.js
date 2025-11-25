const { DataTypes } = require('sequelize');
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize('ezstay', process.env.DB_USER || 'root', process.env.DB_PASSWORD || '', {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  dialect: 'mysql',
  logging: false
});

/**
 * EzService 모델 - 이지서비스 (호스트가 제공하는 무료 부가 서비스)
 *
 * 변경 이력:
 * - 2025-01: RoomFreeService에서 EzService로 이름 변경
 * - 렌탈 아이템 관련 컬럼 제거 (플랫폼 직접 판매로 전환)
 *
 * 제공 서비스:
 * - cleaningService: 무료 청소 서비스
 * - autoPasswordChange: 자동 비밀번호 변경
 * - roomPassword: 방 출입 비밀번호
 */
const EzService = sequelize.define('EzService', {
  roomId: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    comment: '방 ID (외래키)'
    // references 옵션 제거 - models/index.js에서 belongsTo로 관계 설정
  },
  cleaningService: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: '무료 청소 서비스 제공 여부'
  },
  autoPasswordChange: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: '자동 비밀번호 변경 여부'
  },
  roomPassword: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: '방 출입 비밀번호 (자동 변경 기능과 연동)'
  }
}, {
  tableName: 'ez_services',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      fields: ['cleaning_service'],
      name: 'idx_cleaning_service'
    },
    {
      fields: ['auto_password_change'],
      name: 'idx_auto_password_change'
    }
  ],
  comment: '이지서비스 (호스트 제공 무료 부가 서비스)'
});

module.exports = { EzService, sequelize };
