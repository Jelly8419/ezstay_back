/**
 * moveInRoutes.js
 * 입주 준비 서비스 (임대인용) 라우트
 * 마운트: /api/host/move-in
 *
 * 인증: 기존 hostRoutes와 동일하게 authenticateToken 적용
 */
const express = require('express');
const router = express.Router();

const { authenticateToken } = require('../middleware/auth');

const moveInRoomController = require('../controllers/moveInRoomController');
const moveInCaseController = require('../controllers/moveInCaseController');
const moveInCleaningController = require('../controllers/moveInCleaningController');
const moveInPaymentRequestController = require('../controllers/moveInPaymentRequestController');

router.use(authenticateToken);

// ============================================================================
// 간편 방 정보 (move_in_rooms)
// ============================================================================
router.get('/rooms', moveInRoomController.getRooms);
router.post('/rooms', moveInRoomController.createRoom);
router.get('/rooms/:roomId', moveInRoomController.getRoom);
router.patch('/rooms/:roomId', moveInRoomController.updateRoom);
router.delete('/rooms/:roomId', moveInRoomController.deleteRoom);

// ============================================================================
// 입주 준비 등록 (move_in_cases)
// ============================================================================
router.get('/cases', moveInCaseController.getCases);
router.post('/cases', moveInCaseController.createCase);
router.get('/cases/:caseId', moveInCaseController.getCase);
router.patch('/cases/:caseId', moveInCaseController.updateCase);

// ============================================================================
// 청소 신청 / 결제 (move_in_payments)
// ============================================================================
router.post('/cases/:caseId/cleaning/quote', moveInCleaningController.getCleaningQuote);
router.post('/cases/:caseId/cleaning/request', moveInCleaningController.requestCleaning);
router.delete('/cases/:caseId/cleaning/request', moveInCleaningController.cancelCleaning);
router.post('/cases/:caseId/cleaning/payment/init', moveInCleaningController.initCleaningPayment);
router.post('/cases/:caseId/cleaning/payment/confirm', moveInCleaningController.confirmCleaningPayment);
router.post('/cases/:caseId/cleaning/refund', moveInCleaningController.refundCleaningPayment);
router.get('/cases/:caseId/cleaning/refund/quote', moveInCleaningController.getCleaningRefundQuote);

// ============================================================================
// 임차인 결제 요청 발송 (move_in_payment_requests)
// ⚠️ 알림톡 템플릿 미등록 — 실제 발송은 TODO (controller dispatchPaymentRequestNotification 참조)
// ============================================================================
router.post('/cases/:caseId/payment-request/send', moveInPaymentRequestController.sendPaymentRequest);
router.post('/cases/:caseId/payment-request/resend', moveInPaymentRequestController.resendPaymentRequest);
router.get('/cases/:caseId/payment-request/link', moveInPaymentRequestController.getPaymentRequestLink);

module.exports = router;
