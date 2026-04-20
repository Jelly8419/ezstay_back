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
 * 활성 이벤트 조회 (target_role + apply_trigger 기준)
 * - is_active = true
 * - start_at <= now (or NULL)
 * - end_at > now (or NULL)
 */
const getActiveEvents = async ({ targetRole, applyTrigger, transaction } = {}) => {
  const now = new Date();
  const where = {
    isActive: true,
    [Op.and]: [
      { [Op.or]: [{ startAt: null }, { startAt: { [Op.lte]: now } }] },
      { [Op.or]: [{ endAt: null }, { endAt: { [Op.gt]: now } }] }
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
 * @returns {Promise<Array<{event: Object, participant: Object, discountAmount: number}>>}
 *   소진 성공한 이벤트 목록 (여러 이벤트 중첩 가능)
 */
const consumeBenefits = async ({ userId, targetRole, applyTrigger, contractId, transaction }) => {
  const events = await getActiveEvents({ targetRole, applyTrigger, transaction });
  const consumed = [];

  for (const event of events) {
    const participant = await PromotionParticipant.findOne({
      where: { promotionEventId: event.id, userId },
      transaction
    });
    if (!participant) continue;
    if (event.applyOnce && participant.consumedContractId != null) continue;

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
        discountAmount: event.discountAmount,
        status: 'ACTIVE',
        appliedAt: new Date()
      }, { transaction });

      consumed.push({
        event,
        participant,
        discountAmount: event.discountAmount
      });
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
        discountAmount: event.discountAmount
      };
    })
    .filter(Boolean);
};

module.exports = {
  getActiveEvents,
  registerParticipant,
  consumeBenefits,
  voidContractBenefits,
  getUserEligibility
};
