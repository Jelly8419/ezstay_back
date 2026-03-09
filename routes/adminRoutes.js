const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const adminAuthController = require('../controllers/adminAuthController');
const adminLogController = require('../controllers/adminLogController');
const adminPaymentController = require('../controllers/adminPaymentController');
const adminSettlementController = require('../controllers/adminSettlementController');
const noticeController = require('../controllers/noticeController');
const faqController = require('../controllers/faqController');
const inquiryController = require('../controllers/inquiryController');
const adminReceiptController = require('../controllers/adminReceiptController');
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

// 관리자 강제 취소
router.post(
  '/reservations/:contractId/force-cancel',
  requireAdminRole(['super_admin', 'admin']),
  adminController.adminForceCancel
);

// 호스트 취소 요청 승인
router.post(
  '/reservations/:contractId/approve-cancel-request',
  requireAdminRole(['super_admin', 'admin']),
  adminController.approveHostCancelRequest
);

// 호스트 취소 요청 거절
router.post(
  '/reservations/:contractId/reject-cancel-request',
  requireAdminRole(['super_admin', 'admin']),
  adminController.rejectHostCancelRequest
);

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

/**
 * 환불 관리
 */
// 환불 요청 목록 조회
router.get('/refunds', adminController.getRefunds);

// 환불 상세 조회
router.get('/refunds/:refundId', adminController.getRefundDetail);

// 환불 승인 (super_admin, admin만 가능)
router.patch(
  '/refunds/:refundId/approve',
  requireAdminRole(['super_admin', 'admin']),
  adminController.approveRefund
);

// 환불 거절 (super_admin, admin만 가능)
router.patch(
  '/refunds/:refundId/reject',
  requireAdminRole(['super_admin', 'admin']),
  adminController.rejectRefund
);

// ============================================
// 렌탈 주문 관리
// ============================================

// 렌탈 주문 목록 조회
router.get('/rental-orders', adminController.getRentalOrders);

// 렌탈 주문 상세 조회
router.get('/rental-orders/:rentalOrderId', adminController.getRentalOrderDetail);

// 계약별 렌탈 이력 조회
router.get('/contracts/:contractId/rental-history', adminController.getContractRentalHistory);

// 관리자 렌탈 주문 전체 취소 (super_admin, admin만 가능)
router.post(
  '/rental-orders/:rentalOrderId/cancel',
  requireAdminRole(['super_admin', 'admin']),
  adminController.adminCancelRentalOrder
);

// 렌탈 주문 배송 상태 변경 (super_admin, admin만 가능)
router.patch(
  '/rental-orders/:rentalOrderId/delivery-status',
  requireAdminRole(['super_admin', 'admin']),
  adminController.updateRentalOrderDeliveryStatus
);

// ============================================
// 보증금 보류 관리
// ============================================

// 보류 신청 목록 조회
router.get('/deposits/pending-holds', adminController.getPendingDepositHolds);

// 보류 신청 승인 (super_admin, admin만 가능)
router.post(
  '/deposits/:contractId/approve-hold',
  requireAdminRole(['super_admin', 'admin']),
  adminController.approveDepositHold
);

// 보류 신청 거절 (super_admin, admin만 가능)
router.post(
  '/deposits/:contractId/reject-hold',
  requireAdminRole(['super_admin', 'admin']),
  adminController.rejectDepositHold
);

// 강제 반환보류 (super_admin, admin만 가능)
router.post(
  '/deposits/:contractId/force-hold',
  requireAdminRole(['super_admin', 'admin']),
  adminController.forceDepositHold
);

// ============================================
// 결제 관리
// ============================================

// 결제 목록 조회
router.get('/payments', adminPaymentController.getPayments);

// 결제 상세 조회
router.get('/payments/:paymentId', adminPaymentController.getPaymentDetail);

// 관리자 환불 처리 (토스페이먼츠 연동, super_admin/admin만 가능)
router.post(
  '/payments/:paymentId/refund',
  requireAdminRole(['super_admin', 'admin']),
  adminPaymentController.processAdminRefund
);

// ============================================
// 정산 관리
// ============================================

// 정산 목록 조회
router.get('/settlements', adminSettlementController.getAdminSettlements);

// 정산 엑셀 내보내기 (⚠️ :contractId 라우트보다 먼저 등록)
router.get('/settlements/export', adminSettlementController.exportAdminSettlements);

// 정산 상세 조회
router.get('/settlements/:contractId', adminSettlementController.getAdminSettlementDetail);

// 정산 완료 처리 (super_admin, admin만 가능)
router.patch(
  '/settlements/:contractId/complete',
  requireAdminRole(['super_admin', 'admin']),
  adminSettlementController.markSettlementComplete
);

// 정산 보류 처리 (super_admin, admin만 가능)
router.patch(
  '/settlements/:contractId/hold',
  requireAdminRole(['super_admin', 'admin']),
  adminSettlementController.holdSettlement
);

// ============================================
// 영수증 관리
// ============================================

// 영수증 신청 목록 조회
router.get('/receipts', adminReceiptController.getReceiptList);

// 영수증 발급 완료 처리 (super_admin, admin만 가능)
router.patch(
  '/receipts/:id/issue',
  requireAdminRole(['super_admin', 'admin']),
  adminReceiptController.issueReceipt
);

// 영수증 반려 처리 (super_admin, admin만 가능)
router.patch(
  '/receipts/:id/reject',
  requireAdminRole(['super_admin', 'admin']),
  adminReceiptController.rejectReceipt
);

module.exports = router;
