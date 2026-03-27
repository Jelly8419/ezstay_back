const { AutoMessageTemplate, Room, User } = require('../models');
const { success, error, created, updated, deleted, ErrorCodes } = require('../utils/responseHelper');
const { Op } = require('sequelize');

/**
 * 자동메시지 템플릿 목록 조회
 * GET /api/host/auto-messages
 * Query params:
 *   - roomId: 특정 방의 템플릿만 조회 (선택)
 *   - triggerType: 트리거 타입 필터 (선택)
 *   - isActive: 활성화 상태 필터 (선택)
 */
const getAutoMessageTemplates = async (req, res) => {
  try {
    const hostId = req.user.id;
    const { roomId, triggerType, isActive } = req.query;

    // 필터 조건 생성
    const whereClause = { hostId };

    if (roomId) {
      whereClause.roomId = roomId;
    }
    if (triggerType) {
      whereClause.triggerType = triggerType;
    }
    if (isActive !== undefined) {
      whereClause.isActive = isActive === 'true';
    }

    const templates = await AutoMessageTemplate.findAll({
      where: whereClause,
      include: [
        {
          model: Room,
          as: 'room',
          attributes: ['id', 'roomName', 'address']
        }
      ],
      order: [
        ['roomId', 'ASC'],
        ['triggerType', 'ASC'],
        ['createdAt', 'DESC']
      ]
    });

    return success(res, {
      templates,
      total: templates.length
    }, '자동메시지 템플릿 목록 조회 성공');
  } catch (err) {
    console.error('자동메시지 템플릿 목록 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 자동메시지 템플릿 상세 조회
 * GET /api/host/auto-messages/:id
 */
const getAutoMessageTemplate = async (req, res) => {
  try {
    const hostId = req.user.id;
    const { id } = req.params;

    const template = await AutoMessageTemplate.findOne({
      where: { id, hostId },
      include: [
        {
          model: Room,
          as: 'room',
          attributes: ['id', 'roomName', 'address']
        }
      ]
    });

    if (!template) {
      return error(res, {
        code: 3010,
        message: '자동메시지 템플릿을 찾을 수 없습니다.'
      }, 404);
    }

    return success(res, { template }, '자동메시지 템플릿 조회 성공');
  } catch (err) {
    console.error('자동메시지 템플릿 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 자동메시지 템플릿 생성
 * POST /api/host/auto-messages
 * roomIds: 단일 숫자 또는 배열 모두 허용
 */
const createAutoMessageTemplate = async (req, res) => {
  try {
    const hostId = req.user.id;
    const {
      roomId,
      roomIds,
      triggerType,
      triggerDays,
      triggerTime,
      title,
      messageContent
    } = req.body;

    // roomId(단일) 또는 roomIds(배열) 정규화
    const targetRoomIds = roomIds
      ? (Array.isArray(roomIds) ? roomIds : [roomIds])
      : roomId
        ? [roomId]
        : [];

    // 필수 필드 검증
    if (!targetRoomIds.length || !triggerType || !title || !messageContent) {
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400, {
        required: ['roomId 또는 roomIds', 'triggerType', 'title', 'messageContent']
      });
    }

    // 트리거 타입 검증
    const validTriggerTypes = ['CONTRACT_CONFIRMED', 'BEFORE_CHECK_IN', 'BEFORE_CHECK_OUT'];
    if (!validTriggerTypes.includes(triggerType)) {
      return error(res, {
        code: 4010,
        message: '유효하지 않은 트리거 타입입니다.',
        validTypes: validTriggerTypes
      }, 400);
    }

    // 시간 형식 검증 (HH:mm)
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (triggerTime && !timeRegex.test(triggerTime)) {
      return error(res, {
        code: 4011,
        message: '발송 시각 형식이 올바르지 않습니다. (HH:mm 형식)'
      }, 400);
    }

    // 방 소유권 일괄 확인
    const rooms = await Room.findAll({
      where: { id: targetRoomIds, hostId },
      attributes: ['id', 'roomName', 'address']
    });

    if (rooms.length !== targetRoomIds.length) {
      const foundIds = rooms.map(r => r.id);
      const notFound = targetRoomIds.filter(id => !foundIds.includes(Number(id)));
      return error(res, {
        code: 3011,
        message: '해당 방을 찾을 수 없거나 권한이 없습니다.',
        notFoundRoomIds: notFound
      }, 404);
    }

    const finalTriggerDays = triggerType === 'CONTRACT_CONFIRMED' ? 0 : (triggerDays || 0);
    const finalTriggerTime = triggerTime || '09:00';

    // 방별 템플릿 일괄 생성
    const createdTemplates = await AutoMessageTemplate.bulkCreate(
      targetRoomIds.map(rid => ({
        hostId,
        roomId: rid,
        triggerType,
        triggerDays: finalTriggerDays,
        triggerTime: finalTriggerTime,
        title,
        messageContent,
        isActive: true
      }))
    );

    // 생성된 템플릿을 방 정보와 함께 반환
    const resultTemplates = await AutoMessageTemplate.findAll({
      where: { id: createdTemplates.map(t => t.id) },
      include: [{ model: Room, as: 'room', attributes: ['id', 'roomName', 'address'] }],
      order: [['roomId', 'ASC']]
    });

    const isBulk = targetRoomIds.length > 1;
    return created(
      res,
      isBulk ? { templates: resultTemplates, total: resultTemplates.length } : { template: resultTemplates[0] },
      isBulk ? `자동메시지 템플릿 ${resultTemplates.length}개 생성 성공` : '자동메시지 템플릿 생성 성공'
    );
  } catch (err) {
    console.error('자동메시지 템플릿 생성 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 자동메시지 템플릿 수정
 * PATCH /api/host/auto-messages/:id
 */
const updateAutoMessageTemplate = async (req, res) => {
  try {
    const hostId = req.user.id;
    const { id } = req.params;
    const {
      triggerType,
      triggerDays,
      triggerTime,
      title,
      messageContent
    } = req.body;

    // 템플릿 존재 및 소유권 확인
    const template = await AutoMessageTemplate.findOne({
      where: { id, hostId }
    });

    if (!template) {
      return error(res, {
        code: 3010,
        message: '자동메시지 템플릿을 찾을 수 없습니다.'
      }, 404);
    }

    // 업데이트할 필드 준비
    const updateData = {};

    if (triggerType !== undefined) {
      const validTriggerTypes = ['CONTRACT_CONFIRMED', 'BEFORE_CHECK_IN', 'BEFORE_CHECK_OUT'];
      if (!validTriggerTypes.includes(triggerType)) {
        return error(res, {
          code: 4010,
          message: '유효하지 않은 트리거 타입입니다.'
        }, 400);
      }
      updateData.triggerType = triggerType;
    }

    if (triggerDays !== undefined) {
      // triggerType이 CONTRACT_CONFIRMED이면 triggerDays는 0
      const finalTriggerType = triggerType || template.triggerType;
      updateData.triggerDays = finalTriggerType === 'CONTRACT_CONFIRMED' ? 0 : triggerDays;
    }

    if (triggerTime !== undefined) {
      const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
      if (!timeRegex.test(triggerTime)) {
        return error(res, {
          code: 4011,
          message: '발송 시각 형식이 올바르지 않습니다. (HH:mm 형식)'
        }, 400);
      }
      updateData.triggerTime = triggerTime;
    }

    if (title !== undefined) {
      updateData.title = title;
    }

    if (messageContent !== undefined) {
      updateData.messageContent = messageContent;
    }

    await template.update(updateData);

    // 업데이트된 템플릿 반환
    const updatedTemplate = await AutoMessageTemplate.findOne({
      where: { id },
      include: [
        {
          model: Room,
          as: 'room',
          attributes: ['id', 'roomName', 'address']
        }
      ]
    });

    return updated(res, { template: updatedTemplate }, '자동메시지 템플릿 수정 성공');
  } catch (err) {
    console.error('자동메시지 템플릿 수정 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 자동메시지 템플릿 삭제
 * DELETE /api/host/auto-messages/:id
 */
const deleteAutoMessageTemplate = async (req, res) => {
  try {
    const hostId = req.user.id;
    const { id } = req.params;

    // 템플릿 존재 및 소유권 확인
    const template = await AutoMessageTemplate.findOne({
      where: { id, hostId }
    });

    if (!template) {
      return error(res, {
        code: 3010,
        message: '자동메시지 템플릿을 찾을 수 없습니다.'
      }, 404);
    }

    await template.destroy();

    return deleted(res, '자동메시지 템플릿 삭제 성공');
  } catch (err) {
    console.error('자동메시지 템플릿 삭제 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 자동메시지 템플릿 활성화/비활성화 토글
 * PATCH /api/host/auto-messages/:id/toggle
 */
const toggleAutoMessageTemplate = async (req, res) => {
  try {
    const hostId = req.user.id;
    const { id } = req.params;

    // 템플릿 존재 및 소유권 확인
    const template = await AutoMessageTemplate.findOne({
      where: { id, hostId }
    });

    if (!template) {
      return error(res, {
        code: 3010,
        message: '자동메시지 템플릿을 찾을 수 없습니다.'
      }, 404);
    }

    // 토글
    await template.update({
      isActive: !template.isActive
    });

    return success(res, {
      id: template.id,
      isActive: template.isActive
    }, `자동메시지 템플릿 ${template.isActive ? '활성화' : '비활성화'} 성공`);
  } catch (err) {
    console.error('자동메시지 템플릿 토글 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 특정 방의 자동메시지 템플릿 목록 조회
 * GET /api/host/rooms/:roomId/auto-messages
 */
const getRoomAutoMessageTemplates = async (req, res) => {
  try {
    const hostId = req.user.id;
    const { roomId } = req.params;

    // 방 소유권 확인
    const room = await Room.findOne({
      where: { id: roomId, hostId }
    });

    if (!room) {
      return error(res, {
        code: 3011,
        message: '해당 방을 찾을 수 없거나 권한이 없습니다.'
      }, 404);
    }

    const templates = await AutoMessageTemplate.findAll({
      where: { roomId, hostId },
      order: [
        ['triggerType', 'ASC'],
        ['triggerDays', 'ASC']
      ]
    });

    return success(res, {
      room: {
        id: room.id,
        roomName: room.roomName,
        address: room.address
      },
      templates,
      total: templates.length
    }, '방별 자동메시지 템플릿 목록 조회 성공');
  } catch (err) {
    console.error('방별 자동메시지 템플릿 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

module.exports = {
  getAutoMessageTemplates,
  getAutoMessageTemplate,
  createAutoMessageTemplate,
  updateAutoMessageTemplate,
  deleteAutoMessageTemplate,
  toggleAutoMessageTemplate,
  getRoomAutoMessageTemplates
};
