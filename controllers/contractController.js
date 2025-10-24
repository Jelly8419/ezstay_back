const { sequelize, Contract, Room, User, RoomPhoto } = require('../models');
const { success, error, created, updated, ErrorCodes } = require('../utils/responseHelper');
const {
  calculateRentalItemsFee,
  calculateDiscount,
  validateRentalItemsStock,
  reserveRentalItems,
  cancelRentalItemReservations,
  validateDates
} = require('../utils/contractHelper');

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

    // 3. 방 존재 및 상태 확인 (무료부가서비스 정보 포함)
    const { RoomFreeService } = require('../models');
    const room = await Room.findOne({
      where: { id: roomId, status: 'published' },
      include: [
        {
          model: RoomFreeService,
          as: 'freeService'
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

    // 6. 렌탈 아이템 재고 확인
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

    // 7. 금액 재계산 및 검증
    const serverCalculated = {
      rentalFee: room.dailyRent * totalDays,
      maintenanceFee: (room.dailyMaintenanceFee || 0) * totalDays,
      cleaningFee: room.cleaningFee || 0,
      rentalItemsFee: await calculateRentalItemsFee(rentalItems, totalDays)
    };

    // 소계 계산 (할인 전)
    const subtotalServer =
      serverCalculated.rentalFee +
      serverCalculated.maintenanceFee +
      serverCalculated.cleaningFee +
      serverCalculated.rentalItemsFee;

    // 할인 금액 계산
    const discountInfo = await calculateDiscount(discountCode, subtotalServer, totalDays, room);
    const discountAmountServer = discountInfo.discountAmount;
    const discountTypeServer = discountInfo.discountType;

    // 할인 적용 후 금액
    const afterDiscount = subtotalServer - discountAmountServer;

    // 플랫폼 수수료 계산 (임대료 + 관리비 + 청소비의 10%)
    // 단, 무료부가서비스에서 청소 허용인 경우 청소비 제외
    const hasFreeCleaningService = room.freeService?.cleaningService || false;
    const feeBase = serverCalculated.rentalFee +
                    serverCalculated.maintenanceFee +
                    (hasFreeCleaningService ? 0 : serverCalculated.cleaningFee);
    serverCalculated.platformFee = Math.round(feeBase * 0.1);

    // 실이용 금액 (할인 적용 + 수수료 포함)
    serverCalculated.totalUsageFee = afterDiscount + serverCalculated.platformFee;

    // 보증금 (33만원 고정)
    serverCalculated.deposit = 330000;

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

    // 8. 계약 요청 생성
    const contract = await Contract.create(
      {
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

        // 특별 요청
        specialRequests: specialRequests || {},

        // 약관 동의
        termsAgreed
      },
      { transaction }
    );

    // 9. 렌탈 아이템 임시 예약 (재고 차감)
    if (rentalItems && Object.keys(rentalItems).length > 0) {
      await reserveRentalItems(contract.id, rentalItems, checkInDate, checkOutDate, transaction);
    }

    // 10. TODO: 호스트에게 알림 전송 (추후 구현)
    // await sendNotificationToHost(room.hostId, { ... });

    await transaction.commit();

    return created(
      res,
      {
        contractId: contract.id,
        status: contract.status,
        hostId: room.hostId,
        checkInDate: contract.checkInDate,
        checkOutDate: contract.checkOutDate,
        finalTotalAmount: contract.finalTotalAmount,
        createdAt: contract.createdAt
      },
      '계약 승인 요청이 전송되었습니다'
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

    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 게스트의 계약 요청 목록 조회
 * GET /api/contracts/guest
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
          attributes: ['id', 'name', 'phoneNumber']
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    return success(
      res,
      {
        contracts: contracts.map(contract => ({
          id: contract.id,
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

          // 렌탈 아이템
          rentalItems: contract.rentalItems,

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
            phoneNumber: contract.host.phoneNumber
          },

          createdAt: contract.createdAt
        }))
      },
      '계약 목록 조회 성공'
    );
  } catch (err) {
    console.error('게스트 계약 목록 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 호스트가 받은 계약 요청 목록 조회
 * GET /api/contracts/host
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
          attributes: ['id', 'name', 'phoneNumber', 'email']
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    return success(
      res,
      {
        contracts: contracts.map(contract => ({
          id: contract.id,
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
          attributes: ['id', 'name', 'phoneNumber', 'email']
        },
        {
          model: User,
          as: 'guest',
          attributes: ['id', 'name', 'phoneNumber', 'email']
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

    return success(
      res,
      {
        contract: {
          id: contract.id,
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

          // 렌탈 아이템
          rentalItems: contract.rentalItems,

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
            phoneNumber: contract.host.phoneNumber,
            email: contract.host.email
          },

          // 게스트 정보
          guest: {
            id: contract.guest.id,
            name: contract.guest.name,
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

    // 계약 승인 처리
    await contract.update(
      {
        status: 'APPROVED',
        approvedAt: new Date()
      },
      { transaction }
    );

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

module.exports = {
  createContractRequest,
  getGuestContracts,
  getHostContracts,
  getContractDetail,
  approveContract,
  rejectContract,
  cancelContractByGuest
};
