const express = require('express');
const router = express.Router();
const { verifyAccount, getUserAccount, deleteAccount } = require('../controllers/accountController');
const { authenticateToken } = require('../middleware/auth');

// 계좌 실명 확인
router.post('/verify', authenticateToken, verifyAccount);

// 사용자 계좌 정보 조회
router.get('/', authenticateToken, getUserAccount);

// 계좌 정보 삭제
router.delete('/', authenticateToken, deleteAccount);

module.exports = router;