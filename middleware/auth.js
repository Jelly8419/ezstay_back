const { verifyToken } = require('../utils/auth');
const { User } = require('../models');

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

module.exports = {
  authenticateToken,
  optionalAuth
};