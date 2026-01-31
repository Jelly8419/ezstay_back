const { User, UserBankAccount, LocalUser, sequelize } = require('../models');
const { ErrorCodes, success, error } = require('../utils/responseHelper');
const bcrypt = require('bcryptjs');
const { validatePassword, validatePhoneNumber } = require('../utils/validator');

// 게스트 본인인증정보 저장
const saveGuestVerification = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { name, phone_number, terms } = req.body;
    const userId = req.user.id;

    // 필수 필드 검증
    if (!name || !phone_number) {
      await transaction.rollback();
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400);
    }

    // 필수 약관 동의 검증
    if (!terms || !terms.service_terms || !terms.privacy_policy || !terms.age_confirmed) {
      await transaction.rollback();
      return error(res, { code: 4501, message: '필수 약관에 동의해야 합니다.' }, 400);
    }

    // Users 테이블 업데이트 (본인인증정보 + 약관정보)
    const updatedUser = await User.update({
      name: name,
      nickname: name,  // 본인인증 시 nickname도 동기화
      phoneNumber: phone_number,
      phoneVerified: true,
      phoneVerifiedAt: new Date(),
      serviceTermsAgreed: terms.service_terms,
      privacyPolicyAgreed: terms.privacy_policy,
      marketingConsent: terms.marketing_consent || false,
      ageConfirmed: terms.age_confirmed,
      termsAgreedAt: new Date()
    }, {
      where: { id: userId },
      transaction
    });

    if (updatedUser[0] === 0) {
      await transaction.rollback();
      return error(res, ErrorCodes.USER_NOT_FOUND, 404);
    }

    await transaction.commit();

    return success(res, {
      user: {
        name: name,
        nickname: name,
        phoneNumber: phone_number,
        phoneVerified: true,
        userType: 'guest'
      },
      terms: {
        serviceTermsAgreed: terms.service_terms,
        privacyPolicyAgreed: terms.privacy_policy,
        marketingConsent: terms.marketing_consent || false,
        ageConfirmed: terms.age_confirmed,
        termsAgreedAt: new Date()
      }
    }, '본인인증이 완료되었습니다.');

  } catch (err) {
    await transaction.rollback();
    console.error('게스트 인증정보 저장 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, process.env.NODE_ENV === 'development' ? err.message : undefined);
  }
};

// 호스트 본인인증 + 계좌정보 저장
const saveHostVerification = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const {
      name,
      phone_number,
      bank_code,
      account_num,
      account_holder_name,
      terms
    } = req.body;

    const userId = req.user.id;

    // 모든 필드 필수 검증
    if (!name || !phone_number || !bank_code || !account_num || !account_holder_name) {
      await transaction.rollback();
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400);
    }

    // 필수 약관 동의 검증
    if (!terms || !terms.service_terms || !terms.privacy_policy || !terms.age_confirmed) {
      await transaction.rollback();
      return error(res, { code: 4501, message: '필수 약관에 동의해야 합니다.' }, 400);
    }

    // Users 테이블 업데이트 (본인인증정보 + 약관정보)
    const updatedUser = await User.update({
      name: name,
      nickname: name,  // 본인인증 시 nickname도 동기화
      phoneNumber: phone_number,
      phoneVerified: true,
      phoneVerifiedAt: new Date(),
      serviceTermsAgreed: terms.service_terms,
      privacyPolicyAgreed: terms.privacy_policy,
      marketingConsent: terms.marketing_consent || false,
      ageConfirmed: terms.age_confirmed,
      termsAgreedAt: new Date()
    }, {
      where: { id: userId },
      transaction
    });

    if (updatedUser[0] === 0) {
      await transaction.rollback();
      return error(res, ErrorCodes.USER_NOT_FOUND, 404);
    }

    // 계좌정보 저장
    const cleanAccountNum = account_num.replace(/-/g, '');

    const existingAccount = await UserBankAccount.findOne({
      where: { userId },
      transaction
    });

    const accountData = {
      userId,
      bankName: bank_code,
      accountNumber: cleanAccountNum,
      accountHolder: account_holder_name,
      isVerified: true,
      verifiedAt: new Date(),
      isPrimary: true
    };

    if (existingAccount) {
      await existingAccount.update(accountData, { transaction });
    } else {
      await UserBankAccount.create(accountData, { transaction });
    }

    await transaction.commit();

    return success(res, {
      user: {
        name: name,
        nickname: name,
        phoneNumber: phone_number,
        phoneVerified: true,
        userType: 'host',
        hasBank: true
      },
      bankInfo: {
        bankName: bank_code,
        accountHolder: account_holder_name
      },
      terms: {
        serviceTermsAgreed: terms.service_terms,
        privacyPolicyAgreed: terms.privacy_policy,
        marketingConsent: terms.marketing_consent || false,
        ageConfirmed: terms.age_confirmed,
        termsAgreedAt: new Date()
      }
    }, '본인인증 및 계좌등록이 완료되었습니다.');

  } catch (err) {
    await transaction.rollback();
    console.error('호스트 인증정보 저장 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, process.env.NODE_ENV === 'development' ? err.message : undefined);
  }
};

// 사용자 인증 상태 조회
const getVerificationStatus = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findByPk(userId, {
      attributes: [
        'id', 'name', 'nickname', 'phoneNumber', 'phoneVerified', 'phoneVerifiedAt',
        'serviceTermsAgreed', 'privacyPolicyAgreed', 'marketingConsent',
        'ageConfirmed', 'termsAgreedAt'
      ]
    });

    if (!user) {
      return error(res, ErrorCodes.USER_NOT_FOUND, 404);
    }

    // 계좌 등록 여부 확인
    const bankAccount = await UserBankAccount.findOne({
      where: { userId },
      attributes: ['id', 'bankName', 'accountHolder', 'isVerified']
    });

    return success(res, {
      user: {
        id: user.id,
        name: user.name,
        nickname: user.nickname,
        phoneNumber: user.phoneNumber,
        phoneVerified: user.phoneVerified || false,
        phoneVerifiedAt: user.phoneVerifiedAt,
        hasBank: !!bankAccount,
        bankInfo: bankAccount ? {
          bankName: bankAccount.bankName,
          accountHolder: bankAccount.accountHolder,
          isVerified: bankAccount.isVerified
        } : null
      },
      terms: {
        serviceTermsAgreed: user.serviceTermsAgreed || false,
        privacyPolicyAgreed: user.privacyPolicyAgreed || false,
        marketingConsent: user.marketingConsent || false,
        ageConfirmed: user.ageConfirmed || false,
        termsAgreedAt: user.termsAgreedAt
      }
    });

  } catch (err) {
    console.error('인증 상태 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

// 사용자 프로필 조회
const getProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findByPk(userId, {
      attributes: ['id', 'email', 'name', 'nickname', 'phoneNumber', 'createdAt']
    });

    if (!user) {
      return error(res, ErrorCodes.USER_NOT_FOUND, 404);
    }

    return success(res, {
      id: user.id,
      email: user.email,
      name: user.name,
      nickname: user.nickname,
      phoneNumber: user.phoneNumber,
      createdAt: user.createdAt
    });

  } catch (err) {
    console.error('프로필 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, process.env.NODE_ENV === 'development' ? err.message : undefined);
  }
};

// 비밀번호 변경
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    // 필수 필드 검증
    if (!currentPassword || !newPassword) {
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400);
    }

    // 새 비밀번호 강도 검증
    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.valid) {
      return error(res, { code: 4004, message: passwordValidation.message }, 400);
    }

    // LocalUser 조회
    const localUser = await LocalUser.findOne({
      where: { userId }
    });

    if (!localUser) {
      return error(res, { code: 4005, message: '이메일 회원이 아닙니다.' }, 400);
    }

    // 현재 비밀번호 검증
    const isPasswordValid = await bcrypt.compare(currentPassword, localUser.password);
    if (!isPasswordValid) {
      return error(res, { code: 4006, message: '현재 비밀번호가 일치하지 않습니다.' }, 400);
    }

    // 새 비밀번호와 현재 비밀번호가 같은지 확인
    const isSamePassword = await bcrypt.compare(newPassword, localUser.password);
    if (isSamePassword) {
      return error(res, { code: 4007, message: '새 비밀번호는 현재 비밀번호와 달라야 합니다.' }, 400);
    }

    // 비밀번호 해싱
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // 비밀번호 업데이트
    await localUser.update({
      password: hashedPassword
    });

    return success(res, null, '비밀번호가 성공적으로 변경되었습니다.');

  } catch (err) {
    console.error('비밀번호 변경 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, process.env.NODE_ENV === 'development' ? err.message : undefined);
  }
};

// 닉네임 변경
const changeNickname = async (req, res) => {
  try {
    const { nickname } = req.body;
    const userId = req.user.id;

    // 필수 필드 검증
    if (!nickname || !nickname.trim()) {
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400);
    }

    const trimmedNickname = nickname.trim();

    // 닉네임 길이 검증 (2~20자)
    if (trimmedNickname.length < 2 || trimmedNickname.length > 20) {
      return error(res, { code: 4009, message: '닉네임은 2~20자 사이여야 합니다.' }, 400);
    }

    // 사용자 정보 업데이트
    const [updated] = await User.update({
      nickname: trimmedNickname
    }, {
      where: { id: userId }
    });

    if (updated === 0) {
      return error(res, ErrorCodes.USER_NOT_FOUND, 404);
    }

    return success(res, { nickname: trimmedNickname }, '닉네임이 성공적으로 변경되었습니다.');

  } catch (err) {
    console.error('닉네임 변경 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, process.env.NODE_ENV === 'development' ? err.message : undefined);
  }
};

// 연락처 변경
const changePhoneNumber = async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    const userId = req.user.id;

    // 필수 필드 검증
    if (!phoneNumber) {
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400);
    }

    // 전화번호 형식 검증
    const phoneValidation = validatePhoneNumber(phoneNumber);
    if (!phoneValidation.valid) {
      return error(res, { code: 4008, message: phoneValidation.message }, 400);
    }

    // 사용자 정보 업데이트
    const [updated] = await User.update({
      phoneNumber: phoneNumber,
      phoneVerified: true,
      phoneVerifiedAt: new Date()
    }, {
      where: { id: userId }
    });

    if (updated === 0) {
      return error(res, ErrorCodes.USER_NOT_FOUND, 404);
    }

    return success(res, { phoneNumber }, '연락처가 성공적으로 변경되었습니다.');

  } catch (err) {
    console.error('연락처 변경 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, process.env.NODE_ENV === 'development' ? err.message : undefined);
  }
};

// 회원 탈퇴 (Soft Delete)
const deleteAccount = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const userId = req.user.id;

    // 사용자 계정 비활성화 (Soft Delete)
    const [updated] = await User.update({
      isActive: false,
      refreshToken: null // 리프레시 토큰 삭제
    }, {
      where: { id: userId },
      transaction
    });

    if (updated === 0) {
      await transaction.rollback();
      return error(res, ErrorCodes.USER_NOT_FOUND, 404);
    }

    await transaction.commit();

    return success(res, null, '회원 탈퇴가 완료되었습니다.');

  } catch (err) {
    await transaction.rollback();
    console.error('회원 탈퇴 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, process.env.NODE_ENV === 'development' ? err.message : undefined);
  }
};

module.exports = {
  saveGuestVerification,
  saveHostVerification,
  getVerificationStatus,
  getProfile,
  changePassword,
  changeNickname,
  changePhoneNumber,
  deleteAccount
};