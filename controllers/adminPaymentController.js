const { Payment, PaymentFailureLog, RentalPayment, RentalOrder, RentalOrderItem, RentalItem, Contract, User, Room, Refund, ContractStatusLog, RentalOrderLog, sequelize } = require('../models');
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
/**
 * 결제 상세 (계약 기준 타임라인)
 * GET /api/admin/payments/:contractId
 * 계약의 결제/환불/렌탈 전체 이력을 타임라인으로 반환
 */
exports.getPaymentDetail = async (req, res) => {
  try {
    const { contractId } = req.params;

    const contract = await Contract.findByPk(contractId, {
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
        },
        {
          model: RentalOrder,
          as: 'rentalOrders',
          where: { status: { [Op.ne]: 'CANCELLED' } },
          required: false,
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
              model: RentalPayment,
              as: 'payment',
              required: false
            }
          ]
        }
      ]
    });

    if (!contract) {
      return error(res, ErrorCodes.CONTRACT_NOT_FOUND || { code: 3005, message: '계약을 찾을 수 없습니다.' }, 404);
    }

    // === 타임라인 구성 ===
    const timeline = [];

    // 1) 계약 결제 완료
    if (contract.payment && contract.payment.status !== 'READY') {
      const p = contract.payment;

      // 결제 상세 내용 구성
      const details = [`방 계약`];
      if (contract.room) details[0] = `방 계약, ${contract.room.roomName}`;

      timeline.push({
        occurredAt: p.approvedAt || p.createdAt,
        type: '결제완료',
        amount: p.totalAmount,
        description: details.join(', '),
        actor: 'guest',
        actorName: contract.guest?.name || null,
        pgStatus: p.status,
        paymentKey: p.paymentKey,
        method: p.method
      });
    }

    // 2) 계약 환불 이력
    (contract.refunds || []).forEach(r => {
      if (r.refundStatus === 'COMPLETED') {
        let description = '계약 환불';
        const penaltyAmount = r.penaltyAmount || 0;
        if (penaltyAmount > 0) {
          description = `계약 취소 (위약금 ${penaltyAmount.toLocaleString()}원)`;
        }

        // 보증금 환급 체크
        const metadata = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : (r.metadata || {});
        if (metadata.depositRefund) {
          description = '보증금 반환';
        }

        timeline.push({
          occurredAt: r.completedAt || r.updatedAt,
          type: '부분취소',
          amount: -(r.finalRefundAmount || 0),
          description,
          actor: r.metadata?.changedBy || 'system',
          actorName: null,
          pgStatus: r.refundMethod === 'ORIGINAL_PAYMENT' ? 'PARTIAL_CANCEL' : 'BANK_TRANSFER',
          refundId: r.id
        });
      }
    });

    // 3) 렌탈 결제/환불 이력 (RentalOrderLog 기반)
    const rentalLogs = await RentalOrderLog.findAll({
      where: {
        contractId: contract.id,
        action: { [Op.in]: ['PAYMENT_COMPLETED', 'REFUND_COMPLETED', 'ITEM_CANCELLED', 'ORDER_CANCELLED'] }
      },
      include: [{
        model: RentalOrder,
        as: 'order',
        attributes: ['id', 'orderId'],
        required: false
      }],
      order: [['createdAt', 'ASC']]
    });

    // rentalOrders를 id로 빠르게 조회할 수 있도록 맵 생성
    const rentalOrderMap = new Map(
      (contract.rentalOrders || []).map(ro => [ro.id, ro])
    );

    rentalLogs.forEach(log => {
      const isPayment = log.action === 'PAYMENT_COMPLETED';
      const isOrderCancelled = log.action === 'ORDER_CANCELLED';
      const metadata = log.metadata || {};

      let description;
      let type;

      if (isPayment) {
        // 해당 주문의 아이템 목록을 description에 포함
        const ro = rentalOrderMap.get(log.rentalOrderId);
        const itemDesc = (ro?.items || [])
          .map(i => `${i.rentalItem?.name || '아이템'} ${i.quantity}개`)
          .join(', ');
        description = itemDesc ? `렌탈 결제 (${itemDesc})` : '렌탈 결제';
        type = '결제완료';
      } else if (isOrderCancelled) {
        const ro = rentalOrderMap.get(log.rentalOrderId);
        const itemDesc = (ro?.items || [])
          .map(i => `${i.rentalItem?.name || '아이템'} ${i.quantity}개`)
          .join(', ');
        description = itemDesc ? `렌탈 주문 전체 취소 (${itemDesc})` : '렌탈 주문 전체 취소';
        type = '전체취소';
      } else {
        description = log.action === 'ITEM_CANCELLED' ? '렌탈 아이템 취소' : '렌탈 환불';
        type = '부분취소';
      }

      if (metadata.itemName) {
        description += `, ${metadata.itemName}`;
        if (metadata.quantity) description += ` ${metadata.quantity}개`;
      }
      if (log.description && !isPayment && !isOrderCancelled) description = log.description;

      const actorMap = { GUEST: 'guest', HOST: 'host', ADMIN: 'admin', SYSTEM: 'system' };

      timeline.push({
        occurredAt: log.createdAt,
        type,
        amount: log.amountChange || 0,
        description,
        actor: actorMap[log.actor] || log.actor,
        actorName: null,
        rentalOrderId: log.order?.orderId || null
      });
    });

    // 시간순 정렬
    timeline.sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));

    // === 금액 요약 ===
    const contractPaidAmount = contract.finalTotalAmount || 0;
    const contractRefundTotal = (contract.refunds || [])
      .filter(r => r.refundStatus === 'COMPLETED')
      .reduce((sum, r) => sum + (r.finalRefundAmount || 0), 0);
    const rentalPaidTotal = (contract.rentalOrders || [])
      .reduce((sum, ro) => sum + (ro.paidAmount || 0), 0);
    const rentalRefundTotal = (contract.rentalOrders || [])
      .reduce((sum, ro) => sum + (ro.refundedAmount || 0), 0);

    return success(res, {
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
        totalPaidAmount: contractPaidAmount + rentalPaidTotal,
        totalRefundedAmount: contractRefundTotal + rentalRefundTotal,
        currentBalance: (contractPaidAmount + rentalPaidTotal) - (contractRefundTotal + rentalRefundTotal),
        contractPaidAmount,
        contractRefundTotal,
        rentalPaidTotal,
        rentalRefundTotal
      },
      timeline,
      rentalOrders: (contract.rentalOrders || []).map(ro => ({
        id: ro.id,
        orderId: ro.orderId,
        orderType: ro.orderType,
        status: ro.status,
        totalAmount: parseFloat(ro.totalAmount),
        paidAmount: parseFloat(ro.paidAmount),
        refundedAmount: parseFloat(ro.refundedAmount),
        paymentMethod: ro.paymentMethod,
        deliveryStatus: ro.deliveryStatus,
        items: (ro.items || []).map(item => ({
          id: item.id,
          name: item.rentalItem?.name || null,
          imageUrl: item.rentalItem?.imageUrl || null,
          quantity: item.quantity,
          pricePerItem: parseFloat(item.pricePerItem),
          totalPrice: parseFloat(item.totalPrice),
          status: item.status
        }))
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
 * 탭1: 주문별 결제 현황 (계약 기준 결제 요약)
 * GET /api/admin/payments/summary
 * Query: page, limit, search, startDate, endDate, productType, sortBy, sortOrder
 */
exports.getPaymentSummary = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      startDate,
      endDate,
      productType = '',
      sortBy = 'paidAt',
      sortOrder = 'DESC'
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const safeSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // 결제 완료된 계약만 (PAYMENT_COMPLETED 이후 상태)
    const contractWhere = {
      status: { [Op.in]: ['PAYMENT_COMPLETED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'CANCEL_REQUESTED'] },
      paidAt: { [Op.ne]: null }
    };

    // 날짜 필터 (결제일 기준)
    if (startDate || endDate) {
      contractWhere.paidAt = {};
      if (startDate) contractWhere.paidAt[Op.gte] = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        contractWhere.paidAt[Op.lte] = end;
      }
    }

    // 검색 (계약ID, 이름, 전화번호)
    const includeOptions = [
      {
        model: User,
        as: 'guest',
        attributes: ['id', 'name', 'nickname', 'email', 'phoneNumber']
      },
      {
        model: User,
        as: 'host',
        attributes: ['id', 'name', 'nickname']
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
        attributes: ['id', 'orderId', 'status', 'paidAmount', 'refundedAmount'],
        required: false
      }
    ];

    if (search) {
      if (/^\d+$/.test(search) && search.length <= 10) {
        // 숫자만 → 계약 ID 검색
        contractWhere.id = parseInt(search);
      } else if (/^[\d-]+$/.test(search) && search.length >= 10) {
        // 전화번호 패턴
        includeOptions[0] = {
          ...includeOptions[0],
          where: { phoneNumber: { [Op.like]: `%${search.replace(/-/g, '')}%` } },
          required: true
        };
      } else {
        // 이름 검색
        includeOptions[0] = {
          ...includeOptions[0],
          where: { name: { [Op.like]: `%${search}%` } },
          required: true
        };
      }
    }

    // 정렬 매핑
    const sortMap = {
      paidAt: 'paid_at',
      totalAmount: 'final_total_amount',
      createdAt: 'created_at'
    };
    const orderField = sortMap[sortBy] || 'paid_at';

    const { count, rows: contracts } = await Contract.findAndCountAll({
      where: contractWhere,
      include: includeOptions,
      order: [[sequelize.col(orderField), safeSortOrder]],
      limit: limitNum,
      offset: (pageNum - 1) * limitNum,
      distinct: true
    });

    // 응답 데이터 구성
    const payments = contracts.map(contract => {
      // 계약 결제 금액
      const contractTotalAmount = contract.finalTotalAmount || 0;

      // 계약 환불 누적 (완료된 환불만)
      const contractRefundTotal = (contract.refunds || [])
        .reduce((sum, r) => sum + (r.finalRefundAmount || 0), 0);

      // 렌탈 결제/환불 금액
      const rentalPaidTotal = (contract.rentalOrders || [])
        .reduce((sum, ro) => sum + (ro.paidAmount || 0), 0);
      const rentalRefundTotal = (contract.rentalOrders || [])
        .reduce((sum, ro) => sum + (ro.refundedAmount || 0), 0);

      // 합산
      const totalPaidAmount = contractTotalAmount + rentalPaidTotal;
      const totalRefundedAmount = contractRefundTotal + rentalRefundTotal;
      const currentBalance = totalPaidAmount - totalRefundedAmount;

      // 상품 구분
      const hasContract = contractTotalAmount > 0;
      const hasRental = rentalPaidTotal > 0;
      let productTypeLabel = '계약';
      if (hasContract && hasRental) productTypeLabel = '계약/렌탈';
      else if (hasRental && !hasContract) productTypeLabel = '렌탈';

      // 유저 구분 (결제한 주체 = 게스트)
      const userType = 'guest';

      // 결제 수단
      const paymentMethod = contract.payment?.method || contract.paymentMethod || null;

      return {
        orderId: contract.orderId,
        contractId: contract.id,
        paidAt: contract.paidAt,
        productType: productTypeLabel,
        roomName: contract.room?.roomName || null,
        userName: contract.guest?.name || null,
        userType,
        totalPaidAmount,
        totalRefundedAmount,
        currentBalance,
        paymentMethod,
        contractStatus: contract.status,
        guest: contract.guest ? {
          id: contract.guest.id,
          name: contract.guest.name,
          nickname: contract.guest.nickname
        } : null,
        host: contract.host ? {
          id: contract.host.id,
          name: contract.host.name,
          nickname: contract.host.nickname
        } : null
      };
    });

    // 상품 구분 필터 (후처리)
    let filteredPayments = payments;
    if (productType) {
      filteredPayments = payments.filter(p => p.productType === productType);
    }

    return success(res, {
      payments: filteredPayments,
      pagination: {
        total: count,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(count / limitNum)
      }
    }, '주문별 결제 현황 조회 성공');

  } catch (err) {
    console.error('주문별 결제 현황 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 탭2: 결제/취소 내역 (이벤트 로그)
 * GET /api/admin/payments/logs
 * Query: page, limit, search, startDate, endDate, transactionType, productType, sortOrder
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

    // 1) 계약 결제/취소 로그 수집 (Payment status 변경 기록)
    // Payment 테이블에서 결제 완료 기록
    const paymentWhere = {
      status: { [Op.in]: ['DONE', 'CANCELED', 'PARTIAL_CANCELED'] }
    };

    if (startDate || endDate) {
      paymentWhere.approvedAt = {};
      if (startDate) paymentWhere.approvedAt[Op.gte] = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        paymentWhere.approvedAt[Op.lte] = end;
      }
    }

    if (search) {
      paymentWhere[Op.or] = [
        { orderId: { [Op.like]: `%${search}%` } },
        { paymentKey: { [Op.like]: `%${search}%` } }
      ];
    }

    const contractPayments = await Payment.findAll({
      where: paymentWhere,
      include: [{
        model: Contract,
        as: 'contract',
        attributes: ['id', 'orderId', 'status', 'finalTotalAmount', 'paymentMethod'],
        include: [
          { model: User, as: 'guest', attributes: ['id', 'name'] },
          { model: User, as: 'host', attributes: ['id', 'name'] },
          { model: Room, as: 'room', attributes: ['id', 'roomName'] }
        ]
      }],
      order: [['approvedAt', safeSortOrder]]
    });

    // Payment → 로그 변환
    const contractLogs = contractPayments.map(p => {
      // 거래 유형 결정
      let txType = '결제완료';
      if (p.status === 'CANCELED') txType = '전체취소';
      else if (p.status === 'PARTIAL_CANCELED') txType = '부분취소';

      const amount = p.status === 'DONE'
        ? p.totalAmount
        : -(p.totalAmount - (p.balanceAmount || 0));

      return {
        occurredAt: p.approvedAt || p.createdAt,
        transactionType: txType,
        paymentMethod: p.method,
        productType: '계약',
        amount: p.status === 'DONE' ? p.totalAmount : amount,
        orderId: p.contract?.orderId || p.orderId,
        userName: p.contract?.guest?.name || null,
        userType: 'guest',
        roomName: p.contract?.room?.roomName || null,
        contractId: p.contractId,
        paymentKey: p.paymentKey
      };
    });

    // 2) 계약 환불 완료 로그 (Refund COMPLETED)
    const refundWhere = { refundStatus: 'COMPLETED' };
    if (startDate || endDate) {
      refundWhere.completedAt = {};
      if (startDate) refundWhere.completedAt[Op.gte] = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        refundWhere.completedAt[Op.lte] = end;
      }
    }

    const refunds = await Refund.findAll({
      where: refundWhere,
      include: [{
        model: Contract,
        as: 'contract',
        attributes: ['id', 'orderId', 'status'],
        include: [
          { model: User, as: 'guest', attributes: ['id', 'name'] },
          { model: User, as: 'host', attributes: ['id', 'name'] },
          { model: Room, as: 'room', attributes: ['id', 'roomName'] }
        ]
      }],
      order: [['completedAt', safeSortOrder]]
    });

    const refundLogs = refunds.map(r => {
      // 상품 구분 세분화
      let refundProductType = '계약';
      const penaltyAmount = r.penaltyAmount || 0;
      const guestServiceFeeRefunded = r.guestServiceFeeRefunded || false;

      if (penaltyAmount > 0 && r.finalRefundAmount === 0) {
        // 위약금만 있고 환불 없음 → 호스트/게스트 취소 위약금
        refundProductType = r.cancellationReason?.includes('호스트')
          ? '호스트 계약 취소 위약금'
          : '게스트 계약 취소';
      }

      // 보증금 환급 체크 (metadata 기반)
      const metadata = r.metadata || {};
      if (metadata.depositRefund) {
        refundProductType = '보증금 환급';
      }

      return {
        occurredAt: r.completedAt,
        transactionType: '부분취소',
        paymentMethod: r.refundMethod || 'ORIGINAL_PAYMENT',
        productType: refundProductType,
        amount: -(r.finalRefundAmount || 0),
        orderId: r.contract?.orderId || null,
        userName: r.contract?.guest?.name || null,
        userType: 'guest',
        roomName: r.contract?.room?.roomName || null,
        contractId: r.contractId,
        refundId: r.id
      };
    });

    // 3) 렌탈 결제/환불 로그 (RentalOrderLog 중 결제/환불 관련)
    const rentalLogWhere = {
      action: { [Op.in]: ['PAYMENT_COMPLETED', 'REFUND_COMPLETED'] }
    };
    if (startDate || endDate) {
      rentalLogWhere.createdAt = {};
      if (startDate) rentalLogWhere.createdAt[Op.gte] = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        rentalLogWhere.createdAt[Op.lte] = end;
      }
    }

    const rentalLogs = await RentalOrderLog.findAll({
      where: rentalLogWhere,
      include: [
        {
          model: Contract,
          as: 'contract',
          attributes: ['id', 'orderId'],
          include: [
            { model: User, as: 'guest', attributes: ['id', 'name'] },
            { model: User, as: 'host', attributes: ['id', 'name'] },
            { model: Room, as: 'room', attributes: ['id', 'roomName'] }
          ]
        },
        {
          model: RentalOrder,
          as: 'order',
          attributes: ['id', 'orderId', 'paymentMethod'],
          required: false
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
        productType: '렌탈',
        amount: log.amountChange || 0,
        orderId: log.contract?.orderId || null,
        rentalOrderId: log.order?.orderId || null,
        userName: log.contract?.guest?.name || null,
        userType: log.actor === 'HOST' ? 'host' : 'guest',
        roomName: log.contract?.room?.roomName || null,
        contractId: log.contractId,
        actor: log.actor
      };
    });

    // 4) 전체 합산 및 정렬
    let allLogs = [...contractLogs, ...refundLogs, ...rentalEventLogs];

    // 검색 필터 (이름)
    if (search && !/^\d/.test(search)) {
      allLogs = allLogs.filter(log =>
        log.userName?.includes(search) || log.orderId?.includes(search)
      );
    }

    // 거래 유형 필터
    if (transactionType) {
      allLogs = allLogs.filter(log => log.transactionType === transactionType);
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

    // 페이지네이션
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
