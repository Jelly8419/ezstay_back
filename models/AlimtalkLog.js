const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

/**
 * AlimtalkLog 모델 - 카카오 알림톡 발송 이력
 * 모든 알림톡 발송 시도를 기록하며 중복 발송 방지, 재시도, 실패 추적에 사용
 */
const AlimtalkLog = sequelize.define('AlimtalkLog', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },

  // 이벤트 식별
  eventName: {
    type: DataTypes.STRING(50),
    allowNull: false,
    field: 'event_name',
    comment: '이벤트명 (payment_completed_guest, contract_canceled_host 등)'
  },

  // 관련 리소스 (중복 발송 체크에 사용)
  contractId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'contract_id',
    comment: '관련 계약 ID'
  },
  chatRoomId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'chat_room_id',
    comment: '관련 채팅방 ID (채팅 알림용)'
  },
  moveInCaseId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'move_in_case_id',
    comment: '관련 입주 준비 케이스 ID (입주 준비 알림톡 일별 발송 제한 카운트용)'
  },

  // 수신자 정보
  receiverId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'receiver_id',
    comment: '수신자 사용자 ID (미가입자 대상 발송 시 NULL — 예: 입주 준비 결제 요청 임차인)'
  },
  receiverPhone: {
    type: DataTypes.STRING(20),
    allowNull: false,
    field: 'receiver_phone',
    comment: '수신자 전화번호'
  },
  receiverRole: {
    type: DataTypes.ENUM('host', 'guest'),
    allowNull: true,
    field: 'receiver_role',
    comment: '수신자 역할 (host/guest, 공통 발송 시 NULL)'
  },

  // 템플릿 정보
  tplCode: {
    type: DataTypes.STRING(50),
    allowNull: false,
    field: 'tpl_code',
    comment: 'Aligo 알림톡 템플릿 코드'
  },

  // 발송 상태
  status: {
    type: DataTypes.ENUM('PENDING', 'SENT', 'FAILED', 'RETRIED', 'FALLBACK_SENT', 'FALLBACK_FAILED'),
    allowNull: false,
    defaultValue: 'PENDING',
    comment: '발송 상태'
  },

  // 요청/응답 데이터
  requestPayload: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'request_payload',
    comment: 'Aligo API 요청 payload (JSON)',
    get() {
      const rawValue = this.getDataValue('requestPayload');
      if (!rawValue) return null;
      try { return JSON.parse(rawValue); } catch { return rawValue; }
    },
    set(value) {
      this.setDataValue('requestPayload', value ? JSON.stringify(value) : null);
    }
  },
  responsePayload: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'response_payload',
    comment: 'Aligo API 응답 payload (JSON)',
    get() {
      const rawValue = this.getDataValue('responsePayload');
      if (!rawValue) return null;
      try { return JSON.parse(rawValue); } catch { return rawValue; }
    },
    set(value) {
      this.setDataValue('responsePayload', value ? JSON.stringify(value) : null);
    }
  },

  // 재시도
  retryCount: {
    type: DataTypes.TINYINT,
    allowNull: false,
    defaultValue: 0,
    field: 'retry_count',
    comment: '재시도 횟수 (최대 1)'
  },

  // 에러 정보
  errorMessage: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'error_message',
    comment: '에러 메시지'
  },

  // 타임스탬프
  sentAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'sent_at',
    comment: '발송 성공 시각'
  },
  failedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'failed_at',
    comment: '최종 실패 시각'
  },

  createdAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'created_at'
  },
  updatedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'updated_at'
  }
}, {
  tableName: 'alimtalk_logs',
  timestamps: true,
  underscored: false,
  indexes: [
    {
      fields: ['event_name', 'contract_id', 'receiver_id'],
      name: 'idx_dedup'
    },
    {
      fields: ['status', 'retry_count'],
      name: 'idx_status_retry'
    },
    {
      fields: ['created_at'],
      name: 'idx_created_at'
    },
    {
      fields: ['move_in_case_id', 'created_at'],
      name: 'idx_move_in_case_created'
    }
  ]
});

module.exports = AlimtalkLog;
