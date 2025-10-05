const { User, LocalUser, SocialUser, UserBankAccount, sequelize } = require('../models');
const { generateTokens, hashPassword, comparePassword, verifyToken } = require('../utils/auth');
const { ErrorCodes, success, error, created } = require('../utils/responseHelper');
const { validateEmail, validatePassword } = require('../utils/validator');
const { Op } = require('sequelize');

const register = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { email, password, user_mode } = req.body;

    // 입력값 검증
    const emailValidation = validateEmail(email);
    if (!emailValidation.valid) {
      await transaction.rollback();
      return error(res, ErrorCodes.INVALID_EMAIL, 400);
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      await transaction.rollback();
      return error(res, { code: 4004, message: passwordValidation.message }, 400);
    }

    const existingUser = await User.findOne({
      where: { email }
    });

    if (existingUser) {
      await transaction.rollback();
      return error(res, ErrorCodes.DUPLICATE_EMAIL, 400);
    }

    // 기본 사용자 정보 생성
    const newUser = await User.create({
      email,
      userType: 'local'
    }, { transaction });

    // 일반 회원 전용 정보 생성
    const hashedPassword = await hashPassword(password);
    await LocalUser.create({
      userId: newUser.id,
      password: hashedPassword
    }, { transaction });

    const { accessToken, refreshToken } = generateTokens({
      userId: newUser.id,
      email: newUser.email,
      phoneVerified: newUser.phoneVerified || false,
      hasBank: false
    });

    await newUser.update({ refreshToken }, { transaction });

    await transaction.commit();

    return created(res, {
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name || null,
        profileImageUrl: newUser.profileImageUrl,
        userType: newUser.userType,
        userMode: user_mode === 'host' ? 'host' : 'guest',
        phoneVerified: newUser.phoneVerified || false,
        hasBank: false
      },
      accessToken,
      refreshToken
    }, '회원가입이 완료되었습니다.');
  } catch (err) {
    await transaction.rollback();
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

const login = async (req, res) => {
  try {
    const { email, password, user_mode } = req.body;

    // 입력값 검증
    const emailValidation = validateEmail(email);
    if (!emailValidation.valid) {
      return error(res, ErrorCodes.INVALID_EMAIL, 400);
    }

    if (!password) {
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
      }]
    });

    if (!user) {
      return error(res, ErrorCodes.USER_NOT_FOUND, 401);
    }

    // 계정 잠금 확인
    const localProfile = user.localProfile;
    if (localProfile.lockUntil && localProfile.lockUntil > new Date()) {
      return error(res, { code: 1004, message: '계정이 일시적으로 잠겨있습니다. 나중에 다시 시도해주세요.' }, 401);
    }

    const isPasswordValid = await comparePassword(password, localProfile.password);

    if (!isPasswordValid) {
      // 로그인 실패 횟수 증가
      const failedAttempts = localProfile.failedLoginAttempts + 1;
      const updateData = { failedLoginAttempts: failedAttempts };

      // 5회 실패 시 30분 잠금
      if (failedAttempts >= 5) {
        updateData.lockUntil = new Date(Date.now() + 30 * 60 * 1000);
      }

      await localProfile.update(updateData);

      return error(res, ErrorCodes.PASSWORD_MISMATCH, 401);
    }

    if (!user.isActive) {
      return error(res, { code: 1005, message: '비활성화된 계정입니다.' }, 401);
    }

    // 로그인 성공 시 실패 횟수 초기화
    await localProfile.update({
      failedLoginAttempts: 0,
      lockUntil: null
    });

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

    await user.update({
      refreshToken,
      lastLoginAt: new Date()
    });

    return success(res, {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        profileImageUrl: user.profileImageUrl,
        userType: user.userType,
        userMode: userMode,
        phoneVerified: user.phoneVerified || false,
        hasBank: !!bankAccount
      },
      accessToken,
      refreshToken
    }, '로그인이 완료되었습니다.');
  } catch (err) {
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

    // DB에서 사용자 및 토큰 일치 확인
    const user = await User.findOne({
      where: {
        id: decoded.userId,
        refreshToken: token,
        isActive: true
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

    await user.update({ refreshToken: newRefreshToken });

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
    const user = req.user;

    await user.update({ refreshToken: null });

    return success(res, null, '로그아웃이 완료되었습니다.');
  } catch (err) {
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

const getProfile = async (req, res) => {
  try {
    const user = req.user;

    return success(res, {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        profileImageUrl: user.profileImageUrl,
        provider: user.provider
      }
    });
  } catch (err) {
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

module.exports = {
  register,
  login,
  refreshToken,
  logout,
  getProfile
};