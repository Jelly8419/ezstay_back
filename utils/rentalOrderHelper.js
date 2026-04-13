const { Op } = require('sequelize');
const paytagClient = require('./paytagClient');
const { toDateStrKST } = require('./dateHelper');

/**
 * 렌탈 물품 배송·회수 버퍼 일수
 * 실제 계약 기간 앞뒤로 이 일수만큼 재고를 점유 중으로 간주한다.
 * 배송/회수 시스템이 체계화되면 0으로 변경하거나 제거할 것.
 */
const RENTAL_BUFFER_DAYS = 3;
const {
  sequelize,
  RentalOrder,
  RentalOrderItem,
  RentalOrderLog,
  RentalItem,
  RentalItemReservation,
  RentalPayment
} = require('../models');

/**
 * 렌탈 주문 시스템 헬퍼 함수
 */

// 상수 정의
const RENTAL_MODIFIABLE_DAYS_BEFORE = 5; // 입주 5일 전까지 수정 가능
const RENTAL_ROUND_TRIP_SHIPPING_COST = 7000; // 왕복배송비 (원)
const RENTAL_CANCEL_REQUEST_DAYS = 7; // 입주 중 취소 요청 가능 기간 (일, 7*24h)

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
  const datePrefix = toDateStrKST(today).slice(2).replace(/-/g, '');

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
    where: {
      contractId,
      status: ['PAID', 'PARTIAL_REFUND']  // 결제된 주문만 조회
    },
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

    let availableQuantity;

    if (rentalItem.salesType === 'SALE') {
      // SALE: 날짜 무관, totalStock 직접 비교
      availableQuantity = rentalItem.totalStock;
    } else {
      // RENTAL: 해당 기간에 이미 예약된 수량 조회 (배송·회수 버퍼 적용)
      const bufferMs = RENTAL_BUFFER_DAYS * 24 * 60 * 60 * 1000;
      const bufferedFrom = new Date(checkInDate.getTime() - bufferMs);
      const bufferedUntil = new Date(checkOutDate.getTime() + bufferMs);

      const reservedQuantity = await RentalItemReservation.sum('quantity', {
        where: {
          rentalItemId: item.itemId,
          status: {
            [Op.in]: ['RESERVED', 'CONFIRMED']
          },
          [Op.or]: [
            {
              reservedFrom: { [Op.between]: [bufferedFrom, bufferedUntil] }
            },
            {
              reservedUntil: { [Op.between]: [bufferedFrom, bufferedUntil] }
            },
            {
              [Op.and]: [
                { reservedFrom: { [Op.lte]: bufferedFrom } },
                { reservedUntil: { [Op.gte]: bufferedUntil } }
              ]
            }
          ]
        },
        ...options
      }) || 0;

      availableQuantity = rentalItem.totalStock - reservedQuantity;
    }

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
      salesType: rentalItem.salesType,
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

  // 재고 처리
  // SALE: 계약 생성 시 이미 totalStock 차감됨 → 변경 없음
  // RENTAL: 계약 생성 시 생성된 RESERVED Reservation을 rentalOrderId 연결 후 CONFIRMED로 업데이트
  for (const itemDetail of stockValidation.itemDetails) {
    if (itemDetail.salesType !== 'SALE') {
      await RentalItemReservation.update(
        {
          rentalOrderId: rentalOrder.id,
          status: 'CONFIRMED'
        },
        {
          where: {
            contractId,
            rentalItemId: itemDetail.itemId,
            status: 'RESERVED'
          },
          transaction
        }
      );
    }
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

  // 재고 처리: RENTAL → Reservation 생성, SALE → totalStock 차감
  for (const itemDetail of stockValidation.itemDetails) {
    if (itemDetail.salesType === 'SALE') {
      await RentalItem.decrement('totalStock', {
        by: itemDetail.quantity,
        where: { id: itemDetail.itemId },
        transaction
      });
    } else {
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
/**
 * 결제된 렌탈 주문 전체 취소 (주문번호 단위)
 * - 정책: 취소는 주문번호별로만 가능 (아이템 개별 취소 불가)
 * - 배송 상태에 따라 왕복배송비 차감
 *
 * @param {RentalOrder} rentalOrder - 렌탈 주문 객체 (items include 필요)
 * @param {string} reason - 취소 사유
 * @param {number} actorId - 행위자 ID
 * @param {string} actor - 행위자 유형 (GUEST, ADMIN)
 * @param {Object} req - Request 객체
 * @param {Transaction} transaction - Sequelize 트랜잭션
 * @returns {Promise<Object>} 환불 정보
 */
async function cancelPaidRentalOrder(rentalOrder, reason, actorId, actor, req, transaction, options = {}) {
  if (!['PAID', 'PARTIAL_REFUND'].includes(rentalOrder.status)) {
    throw new Error('결제된 주문만 환불할 수 있습니다');
  }

  // 활성 아이템 조회
  const activeItems = await RentalOrderItem.findAll({
    where: {
      rentalOrderId: rentalOrder.id,
      status: 'ACTIVE'
    },
    include: [{ model: RentalItem, as: 'rentalItem' }],
    transaction
  });

  if (activeItems.length === 0) {
    throw new Error('취소할 활성 아이템이 없습니다');
  }

  // 주문 총액 계산
  const orderTotalPrice = activeItems.reduce((sum, item) => sum + parseFloat(item.totalPrice), 0);

  // 배송 상태별 환불 금액 결정
  let refundAmount = orderTotalPrice;
  let shippingDeduction = 0;

  // DELIVERED/IN_TRANSIT 모두 즉시 환불 가능 (PAYMENT_COMPLETED 케이스)
  // 입주중(IN_PROGRESS) 케이스는 이 함수를 거치지 않음 (RentalOrderRefundRequest로 관리)
  if (rentalOrder.deliveryStatus === 'IN_TRANSIT') {
    shippingDeduction = RENTAL_ROUND_TRIP_SHIPPING_COST;
    refundAmount = orderTotalPrice - shippingDeduction;
    if (refundAmount <= 0) {
      throw new Error(`환불 금액(${orderTotalPrice}원)이 왕복배송비(${RENTAL_ROUND_TRIP_SHIPPING_COST}원) 이하이므로 환불할 수 없습니다`);
    }
  }

  // 결제 정보 조회
  const rentalPayment = await RentalPayment.findOne({
    where: { rentalOrderId: rentalOrder.id },
    transaction
  });

  if (!rentalPayment) {
    throw new Error('결제 정보를 찾을 수 없습니다');
  }

  // 환불 가능 금액 확인
  if (rentalPayment.balanceAmount < refundAmount) {
    throw new Error(`환불 가능 금액이 부족합니다. (가능: ${rentalPayment.balanceAmount}원, 요청: ${refundAmount}원)`);
  }

  // RentalPayment 잔액 업데이트 (DB만 변경)
  const newBalance = rentalPayment.balanceAmount - refundAmount;
  await rentalPayment.update({
    balanceAmount: newBalance,
    status: newBalance === 0 ? 'CANCELED' : 'PARTIAL_CANCELED'
  }, { transaction });

  // 모든 활성 RentalOrderItem 취소
  const cancelledAt = new Date();
  for (const item of activeItems) {
    await item.update({
      status: 'CANCELLED',
      cancelledAt,
      cancelReason: reason,
      refundAmount: parseFloat(item.totalPrice)
    }, { transaction });
  }

  // RentalOrder 상태 업데이트
  await rentalOrder.update({
    refundedAmount: parseFloat(rentalOrder.refundedAmount || 0) + refundAmount,
    status: 'FULLY_REFUNDED'
  }, { transaction });

  // 재고 복구: RENTAL → Reservation CANCELLED, SALE → 배송 전이면 totalStock 복구
  const rentalTypeItemIds = [];
  for (const item of activeItems) {
    if (item.rentalItem?.salesType === 'SALE') {
      // SALE: 배송 전(PENDING)에만 재고 복구
      if (rentalOrder.deliveryStatus === 'PENDING') {
        await RentalItem.increment('totalStock', {
          by: item.quantity,
          where: { id: item.rentalItemId },
          transaction
        });
      }
    } else {
      rentalTypeItemIds.push(item.rentalItemId);
    }
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
        transaction
      }
    );
  }

  // 현재 잔액 계산
  const summary = await getContractRentalSummary(rentalOrder.contractId, transaction);

  // 이력 로깅
  await logRentalAction({
    contractId: rentalOrder.contractId,
    rentalOrderId: rentalOrder.id,
    rentalOrderItemId: null,
    action: 'ORDER_CANCELLED',
    actor,
    actorId,
    amountChange: -refundAmount,
    balanceAfter: summary.netAmount,
    metadata: {
      orderId: rentalOrder.orderId,
      itemCount: activeItems.length,
      items: activeItems.map(item => ({
        itemId: item.rentalItemId,
        itemName: item.rentalItem?.name || '알 수 없음',
        quantity: item.quantity,
        price: parseFloat(item.totalPrice)
      })),
      orderTotalPrice,
      refundAmount,
      shippingDeduction,
      deliveryStatus: rentalOrder.deliveryStatus,
      reason,
      paymentKey: rentalPayment.paymentKey,
      ...(options.pgResponse && { pgResponse: options.pgResponse })
    },
    description: shippingDeduction > 0
      ? `주문 전체 취소 및 환불 (배송비 ${shippingDeduction}원 차감): ${reason || '사유 없음'}`
      : `주문 전체 취소 및 환불: ${reason || '사유 없음'}`,
    req
  }, transaction);

  return {
    orderId: rentalOrder.orderId,
    refundAmount,
    shippingDeduction,
    cancelledItemCount: activeItems.length,
    orderStatus: 'FULLY_REFUNDED'
  };
}

/**
 * 관리자 렌탈 주문 부분 환불 (금액 단위)
 * - 관리자가 직접 환불 금액을 지정하는 방식
 * - PG 취소는 호출부(adminPaymentController)에서 처리 (계약 PG와 통합 취소 가능)
 * @param {RentalOrder} rentalOrder - 렌탈 주문 객체 (RentalPayment include 필요)
 * @param {number} refundAmount - 환불 금액
 * @param {string} reason - 환불 사유
 * @param {number} actorId - 관리자 ID
 * @param {Object} req - Request 객체
 * @param {Transaction} transaction - Sequelize 트랜잭션
 * @returns {Promise<{ newBalance: number, newStatus: string }>}
 */
async function partialRefundRentalOrder(rentalOrder, refundAmount, reason, actorId, req, transaction) {
  if (!['PAID', 'PARTIAL_REFUND'].includes(rentalOrder.status)) {
    throw new Error('결제된 주문만 환불할 수 있습니다');
  }

  const rentalPayment = await RentalPayment.findOne({
    where: { rentalOrderId: rentalOrder.id },
    transaction
  });

  if (!rentalPayment) {
    throw new Error('렌탈 결제 정보를 찾을 수 없습니다');
  }

  const availableBalance = rentalPayment.balanceAmount;
  if (refundAmount > availableBalance) {
    throw new Error(`렌탈 환불 가능 금액 초과 (가능: ${availableBalance}원, 요청: ${refundAmount}원)`);
  }

  const newBalance = availableBalance - refundAmount;
  const newPaymentStatus = newBalance === 0 ? 'CANCELED' : 'PARTIAL_CANCELED';

  await rentalPayment.update({
    balanceAmount: newBalance,
    status: newPaymentStatus
  }, { transaction });

  const newRefundedAmount = parseFloat(rentalOrder.refundedAmount || 0) + refundAmount;
  const newOrderStatus = newRefundedAmount >= parseFloat(rentalOrder.paidAmount)
    ? 'FULLY_REFUNDED'
    : 'PARTIAL_REFUND';

  await rentalOrder.update({
    refundedAmount: newRefundedAmount,
    status: newOrderStatus
  }, { transaction });

  const summary = await getContractRentalSummary(rentalOrder.contractId, transaction);

  await logRentalAction({
    contractId: rentalOrder.contractId,
    rentalOrderId: rentalOrder.id,
    action: 'REFUND_COMPLETED',
    actor: 'ADMIN',
    actorId,
    amountChange: -refundAmount,
    balanceAfter: summary.netAmount,
    metadata: { refundAmount, reason, newBalance, newOrderStatus },
    description: `관리자 환불 처리: ${refundAmount}원 (${reason || '사유 없음'})`,
    req
  }, transaction);

  return {
    rentalPaymentId: rentalPayment.id,
    newBalance,
    newPaymentStatus,
    newOrderStatus
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

/**
 * 아이템 ID 배열을 rentalOrder 단위로 그룹핑 + 유효성 검증
 *
 * @param {number[]} itemIds - rental_order_items.id 배열
 * @param {number} contractId - 소유권 확인용 계약 ID
 * @param {Transaction} transaction
 * @returns {Promise<Map<number, { rentalOrder, rentalPayment, items[] }>>}
 *   key: rentalOrderId
 *
 * @throws 아이템 미존재 / 소유권 불일치 / ACTIVE 아닌 상태 시 Error
 */
async function groupItemsByOrder(itemIds, contractId, transaction) {
  const options = transaction ? { transaction } : {};
  const groups = new Map();
  const seenItemIds = new Set();

  for (const itemId of itemIds) {
    if (seenItemIds.has(itemId)) {
      throw Object.assign(new Error(`아이템(${itemId})이 중복 요청되었습니다.`), { code: 4464, status: 400 });
    }
    seenItemIds.add(itemId);
    const item = await RentalOrderItem.findByPk(itemId, {
      include: [{
        model: RentalOrder,
        as: 'order',
        include: [{ model: RentalPayment, as: 'payment', required: false }]
      }, {
        model: RentalItem,
        as: 'rentalItem',
        attributes: ['id', 'name']
      }],
      ...options
    });

    if (!item) {
      throw Object.assign(new Error(`아이템(${itemId})을 찾을 수 없습니다.`), { code: 4460, status: 404 });
    }
    if (item.order.contractId !== contractId) {
      throw Object.assign(new Error(`아이템(${itemId})이 해당 계약에 속하지 않습니다.`), { code: 4461, status: 403 });
    }
    if (item.status !== 'ACTIVE') {
      throw Object.assign(new Error(`아이템(${itemId})은 취소 가능한 상태가 아닙니다. (현재: ${item.status})`), { code: 4462, status: 400 });
    }
    if (!['PAID', 'PARTIAL_REFUND'].includes(item.order.status)) {
      throw Object.assign(new Error(`주문(${item.order.orderId})이 환불 가능한 상태가 아닙니다.`), { code: 4463, status: 400 });
    }

    const orderId = item.order.id;
    if (!groups.has(orderId)) {
      groups.set(orderId, {
        rentalOrder: item.order,
        rentalPayment: item.order.payment,
        items: []
      });
    }
    groups.get(orderId).items.push(item);
  }

  return groups;
}

module.exports = {
  // 상수
  RENTAL_BUFFER_DAYS,
  RENTAL_MODIFIABLE_DAYS_BEFORE,
  RENTAL_ROUND_TRIP_SHIPPING_COST,
  RENTAL_CANCEL_REQUEST_DAYS,
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
  cancelPaidRentalOrder,
  cancelPendingRentalOrder,
  partialRefundRentalOrder,

  // 로깅 함수
  logRentalAction,

  // 아이템 그룹핑
  groupItemsByOrder
};
