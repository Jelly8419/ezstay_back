const { Op } = require('sequelize');
const axios = require('axios');
const {
  sequelize,
  Contract,
  RentalOrder,
  RentalOrderItem,
  RentalOrderLog,
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
  RENTAL_CANCEL_REQUEST_DAYS
} = require('../utils/rentalOrderHelper');
const NotificationService = require('../services/notificationService');

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
      deliveredAt: order.deliveredAt,
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
      modifiableUntil: modifiableInfo.modifiableUntil,
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
      modifiableUntil: createdOrder.modifiableUntil,
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

    return success(res, {
      rentalOrderId: rentalOrder.id,
      orderId: rentalOrder.orderId,
      amount: rentalOrder.totalAmount,
      orderName,
      customerEmail: user.email,
      customerName: user.name,
      customerPhone: user.phoneNumber
    });
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
  const transaction = await sequelize.transaction();

  try {
    const { rentalOrderId } = req.params;
    const { paymentKey, orderId, amount } = req.body;
    const userId = req.user.id;

    // 입력 검증
    if (!paymentKey || !orderId || !amount) {
      await transaction.rollback();
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400);
    }

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

    // 주문번호 확인
    if (rentalOrder.orderId !== orderId) {
      await transaction.rollback();
      return error(res, ErrorCodes.ORDER_ID_MISMATCH, 400);
    }

    // 금액 확인 (클라이언트 변조 방지)
    if (rentalOrder.totalAmount !== parseInt(amount, 10)) {
      await transaction.rollback();
      return error(res, ErrorCodes.RENTAL_AMOUNT_MISMATCH, 400);
    }

    // 결제 가능 상태 확인
    if (rentalOrder.status !== 'PENDING') {
      await transaction.rollback();
      return error(res, ErrorCodes.RENTAL_ORDER_NOT_PAYABLE, 400);
    }

    // 토스페이먼츠 API 호출
    const tossSecretKey = process.env.TOSS_SECRET_KEY;
    const encodedKey = Buffer.from(`${tossSecretKey}:`).toString('base64');

    let tossResponse;
    try {
      tossResponse = await axios.post(
        'https://api.tosspayments.com/v1/payments/confirm',
        {
          paymentKey,
          orderId,
          amount: parseInt(amount, 10)
        },
        {
          headers: {
            Authorization: `Basic ${encodedKey}`,
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (tossError) {
      await transaction.rollback();

      // 실패 로그 기록
      await RentalPaymentFailureLog.create({
        rentalOrderId: rentalOrder.id,
        contractId: rentalOrder.contractId,
        orderId,
        failureCode: tossError.response?.data?.code || 'UNKNOWN',
        failureMessage: tossError.response?.data?.message || tossError.message,
        requestData: { paymentKey, orderId, amount },
        responseData: tossError.response?.data || null,
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip || req.connection.remoteAddress
      });

      console.error('렌탈 토스 결제 승인 실패:', tossError.response?.data || tossError.message);
      return error(res, ErrorCodes.PAYMENT_CONFIRMATION_FAILED, 400, {
        tossErrorCode: tossError.response?.data?.code,
        tossErrorMessage: tossError.response?.data?.message
      });
    }

    const paymentData = tossResponse.data;
    const now = new Date();

    console.log('🔍 토스 결제 응답:', JSON.stringify(paymentData, null, 2));

    // 토스 method를 RentalPayment ENUM으로 매핑
    const mapPaymentMethod = (tossMethod) => {
      const methodMap = {
        'CARD': 'CARD',
        'card': 'CARD',
        '카드': 'CARD',
        'VIRTUAL_ACCOUNT': 'VIRTUAL_ACCOUNT',
        'TRANSFER': 'TRANSFER',
        'MOBILE': 'MOBILE',
        'EASY_PAY': 'EASY_PAY',
        '간편결제': 'EASY_PAY'
      };
      return methodMap[tossMethod] || 'CARD';
    };

    // RentalPayment 레코드 생성
    await RentalPayment.create({
      rentalOrderId: rentalOrder.id,
      contractId: rentalOrder.contractId,
      paymentKey: paymentData.paymentKey,
      orderId: paymentData.orderId,
      method: mapPaymentMethod(paymentData.method),
      status: paymentData.status,
      requestedAt: new Date(paymentData.requestedAt),
      approvedAt: paymentData.approvedAt ? new Date(paymentData.approvedAt) : now,
      totalAmount: paymentData.totalAmount,
      balanceAmount: paymentData.balanceAmount,
      suppliedAmount: paymentData.suppliedAmount,
      vat: paymentData.vat,
      taxFreeAmount: paymentData.taxFreeAmount || 0,
      currency: paymentData.currency || 'KRW',
      receiptUrl: paymentData.receipt?.url || null,
      checkoutUrl: paymentData.checkout?.url || null,
      paymentResponse: paymentData
    }, { transaction });

    // 결제 확정 처리
    await confirmRentalOrderPayment(
      rentalOrder,
      paymentData.paymentKey,
      paymentData.method || 'CARD',
      userId,
      req,
      transaction
    );

    await transaction.commit();

    // 옵션 결제 완료 알림 발송 (트랜잭션 완료 후)
    try {
      // 주문 아이템 조회 (알림톡 변수용)
      const orderItems = await RentalOrderItem.findAll({
        where: { rentalOrderId: rentalOrder.id },
        include: [{ model: RentalItem, as: 'rentalItem', attributes: ['name'] }]
      });
      const optionItems = orderItems.map(i => `${i.rentalItem?.name || '옵션'} ${i.quantity}개`).join(', ');

      await NotificationService.notifyAdditionalOptionPayment(rentalOrder.contract, {
        optionItems,
        amount: paymentData.totalAmount
      });
    } catch (notifyErr) {
      console.error('옵션 결제 완료 알림 발송 실패:', notifyErr);
      // 알림 실패해도 결제는 성공 처리
    }

    return success(res, {
      rentalOrderId: rentalOrder.id,
      orderId: rentalOrder.orderId,
      status: 'PAID',
      paidAmount: paymentData.totalAmount,
      paidAt: now,
      paymentKey: paymentData.paymentKey,
      receiptUrl: paymentData.receipt?.url || null
    }, '결제가 완료되었습니다.');
  } catch (err) {
    await transaction.rollback();
    console.error('렌탈 주문 결제 승인 오류:', err);
    return error(res, ErrorCodes.PAYMENT_CONFIRMATION_FAILED, 500, {
      details: err.message
    });
  }
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
      const stayStartedAt = contract.checkedInAt ? new Date(contract.checkedInAt) : new Date(contract.checkInDate);
      const cancelRequestDeadline = new Date(stayStartedAt.getTime() + RENTAL_CANCEL_REQUEST_DAYS * 24 * 60 * 60 * 1000);

      if (now > cancelRequestDeadline) {
        await transaction.rollback();
        return error(res, {
          code: 4421,
          message: `입주 시작 후 ${RENTAL_CANCEL_REQUEST_DAYS}일이 경과하여 취소 요청이 불가합니다.`
        }, 400, {
          stayStartedAt: stayStartedAt.toISOString(),
          cancelRequestDeadline: cancelRequestDeadline.toISOString()
        });
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
          requestedAt: now.toISOString(),
          cancelRequestDeadline: cancelRequestDeadline.toISOString()
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

    // 주문 전체 취소 + 환불 (배송 상태별 차감은 cancelPaidRentalOrder 내부에서 처리)
    const result = await cancelPaidRentalOrder(
      rentalOrder,
      reason,
      userId,
      'GUEST',
      req,
      transaction
    );

    await transaction.commit();

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
  } catch (err) {
    await transaction.rollback();
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

        const availableQuantity = Math.max(0, item.availableStock - reservedQuantity);

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
      modifiableUntil: modifiableInfo.modifiableUntil,
      checkInDate: contract.checkInDate,
      checkOutDate: contract.checkOutDate,
      items: itemsWithAvailability
    });
  } catch (err) {
    console.error('이용 가능한 렌탈 아이템 조회 오류:', err);
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
  getAvailableRentalItems
};
