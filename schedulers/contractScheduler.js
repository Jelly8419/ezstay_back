const cron = require('node-cron');
const { Contract, sequelize } = require('../models');
const { Op } = require('sequelize');

/**
 * 계약 상태 자동 업데이트 스케줄러
 *
 * 실행 주기: 매 10분마다
 * - 미승인 만료 처리
 * - 미결제 만료 처리
 * - 임대중 상태 변경
 * - 계약종료 처리
 */

/**
 * 1. 미승인 만료 처리
 * - PENDING_APPROVAL 상태인 계약 중
 * - 생성일로부터 72시간(3일) 경과 또는 입실날짜 당일이 끝난 경우 (익일 0시 이후)
 * -> APPROVAL_EXPIRED 상태로 변경
 */
async function updateApprovalExpired() {
  const transaction = await sequelize.transaction();

  try {
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 72 * 60 * 60 * 1000); // 72시간 전

    // 입실날짜 당일 23:59:59까지는 만료 안 됨
    // 예: 입실날짜 2025-10-23 14:00 -> 2025-10-23 23:59:59까지 유효
    //     2025-10-24 00:00:00부터 만료
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // 오늘 0시

    const result = await Contract.update(
      {
        status: 'APPROVAL_EXPIRED',
        updatedAt: now
      },
      {
        where: {
          status: 'PENDING_APPROVAL',
          [Op.or]: [
            // 생성일로부터 72시간 경과
            { createdAt: { [Op.lte]: threeDaysAgo } },
            // 입실날짜가 오늘보다 이전 (어제 이전)
            { checkInDate: { [Op.lt]: todayStart } }
          ]
        },
        transaction
      }
    );

    await transaction.commit();

    if (result[0] > 0) {
      console.log(`[스케줄러] ${result[0]}건의 계약을 미승인 만료 처리했습니다.`);
    }

    return result[0];
  } catch (error) {
    await transaction.rollback();
    console.error('[스케줄러] 미승인 만료 처리 오류:', error);
    return 0;
  }
}

/**
 * 2. 미결제 만료 처리
 * - APPROVED 상태인 계약 중
 * - 승인일로부터 24시간 경과 또는 입실날짜 당일이 끝난 경우 (익일 0시 이후)
 * -> PAYMENT_EXPIRED 상태로 변경
 */
async function updatePaymentExpired() {
  const transaction = await sequelize.transaction();

  try {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24시간 전

    // 입실날짜 당일 23:59:59까지는 만료 안 됨
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // 오늘 0시

    const result = await Contract.update(
      {
        status: 'PAYMENT_EXPIRED',
        updatedAt: now
      },
      {
        where: {
          status: 'APPROVED',
          [Op.or]: [
            // 승인일로부터 24시간 경과
            { approvedAt: { [Op.lte]: oneDayAgo } },
            // 입실날짜가 오늘보다 이전 (어제 이전)
            { checkInDate: { [Op.lt]: todayStart } }
          ]
        },
        transaction
      }
    );

    await transaction.commit();

    if (result[0] > 0) {
      console.log(`[스케줄러] ${result[0]}건의 계약을 미결제 만료 처리했습니다.`);
    }

    return result[0];
  } catch (error) {
    await transaction.rollback();
    console.error('[스케줄러] 미결제 만료 처리 오류:', error);
    return 0;
  }
}

/**
 * 3. 임대중 상태 변경
 * - PAYMENT_COMPLETED 상태인 계약 중
 * - 입실시간이 지난 경우
 * -> IN_PROGRESS 상태로 변경
 */
async function updateInProgress() {
  const transaction = await sequelize.transaction();

  try {
    const now = new Date();

    const result = await Contract.update(
      {
        status: 'IN_PROGRESS',
        checkedInAt: now,
        updatedAt: now
      },
      {
        where: {
          status: 'PAYMENT_COMPLETED',
          checkInDate: { [Op.lte]: now }
        },
        transaction
      }
    );

    await transaction.commit();

    if (result[0] > 0) {
      console.log(`[스케줄러] ${result[0]}건의 계약을 임대중 상태로 변경했습니다.`);
    }

    return result[0];
  } catch (error) {
    await transaction.rollback();
    console.error('[스케줄러] 임대중 상태 변경 오류:', error);
    return 0;
  }
}

/**
 * 4. 계약종료 처리
 * - IN_PROGRESS 상태인 계약 중
 * - 퇴실시간이 지난 경우
 * -> COMPLETED 상태로 변경
 */
async function updateCompleted() {
  const transaction = await sequelize.transaction();

  try {
    const now = new Date();

    const result = await Contract.update(
      {
        status: 'COMPLETED',
        checkedOutAt: now,
        updatedAt: now
      },
      {
        where: {
          status: 'IN_PROGRESS',
          checkOutDate: { [Op.lte]: now }
        },
        transaction
      }
    );

    await transaction.commit();

    if (result[0] > 0) {
      console.log(`[스케줄러] ${result[0]}건의 계약을 종료 처리했습니다.`);
    }

    return result[0];
  } catch (error) {
    await transaction.rollback();
    console.error('[스케줄러] 계약종료 처리 오류:', error);
    return 0;
  }
}

/**
 * 모든 계약 상태 업데이트 실행
 */
async function runContractStatusUpdate() {
  console.log('[스케줄러] 계약 상태 자동 업데이트 시작:', new Date().toISOString());

  try {
    // 순차적으로 실행 (상태 변경이 순서대로 이루어져야 함)
    await updateApprovalExpired();  // 1. 미승인 만료
    await updatePaymentExpired();   // 2. 미결제 만료
    await updateInProgress();       // 3. 임대중
    await updateCompleted();        // 4. 계약종료

    console.log('[스케줄러] 계약 상태 자동 업데이트 완료:', new Date().toISOString());
  } catch (error) {
    console.error('[스케줄러] 계약 상태 업데이트 실행 오류:', error);
  }
}

/**
 * 스케줄러 시작
 *
 * 모든 상태 업데이트를 매 10분마다 실행
 * - 미승인 만료: 72시간 경과 OR 입실날짜 다음날
 * - 미결제 만료: 24시간 경과 OR 입실날짜 다음날
 * - 임대중: 입실시간 경과
 * - 계약종료: 퇴실시간 경과
 */
function startContractScheduler() {
  // 모든 상태 업데이트를 매 10분마다 실행
  cron.schedule('*/10 * * * *', runContractStatusUpdate);

  console.log('[스케줄러] 계약 상태 자동 업데이트 스케줄러가 시작되었습니다. (매 10분마다 실행)');

  // 서버 시작 시 즉시 한 번 실행
  runContractStatusUpdate();
}

module.exports = {
  startContractScheduler,
  runContractStatusUpdate,
  updateApprovalExpired,
  updatePaymentExpired,
  updateInProgress,
  updateCompleted
};
