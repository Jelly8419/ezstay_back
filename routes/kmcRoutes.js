const express = require('express');
const router = express.Router();
const { requestVerification, verifyResult, handleCallback } = require('../controllers/kmcController');
const { authLimiter, kmcVerifyLimiter } = require('../middleware/rateLimiter');
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

/**
 * [개발 전용] KMC SDK 없이 가짜 인증 결과를 KmcVerification에 직접 저장
 * POST /api/auth/kmc/dev-verify
 * Body: { name, phoneNumber, birth, gender }
 * Response: { certNum, ci, name, phoneNumber, birth, gender }
 */
if (process.env.NODE_ENV !== 'production') {
  const { KmcVerification } = require('../models');
  router.post('/kmc/dev-verify', async (req, res) => {
    try {
      const { name = '테스트유저', phoneNumber = '01012345678', birth = '19900101', gender = '0' } = req.body;

      // requestVerification과 동일한 certNum 형식: 날짜14자리 + 랜덤6자리
      const now = new Date();
      const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
      const reqDate = kst.toISOString().replace(/[-T:\.Z]/g, '').slice(0, 14);
      const random = Math.floor(100000 + Math.random() * 900000);
      const certNum = `${reqDate}${random}`;

      // 가짜 CI — phoneNumber+birth 고정값 기반 (동일 사람은 항상 같은 CI)
      const fakeCi = Buffer.from(`DEV_CI_${phoneNumber}_${birth}`).toString('base64').padEnd(88, '=').slice(0, 88);

      await KmcVerification.upsert({
        certNum,
        name,
        phoneNumber,
        birth,
        gender,
        ci: fakeCi,
        used: false,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        ipAddress: req.ip || null
      });

      return res.json({
        success: true,
        data: { certNum, ci: fakeCi, name, phoneNumber, birth, gender },
        message: '[DEV] 가짜 본인인증 완료. certNum을 회원가입에 사용하세요.'
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });
}

// KMC 본인인증 결과 콜백 (KMC 서버가 직접 POST, CORS 별도 허용)
router.post('/kmc/callback', kmcIpWhitelist, handleCallback);

// KMC 본인인증 결과 검증 (프론트에서 호출, 로그인 상태면 req.user 세팅)
router.post('/kmc/verify', kmcVerifyLimiter, optionalAuth, verifyResult);

module.exports = router;
