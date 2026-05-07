/**
 * moveInGuestPaymentGuard.test.js
 * 입주 준비 서비스 임차인 결제 마감 가드 단위 테스트
 *
 * 검증 포인트 (구현계획 정책 #2):
 *  - "입주일 -5일 KST 23:59:59" 정확히 계산
 *  - 'YYYY-MM-DD' 문자열 / Date 객체 입력 모두 지원
 *  - 마감 직전/직후 boolean 분기
 */

'use strict';

const {
  PAYMENT_DEADLINE_DAYS_BEFORE,
  calculatePaymentDeadline,
  isPayable,
  checkPaymentEligibility
} = require('../../utils/moveInGuestPaymentGuard');

describe('PAYMENT_DEADLINE_DAYS_BEFORE 상수', () => {
  test('5일이어야 한다', () => {
    expect(PAYMENT_DEADLINE_DAYS_BEFORE).toBe(5);
  });
});

describe('calculatePaymentDeadline — 입력 형식', () => {
  // KST 2026-04-10 입주 → 2026-04-05 KST 23:59:59.999 = 2026-04-05 14:59:59.999 UTC
  const expectedUtc = new Date(Date.UTC(2026, 3, 5, 14, 59, 59, 999));

  test("'YYYY-MM-DD' 문자열", () => {
    const d = calculatePaymentDeadline('2026-04-10');
    expect(d.toISOString()).toBe(expectedUtc.toISOString());
  });

  test("'YYYY-MM-DD HH:mm:ss' 문자열도 일자만 파싱", () => {
    const d = calculatePaymentDeadline('2026-04-10 09:00:00');
    expect(d.toISOString()).toBe(expectedUtc.toISOString());
  });

  test('UTC 자정 Date 객체', () => {
    // DATEONLY 컬럼이 Date 객체로 올 때 (UTC 자정으로 나옴)
    const checkIn = new Date(Date.UTC(2026, 3, 10));
    const d = calculatePaymentDeadline(checkIn);
    expect(d.toISOString()).toBe(expectedUtc.toISOString());
  });
});

describe('calculatePaymentDeadline — 경계값', () => {
  test('월 경계: 5월 3일 입주 → 4월 28일 KST 23:59:59.999', () => {
    const d = calculatePaymentDeadline('2026-05-03');
    expect(d.toISOString()).toBe(new Date(Date.UTC(2026, 3, 28, 14, 59, 59, 999)).toISOString());
  });

  test('연 경계: 2027-01-03 입주 → 2026-12-29 KST 23:59:59.999', () => {
    const d = calculatePaymentDeadline('2027-01-03');
    expect(d.toISOString()).toBe(new Date(Date.UTC(2026, 11, 29, 14, 59, 59, 999)).toISOString());
  });

  test('윤년 경계: 2024-03-04 입주 → 2024-02-28 KST 23:59:59.999', () => {
    const d = calculatePaymentDeadline('2024-03-04');
    expect(d.toISOString()).toBe(new Date(Date.UTC(2024, 1, 28, 14, 59, 59, 999)).toISOString());
  });
});

describe('isPayable — 시각 분기', () => {
  test('입주일 6일 전 → 결제 가능', () => {
    // 입주: 2026-04-10
    // now : 2026-04-04 12:00 KST = 2026-04-04 03:00 UTC (마감 < 5일전 23:59:59)
    const now = new Date(Date.UTC(2026, 3, 4, 3, 0, 0));
    expect(isPayable('2026-04-10', now)).toBe(true);
  });

  test('마감 시각 직전 (23:59:58.999 KST) → 결제 가능', () => {
    // 2026-04-05 23:59:58.999 KST = 14:59:58.999 UTC
    const now = new Date(Date.UTC(2026, 3, 5, 14, 59, 58, 999));
    expect(isPayable('2026-04-10', now)).toBe(true);
  });

  test('마감 직후 (다음날 KST 00:00:00.000) → 결제 불가', () => {
    // 2026-04-06 00:00:00 KST = 2026-04-05 15:00:00 UTC
    const now = new Date(Date.UTC(2026, 3, 5, 15, 0, 0, 0));
    expect(isPayable('2026-04-10', now)).toBe(false);
  });

  test('입주일 당일 → 결제 불가', () => {
    const now = new Date(Date.UTC(2026, 3, 10, 0, 0, 0));
    expect(isPayable('2026-04-10', now)).toBe(false);
  });
});

describe('checkPaymentEligibility — 시간 계산', () => {
  test('마감 24시간 전 → hoursRemaining ≈ 23 (보수적)', () => {
    // 마감: 2026-04-05 23:59:59.999 KST
    // now : 2026-04-05 00:00:00     KST = 2026-04-04 15:00:00 UTC
    const now = new Date(Date.UTC(2026, 3, 4, 15, 0, 0));
    const r = checkPaymentEligibility('2026-04-10', now);
    expect(r.payable).toBe(true);
    expect(r.hoursRemaining).toBe(23); // floor(23.99... / 1) = 23
  });

  test('마감 후 → payable=false, hoursRemaining=0', () => {
    const now = new Date(Date.UTC(2026, 3, 5, 15, 0, 0));
    const r = checkPaymentEligibility('2026-04-10', now);
    expect(r.payable).toBe(false);
    expect(r.hoursRemaining).toBe(0);
  });
});

describe('잘못된 입력 방어', () => {
  test('null 입력 → throw', () => {
    expect(() => calculatePaymentDeadline(null)).toThrow();
  });

  test('빈 문자열 → throw', () => {
    expect(() => calculatePaymentDeadline('')).toThrow();
  });

  test('형식 어긋난 문자열 → throw', () => {
    expect(() => calculatePaymentDeadline('2026/04/10')).toThrow();
  });

  test('Invalid Date 객체 → throw', () => {
    expect(() => calculatePaymentDeadline(new Date('invalid'))).toThrow();
  });
});
