const express = require('express');
const router = express.Router();
const { requestVerification, verifyResult, handleCallback } = require('../controllers/kmcController');
const { authLimiter } = require('../middleware/rateLimiter');
const { optionalAuth } = require('../middleware/auth');

/**
 * KMC 서버 IP 화이트리스트 미들웨어
 * KMC_SERVER_IPS 환경변수가 비어 있으면 화이트리스트 검사 생략 (개발 편의)
 */
const kmcIpWhitelist = (req, res, next) => {
  const allowedIps = process.env.KMC_SERVER_IPS
    ? process.env.KMC_SERVER_IPS.split(',').map((ip) => ip.trim()).filter(Boolean)
    : [];

  if (allowedIps.length === 0) {
    return next(); // 환경변수 미설정 시 비활성화 (개발 환경)
  }

  // Cloudflare 등 프록시 뒤에서는 x-forwarded-for 첫 번째 값이 실제 발신 IP
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
  if (!allowedIps.includes(clientIp)) {
    console.warn(`[KMC] whitelist 차단 - clientIp: ${clientIp}, x-forwarded-for: ${req.headers['x-forwarded-for'] || '없음'}`);
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }
  next();
};

// KMC 본인인증 요청 데이터 생성 (회원가입 전 비인증 상태에서 호출)
router.post('/kmc/request', authLimiter, requestVerification);

// KMC 본인인증 결과 콜백 (KMC 서버가 직접 POST, CORS 별도 허용)
router.post('/kmc/callback', kmcIpWhitelist, handleCallback);

// KMC 본인인증 결과 검증 (프론트에서 호출, 로그인 상태면 req.user 세팅)
router.post('/kmc/verify', authLimiter, optionalAuth, verifyResult);

module.exports = router;
