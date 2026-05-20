/**
 * guestMoveInRequestController.js
 * 입주 준비 서비스 — 임차인(게스트) 본인 요청 조회/상세
 *
 * Routes:
 *   GET /api/guest/move-in/requests                # 내 요청 목록
 *   GET /api/guest/move-in/requests/:caseId        # 상세 (옵션/주문/결제 통합)
 *   GET /api/guest/move-in/requests/:caseId/options # 옵션 카탈로그 + 컨텍스트
 *
 * 핵심 정책:
 *   - 본인(req.user.id)에게 bound 된 케이스만 조회 (WHERE guestUserId = req.user.id)
 *   - phone 매칭이 풀린 경우 (예: 임대인이 phone 변경) 404 처리
 *   - 청소 정보(cleaningStatus/Fee/PaidAt) 절대 노출 X — serializer 강제
 *   - 비밀번호 절대 노출 X
 */

'use strict';

const { Op } = require('sequelize');
const {
  MoveInCase,
  MoveInOption,
  MoveInGuestOrder,
  MoveInGuestOrderItem,
  MoveInGuestPayment,
  MoveInGuestRefundRequest
} = require('../models');
const {
  ErrorCodes,
  success,
  error
} = require('../utils/responseHelper');
const {
  serializeGuestCase,
  serializeOption,
  serializeGuestOrder,
  deriveGuestStatus
} = require('../utils/moveInGuestSerializer');
const { isSamePhone } = require('../utils/phoneHelper');
const {
  calculatePaymentDeadline,
  isPayable
} = require('../utils/moveInGuestPaymentGuard');
const {
  getCaseOwnedQuantities,
  MAX_QTY_PER_OPTION
} = require('../services/moveInGuestOrderService');

/**
 * 옵션 카탈로그에 케이스별 보유/잔여 수량 동봉.
 * 가드(validatePerOptionQuantity)와 동일 기준 — PAID/PARTIAL_REFUND 주문의 ACTIVE 라인만.
 */
async function decorateOptionsWithQuota(caseId, optionPlainArr) {
  const ownedMap = await getCaseOwnedQuantities(caseId);
  return optionPlainArr.map(o => {
    // serializeOption 결과는 키가 optionId (모델 id 매핑)
    const optId = o.id ?? o.optionId;
    const owned = ownedMap.get(optId) || 0;
    return {
      ...o,
      ownedQuantity: owned,
      remainingQuantity: Math.max(0, MAX_QTY_PER_OPTION - owned),
      maxPerOption: MAX_QTY_PER_OPTION
    };
  });
}
const { toKSTString } = require('../utils/dateHelper');

/**
 * 본인 케이스 + 주문 통합 조회 헬퍼.
 * - guestUserId = req.user.id 인 케이스만 반환
 */
async function findOwnCase(userId, caseId, { includeOrders = false } = {}) {
  const include = [];
  if (includeOrders) {
    include.push({
      model: MoveInGuestOrder,
      as: 'guestOrders',
      required: false,
      include: [
        {
          model: MoveInGuestOrderItem,
          as: 'items',
          include: [{ model: MoveInOption, as: 'option' }]
        },
        {
          model: MoveInGuestPayment,
          as: 'payments',
          required: false
        },
        {
          // 진행 중(PENDING) 반품요청만 — 라인 status 안 바뀌므로 진행상태 추적용.
          // separate:true 로 별도 쿼리 → where 가 메인 주문 결과를 필터링하지 않음.
          model: MoveInGuestRefundRequest,
          as: 'refundRequests',
          required: false,
          separate: true,
          where: { status: 'PENDING' }
        }
      ],
      order: [['createdAt', 'ASC']]
    });
  }

  return MoveInCase.findOne({
    where: { id: caseId, guestUserId: userId },
    include
  });
}

/**
 * GET /api/guest/move-in/requests
 * 내 요청 목록
 */
const getMyRequests = async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, page = 1, limit = 20 } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    // 본인 케이스 + 주문(상태 파생용)
    const { rows, count } = await MoveInCase.findAndCountAll({
      where: { guestUserId: userId },
      include: [{
        model: MoveInGuestOrder,
        as: 'guestOrders',
        required: false,
        attributes: ['id', 'status', 'deliveryStatus']
      }],
      order: [['checkInDate', 'DESC'], ['id', 'DESC']],
      limit: limitNum,
      offset,
      distinct: true
    });

    // 게스트 상태 파생 + 클라이언트 측 status 필터
    let items = rows.map(c => {
      const orders = (c.guestOrders || []).map(o => ({
        status: o.status,
        deliveryStatus: o.deliveryStatus
      }));
      const guestStatus = deriveGuestStatus(orders);
      return {
        // 본인 케이스만 조회되므로 includeSensitive=true (PRD 6.4)
        ...serializeGuestCase(c, { includeSensitive: true, guestOrders: orders }),
        // 결제 가능 여부 (D-5)
        canPay: isPayable(c.checkInDate),
        // 명시적 상태 재할당 (serializeGuestCase 가 이미 deriveGuestStatus 했지만 명확히)
        status: guestStatus
      };
    });

    // status 필터 (옵셔널)
    if (status) {
      const allowed = ['PENDING_PAYMENT', 'PAID', 'COMPLETED'];
      if (!allowed.includes(status)) {
        return error(res, ErrorCodes.VALIDATION_ERROR, 400, `status는 ${allowed.join('|')} 중 하나여야 합니다.`);
      }
      items = items.filter(i => i.status === status);
    }

    return success(res, {
      items,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count,
        totalPages: Math.ceil(count / limitNum)
      }
    }, '내 입주 준비 요청 목록을 조회했습니다.');
  } catch (err) {
    console.error('[guestMoveInRequest.list] error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * GET /api/guest/move-in/requests/:caseId
 * 상세 (옵션 카탈로그 + 본인 주문 + 결제)
 */
const getRequestDetail = async (req, res) => {
  try {
    const userId = req.user.id;
    const { caseId } = req.params;

    const caseRow = await findOwnCase(userId, caseId, { includeOrders: true });
    if (!caseRow) {
      return error(res, ErrorCodes.MOVE_IN_GUEST_CASE_NOT_FOUND, 404);
    }

    // 보안 강화 — 임대인이 phone 변경했는데 hook 이 안 돌아간 엣지 케이스 방어
    if (!isSamePhone(req.user.phoneNumber, caseRow.guestPhone)) {
      return error(res, ErrorCodes.MOVE_IN_GUEST_PHONE_MISMATCH, 403);
    }

    const orders = (caseRow.guestOrders || []).map(o => serializeGuestOrder(o, { caseRow }));
    const ordersForStatus = (caseRow.guestOrders || []).map(o => ({
      status: o.status,
      deliveryStatus: o.deliveryStatus
    }));

    // 활성 옵션 카탈로그 + 케이스별 보유/잔여 수량 (가드와 동일 기준)
    const activeOptions = await MoveInOption.findAll({
      where: { isActive: true },
      order: [['displayOrder', 'ASC'], ['id', 'ASC']]
    });
    const optionsWithQuota = await decorateOptionsWithQuota(
      caseRow.id,
      activeOptions.map(serializeOption)
    );

    return success(res, {
      ...serializeGuestCase(caseRow, { includeSensitive: true, guestOrders: ordersForStatus }),
      canPay: isPayable(caseRow.checkInDate),
      paymentDeadline: toKSTString(calculatePaymentDeadline(caseRow.checkInDate)),
      options: optionsWithQuota,
      orders
    }, '입주 준비 요청 상세를 조회했습니다.');
  } catch (err) {
    console.error('[guestMoveInRequest.detail] error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * GET /api/guest/move-in/requests/:caseId/options
 * 옵션 카탈로그 + 결제 컨텍스트만 (간단 응답)
 */
const getOptions = async (req, res) => {
  try {
    const userId = req.user.id;
    const { caseId } = req.params;

    const caseRow = await findOwnCase(userId, caseId);
    if (!caseRow) {
      return error(res, ErrorCodes.MOVE_IN_GUEST_CASE_NOT_FOUND, 404);
    }
    if (!isSamePhone(req.user.phoneNumber, caseRow.guestPhone)) {
      return error(res, ErrorCodes.MOVE_IN_GUEST_PHONE_MISMATCH, 403);
    }

    const activeOptions = await MoveInOption.findAll({
      where: { isActive: true },
      order: [['displayOrder', 'ASC'], ['id', 'ASC']]
    });
    const optionsWithQuota = await decorateOptionsWithQuota(
      caseRow.id,
      activeOptions.map(serializeOption)
    );

    return success(res, {
      caseId: caseRow.id,
      checkInDate: toKSTString(caseRow.checkInDate),
      checkOutDate: toKSTString(caseRow.checkOutDate),
      paymentDeadline: toKSTString(calculatePaymentDeadline(caseRow.checkInDate)),
      canPay: isPayable(caseRow.checkInDate),
      options: optionsWithQuota
    }, '옵션 카탈로그를 조회했습니다.');
  } catch (err) {
    console.error('[guestMoveInRequest.options] error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

module.exports = {
  getMyRequests,
  getRequestDetail,
  getOptions
};
