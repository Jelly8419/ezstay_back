'use strict';

/**
 * 입주 준비 서비스 — 환불/취소/반품 정책 판정 헬퍼
 *
 * 출처: Notion "임대인, 임차인 환불 로직 추가 필요" (2026-05-16)
 *
 * ── 임차인 (옵션: 입주용품 구매 / 침구류 대여) ──
 *   | 시점                         | 취소        | 반품 |
 *   | 결제 전 (PENDING)             | 불가        | 불가 |
 *   | 결제완료 ~ 입주 D-5 전         | 가능(전액)   | 불가 |
 *   | 입주 D-5 이후 ~ 입주일         | 부분 가능*   | 불가 |
 *   | 입주일 ~ 퇴실일                | 불가        | 가능 |
 *   | 퇴실일 이후                    | 불가        | 불가 |
 *   * D-5 이후 취소는 deliveryStatus 가 PENDING(배송 전)일 때만 가능
 *
 *   배송비 차감: 기존 렌탈과 동일 (왕복배송비 = RENTAL_ROUND_TRIP_SHIPPING_COST)
 *     - 취소: deliveryStatus IN_TRANSIT 이면 차감 (단 본 정책상 D-5 이후 취소는 PENDING 만 → 실무상 미차감)
 *     - 반품: 배송 완료분 수거 → 왕복배송비 차감
 *
 * ── 임대인 (청소 서비스) ──
 *   | 시점                                  | 환불 금액         |
 *   | 결제완료 ~ 청소 희망일 2일 전           | 전액 환불 (100%)  |
 *   | 청소 희망일 D-1 ~ 당일                  | 10,000원 차감     |
 *   | 청소 희망 시간 1시간 전부터              | 환불 불가         |
 *
 * 모든 날짜 비교는 KST 기준 (utils/moveInGuestPaymentGuard 패턴 재사용).
 */

const { RENTAL_ROUND_TRIP_SHIPPING_COST } = require('./rentalOrderHelper');

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// 임대인 청소 환불 — 희망일 D-1~당일 구간 차감액
const CLEANING_LATE_CANCEL_DEDUCTION = 10000;

/**
 * 'YYYY-MM-DD' | Date → KST 자정의 UTC Date.
 * (moveInGuestPaymentGuard.parseCheckInToKstMidnight 와 동일 로직)
 */
function toKstMidnight(input) {
  if (input == null) throw new TypeError('date is required');

  if (typeof input === 'string') {
    if (!/^\d{4}-\d{2}-\d{2}/.test(input)) {
      throw new TypeError(`Invalid date string: ${input}`);
    }
    const [y, m, d] = input.slice(0, 10).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d) - KST_OFFSET_MS);
  }
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) throw new TypeError('Invalid Date');
    const y = input.getUTCFullYear();
    const m = input.getUTCMonth();
    const d = input.getUTCDate();
    return new Date(Date.UTC(y, m, d) - KST_OFFSET_MS);
  }
  throw new TypeError(`Unsupported type: ${typeof input}`);
}

/** 해당 KST 일자의 23:59:59.999 UTC Date */
function endOfKstDay(kstMidnight) {
  return new Date(kstMidnight.getTime() + DAY_MS - 1);
}

// ===================================================================
// 임차인 — 옵션 취소 (즉시)
// ===================================================================

/**
 * 옵션 취소 가능 여부 + 환불 금액 판정.
 *
 * @param {Object} params
 * @param {string|Date} params.checkInDate  케이스 입주일
 * @param {string|Date} params.checkOutDate 케이스 퇴실일
 * @param {string} params.orderStatus       MoveInGuestOrder.status
 * @param {string} params.deliveryStatus    MoveInGuestOrder.deliveryStatus
 * @param {number} params.orderTotalAmount  활성 라인 합계
 * @param {Date}   [params.now=new Date()]
 * @returns {{ allowed: boolean, reason?: string, refundAmount: number, shippingDeduction: number }}
 */
function evaluateGuestCancel({
  checkInDate,
  orderStatus,
  deliveryStatus,
  orderTotalAmount,
  now = new Date()
}) {
  const deny = (reason) => ({ allowed: false, reason, refundAmount: 0, shippingDeduction: 0 });

  if (!['PAID', 'PARTIAL_REFUND'].includes(orderStatus)) {
    return deny('결제 완료된 주문만 취소할 수 있습니다.');
  }

  const checkInKst = toKstMidnight(checkInDate);
  // D-5 마감 = (입주일 - 5일) 의 KST 23:59:59.999
  const d5Deadline = endOfKstDay(new Date(checkInKst.getTime() - 5 * DAY_MS));
  const checkInStart = checkInKst; // 입주일 KST 00:00

  const t = now.getTime();

  // 입주일 당일 00:00 이후 → 취소 불가 (반품 구간)
  if (t >= checkInStart.getTime()) {
    return deny('입주일 이후에는 옵션 취소가 불가합니다. (반품 요청을 이용하세요)');
  }

  let shippingDeduction = 0;
  let refundAmount = orderTotalAmount;

  if (t <= d5Deadline.getTime()) {
    // 결제완료 ~ D-5 전: 전액 취소 가능
    shippingDeduction = 0;
  } else {
    // D-5 이후 ~ 입주일 전: 배송 전(PENDING)만 가능
    if (deliveryStatus !== 'PENDING') {
      return deny('입주 5일 전 이후에는 배송 시작 전 주문만 취소할 수 있습니다.');
    }
    shippingDeduction = 0; // 배송 전이므로 배송비 미발생
  }

  refundAmount = orderTotalAmount - shippingDeduction;
  if (refundAmount <= 0) {
    return deny(`환불 금액(${orderTotalAmount}원)이 배송비(${shippingDeduction}원) 이하입니다.`);
  }

  return { allowed: true, refundAmount, shippingDeduction };
}

// ===================================================================
// 임차인 — 옵션 반품 (요청 → 관리자 승인)
// ===================================================================

/**
 * 반품 요청 가능 여부 판정 (입주일 ~ 퇴실일, 배송 완료분).
 * 실제 환불 금액(수거비 차감)은 관리자 승인 시 확정.
 *
 * @returns {{ allowed: boolean, reason?: string }}
 */
function evaluateGuestReturn({
  checkInDate,
  checkOutDate,
  orderStatus,
  deliveryStatus,
  now = new Date()
}) {
  const deny = (reason) => ({ allowed: false, reason });

  if (!['PAID', 'PARTIAL_REFUND'].includes(orderStatus)) {
    return deny('결제 완료된 주문만 반품할 수 있습니다.');
  }
  if (deliveryStatus !== 'DELIVERED') {
    return deny('배송이 완료된 주문만 반품 요청할 수 있습니다.');
  }

  const checkInKst = toKstMidnight(checkInDate);
  const checkOutEnd = endOfKstDay(toKstMidnight(checkOutDate));
  const t = now.getTime();

  if (t < checkInKst.getTime()) {
    return deny('입주일 이후부터 반품 요청이 가능합니다.');
  }
  if (t > checkOutEnd.getTime()) {
    return deny('퇴실일 이후에는 반품 요청이 불가합니다.');
  }

  return { allowed: true };
}

/**
 * 반품 승인 시 수거비 차감 후 환불 금액 산정.
 * 왕복배송비는 렌탈과 동일 상수 사용.
 *
 * @param {number} itemTotalAmount  반품 대상 합계
 * @param {boolean} [waiveShipping=false]  같은 케이스에 이미 수거 진행 중(APPROVED) 건이
 *                                         있어 기사 방문이 예정된 경우 배송비 면제
 */
function calcReturnRefund(itemTotalAmount, waiveShipping = false) {
  const shippingDeduction = waiveShipping ? 0 : RENTAL_ROUND_TRIP_SHIPPING_COST;
  const finalRefundAmount = itemTotalAmount - shippingDeduction;
  return { shippingDeduction, finalRefundAmount };
}

/**
 * 부분 취소/환불 금액 산정 (수량 단위).
 * 라인 분할 없이: full(cancelQty===quantity)이면 라인 CANCELLED,
 * 부분이면 quantity 차감 + refundAmount 누적.
 *
 * @param {Array} items  MoveInGuestOrderItem 인스턴스/plain (id,quantity,pricePerItem,totalPrice,refundAmount,status)
 * @param {Map<number,number>} qtyMap  itemId → 취소/반품 수량
 * @returns {{ refundAmount:number, lineUpdates:Array<{item,isFull,cancelQty,itemRefund,remainQty}> }}
 */
function calcPartialRefund(items, qtyMap) {
  let refundAmount = 0;
  const lineUpdates = [];
  for (const item of items) {
    const cancelQty = qtyMap.get(item.id);
    if (cancelQty == null) continue;
    const pricePerItem = Number(item.pricePerItem);
    const itemRefund = pricePerItem * cancelQty;
    const isFull = cancelQty === item.quantity;
    refundAmount += itemRefund;
    lineUpdates.push({
      item,
      isFull,
      cancelQty,
      itemRefund,
      remainQty: item.quantity - cancelQty
    });
  }
  return { refundAmount, lineUpdates };
}

// ===================================================================
// 임대인 — 청소 환불 (셀프 즉시)
// ===================================================================

/**
 * 청소 환불 금액 판정 (3구간).
 *
 * 기준: cleaningDate(YYYY-MM-DD) + cleaningTime('HH:MM:SS', KST)
 *  - 결제완료 ~ 희망일 2일 전(D-2 이전 종료): 전액
 *  - 희망일 D-1 ~ 당일: 10,000원 차감
 *  - 희망 시간 1시간 전부터: 불가
 *
 * cleaningDate/cleaningTime 가 없으면 — 희망 시간 미지정 → 보수적으로 전액 환불 허용.
 *
 * @param {Object} params
 * @param {string|Date|null} params.cleaningDate
 * @param {string|null} params.cleaningTime  'HH:MM:SS' or 'HH:MM'
 * @param {number} params.paidAmount
 * @param {Date} [params.now=new Date()]
 * @returns {{ allowed: boolean, reason?: string, refundAmount: number, deduction: number }}
 */
function evaluateCleaningRefund({ cleaningDate, cleaningTime, paidAmount, now = new Date() }) {
  const deny = (reason) => ({ allowed: false, reason, refundAmount: 0, deduction: 0 });

  if (!cleaningDate) {
    // 희망일 미지정 → 시점 가드 불가, 전액 환불 허용
    return { allowed: true, refundAmount: paidAmount, deduction: 0 };
  }

  const desiredMidnight = toKstMidnight(cleaningDate); // 희망일 KST 00:00 (UTC 표현)
  const t = now.getTime();

  // 희망일 2일 전의 KST 23:59:59.999 = (희망일 - 2일) day end
  const fullRefundDeadline = endOfKstDay(new Date(desiredMidnight.getTime() - 2 * DAY_MS));

  // 희망 시간 1시간 전 (cleaningTime 있을 때만). 없으면 희망일 KST 00:00 기준.
  let cutoffNoRefund;
  if (cleaningTime && /^([01]\d|2[0-3]):([0-5]\d)/.test(cleaningTime)) {
    const [hh, mm] = cleaningTime.split(':').map(Number);
    const desiredDateTime = new Date(desiredMidnight.getTime() + (hh * 60 + mm) * 60 * 1000);
    cutoffNoRefund = new Date(desiredDateTime.getTime() - 60 * 60 * 1000); // -1h
  } else {
    cutoffNoRefund = desiredMidnight; // 시간 미지정 → 당일 0시부터 불가
  }

  if (t >= cutoffNoRefund.getTime()) {
    return deny('청소 희망 시간 1시간 전부터는 환불이 불가합니다.');
  }

  if (t <= fullRefundDeadline.getTime()) {
    // 결제완료 ~ 희망일 2일 전: 전액
    return { allowed: true, refundAmount: paidAmount, deduction: 0 };
  }

  // 희망일 D-1 ~ (희망 시간 1시간 전): 10,000원 차감
  const deduction = CLEANING_LATE_CANCEL_DEDUCTION;
  const refundAmount = paidAmount - deduction;
  if (refundAmount <= 0) {
    return deny(`환불 금액(${paidAmount}원)이 차감액(${deduction}원) 이하입니다.`);
  }
  return { allowed: true, refundAmount, deduction };
}

module.exports = {
  RENTAL_ROUND_TRIP_SHIPPING_COST,
  CLEANING_LATE_CANCEL_DEDUCTION,
  toKstMidnight,
  endOfKstDay,
  evaluateGuestCancel,
  evaluateGuestReturn,
  calcReturnRefund,
  calcPartialRefund,
  evaluateCleaningRefund
};
