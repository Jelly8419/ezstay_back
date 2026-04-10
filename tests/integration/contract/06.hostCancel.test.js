/**
 * 06.hostCancel.test.js
 * TC-06-01 ~ TC-06-08: 호스트 귀책 취소 통합 테스트
 *
 * POST /api/contracts/:contractId/cancel-request   (호스트가 취소 요청)
 * POST /api/admin/reservations/:contractId/approve-cancel-request  (관리자 승인)
 * POST /api/admin/reservations/:contractId/reject-cancel-request   (관리자 반려)
 *
 * TC 문서와 실제 구현 차이:
 * - TC-06-01 (PAYMENT_COMPLETED에서 호스트 취소): 컨트롤러가 IN_PROGRESS만 허용 → 400, code 4623
 * - TC-06-04 (관리자 승인 후 Refund/AdminRefund 생성): 실제로는 Refund 미생성, Settlement/Payout ON_HOLD만 처리
 *   → 별도 관리자 수동 환불 처리 흐름 (withRefund 플래그만 전달)
 */

'use strict';

require('../../setup/setup');

const request  = require('supertest');
const app      = require('../../setup/testApp');
const jwt      = require('jsonwebtoken');
const { Contract, Settlement, Admin } = require('../../../models');
const { createHost, cleanupUsers }    = require('../../setup/factories/userFactory');
const { createRoom, cleanupRooms }    = require('../../setup/factories/roomFactory');
const {
  createPaidContract,
  createInProgressContract,
  cleanupContract,
  daysLater,
} = require('../../setup/factories/contractFactory');

// ─── 공통 데이터 ─────────────────────────────────────────────────────

let host, hostToken;
let room;
let admin, adminToken;

let createdContractIds = [];
let createdUserIds     = [];
let createdRoomIds     = [];
let createdAdminIds    = [];

beforeAll(async () => {
  // 호스트 생성
  const h = await createHost();
  host      = h.user;
  hostToken = h.token;

  const r = await createRoom(host.id);
  room = r.room;

  createdUserIds.push(host.id);
  createdRoomIds.push(room.id);

  // 테스트용 Admin 생성
  admin = await Admin.create({
    username: `admin_test_${Date.now()}`,
    password: 'hashed_password',
    name: '테스트관리자',
    role: 'admin',
    isActive: true,
  });
  createdAdminIds.push(admin.id);

  // 관리자 JWT (middleware: decoded.userId → Admin.findByPk)
  adminToken = jwt.sign(
    { userId: admin.id, username: admin.username },
    process.env.JWT_SECRET || 'test_jwt_secret_key_for_testing_only',
    { expiresIn: '1h' }
  );
});

afterAll(async () => {
  for (const id of createdContractIds) {
    await cleanupContract(id).catch(() => {});
  }
  await cleanupRooms(createdRoomIds).catch(() => {});
  await cleanupUsers(createdUserIds).catch(() => {});
  for (const id of createdAdminIds) {
    await Admin.destroy({ where: { id } }).catch(() => {});
  }
});

// IN_PROGRESS 계약 생성 헬퍼
async function makeInProgress(options = {}) {
  const result = await createInProgressContract({ host, room, ...options });
  createdContractIds.push(result.contract.id);
  return result;
}

// PAYMENT_COMPLETED 계약 생성 헬퍼
async function makePaid(options = {}) {
  const result = await createPaidContract({ host, room, ...options });
  createdContractIds.push(result.contract.id);
  return result;
}

// ─── TC-06-01: PAYMENT_COMPLETED에서 호스트 취소 요청 → 400 ──────────
// 컨트롤러가 IN_PROGRESS만 허용하므로 400, code 4623 반환

test('TC-06-01: PAYMENT_COMPLETED에서 호스트 cancel-request → 400, code 4623', async () => {
  const { contract } = await makePaid({
    contractOverrides: {
      checkInDate: daysLater(10),
      checkOutDate: daysLater(24),
    },
  });

  const res = await request(app)
    .post(`/api/contracts/${contract.id}/cancel-request`)
    .set('Authorization', `Bearer ${hostToken}`)
    .send({ reason: '호스트 사정으로 취소 요청합니다.' });

  // IN_PROGRESS 상태가 아니면 4623 반환
  expect(res.status).toBe(400);
  expect(res.body.code).toBe(4623);
});

// ─── TC-06-02: IN_PROGRESS에서 호스트 취소 요청 → 200, CANCEL_REQUESTED ──

test('TC-06-02: IN_PROGRESS에서 호스트 cancel-request → 200, CANCEL_REQUESTED', async () => {
  const { contract } = await makeInProgress();

  const res = await request(app)
    .post(`/api/contracts/${contract.id}/cancel-request`)
    .set('Authorization', `Bearer ${hostToken}`)
    .send({ reason: '호스트 사정으로 취소 요청합니다.' });

  expect(res.status).toBe(200);

  const updated = await Contract.findByPk(contract.id);
  expect(updated.status).toBe('CANCEL_REQUESTED');
});

// ─── TC-06-03: reason 없이 취소 요청 → 400, code 4622 ───────────────

test('TC-06-03: reason 없이 cancel-request → 400, code 4622', async () => {
  const { contract } = await makeInProgress();

  const res = await request(app)
    .post(`/api/contracts/${contract.id}/cancel-request`)
    .set('Authorization', `Bearer ${hostToken}`)
    .send({});  // reason 누락

  expect(res.status).toBe(400);
  expect(res.body.code).toBe(4622);

  // 상태 변경 없음
  const unchanged = await Contract.findByPk(contract.id);
  expect(unchanged.status).toBe('IN_PROGRESS');
});

// ─── TC-06-04: 관리자가 호스트 취소 승인 → CANCELLED_BY_HOST, Settlement ON_HOLD ──

test('TC-06-04: 관리자 approve-cancel-request → 200, CANCELLED_BY_HOST, Settlement ON_HOLD', async () => {
  const { contract } = await makeInProgress();

  // 1단계: 호스트 취소 요청
  await request(app)
    .post(`/api/contracts/${contract.id}/cancel-request`)
    .set('Authorization', `Bearer ${hostToken}`)
    .send({ reason: '호스트 취소 요청' });

  // 2단계: 관리자 승인
  const res = await request(app)
    .post(`/api/admin/reservations/${contract.id}/approve-cancel-request`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ withRefund: true, adminNote: '호스트 귀책 취소 승인' });

  expect(res.status).toBe(200);
  expect(res.body.data.newStatus).toBe('CANCELLED_BY_HOST');

  // Contract 상태 확인
  const updated = await Contract.findByPk(contract.id);
  expect(updated.status).toBe('CANCELLED_BY_HOST');

  // Settlement ON_HOLD 확인
  const settlement = await Settlement.findOne({ where: { contractId: contract.id } });
  if (settlement) {
    expect(settlement.status).toBe('ON_HOLD');
  }
});

// ─── TC-06-05: 관리자가 취소 요청 반려 → IN_PROGRESS 복원 ────────────

test('TC-06-05: 관리자 reject-cancel-request → 200, IN_PROGRESS 복원', async () => {
  const { contract } = await makeInProgress();

  // 1단계: 호스트 취소 요청
  await request(app)
    .post(`/api/contracts/${contract.id}/cancel-request`)
    .set('Authorization', `Bearer ${hostToken}`)
    .send({ reason: '호스트 취소 요청' });

  // 2단계: 관리자 반려
  const res = await request(app)
    .post(`/api/admin/reservations/${contract.id}/reject-cancel-request`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ adminNote: '반려 사유' });

  expect(res.status).toBe(200);

  // Contract 상태가 IN_PROGRESS로 복원
  const updated = await Contract.findByPk(contract.id);
  expect(updated.status).toBe('IN_PROGRESS');
});

// ─── TC-06-06: 이미 취소 요청된 계약 재요청 → 400, code 4623 ─────────

test('TC-06-06: CANCEL_REQUESTED 상태에서 재요청 → 400, code 4623', async () => {
  const { contract } = await makeInProgress();

  // 1차 취소 요청
  await request(app)
    .post(`/api/contracts/${contract.id}/cancel-request`)
    .set('Authorization', `Bearer ${hostToken}`)
    .send({ reason: '1차 취소 요청' });

  // 2차 재요청
  const res = await request(app)
    .post(`/api/contracts/${contract.id}/cancel-request`)
    .set('Authorization', `Bearer ${hostToken}`)
    .send({ reason: '2차 취소 요청' });

  expect(res.status).toBe(400);
  expect(res.body.code).toBe(4623);
});

// ─── TC-06-07: CANCEL_REQUESTED 아닌 계약 관리자 승인 시도 → 400, code 4631 ──

test('TC-06-07: IN_PROGRESS 계약에 관리자 approve-cancel-request → 400, code 4631', async () => {
  const { contract } = await makeInProgress();
  // cancel-request 없이 바로 승인 시도 → 상태가 IN_PROGRESS

  const res = await request(app)
    .post(`/api/admin/reservations/${contract.id}/approve-cancel-request`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ withRefund: false, adminNote: '잘못된 승인' });

  expect(res.status).toBe(400);
  expect(res.body.code).toBe(4631);
});

// ─── TC-06-08: CANCEL_REQUESTED 아닌 계약 관리자 반려 시도 → 400, code 4633 ──

test('TC-06-08: IN_PROGRESS 계약에 관리자 reject-cancel-request → 400, code 4633', async () => {
  const { contract } = await makeInProgress();

  const res = await request(app)
    .post(`/api/admin/reservations/${contract.id}/reject-cancel-request`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ adminNote: '잘못된 반려' });

  expect(res.status).toBe(400);
  expect(res.body.code).toBe(4633);
});
