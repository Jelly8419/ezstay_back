const express = require('express');
const router = express.Router();
const { saveGuestVerification, saveHostVerification, getVerificationStatus } = require('../controllers/userController');
const { authenticateToken } = require('../middleware/auth');

// 게스트 본인인증정보 저장
router.post('/guest/verification', authenticateToken, saveGuestVerification);

// 호스트 본인인증 + 계좌정보 저장
router.post('/host/verification', authenticateToken, saveHostVerification);

// 사용자 인증 상태 조회
router.get('/verification', authenticateToken, getVerificationStatus);

module.exports = router;