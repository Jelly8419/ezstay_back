const { User, LocalUser, SocialUser, UserBankAccount, sequelize } = require('../models');
const { generateTokens, hashPassword, comparePassword } = require('../utils/auth');
const { Op } = require('sequelize');

const register = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { email, password, user_mode } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: '이메일과 비밀번호는 필수입니다.'
      });
    }

    const existingUser = await User.findOne({
      where: { email }
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: '이미 존재하는 이메일입니다.'
      });
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

    res.status(201).json({
      success: true,
      message: '회원가입이 완료되었습니다.',
      data: {
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
      }
    });
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({
      success: false,
      message: '회원가입 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

const login = async (req, res) => {
  try {
    const { email, password, user_mode } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: '이메일과 비밀번호를 입력해주세요.'
      });
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
      return res.status(401).json({
        success: false,
        message: '존재하지 않는 사용자입니다.'
      });
    }

    // 계정 잠금 확인
    const localProfile = user.localProfile;
    if (localProfile.lockUntil && localProfile.lockUntil > new Date()) {
      return res.status(401).json({
        success: false,
        message: '계정이 일시적으로 잠겨있습니다. 나중에 다시 시도해주세요.'
      });
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

      return res.status(401).json({
        success: false,
        message: '비밀번호가 올바르지 않습니다.'
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: '비활성화된 계정입니다.'
      });
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

    res.status(200).json({
      success: true,
      message: '로그인이 완료되었습니다.',
      data: {
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
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '로그인 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

const refreshToken = async (req, res) => {
  try {
    const { refreshToken: token } = req.body;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: '리프레시 토큰이 필요합니다.'
      });
    }

    const user = await User.findOne({
      where: { refreshToken: token }
    });

    if (!user) {
      return res.status(403).json({
        success: false,
        message: '유효하지 않은 리프레시 토큰입니다.'
      });
    }

    // 최신 사용자 정보 조회 (계좌 정보 포함)
    const updatedUser = await User.findByPk(user.id);
    const bankAccount = await UserBankAccount.findOne({
      where: { userId: user.id }
    });

    // 기존 토큰에서 userMode 추출 (없으면 기본값 설정)
    const decoded = require('jsonwebtoken').decode(token);
    let userMode = decoded?.userMode || 'guest';

    // 계좌 상태에 따라 userMode 재검증
    if (!bankAccount && userMode === 'host') {
      userMode = 'guest';
    }

    const { accessToken, refreshToken: newRefreshToken } = generateTokens({
      userId: user.id,
      email: user.email
    });

    await user.update({ refreshToken: newRefreshToken });

    res.status(200).json({
      success: true,
      data: {
        accessToken,
        refreshToken: newRefreshToken
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '토큰 갱신 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

const logout = async (req, res) => {
  try {
    const user = req.user;

    await user.update({ refreshToken: null });

    res.status(200).json({
      success: true,
      message: '로그아웃이 완료되었습니다.'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '로그아웃 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

const getProfile = async (req, res) => {
  try {
    const user = req.user;

    res.status(200).json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          profileImageUrl: user.profileImageUrl,
          provider: user.provider
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '프로필 조회 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

module.exports = {
  register,
  login,
  refreshToken,
  logout,
  getProfile
};