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
  User
} = require('../models');
const {
  ErrorCodes,
  success,
  error,
  updated
} = require('../utils/responseHelper');
const { toKSTString } = require('../utils/dateHelper');

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

module.exports = {
  listGuestOrders,
  getGuestOrder,
  updateDeliveryStatus
};
