const express = require('express');
const router = express.Router();
const {
  getRefundPolicies,
  getRefundPolicyDetail
} = require('../controllers/refundController');

/**
 * 환불 정책 조회 (인증 불필요)
 * GET /api/refund-policies
 *
 * 호스트가 방 등록 시 선택할 수 있는 환불 정책 목록 조회
 * 게스트가 예약 전 환불 정책 확인
 */
router.get('/refund-policies', getRefundPolicies);

/**
 * 특정 환불 정책 상세 조회 (인증 불필요)
 * GET /api/refund-policies/:policyType
 *
 * policyType: '약하게', '보통', '엄격하게'
 */
router.get('/refund-policies/:policyType', getRefundPolicyDetail);

module.exports = router;
