/**
 * 영업일 계산 유틸리티
 *
 * 한국 공휴일 캐시(holidayCache)를 기반으로 영업일을 계산합니다.
 * 주말(토/일) + 공휴일을 제외한 실제 영업일 기준으로 날짜를 산출합니다.
 *
 * 공휴일 캐시가 로드되지 않은 경우(API 키 미설정 등) 주말만 제외합니다.
 */

const { holidayCache } = require('./holidayCache');

/**
 * Date → 'YYYY-MM-DD' 문자열 변환
 * @param {Date} date
 * @returns {string}
 */
const toDateString = (date) => {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

/**
 * 특정 날짜가 주말 또는 공휴일인지 확인 (캐시 기반, 동기)
 *
 * @param {Date} date
 * @returns {boolean}
 */
const isNonBusinessDay = (date) => {
  const dayOfWeek = date.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return true; // 일요일(0), 토요일(6)

  const year = date.getFullYear();
  const cache = holidayCache[year];
  if (!cache) return false; // 캐시 없으면 공휴일 아닌 것으로 처리

  return cache.has(toDateString(date));
};

/**
 * 영업일 추가 계산 (주말 + 공휴일 제외)
 *
 * @param {Date|string} fromDate - 시작일
 * @param {number} businessDays - 추가할 영업일 수
 * @returns {Date} 영업일 기준 결과 날짜
 */
const addBusinessDays = (fromDate, businessDays) => {
  const date = new Date(fromDate);
  let added = 0;
  while (added < businessDays) {
    date.setDate(date.getDate() + 1);
    if (!isNonBusinessDay(date)) {
      added++;
    }
  }
  return date;
};

/**
 * 정산 예정일 계산 (입주일 + 3영업일)
 * 정책: 입주일 기준 3영업일 후 정산
 *
 * @param {Date|string} checkInDate - 체크인(입주) 날짜
 * @returns {Date} 정산 예정일
 */
const calculateSettlementDate = (checkInDate) => {
  return addBusinessDays(new Date(checkInDate), 3);
};

/**
 * 지급 가능 날짜 계산 (결제 승인일 + 3영업일)
 * 정책: PG 정산은 결제 승인 후 영업일 기준 3일 후
 *
 * @param {Date|string} approvedAt - 결제 승인 시각
 * @returns {Date} 지급 가능 날짜
 */
const calculatePayoutAvailableDate = (approvedAt) => {
  return addBusinessDays(new Date(approvedAt), 3);
};

module.exports = {
  addBusinessDays,
  calculateSettlementDate,
  calculatePayoutAvailableDate,
};
