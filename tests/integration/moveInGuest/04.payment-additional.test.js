/**
 * 04.payment-additional.test.js
 * ADDITIONAL 결제 통합 테스트
 *
 * 검증:
 *  - INITIAL PAID 상태에서만 ADDITIONAL 진입 가능
 *  - INITIAL 없으면 400
 *  - PENDING ADDITIONAL 1건 제한 (INITIAL 결제 후 ADDITIONAL 두 번 init 시도)
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

describe('MoveIn Guest — ADDITIONAL Payment (Mock)', () => {
  let host, guest, room, opt1, c;
  const optionIds = [];
  const userIds = [];

  beforeAll(async () => {
    process.env.PAYMENT_USE_MOCK = 'true';
    ({ user: host } = await createHost());
    ({ user: guest } = await createGuest({ phoneNumber: '01023456789' }));
    userIds.push(host.id, guest.id);

    room = await createMoveInRoom(host.id);
    opt1 = await createMoveInOption({ name: '추가옵션', price: 5000 });
    optionIds.push(opt1.id);
  });

  afterAll(async () => {
    await cleanupMoveInNotifications(userIds);
    await cleanupMoveInByHost(host.id);
    await cleanupMoveInOptions(optionIds);
    await cleanupUsers(userIds);
  });

  test('ADDITIONAL — INITIAL PAID 없으면 400 NOT_PAYABLE', async () => {
    c = await createMoveInCase({
      hostId: host.id,
      moveInRoomId: room.id,
      guestUserId: guest.id,
      guestPhone: '01023456789',
      checkInDate: '2028-07-15',
      checkOutDate: '2028-07-20'
    });
    const token = generateToken(guest);
    const res = await request(app)
      .post(`/api/guest/move-in/requests/${c.id}/additional/init`)
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ optionId: opt1.id, quantity: 1 }] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(4791); // ORDER_NOT_PAYABLE
  });

  test('ADDITIONAL — INITIAL PAID 후 새 PENDING 주문 생성', async () => {
    // INITIAL PAID 직접 주입
    await createPaidGuestOrder({
      caseId: c.id,
      guestUserId: guest.id,
      options: [{ option: opt1, quantity: 1 }],
      orderType: 'INITIAL',
      checkInDate: c.checkInDate
    });

    const token = generateToken(guest);
    const res = await request(app)
      .post(`/api/guest/move-in/requests/${c.id}/additional/init`)
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ optionId: opt1.id, quantity: 2 }] });
    expect(res.status).toBe(201);
    expect(res.body.data.orderType).toBe('ADDITIONAL');
    expect(res.body.data.amount).toBe(10000);
  });

  test('ADDITIONAL — 이미 PENDING ADDITIONAL 있으면 409', async () => {
    const token = generateToken(guest);
    const res = await request(app)
      .post(`/api/guest/move-in/requests/${c.id}/additional/init`)
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ optionId: opt1.id, quantity: 1 }] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(4793);
  });

  test('ADDITIONAL confirm → PAID', async () => {
    // 위 테스트에서 만든 PENDING ADDITIONAL 가져오기
    const { MoveInGuestOrder, MoveInGuestPayment } = require('../../../models');
    const pending = await MoveInGuestOrder.findOne({
      where: { caseId: c.id, status: 'PENDING', orderType: 'ADDITIONAL' }
    });
    expect(pending).toBeTruthy();
    const payment = await MoveInGuestPayment.findOne({ where: { guestOrderId: pending.id } });

    const token = generateToken(guest);
    const res = await request(app)
      .post(`/api/guest/move-in/requests/${c.id}/additional/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({ paymentId: payment.id });

    expect(res.status).toBe(200);
    const fresh = await MoveInGuestOrder.findByPk(pending.id);
    expect(fresh.status).toBe('PAID');
  });
});
