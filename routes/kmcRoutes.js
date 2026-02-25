const express = require('express');
const router = express.Router();
const { requestVerification, verifyResult } = require('../controllers/kmcController');
const { authenticateToken } = require('../middleware/auth');

// KMC 본인인증 요청 데이터 생성
router.post('/kmc/request', authenticateToken, requestVerification);

// KMC 본인인증 결과 검증
router.post('/kmc/verify', authenticateToken, verifyResult);

module.exports = router;
