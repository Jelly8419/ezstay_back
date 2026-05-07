/**
 * 전화번호 정규화 유틸
 *
 * 정책:
 *   - 저장/매칭 비교 시 모두 "숫자만" 형태로 통일 (예: 010-1234-5678 → 01012345678)
 *   - 입력값이 NULL/undefined/빈 문자열이면 NULL 반환 (DB 저장 호환)
 *   - 한국 휴대폰 형식이 아니어도 정규화는 수행 (검증은 validatePhoneNumber 책임)
 *
 * 사용처:
 *   - 입주 준비 서비스 임차인 자동 매칭 (services/moveInGuestBindService.js)
 *   - MoveInCase 생성/수정 시 guestPhone 저장 정규화
 *   - 향후 다른 phone 매칭 시나리오에도 재사용 가능
 */

'use strict';

/**
 * 전화번호에서 하이픈/공백/괄호 등 비숫자 문자를 제거.
 *
 * @param {string|null|undefined} phone
 * @returns {string|null} 숫자만 남은 문자열, 없으면 null
 *
 * @example
 *   normalizePhone('010-1234-5678')     // '01012345678'
 *   normalizePhone(' 010 1234 5678 ')   // '01012345678'
 *   normalizePhone('+82 10-1234-5678')  // '821012345678'  (국가코드 보존)
 *   normalizePhone('')                  // null
 *   normalizePhone(null)                // null
 */
function normalizePhone(phone) {
  if (phone == null) return null;
  if (typeof phone !== 'string') return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length === 0 ? null : digits;
}

/**
 * 두 전화번호가 정규화 후 동일한지 비교.
 *
 * @param {string|null} a
 * @param {string|null} b
 * @returns {boolean}
 */
function isSamePhone(a, b) {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (!na || !nb) return false;
  return na === nb;
}

module.exports = {
  normalizePhone,
  isSamePhone
};
