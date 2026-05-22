const { User, UserBankAccount, LocalUser, UserSession, KmcVerification, sequelize } = require('../models');
const { Op } = require('sequelize');
const { ErrorCodes, success, error } = require('../utils/responseHelper');
const bcrypt = require('bcryptjs');
const { validatePassword, validatePhoneNumber, validateNickname } = require('../utils/validator');
const { safeAutoBindByPhone } = require('../services/moveInGuestBindService');

// 소셜 게스트 본인인증 + 약관 저장
const saveGuestVerification = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    let { name, phone_number, birth, gender, certNum, terms } = req.body;
    const userId = req.user.id;

    // KMC 본인인증 필수
    if (!certNum) {
      await transaction.rollback();
      return error(res, { code: 4015, message: '본인인증이 필요합니다.' }, 400);
    }

    // 필수 약관 동의 검증
    if (!terms || !terms.service_terms || !terms.privacy_policy || !terms.age_confirmed) {
      await transaction.rollback();
      return error(res, { code: 4501, message: '필수 약관에 동의해야 합니다.' }, 400);
    }

    // KMC 인증 결과 서버에서 조회 (certNum은 숫자라 인코딩 문제 없음)
    const certNumStr = String(certNum);
    const kmcRecord = await KmcVerification.findOne({
      where: { certNum: certNumStr, used: false },
      order: [['created_at', 'DESC']]
    });
    if (!kmcRecord) {
      await transaction.rollback();
      return error(res, { code: 4015, message: '본인인증 정보를 찾을 수 없습니다. 다시 인증해주세요.' }, 400);
    }
    if (kmcRecord.expiresAt < new Date()) {
      await transaction.rollback();
      return error(res, { code: 4014, message: '본인인증이 만료되었습니다. 다시 인증해주세요.' }, 400);
    }

    const ci = kmcRecord.ci;
    phone_number = kmcRecord.phoneNumber;
    name         = name || kmcRecord.name;
    birth        = birth || kmcRecord.birth;
    gender       = gender !== undefined ? gender : kmcRecord.gender;

    // CI 중복 체크
    const existingCi = await User.findOne({
      where: { ci, isActive: true, id: { [Op.ne]: userId } }
    });
    if (existingCi) {
      await transaction.rollback();
      return error(res, { code: 4410, message: '이미 가입된 본인인증 정보입니다.' }, 409);
    }

    const updatedUser = await User.update({
      name,
      nickname: name,
      phoneNumber: phone_number,
      phoneVerified: true,
      phoneVerifiedAt: new Date(),
      ...(birth !== undefined && birth !== null && birth !== '' && { birth }),
      ...(gender !== undefined && gender !== null && { gender }),
      ci,
      serviceTermsAgreed: terms.service_terms,
      privacyPolicyAgreed: terms.privacy_policy,
      marketingConsent: terms.marketing_consent || false,
      ageConfirmed: terms.age_confirmed,
      termsAgreedAt: new Date()
    }, { where: { id: userId }, transaction });

    if (updatedUser[0] === 0) {
      await transaction.rollback();
      return error(res, ErrorCodes.USER_NOT_FOUND, 404);
    }

    await kmcRecord.update({ used: true }, { transaction });

    // 입주 준비 서비스 자동 매칭 (PRD 4.4 / 10.2)
    await safeAutoBindByPhone(userId, phone_number, transaction);

    await transaction.commit();

    return success(res, {
      user: {
        name,
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

// 소셜 호스트 본인인증 + 계좌정보 저장
const saveHostVerification = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    let {
      name, phone_number, birth, gender, certNum,
      bank_code, account_num, account_holder_name,
      terms
    } = req.body;

    const userId = req.user.id;

    // KMC 본인인증 필수
    if (!certNum) {
      await transaction.rollback();
      return error(res, { code: 4015, message: '본인인증이 필요합니다.' }, 400);
    }

    // 계좌 필수 검증
    if (!bank_code || !account_num || !account_holder_name) {
      await transaction.rollback();
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400);
    }

    // 필수 약관 동의 검증
    if (!terms || !terms.service_terms || !terms.privacy_policy || !terms.age_confirmed) {
      await transaction.rollback();
      return error(res, { code: 4501, message: '필수 약관에 동의해야 합니다.' }, 400);
    }

    // KMC 인증 결과 서버에서 조회 (certNum은 숫자라 인코딩 문제 없음)
    const certNumStr = String(certNum);
    const kmcRecord = await KmcVerification.findOne({
      where: { certNum: certNumStr, used: false },
      order: [['created_at', 'DESC']]
    });
    if (!kmcRecord) {
      await transaction.rollback();
      return error(res, { code: 4015, message: '본인인증 정보를 찾을 수 없습니다. 다시 인증해주세요.' }, 400);
    }
    if (kmcRecord.expiresAt < new Date()) {
      await transaction.rollback();
      return error(res, { code: 4014, message: '본인인증이 만료되었습니다. 다시 인증해주세요.' }, 400);
    }

    const ci = kmcRecord.ci;
    phone_number = kmcRecord.phoneNumber;
    name         = name || kmcRecord.name;
    birth        = birth || kmcRecord.birth;
    gender       = gender !== undefined ? gender : kmcRecord.gender;

    // CI 중복 체크
    const existingCi = await User.findOne({
      where: { ci, isActive: true, id: { [Op.ne]: userId } }
    });
    if (existingCi) {
      await transaction.rollback();
      return error(res, { code: 4410, message: '이미 가입된 본인인증 정보입니다.' }, 409);
    }

    const updatedUser = await User.update({
      name,
      nickname: name,
      phoneNumber: phone_number,
      phoneVerified: true,
      phoneVerifiedAt: new Date(),
      userMode: 'host',
      ...(birth !== undefined && birth !== null && birth !== '' && { birth }),
      ...(gender !== undefined && gender !== null && { gender }),
      ci,
      serviceTermsAgreed: terms.service_terms,
      privacyPolicyAgreed: terms.privacy_policy,
      marketingConsent: terms.marketing_consent || false,
      ageConfirmed: terms.age_confirmed,
      termsAgreedAt: new Date()
    }, { where: { id: userId }, transaction });

    if (updatedUser[0] === 0) {
      await transaction.rollback();
      return error(res, ErrorCodes.USER_NOT_FOUND, 404);
    }

    await kmcRecord.update({ used: true }, { transaction });

    // 계좌 저장 (upsert)
    const cleanAccountNum = account_num.replace(/-/g, '');
    const existingAccount = await UserBankAccount.findOne({ where: { userId }, transaction });
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

    // 입주 준비 서비스 자동 매칭 (PRD 4.4 / 10.2)
    // 호스트가 동시에 임차인이 될 수도 있으므로 같이 검사 (게스트 PRD 정책)
    await safeAutoBindByPhone(userId, phone_number, transaction);

    await transaction.commit();

    return success(res, {
      user: {
        name,
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

    const validation = validateNickname(nickname);
    if (!validation.valid) {
      return error(res, { code: 4009, message: validation.message }, 400);
    }

    const trimmedNickname = nickname.trim();

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


// 회원 탈퇴 (Soft Delete)
const deleteAccount = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const userId = req.user.id;

    // 사용자 계정 비활성화 (Soft Delete)
    const [updated] = await User.update({
      isActive: false,
      accountStatus: 'withdrawn'
    }, {
      where: { id: userId },
      transaction
    });

    // 모든 세션 삭제
    await UserSession.destroy({
      where: { userId, userType: 'user' },
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
  deleteAccount
};