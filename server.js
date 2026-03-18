const express = require('express');
const { Sequelize } = require('sequelize');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 리버스 프록시(Nginx, ALB 등) 뒤에서 클라이언트 IP를 정확히 식별하기 위한 설정
// express-rate-limit이 X-Forwarded-For 헤더를 신뢰할 수 있도록 함
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// gzip 압축 미들웨어 (모든 응답에 적용)
app.use(compression({
  level: 6, // 압축 레벨 (1-9, 기본 6)
  threshold: 1024, // 1KB 이상만 압축
  filter: (req, res) => {
    // 압축 제외 요청 처리
    if (req.headers['x-no-compression']) {
      return false;
    }
    // compression 기본 필터 사용 (compressible MIME types만 압축)
    return compression.filter(req, res);
  }
}));

// CORS 설정
const corsOptions = {
  origin: (origin, callback) => {
    // origin이 없는 경우 (브라우저 직접 접속, Postman, curl 등)
    // development 모드에서는 허용
    if (!origin && process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }

    // 개발 환경: 모든 localhost와 127.0.0.1을 포트 무관하게 허용
    if (process.env.NODE_ENV === 'development') {
      if (origin && (origin.startsWith('http://localhost:') ||
                     origin.startsWith('http://127.0.0.1:') ||
                     origin === 'http://localhost' ||
                     origin === 'http://127.0.0.1')) {
        console.log(`[CORS] Development mode - allowing origin: ${origin}`);
        return callback(null, true);
      }
    }

    // 환경변수로 지정된 도메인 허용 (개발/프로덕션 공통)
    const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [];
    if (!origin || allowedOrigins.includes(origin)) {
      console.log(`[CORS] Allowed origin from env: ${origin}`);
      return callback(null, true);
    }

    console.log(`[CORS] Blocked origin: ${origin}`);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['Content-Length', 'Content-Type']
};
// KMC 본인인증 콜백은 KMC 서버에서 직접 POST하므로 CORS 건너뛰기
const corsMiddleware = cors(corsOptions);
app.use((req, res, next) => {
  if (req.path === '/api/auth/kmc/callback') {
    return next();
  }
  corsMiddleware(req, res, next);
});

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

// ========================================
// 정적 파일 제공 (업로드된 이미지)
// ========================================
if (process.env.NODE_ENV === 'development') {
  // 로컬 개발 환경: Express가 직접 정적 파일 제공
  console.log('[Server] Development mode: Express handles /uploads');

  const placeholderImageMiddleware = require('./middleware/placeholderImage');

  app.use('/uploads', (req, res, next) => {
    console.log('[Server] /uploads 요청:', req.path);

    // CORS 헤더 설정
    const origin = req.headers.origin;
    if (!origin || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
      res.header('Access-Control-Allow-Origin', origin || '*');
    }
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');

    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // express.static으로 실제 파일 제공
  app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
    fallthrough: true,
    maxAge: '1d'
  }));

  // fallback: 파일 없으면 placeholder 제공
  app.use('/uploads', placeholderImageMiddleware);
} else {
  // 프로덕션: Nginx가 /uploads 처리하므로 Express는 처리 안 함
  console.log('[Server] Production mode: Nginx handles /uploads');
}

const { User, LocalUser, SocialUser, Room, RoomPhoto, RoomAmenity, RoomFreeService, sequelize } = require('./models');
const { connectRedis } = require('./config/redis');

// MySQL 연결
sequelize.authenticate()
  .then(async () => {
    console.log('Connected to MySQL');

    // 데이터베이스 테이블 동기화 (관계 포함)
    // alter: false로 변경하여 외래키 중복 생성 방지
    await sequelize.sync({ alter: false });
    console.log('Database synchronized');
  })
  .catch(err => {
    console.error('MySQL connection error:', err);
  });

// Redis 연결 (비동기, 실패해도 서버는 계속 실행)
connectRedis();

// 계약 상태 자동 업데이트 스케줄러 시작
const { startContractScheduler } = require('./schedulers/contractScheduler');
startContractScheduler();

// 채팅 알림 스케줄러 시작 (체크인/체크아웃 D-1 알림)
const { startChatReminderScheduler } = require('./schedulers/chatReminderScheduler');
startChatReminderScheduler();

// 호스트 자동메시지 스케줄러 시작
const { startAutoMessageScheduler } = require('./schedulers/autoMessageScheduler');
startAutoMessageScheduler();

// 관리자 액션 로그 자동 정리 스케줄러 시작
const cleanupActionLogs = require('./schedulers/cleanupActionLogs');
cleanupActionLogs();

// 미완료 회원가입 자동 정리 스케줄러 시작 (7일 초과 미인증 계정)
const cleanupIncompleteRegistrations = require('./schedulers/cleanupIncompleteRegistrations');
cleanupIncompleteRegistrations();

// 렌탈 주문 만료 스케줄러 시작 (15분 미결제 자동 취소)
const { startRentalOrderScheduler } = require('./schedulers/rentalOrderScheduler');
startRentalOrderScheduler();

// 알림 스케줄러 시작 (결제만료, 입주/퇴실, 옵션마감 알림)
const { startNotificationScheduler } = require('./schedulers/notificationScheduler');
startNotificationScheduler();

// 카카오 알림톡 스케줄러 시작 (퇴실전일, 실패재시도)
const { startAlimtalkScheduler } = require('./schedulers/alimtalkScheduler');
startAlimtalkScheduler();

// Firebase Admin SDK 초기화
const { initializeFirebase } = require('./config/firebaseAdmin');
initializeFirebase();

const roomRoutes = require('./routes/roomRoutes');
const authRoutes = require('./routes/authRoutes');
const accountRoutes = require('./routes/accountRoutes');
const userRoutes = require('./routes/userRoutes');
const hostRoutes = require('./routes/hostRoutes');
const contractRoutes = require('./routes/contractRoutes');
const chatRoutes = require('./routes/chatRoutes');
const adminRoutes = require('./routes/adminRoutes');
const supportRoutes = require('./routes/supportRoutes');
const refundRoutes = require('./routes/refundRoutes');
const rentalItemRoutes = require('./routes/rentalItemRoutes');
const { adminRouter: rentalItemAdminRoutes } = require('./routes/rentalItemRoutes');
const scheduleRoutes = require('./routes/scheduleRoutes');
const rentalOrderRoutes = require('./routes/rentalOrderRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const kmcRoutes = require('./routes/kmcRoutes');

app.use('/api/rooms', roomRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/user', userRoutes);
app.use('/api/host', hostRoutes);
app.use('/api/host', scheduleRoutes);  // 호스트 일정 관리
app.use('/api/contracts', contractRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/support', supportRoutes);
app.use('/api', refundRoutes);
app.use('/api/rental-items', rentalItemRoutes);  // 게스트용 공개 API
app.use('/api/admin/rental-items', rentalItemAdminRoutes);  // 관리자용 API
app.use('/api', rentalOrderRoutes);  // 렌탈 주문 API
app.use('/api/notifications', notificationRoutes);  // 알림 API
app.use('/api/auth', kmcRoutes);  // KMC 본인인증

// TODO: 가상계좌 지원 시 웹훅 라우트 활성화
// const paytagWebhookController = require('./controllers/paytagWebhookController');
// app.post('/api/payments/webhook/paytag', paytagWebhookController.handleWebhook);

app.get('/', (req, res) => {
  res.json({ message: 'Rental API Server is running!' });
});

// 헬스체크 엔드포인트 (배포 스크립트용)
app.get('/health', async (req, res) => {
  try {
    // MySQL 연결 확인
    await sequelize.authenticate();

    // Redis 연결 확인 (선택적)
    const { redisClient } = require('./config/redis');
    const redisStatus = redisClient?.isReady ? 'connected' : 'disconnected';

    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      mysql: 'connected',
      redis: redisStatus,
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB'
      }
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      message: 'Service unavailable',
      error: error.message
    });
  }
});

// 전역 에러 핸들러 (모든 라우트 뒤에 위치)
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
app.use(notFoundHandler); // 404 처리
app.use(errorHandler); // 에러 처리

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;