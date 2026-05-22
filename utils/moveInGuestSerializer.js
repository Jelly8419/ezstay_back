/**
 * 입주 준비 서비스 - 임차인 응답 직렬화 유틸
 *
 * 핵심 책임:
 *   1. 청소 관련 필드 강제 비노출 (PRD 14.7, 14.8)
 *      - cleaningStatus, cleaningFee, cleaningPaidAt 절대 응답에 포함 X
 *   2. 주소 마스킹 (PRD 6.2 / MVP 기본값)
 *      - 비로그인 미리보기: detail_address 마스킹
 *      - 로그인 + 매칭된 임차인: 풀 노출
 *   3. 도어락/공동현관 비밀번호 절대 비노출
 *      - 임차인은 임대인이 별도로 전달해야 함
 *
 * 사용 위치:
 *   - controllers/guestMoveIn*Controller (모든 응답 빌드 시 강제 사용)
 */

const { toKSTString } = require('./dateHelper');
const { calculatePaymentDeadline } = require('./moveInGuestPaymentGuard');
const { evaluateGuestCancel, evaluateGuestReturn } = require('./moveInRefundPolicy');

/**
 * 주소 마스킹.
 *   "서울 강남구 가로수길 9" 같은 도로명까지만 노출, 그 이후는 마스킹.
 *   기본 정책: 공백 토큰 4개 까지만 노출 (시 / 구 / 도로명 / 건물번호).
 *
 * @param {string|null} address
 * @returns {string|null}
 */
function maskAddress(address) {
  if (!address || typeof address !== 'string') return null;
  const tokens = address.trim().split(/\s+/);
  if (tokens.length <= 4) return tokens.join(' ');
  return tokens.slice(0, 4).join(' ') + ' …';
}

/**
 * 게스트 관점의 케이스 상태를 파생.
 *   - PENDING_PAYMENT: 결제 완료된 주문이 하나도 없음
 *   - PAID:            결제 완료 주문이 있고 배송 미완료
 *   - COMPLETED:       모든 결제 완료 주문이 배송 완료
 *
 * @param {Array<{status: string, deliveryStatus: string}>} guestOrders
 * @returns {'PENDING_PAYMENT' | 'PAID' | 'COMPLETED'}
 */
function deriveGuestStatus(guestOrders = []) {
  const paidLike = guestOrders.filter(o =>
    ['PAID', 'PARTIAL_REFUND'].includes(o.status)
  );
  if (paidLike.length === 0) return 'PENDING_PAYMENT';
  const allDelivered = paidLike.every(o => o.deliveryStatus === 'DELIVERED');
  return allDelivered ? 'COMPLETED' : 'PAID';
}

/**
 * 게스트 응답용 케이스 직렬화.
 *
 * @param {object} caseRow         - MoveInCase 인스턴스 또는 plain object
 * @param {object} [opts]
 * @param {boolean} [opts.includeSensitive=false] - 로그인+매칭 시 true (상세주소 노출)
 * @param {Array} [opts.guestOrders=[]] - 게스트 주문 목록 (status 파생용)
 * @returns {object}
 */
function serializeGuestCase(caseRow, { includeSensitive = false, guestOrders = [] } = {}) {
  if (!caseRow) return null;

  // Sequelize 인스턴스 / plain object 모두 지원
  const c = typeof caseRow.get === 'function' ? caseRow.get({ plain: true }) : caseRow;

  // room_snapshot 은 LONGTEXT 직렬화 (모델 getter 가 객체 반환)
  // plain object 인 경우는 문자열일 수 있어 한번 더 파싱
  let snapshot = c.roomSnapshot ?? c.room_snapshot ?? null;
  if (typeof snapshot === 'string') {
    try { snapshot = JSON.parse(snapshot); } catch { snapshot = null; }
  }

  const fullAddress = snapshot?.address ?? null;
  const detailAddress = snapshot?.detailAddress ?? snapshot?.detail_address ?? null;

  return {
    requestId: c.id,
    status: deriveGuestStatus(guestOrders),
    room: {
      displayName: snapshot?.roomName ?? snapshot?.room_name ?? null,
      address: includeSensitive ? fullAddress : maskAddress(fullAddress),
      detailAddress: includeSensitive ? detailAddress : null
    },
    checkInDate: toKSTString(c.checkInDate ?? c.check_in_date),
    checkOutDate: toKSTString(c.checkOutDate ?? c.check_out_date),
    paymentDeadline: toKSTString(calculatePaymentDeadline(c.checkInDate ?? c.check_in_date)),
    authRequired: !includeSensitive
    // ⚠️ cleaningStatus / cleaningFee / cleaningPaidAt / 비밀번호 필드 의도적으로 미포함 (PRD 14.7-8)
  };
}

/**
 * 게스트 응답용 옵션 직렬화 (카탈로그).
 *
 * @param {object} optionRow - MoveInOption 인스턴스
 * @returns {object}
 */
function serializeOption(optionRow) {
  if (!optionRow) return null;
  const o = typeof optionRow.get === 'function' ? optionRow.get({ plain: true }) : optionRow;
  return {
    optionId: o.id,
    name: o.name,
    description: o.description ?? null,
    type: o.optionType ?? o.option_type,
    category: o.category,
    price: o.price,
    imageUrl: o.imageUrl ?? o.image_url ?? null,
    available: !!(o.isActive ?? o.is_active)
  };
}

/**
 * 게스트 응답용 주문 직렬화.
 *
 * @param {object} orderRow - MoveInGuestOrder 인스턴스 (items include 권장)
 * @param {object} [opts]
 * @param {object} [opts.caseRow] - 정책 평가용 케이스 (checkInDate/checkOutDate). 미지정 시 order.case 를 사용.
 * @returns {object}
 */
function serializeGuestOrder(orderRow, { caseRow = null } = {}) {
  if (!orderRow) return null;
  const o = typeof orderRow.get === 'function' ? orderRow.get({ plain: true }) : orderRow;

  // 진행 중(PENDING) 반품요청만 동봉. (refundRequests 가 include 됐을 때)
  const pendingRequests = (o.refundRequests || []).filter(r => r.status === 'PENDING');

  // 라인별 "반품 요청 중 수량" 집계 — targetItems 스냅샷 기준.
  // targetItems 가 모델 getter 로 파싱돼 배열(or JSON 문자열)로 올 수 있어 양쪽 처리.
  const pendingQtyByItem = new Map();
  for (const r of pendingRequests) {
    let ti = r.targetItems;
    if (typeof ti === 'string') { try { ti = JSON.parse(ti); } catch { ti = null; } }
    if (Array.isArray(ti)) {
      for (const t of ti) {
        pendingQtyByItem.set(t.itemId, (pendingQtyByItem.get(t.itemId) || 0) + Number(t.quantity || 0));
      }
    }
  }

  // canCancel / canReturn — 서버 정책 평가 결과를 그대로 노출.
  // (프론트가 "결제 취소" / "반품 신청" 탭 노출 여부를 결정하는 단일 근거)
  // caseRow 가 없거나 케이스 날짜를 모르면 false 로 떨어뜨려 보수적으로 차단.
  const c = caseRow ?? o.case ?? null;
  const orderStatus = o.status;
  const deliveryStatus = o.deliveryStatus ?? o.delivery_status;
  // 활성 라인 합계(없으면 paidAmount - refundedAmount 로 폴백)
  const activeTotal = (o.items || []).reduce(
    (s, it) => s + (it.status === 'ACTIVE' ? Number(it.totalPrice ?? it.total_price ?? 0) : 0),
    0
  ) || Math.max(0, Number(o.paidAmount ?? o.paid_amount ?? 0) - Number(o.refundedAmount ?? o.refunded_amount ?? 0));

  let canCancel = false;
  let canReturn = false;
  if (c) {
    const checkInDate = c.checkInDate ?? c.check_in_date;
    const checkOutDate = c.checkOutDate ?? c.check_out_date;
    canCancel = activeTotal > 0 && evaluateGuestCancel({
      checkInDate, checkOutDate, orderStatus, deliveryStatus,
      orderTotalAmount: activeTotal
    }).allowed;
    canReturn = activeTotal > 0 && evaluateGuestReturn({
      checkInDate, checkOutDate, orderStatus, deliveryStatus
    }).allowed;
  }

  return {
    orderDbId: o.id,
    orderId: o.orderId ?? o.order_id,
    orderType: o.orderType ?? o.order_type,
    status: o.status,
    deliveryStatus: o.deliveryStatus ?? o.delivery_status,
    canCancel,
    canReturn,
    totalAmount: o.totalAmount ?? o.total_amount,
    paidAmount: o.paidAmount ?? o.paid_amount,
    refundedAmount: o.refundedAmount ?? o.refunded_amount,
    paidAt: toKSTString(o.paidAt ?? o.paid_at),
    deliveredAt: toKSTString(o.deliveredAt ?? o.delivered_at),
    createdAt: toKSTString(o.createdAt ?? o.created_at),
    items: (o.items || []).map(it => ({
      itemId: it.id,
      optionId: it.optionId ?? it.option_id,
      name: it.option?.name ?? null,
      quantity: it.quantity,
      pricePerItem: it.pricePerItem ?? it.price_per_item,
      totalPrice: it.totalPrice ?? it.total_price,
      status: it.status,
      refundAmount: it.refundAmount ?? it.refund_amount ?? null,
      cancelledAt: toKSTString(it.cancelledAt ?? it.cancelled_at),
      // 라인별 반품 요청 중(미승인) 수량 — 부분 반품 남은수량 가드용
      pendingReturnQuantity: pendingQtyByItem.get(it.id) || 0
    })),
    // 진행 중 반품요청 (PENDING 만). refundRequests 미include 시 빈 배열.
    refundRequests: pendingRequests.map(r => {
      let ti = r.targetItems;
      if (typeof ti === 'string') { try { ti = JSON.parse(ti); } catch { ti = null; } }
      return {
        id: r.id,
        status: r.status,
        itemTotalAmount: r.itemTotalAmount ?? r.item_total_amount,
        returnReason: r.returnReason ?? r.return_reason ?? null,
        targetItems: Array.isArray(ti)
          ? ti.map(t => ({ itemId: t.itemId, quantity: t.quantity }))
          : null,
        createdAt: toKSTString(r.createdAt ?? r.created_at)
      };
    })
  };
}

module.exports = {
  maskAddress,
  deriveGuestStatus,
  serializeGuestCase,
  serializeOption,
  serializeGuestOrder
};
