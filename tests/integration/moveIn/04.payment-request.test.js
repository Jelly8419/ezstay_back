/**
 * 04.payment-request.test.js
 * 임차인 결제 요청 발송/재발송/링크 통합 테스트 (알림톡 미연동 — Mock 응답)
 */
'use strict';

require('../../setup/setup');

const request = require('supertest');
const app = require('../../setup/testApp');
const { MoveInPaymentRequest } = require('../../../models');
const { createHost, cleanupUsers } = require('../../setup/factories/userFactory');
const {
  createMoveInRoom,
  makeCaseBody,
  cleanupMoveInByHost
} = require('../../setup/factories/moveInFactory');

describe('MoveIn 임차인 결제 요청 발송', () => {
  let host, hostToken, room;

  beforeAll(async () => {
    ({ user: host, token: hostToken } = await createHost());
    room = await createMoveInRoom(host.id);
  });

  afterAll(async () => {
    await cleanupMoveInByHost(host.id);
    await cleanupUsers([host.id]);
  });

  async function newCase(overrides = {}) {
    const res = await request(app)
      .post('/api/host/move-in/cases')
      .set('Authorization', `Bearer ${hostToken}`)
      .send(makeCaseBody(room.id, { sendGuestPaymentRequest: false, ...overrides }));
    return res.body.data;
  }

  test('최초 발송: NOT_SENT → SENT, sentAt 기록', async () => {
    const c = await newCase({ checkInDate: '2027-07-01', checkOutDate: '2027-07-05' });

    const res = await request(app)
      .post(`/api/host/move-in/cases/${c.id}/payment-request/send`)
      .set('Authorization', `Bearer ${hostToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('SENT');
    expect(res.body.data.paymentLink).toMatch(/\/move-in\/payment\/[0-9a-f-]+/);

    const pr = await MoveInPaymentRequest.findOne({ where: { caseId: c.id } });
    expect(pr.status).toBe('SENT');
    expect(pr.sentAt).not.toBeNull();
  });

  test('이미 SENT인데 send 재호출 → 400', async () => {
    const c = await newCase({ checkInDate: '2027-08-01', checkOutDate: '2027-08-05' });
    await request(app)
      .post(`/api/host/move-in/cases/${c.id}/payment-request/send`)
      .set('Authorization', `Bearer ${hostToken}`);

    const res = await request(app)
      .post(`/api/host/move-in/cases/${c.id}/payment-request/send`)
      .set('Authorization', `Bearer ${hostToken}`);
    expect(res.status).toBe(400);
  });

  test('재발송: resendCount++, lastResentAt 갱신, 토큰은 동일', async () => {
    const c = await newCase({ checkInDate: '2027-09-01', checkOutDate: '2027-09-05' });
    await request(app)
      .post(`/api/host/move-in/cases/${c.id}/payment-request/send`)
      .set('Authorization', `Bearer ${hostToken}`);
    const before = await MoveInPaymentRequest.findOne({ where: { caseId: c.id } });

    const res = await request(app)
      .post(`/api/host/move-in/cases/${c.id}/payment-request/resend`)
      .set('Authorization', `Bearer ${hostToken}`);

    expect(res.status).toBe(200);
    const after = await MoveInPaymentRequest.findOne({ where: { caseId: c.id } });
    expect(after.token).toBe(before.token);
    expect(after.resendCount).toBe(1);
    expect(after.lastResentAt).not.toBeNull();
  });

  test('GET /payment-request/link → URL 반환', async () => {
    const c = await newCase({ checkInDate: '2027-10-01', checkOutDate: '2027-10-05' });
    const res = await request(app)
      .get(`/api/host/move-in/cases/${c.id}/payment-request/link`)
      .set('Authorization', `Bearer ${hostToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.paymentLink).toBeTruthy();
    expect(res.body.data.status).toBe('NOT_SENT');
  });
});
