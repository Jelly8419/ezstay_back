/**
 * 알림 스케줄러 (Legacy - Fallback Only)
 *
 * NOTE: 모든 알림은 Bull Queue를 통해 정확한 시간에 발송됩니다.
 * 이 스케줄러는 Queue에서 누락된 경우를 대비한 백업용입니다.
 *
 * Bull Queue 알림 트리거:
 * - 계약 승인 → 결제 만료 3시간 전 알림 예약
 * - 결제 완료 → 입주 당일 + 옵션 마감 알림 예약
 * - 입주 확정 → 퇴실 3일 전 + 퇴실 당일 알림 예약
 *
 * @see queues/notificationQueue.js
 */

const cron = require('node-cron');
const { Contract, User, Room } = require('../models');
const { Op } = require('sequelize');
const NotificationService = require('../services/notificationService');

/**
 * 알림 스케줄러 시작 (Fallback 전용)
 *
 * Bull Queue가 Redis 장애 등으로 동작하지 않을 때를 대비한 백업
 * 하루에 한 번 누락된 알림을 체크하여 발송
 */
function startNotificationScheduler() {
  // 매일 자정 - 누락된 알림 체크 (Fallback)
  cron.schedule('0 0 * * *', async () => {
    console.log('[알림 스케줄러] Fallback 체크 실행...');
    await checkMissedNotifications();
  });

  console.log('[알림 스케줄러] 시작됨 (Fallback 모드)');
  console.log('  - 주요 알림: Bull Queue에서 처리');
  console.log('  - Fallback 체크: 매일 00:00');
}

/**
 * 누락된 알림 체크 및 발송
 */
async function checkMissedNotifications() {
  try {
    const now = new Date();

    // 1. 결제 만료 임박 알림 누락 체크
    // 21~24시간 전에 승인되었지만 아직 APPROVED 상태인 계약
    const hoursAgo21 = new Date(now.getTime() - 21 * 60 * 60 * 1000);
    const hoursAgo24 = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const paymentPendingContracts = await Contract.findAll({
      where: {
        status: 'APPROVED',
        approvedAt: {
          [Op.gt]: hoursAgo24,
          [Op.lte]: hoursAgo21
        }
      }
    });

    if (paymentPendingContracts.length > 0) {
      console.log(`[Fallback] 결제 만료 알림 누락: ${paymentPendingContracts.length}건`);
      for (const contract of paymentPendingContracts) {
        try {
          await NotificationService.notifyPaymentPending(contract);
          console.log(`[Fallback] 결제 만료 알림 발송: contractId=${contract.id}`);
        } catch (err) {
          console.error(`[Fallback] 결제 만료 알림 실패: contractId=${contract.id}`, err);
        }
      }
    }

    // 2. 입주 당일 알림 누락 체크
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const checkinTodayContracts = await Contract.findAll({
      where: {
        status: { [Op.in]: ['CONFIRMED', 'IN_PROGRESS'] },
        checkInDate: {
          [Op.gte]: today,
          [Op.lt]: tomorrow
        }
      },
      include: [
        { model: User, as: 'guest', attributes: ['id', 'name', 'nickname', 'phoneNumber'] },
        { model: User, as: 'host', attributes: ['id', 'name', 'nickname', 'phoneNumber'] }
      ]
    });

    // 오전 9시 이후에만 입주 당일 알림 체크
    if (now.getHours() >= 9 && checkinTodayContracts.length > 0) {
      console.log(`[Fallback] 입주 당일 알림 체크: ${checkinTodayContracts.length}건`);
      // 알림 중복 발송 방지를 위해 실제 발송은 하지 않음 (로그만)
    }

    console.log('[Fallback] 체크 완료');
  } catch (err) {
    console.error('[Fallback] 체크 실패:', err);
  }
}

module.exports = {
  startNotificationScheduler,
  checkMissedNotifications
};
