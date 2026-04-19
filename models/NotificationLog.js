const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

/**
 * NotificationLog 모델 - 알림 발송 이력 추적
 * 중복 발송 방지 및 알림 이력 관리를 위한 테이블
 */
const NotificationLog = sequelize.define('NotificationLog', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },

  // 알림 대상
  contractId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'contract_id',
    comment: '계약 ID'
  },
  chatRoomId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'chat_room_id',
    comment: '채팅방 ID (MySQL)'
  },

  // 알림 타입
  notificationType: {
    type: DataTypes.STRING(50),
    allowNull: false,
    field: 'notification_type',
    comment: '알림 타입 (CHECK_IN_REMINDER, CHECK_OUT_REMINDER, AUTO_MESSAGE 등)'
  },

  // 자동메시지 템플릿 ID (호스트 자동메시지인 경우)
  autoMessageTemplateId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'auto_message_template_id',
    comment: '자동메시지 템플릿 ID (호스트 자동메시지인 경우)'
  },

  // 발송 정보
  messageContent: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'message_content',
    comment: '발송된 메시지 내용'
  },

  // 발송 상태
  status: {
    type: DataTypes.ENUM('SUCCESS', 'FAILED', 'SKIPPED'),
    allowNull: false,
    defaultValue: 'SUCCESS',
    comment: '발송 상태'
  },
  errorMessage: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'error_message',
    comment: '실패 시 에러 메시지'
  },

  // 발송 기준일 (중복 체크용)
  targetDate: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    field: 'target_date',
    comment: '발송 기준일 (체크인일, 체크아웃일 등)'
  },

  sentAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'sent_at',
    comment: '발송 시각'
  },

  createdAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'created_at'
  }
}, {
  tableName: 'notification_logs',
  timestamps: false,
  indexes: [
    {
      fields: ['contract_id'],
      name: 'idx_contract_id'
    },
    {
      fields: ['notification_type'],
      name: 'idx_notification_type'
    },
    {
      // 중복 발송 방지를 위한 복합 유니크 인덱스
      unique: true,
      fields: ['contract_id', 'notification_type', 'target_date'],
      name: 'idx_unique_notification'
    },
    {
      fields: ['target_date'],
      name: 'idx_target_date'
    },
    {
      fields: ['auto_message_template_id'],
      name: 'idx_auto_message_template_id'
    }
  ]
});

/**
 * 알림이 이미 발송되었는지 확인
 * @param {number} contractId - 계약 ID
 * @param {string} notificationType - 알림 타입
 * @param {string} targetDate - 기준일 (YYYY-MM-DD)
 * @returns {boolean} 발송 여부
 */
NotificationLog.isAlreadySent = async function(contractId, notificationType, targetDate) {
  const existing = await this.findOne({
    where: {
      contractId,
      notificationType,
      targetDate,
      status: 'SUCCESS'
    }
  });
  return !!existing;
};

/**
 * 알림 발송 로그 기록
 * @param {object} params - 로그 파라미터
 * @returns {NotificationLog} 생성된 로그
 */
NotificationLog.logNotification = async function(params) {
  const {
    contractId,
    chatRoomId,
    notificationType,
    autoMessageTemplateId,
    messageContent,
    status = 'SUCCESS',
    errorMessage,
    targetDate
  } = params;

  return await this.create({
    contractId,
    chatRoomId,
    notificationType,
    autoMessageTemplateId,
    messageContent,
    status,
    errorMessage,
    targetDate,
    sentAt: new Date()
  });
};

module.exports = NotificationLog;
