/**
 * moveInGuestFactory.js
 * 입주 준비 서비스 - 임차인(게스트) 도메인 통합 테스트 헬퍼
 *
 * - 옵션 카탈로그 / 게스트 주문 / 게스트 결제 / 라인 / 로그
 * - cleanupMoveInGuestByCases(caseIds): 케이스에 묶인 모든 게스트 데이터 삭제
 * - cleanupMoveInOptions(optionIds)
 */

'use strict';

let counter = 0;
const uid = () => `${Date.now()}_${++counter}`;

/**
 * 옵션 카탈로그 생성
 */
async function createMoveInOption(overrides = {}) {
  const { MoveInOption } = require('../../../models');
  return MoveInOption.create({
    name: overrides.name ?? `테스트옵션_${uid()}`,
    description: overrides.description ?? null,
    optionType: overrides.optionType ?? 'PURCHASE',
    category: overrides.category ?? 'AMENITY_KIT',
    price: overrides.price ?? 10000,
    totalStock: overrides.totalStock ?? 100,
    imageUrl: overrides.imageUrl ?? null,
    displayOrder: overrides.displayOrder ?? 0,
    isActive: overrides.isActive ?? true,
    ...overrides
  });
}

/**
 * MoveInCase 직접 생성 (테스트용)
 *  - 임대인 측 컨트롤러 통하지 않고 빠르게 케이스 만들 때 사용
 *  - host/guest/room 은 호출자 책임
 */
async function createMoveInCase({
  hostId,
  moveInRoomId,
  guestUserId = null,
  guestPhone = '01023456789',
  checkInDate = '2027-06-01',
  checkOutDate = '2027-06-15',
  guestName = '이서연',
  cleaningStatus = 'NOT_REQUESTED',
  roomSnapshot = null
} = {}) {
  const { MoveInCase, MoveInRoom } = require('../../../models');

  let snapshot = roomSnapshot;
  if (!snapshot && moveInRoomId) {
    const room = await MoveInRoom.findByPk(moveInRoomId);
    if (room) {
      snapshot = {
        id: room.id,
        roomName: room.roomName,
        address: room.address,
        detailAddress: room.detailAddress,
        areaPyeong: Number(room.areaPyeong),
        livingRoomCount: room.livingRoomCount,
        roomCount: room.roomCount,
        bathroomCount: room.bathroomCount,
        bedCount: room.bedCount,
        beds: room.beds,
        cleaningSuppliesAvailable: room.cleaningSuppliesAvailable,
        cleaningSuppliesLocation: room.cleaningSuppliesLocation,
        snapshotAt: new Date().toISOString()
      };
    }
  }

  return MoveInCase.create({
    hostId,
    moveInRoomId,
    guestUserId,
    guestName,
    guestPhone,
    checkInDate,
    checkOutDate,
    cleaningStatus,
    roomSnapshot: snapshot ?? { id: moveInRoomId ?? 0, roomName: 'snapshot', address: '주소' }
  });
}

/**
 * 결제 요청 토큰 생성
 */
async function createPaymentRequest(caseId, overrides = {}) {
  const { MoveInPaymentRequest } = require('../../../models');
  const moveInCaseService = require('../../../services/moveInCaseService');
  const { MoveInCase } = require('../../../models');
  const c = await MoveInCase.findByPk(caseId);
  return MoveInPaymentRequest.create({
    caseId,
    token: overrides.token ?? moveInCaseService.generateRequestToken(),
    status: overrides.status ?? 'NOT_SENT',
    expiresAt: overrides.expiresAt ?? moveInCaseService.calculateTokenExpiresAt(c.checkOutDate),
    ...overrides
  });
}

/**
 * 게스트 주문(PAID) 직접 생성 — 추가 결제/조회 테스트용 사전 준비
 */
async function createPaidGuestOrder({
  caseId,
  guestUserId,
  options,        // [{ option, quantity }]
  orderType = 'INITIAL',
  checkInDate = '2027-06-01'
} = {}) {
  const {
    MoveInGuestOrder,
    MoveInGuestOrderItem,
    MoveInGuestPayment
  } = require('../../../models');
  const { generateMoveInGuestOrderId } = require('../../../utils/orderIdGenerator');
  const { calculatePaymentDeadline } = require('../../../utils/moveInGuestPaymentGuard');

  const lines = options.map(({ option, quantity }) => ({
    optionId: option.id,
    name: option.name,
    quantity,
    pricePerItem: option.price,
    totalPrice: option.price * quantity,
    optionType: option.optionType,
    category: option.category
  }));
  const totalAmount = lines.reduce((s, l) => s + l.totalPrice, 0);

  const orderId = await generateMoveInGuestOrderId();
  const now = new Date();

  const order = await MoveInGuestOrder.create({
    caseId,
    guestUserId,
    orderId,
    orderType,
    totalAmount,
    paidAmount: totalAmount,
    refundedAmount: 0,
    status: 'PAID',
    paidAt: now,
    paymentKey: `mock_${Date.now()}`,
    paymentMethod: 'CARD',
    modifiableUntil: calculatePaymentDeadline(checkInDate),
    itemsSnapshot: lines,
    deliveryStatus: 'PENDING'
  });

  for (const l of lines) {
    await MoveInGuestOrderItem.create({
      guestOrderId: order.id,
      optionId: l.optionId,
      quantity: l.quantity,
      pricePerItem: l.pricePerItem,
      totalPrice: l.totalPrice,
      status: 'ACTIVE'
    });
  }

  const payment = await MoveInGuestPayment.create({
    guestOrderId: order.id,
    caseId,
    guestUserId,
    orderId: order.orderId,
    amount: totalAmount,
    status: 'PAID',
    paidAt: now,
    pgProvider: 'mock',
    pgMethod: 'CARD',
    pgTid: `mock_${Date.now()}`
  });

  return { order, payment };
}

/**
 * 케이스 ID 목록에 묶인 게스트 도메인 데이터 모두 삭제
 */
async function cleanupMoveInGuestByCases(caseIds) {
  if (!caseIds || caseIds.length === 0) return;
  const {
    MoveInGuestOrderLog,
    MoveInGuestOrderItem,
    MoveInGuestPayment,
    MoveInGuestOrder
  } = require('../../../models');

  const orders = await MoveInGuestOrder.findAll({
    where: { caseId: caseIds },
    attributes: ['id']
  });
  const orderIds = orders.map(o => o.id);

  if (orderIds.length > 0) {
    await MoveInGuestOrderLog.destroy({ where: { guestOrderId: orderIds } });
    await MoveInGuestOrderItem.destroy({ where: { guestOrderId: orderIds } });
    await MoveInGuestPayment.destroy({ where: { guestOrderId: orderIds } });
    await MoveInGuestOrder.destroy({ where: { id: orderIds } });
  }
}

/**
 * 옵션 정리
 */
async function cleanupMoveInOptions(optionIds) {
  if (!optionIds || optionIds.length === 0) return;
  const { MoveInOption } = require('../../../models');
  await MoveInOption.destroy({ where: { id: optionIds } });
}

/**
 * 알림 정리 (특정 user 의 MOVE_IN_* 알림)
 */
async function cleanupMoveInNotifications(userIds) {
  if (!userIds || userIds.length === 0) return;
  const { Notification } = require('../../../models');
  await Notification.destroy({
    where: {
      userId: userIds,
      type: ['MOVE_IN_PAYMENT_REQUEST', 'MOVE_IN_PAYMENT_COMPLETED']
    }
  });
}

module.exports = {
  createMoveInOption,
  createMoveInCase,
  createPaymentRequest,
  createPaidGuestOrder,
  cleanupMoveInGuestByCases,
  cleanupMoveInOptions,
  cleanupMoveInNotifications
};
