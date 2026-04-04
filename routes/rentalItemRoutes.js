const express = require('express');
const router = express.Router();
const {
  // 게스트용 공개 API
  getPublicRentalItems,
  getPublicRentalItemById,
  getPublicRentalItemsByType,
  getRentalCategories,
  // 관리자용 API
  getAllRentalItems,
  getRentalItemById,
  createRentalItem,
  updateRentalItem,
  deleteRentalItem,
  getRentalItemStats,
  getAllRentalItemsCalendar,
  getRentalItemCalendar
} = require('../controllers/rentalItemController');
const { authenticateToken, authenticateAdmin } = require('../middleware/auth');

// ============================================
// 게스트용 공개 API (인증 불필요)
// ============================================

/**
 * @route GET /api/rental-items/categories
 * @desc 물품 카테고리 목록 조회
 * @access Public
 */
router.get('/categories', getRentalCategories);

/**
 * @route GET /api/rental-items/type/:itemType
 * @desc 카테고리별 렌탈 아이템 조회
 * @access Public
 */
router.get('/type/:itemType', getPublicRentalItemsByType);

/**
 * @route GET /api/rental-items
 * @desc 활성화된 렌탈 아이템 목록 조회
 * @access Public
 * @query {string} itemType - 물품 카테고리 필터 (선택)
 * @query {boolean} inStock - 재고 있는 것만 조회 (선택, 기본 true)
 */
router.get('/', getPublicRentalItems);

/**
 * @route GET /api/rental-items/:id
 * @desc 특정 렌탈 아이템 상세 조회
 * @access Public
 */
router.get('/:id', getPublicRentalItemById);

module.exports = router;

// ============================================
// 관리자용 라우터 (별도 export)
// ============================================
const adminRouter = express.Router();

// 통계 조회 (먼저 정의해야 /:id와 충돌 방지)
adminRouter.get('/stats', authenticateAdmin, getRentalItemStats);

// 캘린더 조회 (/:id보다 먼저 정의)
adminRouter.get('/calendar', authenticateAdmin, getAllRentalItemsCalendar);
adminRouter.get('/:id/calendar', authenticateAdmin, getRentalItemCalendar);

// 대여 물품 CRUD
adminRouter.get('/', authenticateAdmin, getAllRentalItems);
adminRouter.get('/:id', authenticateAdmin, getRentalItemById);
adminRouter.post('/', authenticateAdmin, createRentalItem);
adminRouter.patch('/:id', authenticateAdmin, updateRentalItem);
adminRouter.delete('/:id', authenticateAdmin, deleteRentalItem);

module.exports.adminRouter = adminRouter;
