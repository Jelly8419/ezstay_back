const express = require('express');
const router = express.Router();
const {
  verifyAccount, getUserAccount, saveAccount, deleteAccount,
  verifyRefundAccount, getRefundAccount, saveRefundAccount, deleteRefundAccount
} = require('../controllers/accountController');
const { authenticateToken, optionalAuth } = require('../middleware/auth');

// 계좌 실명 확인 (선택적 인증 - 회원가입 전후 모두 사용 가능)
router.post('/verify', optionalAuth, verifyAccount);

// 사용자 계좌 정보 조회
router.get('/', authenticateToken, getUserAccount);

// 계좌 정보 추가/수정 (게스트 → 호스트 전환용)
router.post('/', authenticateToken, saveAccount);

// 계좌 정보 삭제
router.delete('/', authenticateToken, deleteAccount);

// =====================================================
// 게스트 환급 계좌 (호스트 정산계좌와 별도)
// =====================================================

// 환급 계좌 예금주 확인 (아임포트)
router.post('/refund/verify', authenticateToken, verifyRefundAccount);

// 환급 계좌 조회
router.get('/refund', authenticateToken, getRefundAccount);

// 환급 계좌 저장/수정
router.post('/refund', authenticateToken, saveRefundAccount);

// 환급 계좌 삭제
router.delete('/refund', authenticateToken, deleteRefundAccount);

module.exports = router;