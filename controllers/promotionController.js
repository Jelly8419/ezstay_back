const { Op } = require('sequelize');
const { PromotionEvent, PromotionParticipant } = require('../models');
const { success, error, ErrorCodes } = require('../utils/responseHelper');
const { toKSTString } = require('../utils/dateHelper');

/**
 * GET /api/promotions/active
 *
 * 현재 진행 중인 모든 프로모션 이벤트 조회 (배너/모달 노출 판정용)
 * - 비로그인 호출 가능 (optionalAuth)
 * - 로그인 상태일 경우 본인 참여 여부(userStatus) 포함
 *
 * 활성 조건:
 *   isActive = true
 *   AND (startAt IS NULL OR startAt <= now)
 *   AND (endAt IS NULL OR endAt > now)
 *   AND (participantLimit IS NULL OR participant_count < participantLimit)
 */
const getActivePromotions = async (req, res) => {
  try {
    const now = new Date();

    const events = await PromotionEvent.findAll({
      where: {
        isActive: true,
        [Op.and]: [
          { [Op.or]: [{ startAt: null }, { startAt: { [Op.lte]: now } }] },
          { [Op.or]: [{ endAt: null }, { endAt: { [Op.gt]: now } }] }
        ]
      },
      order: [['createdAt', 'ASC']]
    });

    if (events.length === 0) {
      return success(res, { events: [] });
    }

    const eventIds = events.map(e => e.id);

    // 선착순 제한 있는 이벤트는 현재 참여자 수로 소진 여부 판단
    const participantCounts = await PromotionParticipant.findAll({
      where: { promotionEventId: { [Op.in]: eventIds } },
      attributes: [
        'promotionEventId',
        [PromotionParticipant.sequelize.fn('COUNT', PromotionParticipant.sequelize.col('id')), 'count']
      ],
      group: ['promotionEventId'],
      raw: true
    });
    const countMap = new Map(participantCounts.map(r => [r.promotionEventId, Number(r.count)]));

    // 로그인 상태면 본인 참여 현황 조회
    let userParticipantMap = new Map();
    if (req.user) {
      const participants = await PromotionParticipant.findAll({
        where: {
          userId: req.user.id,
          promotionEventId: { [Op.in]: eventIds }
        }
      });
      userParticipantMap = new Map(participants.map(p => [p.promotionEventId, p]));
    }

    const data = events
      .filter(e => {
        if (e.participantLimit == null) return true;
        const used = countMap.get(e.id) || 0;
        return used < e.participantLimit;
      })
      .map(e => {
        const result = {
          code: e.code,
          name: e.name,
          description: e.description,
          targetRole: e.targetRole,
          benefitType: e.benefitType,
          discountAmount: e.discountAmount,
          startAt: toKSTString(e.startAt),
          endAt: toKSTString(e.endAt)
        };

        if (req.user) {
          const myParticipant = userParticipantMap.get(e.id);
          result.userStatus = {
            isParticipant: !!myParticipant,
            hasConsumed: !!(myParticipant && myParticipant.consumedContractId)
          };
        }

        return result;
      });

    return success(res, { events: data });
  } catch (err) {
    console.error('Get active promotions error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

module.exports = { getActivePromotions };
