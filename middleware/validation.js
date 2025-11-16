const validateRoomData = (req, res, next) => {
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
    isDuplex
  } = req.body;

  const errors = [];

  if (!roomName || roomName.trim().length === 0) {
    errors.push('방 이름은 필수입니다.');
  }

  if (!address || address.trim().length === 0) {
    errors.push('주소는 필수입니다.');
  }

  if (!detailAddress || detailAddress.trim().length === 0) {
    errors.push('상세주소는 필수입니다.');
  }

  if (!area || area <= 0) {
    errors.push('면적은 0보다 큰 숫자여야 합니다.');
  }

  if (!buildingType) {
    errors.push('건물 유형은 필수입니다.');
  }

  const validBuildingTypes = ['아파트', '오피스텔', '빌라', '주택', '원룸', '기타'];
  if (buildingType && !validBuildingTypes.includes(buildingType)) {
    errors.push('유효하지 않은 건물 유형입니다.');
  }

  if (typeof parkingAvailable !== 'boolean') {
    errors.push('주차 가능 여부는 boolean 타입이어야 합니다.');
  }

  if (typeof elevatorAvailable !== 'boolean') {
    errors.push('엘리베이터 가능 여부는 boolean 타입이어야 합니다.');
  }

  if (!roomCount || roomCount < 0) {
    errors.push('방 개수는 0 이상의 숫자여야 합니다.');
  }

  if (!bathroomCount || bathroomCount < 0) {
    errors.push('화장실 개수는 0 이상의 숫자여야 합니다.');
  }

  if (typeof isDuplex !== 'boolean') {
    errors.push('복층 여부는 boolean 타입이어야 합니다.');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: '유효성 검사 실패',
      errors: errors
    });
  }

  next();
};

module.exports = {
  validateRoomData
};