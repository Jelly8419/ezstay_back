const { createClient } = require('redis');

// Redis 클라이언트 생성
const redisClient = createClient({
  socket: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379
  },
  password: process.env.REDIS_PASSWORD || undefined,
  // 재연결 전략
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        console.error('Redis 재연결 실패 (10회 초과)');
        return new Error('Redis 연결 불가');
      }
      // 지수 백오프: 1초, 2초, 4초, 8초...
      return Math.min(retries * 100, 3000);
    }
  }
});

// 에러 핸들링
redisClient.on('error', (err) => {
  console.error('Redis Client Error:', err);
});

redisClient.on('connect', () => {
  console.log('Redis 연결 성공');
});

redisClient.on('ready', () => {
  console.log('Redis 사용 준비 완료');
});

// Redis 연결
const connectRedis = async () => {
  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
  } catch (err) {
    console.error('Redis 연결 실패:', err.message);
    console.warn('⚠️  Redis 없이 서버를 계속 실행합니다. (캐싱 비활성화)');
  }
};

// Redis 안전 실행 헬퍼 (연결 실패 시 null 반환)
const safeRedisOperation = async (operation) => {
  try {
    if (!redisClient.isOpen) {
      return null;
    }
    return await operation(redisClient);
  } catch (err) {
    console.error('Redis 작업 실패:', err.message);
    return null;
  }
};

module.exports = {
  redisClient,
  connectRedis,
  safeRedisOperation
};
