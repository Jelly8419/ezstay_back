const { RefundPolicyType, RefundPolicyRule, Room } = require('../models');
const { Op } = require('sequelize');

/**
 * 환불 금액 계산 유틸리티
 * 계약 정보와 취소 시점을 기반으로 환불 금액을 계산합니다.
 */

/**
 * 환불 금액 계산 메인 함수
 * @param {Object} contract - 계약 정보 (Contract 모델 인스턴스)
 * @param {Date} cancellationDate - 취소 시점 (기본값: 현재 시간)
 * @returns {Promise<Object>} 환불 계산 결과
 */
async function calculateRefund(contract, cancellationDate = new Date()) {
  try {
    // 1. 방 정보 및 환불 정책 로드
    const room = await Room.findByPk(contract.roomId);
    if (!room) {
      throw new Error('방 정보를 찾을 수 없습니다.');
    }

    const policyType = room.refundPolicy;
    if (!policyType) {
      throw new Error('환불 정책이 설정되지 않았습니다.');
    }

    // 2. 환불 정책 및 규칙 조회
    const policy = await RefundPolicyType.findOne({
      where: { policyType },
      include: [{
        model: RefundPolicyRule,
        as: 'rules',
        required: false,
        order: [['days_before_min', 'DESC']]
      }]
    });

    if (!policy) {
      throw new Error(`환불 정책 '${policyType}'을 찾을 수 없습니다.`);
    }

    // 3. 취소 시점 분석
    const checkInDate = contract.checkInDate;
    const contractCreatedDate = contract.createdAt;

    // 입주일까지 남은 일수 계산 (정수)
    const daysBeforeCheckin = Math.floor(
      (checkInDate - cancellationDate) / (1000 * 60 * 60 * 24)
    );

    // 계약 당일 취소 여부 확인 (날짜만 비교)
    const isSameDayCancellation = isSameDay(contractCreatedDate, cancellationDate);

    // 4. 환불율 결정
    let rentalFeeRefundRate;
    let applicableRuleDescription = '';
    let applicableRule;

    // 4-1. 계약 당일 취소인 경우 계약 당일 취소 규칙 우선 적용
    if (isSameDayCancellation) {
      applicableRule = policy.rules.find(rule => rule.isSameDayCancellation === true);

      if (applicableRule) {
        rentalFeeRefundRate = parseFloat(applicableRule.refundRate);
        applicableRuleDescription = applicableRule.description || '계약 당일 취소';
      } else {
        // 계약 당일 취소 규칙이 없으면 기간별 규칙으로 폴백
        applicableRule = findApplicableRule(policy.rules, daysBeforeCheckin);
        if (applicableRule) {
          rentalFeeRefundRate = parseFloat(applicableRule.refundRate);
          applicableRuleDescription = applicableRule.description || '해당 기간 환불 규칙';
        } else {
          rentalFeeRefundRate = 0;
          applicableRuleDescription = '환불 불가';
        }
      }
    } else {
      // 4-2. 계약 당일이 아닌 경우 기간별 규칙 적용
      applicableRule = findApplicableRule(policy.rules, daysBeforeCheckin);

      if (applicableRule) {
        rentalFeeRefundRate = parseFloat(applicableRule.refundRate);
        applicableRuleDescription = applicableRule.description || '해당 기간 환불 규칙';
      } else {
        // 적용 가능한 규칙이 없으면 0% 환불
        rentalFeeRefundRate = 0;
        applicableRuleDescription = '환불 불가';
      }
    }

    // 5. 환불 금액 계산
    const rentalFeeRefund = Math.floor(contract.rentalFee * (rentalFeeRefundRate / 100));

    // 청소비와 관리비는 항상 100% 환불
    const cleaningFeeRefund = contract.cleaningFee || 0;
    const maintenanceFeeRefund = contract.maintenanceFee || 0;

    const totalRefund = rentalFeeRefund + cleaningFeeRefund + maintenanceFeeRefund;

    // 6. 수수료 및 위약금 계산 (향후 정책에 따라 구현)
    const platformFeeDeducted = 0; // 플랫폼 수수료 (정책에 따라 결정)
    const penaltyAmount = 0; // 위약금 (약관 위반 시)

    const finalRefund = totalRefund - platformFeeDeducted - penaltyAmount;

    // 7. 결과 반환
    return {
      success: true,
      data: {
        // 정책 정보
        policyTypeUsed: policyType,
        policyDisplayName: policy.displayName,
        applicableRuleDescription,

        // 시점 정보
        cancellationDate,
        checkInDate: contract.checkInDate,
        daysBeforeCheckin,

        // 원본 금액
        originalRentalFee: contract.rentalFee,
        originalCleaningFee: contract.cleaningFee || 0,
        originalMaintenanceFee: contract.maintenanceFee || 0,
        originalTotalAmount: contract.finalTotalAmount,

        // 환불 계산 결과
        rentalFeeRefundRate,
        rentalFeeRefundAmount: rentalFeeRefund,
        cleaningFeeRefundAmount: cleaningFeeRefund,
        maintenanceFeeRefundAmount: maintenanceFeeRefund,
        totalRefundAmount: totalRefund,

        // 수수료 및 공제액
        platformFeeDeducted,
        penaltyAmount,
        finalRefundAmount: finalRefund,

        // 안내 메시지
        message: generateRefundMessage(
          daysBeforeCheckin,
          rentalFeeRefundRate
        )
      }
    };
  } catch (error) {
    return {
      success: false,
      error: {
        message: error.message,
        code: 'REFUND_CALCULATION_ERROR'
      }
    };
  }
}

/**
 * 적용 가능한 환불 규칙 찾기 (기간별 규칙만 검색, 계약 당일 취소 규칙 제외)
 * @param {Array} rules - 환불 규칙 배열
 * @param {Number} daysBeforeCheckin - 입주일까지 남은 일수
 * @returns {Object|null} 적용 가능한 규칙 또는 null
 */
function findApplicableRule(rules, daysBeforeCheckin) {
  if (!rules || rules.length === 0) {
    return null;
  }

  // 입주일까지 남은 일수가 음수인 경우 (이미 입주일이 지남)
  if (daysBeforeCheckin < 0) {
    return null;
  }

  // 계약 당일 취소 규칙 제외하고 기간별 규칙만 필터링
  const periodRules = rules.filter(rule => !rule.isSameDayCancellation);

  // 규칙 배열을 순회하며 적용 가능한 규칙 찾기
  for (const rule of periodRules) {
    const minDays = rule.daysBeforeMin;
    const maxDays = rule.daysBeforeMax;

    if (maxDays === null) {
      // maxDays가 null이면 "N일 이전" (상한 없음)
      if (daysBeforeCheckin >= minDays) {
        return rule;
      }
    } else {
      // maxDays가 있으면 범위 체크
      if (daysBeforeCheckin >= minDays && daysBeforeCheckin <= maxDays) {
        return rule;
      }
    }
  }

  // 적용 가능한 규칙이 없으면 null 반환
  return null;
}

/**
 * 환불 안내 메시지 생성
 * @param {Number} daysBeforeCheckin - 입주일까지 남은 일수
 * @param {Number} refundRate - 환불율
 * @returns {String} 안내 메시지
 */
function generateRefundMessage(daysBeforeCheckin, refundRate) {
  if (daysBeforeCheckin < 0) {
    return '입주일이 지나 환불이 불가능합니다.';
  }

  if (refundRate === 100) {
    return `입주일 ${daysBeforeCheckin}일 전 취소로 임대료 전액이 환불됩니다. 청소비와 관리비도 100% 환불됩니다.`;
  } else if (refundRate > 0) {
    return `입주일 ${daysBeforeCheckin}일 전 취소로 임대료의 ${refundRate}%가 환불됩니다. 청소비와 관리비는 100% 환불됩니다.`;
  } else {
    return `입주일 ${daysBeforeCheckin}일 전 취소로 임대료는 환불되지 않습니다. 청소비와 관리비는 100% 환불됩니다.`;
  }
}

/**
 * 환불 정책 정보 조회 (프론트엔드 표시용)
 * @param {String} policyType - 정책 타입 ('약하게', '보통', '엄격하게')
 * @returns {Promise<Object>} 환불 정책 정보
 */
async function getRefundPolicyInfo(policyType) {
  try {
    const policy = await RefundPolicyType.findOne({
      where: { policyType, isActive: true },
      include: [{
        model: RefundPolicyRule,
        as: 'rules',
        required: false,
        order: [['days_before_min', 'DESC']]
      }]
    });

    if (!policy) {
      throw new Error(`환불 정책 '${policyType}'을 찾을 수 없습니다.`);
    }

    // 규칙을 프론트엔드 친화적인 형태로 변환
    const formattedRules = policy.rules.map(rule => {
      let periodDescription;
      if (rule.daysBeforeMax === null) {
        periodDescription = `입주일 ${rule.daysBeforeMin}일 이전`;
      } else if (rule.daysBeforeMin === 0 && rule.daysBeforeMax === 0) {
        periodDescription = '입주일 당일';
      } else {
        periodDescription = `입주일 ${rule.daysBeforeMax}~${rule.daysBeforeMin}일 이전`;
      }

      return {
        period: periodDescription,
        refundRate: parseFloat(rule.refundRate),
        description: rule.description || periodDescription
      };
    });

    return {
      success: true,
      data: {
        policyType: policy.policyType,
        displayName: policy.displayName,
        description: policy.description,
        rules: formattedRules,
        specialRules: {
          alwaysRefund: '청소비와 관리비는 100% 환불됩니다.'
        }
      }
    };
  } catch (error) {
    return {
      success: false,
      error: {
        message: error.message,
        code: 'POLICY_FETCH_ERROR'
      }
    };
  }
}

/**
 * 두 날짜가 같은 날인지 확인 (날짜만 비교, 시간 무시)
 * @param {Date} date1 - 첫 번째 날짜
 * @param {Date} date2 - 두 번째 날짜
 * @returns {Boolean} 같은 날이면 true
 */
function isSameDay(date1, date2) {
  const d1 = new Date(date1);
  const d2 = new Date(date2);

  return d1.getFullYear() === d2.getFullYear() &&
         d1.getMonth() === d2.getMonth() &&
         d1.getDate() === d2.getDate();
}

/**
 * 모든 환불 정책 조회 (호스트가 방 등록 시 선택용)
 * @returns {Promise<Array>} 환불 정책 목록
 */
async function getAllRefundPolicies() {
  try {
    const policies = await RefundPolicyType.findAll({
      where: { isActive: true },
      include: [{
        model: RefundPolicyRule,
        as: 'rules',
        required: false,
        order: [['days_before_min', 'DESC']]
      }],
      order: [
        // 약하게 → 보통 → 엄격하게 순서로 정렬
        ['policy_type', 'ASC']
      ]
    });

    const formattedPolicies = await Promise.all(
      policies.map(async policy => {
        const policyInfo = await getRefundPolicyInfo(policy.policyType);
        return policyInfo.data;
      })
    );

    return {
      success: true,
      data: formattedPolicies
    };
  } catch (error) {
    return {
      success: false,
      error: {
        message: error.message,
        code: 'POLICIES_FETCH_ERROR'
      }
    };
  }
}

module.exports = {
  calculateRefund,
  getRefundPolicyInfo,
  getAllRefundPolicies
};
