const crypto = require('crypto');
const { Op } = require('sequelize');
const { Room, RoomPhoto, Contract, BlockedPeriod } = require('../models');
const { safeRedisOperation } = require('../config/redis');
const appConfig = require('../config/app.config');

/**
 * 빠른할인 적용 여부 계산 (조건만 체크)
 * @param {object} room - 방 정보 객체
 * @param {string} checkInDate - 입실일 (YYYY-MM-DD) 또는 null
 * @returns {object} 빠른할인 적용 가능 여부 및 기본 정보
 */
const checkQuickDiscountEligibility = (room, checkInDate) => {
  const result = {
    isEligible: false,
    quickMoveIn: room.quickMoveIn || null,
    quickMoveInDiscount: room.quickMoveInDiscount || null, // 고정금액 (원)
    daysUntilCheckIn: null
  };

  // 빠른할인 조건이 없으면 패스
  if (!room.quickMoveIn || !room.quickMoveInDiscount) {
    return result;
  }

  // 입실일이 없으면 오늘 기준으로 계산
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let targetDate;
  if (checkInDate) {
    targetDate = new Date(checkInDate);
    targetDate.setHours(0, 0, 0, 0);
  } else {
    targetDate = today;
  }

  // 입실일까지 남은 일수 계산
  const diffTime = targetDate.getTime() - today.getTime();
  const daysUntilCheckIn = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  result.daysUntilCheckIn = daysUntilCheckIn;

  // 과거 날짜면 할인 미적용
  if (daysUntilCheckIn < 0) {
    return result;
  }

  // 빠른할인 적용 조건: 입실일이 quickMoveIn일 이내
  if (daysUntilCheckIn <= room.quickMoveIn) {
    result.isEligible = true;
  }

  return result;
};

/**
 * 장기할인 적용 여부 계산 (조건만 체크)
 * @param {object} room - 방 정보 객체
 * @param {string} checkInDate - 입실일 (YYYY-MM-DD)
 * @param {string} checkOutDate - 퇴실일 (YYYY-MM-DD)
 * @returns {object} 장기할인 적용 가능 여부 및 기본 정보
 */
const checkLongTermDiscountEligibility = (room, checkInDate, checkOutDate) => {
  const result = {
    isEligible: false,
    longTermWeeks: room.longTermWeeks || null,
    longTermDiscount: room.longTermDiscount || null, // 비율 (%)
    stayWeeks: null
  };

  // 장기할인 조건이 없으면 패스
  if (!room.longTermWeeks || !room.longTermDiscount) {
    return result;
  }

  // 체크인/체크아웃 날짜가 없으면 계산 불가
  if (!checkInDate || !checkOutDate) {
    return result;
  }

  const checkIn = new Date(checkInDate);
  const checkOut = new Date(checkOutDate);
  const diffDays = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
  const stayWeeks = Math.floor(diffDays / 7);
  result.stayWeeks = stayWeeks;

  // 장기할인 적용 조건: 숙박 기간이 longTermWeeks 이상
  if (stayWeeks >= room.longTermWeeks) {
    result.isEligible = true;
  }

  return result;
};

/**
 * 최종 할인 계산 (빠른할인 → 장기할인 순차 적용)
 *
 * 할인 적용 순서:
 * 1. 빠른할인: 고정금액 할인 (dailyRent - quickMoveInDiscount원)
 * 2. 장기할인: 비율 할인 (빠른할인 적용 후 금액에서 longTermDiscount% 할인)
 *
 * @param {object} room - 방 정보 객체 (dailyRent 필수)
 * @param {string} checkInDate - 입실일 (YYYY-MM-DD)
 * @param {string} checkOutDate - 퇴실일 (YYYY-MM-DD)
 * @returns {object} 최종 할인 적용 결과
 */
const calculateDiscounts = (room, checkInDate, checkOutDate) => {
  const quickEligibility = checkQuickDiscountEligibility(room, checkInDate);
  const longTermEligibility = checkLongTermDiscountEligibility(room, checkInDate, checkOutDate);

  let currentRent = room.dailyRent || 0;
  let quickDiscountAmount = 0;
  let longTermDiscountAmount = 0;
  const appliedDiscounts = [];

  // 1단계: 빠른할인 적용 (고정금액)
  if (quickEligibility.isEligible && quickEligibility.quickMoveInDiscount) {
    quickDiscountAmount = quickEligibility.quickMoveInDiscount; // 고정금액
    currentRent = Math.max(0, currentRent - quickDiscountAmount);
    appliedDiscounts.push('quick');
  }

  // 2단계: 장기할인 적용 (빠른할인 적용 후 금액에서 % 할인)
  if (longTermEligibility.isEligible && longTermEligibility.longTermDiscount && currentRent > 0) {
    const discountRate = longTermEligibility.longTermDiscount / 100;
    longTermDiscountAmount = Math.floor(currentRent * discountRate); // 소수점 절사
    currentRent = currentRent - longTermDiscountAmount;
    appliedDiscounts.push('longTerm');
  }

  const totalDiscountAmount = quickDiscountAmount + longTermDiscountAmount;

  return {
    originalDailyRent: room.dailyRent,
    finalDailyRent: currentRent,
    totalDiscountAmount: totalDiscountAmount,
    appliedDiscounts: appliedDiscounts, // ['quick'], ['longTerm'], ['quick', 'longTerm'], []
    quick: {
      quickMoveIn: quickEligibility.quickMoveIn,
      quickMoveInDiscount: quickEligibility.quickMoveInDiscount,
      isApplicable: quickEligibility.isEligible,
      discountAmount: quickDiscountAmount,
      daysUntilCheckIn: quickEligibility.daysUntilCheckIn
    },
    longTerm: {
      longTermWeeks: longTermEligibility.longTermWeeks,
      longTermDiscount: longTermEligibility.longTermDiscount,
      isApplicable: longTermEligibility.isEligible,
      discountAmount: longTermDiscountAmount,
      stayWeeks: longTermEligibility.stayWeeks
    }
  };
};

// 하위 호환성을 위한 래퍼 함수들
const calculateQuickDiscount = (room, checkInDate) => {
  const result = calculateDiscounts(room, checkInDate, null);
  return {
    isQuickDiscountApplicable: result.quick.isApplicable,
    quickMoveIn: result.quick.quickMoveIn,
    quickMoveInDiscount: result.quick.quickMoveInDiscount,
    discountedDailyRent: result.quick.isApplicable ? (room.dailyRent - result.quick.discountAmount) : null,
    discountAmount: result.quick.discountAmount || null,
    daysUntilCheckIn: result.quick.daysUntilCheckIn
  };
};

const calculateLongTermDiscount = (room, checkInDate, checkOutDate) => {
  const result = calculateDiscounts(room, checkInDate, checkOutDate);
  return {
    isLongTermDiscountApplicable: result.longTerm.isApplicable,
    longTermWeeks: result.longTerm.longTermWeeks,
    longTermDiscount: result.longTerm.longTermDiscount,
    discountedDailyRent: result.longTerm.isApplicable ? (room.dailyRent - result.longTerm.discountAmount) : null,
    discountAmount: result.longTerm.discountAmount || null,
    stayWeeks: result.longTerm.stayWeeks
  };
};

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
 * 예약 불가능한 방 ID 조회 (계약 + 불가 기간)
 * @param {string} checkIn - 입실일
 * @param {string} checkOut - 퇴실일
 * @returns {Promise<number[]>} 예약 불가능한 방 ID 배열
 */
const getUnavailableRoomIds = async (checkIn, checkOut) => {
  if (!checkIn || !checkOut) {
    return [];
  }

  // 병렬로 계약 정보와 불가 기간 조회
  const [contractRooms, blockedRooms] = await Promise.all([
    // 1. 확정된 계약이 있는 방
    Contract.findAll({
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
    }),

    // 2. 호스트가 설정한 불가 기간이 있는 방
    BlockedPeriod.findAll({
      attributes: ['roomId'],
      where: {
        [Op.and]: [
          { endDate: { [Op.gte]: checkIn } },
          { startDate: { [Op.lte]: checkOut } }
        ]
      },
      raw: true
    })
  ]);

  // 중복 제거하여 제외할 방 ID 목록 생성
  const contractIds = contractRooms.map(r => r.roomId);
  const blockedIds = blockedRooms.map(r => r.roomId);
  const excludeIds = [...new Set([...contractIds, ...blockedIds])];

  console.log(`📅 날짜 필터 적용: ${checkIn} ~ ${checkOut} (계약: ${contractIds.length}개, 불가기간: ${blockedIds.length}개, 총 제외: ${excludeIds.length}개)`);

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
 * 방 목록을 지도용 포맷으로 변환 (할인 적용 여부 계산 포함)
 * @param {Array} rooms - 방 목록
 * @param {string} checkInDate - 입실일 (YYYY-MM-DD) 또는 null
 * @param {string} checkOutDate - 퇴실일 (YYYY-MM-DD) 또는 null
 * @returns {object} 변환된 응답 데이터
 */
const transformRoomsForMap = (rooms, checkInDate = null, checkOutDate = null, unavailableRoomIds = []) => {
  const mapData = rooms.map(room => {
    // 할인 계산 (빠른할인 → 장기할인 순차 적용)
    const discountResult = calculateDiscounts(room, checkInDate, checkOutDate);
    // 날짜 필터가 있을 때만 예약 가능 여부 판단, 없으면 true
    const isAvailable = checkInDate && checkOutDate
      ? !unavailableRoomIds.includes(room.id)
      : true;

    return {
      id: room.id,
      roomName: room.roomName,
      address: room.address,
      latitude: parseFloat(room.latitude),
      longitude: parseFloat(room.longitude),
      dailyRent: room.dailyRent,
      finalDailyRent: discountResult.finalDailyRent,
      totalDiscountAmount: discountResult.totalDiscountAmount,
      appliedDiscounts: discountResult.appliedDiscounts, // ['quick', 'longTerm'] 등
      isAvailable, // false면 해당 날짜에 예약 불가 (프론트에서 회색 처리)
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
        quick: {
          quickMoveIn: discountResult.quick.quickMoveIn,
          quickMoveInDiscount: discountResult.quick.quickMoveInDiscount,
          isApplicable: discountResult.quick.isApplicable,
          discountAmount: discountResult.quick.discountAmount,
          daysUntilCheckIn: discountResult.quick.daysUntilCheckIn
        },
        longTerm: {
          longTermWeeks: discountResult.longTerm.longTermWeeks,
          longTermDiscount: discountResult.longTerm.longTermDiscount,
          isApplicable: discountResult.longTerm.isApplicable,
          discountAmount: discountResult.longTerm.discountAmount,
          stayWeeks: discountResult.longTerm.stayWeeks
        }
      }
    };
  });

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
  prefetchAdjacentAreas,
  calculateDiscounts,
  // 하위 호환성
  calculateQuickDiscount,
  calculateLongTermDiscount
};
