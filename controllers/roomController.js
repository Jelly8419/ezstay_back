const { Room, RoomPhoto, RoomAmenity, RoomFreeService, User, RentalItem } = require('../models');
const { Op } = require('sequelize');
const { ErrorCodes, success, error, created } = require('../utils/responseHelper');
const { safeRedisOperation } = require('../config/redis');
const crypto = require('crypto');

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
        exclude: ['entrancePassword', 'detailAddress', 'status'] // 민감정보 제외 (hostId는 포함)
      },
      include: [
        {
          model: RoomPhoto,
          as: 'photos',
          attributes: ['id', 'url', 'order'],
          required: false
        },
        {
          model: RoomAmenity,
          as: 'amenity',
          required: false
        },
        {
          model: RoomFreeService,
          as: 'freeService',
          required: false
        },
        {
          model: User,
          as: 'host',
          attributes: ['id', 'name', 'profileImageUrl'],
          required: false
        }
      ],
      order: [
        [{ model: RoomPhoto, as: 'photos' }, 'order', 'ASC']
      ]
    });
    if (!room) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    // photos URL에 BASE_URL 추가
    const baseUrl = process.env.BASE_URL || 'http://localhost:8080';
    const roomData = room.toJSON();
    if (roomData.photos && roomData.photos.length > 0) {
      roomData.photos = roomData.photos.map(photo => ({
        ...photo,
        url: `${baseUrl}${photo.url}`
      }));
    }

    // 호스트 프로필 이미지 URL에 BASE_URL 추가
    if (roomData.host && roomData.host.profileImageUrl) {
      roomData.host.profileImageUrl = `${baseUrl}${roomData.host.profileImageUrl}`;
    }

    // hostId는 응답에서 제외 (host 객체로 대체)
    delete roomData.hostId;

    // === 대여 물품 재고 정보 추가 ===
    // freeService에서 true인 항목에 대해서만 해당 카테고리의 물품 목록 조회
    const availableRentalItems = {};

    if (roomData.freeService) {
      const freeService = roomData.freeService;

      // RentalItem.FREE_SERVICE_MAPPING을 참조하여 해당하는 물품 조회
      // hair_dryer_rental: true → 'hair_dryer' 카테고리 물품 조회
      if (freeService.hairDryerRental) {
        const hairDryers = await RentalItem.getAvailableItemsByType('hair_dryer');
        if (hairDryers.length > 0) {
          availableRentalItems.hairDryers = hairDryers.map(item => ({
            id: item.id,
            name: item.name,
            description: item.description,
            price: parseFloat(item.price),
            availableStock: item.availableStock,
            imageUrl: item.imageUrl
          }));
        }
      }

      // bedding_service: true → 'bedding_set' 카테고리 물품 조회
      if (freeService.beddingService) {
        const beddingSets = await RentalItem.getAvailableItemsByType('bedding_set');
        if (beddingSets.length > 0) {
          availableRentalItems.beddingSets = beddingSets.map(item => ({
            id: item.id,
            name: item.name,
            description: item.description,
            price: parseFloat(item.price),
            availableStock: item.availableStock,
            imageUrl: item.imageUrl
          }));
        }
      }

      // amenity_kit: true → 'amenity_kit' 카테고리 물품 조회
      if (freeService.amenityKit) {
        const amenityKits = await RentalItem.getAvailableItemsByType('amenity_kit');
        if (amenityKits.length > 0) {
          availableRentalItems.amenityKits = amenityKits.map(item => ({
            id: item.id,
            name: item.name,
            description: item.description,
            price: parseFloat(item.price),
            availableStock: item.availableStock,
            imageUrl: item.imageUrl
          }));
        }
      }

      // towel_set_rental: true → 'towel_set' 카테고리 물품 조회
      if (freeService.towelSetRental) {
        const towelSets = await RentalItem.getAvailableItemsByType('towel_set');
        if (towelSets.length > 0) {
          availableRentalItems.towelSets = towelSets.map(item => ({
            id: item.id,
            name: item.name,
            description: item.description,
            price: parseFloat(item.price),
            availableStock: item.availableStock,
            imageUrl: item.imageUrl
          }));
        }
      }
    }

    // 대여 가능한 물품이 있을 경우에만 추가
    if (Object.keys(availableRentalItems).length > 0) {
      roomData.availableRentalItems = availableRentalItems;
    }
    // === 대여 물품 재고 정보 추가 끝 ===

    return success(res, roomData);
  } catch (err) {
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 지도 영역 내 방 목록 조회 (카카오맵 클러스터링용 + Redis 캐싱 + HTTP 캐싱 + 사전 캐싱)
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

    // === Phase 1: ETag 생성 및 HTTP 캐싱 ===
    const coordString = `${swLat},${swLng},${neLat},${neLng},${zoom || 'default'}`;
    const coordHash = crypto.createHash('md5').update(coordString).digest('hex').substring(0, 16);

    // 데이터 버전 조회 (매물 변경 시 증가)
    const dataVersion = await safeRedisOperation(async (client) => {
      return await client.get('rooms:data:version');
    }) || '1';

    const etag = `"${coordHash}-v${dataVersion}"`;

    // 클라이언트 ETag 확인 (브라우저 캐시 검증)
    if (req.headers['if-none-match'] === etag) {
      console.log('✅ HTTP 304 Not Modified - 브라우저 캐시 사용');
      return res.status(304).end(); // 데이터 전송 없음
    }
    // === Phase 1 끝 ===

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

      // HTTP 캐싱 헤더 설정
      res.set({
        'ETag': etag,
        'Cache-Control': 'public, max-age=60, must-revalidate', // 1분 브라우저 캐시
        'Vary': 'Accept-Encoding'
      });

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
        'dailyRent',
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
      dailyRent: room.dailyRent,
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

    // === Phase 2: 서버 사이드 사전 캐싱 (비동기) ===
    // 인접 영역 사전 캐싱 (응답 지연 없음)
    setImmediate(() => {
      prefetchAdjacentAreas(swLatNum, swLngNum, neLatNum, neLngNum, zoom).catch(err => {
        console.error('사전 캐싱 실패:', err.message);
      });
    });
    // === Phase 2 끝 ===

    // HTTP 캐싱 헤더 설정
    res.set({
      'ETag': etag,
      'Cache-Control': 'public, max-age=60, must-revalidate', // 1분 브라우저 캐시
      'Vary': 'Accept-Encoding'
    });

    return success(res, responseData, '지도 영역 내 방 목록을 조회했습니다.');

  } catch (err) {
    console.error('getRoomsForMap Error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 인접 8방향 영역 사전 캐싱
 * @param {number} swLat - 현재 영역 남서쪽 위도
 * @param {number} swLng - 현재 영역 남서쪽 경도
 * @param {number} neLat - 현재 영역 북동쪽 위도
 * @param {number} neLng - 현재 영역 북동쪽 경도
 * @param {string} zoom - 줌 레벨
 */
async function prefetchAdjacentAreas(swLat, swLng, neLat, neLng, zoom) {
  const latDiff = neLat - swLat;
  const lngDiff = neLng - swLng;

  // 인접 8방향 영역 계산
  const adjacentAreas = [
    // 북
    { swLat: swLat + latDiff, swLng, neLat: neLat + latDiff, neLng },
    // 남
    { swLat: swLat - latDiff, swLng, neLat: neLat - latDiff, neLng },
    // 동
    { swLat, swLng: swLng + lngDiff, neLat, neLng: neLng + lngDiff },
    // 서
    { swLat, swLng: swLng - lngDiff, neLat, neLng: neLng - lngDiff },
    // 북동 (대각선)
    { swLat: swLat + latDiff, swLng: swLng + lngDiff, neLat: neLat + latDiff, neLng: neLng + lngDiff },
    // 북서
    { swLat: swLat + latDiff, swLng: swLng - lngDiff, neLat: neLat + latDiff, neLng: neLng - lngDiff },
    // 남동
    { swLat: swLat - latDiff, swLng: swLng + lngDiff, neLat: neLat - latDiff, neLng: neLng + lngDiff },
    // 남서
    { swLat: swLat - latDiff, swLng: swLng - lngDiff, neLat: neLat - latDiff, neLng: neLng - lngDiff }
  ];

  // 병렬로 사전 캐싱 (캐시 없는 경우만 DB 조회)
  const prefetchPromises = adjacentAreas.map(area =>
    cacheAreaIfNotExists(area, zoom)
  );

  await Promise.all(prefetchPromises);
  console.log(`💾 인접 8방향 사전 캐싱 완료 (zoom: ${zoom})`);
}

/**
 * 특정 영역의 캐시가 없으면 DB 조회 후 캐싱
 * @param {object} area - 영역 좌표 (swLat, swLng, neLat, neLng)
 * @param {string} zoom - 줌 레벨
 */
async function cacheAreaIfNotExists(area, zoom) {
  const roundedSwLat = area.swLat.toFixed(4);
  const roundedSwLng = area.swLng.toFixed(4);
  const roundedNeLat = area.neLat.toFixed(4);
  const roundedNeLng = area.neLng.toFixed(4);

  const cacheKey = `rooms:map:${roundedSwLat},${roundedSwLng},${roundedNeLat},${roundedNeLng}:zoom${zoom || 'default'}`;

  // 캐시 존재 여부 확인
  const exists = await safeRedisOperation(async (client) => {
    return await client.exists(cacheKey);
  });

  if (exists) {
    console.log('⏭️  이미 캐시됨:', cacheKey);
    return; // 이미 캐시되어 있으면 스킵
  }

  // DB 조회 후 캐싱
  try {
    const rooms = await Room.findAll({
      where: {
        status: 'published',
        latitude: {
          [Op.between]: [parseFloat(area.swLat), parseFloat(area.neLat)],
          [Op.ne]: null
        },
        longitude: {
          [Op.between]: [parseFloat(area.swLng), parseFloat(area.neLng)],
          [Op.ne]: null
        }
      },
      attributes: [
        'id', 'roomName', 'address', 'latitude', 'longitude',
        'dailyRent', 'area', 'roomCount', 'bathroomCount', 'buildingType'
      ],
      include: [{
        model: RoomPhoto,
        as: 'photos',
        attributes: ['id', 'url'],
        limit: 1,
        required: false,
        separate: true,
        order: [['order', 'ASC']]
      }],
      limit: 500,
      order: [['created_at', 'DESC']]
    });

    const mapData = rooms.map(room => ({
      id: room.id,
      roomName: room.roomName,
      address: room.address,
      latitude: parseFloat(room.latitude),
      longitude: parseFloat(room.longitude),
      dailyRent: room.dailyRent,
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

    // 10분 TTL로 캐싱 (인접 영역은 더 길게)
    await safeRedisOperation(async (client) => {
      await client.setEx(cacheKey, 600, JSON.stringify(responseData));
    });

    console.log('✨ 사전 캐싱 완료:', cacheKey, `(${mapData.length}개)`);
  } catch (err) {
    console.error('사전 캐싱 실패:', cacheKey, err.message);
  }
}

module.exports = {
  createRoom,
  getRooms,
  getRoomById,
  getRoomsForMap
};