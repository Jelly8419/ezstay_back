/**
 * Admin Settlement Controller
 * 관리자 정산 관리 API
 *
 * settlements 테이블 기반 정산 조회 및 관리
 * 지급 실행은 /api/admin/payouts 에서 처리
 *
 * 정산 상태 흐름: PENDING → READY → PROCESSING → COMPLETED
 */

const { sequelize, Settlement, Payout, Contract, Room, User, Refund, Payment, UserBankAccount } = require('../models');
const { Op } = require('sequelize');
const { success, error, updated, ErrorCodes } = require('../utils/responseHelper');
const { maskAccountNumber } = require('../services/settlementService');

const STATUS_LABELS = {
  PENDING: '정산 대기',
  READY: '지급 준비',
  PROCESSING: '지급 처리중',
  COMPLETED: '지급 완료',
  ON_HOLD: '보류'
};

/**
 * 정산 목록 조회
 * GET /api/admin/settlements
 *
 * Query: page, limit, status, hostId, startDate, endDate, search
 */
exports.getAdminSettlements = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      hostId,
      startDate,
      endDate,
      search
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (status) where.status = status;
    if (hostId) where.hostId = parseInt(hostId);

    if (startDate || endDate) {
      where.expectedDate = {};
      if (startDate) where.expectedDate[Op.gte] = startDate;
      if (endDate) where.expectedDate[Op.lte] = endDate;
    }

    const hostWhere = search ? {
      [Op.or]: [
        { name: { [Op.like]: `%${search}%` } },
        { nickname: { [Op.like]: `%${search}%` } }
      ]
    } : undefined;

    const { count, rows } = await Settlement.findAndCountAll({
      where,
      include: [
        {
          model: Contract,
          as: 'contract',
          attributes: ['id', 'checkInDate', 'checkOutDate', 'finalTotalAmount']
        },
        {
          model: User,
          as: 'host',
          attributes: ['id', 'name', 'nickname', 'email'],
          ...(hostWhere ? { where: hostWhere } : {})
        },
        {
          model: Payout,
          as: 'payouts',
          attributes: ['id', 'status', 'amount', 'payableAfter', 'processedAt'],
          required: false
        }
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset
    });

    // 요약 통계
    const [pendingCount, readyCount, completedCount, onHoldCount] = await Promise.all([
      Settlement.count({ where: { status: 'PENDING' } }),
      Settlement.count({ where: { status: 'READY' } }),
      Settlement.count({ where: { status: 'COMPLETED' } }),
      Settlement.count({ where: { status: 'ON_HOLD' } })
    ]);

    return success(res, {
      settlements: rows.map(s => formatSettlementSummary(s)),
      summary: { pendingCount, readyCount, completedCount, onHoldCount },
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / parseInt(limit))
      }
    });
  } catch (err) {
    console.error('정산 목록 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 정산 상세 조회
 * GET /api/admin/settlements/:settlementId
 */
exports.getAdminSettlementDetail = async (req, res) => {
  try {
    const { settlementId } = req.params;

    const settlement = await Settlement.findByPk(settlementId, {
      include: [
        {
          model: Contract,
          as: 'contract',
          attributes: ['id', 'checkInDate', 'checkOutDate', 'rentalFee', 'maintenanceFee', 'cleaningFee', 'finalTotalAmount', 'hostPlatformFee'],
          include: [
            {
              model: Room,
              as: 'room',
              attributes: ['id', 'roomName', 'address']
            },
            {
              model: User,
              as: 'guest',
              attributes: ['id', 'name', 'phoneNumber']
            },
            {
              model: Payment,
              as: 'payment',
              attributes: ['id', 'method', 'totalAmount', 'approvedAt'],
              where: { paymentType: 'CONTRACT' },
              required: false
            },
            {
              model: Refund,
              as: 'refunds',
              attributes: ['id', 'refundStatus', 'rentalFeeRefundAmount', 'maintenanceFeeRefundAmount', 'cleaningFeeRefundAmount', 'finalRefundAmount'],
              required: false
            }
          ]
        },
        {
          model: User,
          as: 'host',
          attributes: ['id', 'name', 'nickname', 'email', 'phoneNumber']
        },
        {
          model: Payout,
          as: 'payouts',
          attributes: ['id', 'status', 'amount', 'bankName', 'accountNumber', 'accountHolder', 'payableAfter', 'processedAt', 'failureReason', 'note'],
          required: false
        }
      ]
    });

    if (!settlement) {
      return error(res, { code: 4701, message: '정산 내역을 찾을 수 없습니다.' }, 404);
    }

    // 호스트 계좌 정보 (현재 등록 계좌)
    const bankAccount = await UserBankAccount.findOne({
      where: { userId: settlement.hostId, isDefault: true },
      attributes: ['bankName', 'accountNumber', 'accountHolder']
    });

    return success(res, formatSettlementDetail(settlement, bankAccount));
  } catch (err) {
    console.error('정산 상세 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 정산 보류 처리
 * PATCH /api/admin/settlements/:settlementId/hold
 *
 * Body: { reason }
 *
 * PENDING, READY 상태에서만 가능
 * 연결된 Payout도 CANCELLED 처리
 */
exports.holdSettlement = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { settlementId } = req.params;
    const { reason } = req.body;
    const adminId = req.admin.id;

    if (!reason) {
      await transaction.rollback();
      return error(res, { code: 4702, message: '보류 사유를 입력해주세요.' }, 400);
    }

    const settlement = await Settlement.findByPk(settlementId, { transaction });

    if (!settlement) {
      await transaction.rollback();
      return error(res, { code: 4701, message: '정산 내역을 찾을 수 없습니다.' }, 404);
    }

    if (!['PENDING', 'READY'].includes(settlement.status)) {
      await transaction.rollback();
      return error(res, {
        code: 4703,
        message: 'PENDING 또는 READY 상태에서만 보류 처리 가능합니다.'
      }, 400);
    }

    await settlement.update({
      status: 'ON_HOLD',
      note: `[보류] ${reason} (관리자 ID:${adminId})`
    }, { transaction });

    // 연결된 Payout이 PENDING/PAYABLE이면 CANCELLED 처리
    await Payout.update(
      { status: 'CANCELLED', adminId, note: `정산 보류로 인한 취소: ${reason}`, processedAt: new Date() },
      { where: { settlementId: settlement.id, status: { [Op.in]: ['PENDING', 'PAYABLE'] } }, transaction }
    );

    await transaction.commit();

    return updated(res, { settlementId: settlement.id, status: 'ON_HOLD' }, '정산이 보류 처리되었습니다.');
  } catch (err) {
    await transaction.rollback();
    console.error('정산 보류 처리 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 정산 보류 해제
 * PATCH /api/admin/settlements/:settlementId/unhold
 *
 * ON_HOLD → PENDING으로 복원
 * Payout이 CANCELLED 상태이면 새로 PENDING으로 재생성
 */
exports.unholdSettlement = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { settlementId } = req.params;
    const { note } = req.body;

    const settlement = await Settlement.findByPk(settlementId, { transaction });

    if (!settlement) {
      await transaction.rollback();
      return error(res, { code: 4701, message: '정산 내역을 찾을 수 없습니다.' }, 404);
    }

    if (settlement.status !== 'ON_HOLD') {
      await transaction.rollback();
      return error(res, { code: 4704, message: 'ON_HOLD 상태에서만 보류 해제 가능합니다.' }, 400);
    }

    await settlement.update({
      status: 'PENDING',
      note: note || null
    }, { transaction });

    await transaction.commit();

    return updated(res, { settlementId: settlement.id, status: 'PENDING' }, '정산 보류가 해제되었습니다.');
  } catch (err) {
    await transaction.rollback();
    console.error('정산 보류 해제 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 정산 금액 수동 조정
 * PATCH /api/admin/settlements/:settlementId/adjust
 *
 * Body: { netAmount, reason }
 * PENDING, READY, ON_HOLD 상태에서만 가능
 */
exports.adjustSettlement = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { settlementId } = req.params;
    const { netAmount, reason } = req.body;
    const adminId = req.admin.id;

    if (netAmount === undefined || netAmount === null) {
      await transaction.rollback();
      return error(res, { code: 4705, message: '조정 금액을 입력해주세요.' }, 400);
    }
    if (!reason) {
      await transaction.rollback();
      return error(res, { code: 4706, message: '조정 사유를 입력해주세요.' }, 400);
    }

    const settlement = await Settlement.findByPk(settlementId, { transaction });

    if (!settlement) {
      await transaction.rollback();
      return error(res, { code: 4701, message: '정산 내역을 찾을 수 없습니다.' }, 404);
    }

    if (!['PENDING', 'READY', 'ON_HOLD'].includes(settlement.status)) {
      await transaction.rollback();
      return error(res, {
        code: 4707,
        message: 'PENDING/READY/ON_HOLD 상태에서만 금액 조정 가능합니다.'
      }, 400);
    }

    const prevAmount = settlement.netAmount;
    await settlement.update({
      netAmount: parseInt(netAmount),
      note: `[금액조정] ${prevAmount}→${netAmount}원, 사유: ${reason} (관리자 ID:${adminId})`
    }, { transaction });

    // 연결된 Payout 금액도 동기화 (PENDING/PAYABLE인 경우만)
    await Payout.update(
      { amount: parseInt(netAmount) },
      { where: { settlementId: settlement.id, status: { [Op.in]: ['PENDING', 'PAYABLE'] } }, transaction }
    );

    await transaction.commit();

    return updated(res, {
      settlementId: settlement.id,
      prevAmount,
      netAmount: parseInt(netAmount)
    }, '정산 금액이 조정되었습니다.');
  } catch (err) {
    await transaction.rollback();
    console.error('정산 금액 조정 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 정산 메모 업데이트
 * PATCH /api/admin/settlements/:settlementId/note
 *
 * Body: { note }
 */
exports.updateSettlementNote = async (req, res) => {
  try {
    const { settlementId } = req.params;
    const { note } = req.body;

    const settlement = await Settlement.findByPk(settlementId);
    if (!settlement) {
      return error(res, { code: 4701, message: '정산 내역을 찾을 수 없습니다.' }, 404);
    }

    await settlement.update({ note });

    return updated(res, { settlementId: settlement.id, note: settlement.note }, '메모가 업데이트되었습니다.');
  } catch (err) {
    console.error('정산 메모 업데이트 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

// ─────────────────────────────────────────────
// 내부 포맷 헬퍼
// ─────────────────────────────────────────────

function formatSettlementSummary(s) {
  return {
    id: s.id,
    contractId: s.contractId,
    hostId: s.hostId,
    hostName: s.host?.name || s.host?.nickname || null,
    hostEmail: s.host?.email || null,
    status: s.status,
    statusLabel: STATUS_LABELS[s.status] || s.status,
    netAmount: s.netAmount,
    expectedDate: s.expectedDate,
    payoutAvailableDate: s.payoutAvailableDate,
    checkInDate: s.contract?.checkInDate || null,
    checkOutDate: s.contract?.checkOutDate || null,
    payout: s.payouts?.[0] ? {
      id: s.payouts[0].id,
      status: s.payouts[0].status,
      amount: s.payouts[0].amount,
      payableAfter: s.payouts[0].payableAfter,
      processedAt: s.payouts[0].processedAt
    } : null,
    createdAt: s.createdAt
  };
}

function formatSettlementDetail(s, bankAccount) {
  return {
    id: s.id,
    contractId: s.contractId,
    status: s.status,
    statusLabel: STATUS_LABELS[s.status] || s.status,
    // 정산 금액 내역
    rentalFee: s.rentalFee,
    maintenanceFee: s.maintenanceFee,
    cleaningFee: s.cleaningFee,
    hostPlatformFee: s.hostPlatformFee,
    refundDeduction: s.refundDeduction,
    grossAmount: s.grossAmount,
    netAmount: s.netAmount,
    // 일정
    expectedDate: s.expectedDate,
    payoutAvailableDate: s.payoutAvailableDate,
    completedAt: s.completedAt,
    note: s.note,
    // 호스트
    host: s.host ? {
      id: s.host.id,
      name: s.host.name,
      nickname: s.host.nickname,
      email: s.host.email,
      phoneNumber: s.host.phoneNumber
    } : null,
    // 현재 등록 계좌 (마스킹)
    currentBankInfo: bankAccount ? {
      bankName: bankAccount.bankName,
      accountNumber: maskAccountNumber(bankAccount.accountNumber),
      accountHolder: bankAccount.accountHolder
    } : null,
    // 연관 계약
    contract: s.contract ? {
      id: s.contract.id,
      checkInDate: s.contract.checkInDate,
      checkOutDate: s.contract.checkOutDate,
      rentalFee: s.contract.rentalFee,
      maintenanceFee: s.contract.maintenanceFee,
      cleaningFee: s.contract.cleaningFee,
      finalTotalAmount: s.contract.finalTotalAmount,
      room: s.contract.room || null,
      guest: s.contract.guest || null,
      payment: s.contract.payment || null,
      refunds: s.contract.refunds || []
    } : null,
    // 연결된 Payout (지급 건, CONTRACT_SETTLEMENT 타입)
    payout: s.payouts?.[0] ? {
      id: s.payouts[0].id,
      status: s.payouts[0].status,
      amount: s.payouts[0].amount,
      bankName: s.payouts[0].bankName,
      accountNumber: s.payouts[0].accountNumber ? maskAccountNumber(s.payouts[0].accountNumber) : null,
      accountHolder: s.payouts[0].accountHolder,
      payableAfter: s.payouts[0].payableAfter,
      processedAt: s.payouts[0].processedAt,
      failureReason: s.payouts[0].failureReason,
      note: s.payouts[0].note
    } : null,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt
  };
}
