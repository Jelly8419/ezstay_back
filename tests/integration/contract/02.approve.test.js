/**
 * 02.approve.test.js
 * TC-02-01 ~ TC-02-06: 호스트 승인/거절 통합 테스트
 *
 * PATCH /api/contracts/:contractId/approve
 * PATCH /api/contracts/:contractId/reject
 */

'use strict';

require('../../setup/setup');

const request = require('supertest');
const app     = require('../../setup/testApp');
const { Contract, ChatRoom, ContractStatusLog } = require('../../../models');
const { createGuest, createHost, cleanupUsers } = require('../../setup/factories/userFactory');
const { createRoom, cleanupRooms }              = require('../../setup/factories/roomFactory');
const {
  createPendingContract,
  cleanupContract,
} = require('../../setup/factories/contractFactory');

// ─── 공통 데이터 ────────────────────────────────────────────────────

let guest, guestToken;
let host,  hostToken;
let otherHost, otherHostToken;
let room;

let createdContractIds = [];
let createdUserIds     = [];
let createdRoomIds     = [];

beforeAll(async () => {
  const g = await createGuest();
  guest      = g.user;
  guestToken = g.token;

  const h = await createHost();
  host      = h.user;
  hostToken = h.token;

  const oh = await createHost();
  otherHost      = oh.user;
  otherHostToken = oh.token;

  const r = await createRoom(host.id);
  room = r.room;

  createdUserIds.push(guest.id, host.id, otherHost.id);
  createdRoomIds.push(room.id);
});

afterAll(async () => {
  for (const id of createdContractIds) {
    await cleanupContract(id).catch(() => {});
  }
  await cleanupRooms(createdRoomIds).catch(() => {});
  await cleanupUsers(createdUserIds).catch(() => {});
});

// 계약 생성 헬퍼 — contractId 자동 추적
async function makePending(options = {}) {
  const result = await createPendingContract({ guest, guestToken, host, room, ...options });
  createdContractIds.push(result.contract.id);
  return result;
}

// ─── TC-02-01: 호스트가 PENDING_APPROVAL 계약 승인 ──────────────────

test('TC-02-01: 호스트가 PENDING_APPROVAL 계약을 승인하면 200, status=APPROVED, ChatRoom 생성', async () => {
  const { contract } = await makePending();

  const res = await request(app)
    .patch(`/api/contracts/${contract.id}/approve`)
    .set('Authorization', `Bearer ${hostToken}`)
    .send({});

  expect(res.status).toBe(200);
  expect(res.body.data.status).toBe('APPROVED');
  expect(res.body.data.contractId).toBe(contract.id);
  expect(res.body.data.approvedAt).toBeTruthy();

  // DB 상태 확인
  const updated = await Contract.findByPk(contract.id);
  expect(updated.status).toBe('APPROVED');
  expect(updated.approvedAt).not.toBeNull();

  // ChatRoom 생성 확인
  const chatRoom = await ChatRoom.findOne({ where: { contractId: contract.id } });
  expect(chatRoom).not.toBeNull();
  expect(chatRoom.hostId).toBe(host.id);
  expect(chatRoom.guestId).toBe(guest.id);
});

// ─── TC-02-02: 게스트가 승인 시도 → 403 ────────────────────────────

test('TC-02-02: 게스트가 승인을 시도하면 403', async () => {
  const { contract } = await makePending();

  const res = await request(app)
    .patch(`/api/contracts/${contract.id}/approve`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send({});

  expect(res.status).toBe(403);
});

// ─── TC-02-03: 다른 호스트가 승인 시도 → 403 ────────────────────────

test('TC-02-03: 다른 호스트가 승인을 시도하면 403', async () => {
  const { contract } = await makePending();

  const res = await request(app)
    .patch(`/api/contracts/${contract.id}/approve`)
    .set('Authorization', `Bearer ${otherHostToken}`)
    .send({});

  expect(res.status).toBe(403);

  // 상태 변경 없음 확인
  const unchanged = await Contract.findByPk(contract.id);
  expect(unchanged.status).toBe('PENDING_APPROVAL');
});

// ─── TC-02-04: PENDING_APPROVAL 아닌 계약 승인 시도 → 400 ───────────

test('TC-02-04: 이미 승인된 계약을 다시 승인하면 400, code 4401', async () => {
  const { contract } = await makePending();

  // 먼저 한 번 승인
  await request(app)
    .patch(`/api/contracts/${contract.id}/approve`)
    .set('Authorization', `Bearer ${hostToken}`)
    .send({});

  // 다시 승인 시도
  const res = await request(app)
    .patch(`/api/contracts/${contract.id}/approve`)
    .set('Authorization', `Bearer ${hostToken}`)
    .send({});

  expect(res.status).toBe(400);
  expect(res.body.code).toBe(4401);
});

// ─── TC-02-05: 호스트가 PENDING_APPROVAL 계약 거절 ──────────────────

test('TC-02-05: 호스트가 PENDING_APPROVAL 계약을 거절하면 200, status=REJECTED', async () => {
  const { contract } = await makePending();

  const res = await request(app)
    .patch(`/api/contracts/${contract.id}/reject`)
    .set('Authorization', `Bearer ${hostToken}`)
    .send({ hostMessage: '일정이 맞지 않아 거절합니다.' });

  expect(res.status).toBe(200);
  expect(res.body.data.status).toBe('REJECTED');
  expect(res.body.data.cancellationReason).toBe('일정이 맞지 않아 거절합니다.');
  expect(res.body.data.rejectedAt).toBeTruthy();

  // DB 상태 확인
  const updated = await Contract.findByPk(contract.id);
  expect(updated.status).toBe('REJECTED');
  expect(updated.cancellationReason).toBe('일정이 맞지 않아 거절합니다.');
});

// ─── TC-02-06: 거절 사유 없이 거절 시도 → 400 ──────────────────────

test('TC-02-06: 거절 사유(hostMessage) 없이 거절하면 400, code 4402', async () => {
  const { contract } = await makePending();

  const res = await request(app)
    .patch(`/api/contracts/${contract.id}/reject`)
    .set('Authorization', `Bearer ${hostToken}`)
    .send({});

  expect(res.status).toBe(400);
  expect(res.body.code).toBe(4402);

  // 상태 변경 없음 확인
  const unchanged = await Contract.findByPk(contract.id);
  expect(unchanged.status).toBe('PENDING_APPROVAL');
});
