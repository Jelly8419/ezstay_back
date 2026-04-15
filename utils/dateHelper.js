/**
 * KST 기준 날짜 유틸리티
 *
 * DB에 UTC로 저장된 Date 값을 KST(UTC+9)로 변환하여 API 응답에 사용.
 * process.env.TZ 환경 변수에 의존하지 않고 UTC 기준으로 명시적으로 계산.
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000; // 9시간 = 32400000ms

/**
 * KST 기준 오늘 날짜 문자열 반환 (YYYY-MM-DD)
 * @returns {string} e.g. "2026-04-02"
 */
function todayKST() {
  const kst = new Date(Date.now() + KST_OFFSET_MS);
  const year = kst.getUTCFullYear();
  const month = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const day = String(kst.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Date 객체를 KST 기준 날짜 문자열로 변환 (YYYY-MM-DD)
 * @param {Date} date
 * @returns {string} e.g. "2026-04-02"
 */
function toDateStrKST(date) {
  const kst = new Date(new Date(date).getTime() + KST_OFFSET_MS);
  const year = kst.getUTCFullYear();
  const month = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const day = String(kst.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 로그용 KST 타임스탬프 문자열 반환
 * @returns {string} e.g. "2026-04-02T20:37:00.000+09:00"
 */
function nowKSTString() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).replace(' ', 'T') + '+09:00';
}

/**
 * UTC Date 객체를 KST 기준 datetime 문자열로 변환 (시간 포함)
 * API 응답 시 checkInDate / checkOutDate 등 DataTypes.DATE 필드에 사용
 * @param {Date|string|null} date
 * @returns {string|null} e.g. "2024-04-15T14:00:00+09:00"
 */
function toKSTString(date) {
  if (!date) return null;
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;
  const kst = new Date(d.getTime() + KST_OFFSET_MS);
  const Y = kst.getUTCFullYear();
  const M = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const D = String(kst.getUTCDate()).padStart(2, '0');
  const h = String(kst.getUTCHours()).padStart(2, '0');
  const m = String(kst.getUTCMinutes()).padStart(2, '0');
  const s = String(kst.getUTCSeconds()).padStart(2, '0');
  return `${Y}-${M}-${D}T${h}:${m}:${s}+09:00`;
}

module.exports = { todayKST, toDateStrKST, nowKSTString, toKSTString };
