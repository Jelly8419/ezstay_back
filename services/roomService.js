const crypto = require('crypto');
const { Op } = require('sequelize');
const { Room, RoomPhoto, Contract } = require('../models');
const { safeRedisOperation } = require('../config/redis');
const appConfig = require('../config/app.config');

/**
 * Room Service Layer
 * 방 조회 관련 비즈니스 로직 처리
 */

/**
 * 날짜 범위 검증
 * @param {string} checkIn - 입실일 (YYYY-MM-DD)
 * @param {string} checkOut - 퇴실일 (YYYY-MM-DD)
 * @returns {{valid: boolean, error?: {code: number, message: string}}}
 */
const validateDateRange = (checkIn, checkOut) => {
  // 하나만 입력된 경우
  if ((checkIn && !checkOut) || (!checkIn && checkOut)) {
    return {
      valid: false,
      error: { code: 4005, message: '입실일과 퇴실일을 모두 입력해주세요.' }
    };
  }

  if (!checkIn || !checkOut) {
    return { valid: true };
  }

  const checkInDate = new Date(checkIn);
  const checkOutDate = new Date(checkOut);

  // 날짜 형식 검증
  if (isNaN(checkInDate.getTime()) || isNaN(checkOutDate.getTime())) {
    return {
      valid: false,
      error: { code: 4006, message: '유효하지 않은 날짜 형식입니다. (YYYY-MM-DD)' }
    };
  }

  // 퇴실일이 입실일보다 이후인지 검증
  if (checkInDate >= checkOutDate) {
    return {
      valid: false,
      error: { code: 4007, message: '퇴실일은 입실일보다 이후여야 합니다.' }
    };
  }

  // 과거 날짜 체크
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (checkInDate < today) {
    return {
      valid: false,
      error: { code: 4008, message: '과거 날짜로 검색할 수 없습니다.' }
    };
  }

  return { valid: true };
};

/**
 * 지도 영역 좌표 검증
 * @param {number} swLat - 남서쪽 위도
 * @param {number} swLng - 남서쪽 경도
 * @param {number} neLat - 북동쪽 위도
 * @param {number} neLng - 북동쪽 경도
 * @returns {{valid: boolean, error?: {code: number, message: string}}}
 */
const validateMapBounds = (swLat, swLng, neLat, neLng) => {
  if (!swLat || !swLng || !neLat || !neLng) {
    return {
      valid: false,
      error: { code: 4001, message: '지도 영역 좌표가 필요합니다. (swLat, swLng, neLat, neLng)' }
    };
  }

  const swLatNum = parseFloat(swLat);
  const swLngNum = parseFloat(swLng);
  const neLatNum = parseFloat(neLat);
  const neLngNum = parseFloat(neLng);

  if (isNaN(swLatNum) || isNaN(swLngNum) || isNaN(neLatNum) || isNaN(neLngNum)) {
    return {
      valid: false,
      error: { code: 4002, message: '좌표는 숫자 형식이어야 합니다.' }
    };
  }

  const { LATITUDE_MIN, LATITUDE_MAX, LONGITUDE_MIN, LONGITUDE_MAX } = appConfig.map.coordinate;

  if (swLatNum < LATITUDE_MIN || swLatNum > LATITUDE_MAX || neLatNum < LATITUDE_MIN || neLatNum > LATITUDE_MAX) {
    return {
      valid: false,
      error: { code: 4003, message: `위도는 ${LATITUDE_MIN} ~ ${LATITUDE_MAX} 범위여야 합니다.` }
    };
  }

  if (swLngNum < LONGITUDE_MIN || swLngNum > LONGITUDE_MAX || neLngNum < LONGITUDE_MIN || neLngNum > LONGITUDE_MAX) {
    return {
      valid: false,
      error: { code: 4004, message: `경도는 ${LONGITUDE_MIN} ~ ${LONGITUDE_MAX} 범위여야 합니다.` }
    };
  }

  return {
    valid: true,
    coords: { swLatNum, swLngNum, neLatNum, neLngNum }
  };
};

/**
 * 캐시 키 생성
 * @param {object} coords - 좌표 객체
 * @param {string} zoom - 줌 레벨
 * @param {string} dateFilter - 날짜 필터 문자열
 * @returns {string} 캐시 키
 */
const generateCacheKey = (coords, zoom, dateFilter) => {
  const { swLatNum, swLngNum, neLatNum, neLngNum } = coords;
  const precision = appConfig.map.coordinate.PRECISION;

  const roundedSwLat = swLatNum.toFixed(precision);
  const roundedSwLng = swLngNum.toFixed(precision);
  const roundedNeLat = neLatNum.toFixed(precision);
  const roundedNeLng = neLngNum.toFixed(precision);

  return `rooms:map:${roundedSwLat},${roundedSwLng},${roundedNeLat},${roundedNeLng}:zoom${zoom || 'default'}:date${dateFilter}`;
};

/**
 * ETag 생성
 * @param {object} coords - 좌표 객체
 * @param {string} zoom - 줌 레벨
 * @param {string} dateFilter - 날짜 필터 문자열
 * @returns {Promise<string>} ETag 값
 */
const generateETag = async (coords, zoom, dateFilter) => {
  const { swLatNum, swLngNum, neLatNum, neLngNum } = coords;
  const coordString = `${swLatNum},${swLngNum},${neLatNum},${neLngNum},${zoom || 'default'},${dateFilter}`;
  const coordHash = crypto.createHash('md5').update(coordString).digest('hex').substring(0, 16);

  const dataVersion = await safeRedisOperation(async (client) => {
    return await client.get('rooms:data:version');
  }) || '1';

  return `"${coordHash}-v${dataVersion}"`;
};

/**
 * 줌 레벨에 따른 조회 개수 계산
 * @param {string} zoom - 줌 레벨
 * @param {string} userLimit - 사용자 지정 limit
 * @returns {number} 조회 개수
 */
const calculateLimit = (zoom, userLimit) => {
  const { MAX, MEDIUM, DETAIL } = appConfig.map.zoom;
  const limits = appConfig.map.limits;

  if (userLimit) {
    return Math.min(parseInt(userLimit), limits.MAX);
  }

  if (!zoom) {
    return limits.DEFAULT;
  }

  const zoomLevel = parseInt(zoom);
  if (zoomLevel >= MAX) {
    return 0; // 매물 미표시
  } else if (zoomLevel >= MEDIUM) {
    return limits.DETAIL;
  } else if (zoomLevel >= DETAIL) {
    return limits.MEDIUM;
  }

  return limits.DEFAULT;
};

/**
 * 예약 불가능한 방 ID 조회
 * @param {string} checkIn - 입실일
 * @param {string} checkOut - 퇴실일
 * @returns {Promise<number[]>} 예약 불가능한 방 ID 배열
 */
const getUnavailableRoomIds = async (checkIn, checkOut) => {
  if (!checkIn || !checkOut) {
    return [];
  }

  const unavailableRooms = await Contract.findAll({
    attributes: ['roomId'],
    where: {
      status: {
        [Op.in]: ['PAYMENT_COMPLETED', 'IN_PROGRESS', 'APPROVED']
      },
      [Op.and]: [
        { checkOutDate: { [Op.gte]: checkIn } },
        { checkInDate: { [Op.lte]: checkOut } }
      ]
    },
    raw: true
  });

  const excludeIds = unavailableRooms.map(r => r.roomId);
  console.log(`📅 날짜 필터 적용: ${checkIn} ~ ${checkOut} (제외된 방: ${excludeIds.length}개)`);

  return excludeIds;
};

/**
 * DB에서 방 목록 조회
 * @param {object} coords - 좌표 객체
 * @param {number[]} excludeRoomIds - 제외할 방 ID 배열
 * @param {number} limit - 조회 개수
 * @returns {Promise<Array>} 방 목록
 */
const fetchRoomsFromDB = async (coords, excludeRoomIds, limit) => {
  const { swLatNum, swLngNum, neLatNum, neLngNum } = coords;

  const whereClause = {
    status: 'published',
    latitude: {
      [Op.between]: [swLatNum, neLatNum],
      [Op.ne]: null
    },
    longitude: {
      [Op.between]: [swLngNum, neLngNum],
      [Op.ne]: null
    }
  };

  if (excludeRoomIds.length > 0) {
    whereClause.id = { [Op.notIn]: excludeRoomIds };
  }

  return await Room.findAll({
    where: whereClause,
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
      'buildingType',
      'quickMoveIn',
      'quickMoveInDiscount',
      'longTermWeeks',
      'longTermDiscount'
    ],
    include: [{
      model: RoomPhoto,
      as: 'photos',
      attributes: ['url', 'order'],
      required: false,
      separate: true,
      order: [['order', 'ASC']]
    }],
    limit: limit,
    order: [['created_at', 'DESC']]
  });
};

/**
 * 방 목록을 지도용 포맷으로 변환
 * @param {Array} rooms - 방 목록
 * @returns {object} 변환된 응답 데이터
 */
const transformRoomsForMap = (rooms) => {
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
    photos: room.photos && room.photos.length > 0
      ? room.photos.map(photo => ({
          url: photo.url,
          order: photo.order
        }))
      : [],
    discounts: {
      quickMoveIn: room.quickMoveIn || null,
      quickMoveInDiscount: room.quickMoveInDiscount || null,
      longTermWeeks: room.longTermWeeks || null,
      longTermDiscount: room.longTermDiscount || null
    }
  }));

  return {
    count: mapData.length,
    rooms: mapData
  };
};

/**
 * Redis에서 캐시 조회
 * @param {string} cacheKey - 캐시 키
 * @returns {Promise<object|null>} 캐시된 데이터 또는 null
 */
const getCachedRooms = async (cacheKey) => {
  const cachedData = await safeRedisOperation(async (client) => {
    return await client.get(cacheKey);
  });

  if (cachedData) {
    console.log('✅ Cache HIT:', cacheKey);
    return JSON.parse(cachedData);
  }

  console.log('❌ Cache MISS:', cacheKey, '- DB 조회 중...');
  return null;
};

/**
 * Redis에 캐시 저장
 * @param {string} cacheKey - 캐시 키
 * @param {object} data - 저장할 데이터
 * @returns {Promise<void>}
 */
const cacheRooms = async (cacheKey, data) => {
  const ttl = appConfig.cache.ttl.REDIS;

  await safeRedisOperation(async (client) => {
    await client.setEx(cacheKey, ttl, JSON.stringify(data));
    console.log(`💾 캐시 저장 완료: ${cacheKey} (TTL: ${ttl}초)`);
  });
};

/**
 * 인접 영역 사전 캐싱 (비동기)
 * @param {number} swLatNum - 남서쪽 위도
 * @param {number} swLngNum - 남서쪽 경도
 * @param {number} neLatNum - 북동쪽 위도
 * @param {number} neLngNum - 북동쪽 경도
 * @param {string} zoom - 줌 레벨
 * @returns {Promise<void>}
 */
const prefetchAdjacentAreas = async (swLatNum, swLngNum, neLatNum, neLngNum, zoom) => {
  const latDiff = neLatNum - swLatNum;
  const lngDiff = neLngNum - swLngNum;

  const adjacentAreas = [
    { swLat: swLatNum - latDiff, swLng: swLngNum, neLat: swLatNum, neLng: neLngNum }, // 하단
    { swLat: neLatNum, swLng: swLngNum, neLat: neLatNum + latDiff, neLng: neLngNum }, // 상단
    { swLat: swLatNum, swLng: swLngNum - lngDiff, neLat: neLatNum, neLng: swLngNum }, // 좌측
    { swLat: swLatNum, swLng: neLngNum, neLat: neLatNum, neLng: neLngNum + lngDiff }  // 우측
  ];

  for (const area of adjacentAreas) {
    const coords = {
      swLatNum: area.swLat,
      swLngNum: area.swLng,
      neLatNum: area.neLat,
      neLngNum: area.neLng
    };

    const cacheKey = generateCacheKey(coords, zoom, 'any');
    const exists = await safeRedisOperation(async (client) => {
      return await client.exists(cacheKey);
    });

    if (!exists) {
      try {
        const rooms = await fetchRoomsFromDB(coords, [], appConfig.map.limits.DEFAULT);
        const responseData = transformRoomsForMap(rooms);
        await cacheRooms(cacheKey, responseData);
      } catch (err) {
        console.error('사전 캐싱 실패:', err.message);
      }
    }
  }
};

module.exports = {
  validateDateRange,
  validateMapBounds,
  generateCacheKey,
  generateETag,
  calculateLimit,
  getUnavailableRoomIds,
  fetchRoomsFromDB,
  transformRoomsForMap,
  getCachedRooms,
  cacheRooms,
  prefetchAdjacentAreas
};
