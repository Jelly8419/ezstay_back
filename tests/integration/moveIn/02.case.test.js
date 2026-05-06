/**
 * 02.case.test.js
 * 케이스 CRUD + 날짜 겹침 + 토큰 재발급 통합 테스트
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

describe('MoveIn /api/host/move-in/cases', () => {
  let host, hostToken, room;

  beforeAll(async () => {
    ({ user: host, token: hostToken } = await createHost());
    room = await createMoveInRoom(host.id);
  });

  afterAll(async () => {
    await cleanupMoveInByHost(host.id);
    await cleanupUsers([host.id]);
  });

  describe('POST /cases', () => {
    test('정상 등록 → room_snapshot 락인 + 토큰 자동 발급', async () => {
      const res = await request(app)
        .post('/api/host/move-in/cases')
        .set('Authorization', `Bearer ${hostToken}`)
        .send(makeCaseBody(room.id, {
          checkInDate: '2026-07-01',
          checkOutDate: '2026-07-08'
        }));

      expect(res.status).toBe(201);
      expect(res.body.data.cleaningStatus).toBe('NOT_REQUESTED');
      expect(res.body.data.roomSnapshot).toBeTruthy();
      expect(res.body.data.roomSnapshot.areaPyeong).toBe(15);
      expect(res.body.data.paymentRequest).toBeTruthy();
      expect(res.body.data.paymentRequest.status).toBe('NOT_SENT');

      // 토큰 발급 확인
      const pr = await MoveInPaymentRequest.findOne({ where: { caseId: res.body.data.id } });
      expect(pr).toBeTruthy();
      expect(pr.token).toMatch(/^[0-9a-f-]{36}$/);
    });

    test('날짜 겹침 → 409 차단', async () => {
      // 사전 등록
      await request(app)
        .post('/api/host/move-in/cases')
        .set('Authorization', `Bearer ${hostToken}`)
        .send(makeCaseBody(room.id, {
          checkInDate: '2026-08-01',
          checkOutDate: '2026-08-10'
        }));

      // 겹치는 기간
      const res = await request(app)
        .post('/api/host/move-in/cases')
        .set('Authorization', `Bearer ${hostToken}`)
        .send(makeCaseBody(room.id, {
          checkInDate: '2026-08-05',
          checkOutDate: '2026-08-15'
        }));

      expect(res.status).toBe(409);
    });

    test('퇴실일 ≤ 입주일 → 400', async () => {
      const res = await request(app)
        .post('/api/host/move-in/cases')
        .set('Authorization', `Bearer ${hostToken}`)
        .send(makeCaseBody(room.id, {
          checkInDate: '2026-09-10',
          checkOutDate: '2026-09-05'
        }));
      expect(res.status).toBe(400);
    });

    test('sendGuestPaymentRequest=true → 자동 발송 (Mock 알림톡)', async () => {
      const res = await request(app)
        .post('/api/host/move-in/cases')
        .set('Authorization', `Bearer ${hostToken}`)
        .send(makeCaseBody(room.id, {
          checkInDate: '2026-10-01',
          checkOutDate: '2026-10-05',
          sendGuestPaymentRequest: true
        }));

      expect(res.status).toBe(201);
      expect(res.body.data.paymentRequest.status).toBe('SENT');
      expect(res.body.data.autoSend.sent).toBe(true);
    });
  });

  describe('PATCH /cases/:caseId', () => {
    let caseId, originalToken;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/host/move-in/cases')
        .set('Authorization', `Bearer ${hostToken}`)
        .send(makeCaseBody(room.id, {
          checkInDate: '2026-11-01',
          checkOutDate: '2026-11-08',
          guestPhone: '01011112222'
        }));
      caseId = res.body.data.id;
      const pr = await MoveInPaymentRequest.findOne({ where: { caseId } });
      originalToken = pr.token;
    });

    test('휴대폰 번호 변경 시 토큰 재발급 + 발송 상태 초기화', async () => {
      const res = await request(app)
        .patch(`/api/host/move-in/cases/${caseId}`)
        .set('Authorization', `Bearer ${hostToken}`)
        .send({ guestPhone: '01099998888' });

      expect(res.status).toBe(200);
      const pr = await MoveInPaymentRequest.findOne({ where: { caseId } });
      expect(pr.token).not.toBe(originalToken);
      expect(pr.status).toBe('NOT_SENT');
      expect(pr.resendCount).toBe(0);
    });

    test('퇴실일 변경 시 만료시각 재계산', async () => {
      const res = await request(app)
        .patch(`/api/host/move-in/cases/${caseId}`)
        .set('Authorization', `Bearer ${hostToken}`)
        .send({ checkOutDate: '2026-11-15' });

      expect(res.status).toBe(200);
      const pr = await MoveInPaymentRequest.findOne({ where: { caseId } });
      // 퇴실일+1일 = 2026-11-16 (KST)
      expect(new Date(pr.expiresAt).getDate()).toBeGreaterThanOrEqual(15);
    });
  });
});
