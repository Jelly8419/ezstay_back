const { verifyToken } = require('../utils/auth');
const { User, Admin } = require('../models');
const { error: errorResponse, ErrorCodes } = require('../utils/responseHelper');

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return errorResponse(res, ErrorCodes.UNAUTHORIZED, 401);
  }

  try {
    const decoded = verifyToken(token);
    const user = await User.findByPk(decoded.userId, {
      attributes: { exclude: ['password', 'refreshToken'] }
    });

    if (!user || user.accountStatus !== 'active') {
      return errorResponse(res, ErrorCodes.INVALID_TOKEN, 401);
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.message === 'Token expired') {
      return errorResponse(res, ErrorCodes.TOKEN_EXPIRED, 401);
    }
    return errorResponse(res, ErrorCodes.INVALID_TOKEN, 401);
  }
};

const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    try {
      const decoded = verifyToken(token);
      const user = await User.findByPk(decoded.userId, {
        attributes: { exclude: ['password', 'refreshToken'] }
      });

      if (user && user.accountStatus === 'active') {
        req.user = user;
      }
    } catch (error) {
      // 토큰이 유효하지 않아도 계속 진행
    }
  }

  next();
};

/**
 * 관리자 인증 미들웨어
 * Admin 테이블에서 인증을 처리합니다
 */
const authenticateAdmin = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return errorResponse(res, ErrorCodes.UNAUTHORIZED, 401);
  }

  try {
    const decoded = verifyToken(token);

    // Admin 테이블에서 조회
    const admin = await Admin.findByPk(decoded.userId, {
      attributes: { exclude: ['password', 'refreshToken'] }
    });

    if (!admin || !admin.isActive) {
      return errorResponse(res, ErrorCodes.INVALID_TOKEN, 401);
    }

    req.admin = admin; // req.admin으로 저장
    next();
  } catch (err) {
    if (err.message === 'Token expired') {
      return errorResponse(res, ErrorCodes.TOKEN_EXPIRED, 401);
    }
    return errorResponse(res, ErrorCodes.INVALID_TOKEN, 401);
  }
};

/**
 * 특정 관리자 역할 확인 미들웨어
 * @param {Array<string>} roles - 허용할 역할 배열 (예: ['super_admin', 'admin'])
 */
const requireAdminRole = (roles = []) => {
  return (req, res, next) => {
    if (!req.admin) {
      return errorResponse(res, ErrorCodes.UNAUTHORIZED, 401);
    }

    if (roles.length > 0 && !roles.includes(req.admin.role)) {
      return errorResponse(res, ErrorCodes.FORBIDDEN, 403);
    }

    next();
  };
};

module.exports = {
  authenticateToken,
  optionalAuth,
  authenticateAdmin,
  requireAdminRole
};