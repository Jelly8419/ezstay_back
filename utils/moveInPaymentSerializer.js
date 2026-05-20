'use strict';

/**
 * 입주 준비 결제 응답 직렬화 공용 헬퍼
 *
 * - 전용 화면 (/api/admin/move-in/payments) 과
 *   메인 화면 (/api/admin/payments/{logs,summary}) 양쪽에서 동일 로직을 쓰도록 추출.
 * - 침구류(BEDDING_SET) 분리 표시: 라인 카테고리 기반 breakdown + productLabel.
 */

/**
 * 라인 합계를 카테고리별로 집계.
 * @param {Array} items - MoveInGuestOrderItem[] (option.category 포함)
 * @returns {Object} { [category]: { amount, qty } }  amount = totalPrice - refundAmount (>0 만)
 */
function buildBreakdown(items) {
  const breakdown = {};
  for (const it of items || []) {
    const cat = it.option?.category || it.category || 'OTHER';
    const total = Number(it.totalPrice) || 0;
    const refunded = Number(it.refundAmount) || 0;
    const net = total - refunded;
    if (net <= 0) continue; // 전액 환불 라인은 제외
    breakdown[cat] = breakdown[cat] || { amount: 0, qty: 0 };
    breakdown[cat].amount += net;
    breakdown[cat].qty   += Number(it.quantity) || 0;
  }
  return breakdown;
}

/**
 * breakdown 기반 라벨링.
 *  - 침구류만        → '침구류대여'
 *  - 침구류 + 기타  → '입주용품+침구류'
 *  - 그 외           → '입주용품'
 */
function productLabel(breakdown) {
  const beddingAmt = breakdown?.BEDDING_SET?.amount ?? 0;
  const hasBedding = beddingAmt > 0;
  const hasOther = Object.entries(breakdown || {})
    .some(([k, v]) => k !== 'BEDDING_SET' && (v?.amount ?? 0) > 0);
  if (hasBedding && hasOther) return '입주용품+침구류';
  if (hasBedding) return '침구류대여';
  return '입주용품';
}

/**
 * 침구류 포함 여부 (혼합 주문 포함).
 * 메인 logs/summary 의 '침구류대여' 필터에서 사용.
 */
function hasBedding(breakdown) {
  return (breakdown?.BEDDING_SET?.amount ?? 0) > 0;
}

module.exports = {
  buildBreakdown,
  productLabel,
  hasBedding
};
