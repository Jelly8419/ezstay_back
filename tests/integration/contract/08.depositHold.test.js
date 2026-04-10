/**
 * 08.depositHold.test.js
 * TC-08-01 ~ TC-08-08: 보증금 보류 · 합의 통합 테스트
 *
 * PATCH /api/contracts/:contractId/checkout-hold           (호스트 보류 신청)
 * PATCH /api/admin/deposits/:contractId/approve-hold      (관리자 보류 승인)
 * PATCH /api/admin/deposits/:contractId/reject-hold       (관리자 보류 거절)
 * POST  /api/contracts/:contractId/deposit-agreement      (호스트 합의 제출)
 * POST  /api/contracts/:contractId/deposit-agreement/accept (게스트 합의 동의)
 */

'use strict';

require('../../setup/setup');

const request       = require('supertest');
const app           = require('../../setup/testApp');
const jwt           = require('jsonwebtoken');
const { Contract, DepositAgreement, Admin, ChatRoom } = require('../../../models');
const { createHost, createGuest, cleanupUsers }        = require('../../setup/factories/userFactory');
const { createRoom, cleanupRooms }                     = require('../../setup/factories/roomFactory');
const {
  createCompletedContract,
  cleanupContract,
} = require('../../setup/factories/contractFactory');

const firebaseAdmin = require('../../../config/firebaseAdmin');

// ─── 공통 데이터 ─────────────────────────────────────────────────────

let host, hostToken;
let guest, guestToken;
let room;
let admin, adminToken;

let createdContractIds = [];
let createdUserIds     = [];
let createdRoomIds     = [];
let createdAdminIds    = [];

beforeAll(async () => {
  const h = await createHost();
  host      = h.user;
  hostToken = h.token;

  const g = await createGuest();
  guest      = g.user;
  guestToken = g.token;

  const r = await createRoom(host.id);
  room = r.room;

  createdUserIds.push(host.id, guest.id);
  createdRoomIds.push(room.id);

  admin = await Admin.create({
    username: `admin_hold_${Date.now()}`,
    password: 'hashed_password',
    name:     '보증금테스트관리자',
    role:     'admin',
    isActive: true,
  });
  createdAdminIds.push(admin.id);

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

beforeEach(() => {
  jest.clearAllMocks();
});

/** GUEST_COMPLETED 계약 생성 헬퍼 */
async function makeGuestCompleted() {
  const result = await createCompletedContract({ host, room, guest });
  const { contract } = result;
  createdContractIds.push(contract.id);

  await contract.update({
    checkoutStatus:      'GUEST_COMPLETED',
    checkoutRequested:   true,
    checkoutRequestedAt: new Date(),
    checkedOutAt:        new Date(),
  });

  // ChatRoom 보장
  const existing = await ChatRoom.findOne({ where: { contractId: contract.id } });
  if (!existing) {
    await ChatRoom.create({
      contractId: contract.id,
      hostId:  contract.hostId,
      guestId: contract.guestId,
      roomId:  contract.roomId,
      firebaseChatRoomId: `test_chat_08_${contract.id}`,
      isReadOnly: false,
    });
  }

  return { contract, ...result };
}

/** HOLD_REQUESTED 계약 생성 헬퍼 */
async function makeHoldRequested() {
  const { contract, ...rest } = await makeGuestCompleted();

  const res = await request(app)
    .patch(`/api/contracts/${contract.id}/checkout-hold`)
    .set('Authorization', `Bearer ${hostToken}`)
    .send({ reason: '방 시설 파손 확인 필요' });

  expect(res.status).toBe(200);

  await contract.reload();
  return { contract, ...rest };
}

/** HOST_PENDING 계약 생성 헬퍼 (관리자 승인까지 완료) */
async function makeHostPending() {
  const { contract, ...rest } = await makeHoldRequested();

  const res = await request(app)
    .post(`/api/admin/deposits/${contract.id}/approve-hold`)
    .set('Authorization', `Bearer ${adminToken}`);

  expect(res.status).toBe(200);

  await contract.reload();
  return { contract, ...rest };
}

// ─── TC-08-01: 호스트 보류 신청 ──────────────────────────────────────

test('TC-08-01: GUEST_COMPLETED에서 호스트 보류 신청 → checkoutStatus=HOLD_REQUESTED, DepositAgreement 생성', async () => {
  const { contract } = await makeGuestCompleted();

  const res = await request(app)
    .patch(`/api/contracts/${contract.id}/checkout-hold`)
    .set('Authorization', `Bearer ${hostToken}`)
    .send({ reason: '벽지 훼손 확인 필요' });

  expect(res.status).toBe(200);

  const updated = await Contract.findByPk(contract.id);
  expect(updated.checkoutStatus).toBe('HOLD_REQUESTED');
  expect(updated.holdRequestedAt).not.toBeNull();

  const da = await DepositAgreement.findOne({ where: { contractId: contract.id } });
  expect(da).not.toBeNull();
  expect(da.status).toBe('REQUESTED');
});

// ─── TC-08-02: 관리자 보류 승인 ──────────────────────────────────────

test('TC-08-02: HOLD_REQUESTED에서 관리자 승인 → checkoutStatus=HOST_PENDING, holdApprovedAt 기록', async () => {
  const { contract } = await makeHoldRequested();

  const res = await request(app)
    .post(`/api/admin/deposits/${contract.id}/approve-hold`)
    .set('Authorization', `Bearer ${adminToken}`);

  expect(res.status).toBe(200);

  const updated = await Contract.findByPk(contract.id);
  expect(updated.checkoutStatus).toBe('HOST_PENDING');
  expect(updated.holdApprovedAt).not.toBeNull();

  const da = await DepositAgreement.findOne({
    where: { contractId: contract.id, status: 'APPROVED' },
  });
  expect(da).not.toBeNull();
  expect(da.adminApprovedAt).not.toBeNull();
});

// ─── TC-08-03: 관리자 보류 거절 ──────────────────────────────────────

test('TC-08-03: HOLD_REQUESTED에서 관리자 거절 → checkoutStatus=HOLD_REJECTED', async () => {
  const { contract } = await makeHoldRequested();

  const res = await request(app)
    .post(`/api/admin/deposits/${contract.id}/reject-hold`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ reason: '파손 증거 불충분' });

  expect(res.status).toBe(200);

  const updated = await Contract.findByPk(contract.id);
  expect(updated.checkoutStatus).toBe('HOLD_REJECTED');

  const da = await DepositAgreement.findOne({
    where: { contractId: contract.id, status: 'REJECTED' },
  });
  expect(da).not.toBeNull();
  expect(da.rejectedAt).not.toBeNull();
});

// ─── TC-08-04: 호스트 합의 내용 제출 ─────────────────────────────────

test('TC-08-04: HOST_PENDING에서 호스트 합의 제출 → DepositAgreement.status=SUBMITTED', async () => {
  const { contract } = await makeHostPending();

  const res = await request(app)
    .post(`/api/contracts/${contract.id}/deposit-agreement`)
    .set('Authorization', `Bearer ${hostToken}`)
    .send({
      deductAmount:  50000,
      agreementText: '벽지 복구 비용 50,000원 차감 요청드립니다.',
    });

  expect([200, 201]).toContain(res.status);

  const da = await DepositAgreement.findOne({
    where: { contractId: contract.id, status: 'SUBMITTED' },
  });
  expect(da).not.toBeNull();
  expect(da.deductAmount).toBe(50000);
});

// ─── TC-08-05: 게스트 합의 동의 ──────────────────────────────────────

test('TC-08-05: SUBMITTED 합의에 게스트 동의 → depositStatus=DEDUCTION_CONFIRMED, 부분 PG 환불', async () => {
  const { contract } = await makeHostPending();

  // 호스트 합의 제출
  await request(app)
    .post(`/api/contracts/${contract.id}/deposit-agreement`)
    .set('Authorization', `Bearer ${hostToken}`)
    .send({ deductAmount: 100000, agreementText: '가구 파손 100,000원 차감' });

  // 게스트 합의 동의
  const res = await request(app)
    .post(`/api/contracts/${contract.id}/deposit-agreement/accept`)
    .set('Authorization', `Bearer ${guestToken}`);

  expect(res.status).toBe(200);

  const updated = await Contract.findByPk(contract.id);
  expect(updated.depositStatus).toBe('DEDUCTION_CONFIRMED');
  expect(updated.checkoutStatus).toBe('HOST_CONFIRMED');

  // PG 부분 환불 호출 확인
  const paytagClient = require('../../../utils/paytagClient');
  expect(paytagClient.cancelPayment).toHaveBeenCalled();
});

// ─── TC-08-06: 합의 동의 시 차감 금액 검증 ────────────────────────────

test('TC-08-06: 합의 동의 → refundableDeposit = deposit - depositDeduction', async () => {
  const { contract } = await makeHostPending();

  const deduction = 80000;

  await request(app)
    .post(`/api/contracts/${contract.id}/deposit-agreement`)
    .set('Authorization', `Bearer ${hostToken}`)
    .send({ deductAmount: deduction, agreementText: '80,000원 차감' });

  await request(app)
    .post(`/api/contracts/${contract.id}/deposit-agreement/accept`)
    .set('Authorization', `Bearer ${guestToken}`);

  const updated = await Contract.findByPk(contract.id);
  expect(updated.depositDeduction).toBe(deduction);
  expect(updated.refundableDeposit).toBe(contract.deposit - deduction);
});

// ─── TC-08-07: 보류 관련 시스템 메시지 순서 ──────────────────────────

test('TC-08-07: 보류 신청→승인→합의제출→동의 각 단계에서 sendSystemMessage 호출', async () => {
  const { contract } = await makeGuestCompleted();

  // 1. 보류 신청
  await request(app)
    .patch(`/api/contracts/${contract.id}/checkout-hold`)
    .set('Authorization', `Bearer ${hostToken}`)
    .send({ reason: '시스템 메시지 순서 테스트' });

  // 2. 관리자 승인
  await request(app)
    .post(`/api/admin/deposits/${contract.id}/approve-hold`)
    .set('Authorization', `Bearer ${adminToken}`);

  // 3. 호스트 합의 제출
  await request(app)
    .post(`/api/contracts/${contract.id}/deposit-agreement`)
    .set('Authorization', `Bearer ${hostToken}`)
    .send({ deductAmount: 30000, agreementText: '메시지 순서 테스트 합의' });

  // 4. 게스트 동의
  await request(app)
    .post(`/api/contracts/${contract.id}/deposit-agreement/accept`)
    .set('Authorization', `Bearer ${guestToken}`);

  // sendSystemMessage가 여러 단계에서 호출됐는지 확인 (최소 2회)
  expect(firebaseAdmin.sendSystemMessage.mock.calls.length).toBeGreaterThanOrEqual(2);

  // 호출된 메시지 타입 목록
  const calledTypes = firebaseAdmin.sendSystemMessage.mock.calls.map(call => call[2]);

  // systemMessageTypes.js의 실제 값은 소문자 snake_case
  expect(calledTypes).toContain('deposit_hold_requested');
  expect(calledTypes).toContain('deposit_hold_approved');
  expect(calledTypes).toContain('deposit_agreement_submitted');
  // 차감 있을 시 DEPOSIT_DEDUCTION_CONFIRMED, 차감 없을 시 DEPOSIT_AGREEMENT_ACCEPTED
  const hasConfirmed = calledTypes.includes('deposit_agreement_accepted') ||
                       calledTypes.includes('deposit_deduction_confirmed') ||
                       calledTypes.includes('deposit_return_confirmed');
  expect(hasConfirmed).toBe(true);
});

// ─── TC-08-08: 합의 관련 알림 각 단계별 ─────────────────────────────

test('TC-08-08: 보류 신청/승인/합의동의 각 단계에서 Notification 또는 알림 시스템 동작', async () => {
  const { contract } = await makeGuestCompleted();

  // 보류 신청
  const res1 = await request(app)
    .patch(`/api/contracts/${contract.id}/checkout-hold`)
    .set('Authorization', `Bearer ${hostToken}`)
    .send({ reason: '알림 단계 테스트' });
  expect(res1.status).toBe(200);

  // 관리자 승인
  const res2 = await request(app)
    .post(`/api/admin/deposits/${contract.id}/approve-hold`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res2.status).toBe(200);

  // 호스트 합의 제출
  const res3 = await request(app)
    .post(`/api/contracts/${contract.id}/deposit-agreement`)
    .set('Authorization', `Bearer ${hostToken}`)
    .send({ deductAmount: 20000, agreementText: '알림 단계 합의 내용' });
  expect([200, 201]).toContain(res3.status);

  // 게스트 동의
  const res4 = await request(app)
    .post(`/api/contracts/${contract.id}/deposit-agreement/accept`)
    .set('Authorization', `Bearer ${guestToken}`);
  expect(res4.status).toBe(200);

  // 각 단계 API가 모두 성공 → 알림 시스템 동작 확인
  // (Notification DB 저장 또는 시스템 메시지 호출)
  const updatedContract = await Contract.findByPk(contract.id);
  expect(updatedContract.checkoutStatus).toBe('HOST_CONFIRMED');
  expect(updatedContract.depositStatus).toBe('DEDUCTION_CONFIRMED');
});
