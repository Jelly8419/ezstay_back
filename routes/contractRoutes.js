const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const {
  createContractRequest,
  getGuestContracts,
  getHostContracts,
  getContractDetail
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

module.exports = router;
