const { User, UserBankAccount, sequelize } = require('../models');

// 게스트 본인인증정보 저장
const saveGuestVerification = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { name, phone_number, terms } = req.body;
    const userId = req.user.id;

    // 필수 필드 검증
    if (!name || !phone_number) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: '이름과 전화번호는 필수입니다.'
      });
    }

    // 필수 약관 동의 검증
    if (!terms || !terms.service_terms || !terms.privacy_policy || !terms.age_confirmed) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: '필수 약관에 동의해야 합니다.'
      });
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
      return res.status(404).json({
        success: false,
        message: '사용자를 찾을 수 없습니다.'
      });
    }

    await transaction.commit();

    res.status(200).json({
      success: true,
      message: '본인인증이 완료되었습니다.',
      data: {
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
      }
    });

  } catch (error) {
    await transaction.rollback();
    console.error('게스트 인증정보 저장 오류:', error);
    res.status(500).json({
      success: false,
      message: '본인인증 중 오류가 발생했습니다.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
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
      return res.status(400).json({
        success: false,
        message: '이름, 전화번호, 은행코드, 계좌번호, 예금주명은 모두 필수입니다.'
      });
    }

    // 필수 약관 동의 검증
    if (!terms || !terms.service_terms || !terms.privacy_policy || !terms.age_confirmed) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: '필수 약관에 동의해야 합니다.'
      });
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
      return res.status(404).json({
        success: false,
        message: '사용자를 찾을 수 없습니다.'
      });
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

    res.status(200).json({
      success: true,
      message: '본인인증 및 계좌등록이 완료되었습니다.',
      data: {
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
      }
    });

  } catch (error) {
    await transaction.rollback();
    console.error('호스트 인증정보 저장 오류:', error);
    res.status(500).json({
      success: false,
      message: '호스트 인증 중 오류가 발생했습니다.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
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
      return res.status(404).json({
        success: false,
        message: '사용자를 찾을 수 없습니다.'
      });
    }

    // 계좌 등록 여부 확인
    const bankAccount = await UserBankAccount.findOne({
      where: { userId },
      attributes: ['id', 'bankName', 'accountHolder', 'isVerified']
    });

    res.status(200).json({
      success: true,
      data: {
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
      }
    });

  } catch (error) {
    console.error('인증 상태 조회 오류:', error);
    res.status(500).json({
      success: false,
      message: '인증 상태 조회 중 오류가 발생했습니다.'
    });
  }
};

module.exports = {
  saveGuestVerification,
  saveHostVerification,
  getVerificationStatus
};