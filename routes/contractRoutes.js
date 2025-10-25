const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const {
  createContractRequest,
  getGuestContracts,
  getHostContracts,
  getContractDetail,
  approveContract,
  rejectContract,
  cancelContractByGuest
} = require('../controllers/contractController');

/**
 * 계약 요청 생성 (게스트 -> 호스트)
 * POST /api/contracts/request
 *
 * Request Body:
 * {
 *   "roomId": 123,
 *   "checkInDate": "2025-12-18 15:00",
 *   "checkOutDate": "2026-01-18 11:00",
 *   "totalDays": 31,
 *   "rentalFee": 1000000,
 *   "maintenanceFee": 200000,
 *   "cleaningFee": 50000,
 *   "rentalItemsFee": 30000,
 *   "platformFee": 78000,
 *   "discountAmount": 50000,
 *   "subtotal": 1280000,
 *   "totalUsageFee": 1258000,
 *   "deposit": 330000,
 *   "finalTotalAmount": 1588000,
 *   "rentalItems": { ... },
 *   "guestMessage": "오후 3시쯤 입주 예정입니다.",
 *   "discountCode": "WINTER2025",
 *   "paymentMethod": "CREDIT_CARD",
 *   "installmentMonths": 0,
 *   "termsAgreed": {
 *     "serviceTerms": true,
 *     "cancellationPolicy": true,
 *     "refundPolicy": true
 *   },
 *   "specialRequests": { ... },
 *   "pricingSnapshot": { ... }
 * }
 */
router.post('/request', authenticateToken, createContractRequest);

/**
 * 게스트의 계약 요청 목록 조회
 * GET /api/contracts/guest?status=PENDING_APPROVAL
 *
 * Query Parameters:
 * - status (optional): 계약 상태 필터링
 */
router.get('/guest', authenticateToken, getGuestContracts);

/**
 * 호스트가 받은 계약 요청 목록 조회
 * GET /api/contracts/host?status=PENDING_APPROVAL
 *
 * Query Parameters:
 * - status (optional): 계약 상태 필터링
 */
router.get('/host', authenticateToken, getHostContracts);

/**
 * 계약 상세 정보 조회 (호스트 또는 게스트)
 * GET /api/contracts/:contractId
 */
router.get('/:contractId', authenticateToken, getContractDetail);

/**
 * 호스트가 계약 승인
 * PATCH /api/contracts/:contractId/approve
 */
router.patch('/:contractId/approve', authenticateToken, approveContract);

/**
 * 호스트가 계약 거절
 * PATCH /api/contracts/:contractId/reject
 *
 * Request Body:
 * {
 *   "hostMessage": "죄송합니다. 해당 기간에는 다른 예약이 있습니다."
 * }
 */
router.patch('/:contractId/reject', authenticateToken, rejectContract);

/**
 * 게스트가 계약 요청 취소 (승인 대기 중일 때만 가능)
 * PATCH /api/contracts/:contractId/cancel
 *
 * Request Body:
 * {
 *   "cancellationReason": "계획이 변경되어 취소합니다." (선택사항)
 * }
 */
router.patch('/:contractId/cancel', authenticateToken, cancelContractByGuest);

module.exports = router;
