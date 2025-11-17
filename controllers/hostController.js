const { Room, RoomPhoto, RoomAmenity, RoomFreeService, sequelize } = require('../models');
const { ErrorCodes, success, error, created, updated } = require('../utils/responseHelper');
const { convertRoadAddressToCoordinates } = require('../utils/geocoding');
const { invalidateRoomCache } = require('../utils/cacheInvalidation');
const { calculateProgress } = require('../utils/roomProgress');

// 1. 기본 정보 등록
const createRoom = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const hostId = req.user.id;
    const {
      roomName,
      address,
      detailAddress,
      area,
      floor,
      buildingType,
      parkingAvailable,
      parkingInfo,
      elevatorAvailable,
      roomCount,
      bathroomCount,
      isDuplex,
      entrancePassword
    } = req.body;

    // 필수 필드 검증
    if (!roomName || !address || !detailAddress || !area || !buildingType) {
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400);
    }

    // 주소를 좌표로 변환
    let latitude = null;
    let longitude = null;
    try {
      const coordinates = await convertRoadAddressToCoordinates(address, detailAddress);
      latitude = coordinates.lat;
      longitude = coordinates.lng;
    } catch (geoError) {
      // 좌표 변환 실패 시 경고 로그만 남기고 계속 진행 (좌표는 필수가 아님)
      console.warn('주소 좌표 변환 실패:', geoError.message);
    }

    const room = await Room.create({
      hostId,
      roomName,
      address,
      detailAddress,
      latitude,
      longitude,
      area,
      floor,
      buildingType,
      parkingAvailable: parkingAvailable || false,
      parkingInfo,
      elevatorAvailable: elevatorAvailable || false,
      roomCount: roomCount || 0,
      bathroomCount: bathroomCount || 0,
      isDuplex: isDuplex || false,
      entrancePassword,
      status: 'draft'
    }, { transaction });

    await transaction.commit();

    return created(res, {
      roomId: room.id,
      status: room.status
    }, '방 기본 정보가 등록되었습니다.');
  } catch (err) {
    await transaction.rollback();
    console.error('Room creation error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

// 2. 기본 정보 수정
const updateBasicInfo = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { roomId } = req.params;
    const hostId = req.user.id;
    const {
      roomName,
      address,
      detailAddress,
      area,
      floor,
      buildingType,
      parkingAvailable,
      parkingInfo,
      elevatorAvailable,
      roomCount,
      bathroomCount,
      isDuplex,
      entrancePassword
    } = req.body;

    const room = await Room.findOne({
      where: { id: roomId, hostId }
    });

    if (!room) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    // 주소(address)가 변경된 경우에만 좌표 재변환
    let latitude = room.latitude;
    let longitude = room.longitude;
    if (address && address !== room.address) {
      try {
        const coordinates = await convertRoadAddressToCoordinates(address, detailAddress || room.detailAddress);
        latitude = coordinates.lat;
        longitude = coordinates.lng;
      } catch (geoError) {
        console.warn('주소 좌표 변환 실패:', geoError.message);
      }
    }

    await room.update({
      roomName: roomName ?? room.roomName,
      address: address ?? room.address,
      detailAddress: detailAddress ?? room.detailAddress,
      latitude,
      longitude,
      area: area ?? room.area,
      floor: floor ?? room.floor,
      buildingType: buildingType ?? room.buildingType,
      parkingAvailable: parkingAvailable ?? room.parkingAvailable,
      parkingInfo: parkingInfo ?? room.parkingInfo,
      elevatorAvailable: elevatorAvailable ?? room.elevatorAvailable,
      roomCount: roomCount ?? room.roomCount,
      bathroomCount: bathroomCount ?? room.bathroomCount,
      isDuplex: isDuplex ?? room.isDuplex,
      entrancePassword: entrancePassword ?? room.entrancePassword
    }, { transaction });

    await transaction.commit();

    // 지도 캐시 무효화 (roomName, address, area, buildingType, roomCount 등 변경)
    await invalidateRoomCache();

    return updated(res, {
      roomId: room.id,
      status: room.status
    }, '방 기본 정보가 수정되었습니다.');
  } catch (err) {
    await transaction.rollback();
    console.error('Basic info update error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

// 3. 요금 설정 (1일 기준)
const updatePricing = async (req, res) => {
  try {
    const { roomId } = req.params;
    const hostId = req.user.id;
    const {
      dailyRent,
      dailyMaintenanceFee,
      longTermWeeks,
      longTermDiscount,
      quickMoveIn,
      quickMoveInDiscount,
      maintenanceDetail,
      includeElectricity,
      includeWater,
      includeGas,
      includeInternet,
      cleaningFee,
      minContractWeeks,
      refundPolicy
    } = req.body;

    const room = await Room.findOne({
      where: { id: roomId, hostId }
    });

    if (!room) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    await room.update({
      dailyRent,
      dailyMaintenanceFee,
      longTermWeeks,
      longTermDiscount,
      quickMoveIn,
      quickMoveInDiscount,
      maintenanceDetail,
      includeElectricity: includeElectricity || false,
      includeWater: includeWater || false,
      includeGas: includeGas || false,
      includeInternet: includeInternet || false,
      cleaningFee,
      minContractWeeks,
      refundPolicy
    });

    // 지도 캐시 무효화 (dailyRent 변경)
    await invalidateRoomCache();

    return updated(res, { roomId: room.id }, '요금 정보가 저장되었습니다.');
  } catch (err) {
    console.error('Pricing update error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

// 4. 사진 업로드
const uploadPhotos = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { roomId } = req.params;
    const hostId = req.user.id;

    const room = await Room.findOne({
      where: { id: roomId, hostId }
    });

    if (!room) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    // 신규 업로드 파일 체크
    if (!req.files || req.files.length === 0) {
      return error(res, ErrorCodes.NO_FILE_UPLOADED, 400);
    }

    // 기존 업로드된 사진 개수 조회
    const existingPhotoCount = await RoomPhoto.count({
      where: { roomId: room.id }
    });

    // 총 사진 개수 체크 (기존 + 신규)
    const totalPhotoCount = existingPhotoCount + req.files.length;

    if (totalPhotoCount < 5) {
      return error(res, ErrorCodes.MIN_PHOTOS_REQUIRED, 400,
        `최소 5장의 사진이 필요합니다. (현재: ${totalPhotoCount}장)`);
    }

    if (totalPhotoCount > 20) {
      return error(res, ErrorCodes.MAX_PHOTOS_EXCEEDED, 400,
        `최대 20장까지만 업로드 가능합니다. (현재: ${existingPhotoCount}장, 추가 시도: ${req.files.length}장)`);
    }

    // 기존 사진의 최대 order 조회 (신규 사진의 시작 순서 결정)
    const maxOrder = await RoomPhoto.max('order', {
      where: { roomId: room.id }
    }) || -1;

    const photoUrls = [];
    for (let i = 0; i < req.files.length; i++) {
      // 상대 경로로 저장 (프론트엔드에서 baseURL + path 형태로 사용)
      const relativePath = `/uploads/rooms/${req.files[i].filename}`;

      const photo = await RoomPhoto.create({
        roomId: room.id,
        url: relativePath,
        order: maxOrder + 1 + i
      }, { transaction });

      photoUrls.push({
        id: photo.id,
        url: photo.url,
        order: photo.order
      });
    }

    await transaction.commit();

    // 지도 캐시 무효화 (thumbnail 변경)
    await invalidateRoomCache();

    return success(res, { photoUrls }, '사진이 업로드되었습니다.');
  } catch (err) {
    await transaction.rollback();
    console.error('Photo upload error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

// 5. 편의시설 설정
const updateAmenities = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { roomId } = req.params;
    const hostId = req.user.id;
    const {
      basicOptions,
      additionalOptions,
      convenienceOptions,
      wifiPassword
    } = req.body;

    const room = await Room.findOne({
      where: { id: roomId, hostId }
    });

    if (!room) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    // 침대 데이터 검증 (basicOptions에 침대 정보가 있는 경우)
    if (basicOptions?.침대) {
      const bedSizes = basicOptions.침대;
      const validSizes = ['킹', '퀸', '싱글', '슈퍼싱글'];

      for (const size in bedSizes) {
        if (!validSizes.includes(size)) {
          return error(res, ErrorCodes.VALIDATION_ERROR, 400,
            { field: 'basicOptions.침대', message: `유효하지 않은 침대 사이즈: ${size}` });
        }
        if (typeof bedSizes[size] !== 'number' || bedSizes[size] < 0) {
          return error(res, ErrorCodes.VALIDATION_ERROR, 400,
            { field: 'basicOptions.침대', message: `침대 수량은 0 이상의 숫자여야 합니다: ${size}` });
        }
      }
    }

    // RoomAmenity 생성 또는 업데이트
    await RoomAmenity.upsert({
      roomId: room.id,
      basicOptions: basicOptions || {},
      additionalOptions: additionalOptions || {},
      convenienceOptions: convenienceOptions || {},
      wifiPassword
    }, { transaction });

    await transaction.commit();

    return updated(res, { roomId: room.id }, '편의시설 정보가 저장되었습니다.');
  } catch (err) {
    await transaction.rollback();
    console.error('Amenities update error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

// 6. 무료 부가서비스 설정
const updateFreeServices = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { roomId } = req.params;
    const hostId = req.user.id;
    const {
      cleaningService,
      hairDryerRental,
      beddingService,
      amenityKit,
      towelSetRental,
      autoPasswordChange,
      roomPassword
    } = req.body;

    const room = await Room.findOne({
      where: { id: roomId, hostId }
    });

    if (!room) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    await RoomFreeService.upsert({
      roomId: room.id,
      cleaningService: cleaningService || false,
      hairDryerRental: hairDryerRental || false,
      beddingService: beddingService || false,
      amenityKit: amenityKit || false,
      towelSetRental: towelSetRental || false,
      autoPasswordChange: autoPasswordChange || false,
      roomPassword
    }, { transaction });

    // cleaningService가 true인 경우 cleaning_fee를 0으로 설정
    // (청소 서비스는 Ezstay에서 제공하므로 호스트 청소비 불필요)
    if (cleaningService === true) {
      await room.update({
        cleaningFee: 0
      }, { transaction });
    }

    await transaction.commit();

    // cleaningFee 변경 시 지도 캐시 무효화
    if (cleaningService === true) {
      await invalidateRoomCache();
    }

    return updated(res, { roomId: room.id }, '무료 부가서비스 정보가 저장되었습니다.');
  } catch (err) {
    await transaction.rollback();
    console.error('Free services update error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

// 7. 방 소개 및 설명
const updateDescription = async (req, res) => {
  try {
    const { roomId } = req.params;
    const hostId = req.user.id;
    const { description, maxGuests } = req.body;

    const room = await Room.findOne({
      where: { id: roomId, hostId }
    });

    if (!room) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    // maxGuests 검증
    if (maxGuests !== undefined) {
      if (!Number.isInteger(maxGuests) || maxGuests < 1 || maxGuests > 20) {
        return error(res, {
          code: 4004,
          message: '최대 인원은 1~20명 사이의 정수만 입력 가능합니다.'
        }, 400);
      }
    }

    await room.update({
      description,
      maxGuests: maxGuests !== undefined ? maxGuests : room.maxGuests
    });

    return updated(res, { roomId: room.id }, '방 소개가 저장되었습니다.');
  } catch (err) {
    console.error('Description update error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

// 9. 심사 요청
const submitReview = async (req, res) => {
  try {
    const { roomId } = req.params;
    const hostId = req.user.id;

    const room = await Room.findOne({
      where: { id: roomId, hostId },
      include: [
        { model: RoomPhoto, as: 'photos' },
        { model: RoomAmenity, as: 'amenity' },
        { model: RoomFreeService, as: 'freeService' }
      ]
    });

    if (!room) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    // 필수 정보 검증
    if (!room.photos || room.photos.length < 5) {
      return error(res, ErrorCodes.MIN_PHOTOS_REQUIRED, 400);
    }

    if (!room.dailyRent || !room.description) {
      return error(res, ErrorCodes.ROOM_INFO_INCOMPLETE, 400);
    }

    await room.update({
      status: 'pending_review',
      submittedAt: new Date()
    });

    // 지도 캐시 무효화 (나중에 승인되면 지도에 표시됨)
    await invalidateRoomCache();

    return success(res, {
      roomId: room.id,
      status: room.status,
      submittedAt: room.submittedAt
    }, '심사 요청이 완료되었습니다.');
  } catch (err) {
    console.error('Submit review error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

// 10. 사진 순서 변경
const reorderPhotos = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { roomId } = req.params;
    const hostId = req.user.id;
    const { photoIds } = req.body;

    const room = await Room.findOne({
      where: { id: roomId, hostId }
    });

    if (!room) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      return error(res, ErrorCodes.PHOTO_IDS_REQUIRED, 400);
    }

    // 각 사진의 순서 업데이트
    for (let i = 0; i < photoIds.length; i++) {
      await RoomPhoto.update(
        { order: i },
        {
          where: { id: photoIds[i], roomId: room.id },
          transaction
        }
      );
    }

    await transaction.commit();

    // 지도 캐시 무효화 (thumbnail 순서 변경)
    await invalidateRoomCache();

    return success(res, null, '사진 순서가 변경되었습니다.');
  } catch (err) {
    await transaction.rollback();
    console.error('Photo reorder error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

// 11. 사진 삭제
const deletePhoto = async (req, res) => {
  try {
    const { roomId, photoId } = req.params;
    const hostId = req.user.id;

    const room = await Room.findOne({
      where: { id: roomId, hostId }
    });

    if (!room) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    const photo = await RoomPhoto.findOne({
      where: { id: photoId, roomId: room.id }
    });

    if (!photo) {
      return error(res, ErrorCodes.PHOTO_NOT_FOUND, 404);
    }

    await photo.destroy();

    // 지도 캐시 무효화 (thumbnail 변경 가능)
    await invalidateRoomCache();

    return success(res, null, '사진이 삭제되었습니다.');
  } catch (err) {
    console.error('Photo delete error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

// 12. 내 방 목록 조회
const getMyRooms = async (req, res) => {
  try {
    const hostId = req.user.id;
    const { status, page = 1, limit = 10 } = req.query;

    const where = { hostId };
    if (status) {
      where.status = status;
    }

    const offset = (page - 1) * limit;

    const { count, rows } = await Room.findAndCountAll({
      where,
      include: [
        {
          model: RoomPhoto,
          as: 'photos',
          limit: 1,
          order: [['order', 'ASC']]
        },
        {
          model: RoomAmenity,
          as: 'amenity',
          attributes: ['roomId']
        },
        {
          model: RoomFreeService,
          as: 'freeService',
          attributes: ['roomId']
        }
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    const rooms = rows.map(room => {
      const registrationProgress = calculateProgress(room);

      return {
        id: room.id,
        roomName: room.roomName,
        address: room.address,
        area: room.area,
        buildingType: room.buildingType,
        dailyRent: room.dailyRent,
        status: room.status,
        thumbnail: room.photos[0]?.url || null,
        registrationProgress,
        submittedAt: room.submittedAt,
        approvedAt: room.approvedAt,
        publishedAt: room.publishedAt,
        createdAt: room.createdAt,
        updatedAt: room.updatedAt
      };
    });

    return success(res, {
      rooms,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (err) {
    console.error('Get my rooms error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

// 13. 방 정보 조회
const getRoom = async (req, res) => {
  try {
    const { roomId } = req.params;
    const hostId = req.user.id;

    const room = await Room.findOne({
      where: { id: roomId, hostId },
      include: [
        {
          model: RoomPhoto,
          as: 'photos',
          order: [['order', 'ASC']]
        },
        {
          model: RoomAmenity,
          as: 'amenity'
        },
        {
          model: RoomFreeService,
          as: 'freeService'
        }
      ]
    });

    if (!room) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    // 진행 단계 계산
    const registrationProgress = calculateProgress(room);

    // 응답 데이터 구조화
    const responseData = {
      // 기본 정보
      roomName: room.roomName,
      address: room.address,
      detailAddress: room.detailAddress,
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
      entrancePassword: room.entrancePassword,

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

      // 등록 진행 상태
      registrationProgress
    };

    return success(res, responseData);
  } catch (err) {
    console.error('Get room error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

module.exports = {
  createRoom,
  updateBasicInfo,
  updatePricing,
  uploadPhotos,
  updateAmenities,
  updateFreeServices,
  updateDescription,
  submitReview,
  reorderPhotos,
  deletePhoto,
  getMyRooms,
  getRoom
};
