const { sequelize } = require('../models');
const promotionService = require('../services/promotionService');
const { success, created, ErrorCodes, error } = require('../utils/responseHelper');
const { toKSTString } = require('../utils/dateHelper');

const GUEST_EVENT_CODE = 'LAUNCH_GUEST_2026';

/**
 * POST /api/user/region-alert
 * 게스트 지역 알림 신청 — 런칭 이벤트 게스트 자격 등록
 * 내부적으로 PromotionParticipant 에 등록 (선착순 제한은 이벤트 정의에 따름)
 */
const registerRegionAlert = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const userId = req.user.id;

    const result = await promotionService.registerParticipant({
      eventCode: GUEST_EVENT_CODE,
      userId,
      transaction
    });

    if (result.reason === 'EVENT_INACTIVE') {
      await transaction.rollback();
      return error(
        res,
        { code: 4401, message: '현재 진행 중인 이벤트가 없습니다' },
        400
      );
    }

    if (result.reason === 'LIMIT_REACHED') {
      await transaction.rollback();
      return error(
        res,
        { code: 4400, message: '선착순 혜택이 모두 소진되었습니다' },
        409
      );
    }

    if (result.reason === 'ALREADY_REGISTERED') {
      await transaction.commit();
      return success(res, {
        alreadyRegistered: true,
        alertedAt: toKSTString(result.participant.appliedAt)
      });
    }

    await transaction.commit();
    return created(res, {
      alreadyRegistered: false,
      alertedAt: toKSTString(result.participant.appliedAt)
    });
  } catch (err) {
    await transaction.rollback();
    console.error('Register region alert error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

module.exports = { registerRegionAlert };
