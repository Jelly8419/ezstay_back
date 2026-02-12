/**
 * 시스템 메시지 타입 상수
 * 채팅방에서 사용되는 시스템 메시지의 종류를 정의
 */

const SystemMessageTypes = {
  // 계약 관련
  CONTRACT_APPROVED: 'contract_approved',           // 계약 승인 / 결제대기
  CONTRACT_REJECTED: 'contract_rejected',           // 계약 거절
  CONTRACT_CANCELED: 'contract_canceled',           // 계약 취소 (일반)
  CONTRACT_CANCELED_PAYMENT_EXPIRED: 'contract_canceled_payment_expired',  // 결제 기간 만료로 취소
  CONTRACT_CANCELED_BY_HOST: 'contract_canceled_by_host',                  // 호스트 사유로 취소
  CONTRACT_CANCELED_BY_GUEST: 'contract_canceled_by_guest',                // 게스트 사유로 취소
  PAYMENT_COMPLETED: 'payment_completed',           // 결제 완료
  PAYMENT_EXPIRED: 'payment_expired',               // 결제 시간 만료

  // 체크인/체크아웃
  CHECK_IN_REMINDER: 'check_in_reminder',           // 입실일 D-1
  CHECK_OUT_REMINDER: 'check_out_reminder',         // 퇴실일 D-1
  CHECK_OUT_COMPLETED: 'check_out_completed',       // 퇴실 완료

  // 환불 관련
  REFUND_REQUESTED: 'refund_requested',             // 환불 요청 (관리자 승인 대기)
  REFUND_APPROVED: 'refund_approved',               // 환불 승인
  REFUND_COMPLETED: 'refund_completed',             // 환불 완료

  // 중요 알림
  IMPORTANT_NOTICE: 'important_notice',             // 중요 공지
  REVIEW_REQUEST: 'review_request'                  // 리뷰 요청
};

/**
 * 시스템 메시지 템플릿 생성
 * @param {string} type - 시스템 메시지 타입
 * @param {object} data - 메시지에 포함될 데이터
 * @returns {string} 완성된 메시지 텍스트
 */
const getSystemMessageTemplate = (type, data = {}) => {
  const templates = {
    [SystemMessageTypes.CONTRACT_APPROVED]: `계약 요청이 승인되었습니다. 결제 완료 시, 계약이 확정됩니다. (결제 마감 시한: ${data.paymentDeadline || '확인 필요'})`,
    [SystemMessageTypes.CONTRACT_REJECTED]: `계약 요청이 거절되었습니다.`,
    [SystemMessageTypes.CONTRACT_CANCELED]: `계약이 취소되었습니다.`,
    [SystemMessageTypes.CONTRACT_CANCELED_PAYMENT_EXPIRED]: `결제 기간이 만료되어, 계약이 취소되었습니다.`,
    [SystemMessageTypes.CONTRACT_CANCELED_BY_HOST]: `호스트의 사유로 계약이 취소되었습니다.`,
    [SystemMessageTypes.CONTRACT_CANCELED_BY_GUEST]: `게스트의 사유로 계약이 취소되었습니다.`,
    [SystemMessageTypes.PAYMENT_COMPLETED]: `계약이 확정되었습니다. (계약기간: ${data.checkInDate || '확인 필요'} ~ ${data.checkOutDate || '확인 필요'})`,
    [SystemMessageTypes.PAYMENT_EXPIRED]: `결제 기간이 만료되어, 계약이 취소되었습니다.`,
    [SystemMessageTypes.CHECK_IN_REMINDER]: `입실일이 1일 남았습니다. 잊지 말고 체크인 준비 해주세요.`,
    [SystemMessageTypes.CHECK_OUT_REMINDER]: `퇴실일이 1일 남았습니다. 체크아웃 준비를 해주세요.`,
    [SystemMessageTypes.CHECK_OUT_COMPLETED]: `퇴실이 완료되었습니다.`,
    [SystemMessageTypes.REFUND_REQUESTED]: `환불 요청이 접수되었습니다.\n금액: ${data.refundAmount || '계산 중'}원\n관리자 승인 후 처리 예정입니다.`,
    [SystemMessageTypes.REFUND_APPROVED]: `환불이 자동 승인되었습니다.\n금액: ${data.refundAmount || '계산 중'}원\n영업일 기준 5일 내 처리됩니다.`,
    [SystemMessageTypes.REFUND_COMPLETED]: `환불이 완료되었습니다.\n금액: ${data.amount ? data.amount.toLocaleString() + '원' : '확인 필요'}`,
    [SystemMessageTypes.IMPORTANT_NOTICE]: `${data.notice || '중요 공지사항이 있습니다'}`,
    [SystemMessageTypes.REVIEW_REQUEST]: `숙소 이용은 어떠셨나요?\n리뷰를 남겨주시면 큰 도움이 됩니다 ⭐`
  };

  return templates[type] || '시스템 메시지';
};

module.exports = {
  SystemMessageTypes,
  getSystemMessageTemplate
};
