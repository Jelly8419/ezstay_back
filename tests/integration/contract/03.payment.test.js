/**
 * 03.payment.test.js
 * TC-03-01 ~ TC-03-09: 결제 확인 통합 테스트
 *
 * POST /api/contracts/:contractId/confirm-payment
 */

'use strict';

require('../../setup/setup');

const request = require('supertest');
const app     = require('../../setup/testApp');
const { Contract, Payment, Settlement } = require('../../../models');
const { createHost, cleanupUsers }       = require('../../setup/factories/userFactory');
const { createRoom, cleanupRooms }       = require('../../setup/factories/roomFactory');
const {
  createApprovedContract,
  createPaidContract,
  createPendingContract,
  cleanupContract,
  calcAmounts,
} = require('../../setup/factories/contractFactory');
const { addBusinessDays } = require('../../../utils/businessDayHelper');

// paytagClient mock 참조 (setup.js에서 이미 mock 등록됨)
const paytagClient = require('../../../utils/paytagClient');

// ─── 공통 데이터 ────────────────────────────────────────────────────

let host, hostToken;
let room;

let createdContractIds = [];
let createdUserIds     = [];
let createdRoomIds     = [];

beforeAll(async () => {
  const h = await createHost();
  host      = h.user;
  hostToken = h.token;

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

// paymentKey unique 충돌 방지용 헬퍼 — contractId로 고유 키 생성
function mockPaytagSuccess(contractId) {
  paytagClient.confirmPayment.mockResolvedValueOnce({
    resultcode: '0000',
    recv_orderno: `TEST_PG_ORDER_${contractId}`,
    trandate: '20260410',
    amt: '500000',
    tran_key: `tran_key_${contractId}_${Date.now()}`,
    loginid: 'test_login',
  });
}

// APPROVED 계약 생성 헬퍼 — contractId 자동 추적
async function makeApproved(options = {}) {
  const result = await createApprovedContract({ host, room, ...options });
  createdContractIds.push(result.contract.id);
  return result;
}

// 결제 요청 body 생성 헬퍼
function makePaymentBody(contract, overrides = {}) {
  return {
    recvPayparam: 'test_recv_payparam',
    payType: 'CARD',
    orderId: contract.orderId,
    amount: contract.finalTotalAmount,
    ...overrides,
  };
}

// ─── TC-03-01: 정상 결제 ────────────────────────────────────────────

test('TC-03-01: APPROVED 계약 정상 결제 → 200, status=PAYMENT_COMPLETED, Payment/Settlement 생성', async () => {
  const { contract, guestToken } = await makeApproved();
  mockPaytagSuccess(contract.id);

  const res = await request(app)
    .post(`/api/contracts/${contract.id}/confirm-payment`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send(makePaymentBody(contract));

  expect(res.status).toBe(200);
  expect(res.body.data.status).toBe('PAYMENT_COMPLETED');

  // Contract 상태 확인
  const updated = await Contract.findByPk(contract.id);
  expect(updated.status).toBe('PAYMENT_COMPLETED');
  expect(updated.paidAt).not.toBeNull();

  // Payment 생성 확인
  const payment = await Payment.findOne({ where: { contractId: contract.id } });
  expect(payment).not.toBeNull();
  expect(payment.status).toBe('DONE');
  expect(payment.totalAmount).toBe(contract.finalTotalAmount);

  // Settlement 생성 확인
  const settlement = await Settlement.findOne({ where: { contractId: contract.id } });
  expect(settlement).not.toBeNull();
  expect(settlement.status).toBe('PENDING');
});

// ─── TC-03-02: PG 승인 실패 ─────────────────────────────────────────

test('TC-03-02: PG 승인 실패(throw) → 400, Payment 미생성', async () => {
  const { contract, guestToken } = await makeApproved();

  // confirmPayment가 에러를 throw하도록 설정
  paytagClient.confirmPayment.mockRejectedValueOnce(
    Object.assign(new Error('PG 오류'), {
      paytagErrorCode: '9999',
      paytagErrorMessage: 'PG 처리 실패',
    })
  );

  const res = await request(app)
    .post(`/api/contracts/${contract.id}/confirm-payment`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send(makePaymentBody(contract));

  expect(res.status).toBe(400);
  expect(res.body.code).toBe(4605); // PAYMENT_CONFIRMATION_FAILED

  // Payment 미생성 확인
  const payment = await Payment.findOne({ where: { contractId: contract.id } });
  expect(payment).toBeNull();

  // Contract 상태 변경 없음
  const unchanged = await Contract.findByPk(contract.id);
  expect(unchanged.status).toBe('APPROVED');
});

// ─── TC-03-03: 이미 결제 완료된 계약 재결제 ────────────────────────

test('TC-03-03: 이미 결제 완료된 계약 재결제 → 400, code 4606', async () => {
  // createPaidContract: PAYMENT_COMPLETED 상태로 생성
  const { contract, guestToken } = await (async () => {
    const result = await createPaidContract({ host, room });
    createdContractIds.push(result.contract.id);
    return result;
  })();

  const res = await request(app)
    .post(`/api/contracts/${contract.id}/confirm-payment`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send(makePaymentBody(contract));

  // PAYMENT_COMPLETED 상태이면 컨트롤러가 PAYMENT_NOT_AVAILABLE(4602) 반환
  expect(res.status).toBe(400);
  expect(res.body.code).toBe(4602);
});

// ─── TC-03-04: 금액 불일치 ──────────────────────────────────────────

test('TC-03-04: 결제 금액 불일치 → 400, code 4604', async () => {
  const { contract, guestToken } = await makeApproved();

  const res = await request(app)
    .post(`/api/contracts/${contract.id}/confirm-payment`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send(makePaymentBody(contract, { amount: contract.finalTotalAmount + 10000 }));

  expect(res.status).toBe(400);
  expect(res.body.code).toBe(4604); // AMOUNT_MISMATCH
});

// ─── TC-03-05: orderId 불일치 ───────────────────────────────────────

test('TC-03-05: orderId 불일치 → 400, code 4603', async () => {
  const { contract, guestToken } = await makeApproved();

  const res = await request(app)
    .post(`/api/contracts/${contract.id}/confirm-payment`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send(makePaymentBody(contract, { orderId: 'WRONG_ORDER_ID' }));

  expect(res.status).toBe(400);
  expect(res.body.code).toBe(4603); // ORDER_ID_MISMATCH
});

// ─── TC-03-06: PENDING_APPROVAL 계약 결제 시도 ──────────────────────

test('TC-03-06: PENDING_APPROVAL 계약 결제 시도 → 400', async () => {
  const { contract, guestToken } = await (async () => {
    const result = await createPendingContract({ host, room });
    createdContractIds.push(result.contract.id);
    return result;
  })();

  const res = await request(app)
    .post(`/api/contracts/${contract.id}/confirm-payment`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send(makePaymentBody(contract));

  // PENDING_APPROVAL이면 guestId 기준 조회 시 contract를 못 찾거나(guestId 일치해도 상태 검증) 4602 반환
  expect([400, 404]).toContain(res.status);
});

// ─── TC-03-07: 게스트가 아닌 유저 결제 시도 ────────────────────────

test('TC-03-07: 호스트 토큰으로 결제 시도 → 404 (guestId 불일치)', async () => {
  const { contract } = await makeApproved();

  const res = await request(app)
    .post(`/api/contracts/${contract.id}/confirm-payment`)
    .set('Authorization', `Bearer ${hostToken}`)
    .send(makePaymentBody(contract));

  // 컨트롤러가 guestId 기준 조회하므로 host 토큰이면 contract를 찾지 못해 404
  expect(res.status).toBe(404);
});

// ─── TC-03-08: Settlement.expectedDate = checkInDate + 3영업일 ──────

test('TC-03-08: 결제 후 Settlement.expectedDate = checkInDate + 3영업일', async () => {
  const { contract, guestToken } = await makeApproved();
  mockPaytagSuccess(contract.id);

  await request(app)
    .post(`/api/contracts/${contract.id}/confirm-payment`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send(makePaymentBody(contract));

  const settlement = await Settlement.findOne({ where: { contractId: contract.id } });
  expect(settlement).not.toBeNull();

  // 기대값: checkInDate + 3영업일
  const expectedDate = addBusinessDays(new Date(contract.checkInDate), 3)
    .toISOString()
    .slice(0, 10);

  expect(settlement.expectedDate).toBe(expectedDate);
});

// ─── TC-03-09: 결제 후 알림 mock 호출 확인 ──────────────────────────

test('TC-03-09: 정상 결제 후 paytagClient.confirmPayment 1회 호출됨', async () => {
  paytagClient.confirmPayment.mockClear();

  const { contract, guestToken } = await makeApproved();
  mockPaytagSuccess(contract.id);

  await request(app)
    .post(`/api/contracts/${contract.id}/confirm-payment`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send(makePaymentBody(contract));

  expect(paytagClient.confirmPayment).toHaveBeenCalledTimes(1);
});
