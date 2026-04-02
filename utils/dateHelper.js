/**
 * KST 기준 날짜 유틸리티
 *
 * process.env.TZ = 'Asia/Seoul' 환경에서 new Date()는 KST 기준으로 동작하지만,
 * toISOString()은 항상 UTC(Z)를 반환하므로 자정~오전9시 사이에 날짜가 하루 밀림.
 * 이 파일의 함수를 사용하면 KST 기준 날짜 문자열을 안전하게 얻을 수 있음.
 */

/**
 * KST 기준 오늘 날짜 문자열 반환 (YYYY-MM-DD)
 * @returns {string} e.g. "2026-04-02"
 */
function todayKST() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Date 객체를 KST 기준 날짜 문자열로 변환 (YYYY-MM-DD)
 * @param {Date} date
 * @returns {string} e.g. "2026-04-02"
 */
function toDateStrKST(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 로그용 KST 타임스탬프 문자열 반환
 * @returns {string} e.g. "2026-04-02T20:37:00.000+09:00"
 */
function nowKSTString() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).replace(' ', 'T') + '+09:00';
}

module.exports = { todayKST, toDateStrKST, nowKSTString };
