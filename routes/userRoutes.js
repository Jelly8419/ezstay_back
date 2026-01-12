const express = require('express');
const router = express.Router();
const {
  saveGuestVerification,
  saveHostVerification,
  getVerificationStatus,
  getProfile,
  changePassword,
  changePhoneNumber,
  deleteAccount
} = require('../controllers/userController');
const { authenticateToken } = require('../middleware/auth');

// 게스트 본인인증정보 저장
router.post('/guest/verification', authenticateToken, saveGuestVerification);

// 호스트 본인인증 + 계좌정보 저장
router.post('/host/verification', authenticateToken, saveHostVerification);

// 사용자 인증 상태 조회
router.get('/verification', authenticateToken, getVerificationStatus);

// 사용자 프로필 조회
router.get('/profile', authenticateToken, getProfile);

// 비밀번호 변경
router.patch('/password', authenticateToken, changePassword);

// 연락처 변경
router.patch('/phone', authenticateToken, changePhoneNumber);

// 회원 탈퇴
router.delete('/account', authenticateToken, deleteAccount);

module.exports = router;