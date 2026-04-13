const { Receipt, ReceiptSetting } = require('../models');

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

module.exports = {
  createContractFeeReceipt
};
