/**
 * 알림 문구 템플릿
 * PRD에 정의된 알림 문구를 관리합니다.
 */

/**
 * 계약 취소 사유 타입
 */
const CANCEL_TYPES = {
  PAYMENT_EXPIRED: 'payment_expired',   // 결제 기간 만료
  HOST_CANCEL: 'host_cancel',           // 호스트 사유로 취소
  GUEST_CANCEL: 'guest_cancel'          // 게스트 사유로 취소
};

/**
 * 계약 취소 사유별 문구
 */
const CANCEL_COMMENTS = {
  [CANCEL_TYPES.PAYMENT_EXPIRED]: '결제 기간이 만료되어',
  [CANCEL_TYPES.HOST_CANCEL]: '호스트의 사유로',
  [CANCEL_TYPES.GUEST_CANCEL]: '게스트의 사유로'
};

/**
 * 알림 메시지 생성 함수들
 */
const NotificationMessages = {
  // =====================================================
  // A. 계약 관련 알림
  // =====================================================

  /**
   * 계약 요청 - 호스트에게
   */
  contractRequestHost: (metadata = {}) => ({
    title: '새 계약 요청',
    message: '새로운 계약이 요청되었습니다. 승인 또는 거절을 해주세요.'
  }),

  /**
   * 계약 요청 - 게스트에게
   */
  contractRequestGuest: (metadata = {}) => ({
    title: '계약 요청 완료',
    message: '계약 요청이 완료되었습니다. 호스트의 승인을 기다려주세요.'
  }),

  /**
   * 계약 승인 - 호스트에게
   */
  contractApprovedHost: (metadata = {}) => ({
    title: '계약 승인 완료',
    message: '계약을 승인했습니다. 게스트의 결제를 기다려주세요.'
  }),

  /**
   * 계약 승인 - 게스트에게
   */
  contractApprovedGuest: (metadata = {}) => ({
    title: '계약 승인',
    message: '호스트가 계약을 승인했습니다. 결제를 진행해주세요.'
  }),

  /**
   * 계약 거절 - 게스트에게
   */
  contractRejected: (metadata = {}) => ({
    title: '계약 거절',
    message: '아쉽게도 호스트가 계약을 승인하지 않았어요. 다른 방을 찾아보세요.'
  }),

  /**
   * 계약 취소 - 공통
   * @param {string} cancelType - CANCEL_TYPES 중 하나
   */
  contractCanceled: (cancelType, metadata = {}) => {
    const comment = CANCEL_COMMENTS[cancelType] || '';
    return {
      title: '계약 취소',
      message: `${comment} 계약이 취소되었습니다.`
    };
  },

  // =====================================================
  // B. 결제/정산 관련 알림
  // =====================================================

  /**
   * 결제 대기 (24시간 전) - 게스트에게
   */
  paymentPending: (metadata = {}) => ({
    title: '결제 안내',
    message: '결제가 아직 완료되지 않았어요. 계약을 진행하려면 결제 만료 전에 결제를 진행해주세요.'
  }),

  /**
   * 결제 완료 - 공통
   */
  paymentCompleted: (metadata = {}) => ({
    title: '결제 완료',
    message: '결제가 완료되었습니다. 계약이 확정되었어요.'
  }),

  /**
   * 추가 옵션 결제 완료 - 게스트에게
   */
  additionalOptionPayment: (metadata = {}) => ({
    title: '옵션 결제 완료',
    message: '옵션 상품 결제가 완료되었습니다.'
  }),

  // =====================================================
  // C. 입주/퇴실 안내 알림
  // =====================================================

  /**
   * 입주 당일 - 호스트에게
   * @param {Object} metadata - { guestName, guestPhoneNumber }
   */
  checkinTodayHost: (metadata = {}) => {
    const { guestName = '게스트', guestPhoneNumber = '' } = metadata;
    const phoneInfo = guestPhoneNumber ? ` 또는 ${guestPhoneNumber}로` : '로';
    return {
      title: '입주 안내',
      message: `오늘 ${guestName}님이 입주 예정입니다. 입주 안내를 하지 않았다면 메시지${phoneInfo} 안내해주세요.`
    };
  },

  /**
   * 입주 당일 - 게스트에게
   * @param {Object} metadata - { hostPhoneNumber }
   */
  checkinTodayGuest: (metadata = {}) => {
    const { hostPhoneNumber = '' } = metadata;
    const phoneInfo = hostPhoneNumber ? ` 또는 ${hostPhoneNumber}로` : '로';
    return {
      title: '입주 안내',
      message: `오늘은 입주일입니다. 입주 이후 이지스테이를 통해 입주 확정을 부탁드립니다. 입주 안내를 받지 못했다면 메시지${phoneInfo} 문의해주세요.`
    };
  },

  /**
   * 입주 확정 - 호스트에게
   * @param {Object} metadata - { guestName }
   */
  checkinConfirmed: (metadata = {}) => {
    const { guestName = '게스트' } = metadata;
    return {
      title: '입주 완료',
      message: `${guestName}님이 입주를 완료했어요.`
    };
  },

  /**
   * 퇴실 N일 전 - 게스트에게
   * @param {Object} metadata - { daysLeft, checkOutGuide }
   */
  checkoutReminder: (metadata = {}) => {
    const { daysLeft = 3, checkOutGuide = '' } = metadata;
    const guideInfo = checkOutGuide ? ` ${checkOutGuide}` : '';
    return {
      title: '퇴실 안내',
      message: `퇴실일이 다가오고 있어요. 퇴실 안내를 확인해주세요.${guideInfo}`
    };
  },

  /**
   * 퇴실 당일 - 게스트에게
   */
  checkoutToday: (metadata = {}) => ({
    title: '퇴실 안내',
    message: '오늘은 퇴실일입니다. 이용해주셔서 감사합니다. 퇴실 후 이지스테이를 통해 퇴실 완료를 부탁드립니다.'
  }),

  /**
   * 퇴실 확인 요청 - 호스트에게
   * @param {Object} metadata - { guestName, roomName }
   */
  checkoutRequest: (metadata = {}) => {
    const { guestName = '게스트', roomName = '방' } = metadata;
    return {
      title: '퇴실 확인 요청',
      message: `${guestName}님이 ${roomName}에서 퇴실 완료 후 보증금 반환을 요청했습니다. 방 점검 후 <퇴실 확인>을 진행해주세요.\n※ 확인 후 보증금 반환이 진행되며, 장기간 지연 시 자동으로 반환 처리됩니다.`
    };
  },

  /**
   * 퇴실 완료 - 공통
   */
  checkoutConfirmed: (metadata = {}) => ({
    title: '퇴실 완료',
    message: '퇴실이 완료되었습니다.'
  }),

  // =====================================================
  // D. 옵션 상품 관련 알림
  // =====================================================

  /**
   * 옵션 추가 마감 임박 - 게스트에게
   */
  optionDeadline: (metadata = {}) => ({
    title: '옵션 마감 안내',
    message: '옵션 상품은 입주 5일 전까지 추가할 수 있어요.'
  }),

  // =====================================================
  // E. 채팅 관련 알림
  // =====================================================

  /**
   * 새 메시지 도착
   * @param {Object} metadata - { senderName }
   */
  message: (metadata = {}) => {
    const { senderName = '' } = metadata;
    const sender = senderName ? `${senderName}님으로부터 ` : '';
    return {
      title: '새 메시지',
      message: `${sender}새 메시지가 도착했습니다.`
    };
  },

  // =====================================================
  // F. 공지/문의 관련 알림
  // =====================================================

  /**
   * 공지사항 등록
   * @param {Object} metadata - { noticeTitle }
   */
  notice: (metadata = {}) => {
    const { noticeTitle = '' } = metadata;
    const title = noticeTitle ? `[${noticeTitle}]` : '';
    return {
      title: '새 공지사항',
      message: `${title} 새로운 공지사항이 등록되었습니다.`
    };
  },

  /**
   * 문의 답변 완료
   */
  inquiryAnswered: (metadata = {}) => ({
    title: '문의 답변 완료',
    message: '문의하신 내용에 답변이 등록되었습니다.'
  }),

  // =====================================================
  // G. 매물 심사 관련 알림
  // =====================================================

  /**
   * 매물 심사 결과 - 승인
   * @param {Object} metadata - { roomName }
   */
  propertyApproved: (metadata = {}) => {
    const { roomName = '매물' } = metadata;
    return {
      title: '매물 심사 승인',
      message: `${roomName}이(가) 심사에 승인되었습니다. 이제 게시할 수 있어요.`
    };
  },

  /**
   * 매물 심사 결과 - 반려
   * @param {Object} metadata - { roomName, rejectReason }
   */
  propertyRejected: (metadata = {}) => {
    const { roomName = '매물', rejectReason = '' } = metadata;
    const reason = rejectReason ? ` 사유: ${rejectReason}` : '';
    return {
      title: '매물 심사 반려',
      message: `${roomName}이(가) 심사에서 반려되었습니다.${reason}`
    };
  }
};

module.exports = {
  NotificationMessages,
  CANCEL_TYPES,
  CANCEL_COMMENTS
};
