const cron = require('node-cron');
const { Contract, User, Room } = require('../models');
const { Op } = require('sequelize');
const NotificationService = require('../services/notificationService');

/**
 * 알림 스케줄러
 *
 * 1. 결제 만료 24시간 전 알림 (PAYMENT_PENDING)
 * 2. 입주 당일 알림 (CHECKIN_TODAY)
 * 3. 퇴실 3일 전 알림 (CHECKOUT_REMINDER)
 * 4. 옵션 마감 알림 - 입주 6일 전 (OPTION_DEADLINE)
 */

/**
 * 날짜를 YYYY-MM-DD 형식으로 변환
 */
function formatDate(date) {
  return date.toISOString().split('T')[0];
}

/**
 * 결제 만료 24시간 전 알림 발송
 * - APPROVED 상태 (결제 대기 중)
 * - paymentDeadline이 24시간 이내인 계약
 */
async function sendPaymentPendingNotifications() {
  try {
    const now = new Date();
    const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // 결제 기한이 24시간 이내인 APPROVED 계약 조회
    const contracts = await Contract.findAll({
      where: {
        status: 'APPROVED',
        paymentDeadline: {
          [Op.gt]: now,
          [Op.lte]: in24Hours
        }
      }
    });

    console.log(`[알림 스케줄러] 결제 만료 임박 알림 대상: ${contracts.length}건`);

    for (const contract of contracts) {
      try {
        await NotificationService.notifyPaymentPending(contract);
        console.log(`[알림 스케줄러] 결제 임박 알림 전송: contractId=${contract.id}`);
      } catch (err) {
        console.error(`[알림 스케줄러] 결제 임박 알림 실패: contractId=${contract.id}`, err);
      }
    }

    return contracts.length;
  } catch (err) {
    console.error('[알림 스케줄러] 결제 만료 알림 처리 실패:', err);
    return 0;
  }
}

/**
 * 입주 당일 알림 발송
 * - CONFIRMED 상태 (결제 완료)
 * - 오늘이 checkInDate인 계약
 */
async function sendCheckinTodayNotifications() {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // 오늘 입주 예정인 CONFIRMED 계약 조회
    const contracts = await Contract.findAll({
      where: {
        status: 'CONFIRMED',
        checkInDate: {
          [Op.gte]: today,
          [Op.lt]: tomorrow
        }
      },
      include: [
        {
          model: User,
          as: 'guest',
          attributes: ['id', 'name', 'nickname', 'phoneNumber']
        },
        {
          model: User,
          as: 'host',
          attributes: ['id', 'name', 'nickname', 'phoneNumber']
        }
      ]
    });

    console.log(`[알림 스케줄러] 입주 당일 알림 대상: ${contracts.length}건`);

    for (const contract of contracts) {
      try {
        await NotificationService.notifyCheckinToday(contract, {
          guest: contract.guest,
          host: contract.host
        });
        console.log(`[알림 스케줄러] 입주 당일 알림 전송: contractId=${contract.id}`);
      } catch (err) {
        console.error(`[알림 스케줄러] 입주 당일 알림 실패: contractId=${contract.id}`, err);
      }
    }

    return contracts.length;
  } catch (err) {
    console.error('[알림 스케줄러] 입주 당일 알림 처리 실패:', err);
    return 0;
  }
}

/**
 * 퇴실 3일 전 알림 발송
 * - CHECKED_IN 상태 (입주 중)
 * - 3일 후가 checkOutDate인 계약
 */
async function sendCheckoutReminderNotifications() {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 3일 후
    const threeDaysLater = new Date(today);
    threeDaysLater.setDate(threeDaysLater.getDate() + 3);

    const fourDaysLater = new Date(threeDaysLater);
    fourDaysLater.setDate(fourDaysLater.getDate() + 1);

    // 3일 후 퇴실 예정인 CHECKED_IN 계약 조회
    const contracts = await Contract.findAll({
      where: {
        status: 'CHECKED_IN',
        checkOutDate: {
          [Op.gte]: threeDaysLater,
          [Op.lt]: fourDaysLater
        }
      },
      include: [
        {
          model: Room,
          as: 'room',
          attributes: ['id', 'title', 'checkOutGuide']
        }
      ]
    });

    console.log(`[알림 스케줄러] 퇴실 3일 전 알림 대상: ${contracts.length}건`);

    for (const contract of contracts) {
      try {
        await NotificationService.notifyCheckoutReminder(
          contract,
          3,
          contract.room?.checkOutGuide || ''
        );
        console.log(`[알림 스케줄러] 퇴실 임박 알림 전송: contractId=${contract.id}`);
      } catch (err) {
        console.error(`[알림 스케줄러] 퇴실 임박 알림 실패: contractId=${contract.id}`, err);
      }
    }

    return contracts.length;
  } catch (err) {
    console.error('[알림 스케줄러] 퇴실 임박 알림 처리 실패:', err);
    return 0;
  }
}

/**
 * 옵션 마감 알림 발송 (입주 6일 전)
 * - CONFIRMED 상태 (결제 완료)
 * - 6일 후가 checkInDate인 계약 (5일 전까지 옵션 추가 가능)
 */
async function sendOptionDeadlineNotifications() {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 6일 후
    const sixDaysLater = new Date(today);
    sixDaysLater.setDate(sixDaysLater.getDate() + 6);

    const sevenDaysLater = new Date(sixDaysLater);
    sevenDaysLater.setDate(sevenDaysLater.getDate() + 1);

    // 6일 후 입주 예정인 CONFIRMED 계약 조회
    const contracts = await Contract.findAll({
      where: {
        status: 'CONFIRMED',
        checkInDate: {
          [Op.gte]: sixDaysLater,
          [Op.lt]: sevenDaysLater
        }
      }
    });

    console.log(`[알림 스케줄러] 옵션 마감 알림 대상: ${contracts.length}건`);

    for (const contract of contracts) {
      try {
        await NotificationService.notifyOptionDeadline(contract);
        console.log(`[알림 스케줄러] 옵션 마감 알림 전송: contractId=${contract.id}`);
      } catch (err) {
        console.error(`[알림 스케줄러] 옵션 마감 알림 실패: contractId=${contract.id}`, err);
      }
    }

    return contracts.length;
  } catch (err) {
    console.error('[알림 스케줄러] 옵션 마감 알림 처리 실패:', err);
    return 0;
  }
}

/**
 * 퇴실 당일 알림 발송
 * - CHECKED_IN 상태 (입주 중)
 * - 오늘이 checkOutDate인 계약
 */
async function sendCheckoutTodayNotifications() {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // 오늘 퇴실 예정인 CHECKED_IN 계약 조회
    const contracts = await Contract.findAll({
      where: {
        status: 'CHECKED_IN',
        checkOutDate: {
          [Op.gte]: today,
          [Op.lt]: tomorrow
        }
      }
    });

    console.log(`[알림 스케줄러] 퇴실 당일 알림 대상: ${contracts.length}건`);

    for (const contract of contracts) {
      try {
        await NotificationService.notifyCheckoutToday(contract);
        console.log(`[알림 스케줄러] 퇴실 당일 알림 전송: contractId=${contract.id}`);
      } catch (err) {
        console.error(`[알림 스케줄러] 퇴실 당일 알림 실패: contractId=${contract.id}`, err);
      }
    }

    return contracts.length;
  } catch (err) {
    console.error('[알림 스케줄러] 퇴실 당일 알림 처리 실패:', err);
    return 0;
  }
}

/**
 * 알림 스케줄러 시작
 */
function startNotificationScheduler() {
  // 매 시간 정각 - 결제 만료 24시간 전 알림
  cron.schedule('0 * * * *', async () => {
    console.log('[알림 스케줄러] 결제 만료 임박 알림 실행...');
    await sendPaymentPendingNotifications();
  });

  // 매일 오전 9시 - 입주 당일 알림
  cron.schedule('0 9 * * *', async () => {
    console.log('[알림 스케줄러] 입주 당일 알림 실행...');
    await sendCheckinTodayNotifications();
  });

  // 매일 오전 9시 - 퇴실 3일 전 알림
  cron.schedule('0 9 * * *', async () => {
    console.log('[알림 스케줄러] 퇴실 3일 전 알림 실행...');
    await sendCheckoutReminderNotifications();
  });

  // 매일 오전 9시 - 퇴실 당일 알림
  cron.schedule('0 9 * * *', async () => {
    console.log('[알림 스케줄러] 퇴실 당일 알림 실행...');
    await sendCheckoutTodayNotifications();
  });

  // 매일 오전 10시 - 옵션 마감 알림
  cron.schedule('0 10 * * *', async () => {
    console.log('[알림 스케줄러] 옵션 마감 알림 실행...');
    await sendOptionDeadlineNotifications();
  });

  console.log('[알림 스케줄러] 시작됨');
  console.log('  - 결제 만료 임박: 매 시간 정각');
  console.log('  - 입주 당일: 매일 09:00');
  console.log('  - 퇴실 3일 전: 매일 09:00');
  console.log('  - 퇴실 당일: 매일 09:00');
  console.log('  - 옵션 마감: 매일 10:00');
}

module.exports = {
  startNotificationScheduler,
  // 개별 함수도 export (테스트 및 수동 실행용)
  sendPaymentPendingNotifications,
  sendCheckinTodayNotifications,
  sendCheckoutReminderNotifications,
  sendCheckoutTodayNotifications,
  sendOptionDeadlineNotifications
};
