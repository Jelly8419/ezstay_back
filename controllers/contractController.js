const { sequelize, Contract, Room, User, RoomPhoto, ChatRoom, Refund, RefundPolicyType, RefundPolicyRule, ContractStatusLog, Payment, PaymentFailureLog, RentalOrder, RentalOrderItem, RentalItemReservation, RentalItem } = require('../models');
const { success, error, created, updated, ErrorCodes } = require('../utils/responseHelper');
const axios = require('axios');
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
const { calculateRefund } = require('../utils/refundCalculator');
const { generateOrderId } = require('../utils/orderIdGenerator');
const { sendContractConfirmedMessages } = require('../schedulers/autoMessageScheduler');
const {
  createInitialRentalOrder,
  confirmRentalOrderPayment,
  getContractRentalSummary
} = require('../utils/rentalOrderHelper');

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
      discountCode,
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

    // 3-1. 환불정책 스냅샷 조회 (계약 시점의 정책 보존)
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

    // 5. 최소 계약 주수 확인
    if (room.minContractWeeks) {
      const totalWeeks = Math.floor(totalDays / 7);
      if (totalWeeks < room.minContractWeeks) {
        await transaction.rollback();
        return error(
          res,
          {
            code: 4305,
            message: `최소 ${room.minContractWeeks}주 이상 예약해야 합니다`
          },
          400
        );
      }
    }

    // 6. 렌탈 아이템 6일 정책 검증
    // 입주일(checkInDate)로부터 현재 시점이 6일 이내라면 렌탈 아이템 신청 불가
    if (rentalItems && Array.isArray(rentalItems) && rentalItems.length > 0) {
      const now = new Date();
      const checkIn = new Date(checkInDate);
      const diffMs = checkIn.getTime() - now.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);

      // 6일 이내인 경우 (예: 1월31일 14:00 입주, 1월25일 15:00 요청 → 약 5.96일 → 6일 이내)
      if (diffDays < 6) {
        await transaction.rollback();
        return error(
          res,
          ErrorCodes.RENTAL_NOT_AVAILABLE_WITHIN_6_DAYS,
          400,
          {
            checkInDate,
            requestedAt: now.toISOString(),
            daysUntilCheckIn: Math.floor(diffDays * 100) / 100, // 소수점 2자리
            minimumDaysRequired: 6,
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
      discountCode,
      serverCalculated.rentalFee,  // baseRent (임대료)
      totalDays,
      checkInDate,
      room
    );
    const discountAmountServer = discountInfo.discountAmount;
    const discountTypeServer = discountInfo.discountType;

    // 할인 적용 후 금액
    const afterDiscount = subtotalServer - discountAmountServer;

    // 플랫폼 수수료 계산 (9.9%)
    // - 기준: 임대료 + 관리비 + 청소비(EZ서비스 사용시 제외) - 총할인
    // - EZ청소서비스 사용 시 청소비는 수수료 계산에서 제외
    const hasFreeCleaningService = room.ezService?.cleaningService || false;
    const feeBase = serverCalculated.rentalFee +
                    serverCalculated.maintenanceFee +
                    (hasFreeCleaningService ? 0 : serverCalculated.cleaningFee) -
                    discountAmountServer;
    serverCalculated.platformFee = Math.floor(feeBase * 0.099);

    // 실이용 금액 (할인 적용 + 수수료 포함)
    serverCalculated.totalUsageFee = afterDiscount + serverCalculated.platformFee;

    // 보증금 (30만원 고정)
    serverCalculated.deposit = 300000;

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
        platformFee: serverCalculated.platformFee,
        discountAmount: discountAmountServer,
        discountType: discountTypeServer,
        discountCode: discountCode || null,

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

        // 가격 스냅샷 (분쟁 대비)
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

    // 13. TODO: 호스트에게 알림 전송 (추후 구현)
    // await sendNotificationToHost(room.hostId, { ... });

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
            thumbnailUrl: contract.room.photos[0]?.url || null
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
          discountCode: contract.discountCode,
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
            thumbnailUrl: contract.room.photos[0]?.url || null
          },

          // 게스트 정보
          guest: {
            id: contract.guest.id,
            name: contract.guest.name,
            nickname: contract.guest.nickname,
            phoneNumber: contract.guest.phoneNumber,
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
          discountCode: contract.discountCode,
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

          // 환불 정책 (계약 시점 스냅샷)
          refundPolicyType: contract.refundPolicyType,
          refundPolicySnapshot: contract.refundPolicySnapshot,

          // 방 정보
          room: {
            id: contract.room.id,
            roomName: contract.room.roomName,
            address: contract.room.address,
            detailAddress: contract.room.detailAddress,
            area: contract.room.area,
            buildingType: contract.room.buildingType,
            photos: contract.room.photos.map(photo => ({
              id: photo.id,
              url: photo.url,
              order: photo.order
            }))
          },

          // 호스트 정보
          host: {
            id: contract.host.id,
            name: contract.host.name,
            nickname: contract.host.nickname,
            phoneNumber: contract.host.phoneNumber,
            email: contract.host.email
          },

          // 게스트 정보
          guest: {
            id: contract.guest.id,
            name: contract.guest.name,
            nickname: contract.guest.nickname,
            phoneNumber: contract.guest.phoneNumber,
            email: contract.guest.email
          },

          // 시점 정보
          createdAt: contract.createdAt,
          approvedAt: contract.approvedAt,
          rejectedAt: contract.rejectedAt,
          paidAt: contract.paidAt,
          checkedInAt: contract.checkedInAt,
          checkedOutAt: contract.checkedOutAt,
          cancelledAt: contract.cancelledAt
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

    // 채팅방 자동 생성
    try {
      // Firebase 채팅방 ID 생성
      const firebaseChatRoomId = ChatRoom.generateFirebaseChatRoomId(contract.id);

      // 방 정보 조회
      const room = await Room.findByPk(contract.roomId, {
        attributes: ['id', 'roomName', 'address'],
        transaction
      });

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

      // Firestore에 채팅방 메타데이터 저장 (비동기, 실패해도 계약 승인은 유지)
      createChatRoomMetadata(firebaseChatRoomId, {
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
          profileImageUrl: host.profileImageUrl
        },
        guestInfo: {
          id: guest.id,
          name: guest.name,
          nickname: guest.nickname,
          profileImageUrl: guest.profileImageUrl
        },
        checkInDate: contract.checkInDate,
        checkOutDate: contract.checkOutDate,
        isActive: true
      }).catch(err => {
        console.error('Firestore 채팅방 메타데이터 생성 실패 (계약 승인은 완료됨):', err);
      });

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

      // 시스템 메시지 발송 (채팅방 생성 성공 시)
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

    // TODO: 게스트에게 승인 알림 전송 (추후 구현)
    // await sendNotificationToGuest(contract.guestId, { ... });

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
    // TODO: 게스트에게 거절 알림 전송 (추후 구현)

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

    // TODO: 호스트에게 취소 알림 전송 (추후 구현)
    // await sendNotificationToHost(contract.hostId, { ... });

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
    const refundableStatuses = ['APPROVED', 'PAYMENT_COMPLETED', 'IN_PROGRESS'];
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
    const refundableStatuses = ['APPROVED', 'PAYMENT_COMPLETED', 'IN_PROGRESS'];
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
    const contractStatus = autoApprove ? 'REFUND_APPROVED' : 'REFUND_REQUESTED';

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

      // 원본 금액
      originalRentalFee: contract.rentalFee,
      originalCleaningFee: contract.cleaningFee,
      originalMaintenanceFee: contract.maintenanceFee,
      originalTotalAmount: contract.finalTotalAmount,

      // 환불 금액
      rentalFeeRefundRate: refundData.rentalFeeRefundRate,
      rentalFeeRefundAmount: refundData.rentalFeeRefundAmount,
      cleaningFeeRefundAmount: refundData.cleaningFeeRefundAmount,
      maintenanceFeeRefundAmount: refundData.maintenanceFeeRefundAmount,
      totalRefundAmount: refundData.totalRefundAmount,

      // 수수료 및 공제액
      platformFeeDeducted: refundData.platformFeeDeducted,
      penaltyAmount: refundData.penaltyAmount,
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

    await transaction.commit();

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

          // 원본 금액
          originalRentalFee: refund.originalRentalFee,
          originalCleaningFee: refund.originalCleaningFee,
          originalMaintenanceFee: refund.originalMaintenanceFee,
          originalTotalAmount: refund.originalTotalAmount,

          // 환불 금액
          rentalFeeRefundRate: refund.rentalFeeRefundRate,
          rentalFeeRefundAmount: refund.rentalFeeRefundAmount,
          cleaningFeeRefundAmount: refund.cleaningFeeRefundAmount,
          maintenanceFeeRefundAmount: refund.maintenanceFeeRefundAmount,
          totalRefundAmount: refund.totalRefundAmount,
          finalRefundAmount: refund.finalRefundAmount,

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
          attributes: ['id', 'name', 'nickname', 'email']
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
      customerName: contract.guest.name
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

    return success(res, responseData, '결제 정보를 조회했습니다.');
  } catch (err) {
    console.error('결제 정보 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 결제 승인 (토스페이먼츠 API 호출)
 * POST /api/contracts/:contractId/confirm-payment
 */
const confirmPayment = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { contractId } = req.params;
    const { paymentKey, orderId, amount } = req.body;
    const guestId = req.user.id;

    // 필수 파라미터 검증
    if (!paymentKey || !orderId || !amount) {
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
    if (contract.finalTotalAmount !== parseInt(amount, 10)) {
      await transaction.rollback();
      return error(res, ErrorCodes.AMOUNT_MISMATCH, 400);
    }

    // 토스페이먼츠 API 호출
    const tossSecretKey = process.env.TOSS_SECRET_KEY;
    const encodedKey = Buffer.from(`${tossSecretKey}:`).toString('base64');

    let tossResponse;
    try {
      tossResponse = await axios.post(
        'https://api.tosspayments.com/v1/payments/confirm',
        {
          paymentKey,
          orderId,
          amount: parseInt(amount, 10)
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

      // 실패 로그 기록
      await PaymentFailureLog.create({
        contractId: contract.id,
        orderId,
        failureCode: tossError.response?.data?.code || 'UNKNOWN',
        failureMessage: tossError.response?.data?.message || tossError.message,
        requestData: { paymentKey, orderId, amount },
        responseData: tossError.response?.data || null,
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip || req.connection.remoteAddress
      });

      console.error('토스 결제 승인 실패:', tossError.response?.data || tossError.message);
      return error(res, ErrorCodes.PAYMENT_CONFIRMATION_FAILED, 400, {
        tossErrorCode: tossError.response?.data?.code,
        tossErrorMessage: tossError.response?.data?.message
      });
    }

    const paymentData = tossResponse.data;
    const now = new Date();

    // Payment 레코드 생성
    const payment = await Payment.create({
      contractId: contract.id,
      paymentKey: paymentData.paymentKey,
      orderId: paymentData.orderId,
      method: paymentData.method || 'CARD',
      status: paymentData.status,
      requestedAt: new Date(paymentData.requestedAt),
      approvedAt: paymentData.approvedAt ? new Date(paymentData.approvedAt) : now,
      totalAmount: paymentData.totalAmount,
      balanceAmount: paymentData.balanceAmount,
      suppliedAmount: paymentData.suppliedAmount,
      vat: paymentData.vat,
      taxFreeAmount: paymentData.taxFreeAmount || 0,
      currency: paymentData.currency || 'KRW',
      receiptUrl: paymentData.receipt?.url || null,
      checkoutUrl: paymentData.checkout?.url || null,
      paymentResponse: paymentData // 전체 응답 JSON 저장
    }, { transaction });

    // 토스 method를 Contract paymentMethod ENUM으로 매핑
    const mapPaymentMethod = (tossMethod) => {
      const methodMap = {
        'CARD': 'CREDIT_CARD',
        'VIRTUAL_ACCOUNT': 'BANK_TRANSFER',
        'TRANSFER': 'BANK_TRANSFER',
        'MOBILE': 'SIMPLE_PAY',
        'EASY_PAY': 'SIMPLE_PAY'
      };
      return methodMap[tossMethod] || 'CREDIT_CARD';
    };

    // Contract 상태 업데이트
    await contract.update({
      status: 'PAYMENT_COMPLETED',
      paymentMethod: mapPaymentMethod(paymentData.method),
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
        initialRentalOrder.id,
        paymentData.paymentKey,
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

    await transaction.commit();

    // 트랜잭션 커밋 후 호스트 자동메시지 발송 (비동기, 실패해도 결제 성공에 영향 없음)
    sendContractConfirmedMessages(contract.id, contract.roomId).catch(err => {
      console.error(`[자동메시지] 계약 확정 메시지 발송 실패 (무시됨):`, err);
    });

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
  updatePendingRentalItems
};
