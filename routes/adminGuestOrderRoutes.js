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
  updateDeliveryStatus
} = require('../controllers/adminGuestOrderController');

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

module.exports = router;
