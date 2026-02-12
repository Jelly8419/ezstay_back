const cron = require('node-cron');
const { Contract, ChatRoom, Room, ContractStatusLog, Settlement, sequelize } = require('../models');
const { Op } = require('sequelize');
const { sendSystemMessage } = require('../config/firebaseAdmin');
const { SystemMessageTypes, getSystemMessageTemplate } = require('../utils/systemMessageTypes');
const NotificationService = require('../services/notificationService');
const { CANCEL_TYPES } = require('../utils/notificationMessages');
const { calculateSettlementDate, calculateSettlementAmount } = require('../services/settlementService');

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
      attributes: ['id', 'approvedAt', 'checkInDate', 'hostId', 'guestId', 'roomId'],
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
 * - 입실날짜 + 방의 입실시간(checkInTime)이 지난 경우
 * -> IN_PROGRESS 상태로 변경
 *
 * 정책: 입실 시간은 방별로 14~17시 중 호스트가 설정
 * 예: checkInDate=2025-10-23, checkInTime=15 → 2025-10-23 15:00:00 이후 IN_PROGRESS
 */
async function updateInProgress() {
  const transaction = await sequelize.transaction();

  try {
    const now = new Date();

    // Room JOIN으로 checkInTime 포함하여 체크인 대상 조회
    const checkInContracts = await Contract.findAll({
      where: {
        status: 'PAYMENT_COMPLETED'
      },
      attributes: ['id', 'checkInDate', 'roomId'],
      include: [
        {
          model: Room,
          as: 'room',
          attributes: ['id', 'checkInTime']
        }
      ],
      transaction
    });

    // 입실시간이 지난 계약만 필터링
    const eligibleContracts = checkInContracts.filter(contract => {
      const checkInTime = contract.room ? contract.room.checkInTime : 14; // 기본값 14시
      const checkInDate = new Date(contract.checkInDate);
      // checkInDate의 날짜 + checkInTime 시간으로 정확한 입실 datetime 생성
      const exactCheckInDatetime = new Date(
        checkInDate.getFullYear(),
        checkInDate.getMonth(),
        checkInDate.getDate(),
        checkInTime, 0, 0
      );
      return now >= exactCheckInDatetime;
    });

    // 각 계약별 상태 업데이트 및 로그 기록
    for (const contract of eligibleContracts) {
      const checkInTime = contract.room ? contract.room.checkInTime : 14;

      await Contract.update(
        {
          status: 'IN_PROGRESS',
          checkedInAt: now,
          updatedAt: now
        },
        {
          where: { id: contract.id },
          transaction
        }
      );

      await ContractStatusLog.createLog({
        contractId: contract.id,
        fromStatus: 'PAYMENT_COMPLETED',
        toStatus: 'IN_PROGRESS',
        changedBy: 'SYSTEM',
        changedByUserId: null,
        reason: '입실 시간이 도래하여 자동으로 계약 진행 중 상태로 변경',
        metadata: {
          scheduledCheckInDate: contract.checkInDate,
          roomCheckInTime: checkInTime,
          actualCheckInAt: now
        },
        transaction
      });

      // Settlement 레코드 자동 생성 (입주 시점에 정산 예약)
      try {
        const existingSettlement = await Settlement.findOne({
          where: { contractId: contract.id },
          transaction
        });

        if (!existingSettlement) {
          const fullContract = await Contract.findByPk(contract.id, {
            attributes: ['id', 'hostId', 'checkInDate', 'rentalFee', 'maintenanceFee', 'cleaningFee', 'hostPlatformFee'],
            transaction
          });

          const expectedDate = calculateSettlementDate(fullContract.checkInDate);
          const settlementCalc = calculateSettlementAmount(fullContract, []);
          const grossAmount = settlementCalc.subtotal;
          const netAmount = settlementCalc.finalAmount;

          await Settlement.create({
            contractId: fullContract.id,
            hostId: fullContract.hostId,
            status: 'PENDING',
            rentalFee: fullContract.rentalFee || 0,
            maintenanceFee: fullContract.maintenanceFee || 0,
            cleaningFee: fullContract.cleaningFee || 0,
            hostPlatformFee: fullContract.hostPlatformFee || 0,
            refundDeduction: 0,
            grossAmount,
            netAmount,
            expectedDate: expectedDate.toISOString().split('T')[0],
            settlementSnapshot: {
              createdAt: now.toISOString(),
              checkInDate: fullContract.checkInDate,
              rentalFee: fullContract.rentalFee,
              maintenanceFee: fullContract.maintenanceFee,
              cleaningFee: fullContract.cleaningFee,
              hostPlatformFee: fullContract.hostPlatformFee
            }
          }, { transaction });
        }
      } catch (settlementErr) {
        console.error(`[스케줄러] Settlement 생성 실패 (계약 ID: ${contract.id}):`, settlementErr);
        // Settlement 생성 실패가 계약 상태 변경을 막지 않도록 에러 무시
      }
    }

    await transaction.commit();

    if (eligibleContracts.length > 0) {
      console.log(`[스케줄러] ${eligibleContracts.length}건의 계약을 임대중 상태로 변경했습니다.`);
    }

    return eligibleContracts.length;
  } catch (error) {
    await transaction.rollback();
    console.error('[스케줄러] 임대중 상태 변경 오류:', error);
    return 0;
  }
}

/**
 * 4. 계약종료 처리 (퇴실시간 경과 시 자동 완료)
 * - IN_PROGRESS 상태인 계약 중
 * - 퇴실날짜 + 방의 퇴실시간(checkOutTime)이 지난 경우
 * - 게스트가 퇴실 요청을 하지 않았더라도 자동 완료 (안전장치)
 * -> COMPLETED 상태로 변경
 *
 * 정책: 퇴실 시간은 방별로 8~11시 중 호스트가 설정
 * 예: checkOutDate=2025-11-06, checkOutTime=11 → 2025-11-06 11:00:00 이후 COMPLETED
 *
 * 참고: 정상 퇴실 프로세스는 게스트 퇴실요청 → 호스트 확인 (또는 48시간 자동확정)
 *       이 스케줄러는 퇴실시간이 지났는데 아직 완료 안 된 계약에 대한 자동 처리
 */
async function updateCompleted() {
  const transaction = await sequelize.transaction();

  try {
    const now = new Date();

    // Room JOIN으로 checkOutTime 포함하여 체크아웃 대상 조회
    const checkOutContracts = await Contract.findAll({
      where: {
        status: 'IN_PROGRESS'
      },
      attributes: ['id', 'checkInDate', 'checkOutDate', 'totalDays', 'roomId', 'checkoutRequested', 'deposit'],
      include: [
        {
          model: Room,
          as: 'room',
          attributes: ['id', 'checkOutTime']
        }
      ],
      transaction
    });

    // 퇴실시간이 지난 계약만 필터링
    const eligibleContracts = checkOutContracts.filter(contract => {
      const checkOutTime = contract.room ? contract.room.checkOutTime : 11; // 기본값 11시
      const checkOutDate = new Date(contract.checkOutDate);
      const exactCheckOutDatetime = new Date(
        checkOutDate.getFullYear(),
        checkOutDate.getMonth(),
        checkOutDate.getDate(),
        checkOutTime, 0, 0
      );
      return now >= exactCheckOutDatetime;
    });

    // 각 계약별 상태 업데이트 및 로그 기록
    for (const contract of eligibleContracts) {
      const checkOutTime = contract.room ? contract.room.checkOutTime : 11;

      await Contract.update(
        {
          status: 'COMPLETED',
          checkedOutAt: now,
          // 게스트가 퇴실 요청하지 않았으면 자동으로 요청 처리
          checkoutRequested: true,
          checkoutRequestedAt: contract.checkoutRequested ? undefined : now,
          // 호스트 확인도 자동 처리
          hostCheckedOut: true,
          hostCheckedOutAt: now,
          // 보증금 전액 반환 (차감 없음 - 자동 퇴실이므로)
          depositDeduction: 0,
          refundableDeposit: contract.deposit || 0,
          depositStatus: 'RETURN_PENDING',
          updatedAt: now
        },
        {
          where: { id: contract.id },
          transaction
        }
      );

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
          roomCheckOutTime: checkOutTime,
          actualCheckOutAt: now,
          totalDays: contract.totalDays,
          autoCompleted: true,
          hadCheckoutRequest: contract.checkoutRequested
        },
        transaction
      });
    }

    await transaction.commit();

    if (eligibleContracts.length > 0) {
      console.log(`[스케줄러] ${eligibleContracts.length}건의 계약을 종료 처리했습니다.`);
    }

    return eligibleContracts.length;
  } catch (error) {
    await transaction.rollback();
    console.error('[스케줄러] 계약종료 처리 오류:', error);
    return 0;
  }
}

/**
 * 5. 퇴실 요청 48시간 자동확정
 * - IN_PROGRESS 상태인 계약 중
 * - 게스트가 퇴실 요청(checkoutRequested=true)한 후
 * - 48시간 경과 && 호스트가 아직 확인하지 않은 경우(hostCheckedOut=false)
 * -> 자동으로 퇴실 확정 (COMPLETED 상태로 변경, 보증금 전액 반환)
 *
 * 정책: 호스트가 48시간 내 퇴실 확인 안 하면 자동 확정
 */
async function autoConfirmCheckout() {
  const transaction = await sequelize.transaction();

  try {
    const now = new Date();
    const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    // 48시간 경과한 퇴실 요청 조회
    const pendingCheckouts = await Contract.findAll({
      where: {
        status: 'IN_PROGRESS',
        checkoutRequested: true,
        hostCheckedOut: false,
        checkoutRequestedAt: { [Op.lte]: fortyEightHoursAgo }
      },
      attributes: ['id', 'checkInDate', 'checkOutDate', 'checkoutRequestedAt', 'deposit', 'hostId', 'guestId', 'roomId'],
      include: [
        {
          model: ChatRoom,
          as: 'chatRoom',
          attributes: ['firebaseChatRoomId']
        }
      ],
      transaction
    });

    // 각 계약별 자동 확정 처리
    for (const contract of pendingCheckouts) {
      const hoursSinceRequest = Math.floor(
        (now - new Date(contract.checkoutRequestedAt)) / (1000 * 60 * 60)
      );

      await Contract.update(
        {
          status: 'COMPLETED',
          checkedOutAt: now,
          hostCheckedOut: true,
          hostCheckedOutAt: now,
          depositDeduction: 0,
          refundableDeposit: contract.deposit || 0,
          depositStatus: 'RETURN_PENDING',
          updatedAt: now
        },
        {
          where: { id: contract.id },
          transaction
        }
      );

      await ContractStatusLog.createLog({
        contractId: contract.id,
        fromStatus: 'IN_PROGRESS',
        toStatus: 'COMPLETED',
        changedBy: 'SYSTEM',
        changedByUserId: null,
        reason: '퇴실 요청 후 48시간 경과로 자동 퇴실 확정 (보증금 전액 반환)',
        metadata: {
          checkoutRequestedAt: contract.checkoutRequestedAt,
          hoursSinceRequest,
          autoConfirmed: true,
          depositRefunded: contract.deposit || 0
        },
        transaction
      });
    }

    await transaction.commit();

    // 알림 발송 (트랜잭션 외부에서 비동기 실행)
    if (pendingCheckouts.length > 0) {
      for (const contract of pendingCheckouts) {
        // 채팅 시스템 메시지
        if (contract.chatRoom) {
          sendSystemMessage(
            contract.chatRoom.firebaseChatRoomId,
            '퇴실 요청 후 48시간이 경과하여 자동으로 퇴실이 확정되었습니다. 보증금이 전액 반환됩니다.',
            'CHECKOUT_AUTO_CONFIRMED',
            { contractId: contract.id }
          ).catch(err => {
            console.error(`자동 퇴실 확정 시스템 메시지 발송 실패 (계약 ID: ${contract.id}):`, err);
          });
        }

        // 알림 발송
        try {
          await NotificationService.notifyCheckoutConfirmed(contract);
        } catch (notifyErr) {
          console.error(`자동 퇴실 확정 알림 발송 실패 (계약 ID: ${contract.id}):`, notifyErr);
        }
      }

      console.log(`[스케줄러] ${pendingCheckouts.length}건의 퇴실 요청을 48시간 자동확정 처리했습니다.`);
    }

    return pendingCheckouts.length;
  } catch (error) {
    await transaction.rollback();
    console.error('[스케줄러] 48시간 자동 퇴실확정 오류:', error);
    return 0;
  }
}

/**
 * 6. 정산 상태 자동 업데이트
 * - PENDING 상태인 Settlement 중
 * - expectedDate가 오늘이거나 지난 경우
 * -> READY 상태로 변경 (토스 서브몰 정산 가능)
 *
 * 정책: 입주일 + 3영업일 = 정산 예정일, 예정일 도래 시 READY
 */
async function updateSettlementReady() {
  const transaction = await sequelize.transaction();

  try {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD

    const [updatedCount] = await Settlement.update(
      {
        status: 'READY',
        updatedAt: today
      },
      {
        where: {
          status: 'PENDING',
          expectedDate: { [Op.lte]: todayStr }
        },
        transaction
      }
    );

    await transaction.commit();

    if (updatedCount > 0) {
      console.log(`[스케줄러] ${updatedCount}건의 정산을 READY 상태로 변경했습니다.`);
    }

    return updatedCount;
  } catch (error) {
    await transaction.rollback();
    console.error('[스케줄러] 정산 READY 상태 변경 오류:', error);
    return 0;
  }
}

/**
 * 7. 보증금 자동 반환 처리
 * - COMPLETED 상태인 계약 중
 * - depositStatus가 RETURN_PENDING인 경우
 * - 해당 계약의 Settlement가 READY 이상인 경우 (정산 예정일 도래)
 * -> depositStatus를 RETURNED로 변경
 *
 * 정책: 정산 예정일(입주일+3영업일) 도래 후 보증금 자동 반환
 *       향후 토스 서브몰 연동 시 실제 송금 처리 추가
 */
async function autoReturnDeposit() {
  const transaction = await sequelize.transaction();

  try {
    const now = new Date();

    // RETURN_PENDING 상태인 계약 중 Settlement가 READY 이상인 건 조회
    const pendingDeposits = await Contract.findAll({
      where: {
        status: 'COMPLETED',
        depositStatus: 'RETURN_PENDING'
      },
      attributes: ['id', 'deposit', 'refundableDeposit'],
      include: [
        {
          model: Settlement,
          as: 'settlement',
          attributes: ['id', 'status'],
          where: {
            status: { [Op.in]: ['READY', 'PROCESSING', 'COMPLETED'] }
          },
          required: true
        }
      ],
      transaction
    });

    for (const contract of pendingDeposits) {
      await Contract.update(
        {
          depositStatus: 'RETURNED',
          updatedAt: now
        },
        {
          where: { id: contract.id },
          transaction
        }
      );
    }

    await transaction.commit();

    if (pendingDeposits.length > 0) {
      console.log(`[스케줄러] ${pendingDeposits.length}건의 보증금을 자동 반환 처리했습니다.`);
    }

    return pendingDeposits.length;
  } catch (error) {
    await transaction.rollback();
    console.error('[스케줄러] 보증금 자동 반환 오류:', error);
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
    await updateInProgress();       // 3. 임대중 (+ Settlement 자동 생성)
    await autoConfirmCheckout();    // 4. 48시간 자동 퇴실확정
    await updateCompleted();        // 5. 퇴실시간 경과 시 자동 완료
    await updateSettlementReady();  // 6. 정산 예정일 도래 시 READY 상태 변경
    await autoReturnDeposit();      // 7. 정산 READY 후 보증금 자동 반환

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
 * - 임대중: 입실날짜 + 방 입실시간 경과 (+ Settlement 자동 생성)
 * - 48시간 자동 퇴실확정: 게스트 퇴실요청 후 48시간 경과
 * - 계약종료: 퇴실날짜 + 방 퇴실시간 경과
 * - 정산 READY: 정산 예정일(입주일+3영업일) 도래 시 PENDING→READY
 * - 보증금 반환: 정산 READY 후 RETURN_PENDING→RETURNED
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
  autoConfirmCheckout,
  updateCompleted,
  updateSettlementReady,
  autoReturnDeposit
};
