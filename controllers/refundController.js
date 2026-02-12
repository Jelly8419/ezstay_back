const { RefundPolicyType, RefundPolicyRule, Refund, Contract, Room } = require('../models');
const { success, error, created, ErrorCodes } = require('../utils/responseHelper');
const {
  calculateRefund,
  getRefundPolicyInfo,
  getAllRefundPolicies
} = require('../utils/refundCalculator');

/**
 * GET /api/refund-policies
 * 모든 환불 정책 조회
 */
const getRefundPolicies = async (req, res) => {
  try {
    const result = await getAllRefundPolicies();

    if (!result.success) {
      return error(res, {
        code: 5002,
        message: result.error.message
      }, 500);
    }

    return success(res, result.data, '환불 정책 목록을 조회했습니다.');
  } catch (err) {
    console.error('환불 정책 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * GET /api/refund-policies/:policyType
 * 특정 환불 정책 상세 조회
 */
const getRefundPolicyDetail = async (req, res) => {
  try {
    const { policyType } = req.params;

    const result = await getRefundPolicyInfo(policyType);

    if (!result.success) {
      return error(res, ErrorCodes.NOT_FOUND, 404, result.error.message);
    }

    return success(res, result.data, '환불 정책 상세 정보를 조회했습니다.');
  } catch (err) {
    console.error('환불 정책 상세 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

module.exports = {
  getRefundPolicies,
  getRefundPolicyDetail
};
