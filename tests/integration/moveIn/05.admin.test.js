/**
 * 05.admin.test.js
 * 관리자 source 분기/병합 + MoveInServiceTask 상태 전이 통합 테스트
 */
'use strict';

require('../../setup/setup');

const request = require('supertest');
const app = require('../../setup/testApp');
const { MoveInServiceTask } = require('../../../models');
const { createHost, cleanupUsers } = require('../../setup/factories/userFactory');
const { createAdmin, cleanupAdmins } = require('../../setup/factories/adminFactory');
const {
  createMoveInRoom,
  makeCaseBody,
  cleanupMoveInByHost
} = require('../../setup/factories/moveInFactory');

describe('MoveIn 관리자 통합 화면', () => {
  let host, hostToken, room, admin, adminToken;
  let caseId;

  beforeAll(async () => {
    ({ user: host, token: hostToken } = await createHost());
    ({ admin, token: adminToken } = await createAdmin({ role: 'admin' }));
    room = await createMoveInRoom(host.id, { areaPyeong: 12 }); // 70,000원

    // 케이스 생성 + 청소 결제 완료 (Mock)
    process.env.PAYMENT_USE_MOCK = 'true';
    const caseRes = await request(app)
      .post('/api/host/move-in/cases')
      .set('Authorization', `Bearer ${hostToken}`)
      .send(makeCaseBody(room.id, {
        checkInDate: '2027-11-01',
        checkOutDate: '2027-11-08'
      }));
    caseId = caseRes.body.data.id;

    await request(app)
      .post(`/api/host/move-in/cases/${caseId}/cleaning/request`)
      .set('Authorization', `Bearer ${hostToken}`);

    const initRes = await request(app)
      .post(`/api/host/move-in/cases/${caseId}/cleaning/payment/init`)
      .set('Authorization', `Bearer ${hostToken}`);

    await request(app)
      .post(`/api/host/move-in/cases/${caseId}/cleaning/payment/confirm`)
      .set('Authorization', `Bearer ${hostToken}`)
      .send({ paymentId: initRes.body.data.paymentId });

    // ServiceTask 직접 생성 (스케줄러 대신)
    await MoveInServiceTask.create({
      caseId,
      taskType: 'CLEANING',
      referenceDate: '2027-11-08',
      status: 'PENDING'
    });
  });

  afterAll(async () => {
    await cleanupMoveInByHost(host.id);
    await cleanupUsers([host.id]);
    await cleanupAdmins([admin.id]);
  });

  test('GET /admin/service-tasks?source=move_in → MoveIn 태스크만 반환', async () => {
    const res = await request(app)
      .get('/api/admin/service-tasks?source=move_in&tab=pending')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBeGreaterThan(0);
    expect(res.body.data.items.every(it => it.source === 'move_in')).toBe(true);
  });

  test('GET /admin/service-tasks?source=internal → MoveIn 태스크 노출 안 됨', async () => {
    const res = await request(app)
      .get('/api/admin/service-tasks?source=internal')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.items.every(it => it.source !== 'move_in')).toBe(true);
  });

  test('GET /admin/service-tasks?source=all → 두 도메인 합쳐서 응답 + breakdown', async () => {
    const res = await request(app)
      .get('/api/admin/service-tasks?source=all')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.breakdown).toBeTruthy();
    expect(res.body.data.breakdown.move_in).toBeGreaterThan(0);
  });

  test('단건 조회 source=move_in → 비밀번호 복호화 응답', async () => {
    const task = await MoveInServiceTask.findOne({ where: { caseId } });
    const res = await request(app)
      .get(`/api/admin/service-tasks/${task.id}?source=move_in`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.source).toBe('move_in');
    expect(res.body.data.commonEntrancePassword).toBe('2479#'); // 평문 복호화
    expect(res.body.data.doorLockPassword).toBe('0512*');
    expect(Array.isArray(res.body.data.logs)).toBe(true);
  });

  test('상태 변경 source=move_in: PENDING → RESERVED + 로그 기록', async () => {
    const task = await MoveInServiceTask.findOne({ where: { caseId } });
    const res = await request(app)
      .patch(`/api/admin/service-tasks/${task.id}/status?source=move_in`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        status: 'RESERVED',
        vendorName: '청소업체A',
        vendorContact: '010-1111-2222',
        reservedAmount: 70000
      });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('RESERVED');
    expect(res.body.data.vendorName).toBe('청소업체A');

    // 로그 확인
    const detail = await request(app)
      .get(`/api/admin/service-tasks/${task.id}?source=move_in`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(detail.body.data.logs.length).toBeGreaterThan(0);
    expect(detail.body.data.logs[0].toStatus).toBe('RESERVED');
  });

  test('잘못된 상태 전이 거부: COMPLETED → 동일 RESERVED만 허용', async () => {
    // 위에서 RESERVED → COMPLETED 로 진행
    const task = await MoveInServiceTask.findOne({ where: { caseId } });
    await request(app)
      .patch(`/api/admin/service-tasks/${task.id}/status?source=move_in`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'COMPLETED', actualAmount: 70000 });

    // COMPLETED → COMPLETED 같은 전이는 거부 (transitions에 없음)
    const res = await request(app)
      .patch(`/api/admin/service-tasks/${task.id}/status?source=move_in`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'COMPLETED' });
    expect(res.status).toBe(400);
  });
});
