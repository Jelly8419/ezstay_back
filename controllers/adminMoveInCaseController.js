/**
 * adminMoveInCaseController.js
 * 관리자 — 입주 준비 서비스 케이스 단위 조회/수정
 *
 * Routes (routes/adminMoveInCaseRoutes.js):
 *   GET    /api/admin/move-in/cases
 *   GET    /api/admin/move-in/cases/:caseId
 *   PATCH  /api/admin/move-in/cases/:caseId
 *   POST   /api/admin/move-in/cases/:caseId/payment-request/resend
 *
 * 정책:
 *   - 관리자 권한 필수 (authenticateAdmin)
 *   - 화면은 케이스 1건 = 1행 (노션 "입주 준비 서비스 Admin")
 *   - 카테고리 그룹: 침구류(BEDDING_SET) / 입주용품(나머지) — utils/moveInGuestCategoryHelper
 *   - 청소 정보는 관리자 화면에서 노출 OK (게스트 도메인 마스킹 정책과 달리 admin 은 풀 정보 제공)
 *   - 비밀번호 평문 복호화는 단건 상세에서만 (목록 X)
 */

'use strict';

const { Op } = require('sequelize');
const {
  sequelize,
  MoveInCase,
  MoveInRoom,
  MoveInPaymentRequest,
  MoveInPayment,
  MoveInGuestOrder,
  MoveInGuestOrderItem,
  MoveInGuestPayment,
  MoveInGuestRefundRequest,
  MoveInOption,
  User,
  Admin
} = require('../models');
const {
  ErrorCodes,
  success,
  error,
  updated
} = require('../utils/responseHelper');
const { toKSTString } = require('../utils/dateHelper');
const cryptoHelper = require('../utils/cryptoHelper');
const { computeGroupStatuses } = require('../utils/moveInGuestCategoryHelper');
const { calculateCleaningPaymentDeadline } = require('../utils/moveInCleaningPaymentGuard');
const { calculatePaymentDeadline: calculateOptionPaymentDeadline } = require('../utils/moveInGuestPaymentGuard');
const moveInCaseService = require('../services/moveInCaseService');
const {
  _dispatchPaymentRequestNotification: dispatchPaymentRequestNotification
} = require('./moveInPaymentRequestController');

// 카테고리 그룹 상태 → 한글 라벨
const GROUP_STATUS_LABELS = {
  PAID:    '결제 완료',
  PENDING: '결제 대기'
};

// 청소 상태 → 한글 라벨
const CLEANING_STATUS_LABELS = {
  NOT_REQUESTED:   '미신청',
  PAYMENT_PENDING: '결제 대기',
  PAID:            '결제 완료',
  CANCELLED:       '취소됨'
};

const PAYMENT_REQUEST_STATUS_LABELS = {
  NOT_SENT: '미발송',
  SENT:     '발송 완료'
};

/**
 * 결제 링크 URL 조립.
 * 호스트 도메인 controllers/moveInPaymentRequestController.js 와 동일 규칙:
 *   ${GUEST_MOVE_IN_PAYMENT_URL || 'https://ezstay.kr/move-in/payment'}/{token}
 */
const GUEST_PAYMENT_PAGE_URL = process.env.GUEST_MOVE_IN_PAYMENT_URL
  || 'https://ezstay.kr/move-in/payment';

function buildPaymentLink(token) {
  if (!token) return null;
  return `${GUEST_PAYMENT_PAGE_URL}/${token}`;
}

/**
 * checkInDate 가 비정상이면 deadline 계산이 throw — 응답 직렬화를 깨지 않게 null 폴백.
 */
function safeDeadline(checkInDate, calcFn) {
  if (!checkInDate) return null;
  try {
    return toKSTString(calcFn(checkInDate));
  } catch {
    return null;
  }
}

/**
 * 메인 리스트 한 행 직렬화.
 * - 청소/입주용품/침구류 상태만 노출 (결제 상세 X)
 * - paymentRequest 발송 요약 포함
 */
function serializeCaseListItem(c) {
  const room = c.room || null;
  const host = room?.host || c.host || null;
  const guestUser = c.guest || null;
  const orders = c.guestOrders || [];

  const groupStatuses = computeGroupStatuses(orders);

  return {
    id: c.id,
    address: room?.address || null,
    detailAddress: room?.detailAddress || null,
    host: host ? {
      id: host.id,
      name: host.name,
      phoneNumber: host.phoneNumber,
      email: host.email
    } : null,
    guest: {
      // case 상에 입력된 임차인 정보 (가입 안 됐을 수도 있음)
      name: c.guestName,
      phoneNumber: c.guestPhone,
      // 가입/매칭된 경우에만 이메일 노출
      email: guestUser?.email || null,
      userId: guestUser?.id || null
    },
    checkInDate: c.checkInDate,
    checkOutDate: c.checkOutDate,
    cleaning: {
      status: c.cleaningStatus,
      statusLabel: CLEANING_STATUS_LABELS[c.cleaningStatus] || c.cleaningStatus
    },
    amenity: {
      // null = 공란 (게스트 미구매)
      status: groupStatuses.amenity,
      statusLabel: groupStatuses.amenity ? GROUP_STATUS_LABELS[groupStatuses.amenity] : null
    },
    bedding: {
      status: groupStatuses.bedding,
      statusLabel: groupStatuses.bedding ? GROUP_STATUS_LABELS[groupStatuses.bedding] : null
    },
    paymentRequest: c.paymentRequest ? {
      status: c.paymentRequest.status,
      statusLabel: PAYMENT_REQUEST_STATUS_LABELS[c.paymentRequest.status] || c.paymentRequest.status,
      sentAt: toKSTString(c.paymentRequest.sentAt),
      lastResentAt: toKSTString(c.paymentRequest.lastResentAt),
      resendCount: c.paymentRequest.resendCount
    } : null,
    createdAt: toKSTString(c.createdAt),
    updatedAt: toKSTString(c.updatedAt)
  };
}

/**
 * 상세 응답 직렬화.
 * - 방 정보(roomSnapshot 우선 + 현재 MoveInRoom 보조)
 * - 청소 결제(MoveInPayment 최신 PAID 1건)
 * - 게스트 주문 카테고리 그룹별 분리 (amenityOrders / beddingOrders)
 * - 알림톡 발송 이력은 paymentRequest 의 sentAt/lastResentAt/resendCount 만 (AlimtalkLog 는 caseId 인덱스 없음)
 * - lastModifiedBy 풀 데이터
 *
 * @param {MoveInCase} c - room/host/guest/paymentRequest/payments/guestOrders(+items+option+payments)/lastModifiedByAdmin include
 */
function serializeCaseDetail(c) {
  const snapshot = c.roomSnapshot || {};
  const room = c.room || null;
  const host = room?.host || c.host || null;
  const guestUser = c.guest || null;
  const orders = c.guestOrders || [];

  // 청소 결제: 가장 최근 PAID 결제 1건 우선, 없으면 최근 시도 1건
  const cleaningPayments = (c.payments || []).slice().sort((a, b) => {
    const ad = a.paidAt || a.createdAt;
    const bd = b.paidAt || b.createdAt;
    return new Date(bd) - new Date(ad);
  });
  const cleaningPaid = cleaningPayments.find(p => p.status === 'PAID');
  const cleaningLatest = cleaningPaid || cleaningPayments[0] || null;

  const amenitySet = new Set(MoveInOption.AMENITY_CATEGORIES);
  const beddingSet = new Set(MoveInOption.BEDDING_CATEGORIES);

  const serializeOrderItem = (it) => {
    const opt = it.option || null;
    return {
      id: it.id,
      optionId: it.optionId,
      optionName: opt?.name || null,
      category: opt?.category || null,
      categoryLabel: opt ? (MoveInOption.CATEGORY_LABELS[opt.category] || opt.category) : null,
      quantity: it.quantity,
      pricePerItem: it.pricePerItem,
      totalPrice: it.totalPrice,
      status: it.status,
      cancelledAt: toKSTString(it.cancelledAt),
      cancelReason: it.cancelReason,
      refundAmount: it.refundAmount
    };
  };

  const serializeOrder = (o) => ({
    id: o.id,
    orderId: o.orderId,
    orderType: o.orderType,
    status: o.status,
    statusLabel: MoveInGuestOrder.STATUS_LABELS?.[o.status] || o.status,
    totalAmount: o.totalAmount,
    paidAmount: o.paidAmount,
    refundedAmount: o.refundedAmount,
    paymentMethod: o.paymentMethod,
    paidAt: toKSTString(o.paidAt),
    modifiableUntil: toKSTString(o.modifiableUntil),
    deliveryStatus: o.deliveryStatus,
    deliveryStatusLabel: MoveInGuestOrder.DELIVERY_STATUS_LABELS?.[o.deliveryStatus] || o.deliveryStatus,
    deliveredAt: toKSTString(o.deliveredAt),
    items: (o.items || []).map(serializeOrderItem),
    payments: (o.payments || []).map(p => ({
      id: p.id,
      amount: p.amount,
      status: p.status,
      pgProvider: p.pgProvider,
      pgMethod: p.pgMethod,
      pgTid: p.pgTid,
      paidAt: toKSTString(p.paidAt)
    })),
    createdAt: toKSTString(o.createdAt)
  });

  // 그룹별 주문 분리: 한 주문이 두 그룹 라인을 모두 포함할 수 있어 OR-membership 으로 양쪽 모두 노출.
  const orderInGroup = (o, groupSet) =>
    (o.items || []).some(it => {
      const cat = it.option?.category;
      return cat && groupSet.has(cat);
    });

  const amenityOrders = orders.filter(o => orderInGroup(o, amenitySet)).map(serializeOrder);
  const beddingOrders = orders.filter(o => orderInGroup(o, beddingSet)).map(serializeOrder);
  const groupStatuses = computeGroupStatuses(orders);

  // 비밀번호 평문 복호화 (관리자 단건만 노출)
  const decrypt = (cipher) => {
    if (!cipher) return null;
    try { return cryptoHelper.decrypt(cipher); }
    catch { return null; }
  };

  const lastModifiedByAdmin = c.lastModifiedByAdmin || null;

  return {
    id: c.id,
    // 방 정보 — snapshot 우선, 누락 시 현재 room 보조
    room: {
      id: room?.id || null,
      address: snapshot.address || room?.address || null,
      detailAddress: snapshot.detailAddress || room?.detailAddress || null,
      roomName: snapshot.roomName || room?.roomName || null,
      areaPyeong: snapshot.areaPyeong ?? (room ? Number(room.areaPyeong) : null),
      livingRoomCount: snapshot.livingRoomCount ?? room?.livingRoomCount ?? null,
      roomCount: snapshot.roomCount ?? room?.roomCount ?? null,
      bathroomCount: snapshot.bathroomCount ?? room?.bathroomCount ?? null,
      bedCount: snapshot.bedCount ?? room?.bedCount ?? null,
      beds: snapshot.beds ?? room?.beds ?? null,
      cleaningSuppliesAvailable: snapshot.cleaningSuppliesAvailable ?? room?.cleaningSuppliesAvailable ?? null,
      cleaningSuppliesLocation: snapshot.cleaningSuppliesLocation || room?.cleaningSuppliesLocation || null,
      commonEntrancePassword: decrypt(snapshot.commonEntrancePassword || room?.commonEntrancePassword),
      doorLockPassword:       decrypt(snapshot.doorLockPassword       || room?.doorLockPassword)
    },
    host: host ? {
      id: host.id,
      name: host.name,
      phoneNumber: host.phoneNumber,
      email: host.email
    } : null,
    guest: {
      name: c.guestName,
      phoneNumber: c.guestPhone,
      email: guestUser?.email || null,
      userId: guestUser?.id || null
    },
    period: {
      checkInDate: c.checkInDate,
      checkOutDate: c.checkOutDate
    },
    requestMemo: c.requestMemo,
    adminMemo: c.adminMemo,
    lastModified: {
      at: toKSTString(c.lastModifiedAt),
      admin: lastModifiedByAdmin ? {
        id: lastModifiedByAdmin.id,
        name: lastModifiedByAdmin.name
      } : null
    },
    cleaning: {
      status: c.cleaningStatus,
      statusLabel: CLEANING_STATUS_LABELS[c.cleaningStatus] || c.cleaningStatus,
      fee: c.cleaningFee,
      paidAt: toKSTString(c.cleaningPaidAt),
      desiredDate: c.cleaningDate,
      desiredTime: c.cleaningTime,
      paymentDeadline: safeDeadline(c.checkInDate, calculateCleaningPaymentDeadline),
      payment: cleaningLatest ? {
        id: cleaningLatest.id,
        orderId: cleaningLatest.orderId,
        amount: cleaningLatest.amount,
        status: cleaningLatest.status,
        pgProvider: cleaningLatest.pgProvider,
        pgMethod: cleaningLatest.pgMethod,
        pgTid: cleaningLatest.pgTid,
        paidAt: toKSTString(cleaningLatest.paidAt),
        failedAt: toKSTString(cleaningLatest.failedAt),
        failureReason: cleaningLatest.failureReason
      } : null
    },
    amenity: {
      status: groupStatuses.amenity,
      statusLabel: groupStatuses.amenity ? GROUP_STATUS_LABELS[groupStatuses.amenity] : null,
      paymentDeadline: safeDeadline(c.checkInDate, calculateOptionPaymentDeadline),
      orders: amenityOrders
    },
    bedding: {
      status: groupStatuses.bedding,
      statusLabel: groupStatuses.bedding ? GROUP_STATUS_LABELS[groupStatuses.bedding] : null,
      paymentDeadline: safeDeadline(c.checkInDate, calculateOptionPaymentDeadline),
      orders: beddingOrders
    },
    paymentRequest: c.paymentRequest ? {
      status: c.paymentRequest.status,
      statusLabel: PAYMENT_REQUEST_STATUS_LABELS[c.paymentRequest.status] || c.paymentRequest.status,
      link: buildPaymentLink(c.paymentRequest.token),
      sentAt: toKSTString(c.paymentRequest.sentAt),
      lastResentAt: toKSTString(c.paymentRequest.lastResentAt),
      resendCount: c.paymentRequest.resendCount,
      expiresAt: toKSTString(c.paymentRequest.expiresAt)
    } : null,
    // 임차인 반품 요청 (관리자 승인/거절 대상). 최신순.
    refundRequests: (c.guestRefundRequests || [])
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(r => ({
        id: r.id,
        guestOrderId: r.guestOrderId,
        status: r.status,
        statusLabel: MoveInGuestRefundRequest.STATUS_LABELS?.[r.status] || r.status,
        returnReason: r.returnReason,
        rejectReason: r.rejectReason,
        deliveryStatusSnapshot: r.deliveryStatusSnapshot,
        itemTotalAmount: r.itemTotalAmount,
        shippingDeduction: r.shippingDeduction,
        finalRefundAmount: r.finalRefundAmount,
        requesterName: r.requester?.name || null,
        adminName: r.processedByAdmin?.name || null,
        targetItems: r.targetItems || null,
        processedAt: toKSTString(r.processedAt),
        createdAt: toKSTString(r.createdAt)
      })),
    createdAt: toKSTString(c.createdAt),
    updatedAt: toKSTString(c.updatedAt)
  };
}

/**
 * GET /api/admin/move-in/cases
 *
 * Query:
 *   - cleaningStatus: NOT_REQUESTED|PAYMENT_PENDING|PAID|CANCELLED
 *   - checkInFrom / checkInTo (YYYY-MM-DD)
 *   - checkOutFrom / checkOutTo (YYYY-MM-DD)
 *   - search: 주소/임차인 이름/임차인 전화 LIKE
 *   - page, limit (기본 1/20, 최대 100)
 */
const listCases = async (req, res) => {
  try {
    const {
      cleaningStatus,
      checkInFrom, checkInTo,
      checkOutFrom, checkOutTo,
      search,
      page = 1,
      limit = 20
    } = req.query;

    const where = {};
    const roomWhere = {};

    if (cleaningStatus) {
      const valid = ['NOT_REQUESTED', 'PAYMENT_PENDING', 'PAID', 'CANCELLED'];
      if (!valid.includes(cleaningStatus)) {
        return error(res, ErrorCodes.VALIDATION_ERROR, 400, `cleaningStatus는 ${valid.join('|')} 중 하나여야 합니다.`);
      }
      where.cleaningStatus = cleaningStatus;
    }

    if (checkInFrom || checkInTo) {
      where.checkInDate = {};
      if (checkInFrom) where.checkInDate[Op.gte] = checkInFrom;
      if (checkInTo)   where.checkInDate[Op.lte] = checkInTo;
    }
    if (checkOutFrom || checkOutTo) {
      where.checkOutDate = {};
      if (checkOutFrom) where.checkOutDate[Op.gte] = checkOutFrom;
      if (checkOutTo)   where.checkOutDate[Op.lte] = checkOutTo;
    }

    if (search) {
      const kw = `%${String(search).trim()}%`;
      where[Op.or] = [
        { guestName:  { [Op.like]: kw } },
        { guestPhone: { [Op.like]: kw } },
        { '$room.address$':        { [Op.like]: kw } },
        { '$room.detail_address$': { [Op.like]: kw } }
      ];
    }

    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset   = (pageNum - 1) * limitNum;

    const include = [
      {
        model: MoveInRoom,
        as: 'room',
        required: false,
        where: Object.keys(roomWhere).length ? roomWhere : undefined,
        include: [{ model: User, as: 'host', attributes: ['id', 'name', 'phoneNumber', 'email'] }]
      },
      { model: User, as: 'guest', attributes: ['id', 'name', 'email'] },
      { model: MoveInPaymentRequest, as: 'paymentRequest' },
      {
        model: MoveInGuestOrder,
        as: 'guestOrders',
        required: false,
        include: [
          {
            model: MoveInGuestOrderItem,
            as: 'items',
            include: [{ model: MoveInOption, as: 'option', attributes: ['id', 'name', 'category'] }]
          }
        ]
      }
    ];

    const { rows, count } = await MoveInCase.findAndCountAll({
      where,
      include,
      order: [['createdAt', 'DESC']],
      limit: limitNum,
      offset,
      distinct: true,
      subQuery: false
    });

    return success(res, {
      items: rows.map(serializeCaseListItem),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count,
        totalPages: Math.ceil(count / limitNum)
      }
    }, '입주 준비 케이스 목록을 조회했습니다.');
  } catch (err) {
    console.error('[adminMoveInCase.list] error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 단건 상세용 케이스 로딩 헬퍼.
 * 직렬화에 필요한 모든 association 을 한 번에 include.
 */
async function loadCaseDetail(caseId, transaction = null) {
  const opts = transaction ? { transaction } : {};
  return MoveInCase.findByPk(caseId, {
    include: [
      {
        model: MoveInRoom,
        as: 'room',
        include: [{ model: User, as: 'host', attributes: ['id', 'name', 'phoneNumber', 'email'] }]
      },
      { model: User, as: 'guest', attributes: ['id', 'name', 'email'] },
      { model: Admin, as: 'lastModifiedByAdmin', attributes: ['id', 'name'] },
      { model: MoveInPaymentRequest, as: 'paymentRequest' },
      { model: MoveInPayment, as: 'payments' },
      {
        model: MoveInGuestOrder,
        as: 'guestOrders',
        include: [
          {
            model: MoveInGuestOrderItem,
            as: 'items',
            include: [{ model: MoveInOption, as: 'option', attributes: ['id', 'name', 'category'] }]
          },
          { model: MoveInGuestPayment, as: 'payments' }
        ]
      },
      {
        model: MoveInGuestRefundRequest,
        as: 'guestRefundRequests',
        required: false,
        include: [
          { model: User, as: 'requester', attributes: ['id', 'name'] },
          { model: Admin, as: 'processedByAdmin', attributes: ['id', 'name'] }
        ]
      }
    ],
    order: [
      [{ model: MoveInGuestOrder, as: 'guestOrders' }, 'createdAt', 'DESC']
    ],
    ...opts
  });
}

/**
 * GET /api/admin/move-in/cases/:caseId
 * 케이스 단건 상세 (방·임대인·임차인·기간·청소·옵션 그룹별·요청링크·관리자메모·최종수정자)
 */
const getCase = async (req, res) => {
  try {
    const caseId = parseInt(req.params.caseId, 10);
    if (!Number.isInteger(caseId) || caseId <= 0) {
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, 'caseId는 정수여야 합니다.');
    }

    const c = await loadCaseDetail(caseId);
    if (!c) {
      return error(res, ErrorCodes.MOVE_IN_CASE_NOT_FOUND, 404);
    }

    return success(res, serializeCaseDetail(c), '입주 준비 케이스 상세를 조회했습니다.');
  } catch (err) {
    console.error('[adminMoveInCase.get] error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * PATCH /api/admin/move-in/cases/:caseId
 * Body: { adminMemo: string | null }
 *
 * - adminMemo 필드만 수정 가능 (현 단계). 향후 다른 필드 확장 시 화이트리스트 확장.
 * - 호출 즉시 lastModifiedByAdminId / lastModifiedAt 자동 갱신.
 * - 응답은 단건 상세와 동일 (재조회).
 */
const updateCase = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const adminId = req.admin?.id ?? null;
    const caseId = parseInt(req.params.caseId, 10);
    if (!Number.isInteger(caseId) || caseId <= 0) {
      await transaction.rollback();
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, 'caseId는 정수여야 합니다.');
    }

    const c = await MoveInCase.findByPk(caseId, { transaction });
    if (!c) {
      await transaction.rollback();
      return error(res, ErrorCodes.MOVE_IN_CASE_NOT_FOUND, 404);
    }

    const body = req.body || {};
    const updates = {};

    if (Object.prototype.hasOwnProperty.call(body, 'adminMemo')) {
      const v = body.adminMemo;
      if (v !== null && typeof v !== 'string') {
        await transaction.rollback();
        return error(res, ErrorCodes.VALIDATION_ERROR, 400, 'adminMemo는 문자열 또는 null이어야 합니다.');
      }
      updates.adminMemo = v;
    }

    if (Object.keys(updates).length === 0) {
      await transaction.rollback();
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, '수정할 필드가 없습니다.');
    }

    updates.lastModifiedByAdminId = adminId;
    updates.lastModifiedAt = new Date();

    await c.update(updates, { transaction });
    await transaction.commit();

    const refreshed = await loadCaseDetail(caseId);
    return updated(res, serializeCaseDetail(refreshed), '입주 준비 케이스가 수정되었습니다.');
  } catch (err) {
    if (!transaction.finished) await transaction.rollback();
    console.error('[adminMoveInCase.update] error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * POST /api/admin/move-in/cases/:caseId/payment-request/resend
 *
 * - 호스트 동일 동작: paymentRequest 없으면 발급, 있으면 그대로 사용
 * - 알림톡 발송 후 resendCount++, lastResentAt 갱신, status='SENT'
 * - 호스트 컨트롤러의 dispatchPaymentRequestNotification 재사용
 */
const resendPaymentRequest = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const caseId = parseInt(req.params.caseId, 10);
    if (!Number.isInteger(caseId) || caseId <= 0) {
      await transaction.rollback();
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, 'caseId는 정수여야 합니다.');
    }

    const caseRow = await MoveInCase.findByPk(caseId, {
      include: [{ model: MoveInPaymentRequest, as: 'paymentRequest' }],
      transaction
    });
    if (!caseRow) {
      await transaction.rollback();
      return error(res, ErrorCodes.MOVE_IN_CASE_NOT_FOUND, 404);
    }

    let request = caseRow.paymentRequest;
    if (!request) {
      request = await MoveInPaymentRequest.create({
        caseId: caseRow.id,
        token: moveInCaseService.generateRequestToken(),
        status: 'NOT_SENT',
        expiresAt: moveInCaseService.calculateTokenExpiresAt(caseRow.checkOutDate)
      }, { transaction });
    }

    let dispatched;
    try {
      // 관리자 발송은 운영 대응 성격 → 임대인용 일별 10회 한도에 합산하지 않음
      // (countTowardDailyLimit 기본값 false)
      dispatched = await dispatchPaymentRequestNotification({ caseRow, token: request.token });
    } catch (notifyErr) {
      await transaction.rollback();
      console.error('[adminMoveInCase.resend] 알림톡 발송 실패:', notifyErr);
      return error(res, ErrorCodes.INTERNAL_ERROR, 500, '알림톡 재발송에 실패했습니다.');
    }

    const now = new Date();
    await request.update({
      status: 'SENT',
      sentAt: request.sentAt ?? now,
      lastResentAt: now,
      resendCount: request.resendCount + 1
    }, { transaction });

    await transaction.commit();

    return success(res, {
      caseId: caseRow.id,
      status: request.status,
      sentAt: toKSTString(request.sentAt),
      lastResentAt: toKSTString(now),
      resendCount: request.resendCount,
      paymentLink: buildPaymentLink(request.token),
      _note: dispatched?.mock
        ? '⚠️ 알림톡 발송이 스킵되었습니다 (템플릿 미동기화·전화번호 누락·발송 실패 중 하나). 카운트만 증가했습니다.'
        : undefined
    }, '결제 요청이 재발송되었습니다.');
  } catch (err) {
    if (!transaction.finished) await transaction.rollback();
    console.error('[adminMoveInCase.resend] error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

module.exports = {
  listCases,
  getCase,
  updateCase,
  resendPaymentRequest,

  // 내부 노출 (테스트용)
  _internal: {
    serializeCaseListItem,
    serializeCaseDetail,
    buildPaymentLink,
    loadCaseDetail
  }
};
