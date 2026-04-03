const rateLimit = require('express-rate-limit');

/**
 * 인증된 유저는 userId 기준, 비인증은 IP 기준
 * generalLimiter, adminApiLimiter처럼 인증 후 라우트에만 사용
 */
const userAwareKeyGenerator = (req) => {
  return req.user?.id ? `user_${req.user.id}` : req.ip;
};

/**
 * 일반 API용 Rate Limiter
 * 15분 동안 최대 300회 요청
 * 인증된 유저는 userId 기준으로 카운트
 */
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  keyGenerator: userAwareKeyGenerator,
  message: {
    success: false,
    code: 4290,
    message: '너무 많은 요청을 보냈습니다. 잠시 후 다시 시도해주세요.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * 인증 코드 발송/검증용 Rate Limiter (IP 기준, 엄격)
 * 1시간 동안 최대 5회 (인증 전 라우트이므로 IP 기준)
 */
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: {
    success: false,
    code: 4291,
    message: '요청 횟수를 초과했습니다. 1시간 후 다시 시도해주세요.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true
});

/**
 * 로그인 전용 Rate Limiter
 * 15분 동안 최대 10회 (authLimiter에서 분리 — UX 고려)
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    code: 4291,
    message: '로그인 시도 횟수를 초과했습니다. 15분 후 다시 시도해주세요.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true
});

/**
 * 파일 업로드용 Rate Limiter
 * 1시간 동안 최대 50회
 */
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
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
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: {
    success: false,
    code: 4293,
    message: '비밀번호 재설정 요청 횟수를 초과했습니다. 1시간 후 다시 시도해주세요.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * 매물 복제 전용 Rate Limiter (uploadLimiter에서 분리)
 * 1시간 동안 최대 10회
 */
const duplicateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    code: 4292,
    message: '매물 복제 횟수를 초과했습니다. 1시간 후 다시 시도해주세요.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * 관리자 인증용 Rate Limiter
 * 15분 동안 최대 10회
 */
const adminAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    code: 4294,
    message: '관리자 로그인 시도 횟수를 초과했습니다. 15분 후 다시 시도해주세요.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true
});

/**
 * 관리자 일반 API용 Rate Limiter
 * 15분 동안 최대 300회
 * 인증된 관리자는 userId 기준으로 카운트
 */
const adminApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  keyGenerator: userAwareKeyGenerator,
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
  loginLimiter,
  uploadLimiter,
  passwordResetLimiter,
  duplicateLimiter,
  adminAuthLimiter,
  adminApiLimiter
};
