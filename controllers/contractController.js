const { sequelize, Contract, Room, User, RoomPhoto, RoomAmenity, ChatRoom, Refund, RefundPolicyType, RefundPolicyRule, ContractStatusLog, ContractCancelRequest, Payment, PaymentFailureLog, RentalOrder, RentalOrderItem, RentalOrderLog, RentalItemReservation, RentalItem, Settlement, Payout, DepositAgreement, AdminRefund, RentalOrderRefundRequest } = require('../models');
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
  validateDates,
  recalcRentalItemsAmounts
} = require('../utils/contractHelper');
const { createChatRoomMetadata, sendSystemMessage, setChatWritableUntil } = require('../config/firebaseAdmin');
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
const { CANCEL_TYPES, NotificationMessages } = require('../utils/notificationMessages');
const { calculateSettlementDate, calculatePayoutAvailableDate, calculateSettlementAmount } = require('../services/settlementService');
const { toKSTString, nowKSTString } = require('../utils/dateHelper');

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

    // 3. 방 존재 및 상태 확인 (이지서비스 + 사진 + 편의시설 + 호스트 정보 포함)
    const { EzService } = require('../models');
    const [room, guest] = await Promise.all([
      Room.findOne({
        where: { id: roomId, status: 'published' },
        include: [
          {
            model: EzService,
            as: 'ezService'
          },
          {
            model: RoomPhoto,
            as: 'photos',
            attributes: ['url', 'order'],
            order: [['order', 'ASC']]
          },
          {
            model: RoomAmenity,
            as: 'amenity',
            required: false
          },
          {
            model: User,
            as: 'host',
            attributes: ['id', 'name', 'nickname', 'profileImageUrl', 'phoneVerified'],
            required: false
          }
        ],
        transaction
      }),
      User.findByPk(guestId, {
        attributes: ['id', 'name', 'nickname', 'profileImageUrl', 'phoneVerified'],
        transaction
      })
    ]);

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
    const snapshot = {
      roomId: room.id,
      roomName: room.roomName,
      address: room.address,
      detailAddress: room.detailAddress,
      latitude: room.latitude,
      longitude: room.longitude,
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
      amenity: room.amenity ? {
        basicOptions: room.amenity.basicOptions,
        additionalOptions: room.amenity.additionalOptions,
        convenienceOptions: room.amenity.convenienceOptions,
        petsAllowed: room.amenity.petsAllowed,
      } : null,
      photos: (room.photos || []).map(p => ({ url: p.url, order: p.order })),
      thumbnailUrl: room.photos?.[0]?.url || null,
      host: room.host ? {
        id: room.host.id,
        name: room.host.name,
        nickname: room.host.nickname,
        profileImageUrl: room.host.profileImageUrl,
        phoneVerified: room.host.phoneVerified,
      } : null,
      guest: guest ? {
        id: guest.id,
        name: guest.name,
        nickname: guest.nickname,
        profileImageUrl: guest.profileImageUrl,
        phoneVerified: guest.phoneVerified,
      } : null,
      capturedAt: nowKSTString()
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
          capturedAt: nowKSTString()
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
      const checkIn = new Date(checkInDate + 'T00:00:00');
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
            requestedAt: toKSTString(now),
            rentalDeadline: toKSTString(rentalDeadline),
            hint: '렌탈 아이템 없이 계약을 진행하거나, 입주 후 추가 렌탈 주문을 이용해주세요.'
          }
        );
      }
    }

    // 7. 렌탈 아이템 재고 확인
    const stockValidation = await validateRentalItemsStock(
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

    // 할인 적용 후 금액 (0 이하 방어)
    const afterDiscount = Math.max(0, subtotalServer - discountAmountServer);

    // 플랫폼 수수료 계산
    // - 기준: 임대료 + 관리비 + 청소비(EZ서비스 사용시 제외) - 총할인
    // - EZ청소서비스 사용 시 청소비는 수수료 계산에서 제외
    const hasFreeCleaningService = room.ezService?.cleaningService || false;
    const feeBase = Math.max(0,
      serverCalculated.rentalFee +
      serverCalculated.maintenanceFee +
      (hasFreeCleaningService ? 0 : serverCalculated.cleaningFee) -
      discountAmountServer
    );

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
        checkInDate: (() => {
          const d = new Date(checkInDate);
          d.setHours(room.checkInTime || 14, 0, 0, 0);
          return d;
        })(),
        checkOutDate: (() => {
          const d = new Date(checkOutDate);
          d.setHours(room.checkOutTime || 11, 0, 0, 0);
          return d;
        })(),
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
        snapshot,
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

    // 11. 렌탈 아이템 재고 점유 (결제 전 선점)
    // RENTAL → RentalItemReservation INSERT, SALE → totalStock 차감
    if (rentalItems && Array.isArray(rentalItems) && rentalItems.length > 0) {
      await reserveRentalItems(
        contract.id,
        rentalItems,
        contract.checkInDate,
        contract.checkOutDate,
        transaction
      );
    }

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
        checkInDate: toKSTString(contract.checkInDate),
        checkOutDate: toKSTString(contract.checkOutDate),
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
          model: User,
          as: 'host',
          attributes: ['id', 'name', 'nickname', 'phoneNumber']
        },
        {
          model: DepositAgreement,
          as: 'depositAgreements',
          attributes: ['id', 'status', 'deductAmount', 'rejectedReason', 'rejectedAt', 'createdAt'],
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
          checkInDate: toKSTString(contract.checkInDate),
          checkOutDate: toKSTString(contract.checkOutDate),
          totalDays: contract.totalDays,

          // 💰 최종 금액만 표시 (리스트 간소화)
          finalTotalAmount: contract.finalTotalAmount,

          // 방 정보 (계약 시점 스냅샷 기반)
          room: {
            id: contract.snapshot?.roomId || null,
            roomName: contract.snapshot?.roomName || null,
            address: contract.snapshot?.address || null,
            area: contract.snapshot?.area || null,
            buildingType: contract.snapshot?.buildingType || null,
            thumbnailUrl: toAbsoluteUrl(contract.snapshot?.thumbnailUrl || null)
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

          // 호스트 추천 옵션 상품 (APPROVED 상태일 때만)
          recommendedItems: contract.status === 'APPROVED' ? (contract.recommendedItems || null) : undefined,

          // 퇴실/보증금 상태 (프론트 카드 액션 결정용)
          checkoutStatus: contract.checkoutStatus,
          depositStatus: contract.depositStatus,
          deposit: contract.deposit,
          checkoutRequested: contract.checkoutRequested,

          // 보증금 합의 상태 (동의 버튼 분기용)
          depositAgreementStatus: contract.depositAgreements?.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]?.status || null,

          // 합의 기한 (HOST_PENDING 또는 AGREEMENT_SUBMITTED 상태일 때만 노출)
          agreementDeadline: ['HOST_PENDING', 'AGREEMENT_SUBMITTED'].includes(contract.checkoutStatus) && contract.holdApprovedAt
            ? toKSTString(new Date(new Date(contract.holdApprovedAt).getTime() + 10 * 24 * 60 * 60 * 1000))
            : null,

          // 계약 시점 스냅샷
          snapshot: contract.snapshot,

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
          model: User,
          as: 'guest',
          attributes: ['id', 'name', 'nickname', 'phoneNumber', 'email']
        },
        {
          model: DepositAgreement,
          as: 'depositAgreements',
          attributes: ['id', 'status', 'deductAmount', 'rejectedReason', 'rejectedAt', 'createdAt'],
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
          checkInDate: toKSTString(contract.checkInDate),
          checkOutDate: toKSTString(contract.checkOutDate),
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

          // 📊 호스트 정산 내역 (렌탈아이템은 플랫폼 수익이므로 제외)
          hostSettlement: (() => {
            const hasEzCleaningService = contract.snapshot?.ezService?.cleaningService || false;
            const s = calculateSettlementAmount(contract, [], { hasEzCleaningService });
            return {
              rentalFee: s.rentalFee,
              maintenanceFee: s.maintenanceFee,
              cleaningFee: s.cleaningFee,
              discountAmount: contract.discountAmount,
              hostPlatformFee: s.platformFee,
              hostEarnings: s.grossSettlement,
            };
          })(),

          // 렌탈 아이템
          rentalItems: contract.rentalItems,

          // 메시지
          guestMessage: contract.guestMessage,

          // 방 정보 (계약 시점 스냅샷 기반)
          room: {
            id: contract.snapshot?.roomId || null,
            roomName: contract.snapshot?.roomName || null,
            address: contract.snapshot?.address || null,
            area: contract.snapshot?.area || null,
            buildingType: contract.snapshot?.buildingType || null,
            thumbnailUrl: toAbsoluteUrl(contract.snapshot?.thumbnailUrl || null)
          },

          // 퇴실/보증금 상태 (PRD v2)
          checkoutStatus: contract.checkoutStatus,
          checkoutStatusLabel: Contract.CHECKOUT_STATUS_LABELS[contract.checkoutStatus],
          depositStatus: contract.depositStatus,
          checkoutRequested: contract.checkoutRequested,
          hostCheckedOut: contract.hostCheckedOut,

          // 보증금 합의 상태 (버튼 분기용)
          depositAgreementStatus: (() => {
            const latestDA = contract.depositAgreements?.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
            return latestDA?.status || null;
          })(),
          // 거절 정보 (HOLD_REJECTED 상태일 때 호스트에게 노출)
          holdRejectedReason: contract.checkoutStatus === 'HOLD_REJECTED'
            ? (contract.depositAgreements?.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]?.rejectedReason || null)
            : null,
          // 합의 기한 (HOST_PENDING 또는 AGREEMENT_SUBMITTED 상태일 때만 노출)
          agreementDeadline: ['HOST_PENDING', 'AGREEMENT_SUBMITTED'].includes(contract.checkoutStatus) && contract.holdApprovedAt
            ? toKSTString(new Date(new Date(contract.holdApprovedAt).getTime() + 10 * 24 * 60 * 60 * 1000))
            : null,

          // 게스트 정보 (연락처는 결제 완료 이후 상태에서만 노출)
          guest: {
            id: contract.guest.id,
            name: contract.guest.name,
            nickname: contract.guest.nickname,
            phoneNumber: ['PAYMENT_COMPLETED', 'IN_PROGRESS', 'COMPLETED'].includes(contract.status)
              ? contract.guest.phoneNumber : null,
            email: contract.guest.email
          },

          // 계약 시점 스냅샷
          snapshot: contract.snapshot,

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
          required: false
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
          as: 'depositAgreements',
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

    const isHost = contract.hostId === userId;

    // 렌탈 주문 정보 조회
    const rentalSummary = await getContractRentalSummary(contract.id);

    // === 결제/취소 내역 타임라인 ===
    const paymentHistory = [];

    if (isHost) {
      // 호스트: HOST_BURDEN 결제/환불만
      const hostPayments = await Payment.findAll({
        where: { contractId: contract.id, paymentType: 'HOST_BURDEN' },
        order: [['createdAt', 'ASC']]
      });

      hostPayments.forEach(p => {
        if (p.status === 'READY') return;
        paymentHistory.push({
          occurredAt: toKSTString(p.approvedAt || p.createdAt),
          amount: p.totalAmount,
          description: '호스트 부담금 결제'
        });
        if (['CANCELED', 'PARTIAL_CANCELED'].includes(p.status)) {
          const refunded = (p.totalAmount || 0) - (p.balanceAmount || 0);
          if (refunded > 0) {
            paymentHistory.push({
              occurredAt: toKSTString(p.updatedAt),
              amount: -refunded,
              description: '호스트 부담금 환불'
            });
          }
        }
      });
    } else {
      // 게스트: 계약 결제 + 환불 + 관리자 환불 + ADDITIONAL 렌탈 결제/취소
      const [guestPayments, refunds, adminRefunds, rentalLogs] = await Promise.all([
        Payment.findAll({
          where: { contractId: contract.id, paymentType: 'CONTRACT' },
          order: [['approvedAt', 'ASC']]
        }),
        Refund.findAll({
          where: { contractId: contract.id, refundStatus: 'COMPLETED' },
          order: [['completedAt', 'ASC']]
        }),
        AdminRefund.findAll({
          where: { contractId: contract.id, refundStatus: 'COMPLETED' },
          order: [['completedAt', 'ASC']]
        }),
        RentalOrderLog.findAll({
          where: {
            contractId: contract.id,
            action: { [Op.in]: ['PAYMENT_COMPLETED', 'REFUND_COMPLETED', 'ITEM_CANCELLED', 'ORDER_CANCELLED'] }
          },
          include: [{
            model: RentalOrder,
            as: 'order',
            attributes: ['id', 'orderId', 'orderType'],
            where: { orderType: 'ADDITIONAL' },
            required: true,
            include: [{
              model: RentalOrderItem,
              as: 'items',
              include: [{ model: RentalItem, as: 'rentalItem', attributes: ['name'] }]
            }]
          }],
          order: [['createdAt', 'ASC']]
        })
      ]);

      guestPayments.forEach(p => {
        if (p.status === 'READY') return;
        paymentHistory.push({
          occurredAt: toKSTString(p.approvedAt || p.createdAt),
          amount: p.totalAmount,
          description: '계약 결제'
        });
      });

      refunds.forEach(r => {
        const metadata = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : (r.metadata || {});
        let description;
        if (metadata.depositRefund) {
          description = '보증금 환급';
        } else {
          const feeDeducted = !r.guestServiceFeeRefunded ? (r.originalPlatformFee || 0) : 0;
          const totalPenalty = (r.penaltyAmount || 0) + feeDeducted;
          description = totalPenalty > 0
            ? `계약 취소 (위약금 ${Number(totalPenalty).toLocaleString()}원)`
            : '계약 취소';
        }
        paymentHistory.push({
          occurredAt: toKSTString(r.completedAt || r.updatedAt),
          amount: -(r.finalRefundAmount || 0),
          description
        });
      });

      adminRefunds.forEach(ar => {
        const contractRefund = (ar.rentalFeeRefundAmount || 0) + (ar.maintenanceFeeRefundAmount || 0)
          + (ar.cleaningFeeRefundAmount || 0) + (ar.platformFeeRefundAmount || 0)
          + (ar.depositRefundAmount || 0);
        const rentalRefund = ar.rentalItemsRefundAmount || 0;

        if (contractRefund > 0) {
          paymentHistory.push({
            occurredAt: toKSTString(ar.completedAt || ar.updatedAt),
            amount: -contractRefund,
            description: '계약 취소 (관리자)'
          });
        }
        if (rentalRefund > 0) {
          paymentHistory.push({
            occurredAt: toKSTString(ar.completedAt || ar.updatedAt),
            amount: -rentalRefund,
            description: '옵션 상품 취소 (관리자)'
          });
        }
      });

      rentalLogs.forEach(log => {
        const ro = log.order;
        const itemDesc = (ro?.items || [])
          .map(i => `${i.rentalItem?.name || '아이템'} ${i.quantity}개`)
          .join(', ');
        const isPayment = log.action === 'PAYMENT_COMPLETED';
        paymentHistory.push({
          occurredAt: toKSTString(log.createdAt),
          amount: log.amountChange || 0,
          description: isPayment
            ? (itemDesc ? `옵션 상품 추가 구매 (${itemDesc})` : '옵션 상품 추가 구매')
            : (itemDesc ? `옵션 상품 취소 (${itemDesc})` : '옵션 상품 취소')
        });
      });

      // 보증금 환급 (퇴실 보증금 프로세스 경유 — 계약 취소와 별도)
      // 계약 취소(refunds)는 finalRefundAmount에 보증금 포함되어 있으므로 여기선 제외
      if (contract.depositReturnedAt && (contract.refundableDeposit || 0) > 0) {
        const isDepositIncludedInRefund = refunds.some(r => r.depositRefundAmount > 0);
        if (!isDepositIncludedInRefund) {
          paymentHistory.push({
            occurredAt: toKSTString(contract.depositReturnedAt),
            amount: -(contract.refundableDeposit),
            description: contract.depositDeduction > 0
              ? `보증금 환급 (${Number(contract.depositDeduction).toLocaleString()}원 차감)`
              : '보증금 환급'
          });
        }
      }

      paymentHistory.sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));
    }

    return success(
      res,
      {
        contract: {
          id: contract.id,
          orderId: contract.orderId,
          status: contract.status,
          statusLabel: Contract.STATUS_LABELS[contract.status],

          // 날짜 정보
          checkInDate: toKSTString(contract.checkInDate),
          checkOutDate: toKSTString(contract.checkOutDate),
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
          snapshot: contract.snapshot ? {
            ...contract.snapshot,
            photos: (contract.snapshot.photos || []).map(p => ({
              ...p,
              url: toAbsoluteUrl(p.url)
            })),
            thumbnailUrl: toAbsoluteUrl(contract.snapshot.thumbnailUrl),
            host: contract.snapshot.host ? {
              ...contract.snapshot.host,
              profileImageUrl: toAbsoluteUrl(contract.snapshot.host.profileImageUrl)
            } : null
          } : null,
          refundPolicyType: contract.refundPolicyType,
          refundPolicySnapshot: contract.refundPolicySnapshot,

          // 방 정보 (계약 시점 스냅샷 기반)
          room: {
            id: contract.snapshot?.roomId || null,
            roomName: contract.snapshot?.roomName || null,
            address: contract.snapshot?.address || null,
            detailAddress: ['PAYMENT_COMPLETED', 'IN_PROGRESS', 'COMPLETED', 'REFUNDED',
              'CANCELLED_BY_HOST', 'CANCELLED_BY_ADMIN_WITH_REFUND', 'CANCELLED_BY_ADMIN_NO_REFUND',
              'CANCEL_REQUESTED'
            ].includes(contract.status) ? (contract.snapshot?.detailAddress || null) : null,
            area: contract.snapshot?.area || null,
            buildingType: contract.snapshot?.buildingType || null,
            photos: (contract.snapshot?.photos || []).map(photo => ({
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

          // 📊 호스트 정산 내역 (렌탈아이템은 플랫폼 수익이므로 제외)
          hostSettlement: (() => {
            const hasEzCleaningService = contract.snapshot?.ezService?.cleaningService || false;
            const s = calculateSettlementAmount(contract, [], { hasEzCleaningService });
            return {
              rentalFee: s.rentalFee,
              maintenanceFee: s.maintenanceFee,
              cleaningFee: s.cleaningFee,
              discountAmount: contract.discountAmount,
              hostPlatformFee: s.platformFee,
              hostEarnings: s.grossSettlement,
            };
          })(),

          // 퇴실/보증금 상태 (PRD v2)
          checkoutStatus: contract.checkoutStatus,
          checkoutStatusLabel: Contract.CHECKOUT_STATUS_LABELS[contract.checkoutStatus],
          depositStatus: contract.depositStatus,
          depositDeduction: contract.depositDeduction,
          deductionReason: contract.deductionReason,
          refundableDeposit: contract.refundableDeposit,
          checkoutRequested: contract.checkoutRequested,
          hostCheckedOut: contract.hostCheckedOut,

          // 보증금 합의 이력 (최신순)
          depositAgreements: (contract.depositAgreements || [])
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .map(da => ({
              id: da.id,
              status: da.status,
              statusLabel: DepositAgreement.STATUS_LABELS[da.status],
              holdReason: da.holdReason,
              requestedAt: toKSTString(da.requestedAt),
              rejectedAt: da.rejectedAt ? toKSTString(da.rejectedAt) : null,
              rejectedReason: da.rejectedReason,
              adminApprovedAt: da.adminApprovedAt ? toKSTString(da.adminApprovedAt) : null,
              deductAmount: da.deductAmount,
              agreementText: da.agreementText,
              submittedAt: da.submittedAt ? toKSTString(da.submittedAt) : null,
              acceptedAt: da.acceptedAt ? toKSTString(da.acceptedAt) : null,
              createdAt: da.createdAt
            })),

          // 시점 정보
          createdAt: contract.createdAt,
          approvedAt: contract.approvedAt,
          rejectedAt: contract.rejectedAt,
          paidAt: contract.paidAt,
          checkedInAt: contract.checkedInAt ? toKSTString(contract.checkedInAt) : null,
          checkedOutAt: contract.checkedOutAt ? toKSTString(contract.checkedOutAt) : null,
          cancelledAt: contract.cancelledAt,
          checkoutRequestedAt: contract.checkoutRequestedAt ? toKSTString(contract.checkoutRequestedAt) : null,

          // 결제/취소 내역
          paymentHistory
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
    const { recommendedItems } = req.body || {};
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
          checkInDate: toKSTString(contract.checkInDate),
          checkOutDate: toKSTString(contract.checkOutDate),
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
          checkInDate: toKSTString(contract.checkInDate),
          checkOutDate: toKSTString(contract.checkOutDate),
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

    // 승인 대기 또는 결제 대기 상태인지 확인
    if (!['PENDING_APPROVAL', 'APPROVED'].includes(contract.status)) {
      await transaction.rollback();
      return error(
        res,
        { code: 4403, message: '승인 대기 또는 결제 대기 상태의 계약만 거절(철회)할 수 있습니다' },
        400
      );
    }

    const fromStatus = contract.status;

    // 결제 대기(APPROVED) 상태에서 거절 시 렌탈 아이템 예약 해제 (재고 복구)
    if (fromStatus === 'APPROVED') {
      await cancelRentalItemReservations(contractId, transaction);
    }

    // 계약 거절 처리
    await contract.update(
      {
        status: 'REJECTED',
        cancellationReason: hostMessage || null,
        rejectedAt: new Date()
      },
      { transaction }
    );

    // 상태 변경 로그 기록
    await ContractStatusLog.createLog({
      contractId: contract.id,
      fromStatus,
      toStatus: 'REJECTED',
      changedBy: 'HOST',
      changedByUserId: hostId,
      reason: hostMessage || null,
      metadata: {
        rejectedAt: contract.rejectedAt
      },
      req,
      transaction
    });

    // 채팅방이 있다면 시스템 메시지 발송 (PENDING_APPROVAL 거절 시에는 채팅방이 없을 수 있음)
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
        cancelledAt: toKSTString(contract.cancelledAt)
      },
      req,
      transaction
    });

    // 승인 대기 중 취소: 채팅방 없음(호스트 승인 시점에 생성), 앱 알림/알림톡 미발송

    await transaction.commit();

    // 서비스 태스크 PENDING 삭제 (트랜잭션 외부)
    try {
      const { cancelPendingServiceTasks } = require('../schedulers/contractScheduler');
      await cancelPendingServiceTasks(contract.id);
    } catch (taskErr) {
      console.error('게스트 취소 서비스 태스크 삭제 실패 (무시됨):', taskErr);
    }

    return updated(
      res,
      {
        contractId: contract.id,
        status: contract.status,
        statusLabel: Contract.STATUS_LABELS[contract.status],
        cancellationReason: contract.cancellationReason,
        cancelledAt: toKSTString(contract.cancelledAt)
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

    // 입주 전인 경우: 미처리 ADDITIONAL 주문 존재 여부 확인
    let pendingAdditionalOrders = [];
    const checkInDate = new Date(contract.checkInDate);
    if (new Date() < checkInDate) {
      const additionalOrders = await RentalOrder.findAll({
        where: {
          contractId,
          orderType: 'ADDITIONAL',
          status: { [Op.in]: ['PAID', 'PARTIAL_REFUND'] }
        },
        include: [{
          model: RentalOrderRefundRequest,
          as: 'refundRequests',
          where: { status: 'PENDING' },
          required: false
        }]
      });

      pendingAdditionalOrders = additionalOrders
        .filter(o => !o.refundRequests || o.refundRequests.length === 0)
        .map(o => ({
          orderId: o.orderId,
          status: o.status,
          totalAmount: o.totalAmount
        }));
    }

    return success(res, {
      ...refundResult.data,
      cancelBlocked: pendingAdditionalOrders.length > 0,
      pendingAdditionalOrders
    }, '환불 금액이 계산되었습니다.');
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
    if (contract.status === 'IN_PROGRESS') {
      await transaction.rollback();
      return error(
        res,
        {
          code: 4501,
          message: '임대 진행 중에는 취소 요청 기능을 이용해주세요.',
          currentStatus: contract.status
        },
        400
      );
    }

    if (contract.status !== 'PAYMENT_COMPLETED') {
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

    // 체크인 당일 + 결제 당일 아닌 경우 환불 요청 차단
    // (체크인 당일 결제한 경우는 90% 자동 승인 허용)
    const now = new Date();
    const checkInDateForBlock = new Date(contract.checkInDate);
    const isSameDayFn = (d1, d2) => {
      const a = new Date(d1), b = new Date(d2);
      return a.getFullYear() === b.getFullYear() &&
             a.getMonth() === b.getMonth() &&
             a.getDate() === b.getDate();
    };
    const isCheckInDay = isSameDayFn(checkInDateForBlock, now);
    const isPaidToday = isSameDayFn(contract.paidAt || contract.createdAt, now);

    if (isCheckInDay && !isPaidToday) {
      await transaction.rollback();
      return error(
        res,
        {
          code: 4505,
          message: '체크인 당일에는 결제 당일 취소만 가능합니다. 관리자에게 문의해주세요.'
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

    // 입주 전 취소 시 미처리 ADDITIONAL 렌탈 주문 차단
    // (PAID/PARTIAL_REFUND 상태이면서 반품 요청이 없는 주문이 있으면 먼저 환불 요구)
    const checkInDateForBlock2 = new Date(contract.checkInDate);
    if (now < checkInDateForBlock2) {
      const additionalOrders = await RentalOrder.findAll({
        where: {
          contractId,
          orderType: 'ADDITIONAL',
          status: { [Op.in]: ['PAID', 'PARTIAL_REFUND'] }
        },
        include: [{
          model: RentalOrderRefundRequest,
          as: 'refundRequests',
          where: { status: 'PENDING' },
          required: false
        }],
        transaction
      });

      const blockedOrders = additionalOrders.filter(o => !o.refundRequests || o.refundRequests.length === 0);

      if (blockedOrders.length > 0) {
        await transaction.rollback();
        return error(
          res,
          { code: 4506, message: '추가 주문된 옵션 상품을 먼저 환불해주세요.' },
          400,
          {
            blockedOrders: blockedOrders.map(o => ({
              orderId: o.orderId,
              status: o.status,
              totalAmount: o.totalAmount
            }))
          }
        );
      }
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

      // 위약금
      penaltyAmount: refundData.penaltyAmount,

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

    // 자동 승인(입주 전)이면 채팅 쓰기 마감
    if (autoApprove && chatRoom) {
      setChatWritableUntil(chatRoom.firebaseChatRoomId, new Date()).catch(err => {
        console.error('REFUNDED 채팅 쓰기 마감 설정 실패 (무시됨):', err);
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
          const { orderno, orgpaydate, orgtranamt, loginid } = paytagClient.extractCancelParams(payment);
          const cancelamt = refundData.finalRefundAmount;
          const newBalance = payment.balanceAmount - cancelamt;
          const canceltype = newBalance === 0 ? '0' : '1';

          const cancelResp = await paytagClient.cancelPayment({ orderno, orgpaydate, orgtranamt, loginid, cancelamt, canceltype });

          await payment.update({
            balanceAmount: newBalance,
            status: newBalance === 0 ? 'CANCELED' : 'PARTIAL_CANCELED'
          }, { transaction });

          await refund.update({
            pgResponse: cancelResp,
            refundStatus: 'COMPLETED',
            completedAt: new Date()
          }, { transaction });

          console.log(`[requestRefund] PayTag 취소 완료: contractId=${contractId}, cancelamt=${cancelamt}, restamt=${cancelResp.restamt}`);

          // 계약 취소 시 기존 CONTRACT_SETTLEMENT Payout/Settlement 취소
          await Payout.update(
            { status: 'CANCELLED', note: '계약 취소로 인한 자동 취소' },
            { where: { contractId: contract.id, payoutType: 'CONTRACT_SETTLEMENT', status: { [Op.in]: ['PENDING', 'PAYABLE'] } }, transaction }
          );
          await Settlement.update(
            { status: 'ON_HOLD', note: '계약 취소로 인한 정산 보류' },
            { where: { contractId: contract.id, status: 'PENDING' }, transaction }
          );

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

    // 예약된 알림 큐 전체 취소 (취소된 계약에 알림 발송 방지)
    try {
      const { cancelScheduledNotifications } = require('../queues/notificationQueue');
      await cancelScheduledNotifications(contractId);
    } catch (queueErr) {
      console.error('[requestRefund] 알림 큐 취소 실패 (무시됨):', queueErr);
    }

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
          guestPenalty: (refund.penaltyAmount || 0) + (refund.platformFeeDeducted || 0),
          refundAmount: refund.finalRefundAmount || 0,
          hostPenalty: refund.penaltyAmount || 0,
          settlementAmount: refund.penaltyAmount || 0
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
        requestedAt: toKSTString(refund.requestedAt),
        approvedAt: refund.approvedAt ? toKSTString(refund.approvedAt) : null,
        estimatedCompletionDate: toKSTString(estimatedCompletionDate)
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

          // 위약금
          penaltyAmount: refund.penaltyAmount,

          // 수수료
          guestServiceFeeRefunded: refund.guestServiceFeeRefunded,
          platformFeeDeducted: refund.platformFeeDeducted,

          // 환불 방법
          refundMethod: refund.refundMethod,

          // 사유 및 메시지
          cancellationReason: refund.cancellationReason,
          rejectionReason: refund.rejectionReason,

          // 타임스탬프
          requestedAt: toKSTString(refund.requestedAt),
          approvedAt: refund.approvedAt ? toKSTString(refund.approvedAt) : null,
          rejectedAt: refund.rejectedAt ? toKSTString(refund.rejectedAt) : null,
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
  const { contractId } = req.params;
  const { recvPayparam, payType, orderId, amount } = req.body;
  const guestId = req.user.id;

  // ── 1단계: 검증 및 조회 (트랜잭션 밖 — 락 불필요) ──
  if (!recvPayparam || !orderId || !amount) {
    return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400);
  }

  const contract = await Contract.findOne({
    where: { id: contractId, guestId },
    include: [{ model: Room, as: 'room', attributes: ['id', 'roomName', 'hostId'] }]
  });

  if (!contract) return error(res, ErrorCodes.CONTRACT_NOT_FOUND, 404);
  if (contract.status !== 'APPROVED') return error(res, ErrorCodes.PAYMENT_NOT_AVAILABLE, 400);
  if (contract.orderId !== orderId) return error(res, ErrorCodes.ORDER_ID_MISMATCH, 400);

  // 금액 검증 (클라이언트 변조 방지)
  // 프론트는 항상 실제 금액을 보냄. 테스트 모드에서는 PG만 테스트금액으로 결제됨.
  // 가상계좌/링크결제는 최소금액 제한이 있어 테스트 금액 적용 제외
  const testAmount = paytagClient.getTestAmount(payType);
  const realAmount = contract.finalTotalAmount;

  if (realAmount !== parseInt(amount, 10)) return error(res, ErrorCodes.AMOUNT_MISMATCH, 400);

  if (testAmount) {
    console.log(`🧪 테스트 결제 모드: PG 결제 ${testAmount}원 → DB 저장 ${realAmount}원`);
  }

  // ── 2단계: PG 결제 승인 (트랜잭션 밖) ──
  let paytagResponse;
  try {
    paytagResponse = await paytagClient.confirmPayment({
      recvPayparam,
      payType: payType || 'CARD'
    });
  } catch (paytagError) {
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

  // ── 3단계: DB 업데이트 (짧은 트랜잭션 — PG 성공 후) ──
  // PG 성공 후 DB 실패 시 즉시 PG 취소 (보상 트랜잭션)
  const now = new Date();
  const paymentMethod = paytagClient.mapPaymentMethod(payType || 'CARD');
  const easyPayProvider = paytagClient.mapEasyPayProvider(payType || 'CARD');
  const pgPaymentKey = paytagResponse.tran_key || paytagResponse.recv_orderno || orderId;

  // TODO: 가상계좌(VBANK) 결제 지원 - 오픈 스펙 제외, 추후 구현
  // - VBANK 선택 시 status: 'WAITING_FOR_DEPOSIT', Contract APPROVED 유지
  // - 웹훅으로 입금 확인 후 DONE + PAYMENT_COMPLETED 전환
  // - 입금 마감시간 검증: min(승인+24h, 체크인시간)
  // - 관련 파일: controllers/paytagWebhookController.js, server.js 웹훅 라우트

  let payment;
  let initialRentalOrder;
  const transaction = await sequelize.transaction();
  try {
    // Payment 레코드 생성 (테스트 모드에서도 실제 금액으로 저장)
    payment = await Payment.create({
      contractId: contract.id,
      paymentType: 'CONTRACT',
      paymentKey: pgPaymentKey,
      orderId: contract.orderId,
      method: paymentMethod,
      easyPayProvider,
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
      paymentResponse: paytagResponse
    }, { transaction });

    // Contract 상태 업데이트
    await contract.update({
      status: 'PAYMENT_COMPLETED',
      paymentMethod: paytagClient.mapContractPaymentMethod(payType || 'CARD'),
      paidAt: now
    }, { transaction });

    // 렌탈 주문이 있으면 함께 결제 처리
    initialRentalOrder = await RentalOrder.findOne({
      where: { contractId: contract.id, orderType: 'INITIAL', status: 'PENDING' },
      transaction
    });

    // rental_orders가 없지만 contracts.rental_items에 데이터가 있는 경우 (레거시 데이터 마이그레이션)
    if (!initialRentalOrder && contract.rentalItems && Array.isArray(contract.rentalItems) && contract.rentalItems.length > 0) {
      console.log(`📦 레거시 렌탈 아이템 마이그레이션: contractId=${contract.id}`);
      const rentalItemsForOrder = contract.rentalItems.map(item => ({
        itemId: item.itemId,
        quantity: item.quantity
      }));
      initialRentalOrder = await createInitialRentalOrder(
        contract.id, rentalItemsForOrder,
        contract.checkInDate, contract.checkOutDate,
        guestId, req, transaction
      );
      console.log(`✅ 레거시 렌탈 주문 생성 완료: rentalOrderId=${initialRentalOrder.id}`);
    }

    if (initialRentalOrder) {
      await confirmRentalOrderPayment(
        initialRentalOrder, payment.paymentKey, paymentMethod, guestId, req, transaction
      );
      console.log(`✅ 렌탈 주문 결제 완료: rentalOrderId=${initialRentalOrder.id}`);
    }

    // Settlement + Payout 생성 (CONTRACT_SETTLEMENT)
    // 지급 가능일: 결제일+3영업일 vs 입주일 다음날 중 더 늦은 날짜 (PRD 정책)
    const pgAvailableDate = calculatePayoutAvailableDate(now);
    const checkInNextDay = new Date(contract.checkInDate);
    checkInNextDay.setDate(checkInNextDay.getDate() + 1);
    checkInNextDay.setHours(0, 0, 0, 0);
    const payoutAvailableDate = pgAvailableDate > checkInNextDay ? pgAvailableDate : checkInNextDay;
    const settlementExpectedDate = calculateSettlementDate(contract.checkInDate);
    const hasEzCleaningService = contract.snapshot?.ezService?.cleaningService || false;
    const settlementAmounts = calculateSettlementAmount(contract, [], { hasEzCleaningService });

    const settlement = await Settlement.create({
      contractId: contract.id,
      hostId: contract.hostId,
      status: 'PENDING',
      rentalFee: settlementAmounts.rentalFee,
      maintenanceFee: settlementAmounts.maintenanceFee,
      cleaningFee: settlementAmounts.cleaningFee,
      hostPlatformFee: settlementAmounts.platformFee,
      refundDeduction: 0,
      grossAmount: settlementAmounts.grossAmount,
      netAmount: settlementAmounts.grossSettlement,
      expectedDate: settlementExpectedDate,
      payoutAvailableDate
    }, { transaction });

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

  } catch (dbErr) {
    await transaction.rollback();
    console.error('결제 DB 업데이트 실패 — PG 즉시 취소 시도:', dbErr);

    // PG 성공 후 DB 실패 → 보상 트랜잭션: PG 즉시 취소
    try {
      const { orderno, orgpaydate, orgtranamt } = paytagClient.extractCancelParams({
        paymentResponse: paytagResponse,
        orderId
      });
      await paytagClient.cancelPayment({ orderno, orgpaydate, orgtranamt, loginid: null, cancelamt: realAmount, canceltype: '0' });
      console.error(`결제 취소 완료 (보상): contractId=${contract.id}, orderId=${orderId}`);
    } catch (cancelErr) {
      // PG 취소도 실패한 경우 — 수동 처리 필요
      console.error(`[긴급] PG 취소 실패 — 수동 환불 필요: contractId=${contract.id}, orderId=${orderId}`, cancelErr);
      await PaymentFailureLog.create({
        contractId: contract.id,
        orderId,
        failureCode: 'DB_FAIL_PG_CANCEL_FAIL',
        failureMessage: `DB 업데이트 실패 후 PG 취소도 실패. 수동 환불 필요. DB오류: ${dbErr.message} / PG취소오류: ${cancelErr.message}`,
        requestData: { payType, orderId, amount: realAmount },
        responseData: paytagResponse
      }).catch(() => {});
    }

    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }

  // ── 4단계: 커밋 후 후속 처리 (트랜잭션 밖) ──

  // 상태 변경 로그 기록
  try {
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
      req
    });
  } catch (logErr) {
    console.error('결제 상태 로그 기록 실패 (무시됨):', logErr);
  }

  // 채팅방 시스템 메시지
  try {
    const chatRoom = await ChatRoom.findOne({ where: { contractId: contract.id } });
    if (chatRoom?.firebaseChatRoomId) {
      await sendSystemMessage(
        chatRoom.firebaseChatRoomId,
        getSystemMessageTemplate(SystemMessageTypes.PAYMENT_COMPLETED, {
          checkInDate: toKSTString(contract.checkInDate).split('T')[0],
          checkOutDate: toKSTString(contract.checkOutDate).split('T')[0]
        }),
        SystemMessageTypes.PAYMENT_COMPLETED,
        {
          contractId: contract.id,
          amount: payment.totalAmount,
          paymentMethod: payment.method
        }
      );
    }
  } catch (chatErr) {
    console.error('채팅 시스템 메시지 실패 (무시됨):', chatErr);
  }

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
        optionItems = orderItems.map(i => `${i.rentalItem?.name || '옵션'} ${i.quantity}개`).join('\n');
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
    await cancelScheduledNotification(contract.id);
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

  if (initialRentalOrder) {
    responseData.rentalOrder = {
      rentalOrderId: initialRentalOrder.rentalOrderId,
      totalAmount: parseFloat(initialRentalOrder.totalAmount),
      status: 'PAID'
    };
  }

  return success(res, responseData, '결제가 완료되었습니다');
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
        checkInDate: toKSTString(contract.checkInDate),
        modifiableUntil: toKSTString(modifiableUntil)
      });
    }

    // 5. 렌탈 아이템이 비어있으면 기존 점유 해제 후 null로 저장
    if (!rentalItems || !Array.isArray(rentalItems) || rentalItems.length === 0) {
      await cancelRentalItemReservations(contractId, transaction);

      const amounts = recalcRentalItemsAmounts(contract, 0);

      await contract.update({
        rentalItems: null,
        ...amounts
      }, { transaction });

      await transaction.commit();

      return success(res, {
        contractId: contract.id,
        rentalItems: null,
        ...amounts
      }, '렌탈 아이템이 모두 삭제되었습니다');
    }

    // 6. 재고 검증 (기존 점유 제외를 위해 먼저 해제 후 검증)
    await cancelRentalItemReservations(contractId, transaction);

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

    // 8. 계약 업데이트 (rentalItems, rentalItemsFee, subtotal, totalUsageFee, finalTotalAmount 재계산)
    const amounts = recalcRentalItemsAmounts(contract, totalRentalFee);

    await contract.update({
      rentalItems: itemDetails,
      ...amounts
    }, { transaction });

    // 9. 새 아이템으로 재고 재점유
    // (기존 점유는 6번 단계 시작 전 cancelRentalItemReservations()에서 이미 해제됨)
    await reserveRentalItems(
      contract.id,
      rentalItems.map(item => ({ itemId: item.itemId, quantity: item.quantity })),
      contract.checkInDate,
      contract.checkOutDate,
      transaction
    );

    await transaction.commit();

    return success(res, {
      contractId: contract.id,
      rentalItems: itemDetails,
      ...amounts,
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
      checkoutRequestedAt: contract.checkoutRequestedAt ? toKSTString(contract.checkoutRequestedAt) : null,
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

    const refundableDeposit = contract.deposit || 0;
    const now = new Date();

    // 퇴실 확인 처리
    await contract.update({
      hostCheckedOut: true,
      hostCheckedOutAt: now,
      refundableDeposit,
      depositStatus: 'RETURN_PENDING',
      checkoutStatus: 'HOST_CONFIRMED'
    });

    // 호스트/게스트 모두에게 퇴실 완료 알림 발송
    try {
      await NotificationService.notifyCheckoutConfirmed(contract);
    } catch (notifyErr) {
      console.error('퇴실 완료 알림 전송 실패 (무시됨):', notifyErr);
    }

    // 보증금 즉시 PG 환불 (보증금이 있는 경우)
    if (refundableDeposit > 0) {
      try {
        const payment = await Payment.findOne({
          where: { contractId: contract.id, paymentType: 'CONTRACT', status: 'DONE' },
          order: [['createdAt', 'DESC']]
        });

        if (payment) {
          const { orderno, orgpaydate, orgtranamt, loginid } = paytagClient.extractCancelParams(payment);
          const newBalance = payment.balanceAmount - refundableDeposit;
          const canceltype = newBalance === 0 ? '0' : '1';

          await paytagClient.cancelPayment({
            orderno,
            orgpaydate,
            orgtranamt,
            loginid,
            cancelamt: refundableDeposit,
            canceltype
          });

          await payment.update({
            balanceAmount: newBalance,
            status: newBalance === 0 ? 'CANCELED' : 'PARTIAL_CANCELED'
          });

          await contract.update({
            depositStatus: 'RETURNED',
            depositReturnedAt: now
          });

          // 채팅 쓰기 마감 설정 (보증금 반환 완료 시점 + 24H)
          const chatRoom = await ChatRoom.findOne({ where: { contractId: contract.id } });
          if (chatRoom) {
            setChatWritableUntil(chatRoom.firebaseChatRoomId, now).catch(err => {
              console.error('퇴실확인 채팅 쓰기 마감 설정 실패 (무시됨):', err);
            });
          }

          console.log(`[confirmCheckout] 보증금 즉시 환불 완료: contractId=${contract.id}, amount=${refundableDeposit}`);
        }
      } catch (pgErr) {
        console.error(`[confirmCheckout] 보증금 환불 PG 실패 (contractId=${contract.id}):`, pgErr.message);

        await contract.update({ depositStatus: 'REFUND_FAILED' });

        await PaymentFailureLog.create({
          contractId: contract.id,
          orderId: `DEPOSIT_REFUND_${contract.id}`,
          failureCode: pgErr.paytagErrorCode || 'PG_CANCEL_FAILED',
          failureMessage: pgErr.paytagErrorMessage || pgErr.message,
          requestData: {
            type: 'DEPOSIT_FULL_REFUND',
            cancelamt: refundableDeposit
          },
          responseData: pgErr.paytagResponse || null
        });
      }
    }

    return updated(res, {
      contractId: contract.id,
      deposit: contract.deposit,
      refundableDeposit,
      depositStatus: refundableDeposit > 0 ? 'RETURNED' : 'RETURN_PENDING',
      checkoutStatus: 'HOST_CONFIRMED'
    }, '퇴실이 확인되었습니다. 보증금 전액 반환 처리가 진행됩니다.');

  } catch (err) {
    console.error('퇴실 확인 처리 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 호스트 취소 시 부담금 미리보기
 * GET /api/contracts/:contractId/cancel-by-host/preview
 */
const getHostCancelPreview = async (req, res) => {
  try {
    const { contractId } = req.params;
    const hostId = req.user.id;

    const contract = await Contract.findByPk(contractId);

    if (!contract) {
      return error(res, ErrorCodes.CONTRACT_NOT_FOUND, 404);
    }

    if (contract.hostId !== hostId) {
      return error(res, ErrorCodes.FORBIDDEN, 403);
    }

    if (contract.status !== 'PAYMENT_COMPLETED') {
      return error(res, {
        code: 4621,
        message: '결제 완료 상태에서만 취소할 수 있습니다.'
      }, 400);
    }

    const refundResult = await calculateRefund(contract, new Date(), { faultType: 'HOST' });

    if (!refundResult.success) {
      return error(res, { code: 4623, message: `환불 계산 실패: ${refundResult.error.message}` }, 500);
    }

    const d = refundResult.data;
    // refundRate=100(무료 취소)이면 platformFee는 게스트 환불에 포함되므로 호스트 부담 불필요
    const hostBurdenAmount = d.penaltyAmount + (d.guestServiceFeeRefunded ? 0 : d.originalPlatformFee);

    return success(res, {
      // 원본 결제 항목별 금액
      originalRentalFee: d.originalRentalFee,
      originalCleaningFee: d.originalCleaningFee,
      originalMaintenanceFee: d.originalMaintenanceFee,
      originalDeposit: d.originalDeposit,
      originalPlatformFee: d.originalPlatformFee,
      originalRentalItemsFee: d.originalRentalItemsFee,
      originalTotalAmount: d.originalTotalAmount,

      // 항목별 환불 금액
      rentalFeeRefundAmount: d.rentalFeeRefundAmount,
      cleaningFeeRefundAmount: d.cleaningFeeRefundAmount,
      maintenanceFeeRefundAmount: d.maintenanceFeeRefundAmount,
      depositRefundAmount: d.depositRefundAmount,
      rentalItemsFeeRefundAmount: d.rentalItemsFeeRefundAmount,

      // 호스트 납부
      hostBurdenAmount,
      penaltyAmount: d.penaltyAmount,

      // 게스트 환불
      guestRefundAmount: d.finalRefundAmount,

      // 게스트 보전 (결제일+3영업일 후)
      guestCompensationAmount: d.penaltyAmount,

      // 참고 정보
      daysBeforeCheckin: d.daysBeforeCheckin,
      refundRate: d.rentalFeeRefundRate,
      policyDisplayName: d.policyDisplayName,
      applicableRuleDescription: d.applicableRuleDescription,
      message: d.message
    }, '호스트 취소 부담금 미리보기');
  } catch (err) {
    console.error('호스트 취소 미리보기 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 호스트 취소 결제 준비 — 호스트 부담금 결제용 orderId 발급
 * POST /api/contracts/:contractId/cancel-by-host/prepare
 *
 * 호스트가 "취소 확정" 버튼을 누르는 시점에 호출.
 * 이미 발급된 hostBurdenOrderId가 있으면 재사용, 없으면 새로 생성하여 저장.
 * 프론트는 응답받은 orderId로 PG 결제창을 호출한다.
 */
const prepareHostCancelPayment = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { contractId } = req.params;
    const hostId = req.user.id;

    const contract = await Contract.findByPk(contractId, {
      include: [{ model: User, as: 'host', attributes: ['name', 'phoneNumber'] }],
      transaction
    });

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
      return error(res, { code: 4621, message: '결제 완료 상태에서만 호스트 취소가 가능합니다.' }, 400);
    }

    // 호스트 부담금 계산
    const refundResult = await calculateRefund(contract, new Date(), { faultType: 'HOST' });
    if (!refundResult.success) {
      await transaction.rollback();
      return error(res, { code: 4623, message: `환불 계산 실패: ${refundResult.error.message}` }, 500);
    }
    const d = refundResult.data;
    const hostBurdenAmount = d.penaltyAmount + (d.guestServiceFeeRefunded ? 0 : d.originalPlatformFee);

    // 이미 발급된 orderId가 있으면 재사용 (멱등성 보장)
    let hostBurdenOrderId = contract.hostBurdenOrderId;
    if (!hostBurdenOrderId) {
      hostBurdenOrderId = await generateOrderId(transaction);
      await contract.update({ hostBurdenOrderId }, { transaction });
    }

    await transaction.commit();

    return success(res, {
      orderId: hostBurdenOrderId,
      hostBurdenAmount,
      customerName: contract.host.name,
      customerPhone: contract.host.phoneNumber || null
    }, '호스트 부담금 결제 준비 완료');
  } catch (err) {
    await transaction.rollback();
    console.error('호스트 취소 결제 준비 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 호스트가 계약 취소 (부담금 결제 → 게스트 환불 순서)
 * POST /api/contracts/:contractId/cancel-by-host
 *
 * hostBurdenAmount > 0: 호스트 PG 결제 → 게스트 PG 취소
 * hostBurdenAmount = 0: 게스트 PG 취소만
 */
const cancelContractByHost = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { contractId } = req.params;
    const hostId = req.user.id;
    const { recvPayparam, payType, orderId, amount } = req.body;

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
      return error(res, { code: 4621, message: '결제 완료 상태에서만 호스트 취소가 가능합니다.' }, 400);
    }

    // [1] 환불 계산
    const cancellationDate = new Date();
    const refundResult = await calculateRefund(contract, cancellationDate, { faultType: 'HOST' });

    if (!refundResult.success) {
      await transaction.rollback();
      return error(res, { code: 4623, message: `환불 계산 실패: ${refundResult.error.message}` }, 500);
    }

    const refundData = refundResult.data;
    // refundRate=100(무료 취소)이면 platformFee는 게스트 환불에 포함되므로 호스트 부담 불필요
    const hostBurdenAmount = refundData.penaltyAmount + (refundData.guestServiceFeeRefunded ? 0 : refundData.originalPlatformFee);

    // [2] 호스트 부담금 PG 결제 (hostBurdenAmount > 0인 경우만)
    let hostPayment = null;
    if (hostBurdenAmount > 0) {
      if (!recvPayparam || !orderId || !amount) {
        await transaction.rollback();
        return error(res, { code: 4624, message: '부담금 결제 정보가 필요합니다. (recvPayparam, orderId, amount)' }, 400);
      }

      if (!contract.hostBurdenOrderId || contract.hostBurdenOrderId !== orderId) {
        await transaction.rollback();
        return error(res, ErrorCodes.ORDER_ID_MISMATCH, 400);
      }

      if (hostBurdenAmount !== parseInt(amount, 10)) {
        await transaction.rollback();
        return error(res, ErrorCodes.AMOUNT_MISMATCH, 400);
      }

      let paytagResponse;
      try {
        paytagResponse = await paytagClient.confirmPayment({
          recvPayparam,
          payType: payType || 'CARD'
        });
      } catch (paytagErr) {
        await transaction.rollback();
        console.error('[cancelByHost] 호스트 부담금 결제 실패:', paytagErr.message);
        return error(res, ErrorCodes.PAYMENT_CONFIRMATION_FAILED, 400, {
          pgErrorCode: paytagErr.paytagErrorCode,
          pgErrorMessage: paytagErr.paytagErrorMessage
        });
      }

      const paymentMethod = paytagClient.mapPaymentMethod(payType || 'CARD');
      const easyPayProvider = paytagClient.mapEasyPayProvider(payType || 'CARD');

      hostPayment = await Payment.create({
        contractId: contract.id,
        paymentType: 'HOST_BURDEN',
        paymentKey: paytagResponse.tran_key || paytagResponse.recv_orderno || orderId,
        orderId: contract.hostBurdenOrderId,
        method: paymentMethod,
        easyPayProvider,
        status: 'DONE',
        requestedAt: cancellationDate,
        approvedAt: cancellationDate,
        totalAmount: hostBurdenAmount,
        balanceAmount: hostBurdenAmount,
        suppliedAmount: Math.round(hostBurdenAmount / 1.1),
        vat: hostBurdenAmount - Math.round(hostBurdenAmount / 1.1),
        taxFreeAmount: 0,
        currency: 'KRW',
        receiptUrl: paytagResponse.receipt_url || null,
        checkoutUrl: null,
        paymentResponse: paytagResponse
      }, { transaction });
    }

    // [3] 게스트 결제금 PG 취소 (전액 환불)
    if (refundData.finalRefundAmount > 0) {
      const guestPayment = await Payment.findOne({
        where: { contractId: contract.id, status: { [Op.in]: ['DONE', 'PARTIAL_CANCELED'] } },
        transaction
      });

      if (guestPayment) {
        try {
          const { orderno, orgpaydate, orgtranamt, loginid } = paytagClient.extractCancelParams(guestPayment);
          const cancelamt = refundData.finalRefundAmount;
          const newBalance = guestPayment.balanceAmount - cancelamt;
          const canceltype = newBalance === 0 ? '0' : '1';

          const cancelResp = await paytagClient.cancelPayment({ orderno, orgpaydate, orgtranamt, loginid, cancelamt, canceltype });

          await guestPayment.update({
            balanceAmount: newBalance,
            status: newBalance === 0 ? 'CANCELED' : 'PARTIAL_CANCELED'
          }, { transaction });

          console.log(`[cancelByHost] 게스트 환불 완료: contractId=${contract.id}, cancelamt=${cancelamt}, restamt=${cancelResp.restamt}`);
        } catch (pgErr) {
          console.error('[cancelByHost] 게스트 환불 PG 취소 실패:', pgErr.message);

          // 호스트 부담금 결제가 성공했다면 PG 취소로 원복
          if (hostPayment) {
            try {
              const { orderno, orgpaydate, orgtranamt, loginid } = paytagClient.extractCancelParams(hostPayment);
              await paytagClient.cancelPayment({ orderno, orgpaydate, orgtranamt, loginid, cancelamt: hostBurdenAmount, canceltype: '0' });
              console.log(`[cancelByHost] 호스트 부담금 PG 원복 완료: contractId=${contract.id}`);
            } catch (rollbackErr) {
              console.error('[cancelByHost] 호스트 부담금 PG 원복 실패 (수동 처리 필요):', rollbackErr.message, { contractId: contract.id, hostBurdenAmount });
              // 원복 실패 시 관리자 수동 처리를 위해 반드시 로그 기록
              PaymentFailureLog.create({
                contractId: contract.id,
                orderId: hostPayment.orderId,
                failureCode: rollbackErr.paytagErrorCode || 'HOST_BURDEN_ROLLBACK_FAILED',
                failureMessage: rollbackErr.paytagErrorMessage || rollbackErr.message,
                requestData: JSON.stringify({
                  type: 'HOST_BURDEN_ROLLBACK',
                  cancelamt: hostBurdenAmount,
                  hostPaymentId: hostPayment.id
                }),
                responseData: rollbackErr.paytagResponse ? JSON.stringify(rollbackErr.paytagResponse) : null
              }).catch(logErr => console.error('[cancelByHost] PaymentFailureLog 저장 실패:', logErr.message));
            }
          }

          await transaction.rollback();
          return error(res, {
            code: 4900,
            message: `게스트 환불 처리 실패: ${pgErr.paytagErrorMessage || pgErr.message}`,
            pgErrorCode: pgErr.paytagErrorCode
          }, 502);
        }
      }
    }

    // [4] Refund 레코드 생성
    const refund = await Refund.create({
      contractId: contract.id,
      refundStatus: 'APPROVED',
      policyTypeUsed: refundData.policyTypeUsed,
      cancellationDate,
      checkInDate: contract.checkInDate,
      daysBeforeCheckin: refundData.daysBeforeCheckin,
      isSameDayCancellation: refundData.isSameDayCancellation,
      cancellationFaultType: 'HOST',
      hasEzCleaningService: refundData.hasEzCleaningService,
      originalDeposit: refundData.originalDeposit,
      originalPlatformFee: refundData.originalPlatformFee,
      originalRentalFee: contract.rentalFee,
      originalCleaningFee: contract.cleaningFee,
      originalMaintenanceFee: contract.maintenanceFee,
      originalTotalAmount: contract.finalTotalAmount,
      usageFee: refundData.usageFee,
      usageFeeRefundAmount: refundData.usageFeeRefundAmount,
      depositRefundAmount: refundData.depositRefundAmount,
      rentalFeeRefundRate: refundData.rentalFeeRefundRate,
      rentalFeeRefundAmount: refundData.rentalFeeRefundAmount,
      cleaningFeeRefundAmount: refundData.cleaningFeeRefundAmount,
      maintenanceFeeRefundAmount: refundData.maintenanceFeeRefundAmount,
      totalRefundAmount: refundData.totalRefundAmount,
      penaltyAmount: refundData.penaltyAmount,
      guestServiceFeeRefunded: refundData.guestServiceFeeRefunded,
      platformFeeDeducted: refundData.platformFeeDeducted,
      finalRefundAmount: refundData.finalRefundAmount,
      hostBurdenAmount,
      hostBurdenStatus: hostBurdenAmount > 0 ? 'PAID' : null,
      guestCompensationAmount: refundData.penaltyAmount,
      guestCompensationStatus: refundData.penaltyAmount > 0 ? 'PENDING' : null,
      refundMethod: 'ORIGINAL_PAYMENT',
      cancellationReason,
      requestedAt: cancellationDate,
      approvedAt: cancellationDate
    }, { transaction });

    // [5] 계약 상태 변경
    await contract.update({
      status: 'CANCELLED_BY_HOST',
      cancellationReason,
      cancelledAt: cancellationDate
    }, { transaction });

    // [6] 계약 상태 변경 로그
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
        hostBurdenAmount,
        hostBurdenPaymentId: hostPayment?.id || null,
        totalRefundAmount: refund.totalRefundAmount,
        penaltyAmount: refund.penaltyAmount,
        guestCompensationAmount: refund.guestCompensationAmount
      })
    }, { transaction });

    // [7] 게스트 보전 Payout 생성 (결제일 + 3영업일 후)
    if (refund.guestCompensationAmount > 0) {
      const payableAfter = calculatePayoutAvailableDate(cancellationDate);
      const { GuestRefundAccount } = require('../models');
      const guestRefundAccount = await GuestRefundAccount.findOne({ where: { userId: contract.guestId } });

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

      // 계좌 미등록 시 게스트에게 등록 안내 알림
      if (!guestRefundAccount) {
        const { compensationAccountRequired } = NotificationMessages;
        const msg = compensationAccountRequired();
        NotificationService.create({
          userId: contract.guestId,
          userMode: 'guest',
          type: 'PAYOUT_ACCOUNT_REQUIRED',
          title: msg.title,
          message: msg.message,
          relatedContractId: contract.id
        }).catch(err => console.error('[cancelByHost] 계좌 등록 안내 알림 실패 (무시됨):', err.message));
      }
    }

    // [8] 기존 CONTRACT_SETTLEMENT Payout/Settlement 취소
    await Payout.update(
      { status: 'CANCELLED', note: '호스트 취소로 인한 자동 취소' },
      { where: { contractId: contract.id, payoutType: 'CONTRACT_SETTLEMENT', status: { [Op.in]: ['PENDING', 'PAYABLE'] } }, transaction }
    );
    await Settlement.update(
      { status: 'ON_HOLD', note: '호스트 취소로 인한 정산 보류' },
      { where: { contractId: contract.id, status: 'PENDING' }, transaction }
    );

    await transaction.commit();

    // [9] ADDITIONAL 렌탈 주문 PG 취소 (트랜잭션 외부, 실패해도 응답은 성공 — 실패 시 PaymentFailureLog 기록)
    const additionalOrdersToCancel = await RentalOrder.findAll({
      where: {
        contractId: contract.id,
        orderType: 'ADDITIONAL',
        status: { [Op.in]: ['PAID', 'PARTIAL_REFUND'] }
      },
      include: [{ model: require('../models').RentalPayment, as: 'payment', required: false }]
    });

    for (const additionalOrder of additionalOrdersToCancel) {
      const rentalPayment = additionalOrder.payment;
      if (!rentalPayment || parseFloat(rentalPayment.balanceAmount) <= 0) continue;

      const cancelamt = parseFloat(rentalPayment.balanceAmount);
      try {
        const { orderno, orgpaydate, orgtranamt, loginid } = paytagClient.extractCancelParams(rentalPayment);
        await paytagClient.cancelPayment({ orderno, orgpaydate, orgtranamt, loginid, cancelamt, canceltype: '0' });

        // DB 업데이트 (짧은 트랜잭션)
        const additionalTx = await sequelize.transaction();
        try {
          await rentalPayment.update({ balanceAmount: 0, status: 'CANCELED' }, { transaction: additionalTx });
          await RentalOrderItem.update(
            { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: '호스트 귀책 계약 취소' },
            { where: { rentalOrderId: additionalOrder.id, status: { [Op.ne]: 'CANCELLED' } }, transaction: additionalTx }
          );
          await RentalItemReservation.update(
            { status: 'CANCELLED' },
            { where: { rentalOrderId: additionalOrder.id, status: { [Op.ne]: 'CANCELLED' } }, transaction: additionalTx }
          );
          await additionalOrder.update(
            { status: 'FULLY_REFUNDED', refundedAmount: additionalOrder.paidAmount },
            { transaction: additionalTx }
          );
          await additionalTx.commit();
          console.log(`[cancelByHost] ADDITIONAL 렌탈 취소 완료: orderId=${additionalOrder.orderId}, cancelamt=${cancelamt}`);
        } catch (dbErr) {
          await additionalTx.rollback();
          console.error(`[cancelByHost] ADDITIONAL 렌탈 DB 업데이트 실패 (PG 취소는 완료됨): orderId=${additionalOrder.orderId}`, dbErr.message);
          PaymentFailureLog.create({
            contractId: contract.id,
            orderId: additionalOrder.orderId,
            failureCode: 'ADDITIONAL_RENTAL_DB_UPDATE_FAILED',
            failureMessage: dbErr.message,
            requestData: JSON.stringify({ type: 'ADDITIONAL_RENTAL_HOST_CANCEL_DB', rentalOrderId: additionalOrder.id, cancelamt }),
            responseData: null
          }).catch(logErr => console.error('[cancelByHost] PaymentFailureLog 저장 실패:', logErr.message));
        }
      } catch (pgErr) {
        console.error(`[cancelByHost] ADDITIONAL 렌탈 PG 취소 실패 (수동 처리 필요): orderId=${additionalOrder.orderId}`, pgErr.message);
        PaymentFailureLog.create({
          contractId: contract.id,
          orderId: additionalOrder.orderId,
          failureCode: pgErr.paytagErrorCode || 'ADDITIONAL_RENTAL_PG_CANCEL_FAILED',
          failureMessage: pgErr.paytagErrorMessage || pgErr.message,
          requestData: JSON.stringify({ type: 'ADDITIONAL_RENTAL_HOST_CANCEL', rentalOrderId: additionalOrder.id, cancelamt }),
          responseData: pgErr.paytagResponse ? JSON.stringify(pgErr.paytagResponse) : null
        }).catch(logErr => console.error('[cancelByHost] PaymentFailureLog 저장 실패:', logErr.message));
      }
    }

    // 서비스 태스크 PENDING 삭제 (트랜잭션 외부)
    try {
      const { cancelPendingServiceTasks } = require('../schedulers/contractScheduler');
      await cancelPendingServiceTasks(contract.id);
    } catch (taskErr) {
      console.error('호스트 취소 서비스 태스크 삭제 실패 (무시됨):', taskErr);
    }

    // 예약된 알림 큐 전체 취소 (취소된 계약에 알림 발송 방지)
    try {
      const { cancelScheduledNotifications } = require('../queues/notificationQueue');
      await cancelScheduledNotifications(contract.id);
    } catch (queueErr) {
      console.error('[cancelByHost] 알림 큐 취소 실패 (무시됨):', queueErr);
    }

    // 채팅방 시스템 메시지 발송 + 쓰기 마감
    try {
      const chatRoom = await ChatRoom.findOne({ where: { contractId: contract.id } });
      if (chatRoom && chatRoom.firebaseChatRoomId) {
        const messageText = getSystemMessageTemplate(SystemMessageTypes.CONTRACT_CANCELED_BY_HOST);
        await sendSystemMessage(chatRoom.firebaseChatRoomId, messageText, SystemMessageTypes.CONTRACT_CANCELED_BY_HOST);
        setChatWritableUntil(chatRoom.firebaseChatRoomId, new Date()).catch(err => {
          console.error('호스트 취소 채팅 쓰기 마감 설정 실패 (무시됨):', err);
        });
      }
    } catch (chatErr) {
      console.error('호스트 취소 시스템 메시지 전송 실패 (무시됨):', chatErr);
    }

    // 알림 발송
    try {
      const [cancelGuest, cancelHost, cancelRoom] = await Promise.all([
        User.findByPk(contract.guestId, { attributes: ['id', 'phoneNumber', 'name', 'nickname'] }),
        User.findByPk(contract.hostId, { attributes: ['id', 'phoneNumber', 'name', 'nickname'] }),
        Room.findByPk(contract.roomId, { attributes: ['id', 'roomName'] })
      ]);
      await NotificationService.notifyContractCanceled(contract, CANCEL_TYPES.HOST_CANCEL, {
        guest: cancelGuest,
        host: cancelHost,
        room: cancelRoom,
        refundData: {
          guestCompensationAmount: refund.guestCompensationAmount,
          hostBurdenAmount: refund.hostBurdenAmount
        }
      });
    } catch (notifyErr) {
      console.error('호스트 취소 알림 전송 실패 (무시됨):', notifyErr);
    }

    return success(res, {
      contractId: contract.id,
      status: 'CANCELLED_BY_HOST',
      cancelledAt: toKSTString(contract.cancelledAt),
      refundId: refund.id,
      hostBurdenAmount,
      guestRefundAmount: refundData.finalRefundAmount,
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
    const userId = req.user.id;
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

    const isHost = contract.hostId === userId;
    const isGuest = contract.guestId === userId;

    if (!isHost && !isGuest) {
      return error(res, ErrorCodes.FORBIDDEN, 403);
    }

    if (contract.status !== 'IN_PROGRESS') {
      return error(res, {
        code: 4623,
        message: '임대 진행 중 상태에서만 취소 요청이 가능합니다.'
      }, 400);
    }

    const requesterRole = isHost ? 'HOST' : 'GUEST';
    const metadataType = isHost ? 'CANCEL_REQUEST_BY_HOST' : 'CANCEL_REQUEST_BY_GUEST';
    const systemMessageType = isHost
      ? SystemMessageTypes.CANCEL_REQUEST_BY_HOST
      : SystemMessageTypes.CANCEL_REQUEST_BY_GUEST;

    await contract.update({ status: 'CANCEL_REQUESTED' });

    // 취소요청 테이블에 기록
    await ContractCancelRequest.create({
      contractId: contract.id,
      requesterRole,
      requesterUserId: userId,
      reason,
      status: 'PENDING',
      requestedAt: new Date()
    });

    // 감사 로그
    await ContractStatusLog.create({
      contractId: contract.id,
      fromStatus: 'IN_PROGRESS',
      toStatus: 'CANCEL_REQUESTED',
      changedBy: requesterRole,
      changedByUserId: userId,
      reason,
      metadata: JSON.stringify({
        type: metadataType,
        requestedAt: new Date(),
        adminApprovalRequired: true
      })
    });

    // 채팅방 시스템 메시지 발송
    try {
      const chatRoom = await ChatRoom.findOne({ where: { contractId: contract.id } });
      if (chatRoom && chatRoom.firebaseChatRoomId) {
        const messageText = getSystemMessageTemplate(systemMessageType);
        await sendSystemMessage(chatRoom.firebaseChatRoomId, messageText, systemMessageType);
      }
    } catch (chatErr) {
      console.error('취소 요청 시스템 메시지 전송 실패 (무시됨):', chatErr);
    }

    // 상대방에게 알림 발송
    try {
      if (isHost) {
        await NotificationService.create({
          userId: contract.guestId,
          userMode: 'guest',
          type: 'CONTRACT',
          title: '계약 취소 요청',
          message: '호스트가 계약 취소를 요청했습니다. 관리자 확인 후 처리됩니다.',
          relatedContractId: contract.id
        });
      } else {
        await NotificationService.create({
          userId: contract.hostId,
          userMode: 'host',
          type: 'CONTRACT',
          title: '계약 취소 요청',
          message: '게스트가 계약 취소를 요청했습니다. 관리자 확인 후 처리됩니다.',
          relatedContractId: contract.id
        });
      }
    } catch (notifyErr) {
      console.error('취소 요청 알림 전송 실패 (무시됨):', notifyErr);
    }

    return success(res, {
      contractId: contract.id,
      cancelRequestStatus: 'PENDING_ADMIN_APPROVAL',
      reason
    }, '취소 요청이 접수되었습니다. 관리자 승인 후 처리됩니다.');

  } catch (err) {
    console.error('취소 요청 오류:', err);
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

    if (!['GUEST_COMPLETED', 'HOLD_REJECTED'].includes(contract.checkoutStatus)) {
      await transaction.rollback();
      return error(res, {
        code: 4632,
        message: '게스트 퇴실 완료 또는 보류 신청 반려 상태에서만 보류가 가능합니다.'
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

    // 보류 신청 이력 생성
    await DepositAgreement.create({
      contractId: contract.id,
      holdReason: reason.trim(),
      requestedAt: now,
      status: 'REQUESTED'
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
        checkoutStatusChange: `${contract.checkoutStatus} → HOLD_REQUESTED`,
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
      await NotificationService.create({
        userId: contract.guestId,
        userMode: 'guest',
        type: 'CONTRACT',
        title: '퇴실 확인 보류 신청',
        message: '호스트가 퇴실 확인 보류를 신청했습니다. 관리자 확인 중입니다.',
        relatedContractId: contract.id
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

    // 최신 APPROVED row 조회 (합의 제출 대상)
    const depositAgreement = await DepositAgreement.findOne({
      where: { contractId: contract.id, status: { [Op.in]: ['APPROVED', 'SUBMITTED'] } },
      order: [['createdAt', 'DESC']],
      transaction
    });

    if (!depositAgreement) {
      await transaction.rollback();
      return error(res, { code: 4645, message: '관리자 승인된 보류 신청이 없습니다.' }, 404);
    }

    // 게스트가 이미 동의한 경우 수정 불가
    if (depositAgreement.status === 'ACCEPTED') {
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

    // 최신 APPROVED row 업데이트
    await depositAgreement.update({
      deductAmount,
      agreementText: agreementText.trim(),
      submittedAt: new Date(),
      status: 'SUBMITTED'
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
      await NotificationService.create({
        userId: contract.guestId,
        userMode: 'guest',
        type: 'CONTRACT',
        title: '합의 내용 확인 요청',
        message: `호스트가 보증금 합의 내용을 제출했습니다. 확인해주세요. (차감 요청: ${deductAmount.toLocaleString()}원)`,
        relatedContractId: contract.id
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
          as: 'depositAgreements',
          required: false
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

    // 이력 최신순 정렬
    const depositAgreements = (contract.depositAgreements || [])
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    if (depositAgreements.length === 0) {
      return error(res, {
        code: 4650,
        message: '보류 신청 이력이 없습니다.'
      }, 404);
    }

    const latestDA = depositAgreements[0];

    return success(res, {
      contractId: contract.id,
      deposit: contract.deposit,
      checkoutStatus: contract.checkoutStatus,
      // 현재 진행 중인 합의 (최신 row)
      depositAgreement: {
        id: latestDA.id,
        status: latestDA.status,
        statusLabel: DepositAgreement.STATUS_LABELS[latestDA.status],
        requestedAt: toKSTString(latestDA.requestedAt),
        rejectedAt: latestDA.rejectedAt ? toKSTString(latestDA.rejectedAt) : null,
        rejectedReason: latestDA.rejectedReason,
        adminApprovedAt: latestDA.adminApprovedAt ? toKSTString(latestDA.adminApprovedAt) : null,
        deductAmount: latestDA.deductAmount,
        agreementText: latestDA.agreementText,
        submittedAt: latestDA.submittedAt ? toKSTString(latestDA.submittedAt) : null,
        acceptedAt: latestDA.acceptedAt ? toKSTString(latestDA.acceptedAt) : null,
        refundableAmount: latestDA.deductAmount != null ? (contract.deposit || 0) - latestDA.deductAmount : null
      },
      // 전체 이력
      history: depositAgreements.map(da => ({
        id: da.id,
        status: da.status,
        statusLabel: DepositAgreement.STATUS_LABELS[da.status],
        requestedAt: toKSTString(da.requestedAt),
        rejectedAt: da.rejectedAt ? toKSTString(da.rejectedAt) : null,
        rejectedReason: da.rejectedReason,
        createdAt: da.createdAt
      }))
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

    const contract = await Contract.findByPk(contractId, { transaction });

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

    // 최신 SUBMITTED row 조회
    const depositAgreement = await DepositAgreement.findOne({
      where: { contractId: contract.id, status: 'SUBMITTED' },
      order: [['createdAt', 'DESC']],
      transaction
    });

    if (!depositAgreement) {
      await transaction.rollback();
      return error(res, {
        code: 4661,
        message: '호스트가 제출한 합의 내용이 없습니다.'
      }, 404);
    }

    const depositDeduction = depositAgreement.deductAmount;
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
    await depositAgreement.update({
      status: 'ACCEPTED',
      acceptedAt: new Date()
    }, { transaction });

    // 퇴실 확인 + 보증금 상태 확정 처리
    await contract.update({
      checkoutStatus: 'HOST_CONFIRMED',
      hostCheckedOut: true,
      hostCheckedOutAt: new Date(),
      depositDeduction,
      deductionReason: depositAgreement.agreementText,
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
        const { orderno, orgpaydate, orgtranamt, loginid } = paytagClient.extractCancelParams(payment);
        const newBalance = payment.balanceAmount - refundableDeposit;
        const canceltype = newBalance === 0 ? '0' : '1';

        await paytagClient.cancelPayment({
          orderno,
          orgpaydate,
          orgtranamt,
          loginid,
          cancelamt: refundableDeposit,
          canceltype
        });

        await payment.update({
          balanceAmount: newBalance,
          status: newBalance === 0 ? 'CANCELED' : 'PARTIAL_CANCELED'
        });

        await contract.update({ depositReturnedAt: new Date() });

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

    // 채팅방 시스템 메시지 발송 + 차감확정 시 채팅 쓰기 마감 설정
    try {
      const chatRoom = await ChatRoom.findOne({ where: { contractId: contract.id } });
      if (chatRoom && chatRoom.firebaseChatRoomId) {
        const messageType = depositDeduction > 0
          ? SystemMessageTypes.DEPOSIT_DEDUCTION_CONFIRMED
          : SystemMessageTypes.DEPOSIT_RETURN_CONFIRMED;
        const messageText = getSystemMessageTemplate(messageType);
        await sendSystemMessage(chatRoom.firebaseChatRoomId, messageText, messageType);

        // PG 환불 완료 시점 기준 채팅 쓰기 마감 설정 (보증금 반환 완료 + 24H)
        // DEDUCTION_CONFIRMED: 스케줄러에서 RETURNED로 안 바뀌므로 여기서 처리
        // RETURN_CONFIRMED: PG 환불은 즉시 완료되므로 스케줄러 대기 없이 여기서 처리
        setChatWritableUntil(chatRoom.firebaseChatRoomId, new Date()).catch(err => {
          console.error('합의 동의 채팅 쓰기 마감 설정 실패 (무시됨):', err);
        });
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
 * @deprecated 제거됨 - cancel-by-host/preview 로 대체
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

    // orderId 검증 (prepare 시 발급한 hostBurdenOrderId 기반)
    if (!contract.hostBurdenOrderId || contract.hostBurdenOrderId !== orderId) {
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
    const easyPayProvider = paytagClient.mapEasyPayProvider(payType || 'CARD');

    // Payment 레코드 생성
    const payment = await Payment.create({
      contractId: contract.id,
      paymentType: 'HOST_BURDEN',
      paymentKey: paytagResponse.tran_key || paytagResponse.recv_orderno || orderId,
      orderId: contract.hostBurdenOrderId,
      method: paymentMethod,
      easyPayProvider,
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

/**
 * 계약 시점 방 상세 조회
 * GET /api/contracts/:contractId/room-detail
 *
 * 게스트가 계약 요청 전 봤던 방 상세 페이지를 snapshot 기반으로 재현
 * /api/rooms/:roomId 응답 포맷과 동일하게 반환
 */
const getContractRoomDetail = async (req, res) => {
  try {
    const { contractId } = req.params;
    const userId = req.user.id;

    const contract = await Contract.findByPk(contractId, {
      attributes: ['id', 'hostId', 'guestId', 'status', 'checkInDate', 'checkOutDate', 'snapshot', 'discountAmount', 'discountType']
    });

    if (!contract) {
      return error(res, { code: 3005, message: '계약을 찾을 수 없습니다' }, 404);
    }

    if (contract.hostId !== userId && contract.guestId !== userId) {
      return error(res, ErrorCodes.FORBIDDEN, 403);
    }

    const snap = contract.snapshot;
    if (!snap) {
      return error(res, { code: 3006, message: '방 스냅샷 정보가 없습니다' }, 404);
    }

    // amenity JSON 파싱 (DB에 문자열로 저장된 경우 대비)
    const parseJson = (val) => {
      if (!val || typeof val !== 'string') return val;
      try { return JSON.parse(val); } catch { return val; }
    };

    const amenity = snap.amenity ? {
      basicOptions: parseJson(snap.amenity.basicOptions),
      additionalOptions: parseJson(snap.amenity.additionalOptions),
      convenienceOptions: parseJson(snap.amenity.convenienceOptions),
      petsAllowed: snap.amenity.petsAllowed
    } : null;

    // detailAddress: 결제 완료 이상 상태에서만 노출
    const detailAddressVisible = [
      'PAYMENT_COMPLETED', 'IN_PROGRESS', 'COMPLETED', 'REFUNDED',
      'CANCEL_REQUESTED', 'CANCELLED_BY_HOST',
      'CANCELLED_BY_ADMIN_WITH_REFUND', 'CANCELLED_BY_ADMIN_NO_REFUND'
    ].includes(contract.status);

    // 할인 정보: 계약 체결 시점 기준으로 재구성
    // 계약 당시 적용된 할인은 discountAmount/discountType으로 확정됨
    const discountType = contract.discountType; // 'quick' | 'longTerm' | 'both' | null
    const discountAmount = contract.discountAmount || 0;
    const dailyRent = snap.dailyRent || 0;
    const totalDays = contract.checkInDate && contract.checkOutDate
      ? Math.round((new Date(contract.checkOutDate) - new Date(contract.checkInDate)) / (1000 * 60 * 60 * 24))
      : null;
    const stayWeeks = totalDays ? Math.floor(totalDays / 7) : null;
    const finalDailyRent = totalDays ? Math.round((dailyRent * totalDays - discountAmount) / totalDays) : dailyRent;

    const roomDetail = {
      // 기본 정보
      id: snap.roomId,
      roomName: snap.roomName,
      address: snap.address,
      detailAddress: detailAddressVisible ? (snap.detailAddress || null) : null,
      latitude: snap.latitude || null,
      longitude: snap.longitude || null,
      area: snap.area,
      floor: snap.floor,
      buildingType: snap.buildingType,

      // 구조 정보
      roomCount: snap.roomCount,
      bathroomCount: snap.bathroomCount,
      isDuplex: snap.isDuplex,
      elevatorAvailable: snap.elevatorAvailable,
      parkingAvailable: snap.parkingAvailable,
      parkingInfo: snap.parkingInfo,

      // 상세 정보
      maxGuests: snap.maxGuests,
      description: snap.description,
      checkInTime: snap.checkInTime,
      checkOutTime: snap.checkOutTime,

      // 요금 정보
      dailyRent: snap.dailyRent,
      dailyMaintenanceFee: snap.dailyMaintenanceFee,
      maintenanceDetail: snap.maintenanceDetail,
      includeElectricity: snap.includeElectricity,
      includeWater: snap.includeWater,
      includeGas: snap.includeGas,
      includeInternet: snap.includeInternet,
      cleaningFee: snap.cleaningFee,
      minContractDays: snap.minContractDays,
      refundPolicy: snap.refundPolicy,
      deposit: appConfig.deposit.DEFAULT,
      weeklyRent: snap.dailyRent ? snap.dailyRent * 7 : null,

      // 할인 정보 (계약 당시 적용 기준)
      longTermWeeks: snap.longTermWeeks,
      longTermDiscount: snap.longTermDiscount,
      quickMoveIn: snap.quickMoveIn,
      quickMoveInDiscount: snap.quickMoveInDiscount,
      finalDailyRent,
      totalDiscountAmount: discountAmount,
      appliedDiscounts: discountType === 'both' ? ['quick', 'longTerm']
        : discountType ? [discountType] : [],
      discounts: {
        quick: {
          quickMoveIn: snap.quickMoveIn,
          quickMoveInDiscount: snap.quickMoveInDiscount,
          isApplicable: discountType === 'quick' || discountType === 'both',
          discountAmount: (discountType === 'quick' || discountType === 'both')
            ? Math.round(dailyRent * (snap.quickMoveInDiscount || 0) / 100) : 0,
          daysUntilCheckIn: null  // 계약 당시 시점 재현 불가
        },
        longTerm: {
          longTermWeeks: snap.longTermWeeks,
          longTermDiscount: snap.longTermDiscount,
          isApplicable: discountType === 'longTerm' || discountType === 'both',
          discountAmount: (discountType === 'longTerm' || discountType === 'both')
            ? Math.round(dailyRent * (snap.longTermDiscount || 0) / 100) : 0,
          stayWeeks
        }
      },

      // 사진
      photos: (snap.photos || []).map(p => ({
        url: toAbsoluteUrl(p.url),
        order: p.order
      })),

      // 편의시설
      amenity,

      // 이지서비스
      ezService: snap.ezService || null,

      // 호스트 정보
      host: snap.host ? {
        ...snap.host,
        profileImageUrl: toAbsoluteUrl(snap.host.profileImageUrl)
      } : null,

      // 게스트 정보
      guest: snap.guest ? {
        ...snap.guest,
        profileImageUrl: toAbsoluteUrl(snap.guest.profileImageUrl)
      } : null,

      // 스냅샷 메타
      capturedAt: snap.capturedAt || null
    };

    return success(res, roomDetail);
  } catch (err) {
    console.error('계약 시점 방 상세 조회 오류:', err);
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
  getHostCancelPreview,
  prepareHostCancelPayment,
  cancelContractByHost,
  requestCancelByHost,
  holdCheckout,
  submitDepositAgreement,
  getDepositAgreement,
  acceptDepositAgreement,
  getContractRoomDetail
};
