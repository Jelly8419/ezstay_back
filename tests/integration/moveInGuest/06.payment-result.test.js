/**
 * 06.payment-result.test.js
 * 결제 결과 조회 (GET /payments/:paymentId)
 *
 * 검증:
 *  - 본인 결제 조회 OK + payment/order/case 통합 응답
 *  - 청소 정보 미포함
 *  - 다른 사람 결제 → 404
 */

'use strict';

require('../../setup/setup');

const request = require('supertest');
const app = require('../../setup/testApp');
const { createHost, createGuest, cleanupUsers, generateToken } = require('../../setup/factories/userFactory');
const { createMoveInRoom, cleanupMoveInByHost } = require('../../setup/factories/moveInFactory');
const {
  createMoveInCase,
  createMoveInOption,
  createPaidGuestOrder,
  cleanupMoveInOptions,
  cleanupMoveInNotifications
} = require('../../setup/factories/moveInGuestFactory');

describe('MoveIn Guest — Payment Result', () => {
  let host, guest, otherGuest, room, opt1, c, payment, order;
  const optionIds = [];
  const userIds = [];

  beforeAll(async () => {
    process.env.PAYMENT_USE_MOCK = 'true';
    ({ user: host } = await createHost());
    ({ user: guest } = await createGuest({ phoneNumber: '01023456789' }));
    ({ user: otherGuest } = await createGuest({ phoneNumber: '01077777777' }));
    userIds.push(host.id, guest.id, otherGuest.id);

    room = await createMoveInRoom(host.id);
    opt1 = await createMoveInOption({ name: '결제후조회', price: 12000 });
    optionIds.push(opt1.id);

    c = await createMoveInCase({
      hostId: host.id,
      moveInRoomId: room.id,
      guestUserId: guest.id,
      guestPhone: '01023456789',
      checkInDate: '2028-12-15',
      checkOutDate: '2028-12-20'
    });
    ({ order, payment } = await createPaidGuestOrder({
      caseId: c.id,
      guestUserId: guest.id,
      options: [{ option: opt1, quantity: 2 }],
      checkInDate: c.checkInDate
    }));
  });

  afterAll(async () => {
    await cleanupMoveInNotifications(userIds);
    await cleanupMoveInByHost(host.id);
    await cleanupMoveInOptions(optionIds);
    await cleanupUsers(userIds);
  });

  test('GET /payments/:id (본인) → 200 통합 응답', async () => {
    const token = generateToken(guest);
    const res = await request(app)
      .get(`/api/guest/move-in/payments/${payment.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.payment.paymentId).toBe(payment.id);
    expect(d.payment.amount).toBe(24000);
    expect(d.payment.status).toBe('PAID');
    expect(d.order.orderId).toBe(order.orderId);
    expect(d.order.items.length).toBe(1);
    expect(d.case.requestId).toBe(c.id);
    expect(JSON.stringify(d)).not.toMatch(/cleaningStatus/);
    expect(JSON.stringify(d)).not.toMatch(/cleaningFee/);
  });

  test('GET /payments/:id (다른 사람 결제) → 404', async () => {
    const token = generateToken(otherGuest);
    const res = await request(app)
      .get(`/api/guest/move-in/payments/${payment.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe(4794);
  });

  test('GET /payments/9999999 → 404', async () => {
    const token = generateToken(guest);
    const res = await request(app)
      .get('/api/guest/move-in/payments/9999999')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
