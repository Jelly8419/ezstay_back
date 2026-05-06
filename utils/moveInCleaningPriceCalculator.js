/**
 * moveInCleaningPriceCalculator.js
 * 입주 준비 서비스 청소비 산정
 *
 * PRD 8절 (청소 가격 정책):
 * - 10평 이하        → 50,000원
 * - 10평 초과 ~ 20평 → 70,000원
 * - 20평 초과 ~ 30평 → 90,000원
 * - 이후 10평 단위로 +20,000원
 *
 * 서버에서만 산정. 클라이언트가 보낸 amount는 신뢰하지 않음.
 */

const BASE_PRICE = 50000;
const STEP_PRICE = 20000;
const STEP_PYEONG = 10;
const BASE_PYEONG = 10;

/**
 * 평수 기반 청소비 산정.
 * @param {number} areaPyeong - 방 평수 (양의 실수)
 * @returns {number} 청소비 (원)
 * @throws {Error} 유효하지 않은 평수
 */
function calculateCleaningPrice(areaPyeong) {
  const pyeong = Number(areaPyeong);
  if (!Number.isFinite(pyeong) || pyeong <= 0) {
    throw new Error('areaPyeong은 양의 숫자여야 합니다.');
  }

  if (pyeong <= BASE_PYEONG) return BASE_PRICE;

  const overBase = pyeong - BASE_PYEONG;
  const tier = Math.ceil(overBase / STEP_PYEONG);
  return BASE_PRICE + tier * STEP_PRICE;
}

module.exports = {
  calculateCleaningPrice,
  BASE_PRICE,
  STEP_PRICE,
  STEP_PYEONG
};
