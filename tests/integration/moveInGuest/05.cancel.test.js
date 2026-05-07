/**
 * 05.cancel.test.js
 * 미결제 주문 취소 통합 테스트
 *
 * 검증:
 *  - PENDING 주문 → CANCELLED + 라인 + 결제 동반 CANCELLED
 *  - PAID 주문 취소 시도 → 400
 *  - 다른 사람 주문 → 404
 *  - 취소 후 새 init 가능 (재시도)
 */

'use strict';

require('../../setup/setup');

const request = require('supertest');
const app = require('../../setup/testApp');
const {
  MoveInGuestOrder,
  MoveInGuestOrderItem,
  MoveInGuestPayment
} = require('../../../models');
const { createHost, createGuest, cleanupUsers, generateToken } = require('../../setup/factories/userFactory');
const { createMoveInRoom, cleanupMoveInByHost } = require('../../setup/factories/moveInFactory');
const {
  createMoveInCase,
  createMoveInOption,
  createPaidGuestOrder,
  cleanupMoveInOptions,
  cleanupMoveInNotifications
} = require('../../setup/factories/moveInGuestFactory');

describe('MoveIn Guest — Cancel Pending Order', () => {
  let host, guest, otherGuest, room, opt1;
  const optionIds = [];
  const userIds = [];

  beforeAll(async () => {
    process.env.PAYMENT_USE_MOCK = 'true';
    ({ user: host } = await createHost());
    ({ user: guest } = await createGuest({ phoneNumber: '01023456789' }));
    ({ user: otherGuest } = await createGuest({ phoneNumber: '01077777777' }));
    userIds.push(host.id, guest.id, otherGuest.id);

    room = await createMoveInRoom(host.id);
    opt1 = await createMoveInOption({ name: '취소대상', price: 7000 });
    optionIds.push(opt1.id);
  });

  afterAll(async () => {
    await cleanupMoveInNotifications(userIds);
    await cleanupMoveInByHost(host.id);
    await cleanupMoveInOptions(optionIds);
    await cleanupUsers(userIds);
  });

  test('PENDING 주문 → DELETE → CANCELLED 일괄 처리', async () => {
    const c = await createMoveInCase({
      hostId: host.id,
      moveInRoomId: room.id,
      guestUserId: guest.id,
      guestPhone: '01023456789',
      checkInDate: '2028-08-15',
      checkOutDate: '2028-08-20'
    });
    const token = generateToken(guest);

    const initRes = await request(app)
      .post(`/api/guest/move-in/requests/${c.id}/payment/init`)
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ optionId: opt1.id, quantity: 2 }] });
    expect(initRes.status).toBe(201);
    const orderDbId = initRes.body.data.orderDbId;

    const delRes = await request(app)
      .delete(`/api/guest/move-in/orders/${orderDbId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body.data.status).toBe('CANCELLED');

    const order = await MoveInGuestOrder.findByPk(orderDbId);
    expect(order.status).toBe('CANCELLED');

    const items = await MoveInGuestOrderItem.findAll({ where: { guestOrderId: orderDbId } });
    items.forEach(it => expect(it.status).toBe('CANCELLED'));

    const payments = await MoveInGuestPayment.findAll({ where: { guestOrderId: orderDbId } });
    payments.forEach(p => expect(p.status).toBe('CANCELLED'));
  });

  test('PAID 주문 취소 시도 → 400', async () => {
    const c = await createMoveInCase({
      hostId: host.id,
      moveInRoomId: room.id,
      guestUserId: guest.id,
      guestPhone: '01023456789',
      checkInDate: '2028-09-15',
      checkOutDate: '2028-09-20'
    });
    const { order } = await createPaidGuestOrder({
      caseId: c.id,
      guestUserId: guest.id,
      options: [{ option: opt1, quantity: 1 }],
      checkInDate: c.checkInDate
    });

    const token = generateToken(guest);
    const res = await request(app)
      .delete(`/api/guest/move-in/orders/${order.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(4792); // NOT_CANCELLABLE
  });

  test('다른 사람 주문 취소 시도 → 404', async () => {
    const c = await createMoveInCase({
      hostId: host.id,
      moveInRoomId: room.id,
      guestUserId: guest.id,
      guestPhone: '01023456789',
      checkInDate: '2028-10-15',
      checkOutDate: '2028-10-20'
    });
    const token = generateToken(guest);
    const initRes = await request(app)
      .post(`/api/guest/move-in/requests/${c.id}/payment/init`)
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ optionId: opt1.id, quantity: 1 }] });
    expect(initRes.status).toBe(201);
    const orderDbId = initRes.body.data.orderDbId;

    // 다른 게스트가 시도
    const otherToken = generateToken(otherGuest);
    const res = await request(app)
      .delete(`/api/guest/move-in/orders/${orderDbId}`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe(4790);
  });

  test('취소 후 같은 케이스에 새 init 가능 (재시도)', async () => {
    const c = await createMoveInCase({
      hostId: host.id,
      moveInRoomId: room.id,
      guestUserId: guest.id,
      guestPhone: '01023456789',
      checkInDate: '2028-11-15',
      checkOutDate: '2028-11-20'
    });
    const token = generateToken(guest);

    const init1 = await request(app)
      .post(`/api/guest/move-in/requests/${c.id}/payment/init`)
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ optionId: opt1.id, quantity: 1 }] });
    await request(app)
      .delete(`/api/guest/move-in/orders/${init1.body.data.orderDbId}`)
      .set('Authorization', `Bearer ${token}`);

    const init2 = await request(app)
      .post(`/api/guest/move-in/requests/${c.id}/payment/init`)
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ optionId: opt1.id, quantity: 1 }] });
    expect(init2.status).toBe(201);
  });
});
