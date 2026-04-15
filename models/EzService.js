const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

/**
 * EzService 모델 - 이지서비스 (호스트가 제공하는 무료 부가 서비스)
 *
 * 변경 이력:
 * - 2025-01: RoomFreeService에서 EzService로 이름 변경
 * - 렌탈 아이템 관련 컬럼 제거 (플랫폼 직접 판매로 전환)
 *
 * 제공 서비스:
 * - cleaningService: 청소 서비스 사용 여부
 * - roomPassword: 도어락 비밀번호 (청소서비스 사용 시 필수)
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
    comment: '청소 서비스 사용 여부 (체크 시 cleaningFee=0, roomPassword 필수)'
  },
  roomPassword: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: '도어락 비밀번호 (청소서비스 사용 시 필수)'
  }
}, {
  tableName: 'ez_services',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      fields: ['cleaning_service'],
      name: 'idx_cleaning_service'
    }
  ],
  comment: '이지서비스 (호스트 제공 무료 부가 서비스)'
});

module.exports = { EzService };
