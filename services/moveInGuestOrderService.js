/**
 * moveInGuestOrderService.js
 * 입주 준비 서비스 - 임차인 옵션 주문 도메인 서비스
 *
 * 책임:
 *   1) 옵션 가격 서버 산정 (PRD 14.4)
 *   2) RENTAL 재고 검증 (기간 점유)
 *   3) PENDING 주문 + 라인 + 결제 생성 (트랜잭션)
 *   4) items_snapshot 락인
 *
 * 주의:
 *   - 옵션 가격은 결제 직전 한번 더 서버 산정 → 클라 위변조 차단
 *   - RENTAL 은 케이스의 [check_in_date, check_out_date] 기간 점유 (버퍼 ±3일)
 */

'use strict';

const { Op } = require('sequelize');
const {
  sequelize,
  MoveInOption,
  MoveInGuestOrder,
  MoveInGuestOrderItem,
  MoveInGuestPayment,
  MoveInGuestOrderLog
} = require('../models');
const { generateMoveInGuestOrderId } = require('../utils/orderIdGenerator');
const { calculatePaymentDeadline } = require('../utils/moveInGuestPaymentGuard');
const paytagClient = require('../utils/paytagClient');

const RENTAL_BUFFER_DAYS = 3;

/**
 * 옵션 가격 서버 산정 + 라인 빌드.
 *
 * @param {Array<{optionId, quantity}>} items
 * @param {Transaction} transaction
 * @returns {Promise<{ lines, totalAmount, options, errors }>}
 *   - lines:    [{ optionId, quantity, pricePerItem, totalPrice, optionType, category, name }]
 *   - errors:   [{ optionId, reason }]
 */
async function calculateOrderTotal(items, transaction = null) {
  const opts = transaction ? { transaction } : {};

  if (!Array.isArray(items) || items.length === 0) {
    return { lines: [], totalAmount: 0, options: [], errors: [{ reason: 'NO_ITEMS' }] };
  }

  // optionId 정수 검증 + 중복 합산 (같은 옵션 여러 줄로 보낸 경우)
  const merged = new Map();
  for (const it of items) {
    const optionId = parseInt(it?.optionId, 10);
    const quantity = parseInt(it?.quantity, 10);
    if (!Number.isInteger(optionId) || optionId <= 0) {
      return { lines: [], totalAmount: 0, options: [], errors: [{ reason: 'INVALID_OPTION_ID' }] };
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      return { lines: [], totalAmount: 0, options: [], errors: [{ optionId, reason: 'INVALID_QUANTITY' }] };
    }
    merged.set(optionId, (merged.get(optionId) || 0) + quantity);
  }

  const optionIds = Array.from(merged.keys());
  const options = await MoveInOption.findAll({
    where: { id: { [Op.in]: optionIds } },
    ...opts
  });

  const errors = [];
  const lines = [];

  for (const optionId of optionIds) {
    const option = options.find(o => o.id === optionId);
    if (!option) {
      errors.push({ optionId, reason: 'NOT_FOUND' });
      continue;
    }
    if (!option.isActive) {
      errors.push({ optionId, reason: 'INACTIVE' });
      continue;
    }
    const quantity = merged.get(optionId);
    const pricePerItem = option.price;
    lines.push({
      optionId,
      quantity,
      pricePerItem,
      totalPrice: pricePerItem * quantity,
      optionType: option.optionType,
      category: option.category,
      name: option.name
    });
  }

  const totalAmount = lines.reduce((s, l) => s + l.totalPrice, 0);
  return { lines, totalAmount, options, errors };
}

/**
 * RENTAL 옵션 재고 검증.
 * - PURCHASE: 단순 totalStock - 누적 ACTIVE 수량
 * - RENTAL: 케이스 기간 ± 버퍼일 동안의 동시 점유 수량
 *
 * NOTE:
 *   현재 RENTAL 점유 계산은 "다른 케이스의 ACTIVE 라인의 quantity 합산"으로 단순화.
 *   기간 겹침까지 정확히 추적하려면 케이스 전체를 join 해야 하므로 V2 에서 정교화.
 *   MVP 는 totalStock 자체가 충분히 큰 가정.
 *
 * @param {Array<{optionId, quantity, optionType}>} lines
 * @param {Transaction} transaction
 * @returns {Promise<{ ok: boolean, unavailable: Array }>}
 */
async function validateGuestStock(lines, transaction = null) {
  const opts = transaction ? { transaction } : {};
  const unavailable = [];

  for (const line of lines) {
    const option = await MoveInOption.findByPk(line.optionId, opts);
    if (!option) {
      unavailable.push({ optionId: line.optionId, reason: 'NOT_FOUND' });
      continue;
    }

    // 현재 ACTIVE 라인의 누적 사용량
    const used = (await MoveInGuestOrderItem.sum('quantity', {
      where: {
        optionId: line.optionId,
        status: 'ACTIVE'
      },
      ...opts
    })) || 0;

    const remaining = option.totalStock - used;
    if (remaining < line.quantity) {
      unavailable.push({
        optionId: line.optionId,
        name: option.name,
        reason: 'OUT_OF_STOCK',
        requested: line.quantity,
        remaining
      });
    }
  }

  return { ok: unavailable.length === 0, unavailable };
}

/**
 * PENDING 주문 + 라인 + 결제 생성.
 *
 * @param {Object} params
 * @param {number} params.caseId
 * @param {number} params.guestUserId
 * @param {string|Date} params.checkInDate
 * @param {'INITIAL' | 'ADDITIONAL'} params.orderType
 * @param {Array} params.lines    - calculateOrderTotal 결과
 * @param {number} params.totalAmount
 * @param {Transaction} transaction
 * @returns {Promise<{ order, payment, items }>}
 */
async function createPendingOrder({
  caseId,
  guestUserId,
  checkInDate,
  orderType,
  lines,
  totalAmount
}, transaction) {
  const orderId = await generateMoveInGuestOrderId(transaction);
  const modifiableUntil = calculatePaymentDeadline(checkInDate);

  const order = await MoveInGuestOrder.create({
    caseId,
    guestUserId,
    orderId,
    orderType,
    totalAmount,
    paidAmount: 0,
    refundedAmount: 0,
    status: 'PENDING',
    modifiableUntil,
    itemsSnapshot: lines.map(l => ({
      optionId: l.optionId,
      name: l.name,
      quantity: l.quantity,
      pricePerItem: l.pricePerItem,
      totalPrice: l.totalPrice,
      optionType: l.optionType,
      category: l.category
    })),
    deliveryStatus: 'PENDING'
  }, { transaction });

  const items = await Promise.all(lines.map(l =>
    MoveInGuestOrderItem.create({
      guestOrderId: order.id,
      optionId: l.optionId,
      quantity: l.quantity,
      pricePerItem: l.pricePerItem,
      totalPrice: l.totalPrice,
      status: 'ACTIVE'
    }, { transaction })
  ));

  const payment = await MoveInGuestPayment.create({
    guestOrderId: order.id,
    caseId,
    guestUserId,
    orderId: order.orderId,
    amount: totalAmount,
    status: 'PENDING'
  }, { transaction });

  await MoveInGuestOrderLog.createLog({
    guestOrderId: order.id,
    caseId,
    actor: 'GUEST',
    actorId: guestUserId,
    action: 'ORDER_CREATED',
    amountChange: totalAmount,
    balanceAfter: 0,
    metadata: { orderType, lineCount: lines.length }
  }, transaction);

  return { order, payment, items };
}

/**
 * 케이스에 PENDING 주문이 이미 있는지 확인.
 * - 동일 케이스 동시 결제 시도 차단 (PRD 11.6)
 * - INITIAL/ADDITIONAL 무관하게 PENDING 1건만 허용
 *
 * @returns {Promise<MoveInGuestOrder|null>}
 */
async function findExistingPendingOrder(caseId, transaction = null) {
  const opts = transaction ? { transaction } : {};
  return MoveInGuestOrder.findOne({
    where: { caseId, status: 'PENDING' },
    ...opts
  });
}

/**
 * 해당 주문에 아직 살아있는(PENDING) 결제가 있는지.
 * - PENDING payment 가 있으면 = 실제 결제 진행 중 → 재결제 차단(409)
 * - 전부 FAILED 면 = 재결제 가능 (reusePendingOrder 대상)
 *
 * @returns {Promise<boolean>}
 */
async function hasActivePendingPayment(guestOrderId, transaction = null) {
  const opts = transaction ? { transaction } : {};
  const cnt = await MoveInGuestPayment.count({
    where: { guestOrderId, status: 'PENDING' },
    ...opts
  });
  return cnt > 0;
}

/**
 * 결제 실패한 기존 PENDING 주문 재사용.
 * - 기존 라인 전부 삭제 후 새 요청 라인으로 교체 (옵션 변경 허용)
 * - itemsSnapshot / totalAmount / modifiableUntil 갱신
 * - 새 PENDING payment 발급 (기존 FAILED payment 는 이력으로 보존)
 *
 * 호출 전제: order.status='PENDING' 이고 활성 PENDING payment 가 없어야 함
 * (호출처에서 hasActivePendingPayment 로 가드).
 *
 * @returns {Promise<{ order, payment, items }>}
 */
async function reusePendingOrder({
  order,
  caseId,
  guestUserId,
  checkInDate,
  lines,
  totalAmount
}, transaction) {
  // 기존 라인 제거 후 새 라인으로 교체
  await MoveInGuestOrderItem.destroy({
    where: { guestOrderId: order.id },
    transaction
  });

  const items = await Promise.all(lines.map(l =>
    MoveInGuestOrderItem.create({
      guestOrderId: order.id,
      optionId: l.optionId,
      quantity: l.quantity,
      pricePerItem: l.pricePerItem,
      totalPrice: l.totalPrice,
      status: 'ACTIVE'
    }, { transaction })
  ));

  await order.update({
    totalAmount,
    modifiableUntil: calculatePaymentDeadline(checkInDate),
    itemsSnapshot: lines.map(l => ({
      optionId: l.optionId,
      name: l.name,
      quantity: l.quantity,
      pricePerItem: l.pricePerItem,
      totalPrice: l.totalPrice,
      optionType: l.optionType,
      category: l.category
    }))
  }, { transaction });

  const payment = await MoveInGuestPayment.create({
    guestOrderId: order.id,
    caseId,
    guestUserId,
    orderId: order.orderId,
    amount: totalAmount,
    status: 'PENDING'
  }, { transaction });

  await MoveInGuestOrderLog.createLog({
    guestOrderId: order.id,
    caseId,
    actor: 'GUEST',
    actorId: guestUserId,
    action: 'ORDER_RETRIED',
    amountChange: totalAmount,
    balanceAfter: 0,
    metadata: { lineCount: lines.length, reusedOrderId: order.orderId }
  }, transaction);

  return { order, payment, items };
}

/**
 * 케이스에 결제 완료된 INITIAL 주문이 있는지 확인.
 * - ADDITIONAL 결제 진입 가드용 (정책 #4: 추가 결제는 INITIAL 완료 후에만)
 *
 * @returns {Promise<MoveInGuestOrder|null>}
 */
async function findPaidInitialOrder(caseId, transaction = null) {
  const opts = transaction ? { transaction } : {};
  return MoveInGuestOrder.findOne({
    where: {
      caseId,
      orderType: 'INITIAL',
      status: { [Op.in]: ['PAID', 'PARTIAL_REFUND'] }
    },
    ...opts
  });
}

/**
 * 만료된 PENDING 주문 자동 취소.
 *
 * 정책:
 *  - 측정 시점: MoveInGuestOrder.createdAt
 *  - 만료 시간: thresholdMinutes (기본 30분, env MOVE_IN_GUEST_PENDING_EXPIRY_MINUTES 우선)
 *  - 1회 실행당 최대 batchLimit 건 처리 (기본 100)
 *  - PayTag cancelOrder 는 best-effort — 실패해도 DB 정리 진행
 *
 * 각 주문에 대해 단일 트랜잭션으로:
 *  1. PayTag cancelOrder 호출 (best-effort, 실패 시 로그만)
 *  2. MoveInGuestOrder.status = 'CANCELLED'
 *  3. ACTIVE 라인 → CANCELLED + cancelledAt + cancelReason='AUTO_EXPIRED_PENDING'
 *  4. PENDING 결제 → CANCELLED + failedAt + failureReason='AUTO_EXPIRED'
 *  5. MoveInGuestOrderLog actor='SYSTEM', action='PENDING_EXPIRED_AUTO_CANCEL'
 *
 * @param {Object} [opts]
 * @param {number} [opts.thresholdMinutes=30]
 * @param {number} [opts.batchLimit=100]
 * @returns {Promise<{ processed: number, cancelled: number, paytagFailures: number }>}
 */
async function expireStalePendingOrders({
  thresholdMinutes,
  batchLimit = 100
} = {}) {
  const minutes = Number.isInteger(thresholdMinutes)
    ? thresholdMinutes
    : parseInt(process.env.MOVE_IN_GUEST_PENDING_EXPIRY_MINUTES, 10) || 30;

  const cutoff = new Date(Date.now() - minutes * 60 * 1000);

  const stale = await MoveInGuestOrder.findAll({
    where: {
      status: 'PENDING',
      createdAt: { [Op.lt]: cutoff }
    },
    order: [['createdAt', 'ASC']],
    limit: batchLimit
  });

  let cancelled = 0;
  let paytagFailures = 0;

  for (const order of stale) {
    let paytagOk = true;

    // 1. PayTag 측 미결제 주문 취소 — best-effort
    //    PG 에 결제 시도 전 PENDING 이면 PayTag 측에 주문이 없어 4xx 반환 가능 → 무시.
    try {
      await paytagClient.cancelOrder({ orderno: order.orderId });
    } catch (err) {
      paytagOk = false;
      paytagFailures++;
      console.warn(
        `[expirePending] PayTag cancelOrder 실패 orderId=${order.orderId}: ${err.message || err}`
      );
    }

    // 2~5. DB 정리 트랜잭션
    const t = await sequelize.transaction();
    try {
      await order.update({ status: 'CANCELLED' }, { transaction: t });

      const now = new Date();
      await MoveInGuestOrderItem.update(
        {
          status: 'CANCELLED',
          cancelledAt: now,
          cancelReason: 'AUTO_EXPIRED_PENDING'
        },
        {
          where: { guestOrderId: order.id, status: 'ACTIVE' },
          transaction: t
        }
      );

      await MoveInGuestPayment.update(
        {
          status: 'CANCELLED',
          failedAt: now,
          failureReason: 'AUTO_EXPIRED'
        },
        {
          where: { guestOrderId: order.id, status: 'PENDING' },
          transaction: t
        }
      );

      await MoveInGuestOrderLog.createLog({
        guestOrderId: order.id,
        caseId: order.caseId,
        actor: 'SYSTEM',
        action: 'PENDING_EXPIRED_AUTO_CANCEL',
        amountChange: 0,
        balanceAfter: 0,
        metadata: {
          thresholdMinutes: minutes,
          ageMinutes: Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 60000),
          paytagCancelOk: paytagOk
        },
        description: paytagOk
          ? '30분 경과 PENDING 자동 취소'
          : '30분 경과 PENDING 자동 취소 (PayTag cancelOrder 실패 — best-effort 진행)'
      }, t);

      await t.commit();
      cancelled++;
    } catch (err) {
      await t.rollback();
      console.error(`[expirePending] DB 정리 실패 orderId=${order.orderId}:`, err);
    }
  }

  return {
    processed: stale.length,
    cancelled,
    paytagFailures
  };
}

module.exports = {
  RENTAL_BUFFER_DAYS,
  calculateOrderTotal,
  validateGuestStock,
  createPendingOrder,
  findExistingPendingOrder,
  hasActivePendingPayment,
  reusePendingOrder,
  findPaidInitialOrder,
  expireStalePendingOrders
};
