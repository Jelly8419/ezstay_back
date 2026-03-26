const { sequelize, Contract, Room, User, RoomPhoto, ChatRoom, Refund, RefundPolicyType, RefundPolicyRule, ContractStatusLog, Payment, PaymentFailureLog, RentalOrder, RentalOrderItem, RentalItemReservation, RentalItem, Settlement, Payout, DepositAgreement } = require('../models');
const { Op } = require('sequelize');
const { success, error, created, updated, ErrorCodes } = require('../utils/responseHelper');
const paytagClient = require('../utils/paytagClient');
const {
  calculateRentalItemsFee,
  calculateDiscount,
  calculateCleaningFee,
  validateRentalItemsStock,
  reserveRentalItems,
  cancelRentalItemReservations,
  validateDates
} = require('../utils/contractHelper');
const { createChatRoomMetadata, sendSystemMessage } = require('../config/firebaseAdmin');
const { SystemMessageTypes, getSystemMessageTemplate } = require('../utils/systemMessageTypes');
const appConfig = require('../config/app.config');
const { toAbsoluteUrl } = require('../utils/urlHelper');
const { calculateRefund } = require('../utils/refundCalculator');
const { generateOrderId } = require('../utils/orderIdGenerator');
const { sendContractConfirmedMessages } = require('../schedulers/autoMessageScheduler');
const {
  createInitialRentalOrder,
  confirmRentalOrderPayment,
  getContractRentalSummary
} = require('../utils/rentalOrderHelper');
const NotificationService = require('../services/notificationService');
const { CANCEL_TYPES } = require('../utils/notificationMessages');
const { calculateSettlementDate, calculatePayoutAvailableDate, calculateSettlementAmount } = require('../services/settlementService');

/**
 * 계약 요청 생성 (게스트 -> 호스트)
 * POST /api/contracts
 */
const createContractRequest = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const {
      roomId,
      checkInDate,
      checkOutDate,
      totalDays,
      rentalFee,
      maintenanceFee,
      cleaningFee,
      rentalItemsFee,
      platformFee,
      discountAmount,
      subtotal,
      totalUsageFee,
      deposit,
      finalTotalAmount,
      rentalItems,
      guestMessage,
      discountType,
      paymentMethod,
      installmentMonths,
      termsAgreed,
      specialRequests,
      pricingSnapshot
    } = req.body;

    const guestId = req.user.id;

    // 1. 필수 필드 검증
    if (!roomId || !checkInDate || !checkOutDate || !totalDays || !termsAgreed) {
      await transaction.rollback();
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400);
    }

    // 2. 약관 동의 확인
    if (!termsAgreed.serviceTerms || !termsAgreed.cancellationPolicy || !termsAgreed.refundPolicy) {
      await transaction.rollback();
      return error(
        res,
        { code: 4301, message: '필수 약관에 모두 동의해야 합니다' },
        400
      );
    }

    // 3. 방 존재 및 상태 확인 (이지서비스 정보 포함)
    const { EzService } = require('../models');
    const room = await Room.findOne({
      where: { id: roomId, status: 'published' },
      include: [
        {
          model: EzService,
          as: 'ezService'
        }
      ],
      transaction
    });

    if (!room) {
      await transaction.rollback();
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    // 자기 자신의 방은 예약할 수 없음
    if (room.hostId === guestId) {
      await transaction.rollback();
      return error(
        res,
        { code: 4302, message: '자신의 방은 예약할 수 없습니다' },
        400
      );
    }

    // 3-1. 방 정보 스냅샷 (계약 시점의 방 상태 보존, 분쟁 대비)
    const roomSnapshot = {
      roomId: room.id,
      roomName: room.roomName,
      address: room.address,
      detailAddress: room.detailAddress,
      buildingType: room.buildingType,
      floor: room.floor,
      area: room.area,
      roomCount: room.roomCount,
      bathroomCount: room.bathroomCount,
      isDuplex: room.isDuplex,
      elevatorAvailable: room.elevatorAvailable,
      parkingAvailable: room.parkingAvailable,
      parkingInfo: room.parkingInfo,
      maxGuests: room.maxGuests,
      description: room.description,
      dailyRent: room.dailyRent,
      dailyMaintenanceFee: room.dailyMaintenanceFee,
      maintenanceDetail: room.maintenanceDetail,
      includeElectricity: room.includeElectricity,
      includeWater: room.includeWater,
      includeGas: room.includeGas,
      includeInternet: room.includeInternet,
      cleaningFee: room.cleaningFee,
      longTermWeeks: room.longTermWeeks,
      longTermDiscount: room.longTermDiscount,
      quickMoveIn: room.quickMoveIn,
      quickMoveInDiscount: room.quickMoveInDiscount,
      minContractDays: room.minContractDays,
      refundPolicy: room.refundPolicy,
      checkInTime: room.checkInTime,
      checkOutTime: room.checkOutTime,
      ezService: room.ezService ? {
        cleaningService: room.ezService.cleaningService,
      } : null,
      capturedAt: new Date().toISOString()
    };

    // 3-2. 환불정책 스냅샷 조회 (계약 시점의 정책 보존)
    let refundPolicySnapshot = null;
    if (room.refundPolicy) {
      const policyType = await RefundPolicyType.findOne({
        where: { policyType: room.refundPolicy, isActive: true },
        transaction
      });

      const policyRules = await RefundPolicyRule.findAll({
        where: { policyType: room.refundPolicy },
        order: [['daysBeforeMin', 'DESC']],
        transaction
      });

      if (policyType) {
        refundPolicySnapshot = {
          policyType: policyType.policyType,
          displayName: policyType.displayName,
          description: policyType.description,
          specialRules: policyType.specialRules,
          rules: policyRules.map(rule => ({
            daysBeforeMin: rule.daysBeforeMin,
            daysBeforeMax: rule.daysBeforeMax,
            refundRate: parseFloat(rule.refundRate),
            isSameDayCancellation: rule.isSameDayCancellation,
            description: rule.description
          })),
          capturedAt: new Date().toISOString()
        };
      }
    }

    // 4. 날짜 검증
    const dateValidation = validateDates(checkInDate, checkOutDate);
    if (!dateValidation.valid) {
      await transaction.rollback();
      return error(
        res,
        { code: 4303, message: dateValidation.message },
        400
      );
    }

    // 4-1. 날짜 중복 계약 체크 (방 기준 - 결제 완료 이후 상태)
    const overlappingContract = await Contract.findOne({
      attributes: ['id'],
      where: {
        roomId,
        status: { [Op.in]: ['PAYMENT_COMPLETED', 'IN_PROGRESS', 'CANCEL_REQUESTED'] },
        checkInDate: { [Op.lt]: checkOutDate },
        checkOutDate: { [Op.gt]: checkInDate }
      },
      transaction
    });
    if (overlappingContract) {
      await transaction.rollback();
      return error(res, { code: 4305, message: '해당 기간에 이미 계약이 존재합니다' }, 409);
    }

    // 4-2. 동일 게스트 중복 신청 체크 (승인 대기 / 결제 대기 상태)
    const myDuplicateContract = await Contract.findOne({
      attributes: ['id'],
      where: {
        roomId,
        guestId,
        status: { [Op.in]: ['PENDING_APPROVAL', 'APPROVED'] },
        checkInDate: { [Op.lt]: checkOutDate },
        checkOutDate: { [Op.gt]: checkInDate }
      },
      transaction
    });
    if (myDuplicateContract) {
      await transaction.rollback();
      return error(res, { code: 4306, message: '이미 계약을 요청한 방입니다.' }, 409);
    }

    // 총 일수 재확인
    if (dateValidation.calculatedDays !== totalDays) {
      await transaction.rollback();
      return error(
        res,
        { code: 4304, message: '숙박 일수 계산이 일치하지 않습니다' },
        400,
        {
          clientDays: totalDays,
          serverDays: dateValidation.calculatedDays
        }
      );
    }

    // 5. 방별 최소 계약 일수 확인
    if (room.minContractDays) {
      if (totalDays < room.minContractDays) {
        await transaction.rollback();
        return error(
          res,
          {
            code: 4305,
            message: `최소 ${room.minContractDays}일 이상 예약해야 합니다`
          },
          400
        );
      }
    }

    // 6. 렌탈 아이템 6일 정책 검증
    // 입주일 6일 전 23:59:59까지 렌탈 아이템 선택 가능
    // 예: 입주일 2/16 → 2/10 23:59:59까지 가능, 2/11 00:00:00부터 불가
    if (rentalItems && Array.isArray(rentalItems) && rentalItems.length > 0) {
      const now = new Date();
      const checkIn = new Date(checkInDate);
      const rentalDeadline = new Date(checkIn);
      rentalDeadline.setDate(rentalDeadline.getDate() - 6);
      rentalDeadline.setHours(23, 59, 59, 999);

      if (now > rentalDeadline) {
        await transaction.rollback();
        return error(
          res,
          ErrorCodes.RENTAL_NOT_AVAILABLE_WITHIN_6_DAYS,
          400,
          {
            checkInDate,
            requestedAt: now.toISOString(),
            rentalDeadline: rentalDeadline.toISOString(),
            hint: '렌탈 아이템 없이 계약을 진행하거나, 입주 후 추가 렌탈 주문을 이용해주세요.'
          }
        );
      }
    }

    // 7. 렌탈 아이템 재고 확인
    const stockValidation = await validateRentalItemsStock(
      roomId,
      rentalItems,
      checkInDate,
      checkOutDate,
      transaction
    );

    if (!stockValidation.available) {
      await transaction.rollback();
      return error(
        res,
        { code: 4306, message: '일부 렌탈 아이템의 재고가 부족합니다' },
        400,
        { unavailableItems: stockValidation.unavailableItems }
      );
    }

    // 8. 금액 재계산 및 검증
    // EZ청소서비스 사용 시 면적 기반 계산: 기본 5만원 + 10평 초과 시 10평당 2만원
    const serverCalculated = {
      rentalFee: room.dailyRent * totalDays,
      maintenanceFee: (room.dailyMaintenanceFee || 0) * totalDays,
      cleaningFee: calculateCleaningFee(room),
      rentalItemsFee: await calculateRentalItemsFee(rentalItems, totalDays)
    };

    // 소계 계산 (할인 전)
    const subtotalServer =
      serverCalculated.rentalFee +
      serverCalculated.maintenanceFee +
      serverCalculated.cleaningFee +
      serverCalculated.rentalItemsFee;

    // 할인 금액 계산 (PRICING_CALC.md 기준)
    // - 빠른 입주 할인: 고정 금액, 먼저 적용
    // - 장기계약 할인: %, 빠른입주 할인 적용 후 남은 임대료에 적용
    const discountInfo = await calculateDiscount(
      serverCalculated.rentalFee,  // baseRent (임대료)
      totalDays,
      checkInDate,
      room
    );
    const discountAmountServer = discountInfo.discountAmount;
    const discountTypeServer = discountInfo.discountType;

    // 할인 적용 후 금액
    const afterDiscount = subtotalServer - discountAmountServer;

    // 플랫폼 수수료 계산
    // - 기준: 임대료 + 관리비 + 청소비(EZ서비스 사용시 제외) - 총할인
    // - EZ청소서비스 사용 시 청소비는 수수료 계산에서 제외
    const hasFreeCleaningService = room.ezService?.cleaningService || false;
    const feeBase = serverCalculated.rentalFee +
                    serverCalculated.maintenanceFee +
                    (hasFreeCleaningService ? 0 : serverCalculated.cleaningFee) -
                    discountAmountServer;

    // 게스트 플랫폼 수수료 (9.9%) - 게스트가 추가 결제
    serverCalculated.platformFee = Math.floor(feeBase * 0.099);

    // 호스트 플랫폼 수수료 (3.3%) - 정산 시 차감
    // 기준: 임대료 + 관리비 + 청소비(EZ서비스 미사용시) - 할인 (게스트와 동일 기준)
    serverCalculated.hostPlatformFee = Math.floor(feeBase * 0.033);

    // 실이용 금액 (할인 적용 + 수수료 포함)
    serverCalculated.totalUsageFee = afterDiscount + serverCalculated.platformFee;

    // 보증금
    serverCalculated.deposit = appConfig.deposit.DEFAULT;

    // 최종 결제 금액
    serverCalculated.finalTotal = serverCalculated.totalUsageFee + serverCalculated.deposit;

    // 금액 불일치 확인 (1원 이하 오차 허용)
    const amountDiff = Math.abs(serverCalculated.finalTotal - finalTotalAmount);
    if (amountDiff > 1) {
      await transaction.rollback();
      return error(
        res,
        { code: 4307, message: '금액 계산이 일치하지 않습니다' },
        400,
        {
          clientAmount: {
            subtotal,
            rentalFee,
            maintenanceFee,
            cleaningFee,
            rentalItemsFee,
            discountAmount,
            platformFee,
            totalUsageFee,
            deposit,
            finalTotalAmount
          },
          serverAmount: {
            subtotal: subtotalServer,
            rentalFee: serverCalculated.rentalFee,
            maintenanceFee: serverCalculated.maintenanceFee,
            cleaningFee: serverCalculated.cleaningFee,
            rentalItemsFee: serverCalculated.rentalItemsFee,
            discountAmount: discountAmountServer,
            platformFee: serverCalculated.platformFee,
            totalUsageFee: serverCalculated.totalUsageFee,
            deposit: serverCalculated.deposit,
            finalTotal: serverCalculated.finalTotal
          },
          difference: amountDiff
        }
      );
    }

    // 9. 주문번호 생성 (yymmdd + 00001)
    const orderId = await generateOrderId(transaction);

    // 10. 계약 요청 생성
    const contract = await Contract.create(
      {
        orderId,
        roomId,
        hostId: room.hostId,
        guestId,
        checkInDate,
        checkOutDate,
        totalDays,
        totalWeeks: Math.floor(totalDays / 7),

        // 금액 정보 (서버에서 재계산한 값 사용)
        rentalFee: serverCalculated.rentalFee,
        maintenanceFee: serverCalculated.maintenanceFee,
        cleaningFee: serverCalculated.cleaningFee,
        rentalItemsFee: serverCalculated.rentalItemsFee,
        platformFee: serverCalculated.platformFee,  // 게스트 수수료 (9.9%)
        hostPlatformFee: serverCalculated.hostPlatformFee,  // 호스트 수수료 (3.3%)
        discountAmount: discountAmountServer,
        discountType: discountTypeServer,
        subtotal: subtotalServer,
        totalUsageFee: serverCalculated.totalUsageFee,
        deposit: serverCalculated.deposit,
        finalTotalAmount: serverCalculated.finalTotal,

        // 렌탈 아이템
        rentalItems: rentalItems || {},

        // 결제 정보
        paymentMethod: paymentMethod || null,
        installmentMonths: installmentMonths || 0,

        // 메시지 및 상태
        guestMessage: guestMessage || null,
        status: 'PENDING_APPROVAL',

        // 스냅샷 (분쟁 대비)
        roomSnapshot,
        pricingSnapshot: pricingSnapshot || {},

        // 환불정책 스냅샷 (계약 시점의 정책 보존)
        refundPolicyType: room.refundPolicy || null,
        refundPolicySnapshot: refundPolicySnapshot,

        // 특별 요청
        specialRequests: specialRequests || {},

        // 약관 동의
        termsAgreed
      },
      { transaction }
    );

    // 11. 렌탈 아이템은 contracts.rental_items JSON에만 저장
    // rental_orders 테이블은 결제 시점(confirmPayment)에 생성됨

    // 12. 상태 변경 로그 기록
    await ContractStatusLog.createLog({
      contractId: contract.id,
      fromStatus: null,  // 최초 생성
      toStatus: 'PENDING_APPROVAL',
      changedBy: 'GUEST',
      changedByUserId: guestId,
      reason: '게스트가 계약 승인을 요청했습니다',
      metadata: {
        roomId: contract.roomId,
        checkInDate: contract.checkInDate,
        checkOutDate: contract.checkOutDate,
        totalDays: contract.totalDays,
        finalTotalAmount: contract.finalTotalAmount
      },
      req,
      transaction
    });

    // 13. 알림 전송 (호스트 + 게스트 모두)
    try {
      const guest = await User.findByPk(guestId, { attributes: ['id', 'name', 'nickname'] });
      await NotificationService.notifyContractRequest(contract, { room, guest });
    } catch (notifyErr) {
      console.error('계약 요청 알림 전송 실패 (무시됨):', notifyErr);
    }

    // 14. [개발 환경 전용] 자동 승인 기능
    let finalStatus = contract.status;
    if (process.env.AUTO_APPROVE_CONTRACTS === 'true' && process.env.NODE_ENV !== 'production') {
      await contract.update({
        status: 'APPROVED',
        approvedAt: new Date()
      }, { transaction });

      await ContractStatusLog.createLog({
        contractId: contract.id,
        fromStatus: 'PENDING_APPROVAL',
        toStatus: 'APPROVED',
        changedBy: 'SYSTEM',
        changedByUserId: null,
        reason: '[개발 환경] 자동 승인됨 (AUTO_APPROVE_CONTRACTS=true)',
        metadata: {},
        req,
        transaction
      });

      finalStatus = 'APPROVED';
      console.log(`[DEV] 계약 #${contract.id} 자동 승인됨 (AUTO_APPROVE_CONTRACTS=true)`);
    }

    await transaction.commit();

    return created(
      res,
      {
        contractId: contract.id,
        orderId: contract.orderId,
        status: finalStatus,
        hostId: room.hostId,
        checkInDate: contract.checkInDate,
        checkOutDate: contract.checkOutDate,
        finalTotalAmount: contract.finalTotalAmount,
        createdAt: contract.createdAt,
        autoApproved: finalStatus === 'APPROVED' && process.env.AUTO_APPROVE_CONTRACTS === 'true' // 디버깅용
      },
      finalStatus === 'APPROVED'
        ? '계약이 자동으로 승인되었습니다 (개발 모드)'
        : '계약 승인 요청이 전송되었습니다'
    );
  } catch (err) {
    await transaction.rollback();
    console.error('계약 요청 생성 오류:', err);

    // 특정 에러 메시지 처리
    if (err.message.includes('렌탈 아이템')) {
      return error(
        res,
        { code: 4308, message: err.message },
        400
      );
    }

    // 주문번호 한도 초과 에러
    if (err.message.includes('주문번호 한도')) {
      return error(
        res,
        { code: 4320, message: '오늘 주문번호 발급 한도를 초과했습니다. 고객센터로 문의해주세요.' },
        400
      );
    }

    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 게스트의 계약 요청 목록 조회 (간소화 버전)
 * GET /api/contracts/guest
 *
 * 게스트는 리스트에서 최종 금액만 확인하고, 상세 정보는 상세 페이지에서 확인
 */
const getGuestContracts = async (req, res) => {
  try {
    const guestId = req.user.id;
    const { status } = req.query;

    const whereClause = { guestId };
    if (status) {
      whereClause.status = status;
    }

    const contracts = await Contract.findAll({
      where: whereClause,
      include: [
        {
          model: Room,
          as: 'room',
          attributes: ['id', 'roomName', 'address', 'area', 'buildingType'],
          include: [
            {
              model: RoomPhoto,
              as: 'photos',
              attributes: ['id', 'url'],
              limit: 1,
              order: [['order', 'ASC']]
            }
          ]
        },
        {
          model: User,
          as: 'host',
          attributes: ['id', 'name', 'nickname', 'phoneNumber']
        },
        {
          model: DepositAgreement,
          as: 'depositAgreement',
          attributes: ['id', 'status', 'deductAmount'],
          required: false
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    // 각 계약의 렌탈 아이템 요약 정보 조회 (병렬 처리)
    const contractsWithRental = await Promise.all(
      contracts.map(async (contract) => {
        // 렌탈 아이템 데이터 결정
        // - 결제 전(PENDING_APPROVAL, APPROVED): contracts.rental_items JSON 사용 (장바구니)
        // - 결제 후: rental_orders 테이블에서 조회 (실제 주문)
        let rentalItemsData = null;

        // 결제 전 상태 (장바구니에서 조회)
        const prePaymentStatuses = ['PENDING_APPROVAL', 'APPROVED'];

        if (prePaymentStatuses.includes(contract.status)) {
          // 결제 전: contracts.rental_items JSON에서 가져오기
          const cartItems = contract.rentalItems;
          if (cartItems && Array.isArray(cartItems) && cartItems.length > 0) {
            rentalItemsData = {
              source: 'cart',  // 장바구니 (아직 결제 전)
              totalAmount: contract.rentalItemsFee || 0,
              items: cartItems.map(item => ({
                itemId: item.itemId,
                name: item.name,
                quantity: item.quantity,
                pricePerItem: item.price,
                totalPrice: item.totalPrice,
                imageUrl: item.imageUrl
              }))
            };
          }
        } else {
          // 결제 후: rental_orders에서 조회
          const rentalSummary = await getContractRentalSummary(contract.id);
          if (rentalSummary && rentalSummary.activeItems.length > 0) {
            // 같은 rentalItemId끼리 묶어서 quantity 합산
            const groupedItems = new Map();
            for (const item of rentalSummary.activeItems) {
              const key = item.rentalItemId;
              if (groupedItems.has(key)) {
                const existing = groupedItems.get(key);
                existing.quantity += item.quantity;
                existing.totalPrice += item.totalPrice;
              } else {
                groupedItems.set(key, {
                  rentalItemId: item.rentalItemId,
                  name: item.name,
                  quantity: item.quantity,
                  pricePerItem: item.pricePerItem,
                  totalPrice: item.totalPrice,
                  imageUrl: item.imageUrl
                });
              }
            }

            rentalItemsData = {
              source: 'orders',  // 실제 주문
              totalPaid: rentalSummary.totalPaid,
              totalRefunded: rentalSummary.totalRefunded,
              netAmount: rentalSummary.netAmount,
              items: Array.from(groupedItems.values())
            };
          }
        }

        return {
          id: contract.id,
          orderId: contract.orderId,
          status: contract.status,
          statusLabel: Contract.STATUS_LABELS[contract.status],

          // 날짜 정보
          checkInDate: contract.checkInDate,
          checkOutDate: contract.checkOutDate,
          totalDays: contract.totalDays,

          // 💰 최종 금액만 표시 (리스트 간소화)
          finalTotalAmount: contract.finalTotalAmount,

          // 방 정보
          room: {
            id: contract.room.id,
            roomName: contract.room.roomName,
            address: contract.room.address,
            area: contract.room.area,
            buildingType: contract.room.buildingType,
            thumbnailUrl: toAbsoluteUrl(contract.room.photos[0]?.url || null)
          },

          // 호스트 정보
          host: {
            id: contract.host.id,
            name: contract.host.name,
            nickname: contract.host.nickname,
            phoneNumber: contract.host.phoneNumber
          },

          // 🛒 렌탈 아이템 정보
          rentalItems: rentalItemsData,

          // 퇴실/보증금 상태 (프론트 카드 액션 결정용)
          checkoutStatus: contract.checkoutStatus,
          depositStatus: contract.depositStatus,
          deposit: contract.deposit,
          checkoutRequested: contract.checkoutRequested,

          // 보증금 합의 상태 (동의 버튼 분기용)
          depositAgreementStatus: contract.depositAgreement?.status || null,

          createdAt: contract.createdAt
        };
      })
    );

    return success(
      res,
      {
        contracts: contractsWithRental
      },
      '계약 목록 조회 성공'
    );
  } catch (err) {
    console.error('게스트 계약 목록 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 호스트가 받은 계약 요청 목록 조회 (상세 버전)
 * GET /api/contracts/host
 *
 * 호스트는 수익 관리를 위해 금액 상세 정보를 모두 확인할 수 있음
 */
const getHostContracts = async (req, res) => {
  try {
    const hostId = req.user.id;
    const { status } = req.query;

    const whereClause = { hostId };
    if (status) {
      whereClause.status = status;
    }

    const contracts = await Contract.findAll({
      where: whereClause,
      include: [
        {
          model: Room,
          as: 'room',
          attributes: ['id', 'roomName', 'address', 'area', 'buildingType'],
          include: [
            {
              model: RoomPhoto,
              as: 'photos',
              attributes: ['id', 'url'],
              limit: 1,
              order: [['order', 'ASC']]
            }
          ]
        },
        {
          model: User,
          as: 'guest',
          attributes: ['id', 'name', 'nickname', 'phoneNumber', 'email']
        },
        {
          model: DepositAgreement,
          as: 'depositAgreement',
          attributes: ['id', 'status', 'deductAmount'],
          required: false
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    return success(
      res,
      {
        contracts: contracts.map(contract => ({
          id: contract.id,
          orderId: contract.orderId,
          status: contract.status,
          statusLabel: Contract.STATUS_LABELS[contract.status],

          // 날짜 정보
          checkInDate: contract.checkInDate,
          checkOutDate: contract.checkOutDate,
          totalDays: contract.totalDays,
          totalWeeks: contract.totalWeeks,

          // 💰 금액 상세 정보 (호스트 수익 관리용)
          rentalFee: contract.rentalFee,
          maintenanceFee: contract.maintenanceFee,
          cleaningFee: contract.cleaningFee,
          rentalItemsFee: contract.rentalItemsFee,
          platformFee: contract.platformFee,
          discountAmount: contract.discountAmount,
          discountType: contract.discountType,
          subtotal: contract.subtotal,
          totalUsageFee: contract.totalUsageFee,
          deposit: contract.deposit,
          finalTotalAmount: contract.finalTotalAmount,

          // 📊 호스트 실수령액 (플랫폼 수수료 차감 후)
          hostEarnings: contract.totalUsageFee - contract.platformFee,

          // 렌탈 아이템
          rentalItems: contract.rentalItems,

          // 메시지
          guestMessage: contract.guestMessage,

          // 방 정보
          room: {
            id: contract.room.id,
            roomName: contract.room.roomName,
            address: contract.room.address,
            area: contract.room.area,
            buildingType: contract.room.buildingType,
            thumbnailUrl: toAbsoluteUrl(contract.room.photos[0]?.url || null)
          },

          // 퇴실/보증금 상태 (PRD v2)
          checkoutStatus: contract.checkoutStatus,
          checkoutStatusLabel: Contract.CHECKOUT_STATUS_LABELS[contract.checkoutStatus],
          hostPlatformFee: contract.hostPlatformFee,
          depositStatus: contract.depositStatus,
          checkoutRequested: contract.checkoutRequested,
          hostCheckedOut: contract.hostCheckedOut,

          // 보증금 합의 상태 (버튼 분기용)
          depositAgreementStatus: contract.depositAgreement?.status || null,

          // 게스트 정보 (연락처는 결제 완료 이후 상태에서만 노출)
          guest: {
            id: contract.guest.id,
            name: contract.guest.name,
            nickname: contract.guest.nickname,
            phoneNumber: ['PAYMENT_COMPLETED', 'IN_PROGRESS', 'COMPLETED'].includes(contract.status)
              ? contract.guest.phoneNumber : null,
            email: contract.guest.email
          },

          createdAt: contract.createdAt
        }))
      },
      '계약 요청 목록 조회 성공'
    );
  } catch (err) {
    console.error('호스트 계약 목록 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 계약 상세 정보 조회
 * GET /api/contracts/:contractId
 */
const getContractDetail = async (req, res) => {
  try {
    const { contractId } = req.params;
    const userId = req.user.id;

    const contract = await Contract.findByPk(contractId, {
      include: [
        {
          model: Room,
          as: 'room',
          include: [
            {
              model: RoomPhoto,
              as: 'photos',
              order: [['order', 'ASC']]
            }
          ]
        },
        {
          model: User,
          as: 'host',
          attributes: ['id', 'name', 'nickname', 'phoneNumber', 'email']
        },
        {
          model: User,
          as: 'guest',
          attributes: ['id', 'name', 'nickname', 'phoneNumber', 'email']
        },
        {
          model: DepositAgreement,
          as: 'depositAgreement',
          required: false
        }
      ]
    });

    if (!contract) {
      return error(res, { code: 3005, message: '계약을 찾을 수 없습니다' }, 404);
    }

    // 계약 당사자만 조회 가능
    if (contract.hostId !== userId && contract.guestId !== userId) {
      return error(res, ErrorCodes.FORBIDDEN, 403);
    }

    // 렌탈 주문 정보 조회
    const rentalSummary = await getContractRentalSummary(contract.id);

    return success(
      res,
      {
        contract: {
          id: contract.id,
          orderId: contract.orderId,
          status: contract.status,
          statusLabel: Contract.STATUS_LABELS[contract.status],

          // 날짜 정보
          checkInDate: contract.checkInDate,
          checkOutDate: contract.checkOutDate,
          totalDays: contract.totalDays,
          totalWeeks: contract.totalWeeks,

          // 금액 정보
          rentalFee: contract.rentalFee,
          maintenanceFee: contract.maintenanceFee,
          cleaningFee: contract.cleaningFee,
          rentalItemsFee: contract.rentalItemsFee,
          platformFee: contract.platformFee,
          discountAmount: contract.discountAmount,
          discountType: contract.discountType,
          subtotal: contract.subtotal,
          totalUsageFee: contract.totalUsageFee,
          deposit: contract.deposit,
          finalTotalAmount: contract.finalTotalAmount,

          // 렌탈 아이템 (레거시 - 하위호환용)
          rentalItems: contract.rentalItems,
          recommendedItems: contract.recommendedItems,

          // 렌탈 주문 정보 (신규 시스템)
          rentalOrders: rentalSummary,

          // 결제 정보
          paymentMethod: contract.paymentMethod,
          installmentMonths: contract.installmentMonths,

          // 메시지
          guestMessage: contract.guestMessage,
          hostMessage: contract.hostMessage,
          cancellationReason: contract.cancellationReason,

          // 특별 요청
          specialRequests: contract.specialRequests,

          // 약관 동의
          termsAgreed: contract.termsAgreed,

          // 계약 시점 스냅샷
          roomSnapshot: contract.roomSnapshot,
          refundPolicyType: contract.refundPolicyType,
          refundPolicySnapshot: contract.refundPolicySnapshot,

          // 방 정보
          room: {
            id: contract.room.id,
            roomName: contract.room.roomName,
            address: contract.room.address,
            detailAddress: ['PAYMENT_COMPLETED', 'IN_PROGRESS', 'COMPLETED', 'REFUNDED',
              'CANCELLED_BY_HOST', 'CANCELLED_BY_ADMIN_WITH_REFUND', 'CANCELLED_BY_ADMIN_NO_REFUND',
              'CANCEL_REQUESTED'
            ].includes(contract.status) ? contract.room.detailAddress : null,
            area: contract.room.area,
            buildingType: contract.room.buildingType,
            photos: contract.room.photos.map(photo => ({
              id: photo.id,
              url: toAbsoluteUrl(photo.url),
              order: photo.order
            }))
          },

          // 호스트 정보 (게스트 조회 시: 결제 완료 이후만 연락처 노출)
          host: {
            id: contract.host.id,
            name: contract.host.name,
            nickname: contract.host.nickname,
            phoneNumber: (userId === contract.hostId || ['PAYMENT_COMPLETED', 'IN_PROGRESS', 'COMPLETED'].includes(contract.status))
              ? contract.host.phoneNumber : null,
            email: contract.host.email
          },

          // 게스트 정보 (호스트 조회 시: 결제 완료 이후만 연락처 노출)
          guest: {
            id: contract.guest.id,
            name: contract.guest.name,
            nickname: contract.guest.nickname,
            phoneNumber: (userId === contract.guestId || ['PAYMENT_COMPLETED', 'IN_PROGRESS', 'COMPLETED'].includes(contract.status))
              ? contract.guest.phoneNumber : null,
            email: contract.guest.email
          },

          // 퇴실/보증금 상태 (PRD v2)
          checkoutStatus: contract.checkoutStatus,
          checkoutStatusLabel: Contract.CHECKOUT_STATUS_LABELS[contract.checkoutStatus],
          hostPlatformFee: contract.hostPlatformFee,
          depositStatus: contract.depositStatus,
          depositDeduction: contract.depositDeduction,
          deductionReason: contract.deductionReason,
          refundableDeposit: contract.refundableDeposit,
          checkoutRequested: contract.checkoutRequested,
          hostCheckedOut: contract.hostCheckedOut,

          // 보증금 합의 정보
          depositAgreement: contract.depositAgreement ? {
            id: contract.depositAgreement.id,
            deductAmount: contract.depositAgreement.deductAmount,
            agreementText: contract.depositAgreement.agreementText,
            holdReason: contract.depositAgreement.holdReason,
            status: contract.depositAgreement.status,
            submittedAt: contract.depositAgreement.submittedAt,
            acceptedAt: contract.depositAgreement.acceptedAt,
            refundableAmount: (contract.deposit || 0) - contract.depositAgreement.deductAmount
          } : null,

          // 시점 정보
          createdAt: contract.createdAt,
          approvedAt: contract.approvedAt,
          rejectedAt: contract.rejectedAt,
          paidAt: contract.paidAt,
          checkedInAt: contract.checkedInAt,
          checkedOutAt: contract.checkedOutAt,
          cancelledAt: contract.cancelledAt,
          checkoutRequestedAt: contract.checkoutRequestedAt
        }
      },
      '계약 상세 조회 성공'
    );
  } catch (err) {
    console.error('계약 상세 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 호스트가 계약 승인
 * PATCH /api/contracts/:contractId/approve
 */
const approveContract = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { contractId } = req.params;
    const { recommendedItems } = req.body;
    const hostId = req.user.id;

    // 계약 조회
    const contract = await Contract.findByPk(contractId, { transaction });

    if (!contract) {
      await transaction.rollback();
      return error(res, { code: 3005, message: '계약을 찾을 수 없습니다' }, 404);
    }

    // 호스트 본인 확인
    if (contract.hostId !== hostId) {
      await transaction.rollback();
      return error(res, ErrorCodes.FORBIDDEN, 403);
    }

    // 승인 대기 상태인지 확인
    if (contract.status !== 'PENDING_APPROVAL') {
      await transaction.rollback();
      return error(
        res,
        { code: 4401, message: '승인 대기 상태의 계약만 승인할 수 있습니다' },
        400
      );
    }

    // 권장 렌탈 아이템 검증 (선택사항)
    let recommendedItemsData = null;
    if (recommendedItems && recommendedItems.items && recommendedItems.items.length > 0) {
      const { RentalItem } = require('../models');

      // 각 아이템이 실제 존재하는지 검증
      const itemIds = recommendedItems.items.map(item => item.itemId);
      const validItems = await RentalItem.findAll({
        where: { id: itemIds, isActive: true },
        attributes: ['id', 'itemType', 'name', 'price'],
        transaction
      });

      if (validItems.length !== itemIds.length) {
        await transaction.rollback();
        return error(
          res,
          { code: 4011, message: '유효하지 않은 렌탈 아이템이 포함되어 있습니다' },
          400
        );
      }

      // 권장 아이템 데이터 구성
      recommendedItemsData = {
        items: recommendedItems.items.map(item => {
          const validItem = validItems.find(v => v.id === item.itemId);
          return {
            itemId: item.itemId,
            itemType: validItem.itemType,
            name: validItem.name,
            quantity: item.quantity || 1,
            price: validItem.price
          };
        }),
        recommendedBy: hostId,
        recommendedAt: new Date()
      };
    }

    // 계약 승인 처리
    const updateData = {
      status: 'APPROVED',
      approvedAt: new Date()
    };

    if (recommendedItemsData) {
      updateData.recommendedItems = recommendedItemsData;
    }

    await contract.update(updateData, { transaction });

    // 상태 변경 로그 기록
    await ContractStatusLog.createLog({
      contractId: contract.id,
      fromStatus: 'PENDING_APPROVAL',
      toStatus: 'APPROVED',
      changedBy: 'HOST',
      changedByUserId: hostId,
      reason: '호스트가 계약을 승인했습니다',
      metadata: {
        approvedAt: contract.approvedAt,
        hasRecommendedItems: !!recommendedItemsData,
        recommendedItemsCount: recommendedItemsData?.items?.length || 0
      },
      req,
      transaction
    });

    // 방 정보 조회 (알림 전송용)
    const room = await Room.findByPk(contract.roomId, {
      attributes: ['id', 'roomName', 'address'],
      transaction
    });

    // 채팅방 자동 생성
    try {
      // Firebase 채팅방 ID 생성
      const firebaseChatRoomId = ChatRoom.generateFirebaseChatRoomId(contract.id);

      // 호스트/게스트 정보 조회
      const host = await User.findByPk(contract.hostId, {
        attributes: ['id', 'name', 'nickname', 'profileImageUrl'],
        transaction
      });

      const guest = await User.findByPk(contract.guestId, {
        attributes: ['id', 'name', 'nickname', 'profileImageUrl'],
        transaction
      });

      // MySQL에 채팅방 정보 저장
      const chatRoom = await ChatRoom.create({
        contractId: contract.id,
        firebaseChatRoomId,
        hostId: contract.hostId,
        guestId: contract.guestId,
        roomId: contract.roomId,
        isActive: true
      }, { transaction });

      // Firestore에 채팅방 메타데이터 저장 (await로 완료 대기 - 시스템 메시지 발송 전 필요)
      // 실패해도 계약 승인은 유지
      try {
        await createChatRoomMetadata(firebaseChatRoomId, {
          contractId: contract.id,
          hostId: contract.hostId,
          guestId: contract.guestId,
          roomId: contract.roomId,
          roomInfo: {
            name: room.roomName,
            address: room.address
          },
          hostInfo: {
            id: host.id,
            name: host.name,
            nickname: host.nickname,
            profileImageUrl: toAbsoluteUrl(host.profileImageUrl)
          },
          guestInfo: {
            id: guest.id,
            name: guest.name,
            nickname: guest.nickname,
            profileImageUrl: toAbsoluteUrl(guest.profileImageUrl)
          },
          checkInDate: contract.checkInDate,
          checkOutDate: contract.checkOutDate,
          isActive: true
        });
      } catch (firestoreErr) {
        console.error('Firestore 채팅방 메타데이터 생성 실패 (계약 승인은 완료됨):', firestoreErr);
      }

      console.log(`✅ 채팅방 생성 완료: ${firebaseChatRoomId}`);

      // 결제 마감 시한 계산 (승인일로부터 24시간 후)
      const paymentDeadline = new Date(contract.approvedAt);
      paymentDeadline.setHours(paymentDeadline.getHours() + 24);
      const paymentDeadlineStr = paymentDeadline.toLocaleString('ko-KR', {
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: false
      });

      // 시스템 메시지 발송 (Firestore 채팅방 생성 완료 후)
      sendSystemMessage(
        firebaseChatRoomId,
        getSystemMessageTemplate(SystemMessageTypes.CONTRACT_APPROVED, {
          paymentDeadline: paymentDeadlineStr
        }),
        SystemMessageTypes.CONTRACT_APPROVED,
        {
          contractId: contract.id,
          checkInDate: contract.checkInDate,
          checkOutDate: contract.checkOutDate,
          paymentDeadline: paymentDeadlineStr
        }
      ).catch(err => {
        console.error('시스템 메시지 발송 실패 (계약 승인은 완료됨):', err);
      });

    } catch (chatRoomError) {
      console.error('채팅방 생성 실패 (계약 승인은 완료됨):', chatRoomError);
      // 채팅방 생성 실패해도 계약 승인은 계속 진행
    }

    // 알림 전송 (호스트 + 게스트 모두에게)
    try {
      await NotificationService.notifyContractApproved(contract, { room });
    } catch (notifyErr) {
      console.error('계약 승인 알림 전송 실패 (무시됨):', notifyErr);
    }

    // 결제 만료 3시간 전 알림 예약 (Bull Queue)
    try {
      const { schedulePaymentPendingNotification } = require('../queues/notificationQueue');
      await schedulePaymentPendingNotification(contract.id, contract.approvedAt);
    } catch (queueErr) {
      console.error('결제 만료 알림 예약 실패 (무시됨):', queueErr);
    }

    await transaction.commit();

    return updated(
      res,
      {
        contractId: contract.id,
        status: contract.status,
        statusLabel: Contract.STATUS_LABELS[contract.status],
        approvedAt: contract.approvedAt
      },
      '계약이 승인되었습니다'
    );
  } catch (err) {
    await transaction.rollback();
    console.error('계약 승인 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 호스트가 계약 거절
 * PATCH /api/contracts/:contractId/reject
 */
const rejectContract = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { contractId } = req.params;
    const { hostMessage } = req.body;
    const hostId = req.user.id;

    // 거절 사유 확인
    if (!hostMessage || hostMessage.trim() === '') {
      await transaction.rollback();
      return error(
        res,
        { code: 4402, message: '거절 사유를 입력해주세요' },
        400
      );
    }

    // 계약 조회
    const contract = await Contract.findByPk(contractId, { transaction });

    if (!contract) {
      await transaction.rollback();
      return error(res, { code: 3005, message: '계약을 찾을 수 없습니다' }, 404);
    }

    // 호스트 본인 확인
    if (contract.hostId !== hostId) {
      await transaction.rollback();
      return error(res, ErrorCodes.FORBIDDEN, 403);
    }

    // 승인 대기 상태인지 확인
    if (contract.status !== 'PENDING_APPROVAL') {
      await transaction.rollback();
      return error(
        res,
        { code: 4403, message: '승인 대기 상태의 계약만 거절할 수 있습니다' },
        400
      );
    }

    // 계약 거절 처리
    await contract.update(
      {
        status: 'REJECTED',
        cancellationReason: hostMessage,
        rejectedAt: new Date()
      },
      { transaction }
    );

    // 상태 변경 로그 기록
    await ContractStatusLog.createLog({
      contractId: contract.id,
      fromStatus: 'PENDING_APPROVAL',
      toStatus: 'REJECTED',
      changedBy: 'HOST',
      changedByUserId: hostId,
      reason: hostMessage,
      metadata: {
        rejectedAt: contract.rejectedAt
      },
      req,
      transaction
    });

    // 채팅방이 있다면 시스템 메시지 발송 (거절 시에는 채팅방이 없을 수 있음)
    const chatRoom = await ChatRoom.findOne({
      where: { contractId },
      transaction
    });

    if (chatRoom) {
      sendSystemMessage(
        chatRoom.firebaseChatRoomId,
        getSystemMessageTemplate(SystemMessageTypes.CONTRACT_REJECTED, {
          reason: hostMessage
        }),
        SystemMessageTypes.CONTRACT_REJECTED,
        {
          contractId: contract.id,
          rejectionReason: hostMessage
        }
      ).catch(err => {
        console.error('시스템 메시지 발송 실패 (계약 거절은 완료됨):', err);
      });
    }

    // TODO: 렌탈 아이템 예약 해제 (재고 복구)

    // 게스트에게 거절 알림 전송 + 알림톡
    try {
      const [guest, room] = await Promise.all([
        User.findByPk(contract.guestId, { attributes: ['id', 'phoneNumber', 'name', 'nickname'] }),
        Room.findByPk(contract.roomId, { attributes: ['id', 'roomName'] })
      ]);
      await NotificationService.notifyContractRejected(contract, { guest, room });
    } catch (notifyErr) {
      console.error('계약 거절 알림 전송 실패 (무시됨):', notifyErr);
    }

    await transaction.commit();

    return updated(
      res,
      {
        contractId: contract.id,
        status: contract.status,
        statusLabel: Contract.STATUS_LABELS[contract.status],
        cancellationReason: contract.cancellationReason,
        rejectedAt: contract.rejectedAt
      },
      '계약이 거절되었습니다'
    );
  } catch (err) {
    await transaction.rollback();
    console.error('계약 거절 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 게스트가 계약 요청 취소 (승인 대기 중일 때만 가능)
 * PATCH /api/contracts/:contractId/cancel
 */
const cancelContractByGuest = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { contractId } = req.params;
    const { cancellationReason } = req.body;
    const guestId = req.user.id;

    // 계약 조회
    const contract = await Contract.findByPk(contractId, { transaction });

    if (!contract) {
      await transaction.rollback();
      return error(res, { code: 3005, message: '계약을 찾을 수 없습니다' }, 404);
    }

    // 게스트 본인 확인
    if (contract.guestId !== guestId) {
      await transaction.rollback();
      return error(res, ErrorCodes.FORBIDDEN, 403);
    }

    // 승인 대기 상태인지 확인 (승인 대기 중일 때만 취소 가능)
    if (contract.status !== 'PENDING_APPROVAL') {
      await transaction.rollback();
      return error(
        res,
        {
          code: 4404,
          message: '승인 대기 상태의 계약만 취소할 수 있습니다',
          currentStatus: contract.status
        },
        400
      );
    }

    // 렌탈 아이템 예약 취소 (재고 복구)
    await cancelRentalItemReservations(contractId, transaction);

    // 계약 취소 처리
    await contract.update(
      {
        status: 'CANCELLED_BY_GUEST',
        cancellationReason: cancellationReason || null,
        cancelledAt: new Date()
      },
      { transaction }
    );

    // TODO: 게스트 취소 위약금 중 플랫폼 귀속 금액이 있을 경우 영수증 발급 대기 목록 생성
    // const { createCancelFeeReceipt } = require('../services/receiptService');
    // await createCancelFeeReceipt({ contractId, hostId: contract.hostId, targetType: 'GUEST_CANCEL_FEE', platformFeeAmount, date }, transaction);

    // 상태 변경 로그 기록
    await ContractStatusLog.createLog({
      contractId: contract.id,
      fromStatus: 'PENDING_APPROVAL',
      toStatus: 'CANCELLED_BY_GUEST',
      changedBy: 'GUEST',
      changedByUserId: guestId,
      reason: cancellationReason || '게스트가 계약 요청을 취소했습니다',
      metadata: {
        cancellationType: 'BEFORE_PAYMENT',
        cancelledAt: contract.cancelledAt
      },
      req,
      transaction
    });

    // 채팅방이 있다면 시스템 메시지 발송 (승인 대기 중 취소 시 채팅방이 없을 수 있음)
    const chatRoom = await ChatRoom.findOne({
      where: { contractId },
      transaction
    });

    if (chatRoom) {
      sendSystemMessage(
        chatRoom.firebaseChatRoomId,
        getSystemMessageTemplate(SystemMessageTypes.CONTRACT_CANCELED_BY_GUEST),
        SystemMessageTypes.CONTRACT_CANCELED_BY_GUEST,
        {
          contractId: contract.id,
          cancelledBy: 'guest',
          cancellationReason: cancellationReason || null
        }
      ).catch(err => {
        console.error('시스템 메시지 발송 실패 (계약 취소는 완료됨):', err);
      });
    }

    // 호스트/게스트 모두에게 취소 알림 전송
    try {
      const [cancelGuest, cancelHost, cancelRoom] = await Promise.all([
        User.findByPk(contract.guestId, { attributes: ['id', 'phoneNumber', 'name', 'nickname'] }),
        User.findByPk(contract.hostId, { attributes: ['id', 'phoneNumber', 'name', 'nickname'] }),
        Room.findByPk(contract.roomId, { attributes: ['id', 'roomName'] })
      ]);
      await NotificationService.notifyContractCanceled(contract, CANCEL_TYPES.GUEST_CANCEL, {
        guest: cancelGuest,
        host: cancelHost,
        room: cancelRoom,
        refundData: { guestPenalty: 0, refundAmount: 0, hostPenalty: 0, settlementAmount: 0 }
      });
    } catch (notifyErr) {
      console.error('계약 취소 알림 전송 실패 (무시됨):', notifyErr);
    }

    await transaction.commit();

    return updated(
      res,
      {
        contractId: contract.id,
        status: contract.status,
        statusLabel: Contract.STATUS_LABELS[contract.status],
        cancellationReason: contract.cancellationReason,
        cancelledAt: contract.cancelledAt
      },
      '계약 요청이 취소되었습니다'
    );
  } catch (err) {
    await transaction.rollback();
    console.error('게스트 계약 취소 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 환불 금액 미리 계산 (게스트가 취소하기 전에 확인)
 * POST /api/contracts/:contractId/calculate-refund
 */
const calculateRefundPreview = async (req, res) => {
  try {
    const { contractId } = req.params;
    const userId = req.user.id;
    const { cancellation_date } = req.body;

    // 계약 조회 (게스트 본인 확인)
    const contract = await Contract.findOne({
      where: { id: contractId, guestId: userId }
    });

    if (!contract) {
      return error(res, { code: 3005, message: '계약을 찾을 수 없습니다' }, 404);
    }

    // 환불 가능한 상태인지 확인
    const refundableStatuses = ['PAYMENT_COMPLETED', 'IN_PROGRESS'];
    if (!refundableStatuses.includes(contract.status)) {
      return error(
        res,
        {
          code: 4501,
          message: '환불 가능한 상태가 아닙니다',
          currentStatus: contract.status
        },
        400
      );
    }

    // 환불 금액 계산
    const cancellationDate = cancellation_date ? new Date(cancellation_date) : new Date();
    const refundResult = await calculateRefund(contract, cancellationDate);

    if (!refundResult.success) {
      return error(res, {
        code: 5001,
        message: refundResult.error.message
      }, 500);
    }

    return success(res, refundResult.data, '환불 금액이 계산되었습니다.');
  } catch (err) {
    console.error('환불 계산 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 환불 요청 (게스트가 계약 취소 및 환불 요청)
 * POST /api/contracts/:contractId/request-refund
 */
const requestRefund = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { contractId } = req.params;
    const userId = req.user.id;
    const {
      cancellation_reason,
      refund_method,
      refund_account_info
    } = req.body;

    // 계약 조회 (게스트 본인 확인)
    const contract = await Contract.findOne({
      where: { id: contractId, guestId: userId },
      transaction
    });

    if (!contract) {
      await transaction.rollback();
      return error(res, { code: 3005, message: '계약을 찾을 수 없습니다' }, 404);
    }

    // 환불 가능한 상태인지 확인
    const refundableStatuses = ['PAYMENT_COMPLETED', 'IN_PROGRESS'];
    if (!refundableStatuses.includes(contract.status)) {
      await transaction.rollback();
      return error(
        res,
        {
          code: 4501,
          message: '환불 가능한 상태가 아닙니다',
          currentStatus: contract.status
        },
        400
      );
    }

    // 이미 환불 요청이 있는지 확인
    const existingRefund = await Refund.findOne({
      where: {
        contractId,
        refundStatus: ['REQUESTED', 'CALCULATING', 'APPROVED', 'PROCESSING']
      },
      transaction
    });

    if (existingRefund) {
      await transaction.rollback();
      return error(
        res,
        {
          code: 4502,
          message: '이미 환불 요청이 진행 중입니다',
          refundId: existingRefund.id
        },
        400
      );
    }

    // 입주 중(IN_PROGRESS) 취소/환불 1회 제한
    if (contract.status === 'IN_PROGRESS') {
      const pastRefundCount = await Refund.count({
        where: { contractId },
        transaction
      });

      if (pastRefundCount > 0) {
        await transaction.rollback();
        return error(
          res,
          {
            code: 4503,
            message: '입주 중에는 취소/환불 요청을 1회만 할 수 있습니다. 이미 환불 이력이 존재합니다.'
          },
          400
        );
      }
    }

    // 정산 완료 후 환불 차단
    const settlement = await Settlement.findOne({
      where: {
        contractId,
        status: { [Op.in]: ['READY', 'PROCESSING', 'COMPLETED'] }
      },
      transaction
    });

    if (settlement) {
      await transaction.rollback();
      return error(
        res,
        {
          code: 4504,
          message: '정산이 이미 진행되었거나 완료되어 환불이 불가합니다.',
          settlementStatus: settlement.status
        },
        400
      );
    }

    // 환불 금액 계산
    const cancellationDate = new Date();
    const refundResult = await calculateRefund(contract, cancellationDate);

    if (!refundResult.success) {
      await transaction.rollback();
      return error(res, {
        code: 5001,
        message: refundResult.error.message
      }, 500);
    }

    const refundData = refundResult.data;

    // 입주 전 자동 승인 여부 판단
    const now = new Date();
    const checkInDate = new Date(contract.checkInDate);
    const isBeforeCheckIn = now < checkInDate;

    // 입주 전이면 자동 승인, 입주 후면 관리자 승인 필요
    const autoApprove = isBeforeCheckIn;
    const refundStatus = autoApprove ? 'APPROVED' : 'REQUESTED';
    const contractStatus = autoApprove ? 'REFUNDED' : 'CANCEL_REQUESTED';

    // 환불 요청 레코드 생성
    const refund = await Refund.create({
      contractId,
      refundStatus,

      // 환불 계산 정보
      policyTypeUsed: refundData.policyTypeUsed,
      cancellationDate,
      checkInDate: contract.checkInDate,
      daysBeforeCheckin: refundData.daysBeforeCheckin,
      isSameDayCancellation: refundData.isSameDayCancellation,
      cancellationFaultType: refundData.cancellationFaultType,
      hasEzCleaningService: refundData.hasEzCleaningService,

      // 원본 금액
      originalDeposit: refundData.originalDeposit,
      originalPlatformFee: refundData.originalPlatformFee,
      originalRentalFee: contract.rentalFee,
      originalCleaningFee: contract.cleaningFee,
      originalMaintenanceFee: contract.maintenanceFee,
      originalTotalAmount: contract.finalTotalAmount,

      // 이용료 기반 환불 (신규)
      usageFee: refundData.usageFee,
      usageFeeRefundAmount: refundData.usageFeeRefundAmount,
      depositRefundAmount: refundData.depositRefundAmount,

      // 환불 금액 (하위 호환)
      rentalFeeRefundRate: refundData.rentalFeeRefundRate,
      rentalFeeRefundAmount: refundData.rentalFeeRefundAmount,
      cleaningFeeRefundAmount: refundData.cleaningFeeRefundAmount,
      maintenanceFeeRefundAmount: refundData.maintenanceFeeRefundAmount,
      totalRefundAmount: refundData.totalRefundAmount,

      // 위약금 분배
      penaltyAmount: refundData.penaltyAmount,
      hostPenaltyAmount: refundData.hostPenaltyAmount,
      hostPenaltyFee: refundData.hostPenaltyFee,

      // 수수료
      guestServiceFeeRefunded: refundData.guestServiceFeeRefunded,
      platformFeeDeducted: refundData.platformFeeDeducted,
      finalRefundAmount: refundData.finalRefundAmount,

      // 환불 방법
      refundMethod: refund_method || 'ORIGINAL_PAYMENT',
      refundAccountInfo: refund_account_info || null,

      // 사유
      cancellationReason: cancellation_reason || null,

      // 타임스탬프
      requestedAt: new Date(),
      approvedAt: autoApprove ? new Date() : null
    }, { transaction });

    // 계약 상태 업데이트
    const previousStatus = contract.status;
    await contract.update({
      status: contractStatus,
      cancelledAt: new Date(),
      cancellationReason: cancellation_reason || null
    }, { transaction });

    // 상태 변경 로그 기록
    await ContractStatusLog.createLog({
      contractId: contract.id,
      fromStatus: previousStatus,
      toStatus: contractStatus,
      changedBy: 'GUEST',
      changedByUserId: userId,
      reason: cancellation_reason || '게스트가 환불을 요청했습니다',
      metadata: {
        refundId: refund.id,
        autoApproved: autoApprove,
        cancellationType: isBeforeCheckIn ? 'AFTER_PAYMENT' : 'DURING_STAY',
        totalRefundAmount: refund.totalRefundAmount,
        finalRefundAmount: refund.finalRefundAmount,
        penaltyAmount: refund.penaltyAmount,
        policyTypeUsed: refund.policyTypeUsed,
        daysBeforeCheckin: refundData.daysBeforeCheckin
      },
      req,
      transaction
    });

    // 채팅방에 시스템 메시지 발송
    const chatRoom = await ChatRoom.findOne({
      where: { contractId },
      transaction
    });

    if (chatRoom) {
      // 자동 승인 여부에 따라 다른 메시지 타입 사용
      const messageType = autoApprove
        ? SystemMessageTypes.REFUND_APPROVED
        : SystemMessageTypes.REFUND_REQUESTED;

      sendSystemMessage(
        chatRoom.firebaseChatRoomId,
        getSystemMessageTemplate(messageType, {
          refundAmount: refundData.finalRefundAmount.toLocaleString()
        }),
        messageType,
        {
          contractId: contract.id,
          refundId: refund.id,
          refundAmount: refundData.finalRefundAmount,
          autoApproved: autoApprove
        }
      ).catch(err => {
        console.error('시스템 메시지 발송 실패 (환불 요청은 완료됨):', err);
      });
    }

    // 자동 승인(입주 전)이면 PG 취소 즉시 처리
    if (autoApprove && refundData.finalRefundAmount > 0) {
      const payment = await Payment.findOne({
        where: { contractId, status: { [Op.in]: ['DONE', 'PARTIAL_CANCELED'] } },
        transaction
      });

      if (payment) {
        try {
          const { orderno, orgpaydate, orgtranamt } = paytagClient.extractCancelParams(payment);
          const cancelamt = refundData.finalRefundAmount;
          const newBalance = payment.balanceAmount - cancelamt;
          const canceltype = newBalance === 0 ? '0' : '1';

          const cancelResp = await paytagClient.cancelPayment({ orderno, orgpaydate, orgtranamt, cancelamt, canceltype });

          await payment.update({
            balanceAmount: newBalance,
            status: newBalance === 0 ? 'CANCELED' : 'PARTIAL_CANCELED'
          }, { transaction });

          console.log(`[requestRefund] PayTag 취소 완료: contractId=${contractId}, cancelamt=${cancelamt}, restamt=${cancelResp.restamt}`);

          // 위약금이 있으면 호스트에게 GUEST_PENALTY Payout 생성
          if (refundData.penaltyAmount > 0) {
            const penaltyPayoutAvailableDate = calculatePayoutAvailableDate(payment.approvedAt);
            const hostBankAccount = await require('../models').UserBankAccount.findOne({
              where: { userId: contract.hostId, isPrimary: true }
            });
            await Payout.create({
              contractId: contract.id,
              refundId: refund.id,
              payoutType: 'GUEST_PENALTY',
              recipientType: 'HOST',
              recipientId: contract.hostId,
              amount: refundData.penaltyAmount,
              status: 'PENDING',
              payableAfter: penaltyPayoutAvailableDate,
              bankName: hostBankAccount?.bankName || null,
              accountNumber: hostBankAccount?.accountNumber || null,
              accountHolder: hostBankAccount?.accountHolder || null
            }, { transaction });
          }
        } catch (pgErr) {
          await transaction.rollback();
          console.error('[requestRefund] PayTag 취소 실패:', pgErr.message);
          return error(res, {
            code: 4900,
            message: `PG 취소 실패: ${pgErr.paytagErrorMessage || pgErr.message}`,
            pgErrorCode: pgErr.paytagErrorCode
          }, 502);
        }
      }
    }

    await transaction.commit();

    // 알림톡 발송 (4-5 게스트 취소) - 트랜잭션 커밋 후
    try {
      const [refundGuest, refundHost, refundRoom] = await Promise.all([
        User.findByPk(contract.guestId, { attributes: ['id', 'phoneNumber', 'name', 'nickname'] }),
        User.findByPk(contract.hostId, { attributes: ['id', 'phoneNumber', 'name', 'nickname'] }),
        Room.findByPk(contract.roomId, { attributes: ['id', 'roomName'] })
      ]);
      NotificationService.notifyContractCanceled(contract, CANCEL_TYPES.GUEST_CANCEL, {
        guest: refundGuest,
        host: refundHost,
        room: refundRoom,
        refundData: {
          guestPenalty: refund.penaltyAmount || 0,
          refundAmount: refund.finalRefundAmount || 0,
          hostPenalty: refund.hostPenaltyAmount || 0,
          settlementAmount: refund.hostPenaltyAmount || 0
        }
      }).catch(err => console.error('환불 취소 알림 전송 실패 (무시됨):', err));
    } catch (notifyErr) {
      console.error('환불 취소 알림 전송 실패 (무시됨):', notifyErr);
    }

    // 예상 완료일 계산 (요청일로부터 영업일 기준 5일 후)
    const estimatedCompletionDate = new Date(refund.requestedAt);
    estimatedCompletionDate.setDate(estimatedCompletionDate.getDate() + 5);

    // 응답 메시지 (자동 승인 여부에 따라 다르게 표시)
    const message = autoApprove
      ? '환불이 자동 승인되었습니다. 영업일 기준 5일 내 처리됩니다.'
      : '환불 요청이 접수되었습니다. 관리자 승인 후 처리됩니다.';

    return created(
      res,
      {
        refundId: refund.id,
        contractId: contract.id,
        refundStatus: refund.refundStatus,
        autoApproved: autoApprove,
        totalRefundAmount: refund.totalRefundAmount,
        finalRefundAmount: refund.finalRefundAmount,
        requestedAt: refund.requestedAt,
        approvedAt: refund.approvedAt,
        estimatedCompletionDate
      },
      message
    );
  } catch (err) {
    await transaction.rollback();
    console.error('환불 요청 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 환불 이력 조회 (게스트/호스트)
 * GET /api/contracts/:contractId/refunds
 */
const getContractRefunds = async (req, res) => {
  try {
    const { contractId } = req.params;
    const userId = req.user.id;

    // 계약 조회 (당사자 확인)
    const contract = await Contract.findOne({
      where: { id: contractId }
    });

    if (!contract) {
      return error(res, { code: 3005, message: '계약을 찾을 수 없습니다' }, 404);
    }

    // 계약 당사자인지 확인
    if (contract.hostId !== userId && contract.guestId !== userId) {
      return error(res, ErrorCodes.FORBIDDEN, 403);
    }

    // 환불 이력 조회
    const refunds = await Refund.findAll({
      where: { contractId },
      order: [['createdAt', 'DESC']]
    });

    return success(
      res,
      {
        refunds: refunds.map(refund => ({
          id: refund.id,
          refundStatus: refund.refundStatus,

          // 환불 계산 정보
          policyTypeUsed: refund.policyTypeUsed,
          daysBeforeCheckin: refund.daysBeforeCheckin,
          isSameDayCancellation: refund.isSameDayCancellation,
          cancellationFaultType: refund.cancellationFaultType,
          hasEzCleaningService: refund.hasEzCleaningService,

          // 원본 금액
          originalDeposit: refund.originalDeposit,
          originalPlatformFee: refund.originalPlatformFee,
          originalRentalFee: refund.originalRentalFee,
          originalCleaningFee: refund.originalCleaningFee,
          originalMaintenanceFee: refund.originalMaintenanceFee,
          originalTotalAmount: refund.originalTotalAmount,

          // 이용료 기반 환불
          usageFee: refund.usageFee,
          usageFeeRefundAmount: refund.usageFeeRefundAmount,
          depositRefundAmount: refund.depositRefundAmount,

          // 환불 금액 (하위 호환)
          rentalFeeRefundRate: refund.rentalFeeRefundRate,
          rentalFeeRefundAmount: refund.rentalFeeRefundAmount,
          cleaningFeeRefundAmount: refund.cleaningFeeRefundAmount,
          maintenanceFeeRefundAmount: refund.maintenanceFeeRefundAmount,
          totalRefundAmount: refund.totalRefundAmount,
          finalRefundAmount: refund.finalRefundAmount,

          // 위약금 분배
          penaltyAmount: refund.penaltyAmount,
          hostPenaltyAmount: refund.hostPenaltyAmount,
          hostPenaltyFee: refund.hostPenaltyFee,

          // 수수료
          guestServiceFeeRefunded: refund.guestServiceFeeRefunded,
          platformFeeDeducted: refund.platformFeeDeducted,

          // 환불 방법
          refundMethod: refund.refundMethod,

          // 사유 및 메시지
          cancellationReason: refund.cancellationReason,
          rejectionReason: refund.rejectionReason,

          // 타임스탬프
          requestedAt: refund.requestedAt,
          approvedAt: refund.approvedAt,
          rejectedAt: refund.rejectedAt,
          completedAt: refund.completedAt
        }))
      },
      '환불 이력을 조회했습니다.'
    );
  } catch (err) {
    console.error('환불 이력 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 결제 정보 조회
 * GET /api/contracts/:contractId/payment-info
 */
const getPaymentInfo = async (req, res) => {
  try {
    const { contractId } = req.params;
    const guestId = req.user.id;

    // 계약 조회
    const contract = await Contract.findOne({
      where: { id: contractId, guestId },
      include: [
        {
          model: Room,
          as: 'room',
          attributes: ['id', 'roomName']
        },
        {
          model: User,
          as: 'guest',
          attributes: ['id', 'name', 'nickname', 'email', 'phoneNumber']
        }
      ]
    });

    if (!contract) {
      return error(res, ErrorCodes.CONTRACT_NOT_FOUND, 404);
    }

    // APPROVED 상태만 결제 가능
    if (contract.status !== 'APPROVED') {
      return error(res, ErrorCodes.PAYMENT_NOT_AVAILABLE, 400);
    }

    // 이미 결제된 경우
    if (contract.status === 'PAYMENT_COMPLETED') {
      return error(res, ErrorCodes.ALREADY_PAID, 400);
    }

    // 렌탈 주문 조회 (INITIAL 타입, PENDING 상태)
    const initialRentalOrder = await RentalOrder.findOne({
      where: {
        contractId: contract.id,
        orderType: 'INITIAL',
        status: 'PENDING'
      },
      include: [{
        model: RentalOrderItem,
        as: 'items',
        where: { status: 'ACTIVE' },
        required: false,
        include: [{
          model: RentalItem,
          as: 'rentalItem',
          attributes: ['id', 'name']
        }]
      }]
    });

    // 응답 데이터 구성
    const responseData = {
      contractId: contract.id,
      orderId: contract.orderId,
      contractAmount: contract.finalTotalAmount,
      orderName: `${contract.room.roomName} (${contract.totalDays}박)`,
      customerEmail: contract.guest.email,
      customerName: contract.guest.name,
      customerPhone: contract.guest.phoneNumber || null
    };

    // 렌탈 주문이 있으면 정보 추가
    if (initialRentalOrder) {
      responseData.rentalOrder = {
        rentalOrderId: initialRentalOrder.rentalOrderId,
        totalAmount: parseFloat(initialRentalOrder.totalAmount),
        items: initialRentalOrder.items?.map(item => ({
          id: item.id,
          name: item.rentalItem?.name,
          quantity: item.quantity,
          pricePerItem: parseFloat(item.pricePerItem),
          totalPrice: parseFloat(item.totalPrice)
        })) || []
      };
      responseData.rentalAmount = parseFloat(initialRentalOrder.totalAmount);
    } else {
      responseData.rentalAmount = 0;
    }

    // 총 결제 금액
    responseData.totalAmount = responseData.contractAmount + responseData.rentalAmount;

    // 기존 호환성 유지 (amount 필드)
    responseData.amount = responseData.totalAmount;

    // 테스트 모드: 프론트가 SDK에 전달할 실제 PG 결제 금액
    const testAmount = paytagClient.getTestAmount();
    if (testAmount) {
      responseData.pgAmount = testAmount;
    }

    // TODO: 가상계좌 지원 시 depositDeadline(입금 마감시간) 추가
    // = min(승인시점+24h, 체크인날짜+입실시간)

    return success(res, responseData, '결제 정보를 조회했습니다.');
  } catch (err) {
    console.error('결제 정보 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 결제 승인 (PayTag API 호출)
 * POST /api/contracts/:contractId/confirm-payment
 */
const confirmPayment = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { contractId } = req.params;
    const { recvPayparam, payType, orderId, amount } = req.body;
    const guestId = req.user.id;

    // 필수 파라미터 검증
    if (!recvPayparam || !orderId || !amount) {
      await transaction.rollback();
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400);
    }

    // 계약 조회
    const contract = await Contract.findOne({
      where: { id: contractId, guestId },
      include: [
        {
          model: Room,
          as: 'room',
          attributes: ['id', 'roomName', 'hostId']
        }
      ],
      transaction
    });

    if (!contract) {
      await transaction.rollback();
      return error(res, ErrorCodes.CONTRACT_NOT_FOUND, 404);
    }

    // 결제 가능 상태 확인
    if (contract.status !== 'APPROVED') {
      await transaction.rollback();
      return error(res, ErrorCodes.PAYMENT_NOT_AVAILABLE, 400);
    }

    // orderId 검증
    if (contract.orderId !== orderId) {
      await transaction.rollback();
      return error(res, ErrorCodes.ORDER_ID_MISMATCH, 400);
    }

    // 금액 검증 (클라이언트 변조 방지)
    // 프론트는 항상 실제 금액을 보냄. 테스트 모드에서는 PG만 테스트금액으로 결제됨.
    // 가상계좌/링크결제는 최소금액 제한이 있어 테스트 금액 적용 제외
    const testAmount = paytagClient.getTestAmount(payType);
    const realAmount = contract.finalTotalAmount;

    if (realAmount !== parseInt(amount, 10)) {
      await transaction.rollback();
      return error(res, ErrorCodes.AMOUNT_MISMATCH, 400);
    }

    if (testAmount) {
      console.log(`🧪 테스트 결제 모드: PG 결제 ${testAmount}원 → DB 저장 ${realAmount}원`);
    }

    // PayTag 결제 승인 API 호출
    let paytagResponse;
    try {
      paytagResponse = await paytagClient.confirmPayment({
        recvPayparam,
        payType: payType || 'CARD'
      });
    } catch (paytagError) {
      await transaction.rollback();

      // 실패 로그 기록
      await PaymentFailureLog.create({
        contractId: contract.id,
        orderId,
        failureCode: paytagError.paytagErrorCode || 'UNKNOWN',
        failureMessage: paytagError.paytagErrorMessage || paytagError.message,
        requestData: { recvPayparam: '(encrypted)', payType, orderId, amount },
        responseData: paytagError.paytagResponse || null,
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip || req.connection.remoteAddress
      });

      console.error('PayTag 결제 승인 실패:', paytagError.message);
      return error(res, ErrorCodes.PAYMENT_CONFIRMATION_FAILED, 400, {
        pgErrorCode: paytagError.paytagErrorCode,
        pgErrorMessage: paytagError.paytagErrorMessage
      });
    }

    const now = new Date();
    const paymentMethod = paytagClient.mapPaymentMethod(payType || 'CARD');

    // TODO: 가상계좌(VBANK) 결제 지원 - 오픈 스펙 제외, 추후 구현
    // - VBANK 선택 시 status: 'WAITING_FOR_DEPOSIT', Contract APPROVED 유지
    // - 웹훅으로 입금 확인 후 DONE + PAYMENT_COMPLETED 전환
    // - 입금 마감시간 검증: min(승인+24h, 체크인시간)
    // - 관련 파일: controllers/paytagWebhookController.js, server.js 웹훅 라우트

    // Payment 레코드 생성 (테스트 모드에서도 실제 금액으로 저장)
    const payment = await Payment.create({
      contractId: contract.id,
      paymentType: 'CONTRACT',
      paymentKey: paytagResponse.tran_key || paytagResponse.recv_orderno || orderId,
      orderId: contract.orderId,
      method: paymentMethod,
      status: 'DONE',
      requestedAt: now,
      approvedAt: now,
      totalAmount: realAmount,
      balanceAmount: realAmount,
      suppliedAmount: Math.round(realAmount / 1.1),
      vat: realAmount - Math.round(realAmount / 1.1),
      taxFreeAmount: 0,
      currency: 'KRW',
      receiptUrl: paytagResponse.receipt_url || null,
      checkoutUrl: null,
      paymentResponse: paytagResponse // 전체 응답 JSON 저장
    }, { transaction });

    // Contract 상태 업데이트
    await contract.update({
      status: 'PAYMENT_COMPLETED',
      paymentMethod: paytagClient.mapContractPaymentMethod(payType || 'CARD'),
      paidAt: now
    }, { transaction });

    // 상태 변경 로그 기록
    await ContractStatusLog.createLog({
      contractId: contract.id,
      fromStatus: 'APPROVED',
      toStatus: 'PAYMENT_COMPLETED',
      changedBy: 'GUEST',
      changedByUserId: guestId,
      reason: '게스트가 결제를 완료했습니다',
      metadata: {
        paymentKey: payment.paymentKey,
        paymentMethod: payment.method,
        totalAmount: payment.totalAmount
      },
      req,
      transaction
    });

    // 렌탈 주문이 있으면 함께 결제 처리
    let initialRentalOrder = await RentalOrder.findOne({
      where: {
        contractId: contract.id,
        orderType: 'INITIAL',
        status: 'PENDING'
      },
      transaction
    });

    // rental_orders가 없지만 contracts.rental_items에 데이터가 있는 경우 (레거시 데이터 마이그레이션)
    if (!initialRentalOrder && contract.rentalItems && Array.isArray(contract.rentalItems) && contract.rentalItems.length > 0) {
      console.log(`📦 레거시 렌탈 아이템 마이그레이션: contractId=${contract.id}`);

      // contracts.rental_items JSON 형식을 createInitialRentalOrder 형식으로 변환
      const rentalItemsForOrder = contract.rentalItems.map(item => ({
        itemId: item.itemId,
        quantity: item.quantity
      }));

      initialRentalOrder = await createInitialRentalOrder(
        contract.id,
        rentalItemsForOrder,
        contract.checkInDate,
        contract.checkOutDate,
        guestId,
        req,
        transaction
      );
      console.log(`✅ 레거시 렌탈 주문 생성 완료: rentalOrderId=${initialRentalOrder.id}`);
    }

    if (initialRentalOrder) {
      await confirmRentalOrderPayment(
        initialRentalOrder,
        payment.paymentKey,
        paymentMethod,
        guestId,
        req,
        transaction
      );
      console.log(`✅ 렌탈 주문 결제 완료: rentalOrderId=${initialRentalOrder.id}`);
    }

    // 채팅방에 시스템 메시지 전송
    const chatRoom = await ChatRoom.findOne({
      where: { contractId: contract.id },
      transaction
    });

    if (chatRoom && chatRoom.firebaseChatRoomId) {
      await sendSystemMessage(
        chatRoom.firebaseChatRoomId,
        SystemMessageTypes.PAYMENT_COMPLETED,
        {
          amount: payment.totalAmount,
          paymentMethod: payment.method
        }
      );
    }

    // Settlement + Payout 생성 (CONTRACT_SETTLEMENT)
    const payoutAvailableDate = calculatePayoutAvailableDate(now);
    const settlementExpectedDate = calculateSettlementDate(contract.checkInDate);
    const settlementAmounts = calculateSettlementAmount(contract);

    const settlement = await Settlement.create({
      contractId: contract.id,
      hostId: contract.hostId,
      status: 'PENDING',
      rentalFee: settlementAmounts.rentalFee,
      maintenanceFee: settlementAmounts.maintenanceFee,
      cleaningFee: settlementAmounts.cleaningFee,
      hostPlatformFee: settlementAmounts.platformFee,
      refundDeduction: 0,
      grossAmount: settlementAmounts.grossSettlement,
      netAmount: settlementAmounts.grossSettlement, // 환불 없으므로 동일
      expectedDate: settlementExpectedDate,
      payoutAvailableDate
    }, { transaction });

    // 호스트 계좌 정보 조회
    const hostBankAccount = await require('../models').UserBankAccount.findOne({
      where: { userId: contract.hostId, isPrimary: true }
    });

    await Payout.create({
      contractId: contract.id,
      settlementId: settlement.id,
      payoutType: 'CONTRACT_SETTLEMENT',
      recipientType: 'HOST',
      recipientId: contract.hostId,
      amount: settlementAmounts.grossSettlement,
      status: 'PENDING',
      payableAfter: payoutAvailableDate,
      bankName: hostBankAccount?.bankName || null,
      accountNumber: hostBankAccount?.accountNumber || null,
      accountHolder: hostBankAccount?.accountHolder || null
    }, { transaction });

    await transaction.commit();

    // 트랜잭션 커밋 후 호스트 자동메시지 발송 (비동기, 실패해도 결제 성공에 영향 없음)
    sendContractConfirmedMessages(contract.id, contract.roomId).catch(err => {
      console.error(`[자동메시지] 계약 확정 메시지 발송 실패 (무시됨):`, err);
    });

    // 결제 완료 알림 (호스트 + 게스트) + 알림톡
    // 옵션 상품 정보 조회 (있는 경우에만)
    let optionItems = '';
    if (initialRentalOrder) {
      try {
        const orderItems = await RentalOrderItem.findAll({
          where: { rentalOrderId: initialRentalOrder.id },
          include: [{ model: RentalItem, as: 'rentalItem', attributes: ['name'] }]
        });
        if (orderItems.length > 0) {
          optionItems = orderItems.map(i => `${i.rentalItem?.name || '옵션'} ${i.quantity}개`).join(', ');
        }
      } catch (rentalErr) {
        console.error('렌탈 아이템 조회 실패 (무시됨):', rentalErr);
      }
    }

    NotificationService.notifyPaymentCompleted(contract, {
      guest: await User.findByPk(contract.guestId, { attributes: ['id', 'phoneNumber', 'name', 'nickname'] }),
      host: await User.findByPk(contract.hostId, { attributes: ['id', 'phoneNumber', 'name', 'nickname'] }),
      room: contract.room,
      paymentData: { guestAmount: payment.totalAmount, hostAmount: contract.totalUsageFee, optionItems }
    }).catch(err => {
      console.error('결제 완료 알림 전송 실패 (무시됨):', err);
    });

    // 예약된 결제 만료 알림 취소 + 새 알림 예약 (Bull Queue)
    try {
      const { cancelScheduledNotification, schedulePaymentCompletedNotifications } = require('../queues/notificationQueue');
      // 결제 만료 알림 취소
      await cancelScheduledNotification(contract.id);
      // 입주 당일 + 옵션 마감 알림 예약
      await schedulePaymentCompletedNotifications(contract.id, contract.checkInDate);
    } catch (queueErr) {
      console.error('알림 큐 처리 실패 (무시됨):', queueErr);
    }

    console.log(`✅ 결제 승인 완료: contractId=${contract.id}, paymentKey=${payment.paymentKey}`);

    // 응답 데이터 구성
    const responseData = {
      contractId: contract.id,
      orderId: contract.orderId,
      status: contract.status,
      payment: {
        paymentKey: payment.paymentKey,
        method: payment.method,
        status: payment.status,
        totalAmount: payment.totalAmount,
        approvedAt: payment.approvedAt,
        receiptUrl: payment.receiptUrl
      }
    };

    // 렌탈 주문 정보 추가
    if (initialRentalOrder) {
      responseData.rentalOrder = {
        rentalOrderId: initialRentalOrder.rentalOrderId,
        totalAmount: parseFloat(initialRentalOrder.totalAmount),
        status: 'PAID'
      };
    }

    return success(res, responseData, '결제가 완료되었습니다');

  } catch (err) {
    await transaction.rollback();
    console.error('결제 승인 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 결제 전 계약의 렌탈 아이템 업데이트 (장바구니 기능)
 * PATCH /api/contracts/:contractId/rental-items
 *
 * @description
 * - PENDING_APPROVAL, APPROVED 상태에서 사용 가능 (결제 전 장바구니 수정)
 * - contracts.rental_items JSON 필드만 업데이트 (RentalOrder 생성 없음)
 * - rentalItemsFee도 함께 재계산
 * - 재고 검증 포함
 * - 결제 완료 후에는 /api/contracts/:contractId/rental-orders API 사용
 */
const updatePendingRentalItems = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { contractId } = req.params;
    const { rentalItems } = req.body; // [{ itemId, quantity }, ...]
    const guestId = req.user.id;

    // 1. 계약 조회
    const contract = await Contract.findByPk(contractId, { transaction });

    if (!contract) {
      await transaction.rollback();
      return error(res, ErrorCodes.CONTRACT_NOT_FOUND, 404);
    }

    // 2. 게스트 본인 확인
    if (contract.guestId !== guestId) {
      await transaction.rollback();
      return error(res, ErrorCodes.FORBIDDEN, 403);
    }

    // 3. 결제 전 상태 확인 (PENDING_APPROVAL, APPROVED만 허용)
    const prePaymentStatuses = ['PENDING_APPROVAL', 'APPROVED'];
    if (!prePaymentStatuses.includes(contract.status)) {
      await transaction.rollback();
      return error(res, {
        code: 4710,
        message: '결제 전 상태에서만 렌탈 아이템을 수정할 수 있습니다'
      }, 400, {
        currentStatus: contract.status,
        allowedStatuses: prePaymentStatuses,
        hint: '결제 완료 후에는 추가 렌탈 주문 API(/api/contracts/:contractId/rental-orders)를 사용하세요'
      });
    }

    // 4. 입주 5일 전 체크
    const now = new Date();
    const checkInDate = new Date(contract.checkInDate);
    const modifiableUntil = new Date(checkInDate);
    modifiableUntil.setDate(modifiableUntil.getDate() - 5);
    modifiableUntil.setHours(23, 59, 59, 999);

    if (now > modifiableUntil) {
      await transaction.rollback();
      return error(res, {
        code: 4701,
        message: '입주 5일 전까지만 렌탈 아이템을 수정할 수 있습니다'
      }, 400, {
        checkInDate: contract.checkInDate,
        modifiableUntil: modifiableUntil.toISOString()
      });
    }

    // 5. 렌탈 아이템이 비어있으면 null로 저장
    if (!rentalItems || !Array.isArray(rentalItems) || rentalItems.length === 0) {
      await contract.update({
        rentalItems: null,
        rentalItemsFee: 0
      }, { transaction });

      await transaction.commit();

      return success(res, {
        contractId: contract.id,
        rentalItems: null,
        rentalItemsFee: 0
      }, '렌탈 아이템이 모두 삭제되었습니다');
    }

    // 6. 재고 검증
    const stockValidation = await validateRentalItemsStock(
      rentalItems,
      contract.checkInDate,
      contract.checkOutDate,
      transaction
    );

    if (!stockValidation.available) {
      await transaction.rollback();
      return error(res, {
        code: 4702,
        message: '일부 렌탈 아이템의 재고가 부족합니다'
      }, 400, {
        unavailableItems: stockValidation.unavailableItems
      });
    }

    // 7. 렌탈 아이템 상세 정보 조회 및 JSON 구성
    const itemDetails = [];
    let totalRentalFee = 0;

    for (const item of rentalItems) {
      const rentalItem = await RentalItem.findByPk(item.itemId, { transaction });

      if (!rentalItem) {
        await transaction.rollback();
        return error(res, {
          code: 4703,
          message: `렌탈 아이템(ID: ${item.itemId})을 찾을 수 없습니다`
        }, 404);
      }

      if (!rentalItem.isActive) {
        await transaction.rollback();
        return error(res, {
          code: 4704,
          message: `${rentalItem.name}은(는) 현재 대여 불가능합니다`
        }, 400);
      }

      const itemPrice = parseFloat(rentalItem.price);
      const itemTotalPrice = itemPrice * item.quantity;
      totalRentalFee += itemTotalPrice;

      itemDetails.push({
        itemId: rentalItem.id,
        name: rentalItem.name,
        description: rentalItem.description,
        imageUrl: rentalItem.imageUrl,
        price: itemPrice,
        quantity: item.quantity,
        totalPrice: itemTotalPrice
      });
    }

    // 8. 계약 업데이트 (rentalItems, rentalItemsFee, finalTotalAmount 재계산)
    const newFinalTotal =
      (contract.subtotal || 0) -
      (contract.discountAmount || 0) +
      (contract.platformFee || 0) +
      (contract.deposit || 0) -
      (contract.rentalItemsFee || 0) +  // 기존 렌탈비 제거
      totalRentalFee;  // 새 렌탈비 추가

    await contract.update({
      rentalItems: itemDetails,
      rentalItemsFee: totalRentalFee,
      finalTotalAmount: newFinalTotal
    }, { transaction });

    await transaction.commit();

    return success(res, {
      contractId: contract.id,
      rentalItems: itemDetails,
      rentalItemsFee: totalRentalFee,
      finalTotalAmount: newFinalTotal,
      itemCount: itemDetails.length,
      totalQuantity: itemDetails.reduce((sum, item) => sum + item.quantity, 0)
    }, '렌탈 아이템이 업데이트되었습니다');

  } catch (err) {
    await transaction.rollback();
    console.error('렌탈 아이템 업데이트 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 게스트 퇴실 요청 (보증금 반환 요청)
 * POST /api/contracts/:contractId/request-checkout
 *
 * 게스트가 퇴실 완료 후 보증금 반환을 요청
 * - COMPLETED 상태에서만 가능 (퇴실 시간 도래 후 자동 COMPLETED 전환)
 * - COMPLETED 전환 후 ~ 48시간 사이에만 요청 가능
 * - 48시간 초과 시 스케줄러가 자동 처리
 * - 호스트에게 퇴실 확인 요청 알림 발송
 */
const requestCheckout = async (req, res) => {
  try {
    const { contractId } = req.params;
    const guestId = req.user.id;

    const contract = await Contract.findByPk(contractId, {
      include: [
        { model: User, as: 'guest', attributes: ['id', 'name', 'nickname'] },
        { model: Room, as: 'room', attributes: ['id', 'roomName'] }
      ]
    });

    if (!contract) {
      return error(res, ErrorCodes.CONTRACT_NOT_FOUND, 404);
    }

    // 게스트 본인만 요청 가능
    if (contract.guestId !== guestId) {
      return error(res, ErrorCodes.FORBIDDEN, 403);
    }

    // 상태 검증 (COMPLETED 상태에서만 퇴실 요청 가능)
    if (contract.status !== 'COMPLETED') {
      return error(res, {
        code: 4612,
        message: '퇴실 요청이 가능한 상태가 아닙니다. (계약 완료 상태에서만 가능)'
      }, 400);
    }

    // 이미 퇴실 처리가 진행 중인 경우
    if (contract.checkoutStatus !== 'NOT_STARTED') {
      return error(res, {
        code: 4613,
        message: '이미 퇴실 처리가 진행 중입니다.'
      }, 400);
    }

    // 시간 검증: COMPLETED 전환 후 ~ 48시간 사이에만 가능
    const now = new Date();
    const checkedOutAt = new Date(contract.checkedOutAt);
    const checkOutDeadline = new Date(checkedOutAt.getTime() + 48 * 60 * 60 * 1000);

    if (now > checkOutDeadline) {
      return error(res, {
        code: 4671,
        message: '퇴실 요청 가능 기간(계약 완료로부터 48시간)이 지났습니다. 자동 처리됩니다.'
      }, 400);
    }

    // 퇴실 요청 처리
    await contract.update({
      checkoutRequested: true,
      checkoutRequestedAt: new Date(),
      checkoutStatus: 'GUEST_COMPLETED'
    });

    // 호스트에게 퇴실 확인 요청 알림 발송
    try {
      await NotificationService.notifyCheckoutRequest(contract, {
        guest: contract.guest,
        room: contract.room
      });
    } catch (notifyErr) {
      console.error('퇴실 요청 알림 전송 실패 (무시됨):', notifyErr);
    }

    return updated(res, {
      contractId: contract.id,
      checkoutRequested: true,
      checkoutRequestedAt: contract.checkoutRequestedAt,
      checkoutStatus: 'GUEST_COMPLETED'
    }, '퇴실 요청이 접수되었습니다. 호스트가 48시간 내 확인하지 않으면 자동 확정됩니다.');

  } catch (err) {
    console.error('퇴실 요청 처리 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 호스트 퇴실 확인 (보증금 반환 승인)
 * POST /api/contracts/:contractId/confirm-checkout
 *
 * 호스트가 방 점검 후 퇴실을 확인
 * - COMPLETED 상태에서만 가능
 * - checkoutStatus=GUEST_COMPLETED인 경우에만 가능
 * - 호스트/게스트 모두에게 퇴실 완료 알림 발송
 */
const confirmCheckout = async (req, res) => {
  try {
    const { contractId } = req.params;
    const hostId = req.user.id;

    const contract = await Contract.findByPk(contractId);

    if (!contract) {
      return error(res, ErrorCodes.CONTRACT_NOT_FOUND, 404);
    }

    // 호스트 본인만 확인 가능
    if (contract.hostId !== hostId) {
      return error(res, ErrorCodes.FORBIDDEN, 403);
    }

    // 상태 검증 (COMPLETED 상태에서만 퇴실 확인 가능)
    if (contract.status !== 'COMPLETED') {
      return error(res, {
        code: 4614,
        message: '퇴실 확인이 가능한 상태가 아닙니다. (계약 완료 상태에서만 가능)'
      }, 400);
    }

    // 게스트 퇴실 요청이 없는 경우 (checkoutStatus로 검증)
    if (contract.checkoutStatus !== 'GUEST_COMPLETED') {
      return error(res, {
        code: 4615,
        message: '게스트의 퇴실 요청이 먼저 필요합니다.'
      }, 400);
    }

    // 이미 호스트가 확인한 경우
    if (contract.checkoutStatus === 'HOST_CONFIRMED') {
      return error(res, {
        code: 4616,
        message: '이미 퇴실 확인 처리되었습니다.'
      }, 400);
    }

    // 퇴실 보류 신청 중인 경우 차단
    if (contract.checkoutStatus === 'HOLD_REQUESTED' || contract.checkoutStatus === 'HOST_PENDING') {
      return error(res, {
        code: 4617,
        message: '퇴실 보류 중에는 퇴실 확인이 불가합니다. 합의 절차를 통해 진행해주세요.'
      }, 400);
    }

    // 퇴실 확인 처리 - 정책 7.6.3: 퇴실확인 완료 시 보증금 반환 프로세스 트리거
    // 호스트 직접 차감 불가, 항상 RETURN_PENDING으로 설정
    await contract.update({
      hostCheckedOut: true,
      hostCheckedOutAt: new Date(),
      refundableDeposit: contract.deposit || 0,
      depositStatus: 'RETURN_PENDING',
      checkoutStatus: 'HOST_CONFIRMED'
    });

    // 호스트/게스트 모두에게 퇴실 완료 알림 발송
    try {
      await NotificationService.notifyCheckoutConfirmed(contract);
    } catch (notifyErr) {
      console.error('퇴실 완료 알림 전송 실패 (무시됨):', notifyErr);
    }

    return updated(res, {
      contractId: contract.id,
      deposit: contract.deposit,
      refundableDeposit: contract.deposit || 0,
      depositStatus: 'RETURN_PENDING',
      checkoutStatus: 'HOST_CONFIRMED'
    }, '퇴실이 확인되었습니다. 보증금 전액 반환 처리가 진행됩니다.');

  } catch (err) {
    console.error('퇴실 확인 처리 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 호스트가 계약 취소 (PAYMENT_COMPLETED 상태에서)
 * PATCH /api/contracts/:contractId/cancel-by-host
 *
 * 위약금 결제 플로우는 PG사 확정 후 구현 예정 (TODO)
 */
const cancelContractByHost = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { contractId } = req.params;
    const hostId = req.user.id;
    const { cancellationReason } = req.body;

    if (!cancellationReason || !cancellationReason.trim()) {
      await transaction.rollback();
      return error(res, {
        code: 4620,
        message: '취소 사유를 입력해주세요.'
      }, 400);
    }

    const contract = await Contract.findByPk(contractId, { transaction });

    if (!contract) {
      await transaction.rollback();
      return error(res, ErrorCodes.CONTRACT_NOT_FOUND, 404);
    }

    if (contract.hostId !== hostId) {
      await transaction.rollback();
      return error(res, ErrorCodes.FORBIDDEN, 403);
    }

    if (contract.status !== 'PAYMENT_COMPLETED') {
      await transaction.rollback();
      return error(res, {
        code: 4621,
        message: '결제 완료 상태에서만 호스트 취소가 가능합니다.'
      }, 400);
    }

    // 호스트 귀책 환불 계산
    const cancellationDate = new Date();
    const refundResult = await calculateRefund(contract, cancellationDate, { faultType: 'HOST' });

    if (!refundResult.success) {
      await transaction.rollback();
      return error(res, {
        code: 4623,
        message: `환불 계산 실패: ${refundResult.error.message}`
      }, 500);
    }

    const refundData = refundResult.data;

    // 호스트 귀책 Refund 레코드 생성 (자동 승인)
    const refund = await Refund.create({
      contractId: contract.id,
      refundStatus: 'APPROVED',

      // 환불 계산 정보
      policyTypeUsed: refundData.policyTypeUsed,
      cancellationDate,
      checkInDate: contract.checkInDate,
      daysBeforeCheckin: refundData.daysBeforeCheckin,
      isSameDayCancellation: refundData.isSameDayCancellation,
      cancellationFaultType: 'HOST',
      hasEzCleaningService: refundData.hasEzCleaningService,

      // 원본 금액
      originalDeposit: refundData.originalDeposit,
      originalPlatformFee: refundData.originalPlatformFee,
      originalRentalFee: contract.rentalFee,
      originalCleaningFee: contract.cleaningFee,
      originalMaintenanceFee: contract.maintenanceFee,
      originalTotalAmount: contract.finalTotalAmount,

      // 이용료 기반 환불
      usageFee: refundData.usageFee,
      usageFeeRefundAmount: refundData.usageFeeRefundAmount,
      depositRefundAmount: refundData.depositRefundAmount,

      // 환불 금액 (하위 호환)
      rentalFeeRefundRate: refundData.rentalFeeRefundRate,
      rentalFeeRefundAmount: refundData.rentalFeeRefundAmount,
      cleaningFeeRefundAmount: refundData.cleaningFeeRefundAmount,
      maintenanceFeeRefundAmount: refundData.maintenanceFeeRefundAmount,
      totalRefundAmount: refundData.totalRefundAmount,

      // 위약금 분배
      penaltyAmount: refundData.penaltyAmount,
      hostPenaltyAmount: refundData.hostPenaltyAmount,
      hostPenaltyFee: refundData.hostPenaltyFee,

      // 수수료
      guestServiceFeeRefunded: refundData.guestServiceFeeRefunded,
      platformFeeDeducted: refundData.platformFeeDeducted,
      finalRefundAmount: refundData.finalRefundAmount,

      // 호스트 부담금 (위약금 + 게스트 서비스 수수료)
      hostBurdenAmount: refundData.penaltyAmount + refundData.originalPlatformFee,
      hostBurdenStatus: 'PENDING',

      // 게스트 보전 지급액 (위약금)
      guestCompensationAmount: refundData.penaltyAmount,
      guestCompensationStatus: refundData.penaltyAmount > 0 ? 'PENDING' : null,

      // 환불 방법
      refundMethod: 'ORIGINAL_PAYMENT',

      // 사유
      cancellationReason,

      // 타임스탬프
      requestedAt: cancellationDate,
      approvedAt: cancellationDate
    }, { transaction });

    // PayTag PG 전액 환불 (호스트 귀책 → 게스트 전액 반환)
    if (refundData.finalRefundAmount > 0) {
      const payment = await Payment.findOne({
        where: { contractId: contract.id, status: { [Op.in]: ['DONE', 'PARTIAL_CANCELED'] } },
        transaction
      });

      if (payment) {
        try {
          const { orderno, orgpaydate, orgtranamt } = paytagClient.extractCancelParams(payment);
          const cancelamt = refundData.finalRefundAmount;
          const newBalance = payment.balanceAmount - cancelamt;
          const canceltype = newBalance === 0 ? '0' : '1';

          const cancelResp = await paytagClient.cancelPayment({ orderno, orgpaydate, orgtranamt, cancelamt, canceltype });

          await payment.update({
            balanceAmount: newBalance,
            status: newBalance === 0 ? 'CANCELED' : 'PARTIAL_CANCELED'
          }, { transaction });

          console.log(`[cancelByHost] PayTag 취소 완료: contractId=${contract.id}, cancelamt=${cancelamt}, restamt=${cancelResp.restamt}`);
        } catch (pgErr) {
          await transaction.rollback();
          console.error('[cancelByHost] PayTag 취소 실패:', pgErr.message);
          return error(res, {
            code: 4900,
            message: `PG 취소 실패: ${pgErr.paytagErrorMessage || pgErr.message}`,
            pgErrorCode: pgErr.paytagErrorCode
          }, 502);
        }
      }
    }
    await contract.update({
      status: 'CANCELLED_BY_HOST',
      cancellationReason,
      cancelledAt: cancellationDate
    }, { transaction });

    // 계약 상태 변경 로그
    await ContractStatusLog.create({
      contractId: contract.id,
      fromStatus: 'PAYMENT_COMPLETED',
      toStatus: 'CANCELLED_BY_HOST',
      changedBy: 'HOST',
      changedByUserId: hostId,
      reason: cancellationReason,
      metadata: JSON.stringify({
        cancelledByHost: true,
        refundId: refund.id,
        totalRefundAmount: refund.totalRefundAmount,
        penaltyAmount: refund.penaltyAmount,
        hostPenaltyAmount: refund.hostPenaltyAmount,
        guestServiceFeeRefunded: refund.guestServiceFeeRefunded,
        hostBurdenAmount: refund.hostBurdenAmount,
        guestCompensationAmount: refund.guestCompensationAmount
      })
    }, { transaction });

    // HOST_CANCELLATION_COMPENSATION Payout은 호스트가 부담금을 PG 결제 완료한 시점에 생성
    // POST /api/contracts/:contractId/host-burden-payment 참고

    await transaction.commit();

    // 채팅방 시스템 메시지 발송
    try {
      const chatRoom = await ChatRoom.findOne({ where: { contractId: contract.id } });
      if (chatRoom && chatRoom.firebaseChatRoomId) {
        const messageText = getSystemMessageTemplate(SystemMessageTypes.CONTRACT_CANCELED_BY_HOST);
        await sendSystemMessage(chatRoom.firebaseChatRoomId, messageText, SystemMessageTypes.CONTRACT_CANCELED_BY_HOST);
      }
    } catch (chatErr) {
      console.error('호스트 취소 시스템 메시지 전송 실패 (무시됨):', chatErr);
    }

    // 게스트에게 알림 발송 + 알림톡
    try {
      const [cancelGuest, cancelHost, cancelRoom] = await Promise.all([
        User.findByPk(contract.guestId, { attributes: ['id', 'phoneNumber', 'name', 'nickname'] }),
        User.findByPk(contract.hostId, { attributes: ['id', 'phoneNumber', 'name', 'nickname'] }),
        Room.findByPk(contract.roomId, { attributes: ['id', 'roomName'] })
      ]);
      await NotificationService.notifyContractCanceled(contract, 'host', {
        guest: cancelGuest,
        host: cancelHost,
        room: cancelRoom,
        refundData: {
          penaltyAmount: refund.penaltyAmount,
          refundAmount: refund.totalRefundAmount
        }
      });
    } catch (notifyErr) {
      console.error('호스트 취소 알림 전송 실패 (무시됨):', notifyErr);
    }

    return updated(res, {
      contractId: contract.id,
      status: 'CANCELLED_BY_HOST',
      cancelledAt: contract.cancelledAt,
      refundId: refund.id,
      totalRefundAmount: refund.totalRefundAmount,
      penaltyAmount: refund.penaltyAmount,
      hostPenaltyAmount: refund.hostPenaltyAmount,
      hostBurdenAmount: refund.hostBurdenAmount,
      hostBurdenStatus: refund.hostBurdenStatus,
      guestCompensationAmount: refund.guestCompensationAmount
    }, '계약이 취소되었습니다. 게스트에게 전액 환불이 진행됩니다.');

  } catch (err) {
    await transaction.rollback();
    console.error('호스트 계약 취소 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 호스트가 계약 취소 요청 (IN_PROGRESS 상태에서, 관리자 승인 필요)
 * POST /api/contracts/:contractId/cancel-request
 */
const requestCancelByHost = async (req, res) => {
  try {
    const { contractId } = req.params;
    const hostId = req.user.id;
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return error(res, {
        code: 4622,
        message: '취소 요청 사유를 입력해주세요.'
      }, 400);
    }

    const contract = await Contract.findByPk(contractId);

    if (!contract) {
      return error(res, ErrorCodes.CONTRACT_NOT_FOUND, 404);
    }

    if (contract.hostId !== hostId) {
      return error(res, ErrorCodes.FORBIDDEN, 403);
    }

    if (contract.status !== 'IN_PROGRESS') {
      return error(res, {
        code: 4623,
        message: '임대 진행 중 상태에서만 취소 요청이 가능합니다.'
      }, 400);
    }

    // 관리자 확인 큐 등록 (ContractStatusLog에 메타데이터로 기록)
    await ContractStatusLog.create({
      contractId: contract.id,
      fromStatus: 'IN_PROGRESS',
      toStatus: 'IN_PROGRESS', // 상태 변경 없이 취소 요청 기록
      changedBy: 'HOST',
      changedByUserId: hostId,
      reason,
      metadata: JSON.stringify({
        type: 'CANCEL_REQUEST_BY_HOST',
        requestedAt: new Date(),
        adminApprovalRequired: true
      })
    });

    // 채팅방 시스템 메시지 발송
    try {
      const chatRoom = await ChatRoom.findOne({ where: { contractId: contract.id } });
      if (chatRoom && chatRoom.firebaseChatRoomId) {
        const messageText = getSystemMessageTemplate(SystemMessageTypes.CANCEL_REQUEST_BY_HOST);
        await sendSystemMessage(chatRoom.firebaseChatRoomId, messageText, SystemMessageTypes.CANCEL_REQUEST_BY_HOST);
      }
    } catch (chatErr) {
      console.error('취소 요청 시스템 메시지 전송 실패 (무시됨):', chatErr);
    }

    // 게스트에게 알림 발송
    try {
      await NotificationService.sendNotification({
        userId: contract.guestId,
        type: 'CONTRACT',
        title: '계약 취소 요청',
        message: '호스트가 계약 취소를 요청했습니다. 관리자 확인 후 처리됩니다.',
        data: { contractId: contract.id }
      });
    } catch (notifyErr) {
      console.error('취소 요청 알림 전송 실패 (무시됨):', notifyErr);
    }

    return success(res, {
      contractId: contract.id,
      cancelRequestStatus: 'PENDING_ADMIN_APPROVAL',
      reason
    }, '취소 요청이 접수되었습니다. 관리자 승인 후 처리됩니다.');

  } catch (err) {
    console.error('호스트 취소 요청 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 호스트가 퇴실 확인 보류 (checkoutStatus: GUEST_COMPLETED → HOST_PENDING)
 * PATCH /api/contracts/:contractId/checkout-hold
 */
const holdCheckout = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { contractId } = req.params;
    const hostId = req.user.id;
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      await transaction.rollback();
      return error(res, {
        code: 4630,
        message: '퇴실 보류 사유를 입력해주세요.'
      }, 400);
    }

    const contract = await Contract.findByPk(contractId, { transaction });

    if (!contract) {
      await transaction.rollback();
      return error(res, ErrorCodes.CONTRACT_NOT_FOUND, 404);
    }

    if (contract.hostId !== hostId) {
      await transaction.rollback();
      return error(res, ErrorCodes.FORBIDDEN, 403);
    }

    if (contract.status !== 'COMPLETED') {
      await transaction.rollback();
      return error(res, {
        code: 4631,
        message: '계약 완료 상태에서만 퇴실 보류가 가능합니다.'
      }, 400);
    }

    if (contract.checkoutStatus !== 'GUEST_COMPLETED') {
      await transaction.rollback();
      return error(res, {
        code: 4632,
        message: '게스트가 퇴실 완료한 상태에서만 보류가 가능합니다.'
      }, 400);
    }

    // 정책 7.6.3: 퇴실확인 완료 이후에는 보류 신청 불가 (정책 불가역성)
    if (contract.checkoutStatus === 'HOST_CONFIRMED') {
      await transaction.rollback();
      return error(res, {
        code: 4633,
        message: '퇴실 확인 완료 후에는 보류 신청이 불가합니다.'
      }, 400);
    }

    // 정책 7.7.1: 호스트 퇴실확인 데드라인 내(48h)에만 신청 가능
    // 남은 카운트다운 시간 계산 (게스트 퇴실완료 시점 + 48h - 현재)
    const now = new Date();
    const guestCompletedAt = contract.checkoutRequestedAt;
    let holdRemainingMs = null;
    if (guestCompletedAt) {
      const deadline = new Date(guestCompletedAt);
      deadline.setHours(deadline.getHours() + 48);
      holdRemainingMs = Math.max(0, deadline.getTime() - now.getTime());
    }

    // 정책 7.7.2: 신청 즉시 카운트다운 정지, 자동 반환 스케줄 정지
    // HOLD_REQUESTED 상태로 설정 (관리자 승인 대기)
    await contract.update({
      checkoutStatus: 'HOLD_REQUESTED',
      holdRequestedAt: now,
      holdRemainingMs,
      deductionReason: reason.trim()
    }, { transaction });

    // 계약 상태 변경 로그
    await ContractStatusLog.create({
      contractId: contract.id,
      fromStatus: 'COMPLETED',
      toStatus: 'COMPLETED',
      changedBy: 'HOST',
      changedByUserId: hostId,
      reason: reason.trim(),
      metadata: JSON.stringify({
        type: 'CHECKOUT_HOLD_REQUESTED',
        checkoutStatusChange: 'GUEST_COMPLETED → HOLD_REQUESTED',
        holdRemainingMs
      })
    }, { transaction });

    await transaction.commit();

    // 채팅방 시스템 메시지 발송 (트랜잭션 외부)
    try {
      const chatRoom = await ChatRoom.findOne({ where: { contractId: contract.id } });
      if (chatRoom && chatRoom.firebaseChatRoomId) {
        const messageText = getSystemMessageTemplate(SystemMessageTypes.DEPOSIT_HOLD_REQUESTED);
        await sendSystemMessage(chatRoom.firebaseChatRoomId, messageText, SystemMessageTypes.DEPOSIT_HOLD_REQUESTED);
      }
    } catch (chatErr) {
      console.error('퇴실 보류 신청 시스템 메시지 전송 실패 (무시됨):', chatErr);
    }

    // 게스트에게 알림 발송 (트랜잭션 외부)
    try {
      await NotificationService.sendNotification({
        userId: contract.guestId,
        type: 'CONTRACT',
        title: '퇴실 확인 보류 신청',
        message: '호스트가 퇴실 확인 보류를 신청했습니다. 관리자 확인 중입니다.',
        data: { contractId: contract.id }
      });
    } catch (notifyErr) {
      console.error('퇴실 보류 신청 알림 전송 실패 (무시됨):', notifyErr);
    }

    return updated(res, {
      contractId: contract.id,
      checkoutStatus: 'HOLD_REQUESTED',
      holdReason: reason.trim(),
      holdRemainingMs
    }, '퇴실 확인 보류가 신청되었습니다. 관리자 승인을 기다립니다.');

  } catch (err) {
    await transaction.rollback();
    console.error('퇴실 보류 신청 처리 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 호스트가 합의 내용 제출 (checkoutStatus: HOST_PENDING 유지, DepositAgreement 생성)
 * POST /api/contracts/:contractId/deposit-agreement
 */
const submitDepositAgreement = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { contractId } = req.params;
    const hostId = req.user.id;
    const { deductAmount, agreementText } = req.body;

    if (deductAmount == null || deductAmount < 0) {
      await transaction.rollback();
      return error(res, {
        code: 4640,
        message: '차감 금액을 올바르게 입력해주세요. (0 이상)'
      }, 400);
    }

    if (!agreementText || !agreementText.trim()) {
      await transaction.rollback();
      return error(res, {
        code: 4641,
        message: '합의 내용을 입력해주세요.'
      }, 400);
    }

    const contract = await Contract.findByPk(contractId, { transaction });

    if (!contract) {
      await transaction.rollback();
      return error(res, ErrorCodes.CONTRACT_NOT_FOUND, 404);
    }

    if (contract.hostId !== hostId) {
      await transaction.rollback();
      return error(res, ErrorCodes.FORBIDDEN, 403);
    }

    if (contract.status !== 'COMPLETED') {
      await transaction.rollback();
      return error(res, {
        code: 4642,
        message: '계약 완료 상태에서만 합의 제출이 가능합니다.'
      }, 400);
    }

    if (contract.checkoutStatus !== 'HOST_PENDING') {
      await transaction.rollback();
      return error(res, {
        code: 4643,
        message: '관리자 보류 승인 후 합의 상태에서만 합의 내용을 제출할 수 있습니다.'
      }, 400);
    }

    // 게스트가 이미 동의한 경우 수정 불가
    const existingAgreement = await DepositAgreement.findOne({ where: { contractId: contract.id }, transaction });
    if (existingAgreement && existingAgreement.status === 'ACCEPTED') {
      await transaction.rollback();
      return error(res, {
        code: 4647,
        message: '게스트가 이미 합의에 동의하여 수정이 불가합니다.'
      }, 409);
    }

    if (deductAmount > (contract.deposit || 0)) {
      await transaction.rollback();
      return error(res, {
        code: 4644,
        message: `차감 금액은 보증금(${contract.deposit?.toLocaleString()}원)을 초과할 수 없습니다.`
      }, 400);
    }

    // 정책 7.9.1: 합의 데드라인 = 관리자 보류 승인 시점 + 10일
    if (!contract.holdApprovedAt) {
      await transaction.rollback();
      return error(res, {
        code: 4645,
        message: '관리자 보류 승인 정보가 없습니다. 관리자에게 문의해주세요.'
      }, 400);
    }

    const deadline = new Date(contract.holdApprovedAt);
    deadline.setDate(deadline.getDate() + 10);
    if (new Date() > deadline) {
      await transaction.rollback();
      return error(res, {
        code: 4646,
        message: '합의 기한(보류 승인 후 10일)이 경과하여 합의 제출이 불가합니다. 보증금이 게스트에게 전액 반환됩니다.'
      }, 400);
    }

    // 기존 합의가 있으면 업데이트, 없으면 생성
    const [depositAgreement] = await DepositAgreement.upsert({
      contractId: contract.id,
      deductAmount,
      agreementText: agreementText.trim(),
      holdReason: contract.deductionReason,
      adminApprovedAt: contract.holdApprovedAt,
      submittedAt: new Date(),
      status: 'SUBMITTED',
      acceptedAt: null
    }, { transaction });

    // checkoutStatus는 HOST_PENDING 유지 (합의 제출 여부는 DepositAgreement.status로 판단)

    // 계약 상태 변경 로그
    await ContractStatusLog.create({
      contractId: contract.id,
      fromStatus: 'COMPLETED',
      toStatus: 'COMPLETED',
      changedBy: 'HOST',
      changedByUserId: hostId,
      reason: `합의 내용 제출: 차감 ${deductAmount.toLocaleString()}원`,
      metadata: JSON.stringify({
        type: 'DEPOSIT_AGREEMENT_SUBMITTED',
        deductAmount,
        agreementText: agreementText.trim()
      })
    }, { transaction });

    await transaction.commit();

    // 채팅방 시스템 메시지 발송
    try {
      const chatRoom = await ChatRoom.findOne({ where: { contractId: contract.id } });
      if (chatRoom && chatRoom.firebaseChatRoomId) {
        const messageText = getSystemMessageTemplate(SystemMessageTypes.DEPOSIT_AGREEMENT_SUBMITTED, { deductAmount });
        await sendSystemMessage(chatRoom.firebaseChatRoomId, messageText, SystemMessageTypes.DEPOSIT_AGREEMENT_SUBMITTED);
      }
    } catch (chatErr) {
      console.error('합의 제출 시스템 메시지 전송 실패 (무시됨):', chatErr);
    }

    // 게스트에게 알림 발송
    try {
      await NotificationService.sendNotification({
        userId: contract.guestId,
        type: 'CONTRACT',
        title: '합의 내용 확인 요청',
        message: `호스트가 보증금 합의 내용을 제출했습니다. 확인해주세요. (차감 요청: ${deductAmount.toLocaleString()}원)`,
        data: { contractId: contract.id }
      });
    } catch (notifyErr) {
      console.error('합의 제출 알림 전송 실패 (무시됨):', notifyErr);
    }

    // 알림톡 발송 (4-10 보증금 정산 합의 요청)
    try {
      const AlimtalkService = require('../services/alimtalkService');
      const settlementGuest = await User.findByPk(contract.guestId, { attributes: ['id', 'phoneNumber', 'name', 'nickname'] });
      AlimtalkService.sendDepositSettlementSubmitted(contract, settlementGuest, deductAmount, agreementText)
        .catch(err => console.error('[Alimtalk] deposit_settlement_submitted 실패:', err.message));
    } catch (alimtalkErr) {
      console.error('합의 제출 알림톡 발송 실패 (무시됨):', alimtalkErr);
    }

    return created(res, {
      contractId: contract.id,
      checkoutStatus: 'HOST_PENDING',
      depositAgreement: {
        deductAmount,
        agreementText: agreementText.trim(),
        submittedAt: depositAgreement.submittedAt,
        deposit: contract.deposit
      }
    }, '합의 내용이 제출되었습니다. 게스트의 동의를 기다립니다.');

  } catch (err) {
    await transaction.rollback();
    console.error('합의 내용 제출 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 합의 내용 조회 (호스트/게스트 모두 조회 가능)
 * GET /api/contracts/:contractId/deposit-agreement
 */
const getDepositAgreement = async (req, res) => {
  try {
    const { contractId } = req.params;
    const userId = req.user.id;

    const contract = await Contract.findByPk(contractId, {
      include: [
        {
          model: DepositAgreement,
          as: 'depositAgreement'
        }
      ]
    });

    if (!contract) {
      return error(res, ErrorCodes.CONTRACT_NOT_FOUND, 404);
    }

    // 계약 당사자만 조회 가능
    if (contract.hostId !== userId && contract.guestId !== userId) {
      return error(res, ErrorCodes.FORBIDDEN, 403);
    }

    if (!contract.depositAgreement) {
      return error(res, {
        code: 4650,
        message: '합의 내용이 없습니다.'
      }, 404);
    }

    const agreement = contract.depositAgreement;

    return success(res, {
      contractId: contract.id,
      deposit: contract.deposit,
      checkoutStatus: contract.checkoutStatus,
      depositAgreement: {
        id: agreement.id,
        deductAmount: agreement.deductAmount,
        agreementText: agreement.agreementText,
        holdReason: agreement.holdReason,
        status: agreement.status,
        statusLabel: DepositAgreement.STATUS_LABELS[agreement.status],
        submittedAt: agreement.submittedAt,
        acceptedAt: agreement.acceptedAt,
        refundableAmount: (contract.deposit || 0) - agreement.deductAmount
      }
    }, '합의 내용 조회 성공');

  } catch (err) {
    console.error('합의 내용 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 게스트가 합의에 동의 (checkoutStatus: HOST_PENDING → HOST_CONFIRMED → COMPLETED)
 * POST /api/contracts/:contractId/deposit-agreement/accept
 */
const acceptDepositAgreement = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { contractId } = req.params;
    const guestId = req.user.id;

    const contract = await Contract.findByPk(contractId, {
      include: [
        { model: DepositAgreement, as: 'depositAgreement' }
      ],
      transaction
    });

    if (!contract) {
      await transaction.rollback();
      return error(res, ErrorCodes.CONTRACT_NOT_FOUND, 404);
    }

    if (contract.guestId !== guestId) {
      await transaction.rollback();
      return error(res, ErrorCodes.FORBIDDEN, 403);
    }

    if (contract.checkoutStatus !== 'HOST_PENDING') {
      await transaction.rollback();
      return error(res, {
        code: 4660,
        message: '합의 진행 상태에서만 합의 동의가 가능합니다.'
      }, 400);
    }

    if (!contract.depositAgreement || contract.depositAgreement.status !== 'SUBMITTED') {
      await transaction.rollback();
      return error(res, {
        code: 4661,
        message: '호스트가 제출한 합의 내용이 없습니다.'
      }, 404);
    }

    const depositDeduction = contract.depositAgreement.deductAmount;
    const refundableDeposit = Math.max(0, (contract.deposit || 0) - depositDeduction);

    // 차감 금액에 따라 차감확정/반환확정 전이
    const depositStatus = depositDeduction > 0 ? 'DEDUCTION_CONFIRMED' : 'RETURN_CONFIRMED';

    // CONTRACT 타입 결제 조회 (보증금은 계약 결제에 포함)
    const payment = await Payment.findOne({
      where: { contractId: contract.id, paymentType: 'CONTRACT', status: 'DONE' },
      order: [['createdAt', 'DESC']],
      transaction
    });

    // 합의 동의 처리
    await contract.depositAgreement.update({
      status: 'ACCEPTED',
      acceptedAt: new Date()
    }, { transaction });

    // 퇴실 확인 + 보증금 상태 확정 처리
    await contract.update({
      checkoutStatus: 'HOST_CONFIRMED',
      hostCheckedOut: true,
      hostCheckedOutAt: new Date(),
      depositDeduction,
      deductionReason: contract.depositAgreement.agreementText,
      refundableDeposit,
      depositStatus
    }, { transaction });

    // 계약 상태 변경 로그
    await ContractStatusLog.create({
      contractId: contract.id,
      fromStatus: 'COMPLETED',
      toStatus: 'COMPLETED',
      changedBy: 'GUEST',
      changedByUserId: guestId,
      reason: '보증금 합의 동의',
      metadata: JSON.stringify({
        type: 'DEPOSIT_AGREEMENT_ACCEPTED',
        depositDeduction,
        refundableDeposit,
        depositStatus
      })
    }, { transaction });

    // 차감확정 시 DEPOSIT_DEDUCTION Payout 생성 (호스트 수령)
    if (depositStatus === 'DEDUCTION_CONFIRMED' && depositDeduction > 0) {
      const deductionPayableDate = payment
        ? calculatePayoutAvailableDate(payment.approvedAt)
        : new Date();

      const hostBankAccount = await require('../models').UserBankAccount.findOne({
        where: { userId: contract.hostId, isPrimary: true }
      });

      await Payout.create({
        contractId: contract.id,
        refundId: null,
        payoutType: 'DEPOSIT_DEDUCTION',
        recipientType: 'HOST',
        recipientId: contract.hostId,
        amount: depositDeduction,
        status: 'PENDING',
        payableAfter: deductionPayableDate,
        bankName: hostBankAccount?.bankName || null,
        accountNumber: hostBankAccount?.accountNumber || null,
        accountHolder: hostBankAccount?.accountHolder || null
      }, { transaction });
    }

    await transaction.commit();

    // 게스트에게 보증금 부분환불 PG 실행 (트랜잭션 외부 - PG 실패 시 롤백 불가)
    // refundableDeposit > 0 이고 payment가 있는 경우에만 실행
    if (refundableDeposit > 0 && payment) {
      try {
        const { orderno, orgpaydate, orgtranamt } = paytagClient.extractCancelParams(payment);
        const newBalance = payment.balanceAmount - refundableDeposit;
        const canceltype = newBalance === 0 ? '0' : '1';

        await paytagClient.cancelPayment({
          orderno,
          orgpaydate,
          orgtranamt,
          cancelamt: refundableDeposit,
          canceltype
        });

        await payment.update({
          balanceAmount: newBalance,
          status: newBalance === 0 ? 'CANCELED' : 'PARTIAL_CANCELED'
        });

        console.log(`[acceptDepositAgreement] 보증금 부분환불 완료: contractId=${contractId}, refundableDeposit=${refundableDeposit}`);
      } catch (pgErr) {
        console.error(`[acceptDepositAgreement] 보증금 부분환불 PG 실패 (contractId=${contractId}):`, pgErr.message);

        // depositStatus를 REFUND_FAILED로 변경하여 관리자가 식별 가능하게 함
        await contract.update({ depositStatus: 'REFUND_FAILED' });

        // PaymentFailureLog에 실패 기록 저장
        await PaymentFailureLog.create({
          contractId: contract.id,
          orderId: payment.orderId || `DEPOSIT_REFUND_${contract.id}`,
          failureCode: pgErr.paytagErrorCode || 'PG_CANCEL_FAILED',
          failureMessage: pgErr.paytagErrorMessage || pgErr.message,
          requestData: {
            type: 'DEPOSIT_PARTIAL_REFUND',
            cancelamt: refundableDeposit,
            depositDeduction,
            depositStatus
          },
          responseData: pgErr.paytagResponse || null
        });

        // 상태 변경 로그
        await ContractStatusLog.create({
          contractId: contract.id,
          fromStatus: 'COMPLETED',
          toStatus: 'COMPLETED',
          changedBy: 'SYSTEM',
          changedByUserId: null,
          reason: `보증금 부분환불 PG 실패: ${pgErr.paytagErrorMessage || pgErr.message}`,
          metadata: JSON.stringify({
            type: 'DEPOSIT_REFUND_FAILED',
            refundableDeposit,
            errorCode: pgErr.paytagErrorCode,
            errorMessage: pgErr.message
          })
        });
      }
    }

    // 채팅방 시스템 메시지 발송
    try {
      const chatRoom = await ChatRoom.findOne({ where: { contractId: contract.id } });
      if (chatRoom && chatRoom.firebaseChatRoomId) {
        const messageType = depositDeduction > 0
          ? SystemMessageTypes.DEPOSIT_DEDUCTION_CONFIRMED
          : SystemMessageTypes.DEPOSIT_RETURN_CONFIRMED;
        const messageText = getSystemMessageTemplate(messageType);
        await sendSystemMessage(chatRoom.firebaseChatRoomId, messageText, messageType);
      }
    } catch (chatErr) {
      console.error('합의 동의 시스템 메시지 전송 실패 (무시됨):', chatErr);
    }

    // 양측 알림 발송
    try {
      await NotificationService.notifyCheckoutConfirmed(contract);
    } catch (notifyErr) {
      console.error('합의 동의 알림 전송 실패 (무시됨):', notifyErr);
    }

    // 알림톡 발송 (4-11 보증금 정산 합의 완료)
    try {
      const AlimtalkService = require('../services/alimtalkService');
      const [agreementGuest, agreementHost] = await Promise.all([
        User.findByPk(contract.guestId, { attributes: ['id', 'phoneNumber', 'name', 'nickname'] }),
        User.findByPk(contract.hostId, { attributes: ['id', 'phoneNumber', 'name', 'nickname'] })
      ]);
      AlimtalkService.sendDepositSettlementAgreed(contract, agreementGuest, agreementHost, {
        guestAmount: refundableDeposit,
        hostAmount: depositDeduction
      }).catch(err => console.error('[Alimtalk] deposit_settlement_agreed 실패:', err.message));
    } catch (alimtalkErr) {
      console.error('합의 동의 알림톡 발송 실패 (무시됨):', alimtalkErr);
    }

    return updated(res, {
      contractId: contract.id,
      status: 'COMPLETED',
      checkoutStatus: 'HOST_CONFIRMED',
      deposit: contract.deposit,
      depositDeduction,
      refundableDeposit,
      depositStatus
    }, '합의가 완료되었습니다. 보증금 정산이 진행됩니다.');

  } catch (err) {
    await transaction.rollback();
    console.error('합의 동의 처리 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 호스트 부담금 결제 정보 조회
 * GET /api/contracts/:contractId/host-burden-payment-info
 *
 * 호스트 귀책 취소 후 호스트가 지불해야 할 부담금 정보를 반환
 * - hostBurdenAmount: 위약금 + 게스트 서비스수수료
 * - hostBurdenStatus: PENDING이어야 결제 가능
 */
const getHostBurdenPaymentInfo = async (req, res) => {
  try {
    const { contractId } = req.params;
    const hostId = req.user.id;

    const contract = await Contract.findOne({
      where: { id: contractId, hostId },
      include: [
        { model: Room, as: 'room', attributes: ['id', 'roomName'] },
        { model: User, as: 'host', attributes: ['id', 'name', 'nickname', 'email', 'phoneNumber'] }
      ]
    });

    if (!contract) {
      return error(res, ErrorCodes.CONTRACT_NOT_FOUND, 404);
    }

    if (contract.status !== 'CANCELLED_BY_HOST') {
      return error(res, { code: 5001, message: '호스트 귀책 취소 상태에서만 조회할 수 있습니다.' }, 400);
    }

    const refund = await Refund.findOne({
      where: { contractId: contract.id },
      order: [['createdAt', 'DESC']]
    });

    if (!refund) {
      return error(res, { code: 5002, message: '환불 내역을 찾을 수 없습니다.' }, 404);
    }

    if (refund.hostBurdenStatus !== 'PENDING') {
      return error(res, {
        code: 5003,
        message: refund.hostBurdenStatus === 'PAID'
          ? '이미 결제 완료된 부담금입니다.'
          : '결제할 수 없는 상태입니다.'
      }, 400);
    }

    const testAmount = paytagClient.getTestAmount();

    return success(res, {
      contractId: contract.id,
      orderId: contract.orderId,
      refundId: refund.id,
      hostBurdenAmount: refund.hostBurdenAmount,
      hostBurdenStatus: refund.hostBurdenStatus,
      guestCompensationAmount: refund.guestCompensationAmount,
      orderName: `호스트 귀책 취소 부담금 (${contract.room?.roomName || ''})`,
      customerName: contract.host?.name || contract.host?.nickname,
      customerPhone: contract.host?.phoneNumber || null,
      ...(testAmount ? { pgAmount: testAmount } : {})
    }, '호스트 부담금 결제 정보를 조회했습니다.');
  } catch (err) {
    console.error('호스트 부담금 결제 정보 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 호스트 부담금 결제 승인 (PayTag API 호출)
 * POST /api/contracts/:contractId/host-burden-payment
 *
 * Body: { recvPayparam, payType, orderId, amount }
 *
 * 처리 순서:
 * 1. PayTag 결제 승인
 * 2. Payment 레코드 생성 (HOST_BURDEN 타입)
 * 3. Refund.hostBurdenStatus = 'PAID'
 * 4. HOST_CANCELLATION_COMPENSATION Payout 생성 (payableAfter = 부담금 결제일 + 3영업일)
 */
const confirmHostBurdenPayment = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { contractId } = req.params;
    const { recvPayparam, payType, orderId, amount } = req.body;
    const hostId = req.user.id;

    if (!recvPayparam || !orderId || !amount) {
      await transaction.rollback();
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400);
    }

    const contract = await Contract.findOne({
      where: { id: contractId, hostId },
      transaction
    });

    if (!contract) {
      await transaction.rollback();
      return error(res, ErrorCodes.CONTRACT_NOT_FOUND, 404);
    }

    if (contract.status !== 'CANCELLED_BY_HOST') {
      await transaction.rollback();
      return error(res, { code: 5001, message: '호스트 귀책 취소 상태에서만 결제할 수 있습니다.' }, 400);
    }

    const refund = await Refund.findOne({
      where: { contractId: contract.id },
      order: [['createdAt', 'DESC']],
      transaction
    });

    if (!refund) {
      await transaction.rollback();
      return error(res, { code: 5002, message: '환불 내역을 찾을 수 없습니다.' }, 404);
    }

    if (refund.hostBurdenStatus !== 'PENDING') {
      await transaction.rollback();
      return error(res, {
        code: 5003,
        message: refund.hostBurdenStatus === 'PAID'
          ? '이미 결제 완료된 부담금입니다.'
          : '결제할 수 없는 상태입니다.'
      }, 400);
    }

    // orderId 검증 (계약 orderId 기반)
    if (contract.orderId !== orderId) {
      await transaction.rollback();
      return error(res, ErrorCodes.ORDER_ID_MISMATCH, 400);
    }

    // 금액 검증
    const testAmount = paytagClient.getTestAmount(payType);
    if (refund.hostBurdenAmount !== parseInt(amount, 10)) {
      await transaction.rollback();
      return error(res, ErrorCodes.AMOUNT_MISMATCH, 400);
    }

    if (testAmount) {
      console.log(`🧪 테스트 결제 모드 (호스트 부담금): PG ${testAmount}원 → DB ${refund.hostBurdenAmount}원`);
    }

    // PayTag 결제 승인
    let paytagResponse;
    try {
      paytagResponse = await paytagClient.confirmPayment({
        recvPayparam,
        payType: payType || 'CARD'
      });
    } catch (paytagError) {
      await transaction.rollback();
      console.error('PayTag 호스트 부담금 결제 실패:', paytagError.message);
      return error(res, ErrorCodes.PAYMENT_CONFIRMATION_FAILED, 400, {
        pgErrorCode: paytagError.paytagErrorCode,
        pgErrorMessage: paytagError.paytagErrorMessage
      });
    }

    const now = new Date();
    const paymentMethod = paytagClient.mapPaymentMethod(payType || 'CARD');

    // Payment 레코드 생성
    const payment = await Payment.create({
      contractId: contract.id,
      paymentType: 'HOST_BURDEN',
      paymentKey: paytagResponse.tran_key || paytagResponse.recv_orderno || orderId,
      orderId: contract.orderId,
      method: paymentMethod,
      status: 'DONE',
      requestedAt: now,
      approvedAt: now,
      totalAmount: refund.hostBurdenAmount,
      balanceAmount: refund.hostBurdenAmount,
      suppliedAmount: Math.round(refund.hostBurdenAmount / 1.1),
      vat: refund.hostBurdenAmount - Math.round(refund.hostBurdenAmount / 1.1),
      taxFreeAmount: 0,
      currency: 'KRW',
      receiptUrl: paytagResponse.receipt_url || null,
      checkoutUrl: null,
      paymentResponse: paytagResponse
    }, { transaction });

    // Refund hostBurdenStatus PAID로 업데이트
    await refund.update({ hostBurdenStatus: 'PAID' }, { transaction });

    // HOST_CANCELLATION_COMPENSATION Payout 생성
    // payableAfter = 호스트 부담금 결제 승인일 + 3영업일
    const payableAfter = calculatePayoutAvailableDate(now);

    const { GuestRefundAccount } = require('../models');
    const guestRefundAccount = await GuestRefundAccount.findOne({
      where: { userId: contract.guestId }
    });

    if (refund.guestCompensationAmount > 0) {
      await Payout.create({
        contractId: contract.id,
        refundId: refund.id,
        payoutType: 'HOST_CANCELLATION_COMPENSATION',
        recipientType: 'GUEST',
        recipientId: contract.guestId,
        amount: refund.guestCompensationAmount,
        status: 'PENDING',
        payableAfter,
        bankName: guestRefundAccount?.bankName || null,
        accountNumber: guestRefundAccount?.accountNumber || null,
        accountHolder: guestRefundAccount?.accountHolder || null
      }, { transaction });
    }

    await transaction.commit();

    console.log(`✅ 호스트 부담금 결제 완료: contractId=${contract.id}, amount=${refund.hostBurdenAmount}, payableAfter=${payableAfter}`);

    return success(res, {
      contractId: contract.id,
      refundId: refund.id,
      paymentId: payment.id,
      hostBurdenAmount: refund.hostBurdenAmount,
      hostBurdenStatus: 'PAID',
      guestCompensationAmount: refund.guestCompensationAmount,
      payableAfter,
      paymentKey: payment.paymentKey
    }, '호스트 부담금 결제가 완료되었습니다.');
  } catch (err) {
    await transaction.rollback();
    console.error('호스트 부담금 결제 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

module.exports = {
  createContractRequest,
  getGuestContracts,
  getHostContracts,
  getContractDetail,
  approveContract,
  rejectContract,
  cancelContractByGuest,
  calculateRefundPreview,
  requestRefund,
  getContractRefunds,
  getPaymentInfo,
  confirmPayment,
  updatePendingRentalItems,
  requestCheckout,
  confirmCheckout,
  cancelContractByHost,
  requestCancelByHost,
  holdCheckout,
  submitDepositAgreement,
  getDepositAgreement,
  acceptDepositAgreement,
  getHostBurdenPaymentInfo,
  confirmHostBurdenPayment
};
