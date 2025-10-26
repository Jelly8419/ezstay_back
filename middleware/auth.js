const { verifyToken } = require('../utils/auth');
const { User, Admin } = require('../models');

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: '액세스 토큰이 필요합니다.'
    });
  }

  try {
    const decoded = verifyToken(token);
    const user = await User.findByPk(decoded.userId, {
      attributes: { exclude: ['password', 'refreshToken'] }
    });

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: '유효하지 않은 사용자입니다.'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(403).json({
      success: false,
      message: '유효하지 않은 토큰입니다.'
    });
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

      if (user && user.isActive) {
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
    return res.status(401).json({
      success: false,
      message: '액세스 토큰이 필요합니다.'
    });
  }

  try {
    const decoded = verifyToken(token);

    // Admin 테이블에서 조회
    const admin = await Admin.findByPk(decoded.userId, {
      attributes: { exclude: ['password', 'refreshToken'] }
    });

    if (!admin || !admin.isActive) {
      return res.status(401).json({
        success: false,
        message: '유효하지 않은 관리자 계정입니다.'
      });
    }

    req.admin = admin; // req.admin으로 저장
    next();
  } catch (error) {
    return res.status(403).json({
      success: false,
      message: '유효하지 않은 토큰입니다.'
    });
  }
};

/**
 * 특정 관리자 역할 확인 미들웨어
 * @param {Array<string>} roles - 허용할 역할 배열 (예: ['super_admin', 'admin'])
 */
const requireAdminRole = (roles = []) => {
  return (req, res, next) => {
    if (!req.admin) {
      return res.status(401).json({
        success: false,
        message: '관리자 인증이 필요합니다.'
      });
    }

    if (roles.length > 0 && !roles.includes(req.admin.role)) {
      return res.status(403).json({
        success: false,
        message: '해당 작업을 수행할 권한이 없습니다.'
      });
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