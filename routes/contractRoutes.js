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
  cancelContractByGuest,
  calculateRefundPreview,
  requestRefund,
  getContractRefunds,
  getPaymentInfo,
  confirmPayment,
  updatePendingRentalItems
} = require('../controllers/contractController');
const { confirmPaymentMock } = require('../controllers/mockPaymentController');

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
 *   "deposit": 300000,
 *   "finalTotalAmount": 1558000,
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
 * 승인 대기 중인 계약의 렌탈 아이템 수정 (장바구니)
 * PATCH /api/contracts/:contractId/rental-items
 *
 * @description PENDING_APPROVAL 상태에서만 사용 가능 (결제 전 장바구니)
 * @access 게스트
 * @body { rentalItems: [{ itemId: number, quantity: number }] }
 *
 * 응답:
 * {
 *   "contractId": 123,
 *   "rentalItems": [{ itemId, name, price, quantity, totalPrice, ... }],
 *   "rentalItemsFee": 50000,
 *   "finalTotalAmount": 1608000
 * }
 */
router.patch('/:contractId/rental-items', authenticateToken, updatePendingRentalItems);

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

/**
 * 환불 금액 미리 계산 (게스트가 취소하기 전에 확인)
 * POST /api/contracts/:contractId/calculate-refund
 *
 * Request Body (optional):
 * {
 *   "cancellation_date": "2025-01-25T10:00:00Z" (선택사항, 기본값: 현재 시간)
 * }
 */
router.post('/:contractId/calculate-refund', authenticateToken, calculateRefundPreview);

/**
 * 환불 요청 (게스트가 계약 취소 및 환불 요청)
 * POST /api/contracts/:contractId/request-refund
 *
 * Request Body:
 * {
 *   "cancellation_reason": "개인 사정으로 입주가 어려워졌습니다.",
 *   "refund_method": "ORIGINAL_PAYMENT",
 *   "refund_account_info": {
 *     "bank_name": "신한은행",
 *     "account_number": "110-123-456789",
 *     "account_holder": "홍길동"
 *   }
 * }
 */
router.post('/:contractId/request-refund', authenticateToken, requestRefund);

/**
 * 환불 이력 조회 (게스트/호스트)
 * GET /api/contracts/:contractId/refunds
 */
router.get('/:contractId/refunds', authenticateToken, getContractRefunds);

/**
 * 결제 정보 조회 (게스트가 결제하기 전에 호출)
 * GET /api/contracts/:contractId/payment-info
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "contractId": 123,
 *     "orderId": "250111-00001",
 *     "amount": 1558000,
 *     "orderName": "강남 원룸 (31박)",
 *     "customerEmail": "guest@example.com",
 *     "customerName": "홍길동"
 *   }
 * }
 */
router.get('/:contractId/payment-info', authenticateToken, getPaymentInfo);

/**
 * 결제 승인 (토스페이먼츠 API 호출)
 * POST /api/contracts/:contractId/confirm-payment
 *
 * Request Body:
 * {
 *   "paymentKey": "tvivaTV20240129141323PWvNQ",
 *   "orderId": "250111-00001",
 *   "amount": 1558000
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "contractId": 123,
 *     "orderId": "250111-00001",
 *     "status": "PAYMENT_COMPLETED",
 *     "payment": {
 *       "paymentKey": "tvivaTV20240129141323PWvNQ",
 *       "method": "CARD",
 *       "status": "DONE",
 *       "totalAmount": 1558000,
 *       "approvedAt": "2025-01-11T10:30:00.000Z",
 *       "receiptUrl": "https://dashboard.tosspayments.com/receipt/..."
 *     }
 *   },
 *   "message": "결제가 완료되었습니다"
 * }
 */
router.post('/:contractId/confirm-payment', authenticateToken, confirmPayment);

/**
 * Mock 결제 승인 (개발/테스트 환경 전용)
 * POST /api/contracts/:contractId/confirm-payment-mock
 *
 * Request Body:
 * {
 *   "orderId": "250111-00001",
 *   "amount": 1558000,
 *   "simulateFailure": false (optional, true면 실패 시뮬레이션)
 * }
 *
 * 활성화 조건: process.env.PAYMENT_MOCK_MODE === 'true'
 */
if (process.env.PAYMENT_MOCK_MODE === 'true') {
  router.post('/:contractId/confirm-payment-mock', authenticateToken, confirmPaymentMock);
  console.log('⚠️ Mock 결제 모드 활성화');
}

module.exports = router;
