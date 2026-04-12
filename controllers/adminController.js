const { success, error, updated, ErrorCodes } = require('../utils/responseHelper');
const { toDateStrKST, toKSTString } = require('../utils/dateHelper');
const { User, Room, Contract, RoomPhoto, RoomAmenity, EzService, UserBankAccount, Inquiry, RoomMemo, Admin, RoomPasswordHistory, RoomStatusHistory, Payment, Refund, RentalOrder, RentalOrderItem, RentalOrderLog, RentalItem, RentalPayment, RentalPaymentFailureLog, ContractStatusLog, ChatRoom, DepositAgreement, PaymentFailureLog, Settlement, Payout, ServiceTask, ServiceTaskLog, sequelize } = require('../models');
const NotificationService = require('../services/notificationService');
const { Op } = require('sequelize');
const { invalidateRoomCache } = require('../utils/cacheInvalidation');
const { calculateProgress } = require('../utils/roomProgress');
const { toAbsoluteUrl } = require('../utils/urlHelper');
const { sendSystemMessage, setChatWritableUntil } = require('../config/firebaseAdmin');
const { SystemMessageTypes, getSystemMessageTemplate } = require('../utils/systemMessageTypes');
const { CANCEL_TYPES } = require('../utils/notificationMessages');
const { getBankName } = require('../utils/bankCodes');
const paytagClient = require('../utils/paytagClient');

/**
 * 대시보드 통계 조회
 * GET /api/admin/dashboard/stats
 */
const getDashboardStats = async (req, res) => {
  try {
    const now = new Date();
    const firstDayThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const firstDayLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDayLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    // 전체 사용자 수
    const totalUsers = await User.count({ where: { isActive: true } });
    const totalUsersLastMonth = await User.count({
      where: {
        isActive: true,
        createdAt: { [Op.lt]: firstDayThisMonth }
      }
    });

    // 전체 등록 매물 수 (published 상태)
    const totalProperties = await Room.count({ where: { status: 'published' } });
    const totalPropertiesLastMonth = await Room.count({
      where: {
        status: 'published',
        publishedAt: { [Op.lt]: firstDayThisMonth }
      }
    });

    // 활성 예약 수 (진행중 + 결제완료)
    const activeReservations = await Contract.count({
      where: {
        status: { [Op.in]: ['PAYMENT_COMPLETED', 'IN_PROGRESS'] }
      }
    });

    const activeReservationsLastMonth = await Contract.count({
      where: {
        status: { [Op.in]: ['PAYMENT_COMPLETED', 'IN_PROGRESS'] },
        createdAt: { [Op.lt]: firstDayThisMonth }
      }
    });

    // 이번 달 매출 - 계약 결제
    const monthlyContractRevenue = await Contract.sum('finalTotalAmount', {
      where: {
        status: { [Op.in]: ['PAYMENT_COMPLETED', 'IN_PROGRESS', 'COMPLETED'] },
        paidAt: { [Op.between]: [firstDayThisMonth, now] }
      }
    }) || 0;

    // 이번 달 매출 - 렌탈 결제
    const monthlyRentalRevenue = await RentalPayment.sum('totalAmount', {
      where: {
        status: 'DONE',
        approvedAt: { [Op.between]: [firstDayThisMonth, now] }
      }
    }) || 0;

    const monthlyRevenue = monthlyContractRevenue + monthlyRentalRevenue;

    // 지난 달 매출 - 계약 결제
    const lastMonthContractRevenue = await Contract.sum('finalTotalAmount', {
      where: {
        status: { [Op.in]: ['PAYMENT_COMPLETED', 'IN_PROGRESS', 'COMPLETED'] },
        paidAt: { [Op.between]: [firstDayLastMonth, lastDayLastMonth] }
      }
    }) || 0;

    // 지난 달 매출 - 렌탈 결제
    const lastMonthRentalRevenue = await RentalPayment.sum('totalAmount', {
      where: {
        status: 'DONE',
        approvedAt: { [Op.between]: [firstDayLastMonth, lastDayLastMonth] }
      }
    }) || 0;

    const lastMonthRevenue = lastMonthContractRevenue + lastMonthRentalRevenue;

    // 매물 심사 대기 수
    const pendingReviews = await Room.count({ where: { status: 'pending_review' } });

    // 미답변 문의 수
    const pendingInquiries = await Inquiry.count({ where: { status: 'pending' } });

    // 트렌드 계산
    const userTrend = totalUsersLastMonth > 0
      ? ((totalUsers - totalUsersLastMonth) / totalUsersLastMonth * 100).toFixed(1)
      : 0;

    const propertyTrend = totalPropertiesLastMonth > 0
      ? ((totalProperties - totalPropertiesLastMonth) / totalPropertiesLastMonth * 100).toFixed(1)
      : 0;

    const reservationTrend = activeReservationsLastMonth > 0
      ? ((activeReservations - activeReservationsLastMonth) / activeReservationsLastMonth * 100).toFixed(1)
      : 0;

    const revenueTrend = lastMonthRevenue > 0
      ? ((monthlyRevenue - lastMonthRevenue) / lastMonthRevenue * 100).toFixed(1)
      : 0;

    return success(res, {
      totalUsers,
      totalProperties,
      activeReservations,
      monthlyRevenue: {
        total: Math.round(monthlyRevenue),
        contract: Math.round(monthlyContractRevenue),
        rental: Math.round(monthlyRentalRevenue)
      },
      lastMonthRevenue: {
        total: Math.round(lastMonthRevenue),
        contract: Math.round(lastMonthContractRevenue),
        rental: Math.round(lastMonthRentalRevenue)
      },
      pendingReviews,
      pendingInquiries,
      trends: {
        user: {
          value: parseFloat(userTrend),
          isPositive: parseFloat(userTrend) >= 0
        },
        property: {
          value: parseFloat(propertyTrend),
          isPositive: parseFloat(propertyTrend) >= 0
        },
        reservation: {
          value: parseFloat(reservationTrend),
          isPositive: parseFloat(reservationTrend) >= 0
        },
        revenue: {
          value: parseFloat(revenueTrend),
          isPositive: parseFloat(revenueTrend) >= 0
        }
      }
    }, '대시보드 통계 조회 성공');
  } catch (err) {
    console.error('대시보드 통계 조회 실패:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 최근 활동 조회
 * GET /api/admin/dashboard/recent-activities
 */
const getRecentActivities = async (req, res) => {
  try {
    // 최근 예약 10건
    const recentReservations = await Contract.findAll({
      limit: 10,
      order: [['createdAt', 'DESC']],
      include: [
        {
          model: User,
          as: 'guest',
          attributes: ['id', 'name', 'nickname', 'email']
        },
        {
          model: Room,
          as: 'room',
          attributes: ['id', 'roomName', 'address']
        }
      ]
    });

    // TODO: 최근 문의 조회 (문의 모델 구현 후)
    const recentInquiries = [];

    return success(res, {
      recentReservations,
      recentInquiries
    }, '최근 활동 조회 성공');
  } catch (err) {
    console.error('최근 활동 조회 실패:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 유저 목록 조회 (관리자용)
 * GET /api/admin/users
 */
const getUsers = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      userType = '',
      isActive = '',
      sortBy = 'createdAt',
      sortOrder = 'DESC'
    } = req.query;

    const offset = (page - 1) * limit;
    const where = {};

    // 검색 조건
    if (search) {
      where[Op.or] = [
        { email: { [Op.like]: `%${search}%` } },
        { name: { [Op.like]: `%${search}%` } },
        { nickname: { [Op.like]: `%${search}%` } },
        { phoneNumber: { [Op.like]: `%${search}%` } }
      ];
    }

    // 회원 타입 필터
    if (userType) {
      where.userType = userType;
    }

    // 활성 상태 필터
    if (isActive !== '') {
      where.isActive = isActive === 'true';
    }

    const { rows: users, count: total } = await User.findAndCountAll({
      where,
      offset: parseInt(offset),
      limit: parseInt(limit),
      order: [[sortBy, sortOrder]],
      attributes: { exclude: ['refreshToken'] },
      include: [
        {
          model: require('../models').UserBankAccount,
          as: 'bankAccounts',
          attributes: ['id'],
          required: false
        }
      ]
    });

    // 계좌 등록 여부 필드 추가
    const usersWithBankStatus = users.map(user => {
      const userData = user.toJSON();
      userData.hasBankAccount = (userData.bankAccounts && userData.bankAccounts.length > 0);
      delete userData.bankAccounts;
      return userData;
    });

    return success(res, {
      users: usersWithBankStatus,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit)
      }
    }, '유저 목록 조회 성공');
  } catch (err) {
    console.error('유저 목록 조회 실패:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 유저 상세 조회 (관리자용)
 * GET /api/admin/users/:userId
 */
const getUserDetail = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findByPk(userId, {
      attributes: { exclude: ['refreshToken'] },
      include: [
        {
          model: require('../models').LocalUser,
          as: 'localProfile',
          attributes: ['emailVerified', 'failedLoginAttempts', 'lockUntil'],
          required: false
        },
        {
          model: require('../models').SocialUser,
          as: 'socialProfiles',
          attributes: ['provider', 'providerEmail', 'createdAt'],
          required: false
        },
        {
          model: require('../models').UserBankAccount,
          as: 'bankAccounts',
          attributes: [
            'id',
            'bankName',
            'accountNumber',
            'accountHolder',
            'isPrimary',
            'isVerified',
            'verifiedAt'
          ],
          required: false,
          order: [['isPrimary', 'DESC'], ['createdAt', 'DESC']]
        },
        {
          model: require('../models').GuestRefundAccount,
          as: 'refundAccount',
          attributes: [
            'id',
            'bankCode',
            'bankName',
            'accountNumber',
            'accountHolder',
            'isVerified',
            'verifiedAt'
          ],
          required: false
        }
      ]
    });

    if (!user) {
      return error(res, ErrorCodes.USER_NOT_FOUND, 404);
    }

    // 호스트: 현재 게시중인 방 개수
    const hostActiveRoomsCount = await Room.count({
      where: { hostId: userId, status: 'published', isActive: true }
    });

    // 유효 계약 상태 필터 (결제완료/입주중/완료)
    const activeContractStatuses = ['PAYMENT_COMPLETED', 'IN_PROGRESS', 'COMPLETED'];

    // 호스트로서 계약 건수
    const hostContractsCount = await Contract.count({
      where: { hostId: userId, status: activeContractStatuses }
    });

    // 게스트로서 계약 건수
    const guestContractsCount = await Contract.count({
      where: { guestId: userId, status: activeContractStatuses }
    });

    // 가입 유형 상세 정보 구성
    const accountTypeDetail = user.userType === 'local'
      ? {
          type: 'email',
          emailVerified: user.localProfile?.emailVerified || false,
          failedLoginAttempts: user.localProfile?.failedLoginAttempts || 0,
          isLocked: user.localProfile?.lockUntil && new Date(user.localProfile.lockUntil) > new Date()
        }
      : {
          type: 'social',
          providers: user.socialProfiles?.map(sp => ({
            provider: sp.provider,
            providerEmail: sp.providerEmail,
            connectedAt: sp.createdAt
          })) || []
        };

    // 계좌 인증 여부 확인
    const hasVerifiedBankAccount = user.bankAccounts?.some(acc => acc.isVerified) || false;
    const hasRefundAccount = !!user.refundAccount;

    // 응답 데이터 구성
    const userData = user.toJSON();
    delete userData.localProfile;
    delete userData.socialProfiles;

    // 은행 코드 → 은행명 치환
    if (userData.bankAccounts) {
      userData.bankAccounts = userData.bankAccounts.map(acc => ({
        ...acc,
        bankName: getBankName(acc.bankName)
      }));
    }
    if (userData.refundAccount) {
      userData.refundAccount = {
        ...userData.refundAccount,
        bankName: getBankName(userData.refundAccount.bankCode || userData.refundAccount.bankName)
      };
    }

    return success(res, {
      ...userData,
      accountTypeDetail,
      hasVerifiedBankAccount,
      hasRefundAccount,
      hostActiveRoomsCount,
      hostContractsCount,
      guestContractsCount
    }, '유저 상세 조회 성공');
  } catch (err) {
    console.error('유저 상세 조회 실패:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 유저 상태 변경 (활성/비활성/정지)
 * PATCH /api/admin/users/:userId/status
 * body: { accountStatus: 'active' | 'suspended' | 'withdrawn' } 또는 { isActive: boolean } (하위호환)
 */
const updateUserStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const { isActive, accountStatus } = req.body;

    const user = await User.findByPk(userId);
    if (!user) {
      return error(res, ErrorCodes.USER_NOT_FOUND, 404);
    }

    // accountStatus가 제공된 경우 (새 방식)
    if (accountStatus) {
      if (!['active', 'suspended', 'withdrawn'].includes(accountStatus)) {
        return error(res, ErrorCodes.VALIDATION_ERROR, 400);
      }
      user.accountStatus = accountStatus;
      user.isActive = accountStatus === 'active';
    }
    // isActive만 제공된 경우 (하위호환)
    else if (typeof isActive === 'boolean') {
      user.isActive = isActive;
      user.accountStatus = isActive ? 'active' : 'suspended';
    } else {
      return error(res, ErrorCodes.VALIDATION_ERROR, 400);
    }

    await user.save();

    return success(res, user, '유저 상태 변경 성공');
  } catch (err) {
    console.error('유저 상태 변경 실패:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 매물 목록 조회 (관리자용)
 * GET /api/admin/properties
 */
const getProperties = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      status = '',
      sortBy = 'createdAt',
      sortOrder = 'DESC'
    } = req.query;

    const offset = (page - 1) * limit;
    const where = {};

    // 검색 조건
    if (search) {
      where[Op.or] = [
        { roomName: { [Op.like]: `%${search}%` } },
        { address: { [Op.like]: `%${search}%` } }
      ];
    }

    // 상태 필터
    if (status) {
      where.status = status;
    }

    const { rows: properties, count: total } = await Room.findAndCountAll({
      where,
      offset: parseInt(offset),
      limit: parseInt(limit),
      order: [[sortBy, sortOrder]],
      include: [
        {
          model: User,
          as: 'host',
          attributes: ['id', 'name', 'nickname', 'email', 'phoneNumber']
        },
        {
          model: RoomPhoto,
          as: 'photos',
          attributes: ['id', 'url'],
          limit: 1,
          order: [['order', 'ASC']]
        }
      ]
    });

    return success(res, {
      properties,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit)
      }
    }, '매물 목록 조회 성공');
  } catch (err) {
    console.error('매물 목록 조회 실패:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 매물 심사 대기 목록 조회
 * GET /api/admin/properties/pending-review
 */
const getPendingReviews = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const { rows: properties, count: total } = await Room.findAndCountAll({
      where: { status: 'pending_review' },
      offset: parseInt(offset),
      limit: parseInt(limit),
      order: [['submittedAt', 'ASC']], // 제출일 순
      include: [
        {
          model: User,
          as: 'host',
          attributes: ['id', 'name', 'nickname', 'email', 'phoneNumber']
        },
        {
          model: RoomPhoto,
          as: 'photos',
          attributes: ['id', 'url', 'order']
        }
      ]
    });

    return success(res, {
      properties,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit)
      }
    }, '심사 대기 매물 조회 성공');
  } catch (err) {
    console.error('심사 대기 매물 조회 실패:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 매물 승인
 * POST /api/admin/properties/:roomId/approve
 */
const approveProperty = async (req, res) => {
  try {
    const { roomId } = req.params;
    const adminId = req.admin.id;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent');

    const room = await Room.findByPk(roomId);
    if (!room) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    if (room.status !== 'pending_review') {
      return error(res, {
        code: 4301,
        message: '심사 대기 중인 매물만 승인할 수 있습니다.'
      }, 400);
    }

    const transaction = await sequelize.transaction();
    try {
      const previousStatus = room.status;
      room.status = 'published';
      room.approvedAt = new Date();
      room.publishedAt = new Date();
      room.isActive = true;
      await room.save({ transaction });

      // 심사 승인 이력 저장
      await RoomStatusHistory.create({
        roomId,
        adminId,
        previousStatus,
        newStatus: 'published',
        reason: '심사 승인',
        ipAddress,
        userAgent,
        changedAt: new Date()
      }, { transaction });

      await transaction.commit();
    } catch (txErr) {
      await transaction.rollback();
      throw txErr;
    }

    // 캐시 무효화 (ETag 버전 증가)
    await invalidateRoomCache();

    // 호스트에게 승인 알림 전송
    try {
      await NotificationService.notifyPropertyReviewResult(
        room,
        true // isApproved
      );
    } catch (notifyErr) {
      console.error('매물 승인 알림 전송 실패:', notifyErr);
    }

    return success(res, room, '매물 승인 완료');
  } catch (err) {
    console.error('매물 승인 실패:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 매물 반려
 * POST /api/admin/properties/:roomId/reject
 */
const rejectProperty = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { rejectionReason } = req.body;
    const adminId = req.admin.id;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent');

    if (!rejectionReason) {
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400);
    }

    const room = await Room.findByPk(roomId);
    if (!room) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    if (room.status !== 'pending_review') {
      return error(res, {
        code: 4302,
        message: '심사 대기 중인 매물만 반려할 수 있습니다.'
      }, 400);
    }

    const transaction = await sequelize.transaction();
    try {
      const previousStatus = room.status;
      room.status = 'rejected';
      room.rejectionReason = rejectionReason;
      await room.save({ transaction });

      // 심사 반려 이력 저장
      await RoomStatusHistory.create({
        roomId,
        adminId,
        previousStatus,
        newStatus: 'rejected',
        reason: rejectionReason,
        ipAddress,
        userAgent,
        changedAt: new Date()
      }, { transaction });

      await transaction.commit();
    } catch (txErr) {
      await transaction.rollback();
      throw txErr;
    }

    // 캐시 무효화 (ETag 버전 증가)
    await invalidateRoomCache();

    // 호스트에게 반려 알림 전송
    try {
      await NotificationService.notifyPropertyReviewResult(
        room,
        false, // isApproved
        rejectionReason
      );
    } catch (notifyErr) {
      console.error('매물 반려 알림 전송 실패:', notifyErr);
    }

    return success(res, room, '매물 반려 완료');
  } catch (err) {
    console.error('매물 반려 실패:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 매물 상세 조회 (관리자용 - 심사용)
 * GET /api/admin/properties/:roomId
 */
const getPropertyDetail = async (req, res) => {
  try {
    const { roomId } = req.params;

    // Room 정보 조회 (호스트 검증 없음, 관리자는 모든 방 조회 가능)
    const room = await Room.findByPk(roomId, {
      include: [
        {
          model: RoomPhoto,
          as: 'photos',
          attributes: ['id', 'url', 'order'],
          separate: true,
          order: [['order', 'ASC']]
        },
        {
          model: RoomAmenity,
          as: 'amenity'
        },
        {
          model: EzService,
          as: 'ezService'
        },
        {
          model: User,
          as: 'host',
          attributes: ['id', 'name', 'nickname', 'email', 'phoneNumber', 'phoneVerified'],
          include: [
            {
              model: UserBankAccount,
              as: 'bankAccounts',
              attributes: ['id'],
              limit: 1
            }
          ]
        }
      ]
    });

    if (!room) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    // 진행 단계 계산
    const registrationProgress = calculateProgress(room);

    // 호스트 정보 가공
    const hostInfo = {
      id: room.host.id,
      name: room.host.name,
      email: room.host.email,
      phoneNumber: room.host.phoneNumber,
      phoneVerified: room.host.phoneVerified || false,
      hasBankAccount: room.host.bankAccounts && room.host.bankAccounts.length > 0
    };

    // 응답 데이터 구조화
    const responseData = {
      // 기본 정보
      id: room.id,
      roomName: room.roomName,
      address: room.address,
      detailAddress: room.detailAddress,  // 관리자는 상세주소 확인 가능
      latitude: room.latitude,
      longitude: room.longitude,
      area: room.area,
      floor: room.floor,
      buildingType: room.buildingType,
      parkingAvailable: room.parkingAvailable,
      parkingInfo: room.parkingInfo,
      elevatorAvailable: room.elevatorAvailable,
      roomCount: room.roomCount,
      bathroomCount: room.bathroomCount,
      isDuplex: room.isDuplex,
      entrancePassword: room.entrancePassword,  // 관리자는 현관 비밀번호 확인 가능

      // 요금 정보 (1일 기준, 할인 기준은 주 단위)
      dailyRent: room.dailyRent,
      dailyMaintenanceFee: room.dailyMaintenanceFee,
      longTermWeeks: room.longTermWeeks,
      longTermDiscount: room.longTermDiscount,
      quickMoveIn: room.quickMoveIn,
      quickMoveInDiscount: room.quickMoveInDiscount,
      maintenanceDetail: room.maintenanceDetail,
      includeElectricity: room.includeElectricity,
      includeWater: room.includeWater,
      includeGas: room.includeGas,
      includeInternet: room.includeInternet,
      cleaningFee: room.cleaningFee,
      minContractDays: room.minContractDays,
      refundPolicy: room.refundPolicy,

      // 사진
      photos: room.photos.map(photo => ({
        id: photo.id,
        url: toAbsoluteUrl(photo.url),
        order: photo.order
      })),

      // 편의시설
      amenities: room.amenity ? {
        basicOptions: room.amenity.basicOptions,
        additionalOptions: room.amenity.additionalOptions,
        convenienceOptions: room.amenity.convenienceOptions,
        petsAllowed: room.amenity.petsAllowed
      } : null,

      // 이지서비스 (청소서비스 + 도어락)
      ezService: room.ezService ? {
        cleaningService: room.ezService.cleaningService,
        roomPassword: room.ezService.roomPassword
      } : null,

      // 방 소개 및 입퇴실 시간
      description: room.description,
      maxGuests: room.maxGuests,
      checkInTime: room.checkInTime,
      checkOutTime: room.checkOutTime,

      // 상태
      status: room.status,
      submittedAt: room.submittedAt ? toKSTString(room.submittedAt) : null,
      approvedAt: room.approvedAt,
      publishedAt: room.publishedAt,
      rejectionReason: room.rejectionReason,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,

      // 호스트 정보
      host: hostInfo,

      // 등록 진행 상태
      registrationProgress
    };

    return success(res, responseData, '매물 상세 조회 성공');
  } catch (err) {
    console.error('매물 상세 조회 실패:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 취소요청 목록 조회 (관리자용)
 * GET /api/admin/reservations/cancel-requests
 * Query: page, limit, requesterRole(HOST|GUEST), search, startDate, endDate, sortOrder
 */
const getCancelRequests = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      requesterRole,
      search,
      startDate,
      endDate,
      sortOrder = 'DESC'
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // 게스트 검색 조건
    const guestWhere = {};
    if (search) {
      guestWhere[Op.or] = [
        { name: { [Op.like]: `%${search}%` } },
        { email: { [Op.like]: `%${search}%` } }
      ];
    }

    // 취소요청 로그 조건 (인덱스 사용: idx_to_status + idx_changed_by)
    const logWhere = {
      toStatus: 'CANCEL_REQUESTED',
      changedBy: { [Op.in]: ['HOST', 'GUEST'] }
    };
    if (requesterRole && ['HOST', 'GUEST'].includes(requesterRole)) {
      logWhere.changedBy = requesterRole;
    }
    if (startDate) {
      logWhere.createdAt = { ...logWhere.createdAt, [Op.gte]: new Date(startDate + 'T00:00:00') };
    }
    if (endDate) {
      logWhere.createdAt = { ...logWhere.createdAt, [Op.lte]: new Date(endDate + 'T23:59:59') };
    }

    const { rows: contracts, count: total } = await Contract.findAndCountAll({
      where: { status: 'CANCEL_REQUESTED' },
      include: [
        {
          model: ContractStatusLog,
          as: 'statusLogs',
          where: logWhere,
          required: true,
          attributes: ['id', 'changedBy', 'reason', 'createdAt'],
          separate: false,
          order: [['createdAt', 'DESC']],
          limit: 1
        },
        {
          model: User,
          as: 'guest',
          attributes: ['id', 'name', 'nickname', 'email', 'phoneNumber'],
          where: Object.keys(guestWhere).length ? guestWhere : undefined,
          required: !!search
        },
        {
          model: User,
          as: 'host',
          attributes: ['id', 'name', 'nickname', 'email']
        },
        {
          model: Room,
          as: 'room',
          attributes: ['id', 'roomName', 'address']
        }
      ],
      order: [['createdAt', sortOrder === 'ASC' ? 'ASC' : 'DESC']],
      limit: parseInt(limit),
      offset,
      distinct: true
    });

    const result = contracts.map(c => {
      const log = c.statusLogs && c.statusLogs[0];
      return {
        contractId: c.id,
        status: c.status,
        requesterRole: log ? log.changedBy : null,
        cancelReason: log ? log.reason : null,
        requestedAt: log ? toKSTString(log.createdAt) : null,
        checkInDate: toKSTString(c.checkInDate),
        checkOutDate: toKSTString(c.checkOutDate),
        finalTotalAmount: c.finalTotalAmount,
        guest: c.guest,
        host: c.host,
        room: c.room
      };
    });

    return success(res, {
      contracts: result,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (err) {
    console.error('취소요청 목록 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 예약 목록 조회 (관리자용)
 * GET /api/admin/reservations
 */
const getReservations = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status = '',
      search = '',
      sortBy = 'createdAt',
      sortOrder = 'DESC'
    } = req.query;

    const offset = (page - 1) * limit;
    const where = {};

    // 상태 필터
    if (status) {
      where.status = status;
    }

    // 검색 조건 (게스트 이름, 이메일, 방 이름으로 검색)
    let include = [
      {
        model: User,
        as: 'guest',
        attributes: ['id', 'name', 'nickname', 'email', 'phoneNumber']
      },
      {
        model: User,
        as: 'host',
        attributes: ['id', 'name', 'nickname', 'email']
      },
      {
        model: Room,
        as: 'room',
        attributes: ['id', 'roomName', 'address']
      }
    ];

    if (search) {
      include = include.map(inc => {
        if (inc.as === 'guest') {
          return {
            ...inc,
            where: {
              [Op.or]: [
                { name: { [Op.like]: `%${search}%` } },
                { email: { [Op.like]: `%${search}%` } }
              ]
            },
            required: true
          };
        }
        return inc;
      });
    }

    const { rows: reservations, count: total } = await Contract.findAndCountAll({
      where,
      offset: parseInt(offset),
      limit: parseInt(limit),
      order: [[sortBy, sortOrder]],
      include
    });

    return success(res, {
      reservations,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit)
      }
    }, '예약 목록 조회 성공');
  } catch (err) {
    console.error('예약 목록 조회 실패:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 예약 상세 조회
 * GET /api/admin/reservations/:contractId
 */
const getReservationDetail = async (req, res) => {
  try {
    const { contractId } = req.params;

    const reservation = await Contract.findByPk(contractId, {
      include: [
        {
          model: User,
          as: 'guest',
          attributes: { exclude: ['refreshToken'] }
        },
        {
          model: User,
          as: 'host',
          attributes: { exclude: ['refreshToken'] }
        },
        {
          model: Room,
          as: 'room',
          include: [
            {
              model: RoomPhoto,
              as: 'photos',
              attributes: ['id', 'url', 'order']
            },
            {
              model: EzService,
              as: 'ezService',
              required: false
            }
          ]
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
          where: { status: { [Op.notIn]: ['CANCELLED', 'INITIAL'] } },
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
            }
          ]
        },
        {
          model: DepositAgreement,
          as: 'depositAgreements',
          required: false
        }
      ]
    });

    if (!reservation) {
      return error(res, {
        code: 3005,
        message: '예약을 찾을 수 없습니다.'
      }, 404);
    }

    // === 결제/환불 타임라인 구성 ===
    const timeline = [];

    // 1) 계약 결제 완료
    if (reservation.payment && reservation.payment.status !== 'READY') {
      const p = reservation.payment;
      const details = [`방 계약`];
      if (reservation.room) details[0] = `방 계약, ${reservation.room.roomName}`;

      timeline.push({
        occurredAt: p.approvedAt || p.createdAt,
        type: '결제완료',
        amount: p.totalAmount,
        description: details.join(', '),
        actor: 'guest',
        actorName: reservation.guest?.name || null,
        pgStatus: p.status,
        paymentKey: p.paymentKey,
        method: p.method
      });
    }

    // 2) 계약 환불 이력
    (reservation.refunds || []).forEach(r => {
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
          type: '부분취소',
          amount: -(r.finalRefundAmount || 0),
          description,
          actor: metadata.changedBy || 'system',
          actorName: null,
          refundId: r.id
        });
      }
    });

    // 3) 렌탈 결제/환불 이력 (RentalOrderLog 기반)
    const rentalLogs = await RentalOrderLog.findAll({
      where: {
        contractId: reservation.id,
        action: { [Op.in]: ['PAYMENT_COMPLETED', 'REFUND_COMPLETED', 'ITEM_CANCELLED', 'ORDER_CANCELLED'] }
      },
      include: [{
        model: RentalOrder,
        as: 'order',
        attributes: ['id', 'orderId', 'orderType'],
        where: { orderType: { [Op.ne]: 'INITIAL' } },
        required: true
      }],
      order: [['createdAt', 'ASC']]
    });

    const rentalOrderMap = new Map(
      (reservation.rentalOrders || []).map(ro => [ro.id, ro])
    );

    rentalLogs.forEach(log => {
      const isPayment = log.action === 'PAYMENT_COMPLETED';
      const isOrderCancelled = log.action === 'ORDER_CANCELLED';
      const metadata = log.metadata || {};

      let description;
      let type;

      if (isPayment) {
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
    const contractPaidAmount = reservation.finalTotalAmount || 0;
    const contractRefundTotal = (reservation.refunds || [])
      .filter(r => r.refundStatus === 'COMPLETED')
      .reduce((sum, r) => sum + (r.finalRefundAmount || 0), 0);
    const rentalPaidTotal = (reservation.rentalOrders || [])
      .reduce((sum, ro) => sum + (parseFloat(ro.paidAmount) || 0), 0);
    const rentalRefundTotal = (reservation.rentalOrders || [])
      .reduce((sum, ro) => sum + (parseFloat(ro.refundedAmount) || 0), 0);

    // === 보증금 퇴실 흐름 타임라인 ===
    // checkoutStatus가 NOT_STARTED이고 관련 시점 데이터도 없으면 null 반환
    const hasCheckoutFlow = reservation.checkoutStatus !== 'NOT_STARTED'
      || reservation.checkoutRequestedAt != null;

    let checkoutTimeline = null;
    if (hasCheckoutFlow) {
      const steps = [];
      const depositAgreementsSorted = (reservation.depositAgreements || [])
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      const da = depositAgreementsSorted[0] || null;

      // 1) 퇴실 확인 요청 (게스트)
      if (reservation.checkoutRequestedAt) {
        steps.push({
          step: 'CHECKOUT_REQUESTED',
          label: '퇴실 확인 요청',
          actor: 'guest',
          occurredAt: toKSTString(reservation.checkoutRequestedAt),
          isAuto: !reservation.checkoutRequested  // 스케줄러 자동 처리 여부
        });
      }

      // 2a) 퇴실 확인 (호스트) — 보류 없이 바로 확인한 경우
      if (reservation.hostCheckedOutAt && !reservation.holdRequestedAt) {
        steps.push({
          step: 'CHECKOUT_CONFIRMED',
          label: '퇴실 확인',
          actor: 'host',
          occurredAt: toKSTString(reservation.hostCheckedOutAt)
        });
      }

      // 2b) 보류 신청 (호스트)
      if (reservation.holdRequestedAt) {
        steps.push({
          step: 'HOLD_REQUESTED',
          label: '보증금 보류 신청',
          actor: 'host',
          occurredAt: toKSTString(reservation.holdRequestedAt),
          holdReason: reservation.deductionReason || null
        });
      }

      // 3) 관리자 보류 승인
      if (reservation.holdApprovedAt) {
        steps.push({
          step: 'HOLD_APPROVED',
          label: '보증금 보류 승인',
          actor: 'admin',
          occurredAt: reservation.holdApprovedAt,
          agreementDeadline: toKSTString(new Date(new Date(reservation.holdApprovedAt).getTime() + 10 * 24 * 60 * 60 * 1000))
        });
      }

      // 4) 호스트 합의 내용 제출
      if (da?.submittedAt) {
        steps.push({
          step: 'AGREEMENT_SUBMITTED',
          label: '합의 내용 제출',
          actor: 'host',
          occurredAt: toKSTString(da.submittedAt),
          deductAmount: da.deductAmount,
          agreementText: da.agreementText
        });
      }

      // 5a) 게스트 합의 동의
      if (da?.acceptedAt) {
        steps.push({
          step: 'AGREEMENT_ACCEPTED',
          label: '합의 동의',
          actor: 'guest',
          occurredAt: toKSTString(da.acceptedAt),
          deductAmount: da.deductAmount
        });
      }

      // 5b) 데드라인 초과 자동 전액 반환
      if (da?.status === 'AUTO_RETURNED') {
        steps.push({
          step: 'AUTO_RETURNED',
          label: '합의 기한 초과 — 보증금 전액 자동 반환',
          actor: 'system',
          occurredAt: da.updatedAt
        });
      }

      // 퇴실 확인 (보류 후 합의 완료로 HOST_CONFIRMED된 경우)
      if (reservation.hostCheckedOutAt && reservation.holdRequestedAt) {
        steps.push({
          step: 'CHECKOUT_CONFIRMED',
          label: '퇴실 확인 (합의 완료)',
          actor: 'system',
          occurredAt: toKSTString(reservation.hostCheckedOutAt)
        });
      }

      steps.sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));

      checkoutTimeline = {
        currentCheckoutStatus: reservation.checkoutStatus,
        currentDepositStatus: reservation.depositStatus,
        deposit: reservation.deposit,
        refundableDeposit: reservation.refundableDeposit,
        steps
      };
    }

    return success(res, {
      reservation,
      paymentSummary: {
        totalPaidAmount: contractPaidAmount + rentalPaidTotal,
        totalRefundedAmount: contractRefundTotal + rentalRefundTotal,
        currentBalance: (contractPaidAmount + rentalPaidTotal) - (contractRefundTotal + rentalRefundTotal),
        contractPaidAmount,
        contractRefundTotal,
        rentalPaidTotal,
        rentalRefundTotal
      },
      timeline,
      checkoutTimeline
    }, '예약 상세 조회 성공');
  } catch (err) {
    console.error('예약 상세 조회 실패:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 관리자용 방 상세 정보 조회 (메모 포함)
 * GET /api/admin/properties/:roomId/management
 */
const getRoomManagementDetail = async (req, res) => {
  try {
    const { roomId } = req.params;

    // 방 정보 조회 (모든 관련 정보 포함)
    const room = await Room.findByPk(roomId, {
      include: [
        {
          model: User,
          as: 'host',
          attributes: ['id', 'name', 'nickname', 'email', 'phoneNumber']
        },
        {
          model: Contract,
          as: 'contracts',
          where: {
            status: { [Op.in]: ['PAYMENT_COMPLETED', 'IN_PROGRESS', 'APPROVED'] }
          },
          required: false,
          include: [
            {
              model: User,
              as: 'guest',
              attributes: ['id', 'name', 'nickname', 'phoneNumber']
            }
          ],
          order: [['check_in_date', 'DESC']]
        },
        {
          model: RoomMemo,
          as: 'memos',
          include: [
            {
              model: Admin,
              as: 'admin',
              attributes: ['id', 'name']
            }
          ],
          order: [['created_at', 'DESC']]
        }
      ]
    });

    if (!room) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    // 응답 데이터 구조화
    const responseData = {
      roomInfo: {
        id: room.id,
        roomName: room.roomName,
        status: room.status,
        entrancePassword: room.entrancePassword,
        address: room.address,
        detailAddress: room.detailAddress,
        dailyRent: room.dailyRent,
        checkInTime: room.checkInTime,
        checkOutTime: room.checkOutTime,
        createdAt: room.createdAt,
        updatedAt: room.updatedAt
      },
      hostInfo: {
        id: room.host.id,
        name: room.host.name,
        email: room.host.email,
        phoneNumber: room.host.phoneNumber
      },
      contracts: room.contracts.map(contract => ({
        id: contract.id,
        guestName: contract.guest.name,
        guestPhone: contract.guest.phoneNumber,
        checkInDate: toKSTString(contract.checkInDate),
        checkOutDate: toKSTString(contract.checkOutDate),
        status: contract.status,
        totalAmount: contract.totalAmount,
        createdAt: contract.createdAt
      })),
      memos: room.memos.map(memo => ({
        id: memo.id,
        content: memo.content,
        createdBy: memo.admin.name,
        createdAt: memo.createdAt,
        updatedAt: memo.updatedAt
      }))
    };

    return success(res, responseData, '방 상세 정보 조회 완료');
  } catch (err) {
    console.error('방 상세 정보 조회 실패:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 방 상태 변경 (게시중 <-> 비게시)
 * PATCH /api/admin/properties/:roomId/status
 */
const updateRoomStatus = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { status, reason } = req.body;
    const adminId = req.admin.id;

    // IP 주소 및 User-Agent 추출
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent');

    // 허용된 상태값 검증
    const allowedStatuses = ['published', 'hidden_by_admin'];
    if (!allowedStatuses.includes(status)) {
      return error(res, {
        code: 4001,
        message: `허용되지 않은 상태값입니다. (허용: ${allowedStatuses.join(', ')})`
      }, 400);
    }

    const room = await Room.findByPk(roomId);

    if (!room) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    // 현재 상태와 동일한지 확인
    if (room.status === status) {
      return error(res, {
        code: 4002,
        message: '이미 해당 상태입니다.'
      }, 400);
    }

    // 트랜잭션 시작
    const transaction = await sequelize.transaction();

    try {
      // 상태 변경
      const previousStatus = room.status;
      room.status = status;
      await room.save({ transaction });

      // 상태 변경 이력 저장
      await RoomStatusHistory.create({
        roomId,
        adminId,
        previousStatus,
        newStatus: status,
        reason: reason || null,
        ipAddress,
        userAgent,
        changedAt: new Date()
      }, { transaction });

      await transaction.commit();

      // 캐시 무효화
      await invalidateRoomCache();

      return success(res, {
        roomId: room.id,
        previousStatus,
        newStatus: status,
        reason: reason || null
      }, '방 상태 변경 완료');
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (err) {
    console.error('방 상태 변경 실패:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 방 비밀번호 변경 (이력 저장 포함)
 * PATCH /api/admin/properties/:roomId/password
 */
const updateRoomPassword = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { newPassword, reason } = req.body;
    const adminId = req.admin.id; // authenticateAdmin 미들웨어에서 설정

    // 비밀번호 필수 검증
    if (!newPassword || newPassword.trim() === '') {
      return error(res, {
        code: 4003,
        message: '새 비밀번호를 입력해주세요.'
      }, 400);
    }

    // 길이 제한만 검증 (특수문자 허용: *1234#, #9876* 등)
    if (newPassword.length < 4 || newPassword.length > 50) {
      return error(res, {
        code: 4004,
        message: '비밀번호는 4~50자 이내로 입력해주세요.'
      }, 400);
    }

    const room = await Room.findByPk(roomId);

    if (!room) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    const previousPassword = room.entrancePassword;

    // 트랜잭션으로 비밀번호 변경 + 이력 저장
    const transaction = await sequelize.transaction();

    try {
      // 1. 방 비밀번호 변경
      room.entrancePassword = newPassword.trim();
      await room.save({ transaction });

      // 2. 변경 이력 저장
      const ipAddress = req.ip || req.connection.remoteAddress;
      const userAgent = req.get('user-agent');

      await RoomPasswordHistory.create({
        roomId,
        adminId,
        previousPassword,
        newPassword: newPassword.trim(),
        reason: reason || null,
        ipAddress,
        userAgent,
        changedAt: new Date()
      }, { transaction });

      await transaction.commit();

      return success(res, {
        roomId: room.id,
        previousPassword,
        newPassword: newPassword.trim(),
        changedAt: new Date(),
        reason: reason || null
      }, '방 비밀번호 변경 완료');
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (err) {
    console.error('방 비밀번호 변경 실패:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 메모 생성
 * POST /api/admin/properties/:roomId/memos
 */
const createRoomMemo = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { content } = req.body;
    const adminId = req.admin.id; // authenticateAdmin 미들웨어에서 설정

    // 내용 필수 검증
    if (!content || content.trim() === '') {
      return error(res, {
        code: 4005,
        message: '메모 내용을 입력해주세요.'
      }, 400);
    }

    // 방 존재 여부 확인
    const room = await Room.findByPk(roomId);
    if (!room) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    // 메모 생성
    const memo = await RoomMemo.create({
      roomId,
      adminId,
      content: content.trim()
    });

    // 작성자 정보 포함하여 조회
    const memoWithAdmin = await RoomMemo.findByPk(memo.id, {
      include: [
        {
          model: Admin,
          as: 'admin',
          attributes: ['id', 'name']
        }
      ]
    });

    return success(res, {
      id: memoWithAdmin.id,
      content: memoWithAdmin.content,
      createdBy: memoWithAdmin.admin.name,
      createdAt: memoWithAdmin.createdAt
    }, '메모 생성 완료', 201);
  } catch (err) {
    console.error('메모 생성 실패:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 메모 수정
 * PATCH /api/admin/properties/:roomId/memos/:memoId
 */
const updateRoomMemo = async (req, res) => {
  try {
    const { roomId, memoId } = req.params;
    const { content } = req.body;

    // 내용 필수 검증
    if (!content || content.trim() === '') {
      return error(res, {
        code: 4005,
        message: '메모 내용을 입력해주세요.'
      }, 400);
    }

    // 메모 존재 여부 및 방 일치 확인
    const memo = await RoomMemo.findOne({
      where: { id: memoId, roomId }
    });

    if (!memo) {
      return error(res, {
        code: 4006,
        message: '해당 메모를 찾을 수 없습니다.'
      }, 404);
    }

    // 메모 수정
    memo.content = content.trim();
    await memo.save();

    // 작성자 정보 포함하여 조회
    const memoWithAdmin = await RoomMemo.findByPk(memo.id, {
      include: [
        {
          model: Admin,
          as: 'admin',
          attributes: ['id', 'name']
        }
      ]
    });

    return success(res, {
      id: memoWithAdmin.id,
      content: memoWithAdmin.content,
      createdBy: memoWithAdmin.admin.name,
      updatedAt: memoWithAdmin.updatedAt
    }, '메모 수정 완료');
  } catch (err) {
    console.error('메모 수정 실패:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 메모 삭제
 * DELETE /api/admin/properties/:roomId/memos/:memoId
 */
const deleteRoomMemo = async (req, res) => {
  try {
    const { roomId, memoId } = req.params;

    // 메모 존재 여부 및 방 일치 확인
    const memo = await RoomMemo.findOne({
      where: { id: memoId, roomId }
    });

    if (!memo) {
      return error(res, {
        code: 4006,
        message: '해당 메모를 찾을 수 없습니다.'
      }, 404);
    }

    await memo.destroy();

    return success(res, { id: memoId }, '메모 삭제 완료');
  } catch (err) {
    console.error('메모 삭제 실패:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 비밀번호 변경 이력 조회
 * GET /api/admin/properties/:roomId/password-history
 */
const getRoomPasswordHistory = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { limit = 10, offset = 0 } = req.query;

    // 방 존재 여부 확인
    const room = await Room.findByPk(roomId);
    if (!room) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    // 비밀번호 변경 이력 조회 (최신순)
    const { count, rows: histories } = await RoomPasswordHistory.findAndCountAll({
      where: { roomId },
      include: [
        {
          model: Admin,
          as: 'admin',
          attributes: ['id', 'name']
        }
      ],
      order: [['changed_at', 'DESC']],
      limit: Math.min(parseInt(limit) || 10, 50),
      offset: parseInt(offset) || 0
    });

    // 응답 데이터 가공 (보안상 IP/UserAgent는 super_admin만 볼 수 있도록)
    const isSuperAdmin = req.admin.role === 'super_admin';

    const responseData = histories.map(history => ({
      id: history.id,
      previousPassword: history.previousPassword,
      newPassword: history.newPassword,
      reason: history.reason,
      changedBy: history.admin.name,
      changedAt: history.changedAt,
      ...(isSuperAdmin && {
        ipAddress: history.ipAddress,
        userAgent: history.userAgent
      })
    }));

    return success(res, {
      total: count,
      histories: responseData,
      pagination: {
        limit: parseInt(limit) || 10,
        offset: parseInt(offset) || 0,
        hasMore: count > (parseInt(offset) || 0) + responseData.length
      }
    }, '비밀번호 변경 이력 조회 완료');
  } catch (err) {
    console.error('비밀번호 변경 이력 조회 실패:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 방 상태 변경 이력 조회 (보안 감사용)
 * GET /api/admin/properties/:roomId/status-history
 */
const getRoomStatusHistory = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { limit, offset } = req.query;

    // 방 존재 여부 확인
    const room = await Room.findByPk(roomId);
    if (!room) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    // 상태 변경 이력 조회
    const { count, rows: histories } = await RoomStatusHistory.findAndCountAll({
      where: { roomId },
      include: [
        {
          model: Admin,
          as: 'admin',
          attributes: ['id', 'name']
        }
      ],
      order: [['changedAt', 'DESC']],
      limit: Math.min(parseInt(limit) || 20, 50),
      offset: parseInt(offset) || 0
    });

    // 응답 데이터 가공 (보안상 IP/UserAgent는 super_admin만 볼 수 있도록)
    const isSuperAdmin = req.admin.role === 'super_admin';

    const responseData = histories.map(history => ({
      id: history.id,
      previousStatus: history.previousStatus,
      newStatus: history.newStatus,
      reason: history.reason,
      changedBy: history.admin.name,
      changedAt: history.changedAt,
      ...(isSuperAdmin && {
        ipAddress: history.ipAddress,
        userAgent: history.userAgent
      })
    }));

    return success(res, {
      total: count,
      histories: responseData,
      pagination: {
        limit: parseInt(limit) || 20,
        offset: parseInt(offset) || 0,
        hasMore: count > (parseInt(offset) || 0) + responseData.length
      }
    }, '상태 변경 이력 조회 완료');
  } catch (err) {
    console.error('상태 변경 이력 조회 실패:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 모든 환불 요청 목록 조회 (관리자)
 * GET /api/admin/refunds
 */
const getRefunds = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;

    const whereClause = {};
    if (status) {
      whereClause.refundStatus = status;
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { count, rows: refunds } = await Refund.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: Contract,
          as: 'contract',
          attributes: ['id', 'roomId', 'hostId', 'guestId', 'checkInDate', 'checkOutDate'],
          include: [
            {
              model: Room,
              as: 'room',
              attributes: ['id', 'roomName', 'address']
            },
            {
              model: User,
              as: 'guest',
              attributes: ['id', 'name', 'nickname', 'phoneNumber', 'email']
            }
          ]
        }
      ],
      order: [['requestedAt', 'DESC']],
      limit: parseInt(limit),
      offset
    });

    return success(
      res,
      {
        total: count,
        refunds: refunds.map(refund => ({
          id: refund.id,
          refundStatus: refund.refundStatus,

          // 계약 정보
          contract: {
            id: refund.contract.id,
            checkInDate: toKSTString(refund.contract.checkInDate),
            checkOutDate: toKSTString(refund.contract.checkOutDate),
            room: {
              id: refund.contract.room.id,
              roomName: refund.contract.room.roomName,
              address: refund.contract.room.address
            },
            guest: {
              id: refund.contract.guest.id,
              name: refund.contract.guest.name,
              phoneNumber: refund.contract.guest.phoneNumber,
              email: refund.contract.guest.email
            }
          },

          // 환불 계산 정보
          policyTypeUsed: refund.policyTypeUsed,
          daysBeforeCheckin: refund.daysBeforeCheckin,
          isSameDayCancellation: refund.isSameDayCancellation,

          // 환불 금액
          totalRefundAmount: refund.totalRefundAmount,
          finalRefundAmount: refund.finalRefundAmount,

          // 환불 방법
          refundMethod: refund.refundMethod,

          // 사유
          cancellationReason: refund.cancellationReason,

          // 타임스탬프
          requestedAt: toKSTString(refund.requestedAt),
          approvedAt: refund.approvedAt ? toKSTString(refund.approvedAt) : null,
          rejectedAt: refund.rejectedAt ? toKSTString(refund.rejectedAt) : null,
          completedAt: refund.completedAt
        })),
        pagination: {
          currentPage: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(count / parseInt(limit)),
          hasMore: offset + refunds.length < count
        }
      },
      '환불 요청 목록을 조회했습니다.'
    );
  } catch (err) {
    console.error('환불 목록 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 환불 상세 조회 (관리자)
 * GET /api/admin/refunds/:refundId
 */
const getRefundDetail = async (req, res) => {
  try {
    const { refundId } = req.params;

    const refund = await Refund.findByPk(refundId, {
      include: [
        {
          model: Contract,
          as: 'contract',
          include: [
            {
              model: Room,
              as: 'room',
              attributes: ['id', 'roomName', 'address', 'refundPolicy']
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
        }
      ]
    });

    if (!refund) {
      return error(res, { code: 3006, message: '환불 요청을 찾을 수 없습니다' }, 404);
    }

    return success(
      res,
      {
        refund: {
          id: refund.id,
          refundStatus: refund.refundStatus,

          // 계약 정보
          contract: {
            id: refund.contract.id,
            checkInDate: toKSTString(refund.contract.checkInDate),
            checkOutDate: toKSTString(refund.contract.checkOutDate),
            totalDays: refund.contract.totalDays,
            room: refund.contract.room,
            host: refund.contract.host,
            guest: refund.contract.guest
          },

          // 환불 계산 정보
          policyTypeUsed: refund.policyTypeUsed,
          cancellationDate: refund.cancellationDate ? toKSTString(refund.cancellationDate) : null,
          checkInDate: toKSTString(refund.checkInDate),
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

          // 수수료 및 공제액
          platformFeeDeducted: refund.platformFeeDeducted,
          penaltyAmount: refund.penaltyAmount,
          finalRefundAmount: refund.finalRefundAmount,

          // 환불 방법
          refundMethod: refund.refundMethod,
          refundAccountInfo: refund.refundAccountInfo,

          // 사유 및 메시지
          cancellationReason: refund.cancellationReason,
          rejectionReason: refund.rejectionReason,
          adminNotes: refund.adminNotes,

          // 타임스탬프
          requestedAt: toKSTString(refund.requestedAt),
          approvedAt: refund.approvedAt ? toKSTString(refund.approvedAt) : null,
          rejectedAt: refund.rejectedAt ? toKSTString(refund.rejectedAt) : null,
          completedAt: refund.completedAt,
          createdAt: refund.createdAt,
          updatedAt: refund.updatedAt
        }
      },
      '환불 요청 상세를 조회했습니다.'
    );
  } catch (err) {
    console.error('환불 상세 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 환불 승인 (관리자)
 * PATCH /api/admin/refunds/:refundId/approve
 */
const approveRefund = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { refundId } = req.params;
    const { admin_notes } = req.body;
    const adminId = req.admin.id;

    // 환불 요청 조회
    const refund = await Refund.findByPk(refundId, { transaction });

    if (!refund) {
      await transaction.rollback();
      return error(res, { code: 3006, message: '환불 요청을 찾을 수 없습니다' }, 404);
    }

    // 승인 가능한 상태인지 확인
    if (refund.refundStatus !== 'REQUESTED') {
      await transaction.rollback();
      return error(
        res,
        {
          code: 4503,
          message: '요청 상태의 환불만 승인할 수 있습니다',
          currentStatus: refund.refundStatus
        },
        400
      );
    }

    if (refund.finalRefundAmount > 0) {
      const payment = await Payment.findOne({
        where: {
          contractId: refund.contractId,
          status: { [Op.in]: ['DONE', 'PARTIAL_CANCELED'] }
        },
        transaction
      });

      if (payment) {
        const { orderno, orgpaydate, orgtranamt } = paytagClient.extractCancelParams(payment);
        const cancelamt = refund.finalRefundAmount;
        const newBalance = payment.balanceAmount - cancelamt;
        const canceltype = newBalance === 0 ? '0' : '1';

        // DB 업데이트 먼저
        await payment.update({
          balanceAmount: newBalance,
          status: newBalance === 0 ? 'CANCELED' : 'PARTIAL_CANCELED'
        }, { transaction });

        await refund.update({
          refundStatus: 'COMPLETED',
          adminNotes: admin_notes || null,
          approvedAt: new Date(),
          completedAt: new Date()
        }, { transaction });

        // PG 취소 — 실패 시 transaction rollback으로 DB 원복
        try {
          await paytagClient.cancelPayment({ orderno, orgpaydate, orgtranamt, cancelamt, canceltype });
        } catch (pgErr) {
          await transaction.rollback();
          console.error('[approveRefund] PayTag 취소 실패:', pgErr.message);
          return error(res, {
            code: 4900,
            message: `PG 취소 실패: ${pgErr.paytagErrorMessage || pgErr.message}`,
            pgErrorCode: pgErr.paytagErrorCode
          }, 502);
        }

        console.log(`[approveRefund] PayTag 취소 완료: refundId=${refund.id}, cancelamt=${cancelamt}`);
      }
    } else {
      // 환불금액 0인 경우 PG 없이 바로 COMPLETED
      await refund.update({
        refundStatus: 'COMPLETED',
        adminNotes: admin_notes || null,
        approvedAt: new Date(),
        completedAt: new Date()
      }, { transaction });
    }

    // 계약 취소 확정 시 기존 CONTRACT_SETTLEMENT Payout/Settlement 취소
    await Payout.update(
      { status: 'CANCELLED', note: '계약 취소 승인으로 인한 자동 취소' },
      { where: { contractId: refund.contractId, payoutType: 'CONTRACT_SETTLEMENT', status: { [Op.in]: ['PENDING', 'PAYABLE'] } }, transaction }
    );
    await Settlement.update(
      { status: 'ON_HOLD', note: '계약 취소 승인으로 인한 정산 보류' },
      { where: { contractId: refund.contractId, status: 'PENDING' }, transaction }
    );

    await transaction.commit();

    // 채팅 쓰기 마감 (CANCEL_REQUESTED → 관리자 환불 승인 완료 시점)
    try {
      const { ChatRoom } = require('../models');
      const chatRoom = await ChatRoom.findOne({ where: { contractId: refund.contractId } });
      if (chatRoom && chatRoom.firebaseChatRoomId) {
        setChatWritableUntil(chatRoom.firebaseChatRoomId, new Date()).catch(err => {
          console.error('approveRefund 채팅 쓰기 마감 설정 실패 (무시됨):', err);
        });
      }
    } catch (chatErr) {
      console.error('approveRefund 채팅방 조회 실패 (무시됨):', chatErr);
    }

    return updated(
      res,
      {
        refundId: refund.id,
        refundStatus: 'COMPLETED',
        approvedAt: refund.approvedAt,
        completedAt: refund.completedAt,
        finalRefundAmount: refund.finalRefundAmount
      },
      '환불이 승인되어 PG 취소가 완료되었습니다.'
    );
  } catch (err) {
    await transaction.rollback();
    console.error('환불 승인 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 환불 거절 (관리자)
 * PATCH /api/admin/refunds/:refundId/reject
 */
const rejectRefund = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { refundId } = req.params;
    const { rejection_reason, admin_notes } = req.body;
    const adminId = req.admin.id;

    // 거절 사유 확인
    if (!rejection_reason || rejection_reason.trim() === '') {
      await transaction.rollback();
      return error(
        res,
        { code: 4504, message: '거절 사유를 입력해주세요' },
        400
      );
    }

    // 환불 요청 조회
    const refund = await Refund.findByPk(refundId, { transaction });

    if (!refund) {
      await transaction.rollback();
      return error(res, { code: 3006, message: '환불 요청을 찾을 수 없습니다' }, 404);
    }

    // 거절 가능한 상태인지 확인
    if (refund.refundStatus !== 'REQUESTED') {
      await transaction.rollback();
      return error(
        res,
        {
          code: 4505,
          message: '요청 상태의 환불만 거절할 수 있습니다',
          currentStatus: refund.refundStatus
        },
        400
      );
    }

    // 환불 거절 처리
    await refund.update(
      {
        refundStatus: 'REJECTED',
        rejectionReason: rejection_reason,
        adminNotes: admin_notes || null,
        rejectedAt: new Date()
      },
      { transaction }
    );

    // 계약 상태 복원 (환불 요청 전 상태로)
    const contract = await Contract.findByPk(refund.contractId, { transaction });
    if (contract) {
      // ContractStatusLog에서 CANCEL_REQUESTED로 변경되기 전 상태 조회
      let restoreStatus = 'PAYMENT_COMPLETED'; // 기본값
      const statusLog = await ContractStatusLog.findOne({
        where: {
          contractId: contract.id,
          toStatus: 'CANCEL_REQUESTED'
        },
        order: [['createdAt', 'DESC']],
        transaction
      });

      if (statusLog) {
        restoreStatus = statusLog.fromStatus;
      }

      await contract.update({
        status: restoreStatus
      }, { transaction });
    }

    await transaction.commit();

    return updated(
      res,
      {
        refundId: refund.id,
        refundStatus: refund.refundStatus,
        rejectionReason: refund.rejectionReason,
        rejectedAt: refund.rejectedAt
      },
      '환불 요청이 거절되었습니다.'
    );
  } catch (err) {
    await transaction.rollback();
    console.error('환불 거절 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 렌탈 주문 목록 조회 (관리자)
 * GET /api/admin/rental-orders
 */
const getRentalOrders = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      deliveryStatus,
      orderType,
      contractId,
      startDate,
      endDate
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // 검색 조건 구성
    const where = {};

    if (status) {
      where.status = status;
    }

    if (deliveryStatus) {
      where.deliveryStatus = deliveryStatus;
    }

    if (orderType) {
      where.orderType = orderType;
    }

    if (contractId) {
      where.contractId = parseInt(contractId);
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt[Op.gte] = new Date(startDate + 'T00:00:00');
      }
      if (endDate) {
        where.createdAt[Op.lte] = new Date(endDate + 'T23:59:59');
      }
    }

    const { count, rows: orders } = await RentalOrder.findAndCountAll({
      where,
      include: [
        {
          model: Contract,
          as: 'contract',
          attributes: ['id', 'orderId', 'status', 'checkInDate', 'checkOutDate'],
          include: [
            {
              model: User,
              as: 'guest',
              attributes: ['id', 'name', 'nickname', 'email']
            },
            {
              model: Room,
              as: 'room',
              attributes: ['id', 'roomName']
            }
          ]
        },
        {
          model: RentalOrderItem,
          as: 'items',
          include: [{
            model: RentalItem,
            as: 'rentalItem',
            attributes: ['id', 'name']
          }]
        }
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset
    });

    return success(res, {
      orders: orders.map(order => ({
        id: order.id,
        orderId: order.orderId,
        orderType: order.orderType,
        status: order.status,
        deliveryStatus: order.deliveryStatus,
        deliveryStatusLabel: RentalOrder.DELIVERY_STATUS_LABELS[order.deliveryStatus],
        deliveredAt: order.deliveredAt ? toKSTString(order.deliveredAt) : null,
        totalAmount: parseFloat(order.totalAmount),
        refundedAmount: parseFloat(order.refundedAmount || 0),
        modifiableUntil: order.modifiableUntil ? toKSTString(order.modifiableUntil) : null,
        paidAt: order.paidAt,
        createdAt: order.createdAt,
        contract: order.contract ? {
          id: order.contract.id,
          orderId: order.contract.orderId,
          status: order.contract.status,
          checkInDate: toKSTString(order.contract.checkInDate),
          checkOutDate: toKSTString(order.contract.checkOutDate),
          guest: order.contract.guest,
          room: order.contract.room
        } : null,
        items: order.items?.map(item => ({
          id: item.id,
          name: item.rentalItem?.name,
          quantity: item.quantity,
          pricePerItem: parseFloat(item.pricePerItem),
          totalPrice: parseFloat(item.totalPrice),
          status: item.status
        })) || []
      })),
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / parseInt(limit))
      }
    }, '렌탈 주문 목록을 조회했습니다.');
  } catch (err) {
    console.error('렌탈 주문 목록 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 렌탈 주문 상세 조회 (관리자)
 * GET /api/admin/rental-orders/:rentalOrderId
 */
const getRentalOrderDetail = async (req, res) => {
  try {
    const { rentalOrderId } = req.params;

    const order = await RentalOrder.findOne({
      where: { orderId: rentalOrderId },
      include: [
        {
          model: Contract,
          as: 'contract',
          attributes: ['id', 'orderId', 'status', 'checkInDate', 'checkOutDate', 'guestId', 'hostId'],
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
            }
          ]
        },
        {
          model: RentalOrderItem,
          as: 'items',
          include: [{
            model: RentalItem,
            as: 'rentalItem',
            attributes: ['id', 'name', 'itemType', 'price']
          }]
        }
      ]
    });

    if (!order) {
      return error(res, ErrorCodes.RENTAL_ORDER_NOT_FOUND, 404);
    }

    // 변경 이력 조회
    const logs = await RentalOrderLog.findAll({
      where: { rentalOrderId: order.id },
      order: [['createdAt', 'DESC']],
      limit: 50
    });

    return success(res, {
      order: {
        id: order.id,
        orderId: order.orderId,
        orderType: order.orderType,
        status: order.status,
        deliveryStatus: order.deliveryStatus,
        deliveryStatusLabel: RentalOrder.DELIVERY_STATUS_LABELS[order.deliveryStatus],
        deliveredAt: order.deliveredAt ? toKSTString(order.deliveredAt) : null,
        totalAmount: parseFloat(order.totalAmount),
        refundedAmount: parseFloat(order.refundedAmount || 0),
        modifiableUntil: order.modifiableUntil ? toKSTString(order.modifiableUntil) : null,
        paymentKey: order.paymentKey,
        paidAt: order.paidAt,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        contract: order.contract ? {
          id: order.contract.id,
          orderId: order.contract.orderId,
          status: order.contract.status,
          checkInDate: toKSTString(order.contract.checkInDate),
          checkOutDate: toKSTString(order.contract.checkOutDate),
          guest: order.contract.guest,
          host: order.contract.host,
          room: order.contract.room
        } : null,
        items: order.items?.map(item => ({
          id: item.id,
          rentalItemId: item.rentalItemId,
          name: item.rentalItem?.name,
          itemType: item.rentalItem?.itemType,
          quantity: item.quantity,
          pricePerItem: parseFloat(item.pricePerItem),
          totalPrice: parseFloat(item.totalPrice),
          status: item.status,
          cancelledAt: item.cancelledAt,
          cancelReason: item.cancelReason,
          refundAmount: item.refundAmount ? parseFloat(item.refundAmount) : null
        })) || []
      },
      logs: logs.map(log => ({
        id: log.id,
        action: log.action,
        actionLabel: RentalOrderLog.ACTION_LABELS[log.action],
        description: log.description,
        metadata: log.metadata,
        createdAt: log.createdAt
      }))
    }, '렌탈 주문 상세를 조회했습니다.');
  } catch (err) {
    console.error('렌탈 주문 상세 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 계약별 렌탈 이력 조회 (관리자)
 * GET /api/admin/contracts/:contractId/rental-history
 */
const getContractRentalHistory = async (req, res) => {
  try {
    const { contractId } = req.params;

    // 계약 확인
    const contract = await Contract.findByPk(contractId, {
      attributes: ['id', 'orderId', 'status', 'checkInDate', 'checkOutDate'],
      include: [
        {
          model: User,
          as: 'guest',
          attributes: ['id', 'name', 'nickname']
        },
        {
          model: Room,
          as: 'room',
          attributes: ['id', 'roomName']
        }
      ]
    });

    if (!contract) {
      return error(res, ErrorCodes.CONTRACT_NOT_FOUND, 404);
    }

    // 해당 계약의 모든 렌탈 주문 조회
    const orders = await RentalOrder.findAll({
      where: { contractId },
      include: [{
        model: RentalOrderItem,
        as: 'items',
        include: [{
          model: RentalItem,
          as: 'rentalItem',
          attributes: ['id', 'name']
        }]
      }],
      order: [['createdAt', 'ASC']]
    });

    // 해당 계약의 모든 렌탈 로그 조회 (타임라인용)
    const orderIds = orders.map(o => o.id);
    const logs = await RentalOrderLog.findAll({
      where: { rentalOrderId: { [Op.in]: orderIds } },
      order: [['createdAt', 'ASC']]
    });

    // 요약 통계
    const summary = {
      totalOrders: orders.length,
      totalPaid: orders
        .filter(o => o.status === 'PAID' || o.status === 'PARTIAL_REFUND')
        .reduce((sum, o) => sum + parseFloat(o.totalAmount), 0),
      totalRefunded: orders.reduce((sum, o) => sum + parseFloat(o.refundedAmount || 0), 0),
      activeItems: orders.flatMap(o => o.items || []).filter(i => i.status === 'ACTIVE').length,
      cancelledItems: orders.flatMap(o => o.items || []).filter(i => i.status === 'CANCELLED').length
    };

    return success(res, {
      contract: {
        id: contract.id,
        orderId: contract.orderId,
        status: contract.status,
        checkInDate: toKSTString(contract.checkInDate),
        checkOutDate: toKSTString(contract.checkOutDate),
        guest: contract.guest,
        room: contract.room
      },
      summary,
      orders: orders.map(order => ({
        id: order.id,
        orderId: order.orderId,
        orderType: order.orderType,
        status: order.status,
        totalAmount: parseFloat(order.totalAmount),
        refundedAmount: parseFloat(order.refundedAmount || 0),
        paidAt: order.paidAt,
        createdAt: order.createdAt,
        items: order.items?.map(item => ({
          id: item.id,
          name: item.rentalItem?.name,
          quantity: item.quantity,
          totalPrice: parseFloat(item.totalPrice),
          status: item.status,
          cancelledAt: item.cancelledAt
        })) || []
      })),
      timeline: logs.map(log => ({
        id: log.id,
        rentalOrderId: log.rentalOrderId,
        action: log.action,
        actionLabel: RentalOrderLog.ACTION_LABELS[log.action],
        description: log.description,
        metadata: log.metadata,
        createdAt: log.createdAt
      }))
    }, '계약 렌탈 이력을 조회했습니다.');
  } catch (err) {
    console.error('계약 렌탈 이력 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * [DEPRECATED] 관리자 렌탈 주문 전체 취소
 * POST /api/admin/rental-orders/:rentalOrderId/cancel
 * → POST /api/admin/rental-payments/:rentalOrderId/refund 으로 대체됨
 */
/* DEPRECATED_START: adminCancelRentalOrder
const adminCancelRentalOrder = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { rentalOrderId } = req.params;
    const { reason, refundAmount } = req.body;
    const adminId = req.admin.id;

    if (!reason) {
      await transaction.rollback();
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400, { field: 'reason' });
    }

    // 렌탈 주문 조회
    const order = await RentalOrder.findOne({
      where: { rentalOrderId },
      transaction
    });

    if (!order) {
      await transaction.rollback();
      return error(res, ErrorCodes.RENTAL_ORDER_NOT_FOUND, 404);
    }

    // 이미 전체 환불된 주문인지 확인
    if (order.status === 'FULLY_REFUNDED') {
      await transaction.rollback();
      return error(res, ErrorCodes.RENTAL_ORDER_ALREADY_CANCELLED, 400);
    }

    // 활성 아이템 조회
    const activeItems = await RentalOrderItem.findAll({
      where: {
        rentalOrderId: order.id,
        status: { [require('sequelize').Op.ne]: 'CANCELLED' }
      },
      include: [{
        model: RentalItem,
        as: 'rentalItem',
        attributes: ['id', 'name']
      }],
      transaction
    });

    if (activeItems.length === 0) {
      await transaction.rollback();
      return error(res, ErrorCodes.RENTAL_ORDER_ALREADY_CANCELLED, 400);
    }

    // 환불 금액 결정 (지정되지 않으면 활성 아이템 전체 금액)
    const orderTotal = activeItems.reduce((sum, item) => sum + parseFloat(item.totalPrice), 0);
    const finalRefundAmount = refundAmount !== undefined
      ? parseFloat(refundAmount)
      : orderTotal;

    // 전체 아이템 취소 처리
    const cancelledItemNames = [];
    for (const item of activeItems) {
      await item.update({
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: `[관리자] ${reason}`,
        refundAmount: parseFloat(item.totalPrice)
      }, { transaction });
      cancelledItemNames.push(`${item.rentalItem?.name || '알 수 없음'} x${item.quantity}`);
    }

    // 주문 상태 업데이트
    await order.update({
      refundedAmount: parseFloat(order.refundedAmount || 0) + finalRefundAmount,
      status: 'FULLY_REFUNDED'
    }, { transaction });

    // 전체 예약 상태 업데이트
    await require('../models').RentalItemReservation.update(
      { status: 'CANCELLED' },
      {
        where: { rentalOrderId: order.id },
        transaction
      }
    );

    // 로그 기록
    await RentalOrderLog.createLog({
      rentalOrderId: order.id,
      action: 'ADMIN_ORDER_CANCELLED',
      description: `관리자가 주문 전체를 취소했습니다: ${cancelledItemNames.join(', ')}`,
      metadata: {
        cancelledItems: activeItems.map(item => ({
          id: item.id,
          name: item.rentalItem?.name,
          quantity: item.quantity,
          price: parseFloat(item.totalPrice)
        })),
        refundAmount: finalRefundAmount,
        adminId,
        reason
      },
      transaction
    });

    // PG 실제 취소 처리
    if (finalRefundAmount > 0) {
      const rentalPayment = await RentalPayment.findOne({
        where: {
          rentalOrderId: order.id,
          status: { [Op.in]: ['DONE', 'PARTIAL_CANCELED'] }
        },
        transaction
      });

      if (rentalPayment) {
        const { orderno, orgpaydate, orgtranamt } = paytagClient.extractCancelParams(rentalPayment);
        const newBalance = rentalPayment.balanceAmount - finalRefundAmount;
        const canceltype = newBalance === 0 ? '0' : '1';

        // DB 업데이트 먼저
        await rentalPayment.update({
          balanceAmount: newBalance,
          status: newBalance === 0 ? 'CANCELED' : 'PARTIAL_CANCELED'
        }, { transaction });

        // PG 취소 — 실패 시 transaction rollback으로 DB 원복
        try {
          await paytagClient.cancelPayment({ orderno, orgpaydate, orgtranamt, cancelamt: finalRefundAmount, canceltype });
        } catch (pgErr) {
          await transaction.rollback();
          console.error('[adminCancelRentalOrder] PayTag 취소 실패:', pgErr.message);
          return error(res, {
            code: 4900,
            message: `PG 취소 실패: ${pgErr.paytagErrorMessage || pgErr.message}`,
            pgErrorCode: pgErr.paytagErrorCode
          }, 502);
        }

        console.log(`[adminCancelRentalOrder] PayTag 취소 완료: orderId=${order.orderId}, cancelamt=${finalRefundAmount}`);
      }
    }

    await transaction.commit();

    return updated(res, {
      orderId: order.orderId,
      cancelledItems: activeItems.map(item => ({
        id: item.id,
        name: item.rentalItem?.name,
        quantity: item.quantity,
        status: 'CANCELLED'
      })),
      orderStatus: 'FULLY_REFUNDED',
      totalRefunded: finalRefundAmount
    }, '렌탈 주문이 전체 취소되었습니다.');
  } catch (err) {
    await transaction.rollback();
    console.error('관리자 렌탈 주문 취소 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};
DEPRECATED_END */

/**
 * 렌탈 주문 배송 상태 변경
 * PATCH /api/admin/rental-orders/:rentalOrderId/delivery-status
 */
const updateRentalOrderDeliveryStatus = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { rentalOrderId } = req.params;
    const { deliveryStatus } = req.body;
    const adminId = req.admin.id;

    // 입력 검증
    const validStatuses = ['PENDING', 'IN_TRANSIT', 'DELIVERED'];
    if (!deliveryStatus || !validStatuses.includes(deliveryStatus)) {
      await transaction.rollback();
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, {
        details: '유효한 배송 상태를 입력해주세요. (PENDING, IN_TRANSIT, DELIVERED)'
      });
    }

    // 렌탈 주문 조회
    const rentalOrder = await RentalOrder.findByPk(rentalOrderId, {
      include: [{
        model: RentalOrderItem,
        as: 'items',
        include: [{
          model: RentalItem,
          as: 'rentalItem',
          attributes: ['name']
        }]
      }],
      transaction
    });

    if (!rentalOrder) {
      await transaction.rollback();
      return error(res, ErrorCodes.RENTAL_ORDER_NOT_FOUND, 404);
    }

    // 결제 완료된 주문만 배송 상태 변경 가능
    if (!['PAID', 'PARTIAL_REFUND'].includes(rentalOrder.status)) {
      await transaction.rollback();
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, {
        details: '결제 완료된 주문만 배송 상태를 변경할 수 있습니다.'
      });
    }

    const previousStatus = rentalOrder.deliveryStatus;

    // 이미 같은 상태인 경우
    if (previousStatus === deliveryStatus) {
      await transaction.rollback();
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, {
        details: `이미 '${RentalOrder.DELIVERY_STATUS_LABELS[deliveryStatus]}' 상태입니다.`
      });
    }

    // 배송 상태 업데이트
    const updateData = {
      deliveryStatus
    };

    // 배송 완료 시 시간 기록
    if (deliveryStatus === 'DELIVERED') {
      updateData.deliveredAt = new Date();
    }

    await rentalOrder.update(updateData, { transaction });

    // 이력 로그 기록
    const actionType = deliveryStatus === 'DELIVERED' ? 'DELIVERY_COMPLETED' : 'DELIVERY_STARTED';
    await RentalOrderLog.createLog({
      contractId: rentalOrder.contractId,
      rentalOrderId: rentalOrder.id,
      action: actionType,
      actor: 'ADMIN',
      actorId: adminId,
      metadata: {
        previousStatus,
        newStatus: deliveryStatus,
        items: rentalOrder.items.map(item => ({
          name: item.rentalItem?.name,
          quantity: item.quantity
        }))
      },
      description: `배송 상태 변경: ${RentalOrder.DELIVERY_STATUS_LABELS[previousStatus]} → ${RentalOrder.DELIVERY_STATUS_LABELS[deliveryStatus]}`,
      req
    }, transaction);

    await transaction.commit();

    // 배송 완료 시 해당 계약의 BEDDING_DELIVERY 태스크 자동 COMPLETED 처리
    if (deliveryStatus === 'DELIVERED') {
      try {
        await ServiceTask.update(
          { status: 'COMPLETED' },
          {
            where: {
              contractId: rentalOrder.contractId,
              taskType: 'BEDDING_DELIVERY',
              status: { [Op.in]: ['PENDING', 'RESERVED'] }
            }
          }
        );
      } catch (taskErr) {
        console.error('배송완료 서비스 태스크 자동 완료 처리 실패 (무시됨):', taskErr);
      }
    }

    return updated(res, {
      rentalOrderId: rentalOrder.id,
      orderId: rentalOrder.orderId,
      previousDeliveryStatus: previousStatus,
      deliveryStatus: deliveryStatus,
      deliveryStatusLabel: RentalOrder.DELIVERY_STATUS_LABELS[deliveryStatus],
      deliveredAt: rentalOrder.deliveredAt
    }, `배송 상태가 '${RentalOrder.DELIVERY_STATUS_LABELS[deliveryStatus]}'(으)로 변경되었습니다.`);
  } catch (err) {
    await transaction.rollback();
    console.error('렌탈 주문 배송 상태 변경 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 관리자 강제 취소
 * POST /api/admin/reservations/:contractId/force-cancel
 *
 * 정책 3.15: 관리자는 운영 판단에 따라 계약을 강제 종료할 수 있다.
 * - 모든 활성 상태에서 가능
 * - withRefund에 따라 CANCELLED_BY_ADMIN_WITH_REFUND / CANCELLED_BY_ADMIN_NO_REFUND
 */
const adminForceCancel = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { contractId } = req.params;
    const { reason, withRefund } = req.body;
    const adminId = req.admin.id;

    if (!reason || !reason.trim()) {
      await transaction.rollback();
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400, { field: 'reason' });
    }

    const contract = await Contract.findByPk(contractId, {
      include: [
        { model: ChatRoom, as: 'chatRoom', attributes: ['firebaseChatRoomId'] }
      ],
      transaction
    });

    if (!contract) {
      await transaction.rollback();
      return error(res, ErrorCodes.CONTRACT_NOT_FOUND, 404);
    }

    // 강제 취소 가능한 활성 상태
    const cancellableStatuses = [
      'PENDING_APPROVAL', 'APPROVED', 'PAYMENT_COMPLETED',
      'IN_PROGRESS', 'CANCEL_REQUESTED'
    ];
    if (!cancellableStatuses.includes(contract.status)) {
      await transaction.rollback();
      return error(res, {
        code: 4630,
        message: '강제 취소 가능한 상태가 아닙니다.',
        currentStatus: contract.status
      }, 400);
    }

    // 취소 유형 결정
    let cancellationType;
    if (['PENDING_APPROVAL', 'APPROVED'].includes(contract.status)) {
      cancellationType = 'BEFORE_PAYMENT';
    } else if (contract.status === 'PAYMENT_COMPLETED') {
      cancellationType = 'AFTER_PAYMENT';
    } else {
      cancellationType = 'DURING_STAY';
    }

    const previousStatus = contract.status;
    const newStatus = withRefund ? 'CANCELLED_BY_ADMIN_WITH_REFUND' : 'CANCELLED_BY_ADMIN_NO_REFUND';

    await contract.update({
      status: newStatus,
      cancelledAt: new Date(),
      cancellationReason: `[관리자] ${reason}`,
      cancellationType,
      cancelledByAdminId: adminId
    }, { transaction });

    // 상태 변경 로그
    await ContractStatusLog.createLog({
      contractId: contract.id,
      fromStatus: previousStatus,
      toStatus: newStatus,
      changedBy: 'ADMIN',
      changedByUserId: adminId,
      reason: `관리자 강제 취소: ${reason}`,
      metadata: {
        type: 'ADMIN_FORCE_CANCEL',
        withRefund,
        cancellationType,
        adminId
      },
      transaction
    });

    await transaction.commit();

    // 서비스 태스크 PENDING 삭제 (트랜잭션 외부)
    try {
      const { cancelPendingServiceTasks } = require('../schedulers/contractScheduler');
      await cancelPendingServiceTasks(contract.id);
    } catch (taskErr) {
      console.error('강제 취소 서비스 태스크 삭제 실패 (무시됨):', taskErr);
    }

    // 예약된 알림 큐 전체 취소 (취소된 계약에 알림 발송 방지)
    try {
      const { cancelScheduledNotifications } = require('../queues/notificationQueue');
      await cancelScheduledNotifications(contract.id);
    } catch (queueErr) {
      console.error('[adminForceCancel] 알림 큐 취소 실패 (무시됨):', queueErr);
    }

    // 채팅 시스템 메시지 (트랜잭션 외부)
    try {
      if (contract.chatRoom && contract.chatRoom.firebaseChatRoomId) {
        const messageText = getSystemMessageTemplate(
          SystemMessageTypes.CONTRACT_FORCE_CANCELLED,
          { reason }
        );
        await sendSystemMessage(
          contract.chatRoom.firebaseChatRoomId,
          messageText,
          SystemMessageTypes.CONTRACT_FORCE_CANCELLED,
          { contractId: contract.id }
        );
        setChatWritableUntil(contract.chatRoom.firebaseChatRoomId, new Date()).catch(err => {
          console.error('강제 취소 채팅 쓰기 마감 설정 실패 (무시됨):', err);
        });
      }
    } catch (chatErr) {
      console.error('강제 취소 시스템 메시지 전송 실패 (무시됨):', chatErr);
    }

    // 알림 발송
    try {
      await NotificationService.notifyContractCanceled(contract, CANCEL_TYPES.ADMIN_CANCEL);
    } catch (notifyErr) {
      console.error('강제 취소 알림 전송 실패 (무시됨):', notifyErr);
    }

    return success(res, {
      contractId: contract.id,
      previousStatus,
      newStatus,
      withRefund,
      cancellationType,
      reason
    }, '계약이 강제 취소되었습니다.');

  } catch (err) {
    await transaction.rollback();
    console.error('관리자 강제 취소 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 호스트 취소 요청 승인
 * POST /api/admin/reservations/:contractId/approve-cancel-request
 *
 * 정책 3.14.2: 취소 요청 → 관리자가 승인하면 계약 종료 처리
 */
const approveHostCancelRequest = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { contractId } = req.params;
    const { withRefund, adminNote } = req.body;
    const adminId = req.admin.id;

    const contract = await Contract.findByPk(contractId, {
      include: [
        { model: ChatRoom, as: 'chatRoom', attributes: ['firebaseChatRoomId'] }
      ],
      transaction
    });

    if (!contract) {
      await transaction.rollback();
      return error(res, ErrorCodes.CONTRACT_NOT_FOUND, 404);
    }

    if (contract.status !== 'CANCEL_REQUESTED') {
      await transaction.rollback();
      return error(res, {
        code: 4631,
        message: '취소 요청 상태에서만 승인이 가능합니다.',
        currentStatus: contract.status
      }, 400);
    }

    // 호스트 또는 게스트 취소 요청 존재 확인 (ContractStatusLog에서)
    const cancelRequest = await ContractStatusLog.findOne({
      where: {
        contractId,
        [Op.or]: [
          { metadata: { [Op.like]: '%CANCEL_REQUEST_BY_HOST%' } },
          { metadata: { [Op.like]: '%CANCEL_REQUEST_BY_GUEST%' } }
        ]
      },
      order: [['createdAt', 'DESC']],
      transaction
    });

    if (!cancelRequest) {
      await transaction.rollback();
      return error(res, {
        code: 4632,
        message: '해당 계약에 대한 취소 요청을 찾을 수 없습니다.'
      }, 404);
    }

    const cancelRequestMetadata = JSON.parse(cancelRequest.metadata || '{}');
    const isGuestRequest = cancelRequestMetadata.type === 'CANCEL_REQUEST_BY_GUEST';
    const cancelledStatus = isGuestRequest ? 'CANCELLED_BY_GUEST' : 'CANCELLED_BY_HOST';
    const requesterLabel = isGuestRequest ? '게스트' : '호스트';

    const previousStatus = contract.status;

    await contract.update({
      status: cancelledStatus,
      cancelledAt: new Date(),
      cancellationReason: `${requesterLabel} 취소 요청 승인 (관리자: ${adminNote || '사유 없음'})`,
      cancellationType: 'DURING_STAY'
    }, { transaction });

    // TODO: 호스트 취소 위약금 중 플랫폼 귀속 금액이 있을 경우 영수증 발급 대기 목록 생성
    // const { createCancelFeeReceipt } = require('../services/receiptService');
    // await createCancelFeeReceipt({ contractId: contract.id, hostId: contract.hostId, targetType: 'HOST_CANCEL_FEE', platformFeeAmount, date: new Date().toISOString().split('T')[0] }, transaction);

    // 취소 승인 시 Payout/Settlement 보류 처리 (PG 환불 미호출 — 관리자가 별도 수동 처리)
    await Payout.update(
      { status: 'ON_HOLD', note: `${requesterLabel} 취소 승인으로 인한 지급 보류` },
      { where: { contractId: contract.id, payoutType: 'CONTRACT_SETTLEMENT', status: { [Op.in]: ['PENDING', 'PAYABLE'] } }, transaction }
    );
    await Settlement.update(
      { status: 'ON_HOLD', note: `${requesterLabel} 취소 승인으로 인한 정산 보류` },
      { where: { contractId: contract.id, status: 'PENDING' }, transaction }
    );

    const approvedMetadataType = isGuestRequest ? 'GUEST_CANCEL_REQUEST_APPROVED' : 'HOST_CANCEL_REQUEST_APPROVED';

    // 상태 변경 로그
    await ContractStatusLog.createLog({
      contractId: contract.id,
      fromStatus: previousStatus,
      toStatus: cancelledStatus,
      changedBy: 'ADMIN',
      changedByUserId: adminId,
      reason: `${requesterLabel} 취소 요청 승인: ${adminNote || ''}`,
      metadata: {
        type: approvedMetadataType,
        withRefund,
        adminId,
        adminNote,
        originalRequestLogId: cancelRequest.id
      },
      transaction
    });

    await transaction.commit();

    // 서비스 태스크 PENDING 삭제 (트랜잭션 외부)
    try {
      const { cancelPendingServiceTasks } = require('../schedulers/contractScheduler');
      await cancelPendingServiceTasks(contract.id);
    } catch (taskErr) {
      console.error('취소 승인 서비스 태스크 삭제 실패 (무시됨):', taskErr);
    }

    // 채팅 시스템 메시지
    try {
      if (contract.chatRoom && contract.chatRoom.firebaseChatRoomId) {
        const approvedMsgType = isGuestRequest
          ? SystemMessageTypes.GUEST_CANCEL_REQUEST_APPROVED
          : SystemMessageTypes.HOST_CANCEL_REQUEST_APPROVED;
        const messageText = getSystemMessageTemplate(approvedMsgType);
        await sendSystemMessage(
          contract.chatRoom.firebaseChatRoomId,
          messageText,
          approvedMsgType,
          { contractId: contract.id }
        );
      }
    } catch (chatErr) {
      console.error('취소 요청 승인 시스템 메시지 전송 실패 (무시됨):', chatErr);
    }

    // 요청자(호스트 또는 게스트) 알림
    try {
      await NotificationService.create({
        userId: isGuestRequest ? contract.guestId : contract.hostId,
        userMode: isGuestRequest ? 'guest' : 'host',
        type: 'CONTRACT',
        title: '취소 요청 승인',
        message: `${requesterLabel}님의 취소 요청이 관리자에 의해 승인되었습니다.`,
        relatedContractId: contract.id
      });
    } catch (notifyErr) {
      console.error('취소 승인 알림 전송 실패 (무시됨):', notifyErr);
    }

    // 상대방 알림
    try {
      await NotificationService.create({
        userId: isGuestRequest ? contract.hostId : contract.guestId,
        userMode: isGuestRequest ? 'host' : 'guest',
        type: 'CONTRACT',
        title: '계약 취소 안내',
        message: '관리자 승인으로 계약이 취소되었습니다. 환불 절차가 진행됩니다.',
        relatedContractId: contract.id
      });
    } catch (notifyErr) {
      console.error('취소 안내 알림 전송 실패 (무시됨):', notifyErr);
    }

    return success(res, {
      contractId: contract.id,
      previousStatus,
      newStatus: cancelledStatus,
      withRefund,
      adminNote
    }, `${requesterLabel} 취소 요청이 승인되었습니다.`);

  } catch (err) {
    await transaction.rollback();
    console.error('취소 요청 승인 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 호스트 취소 요청 거절
 * POST /api/admin/reservations/:contractId/reject-cancel-request
 */
const rejectHostCancelRequest = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { contractId } = req.params;
    const { adminNote } = req.body;
    const adminId = req.admin.id;

    const contract = await Contract.findByPk(contractId, {
      include: [
        { model: ChatRoom, as: 'chatRoom', attributes: ['firebaseChatRoomId'] }
      ],
      transaction
    });

    if (!contract) {
      await transaction.rollback();
      return error(res, ErrorCodes.CONTRACT_NOT_FOUND, 404);
    }

    if (contract.status !== 'CANCEL_REQUESTED') {
      await transaction.rollback();
      return error(res, {
        code: 4633,
        message: '취소 요청 상태에서만 거절이 가능합니다.',
        currentStatus: contract.status
      }, 400);
    }

    // 호스트 또는 게스트 취소 요청 존재 확인
    const cancelRequest = await ContractStatusLog.findOne({
      where: {
        contractId,
        [Op.or]: [
          { metadata: { [Op.like]: '%CANCEL_REQUEST_BY_HOST%' } },
          { metadata: { [Op.like]: '%CANCEL_REQUEST_BY_GUEST%' } }
        ]
      },
      order: [['createdAt', 'DESC']],
      transaction
    });

    if (!cancelRequest) {
      await transaction.rollback();
      return error(res, {
        code: 4634,
        message: '해당 계약에 대한 취소 요청을 찾을 수 없습니다.'
      }, 404);
    }

    const cancelRequestMetadata = JSON.parse(cancelRequest.metadata || '{}');
    const isGuestRequest = cancelRequestMetadata.type === 'CANCEL_REQUEST_BY_GUEST';
    const requesterLabel = isGuestRequest ? '게스트' : '호스트';
    const rejectedMetadataType = isGuestRequest ? 'GUEST_CANCEL_REQUEST_REJECTED' : 'HOST_CANCEL_REQUEST_REJECTED';

    // CANCEL_REQUESTED → IN_PROGRESS 원복
    await contract.update({ status: 'IN_PROGRESS' }, { transaction });

    await ContractStatusLog.createLog({
      contractId: contract.id,
      fromStatus: 'CANCEL_REQUESTED',
      toStatus: 'IN_PROGRESS',
      changedBy: 'ADMIN',
      changedByUserId: adminId,
      reason: `${requesterLabel} 취소 요청 거절: ${adminNote || ''}`,
      metadata: {
        type: rejectedMetadataType,
        adminId,
        adminNote,
        originalRequestLogId: cancelRequest.id
      },
      transaction
    });

    await transaction.commit();

    // 채팅 시스템 메시지
    try {
      if (contract.chatRoom && contract.chatRoom.firebaseChatRoomId) {
        const rejectedMsgType = isGuestRequest
          ? SystemMessageTypes.GUEST_CANCEL_REQUEST_REJECTED
          : SystemMessageTypes.HOST_CANCEL_REQUEST_REJECTED;
        const messageText = getSystemMessageTemplate(rejectedMsgType);
        await sendSystemMessage(
          contract.chatRoom.firebaseChatRoomId,
          messageText,
          rejectedMsgType,
          { contractId: contract.id }
        );
      }
    } catch (chatErr) {
      console.error('취소 요청 거절 시스템 메시지 전송 실패 (무시됨):', chatErr);
    }

    // 요청자(호스트 또는 게스트) 알림
    try {
      await NotificationService.create({
        userId: isGuestRequest ? contract.guestId : contract.hostId,
        userMode: isGuestRequest ? 'guest' : 'host',
        type: 'CONTRACT',
        title: '취소 요청 거절',
        message: `${requesterLabel}님의 취소 요청이 관리자에 의해 거절되었습니다.`,
        relatedContractId: contract.id
      });
    } catch (notifyErr) {
      console.error('취소 거절 알림 전송 실패 (무시됨):', notifyErr);
    }

    return success(res, {
      contractId: contract.id,
      status: 'IN_PROGRESS',
      adminNote
    }, `${requesterLabel} 취소 요청이 거절되었습니다.`);

  } catch (err) {
    await transaction.rollback();
    console.error('호스트 취소 요청 거절 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 보증금 보류 건 목록 조회 (전체 상태)
 * GET /api/admin/deposits
 * Query: status, startDate, endDate, contractId, hostName, page, limit
 *
 * 상태 매핑:
 *  REQUESTED     → checkoutStatus: HOLD_REQUESTED
 *  APPROVED      → checkoutStatus: HOST_PENDING
 *  HOST_SUBMITTED → checkoutStatus: HOST_PENDING + depositAgreement.status: SUBMITTED
 *  AGREED        → depositStatus: DEDUCTION_CONFIRMED | RETURN_CONFIRMED
 *  AUTO_REFUNDED → depositStatus: RETURN_CONFIRMED + depositAgreement.status: AUTO_RETURNED
 */
const getDepositHolds = async (req, res) => {
  try {
    const { status, startDate, endDate, contractId, hostName, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // 상태 필터 → checkoutStatus / depositStatus 조건 변환
    const contractWhere = { status: 'COMPLETED' };

    if (status === 'REQUESTED') {
      contractWhere.checkoutStatus = 'HOLD_REQUESTED';
    } else if (status === 'REJECTED') {
      contractWhere.checkoutStatus = 'HOLD_REJECTED';
    } else if (status === 'APPROVED') {
      contractWhere.checkoutStatus = 'HOST_PENDING';
    } else if (status === 'HOST_SUBMITTED') {
      contractWhere.checkoutStatus = 'HOST_PENDING';
    } else if (status === 'AGREED') {
      contractWhere.depositStatus = { [Op.in]: ['DEDUCTION_CONFIRMED', 'RETURN_CONFIRMED'] };
      contractWhere.checkoutStatus = 'HOST_CONFIRMED';
    } else if (status === 'AUTO_REFUNDED') {
      contractWhere.depositStatus = 'RETURN_CONFIRMED';
      contractWhere.checkoutStatus = 'HOST_CONFIRMED';
    } else {
      // 전체: 보류 관련 상태 모두 포함
      contractWhere[Op.or] = [
        { checkoutStatus: { [Op.in]: ['HOLD_REQUESTED', 'HOLD_REJECTED', 'HOST_PENDING'] } },
        {
          checkoutStatus: 'HOST_CONFIRMED',
          depositStatus: { [Op.in]: ['DEDUCTION_CONFIRMED', 'RETURN_CONFIRMED'] }
        }
      ];
    }

    if (contractId) {
      contractWhere.id = contractId;
    }

    if (startDate || endDate) {
      contractWhere.holdRequestedAt = {};
      if (startDate) contractWhere.holdRequestedAt[Op.gte] = new Date(startDate + 'T00:00:00');
      if (endDate) {
        const end = new Date(endDate + 'T00:00:00');
        end.setHours(23, 59, 59, 999);
        contractWhere.holdRequestedAt[Op.lte] = end;
      }
    }

    const hostInclude = { model: User, as: 'host', attributes: ['id', 'name', 'email', 'phoneNumber'] };
    if (hostName) {
      hostInclude.where = { name: { [Op.like]: `%${hostName}%` } };
      hostInclude.required = true;
    }

    // HOST_SUBMITTED / AUTO_REFUNDED 필터는 DepositAgreement 조건 추가 필요
    const depositAgreementsInclude = {
      model: DepositAgreement,
      as: 'depositAgreements',
      required: false,
      attributes: ['id', 'status', 'deductAmount', 'rejectedReason', 'rejectedAt', 'createdAt']
    };
    if (status === 'HOST_SUBMITTED') {
      depositAgreementsInclude.where = { status: 'SUBMITTED' };
      depositAgreementsInclude.required = true;
    } else if (status === 'AUTO_REFUNDED') {
      depositAgreementsInclude.where = { status: 'AUTO_RETURNED' };
      depositAgreementsInclude.required = true;
    }

    const { count, rows: contracts } = await Contract.findAndCountAll({
      where: contractWhere,
      include: [
        { model: User, as: 'guest', attributes: ['id', 'name', 'email', 'phoneNumber'] },
        hostInclude,
        { model: Room, as: 'room', attributes: ['id', 'roomName'] },
        depositAgreementsInclude
      ],
      order: [['holdRequestedAt', 'DESC']],
      limit: parseInt(limit),
      offset,
      distinct: true
    });

    // 최신 DepositAgreement row 추출
    const getLatestDA = (c) => {
      if (!c.depositAgreements || c.depositAgreements.length === 0) return null;
      return c.depositAgreements.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    };

    // PRD 상태명 매핑
    const resolveStatus = (c) => {
      if (c.checkoutStatus === 'HOLD_REQUESTED') return 'REQUESTED';
      if (c.checkoutStatus === 'HOLD_REJECTED') return 'REJECTED';
      if (c.checkoutStatus === 'HOST_PENDING') {
        const latestDA = getLatestDA(c);
        return latestDA?.status === 'SUBMITTED' ? 'HOST_SUBMITTED' : 'APPROVED';
      }
      if (c.checkoutStatus === 'HOST_CONFIRMED') {
        const latestDA = getLatestDA(c);
        if (latestDA?.status === 'AUTO_RETURNED') return 'AUTO_REFUNDED';
        return 'AGREED';
      }
      return 'UNKNOWN';
    };

    return success(res, {
      holds: contracts.map(c => {
        const latestDA = getLatestDA(c);
        return {
          contractId: c.id,
          room: c.room ? { id: c.room.id, roomName: c.room.roomName } : null,
          guest: { id: c.guest?.id, name: c.guest?.name },
          host: { id: c.host?.id, name: c.host?.name },
          deposit: c.deposit,
          deductRequestAmount: latestDA?.deductAmount ?? null,
          holdReason: c.deductionReason,
          holdRequestedAt: c.holdRequestedAt ? toKSTString(c.holdRequestedAt) : null,
          holdApprovedAt: c.holdApprovedAt ? toKSTString(c.holdApprovedAt) : null,
          holdStatus: resolveStatus(c),
          // 거절 정보
          rejectedReason: c.checkoutStatus === 'HOLD_REJECTED' ? latestDA?.rejectedReason : null,
          rejectedAt: c.checkoutStatus === 'HOLD_REJECTED' ? latestDA?.rejectedAt : null
        };
      }),
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / parseInt(limit))
      }
    }, '보증금 보류 목록을 조회했습니다.');

  } catch (err) {
    console.error('보증금 보류 목록 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 보증금 보류 상세 조회
 * GET /api/admin/deposits/:contractId
 */
const getDepositHoldDetail = async (req, res) => {
  try {
    const { contractId } = req.params;

    const contract = await Contract.findOne({
      where: { id: contractId, status: 'COMPLETED' },
      include: [
        { model: User, as: 'guest', attributes: ['id', 'name', 'email', 'phoneNumber'] },
        { model: User, as: 'host', attributes: ['id', 'name', 'email', 'phoneNumber'] },
        { model: Room, as: 'room', attributes: ['id', 'roomName', 'address'] },
        {
          model: DepositAgreement,
          as: 'depositAgreements',
          attributes: { exclude: [] },
          required: false
        }
      ]
    });

    if (!contract) {
      return error(res, ErrorCodes.CONTRACT_NOT_FOUND, 404);
    }

    // 보류 이력 최신순 정렬
    const depositAgreements = (contract.depositAgreements || [])
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const latestDA = depositAgreements[0] || null;

    const resolveStatus = (c) => {
      if (c.checkoutStatus === 'HOLD_REQUESTED') return 'REQUESTED';
      if (c.checkoutStatus === 'HOLD_REJECTED') return 'REJECTED';
      if (c.checkoutStatus === 'HOST_PENDING') {
        return latestDA?.status === 'SUBMITTED' ? 'HOST_SUBMITTED' : 'APPROVED';
      }
      if (c.checkoutStatus === 'HOST_CONFIRMED') {
        if (latestDA?.status === 'AUTO_RETURNED') return 'AUTO_REFUNDED';
        return 'AGREED';
      }
      return null;
    };

    return success(res, {
      contractId: contract.id,
      checkInDate: toKSTString(contract.checkInDate),
      checkOutDate: toKSTString(contract.checkOutDate),
      guest: contract.guest,
      host: contract.host,
      room: contract.room,
      deposit: contract.deposit,
      holdStatus: resolveStatus(contract),
      holdReason: contract.deductionReason,
      holdRequestedAt: contract.holdRequestedAt ? toKSTString(contract.holdRequestedAt) : null,
      holdApprovedAt: contract.holdApprovedAt ? toKSTString(contract.holdApprovedAt) : null,
      refundableDeposit: contract.refundableDeposit,
      depositStatus: contract.depositStatus,
      // 보류 신청/합의 이력 전체 (최신순)
      depositAgreements: depositAgreements.map(da => ({
        id: da.id,
        status: da.status,
        statusLabel: DepositAgreement.STATUS_LABELS[da.status],
        holdReason: da.holdReason,
        requestedAt: da.requestedAt ? toKSTString(da.requestedAt) : null,
        rejectedAt: da.rejectedAt ? toKSTString(da.rejectedAt) : null,
        rejectedReason: da.rejectedReason,
        adminApprovedAt: da.adminApprovedAt ? toKSTString(da.adminApprovedAt) : null,
        deductAmount: da.deductAmount,
        agreementText: da.agreementText,
        submittedAt: da.submittedAt ? toKSTString(da.submittedAt) : null,
        acceptedAt: da.acceptedAt ? toKSTString(da.acceptedAt) : null,
        createdAt: da.createdAt
      }))
    }, '보증금 보류 상세 조회 성공');

  } catch (err) {
    console.error('보증금 보류 상세 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 보증금 보류 신청 목록 조회 (구버전 - 하위호환용, pending-holds 라우트 유지)
 * GET /api/admin/deposits/pending-holds
 */
const getPendingDepositHolds = async (req, res) => {
  req.query.status = 'REQUESTED';
  return getDepositHolds(req, res);
};

/**
 * 보증금 보류 신청 승인
 * POST /api/admin/deposits/:contractId/approve-hold
 * 정책 7.8.1: 승인 시 보증금 상태 → 반환보류, 합의 프로세스 시작
 */
const approveDepositHold = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { contractId } = req.params;
    const adminId = req.admin.id;

    const contract = await Contract.findByPk(contractId, {
      include: [
        { model: User, as: 'guest', attributes: ['id', 'name'] },
        { model: User, as: 'host', attributes: ['id', 'name'] }
      ],
      transaction
    });

    if (!contract) {
      await transaction.rollback();
      return error(res, ErrorCodes.CONTRACT_NOT_FOUND, 404);
    }

    if (contract.checkoutStatus !== 'HOLD_REQUESTED') {
      await transaction.rollback();
      return error(res, {
        code: 4670,
        message: '보류 신청 대기 상태가 아닙니다.'
      }, 400);
    }

    const now = new Date();

    // 최신 REQUESTED row → APPROVED
    const depositAgreement = await DepositAgreement.findOne({
      where: { contractId, status: 'REQUESTED' },
      order: [['createdAt', 'DESC']],
      transaction
    });
    if (!depositAgreement) {
      await transaction.rollback();
      return error(res, { code: 4672, message: '보류 신청 이력을 찾을 수 없습니다.' }, 404);
    }
    await depositAgreement.update({
      status: 'APPROVED',
      adminApprovedAt: now
    }, { transaction });

    // 정책 7.8.1: 승인 → 반환보류, 합의 프로세스 시작
    await contract.update({
      checkoutStatus: 'HOST_PENDING',
      depositStatus: 'RETURN_HOLD',
      holdApprovedAt: now,
      holdApprovedByAdminId: adminId
    }, { transaction });

    // 계약 상태 변경 로그
    await ContractStatusLog.create({
      contractId: contract.id,
      fromStatus: 'COMPLETED',
      toStatus: 'COMPLETED',
      changedBy: 'ADMIN',
      changedByUserId: adminId,
      reason: '관리자 보증금 보류 승인',
      metadata: JSON.stringify({
        type: 'DEPOSIT_HOLD_APPROVED',
        checkoutStatusChange: 'HOLD_REQUESTED → HOST_PENDING',
        depositStatusChange: 'HOLDING → RETURN_HOLD',
        holdApprovedAt: now
      })
    }, { transaction });

    await transaction.commit();

    // 채팅방 시스템 메시지 발송
    try {
      const chatRoom = await ChatRoom.findOne({ where: { contractId: contract.id } });
      if (chatRoom && chatRoom.firebaseChatRoomId) {
        const messageText = getSystemMessageTemplate(SystemMessageTypes.DEPOSIT_HOLD_APPROVED);
        await sendSystemMessage(chatRoom.firebaseChatRoomId, messageText, SystemMessageTypes.DEPOSIT_HOLD_APPROVED);
      }
    } catch (chatErr) {
      console.error('보류 승인 시스템 메시지 전송 실패 (무시됨):', chatErr);
    }

    // 양측 알림 발송
    try {
      const notifyTargets = [
        { userId: contract.hostId, userMode: 'host' },
        { userId: contract.guestId, userMode: 'guest' }
      ];
      for (const { userId, userMode } of notifyTargets) {
        await NotificationService.create({
          userId,
          userMode,
          type: 'CONTRACT',
          title: '보증금 보류 승인',
          message: '관리자가 보증금 보류를 승인했습니다. 합의 절차가 시작됩니다. (기한: 10일)',
          relatedContractId: contract.id
        });
      }
    } catch (notifyErr) {
      console.error('보류 승인 알림 전송 실패 (무시됨):', notifyErr);
    }

    // 알림톡 발송 (4-9 보증금 보류 안내)
    const agreementDeadline = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
    try {
      const AlimtalkService = require('../services/alimtalkService');
      const [holdGuest, holdHost] = await Promise.all([
        User.findByPk(contract.guestId, { attributes: ['id', 'phoneNumber', 'name', 'nickname'] }),
        User.findByPk(contract.hostId, { attributes: ['id', 'phoneNumber', 'name', 'nickname'] })
      ]);
      const deadlineStr = `${agreementDeadline.getFullYear()}-${String(agreementDeadline.getMonth() + 1).padStart(2, '0')}-${String(agreementDeadline.getDate()).padStart(2, '0')}`;
      AlimtalkService.sendDepositHold(contract, holdGuest, holdHost, deadlineStr)
        .catch(err => console.error('[Alimtalk] deposit_hold 실패:', err.message));
    } catch (alimtalkErr) {
      console.error('보류 승인 알림톡 발송 실패 (무시됨):', alimtalkErr);
    }

    return updated(res, {
      contractId: contract.id,
      checkoutStatus: 'HOST_PENDING',
      depositStatus: 'RETURN_HOLD',
      holdApprovedAt: now,
      agreementDeadline
    }, '보증금 보류가 승인되었습니다. 합의 기한: 10일');

  } catch (err) {
    await transaction.rollback();
    console.error('보증금 보류 승인 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 보증금 보류 신청 거절
 * POST /api/admin/deposits/:contractId/reject-hold
 * 정책 7.8.2: 거절 시 카운트다운 재개 (남은 시간 기준)
 */
const rejectDepositHold = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { contractId } = req.params;
    const adminId = req.admin.id;
    const { reason } = req.body;

    const contract = await Contract.findByPk(contractId, { transaction });

    if (!contract) {
      await transaction.rollback();
      return error(res, ErrorCodes.CONTRACT_NOT_FOUND, 404);
    }

    if (contract.checkoutStatus !== 'HOLD_REQUESTED') {
      await transaction.rollback();
      return error(res, {
        code: 4671,
        message: '보류 신청 대기 상태가 아닙니다.'
      }, 400);
    }

    // 정책 7.8.2: 거절 → HOLD_REJECTED, 카운트다운 재개
    // 남은 시간 기준으로 새 checkoutRequestedAt 계산
    const now = new Date();
    let newCheckoutRequestedAt = contract.checkoutRequestedAt;

    if (contract.holdRemainingMs != null && contract.holdRemainingMs > 0) {
      // 카운트다운 재개: 현재 시점에서 남은 시간만큼 역산하여 새 기준 시점 설정
      // autoConfirmCheckout은 checkoutRequestedAt + 48h 기준이므로
      // 새 기준 = now - (48h - remainingMs) = now - 48h + remainingMs
      const fortyEightHoursMs = 48 * 60 * 60 * 1000;
      newCheckoutRequestedAt = new Date(now.getTime() - fortyEightHoursMs + contract.holdRemainingMs);
    }

    // 최신 REQUESTED row → REJECTED
    const depositAgreement = await DepositAgreement.findOne({
      where: { contractId, status: 'REQUESTED' },
      order: [['createdAt', 'DESC']],
      transaction
    });
    if (!depositAgreement) {
      await transaction.rollback();
      return error(res, { code: 4673, message: '보류 신청 이력을 찾을 수 없습니다.' }, 404);
    }
    await depositAgreement.update({
      status: 'REJECTED',
      rejectedAt: now,
      rejectedReason: reason || null,
      rejectedByAdminId: adminId
    }, { transaction });

    await contract.update({
      checkoutStatus: 'HOLD_REJECTED',
      checkoutRequestedAt: newCheckoutRequestedAt,
      holdRequestedAt: null,
      holdRemainingMs: null
    }, { transaction });

    // 계약 상태 변경 로그
    await ContractStatusLog.create({
      contractId: contract.id,
      fromStatus: 'COMPLETED',
      toStatus: 'COMPLETED',
      changedBy: 'ADMIN',
      changedByUserId: adminId,
      reason: reason || '관리자 보증금 보류 거절',
      metadata: JSON.stringify({
        type: 'DEPOSIT_HOLD_REJECTED',
        checkoutStatusChange: 'HOLD_REQUESTED → HOLD_REJECTED',
        holdRemainingMs: contract.holdRemainingMs,
        newCheckoutRequestedAt
      })
    }, { transaction });

    await transaction.commit();

    // 채팅방 시스템 메시지 발송
    try {
      const chatRoom = await ChatRoom.findOne({ where: { contractId: contract.id } });
      if (chatRoom && chatRoom.firebaseChatRoomId) {
        const messageText = getSystemMessageTemplate(SystemMessageTypes.DEPOSIT_HOLD_REJECTED);
        await sendSystemMessage(chatRoom.firebaseChatRoomId, messageText, SystemMessageTypes.DEPOSIT_HOLD_REJECTED);
      }
    } catch (chatErr) {
      console.error('보류 거절 시스템 메시지 전송 실패 (무시됨):', chatErr);
    }

    // 양측 알림 발송
    try {
      const notifyTargets = [
        { userId: contract.hostId, userMode: 'host' },
        { userId: contract.guestId, userMode: 'guest' }
      ];
      for (const { userId, userMode } of notifyTargets) {
        await NotificationService.create({
          userId,
          userMode,
          type: 'CONTRACT',
          title: '보증금 보류 거절',
          message: '관리자가 보증금 보류 신청을 거절했습니다. 호스트 퇴실확인 카운트다운이 재개됩니다.',
          relatedContractId: contract.id
        });
      }
    } catch (notifyErr) {
      console.error('보류 거절 알림 전송 실패 (무시됨):', notifyErr);
    }

    return updated(res, {
      contractId: contract.id,
      checkoutStatus: 'HOLD_REJECTED',
      holdRemainingMs: contract.holdRemainingMs,
      rejectReason: reason || null
    }, '보증금 보류 신청이 거절되었습니다. 퇴실 확인 카운트다운이 재개됩니다.');

  } catch (err) {
    await transaction.rollback();
    console.error('보증금 보류 거절 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 관리자 강제 보증금 반환보류
 * POST /api/admin/deposits/:contractId/force-hold
 * 정책 7.12: 명백한 분쟁 접수 또는 심각한 손해 위험 시 강제 보류
 */
const forceDepositHold = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { contractId } = req.params;
    const adminId = req.admin.id;
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      await transaction.rollback();
      return error(res, {
        code: 4675,
        message: '강제 반환보류 사유를 입력해주세요. (필수)'
      }, 400);
    }

    const contract = await Contract.findByPk(contractId, { transaction });

    if (!contract) {
      await transaction.rollback();
      return error(res, ErrorCodes.CONTRACT_NOT_FOUND, 404);
    }

    if (contract.status !== 'COMPLETED') {
      await transaction.rollback();
      return error(res, {
        code: 4676,
        message: '계약 완료 상태에서만 강제 반환보류가 가능합니다.'
      }, 400);
    }

    // 이미 반환보류/차감확정/반환완료 등이면 불가
    if (['RETURN_HOLD', 'DEDUCTION_CONFIRMED', 'RETURNED'].includes(contract.depositStatus)) {
      await transaction.rollback();
      return error(res, {
        code: 4677,
        message: `현재 보증금 상태(${contract.depositStatus})에서는 강제 보류가 불가합니다.`
      }, 400);
    }

    const now = new Date();

    // 정책 7.12: 강제 반환보류 후 일반 반환보류와 동일 절차 (합의 10일)
    await contract.update({
      checkoutStatus: 'HOST_PENDING',
      depositStatus: 'RETURN_HOLD',
      holdApprovedAt: now,
      holdApprovedByAdminId: adminId,
      deductionReason: `[관리자 강제 보류] ${reason.trim()}`
    }, { transaction });

    // 계약 상태 변경 로그
    await ContractStatusLog.create({
      contractId: contract.id,
      fromStatus: 'COMPLETED',
      toStatus: 'COMPLETED',
      changedBy: 'ADMIN',
      changedByUserId: adminId,
      reason: `관리자 강제 반환보류: ${reason.trim()}`,
      metadata: JSON.stringify({
        type: 'DEPOSIT_FORCE_HELD',
        depositStatusChange: `${contract.depositStatus} → RETURN_HOLD`,
        holdApprovedAt: now,
        forceHoldReason: reason.trim()
      })
    }, { transaction });

    await transaction.commit();

    // 채팅방 시스템 메시지 발송
    try {
      const chatRoom = await ChatRoom.findOne({ where: { contractId: contract.id } });
      if (chatRoom && chatRoom.firebaseChatRoomId) {
        const messageText = getSystemMessageTemplate(SystemMessageTypes.DEPOSIT_FORCE_HELD);
        await sendSystemMessage(chatRoom.firebaseChatRoomId, messageText, SystemMessageTypes.DEPOSIT_FORCE_HELD);
      }
    } catch (chatErr) {
      console.error('강제 보류 시스템 메시지 전송 실패 (무시됨):', chatErr);
    }

    // 양측 알림 발송
    try {
      const notifyTargets = [
        { userId: contract.hostId, userMode: 'host' },
        { userId: contract.guestId, userMode: 'guest' }
      ];
      for (const { userId, userMode } of notifyTargets) {
        await NotificationService.create({
          userId,
          userMode,
          type: 'CONTRACT',
          title: '보증금 반환보류 (관리자)',
          message: '관리자에 의해 보증금이 반환보류 처리되었습니다. 합의 절차가 시작됩니다.',
          relatedContractId: contract.id
        });
      }
    } catch (notifyErr) {
      console.error('강제 보류 알림 전송 실패 (무시됨):', notifyErr);
    }

    return updated(res, {
      contractId: contract.id,
      checkoutStatus: 'HOST_PENDING',
      depositStatus: 'RETURN_HOLD',
      holdApprovedAt: now,
      agreementDeadline: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000),
      forceHoldReason: reason.trim()
    }, '보증금이 강제 반환보류 처리되었습니다. 합의 기한: 10일');

  } catch (err) {
    await transaction.rollback();
    console.error('강제 반환보류 처리 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

// ============================================
// 알림톡 관리
// ============================================

/**
 * 보증금 환불 재시도
 * POST /api/admin/deposits/:contractId/retry-refund
 * 정책: PG 환불 실패(REFUND_FAILED) 건에 대해 관리자가 수동 재시도
 */
const retryDepositRefund = async (req, res) => {
  try {
    const { contractId } = req.params;
    const adminId = req.admin.id;

    const contract = await Contract.findByPk(contractId);
    if (!contract) {
      return error(res, ErrorCodes.CONTRACT_NOT_FOUND, 404);
    }

    if (contract.depositStatus !== 'REFUND_FAILED') {
      return error(res, {
        code: 4680,
        message: '환불 실패 상태의 계약만 재시도할 수 있습니다.'
      }, 400);
    }

    const refundableDeposit = contract.refundableDeposit || 0;
    if (refundableDeposit <= 0) {
      return error(res, {
        code: 4681,
        message: '환불할 보증금이 없습니다.'
      }, 400);
    }

    const payment = await Payment.findOne({
      where: { contractId: contract.id, status: { [Op.in]: ['DONE', 'PARTIAL_CANCELED'] } }
    });

    if (!payment) {
      return error(res, {
        code: 4682,
        message: '원결제 정보를 찾을 수 없습니다.'
      }, 404);
    }

    // PG 환불 재시도
    const { orderno, orgpaydate, orgtranamt } = paytagClient.extractCancelParams(payment);
    const newBalance = payment.balanceAmount - refundableDeposit;
    const canceltype = newBalance === 0 ? '0' : '1';

    try {
      await paytagClient.cancelPayment({
        orderno,
        orgpaydate,
        orgtranamt,
        cancelamt: refundableDeposit,
        canceltype
      });
    } catch (pgErr) {
      // 재시도도 실패 시 로그 기록
      await PaymentFailureLog.create({
        contractId: contract.id,
        orderId: payment.orderId || `DEPOSIT_REFUND_RETRY_${contract.id}`,
        failureCode: pgErr.paytagErrorCode || 'PG_CANCEL_FAILED',
        failureMessage: pgErr.paytagErrorMessage || pgErr.message,
        requestData: {
          type: 'DEPOSIT_REFUND_RETRY',
          cancelamt: refundableDeposit,
          retriedByAdminId: adminId
        },
        responseData: pgErr.paytagResponse || null
      });

      return error(res, {
        code: 4900,
        message: `PG 환불 재시도 실패: ${pgErr.paytagErrorMessage || pgErr.message}`,
        pgErrorCode: pgErr.paytagErrorCode
      }, 502);
    }

    // PG 성공 시 상태 업데이트
    await payment.update({
      balanceAmount: newBalance,
      status: newBalance === 0 ? 'CANCELED' : 'PARTIAL_CANCELED'
    });

    // 원래 확정됐던 depositStatus 복원
    const restoredStatus = contract.depositDeduction > 0 ? 'DEDUCTION_CONFIRMED' : 'RETURN_CONFIRMED';
    await contract.update({ depositStatus: restoredStatus });

    await ContractStatusLog.create({
      contractId: contract.id,
      fromStatus: 'COMPLETED',
      toStatus: 'COMPLETED',
      changedBy: 'ADMIN',
      changedByUserId: adminId,
      reason: `관리자 보증금 환불 재시도 성공 (환불액: ${refundableDeposit.toLocaleString()}원)`,
      metadata: JSON.stringify({
        type: 'DEPOSIT_REFUND_RETRIED',
        refundableDeposit,
        previousStatus: 'REFUND_FAILED',
        restoredStatus
      })
    });

    return success(res, {
      contractId: contract.id,
      depositStatus: restoredStatus,
      refundedAmount: refundableDeposit
    }, '보증금 환불 재시도 성공');

  } catch (err) {
    console.error('보증금 환불 재시도 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 알림톡 템플릿 목록 조회
 * GET /api/admin/alimtalk/templates
 */
const getAlimtalkTemplates = async (req, res) => {
  try {
    const { templates } = require('../config/alimtalkTemplates');
    const { getCacheStatus } = require('../utils/alimtalkTemplateCache');

    const cacheStatus = getCacheStatus();

    // config에 등록된 tplCode 목록
    const configTplCodes = new Set(
      Object.values(templates).map(t => t.tplCode).filter(Boolean)
    );

    // 1) config 정의 + 캐시 상태 병합
    const configTemplates = Object.entries(templates).map(([eventName, config]) => {
      const cached = cacheStatus.templates.find(t => t.tplCode === config.tplCode);
      return {
        eventName,
        tplCode: config.tplCode,
        eventLabel: config.eventLabel,
        varMap: config.varMap,
        isActive: !!config.tplCode,
        isLinked: true,
        inspStatus: cached?.inspStatus || null,
        templtName: cached?.templtName || null,
        templtContent: cached?.templtContent || null,
        buttons: cached?.buttons || null,
        lastFetched: cached?.lastFetched || null
      };
    });

    // 2) Aligo에만 있고 config에 없는 템플릿 (미연결)
    const unmappedTemplates = cacheStatus.templates
      .filter(t => !configTplCodes.has(t.tplCode))
      .map(t => ({
        eventName: null,
        tplCode: t.tplCode,
        eventLabel: null,
        varMap: null,
        isActive: false,
        isLinked: false,
        inspStatus: t.inspStatus,
        templtName: t.templtName,
        templtContent: t.templtContent || null,
        buttons: t.buttons || null,
        lastFetched: t.lastFetched
      }));

    const allTemplates = [...configTemplates, ...unmappedTemplates];

    return success(res, {
      totalTemplates: allTemplates.length,
      activeTemplates: configTemplates.filter(t => t.isActive).length,
      unmappedCount: unmappedTemplates.length,
      lastSyncTime: cacheStatus.lastSyncTime,
      syncError: cacheStatus.syncError,
      templates: allTemplates
    }, '알림톡 템플릿 목록 조회 성공');
  } catch (err) {
    console.error('알림톡 템플릿 목록 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 알림톡 템플릿 캐시 수동 갱신
 * POST /api/admin/alimtalk/templates/sync
 */
const syncAlimtalkTemplates = async (req, res) => {
  try {
    const { syncTemplates } = require('../utils/alimtalkTemplateCache');

    const result = await syncTemplates();

    if (result?.error) {
      return error(res, { code: 5001, message: `템플릿 동기화 실패: ${result.error}` }, 500);
    }

    const { getCacheStatus } = require('../utils/alimtalkTemplateCache');
    const cacheStatus = getCacheStatus();

    return success(res, {
      templateCount: cacheStatus.templateCount,
      lastSyncTime: cacheStatus.lastSyncTime
    }, '알림톡 템플릿 캐시 갱신 완료');
  } catch (err) {
    console.error('알림톡 템플릿 동기화 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 알림톡 발송 이력 조회
 * GET /api/admin/alimtalk/logs
 * Query: page, limit, status, eventName, receiverId, startDate, endDate
 */
const getAlimtalkLogs = async (req, res) => {
  try {
    const { AlimtalkLog } = require('../models');
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;

    const where = {};

    if (req.query.status) {
      where.status = req.query.status;
    }
    if (req.query.eventName) {
      where.eventName = req.query.eventName;
    }
    if (req.query.receiverId) {
      where.receiverId = parseInt(req.query.receiverId);
    }
    if (req.query.startDate || req.query.endDate) {
      where.createdAt = {};
      if (req.query.startDate) {
        where.createdAt[Op.gte] = new Date(req.query.startDate + 'T00:00:00');
      }
      if (req.query.endDate) {
        const endDate = new Date(req.query.endDate + 'T23:59:59');
        where.createdAt[Op.lte] = endDate;
      }
    }

    const { count, rows } = await AlimtalkLog.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit,
      offset,
      attributes: [
        'id', 'eventName', 'contractId', 'chatRoomId',
        'receiverId', 'receiverPhone', 'tplCode', 'status',
        'retryCount', 'errorMessage', 'sentAt', 'failedAt', 'createdAt'
      ]
    });

    return success(res, {
      logs: rows,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(count / limit),
        totalCount: count,
        limit
      }
    }, '알림톡 발송 이력 조회 성공');
  } catch (err) {
    console.error('알림톡 발송 이력 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 알림톡 발송 통계
 * GET /api/admin/alimtalk/stats
 * Query: startDate, endDate (기본: 최근 30일)
 */
const getAlimtalkStats = async (req, res) => {
  try {
    const { AlimtalkLog } = require('../models');

    const endDate = req.query.endDate ? new Date(req.query.endDate + 'T23:59:59') : new Date();
    if (!req.query.endDate) endDate.setHours(23, 59, 59, 999);
    const startDate = req.query.startDate
      ? new Date(req.query.startDate + 'T00:00:00')
      : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

    const dateFilter = {
      createdAt: { [Op.between]: [startDate, endDate] }
    };

    // 상태별 건수
    const statusCounts = await AlimtalkLog.findAll({
      where: dateFilter,
      attributes: [
        'status',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: ['status'],
      raw: true
    });

    // 이벤트별 건수
    const eventCounts = await AlimtalkLog.findAll({
      where: dateFilter,
      attributes: [
        'eventName',
        [sequelize.fn('COUNT', sequelize.col('id')), 'total'],
        [sequelize.fn('SUM', sequelize.literal("CASE WHEN status = 'SENT' THEN 1 ELSE 0 END")), 'sent'],
        [sequelize.fn('SUM', sequelize.literal("CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END")), 'failed'],
        [sequelize.fn('SUM', sequelize.literal("CASE WHEN status = 'FALLBACK_SENT' THEN 1 ELSE 0 END")), 'fallback']
      ],
      group: ['eventName'],
      order: [[sequelize.fn('COUNT', sequelize.col('id')), 'DESC']],
      raw: true
    });

    // 전체 집계
    const total = statusCounts.reduce((sum, s) => sum + parseInt(s.count), 0);
    const sentCount = parseInt(statusCounts.find(s => s.status === 'SENT')?.count || 0);
    const failedCount = parseInt(statusCounts.find(s => s.status === 'FAILED')?.count || 0);
    const retriedCount = parseInt(statusCounts.find(s => s.status === 'RETRIED')?.count || 0);
    const fallbackCount = parseInt(statusCounts.find(s => s.status === 'FALLBACK_SENT')?.count || 0);

    const successCount = sentCount + retriedCount + fallbackCount;
    const successRate = total > 0 ? ((successCount / total) * 100).toFixed(1) : '0.0';

    return success(res, {
      period: {
        startDate: toDateStrKST(startDate),
        endDate: toDateStrKST(endDate)
      },
      summary: {
        total,
        sent: sentCount,
        retried: retriedCount,
        fallbackSent: fallbackCount,
        failed: failedCount,
        successRate: `${successRate}%`
      },
      byStatus: statusCounts,
      byEvent: eventCounts
    }, '알림톡 발송 통계 조회 성공');
  } catch (err) {
    console.error('알림톡 발송 통계 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 알림톡 수동 재시도
 * POST /api/admin/alimtalk/logs/:logId/retry
 */
const retryAlimtalkLog = async (req, res) => {
  try {
    const AlimtalkService = require('../services/alimtalkService');
    const { logId } = req.params;

    const result = await AlimtalkService.retryFailed(parseInt(logId));

    if (!result.retried) {
      return error(res, { code: 4001, message: result.error || '재시도 불가' }, 400);
    }

    return success(res, { logId: parseInt(logId), retried: true }, '알림톡 재시도 완료');
  } catch (err) {
    console.error('알림톡 수동 재시도 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

// ============================================================
// 서비스 태스크 관리 (청소 / 침구류 대여 / 침구류 회수)
// ============================================================

/**
 * 서비스 태스크 목록 조회
 * GET /api/admin/service-tasks
 *
 * Query:
 *   tab        : 'pending' | 'all'  (pending → status=PENDING 자동 필터)
 *   task_type  : CLEANING | BEDDING_DELIVERY | BEDDING_RETRIEVAL
 *   status     : PENDING | RESERVED | COMPLETED | ISSUE
 *   date_from  : YYYY-MM-DD
 *   date_to    : YYYY-MM-DD
 *   page       : number (기본 1)
 *   limit      : number (기본 20)
 */
const getServiceTasks = async (req, res) => {
  try {
    const {
      tab,
      task_type,
      status: statusFilter,
      date_from,
      date_to,
      page = 1,
      limit = 20
    } = req.query;

    const where = {};

    // 탭: pending → PENDING 상태 고정 필터
    if (tab === 'pending') {
      where.status = 'PENDING';
    } else if (statusFilter) {
      where.status = statusFilter;
    }

    if (task_type) {
      where.taskType = task_type;
    }

    if (date_from || date_to) {
      where.referenceDate = {};
      if (date_from) where.referenceDate[Op.gte] = date_from;
      if (date_to)   where.referenceDate[Op.lte] = date_to;
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { count, rows } = await ServiceTask.findAndCountAll({
      where,
      include: [
        {
          model: Contract,
          as: 'contract',
          attributes: ['id', 'checkInDate', 'checkOutDate'],
          include: [
            {
              model: Room,
              as: 'room',
              attributes: ['id', 'roomName']
            }
          ]
        }
      ],
      order: [['referenceDate', 'ASC']],
      limit: parseInt(limit),
      offset
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const data = rows.map(task => {
      const refDate = new Date(task.referenceDate);
      refDate.setHours(0, 0, 0, 0);
      const diffMs = refDate - today;
      const dDay = Math.ceil(diffMs / (1000 * 60 * 60 * 24)); // 양수=남은일, 0=당일, 음수=지남

      return {
        id: task.id,
        contractId: task.contractId,
        roomName: task.contract?.room?.roomName ?? null,
        taskType: task.taskType,
        referenceDate: task.referenceDate,
        dDay,
        quantity: task.quantity,
        status: task.status,
        vendorName: task.vendorName,
        vendorContact: task.vendorContact,
        vendorRefNo: task.vendorRefNo,
        issueNote: task.issueNote,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt
      };
    });

    return success(res, {
      total: count,
      page: parseInt(page),
      limit: parseInt(limit),
      items: data
    });
  } catch (err) {
    console.error('서비스 태스크 목록 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 서비스 태스크 단건 조회 (변경 이력 포함)
 * GET /api/admin/service-tasks/:id
 */
const getServiceTask = async (req, res) => {
  try {
    const { id } = req.params;

    const task = await ServiceTask.findByPk(id, {
      include: [
        {
          model: Contract,
          as: 'contract',
          attributes: ['id', 'checkInDate', 'checkOutDate'],
          include: [
            {
              model: Room,
              as: 'room',
              attributes: ['id', 'roomName']
            }
          ]
        },
        {
          model: ServiceTaskLog,
          as: 'logs',
          attributes: [
            'id', 'fromStatus', 'toStatus', 'changedBy',
            'adminId', 'adminName',
            'clearedVendorName', 'clearedVendorContact', 'clearedVendorRefNo',
            'clearedReservedAmount', 'clearedActualAmount',
            'note', 'createdAt'
          ],
          order: [['createdAt', 'DESC']]
        }
      ]
    });

    if (!task) {
      return error(res, ErrorCodes.NOT_FOUND, 404, '서비스 태스크를 찾을 수 없습니다.');
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const refDate = new Date(task.referenceDate);
    refDate.setHours(0, 0, 0, 0);
    const dDay = Math.ceil((refDate - today) / (1000 * 60 * 60 * 24));

    return success(res, {
      id: task.id,
      contractId: task.contractId,
      roomName: task.contract?.room?.roomName ?? null,
      checkInDate: toKSTString(task.contract?.checkInDate),
      checkOutDate: toKSTString(task.contract?.checkOutDate),
      taskType: task.taskType,
      referenceDate: task.referenceDate,
      dDay,
      quantity: task.quantity,
      status: task.status,
      vendorName: task.vendorName,
      vendorContact: task.vendorContact,
      vendorRefNo: task.vendorRefNo,
      reservedAmount: task.reservedAmount,
      actualAmount: task.actualAmount,
      issueNote: task.issueNote,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      logs: task.logs ?? []
    });
  } catch (err) {
    console.error('서비스 태스크 단건 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 서비스 태스크 상태 변경
 * PATCH /api/admin/service-tasks/:id/status
 *
 * Body:
 *   status         : PENDING | RESERVED | COMPLETED | ISSUE  (필수)
 *   vendorName     : string  (선택, RESERVED 시 함께 저장)
 *   vendorContact  : string  (선택)
 *   vendorRefNo    : string  (선택)
 *   reservedAmount : number  (선택, RESERVED 시 견적 금액)
 *   actualAmount   : number  (선택, COMPLETED 시 실제 청구 금액)
 *   note           : string  (선택, 관리자 메모)
 */
const updateServiceTaskStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      status: newStatus,
      vendorName, vendorContact, vendorRefNo,
      reservedAmount, actualAmount,
      issueNote,
      note
    } = req.body;

    if (!newStatus) {
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, 'status는 필수입니다.');
    }

    const validStatuses = ['PENDING', 'RESERVED', 'COMPLETED', 'ISSUE'];
    if (!validStatuses.includes(newStatus)) {
      return error(res, ErrorCodes.VALIDATION_ERROR, 400, '유효하지 않은 status 값입니다.');
    }

    const task = await ServiceTask.findByPk(id);
    if (!task) {
      return error(res, ErrorCodes.NOT_FOUND, 404, '서비스 태스크를 찾을 수 없습니다.');
    }

    // 상태 전환 규칙 검증
    const transitions = {
      PENDING:   ['RESERVED', 'COMPLETED', 'ISSUE'],
      RESERVED:  ['COMPLETED', 'ISSUE'],
      ISSUE:     ['RESERVED', 'COMPLETED'],
      COMPLETED: ['PENDING', 'RESERVED', 'ISSUE'] // 관리자만 역방향 허용
    };

    if (!transitions[task.status]?.includes(newStatus)) {
      return error(
        res,
        ErrorCodes.VALIDATION_ERROR,
        400,
        `${task.status} → ${newStatus} 전환은 허용되지 않습니다.`
      );
    }

    const prevStatus = task.status;
    const updateData = { status: newStatus };
    let clearedVendor = null;

    // RESERVED: 업체 정보 + 견적 금액 저장
    if (newStatus === 'RESERVED') {
      if (vendorName      !== undefined) updateData.vendorName      = vendorName;
      if (vendorContact   !== undefined) updateData.vendorContact   = vendorContact;
      if (vendorRefNo     !== undefined) updateData.vendorRefNo     = vendorRefNo;
      if (reservedAmount  !== undefined) updateData.reservedAmount  = reservedAmount;
    }

    // COMPLETED: 실제 청구 금액 저장
    if (newStatus === 'COMPLETED') {
      if (actualAmount !== undefined) updateData.actualAmount = actualAmount;
    }

    // ISSUE: 이슈 내용 메모 저장
    if (newStatus === 'ISSUE') {
      if (issueNote !== undefined) updateData.issueNote = issueNote;
    }

    // PENDING 복귀 시 업체 정보 + 금액 + 이슈 메모 초기화 (기존 값은 로그에 보존)
    if (newStatus === 'PENDING') {
      clearedVendor = {
        name:           task.vendorName,
        contact:        task.vendorContact,
        refNo:          task.vendorRefNo,
        reservedAmount: task.reservedAmount,
        actualAmount:   task.actualAmount
      };
      updateData.vendorName      = null;
      updateData.vendorContact   = null;
      updateData.vendorRefNo     = null;
      updateData.reservedAmount  = null;
      updateData.actualAmount    = null;
      updateData.issueNote       = null;
    }

    await task.update(updateData);

    // 상태 변경 이력 기록
    await ServiceTaskLog.createLog({
      serviceTaskId: task.id,
      contractId:    task.contractId,
      fromStatus:    prevStatus,
      toStatus:      newStatus,
      adminId:       req.admin.id,
      adminName:     req.admin.name,
      clearedVendor,
      note:          newStatus === 'ISSUE' ? (issueNote ?? note ?? null) : (note ?? null),
      req
    });

    return updated(res, {
      id: task.id,
      status: task.status,
      vendorName: task.vendorName,
      vendorContact: task.vendorContact,
      vendorRefNo: task.vendorRefNo,
      reservedAmount: task.reservedAmount,
      actualAmount: task.actualAmount,
      issueNote: task.issueNote,
      updatedAt: task.updatedAt
    });
  } catch (err) {
    console.error('서비스 태스크 상태 변경 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 알림 큐 누락 계약 조회
 * GET /api/admin/notification-queue/missing
 *
 * DB 상태 기준으로 큐에 있어야 할 알림이 없는 계약을 반환
 */
const getMissingNotificationQueue = async (req, res) => {
  try {
    const { notificationQueue, getFireAt } = require('../queues/notificationQueue');
    const { Contract } = require('../models');
    const { Op } = require('sequelize');
    const now = new Date();

    // 1. 큐에 있어야 할 계약 조회
    const [paymentCompletedContracts, confirmedContracts] = await Promise.all([
      // PAYMENT_COMPLETED: checkin-today, option-deadline 대상
      Contract.findAll({
        where: {
          status: 'PAYMENT_COMPLETED',
          checkInDate: { [Op.gt]: now }
        },
        attributes: ['id', 'status', 'checkInDate', 'checkOutDate']
      }),
      // CONFIRMED / IN_PROGRESS: checkout-reminder, checkout-today 대상
      Contract.findAll({
        where: {
          status: { [Op.in]: ['CONFIRMED', 'IN_PROGRESS'] },
          checkOutDate: { [Op.gt]: now }
        },
        attributes: ['id', 'status', 'checkInDate', 'checkOutDate']
      })
    ]);

    // 2. 이미 발송된 알림톡 로그 조회 (알림톡이 있는 타입만: checkin-today, checkout-today)
    // checkout-reminder, option-deadline은 앱 푸시만 발송하므로 AlimtalkLog 없음
    const { AlimtalkLog } = require('../models');
    const allContractIds = [
      ...paymentCompletedContracts.map(c => c.id),
      ...confirmedContracts.map(c => c.id)
    ];

    const sentLogs = await AlimtalkLog.findAll({
      where: {
        contractId: { [Op.in]: allContractIds },
        eventName: { [Op.in]: ['checkin_today_guest', 'checkout_eve_guest', 'checkout_today_guest'] },
        status: 'SUCCESS'
      },
      attributes: ['contractId', 'eventName']
    });

    // { contractId: Set<eventName> } 형태로 변환
    const sentMap = {};
    for (const log of sentLogs) {
      if (!sentMap[log.contractId]) sentMap[log.contractId] = new Set();
      sentMap[log.contractId].add(log.eventName);
    }

    // queue type → alimtalk eventName 매핑 (알림톡 있는 타입만)
    const typeToEventName = {
      'checkin-today': 'checkin_today_guest',
      'checkout-eve': 'checkout_eve_guest',
      'checkout-today': 'checkout_today_guest'
      // 'option-deadline', 'checkout-reminder': 알림톡 없음 → AlimtalkLog 확인 불가
    };

    // 3. 각 계약별 jobId 존재 여부 확인 (발송 완료된 것은 제외)
    const missing = [];

    for (const contract of paymentCompletedContracts) {
      const checks = [
        { type: 'checkin-today', condition: new Date(contract.checkInDate) > now },
        {
          type: 'option-deadline',
          condition: (() => {
            const d = new Date(contract.checkInDate);
            d.setDate(d.getDate() - 6);
            return d > now;
          })()
        }
      ];

      for (const { type, condition } of checks) {
        if (!condition) continue;
        const alreadySent = sentMap[contract.id]?.has(typeToEventName[type]);
        if (alreadySent) continue;
        const job = await notificationQueue.getJob(`${type}-${contract.id}`);
        if (!job) {
          const fireAt = getFireAt(type, contract.checkInDate, contract.checkOutDate);
          missing.push({
            contractId: contract.id,
            status: contract.status,
            missingType: type,
            checkInDate: toKSTString(contract.checkInDate),
            checkOutDate: toKSTString(contract.checkOutDate),
            fireAt: fireAt ? fireAt.toISOString() : null
          });
        }
      }
    }

    for (const contract of confirmedContracts) {
      const eveDate = new Date(contract.checkOutDate);
      eveDate.setDate(eveDate.getDate() - 1);
      const reminderDate = new Date(contract.checkOutDate);
      reminderDate.setDate(reminderDate.getDate() - 3);

      const checks = [
        { type: 'checkout-reminder', condition: reminderDate > now },
        { type: 'checkout-eve', condition: eveDate > now },
        { type: 'checkout-today', condition: new Date(contract.checkOutDate) > now }
      ];

      for (const { type, condition } of checks) {
        if (!condition) continue;
        const alreadySent = sentMap[contract.id]?.has(typeToEventName[type]);
        if (alreadySent) continue;
        const job = await notificationQueue.getJob(`${type}-${contract.id}`);
        if (!job) {
          const fireAt = getFireAt(type, contract.checkInDate, contract.checkOutDate);
          missing.push({
            contractId: contract.id,
            status: contract.status,
            missingType: type,
            checkInDate: toKSTString(contract.checkInDate),
            checkOutDate: toKSTString(contract.checkOutDate),
            fireAt: fireAt ? fireAt.toISOString() : null
          });
        }
      }
    }

    return success(res, {
      missingCount: missing.length,
      missing
    }, missing.length > 0 ? `누락된 알림 ${missing.length}건이 있습니다.` : '누락된 알림이 없습니다.');
  } catch (err) {
    console.error('알림 큐 누락 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 누락 알림 단건 복구 (관리자 수동 큐 적재)
 * POST /api/admin/notification-queue/recover
 */
const recoverNotificationQueue = async (req, res) => {
  try {
    const { contractId, type } = req.body;

    if (!contractId || !type) {
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400);
    }

    const validTypes = ['checkin-today', 'option-deadline', 'checkout-reminder', 'checkout-eve', 'checkout-today'];
    if (!validTypes.includes(type)) {
      return error(res, ErrorCodes.INVALID_INPUT, 400, { message: `유효하지 않은 type입니다. 가능한 값: ${validTypes.join(', ')}` });
    }

    const { Contract, AlimtalkLog } = require('../models');
    const { Op } = require('sequelize');

    const contract = await Contract.findByPk(contractId, {
      attributes: ['id', 'status', 'checkInDate', 'checkOutDate']
    });

    if (!contract) {
      return error(res, ErrorCodes.CONTRACT_NOT_FOUND, 404);
    }

    // 알림톡 로그 있는 타입은 이미 발송 완료 여부 확인
    const typeToEventName = {
      'checkin-today': 'checkin_today_guest',
      'checkout-eve': 'checkout_eve_guest',
      'checkout-today': 'checkout_today_guest'
    };
    const eventName = typeToEventName[type];
    if (eventName) {
      const alreadySent = await AlimtalkLog.findOne({
        where: { contractId, eventName, status: 'SUCCESS' }
      });
      if (alreadySent) {
        return error(res, ErrorCodes.INVALID_INPUT, 400, { message: '이미 발송 완료된 알림입니다.' });
      }
    }

    const { recoverNotification } = require('../queues/notificationQueue');
    const result = await recoverNotification(contractId, type, contract.checkInDate, contract.checkOutDate);

    if (!result.queued) {
      const messages = {
        already_past: '발송 시점이 이미 지났습니다.',
        already_queued: '이미 큐에 등록되어 있습니다.',
        unknown_type: '알 수 없는 알림 타입입니다.'
      };
      return error(res, ErrorCodes.INVALID_INPUT, 400, {
        message: messages[result.reason] || result.reason,
        fireAt: result.fireAt
      });
    }

    return success(res, {
      contractId,
      type,
      fireAt: result.fireAt
    }, '알림 큐에 적재되었습니다.');
  } catch (err) {
    console.error('알림 큐 복구 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 알림 큐 전체 현황 조회
 * GET /api/admin/notification-queue/stats
 */
const getNotificationQueueStats = async (req, res) => {
  try {
    const { getQueueStats, notificationQueue } = require('../queues/notificationQueue');

    const stats = await getQueueStats();

    // delayed job 목록 상세 조회
    const delayed = await notificationQueue.getDelayed();
    const jobs = delayed.map(job => ({
      jobId: job.id,
      type: job.name,
      contractId: job.data.contractId,
      scheduledAt: job.data.scheduledAt || new Date(job.timestamp + job.opts.delay).toISOString(),
      fireAt: new Date(job.timestamp + job.opts.delay).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
      remainingMs: job.timestamp + job.opts.delay - Date.now()
    }));

    // type별 그룹핑
    const byType = jobs.reduce((acc, job) => {
      acc[job.type] = acc[job.type] || [];
      acc[job.type].push(job);
      return acc;
    }, {});

    return success(res, { stats, jobs, byType }, '알림 큐 현황을 조회했습니다.');
  } catch (err) {
    console.error('알림 큐 현황 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 특정 계약의 예약된 알림 조회
 * GET /api/admin/notification-queue/contract/:contractId
 */
const getContractNotificationQueue = async (req, res) => {
  try {
    const { contractId } = req.params;
    const { getScheduledNotifications } = require('../queues/notificationQueue');

    const scheduled = await getScheduledNotifications(contractId);

    return success(res, { contractId: parseInt(contractId), scheduled }, '계약 알림 큐를 조회했습니다.');
  } catch (err) {
    console.error('계약 알림 큐 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

module.exports = {
  // 대시보드
  getDashboardStats,
  getRecentActivities,

  // 유저 관리
  getUsers,
  getUserDetail,
  updateUserStatus,

  // 매물 관리
  getProperties,
  getPendingReviews,
  getPropertyDetail,
  approveProperty,
  rejectProperty,

  // 방 정보 관리 (관리자 전용)
  getRoomManagementDetail,
  updateRoomStatus,
  getRoomStatusHistory,
  updateRoomPassword,
  getRoomPasswordHistory,
  createRoomMemo,
  updateRoomMemo,
  deleteRoomMemo,

  // 예약 관리
  getCancelRequests,
  getReservations,
  getReservationDetail,
  adminForceCancel,
  approveHostCancelRequest,
  rejectHostCancelRequest,

  // 환불 관리
  getRefunds,
  getRefundDetail,
  approveRefund,
  rejectRefund,

  // 렌탈 주문 관리
  getRentalOrders,
  getRentalOrderDetail,
  getContractRentalHistory,
  // adminCancelRentalOrder, // DEPRECATED: /rental-payments/:rentalOrderId/refund 로 대체
  updateRentalOrderDeliveryStatus,

  // 보증금 보류 관리
  getDepositHolds,
  getDepositHoldDetail,
  getPendingDepositHolds,
  approveDepositHold,
  rejectDepositHold,
  forceDepositHold,
  retryDepositRefund,

  // 서비스 태스크 관리
  getServiceTasks,
  getServiceTask,
  updateServiceTaskStatus,

  // 알림톡 관리
  getAlimtalkTemplates,
  syncAlimtalkTemplates,
  getAlimtalkLogs,
  getAlimtalkStats,
  retryAlimtalkLog,

  // 알림 큐 관리
  getNotificationQueueStats,
  getContractNotificationQueue,
  getMissingNotificationQueue,
  recoverNotificationQueue
};
