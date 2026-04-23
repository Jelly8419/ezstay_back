/**
 * brokerIncentiveCalculator.js — 중개인 인센티브 단일 산출 유틸
 *
 * 목적:
 *  - Settlement.hostPlatformFee(3.3%) × 중개인 적용률 기반 인센티브 계산
 *  - 개인/사업자 타입에 따라 세무 처리 분기:
 *      individual → 기타소득 원천징수 8.8% (주민세 포함)
 *      business   → 세금계산서 수취 (원천징수 없음, VAT 분리 저장)
 *
 * 호출 위치:
 *  - schedulers/contractScheduler.js 또는 Settlement.status=READY 전환 지점
 *    → BrokerIncentive.create 시 저장 값 산출
 *  - services/brokerIncentiveAggregator.js
 *    → 월별 payout 집계 (이미 저장된 값 합산만 하므로 직접 호출 없음)
 *
 * 정책 (절사 일관성):
 *  - 모든 산출에서 원 미만 Math.floor (feeCalculator 와 동일 정책)
 *  - 세법 관례(supply × 1.1 = total, gross × 0.912 = net) 와 1원 차이 허용
 *  - 런칭 후 세무사 상담 결과에 따라 반올림 전환 가능 (스냅샷은 유지)
 *
 * 불변식 (stringent):
 *  - individual: gross = withholding + net, supply = 0, vat = 0
 *  - business  : gross = supply + vat,      net = gross, withholding = 0
 */

'use strict';

const { splitVatFromTotal } = require('./feeCalculator');

/** 기타소득 원천징수율 (소득세 8% + 주민세 0.8% = 8.8% VAT 포함 간이과세) */
const INDIVIDUAL_WITHHOLDING_RATE = 0.088;

/**
 * 지급 대상액 (gross) 계산
 * - gross = floor(baseFee × appliedRate)
 * - 음수 baseFee / 음수 rate 는 0 으로 방어
 *
 * @param {number} baseFee     기준 금액 (= settlement.hostPlatformFee, VAT 포함 총액)
 * @param {number} appliedRate 적용 요율 (0.5 = 50%)
 * @returns {number} gross (0 이상 정수)
 */
function calculateGross(baseFee, appliedRate) {
  const safeBase = Math.max(0, Math.floor(baseFee || 0));
  const safeRate = Math.max(0, Number(appliedRate) || 0);
  return Math.floor(safeBase * safeRate);
}

/**
 * 개인 중개인 인센티브 산출
 *  - withholding = floor(gross × 8.8%)
 *  - net = gross - withholding (잔여 방식으로 불변식 보장)
 *
 * @param {number} gross
 * @returns {{ gross: number, withholding: number, supply: 0, vat: 0, net: number }}
 */
function calculateIndividualPayout(gross) {
  const safeGross = Math.max(0, Math.floor(gross || 0));
  const withholding = Math.floor(safeGross * INDIVIDUAL_WITHHOLDING_RATE);
  const net = safeGross - withholding;
  return {
    gross: safeGross,
    withholding,
    supply: 0,
    vat: 0,
    net,
  };
}

/**
 * 사업자 중개인 인센티브 산출
 *  - supply = floor(gross × 10/11), vat = gross - supply (feeCalculator 와 동일 방식)
 *  - net = gross (원천징수 없음)
 *
 * @param {number} gross
 * @returns {{ gross: number, withholding: 0, supply: number, vat: number, net: number }}
 */
function calculateBusinessPayout(gross) {
  const safeGross = Math.max(0, Math.floor(gross || 0));
  const { supply, vat } = splitVatFromTotal(safeGross);
  return {
    gross: safeGross,
    withholding: 0,
    supply,
    vat,
    net: safeGross,
  };
}

/**
 * 중개인 인센티브 산출 (통합 진입점)
 *  - BrokerIncentive 행에 저장할 모든 금액 필드를 반환
 *
 * @param {Object} params
 * @param {number} params.baseFee     settlement.hostPlatformFee
 * @param {number} params.appliedRate broker_rates.rate (결제 시점 스냅샷)
 * @param {'individual'|'business'} params.brokerType
 * @returns {{ gross: number, withholding: number, supply: number, vat: number, net: number }}
 */
function calculateBrokerIncentive({ baseFee, appliedRate, brokerType }) {
  if (brokerType !== 'individual' && brokerType !== 'business') {
    throw new Error(`Invalid brokerType: ${brokerType}`);
  }
  const gross = calculateGross(baseFee, appliedRate);
  return brokerType === 'individual'
    ? calculateIndividualPayout(gross)
    : calculateBusinessPayout(gross);
}

/**
 * 불변식 검증 (개발/테스트용 가드)
 *  - individual: gross = withholding + net
 *  - business  : gross = supply + vat, net = gross
 *
 * @param {{ gross, withholding, supply, vat, net }} result
 * @param {'individual'|'business'} brokerType
 * @returns {boolean}
 */
function verifyInvariant(result, brokerType) {
  const { gross, withholding, supply, vat, net } = result;
  if (brokerType === 'individual') {
    return supply === 0 && vat === 0 && gross === withholding + net;
  }
  if (brokerType === 'business') {
    return withholding === 0 && gross === supply + vat && net === gross;
  }
  return false;
}

module.exports = {
  INDIVIDUAL_WITHHOLDING_RATE,
  calculateGross,
  calculateIndividualPayout,
  calculateBusinessPayout,
  calculateBrokerIncentive,
  verifyInvariant,
};
