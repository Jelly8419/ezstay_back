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
const adminPayoutController = require('../controllers/adminPayoutController');
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

// 문의 답변 수정
router.patch('/support/inquiries/:id/answer', inquiryController.updateAnswer);

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

// 관리자 렌탈 주문 취소 (DEPRECATED: /rental-payments/:rentalOrderId/refund 로 대체)
// router.post(
//   '/rental-orders/:rentalOrderId/cancel',
//   requireAdminRole(['super_admin', 'admin']),
//   adminController.adminCancelRentalOrder
// );

// 렌탈 주문 배송 상태 변경 (super_admin, admin만 가능)
router.patch(
  '/rental-orders/:rentalOrderId/delivery-status',
  requireAdminRole(['super_admin', 'admin']),
  adminController.updateRentalOrderDeliveryStatus
);

// ============================================
// 보증금 보류 관리
// ============================================

// 보증금 보류 목록 조회 (전체 상태 + 필터)
router.get('/deposits', adminController.getDepositHolds);

// 보류 신청 목록 조회 (하위호환 - :contractId 라우트보다 먼저 등록)
router.get('/deposits/pending-holds', adminController.getPendingDepositHolds);

// 보증금 보류 상세 조회
router.get('/deposits/:contractId', adminController.getDepositHoldDetail);

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

// 보증금 환불 재시도 (REFUND_FAILED → PG 재시도)
router.post(
  '/deposits/:contractId/retry-refund',
  requireAdminRole(['super_admin', 'admin']),
  adminController.retryDepositRefund
);

// ============================================
// 결제 관리
// ============================================

// 탭1: 주문별 결제 현황 (주문번호 기준 1행, 최종 거래유형)
router.get('/payments/summary', adminPaymentController.getPaymentSummary);

// 탭2: 결제/취소 내역 (계약별 결제 요약)
router.get('/payments/logs', adminPaymentController.getPaymentLogs);

// 결제 상세 조회 (주문번호 기준, ?type=contract|rental)
router.get('/payments/:orderId', adminPaymentController.getPaymentDetail);

// 관리자 환불 처리 - 계약 결제 (INITIAL 렌탈 포함)
router.post(
  '/payments/:contractId/refund',
  requireAdminRole(['super_admin', 'admin']),
  adminPaymentController.processAdminRefund
);

// 관리자 환불 처리 - 렌탈 추가결제 (ADDITIONAL 렌탈 전용)
router.post(
  '/rental-payments/:rentalOrderId/refund',
  requireAdminRole(['super_admin', 'admin']),
  adminPaymentController.processAdminRentalRefund
);

// ============================================
// 옵션상품 환불 요청 관리 (입주중 취소 요청)
// ============================================

// 환불 요청 목록 조회
router.get(
  '/rental-refund-requests',
  requireAdminRole(['super_admin', 'admin']),
  adminPaymentController.getRentalRefundRequests
);

// 환불 요청 상세 조회
router.get(
  '/rental-refund-requests/:requestId',
  requireAdminRole(['super_admin', 'admin']),
  adminPaymentController.getRentalRefundRequestDetail
);

// 환불 요청 수락
router.post(
  '/rental-refund-requests/:requestId/approve',
  requireAdminRole(['super_admin', 'admin']),
  adminPaymentController.approveRentalRefundRequest
);

// 환불 요청 거절
router.post(
  '/rental-refund-requests/:requestId/reject',
  requireAdminRole(['super_admin', 'admin']),
  adminPaymentController.rejectRentalRefundRequest
);

// 수거 상태 업데이트
router.patch(
  '/rental-refund-requests/:requestId/retrieval',
  requireAdminRole(['super_admin', 'admin']),
  adminPaymentController.updateRentalRefundRetrieval
);

// ============================================
// 정산 관리 (settlements 테이블 기반)
// ============================================

// 정산 목록 조회
router.get('/settlements', adminSettlementController.getAdminSettlements);

// 정산 상세 조회 (⚠️ action 라우트보다 먼저)
router.get('/settlements/:settlementId', adminSettlementController.getAdminSettlementDetail);

// 정산 보류 처리 (super_admin, admin만 가능)
router.patch(
  '/settlements/:settlementId/hold',
  requireAdminRole(['super_admin', 'admin']),
  adminSettlementController.holdSettlement
);

// 정산 보류 해제 (super_admin, admin만 가능)
router.patch(
  '/settlements/:settlementId/unhold',
  requireAdminRole(['super_admin', 'admin']),
  adminSettlementController.unholdSettlement
);

// 정산 금액 조정 (super_admin, admin만 가능)
router.patch(
  '/settlements/:settlementId/adjust',
  requireAdminRole(['super_admin', 'admin']),
  adminSettlementController.adjustSettlement
);

// 정산 메모 업데이트
router.patch(
  '/settlements/:settlementId/note',
  requireAdminRole(['super_admin', 'admin']),
  adminSettlementController.updateSettlementNote
);

// ============================================
// 지급 관리 (Payout)
// ============================================

// 지급 목록 조회
router.get('/payouts', adminPayoutController.getPayouts);

// 지급 CSV 다운로드 (⚠️ /:payoutId 보다 먼저 등록)
router.get('/payouts/export', adminPayoutController.exportPayouts);

// 지급 상세 조회 (⚠️ action 라우트보다 먼저)
router.get('/payouts/:payoutId', adminPayoutController.getPayoutDetail);

// 지급 실행 (PAYABLE → COMPLETED)
router.post(
  '/payouts/:payoutId/execute',
  requireAdminRole(['super_admin', 'admin']),
  adminPayoutController.executePayout
);

// 지급 실패 처리
router.post(
  '/payouts/:payoutId/fail',
  requireAdminRole(['super_admin', 'admin']),
  adminPayoutController.failPayout
);

// 지급 취소
router.post(
  '/payouts/:payoutId/cancel',
  requireAdminRole(['super_admin', 'admin']),
  adminPayoutController.cancelPayout
);

// 지급 재시도 (FAILED → PAYABLE)
router.post(
  '/payouts/:payoutId/retry',
  requireAdminRole(['super_admin', 'admin']),
  adminPayoutController.retryPayout
);

// 지급 메모 업데이트
router.patch(
  '/payouts/:payoutId/note',
  requireAdminRole(['super_admin', 'admin']),
  adminPayoutController.updatePayoutNote
);

// ============================================
// 영수증 관리
// ============================================

// 영수증 발급 이력 조회 (발급 완료 건) - :id 라우트보다 먼저 선언
router.get('/receipts/history', adminReceiptController.getReceiptHistory);

// 영수증 CSV 다운로드 - :id 라우트보다 먼저 선언
router.get('/receipts/export', adminReceiptController.exportReceiptsCsv);

// 영수증 발급 리스트 조회 (발급대기/전체)
router.get('/receipts', adminReceiptController.getReceiptList);

// 영수증 상세 조회
router.get('/receipts/:id', adminReceiptController.getReceiptDetail);

// 영수증 발급 완료 처리 (super_admin, admin만 가능)
router.patch(
  '/receipts/:id/issue',
  requireAdminRole(['super_admin', 'admin']),
  adminReceiptController.issueReceipt
);

// ============================================
// 알림톡 관리
// ============================================

// 알림톡 템플릿 목록 조회
router.get('/alimtalk/templates', adminController.getAlimtalkTemplates);

// 알림톡 템플릿 캐시 수동 갱신 (super_admin, admin만 가능)
router.post(
  '/alimtalk/templates/sync',
  requireAdminRole(['super_admin', 'admin']),
  adminController.syncAlimtalkTemplates
);

// 알림톡 발송 이력 조회
router.get('/alimtalk/logs', adminController.getAlimtalkLogs);

// 알림톡 발송 통계
router.get('/alimtalk/stats', adminController.getAlimtalkStats);

// 알림톡 수동 재시도 (super_admin, admin만 가능)
router.post(
  '/alimtalk/logs/:logId/retry',
  requireAdminRole(['super_admin', 'admin']),
  adminController.retryAlimtalkLog
);

// ============================================
// 알림 큐 관리 (Redis Bull Queue)
// ============================================

// 전체 큐 현황 + delayed job 목록
router.get('/notification-queue/stats', adminController.getNotificationQueueStats);

// 큐 누락 계약 조회 (DB 기준으로 큐에 없는 알림 탐지)
router.get('/notification-queue/missing', adminController.getMissingNotificationQueue);

// 누락 알림 단건 복구 (super_admin, admin만 가능)
router.post(
  '/notification-queue/recover',
  requireAdminRole(['super_admin', 'admin']),
  adminController.recoverNotificationQueue
);

// 특정 계약의 예약된 알림 조회
router.get('/notification-queue/contract/:contractId', adminController.getContractNotificationQueue);

// ============================================
// 서비스 태스크 관리 (청소 / 침구류 대여·회수)
// ============================================

// 목록 조회 (?tab=pending|all &task_type= &status= &date_from= &date_to= &page= &limit=)
router.get('/service-tasks', adminController.getServiceTasks);

// 상태 변경 + 업체 정보 입력
router.patch(
  '/service-tasks/:id/status',
  requireAdminRole(['super_admin', 'admin']),
  adminController.updateServiceTaskStatus
);

module.exports = router;
