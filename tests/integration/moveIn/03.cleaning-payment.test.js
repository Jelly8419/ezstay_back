/**
 * 03.cleaning-payment.test.js
 * 청소 신청/취소/결제 (Mock 모드) 통합 테스트
 */
'use strict';

require('../../setup/setup');

const request = require('supertest');
const app = require('../../setup/testApp');
const { MoveInCase, MoveInPayment } = require('../../../models');
const { createHost, cleanupUsers } = require('../../setup/factories/userFactory');
const {
  createMoveInRoom,
  makeCaseBody,
  cleanupMoveInByHost
} = require('../../setup/factories/moveInFactory');

describe('MoveIn 청소 결제 (Mock)', () => {
  let host, hostToken, room;

  beforeAll(async () => {
    process.env.PAYMENT_USE_MOCK = 'true';
    ({ user: host, token: hostToken } = await createHost());
    room = await createMoveInRoom(host.id, { areaPyeong: 18 }); // 청소비 70,000원 구간
  });

  afterAll(async () => {
    await cleanupMoveInByHost(host.id);
    await cleanupUsers([host.id]);
  });

  async function newCase(overrides = {}) {
    const res = await request(app)
      .post('/api/host/move-in/cases')
      .set('Authorization', `Bearer ${hostToken}`)
      .send(makeCaseBody(room.id, overrides));
    return res.body.data;
  }

  test('청소비 견적: 18평 → 70,000원', async () => {
    const c = await newCase({ checkInDate: '2027-01-01', checkOutDate: '2027-01-05' });
    const res = await request(app)
      .post(`/api/host/move-in/cases/${c.id}/cleaning/quote`)
      .set('Authorization', `Bearer ${hostToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.cleaningFee).toBe(70000);
  });

  test('청소 신청 → cleaning_status=PAYMENT_PENDING + cleaning_fee 락인', async () => {
    const c = await newCase({ checkInDate: '2027-02-01', checkOutDate: '2027-02-05' });
    const res = await request(app)
      .post(`/api/host/move-in/cases/${c.id}/cleaning/request`)
      .set('Authorization', `Bearer ${hostToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.cleaningStatus).toBe('PAYMENT_PENDING');
    expect(res.body.data.cleaningFee).toBe(70000);
  });

  test('청소용품 미구비 방 → 신청 거부', async () => {
    const noSuppliesRoom = await createMoveInRoom(host.id, {
      cleaningSuppliesAvailable: false,
      cleaningSuppliesLocation: null
    });
    const c = await newCase({
      moveInRoomId: noSuppliesRoom.id,
      checkInDate: '2027-03-01',
      checkOutDate: '2027-03-05'
    });
    const res = await request(app)
      .post(`/api/host/move-in/cases/${c.id}/cleaning/request`)
      .set('Authorization', `Bearer ${hostToken}`);
    expect(res.status).toBe(400);
  });

  test('결제 init → confirm (Mock 성공) → cleaning_status=PAID', async () => {
    const c = await newCase({ checkInDate: '2027-04-01', checkOutDate: '2027-04-05' });
    await request(app)
      .post(`/api/host/move-in/cases/${c.id}/cleaning/request`)
      .set('Authorization', `Bearer ${hostToken}`);

    const initRes = await request(app)
      .post(`/api/host/move-in/cases/${c.id}/cleaning/payment/init`)
      .set('Authorization', `Bearer ${hostToken}`);
    expect(initRes.status).toBe(201);
    expect(initRes.body.data.orderId).toMatch(/^M\d{6}\d{5}$/);
    const paymentId = initRes.body.data.paymentId;

    const confirmRes = await request(app)
      .post(`/api/host/move-in/cases/${c.id}/cleaning/payment/confirm`)
      .set('Authorization', `Bearer ${hostToken}`)
      .send({ paymentId });

    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.data.cleaningStatus).toBe('PAID');

    const reloadedCase = await MoveInCase.findByPk(c.id);
    expect(reloadedCase.cleaningStatus).toBe('PAID');
    expect(reloadedCase.cleaningPaidAt).not.toBeNull();

    const payment = await MoveInPayment.findByPk(paymentId);
    expect(payment.status).toBe('PAID');
    expect(payment.pgTid).toMatch(/^mock_/);
  });

  test('Mock 실패 시뮬레이션 → MoveInPayment.status=FAILED, case는 PAYMENT_PENDING 유지', async () => {
    const c = await newCase({ checkInDate: '2027-05-01', checkOutDate: '2027-05-05' });
    await request(app)
      .post(`/api/host/move-in/cases/${c.id}/cleaning/request`)
      .set('Authorization', `Bearer ${hostToken}`);

    const initRes = await request(app)
      .post(`/api/host/move-in/cases/${c.id}/cleaning/payment/init`)
      .set('Authorization', `Bearer ${hostToken}`);
    const paymentId = initRes.body.data.paymentId;

    const confirmRes = await request(app)
      .post(`/api/host/move-in/cases/${c.id}/cleaning/payment/confirm`)
      .set('Authorization', `Bearer ${hostToken}`)
      .send({ paymentId, simulateFailure: true });

    expect(confirmRes.status).toBe(400);

    const reloadedCase = await MoveInCase.findByPk(c.id);
    expect(reloadedCase.cleaningStatus).toBe('PAYMENT_PENDING');

    const payment = await MoveInPayment.findByPk(paymentId);
    expect(payment.status).toBe('FAILED');
    expect(payment.failureReason).toContain('MOCK');
  });

  test('청소 취소: PAYMENT_PENDING → CANCELLED + PENDING 결제도 CANCELLED', async () => {
    const c = await newCase({ checkInDate: '2027-06-01', checkOutDate: '2027-06-05' });
    await request(app)
      .post(`/api/host/move-in/cases/${c.id}/cleaning/request`)
      .set('Authorization', `Bearer ${hostToken}`);

    const initRes = await request(app)
      .post(`/api/host/move-in/cases/${c.id}/cleaning/payment/init`)
      .set('Authorization', `Bearer ${hostToken}`);
    const paymentId = initRes.body.data.paymentId;

    const cancelRes = await request(app)
      .delete(`/api/host/move-in/cases/${c.id}/cleaning/request`)
      .set('Authorization', `Bearer ${hostToken}`);
    expect(cancelRes.status).toBe(200);

    const payment = await MoveInPayment.findByPk(paymentId);
    expect(payment.status).toBe('CANCELLED');
  });
});
