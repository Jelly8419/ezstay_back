const bcrypt = require('bcryptjs');
const { success, error, ErrorCodes } = require('../utils/responseHelper');
const { Admin } = require('../models');
const { generateTokens } = require('../utils/auth');

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

    // Refresh Token DB 저장
    admin.refreshToken = refreshToken;
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

    // Refresh Token 삭제
    admin.refreshToken = null;
    await admin.save();

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
