/**
 * 시스템 메시지 타입 상수
 * 채팅방에서 사용되는 시스템 메시지의 종류를 정의
 */

const SystemMessageTypes = {
  // 계약 관련
  CONTRACT_APPROVED: 'contract_approved',           // 계약 승인 / 결제대기
  CONTRACT_REJECTED: 'contract_rejected',           // 계약 거절
  CONTRACT_CANCELED: 'contract_canceled',           // 계약 취소
  PAYMENT_COMPLETED: 'payment_completed',           // 결제 완료
  PAYMENT_EXPIRED: 'payment_expired',               // 결제 시간 만료

  // 체크인/체크아웃
  CHECK_IN_REMINDER: 'check_in_reminder',           // 입실일 D-1
  CHECK_OUT_REMINDER: 'check_out_reminder',         // 퇴실일 D-1
  CHECK_OUT_COMPLETED: 'check_out_completed',       // 퇴실 완료

  // 중요 알림
  IMPORTANT_NOTICE: 'important_notice',             // 중요 공지
  REVIEW_REQUEST: 'review_request',                 // 리뷰 요청
  REFUND_COMPLETED: 'refund_completed'              // 환불 완료
};

/**
 * 시스템 메시지 템플릿 생성
 * @param {string} type - 시스템 메시지 타입
 * @param {object} data - 메시지에 포함될 데이터
 * @returns {string} 완성된 메시지 텍스트
 */
const getSystemMessageTemplate = (type, data = {}) => {
  const templates = {
    [SystemMessageTypes.CONTRACT_APPROVED]: `계약이 승인되었습니다. 계약 완료를 위해 마감 시한 전까지 결제를 완료해주세요. (결제 마감 시한 ${data.paymentDeadline || '확인 필요'})`,
    [SystemMessageTypes.CONTRACT_REJECTED]: `계약이 거절되었습니다.\n사유: ${data.reason || '미제공'}`,
    [SystemMessageTypes.CONTRACT_CANCELED]: `요청에 의해 계약이 취소되었습니다.`,
    [SystemMessageTypes.PAYMENT_COMPLETED]: `결제가 완료되었습니다. 입주일에 맞춰 준비해주세요.`,
    [SystemMessageTypes.PAYMENT_EXPIRED]: `결제 마감 시한이 지나, 계약이 자동 취소되었습니다.`,
    [SystemMessageTypes.CHECK_IN_REMINDER]: `입실일이 1일 남았습니다. 잊지 말고 체크인 준비 해주세요.`,
    [SystemMessageTypes.CHECK_OUT_REMINDER]: `퇴실일이 1일 남았습니다. 체크아웃 준비를 해주세요.`,
    [SystemMessageTypes.CHECK_OUT_COMPLETED]: `퇴실이 완료되었습니다.`,
    [SystemMessageTypes.IMPORTANT_NOTICE]: `${data.notice || '중요 공지사항이 있습니다'}`,
    [SystemMessageTypes.REVIEW_REQUEST]: `숙소 이용은 어떠셨나요?\n리뷰를 남겨주시면 큰 도움이 됩니다 ⭐`,
    [SystemMessageTypes.REFUND_COMPLETED]: `환불이 완료되었습니다.\n금액: ${data.amount ? data.amount.toLocaleString() + '원' : '확인 필요'}`
  };

  return templates[type] || '시스템 메시지';
};

module.exports = {
  SystemMessageTypes,
  getSystemMessageTemplate
};
