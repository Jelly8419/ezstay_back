const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const adminAuthController = require('../controllers/adminAuthController');
const adminLogController = require('../controllers/adminLogController');
const noticeController = require('../controllers/noticeController');
const faqController = require('../controllers/faqController');
const inquiryController = require('../controllers/inquiryController');
const { authenticateAdmin, requireAdminRole } = require('../middleware/auth');
const actionLogger = require('../middleware/actionLogger');
const { adminAuthLimiter, adminApiLimiter } = require('../middleware/rateLimiter');

/**
 * 관리자 인증 API (인증 불필요)
 */
router.post('/auth/login', adminAuthLimiter, adminAuthController.login);

// 이후 모든 라우트는 관리자 인증 필요
router.use(authenticateAdmin);

// 관리자 API Rate Limiter 적용 (인증 후)
router.use(adminApiLimiter);

// 액션 로거 미들웨어 적용 (인증 후)
router.use(actionLogger);

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

// --- 방 정보 관리 (관리자 전용) ---

// 방 상세 정보 조회 (메모, 계약 포함)
router.get('/properties/:roomId/management', adminController.getRoomManagementDetail);

// 방 상태 변경 (게시중 <-> 비게시)
router.patch(
  '/properties/:roomId/status',
  requireAdminRole(['super_admin', 'admin']),
  adminController.updateRoomStatus
);

// 방 상태 변경 이력 조회
router.get(
  '/properties/:roomId/status-history',
  requireAdminRole(['super_admin', 'admin']),
  adminController.getRoomStatusHistory
);

// 방 비밀번호 변경
router.patch(
  '/properties/:roomId/password',
  requireAdminRole(['super_admin', 'admin']),
  adminController.updateRoomPassword
);

// 방 비밀번호 변경 이력 조회
router.get(
  '/properties/:roomId/password-history',
  requireAdminRole(['super_admin', 'admin']),
  adminController.getRoomPasswordHistory
);

// 메모 생성
router.post('/properties/:roomId/memos', adminController.createRoomMemo);

// 메모 수정
router.patch('/properties/:roomId/memos/:memoId', adminController.updateRoomMemo);

// 메모 삭제
router.delete('/properties/:roomId/memos/:memoId', adminController.deleteRoomMemo);

/**
 * 예약 관리
 */
// 예약 목록
router.get('/reservations', adminController.getReservations);

// 예약 상세
router.get('/reservations/:contractId', adminController.getReservationDetail);

/**
 * 액션 로그 관리 (슈퍼 관리자만 접근 가능)
 */
// 액션 로그 목록
router.get(
  '/action-logs',
  requireAdminRole(['super_admin']),
  adminLogController.getActionLogs
);

// 액션 로그 통계
router.get(
  '/action-logs/stats',
  requireAdminRole(['super_admin']),
  adminLogController.getActionLogStats
);

// 액션 로그 상세
router.get(
  '/action-logs/:id',
  requireAdminRole(['super_admin']),
  adminLogController.getActionLogById
);

/**
 * 고객센터 관리 (cs_admin 이상 접근 가능)
 */
// 공지사항 목록 (관리자용)
router.get('/support/notices', noticeController.getNoticesAdmin);

// 공지사항 상세 (관리자용)
router.get('/support/notices/:id', noticeController.getNoticeByIdAdmin);

// 공지사항 생성
router.post('/support/notices', noticeController.createNotice);

// 공지사항 수정
router.patch('/support/notices/:id', noticeController.updateNotice);

// 공지사항 삭제
router.delete('/support/notices/:id', noticeController.deleteNotice);

// 공지사항 게시
router.patch('/support/notices/:id/publish', noticeController.publishNotice);

// FAQ 카테고리 목록 (관리자용)
router.get('/support/faq/categories', faqController.getFAQCategoriesAdmin);

// FAQ 카테고리 생성
router.post('/support/faq/categories', faqController.createFAQCategory);

// FAQ 카테고리 수정
router.patch('/support/faq/categories/:id', faqController.updateFAQCategory);

// FAQ 카테고리 삭제
router.delete('/support/faq/categories/:id', faqController.deleteFAQCategory);

// FAQ 목록 (관리자용)
router.get('/support/faqs', faqController.getFAQsAdmin);

// FAQ 상세 (관리자용)
router.get('/support/faqs/:id', faqController.getFAQByIdAdmin);

// FAQ 생성
router.post('/support/faqs', faqController.createFAQ);

// FAQ 수정
router.patch('/support/faqs/:id', faqController.updateFAQ);

// FAQ 삭제
router.delete('/support/faqs/:id', faqController.deleteFAQ);

// 문의 목록 (관리자용)
router.get('/support/inquiries', inquiryController.getInquiriesAdmin);

// 문의 상세 (관리자용)
router.get('/support/inquiries/:id', inquiryController.getInquiryByIdAdmin);

// 문의 답변 등록
router.post('/support/inquiries/:id/answer', inquiryController.answerInquiry);

// 문의 상태 변경
router.patch('/support/inquiries/:id/status', inquiryController.updateInquiryStatus);

// 문의 삭제 (관리자)
router.delete('/support/inquiries/:id', inquiryController.deleteInquiryAdmin);

module.exports = router;
