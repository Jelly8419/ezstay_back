const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

/**
 * Notification 모델 - 사용자 알림
 * 게스트/호스트의 계약, 결제, 입퇴실, 채팅 등 주요 상태 변화를 알림으로 관리
 */
const Notification = sequelize.define('Notification', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },

  // 수신자 정보
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'user_id',
    comment: '알림 수신자 ID'
  },
  userMode: {
    type: DataTypes.ENUM('guest', 'host'),
    allowNull: false,
    field: 'user_mode',
    comment: '수신 시점의 사용자 모드'
  },

  // 알림 유형
  type: {
    type: DataTypes.ENUM(
      // 공통 알림
      'MESSAGE',              // 채팅 메시지 도착
      'NOTICE',               // 공지사항 등록
      'INQUIRY_ANSWERED',     // 고객센터 답변 완료
      'PAYMENT_COMPLETED',    // 결제 완료
      'CHECKIN_TODAY',        // 입주 당일
      'CHECKOUT_REMINDER',    // 퇴실 임박
      'CHECKOUT_CONFIRMED',   // 퇴실 완료
      'CONTRACT_CANCELED',    // 계약 취소
      'CONTRACT',             // 계약 관련 범용 (취소 요청, 승인/거절 등)

      // 게스트 전용
      'CONTRACT_REQUEST_GUEST',   // 계약 요청 완료 (게스트)
      'CONTRACT_APPROVED',        // 계약 승인
      'CONTRACT_REJECTED',        // 계약 거절
      'PAYMENT_PENDING',          // 결제 대기 (24시간 전)
      'OPTION_DEADLINE',          // 옵션 추가 마감 임박

      // 호스트 전용
      'CONTRACT_REQUEST_HOST',    // 새로운 계약 요청 (호스트)
      'PROPERTY_REVIEW_RESULT',   // 매물 심사 결과
      'ADDITIONAL_OPTION_PAYMENT',// 옵션 추가 결제 발생
      'CHECKIN_CONFIRMED',        // 입주 확정
      'CHECKOUT_REQUEST'          // 퇴실 확인 요청 (보증금 반환)
    ),
    allowNull: false,
    comment: '알림 유형'
  },

  // 알림 내용
  title: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: '알림 제목'
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: '알림 본문'
  },

  // 읽음 상태
  isRead: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'is_read',
    comment: '읽음 여부'
  },

  // 관련 리소스 ID (Soft Reference - FK 제약 없음)
  relatedContractId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'related_contract_id',
    comment: '관련 계약 ID'
  },
  relatedChatRoomId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'related_chat_room_id',
    comment: '관련 채팅방 ID'
  },
  relatedNoticeId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'related_notice_id',
    comment: '관련 공지사항 ID'
  },
  relatedInquiryId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'related_inquiry_id',
    comment: '관련 문의 ID'
  },
  relatedRoomId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'related_room_id',
    comment: '관련 매물 ID'
  },

  // 추가 메타데이터 (게스트명, 방이름 등 동적 데이터)
  metadata: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '추가 메타데이터 (JSON)',
    get() {
      const rawValue = this.getDataValue('metadata');
      return rawValue ? JSON.parse(rawValue) : null;
    },
    set(value) {
      this.setDataValue('metadata', value ? JSON.stringify(value) : null);
    }
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
  tableName: 'notifications',
  timestamps: true,
  underscored: false,
  indexes: [
    {
      fields: ['user_id'],
      name: 'idx_user_id'
    },
    {
      fields: ['user_id', 'user_mode'],
      name: 'idx_user_mode'
    },
    {
      fields: ['user_id', 'is_read'],
      name: 'idx_user_read'
    },
    {
      fields: ['type'],
      name: 'idx_type'
    },
    {
      fields: ['created_at'],
      name: 'idx_created_at'
    },
    {
      fields: ['related_contract_id'],
      name: 'idx_related_contract'
    }
  ]
});

/**
 * 알림 타입별 한글 라벨
 */
Notification.TYPE_LABELS = {
  // 공통
  MESSAGE: '새 메시지',
  NOTICE: '공지사항',
  INQUIRY_ANSWERED: '문의 답변',
  PAYMENT_COMPLETED: '결제 완료',
  CHECKIN_TODAY: '입주 안내',
  CHECKOUT_REMINDER: '퇴실 안내',
  CHECKOUT_CONFIRMED: '퇴실 완료',
  CONTRACT_CANCELED: '계약 취소',

  // 게스트 전용
  CONTRACT_REQUEST_GUEST: '계약 요청',
  CONTRACT_APPROVED: '계약 승인',
  CONTRACT_REJECTED: '계약 거절',
  PAYMENT_PENDING: '결제 대기',
  OPTION_DEADLINE: '옵션 마감 임박',

  // 호스트 전용
  CONTRACT_REQUEST_HOST: '새 계약 요청',
  PROPERTY_REVIEW_RESULT: '매물 심사 결과',
  ADDITIONAL_OPTION_PAYMENT: '옵션 결제',
  CHECKIN_CONFIRMED: '입주 확정',
  CHECKOUT_REQUEST: '퇴실 확인 요청'
};

/**
 * 알림 타입별 딥링크 타겟
 */
Notification.DEEPLINK_TARGETS = {
  // 계약 관련 → 계약관리 페이지
  CONTRACT_REQUEST_GUEST: 'contract',
  CONTRACT_REQUEST_HOST: 'contract',
  CONTRACT_APPROVED: 'contract',
  CONTRACT_REJECTED: 'home',  // 거절은 홈으로
  CONTRACT_CANCELED: 'contract',
  PAYMENT_PENDING: 'contract',
  PAYMENT_COMPLETED: 'contract',
  CHECKIN_TODAY: 'contract',
  CHECKIN_CONFIRMED: 'contract',
  CHECKOUT_REMINDER: 'contract',
  CHECKOUT_CONFIRMED: 'contract',
  CHECKOUT_REQUEST: 'contract',
  OPTION_DEADLINE: 'contract',
  ADDITIONAL_OPTION_PAYMENT: 'contract',

  // 채팅 → 채팅 리스트
  MESSAGE: 'chat',

  // 공지/문의 → 고객센터
  NOTICE: 'notice',
  INQUIRY_ANSWERED: 'inquiry',

  // 매물 → 방 관리
  PROPERTY_REVIEW_RESULT: 'room'
};

module.exports = Notification;
