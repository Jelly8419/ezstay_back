/**
 * adminMoveInCaseRoutes.js
 * 관리자 — 입주 준비 서비스 케이스 단위 조회/수정 라우트
 *
 * Mount: /api/admin/move-in  (server.js 에서 옵션·게스트주문 라우트와 함께 마운트)
 * Auth:  authenticateAdmin (라우트 단위)
 *
 * 화면: 노션 "입주 준비 서비스 Admin" — 케이스 1건 = 1행
 */

'use strict';

const express = require('express');
const router = express.Router();
const { authenticateAdmin } = require('../middleware/auth');
const {
  listCases,
  getCase,
  updateCase,
  resendPaymentRequest
} = require('../controllers/adminMoveInCaseController');

/**
 * @route GET /api/admin/move-in/cases
 * @desc  케이스 목록 (필터: cleaningStatus, 입주/퇴실 기간, search; 페이지네이션)
 */
router.get('/cases', authenticateAdmin, listCases);

/**
 * @route GET /api/admin/move-in/cases/:caseId
 * @desc  케이스 단건 상세 (방·임대인·임차인·청소·옵션 그룹별·요청링크·관리자메모·최종수정자)
 */
router.get('/cases/:caseId', authenticateAdmin, getCase);

/**
 * @route PATCH /api/admin/move-in/cases/:caseId
 * @desc  케이스 부분 수정 (현 단계: adminMemo 만)
 *        호출 시 lastModifiedByAdminId / lastModifiedAt 자동 갱신
 */
router.patch('/cases/:caseId', authenticateAdmin, updateCase);

/**
 * @route POST /api/admin/move-in/cases/:caseId/payment-request/resend
 * @desc  임차인 결제 요청 알림톡 재발송 (resendCount++, lastResentAt 갱신)
 */
router.post('/cases/:caseId/payment-request/resend', authenticateAdmin, resendPaymentRequest);

module.exports = router;
