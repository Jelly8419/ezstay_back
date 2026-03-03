const { RefundPolicyType, RefundPolicyRule, Room, EzService } = require('../models');
const { Op } = require('sequelize');

// 수수료율 상수
const HOST_PLATFORM_FEE_RATE = 0.033; // 호스트 서비스 수수료 3.3%

/**
 * 환불 금액 계산 유틸리티
 * 정책 기반: 임대료에만 환불율 적용
 * - 임대료: 환불율에 따라 부분 환불
 * - 관리비, 청소비: 항상 100% 환불
 * - 보증금: 항상 100% 환불
 * - 수수료: 100% 환불 시에만 환불, 부분 환불 시 비환불
 * - 위약금: floor(임대료 × (100-환불율)%), 호스트 수령 시 3.3% 수수료 차감
 */

/**
 * 환불 금액 계산 메인 함수
 * @param {Object} contract - 계약 정보 (Contract 모델 인스턴스)
 * @param {Date} cancellationDate - 취소 시점 (기본값: 현재 시간)
 * @param {Object} options - 추가 옵션
 * @param {String} options.faultType - 귀책 구분 ('GUEST' | 'HOST', 기본값: 'GUEST')
 * @returns {Promise<Object>} 환불 계산 결과
 */
async function calculateRefund(contract, cancellationDate = new Date(), options = {}) {
  try {
    const faultType = options.faultType || 'GUEST';

    // 1. 방 정보 및 EZ클리닝 여부 로드
    const room = await Room.findByPk(contract.roomId, {
      include: [{
        model: EzService,
        as: 'ezService',
        required: false
      }]
    });
    if (!room) {
      throw new Error('방 정보를 찾을 수 없습니다.');
    }

    const policyType = room.refundPolicy;
    if (!policyType) {
      throw new Error('환불 정책이 설정되지 않았습니다.');
    }

    const hasEzCleaningService = room.ezService?.cleaningService || false;

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
    // 결제 당일 기준: paidAt 사용 (결제 전 취소 시 createdAt fallback)
    const paymentDate = contract.paidAt || contract.createdAt;

    // 입주일까지 남은 일수 계산 (정수, 음수 가능)
    const daysBeforeCheckin = Math.floor(
      (checkInDate - cancellationDate) / (1000 * 60 * 60 * 24)
    );

    // 결제 당일 취소 여부 확인 (날짜만 비교)
    const isSameDayCancellation = isSameDay(paymentDate, cancellationDate);

    // 4. 환불율 결정 (게스트·호스트 귀책 동일 로직)
    let refundRate;
    let applicableRuleDescription = '';
    let applicableRule;

    // 4-1. 결제 당일 취소인 경우 결제 당일 취소 규칙 우선 적용
    if (isSameDayCancellation) {
      applicableRule = policy.rules.find(rule => rule.isSameDayCancellation === true);

      if (applicableRule) {
        refundRate = parseFloat(applicableRule.refundRate);
        applicableRuleDescription = applicableRule.description || '결제 당일 취소';
      } else {
        // DB에 결제 당일 취소 규칙이 없는 경우
        // 먼저 기간별 규칙 확인 (무료 취소 기간인지 체크)
        applicableRule = findApplicableRule(policy.rules, daysBeforeCheckin);
        if (applicableRule && parseFloat(applicableRule.refundRate) === 100) {
          // 무료 취소 기간에 해당 → 100% 환불
          refundRate = 100;
          applicableRuleDescription = applicableRule.description || '무료 취소 기간';
        } else {
          // 무료 취소 기간 아님 → 결제 당일 상위 정책 적용: 임대료 10% 위약금
          refundRate = 90;
          applicableRuleDescription = '결제 당일 취소 (상위 정책: 임대료 10% 위약금)';
        }
      }
    } else {
      // 4-2. 계약 당일이 아닌 경우 기간별 규칙 적용
      applicableRule = findApplicableRule(policy.rules, daysBeforeCheckin);

      if (applicableRule) {
        refundRate = parseFloat(applicableRule.refundRate);
        applicableRuleDescription = applicableRule.description || '해당 기간 환불 규칙';
      } else {
        refundRate = 0;
        applicableRuleDescription = '환불 불가';
      }
    }

    // 5. 원본 금액 추출
    const rentalFee = contract.rentalFee || 0;
    const maintenanceFee = contract.maintenanceFee || 0;
    const cleaningFee = contract.cleaningFee || 0;
    const deposit = contract.deposit || 0;
    const platformFee = contract.platformFee || 0;

    // 6. 이용료 계산 (환불율 적용 기준 = 임대료만)
    // 관리비, 청소비는 항상 100% 환불이므로 이용료에 포함하지 않음
    const usageFee = rentalFee;

    // 7. 환불 금액 계산 (귀책 구분에 따라 분기)
    let usageFeeRefundAmount;
    let depositRefundAmount;
    let cleaningFeeRefundAmount;
    let maintenanceFeeRefundAmount;
    let guestServiceFeeRefunded;
    let penaltyAmount;
    let hostPenaltyFee;
    let hostPenaltyAmount;
    let totalRefundAmount;

    // 관리비·청소비는 귀책과 무관하게 항상 100% 환불
    cleaningFeeRefundAmount = cleaningFee;
    maintenanceFeeRefundAmount = maintenanceFee;

    if (faultType === 'HOST') {
      // ─── 호스트 귀책: 게스트 전액 환불 ───
      usageFeeRefundAmount = usageFee; // 임대료 100%
      depositRefundAmount = deposit;
      guestServiceFeeRefunded = true;

      // 호스트 위약금 = 현재 시점 환불정책 기준 임대료 위약금
      penaltyAmount = Math.floor(usageFee * ((100 - refundRate) / 100));
      hostPenaltyFee = Math.floor(penaltyAmount * HOST_PLATFORM_FEE_RATE);
      hostPenaltyAmount = penaltyAmount - hostPenaltyFee;

      // 게스트 환불 총액 = 결제 전액
      totalRefundAmount = deposit + usageFee + cleaningFee + maintenanceFee + platformFee;
    } else {
      // ─── 게스트 귀책 ───
      depositRefundAmount = deposit; // 보증금 항상 100%

      if (refundRate === 100) {
        // 100% 환불: 전액 (보증금 + 임대료 + 관리비 + 청소비 + 수수료)
        usageFeeRefundAmount = usageFee;
        guestServiceFeeRefunded = true;
        penaltyAmount = 0;
        hostPenaltyFee = 0;
        hostPenaltyAmount = 0;
        totalRefundAmount = deposit + usageFee + cleaningFee + maintenanceFee + platformFee;
      } else if (refundRate > 0) {
        // 부분 환불: 보증금 + 임대료×환불율 + 관리비 + 청소비, 수수료 비환불
        usageFeeRefundAmount = Math.floor(usageFee * (refundRate / 100));
        guestServiceFeeRefunded = false;
        penaltyAmount = Math.floor(usageFee * ((100 - refundRate) / 100));
        hostPenaltyFee = Math.floor(penaltyAmount * HOST_PLATFORM_FEE_RATE);
        hostPenaltyAmount = penaltyAmount - hostPenaltyFee;
        totalRefundAmount = deposit + usageFeeRefundAmount + cleaningFee + maintenanceFee;
      } else {
        // 0% 환불: 보증금 + 관리비 + 청소비만 환불 (임대료 환불 없음)
        usageFeeRefundAmount = 0;
        guestServiceFeeRefunded = false;
        penaltyAmount = usageFee; // 임대료 전액이 위약금
        hostPenaltyFee = Math.floor(penaltyAmount * HOST_PLATFORM_FEE_RATE);
        hostPenaltyAmount = penaltyAmount - hostPenaltyFee;
        totalRefundAmount = deposit + cleaningFee + maintenanceFee;
      }
    }

    // 8. 하위 호환용 기존 필드 매핑
    const rentalFeeRefundAmount = usageFeeRefundAmount;
    const platformFeeDeducted = guestServiceFeeRefunded ? 0 : platformFee;
    const finalRefundAmount = totalRefundAmount;

    // 9. 결과 반환
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
        isSameDayCancellation,

        // 귀책 및 EZ클리닝 정보
        cancellationFaultType: faultType,
        hasEzCleaningService,

        // 원본 금액
        originalRentalFee: rentalFee,
        originalCleaningFee: cleaningFee,
        originalMaintenanceFee: maintenanceFee,
        originalDeposit: deposit,
        originalPlatformFee: platformFee,
        originalTotalAmount: contract.finalTotalAmount,

        // 이용료 기반 환불 계산 (신규)
        usageFee,
        usageFeeRefundAmount,
        depositRefundAmount,

        // 환불 계산 결과 (하위 호환)
        rentalFeeRefundRate: refundRate,
        rentalFeeRefundAmount,
        cleaningFeeRefundAmount,
        maintenanceFeeRefundAmount,
        totalRefundAmount,

        // 위약금 분배
        penaltyAmount,
        hostPenaltyFee,
        hostPenaltyAmount,

        // 수수료
        guestServiceFeeRefunded,
        platformFeeDeducted,
        finalRefundAmount,

        // 안내 메시지
        message: generateRefundMessage(
          daysBeforeCheckin,
          refundRate,
          faultType
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
 * @param {String} faultType - 귀책 구분
 * @param {Boolean} hasEzCleaning - EZ클리닝 사용 여부
 * @returns {String} 안내 메시지
 */
function generateRefundMessage(daysBeforeCheckin, refundRate, faultType) {
  if (faultType === 'HOST') {
    return '호스트 귀책 취소로 결제 금액 전액이 환불됩니다.';
  }

  if (daysBeforeCheckin < 0) {
    return '입주일이 지나 임대료 환불이 불가능합니다. 보증금, 관리비, 청소비는 100% 환불됩니다.';
  }

  if (refundRate === 100) {
    return `입주일 ${daysBeforeCheckin}일 전 취소로 결제 금액 전액이 환불됩니다.`;
  } else if (refundRate > 0) {
    return `입주일 ${daysBeforeCheckin}일 전 취소로 임대료의 ${refundRate}%가 환불됩니다. 보증금, 관리비, 청소비는 100% 환불됩니다. 게스트 서비스 수수료는 환불되지 않습니다.`;
  } else {
    return `입주일 ${daysBeforeCheckin}일 전 취소로 임대료는 환불되지 않습니다. 보증금, 관리비, 청소비는 100% 환불됩니다.`;
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
          depositRefund: '보증금은 항상 100% 환불됩니다.',
          cleaningAndMaintenanceRefund: '관리비와 청소비는 항상 100% 환불됩니다.',
          serviceFeeRefund: '게스트 서비스 수수료는 100% 환불 시에만 환불됩니다.'
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
