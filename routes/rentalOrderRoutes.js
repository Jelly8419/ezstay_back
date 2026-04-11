const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const {
  getRentalOrders,
  createRentalOrder,
  getRentalOrderPaymentInfo,
  confirmRentalPayment,
  cancelRentalOrder,
  cancelPaidRentalOrderByGuest,
  getAvailableRentalItems,
  cancelRentalItemsByGuest,
  requestRentalItemsReturn,
  getReturnRefundPreview
} = require('../controllers/rentalOrderController');

/**
 * 렌탈 주문 API 라우트
 *
 * 게스트용 렌탈 주문 관리 API
 * - 계약 후 입주일 5일 전까지 렌탈 아이템 추가/취소 가능
 * - 추가 주문 시 별도 결제, 취소 시 환불 처리
 */

// =====================================================
// 계약 기반 라우트 (Contract ID 사용)
// =====================================================

/**
 * 렌탈 주문 목록 조회
 * GET /api/contracts/:contractId/rental-orders
 *
 * @description 계약에 연결된 모든 렌탈 주문 목록과 요약 정보 조회
 * @access 게스트, 호스트
 */
router.get(
  '/contracts/:contractId/rental-orders',
  authenticateToken,
  getRentalOrders
);

/**
 * 이용 가능한 렌탈 아이템 목록 조회
 * GET /api/contracts/:contractId/available-rental-items
 *
 * @description 해당 계약 기간에 이용 가능한 렌탈 아이템 목록 조회
 * @access 게스트
 */
router.get(
  '/contracts/:contractId/available-rental-items',
  authenticateToken,
  getAvailableRentalItems
);

/**
 * 추가 렌탈 주문 생성
 * POST /api/contracts/:contractId/rental-orders
 *
 * @description 추가 렌탈 아이템 주문 생성 (결제 대기 상태)
 * @access 게스트
 * @body { items: [{ itemId: number, quantity: number }] }
 */
router.post(
  '/contracts/:contractId/rental-orders',
  authenticateToken,
  createRentalOrder
);

// =====================================================
// 렌탈 주문 기반 라우트 (RentalOrder ID 사용)
// =====================================================

/**
 * 렌탈 주문 결제 정보 조회
 * GET /api/rental-orders/:rentalOrderId/payment-info
 *
 * @description 추가 렌탈 주문의 결제 정보 조회 (토스페이먼츠 연동용)
 * @access 게스트
 */
router.get(
  '/rental-orders/:rentalOrderId/payment-info',
  authenticateToken,
  getRentalOrderPaymentInfo
);

/**
 * 렌탈 주문 결제 승인
 * POST /api/rental-orders/:rentalOrderId/confirm-payment
 *
 * @description 토스페이먼츠 결제 승인 후 렌탈 주문 확정
 * @access 게스트
 * @body { paymentKey: string, orderId: string, amount: number }
 */
router.post(
  '/rental-orders/:rentalOrderId/confirm-payment',
  authenticateToken,
  confirmRentalPayment
);

/**
 * 미결제 렌탈 주문 취소
 * DELETE /api/rental-orders/:rentalOrderId
 *
 * @description 결제 전 렌탈 주문 취소 (재고 복구)
 * @access 게스트
 */
router.delete(
  '/rental-orders/:rentalOrderId',
  authenticateToken,
  cancelRentalOrder
);

/**
 * 결제 완료된 렌탈 주문 취소 (환불)
 * POST /api/rental-orders/:rentalOrderId/cancel
 *
 * @description 결제 완료된 렌탈 주문 전체 취소 및 환불 (주문 단위)
 * @access 게스트
 * @body { reason?: string }
 */
router.post(
  '/rental-orders/:rentalOrderId/cancel',
  authenticateToken,
  cancelPaidRentalOrderByGuest
);

/**
 * 아이템 단위 즉시환불 (배송전 전용)
 * POST /api/contracts/:contractId/rental-items/cancel
 *
 * @description 배송전 상태 아이템 복수 선택 즉시환불. 여러 주문건 혼합 가능.
 * @access 게스트
 * @body { itemIds: number[], reason?: string }
 */
router.post(
  '/contracts/:contractId/rental-items/cancel',
  authenticateToken,
  cancelRentalItemsByGuest
);

/**
 * 아이템 단위 반품 신청 (배송중/배송완료 전용)
 * POST /api/contracts/:contractId/rental-items/return-request
 *
 * @description 배송중/완료 상태 아이템 복수 선택 반품 신청. 여러 주문건 혼합 가능.
 * @access 게스트
 * @body { itemIds: number[], reason: string }
 */
router.post(
  '/contracts/:contractId/rental-items/return-request',
  authenticateToken,
  requestRentalItemsReturn
);

/**
 * 반품 신청 전 환불 예상 금액 조회
 * POST /api/contracts/:contractId/rental-items/return-preview
 *
 * @description 반품 신청 전 선택 아이템의 환불 예상 금액 및 수거비 차감 여부 확인.
 * @access 게스트
 * @body { items: [{ id, returnQuantity }] }
 */
router.post(
  '/contracts/:contractId/rental-items/return-preview',
  authenticateToken,
  getReturnRefundPreview
);

module.exports = router;
