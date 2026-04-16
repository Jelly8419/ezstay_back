const { Op } = require('sequelize');
const paytagClient = require('../utils/paytagClient');
const {
  sequelize,
  Contract,
  Payment,
  RentalOrder,
  RentalOrderItem,
  RentalOrderLog,
  RentalOrderRefundRequest,
  RentalItem,
  RentalItemReservation,
  RentalPayment,
  RentalPaymentFailureLog,
  Room,
  User
} = require('../models');
const { success, error, ErrorCodes } = require('../utils/responseHelper');
const {
  checkRentalModifiable,
  calculateRentalFees,
  getContractRentalSummary,
  validateRentalStock,
  createAdditionalRentalOrder,
  confirmRentalOrderPayment,
  cancelPaidRentalOrder,
  cancelPendingRentalOrder,
  logRentalAction,
  groupItemsByOrder,
  RENTAL_CANCEL_REQUEST_DAYS,
  RENTAL_MODIFIABLE_STATUSES
} = require('../utils/rentalOrderHelper');
const NotificationService = require('../services/notificationService');
const { toKSTString } = require('../utils/dateHelper');

/**
 * 계약별 렌탈 주문 목록 조회
 * GET /api/contracts/:contractId/rental-orders
 */
const getRentalOrders = async (req, res) => {
  try {
    const { contractId } = req.params;
    const userId = req.user.id;

    // 계약 조회 및 권한 확인
    const contract = await Contract.findByPk(contractId);
    if (!contract) {
      return error(res, ErrorCodes.CONTRACT_NOT_FOUND, 404);
    }

    // 게스트 또는 호스트만 조회 가능
    if (contract.guestId !== userId && contract.hostId !== userId) {
      return error(res, ErrorCodes.FORBIDDEN, 403);
    }

    // 수정 가능 여부 확인
    const modifiableInfo = checkRentalModifiable(contract);

    // 렌탈 주문 목록 조회
    const rentalOrders = await RentalOrder.findAll({
      where: { contractId },
      include: [{
        model: RentalOrderItem,
        as: 'items',
        include: [{
          model: RentalItem,
          as: 'rentalItem',
          attributes: ['id', 'name', 'itemType', 'imageUrl']
        }]
      }],
      order: [['createdAt', 'DESC']]
    });

    // 요약 정보 계산
    const summary = await getContractRentalSummary(contractId);

    // 응답 데이터 포맷팅
    const orders = rentalOrders.map(order => ({
      id: order.id,
      orderId: order.orderId,
      orderType: order.orderType,
      orderTypeLabel: RentalOrder.ORDER_TYPE_LABELS[order.orderType],
      status: order.status,
      statusLabel: RentalOrder.STATUS_LABELS[order.status],
      deliveryStatus: order.deliveryStatus,
      deliveryStatusLabel: RentalOrder.DELIVERY_STATUS_LABELS[order.deliveryStatus],
      deliveredAt: order.deliveredAt ? toKSTString(order.deliveredAt) : null,
      totalAmount: order.totalAmount,
      paidAmount: order.paidAmount,
      refundedAmount: order.refundedAmount,
      paidAt: order.paidAt,
      createdAt: order.createdAt,
      items: order.items.map(item => ({
        id: item.id,
        rentalItemId: item.rentalItemId,
        name: item.rentalItem?.name || '알 수 없음',
        itemType: item.rentalItem?.itemType,
        imageUrl: item.rentalItem?.imageUrl,
        quantity: item.quantity,
        pricePerItem: parseFloat(item.pricePerItem),
        totalPrice: parseFloat(item.totalPrice),
        status: item.status,
        statusLabel: RentalOrderItem.STATUS_LABELS[item.status],
        cancelledAt: item.cancelledAt,
        refundAmount: item.refundAmount ? parseFloat(item.refundAmount) : null,
        cancelReason: item.cancelReason
      }))
    }));

    return success(res, {
      modifiable: modifiableInfo.modifiable,
      modifiableUntil: modifiableInfo.modifiableUntil ? toKSTString(modifiableInfo.modifiableUntil) : null,
      daysRemaining: modifiableInfo.daysRemaining,
      summary,
      orders
    });
  } catch (err) {
    console.error('렌탈 주문 목록 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 렌탈 수정 가능 여부 확인
 * GET /api/contracts/:contractId/rental-modifiable
 */
/**
 * 추가 렌탈 주문 생성
 * POST /api/contracts/:contractId/rental-orders
 */
const createRentalOrder = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { contractId } = req.params;
    const { items } = req.body;
    const userId = req.user.id;

    // 입력 검증
    if (!items || !Array.isArray(items) || items.length === 0) {
      await transaction.rollback();
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400, {
        details: '렌탈 아이템을 선택해주세요.'
      });
    }

    // 계약 조회 및 권한 확인
    const contract = await Contract.findByPk(contractId, { transaction });
    if (!contract) {
      await transaction.rollback();
      return error(res, ErrorCodes.CONTRACT_NOT_FOUND, 404);
    }

    if (contract.guestId !== userId) {
      await transaction.rollback();
      return error(res, ErrorCodes.RENTAL_NOT_GUEST, 403);
    }

    // 수정 가능 여부 확인
    const modifiableInfo = checkRentalModifiable(contract);
    if (!modifiableInfo.modifiable) {
      await transaction.rollback();
      return error(res, ErrorCodes.RENTAL_MODIFICATION_EXPIRED, 400, {
        details: modifiableInfo.reason
      });
    }

    // 최소 주문금액 검증
    // 배송전(PENDING) 주문이 이미 있으면 합배송 가능 → 금액 제한 없음
    // 배송전 주문이 없으면 새 배송이 필요하므로 10,000원 미만 차단
    const hasPendingDelivery = await RentalOrder.count({
      where: {
        contractId,
        status: ['PAID', 'PARTIAL_REFUND'],
        deliveryStatus: 'PENDING'
      },
      transaction
    });

    if (!hasPendingDelivery) {
      // 요청된 아이템들의 금액 합산 (아이템 단가는 RentalItem에서 가져와야 하므로 여기서는 간단히 totalAmount 기준으로 체크)
      // createAdditionalRentalOrder 내부에서 itemDetails가 계산되므로, 미리 validateRentalStock으로 계산
      const stockValidation = await validateRentalStock(
        items,
        contract.checkInDate,
        contract.checkOutDate,
        transaction
      );
      const requestedAmount = stockValidation.itemDetails.reduce((sum, item) => sum + item.totalPrice, 0);

      if (requestedAmount < 10000) {
        await transaction.rollback();
        return error(res, ErrorCodes.RENTAL_MINIMUM_AMOUNT_REQUIRED, 400, {
          details: `현재 주문금액 ${requestedAmount.toLocaleString()}원 (최소 10,000원)`
        });
      }
    }

    // 추가 주문 생성
    const rentalOrder = await createAdditionalRentalOrder(
      contract,
      items,
      userId,
      req,
      transaction
    );

    // 주문 상세 조회
    const createdOrder = await RentalOrder.findByPk(rentalOrder.id, {
      include: [{
        model: RentalOrderItem,
        as: 'items',
        include: [{
          model: RentalItem,
          as: 'rentalItem',
          attributes: ['id', 'name', 'itemType', 'imageUrl']
        }]
      }],
      transaction
    });

    await transaction.commit();

    return success(res, {
      rentalOrderId: createdOrder.id,
      orderId: createdOrder.orderId,
      orderType: createdOrder.orderType,
      totalAmount: createdOrder.totalAmount,
      status: createdOrder.status,
      modifiableUntil: createdOrder.modifiableUntil ? toKSTString(createdOrder.modifiableUntil) : null,
      items: createdOrder.items.map(item => ({
        id: item.id,
        name: item.rentalItem?.name,
        quantity: item.quantity,
        pricePerItem: parseFloat(item.pricePerItem),
        totalPrice: parseFloat(item.totalPrice)
      }))
    }, '렌탈 주문이 생성되었습니다. 결제를 진행해주세요.');
  } catch (err) {
    await transaction.rollback();
    console.error('추가 렌탈 주문 생성 오류:', err);

    // 재고 부족 등의 에러 처리
    if (err.message.includes('재고가 부족')) {
      return error(res, ErrorCodes.RENTAL_STOCK_INSUFFICIENT, 400, {
        details: err.message
      });
    }

    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 렌탈 주문 결제 정보 조회
 * GET /api/rental-orders/:rentalOrderId/payment-info
 */
const getRentalOrderPaymentInfo = async (req, res) => {
  try {
    const { rentalOrderId } = req.params;
    const userId = req.user.id;

    // 렌탈 주문 조회
    const rentalOrder = await RentalOrder.findByPk(rentalOrderId, {
      include: [{
        model: Contract,
        as: 'contract',
        include: [{
          model: Room,
          as: 'room',
          attributes: ['id', 'roomName']
        }]
      }, {
        model: RentalOrderItem,
        as: 'items',
        include: [{
          model: RentalItem,
          as: 'rentalItem',
          attributes: ['name']
        }]
      }]
    });

    if (!rentalOrder) {
      return error(res, ErrorCodes.RENTAL_ORDER_NOT_FOUND, 404);
    }

    // 권한 확인
    if (rentalOrder.contract.guestId !== userId) {
      return error(res, ErrorCodes.RENTAL_NOT_GUEST, 403);
    }

    // 결제 가능 상태 확인
    if (rentalOrder.status !== 'PENDING') {
      return error(res, ErrorCodes.RENTAL_ORDER_NOT_PAYABLE, 400);
    }

    // 사용자 정보 조회
    const user = await User.findByPk(userId, {
      attributes: ['email', 'name', 'phoneNumber']
    });

    // 주문명 생성
    const firstItem = rentalOrder.items[0]?.rentalItem?.name || '렌탈 아이템';
    const otherCount = rentalOrder.items.length - 1;
    const orderName = otherCount > 0
      ? `렌탈 아이템 추가 (${firstItem} 외 ${otherCount}건)`
      : `렌탈 아이템 추가 (${firstItem})`;

    const responseData = {
      rentalOrderId: rentalOrder.id,
      orderId: rentalOrder.orderId,
      amount: rentalOrder.totalAmount,
      orderName,
      customerEmail: user.email,
      customerName: user.name,
      customerPhone: user.phoneNumber
    };

    const testAmount = paytagClient.getTestAmount();
    if (testAmount) {
      responseData.pgAmount = testAmount;
    }

    return success(res, responseData);
  } catch (err) {
    console.error('렌탈 주문 결제 정보 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 렌탈 주문 결제 승인
 * POST /api/rental-orders/:rentalOrderId/confirm-payment
 */
const confirmRentalPayment = async (req, res) => {
  console.log('🚀 confirmRentalPayment 호출됨:', req.params.rentalOrderId);

  const { rentalOrderId } = req.params;
  const { recvPayparam, payType, orderId, amount } = req.body;
  const userId = req.user.id;

  // ── 1단계: 검증 및 조회 (트랜잭션 밖 — 락 불필요) ──
  if (!recvPayparam || !orderId || !amount) {
    return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400);
  }

  const rentalOrder = await RentalOrder.findByPk(rentalOrderId, {
    include: [{ model: Contract, as: 'contract' }]
  });

  if (!rentalOrder) return error(res, ErrorCodes.RENTAL_ORDER_NOT_FOUND, 404);
  if (rentalOrder.contract.guestId !== userId) return error(res, ErrorCodes.RENTAL_NOT_GUEST, 403);
  if (rentalOrder.status !== 'PENDING') return error(res, ErrorCodes.RENTAL_ORDER_NOT_PAYABLE, 400);
  if (!RENTAL_MODIFIABLE_STATUSES.includes(rentalOrder.contract.status)) {
    return error(res, { code: 4470, message: `계약이 취소되거나 종료되어 결제가 불가합니다. (계약 상태: ${rentalOrder.contract.status})` }, 400);
  }
  if (rentalOrder.orderId !== orderId) return error(res, ErrorCodes.ORDER_ID_MISMATCH, 400);

  // 금액 확인 (클라이언트 변조 방지)
  const testAmount = paytagClient.getTestAmount(payType);
  const realRentalAmount = rentalOrder.totalAmount;

  if (realRentalAmount !== parseInt(amount, 10)) return error(res, ErrorCodes.RENTAL_AMOUNT_MISMATCH, 400);

  if (testAmount) {
    console.log(`🧪 렌탈 테스트 결제 모드: PG 결제 ${testAmount}원 → DB 저장 ${realRentalAmount}원`);
  }

  // ── 2단계: PG 결제 승인 (트랜잭션 밖) ──
  let paytagResponse;
  try {
    paytagResponse = await paytagClient.confirmPayment({
      recvPayparam,
      payType: payType || 'CARD'
    });
  } catch (paytagError) {
    await RentalPaymentFailureLog.create({
      rentalOrderId: rentalOrder.id,
      contractId: rentalOrder.contractId,
      orderId,
      failureCode: paytagError.paytagErrorCode || 'UNKNOWN',
      failureMessage: paytagError.paytagErrorMessage || paytagError.message,
      requestData: { recvPayparam: '(encrypted)', payType, orderId, amount },
      responseData: paytagError.paytagResponse || null,
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip || req.connection.remoteAddress
    });
    console.error('렌탈 PayTag 결제 승인 실패:', paytagError.message);
    return error(res, ErrorCodes.PAYMENT_CONFIRMATION_FAILED, 400, {
      pgErrorCode: paytagError.paytagErrorCode,
      pgErrorMessage: paytagError.paytagErrorMessage
    });
  }

  const now = new Date();
  const mappedMethod = paytagClient.mapPaymentMethod(payType || 'CARD');
  const easyPayProvider = paytagClient.mapEasyPayProvider(payType || 'CARD');
  const pgPaymentKey = paytagResponse.tran_key || paytagResponse.recv_orderno || orderId;

  console.log('🔍 PayTag 결제 응답:', JSON.stringify(paytagResponse, null, 2));

  // ── 3단계: DB 업데이트 (짧은 트랜잭션 — PG 성공 후) ──
  // PG 성공 후 DB 실패 시 즉시 PG 취소 (보상 트랜잭션)
  const transaction = await sequelize.transaction();
  try {
    await RentalPayment.create({
      rentalOrderId: rentalOrder.id,
      contractId: rentalOrder.contractId,
      paymentKey: pgPaymentKey,
      orderId: rentalOrder.orderId,
      method: mappedMethod,
      easyPayProvider,
      status: 'DONE',
      requestedAt: now,
      approvedAt: now,
      totalAmount: realRentalAmount,
      balanceAmount: realRentalAmount,
      suppliedAmount: Math.round(realRentalAmount / 1.1),
      vat: realRentalAmount - Math.round(realRentalAmount / 1.1),
      taxFreeAmount: 0,
      currency: 'KRW',
      receiptUrl: paytagResponse.receipt_url || null,
      checkoutUrl: null,
      paymentResponse: paytagResponse
    }, { transaction });

    await confirmRentalOrderPayment(rentalOrder, pgPaymentKey, mappedMethod, userId, req, transaction);

    await transaction.commit();

  } catch (dbErr) {
    await transaction.rollback();
    console.error('렌탈 결제 DB 업데이트 실패 — PG 즉시 취소 시도:', dbErr);

    // PG 성공 후 DB 실패 → 보상 트랜잭션: PG 즉시 취소
    try {
      const { orderno, orgpaydate, orgtranamt } = paytagClient.extractCancelParams({
        paymentResponse: paytagResponse,
        orderId
      });
      await paytagClient.cancelPayment({ orderno, orgpaydate, orgtranamt, loginid: null, cancelamt: realRentalAmount, canceltype: '0' });
      console.error(`렌탈 결제 취소 완료 (보상): rentalOrderId=${rentalOrder.id}, orderId=${orderId}`);
    } catch (cancelErr) {
      console.error(`[긴급] 렌탈 PG 취소 실패 — 수동 환불 필요: rentalOrderId=${rentalOrder.id}, orderId=${orderId}`, cancelErr);
      await RentalPaymentFailureLog.create({
        rentalOrderId: rentalOrder.id,
        contractId: rentalOrder.contractId,
        orderId,
        failureCode: 'DB_FAIL_PG_CANCEL_FAIL',
        failureMessage: `DB 업데이트 실패 후 PG 취소도 실패. 수동 환불 필요. DB오류: ${dbErr.message} / PG취소오류: ${cancelErr.message}`,
        requestData: { payType, orderId, amount: realRentalAmount },
        responseData: paytagResponse
      }).catch(() => {});
    }

    return error(res, ErrorCodes.PAYMENT_CONFIRMATION_FAILED, 500);
  }

  // ── 4단계: 커밋 후 알림 발송 (트랜잭션 밖) ──
  try {
    const orderItems = await RentalOrderItem.findAll({
      where: { rentalOrderId: rentalOrder.id },
      include: [{ model: RentalItem, as: 'rentalItem', attributes: ['name'] }]
    });
    const optionItems = orderItems.map(i => `${i.rentalItem?.name || '옵션'} ${i.quantity}개`).join(', ');
    await NotificationService.notifyAdditionalOptionPayment(rentalOrder.contract, {
      optionItems,
      amount: realRentalAmount
    });
  } catch (notifyErr) {
    console.error('옵션 결제 완료 알림 발송 실패 (무시됨):', notifyErr);
  }

  return success(res, {
    rentalOrderId: rentalOrder.id,
    orderId: rentalOrder.orderId,
    status: 'PAID',
    paidAmount: realRentalAmount,
    paidAt: now,
    paymentKey: pgPaymentKey,
    receiptUrl: paytagResponse.receipt_url || null
  }, '결제가 완료되었습니다.');
};

/**
 * 미결제 렌탈 주문 취소
 * DELETE /api/rental-orders/:rentalOrderId
 */
const cancelRentalOrder = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { rentalOrderId } = req.params;
    const userId = req.user.id;

    // 렌탈 주문 조회
    const rentalOrder = await RentalOrder.findByPk(rentalOrderId, {
      include: [{
        model: Contract,
        as: 'contract'
      }],
      transaction
    });

    if (!rentalOrder) {
      await transaction.rollback();
      return error(res, ErrorCodes.RENTAL_ORDER_NOT_FOUND, 404);
    }

    // 권한 확인
    if (rentalOrder.contract.guestId !== userId) {
      await transaction.rollback();
      return error(res, ErrorCodes.RENTAL_NOT_GUEST, 403);
    }

    // 취소 가능 상태 확인
    if (rentalOrder.status !== 'PENDING') {
      await transaction.rollback();
      return error(res, ErrorCodes.RENTAL_ORDER_NOT_CANCELLABLE, 400);
    }

    // 주문 취소 처리
    await cancelPendingRentalOrder(rentalOrder, userId, req, transaction);

    await transaction.commit();

    return success(res, null, '주문이 취소되었습니다.');
  } catch (err) {
    await transaction.rollback();
    console.error('렌탈 주문 취소 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 결제된 렌탈 주문 취소 (환불) - 주문번호 단위 전체 취소
 * POST /api/rental-orders/:rentalOrderId/cancel
 *
 * @description 정책: 취소는 주문번호별로만 가능 (아이템 개별 취소 불가)
 * @access 게스트
 * @body { reason?: string }
 */
const cancelPaidRentalOrderByGuest = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { rentalOrderId } = req.params;
    const { reason } = req.body;
    const userId = req.user.id;

    // 렌탈 주문 조회
    const rentalOrder = await RentalOrder.findByPk(rentalOrderId, {
      include: [{
        model: Contract,
        as: 'contract'
      }],
      transaction
    });

    if (!rentalOrder) {
      await transaction.rollback();
      return error(res, ErrorCodes.RENTAL_ORDER_NOT_FOUND, 404);
    }

    // 권한 확인
    if (rentalOrder.contract.guestId !== userId) {
      await transaction.rollback();
      return error(res, ErrorCodes.RENTAL_NOT_GUEST, 403);
    }

    // 환불 가능 상태 확인
    if (!['PAID', 'PARTIAL_REFUND'].includes(rentalOrder.status)) {
      await transaction.rollback();
      return error(res, ErrorCodes.RENTAL_ORDER_NOT_REFUNDABLE, 400);
    }

    // 이미 전체 취소된 주문인지 확인
    const activeItemCount = await RentalOrderItem.count({
      where: { rentalOrderId: rentalOrder.id, status: 'ACTIVE' },
      transaction
    });
    if (activeItemCount === 0) {
      await transaction.rollback();
      return error(res, { code: 4422, message: '이미 모든 아이템이 취소된 주문입니다.' }, 400);
    }

    const contract = rentalOrder.contract;
    const now = new Date();

    // 계약 종료 상태 → 취소 불가
    const terminalStatuses = ['COMPLETED', 'CANCELLED', 'CANCELLED_BY_GUEST', 'CANCELLED_BY_HOST',
      'CANCELLED_BY_ADMIN_WITH_REFUND', 'CANCELLED_BY_ADMIN_NO_REFUND'];
    if (terminalStatuses.includes(contract.status)) {
      await transaction.rollback();
      return error(res, ErrorCodes.RENTAL_MODIFICATION_EXPIRED, 400, {
        details: '계약이 종료되어 옵션 취소가 불가합니다'
      });
    }

    // 입주 중(IN_PROGRESS) → 취소 요청만 가능 (7일 제한)
    if (contract.status === 'IN_PROGRESS') {
      const stayStartedAt = contract.checkedInAt ? new Date(contract.checkedInAt) : new Date(contract.checkInDate + 'T00:00:00+09:00');
      const cancelRequestDeadline = new Date(stayStartedAt.getTime() + RENTAL_CANCEL_REQUEST_DAYS * 24 * 60 * 60 * 1000);

      if (now > cancelRequestDeadline) {
        await transaction.rollback();
        return error(res, {
          code: 4421,
          message: `입주 시작 후 ${RENTAL_CANCEL_REQUEST_DAYS}일이 경과하여 취소 요청이 불가합니다.`
        }, 400, {
          stayStartedAt: toKSTString(stayStartedAt),
          cancelRequestDeadline: toKSTString(cancelRequestDeadline)
        });
      }

      // 중복 반품 요청 차단
      const pendingRequestCount = await RentalOrderRefundRequest.count({
        where: { rentalOrderId: rentalOrder.id, status: 'PENDING' },
        transaction
      });
      if (pendingRequestCount > 0) {
        await transaction.rollback();
        return error(res, { code: 4424, message: '이미 처리 중인 반품 요청이 있습니다.' }, 400);
      }

      // 주문 내 모든 활성 아이템을 CANCEL_REQUESTED로 전환
      const activeItems = await RentalOrderItem.findAll({
        where: { rentalOrderId: rentalOrder.id, status: 'ACTIVE' },
        include: [{ model: RentalItem, as: 'rentalItem' }],
        transaction
      });

      for (const item of activeItems) {
        await item.update({
          status: 'CANCEL_REQUESTED',
          cancelReason: reason || '입주 중 취소 요청'
        }, { transaction });
      }

      // 환불 요청 레코드 생성 (관리자 조회/처리용)
      const itemTotalAmount = activeItems.reduce((sum, item) => sum + parseFloat(item.totalPrice), 0);
      await RentalOrderRefundRequest.create({
        rentalOrderId: rentalOrder.id,
        contractId: rentalOrder.contractId,
        requestedBy: userId,
        status: 'PENDING',
        cancelReason: reason || '입주 중 취소 요청',
        deliveryStatusSnapshot: rentalOrder.deliveryStatus,
        itemTotalAmount
      }, { transaction });

      await logRentalAction({
        contractId: rentalOrder.contractId,
        rentalOrderId: rentalOrder.id,
        rentalOrderItemId: null,
        action: 'CANCEL_REQUESTED',
        actor: 'GUEST',
        actorId: userId,
        amountChange: 0,
        balanceAfter: 0,
        metadata: {
          orderId: rentalOrder.orderId,
          itemCount: activeItems.length,
          items: activeItems.map(item => ({
            itemId: item.rentalItemId,
            itemName: item.rentalItem?.name || '알 수 없음',
            quantity: item.quantity
          })),
          reason,
          requestedAt: toKSTString(now),
          cancelRequestDeadline: toKSTString(cancelRequestDeadline)
        },
        description: `입주 중 주문 전체 취소 요청: ${reason || '사유 없음'}`,
        req
      }, transaction);

      await transaction.commit();

      return success(res, {
        rentalOrderId: rentalOrder.id,
        orderId: rentalOrder.orderId,
        status: 'CANCEL_REQUESTED',
        cancelRequestedItemCount: activeItems.length,
        message: '입주 중에는 취소 요청이 접수되며, 관리자 확인 후 처리됩니다.'
      }, '취소 요청이 접수되었습니다. 관리자 확인 후 환불이 처리됩니다.');
    }

    // 결제 완료 상태 (PAYMENT_COMPLETED) → 즉시 주문 전체 취소 가능
    if (contract.status !== 'PAYMENT_COMPLETED') {
      await transaction.rollback();
      return error(res, ErrorCodes.RENTAL_MODIFICATION_EXPIRED, 400, {
        details: `현재 계약 상태(${contract.status})에서는 옵션 취소가 불가합니다`
      });
    }

    // 배송 전 상태만 즉시 결제취소 가능
    if (rentalOrder.deliveryStatus !== 'PENDING') {
      await transaction.rollback();
      return error(res, { code: 4425, message: '배송이 시작된 상품은 결제취소가 불가합니다. 반품 신청을 이용하세요.' }, 400);
    }

    // 금액 산정 (PG 호출 전 미리 계산)
    const activeItems = await RentalOrderItem.findAll({
      where: { rentalOrderId: rentalOrder.id, status: 'ACTIVE' },
      transaction
    });
    if (activeItems.length === 0) {
      await transaction.rollback();
      return error(res, { code: 4422, message: '취소할 활성 아이템이 없습니다.' }, 400);
    }

    const orderTotalPrice = activeItems.reduce((sum, item) => sum + parseFloat(item.totalPrice), 0);
    let refundAmount = orderTotalPrice;
    let shippingDeduction = 0;

    if (rentalOrder.deliveryStatus === 'IN_TRANSIT') {
      shippingDeduction = 10000; // RENTAL_ROUND_TRIP_SHIPPING_COST
      refundAmount = orderTotalPrice - shippingDeduction;
      if (refundAmount <= 0) {
        await transaction.rollback();
        return error(res, { code: 4423, message: `환불 금액(${orderTotalPrice}원)이 왕복배송비(${shippingDeduction}원) 이하입니다.` }, 400);
      }
    }

    const rentalPayment = await RentalPayment.findOne({
      where: { rentalOrderId: rentalOrder.id },
      transaction
    });
    if (!rentalPayment) {
      await transaction.rollback();
      return error(res, ErrorCodes.PAYMENT_NOT_FOUND, 404);
    }

    await transaction.rollback();

    // ── PG 취소 먼저 (트랜잭션 밖) ──
    const { orderno, orgpaydate, orgtranamt, loginid } = paytagClient.extractCancelParams(rentalPayment);
    const newBalance = parseFloat(rentalPayment.balanceAmount) - refundAmount;
    const canceltype = newBalance === 0 ? '0' : '1';

    let pgCancelResp;
    try {
      pgCancelResp = await paytagClient.cancelPayment({
        orderno, orgpaydate, orgtranamt, loginid,
        cancelamt: refundAmount,
        canceltype
      });
    } catch (pgErr) {
      if (pgErr.paytagErrorCode === '1023') {
        return error(res, { code: 4901, message: '이미 취소 완료된 결제입니다.', pgErrorCode: pgErr.paytagErrorCode }, 400);
      }
      if (pgErr.paytagErrorCode === '1021') {
        return error(res, { code: 4902, message: 'PG사에서 취소를 거부했습니다.', pgErrorCode: pgErr.paytagErrorCode }, 400);
      }
      console.error('렌탈 취소 PayTag 오류:', pgErr.message);
      return error(res, { code: 4900, message: `PG 취소 실패: ${pgErr.paytagErrorMessage || pgErr.message}` }, 502);
    }

    // ── PG 성공 후 DB 업데이트 ──
    const dbTransaction = await sequelize.transaction();
    try {
      const result = await cancelPaidRentalOrder(
        rentalOrder,
        reason,
        userId,
        'GUEST',
        req,
        dbTransaction,
        { pgResponse: pgCancelResp }
      );
      await dbTransaction.commit();

      // 알림톡 발송 (옵션 결제 취소 → 게스트)
      const AlimtalkService = require('../services/alimtalkService');
      User.findByPk(userId, { attributes: ['id', 'phoneNumber', 'name', 'nickname'] })
        .then(guest => {
          if (!guest) return;
          return Room.findByPk(rentalOrder.contract.roomId, { attributes: ['id', 'roomName'] })
            .then(room => {
              const itemNames = activeItems.map(i => i.rentalItem?.name || '').filter(Boolean).join(', ');
              return AlimtalkService.sendOptionPaymentCanceled(rentalOrder.contract, guest, room, {
                optionItems: itemNames,
                amount: result.refundAmount
              });
            });
        })
        .catch(err => console.error('[Alimtalk] option_payment_canceled_guest 실패:', err.message));

      const responseData = {
        rentalOrderId: rentalOrder.id,
        orderId: result.orderId,
        refundAmount: result.refundAmount,
        cancelledItemCount: result.cancelledItemCount,
        refundStatus: 'COMPLETED',
        orderStatus: result.orderStatus
      };
      if (result.shippingDeduction > 0) {
        responseData.shippingDeduction = result.shippingDeduction;
      }

      return success(res, responseData, result.shippingDeduction > 0
        ? `주문이 취소되었습니다. 왕복배송비 ${result.shippingDeduction}원 차감 후 환불됩니다.`
        : '주문이 취소되었습니다. 환불이 처리됩니다.');
    } catch (dbErr) {
      await dbTransaction.rollback();
      console.error('렌탈 취소 DB 업데이트 오류 (PG는 이미 취소됨):', dbErr);
      return error(res, { code: 4903, message: 'PG 취소는 완료됐으나 DB 업데이트에 실패했습니다. 관리자에게 문의하세요.' }, 500);
    }

  } catch (err) {
    console.error('렌탈 주문 취소 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 이용 가능한 렌탈 아이템 목록 조회
 * GET /api/contracts/:contractId/available-rental-items
 */
const getAvailableRentalItems = async (req, res) => {
  try {
    const { contractId } = req.params;
    const userId = req.user.id;

    // 계약 조회 및 권한 확인
    const contract = await Contract.findByPk(contractId);
    if (!contract) {
      return error(res, ErrorCodes.CONTRACT_NOT_FOUND, 404);
    }

    if (contract.guestId !== userId) {
      return error(res, ErrorCodes.RENTAL_NOT_GUEST, 403);
    }

    // 수정 가능 여부 확인
    const modifiableInfo = checkRentalModifiable(contract);

    // 활성화된 렌탈 아이템 목록 조회
    const rentalItems = await RentalItem.findAll({
      where: {
        isActive: true
      },
      order: [['itemType', 'ASC'], ['name', 'ASC']]
    });

    // 이 계약에 배송 전(PENDING) 주문이 하나라도 있는지 확인
    const hasPendingDelivery = await RentalOrder.count({
      where: {
        contractId,
        status: { [Op.in]: ['PAID', 'PARTIAL_REFUND'] },
        deliveryStatus: 'PENDING'
      }
    }) > 0;

    // 각 아이템의 해당 기간 가용 수량 계산
    const itemsWithAvailability = await Promise.all(
      rentalItems.map(async (item) => {
        // 해당 기간에 예약된 수량 조회
        const reservedQuantity = await RentalItemReservation.sum('quantity', {
          where: {
            rentalItemId: item.id,
            status: { [Op.in]: ['RESERVED', 'CONFIRMED'] },
            [Op.or]: [
              {
                reservedFrom: { [Op.between]: [contract.checkInDate, contract.checkOutDate] }
              },
              {
                reservedUntil: { [Op.between]: [contract.checkInDate, contract.checkOutDate] }
              },
              {
                [Op.and]: [
                  { reservedFrom: { [Op.lte]: contract.checkInDate } },
                  { reservedUntil: { [Op.gte]: contract.checkOutDate } }
                ]
              }
            ]
          }
        }) || 0;

        const availableQuantity = Math.max(0, item.totalStock - reservedQuantity);

        return {
          id: item.id,
          name: item.name,
          itemType: item.itemType,
          itemTypeLabel: RentalItem.ITEM_TYPE_LABELS[item.itemType],
          description: item.description,
          price: parseFloat(item.price),
          imageUrl: item.imageUrl,
          totalStock: item.totalStock,
          availableQuantity
        };
      })
    );

    return success(res, {
      modifiable: modifiableInfo.modifiable,
      modifiableUntil: modifiableInfo.modifiableUntil ? toKSTString(modifiableInfo.modifiableUntil) : null,
      checkInDate: toKSTString(contract.checkInDate),
      checkOutDate: toKSTString(contract.checkOutDate),
      hasPendingDelivery,
      items: itemsWithAvailability
    });
  } catch (err) {
    console.error('이용 가능한 렌탈 아이템 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 아이템 단위 즉시환불 (배송전 전용)
 * POST /api/contracts/:contractId/rental-items/cancel
 *
 * @access 게스트
 * @body { itemIds: number[], reason?: string }
 * @description 배송전(PENDING) 상태 아이템 복수 선택 즉시환불.
 *              여러 주문건 혼합 가능. 주문별 독립 PG 처리 (부분 성공 허용).
 */
const cancelRentalItemsByGuest = async (req, res) => {
  try {
    const { contractId } = req.params;
    const { items: cancelRequests, reason } = req.body;
    const userId = req.user.id;

    // { id, cancelQuantity } 배열 검증
    if (!Array.isArray(cancelRequests) || cancelRequests.length === 0) {
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400, { details: '취소할 아이템을 선택해주세요.' });
    }
    for (const req_ of cancelRequests) {
      if (!req_.id || !Number.isInteger(req_.cancelQuantity) || req_.cancelQuantity < 1) {
        return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400, { details: `아이템(${req_.id})의 cancelQuantity가 올바르지 않습니다.` });
      }
    }

    // cancelQuantity Map (itemId → cancelQuantity)
    const cancelQtyMap = new Map(cancelRequests.map(r => [r.id, r.cancelQuantity]));
    const itemIds = cancelRequests.map(r => r.id);

    // 계약 조회 + 권한 확인
    const contract = await Contract.findByPk(contractId);
    if (!contract) return error(res, ErrorCodes.CONTRACT_NOT_FOUND, 404);
    if (contract.guestId !== userId) return error(res, ErrorCodes.RENTAL_NOT_GUEST, 403);

    // 계약 상태 확인
    if (contract.status !== 'PAYMENT_COMPLETED') {
      return error(res, ErrorCodes.RENTAL_MODIFICATION_EXPIRED, 400, {
        details: `현재 계약 상태(${contract.status})에서는 즉시환불이 불가합니다.`
      });
    }

    // 아이템 그룹핑 + 유효성 검증
    let groups;
    try {
      groups = await groupItemsByOrder(itemIds, parseInt(contractId), null);
    } catch (validErr) {
      return error(res, { code: validErr.code || 4460, message: validErr.message }, validErr.status || 400);
    }

    // cancelQuantity 범위 검증 (item.quantity 초과 불가)
    for (const { items } of groups.values()) {
      for (const item of items) {
        const cancelQty = cancelQtyMap.get(item.id);
        if (cancelQty > item.quantity) {
          return error(res, { code: 4466, message: `아이템(${item.id})의 취소 수량(${cancelQty})이 보유 수량(${item.quantity})을 초과합니다.` }, 400);
        }
      }
    }

    // 배송전 상태 이중 검증
    for (const { rentalOrder } of groups.values()) {
      if (rentalOrder.deliveryStatus !== 'PENDING') {
        return error(res, { code: 4425, message: `주문(${rentalOrder.orderId})은 배송이 시작되어 즉시환불이 불가합니다. 반품 신청을 이용하세요.` }, 400);
      }
    }

    // INITIAL / ADDITIONAL 분리
    const initialGroups = new Map();
    const additionalGroups = new Map();
    for (const [orderId, group] of groups) {
      if (group.rentalOrder.orderType === 'INITIAL') {
        initialGroups.set(orderId, group);
      } else {
        additionalGroups.set(orderId, group);
      }
    }

    const succeeded = [];
    const failed = [];
    let totalRefunded = 0;
    const now = new Date();

    // 수량 부분/전체 취소를 통합 처리하는 내부 헬퍼
    // isFullCancel: cancelQty === item.quantity
    const buildItemCancelUpdate = (item, cancelQty) => {
      const pricePerItem = parseFloat(item.pricePerItem);
      const isFullCancel = cancelQty === item.quantity;
      const itemRefundAmount = pricePerItem * cancelQty;
      return { isFullCancel, itemRefundAmount };
    };

    // ── [A] INITIAL 주문 처리 — 계약 결제(Payment) 기준, 선택 아이템 합산 1회 PG 취소 ──
    if (initialGroups.size > 0) {
      const contractPayment = await Payment.findOne({
        where: {
          contractId,
          paymentType: 'CONTRACT',
          status: { [Op.in]: ['DONE', 'PARTIAL_CANCELED'] }
        }
      });

      for (const [, { rentalOrder, items }] of initialGroups) {
        if (!contractPayment) {
          failed.push({ orderId: rentalOrder.orderId, reason: '계약 결제 정보를 찾을 수 없습니다.' });
          continue;
        }

        const refundAmount = items.reduce((sum, item) => {
          const cancelQty = cancelQtyMap.get(item.id);
          return sum + parseFloat(item.pricePerItem) * cancelQty;
        }, 0);
        const availableBalance = parseFloat(contractPayment.balanceAmount);

        if (refundAmount > availableBalance) {
          failed.push({ orderId: rentalOrder.orderId, reason: `환불 가능 금액 부족 (가능: ${availableBalance}원, 요청: ${refundAmount}원)` });
          continue;
        }

        // PG 부분 취소 (계약 결제 기준, 트랜잭션 밖)
        const { orderno, orgpaydate, orgtranamt, loginid } = paytagClient.extractCancelParams(contractPayment);
        const newBalance = availableBalance - refundAmount;
        const canceltype = newBalance === 0 ? '0' : '1';

        try {
          await paytagClient.cancelPayment({ orderno, orgpaydate, orgtranamt, loginid, cancelamt: refundAmount, canceltype });
        } catch (pgErr) {
          failed.push({ orderId: rentalOrder.orderId, reason: pgErr.paytagErrorMessage || pgErr.message });
          continue;
        }

        // DB 업데이트 (짧은 트랜잭션)
        const dbTx = await sequelize.transaction();
        try {
          const cancelledItemsSummary = [];
          const rentalTypeItemIds = [];

          for (const item of items) {
            const cancelQty = cancelQtyMap.get(item.id);
            const { isFullCancel, itemRefundAmount } = buildItemCancelUpdate(item, cancelQty);

            if (isFullCancel) {
              await item.update({
                status: 'CANCELLED',
                cancelledAt: now,
                cancelReason: reason || '게스트 취소',
                refundAmount: itemRefundAmount
              }, { transaction: dbTx });
            } else {
              const remainQty = item.quantity - cancelQty;
              await item.update({
                quantity: remainQty,
                totalPrice: parseFloat(item.pricePerItem) * remainQty,
                cancelReason: reason || '게스트 취소',
                refundAmount: (parseFloat(item.refundAmount) || 0) + itemRefundAmount
              }, { transaction: dbTx });
            }

            // 재고 복구
            if (item.rentalItem?.salesType === 'SALE') {
              await RentalItem.increment('totalStock', {
                by: cancelQty,
                where: { id: item.rentalItemId },
                transaction: dbTx
              });
            } else {
              if (isFullCancel) rentalTypeItemIds.push(item.rentalItemId);
              // 부분 취소 시 RENTAL 타입 예약은 수량 개념이 없으므로 유지
            }

            cancelledItemsSummary.push({ id: item.id, name: item.rentalItem?.name, cancelQuantity: cancelQty, isFullCancel });
          }

          if (rentalTypeItemIds.length > 0) {
            await RentalItemReservation.update(
              { status: 'CANCELLED' },
              {
                where: {
                  rentalOrderId: rentalOrder.id,
                  rentalItemId: { [Op.in]: rentalTypeItemIds },
                  status: { [Op.ne]: 'CANCELLED' }
                },
                transaction: dbTx
              }
            );
          }

          await contractPayment.update({
            balanceAmount: newBalance,
            status: newBalance === 0 ? 'CANCELED' : 'PARTIAL_CANCELED'
          }, { transaction: dbTx });

          const newRefundedAmount = parseFloat(rentalOrder.refundedAmount || 0) + refundAmount;
          const remainingActive = await RentalOrderItem.count({
            where: { rentalOrderId: rentalOrder.id, status: 'ACTIVE' },
            transaction: dbTx
          });
          await rentalOrder.update({
            refundedAmount: newRefundedAmount,
            status: remainingActive === 0 ? 'FULLY_REFUNDED' : 'PARTIAL_REFUND'
          }, { transaction: dbTx });

          // 계약의 rentalItemsFee에서 취소된 금액 차감
          const newRentalItemsFee = Math.max(0, (contract.rentalItemsFee || 0) - refundAmount);
          await contract.update({ rentalItemsFee: newRentalItemsFee }, { transaction: dbTx });

          await logRentalAction({
            contractId: parseInt(contractId),
            rentalOrderId: rentalOrder.id,
            action: 'ORDER_CANCELLED',
            actor: 'GUEST',
            actorId: userId,
            amountChange: -refundAmount,
            balanceAfter: newBalance,
            metadata: {
              orderId: rentalOrder.orderId,
              orderType: 'INITIAL',
              cancelledItems: cancelledItemsSummary,
              refundAmount,
              reason: reason || '게스트 취소'
            },
            description: `INITIAL 아이템 선택 즉시환불: ${refundAmount}원`,
            req
          }, dbTx);

          await dbTx.commit();

          // 메모리상 잔액 갱신 (같은 Payment를 참조하는 다음 INITIAL 주문에서 최신값 사용)
          contractPayment.balanceAmount = newBalance;
          contractPayment.status = newBalance === 0 ? 'CANCELED' : 'PARTIAL_CANCELED';

          succeeded.push({ orderId: rentalOrder.orderId, refundAmount, cancelledItems: cancelledItemsSummary });
          totalRefunded += refundAmount;
        } catch (dbErr) {
          await dbTx.rollback();
          console.error(`INITIAL 즉시환불 DB 오류 (PG 취소 완료됨) orderId=${rentalOrder.orderId}:`, dbErr);
          failed.push({ orderId: rentalOrder.orderId, reason: 'PG 취소는 완료됐으나 DB 업데이트에 실패했습니다. 관리자에게 문의하세요.' });
        }
      }
    }

    // ── [B] ADDITIONAL 주문 처리 — 기존 로직 (RentalPayment 기준, 주문별 독립 PG 취소) ──
    for (const [, { rentalOrder, rentalPayment, items }] of additionalGroups) {
      if (!rentalPayment) {
        failed.push({ orderId: rentalOrder.orderId, reason: '결제 정보를 찾을 수 없습니다.' });
        continue;
      }

      const refundAmount = items.reduce((sum, item) => {
        const cancelQty = cancelQtyMap.get(item.id);
        return sum + parseFloat(item.pricePerItem) * cancelQty;
      }, 0);
      const availableBalance = parseFloat(rentalPayment.balanceAmount);

      if (refundAmount > availableBalance) {
        failed.push({ orderId: rentalOrder.orderId, reason: `환불 가능 금액 부족 (가능: ${availableBalance}원, 요청: ${refundAmount}원)` });
        continue;
      }

      // PG 취소 (트랜잭션 밖)
      const { orderno, orgpaydate, orgtranamt, loginid } = paytagClient.extractCancelParams(rentalPayment);
      const newBalance = availableBalance - refundAmount;
      const canceltype = newBalance === 0 ? '0' : '1';

      try {
        await paytagClient.cancelPayment({ orderno, orgpaydate, orgtranamt, loginid, cancelamt: refundAmount, canceltype });
      } catch (pgErr) {
        failed.push({ orderId: rentalOrder.orderId, reason: pgErr.paytagErrorMessage || pgErr.message });
        continue;
      }

      // DB 업데이트 (짧은 트랜잭션)
      const dbTx = await sequelize.transaction();
      try {
        const cancelledItemsSummary = [];
        const rentalTypeItemIds = [];

        for (const item of items) {
          const cancelQty = cancelQtyMap.get(item.id);
          const { isFullCancel, itemRefundAmount } = buildItemCancelUpdate(item, cancelQty);

          if (isFullCancel) {
            await item.update({
              status: 'CANCELLED',
              cancelledAt: now,
              cancelReason: reason || '게스트 취소',
              refundAmount: itemRefundAmount
            }, { transaction: dbTx });
          } else {
            const remainQty = item.quantity - cancelQty;
            await item.update({
              quantity: remainQty,
              totalPrice: parseFloat(item.pricePerItem) * remainQty,
              cancelReason: reason || '게스트 취소',
              refundAmount: (parseFloat(item.refundAmount) || 0) + itemRefundAmount
            }, { transaction: dbTx });
          }

          // 재고 복구: RENTAL → 전체 취소 시만 Reservation CANCELLED, SALE → cancelQty만큼 복구
          if (item.rentalItem?.salesType === 'SALE') {
            await RentalItem.increment('totalStock', {
              by: cancelQty,
              where: { id: item.rentalItemId },
              transaction: dbTx
            });
          } else {
            if (isFullCancel) rentalTypeItemIds.push(item.rentalItemId);
          }

          cancelledItemsSummary.push({ id: item.id, name: item.rentalItem?.name, cancelQuantity: cancelQty, isFullCancel });
        }

        if (rentalTypeItemIds.length > 0) {
          await RentalItemReservation.update(
            { status: 'CANCELLED' },
            {
              where: {
                rentalOrderId: rentalOrder.id,
                rentalItemId: { [Op.in]: rentalTypeItemIds },
                status: { [Op.ne]: 'CANCELLED' }
              },
              transaction: dbTx
            }
          );
        }

        await rentalPayment.update({
          balanceAmount: newBalance,
          status: newBalance === 0 ? 'CANCELED' : 'PARTIAL_CANCELED'
        }, { transaction: dbTx });

        const newRefundedAmount = parseFloat(rentalOrder.refundedAmount || 0) + refundAmount;
        const remainingActive = await RentalOrderItem.count({
          where: { rentalOrderId: rentalOrder.id, status: 'ACTIVE' },
          transaction: dbTx
        });
        await rentalOrder.update({
          refundedAmount: newRefundedAmount,
          status: remainingActive === 0 ? 'FULLY_REFUNDED' : 'PARTIAL_REFUND'
        }, { transaction: dbTx });

        await logRentalAction({
          contractId: parseInt(contractId),
          rentalOrderId: rentalOrder.id,
          action: 'ORDER_CANCELLED',
          actor: 'GUEST',
          actorId: userId,
          amountChange: -refundAmount,
          balanceAfter: newBalance,
          metadata: {
            orderId: rentalOrder.orderId,
            cancelledItems: cancelledItemsSummary,
            refundAmount,
            reason: reason || '게스트 취소'
          },
          description: `아이템 선택 즉시환불: ${refundAmount}원`,
          req
        }, dbTx);

        await dbTx.commit();

        succeeded.push({ orderId: rentalOrder.orderId, refundAmount, cancelledItems: cancelledItemsSummary });
        totalRefunded += refundAmount;
      } catch (dbErr) {
        await dbTx.rollback();
        console.error(`즉시환불 DB 오류 (PG 취소 완료됨) orderId=${rentalOrder.orderId}:`, dbErr);
        failed.push({ orderId: rentalOrder.orderId, reason: 'PG 취소는 완료됐으나 DB 업데이트에 실패했습니다. 관리자에게 문의하세요.' });
      }
    }

    const message = failed.length === 0
      ? '선택한 상품이 모두 취소되었습니다.'
      : `${succeeded.length}건 취소 완료, ${failed.length}건 처리 실패.`;

    // 알림톡 발송 — 1건 이상 성공한 경우만 (게스트에게 옵션 결제 취소 안내)
    if (succeeded.length > 0) {
      const AlimtalkService = require('../services/alimtalkService');
      User.findByPk(userId, { attributes: ['id', 'phoneNumber', 'name', 'nickname'] })
        .then(guest => {
          if (!guest) return;
          return Room.findByPk(contract.roomId, { attributes: ['id', 'roomName'] })
            .then(room => {
              const itemNames = succeeded
                .flatMap(s => s.cancelledItems.map(i => i.name || ''))
                .filter(Boolean)
                .join(', ');
              return AlimtalkService.sendOptionPaymentCanceled(contract, guest, room, {
                optionItems: itemNames,
                amount: totalRefunded
              });
            });
        })
        .catch(err => console.error('[Alimtalk] option_payment_canceled_guest 실패:', err.message));
    }

    return success(res, { succeeded, failed, totalRefunded }, message);
  } catch (err) {
    console.error('아이템 즉시환불 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 아이템 단위 반품 신청 (배송중/배송완료 전용)
 * POST /api/contracts/:contractId/rental-items/return-request
 *
 * @access 게스트
 * @body { items: [{ id, returnQuantity }], reason: string }
 * @description 배송중/배송완료 상태 아이템 복수 선택 반품 신청. 수량 부분 반품 지원.
 *              여러 주문건 혼합 가능. 주문별 RentalOrderRefundRequest 생성.
 *              단일 트랜잭션으로 전체 처리 (PG 호출 없음).
 */
const requestRentalItemsReturn = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { contractId } = req.params;
    const { items: returnRequests, reason } = req.body;
    const userId = req.user.id;

    // { id, returnQuantity } 배열 검증
    if (!Array.isArray(returnRequests) || returnRequests.length === 0) {
      await transaction.rollback();
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400, { details: '반품 신청할 아이템을 선택해주세요.' });
    }
    for (const r of returnRequests) {
      if (!r.id || !Number.isInteger(r.returnQuantity) || r.returnQuantity < 1) {
        await transaction.rollback();
        return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400, { details: `아이템(${r.id})의 returnQuantity가 올바르지 않습니다.` });
      }
    }
    if (!reason || !reason.trim()) {
      await transaction.rollback();
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400, { details: '반품 사유를 입력해주세요.' });
    }

    // returnQuantity Map (itemId → returnQuantity)
    const returnQtyMap = new Map(returnRequests.map(r => [r.id, r.returnQuantity]));
    const itemIds = returnRequests.map(r => r.id);

    // 계약 조회 + 권한 확인
    const contract = await Contract.findByPk(contractId, { transaction });
    if (!contract) {
      await transaction.rollback();
      return error(res, ErrorCodes.CONTRACT_NOT_FOUND, 404);
    }
    if (contract.guestId !== userId) {
      await transaction.rollback();
      return error(res, ErrorCodes.RENTAL_NOT_GUEST, 403);
    }

    // 계약 상태 확인 (입주 전 배송 완료 케이스 포함)
    if (!['PAYMENT_COMPLETED', 'IN_PROGRESS'].includes(contract.status)) {
      await transaction.rollback();
      return error(res, ErrorCodes.RENTAL_MODIFICATION_EXPIRED, 400, {
        details: `현재 계약 상태(${contract.status})에서는 반품 신청이 불가합니다.`
      });
    }

    // 7일 기간 체크 (입주 중일 때만 적용)
    const now = new Date();
    if (contract.status === 'IN_PROGRESS') {
      const stayStartedAt = contract.checkedInAt ? new Date(contract.checkedInAt) : new Date(contract.checkInDate + 'T00:00:00+09:00');
      const cancelRequestDeadline = new Date(stayStartedAt.getTime() + RENTAL_CANCEL_REQUEST_DAYS * 24 * 60 * 60 * 1000);
      if (now > cancelRequestDeadline) {
        await transaction.rollback();
        return error(res, { code: 4421, message: `입주 시작 후 ${RENTAL_CANCEL_REQUEST_DAYS}일이 경과하여 반품 신청이 불가합니다.` }, 400, {
          stayStartedAt: toKSTString(stayStartedAt),
          cancelRequestDeadline: toKSTString(cancelRequestDeadline)
        });
      }
    }

    // 아이템 그룹핑 + 유효성 검증
    let groups;
    try {
      groups = await groupItemsByOrder(itemIds, parseInt(contractId), transaction);
    } catch (validErr) {
      await transaction.rollback();
      return error(res, { code: validErr.code || 4460, message: validErr.message }, validErr.status || 400);
    }

    // returnQuantity 범위 검증 (item.quantity 초과 불가)
    for (const { items } of groups.values()) {
      for (const item of items) {
        const returnQty = returnQtyMap.get(item.id);
        if (returnQty > item.quantity) {
          await transaction.rollback();
          return error(res, { code: 4466, message: `아이템(${item.id})의 반품 수량(${returnQty})이 보유 수량(${item.quantity})을 초과합니다.` }, 400);
        }
      }
    }

    // 배송중/완료 상태 이중 검증
    for (const [, { rentalOrder }] of groups) {
      if (!['IN_TRANSIT', 'DELIVERED'].includes(rentalOrder.deliveryStatus)) {
        await transaction.rollback();
        return error(res, { code: 4470, message: `주문(${rentalOrder.orderId})은 배송 전 상태로 반품 신청이 불가합니다. 결제취소를 이용하세요.` }, 400);
      }
    }

    // 환불 예정 금액 마이너스 체크 (수거비 차감 후 0 이하인 주문은 신청 불가)
    const pendingRetrievalCount = await RentalOrderRefundRequest.count({
      where: {
        contractId: parseInt(contractId),
        retrievalStatus: 'RETRIEVAL_PENDING'
      },
      transaction
    });

    // 이번 신청 전체 기준으로 수거비 1회만 부과 여부 판단
    const anyNeedsRetrievalForCheck = [...groups.values()].some(({ rentalOrder }) =>
      ['IN_TRANSIT', 'DELIVERED'].includes(rentalOrder.deliveryStatus)
    );
    const applyShippingCostForCheck = anyNeedsRetrievalForCheck && pendingRetrievalCount === 0;
    let shippingFeeAppliedForCheck = false;

    for (const [, { rentalOrder, items }] of groups) {
      const itemTotalAmount = items.reduce((sum, item) => {
        const returnQty = returnQtyMap.get(item.id);
        return sum + parseFloat(item.pricePerItem) * returnQty;
      }, 0);
      const needsRetrieval = ['IN_TRANSIT', 'DELIVERED'].includes(rentalOrder.deliveryStatus);

      let shippingDeduction = 0;
      if (needsRetrieval && applyShippingCostForCheck && !shippingFeeAppliedForCheck) {
        shippingDeduction = RETRIEVAL_SHIPPING_COST;
        shippingFeeAppliedForCheck = true;
      }

      if (itemTotalAmount - shippingDeduction <= 0) {
        await transaction.rollback();
        return error(res, { code: 4425, message: `주문(${rentalOrder.orderId})의 환불 예정 금액(${itemTotalAmount}원)이 수거비(${shippingDeduction}원) 이하로 반품 신청이 불가합니다.` }, 400);
      }
    }

    // 주문별 반품 신청 생성 또는 기존 PENDING 요청에 병합 (단일 트랜잭션)
    const requestedOrders = [];
    for (const [, { rentalOrder, items }] of groups) {
      const returnedItemsSummary = [];

      for (const item of items) {
        const returnQty = returnQtyMap.get(item.id);
        const isFullReturn = returnQty === item.quantity;
        const pricePerItem = parseFloat(item.pricePerItem);

        if (isFullReturn) {
          // 전체 반품: 기존 레코드를 CANCEL_REQUESTED로 전환
          await item.update({
            status: 'CANCEL_REQUESTED',
            cancelReason: reason
          }, { transaction });
        } else {
          // 부분 반품: 레코드 분리
          // 1) 기존 레코드 → 남은 수량(ACTIVE 유지)
          const remainQty = item.quantity - returnQty;
          await item.update({
            quantity: remainQty,
            totalPrice: pricePerItem * remainQty
          }, { transaction });

          // 2) 신규 레코드 → 반품 수량(CANCEL_REQUESTED)
          await RentalOrderItem.create({
            rentalOrderId: item.rentalOrderId,
            rentalItemId: item.rentalItemId,
            quantity: returnQty,
            pricePerItem: item.pricePerItem,
            totalPrice: pricePerItem * returnQty,
            status: 'CANCEL_REQUESTED',
            cancelReason: reason
          }, { transaction });
        }

        returnedItemsSummary.push({ id: item.id, name: item.rentalItem?.name, returnQuantity: returnQty, isFullReturn });
      }

      const addedAmount = items.reduce((sum, item) => {
        const returnQty = returnQtyMap.get(item.id);
        return sum + parseFloat(item.pricePerItem) * returnQty;
      }, 0);

      // 기존 PENDING 요청이 있으면 itemTotalAmount 누적, 없으면 신규 생성
      const existingRequest = await RentalOrderRefundRequest.findOne({
        where: { rentalOrderId: rentalOrder.id, status: 'PENDING' },
        transaction
      });

      let refundRequest;
      if (existingRequest) {
        await existingRequest.update({
          itemTotalAmount: parseFloat(existingRequest.itemTotalAmount) + addedAmount
        }, { transaction });
        refundRequest = existingRequest;
      } else {
        refundRequest = await RentalOrderRefundRequest.create({
          rentalOrderId: rentalOrder.id,
          contractId: parseInt(contractId),
          requestedBy: userId,
          status: 'PENDING',
          cancelReason: reason,
          deliveryStatusSnapshot: rentalOrder.deliveryStatus,
          itemTotalAmount: addedAmount
        }, { transaction });
      }

      await logRentalAction({
        contractId: parseInt(contractId),
        rentalOrderId: rentalOrder.id,
        action: 'CANCEL_REQUESTED',
        actor: 'GUEST',
        actorId: userId,
        amountChange: 0,
        balanceAfter: 0,
        metadata: {
          orderId: rentalOrder.orderId,
          refundRequestId: refundRequest.id,
          returnedItems: returnedItemsSummary,
          addedAmount,
          reason,
          deliveryStatus: rentalOrder.deliveryStatus,
          merged: !!existingRequest
        },
        description: existingRequest
          ? `아이템 선택 반품 신청 (기존 요청에 병합): ${reason}`
          : `아이템 선택 반품 신청: ${reason}`,
        req
      }, transaction);

      requestedOrders.push({
        refundRequestId: refundRequest.id,
        orderId: rentalOrder.orderId,
        deliveryStatus: rentalOrder.deliveryStatus,
        addedAmount,
        itemTotalAmount: parseFloat(refundRequest.itemTotalAmount),
        merged: !!existingRequest,
        requestedItems: returnedItemsSummary
      });
    }

    await transaction.commit();

    return success(res, {
      requestedOrders,
      totalOrderCount: requestedOrders.length,
      message: '관리자 확인 후 환불이 처리됩니다.'
    }, '반품 신청이 접수되었습니다.');
  } catch (err) {
    await transaction.rollback();
    console.error('반품 신청 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

const RETRIEVAL_SHIPPING_COST = 7000;

/**
 * 반품 신청 전 환불 예상 금액 조회
 * POST /api/contracts/:contractId/rental-items/return-preview
 *
 * @description 선택한 아이템에 대한 환불 예정 금액 및 수거비 차감 여부 미리 확인.
 *              관리자 승인 로직(approveRentalRefundRequest)과 동일한 기준으로 계산.
 * @body { items: [{ id, returnQuantity }] }
 */
const getReturnRefundPreview = async (req, res) => {
  try {
    const { contractId } = req.params;
    const { items: returnRequests } = req.body;
    const userId = req.user.id;

    if (!Array.isArray(returnRequests) || returnRequests.length === 0) {
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400, { details: '조회할 아이템을 선택해주세요.' });
    }
    for (const r of returnRequests) {
      if (!r.id || !Number.isInteger(r.returnQuantity) || r.returnQuantity < 1) {
        return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400, { details: `아이템(${r.id})의 returnQuantity가 올바르지 않습니다.` });
      }
    }

    const returnQtyMap = new Map(returnRequests.map(r => [r.id, r.returnQuantity]));
    const itemIds = returnRequests.map(r => r.id);

    // 계약 조회 + 권한 확인
    const contract = await Contract.findByPk(contractId);
    if (!contract) return error(res, ErrorCodes.CONTRACT_NOT_FOUND, 404);
    if (contract.guestId !== userId) return error(res, ErrorCodes.RENTAL_NOT_GUEST, 403);

    // 아이템 그룹핑 + 유효성 검증 (트랜잭션 없이 읽기 전용)
    let groups;
    try {
      groups = await groupItemsByOrder(itemIds, parseInt(contractId), null);
    } catch (validErr) {
      return error(res, { code: validErr.code || 4460, message: validErr.message }, validErr.status || 400);
    }

    // returnQuantity 범위 검증
    for (const { items } of groups.values()) {
      for (const item of items) {
        const returnQty = returnQtyMap.get(item.id);
        if (returnQty > item.quantity) {
          return error(res, { code: 4466, message: `아이템(${item.id})의 반품 수량(${returnQty})이 보유 수량(${item.quantity})을 초과합니다.` }, 400);
        }
      }
    }

    // 같은 계약 내 RETRIEVAL_PENDING 건 수 조회 (수거비 면제 판단)
    const pendingRetrievalCount = await RentalOrderRefundRequest.count({
      where: {
        contractId: parseInt(contractId),
        retrievalStatus: 'RETRIEVAL_PENDING'
      }
    });

    // 이번 신청 전체 기준으로 수거비 1회만 부과 여부 판단
    // - 이번 신청에 배송중/완료 주문이 하나라도 있고
    // - 기존에 RETRIEVAL_PENDING 건이 없을 때만 7,000원 1회 차감
    const anyNeedsRetrieval = [...groups.values()].some(({ rentalOrder }) =>
      ['IN_TRANSIT', 'DELIVERED'].includes(rentalOrder.deliveryStatus)
    );
    const applyShippingCost = anyNeedsRetrieval && pendingRetrievalCount === 0;
    let shippingFeeApplied = false;

    const orderPreviews = [];
    let totalItemAmount = 0;
    let totalShippingDeduction = 0;

    for (const [, { rentalOrder, items }] of groups) {
      const itemTotalAmount = items.reduce((sum, item) => {
        const returnQty = returnQtyMap.get(item.id);
        return sum + parseFloat(item.pricePerItem) * returnQty;
      }, 0);
      const needsRetrieval = ['IN_TRANSIT', 'DELIVERED'].includes(rentalOrder.deliveryStatus);

      // 수거비: 이번 신청 전체에서 첫 번째 수거 대상 주문에만 1회 부과
      let shippingDeduction = 0;
      if (needsRetrieval && applyShippingCost && !shippingFeeApplied) {
        shippingDeduction = RETRIEVAL_SHIPPING_COST;
        shippingFeeApplied = true;
      }

      const refundAmount = itemTotalAmount - shippingDeduction;

      orderPreviews.push({
        orderId: rentalOrder.orderId,
        rentalOrderId: rentalOrder.id,
        deliveryStatus: rentalOrder.deliveryStatus,
        itemTotalAmount,
        shippingDeduction,
        refundAmount,
        shippingDeductionReason: shippingDeduction > 0
          ? '배송 완료 상품 수거비'
          : needsRetrieval
            ? '다른 반품 건과 수거 통합으로 면제'
            : '배송 전 (수거비 없음)',
        items: items.map(i => ({
          id: i.id,
          name: i.rentalItem?.name,
          returnQuantity: returnQtyMap.get(i.id),
          pricePerItem: parseFloat(i.pricePerItem),
          itemTotalAmount: parseFloat(i.pricePerItem) * returnQtyMap.get(i.id)
        }))
      });

      totalItemAmount += itemTotalAmount;
      totalShippingDeduction += shippingDeduction;
    }

    return success(res, {
      orderPreviews,
      summary: {
        totalItemAmount,
        totalShippingDeduction,
        totalRefundAmount: totalItemAmount - totalShippingDeduction
      }
    }, '환불 예상 금액 조회 성공');
  } catch (err) {
    console.error('환불 예상 금액 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

module.exports = {
  getRentalOrders,
  createRentalOrder,
  getRentalOrderPaymentInfo,
  confirmRentalPayment,
  cancelRentalOrder,
  cancelPaidRentalOrderByGuest,
  getAvailableRentalItems,
  cancelRentalItemsByGuest,
  requestRentalItemsReturn,
  getReturnRefundPreview
};
