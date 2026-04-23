/**
 * adminBrokerApi.test.js — Admin 중개인 관리 API 통합 테스트
 *
 * 검증:
 *   - CRUD: 중개인 생성/조회/수정
 *   - 요율 이력 관리 (기존 활성 row 자동 마감)
 *   - 임대인 귀속 추가/해제/중복 방지
 *   - 월별 인센티브 집계 및 지급완료 처리
 *   - CSV 다운로드
 *
 * promotionService mock: Phase 3 와 동일 이유 (ezstay_test 에 promotion_events 부재)
 */

'use strict';

require('../../setup/setup');

jest.mock('../../../services/promotionService', () => ({
  getActiveEvents: jest.fn().mockResolvedValue([]),
  consumeBenefits: jest.fn().mockResolvedValue([]),
  voidContractBenefits: jest.fn().mockResolvedValue(undefined),
}));

const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../../setup/testApp');
const {
  sequelize,
  Admin, Broker, BrokerRate, BrokerHostMapping,
  BrokerIncentive, BrokerIncentivePayout,
  Settlement,
} = require('../../../models');
const { createHost, cleanupUsers } = require('../../setup/factories/userFactory');
const { createRoom, cleanupRooms } = require('../../setup/factories/roomFactory');
const { createApprovedContract, cleanupContract } = require('../../setup/factories/contractFactory');
const { generateTokens } = require('../../../utils/auth');
const { approveContractPayment } = require('../../../services/paymentApprovalService');

// ─── 정리용 추적 ──────────────────────────────────────────────────
const createdAdminIds = [];
const createdBrokerIds = [];
const createdUserIds = [];
const createdRoomIds = [];
const createdContractIds = [];

// ─── 헬퍼 ──────────────────────────────────────────────────────────

let adminToken;
let adminUser;

async function createAdmin(role = 'super_admin') {
  const username = `tb_admin_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const password = await bcrypt.hash('pw', 4);
  const admin = await Admin.create({
    username, password, name: 'TB Admin', role, isActive: true,
  });
  createdAdminIds.push(admin.id);
  const { accessToken } = generateTokens({ userId: admin.id, role: admin.role });
  return { admin, token: accessToken };
}

function auth() {
  return { Authorization: `Bearer ${adminToken}` };
}

async function paidContractFor(host, room) {
  const result = await createApprovedContract({ host, room });
  createdContractIds.push(result.contract.id);

  // paymentApprovalService 직접 호출로 Settlement + BrokerIncentive 생성
  const tx = await sequelize.transaction();
  try {
    const outcome = await approveContractPayment(
      result.contract,
      { resultcode: '0000', recv_orderno: `PG_${result.contract.id}`, tran_key: `k_${result.contract.id}_${Date.now()}` },
      { payType: 'CARD', realAmount: result.contract.finalTotalAmount, now: new Date(), guestId: result.guest.id, req: null },
      tx
    );
    await tx.commit();
    return { ...result, ...outcome };
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

// ─── 부트스트랩 ────────────────────────────────────────────────────
beforeAll(async () => {
  const created = await createAdmin('super_admin');
  adminUser = created.admin;
  adminToken = created.token;
});

afterAll(async () => {
  for (const id of createdContractIds) await cleanupContract(id).catch(() => {});
  await BrokerIncentivePayout.destroy({ where: { brokerId: createdBrokerIds } }).catch(() => {});
  await BrokerIncentive.destroy({ where: { brokerId: createdBrokerIds } }).catch(() => {});
  await BrokerHostMapping.destroy({ where: { brokerId: createdBrokerIds } }).catch(() => {});
  await BrokerRate.destroy({ where: { brokerId: createdBrokerIds } }).catch(() => {});
  await Broker.destroy({ where: { id: createdBrokerIds } }).catch(() => {});
  await cleanupRooms(createdRoomIds).catch(() => {});
  await cleanupUsers(createdUserIds).catch(() => {});
  await Admin.destroy({ where: { id: createdAdminIds } }).catch(() => {});
});

// ─── 중개인 CRUD ────────────────────────────────────────────────────
describe('POST /api/admin/brokers', () => {
  test('개인 중개인 생성 성공', async () => {
    const res = await request(app)
      .post('/api/admin/brokers')
      .set(auth())
      .send({
        name: 'TB개인', phone: '010-1111-2222',
        brokerType: 'individual',
        startDate: '2026-01-01', endDate: '2099-12-31',
        initialRate: 0.5,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.brokerId).toBeDefined();
    createdBrokerIds.push(res.body.data.brokerId);

    const rate = await BrokerRate.findOne({ where: { brokerId: res.body.data.brokerId } });
    expect(rate).not.toBeNull();
    expect(Number(rate.rate)).toBe(0.5);
    expect(rate.effectiveTo).toBeNull();
  });

  test('사업자 중개인에 taxId 없으면 4911', async () => {
    const res = await request(app)
      .post('/api/admin/brokers')
      .set(auth())
      .send({
        name: 'TB사업자', phone: '010-2222-3333',
        brokerType: 'business',
        startDate: '2026-01-01', endDate: '2099-12-31',
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(4911);
  });

  test('종료일이 시작일 이전이면 4912', async () => {
    const res = await request(app)
      .post('/api/admin/brokers')
      .set(auth())
      .send({
        name: 'TB역전', phone: '010-3333-4444',
        brokerType: 'individual',
        startDate: '2026-12-31', endDate: '2026-01-01',
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(4912);
  });

  test('initialRate 가 1 초과면 4913', async () => {
    const res = await request(app)
      .post('/api/admin/brokers')
      .set(auth())
      .send({
        name: 'TB률', phone: '010-4444-5555',
        brokerType: 'individual',
        startDate: '2026-01-01', endDate: '2099-12-31',
        initialRate: 1.5,
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(4913);
  });
});

describe('GET /api/admin/brokers', () => {
  test('목록 조회 + currentRate/hostCount 포함', async () => {
    // 사전 준비: broker 1개 생성 + host 매핑 1개
    const createRes = await request(app).post('/api/admin/brokers').set(auth()).send({
      name: 'TB목록', phone: '010-5555-6666',
      brokerType: 'individual',
      startDate: '2026-01-01', endDate: '2099-12-31',
      initialRate: 0.3,
    });
    const brokerId = createRes.body.data.brokerId;
    createdBrokerIds.push(brokerId);

    const { user: host } = await createHost();
    createdUserIds.push(host.id);
    await request(app).post(`/api/admin/brokers/${brokerId}/hosts`).set(auth()).send({ hostId: host.id });

    const res = await request(app).get('/api/admin/brokers').set(auth());
    expect(res.status).toBe(200);
    const target = res.body.data.brokers.find((b) => b.id === brokerId);
    expect(target).toBeDefined();
    expect(target.currentRate).toBe(0.3);
    expect(target.hostCount).toBeGreaterThanOrEqual(1);
  });
});

// ─── 적용률 이력 ───────────────────────────────────────────────────
describe('POST /api/admin/brokers/:brokerId/rates', () => {
  test('새 요율 추가 시 기존 활성 row 의 effectiveTo 자동 세팅', async () => {
    const createRes = await request(app).post('/api/admin/brokers').set(auth()).send({
      name: 'TB요율', phone: '010-6666-7777',
      brokerType: 'individual',
      startDate: '2026-01-01', endDate: '2099-12-31',
      initialRate: 0.5,
    });
    const brokerId = createRes.body.data.brokerId;
    createdBrokerIds.push(brokerId);

    const addRes = await request(app)
      .post(`/api/admin/brokers/${brokerId}/rates`)
      .set(auth())
      .send({ rate: 0.3 });
    expect(addRes.status).toBe(201);

    const rates = await BrokerRate.findAll({ where: { brokerId } });
    expect(rates.length).toBe(2);
    // 활성 rate 는 정확히 1개 + rate=0.3
    const active = rates.filter((r) => r.effectiveTo === null);
    expect(active.length).toBe(1);
    expect(Number(active[0].rate)).toBe(0.3);
    // 나머지 1개는 마감됨 + rate=0.5 (initialRate)
    const closed = rates.filter((r) => r.effectiveTo !== null);
    expect(closed.length).toBe(1);
    expect(Number(closed[0].rate)).toBe(0.5);
  });
});

// ─── 임대인 귀속 ───────────────────────────────────────────────────
describe('POST /api/admin/brokers/:brokerId/hosts', () => {
  test('중복 활성 매핑 시 4914', async () => {
    const createRes = await request(app).post('/api/admin/brokers').set(auth()).send({
      name: 'TB중복', phone: '010-7777-8888',
      brokerType: 'individual',
      startDate: '2026-01-01', endDate: '2099-12-31',
      initialRate: 0.5,
    });
    const brokerId = createRes.body.data.brokerId;
    createdBrokerIds.push(brokerId);

    const { user: host } = await createHost();
    createdUserIds.push(host.id);

    const first = await request(app).post(`/api/admin/brokers/${brokerId}/hosts`).set(auth()).send({ hostId: host.id });
    expect(first.status).toBe(201);

    const second = await request(app).post(`/api/admin/brokers/${brokerId}/hosts`).set(auth()).send({ hostId: host.id });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe(4914);
  });

  test('DELETE 후 다른 브로커에 재귀속 가능', async () => {
    const { user: host } = await createHost();
    createdUserIds.push(host.id);

    const b1Res = await request(app).post('/api/admin/brokers').set(auth()).send({
      name: 'TB이관A', phone: '010-8888-9999', brokerType: 'individual',
      startDate: '2026-01-01', endDate: '2099-12-31', initialRate: 0.5,
    });
    const b1 = b1Res.body.data.brokerId; createdBrokerIds.push(b1);

    const b2Res = await request(app).post('/api/admin/brokers').set(auth()).send({
      name: 'TB이관B', phone: '010-9999-0000', brokerType: 'individual',
      startDate: '2026-01-01', endDate: '2099-12-31', initialRate: 0.3,
    });
    const b2 = b2Res.body.data.brokerId; createdBrokerIds.push(b2);

    await request(app).post(`/api/admin/brokers/${b1}/hosts`).set(auth()).send({ hostId: host.id });
    const delRes = await request(app).delete(`/api/admin/brokers/${b1}/hosts/${host.id}`).set(auth());
    expect(delRes.status).toBe(200);

    const reMap = await request(app).post(`/api/admin/brokers/${b2}/hosts`).set(auth()).send({ hostId: host.id });
    expect(reMap.status).toBe(201);
  });
});

// ─── 월별 집계 + 지급완료 ──────────────────────────────────────────
describe('GET /api/admin/broker-incentives/monthly', () => {
  test('월 형식 잘못되면 4918', async () => {
    const res = await request(app).get('/api/admin/broker-incentives/monthly?month=2026-13').set(auth());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(4918);
  });

  test('결제→BrokerIncentive→월별 집계 → payouts 에 broker 1개 등장', async () => {
    // broker + host + 매핑 + 계약 결제
    const createRes = await request(app).post('/api/admin/brokers').set(auth()).send({
      name: 'TB월별', phone: '010-0000-1111', brokerType: 'individual',
      startDate: '2025-01-01', endDate: '2099-12-31', initialRate: 0.5,
    });
    const brokerId = createRes.body.data.brokerId; createdBrokerIds.push(brokerId);

    const { user: host } = await createHost(); createdUserIds.push(host.id);
    const { room } = await createRoom(host.id); createdRoomIds.push(room.id);

    await request(app).post(`/api/admin/brokers/${brokerId}/hosts`).set(auth()).send({ hostId: host.id });

    const { settlement, brokerIncentive } = await paidContractFor(host, room);
    expect(brokerIncentive).not.toBeNull();

    const month = String(settlement.expectedDate).slice(0, 7);
    const res = await request(app).get(`/api/admin/broker-incentives/monthly?month=${month}`).set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data.month).toBe(month);
    const ours = res.body.data.payouts.find((p) => p.brokerId === brokerId);
    expect(ours).toBeDefined();
    expect(ours.contractCount).toBe(1);
    expect(ours.totalGross).toBe(brokerIncentive.grossAmount);
    expect(ours.totalNet).toBe(brokerIncentive.netAmount);
    expect(ours.status).toBe('PENDING');

    // BrokerIncentive status = AGGREGATED 로 전환
    const inc = await BrokerIncentive.findByPk(brokerIncentive.id);
    expect(inc.status).toBe('AGGREGATED');
    expect(inc.payoutId).toBe(ours.payoutId);
  });
});

describe('PATCH /api/admin/broker-incentives/monthly/:payoutId/pay', () => {
  test('지급완료 → 다시 호출 시 4917', async () => {
    // 위와 동일 세팅
    const createRes = await request(app).post('/api/admin/brokers').set(auth()).send({
      name: 'TB지급', phone: '010-1212-3434', brokerType: 'individual',
      startDate: '2025-01-01', endDate: '2099-12-31', initialRate: 0.5,
    });
    const brokerId = createRes.body.data.brokerId; createdBrokerIds.push(brokerId);

    const { user: host } = await createHost(); createdUserIds.push(host.id);
    const { room } = await createRoom(host.id); createdRoomIds.push(room.id);
    await request(app).post(`/api/admin/brokers/${brokerId}/hosts`).set(auth()).send({ hostId: host.id });

    const { settlement } = await paidContractFor(host, room);
    const month = String(settlement.expectedDate).slice(0, 7);

    // 집계 유도
    const listRes = await request(app).get(`/api/admin/broker-incentives/monthly?month=${month}`).set(auth());
    const payout = listRes.body.data.payouts.find((p) => p.brokerId === brokerId);
    expect(payout).toBeDefined();

    const payRes = await request(app)
      .patch(`/api/admin/broker-incentives/monthly/${payout.payoutId}/pay`)
      .set(auth())
      .send({ memo: '테스트 지급' });
    expect(payRes.status).toBe(200);

    // PAID 상태 확인
    const paid = await BrokerIncentivePayout.findByPk(payout.payoutId);
    expect(paid.status).toBe('PAID');
    expect(paid.paidAt).not.toBeNull();
    expect(paid.paidByAdminId).toBe(adminUser.id);

    // 두 번째 호출 차단
    const dup = await request(app)
      .patch(`/api/admin/broker-incentives/monthly/${payout.payoutId}/pay`)
      .set(auth())
      .send({});
    expect(dup.status).toBe(400);
    expect(dup.body.code).toBe(4917);
  });

  test('PAID 이후 재집계는 금액 변경 없음 (지급 완료 행 보호)', async () => {
    const createRes = await request(app).post('/api/admin/brokers').set(auth()).send({
      name: 'TB보호', phone: '010-3434-5656', brokerType: 'individual',
      startDate: '2025-01-01', endDate: '2099-12-31', initialRate: 0.5,
    });
    const brokerId = createRes.body.data.brokerId; createdBrokerIds.push(brokerId);

    const { user: host } = await createHost(); createdUserIds.push(host.id);
    const { room } = await createRoom(host.id); createdRoomIds.push(room.id);
    await request(app).post(`/api/admin/brokers/${brokerId}/hosts`).set(auth()).send({ hostId: host.id });

    const { settlement } = await paidContractFor(host, room);
    const month = String(settlement.expectedDate).slice(0, 7);

    // 집계 + 지급완료
    const listRes = await request(app).get(`/api/admin/broker-incentives/monthly?month=${month}`).set(auth());
    const payoutId = listRes.body.data.payouts.find((p) => p.brokerId === brokerId).payoutId;
    await request(app).patch(`/api/admin/broker-incentives/monthly/${payoutId}/pay`).set(auth()).send({});

    const before = await BrokerIncentivePayout.findByPk(payoutId);
    const beforeGross = before.totalGross;

    // 추가 계약 결제 발생
    const { brokerIncentive: newIncentive } = await paidContractFor(host, room);
    expect(newIncentive).not.toBeNull();

    // 재집계 호출
    await request(app).get(`/api/admin/broker-incentives/monthly?month=${month}`).set(auth());

    const after = await BrokerIncentivePayout.findByPk(payoutId);
    expect(after.totalGross).toBe(beforeGross); // PAID 건은 갱신 안 됨
  });
});

// ─── 상세 & CSV ────────────────────────────────────────────────────
describe('상세 조회 / CSV', () => {
  let sharedPayoutId;
  let sharedBrokerId;

  beforeAll(async () => {
    const createRes = await request(app).post('/api/admin/brokers').set(auth()).send({
      name: 'TB상세CSV', phone: '010-7878-8989', brokerType: 'business', taxId: '111-22-33333',
      startDate: '2025-01-01', endDate: '2099-12-31', initialRate: 0.4,
    });
    sharedBrokerId = createRes.body.data.brokerId;
    createdBrokerIds.push(sharedBrokerId);

    const { user: host } = await createHost(); createdUserIds.push(host.id);
    const { room } = await createRoom(host.id); createdRoomIds.push(room.id);
    await request(app).post(`/api/admin/brokers/${sharedBrokerId}/hosts`).set(auth()).send({ hostId: host.id });

    const { settlement } = await paidContractFor(host, room);
    const month = String(settlement.expectedDate).slice(0, 7);
    const listRes = await request(app).get(`/api/admin/broker-incentives/monthly?month=${month}`).set(auth());
    sharedPayoutId = listRes.body.data.payouts.find((p) => p.brokerId === sharedBrokerId).payoutId;
  });

  test('상세 조회: 계약 리스트 포함', async () => {
    const res = await request(app).get(`/api/admin/broker-incentives/monthly/${sharedPayoutId}`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data.payout.payoutId).toBe(sharedPayoutId);
    expect(res.body.data.incentives.length).toBe(1);
    expect(res.body.data.incentives[0].brokerType).toBe('business');
  });

  test('CSV 다운로드: payout 별', async () => {
    const res = await request(app).get(`/api/admin/broker-incentives/monthly/${sharedPayoutId}/csv`).set(auth());
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('계약번호');
    expect(res.text).toContain('합계');
  });

  test('CSV 다운로드: 월별', async () => {
    const payout = await BrokerIncentivePayout.findByPk(sharedPayoutId);
    const res = await request(app)
      .get(`/api/admin/broker-incentives/monthly/csv?month=${payout.settlementMonth}`)
      .set(auth());
    expect(res.status).toBe(200);
    expect(res.text).toContain('정산월');
  });
});
