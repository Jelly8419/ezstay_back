const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// JWT Secret 검증
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

if (!JWT_SECRET) {
  throw new Error('FATAL ERROR: JWT_SECRET is not defined. Server cannot start.');
}

if (!JWT_REFRESH_SECRET) {
  throw new Error('FATAL ERROR: JWT_REFRESH_SECRET is not defined. Server cannot start.');
}

if (JWT_SECRET.length < 32) {
  throw new Error('FATAL ERROR: JWT_SECRET must be at least 32 characters long.');
}

if (JWT_REFRESH_SECRET.length < 32) {
  throw new Error('FATAL ERROR: JWT_REFRESH_SECRET must be at least 32 characters long.');
}

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '14d';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '14d';

const generateTokens = (payload) => {
  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  const refreshToken = jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: JWT_REFRESH_EXPIRES_IN });

  return { accessToken, refreshToken };
};

const verifyToken = (token, isRefreshToken = false) => {
  try {
    const secret = isRefreshToken ? JWT_REFRESH_SECRET : JWT_SECRET;
    return jwt.verify(token, secret);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('Token expired');
    }
    throw new Error('Invalid token');
  }
};

const hashPassword = async (password) => {
  const saltRounds = 12;
  return await bcrypt.hash(password, saltRounds);
};

const comparePassword = async (password, hashedPassword) => {
  return await bcrypt.compare(password, hashedPassword);
};

module.exports = {
  generateTokens,
  verifyToken,
  hashPassword,
  comparePassword
};