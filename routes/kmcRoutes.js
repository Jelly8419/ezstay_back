const express = require('express');
const router = express.Router();
const { requestVerification, verifyResult } = require('../controllers/kmcController');
const { authLimiter } = require('../middleware/rateLimiter');

// KMC 본인인증 요청 데이터 생성 (회원가입 전 비인증 상태에서 호출)
router.post('/kmc/request', authLimiter, requestVerification);

// KMC 본인인증 결과 검증 (회원가입 전 비인증 상태에서 호출)
router.post('/kmc/verify', authLimiter, verifyResult);

module.exports = router;
