const { Room, RoomPhoto, RoomAmenity, RoomFreeService, User, RentalItem, Contract } = require('../models');
const { Op } = require('sequelize');
const { ErrorCodes, success, error, created } = require('../utils/responseHelper');
const { safeRedisOperation } = require('../config/redis');
const crypto = require('crypto');
const roomService = require('../services/roomService');
const appConfig = require('../config/app.config');

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
      // ✅ 화이트리스트 방식: PRD 요구사항 필드만 명시적으로 선택
      attributes: [
        // 기본 정보
        'id', 'roomName', 'address', 'latitude', 'longitude',
        'area', 'floor', 'buildingType',

        // 구조 정보
        'parkingAvailable', 'parkingInfo',
        'elevatorAvailable', 'roomCount', 'bathroomCount', 'isDuplex',

        // 요금 정보 (PRD 필수)
        'dailyRent', 'dailyMaintenanceFee', 'maintenanceDetail',
        'includeElectricity', 'includeWater', 'includeGas', 'includeInternet',
        'cleaningFee', 'minContractWeeks', 'refundPolicy',

        // 할인 정보
        'longTermWeeks', 'longTermDiscount', 'quickMoveIn', 'quickMoveInDiscount',

        // 상세 정보
        'description', 'maxGuests',

        // 타임스탬프
        'createdAt', 'updatedAt'

        // ❌ 제외: entrancePassword, detailAddress, status, hostId (보안)
      ],
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
          // wifiPassword는 자동으로 포함되지만 아래에서 제거됨
        },
        {
          model: RoomFreeService,
          as: 'freeService',
          attributes: [
            'cleaningService', 'hairDryerRental', 'beddingService',
            'amenityKit', 'towelSetRental', 'autoPasswordChange'
            // ⚠️ roomPassword 제외 (보안)
          ],
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

    // 게스트 API이므로 민감 정보 제거 및 JSON 파싱
    if (roomData.amenity) {
      delete roomData.amenity.wifiPassword;  // 와이파이 비밀번호는 계약 후 제공

      // JSON 문자열을 객체로 파싱 (프론트엔드 편의성)
      try {
        if (roomData.amenity.basicOptions && typeof roomData.amenity.basicOptions === 'string') {
          roomData.amenity.basicOptions = JSON.parse(roomData.amenity.basicOptions);
        }
        if (roomData.amenity.additionalOptions && typeof roomData.amenity.additionalOptions === 'string') {
          roomData.amenity.additionalOptions = JSON.parse(roomData.amenity.additionalOptions);
        }
        if (roomData.amenity.convenienceOptions && typeof roomData.amenity.convenienceOptions === 'string') {
          roomData.amenity.convenienceOptions = JSON.parse(roomData.amenity.convenienceOptions);
        }
      } catch (parseError) {
        console.error('Amenity JSON 파싱 실패:', parseError.message);
        // 파싱 실패 시 원본 데이터 유지
      }
    }

    // ✅ PRD 요구사항: 고정값 및 계산 필드 추가
    roomData.deposit = 300000; // 보증금 30만원 고정
    roomData.weeklyRent = roomData.dailyRent ? roomData.dailyRent * 7 : null; // 주간 임대료 계산

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
    const { swLat, swLng, neLat, neLng, zoom, checkIn, checkOut } = req.query;

    // 날짜 범위 검증
    const dateValidation = roomService.validateDateRange(checkIn, checkOut);
    if (!dateValidation.valid) {
      return error(res, dateValidation.error, 400);
    }

    // 좌표 검증
    const boundsValidation = roomService.validateMapBounds(swLat, swLng, neLat, neLng);
    if (!boundsValidation.valid) {
      return error(res, boundsValidation.error, 400);
    }

    const coords = boundsValidation.coords;
    const dateFilter = checkIn && checkOut ? `${checkIn}_${checkOut}` : 'any';

    // ETag 생성 및 HTTP 캐시 검증
    const etag = await roomService.generateETag(coords, zoom, dateFilter);
    if (req.headers['if-none-match'] === etag) {
      console.log('✅ HTTP 304 Not Modified - 브라우저 캐시 사용');
      return res.status(304).end();
    }

    // 줌 레벨에 따른 limit 계산
    const limit = roomService.calculateLimit(zoom, req.query.limit);
    if (limit === 0) {
      return success(res, {
        count: 0,
        rooms: [],
        message: '지도를 더 확대해주세요.'
      }, '지도를 더 확대하면 매물을 확인할 수 있습니다.');
    }

    // Redis 캐시 확인
    const cacheKey = roomService.generateCacheKey(coords, zoom, dateFilter);
    const cachedData = await roomService.getCachedRooms(cacheKey);

    if (cachedData) {
      res.set({
        'ETag': etag,
        'Cache-Control': `public, max-age=${appConfig.cache.ttl.BROWSER}, must-revalidate`,
        'Vary': 'Accept-Encoding'
      });
      return success(res, cachedData, '지도 영역 내 방 목록을 조회했습니다. (캐시)');
    }

    // 예약 불가능한 방 조회
    const excludeRoomIds = await roomService.getUnavailableRoomIds(checkIn, checkOut);

    // DB에서 방 목록 조회
    const rooms = await roomService.fetchRoomsFromDB(coords, excludeRoomIds, limit);

    // 응답 데이터 가공
    const responseData = roomService.transformRoomsForMap(rooms);

    // Redis 캐시 저장
    await roomService.cacheRooms(cacheKey, responseData);

    // 인접 영역 사전 캐싱 (비동기)
    setImmediate(() => {
      roomService.prefetchAdjacentAreas(
        coords.swLatNum,
        coords.swLngNum,
        coords.neLatNum,
        coords.neLngNum,
        zoom
      ).catch(err => {
        console.error('사전 캐싱 실패:', err.message);
      });
    });

    // HTTP 캐싱 헤더 설정
    res.set({
      'ETag': etag,
      'Cache-Control': `public, max-age=${appConfig.cache.ttl.BROWSER}, must-revalidate`,
      'Vary': 'Accept-Encoding'
    });

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