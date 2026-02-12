const { sequelize, Contract, Payment, ContractStatusLog, ChatRoom, RentalOrder } = require('../models');
const { success, error, ErrorCodes } = require('../utils/responseHelper');
const { sendSystemMessage } = require('../config/firebaseAdmin');
const { SystemMessageTypes } = require('../utils/systemMessageTypes');
const { createInitialRentalOrder, confirmRentalOrderPayment } = require('../utils/rentalOrderHelper');

/**
 * Mock 결제 승인 (실제 토스 API 호출 없음)
 * POST /api/contracts/:contractId/confirm-payment-mock
 *
 * 개발/테스트 환경에서 네트워크 없이 빠른 결제 테스트를 위해 사용합니다.
 */
const confirmPaymentMock = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { contractId } = req.params;
    const { orderId, amount, simulateFailure } = req.body;
    const guestId = req.user.id;

    // 결제 실패 시뮬레이션
    if (simulateFailure) {
      await transaction.rollback();
      return error(
        res,
        { code: 4605, message: '[MOCK] 결제 승인 실패 (시뮬레이션)' },
        400
      );
    }

    // 계약 조회
    const contract = await Contract.findOne({
      where: { id: contractId, guestId },
      transaction
    });

    if (!contract) {
      await transaction.rollback();
      return error(res, ErrorCodes.CONTRACT_NOT_FOUND, 404);
    }

    if (contract.status !== 'APPROVED') {
      await transaction.rollback();
      return error(
        res,
        ErrorCodes.PAYMENT_NOT_AVAILABLE,
        400
      );
    }

    // orderId 및 금액 검증
    if (contract.orderId !== orderId || contract.finalTotalAmount !== parseInt(amount, 10)) {
      await transaction.rollback();
      return error(
        res,
        ErrorCodes.AMOUNT_MISMATCH,
        400
      );
    }

    // Mock Payment 데이터 생성
    const mockPaymentKey = `mock_payment_${Date.now()}`;
    const now = new Date();

    const payment = await Payment.create({
      contractId: contract.id,
      paymentKey: mockPaymentKey,
      orderId: contract.orderId,
      method: 'CARD',
      status: 'DONE',
      requestedAt: now,
      approvedAt: now,
      totalAmount: contract.finalTotalAmount,
      balanceAmount: contract.finalTotalAmount,
      suppliedAmount: Math.floor(contract.finalTotalAmount / 1.1),
      vat: Math.floor(contract.finalTotalAmount - (contract.finalTotalAmount / 1.1)),
      taxFreeAmount: 0,
      currency: 'KRW',
      receiptUrl: 'https://mock.receipt.url',
      paymentResponse: {
        mock: true,
        message: 'Mock payment for testing'
      }
    }, { transaction });

    // Contract 업데이트
    await contract.update({
      status: 'PAYMENT_COMPLETED',
      paymentMethod: 'CREDIT_CARD', // Contract 모델의 ENUM 값 사용
      paidAt: now
    }, { transaction });

    // 상태 변경 로그 기록
    await ContractStatusLog.createLog({
      contractId: contract.id,
      fromStatus: 'APPROVED',
      toStatus: 'PAYMENT_COMPLETED',
      changedBy: 'GUEST',
      changedByUserId: guestId,
      reason: '[MOCK] 게스트가 결제를 완료했습니다',
      metadata: {
        paymentKey: mockPaymentKey,
        paymentMethod: 'CARD',
        totalAmount: contract.finalTotalAmount,
        mock: true
      },
      req,
      transaction
    });

    // 렌탈 주문 처리
    let initialRentalOrder = await RentalOrder.findOne({
      where: {
        contractId: contract.id,
        orderType: 'INITIAL',
        status: 'PENDING'
      },
      transaction
    });

    // rental_orders가 없지만 contracts.rental_items에 데이터가 있는 경우 (레거시 데이터 마이그레이션)
    if (!initialRentalOrder && contract.rentalItems && Array.isArray(contract.rentalItems) && contract.rentalItems.length > 0) {
      console.log(`📦 [MOCK] 레거시 렌탈 아이템 마이그레이션: contractId=${contract.id}`);

      const rentalItemsForOrder = contract.rentalItems.map(item => ({
        itemId: item.itemId,
        quantity: item.quantity
      }));

      initialRentalOrder = await createInitialRentalOrder(
        contract.id,
        rentalItemsForOrder,
        contract.checkInDate,
        contract.checkOutDate,
        guestId,
        req,
        transaction
      );
      console.log(`✅ [MOCK] 레거시 렌탈 주문 생성 완료: rentalOrderId=${initialRentalOrder.id}`);
    }

    if (initialRentalOrder) {
      await confirmRentalOrderPayment(
        initialRentalOrder.id,
        mockPaymentKey,
        req,
        transaction
      );
      console.log(`✅ [MOCK] 렌탈 주문 결제 완료: rentalOrderId=${initialRentalOrder.id}`);
    }

    // 채팅방에 시스템 메시지 전송
    const chatRoom = await ChatRoom.findOne({
      where: { contractId: contract.id },
      transaction
    });

    if (chatRoom && chatRoom.firebaseChatRoomId) {
      await sendSystemMessage(
        chatRoom.firebaseChatRoomId,
        SystemMessageTypes.PAYMENT_COMPLETED,
        {
          amount: payment.totalAmount,
          paymentMethod: payment.method,
          mock: true
        }
      );
    }

    await transaction.commit();

    console.log(`✅ [MOCK] 결제 승인 완료: ${mockPaymentKey}`);

    return success(
      res,
      {
        contractId: contract.id,
        orderId: contract.orderId,
        status: contract.status,
        payment: {
          paymentKey: payment.paymentKey,
          method: payment.method,
          status: payment.status,
          totalAmount: payment.totalAmount,
          approvedAt: payment.approvedAt,
          receiptUrl: payment.receiptUrl
        },
        mock: true
      },
      '[MOCK] 결제가 완료되었습니다'
    );

  } catch (err) {
    await transaction.rollback();
    console.error('[MOCK] 결제 승인 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

module.exports = {
  confirmPaymentMock
};
