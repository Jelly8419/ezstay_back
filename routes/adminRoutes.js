const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const adminAuthController = require('../controllers/adminAuthController');
const { authenticateAdmin, requireAdminRole } = require('../middleware/auth');

/**
 * 관리자 인증 API (인증 불필요)
 */
router.post('/auth/login', adminAuthController.login);

// 이후 모든 라우트는 관리자 인증 필요
router.use(authenticateAdmin);

// 관리자 인증 API (인증 필요)
router.post('/auth/logout', adminAuthController.logout);
router.get('/auth/me', adminAuthController.getMe);

/**
 * 대시보드
 */
// 대시보드 통계
router.get('/dashboard/stats', adminController.getDashboardStats);

// 최근 활동
router.get('/dashboard/recent-activities', adminController.getRecentActivities);

/**
 * 유저 관리
 */
// 유저 목록
router.get('/users', adminController.getUsers);

// 유저 상세
router.get('/users/:userId', adminController.getUserDetail);

// 유저 상태 변경 (super_admin, admin만 가능)
router.patch(
  '/users/:userId/status',
  requireAdminRole(['super_admin', 'admin']),
  adminController.updateUserStatus
);

/**
 * 매물 관리
 */
// 매물 목록
router.get('/properties', adminController.getProperties);

// 심사 대기 매물 목록
router.get('/properties/pending-review', adminController.getPendingReviews);

// 매물 상세 조회 (심사용) - ⚠️ pending-review 다음에 배치해야 함!
router.get('/properties/:roomId', adminController.getPropertyDetail);

// 매물 승인 (super_admin, admin만 가능)
router.post(
  '/properties/:roomId/approve',
  requireAdminRole(['super_admin', 'admin']),
  adminController.approveProperty
);

// 매물 반려 (super_admin, admin만 가능)
router.post(
  '/properties/:roomId/reject',
  requireAdminRole(['super_admin', 'admin']),
  adminController.rejectProperty
);

/**
 * 예약 관리
 */
// 예약 목록
router.get('/reservations', adminController.getReservations);

// 예약 상세
router.get('/reservations/:contractId', adminController.getReservationDetail);

module.exports = router;
