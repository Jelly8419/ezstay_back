/**
 * Settlement Controller
 * 호스트 정산 관리 API
 */
const { Contract, Room, RoomPhoto, User, Refund, UserBankAccount, sequelize } = require('../models');
const { ErrorCodes, success, error } = require('../utils/responseHelper');
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
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 정산 기준일 (체크아웃 + 7일)
    const settlementCutoffDate = new Date(today);
    settlementCutoffDate.setDate(settlementCutoffDate.getDate() - 7);

    // 기본 WHERE 조건
    const whereCondition = {
      hostId,
      status: 'COMPLETED'
    };

    // 탭에 따른 조건 분기
    if (tab === 'pending') {
      // 정산 대기: 체크아웃 후 7일 이내
      whereCondition.checkOutDate = {
        [Op.gte]: settlementCutoffDate
      };
    } else if (tab === 'completed') {
      // 정산 완료: 체크아웃 후 7일 경과
      whereCondition.checkOutDate = {
        [Op.lt]: settlementCutoffDate
      };

      // 완료 탭에서만 필터 적용
      if (roomId) {
        whereCondition.roomId = parseInt(roomId);
      }

      // 날짜 필터 (정산일 기준)
      if (startDate || endDate) {
        // 정산일 = 체크아웃 + 7일이므로 역산
        const dateFilter = {};
        if (startDate) {
          const filterStart = new Date(startDate);
          filterStart.setDate(filterStart.getDate() - 7);
          dateFilter[Op.gte] = filterStart;
        }
        if (endDate) {
          const filterEnd = new Date(endDate);
          filterEnd.setDate(filterEnd.getDate() - 7);
          dateFilter[Op.lte] = filterEnd;
        }
        whereCondition.checkOutDate = {
          ...whereCondition.checkOutDate,
          ...dateFilter
        };
      }
    }

    // 계약 목록 조회
    const { count, rows: contracts } = await Contract.findAndCountAll({
      where: whereCondition,
      include: [
        {
          model: Room,
          as: 'room',
          attributes: ['id', 'roomName', 'address'],
          include: [
            {
              model: RoomPhoto,
              as: 'photos',
              attributes: ['photoUrl'],
              where: { displayOrder: 1 },
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
            'id', 'status', 'rentalFeeRefundAmount',
            'maintenanceFeeRefundAmount', 'cleaningFeeRefundAmount'
          ],
          required: false
        }
      ],
      order: [['checkOutDate', tab === 'pending' ? 'ASC' : 'DESC']],
      limit: parseInt(limit),
      offset
    });

    // 정산 정보 가공
    const settlements = contracts.map(contract => {
      const settlement = calculateSettlementAmount(contract, contract.refunds || []);
      const status = getSettlementStatus(contract.checkOutDate);
      const settlementDate = calculateSettlementDate(contract.checkOutDate);

      return {
        contractId: contract.id,
        contractNumber: contract.contractNumber,
        roomId: contract.room?.id,
        roomTitle: contract.room?.roomName,
        roomThumbnail: contract.room?.photos?.[0]?.photoUrl || null,
        guestName: contract.guest?.name,
        checkInDate: contract.checkInDate,
        checkOutDate: contract.checkOutDate,
        rentalDays: calculateRentalDays(contract.checkInDate, contract.checkOutDate),
        settlementAmount: settlement.finalAmount,
        settlementDate: settlementDate.toISOString().split('T')[0],
        status,
        statusLabel: SETTLEMENT_STATUS_LABELS[status],
        hasRefund: settlement.refund.hasRefund,
        refundAmount: settlement.refund.totalRefundAmount
      };
    });

    // 전체 통계 조회 (탭과 관계없이)
    const [pendingStats, completedStats] = await Promise.all([
      // 정산 대기 통계
      Contract.findAll({
        where: {
          hostId,
          status: 'COMPLETED',
          checkOutDate: { [Op.gte]: settlementCutoffDate }
        },
        attributes: [
          [fn('COUNT', col('id')), 'count'],
          [fn('SUM', col('rental_fee')), 'totalRentalFee'],
          [fn('SUM', col('maintenance_fee')), 'totalMaintenanceFee'],
          [fn('SUM', col('cleaning_fee')), 'totalCleaningFee'],
          [fn('SUM', col('platform_fee')), 'totalPlatformFee']
        ],
        raw: true
      }),
      // 정산 완료 통계
      Contract.findAll({
        where: {
          hostId,
          status: 'COMPLETED',
          checkOutDate: { [Op.lt]: settlementCutoffDate }
        },
        attributes: [
          [fn('COUNT', col('id')), 'count'],
          [fn('SUM', col('rental_fee')), 'totalRentalFee'],
          [fn('SUM', col('maintenance_fee')), 'totalMaintenanceFee'],
          [fn('SUM', col('cleaning_fee')), 'totalCleaningFee'],
          [fn('SUM', col('platform_fee')), 'totalPlatformFee']
        ],
        raw: true
      })
    ]);

    // 통계 계산
    const calculateTotalSettlement = (stats) => {
      if (!stats[0]) return 0;
      const total = (parseInt(stats[0].totalRentalFee) || 0) +
        (parseInt(stats[0].totalMaintenanceFee) || 0) +
        (parseInt(stats[0].totalCleaningFee) || 0) -
        (parseInt(stats[0].totalPlatformFee) || 0);
      return total;
    };

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
        totalSettlementAmount: tab === 'pending'
          ? calculateTotalSettlement(pendingStats)
          : calculateTotalSettlement(completedStats),
        pendingCount: parseInt(pendingStats[0]?.count) || 0,
        completedCount: parseInt(completedStats[0]?.count) || 0
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
              attributes: ['photoUrl'],
              where: { displayOrder: 1 },
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
            'id', 'status', 'refundType', 'refundReason',
            'rentalFeeRefundAmount', 'maintenanceFeeRefundAmount',
            'cleaningFeeRefundAmount', 'platformFeeDeducted',
            'finalRefundAmount', 'completedAt', 'createdAt'
          ],
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

    // 정산 금액 계산
    const settlement = calculateSettlementAmount(contract, contract.refunds || []);
    const status = getSettlementStatus(contract.checkOutDate);
    const settlementDate = calculateSettlementDate(contract.checkOutDate);

    // 환불 정보 가공
    const completedRefund = contract.refunds?.find(r => r.status === 'COMPLETED');
    const refundInfo = completedRefund ? {
      hasRefund: true,
      refundDate: completedRefund.completedAt || completedRefund.createdAt,
      refundReason: completedRefund.refundReason,
      refundType: completedRefund.refundType,
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
        contractNumber: contract.contractNumber,
        status: contract.status,
        checkInDate: contract.checkInDate,
        checkOutDate: contract.checkOutDate,
        rentalDays: calculateRentalDays(contract.checkInDate, contract.checkOutDate),
        paidAt: contract.paidAt
      },
      room: {
        roomId: contract.room?.id,
        title: contract.room?.roomName,
        address: contract.room?.address,
        thumbnail: contract.room?.photos?.[0]?.photoUrl || null
      },
      guest: {
        name: contract.guest?.name,
        phone: maskPhoneNumber(contract.guest?.phoneNumber)
      },
      breakdown: {
        rentalFee: settlement.rentalFee,
        maintenanceFee: settlement.maintenanceFee,
        cleaningFee: settlement.cleaningFee,
        subtotal: settlement.subtotal,
        platformFee: settlement.platformFee,
        platformFeeRate: settlement.platformFeeRate,
        grossSettlement: settlement.grossSettlement
      },
      refund: refundInfo,
      settlement: {
        finalAmount: settlement.finalAmount,
        settlementDate: settlementDate.toISOString().split('T')[0],
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

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const settlementCutoffDate = new Date(today);
    settlementCutoffDate.setDate(settlementCutoffDate.getDate() - 7);

    // 기본 WHERE 조건
    const whereCondition = {
      hostId,
      status: 'COMPLETED'
    };

    // 탭에 따른 조건
    if (tab === 'pending') {
      whereCondition.checkOutDate = { [Op.gte]: settlementCutoffDate };
    } else if (tab === 'completed') {
      whereCondition.checkOutDate = { [Op.lt]: settlementCutoffDate };
    }

    // 필터 적용
    if (roomId) {
      whereCondition.roomId = parseInt(roomId);
    }

    if (startDate || endDate) {
      const dateFilter = {};
      if (startDate) {
        const filterStart = new Date(startDate);
        filterStart.setDate(filterStart.getDate() - 7);
        dateFilter[Op.gte] = filterStart;
      }
      if (endDate) {
        const filterEnd = new Date(endDate);
        filterEnd.setDate(filterEnd.getDate() - 7);
        dateFilter[Op.lte] = filterEnd;
      }

      if (whereCondition.checkOutDate) {
        whereCondition.checkOutDate = {
          ...whereCondition.checkOutDate,
          ...dateFilter
        };
      } else {
        whereCondition.checkOutDate = dateFilter;
      }
    }

    // 데이터 조회
    const contracts = await Contract.findAll({
      where: whereCondition,
      include: [
        {
          model: Room,
          as: 'room',
          attributes: ['id', 'roomName']
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
            'id', 'status', 'rentalFeeRefundAmount',
            'maintenanceFeeRefundAmount', 'cleaningFeeRefundAmount'
          ],
          required: false
        }
      ],
      order: [['checkOutDate', 'DESC']]
    });

    // 엑셀 데이터 준비
    const excelData = contracts.map(contract => {
      const settlement = calculateSettlementAmount(contract, contract.refunds || []);
      const status = getSettlementStatus(contract.checkOutDate);
      const settlementDate = calculateSettlementDate(contract.checkOutDate);

      return {
        contractNumber: contract.contractNumber,
        roomTitle: contract.room?.roomName,
        guestName: contract.guest?.name,
        checkInDate: contract.checkInDate,
        checkOutDate: contract.checkOutDate,
        rentalDays: calculateRentalDays(contract.checkInDate, contract.checkOutDate),
        rentalFee: settlement.rentalFee,
        maintenanceFee: settlement.maintenanceFee,
        cleaningFee: settlement.cleaningFee,
        subtotal: settlement.subtotal,
        platformFee: settlement.platformFee,
        refundAmount: settlement.refund.totalRefundAmount,
        settlementAmount: settlement.finalAmount,
        settlementDate: settlementDate.toISOString().split('T')[0],
        status: SETTLEMENT_STATUS_LABELS[status]
      };
    });

    // 엑셀 파일 생성
    const buffer = await createSettlementExcel(excelData);

    // 파일명 생성
    const fileName = `settlement_${new Date().toISOString().split('T')[0]}.xlsx`;

    // 응답 헤더 설정
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
    console.error('Settlement export error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

module.exports = {
  getSettlements,
  getSettlementDetail,
  exportSettlements
};
