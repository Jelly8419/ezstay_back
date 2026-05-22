/**
 * moveInGuestOrderScheduler.js
 * 입주 준비 서비스 — 임차인 옵션 주문 자동 만료 스케줄러
 *
 * 단계:
 *   - expireStalePendingOrders
 *     30분 이상 PENDING 상태인 MoveInGuestOrder 자동 CANCELLED 처리
 *     PayTag cancelOrder 호출(best-effort), OrderItem/Payment 동기 CANCELLED, 로그 기록
 *
 * cron: 매 1분 (기존 moveInScheduler 10분 주기와 분리)
 *
 * env:
 *   MOVE_IN_GUEST_PENDING_EXPIRY_MINUTES  (기본 30) — 만료 임계값(분)
 *
 * NOTE:
 *   moveInScheduler 와 묶지 않은 이유 — 만료 정리는 1분 주기, 청소 태스크 생성은 10분 주기.
 *   주기가 달라 별도 cron 으로 분리.
 */

'use strict';

const cron = require('node-cron');
const { expireStalePendingOrders } = require('../services/moveInGuestOrderService');
const { nowKSTString } = require('../utils/dateHelper');

const BATCH_LIMIT = 100;

async function runExpirePending() {
  try {
    const result = await expireStalePendingOrders({ batchLimit: BATCH_LIMIT });
    if (result.processed > 0) {
      console.log(
        `[MoveInGuestOrderScheduler] ${nowKSTString()} `
        + `processed=${result.processed} cancelled=${result.cancelled} paytagFailures=${result.paytagFailures}`
      );
    }
  } catch (err) {
    console.error('[MoveInGuestOrderScheduler] 실행 오류:', err);
  }
}

/**
 * 스케줄러 시작 — 매 1분 실행.
 * 서버 시작 시 즉시 1회 실행.
 */
function startMoveInGuestOrderScheduler() {
  cron.schedule('* * * * *', runExpirePending);
  console.log('[MoveInGuestOrderScheduler] 시작 (매 1분 — PENDING 자동 만료)');
  runExpirePending();
}

module.exports = {
  startMoveInGuestOrderScheduler,
  runExpirePending
};
