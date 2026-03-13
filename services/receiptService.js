const { Receipt, ReceiptSetting, Settlement, Contract } = require('../models');

/**
 * 정산 READY 시 계약 수수료 영수증 자동 생성 (CONTRACT_FEE)
 * - 호스트의 영수증 설정이 등록되어 있고
 * - hostPlatformFee > 0인 경우에만 생성
 * - 이미 해당 계약+targetType으로 영수증이 존재하면 스킵
 *
 * @param {Object} settlement - Settlement 인스턴스 (status가 READY로 변경된 건)
 * @param {Object} [transaction] - Sequelize 트랜잭션 (선택)
 * @returns {Object|null} 생성된 Receipt 또는 null
 */
async function createContractFeeReceipt(settlement, transaction) {
  try {
    // 플랫폼 수수료 0원이면 생성 불필요
    if (!settlement.hostPlatformFee || settlement.hostPlatformFee <= 0) {
      return null;
    }

    // 이미 해당 계약에 대한 CONTRACT_FEE 영수증이 있으면 스킵
    const existing = await Receipt.findOne({
      where: {
        contractId: settlement.contractId,
        targetType: 'CONTRACT_FEE'
      },
      ...(transaction && { transaction })
    });

    if (existing) {
      return null;
    }

    // 호스트의 영수증 설정 조회
    const receiptSetting = await ReceiptSetting.findOne({
      where: { userId: settlement.hostId },
      ...(transaction && { transaction })
    });

    // 영수증 설정이 없으면 생성하지 않음
    if (!receiptSetting) {
      return null;
    }

    const receipt = await Receipt.create({
      userId: settlement.hostId,
      userType: 'HOST',
      contractId: settlement.contractId,
      settlementId: settlement.id,
      receiptType: receiptSetting.receiptType,
      targetType: 'CONTRACT_FEE',
      amount: settlement.hostPlatformFee,
      date: settlement.expectedDate,
      status: 'PENDING',
      // 발급 정보 스냅샷
      receiptNumber: receiptSetting.receiptNumber,
      businessName: receiptSetting.businessName,
      repName: receiptSetting.repName,
      email: receiptSetting.email
    }, { ...(transaction && { transaction }) });

    return receipt;
  } catch (err) {
    console.error(`[receiptService] CONTRACT_FEE 영수증 생성 실패 (정산 ID: ${settlement.id}):`, err);
    return null;
  }
}

/**
 * 계약 취소 시 취소 수수료 영수증 자동 생성
 * - HOST_CANCEL_FEE: 호스트 취소 위약금 중 플랫폼 귀속 금액
 * - GUEST_CANCEL_FEE: 게스트 취소 위약금 중 플랫폼 귀속 금액 (호스트 대상으로 발급)
 *
 * @param {Object} params
 * @param {number} params.contractId - 계약 ID
 * @param {number} params.hostId - 호스트 사용자 ID
 * @param {string} params.targetType - 'HOST_CANCEL_FEE' 또는 'GUEST_CANCEL_FEE'
 * @param {number} params.platformFeeAmount - 플랫폼 귀속 금액
 * @param {string} params.date - 결제일 (YYYY-MM-DD)
 * @param {Object} [transaction] - Sequelize 트랜잭션 (선택)
 * @returns {Object|null} 생성된 Receipt 또는 null
 */
async function createCancelFeeReceipt({ contractId, hostId, targetType, platformFeeAmount, date }, transaction) {
  try {
    // 플랫폼 귀속 금액이 0원이면 생성 불필요
    if (!platformFeeAmount || platformFeeAmount <= 0) {
      return null;
    }

    // 이미 해당 계약+targetType으로 영수증이 있으면 스킵
    const existing = await Receipt.findOne({
      where: { contractId, targetType },
      ...(transaction && { transaction })
    });

    if (existing) {
      return null;
    }

    // 호스트의 영수증 설정 조회 (취소 수수료는 호스트 대상으로 발급)
    const receiptSetting = await ReceiptSetting.findOne({
      where: { userId: hostId },
      ...(transaction && { transaction })
    });

    if (!receiptSetting) {
      return null;
    }

    const receipt = await Receipt.create({
      userId: hostId,
      userType: 'HOST',
      contractId,
      settlementId: null,
      receiptType: receiptSetting.receiptType,
      targetType,
      amount: platformFeeAmount,
      date,
      status: 'PENDING',
      receiptNumber: receiptSetting.receiptNumber,
      businessName: receiptSetting.businessName,
      repName: receiptSetting.repName,
      email: receiptSetting.email
    }, { ...(transaction && { transaction }) });

    return receipt;
  } catch (err) {
    console.error(`[receiptService] ${targetType} 영수증 생성 실패 (계약 ID: ${contractId}):`, err);
    return null;
  }
}

/**
 * 정산 READY 상태로 변경된 Settlement 목록에 대해 일괄 영수증 생성
 * contractScheduler의 updateSettlementReady() 이후 호출
 *
 * @param {Object} [transaction] - Sequelize 트랜잭션 (선택)
 * @returns {number} 생성된 영수증 건수
 */
async function createReceiptsForReadySettlements(transaction) {
  try {
    const { Op } = require('sequelize');

    // READY 상태인 Settlement 중 아직 CONTRACT_FEE 영수증이 없는 건 조회
    const readySettlements = await Settlement.findAll({
      where: {
        status: 'READY',
        hostPlatformFee: { [Op.gt]: 0 }
      },
      ...(transaction && { transaction })
    });

    let createdCount = 0;
    for (const settlement of readySettlements) {
      const receipt = await createContractFeeReceipt(settlement, transaction);
      if (receipt) createdCount++;
    }

    if (createdCount > 0) {
      console.log(`[receiptService] ${createdCount}건의 CONTRACT_FEE 영수증을 생성했습니다.`);
    }

    return createdCount;
  } catch (err) {
    console.error('[receiptService] 일괄 영수증 생성 실패:', err);
    return 0;
  }
}

module.exports = {
  createContractFeeReceipt,
  createCancelFeeReceipt,
  createReceiptsForReadySettlements
};
