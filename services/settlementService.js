/**
 * Settlement Service
 * 정산 금액 계산 및 상태 관리 로직
 */

/**
 * 정산 예정일 계산 (체크아웃 + 7일)
 * @param {Date|string} checkOutDate - 체크아웃 날짜
 * @returns {Date} 정산 예정일
 */
const calculateSettlementDate = (checkOutDate) => {
  const date = new Date(checkOutDate);
  date.setDate(date.getDate() + 7);
  return date;
};

/**
 * 정산 상태 판단
 * @param {Date|string} checkOutDate - 체크아웃 날짜
 * @returns {'pending'|'completed'} 정산 상태
 */
const getSettlementStatus = (checkOutDate) => {
  const settlementDate = calculateSettlementDate(checkOutDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return settlementDate <= today ? 'completed' : 'pending';
};

/**
 * 정산 금액 계산
 * @param {Object} contract - 계약 정보
 * @param {number} contract.rentalFee - 임대료
 * @param {number} contract.maintenanceFee - 관리비
 * @param {number} contract.cleaningFee - 청소비
 * @param {number} contract.platformFee - 플랫폼 수수료
 * @param {Array} refunds - 환불 정보 배열
 * @param {Object} options - 옵션
 * @param {boolean} options.hasEzCleaningService - EZ청소서비스 사용 여부
 * @returns {Object} 정산 금액 breakdown
 */
const calculateSettlementAmount = (contract, refunds = [], options = {}) => {
  const {
    rentalFee = 0,
    maintenanceFee = 0,
    cleaningFee = 0,
    platformFee = 0
  } = contract;

  const { hasEzCleaningService = false } = options;

  // EZ청소서비스 사용 시 청소비는 플랫폼이 가져감 (호스트 정산에서 제외)
  const hostCleaningFee = hasEzCleaningService ? 0 : cleaningFee;

  // 기본 정산 금액 (호스트 수령액)
  // 소계: 임대료 + 관리비 + 청소비(EZ서비스 미사용 시만)
  const subtotal = rentalFee + maintenanceFee + hostCleaningFee;
  const grossSettlement = subtotal - platformFee;

  // 환불 금액 계산 (완료된 환불만)
  let totalRefundAmount = 0;
  let rentalFeeRefund = 0;
  let maintenanceFeeRefund = 0;
  let cleaningFeeRefund = 0;

  refunds.forEach(refund => {
    if (refund.status === 'COMPLETED') {
      rentalFeeRefund += refund.rentalFeeRefundAmount || 0;
      maintenanceFeeRefund += refund.maintenanceFeeRefundAmount || 0;
      // EZ청소서비스 사용 시 청소비 환불도 호스트 정산에서 제외
      if (!hasEzCleaningService) {
        cleaningFeeRefund += refund.cleaningFeeRefundAmount || 0;
      }
    }
  });

  totalRefundAmount = rentalFeeRefund + maintenanceFeeRefund + cleaningFeeRefund;

  // 최종 정산 금액
  const finalAmount = grossSettlement - totalRefundAmount;

  // 수수료율 계산 (수수료 계산 기준: 임대료 + 관리비 + 청소비(EZ서비스 미사용 시))
  // 실제 수수료율은 9.9%이지만, 표시용으로 실제 비율 계산
  const feeBase = rentalFee + maintenanceFee + hostCleaningFee;
  const platformFeeRate = feeBase > 0 ? Math.round((platformFee / feeBase) * 1000) / 10 : 0;

  return {
    rentalFee,
    maintenanceFee,
    cleaningFee: hostCleaningFee,  // 호스트에게 정산되는 청소비
    originalCleaningFee: cleaningFee,  // 원래 청소비 (표시용)
    hasEzCleaningService,
    subtotal,
    platformFee,
    platformFeeRate,
    grossSettlement,
    refund: {
      hasRefund: totalRefundAmount > 0,
      rentalFeeRefund,
      maintenanceFeeRefund,
      cleaningFeeRefund,
      totalRefundAmount
    },
    finalAmount
  };
};

/**
 * 이용 일수 계산
 * @param {Date|string} checkInDate - 체크인 날짜
 * @param {Date|string} checkOutDate - 체크아웃 날짜
 * @returns {number} 이용 일수
 */
const calculateRentalDays = (checkInDate, checkOutDate) => {
  const start = new Date(checkInDate);
  const end = new Date(checkOutDate);
  const diffTime = Math.abs(end - start);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
};

/**
 * 전화번호 마스킹
 * @param {string} phone - 전화번호
 * @returns {string} 마스킹된 전화번호
 */
const maskPhoneNumber = (phone) => {
  if (!phone) return null;
  // 010-1234-5678 -> 010-****-5678
  return phone.replace(/(\d{3})-?(\d{4})-?(\d{4})/, '$1-****-$3');
};

/**
 * 계좌번호 마스킹
 * @param {string} accountNumber - 계좌번호
 * @returns {string} 마스킹된 계좌번호
 */
const maskAccountNumber = (accountNumber) => {
  if (!accountNumber) return null;
  // 계좌번호 길이에 따라 앞 3자리, 뒤 3자리만 보이게
  const length = accountNumber.length;
  if (length <= 6) return accountNumber;

  const visible = 3;
  const masked = '*'.repeat(length - visible * 2);
  return accountNumber.slice(0, visible) + '-' + masked + '-' + accountNumber.slice(-visible);
};

/**
 * 정산 상태 레이블
 */
const SETTLEMENT_STATUS_LABELS = {
  pending: '정산 예정',
  completed: '정산 완료'
};

module.exports = {
  calculateSettlementDate,
  getSettlementStatus,
  calculateSettlementAmount,
  calculateRentalDays,
  maskPhoneNumber,
  maskAccountNumber,
  SETTLEMENT_STATUS_LABELS
};
