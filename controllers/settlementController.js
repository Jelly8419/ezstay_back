/**
 * Settlement Controller
 * 호스트 정산 관리 API
 */
const { Contract, Room, RoomPhoto, User, Refund, UserBankAccount, EzService, Payout, DepositAgreement, Settlement, sequelize } = require('../models');
const { ErrorCodes, success, error } = require('../utils/responseHelper');
const { toDateStrKST, todayKST, toKSTString } = require('../utils/dateHelper');
const { toAbsoluteUrl } = require('../utils/urlHelper');
const { Op, fn, col, literal } = require('sequelize');
const {
  calculateSettlementDate,
  getSettlementStatus,
  calculateSettlementAmount,
  calculateRentalDays,
  maskPhoneNumber,
  maskAccountNumber,
  SETTLEMENT_STATUS_LABELS
} = require('../services/settlementService');
const { createSettlementExcel } = require('../utils/excelHelper');

const DEPOSIT_STATUS_LABELS = {
  HOLDING: '보증금 보류 중',
  RETURN_CONFIRMED: '전액 반환 확정',
  DEDUCTION_CONFIRMED: '차감 확정',
  RETURNED: '반환 완료'
};

/**
 * 정산 목록 조회
 * GET /api/host/settlements
 */
const getSettlements = async (req, res) => {
  try {
    const hostId = req.user.id;
    const {
      tab = 'pending',
      roomId,
      startDate,
      endDate,
      page = 1,
      limit = 20
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // 기본 WHERE 조건
    const whereCondition = {
      hostId,
      status: 'COMPLETED'
    };

    // Settlement 탭 조건 (Settlement.status 기반)
    const settlementWhere = { hostId };
    if (tab === 'pending') {
      settlementWhere.status = { [Op.in]: ['PENDING', 'READY', 'PROCESSING', 'ON_HOLD', 'FAILED'] };
    } else if (tab === 'completed') {
      settlementWhere.status = 'COMPLETED';

      // 완료 탭에서만 방/날짜 필터 적용
      if (roomId) {
        whereCondition.roomId = parseInt(roomId);
      }
      if (startDate || endDate) {
        const dateFilter = {};
        if (startDate) dateFilter[Op.gte] = startDate;
        if (endDate) dateFilter[Op.lte] = endDate;
        settlementWhere.expectedDate = dateFilter;
      }
    }

    // 계약 목록 조회
    const { count, rows: contracts } = await Contract.findAndCountAll({
      where: whereCondition,
      include: [
        {
          model: Settlement,
          as: 'settlement',
          attributes: ['status', 'expectedDate', 'netAmount', 'completedAt'],
          where: settlementWhere,
          required: true
        },
        {
          model: Room,
          as: 'room',
          attributes: ['id', 'roomName', 'address'],
          include: [
            {
              model: RoomPhoto,
              as: 'photos',
              attributes: ['url'],
              required: false,
              separate: true,
              order: [['order', 'ASC']],
              limit: 1
            },
            {
              model: EzService,
              as: 'ezService',
              attributes: ['cleaningService'],
              required: false
            }
          ]
        },
        {
          model: User,
          as: 'guest',
          attributes: ['id', 'name']
        },
        {
          model: Refund,
          as: 'refunds',
          attributes: [
            'id', 'refundStatus', 'rentalFeeRefundAmount',
            'maintenanceFeeRefundAmount', 'cleaningFeeRefundAmount'
          ],
          required: false
        },
        {
          model: Payout,
          as: 'payouts',
          attributes: ['id', 'payoutType', 'amount', 'status', 'payableAfter'],
          where: { payoutType: 'DEPOSIT_DEDUCTION', recipientType: 'HOST' },
          required: false
        }
      ],
      order: [[{ model: Settlement, as: 'settlement' }, 'expectedDate', tab === 'pending' ? 'ASC' : 'DESC']],
      limit: parseInt(limit),
      offset
    });

    // 정산 정보 가공
    const settlements = contracts.map(contract => {
      const hasEzCleaningService = contract.snapshot?.ezService?.cleaningService || false;
      const settlementCalc = calculateSettlementAmount(contract, contract.refunds || [], { hasEzCleaningService });
      const settlementRecord = contract.settlement;

      const depositDeductionPayout = contract.payouts?.find(p => p.payoutType === 'DEPOSIT_DEDUCTION') || null;

      return {
        contractId: contract.id,
        contractNumber: contract.orderId,
        roomId: contract.room?.id,
        roomTitle: contract.room?.roomName,
        roomThumbnail: toAbsoluteUrl(contract.room?.photos?.[0]?.url || null),
        guestName: contract.guest?.name,
        checkInDate: toKSTString(contract.checkInDate),
        checkOutDate: toKSTString(contract.checkOutDate),
        rentalDays: calculateRentalDays(contract.checkInDate, contract.checkOutDate),
        settlementAmount: settlementRecord?.netAmount ?? settlementCalc.finalAmount,
        settlementDate: settlementRecord?.expectedDate ?? toDateStrKST(calculateSettlementDate(contract.checkInDate)),
        status: settlementRecord?.status ?? 'PENDING',
        statusLabel: Settlement.STATUS_LABELS[settlementRecord?.status] ?? Settlement.STATUS_LABELS.PENDING,
        hasRefund: settlementCalc.refund.hasRefund,
        refundAmount: settlementCalc.refund.totalRefundAmount,
        hasEzCleaningService,
        depositDeduction: depositDeductionPayout ? {
          amount: depositDeductionPayout.amount,
          status: depositDeductionPayout.status,
          statusLabel: Payout.STATUS_LABELS[depositDeductionPayout.status],
          payableAfter: depositDeductionPayout.payableAfter
        } : null
      };
    });

    // 전체 건수 집계 (탭과 관계없이, Settlement.status 기반)
    const [pendingCount, completedCount] = await Promise.all([
      Settlement.count({
        where: {
          hostId,
          status: { [Op.in]: ['PENDING', 'READY', 'PROCESSING', 'ON_HOLD', 'FAILED'] }
        }
      }),
      Settlement.count({
        where: { hostId, status: 'COMPLETED' }
      })
    ]);

    // totalSettlementAmount: Settlement.netAmount 합산 (저장값 우선, 없으면 런타임 계산)
    const allSettlementsForSum = await Settlement.findAll({
      where: settlementWhere,
      attributes: ['contractId', 'netAmount']
    });
    const totalSettlementAmount = allSettlementsForSum.reduce((sum, s) => sum + (s.netAmount || 0), 0);

    // 호스트의 방 목록 (필터용)
    const hostRooms = await Room.findAll({
      where: { hostId },
      attributes: ['id', 'roomName'],
      order: [['roomName', 'ASC']]
    });

    return success(res, {
      settlements,
      summary: {
        totalCount: count,
        totalSettlementAmount,
        pendingCount,
        completedCount
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / parseInt(limit)),
        totalCount: count
      },
      filters: {
        rooms: hostRooms.map(room => ({
          roomId: room.id,
          roomTitle: room.roomName
        }))
      }
    });
  } catch (err) {
    console.error('Settlement list error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 정산 상세 조회
 * GET /api/host/settlements/:contractId
 */
const getSettlementDetail = async (req, res) => {
  try {
    const hostId = req.user.id;
    const { contractId } = req.params;

    // 계약 조회 (호스트 권한 확인)
    const contract = await Contract.findOne({
      where: {
        id: contractId,
        hostId,
        status: 'COMPLETED'
      },
      include: [
        {
          model: Room,
          as: 'room',
          attributes: ['id', 'roomName', 'address'],
          include: [
            {
              model: RoomPhoto,
              as: 'photos',
              attributes: ['url'],
              required: false,
              separate: true,
              order: [['order', 'ASC']],
              limit: 1
            },
            {
              model: EzService,
              as: 'ezService',
              attributes: ['cleaningService'],
              required: false
            }
          ]
        },
        {
          model: User,
          as: 'guest',
          attributes: ['id', 'name', 'phoneNumber']
        },
        {
          model: Refund,
          as: 'refunds',
          attributes: [
            'id', 'refundStatus', 'policyTypeUsed', 'cancellationReason',
            'rentalFeeRefundAmount', 'maintenanceFeeRefundAmount',
            'cleaningFeeRefundAmount', 'platformFeeDeducted',
            'finalRefundAmount', 'completedAt', 'createdAt'
          ],
          required: false
        },
        {
          model: Payout,
          as: 'payouts',
          attributes: ['id', 'payoutType', 'amount', 'status', 'payableAfter', 'processedAt'],
          where: { payoutType: 'DEPOSIT_DEDUCTION', recipientType: 'HOST' },
          required: false
        }
      ]
    });

    if (!contract) {
      return error(res, ErrorCodes.CONTRACT_NOT_FOUND, 404);
    }

    // 호스트 계좌 정보 조회
    const bankAccount = await UserBankAccount.findOne({
      where: {
        userId: hostId,
        isPrimary: true
      },
      attributes: ['bankName', 'accountNumber', 'accountHolder']
    });

    // EZ청소서비스 사용 여부 확인 (계약 시점 스냅샷 기준)
    const hasEzCleaningService = contract.snapshot?.ezService?.cleaningService || false;

    // 정산 금액 계산
    const settlement = calculateSettlementAmount(contract, contract.refunds || [], { hasEzCleaningService });
    const status = getSettlementStatus(contract.checkInDate);
    const settlementDate = calculateSettlementDate(contract.checkInDate);

    // 보증금 차감 지급 정보
    const depositDeductionPayout = contract.payouts?.find(p => p.payoutType === 'DEPOSIT_DEDUCTION') || null;

    // 환불 정보 가공
    const completedRefund = contract.refunds?.find(r => r.refundStatus === 'COMPLETED');
    const refundInfo = completedRefund ? {
      hasRefund: true,
      refundDate: completedRefund.completedAt || completedRefund.createdAt,
      refundReason: completedRefund.cancellationReason,
      refundType: completedRefund.policyTypeUsed,
      refundDetails: {
        rentalFeeRefund: completedRefund.rentalFeeRefundAmount || 0,
        maintenanceFeeRefund: completedRefund.maintenanceFeeRefundAmount || 0,
        cleaningFeeRefund: completedRefund.cleaningFeeRefundAmount || 0,
        totalRefund: (completedRefund.rentalFeeRefundAmount || 0) +
          (completedRefund.maintenanceFeeRefundAmount || 0) +
          (completedRefund.cleaningFeeRefundAmount || 0)
      }
    } : {
      hasRefund: false,
      refundDate: null,
      refundReason: null,
      refundDetails: null
    };

    return success(res, {
      contract: {
        contractId: contract.id,
        contractNumber: contract.orderId,
        status: contract.status,
        checkInDate: toKSTString(contract.checkInDate),
        checkOutDate: toKSTString(contract.checkOutDate),
        rentalDays: calculateRentalDays(contract.checkInDate, contract.checkOutDate),
        paidAt: contract.paidAt
      },
      room: {
        roomId: contract.room?.id,
        title: contract.room?.roomName,
        address: contract.room?.address,
        thumbnail: toAbsoluteUrl(contract.room?.photos?.[0]?.url || null)
      },
      guest: {
        name: contract.guest?.name,
        phone: maskPhoneNumber(contract.guest?.phoneNumber)
      },
      breakdown: {
        rentalFee: settlement.rentalFee,
        maintenanceFee: settlement.maintenanceFee,
        cleaningFee: settlement.cleaningFee,  // 호스트에게 정산되는 청소비 (EZ서비스 사용 시 0)
        originalCleaningFee: settlement.originalCleaningFee,  // 원래 청소비
        hasEzCleaningService: settlement.hasEzCleaningService,  // EZ청소서비스 사용 여부
        subtotal: settlement.subtotal,
        platformFee: settlement.platformFee,
        platformFeeRate: settlement.platformFeeRate,
        grossSettlement: settlement.grossSettlement
      },
      refund: refundInfo,
      depositDeduction: depositDeductionPayout ? {
        amount: depositDeductionPayout.amount,
        status: depositDeductionPayout.status,
        statusLabel: Payout.STATUS_LABELS[depositDeductionPayout.status],
        payableAfter: depositDeductionPayout.payableAfter,
        processedAt: depositDeductionPayout.processedAt
      } : null,
      settlement: {
        finalAmount: settlement.finalAmount,
        settlementDate: toDateStrKST(settlementDate),
        status,
        statusLabel: SETTLEMENT_STATUS_LABELS[status],
        bankInfo: bankAccount ? {
          bankName: bankAccount.bankName,
          accountNumber: maskAccountNumber(bankAccount.accountNumber),
          accountHolder: bankAccount.accountHolder
        } : null
      }
    });
  } catch (err) {
    console.error('Settlement detail error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 정산 내역 엑셀 다운로드
 * GET /api/host/settlements/export
 */
const exportSettlements = async (req, res) => {
  try {
    const hostId = req.user.id;
    const {
      tab = 'all',
      roomId,
      startDate,
      endDate
    } = req.query;

    // 기본 WHERE 조건
    const whereCondition = {
      hostId,
      status: 'COMPLETED'
    };

    // Settlement 탭/필터 조건 (Settlement.status + expectedDate 기반)
    const settlementWhere = { hostId };
    if (tab === 'pending') {
      settlementWhere.status = { [Op.in]: ['PENDING', 'READY', 'PROCESSING', 'ON_HOLD', 'FAILED'] };
    } else if (tab === 'completed') {
      settlementWhere.status = 'COMPLETED';
    }

    if (roomId) {
      whereCondition.roomId = parseInt(roomId);
    }

    if (startDate || endDate) {
      const dateFilter = {};
      if (startDate) dateFilter[Op.gte] = startDate;
      if (endDate) dateFilter[Op.lte] = endDate;
      settlementWhere.expectedDate = dateFilter;
    }

    // 데이터 조회
    const contracts = await Contract.findAll({
      where: whereCondition,
      include: [
        {
          model: Settlement,
          as: 'settlement',
          attributes: ['status', 'expectedDate', 'netAmount'],
          where: settlementWhere,
          required: true
        },
        {
          model: Room,
          as: 'room',
          attributes: ['id', 'roomName'],
          include: [
            {
              model: EzService,
              as: 'ezService',
              attributes: ['cleaningService'],
              required: false
            }
          ]
        },
        {
          model: User,
          as: 'guest',
          attributes: ['id', 'name']
        },
        {
          model: Refund,
          as: 'refunds',
          attributes: [
            'id', 'refundStatus', 'rentalFeeRefundAmount',
            'maintenanceFeeRefundAmount', 'cleaningFeeRefundAmount'
          ],
          required: false
        }
      ],
      order: [[{ model: Settlement, as: 'settlement' }, 'expectedDate', 'DESC']]
    });

    // 엑셀 데이터 준비
    const excelData = contracts.map(contract => {
      const hasEzCleaningService = contract.snapshot?.ezService?.cleaningService || false;
      const settlementCalc = calculateSettlementAmount(contract, contract.refunds || [], { hasEzCleaningService });
      const settlementRecord = contract.settlement;

      return {
        contractNumber: contract.orderId,
        roomTitle: contract.room?.roomName,
        guestName: contract.guest?.name,
        checkInDate: toKSTString(contract.checkInDate),
        checkOutDate: toKSTString(contract.checkOutDate),
        rentalDays: calculateRentalDays(contract.checkInDate, contract.checkOutDate),
        rentalFee: settlementCalc.rentalFee,
        maintenanceFee: settlementCalc.maintenanceFee,
        cleaningFee: settlementCalc.cleaningFee,
        hasEzCleaningService,
        subtotal: settlementCalc.subtotal,
        platformFee: settlementCalc.platformFee,
        refundAmount: settlementCalc.refund.totalRefundAmount,
        settlementAmount: settlementRecord?.netAmount ?? settlementCalc.finalAmount,
        settlementDate: settlementRecord?.expectedDate ?? toDateStrKST(calculateSettlementDate(contract.checkInDate)),
        status: Settlement.STATUS_LABELS[settlementRecord?.status] ?? Settlement.STATUS_LABELS.PENDING
      };
    });

    // 엑셀 파일 생성
    const buffer = await createSettlementExcel(excelData);

    // 파일명 생성: 정산내역(기간)
    const periodStr = (startDate && endDate)
      ? `${startDate}~${endDate}`
      : (startDate ? `${startDate}~` : (endDate ? `~${endDate}` : '전체'));
    const fileName = encodeURIComponent(`정산내역(${periodStr})`) + '.xlsx';

    // 응답 헤더 설정
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileName}"; filename*=UTF-8''${fileName}`
    );

    return res.send(buffer);
  } catch (err) {
    console.error('Settlement export error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 보증금 차감 이력 조회
 * GET /api/host/settlements/:contractId/deposit-deduction
 */
const getDepositDeductionDetail = async (req, res) => {
  try {
    const hostId = req.user.id;
    const { contractId } = req.params;

    const contract = await Contract.findOne({
      where: { id: contractId, hostId, status: 'COMPLETED' },
      attributes: [
        'id', 'orderId',
        'deposit', 'depositDeduction', 'deductionReason',
        'refundableDeposit', 'depositStatus',
        'checkoutStatus'
      ],
      include: [
        {
          model: Payout,
          as: 'payouts',
          attributes: ['id', 'amount', 'status', 'payableAfter', 'processedAt'],
          where: { payoutType: 'DEPOSIT_DEDUCTION', recipientType: 'HOST' },
          required: false
        },
        {
          model: DepositAgreement,
          as: 'depositAgreements',
          attributes: [
            'id', 'status',
            'holdReason', 'requestedAt',
            'rejectedAt', 'rejectedReason',
            'adminApprovedAt',
            'deductAmount', 'agreementText',
            'submittedAt', 'acceptedAt',
            'createdAt'
          ],
          required: false
        }
      ]
    });

    if (!contract) {
      return error(res, ErrorCodes.CONTRACT_NOT_FOUND, 404);
    }

    const payout = contract.payouts?.[0] || null;

    const history = (contract.depositAgreements || [])
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(da => ({
        id: da.id,
        status: da.status,
        statusLabel: DepositAgreement.STATUS_LABELS[da.status],
        holdReason: da.holdReason,
        requestedAt: da.requestedAt,
        rejectedAt: da.rejectedAt,
        rejectedReason: da.rejectedReason,
        adminApprovedAt: da.adminApprovedAt,
        deductAmount: da.deductAmount,
        agreementText: da.agreementText,
        submittedAt: da.submittedAt,
        acceptedAt: da.acceptedAt,
        createdAt: da.createdAt
      }));

    return success(res, {
      contractId: contract.id,
      contractNumber: contract.orderId,
      deposit: contract.deposit,
      depositDeduction: contract.depositDeduction,
      deductionReason: contract.deductionReason,
      refundableDeposit: contract.refundableDeposit,
      depositStatus: contract.depositStatus,
      depositStatusLabel: DEPOSIT_STATUS_LABELS[contract.depositStatus] ?? contract.depositStatus,
      payout: payout ? {
        id: payout.id,
        amount: payout.amount,
        status: payout.status,
        statusLabel: Payout.STATUS_LABELS[payout.status],
        payableAfter: payout.payableAfter,
        processedAt: payout.processedAt
      } : null,
      history
    });
  } catch (err) {
    console.error('Deposit deduction detail error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

module.exports = {
  getSettlements,
  getSettlementDetail,
  exportSettlements,
  getDepositDeductionDetail
};
