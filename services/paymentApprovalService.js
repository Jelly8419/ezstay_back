const { Payment, RentalOrder, Settlement, Payout, UserBankAccount } = require('../models');
const paytagClient = require('../utils/paytagClient');
const { createInitialRentalOrder, confirmRentalOrderPayment } = require('../utils/rentalOrderHelper');
const {
  calculateSettlementDate,
  calculatePayoutAvailableDate,
  calculateSettlementAmount,
  applyHostBenefit,
} = require('./settlementService');

/**
 * 계약 결제 승인 — DB 원자 처리
 *
 * PG 승인 성공 후 호출. 전달받은 트랜잭션 위에서 Payment/Contract/RentalOrder/Settlement/Payout 을
 * 원자적으로 생성·갱신한다. 트랜잭션 커밋/롤백과 PG 보상 취소는 호출자(컨트롤러/웹훅) 책임.
 *
 * @param {object} contract - Sequelize Contract 인스턴스 (room 포함 필요 없음)
 * @param {object} paytagResponse - paytagClient.confirmPayment 결과
 * @param {object} options
 * @param {string} options.payType - 'CARD' 등 PG 결제 수단 코드
 * @param {number} options.realAmount - 실제 청구 금액 (원)
 * @param {Date}   options.now - 승인 시각 (컨트롤러에서 주입하여 테스트 편의)
 * @param {number} options.guestId - 계약 게스트 ID (RentalOrder 로그용)
 * @param {object} options.req - Express req (RentalOrder 로그용, 없으면 null)
 * @param {import('sequelize').Transaction} transaction
 * @returns {Promise<{ payment, initialRentalOrder, settlement }>}
 */
async function approveContractPayment(contract, paytagResponse, options, transaction) {
  const { payType, realAmount, now, guestId, req } = options;

  const paymentMethod = paytagClient.mapPaymentMethod(payType || 'CARD');
  const easyPayProvider = paytagClient.mapEasyPayProvider(payType || 'CARD');
  const pgPaymentKey = paytagResponse.tran_key || paytagResponse.recv_orderno || contract.orderId;

  const payment = await Payment.create({
    contractId: contract.id,
    paymentType: 'CONTRACT',
    paymentKey: pgPaymentKey,
    orderId: contract.orderId,
    method: paymentMethod,
    easyPayProvider,
    status: 'DONE',
    requestedAt: now,
    approvedAt: now,
    totalAmount: realAmount,
    balanceAmount: realAmount,
    suppliedAmount: Math.round(realAmount / 1.1),
    vat: realAmount - Math.round(realAmount / 1.1),
    taxFreeAmount: 0,
    currency: 'KRW',
    receiptUrl: paytagResponse.receipt_url || null,
    checkoutUrl: null,
    paymentResponse: paytagResponse,
  }, { transaction });

  await contract.update({
    status: 'PAYMENT_COMPLETED',
    paymentMethod: paytagClient.mapContractPaymentMethod(payType || 'CARD'),
    paidAt: now,
  }, { transaction });

  let initialRentalOrder = await RentalOrder.findOne({
    where: { contractId: contract.id, orderType: 'INITIAL', status: 'PENDING' },
    transaction,
  });

  if (!initialRentalOrder && contract.rentalItems && Array.isArray(contract.rentalItems) && contract.rentalItems.length > 0) {
    console.log(`📦 레거시 렌탈 아이템 마이그레이션: contractId=${contract.id}`);
    const rentalItemsForOrder = contract.rentalItems.map((item) => ({
      itemId: item.itemId,
      quantity: item.quantity,
    }));
    initialRentalOrder = await createInitialRentalOrder(
      contract.id, rentalItemsForOrder,
      contract.checkInDate, contract.checkOutDate,
      guestId, req, transaction,
    );
    console.log(`✅ 레거시 렌탈 주문 생성 완료: rentalOrderId=${initialRentalOrder.id}`);
  }

  if (initialRentalOrder) {
    await confirmRentalOrderPayment(
      initialRentalOrder, payment.paymentKey, paymentMethod, guestId, req, transaction,
    );
    console.log(`✅ 렌탈 주문 결제 완료: rentalOrderId=${initialRentalOrder.id}`);
  }

  const pgAvailableDate = calculatePayoutAvailableDate(now);
  const checkInNextDay = new Date(contract.checkInDate);
  checkInNextDay.setDate(checkInNextDay.getDate() + 1);
  checkInNextDay.setHours(0, 0, 0, 0);
  const payoutAvailableDate = pgAvailableDate > checkInNextDay ? pgAvailableDate : checkInNextDay;
  const settlementExpectedDate = calculateSettlementDate(contract.checkInDate);
  const hasEzCleaningService = contract.snapshot?.ezService?.cleaningService || false;
  const rawAmounts = calculateSettlementAmount(contract, [], { hasEzCleaningService });

  const { adjustedAmounts: settlementAmounts } = await applyHostBenefit({
    hostId: contract.hostId,
    contractId: contract.id,
    settlementAmounts: rawAmounts,
    transaction,
  });

  const settlement = await Settlement.create({
    contractId: contract.id,
    hostId: contract.hostId,
    status: 'PENDING',
    rentalFee: settlementAmounts.rentalFee,
    maintenanceFee: settlementAmounts.maintenanceFee,
    cleaningFee: settlementAmounts.cleaningFee,
    hostPlatformFee: settlementAmounts.platformFee,
    hostPlatformFeeSupply: settlementAmounts.platformFeeSupply,
    hostPlatformFeeVat: settlementAmounts.platformFeeVat,
    refundDeduction: 0,
    grossAmount: settlementAmounts.grossAmount,
    netAmount: settlementAmounts.grossSettlement,
    expectedDate: settlementExpectedDate,
    payoutAvailableDate,
  }, { transaction });

  const hostBankAccount = await UserBankAccount.findOne({
    where: { userId: contract.hostId, isPrimary: true },
  });

  await Payout.create({
    contractId: contract.id,
    settlementId: settlement.id,
    payoutType: 'CONTRACT_SETTLEMENT',
    recipientType: 'HOST',
    recipientId: contract.hostId,
    amount: settlementAmounts.grossSettlement,
    status: 'PENDING',
    payableAfter: payoutAvailableDate,
    bankName: hostBankAccount?.bankName || null,
    accountNumber: hostBankAccount?.accountNumber || null,
    accountHolder: hostBankAccount?.accountHolder || null,
  }, { transaction });

  return { payment, initialRentalOrder, settlement };
}

module.exports = {
  approveContractPayment,
};
