const cron = require('node-cron');
const { Contract, ChatRoom, Room, User, ContractStatusLog, Settlement, DepositAgreement, sequelize } = require('../models');
const { Op } = require('sequelize');
const { sendSystemMessage } = require('../config/firebaseAdmin');
const { SystemMessageTypes, getSystemMessageTemplate } = require('../utils/systemMessageTypes');
const NotificationService = require('../services/notificationService');
const { CANCEL_TYPES } = require('../utils/notificationMessages');
const { calculateSettlementDate, calculateSettlementAmount } = require('../services/settlementService');
const { createReceiptsForReadySettlements } = require('../services/receiptService');

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
 * - 승인일로부터 24시간 경과 또는 입주일 입실시간(Room.checkInTime)이 도래한 경우
 * -> PAYMENT_EXPIRED 상태로 변경
 *
 * 정책 3.14.2: "결제 만료 시간 = 호스트 승인 시점 + 24h
 *   단, 승인 시점이 입주일 또는 다음날 입주일인 경우, 입주일 입실 시간에 자동 마감 처리"
 */
async function updatePaymentExpired() {
  const transaction = await sequelize.transaction();

  try {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24시간 전

    // Room JOIN으로 checkInTime 포함하여 APPROVED 계약 조회
    const approvedContracts = await Contract.findAll({
      where: {
        status: 'APPROVED'
      },
      attributes: ['id', 'approvedAt', 'checkInDate', 'hostId', 'guestId', 'roomId'],
      include: [
        {
          model: Room,
          as: 'room',
          attributes: ['id', 'checkInTime']
        },
        {
          model: ChatRoom,
          as: 'chatRoom',
          attributes: ['firebaseChatRoomId']
        }
      ],
      transaction
    });

    // 각 계약별로 만료 여부 판단 (Room별 checkInTime이 다르므로 JS 필터)
    const expiredContracts = approvedContracts.filter(contract => {
      // 1) 승인일로부터 24시간 경과
      if (contract.approvedAt && contract.approvedAt <= oneDayAgo) return true;

      // 2) 입주일 입실시간 도래
      if (contract.checkInDate && contract.room) {
        const checkInTime = contract.room.checkInTime || 15; // 기본값 15시
        const checkInDate = new Date(contract.checkInDate);
        const checkInDateTime = new Date(
          checkInDate.getFullYear(),
          checkInDate.getMonth(),
          checkInDate.getDate(),
          checkInTime, 0, 0
        );
        if (now >= checkInDateTime) return true;
      }
      return false;
    });

    // 필터된 계약들만 상태 업데이트
    if (expiredContracts.length > 0) {
      const expiredIds = expiredContracts.map(c => c.id);
      await Contract.update(
        {
          status: 'PAYMENT_EXPIRED',
          updatedAt: now
        },
        {
          where: { id: { [Op.in]: expiredIds } },
          transaction
        }
      );
    }

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
          : '입주일 입실시간 도래로 인한 자동 만료',
        metadata: {
          expirationRule: isPaymentTimeExpired ? '24H_TIMEOUT' : 'CHECKIN_TIME_REACHED',
          approvedAt: contract.approvedAt,
          checkInDate: contract.checkInDate,
          roomCheckInTime: contract.room ? contract.room.checkInTime : null,
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

    if (expiredContracts.length > 0) {
      console.log(`[스케줄러] ${expiredContracts.length}건의 계약을 미결제 만료 처리했습니다.`);
    }

    return expiredContracts.length;
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
 * -> COMPLETED 상태로 변경 (상태만 전환, 퇴실/보증금 처리는 별도 진행)
 *
 * 정책: 퇴실 시간은 방별로 8~11시 중 호스트가 설정
 * 예: checkOutDate=2025-11-06, checkOutTime=11 → 2025-11-06 11:00:00 이후 COMPLETED
 *
 * 참고: COMPLETED 전환 후 퇴실 프로세스가 시작됨
 *       게스트 퇴실요청(48h 자동) → 호스트 퇴실확인(48h 자동) → 보증금 반환
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
      attributes: ['id', 'checkInDate', 'checkOutDate', 'totalDays', 'roomId'],
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

    // 각 계약별 상태 업데이트 및 로그 기록 (상태만 COMPLETED로 전환)
    for (const contract of eligibleContracts) {
      const checkOutTime = contract.room ? contract.room.checkOutTime : 11;

      await Contract.update(
        {
          status: 'COMPLETED',
          checkedOutAt: now,
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
        reason: '퇴실 시간 도래로 계약 완료 (퇴실/보증금 처리는 별도 진행)',
        metadata: {
          checkInDate: contract.checkInDate,
          scheduledCheckOutDate: contract.checkOutDate,
          roomCheckOutTime: checkOutTime,
          actualCheckOutAt: now,
          totalDays: contract.totalDays
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
 * 6. 퇴실 요청 48시간 자동확정
 * - COMPLETED 상태인 계약 중
 * - checkoutStatus=GUEST_COMPLETED (게스트 퇴실 요청 완료)
 * - checkoutRequestedAt + 48시간 경과 && 호스트 미확인
 * -> 자동으로 퇴실 확정 (보증금 전액 반환)
 *
 * 정책: 호스트가 48시간 내 퇴실 확인 안 하면 자동 확정
 */
async function autoConfirmCheckout() {
  const transaction = await sequelize.transaction();

  try {
    const now = new Date();
    const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    // COMPLETED + GUEST_COMPLETED + 48시간 경과 계약 조회
    const pendingCheckouts = await Contract.findAll({
      where: {
        status: 'COMPLETED',
        checkoutStatus: 'GUEST_COMPLETED',
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
          hostCheckedOut: true,
          hostCheckedOutAt: now,
          depositDeduction: 0,
          refundableDeposit: contract.deposit || 0,
          depositStatus: 'RETURN_PENDING',
          checkoutStatus: 'HOST_CONFIRMED',
          updatedAt: now
        },
        {
          where: { id: contract.id },
          transaction
        }
      );

      await ContractStatusLog.createLog({
        contractId: contract.id,
        fromStatus: 'COMPLETED',
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

        // 알림톡 발송 (4-15 퇴실 확인 기한 만료)
        try {
          const AlimtalkService = require('../services/alimtalkService');
          const [expGuest, expHost] = await Promise.all([
            User.findByPk(contract.guestId, { attributes: ['id', 'phoneNumber', 'name', 'nickname'] }),
            User.findByPk(contract.hostId, { attributes: ['id', 'phoneNumber', 'name', 'nickname'] })
          ]);
          const expRoom = await Room.findByPk(contract.roomId, { attributes: ['id', 'roomName'] });
          AlimtalkService.sendCheckoutConfirmExpired(contract, expGuest, expHost, expRoom)
            .catch(err => console.error(`[Alimtalk] checkout_confirm_expired 실패 (계약 ID: ${contract.id}):`, err.message));
        } catch (alimtalkErr) {
          console.error(`자동 퇴실 확정 알림톡 발송 실패 (계약 ID: ${contract.id}):`, alimtalkErr);
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
 * 8. 정산 상태 자동 업데이트
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

      // 정산 READY로 변경된 건에 대해 영수증 자동 생성
      try {
        await createReceiptsForReadySettlements();
      } catch (receiptErr) {
        console.error('[스케줄러] 영수증 자동 생성 오류:', receiptErr);
      }
    }

    return updatedCount;
  } catch (error) {
    await transaction.rollback();
    console.error('[스케줄러] 정산 READY 상태 변경 오류:', error);
    return 0;
  }
}

/**
 * 5. COMPLETED+48h 자동 퇴실요청 전환
 * - COMPLETED 상태인 계약 중
 * - 게스트가 퇴실 요청하지 않았고 (checkoutStatus=NOT_STARTED)
 * - checkedOutAt + 48시간이 경과한 경우
 * -> checkoutRequested=true, checkoutStatus='GUEST_COMPLETED'로 자동 전환
 *
 * 정책: COMPLETED 전환 후 48시간 동안 게스트 퇴실 요청이 없으면 자동 퇴실요청 처리
 *       이후 호스트 퇴실 확인 대기 (48시간 미확인 시 autoConfirmCheckout에서 자동 확정)
 */
async function autoRequestCheckout() {
  const transaction = await sequelize.transaction();

  try {
    const now = new Date();
    const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    // COMPLETED + 퇴실 미요청 + checkedOutAt+48h 경과 계약 조회
    const contracts = await Contract.findAll({
      where: {
        status: 'COMPLETED',
        checkoutRequested: false,
        checkoutStatus: 'NOT_STARTED',
        checkedOutAt: { [Op.lte]: fortyEightHoursAgo }
      },
      attributes: ['id', 'checkOutDate', 'checkedOutAt', 'hostId', 'guestId'],
      include: [
        {
          model: ChatRoom,
          as: 'chatRoom',
          attributes: ['firebaseChatRoomId']
        }
      ],
      transaction
    });

    // 각 계약별 자동 퇴실요청 처리
    for (const contract of contracts) {
      await Contract.update(
        {
          checkoutRequested: true,
          checkoutRequestedAt: now,
          checkoutStatus: 'GUEST_COMPLETED',
          updatedAt: now
        },
        {
          where: { id: contract.id },
          transaction
        }
      );

      await ContractStatusLog.createLog({
        contractId: contract.id,
        fromStatus: 'COMPLETED',
        toStatus: 'COMPLETED',
        changedBy: 'SYSTEM',
        changedByUserId: null,
        reason: '계약 완료 후 48시간 동안 게스트 퇴실 요청이 없어 자동 퇴실요청 처리',
        metadata: {
          checkedOutAt: contract.checkedOutAt,
          autoRequestedAt: now,
          checkoutStatus: 'GUEST_COMPLETED'
        },
        transaction
      });
    }

    await transaction.commit();

    // 알림 발송 (트랜잭션 외부에서 비동기 실행)
    if (contracts.length > 0) {
      for (const contract of contracts) {
        // 채팅 시스템 메시지
        if (contract.chatRoom) {
          sendSystemMessage(
            contract.chatRoom.firebaseChatRoomId,
            getSystemMessageTemplate(SystemMessageTypes.CHECKOUT_AUTO_REQUESTED),
            SystemMessageTypes.CHECKOUT_AUTO_REQUESTED,
            { contractId: contract.id }
          ).catch(err => {
            console.error(`자동 퇴실요청 시스템 메시지 발송 실패 (계약 ID: ${contract.id}):`, err);
          });
        }

        // 호스트에게 알림 발송
        try {
          await NotificationService.notifyCheckoutRequest(contract);
        } catch (notifyErr) {
          console.error(`자동 퇴실요청 알림 발송 실패 (계약 ID: ${contract.id}):`, notifyErr);
        }
      }

      console.log(`[스케줄러] ${contracts.length}건의 계약을 COMPLETED+48h 자동 퇴실요청 처리했습니다.`);
    }

    return contracts.length;
  } catch (error) {
    await transaction.rollback();
    console.error('[스케줄러] COMPLETED+48h 자동 퇴실요청 오류:', error);
    return 0;
  }
}

/**
 * 9. 보증금 자동 반환 처리
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

    // RETURN_PENDING 또는 RETURN_CONFIRMED 상태인 계약 중 Settlement가 READY 이상인 건 조회
    // RETURN_HOLD(합의 진행중), DEDUCTION_CONFIRMED(차감확정) 상태는 제외
    const pendingDeposits = await Contract.findAll({
      where: {
        status: 'COMPLETED',
        depositStatus: { [Op.in]: ['RETURN_PENDING', 'RETURN_CONFIRMED'] },
        checkoutStatus: { [Op.notIn]: ['HOST_PENDING', 'HOLD_REQUESTED'] }
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
 * 7. 퇴실 보류 10일 데드라인 초과 시 보증금 전액 자동반환
 * - COMPLETED 상태인 계약 중
 * - checkoutStatus가 HOST_PENDING인 경우
 * - checkoutRequestedAt + 10일이 경과한 경우
 * -> 보증금 전액 게스트 반환
 *
 * 정책: 퇴실 보류 후 10일 내 합의가 완료되지 않으면 보증금 전액 자동반환
 */
async function autoReturnDepositOnDeadline() {
  const transaction = await sequelize.transaction();

  try {
    const now = new Date();
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

    // 정책 7.9.1: 합의 데드라인 = 관리자 보류 승인 시점(holdApprovedAt) + 10일
    // RETURN_HOLD 상태 + holdApprovedAt 기준 10일 경과 계약 조회
    const overdueContracts = await Contract.findAll({
      where: {
        status: 'COMPLETED',
        checkoutStatus: 'HOST_PENDING',
        depositStatus: 'RETURN_HOLD',
        holdApprovedAt: { [Op.lte]: tenDaysAgo }
      },
      attributes: ['id', 'deposit', 'holdApprovedAt', 'checkoutStatus', 'hostId', 'guestId', 'roomId'],
      include: [
        {
          model: ChatRoom,
          as: 'chatRoom',
          attributes: ['firebaseChatRoomId']
        }
      ],
      transaction
    });

    for (const contract of overdueContracts) {
      // 정책 7.9.3 조건 B: 데드라인 종료 → 게스트에게 전액 반환확정
      await Contract.update(
        {
          hostCheckedOut: true,
          hostCheckedOutAt: now,
          checkoutStatus: 'HOST_CONFIRMED',
          depositDeduction: 0,
          refundableDeposit: contract.deposit || 0,
          depositStatus: 'RETURN_CONFIRMED',
          updatedAt: now
        },
        {
          where: { id: contract.id },
          transaction
        }
      );

      // DepositAgreement가 있으면 AUTO_RETURNED로 변경
      await DepositAgreement.update(
        {
          status: 'AUTO_RETURNED',
          updatedAt: now
        },
        {
          where: { contractId: contract.id },
          transaction
        }
      );

      await ContractStatusLog.createLog({
        contractId: contract.id,
        fromStatus: 'COMPLETED',
        toStatus: 'COMPLETED',
        changedBy: 'SYSTEM',
        changedByUserId: null,
        reason: '합의 데드라인(보류 승인 후 10일) 경과로 보증금 전액 게스트 반환확정',
        metadata: {
          holdApprovedAt: contract.holdApprovedAt,
          previousCheckoutStatus: contract.checkoutStatus,
          deadlineExceededAt: now,
          depositFullRefund: contract.deposit || 0
        },
        transaction
      });
    }

    await transaction.commit();

    // 알림 발송 (트랜잭션 외부에서 비동기 실행)
    if (overdueContracts.length > 0) {
      for (const contract of overdueContracts) {
        // 채팅 시스템 메시지
        if (contract.chatRoom) {
          sendSystemMessage(
            contract.chatRoom.firebaseChatRoomId,
            getSystemMessageTemplate(SystemMessageTypes.DEPOSIT_AUTO_RETURNED),
            SystemMessageTypes.DEPOSIT_AUTO_RETURNED,
            { contractId: contract.id }
          ).catch(err => {
            console.error(`합의 데드라인 자동반환확정 시스템 메시지 발송 실패 (계약 ID: ${contract.id}):`, err);
          });
        }

        // 양측 알림 발송
        try {
          await NotificationService.notifyCheckoutConfirmed(contract);
        } catch (notifyErr) {
          console.error(`합의 데드라인 자동반환확정 알림 발송 실패 (계약 ID: ${contract.id}):`, notifyErr);
        }

        // 알림톡 발송 (4-12 보증금 합의 기한 만료)
        try {
          const AlimtalkService = require('../services/alimtalkService');
          const [expiredGuest, expiredHost] = await Promise.all([
            User.findByPk(contract.guestId, { attributes: ['id', 'phoneNumber', 'name', 'nickname'] }),
            User.findByPk(contract.hostId, { attributes: ['id', 'phoneNumber', 'name', 'nickname'] })
          ]);
          AlimtalkService.sendDepositAgreementExpired(contract, expiredGuest, expiredHost)
            .catch(err => console.error(`[Alimtalk] deposit_agreement_expired 실패 (계약 ID: ${contract.id}):`, err.message));
        } catch (alimtalkErr) {
          console.error(`합의 데드라인 알림톡 발송 실패 (계약 ID: ${contract.id}):`, alimtalkErr);
        }
      }

      console.log(`[스케줄러] ${overdueContracts.length}건의 계약을 합의 데드라인 초과로 보증금 전액 반환확정 처리했습니다.`);
    }

    return overdueContracts.length;
  } catch (error) {
    await transaction.rollback();
    console.error('[스케줄러] 합의 데드라인 보증금 자동반환확정 오류:', error);
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
    await updateApprovalExpired();        // 1. 미승인 만료
    await updatePaymentExpired();         // 2. 미결제 만료
    await updateInProgress();             // 3. 임대중 (+ Settlement 자동 생성)
    await updateCompleted();              // 4. 퇴실시간 경과 → COMPLETED (상태만 전환)
    await autoRequestCheckout();          // 5. COMPLETED+48h 자동 퇴실요청
    await autoConfirmCheckout();          // 6. 퇴실요청 후 48시간 자동 퇴실확정
    await autoReturnDepositOnDeadline();  // 7. 퇴실 보류 10일 데드라인 자동반환
    await updateSettlementReady();        // 8. 정산 예정일 도래 시 READY 상태 변경
    await autoReturnDeposit();            // 9. 정산 READY 후 보증금 자동 반환

    console.log('[스케줄러] 계약 상태 자동 업데이트 완료:', new Date().toISOString());
  } catch (error) {
    console.error('[스케줄러] 계약 상태 업데이트 실행 오류:', error);
  }
}

/**
 * 스케줄러 시작
 *
 * 모든 상태 업데이트를 매 10분마다 실행 (9단계)
 * 1. 미승인 만료: 72시간 경과 OR 입실날짜 다음날
 * 2. 미결제 만료: 24시간 경과 OR 입실날짜 다음날
 * 3. 임대중: 입실날짜 + 방 입실시간 경과 (+ Settlement 자동 생성)
 * 4. 계약완료: 퇴실날짜 + 방 퇴실시간 경과 → COMPLETED (상태만 전환)
 * 5. 자동 퇴실요청: COMPLETED + checkedOutAt+48h 경과 시 자동 퇴실요청
 * 6. 자동 퇴실확정: 퇴실요청 후 호스트 48시간 미확인 시 자동 확정 + 보증금 전액 반환
 * 7. 10일 데드라인: 퇴실 보류 후 10일 경과 시 보증금 전액 자동반환
 * 8. 정산 READY: 정산 예정일(입주일+3영업일) 도래 시 PENDING→READY
 * 9. 보증금 반환: 정산 READY 후 RETURN_PENDING→RETURNED (HOST_PENDING 제외)
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
  autoRequestCheckout,
  autoConfirmCheckout,
  updateCompleted,
  autoReturnDepositOnDeadline,
  updateSettlementReady,
  autoReturnDeposit
};
