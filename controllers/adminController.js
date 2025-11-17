const { success, error, ErrorCodes } = require('../utils/responseHelper');
const { User, Room, Contract, RoomPhoto, RoomAmenity, RoomFreeService, UserBankAccount, Inquiry, RoomMemo, Admin, RoomPasswordHistory, RoomStatusHistory, sequelize } = require('../models');
const { Op } = require('sequelize');
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
        cleaningService: room.freeService.cleaningService,
        hairDryerRental: room.freeService.hairDryerRental,
        beddingService: room.freeService.beddingService,
        amenityKit: room.freeService.amenityKit,
        towelSetRental: room.freeService.towelSetRental,
        autoPasswordChange: room.freeService.autoPasswordChange,
        roomPassword: room.freeService.roomPassword
      } : null,

      // 방 소개
      description: room.description,
      maxGuests: room.maxGuests,

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
          attributes: ['id', 'name', 'email', 'phoneNumber']
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
              attributes: ['id', 'name', 'phoneNumber']
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
        checkInDate: contract.checkInDate,
        checkOutDate: contract.checkOutDate,
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
  getReservations,
  getReservationDetail
};
