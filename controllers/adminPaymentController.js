const { Payment, PaymentFailureLog, RentalPayment, RentalOrder, RentalOrderItem, RentalItem, Contract, User, Room, Refund, sequelize } = require('../models');
const { Op } = require('sequelize');
const axios = require('axios');
const { success, error, ErrorCodes } = require('../utils/responseHelper');

/**
 * 결제 목록 조회 (계약 결제 + 렌탈 결제 통합)
 * GET /api/admin/payments
 * Query: type (contract|rental|all, 기본값: all)
 */
exports.getPayments = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      type = 'all',
      status = '',
      method = '',
      search = '',
      startDate,
      endDate,
      sortBy = 'createdAt',
      sortOrder = 'DESC'
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const safeSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // 공통 where 조건 빌더
    const buildWhereClause = (searchFields) => {
      const where = {};

      if (status) where.status = status;
      if (method) where.method = method;

      if (startDate || endDate) {
        where.requestedAt = {};
        if (startDate) where.requestedAt[Op.gte] = new Date(startDate);
        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          where.requestedAt[Op.lte] = end;
        }
      }

      if (search && searchFields) {
        if (/^\d+$/.test(search)) {
          where[Op.or] = searchFields.numeric(parseInt(search));
        } else {
          where[Op.or] = searchFields.text(search);
        }
      }

      return where;
    };

    let contractPayments = [];
    let rentalPayments = [];
    let contractCount = 0;
    let rentalCount = 0;

    // 계약 결제 조회
    if (type === 'all' || type === 'contract') {
      const contractWhere = buildWhereClause({
        numeric: (val) => [{ id: val }, { contractId: val }],
        text: (val) => [
          { paymentKey: { [Op.like]: `%${val}%` } },
          { orderId: { [Op.like]: `%${val}%` } }
        ]
      });

      const contractResult = await Payment.findAndCountAll({
        where: contractWhere,
        include: [{
          model: Contract,
          as: 'contract',
          attributes: ['id', 'orderId', 'roomId', 'hostId', 'guestId',
            'finalTotalAmount', 'paymentMethod', 'status',
            'checkInDate', 'checkOutDate'],
          include: [
            { model: User, as: 'guest', attributes: ['id', 'name', 'email'] },
            { model: Room, as: 'room', attributes: ['id', 'roomName'] }
          ]
        }],
        order: [['createdAt', safeSortOrder]],
        ...(type === 'contract' ? { limit: limitNum, offset: (pageNum - 1) * limitNum } : {})
      });

      contractCount = contractResult.count;
      contractPayments = contractResult.rows.map(p => ({
        id: p.id,
        type: 'contract',
        contractId: p.contractId,
        rentalOrderId: null,
        contractOrderId: p.contract?.orderId || null,
        paymentKey: p.paymentKey,
        orderId: p.orderId,
        method: p.method,
        status: p.status,
        totalAmount: p.totalAmount,
        balanceAmount: p.balanceAmount,
        requestedAt: p.requestedAt,
        approvedAt: p.approvedAt,
        createdAt: p.createdAt,
        guest: p.contract?.guest ? {
          id: p.contract.guest.id,
          name: p.contract.guest.name,
          email: p.contract.guest.email
        } : null,
        room: p.contract?.room ? {
          id: p.contract.room.id,
          roomName: p.contract.room.roomName
        } : null,
        contractStatus: p.contract?.status || null
      }));
    }

    // 렌탈 결제 조회
    if (type === 'all' || type === 'rental') {
      const rentalWhere = buildWhereClause({
        numeric: (val) => [{ id: val }, { rentalOrderId: val }, { contractId: val }],
        text: (val) => [
          { paymentKey: { [Op.like]: `%${val}%` } },
          { orderId: { [Op.like]: `%${val}%` } }
        ]
      });

      const rentalResult = await RentalPayment.findAndCountAll({
        where: rentalWhere,
        include: [{
          model: RentalOrder,
          as: 'rentalOrder',
          attributes: ['id', 'orderId', 'contractId', 'orderType', 'status', 'totalAmount'],
          include: [{
            model: Contract,
            as: 'contract',
            attributes: ['id', 'orderId', 'guestId', 'roomId', 'status'],
            include: [
              { model: User, as: 'guest', attributes: ['id', 'name', 'email'] },
              { model: Room, as: 'room', attributes: ['id', 'roomName'] }
            ]
          }]
        }],
        order: [['createdAt', safeSortOrder]],
        ...(type === 'rental' ? { limit: limitNum, offset: (pageNum - 1) * limitNum } : {})
      });

      rentalCount = rentalResult.count;
      rentalPayments = rentalResult.rows.map(rp => {
        const contract = rp.rentalOrder?.contract;
        return {
          id: rp.id,
          type: 'rental',
          contractId: rp.contractId,
          rentalOrderId: rp.rentalOrderId,
          contractOrderId: contract?.orderId || null,
          paymentKey: rp.paymentKey,
          orderId: rp.orderId,
          method: rp.method,
          status: rp.status,
          totalAmount: rp.totalAmount,
          balanceAmount: rp.balanceAmount,
          requestedAt: rp.requestedAt,
          approvedAt: rp.approvedAt,
          createdAt: rp.createdAt,
          guest: contract?.guest ? {
            id: contract.guest.id,
            name: contract.guest.name,
            email: contract.guest.email
          } : null,
          room: contract?.room ? {
            id: contract.room.id,
            roomName: contract.room.roomName
          } : null,
          contractStatus: contract?.status || null,
          rentalOrderType: rp.rentalOrder?.orderType || null
        };
      });
    }

    // 결과 합산 및 정렬
    let allPayments;
    let totalCount;

    if (type === 'all') {
      allPayments = [...contractPayments, ...rentalPayments];
      // 정렬
      allPayments.sort((a, b) => {
        const dateA = new Date(a.createdAt);
        const dateB = new Date(b.createdAt);
        return safeSortOrder === 'DESC' ? dateB - dateA : dateA - dateB;
      });
      totalCount = contractCount + rentalCount;
      // 페이지네이션 적용
      const startIdx = (pageNum - 1) * limitNum;
      allPayments = allPayments.slice(startIdx, startIdx + limitNum);
    } else {
      allPayments = type === 'contract' ? contractPayments : rentalPayments;
      totalCount = type === 'contract' ? contractCount : rentalCount;
    }

    return success(res, {
      payments: allPayments,
      summary: {
        contractCount,
        rentalCount,
        totalCount: contractCount + rentalCount
      },
      pagination: {
        total: totalCount,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalCount / limitNum)
      }
    }, '결제 목록 조회 성공');

  } catch (err) {
    console.error('결제 목록 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 결제 상세 조회 (계약 결제 + 렌탈 결제)
 * GET /api/admin/payments/:paymentId?type=contract|rental
 */
exports.getPaymentDetail = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { type = 'contract' } = req.query;

    // 렌탈 결제 상세
    if (type === 'rental') {
      const rentalPayment = await RentalPayment.findByPk(paymentId, {
        include: [{
          model: RentalOrder,
          as: 'rentalOrder',
          include: [
            {
              model: RentalOrderItem,
              as: 'items',
              include: [{
                model: RentalItem,
                as: 'rentalItem',
                attributes: ['id', 'name', 'price', 'imageUrl']
              }]
            },
            {
              model: Contract,
              as: 'contract',
              include: [
                { model: User, as: 'guest', attributes: ['id', 'name', 'nickname', 'email', 'phoneNumber'] },
                { model: User, as: 'host', attributes: ['id', 'name', 'nickname', 'email', 'phoneNumber'] },
                { model: Room, as: 'room', attributes: ['id', 'roomName', 'address'] }
              ]
            }
          ]
        }]
      });

      if (!rentalPayment) {
        return error(res, ErrorCodes.PAYMENT_NOT_FOUND, 404);
      }

      const rentalOrder = rentalPayment.rentalOrder;
      const contract = rentalOrder?.contract;

      return success(res, {
        type: 'rental',
        payment: {
          id: rentalPayment.id,
          paymentKey: rentalPayment.paymentKey,
          orderId: rentalPayment.orderId,
          method: rentalPayment.method,
          status: rentalPayment.status,
          totalAmount: rentalPayment.totalAmount,
          balanceAmount: rentalPayment.balanceAmount,
          suppliedAmount: rentalPayment.suppliedAmount,
          vat: rentalPayment.vat,
          taxFreeAmount: rentalPayment.taxFreeAmount,
          currency: rentalPayment.currency,
          receiptUrl: rentalPayment.receiptUrl,
          requestedAt: rentalPayment.requestedAt,
          approvedAt: rentalPayment.approvedAt,
          createdAt: rentalPayment.createdAt,
          updatedAt: rentalPayment.updatedAt
        },
        rentalOrder: rentalOrder ? {
          id: rentalOrder.id,
          orderId: rentalOrder.orderId,
          orderType: rentalOrder.orderType,
          status: rentalOrder.status,
          totalAmount: parseFloat(rentalOrder.totalAmount),
          items: (rentalOrder.items || []).map(item => ({
            id: item.id,
            rentalItemId: item.rentalItemId,
            name: item.rentalItem?.name || null,
            imageUrl: item.rentalItem?.imageUrl || null,
            quantity: item.quantity,
            pricePerItem: parseFloat(item.pricePerItem),
            totalPrice: parseFloat(item.totalPrice),
            status: item.status
          }))
        } : null,
        contract: contract ? {
          id: contract.id,
          orderId: contract.orderId,
          status: contract.status,
          checkInDate: contract.checkInDate,
          checkOutDate: contract.checkOutDate
        } : null,
        guest: contract?.guest || null,
        host: contract?.host || null,
        room: contract?.room || null
      }, '렌탈 결제 상세 조회 성공');
    }

    // 계약 결제 상세 (기본)
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
      type: 'contract',
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
