/**
 * feeCalculator.js — 플랫폼 수수료 단일 산출 유틸
 *
 * 목적:
 *  - 게스트(9.9%) / 호스트(3.3%) 수수료 산출을 단일 지점으로 통합
 *  - VAT 포함 총액을 공급가액 : VAT = 10 : 1 로 분리 저장 (부가세 신고용)
 *  - EZ청소 사용 방의 feeBase 일관성 보장 (계약 시 ↔ 정산 시 동일 기준)
 *
 * 호출 위치:
 *  - controllers/contractController.js  (계약 생성 시 수수료 스냅샷 산출)
 *  - services/settlementService.js       (정산 시 스냅샷 우선, 없으면 재계산)
 *  - utils/refundCalculator.js           (환불 시 platformFeeDeducted VAT 분리)
 *
 * 요율은 모두 VAT 포함 총액 기준 (한국 세법상 세금계산서 발행 시 공급가액은 total × 10/11).
 */

const GUEST_FEE_RATE = 0.099; // VAT 포함, 게스트가 결제 시 추가 부담
const HOST_FEE_RATE = 0.033;  // VAT 포함, 정산 시 차감
const VAT_RATE = 0.1;         // 부가가치세율 10%

/**
 * 수수료 산출 기준 금액 (feeBase) 계산
 * - EZ청소 사용 방: cleaningFee 를 feeBase 에서 제외 (청소비는 플랫폼 귀속 → 수수료 이중부과 방지)
 * - 일반 방: cleaningFee 포함
 * - 할인은 항상 차감
 * - 0 미만으로 내려가지 않도록 Math.max(0, ...) 방어
 *
 * @param {Object} params
 * @param {number} params.rentalFee        임대료
 * @param {number} params.maintenanceFee   관리비
 * @param {number} params.cleaningFee      청소비 (호스트 설정값 또는 EZ 계산값)
 * @param {number} [params.discountAmount=0] 할인액
 * @param {boolean} [params.hasEzCleaningService=false] EZ청소 사용 여부
 * @returns {number} feeBase (0 이상의 정수 원화)
 */
function calculateFeeBase({
  rentalFee = 0,
  maintenanceFee = 0,
  cleaningFee = 0,
  discountAmount = 0,
  hasEzCleaningService = false,
}) {
  const hostCleaningFee = hasEzCleaningService ? 0 : cleaningFee;
  return Math.max(0, rentalFee + maintenanceFee + hostCleaningFee - discountAmount);
}

/**
 * 게스트 수수료 계산 (9.9% VAT 포함)
 * - total = floor(feeBase × 9.9%)
 * - supply = floor(total × 10/11)  ← 공급가액
 * - vat   = total - supply         ← 잔여가 부가세 (반올림 오차 흡수)
 *
 * @param {number} feeBase
 * @returns {{ total: number, supply: number, vat: number }}
 */
function calculateGuestFee(feeBase) {
  const base = Math.max(0, feeBase | 0);
  const total = Math.floor(base * GUEST_FEE_RATE);
  return splitVatFromTotal(total);
}

/**
 * 호스트 수수료 계산 (3.3% VAT 포함)
 *
 * @param {number} feeBase
 * @returns {{ total: number, supply: number, vat: number }}
 */
function calculateHostFee(feeBase) {
  const base = Math.max(0, feeBase | 0);
  const total = Math.floor(base * HOST_FEE_RATE);
  return splitVatFromTotal(total);
}

/**
 * 이미 저장된 VAT 포함 총액에서 공급가액/VAT 분리
 *
 * 정책: EZStay 는 공급가액 산출 시 원 미만 절사(Math.floor) 적용.
 *       세법 관례(supply × 1.1 = total) 와 1원 차이 날 수 있으나
 *       내부 정책 일관성 우선. 런칭 후 세무사 상담 결과에 따라 반올림 정책으로
 *       전환 가능 (전환 시 기존 스냅샷은 유지, 신규 계약부터 적용).
 *
 * 구현 주의: Math.floor(total / 1.1) 은 부동소수점 오차로 26,400 → 23,999
 *           같은 결과를 만들기 때문에 반드시 (safeTotal * 10) / 11 순서로
 *           정수 연산 후 절사.
 *
 * 불변식: supply + vat === total (항상 보장)
 *
 * @param {number} total  VAT 포함 총액
 * @returns {{ total: number, supply: number, vat: number }}
 */
function splitVatFromTotal(total) {
  const safeTotal = Math.max(0, Math.floor(total || 0));
  // 부동소수점 오차 회피: (total * 10) / 11 정수 연산 순서 필수
  // Math.floor(total / 1.1) 은 26,400 → 23,999 같은 오차 발생하므로 사용 금지
  const supply = Math.floor((safeTotal * 10) / 11);
  const vat = safeTotal - supply;
  return { total: safeTotal, supply, vat };
}

module.exports = {
  GUEST_FEE_RATE,
  HOST_FEE_RATE,
  VAT_RATE,
  calculateFeeBase,
  calculateGuestFee,
  calculateHostFee,
  splitVatFromTotal,
};
