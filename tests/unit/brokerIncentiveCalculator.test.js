/**
 * brokerIncentiveCalculator.test.js
 * 중개인 인센티브 산출 유틸 단위 테스트
 *
 * 검증 포인트:
 *  - 지급 대상액 산출 (절사 정책)
 *  - 개인/사업자 타입별 분기 로직
 *  - 세무 불변식 (gross = withholding + net / supply + vat = gross, net = gross)
 *  - 음수/0/비정상 입력 방어
 *  - 알려진 실제 금액 케이스 수작업 검증
 */

'use strict';

const {
  INDIVIDUAL_WITHHOLDING_RATE,
  calculateGross,
  calculateIndividualPayout,
  calculateBusinessPayout,
  calculateBrokerIncentive,
  verifyInvariant,
} = require('../../utils/brokerIncentiveCalculator');

describe('brokerIncentiveCalculator — 상수', () => {
  test('원천징수율 = 8.8% (소득세 8% + 주민세 0.8%)', () => {
    expect(INDIVIDUAL_WITHHOLDING_RATE).toBe(0.088);
  });
});

describe('calculateGross', () => {
  test('일반 케이스: floor(baseFee × rate)', () => {
    // hostPlatformFee 33,000 × 50% = 16,500
    expect(calculateGross(33_000, 0.5)).toBe(16_500);
  });

  test('절사: 소수 이하 버림', () => {
    // 33,333 × 0.5 = 16,666.5 → 16,666
    expect(calculateGross(33_333, 0.5)).toBe(16_666);
  });

  test('rate = 1.0 (100%) 도 정상 동작', () => {
    expect(calculateGross(33_000, 1.0)).toBe(33_000);
  });

  test('음수 baseFee → 0', () => {
    expect(calculateGross(-10_000, 0.5)).toBe(0);
  });

  test('음수 rate → 0', () => {
    expect(calculateGross(10_000, -0.5)).toBe(0);
  });

  test('null/undefined baseFee → 0', () => {
    expect(calculateGross(null, 0.5)).toBe(0);
    expect(calculateGross(undefined, 0.5)).toBe(0);
  });

  test('rate = 0 → 0', () => {
    expect(calculateGross(100_000, 0)).toBe(0);
  });
});

describe('calculateIndividualPayout (개인 / 기타소득 8.8%)', () => {
  test('16,500원 gross → withholding 1,452 / net 15,048', () => {
    // 16,500 × 0.088 = 1,452
    // net = 16,500 - 1,452 = 15,048
    const r = calculateIndividualPayout(16_500);
    expect(r.gross).toBe(16_500);
    expect(r.withholding).toBe(1_452);
    expect(r.net).toBe(15_048);
    expect(r.supply).toBe(0);
    expect(r.vat).toBe(0);
  });

  test('절사: withholding 소수 이하 버림', () => {
    // 10,000 × 0.088 = 880 (정수)
    // 10,001 × 0.088 = 880.088 → 880
    expect(calculateIndividualPayout(10_001).withholding).toBe(880);
  });

  test('불변식: gross = withholding + net', () => {
    for (const g of [1, 100, 999, 10_000, 16_500, 99_999, 1_234_567]) {
      const r = calculateIndividualPayout(g);
      expect(r.withholding + r.net).toBe(r.gross);
      expect(verifyInvariant(r, 'individual')).toBe(true);
    }
  });

  test('gross = 0 → 모든 필드 0', () => {
    expect(calculateIndividualPayout(0)).toEqual({
      gross: 0, withholding: 0, supply: 0, vat: 0, net: 0,
    });
  });

  test('음수 gross → 0 처리', () => {
    expect(calculateIndividualPayout(-500).gross).toBe(0);
    expect(calculateIndividualPayout(-500).net).toBe(0);
  });
});

describe('calculateBusinessPayout (사업자 / VAT 분리)', () => {
  test('16,500원 gross → supply 15,000 / vat 1,500 / net = gross', () => {
    // supply = floor(16,500 × 10 / 11) = floor(15,000) = 15,000
    // vat = 16,500 - 15,000 = 1,500
    const r = calculateBusinessPayout(16_500);
    expect(r.gross).toBe(16_500);
    expect(r.supply).toBe(15_000);
    expect(r.vat).toBe(1_500);
    expect(r.net).toBe(16_500);
    expect(r.withholding).toBe(0);
  });

  test('부동소수점 트랩 케이스 (26,400)', () => {
    // 26,400 × 10 / 11 = 24,000 (정수)
    // Math.floor(26,400 / 1.1) 구현이면 23,999 로 나오므로 이 테스트가 리그레션 가드
    const r = calculateBusinessPayout(26_400);
    expect(r.supply).toBe(24_000);
    expect(r.vat).toBe(2_400);
  });

  test('불변식: gross = supply + vat, net = gross', () => {
    for (const g of [1, 100, 999, 10_000, 16_500, 26_400, 99_999, 1_234_567]) {
      const r = calculateBusinessPayout(g);
      expect(r.supply + r.vat).toBe(r.gross);
      expect(r.net).toBe(r.gross);
      expect(verifyInvariant(r, 'business')).toBe(true);
    }
  });

  test('gross = 0 → 모든 필드 0', () => {
    expect(calculateBusinessPayout(0)).toEqual({
      gross: 0, withholding: 0, supply: 0, vat: 0, net: 0,
    });
  });
});

describe('calculateBrokerIncentive (통합 진입점)', () => {
  test('individual: baseFee 33,000 × 50% → 개인 분기', () => {
    const r = calculateBrokerIncentive({
      baseFee: 33_000,
      appliedRate: 0.5,
      brokerType: 'individual',
    });
    expect(r.gross).toBe(16_500);
    expect(r.withholding).toBe(1_452);
    expect(r.net).toBe(15_048);
    expect(r.supply).toBe(0);
    expect(r.vat).toBe(0);
  });

  test('business: baseFee 33,000 × 50% → 사업자 분기', () => {
    const r = calculateBrokerIncentive({
      baseFee: 33_000,
      appliedRate: 0.5,
      brokerType: 'business',
    });
    expect(r.gross).toBe(16_500);
    expect(r.supply).toBe(15_000);
    expect(r.vat).toBe(1_500);
    expect(r.net).toBe(16_500);
    expect(r.withholding).toBe(0);
  });

  test('알 수 없는 brokerType → 예외', () => {
    expect(() => calculateBrokerIncentive({
      baseFee: 10_000, appliedRate: 0.5, brokerType: 'unknown',
    })).toThrow(/Invalid brokerType/);
  });

  test('brokerType 누락 → 예외', () => {
    expect(() => calculateBrokerIncentive({
      baseFee: 10_000, appliedRate: 0.5,
    })).toThrow(/Invalid brokerType/);
  });

  test('baseFee = 0 이어도 정상 (미귀속 처리와 구분)', () => {
    const r = calculateBrokerIncentive({
      baseFee: 0, appliedRate: 0.5, brokerType: 'individual',
    });
    expect(r.gross).toBe(0);
    expect(r.net).toBe(0);
  });

  test('실제 시나리오: 임대료 1,000,000 → 호스트수수료 33,000 → 인센티브 30%', () => {
    // 1M × 3.3% = 33,000 (호스트 수수료, feeCalculator 에서 계산됨)
    // × 30% 인센티브
    const indiv = calculateBrokerIncentive({
      baseFee: 33_000, appliedRate: 0.3, brokerType: 'individual',
    });
    // gross = floor(33_000 × 0.3) = 9_900
    // withholding = floor(9_900 × 0.088) = 871
    // net = 9_900 - 871 = 9_029
    expect(indiv).toEqual({
      gross: 9_900, withholding: 871, supply: 0, vat: 0, net: 9_029,
    });

    const biz = calculateBrokerIncentive({
      baseFee: 33_000, appliedRate: 0.3, brokerType: 'business',
    });
    // supply = floor(9_900 × 10 / 11) = 9_000
    // vat = 9_900 - 9_000 = 900
    expect(biz).toEqual({
      gross: 9_900, withholding: 0, supply: 9_000, vat: 900, net: 9_900,
    });
  });
});

describe('verifyInvariant', () => {
  test('정상 individual 결과 → true', () => {
    const r = { gross: 100, withholding: 8, supply: 0, vat: 0, net: 92 };
    expect(verifyInvariant(r, 'individual')).toBe(true);
  });

  test('individual 에 supply/vat 가 0 이 아니면 false (오염 감지)', () => {
    const r = { gross: 100, withholding: 8, supply: 10, vat: 0, net: 92 };
    expect(verifyInvariant(r, 'individual')).toBe(false);
  });

  test('business 에 withholding 이 0 이 아니면 false', () => {
    const r = { gross: 100, withholding: 8, supply: 91, vat: 9, net: 100 };
    expect(verifyInvariant(r, 'business')).toBe(false);
  });

  test('business 에서 net !== gross 면 false', () => {
    const r = { gross: 100, withholding: 0, supply: 91, vat: 9, net: 99 };
    expect(verifyInvariant(r, 'business')).toBe(false);
  });

  test('알 수 없는 타입 → false', () => {
    const r = { gross: 100, withholding: 0, supply: 91, vat: 9, net: 100 };
    expect(verifyInvariant(r, 'xxx')).toBe(false);
  });
});
