const { success, error, ErrorCodes } = require('../utils/responseHelper');
const { User, Room, Contract, RoomPhoto, RoomAmenity, RoomFreeService, UserBankAccount, Inquiry } = require('../models');
const { Op } = require('sequelize');
const sequelize = require('sequelize');
const { invalidateRoomCache } = require('../utils/cacheInvalidation');
const { calculateProgress } = require('../utils/roomProgress');

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

    // 이번 달 매출 (결제 완료된 계약의 총 금액)
    const monthlyRevenue = await Contract.sum('finalTotalAmount', {
      where: {
        status: { [Op.in]: ['PAYMENT_COMPLETED', 'IN_PROGRESS', 'COMPLETED'] },
        paidAt: { [Op.between]: [firstDayThisMonth, now] }
      }
    }) || 0;

    // 지난 달 매출
    const lastMonthRevenue = await Contract.sum('finalTotalAmount', {
      where: {
        status: { [Op.in]: ['PAYMENT_COMPLETED', 'IN_PROGRESS', 'COMPLETED'] },
        paidAt: { [Op.between]: [firstDayLastMonth, lastDayLastMonth] }
      }
    }) || 0;

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
      monthlyRevenue: Math.round(monthlyRevenue),
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
          attributes: ['id', 'name', 'email']
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
      attributes: { exclude: ['refreshToken'] }
    });

    return success(res, {
      users,
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
        }
      ]
    });

    if (!user) {
      return error(res, ErrorCodes.USER_NOT_FOUND, 404);
    }

    // 호스트인 경우 등록한 방 개수
    const hostRoomsCount = await Room.count({ where: { hostId: userId } });

    // 게스트인 경우 예약 횟수
    const guestReservationsCount = await Contract.count({ where: { guestId: userId } });

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

    // 응답 데이터 구성
    const userData = user.toJSON();
    delete userData.localProfile;
    delete userData.socialProfiles;

    return success(res, {
      ...userData,
      accountTypeDetail,
      hasVerifiedBankAccount,
      hostRoomsCount,
      guestReservationsCount
    }, '유저 상세 조회 성공');
  } catch (err) {
    console.error('유저 상세 조회 실패:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 유저 상태 변경 (활성/비활성)
 * PATCH /api/admin/users/:userId/status
 */
const updateUserStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return error(res, ErrorCodes.VALIDATION_ERROR, 400);
    }

    const user = await User.findByPk(userId);
    if (!user) {
      return error(res, ErrorCodes.USER_NOT_FOUND, 404);
    }

    user.isActive = isActive;
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
          attributes: ['id', 'name', 'email', 'phoneNumber']
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
          attributes: ['id', 'name', 'email', 'phoneNumber']
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

    room.status = 'approved';
    room.approvedAt = new Date();
    await room.save();

    // 캐시 무효화 (ETag 버전 증가)
    await invalidateRoomCache();

    // TODO: 호스트에게 승인 알림 전송

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

    room.status = 'rejected';
    room.rejectionReason = rejectionReason;
    await room.save();

    // 캐시 무효화 (ETag 버전 증가)
    await invalidateRoomCache();

    // TODO: 호스트에게 반려 알림 전송

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
          model: RoomFreeService,
          as: 'freeService'
        },
        {
          model: User,
          as: 'host',
          attributes: ['id', 'name', 'email', 'phoneNumber', 'phoneVerified'],
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
      livingRoomCount: room.livingRoomCount,
      kitchenCount: room.kitchenCount,
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
      minContractWeeks: room.minContractWeeks,
      refundPolicy: room.refundPolicy,

      // 사진
      photos: room.photos.map(photo => ({
        id: photo.id,
        url: photo.url,
        order: photo.order
      })),

      // 편의시설
      amenities: room.amenity ? {
        basicOptions: room.amenity.basicOptions,
        additionalOptions: room.amenity.additionalOptions,
        convenienceOptions: room.amenity.convenienceOptions,
        petsAllowed: room.amenity.petsAllowed
      } : null,

      // 무료 부가서비스
      freeServices: room.freeService ? {
        agreeTerms: room.freeService.agreeTerms,
        cleaningService: room.freeService.cleaningService,
        cleaningToolImageUrl: room.freeService.cleaningToolImageUrl,
        hairDryerRental: room.freeService.hairDryerRental,
        beddingService: room.freeService.beddingService,
        bedSizes: {
          '슈퍼싱글': room.freeService.bedSizeSuperSingle,
          '퀸': room.freeService.bedSizeQueen,
          '킹': room.freeService.bedSizeKing
        },
        amenityKit: room.freeService.amenityKit,
        autoPasswordChange: room.freeService.autoPasswordChange,
        roomPassword: room.freeService.roomPassword
      } : null,

      // 방 소개
      description: room.description,
      transportation: room.transportation,
      houseRules: room.houseRules,

      // 상태
      status: room.status,
      submittedAt: room.submittedAt,
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
        attributes: ['id', 'name', 'email', 'phoneNumber']
      },
      {
        model: User,
        as: 'host',
        attributes: ['id', 'name', 'email']
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
            }
          ]
        }
      ]
    });

    if (!reservation) {
      return error(res, {
        code: 3005,
        message: '예약을 찾을 수 없습니다.'
      }, 404);
    }

    return success(res, reservation, '예약 상세 조회 성공');
  } catch (err) {
    console.error('예약 상세 조회 실패:', err);
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
  getPropertyDetail,  // ✅ 추가
  approveProperty,
  rejectProperty,

  // 예약 관리
  getReservations,
  getReservationDetail
};
