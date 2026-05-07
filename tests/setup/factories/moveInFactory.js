/**
 * moveInFactory.js
 * 입주 준비 서비스 통합 테스트용 데이터 헬퍼
 */

'use strict';

const cryptoHelper = require('../../../utils/cryptoHelper');

/**
 * MoveInRoom 직접 생성 (DB insert)
 */
async function createMoveInRoom(hostId, overrides = {}) {
  const { MoveInRoom } = require('../../../models');
  return MoveInRoom.create({
    hostId,
    roomName: overrides.roomName ?? '테스트 방',
    address: overrides.address ?? '서울 강남구 가로수길 9',
    detailAddress: overrides.detailAddress ?? '101동 1203호',
    areaPyeong: overrides.areaPyeong ?? 15,
    livingRoomCount: overrides.livingRoomCount ?? 1,
    roomCount: overrides.roomCount ?? 1,
    bathroomCount: overrides.bathroomCount ?? 1,
    bedCount: overrides.bedCount ?? 1,
    beds: overrides.beds ?? [{ index: 1, size: 'QUEEN' }],
    commonEntrancePassword: overrides.commonEntrancePassword !== undefined
      ? cryptoHelper.encrypt(overrides.commonEntrancePassword)
      : cryptoHelper.encrypt('2479#'),
    doorLockPassword: overrides.doorLockPassword !== undefined
      ? cryptoHelper.encrypt(overrides.doorLockPassword)
      : cryptoHelper.encrypt('0512*'),
    cleaningSuppliesAvailable: overrides.cleaningSuppliesAvailable ?? true,
    cleaningSuppliesLocation: overrides.cleaningSuppliesLocation ?? '현관 수납장',
    memo: overrides.memo ?? null,
    ...overrides
  });
}

/**
 * 정상 케이스 생성용 body
 */
function makeCaseBody(roomId, overrides = {}) {
  return {
    moveInRoomId: roomId,
    checkInDate: overrides.checkInDate ?? '2026-06-01',
    checkOutDate: overrides.checkOutDate ?? '2026-06-15',
    guestName: overrides.guestName ?? '이서연',
    guestPhone: overrides.guestPhone ?? '01023456789',
    requestMemo: overrides.requestMemo ?? null,
    sendGuestPaymentRequest: overrides.sendGuestPaymentRequest ?? false,
    ...overrides
  };
}

/**
 * 정리: 호스트 한 명에 묶인 모든 입주 준비 데이터 삭제
 */
async function cleanupMoveInByHost(hostId) {
  if (!hostId) return;
  const {
    MoveInPaymentRequest,
    MoveInPayment,
    MoveInServiceTaskLog,
    MoveInServiceTask,
    MoveInCase,
    MoveInRoom,
    MoveInGuestOrder,
    MoveInGuestOrderItem,
    MoveInGuestPayment,
    MoveInGuestOrderLog
  } = require('../../../models');

  const cases = await MoveInCase.findAll({ where: { hostId }, attributes: ['id'] });
  const caseIds = cases.map(c => c.id);

  if (caseIds.length > 0) {
    // 게스트 도메인 데이터 먼저 정리 (FK: orders → case)
    const orders = await MoveInGuestOrder.findAll({ where: { caseId: caseIds }, attributes: ['id'] });
    const orderIds = orders.map(o => o.id);
    if (orderIds.length > 0) {
      await MoveInGuestOrderLog.destroy({ where: { guestOrderId: orderIds } });
      await MoveInGuestOrderItem.destroy({ where: { guestOrderId: orderIds } });
      await MoveInGuestPayment.destroy({ where: { guestOrderId: orderIds } });
      await MoveInGuestOrder.destroy({ where: { id: orderIds } });
    }

    const tasks = await MoveInServiceTask.findAll({ where: { caseId: caseIds }, attributes: ['id'] });
    const taskIds = tasks.map(t => t.id);
    if (taskIds.length > 0) {
      await MoveInServiceTaskLog.destroy({ where: { serviceTaskId: taskIds } });
    }
    await MoveInServiceTask.destroy({ where: { caseId: caseIds } });
    await MoveInPayment.destroy({ where: { caseId: caseIds } });
    await MoveInPaymentRequest.destroy({ where: { caseId: caseIds } });
    await MoveInCase.destroy({ where: { id: caseIds } });
  }
  await MoveInRoom.destroy({ where: { hostId }, force: true });
}

module.exports = {
  createMoveInRoom,
  makeCaseBody,
  cleanupMoveInByHost
};
