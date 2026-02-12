/**
 * Settlement Service
 * 정산 금액 계산 및 상태 관리 로직
 */

/**
 * 영업일 추가 계산 (주말 제외, 공휴일은 미포함)
 * @param {Date} fromDate - 시작일
 * @param {number} businessDays - 추가할 영업일 수
 * @returns {Date} 영업일 기준 결과 날짜
 */
const addBusinessDays = (fromDate, businessDays) => {
  const date = new Date(fromDate);
  let added = 0;
  while (added < businessDays) {
    date.setDate(date.getDate() + 1);
    const dayOfWeek = date.getDay();
    // 주말(토=6, 일=0) 제외
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      added++;
    }
  }
  return date;
};

/**
 * 정산 예정일 계산 (입주일 + 3영업일)
 * 정책: 입주일 기준 3영업일 후 정산
 *
 * @param {Date|string} checkInDate - 체크인(입주) 날짜
 * @returns {Date} 정산 예정일
 */
const calculateSettlementDate = (checkInDate) => {
  return addBusinessDays(new Date(checkInDate), 3);
};

/**
 * (하위 호환) 체크아웃 기준 정산 예정일 계산
 * @deprecated 입주일 기준으로 변경됨, 기존 코드 호환용
 * @param {Date|string} checkOutDate - 체크아웃 날짜
 * @returns {Date} 정산 예정일
 */
const calculateSettlementDateByCheckout = (checkOutDate) => {
  const date = new Date(checkOutDate);
  date.setDate(date.getDate() + 7);
  return date;
};

/**
 * 정산 상태 판단
 * @param {Date|string} checkInDate - 체크인(입주) 날짜
 * @returns {'pending'|'completed'} 정산 상태
 */
const getSettlementStatus = (checkInDate) => {
  const settlementDate = calculateSettlementDate(checkInDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return settlementDate <= today ? 'completed' : 'pending';
};

/**
 * 호스트 플랫폼 수수료율 (3.3%)
 * - 게스트 수수료 (9.9%): 게스트가 결제 시 추가 부담 → Contract.platformFee
 * - 호스트 수수료 (3.3%): 정산 시 차감 → Contract.hostPlatformFee
 */
const HOST_PLATFORM_FEE_RATE = 0.033;

/**
 * 정산 금액 계산
 * @param {Object} contract - 계약 정보
 * @param {number} contract.rentalFee - 임대료
 * @param {number} contract.maintenanceFee - 관리비
 * @param {number} contract.cleaningFee - 청소비
 * @param {number} contract.hostPlatformFee - 호스트 플랫폼 수수료 (3.3%)
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
    hostPlatformFee: storedHostPlatformFee
  } = contract;

  const { hasEzCleaningService = false } = options;

  // EZ청소서비스 사용 시 청소비는 플랫폼이 가져감 (호스트 정산에서 제외)
  const hostCleaningFee = hasEzCleaningService ? 0 : cleaningFee;

  // 소계: 임대료 + 관리비 + 청소비(EZ서비스 미사용 시만)
  const subtotal = rentalFee + maintenanceFee + hostCleaningFee;

  // 호스트 플랫폼 수수료 (3.3%)
  // DB에 저장된 값 사용, 없으면 동적 계산 (이전 계약 호환)
  const hostPlatformFee = storedHostPlatformFee != null
    ? storedHostPlatformFee
    : Math.floor(subtotal * HOST_PLATFORM_FEE_RATE);

  // 기본 정산 금액 (호스트 수령액)
  const grossSettlement = subtotal - hostPlatformFee;

  // 환불 금액 계산 (완료된 환불만)
  let totalRefundAmount = 0;
  let rentalFeeRefund = 0;
  let maintenanceFeeRefund = 0;
  let cleaningFeeRefund = 0;

  refunds.forEach(refund => {
    if (refund.refundStatus === 'COMPLETED') {
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

  return {
    rentalFee,
    maintenanceFee,
    cleaningFee: hostCleaningFee,  // 호스트에게 정산되는 청소비
    originalCleaningFee: cleaningFee,  // 원래 청소비 (표시용)
    hasEzCleaningService,
    subtotal,
    platformFee: hostPlatformFee,  // 호스트 수수료 (3.3%)
    platformFeeRate: HOST_PLATFORM_FEE_RATE * 100,  // 3.3%
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
  addBusinessDays,
  calculateSettlementDate,
  calculateSettlementDateByCheckout,
  getSettlementStatus,
  calculateSettlementAmount,
  calculateRentalDays,
  maskPhoneNumber,
  maskAccountNumber,
  SETTLEMENT_STATUS_LABELS
};
