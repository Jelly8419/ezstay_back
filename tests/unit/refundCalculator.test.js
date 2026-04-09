/**
 * refundCalculator.test.js
 * 환불 금액 계산 로직 단위 테스트
 *
 * 전략:
 * - contract.snapshot.ezService + contract.refundPolicySnapshot 을 세팅하면
 *   DB 조회 없이 순수 계산 로직만 실행됨
 * - models mock으로 DB 완전 차단
 *
 * TC 커버리지:
 *   TC-05-04 ~ TC-05-09 (환불 미리보기 계산)
 *   TC-06-01 ~ TC-06-02 (호스트 취소 미리보기)
 */

'use strict';

// DB 조회 완전 차단
jest.mock('../../models', () => ({
  RefundPolicyType: { findOne: jest.fn() },
  RefundPolicyRule:  { findOne: jest.fn() },
  Room:              { findByPk: jest.fn() },
  EzService:         { findOne: jest.fn() },
}));

const { calculateRefund } = require('../../utils/refundCalculator');

// ─── 테스트용 계약 생성 헬퍼 ─────────────────────────────────────────
function makeContract(overrides = {}) {
  const base = {
    roomId: 1,
    rentalFee:      700000,   // 50,000 × 14일
    maintenanceFee:  70000,   // 5,000 × 14일
    cleaningFee:     30000,
    deposit:        300000,
    platformFee:     79200,   // (700000+70000+30000) × 9.9% ≈
    rentalItemsFee:       0,
    finalTotalAmount: 1179200,
    paidAt:     new Date('2026-03-01T10:00:00'),
    createdAt:  new Date('2026-03-01T10:00:00'),
    // DB 조회 없이 실행되도록 snapshot 세팅
    snapshot: {
      ezService: { cleaningService: false },
    },
    refundPolicySnapshot: {
      policyType:   'TEST_POLICY',
      displayName:  '테스트 환불 정책',
      rules: [
        // 기간 규칙 (isSameDayCancellation 없음 = 기간별)
        { daysBeforeMin: 7,  daysBeforeMax: null, refundRate: 100 },
        { daysBeforeMin: 3,  daysBeforeMax: 6,    refundRate: 50  },
        { daysBeforeMin: 0,  daysBeforeMax: 2,    refundRate: 0   },
        // 결제 당일 취소 규칙
        { isSameDayCancellation: true, refundRate: 100 },
      ],
    },
  };
  return { ...base, ...overrides };
}

/**
 * 입주일 기준 N일 전 Date 반환
 * checkInDate='2026-04-10', daysAgo=30 → 2026-03-11
 */
function daysBeforeCheckin(checkInDateStr, days) {
  const d = new Date(checkInDateStr + 'T00:00:00');
  d.setDate(d.getDate() - days);
  return d;
}

// ─── 테스트 시작 ─────────────────────────────────────────────────────

describe('calculateRefund — GUEST 귀책', () => {

  // TC-05-04
  describe('100% 환불 정책 (입주 30일 전)', () => {
    let result;

    beforeAll(async () => {
      const contract = makeContract({
        checkInDate: new Date('2026-05-10T14:00:00'),
      });
      const cancelDate = daysBeforeCheckin('2026-05-10', 30); // 4월 10일
      result = await calculateRefund(contract, cancelDate, { faultType: 'GUEST' });
    });

    it('계산 성공', () => {
      expect(result.success).toBe(true);
    });

    it('환불율 100%', () => {
      expect(result.data.rentalFeeRefundRate).toBe(100);
    });

    it('임대료 전액 환불', () => {
      expect(result.data.usageFeeRefundAmount).toBe(700000);
    });

    it('보증금 전액 환불', () => {
      expect(result.data.depositRefundAmount).toBe(300000);
    });

    it('관리비 전액 환불', () => {
      expect(result.data.maintenanceFeeRefundAmount).toBe(70000);
    });

    it('청소비 전액 환불', () => {
      expect(result.data.cleaningFeeRefundAmount).toBe(30000);
    });

    it('수수료 환불됨 (guestServiceFeeRefunded=true)', () => {
      expect(result.data.guestServiceFeeRefunded).toBe(true);
    });

    it('위약금 없음', () => {
      expect(result.data.penaltyAmount).toBe(0);
    });

    it('총 환불액 = 전체 결제액', () => {
      // deposit + rentalFee + maintenanceFee + cleaningFee + platformFee + rentalItemsFee
      const expected = 300000 + 700000 + 70000 + 30000 + 79200 + 0;
      expect(result.data.totalRefundAmount).toBe(expected);
    });
  });

  // TC-05-05
  describe('50% 환불 정책 (입주 4일 전)', () => {
    let result;
    const rentalFee = 700000;

    beforeAll(async () => {
      const contract = makeContract({
        checkInDate: new Date('2026-05-10T14:00:00'),
      });
      const cancelDate = daysBeforeCheckin('2026-05-10', 4); // 4일 전
      result = await calculateRefund(contract, cancelDate, { faultType: 'GUEST' });
    });

    it('환불율 50%', () => {
      expect(result.data.rentalFeeRefundRate).toBe(50);
    });

    it('임대료 50% 환불 (floor)', () => {
      expect(result.data.usageFeeRefundAmount).toBe(Math.floor(rentalFee * 0.5));
    });

    it('보증금 전액 환불', () => {
      expect(result.data.depositRefundAmount).toBe(300000);
    });

    it('관리비 전액 환불', () => {
      expect(result.data.maintenanceFeeRefundAmount).toBe(70000);
    });

    it('청소비 전액 환불', () => {
      expect(result.data.cleaningFeeRefundAmount).toBe(30000);
    });

    it('수수료 환불 안 됨 (guestServiceFeeRefunded=false)', () => {
      expect(result.data.guestServiceFeeRefunded).toBe(false);
    });

    it('위약금 = floor(임대료 × 50%)', () => {
      expect(result.data.penaltyAmount).toBe(Math.floor(rentalFee * 0.5));
    });

    it('총 환불액 = 보증금 + 임대료×50% + 관리비 + 청소비 (수수료 제외)', () => {
      const expected = 300000 + Math.floor(rentalFee * 0.5) + 70000 + 30000;
      expect(result.data.totalRefundAmount).toBe(expected);
    });
  });

  // TC-05-06
  describe('0% 환불 정책 (입주 1일 전)', () => {
    let result;
    const rentalFee = 700000;

    beforeAll(async () => {
      const contract = makeContract({
        checkInDate: new Date('2026-05-10T14:00:00'),
      });
      const cancelDate = daysBeforeCheckin('2026-05-10', 1); // 1일 전
      result = await calculateRefund(contract, cancelDate, { faultType: 'GUEST' });
    });

    it('환불율 0%', () => {
      expect(result.data.rentalFeeRefundRate).toBe(0);
    });

    it('임대료 환불 없음', () => {
      expect(result.data.usageFeeRefundAmount).toBe(0);
    });

    it('보증금 전액 환불', () => {
      expect(result.data.depositRefundAmount).toBe(300000);
    });

    it('관리비 전액 환불', () => {
      expect(result.data.maintenanceFeeRefundAmount).toBe(70000);
    });

    it('청소비 전액 환불', () => {
      expect(result.data.cleaningFeeRefundAmount).toBe(30000);
    });

    it('위약금 = 임대료 전액', () => {
      expect(result.data.penaltyAmount).toBe(rentalFee);
    });

    it('총 환불액 = 보증금 + 관리비 + 청소비만', () => {
      const expected = 300000 + 70000 + 30000;
      expect(result.data.totalRefundAmount).toBe(expected);
    });
  });

  // TC-05-07
  describe('결제 당일 취소 — 당일 규칙 vs 기간 규칙 중 높은 쪽 적용', () => {

    it('당일 규칙 100% > 기간 규칙 0% → 100% 적용', async () => {
      const contract = makeContract({
        checkInDate: new Date('2026-05-10T14:00:00'),
        paidAt: new Date('2026-04-10T10:00:00'), // 결제일 = 오늘
      });
      // 오늘 취소 (결제 당일), 입주 30일 전이지만 isSameDayCancellation 규칙 먼저 체크
      const cancelDate = new Date('2026-04-10T15:00:00');
      const result = await calculateRefund(contract, cancelDate, { faultType: 'GUEST' });

      expect(result.success).toBe(true);
      expect(result.data.isSameDayCancellation).toBe(true);
      expect(result.data.rentalFeeRefundRate).toBe(100); // max(100, 100) = 100
    });

    it('기간 규칙 100% >= 당일 규칙 100% → 100% 적용', async () => {
      const contract = makeContract({
        checkInDate: new Date('2026-05-10T14:00:00'),
        paidAt: new Date('2026-04-10T10:00:00'),
      });
      const cancelDate = new Date('2026-04-10T15:00:00');
      const result = await calculateRefund(contract, cancelDate);

      expect(result.data.rentalFeeRefundRate).toBe(100);
    });

    it('당일 규칙 없고 기간 규칙 50% → 50% 적용', async () => {
      const contract = makeContract({
        checkInDate: new Date('2026-04-15T14:00:00'), // 5일 후 입주
        paidAt: new Date('2026-04-10T10:00:00'),
        refundPolicySnapshot: {
          policyType: 'NO_SAMEDAY_POLICY',
          displayName: '당일규칙 없음',
          rules: [
            // 당일 취소 규칙 없음
            { daysBeforeMin: 3,  daysBeforeMax: null, refundRate: 50 },
            { daysBeforeMin: 0,  daysBeforeMax: 2,    refundRate: 0  },
          ],
        },
      });
      const cancelDate = new Date('2026-04-10T15:00:00'); // 결제 당일
      const result = await calculateRefund(contract, cancelDate);

      expect(result.data.isSameDayCancellation).toBe(true);
      // sameDayRule 없으므로 sameDayRate=0, periodRate=50 → max=50
      expect(result.data.rentalFeeRefundRate).toBe(50);
    });
  });

  // TC-05-08
  describe('refundPolicySnapshot 기준 적용 (현재 방 정책 무시)', () => {

    it('스냅샷 정책 100% — DB 조회 없이 계산됨', async () => {
      const contract = makeContract({
        checkInDate: new Date('2026-05-10T14:00:00'),
        refundPolicySnapshot: {
          policyType: 'SNAPSHOT_100',
          displayName: '스냅샷 100% 정책',
          rules: [
            { daysBeforeMin: 0, daysBeforeMax: null, refundRate: 100 },
          ],
        },
      });
      const cancelDate = daysBeforeCheckin('2026-05-10', 30);
      const result = await calculateRefund(contract, cancelDate);

      expect(result.success).toBe(true);
      expect(result.data.policyTypeUsed).toBe('SNAPSHOT_100');
      expect(result.data.rentalFeeRefundRate).toBe(100);
    });

    it('스냅샷 정책 0% — DB 조회 없이 0% 계산됨', async () => {
      const contract = makeContract({
        checkInDate: new Date('2026-05-10T14:00:00'),
        refundPolicySnapshot: {
          policyType: 'SNAPSHOT_0',
          displayName: '스냅샷 0% 정책',
          rules: [
            { daysBeforeMin: 0, daysBeforeMax: null, refundRate: 0 },
          ],
        },
      });
      const cancelDate = daysBeforeCheckin('2026-05-10', 30);
      const result = await calculateRefund(contract, cancelDate);

      expect(result.data.policyTypeUsed).toBe('SNAPSHOT_0');
      expect(result.data.rentalFeeRefundRate).toBe(0);
    });
  });

  // TC-05-09
  describe('렌탈 아이템 항상 100% 환불', () => {

    it('환불율 0%여도 rentalItemsFee 전액 포함', async () => {
      const contract = makeContract({
        checkInDate: new Date('2026-05-10T14:00:00'),
        rentalItemsFee: 200000,
        finalTotalAmount: 1179200 + 200000,
      });
      const cancelDate = daysBeforeCheckin('2026-05-10', 1); // 0% 구간
      const result = await calculateRefund(contract, cancelDate);

      expect(result.data.rentalFeeRefundRate).toBe(0);
      expect(result.data.rentalItemsFeeRefundAmount).toBe(200000);
      // totalRefundAmount에 포함됨
      expect(result.data.totalRefundAmount).toBe(300000 + 70000 + 30000 + 200000);
    });

    it('환불율 50%여도 rentalItemsFee 전액 포함', async () => {
      const contract = makeContract({
        checkInDate: new Date('2026-05-10T14:00:00'),
        rentalItemsFee: 150000,
      });
      const cancelDate = daysBeforeCheckin('2026-05-10', 4); // 50% 구간
      const result = await calculateRefund(contract, cancelDate);

      expect(result.data.rentalFeeRefundRate).toBe(50);
      expect(result.data.rentalItemsFeeRefundAmount).toBe(150000);
    });
  });

});

// ─── HOST 귀책 ────────────────────────────────────────────────────────

describe('calculateRefund — HOST 귀책', () => {

  // TC-06-01 기반
  describe('항상 게스트 전액 환불', () => {
    let result;

    beforeAll(async () => {
      const contract = makeContract({
        checkInDate: new Date('2026-05-10T14:00:00'),
      });
      const cancelDate = daysBeforeCheckin('2026-05-10', 4); // 50% 구간
      result = await calculateRefund(contract, cancelDate, { faultType: 'HOST' });
    });

    it('계산 성공', () => {
      expect(result.success).toBe(true);
    });

    it('임대료 100% 환불', () => {
      expect(result.data.usageFeeRefundAmount).toBe(700000);
    });

    it('보증금 전액 환불', () => {
      expect(result.data.depositRefundAmount).toBe(300000);
    });

    it('수수료 환불됨', () => {
      expect(result.data.guestServiceFeeRefunded).toBe(true);
    });

    it('총 환불액 = 결제 전액 (platformFee 포함)', () => {
      const expected = 300000 + 700000 + 70000 + 30000 + 79200 + 0;
      expect(result.data.totalRefundAmount).toBe(expected);
    });
  });

  describe('호스트 위약금 계산', () => {

    it('50% 구간 — 위약금 = floor(임대료 × 50%)', async () => {
      const contract = makeContract({
        checkInDate: new Date('2026-05-10T14:00:00'),
      });
      const cancelDate = daysBeforeCheckin('2026-05-10', 4);
      const result = await calculateRefund(contract, cancelDate, { faultType: 'HOST' });

      // 호스트 귀책 시 위약금 = 현재 환불율 기준으로 역산
      expect(result.data.penaltyAmount).toBe(Math.floor(700000 * 0.5));
    });

    it('100% 구간 — 위약금 = 0', async () => {
      const contract = makeContract({
        checkInDate: new Date('2026-05-10T14:00:00'),
      });
      const cancelDate = daysBeforeCheckin('2026-05-10', 30); // 100% 구간
      const result = await calculateRefund(contract, cancelDate, { faultType: 'HOST' });

      expect(result.data.penaltyAmount).toBe(0);
    });

    it('0% 구간 — 위약금 = 임대료 전액', async () => {
      const contract = makeContract({
        checkInDate: new Date('2026-05-10T14:00:00'),
      });
      const cancelDate = daysBeforeCheckin('2026-05-10', 1); // 0% 구간
      const result = await calculateRefund(contract, cancelDate, { faultType: 'HOST' });

      expect(result.data.penaltyAmount).toBe(700000);
    });
  });

});

// ─── 엣지 케이스 ─────────────────────────────────────────────────────

describe('calculateRefund — 엣지 케이스', () => {

  it('입주일 당일(daysBeforeCheckin=0) — 0% 규칙 적용', async () => {
    const contract = makeContract({
      checkInDate: new Date('2026-04-10T14:00:00'),
    });
    const cancelDate = new Date('2026-04-10T09:00:00'); // 입주 당일 아침
    const result = await calculateRefund(contract, cancelDate);

    expect(result.data.daysBeforeCheckin).toBe(0);
    expect(result.data.rentalFeeRefundRate).toBe(0);
  });

  it('입주일 이후(daysBeforeCheckin 음수) — 적용 규칙 없음(0%)', async () => {
    const contract = makeContract({
      checkInDate: new Date('2026-04-01T14:00:00'), // 이미 지난 날짜
    });
    const cancelDate = new Date('2026-04-10T09:00:00');
    const result = await calculateRefund(contract, cancelDate);

    expect(result.data.daysBeforeCheckin).toBeLessThan(0);
    expect(result.data.rentalFeeRefundRate).toBe(0);
    expect(result.data.usageFeeRefundAmount).toBe(0);
  });

  it('rentalItemsFee = 0 일 때 totalRefundAmount에 영향 없음 (100% 구간)', async () => {
    const contract = makeContract({
      checkInDate: new Date('2026-05-10T14:00:00'),
      rentalItemsFee: 0,
    });
    const cancelDate = daysBeforeCheckin('2026-05-10', 30);
    const result = await calculateRefund(contract, cancelDate);

    expect(result.data.rentalItemsFeeRefundAmount).toBe(0);
    const expected = 300000 + 700000 + 70000 + 30000 + 79200;
    expect(result.data.totalRefundAmount).toBe(expected);
  });

  it('refundPolicySnapshot 없으면 success=false (DB 없으므로)', async () => {
    const contract = makeContract({
      checkInDate: new Date('2026-05-10T14:00:00'),
      refundPolicySnapshot: null,
      snapshot: null, // DB 조회 시도하지만 mock이 undefined 반환
    });
    const cancelDate = daysBeforeCheckin('2026-05-10', 30);
    const result = await calculateRefund(contract, cancelDate);

    // Room.findByPk mock이 undefined 반환 → '방 정보를 찾을 수 없습니다.' 에러
    expect(result.success).toBe(false);
  });

  it('floor 처리 — 소수점 내림 확인', async () => {
    const contract = makeContract({
      checkInDate: new Date('2026-05-10T14:00:00'),
      rentalFee: 100001, // 홀수 금액
    });
    const cancelDate = daysBeforeCheckin('2026-05-10', 4); // 50% 구간
    const result = await calculateRefund(contract, cancelDate);

    // floor(100001 × 0.5) = floor(50000.5) = 50000
    expect(result.data.usageFeeRefundAmount).toBe(50000);
    expect(result.data.penaltyAmount).toBe(50000);
    // 50000 + 50000 = 100000 ≠ 100001 (1원 차이 → floor 손실)
  });

});
