const { Payment, PaymentFailureLog, RentalPayment, RentalOrder, RentalOrderItem, RentalItem, Contract, User, Room, Refund, RentalOrderLog, sequelize } = require('../models');
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
 * 결제 상세 조회 (주문번호 기준 로그 타임라인)
 * GET /api/admin/payments/:orderId?type=contract|rental
 * - type=contract: 계약 주문번호(Contract.orderId)로 조회
 * - type=rental: 렌탈 주문번호(RentalOrder.orderId)로 조회
 */
exports.getPaymentDetail = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { type = 'contract' } = req.query;

    if (type === 'rental') {
      // === 렌탈 주문 상세 ===
      const rentalOrder = await RentalOrder.findOne({
        where: { orderId },
        include: [
          {
            model: Contract,
            as: 'contract',
            attributes: ['id', 'orderId', 'status'],
            include: [
              { model: User, as: 'guest', attributes: ['id', 'name', 'nickname', 'email', 'phoneNumber'] },
              { model: User, as: 'host', attributes: ['id', 'name', 'nickname', 'email', 'phoneNumber'] },
              { model: Room, as: 'room', attributes: ['id', 'roomName', 'address'] }
            ]
          },
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
            model: RentalPayment,
            as: 'payment',
            required: false
          }
        ]
      });

      if (!rentalOrder) {
        return error(res, { code: 3010, message: '렌탈 주문을 찾을 수 없습니다.' }, 404);
      }

      // 렌탈 주문 로그 타임라인
      const rentalLogs = await RentalOrderLog.findAll({
        where: { rentalOrderId: rentalOrder.id },
        order: [['createdAt', 'ASC']]
      });

      const actorMap = { GUEST: 'guest', HOST: 'host', ADMIN: 'admin', SYSTEM: 'system' };
      const timeline = rentalLogs.map(log => {
        const metadata = log.metadata || {};
        let type = log.action;
        let description = log.description || '';

        if (log.action === 'PAYMENT_COMPLETED') {
          type = '결제완료';
          const itemDesc = (rentalOrder.items || [])
            .map(i => `${i.rentalItem?.name || '아이템'} ${i.quantity}개`)
            .join(', ');
          description = itemDesc ? `렌탈 결제 (${itemDesc})` : '렌탈 결제';
        } else if (log.action === 'REFUND_COMPLETED') {
          type = '부분취소';
          description = description || '렌탈 환불';
        } else if (log.action === 'ITEM_CANCELLED') {
          type = '부분취소';
          description = metadata.itemName
            ? `렌탈 아이템 취소, ${metadata.itemName}${metadata.quantity ? ` ${metadata.quantity}개` : ''}`
            : '렌탈 아이템 취소';
        } else if (log.action === 'ORDER_CANCELLED') {
          type = '전체취소';
          const itemDesc = (rentalOrder.items || [])
            .map(i => `${i.rentalItem?.name || '아이템'} ${i.quantity}개`)
            .join(', ');
          description = itemDesc ? `렌탈 주문 전체 취소 (${itemDesc})` : '렌탈 주문 전체 취소';
        }

        return {
          occurredAt: log.createdAt,
          type,
          action: log.action,
          amount: log.amountChange || 0,
          balanceAfter: log.balanceAfter || 0,
          description,
          actor: actorMap[log.actor] || log.actor,
          actorName: null
        };
      });

      return success(res, {
        orderType: 'rental',
        orderId: rentalOrder.orderId,
        rentalOrder: {
          id: rentalOrder.id,
          orderId: rentalOrder.orderId,
          status: rentalOrder.status,
          totalAmount: parseFloat(rentalOrder.totalAmount),
          paidAmount: parseFloat(rentalOrder.paidAmount),
          refundedAmount: parseFloat(rentalOrder.refundedAmount),
          paymentMethod: rentalOrder.paymentMethod,
          deliveryStatus: rentalOrder.deliveryStatus,
          items: (rentalOrder.items || []).map(item => ({
            id: item.id,
            name: item.rentalItem?.name || null,
            imageUrl: item.rentalItem?.imageUrl || null,
            quantity: item.quantity,
            pricePerItem: parseFloat(item.pricePerItem),
            totalPrice: parseFloat(item.totalPrice),
            status: item.status
          }))
        },
        contract: rentalOrder.contract ? {
          id: rentalOrder.contract.id,
          orderId: rentalOrder.contract.orderId,
          status: rentalOrder.contract.status
        } : null,
        guest: rentalOrder.contract?.guest || null,
        host: rentalOrder.contract?.host || null,
        room: rentalOrder.contract?.room || null,
        timeline
      }, '렌탈 결제 상세 조회 성공');
    }

    // === 계약 주문 상세 (type=contract) ===
    const contract = await Contract.findOne({
      where: { orderId },
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
          model: Payment,
          as: 'payment',
          required: false
        },
        {
          model: Refund,
          as: 'refunds',
          required: false
        }
      ]
    });

    if (!contract) {
      return error(res, ErrorCodes.CONTRACT_NOT_FOUND || { code: 3005, message: '계약을 찾을 수 없습니다.' }, 404);
    }

    // === 타임라인: 결제/환불(돈이 오가는 이벤트)만 ===
    const timeline = [];

    // 1) 계약 결제 완료 (Payment 기반)
    if (contract.payment && contract.payment.status !== 'READY') {
      const p = contract.payment;
      timeline.push({
        occurredAt: p.approvedAt || p.createdAt,
        type: '결제완료',
        amount: p.totalAmount,
        description: `방 계약${contract.room ? `, ${contract.room.roomName}` : ''}`,
        actor: 'guest',
        actorName: contract.guest?.name || null,
        pgStatus: p.status,
        paymentKey: p.paymentKey,
        method: p.method
      });
    }

    // 환불 완료 이력 추가
    (contract.refunds || []).forEach(r => {
      if (r.refundStatus === 'COMPLETED') {
        let description = '계약 환불';
        const penaltyAmount = r.penaltyAmount || 0;
        if (penaltyAmount > 0) {
          description = `계약 취소 (위약금 ${penaltyAmount.toLocaleString()}원)`;
        }
        const metadata = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : (r.metadata || {});
        if (metadata.depositRefund) {
          description = '보증금 반환';
        }

        timeline.push({
          occurredAt: r.completedAt || r.updatedAt,
          type: '환불완료',
          amount: -(r.finalRefundAmount || 0),
          description,
          actor: metadata.changedBy || 'system',
          actorName: null,
          refundId: r.id
        });
      }
    });

    // 시간순 정렬
    timeline.sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));

    // === 금액 요약 ===
    const contractPaidAmount = contract.finalTotalAmount || 0;
    const contractRefundTotal = (contract.refunds || [])
      .filter(r => r.refundStatus === 'COMPLETED')
      .reduce((sum, r) => sum + (r.finalRefundAmount || 0), 0);

    return success(res, {
      orderType: 'contract',
      orderId: contract.orderId,
      contract: {
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
      },
      guest: contract.guest || null,
      host: contract.host || null,
      room: contract.room || null,
      summary: {
        totalPaidAmount: contractPaidAmount,
        totalRefundedAmount: contractRefundTotal,
        currentBalance: contractPaidAmount - contractRefundTotal
      },
      timeline
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
    const { contractId } = req.params;
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

    const payment = await Payment.findOne({
      where: { contractId },
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

/**
 * 탭2: 결제/취소 내역 (단건 이벤트 로그)
 * GET /api/admin/payments/logs
 * Query: page, limit, search, startDate, endDate, transactionType, productType, sortOrder
 * 컬럼: 발생일시, 거래유형, 결제수단, 상품구분, 금액, 이름, 유저구분
 */
exports.getPaymentLogs = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      startDate,
      endDate,
      transactionType = '',
      productType = '',
      sortOrder = 'DESC'
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const safeSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // 날짜 필터 헬퍼
    const buildDateFilter = (field) => {
      if (!startDate && !endDate) return {};
      const filter = {};
      if (startDate) filter[Op.gte] = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter[Op.lte] = end;
      }
      return { [field]: filter };
    };

    // === 1) 계약 결제 (Payment DONE) ===
    const paymentWhere = { status: 'DONE' };
    if (startDate || endDate) Object.assign(paymentWhere, buildDateFilter('approvedAt'));

    const contractPayments = await Payment.findAll({
      where: paymentWhere,
      include: [{
        model: Contract,
        as: 'contract',
        attributes: ['id', 'orderId'],
        include: [
          { model: User, as: 'guest', attributes: ['id', 'name'] },
          { model: Room, as: 'room', attributes: ['id', 'roomName'] }
        ]
      }],
      order: [['approvedAt', safeSortOrder]]
    });

    const paymentLogs = contractPayments.map(p => ({
      occurredAt: p.approvedAt || p.createdAt,
      transactionType: '결제완료',
      paymentMethod: p.method,
      productType: '계약',
      amount: p.totalAmount,
      orderId: p.contract?.orderId || null,
      userName: p.contract?.guest?.name || null,
      userType: '게스트',
      roomName: p.contract?.room?.roomName || null
    }));

    // === 2) 계약 환불 (Refund COMPLETED) ===
    const refundWhere = { refundStatus: 'COMPLETED' };
    if (startDate || endDate) Object.assign(refundWhere, buildDateFilter('completedAt'));

    const refunds = await Refund.findAll({
      where: refundWhere,
      include: [{
        model: Contract,
        as: 'contract',
        attributes: ['id', 'orderId', 'finalTotalAmount'],
        include: [
          { model: User, as: 'guest', attributes: ['id', 'name'] },
          { model: Room, as: 'room', attributes: ['id', 'roomName'] },
          { model: Payment, as: 'payment', attributes: ['totalAmount', 'balanceAmount'], required: false }
        ]
      }]
    });

    const refundLogs = refunds.map(r => {
      // 부분취소 vs 전체취소: 환불 후 잔액이 0이면 전체취소
      const payment = r.contract?.payment;
      const balanceAfterRefund = payment ? (payment.balanceAmount || 0) : null;
      const isFullCancel = balanceAfterRefund === 0;

      // 상품 구분 세분화
      let refundProductType = '계약';
      const metadata = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : (r.metadata || {});
      if (metadata.depositRefund) refundProductType = '보증금 환급';
      else if (r.penaltyAmount > 0 && r.finalRefundAmount === 0) {
        refundProductType = r.cancellationReason?.includes('호스트')
          ? '호스트 계약 취소 위약금' : '게스트 계약 취소';
      }

      return {
        occurredAt: r.completedAt,
        transactionType: isFullCancel ? '전체취소' : '부분취소',
        paymentMethod: r.refundMethod || 'ORIGINAL_PAYMENT',
        productType: refundProductType,
        amount: -(r.finalRefundAmount || 0),
        orderId: r.contract?.orderId || null,
        userName: r.contract?.guest?.name || null,
        userType: '게스트',
        roomName: r.contract?.room?.roomName || null
      };
    });

    // === 3) 렌탈 결제/환불 (RentalOrderLog) ===
    const rentalLogWhere = {
      action: { [Op.in]: ['PAYMENT_COMPLETED', 'REFUND_COMPLETED'] }
    };
    if (startDate || endDate) Object.assign(rentalLogWhere, buildDateFilter('createdAt'));

    const rentalLogs = await RentalOrderLog.findAll({
      where: rentalLogWhere,
      include: [
        {
          model: Contract,
          as: 'contract',
          attributes: ['id', 'orderId'],
          include: [
            { model: User, as: 'guest', attributes: ['id', 'name'] },
            { model: Room, as: 'room', attributes: ['id', 'roomName'] }
          ]
        },
        {
          model: RentalOrder,
          as: 'order',
          attributes: ['id', 'orderId', 'orderType', 'paymentMethod'],
          where: { orderType: { [Op.ne]: 'INITIAL' } },
          required: true
        }
      ],
      order: [['createdAt', safeSortOrder]]
    });

    const rentalEventLogs = rentalLogs.map(log => {
      const isPayment = log.action === 'PAYMENT_COMPLETED';
      return {
        occurredAt: log.createdAt,
        transactionType: isPayment ? '결제완료' : '부분취소',
        paymentMethod: log.order?.paymentMethod || null,
        productType: '옵션',
        amount: isPayment ? Math.abs(log.amountChange || 0) : -(Math.abs(log.amountChange || 0)),
        orderId: log.contract?.orderId || null,
        rentalOrderId: log.order?.orderId || null,
        userName: log.contract?.guest?.name || null,
        userType: '게스트',
        roomName: log.contract?.room?.roomName || null
      };
    });

    // === 4) 전체 합산 및 정렬 ===
    let allLogs = [...paymentLogs, ...refundLogs, ...rentalEventLogs];

    // 검색 필터
    if (search) {
      allLogs = allLogs.filter(log =>
        log.userName?.includes(search) ||
        log.orderId?.includes(search) ||
        log.rentalOrderId?.includes(search)
      );
    }

    // 거래 유형 필터 (영문/한글 모두 지원)
    if (transactionType) {
      const txTypeMap = {
        'PAYMENT_COMPLETED': '결제완료',
        'PARTIAL_CANCEL': '부분취소',
        'FULL_CANCEL': '전체취소'
      };
      const filterValue = txTypeMap[transactionType] || transactionType;
      allLogs = allLogs.filter(log => log.transactionType === filterValue);
    }

    // 상품 구분 필터
    if (productType) {
      allLogs = allLogs.filter(log => log.productType === productType);
    }

    // 정렬
    allLogs.sort((a, b) => {
      const dateA = new Date(a.occurredAt);
      const dateB = new Date(b.occurredAt);
      return safeSortOrder === 'DESC' ? dateB - dateA : dateA - dateB;
    });

    const totalCount = allLogs.length;
    const startIdx = (pageNum - 1) * limitNum;
    const paginatedLogs = allLogs.slice(startIdx, startIdx + limitNum);

    return success(res, {
      logs: paginatedLogs,
      pagination: {
        total: totalCount,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalCount / limitNum)
      }
    }, '결제/취소 내역 조회 성공');

  } catch (err) {
    console.error('결제/취소 내역 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 탭1: 주문별 결제 현황 (주문번호 기준 1행, 최종 거래 유형 표시)
 * GET /api/admin/payments/summary
 * Query: page, limit, search, startDate, endDate, transactionType, productType, sortOrder
 */
exports.getPaymentSummary = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      startDate,
      endDate,
      transactionType = '',
      productType = '',
      sortOrder = 'DESC'
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const safeSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // 결제 완료된 계약 조회 (탭1과 동일 베이스)
    const contractWhere = {
      status: { [Op.in]: ['PAYMENT_COMPLETED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'CANCEL_REQUESTED', 'REFUNDED'] },
      paidAt: { [Op.ne]: null }
    };

    // 날짜 필터 (최종 이벤트 발생일 기준 → paidAt 기준)
    if (startDate || endDate) {
      contractWhere.paidAt = {};
      if (startDate) contractWhere.paidAt[Op.gte] = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        contractWhere.paidAt[Op.lte] = end;
      }
    }

    const includeOptions = [
      {
        model: User,
        as: 'guest',
        attributes: ['id', 'name']
      },
      {
        model: User,
        as: 'host',
        attributes: ['id', 'name']
      },
      {
        model: Room,
        as: 'room',
        attributes: ['id', 'roomName']
      },
      {
        model: Payment,
        as: 'payment',
        attributes: ['id', 'method', 'status', 'totalAmount', 'balanceAmount'],
        required: false
      },
      {
        model: Refund,
        as: 'refunds',
        attributes: ['id', 'finalRefundAmount', 'refundStatus', 'completedAt'],
        where: { refundStatus: 'COMPLETED' },
        required: false
      },
      {
        model: RentalOrder,
        as: 'rentalOrders',
        attributes: ['id', 'orderId', 'orderType', 'status', 'paidAmount', 'refundedAmount'],
        where: { orderType: { [Op.ne]: 'INITIAL' } },
        required: false
      }
    ];

    // 검색
    if (search) {
      if (/^S?\d{8,}$/i.test(search)) {
        contractWhere.orderId = { [Op.like]: `%${search}%` };
      } else if (/^[\d-]+$/.test(search) && search.length >= 10) {
        includeOptions[0] = {
          ...includeOptions[0],
          where: { phoneNumber: { [Op.like]: `%${search.replace(/-/g, '')}%` } },
          required: true
        };
      } else {
        includeOptions[0] = {
          ...includeOptions[0],
          where: { name: { [Op.like]: `%${search}%` } },
          required: true
        };
      }
    }

    const { count, rows: contracts } = await Contract.findAndCountAll({
      where: contractWhere,
      include: includeOptions,
      order: [['paidAt', safeSortOrder]],
      limit: limitNum,
      offset: (pageNum - 1) * limitNum,
      distinct: true
    });

    // 계약 상태 한글 매핑
    const statusLabelMap = {
      PAYMENT_COMPLETED: '결제 완료',
      IN_PROGRESS: '입주중',
      COMPLETED: '계약 종료',
      CANCELLED: '계약 취소',
      CANCEL_REQUESTED: '취소 요청중',
      REFUNDED: '환불 완료'
    };

    // 주문번호 기준 1행 - 결제 현황 요약
    let payments = contracts.map(contract => {
      const contractTotalAmount = contract.finalTotalAmount || 0;
      const contractRefundTotal = (contract.refunds || [])
        .reduce((sum, r) => sum + (r.finalRefundAmount || 0), 0);
      const rentalPaidTotal = (contract.rentalOrders || [])
        .reduce((sum, ro) => sum + (parseFloat(ro.paidAmount) || 0), 0);
      const rentalRefundTotal = (contract.rentalOrders || [])
        .reduce((sum, ro) => sum + (parseFloat(ro.refundedAmount) || 0), 0);

      const totalPaidAmount = contractTotalAmount + rentalPaidTotal;
      const totalRefundedAmount = contractRefundTotal + rentalRefundTotal;
      const currentBalance = totalPaidAmount - totalRefundedAmount;

      // 결제 수단
      const paymentMethod = contract.payment?.method || contract.paymentMethod || null;

      // 상품 구분
      const hasContract = contractTotalAmount > 0;
      const hasRental = rentalPaidTotal > 0;
      let productTypeLabel = '계약';
      if (hasContract && hasRental) productTypeLabel = '계약/렌탈';
      else if (hasRental && !hasContract) productTypeLabel = '렌탈';

      return {
        contractId: contract.id,
        orderId: contract.orderId,
        paidAt: contract.paidAt,
        productType: productTypeLabel,
        roomName: contract.room?.roomName || null,
        userName: contract.guest?.name || null,
        userType: '게스트',
        totalPaidAmount,
        totalRefundedAmount,
        currentBalance,
        paymentMethod,
        contractStatus: contract.status,
        contractStatusLabel: statusLabelMap[contract.status] || contract.status
      };
    });

    // 상품 구분 필터
    if (productType) {
      payments = payments.filter(p => p.productType === productType);
    }

    return success(res, {
      payments,
      pagination: {
        total: productType ? payments.length : count,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil((productType ? payments.length : count) / limitNum)
      }
    }, '주문별 결제 현황 조회 성공');

  } catch (err) {
    console.error('결제/취소 내역 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};
