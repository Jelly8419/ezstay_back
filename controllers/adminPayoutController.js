/**
 * Admin Payout Controller
 * 관리자 지급 관리 API
 *
 * 지급 흐름: PENDING → PAYABLE (스케줄러) → PROCESSING → COMPLETED
 *                                          ↘ FAILED
 *                                          ↘ CANCELLED
 */

const { sequelize, Payout, Contract, Settlement, Refund, User, Admin, UserBankAccount, GuestRefundAccount } = require('../models');
const { Op } = require('sequelize');
const { success, error, updated, ErrorCodes } = require('../utils/responseHelper');
const { maskAccountNumber } = require('../services/settlementService');

/**
 * 지급 목록 조회
 * GET /api/admin/payouts
 *
 * Query: page, limit, status, payoutType, recipientType, startDate, endDate, search
 */
exports.getPayouts = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      payoutType,
      recipientType,
      startDate,
      endDate,
      search
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (status) where.status = status;
    if (payoutType) where.payoutType = payoutType;
    if (recipientType) where.recipientType = recipientType;

    if (startDate || endDate) {
      where.payableAfter = {};
      if (startDate) where.payableAfter[Op.gte] = startDate;
      if (endDate) where.payableAfter[Op.lte] = endDate;
    }

    // 수령인 이름 검색은 JOIN 필요 → 별도 처리
    const include = [
      {
        model: Contract,
        as: 'contract',
        attributes: ['id', 'checkInDate', 'checkOutDate']
      },
      {
        model: User,
        as: 'recipient',
        attributes: ['id', 'name', 'nickname', 'phoneNumber'],
        ...(search ? {
          where: {
            [Op.or]: [
              { name: { [Op.like]: `%${search}%` } },
              { nickname: { [Op.like]: `%${search}%` } }
            ]
          }
        } : {})
      }
    ];

    const { count, rows } = await Payout.findAndCountAll({
      where,
      include,
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset
    });

    return success(res, {
      total: count,
      page: parseInt(page),
      limit: parseInt(limit),
      payouts: rows.map(p => formatPayoutSummary(p))
    });
  } catch (err) {
    console.error('지급 목록 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 지급 상세 조회
 * GET /api/admin/payouts/:payoutId
 */
exports.getPayoutDetail = async (req, res) => {
  try {
    const { payoutId } = req.params;

    const payout = await Payout.findByPk(payoutId, {
      include: [
        { model: Contract, as: 'contract', attributes: ['id', 'checkInDate', 'checkOutDate', 'rentalFee', 'maintenanceFee', 'cleaningFee', 'finalTotalAmount'] },
        { model: Settlement, as: 'settlement', attributes: ['id', 'status', 'netAmount', 'expectedDate', 'payoutAvailableDate'] },
        { model: Refund, as: 'refund', attributes: ['id', 'penaltyAmount', 'cancellationFaultType', 'cancellationDate'] },
        { model: User, as: 'recipient', attributes: ['id', 'name', 'nickname', 'phoneNumber'] },
        { model: Admin, as: 'processedByAdmin', attributes: ['id', 'name', 'username'] }
      ]
    });

    if (!payout) {
      return error(res, { code: 4801, message: '지급 내역을 찾을 수 없습니다.' }, 404);
    }

    return success(res, formatPayoutDetail(payout));
  } catch (err) {
    console.error('지급 상세 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 지급 실행 (PAYABLE → PROCESSING → COMPLETED)
 * POST /api/admin/payouts/:payoutId/execute
 *
 * Body: { note } (선택)
 *
 * 관리자가 직접 이체 후 완료 처리
 */
exports.executePayout = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { payoutId } = req.params;
    const { note } = req.body;
    const adminId = req.admin.id;

    const payout = await Payout.findByPk(payoutId, { transaction });

    if (!payout) {
      await transaction.rollback();
      return error(res, { code: 4801, message: '지급 내역을 찾을 수 없습니다.' }, 404);
    }

    if (payout.status !== 'PAYABLE') {
      await transaction.rollback();
      return error(res, {
        code: 4802,
        message: `지급 가능 상태(PAYABLE)에서만 실행할 수 있습니다. 현재 상태: ${Payout.STATUS_LABELS[payout.status]}`
      }, 400);
    }

    // PROCESSING → COMPLETED 즉시 전환 (수동 이체 후 완료 처리)
    await payout.update({
      status: 'COMPLETED',
      adminId,
      processedAt: new Date(),
      note: note || payout.note
    }, { transaction });

    // CONTRACT_SETTLEMENT 타입이면 Settlement도 COMPLETED로 업데이트
    if (payout.payoutType === 'CONTRACT_SETTLEMENT' && payout.settlementId) {
      await Settlement.update(
        { status: 'COMPLETED', completedAt: new Date(), adminId },
        { where: { id: payout.settlementId }, transaction }
      );
    }

    await transaction.commit();

    return updated(res, { payoutId: payout.id, status: 'COMPLETED', processedAt: payout.processedAt }, '지급이 완료되었습니다.');
  } catch (err) {
    await transaction.rollback();
    console.error('지급 실행 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 지급 실패 처리
 * POST /api/admin/payouts/:payoutId/fail
 *
 * Body: { failureReason }
 */
exports.failPayout = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { payoutId } = req.params;
    const { failureReason } = req.body;
    const adminId = req.admin.id;

    if (!failureReason) {
      await transaction.rollback();
      return error(res, { code: 4803, message: '실패 사유를 입력해주세요.' }, 400);
    }

    const payout = await Payout.findByPk(payoutId, { transaction });

    if (!payout) {
      await transaction.rollback();
      return error(res, { code: 4801, message: '지급 내역을 찾을 수 없습니다.' }, 404);
    }

    if (!['PAYABLE', 'PROCESSING'].includes(payout.status)) {
      await transaction.rollback();
      return error(res, {
        code: 4804,
        message: 'PAYABLE 또는 PROCESSING 상태에서만 실패 처리 가능합니다.'
      }, 400);
    }

    await payout.update({
      status: 'FAILED',
      adminId,
      failureReason,
      processedAt: new Date()
    }, { transaction });

    await transaction.commit();

    return updated(res, { payoutId: payout.id, status: 'FAILED' }, '지급 실패로 처리되었습니다. 재시도가 필요합니다.');
  } catch (err) {
    await transaction.rollback();
    console.error('지급 실패 처리 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 지급 취소
 * POST /api/admin/payouts/:payoutId/cancel
 *
 * Body: { note }
 */
exports.cancelPayout = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { payoutId } = req.params;
    const { note } = req.body;
    const adminId = req.admin.id;

    const payout = await Payout.findByPk(payoutId, { transaction });

    if (!payout) {
      await transaction.rollback();
      return error(res, { code: 4801, message: '지급 내역을 찾을 수 없습니다.' }, 404);
    }

    if (!['PENDING', 'PAYABLE', 'FAILED'].includes(payout.status)) {
      await transaction.rollback();
      return error(res, {
        code: 4805,
        message: 'PENDING/PAYABLE/FAILED 상태에서만 취소 가능합니다.'
      }, 400);
    }

    await payout.update({
      status: 'CANCELLED',
      adminId,
      note: note || null,
      processedAt: new Date()
    }, { transaction });

    await transaction.commit();

    return updated(res, { payoutId: payout.id, status: 'CANCELLED' }, '지급이 취소되었습니다.');
  } catch (err) {
    await transaction.rollback();
    console.error('지급 취소 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 지급 재시도 (FAILED → PAYABLE)
 * POST /api/admin/payouts/:payoutId/retry
 */
exports.retryPayout = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { payoutId } = req.params;
    const adminId = req.admin.id;

    const payout = await Payout.findByPk(payoutId, { transaction });

    if (!payout) {
      await transaction.rollback();
      return error(res, { code: 4801, message: '지급 내역을 찾을 수 없습니다.' }, 404);
    }

    if (payout.status !== 'FAILED') {
      await transaction.rollback();
      return error(res, { code: 4806, message: 'FAILED 상태에서만 재시도 가능합니다.' }, 400);
    }

    // 최신 계좌 정보 재스냅샷
    let accountSnapshot = {};
    if (payout.recipientType === 'HOST') {
      const hostAccount = await UserBankAccount.findOne({
        where: { userId: payout.recipientId, isDefault: true }
      });
      if (hostAccount) {
        accountSnapshot = {
          bankName: hostAccount.bankName,
          accountNumber: hostAccount.accountNumber,
          accountHolder: hostAccount.accountHolder
        };
      }
    } else {
      const guestAccount = await GuestRefundAccount.findOne({
        where: { userId: payout.recipientId }
      });
      if (guestAccount) {
        accountSnapshot = {
          bankName: guestAccount.bankName,
          accountNumber: guestAccount.accountNumber,
          accountHolder: guestAccount.accountHolder
        };
      }
    }

    await payout.update({
      status: 'PAYABLE',
      failureReason: null,
      adminId,
      ...accountSnapshot
    }, { transaction });

    await transaction.commit();

    return updated(res, { payoutId: payout.id, status: 'PAYABLE' }, '지급 재시도 대기 상태로 변경되었습니다.');
  } catch (err) {
    await transaction.rollback();
    console.error('지급 재시도 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 지급 메모 업데이트
 * PATCH /api/admin/payouts/:payoutId/note
 *
 * Body: { note }
 */
exports.updatePayoutNote = async (req, res) => {
  try {
    const { payoutId } = req.params;
    const { note } = req.body;

    const payout = await Payout.findByPk(payoutId);
    if (!payout) {
      return error(res, { code: 4801, message: '지급 내역을 찾을 수 없습니다.' }, 404);
    }

    await payout.update({ note });

    return updated(res, { payoutId: payout.id, note: payout.note }, '메모가 업데이트되었습니다.');
  } catch (err) {
    console.error('지급 메모 업데이트 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

// ─────────────────────────────────────────────
// 내부 포맷 헬퍼
// ─────────────────────────────────────────────

function formatPayoutSummary(p) {
  return {
    id: p.id,
    contractId: p.contractId,
    payoutType: p.payoutType,
    payoutTypeLabel: Payout.TYPE_LABELS[p.payoutType],
    recipientType: p.recipientType,
    recipientId: p.recipientId,
    recipientName: p.recipient?.name || p.recipient?.nickname || null,
    amount: p.amount,
    status: p.status,
    statusLabel: Payout.STATUS_LABELS[p.status],
    payableAfter: p.payableAfter,
    processedAt: p.processedAt,
    createdAt: p.createdAt
  };
}

function formatPayoutDetail(p) {
  return {
    id: p.id,
    contractId: p.contractId,
    settlementId: p.settlementId,
    refundId: p.refundId,
    payoutType: p.payoutType,
    payoutTypeLabel: Payout.TYPE_LABELS[p.payoutType],
    recipientType: p.recipientType,
    recipient: p.recipient ? {
      id: p.recipient.id,
      name: p.recipient.name,
      nickname: p.recipient.nickname,
      phoneNumber: p.recipient.phoneNumber
    } : null,
    amount: p.amount,
    status: p.status,
    statusLabel: Payout.STATUS_LABELS[p.status],
    payableAfter: p.payableAfter,
    // 계좌 정보 (마스킹)
    bankName: p.bankName,
    accountNumber: p.accountNumber ? maskAccountNumber(p.accountNumber) : null,
    accountHolder: p.accountHolder,
    // 처리 정보
    adminId: p.adminId,
    processedByAdmin: p.processedByAdmin ? { id: p.processedByAdmin.id, name: p.processedByAdmin.name } : null,
    processedAt: p.processedAt,
    failureReason: p.failureReason,
    note: p.note,
    // 연관 정보
    contract: p.contract,
    settlement: p.settlement,
    refund: p.refund,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt
  };
}
