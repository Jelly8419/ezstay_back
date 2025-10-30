const { success, error, ErrorCodes } = require('../utils/responseHelper');
const { User, Room, Contract, RoomPhoto } = require('../models');
const { Op } = require('sequelize');
const sequelize = require('sequelize');
const { invalidateRoomCache } = require('../utils/cacheInvalidation');

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

    // 미답변 문의 수 (TODO: 문의 모델 구현 후 적용)
    const pendingInquiries = 0; // 임시값

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
          model: Room,
          as: 'rooms',
          attributes: ['id', 'roomName', 'status', 'createdAt']
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

    return success(res, {
      ...user.toJSON(),
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

    const room = await Room.findByPk(roomId, {
      // 관리자는 모든 정보를 볼 수 있음 (민감정보 포함)
      include: [
        {
          model: User,
          as: 'host',
          attributes: ['id', 'name', 'email', 'phoneNumber', 'profileImageUrl'],
          required: false
        },
        {
          model: RoomPhoto,
          as: 'photos',
          attributes: ['id', 'photoUrl', 'displayOrder'],
          required: false,
          separate: true, // N+1 방지
          order: [['displayOrder', 'ASC']]
        },
        {
          model: require('../models').RoomAmenity,
          as: 'amenity',
          required: false
        },
        {
          model: require('../models').RoomFreeService,
          as: 'freeService',
          required: false
        }
      ]
    });

    if (!room) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    // BASE_URL 추가 (사진 URL)
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const roomData = room.toJSON();

    if (roomData.photos && roomData.photos.length > 0) {
      roomData.photos = roomData.photos.map(photo => ({
        ...photo,
        photoUrl: photo.photoUrl.startsWith('http')
          ? photo.photoUrl
          : `${baseUrl}${photo.photoUrl}`
      }));
    }

    return success(res, roomData, '매물 상세 조회 성공');
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
