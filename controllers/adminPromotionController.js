const { Op } = require('sequelize');
const { sequelize, PromotionEvent, PromotionParticipant, ContractBenefit, Contract, User } = require('../models');
const { success, created, updated, error, ErrorCodes } = require('../utils/responseHelper');
const { toKSTString } = require('../utils/dateHelper');

/**
 * GET /api/admin/promotions
 * 이벤트 목록 + 참여자 수 / 혜택 사용 수 집계
 */
const listPromotions = async (req, res) => {
  try {
    const events = await PromotionEvent.findAll({ order: [['createdAt', 'DESC']] });

    const eventIds = events.map(e => e.id);
    const [participantCounts, consumedCounts, benefitCounts] = await Promise.all([
      PromotionParticipant.findAll({
        where: { promotionEventId: { [Op.in]: eventIds } },
        attributes: ['promotionEventId', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
        group: ['promotionEventId'],
        raw: true
      }),
      PromotionParticipant.findAll({
        where: {
          promotionEventId: { [Op.in]: eventIds },
          consumedContractId: { [Op.ne]: null }
        },
        attributes: ['promotionEventId', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
        group: ['promotionEventId'],
        raw: true
      }),
      ContractBenefit.findAll({
        where: {
          promotionEventId: { [Op.in]: eventIds },
          status: 'ACTIVE'
        },
        attributes: ['promotionEventId', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
        group: ['promotionEventId'],
        raw: true
      })
    ]);

    const partMap = new Map(participantCounts.map(r => [r.promotionEventId, Number(r.count)]));
    const consumedMap = new Map(consumedCounts.map(r => [r.promotionEventId, Number(r.count)]));
    const benefitMap = new Map(benefitCounts.map(r => [r.promotionEventId, Number(r.count)]));

    const data = events.map(e => ({
      id: e.id,
      code: e.code,
      name: e.name,
      description: e.description,
      targetRole: e.targetRole,
      benefitType: e.benefitType,
      discountAmount: e.discountAmount,
      participantLimit: e.participantLimit,
      applyTrigger: e.applyTrigger,
      applyOnce: e.applyOnce,
      startAt: toKSTString(e.startAt),
      endAt: toKSTString(e.endAt),
      isActive: e.isActive,
      stats: {
        participantCount: partMap.get(e.id) || 0,
        consumedCount: consumedMap.get(e.id) || 0,
        activeBenefitCount: benefitMap.get(e.id) || 0
      },
      createdAt: toKSTString(e.createdAt),
      updatedAt: toKSTString(e.updatedAt)
    }));

    return success(res, { events: data });
  } catch (err) {
    console.error('List promotions error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * GET /api/admin/promotions/:id
 */
const getPromotionDetail = async (req, res) => {
  try {
    const event = await PromotionEvent.findByPk(req.params.id);
    if (!event) return error(res, { code: 4404, message: '이벤트를 찾을 수 없습니다' }, 404);

    return success(res, {
      id: event.id,
      code: event.code,
      name: event.name,
      description: event.description,
      targetRole: event.targetRole,
      benefitType: event.benefitType,
      discountAmount: event.discountAmount,
      participantLimit: event.participantLimit,
      applyTrigger: event.applyTrigger,
      applyOnce: event.applyOnce,
      startAt: toKSTString(event.startAt),
      endAt: toKSTString(event.endAt),
      isActive: event.isActive,
      createdAt: toKSTString(event.createdAt),
      updatedAt: toKSTString(event.updatedAt)
    });
  } catch (err) {
    console.error('Get promotion detail error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * POST /api/admin/promotions
 */
const createPromotion = async (req, res) => {
  try {
    const {
      code, name, description, targetRole, benefitType, discountAmount,
      participantLimit, applyTrigger, applyOnce, startAt, endAt, isActive
    } = req.body;

    if (!code || !name || !targetRole || !benefitType || discountAmount == null || !applyTrigger) {
      return error(res, { code: 4400, message: '필수 파라미터 누락' }, 400);
    }

    const exists = await PromotionEvent.findOne({ where: { code } });
    if (exists) return error(res, { code: 4409, message: '이미 존재하는 이벤트 코드입니다' }, 409);

    const event = await PromotionEvent.create({
      code,
      name,
      description: description || null,
      targetRole,
      benefitType,
      discountAmount,
      participantLimit: participantLimit != null ? participantLimit : null,
      applyTrigger,
      applyOnce: applyOnce !== false,
      startAt: startAt || null,
      endAt: endAt || null,
      isActive: isActive !== false
    });

    return created(res, { id: event.id });
  } catch (err) {
    console.error('Create promotion error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * PATCH /api/admin/promotions/:id
 */
const updatePromotion = async (req, res) => {
  try {
    const event = await PromotionEvent.findByPk(req.params.id);
    if (!event) return error(res, { code: 4404, message: '이벤트를 찾을 수 없습니다' }, 404);

    const allowed = [
      'name', 'description', 'discountAmount', 'participantLimit',
      'applyOnce', 'startAt', 'endAt', 'isActive'
    ];
    const patch = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) patch[key] = req.body[key];
    }

    await event.update(patch);
    return updated(res, { id: event.id });
  } catch (err) {
    console.error('Update promotion error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * GET /api/admin/promotions/:id/participants
 */
const listParticipants = async (req, res) => {
  try {
    const eventId = req.params.id;
    const participants = await PromotionParticipant.findAll({
      where: { promotionEventId: eventId },
      include: [
        { model: User, as: 'user', attributes: ['id', 'email', 'name'] },
        { model: Contract, as: 'consumedContract', attributes: ['id', 'orderId', 'status'] }
      ],
      order: [['appliedAt', 'ASC']]
    });

    const data = participants.map(p => ({
      id: p.id,
      userId: p.userId,
      userEmail: p.user?.email || null,
      userName: p.user?.name || null,
      appliedAt: toKSTString(p.appliedAt),
      notifiedAt: toKSTString(p.notifiedAt),
      consumed: p.consumedContractId != null,
      consumedAt: toKSTString(p.consumedAt),
      consumedContract: p.consumedContract ? {
        id: p.consumedContract.id,
        orderId: p.consumedContract.orderId,
        status: p.consumedContract.status
      } : null
    }));

    return success(res, { participants: data });
  } catch (err) {
    console.error('List participants error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * GET /api/admin/promotions/:id/benefits
 */
const listBenefits = async (req, res) => {
  try {
    const eventId = req.params.id;
    const benefits = await ContractBenefit.findAll({
      where: { promotionEventId: eventId },
      include: [{
        model: Contract,
        as: 'contract',
        attributes: ['id', 'orderId', 'status', 'guestId', 'hostId']
      }],
      order: [['appliedAt', 'DESC']]
    });

    const data = benefits.map(b => ({
      id: b.id,
      contractId: b.contractId,
      orderId: b.contract?.orderId || null,
      contractStatus: b.contract?.status || null,
      guestId: b.contract?.guestId || null,
      hostId: b.contract?.hostId || null,
      benefitType: b.benefitType,
      discountAmount: b.discountAmount,
      status: b.status,
      appliedAt: toKSTString(b.appliedAt),
      voidedAt: toKSTString(b.voidedAt),
      voidedReason: b.voidedReason
    }));

    return success(res, { benefits: data });
  } catch (err) {
    console.error('List benefits error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

module.exports = {
  listPromotions,
  getPromotionDetail,
  createPromotion,
  updatePromotion,
  listParticipants,
  listBenefits
};
