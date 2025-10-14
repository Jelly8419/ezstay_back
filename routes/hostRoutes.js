const express = require('express');
const router = express.Router();
const {
  createRoom,
  updateBasicInfo,
  updatePricing,
  uploadPhotos,
  updateAmenities,
  updateFreeServices,
  uploadCleaningToolImage,
  updateDescription,
  submitReview,
  reorderPhotos,
  deletePhoto,
  getMyRooms,
  getRoom
} = require('../controllers/hostController');
const { authenticateToken } = require('../middleware/auth');
const { uploadRoomPhotos, uploadSingleImage } = require('../middleware/upload');
const { uploadLimiter } = require('../middleware/rateLimiter');

// 인증 필요한 모든 라우트에 미들웨어 적용
router.use(authenticateToken);

// 0. 내 방 목록 조회 (getRoom보다 먼저 와야 함)
router.get('/rooms', getMyRooms);

// 1. 기본 정보 등록
router.post('/rooms', createRoom);

// 2. 기본 정보 수정
router.patch('/rooms/:roomId', updateBasicInfo);

// 3. 요금 설정
router.patch('/rooms/:roomId/pricing', updatePricing);

// 4. 사진 업로드 (6~20장) - Rate Limiting 적용
router.post('/rooms/:roomId/photos', uploadLimiter, uploadRoomPhotos, uploadPhotos);

// 5. 편의시설 설정
router.patch('/rooms/:roomId/amenities', updateAmenities);

// 6. 무료 부가서비스 설정
router.patch('/rooms/:roomId/free-services', updateFreeServices);

// 7. 청소도구 이미지 업로드 (단일 이미지) - Rate Limiting 적용
router.post('/rooms/:roomId/cleaning-tool-image', uploadLimiter, uploadSingleImage, uploadCleaningToolImage);

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

module.exports = router;
