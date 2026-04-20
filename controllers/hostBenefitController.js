const { PromotionEvent, PromotionParticipant } = require('../models');
const { success, ErrorCodes, error } = require('../utils/responseHelper');

const HOST_EVENT_CODE = 'LAUNCH_HOST_2026';

/**
 * GET /api/host/benefit-status
 * 호스트 런칭 이벤트 혜택 상태 조회
 * - eventActive: 이벤트가 현재 진행 중이며 선착순 잔여 있음
 * - isEligible: 본인이 자격 보유자
 * - benefitUsed: 본인 자격을 이미 사용 (정산 발생)
 */
const getBenefitStatus = async (req, res) => {
  try {
    const hostId = req.user.id;

    const event = await PromotionEvent.findOne({ where: { code: HOST_EVENT_CODE } });
    if (!event) {
      return success(res, { eventActive: false, isEligible: false, benefitUsed: false });
    }

    const totalCount = await PromotionParticipant.count({ where: { promotionEventId: event.id } });
    const eventActive = event.isActive
      && (event.participantLimit == null || totalCount < event.participantLimit);

    const myParticipant = await PromotionParticipant.findOne({
      where: { promotionEventId: event.id, userId: hostId }
    });

    const isEligible = !!myParticipant;
    const benefitUsed = !!(myParticipant && myParticipant.consumedContractId);

    return success(res, { eventActive, isEligible, benefitUsed });
  } catch (err) {
    console.error('Get benefit status error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

module.exports = { getBenefitStatus };
