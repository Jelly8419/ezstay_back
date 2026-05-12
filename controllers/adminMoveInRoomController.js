/**
 * adminMoveInRoomController.js
 * 관리자용 입주 준비 방 심사 관리
 *
 * 기존 정식 매물 심사 화면(/api/admin/properties)과 통합:
 *  - source=internal | move_in | all 쿼리로 분기
 *  - 두 도메인을 동일 응답 포맷으로 직렬화 (id 충돌 방지를 위해 source 명시)
 *
 * 외부 호출 진입점:
 *  - listMoveInRooms({ status, page, limit })  → adminController.getProperties/getPendingReviews 위임
 *  - getMoveInRoomDetail(id)                   → adminController.getPropertyDetail 위임
 *  - approveMoveInRoom(id, admin, req)         → adminController.approveProperty 위임
 *  - rejectMoveInRoom(id, reason, admin, req)  → adminController.rejectProperty 위임
 *
 * 비밀번호 복호화: 단건 조회 시에만 노출 (목록은 미노출)
 */
const { Op } = require('sequelize');
const {
  sequelize,
  MoveInRoom,
  MoveInRoomStatusHistory,
  MoveInCase,
  User,
  Admin
} = require('../models');
const cryptoHelper = require('../utils/cryptoHelper');
const { toKSTString } = require('../utils/dateHelper');

const VALID_REVIEW_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];

/**
 * MoveInRoom + Host include 결과를 응답 포맷으로 직렬화
 * - 정식 매물 심사 응답과 동일 키 사용 + source 필드
 * - 일일 임대료(dailyRent) 컬럼 자리에는 "입주 준비 서비스" 라벨
 */
function serializeRoomForAdmin(room, { decryptPasswords = false } = {}) {
  const host = room.host ? {
    id: room.host.id,
    name: room.host.name,
    nickname: room.host.nickname,
    email: room.host.email,
    phoneNumber: room.host.phoneNumber
  } : null;

  const passwords = decryptPasswords ? {
    commonEntrancePassword: cryptoHelper.decrypt(room.commonEntrancePassword),
    doorLockPassword: cryptoHelper.decrypt(room.doorLockPassword)
  } : {};

  return {
    source: 'move_in',
    id: room.id,
    hostId: room.hostId,
    host,
    roomName: room.roomName,
    address: room.address,
    detailAddress: room.detailAddress,
    areaPyeong: Number(room.areaPyeong),
    livingRoomCount: room.livingRoomCount,
    roomCount: room.roomCount,
    bathroomCount: room.bathroomCount,
    bedCount: room.bedCount,
    beds: room.beds,
    cleaningSuppliesAvailable: room.cleaningSuppliesAvailable,
    cleaningSuppliesLocation: room.cleaningSuppliesLocation,
    memo: room.memo,
    reviewStatus: room.reviewStatus,
    submittedAt: toKSTString(room.submittedAt),
    approvedAt: toKSTString(room.approvedAt),
    rejectedAt: toKSTString(room.rejectedAt),
    rejectionReason: room.rejectionReason,
    // 정식 매물 심사 리스트와 컬럼 호환: 일일 임대료 자리에 라벨 표시
    dailyRent: null,
    dailyRentLabel: '입주 준비 서비스',
    createdAt: toKSTString(room.createdAt),
    updatedAt: toKSTString(room.updatedAt),
    ...passwords
  };
}

/**
 * 상태 변경 이력 직렬화
 */
function serializeHistory(h) {
  return {
    id: h.id,
    changedBy: h.changedBy,
    previousStatus: h.previousStatus,
    newStatus: h.newStatus,
    adminId: h.adminId,
    adminName: h.admin?.name || null,
    reason: h.reason,
    triggeredFields: h.triggeredFields,
    ipAddress: h.ipAddress,
    changedAt: toKSTString(h.changedAt)
  };
}

/**
 * 목록 헬퍼 — adminController.getProperties / getPendingReviews 에서 호출
 *
 * @param {Object} opts
 * @param {string} [opts.status]   필터 (PENDING | APPROVED | REJECTED)
 * @param {string} [opts.search]   roomName / address / host name LIKE
 * @param {number} [opts.page]
 * @param {number} [opts.limit]
 * @param {boolean} [opts.pendingOnly]  심사 대기 화면 전용 (status='PENDING' 강제)
 * @returns {Promise<{ rows, count }>}
 */
async function listMoveInRooms({ status, search, page = 1, limit = 20, pendingOnly = false } = {}) {
  const where = {};
  if (pendingOnly) {
    where.reviewStatus = 'PENDING';
  } else if (status && VALID_REVIEW_STATUSES.includes(status)) {
    where.reviewStatus = status;
  }

  const include = [{
    model: User,
    as: 'host',
    attributes: ['id', 'name', 'nickname', 'email', 'phoneNumber']
  }];

  if (search) {
    where[Op.or] = [
      { roomName: { [Op.like]: `%${search}%` } },
      { address: { [Op.like]: `%${search}%` } }
    ];
  }

  const offset = (parseInt(page) - 1) * parseInt(limit);

  const { rows, count } = await MoveInRoom.findAndCountAll({
    where,
    include,
    offset,
    limit: parseInt(limit),
    order: pendingOnly
      ? [['submittedAt', 'ASC']]    // 심사 대기 — 제출일 순
      : [['createdAt', 'DESC']],
    distinct: true
  });

  return {
    rows: rows.map(r => serializeRoomForAdmin(r)),
    count
  };
}

/**
 * 단건 헬퍼 — 비밀번호 복호화 + 이력 50건 포함
 */
async function getMoveInRoomDetail(id) {
  const room = await MoveInRoom.findByPk(id, {
    include: [
      { model: User, as: 'host', attributes: ['id', 'name', 'nickname', 'email', 'phoneNumber'] },
      {
        model: MoveInRoomStatusHistory,
        as: 'statusHistories',
        separate: true,
        limit: 50,
        order: [['changedAt', 'DESC']],
        include: [{ model: Admin, as: 'admin', attributes: ['id', 'name'] }]
      }
    ]
  });
  if (!room) return null;

  const serialized = serializeRoomForAdmin(room, { decryptPasswords: true });
  serialized.statusHistories = (room.statusHistories || []).map(serializeHistory);
  return serialized;
}

/**
 * 승인 헬퍼
 *
 * @param {number} id          MoveInRoom id
 * @param {Object} admin       req.admin (id, name)
 * @param {Object} req         req (ip/UA 추출용)
 * @returns {Promise<{ ok: boolean, code?: string, room?: Object }>}
 */
async function approveMoveInRoom(id, admin, req) {
  const transaction = await sequelize.transaction();
  try {
    const room = await MoveInRoom.findByPk(id, { transaction });
    if (!room) {
      await transaction.rollback();
      return { ok: false, code: 'ROOM_NOT_FOUND' };
    }
    if (room.reviewStatus !== 'PENDING') {
      await transaction.rollback();
      return { ok: false, code: 'NOT_PENDING', currentStatus: room.reviewStatus };
    }

    const previousStatus = room.reviewStatus;
    const now = new Date();

    await room.update({
      reviewStatus: 'APPROVED',
      approvedAt: now,
      rejectedAt: null,
      rejectionReason: null
    }, { transaction });

    await MoveInRoomStatusHistory.create({
      moveInRoomId: room.id,
      adminId: admin.id,
      changedBy: 'ADMIN',
      previousStatus,
      newStatus: 'APPROVED',
      reason: '심사 승인',
      ipAddress: req.ip || req.connection?.remoteAddress || null,
      userAgent: req.get?.('User-Agent') || null,
      changedAt: now
    }, { transaction });

    await transaction.commit();

    // 알림 발송 (best-effort, commit 후)
    try {
      const NotificationService = require('../services/notificationService');
      await NotificationService.notifyMoveInRoomReviewResult(room, true);
    } catch (notifyErr) {
      console.error('[MoveInRoom] 승인 알림 실패:', notifyErr.message);
    }

    return { ok: true, room: serializeRoomForAdmin(room) };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

/**
 * 반려 헬퍼
 */
async function rejectMoveInRoom(id, rejectionReason, admin, req) {
  if (!rejectionReason || typeof rejectionReason !== 'string') {
    return { ok: false, code: 'MISSING_REASON' };
  }
  const transaction = await sequelize.transaction();
  try {
    const room = await MoveInRoom.findByPk(id, { transaction });
    if (!room) {
      await transaction.rollback();
      return { ok: false, code: 'ROOM_NOT_FOUND' };
    }
    if (room.reviewStatus !== 'PENDING') {
      await transaction.rollback();
      return { ok: false, code: 'NOT_PENDING', currentStatus: room.reviewStatus };
    }

    const previousStatus = room.reviewStatus;
    const now = new Date();

    await room.update({
      reviewStatus: 'REJECTED',
      rejectedAt: now,
      rejectionReason
    }, { transaction });

    await MoveInRoomStatusHistory.create({
      moveInRoomId: room.id,
      adminId: admin.id,
      changedBy: 'ADMIN',
      previousStatus,
      newStatus: 'REJECTED',
      reason: rejectionReason,
      ipAddress: req.ip || req.connection?.remoteAddress || null,
      userAgent: req.get?.('User-Agent') || null,
      changedAt: now
    }, { transaction });

    await transaction.commit();

    // 알림 발송
    try {
      const NotificationService = require('../services/notificationService');
      await NotificationService.notifyMoveInRoomReviewResult(room, false, rejectionReason);
    } catch (notifyErr) {
      console.error('[MoveInRoom] 반려 알림 실패:', notifyErr.message);
    }

    return { ok: true, room: serializeRoomForAdmin(room) };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

module.exports = {
  listMoveInRooms,
  getMoveInRoomDetail,
  approveMoveInRoom,
  rejectMoveInRoom,
  // 테스트/디버깅용
  _serializeRoomForAdmin: serializeRoomForAdmin
};
