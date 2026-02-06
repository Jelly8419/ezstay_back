/**
 * 알림 작업 큐 (Bull Queue + Redis)
 *
 * 정확한 시간에 알림을 발송하기 위한 지연 작업 큐
 * - 결제 만료 3시간 전 알림
 * - 기타 시간 기반 알림
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
// 작업 프로세서 (Worker)
// =====================================================

/**
 * 결제 만료 임박 알림 처리
 */
notificationQueue.process('payment-pending', async (job) => {
  const { contractId } = job.data;
  console.log(`[알림 큐] 결제 만료 알림 처리 시작: contractId=${contractId}`);

  try {
    // 동적 import로 순환 참조 방지
    const { Contract } = require('../models');

    const contract = await Contract.findByPk(contractId);

    if (!contract) {
      console.log(`[알림 큐] 계약을 찾을 수 없음: contractId=${contractId}`);
      return { success: false, reason: 'contract_not_found' };
    }

    // 아직 APPROVED 상태인지 확인 (이미 결제했거나 만료됐으면 알림 안 보냄)
    if (contract.status !== 'APPROVED') {
      console.log(`[알림 큐] 이미 상태 변경됨: contractId=${contractId}, status=${contract.status}`);
      return { success: false, reason: 'status_changed', currentStatus: contract.status };
    }

    // 알림 발송
    await NotificationService.notifyPaymentPending(contract);
    console.log(`[알림 큐] 결제 만료 알림 발송 완료: contractId=${contractId}`);

    return { success: true, contractId };
  } catch (err) {
    console.error(`[알림 큐] 결제 만료 알림 처리 실패: contractId=${contractId}`, err);
    throw err; // Bull이 재시도하도록 에러 던짐
  }
});

// =====================================================
// 큐 이벤트 핸들러
// =====================================================

notificationQueue.on('completed', (job, result) => {
  console.log(`[알림 큐] 작업 완료: ${job.name} (id: ${job.id})`, result);
});

notificationQueue.on('failed', (job, err) => {
  console.error(`[알림 큐] 작업 실패: ${job.name} (id: ${job.id})`, err.message);
});

notificationQueue.on('error', (err) => {
  console.error('[알림 큐] 큐 에러:', err);
});

// =====================================================
// 알림 예약 헬퍼 함수
// =====================================================

/**
 * 결제 만료 3시간 전 알림 예약
 *
 * @param {number} contractId - 계약 ID
 * @param {Date} approvedAt - 승인 시간
 * @returns {Promise<Job>} Bull Job
 */
async function schedulePaymentPendingNotification(contractId, approvedAt) {
  // 알림 발송 시간 = 승인 후 21시간 (만료 3시간 전)
  const notifyAt = new Date(approvedAt.getTime() + 21 * 60 * 60 * 1000);
  const delay = notifyAt.getTime() - Date.now();

  // 이미 지난 시간이면 즉시 발송
  if (delay <= 0) {
    console.log(`[알림 큐] 즉시 발송 (이미 알림 시간 경과): contractId=${contractId}`);
    return notificationQueue.add('payment-pending', { contractId }, { delay: 0 });
  }

  console.log(`[알림 큐] 결제 만료 알림 예약: contractId=${contractId}, 발송 예정=${notifyAt.toISOString()}`);

  return notificationQueue.add(
    'payment-pending',
    { contractId },
    {
      delay,
      jobId: `payment-pending-${contractId}`  // 중복 방지
    }
  );
}

/**
 * 계약에 대한 예약된 알림 취소
 * (결제 완료 또는 계약 취소 시 호출)
 *
 * @param {number} contractId - 계약 ID
 */
async function cancelScheduledNotification(contractId) {
  try {
    const jobId = `payment-pending-${contractId}`;
    const job = await notificationQueue.getJob(jobId);

    if (job) {
      await job.remove();
      console.log(`[알림 큐] 예약된 알림 취소: contractId=${contractId}`);
    }
  } catch (err) {
    console.error(`[알림 큐] 알림 취소 실패: contractId=${contractId}`, err);
  }
}

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

module.exports = {
  notificationQueue,
  schedulePaymentPendingNotification,
  cancelScheduledNotification,
  getQueueStats
};
