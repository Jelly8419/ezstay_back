/**
 * moveInScheduler.js
 * 입주 준비 서비스 자동화 스케줄러
 *
 * 단계 (매 10분):
 *  1. generateMoveInServiceTasks
 *     - cleaning_status='PAID' & 퇴실일 D-7 이내 케이스 → MoveInServiceTask(CLEANING, PENDING) 자동 생성
 *  2. cleanupExpiredPaymentRequests (선택)
 *     - 만료된 토큰 정리 (참조 무결성 유지를 위해 SENT 상태는 보존, NOT_SENT만 cleanup 검토)
 *
 * 별도 cron (매일 08:00 KST):
 *  - sendBeddingReturnReminders
 *    - check_out_date=오늘 & 침구류 대여 결제자 → 침구류 반납 안내 알림톡(UI_1355)
 *
 * cron: 매 10분 (기존 contractScheduler와 동일 주기)
 */
const cron = require('node-cron');
const { Op } = require('sequelize');
const {
  MoveInCase,
  MoveInServiceTask,
  MoveInPaymentRequest,
  User
} = require('../models');
const { nowKSTString, todayKST } = require('../utils/dateHelper');
const AlimtalkService = require('../services/alimtalkService');

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
 * 침구류 반납 안내 알림톡 발송 (UI_1355) — 매일 08:00 KST 실행.
 *
 * 대상:
 *  - check_out_date = 오늘(KST) 인 케이스
 *  - 침구류 대여 결제자: BEDDING_RETRIEVAL ServiceTask 가 quantity>0 & status!=CANCELLED
 *    (syncBeddingServiceTasks 가 ACTIVE BEDDING_SET 라인 합계로 관리)
 *
 * 중복 발송 방지:
 *  - AlimtalkService.send 가 move_in_case_id 로 AlimtalkLog 기록 → 같은 케이스 재발송 차단
 *  - 1일 1회 실행이라 실무상 중복 위험 낮으나, 재시작 대비 케이스 단위 가드 적용
 */
async function sendBeddingReturnReminders() {
  try {
    const today = todayKST();

    // 오늘 퇴실 + 침구류 수거 task 가 살아있는(quantity>0) 케이스
    const tasks = await MoveInServiceTask.findAll({
      where: {
        taskType: 'BEDDING_RETRIEVAL',
        quantity: { [Op.gt]: 0 },
        status: { [Op.ne]: 'CANCELLED' }
      },
      include: [{
        model: MoveInCase,
        as: 'case',
        where: { checkOutDate: today },
        attributes: ['id', 'guestUserId', 'guestPhone', 'checkOutDate']
      }]
    });

    if (tasks.length === 0) return 0;

    const { AlimtalkLog } = require('../models');
    let sent = 0;

    for (const task of tasks) {
      const caseRow = task.case;
      if (!caseRow?.guestPhone) continue;

      // 케이스 단위 중복 발송 가드 — 이미 발송된 로그가 있으면 skip
      const already = await AlimtalkLog.findOne({
        where: { moveInCaseId: caseRow.id, eventName: 'move_in_bedding_return_guest' }
      });
      if (already) continue;

      // 가입 임차인이면 id 함께 (인앱 매칭용), 미가입자는 phone 만
      const receiver = caseRow.guestUserId
        ? { id: caseRow.guestUserId, phoneNumber: caseRow.guestPhone }
        : { phoneNumber: caseRow.guestPhone };

      const result = await AlimtalkService.sendMoveInBeddingReturn(receiver, {
        moveInCaseId: caseRow.id
      });
      if (result?.sent) sent++;
    }

    if (sent > 0) {
      console.log(`[MoveInScheduler] 침구류 반납 안내 ${sent}건 발송 (대상 케이스 ${tasks.length}건)`);
    }
    return sent;
  } catch (err) {
    console.error('[MoveInScheduler] 침구류 반납 안내 발송 오류:', err);
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

  // 침구류 반납 안내 — 매일 08:00 KST (process.env.TZ=Asia/Seoul 전제)
  cron.schedule('0 8 * * *', async () => {
    console.log('[MoveInScheduler] 침구류 반납 안내 실행:', nowKSTString());
    await sendBeddingReturnReminders();
  });
  console.log('[MoveInScheduler] 침구류 반납 안내 스케줄 등록 (매일 08:00)');

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
  reportExpiredPaymentRequests,
  sendBeddingReturnReminders
};
