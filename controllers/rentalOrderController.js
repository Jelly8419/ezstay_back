const { Op } = require('sequelize');
const {
  sequelize,
  Contract,
  RentalOrder,
  RentalOrderItem,
  RentalOrderLog,
  RentalItem,
  RentalItemReservation,
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
  cancelRentalOrderItem,
  cancelPendingRentalOrder,
  logRentalAction
} = require('../utils/rentalOrderHelper');

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
      attributes: ['email', 'name', 'phone']
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
      customerPhone: user.phone
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

    // 금액 확인
    if (rentalOrder.totalAmount !== amount) {
      await transaction.rollback();
      return error(res, ErrorCodes.RENTAL_AMOUNT_MISMATCH, 400);
    }

    // 결제 가능 상태 확인
    if (rentalOrder.status !== 'PENDING') {
      await transaction.rollback();
      return error(res, ErrorCodes.RENTAL_ORDER_NOT_PAYABLE, 400);
    }

    // TODO: 토스페이먼츠 결제 승인 API 호출
    // const tossResponse = await confirmTossPayment(paymentKey, orderId, amount);
    // 현재는 결제 성공으로 가정

    // 결제 확정 처리
    await confirmRentalOrderPayment(
      rentalOrder,
      paymentKey,
      'CARD', // TODO: 실제 결제 수단
      userId,
      req,
      transaction
    );

    await transaction.commit();

    return success(res, {
      rentalOrderId: rentalOrder.id,
      orderId: rentalOrder.orderId,
      status: 'PAID',
      paidAmount: rentalOrder.totalAmount,
      paidAt: rentalOrder.paidAt,
      paymentKey
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
 * 렌탈 아이템 취소 (환불)
 * POST /api/rental-orders/:rentalOrderId/items/:itemId/cancel
 */
const cancelRentalItem = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { rentalOrderId, itemId } = req.params;
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

    // 수정 가능 여부 확인
    const modifiableInfo = checkRentalModifiable(rentalOrder.contract);
    if (!modifiableInfo.modifiable) {
      await transaction.rollback();
      return error(res, ErrorCodes.RENTAL_MODIFICATION_EXPIRED, 400, {
        details: modifiableInfo.reason
      });
    }

    // 환불 가능 상태 확인
    if (!['PAID', 'PARTIAL_REFUND'].includes(rentalOrder.status)) {
      await transaction.rollback();
      return error(res, ErrorCodes.RENTAL_ORDER_NOT_REFUNDABLE, 400);
    }

    // 주문 아이템 조회
    const orderItem = await RentalOrderItem.findOne({
      where: {
        id: itemId,
        rentalOrderId: rentalOrder.id
      },
      include: [{
        model: RentalItem,
        as: 'rentalItem'
      }],
      transaction
    });

    if (!orderItem) {
      await transaction.rollback();
      return error(res, ErrorCodes.RENTAL_ORDER_ITEM_NOT_FOUND, 404);
    }

    // 이미 취소된 아이템 확인
    if (orderItem.status === 'CANCELLED') {
      await transaction.rollback();
      return error(res, ErrorCodes.RENTAL_ITEM_ALREADY_CANCELLED, 400);
    }

    // TODO: 토스페이먼츠 부분 환불 API 호출
    // const refundResponse = await partialRefundTossPayment(
    //   rentalOrder.paymentKey,
    //   parseFloat(orderItem.totalPrice),
    //   reason
    // );

    // 아이템 취소 처리
    const result = await cancelRentalOrderItem(
      orderItem,
      rentalOrder,
      reason,
      userId,
      'GUEST',
      req,
      transaction
    );

    await transaction.commit();

    return success(res, {
      itemId: result.itemId,
      itemName: orderItem.rentalItem?.name,
      refundAmount: result.refundAmount,
      refundStatus: 'COMPLETED',
      cancelledAt: orderItem.cancelledAt,
      orderStatus: result.orderStatus
    }, '아이템이 취소되었습니다. 환불이 처리됩니다.');
  } catch (err) {
    await transaction.rollback();
    console.error('렌탈 아이템 취소 오류:', err);
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
  cancelRentalItem,
  getAvailableRentalItems
};
