/**
 * Settlement Service
 * 정산 금액 계산 및 상태 관리 로직
 */

const {
  addBusinessDays,
  calculateSettlementDate,
  calculatePayoutAvailableDate,
} = require('../utils/businessDayHelper');
const {
  calculateHostFee,
  splitVatFromTotal,
} = require('../utils/feeCalculator');

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
 *
 * @deprecated 요율 상수는 utils/feeCalculator.HOST_FEE_RATE 로 이관. 본 상수는
 *   기존 외부 import 가 있을 수 있어 호환용으로 남김.
 */
const HOST_PLATFORM_FEE_RATE = 0.033;

/**
 * 정산 금액 계산
 * @param {Object} contract - 계약 정보
 * @param {number} contract.rentalFee - 임대료
 * @param {number} contract.maintenanceFee - 관리비
 * @param {number} contract.cleaningFee - 청소비
 * @param {number} contract.hostPlatformFee - 호스트 플랫폼 수수료 (3.3%, VAT 포함 총액)
 * @param {number} [contract.hostPlatformFeeSupply] - 호스트 수수료 공급가액 (스냅샷)
 * @param {number} [contract.hostPlatformFeeVat]    - 호스트 수수료 부가세 (스냅샷)
 * @param {Array} refunds - 환불 정보 배열
 * @param {Object} options - 옵션
 * @param {boolean} options.hasEzCleaningService - EZ청소서비스 사용 여부
 * @returns {Object} 정산 금액 breakdown (platformFee/Supply/Vat 포함)
 */
const calculateSettlementAmount = (contract, refunds = [], options = {}) => {
  const {
    rentalFee = 0,
    maintenanceFee = 0,
    cleaningFee = 0,
    discountAmount = 0,
    hostPlatformFee: storedHostPlatformFee,
    hostPlatformFeeSupply: storedSupply,
    hostPlatformFeeVat: storedVat,
  } = contract;

  const { hasEzCleaningService = false } = options;

  // EZ청소서비스 사용 시 청소비는 플랫폼이 가져감 (호스트 정산에서 제외)
  const hostCleaningFee = hasEzCleaningService ? 0 : cleaningFee;

  // 총액 (할인 전, 수수료 전) — gross_amount 기준
  const grossAmount = rentalFee + maintenanceFee + hostCleaningFee;

  // 할인 적용 후 소계 — 수수료 계산 기준
  const subtotal = grossAmount - discountAmount;

  // 호스트 플랫폼 수수료 (3.3%)
  // 1) Contract 스냅샷(VAT 포함 총액)이 있으면 우선 사용
  //    - supply/vat 도 스냅샷에 있으면 그대로 사용
  //    - 없으면 splitVatFromTotal 로 역산 (기존 계약 호환)
  // 2) 스냅샷이 없으면 feeCalculator 로 재계산 (이전 계약 호환)
  let hostPlatformFee;
  let hostPlatformFeeSupply;
  let hostPlatformFeeVat;
  if (storedHostPlatformFee != null) {
    hostPlatformFee = storedHostPlatformFee;
    if (storedSupply != null && storedVat != null && storedSupply + storedVat === storedHostPlatformFee) {
      hostPlatformFeeSupply = storedSupply;
      hostPlatformFeeVat = storedVat;
    } else {
      const split = splitVatFromTotal(storedHostPlatformFee);
      hostPlatformFeeSupply = split.supply;
      hostPlatformFeeVat = split.vat;
    }
  } else {
    const recomputed = calculateHostFee(subtotal);
    hostPlatformFee = recomputed.total;
    hostPlatformFeeSupply = recomputed.supply;
    hostPlatformFeeVat = recomputed.vat;
  }

  // 수수료 차감 후 정산 기준액
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
    discountAmount,
    hasEzCleaningService,
    grossAmount,      // 할인/수수료 전 총액 → DB gross_amount
    subtotal,         // 할인 적용 후 소계
    platformFee: hostPlatformFee,  // 호스트 수수료 (3.3% VAT 포함)
    platformFeeSupply: hostPlatformFeeSupply,  // 공급가액
    platformFeeVat: hostPlatformFeeVat,        // 부가세
    platformFeeRate: HOST_PLATFORM_FEE_RATE * 100,  // 3.3%
    grossSettlement,  // subtotal - hostPlatformFee (환불 전 호스트 수령 기준액)
    refund: {
      hasRefund: totalRefundAmount > 0,
      rentalFeeRefund,
      maintenanceFeeRefund,
      cleaningFeeRefund,
      totalRefundAmount
    },
    finalAmount       // grossSettlement - totalRefundAmount → DB net_amount
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

/**
 * 호스트 프로모션 혜택 적용 (Settlement 생성 시점)
 * - promotionService.consumeBenefits 로 슬롯 원자적 점유
 * - 적용된 할인 금액만큼 platformFee / grossSettlement / finalAmount 재계산
 *
 * 호스트 런칭 이벤트(LAUNCH_HOST_2026) 정책:
 *   - 유효기간: 오픈(startAt) + 90일, Payment.approvedAt 기준 판정
 *   - 혜택: platformFee 전액 면제 (FEE_WAIVER_FULL)
 *
 * @param {Object} params
 * @param {number} params.hostId
 * @param {number} params.contractId
 * @param {Object} params.settlementAmounts - calculateSettlementAmount() 결과
 * @param {Date}   [params.referenceAt]     - 유효기간 판정 기준 시각 (Payment.approvedAt 전달 권장)
 * @param {Object} [params.transaction]
 * @returns {Promise<{applied: boolean, discountAmount: number, adjustedAmounts: Object}>}
 */
const applyHostBenefit = async ({ hostId, contractId, settlementAmounts, referenceAt, transaction }) => {
  const promotionService = require('./promotionService');

  const consumed = await promotionService.consumeBenefits({
    userId: hostId,
    targetRole: 'HOST',
    applyTrigger: 'SETTLEMENT',
    contractId,
    referenceAt,
    feeCap: settlementAmounts.platformFee, // FEE_WAIVER_FULL 의 할인 상한 = 현재 수수료
    transaction
  });

  const totalDiscount = consumed.reduce((sum, c) => sum + c.discountAmount, 0);
  if (totalDiscount === 0) {
    return { applied: false, discountAmount: 0, adjustedAmounts: settlementAmounts };
  }

  const newPlatformFee = Math.max(0, settlementAmounts.platformFee - totalDiscount);
  const actualDiscount = settlementAmounts.platformFee - newPlatformFee;
  const newGrossSettlement = settlementAmounts.subtotal - newPlatformFee;
  const newFinalAmount = newGrossSettlement - settlementAmounts.refund.totalRefundAmount;

  // 할인 적용된 platformFee 로 VAT 재분리 (부가세 신고 시 플랫폼 실수익 정확 반영)
  const { supply: newSupply, vat: newVat } = splitVatFromTotal(newPlatformFee);

  return {
    applied: true,
    discountAmount: actualDiscount,
    adjustedAmounts: {
      ...settlementAmounts,
      platformFee: newPlatformFee,
      platformFeeSupply: newSupply,
      platformFeeVat: newVat,
      grossSettlement: newGrossSettlement,
      finalAmount: newFinalAmount
    }
  };
};

module.exports = {
  addBusinessDays,
  calculateSettlementDate,
  calculatePayoutAvailableDate,
  calculateSettlementDateByCheckout,
  getSettlementStatus,
  calculateSettlementAmount,
  calculateRentalDays,
  maskPhoneNumber,
  maskAccountNumber,
  applyHostBenefit,
  SETTLEMENT_STATUS_LABELS
};
