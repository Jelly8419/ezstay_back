/**
 * 10.settlement.test.js
 * TC-10-01 ~ TC-10-10: 정산(Settlement) 테스트
 *
 * - TC-10-01~02: 결제 완료 시 Settlement 자동 생성 (통합)
 * - TC-10-02~04: calculateSettlementDate 영업일 계산 (단위)
 * - TC-10-05~06: 스케줄러 PENDING→READY 전환
 * - TC-10-07~08: 정산 금액 계산 (EZ청소 유/무)
 * - TC-10-09: 취소 시 Settlement CANCELLED
 * - TC-10-10: Settlement 중복 생성 방지
 */

'use strict';

require('../../setup/setup');

const request = require('supertest');
const app     = require('../../setup/testApp');
const { Contract, Settlement } = require('../../../models');
const { createHost, cleanupUsers }  = require('../../setup/factories/userFactory');
const { createRoom, cleanupRooms }  = require('../../setup/factories/roomFactory');
const {
  createPaidContract,
  createInProgressContract,
  createCompletedContract,
  cleanupContract,
  daysLater,
} = require('../../setup/factories/contractFactory');

const {
  calculateSettlementDate,
} = require('../../../utils/businessDayHelper');

const {
  updateInProgress,
  updateSettlementReady,
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

// ─── TC-10-01: 결제 완료 시 Settlement 생성, status=PENDING ──────────

test('TC-10-01: 결제 완료(createPaidContract) 후 Settlement status=PENDING 자동 생성', async () => {
  const { contract } = await createPaidContract({ host, room });
  createdContractIds.push(contract.id);

  const settlement = await Settlement.findOne({ where: { contractId: contract.id } });

  expect(settlement).not.toBeNull();
  expect(settlement.status).toBe('PENDING');
});

// ─── TC-10-02: expectedDate 계산 — 평일 기준 (단위 테스트) ───────────

test('TC-10-02: calculateSettlementDate — 평일 기준 checkInDate + 3영업일', () => {
  // 2026-04-13 월요일 → +3영업일 = 2026-04-16 목요일
  const result = calculateSettlementDate('2026-04-13');
  const yyyy = result.getFullYear();
  const mm   = String(result.getMonth() + 1).padStart(2, '0');
  const dd   = String(result.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;

  // 3영업일 후이며 주말(토/일)이 아닌지 확인
  expect(result.getDay()).not.toBe(0); // 일요일 아님
  expect(result.getDay()).not.toBe(6); // 토요일 아님
  // 월~목 → 그냥 +3일
  expect(dateStr).toBe('2026-04-16');
});

// ─── TC-10-03: expectedDate 계산 — 주말 포함 ─────────────────────────

test('TC-10-03: calculateSettlementDate — 토요일 입력 시 주말 건너뜀', () => {
  // 2026-04-11 토요일 → 월(13)+화(14)+수(15) = 2026-04-15 수요일
  const result = calculateSettlementDate('2026-04-11');
  const yyyy = result.getFullYear();
  const mm   = String(result.getMonth() + 1).padStart(2, '0');
  const dd   = String(result.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;

  expect(result.getDay()).not.toBe(0);
  expect(result.getDay()).not.toBe(6);
  expect(dateStr).toBe('2026-04-15');
});

// ─── TC-10-04: expectedDate 계산 — 공휴일 캐시 없으면 주말만 제외 ────

test('TC-10-04: calculateSettlementDate — 금요일 입력 시 월~수 3영업일', () => {
  // 2026-04-10 금요일 → 월(13)+화(14)+수(15) = 2026-04-15
  // (공휴일 캐시 미설정 환경에서도 주말은 건너뜀)
  const result = calculateSettlementDate('2026-04-10');
  const yyyy = result.getFullYear();
  const mm   = String(result.getMonth() + 1).padStart(2, '0');
  const dd   = String(result.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;

  expect(result.getDay()).not.toBe(0);
  expect(result.getDay()).not.toBe(6);
  expect(dateStr).toBe('2026-04-15');
});

// ─── TC-10-05: PENDING → READY 전환 (스케줄러) ───────────────────────

test('TC-10-05: updateSettlementReady() — expectedDate 도래 시 PENDING→READY 전환', async () => {
  const { contract } = await createPaidContract({ host, room });
  createdContractIds.push(contract.id);

  // payoutAvailableDate를 과거로 강제 설정
  const pastDate = daysLater(-5);
  await Settlement.update(
    { payoutAvailableDate: pastDate, expectedDate: pastDate },
    { where: { contractId: contract.id } }
  );

  await updateSettlementReady();

  const updated = await Settlement.findOne({ where: { contractId: contract.id } });
  expect(updated.status).toBe('READY');
});

// ─── TC-10-06: payoutAvailableDate 미도래 시 READY 차단 ──────────────

test('TC-10-06: updateSettlementReady() — payoutAvailableDate 미래 시 PENDING 유지', async () => {
  const { contract } = await createPaidContract({ host, room });
  createdContractIds.push(contract.id);

  // payoutAvailableDate를 미래로 강제 설정
  const futureDate = daysLater(30);
  await Settlement.update(
    { payoutAvailableDate: futureDate, expectedDate: futureDate },
    { where: { contractId: contract.id } }
  );

  await updateSettlementReady();

  const settlement = await Settlement.findOne({ where: { contractId: contract.id } });
  expect(settlement.status).toBe('PENDING');
});

// ─── TC-10-07: 정산 금액 계산 — EZ청소 미사용 ────────────────────────

test('TC-10-07: 정산 금액 — EZ청소 미사용 시 netAmount = rentalFee + maintenanceFee + cleaningFee - hostPlatformFee', async () => {
  const { contract } = await createPaidContract({ host, room });
  createdContractIds.push(contract.id);

  const settlement = await Settlement.findOne({ where: { contractId: contract.id } });
  expect(settlement).not.toBeNull();

  const expectedGross  = settlement.rentalFee + settlement.maintenanceFee + settlement.cleaningFee;
  const expectedNet    = expectedGross - settlement.hostPlatformFee;

  expect(settlement.grossAmount).toBe(expectedGross);
  expect(settlement.netAmount).toBe(expectedNet);
});

// ─── TC-10-08: 정산 금액 계산 — EZ청소 사용 시 청소비 제외 ───────────

test('TC-10-08: 정산 금액 — EZ청소 사용 시 netAmount에 청소비 미포함', async () => {
  // snapshot에 ezService.cleaningService: true 설정
  const { contract } = await createPaidContract({
    host,
    room,
    contractOverrides: {
      snapshot: {
        room: { id: room.id, title: room.title, address: room.address },
        host: { id: host.id, name: host.name },
        ezService: { cleaningService: true },
      },
    },
  });
  createdContractIds.push(contract.id);

  // 기존 Settlement 삭제 후 스케줄러로 재생성
  await Settlement.destroy({ where: { contractId: contract.id } });

  // checkInDate를 과거로 설정하여 IN_PROGRESS 전환 트리거
  await contract.update({
    status: 'PAYMENT_COMPLETED',
    checkInDate: daysLater(-1),
    checkOutDate: daysLater(10),
  });

  await updateInProgress();

  const settlement = await Settlement.findOne({ where: { contractId: contract.id } });
  expect(settlement).not.toBeNull();

  // EZ청소 사용 시 cleaningFee=0으로 정산
  expect(settlement.cleaningFee).toBe(0);
  // grossAmount = rentalFee + maintenanceFee (청소비 제외)
  expect(settlement.grossAmount).toBe(settlement.rentalFee + settlement.maintenanceFee);
});

// ─── TC-10-09: 취소 시 Settlement ON_HOLD ────────────────────────────
// 구현 주석: 취소 시 Settlement는 CANCELLED가 아니라 ON_HOLD로 전환됨
// (requestRefund, cancelContractByHost 모두 ON_HOLD 처리)

test('TC-10-09: 계약 취소(환불) 시 Settlement status=ON_HOLD', async () => {
  const { contract, guestToken } = await createPaidContract({ host, room });
  createdContractIds.push(contract.id);

  // 입주 전 환불 요청 → 자동 승인 → 취소
  const res = await request(app)
    .post(`/api/contracts/${contract.id}/request-refund`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send({ reason: '개인 사정으로 취소합니다.' });

  expect([200, 201]).toContain(res.status);

  const settlement = await Settlement.findOne({ where: { contractId: contract.id } });
  expect(settlement).not.toBeNull();
  // 실제 구현: 취소 시 Settlement → ON_HOLD (수동 정산 처리 대기)
  expect(settlement.status).toBe('ON_HOLD');
});

// ─── TC-10-10: Settlement 중복 생성 방지 ─────────────────────────────

test('TC-10-10: IN_PROGRESS 재진입 시 Settlement 1개만 존재 (중복 방지)', async () => {
  const { contract } = await createPaidContract({ host, room });
  createdContractIds.push(contract.id);

  // checkInDate를 과거로 설정
  await contract.update({
    status: 'PAYMENT_COMPLETED',
    checkInDate: daysLater(-1),
    checkOutDate: daysLater(10),
  });

  // 스케줄러 2회 실행
  await updateInProgress();
  await updateInProgress();

  const count = await Settlement.count({ where: { contractId: contract.id } });
  expect(count).toBe(1);
});
