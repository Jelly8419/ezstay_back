const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

/**
 * 인증된 유저는 userId 기준, 비인증은 IP 기준
 * generalLimiter, adminApiLimiter처럼 인증 후 라우트에만 사용
 */
const userAwareKeyGenerator = (req) => {
  return req.user?.id ? `user_${req.user.id}` : ipKeyGenerator(req);
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
 * 채팅 읽음 처리용 Rate Limiter
 * 1분 동안 최대 100회 (30초 heartbeat × 여러 채팅방 고려)
 * userId 기준 카운트
 */
const chatReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
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
 * 채팅 알림 전송용 Rate Limiter
 * 1분 동안 최대 50회 (메시지 전송 빈도 기준)
 * userId 기준 카운트
 */
const chatNotifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 50,
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
 * 지도 방 검색용 Rate Limiter
 * 1분 동안 최대 30회 (지도 bounds 변경 기준)
 */
const roomSearchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: userAwareKeyGenerator,
  message: {
    success: false,
    code: 4290,
    message: '검색 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * 계약 목록/상세 조회용 Rate Limiter
 * 1시간 동안 최대 500회
 * userId 기준 카운트
 */
const contractReadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 500,
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
 * 계약 신청용 Rate Limiter
 * 1시간 동안 최대 100회
 * userId 기준 카운트
 */
const contractRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 100,
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
 * 아이디 찾기 / 비밀번호 찾기 이메일 확인용 Rate Limiter
 * 1시간 동안 최대 5회 (성공 포함 모두 카운트)
 * 계정 열거 공격 방지 — skipSuccessfulRequests 없음
 */
const findAccountLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: {
    success: false,
    code: 4297,
    message: '요청 횟수를 초과했습니다. 1시간 후 다시 시도해주세요.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * KMC 본인인증 전용 Rate Limiter
 * 1일 3회 (가입 1회 + 실패 재시도 여유 2회)
 * 성공 시 카운트 차감 없음 — 실패/재시도만 소모
 */
const kmcVerifyLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 5,
  message: {
    success: false,
    code: 4296,
    message: '오늘 본인인증 횟수를 초과했습니다. 내일 다시 시도해주세요.'
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
  chatReadLimiter,
  chatNotifyLimiter,
  roomSearchLimiter,
  contractReadLimiter,
  contractRequestLimiter,
  adminAuthLimiter,
  adminApiLimiter,
  kmcVerifyLimiter,
  findAccountLimiter
};
