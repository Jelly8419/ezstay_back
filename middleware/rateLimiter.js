const rateLimit = require('express-rate-limit');

/**
 * 일반 API용 Rate Limiter
 * 15분 동안 최대 100회 요청
 */
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15분
  max: 100, // 최대 100회
  message: {
    success: false,
    code: 4290,
    message: '너무 많은 요청을 보냈습니다. 잠시 후 다시 시도해주세요.'
  },
  standardHeaders: true, // RateLimit-* 헤더 반환
  legacyHeaders: false // X-RateLimit-* 헤더 비활성화
  // keyGenerator 제거 - 기본 IP 처리 사용 (IPv6 지원)
});

/**
 * 인증 API용 Rate Limiter (더 엄격)
 * 15분 동안 최대 5회 로그인/회원가입 시도
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15분
  max: 5, // 최대 5회
  message: {
    success: false,
    code: 4291,
    message: '로그인 시도 횟수를 초과했습니다. 15분 후 다시 시도해주세요.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true // 성공한 요청은 카운트에서 제외
});

/**
 * 파일 업로드용 Rate Limiter
 * 1시간 동안 최대 20회 업로드
 */
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1시간
  max: 20, // 최대 20회
  message: {
    success: false,
    code: 4292,
    message: '파일 업로드 횟수를 초과했습니다. 1시간 후 다시 시도해주세요.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * 비밀번호 재설정용 Rate Limiter
 * 1시간 동안 최대 3회
 */
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1시간
  max: 3, // 최대 3회
  message: {
    success: false,
    code: 4293,
    message: '비밀번호 재설정 요청 횟수를 초과했습니다. 1시간 후 다시 시도해주세요.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * 관리자 인증용 Rate Limiter (일반 사용자보다 완화)
 * 15분 동안 최대 10회 로그인 시도
 */
const adminAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15분
  max: 10, // 최대 10회 (일반 사용자의 2배)
  message: {
    success: false,
    code: 4294,
    message: '관리자 로그인 시도 횟수를 초과했습니다. 15분 후 다시 시도해주세요.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true // 성공한 요청은 카운트에서 제외
});

/**
 * 관리자 일반 API용 Rate Limiter (업무 특성상 높은 한도)
 * 15분 동안 최대 300회 요청
 */
const adminApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15분
  max: 300, // 최대 300회 (일반 사용자의 3배)
  message: {
    success: false,
    code: 4295,
    message: '요청 횟수를 초과했습니다. 잠시 후 다시 시도해주세요.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

module.exports = {
  generalLimiter,
  authLimiter,
  uploadLimiter,
  passwordResetLimiter,
  adminAuthLimiter,
  adminApiLimiter
};
