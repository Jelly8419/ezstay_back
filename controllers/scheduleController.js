const { success, created, deleted, error, ErrorCodes } = require('../utils/responseHelper');
const scheduleService = require('../services/scheduleService');
const { Room } = require('../models');

/**
 * 통합 일정 조회
 * GET /api/host/rooms/:roomId/schedule
 */
const getSchedule = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { startDate, endDate } = req.query;
    const hostId = req.user.id;

    // 1. 방 소유권 검증
    const room = await Room.findOne({
      where: { id: roomId, hostId }
    });

    if (!room) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    // 2. 일정 데이터 조회
    const scheduleData = await scheduleService.getScheduleData(roomId, startDate, endDate);

    return success(res, scheduleData, '일정 조회 성공');
  } catch (err) {
    console.error('Get schedule error:', err);

    if (err.message === 'ROOM_NOT_FOUND') {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 계약 불가 기간 생성
 * POST /api/host/rooms/:roomId/blocked-periods
 */
const createBlockedPeriod = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { startDate, endDate, reason } = req.body;
    const hostId = req.user.id;

    // 1. 입력 검증
    if (!startDate || !endDate) {
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400, {
        field: 'startDate, endDate는 필수 항목입니다.'
      });
    }

    // 날짜 형식 검증 (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, {
        field: '날짜 형식은 YYYY-MM-DD여야 합니다.'
      });
    }

    // 2. 방 소유권 검증
    const room = await Room.findOne({
      where: { id: roomId, hostId }
    });

    if (!room) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    // 3. 불가 기간 생성
    const blockedPeriod = await scheduleService.createBlockedPeriod(
      roomId,
      hostId,
      startDate,
      endDate,
      reason
    );

    return created(res, blockedPeriod, '계약 불가 기간이 설정되었습니다');
  } catch (err) {
    console.error('Create blocked period error:', err);

    if (err.message === 'PAST_DATE_NOT_ALLOWED') {
      return error(res, ErrorCodes.PAST_DATE_NOT_ALLOWED, 400);
    }

    if (err.message === 'INVALID_DATE_RANGE') {
      return error(res, ErrorCodes.INVALID_DATE_RANGE, 400);
    }

    if (err.message === 'CONFLICT_WITH_CONTRACT') {
      return error(res, ErrorCodes.CONFLICT_WITH_CONTRACT, 409, err.details);
    }

    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 계약 불가 기간 삭제
 * DELETE /api/host/rooms/:roomId/blocked-periods/:blockedId
 */
const deleteBlockedPeriod = async (req, res) => {
  try {
    const { roomId, blockedId } = req.params;
    const hostId = req.user.id;

    // 1. 방 소유권 검증
    const room = await Room.findOne({
      where: { id: roomId, hostId }
    });

    if (!room) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    // 2. 불가 기간 삭제
    await scheduleService.deleteBlockedPeriod(blockedId, hostId);

    return deleted(res, '계약 불가 기간이 삭제되었습니다');
  } catch (err) {
    console.error('Delete blocked period error:', err);

    if (err.message === 'BLOCKED_PERIOD_NOT_FOUND') {
      return error(res, ErrorCodes.BLOCKED_PERIOD_NOT_FOUND, 404);
    }

    if (err.message === 'FORBIDDEN') {
      return error(res, ErrorCodes.FORBIDDEN, 403);
    }

    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 계약 불가 기간 부분 해제
 * POST /api/host/rooms/:roomId/blocked-periods/unblock
 */
const unblockPeriod = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { startDate, endDate } = req.body;
    const hostId = req.user.id;

    // 1. 입력 검증
    if (!startDate || !endDate) {
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400, {
        field: 'startDate, endDate는 필수 항목입니다.'
      });
    }

    // 날짜 형식 검증 (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, {
        field: '날짜 형식은 YYYY-MM-DD여야 합니다.'
      });
    }

    // 2. 방 소유권 검증
    const room = await Room.findOne({
      where: { id: roomId, hostId }
    });

    if (!room) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    // 3. 부분 해제 실행
    const result = await scheduleService.unblockPeriod(roomId, hostId, startDate, endDate);

    return success(res, result, '계약 가능으로 전환되었습니다');
  } catch (err) {
    console.error('Unblock period error:', err);

    if (err.message === 'ROOM_NOT_FOUND') {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    if (err.message === 'INVALID_DATE_RANGE') {
      return error(res, ErrorCodes.INVALID_DATE_RANGE, 400);
    }

    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 방의 계약 목록 조회
 * GET /api/host/rooms/:roomId/contracts
 */
const getContracts = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { startDate, endDate } = req.query;
    const hostId = req.user.id;

    // 1. 방 소유권 검증
    const room = await Room.findOne({
      where: { id: roomId, hostId }
    });

    if (!room) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    // 2. 계약 목록 조회
    const result = await scheduleService.getContracts(roomId, startDate, endDate);

    return success(res, result, '계약 목록 조회 성공');
  } catch (err) {
    console.error('Get contracts error:', err);

    if (err.message === 'ROOM_NOT_FOUND') {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 방의 계약 불가 기간 목록 조회
 * GET /api/host/rooms/:roomId/blocked-periods
 */
const getBlockedPeriods = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { startDate, endDate } = req.query;
    const hostId = req.user.id;

    // 1. 방 소유권 검증
    const room = await Room.findOne({
      where: { id: roomId, hostId }
    });

    if (!room) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    // 2. 불가 기간 목록 조회
    const result = await scheduleService.getBlockedPeriods(roomId, startDate, endDate);

    return success(res, result, '계약 불가 기간 목록 조회 성공');
  } catch (err) {
    console.error('Get blocked periods error:', err);

    if (err.message === 'ROOM_NOT_FOUND') {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 방 기본 정보 조회
 * GET /api/host/rooms/:roomId/schedule-info
 */
const getRoomScheduleInfo = async (req, res) => {
  try {
    const { roomId } = req.params;
    const hostId = req.user.id;

    // 1. 방 소유권 검증
    const room = await Room.findOne({
      where: { id: roomId, hostId }
    });

    if (!room) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    // 2. 방 기본 정보 조회
    const result = await scheduleService.getRoomScheduleInfo(roomId);

    return success(res, result, '방 정보 조회 성공');
  } catch (err) {
    console.error('Get room schedule info error:', err);

    if (err.message === 'ROOM_NOT_FOUND') {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

module.exports = {
  getSchedule,
  createBlockedPeriod,
  deleteBlockedPeriod,
  unblockPeriod,
  getContracts,
  getBlockedPeriods,
  getRoomScheduleInfo
};
