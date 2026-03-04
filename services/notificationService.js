/**
 * Notification Service
 * 알림 생성, 조회, 읽음 처리 등 비즈니스 로직
 */

const { NotificationMessages, CANCEL_TYPES } = require('../utils/notificationMessages');
const AlimtalkService = require('./alimtalkService');

/**
 * NotificationService 클래스
 * models/index.js에서 초기화된 모델을 사용하기 위해 lazy loading 패턴 사용
 */
class NotificationService {
  /**
   * 모델 가져오기 (lazy loading)
   */
  static getModels() {
    const { Notification, User, Contract, Room, ChatRoom, Notice, Inquiry } = require('../models');
    return { Notification, User, Contract, Room, ChatRoom, Notice, Inquiry };
  }

  // =====================================================
  // 기본 CRUD 메서드
  // =====================================================

  /**
   * 알림 생성
   * @param {Object} params - 알림 생성 파라미터
   * @returns {Promise<Notification>}
   */
  static async create(params) {
    const { Notification } = this.getModels();
    const {
      userId,
      userMode,
      type,
      title,
      message,
      relatedContractId = null,
      relatedChatRoomId = null,
      relatedNoticeId = null,
      relatedInquiryId = null,
      relatedRoomId = null,
      metadata = null
    } = params;

    return await Notification.create({
      userId,
      userMode,
      type,
      title,
      message,
      relatedContractId,
      relatedChatRoomId,
      relatedNoticeId,
      relatedInquiryId,
      relatedRoomId,
      metadata
    });
  }

  /**
   * 사용자별 알림 목록 조회
   * @param {number} userId - 사용자 ID
   * @param {string} userMode - 'guest' | 'host'
   * @param {Object} options - { page, limit }
   * @returns {Promise<{ notifications, pagination, unreadCount }>}
   */
  static async getByUser(userId, userMode, options = {}) {
    const { Notification } = this.getModels();
    const { page = 1, limit = 20 } = options;
    const offset = (page - 1) * limit;

    const { count, rows } = await Notification.findAndCountAll({
      where: {
        userId,
        userMode
      },
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });

    // 읽지 않은 알림 수
    const unreadCount = await Notification.count({
      where: {
        userId,
        userMode,
        isRead: false
      }
    });

    return {
      notifications: rows,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit)
      },
      unreadCount
    };
  }

  /**
   * 전체 읽음 처리
   * @param {number} userId - 사용자 ID
   * @param {string} userMode - 'guest' | 'host' (선택사항)
   * @returns {Promise<number>} - 업데이트된 행 수
   */
  static async markAllAsRead(userId, userMode = null) {
    const { Notification } = this.getModels();
    const where = {
      userId,
      isRead: false
    };

    if (userMode) {
      where.userMode = userMode;
    }

    const [updatedCount] = await Notification.update(
      { isRead: true },
      { where }
    );

    return updatedCount;
  }

  /**
   * 읽지 않은 알림 수 조회
   * @param {number} userId - 사용자 ID
   * @param {string} userMode - 'guest' | 'host' (선택사항)
   * @returns {Promise<number>}
   */
  static async getUnreadCount(userId, userMode = null) {
    const { Notification } = this.getModels();
    const where = {
      userId,
      isRead: false
    };

    if (userMode) {
      where.userMode = userMode;
    }

    return await Notification.count({ where });
  }

  /**
   * 오래된 알림 삭제 (배치용)
   * @param {number} days - 보관 일수
   * @returns {Promise<number>} - 삭제된 행 수
   */
  static async deleteOldNotifications(days = 90) {
    const { Notification } = this.getModels();
    const { Op } = require('sequelize');
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const deletedCount = await Notification.destroy({
      where: {
        createdAt: {
          [Op.lt]: cutoffDate
        }
      }
    });

    return deletedCount;
  }

  // =====================================================
  // 계약 관련 알림 생성 헬퍼
  // =====================================================

  /**
   * 계약 요청 알림 (호스트에게만)
   * @param {Object} contract - 계약 정보
   * @param {Object} options - { room, guest }
   */
  static async notifyContractRequest(contract, options = {}) {
    const { room, guest } = options;

    // 호스트에게만 알림
    const hostMsg = NotificationMessages.contractRequestHost();
    await this.create({
      userId: contract.hostId,
      userMode: 'host',
      type: 'CONTRACT_REQUEST_HOST',
      title: hostMsg.title,
      message: hostMsg.message,
      relatedContractId: contract.id,
      relatedRoomId: contract.roomId,
      metadata: {
        guestName: guest?.name || guest?.nickname,
        roomName: room?.roomName
      }
    });
  }

  /**
   * 계약 승인 알림 (게스트에게만)
   * @param {Object} contract - 계약 정보
   * @param {Object} options - { room }
   */
  static async notifyContractApproved(contract, options = {}) {
    const { room, guest } = options;

    // 게스트에게만 알림 (결제 안내)
    const guestMsg = NotificationMessages.contractApprovedGuest();
    await this.create({
      userId: contract.guestId,
      userMode: 'guest',
      type: 'CONTRACT_APPROVED',
      title: guestMsg.title,
      message: guestMsg.message,
      relatedContractId: contract.id,
      relatedRoomId: contract.roomId,
      metadata: {
        roomName: room?.roomName
      }
    });

    // 알림톡 발송 (4-2)
    const guestUser = guest || await this._getUser(contract.guestId);
    AlimtalkService.sendContractApproved(contract, guestUser, room)
      .catch(err => console.error('[Alimtalk] contract_approved 실패:', err.message));
  }

  /**
   * 계약 거절 알림 (게스트에게만)
   * @param {Object} contract - 계약 정보
   */
  static async notifyContractRejected(contract) {
    const msg = NotificationMessages.contractRejected();
    await this.create({
      userId: contract.guestId,
      userMode: 'guest',
      type: 'CONTRACT_REJECTED',
      title: msg.title,
      message: msg.message,
      relatedContractId: contract.id,
      relatedRoomId: contract.roomId
    });
  }

  /**
   * 계약 취소 알림 (호스트 + 게스트 모두에게)
   * @param {Object} contract - 계약 정보
   * @param {string} cancelType - CANCEL_TYPES 중 하나
   */
  static async notifyContractCanceled(contract, cancelType, options = {}) {
    const msg = NotificationMessages.contractCanceled(cancelType);

    // 호스트에게 알림
    await this.create({
      userId: contract.hostId,
      userMode: 'host',
      type: 'CONTRACT_CANCELED',
      title: msg.title,
      message: msg.message,
      relatedContractId: contract.id,
      relatedRoomId: contract.roomId,
      metadata: { cancelType }
    });

    // 게스트에게 알림
    await this.create({
      userId: contract.guestId,
      userMode: 'guest',
      type: 'CONTRACT_CANCELED',
      title: msg.title,
      message: msg.message,
      relatedContractId: contract.id,
      relatedRoomId: contract.roomId,
      metadata: { cancelType }
    });

    // 알림톡 발송 (4-5)
    const { guest, host, room, refundData } = options;
    if (guest && host && room) {
      const canceledBy = (cancelType === CANCEL_TYPES.GUEST_CANCEL ||
                          cancelType === CANCEL_TYPES.GUEST_CANCEL_IN_PROGRESS) ? 'guest' : 'host';
      AlimtalkService.sendContractCanceled(contract, canceledBy, guest, host, room, refundData || {})
        .catch(err => console.error('[Alimtalk] contract_canceled 실패:', err.message));
    }
  }

  // =====================================================
  // 결제 관련 알림 생성 헬퍼
  // =====================================================

  /**
   * 결제 대기 알림 (24시간 전, 게스트에게)
   * @param {Object} contract - 계약 정보
   */
  static async notifyPaymentPending(contract) {
    const msg = NotificationMessages.paymentPending();
    await this.create({
      userId: contract.guestId,
      userMode: 'guest',
      type: 'PAYMENT_PENDING',
      title: msg.title,
      message: msg.message,
      relatedContractId: contract.id,
      relatedRoomId: contract.roomId
    });
  }

  /**
   * 결제 완료 알림 (호스트 + 게스트 모두에게)
   * @param {Object} contract - 계약 정보
   */
  static async notifyPaymentCompleted(contract, options = {}) {
    const msg = NotificationMessages.paymentCompleted();

    // 호스트에게 알림
    await this.create({
      userId: contract.hostId,
      userMode: 'host',
      type: 'PAYMENT_COMPLETED',
      title: msg.title,
      message: msg.message,
      relatedContractId: contract.id,
      relatedRoomId: contract.roomId
    });

    // 게스트에게 알림
    await this.create({
      userId: contract.guestId,
      userMode: 'guest',
      type: 'PAYMENT_COMPLETED',
      title: msg.title,
      message: msg.message,
      relatedContractId: contract.id,
      relatedRoomId: contract.roomId
    });

    // 알림톡 발송 (4-3)
    const { guest, host, room, paymentData } = options;
    if (guest && host && room) {
      AlimtalkService.sendPaymentCompleted(contract, guest, host, room, paymentData || {})
        .catch(err => console.error('[Alimtalk] payment_completed 실패:', err.message));
    }
  }

  /**
   * 옵션 추가 결제 완료 알림 (게스트에게)
   * @param {Object} contract - 계약 정보
   */
  static async notifyAdditionalOptionPayment(contract) {
    const msg = NotificationMessages.additionalOptionPayment();
    await this.create({
      userId: contract.guestId,
      userMode: 'guest',
      type: 'ADDITIONAL_OPTION_PAYMENT',
      title: msg.title,
      message: msg.message,
      relatedContractId: contract.id,
      relatedRoomId: contract.roomId
    });
  }

  // =====================================================
  // 입주/퇴실 관련 알림 생성 헬퍼
  // =====================================================

  /**
   * 입주 당일 알림 (호스트 + 게스트 모두에게)
   * @param {Object} contract - 계약 정보
   * @param {Object} options - { guest, host }
   */
  static async notifyCheckinToday(contract, options = {}) {
    const { guest, host } = options;

    // 호스트에게 알림
    const hostMsg = NotificationMessages.checkinTodayHost({
      guestName: guest?.name || guest?.nickname,
      guestPhoneNumber: guest?.phoneNumber
    });
    await this.create({
      userId: contract.hostId,
      userMode: 'host',
      type: 'CHECKIN_TODAY',
      title: hostMsg.title,
      message: hostMsg.message,
      relatedContractId: contract.id,
      relatedRoomId: contract.roomId,
      metadata: {
        guestName: guest?.name || guest?.nickname,
        guestPhoneNumber: guest?.phoneNumber
      }
    });

    // 게스트에게 알림
    const guestMsg = NotificationMessages.checkinTodayGuest({
      hostPhoneNumber: host?.phoneNumber
    });
    await this.create({
      userId: contract.guestId,
      userMode: 'guest',
      type: 'CHECKIN_TODAY',
      title: guestMsg.title,
      message: guestMsg.message,
      relatedContractId: contract.id,
      relatedRoomId: contract.roomId,
      metadata: {
        hostPhoneNumber: host?.phoneNumber
      }
    });

    // 알림톡 발송 (4-4)
    const { room } = options;
    AlimtalkService.sendCheckinToday(contract, guest, host, room)
      .catch(err => console.error('[Alimtalk] checkin_today 실패:', err.message));
  }

  /**
   * 입주 확정 알림 (호스트에게)
   * @param {Object} contract - 계약 정보
   * @param {Object} options - { guest }
   */
  static async notifyCheckinConfirmed(contract, options = {}) {
    const { guest } = options;
    const msg = NotificationMessages.checkinConfirmed({
      guestName: guest?.name || guest?.nickname
    });

    await this.create({
      userId: contract.hostId,
      userMode: 'host',
      type: 'CHECKIN_CONFIRMED',
      title: msg.title,
      message: msg.message,
      relatedContractId: contract.id,
      relatedRoomId: contract.roomId,
      metadata: {
        guestName: guest?.name || guest?.nickname
      }
    });
  }

  /**
   * 퇴실 N일 전 알림 (게스트에게)
   * @param {Object} contract - 계약 정보
   * @param {number} daysLeft - 퇴실까지 남은 일수
   * @param {string} checkOutGuide - 퇴실 안내 (선택)
   */
  static async notifyCheckoutReminder(contract, daysLeft, checkOutGuide = '') {
    const msg = NotificationMessages.checkoutReminder({
      daysLeft,
      checkOutGuide
    });

    await this.create({
      userId: contract.guestId,
      userMode: 'guest',
      type: 'CHECKOUT_REMINDER',
      title: msg.title,
      message: msg.message,
      relatedContractId: contract.id,
      relatedRoomId: contract.roomId,
      metadata: { daysLeft, checkOutGuide }
    });
  }

  /**
   * 퇴실 당일 알림 (게스트에게)
   * @param {Object} contract - 계약 정보
   */
  static async notifyCheckoutToday(contract, options = {}) {
    const msg = NotificationMessages.checkoutToday();
    await this.create({
      userId: contract.guestId,
      userMode: 'guest',
      type: 'CHECKOUT_REMINDER',
      title: msg.title,
      message: msg.message,
      relatedContractId: contract.id,
      relatedRoomId: contract.roomId
    });

    // 알림톡 발송 (4-7)
    const guest = options.guest || await this._getUser(contract.guestId);
    AlimtalkService.sendCheckoutToday(contract, guest)
      .catch(err => console.error('[Alimtalk] checkout_today 실패:', err.message));
  }

  /**
   * 퇴실 확인 요청 알림 (호스트에게)
   * @param {Object} contract - 계약 정보
   * @param {Object} options - { guest, room }
   */
  static async notifyCheckoutRequest(contract, options = {}) {
    const { guest, room } = options;
    const msg = NotificationMessages.checkoutRequest({
      guestName: guest?.name || guest?.nickname,
      roomName: room?.roomName
    });

    await this.create({
      userId: contract.hostId,
      userMode: 'host',
      type: 'CHECKOUT_REQUEST',
      title: msg.title,
      message: msg.message,
      relatedContractId: contract.id,
      relatedRoomId: contract.roomId,
      metadata: {
        guestName: guest?.name || guest?.nickname,
        roomName: room?.roomName
      }
    });

    // 알림톡 발송 (4-8)
    const host = await this._getUser(contract.hostId);
    AlimtalkService.sendCheckoutHostRequest(contract, host)
      .catch(err => console.error('[Alimtalk] checkout_host_request 실패:', err.message));
  }

  /**
   * 퇴실 완료 알림 (호스트 + 게스트 모두에게)
   * @param {Object} contract - 계약 정보
   */
  static async notifyCheckoutConfirmed(contract) {
    const msg = NotificationMessages.checkoutConfirmed();

    // 호스트에게 알림
    await this.create({
      userId: contract.hostId,
      userMode: 'host',
      type: 'CHECKOUT_CONFIRMED',
      title: msg.title,
      message: msg.message,
      relatedContractId: contract.id,
      relatedRoomId: contract.roomId
    });

    // 게스트에게 알림
    await this.create({
      userId: contract.guestId,
      userMode: 'guest',
      type: 'CHECKOUT_CONFIRMED',
      title: msg.title,
      message: msg.message,
      relatedContractId: contract.id,
      relatedRoomId: contract.roomId
    });

    // 알림톡 발송 (4-13 호스트 퇴실 확인 → 보증금 반환)
    const guest = await this._getUser(contract.guestId);
    AlimtalkService.sendDepositReturnedNormal(contract, guest)
      .catch(err => console.error('[Alimtalk] deposit_returned_normal 실패:', err.message));
  }

  // =====================================================
  // 옵션 관련 알림 생성 헬퍼
  // =====================================================

  /**
   * 옵션 추가 마감 임박 알림 (게스트에게)
   * @param {Object} contract - 계약 정보
   */
  static async notifyOptionDeadline(contract) {
    const msg = NotificationMessages.optionDeadline();
    await this.create({
      userId: contract.guestId,
      userMode: 'guest',
      type: 'OPTION_DEADLINE',
      title: msg.title,
      message: msg.message,
      relatedContractId: contract.id,
      relatedRoomId: contract.roomId
    });
  }

  // =====================================================
  // 채팅 관련 알림 생성 헬퍼
  // =====================================================

  /**
   * 새 메시지 알림
   * @param {Object} chatRoom - 채팅방 정보
   * @param {number} senderId - 발신자 ID
   * @param {Object} options - { senderName }
   */
  static async notifyMessage(chatRoom, senderId, options = {}) {
    const { senderName } = options;
    const msg = NotificationMessages.message({ senderName });

    // 수신자 결정 (발신자가 아닌 쪽)
    const recipientId = senderId === chatRoom.hostId ? chatRoom.guestId : chatRoom.hostId;
    const recipientMode = senderId === chatRoom.hostId ? 'guest' : 'host';

    await this.create({
      userId: recipientId,
      userMode: recipientMode,
      type: 'MESSAGE',
      title: msg.title,
      message: msg.message,
      relatedChatRoomId: chatRoom.id,
      relatedContractId: chatRoom.contractId,
      metadata: { senderName }
    });
  }

  // =====================================================
  // 공지/문의 관련 알림 생성 헬퍼
  // =====================================================

  /**
   * 공지사항 알림 (모든 사용자에게)
   * @param {Object} notice - 공지사항 정보
   * @param {Array} userIds - 알림 대상 사용자 ID 배열
   */
  static async notifyNotice(notice, userIds = []) {
    const msg = NotificationMessages.notice({ noticeTitle: notice.title });

    const notifications = [];
    for (const userId of userIds) {
      // 게스트, 호스트 모두에게 알림
      notifications.push({
        userId,
        userMode: 'guest',
        type: 'NOTICE',
        title: msg.title,
        message: msg.message,
        relatedNoticeId: notice.id,
        metadata: { noticeTitle: notice.title }
      });
      notifications.push({
        userId,
        userMode: 'host',
        type: 'NOTICE',
        title: msg.title,
        message: msg.message,
        relatedNoticeId: notice.id,
        metadata: { noticeTitle: notice.title }
      });
    }

    const { Notification } = this.getModels();
    if (notifications.length > 0) {
      await Notification.bulkCreate(notifications);
    }
  }

  /**
   * 문의 답변 알림 (문의 작성자에게)
   * @param {Object} inquiry - 문의 정보
   */
  static async notifyInquiryAnswered(inquiry) {
    const msg = NotificationMessages.inquiryAnswered();

    // 문의 작성자에게 게스트/호스트 모드 둘 다 알림
    await this.create({
      userId: inquiry.userId,
      userMode: 'guest',
      type: 'INQUIRY_ANSWERED',
      title: msg.title,
      message: msg.message,
      relatedInquiryId: inquiry.id
    });

    await this.create({
      userId: inquiry.userId,
      userMode: 'host',
      type: 'INQUIRY_ANSWERED',
      title: msg.title,
      message: msg.message,
      relatedInquiryId: inquiry.id
    });
  }

  // =====================================================
  // 매물 심사 관련 알림 생성 헬퍼
  // =====================================================

  /**
   * 매물 심사 결과 알림 (호스트에게)
   * @param {Object} room - 매물 정보
   * @param {boolean} approved - 승인 여부
   * @param {string} rejectReason - 반려 사유 (반려 시)
   */
  // =====================================================
  // 유틸리티 헬퍼
  // =====================================================

  /**
   * 사용자 정보 조회 (알림톡 발송에 필요한 phoneNumber 포함)
   * @param {number} userId
   * @returns {Promise<Object>} { id, phoneNumber, name, nickname }
   */
  static async _getUser(userId) {
    const { User } = this.getModels();
    return await User.findByPk(userId, {
      attributes: ['id', 'phoneNumber', 'name', 'nickname']
    });
  }

  // =====================================================
  // 매물 심사 관련 알림 생성 헬퍼
  // =====================================================

  static async notifyPropertyReviewResult(room, approved, rejectReason = '') {
    const msg = approved
      ? NotificationMessages.propertyApproved({ roomName: room.roomName })
      : NotificationMessages.propertyRejected({ roomName: room.roomName, rejectReason });

    await this.create({
      userId: room.hostId,
      userMode: 'host',
      type: 'PROPERTY_REVIEW_RESULT',
      title: msg.title,
      message: msg.message,
      relatedRoomId: room.id,
      metadata: {
        roomName: room.roomName,
        approved,
        rejectReason: approved ? null : rejectReason
      }
    });
  }
}

module.exports = NotificationService;
