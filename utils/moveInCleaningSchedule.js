'use strict';

/**
 * 입주 준비 서비스 — 청소 희망 시간 검증 헬퍼
 *
 * 정책:
 *   - 청소 희망 시각은 30분 단위 (MM ∈ {00, 30})
 *   - 09:00 ~ 18:00 범위 (양 끝 포함)
 *   - 형식: 'HH:MM' 또는 'HH:MM:SS' (DB TIME 컬럼은 SS 까지 반환)
 *
 * 사용처:
 *   - 호스트 케이스 등록/수정 시 cleaningTime 검증
 *   - 관리자 응답 직렬화 시 정규 형식 보장
 */

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
const MIN_HOUR = 9;
const MAX_HOUR = 18;

/**
 * 'HH:MM' 또는 'HH:MM:SS' 문자열 검증.
 * 정책 위반(범위·30분 단위) 시 false.
 *
 * @param {string|null|undefined} time
 * @returns {boolean}
 */
function isValidCleaningTime(time) {
  if (typeof time !== 'string') return false;
  const m = TIME_REGEX.exec(time);
  if (!m) return false;

  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = m[3] !== undefined ? Number(m[3]) : 0;

  if (ss !== 0) return false;          // 30분 단위 정책 → SS=0 강제
  if (mm !== 0 && mm !== 30) return false;
  if (hh < MIN_HOUR || hh > MAX_HOUR) return false;
  if (hh === MAX_HOUR && mm !== 0) return false;  // 18:30 거절 (18:00 까지)

  return true;
}

/**
 * 저장용 정규형 'HH:MM:SS' 로 변환.
 * 검증 통과 입력만 받고, 'HH:MM' 입력은 ':00' 보충.
 *
 * @param {string} time
 * @returns {string} 'HH:MM:SS'
 */
function normalizeCleaningTime(time) {
  const m = TIME_REGEX.exec(time);
  if (!m) throw new TypeError('Invalid cleaning time');
  const hh = m[1];
  const mm = m[2];
  return `${hh}:${mm}:00`;
}

module.exports = {
  isValidCleaningTime,
  normalizeCleaningTime,
  MIN_HOUR,
  MAX_HOUR
};
