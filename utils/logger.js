/**
 * 환경별 로거 유틸리티
 * 프로덕션 환경에서는 로그를 출력하지 않음
 */

const isDevelopment = process.env.NODE_ENV === 'development';

const logger = {
  /**
   * 일반 로그 (개발 환경에서만 출력)
   */
  log: (...args) => {
    if (isDevelopment) {
      console.log(...args);
    }
  },

  /**
   * 에러 로그 (항상 출력)
   */
  error: (...args) => {
    console.error(...args);
  },

  /**
   * 경고 로그 (항상 출력)
   */
  warn: (...args) => {
    console.warn(...args);
  },

  /**
   * 정보 로그 (개발 환경에서만 출력)
   */
  info: (...args) => {
    if (isDevelopment) {
      console.info(...args);
    }
  },

  /**
   * 디버그 로그 (개발 환경에서만 출력)
   */
  debug: (...args) => {
    if (isDevelopment) {
      console.debug(...args);
    }
  }
};

module.exports = logger;
