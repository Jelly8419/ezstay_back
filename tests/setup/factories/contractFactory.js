/**
 * contractFactory.js
 * 테스트용 계약 생성 헬퍼
 * 각 단계별 상태를 빠르게 만들어주는 유틸
 */

'use strict';

const { createGuest, createHost } = require('./userFactory');
const { createRoom } = require('./roomFactory');

/**
 * 날짜 계산 헬퍼
 * @param {number} daysFromNow - 오늘로부터 N일 후
 */
function daysLater(daysFromNow) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  // YYYY-MM-DD
  return d.toISOString().slice(0, 10);
}

/**
 * 서버 금액 계산 (contractHelper와 동일한 로직)
 * 테스트 데이터 생성 시 정확한 금액 맞추기 위해 사용
 */
function calcAmounts(room, totalDays, rentalItemsFee = 0, hasEzCleaning = false) {
  const rentalFee = room.dailyRent * totalDays;
  const maintenanceFee = (room.dailyMaintenanceFee || 0) * totalDays;
  const cleaningFee = room.cleaningFee || 0;
  const deposit = room.deposit || 300000;

  // 수수료 기준: EZ청소 사용 시 cleaningFee 제외
  const feeBase = rentalFee + maintenanceFee + (hasEzCleaning ? 0 : cleaningFee) - 0; // 할인 없음
  const platformFee = Math.floor(feeBase * 0.099);

  const totalUsageFee = rentalFee + maintenanceFee + cleaningFee + rentalItemsFee - 0 + platformFee;
  const finalTotalAmount = totalUsageFee + deposit;

  return {
    rentalFee,
    maintenanceFee,
    cleaningFee,
    rentalItemsFee,
    discountAmount: 0,
    platformFee,
    deposit,
    finalTotalAmount,
    totalDays,
  };
}

/**
 * PENDING_APPROVAL 상태 계약 생성
 * 계약 요청만 한 상태
 */
async function createPendingContract(options = {}) {
  const guest = options.guest || (await createGuest()).user;
  const guestToken = options.guestToken || require('./userFactory').generateToken(guest);
  const host = options.host || (await createHost()).user;
  const { room } = options.room
    ? { room: options.room }
    : await createRoom(host.id);

  const checkInDate  = options.checkInDate  || daysLater(30);
  const checkOutDate = options.checkOutDate || daysLater(44); // 14일
  const totalDays    = options.totalDays    || 14;
  const amounts      = calcAmounts(room, totalDays);

  const { Contract, ContractStatusLog } = require('../../../models');
  // orderId는 varchar(11) 제한 → yyMMddHHmmss 형식 (12자) 대신 랜덤 숫자 사용
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const orderId = `${String(now.getFullYear()).slice(2)}${pad(now.getMonth()+1)}${pad(now.getDate())}${String(Date.now()).slice(-4)}`;

  const contract = await Contract.create({
    guestId: guest.id,
    hostId: host.id,
    roomId: room.id,
    orderId,
    status: 'PENDING_APPROVAL',
    checkInDate,
    checkOutDate,
    totalDays,
    ...amounts,
    depositStatus: 'HOLDING',
    checkoutStatus: 'NOT_STARTED',
    refundPolicySnapshot: {
      policyType: 'TEST_POLICY',
      displayName: '테스트 환불 정책',
      rules: [
        { daysBeforeMin: 7, daysBeforeMax: null, refundRate: 100 },
        { daysBeforeMin: 3, daysBeforeMax: 6,    refundRate: 50  },
        { daysBeforeMin: 0, daysBeforeMax: 2,    refundRate: 0   },
      ],
    },
    snapshot: {
      room: { id: room.id, title: room.title, address: room.address },
      host: { id: host.id, name: host.name },
      guest: { id: guest.id, name: guest.name },
    },
    termsAgreed: {
      serviceTerms: true,
      cancellationPolicy: true,
      refundPolicy: true,
    },
    ...(options.contractOverrides || {}),
  });

  await ContractStatusLog.create({
    contractId: contract.id,
    fromStatus: null,
    toStatus: 'PENDING_APPROVAL',
    changedBy: 'GUEST',
    changedByUserId: guest.id,
  }).catch(() => {});

  return { contract, guest, guestToken, host, room, amounts };
}

/**
 * APPROVED 상태 계약 생성
 * 호스트가 승인한 상태 (결제 대기)
 */
async function createApprovedContract(options = {}) {
  const result = await createPendingContract(options);
  const { contract } = result;

  const { ChatRoom } = require('../../../models');

  await contract.update({
    status: 'APPROVED',
    approvedAt: new Date(),
  });

  // 채팅방 생성 (mock ChatRoom)
  await ChatRoom.create({
    contractId: contract.id,
    hostId: result.host.id,
    guestId: result.guest.id,
    roomId: result.room.id,
    firebaseChatRoomId: `test_chat_${contract.id}`,
    isReadOnly: false,
  }).catch(() => {});

  return result;
}

/**
 * PAYMENT_COMPLETED 상태 계약 생성
 * 결제까지 완료된 상태
 */
async function createPaidContract(options = {}) {
  const result = await createApprovedContract(options);
  const { contract, amounts } = result;

  const { Payment, Settlement } = require('../../../models');
  const { calculateSettlementDate } = require('../../../utils/businessDayHelper');


  const now = new Date();

  // Payment 생성
  await Payment.create({
    contractId: contract.id,
    paymentType: 'CONTRACT',
    paymentKey: `test_tran_key_${contract.id}`,
    orderId: contract.orderId,
    method: 'CARD',
    status: 'DONE',
    requestedAt: now,
    approvedAt: now,
    totalAmount: amounts.finalTotalAmount,
    balanceAmount: amounts.finalTotalAmount,
    suppliedAmount: Math.floor(amounts.finalTotalAmount / 1.1),
    vat: amounts.finalTotalAmount - Math.floor(amounts.finalTotalAmount / 1.1),
    taxFreeAmount: 0,
    currency: 'KRW',
    paymentResponse: { resultcode: '0000', recv_orderno: `TEST_PG_${contract.id}`, trandate: '20260410', loginid: 'test' },
  });

  // Settlement 생성 (calculateSettlementDate는 동기 함수)
  let expectedDateObj;
  try {
    expectedDateObj = calculateSettlementDate(contract.checkInDate);
  } catch {
    expectedDateObj = new Date(contract.checkInDate);
    expectedDateObj.setDate(expectedDateObj.getDate() + 3);
  }
  const expectedDate = expectedDateObj.toISOString().slice(0, 10);

  await Settlement.create({
    contractId: contract.id,
    hostId: contract.hostId,
    status: 'PENDING',
    expectedDate,
    payoutAvailableDate: expectedDate,
    rentalFee: amounts.rentalFee,
    maintenanceFee: amounts.maintenanceFee,
    cleaningFee: amounts.cleaningFee,
    hostPlatformFee: Math.floor(amounts.rentalFee * 0.033),
    grossAmount: amounts.rentalFee + amounts.maintenanceFee + amounts.cleaningFee,
    netAmount: amounts.rentalFee + amounts.maintenanceFee + amounts.cleaningFee - Math.floor(amounts.rentalFee * 0.033),
  });

  await contract.update({ status: 'PAYMENT_COMPLETED', paidAt: now });

  return result;
}

/**
 * IN_PROGRESS 상태 계약 생성
 * 입주 중인 상태
 */
async function createInProgressContract(options = {}) {
  const result = await createPaidContract(options);
  const { contract } = result;

  const checkInDate  = daysLater(-7);  // 7일 전 입주
  const checkOutDate = daysLater(7);   // 7일 후 퇴실

  await contract.update({
    status: 'IN_PROGRESS',
    checkInDate,
    checkOutDate,
    checkedInAt: new Date(),
  });

  return result;
}

/**
 * COMPLETED 상태 계약 생성
 * 퇴실 시간 지난 상태
 */
async function createCompletedContract(options = {}) {
  const result = await createPaidContract(options);
  const { contract } = result;

  const checkInDate  = daysLater(-20);
  const checkOutDate = daysLater(-1);

  await contract.update({
    status: 'COMPLETED',
    checkInDate,
    checkOutDate,
    checkedInAt:  new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
    checkedOutAt: new Date(Date.now() - 1  * 24 * 60 * 60 * 1000),
  });

  return result;
}

/**
 * 전체 테스트 데이터 정리
 */
async function cleanupContract(contractId) {
  if (!contractId) return;
  const {
    Contract, Payment, Settlement, Refund,
    ChatRoom, ContractStatusLog, RentalItemReservation,
  } = require('../../../models');

  await Promise.all([
    Payment.destroy({ where: { contractId } }).catch(() => {}),
    Settlement.destroy({ where: { contractId } }).catch(() => {}),
    Refund.destroy({ where: { contractId } }).catch(() => {}),
    ChatRoom.destroy({ where: { contractId } }).catch(() => {}),
    ContractStatusLog.destroy({ where: { contractId } }).catch(() => {}),
    RentalItemReservation.destroy({ where: { contractId } }).catch(() => {}),
  ]);
  await Contract.destroy({ where: { id: contractId } }).catch(() => {});
}

module.exports = {
  createPendingContract,
  createApprovedContract,
  createPaidContract,
  createInProgressContract,
  createCompletedContract,
  cleanupContract,
  calcAmounts,
  daysLater,
};
