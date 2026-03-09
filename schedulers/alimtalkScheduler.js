const cron = require('node-cron');
const { Op } = require('sequelize');
const AlimtalkService = require('../services/alimtalkService');
const { syncTemplates } = require('../utils/alimtalkTemplateCache');

/**
 * 카카오 알림톡 스케줄러
 *
 * 1. 서버 시작 시 → 템플릿 동기화 (Aligo API → 캐시)
 * 2. 매 6시간    → 템플릿 자동 갱신
 * 3. 매일 17:55  → 퇴실 전일 알림 (4-6) - 18:00 발송
 * 4. 매 10분     → 실패 건 재시도
 *
 * NOTE: 즉시 이벤트(결제완료, 취소 등)는 컨트롤러/notificationService에서 직접 호출
 */

/**
 * 퇴실 전일 알림 발송 (4-6)
 * 내일 퇴실인 IN_PROGRESS 계약에 대해 게스트에게 알림톡 발송
 */
async function sendCheckoutEveNotifications() {
  const { Contract, User, Room } = require('../models');

  try {
    const now = new Date();
    // 내일 날짜 계산
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

    const contracts = await Contract.findAll({
      where: {
        status: 'IN_PROGRESS',
        checkOutDate: tomorrowStr
      },
      include: [
        { model: User, as: 'guest', attributes: ['id', 'phoneNumber', 'name', 'nickname'] },
        { model: Room, as: 'room', attributes: ['id', 'roomName', 'checkOutTime'] }
      ]
    });

    if (contracts.length === 0) return;

    console.log(`[AlimtalkScheduler] 퇴실 전일 알림 대상: ${contracts.length}건`);

    for (const contract of contracts) {
      if (!contract.guest) continue;
      await AlimtalkService.sendCheckoutEve(contract, contract.guest, contract.room);
    }

    console.log(`[AlimtalkScheduler] 퇴실 전일 알림 발송 완료`);
  } catch (err) {
    console.error('[AlimtalkScheduler] 퇴실 전일 알림 에러:', err.message);
  }
}

/**
 * 실패 건 재시도
 * FAILED + retryCount=0인 건들을 10분 이후 재시도
 */
async function retryFailedAlimtalk() {
  try {
    const result = await AlimtalkService.retryAllFailed(50);
    if (result.total > 0) {
      console.log(`[AlimtalkScheduler] 재시도: ${result.retried}/${result.total}건 성공`);
    }
  } catch (err) {
    console.error('[AlimtalkScheduler] 재시도 에러:', err.message);
  }
}

/**
 * 알림톡 스케줄러 시작
 */
function startAlimtalkScheduler() {
  // 환경변수 확인
  if (!process.env.ALIGO_API_KEY) {
    console.warn('[AlimtalkScheduler] ALIGO_API_KEY 미설정 → 알림톡 스케줄러 비활성화');
    return;
  }

  // 0. 서버 시작 시 템플릿 동기화 (비차단)
  syncTemplates().catch(err => {
    console.error('[AlimtalkScheduler] 초기 템플릿 동기화 실패:', err.message);
  });

  // 1. 매 6시간 → 템플릿 자동 갱신 (0시, 6시, 12시, 18시)
  cron.schedule('0 0,6,12,18 * * *', async () => {
    console.log('[AlimtalkScheduler] 템플릿 동기화 실행');
    await syncTemplates();
  }, { timezone: 'Asia/Seoul' });

  // 2. 매일 17:55 → 퇴실 전일 알림 (18:00 발송 목표)
  cron.schedule('55 17 * * *', async () => {
    console.log('[AlimtalkScheduler] 퇴실 전일 알림 실행');
    await sendCheckoutEveNotifications();
  }, { timezone: 'Asia/Seoul' });

  // 3. 매 10분 → 실패 건 재시도
  cron.schedule('*/10 * * * *', async () => {
    await retryFailedAlimtalk();
  }, { timezone: 'Asia/Seoul' });

  console.log('✅ 알림톡 스케줄러 시작 (템플릿동기화: 6시간, 퇴실전일: 매일 17:55, 재시도: 매 10분)');
}

module.exports = { startAlimtalkScheduler };
