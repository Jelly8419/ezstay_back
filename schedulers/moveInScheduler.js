/**
 * moveInScheduler.js
 * 입주 준비 서비스 자동화 스케줄러
 *
 * 단계:
 *  1. generateMoveInServiceTasks
 *     - cleaning_status='PAID' & 퇴실일 D-7 이내 케이스 → MoveInServiceTask(CLEANING, PENDING) 자동 생성
 *  2. cleanupExpiredPaymentRequests (선택)
 *     - 만료된 토큰 정리 (참조 무결성 유지를 위해 SENT 상태는 보존, NOT_SENT만 cleanup 검토)
 *
 * cron: 매 10분 (기존 contractScheduler와 동일 주기)
 */
const cron = require('node-cron');
const { Op } = require('sequelize');
const {
  MoveInCase,
  MoveInServiceTask,
  MoveInPaymentRequest
} = require('../models');
const { nowKSTString } = require('../utils/dateHelper');

/**
 * 1. 청소 결제 완료 케이스 → MoveInServiceTask 자동 생성
 *
 * 조건:
 *  - cleaning_status = 'PAID'
 *  - check_out_date 가 오늘 ~ 오늘+7일 사이 (DATEONLY 비교)
 *
 * 동작:
 *  - case당 task_type=CLEANING 1건만 생성 (UNIQUE: case_id+task_type)
 *  - findOrCreate로 중복 방지
 *  - reference_date = check_out_date
 */
async function generateMoveInServiceTasks() {
  try {
    // 2026-05-20: D-7 게이트 제거 — cleaning_status='PAID' 면 즉시 ServiceTask 생성.
    //   - 실제 즉시 생성은 청소 결제 confirm 시점에서 처리 (moveInCleaningController).
    //   - 본 스케줄러는 누락 보정용 백업 (매 10분).
    const cases = await MoveInCase.findAll({
      where: { cleaningStatus: 'PAID' },
      attributes: ['id', 'checkOutDate']
    });

    let created = 0;
    for (const c of cases) {
      const [, wasCreated] = await MoveInServiceTask.findOrCreate({
        where: { caseId: c.id, taskType: 'CLEANING' },
        defaults: {
          referenceDate: c.checkOutDate,
          status: 'PENDING',
          quantity: null
        }
      });
      if (wasCreated) created++;
    }

    if (created > 0) {
      console.log(`[MoveInScheduler] 청소 태스크 ${created}건 생성 (대상 케이스 ${cases.length}건)`);
    }
    return created;
  } catch (err) {
    console.error('[MoveInScheduler] 청소 태스크 생성 오류:', err);
    return 0;
  }
}

/**
 * 2. 만료된 결제 요청 토큰 처리 (선택)
 *
 * 현재 정책: 만료된 토큰도 status는 그대로 두고 expires_at만으로 만료 판정
 *           (게스트가 만료된 링크 클릭 시 안내 페이지에서 재발급 요청 가능하도록)
 * 실제 삭제/정리는 보존 정책 정의 후 추가 (지금은 통계용 카운트만)
 */
async function reportExpiredPaymentRequests() {
  try {
    const now = new Date();
    const expiredCount = await MoveInPaymentRequest.count({
      where: {
        expiresAt: { [Op.lt]: now },
        status: 'SENT'
      }
    });
    if (expiredCount > 0) {
      console.log(`[MoveInScheduler] 만료된 SENT 토큰: ${expiredCount}건 (현재 보존 중)`);
    }
    return expiredCount;
  } catch (err) {
    console.error('[MoveInScheduler] 만료 토큰 카운트 오류:', err);
    return 0;
  }
}

/**
 * 입주 준비 서비스 통합 실행
 */
async function runMoveInTasks() {
  console.log('[MoveInScheduler] 시작:', nowKSTString());
  try {
    await generateMoveInServiceTasks();
    await reportExpiredPaymentRequests();
    console.log('[MoveInScheduler] 완료:', nowKSTString());
  } catch (err) {
    console.error('[MoveInScheduler] 실행 오류:', err);
  }
}

/**
 * 스케줄러 시작 — 매 10분 실행 (기존 contractScheduler와 동일 주기)
 */
function startMoveInScheduler() {
  cron.schedule('*/10 * * * *', runMoveInTasks);
  console.log('[MoveInScheduler] 스케줄러 시작 (매 10분마다 실행)');

  // 서버 시작 시 즉시 1회 실행
  runMoveInTasks();
}

/** Date → 'YYYY-MM-DD' (KST 로컬). process.env.TZ=Asia/Seoul 전제. */
function formatDateOnly(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

module.exports = {
  startMoveInScheduler,
  runMoveInTasks,
  generateMoveInServiceTasks,
  reportExpiredPaymentRequests
};
