/**
 * Promotion Service
 * 프로모션 이벤트 자격/혜택 관리 로직
 *
 * - 자격 등록: 선착순 제한 체크 후 PromotionParticipant INSERT
 * - 혜택 소진: 조건부 UPDATE로 race-free 슬롯 점유
 * - 혜택 무효화: 계약 취소/거절/만료 시 ContractBenefit VOIDED + 슬롯 복구
 */

const { Op } = require('sequelize');
const { PromotionEvent, PromotionParticipant, ContractBenefit } = require('../models');

/**
 * 이벤트의 특정 시점 기준 활성 여부 검사
 * - isActive = true
 * - referenceAt 가 [startAt, endAt] 구간 내
 *
 * 호스트 런칭 이벤트는 이 함수를 Payment.approvedAt 으로 호출하여
 * "결제 시점에 이벤트가 열려 있었는가" 를 기준으로 혜택 지급 여부 결정.
 *
 * @param {Object} event - PromotionEvent 인스턴스 또는 plain object
 * @param {Date}   referenceAt - 판정 기준 시각 (기본: 현재)
 */
const isEventActiveAt = (event, referenceAt = new Date()) => {
  if (!event || !event.isActive) return false;
  if (event.startAt && new Date(event.startAt) > referenceAt) return false;
  if (event.endAt && new Date(event.endAt) <= referenceAt) return false;
  return true;
};

/**
 * 활성 이벤트 조회 (target_role + apply_trigger 기준)
 * - is_active = true
 * - start_at <= referenceAt (or NULL)
 * - end_at > referenceAt (or NULL)
 *
 * referenceAt 을 지정하면 해당 시점 기준으로 조회.
 * 호스트 정산 혜택은 Payment.approvedAt 을 넘겨야 "결제 시점 기준"으로
 * 이벤트가 열려 있었는지 판정할 수 있음 (입주가 end_at 이후여도 결제가
 * 이전이면 혜택 적용).
 */
const getActiveEvents = async ({ targetRole, applyTrigger, referenceAt, transaction } = {}) => {
  const ref = referenceAt || new Date();
  const where = {
    isActive: true,
    [Op.and]: [
      { [Op.or]: [{ startAt: null }, { startAt: { [Op.lte]: ref } }] },
      { [Op.or]: [{ endAt: null }, { endAt: { [Op.gt]: ref } }] }
    ]
  };
  if (targetRole) where.targetRole = targetRole;
  if (applyTrigger) where.applyTrigger = applyTrigger;

  return PromotionEvent.findAll({ where, transaction });
};

/**
 * 자격 등록 (방 승인 / 지역 알림 신청 등)
 *
 * @returns {Promise<{registered: boolean, participant: Object|null, reason?: string}>}
 *   - registered: true  → 신규 등록됨
 *   - registered: false → 이미 등록됨 or 선착순 초과
 */
const registerParticipant = async ({ eventCode, userId, transaction }) => {
  const event = await PromotionEvent.findOne({ where: { code: eventCode }, transaction });
  if (!event || !event.isActive) {
    return { registered: false, participant: null, reason: 'EVENT_INACTIVE' };
  }

  const existing = await PromotionParticipant.findOne({
    where: { promotionEventId: event.id, userId },
    transaction
  });
  if (existing) {
    return { registered: false, participant: existing, reason: 'ALREADY_REGISTERED' };
  }

  if (event.participantLimit != null) {
    const count = await PromotionParticipant.count({
      where: { promotionEventId: event.id },
      transaction,
      lock: transaction ? transaction.LOCK.UPDATE : undefined
    });
    if (count >= event.participantLimit) {
      return { registered: false, participant: null, reason: 'LIMIT_REACHED' };
    }
  }

  const participant = await PromotionParticipant.create({
    promotionEventId: event.id,
    userId,
    appliedAt: new Date()
  }, { transaction });

  return { registered: true, participant };
};

/**
 * 혜택 슬롯 소진 (계약 생성 or Settlement 생성 시)
 *
 * 조건부 UPDATE로 원자적으로 슬롯 점유 → race condition 방지
 *
 * @param {Object} params
 * @param {number} params.userId
 * @param {string} params.targetRole      'HOST' | 'GUEST'
 * @param {string} params.applyTrigger    'CONTRACT' | 'SETTLEMENT'
 * @param {number} params.contractId
 * @param {Date}   [params.referenceAt]   유효기간 판정 기준 시각 (기본: 현재).
 *                                        호스트 정산 혜택은 Payment.approvedAt 을 넘겨야 함.
 * @param {number} [params.feeCap]        FEE_WAIVER_FULL 혜택의 할인 상한 (platformFee 값).
 *                                        미지정 시 0 처리되므로 호스트 정산 경로에서는 반드시 전달.
 * @param {Object} [params.transaction]
 * @returns {Promise<Array<{event: Object, participant: Object, discountAmount: number}>>}
 */
const consumeBenefits = async ({
  userId, targetRole, applyTrigger, contractId,
  referenceAt, feeCap, transaction
}) => {
  // 1) referenceAt 기준으로 활성 이벤트 조회 (id 오름차순 — 등록순 적용)
  //    호스트 정산 혜택은 Payment.approvedAt 을 넘겨서 "결제 시점 기준" 판정.
  //    입주/정산 시점이 end_at 이후여도 결제가 이전이었으면 혜택 적용됨.
  const events = await getActiveEvents({ targetRole, applyTrigger, referenceAt, transaction });
  events.sort((a, b) => a.id - b.id);

  // 수수료 상한 추적 — 누적 할인이 수수료를 초과하지 않도록 클램핑
  // feeCap 미지정 시 상한 없음 (게스트 경로에서 feeCap 전달 안 할 경우 대비, 단 현재는 양쪽 모두 전달)
  let remainingFee = feeCap == null ? Infinity : Math.max(0, feeCap);
  const consumed = [];

  for (const event of events) {
    // 남은 수수료가 0이면 더 이상 혜택 소진 의미 없음 → 슬롯 보존
    if (remainingFee <= 0) break;

    const participant = await PromotionParticipant.findOne({
      where: { promotionEventId: event.id, userId },
      transaction
    });
    if (!participant) continue;
    if (event.applyOnce && participant.consumedContractId != null) continue;

    // 3) 혜택 금액 산출 (수수료 상한으로 클램핑)
    //    - FEE_WAIVER_FULL: 남은 수수료 전액 면제 (event.discountAmount 무시)
    //    - FIXED_AMOUNT   : min(event.discountAmount, 남은 수수료)
    const rawDiscount = event.benefitMode === 'FEE_WAIVER_FULL'
      ? remainingFee
      : event.discountAmount;
    const discountAmount = Math.min(rawDiscount, remainingFee);

    // 실제 깎일 금액이 0이면 소진 의미 없음 → 슬롯 보존 (스킵)
    if (discountAmount <= 0) continue;

    const [affectedRows] = await PromotionParticipant.update(
      { consumedContractId: contractId, consumedAt: new Date() },
      {
        where: {
          id: participant.id,
          consumedContractId: null
        },
        transaction
      }
    );

    if (affectedRows === 1) {
      await ContractBenefit.create({
        contractId,
        promotionEventId: event.id,
        benefitType: event.benefitType,
        discountAmount, // 실제 적용된 금액 (수수료 상한 클램핑 반영)
        status: 'ACTIVE',
        appliedAt: new Date()
      }, { transaction });

      consumed.push({
        event,
        participant,
        discountAmount
      });

      remainingFee -= discountAmount;
    }
  }

  return consumed;
};

/**
 * 계약의 혜택 무효화 + 슬롯 복구
 * - 계약 취소 / 거절 / 만료 시 호출
 * - 특정 benefitType 만 무효화하려면 benefitTypes 지정
 *
 * @param {Object} params
 * @param {number} params.contractId
 * @param {string} params.reason - 무효화 사유
 * @param {string[]} [params.benefitTypes] - 특정 타입만 무효화 (기본: 전체)
 * @param {Object} [params.transaction]
 */
const voidContractBenefits = async ({ contractId, reason, benefitTypes, transaction }) => {
  const where = { contractId, status: 'ACTIVE' };
  if (benefitTypes && benefitTypes.length > 0) {
    where.benefitType = { [Op.in]: benefitTypes };
  }

  const benefits = await ContractBenefit.findAll({ where, transaction });
  if (benefits.length === 0) return { voidedCount: 0 };

  const now = new Date();
  await ContractBenefit.update(
    { status: 'VOIDED', voidedAt: now, voidedReason: reason },
    { where: { id: { [Op.in]: benefits.map(b => b.id) } }, transaction }
  );

  const eventIds = [...new Set(benefits.map(b => b.promotionEventId).filter(Boolean))];
  if (eventIds.length > 0) {
    await PromotionParticipant.update(
      { consumedContractId: null, consumedAt: null },
      {
        where: {
          promotionEventId: { [Op.in]: eventIds },
          consumedContractId: contractId
        },
        transaction
      }
    );
  }

  return { voidedCount: benefits.length };
};

/**
 * 게스트의 혜택 자격 조회 (프론트 금액 미리보기용)
 * - 아직 소진하지 않은 참여 가능 이벤트 목록
 */
const getUserEligibility = async ({ userId, targetRole, applyTrigger }) => {
  const events = await getActiveEvents({ targetRole, applyTrigger });
  if (events.length === 0) return [];

  const participants = await PromotionParticipant.findAll({
    where: {
      userId,
      promotionEventId: { [Op.in]: events.map(e => e.id) }
    }
  });

  const participantMap = new Map(participants.map(p => [p.promotionEventId, p]));

  return events
    .map(event => {
      const p = participantMap.get(event.id);
      if (!p) return null;
      if (event.applyOnce && p.consumedContractId != null) return null;
      return {
        eventId: event.id,
        eventCode: event.code,
        eventName: event.name,
        benefitType: event.benefitType,
        benefitMode: event.benefitMode,
        // FEE_WAIVER_FULL 은 적용 시점(정산)의 platformFee 에 따라 결정됨
        // 프리뷰 시점에는 event.discountAmount(=0)가 의미 없음 → 호출자가 mode 별 분기 필요
        discountAmount: event.discountAmount
      };
    })
    .filter(Boolean);
};

/**
 * ContractBenefit 레코드를 받아 원본/할인 분리 요약 생성
 * - 이미 로드된 benefits 배열(include 결과)을 받으므로 추가 쿼리 없음
 * - ACTIVE 만 집계, VOIDED 는 제외
 *
 * @param {Array} benefits - Contract.benefits (include 결과). 각 항목은 event alias 로 PromotionEvent 포함 기대
 * @param {string} [benefitType] - 'GUEST_DISCOUNT' | 'HOST_FEE_WAIVER' (미지정 시 전체)
 * @returns {{ discount: number, appliedPromotions: Array }}
 */
const summarizeContractBenefits = (benefits, benefitType) => {
  if (!Array.isArray(benefits) || benefits.length === 0) {
    return { discount: 0, appliedPromotions: [] };
  }
  const filtered = benefits.filter(b =>
    b.status === 'ACTIVE' && (!benefitType || b.benefitType === benefitType)
  );
  const discount = filtered.reduce((sum, b) => sum + (b.discountAmount || 0), 0);
  const appliedPromotions = filtered.map(b => ({
    eventCode: b.event?.code || null,
    eventName: b.event?.name || null,
    benefitType: b.benefitType,
    discountAmount: b.discountAmount
  }));
  return { discount, appliedPromotions };
};

module.exports = {
  getActiveEvents,
  isEventActiveAt,
  registerParticipant,
  consumeBenefits,
  voidContractBenefits,
  getUserEligibility,
  summarizeContractBenefits
};
