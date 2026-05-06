/**
 * cryptoHelper.test.js
 * AES-256-GCM 암/복호화 단위 테스트
 *
 * 검증 포인트:
 *  - encrypt/decrypt 왕복 정확성
 *  - 빈 값/null 처리
 *  - 동일 평문도 IV 랜덤이라 다른 암호문 산출
 *  - 변조된 암호문 복호화 실패 (auth tag 검증)
 *  - 키 미설정 시 에러
 */

'use strict';

// 테스트용 키를 미리 주입 (env 없이도 동작 보장)
process.env.MOVE_IN_PASSWORD_KEY =
  process.env.MOVE_IN_PASSWORD_KEY
  || require('crypto').randomBytes(32).toString('base64');

const { encrypt, decrypt } = require('../../utils/cryptoHelper');

describe('cryptoHelper — 정상 흐름', () => {
  test('평문 → 암호화 → 복호화 왕복 일치', () => {
    const plain = '0512*';
    const encrypted = encrypt(plain);
    expect(encrypted).not.toBe(plain);
    expect(typeof encrypted).toBe('string');
    expect(decrypt(encrypted)).toBe(plain);
  });

  test('한글 평문 처리', () => {
    const plain = '도어락1234#';
    expect(decrypt(encrypt(plain))).toBe(plain);
  });

  test('긴 평문 처리', () => {
    const plain = 'a'.repeat(1000);
    expect(decrypt(encrypt(plain))).toBe(plain);
  });

  test('동일 평문도 IV 랜덤이라 매번 다른 암호문', () => {
    const plain = '2479#';
    const a = encrypt(plain);
    const b = encrypt(plain);
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe(plain);
    expect(decrypt(b)).toBe(plain);
  });
});

describe('cryptoHelper — 빈 값 처리', () => {
  test('null 입력은 null 반환', () => {
    expect(encrypt(null)).toBeNull();
    expect(decrypt(null)).toBeNull();
  });

  test('undefined 입력은 null 반환', () => {
    expect(encrypt(undefined)).toBeNull();
    expect(decrypt(undefined)).toBeNull();
  });

  test('빈 문자열 입력은 null 반환', () => {
    expect(encrypt('')).toBeNull();
    expect(decrypt('')).toBeNull();
  });
});

describe('cryptoHelper — 위변조 탐지', () => {
  test('변조된 암호문은 복호화 실패', () => {
    const encrypted = encrypt('1234');
    const tampered = encrypted.slice(0, -4) + 'XXXX';
    expect(() => decrypt(tampered)).toThrow();
  });

  test('너무 짧은 암호문은 에러', () => {
    expect(() => decrypt('aaaa')).toThrow();
  });
});

describe('cryptoHelper — 키 검증', () => {
  test('키 미설정 시 에러', () => {
    jest.resetModules();
    const original = process.env.MOVE_IN_PASSWORD_KEY;
    delete process.env.MOVE_IN_PASSWORD_KEY;

    const { encrypt: encryptNoKey } = require('../../utils/cryptoHelper');
    expect(() => encryptNoKey('foo')).toThrow(/MOVE_IN_PASSWORD_KEY/);

    process.env.MOVE_IN_PASSWORD_KEY = original;
    jest.resetModules();
  });

  test('키 길이가 32바이트 아니면 에러', () => {
    jest.resetModules();
    const original = process.env.MOVE_IN_PASSWORD_KEY;
    process.env.MOVE_IN_PASSWORD_KEY = Buffer.from('shortkey').toString('base64');

    const { encrypt: encryptBadKey } = require('../../utils/cryptoHelper');
    expect(() => encryptBadKey('foo')).toThrow(/32바이트/);

    process.env.MOVE_IN_PASSWORD_KEY = original;
    jest.resetModules();
  });
});
