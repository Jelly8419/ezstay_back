const cron = require('node-cron');
const { Contract, ChatRoom, ContractStatusLog, sequelize } = require('../models');
const { Op } = require('sequelize');
const { sendSystemMessage } = require('../config/firebaseAdmin');
const { SystemMessageTypes, getSystemMessageTemplate } = require('../utils/systemMessageTypes');
const NotificationService = require('../services/notificationService');
const { CANCEL_TYPES } = require('../utils/notificationMessages');

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

    // 만료될 계약 조회 (로그 기록용)
    const expiredContracts = await Contract.findAll({
      where: {
        status: 'PENDING_APPROVAL',
        [Op.or]: [
          { createdAt: { [Op.lte]: threeDaysAgo } },
          { checkInDate: { [Op.lt]: todayStart } }
        ]
      },
      attributes: ['id', 'createdAt', 'checkInDate'],
      transaction
    });

    // 각 계약별 상태 업데이트 및 로그 기록
    for (const contract of expiredContracts) {
      const timeSinceCreation = now - new Date(contract.createdAt);
      const hoursSinceCreation = Math.floor(timeSinceCreation / (1000 * 60 * 60));
      const isTimeExpired = hoursSinceCreation >= 72;

      // 만료 사유 결정
      const cancellationReason = isTimeExpired
        ? '요청 후 72시간 경과로 인한 자동 만료'
        : '입주일 경과로 인한 자동 만료';

      // 계약 상태 업데이트 (cancellation_reason 포함)
      await Contract.update(
        {
          status: 'APPROVAL_EXPIRED',
          cancellationReason,
          updatedAt: now
        },
        {
          where: { id: contract.id },
          transaction
        }
      );

      // 로그 기록
      await ContractStatusLog.createLog({
        contractId: contract.id,
        fromStatus: 'PENDING_APPROVAL',
        toStatus: 'APPROVAL_EXPIRED',
        changedBy: 'SYSTEM',
        changedByUserId: null,
        reason: cancellationReason,
        metadata: {
          expirationRule: isTimeExpired ? '72H_TIMEOUT' : 'CHECKIN_DATE_PASSED',
          createdAt: contract.createdAt,
          checkInDate: contract.checkInDate,
          hoursSinceCreation,
          expiredAt: now
        },
        transaction
      });
    }

    const result = [expiredContracts.length, expiredContracts.length];

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

    // 먼저 만료될 계약들을 조회 (시스템 메시지 발송용 + 로그 기록용)
    const expiredContracts = await Contract.findAll({
      where: {
        status: 'APPROVED',
        [Op.or]: [
          // 승인일로부터 24시간 경과
          { approvedAt: { [Op.lte]: oneDayAgo } },
          // 입실날짜가 오늘보다 이전 (어제 이전)
          { checkInDate: { [Op.lt]: todayStart } }
        ]
      },
      attributes: ['id', 'approvedAt', 'checkInDate'],
      include: [
        {
          model: ChatRoom,
          as: 'chatRoom',
          attributes: ['firebaseChatRoomId']
        }
      ],
      transaction
    });

    // 계약 상태 업데이트
    const result = await Contract.update(
      {
        status: 'PAYMENT_EXPIRED',
        updatedAt: now
      },
      {
        where: {
          status: 'APPROVED',
          [Op.or]: [
            { approvedAt: { [Op.lte]: oneDayAgo } },
            { checkInDate: { [Op.lt]: todayStart } }
          ]
        },
        transaction
      }
    );

    // 각 계약별 로그 기록
    for (const contract of expiredContracts) {
      const timeSinceApproval = now - new Date(contract.approvedAt);
      const hoursSinceApproval = Math.floor(timeSinceApproval / (1000 * 60 * 60));
      const isPaymentTimeExpired = hoursSinceApproval >= 24;

      await ContractStatusLog.createLog({
        contractId: contract.id,
        fromStatus: 'APPROVED',
        toStatus: 'PAYMENT_EXPIRED',
        changedBy: 'SYSTEM',
        changedByUserId: null,
        reason: isPaymentTimeExpired
          ? '결제 기한 만료 (24시간 경과)'
          : '입실일 당일 종료로 인한 자동 만료',
        metadata: {
          expirationRule: isPaymentTimeExpired ? '24H_TIMEOUT' : 'CHECKIN_DATE_PASSED',
          approvedAt: contract.approvedAt,
          checkInDate: contract.checkInDate,
          hoursSinceApproval,
          expiredAt: now
        },
        transaction
      });
    }

    await transaction.commit();

    // 시스템 메시지 및 알림 발송 (트랜잭션 외부에서 비동기 실행)
    if (expiredContracts.length > 0) {
      for (const contract of expiredContracts) {
        // 채팅 시스템 메시지
        if (contract.chatRoom) {
          sendSystemMessage(
            contract.chatRoom.firebaseChatRoomId,
            getSystemMessageTemplate(SystemMessageTypes.PAYMENT_EXPIRED),
            SystemMessageTypes.PAYMENT_EXPIRED,
            { contractId: contract.id }
          ).catch(err => {
            console.error(`결제 만료 시스템 메시지 발송 실패 (계약 ID: ${contract.id}):`, err);
          });
        }

        // 알림 발송 (결제 만료로 인한 계약 취소)
        try {
          await NotificationService.notifyContractCanceled(contract, CANCEL_TYPES.PAYMENT_EXPIRED);
        } catch (notifyErr) {
          console.error(`결제 만료 알림 발송 실패 (계약 ID: ${contract.id}):`, notifyErr);
        }
      }
    }

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

    // 체크인 대상 계약 조회 (로그 기록용)
    const checkInContracts = await Contract.findAll({
      where: {
        status: 'PAYMENT_COMPLETED',
        checkInDate: { [Op.lte]: now }
      },
      attributes: ['id', 'checkInDate'],
      transaction
    });

    // 계약 상태 업데이트
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

    // 각 계약별 로그 기록
    for (const contract of checkInContracts) {
      await ContractStatusLog.createLog({
        contractId: contract.id,
        fromStatus: 'PAYMENT_COMPLETED',
        toStatus: 'IN_PROGRESS',
        changedBy: 'SYSTEM',
        changedByUserId: null,
        reason: '입실 시간이 도래하여 자동으로 계약 진행 중 상태로 변경',
        metadata: {
          scheduledCheckInDate: contract.checkInDate,
          actualCheckInAt: now
        },
        transaction
      });
    }

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

    // 체크아웃 대상 계약 조회 (로그 기록용)
    const checkOutContracts = await Contract.findAll({
      where: {
        status: 'IN_PROGRESS',
        checkOutDate: { [Op.lte]: now }
      },
      attributes: ['id', 'checkInDate', 'checkOutDate', 'totalDays'],
      transaction
    });

    // 계약 상태 업데이트
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

    // 각 계약별 로그 기록
    for (const contract of checkOutContracts) {
      await ContractStatusLog.createLog({
        contractId: contract.id,
        fromStatus: 'IN_PROGRESS',
        toStatus: 'COMPLETED',
        changedBy: 'SYSTEM',
        changedByUserId: null,
        reason: '퇴실 시간이 도래하여 자동으로 계약 완료 처리',
        metadata: {
          checkInDate: contract.checkInDate,
          scheduledCheckOutDate: contract.checkOutDate,
          actualCheckOutAt: now,
          totalDays: contract.totalDays
        },
        transaction
      });
    }

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
