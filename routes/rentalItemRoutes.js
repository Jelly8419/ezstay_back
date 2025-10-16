const express = require('express');
const router = express.Router();
const {
  getAllRentalItems,
  getRentalItemById,
  createRentalItem,
  updateRentalItem,
  deleteRentalItem,
  adjustStock,
  getRentalItemStats
} = require('../controllers/rentalItemController');
const { authenticateToken } = require('../middleware/auth');

// TODO: 실제 운영 시 관리자 권한 체크 미들웨어 추가 필요
// const { isAdmin } = require('../middleware/auth');

/**
 * 대여 물품 관리 API (관리자 전용)
 * 모든 라우트는 인증 필수
 */

// 통계 조회 (먼저 정의해야 /:id와 충돌 방지)
router.get('/stats', authenticateToken, getRentalItemStats);

// 대여 물품 CRUD
router.get('/', authenticateToken, getAllRentalItems);
router.get('/:id', authenticateToken, getRentalItemById);
router.post('/', authenticateToken, createRentalItem);
router.patch('/:id', authenticateToken, updateRentalItem);
router.delete('/:id', authenticateToken, deleteRentalItem);

// 재고 수동 조정
router.patch('/:id/stock', authenticateToken, adjustStock);

module.exports = router;
