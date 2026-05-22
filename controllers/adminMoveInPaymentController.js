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
  MoveInServiceTask,
  User
} = require('../models');
const { ErrorCodes, success, error } = require('../utils/responseHelper');
const { toKSTString } = require('../utils/dateHelper');
const { buildBreakdown, productLabel } = require('../utils/moveInPaymentSerializer');
const { evaluateCleaningRefund } = require('../utils/moveInRefundPolicy');
const cryptoHelper = require('../utils/cryptoHelper');

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

/**
 * GET /api/admin/move-in/cases/:caseId/cleaning-payment
 *
 * 청소 결제 케이스 단위 상세.
 * - 한 케이스의 모든 MoveInPayment 시도(PAID/FAILED/REFUNDED/PENDING/CANCELLED 포함)
 * - 청소 환불 정책 평가 결과(canRefund 등)
 * - 청소용 ServiceTask (자동 생성 청소 작업) 동봉
 * - room snapshot 의 도어락/공동현관 비밀번호 복호화 노출 (관리자 화면 한정)
 */
const getCleaningPaymentDetail = async (req, res) => {
  try {
    const caseId = parseInt(req.params.caseId, 10);
    if (!Number.isInteger(caseId) || caseId <= 0) {
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, 'caseId는 정수여야 합니다.');
    }

    const caseRow = await MoveInCase.findByPk(caseId, {
      include: [
        { model: MoveInRoom, as: 'room', attributes: ['id', 'address', 'detailAddress'] },
        { model: User, as: 'host', attributes: ['id', 'name', 'phoneNumber'], required: false },
        { model: User, as: 'guest', attributes: ['id', 'name', 'phoneNumber'], required: false }
      ]
    });
    if (!caseRow) {
      return error(res, ErrorCodes.NOT_FOUND, 404, '케이스를 찾을 수 없습니다.');
    }

    // 모든 결제 시도 (실패/만료 포함, createdAt 오름차순)
    const payments = await MoveInPayment.findAll({
      where: { caseId },
      order: [['createdAt', 'ASC']]
    });

    // 자동 생성된 청소 ServiceTask
    const cleaningTasks = await MoveInServiceTask.findAll({
      where: { caseId, taskType: 'CLEANING' },
      order: [['referenceDate', 'ASC']]
    });

    // 환불 정책 평가 (PAID 결제가 있을 때만 의미)
    const paidPayment = payments.find(p => p.status === 'PAID');
    let cleaningRefund = { canRefund: false, refundAmount: 0, deduction: 0, reason: null };
    if (paidPayment) {
      const v = evaluateCleaningRefund({
        cleaningDate: caseRow.cleaningDate,
        cleaningTime: caseRow.cleaningTime,
        paidAmount: Number(caseRow.cleaningFee) || 0
      });
      cleaningRefund = {
        canRefund: v.allowed,
        refundAmount: v.refundAmount,
        deduction: v.deduction,
        reason: v.allowed ? null : (v.reason || null)
      };
    }

    // 방 스냅샷 비밀번호 복호화 (관리자 화면 정책 — CLAUDE.md 입주 준비 절)
    let roomSnapshot = caseRow.roomSnapshot ? { ...caseRow.roomSnapshot } : null;
    if (roomSnapshot) {
      try {
        roomSnapshot.commonEntrancePassword = cryptoHelper.decrypt(roomSnapshot.commonEntrancePassword);
        roomSnapshot.doorLockPassword = cryptoHelper.decrypt(roomSnapshot.doorLockPassword);
      } catch (_) { /* 미설정/이전 데이터 호환 */ }
    }

    return success(res, {
      case: {
        id: caseRow.id,
        moveInRoomId: caseRow.moveInRoomId,
        checkInDate: caseRow.checkInDate,
        checkOutDate: caseRow.checkOutDate,
        cleaningStatus: caseRow.cleaningStatus,
        cleaningFee: caseRow.cleaningFee,
        cleaningPaidAt: toKSTString(caseRow.cleaningPaidAt),
        cleaningDate: caseRow.cleaningDate,
        cleaningTime: caseRow.cleaningTime,
        host: caseRow.host
          ? { id: caseRow.host.id, name: caseRow.host.name, phone: caseRow.host.phoneNumber }
          : null,
        guest: caseRow.guest
          ? { id: caseRow.guest.id, name: caseRow.guest.name, phone: caseRow.guest.phoneNumber }
          : { id: null, name: caseRow.guestName, phone: caseRow.guestPhone },
        room: caseRow.room
          ? { id: caseRow.room.id, address: caseRow.room.address, detailAddress: caseRow.room.detailAddress }
          : null,
        roomSnapshot,
        adminMemo: caseRow.adminMemo
      },
      payments: payments.map(p => ({
        paymentId: p.id,
        orderId: p.orderId,
        amount: p.amount,
        status: p.status,
        statusLabel: STATUS_LABELS[p.status] || p.status,
        pgProvider: p.pgProvider,
        pgMethod: p.pgMethod,
        pgTid: p.pgTid,
        easyPayProvider: p.easyPayProvider || null,
        paidAt: toKSTString(p.paidAt),
        refundedAt: toKSTString(p.refundedAt),
        refundReason: p.refundReason || null,
        failedAt: toKSTString(p.failedAt),
        failureReason: p.failureReason || null,
        createdAt: toKSTString(p.createdAt)
      })),
      cleaningRefund,
      serviceTasks: cleaningTasks.map(t => ({
        id: t.id,
        taskType: t.taskType,
        status: t.status,
        referenceDate: t.referenceDate,
        quantity: t.quantity,
        issueNote: t.issueNote,
        createdAt: toKSTString(t.createdAt)
      }))
    }, '청소 결제 상세 조회 성공');
  } catch (err) {
    console.error('[adminMoveInPayment.getCleaningDetail] error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

module.exports = { listMoveInPayments, getCleaningPaymentDetail };
