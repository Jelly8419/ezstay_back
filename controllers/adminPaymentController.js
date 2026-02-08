const { Payment, PaymentFailureLog, Contract, User, Room, Refund, sequelize } = require('../models');
const { Op } = require('sequelize');
const axios = require('axios');
const { success, error, ErrorCodes } = require('../utils/responseHelper');

/**
 * 결제 목록 조회
 * GET /api/admin/payments
 */
exports.getPayments = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status = '',
      method = '',
      search = '',
      startDate,
      endDate,
      sortBy = 'createdAt',
      sortOrder = 'DESC'
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const whereClause = {};

    // 상태 필터
    if (status) {
      whereClause.status = status;
    }

    // 결제수단 필터
    if (method) {
      whereClause.method = method;
    }

    // 날짜 범위 필터
    if (startDate || endDate) {
      whereClause.requestedAt = {};
      if (startDate) {
        whereClause.requestedAt[Op.gte] = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        whereClause.requestedAt[Op.lte] = end;
      }
    }

    // 검색 (결제 ID, 계약 ID, paymentKey)
    if (search) {
      if (/^\d+$/.test(search)) {
        whereClause[Op.or] = [
          { id: parseInt(search) },
          { contractId: parseInt(search) }
        ];
      } else {
        whereClause[Op.or] = [
          { paymentKey: { [Op.like]: `%${search}%` } },
          { orderId: { [Op.like]: `%${search}%` } }
        ];
      }
    }

    // 허용된 정렬 필드
    const allowedSortFields = ['createdAt', 'totalAmount', 'approvedAt', 'requestedAt'];
    const safeSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';
    const safeSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const { count, rows: payments } = await Payment.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: Contract,
          as: 'contract',
          attributes: ['id', 'orderId', 'roomId', 'hostId', 'guestId',
            'finalTotalAmount', 'paymentMethod', 'status',
            'checkInDate', 'checkOutDate'],
          include: [
            {
              model: User,
              as: 'guest',
              attributes: ['id', 'name', 'email']
            },
            {
              model: Room,
              as: 'room',
              attributes: ['id', 'roomName']
            }
          ]
        }
      ],
      order: [[safeSortBy, safeSortOrder]],
      limit: parseInt(limit),
      offset
    });

    return success(res, {
      payments: payments.map(payment => ({
        id: payment.id,
        contractId: payment.contractId,
        contractOrderId: payment.contract?.orderId || null,
        paymentKey: payment.paymentKey,
        orderId: payment.orderId,
        method: payment.method,
        status: payment.status,
        totalAmount: payment.totalAmount,
        balanceAmount: payment.balanceAmount,
        requestedAt: payment.requestedAt,
        approvedAt: payment.approvedAt,
        createdAt: payment.createdAt,
        guest: payment.contract?.guest ? {
          id: payment.contract.guest.id,
          name: payment.contract.guest.name,
          email: payment.contract.guest.email
        } : null,
        room: payment.contract?.room ? {
          id: payment.contract.room.id,
          roomName: payment.contract.room.roomName
        } : null,
        contractStatus: payment.contract?.status || null
      })),
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / parseInt(limit))
      }
    }, '결제 목록 조회 성공');

  } catch (err) {
    console.error('결제 목록 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 결제 상세 조회
 * GET /api/admin/payments/:paymentId
 */
exports.getPaymentDetail = async (req, res) => {
  try {
    const { paymentId } = req.params;

    const payment = await Payment.findByPk(paymentId, {
      include: [
        {
          model: Contract,
          as: 'contract',
          include: [
            {
              model: User,
              as: 'guest',
              attributes: ['id', 'name', 'nickname', 'email', 'phoneNumber']
            },
            {
              model: User,
              as: 'host',
              attributes: ['id', 'name', 'nickname', 'email', 'phoneNumber']
            },
            {
              model: Room,
              as: 'room',
              attributes: ['id', 'roomName', 'address']
            },
            {
              model: Refund,
              as: 'refunds',
              required: false
            },
            {
              model: PaymentFailureLog,
              as: 'paymentFailureLogs',
              required: false
            }
          ]
        }
      ]
    });

    if (!payment) {
      return error(res, ErrorCodes.PAYMENT_NOT_FOUND, 404);
    }

    const contract = payment.contract;

    return success(res, {
      payment: {
        id: payment.id,
        paymentKey: payment.paymentKey,
        orderId: payment.orderId,
        method: payment.method,
        status: payment.status,
        totalAmount: payment.totalAmount,
        balanceAmount: payment.balanceAmount,
        suppliedAmount: payment.suppliedAmount,
        vat: payment.vat,
        taxFreeAmount: payment.taxFreeAmount,
        currency: payment.currency,
        receiptUrl: payment.receiptUrl,
        requestedAt: payment.requestedAt,
        approvedAt: payment.approvedAt,
        createdAt: payment.createdAt,
        updatedAt: payment.updatedAt
      },
      contract: contract ? {
        id: contract.id,
        orderId: contract.orderId,
        status: contract.status,
        paymentMethod: contract.paymentMethod,
        finalTotalAmount: contract.finalTotalAmount,
        rentalFee: contract.rentalFee,
        maintenanceFee: contract.maintenanceFee,
        cleaningFee: contract.cleaningFee,
        platformFee: contract.platformFee,
        hostPlatformFee: contract.hostPlatformFee,
        deposit: contract.deposit,
        checkInDate: contract.checkInDate,
        checkOutDate: contract.checkOutDate,
        paidAt: contract.paidAt
      } : null,
      guest: contract?.guest || null,
      host: contract?.host || null,
      room: contract?.room || null,
      refunds: (contract?.refunds || []).map(r => ({
        id: r.id,
        refundStatus: r.refundStatus,
        totalRefundAmount: r.totalRefundAmount,
        finalRefundAmount: r.finalRefundAmount,
        cancellationReason: r.cancellationReason,
        requestedAt: r.requestedAt,
        completedAt: r.completedAt
      })),
      failureLogs: (contract?.paymentFailureLogs || []).map(log => ({
        id: log.id,
        failureCode: log.failureCode,
        failureMessage: log.failureMessage,
        createdAt: log.createdAt
      }))
    }, '결제 상세 조회 성공');

  } catch (err) {
    console.error('결제 상세 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 관리자 환불 처리 (토스페이먼츠 연동)
 * POST /api/admin/payments/:paymentId/refund
 */
exports.processAdminRefund = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { paymentId } = req.params;
    const { refundAmount, refundReason } = req.body;
    const adminId = req.admin.id;

    // 입력 검증
    if (!refundAmount || refundAmount <= 0) {
      await transaction.rollback();
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, { field: 'refundAmount' });
    }
    if (!refundReason) {
      await transaction.rollback();
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, { field: 'refundReason' });
    }

    const payment = await Payment.findByPk(paymentId, {
      include: [{
        model: Contract,
        as: 'contract'
      }],
      transaction
    });

    if (!payment) {
      await transaction.rollback();
      return error(res, ErrorCodes.PAYMENT_NOT_FOUND, 404);
    }

    // 환불 가능 상태 확인
    if (!['DONE', 'PARTIAL_CANCELED'].includes(payment.status)) {
      await transaction.rollback();
      return error(res, ErrorCodes.PAYMENT_NOT_REFUNDABLE, 400);
    }

    // 환불 금액 확인
    if (refundAmount > payment.balanceAmount) {
      await transaction.rollback();
      return error(res, ErrorCodes.REFUND_EXCEEDS_BALANCE, 400, {
        balanceAmount: payment.balanceAmount,
        requestedAmount: refundAmount
      });
    }

    // 토스페이먼츠 취소 API 호출
    const tossSecretKey = process.env.TOSS_SECRET_KEY;
    const encodedKey = Buffer.from(`${tossSecretKey}:`).toString('base64');

    let tossResponse;
    try {
      tossResponse = await axios.post(
        `https://api.tosspayments.com/v1/payments/${payment.paymentKey}/cancel`,
        {
          cancelReason: refundReason,
          cancelAmount: refundAmount
        },
        {
          headers: {
            Authorization: `Basic ${encodedKey}`,
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (tossError) {
      await transaction.rollback();
      console.error('토스 환불 실패:', tossError.response?.data || tossError.message);
      return error(res, ErrorCodes.PAYMENT_NOT_REFUNDABLE, 400, {
        tossErrorCode: tossError.response?.data?.code,
        tossErrorMessage: tossError.response?.data?.message
      });
    }

    const tossData = tossResponse.data;

    // Payment 상태 업데이트
    const newBalance = tossData.balanceAmount ?? (payment.balanceAmount - refundAmount);
    const newStatus = newBalance === 0 ? 'CANCELED' : 'PARTIAL_CANCELED';

    await payment.update({
      balanceAmount: newBalance,
      status: newStatus
    }, { transaction });

    // Refund 레코드 생성
    const refund = await Refund.create({
      contractId: payment.contractId,
      refundStatus: 'COMPLETED',
      policyTypeUsed: 'ADMIN_REFUND',
      cancellationDate: new Date(),
      checkInDate: payment.contract?.checkInDate || new Date(),
      daysBeforeCheckin: 0,
      originalRentalFee: payment.contract?.rentalFee || 0,
      originalCleaningFee: payment.contract?.cleaningFee || 0,
      originalMaintenanceFee: payment.contract?.maintenanceFee || 0,
      originalTotalAmount: payment.totalAmount,
      rentalFeeRefundRate: 0,
      rentalFeeRefundAmount: refundAmount,
      cleaningFeeRefundAmount: 0,
      maintenanceFeeRefundAmount: 0,
      totalRefundAmount: refundAmount,
      platformFeeDeducted: 0,
      penaltyAmount: 0,
      finalRefundAmount: refundAmount,
      refundMethod: 'ORIGINAL_PAYMENT',
      cancellationReason: refundReason,
      adminNotes: `관리자(ID:${adminId}) 직접 환불 처리`,
      requestedAt: new Date(),
      approvedAt: new Date(),
      completedAt: new Date()
    }, { transaction });

    await transaction.commit();

    return success(res, {
      refundId: refund.id,
      paymentId: payment.id,
      refundAmount,
      newBalance,
      paymentStatus: newStatus,
      cancelStatus: tossData.cancels?.[0]?.cancelStatus || null
    }, '환불이 처리되었습니다.');

  } catch (err) {
    await transaction.rollback();
    console.error('관리자 환불 처리 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};
