const { User, UserBankAccount, sequelize } = require('../models');
const { ErrorCodes, success, error } = require('../utils/responseHelper');

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
        'id', 'name', 'phoneNumber', 'phoneVerified', 'phoneVerifiedAt',
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

module.exports = {
  saveGuestVerification,
  saveHostVerification,
  getVerificationStatus
};