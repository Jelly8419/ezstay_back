/**
 * moveInCaseController.js
 * 입주 준비 등록 (Case) CRUD (임대인)
 *
 * - 외부 계약 1건 = MoveInCase 1건
 * - 날짜 겹침 차단 (PRD 16절)
 * - room_snapshot으로 방 정보 락인 → 방 수정해도 기존 케이스 영향 X (PRD 12.5)
 * - 자동 발송 옵션: 토큰 발급(MoveInPaymentRequest insert)만 처리,
 *   실제 알림톡 발송은 Phase 6에서 연결
 */
const { Op } = require('sequelize');
const {
  sequelize,
  MoveInRoom,
  MoveInCase,
  MoveInPaymentRequest
} = require('../models');
const { ErrorCodes, success, error, created, updated } = require('../utils/responseHelper');
const cryptoHelper = require('../utils/cryptoHelper');
const moveInCaseService = require('../services/moveInCaseService');
const { normalizePhone } = require('../utils/phoneHelper');
const { findGuestUserIdByPhone } = require('../services/moveInGuestBindService');
const {
  _dispatchPaymentRequestNotification: dispatchPaymentRequestNotification
} = require('./moveInPaymentRequestController');

/**
 * 입력값 검증
 */
function validateCasePayload(body, { partial = false } = {}) {
  const errors = [];

  if (!partial || body.moveInRoomId !== undefined) {
    if (!Number.isInteger(body.moveInRoomId) || body.moveInRoomId <= 0) {
      errors.push('moveInRoomId는 양의 정수여야 합니다.');
    }
  }
  if (!partial || body.checkInDate !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.checkInDate || '')) {
      errors.push('checkInDate는 YYYY-MM-DD 형식이어야 합니다.');
    }
  }
  if (!partial || body.checkOutDate !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.checkOutDate || '')) {
      errors.push('checkOutDate는 YYYY-MM-DD 형식이어야 합니다.');
    }
  }
  if (body.checkInDate && body.checkOutDate && body.checkInDate >= body.checkOutDate) {
    errors.push('checkOutDate는 checkInDate보다 이후여야 합니다.');
  }

  if (!partial || body.guestName !== undefined) {
    if (!body.guestName || typeof body.guestName !== 'string') {
      errors.push('guestName은 필수 문자열입니다.');
    }
  }
  if (!partial || body.guestPhone !== undefined) {
    if (!body.guestPhone || !/^[0-9-+ ]{8,20}$/.test(body.guestPhone)) {
      errors.push('guestPhone은 유효한 휴대폰 번호여야 합니다.');
    }
  }

  return errors;
}

/**
 * Case 인스턴스 → API 응답 객체 (room_snapshot의 비밀번호 복호화)
 */
function serializeCase(caseRow) {
  if (!caseRow) return null;
  const snapshot = caseRow.roomSnapshot ? { ...caseRow.roomSnapshot } : null;
  if (snapshot) {
    snapshot.commonEntrancePassword = cryptoHelper.decrypt(snapshot.commonEntrancePassword);
    snapshot.doorLockPassword = cryptoHelper.decrypt(snapshot.doorLockPassword);
  }

  return {
    id: caseRow.id,
    moveInRoomId: caseRow.moveInRoomId,
    checkInDate: caseRow.checkInDate,
    checkOutDate: caseRow.checkOutDate,
    guestName: caseRow.guestName,
    guestPhone: caseRow.guestPhone,
    guestUserId: caseRow.guestUserId,
    requestMemo: caseRow.requestMemo,
    cleaningStatus: caseRow.cleaningStatus,
    cleaningFee: caseRow.cleaningFee,
    cleaningPaidAt: caseRow.cleaningPaidAt,
    roomSnapshot: snapshot,
    paymentRequest: caseRow.paymentRequest
      ? {
          status: caseRow.paymentRequest.status,
          sentAt: caseRow.paymentRequest.sentAt,
          lastResentAt: caseRow.paymentRequest.lastResentAt,
          resendCount: caseRow.paymentRequest.resendCount,
          expiresAt: caseRow.paymentRequest.expiresAt
        }
      : null,
    createdAt: caseRow.createdAt,
    updatedAt: caseRow.updatedAt
  };
}

/**
 * GET /api/host/move-in/cases
 * 케이스 목록 (필터: cleaning_status, request_status, search, page, limit)
 */
const getCases = async (req, res) => {
  try {
    const hostId = req.user.id;
    const {
      cleaningStatus,
      requestStatus,
      search,
      page = 1,
      limit = 20
    } = req.query;

    const where = { hostId };
    if (cleaningStatus) {
      where.cleaningStatus = cleaningStatus;
    }
    if (search) {
      where[Op.or] = [
        { guestName: { [Op.like]: `%${search}%` } },
        { guestPhone: { [Op.like]: `%${search}%` } }
      ];
    }

    const include = [
      {
        model: MoveInPaymentRequest,
        as: 'paymentRequest',
        required: false,
        ...(requestStatus ? { where: { status: requestStatus } } : {})
      }
    ];

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const { count, rows } = await MoveInCase.findAndCountAll({
      where,
      include,
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset,
      distinct: true,
      // requestStatus 필터 시 include의 required:true 처리
      ...(requestStatus ? { subQuery: false } : {})
    });

    // requestStatus 필터링: paymentRequest가 없는 케이스 제외 처리 (애플리케이션 레벨 보정)
    const filtered = requestStatus
      ? rows.filter(r => r.paymentRequest && r.paymentRequest.status === requestStatus)
      : rows;

    return success(res, {
      total: requestStatus ? filtered.length : count,
      page: parseInt(page),
      limit: parseInt(limit),
      items: filtered.map(serializeCase)
    });
  } catch (err) {
    console.error('MoveInCase 목록 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * POST /api/host/move-in/cases
 * 케이스 등록
 *
 * Body:
 *   moveInRoomId, checkInDate, checkOutDate, guestName, guestPhone,
 *   requestMemo (선택), sendGuestPaymentRequest (선택, default true)
 */
const createCase = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const hostId = req.user.id;
    const validationErrors = validateCasePayload(req.body);
    if (validationErrors.length > 0) {
      await transaction.rollback();
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, validationErrors);
    }

    const { moveInRoomId, checkInDate, checkOutDate, guestName, requestMemo } = req.body;
    // guestPhone 은 저장 시점에 정규화 (Phase 4 정책: B+C 혼합 — 저장도 정규화, 매칭도 정규화)
    const guestPhone = normalizePhone(req.body.guestPhone);
    const sendGuestPaymentRequest = req.body.sendGuestPaymentRequest !== false; // 기본 true

    // 1. 본인 방 확인
    const room = await MoveInRoom.findOne({
      where: { id: moveInRoomId, hostId },
      transaction
    });
    if (!room) {
      await transaction.rollback();
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    // 2. 날짜 겹침 차단 (PRD 16절)
    const overlap = await moveInCaseService.findOverlappingCase(
      { moveInRoomId, checkInDate, checkOutDate },
      transaction
    );
    if (overlap) {
      await transaction.rollback();
      return error(
        res,
        ErrorCodes.CONFLICT_WITH_CONTRACT,
        409,
        `해당 기간에 이미 등록된 입주 준비가 있습니다. (case #${overlap.id})`
      );
    }

    // 3. 케이스 생성 시점에 임차인이 이미 EZstay 가입돼 있으면 즉시 bind
    const { userId: preBoundGuestUserId } = await findGuestUserIdByPhone(guestPhone, transaction);

    const caseRow = await MoveInCase.create({
      hostId,
      moveInRoomId,
      checkInDate,
      checkOutDate,
      guestName,
      guestPhone,
      guestUserId: preBoundGuestUserId,
      requestMemo: requestMemo ?? null,
      cleaningStatus: 'NOT_REQUESTED',
      roomSnapshot: moveInCaseService.buildRoomSnapshot(room)
    }, { transaction });

    // 4. 결제 요청 토큰 발급 (자동/수동 무관하게 항상 발급)
    const paymentRequest = await MoveInPaymentRequest.create({
      caseId: caseRow.id,
      token: moveInCaseService.generateRequestToken(),
      status: 'NOT_SENT',
      expiresAt: moveInCaseService.calculateTokenExpiresAt(checkOutDate)
    }, { transaction });

    // 5. 자동 발송 처리 (sendGuestPaymentRequest=true인 경우)
    let autoSendResult = null;
    if (sendGuestPaymentRequest) {
      try {
        const dispatched = await dispatchPaymentRequestNotification({
          caseRow,
          token: paymentRequest.token
        });
        await paymentRequest.update({
          status: 'SENT',
          sentAt: new Date()
        }, { transaction });
        autoSendResult = { sent: true, mock: dispatched.mock };
      } catch (notifyErr) {
        // 알림톡 실패가 케이스 생성을 막지는 않음 (PRD 9.2: 상세에서 재발송 가능)
        console.error('자동 알림톡 발송 실패 (케이스 생성은 성공):', notifyErr);
        autoSendResult = { sent: false, error: notifyErr.message };
      }
    }

    await transaction.commit();

    // include 다시 조회
    const fullCase = await MoveInCase.findByPk(caseRow.id, {
      include: [{ model: MoveInPaymentRequest, as: 'paymentRequest' }]
    });

    return created(res, {
      ...serializeCase(fullCase),
      autoSend: autoSendResult
    }, '입주 준비 등록이 생성되었습니다.');
  } catch (err) {
    await transaction.rollback();
    console.error('MoveInCase 생성 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * GET /api/host/move-in/cases/:caseId
 */
const getCase = async (req, res) => {
  try {
    const hostId = req.user.id;
    const { caseId } = req.params;

    const caseRow = await MoveInCase.findOne({
      where: { id: caseId, hostId },
      include: [
        { model: MoveInPaymentRequest, as: 'paymentRequest' }
      ]
    });

    if (!caseRow) {
      return error(res, ErrorCodes.NOT_FOUND, 404, '케이스를 찾을 수 없습니다.');
    }

    return success(res, serializeCase(caseRow));
  } catch (err) {
    console.error('MoveInCase 상세 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * PATCH /api/host/move-in/cases/:caseId
 *
 * 수정 가능: checkInDate, checkOutDate, guestName, guestPhone, requestMemo
 * - 날짜 변경 시 겹침 재검증
 * - 휴대폰 번호 변경 시 토큰 재발급 (PRD 9.2 추천)
 */
const updateCase = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const hostId = req.user.id;
    const { caseId } = req.params;

    const caseRow = await MoveInCase.findOne({
      where: { id: caseId, hostId },
      include: [{ model: MoveInPaymentRequest, as: 'paymentRequest' }],
      transaction
    });
    if (!caseRow) {
      await transaction.rollback();
      return error(res, ErrorCodes.NOT_FOUND, 404, '케이스를 찾을 수 없습니다.');
    }

    const validationErrors = validateCasePayload(req.body, { partial: true });
    if (validationErrors.length > 0) {
      await transaction.rollback();
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, validationErrors);
    }

    const updateData = {};
    ['checkInDate', 'checkOutDate', 'guestName', 'guestPhone', 'requestMemo'].forEach(f => {
      if (req.body[f] !== undefined) updateData[f] = req.body[f];
    });
    // guestPhone 변경 시 정규화 (Phase 4)
    if (updateData.guestPhone !== undefined) {
      updateData.guestPhone = normalizePhone(updateData.guestPhone);
    }

    // 날짜 변경 시 겹침 재검증
    const newCheckIn = updateData.checkInDate ?? caseRow.checkInDate;
    const newCheckOut = updateData.checkOutDate ?? caseRow.checkOutDate;
    if (newCheckIn >= newCheckOut) {
      await transaction.rollback();
      return error(res, ErrorCodes.INVALID_DATE_RANGE, 400);
    }
    if (updateData.checkInDate || updateData.checkOutDate) {
      const overlap = await moveInCaseService.findOverlappingCase(
        {
          moveInRoomId: caseRow.moveInRoomId,
          checkInDate: newCheckIn,
          checkOutDate: newCheckOut,
          excludeCaseId: caseRow.id
        },
        transaction
      );
      if (overlap) {
        await transaction.rollback();
        return error(
          res,
          ErrorCodes.CONFLICT_WITH_CONTRACT,
          409,
          `해당 기간에 이미 등록된 입주 준비가 있습니다. (case #${overlap.id})`
        );
      }
    }

    // 휴대폰 번호 변경 여부는 update 전에 판정 (update 후엔 caseRow.guestPhone이 이미 새 값)
    const phoneChanged = updateData.guestPhone && updateData.guestPhone !== caseRow.guestPhone;

    // 휴대폰 번호 변경 시 guest_user_id 재매칭 시도 (Phase 4)
    if (phoneChanged) {
      const { userId: rebound } = await findGuestUserIdByPhone(updateData.guestPhone, transaction);
      updateData.guestUserId = rebound; // null 이면 매칭 해제
    }

    await caseRow.update(updateData, { transaction });

    // 휴대폰 번호 변경 시 토큰 재발급 (PRD 9.2)
    if (phoneChanged && caseRow.paymentRequest) {
      await caseRow.paymentRequest.update({
        token: moveInCaseService.generateRequestToken(),
        status: 'NOT_SENT',
        sentAt: null,
        lastResentAt: null,
        resendCount: 0,
        expiresAt: moveInCaseService.calculateTokenExpiresAt(newCheckOut)
      }, { transaction });
    } else if (updateData.checkOutDate && caseRow.paymentRequest) {
      // 퇴실일만 바뀌면 만료시각만 갱신
      await caseRow.paymentRequest.update({
        expiresAt: moveInCaseService.calculateTokenExpiresAt(newCheckOut)
      }, { transaction });
    }

    await transaction.commit();

    const fullCase = await MoveInCase.findByPk(caseRow.id, {
      include: [{ model: MoveInPaymentRequest, as: 'paymentRequest' }]
    });

    return updated(res, serializeCase(fullCase), '입주 준비 등록이 수정되었습니다.');
  } catch (err) {
    await transaction.rollback();
    console.error('MoveInCase 수정 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

module.exports = {
  getCases,
  createCase,
  getCase,
  updateCase
};
