/**
 * Admin Payout Controller
 * 관리자 지급 관리 API
 *
 * 지급 흐름: PENDING → PAYABLE (스케줄러) → PROCESSING → COMPLETED
 *                                          ↘ FAILED
 *                                          ↘ CANCELLED
 */

const { sequelize, Payout, PayoutLog, Contract, Settlement, Refund, User, Admin, UserBankAccount, GuestRefundAccount, RentalOrder } = require('../models');
const { Op } = require('sequelize');
const { success, error, updated, ErrorCodes } = require('../utils/responseHelper');
const { maskAccountNumber } = require('../services/settlementService');
const { toDateStrKST, todayKST, toKSTString } = require('../utils/dateHelper');
const { createContractFeeReceipt } = require('../services/receiptService');

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
        {
          model: Contract, as: 'contract', attributes: ['id', 'checkInDate', 'checkOutDate', 'rentalFee', 'maintenanceFee', 'cleaningFee', 'finalTotalAmount'],
          include: [{ model: RentalOrder, as: 'rentalOrders', attributes: ['totalAmount'], required: false }]
        },
        { model: Settlement, as: 'settlement', attributes: ['id', 'status', 'netAmount', 'expectedDate', 'payoutAvailableDate'] },
        { model: Refund, as: 'refund', attributes: ['id', 'penaltyAmount', 'cancellationFaultType', 'cancellationDate'] },
        { model: User, as: 'recipient', attributes: ['id', 'name', 'nickname', 'phoneNumber'] },
        { model: Admin, as: 'processedByAdmin', attributes: ['id', 'name', 'username'] },
        {
          model: PayoutLog,
          as: 'logs',
          attributes: ['id', 'fromStatus', 'toStatus', 'adminId', 'note', 'changedBy', 'createdAt'],
          include: [{ model: Admin, as: 'admin', attributes: ['id', 'name'] }],
          required: false,
          order: [['createdAt', 'ASC']]
        }
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

    const prevStatus = payout.status;

    // PROCESSING → COMPLETED 즉시 전환 (수동 이체 후 완료 처리)
    await payout.update({
      status: 'COMPLETED',
      adminId,
      processedAt: new Date(),
      note: note || payout.note
    }, { transaction });

    await PayoutLog.create({
      payoutId: payout.id,
      fromStatus: prevStatus,
      toStatus: 'COMPLETED',
      adminId,
      note: note || null,
      changedBy: 'ADMIN'
    }, { transaction });

    // CONTRACT_SETTLEMENT 타입이면 Settlement도 COMPLETED로 업데이트 + 영수증 생성
    if (payout.payoutType === 'CONTRACT_SETTLEMENT' && payout.settlementId) {
      await Settlement.update(
        { status: 'COMPLETED', completedAt: new Date(), adminId },
        { where: { id: payout.settlementId }, transaction }
      );

      // 호스트 플랫폼 수수료 영수증 생성 (ReceiptSetting 등록한 호스트만)
      const settlement = await Settlement.findByPk(payout.settlementId, { transaction });
      if (settlement) {
        await createContractFeeReceipt(settlement, transaction);
      }
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

    const prevStatus = payout.status;

    await payout.update({
      status: 'FAILED',
      adminId,
      failureReason,
      processedAt: new Date()
    }, { transaction });

    await PayoutLog.create({
      payoutId: payout.id,
      fromStatus: prevStatus,
      toStatus: 'FAILED',
      adminId,
      note: failureReason,
      changedBy: 'ADMIN'
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

    const prevStatus = payout.status;

    await payout.update({
      status: 'CANCELLED',
      adminId,
      note: note || null,
      processedAt: new Date()
    }, { transaction });

    await PayoutLog.create({
      payoutId: payout.id,
      fromStatus: prevStatus,
      toStatus: 'CANCELLED',
      adminId,
      note: note || null,
      changedBy: 'ADMIN'
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
        where: { userId: payout.recipientId, isPrimary: true }
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

    await PayoutLog.create({
      payoutId: payout.id,
      fromStatus: 'FAILED',
      toStatus: 'PAYABLE',
      adminId,
      note: '계좌 재스냅샷 후 재시도',
      changedBy: 'ADMIN'
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
 * 지급 목록 CSV 다운로드
 * GET /api/admin/payouts/export
 *
 * Query: status, payoutType, recipientType, startDate, endDate, search
 */
exports.exportPayouts = async (req, res) => {
  try {
    const { status, payoutType, recipientType, startDate, endDate, search } = req.query;

    const where = {};
    if (status) where.status = status;
    if (payoutType) where.payoutType = payoutType;
    if (recipientType) where.recipientType = recipientType;

    if (startDate || endDate) {
      where.payableAfter = {};
      if (startDate) where.payableAfter[Op.gte] = startDate;
      if (endDate) where.payableAfter[Op.lte] = endDate;
    }

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

    const payouts = await Payout.findAll({
      where,
      include,
      order: [['createdAt', 'DESC']]
    });

    // CSV 생성
    const headers = ['지급ID', '대상구분', '이름', '계좌은행', '계좌번호', '지급금액', '지급사유', '발생일시', '상태'];

    const rows = payouts.map(p => [
      p.id,
      p.recipientType === 'HOST' ? '호스트' : '게스트',
      p.recipient?.name || p.recipient?.nickname || '',
      p.bankName || '',
      p.accountNumber || '',
      p.amount,
      Payout.TYPE_LABELS[p.payoutType] || p.payoutType,
      p.createdAt ? new Date(p.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }).replace(/\. /g, '-').replace('.', '') : '',
      Payout.STATUS_LABELS[p.status] || p.status
    ]);

    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const filename = `payouts_${todayKST()}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // BOM 추가 (Excel 한글 깨짐 방지)
    return res.send('\uFEFF' + csvContent);

  } catch (err) {
    console.error('지급 CSV 다운로드 오류:', err);
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

const PAYOUT_TYPE_DESCRIPTIONS = {
  CONTRACT_SETTLEMENT: '정상 계약 이행 후 호스트 이용료 정산',
  GUEST_PENALTY: '게스트 귀책 취소로 인한 호스트 위약금 지급',
  DEPOSIT_DEDUCTION: '보증금 차감 합의 후 호스트 지급',
  HOST_CANCELLATION_COMPENSATION: '호스트 귀책 취소로 인한 게스트 보상 지급'
};

function formatPayoutDetail(p) {
  return {
    id: p.id,
    contractId: p.contractId,
    settlementId: p.settlementId,
    refundId: p.refundId,
    payoutType: p.payoutType,
    payoutTypeLabel: Payout.TYPE_LABELS[p.payoutType],
    payoutTypeDescription: PAYOUT_TYPE_DESCRIPTIONS[p.payoutType] || null,
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
    // 계좌 정보
    bankName: p.bankName,
    accountNumber: p.accountNumber || null,
    accountHolder: p.accountHolder,
    // 처리 정보
    adminId: p.adminId,
    processedByAdmin: p.processedByAdmin ? { id: p.processedByAdmin.id, name: p.processedByAdmin.name } : null,
    processedAt: p.processedAt,
    failureReason: p.failureReason,
    note: p.note,
    // 연관 정보
    contract: p.contract ? {
      id: p.contract.id,
      checkInDate: toKSTString(p.contract.checkInDate),
      checkOutDate: toKSTString(p.contract.checkOutDate),
      rentalFee: p.contract.rentalFee,
      maintenanceFee: p.contract.maintenanceFee,
      cleaningFee: p.contract.cleaningFee,
      finalTotalAmount: p.contract.finalTotalAmount,
      rentalItemsFee: (p.contract.rentalOrders || []).reduce((sum, o) => sum + (o.totalAmount || 0), 0)
    } : null,
    settlement: p.settlement,
    refund: p.refund,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    // 상태 변경 이력
    statusHistory: (p.logs || []).map(log => ({
      id: log.id,
      fromStatus: log.fromStatus,
      toStatus: log.toStatus,
      changedBy: log.changedBy,
      adminName: log.admin?.name || null,
      note: log.note,
      createdAt: log.createdAt
    }))
  };
}
