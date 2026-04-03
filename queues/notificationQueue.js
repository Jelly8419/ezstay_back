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
    removeOnComplete: true, // 완료 즉시 Redis에서 제거
    removeOnFail: true,     // 실패 즉시 Redis에서 제거 (밀린 job 재실행 방지)
    attempts: 1,            // 재시도 없음 (알림톡은 시각이 지나면 의미 없음)
  }
});

// =====================================================
// 유틸리티 함수
// =====================================================

/**
 * 날짜에서 KST 연/월/일 추출
 * 'YYYY-MM-DD' 문자열은 UTC 기준으로 파싱되므로 KST(+9) 오프셋 보정
 */
function getKSTDateParts(date) {
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const kstMs = (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date))
    ? new Date(date).getTime() + KST_OFFSET_MS
    : new Date(date).getTime();
  const kst = new Date(kstMs);
  return { year: kst.getUTCFullYear(), month: kst.getUTCMonth(), day: kst.getUTCDate() };
}

/**
 * 특정 날짜의 오전 9시 시간을 계산 (KST 기준)
 */
function getDateAt9AM(date) {
  const { year, month, day } = getKSTDateParts(date);
  return new Date(year, month, day, 9, 0, 0, 0);
}

/**
 * 특정 날짜의 오전 10시 시간을 계산 (KST 기준)
 */
function getDateAt10AM(date) {
  const { year, month, day } = getKSTDateParts(date);
  return new Date(year, month, day, 10, 0, 0, 0);
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
  const { contractId, scheduledAt } = job.data;
  console.log(`[알림 큐] 입주 당일 알림 처리: contractId=${contractId}`);

  try {
    // 입주 당일 알림 유효성 체크
    // 오전 10시 이후 실행된 경우 무조건 skip (서버 장애 밀림, 날짜 오류 등 모든 케이스 차단)
    const now = new Date();
    const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0, 0, 0);
    if (now >= cutoff) {
      console.warn(`[알림 큐] 입주 당일 알림 스킵 (오전 10시 초과): contractId=${contractId}, 현재=${now.toISOString()}`);
      return { success: false, reason: 'past_cutoff' };
    }

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
  const { contractId, scheduledAt } = job.data;
  console.log(`[알림 큐] 퇴실 3일 전 알림 처리: contractId=${contractId}`);

  try {
    // 예약 시각 기준 하루 이상 지연 실행된 경우 skip (퇴실일 지나고 발송 방지)
    if (scheduledAt && Date.now() - new Date(scheduledAt).getTime() > 24 * 60 * 60 * 1000) {
      console.warn(`[알림 큐] 퇴실 3일 전 알림 stale job 스킵: contractId=${contractId}, scheduledAt=${scheduledAt}`);
      return { success: false, reason: 'stale_job' };
    }

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
 * 퇴실 전일 알림 처리 (알림톡)
 */
notificationQueue.process('checkout-eve', async (job) => {
  const { contractId, scheduledAt } = job.data;
  console.log(`[알림 큐] 퇴실 전일 알림 처리: contractId=${contractId}`);

  try {
    if (scheduledAt && Date.now() - new Date(scheduledAt).getTime() > 24 * 60 * 60 * 1000) {
      console.warn(`[알림 큐] 퇴실 전일 알림 stale job 스킵: contractId=${contractId}, scheduledAt=${scheduledAt}`);
      return { success: false, reason: 'stale_job' };
    }

    const { Contract, User, Room } = require('../models');
    const contract = await Contract.findByPk(contractId, {
      include: [
        { model: User, as: 'guest', attributes: ['id', 'name', 'nickname', 'phoneNumber'] },
        { model: Room, as: 'room', attributes: ['id', 'roomName', 'checkOutTime'] }
      ]
    });

    if (!contract) {
      return { success: false, reason: 'contract_not_found' };
    }

    if (!['CONFIRMED', 'IN_PROGRESS'].includes(contract.status)) {
      console.log(`[알림 큐] 상태 변경됨 (스킵): contractId=${contractId}, status=${contract.status}`);
      return { success: false, reason: 'status_changed', currentStatus: contract.status };
    }

    const AlimtalkService = require('../services/alimtalkService');
    await AlimtalkService.sendCheckoutEve(contract, contract.guest, contract.room);
    console.log(`[알림 큐] 퇴실 전일 알림 발송 완료: contractId=${contractId}`);
    return { success: true, contractId };
  } catch (err) {
    console.error(`[알림 큐] 퇴실 전일 알림 실패: contractId=${contractId}`, err);
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
    // 오전 10시 이후 실행된 경우 skip
    const now = new Date();
    const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0, 0, 0);
    if (now >= cutoff) {
      console.warn(`[알림 큐] 퇴실 당일 알림 스킵 (오전 10시 초과): contractId=${contractId}, 현재=${now.toISOString()}`);
      return { success: false, reason: 'past_cutoff' };
    }

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
  const { contractId, scheduledAt } = job.data;
  console.log(`[알림 큐] 옵션 마감 알림 처리: contractId=${contractId}`);

  try {
    // 예약 시각 기준 하루 이상 지연 실행된 경우 skip (입주 후 옵션 마감 알림 방지)
    if (scheduledAt && Date.now() - new Date(scheduledAt).getTime() > 24 * 60 * 60 * 1000) {
      console.warn(`[알림 큐] 옵션 마감 알림 stale job 스킵: contractId=${contractId}, scheduledAt=${scheduledAt}`);
      return { success: false, reason: 'stale_job' };
    }

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

  // 1. 입주 당일 알림 (입주일 오전 9시, 이미 지났으면 즉시 발송)
  const checkinNotifyAt = getDateAt9AM(checkInDate);
  const checkinDelay = calculateDelay(checkinNotifyAt);

  console.log(`[알림 큐] 입주 당일 알림 예약: contractId=${contractId}, 발송=${checkinDelay > 0 ? checkinNotifyAt.toISOString() : '즉시'}`);
  jobs.push(
    notificationQueue.add(
      'checkin-today',
      { contractId, scheduledAt: checkinNotifyAt.toISOString() },
      { delay: checkinDelay, jobId: `checkin-today-${contractId}` }
    )
  );

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
        { contractId, scheduledAt: optionNotifyAt.toISOString() },
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
        { contractId, scheduledAt: reminderNotifyAt.toISOString() },
        { delay: reminderDelay, jobId: `checkout-reminder-${contractId}` }
      )
    );
  }

  // 2. 퇴실 전일 알림 (퇴실 1일 전 오전 9시, 알림톡)
  const eveDate = new Date(checkOutDate);
  eveDate.setDate(eveDate.getDate() - 1);
  const eveNotifyAt = getDateAt9AM(eveDate);
  const eveDelay = calculateDelay(eveNotifyAt);

  if (eveDelay > 0) {
    console.log(`[알림 큐] 퇴실 전일 알림 예약: contractId=${contractId}, 발송=${eveNotifyAt.toISOString()}`);
    jobs.push(
      notificationQueue.add(
        'checkout-eve',
        { contractId, scheduledAt: eveNotifyAt.toISOString() },
        { delay: eveDelay, jobId: `checkout-eve-${contractId}` }
      )
    );
  }

  // 3. 퇴실 당일 알림 (퇴실일 오전 9시)
  const checkoutNotifyAt = getDateAt9AM(checkOutDate);
  const checkoutDelay = calculateDelay(checkoutNotifyAt);

  if (checkoutDelay > 0) {
    console.log(`[알림 큐] 퇴실 당일 알림 예약: contractId=${contractId}, 발송=${checkoutNotifyAt.toISOString()}`);
    jobs.push(
      notificationQueue.add(
        'checkout-today',
        { contractId, scheduledAt: checkoutNotifyAt.toISOString() },
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
  const allTypes = ['payment-pending', 'checkin-today', 'checkout-reminder', 'checkout-eve', 'checkout-today', 'option-deadline'];
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

/**
 * type별 발송 예정 시각 계산
 */
function getFireAt(type, checkInDate, checkOutDate) {
  if (type === 'checkin-today') {
    return getDateAt9AM(checkInDate);
  } else if (type === 'option-deadline') {
    const d = new Date(checkInDate);
    d.setDate(d.getDate() - 6);
    return getDateAt10AM(d);
  } else if (type === 'checkout-reminder') {
    const d = new Date(checkOutDate);
    d.setDate(d.getDate() - 3);
    return getDateAt9AM(d);
  } else if (type === 'checkout-eve') {
    const d = new Date(checkOutDate);
    d.setDate(d.getDate() - 1);
    return getDateAt9AM(d);
  } else if (type === 'checkout-today') {
    return getDateAt9AM(checkOutDate);
  }
  return null;
}

/**
 * 누락된 알림 단건 복구 (관리자 수동 요청)
 *
 * @param {number} contractId
 * @param {string} type - 알림 타입
 * @param {Date} checkInDate
 * @param {Date} checkOutDate
 * @returns {{ queued: boolean, reason: string, fireAt: string|null }}
 */
async function recoverNotification(contractId, type, checkInDate, checkOutDate) {
  const now = new Date();

  const fireAt = getFireAt(type, checkInDate, checkOutDate);
  if (!fireAt) {
    return { queued: false, reason: 'unknown_type' };
  }

  // 발송 시점이 이미 지난 경우 거부
  if (fireAt <= now) {
    return { queued: false, reason: 'already_past', fireAt: fireAt.toISOString() };
  }

  // 이미 큐에 있는 경우 거부
  const existing = await notificationQueue.getJob(`${type}-${contractId}`);
  if (existing) {
    return { queued: false, reason: 'already_queued', fireAt: fireAt.toISOString() };
  }

  const delay = calculateDelay(fireAt);
  await notificationQueue.add(
    type,
    { contractId, scheduledAt: fireAt.toISOString() },
    { delay, jobId: `${type}-${contractId}` }
  );

  console.log(`[알림 큐] 복구 적재: contractId=${contractId}, type=${type}, fireAt=${fireAt.toISOString()}`);
  return { queued: true, reason: 'recovered', fireAt: fireAt.toISOString() };
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
  getScheduledNotifications,
  // 복구 함수
  recoverNotification,
  getFireAt
};
