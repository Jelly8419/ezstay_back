/**
 * guestMoveInRoutes.js
 * 입주 준비 서비스 — 임차인(게스트) 라우트
 *
 * Mount: /api/guest/move-in  (server.js)
 *
 * Auth 정책:
 *   - GET /invite/:token        → optionalAuth (비로그인 OK, 로그인이면 phone 매칭으로 풀 노출)
 *   - POST /invite/:token/bind  → authenticateToken (필수)
 *   - 그 외 (Phase 6+) /requests, /payments → authenticateToken
 */

'use strict';

const express = require('express');
const router = express.Router();
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const {
  getInvitePreview,
  bindInvite
} = require('../controllers/guestMoveInInviteController');
const {
  getMyRequests,
  getRequestDetail,
  getOptions
} = require('../controllers/guestMoveInRequestController');
const {
  initPayment,
  confirmPayment,
  initAdditionalPayment,
  confirmAdditionalPayment,
  cancelPendingOrder,
  getPaymentResult
} = require('../controllers/guestMoveInPaymentController');

// ============================================
// 비로그인 가능 (optionalAuth)
// ============================================

/**
 * @route GET /api/guest/move-in/invite/:token
 * @desc  비로그인 미리보기 (옵션/가격/마감일)
 *        로그인 + phone 매칭 시 풀 정보 + 결제 가능 표시
 * @access Public (optional auth)
 */
router.get('/invite/:token', optionalAuth, getInvitePreview);

// ============================================
// 로그인 필수
// ============================================

/**
 * @route POST /api/guest/move-in/invite/:token/bind
 * @desc  로그인 후 phone 매칭 → guestUserId 연결
 *        (자동 매칭 hook 으로 이미 bound 됐어도 idempotent)
 * @access Authenticated user
 */
router.post('/invite/:token/bind', authenticateToken, bindInvite);

// ============================================
// 본인 케이스 조회 (Phase 6)
// ============================================

/**
 * @route GET /api/guest/move-in/requests
 * @desc  내 입주 준비 요청 목록 (status 필터, 페이지네이션)
 * @access Authenticated user
 */
router.get('/requests', authenticateToken, getMyRequests);

/**
 * @route GET /api/guest/move-in/requests/:caseId/options
 * @desc  옵션 카탈로그 + 결제 컨텍스트 (결제 화면 진입 시)
 *        (/:caseId 보다 먼저 정의 — 라우트 매칭 우선순위)
 * @access Authenticated user (본인 케이스만)
 */
router.get('/requests/:caseId/options', authenticateToken, getOptions);

/**
 * @route GET /api/guest/move-in/requests/:caseId
 * @desc  요청 상세 (옵션 + 본인 주문 + 결제 통합)
 * @access Authenticated user (본인 케이스만)
 */
router.get('/requests/:caseId', authenticateToken, getRequestDetail);

// ============================================
// INITIAL 결제 (Phase 7)
// ============================================

/**
 * @route POST /api/guest/move-in/requests/:caseId/payment/init
 * @desc  PENDING 주문 + 결제 생성, PG 페이로드 발급
 * @body  { items: [{ optionId, quantity }] }
 * @access Authenticated user (본인 케이스 + phone 매칭 + D-5 가드)
 */
router.post('/requests/:caseId/payment/init', authenticateToken, initPayment);

/**
 * @route POST /api/guest/move-in/requests/:caseId/payment/confirm
 * @desc  PG 결제 승인 (실모드: PayTag, Mock: PAYMENT_USE_MOCK=true)
 * @body  { paymentId, recvPayparam?, payType?, simulateFailure? }
 * @access Authenticated user
 */
router.post('/requests/:caseId/payment/confirm', authenticateToken, confirmPayment);

// ============================================
// ADDITIONAL 결제 (Phase 8) — 정책 #4: INITIAL 결제 완료 후 추가 결제 가능
// ============================================

/**
 * @route POST /api/guest/move-in/requests/:caseId/additional/init
 * @desc  추가 결제용 PENDING 주문 생성 + PG 페이로드
 *        (INITIAL 결제 완료 케이스만 진입 가능)
 * @body  { items: [{ optionId, quantity }] }
 * @access Authenticated user (본인 케이스 + phone 매칭 + D-5 가드)
 */
router.post('/requests/:caseId/additional/init', authenticateToken, initAdditionalPayment);

/**
 * @route POST /api/guest/move-in/requests/:caseId/additional/confirm
 * @desc  추가 결제 PG 승인 (init/confirm 동일 본체)
 * @body  { paymentId, recvPayparam?, payType?, simulateFailure? }
 * @access Authenticated user
 */
router.post('/requests/:caseId/additional/confirm', authenticateToken, confirmAdditionalPayment);

// ============================================
// 미결제 주문 취소 (Phase 9)
// ============================================

/**
 * @route DELETE /api/guest/move-in/orders/:orderId
 * @desc  PENDING 주문 취소 (라인/PENDING 결제 동반 CANCELLED)
 * @access Authenticated user (본인 주문만)
 */
router.delete('/orders/:orderId', authenticateToken, cancelPendingOrder);

// ============================================
// 결제 결과 조회 (Phase 10)
// ============================================

/**
 * @route GET /api/guest/move-in/payments/:paymentId
 * @desc  결제 결과 조회 (PRD 6.7 결제 완료 화면용)
 *        본인 결제만 조회 가능, 청소 정보 차단
 * @access Authenticated user
 */
router.get('/payments/:paymentId', authenticateToken, getPaymentResult);

module.exports = router;
