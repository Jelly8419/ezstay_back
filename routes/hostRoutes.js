const express = require('express');
const router = express.Router();
const {
  createRoom,
  updatePricing,
  uploadPhotos,
  updateAmenities,
  updateFreeServices,
  uploadCleaningToolImage,
  updateDescription,
  submitReview,
  reorderPhotos,
  deletePhoto,
  getRoom
} = require('../controllers/hostController');
const { authenticateToken } = require('../middleware/auth');
const { uploadRoomPhotos, uploadSingleImage } = require('../middleware/upload');

// 인증 필요한 모든 라우트에 미들웨어 적용
router.use(authenticateToken);

// 1. 기본 정보 등록
router.post('/rooms', createRoom);

// 2. 요금 설정
router.patch('/rooms/:roomId/pricing', updatePricing);

// 3. 사진 업로드 (6~20장)
router.post('/rooms/:roomId/photos', uploadRoomPhotos, uploadPhotos);

// 4. 편의시설 설정
router.patch('/rooms/:roomId/amenities', updateAmenities);

// 5. 무료 부가서비스 설정
router.patch('/rooms/:roomId/free-services', updateFreeServices);

// 6. 청소도구 이미지 업로드 (단일 이미지)
router.post('/rooms/:roomId/cleaning-tool-image', uploadSingleImage, uploadCleaningToolImage);

// 7. 방 소개
router.patch('/rooms/:roomId/description', updateDescription);

// 8. 심사 요청
router.post('/rooms/:roomId/submit-review', submitReview);

// 9. 사진 순서 변경
router.patch('/rooms/:roomId/photos/reorder', reorderPhotos);

// 10. 사진 삭제
router.delete('/rooms/:roomId/photos/:photoId', deletePhoto);

// 11. 방 정보 조회
router.get('/rooms/:roomId', getRoom);

module.exports = router;
