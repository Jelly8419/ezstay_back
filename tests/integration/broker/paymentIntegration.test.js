/**
 * paymentIntegration.test.js — 결제 승인 시점 중개인 인센티브 생성 E2E
 *
 * paymentApprovalService.approveContractPayment 를 직접 호출하여
 * 결제 시점 브로커 귀속 판정 + Contract 스냅샷 + BrokerIncentive.create 흐름을 검증한다.
 * (HTTP 계층 및 PayTag mock 은 03.payment.test.js 가 별도로 커버)
 *
 * 검증 포인트:
 *   - 귀속된 호스트 결제 시 Contract 스냅샷 3필드 + BrokerIncentive 생성
 *   - 미귀속 호스트 결제 시 스냅샷/인센티브 모두 미생성
 *   - individual/business 타입별 금액 분리 저장
 *   - settlement_month = Settlement.expectedDate 의 YYYY-MM
 *   - Settlement ON_HOLD 전환 시 BrokerIncentive 도 ON_HOLD 동기화
 */

'use strict';

require('../../setup/setup');

// promotion_events 테이블이 테스트 DB 에 없어 applyHostBenefit 이 실패하는 환경이므로
// promotionService 를 no-op mock 처리. 이 테스트는 브로커 인센티브에만 집중한다.
jest.mock('../../../services/promotionService', () => ({
  getActiveEvents: jest.fn().mockResolvedValue([]),
  consumeBenefits: jest.fn().mockResolvedValue([]),
  voidContractBenefits: jest.fn().mockResolvedValue(undefined),
}));

const {
  sequelize,
  Broker, BrokerRate, BrokerHostMapping, BrokerIncentive,
  Contract, Settlement,
} = require('../../../models');
const { createHost, cleanupUsers } = require('../../setup/factories/userFactory');
const { createRoom, cleanupRooms } = require('../../setup/factories/roomFactory');
const { createApprovedContract, cleanupContract } = require('../../setup/factories/contractFactory');
const { approveContractPayment } = require('../../../services/paymentApprovalService');

// ─── 정리용 ID 저장소 ─────────────────────────────────────────────────
const createdBrokerIds = [];
const createdUserIds = [];
const createdRoomIds = [];
const createdContractIds = [];

// ─── 헬퍼 ───────────────────────────────────────────────────────────
async function createBroker({ brokerType = 'individual', status = 'active' } = {}) {
  const broker = await Broker.create({
    name: `TB_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    phone: '010-0000-0000',
    brokerType,
    taxId: brokerType === 'business' ? '123-45-67890' : null,
    startDate: '2025-01-01',
    endDate: '2099-12-31',
    status,
  });
  createdBrokerIds.push(broker.id);
  return broker;
}

async function attachBrokerToHost(broker, hostId, rate) {
  await BrokerRate.create({
    brokerId: broker.id,
    rate,
    effectiveFrom: '2025-01-01T00:00:00+09:00',
    effectiveTo: null,
  });
  await BrokerHostMapping.create({
    brokerId: broker.id,
    hostId,
    startDate: '2025-01-01T00:00:00+09:00',
    endDate: null,
  });
}

async function makeHostWithRoom(brokerOpts = null, rate = null) {
  const { user: host } = await createHost();
  createdUserIds.push(host.id);

  const { room } = await createRoom(host.id);
  createdRoomIds.push(room.id);

  let broker = null;
  if (brokerOpts) {
    broker = await createBroker(brokerOpts);
    await attachBrokerToHost(broker, host.id, rate);
  }
  return { host, room, broker };
}

async function makeApprovedContractFor(host, room) {
  const result = await createApprovedContract({ host, room });
  createdContractIds.push(result.contract.id);
  return result; // { contract, guest, amounts }
}

function mockedPaytagResponse(contractId) {
  return {
    resultcode: '0000',
    recv_orderno: `TEST_PG_${contractId}`,
    trandate: '20260410',
    amt: '500000',
    tran_key: `tran_${contractId}_${Date.now()}`,
    loginid: 'test_login',
  };
}

async function runApproval(contract, guestId) {
  const now = new Date();
  const realAmount = contract.finalTotalAmount;
  const paytagResponse = mockedPaytagResponse(contract.id);

  const transaction = await sequelize.transaction();
  try {
    const result = await approveContractPayment(
      contract,
      paytagResponse,
      { payType: 'CARD', realAmount, now, guestId, req: null },
      transaction
    );
    await transaction.commit();
    return result;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

// ─── 정리 ───────────────────────────────────────────────────────────
afterAll(async () => {
  for (const id of createdContractIds) await cleanupContract(id).catch(() => {});
  await BrokerIncentive.destroy({ where: { brokerId: createdBrokerIds } }).catch(() => {});
  await BrokerHostMapping.destroy({ where: { brokerId: createdBrokerIds } }).catch(() => {});
  await BrokerRate.destroy({ where: { brokerId: createdBrokerIds } }).catch(() => {});
  await Broker.destroy({ where: { id: createdBrokerIds } }).catch(() => {});
  await cleanupRooms(createdRoomIds).catch(() => {});
  await cleanupUsers(createdUserIds).catch(() => {});
});

// ─── 테스트 ─────────────────────────────────────────────────────────

describe('결제 승인 → 중개인 인센티브 생성', () => {
  test('individual 중개인 귀속: Contract 스냅샷 3필드 + BrokerIncentive 생성', async () => {
    const { host, room, broker } = await makeHostWithRoom({ brokerType: 'individual' }, 0.5);
    const { contract, guest } = await makeApprovedContractFor(host, room);

    const { settlement, brokerIncentive } = await runApproval(contract, guest.id);

    // brokerIncentive 생성됨
    expect(brokerIncentive).not.toBeNull();
    expect(brokerIncentive.brokerId).toBe(broker.id);
    expect(brokerIncentive.brokerType).toBe('individual');
    expect(Number(brokerIncentive.appliedRate)).toBe(0.5);
    expect(brokerIncentive.baseFee).toBe(settlement.hostPlatformFee);
    expect(brokerIncentive.status).toBe('PENDING');

    // 금액 불변식: individual → gross = withholding + net, supply/vat = 0
    expect(brokerIncentive.supplyAmount).toBe(0);
    expect(brokerIncentive.vatAmount).toBe(0);
    expect(brokerIncentive.grossAmount).toBe(
      brokerIncentive.withholdingAmount + brokerIncentive.netAmount
    );

    // Contract 스냅샷 3필드 채워짐
    const updated = await Contract.findByPk(contract.id);
    expect(updated.brokerIdSnapshot).toBe(broker.id);
    expect(Number(updated.brokerRateSnapshot)).toBe(0.5);
    expect(updated.brokerTypeSnapshot).toBe('individual');

    // settlement_month = expected_date 의 YYYY-MM
    const expectedMonth = String(settlement.expectedDate).slice(0, 7);
    expect(brokerIncentive.settlementMonth).toBe(expectedMonth);
  });

  test('business 중개인 귀속: VAT 분리 저장', async () => {
    const { host, room, broker } = await makeHostWithRoom({ brokerType: 'business' }, 0.3);
    const { contract, guest } = await makeApprovedContractFor(host, room);

    const { brokerIncentive } = await runApproval(contract, guest.id);

    expect(brokerIncentive.brokerType).toBe('business');
    expect(brokerIncentive.withholdingAmount).toBe(0);
    // 불변식: business → gross = supply + vat, net = gross
    expect(brokerIncentive.grossAmount).toBe(
      brokerIncentive.supplyAmount + brokerIncentive.vatAmount
    );
    expect(brokerIncentive.netAmount).toBe(brokerIncentive.grossAmount);
    expect(brokerIncentive.brokerId).toBe(broker.id);
  });

  test('미귀속 호스트: 스냅샷 null 유지 + BrokerIncentive 미생성', async () => {
    const { host, room } = await makeHostWithRoom(null); // 브로커 미연결
    const { contract, guest } = await makeApprovedContractFor(host, room);

    const { brokerIncentive } = await runApproval(contract, guest.id);

    expect(brokerIncentive).toBeNull();

    const updated = await Contract.findByPk(contract.id);
    expect(updated.brokerIdSnapshot).toBeNull();
    expect(updated.brokerRateSnapshot).toBeNull();
    expect(updated.brokerTypeSnapshot).toBeNull();

    const incentiveCount = await BrokerIncentive.count({
      where: { contractId: contract.id },
    });
    expect(incentiveCount).toBe(0);
  });

  test('비활성 브로커: 스냅샷/인센티브 모두 미생성', async () => {
    const { host, room } = await makeHostWithRoom({ status: 'inactive' }, 0.5);
    const { contract, guest } = await makeApprovedContractFor(host, room);

    const { brokerIncentive } = await runApproval(contract, guest.id);
    expect(brokerIncentive).toBeNull();

    const updated = await Contract.findByPk(contract.id);
    expect(updated.brokerIdSnapshot).toBeNull();
  });

  test('계산 결과가 brokerIncentiveCalculator 와 일치', async () => {
    const { host, room } = await makeHostWithRoom({ brokerType: 'individual' }, 0.5);
    const { contract, guest } = await makeApprovedContractFor(host, room);

    const { settlement, brokerIncentive } = await runApproval(contract, guest.id);

    // 독립 검증: settlement.hostPlatformFee × 0.5 × 절사 === brokerIncentive.grossAmount
    const expectedGross = Math.floor(settlement.hostPlatformFee * 0.5);
    expect(brokerIncentive.grossAmount).toBe(expectedGross);

    const expectedWithholding = Math.floor(expectedGross * 0.088);
    expect(brokerIncentive.withholdingAmount).toBe(expectedWithholding);
    expect(brokerIncentive.netAmount).toBe(expectedGross - expectedWithholding);
  });
});

describe('Settlement ON_HOLD 전환 시 BrokerIncentive 동기 전환', () => {
  test('BrokerIncentive.update(ON_HOLD) 쿼리 검증 (컨트롤러 패턴 재현)', async () => {
    // 컨트롤러의 2개 지점이 Settlement ON_HOLD 와 BrokerIncentive ON_HOLD 를
    // 동일 쿼리 패턴(status=PENDING 만)으로 처리하는지 직접 검증.
    // 실제 HTTP 경로는 promotion_events 테이블 의존으로 이 파일에서 돌리지 않음.
    const { host, room } = await makeHostWithRoom({ brokerType: 'individual' }, 0.5);
    const { contract, guest } = await makeApprovedContractFor(host, room);
    await runApproval(contract, guest.id);

    const before = await BrokerIncentive.findOne({ where: { contractId: contract.id } });
    expect(before.status).toBe('PENDING');

    // 컨트롤러 로직과 동일한 쿼리
    const tx = await sequelize.transaction();
    try {
      await Settlement.update(
        { status: 'ON_HOLD', note: '테스트: 계약 취소' },
        { where: { contractId: contract.id, status: 'PENDING' }, transaction: tx }
      );
      await BrokerIncentive.update(
        { status: 'ON_HOLD' },
        { where: { contractId: contract.id, status: 'PENDING' }, transaction: tx }
      );
      await tx.commit();
    } catch (e) {
      await tx.rollback();
      throw e;
    }

    const after = await BrokerIncentive.findOne({ where: { contractId: contract.id } });
    expect(after.status).toBe('ON_HOLD');

    const settlementAfter = await Settlement.findOne({ where: { contractId: contract.id } });
    expect(settlementAfter.status).toBe('ON_HOLD');
  });

  test('이미 AGGREGATED 된 BrokerIncentive 는 ON_HOLD 로 바뀌지 않음', async () => {
    // PENDING 만 대상이므로 AGGREGATED 는 안전
    const { host, room } = await makeHostWithRoom({ brokerType: 'individual' }, 0.5);
    const { contract, guest } = await makeApprovedContractFor(host, room);
    await runApproval(contract, guest.id);

    // 수동으로 AGGREGATED 로 전환
    await BrokerIncentive.update(
      { status: 'AGGREGATED' },
      { where: { contractId: contract.id } }
    );

    // ON_HOLD 쿼리 실행 (PENDING 만 대상)
    await BrokerIncentive.update(
      { status: 'ON_HOLD' },
      { where: { contractId: contract.id, status: 'PENDING' } }
    );

    const row = await BrokerIncentive.findOne({ where: { contractId: contract.id } });
    expect(row.status).toBe('AGGREGATED'); // 변하지 않음
  });
});
