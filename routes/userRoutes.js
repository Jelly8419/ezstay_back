const express = require('express');
const router = express.Router();
const {
  saveGuestVerification,
  saveHostVerification,
  getVerificationStatus,
  getProfile,
  changePassword,
  changeNickname,
  deleteAccount
} = require('../controllers/userController');
const { authenticateToken } = require('../middleware/auth');
const {
  getReceiptSetting,
  upsertReceiptSetting,
  deleteReceiptSetting
} = require('../controllers/receiptSettingController');

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

// 닉네임 변경
router.patch('/nickname', authenticateToken, changeNickname);

// 회원 탈퇴
router.delete('/account', authenticateToken, deleteAccount);

// ========================================
// 영수증 설정 API (게스트)
// ========================================

// 영수증 설정 조회
router.get('/receipt', authenticateToken, getReceiptSetting);

// 영수증 설정 저장/수정
router.put('/receipt', authenticateToken, upsertReceiptSetting);

// 영수증 설정 삭제
router.delete('/receipt', authenticateToken, deleteReceiptSetting);

module.exports = router;