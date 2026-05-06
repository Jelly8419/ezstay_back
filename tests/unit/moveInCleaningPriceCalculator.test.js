/**
 * moveInCleaningPriceCalculator.test.js
 * 입주 준비 서비스 청소비 산정 단위 테스트
 *
 * 검증 포인트:
 *  - PRD 8절 가격 구간별 산정 정확성
 *  - 경계값 처리 (10평, 10.1평, 20평 등)
 *  - 잘못된 입력 방어
 */

'use strict';

const {
  calculateCleaningPrice,
  BASE_PRICE,
  STEP_PRICE
} = require('../../utils/moveInCleaningPriceCalculator');

describe('calculateCleaningPrice — 가격 구간', () => {
  test('10평 이하: 50,000원', () => {
    expect(calculateCleaningPrice(5)).toBe(50000);
    expect(calculateCleaningPrice(10)).toBe(50000);
  });

  test('10평 초과 ~ 20평 이하: 70,000원', () => {
    expect(calculateCleaningPrice(10.1)).toBe(70000);
    expect(calculateCleaningPrice(15)).toBe(70000);
    expect(calculateCleaningPrice(20)).toBe(70000);
  });

  test('20평 초과 ~ 30평 이하: 90,000원', () => {
    expect(calculateCleaningPrice(20.5)).toBe(90000);
    expect(calculateCleaningPrice(25)).toBe(90000);
    expect(calculateCleaningPrice(30)).toBe(90000);
  });

  test('30평 초과 ~ 40평 이하: 110,000원', () => {
    expect(calculateCleaningPrice(35)).toBe(110000);
    expect(calculateCleaningPrice(40)).toBe(110000);
  });

  test('100평: 230,000원 (10평 + 9 tier × 2만)', () => {
    expect(calculateCleaningPrice(100)).toBe(50000 + 9 * 20000);
  });
});

describe('calculateCleaningPrice — 상수', () => {
  test('BASE_PRICE = 50000', () => {
    expect(BASE_PRICE).toBe(50000);
  });

  test('STEP_PRICE = 20000', () => {
    expect(STEP_PRICE).toBe(20000);
  });
});

describe('calculateCleaningPrice — 입력 방어', () => {
  test('0 또는 음수는 에러', () => {
    expect(() => calculateCleaningPrice(0)).toThrow();
    expect(() => calculateCleaningPrice(-5)).toThrow();
  });

  test('숫자가 아니면 에러', () => {
    expect(() => calculateCleaningPrice('abc')).toThrow();
    expect(() => calculateCleaningPrice(null)).toThrow();
    expect(() => calculateCleaningPrice(undefined)).toThrow();
    expect(() => calculateCleaningPrice(NaN)).toThrow();
    expect(() => calculateCleaningPrice(Infinity)).toThrow();
  });

  test('문자열 숫자는 허용 (Number 변환)', () => {
    expect(calculateCleaningPrice('15')).toBe(70000);
  });
});
