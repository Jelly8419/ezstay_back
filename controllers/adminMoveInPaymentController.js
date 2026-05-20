/**
 * adminMoveInPaymentController.js
 * 관리자 — 입주 준비 서비스 결제 통합 내역 조회
 *
 * Route:
 *   GET /api/admin/move-in/payments  (authenticateAdmin)
 *
 * 통합 대상 (결제 트랜잭션 단위, 실패/재시도 포함):
 *   - 임대인 청소 결제   : MoveInPayment       (type=cleaning)
 *   - 임차인 옵션 결제   : MoveInGuestPayment  (type=guest_option)
 *
 * 정책:
 *   - 환불은 별도 행 X — 결제 행의 status=REFUNDED + refundedAt/refundReason 으로 표현
 *   - status=CANCELLED 는 결제 전 취소(PENDING 자동만료/수동취소) 전용
 *   - paidAt DESC (null 이면 createdAt) 정렬, 두 도메인 concat 후 페이지네이션
 *   - 관리자 화면이므로 청소 결제 노출 OK (게스트 차단 정책은 게스트 응답 한정)
 */

'use strict';

const { Op } = require('sequelize');
const {
  MoveInPayment,
  MoveInGuestPayment,
  MoveInGuestOrder,
  MoveInGuestOrderItem,
  MoveInOption,
  MoveInCase,
  MoveInRoom,
  User
} = require('../models');
const { ErrorCodes, success, error } = require('../utils/responseHelper');
const { toKSTString } = require('../utils/dateHelper');
const { buildBreakdown, productLabel } = require('../utils/moveInPaymentSerializer');

const VALID_STATUSES = ['PENDING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED'];
const STATUS_LABELS = {
  PENDING:   '결제 대기',
  PAID:      '결제 완료',
  FAILED:    '결제 실패',
  CANCELLED: '결제 취소',
  REFUNDED:  '환불 완료'
};

/** 정렬 키: paidAt 우선, 없으면 createdAt */
function sortTs(row) {
  const d = row.paidAt || row.createdAt;
  return d ? new Date(d).getTime() : 0;
}

function caseSummary(c) {
  if (!c) return null;
  const room = c.room || null;
  return {
    caseId: c.id,
    address: room?.address || null,
    detailAddress: room?.detailAddress || null,
    guestName: c.guestName,
    guestPhone: c.guestPhone
  };
}

function serializeCleaningPayment(p) {
  const o = p.get ? p.get({ plain: true }) : p;
  const host = o.host || null;
  return {
    type: 'cleaning',
    paymentId: o.id,
    orderId: o.orderId,
    caseId: o.caseId,
    guestOrderId: null,
    amount: o.amount,
    status: o.status,
    statusLabel: STATUS_LABELS[o.status] || o.status,
    pgProvider: o.pgProvider,
    pgMethod: o.pgMethod,
    pgTid: o.pgTid,
    easyPayProvider: o.easyPayProvider || null,
    paidAt: toKSTString(o.paidAt),
    refundedAt: toKSTString(o.refundedAt),
    refundReason: o.refundReason || null,
    failedAt: toKSTString(o.failedAt),
    failureReason: o.failureReason,
    payer: host ? { role: 'host', name: host.name, phone: host.phoneNumber } : { role: 'host', name: null, phone: null },
    case: caseSummary(o.case),
    createdAt: toKSTString(o.createdAt),
    _ts: sortTs(o)
  };
}

function serializeGuestPayment(p) {
  const o = p.get ? p.get({ plain: true }) : p;
  const guest = o.guest || null;
  const order = o.order || null;
  const items = order?.items || [];
  const breakdown = buildBreakdown(items);
  return {
    type: 'guest_option',
    paymentId: o.id,
    orderId: o.orderId,
    caseId: o.caseId,
    guestOrderId: o.guestOrderId,
    amount: o.amount,
    status: o.status,
    statusLabel: STATUS_LABELS[o.status] || o.status,
    pgProvider: o.pgProvider,
    pgMethod: o.pgMethod,
    pgTid: o.pgTid,
    easyPayProvider: o.easyPayProvider || null,
    paidAt: toKSTString(o.paidAt),
    refundedAt: toKSTString(o.refundedAt),
    refundReason: o.refundReason || null,
    failedAt: toKSTString(o.failedAt),
    failureReason: o.failureReason,
    payer: guest ? { role: 'guest', name: guest.name, phone: guest.phoneNumber } : { role: 'guest', name: null, phone: null },
    case: caseSummary(o.case),
    productLabel: productLabel(breakdown),
    breakdown,
    order: order ? {
      orderDbId: order.id,
      orderStatus: order.status,
      lastRefundedAt: toKSTString(order.lastRefundedAt),
      paidAmount: order.paidAmount,
      refundedAmount: order.refundedAmount
    } : null,
    createdAt: toKSTString(o.createdAt),
    _ts: sortTs(o)
  };
}

/**
 * 결제일 범위 → Op 조건 (paidAt 기준, KST 경계).
 * CLAUDE.md: 'YYYY-MM-DD' 는 +09:00 명시해 UTC Date 로 파싱.
 */
function buildPaidAtWhere(paidFrom, paidTo) {
  const cond = {};
  if (paidFrom) cond[Op.gte] = new Date(`${paidFrom}T00:00:00+09:00`);
  if (paidTo)   cond[Op.lte] = new Date(`${paidTo}T23:59:59+09:00`);
  return Object.keys(cond).length || Object.getOwnPropertySymbols(cond).length ? { paidAt: cond } : {};
}

/**
 * GET /api/admin/move-in/payments
 */
const listMoveInPayments = async (req, res) => {
  try {
    const {
      type = 'all',
      status,
      paidFrom,
      paidTo,
      search,
      category,        // BEDDING_SET 등 — 게스트 옵션 결제 필터 (혼합 주문 포함)
      page = 1,
      limit = 20
    } = req.query;

    if (!['all', 'cleaning', 'guest_option'].includes(type)) {
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, 'type은 all|cleaning|guest_option 중 하나여야 합니다.');
    }
    if (status && !VALID_STATUSES.includes(status)) {
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, `status는 ${VALID_STATUSES.join('|')} 중 하나여야 합니다.`);
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    const baseWhere = {};
    if (status) baseWhere.status = status;
    Object.assign(baseWhere, buildPaidAtWhere(paidFrom, paidTo));

    const kwRaw = search ? String(search).trim() : null;
    const kw = kwRaw ? `%${kwRaw}%` : null;
    const searchNum = kwRaw && /^\d+$/.test(kwRaw) ? parseInt(kwRaw, 10) : null;

    // 이름/전화 검색은 nested $assoc$ 별칭 이슈 회피 위해 User id 선조회 후 FK IN 으로 필터
    let matchedUserIds = null;
    if (kw) {
      const users = await User.findAll({
        where: { [Op.or]: [{ name: { [Op.like]: kw } }, { phoneNumber: { [Op.like]: kw } }] },
        attributes: ['id']
      });
      matchedUserIds = users.map(u => u.id);
    }

    let cleaningRows = [];
    let guestRows = [];

    // ── 청소 결제 ──
    if (type === 'all' || type === 'cleaning') {
      const where = { ...baseWhere };
      if (kw) {
        // 검색: orderId / caseId / 임대인(host) 이름·전화
        where[Op.or] = [
          { orderId: { [Op.like]: kw } },
          ...(searchNum != null ? [{ caseId: searchNum }] : []),
          ...(matchedUserIds && matchedUserIds.length ? [{ hostId: { [Op.in]: matchedUserIds } }] : [])
        ];
      }
      const rows = await MoveInPayment.findAll({
        where,
        include: [
          {
            model: MoveInCase, as: 'case',
            include: [{ model: MoveInRoom, as: 'room', attributes: ['id', 'address', 'detailAddress'] }]
          },
          { model: User, as: 'host', attributes: ['id', 'name', 'phoneNumber'], required: false }
        ]
      });
      cleaningRows = rows.map(serializeCleaningPayment);
    }

    // ── 게스트 옵션 결제 ──
    if (type === 'all' || type === 'guest_option') {
      const where = { ...baseWhere };
      if (kw) {
        // case.guestName/Phone 매칭 케이스 선조회 (스냅샷성 임차인 정보)
        const matchedCases = await MoveInCase.findAll({
          where: { [Op.or]: [
            { guestName: { [Op.like]: kw } },
            { guestPhone: { [Op.like]: kw } }
          ] },
          attributes: ['id']
        });
        const matchedCaseIds = matchedCases.map(x => x.id);
        if (searchNum != null) matchedCaseIds.push(searchNum);

        where[Op.or] = [
          { orderId: { [Op.like]: kw } },
          ...(matchedCaseIds.length ? [{ caseId: { [Op.in]: matchedCaseIds } }] : []),
          ...(matchedUserIds && matchedUserIds.length ? [{ guestUserId: { [Op.in]: matchedUserIds } }] : [])
        ];
      }
      const rows = await MoveInGuestPayment.findAll({
        where,
        include: [
          {
            model: MoveInCase, as: 'case',
            include: [{ model: MoveInRoom, as: 'room', attributes: ['id', 'address', 'detailAddress'] }]
          },
          { model: User, as: 'guest', attributes: ['id', 'name', 'phoneNumber'], required: false },
          {
            model: MoveInGuestOrder, as: 'order',
            required: false,
            include: [{
              model: MoveInGuestOrderItem, as: 'items',
              required: false,
              include: [{ model: MoveInOption, as: 'option', attributes: ['id', 'category'] }]
            }]
          }
        ]
      });
      guestRows = rows.map(serializeGuestPayment);

      // 카테고리 필터 (메모리 단계 — 라인 합계 후 판정)
      if (category) {
        guestRows = guestRows.filter(r => (r.breakdown?.[category]?.amount ?? 0) > 0);
      }
    }

    // ── 통합 정렬 + 페이지네이션 ──
    const merged = [...cleaningRows, ...guestRows].sort((a, b) => b._ts - a._ts);
    const total = merged.length;
    const offset = (pageNum - 1) * limitNum;
    const pageItems = merged.slice(offset, offset + limitNum).map(({ _ts, ...rest }) => rest);

    return success(res, {
      items: pageItems,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      },
      breakdown: {
        cleaning: cleaningRows.length,
        guest_option: guestRows.length
      }
    }, '입주 준비 결제 내역을 조회했습니다.');
  } catch (err) {
    console.error('[adminMoveInPayment.list] error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

module.exports = { listMoveInPayments };
