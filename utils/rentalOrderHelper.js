const { Op } = require('sequelize');
const {
  sequelize,
  RentalOrder,
  RentalOrderItem,
  RentalOrderLog,
  RentalItem,
  RentalItemReservation,
  Contract
} = require('../models');

/**
 * 렌탈 주문 시스템 헬퍼 함수
 */

// 상수 정의
const RENTAL_MODIFIABLE_DAYS_BEFORE = 5; // 입주 5일 전까지 수정 가능

// 렌탈 추가/수정이 가능한 계약 상태
// 주의: 결제 전(PENDING_APPROVAL, APPROVED)에는 contracts.rentalItems JSON을 직접 수정하는 별도 API 사용
//       이 상수는 결제 완료 후 RentalOrder를 통한 추가 렌탈에만 적용됨
const RENTAL_MODIFIABLE_STATUSES = [
  'PAYMENT_COMPLETED',  // 결제 완료
  'IN_PROGRESS'         // 입주 중
];

// 렌탈 환불이 가능한 상태
const RENTAL_REFUNDABLE_STATUSES = [
  'PAYMENT_COMPLETED',
  'IN_PROGRESS'
];

/**
 * 렌탈 수정 가능 기간 체크
 * @param {Object} contract - 계약 객체
 * @returns {Object} { modifiable, modifiableUntil, daysRemaining, checkInDate, reason }
 */
function checkRentalModifiable(contract) {
  const now = new Date();
  const checkInDate = new Date(contract.checkInDate);

  // 입주일 5일 전 23:59:59까지 수정 가능
  const modifiableUntil = new Date(checkInDate);
  modifiableUntil.setDate(modifiableUntil.getDate() - RENTAL_MODIFIABLE_DAYS_BEFORE);
  modifiableUntil.setHours(23, 59, 59, 999);

  const modifiable = now <= modifiableUntil;
  const daysRemaining = Math.max(0, Math.ceil((modifiableUntil - now) / (1000 * 60 * 60 * 24)));

  // 계약 상태 체크
  const statusAllowed = RENTAL_MODIFIABLE_STATUSES.includes(contract.status);

  let reason = null;
  if (!modifiable) {
    reason = `입주일 ${RENTAL_MODIFIABLE_DAYS_BEFORE}일 전까지만 렌탈 변경이 가능합니다`;
  } else if (!statusAllowed) {
    reason = `현재 계약 상태(${contract.status})에서는 렌탈 변경이 불가합니다`;
  }

  return {
    modifiable: modifiable && statusAllowed,
    modifiableUntil,
    daysRemaining,
    checkInDate,
    contractStatus: contract.status,
    reason
  };
}

/**
 * 렌탈 주문번호 생성
 * 형식: YYMMDD-R0001
 * @param {Transaction} transaction - Sequelize 트랜잭션
 * @returns {Promise<string>} 주문번호
 */
async function generateRentalOrderId(transaction) {
  const today = new Date();
  const datePrefix = today.toISOString().slice(2, 10).replace(/-/g, '');

  // 오늘 생성된 렌탈 주문 수 조회
  const count = await RentalOrder.count({
    where: {
      orderId: { [Op.like]: `${datePrefix}-R%` }
    },
    transaction
  });

  const sequence = String(count + 1).padStart(4, '0');
  return `${datePrefix}-R${sequence}`;
}

/**
 * 렌탈 금액 계산 (수수료 없음 - 플랫폼 직접 제공 서비스)
 * @param {number} totalAmount - 아이템 합계
 * @returns {Object} { totalAmount }
 */
function calculateRentalAmount(totalAmount) {
  return { totalAmount };
}

/**
 * 수정 가능 기한 계산
 * @param {Date} checkInDate - 체크인 날짜
 * @returns {Date} 수정 가능 기한 (체크인 5일 전 23:59:59)
 */
function calculateModifiableUntil(checkInDate) {
  const modifiableUntil = new Date(checkInDate);
  modifiableUntil.setDate(modifiableUntil.getDate() - RENTAL_MODIFIABLE_DAYS_BEFORE);
  modifiableUntil.setHours(23, 59, 59, 999);
  return modifiableUntil;
}

/**
 * 렌탈 주문 이력 로깅
 * @param {Object} params - 로그 파라미터
 * @param {Transaction} transaction - Sequelize 트랜잭션
 * @returns {Promise<RentalOrderLog>}
 */
async function logRentalAction({
  contractId,
  rentalOrderId = null,
  rentalOrderItemId = null,
  action,
  actor,
  actorId = null,
  amountChange = 0,
  balanceAfter = 0,
  metadata = null,
  description = null,
  req = null
}, transaction = null) {
  const logData = {
    contractId,
    rentalOrderId,
    rentalOrderItemId,
    action,
    actor,
    actorId,
    amountChange,
    balanceAfter,
    metadata,
    description,
    ipAddress: req?.ip || req?.connection?.remoteAddress || null,
    userAgent: req?.headers?.['user-agent']?.substring(0, 500) || null
  };

  const options = transaction ? { transaction } : {};
  return await RentalOrderLog.create(logData, options);
}

/**
 * 계약의 렌탈 요약 정보 조회
 * @param {number} contractId - 계약 ID
 * @param {Transaction} transaction - Sequelize 트랜잭션 (선택)
 * @returns {Promise<Object>} 요약 정보 + 현재 활성 아이템 목록
 */
async function getContractRentalSummary(contractId, transaction = null) {
  const options = transaction ? { transaction } : {};

  const rentalOrders = await RentalOrder.findAll({
    where: { contractId },
    include: [{
      model: RentalOrderItem,
      as: 'items',
      include: [{
        model: RentalItem,
        as: 'rentalItem',
        attributes: ['id', 'name', 'description', 'price', 'imageUrl']
      }]
    }],
    order: [['createdAt', 'ASC']],
    ...options
  });

  let totalPaid = 0;
  let totalRefunded = 0;
  let activeItemsCount = 0;
  const activeItems = [];  // 현재 활성화된 아이템 목록
  const cancelledItems = [];  // 취소된 아이템 목록

  for (const order of rentalOrders) {
    totalPaid += order.paidAmount;
    totalRefunded += order.refundedAmount;

    for (const item of order.items) {
      const itemData = {
        orderItemId: item.id,
        rentalOrderId: order.id,
        orderId: order.orderId,
        orderType: order.orderType,
        orderTypeLabel: RentalOrder.ORDER_TYPE_LABELS[order.orderType],
        rentalItemId: item.rentalItemId,
        name: item.rentalItem?.name || '알 수 없음',
        description: item.rentalItem?.description,
        imageUrl: item.rentalItem?.imageUrl,
        quantity: item.quantity,
        pricePerItem: parseFloat(item.pricePerItem),
        totalPrice: parseFloat(item.totalPrice),
        status: item.status,
        paidAt: order.paidAt,
        createdAt: item.createdAt
      };

      if (item.status === 'ACTIVE') {
        activeItemsCount += item.quantity;
        activeItems.push(itemData);
      } else if (item.status === 'CANCELLED') {
        cancelledItems.push({
          ...itemData,
          cancelledAt: item.cancelledAt,
          cancelReason: item.cancelReason,
          refundAmount: parseFloat(item.refundAmount || 0)
        });
      }
    }
  }

  return {
    // 요약 정보
    totalPaid,
    totalRefunded,
    netAmount: totalPaid - totalRefunded,
    activeItemsCount,
    orderCount: rentalOrders.length,

    // 현재 활성 아이템 목록 (게스트가 볼 최신 상태)
    activeItems,

    // 취소된 아이템 목록 (이력 확인용)
    cancelledItems
  };
}

/**
 * 렌탈 아이템 재고 검증 (기간 기반)
 * @param {Array} items - 렌탈 아이템 배열 [{ itemId, quantity }]
 * @param {Date} checkInDate - 체크인 날짜
 * @param {Date} checkOutDate - 체크아웃 날짜
 * @param {Transaction} transaction - Sequelize 트랜잭션
 * @returns {Promise<Object>} { available, unavailableItems, itemDetails }
 */
async function validateRentalStock(items, checkInDate, checkOutDate, transaction = null) {
  if (!items || !Array.isArray(items) || items.length === 0) {
    return { available: true, unavailableItems: [], itemDetails: [] };
  }

  const unavailableItems = [];
  const itemDetails = [];
  const options = transaction ? { transaction } : {};

  for (const item of items) {
    const rentalItem = await RentalItem.findByPk(item.itemId, options);

    if (!rentalItem) {
      unavailableItems.push({
        itemId: item.itemId,
        itemName: '알 수 없음',
        reason: '아이템을 찾을 수 없습니다'
      });
      continue;
    }

    if (!rentalItem.isActive) {
      unavailableItems.push({
        itemId: item.itemId,
        itemName: rentalItem.name,
        reason: '현재 대여 불가능한 아이템입니다'
      });
      continue;
    }

    // 해당 기간에 이미 예약된 수량 조회
    const reservedQuantity = await RentalItemReservation.sum('quantity', {
      where: {
        rentalItemId: item.itemId,
        status: {
          [Op.in]: ['RESERVED', 'CONFIRMED']
        },
        [Op.or]: [
          {
            reservedFrom: { [Op.between]: [checkInDate, checkOutDate] }
          },
          {
            reservedUntil: { [Op.between]: [checkInDate, checkOutDate] }
          },
          {
            [Op.and]: [
              { reservedFrom: { [Op.lte]: checkInDate } },
              { reservedUntil: { [Op.gte]: checkOutDate } }
            ]
          }
        ]
      },
      ...options
    }) || 0;

    const availableQuantity = rentalItem.availableStock - reservedQuantity;

    if (availableQuantity < item.quantity) {
      unavailableItems.push({
        itemId: item.itemId,
        itemName: rentalItem.name,
        requestedQuantity: item.quantity,
        availableQuantity: Math.max(0, availableQuantity),
        reason: '재고가 부족합니다'
      });
    }

    itemDetails.push({
      itemId: rentalItem.id,
      name: rentalItem.name,
      price: parseFloat(rentalItem.price),
      quantity: item.quantity,
      totalPrice: parseFloat(rentalItem.price) * item.quantity,
      availableQuantity: Math.max(0, availableQuantity)
    });
  }

  return {
    available: unavailableItems.length === 0,
    unavailableItems,
    itemDetails
  };
}

/**
 * 초기 렌탈 주문 생성 (계약 생성 시)
 * @param {number} contractId - 계약 ID
 * @param {Array} items - 렌탈 아이템 배열 [{ itemId, quantity }]
 * @param {Date} checkInDate - 체크인 날짜
 * @param {Date} checkOutDate - 체크아웃 날짜
 * @param {number} guestId - 게스트 ID
 * @param {Object} req - Request 객체 (로깅용)
 * @param {Transaction} transaction - Sequelize 트랜잭션
 * @returns {Promise<RentalOrder>}
 */
async function createInitialRentalOrder(contractId, items, checkInDate, checkOutDate, guestId, req, transaction) {
  if (!items || items.length === 0) {
    return null;
  }

  // 재고 검증
  const stockValidation = await validateRentalStock(items, checkInDate, checkOutDate, transaction);
  if (!stockValidation.available) {
    const unavailable = stockValidation.unavailableItems[0];
    throw new Error(unavailable.reason + `: ${unavailable.itemName}`);
  }

  // 금액 계산 (렌탈 아이템은 수수료 없음 - 플랫폼 직접 제공 서비스)
  const totalAmount = stockValidation.itemDetails.reduce((sum, item) => sum + item.totalPrice, 0);

  // 주문번호 생성
  const orderId = await generateRentalOrderId(transaction);

  // 수정 가능 기한 계산
  const modifiableUntil = calculateModifiableUntil(checkInDate);

  // 스냅샷 생성
  const itemsSnapshot = stockValidation.itemDetails.map(item => ({
    itemId: item.itemId,
    name: item.name,
    quantity: item.quantity,
    pricePerItem: item.price,
    totalPrice: item.totalPrice
  }));

  // RentalOrder 생성
  const rentalOrder = await RentalOrder.create({
    contractId,
    orderId,
    orderType: 'INITIAL',
    totalAmount,
    status: 'PENDING',
    modifiableUntil,
    itemsSnapshot
  }, { transaction });

  // RentalOrderItem 생성
  for (const itemDetail of stockValidation.itemDetails) {
    await RentalOrderItem.create({
      rentalOrderId: rentalOrder.id,
      rentalItemId: itemDetail.itemId,
      quantity: itemDetail.quantity,
      pricePerItem: itemDetail.price,
      totalPrice: itemDetail.totalPrice,
      status: 'ACTIVE'
    }, { transaction });
  }

  // RentalItemReservation 생성
  for (const itemDetail of stockValidation.itemDetails) {
    await RentalItemReservation.create({
      contractId,
      rentalOrderId: rentalOrder.id,
      rentalItemId: itemDetail.itemId,
      quantity: itemDetail.quantity,
      pricePerItem: itemDetail.price,
      totalPrice: itemDetail.totalPrice,
      reservedFrom: checkInDate,
      reservedUntil: checkOutDate,
      status: 'RESERVED'
    }, { transaction });
  }

  // 이력 로깅
  await logRentalAction({
    contractId,
    rentalOrderId: rentalOrder.id,
    action: 'ORDER_CREATED',
    actor: 'GUEST',
    actorId: guestId,
    amountChange: 0,
    balanceAfter: 0,
    metadata: {
      orderType: 'INITIAL',
      orderId,
      items: itemsSnapshot
    },
    description: '초기 렌탈 주문 생성',
    req
  }, transaction);

  return rentalOrder;
}

/**
 * 추가 렌탈 주문 생성
 * @param {Object} contract - 계약 객체
 * @param {Array} items - 렌탈 아이템 배열 [{ itemId, quantity }]
 * @param {number} guestId - 게스트 ID
 * @param {Object} req - Request 객체
 * @param {Transaction} transaction - Sequelize 트랜잭션
 * @returns {Promise<RentalOrder>}
 */
async function createAdditionalRentalOrder(contract, items, guestId, req, transaction) {
  // 수정 가능 여부 체크
  const modifiableCheck = checkRentalModifiable(contract);
  if (!modifiableCheck.modifiable) {
    throw new Error(modifiableCheck.reason);
  }

  // 재고 검증
  const stockValidation = await validateRentalStock(
    items,
    contract.checkInDate,
    contract.checkOutDate,
    transaction
  );
  if (!stockValidation.available) {
    const unavailable = stockValidation.unavailableItems[0];
    throw new Error(unavailable.reason + `: ${unavailable.itemName}`);
  }

  // 금액 계산 (렌탈 아이템은 수수료 없음)
  const totalAmount = stockValidation.itemDetails.reduce((sum, item) => sum + item.totalPrice, 0);

  // 주문번호 생성
  const orderId = await generateRentalOrderId(transaction);

  // 스냅샷 생성
  const itemsSnapshot = stockValidation.itemDetails.map(item => ({
    itemId: item.itemId,
    name: item.name,
    quantity: item.quantity,
    pricePerItem: item.price,
    totalPrice: item.totalPrice
  }));

  // RentalOrder 생성
  const rentalOrder = await RentalOrder.create({
    contractId: contract.id,
    orderId,
    orderType: 'ADDITIONAL',
    totalAmount,
    status: 'PENDING',
    modifiableUntil: modifiableCheck.modifiableUntil,
    itemsSnapshot
  }, { transaction });

  // RentalOrderItem 생성
  for (const itemDetail of stockValidation.itemDetails) {
    await RentalOrderItem.create({
      rentalOrderId: rentalOrder.id,
      rentalItemId: itemDetail.itemId,
      quantity: itemDetail.quantity,
      pricePerItem: itemDetail.price,
      totalPrice: itemDetail.totalPrice,
      status: 'ACTIVE'
    }, { transaction });
  }

  // RentalItemReservation 생성 (RESERVED 상태)
  for (const itemDetail of stockValidation.itemDetails) {
    await RentalItemReservation.create({
      contractId: contract.id,
      rentalOrderId: rentalOrder.id,
      rentalItemId: itemDetail.itemId,
      quantity: itemDetail.quantity,
      pricePerItem: itemDetail.price,
      totalPrice: itemDetail.totalPrice,
      reservedFrom: contract.checkInDate,
      reservedUntil: contract.checkOutDate,
      status: 'RESERVED'
    }, { transaction });
  }

  // 이력 로깅
  await logRentalAction({
    contractId: contract.id,
    rentalOrderId: rentalOrder.id,
    action: 'ORDER_CREATED',
    actor: 'GUEST',
    actorId: guestId,
    amountChange: 0,
    balanceAfter: 0,
    metadata: {
      orderType: 'ADDITIONAL',
      orderId,
      items: itemsSnapshot
    },
    description: '추가 렌탈 주문 생성',
    req
  }, transaction);

  return rentalOrder;
}

/**
 * 렌탈 주문 결제 확정
 * @param {RentalOrder} rentalOrder - 렌탈 주문 객체
 * @param {string} paymentKey - 토스페이먼츠 결제키
 * @param {string} paymentMethod - 결제 수단
 * @param {number} actorId - 행위자 ID
 * @param {Object} req - Request 객체
 * @param {Transaction} transaction - Sequelize 트랜잭션
 * @returns {Promise<RentalOrder>}
 */
async function confirmRentalOrderPayment(rentalOrder, paymentKey, paymentMethod, actorId, req, transaction) {
  if (rentalOrder.status !== 'PENDING') {
    throw new Error('결제 대기 상태의 주문만 결제할 수 있습니다');
  }

  const paidAt = new Date();

  // RentalOrder 업데이트
  await rentalOrder.update({
    status: 'PAID',
    paymentKey,
    paymentMethod,
    paidAmount: rentalOrder.totalAmount,
    paidAt
  }, { transaction });

  // RentalItemReservation 상태 업데이트 (RESERVED → CONFIRMED)
  await RentalItemReservation.update(
    { status: 'CONFIRMED' },
    {
      where: {
        rentalOrderId: rentalOrder.id,
        status: 'RESERVED'
      },
      transaction
    }
  );

  // 현재 잔액 계산
  const summary = await getContractRentalSummary(rentalOrder.contractId, transaction);

  // 이력 로깅
  await logRentalAction({
    contractId: rentalOrder.contractId,
    rentalOrderId: rentalOrder.id,
    action: 'PAYMENT_COMPLETED',
    actor: 'GUEST',
    actorId,
    amountChange: rentalOrder.totalAmount,
    balanceAfter: summary.netAmount,
    metadata: {
      paymentKey,
      paymentMethod,
      amount: rentalOrder.totalAmount
    },
    description: '렌탈 주문 결제 완료',
    req
  }, transaction);

  return rentalOrder;
}

/**
 * 렌탈 아이템 취소 (환불)
 * @param {RentalOrderItem} orderItem - 주문 아이템 객체
 * @param {RentalOrder} rentalOrder - 렌탈 주문 객체
 * @param {string} reason - 취소 사유
 * @param {number} actorId - 행위자 ID
 * @param {string} actor - 행위자 유형 (GUEST, ADMIN)
 * @param {Object} req - Request 객체
 * @param {Transaction} transaction - Sequelize 트랜잭션
 * @returns {Promise<Object>} 환불 정보
 */
async function cancelRentalOrderItem(orderItem, rentalOrder, reason, actorId, actor, req, transaction) {
  if (orderItem.status !== 'ACTIVE') {
    throw new Error('이미 취소된 아이템입니다');
  }

  if (!['PAID', 'PARTIAL_REFUND'].includes(rentalOrder.status)) {
    throw new Error('결제된 주문만 환불할 수 있습니다');
  }

  const refundAmount = parseFloat(orderItem.totalPrice);

  // RentalOrderItem 취소
  await orderItem.update({
    status: 'CANCELLED',
    cancelledAt: new Date(),
    cancelReason: reason,
    refundAmount
  }, { transaction });

  // RentalOrder 환불 금액 업데이트
  const newRefundedAmount = rentalOrder.refundedAmount + refundAmount;
  const allItemsCancelled = await RentalOrderItem.count({
    where: {
      rentalOrderId: rentalOrder.id,
      status: 'ACTIVE'
    },
    transaction
  }) === 0;

  await rentalOrder.update({
    refundedAmount: newRefundedAmount,
    status: allItemsCancelled ? 'FULLY_REFUNDED' : 'PARTIAL_REFUND'
  }, { transaction });

  // RentalItemReservation 취소
  await RentalItemReservation.update(
    { status: 'CANCELLED' },
    {
      where: {
        rentalOrderId: rentalOrder.id,
        rentalItemId: orderItem.rentalItemId
      },
      transaction
    }
  );

  // 현재 잔액 계산
  const summary = await getContractRentalSummary(rentalOrder.contractId, transaction);

  // 이력 로깅
  await logRentalAction({
    contractId: rentalOrder.contractId,
    rentalOrderId: rentalOrder.id,
    rentalOrderItemId: orderItem.id,
    action: 'ITEM_CANCELLED',
    actor,
    actorId,
    amountChange: -refundAmount,
    balanceAfter: summary.netAmount,
    metadata: {
      itemId: orderItem.rentalItemId,
      itemName: orderItem.rentalItem?.name || '알 수 없음',
      quantity: orderItem.quantity,
      refundAmount,
      reason
    },
    description: `아이템 취소: ${reason || '사유 없음'}`,
    req
  }, transaction);

  return {
    itemId: orderItem.id,
    refundAmount,
    orderStatus: allItemsCancelled ? 'FULLY_REFUNDED' : 'PARTIAL_REFUND'
  };
}

/**
 * 미결제 렌탈 주문 취소
 * @param {RentalOrder} rentalOrder - 렌탈 주문 객체
 * @param {number} actorId - 행위자 ID
 * @param {Object} req - Request 객체
 * @param {Transaction} transaction - Sequelize 트랜잭션
 * @returns {Promise<void>}
 */
async function cancelPendingRentalOrder(rentalOrder, actorId, req, transaction) {
  if (rentalOrder.status !== 'PENDING') {
    throw new Error('미결제 주문만 취소할 수 있습니다');
  }

  // RentalOrder 취소
  await rentalOrder.update({
    status: 'CANCELLED'
  }, { transaction });

  // RentalOrderItem 취소
  await RentalOrderItem.update(
    { status: 'CANCELLED', cancelledAt: new Date() },
    {
      where: { rentalOrderId: rentalOrder.id },
      transaction
    }
  );

  // RentalItemReservation 취소
  await RentalItemReservation.update(
    { status: 'CANCELLED' },
    {
      where: { rentalOrderId: rentalOrder.id },
      transaction
    }
  );

  // 이력 로깅
  await logRentalAction({
    contractId: rentalOrder.contractId,
    rentalOrderId: rentalOrder.id,
    action: 'ORDER_CANCELLED',
    actor: 'GUEST',
    actorId,
    amountChange: 0,
    balanceAfter: 0,
    metadata: {
      orderId: rentalOrder.orderId,
      orderType: rentalOrder.orderType
    },
    description: '미결제 주문 취소',
    req
  }, transaction);
}

module.exports = {
  // 상수
  RENTAL_MODIFIABLE_DAYS_BEFORE,
  RENTAL_MODIFIABLE_STATUSES,
  RENTAL_REFUNDABLE_STATUSES,

  // 체크 함수
  checkRentalModifiable,

  // 계산 함수
  calculateRentalAmount,
  calculateModifiableUntil,
  generateRentalOrderId,

  // 조회 함수
  getContractRentalSummary,
  validateRentalStock,

  // 생성/수정 함수
  createInitialRentalOrder,
  createAdditionalRentalOrder,
  confirmRentalOrderPayment,
  cancelRentalOrderItem,
  cancelPendingRentalOrder,

  // 로깅 함수
  logRentalAction
};
