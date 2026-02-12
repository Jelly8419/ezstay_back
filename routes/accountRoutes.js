const express = require('express');
const router = express.Router();
const { verifyAccount, getUserAccount, saveAccount, deleteAccount } = require('../controllers/accountController');
const { authenticateToken, optionalAuth } = require('../middleware/auth');

// 계좌 실명 확인 (선택적 인증 - 회원가입 전후 모두 사용 가능)
router.post('/verify', optionalAuth, verifyAccount);

// 사용자 계좌 정보 조회
router.get('/', authenticateToken, getUserAccount);

// 계좌 정보 추가/수정 (게스트 → 호스트 전환용)
router.post('/', authenticateToken, saveAccount);

// 계좌 정보 삭제
router.delete('/', authenticateToken, deleteAccount);

module.exports = router;