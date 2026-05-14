/**
 * 07.cleaning-schedule-deadline.test.js
 * 청소 희망 시간 검증 + 청소 결제 D-2 마감 가드 통합 테스트
 */

'use strict';

require('../../setup/setup');

const request = require('supertest');
const app = require('../../setup/testApp');
const { MoveInCase } = require('../../../models');
const { createHost, cleanupUsers } = require('../../setup/factories/userFactory');
const {
  createMoveInRoom,
  makeCaseBody,
  cleanupMoveInByHost
} = require('../../setup/factories/moveInFactory');

describe('호스트 케이스 — 청소 희망 시간 / 결제 D-2 마감 가드', () => {
  let host, hostToken, room;

  beforeAll(async () => {
    process.env.PAYMENT_USE_MOCK = 'true';
    ({ user: host, token: hostToken } = await createHost());
    room = await createMoveInRoom(host.id, { areaPyeong: 18 });
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
    return res;
  }

  // ──────────────────────────────────────────────────────────────
  // 청소 희망 시간 검증
  // ──────────────────────────────────────────────────────────────
  describe('cleaningDate / cleaningTime 입력', () => {
    test('두 필드 모두 입력 — 저장 성공', async () => {
      const res = await newCase({
        checkInDate: '2028-01-01',
        checkOutDate: '2028-01-05',
        cleaningDate: '2028-01-05',
        cleaningTime: '14:30'
      });
      expect(res.status).toBe(201);
      expect(res.body.data.cleaningDate).toBe('2028-01-05');
      expect(res.body.data.cleaningTime).toBe('14:30:00');
    });

    test('두 필드 모두 미입력 — OK', async () => {
      const res = await newCase({
        checkInDate: '2028-02-01',
        checkOutDate: '2028-02-05'
      });
      expect(res.status).toBe(201);
      expect(res.body.data.cleaningDate).toBeNull();
      expect(res.body.data.cleaningTime).toBeNull();
    });

    test('date 만 입력, time 누락 → 400', async () => {
      const res = await newCase({
        checkInDate: '2028-03-01',
        checkOutDate: '2028-03-05',
        cleaningDate: '2028-03-05'
      });
      expect(res.status).toBe(400);
    });

    test('time 만 입력, date 누락 → 400', async () => {
      const res = await newCase({
        checkInDate: '2028-04-01',
        checkOutDate: '2028-04-05',
        cleaningTime: '10:00'
      });
      expect(res.status).toBe(400);
    });

    test('time 이 30분 단위 위반 (10:15) → 400', async () => {
      const res = await newCase({
        checkInDate: '2028-05-01',
        checkOutDate: '2028-05-05',
        cleaningDate: '2028-05-02',
        cleaningTime: '10:15'
      });
      expect(res.status).toBe(400);
    });

    test('time 이 범위 밖 (08:30) → 400', async () => {
      const res = await newCase({
        checkInDate: '2028-06-01',
        checkOutDate: '2028-06-05',
        cleaningDate: '2028-06-02',
        cleaningTime: '08:30'
      });
      expect(res.status).toBe(400);
    });

    test('time 이 범위 밖 (18:30) → 400', async () => {
      const res = await newCase({
        checkInDate: '2028-07-01',
        checkOutDate: '2028-07-05',
        cleaningDate: '2028-07-02',
        cleaningTime: '18:30'
      });
      expect(res.status).toBe(400);
    });

    test('경계값 18:00 → OK', async () => {
      const res = await newCase({
        checkInDate: '2028-08-01',
        checkOutDate: '2028-08-05',
        cleaningDate: '2028-08-02',
        cleaningTime: '18:00'
      });
      expect(res.status).toBe(201);
      expect(res.body.data.cleaningTime).toBe('18:00:00');
    });

    test('경계값 09:00 → OK', async () => {
      const res = await newCase({
        checkInDate: '2028-09-01',
        checkOutDate: '2028-09-05',
        cleaningDate: '2028-09-02',
        cleaningTime: '09:00'
      });
      expect(res.status).toBe(201);
      expect(res.body.data.cleaningTime).toBe('09:00:00');
    });

    test('응답에 cleaningPaymentDeadline / optionPaymentDeadline 노출', async () => {
      const res = await newCase({
        checkInDate: '2028-10-01',
        checkOutDate: '2028-10-05'
      });
      expect(res.status).toBe(201);
      // 입주일 2028-10-01 → 청소 D-2 = 2028-09-29 23:59:59.999 KST → ISO '+09:00'
      expect(res.body.data.cleaningPaymentDeadline).toMatch(/^2028-09-29T23:59/);
      // 옵션 D-5 = 2028-09-26 23:59:59.999 KST
      expect(res.body.data.optionPaymentDeadline).toMatch(/^2028-09-26T23:59/);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 청소 결제 D-2 마감 가드
  // ──────────────────────────────────────────────────────────────
  describe('청소 결제 init D-2 마감 가드', () => {
    test('마감 전 (입주일 미래) → 결제 init 성공', async () => {
      const create = await newCase({ checkInDate: '2030-06-01', checkOutDate: '2030-06-05' });
      const caseId = create.body.data.id;

      await request(app)
        .post(`/api/host/move-in/cases/${caseId}/cleaning/request`)
        .set('Authorization', `Bearer ${hostToken}`);

      const res = await request(app)
        .post(`/api/host/move-in/cases/${caseId}/cleaning/payment/init`)
        .set('Authorization', `Bearer ${hostToken}`);
      expect(res.status).toBe(201);
    });

    test('마감 지남 (입주일 어제) → 4797 거절', async () => {
      // 입주일이 어제 기준이면 D-2 마감은 4일 전 → 이미 지남
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const checkIn = yesterday.toISOString().slice(0, 10);
      const day5 = new Date(yesterday.getTime() + 4 * 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 10);

      const create = await newCase({ checkInDate: checkIn, checkOutDate: day5 });
      const caseId = create.body.data.id;

      await request(app)
        .post(`/api/host/move-in/cases/${caseId}/cleaning/request`)
        .set('Authorization', `Bearer ${hostToken}`);

      const res = await request(app)
        .post(`/api/host/move-in/cases/${caseId}/cleaning/payment/init`)
        .set('Authorization', `Bearer ${hostToken}`);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(4797);
    });
  });
});
