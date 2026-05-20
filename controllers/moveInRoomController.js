/**
 * moveInRoomController.js
 * 입주 준비 서비스용 간편 방 정보 CRUD (임대인)
 *
 * - 정식 Room과 분리: 심사/노출 없음
 * - 도어락/공동현관 비밀번호는 utils/cryptoHelper로 AES 암/복호화
 * - 본인(host)만 자신의 방을 조회/수정/삭제 가능
 */
const { Op } = require('sequelize');
const { sequelize, MoveInRoom, MoveInCase, MoveInRoomStatusHistory } = require('../models');
const { ErrorCodes, success, error, created, updated, deleted } = require('../utils/responseHelper');
const cryptoHelper = require('../utils/cryptoHelper');
const { toKSTString } = require('../utils/dateHelper');

const VALID_BED_SIZES = ['SINGLE', 'SUPER_SINGLE', 'DOUBLE', 'QUEEN', 'KING'];

/**
 * 재심사 트리거 필드 (Notion "입주 준비 서비스 Admin" PRD)
 * 이 필드들이 변경되면 reviewStatus 가 PENDING 으로 재진입
 */
const REVIEW_TRIGGER_FIELDS = [
  'address',
  'detailAddress',
  'areaPyeong',
  'livingRoomCount',
  'roomCount',
  'bathroomCount',
  'bedCount'
];

/**
 * 재심사가 트리거되는 현재 상태 — APPROVED 또는 REJECTED 일 때만 PENDING 으로 재진입.
 * PENDING 상태에서 수정은 그대로 PENDING 유지 (이미 심사 대기 중).
 */
const REVIEW_TRIGGER_STATUSES = ['APPROVED', 'REJECTED'];

/**
 * 트리거 필드 변경 여부 판정
 * - 숫자/문자열은 != 비교, 기타(객체/배열)는 stringify 비교
 */
function detectChangedTriggerFields(body, room) {
  return REVIEW_TRIGGER_FIELDS.filter((f) => {
    if (body[f] === undefined) return false;
    const before = room[f];
    const after = body[f];
    if (typeof before === 'object' || typeof after === 'object') {
      return JSON.stringify(before) !== JSON.stringify(after);
    }
    // areaPyeong 은 DECIMAL → 문자열 비교 시 오해 가능 → Number 비교
    if (f === 'areaPyeong') return Number(before) !== Number(after);
    return before !== after;
  });
}

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
 * MoveInRoom 인스턴스 → API 응답 객체 (비밀번호 복호화 + 심사 상태 노출)
 *
 * UI 가이드 필드:
 *   - isSelectable: 케이스 등록 화면에서 라디오/선택 활성화 여부 (APPROVED 만)
 *   - isEditable:   카드 편집 버튼 노출 여부 (APPROVED 만, PRD)
 *                   ※ 백엔드 PATCH 자체는 모든 상태에서 허용 — UI 가드만 강제
 */
function serializeRoom(room) {
  if (!room) return null;
  const isApproved = room.reviewStatus === 'APPROVED';
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
    reviewStatus: room.reviewStatus,
    submittedAt: toKSTString(room.submittedAt),
    approvedAt: toKSTString(room.approvedAt),
    rejectedAt: toKSTString(room.rejectedAt),
    rejectionReason: room.rejectionReason,
    isSelectable: isApproved,
    isEditable: isApproved,
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
 *
 * 정책: 등록 시 reviewStatus=PENDING 으로 시작 (Notion "입주 준비 서비스 Admin" PRD)
 *       관리자 승인 후에만 케이스 등록 가능
 */
const createRoom = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const hostId = req.user.id;
    const validationErrors = validateRoomPayload(req.body);
    if (validationErrors.length > 0) {
      await transaction.rollback();
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, validationErrors);
    }

    const now = new Date();
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
      memo: req.body.memo ?? null,
      reviewStatus: 'PENDING',
      submittedAt: now
    }, { transaction });

    await MoveInRoomStatusHistory.create({
      moveInRoomId: room.id,
      adminId: null,
      changedBy: 'SYSTEM',
      previousStatus: null,
      newStatus: 'PENDING',
      reason: '최초 방 등록',
      ipAddress: req.ip || req.connection?.remoteAddress || null,
      userAgent: req.get?.('User-Agent') || null,
      changedAt: now
    }, { transaction });

    await transaction.commit();
    return created(res, serializeRoom(room), '간편 방 정보가 등록되었습니다. 관리자 심사 후 사용 가능합니다.');
  } catch (err) {
    await transaction.rollback();
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
 * 정책:
 *  - PRD 12.5: 수정된 방 정보는 이후 신규 케이스에만 반영
 *    (이미 생성된 케이스는 room_snapshot 으로 락인)
 *  - Notion Admin PRD: 트리거 필드(주소·평수·거실·방·화장실·침대 수) 변경 시
 *    APPROVED/REJECTED 였던 방은 PENDING 으로 재진입 → 재심사 필요
 *  - PENDING 상태에서 수정은 그대로 PENDING (이미 심사 대기 중)
 */
const updateRoom = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const hostId = req.user.id;
    const { roomId } = req.params;

    const room = await MoveInRoom.findOne({ where: { id: roomId, hostId }, transaction });
    if (!room) {
      await transaction.rollback();
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    const validationErrors = validateRoomPayload(req.body, { partial: true });
    if (validationErrors.length > 0) {
      await transaction.rollback();
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, validationErrors);
    }

    // 1) 재심사 트리거 판정 — update 전에 비교
    const changedTriggerFields = detectChangedTriggerFields(req.body, room);
    const needsReReview =
      changedTriggerFields.length > 0
      && REVIEW_TRIGGER_STATUSES.includes(room.reviewStatus);
    const previousStatus = room.reviewStatus;

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

    // 2) 재심사 진입 처리
    const now = new Date();
    if (needsReReview) {
      updateData.reviewStatus = 'PENDING';
      updateData.submittedAt = now;
      updateData.rejectionReason = null; // 이전 반려 사유 초기화
      updateData.rejectedAt = null;
    }

    await room.update(updateData, { transaction });

    // 3) 재심사 진입 시 이력 기록
    if (needsReReview) {
      await MoveInRoomStatusHistory.create({
        moveInRoomId: room.id,
        adminId: null,
        changedBy: 'HOST',
        previousStatus,
        newStatus: 'PENDING',
        reason: '심사 트리거 필드 변경으로 재심사 진입',
        triggeredFields: changedTriggerFields,
        ipAddress: req.ip || req.connection?.remoteAddress || null,
        userAgent: req.get?.('User-Agent') || null,
        changedAt: now
      }, { transaction });
    }

    await transaction.commit();

    const message = needsReReview
      ? '방 정보가 수정되었습니다. 변경된 항목이 있어 재심사가 진행됩니다.'
      : '간편 방 정보가 수정되었습니다.';

    return updated(res, serializeRoom(room), message);
  } catch (err) {
    await transaction.rollback();
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

/**
 * GET /api/host/move-in/rooms/:roomId/occupied-ranges
 * 캘린더 비활성화용 — 해당 방의 케이스 점유 구간 목록
 *
 * 정책: 케이스가 존재하면 곧 점유 (status 필드 없음, 삭제 API 없음)
 * 쿼리: ?from=YYYY-MM-DD (선택) — 해당 날짜 이후로 끝나는 케이스만
 */
const getOccupiedRanges = async (req, res) => {
  try {
    const hostId = req.user.id;
    const { roomId } = req.params;
    const { from } = req.query;

    const room = await MoveInRoom.findOne({ where: { id: roomId, hostId } });
    if (!room) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    const where = { moveInRoomId: room.id };
    if (from) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
        return error(res, ErrorCodes.VALIDATION_ERROR, 400, 'from은 YYYY-MM-DD 형식이어야 합니다.');
      }
      where.checkOutDate = { [Op.gt]: from };
    }

    const cases = await MoveInCase.findAll({
      where,
      attributes: ['id', 'checkInDate', 'checkOutDate'],
      order: [['checkInDate', 'ASC']]
    });

    const ranges = cases.map(c => ({
      caseId: c.id,
      checkInDate: c.checkInDate,
      checkOutDate: c.checkOutDate
    }));

    return success(res, { moveInRoomId: room.id, ranges });
  } catch (err) {
    console.error('MoveInRoom occupied-ranges 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

module.exports = {
  getRooms,
  createRoom,
  getRoom,
  updateRoom,
  deleteRoom,
  getOccupiedRanges
};
