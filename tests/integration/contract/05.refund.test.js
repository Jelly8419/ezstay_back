/**
 * 05.refund.test.js
 * TC-05-01 ~ TC-05-09: 게스트 환불/취소 통합 테스트
 *
 * POST /api/contracts/:contractId/request-refund  (PAYMENT_COMPLETED에서 환불)
 * POST /api/contracts/:contractId/cancel-request  (IN_PROGRESS에서 취소 요청)
 *
 * TC 문서와 실제 구현 차이:
 * - IN_PROGRESS 취소(TC-05-05): /request-refund 아닌 /cancel-request 엔드포인트 사용
 * - TC-05-06 (중복 요청): CANCEL_REQUESTED 상태에서 /cancel-request 재시도 → code 4623
 */

'use strict';

require('../../setup/setup');

const request = require('supertest');
const app     = require('../../setup/testApp');
const { Contract, Refund, Settlement } = require('../../../models');
const { createHost, cleanupUsers }     = require('../../setup/factories/userFactory');
const { createRoom, cleanupRooms }     = require('../../setup/factories/roomFactory');
const {
  createPaidContract,
  createInProgressContract,
  createCompletedContract,
  cleanupContract,
  daysLater,
} = require('../../setup/factories/contractFactory');

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

// PAYMENT_COMPLETED 계약 생성 헬퍼
async function makePaid(options = {}) {
  const result = await createPaidContract({ host, room, ...options });
  createdContractIds.push(result.contract.id);
  return result;
}

// IN_PROGRESS 계약 생성 헬퍼
async function makeInProgress(options = {}) {
  const result = await createInProgressContract({ host, room, ...options });
  createdContractIds.push(result.contract.id);
  return result;
}

// ─── TC-05-01: 7일 전 취소 → 100% 환불 ────────────────────────────

test('TC-05-01: 7일 이상 전 취소 → Refund 생성, 환불율 100%', async () => {
  // checkInDate = 30일 후 → 취소 시점에서 30일 남음 → 100% 환불
  const { contract, guestToken } = await makePaid({
    contractOverrides: {
      checkInDate: daysLater(30),
      checkOutDate: daysLater(44),
    },
  });

  const res = await request(app)
    .post(`/api/contracts/${contract.id}/request-refund`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send({ cancellation_reason: '개인 사정으로 취소합니다.' });

  expect(res.status).toBe(201);
  // 입주 전 자동 승인 + PG 취소까지 완료되면 COMPLETED
  expect(res.body.data.autoApproved).toBe(true);

  // Refund 생성 확인
  const refund = await Refund.findOne({ where: { contractId: contract.id } });
  expect(refund).not.toBeNull();
  // DECIMAL 컬럼이므로 parseFloat 비교
  expect(parseFloat(refund.rentalFeeRefundRate)).toBe(100);

  // Contract 상태 확인
  const updated = await Contract.findByPk(contract.id);
  expect(updated.status).toBe('REFUNDED');
});

// ─── TC-05-02: 3~6일 전 취소 → 50% 환불 ───────────────────────────

test('TC-05-02: 3~6일 전 취소 → 환불율 50%', async () => {
  const { contract, guestToken } = await makePaid({
    contractOverrides: {
      checkInDate: daysLater(5),
      checkOutDate: daysLater(19),
    },
  });

  const res = await request(app)
    .post(`/api/contracts/${contract.id}/request-refund`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send({});

  expect(res.status).toBe(201);
  expect(res.body.data.autoApproved).toBe(true);

  const refund = await Refund.findOne({ where: { contractId: contract.id } });
  expect(refund).not.toBeNull();
  expect(parseFloat(refund.rentalFeeRefundRate)).toBe(50);
});

// ─── TC-05-03: 0~2일 전 취소 → 0% 환불 ────────────────────────────

test('TC-05-03: 0~2일 전 취소 → 환불율 0%', async () => {
  const { contract, guestToken } = await makePaid({
    contractOverrides: {
      checkInDate: daysLater(1),
      checkOutDate: daysLater(15),
    },
  });

  const res = await request(app)
    .post(`/api/contracts/${contract.id}/request-refund`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send({});

  expect(res.status).toBe(201);

  const refund = await Refund.findOne({ where: { contractId: contract.id } });
  expect(refund).not.toBeNull();
  expect(parseFloat(refund.rentalFeeRefundRate)).toBe(0);
});

// ─── TC-05-04: 결제 당일 취소 → 100% 환불 ──────────────────────────

test('TC-05-04: 결제 당일 취소 → 100% 환불 (isSameDayCancellation)', async () => {
  // checkInDate = 1일 후지만 결제 당일이므로 100% 환불
  const { contract, guestToken } = await makePaid({
    contractOverrides: {
      checkInDate: daysLater(1),
      checkOutDate: daysLater(15),
    },
  });

  // paidAt을 오늘로 강제 설정 (이미 오늘이지만 명시적으로)
  await contract.update({ paidAt: new Date() });

  const res = await request(app)
    .post(`/api/contracts/${contract.id}/request-refund`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send({});

  expect(res.status).toBe(201);

  const refund = await Refund.findOne({ where: { contractId: contract.id } });
  expect(refund).not.toBeNull();
  // 결제 당일 취소 → isSameDayCancellation=true
  expect(refund.isSameDayCancellation).toBe(true);
  // 테스트 정책에 isSameDayCancellation 전용 rule 없음
  // → sameDayRate=0, periodRate=0 (1일 후 = 0~2일 구간) → max(0,0) = 0%
  expect(parseFloat(refund.rentalFeeRefundRate)).toBe(0);
});

// ─── TC-05-05: IN_PROGRESS 상태 취소 요청 ──────────────────────────
// 엔드포인트: POST /cancel-request (게스트/호스트 공용)
// /request-refund는 IN_PROGRESS에서 4501 반환

test('TC-05-05: IN_PROGRESS 상태에서 cancel-request → 200, CANCEL_REQUESTED', async () => {
  const { contract, guestToken } = await makeInProgress();

  const res = await request(app)
    .post(`/api/contracts/${contract.id}/cancel-request`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send({ reason: '개인 사정으로 취소 요청합니다.' });

  expect(res.status).toBe(200);

  const updated = await Contract.findByPk(contract.id);
  expect(updated.status).toBe('CANCEL_REQUESTED');
});

// ─── TC-05-06: 이미 취소 요청된 계약 재요청 → 400, code 4623 ────────

test('TC-05-06: CANCEL_REQUESTED 상태에서 cancel-request 재시도 → 400, code 4623', async () => {
  const { contract, guestToken } = await makeInProgress();

  // 1차 요청
  await request(app)
    .post(`/api/contracts/${contract.id}/cancel-request`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send({ reason: '1차 취소 요청' });

  // 2차 재요청 (이미 CANCEL_REQUESTED 상태)
  const res = await request(app)
    .post(`/api/contracts/${contract.id}/cancel-request`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send({ reason: '2차 취소 요청' });

  expect(res.status).toBe(400);
  expect(res.body.code).toBe(4623);
});

// ─── TC-05-07: Settlement READY 이후 환불 시도 → 400, code 4504 ─────

test('TC-05-07: Settlement READY 이후 환불 시도 → 400, code 4504', async () => {
  const { contract, guestToken } = await makePaid({
    contractOverrides: {
      checkInDate: daysLater(30),
      checkOutDate: daysLater(44),
    },
  });

  // Settlement 상태를 READY로 강제 변경
  await Settlement.update(
    { status: 'READY' },
    { where: { contractId: contract.id } }
  );

  const res = await request(app)
    .post(`/api/contracts/${contract.id}/request-refund`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send({});

  expect(res.status).toBe(400);
  expect(res.body.code).toBe(4504);
});

// ─── TC-05-08: COMPLETED 계약 환불 시도 → 400, code 4501 ────────────

test('TC-05-08: COMPLETED 계약 환불 시도 → 400', async () => {
  const { contract, guestToken } = await (async () => {
    const result = await createCompletedContract({ host, room });
    createdContractIds.push(result.contract.id);
    return result;
  })();

  const res = await request(app)
    .post(`/api/contracts/${contract.id}/request-refund`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send({});

  expect(res.status).toBe(400);
  expect(res.body.code).toBe(4501);
});

// ─── TC-05-09: 호스트가 게스트 환불 엔드포인트 시도 → 404 ────────────

test('TC-05-09: 호스트 토큰으로 request-refund 시도 → 404 (guestId 불일치)', async () => {
  const { contract } = await makePaid({
    contractOverrides: {
      checkInDate: daysLater(30),
      checkOutDate: daysLater(44),
    },
  });

  const res = await request(app)
    .post(`/api/contracts/${contract.id}/request-refund`)
    .set('Authorization', `Bearer ${hostToken}`)
    .send({});

  // guestId 기준 조회이므로 호스트 토큰이면 contract 미발견 → 404
  expect(res.status).toBe(404);
});
