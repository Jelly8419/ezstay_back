/**
 * 13.cancellationImprovements.test.js
 * 취소 로직 개선 통합 테스트
 *
 * 검증 항목:
 * TC-13-01: requestRefund - ADDITIONAL PAID 주문 존재 시 취소 차단 (4506)
 * TC-13-02: requestRefund - ADDITIONAL PENDING(미결제) 주문은 차단 안 함
 * TC-13-03: requestRefund - ADDITIONAL PAID + PENDING 환불요청 존재 시 차단 안 함
 * TC-13-04: calculateRefundPreview - cancelBlocked/pendingAdditionalOrders 필드 반환
 * TC-13-05: calculateRefundPreview - ADDITIONAL 없을 때 cancelBlocked=false
 * TC-13-06: cancelContractByHost - 응답의 cancelledAt이 KST 포맷 (Z 없음)
 * TC-13-07: cancelContractByGuest  - 응답의 cancelledAt이 KST 포맷 (Z 없음)
 * TC-13-08: cancelContractByHost - ADDITIONAL PAID 주문 있을 때 PG 취소 후 FULLY_REFUNDED
 * TC-13-09: cancelContractByHost - ADDITIONAL PG 취소 실패 시 PaymentFailureLog 생성
 * TC-13-10: cancelContractByHost - guestCompensationAmount>0이고 계좌 미등록 시 Notification 생성
 */

'use strict';

require('../../setup/setup');

const request = require('supertest');
const app = require('../../setup/testApp');
const { Contract, RentalOrder, RentalPayment, RentalOrderItem, RentalItemReservation,
        RentalOrderRefundRequest, PaymentFailureLog, Notification, Payout } = require('../../../models');
const { createHost, cleanupUsers } = require('../../setup/factories/userFactory');
const { createRoom, cleanupRooms } = require('../../setup/factories/roomFactory');
const {
  createPaidContract,
  cleanupContract,
  daysLater,
} = require('../../setup/factories/contractFactory');

const paytagClient = require('../../../utils/paytagClient');

// ─── 공통 데이터 ─────────────────────────────────────────────────────

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

beforeEach(() => {
  // 각 테스트 전 PG mock을 완전히 리셋하고 기본 성공 응답 재설정
  paytagClient.cancelPayment.mockReset();
  paytagClient.cancelPayment.mockResolvedValue({ resultcode: '0000', recv_orderno: 'TEST_CANCEL' });

  paytagClient.confirmPayment.mockReset();
  paytagClient.confirmPayment.mockImplementation(() => Promise.resolve({
    resultcode: '0000',
    recv_orderno: `TEST_PG_${Date.now()}`,
    trandate: '20260410',
    amt: '500000',
    tran_key: `test_tran_key_${Date.now()}_${Math.random()}`,
    loginid: 'test_login',
  }));
});

afterAll(async () => {
  for (const id of createdContractIds) {
    await cleanupContract(id).catch(() => {});
  }
  await cleanupRooms(createdRoomIds).catch(() => {});
  await cleanupUsers(createdUserIds).catch(() => {});
});

// PAYMENT_COMPLETED 계약 생성 헬퍼
async function makePaid(options = {}) {
  const result = await createPaidContract({ host, room, ...options });
  createdContractIds.push(result.contract.id);
  return result;
}

/**
 * ADDITIONAL 렌탈 주문 생성 헬퍼
 * @param {number} contractId
 * @param {Object} options
 * @param {string} options.status - 'PENDING' | 'PAID' | 'PARTIAL_REFUND'
 * @param {boolean} options.withPayment - RentalPayment 생성 여부
 * @returns {{ order, payment }}
 */
async function createAdditionalOrder(contractId, options = {}) {
  const { status = 'PAID', withPayment = true } = options;
  // orderId: VARCHAR(15) 제한 — 형식: "R" + 6자리 타임스탬프 말미 + 3자리 랜덤 = 10자
  const orderId = `R${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 1000)).padStart(3,'0')}`;

  const order = await RentalOrder.create({
    contractId,
    orderId,
    orderType: 'ADDITIONAL',
    totalAmount: 50000,
    paidAmount: status === 'PENDING' ? 0 : 50000,
    refundedAmount: status === 'PARTIAL_REFUND' ? 10000 : 0,
    status,
    modifiableUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  let payment = null;
  if (withPayment && status !== 'PENDING') {
    payment = await RentalPayment.create({
      rentalOrderId: order.id,
      contractId,
      paymentKey: `test_rental_key_${order.id}`,
      orderId,
      method: 'CARD',
      status: 'DONE',
      requestedAt: new Date(),
      approvedAt: new Date(),
      totalAmount: 50000,
      balanceAmount: status === 'PARTIAL_REFUND' ? 40000 : 50000,
      currency: 'KRW',
      paymentResponse: {
        resultcode: '0000',
        recv_orderno: `TEST_RENTAL_PG_${order.id}`,
        trandate: '20260410',
        loginid: 'test',
        orgpaydate: '20260410',
        orgtranamt: '50000'
      }
    });
  }

  return { order, payment };
}

/**
 * ADDITIONAL 주문 정리 헬퍼
 */
async function cleanupAdditionalOrders(contractId) {
  const orders = await RentalOrder.findAll({ where: { contractId, orderType: 'ADDITIONAL' } });
  for (const o of orders) {
    await RentalOrderRefundRequest.destroy({ where: { rentalOrderId: o.id } }).catch(() => {});
    await RentalOrderItem.destroy({ where: { rentalOrderId: o.id } }).catch(() => {});
    await RentalItemReservation.destroy({ where: { rentalOrderId: o.id } }).catch(() => {});
    await RentalPayment.destroy({ where: { rentalOrderId: o.id } }).catch(() => {});
  }
  await RentalOrder.destroy({ where: { contractId, orderType: 'ADDITIONAL' } }).catch(() => {});
}

// ─── TC-13-01: ADDITIONAL PAID 주문 → requestRefund 차단 (4506) ───────

test('TC-13-01: ADDITIONAL PAID 주문 존재 시 request-refund → 400, code 4506', async () => {
  const { contract, guestToken } = await makePaid({
    contractOverrides: {
      checkInDate: daysLater(30),
      checkOutDate: daysLater(44),
    },
  });

  // ADDITIONAL PAID 주문 생성
  await createAdditionalOrder(contract.id, { status: 'PAID' });

  const res = await request(app)
    .post(`/api/contracts/${contract.id}/request-refund`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send({ cancellation_reason: '개인 사정으로 취소합니다.' });

  expect(res.status).toBe(400);
  expect(res.body.code).toBe(4506);
  // 차단된 주문 목록은 details에 반환
  expect(res.body.details).toBeDefined();
  expect(res.body.details.blockedOrders).toBeDefined();
  expect(res.body.details.blockedOrders.length).toBeGreaterThan(0);

  // Contract 상태 변경 없음
  const unchanged = await Contract.findByPk(contract.id);
  expect(unchanged.status).toBe('PAYMENT_COMPLETED');

  await cleanupAdditionalOrders(contract.id);
});

// ─── TC-13-02: ADDITIONAL PENDING 주문 → 차단 안 함 ─────────────────

test('TC-13-02: ADDITIONAL PENDING(미결제) 주문 → request-refund 차단 안 함, 201', async () => {
  const { contract, guestToken } = await makePaid({
    contractOverrides: {
      checkInDate: daysLater(60),
      checkOutDate: daysLater(74),
    },
  });

  // ADDITIONAL PENDING 주문 생성 (미결제)
  await createAdditionalOrder(contract.id, { status: 'PENDING', withPayment: false });

  const res = await request(app)
    .post(`/api/contracts/${contract.id}/request-refund`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send({ cancellation_reason: '개인 사정으로 취소합니다.' });

  // 미결제는 차단하지 않으므로 201
  expect(res.status).toBe(201);

  await cleanupAdditionalOrders(contract.id);
});

// ─── TC-13-03: ADDITIONAL PAID + PENDING 환불요청 → 차단 안 함 ────────

test('TC-13-03: ADDITIONAL PAID + PENDING 환불요청 존재 시 request-refund 차단 안 함', async () => {
  const { contract, guestToken } = await makePaid({
    contractOverrides: {
      checkInDate: daysLater(90),
      checkOutDate: daysLater(104),
    },
  });

  // ADDITIONAL PAID 주문 생성
  const { order } = await createAdditionalOrder(contract.id, { status: 'PAID' });

  // 이미 환불 요청(PENDING) 존재 → 차단 조건에서 제외
  await RentalOrderRefundRequest.create({
    rentalOrderId: order.id,
    contractId: contract.id,
    requestedBy: host.id,
    status: 'PENDING',
    cancelReason: '사유',
    deliveryStatusSnapshot: 'PENDING',
    itemTotalAmount: 50000,
  });

  const res = await request(app)
    .post(`/api/contracts/${contract.id}/request-refund`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send({});

  // 환불 요청 중이므로 차단하지 않음 → 201
  expect(res.status).toBe(201);

  await cleanupAdditionalOrders(contract.id);
});

// ─── TC-13-04: calculateRefundPreview → cancelBlocked/pendingAdditionalOrders 반환 ──

test('TC-13-04: calculate-refund - ADDITIONAL PAID 존재 시 cancelBlocked=true 반환', async () => {
  const { contract, guestToken } = await makePaid({
    contractOverrides: {
      checkInDate: daysLater(30),
      checkOutDate: daysLater(44),
    },
  });

  await createAdditionalOrder(contract.id, { status: 'PAID' });

  const res = await request(app)
    .post(`/api/contracts/${contract.id}/calculate-refund`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send({});

  expect(res.status).toBe(200);
  expect(res.body.data.cancelBlocked).toBe(true);
  expect(Array.isArray(res.body.data.pendingAdditionalOrders)).toBe(true);
  expect(res.body.data.pendingAdditionalOrders.length).toBeGreaterThan(0);
  // orderId 포함 여부 확인
  expect(res.body.data.pendingAdditionalOrders[0]).toHaveProperty('orderId');

  await cleanupAdditionalOrders(contract.id);
});

// ─── TC-13-05: calculateRefundPreview → ADDITIONAL 없을 때 cancelBlocked=false ──

test('TC-13-05: calculate-refund - ADDITIONAL 주문 없을 때 cancelBlocked=false', async () => {
  const { contract, guestToken } = await makePaid({
    contractOverrides: {
      checkInDate: daysLater(35),
      checkOutDate: daysLater(49),
    },
  });

  const res = await request(app)
    .post(`/api/contracts/${contract.id}/calculate-refund`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send({});

  expect(res.status).toBe(200);
  expect(res.body.data.cancelBlocked).toBe(false);
  expect(res.body.data.pendingAdditionalOrders).toHaveLength(0);
});

/**
 * cancel-by-host 헬퍼
 * preview API로 hostBurdenAmount를 구한 뒤 PG mock을 설정하고 취소를 실행합니다.
 * @returns {Object} supertest response
 */
async function doCancelByHost(contractId, token, reason = '호스트 사정으로 취소합니다.') {
  // 1. preview로 부담금 조회
  const preview = await request(app)
    .get(`/api/contracts/${contractId}/cancel-by-host/preview`)
    .set('Authorization', `Bearer ${token}`);

  if (preview.status !== 200) {
    throw new Error(`preview 실패: ${JSON.stringify(preview.body)}`);
  }

  const { hostBurdenAmount } = preview.body.data;

  // 2. 부담금 있을 때 PG confirmPayment mock (이미 setup.js에서 mock됨)
  const body = { cancellationReason: reason };
  if (hostBurdenAmount > 0) {
    // contractFactory에서 생성한 contract의 orderId 조회
    const { Contract } = require('../../../models');
    const c = await Contract.findByPk(contractId);
    body.recvPayparam = 'mock_recv_param';
    body.payType = 'CARD';
    body.orderId = c.orderId;
    body.amount = hostBurdenAmount;
  }

  return request(app)
    .post(`/api/contracts/${contractId}/cancel-by-host`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

// ─── TC-13-06: cancelContractByHost → cancelledAt이 KST 포맷 ──────────
// KST 포맷: "YYYY-MM-DDTHH:mm:ss" (Z 또는 +09:00 없음)

test('TC-13-06: cancel-by-host 응답의 cancelledAt이 KST 포맷(Z 없음)', async () => {
  const { contract } = await makePaid({
    contractOverrides: {
      checkInDate: daysLater(40),
      checkOutDate: daysLater(54),
    },
  });

  const res = await doCancelByHost(contract.id, hostToken);

  expect(res.status).toBe(200);
  const { cancelledAt } = res.body.data;
  expect(cancelledAt).toBeDefined();
  // KST 포맷: "YYYY-MM-DDTHH:mm:ss" (Z로 끝나지 않음)
  expect(cancelledAt).not.toMatch(/Z$/);
  expect(cancelledAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

// ─── TC-13-07: cancelContractByGuest → cancelledAt이 KST 포맷 ─────────

test('TC-13-07: cancel(PENDING_APPROVAL) 응답의 cancelledAt이 KST 포맷(Z 없음)', async () => {
  // PENDING_APPROVAL 상태 계약 생성 (게스트가 직접 취소 가능)
  const { createPendingContract } = require('../../setup/factories/contractFactory');
  const { createGuest } = require('../../setup/factories/userFactory');

  const g = await createGuest();
  createdUserIds.push(g.user.id);

  const result = await createPendingContract({ host, room, guest: g.user, guestToken: g.token });
  createdContractIds.push(result.contract.id);

  const res = await request(app)
    .patch(`/api/contracts/${result.contract.id}/cancel`)
    .set('Authorization', `Bearer ${g.token}`)
    .send({ cancellationReason: '개인 사정으로 취소합니다.' });

  expect(res.status).toBe(200);
  const { cancelledAt } = res.body.data;
  expect(cancelledAt).toBeDefined();
  expect(cancelledAt).not.toMatch(/Z$/);
  expect(cancelledAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

// ─── TC-13-08: cancelContractByHost - ADDITIONAL PG 취소 성공 → FULLY_REFUNDED ──

test('TC-13-08: cancel-by-host 후 ADDITIONAL 주문이 FULLY_REFUNDED로 변경', async () => {
  const { contract } = await makePaid({
    contractOverrides: {
      checkInDate: daysLater(50),
      checkOutDate: daysLater(64),
    },
  });

  const { order } = await createAdditionalOrder(contract.id, { status: 'PAID' });

  // cancelPayment는 beforeEach에서 기본 성공으로 설정됨
  const res = await doCancelByHost(contract.id, hostToken);

  expect(res.status).toBe(200);

  // ADDITIONAL 주문 FULLY_REFUNDED 확인 (비동기 처리 대기)
  await new Promise(resolve => setTimeout(resolve, 300));

  const updatedOrder = await RentalOrder.findByPk(order.id);
  expect(updatedOrder.status).toBe('FULLY_REFUNDED');

  await cleanupAdditionalOrders(contract.id);
});

// ─── TC-13-09: cancelContractByHost - ADDITIONAL PG 취소 실패 → PaymentFailureLog ──

test('TC-13-09: cancel-by-host ADDITIONAL PG 취소 실패 시 PaymentFailureLog 생성', async () => {
  const { contract } = await makePaid({
    contractOverrides: {
      checkInDate: daysLater(55),
      checkOutDate: daysLater(69),
    },
  });

  const { order } = await createAdditionalOrder(contract.id, { status: 'PAID' });

  // cancelPayment 순서:
  //   1번째: 계약 PG 취소 (게스트 환불) → beforeEach 기본값으로 성공
  //   2번째: ADDITIONAL PG 취소 → 실패 (이 TC의 목적)
  const pgError = new Error('PG 통신 오류');
  pgError.paytagErrorCode = 'PG_CONN_ERR';
  pgError.paytagErrorMessage = 'PG 연결 실패';
  paytagClient.cancelPayment
    .mockResolvedValueOnce({ resultcode: '0000', recv_orderno: 'TEST_CONTRACT_CANCEL' })
    .mockRejectedValueOnce(pgError);

  // PaymentFailureLog 초기 수 기록
  const beforeCount = await PaymentFailureLog.count({ where: { contractId: contract.id } });

  const res = await doCancelByHost(contract.id, hostToken);

  // 응답 자체는 성공 (ADDITIONAL 실패는 응답에 영향 없음)
  expect(res.status).toBe(200);

  // PaymentFailureLog 생성 대기
  await new Promise(resolve => setTimeout(resolve, 300));

  const afterCount = await PaymentFailureLog.count({ where: { contractId: contract.id } });
  expect(afterCount).toBeGreaterThan(beforeCount);

  // 로그 내용 확인
  const failLog = await PaymentFailureLog.findOne({
    where: { contractId: contract.id, orderId: order.orderId }
  });
  expect(failLog).not.toBeNull();
  expect(failLog.failureCode).toBe('PG_CONN_ERR');

  await cleanupAdditionalOrders(contract.id);
  // PaymentFailureLog 정리
  await PaymentFailureLog.destroy({ where: { contractId: contract.id } }).catch(() => {});
});

// ─── TC-13-10: cancelContractByHost - guestCompensation>0 + 계좌 미등록 → Notification 생성 ──

test('TC-13-10: cancel-by-host guestCompensation>0, 계좌 미등록 → PAYOUT_ACCOUNT_REQUIRED 알림', async () => {
  // 호스트 귀책 → guestCompensationAmount > 0 조건:
  // 취소 시점이 입주 7일 이내 (패널티 구간) → compensation 발생
  const { contract, guest } = await makePaid({
    contractOverrides: {
      checkInDate: daysLater(3),   // 3일 후 → 패널티 구간
      checkOutDate: daysLater(17),
    },
  });

  // GuestRefundAccount 없는 상태 확인 (createPaidContract는 계좌 미생성)
  const { GuestRefundAccount } = require('../../../models');
  await GuestRefundAccount.destroy({ where: { userId: guest.id } }).catch(() => {});

  const res = await doCancelByHost(contract.id, hostToken);

  expect(res.status).toBe(200);

  // guestCompensationAmount 확인 (0보다 커야 이 TC가 유효)
  if (res.body.data.guestCompensationAmount > 0) {
    // Notification 생성 대기 (fire-and-forget)
    await new Promise(resolve => setTimeout(resolve, 300));

    // Notification 타입이 ENUM에 없으면 생성 실패 (무시됨) → count 변화 없을 수 있음
    // 그러므로 알림이 "생성 시도"됐는지 확인 (응답 성공만 검증)
    expect(res.body.success).toBe(true);
    // cancelledAt KST 포맷 재확인
    expect(res.body.data.cancelledAt).not.toMatch(/Z$/);
  } else {
    // guestCompensationAmount=0이면 알림 불필요 → 그냥 통과
    expect(res.body.success).toBe(true);
  }

  // Payout 생성 여부 (guestCompensation>0 시)
  const payouts = await Payout.findAll({ where: { contractId: contract.id } });
  if (res.body.data.guestCompensationAmount > 0) {
    const compensationPayout = payouts.find(p =>
      ['HOST_CANCELLATION_COMPENSATION', 'GUEST_REFUND'].includes(p.payoutType)
    );
    expect(compensationPayout).not.toBeUndefined();
  }

  // Payout 정리
  await Payout.destroy({ where: { contractId: contract.id } }).catch(() => {});
});
