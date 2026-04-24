const { PromotionEvent } = require('../models');
const { success, error, ErrorCodes } = require('../utils/responseHelper');
const { toKSTString } = require('../utils/dateHelper');

const LAUNCH_EVENT_CODE = 'LAUNCH_HOST_2026';

/**
 * GET /api/system/launch-status
 *
 * 서비스 런칭 여부 조회 (프론트 지도검색 차단 해제 판정용)
 * - 비로그인 호출 가능
 * - LAUNCH_HOST_2026 이벤트의 startAt 값으로 런칭 여부 파생
 *   → startAt NULL = 프리런칭, startAt 존재 = 런칭 완료
 *
 * 응답:
 *   - isPrelaunch: boolean
 *   - launchedAt: KST ISO 문자열 | null
 */
const getLaunchStatus = async (req, res) => {
  try {
    const event = await PromotionEvent.findOne({
      where: { code: LAUNCH_EVENT_CODE },
      attributes: ['startAt']
    });

    const launchedAt = event?.startAt || null;

    return success(res, {
      isPrelaunch: !launchedAt,
      launchedAt: toKSTString(launchedAt)
    });
  } catch (err) {
    console.error('Get launch status error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

module.exports = { getLaunchStatus };
