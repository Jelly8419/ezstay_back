const { Contract, Room, RoomPhoto, User, Refund, Payment, UserBankAccount, EzService, sequelize } = require('../models');
const { Op } = require('sequelize');
const { success, error, updated, ErrorCodes } = require('../utils/responseHelper');
const {
  calculateSettlementDate,
  getSettlementStatus,
  calculateSettlementAmount,
  calculateRentalDays,
  SETTLEMENT_STATUS_LABELS
} = require('../services/settlementService');
const { createSettlementExcel } = require('../utils/excelHelper');

/**
 * 관리자 정산 목록 조회
 * GET /api/admin/settlements
 */
exports.getAdminSettlements = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status = '',
      search = '',
      hostId,
      startDate,
      endDate,
      sortBy = 'checkInDate',
      sortOrder = 'DESC'
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 정산 cutoff: 입주일 + 3영업일 ≈ 최대 5 캘린더일
    const settlementCutoffDate = new Date(today);
    settlementCutoffDate.setDate(settlementCutoffDate.getDate() - 5);

    // 기본 WHERE: 완료된 계약만
    const whereCondition = {
      status: 'COMPLETED'
    };

    // 상태 필터
    if (status === 'pending') {
      whereCondition.checkInDate = { [Op.gte]: settlementCutoffDate };
      whereCondition[Op.or] = [
        { settlementStatus: 'auto' },
        { settlementStatus: null }
      ];
    } else if (status === 'completed') {
      whereCondition[Op.or] = [
        // 날짜 기반 자동 완료 (auto + 입주일+3영업일 경과)
        {
          settlementStatus: { [Op.or]: ['auto', null] },
          checkInDate: { [Op.lt]: settlementCutoffDate }
        },
        // 관리자 수동 완료
        { settlementStatus: 'completed' }
      ];
    } else if (status === 'on_hold') {
      whereCondition.settlementStatus = 'on_hold';
    }

    // 호스트 필터
    if (hostId) {
      whereCondition.hostId = parseInt(hostId);
    }

    // 날짜 범위 필터 (입주일 기준)
    if (startDate || endDate) {
      const dateFilter = {};
      if (startDate) {
        dateFilter[Op.gte] = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter[Op.lte] = end;
      }

      if (whereCondition.checkInDate) {
        whereCondition.checkInDate = {
          ...whereCondition.checkInDate,
          ...dateFilter
        };
      } else {
        whereCondition.checkInDate = dateFilter;
      }
    }

    // 호스트 검색 (이름)
    const hostSearchCondition = search ? {
      [Op.or]: [
        { name: { [Op.like]: `%${search}%` } },
        { email: { [Op.like]: `%${search}%` } }
      ]
    } : {};

    // 정렬
    const allowedSortFields = ['checkInDate', 'checkOutDate', 'createdAt', 'finalTotalAmount'];
    const safeSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'checkInDate';
    const safeSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const { count, rows: contracts } = await Contract.findAndCountAll({
      where: whereCondition,
      include: [
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
          as: 'host',
          attributes: ['id', 'name', 'email'],
          where: Object.keys(hostSearchCondition).length > 0 ? hostSearchCondition : undefined
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
      order: [[safeSortBy, safeSortOrder]],
      limit: parseInt(limit),
      offset
    });

    // 정산 정보 가공
    const settlements = contracts.map(contract => {
      const hasEzCleaningService = contract.room?.ezService?.cleaningService || false;
      const settlement = calculateSettlementAmount(contract, contract.refunds || [], { hasEzCleaningService });

      // 관리자 오버라이드 상태 확인
      let settlementStatusResult;
      if (contract.settlementStatus === 'completed') {
        settlementStatusResult = 'completed';
      } else if (contract.settlementStatus === 'on_hold') {
        settlementStatusResult = 'on_hold';
      } else {
        settlementStatusResult = getSettlementStatus(contract.checkInDate);
      }

      const settlementDate = calculateSettlementDate(contract.checkInDate);

      return {
        contractId: contract.id,
        contractNumber: contract.contractNumber,
        host: {
          id: contract.host?.id,
          name: contract.host?.name,
          email: contract.host?.email
        },
        room: {
          id: contract.room?.id,
          roomName: contract.room?.roomName
        },
        guestName: contract.guest?.name,
        checkInDate: contract.checkInDate,
        checkOutDate: contract.checkOutDate,
        rentalDays: calculateRentalDays(contract.checkInDate, contract.checkOutDate),
        settlementAmount: settlement.finalAmount,
        settlementDate: settlementDate.toISOString().split('T')[0],
        status: settlementStatusResult,
        statusLabel: settlementStatusResult === 'on_hold'
          ? '보류'
          : SETTLEMENT_STATUS_LABELS[settlementStatusResult] || settlementStatusResult,
        settlementCompletedAt: contract.settlementCompletedAt,
        settlementNote: contract.settlementNote,
        hasRefund: settlement.refund.hasRefund,
        refundAmount: settlement.refund.totalRefundAmount
      };
    });

    // 전체 통계
    const [pendingCount, completedCount, onHoldCount] = await Promise.all([
      Contract.count({
        where: {
          status: 'COMPLETED',
          checkInDate: { [Op.gte]: settlementCutoffDate },
          [Op.or]: [
            { settlementStatus: 'auto' },
            { settlementStatus: null }
          ]
        }
      }),
      Contract.count({
        where: {
          status: 'COMPLETED',
          [Op.or]: [
            {
              settlementStatus: { [Op.or]: ['auto', null] },
              checkInDate: { [Op.lt]: settlementCutoffDate }
            },
            { settlementStatus: 'completed' }
          ]
        }
      }),
      Contract.count({
        where: {
          status: 'COMPLETED',
          settlementStatus: 'on_hold'
        }
      })
    ]);

    return success(res, {
      settlements,
      summary: {
        pendingCount,
        completedCount,
        onHoldCount
      },
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / parseInt(limit))
      }
    }, '정산 목록 조회 성공');

  } catch (err) {
    console.error('관리자 정산 목록 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 관리자 정산 상세 조회
 * GET /api/admin/settlements/:contractId
 */
exports.getAdminSettlementDetail = async (req, res) => {
  try {
    const { contractId } = req.params;

    const contract = await Contract.findOne({
      where: {
        id: contractId,
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
          as: 'host',
          attributes: ['id', 'name', 'email', 'phoneNumber']
        },
        {
          model: User,
          as: 'guest',
          attributes: ['id', 'name', 'email', 'phoneNumber']
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
          model: Payment,
          as: 'payment',
          attributes: ['id', 'paymentKey', 'method', 'status', 'totalAmount', 'balanceAmount', 'approvedAt']
        }
      ]
    });

    if (!contract) {
      return error(res, ErrorCodes.SETTLEMENT_NOT_FOUND, 404);
    }

    // 호스트 계좌 정보 (관리자는 마스킹 없이 전체 표시)
    const bankAccount = await UserBankAccount.findOne({
      where: {
        userId: contract.hostId,
        isPrimary: true
      },
      attributes: ['bankName', 'accountNumber', 'accountHolder']
    });

    const hasEzCleaningService = contract.room?.ezService?.cleaningService || false;
    const settlement = calculateSettlementAmount(contract, contract.refunds || [], { hasEzCleaningService });
    const settlementDate = calculateSettlementDate(contract.checkInDate);

    // 관리자 오버라이드 상태
    let settlementStatusResult;
    if (contract.settlementStatus === 'completed') {
      settlementStatusResult = 'completed';
    } else if (contract.settlementStatus === 'on_hold') {
      settlementStatusResult = 'on_hold';
    } else {
      settlementStatusResult = getSettlementStatus(contract.checkInDate);
    }

    // 환불 정보
    const completedRefunds = (contract.refunds || []).filter(r => r.refundStatus === 'COMPLETED');

    return success(res, {
      contract: {
        contractId: contract.id,
        contractNumber: contract.contractNumber,
        orderId: contract.orderId,
        status: contract.status,
        checkInDate: contract.checkInDate,
        checkOutDate: contract.checkOutDate,
        rentalDays: calculateRentalDays(contract.checkInDate, contract.checkOutDate),
        paidAt: contract.paidAt
      },
      host: {
        id: contract.host?.id,
        name: contract.host?.name,
        email: contract.host?.email,
        phoneNumber: contract.host?.phoneNumber
      },
      room: {
        id: contract.room?.id,
        roomName: contract.room?.roomName,
        address: contract.room?.address,
        thumbnail: contract.room?.photos?.[0]?.url || null
      },
      guest: {
        id: contract.guest?.id,
        name: contract.guest?.name,
        email: contract.guest?.email,
        phoneNumber: contract.guest?.phoneNumber
      },
      payment: contract.payment ? {
        id: contract.payment.id,
        paymentKey: contract.payment.paymentKey,
        method: contract.payment.method,
        status: contract.payment.status,
        totalAmount: contract.payment.totalAmount,
        balanceAmount: contract.payment.balanceAmount,
        approvedAt: contract.payment.approvedAt
      } : null,
      breakdown: {
        rentalFee: settlement.rentalFee,
        maintenanceFee: settlement.maintenanceFee,
        cleaningFee: settlement.cleaningFee,
        originalCleaningFee: settlement.originalCleaningFee,
        hasEzCleaningService: settlement.hasEzCleaningService,
        subtotal: settlement.subtotal,
        platformFee: settlement.platformFee,
        platformFeeRate: settlement.platformFeeRate,
        grossSettlement: settlement.grossSettlement
      },
      refunds: completedRefunds.map(r => ({
        id: r.id,
        refundStatus: r.refundStatus,
        policyTypeUsed: r.policyTypeUsed,
        cancellationReason: r.cancellationReason,
        rentalFeeRefund: r.rentalFeeRefundAmount || 0,
        maintenanceFeeRefund: r.maintenanceFeeRefundAmount || 0,
        cleaningFeeRefund: r.cleaningFeeRefundAmount || 0,
        finalRefundAmount: r.finalRefundAmount || 0,
        completedAt: r.completedAt || r.createdAt
      })),
      settlement: {
        finalAmount: settlement.finalAmount,
        settlementDate: settlementDate.toISOString().split('T')[0],
        status: settlementStatusResult,
        statusLabel: settlementStatusResult === 'on_hold'
          ? '보류'
          : SETTLEMENT_STATUS_LABELS[settlementStatusResult] || settlementStatusResult,
        settlementCompletedAt: contract.settlementCompletedAt,
        settlementNote: contract.settlementNote,
        bankInfo: bankAccount ? {
          bankName: bankAccount.bankName,
          accountNumber: bankAccount.accountNumber,
          accountHolder: bankAccount.accountHolder
        } : null
      }
    }, '정산 상세 조회 성공');

  } catch (err) {
    console.error('관리자 정산 상세 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 정산 완료 처리
 * PATCH /api/admin/settlements/:contractId/complete
 */
exports.markSettlementComplete = async (req, res) => {
  try {
    const { contractId } = req.params;
    const { note } = req.body;
    const adminId = req.admin.id;

    const contract = await Contract.findOne({
      where: {
        id: contractId,
        status: 'COMPLETED'
      }
    });

    if (!contract) {
      return error(res, ErrorCodes.SETTLEMENT_NOT_FOUND, 404);
    }

    await contract.update({
      settlementStatus: 'completed',
      settlementCompletedAt: new Date(),
      settlementNote: note || `관리자(ID:${adminId}) 정산 완료 처리`
    });

    return updated(res, {
      contractId: contract.id,
      settlementStatus: 'completed',
      settlementCompletedAt: contract.settlementCompletedAt,
      settlementNote: contract.settlementNote
    }, '정산 완료 처리되었습니다.');

  } catch (err) {
    console.error('정산 완료 처리 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 정산 보류 처리
 * PATCH /api/admin/settlements/:contractId/hold
 */
exports.holdSettlement = async (req, res) => {
  try {
    const { contractId } = req.params;
    const { reason } = req.body;
    const adminId = req.admin.id;

    if (!reason) {
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, { field: 'reason' });
    }

    const contract = await Contract.findOne({
      where: {
        id: contractId,
        status: 'COMPLETED'
      }
    });

    if (!contract) {
      return error(res, ErrorCodes.SETTLEMENT_NOT_FOUND, 404);
    }

    await contract.update({
      settlementStatus: 'on_hold',
      settlementNote: `[보류 사유] ${reason} (관리자 ID:${adminId})`
    });

    return updated(res, {
      contractId: contract.id,
      settlementStatus: 'on_hold',
      settlementNote: contract.settlementNote
    }, '정산이 보류 처리되었습니다.');

  } catch (err) {
    console.error('정산 보류 처리 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 관리자 정산 엑셀 내보내기
 * GET /api/admin/settlements/export
 */
exports.exportAdminSettlements = async (req, res) => {
  try {
    const {
      status = '',
      hostId,
      startDate,
      endDate
    } = req.query;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // 정산 cutoff: 입주일 + 3영업일 ≈ 최대 5 캘린더일
    const settlementCutoffDate = new Date(today);
    settlementCutoffDate.setDate(settlementCutoffDate.getDate() - 5);

    const whereCondition = {
      status: 'COMPLETED'
    };

    // 상태 필터
    if (status === 'pending') {
      whereCondition.checkInDate = { [Op.gte]: settlementCutoffDate };
      whereCondition[Op.or] = [
        { settlementStatus: 'auto' },
        { settlementStatus: null }
      ];
    } else if (status === 'completed') {
      whereCondition[Op.or] = [
        {
          settlementStatus: { [Op.or]: ['auto', null] },
          checkInDate: { [Op.lt]: settlementCutoffDate }
        },
        { settlementStatus: 'completed' }
      ];
    } else if (status === 'on_hold') {
      whereCondition.settlementStatus = 'on_hold';
    }

    if (hostId) {
      whereCondition.hostId = parseInt(hostId);
    }

    if (startDate || endDate) {
      const dateFilter = {};
      if (startDate) {
        dateFilter[Op.gte] = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter[Op.lte] = end;
      }

      if (whereCondition.checkInDate) {
        whereCondition.checkInDate = {
          ...whereCondition.checkInDate,
          ...dateFilter
        };
      } else {
        whereCondition.checkInDate = dateFilter;
      }
    }

    const contracts = await Contract.findAll({
      where: whereCondition,
      include: [
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
          as: 'host',
          attributes: ['id', 'name']
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
      order: [['checkInDate', 'DESC']]
    });

    // 엑셀 데이터 준비 (호스트명 포함)
    const excelData = contracts.map(contract => {
      const hasEzCleaningService = contract.room?.ezService?.cleaningService || false;
      const settlement = calculateSettlementAmount(contract, contract.refunds || [], { hasEzCleaningService });

      let settlementStatusResult;
      if (contract.settlementStatus === 'completed') {
        settlementStatusResult = 'completed';
      } else if (contract.settlementStatus === 'on_hold') {
        settlementStatusResult = 'on_hold';
      } else {
        settlementStatusResult = getSettlementStatus(contract.checkInDate);
      }

      const settlementDate = calculateSettlementDate(contract.checkInDate);
      const statusLabel = settlementStatusResult === 'on_hold'
        ? '보류'
        : SETTLEMENT_STATUS_LABELS[settlementStatusResult] || settlementStatusResult;

      return {
        contractNumber: contract.contractNumber,
        roomTitle: contract.room?.roomName,
        guestName: contract.guest?.name,
        hostName: contract.host?.name,
        checkInDate: contract.checkInDate,
        checkOutDate: contract.checkOutDate,
        rentalDays: calculateRentalDays(contract.checkInDate, contract.checkOutDate),
        rentalFee: settlement.rentalFee,
        maintenanceFee: settlement.maintenanceFee,
        cleaningFee: settlement.cleaningFee,
        hasEzCleaningService,
        subtotal: settlement.subtotal,
        platformFee: settlement.platformFee,
        refundAmount: settlement.refund.totalRefundAmount,
        settlementAmount: settlement.finalAmount,
        settlementDate: settlementDate.toISOString().split('T')[0],
        status: statusLabel
      };
    });

    const buffer = await createSettlementExcel(excelData);

    const fileName = `admin_settlement_${new Date().toISOString().split('T')[0]}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileName}"`
    );

    return res.send(buffer);

  } catch (err) {
    console.error('관리자 정산 엑셀 내보내기 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};
