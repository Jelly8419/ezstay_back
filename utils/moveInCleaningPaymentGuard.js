'use strict';

/**
 * 입주 준비 서비스 — 호스트 청소 결제 마감 가드
 *
 * 정책 (2026-05-22 PRD 변경: D-2 → D-3):
 *   "입주일(check_in_date) 의 D-3 일 KST 23:59:59.999" 까지만 청소 결제 가능.
 *   예) 입주일 2026-05-27 → D-3 = 2026-05-24 → 2026-05-24 23:59:59.999 KST 가 마감.
 *       2026-05-25 00:00 KST 부터 결제 불가.
 *
 * 게스트 옵션 결제(D-5) 와 정책 다르므로 별도 모듈로 분리.
 * 게스트 옵션은 utils/moveInGuestPaymentGuard.js 참조.
 */

const PAYMENT_DEADLINE_DAYS_BEFORE = 3;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 'YYYY-MM-DD' 문자열 또는 Date 객체 → KST 자정의 UTC Date 변환.
 * (utils/moveInGuestPaymentGuard.js 와 동일 패턴)
 */
function parseCheckInToKstMidnight(input) {
  if (input == null) {
    throw new TypeError('checkInDate is required');
  }

  if (typeof input === 'string') {
    if (!/^\d{4}-\d{2}-\d{2}/.test(input)) {
      throw new TypeError(`Invalid date string: ${input}`);
    }
    const [y, m, d] = input.slice(0, 10).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d) - KST_OFFSET_MS);
  }

  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) {
      throw new TypeError('Invalid Date object');
    }
    const y = input.getUTCFullYear();
    const m = input.getUTCMonth();
    const d = input.getUTCDate();
    return new Date(Date.UTC(y, m, d) - KST_OFFSET_MS);
  }

  throw new TypeError(`Unsupported type: ${typeof input}`);
}

/**
 * 청소 결제 마감 시각 계산 — D-3 KST 23:59:59.999.
 */
function calculateCleaningPaymentDeadline(checkInDate) {
  const kstMidnight = parseCheckInToKstMidnight(checkInDate);
  const minusN = new Date(kstMidnight.getTime() - PAYMENT_DEADLINE_DAYS_BEFORE * 24 * 60 * 60 * 1000);
  // KST 자정 그 자체 → +24h - 1ms 가 같은 날 KST 23:59:59.999
  return new Date(minusN.getTime() + 24 * 60 * 60 * 1000 - 1);
}

function isCleaningPayable(checkInDate, now = new Date()) {
  const deadline = calculateCleaningPaymentDeadline(checkInDate);
  return now.getTime() <= deadline.getTime();
}

function checkCleaningPaymentEligibility(checkInDate, now = new Date()) {
  const deadline = calculateCleaningPaymentDeadline(checkInDate);
  const diffMs = deadline.getTime() - now.getTime();
  return {
    payable: diffMs >= 0,
    deadline,
    hoursRemaining: Math.max(0, Math.floor(diffMs / (60 * 60 * 1000)))
  };
}

module.exports = {
  PAYMENT_DEADLINE_DAYS_BEFORE,
  parseCheckInToKstMidnight,
  calculateCleaningPaymentDeadline,
  isCleaningPayable,
  checkCleaningPaymentEligibility
};
