const { Room, RoomPhoto, RoomAmenity, EzService, Contract, UserBankAccount, ReceiptSetting, sequelize } = require('../models');
const { ErrorCodes, success, error, created, updated, deleted } = require('../utils/responseHelper');
const { convertRoadAddressToCoordinates } = require('../utils/geocoding');
const { invalidateRoomCache } = require('../utils/cacheInvalidation');
const { calculateProgress } = require('../utils/roomProgress');
const { Op } = require('sequelize');
const { getFileUrl, deleteFromS3 } = require('../middleware/upload');
const isProduction = process.env.NODE_ENV === 'production';
const { toAbsoluteUrl } = require('../utils/urlHelper');
const { toKSTString } = require('../utils/dateHelper');

// JSON 컬럼이 이중 직렬화된 경우를 대비한 안전 파싱 (문자열이면 파싱, 객체면 그대로)
const safeParseJson = (val) => {
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return {}; }
  }
  return val ?? {};
};

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

    // 서비스 지역 검증
    const { region } = require('../config/app.config');
    const isAllowedRegion = region.ALLOWED.some(r => address.startsWith(r));
    if (!isAllowedRegion) {
      return error(res, ErrorCodes.REGION_NOT_SUPPORTED, 400);
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

// 재심사 트리거 상태
const REVIEW_TRIGGER_STATUSES = ['approved', 'published'];

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

    // 재심사 트리거 필드 변경 여부 확인
    const REVIEW_FIELDS = ['address', 'buildingType', 'area', 'roomCount', 'bathroomCount'];
    const needsReview = REVIEW_TRIGGER_STATUSES.includes(room.status) && REVIEW_FIELDS.some(field => {
      const bodyVal = req.body[field];
      return bodyVal !== undefined && bodyVal !== room[field];
    });

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
      entrancePassword: entrancePassword ?? room.entrancePassword,
      ...(needsReview && { status: 'pending_review', submittedAt: new Date() })
    }, { transaction });

    await transaction.commit();

    // 지도 캐시 무효화 (roomName, address, area, buildingType, roomCount 등 변경)
    await invalidateRoomCache();

    return updated(res, {
      roomId: room.id,
      status: needsReview ? 'pending_review' : room.status
    }, needsReview ? '방 기본 정보가 수정되었습니다. 변경된 항목이 있어 재심사가 진행됩니다.' : '방 기본 정보가 수정되었습니다.');
  } catch (err) {
    await transaction.rollback();
    console.error('Basic info update error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

// 3. 요금 설정 (1일 기준)
const updatePricing = async (req, res) => {
  const transaction = await sequelize.transaction();

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
      minContractDays,
      refundPolicy,
      cleaningService,
      roomPassword
    } = req.body;

    const room = await Room.findOne({
      where: { id: roomId, hostId },
      include: [{ model: EzService, as: 'ezService' }]
    });

    if (!room) {
      await transaction.rollback();
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    // cleaningService=true이면 cleaningFee를 0으로 강제
    const finalCleaningFee = cleaningService === true ? 0 : cleaningFee;

    // 재심사 트리거 필드 변경 여부 확인
    const pricingReviewFields = {
      dailyRent,
      dailyMaintenanceFee,
      cleaningFee: finalCleaningFee
    };
    const needsReview = REVIEW_TRIGGER_STATUSES.includes(room.status) && (
      Object.entries(pricingReviewFields).some(([field, val]) => val !== undefined && val !== room[field]) ||
      (cleaningService !== undefined && cleaningService !== room.ezService?.cleaningService)
    );

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
      cleaningFee: finalCleaningFee,
      minContractDays,
      refundPolicy,
      ...(needsReview && { status: 'pending_review', submittedAt: new Date() })
    }, { transaction });

    // 청소서비스 관련 EzService 저장
    if (cleaningService !== undefined) {
      await EzService.upsert({
        roomId: room.id,
        cleaningService: cleaningService || false,
        roomPassword: cleaningService === true ? roomPassword : null
      }, { transaction });
    }

    await transaction.commit();

    // 지도 캐시 무효화
    await invalidateRoomCache();

    return updated(res, {
      roomId: room.id,
      status: needsReview ? 'pending_review' : room.status
    }, needsReview ? '요금 정보가 저장되었습니다. 변경된 항목이 있어 재심사가 진행됩니다.' : '요금 정보가 저장되었습니다.');
  } catch (err) {
    await transaction.rollback();
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
      const photoUrl = await getFileUrl(req.files[i]);

      const photo = await RoomPhoto.create({
        roomId: room.id,
        url: photoUrl,
        order: maxOrder + 1 + i
      }, { transaction });

      photoUrls.push({
        id: photo.id,
        url: photo.url,
        order: photo.order
      });
    }

    // 재심사 트리거: 사진 추가 시
    const needsReview = REVIEW_TRIGGER_STATUSES.includes(room.status);
    if (needsReview) {
      await room.update({ status: 'pending_review', submittedAt: new Date() }, { transaction });
    }

    await transaction.commit();

    // 지도 캐시 무효화 (thumbnail 변경)
    await invalidateRoomCache();

    return success(res, {
      photoUrls,
      status: needsReview ? 'pending_review' : room.status
    }, needsReview ? '사진이 업로드되었습니다. 변경된 항목이 있어 재심사가 진행됩니다.' : '사진이 업로드되었습니다.');
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
      petsAllowed,
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
      petsAllowed: petsAllowed !== undefined ? petsAllowed : false,
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
/**
 * 이지서비스 업데이트 (구 updateFreeServices)
 * 렌탈 아이템은 플랫폼 직접 판매로 전환되어 제거됨
 */
const updateFreeServices = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { roomId } = req.params;
    const hostId = req.user.id;
    const {
      cleaningService,
      roomPassword
    } = req.body;

    const room = await Room.findOne({
      where: { id: roomId, hostId },
      include: [{ model: EzService, as: 'ezService' }]
    });

    if (!room) {
      await transaction.rollback();
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    // 재심사 트리거: cleaningService 변경 여부 확인
    const needsReview = REVIEW_TRIGGER_STATUSES.includes(room.status) &&
      cleaningService !== undefined &&
      cleaningService !== (room.ezService?.cleaningService ?? false);

    await EzService.upsert({
      roomId: room.id,
      cleaningService: cleaningService || false,
      roomPassword: cleaningService === true ? roomPassword : null
    }, { transaction });

    // cleaningService=true이면 cleaningFee를 0으로 설정
    await room.update({
      ...(cleaningService === true && { cleaningFee: 0 }),
      ...(needsReview && { status: 'pending_review', submittedAt: new Date() })
    }, { transaction });

    await transaction.commit();

    await invalidateRoomCache();

    return updated(res, {
      roomId: room.id,
      status: needsReview ? 'pending_review' : room.status
    }, needsReview ? '부가서비스 정보가 저장되었습니다. 변경된 항목이 있어 재심사가 진행됩니다.' : '부가서비스 정보가 저장되었습니다.');
  } catch (err) {
    await transaction.rollback();
    console.error('Free services update error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

// 7. 방 소개 및 설명 (입퇴실 시간 포함)
const updateDescription = async (req, res) => {
  try {
    const { roomId } = req.params;
    const hostId = req.user.id;
    const { description, maxGuests, checkInTime, checkOutTime } = req.body;

    const room = await Room.findOne({
      where: { id: roomId, hostId }
    });

    if (!room) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    // 방 설명 글자수 제한 (10~500자)
    if (description !== undefined && description !== null) {
      const descLength = description.trim().length;
      if (descLength < 10 || descLength > 500) {
        return error(res, {
          code: 4007,
          message: '방 설명은 10자 이상 500자 이하로 입력해야 합니다.',
          details: { currentLength: descLength, min: 10, max: 500 }
        }, 400);
      }
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

    // 입실 시간 검증 (14~17시, 1시간 단위)
    if (checkInTime !== undefined) {
      if (!Number.isInteger(checkInTime) || checkInTime < 14 || checkInTime > 17) {
        return error(res, {
          code: 4005,
          message: '입실 시간은 14시~17시 사이의 정수만 입력 가능합니다.'
        }, 400);
      }
    }

    // 퇴실 시간 검증 (8~11시, 1시간 단위)
    if (checkOutTime !== undefined) {
      if (!Number.isInteger(checkOutTime) || checkOutTime < 8 || checkOutTime > 11) {
        return error(res, {
          code: 4006,
          message: '퇴실 시간은 8시~11시 사이의 정수만 입력 가능합니다.'
        }, 400);
      }
    }

    await room.update({
      description,
      maxGuests: maxGuests !== undefined ? maxGuests : room.maxGuests,
      checkInTime: checkInTime !== undefined ? checkInTime : room.checkInTime,
      checkOutTime: checkOutTime !== undefined ? checkOutTime : room.checkOutTime
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
        { model: EzService, as: 'ezService' }
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

    // approved/published/pending_review 상태: 수정 API에서 이미 재심사 처리됨 → 현재 status 유지
    if (room.status !== 'draft' && room.status !== 'rejected') {
      return success(res, {
        roomId: room.id,
        status: room.status
      }, '방 정보가 저장되었습니다.');
    }

    // draft/rejected → 최초 심사 요청
    await room.update({
      status: 'pending_review',
      submittedAt: new Date()
    });

    // 지도 캐시 무효화 (나중에 승인되면 지도에 표시됨)
    await invalidateRoomCache();

    return success(res, {
      roomId: room.id,
      status: room.status,
      submittedAt: room.submittedAt ? toKSTString(room.submittedAt) : null
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

    // 재심사 트리거: 사진 삭제 시
    const needsReview = REVIEW_TRIGGER_STATUSES.includes(room.status);

    // 복제본이 같은 URL을 참조 중인지 확인 → 아무도 참조 안 할 때만 S3/로컬 파일 삭제
    const urlRefCount = await RoomPhoto.count({ where: { url: photo.url } });
    await photo.destroy();
    if (urlRefCount === 1 && isProduction) {
      await deleteFromS3(photo.url);
    }

    if (needsReview) {
      await room.update({ status: 'pending_review', submittedAt: new Date() });
    }

    // 지도 캐시 무효화 (thumbnail 변경 가능)
    await invalidateRoomCache();

    return success(res, {
      status: needsReview ? 'pending_review' : room.status
    }, needsReview ? '사진이 삭제되었습니다. 변경된 항목이 있어 재심사가 진행됩니다.' : '사진이 삭제되었습니다.');
  } catch (err) {
    console.error('Photo delete error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

// 12. 내 방 목록 조회
const getMyRooms = async (req, res) => {
  try {
    const hostId = req.user.id;
    const { status, isActive, search, page = 1, limit = 10 } = req.query;

    const where = {
      hostId,
      deletedAt: null  // 삭제되지 않은 방만 조회
    };

    if (status) {
      where.status = status;
    }

    // isActive 필터링 (게시/비공개)
    if (isActive !== undefined) {
      where.isActive = isActive === 'true';
    }

    // 검색 기능 (방 이름 또는 주소)
    if (search && search.trim()) {
      where[Op.or] = [
        { roomName: { [Op.like]: `%${search.trim()}%` } },
        { address: { [Op.like]: `%${search.trim()}%` } }
      ];
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
          model: EzService,
          as: 'ezService',
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
        isActive: room.isActive,
        photos: room.photos && room.photos.length > 0
          ? room.photos.map(photo => ({
              url: toAbsoluteUrl(photo.url),
              order: photo.order
            }))
          : [],
        registrationProgress,
        submittedAt: room.submittedAt ? toKSTString(room.submittedAt) : null,
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
          model: EzService,
          as: 'ezService'
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
        basicOptions: safeParseJson(room.amenity.basicOptions),
        additionalOptions: safeParseJson(room.amenity.additionalOptions),
        convenienceOptions: safeParseJson(room.amenity.convenienceOptions),
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

      // 등록 진행 상태
      registrationProgress
    };

    return success(res, responseData);
  } catch (err) {
    console.error('Get room error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

// 14. 방 상태 변경 (게시/비공개)
const updateRoomStatus = async (req, res) => {
  try {
    const { roomId } = req.params;
    const hostId = req.user.id;
    const { isActive } = req.body;

    // 입력값 검증
    if (typeof isActive !== 'boolean') {
      return error(res, ErrorCodes.VALIDATION_ERROR, 400,
        { field: 'isActive', message: 'isActive는 true 또는 false여야 합니다.' });
    }

    // 방 조회
    const room = await Room.findOne({ where: { id: roomId, hostId } });
    if (!room) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    // 상태 검증: approved 또는 published 상태만 게시/비공개 전환 가능
    if (room.status !== 'approved' && room.status !== 'published') {
      return error(res, ErrorCodes.ROOM_STATUS_NOT_APPROVED, 400);
    }

    // 상태 변경
    await room.update({
      isActive,
      publishedAt: isActive && !room.publishedAt ? new Date() : room.publishedAt
    });

    // 캐시 무효화
    await invalidateRoomCache();

    return updated(res, {
      roomId: room.id,
      status: room.status,
      isActive: room.isActive,
      publishedAt: room.publishedAt
    }, isActive ? '방이 게시되었습니다.' : '방이 비공개 처리되었습니다.');
  } catch (err) {
    console.error('Update room status error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

// 15. 방 삭제 (Soft Delete)
const deleteRoom = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { roomId } = req.params;
    const hostId = req.user.id;

    // 방 조회
    const room = await Room.findOne({ where: { id: roomId, hostId } });
    if (!room) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    // 이미 삭제된 방인지 확인
    if (room.deletedAt) {
      return error(res, ErrorCodes.ROOM_ALREADY_DELETED, 400);
    }

    // 계약 존재 여부 확인 (활성 계약만)
    const contractCount = await Contract.count({
      where: {
        roomId: room.id,
        status: { [Op.in]: ['pending', 'approved', 'active'] }
      }
    });

    if (contractCount > 0) {
      return error(res, ErrorCodes.ROOM_HAS_CONTRACTS, 400);
    }

    // Soft Delete
    await room.update({
      deletedAt: new Date()
    }, { transaction });

    await transaction.commit();

    // 캐시 무효화
    await invalidateRoomCache();

    return deleted(res, '방이 삭제되었습니다.');
  } catch (err) {
    await transaction.rollback();
    console.error('Delete room error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

// 16. 방 복제
const duplicateRoom = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { roomId } = req.params;
    const hostId = req.user.id;
    const {
      includePhotos = true,
      includeAmenities = true,
      includeEzService = true
    } = req.body;

    // 원본 방 조회 (연관 데이터 포함)
    const originalRoom = await Room.findOne({
      where: { id: roomId, hostId },
      include: [
        { model: RoomPhoto, as: 'photos', order: [['order', 'ASC']] },
        { model: RoomAmenity, as: 'amenity' },
        { model: EzService, as: 'ezService' }
      ]
    });

    if (!originalRoom) {
      return error(res, ErrorCodes.ROOM_NOT_FOUND, 404);
    }

    // 새 방 생성
    const newRoom = await Room.create({
      hostId,
      roomName: `${originalRoom.roomName} (복제)`,
      address: originalRoom.address,
      detailAddress: originalRoom.detailAddress,
      latitude: originalRoom.latitude,
      longitude: originalRoom.longitude,
      area: originalRoom.area,
      floor: originalRoom.floor,
      buildingType: originalRoom.buildingType,
      parkingAvailable: originalRoom.parkingAvailable,
      parkingInfo: originalRoom.parkingInfo,
      elevatorAvailable: originalRoom.elevatorAvailable,
      roomCount: originalRoom.roomCount,
      bathroomCount: originalRoom.bathroomCount,
      isDuplex: originalRoom.isDuplex,
      entrancePassword: originalRoom.entrancePassword,
      dailyRent: originalRoom.dailyRent,
      dailyMaintenanceFee: originalRoom.dailyMaintenanceFee,
      longTermWeeks: originalRoom.longTermWeeks,
      longTermDiscount: originalRoom.longTermDiscount,
      quickMoveIn: originalRoom.quickMoveIn,
      quickMoveInDiscount: originalRoom.quickMoveInDiscount,
      maintenanceDetail: originalRoom.maintenanceDetail,
      includeElectricity: originalRoom.includeElectricity,
      includeWater: originalRoom.includeWater,
      includeGas: originalRoom.includeGas,
      includeInternet: originalRoom.includeInternet,
      cleaningFee: originalRoom.cleaningFee,
      minContractDays: originalRoom.minContractDays,
      refundPolicy: originalRoom.refundPolicy,
      description: originalRoom.description,
      maxGuests: originalRoom.maxGuests,
      checkInTime: originalRoom.checkInTime,
      checkOutTime: originalRoom.checkOutTime,
      status: 'draft',
      isActive: true
    }, { transaction });

    // 사진 복제
    if (includePhotos && originalRoom.photos && originalRoom.photos.length > 0) {
      const photoPromises = originalRoom.photos.map(photo =>
        RoomPhoto.create({
          roomId: newRoom.id,
          url: photo.url,
          order: photo.order
        }, { transaction })
      );
      await Promise.all(photoPromises);
    }

    // 편의시설 복제
    if (includeAmenities && originalRoom.amenity) {
      await RoomAmenity.create({
        roomId: newRoom.id,
        basicOptions: safeParseJson(originalRoom.amenity.basicOptions),
        additionalOptions: safeParseJson(originalRoom.amenity.additionalOptions),
        convenienceOptions: safeParseJson(originalRoom.amenity.convenienceOptions),
        petsAllowed: originalRoom.amenity.petsAllowed,
        wifiPassword: originalRoom.amenity.wifiPassword
      }, { transaction });
    }

    // 이지서비스 복제
    if (includeEzService && originalRoom.ezService) {
      await EzService.create({
        roomId: newRoom.id,
        cleaningService: originalRoom.ezService.cleaningService,
        roomPassword: originalRoom.ezService.roomPassword
      }, { transaction });
    }

    await transaction.commit();

    return created(res, {
      roomId: newRoom.id,
      roomName: newRoom.roomName,
      status: newRoom.status,
      copiedFrom: originalRoom.id
    }, '방이 복제되었습니다. 수정 후 등록해주세요.');
  } catch (err) {
    await transaction.rollback();
    console.error('Duplicate room error:', err);
    return error(res, ErrorCodes.DUPLICATE_ROOM_FAILED, 500, err.message);
  }
};

// 호스트 계좌정보 조회
const getHostAccount = async (req, res) => {
  try {
    const hostId = req.user.id;

    const account = await UserBankAccount.findOne({
      where: { userId: hostId },
      attributes: ['id', 'bankName', 'accountNumber', 'accountHolder', 'isVerified', 'verifiedAt', 'isPrimary', 'createdAt']
    });

    if (!account) {
      return error(res, { code: 3005, message: '등록된 계좌가 없습니다.' }, 404);
    }

    // 계좌번호 뒷 6자리 마스킹 (예: 1234-5678-9012 → 1234-56******)
    const maskedAccountNumber = account.accountNumber.replace(/(\d{6})$/, '******');

    return success(res, {
      account: {
        id: account.id,
        bankName: account.bankName,
        accountNumber: maskedAccountNumber,
        accountHolder: account.accountHolder,
        isVerified: account.isVerified,
        verifiedAt: account.verifiedAt,
        isPrimary: account.isPrimary,
        createdAt: account.createdAt
      }
    });

  } catch (err) {
    console.error('호스트 계좌 정보 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

// ========================================
// 영수증 설정 API
// ========================================

// 영수증 설정 조회
const getReceipt = async (req, res) => {
  try {
    const userId = req.user.id;

    const setting = await ReceiptSetting.findOne({
      where: { userId },
      attributes: {
        exclude: ['userId']
      }
    });

    return success(res, setting || null);
  } catch (err) {
    console.error('Get receipt setting error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

// 영수증 설정 저장/수정 (upsert)
const upsertReceipt = async (req, res) => {
  try {
    const userId = req.user.id;
    const { type, number, businessName, repName, email } = req.body;

    // 1. type 검증
    const validTypes = ['personal', 'business', 'tax_invoice'];
    if (!type || !validTypes.includes(type)) {
      return error(res, ErrorCodes.INVALID_RECEIPT_TYPE, 400);
    }

    // 2. number 검증
    const { validateReceiptNumber } = require('../utils/validator');
    const numberValidation = validateReceiptNumber(number, type);
    if (!numberValidation.valid) {
      return error(res, ErrorCodes.INVALID_RECEIPT_NUMBER, 400, { message: numberValidation.message });
    }

    // 3. tax_invoice 추가 필드 검증
    if (type === 'tax_invoice') {
      if (!businessName || !businessName.trim()) {
        return error(res, ErrorCodes.RECEIPT_BUSINESS_NAME_REQUIRED, 400);
      }
      if (!repName || !repName.trim()) {
        return error(res, ErrorCodes.RECEIPT_REP_NAME_REQUIRED, 400);
      }
      // email은 선택이지만, 입력 시 형식 검증
      if (email && email.trim()) {
        const { validateEmail } = require('../utils/validator');
        const emailValidation = validateEmail(email);
        if (!emailValidation.valid) {
          return error(res, ErrorCodes.INVALID_EMAIL, 400);
        }
      }
    }

    // 숫자만 추출하여 저장
    const cleanedNumber = number.replace(/[^0-9]/g, '');

    const updateData = {
      userId,
      receiptType: type,
      receiptNumber: cleanedNumber,
      businessName: type === 'tax_invoice' ? businessName.trim() : null,
      repName: type === 'tax_invoice' ? repName.trim() : null,
      email: type === 'tax_invoice' && email ? email.trim() : null
    };

    // 기존 설정 확인
    const existing = await ReceiptSetting.findOne({ where: { userId } });

    let setting;
    if (existing) {
      await existing.update(updateData);
      setting = existing;
    } else {
      setting = await ReceiptSetting.create(updateData);
    }

    // 응답에서 userId 제외
    const responseData = setting.toJSON();
    delete responseData.userId;

    return updated(res, responseData, '영수증 정보가 저장되었습니다.');
  } catch (err) {
    console.error('Upsert receipt setting error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

// 영수증 설정 삭제
const deleteReceipt = async (req, res) => {
  try {
    const userId = req.user.id;

    const existing = await ReceiptSetting.findOne({ where: { userId } });
    if (!existing) {
      return error(res, ErrorCodes.RECEIPT_NOT_FOUND, 404);
    }

    await existing.destroy();
    return deleted(res, '영수증 설정이 삭제되었습니다.');
  } catch (err) {
    console.error('Delete receipt setting error:', err);
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
  getRoom,
  updateRoomStatus,
  deleteRoom,
  duplicateRoom,
  getHostAccount,
  getReceipt,
  upsertReceipt,
  deleteReceipt
};
