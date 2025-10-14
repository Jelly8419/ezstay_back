const express = require('express');
const { Sequelize } = require('sequelize');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());

// CORS 설정
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:3000'],
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['Content-Length', 'Content-Type']
};
app.use(cors(corsOptions));

app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate Limiting
const { generalLimiter } = require('./middleware/rateLimiter');
// 지도 API는 Rate Limiting 제외 (빈번한 요청 필요)
app.use('/api/', (req, res, next) => {
  if (req.path.startsWith('/rooms/map')) {
    return next(); // Rate Limiter 건너뛰기
  }
  generalLimiter(req, res, next);
});

// 정적 파일 제공 (업로드된 이미지)
// placeholder 이미지 미들웨어 먼저 적용
const placeholderImageMiddleware = require('./middleware/placeholderImage');
app.use('/uploads', (req, res, next) => {
  console.log('[Server] /uploads 미들웨어 실행, req.path:', req.path);
  // 정적 파일에도 CORS 헤더 명시적으로 설정
  res.header('Access-Control-Allow-Origin', req.headers.origin || 'http://localhost:3000');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
}, placeholderImageMiddleware);

const { User, LocalUser, SocialUser, Room, RoomPhoto, RoomAmenity, RoomFreeService, sequelize } = require('./models');
const { connectRedis } = require('./config/redis');

// MySQL 연결
sequelize.authenticate()
  .then(async () => {
    console.log('Connected to MySQL');

    // 데이터베이스 테이블 동기화 (관계 포함)
    await sequelize.sync({ alter: true });
    console.log('Database synchronized');
  })
  .catch(err => {
    console.error('MySQL connection error:', err);
  });

// Redis 연결 (비동기, 실패해도 서버는 계속 실행)
connectRedis();

const roomRoutes = require('./routes/roomRoutes');
const authRoutes = require('./routes/authRoutes');
const accountRoutes = require('./routes/accountRoutes');
const userRoutes = require('./routes/userRoutes');
const hostRoutes = require('./routes/hostRoutes');

app.use('/api/rooms', roomRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/user', userRoutes);
app.use('/api/host', hostRoutes);

app.get('/', (req, res) => {
  res.json({ message: 'Rental API Server is running!' });
});

// 전역 에러 핸들러 (모든 라우트 뒤에 위치)
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
app.use(notFoundHandler); // 404 처리
app.use(errorHandler); // 에러 처리

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;