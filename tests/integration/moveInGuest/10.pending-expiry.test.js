/**
 * 10.pending-expiry.test.js
 * 입주 준비 서비스 — PENDING 주문 자동 만료 정리 통합 테스트
 *
 * 대상: services/moveInGuestOrderService.js > expireStalePendingOrders
 */

'use strict';

require('../../setup/setup');

const paytagClient = require('../../../utils/paytagClient');
const {
  MoveInGuestOrder,
  MoveInGuestOrderItem,
  MoveInGuestPayment,
  MoveInGuestOrderLog
} = require('../../../models');
const { expireStalePendingOrders } = require('../../../services/moveInGuestOrderService');
const { generateMoveInGuestOrderId } = require('../../../utils/orderIdGenerator');
const { calculatePaymentDeadline } = require('../../../utils/moveInGuestPaymentGuard');

const { createHost, createGuest, cleanupUsers } = require('../../setup/factories/userFactory');
const { createMoveInRoom, cleanupMoveInByHost } = require('../../setup/factories/moveInFactory');
const {
  createMoveInCase,
  createMoveInOption,
  cleanupMoveInGuestByCases,
  cleanupMoveInOptions
} = require('../../setup/factories/moveInGuestFactory');

/**
 * PENDING 주문 + Item + Payment 직접 생성.
 * createdAt 을 임의로 과거로 셋팅하여 만료 시뮬레이션.
 */
async function createPendingOrderAt({
  caseId,
  guestUserId,
  options,
  checkInDate,
  createdAt = new Date()
}) {
  const lines = options.map(({ option, quantity }) => ({
    optionId: option.id,
    name: option.name,
    quantity,
    pricePerItem: option.price,
    totalPrice: option.price * quantity,
    optionType: option.optionType,
    category: option.category
  }));
  const totalAmount = lines.reduce((s, l) => s + l.totalPrice, 0);
  const orderId = await generateMoveInGuestOrderId();

  const order = await MoveInGuestOrder.create({
    caseId,
    guestUserId,
    orderId,
    orderType: 'INITIAL',
    totalAmount,
    paidAmount: 0,
    refundedAmount: 0,
    status: 'PENDING',
    modifiableUntil: calculatePaymentDeadline(checkInDate),
    itemsSnapshot: lines,
    deliveryStatus: 'PENDING'
  }, { silent: true });

  // createdAt 강제 설정 (Sequelize 가 자동 채운 값을 덮어쓰기)
  await MoveInGuestOrder.update(
    { createdAt },
    { where: { id: order.id }, silent: true }
  );

  const items = await Promise.all(lines.map(l => MoveInGuestOrderItem.create({
    guestOrderId: order.id,
    optionId: l.optionId,
    quantity: l.quantity,
    pricePerItem: l.pricePerItem,
    totalPrice: l.totalPrice,
    status: 'ACTIVE'
  })));

  const payment = await MoveInGuestPayment.create({
    guestOrderId: order.id,
    caseId,
    guestUserId,
    orderId,
    amount: totalAmount,
    status: 'PENDING'
  });

  return { order, items, payment };
}

describe('Move-in Guest Order — PENDING 자동 만료', () => {
  let host, guest, room, opt, c;
  const optionIds = [];
  const caseIds = [];
  const userIds = [];

  beforeAll(async () => {
    ({ user: host } = await createHost());
    ({ user: guest } = await createGuest({ phoneNumber: '01077778888', name: '만료테스트' }));
    userIds.push(host.id, guest.id);

    room = await createMoveInRoom(host.id);
    opt = await createMoveInOption({ name: '만료테스트옵션', price: 10000 });
    optionIds.push(opt.id);

    c = await createMoveInCase({
      hostId: host.id,
      moveInRoomId: room.id,
      guestUserId: guest.id,
      guestName: '만료테스트',
      guestPhone: '01077778888',
      checkInDate: '2029-08-01',
      checkOutDate: '2029-08-07'
    });
    caseIds.push(c.id);
  });

  afterAll(async () => {
    await cleanupMoveInGuestByCases(caseIds);
    await cleanupMoveInByHost(host.id);
    await cleanupMoveInOptions(optionIds);
    await cleanupUsers(userIds);
  });

  afterEach(async () => {
    // 각 테스트 격리: 이번 케이스의 모든 주문/라인/결제/로그 제거
    await cleanupMoveInGuestByCases(caseIds);
    paytagClient.cancelOrder.mockClear();
  });

  test('30분 경과 PENDING → CANCELLED + 라인/결제 동기 처리 + 로그 + PayTag 호출', async () => {
    const past = new Date(Date.now() - 31 * 60 * 1000); // 31분 전
    const { order, items, payment } = await createPendingOrderAt({
      caseId: c.id,
      guestUserId: guest.id,
      options: [{ option: opt, quantity: 2 }],
      checkInDate: c.checkInDate,
      createdAt: past
    });

    const result = await expireStalePendingOrders({ thresholdMinutes: 30 });

    expect(result.processed).toBe(1);
    expect(result.cancelled).toBe(1);
    expect(result.paytagFailures).toBe(0);
    expect(paytagClient.cancelOrder).toHaveBeenCalledWith({ orderno: order.orderId });

    const afterOrder = await MoveInGuestOrder.findByPk(order.id);
    expect(afterOrder.status).toBe('CANCELLED');

    const afterItem = await MoveInGuestOrderItem.findByPk(items[0].id);
    expect(afterItem.status).toBe('CANCELLED');
    expect(afterItem.cancelledAt).toBeTruthy();
    expect(afterItem.cancelReason).toBe('AUTO_EXPIRED_PENDING');

    const afterPayment = await MoveInGuestPayment.findByPk(payment.id);
    expect(afterPayment.status).toBe('CANCELLED');
    expect(afterPayment.failedAt).toBeTruthy();
    expect(afterPayment.failureReason).toBe('AUTO_EXPIRED');

    const log = await MoveInGuestOrderLog.findOne({
      where: { guestOrderId: order.id, action: 'PENDING_EXPIRED_AUTO_CANCEL' }
    });
    expect(log).toBeTruthy();
    expect(log.actor).toBe('SYSTEM');
  });

  test('30분 미만 PENDING → 미처리 (모든 상태 그대로)', async () => {
    const recent = new Date(Date.now() - 10 * 60 * 1000); // 10분 전
    const { order } = await createPendingOrderAt({
      caseId: c.id,
      guestUserId: guest.id,
      options: [{ option: opt, quantity: 1 }],
      checkInDate: c.checkInDate,
      createdAt: recent
    });

    const result = await expireStalePendingOrders({ thresholdMinutes: 30 });

    expect(result.processed).toBe(0);
    expect(result.cancelled).toBe(0);
    expect(paytagClient.cancelOrder).not.toHaveBeenCalled();

    const afterOrder = await MoveInGuestOrder.findByPk(order.id);
    expect(afterOrder.status).toBe('PENDING'); // 변동 없음
  });

  test('PayTag cancelOrder 실패해도 DB CANCELLED 정상 진행 (best-effort)', async () => {
    paytagClient.cancelOrder.mockRejectedValueOnce(new Error('paytag 일시 장애'));

    const past = new Date(Date.now() - 31 * 60 * 1000);
    const { order } = await createPendingOrderAt({
      caseId: c.id,
      guestUserId: guest.id,
      options: [{ option: opt, quantity: 1 }],
      checkInDate: c.checkInDate,
      createdAt: past
    });

    const result = await expireStalePendingOrders({ thresholdMinutes: 30 });

    expect(result.cancelled).toBe(1);
    expect(result.paytagFailures).toBe(1);

    const afterOrder = await MoveInGuestOrder.findByPk(order.id);
    expect(afterOrder.status).toBe('CANCELLED');

    const log = await MoveInGuestOrderLog.findOne({
      where: { guestOrderId: order.id, action: 'PENDING_EXPIRED_AUTO_CANCEL' }
    });
    expect(log).toBeTruthy();
    expect(log.metadata?.paytagCancelOk).toBe(false);
  });

  test('만료 임계값 환경변수 / 옵션으로 조정 가능', async () => {
    const past = new Date(Date.now() - 15 * 60 * 1000); // 15분 전

    const { order } = await createPendingOrderAt({
      caseId: c.id,
      guestUserId: guest.id,
      options: [{ option: opt, quantity: 1 }],
      checkInDate: c.checkInDate,
      createdAt: past
    });

    // 임계값 10분 → 15분 된 PENDING 잡힘
    const result = await expireStalePendingOrders({ thresholdMinutes: 10 });
    expect(result.cancelled).toBe(1);

    const afterOrder = await MoveInGuestOrder.findByPk(order.id);
    expect(afterOrder.status).toBe('CANCELLED');
  });

  test('PAID 주문은 만료 대상 아님', async () => {
    const past = new Date(Date.now() - 31 * 60 * 1000);
    const { order } = await createPendingOrderAt({
      caseId: c.id,
      guestUserId: guest.id,
      options: [{ option: opt, quantity: 1 }],
      checkInDate: c.checkInDate,
      createdAt: past
    });
    await order.update({ status: 'PAID', paidAmount: order.totalAmount, paidAt: new Date() });

    const result = await expireStalePendingOrders({ thresholdMinutes: 30 });

    expect(result.processed).toBe(0);

    const afterOrder = await MoveInGuestOrder.findByPk(order.id);
    expect(afterOrder.status).toBe('PAID'); // 그대로
  });

  test('batchLimit 으로 1회 실행 처리량 제한', async () => {
    const past = new Date(Date.now() - 31 * 60 * 1000);
    // PENDING 3건 생성
    for (let i = 0; i < 3; i++) {
      await createPendingOrderAt({
        caseId: c.id,
        guestUserId: guest.id,
        options: [{ option: opt, quantity: 1 }],
        checkInDate: c.checkInDate,
        createdAt: past
      });
    }

    const result = await expireStalePendingOrders({ thresholdMinutes: 30, batchLimit: 2 });

    expect(result.processed).toBe(2);
    expect(result.cancelled).toBe(2);

    const remaining = await MoveInGuestOrder.count({ where: { caseId: c.id, status: 'PENDING' } });
    expect(remaining).toBe(1);
  });
});
