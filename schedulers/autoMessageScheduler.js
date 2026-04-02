const cron = require('node-cron');
const { Contract, ChatRoom, AutoMessageTemplate, Room, NotificationLog } = require('../models');
const { Op } = require('sequelize');
const { sendSystemMessage } = require('../config/firebaseAdmin');

/**
 * 호스트 자동메시지 스케줄러
 *
 * 매 분마다 실행하여 발송 시간이 된 자동메시지를 처리
 * - 계약 확정 시 (CONTRACT_CONFIRMED): 결제 완료 직후 발송 (별도 이벤트 핸들러에서 처리)
 * - 입주일 N일 전 (BEFORE_CHECK_IN): 지정된 시각에 발송
 * - 퇴실일 N일 전 (BEFORE_CHECK_OUT): 지정된 시각에 발송
 */

/**
 * 현재 시간(HH:mm)과 템플릿 발송 시각이 일치하는지 확인
 * @param {string} triggerTime - 템플릿의 발송 시각 (HH:mm)
 * @returns {boolean}
 */
function isCurrentTime(triggerTime) {
  const now = new Date();
  const currentHour = String(now.getHours()).padStart(2, '0');
  const currentMinute = String(now.getMinutes()).padStart(2, '0');
  const currentTime = `${currentHour}:${currentMinute}`;
  return currentTime === triggerTime;
}

/**
 * 특정 날짜의 N일 후 날짜 계산
 * @param {Date} date - 기준 날짜
 * @param {number} days - 추가할 일수
 * @returns {Date}
 */
function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * 날짜를 YYYY-MM-DD 형식으로 변환
 */
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 입주일 기준 자동메시지 발송
 * - triggerType: BEFORE_CHECK_IN
 * - checkInDate - triggerDays = 오늘인 계약 대상
 */
async function sendBeforeCheckInMessages() {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // 활성화된 BEFORE_CHECK_IN 템플릿 조회
    const templates = await AutoMessageTemplate.findAll({
      where: {
        triggerType: 'BEFORE_CHECK_IN',
        isActive: true
      },
      include: [
        {
          model: Room,
          as: 'room',
          attributes: ['id', 'roomName']
        }
      ]
    });

    let totalSuccess = 0;
    let totalFail = 0;
    let totalSkip = 0;

    for (const template of templates) {
      // 현재 시간이 발송 시각과 일치하는지 확인
      if (!isCurrentTime(template.triggerTime)) {
        continue;
      }

      // 대상 날짜 계산: 오늘 + triggerDays = checkInDate
      const targetCheckInDate = addDays(today, template.triggerDays);
      const targetCheckInDateEnd = addDays(targetCheckInDate, 1);
      const targetDate = formatDate(today);

      // 해당 방의 해당 날짜 체크인 계약 조회
      const contracts = await Contract.findAll({
        where: {
          roomId: template.roomId,
          status: {
            [Op.in]: ['PAYMENT_COMPLETED', 'IN_PROGRESS']
          },
          checkInDate: {
            [Op.gte]: targetCheckInDate,
            [Op.lt]: targetCheckInDateEnd
          }
        },
        include: [
          {
            model: ChatRoom,
            as: 'chatRoom',
            attributes: ['id', 'firebaseChatRoomId']
          }
        ]
      });

      // 메시지 발송
      for (const contract of contracts) {
        if (contract.chatRoom) {
          try {
            // 중복 발송 체크 (템플릿 ID + 계약 ID + 날짜)
            const notificationType = `AUTO_MSG_${template.id}_BEFORE_CHECK_IN`;
            const alreadySent = await NotificationLog.isAlreadySent(
              contract.id,
              notificationType,
              targetDate
            );

            if (alreadySent) {
              totalSkip++;
              continue;
            }

            await sendSystemMessage(
              contract.chatRoom.firebaseChatRoomId,
              template.messageContent,
              'HOST_AUTO_MESSAGE',
              {
                templateId: template.id,
                templateTitle: template.title,
                triggerType: template.triggerType,
                hostId: template.hostId,
                contractId: contract.id
              }
            );

            // 발송 로그 기록
            await NotificationLog.logNotification({
              contractId: contract.id,
              chatRoomId: contract.chatRoom.id,
              notificationType,
              autoMessageTemplateId: template.id,
              messageContent: template.messageContent,
              status: 'SUCCESS',
              targetDate
            });

            // 발송 통계 업데이트
            await template.increment('sentCount');
            await template.update({ lastSentAt: new Date() });

            totalSuccess++;
            console.log(`[자동메시지] 입주일 ${template.triggerDays}일 전 발송 완료 - 계약 ID: ${contract.id}, 템플릿: ${template.title}`);
          } catch (err) {
            console.error(`[자동메시지] 발송 실패 - 계약 ID: ${contract.id}:`, err);
            totalFail++;
          }
        }
      }
    }

    if (totalSuccess > 0 || totalFail > 0 || totalSkip > 0) {
      console.log(`[스케줄러] 입주일 기준 자동메시지 발송 완료: 성공 ${totalSuccess}건, 실패 ${totalFail}건, 스킵 ${totalSkip}건`);
    }

    return { successCount: totalSuccess, failCount: totalFail, skipCount: totalSkip };
  } catch (error) {
    console.error('[스케줄러] 입주일 기준 자동메시지 발송 오류:', error);
    return { successCount: 0, failCount: 0, skipCount: 0 };
  }
}

/**
 * 퇴실일 기준 자동메시지 발송
 * - triggerType: BEFORE_CHECK_OUT
 * - checkOutDate - triggerDays = 오늘인 계약 대상
 */
async function sendBeforeCheckOutMessages() {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // 활성화된 BEFORE_CHECK_OUT 템플릿 조회
    const templates = await AutoMessageTemplate.findAll({
      where: {
        triggerType: 'BEFORE_CHECK_OUT',
        isActive: true
      },
      include: [
        {
          model: Room,
          as: 'room',
          attributes: ['id', 'roomName']
        }
      ]
    });

    let totalSuccess = 0;
    let totalFail = 0;
    let totalSkip = 0;

    for (const template of templates) {
      // 현재 시간이 발송 시각과 일치하는지 확인
      if (!isCurrentTime(template.triggerTime)) {
        continue;
      }

      // 대상 날짜 계산: 오늘 + triggerDays = checkOutDate
      const targetCheckOutDate = addDays(today, template.triggerDays);
      const targetCheckOutDateEnd = addDays(targetCheckOutDate, 1);
      const targetDate = formatDate(today);

      // 해당 방의 해당 날짜 체크아웃 계약 조회
      const contracts = await Contract.findAll({
        where: {
          roomId: template.roomId,
          status: 'IN_PROGRESS',
          checkOutDate: {
            [Op.gte]: targetCheckOutDate,
            [Op.lt]: targetCheckOutDateEnd
          }
        },
        include: [
          {
            model: ChatRoom,
            as: 'chatRoom',
            attributes: ['id', 'firebaseChatRoomId']
          }
        ]
      });

      // 메시지 발송
      for (const contract of contracts) {
        if (contract.chatRoom) {
          try {
            // 중복 발송 체크 (템플릿 ID + 계약 ID + 날짜)
            const notificationType = `AUTO_MSG_${template.id}_BEFORE_CHECK_OUT`;
            const alreadySent = await NotificationLog.isAlreadySent(
              contract.id,
              notificationType,
              targetDate
            );

            if (alreadySent) {
              totalSkip++;
              continue;
            }

            await sendSystemMessage(
              contract.chatRoom.firebaseChatRoomId,
              template.messageContent,
              'HOST_AUTO_MESSAGE',
              {
                templateId: template.id,
                templateTitle: template.title,
                triggerType: template.triggerType,
                hostId: template.hostId,
                contractId: contract.id
              }
            );

            // 발송 로그 기록
            await NotificationLog.logNotification({
              contractId: contract.id,
              chatRoomId: contract.chatRoom.id,
              notificationType,
              autoMessageTemplateId: template.id,
              messageContent: template.messageContent,
              status: 'SUCCESS',
              targetDate
            });

            // 발송 통계 업데이트
            await template.increment('sentCount');
            await template.update({ lastSentAt: new Date() });

            totalSuccess++;
            console.log(`[자동메시지] 퇴실일 ${template.triggerDays}일 전 발송 완료 - 계약 ID: ${contract.id}, 템플릿: ${template.title}`);
          } catch (err) {
            console.error(`[자동메시지] 발송 실패 - 계약 ID: ${contract.id}:`, err);
            totalFail++;
          }
        }
      }
    }

    if (totalSuccess > 0 || totalFail > 0 || totalSkip > 0) {
      console.log(`[스케줄러] 퇴실일 기준 자동메시지 발송 완료: 성공 ${totalSuccess}건, 실패 ${totalFail}건, 스킵 ${totalSkip}건`);
    }

    return { successCount: totalSuccess, failCount: totalFail, skipCount: totalSkip };
  } catch (error) {
    console.error('[스케줄러] 퇴실일 기준 자동메시지 발송 오류:', error);
    return { successCount: 0, failCount: 0, skipCount: 0 };
  }
}

/**
 * 계약 확정 시 자동메시지 발송 (이벤트 핸들러에서 호출)
 * - triggerType: CONTRACT_CONFIRMED
 * - 결제 완료 시점에 즉시 발송
 *
 * @param {number} contractId - 계약 ID
 * @param {number} roomId - 방 ID
 */
async function sendContractConfirmedMessages(contractId, roomId) {
  try {
    const today = formatDate(new Date());

    // 해당 방의 활성화된 CONTRACT_CONFIRMED 템플릿 조회
    const templates = await AutoMessageTemplate.findAll({
      where: {
        roomId,
        triggerType: 'CONTRACT_CONFIRMED',
        isActive: true
      }
    });

    if (templates.length === 0) {
      return { successCount: 0, failCount: 0, skipCount: 0 };
    }

    // 계약의 채팅방 조회
    const chatRoom = await ChatRoom.findOne({
      where: { contractId },
      attributes: ['id', 'firebaseChatRoomId']
    });

    if (!chatRoom) {
      console.warn(`[자동메시지] 채팅방 없음 - 계약 ID: ${contractId}`);
      return { successCount: 0, failCount: 0, skipCount: 0 };
    }

    let successCount = 0;
    let failCount = 0;
    let skipCount = 0;

    for (const template of templates) {
      try {
        // 중복 발송 체크
        const notificationType = `AUTO_MSG_${template.id}_CONTRACT_CONFIRMED`;
        const alreadySent = await NotificationLog.isAlreadySent(
          contractId,
          notificationType,
          today
        );

        if (alreadySent) {
          skipCount++;
          continue;
        }

        await sendSystemMessage(
          chatRoom.firebaseChatRoomId,
          template.messageContent,
          'HOST_AUTO_MESSAGE',
          {
            templateId: template.id,
            templateTitle: template.title,
            triggerType: template.triggerType,
            hostId: template.hostId,
            contractId
          }
        );

        // 발송 로그 기록
        await NotificationLog.logNotification({
          contractId,
          chatRoomId: chatRoom.id,
          notificationType,
          autoMessageTemplateId: template.id,
          messageContent: template.messageContent,
          status: 'SUCCESS',
          targetDate: today
        });

        // 발송 통계 업데이트
        await template.increment('sentCount');
        await template.update({ lastSentAt: new Date() });

        successCount++;
        console.log(`[자동메시지] 계약 확정 메시지 발송 완료 - 계약 ID: ${contractId}, 템플릿: ${template.title}`);
      } catch (err) {
        console.error(`[자동메시지] 계약 확정 메시지 발송 실패 - 계약 ID: ${contractId}:`, err);
        failCount++;
      }
    }

    return { successCount, failCount, skipCount };
  } catch (error) {
    console.error('[자동메시지] 계약 확정 메시지 발송 오류:', error);
    return { successCount: 0, failCount: 0, skipCount: 0 };
  }
}

/**
 * 자동메시지 스케줄러 실행 (매분 실행)
 */
async function runAutoMessageScheduler() {
  try {
    // 입주일/퇴실일 기준 자동메시지 병렬 실행
    await Promise.all([
      sendBeforeCheckInMessages(),
      sendBeforeCheckOutMessages()
    ]);
  } catch (error) {
    console.error('[스케줄러] 자동메시지 스케줄러 실행 오류:', error);
  }
}

/**
 * 자동메시지 스케줄러 시작
 * 매 분마다 실행하여 발송 시각이 일치하는 템플릿 처리
 */
function startAutoMessageScheduler() {
  // 매 분 실행 (cron: 분 시 일 월 요일)
  cron.schedule('* * * * *', runAutoMessageScheduler);

  console.log('[스케줄러] 호스트 자동메시지 스케줄러가 시작되었습니다. (매분 실행)');
}

module.exports = {
  startAutoMessageScheduler,
  runAutoMessageScheduler,
  sendBeforeCheckInMessages,
  sendBeforeCheckOutMessages,
  sendContractConfirmedMessages
};
