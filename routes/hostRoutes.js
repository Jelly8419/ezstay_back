const express = require('express');
const router = express.Router();
const {
  createRoom,
  updateBasicInfo,
  updatePricing,
  uploadPhotos,
  updateAmenities,
  updateFreeServices,
  updateDescription,
  submitReview,
  reorderPhotos,
  deletePhoto,
  getMyRooms,
  getRoom,
  updateRoomStatus,
  deleteRoom,
  duplicateRoom,
  getHostAccount,
  getReceipt,
  upsertReceipt,
  deleteReceipt
} = require('../controllers/hostController');
const {
  getAutoMessageTemplates,
  getAutoMessageTemplate,
  createAutoMessageTemplate,
  updateAutoMessageTemplate,
  deleteAutoMessageTemplate,
  toggleAutoMessageTemplate,
  getRoomAutoMessageTemplates
} = require('../controllers/autoMessageController');
const {
  getSettlements,
  getSettlementDetail,
  exportSettlements
} = require('../controllers/settlementController');
const { authenticateToken } = require('../middleware/auth');
const { uploadRoomPhotos } = require('../middleware/upload');
const { uploadLimiter } = require('../middleware/rateLimiter');
const { requireUserInfo } = require('../middleware/validation');

// 인증 필요한 모든 라우트에 미들웨어 적용
router.use(authenticateToken);

// 0. 호스트 계좌정보 조회
router.get('/account', getHostAccount);

// 1. 내 방 목록 조회 (getRoom보다 먼저 와야 함)
router.get('/rooms', getMyRooms);

// 2. 기본 정보 등록
router.post('/rooms', createRoom);

// 3. 기본 정보 수정
router.patch('/rooms/:roomId', updateBasicInfo);

// 4. 요금 설정
router.patch('/rooms/:roomId/pricing', updatePricing);

// 5. 사진 업로드 (6~20장) - Rate Limiting 적용
router.post('/rooms/:roomId/photos', uploadLimiter, uploadRoomPhotos, uploadPhotos);

// 6. 편의시설 설정
router.patch('/rooms/:roomId/amenities', updateAmenities);

// 7. 이지서비스 설정 (구 무료 부가서비스)
router.patch('/rooms/:roomId/ez-service', updateFreeServices);

// 8. 방 소개
router.patch('/rooms/:roomId/description', updateDescription);

// 9. 심사 요청 (전화번호 + 계좌정보 필수)
router.post('/rooms/:roomId/submit-review', requireUserInfo({ requirePhone: true, requireBankAccount: true }), submitReview);

// 10. 사진 순서 변경
router.patch('/rooms/:roomId/photos/reorder', reorderPhotos);

// 11. 사진 삭제
router.delete('/rooms/:roomId/photos/:photoId', deletePhoto);

// 12. 방 상세 정보 조회
router.get('/rooms/:roomId', getRoom);

// 13. 방 상태 변경 (게시/비공개)
router.patch('/rooms/:roomId/status', updateRoomStatus);

// 14. 방 복제
router.post('/rooms/:roomId/duplicate', uploadLimiter, duplicateRoom);

// 15. 방 삭제
router.delete('/rooms/:roomId', deleteRoom);

// ========================================
// 자동메시지 관리 API
// ========================================

// 16. 자동메시지 템플릿 목록 조회
router.get('/auto-messages', getAutoMessageTemplates);

// 17. 자동메시지 템플릿 상세 조회
router.get('/auto-messages/:id', getAutoMessageTemplate);

// 18. 자동메시지 템플릿 생성
router.post('/auto-messages', createAutoMessageTemplate);

// 19. 자동메시지 템플릿 수정
router.patch('/auto-messages/:id', updateAutoMessageTemplate);

// 20. 자동메시지 템플릿 삭제
router.delete('/auto-messages/:id', deleteAutoMessageTemplate);

// 21. 자동메시지 템플릿 활성화/비활성화 토글
router.patch('/auto-messages/:id/toggle', toggleAutoMessageTemplate);

// 22. 특정 방의 자동메시지 템플릿 목록 조회
router.get('/rooms/:roomId/auto-messages', getRoomAutoMessageTemplates);

// ========================================
// 영수증 설정 API
// ========================================

// 26. 영수증 설정 조회
router.get('/receipt', getReceipt);

// 27. 영수증 설정 저장/수정
router.put('/receipt', upsertReceipt);

// 28. 영수증 설정 삭제
router.delete('/receipt', deleteReceipt);

// ========================================
// 정산 관리 API
// ========================================

// 23. 정산 내역 엑셀 다운로드 (settlements/:contractId보다 먼저 와야 함)
router.get('/settlements/export', exportSettlements);

// 24. 정산 목록 조회
router.get('/settlements', getSettlements);

// 25. 정산 상세 조회
router.get('/settlements/:contractId', getSettlementDetail);

module.exports = router;
