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
  getHostAccount
} = require('../controllers/hostController');
const { authenticateToken } = require('../middleware/auth');
const { uploadRoomPhotos, uploadSingleImage } = require('../middleware/upload');
const { uploadLimiter } = require('../middleware/rateLimiter');

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

// 9. 심사 요청
router.post('/rooms/:roomId/submit-review', submitReview);

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

module.exports = router;
