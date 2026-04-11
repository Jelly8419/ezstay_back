const { Payment, PaymentFailureLog, RentalPayment, RentalOrder, RentalOrderItem, RentalItem, Contract, User, Room, Refund, AdminRefund, RentalOrderLog, RentalOrderRefundRequest, RentalItemReservation, sequelize } = require('../models');
const { Op } = require('sequelize');
const paytagClient = require('../utils/paytagClient');
const { success, error, ErrorCodes } = require('../utils/responseHelper');
const { toKSTString } = require('../utils/dateHelper');
const { partialRefundRentalOrder, logRentalAction } = require('../utils/rentalOrderHelper');

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

    let allPayments = [];
    let totalCount = 0;
    let contractCount = 0;
    let rentalCount = 0;

    if (type === 'all') {
      // ── UNION Raw Query: DB 레벨에서 정렬+페이지네이션 처리 ──
      const replacements = {};
      const contractConditions = [];
      const rentalConditions = [];

      if (status) {
        contractConditions.push('p.status = :status');
        rentalConditions.push('rp.status = :status');
        replacements.status = status;
      }
      if (method) {
        contractConditions.push('p.method = :method');
        rentalConditions.push('rp.method = :method');
        replacements.method = method;
      }
      if (startDate) {
        contractConditions.push('p.requested_at >= :startDate');
        rentalConditions.push('rp.requested_at >= :startDate');
        replacements.startDate = new Date(startDate + 'T00:00:00');
      }
      if (endDate) {
        const end = new Date(endDate + 'T00:00:00');
        end.setHours(23, 59, 59, 999);
        contractConditions.push('p.requested_at <= :endDate');
        rentalConditions.push('rp.requested_at <= :endDate');
        replacements.endDate = end;
      }
      if (search) {
        if (/^\d+$/.test(search)) {
          contractConditions.push('(p.id = :searchNum OR p.contract_id = :searchNum)');
          rentalConditions.push('(rp.id = :searchNum OR rp.rental_order_id = :searchNum OR rp.contract_id = :searchNum)');
          replacements.searchNum = parseInt(search);
        } else {
          contractConditions.push('(p.payment_key LIKE :searchText OR p.order_id LIKE :searchText)');
          rentalConditions.push('(rp.payment_key LIKE :searchText OR rp.order_id LIKE :searchText)');
          replacements.searchText = `%${search}%`;
        }
      }

      const contractWhereSql = contractConditions.length ? `WHERE ${contractConditions.join(' AND ')}` : '';
      const rentalWhereSql   = rentalConditions.length   ? `WHERE ${rentalConditions.join(' AND ')}`   : '';

      // 카운트 쿼리
      const [[countRow]] = await sequelize.query(`
        SELECT
          (SELECT COUNT(*) FROM payments p ${contractWhereSql}) +
          (SELECT COUNT(*) FROM rental_payments rp ${rentalWhereSql}) AS total,
          (SELECT COUNT(*) FROM payments p ${contractWhereSql}) AS contractCount,
          (SELECT COUNT(*) FROM rental_payments rp ${rentalWhereSql}) AS rentalCount
      `, { replacements, type: sequelize.QueryTypes.SELECT });

      totalCount    = parseInt(countRow.total)         || 0;
      contractCount = parseInt(countRow.contractCount) || 0;
      rentalCount   = parseInt(countRow.rentalCount)   || 0;

      replacements.limitNum  = limitNum;
      replacements.offsetNum = (pageNum - 1) * limitNum;

      // 데이터 쿼리
      const rows = await sequelize.query(`
        SELECT
          'contract'        AS source_type,
          p.id,
          p.payment_type    AS paymentType,
          p.contract_id     AS contractId,
          NULL              AS rentalOrderId,
          p.payment_key     AS paymentKey,
          p.order_id        AS orderId,
          p.method,
          p.easy_pay_provider AS easyPayProvider,
          p.status,
          p.total_amount    AS totalAmount,
          p.balance_amount  AS balanceAmount,
          p.requested_at    AS requestedAt,
          p.approved_at     AS approvedAt,
          p.created_at      AS createdAt,
          c.order_id        AS contractOrderId,
          c.status          AS contractStatus,
          u.id              AS guestId,
          u.name            AS guestName,
          u.email           AS guestEmail,
          r.id              AS roomId,
          r.room_name       AS roomName,
          NULL              AS rentalOrderType
        FROM payments p
        LEFT JOIN contracts c ON c.id = p.contract_id
        LEFT JOIN users     u ON u.id = c.guest_id
        LEFT JOIN rooms     r ON r.id = c.room_id
        ${contractWhereSql}

        UNION ALL

        SELECT
          'rental'          AS source_type,
          rp.id,
          NULL              AS paymentType,
          rp.contract_id    AS contractId,
          rp.rental_order_id AS rentalOrderId,
          rp.payment_key    AS paymentKey,
          rp.order_id       AS orderId,
          rp.method,
          rp.easy_pay_provider AS easyPayProvider,
          rp.status,
          rp.total_amount   AS totalAmount,
          rp.balance_amount AS balanceAmount,
          rp.requested_at   AS requestedAt,
          rp.approved_at    AS approvedAt,
          rp.created_at     AS createdAt,
          c.order_id        AS contractOrderId,
          c.status          AS contractStatus,
          u.id              AS guestId,
          u.name            AS guestName,
          u.email           AS guestEmail,
          r.id              AS roomId,
          r.room_name       AS roomName,
          ro.order_type     AS rentalOrderType
        FROM rental_payments rp
        LEFT JOIN rental_orders ro ON ro.id = rp.rental_order_id
        LEFT JOIN contracts    c  ON c.id  = ro.contract_id
        LEFT JOIN users        u  ON u.id  = c.guest_id
        LEFT JOIN rooms        r  ON r.id  = c.room_id
        ${rentalWhereSql}

        ORDER BY createdAt ${safeSortOrder}
        LIMIT :limitNum OFFSET :offsetNum
      `, { replacements, type: sequelize.QueryTypes.SELECT });

      allPayments = rows.map(row => ({
        id: row.id,
        type: row.source_type,
        paymentType: row.paymentType || (row.source_type === 'contract' ? 'CONTRACT' : null),
        contractId: row.contractId,
        rentalOrderId: row.rentalOrderId || null,
        contractOrderId: row.contractOrderId || null,
        paymentKey: row.paymentKey,
        orderId: row.orderId,
        method: row.method,
        easyPayProvider: row.easyPayProvider || null,
        status: row.status,
        totalAmount: row.totalAmount,
        balanceAmount: row.balanceAmount,
        requestedAt: row.requestedAt,
        approvedAt: row.approvedAt,
        createdAt: row.createdAt,
        guest: row.guestId ? { id: row.guestId, name: row.guestName, email: row.guestEmail } : null,
        room: row.roomId ? { id: row.roomId, roomName: row.roomName } : null,
        contractStatus: row.contractStatus || null,
        rentalOrderType: row.rentalOrderType || null
      }));

    } else {
      // ── 단일 타입 조회: 기존 ORM 방식 유지 ──
      const buildWhereClause = (searchFields) => {
        const where = {};
        if (status) where.status = status;
        if (method) where.method = method;
        if (startDate || endDate) {
          where.requestedAt = {};
          if (startDate) where.requestedAt[Op.gte] = new Date(startDate + 'T00:00:00');
          if (endDate) {
            const end = new Date(endDate + 'T00:00:00');
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

      if (type === 'contract') {
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
              'finalTotalAmount', 'paymentMethod', 'status', 'checkInDate', 'checkOutDate'],
            include: [
              { model: User, as: 'guest', attributes: ['id', 'name', 'email'] },
              { model: Room, as: 'room', attributes: ['id', 'roomName'] }
            ]
          }],
          order: [['createdAt', safeSortOrder]],
          limit: limitNum,
          offset: (pageNum - 1) * limitNum
        });
        contractCount = contractResult.count;
        totalCount    = contractCount;
        allPayments   = contractResult.rows.map(p => ({
          id: p.id,
          type: 'contract',
          paymentType: p.paymentType || 'CONTRACT',
          contractId: p.contractId,
          rentalOrderId: null,
          contractOrderId: p.contract?.orderId || null,
          paymentKey: p.paymentKey,
          orderId: p.orderId,
          method: p.method,
          easyPayProvider: p.easyPayProvider || null,
          status: p.status,
          totalAmount: p.totalAmount,
          balanceAmount: p.balanceAmount,
          requestedAt: p.requestedAt,
          approvedAt: p.approvedAt,
          createdAt: p.createdAt,
          guest: p.contract?.guest ? { id: p.contract.guest.id, name: p.contract.guest.name, email: p.contract.guest.email } : null,
          room: p.contract?.room ? { id: p.contract.room.id, roomName: p.contract.room.roomName } : null,
          contractStatus: p.contract?.status || null
        }));
      } else {
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
          limit: limitNum,
          offset: (pageNum - 1) * limitNum
        });
        rentalCount = rentalResult.count;
        totalCount  = rentalCount;
        allPayments = rentalResult.rows.map(rp => {
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
            easyPayProvider: rp.easyPayProvider || null,
            status: rp.status,
            totalAmount: rp.totalAmount,
            balanceAmount: rp.balanceAmount,
            requestedAt: rp.requestedAt,
            approvedAt: rp.approvedAt,
            createdAt: rp.createdAt,
            guest: contract?.guest ? { id: contract.guest.id, name: contract.guest.name, email: contract.guest.email } : null,
            room: contract?.room ? { id: contract.room.id, roomName: contract.room.roomName } : null,
            contractStatus: contract?.status || null,
            rentalOrderType: rp.rentalOrder?.orderType || null
          };
        });
      }
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
          as: 'payments',
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

    // 1) 결제 완료 (Payment 기반 - CONTRACT + HOST_BURDEN 모두 포함)
    const payments = contract.payments || [];

    payments.forEach(p => {
      if (p.status === 'READY') return;
      const isHostBurden = p.paymentType === 'HOST_BURDEN';
      timeline.push({
        occurredAt: p.approvedAt || p.createdAt,
        type: '결제완료',
        amount: p.totalAmount,
        description: isHostBurden
          ? `호스트 부담금 결제${contract.room ? ` (${contract.room.roomName})` : ''}`
          : `방 계약${contract.room ? `, ${contract.room.roomName}` : ''}`,
        actor: isHostBurden ? 'host' : 'guest',
        actorName: isHostBurden
          ? (contract.host?.name || null)
          : (contract.guest?.name || null),
        paymentType: p.paymentType || 'CONTRACT',
        pgStatus: p.status,
        paymentKey: p.paymentKey,
        method: p.method,
        easyPayProvider: p.easyPayProvider || null
      });
    });

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
    const hostBurdenPaidAmount = (contract.payments || [])
      .filter(p => p.paymentType === 'HOST_BURDEN' && p.status === 'DONE')
      .reduce((sum, p) => sum + (p.totalAmount || 0), 0);
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
        checkInDate: toKSTString(contract.checkInDate),
        checkOutDate: toKSTString(contract.checkOutDate),
        paidAt: contract.paidAt
      },
      guest: contract.guest || null,
      host: contract.host || null,
      room: contract.room || null,
      summary: {
        contractPaidAmount,
        hostBurdenPaidAmount,
        totalPaidAmount: contractPaidAmount + hostBurdenPaidAmount,
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
 * 관리자 환불 처리 (PayTag 연동)
 * POST /api/admin/payments/:contractId/refund
 */
/**
 * 관리자 환불 처리 (PayTag 연동)
 * POST /api/admin/payments/:contractId/refund
 *
 * Request Body:
 * {
 *   refundReason: string,           // 필수
 *   items: {
 *     rentalFee: number,            // 임대료 환불액
 *     maintenanceFee: number,       // 관리비 환불액
 *     cleaningFee: number,          // 청소비 환불액
 *     platformFee: number,          // 서비스 수수료 환불액
 *     deposit: number,              // 보증금 환불액
 *     rentalItems: number           // 렌탈 아이템 환불액 (INITIAL 주문)
 *   }
 * }
 */
exports.processAdminRefund = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { contractId } = req.params;
    const { refundType, refundReason, items = {} } = req.body;
    const adminId = req.admin.id;

    // 필수 입력 검증
    if (!refundReason) {
      await transaction.rollback();
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, { field: 'refundReason' });
    }
    if (!['FULL', 'PARTIAL_ITEMS'].includes(refundType)) {
      await transaction.rollback();
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, { field: 'refundType', message: 'refundType은 FULL, PARTIAL_ITEMS 중 하나여야 합니다.' });
    }

    // 계약 결제 조회
    const payment = await Payment.findOne({
      where: { contractId, paymentType: 'CONTRACT' },
      include: [{ model: Contract, as: 'contract' }],
      transaction
    });

    if (!payment) {
      await transaction.rollback();
      return error(res, ErrorCodes.PAYMENT_NOT_FOUND, 404);
    }

    if (!['DONE', 'PARTIAL_CANCELED'].includes(payment.status)) {
      await transaction.rollback();
      return error(res, ErrorCodes.PAYMENT_NOT_REFUNDABLE, 400);
    }

    const contract = payment.contract;
    const now = new Date();

    // ── refundType별 금액 산정 ──
    // contractItems: 계약 상품(임대료/관리비 등) 항목별 환불액
    // rentalItemsToCancel: INITIAL 렌탈 아이템별 환불 목록 [{ orderItem, refundAmount }]
    let contractItems = { rentalFee: 0, maintenanceFee: 0, cleaningFee: 0, platformFee: 0, deposit: 0 };
    let directRefundAmount = 0; // FULL 전용
    let rentalItemsToCancel = []; // INITIAL 렌탈 아이템 취소 목록
    let rentalItemsRefundAmount = 0; // INITIAL 렌탈 환불 합산액
    let initialRentalOrder = null;

    if (refundType === 'FULL') {
      // 계약 결제 잔액 전액
      directRefundAmount = payment.balanceAmount;

      // INITIAL 렌탈 주문 전체 아이템 취소
      initialRentalOrder = await RentalOrder.findOne({
        where: { contractId, orderType: 'INITIAL', status: { [Op.in]: ['PAID', 'PARTIAL_REFUND'] } },
        transaction
      });
      if (initialRentalOrder) {
        const activeItems = await RentalOrderItem.findAll({
          where: { rentalOrderId: initialRentalOrder.id, status: { [Op.ne]: 'CANCELLED' } },
          include: [{ model: RentalItem, as: 'rentalItem', attributes: ['id', 'name'] }],
          transaction
        });
        rentalItemsToCancel = activeItems.map(i => ({ orderItem: i, refundAmount: parseFloat(i.totalPrice) }));
        rentalItemsRefundAmount = rentalItemsToCancel.reduce((sum, i) => sum + i.refundAmount, 0);
      }

    } else {
      // PARTIAL_ITEMS: 계약 상품별 금액 + INITIAL 렌탈 아이템 배열
      contractItems = {
        rentalFee:      Math.max(0, parseInt(items.rentalFee      || 0, 10)),
        maintenanceFee: Math.max(0, parseInt(items.maintenanceFee || 0, 10)),
        cleaningFee:    Math.max(0, parseInt(items.cleaningFee    || 0, 10)),
        platformFee:    Math.max(0, parseInt(items.platformFee    || 0, 10)),
        deposit:        Math.max(0, parseInt(items.deposit        || 0, 10))
      };
      const contractRefundTotal = Object.values(contractItems).reduce((s, v) => s + v, 0);

      // INITIAL 렌탈 아이템 배열 처리
      const rentalItemsInput = Array.isArray(items.rentalItems) ? items.rentalItems : [];
      if (rentalItemsInput.length > 0) {
        initialRentalOrder = await RentalOrder.findOne({
          where: { contractId, orderType: 'INITIAL', status: { [Op.in]: ['PAID', 'PARTIAL_REFUND'] } },
          transaction
        });
        if (!initialRentalOrder) {
          await transaction.rollback();
          return error(res, ErrorCodes.VALIDATION_ERROR, 400, {
            field: 'items.rentalItems',
            message: '환불 가능한 INITIAL 렌탈 주문이 없습니다.'
          });
        }

        for (const ri of rentalItemsInput) {
          const orderItem = await RentalOrderItem.findOne({
            where: { id: ri.rentalOrderItemId, rentalOrderId: initialRentalOrder.id },
            include: [{ model: RentalItem, as: 'rentalItem', attributes: ['id', 'name'] }],
            transaction
          });
          if (!orderItem) {
            await transaction.rollback();
            return error(res, ErrorCodes.VALIDATION_ERROR, 400, {
              field: 'items.rentalItems',
              message: `rentalOrderItemId(${ri.rentalOrderItemId})를 찾을 수 없습니다.`
            });
          }
          if (orderItem.status === 'CANCELLED') {
            await transaction.rollback();
            return error(res, ErrorCodes.VALIDATION_ERROR, 400, {
              field: 'items.rentalItems',
              message: `rentalOrderItemId(${ri.rentalOrderItemId})는 이미 취소된 아이템입니다.`
            });
          }
          const itemAmt = Math.max(0, parseInt(ri.refundAmount || 0, 10));
          if (itemAmt <= 0 || itemAmt > parseFloat(orderItem.totalPrice)) {
            await transaction.rollback();
            return error(res, ErrorCodes.VALIDATION_ERROR, 400, {
              field: 'items.rentalItems',
              message: `rentalOrderItemId(${ri.rentalOrderItemId}) 환불 금액(${itemAmt}원)이 유효하지 않습니다. (0 초과 ${orderItem.totalPrice}원 이하)`
            });
          }
          rentalItemsToCancel.push({ orderItem, refundAmount: itemAmt });
          rentalItemsRefundAmount += itemAmt;
        }
      }

      if (contractRefundTotal + rentalItemsRefundAmount <= 0) {
        await transaction.rollback();
        return error(res, ErrorCodes.VALIDATION_ERROR, 400, { field: 'items', message: '환불 금액은 0보다 커야 합니다.' });
      }

      // 계약 항목별 원금 이하 검증
      const itemValidations = [
        { field: 'rentalFee',      value: contractItems.rentalFee,      max: contract.rentalFee      || 0 },
        { field: 'maintenanceFee', value: contractItems.maintenanceFee,  max: contract.maintenanceFee || 0 },
        { field: 'cleaningFee',    value: contractItems.cleaningFee,     max: contract.cleaningFee    || 0 },
        { field: 'platformFee',    value: contractItems.platformFee,     max: contract.platformFee    || 0 },
        { field: 'deposit',        value: contractItems.deposit,         max: contract.deposit        || 0 }
      ];
      for (const v of itemValidations) {
        if (v.value > v.max) {
          await transaction.rollback();
          return error(res, ErrorCodes.VALIDATION_ERROR, 400, {
            field: v.field,
            message: `${v.field} 환불 금액(${v.value}원)이 원금(${v.max}원)을 초과합니다.`
          });
        }
      }

      if (contractRefundTotal > 0 && contractRefundTotal > payment.balanceAmount) {
        await transaction.rollback();
        return error(res, ErrorCodes.REFUND_EXCEEDS_BALANCE, 400, {
          balanceAmount: payment.balanceAmount,
          requestedAmount: contractRefundTotal
        });
      }

      directRefundAmount = contractRefundTotal;
    }

    // 계약 결제에서 차감할 총액 (계약 상품 + INITIAL 렌탈 — 같은 결제건)
    const contractRefundAmount = (refundType === 'PARTIAL_ITEMS')
      ? (Object.values(contractItems).reduce((s, v) => s + v, 0) + rentalItemsRefundAmount)
      : directRefundAmount;

    const totalRefundAmount = contractRefundAmount;

    // ── DB 업데이트 ──

    // 1) Payment 잔액 차감
    const newContractBalance = payment.balanceAmount - contractRefundAmount;
    const newContractStatus = newContractBalance === 0 ? 'CANCELED' : 'PARTIAL_CANCELED';

    await payment.update({
      balanceAmount: newContractBalance,
      status: newContractStatus
    }, { transaction });

    // 2) AdminRefund 기록
    const adminRefund = await AdminRefund.create({
      contractId,
      adminId,
      refundType,
      refundAmount:                directRefundAmount,
      rentalFeeRefundAmount:       contractItems.rentalFee,
      maintenanceFeeRefundAmount:  contractItems.maintenanceFee,
      cleaningFeeRefundAmount:     contractItems.cleaningFee,
      platformFeeRefundAmount:     contractItems.platformFee,
      depositRefundAmount:         contractItems.deposit,
      rentalItemsRefundAmount,
      totalRefundAmount,
      finalRefundAmount:           totalRefundAmount,
      originalRentalFee:           contract.rentalFee      || 0,
      originalMaintenanceFee:      contract.maintenanceFee || 0,
      originalCleaningFee:         contract.cleaningFee    || 0,
      originalPlatformFee:         contract.platformFee    || 0,
      originalDeposit:             contract.deposit        || 0,
      originalTotalAmount:         payment.totalAmount,
      refundStatus:                'COMPLETED',
      refundMethod:                'ORIGINAL_PAYMENT',
      refundReason,
      adminNotes:                  `관리자(ID:${adminId}) 직접 환불 처리`,
      completedAt:                 now
    }, { transaction });

    // 3) INITIAL 렌탈 아이템 DB 반영 (PG 추가 호출 없음 — 계약 결제에 포함)
    if (rentalItemsToCancel.length > 0 && initialRentalOrder) {
      for (const { orderItem, refundAmount: itemAmt } of rentalItemsToCancel) {
        await orderItem.update({
          status: 'CANCELLED',
          cancelledAt: now,
          cancelReason: `[관리자] ${refundReason}`,
          refundAmount: itemAmt
        }, { transaction });
      }

      const newRentalRefunded = parseFloat(initialRentalOrder.refundedAmount || 0) + rentalItemsRefundAmount;
      const newRentalStatus = newRentalRefunded >= parseFloat(initialRentalOrder.paidAmount)
        ? 'FULLY_REFUNDED'
        : 'PARTIAL_REFUND';

      await initialRentalOrder.update({
        refundedAmount: newRentalRefunded,
        status: newRentalStatus
      }, { transaction });
    }

    // 4) PG 취소 (계약 결제 한 번 — INITIAL 렌탈 금액 포함)
    const { orderno, orgpaydate, orgtranamt, loginid } = paytagClient.extractCancelParams(payment);
    const canceltype = newContractBalance === 0 ? '0' : '1';
    let pgReceiptUrl = null;

    try {
      const pgResponse = await paytagClient.cancelPayment({
        orderno, orgpaydate, orgtranamt, loginid,
        cancelamt: contractRefundAmount,
        canceltype
      });
      pgReceiptUrl = pgResponse?.receipt_url || null;
      await adminRefund.update({ pgResponse }, { transaction });
    } catch (pgErr) {
      await transaction.rollback();
      if (pgErr.paytagErrorCode === '1023') {
        return error(res, { code: 4901, message: '이미 취소 완료된 결제입니다.', pgErrorCode: pgErr.paytagErrorCode }, 400);
      }
      if (pgErr.paytagErrorCode === '1021') {
        return error(res, { code: 4902, message: 'PG사에서 취소를 거부했습니다.', pgErrorCode: pgErr.paytagErrorCode }, 400);
      }
      console.error('계약 PayTag 취소 오류:', pgErr.message);
      return error(res, { code: 4900, message: `PG 취소 실패: ${pgErr.paytagErrorMessage || pgErr.message}`, pgErrorCode: pgErr.paytagErrorCode }, 502);
    }

    await transaction.commit();

    // 환불 후 계약 상태가 활성이면 경고
    const activeStatuses = ['PAYMENT_COMPLETED', 'IN_PROGRESS'];
    const warning = activeStatuses.includes(contract.status)
      ? '환불 처리 완료. 계약 상태가 아직 활성 상태입니다. 계약 관리에서 상태를 확인하세요.'
      : null;

    return success(res, {
      adminRefundId: adminRefund.id,
      refundType,
      totalRefundAmount,
      paymentStatus: newContractStatus,
      pgReceiptUrl,
      ...(refundType === 'PARTIAL_ITEMS' && { contractItems }),
      ...(rentalItemsToCancel.length > 0 && {
        cancelledRentalItems: rentalItemsToCancel.map(({ orderItem, refundAmount: a }) => ({
          id: orderItem.id,
          name: orderItem.rentalItem?.name,
          refundAmount: a
        }))
      }),
      ...(warning && { warning })
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
      if (startDate) filter[Op.gte] = new Date(startDate + 'T00:00:00');
      if (endDate) {
        const end = new Date(endDate + 'T00:00:00');
        end.setHours(23, 59, 59, 999);
        filter[Op.lte] = end;
      }
      return { [field]: filter };
    };

    // === 1) payments 테이블 결제 (CONTRACT + HOST_BURDEN) ===
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
          { model: User, as: 'host', attributes: ['id', 'name'] },
          { model: Room, as: 'room', attributes: ['id', 'roomName'] }
        ]
      }],
      order: [['approvedAt', safeSortOrder]]
    });

    const paymentLogs = contractPayments.map(p => {
      const isHostBurden = p.paymentType === 'HOST_BURDEN';
      return {
        occurredAt: p.approvedAt || p.createdAt,
        transactionType: '결제완료',
        paymentMethod: p.method,
        easyPayProvider: p.easyPayProvider || null,
        productType: isHostBurden ? '호스트부담금' : '계약',
        amount: p.totalAmount,
        orderId: p.contract?.orderId || null,
        userName: isHostBurden
          ? (p.contract?.host?.name || null)
          : (p.contract?.guest?.name || null),
        userType: isHostBurden ? '호스트' : '게스트',
        roomName: p.contract?.room?.roomName || null
      };
    });

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
          attributes: ['id', 'orderId', 'orderType'],
          where: { orderType: { [Op.ne]: 'INITIAL' } },
          required: true,
          include: [{
            model: RentalPayment,
            as: 'payment',
            attributes: ['method', 'easyPayProvider'],
            required: false
          }]
        }
      ],
      order: [['createdAt', safeSortOrder]]
    });

    const rentalEventLogs = rentalLogs.map(log => {
      const isPayment = log.action === 'PAYMENT_COMPLETED';
      return {
        occurredAt: log.createdAt,
        transactionType: isPayment ? '결제완료' : '부분취소',
        paymentMethod: log.order?.payment?.method || null,
        easyPayProvider: log.order?.payment?.easyPayProvider || null,
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
      productType = '',
      sortOrder = 'DESC'
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const safeSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const contractStatusLabels = {
      PAYMENT_COMPLETED: '결제 완료',
      IN_PROGRESS: '입주중',
      COMPLETED: '계약 종료',
      CANCELLED: '계약 취소',
      CANCEL_REQUESTED: '취소 요청중',
      REFUNDED: '환불 완료',
      CANCELLED_BY_ADMIN_WITH_REFUND: '관리자 취소(환불)',
      CANCELLED_BY_ADMIN_NO_REFUND: '관리자 취소',
      CANCELLED_BY_HOST: '호스트 취소'
    };

    // 날짜 필터 헬퍼
    const buildDateRange = (field) => {
      if (!startDate && !endDate) return {};
      const filter = {};
      if (startDate) filter[Op.gte] = new Date(startDate + 'T00:00:00');
      if (endDate) {
        const end = new Date(endDate + 'T00:00:00');
        end.setHours(23, 59, 59, 999);
        filter[Op.lte] = end;
      }
      return { [field]: filter };
    };

    // ── 1) 계약 결제 행 ──
    const contractWhere = {
      status: { [Op.in]: ['PAYMENT_COMPLETED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED',
        'CANCEL_REQUESTED', 'REFUNDED', 'CANCELLED_BY_ADMIN_WITH_REFUND',
        'CANCELLED_BY_ADMIN_NO_REFUND', 'CANCELLED_BY_HOST'] },
      paidAt: { [Op.ne]: null },
      ...buildDateRange('paidAt')
    };

    const contractInclude = [
      { model: User, as: 'guest', attributes: ['id', 'name'] },
      { model: Room, as: 'room', attributes: ['id', 'roomName'] },
      {
        model: Payment,
        as: 'payment',
        attributes: ['id', 'method', 'easyPayProvider', 'status', 'totalAmount', 'balanceAmount'],
        where: { paymentType: 'CONTRACT' },
        required: false
      },
      {
        model: Refund,
        as: 'refunds',
        attributes: ['id', 'finalRefundAmount'],
        where: { refundStatus: 'COMPLETED' },
        required: false
      },
      {
        model: AdminRefund,
        as: 'adminRefunds',
        attributes: ['id', 'totalRefundAmount'],
        where: { refundStatus: 'COMPLETED' },
        required: false
      }
    ];

    // 검색 조건
    if (search) {
      if (/^S?\d{6,}/i.test(search)) {
        contractWhere.orderId = { [Op.like]: `%${search}%` };
      } else if (/^[\d-]{10,}$/.test(search)) {
        contractInclude[0] = {
          ...contractInclude[0],
          where: { phoneNumber: { [Op.like]: `%${search.replace(/-/g, '')}%` } },
          required: true
        };
      } else {
        contractInclude[0] = {
          ...contractInclude[0],
          where: { name: { [Op.like]: `%${search}%` } },
          required: true
        };
      }
    }

    const contracts = await Contract.findAll({
      where: contractWhere,
      include: contractInclude,
      order: [['paidAt', safeSortOrder]]
    });

    const contractRows = contracts.map(contract => {
      const paidAmount = parseFloat(contract.finalTotalAmount) || 0;
      const guestRefundTotal = (contract.refunds || [])
        .reduce((sum, r) => sum + (parseFloat(r.finalRefundAmount) || 0), 0);
      const adminRefundTotal = (contract.adminRefunds || [])
        .reduce((sum, r) => sum + (parseFloat(r.totalRefundAmount) || 0), 0);
      const refundedAmount = guestRefundTotal + adminRefundTotal;

      return {
        rowType: 'CONTRACT',
        contractId: contract.id,
        rentalOrderId: null,
        orderId: contract.orderId,
        paidAt: contract.paidAt,
        productType: '계약',
        roomName: contract.room?.roomName || null,
        userName: contract.guest?.name || null,
        paymentMethod: contract.payment?.method || contract.paymentMethod || null,
        easyPayProvider: contract.payment?.easyPayProvider || null,
        paidAmount,
        refundedAmount,
        currentBalance: paidAmount - refundedAmount,
        paymentStatus: contract.payment?.status || null,
        contractStatus: contract.status,
        contractStatusLabel: contractStatusLabels[contract.status] || contract.status
      };
    });

    // ── 2) ADDITIONAL 렌탈 결제 행 ──
    const rentalWhere = {
      orderType: 'ADDITIONAL',
      status: { [Op.in]: ['PAID', 'PARTIAL_REFUND', 'FULLY_REFUNDED'] },
      paidAt: { [Op.ne]: null },
      ...buildDateRange('paidAt')
    };

    const rentalInclude = [
      {
        model: Contract,
        as: 'contract',
        attributes: ['id', 'orderId', 'status'],
        include: [
          { model: User, as: 'guest', attributes: ['id', 'name'] },
          { model: Room, as: 'room', attributes: ['id', 'roomName'] }
        ]
      },
      {
        model: RentalPayment,
        as: 'payment',
        attributes: ['id', 'method', 'easyPayProvider', 'status', 'totalAmount', 'balanceAmount'],
        required: false
      }
    ];

    // 검색 — 렌탈 주문번호 또는 계약 게스트명
    let rentalOrders = await RentalOrder.findAll({
      where: rentalWhere,
      include: rentalInclude,
      order: [['paidAt', safeSortOrder]]
    });

    // 검색어 후처리 (게스트명/주문번호)
    if (search) {
      if (/^S?\d{6,}/i.test(search)) {
        rentalOrders = rentalOrders.filter(ro =>
          ro.orderId?.includes(search) || ro.contract?.orderId?.includes(search)
        );
      } else if (!/^[\d-]{10,}$/.test(search)) {
        rentalOrders = rentalOrders.filter(ro =>
          ro.contract?.guest?.name?.includes(search)
        );
      } else {
        rentalOrders = [];
      }
    }

    const rentalRows = rentalOrders.map(ro => {
      const paidAmount = parseFloat(ro.paidAmount) || 0;
      const refundedAmount = parseFloat(ro.refundedAmount) || 0;

      return {
        rowType: 'RENTAL',
        contractId: ro.contractId,
        rentalOrderId: ro.orderId,
        orderId: ro.orderId,
        paidAt: ro.paidAt,
        productType: '렌탈',
        roomName: ro.contract?.room?.roomName || null,
        userName: ro.contract?.guest?.name || null,
        paymentMethod: ro.payment?.method || ro.paymentMethod || null,
        easyPayProvider: ro.payment?.easyPayProvider || null,
        paidAmount,
        refundedAmount,
        currentBalance: paidAmount - refundedAmount,
        paymentStatus: ro.payment?.status || null,
        contractStatus: ro.contract?.status || null,
        contractStatusLabel: contractStatusLabels[ro.contract?.status] || ro.contract?.status || null
      };
    });

    // ── 3) 합산, 필터, 정렬, 페이지네이션 ──
    let allRows = [...contractRows, ...rentalRows];

    // 상품 구분 필터
    if (productType) {
      allRows = allRows.filter(r => r.productType === productType);
    }

    // paidAt 정렬
    allRows.sort((a, b) => {
      const da = new Date(a.paidAt);
      const db = new Date(b.paidAt);
      return safeSortOrder === 'DESC' ? db - da : da - db;
    });

    const total = allRows.length;
    const startIdx = (pageNum - 1) * limitNum;
    const payments = allRows.slice(startIdx, startIdx + limitNum);

    return success(res, {
      payments,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    }, '주문별 결제 현황 조회 성공');

  } catch (err) {
    console.error('결제/취소 내역 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 관리자 렌탈 추가결제 환불 처리 (ADDITIONAL 렌탈 주문 전용)
 * POST /api/admin/rental-payments/:rentalOrderId/refund
 *
 * Request Body:
 * {
 *   refundType: 'FULL' | 'PARTIAL_ITEMS',
 *   refundReason: string,
 *   items: [                        // PARTIAL_ITEMS 시 필수
 *     { rentalOrderItemId: number, refundAmount: number }
 *   ]
 * }
 */
exports.processAdminRentalRefund = async (req, res) => {
  try {
    const { rentalOrderId } = req.params;
    const { refundType, refundReason, items = [] } = req.body;
    const adminId = req.admin.id;

    // 필수 입력 검증
    if (!refundReason) {
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, { field: 'refundReason' });
    }
    if (!['FULL', 'PARTIAL_ITEMS'].includes(refundType)) {
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, {
        field: 'refundType',
        message: 'refundType은 FULL, PARTIAL_ITEMS 중 하나여야 합니다.'
      });
    }

    // ── 1단계: 트랜잭션 없이 조회 및 금액 산정 ──
    const rentalOrder = await RentalOrder.findOne({ where: { orderId: rentalOrderId } });

    if (!rentalOrder) {
      return error(res, ErrorCodes.RENTAL_ORDER_NOT_FOUND, 404);
    }
    if (['FULLY_REFUNDED', 'CANCELLED'].includes(rentalOrder.status)) {
      return error(res, ErrorCodes.RENTAL_ORDER_ALREADY_CANCELLED, 400);
    }

    const rentalPayment = await RentalPayment.findOne({
      where: {
        rentalOrderId: rentalOrder.id,
        status: { [Op.in]: ['DONE', 'PARTIAL_CANCELED'] }
      }
    });

    if (!rentalPayment) {
      return error(res, ErrorCodes.PAYMENT_NOT_FOUND, 404);
    }

    const availableBalance = parseFloat(rentalPayment.balanceAmount);
    let finalRefundAmount = 0;
    let itemsToCancel = [];

    if (refundType === 'FULL') {
      finalRefundAmount = availableBalance;
      const activeItems = await RentalOrderItem.findAll({
        where: { rentalOrderId: rentalOrder.id, status: { [Op.ne]: 'CANCELLED' } },
        include: [{ model: RentalItem, as: 'rentalItem', attributes: ['id', 'name'] }]
      });
      itemsToCancel = activeItems.map(i => ({ orderItem: i, refundAmount: parseFloat(i.totalPrice) }));

    } else {
      // PARTIAL_ITEMS
      if (!Array.isArray(items) || items.length === 0) {
        return error(res, ErrorCodes.VALIDATION_ERROR, 400, {
          field: 'items', message: 'PARTIAL_ITEMS 유형은 items 배열이 필요합니다.'
        });
      }
      for (const item of items) {
        const orderItem = await RentalOrderItem.findOne({
          where: { id: item.rentalOrderItemId, rentalOrderId: rentalOrder.id },
          include: [{ model: RentalItem, as: 'rentalItem', attributes: ['id', 'name'] }]
        });
        if (!orderItem) {
          return error(res, ErrorCodes.VALIDATION_ERROR, 400, {
            field: 'items', message: `rentalOrderItemId(${item.rentalOrderItemId})를 찾을 수 없습니다.`
          });
        }
        if (orderItem.status === 'CANCELLED') {
          return error(res, ErrorCodes.VALIDATION_ERROR, 400, {
            field: 'items', message: `rentalOrderItemId(${item.rentalOrderItemId})는 이미 취소된 아이템입니다.`
          });
        }
        const itemRefundAmount = Math.max(0, parseInt(item.refundAmount || 0, 10));
        if (itemRefundAmount <= 0) {
          return error(res, ErrorCodes.VALIDATION_ERROR, 400, {
            field: 'items', message: `rentalOrderItemId(${item.rentalOrderItemId}) 환불 금액은 0보다 커야 합니다.`
          });
        }
        if (itemRefundAmount > parseFloat(orderItem.totalPrice)) {
          return error(res, ErrorCodes.VALIDATION_ERROR, 400, {
            field: 'items',
            message: `rentalOrderItemId(${item.rentalOrderItemId}) 환불 금액(${itemRefundAmount}원)이 아이템 금액(${orderItem.totalPrice}원)을 초과합니다.`
          });
        }
        finalRefundAmount += itemRefundAmount;
        itemsToCancel.push({ orderItem, refundAmount: itemRefundAmount });
      }
      if (finalRefundAmount > availableBalance) {
        return error(res, ErrorCodes.REFUND_EXCEEDS_BALANCE, 400, {
          balanceAmount: availableBalance, requestedAmount: finalRefundAmount
        });
      }
    }

    const newBalance = availableBalance - finalRefundAmount;
    const newPaymentStatus = newBalance === 0 ? 'CANCELED' : 'PARTIAL_CANCELED';
    const newRefundedAmount = parseFloat(rentalOrder.refundedAmount || 0) + finalRefundAmount;
    const newOrderStatus = newRefundedAmount >= parseFloat(rentalOrder.paidAmount)
      ? 'FULLY_REFUNDED' : 'PARTIAL_REFUND';
    const canceltype = newBalance === 0 ? '0' : '1';

    // ── 2단계: PG 취소 먼저 (트랜잭션 밖) ──
    const { orderno, orgpaydate, orgtranamt, loginid } = paytagClient.extractCancelParams(rentalPayment);
    let pgCancelResp;
    try {
      pgCancelResp = await paytagClient.cancelPayment({
        orderno, orgpaydate, orgtranamt, loginid,
        cancelamt: finalRefundAmount,
        canceltype
      });
    } catch (pgErr) {
      if (pgErr.paytagErrorCode === '1023') {
        return error(res, { code: 4901, message: '이미 취소 완료된 결제입니다.', pgErrorCode: pgErr.paytagErrorCode }, 400);
      }
      if (pgErr.paytagErrorCode === '1021') {
        return error(res, { code: 4902, message: 'PG사에서 취소를 거부했습니다.', pgErrorCode: pgErr.paytagErrorCode }, 400);
      }
      console.error('렌탈 추가결제 PayTag 취소 오류:', pgErr.message);
      return error(res, { code: 4900, message: `PG 취소 실패: ${pgErr.paytagErrorMessage || pgErr.message}`, pgErrorCode: pgErr.paytagErrorCode }, 502);
    }

    // ── 3단계: PG 성공 후 DB 업데이트 (짧은 트랜잭션) ──
    const transaction = await sequelize.transaction();
    try {
      const now = new Date();

      for (const { orderItem, refundAmount: itemAmt } of itemsToCancel) {
        await orderItem.update({
          status: 'CANCELLED',
          cancelledAt: now,
          cancelReason: `[관리자] ${refundReason}`,
          refundAmount: itemAmt
        }, { transaction });
      }

      await rentalOrder.update({
        refundedAmount: newRefundedAmount,
        status: newOrderStatus
      }, { transaction });

      await rentalPayment.update({
        balanceAmount: newBalance,
        status: newPaymentStatus
      }, { transaction });

      await transaction.commit();
    } catch (dbErr) {
      await transaction.rollback();
      console.error('렌탈 환불 DB 업데이트 오류 (PG는 이미 취소됨):', dbErr);
      return error(res, { code: 4903, message: 'PG 취소는 완료됐으나 DB 업데이트에 실패했습니다. 관리자에게 문의하세요.' }, 500);
    }

    // ── 4단계: 트랜잭션 커밋 후 로그 기록 (락 범위 최소화) ──
    try {
      await logRentalAction({
        contractId: rentalOrder.contractId,
        rentalOrderId: rentalOrder.id,
        action: 'ADMIN_REFUND',
        actor: 'ADMIN',
        actorId: adminId,
        description: `관리자 환불 처리 (${refundType}): ${finalRefundAmount}원`,
        metadata: {
          refundType,
          refundAmount: finalRefundAmount,
          refundReason,
          adminId,
          cancelledItems: itemsToCancel.map(({ orderItem, refundAmount: itemAmt }) => ({
            id: orderItem.id,
            name: orderItem.rentalItem?.name,
            refundAmount: itemAmt
          })),
          pgResponse: pgCancelResp
        }
      });
    } catch (logErr) {
      console.error('렌탈 환불 로그 기록 실패 (환불은 완료됨):', logErr);
    }

    return success(res, {
      rentalOrderId,
      refundType,
      refundAmount: finalRefundAmount,
      orderStatus: newOrderStatus,
      paymentStatus: newPaymentStatus,
      ...(itemsToCancel.length > 0 && {
        cancelledItems: itemsToCancel.map(({ orderItem, refundAmount: itemAmt }) => ({
          id: orderItem.id,
          name: orderItem.rentalItem?.name,
          refundAmount: itemAmt
        }))
      })
    }, '렌탈 추가결제 환불이 처리되었습니다.');

  } catch (err) {
    console.error('관리자 렌탈 추가결제 환불 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

// =====================================================
// 옵션상품 환불 요청 관리 API
// =====================================================

const RETRIEVAL_SHIPPING_COST = 7000; // 수거 배송비

/**
 * 환불 요청 목록 조회
 * GET /api/admin/rental-refund-requests
 * Query: status, contractId, page, limit
 */
exports.getRentalRefundRequests = async (req, res) => {
  try {
    const {
      status = '',
      contractId = '',
      page = 1,
      limit = 20,
      sortOrder = 'DESC'
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const safeSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const where = {};
    if (status) where.status = status;
    if (contractId) where.contractId = parseInt(contractId);

    const { count, rows } = await RentalOrderRefundRequest.findAndCountAll({
      where,
      include: [
        {
          model: RentalOrder,
          as: 'rentalOrder',
          attributes: ['id', 'orderId', 'status', 'deliveryStatus', 'totalAmount', 'paidAmount', 'refundedAmount'],
          include: [
            {
              model: RentalOrderItem,
              as: 'items',
              include: [{ model: RentalItem, as: 'rentalItem', attributes: ['id', 'name', 'imageUrl'] }]
            }
          ]
        },
        {
          model: Contract,
          as: 'contract',
          attributes: ['id', 'orderId', 'status'],
          include: [
            { model: User, as: 'guest', attributes: ['id', 'name', 'nickname', 'phoneNumber'] }
          ]
        }
      ],
      order: [['createdAt', safeSortOrder]],
      limit: limitNum,
      offset: (pageNum - 1) * limitNum
    });

    return success(res, {
      total: count,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(count / limitNum),
      items: rows.map(r => ({
        id: r.id,
        status: r.status,
        statusLabel: RentalOrderRefundRequest.STATUS_LABELS[r.status] || r.status,
        deliveryStatusSnapshot: r.deliveryStatusSnapshot,
        itemTotalAmount: r.itemTotalAmount,
        shippingDeduction: r.shippingDeduction,
        finalRefundAmount: r.finalRefundAmount,
        retrievalStatus: r.retrievalStatus,
        retrievalStatusLabel: r.retrievalStatus
          ? RentalOrderRefundRequest.RETRIEVAL_STATUS_LABELS[r.retrievalStatus]
          : null,
        cancelReason: r.cancelReason,
        rejectReason: r.rejectReason,
        processedAt: r.processedAt,
        createdAt: r.createdAt,
        rentalOrder: r.rentalOrder ? {
          id: r.rentalOrder.id,
          orderId: r.rentalOrder.orderId,
          status: r.rentalOrder.status,
          deliveryStatus: r.rentalOrder.deliveryStatus,
          items: (r.rentalOrder.items || []).map(item => ({
            id: item.id,
            name: item.rentalItem?.name || null,
            quantity: item.quantity,
            totalPrice: parseFloat(item.totalPrice),
            status: item.status
          }))
        } : null,
        contract: r.contract ? {
          id: r.contract.id,
          orderId: r.contract.orderId,
          status: r.contract.status,
          guest: r.contract.guest || null
        } : null
      }))
    });
  } catch (err) {
    console.error('환불 요청 목록 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 환불 요청 상세 조회
 * GET /api/admin/rental-refund-requests/:requestId
 */
exports.getRentalRefundRequestDetail = async (req, res) => {
  try {
    const { requestId } = req.params;

    const refundRequest = await RentalOrderRefundRequest.findByPk(requestId, {
      include: [
        {
          model: RentalOrder,
          as: 'rentalOrder',
          include: [
            {
              model: RentalOrderItem,
              as: 'items',
              include: [{ model: RentalItem, as: 'rentalItem', attributes: ['id', 'name', 'price', 'imageUrl'] }]
            },
            { model: RentalPayment, as: 'payment', required: false }
          ]
        },
        {
          model: Contract,
          as: 'contract',
          attributes: ['id', 'orderId', 'status', 'checkInDate', 'checkOutDate'],
          include: [
            { model: User, as: 'guest', attributes: ['id', 'name', 'nickname', 'email', 'phoneNumber'] }
          ]
        }
      ]
    });

    if (!refundRequest) {
      return error(res, { code: 4430, message: '환불 요청을 찾을 수 없습니다.' }, 404);
    }

    // 같은 계약 내 RETRIEVAL_PENDING 건 조회 (7000원 차감 여부 판단용 참고 정보)
    const pendingRetrievalCount = await RentalOrderRefundRequest.count({
      where: {
        contractId: refundRequest.contractId,
        id: { [Op.ne]: refundRequest.id },
        retrievalStatus: 'RETRIEVAL_PENDING'
      }
    });

    return success(res, {
      id: refundRequest.id,
      status: refundRequest.status,
      statusLabel: RentalOrderRefundRequest.STATUS_LABELS[refundRequest.status],
      deliveryStatusSnapshot: refundRequest.deliveryStatusSnapshot,
      itemTotalAmount: refundRequest.itemTotalAmount,
      shippingDeduction: refundRequest.shippingDeduction,
      finalRefundAmount: refundRequest.finalRefundAmount,
      retrievalStatus: refundRequest.retrievalStatus,
      retrievalStatusLabel: refundRequest.retrievalStatus
        ? RentalOrderRefundRequest.RETRIEVAL_STATUS_LABELS[refundRequest.retrievalStatus]
        : null,
      retrievalStartedAt: refundRequest.retrievalStartedAt,
      retrievalCompletedAt: refundRequest.retrievalCompletedAt,
      cancelReason: refundRequest.cancelReason,
      rejectReason: refundRequest.rejectReason,
      adminId: refundRequest.adminId,
      processedAt: refundRequest.processedAt,
      createdAt: refundRequest.createdAt,
      // 7000원 차감 면제 가능 여부 (같은 계약에 RETRIEVAL_PENDING이 있으면 면제)
      shippingDeductionWaivable: pendingRetrievalCount > 0,
      rentalOrder: refundRequest.rentalOrder ? {
        id: refundRequest.rentalOrder.id,
        orderId: refundRequest.rentalOrder.orderId,
        status: refundRequest.rentalOrder.status,
        deliveryStatus: refundRequest.rentalOrder.deliveryStatus,
        totalAmount: parseFloat(refundRequest.rentalOrder.totalAmount),
        paidAmount: parseFloat(refundRequest.rentalOrder.paidAmount),
        refundedAmount: parseFloat(refundRequest.rentalOrder.refundedAmount),
        items: (refundRequest.rentalOrder.items || []).map(item => ({
          id: item.id,
          name: item.rentalItem?.name || null,
          imageUrl: item.rentalItem?.imageUrl || null,
          quantity: item.quantity,
          pricePerItem: parseFloat(item.pricePerItem),
          totalPrice: parseFloat(item.totalPrice),
          status: item.status
        })),
        payment: refundRequest.rentalOrder.payment ? {
          balanceAmount: parseFloat(refundRequest.rentalOrder.payment.balanceAmount),
          status: refundRequest.rentalOrder.payment.status
        } : null
      } : null,
      contract: refundRequest.contract ? {
        id: refundRequest.contract.id,
        orderId: refundRequest.contract.orderId,
        status: refundRequest.contract.status,
        checkInDate: toKSTString(refundRequest.contract.checkInDate),
        checkOutDate: toKSTString(refundRequest.contract.checkOutDate),
        guest: refundRequest.contract.guest || null
      } : null
    });
  } catch (err) {
    console.error('환불 요청 상세 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 환불 요청 수락
 * POST /api/admin/rental-refund-requests/:requestId/approve
 * Body: { adminNotes? }
 */
exports.approveRentalRefundRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { adminNotes } = req.body;
    const adminId = req.admin?.id;

    const refundRequest = await RentalOrderRefundRequest.findByPk(requestId, {
      include: [
        {
          model: RentalOrder,
          as: 'rentalOrder',
          include: [
            {
              model: RentalOrderItem,
              as: 'items',
              include: [{ model: RentalItem, as: 'rentalItem', attributes: ['id', 'name'] }]
            },
            { model: RentalPayment, as: 'payment', required: false }
          ]
        }
      ]
    });

    if (!refundRequest) {
      return error(res, { code: 4430, message: '환불 요청을 찾을 수 없습니다.' }, 404);
    }
    if (refundRequest.status !== 'PENDING') {
      return error(res, { code: 4431, message: '이미 처리된 환불 요청입니다.' }, 400);
    }

    const rentalOrder = refundRequest.rentalOrder;
    if (!rentalOrder) {
      return error(res, { code: 4432, message: '렌탈 주문 정보를 찾을 수 없습니다.' }, 404);
    }

    const rentalPayment = rentalOrder.payment;
    if (!rentalPayment) {
      return error(res, { code: 4433, message: '결제 정보를 찾을 수 없습니다.' }, 404);
    }

    // 취소 요청 상태인 아이템만 처리
    const cancelRequestedItems = (rentalOrder.items || []).filter(i => i.status === 'CANCEL_REQUESTED');
    if (cancelRequestedItems.length === 0) {
      return error(res, { code: 4434, message: '취소 요청 상태인 아이템이 없습니다.' }, 400);
    }

    const itemTotalAmount = cancelRequestedItems.reduce((sum, i) => sum + parseFloat(i.totalPrice), 0);

    // 7000원 차감 여부 결정
    // 같은 계약 내 다른 건이 RETRIEVAL_PENDING이면 → 기사가 방문 예정이므로 배송비 면제
    const needsRetrieval = ['IN_TRANSIT', 'DELIVERED'].includes(refundRequest.deliveryStatusSnapshot);
    let shippingDeduction = 0;

    if (needsRetrieval) {
      const pendingRetrievalCount = await RentalOrderRefundRequest.count({
        where: {
          contractId: refundRequest.contractId,
          id: { [Op.ne]: refundRequest.id },
          retrievalStatus: 'RETRIEVAL_PENDING'
        }
      });
      shippingDeduction = pendingRetrievalCount > 0 ? 0 : RETRIEVAL_SHIPPING_COST;
    }

    const finalRefundAmount = itemTotalAmount - shippingDeduction;
    if (finalRefundAmount <= 0) {
      return error(res, { code: 4435, message: `환불 금액(${itemTotalAmount}원)이 수거비(${shippingDeduction}원) 이하입니다.` }, 400);
    }
    if (parseFloat(rentalPayment.balanceAmount) < finalRefundAmount) {
      return error(res, { code: 4436, message: `환불 가능 금액이 부족합니다. (가능: ${rentalPayment.balanceAmount}원, 요청: ${finalRefundAmount}원)` }, 400);
    }

    // PG 취소 (트랜잭션 밖)
    const { orderno, orgpaydate, orgtranamt, loginid } = paytagClient.extractCancelParams(rentalPayment);
    const newBalance = parseFloat(rentalPayment.balanceAmount) - finalRefundAmount;
    const canceltype = newBalance === 0 ? '0' : '1';

    let pgCancelResp;
    try {
      pgCancelResp = await paytagClient.cancelPayment({
        orderno, orgpaydate, orgtranamt, loginid,
        cancelamt: finalRefundAmount,
        canceltype
      });
    } catch (pgErr) {
      if (pgErr.paytagErrorCode === '1023') {
        return error(res, { code: 4901, message: '이미 취소 완료된 결제입니다.', pgErrorCode: pgErr.paytagErrorCode }, 400);
      }
      if (pgErr.paytagErrorCode === '1021') {
        return error(res, { code: 4902, message: 'PG사에서 취소를 거부했습니다.', pgErrorCode: pgErr.paytagErrorCode }, 400);
      }
      console.error('환불 요청 수락 PG 오류:', pgErr.message);
      return error(res, { code: 4900, message: `PG 취소 실패: ${pgErr.paytagErrorMessage || pgErr.message}` }, 502);
    }

    // DB 업데이트
    const transaction = await sequelize.transaction();
    try {
      const now = new Date();

      // rental_order_items: CANCEL_REQUESTED → CANCELLED
      for (const item of cancelRequestedItems) {
        await item.update({
          status: 'CANCELLED',
          cancelledAt: now,
          refundAmount: parseFloat(item.totalPrice)
        }, { transaction });
      }

      // rental_payments 잔액 차감
      await rentalPayment.update({
        balanceAmount: newBalance,
        status: newBalance === 0 ? 'CANCELED' : 'PARTIAL_CANCELED'
      }, { transaction });

      // rental_orders 상태 업데이트
      const remainingActiveCount = await RentalOrderItem.count({
        where: { rentalOrderId: rentalOrder.id, status: 'ACTIVE' },
        transaction
      });
      await rentalOrder.update({
        refundedAmount: parseFloat(rentalOrder.refundedAmount || 0) + finalRefundAmount,
        status: remainingActiveCount === 0 ? 'FULLY_REFUNDED' : 'PARTIAL_REFUND'
      }, { transaction });

      // rental_item_reservations 취소
      await RentalItemReservation.update(
        { status: 'CANCELLED' },
        {
          where: {
            rentalOrderId: rentalOrder.id,
            status: { [Op.ne]: 'CANCELLED' }
          },
          transaction
        }
      );

      // 환불 요청 확정
      const newRetrievalStatus = needsRetrieval ? 'RETRIEVAL_PENDING' : null;
      await refundRequest.update({
        status: 'APPROVED',
        shippingDeduction,
        finalRefundAmount,
        retrievalStatus: newRetrievalStatus,
        adminId,
        processedAt: now
      }, { transaction });

      // 로그 기록
      await logRentalAction({
        contractId: refundRequest.contractId,
        rentalOrderId: rentalOrder.id,
        rentalOrderItemId: null,
        action: 'REFUND_COMPLETED',
        actor: 'ADMIN',
        actorId: adminId,
        amountChange: -finalRefundAmount,
        balanceAfter: newBalance,
        metadata: {
          orderId: rentalOrder.orderId,
          itemCount: cancelRequestedItems.length,
          itemTotalAmount,
          shippingDeduction,
          finalRefundAmount,
          deliveryStatusSnapshot: refundRequest.deliveryStatusSnapshot,
          retrievalStatus: newRetrievalStatus,
          adminNotes: adminNotes || null,
          pgResponse: pgCancelResp
        },
        description: shippingDeduction > 0
          ? `입주중 환불 요청 수락 (수거비 ${shippingDeduction}원 차감): ${refundRequest.cancelReason || ''}`
          : `입주중 환불 요청 수락: ${refundRequest.cancelReason || ''}`,
        req
      }, transaction);

      await transaction.commit();

      // 알림톡 발송 (옵션 결제 취소 → 게스트)
      const AlimtalkService = require('../services/alimtalkService');
      Contract.findByPk(refundRequest.contractId, {
        include: [{ model: User, as: 'guest', attributes: ['id', 'phoneNumber', 'name', 'nickname'] }]
      }).then(contract => {
        if (!contract?.guest) return;
        return Room.findByPk(contract.roomId, { attributes: ['id', 'roomName'] })
          .then(room => {
            const itemNames = cancelRequestedItems.map(i => i.rentalItem?.name || '').filter(Boolean).join(', ');
            return AlimtalkService.sendOptionPaymentCanceled(contract, contract.guest, room, {
              optionItems: itemNames,
              amount: finalRefundAmount
            });
          });
      }).catch(err => console.error('[Alimtalk] option_payment_canceled_guest 실패:', err.message));

      return success(res, {
        requestId: refundRequest.id,
        rentalOrderId: rentalOrder.id,
        orderId: rentalOrder.orderId,
        finalRefundAmount,
        shippingDeduction,
        itemTotalAmount,
        retrievalStatus: newRetrievalStatus,
        retrievalStatusLabel: newRetrievalStatus
          ? RentalOrderRefundRequest.RETRIEVAL_STATUS_LABELS[newRetrievalStatus]
          : null
      }, '환불 요청이 수락되었습니다.');
    } catch (dbErr) {
      await transaction.rollback();
      console.error('환불 요청 수락 DB 오류 (PG는 이미 취소됨):', dbErr);
      // PG는 이미 취소됐으나 DB 실패 → 트랜잭션 밖에서 별도 로그 저장
      try {
        await logRentalAction({
          contractId: refundRequest.contractId,
          rentalOrderId: refundRequest.rentalOrderId,
          rentalOrderItemId: null,
          action: 'PG_DB_MISMATCH',
          actor: 'ADMIN',
          actorId: adminId,
          amountChange: -finalRefundAmount,
          balanceAfter: null,
          metadata: {
            requestId: refundRequest.id,
            orderId: rentalOrder.orderId,
            finalRefundAmount,
            pgResponse: pgCancelResp,
            dbError: dbErr.message
          },
          description: `[긴급] PG 취소 완료 후 DB 업데이트 실패 - 수동 확인 필요`,
          req
        }, null);
      } catch (logErr) {
        console.error('PG-DB 불일치 로그 저장도 실패:', logErr);
      }
      return error(res, { code: 4903, message: 'PG 취소는 완료됐으나 DB 업데이트에 실패했습니다. 관리자에게 문의하세요.' }, 500);
    }
  } catch (err) {
    console.error('환불 요청 수락 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 환불 요청 거절
 * POST /api/admin/rental-refund-requests/:requestId/reject
 * Body: { rejectReason }
 */
exports.rejectRentalRefundRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { rejectReason } = req.body;
    const adminId = req.admin?.id;

    if (!rejectReason) {
      return error(res, { code: 4440, message: '거절 사유를 입력해주세요.' }, 400);
    }

    const refundRequest = await RentalOrderRefundRequest.findByPk(requestId, {
      include: [{
        model: RentalOrder,
        as: 'rentalOrder',
        include: [{ model: RentalOrderItem, as: 'items' }]
      }]
    });

    if (!refundRequest) {
      return error(res, { code: 4430, message: '환불 요청을 찾을 수 없습니다.' }, 404);
    }
    if (refundRequest.status !== 'PENDING') {
      return error(res, { code: 4431, message: '이미 처리된 환불 요청입니다.' }, 400);
    }

    const transaction = await sequelize.transaction();
    try {
      // rental_order_items: CANCEL_REQUESTED → ACTIVE (원복)
      const cancelRequestedItems = (refundRequest.rentalOrder?.items || []).filter(i => i.status === 'CANCEL_REQUESTED');
      for (const item of cancelRequestedItems) {
        await item.update({
          status: 'ACTIVE',
          cancelReason: null
        }, { transaction });
      }

      await refundRequest.update({
        status: 'REJECTED',
        rejectReason,
        adminId,
        processedAt: new Date()
      }, { transaction });

      await logRentalAction({
        contractId: refundRequest.contractId,
        rentalOrderId: refundRequest.rentalOrderId,
        rentalOrderItemId: null,
        action: 'REFUND_FAILED',
        actor: 'ADMIN',
        actorId: adminId,
        amountChange: 0,
        balanceAfter: 0,
        metadata: {
          requestId: refundRequest.id,
          rejectReason,
          restoredItemCount: cancelRequestedItems.length
        },
        description: `입주중 환불 요청 거절: ${rejectReason}`,
        req
      }, transaction);

      await transaction.commit();

      return success(res, {
        requestId: refundRequest.id,
        status: 'REJECTED',
        rejectReason,
        restoredItemCount: cancelRequestedItems.length
      }, '환불 요청이 거절되었습니다. 아이템 상태가 복원되었습니다.');
    } catch (dbErr) {
      await transaction.rollback();
      console.error('환불 요청 거절 DB 오류:', dbErr);
      return error(res, ErrorCodes.INTERNAL_ERROR, 500);
    }
  } catch (err) {
    console.error('환불 요청 거절 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 수거 상태 업데이트
 * PATCH /api/admin/rental-refund-requests/:requestId/retrieval
 * Body: { retrievalStatus: 'IN_RETRIEVAL' | 'RETRIEVED' }
 */
exports.updateRentalRefundRetrieval = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { retrievalStatus } = req.body;

    const VALID_TRANSITIONS = {
      RETRIEVAL_PENDING: ['IN_RETRIEVAL'],
      IN_RETRIEVAL: ['RETRIEVED']
    };

    if (!retrievalStatus) {
      return error(res, { code: 4450, message: 'retrievalStatus를 입력해주세요.' }, 400);
    }

    const refundRequest = await RentalOrderRefundRequest.findByPk(requestId);

    if (!refundRequest) {
      return error(res, { code: 4430, message: '환불 요청을 찾을 수 없습니다.' }, 404);
    }
    if (refundRequest.status !== 'APPROVED') {
      return error(res, { code: 4451, message: '수락된 환불 요청만 수거 상태를 변경할 수 있습니다.' }, 400);
    }
    if (!refundRequest.retrievalStatus) {
      return error(res, { code: 4452, message: '수거 대상이 아닌 환불 요청입니다.' }, 400);
    }

    const allowed = VALID_TRANSITIONS[refundRequest.retrievalStatus] || [];
    if (!allowed.includes(retrievalStatus)) {
      return error(res, {
        code: 4453,
        message: `현재 상태(${refundRequest.retrievalStatus})에서 ${retrievalStatus}(으)로 변경할 수 없습니다.`
      }, 400);
    }

    const now = new Date();
    const updateData = { retrievalStatus };
    if (retrievalStatus === 'IN_RETRIEVAL') updateData.retrievalStartedAt = now;
    if (retrievalStatus === 'RETRIEVED') updateData.retrievalCompletedAt = now;

    await refundRequest.update(updateData);

    return success(res, {
      requestId: refundRequest.id,
      retrievalStatus,
      retrievalStatusLabel: RentalOrderRefundRequest.RETRIEVAL_STATUS_LABELS[retrievalStatus],
      retrievalStartedAt: refundRequest.retrievalStartedAt,
      retrievalCompletedAt: retrievalStatus === 'RETRIEVED' ? now : null
    }, '수거 상태가 업데이트되었습니다.');
  } catch (err) {
    console.error('수거 상태 업데이트 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};
