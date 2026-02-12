/**
 * Notification Controller
 * 알림 API 엔드포인트 핸들러
 */

const NotificationService = require('../services/notificationService');
const { success, error, ErrorCodes } = require('../utils/responseHelper');

/**
 * 알림 목록 조회
 * GET /api/notifications
 * Query: userMode (required), page, limit
 */
const getNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const { userMode, page = 1, limit = 20 } = req.query;

    // userMode 필수 검증
    if (!userMode || !['guest', 'host'].includes(userMode)) {
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, {
        field: 'userMode',
        message: 'userMode는 guest 또는 host여야 합니다.'
      });
    }

    const result = await NotificationService.getByUser(
      userId,
      userMode,
      {
        page: parseInt(page),
        limit: Math.min(parseInt(limit), 50) // 최대 50개 제한
      }
    );

    return success(res, result, '알림 목록 조회 성공');
  } catch (err) {
    console.error('알림 목록 조회 에러:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 전체 읽음 처리
 * PATCH /api/notifications/mark-all-read
 * Query: userMode (optional)
 */
const markAllAsRead = async (req, res) => {
  try {
    const userId = req.user.id;
    const { userMode } = req.query;

    // userMode가 있으면 검증
    if (userMode && !['guest', 'host'].includes(userMode)) {
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, {
        field: 'userMode',
        message: 'userMode는 guest 또는 host여야 합니다.'
      });
    }

    const updatedCount = await NotificationService.markAllAsRead(userId, userMode);

    return success(res, { updatedCount }, '모든 알림을 읽음 처리했습니다.');
  } catch (err) {
    console.error('알림 읽음 처리 에러:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 읽지 않은 알림 수 조회
 * GET /api/notifications/unread-count
 * Query: userMode (optional)
 */
const getUnreadCount = async (req, res) => {
  try {
    const userId = req.user.id;
    const { userMode } = req.query;

    // userMode가 있으면 검증
    if (userMode && !['guest', 'host'].includes(userMode)) {
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, {
        field: 'userMode',
        message: 'userMode는 guest 또는 host여야 합니다.'
      });
    }

    let unreadCount;

    if (userMode) {
      // 특정 모드의 읽지 않은 알림 수
      unreadCount = await NotificationService.getUnreadCount(userId, userMode);
    } else {
      // 게스트, 호스트 모두 조회
      const guestCount = await NotificationService.getUnreadCount(userId, 'guest');
      const hostCount = await NotificationService.getUnreadCount(userId, 'host');
      unreadCount = {
        guest: guestCount,
        host: hostCount,
        total: guestCount + hostCount
      };
    }

    return success(res, { unreadCount }, '읽지 않은 알림 수 조회 성공');
  } catch (err) {
    console.error('알림 수 조회 에러:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

module.exports = {
  getNotifications,
  markAllAsRead,
  getUnreadCount
};
