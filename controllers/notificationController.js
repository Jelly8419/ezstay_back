/**
 * Notification Controller
 * 알림 API 엔드포인트 핸들러
 */

const NotificationService = require('../services/notificationService');
const { getChatRoomMetadata } = require('../config/firebaseAdmin');
const { ChatRoom } = require('../models');
const { Op } = require('sequelize');
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
 * GET /api/gnb/badge-status
 * Query: userMode (optional)
 */
const getBadgeStatus = async (req, res) => {
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

    // MySQL 기준으로 채팅방 조회 (Firestore 고아 데이터 제외)
    const whereClause = userMode
      ? (userMode === 'host' ? { hostId: userId } : { guestId: userId })
      : { [Op.or]: [{ hostId: userId }, { guestId: userId }] };

    const chatRooms = await ChatRoom.findAll({ where: whereClause, attributes: ['firebaseChatRoomId', 'hostId', 'guestId'] });

    const userIdStr = String(userId);

    const metadataList = await Promise.all(
      chatRooms.map(room => getChatRoomMetadata(room.firebaseChatRoomId).catch(() => null))
    );

    let unreadCount;
    let hasUnreadChat;

    if (userMode) {
      unreadCount = await NotificationService.getUnreadCount(userId, userMode);
      hasUnreadChat = metadataList.some(meta => (meta?.unreadCount?.[userIdStr] || 0) > 0);
    } else {
      const guestCount = await NotificationService.getUnreadCount(userId, 'guest');
      const hostCount = await NotificationService.getUnreadCount(userId, 'host');
      unreadCount = { guest: guestCount, host: hostCount, total: guestCount + hostCount };

      const guestRoomIds = new Set(chatRooms.filter(r => r.guestId === userId).map(r => r.firebaseChatRoomId));
      const hostRoomIds = new Set(chatRooms.filter(r => r.hostId === userId).map(r => r.firebaseChatRoomId));

      hasUnreadChat = {
        guest: metadataList.filter(m => m && guestRoomIds.has(m.id)).some(m => (m.unreadCount?.[userIdStr] || 0) > 0),
        host: metadataList.filter(m => m && hostRoomIds.has(m.id)).some(m => (m.unreadCount?.[userIdStr] || 0) > 0)
      };
    }

    return success(res, { unreadCount, hasUnreadChat }, 'GNB 배지 상태 조회 성공');
  } catch (err) {
    console.error('알림 수 조회 에러:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

module.exports = {
  getNotifications,
  markAllAsRead,
  getBadgeStatus
};
