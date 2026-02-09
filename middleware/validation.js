const { User, UserBankAccount } = require('../models');

/**
 * 필수 정보 확인 미들웨어
 * 계약 생성, 방 등록 등 주요 액션 전에 사용자의 필수 정보가 입력되었는지 검증
 *
 * @param {Object} options
 * @param {boolean} options.requirePhone - 전화번호 필수 여부 (기본: true)
 * @param {boolean} options.requireBankAccount - 계좌정보 필수 여부 (기본: false, 호스트만)
 * @param {boolean} options.requireVerification - 본인인증 필수 여부 (기본: false)
 */
const requireUserInfo = (options = {}) => {
  const {
    requirePhone = true,
    requireBankAccount = false,
    requireVerification = false
  } = options;

  return async (req, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: { code: 1001, message: '인증이 필요합니다.' }
        });
      }

      const missingFields = [];

      const user = await User.findByPk(userId, {
        attributes: ['id', 'phoneNumber', 'isVerified']
      });

      if (!user) {
        return res.status(401).json({
          success: false,
          error: { code: 1001, message: '사용자를 찾을 수 없습니다.' }
        });
      }

      if (requirePhone && !user.phoneNumber) {
        missingFields.push('phoneNumber');
      }

      if (requireVerification && !user.isVerified) {
        missingFields.push('verification');
      }

      if (requireBankAccount) {
        const bankAccount = await UserBankAccount.findOne({
          where: { userId, isPrimary: true }
        });
        if (!bankAccount) {
          missingFields.push('bankAccount');
        }
      }

      if (missingFields.length > 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: 4010,
            message: '필수 정보가 입력되지 않았습니다. 마이페이지에서 정보를 입력해주세요.',
            missingFields
          }
        });
      }

      next();
    } catch (err) {
      console.error('필수 정보 확인 오류:', err);
      return res.status(500).json({
        success: false,
        error: { code: 5000, message: '서버 오류가 발생했습니다.' }
      });
    }
  };
};

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
  validateRoomData,
  requireUserInfo
};