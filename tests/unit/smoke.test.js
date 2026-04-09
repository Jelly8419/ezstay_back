/**
 * smoke.test.js
 * 세팅이 정상인지 확인하는 최소 테스트
 */

'use strict';

describe('테스트 환경 smoke test', () => {
  it('NODE_ENV 가 test 이다', () => {
    expect(process.env.NODE_ENV).toBe('test');
  });

  it('DB_NAME 이 ezstay_test 이다', () => {
    expect(process.env.DB_NAME).toBe('ezstay_test');
  });

  it('JWT_SECRET 이 설정되어 있다', () => {
    expect(process.env.JWT_SECRET).toBeTruthy();
  });

  it('1 + 1 = 2', () => {
    expect(1 + 1).toBe(2);
  });
});
