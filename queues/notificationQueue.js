/**
 * 알림 작업 큐 (Bull Queue + Redis)
 *
 * 모든 시간 기반 알림을 정확한 시간에 발송하기 위한 지연 작업 큐
 *
 * 알림 유형:
 * 1. payment-pending: 결제 만료 3시간 전 (승인 시 예약)
 * 2. checkin-today: 입주 당일 오전 9시 (결제 완료 시 예약)
 * 3. checkout-reminder: 퇴실 3일 전 오전 9시 (입주 확정 시 예약)
 * 4. checkout-today: 퇴실 당일 오전 9시 (입주 확정 시 예약)
 * 5. option-deadline: 옵션 마감 알림 - 입주 6일 전 오전 10시 (결제 완료 시 예약)
 */

const Queue = require('bull');
const NotificationService = require('../services/notificationService');

// Redis 연결 설정
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined
};

// 알림 큐 생성
const notificationQueue = new Queue('notifications', {
  redis: redisConfig,
  defaultJobOptions: {
    removeOnComplete: 100,  // 완료된 작업 100개만 유지
    removeOnFail: 50,       // 실패한 작업 50개만 유지
    attempts: 3,            // 실패 시 3회 재시도
    backoff: {
      type: 'exponential',
      delay: 5000           // 5초부터 시작, 지수 증가
    }
  }
});

// =====================================================
// 유틸리티 함수
// =====================================================

/**
 * 특정 날짜의 오전 9시 시간을 계산
 */
function getDateAt9AM(date) {
  const target = new Date(date);
  target.setHours(9, 0, 0, 0);
  return target;
}

/**
 * 특정 날짜의 오전 10시 시간을 계산
 */
function getDateAt10AM(date) {
  const target = new Date(date);
  target.setHours(10, 0, 0, 0);
  return target;
}

/**
 * 지연 시간 계산 (현재 시간 기준)
 */
function calculateDelay(targetTime) {
  const delay = targetTime.getTime() - Date.now();
  return delay > 0 ? delay : 0;
}

// =====================================================
// 작업 프로세서 (Worker)
// =====================================================

/**
 * 결제 만료 임박 알림 처리
 */
notificationQueue.process('payment-pending', async (job) => {
  const { contractId } = job.data;
  console.log(`[알림 큐] 결제 만료 알림 처리: contractId=${contractId}`);

  try {
    const { Contract } = require('../models');
    const contract = await Contract.findByPk(contractId);

    if (!contract) {
      return { success: false, reason: 'contract_not_found' };
    }

    // 아직 APPROVED 상태인지 확인
    if (contract.status !== 'APPROVED') {
      console.log(`[알림 큐] 상태 변경됨 (스킵): contractId=${contractId}, status=${contract.status}`);
      return { success: false, reason: 'status_changed', currentStatus: contract.status };
    }

    await NotificationService.notifyPaymentPending(contract);
    console.log(`[알림 큐] 결제 만료 알림 발송 완료: contractId=${contractId}`);
    return { success: true, contractId };
  } catch (err) {
    console.error(`[알림 큐] 결제 만료 알림 실패: contractId=${contractId}`, err);
    throw err;
  }
});

/**
 * 입주 당일 알림 처리
 */
notificationQueue.process('checkin-today', async (job) => {
  const { contractId } = job.data;
  console.log(`[알림 큐] 입주 당일 알림 처리: contractId=${contractId}`);

  try {
    const { Contract, User, Room } = require('../models');
    const contract = await Contract.findByPk(contractId, {
      include: [
        { model: User, as: 'guest', attributes: ['id', 'name', 'nickname', 'phoneNumber'] },
        { model: User, as: 'host', attributes: ['id', 'name', 'nickname', 'phoneNumber'] },
        { model: Room, as: 'room', attributes: ['id', 'roomName', 'address'] }
      ]
    });

    if (!contract) {
      return { success: false, reason: 'contract_not_found' };
    }

    // CONFIRMED 또는 IN_PROGRESS 상태인지 확인
    if (!['CONFIRMED', 'IN_PROGRESS'].includes(contract.status)) {
      console.log(`[알림 큐] 상태 변경됨 (스킵): contractId=${contractId}, status=${contract.status}`);
      return { success: false, reason: 'status_changed', currentStatus: contract.status };
    }

    await NotificationService.notifyCheckinToday(contract, {
      guest: contract.guest,
      host: contract.host,
      room: contract.room
    });
    console.log(`[알림 큐] 입주 당일 알림 발송 완료: contractId=${contractId}`);
    return { success: true, contractId };
  } catch (err) {
    console.error(`[알림 큐] 입주 당일 알림 실패: contractId=${contractId}`, err);
    throw err;
  }
});

/**
 * 퇴실 3일 전 알림 처리
 */
notificationQueue.process('checkout-reminder', async (job) => {
  const { contractId } = job.data;
  console.log(`[알림 큐] 퇴실 3일 전 알림 처리: contractId=${contractId}`);

  try {
    const { Contract, Room } = require('../models');
    const contract = await Contract.findByPk(contractId, {
      include: [
        { model: Room, as: 'room', attributes: ['id', 'title', 'checkOutGuide'] }
      ]
    });

    if (!contract) {
      return { success: false, reason: 'contract_not_found' };
    }

    // CHECKED_IN 또는 IN_PROGRESS 상태인지 확인
    if (!['CHECKED_IN', 'IN_PROGRESS'].includes(contract.status)) {
      console.log(`[알림 큐] 상태 변경됨 (스킵): contractId=${contractId}, status=${contract.status}`);
      return { success: false, reason: 'status_changed', currentStatus: contract.status };
    }

    await NotificationService.notifyCheckoutReminder(
      contract,
      3,
      contract.room?.checkOutGuide || ''
    );
    console.log(`[알림 큐] 퇴실 3일 전 알림 발송 완료: contractId=${contractId}`);
    return { success: true, contractId };
  } catch (err) {
    console.error(`[알림 큐] 퇴실 3일 전 알림 실패: contractId=${contractId}`, err);
    throw err;
  }
});

/**
 * 퇴실 당일 알림 처리
 */
notificationQueue.process('checkout-today', async (job) => {
  const { contractId } = job.data;
  console.log(`[알림 큐] 퇴실 당일 알림 처리: contractId=${contractId}`);

  try {
    const { Contract } = require('../models');
    const contract = await Contract.findByPk(contractId);

    if (!contract) {
      return { success: false, reason: 'contract_not_found' };
    }

    // CHECKED_IN 또는 IN_PROGRESS 상태인지 확인
    if (!['CHECKED_IN', 'IN_PROGRESS'].includes(contract.status)) {
      console.log(`[알림 큐] 상태 변경됨 (스킵): contractId=${contractId}, status=${contract.status}`);
      return { success: false, reason: 'status_changed', currentStatus: contract.status };
    }

    await NotificationService.notifyCheckoutToday(contract);
    console.log(`[알림 큐] 퇴실 당일 알림 발송 완료: contractId=${contractId}`);
    return { success: true, contractId };
  } catch (err) {
    console.error(`[알림 큐] 퇴실 당일 알림 실패: contractId=${contractId}`, err);
    throw err;
  }
});

/**
 * 옵션 마감 알림 처리
 */
notificationQueue.process('option-deadline', async (job) => {
  const { contractId } = job.data;
  console.log(`[알림 큐] 옵션 마감 알림 처리: contractId=${contractId}`);

  try {
    const { Contract } = require('../models');
    const contract = await Contract.findByPk(contractId);

    if (!contract) {
      return { success: false, reason: 'contract_not_found' };
    }

    // CONFIRMED 또는 IN_PROGRESS 상태인지 확인
    if (!['CONFIRMED', 'IN_PROGRESS'].includes(contract.status)) {
      console.log(`[알림 큐] 상태 변경됨 (스킵): contractId=${contractId}, status=${contract.status}`);
      return { success: false, reason: 'status_changed', currentStatus: contract.status };
    }

    await NotificationService.notifyOptionDeadline(contract);
    console.log(`[알림 큐] 옵션 마감 알림 발송 완료: contractId=${contractId}`);
    return { success: true, contractId };
  } catch (err) {
    console.error(`[알림 큐] 옵션 마감 알림 실패: contractId=${contractId}`, err);
    throw err;
  }
});

// =====================================================
// 큐 이벤트 핸들러
// =====================================================

notificationQueue.on('completed', (job, result) => {
  if (result?.success) {
    console.log(`[알림 큐] ✅ 작업 완료: ${job.name} (contractId: ${job.data.contractId})`);
  }
});

notificationQueue.on('failed', (job, err) => {
  console.error(`[알림 큐] ❌ 작업 실패: ${job.name} (contractId: ${job.data.contractId})`, err.message);
});

notificationQueue.on('error', (err) => {
  console.error('[알림 큐] 큐 에러:', err);
});

// =====================================================
// 알림 예약 함수들
// =====================================================

/**
 * 결제 만료 3시간 전 알림 예약 (계약 승인 시 호출)
 *
 * @param {number} contractId - 계약 ID
 * @param {Date} approvedAt - 승인 시간
 */
async function schedulePaymentPendingNotification(contractId, approvedAt) {
  // 알림 발송 시간 = 승인 후 21시간 (만료 3시간 전)
  const notifyAt = new Date(approvedAt.getTime() + 21 * 60 * 60 * 1000);
  const delay = calculateDelay(notifyAt);

  console.log(`[알림 큐] 결제 만료 알림 예약: contractId=${contractId}, 발송=${notifyAt.toISOString()}`);

  return notificationQueue.add(
    'payment-pending',
    { contractId },
    { delay, jobId: `payment-pending-${contractId}` }
  );
}

/**
 * 결제 완료 시 알림 예약 (입주 당일 + 옵션 마감)
 *
 * @param {number} contractId - 계약 ID
 * @param {Date} checkInDate - 입주일
 */
async function schedulePaymentCompletedNotifications(contractId, checkInDate) {
  const jobs = [];

  // 1. 입주 당일 알림 (입주일 오전 9시)
  const checkinNotifyAt = getDateAt9AM(checkInDate);
  const checkinDelay = calculateDelay(checkinNotifyAt);

  if (checkinDelay > 0) {
    console.log(`[알림 큐] 입주 당일 알림 예약: contractId=${contractId}, 발송=${checkinNotifyAt.toISOString()}`);
    jobs.push(
      notificationQueue.add(
        'checkin-today',
        { contractId },
        { delay: checkinDelay, jobId: `checkin-today-${contractId}` }
      )
    );
  }

  // 2. 옵션 마감 알림 (입주 6일 전 오전 10시)
  const optionDeadline = new Date(checkInDate);
  optionDeadline.setDate(optionDeadline.getDate() - 6);
  const optionNotifyAt = getDateAt10AM(optionDeadline);
  const optionDelay = calculateDelay(optionNotifyAt);

  if (optionDelay > 0) {
    console.log(`[알림 큐] 옵션 마감 알림 예약: contractId=${contractId}, 발송=${optionNotifyAt.toISOString()}`);
    jobs.push(
      notificationQueue.add(
        'option-deadline',
        { contractId },
        { delay: optionDelay, jobId: `option-deadline-${contractId}` }
      )
    );
  }

  return Promise.all(jobs);
}

/**
 * 입주 확정 시 알림 예약 (퇴실 3일 전 + 퇴실 당일)
 *
 * @param {number} contractId - 계약 ID
 * @param {Date} checkOutDate - 퇴실일
 */
async function scheduleCheckinConfirmedNotifications(contractId, checkOutDate) {
  const jobs = [];

  // 1. 퇴실 3일 전 알림 (퇴실 3일 전 오전 9시)
  const reminderDate = new Date(checkOutDate);
  reminderDate.setDate(reminderDate.getDate() - 3);
  const reminderNotifyAt = getDateAt9AM(reminderDate);
  const reminderDelay = calculateDelay(reminderNotifyAt);

  if (reminderDelay > 0) {
    console.log(`[알림 큐] 퇴실 3일 전 알림 예약: contractId=${contractId}, 발송=${reminderNotifyAt.toISOString()}`);
    jobs.push(
      notificationQueue.add(
        'checkout-reminder',
        { contractId },
        { delay: reminderDelay, jobId: `checkout-reminder-${contractId}` }
      )
    );
  }

  // 2. 퇴실 당일 알림 (퇴실일 오전 9시)
  const checkoutNotifyAt = getDateAt9AM(checkOutDate);
  const checkoutDelay = calculateDelay(checkoutNotifyAt);

  if (checkoutDelay > 0) {
    console.log(`[알림 큐] 퇴실 당일 알림 예약: contractId=${contractId}, 발송=${checkoutNotifyAt.toISOString()}`);
    jobs.push(
      notificationQueue.add(
        'checkout-today',
        { contractId },
        { delay: checkoutDelay, jobId: `checkout-today-${contractId}` }
      )
    );
  }

  return Promise.all(jobs);
}

/**
 * 계약 관련 모든 예약된 알림 취소
 *
 * @param {number} contractId - 계약 ID
 * @param {string[]} types - 취소할 알림 유형 (기본: 모든 유형)
 */
async function cancelScheduledNotifications(contractId, types = null) {
  const allTypes = ['payment-pending', 'checkin-today', 'checkout-reminder', 'checkout-today', 'option-deadline'];
  const targetTypes = types || allTypes;

  const results = [];
  for (const type of targetTypes) {
    try {
      const jobId = `${type}-${contractId}`;
      const job = await notificationQueue.getJob(jobId);
      if (job) {
        await job.remove();
        console.log(`[알림 큐] 알림 취소: ${jobId}`);
        results.push({ type, cancelled: true });
      } else {
        results.push({ type, cancelled: false, reason: 'not_found' });
      }
    } catch (err) {
      console.error(`[알림 큐] 알림 취소 실패: ${type}-${contractId}`, err);
      results.push({ type, cancelled: false, reason: err.message });
    }
  }

  return results;
}

// 하위 호환성을 위한 별칭
const cancelScheduledNotification = (contractId) => cancelScheduledNotifications(contractId, ['payment-pending']);

/**
 * 큐 상태 조회 (디버깅/모니터링용)
 */
async function getQueueStats() {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    notificationQueue.getWaitingCount(),
    notificationQueue.getActiveCount(),
    notificationQueue.getCompletedCount(),
    notificationQueue.getFailedCount(),
    notificationQueue.getDelayedCount()
  ]);

  return { waiting, active, completed, failed, delayed };
}

/**
 * 특정 계약의 예약된 알림 조회
 */
async function getScheduledNotifications(contractId) {
  const types = ['payment-pending', 'checkin-today', 'checkout-reminder', 'checkout-today', 'option-deadline'];
  const scheduled = [];

  for (const type of types) {
    const jobId = `${type}-${contractId}`;
    const job = await notificationQueue.getJob(jobId);
    if (job) {
      scheduled.push({
        type,
        jobId,
        delay: job.opts.delay,
        scheduledAt: new Date(job.timestamp + job.opts.delay).toISOString(),
        state: await job.getState()
      });
    }
  }

  return scheduled;
}

module.exports = {
  notificationQueue,
  // 예약 함수
  schedulePaymentPendingNotification,
  schedulePaymentCompletedNotifications,
  scheduleCheckinConfirmedNotifications,
  // 취소 함수
  cancelScheduledNotification,
  cancelScheduledNotifications,
  // 조회 함수
  getQueueStats,
  getScheduledNotifications
};
