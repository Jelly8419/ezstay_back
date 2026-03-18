/**
 * PayTag 웹훅 컨트롤러
 *
 * PayTag에서 입금 완료 등 이벤트 발생 시 호출되는 엔드포인트
 * 현재는 디버깅용으로 전체 데이터를 로깅하고, 가상계좌 입금 완료 시 결제 확정 처리
 */

const { sequelize, Contract, Payment, Room, User, ChatRoom, ContractStatusLog, RentalOrder } = require('../models');
const { sendSystemMessage } = require('../config/firebaseAdmin');
const { SystemMessageTypes } = require('../utils/systemMessageTypes');
const { confirmRentalOrderPayment } = require('../utils/rentalOrderHelper');
const { sendContractConfirmedMessages } = require('../schedulers/autoMessageScheduler');
const NotificationService = require('../services/notificationService');

/**
 * 입금 마감시간 계산
 * = min(체크인시간, 승인시점+24시간)
 *
 * @param {Object} contract - Contract (approvedAt, checkInDate 포함)
 * @param {Object} room - Room (checkInTime 포함)
 * @returns {Date} 입금 마감 시각
 */
function calculateDepositDeadline(contract, room) {
  // 1) 승인시점 + 24시간
  const approvedAt = new Date(contract.approvedAt);
  const deadline24h = new Date(approvedAt.getTime() + 24 * 60 * 60 * 1000);

  // 2) 체크인 날짜 + 입실시간
  const checkInDate = new Date(contract.checkInDate);
  const checkInTime = room ? (room.checkInTime || 15) : 15;
  const checkInDeadline = new Date(
    checkInDate.getFullYear(),
    checkInDate.getMonth(),
    checkInDate.getDate(),
    checkInTime, 0, 0
  );

  // 더 빨리 도래하는 시간
  return deadline24h < checkInDeadline ? deadline24h : checkInDeadline;
}

/**
 * PayTag 웹훅 수신 (디버깅 + 가상계좌 입금 처리)
 * POST /api/payments/webhook/paytag
 *
 * PayTag가 보내는 데이터 형식은 아직 미확인 → 전체 로깅으로 파악
 */
exports.handleWebhook = async (req, res) => {
  const receivedAt = new Date();

  // 전체 데이터 로깅 (디버깅)
  console.log('=== PayTag 웹훅 수신 ===');
  console.log('시간:', receivedAt.toISOString());
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body:', JSON.stringify(req.body, null, 2));
  console.log('Query:', JSON.stringify(req.query, null, 2));
  console.log('========================');

  // 200 OK 즉시 응답 (PG사 웹훅은 빠른 응답 필요)
  res.status(200).json({ resultcode: '0000', message: 'OK' });

  // 이하 비동기 처리 (응답 후)
  try {
    const body = req.body || {};

    // PayTag 웹훅 파라미터 (실제 데이터 확인 후 수정 필요)
    const shopOrderNo = body.shop_orderno || body.orderno || body.order_no;
    const ordStatus = body.ord_status || body.status;
    const resultCode = body.resultcode;
    const tranAmt = body.tran_amt;

    if (!shopOrderNo) {
      console.log('[웹훅] shop_orderno 없음 - 데이터 구조 확인 필요');
      return;
    }

    console.log(`[웹훅] 주문번호: ${shopOrderNo}, 상태: ${ordStatus}, 결과: ${resultCode}, 금액: ${tranAmt}`);

    // Payment 조회 (Room.checkInTime 포함)
    const payment = await Payment.findOne({
      where: { orderId: shopOrderNo },
      include: [{
        model: Contract,
        as: 'contract',
        include: [
          { model: Room, as: 'room', attributes: ['id', 'roomName', 'hostId', 'checkInTime'] },
          { model: ChatRoom, as: 'chatRoom', attributes: ['firebaseChatRoomId'] }
        ]
      }]
    });

    if (!payment) {
      console.log(`[웹훅] Payment 미발견: orderId=${shopOrderNo}`);
      return;
    }

    // 이미 DONE이면 무시 (중복 웹훅 방지)
    if (payment.status === 'DONE' || payment.status === 'DEPOSIT_EXPIRED') {
      console.log(`[웹훅] 이미 처리된 결제: orderId=${shopOrderNo}, status=${payment.status}`);
      return;
    }

    // 입금 완료 판단 (실제 데이터 확인 후 조건 수정 필요)
    const isDepositCompleted = ordStatus === '1' || ordStatus === 1 || resultCode === '0000';

    if (payment.status === 'WAITING_FOR_DEPOSIT' && isDepositCompleted) {
      console.log(`[웹훅] 가상계좌 입금 확인: orderId=${shopOrderNo}`);

      const now = new Date();
      const contract = payment.contract;

      // === 입금 마감시간 검증 ===
      // min(체크인시간, 승인시점+24시간) 을 넘겼는지 확인
      const deadline = calculateDepositDeadline(contract, contract.room);
      const isExpired = now >= deadline;

      if (isExpired) {
        // 마감시간 초과 입금 → 결제 확정하지 않고 DEPOSIT_EXPIRED 처리
        console.log(`⚠️ [웹훅] 입금 마감시간 초과: orderId=${shopOrderNo}, deadline=${deadline.toISOString()}, now=${now.toISOString()}`);

        const transaction = await sequelize.transaction();
        try {
          await payment.update({
            status: 'EXPIRED',
            paymentResponse: {
              ...((typeof payment.paymentResponse === 'string' ? JSON.parse(payment.paymentResponse) : payment.paymentResponse) || {}),
              depositExpiredWebhook: body,
              depositExpiredAt: now.toISOString(),
              depositDeadline: deadline.toISOString()
            }
          }, { transaction });

          // 계약을 PAYMENT_EXPIRED로 전환
          await contract.update({
            status: 'PAYMENT_EXPIRED',
            cancellationReason: '가상계좌 입금 마감시간 초과'
          }, { transaction });

          await ContractStatusLog.createLog({
            contractId: contract.id,
            fromStatus: 'APPROVED',
            toStatus: 'PAYMENT_EXPIRED',
            changedBy: 'SYSTEM',
            changedByUserId: null,
            reason: '가상계좌 입금 마감시간 초과 (입금은 되었으나 기한 경과 → 수동 환불 필요)',
            metadata: {
              paymentKey: payment.paymentKey,
              depositDeadline: deadline.toISOString(),
              depositReceivedAt: now.toISOString(),
              webhookData: body
            },
            transaction
          });

          await transaction.commit();

          // 관리자 알림 (수동 환불 필요)
          console.log(`🚨 [웹훅] 관리자 수동 환불 필요: contractId=${contract.id}, orderId=${shopOrderNo}, 금액=${payment.totalAmount}원`);

          // TODO: 관리자 알림 발송 (이메일/슬랙 등)
          // TODO: PayTag 환불 API 구현 후 자동 환불 처리

        } catch (err) {
          await transaction.rollback();
          console.error('[웹훅] 마감 초과 처리 오류:', err);
        }
        return;
      }

      // === 정상 입금 → 결제 확정 ===
      const transaction = await sequelize.transaction();
      try {
        // Payment 상태 업데이트
        await payment.update({
          status: 'DONE',
          approvedAt: now
        }, { transaction });

        // Contract 상태 업데이트
        await contract.update({
          status: 'PAYMENT_COMPLETED',
          paidAt: now
        }, { transaction });

        // 상태 변경 로그
        await ContractStatusLog.createLog({
          contractId: contract.id,
          fromStatus: 'APPROVED',
          toStatus: 'PAYMENT_COMPLETED',
          changedBy: 'SYSTEM',
          changedByUserId: null,
          reason: '가상계좌 입금 완료 (웹훅)',
          metadata: {
            paymentKey: payment.paymentKey,
            depositDeadline: deadline.toISOString(),
            depositConfirmedAt: now.toISOString(),
            webhookData: body
          },
          transaction
        });

        // 렌탈 주문 처리
        const initialRentalOrder = await RentalOrder.findOne({
          where: {
            contractId: contract.id,
            orderType: 'INITIAL',
            status: 'PENDING'
          },
          transaction
        });

        if (initialRentalOrder) {
          await confirmRentalOrderPayment(
            initialRentalOrder,
            payment.paymentKey,
            payment.method,
            contract.guestId,
            null,
            transaction
          );
          console.log(`[웹훅] 렌탈 주문 결제 완료: rentalOrderId=${initialRentalOrder.id}`);
        }

        // 채팅 시스템 메시지
        if (contract.chatRoom && contract.chatRoom.firebaseChatRoomId) {
          await sendSystemMessage(
            contract.chatRoom.firebaseChatRoomId,
            SystemMessageTypes.PAYMENT_COMPLETED,
            {
              amount: payment.totalAmount,
              paymentMethod: payment.method
            }
          );
        }

        await transaction.commit();

        // 트랜잭션 후 비동기 알림
        sendContractConfirmedMessages(contract.id, contract.roomId).catch(err => {
          console.error(`[웹훅][자동메시지] 발송 실패:`, err);
        });

        NotificationService.notifyPaymentCompleted(contract, {
          guest: await User.findByPk(contract.guestId, { attributes: ['id', 'phoneNumber', 'name', 'nickname'] }),
          host: await User.findByPk(contract.hostId, { attributes: ['id', 'phoneNumber', 'name', 'nickname'] }),
          room: contract.room,
          paymentData: { guestAmount: payment.totalAmount, hostAmount: contract.totalUsageFee, optionItems: '' }
        }).catch(err => {
          console.error('[웹훅] 결제 완료 알림 실패:', err);
        });

        // 알림 큐
        try {
          const { cancelScheduledNotification, schedulePaymentCompletedNotifications } = require('../queues/notificationQueue');
          await cancelScheduledNotification(contract.id);
          await schedulePaymentCompletedNotifications(contract.id, contract.checkInDate);
        } catch (queueErr) {
          console.error('[웹훅] 알림 큐 실패:', queueErr);
        }

        console.log(`✅ [웹훅] 가상계좌 입금 확정 완료: contractId=${contract.id}`);

      } catch (err) {
        await transaction.rollback();
        console.error('[웹훅] 입금 확정 처리 오류:', err);
      }
    } else {
      console.log(`[웹훅] 미처리: paymentStatus=${payment.status}, ordStatus=${ordStatus}, resultCode=${resultCode}`);
    }

  } catch (err) {
    console.error('[웹훅] 처리 오류:', err);
  }
};
