const { User, LocalUser, SocialUser, UserBankAccount, EmailVerificationCode, KmcVerification, UserSession, sequelize } = require('../models');
const { generateTokens, hashPassword, comparePassword, verifyToken } = require('../utils/auth');
const { ErrorCodes, success, error, created } = require('../utils/responseHelper');
const { validateEmail, validatePassword, generateNickname } = require('../utils/validator');
const { withTransaction } = require('../utils/transactionHelper');
const { Op } = require('sequelize');

// refreshToken 만료 기간 (환경변수 기반, 기본 14일)
const getRefreshExpiresAt = () => {
  const expiresIn = process.env.JWT_REFRESH_EXPIRES_IN || '14d';
  const match = expiresIn.match(/^(\d+)([dhm])$/);
  if (!match) return new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const value = parseInt(match[1]);
  const unit = match[2];
  const ms = unit === 'd' ? value * 24 * 60 * 60 * 1000
            : unit === 'h' ? value * 60 * 60 * 1000
            : value * 60 * 1000;
  return new Date(Date.now() + ms);
};

/**
 * 회원가입 (이메일) — 단일 완결 처리
 * @route POST /api/auth/register
 * @body {string} email
 * @body {string} password
 * @body {string} user_mode  'guest' | 'host'
 * @body {string} [di]       KMC 본인인증 DI
 * @body {string} [name]     이름 (di 없으면 직접 전달)
 * @body {string} [phoneNumber]
 * @body {string} [birth]
 * @body {string} [gender]
 * @body {object} [terms]    { service_terms, privacy_policy, age_confirmed, marketing_consent }
 * @body {string} [bank_code]          host일 때 필수
 * @body {string} [account_num]        host일 때 필수
 * @body {string} [account_holder_name] host일 때 필수
 * @returns {201} 회원가입 성공 (사용자 정보 + JWT 토큰)
 */
const register = async (req, res) => {
  let { email, password, user_mode, name, phone_number: phoneNumber, birth, gender, di, terms,
        bank_code, account_num, account_holder_name } = req.body;

  const emailValidation = validateEmail(email);
  if (!emailValidation.valid) {
    return error(res, ErrorCodes.INVALID_EMAIL, 400);
  }

  const passwordValidation = validatePassword(password);
  if (!passwordValidation.valid) {
    return error(res, { code: 4004, message: passwordValidation.message }, 400);
  }

  // === 이메일 인증 확인 (신규) ===
  const { EmailVerificationCode } = require('../models');
  const verifiedRecord = await EmailVerificationCode.findOne({
    where: {
      email,
      verified: true
    },
    order: [['verifiedAt', 'DESC']]
  });

  if (!verifiedRecord) {
    return error(res, ErrorCodes.EMAIL_NOT_VERIFIED, 400);
  }

  // 인증 후 10분 이내에만 회원가입 가능 (선택사항)
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  if (verifiedRecord.verifiedAt < tenMinutesAgo) {
    return error(res, {
      code: 4014,
      message: '인증 시간이 만료되었습니다. 다시 인증해주세요.'
    }, 400);
  }
  // === 이메일 인증 확인 끝 ===

  const existingUser = await User.findOne({ where: { email } });
  if (existingUser) {
    if (existingUser.userType === 'social') {
      // 소셜 회원이면 어떤 플랫폼인지 조회해서 안내
      const socialAccount = await SocialUser.findOne({
        where: { userId: existingUser.id }
      });
      const platform = socialAccount?.provider || '소셜';
      return error(res, {
        ...ErrorCodes.EMAIL_EXISTS_AS_SOCIAL,
        message: `이미 가입된 이메일입니다. ${platform} 로그인을 시도해 주세요`
      }, 400);
    }
    return error(res, ErrorCodes.DUPLICATE_EMAIL, 400);
  }

  // KMC 본인인증 필수
  if (!di) {
    return error(res, { code: 4015, message: '본인인증이 필요합니다.' }, 400);
  }

  // KMC 인증 결과 서버에서 직접 조회 (프론트 조작 방지, phoneNumber/di 덮어쓰기)
  const kmcRecord = await KmcVerification.findOne({
    where: { di, used: false },
    order: [['created_at', 'DESC']]
  });

  if (!kmcRecord) {
    return error(res, { code: 4015, message: '본인인증 정보를 찾을 수 없습니다. 다시 인증해주세요.' }, 400);
  }
  if (kmcRecord.expiresAt < new Date()) {
    return error(res, { code: 4014, message: '본인인증이 만료되었습니다. 다시 인증해주세요.' }, 400);
  }

  // 서버 저장값으로 덮어쓰기 (프론트 전달값 무시)
  phoneNumber = kmcRecord.phoneNumber;
  name        = name || kmcRecord.name;
  birth       = birth || kmcRecord.birth;
  gender      = gender !== undefined ? gender : kmcRecord.gender;

  // host 가입 시 계좌 정보 필수 검증
  const isHost = user_mode === 'host';
  if (isHost && (!bank_code || !account_num || !account_holder_name)) {
    return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400);
  }

  // DI 중복 체크 (같은 사람이 다른 이메일로 가입 방지)
  const existingDi = await User.findOne({ where: { di, isActive: true } });
  if (existingDi) {
    return error(res, { code: 4410, message: '이미 가입된 본인인증 정보입니다.' }, 409);
  }

  const result = await withTransaction(async (transaction) => {
    const newUser = await User.create({
      email,
      userType: 'local',
      userMode: isHost ? 'host' : 'guest',
      ...(name && { name }),
      nickname: generateNickname(),
      ...(phoneNumber && { phoneNumber, phoneVerified: true, phoneVerifiedAt: new Date() }),
      ...(birth !== undefined && birth !== null && birth !== '' && { birth }),
      ...(gender !== undefined && gender !== null && { gender }),
      ...(di !== undefined && di !== null && di !== '' && { di }),
      ...(terms && {
        serviceTermsAgreed: terms.service_terms || false,
        privacyPolicyAgreed: terms.privacy_policy || false,
        marketingConsent: terms.marketing_consent || false,
        ageConfirmed: terms.age_confirmed || false,
        termsAgreedAt: new Date()
      })
    }, { transaction });

    // KMC 인증 임시 레코드 사용 처리 (재사용 방지)
    await kmcRecord.update({ used: true }, { transaction });

    // host 가입 시 계좌 저장
    if (isHost) {
      const cleanAccountNum = account_num.replace(/-/g, '');
      await UserBankAccount.create({
        userId: newUser.id,
        bankName: bank_code,
        accountNumber: cleanAccountNum,
        accountHolder: account_holder_name,
        isVerified: true,
        verifiedAt: new Date(),
        isPrimary: true
      }, { transaction });
    }

    const hashedPassword = await hashPassword(password);
    await LocalUser.create({
      userId: newUser.id,
      password: hashedPassword,
      emailVerified: true,
      emailVerificationToken: null
    }, { transaction });

    const { accessToken, refreshToken } = generateTokens({
      userId: newUser.id,
      email: newUser.email,
      phoneVerified: newUser.phoneVerified || false,
      hasBank: isHost
    });

    await UserSession.create({
      userId: newUser.id,
      refreshToken,
      userType: 'user',
      deviceInfo: req.headers['user-agent']?.substring(0, 255) || null,
      ipAddress: req.ip || null,
      expiresAt: getRefreshExpiresAt()
    }, { transaction });

    return {
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name || null,
        nickname: newUser.nickname || null,
        profileImageUrl: newUser.profileImageUrl,
        userType: newUser.userType,
        mode: newUser.userMode,
        phoneVerified: newUser.phoneVerified || false,
        hasBank: isHost
      },
      accessToken,
      refreshToken
    };
  });

  if (result.success) {
    return created(res, result.data, '회원가입이 완료되었습니다.');
  } else {
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, result.error.message);
  }
};

const login = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { email, password, user_mode } = req.body;

    // 입력값 검증
    const emailValidation = validateEmail(email);
    if (!emailValidation.valid) {
      await transaction.rollback();
      return error(res, ErrorCodes.INVALID_EMAIL, 400);
    }

    if (!password) {
      await transaction.rollback();
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400);
    }

    // 일반 회원 조회 (조인 포함)
    const user = await User.findOne({
      where: {
        email,
        userType: 'local'
      },
      include: [{
        model: LocalUser,
        as: 'localProfile',
        required: true
      }],
      transaction
    });

    if (!user) {
      await transaction.rollback();
      return error(res, ErrorCodes.USER_NOT_FOUND, 401);
    }

    // 계정 상태 확인 (비밀번호 검증 전)
    if (user.accountStatus === 'suspended') {
      await transaction.rollback();
      return error(res, ErrorCodes.ACCOUNT_SUSPENDED, 403);
    }
    if (user.accountStatus === 'withdrawn') {
      await transaction.rollback();
      return error(res, ErrorCodes.ACCOUNT_WITHDRAWN, 403);
    }

    // 계정 잠금 확인
    const localProfile = user.localProfile;
    if (localProfile.lockUntil && localProfile.lockUntil > new Date()) {
      await transaction.rollback();
      return error(res, ErrorCodes.ACCOUNT_LOCKED, 401);
    }

    const isPasswordValid = await comparePassword(password, localProfile.password);

    if (!isPasswordValid) {
      // 로그인 실패 횟수 증가
      const failedAttempts = localProfile.failedLoginAttempts + 1;
      const updateData = { failedLoginAttempts: failedAttempts };

      // 5회 실패 시 10분 잠금
      if (failedAttempts >= 5) {
        updateData.lockUntil = new Date(Date.now() + 10 * 60 * 1000);
      }

      await localProfile.update(updateData, { transaction });
      await transaction.commit();

      return error(res, ErrorCodes.PASSWORD_MISMATCH, 401);
    }

    // 로그인 성공 시 실패 횟수 초기화
    await localProfile.update({
      failedLoginAttempts: 0,
      lockUntil: null
    }, { transaction });

    // 계좌 등록 여부 확인
    const bankAccount = await UserBankAccount.findOne({
      where: { userId: user.id }
    });

    // user_mode 결정: 계좌가 없으면 guest 강제, 있으면 요청값 또는 기본값
    let userMode = 'guest';
    if (bankAccount) {
      userMode = user_mode === 'host' ? 'host' : 'guest';
    }

    const { accessToken, refreshToken } = generateTokens({
      userId: user.id,
      email: user.email
    });

    // 세션 테이블에 새 세션 생성
    await UserSession.create({
      userId: user.id,
      refreshToken,
      userType: 'user',
      deviceInfo: req.headers['user-agent']?.substring(0, 255) || null,
      ipAddress: req.ip || null,
      expiresAt: getRefreshExpiresAt()
    }, { transaction });

    await user.update({
      lastLoginAt: new Date(),
      ...(user.userMode !== userMode && { userMode })
    }, { transaction });

    await transaction.commit();

    return success(res, {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        nickname: user.nickname,
        profileImageUrl: user.profileImageUrl,
        userType: user.userType,
        mode: userMode,
        phoneVerified: user.phoneVerified || false,
        hasBank: !!bankAccount
      },
      accessToken,
      refreshToken
    }, '로그인이 완료되었습니다.');
  } catch (err) {
    await transaction.rollback();
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

const refreshToken = async (req, res) => {
  try {
    const { refreshToken: token } = req.body;

    if (!token) {
      return error(res, ErrorCodes.INVALID_TOKEN, 401);
    }

    // Refresh Token 검증 (서명 및 만료 확인)
    let decoded;
    try {
      decoded = verifyToken(token, true); // isRefreshToken = true
    } catch (err) {
      if (err.message === 'Token expired') {
        return error(res, ErrorCodes.TOKEN_EXPIRED, 401);
      }
      return error(res, ErrorCodes.INVALID_TOKEN, 401);
    }

    // 세션 테이블에서 토큰 일치 확인
    const session = await UserSession.findOne({
      where: {
        userId: decoded.userId,
        refreshToken: token,
        userType: 'user'
      }
    });

    if (!session || session.expiresAt < new Date()) {
      return error(res, ErrorCodes.INVALID_TOKEN, 403);
    }

    // 사용자 상태 확인
    const user = await User.findOne({
      where: {
        id: decoded.userId,
        accountStatus: 'active'
      }
    });

    if (!user) {
      return error(res, ErrorCodes.INVALID_TOKEN, 403);
    }

    // 계좌 정보 조회
    const bankAccount = await UserBankAccount.findOne({
      where: { userId: user.id }
    });

    // 새 토큰 생성
    const { accessToken, refreshToken: newRefreshToken } = generateTokens({
      userId: user.id,
      email: user.email
    });

    // 세션 업데이트 (토큰 교체 + 만료 갱신 + lastUsedAt 갱신)
    await session.update({
      refreshToken: newRefreshToken,
      lastUsedAt: new Date(),
      expiresAt: getRefreshExpiresAt()
    });

    return success(res, {
      accessToken,
      refreshToken: newRefreshToken
    });
  } catch (err) {
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

const logout = async (req, res) => {
  try {
    const { refreshToken: token } = req.body;
    const user = req.user;

    if (token) {
      // 특정 세션만 삭제 (refreshToken 기준)
      await UserSession.destroy({
        where: {
          userId: user.id,
          refreshToken: token,
          userType: 'user'
        }
      });
    } else {
      // refreshToken 미제공 시 해당 유저의 모든 세션 삭제 (전체 로그아웃)
      await UserSession.destroy({
        where: {
          userId: user.id,
          userType: 'user'
        }
      });
    }

    return success(res, null, '로그아웃이 완료되었습니다.');
  } catch (err) {
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

const getProfile = async (req, res) => {
  try {
    const user = req.user;

    // 계좌 등록 여부 확인
    const bankAccount = await UserBankAccount.findOne({
      where: { userId: user.id }
    });

    return success(res, {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        nickname: user.nickname,
        profileImageUrl: user.profileImageUrl,
        userType: user.userType,
        mode: user.userMode,
        phoneVerified: user.phoneVerified || false,
        hasBank: !!bankAccount
      }
    });
  } catch (err) {
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 유저 모드 전환
 * @route PATCH /api/auth/mode
 * @body {string} mode - 전환할 모드 (guest | host)
 */
const switchUserMode = async (req, res) => {
  try {
    const user = req.user;
    const { mode } = req.body;

    if (!mode || !['guest', 'host'].includes(mode)) {
      return error(res, { code: 4000, message: 'mode는 guest 또는 host여야 합니다.' }, 400);
    }

    if (mode === 'host') {
      const bankAccount = await UserBankAccount.findOne({ where: { userId: user.id } });
      if (!bankAccount) {
        return error(res, { code: 4030, message: '호스트 모드 전환은 계좌 등록 후 가능합니다.' }, 403);
      }
    }

    await user.update({ userMode: mode });

    return success(res, { mode });
  } catch (err) {
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 로그인 우회 (테스트 목적)
 * - 개발 환경: 항상 허용
 * - 운영 환경: ALLOW_DEV_BYPASS=true + 헤더 x-bypass-key === DEV_BYPASS_KEY 필요
 */
const devBypassLogin = async (req, res) => {
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction) {
    if (process.env.ALLOW_DEV_BYPASS !== 'true') {
      return error(res, {
        code: 2001,
        message: 'This endpoint is not available'
      }, 403);
    }
    const bypassKey = req.query.key || req.headers['x-bypass-key'];
    if (!process.env.DEV_BYPASS_KEY || bypassKey !== process.env.DEV_BYPASS_KEY) {
      return error(res, {
        code: 2002,
        message: 'Invalid bypass key'
      }, 403);
    }
  }

  try {
    const { userid } = req.params;
    const { user_mode } = req.query;

    if (!userid) {
      return error(res, {
        code: 4000,
        message: 'userId는 필수입니다.'
      }, 400);
    }

    // 사용자 조회
    const user = await User.findOne({
      where: { id: userid }
    });

    if (!user) {
      return error(res, ErrorCodes.USER_NOT_FOUND, 404);
    }

    if (user.accountStatus === 'suspended') {
      return error(res, ErrorCodes.ACCOUNT_SUSPENDED, 403);
    }
    if (user.accountStatus === 'withdrawn') {
      return error(res, ErrorCodes.ACCOUNT_WITHDRAWN, 403);
    }

    // 계좌 등록 여부 확인
    const bankAccount = await UserBankAccount.findOne({
      where: { userId: user.id }
    });

    // user_mode 결정
    let userMode = 'guest';
    if (bankAccount) {
      userMode = user_mode === 'host' ? 'host' : 'guest';
    }

    // 토큰 생성
    const { accessToken, refreshToken } = generateTokens({
      userId: user.id,
      email: user.email
    });

    // 세션 테이블에 새 세션 생성
    await UserSession.create({
      userId: user.id,
      refreshToken,
      userType: 'user',
      deviceInfo: req.headers['user-agent']?.substring(0, 255) || null,
      ipAddress: req.ip || null,
      expiresAt: getRefreshExpiresAt()
    });

    await user.update({ lastLoginAt: new Date() });

    return success(res, {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        nickname: user.nickname,
        profileImageUrl: user.profileImageUrl,
        userType: user.userType,
        userMode: userMode,
        phoneVerified: user.phoneVerified || false,
        hasBank: !!bankAccount
      },
      accessToken,
      refreshToken
    }, '[DEV] 개발 환경 로그인 우회 성공');
  } catch (err) {
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 비밀번호 재설정 (비로그인 상태)
 * @route POST /api/auth/reset-password
 * @body {string} email - 이메일 주소
 * @body {string} newPassword - 새 비밀번호 (8~16자, 영문+숫자)
 */
const resetPassword = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { email, newPassword } = req.body;

    // 필수 필드 검증
    if (!email || !newPassword) {
      await transaction.rollback();
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400);
    }

    // 이메일 검증
    const emailValidation = validateEmail(email);
    if (!emailValidation.valid) {
      await transaction.rollback();
      return error(res, ErrorCodes.INVALID_EMAIL, 400);
    }

    // 새 비밀번호 강도 검증
    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.valid) {
      await transaction.rollback();
      return error(res, { code: 4004, message: passwordValidation.message }, 400);
    }

    // 이메일 인증 완료 여부 확인 (password_reset 타입)
    const verifiedRecord = await EmailVerificationCode.findOne({
      where: {
        email,
        verified: true
      },
      order: [['verifiedAt', 'DESC']],
      transaction
    });

    if (!verifiedRecord) {
      await transaction.rollback();
      return error(res, { code: 4015, message: '이메일 인증이 필요합니다.' }, 400);
    }

    // 인증 후 10분 이내에만 재설정 가능
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    if (verifiedRecord.verifiedAt < tenMinutesAgo) {
      await transaction.rollback();
      return error(res, {
        code: 4014,
        message: '인증 시간이 만료되었습니다. 다시 인증해주세요.'
      }, 400);
    }

    // 사용자 조회
    const user = await User.findOne({
      where: { email, userType: 'local' },
      transaction
    });

    if (!user) {
      await transaction.rollback();
      return error(res, ErrorCodes.USER_NOT_FOUND, 404);
    }

    // LocalUser 조회
    const localUser = await LocalUser.findOne({
      where: { userId: user.id },
      transaction
    });

    if (!localUser) {
      await transaction.rollback();
      return error(res, ErrorCodes.USER_NOT_FOUND, 404);
    }

    // 기존 비밀번호와 동일한지 확인
    const isSamePassword = await comparePassword(newPassword, localUser.password);
    if (isSamePassword) {
      await transaction.rollback();
      return error(res, { code: 4007, message: '새 비밀번호는 현재 비밀번호와 달라야 합니다.' }, 400);
    }

    // 비밀번호 해싱 및 업데이트
    const hashedPassword = await hashPassword(newPassword);
    await localUser.update({ password: hashedPassword }, { transaction });

    // 사용된 인증 레코드 무효화 (재사용 방지)
    await verifiedRecord.destroy({ transaction });

    await transaction.commit();

    return success(res, null, '비밀번호가 재설정되었습니다.');

  } catch (err) {
    await transaction.rollback();
    console.error('비밀번호 재설정 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, process.env.NODE_ENV === 'development' ? err.message : undefined);
  }
};

module.exports = {
  register,
  login,
  refreshToken,
  logout,
  getProfile,
  switchUserMode,
  devBypassLogin,
  resetPassword
};
