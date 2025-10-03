const { Room, RoomPhoto, RoomAmenity, RoomFreeService, sequelize } = require('../models');

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
      livingRoomCount,
      kitchenCount,
      isDuplex,
      entrancePassword
    } = req.body;

    // 필수 필드 검증
    if (!roomName || !address || !detailAddress || !area || !buildingType) {
      return res.status(400).json({
        success: false,
        message: '필수 정보를 모두 입력해주세요.'
      });
    }

    const room = await Room.create({
      hostId,
      roomName,
      address,
      detailAddress,
      area,
      floor,
      buildingType,
      parkingAvailable: parkingAvailable || false,
      parkingInfo,
      elevatorAvailable: elevatorAvailable || false,
      roomCount: roomCount || 0,
      bathroomCount: bathroomCount || 0,
      livingRoomCount: livingRoomCount || 0,
      kitchenCount: kitchenCount || 0,
      isDuplex: isDuplex || false,
      entrancePassword,
      status: 'draft'
    }, { transaction });

    await transaction.commit();

    res.status(201).json({
      success: true,
      message: '방 기본 정보가 등록되었습니다.',
      data: {
        roomId: room.id,
        status: room.status
      }
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Room creation error:', error);
    res.status(500).json({
      success: false,
      message: '방 등록 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

// 2. 요금 설정
const updatePricing = async (req, res) => {
  try {
    const { roomId } = req.params;
    const hostId = req.user.id;
    const {
      weeklyRent,
      longTermWeeks,
      longTermDiscount,
      quickMoveIn,
      quickMoveInDiscount,
      maintenanceFee,
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
      return res.status(404).json({
        success: false,
        message: '방을 찾을 수 없습니다.'
      });
    }

    await room.update({
      weeklyRent,
      longTermWeeks,
      longTermDiscount,
      quickMoveIn,
      quickMoveInDiscount,
      maintenanceFee,
      maintenanceDetail,
      includeElectricity: includeElectricity || false,
      includeWater: includeWater || false,
      includeGas: includeGas || false,
      includeInternet: includeInternet || false,
      cleaningFee,
      minContractWeeks,
      refundPolicy
    });

    res.status(200).json({
      success: true,
      message: '요금 정보가 저장되었습니다.',
      data: {
        roomId: room.id
      }
    });
  } catch (error) {
    console.error('Pricing update error:', error);
    res.status(500).json({
      success: false,
      message: '요금 설정 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

// 3. 사진 업로드
const uploadPhotos = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { roomId } = req.params;
    const hostId = req.user.id;

    const room = await Room.findOne({
      where: { id: roomId, hostId }
    });

    if (!room) {
      return res.status(404).json({
        success: false,
        message: '방을 찾을 수 없습니다.'
      });
    }

    // multer로 업로드된 파일들 처리 (실제 파일 업로드 미들웨어 필요)
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: '최소 6장의 사진을 업로드해주세요.'
      });
    }

    if (req.files.length < 6 || req.files.length > 20) {
      return res.status(400).json({
        success: false,
        message: '사진은 최소 6장, 최대 20장까지 업로드 가능합니다.'
      });
    }

    const photoUrls = [];
    for (let i = 0; i < req.files.length; i++) {
      // 상대 경로로 저장 (프론트엔드에서 baseURL + path 형태로 사용)
      const relativePath = `/uploads/rooms/${req.files[i].filename}`;

      const photo = await RoomPhoto.create({
        roomId: room.id,
        url: relativePath,
        order: i
      }, { transaction });

      photoUrls.push({
        id: photo.id,
        url: photo.url,
        order: photo.order
      });
    }

    await transaction.commit();

    res.status(200).json({
      success: true,
      message: '사진이 업로드되었습니다.',
      data: {
        photoUrls
      }
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Photo upload error:', error);
    res.status(500).json({
      success: false,
      message: '사진 업로드 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

// 4. 편의시설 설정
const updateAmenities = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { roomId } = req.params;
    const hostId = req.user.id;
    const {
      basicOptions,
      additionalOptions,
      convenienceOptions,
      petsAllowed
    } = req.body;

    const room = await Room.findOne({
      where: { id: roomId, hostId }
    });

    if (!room) {
      return res.status(404).json({
        success: false,
        message: '방을 찾을 수 없습니다.'
      });
    }

    // RoomAmenity 생성 또는 업데이트
    await RoomAmenity.upsert({
      roomId: room.id,
      basicOptions: basicOptions || {},
      additionalOptions: additionalOptions || {},
      convenienceOptions: convenienceOptions || {},
      petsAllowed: petsAllowed || false
    }, { transaction });

    await transaction.commit();

    res.status(200).json({
      success: true,
      message: '편의시설 정보가 저장되었습니다.',
      data: {
        roomId: room.id
      }
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Amenities update error:', error);
    res.status(500).json({
      success: false,
      message: '편의시설 설정 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

// 5. 무료 부가서비스 설정
const updateFreeServices = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { roomId } = req.params;
    const hostId = req.user.id;
    const {
      agreeTerms,
      cleaningService,
      cleaningToolImageUrl,
      hairDryerRental,
      beddingService,
      bedSizes,
      autoPasswordChange,
      roomPassword
    } = req.body;

    const room = await Room.findOne({
      where: { id: roomId, hostId }
    });

    if (!room) {
      return res.status(404).json({
        success: false,
        message: '방을 찾을 수 없습니다.'
      });
    }

    await RoomFreeService.upsert({
      roomId: room.id,
      agreeTerms: agreeTerms || false,
      cleaningService: cleaningService || false,
      cleaningToolImageUrl,
      hairDryerRental: hairDryerRental || false,
      beddingService: beddingService || false,
      bedSizeSuperSingle: bedSizes?.['슈퍼싱글'] || 0,
      bedSizeQueen: bedSizes?.['퀸'] || 0,
      bedSizeKing: bedSizes?.['킹'] || 0,
      autoPasswordChange: autoPasswordChange || false,
      roomPassword
    }, { transaction });

    await transaction.commit();

    res.status(200).json({
      success: true,
      message: '무료 부가서비스 정보가 저장되었습니다.',
      data: {
        roomId: room.id
      }
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Free services update error:', error);
    res.status(500).json({
      success: false,
      message: '무료 부가서비스 설정 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

// 6. 청소도구 이미지 업로드
const uploadCleaningToolImage = async (req, res) => {
  try {
    const { roomId } = req.params;
    const hostId = req.user.id;

    const room = await Room.findOne({
      where: { id: roomId, hostId }
    });

    if (!room) {
      return res.status(404).json({
        success: false,
        message: '방을 찾을 수 없습니다.'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: '이미지를 업로드해주세요.'
      });
    }

    const imageUrl = `/uploads/rooms/${req.file.filename}`;

    const freeService = await RoomFreeService.findOne({
      where: { roomId: room.id }
    });

    if (freeService) {
      await freeService.update({ cleaningToolImageUrl: imageUrl });
    }

    res.status(200).json({
      success: true,
      message: '청소도구 이미지가 업로드되었습니다.',
      data: {
        imageUrl
      }
    });
  } catch (error) {
    console.error('Cleaning tool image upload error:', error);
    res.status(500).json({
      success: false,
      message: '이미지 업로드 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

// 7. 방 소개 및 설명
const updateDescription = async (req, res) => {
  try {
    const { roomId } = req.params;
    const hostId = req.user.id;
    const { description, transportation, houseRules } = req.body;

    const room = await Room.findOne({
      where: { id: roomId, hostId }
    });

    if (!room) {
      return res.status(404).json({
        success: false,
        message: '방을 찾을 수 없습니다.'
      });
    }

    await room.update({
      description,
      transportation,
      houseRules
    });

    res.status(200).json({
      success: true,
      message: '방 소개가 저장되었습니다.',
      data: {
        roomId: room.id
      }
    });
  } catch (error) {
    console.error('Description update error:', error);
    res.status(500).json({
      success: false,
      message: '방 소개 저장 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

// 8. 심사 요청
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
      return res.status(404).json({
        success: false,
        message: '방을 찾을 수 없습니다.'
      });
    }

    // 필수 정보 검증
    if (!room.photos || room.photos.length < 6) {
      return res.status(400).json({
        success: false,
        message: '최소 6장의 사진이 필요합니다.'
      });
    }

    if (!room.weeklyRent || !room.description) {
      return res.status(400).json({
        success: false,
        message: '요금 정보와 방 소개를 모두 입력해주세요.'
      });
    }

    await room.update({
      status: 'pending_review',
      submittedAt: new Date()
    });

    res.status(200).json({
      success: true,
      message: '심사 요청이 완료되었습니다.',
      data: {
        roomId: room.id,
        status: room.status,
        submittedAt: room.submittedAt
      }
    });
  } catch (error) {
    console.error('Submit review error:', error);
    res.status(500).json({
      success: false,
      message: '심사 요청 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

// 9. 사진 순서 변경
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
      return res.status(404).json({
        success: false,
        message: '방을 찾을 수 없습니다.'
      });
    }

    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: '사진 ID 배열이 필요합니다.'
      });
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

    res.status(200).json({
      success: true,
      message: '사진 순서가 변경되었습니다.'
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Photo reorder error:', error);
    res.status(500).json({
      success: false,
      message: '사진 순서 변경 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

// 10. 사진 삭제
const deletePhoto = async (req, res) => {
  try {
    const { roomId, photoId } = req.params;
    const hostId = req.user.id;

    const room = await Room.findOne({
      where: { id: roomId, hostId }
    });

    if (!room) {
      return res.status(404).json({
        success: false,
        message: '방을 찾을 수 없습니다.'
      });
    }

    const photo = await RoomPhoto.findOne({
      where: { id: photoId, roomId: room.id }
    });

    if (!photo) {
      return res.status(404).json({
        success: false,
        message: '사진을 찾을 수 없습니다.'
      });
    }

    await photo.destroy();

    res.status(200).json({
      success: true,
      message: '사진이 삭제되었습니다.'
    });
  } catch (error) {
    console.error('Photo delete error:', error);
    res.status(500).json({
      success: false,
      message: '사진 삭제 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

// 11. 방 정보 조회
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
      return res.status(404).json({
        success: false,
        message: '방을 찾을 수 없습니다.'
      });
    }

    // 응답 데이터 구조화
    const responseData = {
      // 기본 정보
      roomName: room.roomName,
      address: room.address,
      detailAddress: room.detailAddress,
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
      entrancePassword: room.entrancePassword,

      // 요금 정보
      weeklyRent: room.weeklyRent,
      longTermWeeks: room.longTermWeeks,
      longTermDiscount: room.longTermDiscount,
      quickMoveIn: room.quickMoveIn,
      quickMoveInDiscount: room.quickMoveInDiscount,
      maintenanceFee: room.maintenanceFee,
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
      publishedAt: room.publishedAt
    };

    res.status(200).json({
      success: true,
      data: responseData
    });
  } catch (error) {
    console.error('Get room error:', error);
    res.status(500).json({
      success: false,
      message: '방 정보 조회 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

module.exports = {
  createRoom,
  updatePricing,
  uploadPhotos,
  updateAmenities,
  updateFreeServices,
  uploadCleaningToolImage,
  updateDescription,
  submitReview,
  reorderPhotos,
  deletePhoto,
  getRoom
};
