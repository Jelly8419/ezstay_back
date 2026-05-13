/**
 * moveInCleaningController.js
 * 청소 신청/취소 + 청소 결제 (임대인)
 *
 * PRD 7절 (PG 결제 Flow):
 *  - 7.1 결제 조건: 청소 신청됨 + 청소용품 구비 + 청소 상태 PAYMENT_PENDING
 *  - 7.2 결제 진입: PG 결제창 호출 페이로드 반환
 *  - 7.3 성공: cleaning_status=PAID, MoveInPayment.status=PAID
 *  - 7.4 실패: cleaning_status=PAYMENT_PENDING 유지, MoveInPayment.status=FAILED
 *
 * 결제 방식: PayTag 연동 + Mock fallback (PAYMENT_USE_MOCK=true 시)
 */
const {
  sequelize,
  MoveInCase,
  MoveInPayment
} = require('../models');
const { ErrorCodes, success, error, created } = require('../utils/responseHelper');
const cryptoHelper = require('../utils/cryptoHelper');
const { calculateCleaningPrice } = require('../utils/moveInCleaningPriceCalculator');
const { generateMoveInOrderId } = require('../utils/orderIdGenerator');
const paytagClient = require('../utils/paytagClient');

const USE_MOCK = process.env.PAYMENT_USE_MOCK === 'true';

/**
 * 케이스 + 본인 검증 + 스냅샷 평수 추출 헬퍼
 * @returns {Promise<{ caseRow, areaPyeong, suppliesAvailable }|null>}
 */
async function loadCaseForCleaning(caseId, hostId, transaction = null) {
  const opts = transaction ? { transaction } : {};
  const caseRow = await MoveInCase.findOne({
    where: { id: caseId, hostId },
    ...opts
  });
  if (!caseRow) return null;

  const snapshot = caseRow.roomSnapshot || {};
  return {
    caseRow,
    areaPyeong: Number(snapshot.areaPyeong),
    suppliesAvailable: !!snapshot.cleaningSuppliesAvailable
  };
}

/**
 * POST /api/host/move-in/cases/:caseId/cleaning/quote
 * 청소비 견적 (서버 산정)
 * - 결제 전 미리보기용. DB 변경 없음.
 */
const getCleaningQuote = async (req, res) => {
  try {
    const hostId = req.user.id;
    const { caseId } = req.params;

    const loaded = await loadCaseForCleaning(caseId, hostId);
    if (!loaded) {
      return error(res, ErrorCodes.NOT_FOUND, 404, '케이스를 찾을 수 없습니다.');
    }

    const { areaPyeong, suppliesAvailable } = loaded;
    if (!suppliesAvailable) {
      return error(
        res,
        ErrorCodes.VALIDATION_ERROR,
        400,
        '청소용품이 구비되어 있지 않은 방은 청소 서비스를 신청할 수 없습니다.'
      );
    }

    const cleaningFee = calculateCleaningPrice(areaPyeong);
    return success(res, {
      areaPyeong,
      cleaningFee,
      formula: '10평 이하 50,000원, 이후 10평 단위 +20,000원'
    });
  } catch (err) {
    console.error('청소 견적 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * POST /api/host/move-in/cases/:caseId/cleaning/request
 * 청소 신청
 * - cleaning_status: NOT_REQUESTED | CANCELLED → PAYMENT_PENDING
 * - cleaning_fee 락인 (스냅샷 평수 기준)
 */
const requestCleaning = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const hostId = req.user.id;
    const { caseId } = req.params;

    const loaded = await loadCaseForCleaning(caseId, hostId, transaction);
    if (!loaded) {
      await transaction.rollback();
      return error(res, ErrorCodes.NOT_FOUND, 404, '케이스를 찾을 수 없습니다.');
    }

    const { caseRow, areaPyeong, suppliesAvailable } = loaded;

    if (!suppliesAvailable) {
      await transaction.rollback();
      return error(
        res,
        ErrorCodes.VALIDATION_ERROR,
        400,
        '청소용품이 구비되어 있지 않습니다.'
      );
    }

    if (!['NOT_REQUESTED', 'CANCELLED'].includes(caseRow.cleaningStatus)) {
      await transaction.rollback();
      return error(
        res,
        ErrorCodes.VALIDATION_ERROR,
        400,
        `현재 청소 상태(${caseRow.cleaningStatus})에서는 신청할 수 없습니다.`
      );
    }

    const cleaningFee = calculateCleaningPrice(areaPyeong);
    await caseRow.update({
      cleaningStatus: 'PAYMENT_PENDING',
      cleaningFee
    }, { transaction });

    await transaction.commit();
    return success(res, {
      caseId: caseRow.id,
      cleaningStatus: caseRow.cleaningStatus,
      cleaningFee
    }, '청소 서비스가 신청되었습니다. 결제를 진행해주세요.');
  } catch (err) {
    await transaction.rollback();
    console.error('청소 신청 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * DELETE /api/host/move-in/cases/:caseId/cleaning/request
 * 청소 신청 취소
 * - cleaning_status: PAYMENT_PENDING → CANCELLED
 * - PAID 상태는 취소 불가 (별도 환불 흐름 필요)
 */
const cancelCleaning = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const hostId = req.user.id;
    const { caseId } = req.params;

    const caseRow = await MoveInCase.findOne({
      where: { id: caseId, hostId },
      transaction
    });
    if (!caseRow) {
      await transaction.rollback();
      return error(res, ErrorCodes.NOT_FOUND, 404, '케이스를 찾을 수 없습니다.');
    }

    if (caseRow.cleaningStatus !== 'PAYMENT_PENDING') {
      await transaction.rollback();
      return error(
        res,
        ErrorCodes.VALIDATION_ERROR,
        400,
        `현재 청소 상태(${caseRow.cleaningStatus})에서는 취소할 수 없습니다. 결제 완료된 건은 환불을 요청해주세요.`
      );
    }

    // PAYMENT_PENDING 상태에서 PENDING 결제가 남아있으면 같이 CANCELLED 처리
    await MoveInPayment.update(
      { status: 'CANCELLED' },
      { where: { caseId: caseRow.id, status: 'PENDING' }, transaction }
    );

    await caseRow.update({
      cleaningStatus: 'CANCELLED',
      cleaningFee: null
    }, { transaction });

    await transaction.commit();
    return success(res, {
      caseId: caseRow.id,
      cleaningStatus: caseRow.cleaningStatus
    }, '청소 신청이 취소되었습니다.');
  } catch (err) {
    await transaction.rollback();
    console.error('청소 취소 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * POST /api/host/move-in/cases/:caseId/cleaning/payment/init
 * 결제 시작 — PG 결제창 호출 페이로드 반환
 *
 * 1. 결제 조건 검증 (PRD 7.1)
 * 2. MoveInPayment(PENDING) 생성 + orderId 발급
 * 3. 클라이언트 SDK용 페이로드 반환 (orderId, amount, shopcode 등)
 */
const initCleaningPayment = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const hostId = req.user.id;
    const { caseId } = req.params;

    const loaded = await loadCaseForCleaning(caseId, hostId, transaction);
    if (!loaded) {
      await transaction.rollback();
      return error(res, ErrorCodes.NOT_FOUND, 404, '케이스를 찾을 수 없습니다.');
    }

    const { caseRow, suppliesAvailable } = loaded;

    // PRD 7.1 결제 조건
    if (!suppliesAvailable) {
      await transaction.rollback();
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, '청소용품이 구비되어 있지 않습니다.');
    }
    if (caseRow.cleaningStatus !== 'PAYMENT_PENDING') {
      await transaction.rollback();
      return error(
        res,
        ErrorCodes.PAYMENT_NOT_AVAILABLE,
        400,
        `결제 가능한 상태가 아닙니다. (현재: ${caseRow.cleaningStatus})`
      );
    }
    if (!caseRow.cleaningFee || caseRow.cleaningFee <= 0) {
      await transaction.rollback();
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, '청소비가 산정되지 않았습니다.');
    }

    // 기존 PENDING 결제가 있으면 재사용, 없으면 신규 생성
    let payment = await MoveInPayment.findOne({
      where: { caseId: caseRow.id, status: 'PENDING' },
      transaction
    });

    if (!payment) {
      const orderId = await generateMoveInOrderId(transaction);
      payment = await MoveInPayment.create({
        caseId: caseRow.id,
        hostId,
        orderId,
        amount: caseRow.cleaningFee,
        status: 'PENDING'
      }, { transaction });
    } else if (payment.amount !== caseRow.cleaningFee) {
      // 청소비가 달라진 경우 (드물지만 안전 처리)
      await payment.update({ amount: caseRow.cleaningFee }, { transaction });
    }

    await transaction.commit();

    return created(res, {
      paymentId: payment.id,
      orderId: payment.orderId,
      amount: payment.amount,
      caseId: caseRow.id,
      // PG SDK 호출용 페이로드 (PayTag)
      pgPayload: USE_MOCK
        ? { mock: true, message: 'Mock 모드 — confirm 호출 시 자동 승인' }
        : {
            shopcode: process.env.PAYTAG_SHOPCODE,
            orderId: payment.orderId,
            amount: payment.amount,
            productName: '입주 준비 청소 서비스',
            buyerName: req.user.name || '',
            customerPhone: req.user.phoneNumber || null
          }
    }, '결제 페이로드가 발급되었습니다.');
  } catch (err) {
    await transaction.rollback();
    console.error('청소 결제 시작 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * POST /api/host/move-in/cases/:caseId/cleaning/payment/confirm
 * 결제 승인 (PG 콜백 또는 Mock)
 *
 * Body:
 *   paymentId  : MoveInPayment.id (필수)
 *   recvPayparam : PayTag SDK 콜백 데이터 (실모드 필수)
 *   payType    : CARD 등 (실모드 필수)
 *   simulateFailure : true면 Mock 실패 시뮬레이션 (Mock 모드만)
 */
const confirmCleaningPayment = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const hostId = req.user.id;
    const { caseId } = req.params;
    const { paymentId, recvPayparam, payType, simulateFailure } = req.body;

    if (!paymentId) {
      await transaction.rollback();
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, 'paymentId는 필수입니다.');
    }

    const payment = await MoveInPayment.findOne({
      where: { id: paymentId, caseId, hostId, status: 'PENDING' },
      transaction
    });
    if (!payment) {
      await transaction.rollback();
      return error(res, ErrorCodes.PAYMENT_NOT_FOUND, 404, '결제 대기 상태의 결제를 찾을 수 없습니다.');
    }

    const caseRow = await MoveInCase.findOne({
      where: { id: caseId, hostId },
      transaction
    });
    if (!caseRow || caseRow.cleaningStatus !== 'PAYMENT_PENDING') {
      await transaction.rollback();
      return error(res, ErrorCodes.PAYMENT_NOT_AVAILABLE, 400);
    }

    const now = new Date();
    let pgResponse = null;
    let pgTid = null;
    let pgProvider = USE_MOCK ? 'mock' : 'paytag';
    let pgMethod = null;

    // ── Mock 모드 ──
    if (USE_MOCK) {
      if (simulateFailure) {
        await payment.update({
          status: 'FAILED',
          failedAt: now,
          failureReason: '[MOCK] simulateFailure'
        }, { transaction });
        await transaction.commit();
        return error(res, ErrorCodes.PAYMENT_CONFIRMATION_FAILED, 400, '[MOCK] 결제 실패 시뮬레이션');
      }
      pgTid = `mock_${Date.now()}_${payment.id}`;
      pgMethod = 'CARD';
      pgResponse = { mock: true, paidAt: now.toISOString() };
    }
    // ── 실 PayTag 모드 ──
    else {
      if (!recvPayparam || !payType) {
        await transaction.rollback();
        return error(res, ErrorCodes.VALIDATION_ERROR, 400, 'recvPayparam, payType은 필수입니다.');
      }

      try {
        pgResponse = await paytagClient.confirmPayment({
          recvPayparam,
          payType,
          expectedOrderId: payment.orderId,
          expectedAmount: payment.amount
        });
      } catch (pgErr) {
        await payment.update({
          status: 'FAILED',
          failedAt: now,
          failureReason: pgErr.paytagErrorMessage || pgErr.message,
          pgProvider
        }, { transaction });
        await transaction.commit();
        return error(
          res,
          ErrorCodes.PAYMENT_CONFIRMATION_FAILED,
          400,
          pgErr.paytagErrorMessage || pgErr.message
        );
      }

      pgTid = pgResponse.tran_key || pgResponse.recv_orderno || null;
      pgMethod = paytagClient.mapPaymentMethod(payType);
    }

    // ── 성공 처리 (트랜잭션 안에서 원자적) ──
    await payment.update({
      status: 'PAID',
      paidAt: now,
      pgProvider,
      pgTid,
      pgMethod
    }, { transaction });

    await caseRow.update({
      cleaningStatus: 'PAID',
      cleaningPaidAt: now
    }, { transaction });

    await transaction.commit();

    return success(res, {
      paymentId: payment.id,
      orderId: payment.orderId,
      caseId: caseRow.id,
      cleaningStatus: caseRow.cleaningStatus,
      paidAt: now,
      pgTid,
      mock: USE_MOCK
    }, '청소 결제가 완료되었습니다.');
  } catch (err) {
    await transaction.rollback();
    console.error('청소 결제 승인 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

module.exports = {
  getCleaningQuote,
  requestCleaning,
  cancelCleaning,
  initCleaningPayment,
  confirmCleaningPayment
};
