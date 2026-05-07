/**
 * 입주 준비 서비스 - 임차인 결제 마감 가드
 *
 * 정책 (구현계획 결정사항 #2):
 *   "입주일(check_in_date) 의 -5일 KST 23:59:59" 까지만 결제/취소 가능.
 *
 * NOTE:
 *   - DB 의 check_in_date 는 DATEONLY → Sequelize 가 'YYYY-MM-DD' 문자열 또는
 *     UTC 자정 Date 객체로 반환. 둘 다 안전하게 KST 자정으로 해석한다.
 *   - 결과는 UTC Date 객체로 반환 (DB 비교/응답 변환은 호출처 책임).
 */

const PAYMENT_DEADLINE_DAYS_BEFORE = 5;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 'YYYY-MM-DD' 문자열 또는 Date 객체 → KST 자정의 UTC Date 변환.
 *
 * @param {string|Date} input
 * @returns {Date} UTC 시각 (KST 0시 0분 0초 의 UTC 표현)
 */
function parseCheckInToKstMidnight(input) {
  if (input == null) {
    throw new TypeError('checkInDate is required');
  }

  // 'YYYY-MM-DD' 문자열
  if (typeof input === 'string') {
    if (!/^\d{4}-\d{2}-\d{2}/.test(input)) {
      throw new TypeError(`Invalid date string: ${input}`);
    }
    const [y, m, d] = input.slice(0, 10).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d) - KST_OFFSET_MS);
  }

  // Date 객체 (UTC 시각 기준)
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) {
      throw new TypeError('Invalid Date object');
    }
    // UTC 자정 0시 → KST 09시. KST 자정 0시 = UTC 전날 15시.
    // 입력이 UTC 자정이라고 가정하고 일자만 가져와 KST 자정으로 환산.
    const y = input.getUTCFullYear();
    const m = input.getUTCMonth();
    const d = input.getUTCDate();
    return new Date(Date.UTC(y, m, d) - KST_OFFSET_MS);
  }

  throw new TypeError(`Unsupported type: ${typeof input}`);
}

/**
 * 결제 가능 마감 시각 계산.
 *   = (check_in_date - 5일) 의 KST 23:59:59.999
 *
 * @param {string|Date} checkInDate
 * @returns {Date} UTC 시각의 Date 객체
 */
function calculatePaymentDeadline(checkInDate) {
  const kstMidnight = parseCheckInToKstMidnight(checkInDate);

  // -5일
  const minus5 = new Date(kstMidnight.getTime() - PAYMENT_DEADLINE_DAYS_BEFORE * 24 * 60 * 60 * 1000);

  // 같은 일자의 KST 23:59:59.999 = 다음날 KST 00:00:00 - 1ms = (KST midnight + 24h - 1ms)
  // → kst midnight 그 자체가 KST 0시 → +24h - 1ms 가 23:59:59.999
  return new Date(minus5.getTime() + 24 * 60 * 60 * 1000 - 1);
}

/**
 * 현재 시각이 결제 가능한지 검사 (boolean 반환).
 *
 * @param {string|Date} checkInDate
 * @param {Date} [now=new Date()]
 * @returns {boolean}
 */
function isPayable(checkInDate, now = new Date()) {
  const deadline = calculatePaymentDeadline(checkInDate);
  return now.getTime() <= deadline.getTime();
}

/**
 * 결제 가능 여부 + 마감 정보를 반환.
 *
 * @param {string|Date} checkInDate
 * @param {Date} [now=new Date()]
 * @returns {{ payable: boolean, deadline: Date, hoursRemaining: number }}
 */
function checkPaymentEligibility(checkInDate, now = new Date()) {
  const deadline = calculatePaymentDeadline(checkInDate);
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
  calculatePaymentDeadline,
  isPayable,
  checkPaymentEligibility
};
