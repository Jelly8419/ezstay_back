const { Payment, RentalOrder, Settlement, Payout, UserBankAccount, BrokerIncentive } = require('../models');
const paytagClient = require('../utils/paytagClient');
const { createInitialRentalOrder, confirmRentalOrderPayment } = require('../utils/rentalOrderHelper');
const {
  calculateSettlementDate,
  calculatePayoutAvailableDate,
  calculateSettlementAmount,
  applyHostBenefit,
} = require('./settlementService');
const { resolveBrokerForHostAt } = require('./brokerResolver');
const { calculateBrokerIncentive } = require('../utils/brokerIncentiveCalculator');

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

  // ── 중개인 인센티브 처리 (결제 시점 귀속 판정 + 스냅샷) ──
  // 판정 기준: payments.approvedAt (= now). 미귀속/비활성/활동기간 밖이면 null.
  // 미귀속 시 Contract 스냅샷 3필드는 DEFAULT NULL 유지, BrokerIncentive 생성 안 함.
  const brokerIncentive = await createBrokerIncentiveIfEligible(
    contract, settlement, now, transaction
  );

  return { payment, initialRentalOrder, settlement, brokerIncentive };
}

/**
 * 결제 시점 귀속된 중개인이 있으면 Contract 스냅샷 3필드를 채우고 BrokerIncentive 생성.
 * 없으면 null 반환. (Contract 스냅샷도 건드리지 않아 DEFAULT NULL 유지)
 *
 * @param {object} contract Sequelize Contract 인스턴스
 * @param {object} settlement 방금 생성된 Settlement
 * @param {Date}   approvedAt 결제 승인 시각
 * @param {import('sequelize').Transaction} transaction
 * @returns {Promise<object|null>} 생성된 BrokerIncentive 또는 null
 */
async function createBrokerIncentiveIfEligible(contract, settlement, approvedAt, transaction) {
  const resolved = await resolveBrokerForHostAt({
    hostId: contract.hostId,
    approvedAt,
    transaction,
  });
  if (!resolved) return null;

  const { brokerId, rate, brokerType } = resolved;

  // Contract 스냅샷 3필드 저장 (이후 매핑/요율 변경과 분리)
  await contract.update({
    brokerIdSnapshot: brokerId,
    brokerRateSnapshot: rate,
    brokerTypeSnapshot: brokerType,
  }, { transaction });

  // 인센티브 금액 산출 (base = 호스트 수수료 VAT 포함 총액)
  const amounts = calculateBrokerIncentive({
    baseFee: settlement.hostPlatformFee,
    appliedRate: rate,
    brokerType,
  });

  // settlement_month = expected_date 의 YYYY-MM (KST 로컬 기준)
  // expected_date 는 DATEONLY 이므로 'YYYY-MM-DD' 문자열. slice 로 월 추출.
  const expectedDateStr = typeof settlement.expectedDate === 'string'
    ? settlement.expectedDate
    : toDateStrKST(settlement.expectedDate);
  const settlementMonth = expectedDateStr.slice(0, 7); // 'YYYY-MM'

  const incentive = await BrokerIncentive.create({
    settlementId: settlement.id,
    contractId: contract.id,
    brokerId,
    baseFee: settlement.hostPlatformFee,
    appliedRate: rate,
    brokerType,
    grossAmount: amounts.gross,
    withholdingAmount: amounts.withholding,
    supplyAmount: amounts.supply,
    vatAmount: amounts.vat,
    netAmount: amounts.net,
    settlementMonth,
    status: 'PENDING',
  }, { transaction });

  return incentive;
}

/** Date → 'YYYY-MM-DD' (KST 로컬 기준). process.env.TZ=Asia/Seoul 전제. */
function toDateStrKST(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

module.exports = {
  approveContractPayment,
};
