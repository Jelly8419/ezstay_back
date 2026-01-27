const { ChatRoom, Contract, User, Room } = require('../models');
const { success, error, ErrorCodes } = require('../utils/responseHelper');
const {
  createCustomToken,
  createChatRoomMetadata,
  getChatRoomMetadata,
  getUserChatRooms,
  sendSystemMessage
} = require('../config/firebaseAdmin');
const { SystemMessageTypes, getSystemMessageTemplate } = require('../utils/systemMessageTypes');
const { Op } = require('sequelize');

/**
 * Firebase Custom Token 발급
 * 클라이언트에서 Firebase Authentication에 로그인하기 위한 토큰
 * GET /api/chats/custom-token
 */
const getCustomToken = async (req, res) => {
  try {
    const userId = req.user.id;

    // Firebase Custom Token 생성
    const customToken = await createCustomToken(userId, {
      email: req.user.email,
      name: req.user.name
    });

    return success(res, {
      customToken,
      uid: String(userId)
    }, 'Firebase Custom Token 발급 성공');
  } catch (err) {
    console.error('Custom Token 발급 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 채팅방 생성 (계약 승인 시 자동 호출)
 * POST /api/chats/rooms
 */
const createChatRoom = async (req, res) => {
  try {
    const { contractId } = req.body;

    if (!contractId) {
      return error(res, {
        code: 4000,
        message: 'contractId는 필수입니다.'
      }, 400);
    }

    // 계약 정보 조회
    const contract = await Contract.findOne({
      where: { id: contractId },
      include: [
        {
          model: Room,
          as: 'room',
          attributes: ['id', 'roomName', 'address', 'detailAddress']
        },
        {
          model: User,
          as: 'host',
          attributes: ['id', 'name', 'email', 'profileImageUrl']
        },
        {
          model: User,
          as: 'guest',
          attributes: ['id', 'name', 'email', 'profileImageUrl']
        }
      ]
    });

    if (!contract) {
      return error(res, {
        code: 3001,
        message: '계약을 찾을 수 없습니다.'
      }, 404);
    }

    // 계약 상태 확인 (APPROVED 이상이어야 함)
    const validStatuses = ['APPROVED', 'PAYMENT_COMPLETED', 'IN_PROGRESS', 'COMPLETED'];
    if (!validStatuses.includes(contract.status)) {
      return error(res, {
        code: 4201,
        message: '승인된 계약만 채팅방을 생성할 수 있습니다.'
      }, 400);
    }

    // 이미 채팅방이 존재하는지 확인
    const existingChatRoom = await ChatRoom.findOne({
      where: { contractId }
    });

    if (existingChatRoom) {
      return success(res, {
        chatRoom: existingChatRoom,
        message: '이미 생성된 채팅방입니다.'
      }, '채팅방 조회 성공');
    }

    // Firebase 채팅방 ID 생성
    const firebaseChatRoomId = ChatRoom.generateFirebaseChatRoomId(contractId);

    // MySQL에 채팅방 정보 저장
    const chatRoom = await ChatRoom.create({
      contractId,
      firebaseChatRoomId,
      hostId: contract.hostId,
      guestId: contract.guestId,
      roomId: contract.roomId,
      isActive: true
    });

    // Firestore에 채팅방 메타데이터 저장
    await createChatRoomMetadata(firebaseChatRoomId, {
      contractId,
      hostId: contract.hostId,
      guestId: contract.guestId,
      roomId: contract.roomId,
      roomInfo: {
        name: contract.room.roomName,
        address: contract.room.address
      },
      hostInfo: {
        id: contract.host.id,
        name: contract.host.name,
        profileImageUrl: contract.host.profileImageUrl
      },
      guestInfo: {
        id: contract.guest.id,
        name: contract.guest.name,
        profileImageUrl: contract.guest.profileImageUrl
      },
      checkInDate: contract.checkInDate,
      checkOutDate: contract.checkOutDate,
      isActive: true
    });

    return success(res, {
      chatRoom,
      firebaseChatRoomId
    }, '채팅방 생성 성공');
  } catch (err) {
    console.error('채팅방 생성 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 내 채팅방 목록 조회
 * GET /api/chats/rooms
 * Query params:
 *   - status: 계약 상태 필터 (APPROVED, PAYMENT_COMPLETED, IN_PROGRESS, COMPLETED, CANCELLED, REJECTED 등)
 *             CANCELLED는 모든 취소 상태를 포함 (CANCELLED_BY_GUEST, CANCELLED_BY_HOST, PAYMENT_EXPIRED 등)
 */
const getMyChatRooms = async (req, res) => {
  try {
    const userId = req.user.id;
    const { status } = req.query;

    // 계약 상태 필터 조건 생성
    let contractWhereClause = {};
    if (status) {
      // CANCELLED는 모든 취소/만료 상태를 포함하는 그룹 필터
      if (status === 'CANCELLED') {
        contractWhereClause.status = {
          [Op.in]: [
            'CANCELLED_BY_GUEST',
            'CANCELLED_BY_HOST',
            'CANCELLED_BY_ADMIN_WITH_REFUND',
            'CANCELLED_BY_ADMIN_NO_REFUND',
            'PAYMENT_EXPIRED',
            'APPROVAL_EXPIRED'
          ]
        };
      } else {
        contractWhereClause.status = status;
      }
    }

    // MySQL에서 채팅방 목록 조회
    const chatRooms = await ChatRoom.findAll({
      where: {
        [Op.or]: [
          { hostId: userId },
          { guestId: userId }
        ]
      },
      include: [
        {
          model: Contract,
          as: 'contract',
          attributes: ['id', 'status', 'checkInDate', 'checkOutDate'],
          where: Object.keys(contractWhereClause).length > 0 ? contractWhereClause : undefined
        },
        {
          model: Room,
          as: 'room',
          attributes: ['id', 'roomName', 'address']
        },
        {
          model: User,
          as: 'host',
          attributes: ['id', 'name', 'email', 'profileImageUrl']
        },
        {
          model: User,
          as: 'guest',
          attributes: ['id', 'name', 'email', 'profileImageUrl']
        }
      ],
      order: [['updatedAt', 'DESC']]
    });

    // Firestore에서 마지막 메시지 정보 가져오기 (선택사항)
    const chatRoomsWithMetadata = await Promise.all(
      chatRooms.map(async (chatRoom) => {
        try {
          const metadata = await getChatRoomMetadata(chatRoom.firebaseChatRoomId);
          return {
            ...chatRoom.toJSON(),
            lastMessage: metadata?.lastMessageText || null,
            lastMessageAt: metadata?.lastMessageAt || null,
            unreadCount: metadata?.unreadCount?.[userId] || 0
          };
        } catch (err) {
          console.error('Firestore 메타데이터 조회 실패:', err);
          return chatRoom.toJSON();
        }
      })
    );

    return success(res, {
      chatRooms: chatRoomsWithMetadata,
      total: chatRoomsWithMetadata.length
    }, '채팅방 목록 조회 성공');
  } catch (err) {
    console.error('채팅방 목록 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 채팅방 상세 정보 조회
 * GET /api/chats/rooms/:chatRoomId
 */
const getChatRoomDetail = async (req, res) => {
  try {
    const { chatRoomId } = req.params;
    const userId = req.user.id;

    // MySQL에서 채팅방 조회
    const chatRoom = await ChatRoom.findOne({
      where: { firebaseChatRoomId: chatRoomId },
      include: [
        {
          model: Contract,
          as: 'contract',
          attributes: ['id', 'status', 'checkInDate', 'checkOutDate', 'totalUsageFee']
        },
        {
          model: Room,
          as: 'room',
          attributes: ['id', 'roomName', 'address', 'detailAddress']
        },
        {
          model: User,
          as: 'host',
          attributes: ['id', 'name', 'email', 'profileImageUrl', 'phoneNumber']
        },
        {
          model: User,
          as: 'guest',
          attributes: ['id', 'name', 'email', 'profileImageUrl', 'phoneNumber']
        }
      ]
    });

    if (!chatRoom) {
      return error(res, {
        code: 3002,
        message: '채팅방을 찾을 수 없습니다.'
      }, 404);
    }

    // 권한 확인 (호스트 또는 게스트만 접근 가능)
    if (chatRoom.hostId !== userId && chatRoom.guestId !== userId) {
      return error(res, ErrorCodes.FORBIDDEN, 403);
    }

    // Firestore에서 메타데이터 조회
    const metadata = await getChatRoomMetadata(chatRoomId);

    return success(res, {
      chatRoom: chatRoom.toJSON(),
      metadata
    }, '채팅방 상세 정보 조회 성공');
  } catch (err) {
    console.error('채팅방 상세 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 계약 ID로 채팅방 조회
 * GET /api/chats/contracts/:contractId/room
 */
/**
 * 계약 ID로 채팅방 조회 (없으면 자동 생성)
 * GET /api/chats/contracts/:contractId/room
 */
const getChatRoomByContractId = async (req, res) => {
  try {
    const { contractId } = req.params;
    const userId = req.user.id;

    // 1. 기존 채팅방 조회
    let chatRoom = await ChatRoom.findOne({
      where: { contractId },
      include: [
        {
          model: Contract,
          as: 'contract'
        },
        {
          model: Room,
          as: 'room',
          attributes: ['id', 'roomName', 'address']
        },
        {
          model: User,
          as: 'host',
          attributes: ['id', 'name', 'profileImageUrl']
        },
        {
          model: User,
          as: 'guest',
          attributes: ['id', 'name', 'profileImageUrl']
        }
      ]
    });

    // 2. 채팅방이 없으면 자동 생성
    if (!chatRoom) {
      console.log(`📌 계약 ID ${contractId}의 채팅방이 없음. 자동 생성 시도...`);

      // 계약 정보 조회
      const contract = await Contract.findOne({
        where: { id: contractId },
        include: [
          {
            model: Room,
            as: 'room',
            attributes: ['id', 'name', 'roadAddress']
          },
          {
            model: User,
            as: 'host',
            attributes: ['id', 'name', 'profileImageUrl']
          },
          {
            model: User,
            as: 'guest',
            attributes: ['id', 'name', 'profileImageUrl']
          }
        ]
      });

      if (!contract) {
        return error(res, {
          code: 3001,
          message: '계약을 찾을 수 없습니다.'
        }, 404);
      }

      // 권한 확인 (호스트 또는 게스트만)
      if (contract.hostId !== userId && contract.guestId !== userId) {
        return error(res, ErrorCodes.FORBIDDEN, 403);
      }

      // 승인된 계약만 채팅방 생성 가능
      const validStatuses = ['APPROVED', 'PAYMENT_COMPLETED', 'IN_PROGRESS', 'COMPLETED'];
      if (!validStatuses.includes(contract.status)) {
        return error(res, {
          code: 4201,
          message: '승인된 계약만 채팅방을 사용할 수 있습니다.'
        }, 400);
      }

      // Firebase 채팅방 ID 생성
      const firebaseChatRoomId = ChatRoom.generateFirebaseChatRoomId(contractId);

      try {
        // MySQL에 채팅방 정보 저장
        chatRoom = await ChatRoom.create({
          contractId: contract.id,
          firebaseChatRoomId,
          hostId: contract.hostId,
          guestId: contract.guestId,
          roomId: contract.roomId,
          isActive: contract.status !== 'COMPLETED'
        });

        // Firestore에 채팅방 메타데이터 저장 (비동기)
        createChatRoomMetadata(firebaseChatRoomId, {
          contractId: contract.id,
          hostId: contract.hostId,
          guestId: contract.guestId,
          roomId: contract.roomId,
          roomInfo: {
            name: contract.room.name,
            address: contract.room.roadAddress
          },
          hostInfo: {
            id: contract.host.id,
            name: contract.host.name,
            profileImageUrl: contract.host.profileImageUrl
          },
          guestInfo: {
            id: contract.guest.id,
            name: contract.guest.name,
            profileImageUrl: contract.guest.profileImageUrl
          },
          checkInDate: contract.checkInDate,
          checkOutDate: contract.checkOutDate,
          isActive: contract.status !== 'COMPLETED'
        }).catch(err => {
          console.error('Firestore 메타데이터 생성 실패 (채팅방 조회는 성공):', err);
        });

        console.log(`✅ 채팅방 자동 생성 완료: ${firebaseChatRoomId}`);

        // 다시 조회 (include 포함)
        chatRoom = await ChatRoom.findOne({
          where: { contractId },
          include: [
            {
              model: Contract,
              as: 'contract'
            },
            {
              model: Room,
              as: 'room',
              attributes: ['id', 'name', 'roadAddress']
            },
            {
              model: User,
              as: 'host',
              attributes: ['id', 'name', 'profileImageUrl']
            },
            {
              model: User,
              as: 'guest',
              attributes: ['id', 'name', 'profileImageUrl']
            }
          ]
        });

      } catch (createError) {
        console.error('채팅방 자동 생성 실패:', createError);
        return error(res, {
          code: 5001,
          message: '채팅방 생성에 실패했습니다.'
        }, 500);
      }
    }

    // 3. 권한 확인
    if (chatRoom.hostId !== userId && chatRoom.guestId !== userId) {
      return error(res, ErrorCodes.FORBIDDEN, 403);
    }

    return success(res, { chatRoom }, '채팅방 조회 성공');
  } catch (err) {
    console.error('계약별 채팅방 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 시스템 메시지 테스트 발송 (개발/테스트용)
 * POST /api/chats/rooms/:chatRoomId/system-message
 */
const sendTestSystemMessage = async (req, res) => {
  try {
    const { chatRoomId } = req.params;
    const { messageType, customText, metadata } = req.body;
    const userId = req.user.id;

    // 채팅방 조회 및 권한 확인
    const chatRoom = await ChatRoom.findOne({
      where: { firebaseChatRoomId: chatRoomId }
    });

    if (!chatRoom) {
      return error(res, {
        code: 3002,
        message: '채팅방을 찾을 수 없습니다.'
      }, 404);
    }

    // 권한 확인 (호스트 또는 게스트만)
    if (chatRoom.hostId !== userId && chatRoom.guestId !== userId) {
      return error(res, ErrorCodes.FORBIDDEN, 403);
    }

    // 메시지 타입 검증
    const validTypes = Object.values(SystemMessageTypes);
    if (messageType && !validTypes.includes(messageType)) {
      return error(res, {
        code: 4000,
        message: '유효하지 않은 시스템 메시지 타입입니다.',
        validTypes
      }, 400);
    }

    // 메시지 텍스트 생성
    const messageText = customText || getSystemMessageTemplate(
      messageType || SystemMessageTypes.IMPORTANT_NOTICE,
      metadata || {}
    );

    // 시스템 메시지 발송
    const result = await sendSystemMessage(
      chatRoomId,
      messageText,
      messageType || SystemMessageTypes.IMPORTANT_NOTICE,
      metadata || {}
    );

    return success(res, {
      message: result,
      chatRoomId
    }, '시스템 메시지 발송 완료');
  } catch (err) {
    console.error('시스템 메시지 테스트 발송 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

module.exports = {
  getCustomToken,
  createChatRoom,
  getMyChatRooms,
  getChatRoomDetail,
  getChatRoomByContractId,
  sendTestSystemMessage
};
