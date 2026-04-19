const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

/**
 * AutoMessageTemplate 모델 - 호스트 자동메시지 템플릿
 * 호스트가 설정한 자동메시지 템플릿을 관리
 * 계약 확정, 입주일 N일 전, 퇴실일 N일 전 등 특정 시점에 자동 발송
 */
const AutoMessageTemplate = sequelize.define('AutoMessageTemplate', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  hostId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'host_id',
    comment: '호스트 ID'
  },
  roomId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'room_id',
    comment: '방 ID (방별로 다른 자동메시지 설정 가능)'
  },

  // 발송 트리거 설정
  triggerType: {
    type: DataTypes.ENUM(
      'CONTRACT_CONFIRMED',  // 계약 확정 시 (결제 완료 시점)
      'BEFORE_CHECK_IN',     // 입주일 N일 전
      'BEFORE_CHECK_OUT'     // 퇴실일 N일 전
    ),
    allowNull: false,
    field: 'trigger_type',
    comment: '발송 트리거 타입'
  },
  triggerDays: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'trigger_days',
    comment: 'N일 전 (0이면 즉시, CONTRACT_CONFIRMED일 때는 무시됨)',
    validate: {
      min: 0,
      max: 30
    }
  },
  triggerTime: {
    type: DataTypes.STRING(5),
    allowNull: false,
    defaultValue: '09:00',
    field: 'trigger_time',
    comment: '발송 시각 (HH:mm 형식, 예: 09:00)',
    validate: {
      is: /^([01]\d|2[0-3]):([0-5]\d)$/
    }
  },

  // 메시지 내용
  title: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: '템플릿 제목 (관리용)'
  },
  messageContent: {
    type: DataTypes.TEXT,
    allowNull: false,
    field: 'message_content',
    comment: '메시지 내용'
  },

  // 활성화 상태
  isActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    field: 'is_active',
    comment: '활성화 여부 (ON/OFF)'
  },

  // 발송 통계
  sentCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'sent_count',
    comment: '총 발송 횟수'
  },
  lastSentAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'last_sent_at',
    comment: '마지막 발송 시각'
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
  tableName: 'auto_message_templates',
  timestamps: true,
  underscored: false,
  indexes: [
    {
      fields: ['host_id'],
      name: 'idx_host_id'
    },
    {
      fields: ['room_id'],
      name: 'idx_room_id'
    },
    {
      fields: ['trigger_type'],
      name: 'idx_trigger_type'
    },
    {
      fields: ['is_active'],
      name: 'idx_is_active'
    },
    {
      fields: ['host_id', 'room_id', 'trigger_type'],
      name: 'idx_host_room_trigger'
    }
  ]
});

/**
 * 트리거 타입 한글명 매핑
 */
AutoMessageTemplate.TRIGGER_TYPE_LABELS = {
  CONTRACT_CONFIRMED: '계약 확정 시',
  BEFORE_CHECK_IN: '입주일 기준',
  BEFORE_CHECK_OUT: '퇴실일 기준'
};

module.exports = AutoMessageTemplate;
