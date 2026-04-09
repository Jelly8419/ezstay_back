/**
 * 09.scheduler.test.js
 * TC-09-01 ~ TC-09-08: 스케줄러 자동화 테스트
 *
 * 스케줄러 함수를 직접 import하여 호출 후 DB 상태를 검증하는 방식
 * (실제 cron 타이머는 구동하지 않음)
 */

'use strict';

require('../../setup/setup');

const { Contract, Settlement, DepositAgreement, ChatRoom } = require('../../../models');
const { createHost, cleanupUsers }  = require('../../setup/factories/userFactory');
const { createRoom, cleanupRooms }  = require('../../setup/factories/roomFactory');
const {
  createPendingContract,
  createApprovedContract,
  createPaidContract,
  createInProgressContract,
  createCompletedContract,
  cleanupContract,
  daysLater,
} = require('../../setup/factories/contractFactory');

const {
  updateApprovalExpired,
  updatePaymentExpired,
  updateInProgress,
  updateCompleted,
  autoRequestCheckout,
  autoConfirmCheckout,
  autoReturnDepositOnDeadline,
} = require('../../../schedulers/contractScheduler');

// ─── 공통 데이터 ─────────────────────────────────────────────────────

let host, room;
let createdContractIds = [];
let createdUserIds     = [];
let createdRoomIds     = [];

beforeAll(async () => {
  const h = await createHost();
  host = h.user;
  const r = await createRoom(host.id);
  room = r.room;
  createdUserIds.push(host.id);
  createdRoomIds.push(room.id);
});

afterAll(async () => {
  for (const id of createdContractIds) {
    await cleanupContract(id).catch(() => {});
  }
  await cleanupRooms(createdRoomIds).catch(() => {});
  await cleanupUsers(createdUserIds).catch(() => {});
});

// ─── TC-09-01: 승인 만료 (72h 초과) ─────────────────────────────────

test('TC-09-01: PENDING_APPROVAL + createdAt 73h 초과 → APPROVAL_EXPIRED', async () => {
  const { contract } = await createPendingContract({ host, room });
  createdContractIds.push(contract.id);

  // createdAt을 73시간 전으로 강제 설정
  const pastDate = new Date(Date.now() - 73 * 60 * 60 * 1000);
  await Contract.update(
    { createdAt: pastDate },
    { where: { id: contract.id } }
  );

  await updateApprovalExpired();

  const updated = await Contract.findByPk(contract.id);
  expect(updated.status).toBe('APPROVAL_EXPIRED');
});

// ─── TC-09-02: 결제 만료 (24h 초과) ─────────────────────────────────

test('TC-09-02: APPROVED + approvedAt 25h 초과 → PAYMENT_EXPIRED', async () => {
  const { contract } = await createApprovedContract({ host, room });
  createdContractIds.push(contract.id);

  // approvedAt을 25시간 전으로 설정
  const pastDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
  await Contract.update(
    { approvedAt: pastDate },
    { where: { id: contract.id } }
  );

  await updatePaymentExpired();

  const updated = await Contract.findByPk(contract.id);
  expect(updated.status).toBe('PAYMENT_EXPIRED');
});

// ─── TC-09-03: 입실 시간 도래 → IN_PROGRESS + Settlement 생성 ────────

test('TC-09-03: PAYMENT_COMPLETED + checkInDate 과거 → IN_PROGRESS, Settlement 생성', async () => {
  const { contract } = await createPaidContract({ host, room });
  createdContractIds.push(contract.id);

  // checkInDate를 어제로 설정 → 입실 시간 도래
  await contract.update({
    status:      'PAYMENT_COMPLETED',
    checkInDate: daysLater(-1),
    checkOutDate: daysLater(10),
  });

  // 기존 Settlement 삭제 (재생성 검증을 위해)
  await Settlement.destroy({ where: { contractId: contract.id } });

  await updateInProgress();

  const updated = await Contract.findByPk(contract.id);
  expect(updated.status).toBe('IN_PROGRESS');
  expect(updated.checkedInAt).not.toBeNull();

  const settlement = await Settlement.findOne({ where: { contractId: contract.id } });
  expect(settlement).not.toBeNull();
  expect(settlement.status).toBe('PENDING');
});

// ─── TC-09-04: 퇴실 시간 도래 → COMPLETED ────────────────────────────

test('TC-09-04: IN_PROGRESS + checkOutDate 과거 → COMPLETED', async () => {
  const { contract } = await createInProgressContract({ host, room });
  createdContractIds.push(contract.id);

  // checkOutDate를 어제로 설정
  await Contract.update(
    {
      checkInDate:  daysLater(-10),
      checkOutDate: daysLater(-1),
    },
    { where: { id: contract.id } }
  );

  await updateCompleted();

  const updated = await Contract.findByPk(contract.id);
  expect(updated.status).toBe('COMPLETED');
  expect(updated.checkedOutAt).not.toBeNull();
});

// ─── TC-09-05: 퇴실 자동 요청 (퇴실시간+48h) ──────────────────────────

test('TC-09-05: COMPLETED + checkedOutAt 49h 전 + NOT_STARTED → GUEST_COMPLETED 자동 전환', async () => {
  const { contract } = await createCompletedContract({ host, room });
  createdContractIds.push(contract.id);

  // checkedOutAt을 49시간 전으로 설정 → 48h 경과
  const pastDate = new Date(Date.now() - 49 * 60 * 60 * 1000);
  await Contract.update(
    {
      checkedOutAt:    pastDate,
      checkoutStatus:  'NOT_STARTED',
      checkoutRequested: false,
    },
    { where: { id: contract.id } }
  );

  // ChatRoom 보장
  const existing = await ChatRoom.findOne({ where: { contractId: contract.id } });
  if (!existing) {
    await ChatRoom.create({
      contractId: contract.id,
      hostId:  contract.hostId,
      guestId: contract.guestId,
      roomId:  contract.roomId,
      firebaseChatRoomId: `test_chat_09_05_${contract.id}`,
      isReadOnly: false,
    });
  }

  await autoRequestCheckout();

  const updated = await Contract.findByPk(contract.id);
  expect(updated.checkoutStatus).toBe('GUEST_COMPLETED');
  expect(updated.checkoutRequested).toBe(true);
});

// ─── TC-09-06: 퇴실 자동 확인 (요청+48h) ─────────────────────────────

test('TC-09-06: GUEST_COMPLETED + checkoutRequestedAt 49h 전 → HOST_CONFIRMED, 보증금 환불', async () => {
  const { contract } = await createCompletedContract({ host, room });
  createdContractIds.push(contract.id);

  // checkoutRequestedAt을 49시간 전으로 설정
  const pastDate = new Date(Date.now() - 49 * 60 * 60 * 1000);
  await Contract.update(
    {
      checkedOutAt:        pastDate,
      checkoutRequested:   true,
      checkoutRequestedAt: pastDate,
      checkoutStatus:      'GUEST_COMPLETED',
    },
    { where: { id: contract.id } }
  );

  // ChatRoom 보장
  const existing = await ChatRoom.findOne({ where: { contractId: contract.id } });
  if (!existing) {
    await ChatRoom.create({
      contractId: contract.id,
      hostId:  contract.hostId,
      guestId: contract.guestId,
      roomId:  contract.roomId,
      firebaseChatRoomId: `test_chat_09_06_${contract.id}`,
      isReadOnly: false,
    });
  }

  await autoConfirmCheckout();

  const updated = await Contract.findByPk(contract.id);
  expect(updated.checkoutStatus).toBe('HOST_CONFIRMED');
  // 자동 확인 시 보증금 전액 반환 시도 (PG mock 환경)
  expect(['RETURNED', 'REFUND_FAILED', 'RETURN_PENDING']).toContain(updated.depositStatus);
});

// ─── TC-09-07: 합의 10일 초과 자동 전액 반환 ────────────────────────

test('TC-09-07: HOST_PENDING + holdApprovedAt 11일 전 → depositStatus 반환 처리', async () => {
  const { contract } = await createCompletedContract({ host, room });
  createdContractIds.push(contract.id);

  // holdApprovedAt을 11일 전으로 설정
  const pastDate = new Date(Date.now() - 11 * 24 * 60 * 60 * 1000);
  await Contract.update(
    {
      checkoutStatus:    'HOST_PENDING',
      checkoutRequested: true,
      checkoutRequestedAt: pastDate,
      holdApprovedAt:    pastDate,
      depositStatus:     'RETURN_HOLD',
    },
    { where: { id: contract.id } }
  );

  // DepositAgreement 생성 (APPROVED 상태)
  await DepositAgreement.create({
    contractId:      contract.id,
    status:          'APPROVED',
    holdReason:      '자동반환 테스트',
    requestedAt:     pastDate,
    adminApprovedAt: pastDate,
  });

  // ChatRoom 보장
  const existing = await ChatRoom.findOne({ where: { contractId: contract.id } });
  if (!existing) {
    await ChatRoom.create({
      contractId: contract.id,
      hostId:  contract.hostId,
      guestId: contract.guestId,
      roomId:  contract.roomId,
      firebaseChatRoomId: `test_chat_09_07_${contract.id}`,
      isReadOnly: false,
    });
  }

  await autoReturnDepositOnDeadline();

  const updated = await Contract.findByPk(contract.id);
  // 10일 초과 시 자동 전액 반환 처리 (RETURN_PENDING 또는 PG 즉시 시도)
  expect([
    'RETURN_PENDING', 'RETURNED', 'REFUND_FAILED', 'RETURN_CONFIRMED'
  ]).toContain(updated.depositStatus);

  const da = await DepositAgreement.findOne({
    where: { contractId: contract.id },
    order: [['createdAt', 'DESC']],
  });
  expect(da.status).toBe('AUTO_RETURNED');
});

// ─── TC-09-08: 스케줄러 중복 실행 방지 ──────────────────────────────

test('TC-09-08: 동일 계약 대상 스케줄러 2회 실행 → 중복 처리 안 됨', async () => {
  const { contract } = await createPendingContract({ host, room });
  createdContractIds.push(contract.id);

  // 72시간 초과 상태로 설정
  const pastDate = new Date(Date.now() - 73 * 60 * 60 * 1000);
  await Contract.update(
    { createdAt: pastDate },
    { where: { id: contract.id } }
  );

  // 1회 실행 → APPROVAL_EXPIRED
  await updateApprovalExpired();
  const after1st = await Contract.findByPk(contract.id);
  expect(after1st.status).toBe('APPROVAL_EXPIRED');

  // 2회 실행 → APPROVAL_EXPIRED 유지 (PENDING_APPROVAL이 아니므로 재처리 안 됨)
  await updateApprovalExpired();
  const after2nd = await Contract.findByPk(contract.id);
  expect(after2nd.status).toBe('APPROVAL_EXPIRED');
  // updatedAt이 1회 때와 동일 (혹은 거의 같음 — DB는 초 단위 비교)
  // 핵심: 상태가 APPROVAL_EXPIRED에서 다른 상태로 변경되지 않았음
  expect(after2nd.status).not.toBe('PENDING_APPROVAL');
});
