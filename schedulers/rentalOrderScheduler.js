const cron = require('node-cron');
const { Op } = require('sequelize');
const {
  sequelize,
  RentalOrder,
  RentalOrderItem,
  RentalItemReservation,
  RentalOrderLog
} = require('../models');

/**
 * 렌탈 주문 자동 만료 스케줄러
 *
 * 실행 주기: 매 5분마다
 * - PENDING 상태 주문 중 15분 경과 시 자동 취소
 * - 재고(RentalItemReservation) 해제
 */

// 미결제 만료 시간 (분)
const RENTAL_ORDER_EXPIRATION_MINUTES = 15;

/**
 * 미결제 렌탈 주문 만료 처리
 * - PENDING 상태인 주문 중 생성 후 15분 경과 시
 * -> CANCELLED 상태로 변경 + 재고 해제
 */
async function expirePendingRentalOrders() {
  const transaction = await sequelize.transaction();

  try {
    const now = new Date();
    const expirationTime = new Date(now.getTime() - RENTAL_ORDER_EXPIRATION_MINUTES * 60 * 1000);

    // 만료 대상 주문 조회
    const expiredOrders = await RentalOrder.findAll({
      where: {
        status: 'PENDING',
        createdAt: { [Op.lte]: expirationTime }
      },
      include: [{
        model: RentalOrderItem,
        as: 'items'
      }],
      transaction
    });

    if (expiredOrders.length === 0) {
      await transaction.commit();
      return 0;
    }

    // 각 주문별 처리
    for (const order of expiredOrders) {
      // 1. RentalOrder 상태 변경
      await order.update({
        status: 'CANCELLED'
      }, { transaction });

      // 2. RentalOrderItem 상태 변경
      await RentalOrderItem.update(
        {
          status: 'CANCELLED',
          cancelledAt: now
        },
        {
          where: { rentalOrderId: order.id },
          transaction
        }
      );

      // 3. RentalItemReservation 상태 변경 (재고 해제)
      await RentalItemReservation.update(
        { status: 'CANCELLED' },
        {
          where: {
            rentalOrderId: order.id,
            status: 'RESERVED'  // CONFIRMED 상태는 건드리지 않음
          },
          transaction
        }
      );

      // 4. 로그 기록
      await RentalOrderLog.create({
        contractId: order.contractId,
        rentalOrderId: order.id,
        action: 'ORDER_EXPIRED',
        actor: 'SYSTEM',
        actorId: null,
        amountChange: 0,
        balanceAfter: 0,
        metadata: {
          orderId: order.orderId,
          orderType: order.orderType,
          totalAmount: order.totalAmount,
          expirationMinutes: RENTAL_ORDER_EXPIRATION_MINUTES,
          createdAt: order.createdAt,
          expiredAt: now
        },
        description: `미결제 주문 자동 만료 (${RENTAL_ORDER_EXPIRATION_MINUTES}분 경과)`
      }, { transaction });
    }

    await transaction.commit();

    console.log(`[렌탈 스케줄러] ${expiredOrders.length}건의 미결제 렌탈 주문을 만료 처리했습니다.`);
    return expiredOrders.length;

  } catch (error) {
    await transaction.rollback();
    console.error('[렌탈 스케줄러] 미결제 렌탈 주문 만료 처리 오류:', error);
    return 0;
  }
}

/**
 * 수정 기한 만료 렌탈 주문 처리
 * - PENDING 상태인 주문 중 modifiableUntil 경과 시
 * -> CANCELLED 상태로 변경 + 재고 해제
 */
async function expireModifiableDeadlineOrders() {
  const transaction = await sequelize.transaction();

  try {
    const now = new Date();

    // 수정 기한 만료 대상 주문 조회
    const expiredOrders = await RentalOrder.findAll({
      where: {
        status: 'PENDING',
        modifiableUntil: { [Op.lt]: now }
      },
      transaction
    });

    if (expiredOrders.length === 0) {
      await transaction.commit();
      return 0;
    }

    // 각 주문별 처리
    for (const order of expiredOrders) {
      // 1. RentalOrder 상태 변경
      await order.update({
        status: 'CANCELLED'
      }, { transaction });

      // 2. RentalOrderItem 상태 변경
      await RentalOrderItem.update(
        {
          status: 'CANCELLED',
          cancelledAt: now
        },
        {
          where: { rentalOrderId: order.id },
          transaction
        }
      );

      // 3. RentalItemReservation 상태 변경 (재고 해제)
      await RentalItemReservation.update(
        { status: 'CANCELLED' },
        {
          where: {
            rentalOrderId: order.id,
            status: 'RESERVED'
          },
          transaction
        }
      );

      // 4. 로그 기록
      await RentalOrderLog.create({
        contractId: order.contractId,
        rentalOrderId: order.id,
        action: 'ORDER_EXPIRED',
        actor: 'SYSTEM',
        actorId: null,
        amountChange: 0,
        balanceAfter: 0,
        metadata: {
          orderId: order.orderId,
          orderType: order.orderType,
          totalAmount: order.totalAmount,
          expirationReason: 'MODIFIABLE_DEADLINE_PASSED',
          modifiableUntil: order.modifiableUntil,
          expiredAt: now
        },
        description: '입주일 5일 전 경과로 인한 미결제 주문 자동 만료'
      }, { transaction });
    }

    await transaction.commit();

    console.log(`[렌탈 스케줄러] ${expiredOrders.length}건의 렌탈 주문을 수정 기한 만료 처리했습니다.`);
    return expiredOrders.length;

  } catch (error) {
    await transaction.rollback();
    console.error('[렌탈 스케줄러] 수정 기한 만료 처리 오류:', error);
    return 0;
  }
}

/**
 * 모든 렌탈 주문 만료 처리 실행
 */
async function runRentalOrderExpiration() {
  console.log('[렌탈 스케줄러] 렌탈 주문 만료 처리 시작:', new Date().toISOString());

  try {
    // 순차적으로 실행
    await expirePendingRentalOrders();      // 1. 15분 미결제 만료
    await expireModifiableDeadlineOrders(); // 2. 입주일 5일 전 경과 만료

    console.log('[렌탈 스케줄러] 렌탈 주문 만료 처리 완료:', new Date().toISOString());
  } catch (error) {
    console.error('[렌탈 스케줄러] 실행 오류:', error);
  }
}

/**
 * 스케줄러 시작
 *
 * 매 5분마다 실행
 * - 15분 미결제 주문 자동 취소
 * - 입주일 5일 전 경과 시 자동 취소
 */
function startRentalOrderScheduler() {
  // 매 1분마다 실행
  cron.schedule('*/1 * * * *', runRentalOrderExpiration);

  console.log('[렌탈 스케줄러] 렌탈 주문 만료 스케줄러가 시작되었습니다. (매 1분마다 실행)');
  console.log(`[렌탈 스케줄러] 미결제 만료 시간: ${RENTAL_ORDER_EXPIRATION_MINUTES}분`);

  // 서버 시작 시 즉시 한 번 실행
  runRentalOrderExpiration();
}

module.exports = {
  startRentalOrderScheduler,
  runRentalOrderExpiration,
  expirePendingRentalOrders,
  expireModifiableDeadlineOrders,
  RENTAL_ORDER_EXPIRATION_MINUTES
};
