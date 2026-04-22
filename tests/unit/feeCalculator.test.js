/**
 * feeCalculator.test.js
 * 플랫폼 수수료 단일 산출 유틸 단위 테스트
 *
 * 검증 포인트:
 *  - 게스트 9.9% / 호스트 3.3% VAT 포함 요율
 *  - 공급가액 + VAT === total 항등식 (Math.floor 오차 흡수)
 *  - EZ청소 방 vs 일반 방 feeBase 차이
 *  - 할인 반영, 음수 방어
 *  - splitVatFromTotal 역산 정확성 (기존 스냅샷 호환)
 */

'use strict';

const {
  GUEST_FEE_RATE,
  HOST_FEE_RATE,
  VAT_RATE,
  calculateFeeBase,
  calculateGuestFee,
  calculateHostFee,
  splitVatFromTotal,
} = require('../../utils/feeCalculator');

describe('feeCalculator — 상수', () => {
  test('요율 상수가 기대값과 일치', () => {
    expect(GUEST_FEE_RATE).toBe(0.099);
    expect(HOST_FEE_RATE).toBe(0.033);
    expect(VAT_RATE).toBe(0.1);
  });
});

describe('calculateFeeBase', () => {
  test('일반 방: 임대료 + 관리비 + 청소비 - 할인', () => {
    const result = calculateFeeBase({
      rentalFee: 700_000,
      maintenanceFee: 70_000,
      cleaningFee: 30_000,
      discountAmount: 50_000,
      hasEzCleaningService: false,
    });
    expect(result).toBe(750_000); // 700k + 70k + 30k - 50k
  });

  test('EZ청소 방: 청소비를 feeBase에서 제외', () => {
    const general = calculateFeeBase({
      rentalFee: 700_000,
      maintenanceFee: 70_000,
      cleaningFee: 30_000,
      hasEzCleaningService: false,
    });
    const ezClean = calculateFeeBase({
      rentalFee: 700_000,
      maintenanceFee: 70_000,
      cleaningFee: 30_000,
      hasEzCleaningService: true,
    });
    expect(general).toBe(800_000);
    expect(ezClean).toBe(770_000);
    expect(general - ezClean).toBe(30_000);
  });

  test('할인액이 총액을 초과해도 음수가 되지 않음 (0 반환)', () => {
    const result = calculateFeeBase({
      rentalFee: 100_000,
      maintenanceFee: 0,
      cleaningFee: 0,
      discountAmount: 500_000,
    });
    expect(result).toBe(0);
  });

  test('기본값: 모든 항목 0이면 0', () => {
    expect(calculateFeeBase({})).toBe(0);
  });

  test('discountAmount 미지정 시 0으로 취급', () => {
    const result = calculateFeeBase({
      rentalFee: 500_000,
      maintenanceFee: 50_000,
      cleaningFee: 20_000,
    });
    expect(result).toBe(570_000);
  });
});

describe('calculateGuestFee (9.9%)', () => {
  test('기본 계산: feeBase=800,000 → total=79,200, supply=72,000, vat=7,200', () => {
    const r = calculateGuestFee(800_000);
    expect(r.total).toBe(79_200);
    expect(r.supply).toBe(72_000);
    expect(r.vat).toBe(7_200);
    expect(r.supply + r.vat).toBe(r.total);
  });

  test('feeBase=0 → 모두 0', () => {
    const r = calculateGuestFee(0);
    expect(r).toEqual({ total: 0, supply: 0, vat: 0 });
  });

  test('음수 feeBase 방어 → 0 반환', () => {
    const r = calculateGuestFee(-100_000);
    expect(r).toEqual({ total: 0, supply: 0, vat: 0 });
  });

  test('Math.floor 오차 흡수: supply + vat === total 항상 성립', () => {
    const bases = [100_000, 123_456, 555_555, 987_654, 1_000_000, 3_141_592, 9_999_999];
    for (const base of bases) {
      const r = calculateGuestFee(base);
      expect(r.supply + r.vat).toBe(r.total);
      expect(r.total).toBe(Math.floor(base * 0.099));
    }
  });

  test('10만원 구간', () => {
    const r = calculateGuestFee(100_000);
    expect(r.total).toBe(9_900);
    expect(r.supply + r.vat).toBe(9_900);
  });

  test('1000만원 구간', () => {
    const r = calculateGuestFee(10_000_000);
    expect(r.total).toBe(990_000);
    expect(r.supply).toBe(900_000);
    expect(r.vat).toBe(90_000);
  });
});

describe('calculateHostFee (3.3%)', () => {
  test('기본 계산: feeBase=800,000 → total=26,400, supply=24,000, vat=2,400', () => {
    const r = calculateHostFee(800_000);
    expect(r.total).toBe(26_400);
    expect(r.supply).toBe(24_000);
    expect(r.vat).toBe(2_400);
    expect(r.supply + r.vat).toBe(r.total);
  });

  test('EZ청소 방 feeBase=770,000 → total=25,410', () => {
    const r = calculateHostFee(770_000);
    expect(r.total).toBe(25_410);
    expect(r.supply + r.vat).toBe(r.total);
  });

  test('Math.floor 오차 흡수 (다양한 금액대)', () => {
    const bases = [50_000, 333_333, 750_000, 1_234_567, 5_000_000];
    for (const base of bases) {
      const r = calculateHostFee(base);
      expect(r.supply + r.vat).toBe(r.total);
      expect(r.total).toBe(Math.floor(base * 0.033));
    }
  });

  test('feeBase=0 → 모두 0', () => {
    expect(calculateHostFee(0)).toEqual({ total: 0, supply: 0, vat: 0 });
  });
});

describe('splitVatFromTotal', () => {
  test('total=11,000 → supply=10,000, vat=1,000', () => {
    const r = splitVatFromTotal(11_000);
    expect(r).toEqual({ total: 11_000, supply: 10_000, vat: 1_000 });
  });

  test('total=79,200 (게스트 9.9% 샘플) → supply=72,000, vat=7,200', () => {
    const r = splitVatFromTotal(79_200);
    expect(r).toEqual({ total: 79_200, supply: 72_000, vat: 7_200 });
  });

  test('total=26,400 (호스트 3.3% 샘플) → supply=24,000, vat=2,400', () => {
    const r = splitVatFromTotal(26_400);
    expect(r).toEqual({ total: 26_400, supply: 24_000, vat: 2_400 });
  });

  test('반올림 오차 흡수: supply + vat === total 항상 성립', () => {
    for (let total = 0; total <= 100_001; total += 997) {
      const r = splitVatFromTotal(total);
      expect(r.supply + r.vat).toBe(r.total);
      expect(r.total).toBe(total);
    }
  });

  test('0 입력 → 모두 0', () => {
    expect(splitVatFromTotal(0)).toEqual({ total: 0, supply: 0, vat: 0 });
  });

  test('음수/undefined 방어 → 0 반환', () => {
    expect(splitVatFromTotal(-500)).toEqual({ total: 0, supply: 0, vat: 0 });
    expect(splitVatFromTotal(undefined)).toEqual({ total: 0, supply: 0, vat: 0 });
  });

  test('calculateGuestFee 결과와 splitVatFromTotal(total) 결과가 동일 (역산 정합성)', () => {
    const bases = [500_000, 800_000, 1_234_567];
    for (const base of bases) {
      const forward = calculateGuestFee(base);
      const reverse = splitVatFromTotal(forward.total);
      expect(reverse).toEqual(forward);
    }
  });

  test('calculateHostFee 결과와 splitVatFromTotal(total) 결과가 동일', () => {
    const bases = [500_000, 800_000, 1_234_567];
    for (const base of bases) {
      const forward = calculateHostFee(base);
      const reverse = splitVatFromTotal(forward.total);
      expect(reverse).toEqual(forward);
    }
  });
});

// ─── 회사 정책: 원 미만 절사(Math.floor) 검증 ────────────────────────
// EZStay 정책: 공급가액 산출도 절사. 세법 관례(round)와 1원 차이 가능.
describe('splitVatFromTotal — 절사 정책', () => {
  test('부동소수점 오차 회피: 26,400 → supply=24,000 (23,999 아님)', () => {
    expect(splitVatFromTotal(26400)).toEqual({ total: 26400, supply: 24000, vat: 2400 });
  });

  test('절사 정책 적용: 1,000,000 → supply=909,090 (round의 909,091 아님)', () => {
    expect(splitVatFromTotal(1_000_000)).toEqual({ total: 1_000_000, supply: 909_090, vat: 90_910 });
  });

  test('절사 정책 적용: 12,345 → supply=11,222 (round의 11,223 아님)', () => {
    expect(splitVatFromTotal(12345)).toEqual({ total: 12345, supply: 11222, vat: 1123 });
  });

  test('합계 재구성 불변식 (100원 ~ 1억원 범위)', () => {
    for (let t = 100; t <= 100_000_000; t = Math.floor(t * 1.7)) {
      const { supply, vat } = splitVatFromTotal(t);
      expect(supply + vat).toBe(t);
      expect(supply).toBeGreaterThanOrEqual(0);
      expect(vat).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('통합 시나리오 (현실 계약 금액대)', () => {
  test('일반 방 14일 (임대 70만 + 관리 7만 + 청소 3만, 할인 0)', () => {
    const feeBase = calculateFeeBase({
      rentalFee: 700_000,
      maintenanceFee: 70_000,
      cleaningFee: 30_000,
      hasEzCleaningService: false,
    });
    const guest = calculateGuestFee(feeBase);
    const host = calculateHostFee(feeBase);

    expect(feeBase).toBe(800_000);
    expect(guest.total).toBe(79_200);
    expect(host.total).toBe(26_400);
  });

  test('EZ청소 방: 동일 금액이어도 호스트 수수료가 일반 방보다 적음', () => {
    const common = { rentalFee: 700_000, maintenanceFee: 70_000, cleaningFee: 30_000 };

    const generalBase = calculateFeeBase({ ...common, hasEzCleaningService: false });
    const ezBase = calculateFeeBase({ ...common, hasEzCleaningService: true });

    const generalHost = calculateHostFee(generalBase);
    const ezHost = calculateHostFee(ezBase);

    expect(generalHost.total).toBeGreaterThan(ezHost.total);
    // 청소비 3만원 × 3.3% = 990원 차이
    expect(generalHost.total - ezHost.total).toBe(990);
  });

  test('할인 적용 시: 할인액만큼 feeBase 감소 → 수수료 감소', () => {
    const baseWithoutDiscount = calculateFeeBase({
      rentalFee: 1_000_000,
      maintenanceFee: 100_000,
      cleaningFee: 50_000,
      discountAmount: 0,
    });
    const baseWithDiscount = calculateFeeBase({
      rentalFee: 1_000_000,
      maintenanceFee: 100_000,
      cleaningFee: 50_000,
      discountAmount: 100_000,
    });

    expect(baseWithoutDiscount).toBe(1_150_000);
    expect(baseWithDiscount).toBe(1_050_000);

    const diff = calculateGuestFee(baseWithoutDiscount).total
               - calculateGuestFee(baseWithDiscount).total;
    expect(diff).toBe(Math.floor(100_000 * 0.099)); // 9,900
  });
});
