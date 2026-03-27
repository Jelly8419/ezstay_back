const bcrypt = require('bcryptjs');
const { success, error, ErrorCodes } = require('../utils/responseHelper');
const { Admin, UserSession } = require('../models');
const { generateTokens } = require('../utils/auth');

// refreshToken 만료 시각 계산
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
 * 관리자 로그인
 * POST /api/admin/auth/login
 */
const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    // 입력 검증
    if (!username || !password) {
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400);
    }

    // 관리자 조회
    const admin = await Admin.findOne({ where: { username } });

    if (!admin) {
      return error(res, {
        code: 4007,
        message: '아이디 또는 비밀번호가 올바르지 않습니다.'
      }, 401);
    }

    // 계정 활성화 확인
    if (!admin.isActive) {
      return error(res, {
        code: 4008,
        message: '비활성화된 계정입니다. 관리자에게 문의하세요.'
      }, 403);
    }

    // 비밀번호 확인
    const isPasswordValid = await bcrypt.compare(password, admin.password);

    if (!isPasswordValid) {
      return error(res, {
        code: 4007,
        message: '아이디 또는 비밀번호가 올바르지 않습니다.'
      }, 401);
    }

    // JWT 토큰 생성
    const { accessToken, refreshToken } = generateTokens({ userId: admin.id });

    // 세션 테이블에 새 세션 생성
    await UserSession.create({
      userId: admin.id,
      refreshToken,
      userType: 'admin',
      deviceInfo: req.headers['user-agent']?.substring(0, 255) || null,
      ipAddress: req.ip || null,
      expiresAt: getRefreshExpiresAt()
    });

    admin.lastLoginAt = new Date();
    await admin.save();

    return success(res, {
      admin: {
        id: admin.id,
        username: admin.username,
        name: admin.name,
        role: admin.role,
        lastLoginAt: admin.lastLoginAt
      },
      accessToken,
      refreshToken
    }, '로그인 성공');
  } catch (err) {
    console.error('관리자 로그인 실패:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 관리자 로그아웃
 * POST /api/admin/auth/logout
 */
const logout = async (req, res) => {
  try {
    const admin = req.admin;

    // 해당 관리자 세션 전체 삭제
    await UserSession.destroy({
      where: {
        userId: admin.id,
        userType: 'admin'
      }
    });

    return success(res, null, '로그아웃 성공');
  } catch (err) {
    console.error('관리자 로그아웃 실패:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

/**
 * 관리자 정보 조회
 * GET /api/admin/auth/me
 */
const getMe = async (req, res) => {
  try {
    const admin = req.admin;

    return success(res, {
      id: admin.id,
      username: admin.username,
      name: admin.name,
      phoneNumber: admin.phoneNumber,
      role: admin.role,
      isActive: admin.isActive,
      lastLoginAt: admin.lastLoginAt,
      createdAt: admin.createdAt,
      updatedAt: admin.updatedAt
    }, '관리자 정보 조회 성공');
  } catch (err) {
    console.error('관리자 정보 조회 실패:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

module.exports = {
  login,
  logout,
  getMe
};
