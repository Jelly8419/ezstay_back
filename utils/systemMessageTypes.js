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

  // 퇴실 보류/합의 관련
  DEPOSIT_HOLD_REQUESTED: 'deposit_hold_requested',                   // 호스트 보증금 보류 신청
  DEPOSIT_HOLD_APPROVED: 'deposit_hold_approved',                     // 관리자 보류 승인
  DEPOSIT_HOLD_REJECTED: 'deposit_hold_rejected',                     // 관리자 보류 거절 (카운트다운 재개)
  DEPOSIT_FORCE_HELD: 'deposit_force_held',                           // 관리자 강제 반환보류
  DEPOSIT_AGREEMENT_SUBMITTED: 'deposit_agreement_submitted',         // 호스트 합의 내용 제출
  DEPOSIT_AGREEMENT_ACCEPTED: 'deposit_agreement_accepted',           // 게스트 합의 동의 완료
  DEPOSIT_DEDUCTION_CONFIRMED: 'deposit_deduction_confirmed',         // 차감 확정
  DEPOSIT_RETURN_CONFIRMED: 'deposit_return_confirmed',               // 반환 확정
  DEPOSIT_AUTO_RETURNED: 'deposit_auto_returned',                     // 데드라인 초과 보증금 전액 자동반환
  CHECKOUT_AUTO_REQUESTED: 'checkout_auto_requested',                 // 퇴실시각+48h 자동 퇴실요청

  // 호스트 취소 요청
  CANCEL_REQUEST_BY_HOST: 'cancel_request_by_host',                   // 호스트 계약 취소 요청 (관리자 승인 필요)

  // 관리자 처리
  CONTRACT_FORCE_CANCELLED: 'contract_force_cancelled',               // 관리자 강제 취소
  HOST_CANCEL_REQUEST_APPROVED: 'host_cancel_request_approved',       // 호스트 취소 요청 승인
  HOST_CANCEL_REQUEST_REJECTED: 'host_cancel_request_rejected',       // 호스트 취소 요청 거절
  CANCEL_REQUEST_SUBMITTED: 'cancel_request_submitted',               // 게스트 취소 요청 접수 (입주 후)

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
    [SystemMessageTypes.CHECK_IN_REMINDER]: `입주일이 1일 남았습니다. 잊지 말고 입주 준비 해주세요.`,
    [SystemMessageTypes.CHECK_OUT_REMINDER]: `퇴실일이 1일 남았습니다. 퇴실 준비를 해주세요.`,
    [SystemMessageTypes.CHECK_OUT_COMPLETED]: `퇴실이 완료되었습니다.`,
    [SystemMessageTypes.REFUND_REQUESTED]: `환불 요청이 접수되었습니다.\n금액: ${data.refundAmount || '계산 중'}원\n관리자 승인 후 처리 예정입니다.`,
    [SystemMessageTypes.REFUND_APPROVED]: `환불이 자동 승인되었습니다.\n금액: ${data.refundAmount || '계산 중'}원\n영업일 기준 5일 내 처리됩니다.`,
    [SystemMessageTypes.REFUND_COMPLETED]: `환불이 완료되었습니다.\n금액: ${data.amount ? data.amount.toLocaleString() + '원' : '확인 필요'}`,
    [SystemMessageTypes.DEPOSIT_HOLD_REQUESTED]: `호스트가 퇴실 확인 보류를 신청했습니다. 관리자 승인을 기다리고 있습니다.`,
    [SystemMessageTypes.DEPOSIT_HOLD_APPROVED]: `관리자가 보증금 보류를 승인했습니다. 합의 절차가 시작됩니다. (기한: 10일)`,
    [SystemMessageTypes.DEPOSIT_HOLD_REJECTED]: `관리자가 보증금 보류 신청을 거절했습니다. 호스트 퇴실확인 카운트다운이 재개됩니다.`,
    [SystemMessageTypes.DEPOSIT_FORCE_HELD]: `관리자에 의해 보증금이 반환보류 처리되었습니다. 합의 절차가 시작됩니다.`,
    [SystemMessageTypes.DEPOSIT_AGREEMENT_SUBMITTED]: `호스트가 합의 내용을 제출했습니다.\n차감 요청 금액: ${data.deductAmount != null ? data.deductAmount.toLocaleString() + '원' : '확인 필요'}`,
    [SystemMessageTypes.DEPOSIT_AGREEMENT_ACCEPTED]: `합의가 완료되었습니다. 보증금 정산이 진행됩니다.`,
    [SystemMessageTypes.DEPOSIT_DEDUCTION_CONFIRMED]: `보증금 차감이 확정되었습니다. 차감분은 호스트에게 정산되며, 잔액은 게스트에게 반환됩니다.`,
    [SystemMessageTypes.DEPOSIT_RETURN_CONFIRMED]: `보증금 전액 반환이 확정되었습니다. 환불이 진행됩니다.`,
    [SystemMessageTypes.DEPOSIT_AUTO_RETURNED]: `합의 기한(10일)이 경과하여 보증금이 게스트에게 전액 반환확정됩니다.`,
    [SystemMessageTypes.CHECKOUT_AUTO_REQUESTED]: `퇴실 시간 경과 후 자동으로 퇴실 요청이 처리되었습니다. 호스트님의 퇴실 확인을 기다리고 있습니다.`,
    [SystemMessageTypes.CANCEL_REQUEST_BY_HOST]: `호스트가 계약 취소를 요청했습니다. 관리자 확인 후 처리됩니다.`,
    [SystemMessageTypes.CONTRACT_FORCE_CANCELLED]: `관리자에 의해 계약이 강제 취소되었습니다.${data.reason ? `\n사유: ${data.reason}` : ''}`,
    [SystemMessageTypes.HOST_CANCEL_REQUEST_APPROVED]: `호스트의 취소 요청이 승인되었습니다. 계약이 취소 처리됩니다.`,
    [SystemMessageTypes.HOST_CANCEL_REQUEST_REJECTED]: `호스트의 취소 요청이 거절되었습니다. 계약은 유지됩니다.`,
    [SystemMessageTypes.CANCEL_REQUEST_SUBMITTED]: `취소 요청이 접수되었습니다. 관리자 확인 후 처리됩니다.`,
    [SystemMessageTypes.IMPORTANT_NOTICE]: `${data.notice || '중요 공지사항이 있습니다'}`,
    [SystemMessageTypes.REVIEW_REQUEST]: `숙소 이용은 어떠셨나요?\n리뷰를 남겨주시면 큰 도움이 됩니다 ⭐`
  };

  return templates[type] || '시스템 메시지';
};

module.exports = {
  SystemMessageTypes,
  getSystemMessageTemplate
};
