/**
 * adminGuestOrderRoutes.js
 * 관리자 — 입주 준비 서비스 임차인 주문 모니터링 라우트
 *
 * Mount: /api/admin/move-in  (server.js 에서 옵션 라우트와 함께 마운트)
 */

'use strict';

const express = require('express');
const router = express.Router();
const { authenticateAdmin } = require('../middleware/auth');
const {
  listGuestOrders,
  getGuestOrder,
  updateDeliveryStatus,
  listRefundRequests,
  getRefundRequest,
  approveReturn,
  rejectReturn
} = require('../controllers/adminGuestOrderController');
const { listMoveInPayments } = require('../controllers/adminMoveInPaymentController');

/**
 * @route GET /api/admin/move-in/guest-orders
 * @desc  게스트 주문 목록 (필터 + 검색 + 페이지네이션)
 */
router.get('/guest-orders', authenticateAdmin, listGuestOrders);

/**
 * @route GET /api/admin/move-in/guest-orders/:orderId
 * @desc  주문 단건 상세 + 로그 (최신 50건)
 */
router.get('/guest-orders/:orderId', authenticateAdmin, getGuestOrder);

/**
 * @route PATCH /api/admin/move-in/guest-orders/:orderId/delivery
 * @desc  배송 상태 갱신 (PENDING ↔ IN_TRANSIT ↔ DELIVERED 전이 규칙 적용)
 * @body  { deliveryStatus, note? }
 */
router.patch('/guest-orders/:orderId/delivery', authenticateAdmin, updateDeliveryStatus);

/**
 * @route GET /api/admin/move-in/payments
 * @desc  결제 통합 내역 (청소+옵션, type/status/기간/검색 필터 + 페이지네이션)
 */
router.get('/payments', authenticateAdmin, listMoveInPayments);

/**
 * @route GET /api/admin/move-in/refund-requests
 * @desc  반품 요청 목록 (status/caseId 필터 + 페이지네이션)
 */
router.get('/refund-requests', authenticateAdmin, listRefundRequests);

/**
 * @route GET /api/admin/move-in/refund-requests/:requestId
 * @desc  반품 요청 단건 상세 (주문 라인 포함)
 */
router.get('/refund-requests/:requestId', authenticateAdmin, getRefundRequest);

/**
 * @route PATCH /api/admin/move-in/refund-requests/:requestId/approve
 * @desc  임차인 반품 요청 승인 (왕복배송비 차감 후 PG 환불)
 */
router.patch('/refund-requests/:requestId/approve', authenticateAdmin, approveReturn);

/**
 * @route PATCH /api/admin/move-in/refund-requests/:requestId/reject
 * @desc  임차인 반품 요청 거절 (라인 ACTIVE 원복)
 * @body  { rejectReason? }
 */
router.patch('/refund-requests/:requestId/reject', authenticateAdmin, rejectReturn);

module.exports = router;
