const cron = require('node-cron');
const { Contract, ChatRoom } = require('../models');
const { Op } = require('sequelize');
const { sendSystemMessage } = require('../config/firebaseAdmin');
const { SystemMessageTypes, getSystemMessageTemplate } = require('../utils/systemMessageTypes');

/**
 * 체크인/체크아웃 알림 스케줄러
 *
 * 실행 주기: 매일 오전 9시
 * - 내일 체크인 예정 계약: 시스템 메시지 발송
 * - 내일 체크아웃 예정 계약: 시스템 메시지 발송
 */

/**
 * 체크인 D-1 알림 발송
 * - APPROVED 또는 PAYMENT_COMPLETED 상태
 * - 체크인 날짜가 내일인 계약
 */
async function sendCheckInReminders() {
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0); // 내일 0시

    const dayAfterTomorrow = new Date(tomorrow);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1); // 모레 0시

    // 내일 체크인 예정인 계약 조회
    const contracts = await Contract.findAll({
      where: {
        status: {
          [Op.in]: ['APPROVED', 'PAYMENT_COMPLETED']
        },
        checkInDate: {
          [Op.gte]: tomorrow,
          [Op.lt]: dayAfterTomorrow
        }
      },
      include: [
        {
          model: ChatRoom,
          as: 'chatRoom',
          attributes: ['firebaseChatRoomId']
        }
      ]
    });

    let successCount = 0;
    let failCount = 0;

    // 시스템 메시지 발송
    for (const contract of contracts) {
      if (contract.chatRoom) {
        try {
          await sendSystemMessage(
            contract.chatRoom.firebaseChatRoomId,
            getSystemMessageTemplate(SystemMessageTypes.CHECK_IN_REMINDER),
            SystemMessageTypes.CHECK_IN_REMINDER,
            {
              contractId: contract.id,
              checkInDate: contract.checkInDate
            }
          );
          successCount++;
        } catch (err) {
          console.error(`체크인 알림 발송 실패 (계약 ID: ${contract.id}):`, err);
          failCount++;
        }
      }
    }

    console.log(`[스케줄러] 체크인 D-1 알림 발송 완료: 성공 ${successCount}건, 실패 ${failCount}건`);
    return { successCount, failCount };
  } catch (error) {
    console.error('[스케줄러] 체크인 알림 발송 오류:', error);
    return { successCount: 0, failCount: 0 };
  }
}

/**
 * 체크아웃 D-1 알림 발송
 * - IN_PROGRESS 상태
 * - 체크아웃 날짜가 내일인 계약
 */
async function sendCheckOutReminders() {
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0); // 내일 0시

    const dayAfterTomorrow = new Date(tomorrow);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1); // 모레 0시

    // 내일 체크아웃 예정인 계약 조회
    const contracts = await Contract.findAll({
      where: {
        status: 'IN_PROGRESS',
        checkOutDate: {
          [Op.gte]: tomorrow,
          [Op.lt]: dayAfterTomorrow
        }
      },
      include: [
        {
          model: ChatRoom,
          as: 'chatRoom',
          attributes: ['firebaseChatRoomId']
        }
      ]
    });

    let successCount = 0;
    let failCount = 0;

    // 시스템 메시지 발송
    for (const contract of contracts) {
      if (contract.chatRoom) {
        try {
          await sendSystemMessage(
            contract.chatRoom.firebaseChatRoomId,
            getSystemMessageTemplate(SystemMessageTypes.CHECK_OUT_REMINDER),
            SystemMessageTypes.CHECK_OUT_REMINDER,
            {
              contractId: contract.id,
              checkOutDate: contract.checkOutDate
            }
          );
          successCount++;
        } catch (err) {
          console.error(`체크아웃 알림 발송 실패 (계약 ID: ${contract.id}):`, err);
          failCount++;
        }
      }
    }

    console.log(`[스케줄러] 체크아웃 D-1 알림 발송 완료: 성공 ${successCount}건, 실패 ${failCount}건`);
    return { successCount, failCount };
  } catch (error) {
    console.error('[스케줄러] 체크아웃 알림 발송 오류:', error);
    return { successCount: 0, failCount: 0 };
  }
}

/**
 * 계약 완료 시스템 메시지 발송
 * - COMPLETED 상태로 변경된 계약
 * - 체크아웃 완료 후 리뷰 요청
 */
async function sendContractCompletionMessages() {
  try {
    const now = new Date();

    // 오늘 체크아웃한 계약 조회 (COMPLETED 상태)
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const contracts = await Contract.findAll({
      where: {
        status: 'COMPLETED',
        checkedOutAt: {
          [Op.gte]: todayStart
        }
      },
      include: [
        {
          model: ChatRoom,
          as: 'chatRoom',
          attributes: ['firebaseChatRoomId']
        }
      ]
    });

    let successCount = 0;

    // 시스템 메시지 발송
    for (const contract of contracts) {
      if (contract.chatRoom) {
        try {
          // 1. 체크아웃 완료 메시지
          await sendSystemMessage(
            contract.chatRoom.firebaseChatRoomId,
            getSystemMessageTemplate(SystemMessageTypes.CHECK_OUT_COMPLETED),
            SystemMessageTypes.CHECK_OUT_COMPLETED,
            {
              contractId: contract.id
            }
          );

          // 2. 리뷰 요청 메시지 (3초 후)
          setTimeout(async () => {
            try {
              await sendSystemMessage(
                contract.chatRoom.firebaseChatRoomId,
                getSystemMessageTemplate(SystemMessageTypes.REVIEW_REQUEST),
                SystemMessageTypes.REVIEW_REQUEST,
                {
                  contractId: contract.id
                }
              );
            } catch (err) {
              console.error(`리뷰 요청 메시지 발송 실패 (계약 ID: ${contract.id}):`, err);
            }
          }, 3000);

          successCount++;
        } catch (err) {
          console.error(`체크아웃 완료 메시지 발송 실패 (계약 ID: ${contract.id}):`, err);
        }
      }
    }

    console.log(`[스케줄러] 계약 완료 메시지 발송 완료: ${successCount}건`);
    return { successCount };
  } catch (error) {
    console.error('[스케줄러] 계약 완료 메시지 발송 오류:', error);
    return { successCount: 0 };
  }
}

/**
 * 모든 채팅 알림 발송 실행
 */
async function runChatReminders() {
  console.log('[스케줄러] 채팅 알림 발송 시작:', new Date().toISOString());

  try {
    // 병렬 실행
    await Promise.all([
      sendCheckInReminders(),
      sendCheckOutReminders(),
      sendContractCompletionMessages()
    ]);

    console.log('[스케줄러] 채팅 알림 발송 완료:', new Date().toISOString());
  } catch (error) {
    console.error('[스케줄러] 채팅 알림 발송 실행 오류:', error);
  }
}

/**
 * 스케줄러 시작
 *
 * 매일 오전 9시에 실행
 * - 체크인 D-1 알림
 * - 체크아웃 D-1 알림
 * - 계약 완료 메시지
 */
function startChatReminderScheduler() {
  // 매일 오전 9시 실행 (cron: 분 시 일 월 요일)
  cron.schedule('0 9 * * *', runChatReminders);

  console.log('[스케줄러] 채팅 알림 스케줄러가 시작되었습니다. (매일 오전 9시 실행)');

  // 서버 시작 시 즉시 한 번 실행 (개발 환경에서만)
  if (process.env.NODE_ENV === 'development') {
    console.log('[개발 모드] 채팅 알림 즉시 실행...');
    runChatReminders();
  }
}

module.exports = {
  startChatReminderScheduler,
  runChatReminders,
  sendCheckInReminders,
  sendCheckOutReminders,
  sendContractCompletionMessages
};
