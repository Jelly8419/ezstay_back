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

  describe('일별 발송 횟수 제한 (케이스당 1일 10회)', () => {
    test('send 1회 + resend 9회 = 10회까지 성공, 11번째 → 400(4817)', async () => {
      const c = await newCase({ checkInDate: '2027-11-01', checkOutDate: '2027-11-05' });

      // 1회차: 최초 발송
      const first = await request(app)
        .post(`/api/host/move-in/cases/${c.id}/payment-request/send`)
        .set('Authorization', `Bearer ${hostToken}`);
      expect(first.status).toBe(200);

      // 2~10회차: 재발송 9회
      for (let i = 2; i <= 10; i++) {
        const r = await request(app)
          .post(`/api/host/move-in/cases/${c.id}/payment-request/resend`)
          .set('Authorization', `Bearer ${hostToken}`);
        expect(r.status).toBe(200);
      }

      // 11회차: 한도 초과 → 차단
      const over = await request(app)
        .post(`/api/host/move-in/cases/${c.id}/payment-request/resend`)
        .set('Authorization', `Bearer ${hostToken}`);
      expect(over.status).toBe(400);
      expect(over.body.code).toBe(4817);
      expect(over.body.message).toBe('오늘은 더 이상 임차인에게 알림톡을 보낼 수 없습니다.');

      // resendCount 는 성공한 9회만 증가 (11회차는 발송 전 차단)
      const pr = await MoveInPaymentRequest.findOne({ where: { caseId: c.id } });
      expect(pr.resendCount).toBe(9);
    });

    test('한도는 케이스 단위 — 다른 케이스는 별도 카운트', async () => {
      const c1 = await newCase({ checkInDate: '2027-12-01', checkOutDate: '2027-12-05' });
      const c2 = await newCase({ checkInDate: '2027-12-10', checkOutDate: '2027-12-15' });

      // c1 을 10회 모두 소진
      await request(app)
        .post(`/api/host/move-in/cases/${c1.id}/payment-request/send`)
        .set('Authorization', `Bearer ${hostToken}`);
      for (let i = 2; i <= 10; i++) {
        await request(app)
          .post(`/api/host/move-in/cases/${c1.id}/payment-request/resend`)
          .set('Authorization', `Bearer ${hostToken}`);
      }
      const c1Over = await request(app)
        .post(`/api/host/move-in/cases/${c1.id}/payment-request/resend`)
        .set('Authorization', `Bearer ${hostToken}`);
      expect(c1Over.status).toBe(400);

      // c2 는 영향 없이 발송 가능
      const c2Send = await request(app)
        .post(`/api/host/move-in/cases/${c2.id}/payment-request/send`)
        .set('Authorization', `Bearer ${hostToken}`);
      expect(c2Send.status).toBe(200);
    });
  });
});
