/**
 * 11.chatMessages.test.js
 * TC-11-01 ~ TC-11-13: 채팅 시스템메시지 전체 테스트
 *
 * 각 도메인 이벤트 발생 시 firebaseAdmin.sendSystemMessage가 올바른 타입으로 호출되는지 검증
 *
 * 시스템 메시지 타입은 소문자 snake_case (systemMessageTypes.js 기준)
 */

'use strict';

require('../../setup/setup');

const request       = require('supertest');
const app           = require('../../setup/testApp');
const jwt           = require('jsonwebtoken');
const { Admin, ChatRoom, Contract } = require('../../../models');
const { createHost, createGuest, cleanupUsers } = require('../../setup/factories/userFactory');
const { createRoom, cleanupRooms }              = require('../../setup/factories/roomFactory');
const {
  createPendingContract,
  createApprovedContract,
  createPaidContract,
  createInProgressContract,
  createCompletedContract,
  cleanupContract,
  daysLater,
} = require('../../setup/factories/contractFactory');

const firebaseAdmin = require('../../../config/firebaseAdmin');
const {
  updatePaymentExpired,
  autoRequestCheckout,
  autoReturnDepositOnDeadline,
} = require('../../../schedulers/contractScheduler');

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
    username: `admin_chat_${Date.now()}`,
    password: 'hashed_password',
    name:     '채팅테스트관리자',
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

/** 채팅방 보장 헬퍼 */
async function ensureChatRoom(contract, suffix = '') {
  const existing = await ChatRoom.findOne({ where: { contractId: contract.id } });
  if (!existing) {
    await ChatRoom.create({
      contractId: contract.id,
      hostId:  contract.hostId,
      guestId: contract.guestId,
      roomId:  contract.roomId,
      firebaseChatRoomId: `test_chat_11_${contract.id}${suffix}`,
      isReadOnly: false,
    });
  }
  return existing;
}

/** sendSystemMessage 호출 타입 목록 추출
 *
 * sendSystemMessage(chatRoomId, text, systemMessageType, metadata)
 * 대부분의 호출: call[2] = systemMessageType (문자열)
 * payment_completed 호출: call[1] = systemMessageType, call[2] = { amount, paymentMethod }
 * → 각 call에서 문자열인 인자를 모두 수집
 */
function calledTypes() {
  const types = [];
  for (const call of firebaseAdmin.sendSystemMessage.mock.calls) {
    for (let i = 1; i < call.length; i++) {
      if (typeof call[i] === 'string') types.push(call[i]);
    }
  }
  return types;
}

// ─── TC-11-01: 계약 승인 → contract_approved ─────────────────────────

test('TC-11-01: 호스트 계약 승인 → sendSystemMessage(contract_approved)', async () => {
  const { contract } = await createPendingContract({ host, room, guest });
  createdContractIds.push(contract.id);

  await request(app)
    .patch(`/api/contracts/${contract.id}/approve`)
    .set('Authorization', `Bearer ${hostToken}`);

  expect(calledTypes()).toContain('contract_approved');
});

// ─── TC-11-02: 결제 완료 → payment_completed ─────────────────────────

test('TC-11-02: 결제 완료 → sendSystemMessage(payment_completed)', async () => {
  const { contract } = await createApprovedContract({ host, room, guest });
  createdContractIds.push(contract.id);

  const paytagClient = require('../../../utils/paytagClient');
  paytagClient.confirmPayment.mockResolvedValueOnce({
    resultcode: '0000',
    recv_orderno: `TEST_PG_11_02_${contract.id}`,
    trandate: '20260410',
    amt: String(contract.finalTotalAmount),
    tran_key: `tran_11_02_${contract.id}_${Date.now()}`,
    loginid: 'test_login',
  });

  await request(app)
    .post(`/api/contracts/${contract.id}/confirm-payment`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send({
      recvPayparam: 'test_recv_payparam',
      payType: 'CARD',
      orderId: contract.orderId,
      amount: contract.finalTotalAmount,
    });

  expect(calledTypes()).toContain('payment_completed');
});

// ─── TC-11-03: 결제 만료 → payment_expired ───────────────────────────

test('TC-11-03: 스케줄러 결제 만료 → sendSystemMessage(payment_expired)', async () => {
  const { contract } = await createApprovedContract({ host, room, guest });
  createdContractIds.push(contract.id);
  await ensureChatRoom(contract, '_03');

  // approvedAt을 25시간 전으로 설정
  await Contract.update(
    { approvedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    { where: { id: contract.id } }
  );

  await updatePaymentExpired();

  expect(calledTypes()).toContain('payment_expired');
});

// ─── TC-11-04: 환불 자동 승인 (입주 전) → refund_approved ─────────────

test('TC-11-04: 입주 전 환불 요청 자동 승인 → sendSystemMessage(refund_approved)', async () => {
  const { contract } = await createPaidContract({ host, room, guest });
  createdContractIds.push(contract.id);
  await ensureChatRoom(contract, '_04');

  await request(app)
    .post(`/api/contracts/${contract.id}/request-refund`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send({ reason: '개인 사정으로 취소합니다.' });

  expect(calledTypes()).toContain('refund_approved');
});

// ─── TC-11-05: 환불 관리자 대기 (입주 후) → refund_requested ──────────

test('TC-11-05: 입주 후 취소 요청 (관리자 대기) → sendSystemMessage(cancel_request_submitted 또는 refund_requested)', async () => {
  const { contract } = await createInProgressContract({ host, room, guest });
  createdContractIds.push(contract.id);
  await ensureChatRoom(contract, '_05');

  await request(app)
    .post(`/api/contracts/${contract.id}/cancel-request`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send({ reason: '개인 사정으로 취소 요청합니다.' });

  // IN_PROGRESS에서 게스트 취소 요청은 cancel_request_by_guest 또는 cancel_request_submitted
  const types = calledTypes();
  const hasRelatedType = types.some(t =>
    ['refund_requested', 'cancel_request_submitted', 'cancel_request_by_guest'].includes(t)
  );
  expect(hasRelatedType).toBe(true);
});

// ─── TC-11-06: 호스트 귀책 취소 → contract_canceled_by_host ──────────

test('TC-11-06: 호스트 귀책 취소 승인 → sendSystemMessage(contract_canceled_by_host)', async () => {
  const { contract } = await createInProgressContract({ host, room, guest });
  createdContractIds.push(contract.id);
  await ensureChatRoom(contract, '_06');

  // 호스트 취소 요청
  await request(app)
    .post(`/api/contracts/${contract.id}/cancel-request`)
    .set('Authorization', `Bearer ${hostToken}`)
    .send({ reason: '호스트 사정으로 취소합니다.' });

  jest.clearAllMocks();

  // 관리자 승인
  await request(app)
    .post(`/api/admin/reservations/${contract.id}/approve-cancel-request`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ withRefund: true, adminNote: '승인' });

  // 관리자 취소 승인 시: contract_canceled_by_host 또는 host_cancel_request_approved
  const types = calledTypes();
  const hasType = types.includes('contract_canceled_by_host') ||
                  types.includes('host_cancel_request_approved');
  expect(hasType).toBe(true);
});

// ─── TC-11-07: 자동 퇴실 요청 (스케줄러 +48h) → checkout_auto_requested

test('TC-11-07: autoRequestCheckout 스케줄러 → sendSystemMessage(checkout_auto_requested)', async () => {
  const { contract } = await createCompletedContract({ host, room, guest });
  createdContractIds.push(contract.id);
  await ensureChatRoom(contract, '_07');

  // checkedOutAt 49시간 전
  const pastDate = new Date(Date.now() - 49 * 60 * 60 * 1000);
  await Contract.update(
    {
      checkedOutAt:      pastDate,
      checkoutStatus:    'NOT_STARTED',
      checkoutRequested: false,
    },
    { where: { id: contract.id } }
  );

  await autoRequestCheckout();

  expect(calledTypes()).toContain('checkout_auto_requested');
});

// ─── TC-11-08: 보류 신청 → deposit_hold_requested ────────────────────

test('TC-11-08: holdCheckout → sendSystemMessage(deposit_hold_requested)', async () => {
  const { contract } = await createCompletedContract({ host, room, guest });
  createdContractIds.push(contract.id);
  await ensureChatRoom(contract, '_08');

  await contract.update({
    checkoutStatus:      'GUEST_COMPLETED',
    checkoutRequested:   true,
    checkoutRequestedAt: new Date(),
    checkedOutAt:        new Date(),
  });

  await request(app)
    .patch(`/api/contracts/${contract.id}/checkout-hold`)
    .set('Authorization', `Bearer ${hostToken}`)
    .send({ reason: '시스템메시지 테스트 보류' });

  expect(calledTypes()).toContain('deposit_hold_requested');
});

// ─── TC-11-09: 보류 승인 → deposit_hold_approved ─────────────────────

test('TC-11-09: 관리자 보류 승인 → sendSystemMessage(deposit_hold_approved)', async () => {
  const { contract } = await createCompletedContract({ host, room, guest });
  createdContractIds.push(contract.id);
  await ensureChatRoom(contract, '_09');

  await contract.update({
    checkoutStatus:      'GUEST_COMPLETED',
    checkoutRequested:   true,
    checkoutRequestedAt: new Date(),
    checkedOutAt:        new Date(),
  });

  await request(app)
    .patch(`/api/contracts/${contract.id}/checkout-hold`)
    .set('Authorization', `Bearer ${hostToken}`)
    .send({ reason: '보류 승인 테스트' });

  jest.clearAllMocks();

  await request(app)
    .post(`/api/admin/deposits/${contract.id}/approve-hold`)
    .set('Authorization', `Bearer ${adminToken}`);

  expect(calledTypes()).toContain('deposit_hold_approved');
});

// ─── TC-11-10: 보류 거절 → deposit_hold_rejected ─────────────────────

test('TC-11-10: 관리자 보류 거절 → sendSystemMessage(deposit_hold_rejected)', async () => {
  const { contract } = await createCompletedContract({ host, room, guest });
  createdContractIds.push(contract.id);
  await ensureChatRoom(contract, '_10');

  await contract.update({
    checkoutStatus:      'GUEST_COMPLETED',
    checkoutRequested:   true,
    checkoutRequestedAt: new Date(),
    checkedOutAt:        new Date(),
  });

  await request(app)
    .patch(`/api/contracts/${contract.id}/checkout-hold`)
    .set('Authorization', `Bearer ${hostToken}`)
    .send({ reason: '보류 거절 테스트' });

  jest.clearAllMocks();

  await request(app)
    .post(`/api/admin/deposits/${contract.id}/reject-hold`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ reason: '증거 불충분' });

  expect(calledTypes()).toContain('deposit_hold_rejected');
});

// ─── TC-11-11: 합의 제출 → deposit_agreement_submitted ───────────────

test('TC-11-11: submitDepositAgreement → sendSystemMessage(deposit_agreement_submitted)', async () => {
  const { contract } = await createCompletedContract({ host, room, guest });
  createdContractIds.push(contract.id);
  await ensureChatRoom(contract, '_11');

  await contract.update({
    checkoutStatus:      'GUEST_COMPLETED',
    checkoutRequested:   true,
    checkoutRequestedAt: new Date(),
    checkedOutAt:        new Date(),
  });

  await request(app)
    .patch(`/api/contracts/${contract.id}/checkout-hold`)
    .set('Authorization', `Bearer ${hostToken}`)
    .send({ reason: '합의 제출 테스트' });

  await request(app)
    .post(`/api/admin/deposits/${contract.id}/approve-hold`)
    .set('Authorization', `Bearer ${adminToken}`);

  jest.clearAllMocks();

  await request(app)
    .post(`/api/contracts/${contract.id}/deposit-agreement`)
    .set('Authorization', `Bearer ${hostToken}`)
    .send({ deductAmount: 50000, agreementText: '합의 내용 제출 테스트' });

  expect(calledTypes()).toContain('deposit_agreement_submitted');
});

// ─── TC-11-12: 합의 동의 → deposit_deduction_confirmed 또는 deposit_return_confirmed

test('TC-11-12: acceptDepositAgreement → deposit_deduction_confirmed 또는 deposit_return_confirmed', async () => {
  const { contract } = await createCompletedContract({ host, room, guest });
  createdContractIds.push(contract.id);
  await ensureChatRoom(contract, '_12');

  await contract.update({
    checkoutStatus:      'GUEST_COMPLETED',
    checkoutRequested:   true,
    checkoutRequestedAt: new Date(),
    checkedOutAt:        new Date(),
  });

  await request(app)
    .patch(`/api/contracts/${contract.id}/checkout-hold`)
    .set('Authorization', `Bearer ${hostToken}`)
    .send({ reason: '합의 동의 테스트' });

  await request(app)
    .post(`/api/admin/deposits/${contract.id}/approve-hold`)
    .set('Authorization', `Bearer ${adminToken}`);

  await request(app)
    .post(`/api/contracts/${contract.id}/deposit-agreement`)
    .set('Authorization', `Bearer ${hostToken}`)
    .send({ deductAmount: 50000, agreementText: '합의 동의 테스트 내용' });

  jest.clearAllMocks();

  await request(app)
    .post(`/api/contracts/${contract.id}/deposit-agreement/accept`)
    .set('Authorization', `Bearer ${guestToken}`);

  const types = calledTypes();
  const hasConfirmType = types.some(t =>
    ['deposit_deduction_confirmed', 'deposit_return_confirmed', 'deposit_agreement_accepted'].includes(t)
  );
  expect(hasConfirmType).toBe(true);
});

// ─── TC-11-13: 10일 초과 자동 반환 → deposit_auto_returned ────────────

test('TC-11-13: autoReturnDepositOnDeadline → sendSystemMessage(deposit_auto_returned)', async () => {
  const { DepositAgreement } = require('../../../models');

  const { contract } = await createCompletedContract({ host, room, guest });
  createdContractIds.push(contract.id);
  await ensureChatRoom(contract, '_13');

  const pastDate = new Date(Date.now() - 11 * 24 * 60 * 60 * 1000);
  await Contract.update(
    {
      checkoutStatus:      'HOST_PENDING',
      checkoutRequested:   true,
      checkoutRequestedAt: pastDate,
      holdApprovedAt:      pastDate,
      depositStatus:       'RETURN_HOLD',
    },
    { where: { id: contract.id } }
  );

  await DepositAgreement.create({
    contractId:      contract.id,
    status:          'APPROVED',
    holdReason:      '자동반환 시스템메시지 테스트',
    requestedAt:     pastDate,
    adminApprovedAt: pastDate,
  });

  await autoReturnDepositOnDeadline();

  expect(calledTypes()).toContain('deposit_auto_returned');
});
