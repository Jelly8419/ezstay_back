/**
 * adminGuestOrderController.js
 * 관리자 — 입주 준비 서비스 임차인 주문 모니터링
 *
 * Routes:
 *   GET    /api/admin/move-in/guest-orders                   # 목록 (필터 + 페이지네이션)
 *   GET    /api/admin/move-in/guest-orders/:orderId          # 단건 상세 + 로그
 *   PATCH  /api/admin/move-in/guest-orders/:orderId/delivery # 배송 상태 갱신
 *
 * 정책:
 *   - 관리자 권한 필수 (authenticateAdmin)
 *   - PAID 주문만 배송 상태 변경 가능
 *   - 배송 완료(DELIVERED) 시 deliveredAt 자동 기록
 *   - 모든 상태 변경 시 MoveInGuestOrderLog 기록 (actor='ADMIN')
 *   - 청소 정보 응답에 절대 포함 X (PRD 14.7-8) — case 정보는 임차인 phone 마스킹 X (관리자 화면)
 */

'use strict';

const { Op } = require('sequelize');
const {
  sequelize,
  MoveInCase,
  MoveInOption,
  MoveInGuestOrder,
  MoveInGuestOrderItem,
  MoveInGuestPayment,
  MoveInGuestOrderLog,
  MoveInGuestRefundRequest,
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
const paytagClient = require('../utils/paytagClient');
const { calcReturnRefund } = require('../utils/moveInRefundPolicy');
const { syncBeddingServiceTasks } = require('../services/moveInGuestOrderService');

const VALID_ORDER_STATUSES   = ['PENDING', 'PAID', 'PARTIAL_REFUND', 'FULLY_REFUNDED', 'CANCELLED'];
const VALID_DELIVERY_STATUSES = ['PENDING', 'IN_TRANSIT', 'DELIVERED'];

// 배송 상태 전이 규칙
const DELIVERY_TRANSITIONS = {
  PENDING:    ['IN_TRANSIT', 'DELIVERED'],
  IN_TRANSIT: ['DELIVERED', 'PENDING'], // 회수 등으로 되돌릴 수 있게
  DELIVERED:  ['IN_TRANSIT']            // 오발송 정정용
};

/**
 * 주문 인스턴스 → 관리자 응답 직렬화.
 * - 청소 정보 절대 포함 X
 */
function serializeAdminGuestOrder(order) {
  const o = typeof order.get === 'function' ? order.get({ plain: true }) : order;
  const c = o.case || null;
  const guest = o.guest || null;

  return {
    id: o.id,
    orderId: o.orderId,
    orderType: o.orderType,
    status: o.status,
    statusLabel: MoveInGuestOrder.STATUS_LABELS?.[o.status] || o.status,
    deliveryStatus: o.deliveryStatus,
    deliveryStatusLabel: MoveInGuestOrder.DELIVERY_STATUS_LABELS?.[o.deliveryStatus] || o.deliveryStatus,
    totalAmount: o.totalAmount,
    paidAmount: o.paidAmount,
    refundedAmount: o.refundedAmount,
    paidAt: toKSTString(o.paidAt),
    deliveredAt: toKSTString(o.deliveredAt),
    modifiableUntil: toKSTString(o.modifiableUntil),
    createdAt: toKSTString(o.createdAt),
    updatedAt: toKSTString(o.updatedAt),

    case: c ? {
      caseId: c.id,
      hostId: c.hostId,
      checkInDate: toKSTString(c.checkInDate),
      checkOutDate: toKSTString(c.checkOutDate),
      guestName: c.guestName,
      guestPhone: c.guestPhone
      // ⚠️ cleaningStatus / cleaningFee / cleaningPaidAt 의도적으로 제외
    } : null,

    guest: guest ? {
      userId: guest.id,
      name: guest.name,
      email: guest.email
    } : null,

    items: (o.items || []).map(it => ({
      id: it.id,
      optionId: it.optionId,
      optionName: it.option?.name || null,
      quantity: it.quantity,
      pricePerItem: it.pricePerItem,
      totalPrice: it.totalPrice,
      status: it.status,
      cancelledAt: toKSTString(it.cancelledAt)
    })),

    payments: (o.payments || []).map(p => ({
      id: p.id,
      orderId: p.orderId,
      amount: p.amount,
      status: p.status,
      pgProvider: p.pgProvider,
      pgMethod: p.pgMethod,
      pgTid: p.pgTid,
      paidAt: toKSTString(p.paidAt),
      failedAt: toKSTString(p.failedAt),
      failureReason: p.failureReason
    }))
  };
}

/**
 * GET /api/admin/move-in/guest-orders
 * Query: status, deliveryStatus, orderType, caseId, search(orderId/guestName/guestPhone), page, limit
 */
const listGuestOrders = async (req, res) => {
  try {
    const {
      status,
      deliveryStatus,
      orderType,
      caseId,
      search,
      page = 1,
      limit = 20
    } = req.query;

    const where = {};
    const caseWhere = {};

    if (status) {
      if (!VALID_ORDER_STATUSES.includes(status)) {
        return error(res, ErrorCodes.VALIDATION_ERROR, 400, `status는 ${VALID_ORDER_STATUSES.join('|')} 중 하나여야 합니다.`);
      }
      where.status = status;
    }
    if (deliveryStatus) {
      if (!VALID_DELIVERY_STATUSES.includes(deliveryStatus)) {
        return error(res, ErrorCodes.VALIDATION_ERROR, 400, `deliveryStatus는 ${VALID_DELIVERY_STATUSES.join('|')} 중 하나여야 합니다.`);
      }
      where.deliveryStatus = deliveryStatus;
    }
    if (orderType) {
      if (!['INITIAL', 'ADDITIONAL'].includes(orderType)) {
        return error(res, ErrorCodes.VALIDATION_ERROR, 400, 'orderType은 INITIAL|ADDITIONAL 중 하나여야 합니다.');
      }
      where.orderType = orderType;
    }
    if (caseId) {
      const cid = parseInt(caseId, 10);
      if (!Number.isInteger(cid) || cid <= 0) {
        return error(res, ErrorCodes.VALIDATION_ERROR, 400, 'caseId는 정수여야 합니다.');
      }
      where.caseId = cid;
    }

    // search: orderId LIKE OR case.guestName/guestPhone LIKE
    if (search) {
      const keyword = `%${String(search).trim()}%`;
      where[Op.or] = [{ orderId: { [Op.like]: keyword } }];
      caseWhere[Op.or] = [
        { guestName: { [Op.like]: keyword } },
        { guestPhone: { [Op.like]: keyword } }
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    const include = [
      {
        model: MoveInCase,
        as: 'case',
        required: !!search, // search 가 있을 때만 inner join
        ...(Object.keys(caseWhere).length ? { where: caseWhere } : {})
      },
      { model: User, as: 'guest', attributes: ['id', 'name', 'email'] },
      {
        model: MoveInGuestOrderItem,
        as: 'items',
        include: [{ model: MoveInOption, as: 'option', attributes: ['id', 'name'] }]
      }
    ];

    // search OR 분기: orderId 매칭은 where 에 직접, guestName/Phone 은 case 의 where 로 처리.
    // 위 구성은 둘 다 만족(AND)으로 동작 — search 가 있을 때 둘 다 일치하는 건만 반환되어 의도와 다름.
    // → search 가 있을 때는 case Or 와 order Or 합치는 raw 처리 대신, JOIN inner + 별도 OR 구조 사용.
    if (search) {
      // order.orderId LIKE OR case.guestName/Phone LIKE 를 묶은 OR
      where[Op.or] = [
        { orderId: { [Op.like]: `%${search}%` } },
        { '$case.guest_name$':  { [Op.like]: `%${search}%` } },
        { '$case.guest_phone$': { [Op.like]: `%${search}%` } }
      ];
      // caseWhere 는 이미 위 $...$ 표기로 흡수됐으므로 include.where 제거
      include[0].where = undefined;
      include[0].required = true;
    }

    const { rows, count } = await MoveInGuestOrder.findAndCountAll({
      where,
      include,
      order: [['createdAt', 'DESC']],
      limit: limitNum,
      offset,
      distinct: true,
      // $...$ 컬럼 참조 시 subQuery 비활성 필요
      subQuery: false
    });

    return success(res, {
      items: rows.map(serializeAdminGuestOrder),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count,
        totalPages: Math.ceil(count / limitNum)
      }
    }, '게스트 주문 목록을 조회했습니다.');
  } catch (err) {
    console.error('[adminGuestOrder.list] error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * GET /api/admin/move-in/guest-orders/:orderId
 * 단건 상세 + 로그 (최신순 50건)
 */
const getGuestOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const orderDbId = parseInt(orderId, 10);
    if (!Number.isInteger(orderDbId) || orderDbId <= 0) {
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, 'orderId는 정수여야 합니다.');
    }

    const order = await MoveInGuestOrder.findByPk(orderDbId, {
      include: [
        { model: MoveInCase, as: 'case' },
        { model: User, as: 'guest', attributes: ['id', 'name', 'email'] },
        {
          model: MoveInGuestOrderItem,
          as: 'items',
          include: [{ model: MoveInOption, as: 'option', attributes: ['id', 'name'] }]
        },
        { model: MoveInGuestPayment, as: 'payments' }
      ]
    });
    if (!order) {
      return error(res, ErrorCodes.MOVE_IN_GUEST_ORDER_NOT_FOUND, 404);
    }

    const logs = await MoveInGuestOrderLog.findAll({
      where: { guestOrderId: order.id },
      order: [['createdAt', 'DESC']],
      limit: 50
    });

    return success(res, {
      ...serializeAdminGuestOrder(order),
      logs: logs.map(l => ({
        id: l.id,
        actor: l.actor,
        actorId: l.actorId,
        action: l.action,
        amountChange: l.amountChange,
        balanceAfter: l.balanceAfter,
        description: l.description,
        metadata: l.metadata,
        ipAddress: l.ipAddress,
        createdAt: toKSTString(l.createdAt)
      }))
    }, '게스트 주문 상세를 조회했습니다.');
  } catch (err) {
    console.error('[adminGuestOrder.get] error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * PATCH /api/admin/move-in/guest-orders/:orderId/delivery
 * Body: { deliveryStatus, note? }
 *
 * 동작:
 *   - PAID 주문만 배송 상태 변경 가능 (PENDING 은 결제 미완)
 *   - 전이 규칙 (DELIVERY_TRANSITIONS) 위반 시 거절
 *   - DELIVERED 진입 시 deliveredAt 자동 기록
 *   - DELIVERY_UPDATED 또는 DELIVERY_COMPLETED 로그 기록
 */
const updateDeliveryStatus = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const adminId = req.admin?.id ?? req.user?.id ?? null;
    const { orderId } = req.params;
    const { deliveryStatus, note } = req.body || {};

    const orderDbId = parseInt(orderId, 10);
    if (!Number.isInteger(orderDbId) || orderDbId <= 0) {
      await transaction.rollback();
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, 'orderId는 정수여야 합니다.');
    }
    if (!VALID_DELIVERY_STATUSES.includes(deliveryStatus)) {
      await transaction.rollback();
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, `deliveryStatus는 ${VALID_DELIVERY_STATUSES.join('|')} 중 하나여야 합니다.`);
    }

    const order = await MoveInGuestOrder.findByPk(orderDbId, { transaction });
    if (!order) {
      await transaction.rollback();
      return error(res, ErrorCodes.MOVE_IN_GUEST_ORDER_NOT_FOUND, 404);
    }

    if (order.status !== 'PAID' && order.status !== 'PARTIAL_REFUND') {
      await transaction.rollback();
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, `결제 완료된 주문만 배송 상태를 변경할 수 있습니다. (현재: ${order.status})`);
    }

    if (order.deliveryStatus === deliveryStatus) {
      await transaction.rollback();
      return success(res, serializeAdminGuestOrder(order), '이미 동일한 배송 상태입니다.');
    }

    const allowed = DELIVERY_TRANSITIONS[order.deliveryStatus] || [];
    if (!allowed.includes(deliveryStatus)) {
      await transaction.rollback();
      return error(res, ErrorCodes.VALIDATION_ERROR, 400,
        `배송 상태 전이가 허용되지 않습니다. ${order.deliveryStatus} → ${deliveryStatus} (허용: ${allowed.join('|')})`);
    }

    const fromStatus = order.deliveryStatus;
    const updates = { deliveryStatus };

    if (deliveryStatus === 'DELIVERED') {
      updates.deliveredAt = new Date();
    } else if (fromStatus === 'DELIVERED' && deliveryStatus !== 'DELIVERED') {
      // 되돌릴 때 deliveredAt 초기화
      updates.deliveredAt = null;
    }

    await order.update(updates, { transaction });

    await MoveInGuestOrderLog.createLog({
      guestOrderId: order.id,
      caseId: order.caseId,
      actor: 'ADMIN',
      actorId: adminId,
      action: deliveryStatus === 'DELIVERED' ? 'DELIVERY_COMPLETED' : 'DELIVERY_UPDATED',
      amountChange: 0,
      balanceAfter: order.paidAmount,
      metadata: { fromStatus, toStatus: deliveryStatus },
      description: note || null,
      req
    }, transaction);

    await transaction.commit();

    // 갱신된 인스턴스 다시 로드
    const refreshed = await MoveInGuestOrder.findByPk(order.id, {
      include: [
        { model: MoveInCase, as: 'case' },
        { model: User, as: 'guest', attributes: ['id', 'name', 'email'] },
        {
          model: MoveInGuestOrderItem,
          as: 'items',
          include: [{ model: MoveInOption, as: 'option', attributes: ['id', 'name'] }]
        },
        { model: MoveInGuestPayment, as: 'payments' }
      ]
    });

    return updated(res, serializeAdminGuestOrder(refreshed), '배송 상태가 갱신되었습니다.');
  } catch (err) {
    if (!transaction.finished) await transaction.rollback();
    console.error('[adminGuestOrder.updateDelivery] error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 반품 요청 직렬화 (목록/단건 공용).
 * include alias: order / case / requester / processedByAdmin
 */
function serializeRefundRequest(r, { detail = false } = {}) {
  const o = typeof r.get === 'function' ? r.get({ plain: true }) : r;
  const order = o.order || null;
  const caseRow = o.case || null;
  const requester = o.requester || null;
  const admin = o.processedByAdmin || null;

  const base = {
    id: o.id,
    status: o.status,
    statusLabel: MoveInGuestRefundRequest.STATUS_LABELS?.[o.status] || o.status,
    guestOrderId: o.guestOrderId,
    caseId: o.caseId,
    returnReason: o.returnReason,
    rejectReason: o.rejectReason,
    deliveryStatusSnapshot: o.deliveryStatusSnapshot,
    itemTotalAmount: o.itemTotalAmount,
    shippingDeduction: o.shippingDeduction,
    finalRefundAmount: o.finalRefundAmount,
    requestedBy: o.requestedBy,
    requesterName: requester?.name || null,
    adminId: o.adminId,
    adminName: admin?.name || null,
    // 부분 반품 대상 스냅샷 (null = 전체 반품)
    targetItems: o.targetItems || null,
    processedAt: toKSTString(o.processedAt),
    createdAt: toKSTString(o.createdAt),
    updatedAt: toKSTString(o.updatedAt),
    order: order ? {
      orderDbId: order.id,
      orderId: order.orderId,
      orderType: order.orderType,
      status: order.status,
      totalAmount: order.totalAmount,
      deliveryStatus: order.deliveryStatus
    } : null,
    case: caseRow ? {
      caseId: caseRow.id,
      guestName: caseRow.guestName,
      guestPhone: caseRow.guestPhone,
      checkInDate: caseRow.checkInDate,
      checkOutDate: caseRow.checkOutDate
      // ⚠️ 청소 필드 의도적 제외 (PRD 14.7-8)
    } : null
  };

  if (detail && order?.items) {
    base.items = order.items.map(it => ({
      id: it.id,
      optionId: it.optionId,
      optionName: it.option?.name || null,
      quantity: it.quantity,
      totalPrice: it.totalPrice,
      status: it.status
    }));
  }
  return base;
}

/**
 * GET /api/admin/move-in/refund-requests
 * Query: status(PENDING|APPROVED|REJECTED), caseId, page, limit
 */
const listRefundRequests = async (req, res) => {
  try {
    const { status, caseId, page = 1, limit = 20 } = req.query;
    const where = {};

    if (status) {
      if (!['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
        return error(res, ErrorCodes.VALIDATION_ERROR, 400, 'status는 PENDING|APPROVED|REJECTED 중 하나여야 합니다.');
      }
      where.status = status;
    }
    if (caseId) {
      const cid = parseInt(caseId, 10);
      if (!Number.isInteger(cid) || cid <= 0) {
        return error(res, ErrorCodes.VALIDATION_ERROR, 400, 'caseId는 정수여야 합니다.');
      }
      where.caseId = cid;
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    const { rows, count } = await MoveInGuestRefundRequest.findAndCountAll({
      where,
      include: [
        { model: MoveInGuestOrder, as: 'order', attributes: ['id', 'orderId', 'orderType', 'status', 'totalAmount', 'deliveryStatus'] },
        { model: MoveInCase, as: 'case', attributes: ['id', 'guestName', 'guestPhone', 'checkInDate', 'checkOutDate'] },
        { model: User, as: 'requester', attributes: ['id', 'name'] },
        { model: Admin, as: 'processedByAdmin', attributes: ['id', 'name'] }
      ],
      order: [['createdAt', 'DESC']],
      limit: limitNum,
      offset,
      distinct: true
    });

    return success(res, {
      items: rows.map(r => serializeRefundRequest(r)),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count,
        totalPages: Math.ceil(count / limitNum)
      }
    }, '반품 요청 목록을 조회했습니다.');
  } catch (err) {
    console.error('[adminGuestOrder.listRefundRequests] error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * GET /api/admin/move-in/refund-requests/:requestId
 * 단건 상세 (주문 라인 포함)
 */
const getRefundRequest = async (req, res) => {
  try {
    const requestId = parseInt(req.params.requestId, 10);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, 'requestId는 정수여야 합니다.');
    }

    const reqRow = await MoveInGuestRefundRequest.findByPk(requestId, {
      include: [
        {
          model: MoveInGuestOrder,
          as: 'order',
          include: [{
            model: MoveInGuestOrderItem,
            as: 'items',
            include: [{ model: MoveInOption, as: 'option', attributes: ['id', 'name'] }]
          }]
        },
        { model: MoveInCase, as: 'case', attributes: ['id', 'guestName', 'guestPhone', 'checkInDate', 'checkOutDate'] },
        { model: User, as: 'requester', attributes: ['id', 'name'] },
        { model: Admin, as: 'processedByAdmin', attributes: ['id', 'name'] }
      ]
    });
    if (!reqRow) {
      return error(res, ErrorCodes.MOVE_IN_REFUND_REQUEST_NOT_FOUND, 404);
    }

    return success(res, serializeRefundRequest(reqRow, { detail: true }), '반품 요청 상세를 조회했습니다.');
  } catch (err) {
    console.error('[adminGuestOrder.getRefundRequest] error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * MoveInGuestPayment → PayTag cancelPayment 파라미터.
 * (게스트 컨트롤러 buildGuestCancelParams 와 동일 — paymentResponse 없는 도메인)
 */
function buildCancelParams(order, payment) {
  if (!payment.pgTid) {
    const e = new Error('PG 거래번호(pgTid)가 없어 자동 취소가 불가합니다. 관리자 수동 취소가 필요합니다.');
    e.code = 'MISSING_PG_TID';
    throw e;
  }
  const paidAt = payment.paidAt ? new Date(payment.paidAt) : new Date();
  const y = paidAt.getFullYear();
  const m = String(paidAt.getMonth() + 1).padStart(2, '0');
  const d = String(paidAt.getDate()).padStart(2, '0');
  return {
    orderno: payment.pgTid,  // PG 거래번호 (가맹점 주문번호 아님)
    orgpaydate: `${y}${m}${d}`,
    orgtranamt: payment.amount
  };
}

const USE_MOCK = process.env.PAYMENT_USE_MOCK === 'true';

/**
 * PATCH /api/admin/move-in/refund-requests/:requestId/approve
 * 반품 요청 승인 → 왕복배송비 차감 후 PG 환불.
 *
 * 흐름:
 *   1. PENDING 반품요청 + 주문 + RETURN_REQUESTED 라인 + PAID 결제 로드
 *   2. calcReturnRefund 로 수거비 차감 금액 산정
 *   3. PG 취소 (트랜잭션 밖, Mock 분기)
 *   4. 라인 CANCELLED / 결제 CANCELLED / 주문 FULLY_REFUNDED / 요청 APPROVED + 로그
 */
const approveReturn = async (req, res) => {
  const preTx = await sequelize.transaction();
  try {
    const adminId = req.admin?.id ?? null;
    const requestId = parseInt(req.params.requestId, 10);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      await preTx.rollback();
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, 'requestId는 정수여야 합니다.');
    }

    const reqRow = await MoveInGuestRefundRequest.findByPk(requestId, {
      include: [{ model: MoveInGuestOrder, as: 'order' }],
      transaction: preTx
    });
    if (!reqRow) {
      await preTx.rollback();
      return error(res, ErrorCodes.MOVE_IN_REFUND_REQUEST_NOT_FOUND, 404);
    }
    if (reqRow.status !== 'PENDING') {
      await preTx.rollback();
      return error(res, ErrorCodes.MOVE_IN_REFUND_REQUEST_NOT_PENDING, 400);
    }

    const order = reqRow.order;
    if (!order) {
      await preTx.rollback();
      return error(res, ErrorCodes.MOVE_IN_GUEST_ORDER_NOT_FOUND, 404);
    }

    // 반품 대상 = targetItems 스냅샷 (없으면 = 구버전 전체 반품 폴백: ACTIVE 라인 전부)
    const snapshot = reqRow.targetItems; // [{itemId,optionId,quantity,pricePerItem}]
    let targetLines;
    if (Array.isArray(snapshot) && snapshot.length > 0) {
      const ids = snapshot.map(s => s.itemId);
      const items = await MoveInGuestOrderItem.findAll({
        where: { id: ids, guestOrderId: order.id },
        transaction: preTx
      });
      const byId = new Map(items.map(it => [it.id, it]));
      targetLines = [];
      for (const s of snapshot) {
        const it = byId.get(s.itemId);
        if (!it || it.status !== 'ACTIVE') {
          await preTx.rollback();
          return error(res, ErrorCodes.VALIDATION_ERROR, 400,
            `반품 대상 라인(${s.itemId})이 더 이상 유효하지 않습니다.`);
        }
        const qty = Math.min(s.quantity, it.quantity);
        targetLines.push({ item: it, quantity: qty, pricePerItem: Number(it.pricePerItem) });
      }
    } else {
      const items = await MoveInGuestOrderItem.findAll({
        where: { guestOrderId: order.id, status: 'ACTIVE' },
        transaction: preTx
      });
      if (items.length === 0) {
        await preTx.rollback();
        return error(res, ErrorCodes.VALIDATION_ERROR, 400, '반품 대상 라인이 없습니다.');
      }
      targetLines = items.map(it => ({ item: it, quantity: it.quantity, pricePerItem: Number(it.pricePerItem) }));
    }

    const itemTotalAmount = targetLines.reduce((s, l) => s + l.pricePerItem * l.quantity, 0);

    // 배송비 면제: 같은 케이스에 이미 APPROVED 된(=수거 진행 중) 반품요청이 있으면 면제
    const priorApproved = await MoveInGuestRefundRequest.count({
      where: {
        caseId: reqRow.caseId,
        id: { [Op.ne]: reqRow.id },
        status: 'APPROVED'
      },
      transaction: preTx
    });
    const { shippingDeduction, finalRefundAmount } = calcReturnRefund(itemTotalAmount, priorApproved > 0);
    if (finalRefundAmount <= 0) {
      await preTx.rollback();
      return error(res, ErrorCodes.VALIDATION_ERROR, 400,
        `환불 금액(${itemTotalAmount}원)이 왕복배송비(${shippingDeduction}원) 이하입니다.`);
    }

    const payment = await MoveInGuestPayment.findOne({
      where: { guestOrderId: order.id, status: 'PAID' },
      transaction: preTx
    });
    if (!payment) {
      await preTx.rollback();
      return error(res, ErrorCodes.MOVE_IN_GUEST_PAYMENT_NOT_FOUND, 404);
    }

    const isMock = payment.pgProvider === 'mock' || USE_MOCK;

    await preTx.rollback();

    if (!isMock) {
      let cancelParams;
      try {
        cancelParams = buildCancelParams(order, payment);
      } catch (e) {
        if (e.code === 'MISSING_PG_TID') {
          console.error('[adminGuestOrder.approveReturn] pgTid 누락 — 수동 취소 필요:', {
            orderId: order.orderId, paymentId: payment.id
          });
          return error(res, { code: 4903, message: e.message }, 409);
        }
        throw e;
      }
      // 환불 후 결제 잔액 0 이면 전체취소('0'), 남으면 부분취소('1')
      const balanceBefore = Number(payment.amount) - Number(order.refundedAmount || 0);
      const canceltype = (finalRefundAmount >= balanceBefore) ? '0' : '1';
      try {
        await paytagClient.cancelPayment({
          ...cancelParams,
          cancelamt: finalRefundAmount,
          canceltype
        });
      } catch (pgErr) {
        if (pgErr.paytagErrorCode === '1023') {
          return error(res, { code: 4901, message: '이미 취소 완료된 결제입니다.' }, 400);
        }
        console.error('[adminGuestOrder.approveReturn] PayTag 오류:', pgErr.message);
        return error(res, { code: 4900, message: `PG 취소 실패: ${pgErr.paytagErrorMessage || pgErr.message}` }, 502);
      }
    }

    const tx = await sequelize.transaction();
    let finalOrderStatus;
    try {
      const now = new Date();

      // 스냅샷 기준 라인별 처리 — full: CANCELLED / 부분: quantity 차감 (분할 X)
      for (const tl of targetLines) {
        const it = tl.item;
        const isFull = tl.quantity === it.quantity;
        if (isFull) {
          await it.update({
            status: 'CANCELLED',
            cancelledAt: now,
            cancelReason: '반품 승인 환불',
            refundAmount: Number(it.refundAmount || 0) + tl.pricePerItem * tl.quantity
          }, { transaction: tx });
        } else {
          const remainQty = it.quantity - tl.quantity;
          await it.update({
            quantity: remainQty,
            totalPrice: tl.pricePerItem * remainQty,
            cancelReason: '반품 승인 부분 환불',
            refundAmount: Number(it.refundAmount || 0) + tl.pricePerItem * tl.quantity
          }, { transaction: tx });
        }
      }

      const remainingActive = await MoveInGuestOrderItem.count({
        where: { guestOrderId: order.id, status: 'ACTIVE' },
        transaction: tx
      });
      finalOrderStatus = remainingActive === 0 ? 'FULLY_REFUNDED' : 'PARTIAL_REFUND';

      if (finalOrderStatus === 'FULLY_REFUNDED') {
        await payment.update({
          status: 'CANCELLED',
          failedAt: now,
          failureReason: '반품 승인 환불'
        }, { transaction: tx });
      }
      await order.update({
        status: finalOrderStatus,
        refundedAmount: Number(order.refundedAmount || 0) + finalRefundAmount
      }, { transaction: tx });
      await reqRow.update({
        status: 'APPROVED',
        shippingDeduction,
        finalRefundAmount,
        adminId,
        processedAt: now
      }, { transaction: tx });

      await MoveInGuestOrderLog.createLog({
        guestOrderId: order.id,
        caseId: order.caseId,
        actor: 'ADMIN',
        actorId: adminId,
        action: 'RETURN_APPROVED',
        amountChange: -finalRefundAmount,
        balanceAfter: 0,
        metadata: {
          refundRequestId: reqRow.id, itemTotalAmount, shippingDeduction, finalRefundAmount,
          lines: targetLines.map(tl => ({ itemId: tl.item.id, quantity: tl.quantity })),
          mock: isMock
        },
        req
      }, tx);

      // 침구류 task 동기화 (반품 승인으로 라인 차감 → 수량 갱신/CANCELLED)
      await syncBeddingServiceTasks(reqRow.caseId, tx);

      await tx.commit();
    } catch (dbErr) {
      await tx.rollback();
      console.error('[adminGuestOrder.approveReturn] DB 반영 실패 (PG는 이미 취소됨):', dbErr);
      return error(res, ErrorCodes.INTERNAL_ERROR, 500, 'PG 취소는 완료됐으나 DB 반영에 실패했습니다.');
    }

    return success(res, {
      refundRequestId: reqRow.id,
      orderDbId: order.id,
      orderId: order.orderId,
      status: 'APPROVED',
      orderStatus: finalOrderStatus,
      itemTotalAmount,
      shippingDeduction,
      finalRefundAmount
    }, '반품 요청이 승인되어 환불 처리되었습니다.');
  } catch (err) {
    if (!preTx.finished) await preTx.rollback();
    console.error('[adminGuestOrder.approveReturn] error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * PATCH /api/admin/move-in/refund-requests/:requestId/reject
 * 반품 요청 거절 → 라인 RETURN_REQUESTED → ACTIVE 원복.
 * Body: { rejectReason }
 */
const rejectReturn = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const adminId = req.admin?.id ?? null;
    const requestId = parseInt(req.params.requestId, 10);
    const { rejectReason } = req.body || {};

    if (!Number.isInteger(requestId) || requestId <= 0) {
      await transaction.rollback();
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, 'requestId는 정수여야 합니다.');
    }

    const reqRow = await MoveInGuestRefundRequest.findByPk(requestId, { transaction });
    if (!reqRow) {
      await transaction.rollback();
      return error(res, ErrorCodes.MOVE_IN_REFUND_REQUEST_NOT_FOUND, 404);
    }
    if (reqRow.status !== 'PENDING') {
      await transaction.rollback();
      return error(res, ErrorCodes.MOVE_IN_REFUND_REQUEST_NOT_PENDING, 400);
    }

    const now = new Date();
    // 정책(나안): 반품 요청 시 라인 status 를 변경하지 않으므로 원복 불필요.
    // 구버전(라인이 RETURN_REQUESTED 로 바뀐) 데이터 호환을 위해 방어적 원복만 유지.
    await MoveInGuestOrderItem.update(
      { status: 'ACTIVE' },
      { where: { guestOrderId: reqRow.guestOrderId, status: 'RETURN_REQUESTED' }, transaction }
    );
    await reqRow.update({
      status: 'REJECTED',
      rejectReason: rejectReason || null,
      adminId,
      processedAt: now
    }, { transaction });

    await MoveInGuestOrderLog.createLog({
      guestOrderId: reqRow.guestOrderId,
      caseId: reqRow.caseId,
      actor: 'ADMIN',
      actorId: adminId,
      action: 'RETURN_REJECTED',
      amountChange: 0,
      balanceAfter: 0,
      metadata: { refundRequestId: reqRow.id },
      description: rejectReason || null,
      req
    }, transaction);

    await transaction.commit();

    return success(res, {
      refundRequestId: reqRow.id,
      status: 'REJECTED'
    }, '반품 요청이 거절되었습니다.');
  } catch (err) {
    if (!transaction.finished) await transaction.rollback();
    console.error('[adminGuestOrder.rejectReturn] error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

module.exports = {
  listGuestOrders,
  getGuestOrder,
  updateDeliveryStatus,
  listRefundRequests,
  getRefundRequest,
  approveReturn,
  rejectReturn
};
