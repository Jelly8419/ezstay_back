/**
 * brokerResolver.test.js — 통합 테스트 (DB 조회)
 *
 * services/brokerResolver.resolveBrokerForHostAt 의 3단 판정 로직 검증:
 *   1) BrokerHostMapping (시간 구간 + host_id)
 *   2) Broker (status=active + 활동기간)
 *   3) BrokerRate (시간 구간)
 *
 * 통과 케이스: {brokerId, rate, brokerType} 반환
 * 실패 케이스: null 반환 (각 단계에서 하나라도 실패 시)
 */

'use strict';

require('../../setup/setup');

const { Broker, BrokerRate, BrokerHostMapping } = require('../../../models');
const { createHost, cleanupUsers } = require('../../setup/factories/userFactory');
const { resolveBrokerForHostAt } = require('../../../services/brokerResolver');

// 생성한 데이터 정리용
const createdBrokerIds = [];
const createdHostIds = [];

async function createBroker(overrides = {}) {
  const broker = await Broker.create({
    name: overrides.name || `TestBroker_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    phone: overrides.phone || '010-1234-5678',
    brokerType: overrides.brokerType || 'individual',
    taxId: overrides.taxId || null,
    startDate: overrides.startDate || '2026-01-01',
    endDate: overrides.endDate || '2026-12-31',
    status: overrides.status || 'active',
  });
  createdBrokerIds.push(broker.id);
  return broker;
}

async function createRate(brokerId, rate, effectiveFrom, effectiveTo = null) {
  return BrokerRate.create({
    brokerId, rate, effectiveFrom, effectiveTo,
  });
}

async function createMapping(brokerId, hostId, startDate, endDate = null) {
  return BrokerHostMapping.create({
    brokerId, hostId, startDate, endDate,
  });
}

// 2026-04-15 10:00 KST 를 표준 '판정 시점' 으로 사용
const APPROVED_AT = new Date('2026-04-15T10:00:00+09:00');

afterAll(async () => {
  // 역순 정리: mapping/rate/incentive → broker → user
  await BrokerHostMapping.destroy({ where: { brokerId: createdBrokerIds } }).catch(() => {});
  await BrokerRate.destroy({ where: { brokerId: createdBrokerIds } }).catch(() => {});
  await Broker.destroy({ where: { id: createdBrokerIds } }).catch(() => {});
  await cleanupUsers(createdHostIds).catch(() => {});
});

describe('resolveBrokerForHostAt — 입력 가드', () => {
  test('hostId 없음 → null', async () => {
    expect(await resolveBrokerForHostAt({ approvedAt: APPROVED_AT })).toBeNull();
  });

  test('approvedAt 없음 → null', async () => {
    expect(await resolveBrokerForHostAt({ hostId: 1 })).toBeNull();
  });

  test('approvedAt 이 Invalid Date → null', async () => {
    expect(await resolveBrokerForHostAt({ hostId: 1, approvedAt: new Date('nope') })).toBeNull();
  });
});

describe('resolveBrokerForHostAt — 정상 플로우', () => {
  test('매핑+활동중 broker+유효 요율 → individual 결과 반환', async () => {
    const { user: host } = await createHost();
    createdHostIds.push(host.id);

    const broker = await createBroker({ brokerType: 'individual' });
    await createRate(broker.id, 0.5, '2026-01-01T00:00:00+09:00', null);
    await createMapping(broker.id, host.id, '2026-01-01T00:00:00+09:00', null);

    const r = await resolveBrokerForHostAt({ hostId: host.id, approvedAt: APPROVED_AT });
    expect(r).not.toBeNull();
    expect(r.brokerId).toBe(broker.id);
    expect(r.rate).toBe(0.5);
    expect(r.brokerType).toBe('individual');
  });

  test('business 타입 도 정상 반환', async () => {
    const { user: host } = await createHost();
    createdHostIds.push(host.id);

    const broker = await createBroker({ brokerType: 'business', taxId: '123-45-67890' });
    await createRate(broker.id, 0.3, '2026-01-01T00:00:00+09:00');
    await createMapping(broker.id, host.id, '2026-01-01T00:00:00+09:00');

    const r = await resolveBrokerForHostAt({ hostId: host.id, approvedAt: APPROVED_AT });
    expect(r.brokerType).toBe('business');
    expect(r.rate).toBe(0.3);
  });

  test('여러 요율 중 approvedAt 시점 유효한 요율만 선택 (과거 요율 무시)', async () => {
    const { user: host } = await createHost();
    createdHostIds.push(host.id);

    const broker = await createBroker();
    // 과거 요율 (2026-03 까지) 50%
    await createRate(broker.id, 0.5, '2026-01-01T00:00:00+09:00', '2026-04-01T00:00:00+09:00');
    // 현재 요율 (2026-04 부터) 30%
    await createRate(broker.id, 0.3, '2026-04-01T00:00:00+09:00', null);
    await createMapping(broker.id, host.id, '2026-01-01T00:00:00+09:00');

    // APPROVED_AT = 2026-04-15 → 30% 선택
    const r = await resolveBrokerForHostAt({ hostId: host.id, approvedAt: APPROVED_AT });
    expect(r.rate).toBe(0.3);

    // 과거 시점 조회 → 50% 선택
    const past = await resolveBrokerForHostAt({
      hostId: host.id,
      approvedAt: new Date('2026-02-15T10:00:00+09:00'),
    });
    expect(past.rate).toBe(0.5);
  });
});

describe('resolveBrokerForHostAt — 미귀속 케이스', () => {
  test('매핑 없음 → null', async () => {
    const { user: host } = await createHost();
    createdHostIds.push(host.id);

    const r = await resolveBrokerForHostAt({ hostId: host.id, approvedAt: APPROVED_AT });
    expect(r).toBeNull();
  });

  test('매핑이 approvedAt 이후에 시작 → null', async () => {
    const { user: host } = await createHost();
    createdHostIds.push(host.id);

    const broker = await createBroker();
    await createRate(broker.id, 0.5, '2026-01-01T00:00:00+09:00');
    // 2026-05-01 시작 → APPROVED_AT(2026-04-15) 시점엔 아직 미귀속
    await createMapping(broker.id, host.id, '2026-05-01T00:00:00+09:00');

    const r = await resolveBrokerForHostAt({ hostId: host.id, approvedAt: APPROVED_AT });
    expect(r).toBeNull();
  });

  test('매핑이 approvedAt 이전에 종료 → null', async () => {
    const { user: host } = await createHost();
    createdHostIds.push(host.id);

    const broker = await createBroker();
    await createRate(broker.id, 0.5, '2026-01-01T00:00:00+09:00');
    // 2026-03-31 종료 → APPROVED_AT 시점엔 이미 종료
    await createMapping(
      broker.id, host.id,
      '2026-01-01T00:00:00+09:00',
      '2026-03-31T23:59:59+09:00'
    );

    const r = await resolveBrokerForHostAt({ hostId: host.id, approvedAt: APPROVED_AT });
    expect(r).toBeNull();
  });

  test('broker 가 inactive → null', async () => {
    const { user: host } = await createHost();
    createdHostIds.push(host.id);

    const broker = await createBroker({ status: 'inactive' });
    await createRate(broker.id, 0.5, '2026-01-01T00:00:00+09:00');
    await createMapping(broker.id, host.id, '2026-01-01T00:00:00+09:00');

    const r = await resolveBrokerForHostAt({ hostId: host.id, approvedAt: APPROVED_AT });
    expect(r).toBeNull();
  });

  test('broker 활동 종료일이 approvedAt 이전 → null (Q2 시나리오)', async () => {
    // 2025-04~07 활동 종료 + 2026-09 결제 → 미귀속 처리
    const { user: host } = await createHost();
    createdHostIds.push(host.id);

    const broker = await createBroker({
      startDate: '2025-04-23',
      endDate: '2025-07-23',
    });
    await createRate(broker.id, 0.5, '2025-04-23T00:00:00+09:00');
    await createMapping(broker.id, host.id, '2025-04-23T00:00:00+09:00');

    const r = await resolveBrokerForHostAt({
      hostId: host.id,
      approvedAt: new Date('2026-09-10T10:00:00+09:00'),
    });
    expect(r).toBeNull();
  });

  test('broker 활동 시작일이 approvedAt 이후 → null', async () => {
    const { user: host } = await createHost();
    createdHostIds.push(host.id);

    const broker = await createBroker({
      startDate: '2026-06-01',
      endDate: '2027-06-01',
    });
    await createRate(broker.id, 0.5, '2026-06-01T00:00:00+09:00');
    await createMapping(broker.id, host.id, '2026-06-01T00:00:00+09:00');

    const r = await resolveBrokerForHostAt({ hostId: host.id, approvedAt: APPROVED_AT });
    expect(r).toBeNull();
  });

  test('요율 row 가 전혀 없음 → null (설정 누락)', async () => {
    const { user: host } = await createHost();
    createdHostIds.push(host.id);

    const broker = await createBroker();
    // 요율 없이 매핑만
    await createMapping(broker.id, host.id, '2026-01-01T00:00:00+09:00');

    const r = await resolveBrokerForHostAt({ hostId: host.id, approvedAt: APPROVED_AT });
    expect(r).toBeNull();
  });

  test('요율 = 0 → null (의미상 미귀속으로 취급)', async () => {
    const { user: host } = await createHost();
    createdHostIds.push(host.id);

    const broker = await createBroker();
    await createRate(broker.id, 0.0, '2026-01-01T00:00:00+09:00');
    await createMapping(broker.id, host.id, '2026-01-01T00:00:00+09:00');

    const r = await resolveBrokerForHostAt({ hostId: host.id, approvedAt: APPROVED_AT });
    expect(r).toBeNull();
  });

  test('요율 구간이 approvedAt 전에 종료 (매핑은 유효) → null', async () => {
    const { user: host } = await createHost();
    createdHostIds.push(host.id);

    const broker = await createBroker();
    // 요율 구간은 2026-01-01 ~ 2026-04-01 로 제한
    await createRate(
      broker.id, 0.5,
      '2026-01-01T00:00:00+09:00',
      '2026-04-01T00:00:00+09:00'
    );
    await createMapping(broker.id, host.id, '2026-01-01T00:00:00+09:00');

    // APPROVED_AT = 2026-04-15 → 요율 없음
    const r = await resolveBrokerForHostAt({ hostId: host.id, approvedAt: APPROVED_AT });
    expect(r).toBeNull();
  });
});

describe('resolveBrokerForHostAt — 호스트 이관', () => {
  test('호스트가 중개인 A → B 로 이관, 결제시점이 이관 후면 B 반환', async () => {
    const { user: host } = await createHost();
    createdHostIds.push(host.id);

    const brokerA = await createBroker({ name: 'BrokerA' });
    const brokerB = await createBroker({ name: 'BrokerB' });
    await createRate(brokerA.id, 0.5, '2026-01-01T00:00:00+09:00');
    await createRate(brokerB.id, 0.2, '2026-01-01T00:00:00+09:00');

    // A 매핑: 2026-01-01 ~ 2026-04-01 종료
    await createMapping(
      brokerA.id, host.id,
      '2026-01-01T00:00:00+09:00',
      '2026-04-01T00:00:00+09:00'
    );
    // B 매핑: 2026-04-01 이후 현재 유효
    await createMapping(brokerB.id, host.id, '2026-04-01T00:00:00+09:00');

    // APPROVED_AT = 2026-04-15 → B 선택
    const r = await resolveBrokerForHostAt({ hostId: host.id, approvedAt: APPROVED_AT });
    expect(r.brokerId).toBe(brokerB.id);
    expect(r.rate).toBe(0.2);

    // 과거 시점 조회 → A 선택
    const past = await resolveBrokerForHostAt({
      hostId: host.id,
      approvedAt: new Date('2026-02-15T10:00:00+09:00'),
    });
    expect(past.brokerId).toBe(brokerA.id);
  });
});
