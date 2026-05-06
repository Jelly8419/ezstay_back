/**
 * moveInRoomController.js
 * 입주 준비 서비스용 간편 방 정보 CRUD (임대인)
 *
 * - 정식 Room과 분리: 심사/노출 없음
 * - 도어락/공동현관 비밀번호는 utils/cryptoHelper로 AES 암/복호화
 * - 본인(host)만 자신의 방을 조회/수정/삭제 가능
 */
const { Op } = require('sequelize');
const { sequelize, MoveInRoom, MoveInCase } = require('../models');
const { ErrorCodes, success, error, created, updated, deleted } = require('../utils/responseHelper');
const cryptoHelper = require('../utils/cryptoHelper');

const VALID_BED_SIZES = ['SINGLE', 'SUPER_SINGLE', 'DOUBLE', 'QUEEN', 'KING'];

/**
 * 입력값 정규화 + 검증
 * - bed_count와 beds.length 일치
 * - cleaning_supplies_available=true 시 location 필수
 * - bed size enum 검증
 */
function validateRoomPayload(body, { partial = false } = {}) {
  const errors = [];

  if (!partial || body.address !== undefined) {
    if (!body.address || typeof body.address !== 'string') errors.push('address는 필수 문자열입니다.');
  }
  if (!partial || body.detailAddress !== undefined) {
    if (!body.detailAddress || typeof body.detailAddress !== 'string') errors.push('detailAddress는 필수 문자열입니다.');
  }
  if (!partial || body.areaPyeong !== undefined) {
    const a = Number(body.areaPyeong);
    if (!Number.isFinite(a) || a <= 0) errors.push('areaPyeong은 양수여야 합니다.');
  }

  ['livingRoomCount', 'roomCount', 'bathroomCount', 'bedCount'].forEach(k => {
    if (!partial || body[k] !== undefined) {
      const v = body[k];
      if (!Number.isInteger(v) || v < 0) errors.push(`${k}는 0 이상의 정수여야 합니다.`);
    }
  });

  if (!partial || body.beds !== undefined) {
    if (!Array.isArray(body.beds)) {
      errors.push('beds는 배열이어야 합니다.');
    } else {
      if (body.bedCount !== undefined && body.beds.length !== body.bedCount) {
        errors.push('beds 배열 길이와 bedCount가 일치해야 합니다.');
      }
      body.beds.forEach((bed, i) => {
        if (!bed || typeof bed !== 'object') {
          errors.push(`beds[${i}]는 객체여야 합니다.`);
          return;
        }
        if (!VALID_BED_SIZES.includes(bed.size)) {
          errors.push(`beds[${i}].size는 ${VALID_BED_SIZES.join('/')} 중 하나여야 합니다.`);
        }
      });
    }
  }

  if (!partial || body.cleaningSuppliesAvailable !== undefined) {
    if (typeof body.cleaningSuppliesAvailable !== 'boolean') {
      errors.push('cleaningSuppliesAvailable은 boolean이어야 합니다.');
    }
    if (body.cleaningSuppliesAvailable === true && !body.cleaningSuppliesLocation) {
      errors.push('청소용품 구비 시 cleaningSuppliesLocation은 필수입니다.');
    }
  }

  return errors;
}

/**
 * MoveInRoom 인스턴스 → API 응답 객체 (비밀번호 복호화)
 */
function serializeRoom(room) {
  if (!room) return null;
  return {
    id: room.id,
    roomName: room.roomName,
    address: room.address,
    detailAddress: room.detailAddress,
    areaPyeong: Number(room.areaPyeong),
    livingRoomCount: room.livingRoomCount,
    roomCount: room.roomCount,
    bathroomCount: room.bathroomCount,
    bedCount: room.bedCount,
    beds: room.beds,
    commonEntrancePassword: cryptoHelper.decrypt(room.commonEntrancePassword),
    doorLockPassword: cryptoHelper.decrypt(room.doorLockPassword),
    cleaningSuppliesAvailable: room.cleaningSuppliesAvailable,
    cleaningSuppliesLocation: room.cleaningSuppliesLocation,
    memo: room.memo,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt
  };
}

/**
 * GET /api/host/move-in/rooms
 * 임대인의 간편 방 목록
 */
const getRooms = async (req, res) => {
  try {
    const hostId = req.user.id;
    const rooms = await MoveInRoom.findAll({
      where: { hostId },
      order: [['createdAt', 'DESC']]
    });
    return success(res, rooms.map(serializeRoom));
  } catch (err) {
    console.error('MoveInRoom 목록 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * POST /api/host/move-in/rooms
 * 간편 방 등록
 */
const createRoom = async (req, res) => {
  try {
    const hostId = req.user.id;
    const validationErrors = validateRoomPayload(req.body);
    if (validationErrors.length > 0) {
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, validationErrors);
    }

    const room = await MoveInRoom.create({
      hostId,
      roomName: req.body.roomName ?? null,
      address: req.body.address,
      detailAddress: req.body.detailAddress,
      areaPyeong: req.body.areaPyeong,
      livingRoomCount: req.body.livingRoomCount,
      roomCount: req.body.roomCount,
      bathroomCount: req.body.bathroomCount,
      bedCount: req.body.bedCount,
      beds: req.body.beds,
      commonEntrancePassword: cryptoHelper.encrypt(req.body.commonEntrancePassword),
      doorLockPassword: cryptoHelper.encrypt(req.body.doorLockPassword),
      cleaningSuppliesAvailable: req.body.cleaningSuppliesAvailable,
      cleaningSuppliesLocation: req.body.cleaningSuppliesAvailable
        ? (req.body.cleaningSuppliesLocation ?? null)
        : null,
      memo: req.body.memo ?? null
    });

    return created(res, serializeRoom(room), '간편 방 정보가 등록되었습니다.');
  } catch (err) {
    console.error('MoveInRoom 생성 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * GET /api/host/move-in/rooms/:roomId
 * 간편 방 상세 (본인 방만)
 */
const getRoom = async (req, res) => {
  try {
    const hostId = req.user.id;
    const { roomId } = req.params;

    const room = await MoveInRoom.findOne({
      where: { id: roomId, hostId }
    });

    if (!room) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    return success(res, serializeRoom(room));
  } catch (err) {
    console.error('MoveInRoom 상세 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * PATCH /api/host/move-in/rooms/:roomId
 * 간편 방 정보 수정
 *
 * PRD 12.5: 수정된 방 정보는 이후 신규 케이스에만 반영
 * (이미 생성된 케이스는 room_snapshot으로 락인되어 있음)
 */
const updateRoom = async (req, res) => {
  try {
    const hostId = req.user.id;
    const { roomId } = req.params;

    const room = await MoveInRoom.findOne({ where: { id: roomId, hostId } });
    if (!room) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    const validationErrors = validateRoomPayload(req.body, { partial: true });
    if (validationErrors.length > 0) {
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, validationErrors);
    }

    const updateData = {};
    const directFields = [
      'roomName', 'address', 'detailAddress', 'areaPyeong',
      'livingRoomCount', 'roomCount', 'bathroomCount', 'bedCount',
      'beds', 'cleaningSuppliesAvailable', 'memo'
    ];
    directFields.forEach(f => {
      if (req.body[f] !== undefined) updateData[f] = req.body[f];
    });

    // 비밀번호 암호화
    if (req.body.commonEntrancePassword !== undefined) {
      updateData.commonEntrancePassword = cryptoHelper.encrypt(req.body.commonEntrancePassword);
    }
    if (req.body.doorLockPassword !== undefined) {
      updateData.doorLockPassword = cryptoHelper.encrypt(req.body.doorLockPassword);
    }

    // cleaning_supplies 처리
    const finalAvailable = req.body.cleaningSuppliesAvailable !== undefined
      ? req.body.cleaningSuppliesAvailable
      : room.cleaningSuppliesAvailable;
    if (finalAvailable === false) {
      updateData.cleaningSuppliesLocation = null;
    } else if (req.body.cleaningSuppliesLocation !== undefined) {
      updateData.cleaningSuppliesLocation = req.body.cleaningSuppliesLocation;
    }

    await room.update(updateData);

    return updated(res, serializeRoom(room), '간편 방 정보가 수정되었습니다.');
  } catch (err) {
    console.error('MoveInRoom 수정 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * DELETE /api/host/move-in/rooms/:roomId
 * Soft delete
 *
 * 방에 연결된 케이스가 있으면 차단 (이미 진행 중 데이터 보호)
 */
const deleteRoom = async (req, res) => {
  try {
    const hostId = req.user.id;
    const { roomId } = req.params;

    const room = await MoveInRoom.findOne({ where: { id: roomId, hostId } });
    if (!room) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    const hasCases = await MoveInCase.count({ where: { moveInRoomId: room.id } });
    if (hasCases > 0) {
      return error(res, ErrorCodes.ROOM_HAS_CONTRACTS, 400, '연결된 입주 준비 등록이 있어 삭제할 수 없습니다.');
    }

    await room.destroy(); // paranoid=true → soft delete
    return deleted(res, '간편 방 정보가 삭제되었습니다.');
  } catch (err) {
    console.error('MoveInRoom 삭제 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

module.exports = {
  getRooms,
  createRoom,
  getRoom,
  updateRoom,
  deleteRoom
};
