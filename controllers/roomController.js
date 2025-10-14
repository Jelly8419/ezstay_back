const { Room, RoomPhoto } = require('../models');
const { Op } = require('sequelize');
const { ErrorCodes, success, error, created } = require('../utils/responseHelper');
const { safeRedisOperation } = require('../config/redis');

const createRoom = async (req, res) => {
  try {
    const {
      roomName,
      address,
      detailAddress,
      area,
      buildingType,
      parkingAvailable,
      elevatorAvailable,
      roomCount,
      bathroomCount,
      livingRoomCount,
      kitchenCount,
      isDuplex,
      hostId
    } = req.body;

    const savedRoom = await Room.create({
      roomName,
      address,
      detailAddress,
      area,
      buildingType,
      parkingAvailable,
      elevatorAvailable,
      roomCount,
      bathroomCount,
      livingRoomCount,
      kitchenCount,
      isDuplex,
      hostId
    });

    return created(res, savedRoom, '방이 성공적으로 등록되었습니다.');
  } catch (err) {
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

const getRooms = async (req, res) => {
  try {
    const rooms = await Room.findAll({
      where: { status: 'published' }, // 게시된 방만 조회
      attributes: {
        exclude: ['entrancePassword', 'hostId', 'detailAddress', 'status'] // 민감정보 제외
      }
    });
    return success(res, rooms);
  } catch (err) {
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

const getRoomById = async (req, res) => {
  try {
    const room = await Room.findOne({
      where: {
        id: req.params.id,
        status: 'published' // 게시된 방만 조회
      },
      attributes: {
        exclude: ['entrancePassword', 'hostId', 'detailAddress', 'status'] // 민감정보 제외
      }
    });
    if (!room) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }
    return success(res, room);
  } catch (err) {
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 지도 영역 내 방 목록 조회 (카카오맵 클러스터링용 + Redis 캐싱)
 * @route GET /api/rooms/map
 * @query {number} swLat - 남서쪽 위도 (Southwest Latitude)
 * @query {number} swLng - 남서쪽 경도 (Southwest Longitude)
 * @query {number} neLat - 북동쪽 위도 (Northeast Latitude)
 * @query {number} neLng - 북동쪽 경도 (Northeast Longitude)
 * @query {number} [zoom] - 줌 레벨 (1-14, 작을수록 넓은 영역)
 * @query {number} [limit] - 최대 조회 개수 (zoom에 따라 자동 설정)
 */
const getRoomsForMap = async (req, res) => {
  try {
    const { swLat, swLng, neLat, neLng, zoom } = req.query;

    // 줌 레벨 6 이상(너무 축소된 상태)일 때는 매물을 보여주지 않음
    if (zoom) {
      const zoomLevel = parseInt(zoom);
      if (zoomLevel >= 6) {
        return success(res, {
          count: 0,
          rooms: [],
          message: '지도를 더 확대해주세요.'
        }, '지도를 더 확대하면 매물을 확인할 수 있습니다.');
      }
    }

    // 줌 레벨에 따른 limit 자동 설정
    // 카카오맵: 줌 레벨이 작을수록 상세(확대), 클수록 넓은 영역(축소)
    let limit = 500; // 기본값
    if (zoom) {
      const zoomLevel = parseInt(zoom);
      if (zoomLevel >= 5) {
        limit = 200; // 중간 영역 (동 레벨)
      } else if (zoomLevel >= 3) {
        limit = 300; // 좁은 영역
      } else {
        limit = 500; // 상세 영역 (거리/건물 레벨)
      }
    }

    // 사용자 지정 limit이 있으면 우선 적용 (단, 최대 500개로 제한)
    if (req.query.limit) {
      limit = Math.min(parseInt(req.query.limit), 500);
    }

    // 필수 파라미터 검증
    if (!swLat || !swLng || !neLat || !neLng) {
      return error(res, {
        code: 4001,
        message: '지도 영역 좌표가 필요합니다. (swLat, swLng, neLat, neLng)'
      }, 400);
    }

    // 좌표 유효성 검증
    const swLatNum = parseFloat(swLat);
    const swLngNum = parseFloat(swLng);
    const neLatNum = parseFloat(neLat);
    const neLngNum = parseFloat(neLng);

    if (isNaN(swLatNum) || isNaN(swLngNum) || isNaN(neLatNum) || isNaN(neLngNum)) {
      return error(res, {
        code: 4002,
        message: '좌표는 숫자 형식이어야 합니다.'
      }, 400);
    }

    // 위도/경도 범위 검증
    if (swLatNum < -90 || swLatNum > 90 || neLatNum < -90 || neLatNum > 90) {
      return error(res, {
        code: 4003,
        message: '위도는 -90 ~ 90 범위여야 합니다.'
      }, 400);
    }

    if (swLngNum < -180 || swLngNum > 180 || neLngNum < -180 || neLngNum > 180) {
      return error(res, {
        code: 4004,
        message: '경도는 -180 ~ 180 범위여야 합니다.'
      }, 400);
    }

    // === Redis 캐싱 로직 시작 ===
    // 캐시 키는 정확한 검색 영역(4개 좌표)으로 생성하여 부정확한 캐시 히트 방지
    // 소수점 4자리로 반올림 (약 11m 정밀도, 캐시 효율성 증가)
    const roundedSwLat = swLatNum.toFixed(4);
    const roundedSwLng = swLngNum.toFixed(4);
    const roundedNeLat = neLatNum.toFixed(4);
    const roundedNeLng = neLngNum.toFixed(4);

    const cacheKey = `rooms:map:${roundedSwLat},${roundedSwLng},${roundedNeLat},${roundedNeLng}:zoom${zoom || 'default'}`;

    // Redis 캐시 확인
    const cachedData = await safeRedisOperation(async (client) => {
      return await client.get(cacheKey);
    });

    if (cachedData) {
      console.log('✅ Cache HIT:', cacheKey);
      const parsedData = JSON.parse(cachedData);
      return success(res, parsedData, '지도 영역 내 방 목록을 조회했습니다. (캐시)');
    }

    console.log('❌ Cache MISS:', cacheKey, '- DB 조회 중...');
    // === Redis 캐싱 로직 끝 ===

    // 좌표 범위 내 방 조회 (DB)
    const rooms = await Room.findAll({
      where: {
        status: 'published',
        latitude: {
          [Op.between]: [swLatNum, neLatNum],
          [Op.ne]: null // null 값 제외
        },
        longitude: {
          [Op.between]: [swLngNum, neLngNum],
          [Op.ne]: null // null 값 제외
        }
      },
      attributes: [
        'id',
        'roomName',
        'address',
        'latitude',
        'longitude',
        'weeklyRent',
        'area',
        'roomCount',
        'bathroomCount',
        'buildingType'
      ],
      include: [{
        model: RoomPhoto,
        as: 'photos',
        attributes: ['id', 'url'],
        limit: 1,
        required: false,
        separate: true, // N+1 문제 방지
        order: [['order', 'ASC']]
      }],
      limit: limit,
      order: [['created_at', 'DESC']]
    });

    // 응답 데이터 가공
    const mapData = rooms.map(room => ({
      id: room.id,
      roomName: room.roomName,
      address: room.address,
      latitude: parseFloat(room.latitude),
      longitude: parseFloat(room.longitude),
      weeklyRent: room.weeklyRent,
      area: parseFloat(room.area),
      roomCount: room.roomCount,
      bathroomCount: room.bathroomCount,
      buildingType: room.buildingType,
      thumbnail: room.photos && room.photos.length > 0 ? room.photos[0].url : null
    }));

    const responseData = {
      count: mapData.length,
      rooms: mapData
    };

    // === Redis 캐싱 저장 ===
    // 5분(300초) TTL로 캐싱
    await safeRedisOperation(async (client) => {
      await client.setEx(cacheKey, 300, JSON.stringify(responseData));
      console.log('💾 캐시 저장 완료:', cacheKey, '(TTL: 5분)');
    });
    // === Redis 캐싱 저장 끝 ===

    return success(res, responseData, '지도 영역 내 방 목록을 조회했습니다.');

  } catch (err) {
    console.error('getRoomsForMap Error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

module.exports = {
  createRoom,
  getRooms,
  getRoomById,
  getRoomsForMap
};