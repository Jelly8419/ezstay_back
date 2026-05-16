/**
 * guestMoveInPaymentController.js
 * 입주 준비 서비스 — 임차인 옵션 결제 (INITIAL)
 *
 * Routes:
 *   POST /api/guest/move-in/requests/:caseId/payment/init      # 주문 생성 + PG 페이로드 발급
 *   POST /api/guest/move-in/requests/:caseId/payment/confirm   # PG 승인 처리
 *
 * 가드:
 *   - 본인 케이스만 (guestUserId = req.user.id)
 *   - phone 일치 (req.user.phoneNumber == case.guestPhone)
 *   - D-5 결제 마감 (입주일 -5일 KST 23:59:59)
 *   - 케이스당 PENDING 주문 1건만 허용
 *   - 옵션 가격 서버 산정 (클라 amount 무시)
 *   - 옵션 활성/재고 검증
 *
 * 결제 방식: PayTag 연동 + Mock fallback (PAYMENT_USE_MOCK=true)
 */

'use strict';

const {
  sequelize,
  MoveInCase,
  MoveInOption,
  MoveInGuestOrder,
  MoveInGuestOrderItem,
  MoveInGuestPayment,
  MoveInGuestOrderLog,
  MoveInGuestRefundRequest
} = require('../models');
const {
  ErrorCodes,
  success,
  error,
  created
} = require('../utils/responseHelper');
const { isSamePhone } = require('../utils/phoneHelper');
const { isPayable } = require('../utils/moveInGuestPaymentGuard');
const { serializeGuestCase, serializeGuestOrder } = require('../utils/moveInGuestSerializer');
const { toKSTString } = require('../utils/dateHelper');
const NotificationService = require('../services/notificationService');
const paytagClient = require('../utils/paytagClient');
const {
  calculateOrderTotal,
  validateGuestStock,
  createPendingOrder,
  findExistingPendingOrder,
  findPaidInitialOrder
} = require('../services/moveInGuestOrderService');
const {
  evaluateGuestCancel,
  evaluateGuestReturn
} = require('../utils/moveInRefundPolicy');

const USE_MOCK = process.env.PAYMENT_USE_MOCK === 'true';

/**
 * 본인 케이스 + phone 매칭 + 결제 가능성 가드.
 * 실패 시 res 응답까지 처리하고 null 반환.
 */
async function loadEligibleCase(req, res, transaction) {
  const userId = req.user.id;
  const { caseId } = req.params;

  const caseRow = await MoveInCase.findOne({
    where: { id: caseId, guestUserId: userId },
    transaction
  });
  if (!caseRow) {
    error(res, ErrorCodes.MOVE_IN_GUEST_CASE_NOT_FOUND, 404);
    return null;
  }
  if (!isSamePhone(req.user.phoneNumber, caseRow.guestPhone)) {
    error(res, ErrorCodes.MOVE_IN_GUEST_PHONE_MISMATCH, 403);
    return null;
  }
  if (!isPayable(caseRow.checkInDate)) {
    error(res, ErrorCodes.MOVE_IN_GUEST_PAYMENT_DEADLINE_PASSED, 400);
    return null;
  }
  return caseRow;
}

/**
 * 주문 생성 (INITIAL/ADDITIONAL 공통 본체).
 *
 * 동작:
 *   1. 케이스/phone/D-5 가드
 *   2. ADDITIONAL 인 경우 결제 완료된 INITIAL 주문 존재 검증 (정책 #4)
 *   3. items 서버 산정
 *   4. 재고 검증
 *   5. 케이스당 PENDING 주문 1건 제한
 *   6. PENDING 주문 + 라인 + 결제 생성 (트랜잭션)
 *   7. PG 페이로드 반환
 */
async function runInit(req, res, orderType) {
  const transaction = await sequelize.transaction();
  try {
    const caseRow = await loadEligibleCase(req, res, transaction);
    if (!caseRow) {
      await transaction.rollback();
      return;
    }

    // ADDITIONAL: 결제 완료된 INITIAL 주문이 있어야만 진입 가능 (정책 #4)
    if (orderType === 'ADDITIONAL') {
      const paidInitial = await findPaidInitialOrder(caseRow.id, transaction);
      if (!paidInitial) {
        await transaction.rollback();
        return error(
          res,
          ErrorCodes.MOVE_IN_GUEST_ORDER_NOT_PAYABLE,
          400,
          '추가 결제는 최초 결제 완료 후에 가능합니다.'
        );
      }
    }

    const { items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      await transaction.rollback();
      return error(res, ErrorCodes.MOVE_IN_GUEST_OPTION_REQUIRED, 400);
    }

    // 1. 가격 서버 산정
    const calc = await calculateOrderTotal(items, transaction);
    if (calc.errors.length > 0) {
      await transaction.rollback();
      const first = calc.errors[0];
      const codeMap = {
        NO_ITEMS:        ErrorCodes.MOVE_IN_GUEST_OPTION_REQUIRED,
        INVALID_OPTION_ID: ErrorCodes.VALIDATION_ERROR,
        INVALID_QUANTITY:  ErrorCodes.VALIDATION_ERROR,
        NOT_FOUND:       ErrorCodes.MOVE_IN_GUEST_OPTION_NOT_FOUND,
        INACTIVE:        ErrorCodes.MOVE_IN_GUEST_OPTION_UNAVAILABLE
      };
      return error(res, codeMap[first.reason] || ErrorCodes.VALIDATION_ERROR, 400, calc.errors);
    }
    if (calc.totalAmount <= 0) {
      await transaction.rollback();
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, '결제 금액은 0원 초과여야 합니다.');
    }

    // 2. 재고 검증
    const stock = await validateGuestStock(calc.lines, transaction);
    if (!stock.ok) {
      await transaction.rollback();
      return error(res, ErrorCodes.MOVE_IN_GUEST_STOCK_INSUFFICIENT, 400, stock.unavailable);
    }

    // 3. 동일 케이스 PENDING 주문 1건만
    const existingPending = await findExistingPendingOrder(caseRow.id, transaction);
    if (existingPending) {
      await transaction.rollback();
      return error(res, ErrorCodes.MOVE_IN_GUEST_PENDING_ORDER_EXISTS, 409, {
        pendingOrderId: existingPending.id,
        pendingOrderNumber: existingPending.orderId
      });
    }

    // 4. 주문 생성
    const { order, payment } = await createPendingOrder({
      caseId: caseRow.id,
      guestUserId: req.user.id,
      checkInDate: caseRow.checkInDate,
      orderType,
      lines: calc.lines,
      totalAmount: calc.totalAmount
    }, transaction);

    await transaction.commit();

    return created(res, {
      orderId: order.orderId,
      orderDbId: order.id,
      orderType,
      paymentId: payment.id,
      amount: payment.amount,
      caseId: caseRow.id,
      pgPayload: USE_MOCK
        ? { mock: true, message: 'Mock 모드 — confirm 호출 시 자동 승인' }
        : {
            shopcode: process.env.PAYTAG_SHOPCODE,
            orderId: order.orderId,
            amount: payment.amount,
            productName: orderType === 'ADDITIONAL' ? '입주 준비 옵션 (추가)' : '입주 준비 옵션',
            buyerName: req.user.name || '',
            customerPhone: req.user.phoneNumber || null
          }
    }, '결제 페이로드가 발급되었습니다.');
  } catch (err) {
    if (!transaction.finished) await transaction.rollback();
    console.error(`[guestMoveInPayment.init/${orderType}] error:`, err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
}

/**
 * POST /api/guest/move-in/requests/:caseId/payment/init  (INITIAL)
 */
const initPayment = (req, res) => runInit(req, res, 'INITIAL');

/**
 * POST /api/guest/move-in/requests/:caseId/additional/init  (ADDITIONAL)
 */
const initAdditionalPayment = (req, res) => runInit(req, res, 'ADDITIONAL');

/**
 * POST /api/guest/move-in/requests/:caseId/payment/confirm
 * Body:
 *   paymentId         (필수) - MoveInGuestPayment.id
 *   recvPayparam      (실모드) - PayTag SDK 콜백
 *   payType           (실모드) - 결제 수단
 *   simulateFailure   (Mock) - 실패 시뮬레이션
 *
 * 성공: 주문 PAID, 결제 PAID, 로그 + 응답
 * 실패: 결제 FAILED 만, 주문 PENDING 유지 (재시도 가능)
 */
const confirmPayment = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const caseRow = await loadEligibleCase(req, res, transaction);
    if (!caseRow) {
      await transaction.rollback();
      return;
    }

    const { paymentId, recvPayparam, payType, simulateFailure } = req.body || {};
    if (!paymentId) {
      await transaction.rollback();
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, 'paymentId는 필수입니다.');
    }

    const payment = await MoveInGuestPayment.findOne({
      where: {
        id: paymentId,
        caseId: caseRow.id,
        guestUserId: req.user.id,
        status: 'PENDING'
      },
      transaction
    });
    if (!payment) {
      await transaction.rollback();
      return error(res, ErrorCodes.MOVE_IN_GUEST_PAYMENT_NOT_FOUND, 404);
    }

    const order = await MoveInGuestOrder.findOne({
      where: { id: payment.guestOrderId, status: 'PENDING' },
      transaction
    });
    if (!order) {
      await transaction.rollback();
      return error(res, ErrorCodes.MOVE_IN_GUEST_ORDER_NOT_PAYABLE, 400);
    }

    // 금액 무결성 (주문 ↔ 결제)
    if (payment.amount !== order.totalAmount) {
      await transaction.rollback();
      return error(res, ErrorCodes.MOVE_IN_GUEST_AMOUNT_MISMATCH, 400);
    }

    const now = new Date();
    let pgTid = null;
    const pgProvider = USE_MOCK ? 'mock' : 'paytag';
    let pgMethod = null;

    // ── Mock 모드 ──
    if (USE_MOCK) {
      if (simulateFailure) {
        await payment.update({
          status: 'FAILED',
          failedAt: now,
          failureReason: '[MOCK] simulateFailure',
          pgProvider
        }, { transaction });
        await MoveInGuestOrderLog.createLog({
          guestOrderId: order.id,
          caseId: caseRow.id,
          actor: 'GUEST',
          actorId: req.user.id,
          action: 'PAYMENT_FAILED',
          amountChange: 0,
          balanceAfter: 0,
          description: '[MOCK] simulateFailure',
          req
        }, transaction);
        await transaction.commit();
        return error(res, ErrorCodes.PAYMENT_CONFIRMATION_FAILED, 400, '[MOCK] 결제 실패 시뮬레이션');
      }
      pgTid = `mock_${Date.now()}_${payment.id}`;
      pgMethod = 'CARD';
    }
    // ── 실 PayTag 모드 ──
    else {
      if (!recvPayparam || !payType) {
        await transaction.rollback();
        return error(res, ErrorCodes.VALIDATION_ERROR, 400, 'recvPayparam, payType은 필수입니다.');
      }
      try {
        const pgResponse = await paytagClient.confirmPayment({
          recvPayparam,
          payType,
          expectedOrderId: order.orderId,
          expectedAmount: payment.amount
        });
        pgTid = pgResponse.tran_key || pgResponse.recv_orderno || null;
        pgMethod = paytagClient.mapPaymentMethod(payType);
      } catch (pgErr) {
        await payment.update({
          status: 'FAILED',
          failedAt: now,
          failureReason: pgErr.paytagErrorMessage || pgErr.message,
          pgProvider
        }, { transaction });
        await MoveInGuestOrderLog.createLog({
          guestOrderId: order.id,
          caseId: caseRow.id,
          actor: 'GUEST',
          actorId: req.user.id,
          action: 'PAYMENT_FAILED',
          amountChange: 0,
          balanceAfter: 0,
          description: pgErr.paytagErrorMessage || pgErr.message,
          req
        }, transaction);
        await transaction.commit();
        return error(
          res,
          ErrorCodes.PAYMENT_CONFIRMATION_FAILED,
          400,
          pgErr.paytagErrorMessage || pgErr.message
        );
      }
    }

    // ── 성공 처리 ──
    await payment.update({
      status: 'PAID',
      paidAt: now,
      pgProvider,
      pgTid,
      pgMethod
    }, { transaction });

    await order.update({
      status: 'PAID',
      paidAmount: order.totalAmount,
      paymentKey: pgTid,
      paymentMethod: pgMethod,
      paidAt: now
    }, { transaction });

    await MoveInGuestOrderLog.createLog({
      guestOrderId: order.id,
      caseId: caseRow.id,
      actor: 'GUEST',
      actorId: req.user.id,
      action: 'PAYMENT_SUCCESS',
      amountChange: order.totalAmount,
      balanceAfter: order.totalAmount,
      metadata: { pgProvider, pgMethod, mock: USE_MOCK },
      req
    }, transaction);

    await transaction.commit();

    // 결제 완료 인앱 알림 (best-effort — 실패가 결제 성공을 막으면 안 됨)
    // TODO: 알리고 알림톡 템플릿 등록 후 외부 발송 추가
    try {
      await NotificationService.create({
        userId: req.user.id,
        userMode: 'guest',
        type: 'MOVE_IN_PAYMENT_COMPLETED',
        title: '입주 준비 결제 완료',
        message: `선택하신 입주 준비 옵션 결제가 완료되었습니다. (주문번호 ${order.orderId})`,
        metadata: {
          caseId: caseRow.id,
          orderId: order.orderId,
          orderDbId: order.id,
          paymentId: payment.id,
          amount: order.totalAmount,
          orderType: order.orderType
        }
      });
    } catch (notifyErr) {
      console.error('[guestMoveInPayment.confirm] notification create failed:', notifyErr.message);
    }

    return success(res, {
      paymentId: payment.id,
      orderId: order.orderId,
      orderDbId: order.id,
      caseId: caseRow.id,
      orderStatus: 'PAID',
      paidAt: now,
      pgTid,
      mock: USE_MOCK
    }, '결제가 완료되었습니다.');
  } catch (err) {
    if (!transaction.finished) await transaction.rollback();
    console.error('[guestMoveInPayment.confirm] error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * DELETE /api/guest/move-in/orders/:orderId
 * 미결제(PENDING) 주문 취소.
 *
 * 동작:
 *   1. 본인 주문 (guestUserId = req.user.id) 만 취소 가능
 *   2. PENDING 주문만 (PAID 는 별도 환불 흐름 — V2)
 *   3. PENDING 결제(들) 도 동반 CANCELLED
 *   4. 라인 status=CANCELLED + cancelledAt 기록
 *   5. ORDER_CANCELLED 로그
 *
 * NOTE:
 *   - URL 파라미터 :orderId 는 DB id (정수). 비즈니스 orderId(YYMMDD-G####) 가 아님.
 *   - 라우트 정의가 /orders/:orderId 라 케이스 컨텍스트 없이 직접 접근.
 */
const cancelPendingOrder = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const userId = req.user.id;
    const { orderId } = req.params;

    const orderDbId = parseInt(orderId, 10);
    if (!Number.isInteger(orderDbId) || orderDbId <= 0) {
      await transaction.rollback();
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, 'orderId는 정수여야 합니다.');
    }

    const order = await MoveInGuestOrder.findOne({
      where: { id: orderDbId, guestUserId: userId },
      transaction
    });
    if (!order) {
      await transaction.rollback();
      return error(res, ErrorCodes.MOVE_IN_GUEST_ORDER_NOT_FOUND, 404);
    }

    if (order.status !== 'PENDING') {
      await transaction.rollback();
      return error(res, ErrorCodes.MOVE_IN_GUEST_ORDER_NOT_CANCELLABLE, 400, {
        currentStatus: order.status
      });
    }

    const now = new Date();

    // 1. 라인 모두 CANCELLED
    await MoveInGuestOrderItem.update(
      { status: 'CANCELLED', cancelledAt: now, cancelReason: 'GUEST_CANCELLED_PENDING' },
      { where: { guestOrderId: order.id, status: 'ACTIVE' }, transaction }
    );

    // 2. PENDING 결제(들) 동반 CANCELLED
    await MoveInGuestPayment.update(
      { status: 'CANCELLED' },
      { where: { guestOrderId: order.id, status: 'PENDING' }, transaction }
    );

    // 3. 주문 자체 CANCELLED
    await order.update({ status: 'CANCELLED' }, { transaction });

    // 4. 로그
    await MoveInGuestOrderLog.createLog({
      guestOrderId: order.id,
      caseId: order.caseId,
      actor: 'GUEST',
      actorId: userId,
      action: 'ORDER_CANCELLED',
      amountChange: 0,
      balanceAfter: 0,
      description: '미결제 주문 임차인 취소',
      req
    }, transaction);

    await transaction.commit();

    return success(res, {
      orderDbId: order.id,
      orderId: order.orderId,
      status: 'CANCELLED',
      cancelledAt: now
    }, '미결제 주문이 취소되었습니다.');
  } catch (err) {
    if (!transaction.finished) await transaction.rollback();
    console.error('[guestMoveInPayment.cancel] error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * GET /api/guest/move-in/payments/:paymentId
 * 결제 결과 조회 (PRD 6.7 / 13.6 — 결제 완료 화면용)
 *
 * 응답:
 *   - 결제 정보 (orderId, amount, status, paidAt, pgMethod 등)
 *   - 주문 정보 (라인, 배송 상태)
 *   - 케이스 요약 (방 이름/주소/입주일/퇴실일) — 청소 정보 차단
 *
 * 본인 결제만 조회 가능.
 */
const getPaymentResult = async (req, res) => {
  try {
    const userId = req.user.id;
    const { paymentId } = req.params;

    const paymentDbId = parseInt(paymentId, 10);
    if (!Number.isInteger(paymentDbId) || paymentDbId <= 0) {
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, 'paymentId는 정수여야 합니다.');
    }

    const payment = await MoveInGuestPayment.findOne({
      where: { id: paymentDbId, guestUserId: userId },
      include: [{
        model: MoveInGuestOrder,
        as: 'order',
        include: [
          {
            model: MoveInGuestOrderItem,
            as: 'items',
            include: [{ model: MoveInOption, as: 'option' }]
          },
          { model: MoveInCase, as: 'case' }
        ]
      }]
    });

    if (!payment) {
      return error(res, ErrorCodes.MOVE_IN_GUEST_PAYMENT_NOT_FOUND, 404);
    }

    const order = payment.order;
    const caseRow = order?.case;

    if (!order || !caseRow) {
      return error(res, ErrorCodes.MOVE_IN_GUEST_PAYMENT_NOT_FOUND, 404);
    }

    // 청소 정보 차단된 케이스 요약
    const caseSummary = serializeGuestCase(caseRow, {
      includeSensitive: true,
      guestOrders: [{ status: order.status, deliveryStatus: order.deliveryStatus }]
    });

    return success(res, {
      payment: {
        paymentId: payment.id,
        orderId: payment.orderId,
        amount: payment.amount,
        status: payment.status,
        pgProvider: payment.pgProvider,
        pgMethod: payment.pgMethod,
        pgTid: payment.pgTid,
        paidAt: toKSTString(payment.paidAt),
        failedAt: toKSTString(payment.failedAt),
        failureReason: payment.failureReason
      },
      order: serializeGuestOrder(order),
      case: caseSummary
    }, '결제 정보를 조회했습니다.');
  } catch (err) {
    console.error('[guestMoveInPayment.getResult] error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * MoveInGuestPayment → PayTag cancelPayment 파라미터.
 * MoveInGuestPayment 에는 paymentResponse 가 없어 직접 구성.
 *   - orderno    = 우리 주문번호 (order.orderId)
 *   - orgpaydate = 결제 완료일 YYYYMMDD (KST)
 *   - orgtranamt = 원결제 금액
 *   - loginid    = env 폴백 (paytagClient 내부에서 PAYTAG_LOGIN_ID 사용)
 */
function buildGuestCancelParams(order, payment) {
  const paidAt = payment.paidAt ? new Date(payment.paidAt) : new Date();
  // KST 기준 YYYYMMDD (process.env.TZ=Asia/Seoul 전제)
  const y = paidAt.getFullYear();
  const m = String(paidAt.getMonth() + 1).padStart(2, '0');
  const d = String(paidAt.getDate()).padStart(2, '0');
  return {
    orderno: order.orderId,
    orgpaydate: `${y}${m}${d}`,
    orgtranamt: payment.amount
  };
}

/**
 * POST /api/guest/move-in/orders/:orderId/cancel
 * 결제 완료 옵션 주문 "취소" (즉시 환불, 관리자 승인 X)
 *
 * 정책 (moveInRefundPolicy.evaluateGuestCancel):
 *   - 결제완료 ~ 입주 D-5 전: 전액 취소
 *   - 입주 D-5 이후 ~ 입주일 전: 배송 전(deliveryStatus=PENDING)만
 *   - 입주일 이후: 불가 (반품 이용)
 *
 * PG-First 패턴: 검증 → 트랜잭션 rollback → PG 취소 → 새 트랜잭션 DB 반영.
 */
const cancelPaidOrder = async (req, res) => {
  const preTx = await sequelize.transaction();
  try {
    const userId = req.user.id;
    const { orderId } = req.params;
    const { reason } = req.body || {};

    const orderDbId = parseInt(orderId, 10);
    if (!Number.isInteger(orderDbId) || orderDbId <= 0) {
      await preTx.rollback();
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, 'orderId는 정수여야 합니다.');
    }

    const order = await MoveInGuestOrder.findOne({
      where: { id: orderDbId, guestUserId: userId },
      include: [{ model: MoveInCase, as: 'case' }],
      transaction: preTx
    });
    if (!order) {
      await preTx.rollback();
      return error(res, ErrorCodes.MOVE_IN_GUEST_ORDER_NOT_FOUND, 404);
    }

    const caseRow = order.case;
    if (!caseRow || !isSamePhone(req.user.phoneNumber, caseRow.guestPhone)) {
      await preTx.rollback();
      return error(res, ErrorCodes.MOVE_IN_GUEST_PHONE_MISMATCH, 403);
    }

    const activeItems = await MoveInGuestOrderItem.findAll({
      where: { guestOrderId: order.id, status: 'ACTIVE' },
      transaction: preTx
    });
    if (activeItems.length === 0) {
      await preTx.rollback();
      return error(res, ErrorCodes.MOVE_IN_GUEST_ORDER_NOT_CANCELLABLE, 400, {
        reason: '취소할 활성 라인이 없습니다.'
      });
    }
    const orderTotalAmount = activeItems.reduce((s, it) => s + Number(it.totalPrice), 0);

    const verdict = evaluateGuestCancel({
      checkInDate: caseRow.checkInDate,
      checkOutDate: caseRow.checkOutDate,
      orderStatus: order.status,
      deliveryStatus: order.deliveryStatus,
      orderTotalAmount
    });
    if (!verdict.allowed) {
      await preTx.rollback();
      return error(res, ErrorCodes.MOVE_IN_GUEST_REFUND_NOT_ALLOWED, 400, { reason: verdict.reason });
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

    // 검증 완료 → 트랜잭션 닫고 PG 취소 먼저
    await preTx.rollback();

    if (!isMock) {
      const { orderno, orgpaydate, orgtranamt } = buildGuestCancelParams(order, payment);
      try {
        await paytagClient.cancelPayment({
          orderno,
          orgpaydate,
          orgtranamt,
          cancelamt: verdict.refundAmount,
          canceltype: '0'
        });
      } catch (pgErr) {
        if (pgErr.paytagErrorCode === '1023') {
          return error(res, { code: 4901, message: '이미 취소 완료된 결제입니다.' }, 400);
        }
        console.error('[guestMoveInPayment.cancelPaid] PayTag 오류:', pgErr.message);
        return error(res, { code: 4900, message: `PG 취소 실패: ${pgErr.paytagErrorMessage || pgErr.message}` }, 502);
      }
    }

    // PG 성공 → DB 반영
    const tx = await sequelize.transaction();
    try {
      const now = new Date();
      await MoveInGuestOrderItem.update(
        { status: 'CANCELLED', cancelledAt: now, cancelReason: reason || '임차인 옵션 취소', refundAmount: sequelize.literal('total_price') },
        { where: { guestOrderId: order.id, status: 'ACTIVE' }, transaction: tx }
      );
      await payment.update({
        status: 'CANCELLED',
        failedAt: now,
        failureReason: '임차인 옵션 취소 환불'
      }, { transaction: tx });
      await order.update({
        status: 'FULLY_REFUNDED',
        refundedAmount: Number(order.refundedAmount || 0) + verdict.refundAmount
      }, { transaction: tx });

      await MoveInGuestOrderLog.createLog({
        guestOrderId: order.id,
        caseId: order.caseId,
        actor: 'GUEST',
        actorId: userId,
        action: 'ORDER_REFUNDED',
        amountChange: -verdict.refundAmount,
        balanceAfter: 0,
        metadata: {
          refundAmount: verdict.refundAmount,
          shippingDeduction: verdict.shippingDeduction,
          mock: isMock
        },
        description: reason || '임차인 옵션 취소',
        req
      }, tx);

      await tx.commit();
    } catch (dbErr) {
      await tx.rollback();
      console.error('[guestMoveInPayment.cancelPaid] DB 반영 실패 (PG는 이미 취소됨):', dbErr);
      return error(res, ErrorCodes.INTERNAL_ERROR, 500, 'PG 취소는 완료됐으나 DB 반영에 실패했습니다. 관리자에게 문의하세요.');
    }

    return success(res, {
      orderDbId: order.id,
      orderId: order.orderId,
      status: 'FULLY_REFUNDED',
      refundAmount: verdict.refundAmount,
      shippingDeduction: verdict.shippingDeduction
    }, '옵션 주문이 취소되어 환불 처리되었습니다.');
  } catch (err) {
    if (!preTx.finished) await preTx.rollback();
    console.error('[guestMoveInPayment.cancelPaid] error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * POST /api/guest/move-in/orders/:orderId/return
 * 결제 완료 + 배송 완료 옵션 주문 "반품 요청" (관리자 승인 대상)
 *
 * 정책 (moveInRefundPolicy.evaluateGuestReturn):
 *   - 입주일 ~ 퇴실일, deliveryStatus=DELIVERED 만
 *   - 케이스당 PENDING 반품요청 1건 제한
 *   - 실제 환불(왕복배송비 차감)은 관리자 승인 시 확정
 */
const requestReturn = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const userId = req.user.id;
    const { orderId } = req.params;
    const { reason } = req.body || {};

    const orderDbId = parseInt(orderId, 10);
    if (!Number.isInteger(orderDbId) || orderDbId <= 0) {
      await transaction.rollback();
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, 'orderId는 정수여야 합니다.');
    }

    const order = await MoveInGuestOrder.findOne({
      where: { id: orderDbId, guestUserId: userId },
      include: [{ model: MoveInCase, as: 'case' }],
      transaction
    });
    if (!order) {
      await transaction.rollback();
      return error(res, ErrorCodes.MOVE_IN_GUEST_ORDER_NOT_FOUND, 404);
    }

    const caseRow = order.case;
    if (!caseRow || !isSamePhone(req.user.phoneNumber, caseRow.guestPhone)) {
      await transaction.rollback();
      return error(res, ErrorCodes.MOVE_IN_GUEST_PHONE_MISMATCH, 403);
    }

    const verdict = evaluateGuestReturn({
      checkInDate: caseRow.checkInDate,
      checkOutDate: caseRow.checkOutDate,
      orderStatus: order.status,
      deliveryStatus: order.deliveryStatus
    });
    if (!verdict.allowed) {
      await transaction.rollback();
      return error(res, ErrorCodes.MOVE_IN_GUEST_REFUND_NOT_ALLOWED, 400, { reason: verdict.reason });
    }

    // 케이스당 PENDING 반품요청 1건 제한
    const existing = await MoveInGuestRefundRequest.findOne({
      where: { guestOrderId: order.id, status: 'PENDING' },
      transaction
    });
    if (existing) {
      await transaction.rollback();
      return error(res, ErrorCodes.MOVE_IN_GUEST_RETURN_ALREADY_REQUESTED, 409, {
        refundRequestId: existing.id
      });
    }

    const activeItems = await MoveInGuestOrderItem.findAll({
      where: { guestOrderId: order.id, status: 'ACTIVE' },
      transaction
    });
    if (activeItems.length === 0) {
      await transaction.rollback();
      return error(res, ErrorCodes.MOVE_IN_GUEST_ORDER_NOT_CANCELLABLE, 400, {
        reason: '반품할 활성 라인이 없습니다.'
      });
    }
    const itemTotalAmount = activeItems.reduce((s, it) => s + Number(it.totalPrice), 0);

    // 활성 라인 → RETURN_REQUESTED
    await MoveInGuestOrderItem.update(
      { status: 'RETURN_REQUESTED', cancelReason: reason || '임차인 반품 요청' },
      { where: { guestOrderId: order.id, status: 'ACTIVE' }, transaction }
    );

    const refundRequest = await MoveInGuestRefundRequest.create({
      guestOrderId: order.id,
      caseId: order.caseId,
      requestedBy: userId,
      status: 'PENDING',
      returnReason: reason || '임차인 반품 요청',
      deliveryStatusSnapshot: order.deliveryStatus,
      itemTotalAmount
    }, { transaction });

    await MoveInGuestOrderLog.createLog({
      guestOrderId: order.id,
      caseId: order.caseId,
      actor: 'GUEST',
      actorId: userId,
      action: 'RETURN_REQUESTED',
      amountChange: 0,
      balanceAfter: 0,
      metadata: { refundRequestId: refundRequest.id, itemTotalAmount },
      description: reason || '임차인 반품 요청',
      req
    }, transaction);

    await transaction.commit();

    return success(res, {
      refundRequestId: refundRequest.id,
      orderDbId: order.id,
      orderId: order.orderId,
      status: 'PENDING',
      itemTotalAmount
    }, '반품 요청이 접수되었습니다. 관리자 승인 후 환불 처리됩니다.');
  } catch (err) {
    if (!transaction.finished) await transaction.rollback();
    console.error('[guestMoveInPayment.requestReturn] error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

module.exports = {
  initPayment,
  confirmPayment,
  // ADDITIONAL — INITIAL 과 동일 본체 + orderType 만 다름.
  // confirm 은 INITIAL/ADDITIONAL 분기 불필요해 동일 핸들러 별칭으로 노출.
  initAdditionalPayment,
  confirmAdditionalPayment: confirmPayment,
  cancelPendingOrder,
  cancelPaidOrder,
  requestReturn,
  getPaymentResult
};
