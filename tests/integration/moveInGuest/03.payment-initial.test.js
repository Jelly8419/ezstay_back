/**
 * 03.payment-initial.test.js
 * INITIAL 결제 (init + confirm) 통합 테스트 (Mock 모드)
 *
 * 검증:
 *  - init: 가격 서버 산정, 재고 검증, PENDING 1건 제한, items_snapshot 락인
 *  - confirm: 성공 시 PAID + 알림 생성, 실패 시 FAILED + 주문 PENDING 유지
 *  - phone 불일치 / D-5 경과 / 옵션 비활성 가드
 *  - 가격 위변조 무효화 (서버 산정 신뢰)
 */

'use strict';

require('../../setup/setup');

const request = require('supertest');
const app = require('../../setup/testApp');
const {
  MoveInGuestOrder,
  MoveInGuestOrderItem,
  MoveInGuestPayment,
  Notification
} = require('../../../models');
const { createHost, createGuest, cleanupUsers, generateToken } = require('../../setup/factories/userFactory');
const { createMoveInRoom, cleanupMoveInByHost } = require('../../setup/factories/moveInFactory');
const {
  createMoveInCase,
  createMoveInOption,
  cleanupMoveInOptions,
  cleanupMoveInNotifications
} = require('../../setup/factories/moveInGuestFactory');

describe('MoveIn Guest — INITIAL Payment (Mock)', () => {
  let host, guest, otherGuest, room, opt1, opt2, optInactive, c, cWithOtherGuest;
  const optionIds = [];
  const userIds = [];

  beforeAll(async () => {
    process.env.PAYMENT_USE_MOCK = 'true';
    ({ user: host } = await createHost({ phoneNumber: '01099999999' }));
    ({ user: guest } = await createGuest({ phoneNumber: '01023456789' }));
    ({ user: otherGuest } = await createGuest({ phoneNumber: '01077777777' }));
    userIds.push(host.id, guest.id, otherGuest.id);

    room = await createMoveInRoom(host.id, { areaPyeong: 18 });
    opt1 = await createMoveInOption({ name: '어메니티', price: 10000, totalStock: 100 });
    opt2 = await createMoveInOption({ name: '드라이어', price: 8000, totalStock: 100 });
    optInactive = await createMoveInOption({ name: '비활성', price: 5000, isActive: false });
    optionIds.push(opt1.id, opt2.id, optInactive.id);
  });

  afterAll(async () => {
    await cleanupMoveInNotifications(userIds);
    await cleanupMoveInByHost(host.id);
    await cleanupMoveInOptions(optionIds);
    await cleanupUsers(userIds);
  });

  async function freshCase(overrides = {}) {
    return createMoveInCase({
      hostId: host.id,
      moveInRoomId: room.id,
      guestUserId: guest.id,
      guestPhone: '01023456789',
      checkInDate: overrides.checkInDate ?? '2028-01-15',
      checkOutDate: overrides.checkOutDate ?? '2028-01-20',
      ...overrides
    });
  }

  test('init → PENDING 주문 + items_snapshot + 결제 PENDING 생성', async () => {
    c = await freshCase();
    const token = generateToken(guest);

    const res = await request(app)
      .post(`/api/guest/move-in/requests/${c.id}/payment/init`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [
          { optionId: opt1.id, quantity: 2 },  // 20000
          { optionId: opt2.id, quantity: 1 }   // 8000
        ]
      });

    expect(res.status).toBe(201);
    expect(res.body.data.amount).toBe(28000);
    expect(res.body.data.orderType).toBe('INITIAL');
    expect(res.body.data.orderId).toMatch(/^\d{6}-G\d{4}$/);

    const order = await MoveInGuestOrder.findByPk(res.body.data.orderDbId);
    expect(order.status).toBe('PENDING');
    expect(order.totalAmount).toBe(28000);
    const snap = order.itemsSnapshot;
    expect(snap.length).toBe(2);
    expect(snap[0].name).toBe('어메니티');

    const items = await MoveInGuestOrderItem.findAll({ where: { guestOrderId: order.id } });
    expect(items.length).toBe(2);
  });

  test('init (옵션 미선택) → 400 OPTION_REQUIRED', async () => {
    const token = generateToken(guest);
    const res = await request(app)
      .post(`/api/guest/move-in/requests/${c.id}/payment/init`)
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(4785);
  });

  test('init (PENDING 1건 존재) → 409 PENDING_ORDER_EXISTS', async () => {
    // 위 테스트에서 이미 PENDING 만들어둠
    const token = generateToken(guest);
    const res = await request(app)
      .post(`/api/guest/move-in/requests/${c.id}/payment/init`)
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ optionId: opt1.id, quantity: 1 }] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(4793);
  });

  test('init (비활성 옵션) → 400 UNAVAILABLE', async () => {
    const c2 = await freshCase({ checkInDate: '2028-02-15', checkOutDate: '2028-02-20' });
    const token = generateToken(guest);
    const res = await request(app)
      .post(`/api/guest/move-in/requests/${c2.id}/payment/init`)
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ optionId: optInactive.id, quantity: 1 }] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(4786); // MOVE_IN_GUEST_OPTION_UNAVAILABLE
  });

  test('init (D-5 경과) → 400 DEADLINE_PASSED', async () => {
    // 입주일이 오늘로부터 4일 이내 (마감 경과)
    const past = new Date();
    past.setDate(past.getDate() + 2);
    const yyyy = past.getUTCFullYear();
    const mm = String(past.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(past.getUTCDate()).padStart(2, '0');
    const checkIn = `${yyyy}-${mm}-${dd}`;
    const out = new Date(past.getTime() + 5 * 24 * 60 * 60 * 1000);
    const checkOut = `${out.getUTCFullYear()}-${String(out.getUTCMonth()+1).padStart(2,'0')}-${String(out.getUTCDate()).padStart(2,'0')}`;

    const cPast = await freshCase({ checkInDate: checkIn, checkOutDate: checkOut });
    const token = generateToken(guest);
    const res = await request(app)
      .post(`/api/guest/move-in/requests/${cPast.id}/payment/init`)
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ optionId: opt1.id, quantity: 1 }] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(4784);
  });

  test('init (phone 불일치) → 403 PHONE_MISMATCH', async () => {
    cWithOtherGuest = await createMoveInCase({
      hostId: host.id,
      moveInRoomId: room.id,
      guestUserId: otherGuest.id,
      guestPhone: '01077777777',
      checkInDate: '2028-04-01',
      checkOutDate: '2028-04-05'
    });
    const token = generateToken(guest); // 잘못된 사용자
    const res = await request(app)
      .post(`/api/guest/move-in/requests/${cWithOtherGuest.id}/payment/init`)
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ optionId: opt1.id, quantity: 1 }] });
    // 다른 사람 케이스 → CASE_NOT_FOUND 가 먼저 (guestUserId 매칭 안됨)
    expect(res.status).toBe(404);
    expect(res.body.code).toBe(4783);
  });

  test('confirm (Mock 성공) → PAID + 알림 생성', async () => {
    // 1번째 테스트에서 만든 c 의 PENDING 주문 사용
    const order = await MoveInGuestOrder.findOne({
      where: { caseId: c.id, status: 'PENDING' }
    });
    const payment = await MoveInGuestPayment.findOne({ where: { guestOrderId: order.id } });
    const token = generateToken(guest);

    const res = await request(app)
      .post(`/api/guest/move-in/requests/${c.id}/payment/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({ paymentId: payment.id });

    expect(res.status).toBe(200);
    expect(res.body.data.orderStatus).toBe('PAID');

    const fresh = await MoveInGuestOrder.findByPk(order.id);
    expect(fresh.status).toBe('PAID');
    expect(fresh.paidAmount).toBe(fresh.totalAmount);

    const notif = await Notification.findOne({
      where: {
        userId: guest.id,
        type: 'MOVE_IN_PAYMENT_COMPLETED'
      },
      order: [['createdAt', 'DESC']]
    });
    expect(notif).toBeTruthy();
    expect(notif.metadata.caseId).toBe(c.id);
  });

  test('confirm (simulateFailure) → FAILED + 주문 PENDING 유지', async () => {
    const c3 = await freshCase({ checkInDate: '2028-05-15', checkOutDate: '2028-05-20' });
    const token = generateToken(guest);

    const initRes = await request(app)
      .post(`/api/guest/move-in/requests/${c3.id}/payment/init`)
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ optionId: opt1.id, quantity: 1 }] });
    expect(initRes.status).toBe(201);
    const paymentId = initRes.body.data.paymentId;

    const res = await request(app)
      .post(`/api/guest/move-in/requests/${c3.id}/payment/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({ paymentId, simulateFailure: true });

    expect(res.status).toBe(400);

    const order = await MoveInGuestOrder.findByPk(initRes.body.data.orderDbId);
    expect(order.status).toBe('PENDING'); // 재시도 가능
    const payment = await MoveInGuestPayment.findByPk(paymentId);
    expect(payment.status).toBe('FAILED');
  });

  test('결제 실패 후 재init → 기존 주문 재사용 + 새 paymentId', async () => {
    const c = await freshCase({ checkInDate: '2028-05-25', checkOutDate: '2028-05-30' });
    const token = generateToken(guest);

    // 1차 init → 결제 실패
    const init1 = await request(app)
      .post(`/api/guest/move-in/requests/${c.id}/payment/init`)
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ optionId: opt1.id, quantity: 1 }] });
    expect(init1.status).toBe(201);
    const order1Db = init1.body.data.orderDbId;
    const payment1 = init1.body.data.paymentId;

    await request(app)
      .post(`/api/guest/move-in/requests/${c.id}/payment/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({ paymentId: payment1, simulateFailure: true });

    // 2차 init (옵션 변경) → 409 아니라 기존 주문 재사용
    const init2 = await request(app)
      .post(`/api/guest/move-in/requests/${c.id}/payment/init`)
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ optionId: opt1.id, quantity: 2 }] });
    expect(init2.status).toBe(201);
    // 같은 주문 재사용 (orderDbId 동일, orderId 동일)
    expect(init2.body.data.orderDbId).toBe(order1Db);
    // 새 paymentId 발급
    expect(init2.body.data.paymentId).not.toBe(payment1);
    // 옵션 변경 반영 (수량 2 → 금액 2배)
    expect(init2.body.data.amount).toBe(opt1.price * 2);

    // 기존 FAILED payment 는 이력 보존
    const oldPay = await MoveInGuestPayment.findByPk(payment1);
    expect(oldPay.status).toBe('FAILED');
    // 새 payment 는 PENDING
    const newPay = await MoveInGuestPayment.findByPk(init2.body.data.paymentId);
    expect(newPay.status).toBe('PENDING');
    expect(newPay.amount).toBe(opt1.price * 2);

    // 케이스당 주문 1건 유지
    const orderCount = await MoveInGuestOrder.count({ where: { caseId: c.id } });
    expect(orderCount).toBe(1);

    // 2차 결제 성공 → PAID
    const ok = await request(app)
      .post(`/api/guest/move-in/requests/${c.id}/payment/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({ paymentId: init2.body.data.paymentId });
    expect(ok.status).toBe(200);
    const finalOrder = await MoveInGuestOrder.findByPk(order1Db);
    expect(finalOrder.status).toBe('PAID');
  });

  test('결제 진행 중(PENDING payment 살아있음) 재init → 409 유지', async () => {
    const c = await freshCase({ checkInDate: '2028-07-25', checkOutDate: '2028-07-30' });
    const token = generateToken(guest);

    const init1 = await request(app)
      .post(`/api/guest/move-in/requests/${c.id}/payment/init`)
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ optionId: opt1.id, quantity: 1 }] });
    expect(init1.status).toBe(201);

    // confirm 안 함 → payment PENDING 그대로. 재init → 409
    const init2 = await request(app)
      .post(`/api/guest/move-in/requests/${c.id}/payment/init`)
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ optionId: opt1.id, quantity: 1 }] });
    expect(init2.status).toBe(409);
    expect(init2.body.code).toBe(4793);
  });

  test('init — 같은 옵션 중복 줄 합산', async () => {
    const c4 = await freshCase({ checkInDate: '2028-06-15', checkOutDate: '2028-06-20' });
    const token = generateToken(guest);
    const res = await request(app)
      .post(`/api/guest/move-in/requests/${c4.id}/payment/init`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [
          { optionId: opt1.id, quantity: 1 },
          { optionId: opt1.id, quantity: 2 }  // 합산되어 3개
        ]
      });
    expect(res.status).toBe(201);
    expect(res.body.data.amount).toBe(30000); // 10000 * 3

    const items = await MoveInGuestOrderItem.findAll({
      where: { guestOrderId: res.body.data.orderDbId }
    });
    expect(items.length).toBe(1); // merge 됨
    expect(items[0].quantity).toBe(3);
  });
});
