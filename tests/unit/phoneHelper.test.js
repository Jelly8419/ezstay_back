/**
 * phoneHelper.test.js
 * 전화번호 정규화 유틸 단위 테스트
 *
 * 검증 포인트:
 *  - 다양한 입력 형식 → 숫자만 남기기
 *  - null/undefined/타입 오류 방어
 *  - 비교 함수 정확성
 */

'use strict';

const { normalizePhone, isSamePhone } = require('../../utils/phoneHelper');

describe('normalizePhone', () => {
  test('하이픈 제거', () => {
    expect(normalizePhone('010-1234-5678')).toBe('01012345678');
  });

  test('이미 정규화된 입력 그대로', () => {
    expect(normalizePhone('01012345678')).toBe('01012345678');
  });

  test('공백 / 괄호 제거', () => {
    expect(normalizePhone(' 010 1234 5678 ')).toBe('01012345678');
    expect(normalizePhone('(010) 1234-5678')).toBe('01012345678');
  });

  test('국가코드 + 보존 (숫자로 변환)', () => {
    expect(normalizePhone('+82 10-1234-5678')).toBe('821012345678');
  });

  test('null / undefined → null', () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });

  test('빈 문자열 / 비숫자만 → null', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('abc-def')).toBeNull();
    expect(normalizePhone('---')).toBeNull();
  });

  test('non-string → null (타입 방어)', () => {
    expect(normalizePhone(1234567890)).toBeNull();
    expect(normalizePhone({})).toBeNull();
    expect(normalizePhone([])).toBeNull();
    expect(normalizePhone(true)).toBeNull();
  });
});

describe('isSamePhone', () => {
  test('형식 다른 동일 번호 → true', () => {
    expect(isSamePhone('010-1234-5678', '01012345678')).toBe(true);
    expect(isSamePhone('010 1234 5678', '010-1234-5678')).toBe(true);
  });

  test('다른 번호 → false', () => {
    expect(isSamePhone('010-1234-5678', '010-1234-9999')).toBe(false);
  });

  test('한쪽 null → false', () => {
    expect(isSamePhone(null, '01012345678')).toBe(false);
    expect(isSamePhone('01012345678', null)).toBe(false);
    expect(isSamePhone(null, null)).toBe(false);
  });

  test('한쪽 빈 문자열 → false', () => {
    expect(isSamePhone('', '01012345678')).toBe(false);
  });
});
